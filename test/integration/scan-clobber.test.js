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
const { scanDirectories, recordServed, loadDatabase, saveDatabase, getMediaId } = require('../../server');

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
