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
  for (const p of ['/login', '/welcome', '/logo', '/manifest.webmanifest', '/favicon.svg', '/favicon.ico', '/css/tokens.css', '/css/ui.css', '/css/style.css', '/js/common.js', '/js/login.js', '/js/ui.js', '/js/interaction.js', '/fonts/geist.woff2', '/fonts/roboto.woff2', '/icons/icon-192.png', '/assets/icons/outlined/home.svg']) {
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

// v1.364.0 gate r1 (Dean's ruling): the sign-in pages' scripts load signed out. Every boot error the recorder
// logs on /login is a false lead in Dean's export, and a refused script was two on every sign-in.
const PRE_AUTH_SHELLS = ['login.html', 'welcome.html'];
function preAuthShellResources() {
  const out = [];
  for (const f of PRE_AUTH_SHELLS) {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', f), 'utf8');
    const re = /<(script|link)\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(html))) {
      const a = /\s(?:src|href)\s*=\s*"([^"]+)"/i.exec(m[2]);
      if (a && a[1].startsWith('/') && !a[1].startsWith('//')) out.push([f, m[1].toLowerCase(), a[1]]);
    }
  }
  return out;
}

test('v1.364.0: every script, stylesheet and icon a pre-auth shell (login.html, welcome.html) loads is allowed signed out', () => {
  const res = preAuthShellResources();
  for (const f of PRE_AUTH_SHELLS) {
    const scripts = res.filter((r) => r[0] === f && r[1] === 'script');
    assert.ok(scripts.length >= 6, f + ': the census reads its scripts (' + scripts.length + ')');
    for (const must of ['/js/common.js', '/js/login.js', '/js/glyph-pool.js', '/js/prefs-sync.js']) {
      assert.ok(scripts.some((r) => r[2] === must), f + ' loads ' + must + ' (census witness)');
    }
  }
  const refused = res.filter((r) => !gate.isAllowlisted('GET', r[2])).map((r) => r[0] + ': ' + r[2]);
  assert.deepStrictEqual(refused, [], 'the gate refuses these before sign-in, so the page logs a failed load on every visit');
});

test('v1.364.0: /js/glyph-pool.js and /js/prefs-sync.js are allowed signed out, by EXACT path only', () => {
  for (const p of ['/js/glyph-pool.js', '/js/prefs-sync.js']) {
    assert.strictEqual(gate.isAllowlisted('GET', p), true, 'GET ' + p);
    assert.strictEqual(gate.isAllowlisted('HEAD', p), true, 'HEAD ' + p);
    assert.strictEqual(gate.isAllowlisted('GET', p + '?v=2'), true, p + ' with a query (the path is what matches, as for every asset)');
    assert.strictEqual(gate.isAllowlisted('POST', p), false, 'POST ' + p);
    for (const n of [p + '.map', p + 'x', p + '/', p.replace(/\.js$/, ''), p.replace(/\.js$/, '.json'), p.replace('/js/', '/js/sub/'), p.replace('/js/', '/'), p.toUpperCase(), p.replace('.js', '.js%00')]) {
      assert.strictEqual(gate.isAllowlisted('GET', n), false, 'a neighbour stays gated: ' + n);
    }
  }
  for (const p of ['/js/main.js', '/js/setup.js', '/js/player.js', '/js/music.js', '/js/skin-surface.js']) {
    assert.strictEqual(gate.isAllowlisted('GET', p), false, 'the app scripts stay gated: ' + p);
  }
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

test('v1.352: the traversal check reads the path, never the query (/login?next=%2F... stays /login, no redirect loop)', () => {
  assert.equal(gate.isAllowlisted('GET', '/login?next=%2Fmusic%3Fremote%3Don'), true);
  assert.equal(gate.isAllowlisted('GET', '/login?next=%2F..%2Fx%5C'), true, 'markers in the query do not matter');
  for (const p of ['/fonts/%2e%2e/server.js?x=1', '/fonts/../server.js?next=%2F', '/icons/%2f/etc/passwd?a', '/assets/icons/..%5cwin?q']) {
    assert.equal(gate.isAllowlisted('GET', p), false, 'a traversal PATH is still refused with a query: ' + p);
  }
  // the gate end to end: a logged-out bookmark is bounced ONCE; the login page it lands on is served
  const g = gate.createAuthGate({ store: fakeStore({ count: 1, user: null }), secret: 's'.repeat(40), cookieName: 'c' });
  const first = fakeRes(); g(fakeReq({ path: '/music?remote=on' }), first, () => {});
  const loginReq = fakeReq({ path: first._redirect.to });
  loginReq.path = '/login';
  let served = false;
  const second = fakeRes(); g(loginReq, second, () => { served = true; });
  assert.equal(served, true, 'the redirect target itself is allowed: one bounce, no loop');
  assert.equal(second._redirect, null);
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
    _headers: {},
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
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
  const tokenReq = { method: 'POST', path: '/api/ytdlp/download', url: '/api/ytdlp/download', originalUrl: '/api/ytdlp/download', headers: { 'x-filetube-token': 'shortcut-secret-token' } };
  g(tokenReq, fakeRes(), () => { nexted = true; });
  assert.equal(nexted, true, 'valid token allows the download endpoint');
  // 2026-07-30 hardening: the token caller is attributed for the audit log
  // (previously its mutations logged as 'unauthenticated') - and it must be
  // a marker, NOT req.user (routes treat token calls as session-less).
  assert.strictEqual(tokenReq.auditActor, 'api-token');
  assert.strictEqual(tokenReq.user, undefined);
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

// ---- v1.43.1 gate fix (adversarial WARNING-2): hostile cookie headers ------

test('parseCookies NEVER throws on a malformed %-sequence — the bad value stays raw, siblings still parse', () => {
  // decodeURIComponent throws URIError on '%zz'; unguarded, one corrupt
  // cookie value (ANY cookie on the header, not just ours) 500'd every
  // request through the gate — the global body-parser error middleware is
  // registered BEFORE the gate and can never catch it (forward-only error
  // stack). The contract here matches crypto.js's verifySession: no throw on
  // hostile input, ever.
  let parsed;
  assert.doesNotThrow(() => { parsed = gate.parseCookies('ft_session_abc=%zz; b=ok%20x'); });
  assert.equal(parsed.ft_session_abc, '%zz', 'non-decodable value kept RAW (fails HMAC downstream = clean deny)');
  assert.equal(parsed.b, 'ok x', 'a valid sibling cookie still decodes');
});

test('gate: a request carrying a malformed cookie is DENIED cleanly (401/redirect), never a 500', () => {
  const g = gate.createAuthGate({ store: fakeStore({ count: 1, user: null }), secret: authCrypto.generateSecret(), cookieName: 'ft_session_abc' });
  // API shape → 401 with the gate's authRequired flag.
  const apiRes = fakeRes();
  assert.doesNotThrow(() => g(fakeReq({ path: '/api/videos', accept: 'application/json', cookie: 'ft_session_abc=%zz' }), apiRes, () => { throw new Error('must not authenticate'); }));
  assert.equal(apiRes._status, 401);
  assert.equal(apiRes._json && apiRes._json.authRequired, true);
  // Page shape → login redirect.
  const pageRes = fakeRes();
  assert.doesNotThrow(() => g(fakeReq({ path: '/', accept: 'text/html', cookie: 'x=%E0%A4%A; ft_session_abc=%zz' }), pageRes, () => { throw new Error('must not authenticate'); }));
  assert.ok(pageRes._redirect && /\/login/.test(pageRes._redirect.to), 'fail-closed to /login, not a raw 500');
});

// ---- v1.352 W1: login returns to the page asked for; sliding renewal --------

test('v1.352 W1: a logged-out page carries next=<the original URL> to /login; an API stays a 401; zero users stays /welcome', () => {
  const g = gate.createAuthGate({ store: fakeStore({ count: 1, user: null }), secret: 's'.repeat(40), cookieName: 'c' });
  const page = fakeRes(); g(fakeReq({ path: '/music?remote=on' }), page, () => {});
  assert.deepEqual(page._redirect, { code: 302, to: '/login?next=%2Fmusic%3Fremote%3Don' });
  const api = fakeRes(); g(fakeReq({ path: '/music?remote=on', accept: 'application/json' }), api, () => {});
  assert.equal(api._redirect, null);
  assert.equal(api._status, 401);
  assert.deepEqual(api._json, { error: 'authentication required', authRequired: true }, 'the 401 body is unchanged');
  const none = gate.createAuthGate({ store: fakeStore({ count: 0 }), secret: 's'.repeat(40), cookieName: 'c' });
  const w = fakeRes(); none(fakeReq({ path: '/music?remote=on' }), w, () => {});
  assert.deepEqual(w._redirect, { code: 302, to: '/welcome' }, 'the setup funnel never carries next');
  // a revoked session on a page is bounced with next too (the same deny)
  const secret = authCrypto.generateSecret();
  const tv = gate.createAuthGate({ store: fakeStore({ count: 1, user: { id: 5, tokenVersion: 4, disabled: false } }), secret, cookieName: 'c' });
  const stale = authCrypto.signSession({ uid: 5, tv: 3 }, secret);
  const r = fakeRes(); tv(fakeReq({ path: '/setup', cookie: 'c=' + encodeURIComponent(stale) }), r, () => {});
  assert.deepEqual(r._redirect, { code: 302, to: '/login?next=%2Fsetup' });
});

test('v1.352 W1: loginTarget drops next for / and for a URL over the cap, and never builds an absolute one', () => {
  assert.equal(gate.loginTarget('/'), '/login');
  assert.equal(gate.loginTarget(undefined), '/login');
  assert.equal(gate.loginTarget('http://evil/x'), '/login', 'only a path is carried');
  const long = '/music?x=' + 'a'.repeat(gate.NEXT_MAX);
  assert.equal(gate.loginTarget(long), '/login');
  const fits = '/music?x=' + 'a'.repeat(gate.NEXT_MAX - 30);
  assert.ok(gate.loginTarget(fits).startsWith('/login?next=%2Fmusic'));
});

test('v1.352 W1: a session 15+ days old is re-issued with a fresh 30 days; a younger one is not', () => {
  const secret = authCrypto.generateSecret();
  const DAY = 86400;
  let now = 1_800_000_000;
  const user = { id: 5, username: 'dean', tokenVersion: 3, disabled: false };
  const g = gate.createAuthGate({ store: fakeStore({ count: 1, user }), secret, cookieName: 'c', nowSeconds: () => now });
  const issuedAt = now;
  const tok = authCrypto.signSession({ uid: 5, tv: 3 }, secret, { nowSeconds: issuedAt });
  const hit = (accept) => { const res = fakeRes(); let ok = false; g(fakeReq({ path: '/api/remote/state', accept, cookie: 'c=' + encodeURIComponent(tok) }), res, () => { ok = true; }); return { res, ok }; };
  now = issuedAt + 14 * DAY;
  const young = hit('application/json');
  assert.equal(young.ok, true);
  assert.equal(young.res._headers['set-cookie'], undefined, '14 days old: no Set-Cookie');
  now = issuedAt + 15 * DAY - 1;
  assert.equal(hit('application/json').res._headers['set-cookie'], undefined, 'one second short of half its life');
  now = issuedAt + 16 * DAY;
  const old = hit('application/json'); // an API call (a fetch, the speaker's state report, the SSE) renews too
  assert.equal(old.ok, true);
  const sc = old.res._headers['set-cookie'];
  assert.match(sc, /^c=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/, 'the login cookie: same name, flags and Max-Age');
  const fresh = authCrypto.verifySession(decodeURIComponent(/^c=([^;]+)/.exec(sc)[1]), secret, { nowSeconds: now });
  assert.deepEqual({ uid: fresh.uid, tv: fresh.tv, iat: fresh.iat, exp: fresh.exp }, { uid: 5, tv: 3, iat: now, exp: now + 30 * DAY });
  assert.equal(authCrypto.verifySession(decodeURIComponent(/^c=([^;]+)/.exec(sc)[1]), secret, { nowSeconds: now + 29 * DAY }) !== null, true, 'alive for 30 days from the renewal');
});

test('v1.352 W1: renewal never happens on a denied request (tv bumped, disabled, expired) and keeps the Secure flag', () => {
  const secret = authCrypto.generateSecret();
  const DAY = 86400;
  const t0 = 1_800_000_000;
  const now = t0 + 20 * DAY;
  const tok = authCrypto.signSession({ uid: 5, tv: 3 }, secret, { nowSeconds: t0 });
  const run = (user, token, extra) => {
    const g = gate.createAuthGate(Object.assign({ store: fakeStore({ count: 1, user }), secret, cookieName: 'c', nowSeconds: () => now }, extra || {}));
    const res = fakeRes(); let ok = false;
    const req = fakeReq({ path: '/api/x', accept: 'application/json', cookie: 'c=' + encodeURIComponent(token) });
    req.headers['x-forwarded-proto'] = 'https';
    g(req, res, () => { ok = true; });
    return { res, ok };
  };
  const bumped = run({ id: 5, tokenVersion: 4, disabled: false }, tok);
  assert.equal(bumped.ok, false); assert.equal(bumped.res._headers['set-cookie'], undefined, 'a bumped tv is denied, never renewed');
  const disabled = run({ id: 5, tokenVersion: 3, disabled: true }, tok);
  assert.equal(disabled.ok, false); assert.equal(disabled.res._headers['set-cookie'], undefined);
  const expiredTok = authCrypto.signSession({ uid: 5, tv: 3 }, secret, { nowSeconds: now - 31 * DAY });
  const expired = run({ id: 5, tokenVersion: 3, disabled: false }, expiredTok);
  assert.equal(expired.ok, false); assert.equal(expired.res._headers['set-cookie'], undefined, 'an expired token is denied');
  const secure = run({ id: 5, tokenVersion: 3, disabled: false }, tok, { trustProxy: true });
  assert.equal(secure.ok, true);
  assert.match(secure.res._headers['set-cookie'], /; Secure$/, 'behind a trusted https proxy the renewed cookie is Secure, like login');
});

test('v1.352 W1: the API-token path never mints a session cookie', () => {
  const g = gate.createAuthGate({ store: fakeStore({ count: 1, user: null }), secret: 's'.repeat(40), cookieName: 'c', apiToken: 'tok', nowSeconds: () => 1_900_000_000 });
  const res = fakeRes(); let ok = false;
  g({ method: 'POST', path: '/api/ytdlp/download', url: '/api/ytdlp/download', originalUrl: '/api/ytdlp/download', headers: { 'x-filetube-token': 'tok' } }, res, () => { ok = true; });
  assert.equal(ok, true);
  assert.equal(res._headers['set-cookie'], undefined);
});

test('v1.352 W1: sessionWantsRenewal is half the life, inclusive', () => {
  const ttl = 30 * 86400;
  assert.equal(gate.sessionWantsRenewal({ iat: 0 }, ttl / 2, ttl), true);
  assert.equal(gate.sessionWantsRenewal({ iat: 0 }, ttl / 2 - 1, ttl), false);
  assert.equal(gate.sessionWantsRenewal({ iat: 'x' }, ttl, ttl), false);
  assert.equal(gate.sessionWantsRenewal(null, ttl, ttl), false);
});

// ---- v1.352 gate r1 (adversary W2 = security S1, Dean's ruling): a 180-day ceiling on renewal ----

function legacyToken(payload, secret) { // a pre-v1.352 token: no oat field
  const crypto = require('node:crypto');
  const b = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return b + '.' + crypto.createHmac('sha256', secret).update(b).digest('base64url');
}

test('v1.352 gate r1: renewal carries the sign-in time (oat) and stops 180 days after it', () => {
  const secret = authCrypto.generateSecret();
  const DAY = 86400;
  const login = 1_800_000_000;
  let now = login;
  const user = { id: 5, tokenVersion: 3, disabled: false };
  const g = gate.createAuthGate({ store: fakeStore({ count: 1, user }), secret, cookieName: 'c', nowSeconds: () => now });
  const hit = (tok) => { const res = fakeRes(); let ok = false; g(fakeReq({ path: '/api/x', accept: 'application/json', cookie: 'c=' + encodeURIComponent(tok) }), res, () => { ok = true; }); const sc = res._headers['set-cookie']; return { ok, tok: sc ? decodeURIComponent(/^c=([^;]+)/.exec(sc)[1]) : null }; };
  let tok = authCrypto.signSession({ uid: 5, tv: 3 }, secret, { nowSeconds: login });
  assert.equal(authCrypto.verifySession(tok, secret, { nowSeconds: login }).oat, login, 'a login stamps oat = now');
  // renew every 16 days: oat never moves
  let renewals = 0;
  for (now = login + 16 * DAY; now - login < 180 * DAY; now += 16 * DAY) {
    const r = hit(tok);
    assert.equal(r.ok, true);
    if (r.tok) { renewals += 1; tok = r.tok; assert.equal(authCrypto.verifySession(tok, secret, { nowSeconds: now }).oat, login, 'oat carried, day ' + (now - login) / DAY); }
  }
  assert.ok(renewals >= 10, 'renewed on the way: ' + renewals);
  // now is past 180 days after the sign-in: still valid (its last renewal is < 30 days old), never renewed again
  const late = hit(tok);
  assert.equal(late.ok, true, 'the current cookie still works until its own expiry');
  assert.equal(late.tok, null, 'no renewal past the 180-day ceiling');
  now += 30 * DAY;
  assert.equal(hit(tok).ok, false, 'and then it expires: sign in again');
});

test('v1.352 gate r1: a pre-v1.352 token (no oat) uses its iat as the sign-in time; a bad oat is refused', () => {
  const secret = authCrypto.generateSecret();
  const DAY = 86400;
  const iat = 1_800_000_000;
  const legacy = legacyToken({ uid: 5, tv: 3, iat, exp: iat + 30 * DAY }, secret);
  const p = authCrypto.verifySession(legacy, secret, { nowSeconds: iat + 1 });
  assert.ok(p, 'an existing session is not logged out');
  assert.equal(p.oat, undefined);
  assert.equal(gate.sessionWantsRenewal(p, iat + 16 * DAY, 30 * DAY), true);
  // renewing it carries its iat forward as the sign-in time (never "now": that would restart the 180 days)
  const g = gate.createAuthGate({ store: fakeStore({ count: 1, user: { id: 5, tokenVersion: 3, disabled: false } }), secret, cookieName: 'c', nowSeconds: () => iat + 16 * DAY });
  const res = fakeRes();
  g(fakeReq({ path: '/api/x', accept: 'application/json', cookie: 'c=' + encodeURIComponent(legacy) }), res, () => {});
  const renewed = authCrypto.verifySession(decodeURIComponent(/^c=([^;]+)/.exec(res._headers['set-cookie'])[1]), secret, { nowSeconds: iat + 16 * DAY });
  assert.equal(renewed.oat, iat, 'a legacy session counts from its iat');
  assert.equal(gate.sessionWantsRenewal({ iat, oat: iat - 170 * DAY }, iat + 16 * DAY, 30 * DAY), false, '186 days after the password: no renewal');
  assert.equal(gate.sessionWantsRenewal({ iat, oat: iat - 160 * DAY }, iat + 16 * DAY, 30 * DAY), true, '176 days: still renews');
  assert.equal(authCrypto.verifySession(legacyToken({ uid: 5, tv: 3, iat, exp: iat + 30 * DAY, oat: 'x' }, secret), secret, { nowSeconds: iat + 1 }), null, 'a non-integer oat is a structural surprise');
  assert.throws(() => authCrypto.signSession({ uid: 5, tv: 3, oat: iat + 10 }, secret, { nowSeconds: iat }), /oat/);
  assert.equal(gate.SESSION_MAX_AGE_SECONDS, 180 * DAY);
});

test('v1.352 gate r1: the next cap is inclusive at exactly NEXT_MAX encoded chars', () => {
  const pad = (n) => '/m?x=' + 'a'.repeat(n - '%2Fm%3Fx%3D'.length);
  assert.equal(encodeURIComponent(pad(gate.NEXT_MAX)).length, gate.NEXT_MAX);
  assert.ok(gate.loginTarget(pad(gate.NEXT_MAX)).startsWith('/login?next='), 'exactly the cap: kept');
  assert.equal(gate.loginTarget(pad(gate.NEXT_MAX + 1)), '/login', 'one over: dropped');
});
