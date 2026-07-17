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

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  getMediaId, loadDatabase, saveDatabase, updateDatabase, recordRepulledItemMeta, enumerateRepullableItems,
} = require('../../server');
const { readPersistedDatabase } = require('../../lib/db/sqlite');
const ytdlp = require('../../lib/ytdlp');

// v1.42: persisted-state assertions go through the sanctioned SQLite read
// helper (a second, read-only connection). An EMPTY doc_kv namespace persists
// as zero rows (absent); backfill the ones this file dereferences so
// `dbAfter.progress[id]`-style reads stay valid.
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

  const dbAfter = readDb();
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

  const dbAfter = readDb();
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

  const dbAfter = readDb();
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

  const dbAfter = readDb();
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

  const dbAfter = readDb();
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

  const dbAfter = readDb();
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

  const before = readDb();
  const result = await recordRepulledItemMeta(
    { loadDatabase, updateDatabase, getMediaId },
    'deadbeef00112233445566778899aabb',
    { releaseDate: 123, channelAvatarUrl: 'https://example.com/x.jpg', filePath: '/nonexistent/path.mp4' },
  );
  assert.equal(result, false);
  const after = readDb();
  assert.deepStrictEqual(after, before, 'a missing mediaId must never write to disk');
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

  const dbAfter = readDb();
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

// v1.33 T1: a bracket-less (MeTube-style) import is now ELIGIBLE -- it flows
// through with null videoId/watchUrl so the batch worker's LOCAL ffprobe
// tags pass still runs on it (the only shot such a file gets at an embedded
// purl/date/title); only the NETWORK pass is gated on a watch URL.
test('enumerateRepullableItems: a non-id-suffixed (MeTube-style) item is eligible with null videoId/watchUrl (local-pass only)', () => {
  const config = ytdlp.parseYtdlpConfig();
  const filePath = path.join(downloadDir, 'Plain Imported Video.mp4');
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
  assert.equal(result.items[0].videoId, null, 'no bracket and no persisted youtubeId -> null videoId');
  assert.equal(result.items[0].watchUrl, null, 'no videoId -> no watch URL (network pass will be skipped)');
});

// v1.33 T1: a bracket-less item whose scan/reheat previously persisted a
// `youtubeId` (e.g. from an embedded purl tag) gets a real videoId/watchUrl
// off that persisted field -- re-validated through isSafeVideoId.
test('enumerateRepullableItems: a bracket-less item with a persisted youtubeId is eligible with that id (garbage youtubeId ignored)', () => {
  const config = ytdlp.parseYtdlpConfig();
  const goodPath = path.join(downloadDir, 'Metube Import.mp4');
  const goodId = getMediaId(goodPath);
  const badPath = path.join(downloadDir, 'Corrupt Field.mp4');
  const badId = getMediaId(badPath);
  const db = {
    metadata: {
      [goodId]: { id: goodId, filePath: goodPath, name: path.basename(goodPath), ext: '.mp4', youtubeId: 'dQw4w9WgXcQ' },
      [badId]: { id: badId, filePath: badPath, name: path.basename(badPath), ext: '.mp4', youtubeId: 'not a real id!!' },
    },
  };

  const result = enumerateRepullableItems(db, config);
  assert.equal(result.eligible, 2, 'both stay eligible (the local pass runs regardless)');
  const byId = Object.fromEntries(result.items.map((it) => [it.mediaId, it]));
  assert.equal(byId[goodId].videoId, 'dQw4w9WgXcQ');
  assert.equal(byId[goodId].watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(byId[badId].videoId, null, 'a persisted youtubeId failing isSafeVideoId is never used');
  assert.equal(byId[badId].watchUrl, null);
});

// v1.41.5 (MeTube-import hydration): the gate is ROOT-AGNOSTIC now -- an
// outside-root item is enumerated -- but its filename BRACKET is still never
// trusted out there (an ordinary library file can innocently carry an 11-char
// bracket, e.g. `Vacation [Holiday2024].mp4`). So it flows through with a
// null videoId: local tag check only, NO network call.
test('enumerateRepullableItems: an id-suffixed item OUTSIDE the download root is eligible but its bracket is NOT trusted (null videoId -> no network pass)', () => {
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
    assert.equal(result.eligible, 1, 'root-agnostic: the item IS enumerated (for the local, network-free tags pass)');
    assert.equal(result.ineligible, 0);
    assert.equal(result.items[0].videoId, null, 'a bracket outside the download root must never be trusted as a video id');
    assert.equal(result.items[0].watchUrl, null, 'no videoId -> no watch URL -> the batch never spawns a network pass for it');
    assert.equal(result.withSourceId, 0, 'nothing here goes to the network');
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});

// v1.41.5: THE case Dean actually has -- a MeTube-downloaded file sitting in a
// NORMAL library root (never FileTube's download dir), with no `[id]` bracket
// but with the source YouTube URL in its embedded tags, which the scan already
// persisted as `item.youtubeId` (deriveScanYoutubeId is root-agnostic through
// that tag). It must be eligible WITH a real watch URL -- that is what lets the
// batch fetch its channel identity.
test('enumerateRepullableItems: an OUTSIDE-root item with a persisted youtubeId (a MeTube import) is eligible with a real watchUrl', () => {
  const config = ytdlp.parseYtdlpConfig();
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-metube-'));
  try {
    const filePath = path.join(libDir, 'Some MeTube Song.mp3');
    const id = getMediaId(filePath);
    const homeVideoPath = path.join(libDir, 'Family BBQ.mp4');
    const homeVideoId = getMediaId(homeVideoPath);
    const db = {
      metadata: {
        [id]: { id, filePath, name: path.basename(filePath), ext: '.mp3', youtubeId: 'dQw4w9WgXcQ' },
        // A genuine home video: probed once, no embedded source URL found.
        [homeVideoId]: { id: homeVideoId, filePath: homeVideoPath, name: path.basename(homeVideoPath), ext: '.mp4', youtubeId: null },
      },
    };

    const result = enumerateRepullableItems(db, config);
    assert.equal(result.eligible, 2);
    assert.equal(result.ineligible, 0);
    assert.equal(result.withSourceId, 1, 'ONLY the MeTube import has a source id -- the home video never reaches the network');

    const byId = Object.fromEntries(result.items.map((it) => [it.mediaId, it]));
    assert.equal(byId[id].videoId, 'dQw4w9WgXcQ', 'the embedded-tag-derived id is trusted from ANY root');
    assert.equal(byId[id].watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(byId[homeVideoId].videoId, null, 'a tagless home video yields no id -- local pass only, never a network call');
    assert.equal(byId[homeVideoId].watchUrl, null);
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
    // v1.33 T1: the bracket-less item is eligible (local-pass-only, null
    // videoId). v1.41.5: so is the outside-root one -- but with a null videoId,
    // because its bracket is not trusted out there. `withSourceId` is what
    // separates the two network-bound items from the two local-only ones.
    assert.equal(result.eligible, 4);
    assert.equal(result.ineligible, 0);
    assert.equal(result.withSourceId, 2, 'only the two IN-ROOT id-suffixed items reach the network');

    const byId = Object.fromEntries(result.items.map((it) => [it.mediaId, it]));
    assert.ok(byId[eligibleId]);
    assert.equal(byId[eligibleId].alreadyRepulled, false);
    assert.ok(byId[alreadyDoneId]);
    assert.equal(byId[alreadyDoneId].alreadyRepulled, true, 'an item with metadataRepulledAt must be flagged as already-done');
    assert.ok(byId[noSuffixId], 'the non-suffixed item now appears (local-pass eligible)');
    assert.equal(byId[noSuffixId].videoId, null);
    assert.equal(byId[noSuffixId].watchUrl, null);
    assert.ok(byId[outsideId], 'v1.41.5: the outside-root item is enumerated too');
    assert.equal(byId[outsideId].videoId, null, 'but with no trusted id -- local pass only');
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});

// An item with no filePath at all is the ONLY thing that stays structurally
// ineligible now (v1.41.5) -- there is nothing to probe and nothing to key on.
test('enumerateRepullableItems: an item with no usable filePath is ineligible', () => {
  const config = ytdlp.parseYtdlpConfig();
  const db = {
    metadata: {
      broken1: { id: 'broken1', name: 'x.mp4', ext: '.mp4' },
      broken2: { id: 'broken2', filePath: '', name: 'y.mp4', ext: '.mp4' },
    },
  };

  const result = enumerateRepullableItems(db, config);
  assert.equal(result.eligible, 0);
  assert.equal(result.ineligible, 2);
  assert.equal(result.items.length, 0);
});

// v1.41.5: with NO download root configured at all, the old gate declared the
// whole library ineligible and the reheat could do nothing. Now the items still
// flow through for their local tags pass -- and a bracket, with no root to
// anchor it, is still never trusted (no network call).
test('enumerateRepullableItems: with no download root configured, items are still enumerated (local pass) but no bracket is trusted', () => {
  delete process.env.FILETUBE_YTDLP_ENABLED; // override beforeEach's 'true'
  fs.rmSync(downloadDir, { recursive: true, force: true }); // dir now absent too
  const config = ytdlp.parseYtdlpConfig();
  assert.equal(ytdlp.isEnabled(config), false, 'sanity: the module must be disabled for this test');

  const filePath = path.join(downloadDir, 'Bracketed But Rootless [wbe12345678].mp4');
  const id = getMediaId(filePath);
  const taggedPath = path.join(downloadDir, 'Tagged Import.mp4');
  const taggedId = getMediaId(taggedPath);
  const db = {
    metadata: {
      [id]: { id, filePath, name: path.basename(filePath), ext: '.mp4' },
      [taggedId]: { id: taggedId, filePath: taggedPath, name: path.basename(taggedPath), ext: '.mp4', youtubeId: 'dQw4w9WgXcQ' },
    },
  };

  const result = enumerateRepullableItems(db, config);
  assert.equal(result.eligible, 2, 'no early "everything is ineligible" return any more');
  assert.equal(result.ineligible, 0);
  assert.equal(result.withSourceId, 1, 'only the persisted-youtubeId item can reach the network');
  const byId = Object.fromEntries(result.items.map((it) => [it.mediaId, it]));
  assert.equal(byId[id].videoId, null, 'with no download root, a filename bracket is never trusted');
  assert.equal(byId[taggedId].videoId, 'dQw4w9WgXcQ');

  // Re-create so afterEach's rmSync doesn't error on an already-gone dir.
  fs.mkdirSync(downloadDir, { recursive: true });
});

// ---- v1.33 T1/T3: sourceTitle + youtubeId persistence -----------------------

test('recordRepulledItemMeta persists a sanitized sourceTitle (emoji intact) and updates the display title with it', async () => {
  const filePath = path.join(downloadDir, 'Underscore_Folded_Name [ttl12345678].mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const id = getMediaId(filePath);

  writeDb({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: 'Underscore Folded Name', filePath,
        folderName: path.basename(downloadDir), size: 11, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 300, hasThumbnail: false, artist: '',
      },
    },
    settings: baseSettings(),
  });

  const result = await recordRepulledItemMeta(
    { loadDatabase, updateDatabase, getMediaId },
    id,
    { filePath, sourceTitle: '  Real Title 🎵 With\x00 Emoji  ', youtubeId: 'ttl12345678', markComplete: true },
  );
  assert.equal(result, true);

  const item = readDb().metadata[id];
  assert.equal(item.sourceTitle, 'Real Title 🎵 With Emoji', 'control chars stripped + trimmed, emoji SURVIVE (sanitizeCapturedTitle)');
  assert.equal(item.title, 'Real Title 🎵 With Emoji', 'the display title is superseded by the real title');
  assert.equal(item.youtubeId, 'ttl12345678');
});

test('recordRepulledItemMeta rejects an unsafe youtubeId and an empty-after-sanitize sourceTitle -- prior values untouched', async () => {
  const filePath = path.join(downloadDir, 'Guarded Video [grd12345678].mp4');
  fs.writeFileSync(filePath, 'video-bytes');
  const id = getMediaId(filePath);

  writeDb({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: 'Guarded Video', filePath,
        folderName: path.basename(downloadDir), size: 11, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 300, hasThumbnail: false, artist: '',
        youtubeId: 'grd12345678', sourceTitle: 'Existing Good Title',
      },
    },
    settings: baseSettings(),
  });

  await recordRepulledItemMeta(
    { loadDatabase, updateDatabase, getMediaId },
    id,
    { filePath, sourceTitle: '\x00\x1f  ', youtubeId: 'not-an-id-at-all!!' },
  );

  const item = readDb().metadata[id];
  assert.equal(item.youtubeId, 'grd12345678', 'an isSafeVideoId-failing value must never overwrite a good one');
  assert.equal(item.sourceTitle, 'Existing Good Title', 'an empty-after-sanitize title must never clobber a good one');
  assert.equal(item.title, 'Guarded Video', 'the display title stays untouched too');
});

// ---- v1.41.5: CHANNEL IDENTITY hydration (Dean's MeTube imports) -----------
//
// The whole point of the widened reheat: an imported file that showed a
// generic folder-name "channel" gets the REAL creator written onto it
// (channelName -> the card/watch-page label via resolveChannelName;
// channelUrl -> the Subscribe button via deriveChannelIdentity, both
// public/js/common.js). Identity is gap-fill ONLY (the AC17 never-overwrite
// posture the scan's folder backfill already uses) -- unlike title/releaseDate,
// which a reheat deliberately supersedes.

function importedItemDb(filePath, id, extra = {}) {
  return {
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: path.basename(filePath, path.extname(filePath)), filePath,
        folderName: 'MeTube Downloads', size: 11, ext: path.extname(filePath), type: 'video',
        addedAt: Date.now(), duration: 300, hasThumbnail: false, artist: '',
        youtubeId: 'dQw4w9WgXcQ',
        ...extra,
      },
    },
    settings: baseSettings(),
  };
}

const HYDRATED_CHANNEL = {
  channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
  channelHandleUrl: 'https://www.youtube.com/@RickAstley',
  channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
  channelName: 'Rick Astley',
};

test('recordRepulledItemMeta hydrates an identity-less (MeTube-imported) item with channelUrl/channelHandleUrl/channelId/channelName + the probed avatar', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-hydrate-'));
  try {
    const filePath = path.join(libDir, 'Never Gonna Give You Up.mp4');
    fs.writeFileSync(filePath, 'video-bytes');
    const id = getMediaId(filePath);
    writeDb(importedItemDb(filePath, id));

    const ok = await recordRepulledItemMeta(
      { loadDatabase, updateDatabase, getMediaId },
      id,
      {
        filePath,
        channel: { ...HYDRATED_CHANNEL },
        channelAvatarUrl: 'https://yt3.googleusercontent.com/avatar.jpg',
        markComplete: true,
      },
    );
    assert.equal(ok, true);

    const item = readDb().metadata[id];
    assert.equal(item.channelUrl, HYDRATED_CHANNEL.channelUrl, 'the Subscribe button needs channelUrl (deriveChannelIdentity)');
    assert.equal(item.channelHandleUrl, HYDRATED_CHANNEL.channelHandleUrl);
    assert.equal(item.channelId, HYDRATED_CHANNEL.channelId);
    assert.equal(item.channelName, 'Rick Astley', 'the real creator name replaces the generic folder label (resolveChannelName)');
    assert.equal(item.channelAvatarUrl, 'https://yt3.googleusercontent.com/avatar.jpg', 'the once-dead channelAvatarUrl branch is live again');
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});

test('(NEVER-OVERWRITE, AC17) recordRepulledItemMeta never re-points an item that ALREADY has a channelUrl at a different channel', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-noclobber-'));
  try {
    const filePath = path.join(libDir, 'Already Attributed.mp4');
    fs.writeFileSync(filePath, 'video-bytes');
    const id = getMediaId(filePath);
    writeDb(importedItemDb(filePath, id, {
      channelUrl: 'https://www.youtube.com/@OriginalChannel',
      channelId: 'UC0000000000000000000000',
      channelName: 'Original Channel',
    }));

    await recordRepulledItemMeta(
      { loadDatabase, updateDatabase, getMediaId },
      id,
      { filePath, channel: { ...HYDRATED_CHANNEL }, markComplete: true },
    );

    const item = readDb().metadata[id];
    assert.equal(item.channelUrl, 'https://www.youtube.com/@OriginalChannel', 'an existing channelUrl is NEVER overwritten by a reheat');
    assert.equal(item.channelId, 'UC0000000000000000000000');
    assert.equal(item.channelName, 'Original Channel');
    assert.equal(item.channelHandleUrl, undefined, 'nor is a DIFFERENT channel\'s handle stapled onto it');
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});

test('(NEVER-OVERWRITE, AC17) an item already attributed to the SAME channel gets its genuine GAPS filled (id/name/handle), and nothing else touched', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-gapfill-'));
  try {
    const filePath = path.join(libDir, 'Partially Attributed.mp4');
    fs.writeFileSync(filePath, 'video-bytes');
    const id = getMediaId(filePath);
    writeDb(importedItemDb(filePath, id, {
      channelUrl: HYDRATED_CHANNEL.channelUrl, // same channel, but no id/name yet
      channelName: 'Stale But Mine',
    }));

    await recordRepulledItemMeta(
      { loadDatabase, updateDatabase, getMediaId },
      id,
      { filePath, channel: { ...HYDRATED_CHANNEL }, markComplete: true },
    );

    const item = readDb().metadata[id];
    assert.equal(item.channelId, HYDRATED_CHANNEL.channelId, 'a genuine gap on the SAME channel is filled');
    assert.equal(item.channelHandleUrl, HYDRATED_CHANNEL.channelHandleUrl);
    assert.equal(item.channelName, 'Stale But Mine', 'an EXISTING name is still never overwritten (gap-fill, not refresh)');
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});

test('recordRepulledItemMeta: an absent meta.channel leaves an item\'s identity completely untouched', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-nochannel-'));
  try {
    const filePath = path.join(libDir, 'No Channel Discovered.mp4');
    fs.writeFileSync(filePath, 'video-bytes');
    const id = getMediaId(filePath);
    writeDb(importedItemDb(filePath, id));

    await recordRepulledItemMeta(
      { loadDatabase, updateDatabase, getMediaId },
      id,
      { filePath, releaseDate: 1_700_000_000_000, markComplete: true },
    );

    const item = readDb().metadata[id];
    assert.equal(item.channelUrl, undefined);
    assert.equal(item.channelName, undefined);
    assert.equal(item.releaseDate, 1_700_000_000_000, 'the rest of the re-pull still lands');
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});

test('recordRepulledItemMeta: a malformed meta.channel (no channelUrl) is inert -- no partial identity is ever written', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-malformed-'));
  try {
    const filePath = path.join(libDir, 'Malformed Channel.mp4');
    fs.writeFileSync(filePath, 'video-bytes');
    const id = getMediaId(filePath);
    writeDb(importedItemDb(filePath, id));

    for (const bad of [null, {}, { channelUrl: '' }, { channelName: 'Name Only' }, 'nonsense']) {
      await recordRepulledItemMeta(
        { loadDatabase, updateDatabase, getMediaId },
        id,
        { filePath, channel: bad },
      );
      const item = readDb().metadata[id];
      assert.equal(item.channelUrl, undefined, `channel=${JSON.stringify(bad)} must write no channelUrl`);
      assert.equal(item.channelName, undefined, `channel=${JSON.stringify(bad)} must never write a name without a URL (no half-formed identity)`);
    }
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});

// GATE FIX (adversarial WARNING): the avatar used to be written UNCONDITIONALLY,
// above the never-overwrite guard -- so an item the guard correctly DECLINED to
// re-point still got the other channel's face. Channel A's name over channel
// B's avatar on the watch page.
test('(NEVER-OVERWRITE) an item attributed to a DIFFERENT channel is not given the discovered channel\'s AVATAR either', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-avatar-guard-'));
  try {
    const filePath = path.join(libDir, 'Other Channel.mp4');
    fs.writeFileSync(filePath, 'video-bytes');
    const id = getMediaId(filePath);
    writeDb(importedItemDb(filePath, id, {
      channelUrl: 'https://www.youtube.com/@OriginalChannel',
      channelId: 'UC0000000000000000000000',
      channelName: 'Original Channel',
      channelAvatarUrl: 'https://yt3.googleusercontent.com/original.jpg',
    }));

    await recordRepulledItemMeta(
      { loadDatabase, updateDatabase, getMediaId },
      id,
      { filePath, channel: { ...HYDRATED_CHANNEL }, channelAvatarUrl: 'https://yt3.googleusercontent.com/rick.jpg', markComplete: true },
    );

    const item = readDb().metadata[id];
    assert.equal(item.channelUrl, 'https://www.youtube.com/@OriginalChannel');
    assert.equal(item.channelAvatarUrl, 'https://yt3.googleusercontent.com/original.jpg',
      'a declined identity must never leave its AVATAR behind (channel A\'s name over channel B\'s face)');
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});

// GATE FIX (adversarial SUGGESTION): yt-dlp returns the CANONICAL `/channel/UC…`
// url, while a folder-backfilled item carries the subscription's HANDLE url
// (`/@name`). A bare string compare would have declined the gap-fill branch's
// own headline use case. Same-channel is decided by channelId when both sides
// know one.
test('(SAME-CHANNEL by channelId) a folder-backfilled item carrying the HANDLE url still gets its gaps filled from the canonical /channel/UC… discovery', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-handle-'));
  try {
    const filePath = path.join(libDir, 'Handle Url Item.mp4');
    fs.writeFileSync(filePath, 'video-bytes');
    const id = getMediaId(filePath);
    writeDb(importedItemDb(filePath, id, {
      channelUrl: 'https://www.youtube.com/@RickAstley', // the HANDLE form
      channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',             // ...but the SAME channel
    }));

    await recordRepulledItemMeta(
      { loadDatabase, updateDatabase, getMediaId },
      id,
      { filePath, channel: { ...HYDRATED_CHANNEL }, channelAvatarUrl: 'https://yt3.googleusercontent.com/rick.jpg', markComplete: true },
    );

    const item = readDb().metadata[id];
    assert.equal(item.channelName, 'Rick Astley', 'the missing name is filled -- the two URLs are different FORMS of one channel');
    assert.equal(item.channelHandleUrl, HYDRATED_CHANNEL.channelHandleUrl);
    assert.equal(item.channelAvatarUrl, 'https://yt3.googleusercontent.com/rick.jpg', 'and its avatar is genuinely this item\'s own');
    assert.equal(item.channelUrl, 'https://www.youtube.com/@RickAstley', 'the existing URL is never rewritten (gap-fill, not normalize)');
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});

test('(SAME-CHANNEL by channelId) a DIFFERENT channelId is still declined even when... the urls happen to differ too', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-diffid-'));
  try {
    const filePath = path.join(libDir, 'Different Id.mp4');
    fs.writeFileSync(filePath, 'video-bytes');
    const id = getMediaId(filePath);
    writeDb(importedItemDb(filePath, id, {
      channelUrl: 'https://www.youtube.com/@SomeoneElse',
      channelId: 'UC9999999999999999999999',
    }));

    await recordRepulledItemMeta(
      { loadDatabase, updateDatabase, getMediaId },
      id,
      { filePath, channel: { ...HYDRATED_CHANNEL }, channelAvatarUrl: 'https://yt3.googleusercontent.com/rick.jpg', markComplete: true },
    );

    const item = readDb().metadata[id];
    assert.equal(item.channelId, 'UC9999999999999999999999');
    assert.equal(item.channelName, undefined, 'a different channel never lends its name');
    assert.equal(item.channelAvatarUrl, undefined, 'nor its avatar');
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});

test('an item with NO channel identity at all still accepts an avatar (the pre-existing item-scoped contract)', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-avatar-only-'));
  try {
    const filePath = path.join(libDir, 'Avatar Only.mp4');
    fs.writeFileSync(filePath, 'video-bytes');
    const id = getMediaId(filePath);
    writeDb(importedItemDb(filePath, id));

    await recordRepulledItemMeta(
      { loadDatabase, updateDatabase, getMediaId },
      id,
      { filePath, channelAvatarUrl: 'https://yt3.googleusercontent.com/solo.jpg', markComplete: true },
    );

    const item = readDb().metadata[id];
    assert.equal(item.channelAvatarUrl, 'https://yt3.googleusercontent.com/solo.jpg');
  } finally {
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});
