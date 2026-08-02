'use strict';

// [INTEGRATION] v1.66 - the push subscription routes against the real app:
// the three-way feature gate, subscribe's SSRF/shape refusal matrix, the
// per-user cap, cursor-at-head initialization, owner-scoped unsubscribe,
// and the pushEnabled mirror on /api/me/settings.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pushapi-'));
delete process.env.FILETUBE_YTDLP_ENABLED;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  app, updateDatabase, userStore,
  __resetDatabaseForTests, __setPushGuardLookupForTests, __mintTestSession,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const ytStore = require('../../lib/ytdlp/store');
const { publicKeyToUncompressedB64url } = require('../../lib/push/keys');

let server;
let base;
let auth;

const ua = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const GOOD_P256DH = publicKeyToUncompressedB64url(ua.publicKey.export({ format: 'jwk' }));
const GOOD_AUTH = crypto.randomBytes(16).toString('base64url');

function goodBody(endpoint) {
  return { endpoint, keys: { p256dh: GOOD_P256DH, auth: GOOD_AUTH } };
}

async function json(method, urlPath, body, extra = {}) {
  return fetch(`${base}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...extra,
  });
}

// The feature gate needs yt-dlp on + >=1 subscription; env set BEFORE any
// route reads config.
before(async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pushapi-dl-'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  // Resolve fixture endpoints to a public address so guardHop's DNS check
  // exercises real logic (refusals are tested with a private resolver below).
  __setPushGuardLookupForTests((host, opts, cb) => cb(null, [{ address: '203.0.113.9', family: 4 }]));
});

after(async () => {
  __setPushGuardLookupForTests(null);
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await __resetDatabaseForTests();
  await updateDatabase((db) => {
    const ns = ytStore.ensureYtdlp(db);
    ns.subscriptions.push({ id: 'sub1', channelUrl: 'https://www.youtube.com/@x', name: 'X', paused: false });
  });
});

test('feature gate: all three routes 404 when notifications are disabled (settings toggle)', async () => {
  await updateDatabase((db) => { db.settings = { ...(db.settings || {}), notificationsEnabled: false }; });
  assert.equal((await json('GET', '/api/push/key')).status, 404);
  assert.equal((await json('POST', '/api/push/subscribe', goodBody('https://push.example/wp/x'))).status, 404);
  assert.equal((await json('POST', '/api/push/unsubscribe', { endpoint: 'https://push.example/wp/x' })).status, 404);
});

test('GET /api/push/key returns the uncompressed VAPID public point', async () => {
  const res = await json('GET', '/api/push/key');
  assert.equal(res.status, 200);
  const { key } = await res.json();
  const point = Buffer.from(key, 'base64url');
  assert.equal(point.length, 65);
  assert.equal(point[0], 0x04);
});

test('subscribe: happy path lands with the cursor AT THE FEED HEAD (no back-flood)', async () => {
  userStore.recordNotifications([
    { mediaId: 'öld-1', createdAt: Date.now() - 5000 },
    { mediaId: 'öld-2', createdAt: Date.now() - 4000 },
  ]);
  const head = userStore.getMaxNotificationId();
  assert.ok(head >= 2, 'precondition: feed has rows');
  const res = await json('POST', '/api/push/subscribe', goodBody('https://push.example/wp/HappyPath'));
  assert.equal(res.status, 200);
  const row = userStore.getPushSubscription('https://push.example/wp/HappyPath');
  assert.ok(row);
  assert.equal(row.lastPushedId, head, 'a fresh device never receives history');
  assert.equal(row.userId, auth.user.id);
});

test('subscribe refusal matrix: http endpoint, oversize, garbage keys, missing body - all 400, nothing lands', async () => {
  const cases = [
    ['http (cleartext capability URL)', goodBody('http://push.example/wp/x')],
    ['unparseable', goodBody('https://')],
    ['oversize endpoint', goodBody(`https://push.example/${'x'.repeat(2048)}`)],
    ['p256dh not a point', { endpoint: 'https://push.example/wp/x', keys: { p256dh: 'AAAA', auth: GOOD_AUTH } }],
    ['auth wrong size', { endpoint: 'https://push.example/wp/x', keys: { p256dh: GOOD_P256DH, auth: 'AAAA' } }],
    ['no keys', { endpoint: 'https://push.example/wp/x' }],
    ['no body', undefined],
    // QA W1: String(['abc']) === 'abc', so an ARRAY-wrapped key used to pass
    // the route's coercing check and then throw inside the store. In an
    // async Express 4 handler an uncaught throw is not a 500 - it is a
    // socket that never answers. Measured hanging before the fix.
    ['array-wrapped p256dh', { endpoint: 'https://push.example/wp/x', keys: { p256dh: [GOOD_P256DH], auth: GOOD_AUTH } }],
    ['array-wrapped auth', { endpoint: 'https://push.example/wp/x', keys: { p256dh: GOOD_P256DH, auth: [GOOD_AUTH] } }],
    ['object-wrapped keys', { endpoint: 'https://push.example/wp/x', keys: { p256dh: { toString: 1 }, auth: GOOD_AUTH } }],
    ['numeric keys', { endpoint: 'https://push.example/wp/x', keys: { p256dh: 42, auth: 42 } }],
  ];
  for (const [label, body] of cases) {
    // A hang is the failure this binds, so every probe is deadlined: an
    // unanswered socket must fail the test, not stall the suite.
    const res = await Promise.race([
      json('POST', '/api/push/subscribe', body),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}: NO RESPONSE (handler hung)`)), 5000)),
    ]);
    assert.equal(res.status, 400, `${label} refused`);
  }
  assert.equal(userStore.countPushSubscriptions(auth.user.id), 0, 'nothing landed');
});

test('subscribe SSRF: an endpoint resolving to a private address is refused by the DNS guard', async () => {
  __setPushGuardLookupForTests((host, opts, cb) => cb(null, [{ address: '10.0.0.7', family: 4 }]));
  try {
    const res = await json('POST', '/api/push/subscribe', goodBody('https://innocent-looking.example/wp/x'));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'endpoint refused');
    // Literal-IP forms never even reach DNS.
    for (const ep of ['https://127.0.0.1/wp/x', 'https://[::1]/wp/x', 'https://0x7f000001/wp/x', 'https://192.168.1.10/wp/x']) {
      assert.equal((await json('POST', '/api/push/subscribe', goodBody(ep))).status, 400, `${ep} refused`);
    }
    assert.equal(userStore.countPushSubscriptions(auth.user.id), 0);
  } finally {
    __setPushGuardLookupForTests((host, opts, cb) => cb(null, [{ address: '203.0.113.9', family: 4 }]));
  }
});

test('per-user cap: the 11th DISTINCT endpoint is 409; re-registering an existing one stays free', async () => {
  for (let i = 0; i < 10; i++) {
    const res = await json('POST', '/api/push/subscribe', goodBody(`https://push.example/wp/dev-${i}`));
    assert.equal(res.status, 200);
  }
  assert.equal((await json('POST', '/api/push/subscribe', goodBody('https://push.example/wp/dev-10'))).status, 409);
  assert.equal((await json('POST', '/api/push/subscribe', goodBody('https://push.example/wp/dev-3'))).status, 200, 're-subscribe of an existing endpoint is not a new slot');
  assert.equal(userStore.countPushSubscriptions(auth.user.id), 10);
});

test('unsubscribe is owner-scoped: another user gets removed:false and the row survives', async () => {
  const EP = 'https://push.example/wp/Owned';
  assert.equal((await json('POST', '/api/push/subscribe', goodBody(EP))).status, 200);
  const other = __mintTestSession({ username: 'otheruser', role: 'member' });
  const res = await fetch(`${base}/api/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: other.cookie },
    body: JSON.stringify({ endpoint: EP }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).removed, false, 'no cross-user delete, no existence confirmation');
  assert.ok(userStore.getPushSubscription(EP), 'row survives');
  const own = await json('POST', '/api/push/unsubscribe', { endpoint: EP });
  assert.equal((await own.json()).removed, true);
  assert.equal(userStore.getPushSubscription(EP), null);
});

test('pushEnabled rides the /api/me/settings mirror: on/off accepted, junk bounded, absent = on', async () => {
  assert.equal((await json('POST', '/api/me/settings', { pushEnabled: 'off' })).status, 200);
  let me = await (await json('GET', '/api/auth/me')).json();
  assert.equal(me.settings.pushEnabled, 'off');
  assert.equal((await json('POST', '/api/me/settings', { pushEnabled: 'on' })).status, 200);
  me = await (await json('GET', '/api/auth/me')).json();
  assert.equal(me.settings.pushEnabled, 'on');
  assert.equal((await json('POST', '/api/me/settings', { pushEnabled: 'x'.repeat(40) })).status, 400, 'bounded like its siblings');
  assert.equal((await json('POST', '/api/me/settings', { pushEnabled: null })).status, 200, 'null clears (back to default-on)');
  me = await (await json('GET', '/api/auth/me')).json();
  assert.equal(me.settings.pushEnabled, undefined);
});

test('unauthenticated requests never reach the push routes (the gate, not the handler, answers)', async () => {
  const res = await fetch(`${base}/api/push/key`, { headers: { Cookie: 'nope=1' } });
  assert.equal(res.status, 401);
  const sub = await fetch(`${base}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'nope=1' },
    body: JSON.stringify(goodBody('https://push.example/wp/x')),
  });
  assert.equal(sub.status, 401);
});
