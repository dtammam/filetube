'use strict';

// Isolated DATA_DIR before requiring the app so the suite never reads or
// writes real project data. Own process per file (node --test) mirrors
// test/integration/scan-api.test.js / api.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scan-prune-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
const TRANSCODE_DIR = path.join(DATA_DIR, 'transcoded');

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { scanDirectories, getMediaId } = require('../../server');

function baseSettings(overrides) {
  return {
    scanIntervalMinutes: 30,
    pruneMissing: true,
    cacheMaxBytes: null,
    cacheMaxAgeDays: 30,
    ...overrides,
  };
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

beforeEach(() => {
  // Start every test from a fresh db.json and empty sidecar dirs so
  // prune/cleanup assertions aren't polluted across cases.
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
  for (const dir of [THUMBNAIL_DIR, TRANSCODE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name));
  }
});

// ---- (a) THE CATASTROPHE GUARD -------------------------------------------
// The single most important test in the feature: a configured root folder
// that is entirely missing/unmounted must NEVER lose its db.metadata
// entries during a scan — regardless of the pruneMissing toggle.

test('(a) CATASTROPHE GUARD: entries under a missing/unmounted root survive with pruneMissing=true', async () => {
  const missingRoot = path.join(os.tmpdir(), `filetube-missing-${Date.now()}-true`);
  // Never created on disk -> simulates an unmounted/removed drive.
  const filePath = path.join(missingRoot, 'ghost.mp4');
  const id = getMediaId(filePath);
  writeDb({
    folders: [missingRoot],
    folderSettings: {},
    progress: { [id]: { position: 12 } },
    metadata: {
      [id]: {
        id, name: 'ghost.mp4', title: 'ghost', filePath, folderName: 'ghost-lib',
        size: 123, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: missingRoot,
      },
    },
    settings: baseSettings({ pruneMissing: true }),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[id], 'entry under a missing root must survive the scan even with pruneMissing on');
  assert.equal(db.metadata[id].filePath, filePath);
  assert.ok(db.progress[id], 'watch progress for a retained (mount-loss) entry must not be touched');
});

test('(a) CATASTROPHE GUARD: entries under a missing/unmounted root survive with pruneMissing=false', async () => {
  const missingRoot = path.join(os.tmpdir(), `filetube-missing-${Date.now()}-false`);
  const filePath = path.join(missingRoot, 'ghost2.mp4');
  const id = getMediaId(filePath);
  writeDb({
    folders: [missingRoot],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'ghost2.mp4', title: 'ghost2', filePath, folderName: 'ghost-lib',
        size: 123, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: missingRoot,
      },
    },
    settings: baseSettings({ pruneMissing: false }),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[id], 'entry under a missing root must survive the scan with pruneMissing off too (toggle-independent)');
});

// ---- (b)/(c) individually-gone file under a PRESENT root -----------------

test('(b) pruneMissing=true + present root + individually-gone file: pruned, sidecars cleaned up', async () => {
  const presentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-present-'));
  const filePath = path.join(presentRoot, 'gone.mp4');
  // Deliberately never created on disk -> simulates a deleted individual file.
  const id = getMediaId(filePath);
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'thumb');
  fs.writeFileSync(path.join(TRANSCODE_DIR, `${id}.mp4`), 'transcoded');

  writeDb({
    folders: [presentRoot],
    folderSettings: {},
    progress: { [id]: { position: 42 } },
    metadata: {
      [id]: {
        id, name: 'gone.mp4', title: 'gone', filePath, folderName: path.basename(presentRoot),
        size: 100, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: presentRoot,
      },
    },
    settings: baseSettings({ pruneMissing: true }),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(!db.metadata[id], 'an individually-deleted file under a present root should be pruned when pruneMissing is on');
  assert.ok(!db.progress[id], 'watch progress for a pruned entry should be removed');
  assert.ok(!fs.existsSync(path.join(THUMBNAIL_DIR, `${id}.jpg`)), 'thumbnail sidecar should be deleted on prune');
  assert.ok(!fs.existsSync(path.join(TRANSCODE_DIR, `${id}.mp4`)), 'transcode sidecar should be deleted on prune');
});

test('(c) pruneMissing=false + present root + individually-gone file: retained as a stale entry', async () => {
  const presentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-present-'));
  const filePath = path.join(presentRoot, 'gone2.mp4');
  const id = getMediaId(filePath);
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'thumb');
  fs.writeFileSync(path.join(TRANSCODE_DIR, `${id}.mp4`), 'transcoded');

  writeDb({
    folders: [presentRoot],
    folderSettings: {},
    progress: { [id]: { position: 7 } },
    metadata: {
      [id]: {
        id, name: 'gone2.mp4', title: 'gone2', filePath, folderName: path.basename(presentRoot),
        size: 100, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: presentRoot,
      },
    },
    settings: baseSettings({ pruneMissing: false }),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[id], 'entry should be retained (not pruned) when pruneMissing is off');
  assert.ok(db.progress[id], 'progress for a retained entry should not be cleaned up');
  assert.ok(fs.existsSync(path.join(THUMBNAIL_DIR, `${id}.jpg`)), 'thumbnail sidecar should NOT be deleted when retained');
  assert.ok(fs.existsSync(path.join(TRANSCODE_DIR, `${id}.mp4`)), 'transcode sidecar should NOT be deleted when retained');
});

// ---- (d) zero-regression: a normal, all-present scan behaves as before ----

test('(d) all roots present and all files present: no spurious retention or pruning', async () => {
  const presentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-present-'));
  const filePath = path.join(presentRoot, 'keep.mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const size = fs.statSync(filePath).size;
  const id = getMediaId(filePath);

  writeDb({
    folders: [presentRoot],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'keep.mp4', title: 'keep', filePath, folderName: path.basename(presentRoot),
        size, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 10, hasThumbnail: false, artist: '', rootFolder: presentRoot,
      },
    },
    settings: baseSettings({ pruneMissing: true }),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[id], 'a present, unchanged file must remain in metadata');
  assert.equal(Object.keys(db.metadata).length, 1, 'no spurious retained/pruned extras appear');
});
