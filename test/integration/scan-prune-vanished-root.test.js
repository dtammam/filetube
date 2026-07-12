'use strict';

// [INTEGRATION] v1.33 T4 (tech-debt #10, Dean's Option C) -- end-to-end scan
// behavior for the EMPTY-BUT-PRESENT mountpoint: a configured root whose
// directory still exists but whose ENTIRE previously-indexed content is gone
// this pass must be treated exactly like a missing/unmounted root (nothing
// pruned, watch progress and sidecars preserved), while an individual
// deletion under the same root (a sibling survives) still prunes normally.
// Companion to test/integration/scan-prune.test.js (which owns the
// existsSync-failed mount-loss guard and the individual-prune matrix).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-vanished-root-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
const TRANSCODE_DIR = path.join(DATA_DIR, 'transcoded');

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { scanDirectories, getMediaId, saveDatabase } = require('../../server');

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
  saveDatabase(db);
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function seedEntry(id, filePath, root) {
  return {
    id, name: path.basename(filePath), title: path.basename(filePath, '.mp4'), filePath,
    folderName: path.basename(root), size: 100, ext: '.mp4', type: 'video',
    addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '', rootFolder: root,
  };
}

beforeEach(() => {
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
  for (const dir of [THUMBNAIL_DIR, TRANSCODE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name));
  }
});

test('empty-but-present root: ALL entries + progress + sidecars survive, even with pruneMissing on', async () => {
  // The mountpoint directory EXISTS but holds nothing -- the post-unmount
  // shape existsSync-based detection can't see.
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-emptymount-'));
  const fileA = path.join(emptyRoot, 'a.mp4');
  const fileB = path.join(emptyRoot, 'sub', 'b.mp4');
  const idA = getMediaId(fileA);
  const idB = getMediaId(fileB);
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${idA}.jpg`), 'thumb');
  fs.writeFileSync(path.join(TRANSCODE_DIR, `${idA}.mp4`), 'transcoded');

  writeDb({
    folders: [emptyRoot],
    folderSettings: {},
    progress: { [idA]: { position: 42 }, [idB]: { position: 7 } },
    metadata: {
      [idA]: seedEntry(idA, fileA, emptyRoot),
      [idB]: seedEntry(idB, fileB, emptyRoot),
    },
    settings: baseSettings({ pruneMissing: true }),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[idA], 'entry A must survive an empty-but-present root scan');
  assert.ok(db.metadata[idB], 'entry B must survive too -- the whole root is protected, not just depth-0');
  assert.ok(db.progress[idA], 'watch progress must be preserved (the whole point of tech-debt #10)');
  assert.ok(db.progress[idB]);
  assert.ok(fs.existsSync(path.join(THUMBNAIL_DIR, `${idA}.jpg`)), 'thumbnail sidecar must not be reaped');
  assert.ok(fs.existsSync(path.join(TRANSCODE_DIR, `${idA}.mp4`)), 'transcode sidecar must not be reaped');
});

test('the protection heals itself: once the mount is back, a later scan re-indexes and everything reconnects', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-remount-'));
  const filePath = path.join(root, 'video.mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const id = getMediaId(filePath);

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: { [id]: { position: 99 } },
    metadata: { [id]: { ...seedEntry(id, filePath, root), size: fs.statSync(filePath).size } },
    settings: baseSettings({ pruneMissing: true }),
  });

  // Scan 1: "unmounted" -- file gone, directory present.
  fs.rmSync(filePath);
  await scanDirectories();
  assert.ok(readDb().metadata[id], 'entry retained across the vanish');

  // Scan 2: "remounted" -- same file back at the same path (same id).
  fs.writeFileSync(filePath, 'video-bytes');
  await scanDirectories();
  const db = readDb();
  assert.ok(db.metadata[id], 'entry present after remount');
  assert.equal(db.progress[id].position, 99, 'watch progress survived the whole unmount/remount cycle');
});

test('an individual deletion (sibling survives) still prunes normally -- the signature is root-total, not per-file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-partial-'));
  const keeperPath = path.join(root, 'keeper.mp4');
  fs.writeFileSync(keeperPath, 'keeper-bytes');
  const gonePath = path.join(root, 'gone.mp4');
  const goneId = getMediaId(gonePath); // never created on disk

  writeDb({
    folders: [root],
    folderSettings: {},
    progress: { [goneId]: { position: 5 } },
    metadata: { [goneId]: seedEntry(goneId, gonePath, root) },
    settings: baseSettings({ pruneMissing: true }),
  });

  await scanDirectories();

  const db = readDb();
  assert.ok(!db.metadata[goneId], 'an individually-deleted file with a surviving sibling must still prune');
  assert.ok(!db.progress[goneId], 'its progress goes with it, as before');
});

test('pruneMissing=false composes: a vanished root is retained there too (the guard is toggle-independent)', async () => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-emptymount-off-'));
  const filePath = path.join(emptyRoot, 'v.mp4');
  const id = getMediaId(filePath);

  writeDb({
    folders: [emptyRoot],
    folderSettings: {},
    progress: {},
    metadata: { [id]: seedEntry(id, filePath, emptyRoot) },
    settings: baseSettings({ pruneMissing: false }),
  });

  await scanDirectories();
  assert.ok(readDb().metadata[id]);
});
