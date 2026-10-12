'use strict';

// [UNIT] v1.387.0 offline playback, plan D1 - the gate's per-device token branch
// (lib/auth/gate.js createAuthGate + lib/auth/device-scope.js), driven through
// fake req/res against a fake device store so every arm of the decision table
// is bound on its own: claimed only for `Bearer ftd_...`; an unknown ftd_ never
// falls through to the cookie; a non-ftd_ Bearer does; a live token sets
// req.user / authVia / deviceId and is tracked; epoch mismatch, disabled,
// missing user and 180-day expiry are 401 deviceRevoked (expiry prunes); a
// route outside the scope is 403; last_used_at is stamped at most once per 10
// minutes; the unknown-hash limiter 429s after 30 in 10 minutes and never
// blocks a valid token.

const { test } = require('node:test');
const assert = require('node:assert');
const gate = require('../../lib/auth/gate');
const authCrypto = require('../../lib/auth/crypto');
const scope = require('../../lib/auth/device-scope');
const devicesLib = require('../../lib/auth/devices');

const NOW = 1_800_000_000; // seconds
const DAY = 24 * 60 * 60;

function fakeReq({ method = 'GET', path = '/api/auth/me', authorization, cookie, accept = 'application/json', ip = '10.0.0.7', xff } = {}) {
  const headers = { accept };
  if (authorization !== undefined) headers.authorization = authorization;
  if (cookie) headers.cookie = cookie;
  if (xff) headers['x-forwarded-for'] = xff;
  return { method, path, url: path, originalUrl: path, headers, socket: { remoteAddress: ip } };
}
function fakeRes() {
  const { EventEmitter } = require('node:events');
  const res = new EventEmitter();
  Object.assign(res, {
    _status: 200, _json: null, _redirect: null, _headers: {},
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
    redirect(c, to) { this._redirect = { code: c, to }; return this; },
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
  });
  return res;
}

// A fake device store: rows by token; records touch / prune / track calls.
function fakeDevices(rows) {
  const byToken = new Map(Object.entries(rows));
  const f = {
    LAST_USED_WRITE_INTERVAL_MS: devicesLib.LAST_USED_WRITE_INTERVAL_MS,
    isDeviceToken: devicesLib.isDeviceToken,
    isExpired: devicesLib.isExpired,
    touches: [], pruned: [], tracked: [], lookups: 0,
    revoked: new Set(), // tokens whose ROW is gone but which the store remembers (removed / Remove all / expired / pruned)
    wasRevokedRecently(token) { return f.revoked.has(token); },
    lookup(token) { f.lookups += 1; return byToken.get(token) || null; },
    touch(id, iso) { f.touches.push([id, iso]); },
    prune(id) { f.pruned.push(id); },
    track(deviceId, userId, res) { f.tracked.push([deviceId, userId, res]); },
  };
  return f;
}
const USER = { id: 5, username: 'kid', role: 'member', tokenVersion: 0, deviceEpoch: 2, disabled: false };
const ISO_NOW = new Date(NOW * 1000).toISOString();
const LIVE = { id: 11, userId: 5, epoch: 2, createdAt: new Date((NOW - 10 * DAY) * 1000).toISOString(), lastUsedAt: null, tokenHash: 'h' };

function build({ user = USER, rows = { ftd_live: LIVE }, now = NOW, limiter } = {}) {
  const devices = fakeDevices(rows);
  const store = { countUsers: () => 1, getById: (id) => (user && id === user.id ? user : null) };
  const g = gate.createAuthGate({ store, secret: 's'.repeat(40), cookieName: 'c', nowSeconds: () => now, devices, unknownTokenLimiter: limiter });
  return { g, devices, store };
}
function run(g, reqOpts) {
  const req = fakeReq(reqOpts);
  const res = fakeRes();
  let nexted = false;
  g(req, res, () => { nexted = true; });
  return { req, res, nexted };
}

test('scope: the allowlist admits exactly its routes (GET and HEAD), params are one segment, the query never matters, everything else is refused', () => {
  for (const e of scope.DEVICE_SCOPE) {
    const [m, p] = e.split(' ');
    const sample = p.replace(/:[A-Za-z]+/g, 'abc123');
    assert.strictEqual(scope.deviceScopeAllows(m, sample), true, e);
    if (m === 'GET') assert.strictEqual(scope.deviceScopeAllows('HEAD', sample), true, 'HEAD ' + p);
    assert.strictEqual(scope.deviceScopeAllows('POST', sample), m === 'POST', 'POST ' + p);
  }
  assert.strictEqual(scope.deviceScopeAllows('GET', '/track/a/b'), false, 'a param is ONE segment');
  assert.strictEqual(scope.deviceScopeAllows('GET', '/track/'), false, 'a param is non-empty');
  assert.strictEqual(scope.deviceScopeAllows('GET', '/track'), false);
  assert.strictEqual(scope.deviceScopeAllows('GET', '/trackx/1'), false);
  for (const p of ['/api/devices', '/api/users', '/api/videos', '/api/config', '/', '/setup.html', '/js/main.js', '/api/admin/backup', '/api/progress/x', '/api/music', '/api/prefs']) {
    assert.strictEqual(scope.deviceScopeAllows('GET', p), false, 'refused: ' + p);
  }
  assert.strictEqual(scope.deviceScopeAllows('DELETE', '/api/devices/1'), false);
  assert.strictEqual(scope.deviceScopeAllows('POST', '/api/devices'), false, 'a token never mints a token');
  assert.strictEqual(scope.deviceScopeAllows(undefined, '/api/auth/me'), false);
});

test('a live token sets req.user, authVia and deviceId, is tracked for live revocation, and never touches the cookie path', () => {
  const { g, devices } = build();
  const { req, res, nexted } = run(g, { authorization: 'Bearer ftd_live' });
  assert.strictEqual(nexted, true);
  assert.strictEqual(req.user, USER);
  assert.strictEqual(req.authVia, 'device');
  assert.strictEqual(req.deviceId, 11);
  assert.strictEqual(res._headers['set-cookie'], undefined, 'no session cookie is ever minted for a device');
  assert.deepStrictEqual(devices.tracked.map(([d, u, r]) => [d, u, r === res]), [[11, 5, true]]);
  // HEAD on a scoped GET route passes too; the Bearer scheme is case-insensitive and tolerates spaces.
  assert.strictEqual(run(g, { method: 'HEAD', path: '/video/abc', authorization: '  bearer   ftd_live  ' }).nexted, true);
  // The scope reads req.path (Express strips the query), so ?download=1 on a scoped route is the same route.
  const q = fakeReq({ path: '/video/abc', authorization: 'Bearer ftd_live' });
  q.url = '/video/abc?download=1'; q.originalUrl = q.url;
  let qn = false; g(q, fakeRes(), () => { qn = true; });
  assert.strictEqual(qn, true);
});

test('an unknown ftd_ token is 401 deviceRevoked and NEVER falls through to a valid cookie; a non-ftd_ Bearer falls through untouched', () => {
  const secret = 's'.repeat(40);
  const user = { ...USER, tokenVersion: 0 };
  const devices = fakeDevices({ ftd_live: LIVE });
  const store = { countUsers: () => 1, getById: () => user };
  const g = gate.createAuthGate({ store, secret, cookieName: 'c', nowSeconds: () => NOW, devices });
  const cookie = 'c=' + encodeURIComponent(authCrypto.signSession({ uid: 5, tv: 0 }, secret, { nowSeconds: NOW }));
  // Garbage ftd_ WITH a valid cookie: 401, the cookie is not consulted.
  const bad = run(g, { authorization: 'Bearer ftd_garbage', cookie });
  assert.strictEqual(bad.nexted, false);
  assert.strictEqual(bad.res._status, 401);
  assert.deepStrictEqual(bad.res._json, { error: 'device token revoked', deviceRevoked: true });
  assert.strictEqual(bad.req.user, undefined);
  // A page request with a bad ftd_ is a 401 JSON too, never a login redirect (the app reads the JSON).
  const page = run(g, { authorization: 'Bearer ftd_garbage', cookie, accept: 'text/html', path: '/' });
  assert.strictEqual(page.res._status, 401);
  assert.strictEqual(page.res._redirect, null);
  // A non-ftd_ Bearer (an auth proxy's own) falls through: the cookie authenticates.
  const proxy = run(g, { authorization: 'Bearer eyJhbGciOi.proxy.token', cookie });
  assert.strictEqual(proxy.nexted, true);
  assert.strictEqual(proxy.req.user, user);
  assert.strictEqual(proxy.req.authVia, undefined);
  assert.strictEqual(devices.lookups, 2, 'the proxy token was never looked up');
  // Other schemes and a bare ftd_ without Bearer fall through too.
  assert.strictEqual(run(g, { authorization: 'Basic ZnRkXzpmdGRf', cookie }).nexted, true);
  assert.strictEqual(run(g, { authorization: 'ftd_live', cookie }).nexted, true, 'no scheme: not claimed');
  assert.strictEqual(run(g, { authorization: 'Bearer ftd_live extra', cookie }).nexted, true, 'two tokens: not a Bearer value, not claimed');
  // No cookie and a non-ftd_ Bearer: the normal 401.
  const none = run(g, { authorization: 'Bearer other' });
  assert.strictEqual(none.res._status, 401);
  assert.deepStrictEqual(none.res._json, { error: 'authentication required', authRequired: true });
});

test('revocation: epoch mismatch, a disabled user, a missing user and 180 days unused are each 401 deviceRevoked; expiry prunes the row', () => {
  const stale = { ...LIVE, epoch: 1 };
  let r = run(build({ rows: { ftd_t: stale } }).g, { authorization: 'Bearer ftd_t' });
  assert.strictEqual(r.res._status, 401);
  assert.deepStrictEqual(r.res._json, { error: 'device token revoked', deviceRevoked: true });
  assert.strictEqual(r.req.user, undefined);

  r = run(build({ user: { ...USER, disabled: true } }).g, { authorization: 'Bearer ftd_live' });
  assert.strictEqual(r.res._status, 401, 'disabled');
  assert.strictEqual(r.res._json.deviceRevoked, true);

  r = run(build({ user: null }).g, { authorization: 'Bearer ftd_live' });
  assert.strictEqual(r.res._status, 401, 'user deleted');

  const old = { ...LIVE, createdAt: new Date((NOW - 181 * DAY) * 1000).toISOString(), lastUsedAt: null };
  const b = build({ rows: { ftd_old: old } });
  r = run(b.g, { authorization: 'Bearer ftd_old' });
  assert.strictEqual(r.res._status, 401, 'expired');
  assert.deepStrictEqual(b.devices.pruned, [11], 'the dead row is pruned');
  assert.deepStrictEqual(b.devices.tracked, []);
  // A use within 180 days keeps it alive: last_used_at slides.
  const used = { ...old, lastUsedAt: new Date((NOW - 179 * DAY) * 1000).toISOString() };
  r = run(build({ rows: { ftd_used: used } }).g, { authorization: 'Bearer ftd_used' });
  assert.strictEqual(r.nexted, true);
});

test('scope: a VALID token on a route outside the allowlist is 403 (not 401, not through), with no req.user and no tracking', () => {
  const { g, devices } = build();
  for (const [method, path] of [['GET', '/api/devices'], ['POST', '/api/devices'], ['GET', '/api/videos'], ['POST', '/api/progress'], ['GET', '/'], ['DELETE', '/api/videos/x'], ['GET', '/js/main.js'], ['GET', '/login']]) {
    const r = run(g, { method, path, authorization: 'Bearer ftd_live' });
    assert.strictEqual(r.nexted, false, method + ' ' + path);
    assert.strictEqual(r.res._status, 403, method + ' ' + path);
    assert.deepStrictEqual(r.res._json, { error: 'not available to devices' });
    assert.strictEqual(r.req.user, undefined);
  }
  assert.deepStrictEqual(devices.tracked, []);
  // An INVALID token on an out-of-scope route is 401 first (validity before scope: a revoked phone learns it is revoked).
  const r = run(g, { method: 'POST', path: '/api/devices', authorization: 'Bearer ftd_nope' });
  assert.strictEqual(r.res._status, 401);
});

test('last_used_at is written on the first request and then at most once per 10 minutes per device', () => {
  let now = NOW;
  const devices = fakeDevices({ ftd_live: LIVE, ftd_two: { ...LIVE, id: 12 } });
  const store = { countUsers: () => 1, getById: () => USER };
  const g = gate.createAuthGate({ store, secret: 's'.repeat(40), cookieName: 'c', nowSeconds: () => now, devices });
  for (let i = 0; i < 50; i++) run(g, { authorization: 'Bearer ftd_live', path: '/video/x' });
  assert.deepStrictEqual(devices.touches, [[11, ISO_NOW]], '50 range reads, one stamp');
  now = NOW + 9 * 60 + 59;
  run(g, { authorization: 'Bearer ftd_live' });
  assert.strictEqual(devices.touches.length, 1, 'inside the window: no write');
  now = NOW + 10 * 60;
  run(g, { authorization: 'Bearer ftd_live' });
  assert.strictEqual(devices.touches.length, 2, 'at 10 minutes: one more');
  run(g, { authorization: 'Bearer ftd_two' });
  assert.deepStrictEqual(devices.touches[2][0], 12, 'another device has its own stamp');
});

test('unknown-hash limiter: 30 unknown ftd_ hashes from one ip in 10 minutes are each 401; the 31st is 429 for 10 minutes; a VALID token is always let through; a revoked token is not counted', () => {
  let now = NOW;
  const limiter = gate.createUnknownTokenLimiter({ nowMs: () => now * 1000 });
  const stale = { ...LIVE, id: 13, epoch: 1 };
  const { g, devices } = build({ rows: { ftd_live: LIVE, ftd_stale: stale }, limiter });
  devices.revoked.add('ftd_removed'); // its row was deleted in Settings; the store remembers the hash
  // BINDING (gate r1 adversary W3a / security-brief W1): 40 presentations each of an epoch-revoked token (a known row) and
  // of a REMOVED token (no row, remembered) are all 401 deviceRevoked and count for NOTHING, so the 30 unknowns below are
  // still each 401 and only the 31st unknown is blocked. Counting either would 429 the removed phone's queued range
  // requests - and a second phone behind the same proxy ip - instead of the 401 the app re-pairs on.
  for (let i = 0; i < 40; i++) {
    const s = run(g, { authorization: 'Bearer ftd_stale' });
    assert.strictEqual(s.res._status, 401, 'epoch-stale #' + (i + 1)); assert.deepStrictEqual(s.res._json, { error: 'device token revoked', deviceRevoked: true });
    const d = run(g, { authorization: 'Bearer ftd_removed' });
    assert.strictEqual(d.res._status, 401, 'removed #' + (i + 1)); assert.deepStrictEqual(d.res._json, { error: 'device token revoked', deviceRevoked: true });
  }
  for (let i = 0; i < 30; i++) {
    const r = run(g, { authorization: 'Bearer ftd_unknown' + i });
    assert.strictEqual(r.res._status, 401, 'unknown #' + (i + 1));
  }
  // A revoked (known) token in the middle is 401 and does NOT count.
  assert.strictEqual(run(g, { authorization: 'Bearer ftd_stale' }).res._status, 401);
  const blocked = run(g, { authorization: 'Bearer ftd_unknown30' });
  assert.strictEqual(blocked.res._status, 429, 'the 31st unknown from this ip');
  assert.strictEqual(blocked.res._headers['retry-after'], '600');
  assert.deepStrictEqual(blocked.res._json, { error: 'too many attempts', retryAfterSec: 600 });
  // The valid token still passes from the blocked ip.
  assert.strictEqual(run(g, { authorization: 'Bearer ftd_live' }).nexted, true, 'a valid token is never blocked');
  // Another ip is unaffected.
  assert.strictEqual(run(g, { authorization: 'Bearer ftd_x', ip: '10.0.0.8' }).res._status, 401);
  // 10 minutes later the block lifts.
  now = NOW + 10 * 60 + 1;
  assert.strictEqual(run(g, { authorization: 'Bearer ftd_x' }).res._status, 401);
});

test('unknown-hash limiter: the ip is the socket unless trustProxy, when the first X-Forwarded-For hop is used; the limiter fails open', () => {
  const l1 = gate.createUnknownTokenLimiter({ max: 2, nowMs: () => 0 });
  assert.deepStrictEqual(l1.recordUnknown('a'), { blocked: false, retryAfterSec: 0 });
  assert.deepStrictEqual(l1.recordUnknown('a'), { blocked: false, retryAfterSec: 0 });
  assert.deepStrictEqual(l1.recordUnknown('a'), { blocked: true, retryAfterSec: 600 }, 'the third from a is blocked');
  assert.deepStrictEqual(l1.check('a'), { blocked: true, retryAfterSec: 600 });
  assert.deepStrictEqual(l1.check('b'), { blocked: false, retryAfterSec: 0 });
  // Window expiry resets the count.
  let t = 0;
  const l2 = gate.createUnknownTokenLimiter({ max: 2, windowMs: 1000, blockMs: 1000, nowMs: () => t });
  l2.recordUnknown('a'); l2.recordUnknown('a');
  t = 1001;
  assert.strictEqual(l2.recordUnknown('a').blocked, false, 'a new window');
  // Fail open: a throwing clock blocks nothing.
  const l3 = gate.createUnknownTokenLimiter({ nowMs: () => { throw new Error('clock'); } });
  assert.deepStrictEqual(l3.recordUnknown('a'), { blocked: false, retryAfterSec: 0 });
  assert.deepStrictEqual(l3.check('a'), { blocked: false, retryAfterSec: 0 });
  // clientIp
  assert.strictEqual(gate.clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: { remoteAddress: '9.9.9.9' } }, false), '9.9.9.9');
  assert.strictEqual(gate.clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: { remoteAddress: '9.9.9.9' } }, true), '1.2.3.4');
  assert.strictEqual(gate.clientIp({ headers: {}, socket: {} }, true), 'unknown');
  // Through the gate with trustProxy: two phones behind one proxy ip share the bucket, so a valid one still passes while unknowns are blocked.
  let now = NOW;
  const limiter = gate.createUnknownTokenLimiter({ max: 1, nowMs: () => now * 1000 });
  const devices = fakeDevices({ ftd_live: LIVE });
  const store = { countUsers: () => 1, getById: () => USER };
  const g = gate.createAuthGate({ store, secret: 's'.repeat(40), cookieName: 'c', nowSeconds: () => now, devices, trustProxy: true, unknownTokenLimiter: limiter });
  assert.strictEqual(run(g, { authorization: 'Bearer ftd_a', xff: '203.0.113.5', ip: '127.0.0.1' }).res._status, 401);
  assert.strictEqual(run(g, { authorization: 'Bearer ftd_b', xff: '203.0.113.5', ip: '127.0.0.1' }).res._status, 429);
  assert.strictEqual(run(g, { authorization: 'Bearer ftd_c', xff: '203.0.113.6', ip: '127.0.0.1' }).res._status, 401, 'another forwarded ip');
  assert.strictEqual(run(g, { authorization: 'Bearer ftd_live', xff: '203.0.113.5', ip: '127.0.0.1' }).nexted, true);
});

test('a device store that throws on lookup fails CLOSED (401), never through to the cookie', () => {
  const secret = 's'.repeat(40);
  const devices = fakeDevices({});
  devices.lookup = () => { throw new Error('db gone'); };
  const store = { countUsers: () => 1, getById: () => USER };
  const g = gate.createAuthGate({ store, secret, cookieName: 'c', nowSeconds: () => NOW, devices });
  const cookie = 'c=' + encodeURIComponent(authCrypto.signSession({ uid: 5, tv: 0 }, secret, { nowSeconds: NOW }));
  const r = run(g, { authorization: 'Bearer ftd_live', cookie });
  assert.strictEqual(r.nexted, false);
  assert.strictEqual(r.res._status, 401);
});

test('without a device store (devices: null) the gate ignores every Authorization header exactly as before', () => {
  const secret = 's'.repeat(40);
  const store = { countUsers: () => 1, getById: () => USER };
  const g = gate.createAuthGate({ store, secret, cookieName: 'c', nowSeconds: () => NOW });
  const cookie = 'c=' + encodeURIComponent(authCrypto.signSession({ uid: 5, tv: 0 }, secret, { nowSeconds: NOW }));
  assert.strictEqual(run(g, { authorization: 'Bearer ftd_live', cookie }).nexted, true);
  assert.strictEqual(run(g, { authorization: 'Bearer ftd_live' }).res._status, 401);
});
