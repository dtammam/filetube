'use strict';

// [INTEGRATION] v1.30 C2 (Visual polish cluster, T11) -- Like -> "Liked"
// playlist. Membership is the SINGLE source of truth for like state; there
// is no separate boolean flag anywhere. Covers:
//
//   AC7.3 (headline): add / duplicate-add (idempotent, no dup) / remove
//   round-trip leaves NO residual membership. GET /api/liked reflects the
//   current set in the T6 {items,total,offset,limit} shape.
//
//   Write posture (was AC4.2's 1:1 doc-table save): each liked route is one
//   direct durable write against user_liked -- unbatched, unlike the T5
//   progress coalescer -- and NEVER a doc-table save (the frozen-record
//   contract), asserted via the `__getSaveDatabaseCallCount` spy.
//
//   Backfill: a legacy/partial store without `liked` loads with
//   `db.liked = []` across the loadDatabase default paths (the FROZEN
//   pre-auth record -- readers no longer consult it, but its shape contract
//   holds for adoption + old-tag parallel-run).
//
// v1.43 (chunk 4b): a Like belongs to a USER -- membership lives in the
// relational `user_liked` table keyed by (user_id, media_id). The doc-table
// `db.liked` array is retained untouched as the frozen pre-auth record; the
// routes read/write ONLY the signed-in user's rows.
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
  __resetDatabaseForTests,
  __mintTestSession,
  userStore,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
let uid; // the authenticated test admin's user id

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

// Seed helper: every test starts with an empty user_liked slate for the
// admin (saveDatabase only resets doc tables; per-user rows are relational).
function clearUserLiked() {
  for (const id of userStore.getLiked(uid)) userStore.removeLiked(uid, id);
}

// ---- AC7.3: add / duplicate-add (idempotent) / remove round-trip ----------

test('AC7.3: POST /api/liked/:id adds membership (per-user)', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { likeA: seedItem('likeA') },
    liked: [],
    settings: baseSettings(),
  });
  clearUserLiked();

  const res = await like('likeA');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.liked, true);

  assert.deepEqual(userStore.getLiked(uid), ['likeA']);
  assert.deepEqual(loadDatabase().liked, [], 'the frozen db.liked record is never written by the route');
});

test('AC7.3: a duplicate POST /api/liked/:id is idempotent -- no duplicate entry', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { likeB: seedItem('likeB') },
    liked: [],
    settings: baseSettings(),
  });
  clearUserLiked();

  await like('likeB');
  const res = await like('likeB'); // second, duplicate add
  assert.equal(res.status, 200);

  assert.deepEqual(userStore.getLiked(uid), ['likeB'], 'a duplicate add must never produce a second entry');
});

test('AC7.3: DELETE /api/liked/:id removes membership, and the round-trip leaves NO residual membership', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { likeC: seedItem('likeC') },
    liked: [],
    settings: baseSettings(),
  });
  clearUserLiked();

  await like('likeC');
  assert.deepEqual(userStore.getLiked(uid), ['likeC']);

  const res = await unlike('likeC');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.liked, false);

  assert.deepEqual(userStore.getLiked(uid), [], 'like-then-unlike must leave no residual membership');
});

test('AC7.3: removing a non-member is a no-op (idempotent) and never throws/errors', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { likeD: seedItem('likeD'), someOtherId: seedItem('someOtherId') },
    liked: [],
    settings: baseSettings(),
  });
  clearUserLiked();
  await like('someOtherId');

  const res = await unlike('likeD'); // never liked in the first place
  assert.equal(res.status, 200);
  assert.deepEqual(userStore.getLiked(uid), ['someOtherId'], 'unrelated membership must be untouched');
});

test('AC7.3: POST /api/liked/:id 404s for an id that is not a real library item', async () => {
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, liked: [], settings: baseSettings() });
  clearUserLiked();
  const res = await like('ghost-id');
  assert.equal(res.status, 404);
  assert.deepEqual(userStore.getLiked(uid), [], 'a 404 must never stage a membership entry');
});

// ---- GET /api/liked: T6 {items,total,offset,limit} shape, membership set --

test('GET /api/liked lists exactly the current user\'s liked set in the {items,total,offset,limit} shape', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      lik1: seedItem('lik1', { addedAt: 1000 }),
      lik2: seedItem('lik2', { addedAt: 2000 }),
      lik3: seedItem('lik3', { addedAt: 3000 }), // never liked
    },
    liked: [],
    settings: baseSettings(),
  });
  clearUserLiked();
  await like('lik1');
  await like('lik2');

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
  clearUserLiked();
  const res = await fetch(`${base}/api/liked`);
  const body = await res.json();
  assert.deepEqual(body, { items: [], total: 0, offset: 0, limit: body.limit });
});

// ---- v1.43: per-user isolation --------------------------------------------

test('per-user isolation: each user\'s Liked view is their OWN -- likes never bleed across accounts', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { mineOnly: seedItem('mineOnly'), yoursOnly: seedItem('yoursOnly') },
    liked: [],
    settings: baseSettings(),
  });
  clearUserLiked();
  const second = __mintTestSession({ username: 'likeduser2' });
  for (const id of userStore.getLiked(second.user.id)) userStore.removeLiked(second.user.id, id);

  await like('mineOnly'); // the admin
  const res = await fetch(`${base}/api/liked/yoursOnly`, { method: 'POST', headers: { Cookie: second.cookie } });
  assert.equal(res.status, 200);

  const adminList = await (await fetch(`${base}/api/liked`)).json();
  assert.deepEqual(adminList.items.map((i) => i.id), ['mineOnly'], 'the admin sees only their own like');
  const secondList = await (await fetch(`${base}/api/liked`, { headers: { Cookie: second.cookie } })).json();
  assert.deepEqual(secondList.items.map((i) => i.id), ['yoursOnly'], 'the second user sees only THEIR like');

  // The per-item derived flag is per-user too (the card-heart initial state).
  const adminItem = await (await fetch(`${base}/api/videos/yoursOnly`)).json();
  assert.equal(adminItem.liked, false, 'another user\'s like never lights the admin\'s heart');
  const secondItem = await (await fetch(`${base}/api/videos/yoursOnly`, { headers: { Cookie: second.cookie } })).json();
  assert.equal(secondItem.liked, true);
});

test('v1.43 carrier: DELETE /api/videos/:id removes the deleting user\'s AND every other user\'s like/progress rows for the item', async () => {
  const filePath = path.join(os.tmpdir(), `filetube-liked-delete-${Date.now()}.mp4`);
  fs.writeFileSync(filePath, 'bytes');
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { delCarrier: seedItem('delCarrier', { filePath }) },
    liked: [],
    settings: baseSettings(),
  });
  clearUserLiked();
  const second = __mintTestSession({ username: 'likeduser3' });
  await like('delCarrier');
  userStore.addLiked(second.user.id, 'delCarrier', new Date().toISOString());
  userStore.setProgress(second.user.id, 'delCarrier', { timestamp: 9, duration: 100, updatedAt: new Date().toISOString() });

  const res = await fetch(`${base}/api/videos/delCarrier`, { method: 'DELETE' });
  assert.equal(res.status, 200);

  assert.deepEqual(userStore.getLiked(uid), [], 'the deleter\'s like goes with the item');
  assert.ok(!userStore.getLiked(second.user.id).includes('delCarrier'), 'every OTHER user\'s like goes too (no stale resurrection onto a same-path re-add)');
  assert.equal(userStore.getOneProgress(second.user.id, 'delCarrier'), null, 'and their progress row');
});

// ---- GET /api/videos/:id: derived `liked` field (not persisted) -----------

test('GET /api/videos/:id derives `liked` from the user\'s membership at request time', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { derivedA: seedItem('derivedA') },
    liked: [],
    settings: baseSettings(),
  });
  clearUserLiked();
  await like('derivedA');
  let res = await fetch(`${base}/api/videos/derivedA`);
  let body = await res.json();
  assert.equal(body.liked, true);

  await unlike('derivedA');
  res = await fetch(`${base}/api/videos/derivedA`);
  body = await res.json();
  assert.equal(body.liked, false, 'the derived field must reflect membership immediately after unlike, never a stale/stored flag');
});

// ---- Write posture: direct user-table writes, ZERO doc-table saves --------

test('liked routes never issue a doc-table save (the frozen-record contract), while membership still commits durably', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { writeA: seedItem('writeA') },
    liked: [],
    settings: baseSettings(),
  });
  clearUserLiked();
  const before = __getSaveDatabaseCallCount();
  assert.equal((await like('writeA')).status, 200);
  assert.equal((await like('writeA')).status, 200); // duplicate add
  assert.equal((await unlike('writeA')).status, 200);
  assert.equal((await unlike('writeA')).status, 200); // non-member remove
  assert.equal(__getSaveDatabaseCallCount() - before, 0,
    'like/unlike write user_liked directly -- the doc tables (and db.liked) are never touched');
  assert.deepEqual(userStore.getLiked(uid), [], 'the round-trip still left the correct committed end state');
});

// ---- Backfill: db.liked = [] across all three loadDatabase default paths --

test('backfill: an empty (fresh) persisted store loads with liked: []', async () => {
  // v1.42: the "no db file" branch became "no rows" — an empty store must
  // still assemble to a liked-bearing default. (Pre-v1.42 this test removed
  // db.json and asserted the initial-create write; the eager write is
  // subsumed by the adapter, defaults persist on the first real save.)
  await __resetDatabaseForTests();
  const db = loadDatabase();
  assert.deepEqual(db.liked, [], 'a fresh store must carry liked: []');
});

test('backfill: a legacy/partial persisted set missing `liked` loads with db.liked = []', () => {
  // Seeded through saveDatabase with the `liked` key deliberately absent —
  // the same pre-C2 legacy shape the old raw-write seeded, now expressed
  // through the seam (the import path's raw-fixture leg is covered in
  // test/unit/db-sqlite-adapter.test.js's legacy-shape import test).
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { legacy: seedItem('legacy') },
    settings: baseSettings(),
    // deliberately no `liked` key at all
  });

  const db = loadDatabase();
  assert.deepEqual(db.liked, [], 'a legacy set without `liked` must backfill to []');
  assert.ok(db.metadata.legacy, 'other fields must remain intact after backfill');
});

test('v1.42 migration-path: a corrupt db.json beside the ACTIVE store is inert (liked reads keep working)', () => {
  // Pre-v1.42 a corrupt db.json triggered loadDatabase's reset-to-fresh
  // recovery (and this test asserted the fallback carried liked: []). The
  // recovery path no longer exists: db.json is a frozen legacy artifact once
  // filetube.db is live — garbage in it must not perturb anything. (Corrupt
  // db.json at FIRST boot aborts the import instead — AC9, adapter suite.)
  fs.writeFileSync(DB_FILE, '{ not valid json', 'utf8');
  const db = loadDatabase();
  assert.deepEqual(db.liked, [], 'load ignores the corrupt legacy file entirely');
  assert.ok(db.settings, 'and still yields a settings-bearing DB');
  fs.rmSync(DB_FILE);
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
