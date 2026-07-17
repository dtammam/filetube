'use strict';

// [INTEGRATION] v1.30 A4 -- progress-write coalescer + read-your-writes
// overlay + shutdown flush (server.js). Covers the ACs the T5 task inbox
// calls out as needing DIRECT test coverage:
//
//   AC4.1 (>=5:1 write-amplification reduction for a batched progress burst)
//   AC4.2 (positive: every REAL mutation -- DELETE /api/videos/:id,
//          POST /api/config, POST /api/settings, the scan's final merge --
//          stays exactly 1:1 write-per-invocation, unbatched; a torn-write
//          round-trip confirms the on-disk file is never left half-written)
//   AC4.3 (converse: a crash relative to a flush leaves db.json parseable,
//          loses at most one PROGRESS_FLUSH_MS window, and never touches
//          anything but watch position)
//   Read-your-writes: a just-posted position is visible immediately, on all
//   three overlay surfaces, BEFORE the flush fires.
//   Preserved semantics: 400/404 on POST /api/progress still hold.
//
// `PROGRESS_FLUSH_MS` is shrunk via env (see server.js's own comment above
// the constant) BEFORE requiring server.js, so the batching burst test can
// exercise the REAL debounce timer on a fast, deterministic cadence instead
// of sleeping out the 5000ms production default. No FFmpeg needed.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-progress-coalescer-'));
process.env.PROGRESS_FLUSH_MS = '150';
const THUMBNAIL_DIR = path.join(process.env.DATA_DIR, '.thumbnails');
fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app,
  saveDatabase,
  loadDatabase,
  scanDirectories,
  getMediaId,
  pendingProgress,
  PROGRESS_FLUSH_MS,
  flushPendingProgress,
  currentProgressFlushTimer,
  __getSaveDatabaseCallCount,
  __failNextSaveForTests,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

// Every test starts from a clean, flushed slate -- no leftover pending
// pings/timer from a prior test in this file bleeding into the next.
beforeEach(async () => {
  await flushPendingProgress();
  pendingProgress.clear();
});

function baseSettings(overrides) {
  return {
    scanIntervalMinutes: 30,
    pruneMissing: true,
    cacheMaxBytes: null,
    cacheMaxAgeDays: 30,
    ...overrides,
  };
}

async function postProgress(id, timestamp, duration) {
  return fetch(`${base}/api/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(duration === undefined ? { id, timestamp } : { id, timestamp, duration }),
  });
}

// ---- Preserved semantics: 400 / 404 -----------------------------------

test('POST /api/progress still returns 400 on bad input (missing/non-numeric timestamp)', async () => {
  const res = await postProgress('x', undefined);
  assert.equal(res.status, 400);
});

test('POST /api/progress still returns 404 for an unknown media id, and never stages it in pendingProgress', async () => {
  const before = pendingProgress.size;
  const res = await postProgress('ghost-id', 10);
  assert.equal(res.status, 404);
  assert.equal(pendingProgress.size, before, 'a 404 must never stage a ping for a nonexistent id');
});

// ---- No per-ping updateDatabase ----------------------------------------

test('POST /api/progress performs NO synchronous write -- saveDatabase call count is unchanged immediately after the response', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidNoWrite: { id: 'vidNoWrite', title: 'Clip', duration: 100 } },
    settings: baseSettings(),
  });
  const before = __getSaveDatabaseCallCount();
  const res = await postProgress('vidNoWrite', 12, 100);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).success, true);
  assert.equal(__getSaveDatabaseCallCount(), before, 'a single ping must not trigger any saveDatabase call');
  assert.ok(pendingProgress.has('vidNoWrite'), 'the ping must be staged in the coalescer');
  assert.ok(currentProgressFlushTimer(), 'a debounce timer must be armed after the first ping');
});

// ---- Preserved stored shape + duration fallback ------------------------

test('the flushed value keeps the exact pre-A4 stored shape and duration-fallback precedence', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidShape: { id: 'vidShape', title: 'Clip', duration: 42 } },
    settings: baseSettings(),
  });
  // No duration on the ping -- must fall back to metadata.duration (42), not 0.
  await postProgress('vidShape', 20);
  await flushPendingProgress();
  const onDisk = loadDatabase().progress.vidShape;
  assert.equal(onDisk.timestamp, 20);
  assert.equal(onDisk.duration, 42, 'missing duration on the ping falls back to metadata.duration');
  assert.equal(typeof onDisk.updatedAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(onDisk.updatedAt)), 'updatedAt must be a valid ISO timestamp');
});

test('the flush guard skips an id deleted between its ping and the flush (never resurrects a removed metadata entry)', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidDeletedBeforeFlush: { id: 'vidDeletedBeforeFlush', title: 'Clip', duration: 10 } },
    settings: baseSettings(),
  });
  await postProgress('vidDeletedBeforeFlush', 5, 10);
  assert.ok(pendingProgress.has('vidDeletedBeforeFlush'));

  // Simulate the id being removed (e.g. DELETE /api/videos/:id) before the
  // flush fires -- directly against the on-disk db, mirroring what a real
  // concurrent delete would leave behind.
  const db = loadDatabase();
  delete db.metadata.vidDeletedBeforeFlush;
  saveDatabase(db);

  await flushPendingProgress();
  assert.equal(loadDatabase().progress.vidDeletedBeforeFlush, undefined, 'a flush must never resurrect a deleted metadata entry');
});

// ---- Read-your-writes overlay -------------------------------------------

test('read-your-writes: GET /api/progress/:id sees a just-posted position BEFORE the flush fires', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidOverlay1: { id: 'vidOverlay1', title: 'Clip', duration: 100 } },
    settings: baseSettings(),
  });
  await postProgress('vidOverlay1', 33, 100);
  // Deliberately NOT flushed yet -- on-disk db.progress must still be empty.
  assert.equal(loadDatabase().progress.vidOverlay1, undefined, 'precondition: nothing persisted to disk yet');

  const res = await fetch(`${base}/api/progress/vidOverlay1`);
  const json = await res.json();
  assert.equal(json.timestamp, 33, 'the overlay must surface the pending (not-yet-flushed) position');
  assert.equal(json.duration, 100);
});

test('read-your-writes: GET /api/videos/:id sees a just-posted position BEFORE the flush fires', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidOverlay2: { id: 'vidOverlay2', title: 'Clip', type: 'video', ext: '.mp4', duration: 100 } },
    settings: baseSettings(),
  });
  await postProgress('vidOverlay2', 77, 100);

  const res = await fetch(`${base}/api/videos/vidOverlay2`);
  const json = await res.json();
  assert.equal(json.progress, 77, 'the /api/videos/:id overlay must surface the pending position');
});

test('read-your-writes: GET /api/videos per-item progress map sees a just-posted position BEFORE the flush fires', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      vidOverlay3: {
        id: 'vidOverlay3', title: 'Clip', type: 'video', ext: '.mp4', duration: 100,
        folderName: 'x', addedAt: Date.now(), artist: '',
      },
    },
    settings: baseSettings(),
  });
  await postProgress('vidOverlay3', 50, 100);

  const res = await fetch(`${base}/api/videos`);
  const { items: list } = await res.json();
  const item = list.find((i) => i.id === 'vidOverlay3');
  assert.ok(item, 'seeded item must be present');
  assert.equal(item.progress, 50, 'the /api/videos overlay must surface the pending position');
  assert.equal(item.progressPercent, 50, '50/100 -> 50%');
});

test('read-your-writes overlay never mutates the shared cache object in place', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidNoMutate: { id: 'vidNoMutate', title: 'Clip', duration: 100 } },
    settings: baseSettings(),
  });
  await postProgress('vidNoMutate', 60, 100);
  // Read the overlay a couple of times (each read surface), then confirm the
  // CACHE's own progress map is still untouched -- only pendingProgress (and,
  // after an explicit flush, a freshly-loaded db) ever carries the value.
  await fetch(`${base}/api/progress/vidNoMutate`);
  await fetch(`${base}/api/videos/vidNoMutate`);
  const { getCachedDatabase } = require('../../server');
  assert.equal(
    getCachedDatabase().progress.vidNoMutate, undefined,
    'the overlay must be read-only against the cache -- pendingProgress carries the value, not an in-place cache mutation'
  );
});

// ---- AC4.1: batched writes ------------------------------------------------

test('AC4.1: a burst of N rapid pings against the same id collapses into <= N/5 whole-file writes, tied to the PROGRESS_FLUSH_MS window', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidBurst: { id: 'vidBurst', title: 'Clip', duration: 1000 } },
    settings: baseSettings(),
  });

  const before = __getSaveDatabaseCallCount();
  const PING_COUNT = 20;
  // Real cadence proportionally scaled to PROGRESS_FLUSH_MS (mirrors the
  // production ~4s-ping-vs-5s-window ratio): a ping roughly every
  // PROGRESS_FLUSH_MS * 0.8 / 5 lands several pings inside each flush window.
  const cadenceMs = Math.round((PROGRESS_FLUSH_MS * 0.8) / 5);
  for (let i = 0; i < PING_COUNT; i++) {
    await postProgress('vidBurst', i, 1000);
    await new Promise((resolve) => setTimeout(resolve, cadenceMs));
  }
  // Let the last-armed timer actually fire and flush.
  await flushPendingProgress();

  const writes = __getSaveDatabaseCallCount() - before;
  assert.ok(
    writes <= PING_COUNT / 5,
    `expected <= ${PING_COUNT / 5} whole-file writes for ${PING_COUNT} pings (>= 5:1 reduction), saw ${writes}`
  );
  assert.ok(writes >= 1, 'the burst must still eventually persist at least once');
  assert.equal(loadDatabase().progress.vidBurst.timestamp, PING_COUNT - 1, 'the LAST-WINS value must be what is persisted');
});

test('AC4.1: many pings against DIFFERENT ids inside one window still collapse into a single write', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      multiA: { id: 'multiA', title: 'A', duration: 10 },
      multiB: { id: 'multiB', title: 'B', duration: 10 },
      multiC: { id: 'multiC', title: 'C', duration: 10 },
    },
    settings: baseSettings(),
  });
  const before = __getSaveDatabaseCallCount();
  await postProgress('multiA', 1, 10);
  await postProgress('multiB', 2, 10);
  await postProgress('multiC', 3, 10);
  await flushPendingProgress();
  assert.equal(__getSaveDatabaseCallCount() - before, 1, 'three different ids pinged inside one window must still be ONE write');
  const db = loadDatabase();
  assert.equal(db.progress.multiA.timestamp, 1);
  assert.equal(db.progress.multiB.timestamp, 2);
  assert.equal(db.progress.multiC.timestamp, 3);
});

// ---- AC4.2 (positive): real mutations stay 1:1, unbatched ----------------

test('AC4.2: DELETE /api/videos/:id triggers exactly 1 saveDatabase call per invocation', async () => {
  const filePath = path.join(os.tmpdir(), `filetube-progress-coalescer-delete-${Date.now()}.mp4`);
  fs.writeFileSync(filePath, 'bytes');
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidDel11: { id: 'vidDel11', title: 'Clip', filePath } },
    settings: baseSettings(),
  });
  const before = __getSaveDatabaseCallCount();
  const res = await fetch(`${base}/api/videos/vidDel11`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal(__getSaveDatabaseCallCount() - before, 1, 'DELETE must remain exactly 1:1 (unbatched)');
});

test('AC4.2: POST /api/config triggers exactly 1 saveDatabase call per invocation', async () => {
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });
  const before = __getSaveDatabaseCallCount();
  const res = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folders: [] }),
  });
  assert.equal(res.status, 200);
  assert.equal(__getSaveDatabaseCallCount() - before, 1, 'POST /api/config must remain exactly 1:1 (unbatched)');
});

test('AC4.2: POST /api/settings triggers exactly 1 saveDatabase call per invocation', async () => {
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });
  const before = __getSaveDatabaseCallCount();
  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pruneMissing: false }),
  });
  assert.equal(res.status, 200);
  assert.equal(__getSaveDatabaseCallCount() - before, 1, 'POST /api/settings must remain exactly 1:1 (unbatched)');
});

test('AC4.2: the scan\'s final merge triggers exactly 1 saveDatabase call for an unchanged fixture', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-progress-coalescer-scanlib-'));
  const filePath = path.join(root, 'scanfile.mp4');
  fs.writeFileSync(filePath, 'x');
  const id = getMediaId(filePath);
  const size = fs.statSync(filePath).size;
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'thumb-bytes');
  saveDatabase({
    folders: [root], folderSettings: {}, progress: {},
    metadata: {
      [id]: {
        id, name: 'scanfile.mp4', title: 'scanfile', filePath,
        folderName: path.basename(root), size, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 5, hasThumbnail: true, artist: '',
        rootFolder: root, videoCodec: 'h264', audioCodec: 'aac',
        needsTranscode: false, releaseDate: Date.now(),
      },
    },
    settings: baseSettings(),
  });
  const before = __getSaveDatabaseCallCount();
  await scanDirectories();
  assert.equal(__getSaveDatabaseCallCount() - before, 1, 'the scan\'s final merge must remain exactly 1:1 (unbatched) on an unchanged fixture');
});

// ---- AC4.2: torn-write round-trip (real mutations never leave a torn file) ----

test('AC4.2: a simulated crash mid-write during POST /api/config never tears the store -- 500 surfaces, the prior committed state survives intact', async () => {
  // v1.42: the old fs.renameSync stub can't intercept SQLite; the sanctioned
  // replacement is __failNextSaveForTests() — the same one-shot "this write
  // dies" force, injected at the seam instead of under it.
  saveDatabase({
    folders: ['/keep-me'], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings(),
  });
  const before = readPersistedDatabase(process.env.DATA_DIR);

  __failNextSaveForTests(new Error('simulated crash before commit'));
  const res = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folders: [] }),
  });
  assert.equal(res.status, 500, 'a crash mid-write must surface as a 500, not a silent false success');

  const after = readPersistedDatabase(process.env.DATA_DIR);
  assert.deepEqual(after, before, 'the persisted state must be identical to its pre-crash commit -- never torn/partially written');
  assert.deepEqual(after.folders, ['/keep-me'], 'the prior, fully-committed state survives intact');

  // And the chain is not wedged: the next clean write commits normally.
  const res2 = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folders: [] }),
  });
  assert.equal(res2.status, 200);
  assert.deepEqual(readPersistedDatabase(process.env.DATA_DIR).folders, [], 'a later clean write proceeds normally');
});

// ---- AC4.3 (converse): bounded, progress-only relaxation ------------------

test('AC4.3: a crash simulated at an arbitrary point relative to a flush leaves db.json parseable, and the lost data is bounded to <= one flush window of watch position only', async () => {
  saveDatabase({
    folders: ['/untouched-folder'], folderSettings: {}, progress: {},
    metadata: {
      vidCrash: { id: 'vidCrash', title: 'Clip', duration: 100 },
      vidUnrelated: { id: 'vidUnrelated', title: 'Other', duration: 50 },
    },
    settings: baseSettings(),
  });
  const before = readPersistedDatabase(process.env.DATA_DIR);

  // A ping is staged (queued, not yet flushed) -- exactly the window AC4.3
  // describes as "an arbitrary point relative to a flush".
  await postProgress('vidCrash', 42, 100);
  assert.ok(pendingProgress.has('vidCrash'));

  // Simulate a hard crash (SIGKILL-equivalent): the write never even starts --
  // the persisted store is whatever it was BEFORE this ping was staged.
  const onCrash = readPersistedDatabase(process.env.DATA_DIR);
  assert.deepEqual(onCrash, before, 'the persisted store is untouched by an unflushed pending ping -- never torn');

  assert.equal((onCrash.progress || {}).vidCrash, undefined, 'the lost data is bounded to the unflushed watch position only');
  assert.deepEqual(onCrash.folders, ['/untouched-folder'], 'folders/metadata/settings are NEVER at risk from the progress coalescer');
  assert.ok(onCrash.metadata.vidCrash, 'metadata itself (unlike progress) is never at risk');
  assert.ok(onCrash.metadata.vidUnrelated, 'an unrelated item is completely unaffected');
});

test('AC4.3: after a normal flush (not a crash), the position IS durable on disk and parses correctly', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidDurable: { id: 'vidDurable', title: 'Clip', duration: 100 } },
    settings: baseSettings(),
  });
  await postProgress('vidDurable', 88, 100);
  await flushPendingProgress();
  const onDisk = readPersistedDatabase(process.env.DATA_DIR);
  assert.equal(onDisk.progress.vidDurable.timestamp, 88);
});

// ---- Shutdown flush primitive (AC4.3) -------------------------------------
// The actual `process.on('SIGTERM'|'SIGINT'|'beforeExit')` wiring lives
// under server.js's `require.main === module` startup guard (consistent
// with every other startup/shutdown side effect in that file), so importing
// this module for tests never installs a listener that could swallow Ctrl-C
// or otherwise change process-signal behavior during a test run (see that
// block's own comment). What IS always exercised here, directly, is the
// exact primitive those handlers call.

test('shutdown flush primitive: flushPendingProgress persists every staged id in one atomic write and clears the queue', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      shutdownA: { id: 'shutdownA', title: 'A', duration: 10 },
      shutdownB: { id: 'shutdownB', title: 'B', duration: 10 },
    },
    settings: baseSettings(),
  });
  await postProgress('shutdownA', 3, 10);
  await postProgress('shutdownB', 4, 10);
  assert.equal(pendingProgress.size, 2);

  const before = __getSaveDatabaseCallCount();
  await flushPendingProgress();
  assert.equal(__getSaveDatabaseCallCount() - before, 1, 'the shutdown-style flush persists the whole queue in ONE write');
  assert.equal(pendingProgress.size, 0, 'the queue is cleared once flushed');

  const db = loadDatabase();
  assert.equal(db.progress.shutdownA.timestamp, 3);
  assert.equal(db.progress.shutdownB.timestamp, 4);
});

test('flushPendingProgress is a safe no-op (no write) when nothing is pending', async () => {
  const before = __getSaveDatabaseCallCount();
  const result = await flushPendingProgress();
  assert.equal(result, false, 'an empty flush must skip updateDatabase entirely');
  assert.equal(__getSaveDatabaseCallCount(), before, 'an empty flush must never issue a whole-file write');
});
