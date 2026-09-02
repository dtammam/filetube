'use strict';

// [INTEGRATION] v1.251 (Dean's pinned-channel bug, root-caused): `db.metadata[id].type`
// is written for NEW items but was never BACKFILLED for items scanned before the field
// existed - so a pre-type-era audio download rendered as a VIDEO card on every list
// surface (musicHrefForItem gates on type === 'audio') and never projected into Music.
// The exact on-device symptom: audio from the pinned-channel view opened the video
// player while the (recent-item) home feed routed correctly.
//
// HARD GATE (thumbnail-backfill-regression lesson, the releaseDate/youtubeId posture):
// the backfill is SCHEMA-ONLY - the extension is already in the scan's hand, so adding
// `type` to an already-indexed item must trigger ZERO ffprobe/ffmpeg spawns and touch
// no unrelated state. Mocks child_process exactly like scan-release-date-backfill.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-type-backfill-'));
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

test('(HARD GATE) type backfill on an already-indexed, unchanged AUDIO item: type becomes audio with ZERO spawns (the pinned-channel case)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-type-audio-'));
  const filePath = path.join(root, 'old-song.mp3');
  const bytes = 'pre-type-era-audio-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'old-song.mp3', title: 'Old Song', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp3',
        addedAt: 1700000000000, duration: 60, hasThumbnail: false,
        artist: 'TYPE-BACKFILL-SENTINEL', releaseDate: 1700000000000, youtubeId: null,
        // no `type` - the pre-type-era shape that misrouted to the video player.
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = readDb();
  const item = db.metadata[id];
  assert.ok(item, 'item must still be indexed after the scan');
  assert.equal(item.type, 'audio', 'the extension-derived type is backfilled - the routing rule can now see this item is audio');
  assert.equal(execFileCalls.length, 0, 'no ffprobe for an unchanged audio item (schema-only)');
  assert.equal(execCalls.length, 0, 'no ffmpeg spawn of any kind');
  assert.equal(item.artist, 'TYPE-BACKFILL-SENTINEL', 'unrelated state untouched');
  assert.equal(item.addedAt, 1700000000000);
});

test('(HARD GATE) type backfill on an already-indexed, unchanged VIDEO (codec fields present): type becomes video with ZERO spawns', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-type-video-'));
  const filePath = path.join(root, 'old-clip.mp4');
  const bytes = 'pre-type-era-video-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'ORIGINAL-THUMBNAIL-BYTES');
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.sb.jpg`), 'ORIGINAL-STORYBOARD-BYTES');
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.pv.mp4`), 'ORIGINAL-PREVIEW-CLIP');

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'old-clip.mp4', title: 'Old Clip', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        addedAt: 1700000000000, duration: 123, hasThumbnail: true,
        artist: 'VIDEO-TYPE-SENTINEL', releaseDate: 1700000000000, youtubeId: null,
        needsTranscode: false, videoCodec: 'h264', audioCodec: 'aac',
        storyboard: { v: 1, interval: 3, count: 40, cols: 10, rows: 4, tileW: 160, tileH: 90 },
        // no `type` - pre-type-era shape.
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const item = readDb().metadata[id];
  assert.equal(item.type, 'video', 'video extension -> type video');
  assert.equal(execFileCalls.length, 0, 'no re-probe');
  assert.equal(execCalls.length, 0, 'no ffmpeg spawn');
  assert.equal(fs.readFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'utf8'), 'ORIGINAL-THUMBNAIL-BYTES', 'thumbnail untouched');
});

test('legacy video (missing codec fields) heals type in the codec-backfill arm too; one codec probe, no frame-grab', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-type-legacy-'));
  const filePath = path.join(root, 'ancient.mp4');
  const bytes = 'ancient-video-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'ANCIENT-THUMBNAIL-BYTES');

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'ancient.mp4', title: 'Ancient Video', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp4',
        addedAt: 1700000000000, duration: 42, hasThumbnail: true,
        artist: 'ANCIENT-SENTINEL', needsTranscode: false,
        // no videoCodec / audioCodec / type - the oldest shape.
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const item = readDb().metadata[id];
  assert.equal(item.type, 'video', 'the legacy arm heals type too');
  assert.equal(item.videoCodec, 'h264', 'codec backfill still runs (pre-existing v1.18.1 behavior)');
  assert.equal(execFileCalls.length, 1, 'exactly the one codec-only probe');
  assert.equal(execCalls.some(c => /^ffmpeg -ss /.test(c)), false, 'no frame-grab');
  assert.equal(fs.readFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'utf8'), 'ANCIENT-THUMBNAIL-BYTES', 'thumbnail untouched');
});

test('an item that ALREADY carries type is left completely untouched (presence wins - the backfill never clobbers)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-type-present-'));
  const filePath = path.join(root, 'typed.mp3');
  const bytes = 'already-typed-audio-bytes';
  fs.writeFileSync(filePath, bytes);
  const id = getMediaId(filePath);

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'typed.mp3', title: 'Typed Audio', filePath,
        folderName: path.basename(root), size: Buffer.byteLength(bytes), ext: '.mp3',
        // deliberately 'video' on an .mp3: a PRESENT field is authoritative (an admin
        // correction / a future writer must never be silently overwritten by the scan).
        type: 'video',
        addedAt: 1700000000000, duration: 60, hasThumbnail: false,
        artist: 'PRESENT-TYPE-SENTINEL', releaseDate: 1700000000000, youtubeId: null,
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const item = readDb().metadata[id];
  assert.equal(item.type, 'video', 'a present type is never clobbered by the backfill (hasOwnProperty guard)');
  assert.equal(execFileCalls.length, 0, 'still zero spawns');
});
