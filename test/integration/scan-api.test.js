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
