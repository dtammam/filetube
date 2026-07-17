'use strict';

// [INTEGRATION] v1.18.0 T2 (FR-1b), part 4, HOTFIXED in v1.18.1 -- the
// reuse-unchanged-metadata guard's codec-field backfill. A VIDEO item is
// only taken on the PLAIN reuse fast-path once it already carries BOTH
// `videoCodec` and `audioCodec` keys; a pre-v1.18 (or probe-failed) entry
// lacking those keys is backfilled via the dedicated
// `legacyVideoCodecBackfillOnly` scan branch instead. Audio items are exempt
// (reconcileTranscode already short-circuits `type === 'audio'`).
//
// v1.18.0 REGRESSION, fixed in v1.18.1: that backfill branch used to be the
// SAME full re-init + `extractMetadataAndThumbnail` path new files take --
// which runs an ffmpeg frame-grab, clobbering the item's existing thumbnail
// (and resetting title/duration/artist/tags) on every legacy video's first
// post-upgrade scan. It is now a dedicated, narrower branch: codec fields
// are backfilled via the codec-only `probeCodecsOnly` (no frame-grab), and
// every other field (title/duration/addedAt/artist/tags/hasThumbnail) is
// preserved untouched -- the thumbnail is regenerated ONLY if it is
// genuinely missing (see test/integration/scan-thumbnail-preserve.test.js
// for the full backfill+thumbnail-preserve/restore matrix, using mocked
// ffmpeg/ffprobe so both branches -- with and without a real spawn -- are
// directly observable).
//
// No FFmpeg needed in THIS file: with ffmpegAvailable false (the CI default,
// per docs/RELIABILITY.md), the codec-only probe and any thumbnail-restore
// attempt both degrade safely to `null`/`false` without ever spawning
// anything -- so the sentinel fields below stay intact regardless.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-codec-backfill-'));

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
});

test('scanDirectories: a legacy video item missing videoCodec/audioCodec is codec-backfilled WITHOUT a full re-extraction (thumbnail-preserve hotfix)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-backfill-legacy-'));
  const filePath = path.join(root, 'legacy.mp4');
  const bytes = 'legacy-video-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  const addedAt = Date.now();

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'legacy.mp4', title: 'legacy', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt, duration: 42, hasThumbnail: false,
        artist: 'LEGACY-SENTINEL', needsTranscode: false,
        // no videoCodec / audioCodec -- pre-v1.18 shape
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  assert.ok(item, 'item must still be indexed after the scan');
  // The v1.18.1 hotfix: this is the dedicated codec-backfill branch, NOT the
  // full-reinit path new files take -- non-codec fields must survive
  // untouched (a full re-extraction would have reset title/duration/artist).
  assert.equal(item.title, 'legacy', 'title must be preserved, not recomputed');
  assert.equal(item.duration, 42, 'duration must be preserved, not reset to 0');
  assert.equal(item.addedAt, addedAt, 'addedAt must be preserved, not recomputed');
  assert.equal(item.artist, 'LEGACY-SENTINEL', 'artist must be preserved -- proves the legacy entry was NOT fully re-extracted');
  // Codec fields are backfilled (explicit null with ffmpeg unavailable).
  assert.equal(item.videoCodec, null);
  assert.equal(item.audioCodec, null);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'videoCodec'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'audioCodec'), true);
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
