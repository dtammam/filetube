'use strict';

// [INTEGRATION] v1.65 t2 -- DELETE /api/videos/:id routes through TRASH:
// the happy path is a trash move (no tombstone, carriers re-keyed, trashed
// response contract), the 409/removeAnyway/already-gone legacy shapes keep
// their exact semantics (tombstone minted, carriers REMOVED), and the
// scan's deferred-delete retry now TRASHES the survivor instead of
// unlinking it (the 8-file incident's recoverable ending).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashroute-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, loadDatabase, saveDatabase,
  scanDirectories, userStore, __resetDatabaseForTests,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { TRASH_DIR_NAME } = require('../../lib/trashPaths');

const ISO = '2026-08-01T12:00:00.000Z';
let server, base, uid;
let ROOT;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  uid = authenticateFetch(server, base).user.id;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await __resetDatabaseForTests();
});

function seedLibrary() {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashroutelib-'));
  fs.mkdirSync(path.join(ROOT, 'Chan'), { recursive: true });
  const filePath = path.join(ROOT, 'Chan', 'clip.mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const id = getMediaId(filePath);
  saveDatabase({
    folders: [ROOT],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'clip.mp4', title: 'clip', filePath, folderName: 'Chan',
        rootFolder: ROOT, size: 10, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 60,
      },
    },
    settings: { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0 },
  });
  return { id, filePath };
}

const del = (id, qs) => fetch(`${base}/api/videos/${encodeURIComponent(id)}${qs || ''}`, { method: 'DELETE' });

test('happy path: DELETE moves to trash -- trashed contract, NO tombstone, carriers RE-KEYED not removed', async () => {
  const { id, filePath } = seedLibrary();
  userStore.setProgress(uid, id, { timestamp: 30, duration: 60, updatedAt: ISO });
  userStore.markWatched(uid, id, ISO);

  const res = await del(id);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.trashed, true);
  assert.equal(body.message, 'Moved to Trash');
  assert.ok(body.trashId, 'the response names the trash record');
  assert.equal(body.fileRemainsOnDisk, undefined, 'the source dirent is genuinely gone');

  assert.ok(!fs.existsSync(filePath));
  const db = loadDatabase();
  assert.equal(db.metadata[id], undefined);
  const rec = db.trash[body.trashId];
  assert.ok(rec && rec.originalPath === filePath);
  assert.ok(fs.existsSync(rec.trashPath), 'bytes live in the trash dir');
  assert.deepEqual(db.deleteTombstones, {}, 'a VERIFIED trash move mints NO tombstone (the v1.41.3 rule at its new home)');
  // The user's history survives the delete now -- re-keyed, not destroyed.
  assert.equal(userStore.getOneProgress(uid, id), null);
  assert.equal(userStore.getOneProgress(uid, body.trashId).timestamp, 30, 'progress re-keyed to the trash id');
  assert.equal(userStore.getWatchedTimes(uid)[body.trashId], ISO, 'watched latch re-keyed');
});

test('read-only location: 409 + code + readOnly, db COMPLETELY untouched (the removeAnyway follow-up contract)', async () => {
  const { id, filePath } = seedLibrary();
  fs.chmodSync(ROOT, 0o555); // mkdir of .filetube-trash under a read-only root -> EACCES
  try {
    const res = await del(id);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.readOnly, true);
    assert.ok(body.code, 'the errno rides the response');
    assert.ok(fs.existsSync(filePath));
    const db = loadDatabase();
    assert.ok(db.metadata[id], 'library entry intact');
    assert.deepEqual(db.trash, {});
    assert.deepEqual(db.deleteTombstones, {});
  } finally {
    fs.chmodSync(ROOT, 0o755);
  }
});

test('removeAnyway on a read-only location: entry leaves the library, file stays, tombstone minted, carriers REMOVED', async () => {
  const { id, filePath } = seedLibrary();
  userStore.setProgress(uid, id, { timestamp: 30, duration: 60, updatedAt: ISO });
  fs.chmodSync(ROOT, 0o555);
  try {
    const res = await del(id, '?removeAnyway=true');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.fileRemainsOnDisk, true);
    assert.equal(body.trashed, undefined, 'nothing reached trash -- the response must not claim it did');

    assert.ok(fs.existsSync(filePath), 'the file was deliberately left');
    const db = loadDatabase();
    assert.equal(db.metadata[id], undefined);
    assert.ok(db.deleteTombstones[id], 'the unverified conclusion tombstones (scan retry will trash it)');
    assert.equal(userStore.getOneProgress(uid, id), null, 'legacy shape removes carriers (no trash record to re-link)');
  } finally {
    fs.chmodSync(ROOT, 0o755);
  }
});

test('already gone: DELETE of an externally-removed file succeeds via the legacy path with a tombstone', async () => {
  const { id, filePath } = seedLibrary();
  fs.unlinkSync(filePath);

  const res = await del(id);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.trashed, undefined);
  const db = loadDatabase();
  assert.equal(db.metadata[id], undefined);
  assert.ok(db.deleteTombstones[id], 'already-gone is unverified -> tombstone');
  assert.deepEqual(db.trash, {});
});

test('DEFERRED RETRY TRASHES: a removeAnyway survivor is moved to trash by the next scan once the mount is writable', async () => {
  const { id, filePath } = seedLibrary();
  fs.chmodSync(ROOT, 0o555);
  try {
    const res = await del(id, '?removeAnyway=true');
    assert.equal(res.status, 200);
  } finally {
    fs.chmodSync(ROOT, 0o755); // the mount is writable again
  }
  assert.ok(fs.existsSync(filePath), 'precondition: the survivor is still there');

  await scanDirectories();

  const db = loadDatabase();
  assert.ok(!fs.existsSync(filePath), 'the retry moved the survivor off its old path');
  assert.equal(db.metadata[id], undefined, 'never re-indexed');
  const recs = Object.values(db.trash);
  assert.equal(recs.length, 1, 'exactly one orphan trash record');
  assert.equal(recs[0].originalPath, filePath);
  assert.equal(recs[0].item.orphanedByDeferredDelete, true, 'marked as the minimal orphan snapshot');
  assert.ok(fs.existsSync(recs[0].trashPath), 'bytes recoverable in trash -- the 8-file incident\'s new ending');
  assert.ok(recs[0].trashPath.includes(TRASH_DIR_NAME));
});
