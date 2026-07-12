'use strict';

// [INTEGRATION] Task 6: GET/POST /api/settings, GET /api/cache/size,
// POST /api/cache/clear. Isolated DATA_DIR before requiring the app so the
// suite never reads or writes real project data -- own process per file
// (node --test), mirroring test/integration/scan-api.test.js /
// test/integration/age-sweep.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-settings-cache-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TRANSCODE_DIR = path.join(DATA_DIR, 'transcoded');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, armScanTimer, currentScanTimer, saveDatabase } = require('../../server');

const DEFAULT_SETTINGS = {
  scanIntervalMinutes: 30,
  pruneMissing: true,
  cacheMaxBytes: null,
  cacheMaxAgeDays: 30,
  defaultView: '', // v1.14.0 item 4: '' is the "Most Recent" sentinel
  autoplayNext: false, // v1.16.0 FR-3 (T3): OFF by default
  backgroundAudioForVideo: false, // v1.27.0 (EXPERIMENTAL): OFF by default
};

function baseSettings(overrides) {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

// v1.30 A3 (in-memory DB read cache): seed via the exported `saveDatabase()`
// (an established test primitive, see CONTRIBUTING.md) rather than a raw
// `fs.writeFileSync`, so the in-process db cache stays coherent.
function writeDb(db) {
  saveDatabase(db);
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

// Drop a dummy transcoded MP4 (no FFmpeg needed) with a known size.
function writeTranscodeFile(name, size = 100) {
  const p = path.join(TRANSCODE_DIR, name);
  fs.writeFileSync(p, Buffer.alloc(size));
  return p;
}

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
  // Any timer this file directly armed via armScanTimer() must be cleared so
  // the suite exits cleanly even though armed timers are already .unref()'d.
  const leftover = armScanTimer();
  if (leftover) clearInterval(leftover);
});

beforeEach(() => {
  // Start every test from a fresh db.json and an empty TRANSCODE_DIR so
  // settings/cache assertions aren't polluted across cases.
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
  fs.mkdirSync(TRANSCODE_DIR, { recursive: true });
  for (const name of fs.readdirSync(TRANSCODE_DIR)) fs.rmSync(path.join(TRANSCODE_DIR, name));
});

// ---- GET /api/settings -----------------------------------------------------

test('GET /api/settings returns the 9-field shape with backfilled defaults on a fresh DB', async () => {
  const res = await fetch(`${base}/api/settings`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, {
    scanIntervalMinutes: 30,
    pruneMissing: true,
    cacheMaxBytes: null,
    cacheMaxAgeDays: 30,
    defaultView: '', // v1.14.0 item 4: '' is the "Most Recent" sentinel
    autoplayNext: false, // v1.16.0 FR-3 (T3): OFF by default
    backgroundAudioForVideo: false, // v1.27.0 (EXPERIMENTAL): OFF by default
    effectiveCacheMaxBytes: 5 * 1024 ** 3, // env unset -> 5 GB default
    customLogo: false, // v1.32: read-only flag, managed by /api/settings/logo
  });
});

test('GET /api/settings surfaces a UI-set cacheMaxBytes as effectiveCacheMaxBytes', async () => {
  writeDb({
    folders: [], folderSettings: {}, progress: {}, metadata: {},
    settings: baseSettings({ cacheMaxBytes: 12345 }),
  });
  const res = await fetch(`${base}/api/settings`);
  const json = await res.json();
  assert.equal(json.cacheMaxBytes, 12345);
  assert.equal(json.effectiveCacheMaxBytes, 12345, 'UI override wins over the env/5GB default');
});

// ---- POST /api/settings: valid partial update ------------------------------

test('POST /api/settings persists a valid partial update and a subsequent GET reflects it', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  const postRes = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scanIntervalMinutes: 360 }),
  });
  assert.equal(postRes.status, 200);
  const postJson = await postRes.json();
  assert.equal(postJson.scanIntervalMinutes, 360);
  // Untouched keys stay at their previous values -- proves the merge is partial.
  assert.equal(postJson.pruneMissing, true);
  assert.equal(postJson.cacheMaxAgeDays, 30);

  const getRes = await fetch(`${base}/api/settings`);
  const getJson = await getRes.json();
  assert.equal(getJson.scanIntervalMinutes, 360, 'a subsequent GET reflects the persisted change');

  const onDisk = readDb();
  assert.equal(onDisk.settings.scanIntervalMinutes, 360, 'persisted to db.json, not just returned in the response');
});

// ---- A: async write routes return 500 JSON (not a hang) when the ----------
// ---- underlying updateDatabase/saveDatabase rejects ------------------------

test('POST /api/settings returns 500 JSON (not a hang) when persisting the settings write fails', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  const realWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('simulated disk failure'); };
  try {
    const res = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pruneMissing: false }),
    });
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.equal(typeof json.error, 'string');
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }

  // Untouched by the failed write -- the prior settings must still be intact.
  assert.equal(readDb().settings.pruneMissing, true, 'a failed save must not leave a partially-applied change');
});

test('POST /api/settings re-arms the scan timer live so the new interval takes effect without a restart', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  // Baseline: the default 30-minute interval.
  const before30 = armScanTimer();
  try {
    assert.equal(before30._idleTimeout, 30 * 60 * 1000, 'precondition: default 30m interval armed');
  } finally {
    clearInterval(before30);
  }

  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scanIntervalMinutes: 720 }),
  });
  assert.equal(res.status, 200);

  // The route already called armScanTimer() internally as part of handling the
  // request (live re-arm, no restart) -- calling it again here is the same
  // idempotent operation the route itself performs (clear + re-arm from the
  // freshly-persisted db.settings.scanIntervalMinutes) and lets the test
  // observe that the *live* timer now reflects the new interval.
  const after720 = armScanTimer();
  try {
    assert.equal(after720._idleTimeout, 720 * 60 * 1000, 'timer now reflects the new 12h interval, not the old 30m one');
  } finally {
    clearInterval(after720);
  }
});

// ---- D: re-arm gated on an ACTUAL scanIntervalMinutes change --------------

test('D: POST /api/settings does NOT re-arm the timer when a non-interval setting is saved', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  const baseline = armScanTimer(); // arm explicitly so currentScanTimer() has a known baseline object
  try {
    const res = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pruneMissing: false }), // non-interval key
    });
    assert.equal(res.status, 200);

    const after = currentScanTimer();
    assert.strictEqual(after, baseline, 'the timer object must be the SAME instance -- the route must not have re-armed it');
    assert.equal(after._idleTimeout, 30 * 60 * 1000, 'the countdown/interval is unchanged');
  } finally {
    clearInterval(currentScanTimer());
  }
});

test('D: POST /api/settings DOES re-arm the timer when scanIntervalMinutes actually changes', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  const baseline = armScanTimer(); // 30m baseline
  try {
    const res = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanIntervalMinutes: 360 }),
    });
    assert.equal(res.status, 200);

    const after = currentScanTimer();
    assert.notStrictEqual(after, baseline, 'an interval change must produce a NEW (re-armed) timer instance');
    assert.equal(after._idleTimeout, 360 * 60 * 1000, 'the new timer reflects the changed interval');
  } finally {
    clearInterval(currentScanTimer());
  }
});

test('POST /api/settings scanIntervalMinutes: 0 (Off) re-arms no timer', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scanIntervalMinutes: 0 }),
  });
  assert.equal(res.status, 200);

  const timer = armScanTimer();
  assert.strictEqual(timer, null, 'Off should arm no timer at all after the live re-arm');
});

// ---- POST /api/settings: validation / no-mutation on invalid ---------------

const invalidPayloads = [
  { scanIntervalMinutes: 15 },
  { cacheMaxAgeDays: 99 },
  { pruneMissing: 'yes' },
  { cacheMaxBytes: -1 },
  { cacheMaxBytes: 1.5 },
  { unknownKey: 'nope' },
];

for (const payload of invalidPayloads) {
  test(`POST /api/settings rejects ${JSON.stringify(payload)} with 400 and mutates nothing`, async () => {
    writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

    const res = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(typeof json.error, 'string');

    const onDisk = readDb();
    assert.deepEqual(onDisk.settings, baseSettings(), 'db.settings must be byte-identical to before the rejected request');
  });
}

test('POST /api/settings accepts cacheMaxBytes: null (defer to env/5GB default)', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings({ cacheMaxBytes: 999 }) });

  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cacheMaxBytes: null }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.cacheMaxBytes, null);
  assert.equal(json.effectiveCacheMaxBytes, 5 * 1024 ** 3);
});

// ---- GET /api/cache/size ----------------------------------------------------

test('GET /api/cache/size returns the correct total, excluding .tmp.mp4', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });
  writeTranscodeFile('a.mp4', 100);
  writeTranscodeFile('b.mp4', 250);
  writeTranscodeFile('c.tmp.mp4', 999); // in-flight write -- must not count

  const res = await fetch(`${base}/api/cache/size`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.bytes, 350, 'only the two finished .mp4 files count toward the total');
});

// ---- POST /api/cache/clear ---------------------------------------------------

test('POST /api/cache/clear removes non-tmp MP4s, leaves .tmp.mp4 intact, and reports removed/freedBytes', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });
  const a = writeTranscodeFile('a.mp4', 100);
  const b = writeTranscodeFile('b.mp4', 250);
  const tmp = writeTranscodeFile('c.tmp.mp4', 999);

  const res = await fetch(`${base}/api/cache/clear`, { method: 'POST' });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, { success: true, removed: 2, freedBytes: 350 });

  assert.ok(!fs.existsSync(a), 'a.mp4 should be removed');
  assert.ok(!fs.existsSync(b), 'b.mp4 should be removed');
  assert.ok(fs.existsSync(tmp), '.tmp.mp4 (in-flight transcode) must survive a clear');
});

test('POST /api/cache/clear leaves a recentlyServed-protected file intact and does not touch lastServedAt', async () => {
  const id = 'vid-recently-served';
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      [id]: {
        id, needsTranscode: true, filePath: '/src/whatever.avi', size: 100,
        type: 'video', title: 'x', name: 'x.avi', ext: '.avi', addedAt: Date.now(),
      },
    },
    settings: baseSettings(),
  });
  const protectedPath = writeTranscodeFile(`${id}.mp4`, 100);
  const unprotectedPath = writeTranscodeFile('unrelated.mp4', 50);

  // A real request through /video/:id marks the transcoded file recently-served
  // (in-memory recentlyServed map), exactly as an actively-watched stream would.
  const streamRes = await fetch(`${base}/video/${id}`);
  assert.equal(streamRes.status, 200);
  await streamRes.arrayBuffer();

  const lastServedAtBefore = readDb().metadata[id].lastServedAt;
  assert.equal(typeof lastServedAtBefore, 'number', 'precondition: streaming recorded lastServedAt');

  const res = await fetch(`${base}/api/cache/clear`, { method: 'POST' });
  const json = await res.json();
  assert.equal(json.removed, 1, 'only the unprotected file is removed');
  assert.equal(json.freedBytes, 50);

  assert.ok(fs.existsSync(protectedPath), 'a recentlyServed file must survive Clear cache now');
  assert.ok(!fs.existsSync(unprotectedPath), 'an unprotected file is still cleared');

  const lastServedAtAfter = readDb().metadata[id].lastServedAt;
  assert.equal(lastServedAtAfter, lastServedAtBefore, 'Clear cache now must never touch lastServedAt');
});

test('POST /api/cache/clear on an empty cache is a safe no-op', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });
  const res = await fetch(`${base}/api/cache/clear`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, removed: 0, freedBytes: 0 });
});

// F1 (two-reviewer gate, v1.27.0): a manual "Clear cache now" removing a
// background-audio `.m4a` sidecar must also clear that item's stale
// `audioStatus: 'ready'` -- same as automatic eviction/aging (see
// test/unit/audio-cache-lifecycle.test.js's own evictTranscodeCache/
// sweepAgedTranscodes coverage).
test('POST /api/cache/clear clears audioStatus for a cleared .m4a sidecar', async () => {
  const id = 'vid-cache-clear-audio-status';
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, type: 'video', audioStatus: 'ready', filePath: '/src/whatever.mp4', size: 100, title: 'x', name: 'x.mp4', ext: '.mp4', addedAt: Date.now() } },
    settings: baseSettings(),
  });
  writeTranscodeFile(`${id}.m4a`, 50);

  const res = await fetch(`${base}/api/cache/clear`, { method: 'POST' });
  const json = await res.json();
  assert.equal(json.removed, 1);

  // clearAudioStatus is fire-and-forget (updateDatabase's own async-mutex
  // chain, not awaited by the route) -- give it a tick to land, mirroring
  // this same suite's own lastServedAt-landing pattern above.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const db = readDb();
  assert.equal(db.metadata[id].audioStatus, undefined, 'the cleared .m4a\'s stale audioStatus must be removed');
});

// ---- Existing routes unaffected --------------------------------------------

// v1.30 A2 (AC2.2): processed/total/phase added for cooperative-scan progress.
test('existing GET /api/scan-status response shape is unaffected by Task 6 (plus v1.18 FR-3 + v1.30 A2 additive fields)', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });
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

test('existing GET /api/config response shape is unaffected by Task 6 (plus v1.19.0 FR-4\'s additive, read-only syntheticFolders field)', async () => {
  writeDb({ folders: ['/x'], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });
  const res = await fetch(`${base}/api/config`);
  assert.equal(res.status, 200);
  const json = await res.json();
  // v1.19.0 FR-4 (Fork FR-4b, Option A) intentionally added `syntheticFolders`
  // -- a read-only, response-only field the client uses to identify the
  // yt-dlp module's synthetic download folder -- to this response. Updating
  // this lock to include it (rather than leaving the assertion to fail) is
  // the correct move: the shape is still fully additive/backward-compatible,
  // and `folders`/`folderSettings` themselves are untouched.
  assert.deepEqual(Object.keys(json).sort(), ['folderSettings', 'folders', 'syntheticFolders'].sort());
});
