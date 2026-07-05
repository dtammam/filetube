'use strict';

// Isolated DATA_DIR before requiring the app so the suite never reads or
// writes real project data. Own process per file (node --test) keeps this
// local, mirroring test/integration/api.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
const DB_FILE = path.join(process.env.DATA_DIR, 'db.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app,
  scanState,
  scanDirectories,
  armScanTimer,
  loadDatabase,
  saveDatabase,
  getMediaId,
  transcodedPath,
} = require('../../server');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // fetch (undici) pools keep-alive sockets; force them shut so close() resolves
  // promptly instead of waiting on idle connections (avoids CI hangs).
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  // Start each test from a clean, idle scan state and a fresh db.json so
  // settings-driven assertions (armScanTimer) aren't polluted across tests.
  scanState.scanning = false;
  scanState.rescanRequested = false;
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
});

test('POST /api/scan returns 200 {success:true} when idle', async () => {
  assert.equal(scanState.scanning, false, 'precondition: idle');
  const res = await fetch(`${base}/api/scan`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true });
});

test('POST /api/scan returns 409 while a scan is already in progress, and flags a coalesced follow-up', async () => {
  // Force the concurrent state directly on the shared scanState object
  // (same module instance the running app uses) rather than racing a real
  // scan, per the integration-test pattern for exercising route state.
  scanState.scanning = true;
  try {
    const res = await fetch(`${base}/api/scan`, { method: 'POST' });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'scan already in progress' });
    // C: a manual "Scan now" fired while a scan is in progress must not be
    // silently dropped -- it flags a coalesced follow-up pass instead.
    assert.equal(scanState.rescanRequested, true, 'the 409 branch must flag a follow-up rescan');
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

  const DEMAND_BUDGET = 20; // generous; a livelocked drain would consume every one of these
  let attempts = 0;
  while (scanState.scanning && attempts < DEMAND_BUDGET) {
    attempts++;
    fs.writeFileSync(path.join(dir, `demand${attempts}.mp4`), String(attempts));
    // Simulates another /api/scan (or /api/config-triggered) request landing
    // while the original scan is still in flight.
    await scanDirectories();
  }

  await scanPromise;

  assert.equal(scanState.scanning, false, 'the drain must settle back to idle');
  assert.ok(attempts < DEMAND_BUDGET,
    `the in-flight drain must settle well before a ${DEMAND_BUDGET}-request continuous-demand budget runs out ` +
    `(only consumed ${attempts}) -- an unbounded drain would keep chaining for as long as demand keeps arriving ` +
    'and would exhaust the whole budget without ever letting scanState.scanning go false');
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
  fs.writeFileSync(DB_FILE, JSON.stringify({
    folders: [],
    folderSettings: {},
    progress: {},
    metadata: {},
    settings: { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  }));
  const timer = armScanTimer();
  assert.strictEqual(timer, null, 'Off should arm no timer at all');
});

test('GET /api/scan-status response shape is unchanged', async () => {
  const res = await fetch(`${base}/api/scan-status`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(
    Object.keys(json).sort(),
    ['fileCount', 'folderCount', 'lastScan', 'scanning', 'transcoding'].sort()
  );
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
