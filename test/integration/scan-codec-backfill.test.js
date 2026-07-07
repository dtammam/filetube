'use strict';

// [INTEGRATION] v1.18.0 T2 (FR-1b), part 4 -- the reuse-unchanged-metadata
// guard's codec-field backfill. A VIDEO item is only reused across a scan
// (skipping re-extraction) once it already carries BOTH `videoCodec` and
// `audioCodec` keys; a pre-v1.18 (or probe-failed) entry lacking those keys
// gets re-extracted exactly once to backfill them. Audio items are exempt
// (reconcileTranscode already short-circuits `type === 'audio'`).
//
// No FFmpeg needed: with ffmpegAvailable false (the CI default, per
// docs/RELIABILITY.md), extractMetadataAndThumbnail's early-return resolves
// `{ duration: 0, hasThumbnail: false, artist: '', tags: {} }` -- no
// `videoCodec`/`audioCodec` keys at all. That makes "was this item
// re-extracted?" directly observable: a sentinel `artist` value survives a
// scan only if the item was REUSED (never re-extracted); it gets reset to ''
// if the item was re-extracted (mirrors the scan-discovery.test.js pattern).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-codec-backfill-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

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
});

test('scanDirectories: a legacy video item missing videoCodec/audioCodec is re-extracted (backfill probe)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-backfill-legacy-'));
  const filePath = path.join(root, 'legacy.mp4');
  const bytes = 'legacy-video-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'legacy.mp4', title: 'legacy', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: Date.now(), duration: 42, hasThumbnail: false,
        artist: 'LEGACY-SENTINEL', needsTranscode: false,
        // no videoCodec / audioCodec -- pre-v1.18 shape
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[id], 'item must still be indexed after the scan');
  assert.equal(db.metadata[id].artist, '', 're-extraction ran (sentinel artist was overwritten), proving the backfill guard did NOT reuse the legacy entry');
});

test('scanDirectories: a video item that already carries codec fields is reused (no re-probe)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-backfill-probed-'));
  const filePath = path.join(root, 'probed.mp4');
  const bytes = 'already-probed-video-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'probed.mp4', title: 'probed', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: Date.now(), duration: 42, hasThumbnail: false,
        artist: 'KEPT-SENTINEL', needsTranscode: false,
        videoCodec: 'h264', audioCodec: 'aac',
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  assert.equal(db.metadata[id].artist, 'KEPT-SENTINEL', 'already-probed video item is reused untouched (no re-extraction)');
  assert.equal(db.metadata[id].videoCodec, 'h264');
  assert.equal(db.metadata[id].audioCodec, 'aac');
});

// ---------------------------------------------------------------------------
// Two-reviewer follow-up fix: a probe attempt (success, error, OR ffmpeg
// globally unavailable) must persist EXPLICIT `videoCodec: null` /
// `audioCodec: null` -- never leave the keys `undefined`/absent -- so the
// reuse guard's `hasCodecFields` check is satisfied after just ONE probe
// attempt and the file is REUSED (not re-extracted) on every later scan with
// unchanged mtime/size. Without this fix, an unprobeable/corrupt file (or an
// entire no-ffmpeg deployment, since `ffmpegAvailable` is false in this test
// environment -- there is no ffmpeg binary on the CI runner, matching a
// real no-ffmpeg deployment's early-return path in
// `extractMetadataAndThumbnail`) would be re-extracted on EVERY scan forever.
// ---------------------------------------------------------------------------

test('scanDirectories: a brand-new video item gets explicit null codec fields persisted on its FIRST scan (ffmpeg-unavailable / probe-attempt path)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-backfill-firstscan-'));
  const filePath = path.join(root, 'brand-new.mp4');
  fs.writeFileSync(filePath, 'brand-new-video-bytes');

  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const id = getMediaId(filePath);
  const db = readDb();
  assert.ok(db.metadata[id], 'item must be indexed after the first scan');
  assert.equal(db.metadata[id].videoCodec, null, 'videoCodec must be explicit null, not absent/undefined, after a probe attempt');
  assert.equal(db.metadata[id].audioCodec, null, 'audioCodec must be explicit null, not absent/undefined, after a probe attempt');
  assert.equal(
    Object.prototype.hasOwnProperty.call(db.metadata[id], 'videoCodec'), true,
    'the videoCodec key itself must survive the JSON round-trip (not dropped like undefined would be)'
  );
});

test('scanDirectories: a video item probed-with-no-usable-codec (null fields) is REUSED, not re-extracted, on a second scan with unchanged mtime/size', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-backfill-reuse-null-'));
  const filePath = path.join(root, 'unprobeable.mp4');
  const bytes = 'unprobeable-video-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'unprobeable.mp4', title: 'unprobeable', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: Date.now(), duration: 0, hasThumbnail: false,
        artist: 'NULL-CODEC-SENTINEL', needsTranscode: false,
        videoCodec: null, audioCodec: null, // probed once already, no usable codec found
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  assert.equal(db.metadata[id].artist, 'NULL-CODEC-SENTINEL', 'item with explicit null codec fields must be reused (no re-extraction) since size/mtime are unchanged');
  assert.equal(db.metadata[id].videoCodec, null);
  assert.equal(db.metadata[id].audioCodec, null);
});

test('scanDirectories: an .avi item with null codec fields still needs transcoding via the extension branch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-backfill-avi-'));
  const filePath = path.join(root, 'legacy.avi');
  const bytes = 'legacy-avi-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'legacy.avi', title: 'legacy', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.avi',
        type: 'video', addedAt: Date.now(), duration: 42, hasThumbnail: false,
        artist: 'AVI-SENTINEL', needsTranscode: true, transcodeStatus: 'ready',
        videoCodec: null, audioCodec: null,
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  assert.equal(db.metadata[id].artist, 'AVI-SENTINEL', 'reused (codec fields already present), not re-extracted');
  assert.equal(db.metadata[id].needsTranscode, true, '.avi still needs transcoding via the extension branch even with null codec fields');
});

test('scanDirectories: an audio item is always reused regardless of missing codec fields', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-backfill-audio-'));
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
        type: 'audio', addedAt: Date.now(), duration: 42, hasThumbnail: false,
        artist: 'AUDIO-SENTINEL',
        // no videoCodec / audioCodec -- must not matter for audio items
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  assert.equal(db.metadata[id].artist, 'AUDIO-SENTINEL', 'audio items skip the codec-field backfill guard entirely (always reused)');
  assert.equal(db.metadata[id].transcodeStatus, undefined, 'reconcileTranscode still short-circuits audio items');
});
