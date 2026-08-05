'use strict';

// [INTEGRATION] v1.84 Modern YouTube Mode - the per-user `modernMode` setting
// (T1). Like homeFeed it is a MIRRORED per-user setting ('on'/'off',
// /api/me/settings), NOT global. UNLIKE homeFeed it is NOT seeded onto net-new
// accounts (Dean's default: modern stays opt-in; existing feed default is
// unchanged). Binds:
//   - round-trip through the allowlist + value regex (on/off/null/reject);
//   - a net-new account (POST /api/users) is NOT seeded modernMode (only the
//     v1.79 homeFeed:'on'), proving NEW_USER_DEFAULT_SETTINGS was left alone;
//   - CROSS-USER isolation: one user's modernMode never leaks onto another
//     (the actor-vacuity scar - two DISTINCT users, not user 1 alone).
// Isolated DATA_DIR; own process; cleans up after itself (residual #110).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-modernmode-setting-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, userStore, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const post = (p, body, cookie) => fetch(`${base}${p}`, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: JSON.stringify(body),
});
const me = (cookie) => fetch(`${base}/api/auth/me`, cookie ? { headers: { Cookie: cookie } } : {}).then((r) => r.json());

test('T1: modernMode round-trips through /api/me/settings and is regex-bounded', async () => {
  let r = await post('/api/me/settings', { modernMode: 'on' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await me()).settings.modernMode, 'on');

  r = await post('/api/me/settings', { modernMode: 'off' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await me()).settings.modernMode, 'off');

  r = await post('/api/me/settings', { modernMode: null }); // clear -> absent
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await me()).settings.modernMode, undefined);

  r = await post('/api/me/settings', { modernMode: 'yes please!!' }); // regex reject
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await me()).settings.modernMode, undefined);
});

test('T1: a net-new account is NOT seeded modernMode (only the v1.79 homeFeed default)', async () => {
  const r = await post('/api/users', { username: 'freshy', password: 'password123', role: 'member' });
  const payload = await r.json();
  assert.strictEqual(r.status, 201, JSON.stringify(payload));
  const stored = userStore.getById(payload.user.id);
  const seeded = JSON.parse(stored.settingsJson || '{}');
  assert.strictEqual(seeded.modernMode, undefined, 'modern stays opt-in - NEW_USER_DEFAULT_SETTINGS untouched');
  assert.strictEqual(seeded.homeFeed, 'on', 'the v1.79 feed default is still there');
});

test('T1: modernMode is per-user - one user setting it never leaks onto another', async () => {
  // Two DISTINCT users (the actor-vacuity scar: never assert isolation with
  // user 1 alone). userA is the default authenticated actor; userB a separate
  // minted session.
  const userB = __mintTestSession({ username: 'kidAccount' });

  // userA turns modern ON; userB does nothing.
  const rA = await post('/api/me/settings', { modernMode: 'on' });
  assert.strictEqual(rA.status, 200);

  assert.strictEqual((await me()).settings.modernMode, 'on', 'userA sees their own on');
  assert.strictEqual((await me(userB.cookie)).settings.modernMode, undefined, 'userB is untouched');

  // userB turns it OFF explicitly; userA still ON.
  const rB = await post('/api/me/settings', { modernMode: 'off' }, userB.cookie);
  assert.strictEqual(rB.status, 200);
  assert.strictEqual((await me(userB.cookie)).settings.modernMode, 'off', 'userB now off');
  assert.strictEqual((await me()).settings.modernMode, 'on', 'userA unchanged by userB');
});
