'use strict';

// [INTEGRATION] Subscriptions CRUD + settings API (T2), covering AC 10-13, 33.
// Isolated DATA_DIR before requiring the app (own process per file, per the
// existing integration-test pattern in test/integration/api.test.js). Sets
// FILETUBE_YTDLP_ENABLED before requiring server.js so registerRoutes'
// default-config read (at server.js require time) picks up "enabled" --
// mirrors how ytdlp-disabled-noop.test.js proves the off case in a fresh
// process/module-registry the other direction.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
const DB_FILE = path.join(process.env.DATA_DIR, 'db.json');
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0'; // manual-only: no real timer during tests

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, currentYtdlpPollTimer } = require('../../server');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // No poll timer should have armed with pollMinutes=0 -- but clear
  // defensively so a dangling handle never keeps the runner alive.
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('module is enabled: /api/subscriptions/health reports enabled', async () => {
  const res = await fetch(`${base}/api/subscriptions/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { enabled: true });
});

test('GET /api/subscriptions starts empty', async () => {
  const res = await fetch(`${base}/api/subscriptions`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('POST /api/subscriptions add -> GET list shows it -> DELETE removes it (round-trip)', async () => {
  const addRes = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@roundtrip', format: 'video' }),
  });
  assert.equal(addRes.status, 201);
  const created = await addRes.json();
  assert.equal(created.channelUrl, 'https://www.youtube.com/@roundtrip');
  assert.equal(created.format, 'video');
  assert.equal(created.quality, 'best');
  assert.equal(created.lastCheckedAt, null);
  assert.equal(created.lastStatus, null);
  assert.ok(created.id);

  const listRes = await fetch(`${base}/api/subscriptions`);
  const list = await listRes.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);

  // Persistence goes through db.json only -- no second config/state file.
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.ok(raw.ytdlp);
  assert.equal(raw.ytdlp.subscriptions.length, 1);
  assert.equal(raw.ytdlp.subscriptions[0].id, created.id);

  const delRes = await fetch(`${base}/api/subscriptions/${created.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);

  const afterList = await (await fetch(`${base}/api/subscriptions`)).json();
  assert.deepEqual(afterList, []);
});

test('POST /api/subscriptions with a bad body returns 400', async () => {
  const missingUrl = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'video' }),
  });
  assert.equal(missingUrl.status, 400);
  assert.ok((await missingUrl.json()).error);

  const nonHttpUrl = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelUrl: 'ftp://example.com', format: 'video' }),
  });
  assert.equal(nonHttpUrl.status, 400);

  const badFormat = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@x', format: 'gif' }),
  });
  assert.equal(badFormat.status, 400);
});

test('DELETE /api/subscriptions/:id with an unknown id returns 404', async () => {
  const res = await fetch(`${base}/api/subscriptions/no-such-id`, { method: 'DELETE' });
  assert.equal(res.status, 404);
  assert.ok((await res.json()).error);
});

test('GET/POST /api/subscriptions/settings round-trips allowMembersOnly', async () => {
  const initial = await (await fetch(`${base}/api/subscriptions/settings`)).json();
  assert.equal(initial.allowMembersOnly, false);

  const setRes = await fetch(`${base}/api/subscriptions/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowMembersOnly: true }),
  });
  assert.equal(setRes.status, 200);
  assert.deepEqual(await setRes.json(), { allowMembersOnly: true });

  const after = await (await fetch(`${base}/api/subscriptions/settings`)).json();
  assert.equal(after.allowMembersOnly, true);

  // Reset for isolation from later tests in this file.
  await fetch(`${base}/api/subscriptions/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowMembersOnly: false }),
  });
});

test('POST /api/subscriptions/settings with a non-boolean value returns 400', async () => {
  const res = await fetch(`${base}/api/subscriptions/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowMembersOnly: 'yes' }),
  });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test('no poll timer armed with FILETUBE_YTDLP_POLL_MINUTES=0 even though the module is enabled', () => {
  // startBackground is only invoked under require.main === module (not when
  // server.js is required for tests), so this should be null regardless --
  // asserted here as a belt-and-suspenders sanity check for this file's env.
  assert.equal(currentYtdlpPollTimer(), null);
});
