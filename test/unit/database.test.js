'use strict';

// Fresh, isolated DATA_DIR per test file (own process). v1.42: the persisted
// store is SQLite (DATA_DIR/filetube.db) behind lib/db/sqlite.js; these tests
// exercise server.js's seam (loadDatabase/saveDatabase/updateDatabase) against
// it. Persisted-state assertions go through `readPersistedDatabase()` (the
// sanctioned helper — a second, read-only connection, never the app's own
// accounting); the between-test reset is `__resetDatabaseForTests()` (an OPEN
// SQLite database cannot be rm'd out from under its connection the way
// db.json could).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
const DB_FILE = path.join(process.env.DATA_DIR, 'db.json'); // legacy artifact — only ever written BY tests as a decoy now
const SQLITE_FILE = path.join(process.env.DATA_DIR, 'filetube.db');

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  loadDatabase,
  saveDatabase,
  settingsStore, // Wave 4: app settings are a store, not a doc key
  folderStore, folderSettingsStore, // Wave 4: the folder config too
  updateDatabase,
  transcodedPath,
  reconcileTranscode,
  cleanupOrphanDbTmp,
  __resetDatabaseForTests,
  nodeVersionSupported,
} = require('../../server');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

beforeEach(async () => {
  // Start each test from a clean slate (rows wiped, coalescers cleared,
  // read cache invalidated). Also remove any decoy db.json a prior test
  // planted.
  await __resetDatabaseForTests();
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
});

const DEFAULT_SETTINGS = {
  scanIntervalMinutes: 30,
  pruneMissing: true,
  cacheMaxBytes: null,
  cacheMaxAgeDays: 30,
  // v1.65 DELIBERATE key-set change: trash retention days; 0 = keep forever.
  // 30 by default (Dean's ruling). See server.js DEFAULT_SETTINGS.
  trashRetentionDays: 30,
  defaultView: '', // v1.14.0 item 4: '' is the "Most Recent" sentinel
  autoplayNext: false, // v1.16.0 FR-3 (T3): OFF by default
  backgroundAudioForVideo: false, // v1.27.0 (EXPERIMENTAL): OFF by default
  defaultSort: 'release-date', // v1.34: the real-YouTube-feed flip
  mobileCustomPlayer: false, // v1.34 T4: native mobile video controls by default
  preExtractAudio: false, // v1.35: deterministic background audio, OFF by default
  bgAudioSyncPosition: false, // v1.121: position pre-sync (lock-blip tuning), OFF by default
  // v1.41.6 DELIBERATE key-set change (this deep-equal is the settings-shape
  // LOCK -- adding a key here is a conscious act, not a fixup): the reheat's
  // import-relocation lever. ON by default, unlike every other boolean above,
  // because relocating a hydrated MeTube import into its channel folder IS the
  // feature -- the toggle exists to turn it OFF. See server.js DEFAULT_SETTINGS.
  relocateHydratedImports: true,
  // v1.51 DELIBERATE key-set change: the notification bell's instance-wide
  // kill switch. ON by default (the bell is the feature; the toggle is
  // Dean's explicit off-lever). See server.js DEFAULT_SETTINGS.
  notificationsEnabled: true,
  // v1.201 DELIBERATE key-set change: the "Share with AI" prompt list, ONE
  // default prompt so the action works on day one; an empty list hides it.
  // See server.js DEFAULT_SETTINGS.
  transcriptAiPrompts: [{ id: 'summarize', name: 'Summarize', text: "I'm sharing a video transcript below. Summarize the narrative and key points, then note anything notable or questionable." }],
  // v1.202 DELIBERATE key-set change: manual channel attribution is OPT-IN,
  // OFF by default (Dean: a clean-from-the-start library never needs it).
  attributeControlEnabled: false,
};

test('loadDatabase: yields a fully-defaulted db when the store is empty (no eager write needed)', () => {
  const db = loadDatabase();
  assert.equal(db.folders, undefined, 'Wave 4: folders is relational (library_folders) - no doc-model key');
  assert.equal(db.folderSettings, undefined, 'Wave 4: folderSettings is relational - no doc-model key');
  assert.deepEqual(folderStore.list(), []);
  assert.deepEqual(folderSettingsStore.getAll(), {});
  assert.deepEqual(db.metadata, {});
  assert.deepEqual(db.liked, []);
  // Wave 2: `progress` and `deleteTombstones` are NOT keys of the doc object
  // any more (media_progress / media_delete_tombstones); the save-lock
  // refuses a backfill that re-added them.
  assert.equal(db.progress, undefined, 'no doc-model progress key');
  assert.equal(db.deleteTombstones, undefined, 'no doc-model deleteTombstones key');
  // Wave 1: `viewCounts` is NOT a key of the doc object any more (it lives in
  // media_view_counts behind viewCountStore); a backfill that re-added it
  // would be refused by the save-lock on the next write.
  assert.equal(db.viewCounts, undefined, 'no doc-model viewCounts key');
  assert.equal(db.settings, undefined, 'Wave 4: settings is relational (app_settings) - no doc-model key');
  assert.deepEqual(settingsStore.get(), DEFAULT_SETTINGS, 'a fresh settings store reads the defaults');
  assert.ok(fs.existsSync(SQLITE_FILE), 'filetube.db exists from the adapter open');
  // v1.42: defaults are NOT eagerly persisted (the pre-v1.42 initial-create
  // write is subsumed by the adapter) — the first real save persists them.
  assert.deepEqual(readPersistedDatabase(process.env.DATA_DIR), {}, 'no rows until a real save');
});

test('the folder config reads from its stores (Wave 4): a root list with no settings rows reads as an empty map, never a throw', () => {
  saveDatabase({ metadata: {} });
  folderStore.replaceAll(['/x']);
  assert.deepEqual(folderSettingsStore.getAll(), {}, 'no settings rows -> an empty map');
  assert.deepEqual(folderStore.list(), ['/x']);
  assert.equal(loadDatabase().folders, undefined, 'never a doc key');
});

test('v1.42 migration-path: a corrupt db.json sitting beside an ACTIVE filetube.db is ignored, never read', () => {
  // Pre-v1.42, loadDatabase parsed db.json every call and a corrupt file
  // triggered reset-to-fresh recovery. Post-migration, db.json is a frozen
  // legacy artifact: once filetube.db exists it is never consulted, so even
  // garbage in it cannot perturb a load. (Corrupt db.json at FIRST boot —
  // before filetube.db exists — aborts the import instead; that leg lives in
  // test/unit/db-sqlite-adapter.test.js per AC9.)
  saveDatabase({ metadata: { real: { id: 'real' } } });
  fs.writeFileSync(DB_FILE, '{ this is not valid json ');
  const db = loadDatabase();
  assert.deepEqual(db.metadata, { real: { id: 'real' } }, 'load comes from SQLite; the corrupt legacy file is inert');
  assert.equal(fs.readFileSync(DB_FILE, 'utf8'), '{ this is not valid json ', 'db.json untouched');
});

test('saveDatabase + loadDatabase: round-trips data faithfully', () => {
  const original = {
    // (folders / folderSettings / folderDisplayNames: relational since Wave 4)
    metadata: { abc: { id: 'abc', title: 'Test' } },
    liked: ['abc'],
    // (progress / deleteTombstones / viewCounts are relational since Waves 1-2, settings since Wave 4 - not doc keys)
  };
  saveDatabase(original);
  assert.deepEqual(loadDatabase(), original);
  settingsStore.replaceAll(DEFAULT_SETTINGS);
  assert.deepEqual(settingsStore.get(), DEFAULT_SETTINGS, 'Wave 4: settings round-trips through its own store');
});

test('loadDatabase: a persisted set with no settings key gets all defaults, no data loss', () => {
  saveDatabase({
    metadata: { abc: { id: 'abc', title: 'Test' } },
  });
  const db = loadDatabase();
  assert.equal(db.settings, undefined, 'Wave 4: not a doc key');
  assert.deepEqual(settingsStore.get(), DEFAULT_SETTINGS, 'all settings defaulted (from the store)');
  assert.deepEqual(db.metadata, { abc: { id: 'abc', title: 'Test' } }, 'metadata preserved');
});

test('loadDatabase: defaults pruneMissing to true and scanIntervalMinutes to 30', () => {
  saveDatabase({ metadata: {} });
  assert.equal(settingsStore.getKey('pruneMissing'), true);
  assert.equal(settingsStore.getKey('scanIntervalMinutes'), 30);
});

test('loadDatabase: a partial settings object keeps its set keys and fills the rest', () => {
  saveDatabase({ metadata: {} });
  settingsStore.replaceAll({ cacheMaxAgeDays: 7 }); // Wave 4: one row
  const s = settingsStore.get();
  assert.equal(s.cacheMaxAgeDays, 7, 'explicitly-set key is preserved');
  assert.equal(s.scanIntervalMinutes, 30, 'unset key defaulted');
  assert.equal(s.pruneMissing, true, 'unset key defaulted');
  assert.equal(s.cacheMaxBytes, null, 'unset key defaulted');
});

test('saveDatabase + loadDatabase: a metadata lastServedAt survives a round-trip', () => {
  const original = {
    metadata: { abc: { id: 'abc', title: 'Test', lastServedAt: 1735689600000 } },
  };
  saveDatabase(original);
  const db = loadDatabase();
  assert.equal(db.metadata.abc.lastServedAt, 1735689600000, 'lastServedAt is preserved unchanged');
});

// ---- [UNIT] Atomic write: saveDatabase is ONE SQLite transaction ----------

// The persisted shape drops EMPTY doc_kv namespaces (zero rows — the
// documented AC1 normalization; loadDatabase's backfills restore them), so
// persisted-state deep-equals compare against this transform of the input.
function persistedShape(db) {
  const out = {};
  for (const [key, value] of Object.entries(db)) {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === 0
      && ['metadata', 'progress', 'deleteTombstones'].includes(key)) continue;
    out[key] = value;
  }
  return out;
}

test('saveDatabase: a successful save persists the complete state (verified via a second connection)', () => {
  const db = {
    metadata: { abc: { id: 'abc', title: 'Test' } },
  };
  saveDatabase(db);
  assert.deepEqual(readPersistedDatabase(process.env.DATA_DIR), persistedShape(db), 'a successful save is fully readable via an independent connection');
});

test('saveDatabase: a pre-transaction failure (unknown namespace) leaves the prior state intact and RETHROWS', () => {
  const original = { metadata: { keep: { id: 'keep' } } };
  saveDatabase(original);

  // The unknown-key persistence lock fires before any row is touched — a
  // namespace the schema map doesn't know must fail LOUDLY, never be
  // silently dropped by the diff (the persist-gate class).
  assert.throws(
    () => saveDatabase({ ...original, metadata: { never: { id: 'never-committed' } }, mysteryNamespace: {} }),
    /unknown top-level db key 'mysteryNamespace'/,
    'saveDatabase must PROPAGATE (rethrow), not swallow a false success'
  );

  assert.deepEqual(
    readPersistedDatabase(process.env.DATA_DIR), persistedShape(original),
    'the persisted state must be exactly the pre-failure commit'
  );
});

test('saveDatabase: a serialization failure aborts with NOTHING persisted — prior state intact, error RETHROWN', () => {
  // (True MID-transaction rollback — a failure after some rows of the same
  // save are already written — is covered at the adapter level in
  // test/unit/db-sqlite-adapter.test.js, where the insert statement can be
  // stubbed. Through the public seam, the reachable failure is a value
  // JSON.stringify cannot serialize; it must abort the save with zero rows
  // touched. NOTE: a plain `undefined` value is NOT a failure — it is
  // silently dropped, exactly as JSON.stringify dropped it from db.json
  // pre-v1.42.)
  const original = { metadata: { ok: { id: 'ok' } } };
  saveDatabase(original);

  const circular = { id: 'poison' };
  circular.self = circular;
  const poisoned = {
    ...original,
    metadata: { ...original.metadata, poison: circular },
  };
  assert.throws(
    () => saveDatabase(poisoned),
    /circular/i,
    'the serialization failure must propagate'
  );

  assert.deepEqual(
    readPersistedDatabase(process.env.DATA_DIR), persistedShape(original),
    'nothing from the failed save persisted'
  );

  // And the failed save must not have advanced the diff snapshot: the same
  // change saved cleanly afterwards still lands.
  saveDatabase({ ...original, metadata: { ...original.metadata, after: { id: 'after-recovery' } } });
  assert.deepEqual(Object.keys(readPersistedDatabase(process.env.DATA_DIR).metadata).sort(), ['after', 'ok']);
});

// ---- [UNIT] Serialization correctness: updateDatabase(mutatorFn) -----------

test('updateDatabase: two back-to-back calls mutating DIFFERENT fields both survive (neither clobbers the other)', async () => {
  saveDatabase({ metadata: {} });

  const order = [];
  const first = updateDatabase((db) => {
    order.push('first');
    db.metadata.first = { id: 'first' };
    return true;
  });
  const second = updateDatabase((db) => {
    order.push('second');
    // The second mutator must see the FIRST mutator's already-committed
    // state, not a stale pre-first snapshot -- proof the read happens fresh
    // INSIDE the lock, at execution time, not at enqueue time.
    assert.deepEqual(db.metadata.first, { id: 'first' }, 'the second mutator must observe the first mutator\'s committed write');
    db.metadata.second = { id: 'second' };
    return true;
  });

  await Promise.all([first, second]);

  assert.deepEqual(order, ['first', 'second'], 'mutators run in enqueue order');
  const finalDb = loadDatabase();
  assert.deepEqual(finalDb.metadata.first, { id: 'first' }, 'the first mutator\'s row survives');
  assert.deepEqual(
    finalDb.metadata.second, { id: 'second' },
    'the second mutator\'s field survives too -- neither writer clobbered the other'
  );
});

test('updateDatabase: a mutator returning false skips the save entirely (no-op guard path)', async () => {
  saveDatabase({ metadata: { u: { id: 'unchanged' } } });

  const result = await updateDatabase(() => false);

  assert.equal(result, false);
  assert.deepEqual(Object.keys(loadDatabase().metadata), ['u'], 'a false-returning mutator must not persist any change');
});

test('updateDatabase: a throwing mutator rejects only its own promise; the chain still processes the next write', async () => {
  saveDatabase({ metadata: {} });

  const failing = updateDatabase(() => { throw new Error('boom'); });
  const succeeding = updateDatabase((db) => { db.metadata.after = { id: 'after-failure' }; return true; });

  await assert.rejects(failing, /boom/, 'the throwing mutator\'s own promise must reject');
  await succeeding;

  assert.deepEqual(
    loadDatabase().metadata.after, { id: 'after-failure' },
    'a write enqueued after a failing mutator must still commit -- one failure must never wedge the chain'
  );
});

test('updateDatabase: a saveDatabase failure REJECTS the call (no false success), and the chain still processes the next write', async () => {
  saveDatabase({ metadata: { before: { id: 'before-failure' } } });

  // Same serialization poison as the saveDatabase abort test above — the
  // rejection must surface through updateDatabase's promise.
  const failing = updateDatabase((db) => {
    db.metadata.never = { id: 'never' };
    const circular = { id: 'poison' };
    circular.self = circular;
    db.metadata.poison = circular;
    return true;
  });
  await assert.rejects(
    failing, /circular/i,
    'a write failure inside saveDatabase must make updateDatabase REJECT, not resolve a false success'
  );

  assert.deepEqual(
    Object.keys(loadDatabase().metadata), ['before'],
    'the store must be unchanged after the rejected write -- no false-success/silent data loss'
  );

  // The chain must not be wedged by the failed write -- the next enqueued
  // write still commits normally.
  await updateDatabase((db) => { db.metadata.after = { id: 'after-recovery' }; return true; });
  assert.deepEqual(Object.keys(loadDatabase().metadata).sort(), ['after', 'before']);
});

// ---- [UNIT] loadDatabase backfill: ALL top-level keys, not just folderSettings/settings ----

test('loadDatabase: backfills the remaining top-level doc keys (liked/metadata) - the folder config is relational since Wave 4', () => {
  saveDatabase({ metadata: { m: { id: 'm' } } });
  const db = loadDatabase();
  assert.equal(db.folders, undefined, 'folders is never backfilled onto the doc object (Wave 4)');
  assert.deepEqual(db.liked, [], 'missing liked backfilled to []');
  assert.equal(db.progress, undefined, 'progress is relational since Wave 2 - never backfilled onto the doc object');
  assert.deepEqual(db.metadata, { m: { id: 'm' } }, 'existing metadata preserved');
  assert.equal(db.folderSettings, undefined, 'folderSettings is never backfilled onto the doc object (Wave 4)');
  assert.equal(db.settings, undefined, 'Wave 4: settings is not a doc key');
  assert.deepEqual(settingsStore.get(), DEFAULT_SETTINGS);
});

test('loadDatabase: a partial persisted set missing metadata lets a mutator write into it without throwing', async () => {
  saveDatabase({ liked: ['x'] }); // (a doc key that is not metadata; liked moves in Wave 4's third group)
  await assert.doesNotReject(
    updateDatabase((db) => {
      db.metadata['new-id'] = { id: 'new-id' };
      return true;
    }),
    'a partial persisted set (missing metadata) must not throw a TypeError in a mutator'
  );
  const after = loadDatabase();
  assert.equal(after.metadata['new-id'].id, 'new-id');
});

// ---- [UNIT] startup sweep: orphaned db.json.*.tmp (LEGACY, pre-v1.42) ------

test('cleanupOrphanDbTmp: removes only db.json.*.tmp files, leaves db.json/filetube.db and unrelated files alone', () => {
  // The sweep survives v1.42 for one reason: an upgrade from a CRASHED
  // pre-SQLite instance can leave `db.json.<pid>.<seq>.tmp` orphans in
  // DATA_DIR. The legacy db.json itself (a decoy here) and the live
  // filetube.db must never be touched.
  saveDatabase({ metadata: {} });
  fs.writeFileSync(DB_FILE, '{"legacy": true}');
  const orphan1 = path.join(process.env.DATA_DIR, 'db.json.12345.0.tmp');
  const orphan2 = path.join(process.env.DATA_DIR, 'db.json.6789.3.tmp');
  const unrelated = path.join(process.env.DATA_DIR, 'not-a-db-temp.txt');
  fs.writeFileSync(orphan1, 'stale');
  fs.writeFileSync(orphan2, 'stale');
  fs.writeFileSync(unrelated, 'keep me');

  const removed = cleanupOrphanDbTmp(process.env.DATA_DIR);

  assert.equal(removed, 2);
  assert.ok(!fs.existsSync(orphan1));
  assert.ok(!fs.existsSync(orphan2));
  assert.ok(fs.existsSync(unrelated), 'unrelated files must never be touched');
  assert.ok(fs.existsSync(DB_FILE), 'the legacy db.json must never be removed by the sweep (parallel-run contract)');
  assert.ok(fs.existsSync(SQLITE_FILE), 'filetube.db must never be touched by the sweep');
  fs.rmSync(unrelated);
});

test('cleanupOrphanDbTmp: an unreadable/missing directory is a safe no-op (returns 0, never throws)', () => {
  assert.doesNotThrow(() => {
    const removed = cleanupOrphanDbTmp(path.join(process.env.DATA_DIR, 'does-not-exist'));
    assert.equal(removed, 0);
  });
});

// ---- [UNIT] AC7: the Node-floor predicate (22.13 = first unflagged node:sqlite)

test('nodeVersionSupported: the 22.13 boundary is exact (AC7)', () => {
  assert.equal(nodeVersionSupported('20.11.0'), false, 'Node 20 refused');
  assert.equal(nodeVersionSupported('22.12.9'), false, 'below the sqlite floor refused');
  assert.equal(nodeVersionSupported('22.13.0'), true, 'the floor itself boots');
  assert.equal(nodeVersionSupported('22.23.1'), true, 'project Node 22 boots');
  assert.equal(nodeVersionSupported('24.14.0'), true, 'project Node 24 boots');
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

// FR-1b (v1.18.0): codec-aware needsTranscode's status transitions, exercised
// against a representative HEVC-.mp4 fixture (a nominally web-safe container
// whose codec is NOT allowlisted) -- mocked ffprobe output plumbed in as
// item.videoCodec/item.audioCodec, no real ffmpeg needed (docs/RELIABILITY.md).
test('reconcileTranscode: HEVC-in-mp4 (codec-flagged) seeds "pending" on first sight', () => {
  const item = { id: 'hevc-1', type: 'video', ext: '.mp4', videoCodec: 'hevc', audioCodec: 'aac' };
  const changed = reconcileTranscode(item);
  assert.equal(item.needsTranscode, true, 'HEVC video codec is not allowlisted -> flagged despite .mp4');
  assert.equal(item.transcodeStatus, undefined, 'reconcile only seeds/clears status, never queues -- no status yet means no cache and no in-flight job');
  assert.equal(changed, false, 'nothing to change yet: needsTranscode flips true but no transcodeStatus existed before or after');
});

test('reconcileTranscode: HEVC-in-mp4 with a cached MP4 is marked ready', () => {
  const item = { id: 'hevc-2', type: 'video', ext: '.mp4', videoCodec: 'hevc', audioCodec: 'aac' };
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

test('reconcileTranscode: HEVC-in-mp4 clears a stale "ready" when the cached MP4 is gone', () => {
  const item = { id: 'hevc-3', type: 'video', ext: '.mp4', videoCodec: 'hevc', audioCodec: 'aac', transcodeStatus: 'ready' };
  const changed = reconcileTranscode(item);
  assert.equal(item.needsTranscode, true);
  assert.equal(item.transcodeStatus, undefined, 'stale ready is cleared even for a codec-flagged (not extension-flagged) item');
  assert.equal(changed, true);
});

test('reconcileTranscode: HEVC-in-mp4 leaves an in-flight status alone', () => {
  const item = { id: 'hevc-4', type: 'video', ext: '.mp4', videoCodec: 'hevc', audioCodec: 'aac', transcodeStatus: 'processing' };
  const changed = reconcileTranscode(item);
  assert.equal(item.needsTranscode, true);
  assert.equal(item.transcodeStatus, 'processing');
  assert.equal(changed, false);
});

test('reconcileTranscode: clears needsTranscode + transcodeStatus once the file no longer needs transcoding (codec backfilled as allowlisted)', () => {
  // Simulates a re-probe correcting a prior wrong flag (or a re-mux to H.264/AAC):
  // once videoCodec/audioCodec are both allowlisted, the item must fully clear.
  const item = { id: 'hevc-5', type: 'video', ext: '.mp4', videoCodec: 'h264', audioCodec: 'aac', needsTranscode: true, transcodeStatus: 'ready' };
  const changed = reconcileTranscode(item);
  assert.equal(item.needsTranscode, false);
  assert.equal(item.transcodeStatus, undefined);
  assert.equal(changed, true);
});
