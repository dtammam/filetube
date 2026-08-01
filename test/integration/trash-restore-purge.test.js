'use strict';

// [INTEGRATION] v1.65 t3 -- restore + purge against the REAL app and routes:
// the FULL-FIDELITY round trip (ruling 4: trash -> restore re-links every
// carrier under the ORIGINAL id, queue entry REAPPEARS), the restore-over-
// new-file 409, the retire-tombstone-first discipline (a restored file must
// survive the next scan), restore into a since-deleted folder, verified
// purge (file + sidecars + record + carriers, NO tombstone), and the
// route-alias guard (no collection-wide DELETE /api/trash exists).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashrp-'));
const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, loadDatabase, saveDatabase, updateDatabase,
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
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashrplib-'));
  fs.mkdirSync(path.join(ROOT, 'Chan'), { recursive: true });
  const filePath = path.join(ROOT, 'Chan', 'movie.mp4');
  fs.writeFileSync(filePath, 'movie-bytes');
  const id = getMediaId(filePath);
  saveDatabase({
    folders: [ROOT],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'movie.mp4', title: 'The Movie', filePath, folderName: 'Chan',
        rootFolder: ROOT, size: 11, ext: '.mp4', type: 'video', addedAt: 1700000000000, duration: 90,
      },
    },
    viewCounts: { [id]: 5 },
    settings: { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0 },
  });
  return { id, filePath };
}

const delVideo = (id) => fetch(`${base}/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
const restore = (tid) => fetch(`${base}/api/trash/${encodeURIComponent(tid)}/restore`, { method: 'POST' });
const purge = (tid) => fetch(`${base}/api/trash/${encodeURIComponent(tid)}`, { method: 'DELETE' });
const listTrash = () => fetch(`${base}/api/trash`).then((r) => r.json());

test('FULL-FIDELITY ROUND TRIP: trash via the delete route, restore via the trash route -- every carrier re-links, the queue entry REAPPEARS', async () => {
  const { id, filePath } = seedLibrary();
  userStore.setProgress(uid, id, { timestamp: 44, duration: 90, updatedAt: ISO });
  userStore.addLiked(uid, id, ISO);
  userStore.markWatched(uid, id, ISO);
  userStore.setQueue(uid, [{ uid: 'q1', mediaId: id }], null, 1);
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'thumb');

  const delBody = await (await delVideo(id)).json();
  assert.equal(delBody.trashed, true);
  const tid = delBody.trashId;

  // Mid-state sanity: hidden from the library, listed in trash, queue entry
  // present-but-dead (the read filter hides it).
  const listing = await listTrash();
  assert.equal(listing.total, 1);
  assert.equal(listing.items[0].title, 'The Movie');
  assert.equal(userStore.getQueue(uid).entries[0].mediaId, tid, 'the queue row rode the re-key');

  const resBody = await (await restore(tid)).json();
  assert.equal(resBody.success, true);
  assert.equal(resBody.restoredId, id, 'the restored id IS the pre-trash id (md5 of the same path)');

  assert.ok(fs.existsSync(filePath), 'the file is back at its original path');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'movie-bytes', 'byte-identical');
  const db = loadDatabase();
  assert.equal(db.metadata[id].title, 'The Movie', 'metadata restored from the snapshot');
  assert.equal(db.metadata[id].addedAt, 1700000000000, 'addedAt survives (no stranger re-add)');
  assert.deepEqual(db.trash, {}, 'the trash record is gone');
  assert.equal(db.viewCounts[id], 5, 'the view count came home');
  // Every per-user carrier back under the ORIGINAL id.
  assert.equal(userStore.getOneProgress(uid, id).timestamp, 44, 'resume point re-linked');
  assert.deepEqual(userStore.getLiked(uid), [id], 'the Like re-linked');
  assert.equal(userStore.getWatchedTimes(uid)[id], ISO, 'the watched latch re-linked');
  assert.deepEqual(userStore.getQueue(uid).entries.map((e) => e.mediaId), [id], 'the queue entry REAPPEARED');
  assert.ok(fs.existsSync(path.join(THUMBNAIL_DIR, `${id}.jpg`)), 'the thumbnail re-keyed home');
  const trashLeftovers = fs.readdirSync(path.join(ROOT, TRASH_DIR_NAME));
  assert.deepEqual(trashLeftovers, [], 'the trash dir is empty again');
});

test('restore CONFLICT: a new file at the original path -> 409, trash record and bytes untouched', async () => {
  const { id, filePath } = seedLibrary();
  const tid = (await (await delVideo(id)).json()).trashId;
  fs.writeFileSync(filePath, 'NEW-DIFFERENT-CONTENT');

  const res = await restore(tid);
  assert.equal(res.status, 409);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'NEW-DIFFERENT-CONTENT', 'the new file is untouched');
  const db = loadDatabase();
  assert.ok(db.trash[tid], 'the record is kept');
  assert.ok(fs.existsSync(db.trash[tid].trashPath), 'the trashed bytes are kept');
});

test('RETIRE-TOMBSTONE-FIRST: a tombstone at the original path cannot reap the restored file on the next scan', async () => {
  const { id, filePath } = seedLibrary();
  const tid = (await (await delVideo(id)).json()).trashId;
  // A tombstone lands at the ORIGINAL path post-trash (the removeAnyway-of-
  // a-successor scenario, distilled).
  await updateDatabase((db) => {
    db.deleteTombstones[id] = { filePath, deletedAt: Date.now() + 1000, youtubeId: null };
  });

  const res = await restore(tid);
  assert.equal(res.status, 200);
  assert.deepEqual(loadDatabase().deleteTombstones, {}, 'the destination tombstone was retired BEFORE the link');

  await scanDirectories();
  assert.ok(fs.existsSync(filePath), 'the restored file SURVIVES the scan (hard links preserve mtime -- the guard alone was no defense)');
  assert.ok(loadDatabase().metadata[id], 'and stays indexed');
});

test('restore into a since-deleted folder re-creates the parents', async () => {
  const { id, filePath } = seedLibrary();
  const tid = (await (await delVideo(id)).json()).trashId;
  fs.rmSync(path.join(ROOT, 'Chan'), { recursive: true, force: true });

  const res = await restore(tid);
  assert.equal(res.status, 200);
  assert.ok(fs.existsSync(filePath), 'the folder chain came back with the file');
});

test('PURGE: verified destruction of the file, sidecars, record and carriers -- and NO tombstone', async () => {
  const { id, filePath } = seedLibrary();
  userStore.setProgress(uid, id, { timestamp: 44, duration: 90, updatedAt: ISO });
  userStore.setQueue(uid, [{ uid: 'q1', mediaId: id }], null, 1);
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'thumb');
  // Gate fix binding (adversarial W10): the trash-side subtitle must die
  // with the purge, not linger for the orphan pass.
  fs.writeFileSync(path.join(ROOT, 'Chan', `${path.basename(filePath, '.mp4')}.en.vtt`), 'subs');

  const tid = (await (await delVideo(id)).json()).trashId;
  const trashPath = loadDatabase().trash[tid].trashPath;
  const trashSub = path.join(path.dirname(trashPath), `${path.basename(trashPath, '.mp4')}.en.vtt`);
  assert.ok(fs.existsSync(trashSub), 'precondition: the subtitle rode into trash');

  const res = await purge(tid);
  assert.equal(res.status, 200);
  assert.ok(!fs.existsSync(trashPath), 'the bytes are gone');
  assert.ok(!fs.existsSync(trashSub), 'the trash-side subtitle went too (W10 binding)');
  assert.ok(!fs.existsSync(path.join(THUMBNAIL_DIR, `${tid}.jpg`)), 'the re-keyed thumbnail went too');
  const db = loadDatabase();
  assert.deepEqual(db.trash, {}, 'the record is gone');
  assert.deepEqual(db.deleteTombstones, {}, 'a VERIFIED purge mints NO tombstone');
  assert.equal(userStore.getOneProgress(uid, tid), null, 'carrier rows removed');
  assert.deepEqual(userStore.getQueue(uid).entries, [], 'the queue row removed');

  const again = await purge(tid);
  assert.equal(again.status, 404, 'a second purge of the same id is a clean 404');
});

test('restore of a MISSING trash file: 404 with the purge hint, record KEPT', async () => {
  const { id } = seedLibrary();
  const tid = (await (await delVideo(id)).json()).trashId;
  fs.unlinkSync(loadDatabase().trash[tid].trashPath); // out-of-band cleanup

  const res = await restore(tid);
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /purged/i);
  assert.ok(loadDatabase().trash[tid], 'the record survives for an explicit purge');

  const p = await purge(tid);
  assert.equal(p.status, 200, 'purge tolerates the already-gone bytes');
  assert.deepEqual(loadDatabase().trash, {});
});

test('ROUTE-ALIAS GUARD (the v1.64 lesson, bound): DELETE /api/trash and /api/trash/ match NO route -- nothing collection-wide exists to destroy', async () => {
  const { id } = seedLibrary();
  const tid = (await (await delVideo(id)).json()).trashId;

  const bare = await fetch(`${base}/api/trash`, { method: 'DELETE' });
  const slash = await fetch(`${base}/api/trash/`, { method: 'DELETE' });
  assert.equal(bare.status, 404);
  assert.equal(slash.status, 404);
  assert.ok(loadDatabase().trash[tid], 'the trash record is untouched by both probes');
});
