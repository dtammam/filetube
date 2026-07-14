'use strict';

// [INTEGRATION] v1.41.3 deletion tombstones (tech-debt #32 + #35a): a delete
// that reports success WITHOUT verifying the unlink (resolver "gone" on a
// non-round-tripping name, ENOENT alreadyGone, removeAnyway) must not let the
// file resurrect the library entry on the next scan -- the scan retries the
// unlink at its own enumerated (guaranteed-round-tripping) path instead. A
// VERIFIED unlink mints no tombstone at all (adversarial-gate CRITICAL this
// release: tombstoning verified deletes would reap mtime-preserving restores
// -- rsync -a / Syncthing / backup tools). A file the user puts back with
// newer mtime is re-indexed normally either way.
//
// The unverified class is reproduced via the alreadyGone path: remove the
// file from disk before calling DELETE (byte-identical, from the handler's
// point of view, to the false-"already gone" #35a variant -- a raw
// invalid-UTF-8 fixture can't be expressed portably in source; the v1.37.5
// \u-escape lesson extends to bytes that don't round-trip at all).
//
// Isolated DATA_DIR before requiring the app, per the existing pattern
// (test/integration/scan-clobber.test.js).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, scanDirectories, saveDatabase, getMediaId } = require('../../server');

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const rootSkip = isRoot ? 'unlink perms are not enforceable as root' : false;

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function baseSettings() {
  return {
    scanIntervalMinutes: 30,
    pruneMissing: false,
    cacheMaxBytes: null,
    cacheMaxAgeDays: 30,
  };
}

// Seed via the exported `saveDatabase()` (the established primitive; keeps
// the in-process read cache coherent -- see scan-clobber.test.js).
function writeDb(db) {
  saveDatabase(db);
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function seedLibraryWithVideo(libDir, fileName) {
  const filePath = path.join(libDir, fileName);
  fs.writeFileSync(filePath, 'video-bytes');
  const id = getMediaId(filePath);
  writeDb({
    folders: [libDir],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id,
        name: fileName,
        title: fileName,
        filePath,
        folderName: path.basename(libDir),
        size: fs.statSync(filePath).size,
        ext: path.extname(fileName),
        type: 'video',
        addedAt: new Date().toISOString(),
        duration: 12,
        hasThumbnail: false,
        rootFolder: libDir,
        videoCodec: 'h264',
        audioCodec: 'aac',
        needsTranscode: false,
        releaseDate: new Date().toISOString(),
        youtubeId: null,
      },
    },
    liked: [],
    deleteTombstones: {},
    settings: baseSettings(),
  });
  return { filePath, id };
}

// An UNVERIFIED-success delete: the file is gone from disk when the handler
// runs, so it concludes "already gone" -- success without a watched unlink.
async function unverifiedDelete(filePath, id) {
  fs.rmSync(filePath);
  const res = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).success, true);
}

function backdate(filePath, deletedAt) {
  const t = (deletedAt - 60000) / 1000;
  fs.utimesSync(filePath, t, t);
}

beforeEach(() => {
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
});

test('an UNVERIFIED delete (file absent at delete time) mints a tombstone; a VERIFIED unlink mints none', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));

  const un = seedLibraryWithVideo(libDir, 'unverified.mp4');
  await unverifiedDelete(un.filePath, un.id);
  let db = readDb();
  assert.strictEqual(db.metadata[un.id], undefined, 'metadata entry removed');
  assert.ok(db.deleteTombstones[un.id], 'unverified success minted a tombstone');
  assert.strictEqual(db.deleteTombstones[un.id].filePath, un.filePath);
  assert.strictEqual(typeof db.deleteTombstones[un.id].deletedAt, 'number');

  const ok = seedLibraryWithVideo(libDir, 'verified.mp4');
  const res = await fetch(`${base}/api/videos/${ok.id}`, { method: 'DELETE' });
  assert.strictEqual((await res.json()).success, true);
  assert.ok(!fs.existsSync(ok.filePath), 'file really unlinked');
  db = readDb();
  assert.strictEqual(db.deleteTombstones[ok.id], undefined, 'verified unlink minted NO tombstone');
});

test('HEADLINE (the resurrect bug): a file surviving its unverified "successful" delete is removed by the next scan, not re-indexed', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));
  const { filePath, id } = seedLibraryWithVideo(libDir, 'survivor.mp4');

  await unverifiedDelete(filePath, id);

  // The #35a reality: the file was on disk all along (the handler just
  // couldn't see it under its stored spelling) -- same path, pre-delete mtime.
  fs.writeFileSync(filePath, 'video-bytes');
  fs.writeFileSync(path.join(libDir, 'survivor.en.vtt'), 'WEBVTT'); // its subtitle sidecar
  backdate(filePath, readDb().deleteTombstones[id].deletedAt);

  await scanDirectories();

  assert.ok(!fs.existsSync(filePath), 'deferred retry unlinked the survivor');
  assert.ok(!fs.existsSync(path.join(libDir, 'survivor.en.vtt')), 'subtitle sidecar swept too');
  const db = readDb();
  assert.strictEqual(db.metadata[id], undefined, 'entry NOT resurrected');
  assert.strictEqual(db.deleteTombstones[id], undefined, 'tombstone consumed');
});

test('a mtime-preserving RESTORE after a verified delete is indexed normally (no tombstone, no reap)', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));
  const { filePath, id } = seedLibraryWithVideo(libDir, 'restored.mp4');

  const deletedAt = Date.now();
  const res = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
  assert.strictEqual((await res.json()).success, true);

  // rsync -a / Syncthing restore: same content, ORIGINAL (pre-delete) mtime.
  fs.writeFileSync(filePath, 'video-bytes');
  backdate(filePath, deletedAt);

  await scanDirectories();

  assert.ok(fs.existsSync(filePath), 'restored file left alone');
  assert.ok(readDb().metadata[id], 'restored file re-indexed');
});

test('a deliberately re-added file (newer mtime) after an unverified delete is re-indexed and consumes the tombstone', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));
  const { filePath, id } = seedLibraryWithVideo(libDir, 'comeback.mp4');

  await unverifiedDelete(filePath, id);

  fs.writeFileSync(filePath, 'new-video-bytes');
  const t = (readDb().deleteTombstones[id].deletedAt + 60000) / 1000;
  fs.utimesSync(filePath, t, t);

  await scanDirectories();

  assert.ok(fs.existsSync(filePath), 'the new file is left alone');
  const db = readDb();
  assert.ok(db.metadata[id], 'entry re-indexed (user put it back on purpose)');
  assert.strictEqual(db.deleteTombstones[id], undefined, 'tombstone consumed');
});

test('an undeletable survivor is re-indexed honestly (tombstone consumed, no forever-suppress)', { skip: rootSkip }, async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));
  const { filePath, id } = seedLibraryWithVideo(libDir, 'stuck.mp4');

  await unverifiedDelete(filePath, id);

  fs.writeFileSync(filePath, 'video-bytes');
  backdate(filePath, readDb().deleteTombstones[id].deletedAt);
  // Read+execute only: the walk can still enumerate/stat, but unlink
  // (a WRITE on the parent dir) fails -- the EROFS/EACCES-ish shape of #32.
  fs.chmodSync(libDir, 0o555);

  try {
    await scanDirectories();
  } finally {
    fs.chmodSync(libDir, 0o755);
  }

  assert.ok(fs.existsSync(filePath), 'file could not be removed');
  const db = readDb();
  assert.ok(db.metadata[id], 're-indexed honestly rather than hidden');
  assert.strictEqual(db.deleteTombstones[id], undefined, 'tombstone still consumed (one retry per delete)');
});

test('a 409 (read-only, no removeAnyway) mints NO tombstone and leaves the entry intact', { skip: rootSkip }, async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));
  const { filePath, id } = seedLibraryWithVideo(libDir, 'readonly.mp4');

  fs.chmodSync(libDir, 0o555);
  let res;
  try {
    res = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
  } finally {
    fs.chmodSync(libDir, 0o755);
  }
  assert.strictEqual(res.status, 409);

  const db = readDb();
  assert.ok(db.metadata[id], 'library entry untouched');
  assert.strictEqual(db.deleteTombstones[id], undefined, 'no tombstone on a refused delete');
  assert.ok(fs.existsSync(filePath), 'file untouched');
});

test('removeAnyway (transient EBUSY-class failure) mints a tombstone; the next scan finishes the delete once the failure clears', { skip: rootSkip }, async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-lib-'));
  const { filePath, id } = seedLibraryWithVideo(libDir, 'busy.mp4');

  fs.chmodSync(libDir, 0o555);
  let res;
  try {
    res = await fetch(`${base}/api/videos/${id}?removeAnyway=true`, { method: 'DELETE' });
  } finally {
    fs.chmodSync(libDir, 0o755); // the transient condition clears
  }
  const body = await res.json();
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.fileRemainsOnDisk, true);

  const afterDelete = readDb();
  assert.strictEqual(afterDelete.metadata[id], undefined, 'entry removed from the library');
  assert.ok(afterDelete.deleteTombstones[id], 'unverified (removeAnyway) success minted a tombstone');
  assert.ok(fs.existsSync(filePath), 'file deliberately left on disk');
  backdate(filePath, afterDelete.deleteTombstones[id].deletedAt);

  await scanDirectories();

  assert.ok(!fs.existsSync(filePath), 'the deferred retry finished the delete');
  const db = readDb();
  assert.strictEqual(db.metadata[id], undefined, 'entry stays gone');
  assert.strictEqual(db.deleteTombstones[id], undefined, 'tombstone consumed');
});
