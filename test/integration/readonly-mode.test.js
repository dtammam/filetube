'use strict';
// FILETUBE_READONLY=1 (2026-07-30 capture-safety hardening, P2) + the
// mutation audit log (P3). The env is read per-request by design, so these
// tests toggle it around real requests against the real app - the same
// route stack the incident's DELETEs traveled.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
let auth;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});

after(async () => {
  delete process.env.FILETUBE_READONLY;
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('readonly OFF: a DELETE reaches its route (404 for a bogus id, never the readonly 403)', async () => {
  delete process.env.FILETUBE_READONLY;
  const res = await fetch(`${base}/api/videos/no-such-id-readonly-test`, { method: 'DELETE' });
  assert.notStrictEqual(res.status, 403);
});

test('readonly ON: DELETE /api/videos/:id - the incident endpoint - is refused with 403 readOnly', async () => {
  process.env.FILETUBE_READONLY = '1';
  try {
    const res = await fetch(`${base}/api/videos/no-such-id-readonly-test`, { method: 'DELETE' });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.readOnly, true);
    assert.match(body.error, /FILETUBE_READONLY/);
  } finally {
    delete process.env.FILETUBE_READONLY;
  }
});

test('readonly ON: POST/PUT/PATCH are refused; GET passes untouched', async () => {
  process.env.FILETUBE_READONLY = '1';
  try {
    for (const method of ['POST', 'PUT', 'PATCH']) {
      const res = await fetch(`${base}/api/videos/x/like`, { method });
      assert.strictEqual(res.status, 403, method);
      assert.strictEqual((await res.json()).readOnly, true, method);
    }
    const get = await fetch(`${base}/api/videos`);
    assert.notStrictEqual(get.status, 403);
  } finally {
    delete process.env.FILETUBE_READONLY;
  }
});

test('readonly ON: the capture contract POSTs still reach their routes', async () => {
  process.env.FILETUBE_READONLY = '1';
  try {
    // Login with bad credentials: reaching the AUTH route means a 401 (or
    // 400-class), never the readonly 403 - which is the claim under test.
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nope', password: 'nope' }),
    });
    assert.notStrictEqual(login.status, 403);
    // Logout is a session POST, allowed so a capture session can end cleanly.
    const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
    assert.notStrictEqual(logout.status, 403);
    // The relocation dry-run preview is read-only by server contract.
    const preview = await fetch(`${base}/api/ytdlp/repull-metadata/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.notStrictEqual(preview.status, 403);
  } finally {
    delete process.env.FILETUBE_READONLY;
  }
});

test('audit: every mutating request logs one [audit] line with method, path, status, user', async () => {
  const lines = [];
  const realLog = console.log;
  console.log = (...a) => {
    const s = a.join(' ');
    if (s.startsWith('[audit]')) lines.push(s);
    else realLog(...a);
  };
  try {
    await fetch(`${base}/api/videos/no-such-id-audit-test`, { method: 'DELETE' });
    // finish fires async after the response resolves - give it a beat.
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    console.log = realLog;
  }
  const line = lines.find((l) => l.includes('/api/videos/no-such-id-audit-test'));
  assert.ok(line, `no audit line captured; got: ${lines.join(' | ')}`);
  assert.match(line, /^\[audit\] DELETE \/api\/videos\/no-such-id-audit-test \d{3} user=.+$/);
  assert.doesNotMatch(line, /user=unauthenticated/, 'authenticated session must be attributed');
});
