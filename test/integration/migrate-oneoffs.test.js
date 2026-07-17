'use strict';

// [INTEGRATION][MANDATORY, DATA MIGRATION] T4 (v1.25 QoL) --
// `migrateOneOffsIntoChannelFolders`, the one-time pass that physically
// relocates pre-existing flat one-off yt-dlp downloads into their captured
// channel's folder, reusing T9's `moveItemToFolder` id re-key machinery. Two-
// reviewer gate (data migration + id re-key -- the highest-risk task in this
// wave). Mirrors test/integration/move-files.test.js's + move-scan-
// survives.test.js's isolation pattern and the load-bearing regression it
// locks (watch progress must survive a subsequent scan under the new id).
//
// Isolated DATA_DIR before requiring the app, own process per file
// (node --test).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-migrate-oneoffs-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  getMediaId, loadDatabase, saveDatabase, updateDatabase, scanDirectories, migrateOneOffsIntoChannelFolders,
} = require('../../server');
const { readPersistedDatabase } = require('../../lib/db/sqlite');
const ytdlp = require('../../lib/ytdlp');
const ytdlpArgs = require('../../lib/ytdlp/args');

// v1.42: seeds go through the exported saveDatabase (the adapter opened at
// require time, so a raw db.json write would be dead); persisted-state
// assertions go through the sanctioned SQLite read helper. An EMPTY doc_kv
// namespace persists as zero rows (absent); backfill the ones this file
// dereferences so `dbAfter.progress[id]`-style reads stay valid.
function readDb() {
  const db = readPersistedDatabase(DATA_DIR);
  for (const ns of ['metadata', 'progress']) {
    if (!db[ns]) db[ns] = {};
  }
  return db;
}

function baseSettings() {
  return { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, defaultView: '', autoplayNext: false };
}

let downloadDir;

beforeEach(() => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-migrate-dl-'));
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
});

afterEach(() => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

test('HEADLINE: a flat one-off with a captured channelName is moved into resolveChannelDir(...), id re-keyed, progress+sidecars preserved, and watch progress survives a subsequent scan (no delete+new-add)', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const filePath = path.join(downloadDir, 'Some Video [abc12345678].mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const oldId = getMediaId(filePath);

  const targetDir = ytdlpArgs.resolveChannelDir(config, { name: 'Rick Astley' });
  const newPath = path.join(targetDir, path.basename(filePath));
  const newId = getMediaId(newPath);
  assert.notEqual(oldId, newId, 'sanity: a folder move must change the path-derived id');

  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${oldId}.jpg`), 'thumb-bytes');
  const subPath = path.join(downloadDir, 'Some Video [abc12345678].en.vtt');
  fs.writeFileSync(subPath, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n');

  saveDatabase({
    folders: [],
    folderSettings: {},
    progress: { [oldId]: { timestamp: 55, duration: 300, updatedAt: '2026-07-01T00:00:00.000Z' } },
    metadata: {
      [oldId]: {
        id: oldId, name: path.basename(filePath), title: 'Some Video', filePath,
        folderName: path.basename(downloadDir), size: 11, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 300, hasThumbnail: true, artist: '',
        channelName: 'Rick Astley', channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      },
    },
    settings: baseSettings(),
  });

  const summary = await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, config);
  assert.equal(summary.moved, 1);
  assert.equal(summary.errors, 0);

  assert.ok(!fs.existsSync(filePath), 'the old flat path must be gone');
  assert.ok(fs.existsSync(newPath), 'the file must now live under its resolved channel folder');

  const dbAfter = readDb();
  assert.ok(!dbAfter.metadata[oldId], 'the OLD id must no longer be present');
  assert.ok(dbAfter.metadata[newId], 'the NEW (path-derived) id must be present');
  assert.equal(dbAfter.metadata[newId].filePath, newPath);
  assert.deepStrictEqual(dbAfter.progress[newId], { timestamp: 55, duration: 300, updatedAt: '2026-07-01T00:00:00.000Z' }, 'watch progress must survive the move intact under the new id');
  assert.ok(!dbAfter.progress[oldId], 'no stray progress entry under the old id');

  assert.ok(fs.existsSync(path.join(THUMBNAIL_DIR, `${newId}.jpg`)), 'the thumbnail must be re-keyed to the new id');
  assert.ok(!fs.existsSync(path.join(THUMBNAIL_DIR, `${oldId}.jpg`)), 'the old thumbnail path must be gone');

  const newSubPath = path.join(targetDir, 'Some Video [abc12345678].en.vtt');
  assert.ok(fs.existsSync(newSubPath), 'the .en.vtt subtitle sidecar must be moved alongside the media file');
  assert.ok(!fs.existsSync(subPath), 'the old-path subtitle sidecar must be gone');

  // The mandatory re-key regression: run the NEXT scan, exactly as if the
  // server restarted (or the periodic timer fired) right after this
  // migration ran. A false delete+new-add would prune progress[newId] and
  // resurrect nothing useful; a correct reuse fast-path leaves it untouched.
  await scanDirectories();
  const finalDb = readDb();
  assert.deepStrictEqual(finalDb.progress[newId], { timestamp: 55, duration: 300, updatedAt: '2026-07-01T00:00:00.000Z' }, 'watch progress under the new id must be byte-identical after a scan');
  assert.ok(finalDb.metadata[newId], 'the new-path id must still be present after the scan');
  assert.ok(!finalDb.metadata[oldId], 'the OLD id must never be resurrected by the scan');
  assert.equal(Object.keys(finalDb.metadata).length, 1, 'exactly one metadata entry -- no duplicate/ghost entry');
});

test('idempotent: a second migration run moves nothing', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const filePath = path.join(downloadDir, 'Video [id111111111].mp4');
  fs.writeFileSync(filePath, 'bytes');
  const oldId = getMediaId(filePath);

  saveDatabase({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [oldId]: {
        id: oldId, name: path.basename(filePath), title: 'Video', filePath,
        folderName: path.basename(downloadDir), size: 5, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
        channelName: 'Some Channel',
      },
    },
    settings: baseSettings(),
  });

  const first = await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, config);
  assert.equal(first.moved, 1);
  assert.equal(first.errors, 0);

  const second = await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, config);
  assert.equal(second.moved, 0, 'a re-run must move nothing -- the item is already in its resolved channel folder');
  assert.equal(second.errors, 0);
  assert.ok(second.skipped >= 1);
});

test('an item already sitting in its resolved channel folder is skipped (no move attempted)', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const targetDir = ytdlpArgs.resolveChannelDir(config, { name: 'Already Here' });
  fs.mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, 'clip.mp4');
  fs.writeFileSync(filePath, 'bytes');
  const id = getMediaId(filePath);

  saveDatabase({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'clip.mp4', title: 'clip', filePath,
        folderName: path.basename(targetDir), size: 5, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
        channelName: 'Already Here',
      },
    },
    settings: baseSettings(),
  });

  const summary = await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, config);
  assert.equal(summary.moved, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.errors, 0);

  const dbAfter = readDb();
  assert.equal(dbAfter.metadata[id].filePath, filePath, 'the item must be completely untouched');
  assert.ok(fs.existsSync(filePath));
});

test('an item with NO captured channel identity is left untouched', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const filePath = path.join(downloadDir, 'no-identity.mp4');
  fs.writeFileSync(filePath, 'bytes');
  const id = getMediaId(filePath);

  saveDatabase({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'no-identity.mp4', title: 'no-identity', filePath,
        folderName: path.basename(downloadDir), size: 5, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
      },
    },
    settings: baseSettings(),
  });

  const summary = await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, config);
  assert.equal(summary.moved, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.errors, 0);
  assert.ok(fs.existsSync(filePath), 'the file must stay exactly where it was');

  const dbAfter = readDb();
  assert.equal(dbAfter.metadata[id].filePath, filePath);
});

test('a non-ytdlp library file (outside the download root) is never touched, even if it happens to carry channel-shaped fields', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-migrate-lib-'));
  try {
    const filePath = path.join(libDir, 'movie.mp4');
    fs.writeFileSync(filePath, 'bytes');
    const id = getMediaId(filePath);

    saveDatabase({
      folders: [libDir],
      folderSettings: {},
      progress: {},
      metadata: {
        [id]: {
          id, name: 'movie.mp4', title: 'movie', filePath,
          folderName: path.basename(libDir), size: 5, ext: '.mp4', type: 'video',
          addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
          channelName: 'Not Actually A Channel',
        },
      },
      settings: baseSettings(),
    });

    const summary = await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, config);
    assert.equal(summary.moved, 0);
    assert.equal(summary.errors, 0);
    assert.ok(fs.existsSync(filePath), 'a regular library file must never be relocated by this migration');

    const dbAfter = readDb();
    assert.equal(dbAfter.metadata[id].filePath, filePath);
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});

test('migration is a no-op when the yt-dlp module is disabled: no db change, no filesystem change', async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED; // override beforeEach's 'true'
  const config = ytdlp.parseYtdlpConfig();
  assert.equal(ytdlp.isEnabled(config), false, 'sanity: the module must be disabled for this test');

  const filePath = path.join(downloadDir, 'flat.mp4');
  fs.writeFileSync(filePath, 'bytes');
  const id = getMediaId(filePath);

  saveDatabase({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'flat.mp4', title: 'flat', filePath,
        folderName: path.basename(downloadDir), size: 5, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
        channelName: 'Some Channel',
      },
    },
    settings: baseSettings(),
  });

  const summary = await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, config);
  assert.deepStrictEqual(summary, { moved: 0, skipped: 0, errors: 0, collisions: 0 });

  const dbAfter = readDb();
  assert.equal(dbAfter.metadata[id].filePath, filePath, 'the item must be untouched when the module is disabled');
  assert.ok(fs.existsSync(filePath));
});

// ---- Gate-fix regression tests (v1.25.x): the predicate must be scoped to
// the FLAT one-off pile only, and a permanent basename collision must not
// spam error-level logs on every boot. --------------------------------------

test('GATE-FIX ADVERSARIAL SCENARIO: an item already foldered under a subscription-style subfolder (sub.name) is NOT moved, even when its captured channelName resolves to a different folder', async () => {
  const config = ytdlp.parseYtdlpConfig();
  // Mirrors how a subscription download is physically foldered: under the
  // download root, in a subfolder derived from `sub.name` (typically the
  // subscribed @handle) -- NOT the download root itself, and NOT the legacy
  // 'One-Off' folder.
  const subDir = path.join(downloadDir, 'My Sub Name');
  fs.mkdirSync(subDir, { recursive: true });
  const filePath = path.join(subDir, 'Some Video [xyz98765432].mp4');
  fs.writeFileSync(filePath, 'bytes');
  const id = getMediaId(filePath);

  saveDatabase({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: 'Some Video', filePath,
        folderName: path.basename(subDir), size: 5, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
        // The captured channelName is yt-dlp's REAL display name, which
        // sanitizes to a DIFFERENT folder than 'My Sub Name' -- this is the
        // exact mismatch the over-broad predicate used to relocate.
        channelName: 'Real Channel Official',
        channelUrl: 'https://www.youtube.com/channel/UCrealchannelofficial000',
      },
    },
    settings: baseSettings(),
  });

  const summary = await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, config);
  assert.equal(summary.moved, 0, 'a subscription-style-foldered item must never be relocated by this migration');
  assert.equal(summary.skipped, 1);
  assert.equal(summary.errors, 0);
  assert.equal(summary.collisions, 0);

  assert.ok(fs.existsSync(filePath), 'the file must stay exactly where the subscription download path put it');
  const dbAfter = readDb();
  assert.equal(dbAfter.metadata[id].filePath, filePath, 'the item must be completely untouched');

  const realChannelDir = ytdlpArgs.resolveChannelDir(config, { name: 'Real Channel Official' });
  assert.ok(!fs.existsSync(realChannelDir), 'the channelName-derived folder must never have been created');
});

test('a flat one-off sitting in the legacy pre-T3 "One-Off" folder with a captured channel IS moved into its channel folder, and a re-run is a no-op', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const legacyFlatDir = path.join(downloadDir, 'One-Off');
  fs.mkdirSync(legacyFlatDir, { recursive: true });
  const filePath = path.join(legacyFlatDir, 'Legacy Video [leg12345678].mp4');
  fs.writeFileSync(filePath, 'bytes');
  const oldId = getMediaId(filePath);

  const targetDir = ytdlpArgs.resolveChannelDir(config, { name: 'Legacy Channel' });
  const newPath = path.join(targetDir, path.basename(filePath));
  const newId = getMediaId(newPath);

  saveDatabase({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [oldId]: {
        id: oldId, name: path.basename(filePath), title: 'Legacy Video', filePath,
        folderName: path.basename(legacyFlatDir), size: 5, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
        channelName: 'Legacy Channel',
      },
    },
    settings: baseSettings(),
  });

  const first = await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, config);
  assert.equal(first.moved, 1, 'a legacy flat "One-Off"-foldered item with a captured channel must be moved');
  assert.equal(first.errors, 0);
  assert.equal(first.collisions, 0);
  assert.ok(fs.existsSync(newPath), 'the file must now live under its resolved channel folder');
  assert.ok(!fs.existsSync(filePath), 'the old legacy-folder path must be gone');

  const second = await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, config);
  assert.equal(second.moved, 0, 'a re-run must move nothing -- the item is already in its resolved channel folder');
  assert.equal(second.errors, 0);
  assert.ok(second.skipped >= 1);

  const dbAfter = readDb();
  assert.ok(dbAfter.metadata[newId], 'the new (path-derived) id must be present after both runs');
  assert.ok(!dbAfter.metadata[oldId], 'the old id must not be resurrected');
});

test('a same-basename collision loser is skipped/counted separately (not `errors`) and does not error-log on repeat boots, without clobbering the winner', async () => {
  const config = ytdlp.parseYtdlpConfig();

  // Two flat one-offs, same basename, same captured channel -> the same
  // resolved target. Winner: directly in the download root. Loser: in the
  // legacy 'One-Off' folder. Object key insertion order below drives the
  // processing order (winner first).
  const winnerPath = path.join(downloadDir, 'clash.mp4');
  fs.writeFileSync(winnerPath, 'winner-bytes');
  const winnerId = getMediaId(winnerPath);

  const legacyFlatDir = path.join(downloadDir, 'One-Off');
  fs.mkdirSync(legacyFlatDir, { recursive: true });
  const loserPath = path.join(legacyFlatDir, 'clash.mp4');
  fs.writeFileSync(loserPath, 'loser-bytes');
  const loserId = getMediaId(loserPath);

  const targetDir = ytdlpArgs.resolveChannelDir(config, { name: 'Collision Channel' });
  const targetPath = path.join(targetDir, 'clash.mp4');

  saveDatabase({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [winnerId]: {
        id: winnerId, name: 'clash.mp4', title: 'clash', filePath: winnerPath,
        folderName: path.basename(downloadDir), size: 12, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
        channelName: 'Collision Channel',
      },
      [loserId]: {
        id: loserId, name: 'clash.mp4', title: 'clash', filePath: loserPath,
        folderName: path.basename(legacyFlatDir), size: 11, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
        channelName: 'Collision Channel',
      },
    },
    settings: baseSettings(),
  });

  const errorCalls = [];
  const warnCalls = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args) => errorCalls.push(args);
  console.warn = (...args) => warnCalls.push(args);
  let first;
  let second;
  try {
    first = await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, config);
    // A "second boot": the loser is still flat and still mismatched, so it
    // is picked up again -- this is the "every boot forever" repro.
    second = await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, config);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }

  assert.equal(first.moved, 1, 'the winner must move');
  assert.equal(first.collisions, 1, 'the loser must be counted as a collision, not an error');
  assert.equal(first.errors, 0, 'a same-basename collision must never increment `errors`');
  assert.ok(fs.existsSync(targetPath), 'the winner must land at the resolved target');
  assert.ok(fs.existsSync(loserPath), 'the loser must stay exactly where it was -- no clobber');

  assert.equal(second.moved, 0, 'the winner is already correctly foldered on the second run');
  assert.equal(second.collisions, 1, 'the loser collides again on every re-run');
  assert.equal(second.errors, 0);

  assert.equal(errorCalls.length, 0, 'a same-basename collision must never be logged at error level, on any run');
  assert.ok(warnCalls.length >= 2, 'the collision is still observable, just not at error level, on every run');

  // Never clobbered: the winner's original bytes are what's at the target.
  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'winner-bytes');
  assert.equal(fs.readFileSync(loserPath, 'utf8'), 'loser-bytes');
});
