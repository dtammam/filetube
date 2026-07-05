'use strict';

// Isolated DATA_DIR before requiring the app so the suite never reads or
// writes real project data. Own process per file (node --test) mirrors
// test/integration/scan-prune.test.js / test/unit/transcode-cache.test.js.
// No FFmpeg needed -- we drop dummy .mp4 files directly and control their
// atime via fs.utimesSync.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-age-sweep-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TRANSCODE_DIR = path.join(DATA_DIR, 'transcoded');

const { test, beforeEach, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app,
  sweepAgedTranscodes,
  recordServed,
  clearPersistedServedAt,
  evictTranscodeCache,
} = require('../../server');

// Mirrors server.js's RECENT_STREAM_MS (10 minutes) -- not exported since it's
// an internal constant, so the throttle test needs its own copy to simulate
// "the window has elapsed".
const RECENT_STREAM_MS = 10 * 60 * 1000;

function baseSettings(overrides) {
  return {
    scanIntervalMinutes: 30,
    pruneMissing: true,
    cacheMaxBytes: null,
    cacheMaxAgeDays: 30,
    ...overrides,
  };
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

// Drop a dummy transcoded MP4 (no FFmpeg needed) with a controlled atime.
function writeTranscodeFile(name, { atimeDaysAgo, size = 100 } = {}) {
  const p = path.join(TRANSCODE_DIR, name);
  fs.writeFileSync(p, Buffer.alloc(size));
  if (atimeDaysAgo != null) {
    const t = new Date(Date.now() - atimeDaysAgo * 24 * 60 * 60 * 1000);
    fs.utimesSync(p, t, t);
  }
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
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  // Start every test from a fresh db.json and an empty TRANSCODE_DIR so
  // sweep/eviction assertions aren't polluted across cases.
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
  fs.mkdirSync(TRANSCODE_DIR, { recursive: true });
  for (const name of fs.readdirSync(TRANSCODE_DIR)) fs.rmSync(path.join(TRANSCODE_DIR, name));
});

// ---- HEADLINE: D3 guarantee through the LIVE sweep ------------------------

test('D3 (live sweep): a fresh recorded lastServedAt survives even with a stale filesystem atime', () => {
  const id = 'vid-fresh-recorded';
  // atime says 90 days ago (well past the 30-day cutoff below), but the
  // recorded lastServedAt says "just now" -- the sweep must trust the
  // recorded timestamp, not raw atime.
  const p = writeTranscodeFile(`${id}.mp4`, { atimeDaysAgo: 90 });
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, lastServedAt: Date.now() } },
    settings: baseSettings({ cacheMaxAgeDays: 30 }),
  });

  const removed = sweepAgedTranscodes(Date.now());

  assert.equal(removed, 0);
  assert.ok(fs.existsSync(p), 'a file with a fresh recorded lastServedAt must NOT be aged out despite stale atime');
});

// ---- atime fallback for pre-upgrade files with no recorded timestamp ------

test('atime fallback: no recorded lastServedAt falls back to atime for the age decision', () => {
  const oldId = 'vid-old-atime';
  const oldPath = writeTranscodeFile(`${oldId}.mp4`, { atimeDaysAgo: 90 });
  const freshId = 'vid-fresh-atime';
  const freshPath = writeTranscodeFile(`${freshId}.mp4`, { atimeDaysAgo: 1 });
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: {}, // neither id has a recorded lastServedAt
    settings: baseSettings({ cacheMaxAgeDays: 30 }),
  });

  const removed = sweepAgedTranscodes(Date.now());

  assert.equal(removed, 1);
  assert.ok(!fs.existsSync(oldPath), 'old atime with no recorded lastServedAt should age out');
  assert.ok(fs.existsSync(freshPath), 'recent atime should be kept');
});

// ---- Retention Off: age sweep is a no-op; size-cap LRU is untouched -------

test('retention Off (cacheMaxAgeDays=0): sweep deletes nothing, and the size-cap LRU path still runs unchanged', () => {
  const idA = 'vid-off-a';
  const idB = 'vid-off-b';
  const pathA = writeTranscodeFile(`${idA}.mp4`, { atimeDaysAgo: 200, size: 100 });
  const pathB = writeTranscodeFile(`${idB}.mp4`, { atimeDaysAgo: 1, size: 100 });
  writeDb({
    folders: [], folderSettings: {}, progress: {}, metadata: {},
    settings: baseSettings({ cacheMaxAgeDays: 0 }),
  });

  const removed = sweepAgedTranscodes(Date.now());
  assert.equal(removed, 0, 'retention Off must delete nothing regardless of stale atime/age');
  assert.ok(fs.existsSync(pathA) && fs.existsSync(pathB));

  // Size-cap eviction is a separate mechanism (evictTranscodeCache is
  // FROZEN/untouched by this feature) and still enforces the cap.
  const evicted = evictTranscodeCache(100); // cap smaller than the combined 200 bytes
  assert.equal(evicted, 1, 'size-cap eviction still runs independently of the (Off) age sweep');
  assert.ok(!fs.existsSync(pathA), 'oldest-by-atime evicted by the size cap');
  assert.ok(fs.existsSync(pathB), 'newer file survives the size-cap eviction');
});

// ---- Composes with the recentlyServed live-watch protection ---------------

test('composes with recentlyServed: a path served within the window is not swept even with a stale recorded/atime age', async () => {
  const id = 'vid-recently-served';
  const p = writeTranscodeFile(`${id}.mp4`, { atimeDaysAgo: 90 });
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      [id]: {
        id, needsTranscode: true, filePath: '/src/whatever.avi', size: 100,
        type: 'video', title: 'x', name: 'x.avi', ext: '.avi', addedAt: Date.now(),
      },
    },
    settings: baseSettings({ cacheMaxAgeDays: 30 }),
  });

  // Live request through the real /video/:id path marks the file
  // recently-served (in-memory recentlyServed map) via the additive
  // recordServed call wired alongside markServed.
  const res = await fetch(`${base}/video/${id}`);
  assert.equal(res.status, 200);
  await res.arrayBuffer();

  // Force the *recorded* timestamp back to stale so this test isolates the
  // recentlyServed (in-memory) protection from the D3 lastServedAt guarantee
  // covered by the headline test above.
  const db = readDb();
  db.metadata[id].lastServedAt = Date.now() - 90 * 24 * 60 * 60 * 1000;
  writeDb(db);

  const removed = sweepAgedTranscodes(Date.now());

  assert.equal(removed, 0, 'a recently-served path must survive the age sweep');
  assert.ok(fs.existsSync(p));
});

// ---- .tmp.mp4 is never touched by the sweep -------------------------------

test('.tmp.mp4 is never deleted by the sweep even with a very stale atime and no lastServedAt', () => {
  const id = 'vid-tmp';
  const p = writeTranscodeFile(`${id}.tmp.mp4`, { atimeDaysAgo: 400 });
  writeDb({
    folders: [], folderSettings: {}, progress: {}, metadata: {},
    settings: baseSettings({ cacheMaxAgeDays: 7 }),
  });

  const removed = sweepAgedTranscodes(Date.now());

  assert.equal(removed, 0);
  assert.ok(fs.existsSync(p));
});

// ---- recordServed: no-clobber + throttle ----------------------------------

test('recordServed: a burst of calls within the window yields at most one persisted write (no-clobber/throttle)', async () => {
  const id = 'vid-throttle';
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, unrelatedField: 'keep-me' } },
    settings: baseSettings(),
  });

  // recordServed is fire-and-forget in production (its actual disk write is
  // serialized through updateDatabase, a promise chain), so tests that need
  // to observe the persisted write deterministically must `await` its
  // returned promise -- see server.js's recordServed doc comment.
  await recordServed(id);
  const afterFirst = readDb();
  const t1 = afterFirst.metadata[id].lastServedAt;
  assert.equal(typeof t1, 'number', 'first call records a lastServedAt');
  assert.equal(afterFirst.metadata[id].unrelatedField, 'keep-me');

  // Burst: several immediate calls within RECENT_STREAM_MS must not rewrite
  // lastServedAt (this is the no-clobber/throttle guarantee).
  for (let i = 0; i < 5; i++) await recordServed(id);
  const afterBurst = readDb();
  assert.equal(afterBurst.metadata[id].lastServedAt, t1, 'a burst within the window must not change lastServedAt');
  assert.equal(afterBurst.metadata[id].unrelatedField, 'keep-me', 'an unrelated field must never be clobbered');

  // Simulate the window having elapsed by rewriting the persisted timestamp
  // to just past RECENT_STREAM_MS ago -- the next call should now update it.
  // Also clear this id's entry in the in-memory write-throttle map (the hot
  // path that now short-circuits BEFORE any disk read, see the "no hot-path
  // read" test below) so recordServed actually re-consults the (rewritten)
  // on-disk value instead of trusting its still-fresh in-memory timestamp.
  const staleDb = readDb();
  staleDb.metadata[id].lastServedAt = Date.now() - RECENT_STREAM_MS - 1000;
  writeDb(staleDb);
  clearPersistedServedAt(id);

  await recordServed(id);
  const afterWindow = readDb();
  assert.notEqual(afterWindow.metadata[id].lastServedAt, staleDb.metadata[id].lastServedAt, 'after the window elapses, the next serve updates lastServedAt');
  assert.equal(afterWindow.metadata[id].unrelatedField, 'keep-me', 'unrelated field still untouched after the update');
});

// ---- E: recordServed's hot-path throttle skips the DISK READ, not just the write ----

test('recordServed (E, headline): a within-window call short-circuits on the in-memory map -- NO hot-path disk read', async () => {
  const id = 'vid-no-hotpath-read';
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id } },
    settings: baseSettings(),
  });

  await recordServed(id); // first call for this id: no map entry yet -> loadDatabase + persists once
  assert.ok(fs.existsSync(DB_FILE), 'first call persists to db.json');
  const persisted = readDb().metadata[id].lastServedAt;
  assert.equal(typeof persisted, 'number');

  // Delete db.json entirely. If the throttled path did ANY loadDatabase, it
  // would recreate an empty db.json (loadDatabase writes a fresh DB when the
  // file is missing) -- so "db.json stays absent" is direct proof no disk
  // read happened.
  fs.rmSync(DB_FILE);

  await recordServed(id); // still within RECENT_STREAM_MS -> map lookup only, no loadDatabase
  assert.ok(!fs.existsSync(DB_FILE), 'a throttled call must NOT read/recreate db.json (no hot-path disk read)');

  // Once the map entry ages out (simulated here rather than waiting 10 real
  // minutes), the next call is due again and DOES read (and, since the file
  // is absent, recreate) the database.
  clearPersistedServedAt(id);
  await recordServed(id);
  assert.ok(fs.existsSync(DB_FILE), 'an out-of-window/due call reads (and recreates) db.json');
});

test('recordServed (E): empty map on boot -- the first serve per fresh id persists exactly once', async () => {
  const id = 'vid-fresh-boot';
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id } },
    settings: baseSettings(),
  });

  await recordServed(id); // no prior map entry for this id (as if freshly booted)
  const db = readDb();
  assert.equal(typeof db.metadata[id].lastServedAt, 'number', 'the first serve for a fresh id persists a lastServedAt');
});

test('recordServed: a missing metadata entry is a safe no-op', () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });
  assert.doesNotThrow(() => recordServed('does-not-exist'));
});
