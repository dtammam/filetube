'use strict';

// [INTEGRATION] Wave 4 of the relational-migration arc (third group) - the
// FROZEN pre-auth likes are a table (media_liked) and the three trash-side
// carriers re-key / remove the row INSIDE the doc commit. Through the REAL
// functions, populate first, then the failure axis, then the happy path:
//   - trash: a FAILED doc save leaves the like on the ORIGINAL id (no
//     half-carried row); the committed move carries it to the trashId, in
//     its slot;
//   - restore: a FAILED doc save leaves the like on the trashId; the committed
//     restore carries it back;
//   - purge: a FAILED doc save keeps the like; the committed purge drops it;
//   - the bundle round-trips the list in like order, and a malformed `liked`
//     is a 400 BEFORE the wipe.

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  app, trashItem, restoreTrashItem, purgeTrashItem, getMediaId,
  loadDatabase, updateDatabase, __resetDatabaseForTests, __failNextSaveForTests, likedStore,
} = require('../../server');
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
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => __resetDatabaseForTests());

const deps = () => ({ loadDatabase, updateDatabase, getMediaId });
const settings = { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, trashRetentionDays: 30 };

function seedLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-liked-carry-'));
  fs.mkdirSync(path.join(root, 'Chan'));
  const filePath = path.join(root, 'Chan', 'liked one.mp4');
  fs.writeFileSync(filePath, 'media-bytes-1');
  const id = getMediaId(filePath);
  seedState({
    folders: [root], folderSettings: {}, settings,
    liked: ['before', id, 'after'], // populate: the like sits in the MIDDLE slot
    metadata: { [id]: { id, name: 'liked one.mp4', title: 'liked one', filePath, folderName: 'Chan', rootFolder: root, size: 13, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 100 } },
  });
  return { id, filePath, root };
}

test('trash / restore / purge carry the frozen like INSIDE the doc commit: a failed save leaves it where it was, a committed one moves it and keeps its slot', async () => {
  const { id } = seedLibrary();
  assert.deepStrictEqual(likedStore.list(), ['before', id, 'after']);

  __failNextSaveForTests(new Error('simulated save failure'));
  const failedTrash = await trashItem(deps(), id);
  assert.strictEqual(failedTrash.ok, false, JSON.stringify(failedTrash));
  assert.deepStrictEqual(likedStore.list(), ['before', id, 'after'], 'a failed trash carries nothing');

  const tr = await trashItem(deps(), id);
  assert.strictEqual(tr.ok, true, JSON.stringify(tr));
  assert.deepStrictEqual(likedStore.list(), ['before', tr.trashId, 'after'], 'the like followed the item into the trash, in its slot');
  assert.deepStrictEqual(readPersistedDatabase(DATA_DIR).liked, ['before', tr.trashId, 'after'], 'on disk too');

  __failNextSaveForTests(new Error('simulated save failure'));
  const failedRestore = await restoreTrashItem(deps(), tr.trashId);
  assert.strictEqual(failedRestore.ok, false, JSON.stringify(failedRestore));
  assert.deepStrictEqual(likedStore.list(), ['before', tr.trashId, 'after'], 'a failed restore carries nothing');

  const ok = await restoreTrashItem(deps(), tr.trashId);
  assert.strictEqual(ok.ok, true, JSON.stringify(ok));
  assert.deepStrictEqual(likedStore.list(), ['before', id, 'after'], 'and back out of it, same slot');

  const tr2 = await trashItem(deps(), id);
  assert.strictEqual(tr2.ok, true);
  __failNextSaveForTests(new Error('simulated save failure'));
  const failedPurge = await purgeTrashItem(deps(), tr2.trashId);
  assert.strictEqual(failedPurge.ok, false, JSON.stringify(failedPurge));
  assert.deepStrictEqual(likedStore.list(), ['before', tr2.trashId, 'after'], 'a failed purge keeps the like');
  const purged = await purgeTrashItem(deps(), tr2.trashId);
  assert.strictEqual(purged.ok, true, JSON.stringify(purged));
  assert.deepStrictEqual(likedStore.list(), ['before', 'after'], 'the purge dropped the like');
});

test('the bundle carries `liked` in like order and a restore round-trips it; a malformed `liked` is a 400 BEFORE the wipe', async () => {
  seedLibrary();
  const bundle = await (await fetch(`${base}/api/admin/backup`)).json();
  delete bundle.users;
  assert.deepStrictEqual(bundle.liked, likedStore.list());
  assert.strictEqual(bundle.liked.length, 3);
  likedStore.replaceAll(['scratch']);
  for (const bad of ['nope', ['ok', ''], ['ok', 7], ['a' + String.fromCharCode(0)]]) {
    const r = await fetch(`${base}/api/admin/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...bundle, liked: bad }) });
    assert.strictEqual(r.status, 400, `${JSON.stringify(bad)}: ${await r.clone().text()}`);
    assert.deepStrictEqual(likedStore.list(), ['scratch'], 'the live rows survived the refusal');
  }
  const r = await fetch(`${base}/api/admin/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) });
  assert.strictEqual(r.status, 200, await r.text());
  assert.deepStrictEqual(likedStore.list(), bundle.liked, 'the own export restored verbatim, in order');
  const without = { ...bundle };
  delete without.liked;
  const r2 = await fetch(`${base}/api/admin/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(without) });
  assert.strictEqual(r2.status, 200);
  assert.deepStrictEqual(likedStore.list(), [], 'a bundle without the key restores to an empty list (the bundle is the whole state)');
});

test('move: a FAILED doc save leaves the frozen like on the OLD id (no half-carried row); the committed move carries it in its slot (adversarial pass A W4)', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-mv-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-mv-dst-'));
  const filePath = path.join(srcDir, 'liked.mp4');
  fs.writeFileSync(filePath, 'bytes');
  const oldId = getMediaId(filePath);
  const newId = getMediaId(path.join(dstDir, 'liked.mp4'));
  seedState({
    folders: [srcDir, dstDir], folderSettings: {}, liked: ['other-id', oldId, 'after'], settings,
    metadata: { [oldId]: { id: oldId, name: 'liked.mp4', title: 'liked', filePath, folderName: path.basename(srcDir), rootFolder: srcDir, size: 5, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 10 } },
  });
  const move = () => fetch(`${base}/api/videos/${oldId}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetFolder: dstDir }) });
  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await move();
  assert.strictEqual(failed.status, 500, await failed.text());
  assert.ok(loadDatabase().metadata[oldId], 'the item is still under the OLD id');
  assert.deepStrictEqual(likedStore.list(), ['other-id', oldId, 'after'], 'a failed move carries nothing - the like still points at the item that exists');
  assert.ok(fs.existsSync(filePath), 'the file did not move either');
  const ok = await move();
  assert.strictEqual(ok.status, 200, await ok.text());
  assert.deepStrictEqual(likedStore.list(), ['other-id', newId, 'after'], 'the committed move carried the like, same slot');
});
