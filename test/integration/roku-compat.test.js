'use strict';

// [INTEGRATION] v1.46 Roku compatibility renditions -- GET /video/:id?compat=roku.
// Same stub-binary trick as transcode-execution.test.js (CI has no ffmpeg):
// a fake `ffmpeg` AND a fake `ffprobe` on PATH before server.js is required.
// The ffprobe stub picks its canned JSON by source filename (coverart /
// rotated / probefail / clean), and the ffmpeg stub logs its argv so the
// remux-vs-reencode choice is asserted from what was actually spawned.
// Everything asserted is the server's contract: inline probe with fail-open,
// 503 {error:'transcoding'} while building, Range-capable rendition serving,
// source-signature invalidation, download/audio/needsTranscode bypasses, and
// -- the release's headline constraint -- ORIGINAL FILES ARE NEVER TOUCHED.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ffx-'));
const ffmpegLog = path.join(binDir, 'ffmpeg-argv.log');

fs.writeFileSync(path.join(binDir, 'ffmpeg'), `#!/bin/bash
if [[ "$1" == "-version" ]]; then echo "ffmpeg version 0.0-filetube-test-stub"; exit 0; fi
echo "$*" >> "${ffmpegLog}"
last="\${@: -1}"
head -c 4096 /dev/zero > "$last"
exit 0
`, { mode: 0o755 });

// Canned probe JSON keyed off the input path (ffprobe's last argument).
fs.writeFileSync(path.join(binDir, 'ffprobe'), `#!/bin/bash
if [[ "$1" == "-version" ]]; then echo "ffprobe version 0.0-filetube-test-stub"; exit 0; fi
src="\${@: -1}"
if [[ "$src" == *probefail* ]]; then echo "boom" >&2; exit 1; fi
if [[ "$src" == *coverart* ]]; then
  echo '{"streams":[{"codec_type":"video","codec_name":"h264","disposition":{"attached_pic":0}},{"codec_type":"audio","codec_name":"aac"},{"codec_type":"video","codec_name":"png","disposition":{"attached_pic":1}}]}'
  exit 0
fi
if [[ "$src" == *unflagged* ]]; then
  echo '{"streams":[{"index":0,"codec_type":"video","codec_name":"h264","disposition":{"attached_pic":0}},{"index":1,"codec_type":"audio","codec_name":"aac"},{"index":2,"codec_type":"video","codec_name":"png","disposition":{"attached_pic":0}},{"index":3,"codec_type":"data","codec_name":"bin_data"}]}'
  exit 0
fi
if [[ "$src" == *rotated* ]]; then
  echo '{"streams":[{"codec_type":"video","codec_name":"h264","side_data_list":[{"rotation":-90}],"disposition":{"attached_pic":0}},{"codec_type":"audio","codec_name":"aac"}]}'
  exit 0
fi
echo '{"streams":[{"codec_type":"video","codec_name":"h264","disposition":{"attached_pic":0}},{"codec_type":"audio","codec_name":"aac"}]}'
exit 0
`, { mode: 0o755 });

process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-roku-compat-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, getMediaId } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

const COMPAT_DIR = path.join(process.env.DATA_DIR, 'roku-compat');

let server;
let base;
let mediaDir;

function seedItem(name, extra = {}) {
  const filePath = path.join(mediaDir, name);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, `original-bytes-for-${name}`);
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
    needsTranscode: false,
    videoCodec: 'h264',
    audioCodec: 'aac',
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
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-roku-media-'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(mediaDir, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
});

// Poll ?compat=roku until it stops 503ing (each poll re-kicks the lazy build,
// riding out the startup ffmpeg-detect window like the transcode tests do).
async function pollCompat(id, deadlineMs = 20000) {
  const startedAt = Date.now();
  for (;;) {
    const res = await fetch(`${base}/video/${id}?compat=roku`);
    if (res.status !== 503) return res;
    const body = await res.json();
    assert.equal(body.error, 'transcoding', '503s must speak the transcode retry contract');
    if (Date.now() - startedAt > deadlineMs) return res;
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('clean verdict: ?compat=roku serves the original bytes, builds nothing', async () => {
  const item = seedItem('clean-video.mp4');
  seedDb([item]);
  const res = await pollCompat(item.id);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), `original-bytes-for-clean-video.mp4`);
  assert.equal(fs.existsSync(path.join(COMPAT_DIR, `${item.id}.mp4`)), false, 'no rendition for a clean file');
  const sidecar = JSON.parse(fs.readFileSync(path.join(COMPAT_DIR, `${item.id}.json`), 'utf8'));
  assert.equal(sidecar.verdict, 'clean');
});

test('cover-art verdict: 503 while building, then the REMUXED rendition serves with Range support; the original file is untouched', async () => {
  const item = seedItem('coverart-video.mp4');
  seedDb([item]);
  const beforeStat = fs.statSync(item.filePath);

  const first = await fetch(`${base}/video/${item.id}?compat=roku`);
  assert.equal(first.status, 503, 'first request reports the build in progress');
  await first.arrayBuffer();

  const served = await pollCompat(item.id);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'video/mp4');
  assert.equal((await served.arrayBuffer()).byteLength, 4096, 'rendition (stub output), not the original, is served');

  const argv = fs.readFileSync(ffmpegLog, 'utf8').trim().split('\n').pop();
  assert.match(argv, /-map 0:V:0/, 'maps the first REAL video stream (attached pics excluded)');
  assert.match(argv, /-c copy/, 'strip is a lossless remux');
  assert.doesNotMatch(argv, /libx264/, 'strip never re-encodes');

  const ranged = await fetch(`${base}/video/${item.id}?compat=roku`, { headers: { Range: 'bytes=0-99' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-length'), '100');
  await ranged.arrayBuffer();

  // The zero-mutation contract, asserted on bytes AND mtime.
  const afterStat = fs.statSync(item.filePath);
  assert.equal(fs.readFileSync(item.filePath, 'utf8'), `original-bytes-for-coverart-video.mp4`);
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);

  // Plain playback and downloads still get the original, byte-identical.
  const plain = await fetch(`${base}/video/${item.id}`);
  assert.equal(await plain.text(), `original-bytes-for-coverart-video.mp4`);
  const dl = await fetch(`${base}/video/${item.id}?download=1&compat=roku`);
  assert.equal(await dl.text(), `original-bytes-for-coverart-video.mp4`);
  assert.ok(dl.headers.get('content-disposition'), 'download keeps its attachment header');
});

test('rotate verdict: rendition is a re-encode (libx264), not a remux', async () => {
  const item = seedItem('rotated-video.mov');
  seedDb([item]);
  const served = await pollCompat(item.id);
  assert.equal(served.status, 200);
  assert.equal((await served.arrayBuffer()).byteLength, 4096);
  const argv = fs.readFileSync(ffmpegLog, 'utf8').trim().split('\n').pop();
  assert.match(argv, /libx264/, 'rotation is baked by re-encoding');
  assert.match(argv, /-map 0:V:0/);
});

test('replaced-in-place source: signature mismatch discards the stale rendition and rebuilds', async () => {
  const item = seedItem('coverart-replaced.mp4');
  seedDb([item]);
  const served = await pollCompat(item.id);
  assert.equal(served.status, 200);
  const renditionPath = path.join(COMPAT_DIR, `${item.id}.mp4`);
  assert.equal(fs.existsSync(renditionPath), true);

  // Replace the source in place: same path (same id), different size.
  fs.writeFileSync(item.filePath, 'replacement-bytes-longer-than-before-xxxxxxxx');
  const rebuild = await fetch(`${base}/video/${item.id}?compat=roku`);
  assert.equal(rebuild.status, 503, 'stale rendition must not serve; a rebuild starts');
  await rebuild.arrayBuffer();
  const reserved = await pollCompat(item.id);
  assert.equal(reserved.status, 200);
  assert.equal((await reserved.arrayBuffer()).byteLength, 4096);
});

test('MKV sources are NEVER rendered (gate C1): MP4 bytes under a "mkv" streamFormat would break files that play today', async () => {
  const item = seedItem('coverart-matroska.mkv', { ext: '.mkv' });
  seedDb([item]);
  const res = await fetch(`${base}/video/${item.id}?compat=roku`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'original-bytes-for-coverart-matroska.mkv');
  assert.equal(fs.existsSync(path.join(COMPAT_DIR, `${item.id}.mp4`)), false, 'no rendition');
  assert.equal(fs.existsSync(path.join(COMPAT_DIR, `${item.id}.json`)), false, 'not even probed');
});

test('UNFLAGGED embedded thumbnail (Dean\'s real file class) is stripped, not served raw', async () => {
  const item = seedItem('unflagged-thumb.mp4');
  seedDb([item]);
  const first = await fetch(`${base}/video/${item.id}?compat=roku`);
  assert.equal(first.status, 503, 'a second unflagged video stream must trigger a build, not serve the original');
  await first.arrayBuffer();
  const served = await pollCompat(item.id);
  assert.equal(served.status, 200);
  assert.equal((await served.arrayBuffer()).byteLength, 4096, 'the remuxed rendition, not the original');
  const argv = fs.readFileSync(ffmpegLog, 'utf8').trim().split('\n').pop();
  assert.match(argv, /-map 0:V:0/);
  assert.match(argv, /-c copy/);
});

test('verdict-version bump re-probes a sidecar cached by an older rule set', async () => {
  const item = seedItem('unflagged-stale.mp4');
  seedDb([item]);
  // Simulate a v1.46.0 sidecar: this file's class was mis-verdicted 'clean',
  // no `v` field, signature matching the current source.
  const stat = fs.statSync(item.filePath);
  fs.mkdirSync(COMPAT_DIR, { recursive: true });
  fs.writeFileSync(path.join(COMPAT_DIR, `${item.id}.json`), JSON.stringify({
    source: { size: stat.size, mtimeMs: stat.mtimeMs },
    verdict: 'clean', renditionReady: false, failed: false,
  }));
  // Under v2 rules the stale 'clean' must NOT be trusted -> re-probe -> strip.
  const first = await fetch(`${base}/video/${item.id}?compat=roku`);
  assert.equal(first.status, 503, 'stale pre-version sidecar must be re-probed, not trusted');
  await first.arrayBuffer();
  const served = await pollCompat(item.id);
  assert.equal(served.status, 200);
  const sidecar = JSON.parse(fs.readFileSync(path.join(COMPAT_DIR, `${item.id}.json`), 'utf8'));
  assert.equal(sidecar.v, 2, 'sidecar is rewritten with the current verdict version');
  assert.equal(sidecar.verdict, 'strip');
});

test('probe failure fails OPEN: the original serves with no 503 loop', async () => {
  const item = seedItem('probefail-video.mp4');
  seedDb([item]);
  const res = await fetch(`${base}/video/${item.id}?compat=roku`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), `original-bytes-for-probefail-video.mp4`);
});

test('audio items bypass compat entirely: no probe, no sidecar', async () => {
  const item = seedItem('coverart-song.mp3', { type: 'audio', ext: '.mp3' });
  seedDb([item]);
  const res = await fetch(`${base}/video/${item.id}?compat=roku`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), `original-bytes-for-coverart-song.mp3`);
  assert.equal(fs.existsSync(path.join(COMPAT_DIR, `${item.id}.json`)), false);
});

test('needsTranscode items keep the existing transcode contract; compat never double-handles them', async () => {
  const item = seedItem('legacy-container.avi', { needsTranscode: true, videoCodec: 'mpeg4', audioCodec: 'mp3', ext: '.avi' });
  seedDb([item]);
  const first = await fetch(`${base}/video/${item.id}?compat=roku`);
  assert.equal(first.status, 503);
  assert.equal((await first.json()).error, 'transcoding');
  const served = await pollCompat(item.id);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'video/mp4');
  await served.arrayBuffer();
  assert.equal(fs.existsSync(path.join(COMPAT_DIR, `${item.id}.mp4`)), false, 'served from the transcode cache, not a compat rendition');
});

test('thumbnail responses carry Cache-Control for client caching (v1.46)', async () => {
  const item = seedItem('thumbed-video.mp4', { hasThumbnail: true });
  seedDb([item]);
  const thumbDir = path.join(process.env.DATA_DIR, '.thumbnails');
  fs.mkdirSync(thumbDir, { recursive: true });
  fs.writeFileSync(path.join(thumbDir, `${item.id}.jpg`), 'jpg-bytes');
  const res = await fetch(`${base}/thumbnail/${item.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, max-age=86400');
  await res.arrayBuffer();
});
