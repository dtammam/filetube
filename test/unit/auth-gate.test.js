'use strict';

// [UNIT] v1.43 — the auth gate primitives (lib/auth/gate.js): the
// traversal-proof allowlist (design-delta WARNING-3), the fail-open rate
// limiter (CRITICAL-1 defense-in-depth), the session-secret resolver + 0600
// file, per-instance cookie name, cookie parse/serialize, and the gate
// middleware's decision table (allowlist / no-users / valid / revoked)
// driven through fake req/res.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gate = require('../../lib/auth/gate');
const authCrypto = require('../../lib/auth/crypto');

// ---- allowlist (WARNING-3) --------------------------------------------------

test('allowlist: the intended pre-login surface is reachable; everything else is not', () => {
  for (const p of ['/login', '/welcome', '/logo', '/manifest.webmanifest', '/favicon.svg', '/favicon.ico', '/css/style.css', '/js/common.js', '/fonts/roboto.woff2', '/icons/icon-192.png', '/assets/icons/outlined/home.svg']) {
    assert.equal(gate.isAllowlisted('GET', p), true, `GET ${p} allowed pre-login`);
  }
  assert.equal(gate.isAllowlisted('POST', '/api/auth/login'), true);
  assert.equal(gate.isAllowlisted('POST', '/api/auth/setup'), true);
  // Not on the surface:
  for (const p of ['/', '/index.html', '/api/videos', '/video/abc', '/js/main.js', '/js/watch.js', '/setup.html', '/api/config', '/subscriptions']) {
    assert.equal(gate.isAllowlisted('GET', p), false, `GET ${p} must require auth`);
  }
  // Method matters: the auth endpoints are POST-only on the allowlist.
  assert.equal(gate.isAllowlisted('GET', '/api/auth/login'), false);
});

test('allowlist: traversal (raw AND percent-encoded) is refused OUTRIGHT — never allowlisted', () => {
  for (const p of [
    '/fonts/../../server.js', '/fonts/../api/secret', '/assets/icons/../../db.json',
    '/fonts/%2e%2e/server.js', '/icons/%2f/etc/passwd', '/assets/icons/..%5cwin',
    '/assets/icons/./../../db.json', '/fonts/a/../b', // explicit dot-segments
  ]) {
    assert.equal(gate.isAllowlisted('GET', p), false, `traversal refused: ${p}`);
  }
  // Nested PLAIN segments under a static prefix ARE allowed (the icon system
  // nests /assets/icons/<set>/<name>.svg) — traversal is what's refused, not
  // depth. Depth is capped.
  assert.equal(gate.isAllowlisted('GET', '/assets/icons/outlined/home.svg'), true);
  assert.equal(gate.isAllowlisted('GET', '/fonts/a/b.woff2'), true, 'nested plain is fine (no data under these trees)');
  assert.equal(gate.isAllowlisted('GET', '/icons/a/b/c/d/e.png'), false, 'beyond the depth cap → refused');
  // Query string is ignored for matching.
  assert.equal(gate.isAllowlisted('GET', '/css/style.css?v=2'), true);
});

// ---- rate limiter (CRITICAL-1 defense-in-depth) -----------------------------

test('rate limiter: allows a burst up to capacity, then 429s with a retry-after, and refunds on success', () => {
  let t = 1_000_000;
  const rl = gate.createRateLimiter({ capacity: 3, refillPerSec: 0.5, nowMs: () => t });
  assert.equal(rl.take('ip|user').allowed, true);
  assert.equal(rl.take('ip|user').allowed, true);
  assert.equal(rl.take('ip|user').allowed, true);
  const blocked = rl.take('ip|user');
  assert.equal(blocked.allowed, false, 'capacity exhausted → blocked');
  assert.ok(blocked.retryAfterSec >= 1, 'a retry-after is offered');
  // A distinct key is independent.
  assert.equal(rl.take('other-ip|user').allowed, true);
  // Refill over time.
  t += 4000; // +4s * 0.5/s = +2 tokens
  assert.equal(rl.take('ip|user').allowed, true);
  // Refund on successful login gives a token back.
  rl.refund('ip|user');
  assert.equal(rl.take('ip|user').allowed, true);
});

// ---- session secret + cookie name ------------------------------------------

test('resolveSessionSecret: env pin → file → mint-0600, all fail-closed on junk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-secret-'));
  try {
    // env pin
    const good = authCrypto.generateSecret();
    assert.equal(gate.resolveSessionSecret(dir, { FILETUBE_SESSION_SECRET: good }, () => {}), good);
    assert.throws(() => gate.resolveSessionSecret(dir, { FILETUBE_SESSION_SECRET: 'short' }, () => {}), /at least 32|placeholder/);

    // mint to file (no env, no file yet)
    const minted = gate.resolveSessionSecret(dir, {}, () => {});
    assert.equal(minted.length >= 32, true);
    const secretPath = path.join(dir, 'session-secret');
    assert.ok(fs.existsSync(secretPath), 'secret file written');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(secretPath).mode & 0o777, 0o600, 'secret file is 0600');
    }
    // second call reads the SAME secret from the file
    assert.equal(gate.resolveSessionSecret(dir, {}, () => {}), minted);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cookieNameFor: per-instance (distinct DATA_DIRs → distinct names), stable per dir', () => {
  const a = gate.cookieNameFor('/srv/docker/filetube/data');
  const b = gate.cookieNameFor('/srv/docker/filetube-beta/data');
  assert.match(a, /^ft_session_[0-9a-f]{10}$/);
  assert.notEqual(a, b, 'prod and beta get different cookie slots on one host');
  assert.equal(a, gate.cookieNameFor('/srv/docker/filetube/data'), 'stable for a dir');
});

test('serializeCookie/parseCookies: round-trip; flags present; Secure gated', () => {
  const set = gate.serializeCookie('ft_session_abc', 'tok.val', { maxAgeSeconds: 100, secure: true });
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  assert.match(set, /Path=\//);
  assert.match(set, /Secure/);
  assert.match(set, /Max-Age=100/);
  const plain = gate.serializeCookie('n', 'v', { maxAgeSeconds: 100, secure: false });
  assert.equal(/Secure/.test(plain), false, 'no Secure when not https');
  const expired = gate.serializeCookie('n', '', { expired: true });
  assert.match(expired, /Max-Age=0/);
  assert.deepEqual(gate.parseCookies('a=1; ft_session_abc=tok.val; b=2').ft_session_abc, 'tok.val');
});

test('requestIsHttps: only trusts X-Forwarded-Proto when trustProxy is set', () => {
  const proxied = { socket: {}, headers: { 'x-forwarded-proto': 'https' } };
  assert.equal(gate.requestIsHttps(proxied, false), false, 'header ignored without trust');
  assert.equal(gate.requestIsHttps(proxied, true), true, 'header honored with trust');
  assert.equal(gate.requestIsHttps({ socket: { encrypted: true }, headers: {} }, false), true, 'direct TLS always https');
});

// ---- the gate middleware decision table ------------------------------------

function fakeReq({ method = 'GET', path: p = '/', accept = 'text/html', cookie } = {}) {
  return { method, path: p, url: p, originalUrl: p, headers: { accept, cookie } };
}
function fakeRes() {
  return {
    _status: 200, _json: null, _redirect: null,
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
    redirect(c, to) { this._redirect = { code: c, to }; return this; },
  };
}
function fakeStore({ count, user }) {
  return { countUsers: () => count, getById: () => user };
}

test('gate: no users → every non-allowlisted request funnels to /welcome (setup state)', () => {
  const g = gate.createAuthGate({ store: fakeStore({ count: 0 }), secret: authCrypto.generateSecret(), cookieName: 'c' });
  const res = fakeRes(); let nexted = false;
  g(fakeReq({ path: '/' }), res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.deepEqual(res._redirect, { code: 302, to: '/welcome' });
  // an API gets 401, not a redirect
  const res2 = fakeRes();
  g(fakeReq({ path: '/api/videos', accept: 'application/json' }), res2, () => {});
  assert.equal(res2._status, 401);
});

test('gate: allowlisted /login redirects to /welcome when no users; /welcome redirects to /login once set up', () => {
  const noUsers = gate.createAuthGate({ store: fakeStore({ count: 0 }), secret: 's'.repeat(40), cookieName: 'c' });
  const r1 = fakeRes(); noUsers(fakeReq({ path: '/login' }), r1, () => {});
  assert.deepEqual(r1._redirect, { code: 302, to: '/welcome' });
  const setUp = gate.createAuthGate({ store: fakeStore({ count: 1, user: null }), secret: 's'.repeat(40), cookieName: 'c' });
  const r2 = fakeRes(); setUp(fakeReq({ path: '/welcome' }), r2, () => {});
  assert.deepEqual(r2._redirect, { code: 302, to: '/login' });
});

test('gate: a valid session sets req.user and calls next; a revoked (tv-bumped) cookie is denied', () => {
  const secret = authCrypto.generateSecret();
  const now = 1_800_000_000;
  const user = { id: 5, username: 'dean', role: 'admin', tokenVersion: 3, disabled: false };
  const store = fakeStore({ count: 1, user });
  const g = gate.createAuthGate({ store, secret, cookieName: 'c', nowSeconds: () => now });

  const goodToken = authCrypto.signSession({ uid: 5, tv: 3 }, secret, { nowSeconds: now });
  const req = fakeReq({ path: '/api/videos', accept: 'application/json', cookie: `c=${encodeURIComponent(goodToken)}` });
  let nexted = false;
  g(req, fakeRes(), () => { nexted = true; });
  assert.equal(nexted, true, 'valid session passes');
  assert.equal(req.user.id, 5, 'req.user attached');

  // tv bumped server-side (password change) → the old-tv cookie is dead now.
  const staleToken = authCrypto.signSession({ uid: 5, tv: 2 }, secret, { nowSeconds: now });
  const res2 = fakeRes();
  g(fakeReq({ path: '/api/videos', accept: 'application/json', cookie: `c=${encodeURIComponent(staleToken)}` }), res2, () => {});
  assert.equal(res2._status, 401, 'stale-tv cookie revoked instantly');

  // disabled user → denied even with a tv-correct cookie.
  const disabledStore = fakeStore({ count: 1, user: { ...user, disabled: true } });
  const g2 = gate.createAuthGate({ store: disabledStore, secret, cookieName: 'c', nowSeconds: () => now });
  const res3 = fakeRes();
  g2(fakeReq({ path: '/api/videos', accept: 'application/json', cookie: `c=${encodeURIComponent(goodToken)}` }), res3, () => {});
  assert.equal(res3._status, 401, 'disabled user denied');
});

test('gate: the API token is an ALTERNATIVE auth for POST /api/ytdlp/download only', () => {
  const g = gate.createAuthGate({ store: fakeStore({ count: 1, user: null }), secret: 's'.repeat(40), cookieName: 'c', apiToken: 'shortcut-secret-token' });
  // Valid token header on the download endpoint -> allowed (no cookie needed).
  let nexted = false;
  g({ method: 'POST', path: '/api/ytdlp/download', url: '/api/ytdlp/download', originalUrl: '/api/ytdlp/download', headers: { 'x-filetube-token': 'shortcut-secret-token' } }, fakeRes(), () => { nexted = true; });
  assert.equal(nexted, true, 'valid token allows the download endpoint');
  // Wrong token PRESENT -> 401 (not a fall-through).
  const rWrong = fakeRes();
  g({ method: 'POST', path: '/api/ytdlp/download', url: '/api/ytdlp/download', originalUrl: '/api/ytdlp/download', headers: { 'x-filetube-token': 'wrong' } }, rWrong, () => {});
  assert.equal(rWrong._status, 401, 'wrong token 401s');
  // The token does NOT unlock any OTHER endpoint.
  const rOther = fakeRes();
  g({ method: 'POST', path: '/api/config', url: '/api/config', originalUrl: '/api/config', headers: { 'x-filetube-token': 'shortcut-secret-token' } }, rOther, () => {});
  assert.equal(rOther._status, 401, 'the token is scoped to the download endpoint only');
  // Absent token header on the download endpoint -> falls through to cookie auth (401 without a session).
  const rNoTok = fakeRes();
  g({ method: 'POST', path: '/api/ytdlp/download', url: '/api/ytdlp/download', originalUrl: '/api/ytdlp/download', headers: {} }, rNoTok, () => {});
  assert.equal(rNoTok._status, 401, 'no token + no cookie -> 401 (not open)');
});

test('gate: no cookie on a page request → redirect to /login; on an API → 401', () => {
  const g = gate.createAuthGate({ store: fakeStore({ count: 1, user: null }), secret: 's'.repeat(40), cookieName: 'c' });
  const rPage = fakeRes(); g(fakeReq({ path: '/' }), rPage, () => {});
  assert.deepEqual(rPage._redirect, { code: 302, to: '/login' });
  const rApi = fakeRes(); g(fakeReq({ path: '/api/videos', accept: 'application/json' }), rApi, () => {});
  assert.equal(rApi._status, 401);
});
