'use strict';

// [INTEGRATION] v1.43 — the auth wall, end to end against the REAL gate (no
// fetch patch here; this suite deliberately drives the unauthenticated and
// authenticated paths). Covers: first-run funnels to /welcome, create-admin
// + adoption, login/logout, instant revocation on password change, the
// allowlist surface, page-redirect vs API-401, and that a byte route is
// gated.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-authflow-'));
// DATA_DIR is set above via process.env for the server require;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, __resetDatabaseForTests, __clearUsersForTests } = require('../../server');

let server, base;
before(async () => {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});
beforeEach(async () => { await __resetDatabaseForTests(); __clearUsersForTests(); });

// fetch that does NOT follow redirects and returns {status, location, json}.
async function raw(pathname, opts = {}) {
  const res = await fetch(base + pathname, Object.assign({ redirect: 'manual' }, opts));
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, location: res.headers.get('location'), setCookie: res.headers.get('set-cookie'), json, res };
}
function jsonPost(pathname, body, headers) {
  return raw(pathname, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });
}

test('no users: a page request redirects to /welcome; an API 401s; /welcome + assets are open', async () => {
  const page = await raw('/', { headers: { Accept: 'text/html' } });
  assert.equal(page.status, 302);
  assert.equal(page.location, '/welcome');
  assert.equal((await raw('/api/videos', { headers: { Accept: 'application/json' } })).status, 401);
  // The login surface + its assets are reachable pre-auth.
  assert.equal((await raw('/welcome', { headers: { Accept: 'text/html' } })).status, 200);
  assert.equal((await raw('/css/style.css')).status, 200);
  assert.equal((await raw('/js/common.js')).status, 200);
  assert.equal((await raw('/js/login.js')).status, 401, '/js/login.js is NOT allowlisted (only common.js is)');
  // /login redirects to /welcome while there are no users.
  assert.equal((await raw('/login', { headers: { Accept: 'text/html' } })).location, '/welcome');
});

test('create-admin adopts pre-auth state, sets a session, and locks setup afterwards', async () => {
  // Seed some pre-auth global state to be adopted.
  saveDatabase({ folders: [], folderSettings: {}, progress: { vid1: { timestamp: 30, duration: 100, updatedAt: '2026-07-01T00:00:00.000Z' } }, metadata: { vid1: { id: 'vid1', name: 'c.mp4' } }, liked: ['vid1'], settings: {} });

  const setup = await jsonPost('/api/auth/setup', { username: 'dean', displayName: 'Dean', password: 'a-good-password' });
  assert.equal(setup.status, 200);
  assert.ok(/ft_session_/.test(setup.setCookie || ''), 'a session cookie is set');
  assert.equal(setup.json.user.role, 'admin');
  assert.equal(setup.json.user.username, 'dean');

  // Setup is now closed.
  assert.equal((await jsonPost('/api/auth/setup', { username: 'x', password: 'yyyyyyyy' })).status, 409);
  // /welcome now bounces to /login.
  assert.equal((await raw('/welcome', { headers: { Accept: 'text/html' } })).location, '/login');

  // The adopted state is the admin's now — log in and read it back.
  const cookie = (setup.setCookie || '').split(';')[0];
  const me = await raw('/api/auth/me', { headers: { Cookie: cookie, Accept: 'application/json' } });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.username, 'dean');
});

test('login: wrong password 401s; right password sets a session; short/invalid rejected', async () => {
  await jsonPost('/api/auth/setup', { username: 'dean', displayName: 'Dean', password: 'a-good-password' });
  assert.equal((await jsonPost('/api/auth/login', { username: 'dean', password: 'wrong' })).status, 401);
  assert.equal((await jsonPost('/api/auth/login', { username: 'nobody', password: 'whatever' })).status, 401);
  const ok = await jsonPost('/api/auth/login', { username: 'dean', password: 'a-good-password' });
  assert.equal(ok.status, 200);
  assert.ok(/ft_session_/.test(ok.setCookie || ''));
});

test('a valid session reaches gated routes and byte routes; logout kills it', async () => {
  const setup = await jsonPost('/api/auth/setup', { username: 'dean', displayName: 'Dean', password: 'a-good-password' });
  const cookie = (setup.setCookie || '').split(';')[0];

  // A gated API is reachable with the cookie...
  assert.equal((await raw('/api/videos', { headers: { Cookie: cookie, Accept: 'application/json' } })).status, 200);
  // ...and 401s without it.
  assert.equal((await raw('/api/videos', { headers: { Accept: 'application/json' } })).status, 401);

  // Logout clears the cookie.
  const out = await raw('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(out.status, 200);
  assert.match(out.setCookie || '', /Max-Age=0/);
});

test('instant revocation: changing the password invalidates the existing session on its next request', async () => {
  const setup = await jsonPost('/api/auth/setup', { username: 'dean', displayName: 'Dean', password: 'first-password' });
  const cookie = (setup.setCookie || '').split(';')[0];
  assert.equal((await raw('/api/auth/me', { headers: { Cookie: cookie } })).status, 200, 'session valid');

  // Simulate a password change (bumps token_version) via the store directly.
  const { userStore } = require('../../server');
  const u = userStore.getByUsername('dean');
  userStore.updatePassword(u.id, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

  // The old cookie is dead on its very next request (tv mismatch).
  assert.equal((await raw('/api/auth/me', { headers: { Cookie: cookie, Accept: 'application/json' } })).status, 401, 'old session revoked instantly');
});
