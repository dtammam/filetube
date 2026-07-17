'use strict';

// [INTEGRATION] v1.30 A2 -- cooperative/non-blocking scan (server.js). Covers
// the ACs the T2 task inbox calls out as needing DIRECT test coverage beyond
// what test/integration/scan-api.test.js's contract-change updates and
// test/integration/scan-prune.test.js's mount-loss/prune suite already prove:
//
//   AC1.1 (heartbeat/timer-drift proxy) + AC1.2 (scan-while-serving latency)
//   AC2.1 (202 ack arrives before the scan completes, regardless of size)
//   AC2.2 (GET /api/scan-status reports monotonic progress + a terminal state)
//   AC2.4 (a background scan never gates route-serving -- boot-scan proxy)
//   AC1.6/AC1.7 (incremental reuse both directions, confirmed post-conversion)
//
// Timing bounds below are deliberately more generous than the design doc's
// PROPOSED production defaults (~50ms/stretch, ~200ms concurrent-request,
// ~100ms ack) -- this suite runs alongside many other test files under
// `npm test` (real CPU/disk-threadpool contention), and per the design doc's
// own guidance ("Generous enough to avoid flaking on slower CI/dev hardware,
// tight enough to prove the scan isn't monopolizing the loop"), a test-only
// tolerance multiplier is expected. The MECHANISM under test (heartbeat
// timer-drift, request-during-scan latency, ack-before-completion,
// monotonic-progress polling) is unchanged from what the design specifies --
// only the numeric CI tolerance is relaxed. No FFmpeg needed (fixtures below
// are pre-populated as fully "unchanged" so the reuse fast-path never calls
// out to ffprobe/ffmpeg at all).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scan-cooperative-'));
const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app,
  scanState,
  scanDirectories,
  loadDatabase,
  saveDatabase,
  getMediaId,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

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

function baseSettings(overrides) {
  return {
    scanIntervalMinutes: 30,
    pruneMissing: true,
    cacheMaxBytes: null,
    cacheMaxAgeDays: 30,
    ...overrides,
  };
}

async function waitForScanIdle(maxWaitMs = 10000) {
  const start = Date.now();
  while (scanState.scanning && (Date.now() - start) < maxWaitMs) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Builds a library of `count` files that are ALREADY fully indexed and
// "unchanged" (matching filePath+size, real on-disk thumbnail present,
// codec fields present, needsTranscode false) -- a rescan of this fixture
// takes ONLY the plain reuse fast-path for every item (no ffprobe/ffmpeg
// spawn, no `extractMetadataAndThumbnail` call at all), so its cost is
// dominated purely by the walk (readdir/stat) + the cheap per-item
// reconciliation loop -- exactly the scenario AC1.1's "rescan of an
// unchanged library" targets.
function buildUnchangedLibrary(count) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cooperative-lib-'));
  const metadata = {};
  for (let i = 0; i < count; i++) {
    const filePath = path.join(root, `file${i}.mp4`);
    fs.writeFileSync(filePath, 'x');
    const id = getMediaId(filePath);
    const size = fs.statSync(filePath).size;
    fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'thumb-bytes');
    metadata[id] = {
      id, name: `file${i}.mp4`, title: `file${i}`, filePath,
      folderName: path.basename(root), size, ext: '.mp4', type: 'video',
      addedAt: Date.now(), duration: 5, hasThumbnail: true, artist: '',
      rootFolder: root, videoCodec: 'h264', audioCodec: 'aac',
      needsTranscode: false, releaseDate: Date.now(),
    };
  }
  saveDatabase({
    folders: [root], folderSettings: {}, progress: {}, metadata,
    settings: baseSettings(),
  });
  return { root, metadata };
}

// ---- AC1.1 + AC1.2 --------------------------------------------------------

test('AC1.1/AC1.2: a rescan of ~1300 unchanged items never stalls the event loop for long, and a concurrent request during it returns quickly with a correct payload', async () => {
  const { metadata } = buildUnchangedLibrary(1300);
  const expectedCount = Object.keys(metadata).length;

  // AC1.1: heartbeat/timer-drift probe -- arm a short-period timer BEFORE
  // the scan starts and record its actual fire-to-fire deltas throughout.
  // A synchronous stretch that blocks the event loop shows up as a delta
  // far larger than the timer's own period.
  const HEARTBEAT_MS = 10;
  let lastBeat = Date.now();
  let maxGapMs = 0;
  const heartbeat = setInterval(() => {
    const now = Date.now();
    const gap = now - lastBeat;
    if (gap > maxGapMs) maxGapMs = gap;
    lastBeat = now;
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const scanPromise = scanDirectories();

  // AC1.2: while that SAME rescan is in flight, issue a concurrent request
  // and assert it returns promptly with a correct payload -- not queued
  // behind the scan. v1.30 A5 (T6): `/api/videos` is now paginated
  // (`{ items, total, offset, limit }`); request the full library in one
  // page (limit=expectedCount) so "correct, complete payload" still means
  // every item is present, and additionally assert `total` reflects the
  // full filtered count regardless of page size.
  const reqStart = Date.now();
  const res = await fetch(`${base}/api/videos?limit=${expectedCount}`);
  const reqElapsedMs = Date.now() - reqStart;
  assert.equal(res.status, 200);
  const { items, total } = await res.json();
  assert.equal(total, expectedCount, 'the concurrent request must see the correct, complete total');
  assert.equal(items.length, expectedCount, 'the concurrent request must see the correct, complete payload');
  assert.ok(reqElapsedMs < 2000,
    `a request issued while the scan is in flight must return promptly, not be queued behind it (took ${reqElapsedMs}ms)`);

  await scanPromise;
  clearInterval(heartbeat);

  assert.ok(maxGapMs < 2000,
    `no single synchronous stretch during the unchanged-library rescan should block the event loop for long (worst observed heartbeat gap: ${maxGapMs}ms)`);
});

// ---- AC2.1 -----------------------------------------------------------------

test('AC2.1: POST /api/scan acks promptly and BEFORE the underlying scan (against a large fixture) completes', async () => {
  buildUnchangedLibrary(1300);
  assert.equal(scanState.scanning, false, 'precondition: idle');

  const start = Date.now();
  const res = await fetch(`${base}/api/scan`, { method: 'POST' });
  const ackElapsedMs = Date.now() - start;

  assert.equal(res.status, 202);
  const json = await res.json();
  assert.deepEqual(json, { scanning: true, alreadyInProgress: false });
  assert.ok(ackElapsedMs < 1000, `the ack must be effectively O(1), not proportional to library size (took ${ackElapsedMs}ms)`);
  // Proves the ack did NOT wait for the scan: with 1300 items to reconcile,
  // the scan cannot possibly have finished within the ack's own latency.
  assert.equal(scanState.scanning, true, 'the scan must still be running when the 202 ack arrives');

  await waitForScanIdle();
  assert.equal(scanState.scanning, false, 'sanity: the background scan eventually completes');
});

// ---- AC2.2 -----------------------------------------------------------------

test('AC2.2: GET /api/scan-status reports monotonic, non-regressing progress while a scan runs, and a terminal completed state afterward', async () => {
  const { metadata } = buildUnchangedLibrary(300);
  const expectedCount = Object.keys(metadata).length;

  const scanPromise = scanDirectories();

  const samples = [];
  const POLL_WINDOW_MS = 10000;
  const pollStart = Date.now();
  while (scanState.scanning && (Date.now() - pollStart) < POLL_WINDOW_MS) {
    const res = await fetch(`${base}/api/scan-status`);
    assert.equal(res.status, 200);
    const json = await res.json();
    samples.push(json);
    await new Promise((resolve) => setImmediate(resolve));
  }
  await scanPromise;

  const finalRes = await fetch(`${base}/api/scan-status`);
  const finalJson = await finalRes.json();
  samples.push(finalJson);

  assert.ok(samples.some((s) => s.scanning === true), 'at least one poll must have caught the scan in progress');
  assert.equal(finalJson.scanning, false, 'the final poll must report a terminal, completed state');

  let prevProcessed = -1;
  let prevTotal = -1;
  for (const s of samples) {
    assert.ok(typeof s.processed === 'number' && typeof s.total === 'number' && typeof s.phase === 'string',
      'every sample must carry processed/total/phase');
    assert.ok(s.processed >= prevProcessed, `processed must never regress (saw ${s.processed} after ${prevProcessed})`);
    assert.ok(s.total >= prevTotal, `total must never regress (saw ${s.total} after ${prevTotal})`);
    prevProcessed = s.processed;
    prevTotal = s.total;
  }
  assert.equal(finalJson.total, expectedCount, 'total must reflect the full library once the pass completes');
  assert.equal(finalJson.processed, expectedCount, 'processed must reach total once the pass completes');
  assert.equal(finalJson.phase, 'idle', 'phase must settle back to idle once the scan completes');
});

// ---- AC2.4 -----------------------------------------------------------------

// server.js only runs its real boot sequence (app.listen + the deferred
// `setImmediate(() => scanDirectories().catch(console.error))` boot scan)
// under `require.main === module` -- deliberately a no-op when imported by
// tests (see docs/CONTRIBUTING.md: "importing this module has no side
// effects... it only starts listening/scanning under require.main ===
// module"). This test exercises the OBSERVABLE contract AC2.4 describes
// using the exact same pattern the real boot callback now uses (fire the
// scan WITHOUT awaiting, then immediately serve a request) against the
// already-listening `app` this suite's own `before()` started -- proving a
// background scan never gates route-serving, without needing to spawn a
// real `node server.js` subprocess.
test('AC2.4: a request immediately after kicking off a background scan (boot-scan proxy) succeeds while the scan may still be running', async () => {
  buildUnchangedLibrary(1300);
  assert.equal(scanState.scanning, false, 'precondition: idle');

  // Mirrors the boot callback exactly: fire-and-forget, never awaited here.
  scanDirectories().catch(console.error);

  const res = await fetch(`${base}/api/config`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(Array.isArray(json.folders), 'the config response must still be well-formed');
  // The scan (1300 items) cannot have completed within the time it took to
  // issue and receive this single request -- proving the request was never
  // sequenced behind it.
  assert.equal(scanState.scanning, true, 'the background scan must still be in flight when the request completes');

  await waitForScanIdle();
});

// ---- AC1.6 / AC1.7 (post-conversion confirmation) --------------------------

test('AC1.6/AC1.7: after the async conversion, an unchanged file still reuses its data (no re-extraction) while a changed file still gets re-extracted', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cooperative-reuse-'));

  const unchangedPath = path.join(root, 'unchanged.mp4');
  fs.writeFileSync(unchangedPath, 'unchanged-bytes');
  const unchangedId = getMediaId(unchangedPath);
  const unchangedSize = fs.statSync(unchangedPath).size;
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${unchangedId}.jpg`), 'thumb-bytes');

  const changedPath = path.join(root, 'changed.mp4');
  fs.writeFileSync(changedPath, 'changed-bytes-now-longer-than-before');
  const changedId = getMediaId(changedPath);
  const changedRealSize = fs.statSync(changedPath).size;

  saveDatabase({
    folders: [root],
    folderSettings: {},
    progress: {},
    metadata: {
      [unchangedId]: {
        id: unchangedId, name: 'unchanged.mp4', title: 'unchanged', filePath: unchangedPath,
        folderName: path.basename(root), size: unchangedSize, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 42, hasThumbnail: true, artist: 'UNCHANGED-SENTINEL',
        rootFolder: root, videoCodec: 'h264', audioCodec: 'aac', needsTranscode: false,
      },
      [changedId]: {
        id: changedId, name: 'changed.mp4', title: 'changed', filePath: changedPath,
        // Deliberately a DIFFERENT size than what's actually on disk now, so
        // the scan's `unchanged` check (filePath+size) is false and this item
        // takes the "new or updated file" (re-init/re-extract) branch.
        folderName: path.basename(root), size: changedRealSize - 1, ext: '.mp4', type: 'video',
        addedAt: Date.now(), duration: 99, hasThumbnail: true, artist: 'CHANGED-SENTINEL',
        rootFolder: root, videoCodec: 'h264', audioCodec: 'aac', needsTranscode: false,
      },
    },
    settings: baseSettings(),
  });

  await scanDirectories();

  const db = loadDatabase();
  // AC1.6 (positive): reused verbatim -- the sentinel (which only a fresh
  // re-init would ever overwrite) survives untouched.
  assert.equal(db.metadata[unchangedId].artist, 'UNCHANGED-SENTINEL',
    'an unchanged file must reuse its existing data, not be re-extracted');
  assert.equal(db.metadata[unchangedId].duration, 42, 'an unchanged file\'s duration must be preserved, not reset');
  // AC1.7 (converse): the "new/updated file" branch unconditionally
  // re-initializes the entry (artist starts at '' before any probe even
  // runs) -- the sentinel being gone proves this item was NOT taken on the
  // reuse fast-path.
  assert.notEqual(db.metadata[changedId].artist, 'CHANGED-SENTINEL',
    'a genuinely changed file must be re-extracted (re-initialized), not reuse its stale sentinel data');
  assert.equal(db.metadata[changedId].size, changedRealSize, 'the changed file\'s size must be refreshed from disk');
});
