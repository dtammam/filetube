'use strict';

// [INTEGRATION] C5-local (v1.24, T5) -- capturing `db.metadata[id].releaseDate`
// for local files: embedded ffprobe date (`format.tags.creation_time`/`date`,
// piggybacked on the probe the scan already runs) -> filesystem `mtime`
// fallback.
//
// HARD GATE (thumbnail-backfill-regression lesson): adding `releaseDate` to
// an ALREADY-INDEXED item (one scanned before this field existed) must be a
// SCHEMA-ONLY backfill -- it must NEVER trigger a re-probe, a re-thumbnail
// frame-grab, or a re-transcode pass, and must not touch any unrelated
// per-item state. This suite mocks `child_process.exec`/`execFile` (same
// technique as test/integration/scan-thumbnail-preserve.test.js) so it can
// observe *whether a spawn happened at all*, not just what it would have
// returned -- the only way to actually prove non-invocation.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-release-date-'));
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
    if (args[0] === '-ss') {
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
const { scanDirectories, getMediaId, saveDatabase, __resetDatabaseForTests } = require('../../server');
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
    { codec_type: 'video', codec_name: 'h264' },
    { codec_type: 'audio', codec_name: 'aac' },
  ] };
});

// ---------------------------------------------------------------------------
// HARD GATE regression: an already-indexed item (pre-dates `releaseDate`)
// that is otherwise unchanged must take the plain reuse fast-path -- the
// field is backfilled from `mtime` alone, with ZERO ffmpeg/ffprobe spawns
// and the existing thumbnail bytes left byte-for-byte untouched.
// ---------------------------------------------------------------------------
test('(HARD GATE) releaseDate backfill on an already-indexed, unchanged video: no probe, no thumbnail spawn, no unrelated state touched', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-backfill-reuse-'));
  const filePath = path.join(root, 'existing.mp4');
  const bytes = 'already-indexed-video-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(thumbPath, 'ORIGINAL-THUMBNAIL-BYTES');

  const originalAddedAt = 1700000000000;
  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'existing.mp4', title: 'Existing Video', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: originalAddedAt, duration: 123, hasThumbnail: true,
        artist: 'RELEASE-DATE-SENTINEL', tags: { description: 'sentinel-desc' },
        needsTranscode: false, videoCodec: 'h264', audioCodec: 'aac',
        // no `releaseDate` -- pre-T5 shape, the exact backfill case.
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  assert.ok(item, 'item must still be indexed after the scan');

  // The new field IS added...
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'releaseDate'), true, 'releaseDate must be backfilled');
  assert.equal(typeof item.releaseDate, 'number', 'releaseDate must be a numeric epoch-ms value (mtime fallback)');

  // ...but NOTHING was re-processed to get it: zero ffprobe calls, zero
  // ffmpeg spawns of ANY kind (frame-grab or otherwise).
  assert.equal(execFileCalls.length, 0, 'no ffprobe (re-probe) call for an already-indexed, unchanged item');
  assert.equal(execCalls.length, 0, 'no ffmpeg spawn of any kind for an already-indexed, unchanged item');

  // ...and every unrelated field is untouched.
  assert.equal(item.title, 'Existing Video');
  assert.equal(item.duration, 123);
  assert.equal(item.addedAt, originalAddedAt);
  assert.equal(item.artist, 'RELEASE-DATE-SENTINEL', 'unrelated per-item state (artist) must not be touched by the schema-only backfill');
  assert.deepEqual(item.tags, { description: 'sentinel-desc' });
  assert.equal(item.hasThumbnail, true);
  assert.equal(item.videoCodec, 'h264');
  assert.equal(item.audioCodec, 'aac');

  // The on-disk thumbnail bytes are byte-for-byte unchanged -- proof the
  // frame-grab never fired (no regenerate/clobber).
  assert.equal(fs.readFileSync(thumbPath, 'utf8'), 'ORIGINAL-THUMBNAIL-BYTES', 'existing thumbnail must be untouched by the releaseDate backfill');
});

// The same hard gate, for an already-indexed AUDIO item (a distinct scan
// branch -- `reusable` gates on `isAudio || hasCodecFields`, so an audio
// item never even checks for codec fields).
test('(HARD GATE) releaseDate backfill on an already-indexed, unchanged audio item: no probe/spawn', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-backfill-audio-'));
  const filePath = path.join(root, 'existing.mp3');
  const bytes = 'already-indexed-audio-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'existing.mp3', title: 'Existing Audio', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp3',
        type: 'audio', addedAt: 1700000000000, duration: 60, hasThumbnail: false,
        artist: 'AUDIO-RELEASE-DATE-SENTINEL',
        // no `releaseDate` -- pre-T5 shape.
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'releaseDate'), true, 'releaseDate must be backfilled for audio too');
  assert.equal(typeof item.releaseDate, 'number');
  assert.equal(execFileCalls.length, 0, 'no probe for an unchanged audio item');
  assert.equal(execCalls.length, 0, 'no ffmpeg spawn for an unchanged audio item');
  assert.equal(item.artist, 'AUDIO-RELEASE-DATE-SENTINEL', 'unrelated state untouched');
});

// A legacy VIDEO missing codec fields takes the `legacyVideoCodecBackfillOnly`
// branch, which ALREADY runs a codec-only probe (pre-existing behavior, not
// introduced by T5). The releaseDate backfill there must still be mtime-only
// -- it must not depend on / consume that probe's output for the date -- and
// must NEVER trigger a frame-grab.
test('legacy video (missing codec fields) still gets mtime-only releaseDate backfill; codec-only probe runs but no frame-grab', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-backfill-legacy-'));
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
        artist: 'LEGACY-SENTINEL', needsTranscode: false,
        // no videoCodec / audioCodec / releaseDate -- pre-v1.18 AND pre-T5 shape.
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'releaseDate'), true);
  assert.equal(typeof item.releaseDate, 'number');
  assert.equal(item.videoCodec, 'h264', 'codec fields still backfilled (pre-existing v1.18.1 behavior)');
  // The codec-only probe legitimately runs here (pre-existing behavior) --
  // but it must be exactly one probe, and the frame-grab must never fire.
  assert.equal(execFileCalls.length, 1, 'exactly one codec-only probe (pre-existing behavior)');
  assert.equal(execCalls.some(c => /^ffmpeg -ss /.test(c)), false, 'no frame-grab -- the thumbnail is untouched');
  assert.equal(fs.readFileSync(thumbPath, 'utf8'), 'LEGACY-THUMBNAIL-BYTES', 'thumbnail bytes untouched');
});

// ---------------------------------------------------------------------------
// New-file capture: embedded date -> mtime precedence, exercised end-to-end.
// ---------------------------------------------------------------------------
test('a brand-new video with an embedded creation_time tag captures releaseDate from the embedded date', async () => {
  nextFfprobeJson = { format: { duration: '10', tags: { creation_time: '2021-06-15T00:00:00.000000Z' } }, streams: [
    { codec_type: 'video', codec_name: 'h264' },
    { codec_type: 'audio', codec_name: 'aac' },
  ] };

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-new-embedded-'));
  const filePath = path.join(root, 'brand-new.mp4');
  fs.writeFileSync(filePath, 'brand-new-video-bytes');

  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const id = getMediaId(filePath);
  const db = readDb();
  assert.equal(db.metadata[id].releaseDate, Date.parse('2021-06-15T00:00:00.000000Z'));
});

test('a brand-new video with NO embedded date tag falls back to filesystem mtime', async () => {
  nextFfprobeJson = { format: { duration: '10', tags: {} }, streams: [
    { codec_type: 'video', codec_name: 'h264' },
    { codec_type: 'audio', codec_name: 'aac' },
  ] };

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-new-mtime-'));
  const filePath = path.join(root, 'brand-new.mp4');
  fs.writeFileSync(filePath, 'brand-new-video-bytes-no-date');
  const mtimeMs = fs.statSync(filePath).mtimeMs;

  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const id = getMediaId(filePath);
  const db = readDb();
  assert.equal(db.metadata[id].releaseDate, mtimeMs, 'falls back to the file\'s own mtime when no embedded date is present');
});
