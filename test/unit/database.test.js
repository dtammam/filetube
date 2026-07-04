'use strict';

// Fresh, isolated DATA_DIR per test file (own process). Every test controls the
// db.json in this dir directly, so there is no shared-state bleed.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
const DB_FILE = path.join(process.env.DATA_DIR, 'db.json');

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  loadDatabase,
  saveDatabase,
  transcodedPath,
  reconcileTranscode,
} = require('../../server');

beforeEach(() => {
  // Start each test from a clean slate.
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
});

test('loadDatabase: creates a default db when none exists', () => {
  const db = loadDatabase();
  assert.deepEqual(db.folders, []);
  assert.deepEqual(db.folderSettings, {});
  assert.deepEqual(db.progress, {});
  assert.deepEqual(db.metadata, {});
  assert.ok(fs.existsSync(DB_FILE), 'db.json is written to disk');
});

test('loadDatabase: backfills folderSettings for older databases', () => {
  fs.writeFileSync(DB_FILE, JSON.stringify({ folders: ['/x'], progress: {}, metadata: {} }));
  const db = loadDatabase();
  assert.deepEqual(db.folderSettings, {}, 'missing folderSettings is backfilled');
  assert.deepEqual(db.folders, ['/x']);
});

test('loadDatabase: recovers from a corrupt db.json instead of throwing', () => {
  fs.writeFileSync(DB_FILE, '{ this is not valid json ');
  const db = loadDatabase();
  assert.deepEqual(db, { folders: [], folderSettings: {}, progress: {}, metadata: {} });
});

test('saveDatabase + loadDatabase: round-trips data faithfully', () => {
  const original = {
    folders: ['/media/movies'],
    folderSettings: { '/media/movies': { name: 'Movies', hidden: false } },
    progress: { abc: { timestamp: 42, duration: 100 } },
    metadata: { abc: { id: 'abc', title: 'Test' } },
  };
  saveDatabase(original);
  assert.deepEqual(loadDatabase(), original);
});

test('reconcileTranscode: audio items never carry a transcode status', () => {
  const item = { id: 'a', type: 'audio', ext: '.mp3', transcodeStatus: 'ready' };
  const changed = reconcileTranscode(item);
  assert.equal(changed, true);
  assert.equal(item.transcodeStatus, undefined);
});

test('reconcileTranscode: web-native video needs no transcode', () => {
  const item = { id: 'b', type: 'video', ext: '.mp4' };
  const changed = reconcileTranscode(item);
  assert.equal(item.needsTranscode, false);
  assert.equal(changed, false);
  assert.equal(item.transcodeStatus, undefined);
});

test('reconcileTranscode: AVI with a cached MP4 is marked ready', () => {
  const item = { id: 'ready-one', type: 'video', ext: '.avi' };
  const cached = transcodedPath(item.id);
  fs.writeFileSync(cached, 'fake mp4 bytes');
  try {
    const changed = reconcileTranscode(item);
    assert.equal(item.needsTranscode, true);
    assert.equal(item.transcodeStatus, 'ready');
    assert.equal(changed, true);
  } finally {
    fs.rmSync(cached);
  }
});

test('reconcileTranscode: clears a stale "ready" when the cached MP4 is gone', () => {
  const item = { id: 'stale', type: 'video', ext: '.avi', transcodeStatus: 'ready' };
  const changed = reconcileTranscode(item);
  assert.equal(item.transcodeStatus, undefined, 'stale ready is cleared');
  assert.equal(changed, true);
});

test('reconcileTranscode: leaves in-flight status untouched when no cache yet', () => {
  const item = { id: 'proc', type: 'video', ext: '.avi', transcodeStatus: 'processing' };
  const changed = reconcileTranscode(item);
  assert.equal(item.transcodeStatus, 'processing', 'pending/processing/failed left alone');
  assert.equal(changed, false);
});
