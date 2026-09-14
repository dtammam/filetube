'use strict';

// [INTEGRATION] Wave 5 of the relational-migration arc (podcasts) - the
// podcasts namespace is three tables behind a feature store whose writes ride
// the doc commit. Through the REAL routes and the module's own functions,
// populate first, then the failure axis, then the happy path:
//   - POST /api/podcasts/settings whose doc save FAILS leaves the poll
//     interval untouched (500, never a hang); the committed POST lands it;
//   - PATCH /api/podcasts/subscriptions/:id whose doc save FAILS leaves the
//     record untouched; the committed PATCH lands it and the subscription
//     ORDER (the array, a position column) survives the rewrite;
//   - DELETE /api/podcasts/episodes/:id (the trash lane) flips the record in
//     the tables and an unchanged pass writes nothing;
//   - the retention sweep through the module's deps whose doc save FAILS
//     leaves the archive untouched; the committed sweep tombstones;
//   - the bundle carries `podcasts` in its container shape (order included),
//     a restore round-trips it, a malformed `podcasts` is a 400 BEFORE the
//     wipe, and a bundle WITHOUT the key preserves the live archive.

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { app, __resetDatabaseForTests, __failNextSaveForTests, podcastsDb, updateDatabase, userStore, settingsStore } = require('../../server');
const podcasts = require('../../lib/podcasts');
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
after(async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); });
beforeEach(() => __resetDatabaseForTests());

const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const patch = (url, body) => fetch(`${base}${url}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const withTimeout = (p, ms = 15000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no response within ${ms}ms (the handler hung)`)), ms))]);
const settings = { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, trashRetentionDays: 7 };
const EMPTY = { subscriptions: [], episodes: {}, settings: {} };
const sub = (id, over) => ({ id, name: `Show ${id}`, feedUrlDisplay: `https://x.example/${id}`, feedHost: 'x.example', order: 0, paused: false, backfill: 'all', addedAt: 1, ...over });
const ROOT = podcasts.resolvePodcastsRoot(null, { dataDir: DATA_DIR });
const DAY = 24 * 60 * 60 * 1000;

test('POST /api/podcasts/settings: a FAILED doc save leaves the poll interval untouched and answers 500; the committed POST lands it', async () => {
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, podcasts: { ...EMPTY, settings: { pollMinutes: 30 } } });
  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await withTimeout(post('/api/podcasts/settings', { pollMinutes: 0 }));
  assert.strictEqual(failed.status, 500, await failed.text());
  assert.deepStrictEqual(podcastsDb.read().settings, { pollMinutes: 30 }, 'a failed save wrote nothing');
  assert.deepStrictEqual(readPersistedDatabase(DATA_DIR).podcasts.settings, { pollMinutes: 30 }, 'on disk too');
  const ok = await withTimeout(post('/api/podcasts/settings', { pollMinutes: 0 }));
  assert.strictEqual(ok.status, 200, await ok.text());
  assert.deepStrictEqual(podcastsDb.read().settings, { pollMinutes: 0 });
  assert.strictEqual((await (await fetch(`${base}/api/podcasts/settings`)).json()).pollMinutes, 0, 'the GET reads the tables');
});

test('PATCH /api/podcasts/subscriptions/:id: a FAILED doc save leaves the record untouched (500); the committed PATCH lands it and the subscription ORDER survives', async () => {
  const subs = [sub('s2', { order: 2 }), sub('s1', { order: 1 }), sub('s3', { order: 0 })];
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, podcasts: { ...EMPTY, subscriptions: subs } });
  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await withTimeout(patch('/api/podcasts/subscriptions/s1', { name: 'Renamed' }));
  assert.strictEqual(failed.status, 500, await failed.text());
  assert.deepStrictEqual(podcastsDb.read().subscriptions, subs, 'a failed save wrote nothing (order included)');
  const ok = await withTimeout(patch('/api/podcasts/subscriptions/s1', { name: 'Renamed' }));
  assert.strictEqual(ok.status, 200, await ok.text());
  const after = podcastsDb.read().subscriptions;
  assert.deepStrictEqual(after.map((s) => s.id), ['s2', 's1', 's3'], 'the array order is a position column, never a sort');
  assert.strictEqual(after[1].name, 'Renamed');
  assert.deepStrictEqual(readPersistedDatabase(DATA_DIR).podcasts.subscriptions.map((s) => s.id), ['s2', 's1', 's3'], 'on disk too');
  const missing = await withTimeout(patch('/api/podcasts/subscriptions/nope', { name: 'X' }));
  assert.strictEqual(missing.status, 404, 'the skip contract still 404s a phantom');
  const listed = await (await fetch(`${base}/api/podcasts/subscriptions`)).json();
  assert.deepStrictEqual(listed.subscriptions.map((s) => s.id), ['s3', 's1', 's2'], 'the route sorts by `order` on the way out, as before');
});

test('POST /api/podcasts/subscriptions/:id/feed-url: a FAILED doc save answers 500, never a hang (gate pass B, QA W4)', async () => {
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, podcasts: { ...EMPTY, subscriptions: [sub('s1', { feedUrlDisplay: 'https://x.example/rss', feedHost: 'x.example', secretMissing: true })] } });
  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await withTimeout(post('/api/podcasts/subscriptions/s1/feed-url', { feedUrl: 'https://x.example/rss?auth=tok' }));
  assert.strictEqual(failed.status, 500, await failed.text());
  assert.strictEqual(podcastsDb.read().subscriptions[0].secretMissing, true, 'a failed save wrote nothing to the record');
  const ok = await withTimeout(post('/api/podcasts/subscriptions/s1/feed-url', { feedUrl: 'https://x.example/rss?auth=tok' }));
  assert.strictEqual(ok.status, 200, await ok.text());
  assert.strictEqual(podcastsDb.read().subscriptions[0].secretMissing, false);
});

test('DELETE /api/podcasts/episodes/:id (the trash lane): the record flips in the tables; an unchanged pass writes nothing', async () => {
  const showDir = path.join(ROOT, 'Show');
  fs.mkdirSync(showDir, { recursive: true });
  const filePath = path.join(showDir, 'e1.mp3');
  fs.writeFileSync(filePath, 'BYTES');
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, podcasts: { ...EMPTY, subscriptions: [sub('s1')], episodes: { e1: { id: 'e1', subId: 's1', guid: 'g1', title: 'One', status: 'downloaded', filePath, fileName: 'e1.mp3' } } } });
  const r = await withTimeout(fetch(`${base}/api/podcasts/episodes/e1`, { method: 'DELETE' }));
  assert.strictEqual(r.status, 200, await r.text());
  const ep = podcastsDb.read().episodes.e1;
  assert.strictEqual(ep.status, 'trashed');
  assert.ok(ep.trashPath && fs.existsSync(ep.trashPath), 'the bytes moved to the trash the record points at');
  assert.strictEqual(fs.existsSync(filePath), false);
  assert.deepStrictEqual(podcastsDb.syncFrom(podcastsDb.read()), { rowsWritten: 0, rowsDeleted: 0 }, 'the diff, not a rewrite');
  assert.strictEqual(readPersistedDatabase(DATA_DIR).podcasts.episodes.e1.status, 'trashed', 'on disk');
});

test('the retention sweep through the module\'s deps: a FAILED doc save leaves the archive untouched; the committed sweep tombstones and retires the per-user rows', async () => {
  const trashDir = path.join(ROOT, '.filetube-trash');
  fs.mkdirSync(trashDir, { recursive: true });
  const trashPath = path.join(trashDir, '1-e1-e1.mp3');
  fs.writeFileSync(trashPath, 'BYTES');
  const survivor = path.join(trashDir, '1-e2-e2.mp3');
  fs.writeFileSync(survivor, 'BYTES2');
  const now = Date.now();
  seedState({
    folders: [], folderSettings: {}, metadata: {}, settings,
    podcasts: { ...EMPTY, subscriptions: [sub('s1')], episodes: {
      e1: { id: 'e1', subId: 's1', guid: 'g1', title: 'Expired', status: 'trashed', filePath: path.join(ROOT, 'Show', 'e1.mp3'), trashPath, trashedAt: now - 30 * DAY },
      e2: { id: 'e2', subId: 's1', guid: 'g2', title: 'Fresh', status: 'trashed', filePath: path.join(ROOT, 'Show', 'e2.mp3'), trashPath: survivor, trashedAt: now - 1 * DAY },
    } },
  });
  const purged = [];
  const deps = { podcastsDb, updateDatabase, dataDir: DATA_DIR, now: () => now, getSettings: () => settingsStore.get(), userStore: { ...userStore, removePodcastEpisodeState: (ids) => purged.push(...ids) } };
  __failNextSaveForTests(new Error('simulated save failure'));
  await assert.rejects(podcasts.sweepExpiredTrash(deps), /simulated save failure/);
  assert.strictEqual(podcastsDb.read().episodes.e1.status, 'trashed', 'a failed save wrote nothing - the record still says trashed');
  assert.deepStrictEqual(purged, [], 'and the per-user rows were not retired');
  await podcasts.sweepExpiredTrash(deps);
  assert.strictEqual(podcastsDb.read().episodes.e1.status, 'tombstone', 'the committed sweep retired the expired episode');
  assert.strictEqual(podcastsDb.read().episodes.e2.status, 'trashed', 'the fresh one stays');
  assert.deepStrictEqual(purged, ['e1']);
  assert.strictEqual(readPersistedDatabase(DATA_DIR).podcasts.episodes.e1.status, 'tombstone', 'on disk');
});

test('the bundle carries `podcasts` (order included) and a restore round-trips it; a malformed `podcasts` is a 400 BEFORE the wipe; a bundle WITHOUT the key preserves the live archive', async () => {
  const ns = { subscriptions: [sub('b', { order: 1 }), sub('a', { order: 0 })], episodes: { e1: { id: 'e1', subId: 'a', guid: 'g1', title: 'One', status: 'tombstone' } }, settings: { pollMinutes: 15 } };
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, podcasts: ns });
  const bundle = await (await fetch(`${base}/api/admin/backup`)).json();
  delete bundle.users;
  assert.deepStrictEqual(bundle.podcasts, ns, 'verbatim, no feed URLs (they were never in the db)');
  for (const bad of [['x'], { feedUrls: {} }, { episodes: { '': {} } }, { subscriptions: [{ noId: 1 }] }, { settings: ['x'] }]) {
    const r = await withTimeout(post('/api/admin/restore', { ...bundle, podcasts: bad }));
    assert.strictEqual(r.status, 400, `${JSON.stringify(bad)}: ${await r.clone().text()}`);
    assert.deepStrictEqual(podcastsDb.read().subscriptions, ns.subscriptions, 'the live rows survived the refusal');
  }
  podcastsDb.replaceAll({ subscriptions: [sub('scratch')] });
  const r = await post('/api/admin/restore', bundle);
  assert.strictEqual(r.status, 200, await r.text());
  assert.deepStrictEqual(podcastsDb.read(), ns, 'the own export restored verbatim');
  const without = { ...bundle };
  delete without.podcasts;
  assert.strictEqual((await post('/api/admin/restore', without)).status, 200);
  assert.deepStrictEqual(podcastsDb.read(), ns, 'a bundle without the key PRESERVES the archive (every pre-v1.69 export; the no-forced-re-download rule)');
});
