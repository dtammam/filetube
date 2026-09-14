'use strict';

// [INTEGRATION] Wave 5 of the relational-migration arc (ytdlp, the last
// container) - the downloader's namespace is five tables behind a feature
// store whose writes ride the doc commit. Through the module's REAL writers on
// the server's REAL deps (updateDatabase + ytdlpDb), populate first, then the
// failure axis, then the happy path:
//   - addSubscription whose doc save FAILS leaves the registry untouched (the
//     promise rejects); the committed add lands; reorderSubscriptions keeps
//     the array as a position column (the routes still sort by `order`);
//   - setAllowMembersOnly (the value part) whose doc save FAILS leaves the
//     flag untouched; the committed flip lands as ONE row; an unchanged flip
//     writes nothing;
//   - recordDownloadChannelMeta + the scan bridge: a captured entry lands in
//     ytdlp_download_meta and a real scan CONSUMES it inside its own commit
//     (the item carries the identity, the row is gone - one transaction);
//   - the bundle carries `ytdlp` (order + flag included), a restore
//     round-trips it, and a malformed `ytdlp` is a 400 BEFORE the wipe.

const { DATA_DIR } = require('../helpers/isolate-data-dir');
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = require('node:path').join(DATA_DIR, 'ytdlp-downloads');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { app, __resetDatabaseForTests, __failNextSaveForTests, ytdlpDb, updateDatabase, getMediaId, scanDirectories, loadDatabase } = require('../../server');
const ytdlpStore = require('../../lib/ytdlp/store');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
});
beforeEach(() => __resetDatabaseForTests());

const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const withTimeout = (p, ms = 15000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no response within ${ms}ms (the handler hung)`)), ms))]);
const settings = { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0 };
const deps = { updateDatabase, ytdlpDb, getMediaId };
const EMPTY = { allowMembersOnly: false, subscriptions: [], downloadMeta: {}, pins: [], channelAvatars: {} };

test('addSubscription / reorderSubscriptions through the real writer: a FAILED doc save leaves the registry untouched; the committed add lands; the array order is a position column', async () => {
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, ytdlp: EMPTY });
  __failNextSaveForTests(new Error('simulated save failure'));
  await assert.rejects(ytdlpStore.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@first', format: 'video' }), /simulated save failure/);
  assert.deepStrictEqual(ytdlpDb.read().subscriptions, [], 'a failed save wrote nothing');
  assert.deepStrictEqual((readPersistedDatabase(DATA_DIR).ytdlp || EMPTY).subscriptions, [], 'on disk too');
  const first = await ytdlpStore.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@first', format: 'video' });
  const second = await ytdlpStore.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@second', format: 'video' });
  assert.deepStrictEqual(ytdlpDb.read().subscriptions.map((s) => s.id), [first.id, second.id], 'insertion order, in the table');
  await ytdlpStore.reorderSubscriptions(deps, [second.id, first.id]);
  const after = ytdlpDb.read().subscriptions;
  assert.deepStrictEqual(after.map((s) => s.id), [first.id, second.id], 'the ARRAY order is untouched by a reorder (a position column, never a sort)');
  assert.deepStrictEqual(after.map((s) => s.order), [1, 0], 'the reorder is the `order` field, as before');
  assert.deepStrictEqual(ytdlpStore.listSubscriptions(deps).map((s) => s.id), [second.id, first.id], 'the list view sorts by `order`');
  assert.deepStrictEqual(readPersistedDatabase(DATA_DIR).ytdlp.subscriptions.map((s) => s.id), [first.id, second.id], 'on disk too');
  const listed = await (await fetch(`${base}/api/subscriptions`)).json();
  assert.deepStrictEqual(listed.map((s) => s.id), [second.id, first.id], 'the route reads the tables');
});

test('setAllowMembersOnly (the value part): a FAILED doc save leaves the flag untouched; the committed flip is ONE row; an unchanged flip writes nothing', async () => {
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, ytdlp: EMPTY });
  assert.strictEqual(ytdlpStore.getAllowMembersOnly(deps), false);
  __failNextSaveForTests(new Error('simulated save failure'));
  await assert.rejects(ytdlpStore.setAllowMembersOnly(deps, true), /simulated save failure/);
  assert.strictEqual(ytdlpDb.read().allowMembersOnly, false, 'a failed save wrote nothing');
  assert.strictEqual(await ytdlpStore.setAllowMembersOnly(deps, true), true);
  assert.strictEqual(ytdlpDb.read().allowMembersOnly, true);
  assert.strictEqual(ytdlpStore.getAllowMembersOnly(deps), true, 'the module reads it back through the store');
  assert.strictEqual(readPersistedDatabase(DATA_DIR).ytdlp.allowMembersOnly, true, 'on disk (ytdlp_settings)');
  assert.deepStrictEqual(ytdlpDb.syncFrom(ytdlpDb.read()), { rowsWritten: 0, rowsDeleted: 0 }, 'an unchanged namespace is a zero diff');
  const r = await withTimeout(post('/api/settings', { allowMembersOnly: false }));
  assert.ok(r.status === 200 || r.status === 400, `the settings route answers (${r.status})`);
});

test('the scan bridge: a recorded download capture lands in ytdlp_download_meta and a REAL scan consumes it inside its own commit (identity on the item, row gone, one transaction)', async () => {
  const root = path.join(process.env.FILETUBE_YTDLP_DOWNLOAD_DIR, 'Chan');
  fs.mkdirSync(root, { recursive: true });
  const fileName = 'Clip [dQw4w9WgXcQ].mp4';
  fs.writeFileSync(path.join(root, fileName), 'BYTES');
  seedState({ folders: [process.env.FILETUBE_YTDLP_DOWNLOAD_DIR], folderSettings: {}, metadata: {}, settings, ytdlp: EMPTY });
  assert.strictEqual(await ytdlpStore.recordDownloadChannelMeta(deps, { videoId: 'dQw4w9WgXcQ', channelUrl: 'https://www.youtube.com/@RickAstley', channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw', channelName: 'Rick Astley', filePath: path.join(root, fileName) }), true);
  assert.ok(ytdlpDb.read().downloadMeta.dQw4w9WgXcQ, 'the capture is a row');
  await scanDirectories();
  const item = Object.values(loadDatabase().metadata).find((it) => it && it.name === fileName);
  assert.ok(item, 'the file was indexed');
  assert.strictEqual(item.channelName, 'Rick Astley', 'the captured identity reached the item');
  assert.strictEqual(item.channelId, 'UCuAXFkgsw1L7xaCfnd5JJOw');
  assert.deepStrictEqual(ytdlpDb.read().downloadMeta, {}, 'the bridge entry was CONSUMED by the scan (inside its commit)');
  assert.strictEqual(readPersistedDatabase(DATA_DIR).metadata[item.id].channelName, 'Rick Astley', 'on disk');
  assert.deepStrictEqual(ytdlpDb.syncFrom(ytdlpDb.read()), { rowsWritten: 0, rowsDeleted: 0 }, 'nothing left to write');
});

test('the scan bridge under a FAILED save: the bridge row SURVIVES and the item carries no identity; the next scan consumes it (gate pass B, both seats)', async () => {
  const root = path.join(process.env.FILETUBE_YTDLP_DOWNLOAD_DIR, 'Chan');
  fs.mkdirSync(root, { recursive: true });
  const fileName = 'Clip [dQw4w9WgXcQ].mp4';
  fs.writeFileSync(path.join(root, fileName), 'BYTES');
  seedState({ folders: [process.env.FILETUBE_YTDLP_DOWNLOAD_DIR], folderSettings: {}, metadata: {}, settings, ytdlp: EMPTY });
  await ytdlpStore.recordDownloadChannelMeta(deps, { videoId: 'dQw4w9WgXcQ', channelUrl: 'https://www.youtube.com/@RickAstley', channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw', channelName: 'Rick Astley', filePath: path.join(root, fileName) });
  __failNextSaveForTests(new Error('simulated save failure'));
  await scanDirectories().catch(() => {});
  assert.ok(ytdlpDb.read().downloadMeta.dQw4w9WgXcQ, 'the consumed-in-memory entry is STILL a row - its deletion rode the commit that failed');
  assert.strictEqual(Object.values(loadDatabase().metadata).find((it) => it && it.name === fileName), undefined, 'and no item landed without it');
  await scanDirectories();
  const item = Object.values(loadDatabase().metadata).find((it) => it && it.name === fileName);
  assert.strictEqual(item.channelName, 'Rick Astley', 'the next scan consumed it');
  assert.deepStrictEqual(ytdlpDb.read().downloadMeta, {});
});

test('the scan holder is FULL: a scan that consumes one capture leaves the pins, the avatar registry and the flag untouched (gate pass B, adversarial W1 - the partial-holder wipe)', async () => {
  const root = path.join(process.env.FILETUBE_YTDLP_DOWNLOAD_DIR, 'Chan');
  fs.mkdirSync(root, { recursive: true });
  const fileName = 'Clip [dQw4w9WgXcQ].mp4';
  fs.writeFileSync(path.join(root, fileName), 'BYTES');
  const pins = [{ id: 'p1', channelDir: root, label: 'Chan', pinnedAt: 1, order: 0 }];
  const channelAvatars = { UCaaaaaaaaaaaaaaaaaaaaaa: { avatarUrl: 'https://yt3.ggpht.com/a.jpg', fetchedAt: 1 } };
  seedState({ folders: [process.env.FILETUBE_YTDLP_DOWNLOAD_DIR], folderSettings: {}, metadata: {}, settings, ytdlp: { ...EMPTY, pins, channelAvatars, allowMembersOnly: true } });
  await ytdlpStore.recordDownloadChannelMeta(deps, { videoId: 'dQw4w9WgXcQ', channelUrl: 'https://www.youtube.com/@RickAstley', channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw', channelName: 'Rick Astley', filePath: path.join(root, fileName) });
  await scanDirectories();
  const after = ytdlpDb.read();
  assert.deepStrictEqual(after.downloadMeta, {}, 'consumed');
  assert.deepStrictEqual(after.pins, pins, 'the pins survived the scan commit');
  assert.deepStrictEqual(after.channelAvatars, channelAvatars, 'the avatar registry survived');
  assert.strictEqual(after.allowMembersOnly, true, 'the flag survived');
});

test('the bundle carries `ytdlp` (order + flag included) and a restore round-trips it; a malformed `ytdlp` is a 400 BEFORE the wipe; a bundle without the key restores to the empty namespace', async () => {
  const ns = {
    allowMembersOnly: true,
    subscriptions: [{ id: 'b', channelUrl: 'https://www.youtube.com/@b', name: 'B', format: 'video', quality: 'best', paused: false, order: 1 }, { id: 'a', channelUrl: 'https://www.youtube.com/@a', name: 'A', format: 'video', quality: 'best', paused: false, order: 0 }],
    downloadMeta: { 'reddit abc123': { universal: true, capturedAt: 1 } },
    pins: [{ id: 'p1', channelDir: '/dl/A', label: 'A', pinnedAt: 1, order: 0 }],
    channelAvatars: { UCaaaaaaaaaaaaaaaaaaaaaa: { avatarUrl: 'https://yt3.ggpht.com/a.jpg', fetchedAt: 1 } },
  };
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, ytdlp: ns });
  const bundle = await (await fetch(`${base}/api/admin/backup`)).json();
  delete bundle.users;
  assert.deepStrictEqual(bundle.ytdlp, ns, 'verbatim - the array order, the flag, the spaced key');
  for (const bad of [['x'], { tombstones: {} }, { settings: {} }, { downloadMeta: { '': {} } }, { subscriptions: [{ noId: 1 }] }, { pins: 'x' }, { allowMembersOnly: 'yes' }, { allowMembersOnly: {} }]) {
    const r = await withTimeout(post('/api/admin/restore', { ...bundle, ytdlp: bad }));
    assert.strictEqual(r.status, 400, `${JSON.stringify(bad)}: ${await r.clone().text()}`);
    assert.deepStrictEqual(ytdlpDb.read().subscriptions, ns.subscriptions, 'the live rows survived the refusal');
  }
  // gate pass B (adversarial W4): a v1.293 bundle carrying a legacy id-less subscription WITH a channelUrl restores - the id is minted, not refused
  const legacy = { ...bundle, ytdlp: { ...ns, subscriptions: [...ns.subscriptions, { channelUrl: 'https://www.youtube.com/@legacy', name: 'Legacy', order: 2 }] } };
  const rl = await withTimeout(post('/api/admin/restore', legacy));
  assert.strictEqual(rl.status, 200, await rl.text());
  assert.match(ytdlpDb.read().subscriptions[2].id, /^[0-9a-f]{32}$/, 'minted on the way in');
  ytdlpDb.replaceAll({ subscriptions: [{ id: 'scratch', channelUrl: 'https://www.youtube.com/@s', name: 'S' }] });
  const r = await post('/api/admin/restore', bundle);
  assert.strictEqual(r.status, 200, await r.text());
  assert.deepStrictEqual(ytdlpDb.read(), ns, 'the own export restored verbatim');
  const without = { ...bundle };
  delete without.ytdlp;
  assert.strictEqual((await post('/api/admin/restore', without)).status, 200);
  assert.deepStrictEqual(ytdlpDb.read(), EMPTY, 'a bundle without the key restores to the empty namespace (the flag at its default)');
});
