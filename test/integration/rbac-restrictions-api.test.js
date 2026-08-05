'use strict';

// [INTEGRATION] v1.80 RBAC T2 - the per-user restriction schema + store +
// admin management routes (GET/PUT /api/users/:id/restrictions). The v14
// user_restrictions table, the replace-all setter, validation, and admin-only
// gating. Isolated DATA_DIR; own process; cleans up (residual #110).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-restrictions-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, userStore, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, adminId;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  adminId = auth.user.id;
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const req = (method, p, body, cookie) => fetch(`${base}${p}`, {
  method,
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('T2: PUT replaces the set, GET reads it back, store round-trips', async () => {
  // Create a member to restrict.
  const created = await (await req('POST', '/api/users', { username: 'kid', password: 'password123', role: 'member' })).json();
  const kidId = created.user.id;

  const set = { restrictions: [
    { kind: 'path', value: '/media/Adult' },
    { kind: 'folder', value: 'ScaryChannel' },
    { kind: 'show', value: 'sub-abc' },
    { kind: 'library', value: 'podcasts' },
  ] };
  const put = await req('PUT', `/api/users/${kidId}/restrictions`, set);
  assert.strictEqual(put.status, 200);

  const got = await (await req('GET', `/api/users/${kidId}/restrictions`)).json();
  assert.strictEqual(got.restrictions.length, 4);
  // store-level round-trip
  const stored = userStore.getRestrictions(kidId);
  assert.deepStrictEqual(new Set(stored.map((r) => `${r.kind}:${r.value}`)),
    new Set(['path:/media/Adult', 'folder:ScaryChannel', 'show:sub-abc', 'library:podcasts']));

  // Replace-all: a second PUT with fewer rows drops the rest.
  await req('PUT', `/api/users/${kidId}/restrictions`, { restrictions: [{ kind: 'library', value: 'music' }] });
  assert.deepStrictEqual(userStore.getRestrictions(kidId), [{ kind: 'library', value: 'music' }]);
});

test('T2: validation - bad kind / value / library -> 400', async () => {
  const created = await (await req('POST', '/api/users', { username: 'kid2', password: 'password123', role: 'member' })).json();
  const id = created.user.id;
  assert.strictEqual((await req('PUT', `/api/users/${id}/restrictions`, { restrictions: 'nope' })).status, 400);
  assert.strictEqual((await req('PUT', `/api/users/${id}/restrictions`, { restrictions: [{ kind: 'evil', value: 'x' }] })).status, 400);
  assert.strictEqual((await req('PUT', `/api/users/${id}/restrictions`, { restrictions: [{ kind: 'path', value: '' }] })).status, 400);
  assert.strictEqual((await req('PUT', `/api/users/${id}/restrictions`, { restrictions: [{ kind: 'library', value: 'games' }] })).status, 400);
  assert.strictEqual((await req('PUT', `/api/users/${id}/restrictions`, { restrictions: [{ kind: 'path', value: 'x'.repeat(5000) }] })).status, 400);
  // a __proto__ value is accepted as inert data (it's a value, never a key)
  assert.strictEqual((await req('PUT', `/api/users/${id}/restrictions`, { restrictions: [{ kind: 'folder', value: '__proto__' }] })).status, 200);
  assert.strictEqual(({}).polluted, undefined);
});

test('T2: mode round-trips (blocklist default / allowlist) and validates', async () => {
  const created = await (await req('POST', '/api/users', { username: 'kid3', password: 'password123', role: 'member' })).json();
  const id = created.user.id;

  // default: no mode field -> blocklist
  await req('PUT', `/api/users/${id}/restrictions`, { restrictions: [{ kind: 'path', value: '/x' }] });
  let got = await (await req('GET', `/api/users/${id}/restrictions`)).json();
  assert.strictEqual(got.mode, 'blocklist');
  assert.deepStrictEqual(got.restrictions, [{ kind: 'path', value: '/x' }], 'the mode row is not surfaced as a unit');

  // allowlist round-trips
  const put = await (await req('PUT', `/api/users/${id}/restrictions`, { mode: 'allowlist', restrictions: [{ kind: 'path', value: '/kids' }] })).json();
  assert.strictEqual(put.mode, 'allowlist');
  got = await (await req('GET', `/api/users/${id}/restrictions`)).json();
  assert.strictEqual(got.mode, 'allowlist');
  assert.deepStrictEqual(got.restrictions, [{ kind: 'path', value: '/kids' }]);

  // an invalid mode is rejected
  assert.strictEqual((await req('PUT', `/api/users/${id}/restrictions`, { mode: 'wideopen', restrictions: [] })).status, 400);
});

test('T2: the routes are ADMIN-ONLY - a member is 403', async () => {
  const member = __mintTestSession({ username: 'plainmember', role: 'member' });
  assert.strictEqual((await req('GET', `/api/users/${adminId}/restrictions`, undefined, member.cookie)).status, 403);
  assert.strictEqual((await req('PUT', `/api/users/${adminId}/restrictions`, { restrictions: [] }, member.cookie)).status, 403);
});
