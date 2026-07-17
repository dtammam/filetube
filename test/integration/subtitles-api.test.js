'use strict';

// [INTEGRATION] A6 (v1.24 UX Round, T16, Wave 5): GET /api/subtitles/:id.
//
// Deliberately lives in server.js, not the yt-dlp module, so this route
// works for LOCAL files with the yt-dlp module completely disabled --
// FILETUBE_YTDLP_ENABLED is left unset for this entire suite (see the
// module-level env below), proving the disabled-module no-op guarantee
// never blocks this route (it never touches lib/ytdlp at all).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subtitles-api-'));
delete process.env.FILETUBE_YTDLP_ENABLED; // explicit: this route must work with the module OFF

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

// v1.30 A3 (in-memory DB read cache): seed via the exported `saveDatabase()`
// (an established test primitive, see CONTRIBUTING.md) rather than a raw
// `fs.writeFileSync`, so the in-process db cache stays coherent.
function writeDb(db) {
  saveDatabase(db);
}

function baseDb(metadata) {
  return { folders: [], folderSettings: {}, progress: {}, metadata, settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } };
}

test('GET /api/subtitles/:id 404s for an unknown id', async () => {
  writeDb(baseDb({}));
  const res = await fetch(`${base}/api/subtitles/does-not-exist`);
  assert.equal(res.status, 404);
});

test('GET /api/subtitles/:id 404s when the item has no sidecar at all', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-none-'));
  const filePath = path.join(root, 'no-captions.mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  writeDb(baseDb({
    id1: { id: 'id1', title: 'No Captions', type: 'video', ext: '.mp4', filePath, folderName: path.basename(root), size: 1, addedAt: 1 },
  }));

  const res = await fetch(`${base}/api/subtitles/id1`);
  assert.equal(res.status, 404);
});

test('GET /api/subtitles/:id serves a .vtt sidecar with cues normalized to bottom-center (v1.41.1)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-vtt-'));
  const filePath = path.join(root, 'captioned.mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  // v1.41.1 (Dean): captions render bottom-center, not the browser's default
  // placement. The route normalizes every cue's settings to
  // `position:50% align:center` -- for .vtt sidecars (yt-dlp's shape) too, not
  // just SRT-derived -- so the passthrough is no longer byte-for-byte.
  const vttBody = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000 align:start position:10%\nHello from a real .vtt file\n';
  fs.writeFileSync(path.join(root, 'captioned.vtt'), vttBody);
  writeDb(baseDb({
    id2: { id: 'id2', title: 'Captioned', type: 'video', ext: '.mp4', filePath, folderName: path.basename(root), size: 1, addedAt: 1 },
  }));

  const res = await fetch(`${base}/api/subtitles/id2`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/vtt/);
  const body = await res.text();
  assert.match(body, /00:00:01\.000 --> 00:00:02\.000 position:50% align:center/, 'cue forced to bottom-center');
  assert.ok(!/align:start/.test(body) && !/position:10%/.test(body), 'author positioning overridden');
  assert.ok(body.includes('Hello from a real .vtt file'), 'payload preserved');
});

test('GET /api/subtitles/:id converts a local .srt sidecar to VTT on the fly', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-srt-'));
  const filePath = path.join(root, 'legacy.mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const srtBody = '1\n00:00:01,000 --> 00:00:04,000\nHello world\n\n2\n00:00:05,500 --> 00:00:07,000\nSecond line\n';
  fs.writeFileSync(path.join(root, 'legacy.srt'), srtBody);
  writeDb(baseDb({
    id3: { id: 'id3', title: 'Legacy SRT', type: 'video', ext: '.mp4', filePath, folderName: path.basename(root), size: 1, addedAt: 1 },
  }));

  const res = await fetch(`${base}/api/subtitles/id3`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/vtt/);
  const body = await res.text();
  assert.match(body, /^WEBVTT/, 'converted body must start with the WEBVTT signature');
  assert.match(body, /00:00:01\.000 --> 00:00:04\.000/, 'comma timestamps become periods');
  assert.doesNotMatch(body, /^1$/m, 'the SRT cue-number line must be stripped');
  assert.match(body, /Hello world/);
  assert.match(body, /Second line/);
});

test('GET /api/subtitles/:id prefers a <base>.<lang>.vtt sidecar (the shape yt-dlp downloads land in) over a bare <base>.srt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-lang-'));
  const filePath = path.join(root, 'Some Video [abc123].mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  fs.writeFileSync(path.join(root, 'Some Video [abc123].en.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nfrom the lang-tagged vtt\n');
  fs.writeFileSync(path.join(root, 'Some Video [abc123].srt'), '1\n00:00:00,000 --> 00:00:01,000\nfrom the srt (should be ignored)\n');
  writeDb(baseDb({
    id4: { id: 'id4', title: 'Some Video', type: 'video', ext: '.mp4', filePath, folderName: path.basename(root), size: 1, addedAt: 1 },
  }));

  const res = await fetch(`${base}/api/subtitles/id4`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /from the lang-tagged vtt/);
  assert.doesNotMatch(body, /should be ignored/);
});

// FIX-7 (two-reviewer gate, cheap hardening): X-Content-Type-Options: nosniff
// alongside the explicit text/vtt Content-Type, defense-in-depth against a
// browser reinterpreting this response's bytes as something else.
test('GET /api/subtitles/:id sets X-Content-Type-Options: nosniff', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-nosniff-'));
  const filePath = path.join(root, 'captioned.mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  fs.writeFileSync(path.join(root, 'captioned.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n');
  writeDb(baseDb({
    id5: { id: 'id5', title: 'Captioned', type: 'video', ext: '.mp4', filePath, folderName: path.basename(root), size: 1, addedAt: 1 },
  }));

  const res = await fetch(`${base}/api/subtitles/id5`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

// ---- v1.34 T2 (Dean, desktop CC sync): the ?offset= shifted document --------
test('GET /api/subtitles/:id?offset=N serves the cue-shifted document; garbage/absurd offsets serve it unshifted', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-subs-offset-'));
  const filePath = path.join(root, 'offset-video.mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  fs.writeFileSync(path.join(root, 'offset-video.vtt'), 'WEBVTT\n\n00:00:10.000 --> 00:00:20.000\nHello\n');
  writeDb(baseDb({
    idOff: { id: 'idOff', title: 'Offset Video', type: 'video', ext: '.mp4', filePath, folderName: path.basename(root), size: 1, addedAt: 1 },
  }));

  const shifted = await (await fetch(`${base}/api/subtitles/idOff?offset=8`)).text();
  assert.ok(shifted.includes('00:00:02.000 --> 00:00:12.000'), 'cue shifted 8s earlier for the live-transcode timeline');

  const past = await (await fetch(`${base}/api/subtitles/idOff?offset=25`)).text();
  assert.ok(!past.includes('Hello'), 'a cue fully before the seek point is dropped');

  for (const bad of ['garbage', '-5', '999999999']) {
    const res = await fetch(`${base}/api/subtitles/idOff?offset=${bad}`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('00:00:10.000 --> 00:00:20.000'), `offset=${bad} must degrade to the unshifted document`);
  }
});
