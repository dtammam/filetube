'use strict';

// [INTEGRATION] Wave 3 of the relational-migration arc - the trash record is
// the ONLY way back for a trashed file, so its writes must be atomic with the
// doc commit they belong to. Through the REAL functions and routes:
//   - a trash move whose doc save FAILS mints NO record, keeps the metadata
//     entry, and leaves the source file in place (the v1.65 rollback-unlink);
//   - a restore whose doc save FAILS keeps the record and re-creates nothing;
//   - a purge whose doc save FAILS keeps the record (the file is already gone -
//     the pre-existing "purged but the record could not be removed" arm);
//   - the retention sweep runs on the typed column: an EXACT-boundary record is
//     kept, an older one is purged, a record without a numeric trashedAt is
//     never auto-swept (the v1.65 rule), and a fresh one survives;
//   - the restore/purge routes resolve the record from the table (the
//     visibility 404 before the 400/200);
//   - a bundle with a NUL-bearing trash id is a 400 BEFORE the wipe.

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  app, trashItem, restoreTrashItem, purgeTrashItem, sweepTrash, getMediaId, scanDirectories,
  loadDatabase, updateDatabase, saveDatabase, __resetDatabaseForTests, __failNextSaveForTests,
  trashStore, progressStore, tombstoneStore,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');
const { TRASH_DIR_NAME } = require('../../lib/trashPaths');

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
const DAY = 86400000;
const settings = (over) => ({ scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, trashRetentionDays: 30, ...over });

function seedLibrary(over) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-w3atom-'));
  fs.mkdirSync(path.join(root, 'Chan'));
  const filePath = path.join(root, 'Chan', 'video one.mp4');
  fs.writeFileSync(filePath, 'media-bytes-1');
  const id = getMediaId(filePath);
  saveDatabase({
    folders: [root], folderSettings: {}, liked: [], settings: settings(over),
    metadata: { [id]: { id, name: 'video one.mp4', title: 'video one', filePath, folderName: 'Chan', rootFolder: root, size: 13, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 100 } },
  });
  return { id, filePath, root };
}

test('trash move: a FAILED doc save mints NO record - the entry, the source file and the carriers are all intact (populate, then the failure axis)', async () => {
  const { id, filePath } = seedLibrary();
  progressStore.set(id, { timestamp: 11, duration: 100 });
  assert.strictEqual(trashStore.size(), 0);
  __failNextSaveForTests(new Error('simulated save failure'));
  const tr = await trashItem(deps(), id);
  assert.strictEqual(tr.ok, false, JSON.stringify(tr));
  assert.strictEqual(trashStore.size(), 0, 'no record was minted outside the failed transaction');
  assert.ok(loadDatabase().metadata[id], 'the entry is still in the library');
  assert.ok(fs.existsSync(filePath), 'the source file is still in place');
  assert.deepStrictEqual(fs.existsSync(path.join(path.dirname(filePath), '..', TRASH_DIR_NAME)) ? fs.readdirSync(path.join(path.dirname(filePath), '..', TRASH_DIR_NAME)) : [], [], 'the rollback-unlink left no leftover in the trash dir');
  assert.deepStrictEqual(progressStore.get(id), { timestamp: 11, duration: 100 }, 'the position never re-keyed');

  // The same move, allowed to commit: record + entry removal + carriers in one commit.
  const ok = await trashItem(deps(), id);
  assert.strictEqual(ok.ok, true, JSON.stringify(ok));
  assert.ok(trashStore.get(ok.trashId), 'record minted');
  assert.strictEqual(trashStore.get(ok.trashId).originalPath, filePath);
  assert.strictEqual(loadDatabase().metadata[id], undefined);
  assert.deepStrictEqual(progressStore.get(ok.trashId), { timestamp: 11, duration: 100 });
});

test('restore: a FAILED doc save keeps the record and re-creates nothing; then a clean restore retires it in the same commit that re-creates the entry', async () => {
  const { id, filePath } = seedLibrary();
  const tr = await trashItem(deps(), id);
  assert.strictEqual(tr.ok, true);
  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await restoreTrashItem(deps(), tr.trashId);
  assert.strictEqual(failed.ok, false, JSON.stringify(failed));
  assert.ok(trashStore.get(tr.trashId), 'the record survived the failed restore');
  assert.strictEqual(loadDatabase().metadata[id], undefined, 'no entry was re-created outside the failed transaction');

  const ok = await restoreTrashItem(deps(), tr.trashId);
  assert.strictEqual(ok.ok, true, JSON.stringify(ok));
  assert.strictEqual(trashStore.has(tr.trashId), false, 'the record retired');
  assert.ok(loadDatabase().metadata[id], 'the entry is back');
  assert.ok(fs.existsSync(filePath), 'the file is back');
  assert.strictEqual(tombstoneStore.has(tr.trashId), false);
});

test('purge: a FAILED doc save keeps the record (the pre-existing "purged but the record could not be removed" arm); a clean purge removes record + carriers', async () => {
  const { id } = seedLibrary();
  const tr = await trashItem(deps(), id);
  assert.strictEqual(tr.ok, true);
  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await purgeTrashItem(deps(), tr.trashId);
  assert.strictEqual(failed.ok, false, JSON.stringify(failed));
  assert.ok(trashStore.get(tr.trashId), 'the record survived the failed purge');
  const ok = await purgeTrashItem(deps(), tr.trashId);
  assert.strictEqual(ok.ok, true, JSON.stringify(ok));
  assert.strictEqual(trashStore.size() + progressStore.size() + tombstoneStore.size(), 0, 'no orphan row anywhere');
});

test('retention sweep on the typed column: exact boundary kept, older purged, malformed never auto-swept, fresh survives', async () => {
  const { root } = seedLibrary({ trashRetentionDays: 30 });
  const trashDir = path.join(root, TRASH_DIR_NAME);
  fs.mkdirSync(trashDir, { recursive: true });
  const now = Date.now();
  const mk = (name, trashedAt) => {
    const trashPath = path.join(trashDir, name);
    fs.writeFileSync(trashPath, 'bytes');
    const tid = getMediaId(trashPath);
    trashStore.set(tid, { originalId: 'o-' + name, originalPath: path.join(root, 'Chan', name), trashPath, trashedAt, rootFolder: root, item: { id: 'o-' + name, title: name, filePath: path.join(root, 'Chan', name) } });
    return tid;
  };
  const boundary = mk('boundary.mp4', now - 30 * DAY);      // now - trashedAt == maxAge -> NOT purged (strict >)
  const older = mk('older.mp4', now - 30 * DAY - 1);        // one ms past -> purged
  const malformed = mk('malformed.mp4', 'not-a-number');    // never auto-swept
  const fresh = mk('fresh.mp4', now - 1 * DAY);
  const purged = await sweepTrash(now);
  assert.strictEqual(purged, 1, 'exactly the one-ms-past record was purged');
  assert.strictEqual(trashStore.has(older), false);
  assert.strictEqual(trashStore.has(boundary), true, 'the exact boundary is kept');
  assert.strictEqual(trashStore.has(malformed), true, 'a malformed record is never auto-swept (v1.65)');
  assert.strictEqual(trashStore.has(fresh), true);
  assert.ok(fs.existsSync(trashStore.get(malformed).trashPath), 'the malformed record\'s bytes are referenced and kept');
});

test('deferred-retry mint (the scan trashing a tombstoned survivor): a FAILED doc save mints NO record and leaves no trash-dir leftover - the survivor stays on disk and indexes honestly', async () => {
  // The adversarial seat's probe (M11b): with the mint outside the transaction,
  // a phantom Trash row pointed at a rolled-back path while the item was back
  // in the library, and its restore 409'd forever.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-w3-retry-'));
  fs.mkdirSync(path.join(root, 'Chan'));
  const filePath = path.join(root, 'Chan', 'survivor.mp4');
  fs.writeFileSync(filePath, 'survivor-bytes');
  const old = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(filePath, old, old); // mtime older than the delete -> the retry TRASHES it
  const id = getMediaId(filePath);
  saveDatabase({ folders: [root], folderSettings: {}, liked: [], metadata: {}, settings: settings({ pruneMissing: true }) });
  tombstoneStore.set(id, { filePath, deletedAt: Date.now(), youtubeId: null });
  __failNextSaveForTests(new Error('orphan-mint save refused'));
  await scanDirectories();
  assert.strictEqual(trashStore.size(), 0, 'no record was minted outside the failed transaction');
  assert.ok(fs.existsSync(filePath), 'the survivor is still on disk');
  const trashDir = path.join(root, TRASH_DIR_NAME);
  assert.deepStrictEqual(fs.existsSync(trashDir) ? fs.readdirSync(trashDir) : [], [], 'no leftover in the trash dir (the rollback-unlink)');
  assert.ok(loadDatabase().metadata[id], 'the survivor was indexed honestly by the same scan');

  // Positive control (the failure axis above is vacuous unless the retry
  // REACHES the mint): the same shape with the save allowed mints the record
  // and moves the file.
  const filePath2 = path.join(root, 'Chan', 'survivor-two.mp4');
  fs.writeFileSync(filePath2, 'survivor-bytes-2');
  fs.utimesSync(filePath2, old, old);
  const id2 = getMediaId(filePath2);
  tombstoneStore.set(id2, { filePath: filePath2, deletedAt: Date.now(), youtubeId: null });
  await scanDirectories();
  assert.strictEqual(trashStore.size(), 1, 'the retry reached the mint and it committed');
  assert.ok(!fs.existsSync(filePath2), 'the survivor moved to the trash dir');
  assert.strictEqual(loadDatabase().metadata[id2], undefined);
});

test('routes: restore/purge resolve the record from the table (missing -> 404, present -> the real outcome)', async () => {
  const { id } = seedLibrary();
  const tr = await trashItem(deps(), id);
  assert.strictEqual((await fetch(`${base}/api/trash/does-not-exist/restore`, { method: 'POST' })).status, 404);
  assert.strictEqual((await fetch(`${base}/api/trash/does-not-exist`, { method: 'DELETE' })).status, 404);
  const list = await (await fetch(`${base}/api/trash`)).json();
  assert.ok(list.items.some((it) => it.trashId === tr.trashId), 'the trash list reads the table');
  const restored = await fetch(`${base}/api/trash/${encodeURIComponent(tr.trashId)}/restore`, { method: 'POST' });
  assert.strictEqual(restored.status, 200, await restored.text());
  assert.strictEqual(trashStore.has(tr.trashId), false);
  assert.ok(readPersistedDatabase(DATA_DIR).metadata[id]);
});

test('restore validation: a NUL-bearing trash id is a 400 BEFORE the wipe - the live record survives', async () => {
  const { id } = seedLibrary();
  const tr = await trashItem(deps(), id);
  const good = await (await fetch(`${base}/api/admin/backup`)).json();
  delete good.users;
  assert.ok(good.trash && good.trash[tr.trashId], 'the bundle carries the record from the table');
  const NUL = String.fromCharCode(0);
  const r = await fetch(`${base}/api/admin/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...good, trash: { ['a' + NUL + 'b']: good.trash[tr.trashId] } }) });
  assert.strictEqual(r.status, 400, await r.text());
  assert.ok(trashStore.get(tr.trashId), 'the live record survived the refusal');
  const ok = await fetch(`${base}/api/admin/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(good) });
  assert.strictEqual(ok.status, 200, await ok.text());
  assert.deepStrictEqual(trashStore.getAll(), good.trash, 'the own export restored verbatim');
});
