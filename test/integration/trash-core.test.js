'use strict';

// [INTEGRATION] v1.65 t1 -- trashItem() against the REAL app: the atomic
// rename into <root>/.filetube-trash, the one-mutator identity carry
// (db.trash record + doc-table carries + ALL NINE per-user carriers via the
// post-commit rekey), rollback on mutator failure (both the throw and the
// concurrent-delete paths), recoverable-errno classification, the
// source-unlink-failure tombstone, sidecar follow, and -- the resurrection
// class -- the scan NEVER walking the trash dir.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashcore-'));
const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  trashItem, getMediaId, loadDatabase, saveDatabase, updateDatabase,
  scanDirectories, userStore, __resetDatabaseForTests, __mintTestSession,
} = require('../../server');
const { TRASH_DIR_NAME } = require('../../lib/trashPaths');

const ISO = '2026-08-01T12:00:00.000Z';
let ROOT; // a fresh real library root per test
let uid;  // one real user for carrier assertions

function seedLibrary() {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashlib-'));
  fs.mkdirSync(path.join(ROOT, 'Chan'), { recursive: true });
  const filePath = path.join(ROOT, 'Chan', 'video one.mp4');
  fs.writeFileSync(filePath, 'media-bytes-1');
  const id = getMediaId(filePath);
  saveDatabase({
    folders: [ROOT],
    folderSettings: {},
    progress: { [id]: { timestamp: 11, duration: 100 } },
    metadata: {
      [id]: {
        id, name: 'video one.mp4', title: 'video one', filePath,
        folderName: 'Chan', rootFolder: ROOT, size: 13, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 100,
      },
    },
    liked: [id],
    viewCounts: { [id]: 7 },
    settings: { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0 },
  });
  return { id, filePath };
}

const deps = () => ({ loadDatabase, updateDatabase, getMediaId });

beforeEach(async () => {
  await __resetDatabaseForTests();
  if (!uid) uid = __mintTestSession().user.id;
});

test('happy path: atomic move into <root>/.filetube-trash carries the WHOLE identity in one mutator', async () => {
  const { id, filePath } = seedLibrary();
  const res = await trashItem(deps(), id, { nowMs: 1750000000000 });

  assert.equal(res.ok, true);
  assert.equal(res.oldId, id);
  assert.equal(res.sourceUnlinkFailed, false);
  assert.ok(!fs.existsSync(filePath), 'the source dirent is gone');
  assert.ok(fs.existsSync(res.trashPath), 'the bytes live in trash');
  assert.equal(path.dirname(res.trashPath), path.join(ROOT, TRASH_DIR_NAME), 'per-LIBRARY-ROOT trash dir (the ruling)');
  assert.equal(path.basename(res.trashPath), `1750000000000-${id.slice(0, 8)}-video one.mp4`);
  assert.equal(fs.readFileSync(res.trashPath, 'utf8'), 'media-bytes-1', 'byte-identical');

  const db = loadDatabase();
  assert.equal(db.metadata[id], undefined, 'gone from the library');
  const rec = db.trash[res.trashId];
  assert.ok(rec, 'the trash record exists under trashId = md5(trashPath)');
  assert.equal(res.trashId, getMediaId(res.trashPath));
  assert.equal(rec.originalId, id);
  assert.equal(rec.originalPath, filePath);
  assert.equal(rec.trashedAt, 1750000000000);
  assert.equal(rec.item.title, 'video one', 'the full metadata snapshot rides the record');
  // Doc-table id-keyed carries followed the id (the move-mutator list).
  assert.equal(db.progress[id], undefined);
  assert.equal(db.progress[res.trashId].timestamp, 11);
  assert.equal(db.viewCounts[id], undefined);
  assert.equal(db.viewCounts[res.trashId], 7);
  assert.ok(db.liked.includes(res.trashId) && !db.liked.includes(id));
});

test('ALL NINE per-user carriers re-key old -> trash (progress/liked/watched/queue asserted by row)', async () => {
  const { id } = seedLibrary();
  userStore.setProgress(uid, id, { timestamp: 33, duration: 100, updatedAt: ISO });
  userStore.addLiked(uid, id, ISO);
  userStore.markWatched(uid, id, ISO);
  userStore.setQueue(uid, [{ uid: 'q1', mediaId: id }], null, 1);

  const res = await trashItem(deps(), id);
  assert.equal(res.ok, true);

  assert.equal(userStore.getOneProgress(uid, id), null);
  assert.equal(userStore.getOneProgress(uid, res.trashId).timestamp, 33, 'progress followed the re-key');
  assert.deepEqual(userStore.getLiked(uid), [res.trashId], 'the Like followed');
  assert.equal(userStore.getWatchedTimes(uid)[res.trashId], ISO, 'the watched latch followed');
  assert.deepEqual(userStore.getQueue(uid).entries.map((e) => e.mediaId), [res.trashId], 'the queue entry followed');
});

test('RESURRECTION GUARD: a full scan neither re-indexes the trashed file nor touches the trash record', async () => {
  const { id } = seedLibrary();
  // A second, surviving file proves the scan actually ran over the root.
  const keeper = path.join(ROOT, 'Chan', 'keeper.mp4');
  fs.writeFileSync(keeper, 'keeper-bytes');
  const res = await trashItem(deps(), id);
  assert.equal(res.ok, true);

  await scanDirectories();

  const db = loadDatabase();
  assert.ok(db.metadata[getMediaId(keeper)], 'the scan ran and indexed the sibling');
  assert.equal(db.metadata[id], undefined, 'the trashed item did not resurrect under its old id');
  assert.equal(db.metadata[res.trashId], undefined, 'the trash-side file was never indexed');
  assert.ok(db.trash[res.trashId], 'the trash record survived the scan untouched');
  assert.ok(fs.existsSync(res.trashPath), 'the trash-side bytes survived the scan');
});

test('a stray media file hand-placed inside .filetube-trash is INVISIBLE to the walk', async () => {
  seedLibrary();
  const strayDir = path.join(ROOT, TRASH_DIR_NAME, 'nested');
  fs.mkdirSync(strayDir, { recursive: true });
  const stray = path.join(strayDir, 'stray.mp4');
  fs.writeFileSync(stray, 'stray-bytes');

  await scanDirectories();
  assert.equal(loadDatabase().metadata[getMediaId(stray)], undefined);
});

test('mutator THROW rolls the trash-side link back -- original file and library entry untouched', async () => {
  const { id, filePath } = seedLibrary();
  const res = await trashItem({ loadDatabase, getMediaId, updateDatabase: async () => { throw new Error('boom'); } }, id);

  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
  assert.ok(fs.existsSync(filePath), 'the original is untouched');
  const trashDir = path.join(ROOT, TRASH_DIR_NAME);
  const leftovers = fs.existsSync(trashDir) ? fs.readdirSync(trashDir) : [];
  assert.deepEqual(leftovers, [], 'the exclusive link was rolled back');
  assert.ok(loadDatabase().metadata[id], 'the library entry is intact');
});

test('concurrent delete (mutator sees no item) rolls back with a 404 and no trash record', async () => {
  const { id, filePath } = seedLibrary();
  const stale = loadDatabase(); // still carries the item
  await updateDatabase((db) => { delete db.metadata[id]; });

  const res = await trashItem({ loadDatabase: () => stale, updateDatabase, getMediaId }, id);
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
  assert.deepEqual(loadDatabase().trash, {}, 'no trash record was minted');
  const trashDir = path.join(ROOT, TRASH_DIR_NAME);
  const leftovers = fs.existsSync(trashDir) ? fs.readdirSync(trashDir) : [];
  assert.deepEqual(leftovers, [], 'the trash-side link was rolled back');
  assert.ok(fs.existsSync(filePath), 'the file itself is untouched (the concurrent delete owns it)');
});

test('recoverable errno on the trash link -> 409 + code, NOTHING moved or recorded (the read-only-mount contract)', async () => {
  const { id, filePath } = seedLibrary();
  const roFs = new Proxy(fs, {
    get(target, prop) {
      if (prop === 'linkSync') {
        return () => { const e = new Error('EROFS: read-only'); e.code = 'EROFS'; throw e; };
      }
      return target[prop];
    },
  });
  const res = await trashItem({ loadDatabase, updateDatabase, getMediaId, fs: roFs }, id);

  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.equal(res.code, 'EROFS');
  assert.ok(fs.existsSync(filePath));
  assert.ok(loadDatabase().metadata[id], 'the library entry is untouched');
  assert.deepEqual(loadDatabase().trash, {});
});

test('source-unlink failure: trash succeeds, and the leftover dirent gets a deferred-cleanup tombstone', async () => {
  const { id, filePath } = seedLibrary();
  const busyFs = new Proxy(fs, {
    get(target, prop) {
      if (prop === 'unlinkSync') {
        return (p) => {
          if (p === filePath) { const e = new Error('EBUSY: held open'); e.code = 'EBUSY'; throw e; }
          return target.unlinkSync(p);
        };
      }
      return target[prop];
    },
  });
  const res = await trashItem({ loadDatabase, updateDatabase, getMediaId, fs: busyFs }, id);

  assert.equal(res.ok, true);
  assert.equal(res.sourceUnlinkFailed, true);
  assert.ok(fs.existsSync(res.trashPath), 'the bytes are safe in trash');
  assert.ok(fs.existsSync(filePath), 'the leftover dirent is still there (the failure under test)');
  const db = loadDatabase();
  assert.ok(db.trash[res.trashId], 'the trash record committed');
  const tomb = db.deleteTombstones[id];
  assert.ok(tomb, 'the leftover is handed to the scan\'s deferred-delete retry');
  assert.equal(tomb.filePath, filePath);
});

test('sidecars follow the id into trash: thumbnail re-keys, subtitles land beside the trash file (narrow matcher)', async () => {
  const { id, filePath } = seedLibrary();
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'thumb');
  const base = path.basename(filePath, '.mp4');
  fs.writeFileSync(path.join(ROOT, 'Chan', `${base}.en.vtt`), 'subs');
  // A DIFFERENT item's sidecar whose basename merely starts with ours must
  // NOT be stolen (the move's narrow-matcher rule).
  fs.writeFileSync(path.join(ROOT, 'Chan', `${base}.extra.take2.vtt`), 'not-ours');

  const res = await trashItem(deps(), id);
  assert.equal(res.ok, true);

  assert.ok(!fs.existsSync(path.join(THUMBNAIL_DIR, `${id}.jpg`)));
  assert.ok(fs.existsSync(path.join(THUMBNAIL_DIR, `${res.trashId}.jpg`)), 'thumbnail re-keyed to the trash id');
  const trashBase = path.basename(res.trashPath, '.mp4');
  assert.ok(fs.existsSync(path.join(ROOT, TRASH_DIR_NAME, `${trashBase}.en.vtt`)), 'the language-tagged subtitle followed');
  assert.ok(fs.existsSync(path.join(ROOT, 'Chan', `${base}.extra.take2.vtt`)), 'the non-matching sidecar stayed put');
});
