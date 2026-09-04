'use strict';

require('../helpers/isolate-data-dir'); // tech-debt #202: MUST precede any server.js require (it opens a db)
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
    // First-run provisioning must survive readonly (gate finding: a fresh
    // zero-user instance could never create its first admin). This test
    // instance HAS users, so the auth gate 409s the setup POST - reaching
    // that refusal (not the readonly 403) is the property under test.
    const setup = await fetch(`${base}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'x', password: 'y' }),
    });
    assert.notStrictEqual(setup.status, 403);
  } finally {
    delete process.env.FILETUBE_READONLY;
  }
});

// Captures [audit] lines while fn runs, polling afterwards until pred is
// satisfied or the bounded timeout elapses - never a bare fixed sleep (the
// repo's #53/#57 flake class is exactly fixed-delay async assumptions).
async function withAuditLines(fn, pred, timeoutMs = 2000) {
  const lines = [];
  const realLog = console.log;
  console.log = (...a) => {
    const s = a.join(' ');
    if (s.startsWith('[audit]')) lines.push(s);
    else realLog(...a);
  };
  try {
    await fn();
    const deadline = Date.now() + timeoutMs;
    while (!pred(lines) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
  } finally {
    console.log = realLog;
  }
  return lines;
}

test('audit: a mutating request logs EXACTLY ONE [audit] line - timestamp, method, full URL, status, user', async () => {
  const target = '/api/videos/no-such-id-audit-test?removeAnyway=true';
  const lines = await withAuditLines(
    () => fetch(`${base}${target}`, { method: 'DELETE' }),
    (ls) => ls.some((l) => l.includes(target))
  );
  const hits = lines.filter((l) => l.includes(target));
  // finish AND close both fire on a normal response - the once-guard must
  // collapse them to a single line.
  assert.strictEqual(hits.length, 1, `expected exactly one line, got: ${hits.join(' | ')}`);
  // originalUrl (query preserved - removeAnyway is a materially different
  // delete), ISO timestamp, status, attributed user.
  assert.match(hits[0], /^\[audit\] \d{4}-\d{2}-\d{2}T[\d:.]+Z DELETE \/api\/videos\/no-such-id-audit-test\?removeAnyway=true \d{3} user=.+$/);
  assert.doesNotMatch(hits[0], /user=unauthenticated/, 'authenticated session must be attributed');
});

test('audit: a readonly-403d mutation still audits; safe GETs never audit', async () => {
  process.env.FILETUBE_READONLY = '1';
  try {
    const lines = await withAuditLines(
      async () => {
        await fetch(`${base}/api/videos/blocked-audit-probe`, { method: 'DELETE' });
        await fetch(`${base}/api/videos`);
      },
      (ls) => ls.some((l) => l.includes('/api/videos/blocked-audit-probe'))
    );
    const blockedLine = lines.find((l) => l.includes('/api/videos/blocked-audit-probe'));
    assert.ok(blockedLine, 'the 403d DELETE must still produce an audit line');
    assert.match(blockedLine, / 403 /);
    assert.ok(!lines.some((l) => / GET /.test(l)), `safe GET must not audit: ${lines.join(' | ')}`);
  } finally {
    delete process.env.FILETUBE_READONLY;
  }
});

test('audit: a client that destroys the socket mid-request still produces exactly one line (close-path)', async () => {
  // The incident-relevant teardown shape: fire-and-forget, connection gone
  // before the response finishes. 'finish' never fires then; 'close' must.
  const net = require('node:net');
  const target = '/api/videos/socket-destroy-audit-probe';
  const lines = await withAuditLines(
    async () => {
      await new Promise((resolve) => {
        const sock = net.connect(server.address().port, '127.0.0.1', () => {
          sock.write(`DELETE ${target} HTTP/1.1\r\nHost: x\r\nCookie: ${auth.cookie}\r\n\r\n`);
          // Tear the socket down immediately - do not wait for the response.
          setImmediate(() => { sock.destroy(); resolve(); });
        });
        sock.on('error', () => resolve());
      });
    },
    (ls) => ls.some((l) => l.includes(target))
  );
  const hits = lines.filter((l) => l.includes(target));
  assert.strictEqual(hits.length, 1, `expected exactly one audit line whichever of finish/close won, got ${hits.length}: ${hits.join(' | ')}`);
});
