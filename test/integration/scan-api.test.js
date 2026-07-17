'use strict';

// Isolated DATA_DIR before requiring the app so the suite never reads or
// writes real project data. Own process per file (node --test) keeps this
// local, mirroring test/integration/api.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app,
  scanState,
  scanDirectories,
  armScanTimer,
  currentDeferredRescanTimer,
  loadDatabase,
  saveDatabase,
  getMediaId,
  transcodedPath,
  __resetDatabaseForTests,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;

// v1.30 A2: the scan is now cooperative (real `fs.promises` I/O + explicit
// `setImmediate` batch-yields, see server.js) rather than the old
// fully-synchronous walk. A tight `await new Promise(setImmediate)` spin
// loop can burn through hundreds of iterations in single-digit milliseconds
// when nothing is actually ready in the poll phase yet, so a fixed ITERATION
// count is not a reliable proxy for "gave the scan enough real time to
// finish" once the scan's own progress depends on genuine (and, under
// full-suite CI/threadpool contention, variable-latency) disk I/O -- bound
// by WALL-CLOCK time instead. Cheap when the scan finishes quickly (the loop
// exits the moment `scanState.scanning` flips false); only matters as a
// dead-man's-switch ceiling otherwise.
async function waitForScanIdle(maxWaitMs = 5000) {
  const start = Date.now();
  while (scanState.scanning && (Date.now() - start) < maxWaitMs) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
});

after(async () => {
  // fetch (undici) pools keep-alive sockets; force them shut so close() resolves
  // promptly instead of waiting on idle connections (avoids CI hangs).
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  // Start each test from a clean, idle scan state and a fresh persisted
  // store so settings-driven assertions (armScanTimer) aren't polluted
  // across tests.
  scanState.scanning = false;
  scanState.rescanRequested = false;
  await __resetDatabaseForTests();
  // A budget-exhausted drain (FR3.4's sustained-demand test included) can
  // leave a deferred rescan armed (tech-debt #3's fix, below). Fire it
  // directly -- rather than merely clearTimeout-ing it, which would leave
  // the module's internal handle referencing a dead-but-non-null Timeout
  // forever -- so it never fires a stray background scan during a LATER
  // test, and so every test (including this suite's own deferred-rescan
  // test) starts from a genuinely clean (deferredRescanTimer === null)
  // precondition rather than an artifact of test order.
  const leftoverTimer = currentDeferredRescanTimer();
  if (leftoverTimer) {
    leftoverTimer._onTimeout();
    await waitForScanIdle();
  }
});

// v1.30 A2 (AC2.1, CONTRACT CHANGE): POST /api/scan no longer awaits the scan
// (it can no longer meaningfully return 200-after-completion once the scan
// is cooperative/long-running) -- it fires the scan in the background and
// acks immediately with 202. Both the idle and already-in-progress cases now
// share the same 202 status; only `alreadyInProgress` distinguishes them
// (the old 409-when-busy branch is gone).
test('POST /api/scan returns 202 {scanning:true, alreadyInProgress:false} when idle, and does not wait for the scan to finish', async () => {
  assert.equal(scanState.scanning, false, 'precondition: idle');
  const res = await fetch(`${base}/api/scan`, { method: 'POST' });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { scanning: true, alreadyInProgress: false });
  // AC2.1: the ack must have arrived while the fire-and-forget scan it just
  // kicked off is still (or already) running -- proven here by the fact the
  // request resolved at all without this test itself awaiting scanDirectories.
  // Let the background scan actually settle before the next test/teardown.
  await waitForScanIdle();
});

test('POST /api/scan returns 202 {scanning:true, alreadyInProgress:true} while a scan is already in progress, and flags a coalesced follow-up', async () => {
  // Force the concurrent state directly on the shared scanState object
  // (same module instance the running app uses) rather than racing a real
  // scan, per the integration-test pattern for exercising route state.
  scanState.scanning = true;
  try {
    const res = await fetch(`${base}/api/scan`, { method: 'POST' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { scanning: true, alreadyInProgress: true });
    // C: a manual "Scan now" fired while a scan is in progress must not be
    // silently dropped -- it flags a coalesced follow-up pass instead.
    assert.equal(scanState.rescanRequested, true, 'the alreadyInProgress branch must flag a follow-up rescan');
  } finally {
    scanState.scanning = false;
    scanState.rescanRequested = false;
  }
});

test('overlap guard: scanDirectories() no-ops (beyond flagging a follow-up) on the timer-driven path while scanning', async () => {
  // armScanTimer's periodic callback is literally `() => scanDirectories()...`,
  // so exercising scanDirectories() directly while scanState.scanning is true
  // is equivalent coverage for the timer-driven path (in addition to the
  // /api/scan route path covered above) without waiting on a real interval.
  scanState.scanning = true;
  const lastScanBefore = scanState.lastScan;
  await scanDirectories();
  // The guard returns before the try/finally, so it never touches lastScan
  // and never flips scanState.scanning back to false — proof no second scan
  // ran to completion underneath it. It DOES flag the coalesced follow-up.
  assert.equal(scanState.scanning, true, 'scanning flag untouched by the no-op call');
  assert.equal(scanState.lastScan, lastScanBefore, 'lastScan untouched by the no-op call');
  assert.equal(scanState.rescanRequested, true, 'a scan requested mid-scan must be flagged, not dropped');
  scanState.scanning = false;
  scanState.rescanRequested = false;
});

// ---- C: coalesced rescan-requested drain --------------------------------

test('C: a rescan requested while a scan is in flight results in exactly one coalesced follow-up pass', async () => {
  // Folder A is known to db.folders at scan start; folder B is added to
  // db.folders (mirrors POST /api/config's synchronous db.folders write)
  // WHILE the first pass is paused -- so the first pass's already-captured
  // `currentFolders` snapshot never sees it, and only the coalesced
  // follow-up (triggered by a second scanDirectories() call landing while
  // scanState.scanning is true) picks it up.
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-followup-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-followup-b-'));
  fs.writeFileSync(path.join(dirA, 'a.mp4'), 'video-a-bytes');
  fs.writeFileSync(path.join(dirB, 'b.mp4'), 'video-b-bytes');

  saveDatabase({
    folders: [dirA],
    folderSettings: {},
    progress: {},
    metadata: {},
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });

  const scanPromise = scanDirectories();

  // Still in the same synchronous tick as the call above (the scan is paused
  // on its one await point, having already snapshotted db.folders = [dirA]):
  const db = loadDatabase();
  db.folders = [dirA, dirB];
  saveDatabase(db);
  // A second scanDirectories() call lands while scanState.scanning is still
  // true -- it must coalesce into a follow-up, not silently drop.
  await scanDirectories();
  assert.equal(scanState.rescanRequested, true, 'the second call while scanning must flag a follow-up');

  await scanPromise;

  assert.equal(scanState.scanning, false, 'scanning must settle back to idle after the coalesced follow-up drains');
  const finalDb = loadDatabase();
  const paths = Object.values(finalDb.metadata).map((m) => m.filePath);
  assert.ok(paths.some((p) => p.endsWith('a.mp4')), 'folder A (present at scan start) must be indexed');
  assert.ok(paths.some((p) => p.endsWith('b.mp4')), 'folder B (added mid-scan) must be indexed by the coalesced follow-up');
});

// ---- FR3.4: the coalesced drain is BOUNDED, not livelockable --------------

test('FR3.4: sustained scan requests during an in-flight scan do not chain unboundedly -- the drain settles well before an exhaustive demand budget runs out', async () => {
  // Mirrors the demand pattern that could livelock the OLD unbounded
  // `do { ... } while (scanState.rescanRequested)` drain: CONTINUOUS new-file
  // ingest plus SUSTAINED /api/scan-equivalent requests landing throughout an
  // in-flight scan. Each iteration below only fires while `scanState.scanning`
  // is STILL true (i.e., genuinely "during an in-flight scan", the same
  // precondition test C already exercises once) -- so if the drain were
  // unbounded, continuously re-flagging `rescanRequested` on every iteration
  // would keep it in-flight for the ENTIRE demand budget below (an unbounded
  // drain never lets `scanState.scanning` go false while demand keeps
  // arriving). The bounded fix must let it settle well before that budget is
  // exhausted, regardless of how much further demand keeps arriving.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-livelock-'));
  fs.writeFileSync(path.join(dir, 'seed.mp4'), 'seed');

  saveDatabase({
    folders: [dir],
    folderSettings: {},
    progress: {},
    metadata: {},
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });

  const scanPromise = scanDirectories();

  // v1.30 A2: the walk is now cooperative (real `fs.promises` I/O queued on
  // libuv's threadpool) rather than the old fully-synchronous walk, so the
  // background scan's own progress is now paced by genuine (and, under
  // full-suite CI/CPU/threadpool contention, VARIABLE-latency) disk I/O --
  // whereas this demand loop's own `setImmediate` yields are purely
  // in-process and fire at a roughly constant rate regardless of threadpool
  // load. A fixed ITERATION-count budget can't reliably bound that race
  // (under heavy contention the demand loop can burn through hundreds of
  // fast in-process turns before the scan's threadpool-bound callback ever
  // fires), so this asserts a generous WALL-CLOCK window instead -- still
  // reliably catches a genuine livelock (which would never let
  // `scanState.scanning` go false no matter how much real time passes), but
  // isn't sensitive to the relative throughput of two different clocks.
  const DEMAND_WINDOW_MS = 5000; // generous; a livelocked drain would consume every one of these
  const demandStart = Date.now();
  let attempts = 0;
  while (scanState.scanning && (Date.now() - demandStart) < DEMAND_WINDOW_MS) {
    attempts++;
    fs.writeFileSync(path.join(dir, `demand${attempts}.mp4`), String(attempts));
    // Simulates another /api/scan (or /api/config-triggered) request landing
    // while the original scan is still in flight. `setImmediate` mirrors a
    // real concurrent request's own natural yield back to the event loop.
    await scanDirectories();
    await new Promise(setImmediate);
  }
  const demandElapsedMs = Date.now() - demandStart;

  await scanPromise;

  assert.equal(scanState.scanning, false, 'the drain must settle back to idle');
  assert.ok(demandElapsedMs < DEMAND_WINDOW_MS,
    `the in-flight drain must settle well before a ${DEMAND_WINDOW_MS}ms continuous-demand window runs out ` +
    `(consumed ${demandElapsedMs}ms across ${attempts} attempts) -- an unbounded drain would keep chaining for ` +
    'as long as demand keeps arriving and would exhaust the whole window without ever letting scanState.scanning go false');
});

// ---- tech-debt #3: deferred-rescan tail for a budget-exhausted drain ------

// Drives scanDirectories() through one full "budget-exhausted, rescan still
// pending" cycle: pass 1 (on `folder`, which has one new file to await on)
// gets a follow-up flagged mid-flight by `triggerFolder` landing (a new
// folder with its own new file, unseen by pass 1's already-snapshotted
// folder list -- mirrors test C above); MAX_RESCAN_FOLLOWUPS = 1 means that
// follow-up (pass 2, which picks up `triggerFolder`) is the LAST pass the
// drain will ever run, so sustained demand for the rest of the drain (fired
// for as long as scanState.scanning stays true) is guaranteed to land at
// least once while pass 2 is still mid-flight -- flagging rescanRequested
// one final time that the bounded drain can no longer service. Returns the
// number of sustained-demand attempts consumed (for the "well under budget"
// assertion), leaving scanState.rescanRequested = true afterward -- the
// tech-debt #3 drop this task's deferred-rescan tail must no longer lose.
async function exhaustDrainWithPendingRescan(folder, triggerFolder) {
  const scanPromise = scanDirectories(); // pass 1: pauses on `folder`'s new file

  const db = loadDatabase();
  db.folders = [...db.folders, triggerFolder];
  saveDatabase(db);
  await scanDirectories(); // sets rescanRequested = true (pass 1 still in flight)
  assert.equal(scanState.rescanRequested, true, 'pass 1 in flight must flag the one allowed follow-up');

  // v1.30 A2: see the FR3.4 test's own comment above for why this uses a
  // generous WALL-CLOCK window rather than a fixed iteration count -- the
  // two-pass drain's own progress is now paced by genuine (variable-latency
  // under CI/threadpool contention) `fs.promises` I/O, which a same-process
  // iteration budget can't reliably race against.
  const DEMAND_WINDOW_MS = 8000; // generous; the two-pass drain settles well before this
  const demandStart = Date.now();
  let attempts = 0;
  while (scanState.scanning && (Date.now() - demandStart) < DEMAND_WINDOW_MS) {
    attempts++;
    // See the FR3.4 test above for why a genuine macrotask yield
    // (`setImmediate`) is required here post-v1.30 A2, not just the
    // microtask-only no-op resolution of `scanDirectories()` itself.
    await scanDirectories();
    await new Promise(setImmediate);
  }
  const demandElapsedMs = Date.now() - demandStart;
  await scanPromise;

  assert.equal(scanState.scanning, false, 'the drain must settle back to idle');
  assert.ok(demandElapsedMs < DEMAND_WINDOW_MS,
    `the drain must settle well before the ${DEMAND_WINDOW_MS}ms demand window runs out ` +
    `(consumed ${demandElapsedMs}ms across ${attempts} attempts)`);
  assert.equal(scanState.rescanRequested, true,
    'the budget-exhausted drain must leave the pending rescan flagged, not silently clear it');
}

test('deferred rescan (tech-debt #3): a budget-exhausted drain schedules exactly one rate-limited follow-up that self-heals the pending work, never stacks a second, and leaves no dangling timer', async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-deferred-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-deferred-b-'));
  const dirD = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-deferred-d-'));
  const dirC = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-deferred-c-'));
  fs.writeFileSync(path.join(dirA, 'a.mp4'), 'a');
  fs.writeFileSync(path.join(dirB, 'b.mp4'), 'b');
  fs.writeFileSync(path.join(dirD, 'd.mp4'), 'd');
  fs.writeFileSync(path.join(dirC, 'c.mp4'), 'c');

  saveDatabase({
    folders: [dirA],
    folderSettings: {},
    progress: {},
    metadata: {},
    // Off: no periodic timer to self-heal a dropped rescan -- exactly the
    // scenario tech-debt #3 documents.
    settings: { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });

  assert.equal(currentDeferredRescanTimer(), null, 'precondition: no deferred rescan pending');

  try {
    // Round 1: exhaust the drain's budget with a rescan still pending.
    await exhaustDrainWithPendingRescan(dirA, dirB);

    const timer = currentDeferredRescanTimer();
    assert.ok(timer, 'a deferred rescan must be scheduled when the drain exhausts its budget with a rescan still pending');
    assert.equal(timer.hasRef(), false, "the deferred timer must be unref()'d so it never keeps the process/test runner alive");

    // Round 2: at-most-one-pending. A second budget exhaustion while a
    // deferred rescan is already scheduled must not stack a second timer --
    // the single guard (`if (deferredRescanTimer) return`) must fire, so the
    // SAME timer identity survives untouched.
    await exhaustDrainWithPendingRescan(dirA, dirD);
    assert.equal(currentDeferredRescanTimer(), timer,
      'a second budget exhaustion while one deferred rescan is already pending must not stack a new timer');

    // A folder-add that lands after the drain has already settled (the exact
    // "auto-scan Off" gap tech-debt #3 describes) is still sitting unindexed,
    // relying entirely on the deferred timer to ever pick it up.
    const dbBeforeFire = loadDatabase();
    dbBeforeFire.folders = [...dbBeforeFire.folders, dirC];
    saveDatabase(dbBeforeFire);

    // Trigger the deferred pass deterministically instead of a flaky real
    // 5s wait: invoke the already-scheduled Timeout's callback directly (the
    // accessor pattern the rest of this suite already uses for
    // `currentScanTimer`, extended to actually fire it here).
    timer._onTimeout();
    assert.equal(currentDeferredRescanTimer(), null, 'firing the deferred timer must clear its own handle');

    // The fired callback's scanDirectories() call runs asynchronously (fire-
    // and-forget, mirroring armScanTimer's periodic callback) -- poll for it
    // to settle without a fixed real-time sleep.
    await waitForScanIdle();
    assert.equal(scanState.scanning, false, 'the deferred follow-up scan must complete');

    const finalDb = loadDatabase();
    const paths = Object.values(finalDb.metadata).map((m) => m.filePath);
    assert.ok(paths.some((p) => p.endsWith('d.mp4')), "round 2's folder must be indexed by its own coalesced follow-up");
    assert.ok(paths.some((p) => p.endsWith('c.mp4')), 'the deferred follow-up must index the folder-add left pending after the drain settled');
  } finally {
    // No dangling timer: whether the assertions above passed or threw, never
    // leave a live timer behind for later tests/process exit.
    const leftover = currentDeferredRescanTimer();
    if (leftover) clearTimeout(leftover);
  }
});

test('armScanTimer arms a 30-minute interval by default (old/fresh db.json with no settings)', () => {
  // No db.json yet -> loadDatabase() creates one with the backfilled default
  // settings, whose scanIntervalMinutes is 30 (the intentional 10min->30m
  // change), not the old hardcoded 10-minute interval.
  const timer = armScanTimer();
  try {
    assert.ok(timer, 'a timer should be armed with default settings');
    assert.equal(timer._idleTimeout, 30 * 60 * 1000, 'interval should be 30 minutes');
  } finally {
    clearInterval(timer);
  }
});

test('armScanTimer arms no timer when scanIntervalMinutes is Off (0)', () => {
  // v1.30 A3 (in-memory DB read cache): seed via `saveDatabase()` (an
  // established test primitive, see CONTRIBUTING.md) rather than a raw
  // `fs.writeFileSync`, so the in-process db cache stays coherent.
  saveDatabase({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {},
    settings: { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
  const timer = armScanTimer();
  assert.strictEqual(timer, null, 'Off should arm no timer at all');
});

// v1.30 A2 (AC2.2): processed/total/phase added for cooperative-scan progress.
test('GET /api/scan-status response shape (FR-3: transcodeNames/transcodeOverflow added; A2: processed/total/phase added)', async () => {
  const res = await fetch(`${base}/api/scan-status`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(
    Object.keys(json).sort(),
    [
      'fileCount', 'folderCount', 'lastScan', 'phase', 'processed', 'scanning',
      'total', 'transcodeNames', 'transcodeOverflow', 'transcoding',
    ].sort()
  );
});

// ---- FR-3 (v1.18.0, T4): restored pending-transcode list, bounded ---------

// Builds a metadata entry the same shape scanDirectories/reconcileTranscode
// would produce -- this test writes the db directly (no real scan/ffprobe)
// since GET /api/scan-status only ever reads the already-computed
// `needsTranscode`/`transcodeStatus` fields, the SAME filter the endpoint has
// always used for the `transcoding` count.
function pendingItem(id, title, overrides) {
  return {
    id, name: `${title}.mp4`, title, filePath: `/x/${title}.mp4`,
    folderName: 'x', size: 1, ext: '.mp4', type: 'video', addedAt: Date.now(),
    duration: 1, hasThumbnail: false, artist: '',
    needsTranscode: true, transcodeStatus: 'pending',
    ...overrides,
  };
}

test('GET /api/scan-status: transcodeNames reflects codec-flagged items via the SAME needsTranscode/transcodeStatus filter as `transcoding`', async () => {
  const metadata = {
    'legacy-avi': pendingItem('legacy-avi', 'legacy-clip', { ext: '.avi', needsTranscode: true }),
    'hevc-mp4': pendingItem('hevc-mp4', 'hevc-clip', { ext: '.mp4', videoCodec: 'hevc', needsTranscode: true }),
    'ready-mp4': pendingItem('ready-mp4', 'already-ready', { ext: '.mp4', videoCodec: 'h264', audioCodec: 'aac', needsTranscode: false, transcodeStatus: undefined }),
    'not-flagged': pendingItem('not-flagged', 'never-needed-it', { needsTranscode: false, transcodeStatus: undefined }),
  };
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata, settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });

  const res = await fetch(`${base}/api/scan-status`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.transcoding, 2, 'only the two in-flight-needing-transcode items count');
  assert.deepEqual(json.transcodeNames.sort(), ['hevc-clip', 'legacy-clip'].sort(), 'the codec-flagged HEVC .mp4 appears exactly like the legacy .avi -- same filter, no divergent path');
  assert.equal(json.transcodeOverflow, 0, 'no overflow under the cap');
});

test('GET /api/scan-status: transcodeNames is capped at 10 with the remainder reported via transcodeOverflow', async () => {
  const metadata = {};
  for (let i = 0; i < 15; i++) {
    metadata[`item-${i}`] = pendingItem(`item-${i}`, `clip-${i}`);
  }
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata, settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });

  const res = await fetch(`${base}/api/scan-status`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.transcoding, 15, 'the count reflects the full pending set, uncapped');
  assert.equal(json.transcodeNames.length, 10, 'the names array is capped at TRANSCODE_LIST_CAP');
  assert.equal(json.transcodeOverflow, 5, '15 pending - 10 shown = 5 overflow');
});

test('GET /api/scan-status: an empty pending-transcode set returns an empty transcodeNames array and zero overflow', async () => {
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });

  const res = await fetch(`${base}/api/scan-status`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.transcoding, 0);
  assert.deepEqual(json.transcodeNames, []);
  assert.equal(json.transcodeOverflow, 0);
});

// ---- FR3.3: transcodeStatus merge preserves a concurrent worker write -----

function baseFr33Settings() {
  return { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 };
}

// `setTranscodeStatus` (the real function a transcode worker calls) isn't
// exported, so this reproduces its exact loadDatabase/mutate/saveDatabase
// write -- the same synchronous-write technique test/integration/
// scan-clobber.test.js uses for its concurrent settings/recordServed writes.
// Fired in the SAME synchronous tick as the in-flight scan (before awaiting
// it), this deterministically lands inside the scan's stale-snapshot window
// (after its initial read, before its final save) with no FFmpeg dependency
// -- see that file's timing note for why a real HTTP request could never
// reliably land there instead.
function writeConcurrentTranscodeStatus(id, status) {
  const db = loadDatabase();
  db.metadata[id].transcodeStatus = status;
  saveDatabase(db);
}

test('FR3.3 HEADLINE: a mid-scan setTranscodeStatus write to \'failed\' survives the scan\'s final save, and GET /video/:id reports it without re-enqueuing', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fr33-headline-'));

  // A brand-new file forces the scan to `await extractMetadataAndThumbnail`,
  // its one yield point.
  fs.writeFileSync(path.join(libDir, 'new-file.mp4'), 'new-video-bytes');

  // The AVI entry already has an up-to-date metadata entry (same
  // filePath/size) -- the scan reuses it verbatim (no extraction, no await)
  // while paused on the new file above.
  const aviPath = path.join(libDir, 'existing.avi');
  fs.writeFileSync(aviPath, 'avi-bytes');
  const aviSize = fs.statSync(aviPath).size;
  const id = getMediaId(aviPath);

  saveDatabase({
    folders: [libDir],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'existing.avi', title: 'existing', filePath: aviPath,
        folderName: path.basename(libDir), size: aviSize, ext: '.avi', type: 'video',
        addedAt: Date.now(), duration: 5, hasThumbnail: false, artist: '',
        rootFolder: libDir, needsTranscode: true, transcodeStatus: 'processing',
      },
    },
    settings: baseFr33Settings(),
  });

  const scanPromise = scanDirectories();

  // Concurrent worker write, in the same synchronous tick as the scan start
  // (before its deferred continuation runs) -- the transcode failed while the
  // scan was paused on the new file above.
  writeConcurrentTranscodeStatus(id, 'failed');

  await scanPromise;

  const finalDb = loadDatabase();
  assert.equal(
    finalDb.metadata[id].transcodeStatus, 'failed',
    'a transcodeStatus written during the scan must survive the scan\'s final save, not be reverted to the stale scan-start snapshot'
  );

  const res = await fetch(`${base}/video/${id}`);
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.status, 'failed', 'GET /video/:id must report the failed status');
  // No cached MP4 exists, so /video/:id only skips queueTranscode when
  // `item.transcodeStatus === 'failed'` (server.js's
  // `if (item.transcodeStatus !== 'failed') queueTranscode(...)` guard) --
  // the response reporting 'failed' here is direct proof that guard (and not
  // a re-enqueue) fired.
});

test('FR3.3: a legitimate \'ready\' (finished MP4 present on disk) still wins over a stale/concurrent transcodeStatus', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fr33-ready-'));
  fs.writeFileSync(path.join(libDir, 'new-file.mp4'), 'new-video-bytes');

  const aviPath = path.join(libDir, 'existing.avi');
  fs.writeFileSync(aviPath, 'avi-bytes');
  const aviSize = fs.statSync(aviPath).size;
  const id = getMediaId(aviPath);

  // The transcode already finished and its MP4 is cached on disk before the
  // scan even starts.
  fs.writeFileSync(transcodedPath(id), 'finished-mp4-bytes');

  saveDatabase({
    folders: [libDir],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'existing.avi', title: 'existing', filePath: aviPath,
        folderName: path.basename(libDir), size: aviSize, ext: '.avi', type: 'video',
        addedAt: Date.now(), duration: 5, hasThumbnail: false, artist: '',
        rootFolder: libDir, needsTranscode: true,
        // No transcodeStatus at scan-start (absent snapshot).
      },
    },
    settings: baseFr33Settings(),
  });

  const scanPromise = scanDirectories();

  // A concurrent worker write also lands mid-scan, setting a stale
  // 'processing' -- the finished MP4 already on disk must still win.
  writeConcurrentTranscodeStatus(id, 'processing');

  await scanPromise;

  const finalDb = loadDatabase();
  assert.equal(
    finalDb.metadata[id].transcodeStatus, 'ready',
    'a finished cached MP4 on disk must win over a stale/absent snapshot and a racing processing write'
  );
});

test('FR3.3: a stale \'ready\' status with no cached MP4 is still cleared by the scan', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fr33-stale-ready-'));

  const aviPath = path.join(libDir, 'existing.avi');
  fs.writeFileSync(aviPath, 'avi-bytes');
  const aviSize = fs.statSync(aviPath).size;
  const id = getMediaId(aviPath);

  // No cached MP4 on disk (never produced, or evicted) -- 'ready' is stale.
  saveDatabase({
    folders: [libDir],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'existing.avi', title: 'existing', filePath: aviPath,
        folderName: path.basename(libDir), size: aviSize, ext: '.avi', type: 'video',
        addedAt: Date.now(), duration: 5, hasThumbnail: false, artist: '',
        rootFolder: libDir, needsTranscode: true, transcodeStatus: 'ready',
      },
    },
    settings: baseFr33Settings(),
  });

  await scanDirectories();

  const finalDb = loadDatabase();
  assert.equal(
    finalDb.metadata[id].transcodeStatus, undefined,
    'a stale ready status with no cached MP4 on disk must be cleared by the scan'
  );
});

test('FR3.3 conflict edge: a finished MP4 present concurrently with a worker\'s \'failed\' write still resolves to \'ready\'', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fr33-conflict-'));
  fs.writeFileSync(path.join(libDir, 'new-file.mp4'), 'new-video-bytes');

  const aviPath = path.join(libDir, 'existing.avi');
  fs.writeFileSync(aviPath, 'avi-bytes');
  const aviSize = fs.statSync(aviPath).size;
  const id = getMediaId(aviPath);

  // The transcode actually finished before the scan started.
  fs.writeFileSync(transcodedPath(id), 'finished-mp4-bytes');

  saveDatabase({
    folders: [libDir],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'existing.avi', title: 'existing', filePath: aviPath,
        folderName: path.basename(libDir), size: aviSize, ext: '.avi', type: 'video',
        addedAt: Date.now(), duration: 5, hasThumbnail: false, artist: '',
        rootFolder: libDir, needsTranscode: true, transcodeStatus: 'processing',
      },
    },
    settings: baseFr33Settings(),
  });

  const scanPromise = scanDirectories();

  // A racing 'failed' report about the (since-completed) file -- reconcile
  // still wins with 'ready' because the finished MP4 on disk is positive
  // proof of a streamable artifact.
  writeConcurrentTranscodeStatus(id, 'failed');

  await scanPromise;

  const finalDb = loadDatabase();
  assert.equal(
    finalDb.metadata[id].transcodeStatus, 'ready',
    'a completed MP4 on disk must win over a racing failed report -- ready requires a real file, so this is correct'
  );
});
