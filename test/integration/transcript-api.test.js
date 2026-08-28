'use strict';

// [INTEGRATION] Transcript export: GET /api/transcript/:id. Same trust posture
// and sidecar resolution as /api/subtitles/:id (test/integration/
// subtitles-api.test.js, whose harness this mirrors), plus the document
// contract the watch page's Transcript button and Dean's copy/paste rely on.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-transcript-api-'));
delete process.env.FILETUBE_YTDLP_ENABLED; // must work with the downloader module OFF

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

function baseDb(metadata) {
  return { folders: [], folderSettings: {}, progress: {}, metadata, settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } };
}

// A real yt-dlp auto-sub shape: rolling repeats + per-word tags.
const ROLLING_VTT = [
  'WEBVTT', 'Kind: captions', 'Language: en', '',
  '00:00:00.240 --> 00:00:02.149 align:start position:0%', ' ',
  'Ladies<00:00:00.640><c> and</c><00:00:00.880><c> gentlemen</c>', '',
  '00:00:02.149 --> 00:00:02.159 align:start position:0%', 'Ladies and gentlemen', ' ', '',
  '00:00:02.159 --> 00:00:04.710 align:start position:0%', 'Ladies and gentlemen', 'welcome<00:00:02.560><c> back</c>', '',
].join('\n');

function seedItem(id, sidecarName, sidecarText, extra) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-transcript-lib-'));
  const filePath = path.join(root, 'talk.mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const sidecarPath = sidecarName ? path.join(root, sidecarName) : null;
  if (sidecarPath) fs.writeFileSync(sidecarPath, sidecarText);
  saveDatabase(baseDb({
    [id]: { id, title: 'The Talk', type: 'video', ext: '.mp4', filePath, folderName: 'Some Folder', size: 1, addedAt: Date.UTC(2026, 7, 1), ...extra },
  }));
  return { filePath, sidecarPath };
}

test('GET /api/transcript/:id 404s for an unknown id and for an item with no sidecar (same shape as /api/subtitles)', async () => {
  saveDatabase(baseDb({}));
  assert.equal((await fetch(`${base}/api/transcript/nope`)).status, 404);
  seedItem('bare', null, '');
  const res = await fetch(`${base}/api/transcript/bare`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'No subtitle track available for this item' });
});

test('GET /api/transcript/:id serves text/plain with the title / Published / channel header and DE-DUPLICATED rolling captions', async () => {
  seedItem('roll', 'talk.en.vtt', ROLLING_VTT, { releaseDate: Date.UTC(2024, 0, 5), channelName: 'Tim Dylan' });
  const res = await fetch(`${base}/api/transcript/roll`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  // v1.201: prose mode - the two lines abut (no 2s pause), so ONE paragraph.
  assert.equal(await res.text(), 'The Talk\nPublished January 5, 2024\nTim Dylan\n\nLadies and gentlemen welcome back\n');
});

test('GET /api/transcript/:id?timestamps=1 prefixes [m:ss]; other values do not', async () => {
  seedItem('ts', 'talk.en.vtt', ROLLING_VTT, { channelName: 'Tim Dylan' });
  assert.equal(await (await fetch(`${base}/api/transcript/ts?timestamps=1`)).text(), 'The Talk\nAdded August 1, 2026\nTim Dylan\n\n[0:00] Ladies and gentlemen\n[0:02] welcome back\n');
  assert.equal(await (await fetch(`${base}/api/transcript/ts?timestamps=0`)).text(), 'The Talk\nAdded August 1, 2026\nTim Dylan\n\nLadies and gentlemen welcome back\n');
});

test('GET /api/transcript/:id converts a local .srt sidecar and falls back to the folder name as the channel line', async () => {
  const srt = ['1', '00:00:01,000 --> 00:00:02,000', 'Hello <i>there</i>', '', '2', '00:00:05,000 --> 00:00:06,000', 'Bye', ''].join('\n');
  seedItem('srt', 'talk.srt', srt);
  // v1.201 prose mode: the 3s silence between the two cues is a paragraph break.
  assert.equal(await (await fetch(`${base}/api/transcript/srt`)).text(), 'The Talk\nAdded August 1, 2026\nSome Folder\n\nHello there\n\nBye\n');
});

test('GET /api/transcript/:id 404s (not 500) when the sidecar vanishes between scan and request', async () => {
  const { sidecarPath } = seedItem('gone', 'talk.en.vtt', ROLLING_VTT);
  const okRes = await fetch(`${base}/api/transcript/gone`);
  assert.equal(okRes.status, 200);
  fs.unlinkSync(sidecarPath);
  const res = await fetch(`${base}/api/transcript/gone`);
  assert.equal(res.status, 404);
});
