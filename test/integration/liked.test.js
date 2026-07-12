'use strict';

// [INTEGRATION] v1.30 C2 (Visual polish cluster, T11) -- Like -> "Liked"
// playlist. `db.liked` (an array of media ids) is the SINGLE source of truth
// for like state; there is no separate boolean flag anywhere. Covers:
//
//   AC7.3 (headline): add / duplicate-add (idempotent, no dup) / remove
//   round-trip leaves NO residual membership. GET /api/liked reflects the
//   current set in the T6 {items,total,offset,limit} shape.
//
//   AC4.2 (regression): each liked route (POST/DELETE /api/liked/:id)
//   produces EXACTLY 1 atomic write+fsync per invocation -- unbatched, unlike
//   the T5 progress coalescer -- asserted via the `__getSaveDatabaseCallCount`
//   write-count spy (mirrors progress-coalescer.test.js's own AC4.2 style).
//
//   Backfill: a legacy/partial db.json without `liked` loads with
//   `db.liked = []` across all three `loadDatabase` default paths.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-liked-'));
const DB_FILE = path.join(process.env.DATA_DIR, 'db.json');
const THUMBNAIL_DIR = path.join(process.env.DATA_DIR, '.thumbnails');
fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app,
  saveDatabase,
  loadDatabase,
  __getSaveDatabaseCallCount,
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

function seedItem(id, overrides) {
  return {
    id,
    title: id,
    filePath: `/media/${id}.mp4`,
    folderName: 'media',
    type: 'video',
    ext: '.mp4',
    duration: 100,
    size: 1000,
    addedAt: Date.now(),
    ...overrides,
  };
}

async function like(id) {
  return fetch(`${base}/api/liked/${encodeURIComponent(id)}`, { method: 'POST' });
}

async function unlike(id) {
  return fetch(`${base}/api/liked/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---- AC7.3: add / duplicate-add (idempotent) / remove round-trip ----------

test('AC7.3: POST /api/liked/:id adds membership', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { likeA: seedItem('likeA') },
    liked: [],
    settings: baseSettings(),
  });

  const res = await like('likeA');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.liked, true);

  const db = loadDatabase();
  assert.deepEqual(db.liked, ['likeA']);
});

test('AC7.3: a duplicate POST /api/liked/:id is idempotent -- no duplicate entry', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { likeB: seedItem('likeB') },
    liked: [],
    settings: baseSettings(),
  });

  await like('likeB');
  const res = await like('likeB'); // second, duplicate add
  assert.equal(res.status, 200);

  const db = loadDatabase();
  assert.deepEqual(db.liked, ['likeB'], 'a duplicate add must never produce a second entry');
});

test('AC7.3: DELETE /api/liked/:id removes membership, and the round-trip leaves NO residual membership', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { likeC: seedItem('likeC') },
    liked: [],
    settings: baseSettings(),
  });

  await like('likeC');
  assert.deepEqual(loadDatabase().liked, ['likeC']);

  const res = await unlike('likeC');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.liked, false);

  const db = loadDatabase();
  assert.deepEqual(db.liked, [], 'like-then-unlike must leave no residual membership');
});

test('AC7.3: removing a non-member is a no-op (idempotent) and never throws/errors', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { likeD: seedItem('likeD') },
    liked: ['someOtherId'],
    settings: baseSettings(),
  });

  const res = await unlike('likeD'); // never liked in the first place
  assert.equal(res.status, 200);
  assert.deepEqual(loadDatabase().liked, ['someOtherId'], 'unrelated membership must be untouched');
});

test('AC7.3: POST /api/liked/:id 404s for an id that is not a real library item', async () => {
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, liked: [], settings: baseSettings() });
  const res = await like('ghost-id');
  assert.equal(res.status, 404);
  assert.deepEqual(loadDatabase().liked, [], 'a 404 must never stage a membership entry');
});

// ---- GET /api/liked: T6 {items,total,offset,limit} shape, membership set --

test('GET /api/liked lists exactly the current liked set in the {items,total,offset,limit} shape', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      lik1: seedItem('lik1', { addedAt: 1000 }),
      lik2: seedItem('lik2', { addedAt: 2000 }),
      lik3: seedItem('lik3', { addedAt: 3000 }), // never liked
    },
    liked: ['lik1', 'lik2'],
    settings: baseSettings(),
  });

  const res = await fetch(`${base}/api/liked`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.total, 2);
  assert.equal(body.offset, 0);
  assert.ok(typeof body.limit === 'number');
  assert.equal(body.items.length, 2);
  const ids = body.items.map((i) => i.id).sort();
  assert.deepEqual(ids, ['lik1', 'lik2']);
  assert.ok(body.items.every((i) => i.liked === true), 'every listed item must carry liked: true');
});

test('GET /api/liked returns an empty page when nothing is liked', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { lonely: seedItem('lonely') },
    liked: [],
    settings: baseSettings(),
  });
  const res = await fetch(`${base}/api/liked`);
  const body = await res.json();
  assert.deepEqual(body, { items: [], total: 0, offset: 0, limit: body.limit });
});

// ---- GET /api/videos/:id: derived `liked` field (not persisted) -----------

test('GET /api/videos/:id derives `liked` from db.liked membership at request time', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { derivedA: seedItem('derivedA') },
    liked: ['derivedA'],
    settings: baseSettings(),
  });
  let res = await fetch(`${base}/api/videos/derivedA`);
  let body = await res.json();
  assert.equal(body.liked, true);

  await unlike('derivedA');
  res = await fetch(`${base}/api/videos/derivedA`);
  body = await res.json();
  assert.equal(body.liked, false, 'the derived field must reflect membership immediately after unlike, never a stale/stored flag');
});

// ---- AC4.2: each liked route is exactly 1:1 atomic write+fsync -----------

test('AC4.2: POST /api/liked/:id triggers exactly 1 saveDatabase call per invocation', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { writeA: seedItem('writeA') },
    liked: [],
    settings: baseSettings(),
  });
  const before = __getSaveDatabaseCallCount();
  const res = await like('writeA');
  assert.equal(res.status, 200);
  assert.equal(__getSaveDatabaseCallCount() - before, 1, 'POST /api/liked/:id must be exactly 1:1 (unbatched)');
});

test('AC4.2: a duplicate (idempotent) POST /api/liked/:id STILL performs exactly 1 write on that invocation (never batched/skipped)', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { writeB: seedItem('writeB') },
    liked: [],
    settings: baseSettings(),
  });
  await like('writeB');
  const before = __getSaveDatabaseCallCount();
  const res = await like('writeB'); // duplicate add
  assert.equal(res.status, 200);
  assert.equal(__getSaveDatabaseCallCount() - before, 1, 'a duplicate add is still its OWN atomic write, unlike progress\'s batched skip-on-no-change posture');
});

test('AC4.2: DELETE /api/liked/:id triggers exactly 1 saveDatabase call per invocation', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { writeC: seedItem('writeC') },
    liked: ['writeC'],
    settings: baseSettings(),
  });
  const before = __getSaveDatabaseCallCount();
  const res = await unlike('writeC');
  assert.equal(res.status, 200);
  assert.equal(__getSaveDatabaseCallCount() - before, 1, 'DELETE /api/liked/:id must be exactly 1:1 (unbatched)');
});

test('AC4.2: DELETE /api/liked/:id on a non-member STILL performs exactly 1 write (idempotent, but not skipped)', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { writeD: seedItem('writeD') },
    liked: [],
    settings: baseSettings(),
  });
  const before = __getSaveDatabaseCallCount();
  const res = await unlike('writeD'); // never liked
  assert.equal(res.status, 200);
  assert.equal(__getSaveDatabaseCallCount() - before, 1);
});

// ---- Backfill: db.liked = [] across all three loadDatabase default paths --

test('backfill: a fresh (nonexistent) db.json is created with liked: []', () => {
  // `DB_FILE` is derived from `DATA_DIR` once at server.js module-load time
  // (this suite's own `process.env.DATA_DIR`, set at the top of this file),
  // so this test exercises the no-such-file branch directly by removing the
  // on-disk file loadDatabase() itself would otherwise find, then inspecting
  // the fresh db.json it creates in its place.
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const db = loadDatabase();
  assert.deepEqual(db.liked, [], 'a brand-new db.json must carry liked: []');
  assert.ok(fs.existsSync(DB_FILE), 'loadDatabase must have written the initial db.json to disk');
});

test('backfill: a legacy/partial db.json missing `liked` loads with db.liked = []', () => {
  // Written directly (bypassing saveDatabase) to simulate a genuinely
  // pre-C2 on-disk db.json, mirroring how other backfill tests in this repo
  // seed a legacy shape.
  fs.writeFileSync(DB_FILE, JSON.stringify({
    folders: [], folderSettings: {}, progress: {},
    metadata: { legacy: seedItem('legacy') },
    settings: baseSettings(),
    // deliberately no `liked` key at all
  }, null, 2), 'utf8');

  const db = loadDatabase();
  assert.deepEqual(db.liked, [], 'a legacy db.json without `liked` must backfill to []');
  assert.ok(db.metadata.legacy, 'other fields must remain intact after backfill');
});

test('backfill: a corrupt db.json resets to a settings-bearing DB that also carries liked: []', () => {
  fs.writeFileSync(DB_FILE, '{ not valid json', 'utf8');
  const db = loadDatabase();
  assert.deepEqual(db.liked, [], 'the corrupt-JSON reset fallback must also carry liked: []');
  assert.ok(db.settings, 'the corrupt-JSON reset fallback must still be settings-bearing');
});

// ---- v1.32: the Liked playlist view (first consumer of GET /api/liked) ------
const { test: t32l } = require('node:test');
const a32l = require('node:assert');
const fs32 = require('node:fs');

t32l('v1.32: main.js routes ?liked=1 to GET /api/liked and renders the built-in sidebar/sheet entries (static-scan locks)', () => {
  const mainSrc = fs32.readFileSync(require('node:path').join(__dirname, '../../public/js/main.js'), 'utf8');
  a32l.ok(mainSrc.includes("urlParams.get('liked') === '1'"), 'main.js must parse the ?liked=1 scope param');
  a32l.ok(mainSrc.includes("likedFilter ? '/api/liked' : '/api/videos'"), 'buildVideosApiUrl must swap the endpoint for the liked view');
  // v1.33.1: the entry itself moved into common.js's shared, count-gated
  // applyLikedSidebarEntry helper -- main.js must APPLY it, common.js must
  // OWN it (and the sheet renderer must route through the same helper).
  a32l.ok(mainSrc.includes('applyLikedSidebarEntry(sidebarFoldersList'), 'the home sidebar must apply the shared Liked entry helper');
  const commonSrc = fs32.readFileSync(require('node:path').join(__dirname, '../../public/js/common.js'), 'utf8');
  a32l.ok(commonSrc.includes('sidebar-item-liked'), 'common.js must own the built-in Liked entry markup');
  a32l.ok(commonSrc.includes('function applyLikedSidebarEntry'), 'common.js must define the shared count-gated helper');
  const watchSrc = fs32.readFileSync(require('node:path').join(__dirname, '../../public/js/watch.js'), 'utf8');
  a32l.ok(watchSrc.includes('applyLikedSidebarEntry(sidebarFoldersList'), 'the watch sidebar must apply the shared Liked entry helper (v1.33.1 -- Dean: it was missing there)');
  // v1.33.1 (QA gate): the remaining surfaces -- setup.js's sidebar render,
  // the mobile Playlists sheet, the shared boot call that covers the
  // stats/subscriptions shells -- and the two count-mutating refresh hooks
  // (like toggle + item delete), static-scan-locked so no surface can
  // silently drop the shared helper.
  const setupSrc = fs32.readFileSync(require('node:path').join(__dirname, '../../public/js/setup.js'), 'utf8');
  a32l.ok(setupSrc.includes('applyLikedSidebarEntry(sidebarContainer'), 'the setup sidebar must apply the shared Liked entry helper');
  a32l.ok(commonSrc.includes('applyLikedSidebarEntry(list)'), 'the mobile Playlists sheet must route through the shared helper');
  a32l.ok(commonSrc.includes("applyLikedSidebarEntry(document.getElementById('sidebar-folders-list'))"), 'the shared boot call must cover the stats/subscriptions shells');
  a32l.ok((watchSrc.match(/applyLikedSidebarEntry\(sidebarFoldersList, \{ force: true \}\)/g) || []).length >= 2, 'both count-mutating paths (like toggle AND item delete) must force-refresh the cached total');
});
