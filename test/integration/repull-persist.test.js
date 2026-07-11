'use strict';

// [INTEGRATION] Metadata+subtitle re-pull backfill -- SERVER-SIDE PERSISTENCE
// MUTATOR half only (the enumeration eligibility gate, `enumerateRepullableItems`,
// and the deps-injected `db.metadata` writer, `recordRepulledItemMeta`). The
// actual network re-pull job (lib/ytdlp) and its route wiring are OWNED BY
// OTHER TASKS -- this file locks only the persistence contract: `updateDatabase`
// is the single serialized writer, a re-pull NEVER re-keys the item (the id is
// path-derived and no file ever moves here), and `db.progress`/thumbnail/
// transcode bindings survive byte-identical. Mirrors
// test/integration/migrate-oneoffs.test.js's isolation pattern (own DATA_DIR,
// own process per file via `node --test`).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-persist-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  getMediaId, loadDatabase, saveDatabase, updateDatabase, recordRepulledItemMeta, enumerateRepullableItems,
} = require('../../server');
const ytdlp = require('../../lib/ytdlp');

function baseSettings() {
  return { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, defaultView: '', autoplayNext: false };
}

// v1.30 A3 (in-memory DB read cache): seed via the exported `saveDatabase()`
// (an established test primitive, see CONTRIBUTING.md) rather than a raw
// `fs.writeFileSync`, so the in-process db cache stays coherent.
function writeDb(db) {
  saveDatabase(db);
}

let downloadDir;

beforeEach(() => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-dl-'));
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
});

afterEach(() => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

// ---- recordRepulledItemMeta -----------------------------------------------

test('recordRepulledItemMeta sets releaseDate (superseding a prior weaker value), channelAvatarUrl, hasSubtitles, and metadataRepulledAt on the SAME id -- progress and thumbnail binding survive byte-identical (NO re-key)', async () => {
  const filePath = path.join(downloadDir, 'Some Video [abc12345678].mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const id = getMediaId(filePath);
  const progressEntry = { timestamp: 42, duration: 300, updatedAt: '2026-07-01T00:00:00.000Z' };

  writeDb({
    folders: [],
    folderSettings: {},
    progress: { [id]: progressEntry },
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: 'Some Video', filePath,
        folderName: path.basename(downloadDir), size: 11, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 300, hasThumbnail: false, artist: '',
        releaseDate: 1000, // weaker/stale mtime-derived value -- must be SUPERSEDED
        transcodeStatus: 'ready', // an id-keyed binding that must survive untouched
      },
    },
    settings: baseSettings(),
  });

  // No sidecar on disk yet -- hasSubtitles must land false.
  const nowMs = 1_800_000_000_000;
  const result = await recordRepulledItemMeta(
    { loadDatabase, updateDatabase, getMediaId },
    id,
    { releaseDate: 1_700_000_000_000, channelAvatarUrl: 'https://example.com/avatar.jpg', filePath, markComplete: true },
    nowMs,
  );
  assert.equal(result, true);

  const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const item = dbAfter.metadata[id];
  assert.equal(item.releaseDate, 1_700_000_000_000, 'releaseDate must be SUPERSEDED, not gap-filled');
  assert.equal(item.channelAvatarUrl, 'https://example.com/avatar.jpg');
  assert.equal(item.hasSubtitles, false, 'no sidecar on disk -- hasSubtitles must be false');
  assert.equal(item.metadataRepulledAt, nowMs);
  assert.equal(item.transcodeStatus, 'ready', 'an unrelated id-keyed field must survive untouched');

  // NO re-key: id is byte-identical, and the progress entry under that same
  // id is byte-identical before and after.
  assert.ok(dbAfter.metadata[id], 'the SAME mediaId must still be present');
  assert.deepStrictEqual(dbAfter.progress[id], progressEntry, 'db.progress[mediaId] must survive byte-identical');
  assert.equal(Object.keys(dbAfter.metadata).length, 1, 'no duplicate/ghost entry from a re-key');
});

test('recordRepulledItemMeta detects hasSubtitles=true when a sidecar exists on disk', async () => {
  const filePath = path.join(downloadDir, 'Captioned Video [cap12345678].mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  fs.writeFileSync(path.join(downloadDir, 'Captioned Video [cap12345678].en.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n');
  const id = getMediaId(filePath);

  writeDb({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: 'Captioned Video', filePath,
        folderName: path.basename(downloadDir), size: 11, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 300, hasThumbnail: false, artist: '',
        hasSubtitles: false,
      },
    },
    settings: baseSettings(),
  });

  const result = await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, id, { filePath });
  assert.equal(result, true);

  const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(dbAfter.metadata[id].hasSubtitles, true, 'a sidecar written by the subs pass must be detected immediately');
});

test('a missing releaseDate/channelAvatarUrl in meta leaves those fields untouched (partial update)', async () => {
  const filePath = path.join(downloadDir, 'Partial Video [par12345678].mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const id = getMediaId(filePath);

  writeDb({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: 'Partial Video', filePath,
        folderName: path.basename(downloadDir), size: 11, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 300, hasThumbnail: false, artist: '',
        releaseDate: 555,
        channelAvatarUrl: 'https://example.com/existing-avatar.jpg',
      },
    },
    settings: baseSettings(),
  });

  const result = await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, id, { filePath, markComplete: true });
  assert.equal(result, true);

  const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const item = dbAfter.metadata[id];
  assert.equal(item.releaseDate, 555, 'an absent meta.releaseDate must leave the existing value untouched');
  assert.equal(item.channelAvatarUrl, 'https://example.com/existing-avatar.jpg', 'an absent meta.channelAvatarUrl must leave the existing value untouched');
  assert.ok(item.metadataRepulledAt, 'the idempotency marker is still set on a partial update WHEN markComplete is true');
});

// ---- markComplete gating (F1: a transient subs-spawn failure must never ----
// permanently mark an item "done" -- see recordRepulledItemMeta's own doc
// comment in server.js).

test('recordRepulledItemMeta with markComplete:false updates releaseDate/channelAvatarUrl/hasSubtitles but does NOT set metadataRepulledAt -- the item stays retryable', async () => {
  const filePath = path.join(downloadDir, 'Retryable Video [ret12345678].mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const id = getMediaId(filePath);

  writeDb({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: 'Retryable Video', filePath,
        folderName: path.basename(downloadDir), size: 11, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 300, hasThumbnail: false, artist: '',
      },
    },
    settings: baseSettings(),
  });

  const result = await recordRepulledItemMeta(
    { loadDatabase, updateDatabase, getMediaId },
    id,
    { releaseDate: 1_700_000_000_000, channelAvatarUrl: 'https://example.com/avatar.jpg', filePath, markComplete: false },
  );
  assert.equal(result, true, 'the mutator still writes the metadata fields -- only the marker is withheld');

  const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const item = dbAfter.metadata[id];
  assert.equal(item.releaseDate, 1_700_000_000_000, 'releaseDate must still be persisted even when markComplete is false');
  assert.equal(item.channelAvatarUrl, 'https://example.com/avatar.jpg', 'channelAvatarUrl must still be persisted even when markComplete is false');
  assert.equal(item.hasSubtitles, false, 'hasSubtitles must still be recomputed even when markComplete is false');
  assert.equal(item.metadataRepulledAt, undefined, 'metadataRepulledAt must NOT be set when markComplete is false -- the item stays retryable on the next reheat');
});

test('recordRepulledItemMeta with markComplete absent (not passed) behaves the same as markComplete:false -- no marker written', async () => {
  const filePath = path.join(downloadDir, 'Absent Marker Video [abs12345678].mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const id = getMediaId(filePath);

  writeDb({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: 'Absent Marker Video', filePath,
        folderName: path.basename(downloadDir), size: 11, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 300, hasThumbnail: false, artist: '',
      },
    },
    settings: baseSettings(),
  });

  const result = await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, id, { filePath });
  assert.equal(result, true);

  const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(dbAfter.metadata[id].metadataRepulledAt, undefined, 'an absent markComplete must default to NOT writing the marker (the same safe default as false)');
});

test('recordRepulledItemMeta with markComplete:false never CLEARS an existing metadataRepulledAt from a prior completed run', async () => {
  const filePath = path.join(downloadDir, 'Previously Done Video [pre12345678].mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const id = getMediaId(filePath);
  const priorMarker = 1_600_000_000_000;

  writeDb({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: 'Previously Done Video', filePath,
        folderName: path.basename(downloadDir), size: 11, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 300, hasThumbnail: false, artist: '',
        metadataRepulledAt: priorMarker,
      },
    },
    settings: baseSettings(),
  });

  await recordRepulledItemMeta(
    { loadDatabase, updateDatabase, getMediaId },
    id,
    { releaseDate: 1_700_000_000_000, filePath, markComplete: false },
  );

  const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(dbAfter.metadata[id].metadataRepulledAt, priorMarker, 'a markComplete:false call must never clear/overwrite a pre-existing marker');
});

test('recordRepulledItemMeta on a non-existent mediaId is a safe no-op', async () => {
  writeDb({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {},
    settings: baseSettings(),
  });

  const before = fs.readFileSync(DB_FILE, 'utf8');
  const result = await recordRepulledItemMeta(
    { loadDatabase, updateDatabase, getMediaId },
    'deadbeef00112233445566778899aabb',
    { releaseDate: 123, channelAvatarUrl: 'https://example.com/x.jpg', filePath: '/nonexistent/path.mp4' },
  );
  assert.equal(result, false);
  const after = fs.readFileSync(DB_FILE, 'utf8');
  assert.equal(after, before, 'a missing mediaId must never write to disk');
});

test('recordRepulledItemMeta stores a known epoch-ms releaseDate exactly, with no mutation', async () => {
  const filePath = path.join(downloadDir, 'Dated Video [dat12345678].mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const id = getMediaId(filePath);
  const exactEpochMs = 1_735_689_600_000; // 2025-01-01T00:00:00.000Z

  writeDb({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: 'Dated Video', filePath,
        folderName: path.basename(downloadDir), size: 11, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 300, hasThumbnail: false, artist: '',
      },
    },
    settings: baseSettings(),
  });

  await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, id, { releaseDate: exactEpochMs, filePath });

  const dbAfter = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(dbAfter.metadata[id].releaseDate, exactEpochMs, 'the epoch-ms value must be stored exactly, byte-for-byte');
});

// ---- enumerateRepullableItems ----------------------------------------------

test('enumerateRepullableItems: an id-suffixed item under the download root is eligible with the correct watchUrl', () => {
  const config = ytdlp.parseYtdlpConfig();
  const filePath = path.join(downloadDir, 'Rick Astley - Never Gonna Give You Up [dQw4w9WgXcQ].mp4');
  const id = getMediaId(filePath);
  const db = {
    metadata: {
      [id]: { id, filePath, name: path.basename(filePath), ext: '.mp4' },
    },
  };

  const result = enumerateRepullableItems(db, config);
  assert.equal(result.eligible, 1);
  assert.equal(result.ineligible, 0);
  assert.equal(result.items.length, 1);
  const entry = result.items[0];
  assert.equal(entry.mediaId, id);
  assert.equal(entry.filePath, filePath);
  assert.equal(entry.videoId, 'dQw4w9WgXcQ');
  assert.equal(entry.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(entry.alreadyRepulled, false);
});

test('enumerateRepullableItems: a non-id-suffixed (MeTube-style) item is ineligible', () => {
  const config = ytdlp.parseYtdlpConfig();
  const filePath = path.join(downloadDir, 'Plain Imported Video.mp4');
  const id = getMediaId(filePath);
  const db = {
    metadata: {
      [id]: { id, filePath, name: path.basename(filePath), ext: '.mp4' },
    },
  };

  const result = enumerateRepullableItems(db, config);
  assert.equal(result.eligible, 0);
  assert.equal(result.ineligible, 1);
  assert.equal(result.items.length, 0);
});

test('enumerateRepullableItems: an id-suffixed item OUTSIDE the download root is ineligible', () => {
  const config = ytdlp.parseYtdlpConfig();
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-lib-'));
  try {
    const filePath = path.join(libDir, 'Some Video [abc12345678].mp4');
    const id = getMediaId(filePath);
    const db = {
      metadata: {
        [id]: { id, filePath, name: path.basename(filePath), ext: '.mp4' },
      },
    };

    const result = enumerateRepullableItems(db, config);
    assert.equal(result.eligible, 0, 'a file outside the download root must never be eligible, even if id-shaped');
    assert.equal(result.ineligible, 1);
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});

test('enumerateRepullableItems: counts are correct across a mixed set, and an already-repulled item is flagged', () => {
  const config = ytdlp.parseYtdlpConfig();
  const eligiblePath = path.join(downloadDir, 'Eligible One [eli12345678].mp4');
  const eligibleId = getMediaId(eligiblePath);
  const alreadyDonePath = path.join(downloadDir, 'Already Done [don12345678].mp4');
  const alreadyDoneId = getMediaId(alreadyDonePath);
  const noSuffixPath = path.join(downloadDir, 'No Suffix.mp4');
  const noSuffixId = getMediaId(noSuffixPath);

  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-lib2-'));
  try {
    const outsidePath = path.join(libDir, 'Outside Root [out12345678].mp4');
    const outsideId = getMediaId(outsidePath);

    const db = {
      metadata: {
        [eligibleId]: { id: eligibleId, filePath: eligiblePath, name: path.basename(eligiblePath), ext: '.mp4' },
        [alreadyDoneId]: { id: alreadyDoneId, filePath: alreadyDonePath, name: path.basename(alreadyDonePath), ext: '.mp4', metadataRepulledAt: 1_700_000_000_000 },
        [noSuffixId]: { id: noSuffixId, filePath: noSuffixPath, name: path.basename(noSuffixPath), ext: '.mp4' },
        [outsideId]: { id: outsideId, filePath: outsidePath, name: path.basename(outsidePath), ext: '.mp4' },
      },
    };

    const result = enumerateRepullableItems(db, config);
    assert.equal(result.eligible, 2);
    assert.equal(result.ineligible, 2);

    const byId = Object.fromEntries(result.items.map((it) => [it.mediaId, it]));
    assert.ok(byId[eligibleId]);
    assert.equal(byId[eligibleId].alreadyRepulled, false);
    assert.ok(byId[alreadyDoneId]);
    assert.equal(byId[alreadyDoneId].alreadyRepulled, true, 'an item with metadataRepulledAt must be flagged as already-done');
    assert.ok(!byId[noSuffixId], 'the non-suffixed item must not appear in items at all');
    assert.ok(!byId[outsideId], 'the outside-root item must not appear in items at all');
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});

test('enumerateRepullableItems: the module disabled AND the download dir absent yields zero eligible, all ineligible', () => {
  delete process.env.FILETUBE_YTDLP_ENABLED; // override beforeEach's 'true'
  fs.rmSync(downloadDir, { recursive: true, force: true }); // dir now absent too
  const config = ytdlp.parseYtdlpConfig();
  assert.equal(ytdlp.isEnabled(config), false, 'sanity: the module must be disabled for this test');

  const filePath = path.join(downloadDir, 'Would Be Eligible [wbe12345678].mp4');
  const id = getMediaId(filePath);
  const db = {
    metadata: {
      [id]: { id, filePath, name: path.basename(filePath), ext: '.mp4' },
    },
  };

  const result = enumerateRepullableItems(db, config);
  assert.equal(result.eligible, 0);
  assert.equal(result.ineligible, 1);

  // Re-create so afterEach's rmSync doesn't error on an already-gone dir.
  fs.mkdirSync(downloadDir, { recursive: true });
});
