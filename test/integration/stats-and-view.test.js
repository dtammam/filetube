'use strict';

// [INTEGRATION] C4 (v1.24 UX Round, Wave 3) -- `GET /api/stats` and
// `POST /api/videos/:id/view`. See docs/exec-plans/active/
// 2026-07-09-v1.24-ux-round.md's Design -> C4 section and lib/stats.js's
// header comment for the live-compute / additive-viewCount rationale.
//
// Isolated DATA_DIR before requiring the app so this suite never reads or
// writes real project data -- own process per file (node --test), mirroring
// test/integration/move-files.test.js's isolation pattern.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-stats-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');

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

test('GET /api/stats: returns live-computed counts/totals for the current library', async () => {
  writeDb({
    metadata: {
      v1: seedItem('v1', { type: 'video', duration: 600, size: 5000 }),
      a1: seedItem('a1', { type: 'audio', duration: 200, size: 1000 }),
    },
  });

  const res = await fetch(`${base}/api/stats`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.count, { total: 2, video: 1, audio: 1 });
  assert.equal(body.totalDurationSeconds, 800);
  assert.equal(body.totalSizeBytes, 6000);
});

test('GET /api/stats: an empty library returns zeroed stats, not a 500', async () => {
  writeDb({ metadata: {} });
  const res = await fetch(`${base}/api/stats`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.count, { total: 0, video: 0, audio: 0 });
  assert.deepEqual(body.mostWatched, []);
});

test('GET /api/stats: reflects a viewCount incremented via POST /api/videos/:id/view (mostWatched)', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });

  await fetch(`${base}/api/videos/v1/view`, { method: 'POST' });
  await fetch(`${base}/api/videos/v1/view`, { method: 'POST' });

  const res = await fetch(`${base}/api/stats`);
  const body = await res.json();
  assert.deepEqual(body.mostWatched, [{ id: 'v1', title: 'v1', folderName: 'Movies', viewCount: 2 }]);
});

test('POST /api/videos/:id/view: increments from an absent viewCount field (the v1.24 additive backfill default)', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } }); // no viewCount key at all
  const res = await fetch(`${base}/api/videos/v1/view`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { success: true, viewCount: 1 });

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(db.metadata.v1.viewCount, 1);
});

test('POST /api/videos/:id/view: increments an existing viewCount by exactly 1 per call', async () => {
  writeDb({ metadata: { v1: seedItem('v1', { viewCount: 4 }) } });
  const res1 = await fetch(`${base}/api/videos/v1/view`, { method: 'POST' });
  assert.equal((await res1.json()).viewCount, 5);
  const res2 = await fetch(`${base}/api/videos/v1/view`, { method: 'POST' });
  assert.equal((await res2.json()).viewCount, 6);
});

test('POST /api/videos/:id/view: 404s for an id not in db.metadata, without creating one', async () => {
  writeDb({ metadata: {} });
  const res = await fetch(`${base}/api/videos/does-not-exist/view`, { method: 'POST' });
  assert.equal(res.status, 404);

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.deepEqual(db.metadata, {});
});
