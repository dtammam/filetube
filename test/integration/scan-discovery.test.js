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

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { scanDirectories, getMediaId, isYtdlpIntermediate, saveDatabase, __resetDatabaseForTests } = require('../../server');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

function baseSettings(overrides) {
  return {
    scanIntervalMinutes: 30,
    pruneMissing: true,
    cacheMaxBytes: null,
    cacheMaxAgeDays: 30,
    ...overrides,
  };
}

// v1.30 A3 (in-memory DB read cache): seed via the exported `saveDatabase()`
// (an established test primitive, see CONTRIBUTING.md) rather than a raw
// `fs.writeFileSync`, so the in-process db cache stays coherent.
function writeDb(db) {
  saveDatabase(db);
}

function readDb() {
  return readPersistedDatabase(process.env.DATA_DIR);
}

beforeEach(async () => {
  await __resetDatabaseForTests();
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

// ---- v1.15.1 hotfix: yt-dlp intermediate/partial-download artifacts are
// excluded from the scan entirely (isYtdlpIntermediate), even when they
// carry a whitelisted media extension -- so a download killed by the
// download timeout (or otherwise failed) never leaves a broken library card
// (no thumbnail, raw yt-dlp-shaped name) behind. ----------------------------

test('isYtdlpIntermediate: recognizes yt-dlp per-format fragments, merge temps, and partial markers', () => {
  const intermediateNames = [
    'Some Title [wSx0Or20MZE].f399.mp4',
    'Some Title [wSx0Or20MZE].f251.webm',
    'Some Title [wSx0Or20MZE].temp.mp4',
    'Some Title [wSx0Or20MZE].temp.mkv',
    'Some Title [wSx0Or20MZE].mp4.part',
    'Some Title [wSx0Or20MZE].mp4.ytdl',
    'Some Title [wSx0Or20MZE].mp4.part-Frag3',
  ];
  for (const name of intermediateNames) {
    assert.equal(isYtdlpIntermediate(name), true, `${name} should be recognized as a yt-dlp intermediate`);
  }
});

test('isYtdlpIntermediate: an ordinary media filename (including one with extra dots) is never treated as an intermediate', () => {
  const normalNames = [
    'Movie.mp4',
    'My.Video.2024.mp4',
    'Link Miguel en Vivo [wSx0Or20MZE].mp3',
    'Season 1 Episode 2.mkv',
    'readme.txt',
    'poster.jpg',
  ];
  for (const name of normalNames) {
    assert.equal(isYtdlpIntermediate(name), false, `${name} must NOT be treated as a yt-dlp intermediate`);
  }
});

// v1.15.1 hotfix-2 (CRITICAL data-loss regression test): the original
// patterns matched on suffix shape ALONE, with no requirement for yt-dlp's
// own " [<id>]" bracket -- so a real user file that merely shared a suffix
// shape (e.g. "Vacation.f2.mp4") was wrongly recognized as a yt-dlp
// intermediate, which meant the scan silently excluded it AND
// cleanupFailedDownloadIntermediates (lib/ytdlp/index.js) permanently
// deleted it after any failed download in the same directory. Every one of
// these bracket-less lookalikes must never match.
test('isYtdlpIntermediate: a bracket-less lookalike file (no yt-dlp " [<id>]" bracket) is never treated as an intermediate', () => {
  const lookalikeNames = [
    'Vacation.f2.mp4',
    'Draft.temp.mp4',
    'notes.part',
    'data.ytdl',
    'My.Video.2024.mp4',
    'Episode.4.mp4',
    'song.remix.mp3',
  ];
  for (const name of lookalikeNames) {
    assert.equal(isYtdlpIntermediate(name), false, `${name} (no id bracket) must NOT be treated as a yt-dlp intermediate`);
  }
});

test('isYtdlpIntermediate: genuine yt-dlp intermediates WITH the id bracket are still recognized', () => {
  const genuineNames = [
    'Some Title [wSx0Or20MZE].f399.mp4',
    'Some Title [wSx0Or20MZE].temp.mp4',
    'Some Title [wSx0Or20MZE].mp4.part',
    'Some Title [wSx0Or20MZE].ytdl',
  ];
  for (const name of genuineNames) {
    assert.equal(isYtdlpIntermediate(name), true, `${name} (has id bracket) should be recognized as a yt-dlp intermediate`);
  }
});

test('isYtdlpIntermediate: FileTube\'s OWN ".tmp.mp4" transcode-temp pattern (one "m") is a DIFFERENT shape and is left untouched', () => {
  assert.equal(isYtdlpIntermediate('abc123.tmp.mp4'), false);
});

test('isYtdlpIntermediate: defensive on non-string/empty input, never throws', () => {
  for (const bad of [undefined, null, 42, {}, [], '']) {
    assert.doesNotThrow(() => isYtdlpIntermediate(bad));
    assert.equal(isYtdlpIntermediate(bad), false);
  }
});

test('scanDirectories: a yt-dlp per-format fragment/merge-temp file left after a killed/failed download is never indexed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-discovery-ytdlp-intermediates-'));
  const goodPath = path.join(root, 'Good Video [wSx0Or20MZE].mp4');
  const fragmentPath = path.join(root, 'Killed Video [wSx0Or20MZE].f399.mp4');
  const audioFragmentPath = path.join(root, 'Killed Video [wSx0Or20MZE].f251.webm');
  const mergeTempPath = path.join(root, 'Killed Video [wSx0Or20MZE].temp.mp4');
  const partPath = path.join(root, 'Killed Video [wSx0Or20MZE].mp4.part');
  const ytdlPath = path.join(root, 'Killed Video [wSx0Or20MZE].mp4.ytdl');
  for (const p of [goodPath, fragmentPath, audioFragmentPath, mergeTempPath, partPath, ytdlPath]) {
    fs.writeFileSync(p, 'bytes');
  }
  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[getMediaId(goodPath)], 'a normal completed download must still be indexed');
  const ids = Object.keys(db.metadata);
  assert.equal(ids.length, 1, 'exactly one entry -- every yt-dlp intermediate must be excluded from the scan');
  for (const p of [fragmentPath, audioFragmentPath, mergeTempPath, partPath, ytdlPath]) {
    assert.ok(!db.metadata[getMediaId(p)], `${p} (yt-dlp intermediate) must never be indexed`);
  }
});

test('scanDirectories: a bracket-less lookalike file (no yt-dlp id bracket) is still indexed, never excluded as an intermediate', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-discovery-bracketless-'));
  const fragmentLookalike = path.join(root, 'Vacation.f2.mp4');
  const tempLookalike = path.join(root, 'Draft.temp.mp4');
  for (const p of [fragmentLookalike, tempLookalike]) {
    fs.writeFileSync(p, 'bytes');
  }
  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[getMediaId(fragmentLookalike)], 'Vacation.f2.mp4 (no id bracket) must still be indexed');
  assert.ok(db.metadata[getMediaId(tempLookalike)], 'Draft.temp.mp4 (no id bracket) must still be indexed');
});

test('scanDirectories: a normal media filename with extra dots is still indexed (not mistaken for a yt-dlp intermediate)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-discovery-dotted-names-'));
  const dottedPath = path.join(root, 'My.Video.2024.mp4');
  fs.writeFileSync(dottedPath, 'bytes');
  writeDb({ folders: [root], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[getMediaId(dottedPath)], 'a normal dotted filename must still be indexed');
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
