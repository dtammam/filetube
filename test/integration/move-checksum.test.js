'use strict';

// [INTEGRATION][MOVES USER FILES] v1.41.7 (Dean has NO media backup) --
// CHECKSUM verification on `moveItemToFolder`'s cross-filesystem (EXDEV) branch.
//
// WHY THIS EXISTS: Dean cannot back up his media. On the SAME filesystem a move
// is `linkSync` -- a hard link, same inode, no bytes copied, inherently safe.
// ACROSS filesystems (his media on a NAS, the download dir local) it becomes
// copy -> verify -> unlink-the-source. Verifying only the SIZE lets a silently
// corrupted copy that happens to land at the right length pass -- and then the
// ONLY other copy of an irreplaceable file is deleted. v1.41.7 replaces the
// size-only check with a streaming sha256 of BOTH files; the source is unlinked
// ONLY on an exact digest match.
//
// This suite drives `moveItemToFolder` directly with an injected `deps.fs` (the
// SAME seam the v1.41.6 EXDEV test uses) so the cross-device path is
// deterministic in CI without two real filesystems. It asserts:
//   - checksum MATCH -> the move completes normally (source unlinked, re-keyed);
//   - checksum MISMATCH -> the source SURVIVES, the corrupt destination is
//     removed, and the move fails (so the reheat batch counts it failed);
//   - the SAME-filesystem `linkSync` path NEVER hashes (it must not pay the cost
//     -- a hard link is the same inode, there is nothing to compare).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cksum-'));
const DATA_DIR = process.env.DATA_DIR;

const { test } = require('node:test');
const assert = require('node:assert');
const {
  getMediaId, loadDatabase, saveDatabase, updateDatabase, moveItemToFolder,
} = require('../../server');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

// v1.42: persisted-state assertions go through the sanctioned SQLite read
// helper (a second, read-only connection). An empty metadata namespace
// persists as zero rows (absent), hence the backfill.
function readDb() {
  const db = readPersistedDatabase(DATA_DIR);
  if (!db.metadata) db.metadata = {};
  return db;
}

function baseSettings() {
  return { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, defaultView: '', autoplayNext: false };
}

// v1.42: the seed goes through the exported saveDatabase (the adapter opened
// at require time, so a raw db.json write would be dead).
function seedItem({ id, filePath, folders }) {
  saveDatabase({
    folders,
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: path.basename(filePath, path.extname(filePath)),
        filePath, folderName: path.basename(path.dirname(filePath)), size: 5, ext: path.extname(filePath),
        type: 'video', addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
      },
    },
    liked: [],
    deleteTombstones: {},
    settings: baseSettings(),
  });
}

// An fs facade that forces the EXDEV/copy branch (linkSync always throws EXDEV
// for the move-under-test) while every other primitive is the real one, plus a
// `createReadStream` counter so a test can prove whether hashing happened.
function exdevFs(filePath, newPath, counter, opts = {}) {
  return Object.assign({}, fs, {
    linkSync(from, to) {
      if (from === filePath && to === newPath) {
        const err = new Error('cross-device link');
        err.code = 'EXDEV';
        throw err;
      }
      return fs.linkSync(from, to);
    },
    copyFileSync(from, to, flags) {
      fs.copyFileSync(from, to, flags);
      // Optionally CORRUPT the destination after copying -- same byte length,
      // different content: exactly the failure the checksum exists to catch.
      if (opts.corruptDest && to === newPath) {
        const size = fs.statSync(to).size;
        fs.writeFileSync(to, Buffer.alloc(size, 0x00));
      }
    },
    createReadStream(p, streamOpts) {
      counter.reads += 1;
      return fs.createReadStream(p, streamOpts);
    },
  });
}

test('moveItemToFolder EXDEV: a checksum MATCH completes the move normally (source unlinked, destination re-keyed) -- and hashes BOTH files', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cksum-ok-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cksum-ok-dst-'));
  const filePath = path.join(srcDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'the-real-video-bytes');
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'clip.mp4');
  const newId = getMediaId(newPath);

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir] });

  const counter = { reads: 0 };
  const result = await moveItemToFolder(
    { loadDatabase, updateDatabase, getMediaId, fs: exdevFs(filePath, newPath, counter) },
    oldId, dstDir,
  );

  assert.equal(result.ok, true, 'a verified copy must succeed');
  assert.equal(result.newId, newId);
  assert.ok(!fs.existsSync(filePath), 'the source is unlinked only after the checksum matched');
  assert.equal(fs.readFileSync(newPath, 'utf8'), 'the-real-video-bytes', 'the destination holds the intact bytes');
  assert.equal(counter.reads, 2, 'the EXDEV path hashes BOTH the source and the destination (2 read streams)');

  const dbAfter = readDb();
  assert.ok(!dbAfter.metadata[oldId] && dbAfter.metadata[newId], 'the db must be re-keyed onto the new path');
});

test('moveItemToFolder EXDEV: a checksum MISMATCH (same size, corrupt bytes) leaves the SOURCE untouched, removes the corrupt destination, and FAILS the move', async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cksum-bad-src-'));
  const dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cksum-bad-dst-'));
  const filePath = path.join(srcDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'the-real-video-bytes');
  const oldId = getMediaId(filePath);
  const newPath = path.join(dstDir, 'clip.mp4');

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir] });

  const counter = { reads: 0 };
  const result = await moveItemToFolder(
    { loadDatabase, updateDatabase, getMediaId, fs: exdevFs(filePath, newPath, counter, { corruptDest: true }) },
    oldId, dstDir,
  );

  assert.equal(result.ok, false, 'a corrupt copy must NOT be accepted');
  assert.equal(result.status, 500);
  assert.match(result.error, /checksum mismatch/i);

  // The whole point: the ONLY good copy -- the source -- must survive intact.
  assert.ok(fs.existsSync(filePath), 'the source file must be LEFT UNTOUCHED on a checksum mismatch (no backup exists)');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'the-real-video-bytes');
  assert.ok(!fs.existsSync(newPath), 'the corrupt destination copy must be removed');

  // The db entry must be untouched too -- the re-key mutator never ran.
  const dbAfter = readDb();
  assert.ok(dbAfter.metadata[oldId], 'the item must still be indexed under its ORIGINAL id/path');
  assert.equal(dbAfter.metadata[oldId].filePath, filePath);
});

test('moveItemToFolder SAME filesystem: the linkSync (hard-link) path NEVER hashes -- there is nothing to compare, and it must not pay the cost', async () => {
  // Both dirs under the SAME tmpdir => a real hard link succeeds, so the EXDEV
  // branch (the only place hashing happens) is never entered.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cksum-samefs-'));
  const srcDir = path.join(root, 'src'); fs.mkdirSync(srcDir);
  const dstDir = path.join(root, 'dst'); fs.mkdirSync(dstDir);
  const filePath = path.join(srcDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'hardlink-bytes');
  const oldId = getMediaId(filePath);

  seedItem({ id: oldId, filePath, folders: [srcDir, dstDir] });

  const counter = { reads: 0 };
  // Real linkSync (not overridden) so the same-device path is taken; only the
  // createReadStream counter is instrumented.
  const countingFs = Object.assign({}, fs, {
    createReadStream(p, streamOpts) { counter.reads += 1; return fs.createReadStream(p, streamOpts); },
  });

  const result = await moveItemToFolder(
    { loadDatabase, updateDatabase, getMediaId, fs: countingFs },
    oldId, dstDir,
  );

  assert.equal(result.ok, true, 'the same-filesystem hard-link move must succeed');
  assert.equal(counter.reads, 0, 'the same-filesystem path must NEVER hash -- a hard link is the same inode, nothing to compare');
});
