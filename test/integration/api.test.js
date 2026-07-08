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
const { app, transcodedPath } = require('../../server');
const THUMBNAIL_DIR = path.join(process.env.DATA_DIR, '.thumbnails');

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

// ---- Item 5 (v1.13 polish): graceful DELETE on read-only/permission-denied ----
// ---- mounts -- see docs/exec-plans/active/2026-07-06-v1.13-polish.md item 5 --

function seedDeleteTarget(id, filePath) {
  fs.writeFileSync(filePath, 'video-bytes');
  fs.writeFileSync(DB_FILE, JSON.stringify({
    folders: [], folderSettings: {},
    progress: { [id]: { timestamp: 5, duration: 10 } },
    metadata: { [id]: { id, title: 'Clip', filePath } },
  }));
}

test('DELETE /api/videos/:id returns a clear 409 (not a generic 500) on an EROFS unlink failure, and leaves the db untouched', async () => {
  const filePath = path.join(os.tmpdir(), `filetube-delete-erofs-${Date.now()}.mp4`);
  seedDeleteTarget('vidErofs', filePath);

  const realUnlinkSync = fs.unlinkSync;
  fs.unlinkSync = () => { const e = new Error('read-only file system'); e.code = 'EROFS'; throw e; };
  try {
    const res = await fetch(`${base}/api/videos/vidErofs`, { method: 'DELETE' });
    assert.equal(res.status, 409);
    const json = await res.json();
    assert.match(json.error, /read-only|permission/i);
    assert.equal(json.code, 'EROFS');

    const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    assert.ok(dbAfter.metadata.vidErofs, 'db entry must be untouched without removeAnyway');
    assert.ok(dbAfter.progress.vidErofs, 'progress entry must be untouched without removeAnyway');
  } finally {
    fs.unlinkSync = realUnlinkSync;
    fs.rmSync(filePath, { force: true });
  }
});

test('DELETE /api/videos/:id?removeAnyway=true removes the db entry when unlink fails with EROFS, and notes the file remains on disk', async () => {
  const filePath = path.join(os.tmpdir(), `filetube-delete-erofs-anyway-${Date.now()}.mp4`);
  seedDeleteTarget('vidErofsAnyway', filePath);

  const realUnlinkSync = fs.unlinkSync;
  fs.unlinkSync = () => { const e = new Error('read-only file system'); e.code = 'EROFS'; throw e; };
  try {
    const res = await fetch(`${base}/api/videos/vidErofsAnyway?removeAnyway=true`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.fileRemainsOnDisk, true);
    assert.match(json.message, /remains on disk/i);
    assert.match(json.message, /scan/i);

    const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    assert.ok(!dbAfter.metadata.vidErofsAnyway, 'db entry must be removed with removeAnyway on a read-only failure');
    assert.ok(!dbAfter.progress.vidErofsAnyway, 'progress entry must be removed too');
    assert.ok(fs.existsSync(filePath), 'the underlying file must remain on disk (unlink was skipped)');
  } finally {
    fs.unlinkSync = realUnlinkSync;
    fs.rmSync(filePath, { force: true });
  }
});

test('DELETE /api/videos/:id succeeds (200) and removes the db entry when the file is already gone (ENOENT) -- no orphaned, un-deletable item', async () => {
  // Regression: an ENOENT unlink (file already deleted/moved externally, or a
  // stored-path mismatch / TOCTOU race after existsSync) used to return 500 and
  // leave the db entry orphaned, so the item stayed in the list and looked
  // playable. Delete is now idempotent: file-already-gone is a SUCCESS.
  const filePath = path.join(os.tmpdir(), `filetube-delete-enoent-${Date.now()}.mp4`);
  seedDeleteTarget('vidEnoent', filePath);

  const realUnlinkSync = fs.unlinkSync;
  fs.unlinkSync = () => { const e = new Error('no such file or directory'); e.code = 'ENOENT'; throw e; };
  try {
    const res = await fetch(`${base}/api/videos/vidEnoent`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);

    const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    assert.ok(!dbAfter.metadata.vidEnoent, 'db entry must be removed when the file is already gone (fixes the orphaned-item bug)');
    assert.ok(!dbAfter.progress.vidEnoent, 'progress entry must be removed too');
  } finally {
    fs.unlinkSync = realUnlinkSync;
    fs.rmSync(filePath, { force: true });
  }
});

test('DELETE /api/videos/:id returns a 409 distinguishable from EROFS on an EACCES unlink failure, and leaves the db untouched', async () => {
  const filePath = path.join(os.tmpdir(), `filetube-delete-eacces-${Date.now()}.mp4`);
  seedDeleteTarget('vidEacces', filePath);

  const realUnlinkSync = fs.unlinkSync;
  fs.unlinkSync = () => { const e = new Error('permission denied'); e.code = 'EACCES'; throw e; };
  try {
    const res = await fetch(`${base}/api/videos/vidEacces`, { method: 'DELETE' });
    assert.equal(res.status, 409);
    const json = await res.json();
    assert.match(json.error, /permission|read-only/i);
    assert.equal(json.code, 'EACCES');
    assert.notEqual(json.code, 'EROFS');

    const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    assert.ok(dbAfter.metadata.vidEacces, 'db entry must be untouched without removeAnyway');
  } finally {
    fs.unlinkSync = realUnlinkSync;
    fs.rmSync(filePath, { force: true });
  }
});

test('DELETE /api/videos/:id?removeAnyway=true removes the db entry when unlink fails with EACCES', async () => {
  const filePath = path.join(os.tmpdir(), `filetube-delete-eacces-anyway-${Date.now()}.mp4`);
  seedDeleteTarget('vidEaccesAnyway', filePath);

  const realUnlinkSync = fs.unlinkSync;
  fs.unlinkSync = () => { const e = new Error('permission denied'); e.code = 'EACCES'; throw e; };
  try {
    const res = await fetch(`${base}/api/videos/vidEaccesAnyway?removeAnyway=true`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.fileRemainsOnDisk, true);

    const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    assert.ok(!dbAfter.metadata.vidEaccesAnyway);
  } finally {
    fs.unlinkSync = realUnlinkSync;
    fs.rmSync(filePath, { force: true });
  }
});

test('DELETE /api/videos/:id still returns a generic 500 (not 409) for a non-EROFS/EACCES unlink failure, and leaves the db untouched (regression)', async () => {
  const filePath = path.join(os.tmpdir(), `filetube-delete-other-${Date.now()}.mp4`);
  seedDeleteTarget('vidOtherErr', filePath);

  const realUnlinkSync = fs.unlinkSync;
  fs.unlinkSync = () => { const e = new Error('input/output error'); e.code = 'EIO'; throw e; };
  try {
    const res = await fetch(`${base}/api/videos/vidOtherErr`, { method: 'DELETE' });
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.match(json.error, /Could not delete file/);

    const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    assert.ok(dbAfter.metadata.vidOtherErr, 'db entry must stay untouched on a generic FS failure');
  } finally {
    fs.unlinkSync = realUnlinkSync;
    fs.rmSync(filePath, { force: true });
  }
});

test('DELETE /api/videos/:id happy path (unlink succeeds) still fully cleans up file, sidecars, and db (regression)', async () => {
  const id = 'vidHappyDelete';
  const filePath = path.join(os.tmpdir(), `filetube-delete-happy-${Date.now()}.mp4`);
  seedDeleteTarget(id, filePath);
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);
  fs.writeFileSync(thumbPath, 'thumb-bytes');
  const transcodeFile = transcodedPath(id);
  fs.writeFileSync(transcodeFile, 'transcode-bytes');

  const res = await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.fileRemainsOnDisk, undefined, 'happy path never carries the removeAnyway caveat flag');

  assert.ok(!fs.existsSync(filePath), 'the media file itself must be gone');
  assert.ok(!fs.existsSync(thumbPath), 'the thumbnail sidecar must be gone');
  assert.ok(!fs.existsSync(transcodeFile), 'the transcode sidecar must be gone');

  const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.ok(!dbAfter.metadata[id]);
  assert.ok(!dbAfter.progress[id]);
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
