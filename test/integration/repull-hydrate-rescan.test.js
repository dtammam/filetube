'use strict';

// [INTEGRATION] v1.41.5 (Dean's MeTube-import hydration) -- the PERSIST-GATE /
// STALE-SNAPSHOT regression checkpoint for the newly-written channel identity.
//
// The bug class this file exists to prevent has struck five times in this repo:
// a field written outside the scan is silently wiped by the scan's own re-init
// branch (a file whose size changed -- a re-encode, a replaced download -- is
// rebuilt from the fresh literal, which knows nothing about fields other code
// added). A yt-dlp-rooted item can always re-derive its identity from its own
// download FOLDER on the next scan (the AC17 folder backfill), but a HYDRATED
// IMPORT lives in a plain library root and has no folder to fall back on: if
// the re-init drops its channel, it silently reverts to a generic folder-name
// channel and the reheat's OWN never-overwrite guard means a later reheat will
// NOT re-fix it. So the carry-forward is the only thing holding it.
//
// Drives the REAL server.js scan (never a re-implementation). ffmpeg/ffprobe
// are mocked at the child_process boundary (CI has no ffmpeg) -- the same
// technique as test/integration/scan-subtitles-backfill.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-hydrate-rescan-'));
const DATA_DIR = process.env.DATA_DIR;

const cp = require('child_process');

cp.exec = function mockExec(cmd, cb) {
  if (cmd === 'ffmpeg -version') {
    cb(null, 'ffmpeg version mock 1.0', '');
    return;
  }
  cb(new Error(`unexpected exec() call in test mock: ${cmd}`));
};

cp.execFile = function mockExecFile(bin, args, opts, cb) {
  if (typeof opts === 'function') { cb = opts; }
  if (bin === 'ffprobe') {
    cb(null, JSON.stringify({
      format: { duration: '42', tags: {} },
      streams: [
        { codec_type: 'video', codec_name: 'h264' },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    }), '');
    return;
  }
  cb(new Error(`unexpected execFile() call in test mock: ${bin}`));
};

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  scanDirectories, getMediaId, saveDatabase, loadDatabase, updateDatabase, recordRepulledItemMeta,
  enumerateRepullableItems, __resetDatabaseForTests,
} = require('../../server');
const { readPersistedDatabase } = require('../../lib/db/sqlite');
const ytdlp = require('../../lib/ytdlp');

function baseSettings() {
  return { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0 };
}

// The identity a reheat discovers for a MeTube-imported file.
const HYDRATED = {
  channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
  channelHandleUrl: 'https://www.youtube.com/@RickAstley',
  channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
  channelName: 'Rick Astley',
};

let libraryDir;

beforeEach(async () => {
  // v1.42: the between-test reset (an OPEN SQLite database cannot be rm'd out
  // from under its connection the way db.json could).
  await __resetDatabaseForTests();
  // A NORMAL library root -- deliberately NOT FileTube's yt-dlp download dir.
  // This is exactly where Dean's MeTube downloads live.
  libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-metube-library-'));
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
});

afterEach(() => {
  fs.rmSync(libraryDir, { recursive: true, force: true });
});

// v1.42: persisted-state reads go through the sanctioned SQLite helper (a
// second, read-only connection). An empty metadata namespace persists as zero
// rows (absent), hence the `|| {}`.
function readItem(id) {
  return (readPersistedDatabase(DATA_DIR).metadata || {})[id];
}

// Index a bracket-less import (the MeTube shape), then hydrate it exactly the
// way the reheat batch does -- through the real `recordRepulledItemMeta`.
async function seedAndHydrate(fileName, bytes) {
  const filePath = path.join(libraryDir, fileName);
  fs.writeFileSync(filePath, bytes);
  saveDatabase({
    folders: [libraryDir],
    folderSettings: {},
    progress: {},
    metadata: {},
    settings: baseSettings(),
  });

  await scanDirectories();
  const id = getMediaId(filePath);
  assert.ok(readItem(id), 'sanity: the imported file must be indexed');

  await recordRepulledItemMeta(
    { loadDatabase, updateDatabase, getMediaId },
    id,
    {
      filePath,
      channel: { ...HYDRATED },
      channelAvatarUrl: 'https://yt3.googleusercontent.com/avatar.jpg',
      youtubeId: 'dQw4w9WgXcQ',
      sourceTitle: 'Never Gonna Give You Up',
      markComplete: true,
    },
  );

  const hydrated = readItem(id);
  assert.equal(hydrated.channelName, 'Rick Astley', 'sanity: hydration landed');
  return { filePath, id };
}

function assertIdentityIntact(item, context) {
  assert.equal(item.channelUrl, HYDRATED.channelUrl, `${context}: channelUrl must survive (it is what draws the Subscribe button)`);
  assert.equal(item.channelHandleUrl, HYDRATED.channelHandleUrl, `${context}: channelHandleUrl must survive`);
  assert.equal(item.channelId, HYDRATED.channelId, `${context}: channelId must survive (it is the avatar-registry key)`);
  assert.equal(item.channelName, 'Rick Astley', `${context}: channelName must survive (else the card reverts to the folder label)`);
  assert.equal(item.channelAvatarUrl, 'https://yt3.googleusercontent.com/avatar.jpg', `${context}: the avatar must survive`);
  assert.equal(item.youtubeId, 'dQw4w9WgXcQ', `${context}: the source id must survive`);
  assert.equal(item.metadataRepulledAt !== undefined, true, `${context}: the reheat marker must survive (else the item is re-fetched forever)`);
}

test('hydrate -> rescan (file UNCHANGED): the channel identity survives the reuse fast path', async () => {
  const { id } = await seedAndHydrate('Never Gonna Give You Up.mp4', 'metube-video-bytes');

  await scanDirectories();

  assertIdentityIntact(readItem(id), 'unchanged rescan');
});

test('hydrate -> rescan (file CHANGED: same path, new size -> the scan RE-INITS the entry): the channel identity STILL survives', async () => {
  const { filePath, id } = await seedAndHydrate('Never Gonna Give You Up.mp4', 'metube-video-bytes');

  // A re-encode / replaced file: same path, different size. This is the branch
  // that rebuilds the metadata entry from a fresh literal -- the exact place
  // the persist-gate bug class strikes.
  fs.writeFileSync(filePath, 'metube-video-bytes-but-re-encoded-and-longer');

  await scanDirectories();

  const item = readItem(id);
  assert.equal(item.size, Buffer.byteLength('metube-video-bytes-but-re-encoded-and-longer'), 'sanity: the scan really did re-init this entry (new size)');
  assertIdentityIntact(item, 're-init rescan');
});

test('a plain library file that was NEVER hydrated still gets no channel identity from a rescan (the carry-forward invents nothing)', async () => {
  const filePath = path.join(libraryDir, 'Family BBQ.mp4');
  fs.writeFileSync(filePath, 'home-video-bytes');
  saveDatabase({
    folders: [libraryDir],
    folderSettings: {},
    progress: {},
    metadata: {},
    settings: baseSettings(),
  });

  await scanDirectories();
  fs.writeFileSync(filePath, 'home-video-bytes-edited-longer'); // force the re-init branch too
  await scanDirectories();

  const item = readItem(getMediaId(filePath));
  assert.equal(item.channelUrl, undefined);
  assert.equal(item.channelName, undefined);
  assert.equal(item.channelId, undefined);
});

// GATE FIX (adversarial CRITICAL -- promoted verbatim from the reviewer's
// repro): the reheat is now a LIBRARY-WIDE batch that runs for minutes-to-hours
// with NO mutual exclusion against the periodic scan (server.js's Phase-2 merge
// block says so itself). A hydration landing after the scan's Phase-1 snapshot
// but before its final save was reverted by the wholesale `newMetadata`
// replace -- while `metadataRepulledAt` survived, so a later non-force reheat
// would SKIP the item forever and the AC17 folder backfill can't heal a
// plain-library-root import. Permanent identity loss. The Phase-2 merge now
// adopts the identity as a unit.
test('a reheat that lands MID-SCAN keeps its channel identity (Phase-2 merge adoption -- the persist-gate class\'s 6th strike)', async () => {
  // Enough files that the scan is definitely still in Phase 1 when the reheat
  // write lands (mirrors Dean's real library: the reheat is a long batch).
  for (let i = 0; i < 300; i++) {
    fs.writeFileSync(path.join(libraryDir, `pad-${i}.mp4`), `pad-bytes-${i}`);
  }
  const target = path.join(libraryDir, 'Never Gonna Give You Up.mp4');
  fs.writeFileSync(target, 'metube-video-bytes');

  saveDatabase({
    folders: [libraryDir],
    folderSettings: {},
    progress: {},
    metadata: {},
    settings: baseSettings(),
  });
  await scanDirectories();
  const id = getMediaId(target);
  assert.ok(readItem(id), 'sanity: indexed');

  // A periodic scan starts (its Phase-1 snapshot has no channel identity)...
  const scanPromise = scanDirectories();

  // ...and the reheat batch hydrates the item WHILE that scan is running.
  await recordRepulledItemMeta(
    { loadDatabase, updateDatabase, getMediaId },
    id,
    {
      filePath: target,
      channel: { ...HYDRATED },
      channelAvatarUrl: 'https://yt3.googleusercontent.com/avatar.jpg',
      youtubeId: 'dQw4w9WgXcQ',
      sourceTitle: 'Never Gonna Give You Up',
      markComplete: true,
    },
  );
  assert.equal(readItem(id).channelName, 'Rick Astley', 'sanity: hydration landed on disk');

  // The scan finishes and saves.
  await scanPromise;

  assertIdentityIntact(readItem(id), 'concurrent scan');
});

// GATE FIX (adversarial CRITICAL #2, first half -- promoted from the reviewer's
// repro): an ordinary, non-YouTube library file IS enumerated by the widened
// gate (that is deliberate -- the local, network-free tag check is the only way
// a pre-v1.33 purl-only import is ever discovered), but it must carry NO source
// id, so it can never reach the network. The second half of that repro -- that
// the batch must not then forward its ID3 title/date into the SUPERSEDE write
// -- is locked at the batch boundary, where the fix lives:
// test/integration/ytdlp-repull-metadata-endpoint.test.js.
test('an ordinary, non-YouTube library MP3 is enumerated with NO source id (network-free) -- its curated title is never at risk', async () => {
  const song = path.join(libraryDir, 'Beethoven - Symphony No. 5.mp3');
  fs.writeFileSync(song, 'ripped-cd-bytes');
  saveDatabase({
    folders: [libraryDir],
    folderSettings: {},
    progress: {},
    metadata: {},
    settings: baseSettings(),
  });
  await scanDirectories();

  const gate = enumerateRepullableItems(loadDatabase(), ytdlp.parseYtdlpConfig());
  assert.equal(gate.eligible, 1, 'enumerated (for the local tag check only)');
  assert.equal(gate.withSourceId, 0, 'no YouTube id -> the batch can never spawn a network call for it');
  assert.equal(gate.items[0].watchUrl, null);
  assert.equal(readItem(getMediaId(song)).title, 'Beethoven - Symphony No. 5', 'sanity: the curated, filename-derived title');
});
