'use strict';

// [INTEGRATION] v1.33 T5 (coverage backfill) -- the transcode EXECUTION path,
// previously the largest untested core surface: every surrounding helper
// (naming, cache eviction, age sweep) had tests, but the two ffmpeg spawn
// sites (processTranscodeQueue, streamLiveTranscode) and the scan-time
// healer (reconcileTranscode) did not -- because CI has no ffmpeg, so every
// prior suite could only exercise the ffmpeg-UNAVAILABLE branches.
//
// The trick here: a STUB `ffmpeg` executable on PATH, installed BEFORE
// server.js is required, so its startup `exec('ffmpeg -version')` detection
// finds it and `ffmpegAvailable` goes true for the whole process. The stub
// speaks just enough ffmpeg:
//   - `-version`            -> exit 0 (detection)
//   - output `pipe:1`       -> stream bytes to stdout (the live path)
//   - a `corrupt-source` input -> stderr + exit 1 (the failure path)
//   - anything else         -> a `time=` progress line on stderr, then write
//                              bytes to the LAST arg (the queue's .tmp.mp4,
//                              or a thumbnail path) and exit 0
// Everything asserted is server.js's own behavior around the spawn: the 503
// lazy contract, the atomic .tmp -> rename finalize, status transitions,
// Range serving of the cached copy, tmp cleanup on failure, the live pipe,
// the ?download=1 bypass, and reconcileTranscode's two healing directions.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ffmpeg-'));
fs.writeFileSync(path.join(binDir, 'ffmpeg'), `#!/bin/bash
if [[ "$1" == "-version" ]]; then echo "ffmpeg version 0.0-filetube-test-stub"; exit 0; fi
args="$*"
last="\${@: -1}"
if [[ "$args" == *corrupt-source* ]]; then echo "Invalid data found when processing input" >&2; exit 1; fi
if [[ "$last" == "pipe:1" ]]; then head -c 2048 /dev/zero; exit 0; fi
echo "frame=5 time=00:00:00.50 bitrate=ok" >&2
head -c 4096 /dev/zero > "$last"
exit 0
`, { mode: 0o755 });
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-transcode-exec-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, loadDatabase, getMediaId, transcodedPath, scanDirectories } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
let mediaDir;

function seedItem(name, extra = {}) {
  const filePath = path.join(mediaDir, name);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, `fake-avi-bytes-for-${name}`);
  const id = getMediaId(filePath);
  return {
    id,
    name,
    title: path.basename(name, path.extname(name)),
    filePath,
    folderName: path.basename(mediaDir),
    size: fs.statSync(filePath).size,
    ext: path.extname(name),
    type: 'video',
    addedAt: Date.now(),
    duration: 1,
    hasThumbnail: false,
    artist: '',
    needsTranscode: true,
    videoCodec: 'mpeg4',
    audioCodec: 'mp3',
    releaseDate: 1000,
    rootFolder: mediaDir,
    ...extra,
  };
}

function seedDb(items) {
  const metadata = {};
  for (const item of items) metadata[item.id] = item;
  saveDatabase({
    folders: [mediaDir],
    folderSettings: {},
    progress: {},
    metadata,
    settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
}

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-transcode-media-'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(mediaDir, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
});

// Poll GET /video/:id until it stops 503ing (or the deadline passes). Each
// poll re-kicks queueTranscode for a still-pending item, so this also rides
// out the small startup window before server.js's own async ffmpeg-detect
// callback lands.
async function pollUntilServed(id, deadlineMs = 20000) {
  const startedAt = Date.now();
  for (;;) {
    const res = await fetch(`${base}/video/${id}`);
    if (res.status !== 503) return res;
    await res.arrayBuffer(); // drain
    if (Date.now() - startedAt > deadlineMs) return res;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function pollTranscodeStatus(id, wanted, deadlineMs = 20000) {
  const startedAt = Date.now();
  for (;;) {
    const res = await fetch(`${base}/api/videos/${id}`);
    const body = await res.json();
    if (body.transcodeStatus === wanted) return body;
    if (Date.now() - startedAt > deadlineMs) return body;
    // Re-kick the lazy queue exactly like a polling client would.
    await (await fetch(`${base}/video/${id}`)).arrayBuffer();
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('lazy transcode: 503 {error:transcoding} on first request, the queue drains through the ffmpeg spawn, finalizes atomically, and the cached MP4 serves with Range support', async () => {
  const item = seedItem('lazy-success.avi');
  seedDb([item]);

  const first = await fetch(`${base}/video/${item.id}`);
  assert.equal(first.status, 503, 'first request must report transcoding-in-progress');
  const firstBody = await first.json();
  assert.equal(firstBody.error, 'transcoding');

  const served = await pollUntilServed(item.id);
  assert.equal(served.status, 200, 'the queue must drain to a servable cached MP4');
  assert.equal(served.headers.get('content-type'), 'video/mp4');
  assert.equal((await served.arrayBuffer()).byteLength, 4096, 'the exact finalized cache bytes');

  const outPath = transcodedPath(item.id);
  assert.ok(fs.existsSync(outPath), 'the finalized cache file must exist at transcodedPath(id)');
  assert.ok(!fs.existsSync(outPath + '.tmp.mp4'), 'the atomic .tmp.mp4 must be gone after the rename');
  assert.equal(loadDatabase().metadata[item.id].transcodeStatus, 'ready');

  // Range support on the cached copy.
  const ranged = await fetch(`${base}/video/${item.id}`, { headers: { Range: 'bytes=0-99' } });
  assert.equal(ranged.status, 206);
  assert.match(ranged.headers.get('content-range') || '', /^bytes 0-99\/4096$/);
  assert.equal((await ranged.arrayBuffer()).byteLength, 100);
});

test('lazy transcode failure: a corrupt source lands transcodeStatus:failed with no cache/tmp litter, and the route reports it without re-queueing', async () => {
  const item = seedItem('corrupt-source.avi');
  seedDb([item]);

  const first = await fetch(`${base}/video/${item.id}`);
  assert.equal(first.status, 503);
  await first.arrayBuffer();

  const body = await pollTranscodeStatus(item.id, 'failed');
  assert.equal(body.transcodeStatus, 'failed', 'a corrupt source must land failed, not hang pending');
  assert.ok(!fs.existsSync(transcodedPath(item.id)), 'no finalized cache file may exist for a failed run');
  assert.ok(!fs.existsSync(transcodedPath(item.id) + '.tmp.mp4'), 'no partial tmp file may linger');

  const after503 = await fetch(`${base}/video/${item.id}`);
  assert.equal(after503.status, 503);
  assert.equal((await after503.json()).status, 'failed', 'the route must surface the failed status to the polling client');
});

test('live transcode (?live=1): streams the ffmpeg stdout pipe straight through with no-store', async () => {
  const item = seedItem('live-source.avi');
  seedDb([item]);
  // Ensure the live branch is actually taken even though no cache exists.
  fs.rmSync(transcodedPath(item.id), { force: true });

  const res = await fetch(`${base}/video/${item.id}?live=1`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await res.arrayBuffer()).byteLength, 2048, 'the piped stdout bytes, end to end');
});

test('live transcode (?live=1): a source that ffmpeg rejects still ends the response cleanly (no hang)', async () => {
  const item = seedItem('corrupt-source-live.avi');
  // The stub matches on 'corrupt-source' anywhere in the argv.
  seedDb([item]);

  const res = await fetch(`${base}/video/${item.id}?live=1`);
  assert.equal(res.status, 200, 'headers were already sent before ffmpeg died -- the contract is a cleanly-ENDED stream');
  assert.equal((await res.arrayBuffer()).byteLength, 0, 'no bytes, but a terminated response, never a hang');
});

test('download intent (?download=1): always the ORIGINAL container with an attachment disposition, never the transcode', async () => {
  const item = seedItem('download-source.avi');
  seedDb([item]);
  fs.mkdirSync(path.dirname(transcodedPath(item.id)), { recursive: true });
  fs.writeFileSync(transcodedPath(item.id), 'cached-transcode-bytes');

  const res = await fetch(`${base}/video/${item.id}?download=1`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') || '', /^attachment/);
  const bytes = await res.arrayBuffer();
  assert.equal(bytes.byteLength, fs.statSync(item.filePath).size, 'the ORIGINAL file bytes, not the cached transcode');
});

test('reconcileTranscode (scan-time healer): a stale ready with no cached file is cleared; an unmarked item with a cached file becomes ready', async () => {
  const stale = seedItem('stale-ready.avi', { transcodeStatus: 'ready' });
  const heal = seedItem('heal-to-ready.avi');
  delete heal.transcodeStatus;

  // The heal item's cached MP4 exists on disk; the stale item's does not.
  fs.mkdirSync(path.dirname(transcodedPath(heal.id)), { recursive: true });
  fs.writeFileSync(transcodedPath(heal.id), 'cached-bytes');
  fs.rmSync(transcodedPath(stale.id), { force: true });

  seedDb([stale, heal]);

  await scanDirectories();

  const db = loadDatabase();
  assert.equal(db.metadata[stale.id].transcodeStatus, undefined, 'a ready marker with no cache file behind it must be cleared (stale-heal)');
  assert.equal(db.metadata[heal.id].transcodeStatus, 'ready', 'a cache file with no marker must heal to ready');
});
