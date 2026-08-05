'use strict';

// [INTEGRATION] v1.81 write-RBAC T2 - the admin management surface for the new
// canModifyLibrary capability + its exposure on /api/auth/me. Enforcement of the
// content-mutating routes is proven separately (rbac-write-enforcement.test.js);
// this file binds the grant/revoke route, strict-boolean coercion (AC8), and
// that the client can read the flag. Isolated DATA_DIR.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-modlib-flag-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, userStore, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, member;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin
  member = __mintTestSession({ username: 'kidmember', role: 'member' });
  // A minted member defaults canModifyLibrary:false (createUser default; the
  // mint only sets canManageSubscriptions). Confirm the baseline.
  assert.strictEqual(userStore.getById(member.user.id).canModifyLibrary, false);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const req = (method, p, cookie, body) => fetch(`${base}${p}`, {
  method,
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('T2: only an admin may set the modify-library flag; a member is 403', async () => {
  const s = (await req('POST', `/api/users/${member.user.id}/modify-library-flag`, member.cookie, { canModifyLibrary: true })).status;
  assert.strictEqual(s, 403, 'a member cannot grant themselves the capability (self-escalation blocked, W3)');
  assert.strictEqual(userStore.getById(member.user.id).canModifyLibrary, false, 'the row is unchanged after the refused call');
});

test('T2: admin grants then revokes; the response + row both reflect it', async () => {
  const grant = await req('POST', `/api/users/${member.user.id}/modify-library-flag`, undefined, { canModifyLibrary: true });
  assert.strictEqual(grant.status, 200);
  assert.strictEqual((await grant.json()).user.canModifyLibrary, true, 'response carries the granted flag');
  assert.strictEqual(userStore.getById(member.user.id).canModifyLibrary, true, 'row granted');

  const revoke = await req('POST', `/api/users/${member.user.id}/modify-library-flag`, undefined, { canModifyLibrary: false });
  assert.strictEqual((await revoke.json()).user.canModifyLibrary, false, 'response carries the revoked flag');
  assert.strictEqual(userStore.getById(member.user.id).canModifyLibrary, false, 'row revoked');
});

test('T2 (AC8): a non-boolean-true body value never grants the capability', async () => {
  for (const bad of ['true', 1, [], {}, 'yes']) {
    await req('POST', `/api/users/${member.user.id}/modify-library-flag`, undefined, { canModifyLibrary: bad });
    assert.strictEqual(userStore.getById(member.user.id).canModifyLibrary, false, `value ${JSON.stringify(bad)} must not grant`);
  }
});

test('T2: /api/auth/me carries canModifyLibrary so the client can hide affordances', async () => {
  const me = await (await req('GET', '/api/auth/me', member.cookie)).json();
  assert.strictEqual(me.user.canModifyLibrary, false, 'me exposes the (false) capability');
  userStore.setCanModifyLibrary(member.user.id, true);
  const me2 = await (await req('GET', '/api/auth/me', member.cookie)).json();
  assert.strictEqual(me2.user.canModifyLibrary, true, 'me reflects a grant (re-read per request)');
  userStore.setCanModifyLibrary(member.user.id, false);
});

test('T2: POST /api/users honors canModifyLibrary at create (strict boolean)', async () => {
  const yes = await (await req('POST', '/api/users', undefined, { username: 'trusted', password: 'a-good-password', role: 'member', canModifyLibrary: true })).json();
  assert.strictEqual(yes.user.canModifyLibrary, true, 'create-with-flag grants');
  const strval = await (await req('POST', '/api/users', undefined, { username: 'sneaky', password: 'a-good-password', role: 'member', canModifyLibrary: 'true' })).json();
  assert.strictEqual(strval.user.canModifyLibrary, false, 'a string "true" at create does not grant (AC8)');
  const absent = await (await req('POST', '/api/users', undefined, { username: 'plain', password: 'a-good-password', role: 'member' })).json();
  assert.strictEqual(absent.user.canModifyLibrary, false, 'absent defaults OFF');
});
