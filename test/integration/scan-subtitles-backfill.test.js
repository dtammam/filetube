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
const DB_FILE = path.join(DATA_DIR, 'db.json');
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
const { scanDirectories, getMediaId } = require('../../server');

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
