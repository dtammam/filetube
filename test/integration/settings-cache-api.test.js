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
const { app, armScanTimer } = require('../../server');

const DEFAULT_SETTINGS = {
  scanIntervalMinutes: 30,
  pruneMissing: true,
  cacheMaxBytes: null,
  cacheMaxAgeDays: 30,
};

function baseSettings(overrides) {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
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

test('GET /api/settings returns the 5-field shape with backfilled defaults on a fresh DB', async () => {
  const res = await fetch(`${base}/api/settings`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, {
    scanIntervalMinutes: 30,
    pruneMissing: true,
    cacheMaxBytes: null,
    cacheMaxAgeDays: 30,
    effectiveCacheMaxBytes: 5 * 1024 ** 3, // env unset -> 5 GB default
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

// ---- Existing routes unaffected --------------------------------------------

test('existing GET /api/scan-status response shape is unaffected by Task 6', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });
  const res = await fetch(`${base}/api/scan-status`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(
    Object.keys(json).sort(),
    ['fileCount', 'folderCount', 'lastScan', 'scanning', 'transcoding'].sort()
  );
});

test('existing GET /api/config response shape is unaffected by Task 6', async () => {
  writeDb({ folders: ['/x'], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });
  const res = await fetch(`${base}/api/config`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(Object.keys(json).sort(), ['folderSettings', 'folders'].sort());
});
