'use strict';

// [INTEGRATION] HR1b (finding D): DELETE-vs-scan membership reconciliation.
// Isolated DATA_DIR before requiring the app so the suite never reads or
// writes real project data -- own process per file (node --test), mirroring
// test/integration/scan-clobber.test.js / scan-prune.test.js.
//
// Timing note (same model as scan-clobber.test.js): with FFmpeg unavailable
// (the expected CI condition per docs/CONTRIBUTING.md),
// `extractMetadataAndThumbnail`'s promise settles SYNCHRONOUSLY inside its own
// executor, so `await extractMetadataAndThumbnail(...)` for a genuinely-new
// file defers the scan's continuation by exactly ONE microtask tick. Firing a
// concurrent `updateDatabase` DELETE-equivalent call SYNCHRONOUSLY, in the
// SAME tick as `scanDirectories()` (before awaiting it), enqueues it onto the
// `dbWriteChain` BEFORE the scan's own Phase-2 mutator (which only gets
// enqueued once the extraction await resolves) -- deterministically landing
// the delete in the exact window finding D concerns: after Phase 1 built
// `newMetadata` from the pre-delete snapshot, before Phase 2's fresh-in-lock
// merge. This is the same construction test/integration/scan-clobber.test.js's
// "T1 HEADLINE" test already uses for its settings/progress writers.
//
// Verified by hand: with server.js's HR1b drop loop removed (i.e. reverting
// to `fresh.metadata = mergeScannedMetadata(fresh.metadata, newMetadata)`
// with no prior reconciliation), the HEADLINE test below FAILS -- the
// concurrently-deleted id Z is resurrected in the final db.json, because
// Phase 2 takes membership wholesale from the stale Phase-1 `newMetadata`. It
// PASSES with the fix (the drop loop in place).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scan-delete-reconcile-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { scanDirectories, updateDatabase, getMediaId } = require('../../server');

function baseSettings(overrides) {
  return {
    scanIntervalMinutes: 30,
    pruneMissing: true,
    cacheMaxBytes: null,
    cacheMaxAgeDays: 30,
    ...overrides,
  };
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

beforeEach(() => {
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
});

test('HEADLINE: a DELETE committing DURING a scan (after Phase 1 builds newMetadata, before Phase 2 runs) leaves the id deleted, not resurrected', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-hr1b-lib-'));

  // Z: already-indexed, up-to-date metadata (same filePath/size) -- the scan
  // matches it verbatim with NO extraction/await in Phase 1, so `newMetadata`
  // already holds Z's (pre-delete) entry by the time the concurrent delete
  // below fires.
  const filePathZ = path.join(libDir, 'to-be-deleted.mp4');
  fs.writeFileSync(filePathZ, 'z-bytes');
  const sizeZ = fs.statSync(filePathZ).size;
  const idZ = getMediaId(filePathZ);

  // N: brand-new file -- forces the scan to `await
  // extractMetadataAndThumbnail(...)`, its one yield point, so there is a real
  // change for `dbChanged` to be true about (a no-op scan short-circuits via
  // `return false` before ever reaching the merge, per the design doc).
  const filePathN = path.join(libDir, 'new-file.mp4');
  fs.writeFileSync(filePathN, 'new-video-bytes');
  const idN = getMediaId(filePathN);

  writeDb({
    folders: [libDir],
    folderSettings: {},
    progress: { [idZ]: { position: 5 } },
    metadata: {
      [idZ]: {
        id: idZ, name: 'to-be-deleted.mp4', title: 'to-be-deleted', filePath: filePathZ,
        folderName: path.basename(libDir), size: sizeZ, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 5, hasThumbnail: false, artist: '', rootFolder: libDir,
      },
    },
    settings: baseSettings(),
  });

  const scanPromise = scanDirectories();

  // Concurrent DELETE /api/videos/:id-equivalent, fired in the SAME
  // synchronous tick as the scan start (before its deferred continuation
  // runs) -- see the timing note atop this file. Mirrors the real route's own
  // `updateDatabase` mutator (server.js's `DELETE /api/videos/:id` handler).
  fs.rmSync(filePathZ);
  const deletePromise = updateDatabase(db => {
    delete db.metadata[idZ];
    delete db.progress[idZ];
    return true;
  });

  await Promise.all([scanPromise, deletePromise]);

  const finalDb = readDb();
  assert.ok(!finalDb.metadata[idZ],
    'a concurrently-DELETEd id must stay deleted, not be resurrected by the scan\'s stale Phase-1 snapshot');
  assert.ok(!finalDb.progress[idZ], 'the deleted id\'s progress entry must stay gone too');
  assert.ok(finalDb.metadata[idN], 'the scan\'s own genuinely-new file must still be added alongside the concurrent delete');
});

test('mount-loss-retained entry is NOT wrongly dropped by the finding-D reconciliation', async () => {
  const missingRoot = path.join(os.tmpdir(), `filetube-hr1b-missing-${Date.now()}`);
  // Never created on disk -> simulates an unmounted/removed drive; entry R is
  // retained (non-surviving, non-prunable) but must NOT be confused with a
  // concurrent delete: it is still present in `fresh.metadata` (nothing
  // removed it), so the drop loop's "absent from fresh" test must not fire.
  const filePathR = path.join(missingRoot, 'retained.mp4');
  const idR = getMediaId(filePathR);

  const presentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-hr1b-present-'));
  const filePathN = path.join(presentRoot, 'new-file.mp4');
  fs.writeFileSync(filePathN, 'new-video-bytes');
  const idN = getMediaId(filePathN);

  writeDb({
    folders: [missingRoot, presentRoot],
    folderSettings: {},
    progress: { [idR]: { position: 3 } },
    metadata: {
      [idR]: {
        id: idR, name: 'retained.mp4', title: 'retained', filePath: filePathR,
        folderName: 'ghost-lib', size: 123, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '', rootFolder: missingRoot,
      },
    },
    settings: baseSettings({ pruneMissing: true }),
  });

  await scanDirectories();

  const finalDb = readDb();
  assert.ok(finalDb.metadata[idR],
    'a mount-loss-retained entry must not be dropped by the finding-D reconciliation -- it is still present in the fresh db, not concurrently deleted');
  assert.ok(finalDb.progress[idR], 'watch progress for the retained (mount-loss) entry must not be touched');
  assert.ok(finalDb.metadata[idN], 'the genuinely-new file elsewhere in the same scan must still be added');
});

test('a genuinely-new scanned file (absent from the Phase-1 snapshot) is still added', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-hr1b-newfile-'));
  const filePathN = path.join(libDir, 'brand-new.mp4');
  fs.writeFileSync(filePathN, 'brand-new-bytes');
  const idN = getMediaId(filePathN);

  writeDb({
    folders: [libDir],
    folderSettings: {},
    progress: {},
    metadata: {},
    settings: baseSettings(),
  });

  await scanDirectories();

  const finalDb = readDb();
  assert.ok(finalDb.metadata[idN],
    'a genuinely-new file (absent from the Phase-1 snapshot) must still be added -- the naive "absent from fresh -> drop" rule would wrongly eat it');
});

test('non-concurrent case: a normal scan with no interleaved delete leaves all surviving ids intact', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-hr1b-normal-'));
  const filePathE = path.join(libDir, 'existing.mp4');
  fs.writeFileSync(filePathE, 'existing-bytes');
  const sizeE = fs.statSync(filePathE).size;
  const idE = getMediaId(filePathE);

  const filePathN = path.join(libDir, 'new-file.mp4');
  fs.writeFileSync(filePathN, 'new-video-bytes');
  const idN = getMediaId(filePathN);

  writeDb({
    folders: [libDir],
    folderSettings: {},
    progress: {},
    metadata: {
      [idE]: {
        id: idE, name: 'existing.mp4', title: 'existing', filePath: filePathE,
        folderName: path.basename(libDir), size: sizeE, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 5, hasThumbnail: false, artist: '', rootFolder: libDir,
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const finalDb = readDb();
  assert.ok(finalDb.metadata[idE], 'an existing surviving id must remain intact when nothing is deleted concurrently');
  assert.ok(finalDb.metadata[idN], 'a genuinely-new file must still be added in the non-concurrent case');
  assert.equal(Object.keys(finalDb.metadata).length, 2, 'no spurious drops or extras appear in the normal, non-concurrent case');
});
