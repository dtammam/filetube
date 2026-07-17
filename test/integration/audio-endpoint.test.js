'use strict';

// [INTEGRATION] v1.27.0 "Background audio for video" (EXPERIMENTAL, default
// OFF): GET /audio/:id, POST /api/videos/:id/prepare-audio, the additive
// audioStatus/audioProgress fields on GET /api/videos/:id, and a
// regression-lock proving GET /video/:id is byte-identical (including Range
// support) after being refactored to share `sendRangeable` with the new
// /audio/:id route. No FFmpeg needed: this suite deliberately never watches
// a real extraction complete -- CI has no ffmpeg installed, so
// `ffmpegAvailable` is false for the whole process, which is itself an
// asserted behavior (never silently 404s, never enqueues a doomed job) --
// see docs/RELIABILITY.md's "keep FFmpeg out of the core suite" standard.
// Isolated DATA_DIR before requiring the app, own process per file (node
// --test), mirrors test/integration/download-media.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-audio-endpoint-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, audioPath, TRANSCODE_DIR, saveDatabase, __resetDatabaseForTests } = require('../../server');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

let server;
let base;
let originalDir;

before(async () => {
  originalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-audio-src-'));
  fs.mkdirSync(TRANSCODE_DIR, { recursive: true });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(originalDir, { recursive: true, force: true });
});

// v1.30 A3 (in-memory DB read cache): seed via the exported `saveDatabase()`
// (an established test primitive, see CONTRIBUTING.md) rather than a raw
// `fs.writeFileSync`, so the in-process db cache stays coherent.
function writeDb(db) {
  saveDatabase(db);
}

// v1.42: persisted-state reads go through the sanctioned second-connection
// helper (SQLite replaced db.json).
function readDb() {
  return readPersistedDatabase(process.env.DATA_DIR);
}

beforeEach(async () => {
  // v1.42: SQLite replaced db.json; the sanctioned between-test reset.
  await __resetDatabaseForTests();
  for (const name of fs.readdirSync(TRANSCODE_DIR)) fs.rmSync(path.join(TRANSCODE_DIR, name), { force: true });
});

function videoItem(id, overrides) {
  return {
    id, type: 'video', filePath: path.join(originalDir, `${id}.mp4`), size: 100,
    title: 'Test Video', name: `${id}.mp4`, ext: '.mp4', addedAt: Date.now(),
    ...overrides,
  };
}

// ---- GET /audio/:id --------------------------------------------------

test('GET /audio/:id -- unknown id returns the same 404 shape as GET /video/:id', async () => {
  const res = await fetch(`${base}/audio/does-not-exist`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'Media file not found');
});

test('GET /audio/:id -- an audio-type item 404s (nothing to hand off to -- it is already audio)', async () => {
  const id = 'aud-item';
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, type: 'audio', filePath: path.join(originalDir, 'song.mp3'), size: 10, title: 'Song', name: 'song.mp3', ext: '.mp3', addedAt: Date.now() } },
  });
  const res = await fetch(`${base}/audio/${id}`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'Media file not found');
});

test('GET /audio/:id -- a video item with NO sidecar and ffmpeg unavailable returns 503 without enqueuing', async () => {
  const id = 'vid-no-ffmpeg';
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: videoItem(id) } });

  const res = await fetch(`${base}/audio/${id}`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'ffmpeg unavailable');

  // Never enqueues a doomed job -- audioStatus stays untouched (no
  // 'pending'/'processing' ever gets persisted when ffmpeg isn't there to
  // service the queue).
  const db = readDb();
  assert.equal(db.metadata[id].audioStatus, undefined, 'ffmpeg-unavailable must never enqueue (no audioStatus written)');
});

test('GET /audio/:id -- an already-extracted sidecar is served with Range support, content-type audio/mp4', async () => {
  const id = 'vid-ready-audio';
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: videoItem(id) } });
  const bytes = 'FAKE-M4A-AUDIO-BYTES-0123456789';
  fs.writeFileSync(audioPath(id), bytes);

  const full = await fetch(`${base}/audio/${id}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'audio/mp4');
  assert.equal(await full.text(), bytes);

  const ranged = await fetch(`${base}/audio/${id}`, { headers: { Range: 'bytes=5-9' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), `bytes 5-9/${bytes.length}`);
  assert.equal(await ranged.text(), bytes.slice(5, 10));
});

test('GET /audio/:id -- serving a ready sidecar marks it recently-served (live-watch protection, same as /video/:id)', async () => {
  const id = 'vid-served-audio';
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: videoItem(id) } });
  fs.writeFileSync(audioPath(id), 'bytes');

  await fetch(`${base}/audio/${id}`);
  // recordServed persists lastServedAt (throttled/no-clobber) -- observe it
  // landed on THIS id's metadata, the same mechanism /video/:id's cached
  // transcode branch already uses.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const db = readDb();
  assert.equal(typeof db.metadata[id].lastServedAt, 'number', 'expected lastServedAt to be recorded for the served sidecar');
});

// F1 (two-reviewer gate): a stale `audioStatus: 'ready'` whose sidecar has
// since been deleted (evicted/aged out/manually removed) must be HEALED the
// moment this route proves it's stale -- never trusted forward. Response is
// still 503 (ffmpeg is unavailable in CI -- see this file's own header
// comment) but the PERSISTED status must no longer claim 'ready'.
test("GET /audio/:id -- a stale audioStatus: 'ready' with the sidecar missing on disk is healed (never left claiming 'ready')", async () => {
  const id = 'vid-stale-ready-audio';
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: videoItem(id, { audioStatus: 'ready' }) } });
  // No file written at audioPath(id) -- the sidecar is confirmed missing.

  const res = await fetch(`${base}/audio/${id}`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'ffmpeg unavailable');

  await new Promise((resolve) => setTimeout(resolve, 50));
  const db = readDb();
  assert.notEqual(db.metadata[id].audioStatus, 'ready', 'a stale ready must be healed, not left in place');
});

test('GET /audio/:id -- audioStatus values OTHER than "ready" are left completely untouched (no unnecessary write)', async () => {
  const id = 'vid-processing-audio';
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: videoItem(id, { audioStatus: 'processing' }) } });

  await fetch(`${base}/audio/${id}`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const db = readDb();
  assert.equal(db.metadata[id].audioStatus, 'processing', 'only a stale "ready" is ever healed');
});

// ---- POST /api/videos/:id/prepare-audio -------------------------------

test('POST prepare-audio -- unknown id returns 404', async () => {
  const res = await fetch(`${base}/api/videos/does-not-exist/prepare-audio`, { method: 'POST' });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'Media file not found');
});

test('POST prepare-audio -- an audio-type item is rejected with 400 (video-only feature)', async () => {
  const id = 'aud-prepare';
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, type: 'audio', filePath: path.join(originalDir, 'song.mp3'), size: 10, title: 'Song', name: 'song.mp3', ext: '.mp3', addedAt: Date.now() } },
  });
  const res = await fetch(`${base}/api/videos/${id}/prepare-audio`, { method: 'POST' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /video items/);
});

test('POST prepare-audio -- an already-ready sidecar reports ready WITHOUT re-enqueuing', async () => {
  const id = 'vid-prepare-ready';
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: videoItem(id) } });
  fs.writeFileSync(audioPath(id), 'bytes');

  const res = await fetch(`${base}/api/videos/${id}/prepare-audio`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { audioStatus: 'ready' });
});

// F1 (two-reviewer gate): mirrors the GET /audio/:id healing test above --
// prepare-audio is the client's own pre-warm/self-heal round trip (see
// player.js setupForMedia's comment), so it must never hand back a
// response that still claims 'ready' once it has proven the sidecar is
// gone, and the persisted status must be healed too.
test("POST prepare-audio -- a stale audioStatus: 'ready' with the sidecar missing is healed (response no longer claims ready)", async () => {
  const id = 'vid-prepare-stale-ready';
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: videoItem(id, { audioStatus: 'ready' }) } });
  // No file written at audioPath(id) -- the sidecar is confirmed missing.

  const res = await fetch(`${base}/api/videos/${id}/prepare-audio`, { method: 'POST' });
  assert.equal(res.status, 503, 'ffmpeg is unavailable in CI (see this file\'s header comment)');
  const body = await res.json();
  assert.equal(body.error, 'ffmpeg unavailable');

  await new Promise((resolve) => setTimeout(resolve, 50));
  const db = readDb();
  assert.notEqual(db.metadata[id].audioStatus, 'ready', 'a stale ready must be healed by prepare-audio too, not left in place');
});

test('POST prepare-audio -- no sidecar + ffmpeg unavailable returns 503 and never enqueues', async () => {
  const id = 'vid-prepare-no-ffmpeg';
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: videoItem(id) } });

  const res = await fetch(`${base}/api/videos/${id}/prepare-audio`, { method: 'POST' });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'ffmpeg unavailable');
  assert.equal(readDb().metadata[id].audioStatus, undefined);
});

// ---- GET /api/videos/:id exposes audioStatus + audioProgress -----------

test('GET /api/videos/:id -- audioStatus is absent (never fabricated) for an item that has never had one, audioProgress defaults to 0', async () => {
  const id = 'vid-no-audio-status';
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: videoItem(id) } });
  const res = await fetch(`${base}/api/videos/${id}`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.audioStatus, undefined);
  assert.equal(json.audioProgress, 0);
});

test('GET /api/videos/:id -- surfaces a persisted audioStatus (mirrors transcodeStatus\'s own spread-through)', async () => {
  const id = 'vid-with-audio-status';
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: videoItem(id, { audioStatus: 'ready' }) } });
  const res = await fetch(`${base}/api/videos/${id}`);
  const json = await res.json();
  assert.equal(json.audioStatus, 'ready');
});

// ---- Regression-lock: GET /video/:id is byte-identical after the -------
// ---- sendRangeable refactor (shared with GET /audio/:id) ---------------

test('regression-lock: GET /video/:id still supports partial Range requests exactly as before the sendRangeable refactor', async () => {
  const id = 'vid-range-regression';
  const p = path.join(originalDir, 'range.mp4');
  const bytes = 'ORIGINAL-VIDEO-BYTES-FOR-RANGE-TEST';
  fs.writeFileSync(p, bytes);
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, type: 'video', needsTranscode: false, filePath: p, size: bytes.length, title: 'Range', name: 'range.mp4', ext: '.mp4', addedAt: Date.now() } },
  });

  const full = await fetch(`${base}/video/${id}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-length'), String(bytes.length));
  assert.equal(await full.text(), bytes);

  const ranged = await fetch(`${base}/video/${id}`, { headers: { Range: 'bytes=0-4' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('accept-ranges'), 'bytes');
  assert.equal(ranged.headers.get('content-range'), `bytes 0-4/${bytes.length}`);
  assert.equal(await ranged.text(), bytes.slice(0, 5));
});

test('regression-lock: GET /video/:id -- an out-of-range start still returns 416, unchanged', async () => {
  const id = 'vid-416-regression';
  const p = path.join(originalDir, 'small.mp4');
  fs.writeFileSync(p, 'tiny');
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, type: 'video', needsTranscode: false, filePath: p, size: 4, title: 'Small', name: 'small.mp4', ext: '.mp4', addedAt: Date.now() } },
  });

  const res = await fetch(`${base}/video/${id}`, { headers: { Range: 'bytes=999-1000' } });
  assert.equal(res.status, 416);
  // F4 (two-reviewer gate): now also carries a spec-compliant (RFC 7233
  // sec 4.4) Content-Range header on every 416, unifying this pre-existing
  // out-of-bounds case with the newly-added malformed-range cases below.
  assert.equal(res.headers.get('content-range'), 'bytes */4');
});

test('regression-lock: GET /video/:id -- unknown id still 404s with the exact same message', async () => {
  const res = await fetch(`${base}/video/does-not-exist`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'Media file not found');
});

test('regression-lock: GET /video/:id -- a file missing on disk still 404s with the exact same message, no Content-Disposition leak', async () => {
  const id = 'vid-missing-on-disk-regression';
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, type: 'video', needsTranscode: false, filePath: path.join(originalDir, 'gone.mp4'), size: 0, title: 'Gone', name: 'gone.mp4', ext: '.mp4', addedAt: Date.now() } },
  });
  const res = await fetch(`${base}/video/${id}?download=1`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'File does not exist on disk');
  assert.equal(res.headers.get('content-disposition'), null, 'a 404 for a missing file must never carry a Content-Disposition header');
});

// ---- F4 (two-reviewer gate): malformed Range headers -> 416, never 500 ---
//
// Before this fix, a malformed/reversed Range header fell through to
// `fs.createReadStream(filePath, { start, end })` with a NaN or nonsensical
// range, which threw synchronously -- an unhandled exception Express's
// default error handler turns into a 500 whose body includes a stack trace
// (leaking this server's absolute filesystem paths) to an UNAUTHENTICATED
// caller. Pre-existing on /video/:id; newly reachable on the new /audio/:id
// too, since both share `sendRangeable`. Exercised on BOTH routes.

const MALFORMED_RANGES = [
  ['bytes=10-3', 'end < start (reversed)'],
  ['bytes=potato', 'non-numeric -> NaN'],
  ['bytes=-5', 'a suffix-range shape this parser does not support -> NaN start'],
];

for (const [rangeHeader, why] of MALFORMED_RANGES) {
  test(`F4: GET /video/:id -- a malformed Range header (${rangeHeader}, ${why}) returns 416, never 500`, async () => {
    const id = `vid-malformed-range-${rangeHeader.replace(/[^a-z0-9]/gi, '')}`;
    const p = path.join(originalDir, `${id}.mp4`);
    fs.writeFileSync(p, 'malformed-range-fixture-bytes');
    writeDb({
      folders: [], folderSettings: {}, progress: {},
      metadata: { [id]: { id, type: 'video', needsTranscode: false, filePath: p, size: 29, title: 'x', name: `${id}.mp4`, ext: '.mp4', addedAt: Date.now() } },
    });

    const res = await fetch(`${base}/video/${id}`, { headers: { Range: rangeHeader } });
    assert.equal(res.status, 416, `expected 416, not a 500 stack-trace leak, for Range: ${rangeHeader}`);
    assert.match(res.headers.get('content-range') || '', /^bytes \*\/\d+$/);
    // A 500 would carry a stack trace (and this server's absolute
    // filesystem paths) in the body -- assert none of that leaked either.
    const text = await res.text();
    assert.ok(!/at .*\(.*:\d+:\d+\)/.test(text), 'must never leak a stack trace');
  });

  test(`F4: GET /audio/:id -- a malformed Range header (${rangeHeader}, ${why}) returns 416, never 500`, async () => {
    const id = `aud-malformed-range-${rangeHeader.replace(/[^a-z0-9]/gi, '')}`;
    writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: videoItem(id) } });
    fs.writeFileSync(audioPath(id), 'malformed-range-fixture-bytes');

    const res = await fetch(`${base}/audio/${id}`, { headers: { Range: rangeHeader } });
    assert.equal(res.status, 416, `expected 416, not a 500 stack-trace leak, for Range: ${rangeHeader}`);
    assert.match(res.headers.get('content-range') || '', /^bytes \*\/\d+$/);
    const text = await res.text();
    assert.ok(!/at .*\(.*:\d+:\d+\)/.test(text), 'must never leak a stack trace');
  });
}

test('F4: GET /video/:id -- a VALID Range request is completely unaffected by the malformed-range validation', async () => {
  const id = 'vid-valid-range-unaffected';
  const p = path.join(originalDir, 'valid-range.mp4');
  const bytes = 'VALID-RANGE-FIXTURE-BYTES-0123456789';
  fs.writeFileSync(p, bytes);
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, type: 'video', needsTranscode: false, filePath: p, size: bytes.length, title: 'x', name: 'valid-range.mp4', ext: '.mp4', addedAt: Date.now() } },
  });

  const res = await fetch(`${base}/video/${id}`, { headers: { Range: 'bytes=2-6' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 2-6/${bytes.length}`);
  assert.equal(await res.text(), bytes.slice(2, 7));
});
