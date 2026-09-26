'use strict';

// [INTEGRATION] v1.337 Share for non-YouTube downloads, through the REAL app and a REAL ffprobe over a
// REAL file (plan docs/exec-plans/active/2026-09-26-share-any-download.md). The file is written in
// the shape a yt-dlp MP4 download actually has: yt-dlp maps `webpage_url` to `purl` AND `comment`
// (yt_dlp/postprocessor/ffmpeg.py), but without `-movflags +use_metadata_tags` (yt-dlp passes none)
// the MP4 muxer keeps only `comment` - so the URL is read from `comment` here. Skips, and says so,
// when no ffmpeg is available (FILETUBE_TEST_FFMPEG points at one on this box).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function findFfmpeg() {
  const explicit = process.env.FILETUBE_TEST_FFMPEG;
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, 'ffmpeg');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (_) { /* next */ }
  }
  return null;
}
const FFMPEG = findFfmpeg();
// the server finds ffmpeg / ffprobe BY NAME at boot, so the binary's directory joins PATH first
if (FFMPEG) process.env.PATH = path.dirname(FFMPEG) + path.delimiter + process.env.PATH;

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-source-share-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, __resetDatabaseForTests } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

const SKIP = FFMPEG ? false : 'no ffmpeg binary (set FILETUBE_TEST_FFMPEG)';
const PAGE_URL = 'https://www.reddit.com/r/videos/comments/abc123/a_clip/';
const LIB = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-source-share-lib-'));
const TAGGED = path.join(LIB, 'A clip [Reddit=abc123].mp4');
const UNTAGGED = path.join(LIB, 'Home video.mp4');
// gate r1 (adversary 1): an Opus audio download is an Ogg file, which keeps its tags per STREAM
const OPUS = path.join(LIB, 'A song [Reddit=opus1].opus');

let server;
let base;

before(async () => {
  if (FFMPEG) {
    const gen = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=160x90:d=1', '-f', 'lavfi', '-i', 'sine=d=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'];
    execFileSync(FFMPEG, [...gen, '-metadata', `purl=${PAGE_URL}`, '-metadata', `comment=${PAGE_URL}`, TAGGED]);
    execFileSync(FFMPEG, [...gen, UNTAGGED]);
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=d=1', '-c:a', 'libopus',
      '-metadata', `purl=${PAGE_URL}`, '-metadata', `comment=${PAGE_URL}`, OPUS]);
  }
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await __resetDatabaseForTests();
});

function item(id, filePath, extra) {
  return {
    id, title: id, type: 'video', ext: '.mp4', folderName: 'Clips', filePath, size: 1000, duration: 1,
    addedAt: 1700000000000, ...extra,
  };
}

// the server's ffmpeg check runs async at boot: poll until the probe can answer (bounded)
async function getItem(id, { until } = {}) {
  const end = Date.now() + 10000;
  for (;;) {
    const res = await fetch(`${base}/api/videos/${id}`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    if (!until || until(body) || Date.now() > end) return body;
    await new Promise((r) => setTimeout(r, 200));
  }
}

test('REACHABILITY: a non-YouTube yt-dlp download gets sourceShareUrl = the page URL in its file tags', { skip: SKIP }, async () => {
  seedState({ folders: [], folderSettings: {}, metadata: {
    r1: item('r1', TAGGED, { sourceExtractor: 'Reddit', sourceId: 'abc123' }),
  } });
  const body = await getItem('r1', { until: (b) => typeof b.sourceShareUrl === 'string' });
  assert.strictEqual(body.sourceShareUrl, PAGE_URL);
  assert.strictEqual(body.watchUrl, undefined, 'never a watchUrl: that one feeds the chapter share and the music skins');
});

test('a download whose file carries no URL gets no sourceShareUrl (and no watchUrl)', { skip: SKIP }, async () => {
  // wait until the probe is live (the tagged control answers), then ask about the untagged file
  seedState({ folders: [], folderSettings: {}, metadata: {
    r1: item('r1', TAGGED, { sourceExtractor: 'Reddit', sourceId: 'abc123' }),
    r2: item('r2', UNTAGGED, { sourceExtractor: 'Facebook', sourceId: '99' }),
  } });
  await getItem('r1', { until: (b) => typeof b.sourceShareUrl === 'string' });
  const body = await getItem('r2');
  assert.ok(!('sourceShareUrl' in body));
  assert.ok(!('watchUrl' in body));
});

test('UNCHANGED: a plain local file (no sourceExtractor) is never probed - same response shape as before', { skip: SKIP }, async () => {
  seedState({ folders: [], folderSettings: {}, metadata: {
    r1: item('r1', TAGGED, { sourceExtractor: 'Reddit', sourceId: 'abc123' }),
    p1: item('p1', TAGGED), // the SAME tagged file, but not a yt-dlp download: no Share
  } });
  await getItem('r1', { until: (b) => typeof b.sourceShareUrl === 'string' });
  const body = await getItem('p1');
  assert.ok(!('sourceShareUrl' in body));
  assert.ok(!('watchUrl' in body));
});

test('UNCHANGED: a YouTube item keeps its watchUrl and gets no sourceShareUrl', { skip: SKIP }, async () => {
  seedState({ folders: [], folderSettings: {}, metadata: {
    r1: item('r1', TAGGED, { sourceExtractor: 'Reddit', sourceId: 'abc123' }),
    y1: item('y1', TAGGED, { youtubeId: 'dQw4w9WgXcQ', sourceExtractor: 'Youtube', sourceId: 'dQw4w9WgXcQ' }),
  } });
  await getItem('r1', { until: (b) => typeof b.sourceShareUrl === 'string' });
  const body = await getItem('y1');
  assert.strictEqual(body.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.ok(!('sourceShareUrl' in body));
});

test('an Opus audio download (tags per stream in Ogg) gets its sourceShareUrl too (gate r1 adversary 1)', { skip: SKIP }, async () => {
  seedState({ folders: [], folderSettings: {}, metadata: {
    o1: { ...item('o1', OPUS, { sourceExtractor: 'Reddit', sourceId: 'opus1' }), type: 'audio', ext: '.opus' },
  } });
  const body = await getItem('o1', { until: (b) => typeof b.sourceShareUrl === 'string' });
  assert.strictEqual(body.sourceShareUrl, PAGE_URL);
});
