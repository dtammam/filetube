'use strict';

// [INTEGRATION] Headline regression test for fix A (whole-DB clobber race,
// server.js runScanDirectories' final save). Isolated DATA_DIR before
// requiring the app so the suite never reads or writes real project data --
// own process per file (node --test), mirroring test/integration/
// scan-prune.test.js / scan-api.test.js.
//
// Timing note: `runScanDirectories` only yields to the event loop at
// `await extractMetadataAndThumbnail(...)`, and (with FFmpeg unavailable, the
// expected CI condition per docs/CONTRIBUTING.md) that promise settles
// SYNCHRONOUSLY inside its own executor, so the `await` defers the scan's
// continuation by exactly ONE microtask tick. A *real* concurrent HTTP
// request (genuine socket I/O, a macrotask) would never actually land inside
// that single-microtask window -- Node drains the microtask queue (letting
// the whole rest of the scan run synchronously to completion and save)
// before it ever advances to the poll phase that would service the request.
// So we simulate the concurrent writes the way `POST /api/settings` and
// `recordServed` perform them -- synchronous `loadDatabase`/`saveDatabase`
// calls -- issued in the SAME synchronous tick as firing `scanDirectories()`
// (before awaiting it). This deterministically lands them in the exact
// window the bug occupies (after the scan's initial snapshot, before its
// final save), with no flakiness and no FFmpeg dependency. Verified against
// the pre-fix clobber code: this construction reliably reproduces the bug
// (settings revert to the stale value, lastServedAt lost) there, and passes
// only with the re-read-merge-on-save fix.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scan-clobber-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { scanDirectories, recordServed, loadDatabase, saveDatabase, updateDatabase, getMediaId } = require('../../server');

function baseSettings(overrides) {
  return {
    scanIntervalMinutes: 30,
    pruneMissing: true,
    cacheMaxBytes: null,
    cacheMaxAgeDays: 30,
    ...overrides,
  };
}

// v1.30 A3 (in-memory DB read cache): seed via the exported `saveDatabase()`
// (an established test primitive, see CONTRIBUTING.md) rather than a raw
// `fs.writeFileSync`, so the in-process db cache stays coherent.
function writeDb(db) {
  saveDatabase(db);
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

beforeEach(() => {
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
});

test('HEADLINE: a settings write AND a recordServed lastServedAt write made during an in-flight scan both survive the scan\'s final save', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-clobber-lib-'));

  // File A is brand-new (not yet in db.metadata) -- this forces the scan to
  // `await extractMetadataAndThumbnail(...)`, its one yield point.
  const filePathA = path.join(libDir, 'new-file.mp4');
  fs.writeFileSync(filePathA, 'new-video-bytes');
  const idA = getMediaId(filePathA);

  // File B already has an up-to-date metadata entry (same filePath/size) --
  // the scan reuses it verbatim (no extraction, no await) and it survives.
  // We'll record a fresh lastServedAt for it WHILE the scan is paused on A.
  const filePathB = path.join(libDir, 'existing-file.mp4');
  fs.writeFileSync(filePathB, 'existing-bytes');
  const sizeB = fs.statSync(filePathB).size;
  const idB = getMediaId(filePathB);

  writeDb({
    folders: [libDir],
    folderSettings: {},
    progress: {},
    metadata: {
      [idB]: {
        id: idB, name: 'existing-file.mp4', title: 'existing-file', filePath: filePathB,
        folderName: path.basename(libDir), size: sizeB, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 5, hasThumbnail: false, artist: '', rootFolder: libDir,
      },
    },
    settings: baseSettings({ scanIntervalMinutes: 30 }),
  });

  const scanPromise = scanDirectories();

  // -- Concurrent writes, fired in the SAME synchronous tick as the scan
  // start (before its deferred continuation runs) -- see the timing note
  // above for why this is the deterministic equivalent of "during the scan".

  // Concurrent recordServed (mirrors the /video Range-request hot path).
  recordServed(idB);

  // Concurrent settings save (mirrors POST /api/settings' own
  // loadDatabase/mutate/saveDatabase sequence).
  const concurrentDb = loadDatabase();
  concurrentDb.settings = { ...concurrentDb.settings, scanIntervalMinutes: 720 };
  saveDatabase(concurrentDb);

  await scanPromise;

  const finalDb = readDb();
  assert.equal(
    finalDb.settings.scanIntervalMinutes, 720,
    'a settings write made during the scan must survive the scan\'s final save, not be reverted to the pre-scan value'
  );
  assert.ok(
    finalDb.metadata[idA],
    'the new file discovered by the scan must still be indexed'
  );
  assert.ok(
    typeof finalDb.metadata[idB].lastServedAt === 'number',
    'a lastServedAt written during the scan must survive, not be lost'
  );
});

// [INTEGRATION] T1 HEADLINE: the general serialized-`updateDatabase` guard.
// Interleaves FOUR concurrent writers -- a settings write, a progress write,
// a `recordServed` write, and an in-flight scan -- all fired in the SAME
// synchronous tick (per this file's timing note above) and all routed
// through the very same `updateDatabase(mutatorFn)` mechanism the real `POST
// /api/settings`, `POST /api/progress`, `recordServed`, and the scan's own
// Phase-2 merge use internally (the settings/progress writers below call
// `updateDatabase` directly, mirroring exactly what those routes do inside
// their handlers). Asserts NOTHING is lost: this is the general RMW-clobber
// guard (any two serialized writers whose load-mutate-save would otherwise
// stomp each other's field), not just the scan-vs-one-writer case the test
// above covers.
//
// Fail-pre/pass-post, verified by hand: temporarily changing `updateDatabase`
// (server.js) to read `loadDatabase()` at ENQUEUE time (i.e. synchronously,
// OUTSIDE the `dbWriteChain.then(...)` callback) instead of freshly INSIDE
// it -- reproducing the "approach (a), bare mutex, read stays outside the
// lock" flaw the design doc explicitly rejects -- makes this test FAIL: all
// four concurrent calls capture the SAME stale pre-write snapshot at enqueue
// time (since none of their callbacks have run yet), so whichever callback's
// `saveDatabase` commits LAST clobbers every field the earlier callbacks had
// just written, and at most one of {settings, progress, lastServedAt, the
// scan's new file} survives. Restoring the fresh-read-INSIDE-the-lock
// version (the shipped implementation) makes it pass again -- see this
// task's report for the actual before/after run.
test('T1 HEADLINE: a settings write, a progress write, a recordServed write, and an in-flight scan interleaved in one tick -- NONE is lost', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-t1-headline-lib-'));

  // File A is brand-new (not yet in db.metadata) -- forces the scan to
  // `await extractMetadataAndThumbnail(...)`, its one yield point.
  const filePathA = path.join(libDir, 'new-file.mp4');
  fs.writeFileSync(filePathA, 'new-video-bytes');
  const idA = getMediaId(filePathA);

  // File B already has an up-to-date metadata entry -- the scan reuses it
  // verbatim (no extraction, no await); we record a fresh lastServedAt for it
  // while the scan is paused on A.
  const filePathB = path.join(libDir, 'existing-file.mp4');
  fs.writeFileSync(filePathB, 'existing-bytes');
  const sizeB = fs.statSync(filePathB).size;
  const idB = getMediaId(filePathB);

  // A third, already-indexed file carries the concurrent watch-progress
  // write -- also matches its metadata verbatim (no extraction, no await).
  const filePathC = path.join(libDir, 'progress-target.mp4');
  fs.writeFileSync(filePathC, 'progress-target-bytes');
  const sizeC = fs.statSync(filePathC).size;
  const idC = getMediaId(filePathC);

  writeDb({
    folders: [libDir],
    folderSettings: {},
    progress: {},
    metadata: {
      [idB]: {
        id: idB, name: 'existing-file.mp4', title: 'existing-file', filePath: filePathB,
        folderName: path.basename(libDir), size: sizeB, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 5, hasThumbnail: false, artist: '', rootFolder: libDir,
      },
      [idC]: {
        id: idC, name: 'progress-target.mp4', title: 'progress-target', filePath: filePathC,
        folderName: path.basename(libDir), size: sizeC, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 100, hasThumbnail: false, artist: '', rootFolder: libDir,
      },
    },
    settings: baseSettings({ scanIntervalMinutes: 30 }),
  });

  const scanPromise = scanDirectories();

  // -- Four concurrent writers, ALL fired in the SAME synchronous tick as the
  // scan start (before its deferred continuation runs) -- see the timing
  // note atop this file for why this deterministically lands them in the
  // exact window a broken (read-outside-the-lock) mechanism would clobber.

  // Mirrors recordServed's real "due" write (fire-and-forget in production;
  // awaited here only so the test can assert on it deterministically).
  const recordServedPromise = recordServed(idB);

  // Mirrors POST /api/settings' own updateDatabase call.
  const settingsPromise = updateDatabase(db => {
    db.settings = { ...db.settings, scanIntervalMinutes: 720 };
    return true;
  });

  // Mirrors POST /api/progress' own updateDatabase call.
  const progressPromise = updateDatabase(db => {
    db.progress[idC] = { timestamp: 42, duration: 100, updatedAt: new Date().toISOString() };
    return true;
  });

  await Promise.all([scanPromise, recordServedPromise, settingsPromise, progressPromise]);

  const finalDb = readDb();
  assert.equal(
    finalDb.settings.scanIntervalMinutes, 720,
    'a settings write made during the scan must survive alongside every other concurrent writer'
  );
  assert.ok(finalDb.progress[idC], 'a progress write made during the scan must survive');
  assert.equal(finalDb.progress[idC].timestamp, 42, 'the progress write must not be a partial/stale merge');
  assert.equal(
    typeof finalDb.metadata[idB].lastServedAt, 'number',
    'a recordServed lastServedAt write made during the scan must survive'
  );
  assert.ok(finalDb.metadata[idA], 'the scan\'s own newly-discovered file must survive alongside every concurrent writer');
});
