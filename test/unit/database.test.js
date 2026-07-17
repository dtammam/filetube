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
  updateDatabase,
  transcodedPath,
  reconcileTranscode,
  cleanupOrphanDbTmp,
  __resetDatabaseForTests,
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
  defaultView: '', // v1.14.0 item 4: '' is the "Most Recent" sentinel
  autoplayNext: false, // v1.16.0 FR-3 (T3): OFF by default
  backgroundAudioForVideo: false, // v1.27.0 (EXPERIMENTAL): OFF by default
  defaultSort: 'release-date', // v1.34: the real-YouTube-feed flip
  mobileCustomPlayer: false, // v1.34 T4: native mobile video controls by default
  preExtractAudio: false, // v1.35: deterministic background audio, OFF by default
  // v1.41.6 DELIBERATE key-set change (this deep-equal is the settings-shape
  // LOCK -- adding a key here is a conscious act, not a fixup): the reheat's
  // import-relocation lever. ON by default, unlike every other boolean above,
  // because relocating a hydrated MeTube import into its channel folder IS the
  // feature -- the toggle exists to turn it OFF. See server.js DEFAULT_SETTINGS.
  relocateHydratedImports: true,
};

test('loadDatabase: yields a fully-defaulted db when the store is empty (no eager write needed)', () => {
  const db = loadDatabase();
  assert.deepEqual(db.folders, []);
  assert.deepEqual(db.folderSettings, {});
  assert.deepEqual(db.progress, {});
  assert.deepEqual(db.metadata, {});
  assert.deepEqual(db.liked, []);
  assert.deepEqual(db.deleteTombstones, {});
  assert.deepEqual(db.viewCounts, {});
  assert.deepEqual(db.settings, DEFAULT_SETTINGS, 'fresh db gets defaulted settings');
  assert.ok(fs.existsSync(SQLITE_FILE), 'filetube.db exists from the adapter open');
  // v1.42: defaults are NOT eagerly persisted (the pre-v1.42 initial-create
  // write is subsumed by the adapter) — the first real save persists them.
  assert.deepEqual(readPersistedDatabase(process.env.DATA_DIR), {}, 'no rows until a real save');
});

test('loadDatabase: backfills folderSettings when the persisted set lacks it', () => {
  saveDatabase({ folders: ['/x'], progress: {}, metadata: {} });
  const db = loadDatabase();
  assert.deepEqual(db.folderSettings, {}, 'missing folderSettings is backfilled');
  assert.deepEqual(db.folders, ['/x']);
});

test('v1.42 migration-path: a corrupt db.json sitting beside an ACTIVE filetube.db is ignored, never read', () => {
  // Pre-v1.42, loadDatabase parsed db.json every call and a corrupt file
  // triggered reset-to-fresh recovery. Post-migration, db.json is a frozen
  // legacy artifact: once filetube.db exists it is never consulted, so even
  // garbage in it cannot perturb a load. (Corrupt db.json at FIRST boot —
  // before filetube.db exists — aborts the import instead; that leg lives in
  // test/unit/db-sqlite-adapter.test.js per AC9.)
  saveDatabase({ folders: ['/real'], folderSettings: {}, progress: {}, metadata: {} });
  fs.writeFileSync(DB_FILE, '{ this is not valid json ');
  const db = loadDatabase();
  assert.deepEqual(db.folders, ['/real'], 'load comes from SQLite; the corrupt legacy file is inert');
  assert.equal(fs.readFileSync(DB_FILE, 'utf8'), '{ this is not valid json ', 'db.json untouched');
});

test('saveDatabase + loadDatabase: round-trips data faithfully', () => {
  const original = {
    folders: ['/media/movies'],
    folderSettings: { '/media/movies': { name: 'Movies', hidden: false } },
    progress: { abc: { timestamp: 42, duration: 100 } },
    metadata: { abc: { id: 'abc', title: 'Test' } },
    liked: ['abc'],
    deleteTombstones: {}, // v1.41.3: backfilled like every other top-level key
    viewCounts: {}, // v1.42: backfilled like every other top-level key
    settings: DEFAULT_SETTINGS,
  };
  saveDatabase(original);
  assert.deepEqual(loadDatabase(), original);
});

test('loadDatabase: a persisted set with no settings key gets all defaults, no data loss', () => {
  saveDatabase({
    folders: ['/media/movies'],
    folderSettings: { '/media/movies': { name: 'Movies', hidden: false } },
    progress: { abc: { timestamp: 42, duration: 100 } },
    metadata: { abc: { id: 'abc', title: 'Test' } },
  });
  const db = loadDatabase();
  assert.deepEqual(db.settings, DEFAULT_SETTINGS, 'all settings defaulted');
  assert.deepEqual(db.folders, ['/media/movies'], 'folders preserved');
  assert.deepEqual(db.folderSettings, { '/media/movies': { name: 'Movies', hidden: false } }, 'folderSettings preserved');
  assert.deepEqual(db.progress, { abc: { timestamp: 42, duration: 100 } }, 'progress preserved');
  assert.deepEqual(db.metadata, { abc: { id: 'abc', title: 'Test' } }, 'metadata preserved');
});

test('loadDatabase: defaults pruneMissing to true and scanIntervalMinutes to 30', () => {
  saveDatabase({ folders: [], progress: {}, metadata: {} });
  const db = loadDatabase();
  assert.equal(db.settings.pruneMissing, true);
  assert.equal(db.settings.scanIntervalMinutes, 30);
});

test('loadDatabase: a partial settings object keeps its set keys and fills the rest', () => {
  saveDatabase({ folders: [], progress: {}, metadata: {}, settings: { cacheMaxAgeDays: 7 } });
  const db = loadDatabase();
  assert.equal(db.settings.cacheMaxAgeDays, 7, 'explicitly-set key is preserved');
  assert.equal(db.settings.scanIntervalMinutes, 30, 'unset key defaulted');
  assert.equal(db.settings.pruneMissing, true, 'unset key defaulted');
  assert.equal(db.settings.cacheMaxBytes, null, 'unset key defaulted');
});

test('saveDatabase + loadDatabase: a metadata lastServedAt survives a round-trip', () => {
  const original = {
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: { abc: { id: 'abc', title: 'Test', lastServedAt: 1735689600000 } },
    settings: DEFAULT_SETTINGS,
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
      && ['metadata', 'progress', 'deleteTombstones', 'viewCounts'].includes(key)) continue;
    out[key] = value;
  }
  return out;
}

test('saveDatabase: a successful save persists the complete state (verified via a second connection)', () => {
  const db = {
    folders: ['/media/movies'],
    folderSettings: {},
    progress: {},
    metadata: { abc: { id: 'abc', title: 'Test' } },
    settings: DEFAULT_SETTINGS,
  };
  saveDatabase(db);
  assert.deepEqual(readPersistedDatabase(process.env.DATA_DIR), persistedShape(db), 'a successful save is fully readable via an independent connection');
});

test('saveDatabase: a pre-transaction failure (unknown namespace) leaves the prior state intact and RETHROWS', () => {
  const original = { folders: ['/keep'], folderSettings: {}, progress: {}, metadata: {}, settings: DEFAULT_SETTINGS };
  saveDatabase(original);

  // The unknown-key persistence lock fires before any row is touched — a
  // namespace the schema map doesn't know must fail LOUDLY, never be
  // silently dropped by the diff (the persist-gate class).
  assert.throws(
    () => saveDatabase({ ...original, folders: ['/never-committed'], mysteryNamespace: {} }),
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
  const original = { folders: ['/keep2'], folderSettings: {}, progress: {}, metadata: { ok: { id: 'ok' } }, settings: DEFAULT_SETTINGS };
  saveDatabase(original);

  const circular = { id: 'poison' };
  circular.self = circular;
  const poisoned = {
    ...original,
    folders: ['/never-committed-2'],
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
  saveDatabase({ ...original, folders: ['/after-recovery'] });
  assert.deepEqual(readPersistedDatabase(process.env.DATA_DIR).folders, ['/after-recovery']);
});

// ---- [UNIT] Serialization correctness: updateDatabase(mutatorFn) -----------

test('updateDatabase: two back-to-back calls mutating DIFFERENT fields both survive (neither clobbers the other)', async () => {
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: DEFAULT_SETTINGS });

  const order = [];
  const first = updateDatabase((db) => {
    order.push('first');
    db.folders = ['/from-first'];
    return true;
  });
  const second = updateDatabase((db) => {
    order.push('second');
    // The second mutator must see the FIRST mutator's already-committed
    // state, not a stale pre-first snapshot -- proof the read happens fresh
    // INSIDE the lock, at execution time, not at enqueue time.
    assert.deepEqual(db.folders, ['/from-first'], 'the second mutator must observe the first mutator\'s committed write');
    db.folderSettings = { '/from-first': { name: 'X', hidden: false } };
    return true;
  });

  await Promise.all([first, second]);

  assert.deepEqual(order, ['first', 'second'], 'mutators run in enqueue order');
  const finalDb = loadDatabase();
  assert.deepEqual(finalDb.folders, ['/from-first'], 'the first mutator\'s field survives');
  assert.deepEqual(
    finalDb.folderSettings, { '/from-first': { name: 'X', hidden: false } },
    'the second mutator\'s field survives too -- neither writer clobbered the other'
  );
});

test('updateDatabase: a mutator returning false skips the save entirely (no-op guard path)', async () => {
  saveDatabase({ folders: ['/unchanged'], folderSettings: {}, progress: {}, metadata: {}, settings: DEFAULT_SETTINGS });

  const result = await updateDatabase(() => false);

  assert.equal(result, false);
  assert.deepEqual(loadDatabase().folders, ['/unchanged'], 'a false-returning mutator must not persist any change');
});

test('updateDatabase: a throwing mutator rejects only its own promise; the chain still processes the next write', async () => {
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: DEFAULT_SETTINGS });

  const failing = updateDatabase(() => { throw new Error('boom'); });
  const succeeding = updateDatabase((db) => { db.folders = ['/after-failure']; return true; });

  await assert.rejects(failing, /boom/, 'the throwing mutator\'s own promise must reject');
  await succeeding;

  assert.deepEqual(
    loadDatabase().folders, ['/after-failure'],
    'a write enqueued after a failing mutator must still commit -- one failure must never wedge the chain'
  );
});

test('updateDatabase: a saveDatabase failure REJECTS the call (no false success), and the chain still processes the next write', async () => {
  saveDatabase({ folders: ['/before-failure'], folderSettings: {}, progress: {}, metadata: {}, settings: DEFAULT_SETTINGS });

  // Same serialization poison as the saveDatabase abort test above — the
  // rejection must surface through updateDatabase's promise.
  const failing = updateDatabase((db) => {
    db.folders = ['/never-committed'];
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
    loadDatabase().folders, ['/before-failure'],
    'the store must be unchanged after the rejected write -- no false-success/silent data loss'
  );

  // The chain must not be wedged by the failed write -- the next enqueued
  // write still commits normally.
  await updateDatabase((db) => { db.folders = ['/after-recovery']; return true; });
  assert.deepEqual(loadDatabase().folders, ['/after-recovery']);
});

// ---- [UNIT] loadDatabase backfill: ALL top-level keys, not just folderSettings/settings ----

test('loadDatabase: backfills ALL top-level keys (folders/progress/metadata), not just folderSettings/settings', () => {
  saveDatabase({ folderSettings: { '/x': { name: 'X', hidden: false } } });
  const db = loadDatabase();
  assert.deepEqual(db.folders, [], 'missing folders backfilled to []');
  assert.deepEqual(db.progress, {}, 'missing progress backfilled to {}');
  assert.deepEqual(db.metadata, {}, 'missing metadata backfilled to {}');
  assert.deepEqual(db.folderSettings, { '/x': { name: 'X', hidden: false } }, 'existing folderSettings preserved');
  assert.deepEqual(db.settings, DEFAULT_SETTINGS);
});

test('loadDatabase: a partial persisted set missing metadata/progress lets a mutator write into them without throwing', async () => {
  saveDatabase({ folders: ['/x'] });
  await assert.doesNotReject(
    updateDatabase((db) => {
      db.metadata['new-id'] = { id: 'new-id' };
      db.progress['new-id'] = { timestamp: 0 };
      return true;
    }),
    'a partial persisted set (missing metadata/progress) must not throw a TypeError in a mutator'
  );
  const after = loadDatabase();
  assert.equal(after.metadata['new-id'].id, 'new-id');
  assert.equal(after.progress['new-id'].timestamp, 0);
});

// ---- [UNIT] startup sweep: orphaned db.json.*.tmp (LEGACY, pre-v1.42) ------

test('cleanupOrphanDbTmp: removes only db.json.*.tmp files, leaves db.json/filetube.db and unrelated files alone', () => {
  // The sweep survives v1.42 for one reason: an upgrade from a CRASHED
  // pre-SQLite instance can leave `db.json.<pid>.<seq>.tmp` orphans in
  // DATA_DIR. The legacy db.json itself (a decoy here) and the live
  // filetube.db must never be touched.
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: DEFAULT_SETTINGS });
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
