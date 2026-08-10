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
// v1.19.1 hotfix follow-up: the plain `reusable` fast-path (a VIDEO item that
// ALREADY carries codec fields -- e.g. it already ran through the v1.18.1
// backfill on a prior scan, or was scanned fresh under v1.19+) previously
// copied `existing` as-is with NO thumbnail check at all -- so a video whose
// thumbnail was clobbered/lost by the v1.18.0 regression on an EARLIER scan,
// but which already picked up codec fields on that same earlier scan, would
// never heal on subsequent rescans. `restoreMissingThumbnail` (extracted from
// the backfill-only branch above) is now also called from the `reusable`
// branch for VIDEO items only -- see tests (g)/(h)/(i) below. Audio items are
// explicitly excluded (test (e) already proves no probe/spawn for them).
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
//
// v1.19.0 two-reviewer-gate follow-up (FIX A): `extractMetadataAndThumbnail`'s
// two ffmpeg thumbnail spawns (audio-art extraction + video frame-grab) were
// hardened from shell-string `exec` to arg-array `execFile` (command-injection
// hardening, matching the ffprobe `execFile` call). Both are now observed via
// the `mockExecFile` double below (keyed on `bin === 'ffmpeg'`), which
// re-derives an equivalent command string and pushes it onto `execCalls` so
// every existing `execCalls.some(c => /^ffmpeg -ss /.test(c))`-style assertion
// below still meaningfully proves invocation/non-invocation of the frame-grab
// specifically (still fails if the frame-grab fires when it must not, and vice
// versa) -- `exec` itself is no longer used for either ffmpeg thumbnail
// spawn, so `mockExec` only remains wired for the (unused-by-this-suite)
// `ffmpeg -version` availability check.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-thumb-preserve-'));
const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

const cp = require('child_process');

let execCalls = [];
let execFileCalls = [];
let nextFfprobeJson = { format: { duration: '42' }, streams: [] };
let frameGrabSucceeds = true;
// v1.92: the storyboard sprite generation (a new ffmpeg use). Default success
// writes a mock sprite so restoreMissingStoryboard's one-time backfill settles.
let storyboardGenSucceeds = true;

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
    // v1.19.0 FIX A: both ffmpeg thumbnail spawns moved from shell-string
    // `exec` to arg-array `execFile`. Re-derive an equivalent command string
    // and push it onto `execCalls` so every pre-existing
    // `execCalls.some(c => /^ffmpeg -ss /.test(c))`-style assertion below
    // still observes frame-grab invocation/non-invocation exactly as before.
    const cmd = ['ffmpeg', ...args].join(' ');
    execCalls.push(cmd);
    if (args[0] === '-ss') {
      // Video frame-grab (extractMetadataAndThumbnail's non-audio branch):
      // ['-ss', timestamp, '-i', filePath, '-vframes', '1', '-q:v', '2', '-y', thumbPath]
      const outPath = args[args.length - 1];
      if (frameGrabSucceeds && outPath) {
        fs.writeFileSync(outPath, 'mock-thumbnail-bytes');
        cb(null, '', '');
      } else {
        cb(new Error('mock: frame-grab disabled for this test'));
      }
      return;
    }
    if (args[0] === '-i') {
      cb(new Error('mock: no embedded art (not exercised by this suite)'));
      return;
    }
    if (args[0] === '-nostdin') {
      // Storyboard sprite generation. v1.93.1 splits it into TWO ffmpeg shapes,
      // BOTH beginning '-nostdin' and BOTH ending with their output path:
      //   GRAB (x plan.count): ['-nostdin','-loglevel','error','-ss',t,'-i',
      //     src,'-frames:v','1','-an','-vf','scale=W:-2','-y',frame.png]
      //     (lossless PNG intermediate, no -q:v)
      //   ASSEMBLE (x1): ['-nostdin','-loglevel','error','-start_number','0',
      //     '-i',pattern,'-frames:v','1','-vf','tile=CxR','-q:v','4','-y',out]
      // This mock routes solely on args[0]==='-nostdin' and writes the trailing
      // output path, so it stands in for both stages (a grab writes its frame
      // file into the temp dir extractStoryboard just created; the assemble
      // writes the sprite). Tests assert the two-stage shape via execCalls.
      const outPath = args[args.length - 1];
      if (storyboardGenSucceeds && outPath) {
        fs.writeFileSync(outPath, 'mock-storyboard-bytes');
        cb(null, '', '');
      } else {
        cb(new Error('mock: storyboard gen disabled for this test'));
      }
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
  nextFfprobeJson = { format: { duration: '42' }, streams: [
    { codec_type: 'video', codec_name: 'h264' },
    { codec_type: 'audio', codec_name: 'aac' },
  ] };
  frameGrabSucceeds = true;
  storyboardGenSucceeds = true;
});

// Helper: any leftover per-id storyboard temp dirs in THUMBNAIL_DIR (a #110-class
// leak). Empty is the invariant - extractStoryboard removes them in a finally.
function sbTmpLeftovers() {
  try {
    return fs.readdirSync(THUMBNAIL_DIR).filter(n => n.startsWith('.sbtmp-'));
  } catch (_) { return []; }
}

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

// (f) A FULLY-migrated video (codec fields + GOOD thumbnail + a storyboard
// sprite already present) still takes the plain reuse fast-path -- no probe,
// no frame-grab, no storyboard generation, completely untouched. (v1.92: "fully
// migrated" now includes the storyboard sidecar; the one-time backfill for a
// storyboard-LESS item is covered by (f2) below.)
test('(f) a fully-migrated video (codecs + thumbnail + storyboard) takes the plain reuse fast-path, no ffmpeg at all', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-f-'));
  const filePath = path.join(root, 'migrated.mp4');
  const bytes = 'already-migrated-video';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);
  fs.writeFileSync(thumbPath, 'MIGRATED-GOOD-THUMB');
  // v1.92: a present storyboard sidecar + descriptor -> no backfill work.
  const sbPath = path.join(THUMBNAIL_DIR, `${id}.sb.jpg`);
  fs.writeFileSync(sbPath, 'MIGRATED-GOOD-SB');

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
        storyboard: { v: 1, interval: 4.2, count: 10, cols: 10, rows: 1, tileW: 160, tileH: 90 },
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  assert.equal(db.metadata[id].artist, 'MIGRATED-SENTINEL', 'already-migrated video reused untouched');
  assert.equal(execFileCalls.length, 0, 'no codec probe for an already-migrated video');
  assert.equal(execCalls.length, 0, 'no ffmpeg spawn at all for a fully-migrated video (thumb + storyboard present)');
  assert.equal(fs.readFileSync(thumbPath, 'utf8'), 'MIGRATED-GOOD-THUMB', 'existing thumbnail bytes must be untouched');
  assert.equal(fs.readFileSync(sbPath, 'utf8'), 'MIGRATED-GOOD-SB', 'existing storyboard bytes must be untouched');
});

// (f2) v1.92: a reused video that already carries codec fields + a good
// thumbnail but PREDATES the storyboard feature (no descriptor) gets its ONE
// storyboard sprite on the reuse fast-path -- the thumbnail is never re-grabbed
// -- and a SECOND scan generates NOTHING (the backfill is one-time, not the
// per-scan re-extraction the thumbnail-backfill-regression class warns about).
test('(f2) a storyboard-less reused video gets EXACTLY ONE storyboard pass (no thumbnail re-grab), and none on the next scan', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-f2-'));
  const filePath = path.join(root, 'needs-sb.mp4');
  const bytes = 'needs-storyboard-video';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);
  fs.writeFileSync(thumbPath, 'GOOD-THUMB-NO-SB');

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'needs-sb.mp4', title: 'needs-sb', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000006, duration: 42, hasThumbnail: true,
        artist: 'NEEDS-SB-SENTINEL', needsTranscode: false,
        videoCodec: 'h264', audioCodec: 'aac',
        // no storyboard key -- predates v1.92
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  // v1.93.1 BOUNDED-MEMORY shape: the storyboard backfill is plan.count
  // SINGLE-input grabs + exactly ONE tile-assembly spawn - never the v1.93.0
  // single N-input command (whose N resident decoders spiked to 9.3 GB).
  const tileCalls = execCalls.filter(c => /tile=\d+x\d+/.test(c));
  assert.equal(tileCalls.length, 1, 'exactly one tile-ASSEMBLY spawn');
  assert.ok(/tile=10x3/.test(tileCalls[0]), 'assembled into the planStoryboard(42)=22-frame 10x3 grid');
  const grabCalls = execCalls.filter(c => c !== tileCalls[0]);
  assert.equal(grabCalls.length, 22, 'one GRAB per frame (planStoryboard(42).count = 22)');
  grabCalls.forEach(c => assert.equal((c.match(/ -i /g) || []).length, 1,
    'each grab holds EXACTLY ONE source input (the bounded-memory guarantee)'));
  assert.ok(!execCalls.some(c => /^ffmpeg -ss /.test(c)), 'the good thumbnail is never re-grabbed');
  assert.equal(fs.readFileSync(thumbPath, 'utf8'), 'GOOD-THUMB-NO-SB', 'existing thumbnail bytes untouched');
  let db = readDb();
  assert.ok(db.metadata[id].storyboard && db.metadata[id].storyboard.count === 22, 'the storyboard descriptor (planStoryboard(42)) is now persisted');
  assert.deepEqual(sbTmpLeftovers(), [], 'the per-id temp dir is removed after generation (no #110-class leak)');

  // Second scan: the storyboard is present -> NO further ffmpeg work (one-time).
  execCalls = [];
  execFileCalls = [];
  await scanDirectories();
  assert.equal(execCalls.length, 0, 'no storyboard (or any) ffmpeg spawn on the second scan -- backfill is one-time, no churn');
  db = readDb();
  assert.equal(db.metadata[id].artist, 'NEEDS-SB-SENTINEL', 'still reused untouched on the second scan');
});

// (f3) v1.93.1: a storyboard GRAB failure degrades gracefully - the whole
// sprite is abandoned (a single missing frame would poison the image2
// sequence), the descriptor is an explicit null, NO half-written sprite is left
// on disk, and the per-id temp dir is cleaned up (the #110 leak lesson under a
// failure path, not just the happy path).
test('(f3) a storyboard generation failure leaves no sprite, a null descriptor, and no temp-dir leak', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-f3-'));
  const filePath = path.join(root, 'sb-fails.mp4');
  const bytes = 'storyboard-gen-will-fail';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'GOOD-THUMB');

  storyboardGenSucceeds = false; // every ffmpeg grab errors

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'sb-fails.mp4', title: 'sb-fails', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000007, duration: 42, hasThumbnail: true,
        artist: 'SB-FAIL-SENTINEL', needsTranscode: false,
        videoCodec: 'h264', audioCodec: 'aac',
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  // Grabs were ATTEMPTED (the backfill tried) but the first failed -> aborted.
  assert.ok(execCalls.length >= 1, 'the storyboard backfill was attempted');
  assert.ok(!execCalls.some(c => /tile=\d+x\d+/.test(c)), 'assembly never runs once a grab fails');
  const sbPath = path.join(THUMBNAIL_DIR, `${id}.sb.jpg`);
  assert.equal(fs.existsSync(sbPath), false, 'no half-written sprite is left behind');
  assert.deepEqual(sbTmpLeftovers(), [], 'the temp dir is cleaned up even on the failure path');
  const db = readDb();
  assert.strictEqual(db.metadata[id].storyboard, null, 'the descriptor is an explicit null (persist-gate: field present)');
  assert.equal(db.metadata[id].artist, 'SB-FAIL-SENTINEL', 'the item is otherwise reused untouched');
});

// (g) v1.19.1 hotfix: a reused VIDEO (already carries codec fields -- takes
// the plain `reusable` fast-path, NOT the legacyVideoCodecBackfillOnly
// branch) whose thumbnail is genuinely MISSING (hasThumbnail:false) gets
// healed: the frame-grab fires, hasThumbnail flips true, and it is persisted
// (dbChanged) -- even though no codec backfill was needed.
test('(g) reused video (codec fields present) with hasThumbnail:false is healed on the plain reuse fast-path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-g-'));
  const filePath = path.join(root, 'reused-no-thumb.mp4');
  const bytes = 'reused-video-missing-thumb';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);
  // No thumbnail file on disk.

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'reused-no-thumb.mp4', title: 'Reused No Thumb', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000006, duration: 42, hasThumbnail: false,
        artist: 'REUSE-SENTINEL', needsTranscode: false,
        videoCodec: 'h264', audioCodec: 'aac',
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  // No SEPARATE codec-only probe (`probeCodecsOnly`) is invoked -- codec
  // fields are already present, so this is the reusable fast-path, not
  // backfill-only. The single ffprobe call observed here is the one
  // `extractMetadataAndThumbnail` itself issues internally as part of the
  // thumbnail restore (duration + stream probing ahead of the frame-grab).
  assert.equal(execFileCalls.length, 1, 'exactly one ffprobe call, from extractMetadataAndThumbnail\'s own internal probe (not a separate codec-only backfill probe)');
  assert.equal(execCalls.some(c => /^ffmpeg -ss /.test(c)), true, 'the frame-grab must be attempted to heal the missing thumbnail on the reuse fast-path');
  assert.equal(item.hasThumbnail, true, 'hasThumbnail flips true once the frame-grab succeeds, and is persisted to the DB');
  assert.equal(fs.existsSync(thumbPath), true, 'the thumbnail file now exists on disk');
  assert.equal(item.artist, 'REUSE-SENTINEL', 'unrelated fields untouched by the heal');
  assert.equal(item.duration, 42, 'unrelated fields untouched by the heal');
});

// (h) v1.19.1 hotfix: same as (g), but `hasThumbnail` was (incorrectly)
// recorded true even though the .jpg file is actually absent on disk --
// the reuse fast-path must still detect and heal it.
test('(h) reused video (codec fields present) whose hasThumbnail=true but the .jpg is actually absent is still healed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-h-'));
  const filePath = path.join(root, 'reused-ghost-thumb.mp4');
  const bytes = 'reused-video-ghost-thumb';
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
        id, name: 'reused-ghost-thumb.mp4', title: 'Reused Ghost Thumb', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        type: 'video', addedAt: 1700000000007, duration: 7, hasThumbnail: true,
        artist: '', needsTranscode: false,
        videoCodec: 'h264', audioCodec: 'aac',
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  assert.equal(execCalls.some(c => /^ffmpeg -ss /.test(c)), true, 'a missing on-disk file must trigger healing even if hasThumbnail was true, on the reuse fast-path');
  assert.equal(db.metadata[id].hasThumbnail, true);
  assert.equal(fs.existsSync(thumbPath), true);
});

// (i) v1.19.1 hotfix: a reused AUDIO item with hasThumbnail:false must NEVER
// be healed/probed -- audio "thumbnails" are embedded cover art legitimately
// absent for many files; re-probing every scan would be needless churn.
test('(i) reused audio item with hasThumbnail:false is NOT healed/probed on the reuse fast-path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-i-'));
  const filePath = path.join(root, 'reused-track.mp3');
  const bytes = 'reused-audio-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'reused-track.mp3', title: 'reused-track', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp3',
        type: 'audio', addedAt: 1700000000008, duration: 42, hasThumbnail: false,
        artist: 'AUDIO-REUSE-SENTINEL',
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  assert.equal(db.metadata[id].artist, 'AUDIO-REUSE-SENTINEL', 'audio item reused untouched');
  assert.equal(execFileCalls.length, 0, 'no codec/embedded-art probe for an unchanged audio item');
  assert.equal(execCalls.length, 0, 'no ffmpeg spawn at all for an unchanged audio item, even with hasThumbnail:false');
  assert.equal(fs.existsSync(thumbPath), false, 'no thumbnail file created for audio');
});
