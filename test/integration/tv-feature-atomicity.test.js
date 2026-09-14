'use strict';

// [INTEGRATION] Wave 5 of the relational-migration arc (tv) - the Shows
// namespace is three tables behind a feature store whose writes ride the doc
// commit. Through the REAL routes and scan, populate first, then the failure
// axis, then the happy path:
//   - POST /api/tv/config whose doc save FAILS leaves the root list untouched
//     (and answers 500, never a hang); the committed POST replaces it;
//   - the scan merge whose doc save FAILS leaves the episode rows untouched
//     (a new episode on disk is not indexed, a pruned one not dropped); the
//     committed pass indexes it and writes ONLY the changed rows;
//   - the bundle carries `tv` in its container shape, a restore round-trips
//     it, and a malformed `tv` (an unknown part, a bad episode id) is a 400
//     BEFORE the wipe.

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, __resetDatabaseForTests, __failNextSaveForTests, scanTv, tvDb } = require('../../server');
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
const withTimeout = (p, ms = 4000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no response within ${ms}ms (the handler hung)`)), ms))]);
const settings = { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0 };

test('POST /api/tv/config: a FAILED doc save leaves the root list untouched and answers 500; the committed POST replaces it', async () => {
  const A = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-tv-a-'));
  const B = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-tv-b-'));
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, tv: { folders: [A], episodes: {}, settings: {} } });
  assert.deepStrictEqual(tvDb.read().folders, [A], 'populated');
  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await withTimeout(post('/api/tv/config', { folders: [B] }));
  assert.strictEqual(failed.status, 500, await failed.text());
  assert.deepStrictEqual(tvDb.read().folders, [A], 'a failed save wrote nothing');
  assert.deepStrictEqual(readPersistedDatabase(DATA_DIR).tv.folders, [A], 'on disk too');
  const ok = await withTimeout(post('/api/tv/config', { folders: [B] }));
  assert.strictEqual(ok.status, 200, await ok.text());
  assert.deepStrictEqual(tvDb.read().folders, [B]);
});

test('the scan merge: a FAILED doc save leaves the episode rows untouched; the committed pass indexes the new file and writes only the changed rows', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-tv-scan-'));
  const show = path.join(root, 'Show', 'Season 1');
  fs.mkdirSync(show, { recursive: true });
  fs.writeFileSync(path.join(show, 'Show S01E01.mp4'), 'bytes');
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, tv: { folders: [root], episodes: {}, settings: {} } });
  __failNextSaveForTests(new Error('simulated save failure'));
  await scanTv().catch(() => {}); // the scan reports the failure; the assertion is on the rows
  assert.deepStrictEqual(tvDb.read().episodes, {}, 'a failed merge indexed nothing');
  await scanTv();
  const after = tvDb.read().episodes;
  assert.strictEqual(Object.keys(after).length, 1, 'the committed pass indexed the episode');
  const stats = tvDb.syncFrom(tvDb.read());
  assert.deepStrictEqual(stats, { rowsWritten: 0, rowsDeleted: 0 }, 'an unchanged pass writes nothing (the diff, not a rewrite)');
});

test('the bundle carries `tv` in its container shape and a restore round-trips it; a malformed `tv` is a 400 BEFORE the wipe', async () => {
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, tv: { folders: ['/tv'], episodes: { e1: { id: 'e1', showId: 's', showName: 'S', title: 'One', filePath: '/tv/S/one.mp4', rootFolder: '/tv' } }, settings: { x: 1 } } });
  const bundle = await (await fetch(`${base}/api/admin/backup`)).json();
  delete bundle.users;
  assert.deepStrictEqual(bundle.tv, { folders: ['/tv'], episodes: { e1: { id: 'e1', showId: 's', showName: 'S', title: 'One', filePath: '/tv/S/one.mp4', rootFolder: '/tv' } }, settings: { x: 1 } });
  for (const bad of [['x'], { playlists: {} }, { episodes: { '': {} } }, { folders: ['ok', 7] }, { episodes: ['x'] }]) {
    const r = await withTimeout(post('/api/admin/restore', { ...bundle, tv: bad }));
    assert.strictEqual(r.status, 400, `${JSON.stringify(bad)}: ${await r.clone().text()}`);
    assert.deepStrictEqual(tvDb.read().folders, ['/tv'], 'the live rows survived the refusal');
  }
  tvDb.replaceAll({ folders: ['/scratch'] });
  const r = await post('/api/admin/restore', bundle);
  assert.strictEqual(r.status, 200, await r.text());
  assert.deepStrictEqual(tvDb.read(), bundle.tv, 'the own export restored verbatim');
  const without = { ...bundle };
  delete without.tv;
  const r2 = await post('/api/admin/restore', without);
  assert.strictEqual(r2.status, 200);
  assert.deepStrictEqual(tvDb.read(), { folders: [], episodes: {}, settings: {} }, 'a bundle without the key restores to an empty namespace');
});
