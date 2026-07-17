'use strict';

// [INTEGRATION] v1.43 chunk 4c -- admin user management + the per-user
// display-pref mirror, through the REAL gate end-to-end. Covers:
//
//   - every /api/users route is admin-only (a member gets 403, always)
//   - create: validation 400s, duplicate 409 (case-insensitive), member +
//     admin creation, subscriptions flag
//   - reset password: the target's sessions are revoked INSTANTLY (tv bump);
//     the new password signs in; resetting your OWN password reissues your
//     cookie so you are not bounced mid-task
//   - disable: revokes instantly, sign-in refused while disabled, enable
//     restores sign-in (old cookies stay dead -- tv bumped again)
//   - self-lockout guards: cannot disable or delete yourself; cannot
//     disable/demote/delete the LAST enabled admin
//   - delete: hard delete, per-user state cascades, the dead user's cookie
//     is invalid, the id is never reused
//   - /api/me/settings: allowlisted keys only, bounded values, per-user
//     isolation, null clears, /api/auth/me round-trips the mirror
//
// PROGRESS_FLUSH_MS is irrelevant here; no ffmpeg needed.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-usermgmt-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, userStore, AUTH_COOKIE_NAME } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
let admin; // the suite's authenticated admin (patched global fetch)

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  const auth = authenticateFetch(server, base);
  admin = auth.user;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

function json(method, urlPath, body, cookie) {
  return fetch(`${base}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Sign in with real credentials; returns the session cookie pair string.
async function login(username, password) {
  const res = await json('POST', '/api/auth/login', { username, password });
  assert.equal(res.status, 200, `login for ${username} should succeed`);
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes(AUTH_COOKIE_NAME));
  return setCookie.split(';')[0];
}

// ---- admin-only enforcement ------------------------------------------------

test('every /api/users route 403s for a member (server-enforced, not just hidden UI)', async () => {
  const created = await json('POST', '/api/users', { username: 'lowly', password: 'password123', role: 'member' });
  assert.equal(created.status, 201);
  const memberCookie = await login('lowly', 'password123');

  const probes = [
    ['GET', '/api/users', undefined],
    ['POST', '/api/users', { username: 'x1', password: 'password123' }],
    ['POST', `/api/users/${admin.id}/password`, { password: 'hijacked123' }],
    ['POST', `/api/users/${admin.id}/disabled`, { disabled: true }],
    ['POST', `/api/users/${admin.id}/role`, { role: 'member' }],
    ['POST', `/api/users/${admin.id}/subscriptions-flag`, { canManageSubscriptions: false }],
    ['DELETE', `/api/users/${admin.id}`, undefined],
  ];
  for (const [method, urlPath, body] of probes) {
    const res = await json(method, urlPath, body, memberCookie);
    assert.equal(res.status, 403, `${method} ${urlPath} must be admin-only`);
  }
  // And nothing changed: the admin still exists, still an admin.
  assert.equal(userStore.getById(admin.id).role, 'admin');
});

// ---- create ----------------------------------------------------------------

test('POST /api/users: validation 400s, duplicate 409 (case-insensitive), and a created admin can sign in', async () => {
  assert.equal((await json('POST', '/api/users', { username: 'bad name!', password: 'password123' })).status, 400);
  assert.equal((await json('POST', '/api/users', { username: 'shortpw', password: 'short' })).status, 400);

  const created = await json('POST', '/api/users', {
    username: 'Wife', displayName: 'The Wife', password: 'password123', role: 'admin', canManageSubscriptions: true,
  });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.user.role, 'admin');
  assert.equal(body.user.canManageSubscriptions, true);
  assert.ok(!JSON.stringify(body).includes('scrypt'), 'no hash material in the response');

  assert.equal((await json('POST', '/api/users', { username: 'wife', password: 'password456' })).status, 409,
    'usernames are unique case-insensitively');

  await login('Wife', 'password123');
});

// ---- reset password + instant revocation -----------------------------------

test('resetting a password revokes the target\'s existing sessions instantly, and the new password works', async () => {
  assert.equal((await json('POST', '/api/users', { username: 'resetme', password: 'password123' })).status, 201);
  const oldCookie = await login('resetme', 'password123');
  assert.equal((await json('GET', '/api/auth/me', undefined, oldCookie)).status, 200, 'precondition: session live');

  const target = userStore.getByUsername('resetme');
  assert.equal((await json('POST', `/api/users/${target.id}/password`, { password: 'newpassword1' })).status, 200);

  assert.equal((await json('GET', '/api/auth/me', undefined, oldCookie)).status, 401,
    'the pre-reset cookie must die IMMEDIATELY (token_version bump), not at expiry');
  assert.equal((await json('POST', '/api/auth/login', { username: 'resetme', password: 'password123' })).status, 401);
  await login('resetme', 'newpassword1');
});

test('resetting your OWN password reissues your session cookie so you are not signed out mid-task', async () => {
  // A dedicated second admin acts on THEMSELVES (using the suite admin here
  // would revoke the patched global-fetch cookie for the whole file).
  assert.equal((await json('POST', '/api/users', { username: 'selfreset', password: 'password123', role: 'admin' })).status, 201);
  const cookie = await login('selfreset', 'password123');
  const self = userStore.getByUsername('selfreset');

  const res = await json('POST', `/api/users/${self.id}/password`, { password: 'selfpass99' }, cookie);
  assert.equal(res.status, 200);
  const reissued = res.headers.get('set-cookie');
  assert.ok(reissued && reissued.includes(AUTH_COOKIE_NAME), 'a fresh cookie rides the response');
  assert.equal((await json('GET', '/api/auth/me', undefined, cookie)).status, 401, 'the pre-reset cookie is revoked');
  assert.equal((await json('GET', '/api/auth/me', undefined, reissued.split(';')[0])).status, 200,
    'the reissued cookie is valid against the bumped token_version');
});

// ---- disable / enable ------------------------------------------------------

test('disable revokes instantly and blocks sign-in; enable restores sign-in with old cookies still dead', async () => {
  assert.equal((await json('POST', '/api/users', { username: 'benched', password: 'password123' })).status, 201);
  const cookie = await login('benched', 'password123');
  const target = userStore.getByUsername('benched');

  assert.equal((await json('POST', `/api/users/${target.id}/disabled`, { disabled: true })).status, 200);
  assert.equal((await json('GET', '/api/auth/me', undefined, cookie)).status, 401, 'instant revocation');
  assert.equal((await json('POST', '/api/auth/login', { username: 'benched', password: 'password123' })).status, 401,
    'a disabled account cannot sign in');

  assert.equal((await json('POST', `/api/users/${target.id}/disabled`, { disabled: false })).status, 200);
  assert.equal((await json('GET', '/api/auth/me', undefined, cookie)).status, 401,
    're-enable must NOT resurrect pre-disable cookies (tv bumped on both edges)');
  await login('benched', 'password123');
});

// ---- self-lockout guards ---------------------------------------------------

test('self-lockout guards: no self-disable, no self-delete, and the last enabled admin can never be disabled/demoted/deleted', async () => {
  assert.equal((await json('POST', `/api/users/${admin.id}/disabled`, { disabled: true })).status, 409);
  assert.equal((await json('DELETE', `/api/users/${admin.id}`)).status, 409);

  // Make this admin the LAST enabled admin: demote/disable every other one.
  for (const u of userStore.listUsers()) {
    if (u.id !== admin.id && u.role === 'admin' && !u.disabled) {
      assert.equal((await json('POST', `/api/users/${u.id}/role`, { role: 'member' })).status, 200);
    }
  }
  const demote = await json('POST', `/api/users/${admin.id}/role`, { role: 'member' });
  assert.equal(demote.status, 409, 'demoting the last enabled admin is refused');
  assert.match((await demote.json()).error, /last enabled admin/);
  assert.equal(userStore.getById(admin.id).role, 'admin', 'nothing changed');
});

// ---- subscriptions flag ----------------------------------------------------

test('the subscriptions flag toggles per-user', async () => {
  assert.equal((await json('POST', '/api/users', { username: 'subsflag', password: 'password123' })).status, 201);
  const target = userStore.getByUsername('subsflag');
  assert.equal(target.canManageSubscriptions, false);
  assert.equal((await json('POST', `/api/users/${target.id}/subscriptions-flag`, { canManageSubscriptions: true })).status, 200);
  assert.equal(userStore.getById(target.id).canManageSubscriptions, true);
});

// ---- delete ----------------------------------------------------------------

test('DELETE /api/users/:id: hard delete cascades per-user state, kills the cookie, and the id is never reused', async () => {
  assert.equal((await json('POST', '/api/users', { username: 'doomeduser', password: 'password123' })).status, 201);
  const cookie = await login('doomeduser', 'password123');
  const target = userStore.getByUsername('doomeduser');
  userStore.setProgress(target.id, 'someMedia', { timestamp: 5, duration: 10, updatedAt: new Date().toISOString() });
  userStore.addLiked(target.id, 'someMedia', new Date().toISOString());

  assert.equal((await json('DELETE', `/api/users/${target.id}`)).status, 200);
  assert.equal(userStore.getById(target.id), null);
  assert.equal(userStore.getOneProgress(target.id, 'someMedia'), null, 'per-user state cascaded');
  assert.deepEqual(userStore.getLiked(target.id), []);
  assert.equal((await json('GET', '/api/auth/me', undefined, cookie)).status, 401, 'the dead user\'s cookie is invalid');

  // AUTOINCREMENT: a recreate gets a FRESH id -- the stale cookie can never
  // inherit the new account (design-delta SUGGESTION-6).
  assert.equal((await json('POST', '/api/users', { username: 'doomeduser', password: 'password456' })).status, 201);
  const recreated = userStore.getByUsername('doomeduser');
  assert.ok(recreated.id > target.id, 'ids climb, never recycle');
  assert.equal((await json('GET', '/api/auth/me', undefined, cookie)).status, 401, 'the old cookie stays dead against the recreate');
});

test('404/400 shapes: unknown id 404s, junk id 400s', async () => {
  assert.equal((await json('POST', '/api/users/999999/password', { password: 'password123' })).status, 404);
  assert.equal((await json('POST', '/api/users/banana/password', { password: 'password123' })).status, 400);
});

// ---- /api/me/settings mirror ----------------------------------------------

test('/api/me/settings: allowlisted keys round-trip via /api/auth/me, per-user isolated; junk refused; null clears', async () => {
  assert.equal((await json('POST', '/api/me/settings', { theme: 'dark', era: 'era-2009', icons: 'auto' })).status, 200);
  const me = await (await json('GET', '/api/auth/me')).json();
  assert.deepEqual(me.settings, { theme: 'dark', era: 'era-2009', icons: 'auto' });

  // Unknown key + oversized/invalid values are refused whole.
  assert.equal((await json('POST', '/api/me/settings', { evil: 'x' })).status, 400);
  assert.equal((await json('POST', '/api/me/settings', { theme: 'x'.repeat(40) })).status, 400);
  assert.equal((await json('POST', '/api/me/settings', { theme: { nested: true } })).status, 400);
  const unchanged = await (await json('GET', '/api/auth/me')).json();
  assert.deepEqual(unchanged.settings, { theme: 'dark', era: 'era-2009', icons: 'auto' }, 'a refused write changes nothing');

  // Another user's mirror is their own.
  assert.equal((await json('POST', '/api/users', { username: 'mirroruser', password: 'password123' })).status, 201);
  const otherCookie = await login('mirroruser', 'password123');
  const other = await (await json('GET', '/api/auth/me', undefined, otherCookie)).json();
  assert.deepEqual(other.settings, {}, 'a fresh user starts with no mirrored prefs');
  assert.equal((await json('POST', '/api/me/settings', { theme: 'light' }, otherCookie)).status, 200);
  const mineAfter = await (await json('GET', '/api/auth/me')).json();
  assert.equal(mineAfter.settings.theme, 'dark', 'another user\'s write never touches mine');

  // null clears a key.
  assert.equal((await json('POST', '/api/me/settings', { icons: null })).status, 200);
  const cleared = await (await json('GET', '/api/auth/me')).json();
  assert.equal(cleared.settings.icons, undefined);
});
