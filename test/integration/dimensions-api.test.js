'use strict';

// [INTEGRATION] Feature A (v1.26.1, Shorts player-size jump) --
// `POST /api/videos/:id/dimensions`, the lazy per-item backfill endpoint the
// player calls once it has observed an item's real `videoWidth`/
// `videoHeight` (see player.js's `loadedmetadata` fallback listener). Mirrors
// test/integration/stats-and-view.test.js's isolation/seed pattern for the
// adjacent `POST /api/videos/:id/view` endpoint.
//
// Isolated DATA_DIR before requiring the app so this suite never reads or
// writes real project data -- own process per file (node --test).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dims-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, MAX_MEDIA_DIMENSION } = require('../../server');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
});

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ folders: [], folderSettings: {}, progress: {}, ...db }, null, 2), 'utf8');
}

function seedItem(id, overrides) {
  return {
    id, title: id, type: 'video', ext: '.mp4', folderName: 'Movies',
    filePath: `/media/Movies/${id}.mp4`, artist: '', size: 1000, duration: 100,
    addedAt: 1700000000000,
    ...overrides,
  };
}

function postDims(id, body) {
  return fetch(`${base}/api/videos/${encodeURIComponent(id)}/dimensions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST /api/videos/:id/dimensions: fills width/height for a video item that has none yet', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } }); // no width/height key at all
  const res = await postDims('v1', { width: 1080, height: 1920 });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { success: true, applied: true });

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(db.metadata.v1.width, 1080);
  assert.equal(db.metadata.v1.height, 1920);
});

test('POST /api/videos/:id/dimensions: no-clobber -- an item that already carries width/height is left untouched', async () => {
  writeDb({ metadata: { v1: seedItem('v1', { width: 1920, height: 1080 }) } });
  const res = await postDims('v1', { width: 100, height: 100 });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { success: true, applied: false });

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(db.metadata.v1.width, 1920, 'must not be overwritten by a later POST');
  assert.equal(db.metadata.v1.height, 1080);
});

test('POST /api/videos/:id/dimensions: 404s for an id not in db.metadata, without creating one', async () => {
  writeDb({ metadata: {} });
  const res = await postDims('does-not-exist', { width: 1920, height: 1080 });
  assert.equal(res.status, 404);

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.deepEqual(db.metadata, {});
});

test('POST /api/videos/:id/dimensions: 400s for an AUDIO item -- dimensions never apply to audio', async () => {
  writeDb({ metadata: { a1: seedItem('a1', { type: 'audio' }) } });
  const res = await postDims('a1', { width: 1920, height: 1080 });
  assert.equal(res.status, 400);

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal('width' in db.metadata.a1, false);
});

test('POST /api/videos/:id/dimensions: 400s for non-integer width/height', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  const res = await postDims('v1', { width: 1920.5, height: 1080 });
  assert.equal(res.status, 400);
});

test('POST /api/videos/:id/dimensions: 400s for zero/negative width or height', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  assert.equal((await postDims('v1', { width: 0, height: 1080 })).status, 400);
  assert.equal((await postDims('v1', { width: 1920, height: -5 })).status, 400);
});

test('POST /api/videos/:id/dimensions: 400s for an oversized width/height (> MAX_MEDIA_DIMENSION)', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  const res = await postDims('v1', { width: MAX_MEDIA_DIMENSION + 1, height: 1080 });
  assert.equal(res.status, 400);
});

test('POST /api/videos/:id/dimensions: 400s when width or height is missing entirely', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  assert.equal((await postDims('v1', { width: 1920 })).status, 400);
  assert.equal((await postDims('v1', {})).status, 400);
});

test('POST /api/videos/:id/dimensions: accepts a width/height exactly at MAX_MEDIA_DIMENSION', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  const res = await postDims('v1', { width: MAX_MEDIA_DIMENSION, height: MAX_MEDIA_DIMENSION });
  assert.equal(res.status, 200);
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(db.metadata.v1.width, MAX_MEDIA_DIMENSION);
});

// ---------------------------------------------------------------------------
// F3 (v1.26.1 two-reviewer follow-up, NIT): reject non-primitive coercible
// body shapes BEFORE Number() ever runs -- [1920]/true/'0x10' would otherwise
// sail through Number() (Number([1920]) === 1920, Number(true) === 1,
// Number('0x10') === 16) as a plausible-looking positive integer.
// ---------------------------------------------------------------------------

test('POST /api/videos/:id/dimensions: 400s for a single-element array width (Number([1920]) === 1920)', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  const res = await postDims('v1', { width: [1920], height: 1080 });
  assert.equal(res.status, 400);
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal('width' in db.metadata.v1, false);
});

test('POST /api/videos/:id/dimensions: 400s for a boolean width (Number(true) === 1)', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  const res = await postDims('v1', { width: true, height: 1080 });
  assert.equal(res.status, 400);
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal('width' in db.metadata.v1, false);
});

test('POST /api/videos/:id/dimensions: 400s for a hex-string width (Number(\'0x10\') === 16)', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  const res = await postDims('v1', { width: '0x10', height: 1080 });
  assert.equal(res.status, 400);
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal('width' in db.metadata.v1, false);
});

test('POST /api/videos/:id/dimensions: still accepts a plain digit-only numeric string (defensive, non-standard client)', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  const res = await postDims('v1', { width: '1920', height: '1080' });
  assert.equal(res.status, 200);
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(db.metadata.v1.width, 1920);
  assert.equal(db.metadata.v1.height, 1080);
});

test('GET /api/videos/:id: reflects a dimensions backfill applied via POST /api/videos/:id/dimensions', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  await postDims('v1', { width: 720, height: 1280 });

  const res = await fetch(`${base}/api/videos/v1`);
  const body = await res.json();
  assert.equal(body.width, 720);
  assert.equal(body.height, 1280);
});
