'use strict';

// Isolated DATA_DIR before requiring the app so the suite never reads or writes
// real project data. Own process per file (node --test) keeps this local.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
const DB_FILE = path.join(process.env.DATA_DIR, 'db.json');

const { test, before, after } = require('node:test');
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
  // fetch (undici) pools keep-alive sockets; force them shut so close() resolves
  // promptly instead of waiting on idle connections (avoids CI hangs).
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('GET / serves the static app shell', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<html/i);
});

test('GET /assets/icons/*.svg serves the bundled icons', async () => {
  const res = await fetch(`${base}/assets/icons/home.svg`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<svg/i);
});

test('GET /api/config returns folders and folderSettings', async () => {
  const res = await fetch(`${base}/api/config`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(Array.isArray(json.folders));
  assert.equal(typeof json.folderSettings, 'object');
});

test('GET /api/scan-status reports scan/library counts', async () => {
  const res = await fetch(`${base}/api/scan-status`);
  assert.equal(res.status, 200);
  const json = await res.json();
  for (const key of ['scanning', 'fileCount', 'folderCount', 'transcoding']) {
    assert.ok(key in json, `missing key: ${key}`);
  }
});

test('GET /api/videos returns an array', async () => {
  const res = await fetch(`${base}/api/videos`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(await res.json()));
});

test('GET /api/videos preserves the fields the author resolver needs', async () => {
  // The list cards resolve the "author" from rootFolder (+ folderSettings),
  // artist, then folderName (see common.js resolveChannelName). Lock the API
  // contract so those fields keep flowing to the client.
  fs.writeFileSync(DB_FILE, JSON.stringify({
    folders: ['/media/Movies'],
    folderSettings: { '/media/Movies': { name: 'My Movies', hidden: false } },
    progress: {},
    metadata: {
      m1: {
        id: 'm1', title: 'Clip A', type: 'video', ext: '.mp4',
        folderName: 'Movies', rootFolder: '/media/Movies', artist: '',
        size: 1000, addedAt: 1700000000000,
      },
    },
  }));

  const res = await fetch(`${base}/api/videos`);
  assert.equal(res.status, 200);
  const list = await res.json();
  const item = list.find((i) => i.id === 'm1');
  assert.ok(item, 'seeded item is returned');
  assert.equal(item.rootFolder, '/media/Movies');
  assert.equal(item.folderName, 'Movies');
  assert.equal(item.artist, '');
});

test('GET /api/videos/:id returns 404 for an unknown id', async () => {
  const res = await fetch(`${base}/api/videos/does-not-exist`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'Media file not found');
});

test('GET /video/:id returns 404 for an unknown id', async () => {
  const res = await fetch(`${base}/video/does-not-exist`);
  assert.equal(res.status, 404);
});

test('POST /api/config rejects a non-array folders payload', async () => {
  const res = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folders: 'not-an-array' }),
  });
  assert.equal(res.status, 400);
});

// ---- A: async write routes return 500 JSON (not a hang) when the ----------
// ---- underlying updateDatabase/saveDatabase rejects ------------------------

test('POST /api/config returns 500 JSON (not a hang) when persisting the configuration fails', async () => {
  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('simulated disk failure'); };
  try {
    const res = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folders: [] }),
    });
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.equal(typeof json.error, 'string');
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }
});

test('POST /api/progress validates required fields', async () => {
  const res = await fetch(`${base}/api/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'x' }), // missing numeric timestamp
  });
  assert.equal(res.status, 400);
});

test('POST /api/progress returns 404 for unknown media', async () => {
  const res = await fetch(`${base}/api/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'ghost', timestamp: 10 }),
  });
  assert.equal(res.status, 404);
});

test('POST /api/progress returns 500 JSON (not a hang) when persisting the write fails', async () => {
  fs.writeFileSync(DB_FILE, JSON.stringify({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidFail: { id: 'vidFail', title: 'Clip', duration: 10 } },
  }));

  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('simulated disk failure'); };
  try {
    const res = await fetch(`${base}/api/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'vidFail', timestamp: 5 }),
    });
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.equal(typeof json.error, 'string');
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }
});

test('DELETE /api/videos/:id returns 500 JSON (not a hang) when the db-metadata cleanup fails to persist', async () => {
  // filePath deliberately points at a nonexistent file so the FS-unlink step
  // (already try/catch-guarded, unrelated to this fix) is a no-op and the
  // route proceeds to the db.metadata/progress cleanup this test targets.
  fs.writeFileSync(DB_FILE, JSON.stringify({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidDelFail: { id: 'vidDelFail', title: 'Clip', filePath: '/nonexistent/clip.mp4' } },
  }));

  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('simulated disk failure'); };
  try {
    const res = await fetch(`${base}/api/videos/vidDelFail`, { method: 'DELETE' });
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.equal(typeof json.error, 'string');
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }
});

test('watch progress round-trips through save and read', async () => {
  // Seed one known media item directly into the isolated db.
  fs.writeFileSync(DB_FILE, JSON.stringify({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: { vid1: { id: 'vid1', title: 'Clip', duration: 120 } },
  }));

  const save = await fetch(`${base}/api/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'vid1', timestamp: 55, duration: 120 }),
  });
  assert.equal(save.status, 200);
  assert.equal((await save.json()).success, true);

  const read = await fetch(`${base}/api/progress/vid1`);
  assert.equal(read.status, 200);
  const json = await read.json();
  assert.equal(json.timestamp, 55);
  assert.equal(json.duration, 120);
});
