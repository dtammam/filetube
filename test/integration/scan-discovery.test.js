'use strict';

// [INTEGRATION] v1.15.0 item 9 -- additive coverage for the core scan-discovery
// pipeline (scanDirRecursive, driven via the exported scanDirectories()), which
// had no dedicated test of its own: extension-whitelist filtering, nested
// subdirectory recursion + per-directory folderName derivation, and
// video/audio type assignment in a single pass. No FFmpeg needed --
// extractMetadataAndThumbnail no-ops (duration 0, hasThumbnail false) when
// ffmpegAvailable is false, exactly like the existing scan-prune.test.js /
// scan-api.test.js pattern this file mirrors. Isolated DATA_DIR before
// requiring the app, own process per file (node --test).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scan-discovery-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

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
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
});

test('scanDirectories: a root-level media file gets folderName === basename(root)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-discovery-root-'));
  const filePath = path.join(root, 'top-level.mp4');
  fs.writeFileSync(filePath, 'root-level-bytes');
  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const db = readDb();
  const id = getMediaId(filePath);
  assert.ok(db.metadata[id], 'root-level file must be indexed');
  assert.equal(db.metadata[id].folderName, path.basename(root));
});

test('scanDirectories: a file in a nested subdirectory gets folderName === basename(that subdirectory), not the root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-discovery-nested-'));
  const subDir = path.join(root, 'My Channel');
  fs.mkdirSync(subDir);
  const filePath = path.join(subDir, 'episode.mp4');
  fs.writeFileSync(filePath, 'nested-bytes');
  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const db = readDb();
  const id = getMediaId(filePath);
  assert.ok(db.metadata[id], 'nested file must be indexed');
  assert.equal(db.metadata[id].folderName, 'My Channel');
});

test('scanDirectories: recurses through multiple levels of nesting and indexes files at every depth', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-discovery-deep-'));
  const level1 = path.join(root, 'season-1');
  const level2 = path.join(level1, 'extras');
  fs.mkdirSync(level2, { recursive: true });
  const rootFile = path.join(root, 'root.mp4');
  const level1File = path.join(level1, 'ep1.mp4');
  const level2File = path.join(level2, 'bonus.mp4');
  fs.writeFileSync(rootFile, 'a');
  fs.writeFileSync(level1File, 'b');
  fs.writeFileSync(level2File, 'c');
  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const db = readDb();
  for (const p of [rootFile, level1File, level2File]) {
    assert.ok(db.metadata[getMediaId(p)], `${p} must be indexed regardless of nesting depth`);
  }
  assert.equal(db.metadata[getMediaId(level2File)].folderName, 'extras', 'the deepest file\'s folderName is its own immediate parent, not an ancestor');
});

test('scanDirectories: non-whitelisted extensions (sidecar files) sitting alongside media are never indexed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-discovery-sidecars-'));
  const videoPath = path.join(root, 'movie.mp4');
  fs.writeFileSync(videoPath, 'video-bytes');
  const sidecarPaths = [
    path.join(root, 'movie.srt'),
    path.join(root, 'movie.nfo'),
    path.join(root, 'poster.jpg'),
    path.join(root, 'readme.txt'),
  ];
  for (const p of sidecarPaths) fs.writeFileSync(p, 'sidecar-bytes');
  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[getMediaId(videoPath)], 'the whitelisted media file must be indexed');
  const ids = Object.keys(db.metadata);
  assert.equal(ids.length, 1, 'exactly one entry -- every sidecar file must be excluded from the scan');
  for (const p of sidecarPaths) {
    assert.ok(!db.metadata[getMediaId(p)], `${p} (non-whitelisted extension) must never be indexed`);
  }
});

test('scanDirectories: both video and audio extensions are discovered in the same pass, each tagged with the correct type', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-discovery-mixed-'));
  const videoPath = path.join(root, 'clip.mkv');
  const audioPath = path.join(root, 'track.mp3');
  fs.writeFileSync(videoPath, 'video-bytes');
  fs.writeFileSync(audioPath, 'audio-bytes');
  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const db = readDb();
  assert.equal(db.metadata[getMediaId(videoPath)].type, 'video');
  assert.equal(db.metadata[getMediaId(audioPath)].type, 'audio');
});

test('scanDirectories: an AVI (browser-incompatible container) is flagged needsTranscode; an MP4 is not', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-discovery-transcode-flag-'));
  const aviPath = path.join(root, 'old.avi');
  const mp4Path = path.join(root, 'new.mp4');
  fs.writeFileSync(aviPath, 'avi-bytes');
  fs.writeFileSync(mp4Path, 'mp4-bytes');
  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const db = readDb();
  assert.equal(db.metadata[getMediaId(aviPath)].needsTranscode, true);
  assert.equal(db.metadata[getMediaId(mp4Path)].needsTranscode, false);
});

test('scanDirectories: size and addedAt are populated from the real filesystem stat', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-discovery-stat-'));
  const filePath = path.join(root, 'sized.mp4');
  const contents = Buffer.alloc(1234, 'x');
  fs.writeFileSync(filePath, contents);
  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const db = readDb();
  const entry = db.metadata[getMediaId(filePath)];
  assert.equal(entry.size, 1234);
  assert.equal(typeof entry.addedAt, 'number');
  assert.ok(entry.addedAt > 0);
});
