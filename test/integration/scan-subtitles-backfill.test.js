'use strict';

// [INTEGRATION] A6 (v1.24 UX Round, T16, Wave 5) -- `db.metadata[id]
// .hasSubtitles` additive detection at scan time.
//
// HARD GATE (thumbnail-backfill-regression lesson): detecting a subtitle
// sidecar for an ALREADY-INDEXED item must be SCHEMA-ONLY -- it must NEVER
// trigger a re-probe, a re-thumbnail frame-grab, or a re-transcode pass, and
// a file with NO sidecar must be completely unaffected (existing thumbnail/
// transcode reconciliation must proceed exactly as before). This suite mocks
// `child_process.exec`/`execFile` (same technique as
// test/integration/scan-release-date-backfill.test.js) so it can observe
// *whether a spawn happened at all*.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-backfill-'));
const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

const cp = require('child_process');

let execCalls = [];
let execFileCalls = [];

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
    cb(null, JSON.stringify({ format: { duration: '42', tags: {} }, streams: [
      { codec_type: 'video', codec_name: 'h264' },
      { codec_type: 'audio', codec_name: 'aac' },
    ] }), '');
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
});

test('scan sets hasSubtitles=true for an already-indexed item that has grown a local .srt sidecar, with ZERO ffmpeg/ffprobe spawns', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-reuse-'));
  const filePath = path.join(root, 'existing.mp4');
  const bytes = 'already-indexed-video-bytes';
  fs.writeFileSync(filePath, bytes);
  fs.writeFileSync(path.join(root, 'existing.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHi\n');
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
        artist: 'SENTINEL', needsTranscode: false, videoCodec: 'h264', audioCodec: 'aac',
        releaseDate: 1700000000000,
        // no `hasSubtitles` -- pre-A6 shape, the exact backfill case.
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  assert.equal(item.hasSubtitles, true, 'a newly-added local .srt sidecar must be picked up on the next scan');
  assert.equal(execFileCalls.length, 0, 'no ffprobe (re-probe) call for an already-indexed, unchanged item');
  assert.equal(execCalls.length, 0, 'no ffmpeg spawn of any kind');
  assert.equal(item.artist, 'SENTINEL', 'unrelated per-item state must not be touched');
  assert.equal(fs.readFileSync(thumbPath, 'utf8'), 'ORIGINAL-THUMBNAIL-BYTES', 'existing thumbnail must be untouched');
});

test('(HARD GATE) a file with NO subtitle sidecar is unaffected: hasSubtitles=false, thumbnail/transcode reconciliation proceeds exactly as before, zero spawns', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-none-'));
  const filePath = path.join(root, 'no-captions.mp4');
  const bytes = 'no-sidecar-video-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(thumbPath, 'UNTOUCHED-THUMBNAIL-BYTES');

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'no-captions.mp4', title: 'No Captions', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000000, duration: 60, hasThumbnail: true,
        artist: '', needsTranscode: false, videoCodec: 'h264', audioCodec: 'aac',
        releaseDate: 1700000000000,
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  assert.equal(item.hasSubtitles, false, 'no sidecar on disk -> hasSubtitles must be false, never left undefined/truthy');
  assert.equal(execFileCalls.length, 0, 'no re-probe for a file with no sidecar');
  assert.equal(execCalls.length, 0, 'no ffmpeg spawn for a file with no sidecar');
  assert.equal(fs.readFileSync(thumbPath, 'utf8'), 'UNTOUCHED-THUMBNAIL-BYTES', 'thumbnail reconciliation is unaffected');
});

test('a brand-new video scanned alongside a <base>.<lang>.vtt sidecar is indexed with hasSubtitles=true', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-new-'));
  const filePath = path.join(root, 'Brand New [xyz789].mp4');
  fs.writeFileSync(filePath, 'brand-new-video-bytes');
  fs.writeFileSync(path.join(root, 'Brand New [xyz789].en.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhi\n');

  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const id = getMediaId(filePath);
  const db = readDb();
  assert.equal(db.metadata[id].hasSubtitles, true);
});

test('a brand-new video with NO sidecar is indexed with hasSubtitles=false', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-new-none-'));
  const filePath = path.join(root, 'brand-new-plain.mp4');
  fs.writeFileSync(filePath, 'brand-new-plain-video-bytes');

  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const id = getMediaId(filePath);
  const db = readDb();
  assert.equal(db.metadata[id].hasSubtitles, false);
});

// v1.30, A1 (per-scan readdir cache, AC1.3/AC1.6/AC1.7): these three files
// deliberately share ONE directory so the scan's per-scan sidecar dirCache is
// actually exercised across multiple files from the same dir in a single
// pass -- not just the single-file cases above.
test('AC1.6/AC1.7: unchanged files sharing a directory reuse existing data with ZERO spawns, while a genuinely changed sibling in the SAME directory still gets (re-)extracted', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-shared-dir-'));
  const unchanged1Path = path.join(root, 'unchanged1.mp4');
  const unchanged2Path = path.join(root, 'unchanged2.mp4');
  const changedPath = path.join(root, 'changed.mp4');
  const unchanged1Bytes = 'unchanged-1-bytes';
  const unchanged2Bytes = 'unchanged-2-bytes';
  const changedBytesOnDisk = 'the-file-has-grown-since-last-scan';
  fs.writeFileSync(unchanged1Path, unchanged1Bytes);
  fs.writeFileSync(unchanged2Path, unchanged2Bytes);
  fs.writeFileSync(changedPath, changedBytesOnDisk);
  // unchanged2 grows a fresh local sidecar THIS scan -- must still be picked
  // up (AC1.6 does not mean "sidecar detection stops running").
  fs.writeFileSync(path.join(root, 'unchanged2.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHi\n');

  const unchanged1Id = getMediaId(unchanged1Path);
  const unchanged2Id = getMediaId(unchanged2Path);
  const changedId = getMediaId(changedPath);
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  const unchanged1Thumb = path.join(THUMBNAIL_DIR, `${unchanged1Id}.jpg`);
  const unchanged2Thumb = path.join(THUMBNAIL_DIR, `${unchanged2Id}.jpg`);
  fs.writeFileSync(unchanged1Thumb, 'THUMB-1-ORIGINAL');
  fs.writeFileSync(unchanged2Thumb, 'THUMB-2-ORIGINAL');

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [unchanged1Id]: {
        id: unchanged1Id, name: 'unchanged1.mp4', title: 'Unchanged 1', filePath: unchanged1Path,
        folderName: path.basename(root), size: Buffer.byteLength(unchanged1Bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000000, duration: 111, hasThumbnail: true,
        artist: 'KEEP-1', needsTranscode: false, videoCodec: 'h264', audioCodec: 'aac',
        releaseDate: 1700000000000, hasSubtitles: false,
      },
      [unchanged2Id]: {
        id: unchanged2Id, name: 'unchanged2.mp4', title: 'Unchanged 2', filePath: unchanged2Path,
        folderName: path.basename(root), size: Buffer.byteLength(unchanged2Bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000000, duration: 222, hasThumbnail: true,
        artist: 'KEEP-2', needsTranscode: false, videoCodec: 'h264', audioCodec: 'aac',
        releaseDate: 1700000000000, hasSubtitles: false,
      },
      // Indexed with a SMALLER size than what's actually on disk now -- the
      // scan's `unchanged = filePath === filePath && size === info.size`
      // decision must still catch this as changed (AC1.7), regardless of the
      // sidecar dirCache introduced by this task.
      [changedId]: {
        id: changedId, name: 'changed.mp4', title: 'Changed', filePath: changedPath,
        folderName: path.basename(root), size: 3, ext: '.mp4',
        type: 'video', addedAt: 1700000000000, duration: 999, hasThumbnail: true,
        artist: 'STALE', needsTranscode: false, videoCodec: 'h264', audioCodec: 'aac',
        releaseDate: 1700000000000, hasSubtitles: false,
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();

  // AC1.6 (positive): unchanged files reuse all existing data verbatim --
  // no re-extraction, no ffmpeg/ffprobe spawn attributable to them.
  assert.equal(db.metadata[unchanged1Id].duration, 111, 'unchanged1 duration must be reused, not re-extracted');
  assert.equal(db.metadata[unchanged1Id].artist, 'KEEP-1');
  assert.equal(fs.readFileSync(unchanged1Thumb, 'utf8'), 'THUMB-1-ORIGINAL', 'unchanged1 thumbnail must be untouched');
  assert.equal(db.metadata[unchanged1Id].hasSubtitles, false, 'unchanged1 still has no sidecar');

  assert.equal(db.metadata[unchanged2Id].duration, 222, 'unchanged2 duration must be reused, not re-extracted');
  assert.equal(db.metadata[unchanged2Id].artist, 'KEEP-2');
  assert.equal(fs.readFileSync(unchanged2Thumb, 'utf8'), 'THUMB-2-ORIGINAL', 'unchanged2 thumbnail must be untouched');
  assert.equal(db.metadata[unchanged2Id].hasSubtitles, true, 'unchanged2 must still pick up its freshly-dropped sidecar despite being on the reuse fast path');

  // AC1.7 (converse): the changed sibling, in the SAME directory as the two
  // unchanged files above (so it shares the per-scan sidecar dirCache), must
  // still be detected as changed and (re-)extracted -- the sidecar cache
  // must not mask a real size change.
  assert.equal(db.metadata[changedId].size, Buffer.byteLength(changedBytesOnDisk), 'changed file size must be updated to the on-disk size');
  assert.equal(db.metadata[changedId].duration, 42, 'changed file must be re-extracted (mock ffprobe duration), not left at its stale value');
  assert.equal(execFileCalls.length, 1, 'exactly one ffprobe spawn -- only for the genuinely changed file, never for the two unchanged siblings');
});

// v1.30, A1: the per-scan cache must be discarded between scans -- a sidecar
// dropped after one scan completes must still be picked up on the very next
// scan (the pre-existing "recomputed every scan" contract must survive this
// task's caching change).
test('the sidecar dirCache does not persist ACROSS scans: a sidecar added between two scans is still detected on the second scan', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-cross-scan-'));
  const filePath = path.join(root, 'grows-a-sidecar-later.mp4');
  const bytes = 'cross-scan-video-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'THUMB');

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'grows-a-sidecar-later.mp4', title: 'Later Sidecar', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000000, duration: 55, hasThumbnail: true,
        artist: '', needsTranscode: false, videoCodec: 'h264', audioCodec: 'aac',
        releaseDate: 1700000000000, hasSubtitles: false,
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();
  assert.equal(readDb().metadata[id].hasSubtitles, false, 'no sidecar present yet on the first scan');

  fs.writeFileSync(path.join(root, 'grows-a-sidecar-later.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHi\n');
  await scanDirectories();
  assert.equal(readDb().metadata[id].hasSubtitles, true, 'a sidecar dropped after the first scan must be detected on the very next scan -- the per-scan cache must not persist across scans');
});
