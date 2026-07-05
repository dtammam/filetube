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
  updateDatabase,
  transcodedPath,
  reconcileTranscode,
} = require('../../server');

beforeEach(() => {
  // Start each test from a clean slate.
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
});

const DEFAULT_SETTINGS = {
  scanIntervalMinutes: 30,
  pruneMissing: true,
  cacheMaxBytes: null,
  cacheMaxAgeDays: 30,
};

test('loadDatabase: creates a default db when none exists', () => {
  const db = loadDatabase();
  assert.deepEqual(db.folders, []);
  assert.deepEqual(db.folderSettings, {});
  assert.deepEqual(db.progress, {});
  assert.deepEqual(db.metadata, {});
  assert.deepEqual(db.settings, DEFAULT_SETTINGS, 'fresh db gets defaulted settings');
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
  assert.deepEqual(db, {
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {},
    settings: DEFAULT_SETTINGS,
  });
});

test('saveDatabase + loadDatabase: round-trips data faithfully', () => {
  const original = {
    folders: ['/media/movies'],
    folderSettings: { '/media/movies': { name: 'Movies', hidden: false } },
    progress: { abc: { timestamp: 42, duration: 100 } },
    metadata: { abc: { id: 'abc', title: 'Test' } },
    settings: DEFAULT_SETTINGS,
  };
  saveDatabase(original);
  assert.deepEqual(loadDatabase(), original);
});

test('loadDatabase: old db.json with no settings key gets all four defaults, no data loss', () => {
  const legacy = {
    folders: ['/media/movies'],
    folderSettings: { '/media/movies': { name: 'Movies', hidden: false } },
    progress: { abc: { timestamp: 42, duration: 100 } },
    metadata: { abc: { id: 'abc', title: 'Test' } },
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(legacy));
  const db = loadDatabase();
  assert.deepEqual(db.settings, DEFAULT_SETTINGS, 'all four settings defaulted');
  assert.deepEqual(db.folders, legacy.folders, 'folders preserved');
  assert.deepEqual(db.folderSettings, legacy.folderSettings, 'folderSettings preserved');
  assert.deepEqual(db.progress, legacy.progress, 'progress preserved');
  assert.deepEqual(db.metadata, legacy.metadata, 'metadata preserved');
});

test('loadDatabase: defaults pruneMissing to true and scanIntervalMinutes to 30', () => {
  fs.writeFileSync(DB_FILE, JSON.stringify({ folders: [], progress: {}, metadata: {} }));
  const db = loadDatabase();
  assert.equal(db.settings.pruneMissing, true);
  assert.equal(db.settings.scanIntervalMinutes, 30);
});

test('loadDatabase: a partial settings object keeps its set keys and fills the rest', () => {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify({ folders: [], progress: {}, metadata: {}, settings: { cacheMaxAgeDays: 7 } })
  );
  const db = loadDatabase();
  assert.equal(db.settings.cacheMaxAgeDays, 7, 'explicitly-set key is preserved');
  assert.equal(db.settings.scanIntervalMinutes, 30, 'unset key defaulted');
  assert.equal(db.settings.pruneMissing, true, 'unset key defaulted');
  assert.equal(db.settings.cacheMaxBytes, null, 'unset key defaulted');
});

test('loadDatabase: corrupt db.json recovery path also returns a settings-bearing db', () => {
  fs.writeFileSync(DB_FILE, '{ not json at all');
  const db = loadDatabase();
  assert.deepEqual(db.settings, DEFAULT_SETTINGS, 'corrupt recovery still yields defaulted settings');
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

// ---- [UNIT] Atomic write: saveDatabase is write-temp-then-rename -----------

// Any leftover `${DB_FILE}.<pid>.<seq>.tmp` file in DATA_DIR after a save.
function orphanTmpFiles() {
  return fs.readdirSync(process.env.DATA_DIR).filter((name) => name.startsWith('db.json.') && name.endsWith('.tmp'));
}

test('saveDatabase: a successful save yields valid, complete JSON and leaves no orphan *.tmp file', () => {
  const db = {
    folders: ['/media/movies'],
    folderSettings: {},
    progress: {},
    metadata: { abc: { id: 'abc', title: 'Test' } },
    settings: DEFAULT_SETTINGS,
  };
  saveDatabase(db);

  const onDisk = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.deepEqual(onDisk, db, 'a successful save produces valid, complete JSON');
  assert.deepEqual(orphanTmpFiles(), [], 'no leftover temp file after a successful save');
});

test('saveDatabase: a forced write failure leaves the prior db.json intact and no orphan *.tmp remains', () => {
  const original = { folders: ['/keep'], folderSettings: {}, progress: {}, metadata: {}, settings: DEFAULT_SETTINGS };
  saveDatabase(original);
  const before = fs.readFileSync(DB_FILE, 'utf8');

  // Simulate an interrupted write (e.g. disk full/IO error) at the temp-file
  // write step -- stub the fd-based write fs.writeFileSync uses internally.
  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('simulated disk write failure'); };
  try {
    saveDatabase({ folders: ['/never-committed'], folderSettings: {}, progress: {}, metadata: {}, settings: DEFAULT_SETTINGS });
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }

  assert.equal(
    fs.readFileSync(DB_FILE, 'utf8'), before,
    'db.json must be byte-identical to its pre-failure content -- never torn/partially written'
  );
  assert.deepEqual(orphanTmpFiles(), [], 'the failed write\'s temp file must be cleaned up, not left as an orphan');
});

test('saveDatabase: a forced rename failure leaves the prior db.json intact and no orphan *.tmp remains', () => {
  const original = { folders: ['/keep2'], folderSettings: {}, progress: {}, metadata: {}, settings: DEFAULT_SETTINGS };
  saveDatabase(original);
  const before = fs.readFileSync(DB_FILE, 'utf8');

  // Simulate a failure at the atomic-rename step itself (e.g. an exotic
  // cross-device edge case) -- the temp file was already written, so this
  // exercises the cleanup path specifically.
  const realRenameSync = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated rename failure'); };
  try {
    saveDatabase({ folders: ['/never-committed-2'], folderSettings: {}, progress: {}, metadata: {}, settings: DEFAULT_SETTINGS });
  } finally {
    fs.renameSync = realRenameSync;
  }

  assert.equal(
    fs.readFileSync(DB_FILE, 'utf8'), before,
    'db.json must be byte-identical to its pre-failure content when only the rename step fails'
  );
  assert.deepEqual(orphanTmpFiles(), [], 'the temp file written before the failed rename must be cleaned up');
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
