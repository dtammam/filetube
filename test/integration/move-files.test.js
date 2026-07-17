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
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, loadDatabase, saveDatabase, updateDatabase, moveItemToFolder, transcodedPath,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

// v1.42: seeds go through the exported saveDatabase (the adapter opened at
// require time, so a raw db.json write would be dead); persisted-state
// assertions go through the sanctioned SQLite read helper. An EMPTY doc_kv
// namespace persists as zero rows (absent); backfill the ones this file
// dereferences so `dbAfter.progress[id]`-style reads stay valid.
function readDb() {
  const db = readPersistedDatabase(DATA_DIR);
  for (const ns of ['metadata', 'progress']) {
    if (!db[ns]) db[ns] = {};
  }
  return db;
}

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

function baseSettings() {
  return { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, defaultView: '', autoplayNext: false };
}

function seedItem({ id, filePath, folders, progress }) {
  saveDatabase({
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
  });
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

  const dbAfter = readDb();
  assert.ok(!dbAfter.metadata[oldId], 'the OLD id must no longer be present');
  assert.ok(dbAfter.metadata[newId], 'the NEW (path-derived) id must be present');
  assert.equal(dbAfter.metadata[newId].filePath, newPath);
  assert.equal(dbAfter.metadata[newId].id, newId);

  assert.ok(!dbAfter.progress[oldId], 'watch progress must be moved off the old id');
  assert.deepStrictEqual(dbAfter.progress[newId], { timestamp: 42, duration: 10 }, 'watch progress must survive intact under the new id');

  assert.ok(!fs.existsSync(thumbPath), 'the old thumbnail path must be gone');
  assert.ok(fs.existsSync(path.join(THUMBNAIL_DIR, `${newId}.jpg`)), 'the thumbnail must be re-keyed to the new id');
});

// v1.42 gate CRITICAL (adversarial seat, runnable repro): the extracted
// `viewCounts` namespace is id-keyed exactly like progress/liked and MUST
// follow the re-key — the T3 extraction landed without it, so every move
// zeroed the moved item's view count and orphaned the old row (the v1.41.6
// liked-drop class, striking the very field the extraction protects). All
// three movers (the /move route, the boot one-off migrator, reheat
// relocation) share moveItemToFolder's single re-key mutator, so this one
// lock covers them all.
test('POST /api/videos/:id/move: the VIEW COUNT survives the re-key (no zeroed count, no orphaned old row)', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-vc-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-vc-dst-'));
  const filePath = path.join(srcDir, 'counted.mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const oldId = getMediaId(filePath);
  const newId = getMediaId(path.join(dstDir, 'counted.mp4'));

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir] });
  // Record real views through the real endpoint (not a seeded field).
  await fetch(`${base}/api/videos/${oldId}/view`, { method: 'POST' });
  await fetch(`${base}/api/videos/${oldId}/view`, { method: 'POST' });
  assert.equal(readDb().viewCounts[oldId], 2, 'precondition: two views recorded');

  const res = await fetch(`${base}/api/videos/${oldId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetFolder: dstDir }),
  });
  assert.equal(res.status, 200);

  const dbAfter = readDb();
  assert.equal(dbAfter.viewCounts[newId], 2, 'the count rides the re-key to the new id');
  assert.equal(dbAfter.viewCounts[oldId], undefined, 'no orphaned row under the dead id');

  // And it keeps counting from the surviving value.
  const view = await fetch(`${base}/api/videos/${newId}/view`, { method: 'POST' });
  assert.equal((await view.json()).viewCount, 3);
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

  const dbAfter = readDb();
  assert.ok(dbAfter.metadata[id], 'the db entry must be completely untouched');
  assert.equal(dbAfter.metadata[id].filePath, filePath);
});

test('POST /api/videos/:id/move: 404 for an unknown id, no filesystem side effects', async () => {
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });
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

  const dbAfter = readDb();
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

  saveDatabase({
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
  });

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

  const dbAfter = readDb();
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

  // v1.41.6 gate fix (QA WARNING) -- BEHAVIOR DELIBERATELY CHANGED. This used to
  // leave the file sitting at `newPath` with no db entry, "self-healing on the
  // next scan". That was tolerable when a move meant "into another library
  // folder"; it is NOT tolerable now that a move can land a file in a yt-dlp
  // CHANNEL FOLDER with an `[id]` bracket: the next scan would index the video
  // the user just DELETED straight back into the library, and the DELETE's own
  // tombstone -- keyed on the OLD path's id -- could not suppress it. v1.41.3's
  // "delete stays gone", defeated by a race.
  //
  // The move is now ROLLED BACK: the destination we created exclusively moments
  // ago is removed, and the user's delete stands.
  assert.ok(!fs.existsSync(newPath), 'the exclusively-created destination must be rolled back -- a deleted video must not reappear');
  assert.match(result.error, /rolled back/);
});

test('moveItemToFolder: the RE-KEY mutator THROWING after the FS move already succeeded leaves the SOURCE intact and correctly indexed (v1.41.6: the db is re-keyed before the source is unlinked)', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-db-fail-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-db-fail-dst-'));
  const filePath = path.join(srcDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'clip.mp4');

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir] });

  // v1.41.6: the move now opens TWO mutators -- (1) the pre-move destination
  // tombstone retirement, which must commit BEFORE any byte moves, and (2) the
  // re-key. This harness fails only the SECOND, which is the case under test
  // (a db failure once the filesystem has already changed). Failing the FIRST is
  // covered by its own test below.
  let calls = 0;
  const throwingUpdateDatabase = (fn) => {
    calls += 1;
    if (calls === 1) return updateDatabase(fn);
    return Promise.reject(new Error('simulated db write failure'));
  };

  const result = await moveItemToFolder(
    { loadDatabase, updateDatabase: throwingUpdateDatabase, getMediaId },
    oldId,
    dstDir,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.match(result.error, /the move was rolled back/);
  assert.equal(result.newPath, newPath);

  // v1.41.6 gate fix (QA WARNING -- FS/DB ORDERING + ROLLBACK) -- BEHAVIOR
  // DELIBERATELY CHANGED, TWICE.
  //
  // (a) The re-key now runs BEFORE the source is unlinked, so a failed db write
  //     can no longer strand the db pointing at a path that does not exist (which
  //     cost the item its entire history on the next scan: progress, Like,
  //     addedAt, chapters, the reheat marker -- and, cross-device, a fresh mtime
  //     that also reordered the default release-date sort).
  // (b) The destination is now ROLLED BACK. `updateDatabase` never calls
  //     `saveDatabase` when the mutator throws, and `saveDatabase` writes a temp
  //     file + fsync + ATOMIC rename with only non-throwing assignments after it
  //     -- so on ANY rejection the re-key provably did not land, and the
  //     destination (created moments earlier via an EXCLUSIVE link/copy) is
  //     provably ours to remove. Leaving it behind was not merely untidy: under
  //     the relocation it sits in a channel folder with a native `[id]` name, so
  //     the next scan would index it as a SECOND copy of the same video.
  assert.ok(fs.existsSync(filePath), 'THE SOURCE MUST SURVIVE a failed db write -- it is unlinked only after a COMMITTED re-key');
  assert.ok(!fs.existsSync(newPath), 'and the destination must be rolled back -- otherwise the next scan indexes it as a duplicate item');
  const dbAfter = readDb();
  assert.equal(dbAfter.metadata[oldId].filePath, filePath, 'the db still points at the file that is really there');
  assert.equal(Object.keys(dbAfter.metadata).length, 1, 'exactly one item -- the pre-move state is exactly restored');
});

// ---- v1.41.6: the re-key gaps this function carried for three releases -----
//
// `db.liked` (v1.30) and the `.m4a` background-audio sidecar (v1.35) were both
// added to the app AFTER `moveItemToFolder` was written and never joined its
// re-key. Every move -- this route, and the T4 one-off migration -- therefore
// dropped the item's LIKE (silent data loss: the id in `db.liked` stopped
// matching any item) and orphaned its audio sidecar under the dead id. Found
// while wiring v1.41.6's import-relocation onto the same machinery; fixed at
// the seam, so all three callers get it.

test('v1.41.6 REGRESSION: a LIKED item keeps its Like across a move (db.liked is an array of media ids -- it must follow the re-key)', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-like-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-like-dst-'));
  const filePath = path.join(srcDir, 'liked.mp4');
  fs.writeFileSync(filePath, 'bytes');
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'liked.mp4');
  const newId = getMediaId(newPath);

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir] });
  // A second, UNRELATED liked id -- the re-key must be surgical (in place, same
  // index) and must not disturb the rest of the list or its order.
  await updateDatabase((db) => { db.liked = ['other-id', oldId]; return true; });

  const res = await fetch(`${base}/api/videos/${oldId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetFolder: dstDir }),
  });
  assert.equal(res.status, 200);

  const dbAfter = readDb();
  assert.deepStrictEqual(dbAfter.liked, ['other-id', newId], 'the Like must survive the move under the NEW id, in place');
});

test('v1.41.6 REGRESSION: the .m4a background-audio sidecar follows the move (it was orphaned under the dead id since v1.35)', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-audio-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-audio-dst-'));
  const filePath = path.join(srcDir, 'withaudio.mp4');
  fs.writeFileSync(filePath, 'bytes');
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'withaudio.mp4');
  const newId = getMediaId(newPath);

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir] });

  // The sidecar lives next to the transcode cache, same id-keyed convention.
  const cacheDir = path.dirname(transcodedPath(oldId));
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, `${oldId}.m4a`), 'audio-bytes');

  const res = await fetch(`${base}/api/videos/${oldId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetFolder: dstDir }),
  });
  assert.equal(res.status, 200);

  assert.ok(fs.existsSync(path.join(cacheDir, `${newId}.m4a`)), 'the background-audio sidecar must be re-keyed to the new id');
  assert.ok(!fs.existsSync(path.join(cacheDir, `${oldId}.m4a`)), 'and must not be left orphaned under the old id');
});

test('v1.41.6 REGRESSION: EVERY language subtitle sidecar follows the move, not just the first one the resolver ranks', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-multisub-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-multisub-dst-'));
  const filePath = path.join(srcDir, 'Talk [abcdefghijk].mp4');
  fs.writeFileSync(filePath, 'bytes');
  const oldId = getMediaId(filePath);

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir] });
  fs.writeFileSync(path.join(srcDir, 'Talk [abcdefghijk].en.vtt'), 'WEBVTT\n');
  fs.writeFileSync(path.join(srcDir, 'Talk [abcdefghijk].es.vtt'), 'WEBVTT\n');
  fs.writeFileSync(path.join(srcDir, 'Talk [abcdefghijk].fr.srt'), '1\n');
  // An unrelated item in the same folder whose basename merely BEGINS with ours
  // -- its sidecar must not be dragged along (stealing another item's subtitles
  // is not an acceptable cost of a move).
  fs.writeFileSync(path.join(srcDir, 'Talk [abcdefghijk].part2.mp4'), 'bytes');
  fs.writeFileSync(path.join(srcDir, 'Talk [abcdefghijk].part2.en.vtt'), 'WEBVTT\n');

  const res = await fetch(`${base}/api/videos/${oldId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetFolder: dstDir }),
  });
  assert.equal(res.status, 200);

  assert.ok(fs.existsSync(path.join(dstDir, 'Talk [abcdefghijk].en.vtt')), '.en.vtt must follow');
  assert.ok(fs.existsSync(path.join(dstDir, 'Talk [abcdefghijk].es.vtt')), '.es.vtt must follow too');
  assert.ok(fs.existsSync(path.join(dstDir, 'Talk [abcdefghijk].fr.srt')), 'and the .srt');
  assert.ok(!fs.existsSync(path.join(srcDir, 'Talk [abcdefghijk].es.vtt')), 'no sidecar may be left behind next to a media file that no longer exists');
  assert.ok(fs.existsSync(path.join(srcDir, 'Talk [abcdefghijk].part2.en.vtt')), 'ANOTHER item\'s sidecar must never be claimed by this move');
});

test('v1.41.6: a db failure BEFORE the filesystem is touched (the destination-tombstone retirement) refuses the move outright -- nothing is created, nothing is moved', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-pre-fail-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-move-pre-fail-dst-'));
  const filePath = path.join(srcDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'clip.mp4');

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir] });

  // The FIRST mutator (retiring any deletion tombstone at the destination) is the
  // one thing that makes the destination path safe to occupy. If it cannot be
  // committed, we cannot prove a scan will not reap whatever we put there -- so
  // the move is refused before a single byte moves.
  const result = await moveItemToFolder(
    { loadDatabase, updateDatabase: () => Promise.reject(new Error('simulated db write failure')), getMediaId },
    oldId,
    dstDir,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.match(result.error, /deletion tombstone/);
  assert.ok(fs.existsSync(filePath), 'the source is untouched');
  assert.ok(!fs.existsSync(newPath), 'and nothing was created at the destination');
});
