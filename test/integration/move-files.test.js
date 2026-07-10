'use strict';

// [INTEGRATION] C1 (v1.24 UX Round, Wave 3) -- `POST /api/videos/:id/move` +
// `moveItemToFolder`. FOCUSED two-reviewer gate (path confinement + scan
// interaction) -- see docs/exec-plans/active/2026-07-09-v1.24-ux-round.md's
// Design -> C1 section.
//
// Isolated DATA_DIR before requiring the app so this suite never reads or
// writes real project data -- own process per file (node --test), mirroring
// test/integration/api.test.js / scan-delete-reconcile.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, loadDatabase, saveDatabase, updateDatabase, moveItemToFolder,
} = require('../../server');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

function baseSettings() {
  return { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, defaultView: '', autoplayNext: false };
}

function seedItem({ id, filePath, folders, progress }) {
  fs.writeFileSync(DB_FILE, JSON.stringify({
    folders,
    folderSettings: {},
    progress: progress || {},
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: path.basename(filePath, path.extname(filePath)),
        filePath, folderName: path.basename(path.dirname(filePath)), size: 5, ext: path.extname(filePath),
        type: 'video', addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
      },
    },
    settings: baseSettings(),
  }, null, 2), 'utf8');
}

test('POST /api/videos/:id/move: happy path re-keys metadata/progress and renames the thumbnail sidecar', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-dst-'));
  const filePath = path.join(srcDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'clip.mp4');
  const newId = getMediaId(newPath);

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir], progress: { [oldId]: { timestamp: 42, duration: 10 } } });

  const thumbPath = path.join(THUMBNAIL_DIR, `${oldId}.jpg`);
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(thumbPath, 'thumb-bytes');

  const res = await fetch(`${base}/api/videos/${oldId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetFolder: dstDir }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.id, newId);
  assert.equal(json.filePath, newPath);

  assert.ok(!fs.existsSync(filePath), 'the file must be gone from its old location');
  assert.ok(fs.existsSync(newPath), 'the file must exist at the new location');

  const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.ok(!dbAfter.metadata[oldId], 'the OLD id must no longer be present');
  assert.ok(dbAfter.metadata[newId], 'the NEW (path-derived) id must be present');
  assert.equal(dbAfter.metadata[newId].filePath, newPath);
  assert.equal(dbAfter.metadata[newId].id, newId);

  assert.ok(!dbAfter.progress[oldId], 'watch progress must be moved off the old id');
  assert.deepStrictEqual(dbAfter.progress[newId], { timestamp: 42, duration: 10 }, 'watch progress must survive intact under the new id');

  assert.ok(!fs.existsSync(thumbPath), 'the old thumbnail path must be gone');
  assert.ok(fs.existsSync(path.join(THUMBNAIL_DIR, `${newId}.jpg`)), 'the thumbnail must be re-keyed to the new id');
});

// ---- T16 completion follow-up (v1.24 UX Round): the REAL yt-dlp subtitle
// sidecar shape (`<base>.<lang>.vtt`, e.g. "Title [id].en.vtt" per
// OUTPUT_TEMPLATE) must migrate alongside the media file, not just the
// bare `<base>.vtt`/`<base>.srt` shapes. Uses `findSubtitleSidecar`'s own
// priority order (lib/subtitles.js) via the HTTP route, mirroring the
// happy-path thumbnail test above.
test('POST /api/videos/:id/move: a yt-dlp-shaped `.en.vtt` subtitle sidecar is renamed alongside the media file, preserving its language suffix', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-sub-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-sub-dst-'));
  const filePath = path.join(srcDir, 'Title [abc123].mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'Title [abc123].mp4');
  const newId = getMediaId(newPath);

  const subPath = path.join(srcDir, 'Title [abc123].en.vtt');
  fs.writeFileSync(subPath, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n');

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir] });

  const res = await fetch(`${base}/api/videos/${oldId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetFolder: dstDir }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.id, newId);

  const newSubPath = path.join(dstDir, 'Title [abc123].en.vtt');
  assert.ok(!fs.existsSync(subPath), 'the old-path subtitle sidecar must be gone, not orphaned');
  assert.ok(fs.existsSync(newSubPath), 'the subtitle sidecar must exist at the new path, language suffix intact');
  assert.equal(fs.readFileSync(newSubPath, 'utf8'), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n', 'the sidecar content must survive the move unchanged');
});

test('POST /api/videos/:id/move: a bare `.srt` subtitle sidecar (no yt-dlp language tag) is also renamed alongside the media file', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-sub2-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-sub2-dst-'));
  const filePath = path.join(srcDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'clip.mp4');
  const newId = getMediaId(newPath);

  const subPath = path.join(srcDir, 'clip.srt');
  fs.writeFileSync(subPath, '1\n00:00:00,000 --> 00:00:01,000\nHi\n');

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir] });

  const res = await fetch(`${base}/api/videos/${oldId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetFolder: dstDir }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.id, newId);

  const newSubPath = path.join(dstDir, 'clip.srt');
  assert.ok(!fs.existsSync(subPath), 'the old-path .srt sidecar must be gone');
  assert.ok(fs.existsSync(newSubPath), 'the .srt sidecar must exist at the new path');
});

test('POST /api/videos/:id/move: a target outside every configured folder is rejected (400) BEFORE any filesystem change', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-src2-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-outside-'));
  const filePath = path.join(srcDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const id = getMediaId(filePath);

  // outsideDir is deliberately NOT in `folders` -- not an allowed mount.
  seedItem({ id, filePath, folders: [srcDir] });

  const res = await fetch(`${base}/api/videos/${id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetFolder: outsideDir }),
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.match(json.error, /outside/i);

  assert.ok(fs.existsSync(filePath), 'the source file must be untouched');
  assert.equal(fs.readdirSync(outsideDir).length, 0, 'nothing was ever written into the disallowed target');

  const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.ok(dbAfter.metadata[id], 'the db entry must be completely untouched');
  assert.equal(dbAfter.metadata[id].filePath, filePath);
});

test('POST /api/videos/:id/move: 404 for an unknown id, no filesystem side effects', async () => {
  fs.writeFileSync(DB_FILE, JSON.stringify({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() }, null, 2));
  const res = await fetch(`${base}/api/videos/does-not-exist/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetFolder: '/tmp' }),
  });
  assert.equal(res.status, 404);
});

test('POST /api/videos/:id/move: 409 when a file already exists at the destination (never silently overwrites)', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-src3-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-dst3-'));
  const filePath = path.join(srcDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const id = getMediaId(filePath);
  // A DIFFERENT, unrelated file already sits at the would-be destination.
  fs.writeFileSync(path.join(dstDir, 'clip.mp4'), 'unrelated-existing-bytes');

  seedItem({ id, filePath, folders: [srcDir, dstDir] });

  const res = await fetch(`${base}/api/videos/${id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetFolder: dstDir }),
  });
  assert.equal(res.status, 409);
  assert.ok(fs.existsSync(filePath), 'the source file must be untouched on a collision');
  assert.equal(fs.readFileSync(path.join(dstDir, 'clip.mp4'), 'utf8'), 'unrelated-existing-bytes', 'the pre-existing destination file must be untouched');
});

// ---- Cross-device (EXDEV) fallback: copy+unlink, exercised directly (not
// over HTTP) via an injected `deps.fs` so the fallback path is deterministic
// without needing two real filesystems in CI. ----

test('moveItemToFolder: EXDEV on the exclusive link falls back to an exclusive (COPYFILE_EXCL) copy+unlink, ending in the IDENTICAL db.metadata shape a same-device link would produce', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-exdev-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-exdev-dst-'));
  const filePath = path.join(srcDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'clip.mp4');
  const newId = getMediaId(newPath);

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir], progress: { [oldId]: { timestamp: 7, duration: 10 } } });

  // Mocks `linkSync` (the primary, same-device write) rather than
  // `renameSync` -- `moveItemToFolder` no longer calls `renameSync` at all
  // (FIX-1: atomic-exclusive link/copy instead of a rename behind a
  // TOCTOU'd `existsSync` pre-check).
  const fakeFs = Object.assign({}, fs, {
    linkSync(from, to) {
      if (from === filePath && to === newPath) {
        const err = new Error('cross-device link');
        err.code = 'EXDEV';
        throw err;
      }
      return fs.linkSync(from, to);
    },
  });

  const result = await moveItemToFolder({ loadDatabase, updateDatabase, getMediaId, fs: fakeFs }, oldId, dstDir);
  assert.equal(result.ok, true);
  assert.equal(result.newId, newId);

  assert.ok(!fs.existsSync(filePath), 'the source must be unlinked after the copy fallback');
  assert.ok(fs.existsSync(newPath), 'the copy must land at the destination');
  assert.equal(fs.readFileSync(newPath, 'utf8'), 'clip-bytes');

  const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.ok(!dbAfter.metadata[oldId]);
  assert.ok(dbAfter.metadata[newId]);
  assert.equal(dbAfter.metadata[newId].filePath, newPath);
  assert.deepStrictEqual(dbAfter.progress[newId], { timestamp: 7, duration: 10 });
});

// ---- FIX 1 (two-reviewer gate, HIGH -- data loss): close the TOCTOU
// overwrite race. The pre-check (`existsSync(newPath)`) alone cannot prevent
// a clobber -- two concurrent movers can both observe "destination absent"
// before either one writes. This test simulates exactly that race window
// deterministically (rather than relying on a real thread/process race,
// which is nondeterministic and would flake in CI): an injected `deps.fs`
// makes `existsSync` ALWAYS report "absent" -- i.e. every caller passes the
// fast-path exactly as two real concurrent racers both would -- while every
// other FS primitive still touches the REAL filesystem. If the WRITE itself
// were not atomically exclusive, the second call would silently clobber the
// first mover's file. It must not: it must fail with the same 409 shape,
// and the first mover's bytes at the destination must be byte-for-byte
// unchanged.
test('moveItemToFolder: TOCTOU race -- two moves that both pass the existsSync fast-path (destination created between the check and the write) still cannot clobber each other', async () => {
  const srcDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-race-src1-'));
  const srcDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-race-src2-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-race-dst-'));
  const file1 = path.join(srcDir1, 'clip.mp4');
  const file2 = path.join(srcDir2, 'clip.mp4');
  fs.writeFileSync(file1, 'first-mover-bytes');
  fs.writeFileSync(file2, 'second-mover-bytes');
  const id1 = getMediaId(file1);
  const id2 = getMediaId(file2);
  const newPath = path.join(dstDir, 'clip.mp4');
  const newId1 = getMediaId(newPath);

  fs.writeFileSync(DB_FILE, JSON.stringify({
    folders: [srcDir1, srcDir2, dstDir],
    folderSettings: {},
    progress: {},
    metadata: {
      [id1]: {
        id: id1, name: 'clip.mp4', title: 'clip', filePath: file1, folderName: path.basename(srcDir1),
        size: 5, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
      },
      [id2]: {
        id: id2, name: 'clip.mp4', title: 'clip', filePath: file2, folderName: path.basename(srcDir2),
        size: 5, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
      },
    },
    settings: baseSettings(),
  }, null, 2), 'utf8');

  // Simulates BOTH racers having already passed the "does it exist?"
  // fast-path (the actual filesystem may or may not agree by the time each
  // call reaches this point -- that's the whole point of a TOCTOU race).
  const raceFs = Object.assign({}, fs, {
    existsSync: () => false,
  });

  const firstResult = await moveItemToFolder({ loadDatabase, updateDatabase, getMediaId, fs: raceFs }, id1, dstDir);
  assert.equal(firstResult.ok, true, 'the first mover must win the exclusive create');
  assert.equal(fs.readFileSync(newPath, 'utf8'), 'first-mover-bytes');

  const secondResult = await moveItemToFolder({ loadDatabase, updateDatabase, getMediaId, fs: raceFs }, id2, dstDir);
  assert.equal(secondResult.ok, false, 'the second mover must lose -- not silently overwrite');
  assert.equal(secondResult.status, 409);

  // The destination must still hold the FIRST mover's bytes, byte-for-byte.
  assert.equal(fs.readFileSync(newPath, 'utf8'), 'first-mover-bytes', 'the destination must be untouched by the losing mover');
  // The second mover's own source file must be untouched too (never unlinked
  // on a losing/failed move).
  assert.ok(fs.existsSync(file2), 'the losing mover\'s source file must still exist, untouched');
  assert.equal(fs.readFileSync(file2, 'utf8'), 'second-mover-bytes');

  const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.ok(dbAfter.metadata[newId1], 'the winning mover\'s new id must be recorded');
  assert.ok(dbAfter.metadata[id2], 'the losing mover\'s db entry must be untouched (still under its old id/path)');
  assert.equal(dbAfter.metadata[id2].filePath, file2);
});

// ---- FIX 6: lock the two documented `moveItemToFolder` failure branches
// (behavior-preserving regression locks, not new behavior). ----

test('moveItemToFolder: a concurrent DELETE landing between the initial load and the updateDatabase mutator returns the existing 404, and the already-physically-moved file stays at newPath (self-heals on the next scan)', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-race-delete-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-race-delete-dst-'));
  const filePath = path.join(srcDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'clip.mp4');

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir] });

  // Injected `updateDatabase`: simulates a concurrent DELETE landing in the
  // window between `moveItemToFolder`'s initial `loadDatabase()` read (used
  // for the confinement/target check, well before any FS write) and this
  // mutator call -- remove the item from the REAL, on-disk db right now,
  // THEN hand off to the real `updateDatabase` so the mutator's own fresh
  // read sees the item already gone, exactly as a real concurrent delete
  // would produce.
  const deletingUpdateDatabase = (mutatorFn) => {
    const db = loadDatabase();
    delete db.metadata[oldId];
    saveDatabase(db);
    return updateDatabase(mutatorFn);
  };

  const result = await moveItemToFolder(
    { loadDatabase, updateDatabase: deletingUpdateDatabase, getMediaId },
    oldId,
    dstDir,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.match(result.error, /removed before the move could be recorded/);

  // Locked, DOCUMENTED current behavior: the physical move already completed
  // before the mutator ran, and is NOT rolled back on this race. The file
  // simply sits at its new path with no db entry until the next scan finds
  // and re-adds it (a legitimate fresh add -- there is no surviving prior db
  // entry left to re-key or preserve progress for; the delete already won).
  assert.ok(!fs.existsSync(filePath), 'the source is gone -- the move itself already completed on disk');
  assert.ok(fs.existsSync(newPath), 'the file must still exist at newPath, self-healing on the next scan');
});

test('moveItemToFolder: the updateDatabase mutator THROWING after the FS move already succeeded returns the "moved on disk but database update failed" response, file physically at newPath', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-db-fail-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-db-fail-dst-'));
  const filePath = path.join(srcDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'clip.mp4');

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir] });

  const throwingUpdateDatabase = () => Promise.reject(new Error('simulated db write failure'));

  const result = await moveItemToFolder(
    { loadDatabase, updateDatabase: throwingUpdateDatabase, getMediaId },
    oldId,
    dstDir,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.match(result.error, /File moved on disk but the database update failed/);
  assert.equal(result.newPath, newPath);

  // The FS move itself is NOT rolled back on a db-write failure -- the file
  // is left correctly relocated on disk (the caller's error message says so
  // explicitly), even though the db is now stale until the next scan.
  assert.ok(!fs.existsSync(filePath), 'the FS move already happened, despite the db update failing');
  assert.ok(fs.existsSync(newPath), 'the file is physically at newPath despite the db failure');
});
