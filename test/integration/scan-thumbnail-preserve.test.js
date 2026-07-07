'use strict';

// [INTEGRATION] v1.18.1 hotfix -- confirmed root cause: FR-1b's (v1.18.0)
// reuse-guard required a VIDEO item to already carry `videoCodec`/
// `audioCodec` fields to be reused; every pre-v1.18 video lacked those
// fields, so it fell into the full re-init + `extractMetadataAndThumbnail`
// branch -- which runs an ffmpeg FRAME-GRAB, clobbering/regenerating every
// legacy video's thumbnail on the first post-upgrade scan.
//
// The fix adds a THIRD scan branch (`legacyVideoCodecBackfillOnly` in
// server.js): an unchanged VIDEO item missing codec fields is REUSED as-is,
// only backfilling `videoCodec`/`audioCodec` via the codec-only
// `probeCodecsOnly` (no frame-grab). Its thumbnail is restored ONLY if it is
// genuinely missing.
//
// This suite needs to observe *whether an ffmpeg/ffprobe spawn happened at
// all* (not just what it would have returned), so it monkeypatches
// `child_process.exec`/`execFile` BEFORE requiring server.js -- server.js
// destructures `{ exec, execFile }` at require time (`const { exec, execFile,
// spawn } = require('child_process')`), so the patch must land first for the
// destructured references to pick up the mocks. This mirrors the existing
// suite's "mock ffmpeg/ffprobe, keep ffmpeg itself out of CI" standard
// (docs/RELIABILITY.md) while additionally proving NON-invocation, which
// test/unit/ffprobe-codecs.test.js's pure-parser mocking cannot do.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-thumb-preserve-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

const cp = require('child_process');

let execCalls = [];
let execFileCalls = [];
let nextFfprobeJson = { format: { duration: '42' }, streams: [] };
let frameGrabSucceeds = true;

cp.exec = function mockExec(cmd, cb) {
  execCalls.push(cmd);
  if (cmd === 'ffmpeg -version') {
    cb(null, 'ffmpeg version mock 1.0', '');
    return;
  }
  if (/^ffmpeg -ss /.test(cmd)) {
    // Video frame-grab (extractMetadataAndThumbnail's non-audio branch).
    const m = cmd.match(/-y "([^"]+)"\s*$/);
    const outPath = m && m[1];
    if (frameGrabSucceeds && outPath) {
      fs.writeFileSync(outPath, 'mock-thumbnail-bytes');
      cb(null, '', '');
    } else {
      cb(new Error('mock: frame-grab disabled for this test'));
    }
    return;
  }
  if (/^ffmpeg -i /.test(cmd)) {
    cb(new Error('mock: no embedded art (not exercised by this suite)'));
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
  nextFfprobeJson = { format: { duration: '42' }, streams: [
    { codec_type: 'video', codec_name: 'h264' },
    { codec_type: 'audio', codec_name: 'aac' },
  ] };
  frameGrabSucceeds = true;
});

// (a) Legacy video, unchanged, WITH an existing good thumbnail -- codec
// backfill must run, but the frame-grab must NEVER fire and every other
// field must be preserved untouched.
test('(a) legacy video with an existing thumbnail: codec-backfilled and reused, no frame-grab, metadata preserved', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-a-'));
  const filePath = path.join(root, 'legacy.mp4');
  const bytes = 'legacy-video-with-thumb';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);
  fs.writeFileSync(thumbPath, 'ORIGINAL-THUMBNAIL-BYTES');

  const originalAddedAt = 1700000000000;
  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'legacy.mp4', title: 'My Legacy Video', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: originalAddedAt, duration: 123, hasThumbnail: true,
        artist: 'SENTINEL-ARTIST', tags: { description: 'sentinel-desc' }, needsTranscode: false,
        // no videoCodec / audioCodec -- pre-v1.18 shape
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  assert.ok(item, 'item must still be indexed after the scan');

  // Codec fields backfilled.
  assert.equal(item.videoCodec, 'h264');
  assert.equal(item.audioCodec, 'aac');
  assert.equal(item.needsTranscode, false);

  // Everything else preserved untouched.
  assert.equal(item.title, 'My Legacy Video');
  assert.equal(item.duration, 123);
  assert.equal(item.addedAt, originalAddedAt);
  assert.equal(item.artist, 'SENTINEL-ARTIST');
  assert.deepEqual(item.tags, { description: 'sentinel-desc' });
  assert.equal(item.hasThumbnail, true);

  // The frame-grab (ffmpeg -ss ...) must NEVER have been invoked, and the
  // on-disk thumbnail bytes must be byte-for-byte unchanged.
  assert.equal(execCalls.some(c => /^ffmpeg -ss /.test(c)), false, 'no frame-grab spawn for a file with a good existing thumbnail');
  assert.equal(fs.readFileSync(thumbPath, 'utf8'), 'ORIGINAL-THUMBNAIL-BYTES', 'existing thumbnail bytes must be untouched');

  // Exactly one codec-only ffprobe call (the backfill probe) -- no second probe.
  assert.equal(execFileCalls.length, 1, 'exactly one ffprobe call (the codec-only backfill probe)');
});

// (b) Legacy video, unchanged, with a MISSING thumbnail (hasThumbnail:false)
// -- the thumbnail must be regenerated, while every other field stays as-is.
test('(b) legacy video with a MISSING thumbnail: thumbnail is regenerated, other fields preserved', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-b-'));
  const filePath = path.join(root, 'legacy-no-thumb.mp4');
  const bytes = 'legacy-video-no-thumb';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);
  // No thumbnail file on disk at all.

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'legacy-no-thumb.mp4', title: 'No Thumb Video', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000001, duration: 55, hasThumbnail: false,
        artist: 'SENTINEL-ARTIST-2', tags: {}, needsTranscode: false,
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];

  assert.equal(execCalls.some(c => /^ffmpeg -ss /.test(c)), true, 'the frame-grab must be attempted to restore the missing thumbnail');
  assert.equal(item.hasThumbnail, true, 'hasThumbnail flips true once the frame-grab succeeds');
  assert.equal(fs.existsSync(thumbPath), true, 'the thumbnail file now exists on disk');

  // Other fields untouched by the restore (only hasThumbnail is taken from
  // the restore call's result).
  assert.equal(item.title, 'No Thumb Video');
  assert.equal(item.duration, 55);
  assert.equal(item.addedAt, 1700000000001);
  assert.equal(item.artist, 'SENTINEL-ARTIST-2');

  // Codec fields still backfilled.
  assert.equal(item.videoCodec, 'h264');
  assert.equal(item.audioCodec, 'aac');
});

// (b-2) Same as (b) but the thumbnail FILE is missing even though
// `hasThumbnail` was (incorrectly) recorded true -- the 0-byte/absent-file
// check must still trigger a restore.
test('(b-2) legacy video whose hasThumbnail=true but the .jpg file is actually absent: thumbnail is still restored', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-b2-'));
  const filePath = path.join(root, 'ghost-thumb.mp4');
  const bytes = 'ghost-thumb-video';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);
  // Deliberately no file at thumbPath, despite hasThumbnail: true below.

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'ghost-thumb.mp4', title: 'Ghost Thumb', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000002, duration: 10, hasThumbnail: true,
        artist: '', tags: {}, needsTranscode: false,
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  assert.equal(execCalls.some(c => /^ffmpeg -ss /.test(c)), true, 'a missing on-disk file must trigger restoration even if hasThumbnail was true');
  assert.equal(db.metadata[id].hasThumbnail, true);
  assert.equal(fs.existsSync(thumbPath), true);
});

// (c) A genuinely new/changed file must still go through the FULL
// extractMetadataAndThumbnail path (probe + frame-grab).
test('(c) a genuinely new file still gets a full extraction (probe + frame-grab)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-c-'));
  const filePath = path.join(root, 'brand-new.mp4');
  fs.writeFileSync(filePath, 'brand-new-video-bytes');

  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const id = getMediaId(filePath);
  const db = readDb();
  const item = db.metadata[id];
  assert.ok(item, 'new item must be indexed');
  assert.equal(item.duration, 42, 'duration comes from the full probe');
  assert.equal(item.hasThumbnail, true, 'frame-grab ran and succeeded');
  assert.equal(item.videoCodec, 'h264');
  assert.equal(item.audioCodec, 'aac');
  assert.equal(execCalls.some(c => /^ffmpeg -ss /.test(c)), true, 'a brand-new file must still get a frame-grab');
});

// (d) Codec backfill flags a legacy HEVC .mp4 for transcode.
test('(d) legacy .mp4 backfilled with HEVC/AC-3 codecs is flagged needsTranscode=true', async () => {
  nextFfprobeJson = { format: { duration: '42' }, streams: [
    { codec_type: 'video', codec_name: 'hevc' },
    { codec_type: 'audio', codec_name: 'ac3' },
  ] };

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-d-'));
  const filePath = path.join(root, 'legacy-hevc.mp4');
  const bytes = 'legacy-hevc-video';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);
  fs.writeFileSync(thumbPath, 'EXISTING-THUMB');

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'legacy-hevc.mp4', title: 'Legacy HEVC', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000003, duration: 42, hasThumbnail: true,
        artist: '', tags: {}, needsTranscode: false,
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  assert.equal(item.videoCodec, 'hevc');
  assert.equal(item.audioCodec, 'ac3');
  assert.equal(item.needsTranscode, true, 'HEVC/AC-3 backfilled codecs must flag the legacy .mp4 for transcode');
  assert.equal(fs.readFileSync(thumbPath, 'utf8'), 'EXISTING-THUMB', 'thumbnail still untouched even though the file now needs transcoding');
});

// (e) Audio items still bypass the whole codec-backfill/thumbnail-restore
// mechanism entirely (no regression).
test('(e) audio items bypass the codec-backfill branch entirely (no probe, no frame-grab)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-e-'));
  const filePath = path.join(root, 'track.mp3');
  const bytes = 'audio-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'track.mp3', title: 'track', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp3',
        type: 'audio', addedAt: 1700000000004, duration: 42, hasThumbnail: false,
        artist: 'AUDIO-SENTINEL',
        // no videoCodec / audioCodec -- must not matter for audio items
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  assert.equal(db.metadata[id].artist, 'AUDIO-SENTINEL', 'audio item reused untouched');
  assert.equal(execFileCalls.length, 0, 'no codec probe for an unchanged audio item');
  assert.equal(execCalls.length, 0, 'no ffmpeg spawn at all for an unchanged audio item');
});

// (f) An already-migrated video (codec fields already present) still takes
// the plain reuse fast-path -- no probe at all.
test('(f) an already-migrated video (has codec fields) takes the plain reuse fast-path, no probe', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-f-'));
  const filePath = path.join(root, 'migrated.mp4');
  const bytes = 'already-migrated-video';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'migrated.mp4', title: 'migrated', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000005, duration: 42, hasThumbnail: true,
        artist: 'MIGRATED-SENTINEL', needsTranscode: false,
        videoCodec: 'h264', audioCodec: 'aac',
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  assert.equal(db.metadata[id].artist, 'MIGRATED-SENTINEL', 'already-migrated video reused untouched');
  assert.equal(execFileCalls.length, 0, 'no codec probe for an already-migrated video');
  assert.equal(execCalls.length, 0, 'no ffmpeg spawn at all for an already-migrated, unchanged video');
});
