'use strict';

// [INTEGRATION] Feature A (v1.26.1, Shorts player-size jump) -- the scan's
// VIDEO-only width/height capture on a genuinely new/updated file's ffprobe,
// and the HARD GATE that an already-indexed item is NEVER re-probed just to
// backfill this field (the thumbnail-backfill-regression lesson -- mirrors
// test/integration/scan-release-date-backfill.test.js's own hard-gate
// pattern and mocking technique).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dims-scan-'));
const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

const cp = require('child_process');

let execCalls = [];
let execFileCalls = [];
let nextFfprobeJson = { format: { duration: '42', tags: {} }, streams: [] };

cp.exec = function mockExec(cmd, cb) {
  execCalls.push(cmd);
  if (cmd === 'ffmpeg -version') {
    cb(null, 'ffmpeg version mock 1.0', '');
    return;
  }
  cb(new Error(`unexpected exec() call in test mock: ${cmd}`));
};

cp.execFile = function mockExecFile(bin, args, opts, cb) {
  if (typeof opts === 'function') { cb = opts; }
  if (bin === 'ffprobe') {
    execFileCalls.push(args);
    cb(null, JSON.stringify(nextFfprobeJson), '');
    return;
  }
  if (bin === 'ffmpeg') {
    const cmd = ['ffmpeg', ...args].join(' ');
    execCalls.push(cmd);
    if (args[0] === '-ss' || (args[0] === '-i' && args.includes('-vcodec'))) {
      const outPath = args[args.length - 1];
      fs.writeFileSync(outPath, 'mock-thumbnail-bytes');
      cb(null, '', '');
      return;
    }
    cb(new Error(`unexpected ffmpeg execFile() args in test mock: ${JSON.stringify(args)}`));
    return;
  }
  cb(new Error(`unexpected execFile() call in test mock: ${bin}`));
};

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { scanDirectories, getMediaId, updateDatabase, saveDatabase, __resetDatabaseForTests } = require('../../server');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

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
  return readPersistedDatabase(process.env.DATA_DIR);
}

beforeEach(async () => {
  await __resetDatabaseForTests();
  execCalls = [];
  execFileCalls = [];
  nextFfprobeJson = { format: { duration: '42', tags: {} }, streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920 },
    { codec_type: 'audio', codec_name: 'aac' },
  ] };
});

test('a genuinely NEW video file has its width/height captured from the scan\'s ffprobe call', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dims-new-'));
  const filePath = path.join(root, 'shorts.mp4');
  fs.writeFileSync(filePath, 'brand-new-video-bytes');
  const id = getMediaId(filePath);

  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  assert.ok(item, 'item must be indexed');
  assert.equal(item.width, 1080);
  assert.equal(item.height, 1920);
});

test('a genuinely NEW audio file never gets width/height, even if the mocked ffprobe reports a stray video stream (e.g. embedded cover art)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dims-audio-'));
  const filePath = path.join(root, 'song.mp3');
  fs.writeFileSync(filePath, 'brand-new-audio-bytes');
  const id = getMediaId(filePath);

  nextFfprobeJson = { format: { duration: '180', tags: {} }, streams: [
    { codec_type: 'video', codec_name: 'mjpeg', width: 500, height: 500, disposition: { attached_pic: 1 } },
    { codec_type: 'audio', codec_name: 'mp3' },
  ] };

  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  assert.ok(item, 'item must be indexed');
  assert.equal('width' in item, false, 'audio items must never carry width');
  assert.equal('height' in item, false, 'audio items must never carry height');
});

// ---------------------------------------------------------------------------
// HARD GATE regression: an already-indexed, unchanged video item that
// predates this field must take the plain reuse fast-path -- NO re-probe,
// and width/height stay absent (the lazy POST /api/videos/:id/dimensions
// endpoint, not the scan, is what backfills these for legacy items).
// ---------------------------------------------------------------------------
test('(HARD GATE) an already-indexed, unchanged video with no width/height is NEVER re-probed by the scan to backfill it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dims-reuse-'));
  const filePath = path.join(root, 'existing.mp4');
  const bytes = 'already-indexed-video-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(thumbPath, 'ORIGINAL-THUMBNAIL-BYTES');

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'existing.mp4', title: 'Existing Video', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000000, duration: 123, hasThumbnail: true,
        artist: '', tags: {}, needsTranscode: false, videoCodec: 'h264', audioCodec: 'aac',
        releaseDate: 1700000000000,
        // no `width`/`height` -- pre-v1.26.1 shape, the exact backfill case.
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  assert.ok(item, 'item must still be indexed after the scan');
  assert.equal('width' in item, false, 'must NOT be backfilled by the scan -- that is the lazy per-item endpoint\'s job');
  assert.equal('height' in item, false);

  // Zero ffprobe/ffmpeg spawns of any kind -- proof this took the plain
  // reuse fast-path, not a re-probe.
  assert.equal(execFileCalls.length, 0, 'no ffprobe (re-probe) call for an already-indexed, unchanged item');
  assert.equal(execCalls.length, 0, 'no ffmpeg spawn of any kind for an already-indexed, unchanged item');
  assert.equal(fs.readFileSync(thumbPath, 'utf8'), 'ORIGINAL-THUMBNAIL-BYTES', 'existing thumbnail must be untouched');
});

// The `legacyVideoCodecBackfillOnly` branch (an item missing videoCodec/
// audioCodec) ALREADY runs a codec-only probe (pre-existing v1.18.1
// behavior) -- but even though that probe's raw ffprobe output would
// technically include width/height now (buildFfprobeArgs is shared), this
// branch must NOT persist them: `probeCodecsOnly` only ever returns
// `{ videoCodec, audioCodec }`, so there is nothing to backfill from it.
// Locks that a legacy item stays width/height-less until either a genuine
// content change or the lazy per-item endpoint fills it in.
test('a legacy video missing codec fields (legacyVideoCodecBackfillOnly branch) still does not get width/height, even though its codec-only probe technically saw the same stream data', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dims-legacy-'));
  const filePath = path.join(root, 'legacy.mp4');
  const bytes = 'legacy-video-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(thumbPath, 'LEGACY-THUMBNAIL-BYTES');

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'legacy.mp4', title: 'Legacy Video', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000000, duration: 42, hasThumbnail: true,
        artist: '', needsTranscode: false,
        // no videoCodec/audioCodec/width/height -- pre-v1.18 AND pre-v1.26.1 shape.
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  assert.equal(item.videoCodec, 'h264', 'the codec-only probe DOES still backfill videoCodec/audioCodec (pre-existing behavior)');
  assert.equal(item.audioCodec, 'aac');
  assert.equal('width' in item, false, 'the codec-only probe never persists width/height');
  assert.equal('height' in item, false);
  assert.equal(fs.readFileSync(thumbPath, 'utf8'), 'LEGACY-THUMBNAIL-BYTES', 'no frame-grab -- existing thumbnail untouched');
});

// ---------------------------------------------------------------------------
// F1 (v1.26.1 two-reviewer follow-up): HEADLINE clobber regression -- mirrors
// test/integration/scan-clobber.test.js's own concurrent-write construction
// and timing note. `runScanDirectories` only yields to the event loop at
// `await extractMetadataAndThumbnail(...)`, so a genuinely NEW file (file A,
// below) is what forces that one yield point; a concurrent `updateDatabase`
// call fired in the SAME synchronous tick as the scan's start deterministically
// lands in the window between the scan's Phase-1 snapshot (taken at scan
// START) and its final save -- exactly the window a lazy
// `POST /api/videos/:id/dimensions` backfill (player.js's `loadedmetadata`
// fallback) could land in during a real concurrent request.
//
// File B is an already-indexed, unchanged, REUSABLE video (carries
// videoCodec/audioCodec already, so it takes the plain reuse fast path, no
// probe/no await) -- the scan's own `newMetadata[idB]` is a direct reference
// into that Phase-1 snapshot, taken BEFORE the concurrent dims write commits.
// Pre-fix, `mergeScannedMetadata`'s wholesale `fresh.metadata = newMetadata`
// replace at the scan's final save silently reverts the concurrently-written
// width/height (the scan's own stale snapshot of file B has neither field).
// ---------------------------------------------------------------------------
test('HEADLINE (F1): a dimensions POST landing mid-scan on an already-indexed, reusable video survives the scan\'s final merge', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dims-clobber-'));

  // File A is brand-new -- forces the scan to `await extractMetadataAndThumbnail(...)`, its one yield point.
  const filePathA = path.join(root, 'new-file.mp4');
  fs.writeFileSync(filePathA, 'new-video-bytes');
  const idA = getMediaId(filePathA);

  // File B is already indexed, unchanged, and carries codec fields -- the
  // scan's REUSABLE fast path (no probe, no await).
  const filePathB = path.join(root, 'existing-video.mp4');
  const bytesB = 'already-indexed-video-bytes';
  fs.writeFileSync(filePathB, bytesB);
  const idB = getMediaId(filePathB);

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [idB]: {
        id: idB, name: 'existing-video.mp4', title: 'Existing Video', filePath: filePathB,
        folderName: path.basename(root), size: Buffer.byteLength(bytesB), ext: '.mp4',
        type: 'video', addedAt: 1700000000000, duration: 30, hasThumbnail: true,
        artist: '', tags: {}, needsTranscode: false, videoCodec: 'h264', audioCodec: 'aac',
        releaseDate: 1700000000000, rootFolder: root,
        // no width/height yet -- pre-v1.26.1 shape, the exact legacy-backfill target.
      },
    },
    settings: baseSettings(),
  });

  const scanPromise = scanDirectories();

  // Concurrent dimensions backfill (mirrors POST /api/videos/:id/dimensions's
  // own updateDatabase call), fired in the SAME synchronous tick as the scan
  // start -- see this test's / scan-clobber.test.js's timing note above.
  const dimsPromise = updateDatabase(db => {
    const item = db.metadata[idB];
    if (!item || (item.width && item.height)) return false;
    item.width = 1080;
    item.height = 1920;
    return true;
  });

  await Promise.all([scanPromise, dimsPromise]);

  const finalDb = readDb();
  assert.ok(finalDb.metadata[idA], 'the scan\'s own newly-discovered file must still be indexed');
  assert.equal(
    finalDb.metadata[idB].width, 1080,
    'a width backfilled mid-scan must survive the scan\'s final merge, not be reverted to the stale scan-start snapshot'
  );
  assert.equal(
    finalDb.metadata[idB].height, 1920,
    'a height backfilled mid-scan must survive the scan\'s final merge, not be reverted to the stale scan-start snapshot'
  );
});

test('F1: a genuinely re-probed item (changed file, new dims from THIS scan) is never overwritten by a stale on-disk value', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dims-reprobe-'));
  const filePath = path.join(root, 'changed.mp4');
  const oldBytes = 'old-bytes';
  fs.writeFileSync(filePath, oldBytes);
  const id = getMediaId(filePath);

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'changed.mp4', title: 'Changed Video', filePath,
        folderName: path.basename(root), size: 111, ext: '.mp4', // stale size -> triggers re-probe (changed file)
        type: 'video', addedAt: 1700000000000, duration: 30, hasThumbnail: true,
        artist: '', tags: {}, needsTranscode: false, videoCodec: 'h264', audioCodec: 'aac',
        releaseDate: 1700000000000, rootFolder: root,
        width: 640, height: 480, // stale dims from before the file changed
      },
    },
    settings: baseSettings(),
  });

  // Re-write the file so its size genuinely differs from the stale db entry
  // (111), forcing the "new or updated file" branch (a real re-probe).
  fs.writeFileSync(filePath, 'genuinely-different-length-bytes');
  nextFfprobeJson = { format: { duration: '42', tags: {} }, streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920 },
    { codec_type: 'audio', codec_name: 'aac' },
  ] };

  await scanDirectories();

  const db = readDb();
  assert.equal(db.metadata[id].width, 1080, 'the freshly re-probed dims must win, not the stale pre-change value');
  assert.equal(db.metadata[id].height, 1920);
});
