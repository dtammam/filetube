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
const { app, currentYtdlpPollTimer, loadDatabase, updateDatabase } = require('../../server');
const store = require('../../lib/ytdlp/store');

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
  // v1.20.0 FR-1 (T3), AC26: additive `defaultMaxVideos` field, single-sourced
  // from lib/ytdlp/config.js's DEFAULT_MAX_VIDEOS (now 2, FR-5) -- the
  // watch-page Subscribe modal's "download last N" pre-fill reads this same
  // value so there is no second, independently hardcoded literal.
  assert.deepEqual(await res.json(), { enabled: true, defaultMaxVideos: 2 });
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

// ---- v1.25.5 QoL follow-up (channel avatars, round 2): the list serializer -
// includes channelAvatarUrl when the subscription record carries one --------

test('GET /api/subscriptions includes channelAvatarUrl in each row when the subscription record carries one', async () => {
  const addRes = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@avatarserializer', format: 'video' }),
  });
  assert.equal(addRes.status, 201);
  const created = await addRes.json();

  // Write the avatar directly through the same store mutator the real avatar
  // pipeline (poll self-heal / the one-shot subscribe probe / the "Refresh
  // avatars" batch) already uses -- deterministic, no real yt-dlp spawn.
  await store.recordSubscriptionChannelAvatar(
    { loadDatabase, updateDatabase },
    'https://www.youtube.com/@avatarserializer',
    'https://example.com/avatar.jpg'
  );

  const listRes = await fetch(`${base}/api/subscriptions`);
  const list = await listRes.json();
  const row = list.find((s) => s.id === created.id);
  assert.ok(row, 'the subscription must still be present in the list');
  assert.equal(row.channelAvatarUrl, 'https://example.com/avatar.jpg', 'the list serializer must include channelAvatarUrl when the record carries one');

  const delRes = await fetch(`${base}/api/subscriptions/${created.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
});

test('GET /api/subscriptions omits channelAvatarUrl for a subscription with no captured avatar', async () => {
  const addRes = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@noavatarserializer', format: 'video' }),
  });
  assert.equal(addRes.status, 201);
  const created = await addRes.json();

  const listRes = await fetch(`${base}/api/subscriptions`);
  const list = await listRes.json();
  const row = list.find((s) => s.id === created.id);
  assert.ok(row);
  assert.equal(row.channelAvatarUrl, undefined);

  const delRes = await fetch(`${base}/api/subscriptions/${created.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
});

// v1.25.x QoL bugfix: when the subscription's OWN channelAvatarUrl is empty,
// the list serializer now falls back to the channelId-keyed REGISTRY before
// leaving it absent -- covers a subscription whose avatar was only ever
// captured under a different identity (e.g. registered via a downloaded item
// before this subscription even existed).
test('GET /api/subscriptions falls back to the channelId registry when the subscription itself has no channelAvatarUrl of its own', async () => {
  const addRes = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@registryfallbackserializer', format: 'video' }),
  });
  assert.equal(addRes.status, 201);
  const created = await addRes.json();

  const channelId = 'UCregistryfallbackserial';
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    const sub = ns.subscriptions.find((s) => s.id === created.id);
    sub.channelId = channelId;
    ns.channelAvatars[channelId] = { avatarUrl: 'https://example.com/registry-serializer.jpg', fetchedAt: Date.now() };
    return true;
  });

  const listRes = await fetch(`${base}/api/subscriptions`);
  const list = await listRes.json();
  const row = list.find((s) => s.id === created.id);
  assert.ok(row);
  assert.equal(row.channelAvatarUrl, 'https://example.com/registry-serializer.jpg', 'the registry must be read through when the sub itself carries no avatar');

  const delRes = await fetch(`${base}/api/subscriptions/${created.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
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

// ---- v1.13.0 item 4: filetype accepted + validated at the POST boundary ---

test('POST /api/subscriptions accepts a valid filetype and persists it', async () => {
  const addRes = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@ftype', format: 'video', filetype: 'mkv' }),
  });
  assert.equal(addRes.status, 201);
  const created = await addRes.json();
  assert.equal(created.filetype, 'mkv');

  const delRes = await fetch(`${base}/api/subscriptions/${created.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
});

test('POST /api/subscriptions with a mismatched-format filetype (audio format, video filetype) returns 400', async () => {
  const res = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@ftypebad', format: 'audio', filetype: 'mp4' }),
  });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
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
