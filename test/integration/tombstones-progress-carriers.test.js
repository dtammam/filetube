'use strict';

// [INTEGRATION] Wave 2 of the relational-migration arc - the gate's donated
// bindings for the two record stores, through the REAL functions and routes.
// Every case was a SURVIVING mutant at the first gate round (adversarial
// W1-W4, QA W2/W3), so each populates FIRST and then drives the reap / re-key /
// refuse axis:
//   - trash: the frozen position rides id -> trashId; tombstones at BOTH ids
//     retire (the trashId one via a predicted trash target);
//   - restore: the position rides trashId -> originalId; the trashId tombstone
//     retires;
//   - purge: position + tombstone under the trashId are gone;
//   - move: the stale tombstone under the OLD id is dropped;
//   - the delete route's mint applies the growth bound INSIDE the delete;
//   - the scan's LIVE re-verify: a tombstone retired AFTER the Phase-1
//     snapshot must not reap the file at its path (the v1.41.6 guard);
//   - a tombstone minted MID-SCAN survives the final merge;
//   - adoption: createFirstAdmin reads the table (every legacy shape);
//   - restore validation refuses hostile progress/tombstone shapes with a
//     400 BEFORE the wipe (NUL id, array/string/number tombstone records...).

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  app, trashItem, restoreTrashItem, purgeTrashItem, moveItemToFolder, scanDirectories, getMediaId,
  loadDatabase, updateDatabase, __resetDatabaseForTests, __clearUsersForTests,
  progressStore, tombstoneStore, inSaveTransaction, userStore, DELETE_TOMBSTONE_CAP,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { computeTrashTarget } = require('../../lib/trashPaths');
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
const tomb = (p) => ({ filePath: p, deletedAt: Date.now(), youtubeId: null });

function seedLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-w2carriers-'));
  fs.mkdirSync(path.join(root, 'Chan'));
  fs.mkdirSync(path.join(root, 'Other'));
  const filePath = path.join(root, 'Chan', 'video one.mp4');
  fs.writeFileSync(filePath, 'media-bytes-1');
  const id = getMediaId(filePath);
  seedState({
    folders: [root], folderSettings: {}, liked: [], settings,
    metadata: { [id]: { id, name: 'video one.mp4', title: 'video one', filePath, folderName: 'Chan', rootFolder: root, size: 13, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 100 } },
  });
  progressStore.replaceAll({ [id]: { timestamp: 11, duration: 100 } });
  tombstoneStore.replaceAll({});
  return { id, filePath, root };
}

test('trash: the frozen position rides id -> trashId and the tombstones under BOTH ids retire, inside the trash mutator', async () => {
  const { id, filePath, root } = seedLibrary();
  tombstoneStore.set(id, tomb(filePath));
  const tr = await trashItem(deps(), id);
  assert.strictEqual(tr.ok, true, JSON.stringify(tr));
  assert.strictEqual(progressStore.get(id), undefined, 'no position under the dead id');
  assert.deepStrictEqual(progressStore.get(tr.trashId), { timestamp: 11, duration: 100 }, 'the position rode to the trashId');
  assert.strictEqual(tombstoneStore.has(id), false, 'the stale tombstone under the source id retired');

  // A tombstone already sitting under the (predictable) trashId retires too.
  const rs = await restoreTrashItem(deps(), tr.trashId);
  assert.strictEqual(rs.ok, true, JSON.stringify(rs));
  const nowMs = Date.now() + 5000;
  const predicted = getMediaId(computeTrashTarget(filePath, id, root, nowMs).trashPath);
  tombstoneStore.set(predicted, tomb('/predicted'));
  const tr2 = await trashItem(deps(), id, { nowMs });
  assert.strictEqual(tr2.ok, true, JSON.stringify(tr2));
  assert.strictEqual(tr2.trashId, predicted, 'the second trash lands at the predicted trashId (the probe assumption holds)');
  assert.strictEqual(tombstoneStore.has(predicted), false, 'the tombstone under the trashId retired');
});

test('restore: the position rides trashId -> originalId and the trashId tombstone retires; purge: both rows under the trashId are gone', async () => {
  const { id, filePath } = seedLibrary();
  const tr = await trashItem(deps(), id);
  assert.strictEqual(tr.ok, true);
  tombstoneStore.set(tr.trashId, tomb(tr.trashPath));
  assert.ok(progressStore.get(tr.trashId), 'precondition: the position sits under the trashId');
  const rs = await restoreTrashItem(deps(), tr.trashId);
  assert.strictEqual(rs.ok, true, JSON.stringify(rs));
  assert.strictEqual(progressStore.get(tr.trashId), undefined, 'no position left under the trashId');
  assert.deepStrictEqual(progressStore.get(id), { timestamp: 11, duration: 100 }, 'the position came home');
  assert.strictEqual(tombstoneStore.has(tr.trashId), false, 'the trashId tombstone retired');
  assert.ok(fs.existsSync(filePath), 'sanity: the file is back');

  const tr3 = await trashItem(deps(), id);
  assert.strictEqual(tr3.ok, true);
  tombstoneStore.set(tr3.trashId, tomb(tr3.trashPath));
  assert.ok(progressStore.get(tr3.trashId), 'precondition: position under the trashId');
  const pg = await purgeTrashItem(deps(), tr3.trashId);
  assert.strictEqual(pg.ok, true, JSON.stringify(pg));
  assert.strictEqual(progressStore.get(tr3.trashId), undefined, 'purge removed the position');
  assert.strictEqual(tombstoneStore.has(tr3.trashId), false, 'purge removed the tombstone');
  assert.strictEqual(progressStore.size() + tombstoneStore.size(), 0, 'no orphan row anywhere');
});

test('move: the position re-keys and the stale tombstone under the OLD id is dropped', async () => {
  const { id, filePath, root } = seedLibrary();
  tombstoneStore.set(id, tomb(filePath));
  const mv = await moveItemToFolder(deps(), id, path.join(root, 'Other'));
  assert.strictEqual(mv.ok, true, JSON.stringify(mv));
  const newId = getMediaId(path.join(root, 'Other', 'video one.mp4'));
  assert.strictEqual(progressStore.get(id), undefined);
  assert.deepStrictEqual(progressStore.get(newId), { timestamp: 11, duration: 100 });
  assert.strictEqual(tombstoneStore.has(id), false, 'the stale tombstone under the old id is gone');
});

test('delete route: the mint applies the growth bound INSIDE the delete (CAP rows + 1 mint -> the OLDEST is pruned)', async () => {
  const goneId = 'gone1';
  seedState({
    folders: [DATA_DIR], folderSettings: {}, liked: [], settings,
    metadata: { [goneId]: { id: goneId, title: 'g', name: 'g.mp4', filePath: path.join(DATA_DIR, 'g.mp4'), folderName: 'M', rootFolder: DATA_DIR, type: 'video', ext: '.mp4', duration: 1, size: 1, addedAt: 1 } },
  });
  const NOW = Date.now();
  const many = {};
  for (let i = 0; i < DELETE_TOMBSTONE_CAP; i++) many[`t${String(i).padStart(4, '0')}`] = { filePath: `/${i}`, deletedAt: NOW - 100000 + i, youtubeId: null };
  tombstoneStore.replaceAll(many);
  const del = await fetch(`${base}/api/videos/${goneId}`, { method: 'DELETE' });
  assert.strictEqual(del.status, 200, await del.text());
  assert.ok(tombstoneStore.has(goneId), 'minted');
  assert.strictEqual(tombstoneStore.size(), DELETE_TOMBSTONE_CAP, 'the cap holds after the mint');
  assert.strictEqual(tombstoneStore.has('t0000'), false, 'the OLDEST was pruned');
  assert.strictEqual(tombstoneStore.has('t0001'), true);
});

// Observe the scan's Phase-1 snapshot moment by wrapping the exported store's
// getAll (server.js calls through the same object); the concurrent mutator
// fires right after it.
function snapshotHook() {
  const real = tombstoneStore.getAll;
  let resolve;
  const taken = new Promise((r) => { resolve = r; });
  let calls = 0;
  tombstoneStore.getAll = function () { const out = real.apply(this, arguments); calls++; if (calls === 1) resolve(); return out; };
  return { taken, restore: () => { tombstoneStore.getAll = real; } };
}
const baseSettings = () => ({ scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30, trashRetentionDays: 30 });

test('scan LIVE re-verify: a tombstone retired AFTER the Phase-1 snapshot must NOT reap the file at its path (the v1.41.6 guard reads the live table)', async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-w2-reverify-'));
  const OLD = new Date(Date.now() - 7 * 24 * 3600e3);
  const tombed = path.join(lib, 'tombed.mp4');
  fs.writeFileSync(tombed, 'tombed-bytes');
  fs.utimesSync(tombed, OLD, OLD); // mtime OLDER than deletedAt -> the reap arm
  fs.writeFileSync(path.join(lib, 'newer.mp4'), 'newer-bytes'); // processed first (recency order) -> the yield point
  const idT = getMediaId(tombed);
  seedState({ folders: [lib], folderSettings: {}, metadata: {}, liked: [], settings: baseSettings() });
  tombstoneStore.set(idT, tomb(tombed));
  const hook = snapshotHook();
  const scan = scanDirectories();
  await hook.taken;
  hook.restore();
  // The move's mutator-A shape: retire in its own committed transaction, mid-scan.
  await updateDatabase(() => { if (!tombstoneStore.has(idT)) return false; inSaveTransaction(() => tombstoneStore.remove(idT)); return true; });
  assert.strictEqual(tombstoneStore.has(idT), false, 'retired mid-scan');
  await scan;
  assert.ok(fs.existsSync(tombed), 'the file was NOT reaped');
  assert.ok(!fs.existsSync(path.join(lib, '.filetube-trash')), 'nor trashed');
  const db = readPersistedDatabase(DATA_DIR);
  assert.ok(db.metadata && db.metadata[idT], 'the file was indexed honestly');
});

test('scan Phase-1 snapshot: a tombstone minted MID-SCAN survives the final merge while the snapshot tombstone is consumed', async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-w2-midscan-'));
  const OLD = new Date(Date.now() - 7 * 24 * 3600e3);
  fs.writeFileSync(path.join(lib, 'keep.mp4'), 'keep-bytes');
  const gone = path.join(lib, 'gone.mp4');
  const idG = getMediaId(gone); // never on disk: a metadata-only item
  const consumedFile = path.join(lib, 'consumed.mp4');
  fs.writeFileSync(consumedFile, 'c');
  fs.utimesSync(consumedFile, OLD, OLD);
  const idC = getMediaId(consumedFile);
  seedState({
    folders: [lib], folderSettings: {}, liked: [], settings: baseSettings(),
    metadata: { [idG]: { id: idG, title: 'gone', name: 'gone.mp4', filePath: gone, folderName: path.basename(lib), rootFolder: lib, type: 'video', ext: '.mp4', size: 1, addedAt: 1, duration: 1 } },
  });
  tombstoneStore.set(idC, tomb(consumedFile)); // the scan WILL consume this one (reap)
  const hook = snapshotHook();
  const scan = scanDirectories();
  await hook.taken;
  hook.restore();
  // A hard delete of the metadata-only item lands mid-scan (the route's shape).
  await updateDatabase((db) => { delete db.metadata[idG]; inSaveTransaction(() => { tombstoneStore.set(idG, tomb(gone)); tombstoneStore.prune(); }); return true; });
  await scan;
  assert.ok(tombstoneStore.has(idG), `the mid-scan tombstone SURVIVES the final merge (${JSON.stringify(Object.keys(tombstoneStore.getAll()))})`);
  assert.ok(!tombstoneStore.has(idC) && !fs.existsSync(consumedFile), 'the snapshot tombstone was consumed (file reaped)');
  const db = readPersistedDatabase(DATA_DIR);
  assert.ok(!(db.metadata && db.metadata[idG]), 'the deleted id stays deleted');
});

test('adoption: createFirstAdmin reads the frozen record from its table - every legacy shape lands in user_progress exactly as before', async () => {
  __clearUsersForTests();
  const FIX = {
    full: { timestamp: 5, duration: 10, updatedAt: '2026-07-01T00:00:00.000Z' },
    tsonly: { timestamp: 7 },
    pos: { position: 42 },
    bare: 918, // a bare number was never adopted (skipped) - unchanged
  };
  seedState({ folders: [], folderSettings: {}, metadata: Object.fromEntries(Object.keys(FIX).map((id) => [id, { id, name: `${id}.mp4` }])), liked: [], settings: {} });
  progressStore.replaceAll(FIX);
  const res = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'adopter', displayName: 'A', password: 'a-good-password' }) });
  assert.strictEqual(res.status, 200, await res.text());
  const admin = userStore.getByUsername('adopter');
  const row = (id) => { const r = userStore.getOneProgress(admin.id, id); return r ? { timestamp: r.timestamp, duration: r.duration, updatedAt: r.updatedAt } : null; };
  assert.deepStrictEqual(row('full'), { timestamp: 5, duration: 10, updatedAt: '2026-07-01T00:00:00.000Z' });
  assert.strictEqual(row('tsonly').timestamp, 7);
  assert.strictEqual(row('tsonly').duration, 0);
  assert.strictEqual(row('pos').timestamp, 0, 'a {position} record adopts as 0/0 (pre-existing rule)');
  assert.strictEqual(row('bare'), null, 'a bare number is skipped (pre-existing rule)');
  assert.deepStrictEqual(progressStore.getAll(), FIX, 'the frozen record is left in place after adoption (the v1.43 contract)');
  // __clearUsersForTests wiped the suite's admin: re-authenticate the fetch
  // wrapper against a fresh one for the cases that follow.
  authenticateFetch(server, base);
});

test('restore validation: hostile progress / tombstone shapes are a 400 BEFORE the wipe - the live rows survive every refusal', async () => {
  seedState({ folders: [DATA_DIR], folderSettings: {}, liked: [], metadata: { v: { id: 'v', title: 'v', filePath: path.join(DATA_DIR, 'v.mp4'), folderName: 'M', rootFolder: DATA_DIR, type: 'video', ext: '.mp4' } }, settings });
  progressStore.replaceAll({ v: { timestamp: 3 } });
  tombstoneStore.replaceAll({ t: { filePath: '/t', deletedAt: 1 } });
  const good = await (await fetch(`${base}/api/admin/backup`)).json();
  delete good.users;
  const NUL = String.fromCharCode(0);
  const hostile = [
    ['progress', ['x']], ['progress', 'x'], ['progress', { '': 1 }], ['progress', { ['a' + NUL + 'b']: 1 }],
    ['deleteTombstones', ['x']], ['deleteTombstones', 'x'], ['deleteTombstones', { t: null }], ['deleteTombstones', { t: 5 }],
    ['deleteTombstones', { t: ['x'] }], ['deleteTombstones', { t: 'flat' }], ['deleteTombstones', { ['a' + NUL + 'b']: { filePath: '/x' } }],
  ];
  for (const [key, value] of hostile) {
    const r = await fetch(`${base}/api/admin/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...good, [key]: value }),
    });
    assert.strictEqual(r.status, 400, `refused before the wipe: ${key}=${JSON.stringify(value)} -> ${r.status} ${await r.text()}`);
    assert.deepStrictEqual(progressStore.getAll(), { v: { timestamp: 3 } }, 'the live progress survived');
    assert.deepStrictEqual(tombstoneStore.getAll(), { t: { filePath: '/t', deletedAt: 1 } }, 'the live tombstone survived');
  }
  // An instance's OWN export always restores - including a null progress record.
  progressStore.set('nul', null);
  const own = await (await fetch(`${base}/api/admin/backup`)).json();
  delete own.users;
  const ok = await fetch(`${base}/api/admin/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(own) });
  assert.strictEqual(ok.status, 200, await ok.text());
  assert.deepStrictEqual(progressStore.getAll(), { nul: null, v: { timestamp: 3 } }, 'the export restored verbatim, null included');
});
