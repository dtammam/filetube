'use strict';

// [INTEGRATION] v1.79 home feed - the per-user `homeFeed` setting (AC8). It is
// a MIRRORED per-user setting ('on'/'off', /api/me/settings), NOT a global one:
//   - round-trips through the allowlist + value regex;
//   - a net-new account (created via POST /api/users, the product path) is
//     seeded 'on' so new setups get the feed out of the box;
//   - an existing user (the store's '{}' default, e.g. a freshly minted
//     session) has NO homeFeed key -> the client resolves that to classic, so
//     nobody's existing home changes silently.
// Isolated DATA_DIR; own process; cleans up after itself (residual #110).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-homefeed-setting-'));
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

test('AC8: homeFeed round-trips through /api/me/settings and is regex-bounded', async () => {
  // on
  let r = await post('/api/me/settings', { homeFeed: 'on' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await me()).settings.homeFeed, 'on');
  // off
  r = await post('/api/me/settings', { homeFeed: 'off' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await me()).settings.homeFeed, 'off');
  // clear (null) -> back to absent
  r = await post('/api/me/settings', { homeFeed: null });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await me()).settings.homeFeed, undefined);
  // a value the regex rejects -> 400, nothing persisted
  r = await post('/api/me/settings', { homeFeed: 'yes please!!' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await me()).settings.homeFeed, undefined);
});

test('AC8: a net-new account (POST /api/users) is seeded homeFeed=on', async () => {
  const r = await post('/api/users', { username: 'newbie', password: 'password123', role: 'member' });
  const payload = await r.json();
  assert.strictEqual(r.status, 201, JSON.stringify(payload));
  const created = payload.user;
  const stored = userStore.getById(created.id);
  assert.strictEqual(stored.settingsJson, JSON.stringify({ homeFeed: 'on' }), 'the product creation path seeds the feed on');
});

test('AC8: an existing user (freshly minted session, no seed) resolves to classic', async () => {
  // __mintTestSession deliberately does NOT seed - it stands in for an install
  // whose users predate v1.79 (settings_json === '{}').
  const other = __mintTestSession({ username: 'legacyUser' });
  const body = await me(other.cookie);
  assert.strictEqual(body.settings.homeFeed, undefined, 'no homeFeed key -> classic (existing installs unchanged)');
});
