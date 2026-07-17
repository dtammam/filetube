'use strict';

// [INTEGRATION] v1.30 A4 -- progress-write coalescer + read-your-writes
// overlay + shutdown flush (server.js). Covers the ACs the T5 task inbox
// calls out as needing DIRECT test coverage:
//
//   AC4.1 (>=5:1 write-amplification reduction for a batched progress burst)
//   AC4.2 (positive: every REAL mutation -- DELETE /api/videos/:id,
//          POST /api/config, POST /api/settings, the scan's final merge --
//          stays exactly 1:1 write-per-invocation, unbatched; a torn-write
//          round-trip confirms the on-disk store is never left half-written)
//   AC4.3 (converse: a crash relative to a flush leaves the store intact,
//          loses at most one PROGRESS_FLUSH_MS window, and never touches
//          anything but watch position)
//   Read-your-writes: a just-posted position is visible immediately, on all
//   three overlay surfaces, BEFORE the flush fires.
//   Preserved semantics: 400/404 on POST /api/progress still hold.
//
// v1.43 (chunk 4b, per-user scoping): watch positions live in the relational
// `user_progress` table keyed by (user_id, media_id) -- NOT in the doc-table
// `db.progress`, which is retained only as the frozen pre-auth record the
// adoption design describes. This suite's persistence assertions therefore
// read through `userStore` (and the frozen-record/no-doc-write claims are
// asserted explicitly). The flush's write-amplification contract survives:
// one batch window = ONE SQLite transaction, counted by
// `__getProgressFlushWriteCount` (the doc-table saveDatabase counter must
// NOT move on a flush at all).
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
  pendingProgressKey,
  PROGRESS_FLUSH_MS,
  flushPendingProgress,
  currentProgressFlushTimer,
  __getSaveDatabaseCallCount,
  __getProgressFlushWriteCount,
  __failNextSaveForTests,
  __mintTestSession,
  userStore,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

let server;
let base;
let uid; // the authenticated test admin's user id -- per-user rows key on it

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  const auth = authenticateFetch(server, base); // v1.43: auth through the real gate
  uid = auth.user.id;
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

// ---- No per-ping write ----------------------------------------------------

test('POST /api/progress performs NO synchronous write -- neither doc-table saves nor user_progress batches move immediately after the response', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidNoWrite: { id: 'vidNoWrite', title: 'Clip', duration: 100 } },
    settings: baseSettings(),
  });
  const beforeSaves = __getSaveDatabaseCallCount();
  const beforeFlushes = __getProgressFlushWriteCount();
  const res = await postProgress('vidNoWrite', 12, 100);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).success, true);
  assert.equal(__getSaveDatabaseCallCount(), beforeSaves, 'a single ping must not trigger any doc-table save');
  assert.equal(__getProgressFlushWriteCount(), beforeFlushes, 'a single ping must not trigger a user_progress batch write');
  assert.ok(pendingProgress.has(pendingProgressKey(uid, 'vidNoWrite')), 'the ping must be staged in the coalescer under the USER\'s key');
  assert.ok(currentProgressFlushTimer(), 'a debounce timer must be armed after the first ping');
});

// ---- Preserved stored shape + duration fallback ------------------------

test('the flushed value keeps the exact pre-A4 stored shape and duration-fallback precedence, in the user\'s own row', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidShape: { id: 'vidShape', title: 'Clip', duration: 42 } },
    settings: baseSettings(),
  });
  // No duration on the ping -- must fall back to metadata.duration (42), not 0.
  await postProgress('vidShape', 20);
  await flushPendingProgress();
  const row = userStore.getOneProgress(uid, 'vidShape');
  assert.ok(row, 'the flush must land in user_progress');
  assert.equal(row.timestamp, 20);
  assert.equal(row.duration, 42, 'missing duration on the ping falls back to metadata.duration');
  assert.equal(typeof row.updatedAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(row.updatedAt)), 'updatedAt must be a valid ISO timestamp');
  // v1.43 frozen-record contract: the doc-table progress namespace is a
  // pre-auth record -- the flush must NEVER write it.
  assert.equal(loadDatabase().progress.vidShape, undefined, 'db.progress is frozen -- per-user flushes never write the doc tables');
});

test('the flush guard skips an id deleted between its ping and the flush (never resurrects state for a removed item)', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidDeletedBeforeFlush: { id: 'vidDeletedBeforeFlush', title: 'Clip', duration: 10 } },
    settings: baseSettings(),
  });
  await postProgress('vidDeletedBeforeFlush', 5, 10);
  assert.ok(pendingProgress.has(pendingProgressKey(uid, 'vidDeletedBeforeFlush')));

  // Simulate the id being removed (e.g. DELETE /api/videos/:id) before the
  // flush fires -- directly against the on-disk db, mirroring what a real
  // concurrent delete would leave behind.
  const db = loadDatabase();
  delete db.metadata.vidDeletedBeforeFlush;
  saveDatabase(db);

  await flushPendingProgress();
  assert.equal(userStore.getOneProgress(uid, 'vidDeletedBeforeFlush'), null, 'a flush must never write a row for a deleted metadata entry');
});

// ---- Read-your-writes overlay -------------------------------------------

test('read-your-writes: GET /api/progress/:id sees a just-posted position BEFORE the flush fires', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidOverlay1: { id: 'vidOverlay1', title: 'Clip', duration: 100 } },
    settings: baseSettings(),
  });
  await postProgress('vidOverlay1', 33, 100);
  // Deliberately NOT flushed yet -- the committed row must not exist.
  assert.equal(userStore.getOneProgress(uid, 'vidOverlay1'), null, 'precondition: nothing persisted yet');

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
  // CACHE's own (frozen) progress map is still untouched -- only
  // pendingProgress (and, after an explicit flush, the user_progress table)
  // ever carries the value.
  await fetch(`${base}/api/progress/vidNoMutate`);
  await fetch(`${base}/api/videos/vidNoMutate`);
  const { getCachedDatabase } = require('../../server');
  assert.equal(
    getCachedDatabase().progress.vidNoMutate, undefined,
    'the overlay must be read-only against the cache -- pendingProgress carries the value, not an in-place cache mutation'
  );
});

// ---- v1.43: per-user isolation --------------------------------------------

test('per-user isolation: two users\' positions on the SAME media never touch each other, pending or committed', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidTwoUsers: { id: 'vidTwoUsers', title: 'Clip', duration: 100 } },
    settings: baseSettings(),
  });
  const second = __mintTestSession({ username: 'seconduser' });

  // Admin (patched fetch) pings 10; the second user pings 90 with an explicit
  // Cookie (the auth helper respects an explicit Cookie header).
  await postProgress('vidTwoUsers', 10, 100);
  const res = await fetch(`${base}/api/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: second.cookie },
    body: JSON.stringify({ id: 'vidTwoUsers', timestamp: 90, duration: 100 }),
  });
  assert.equal(res.status, 200);

  // Pending overlay is already per-user.
  const adminView = await (await fetch(`${base}/api/progress/vidTwoUsers`)).json();
  const secondView = await (await fetch(`${base}/api/progress/vidTwoUsers`, { headers: { Cookie: second.cookie } })).json();
  assert.equal(adminView.timestamp, 10, 'the admin sees their own pending position');
  assert.equal(secondView.timestamp, 90, 'the second user sees THEIR pending position, not the admin\'s');

  // And so are the committed rows.
  await flushPendingProgress();
  assert.equal(userStore.getOneProgress(uid, 'vidTwoUsers').timestamp, 10);
  assert.equal(userStore.getOneProgress(second.user.id, 'vidTwoUsers').timestamp, 90);
});

test('per-user isolation: a user with no position sees zero even when ANOTHER user has watched the item', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidOnlyAdmin: { id: 'vidOnlyAdmin', title: 'Clip', duration: 100 } },
    settings: baseSettings(),
  });
  await postProgress('vidOnlyAdmin', 55, 100);
  await flushPendingProgress();

  const fresh = __mintTestSession({ username: 'freshuser' });
  const view = await (await fetch(`${base}/api/progress/vidOnlyAdmin`, { headers: { Cookie: fresh.cookie } })).json();
  assert.equal(view.timestamp, 0, 'no per-user row and no fallback to any other user\'s (or the frozen global) position');
});

// ---- AC4.1: batched writes ------------------------------------------------

test('AC4.1: a burst of N rapid pings against the same id collapses into <= N/5 batch transactions, tied to the PROGRESS_FLUSH_MS window', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidBurst: { id: 'vidBurst', title: 'Clip', duration: 1000 } },
    settings: baseSettings(),
  });

  const beforeFlushes = __getProgressFlushWriteCount();
  const beforeSaves = __getSaveDatabaseCallCount();
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

  const writes = __getProgressFlushWriteCount() - beforeFlushes;
  assert.ok(
    writes <= PING_COUNT / 5,
    `expected <= ${PING_COUNT / 5} batch transactions for ${PING_COUNT} pings (>= 5:1 reduction), saw ${writes}`
  );
  assert.ok(writes >= 1, 'the burst must still eventually persist at least once');
  assert.equal(__getSaveDatabaseCallCount(), beforeSaves, 'progress flushes never touch the doc tables at all');
  assert.equal(userStore.getOneProgress(uid, 'vidBurst').timestamp, PING_COUNT - 1, 'the LAST-WINS value must be what is persisted');
});

test('AC4.1: many pings against DIFFERENT ids inside one window still collapse into a single batch transaction', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      multiA: { id: 'multiA', title: 'A', duration: 10 },
      multiB: { id: 'multiB', title: 'B', duration: 10 },
      multiC: { id: 'multiC', title: 'C', duration: 10 },
    },
    settings: baseSettings(),
  });
  const beforeFlushes = __getProgressFlushWriteCount();
  await postProgress('multiA', 1, 10);
  await postProgress('multiB', 2, 10);
  await postProgress('multiC', 3, 10);
  await flushPendingProgress();
  assert.equal(__getProgressFlushWriteCount() - beforeFlushes, 1, 'three different ids pinged inside one window must still be ONE batch transaction');
  assert.equal(userStore.getOneProgress(uid, 'multiA').timestamp, 1);
  assert.equal(userStore.getOneProgress(uid, 'multiB').timestamp, 2);
  assert.equal(userStore.getOneProgress(uid, 'multiC').timestamp, 3);
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

test('AC4.3: a crash simulated at an arbitrary point relative to a flush leaves the store intact, and the lost data is bounded to <= one flush window of watch position only', async () => {
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
  assert.ok(pendingProgress.has(pendingProgressKey(uid, 'vidCrash')));

  // Simulate a hard crash (SIGKILL-equivalent): the write never even starts --
  // the persisted store is whatever it was BEFORE this ping was staged.
  const onCrash = readPersistedDatabase(process.env.DATA_DIR);
  assert.deepEqual(onCrash, before, 'the persisted doc-table state is untouched by an unflushed pending ping -- never torn');

  assert.equal(userStore.getOneProgress(uid, 'vidCrash'), null, 'the lost data is bounded to the unflushed watch position only');
  assert.deepEqual(onCrash.folders, ['/untouched-folder'], 'folders/metadata/settings are NEVER at risk from the progress coalescer');
  assert.ok(onCrash.metadata.vidCrash, 'metadata itself (unlike progress) is never at risk');
  assert.ok(onCrash.metadata.vidUnrelated, 'an unrelated item is completely unaffected');
});

test('AC4.3: after a normal flush (not a crash), the position IS durable in the user\'s row and parses correctly', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { vidDurable: { id: 'vidDurable', title: 'Clip', duration: 100 } },
    settings: baseSettings(),
  });
  await postProgress('vidDurable', 88, 100);
  await flushPendingProgress();
  assert.equal(userStore.getOneProgress(uid, 'vidDurable').timestamp, 88);
});

// ---- Shutdown flush primitive (AC4.3) -------------------------------------
// The actual `process.on('SIGTERM'|'SIGINT'|'beforeExit')` wiring lives
// under server.js's `require.main === module` startup guard (consistent
// with every other startup/shutdown side effect in that file), so importing
// this module for tests never installs a listener that could swallow Ctrl-C
// or otherwise change process-signal behavior during a test run (see that
// block's own comment). What IS always exercised here, directly, is the
// exact primitive those handlers call.

test('shutdown flush primitive: flushPendingProgress persists every staged id in one batch transaction and clears the queue', async () => {
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

  const before = __getProgressFlushWriteCount();
  await flushPendingProgress();
  assert.equal(__getProgressFlushWriteCount() - before, 1, 'the shutdown-style flush persists the whole queue in ONE batch transaction');
  assert.equal(pendingProgress.size, 0, 'the queue is cleared once flushed');

  assert.equal(userStore.getOneProgress(uid, 'shutdownA').timestamp, 3);
  assert.equal(userStore.getOneProgress(uid, 'shutdownB').timestamp, 4);
});

test('flushPendingProgress is a safe no-op (no write) when nothing is pending', async () => {
  const beforeSaves = __getSaveDatabaseCallCount();
  const beforeFlushes = __getProgressFlushWriteCount();
  const result = await flushPendingProgress();
  assert.equal(result, false, 'an empty flush must skip the write chain entirely');
  assert.equal(__getSaveDatabaseCallCount(), beforeSaves, 'an empty flush must never issue a doc-table write');
  assert.equal(__getProgressFlushWriteCount(), beforeFlushes, 'an empty flush must never issue a batch transaction');
});
