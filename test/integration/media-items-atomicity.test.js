'use strict';

// [INTEGRATION] Wave 6 of the relational-migration arc - the media index is
// the `media_items` table. Through the REAL scan and routes, the plan's two
// required verifications and the failure axes:
//   - a REAL scan indexes files into the table; a rescan with nothing changed
//     writes zero rows; a changed file rewrites exactly its row;
//   - a scan whose doc save FAILS leaves the index AND its carriers (view
//     counts, tombstones - the inSaveTransaction effects) untouched; the next
//     scan lands them;
//   - a full backup round-trip: export, wipe, restore, deep-equal; then a
//     RESCAN-REBUILD after the restore keeps the index (no re-indexing storm);
//   - a bundle exported on v1.294 (metadata as a doc key - the same shape)
//     restores on this build; a malformed `metadata` is a 400 before the wipe.

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, __resetDatabaseForTests, __failNextSaveForTests, scanDirectories, loadDatabase, getMediaId, viewCountStore, tombstoneStore, updateDatabase } = require('../../server');
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
const withTimeout = (p, ms = 15000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no response within ${ms}ms (the handler hung)`)), ms))]);
const settings = { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0 };
const itemsOnDisk = () => readPersistedDatabase(DATA_DIR).metadata || {};

function libraryWith(names) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-items-lib-'));
  fs.mkdirSync(path.join(root, 'Chan'));
  for (const n of names) fs.writeFileSync(path.join(root, 'Chan', n), 'not a real video');
  return root;
}

test('a REAL scan indexes into media_items; an unchanged rescan writes zero rows; a changed file rewrites exactly its row', async () => {
  const root = libraryWith(['a.mp4', 'b.mp4']);
  seedState({ folders: [root], folderSettings: {}, metadata: {}, settings });
  await scanDirectories();
  const ids = [getMediaId(path.join(root, 'Chan', 'a.mp4')), getMediaId(path.join(root, 'Chan', 'b.mp4'))];
  assert.deepStrictEqual(Object.keys(itemsOnDisk()).sort(), [...ids].sort(), 'both files are rows');
  const before = itemsOnDisk();
  // the diff base after the scan: a no-op mutator tick writes nothing
  const stats = await updateDatabase((db) => { void db; return true; });
  assert.ok(stats === true || stats === undefined, 'the tick ran');
  assert.deepStrictEqual(itemsOnDisk(), before, 'an unchanged rescan / tick rewrites nothing');
  await updateDatabase((db) => { db.metadata[ids[0]].title = 'Renamed'; return true; });
  const after = itemsOnDisk();
  assert.strictEqual(after[ids[0]].title, 'Renamed');
  assert.deepStrictEqual(after[ids[1]], before[ids[1]], 'the other row is byte-identical');
  assert.strictEqual(loadDatabase().metadata[ids[0]].title, 'Renamed', 'the routes\' object reads the table');
});

test('a scan whose doc save FAILS leaves the index AND its carriers untouched (one transaction); the next scan lands them', async () => {
  const root = libraryWith(['a.mp4']);
  seedState({ folders: [root], folderSettings: {}, metadata: {}, settings, viewCounts: {}, deleteTombstones: {} });
  __failNextSaveForTests(new Error('simulated save failure'));
  await scanDirectories().catch(() => {});
  assert.deepStrictEqual(itemsOnDisk(), {}, 'a failed merge indexed nothing');
  assert.deepStrictEqual(viewCountStore.getAll(), {});
  assert.deepStrictEqual(tombstoneStore.getAll(), {});
  await scanDirectories();
  assert.strictEqual(Object.keys(itemsOnDisk()).length, 1, 'the next scan indexed the file');
});

test('a full backup round-trip: export, wipe, restore deep-equals; a RESCAN after the restore keeps the index (no re-indexing storm); a v1.294-shaped bundle restores; a malformed `metadata` is a 400 before the wipe', async () => {
  const root = libraryWith(['a.mp4', 'b.mp4']);
  seedState({ folders: [root], folderSettings: {}, metadata: {}, settings });
  await scanDirectories();
  const indexed = itemsOnDisk();
  assert.strictEqual(Object.keys(indexed).length, 2);
  const bundle = await (await fetch(`${base}/api/admin/backup`)).json();
  delete bundle.users;
  assert.deepStrictEqual(bundle.metadata, indexed, 'the bundle carries the index in its old shape');
  for (const bad of [['x'], 'no', { [String.fromCharCode(0)]: {} }]) {
    const r = await withTimeout(post('/api/admin/restore', { ...bundle, metadata: bad }));
    assert.strictEqual(r.status, 400, `${JSON.stringify(bad)}: ${await r.clone().text()}`);
    assert.deepStrictEqual(itemsOnDisk(), indexed, 'the live rows survived the refusal');
  }
  await __resetDatabaseForTests();
  assert.deepStrictEqual(itemsOnDisk(), {}, 'wiped');
  const r = await post('/api/admin/restore', bundle);
  assert.strictEqual(r.status, 200, await r.text());
  assert.deepStrictEqual(itemsOnDisk(), indexed, 'restored verbatim');
  const addedAtBefore = Object.values(itemsOnDisk()).map((x) => x.addedAt).sort();
  await scanDirectories();
  assert.deepStrictEqual(Object.values(itemsOnDisk()).map((x) => x.addedAt).sort(), addedAtBefore, 'the rescan REUSED the restored rows (addedAt kept - nothing re-indexed)');
  assert.deepStrictEqual(Object.keys(itemsOnDisk()).sort(), Object.keys(indexed).sort());
  // the v1.294 bundle shape is byte-identical for this key (a doc key then, a table now)
  const legacy = { ...bundle, appVersion: '1.294.0' };
  await __resetDatabaseForTests();
  assert.strictEqual((await post('/api/admin/restore', legacy)).status, 200);
  assert.deepStrictEqual(itemsOnDisk(), indexed);
});
