'use strict';

// [INTEGRATION] v1.50 T2: `GET /api/videos?watch=` + the sticky completion
// latch. Proves through the real routes: (1) the latch is set by the first
// progress ping crossing WATCHED_PCT and read back via the filter, (2) a
// later low-timestamp ping (loop restart / rewatch-from-0) NEVER un-watches
// (the intake's autoplay/loop hazard), (3) the filter is per-user (user A's
// watches don't filter user B's view), (4) read-your-writes: an un-flushed
// pending ping already moves an item between filter buckets, and (5) the
// `watchState` field on every returned item.
//
// Isolated DATA_DIR before requiring the app -- own process per file,
// mirroring test/integration/stats-and-view.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-watchfilter-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, __resetDatabaseForTests, __mintTestSession, flushPendingProgress, userStore } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
let session;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  session = authenticateFetch(server, base); // v1.43: auth through the real gate
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await __resetDatabaseForTests();
});

function writeDb(db) {
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, ...db });
}

function seedItem(id, overrides) {
  return {
    id, title: id, type: 'video', ext: '.mp4', folderName: 'Movies',
    filePath: `/media/Movies/${id}.mp4`, artist: '', size: 1000, duration: 100,
    addedAt: 1700000000000,
    ...overrides,
  };
}

async function postProgress(id, timestamp, duration) {
  const res = await fetch(`${base}/api/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, timestamp, duration }),
  });
  assert.equal(res.status, 200);
}

async function fetchIds(query, extraOpts) {
  const res = await fetch(`${base}/api/videos?${query}`, extraOpts);
  assert.equal(res.status, 200);
  const body = await res.json();
  return { ids: body.items.map((i) => i.id).sort(), body };
}

test('watch=new/watching/watched partition the library by this user\'s progress; total reflects the filter', async () => {
  writeDb({ metadata: { fresh: seedItem('fresh'), started: seedItem('started'), done: seedItem('done') } });
  await postProgress('started', 40, 100);
  await postProgress('done', 95, 100);
  await flushPendingProgress();

  assert.deepEqual((await fetchIds('watch=new')).ids, ['fresh']);
  assert.deepEqual((await fetchIds('watch=watching')).ids, ['started']);
  const watched = await fetchIds('watch=watched');
  assert.deepEqual(watched.ids, ['done']);
  assert.equal(watched.body.total, 1, 'total is the filtered length, not the library size');
  assert.deepEqual((await fetchIds('watch=all')).ids, ['done', 'fresh', 'started']);
  assert.deepEqual((await fetchIds('')).ids, ['done', 'fresh', 'started'], 'absent param behaves as all (no regression)');
  assert.deepEqual((await fetchIds('watch=garbage')).ids, ['done', 'fresh', 'started'], 'unknown value fails safe to all');
});

test('the latch is STICKY: a loop-restart ping near 0 never un-watches (the intake hazard)', async () => {
  writeDb({ metadata: { loopy: seedItem('loopy') } });
  await postProgress('loopy', 95, 100); // crosses WATCHED_PCT -> latch
  await flushPendingProgress();
  assert.deepEqual((await fetchIds('watch=watched')).ids, ['loopy']);

  // The loop restarts: live position back at 2s. Both BEFORE the flush
  // (pending overlay) and AFTER it (committed row), the latch must hold.
  await postProgress('loopy', 2, 100);
  assert.deepEqual((await fetchIds('watch=watched')).ids, ['loopy'], 'still watched with the low ping un-flushed');
  assert.deepEqual((await fetchIds('watch=watching')).ids, [], 'never demoted to watching');
  await flushPendingProgress();
  assert.deepEqual((await fetchIds('watch=watched')).ids, ['loopy'], 'still watched after the low position committed');
  assert.deepEqual((await fetchIds('watch=new')).ids, []);
});

test('read-your-writes: an UN-FLUSHED ping already moves the item out of "new"', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  await postProgress('v1', 40, 100); // staged in pendingProgress only
  assert.deepEqual((await fetchIds('watch=watching')).ids, ['v1']);
  assert.deepEqual((await fetchIds('watch=new')).ids, []);
});

test('per-user isolation: user A\'s watched never filters user B\'s view', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  await postProgress('v1', 95, 100); // user A (the patched-fetch session)
  await flushPendingProgress();
  assert.deepEqual((await fetchIds('watch=new')).ids, [], 'A has watched it');

  // User B: a second real session cookie, sent explicitly (the patched
  // global.fetch respects an explicit Cookie header).
  const other = __mintTestSession({ username: 'otheruser', role: 'member' });
  const asB = { headers: { Cookie: other.cookie } };
  assert.deepEqual((await fetchIds('watch=new', asB)).ids, ['v1'], 'B still sees it as new');
  assert.deepEqual((await fetchIds('watch=watched', asB)).ids, []);
});

test('every item carries a server-derived watchState field', async () => {
  writeDb({ metadata: { fresh: seedItem('fresh'), started: seedItem('started'), done: seedItem('done') } });
  await postProgress('started', 40, 100);
  await postProgress('done', 95, 100);
  await flushPendingProgress();

  const { body } = await fetchIds('');
  const states = Object.fromEntries(body.items.map((i) => [i.id, i.watchState]));
  assert.deepEqual(states, { fresh: 'new', started: 'watching', done: 'watched' });
});

test('a ping BELOW the threshold never latches; duration fallback to the item\'s own duration works', async () => {
  writeDb({ metadata: { v1: seedItem('v1', { duration: 200 }) } });
  await postProgress('v1', 89, 100); // 89% of explicit duration -- no latch
  await flushPendingProgress();
  assert.deepEqual((await fetchIds('watch=watched')).ids, []);
  assert.deepEqual(userStore.getWatchedIds(session.user.id), [], 'no latch row');

  // No duration in the ping -> the item's own duration (200) applies: 190/200 = 95%.
  await postProgress('v1', 190);
  assert.deepEqual(userStore.getWatchedIds(session.user.id), ['v1'], 'latched via item-duration fallback');
});

test('GET /api/liked honors ?watch= too (the v1.32 format-toggle parity posture) and carries watchState', async () => {
  writeDb({ metadata: { fresh: seedItem('fresh'), done: seedItem('done') } });
  for (const id of ['fresh', 'done']) {
    const res = await fetch(`${base}/api/liked/${id}`, { method: 'POST' });
    assert.equal(res.status, 200);
  }
  await postProgress('done', 95, 100);
  await flushPendingProgress();

  const likedNew = await fetch(`${base}/api/liked?watch=new`);
  assert.equal(likedNew.status, 200);
  const newBody = await likedNew.json();
  assert.deepEqual(newBody.items.map((i) => i.id), ['fresh']);
  assert.equal(newBody.total, 1);
  assert.equal(newBody.items[0].watchState, 'new');

  const likedWatched = await fetch(`${base}/api/liked?watch=watched`);
  const watchedBody = await likedWatched.json();
  assert.deepEqual(watchedBody.items.map((i) => i.id), ['done']);
  assert.equal(watchedBody.items[0].watchState, 'watched');
});

test('deleting media removes the latch row with the other per-user state (id-keyed carrier)', async () => {
  // Through the store carrier directly (the DELETE route funnels here) --
  // proves user_watched joined removeMediaState.
  writeDb({ metadata: { v1: seedItem('v1') } });
  await postProgress('v1', 95, 100);
  await flushPendingProgress();
  assert.deepEqual(userStore.getWatchedIds(session.user.id), ['v1']);
  userStore.removeMediaState(['v1']);
  assert.deepEqual(userStore.getWatchedIds(session.user.id), []);
});

test('moving media re-keys the latch row (id-keyed carrier)', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  await postProgress('v1', 95, 100);
  await flushPendingProgress();
  userStore.rekeyMediaState('v1', 'v1-moved');
  assert.deepEqual(userStore.getWatchedIds(session.user.id), ['v1-moved']);
});

// KEEP THIS TEST LAST: the users-carrying restore bumps every token_version
// (the v1.43 CRITICAL-1 floor), killing the suite's patched-fetch cookie --
// every assertion after the restore goes through userStore directly, but any
// LATER test's fetches would 401 (see backup-restore.test.js's re-auth
// beforeEach for the pattern if more tests are ever appended).
test('backup export carries the watched latch and a restore round-trips it (through the real endpoints)', async () => {
  writeDb({ metadata: { v1: seedItem('v1') } });
  await postProgress('v1', 95, 100);
  await flushPendingProgress();

  const backupRes = await fetch(`${base}/api/admin/backup`);
  assert.equal(backupRes.status, 200);
  const bundle = await backupRes.json();
  const me = bundle.users.find((u) => u.id === session.user.id);
  assert.ok(me, 'bundle contains the session user');
  assert.deepEqual(me.watched.map((w) => w.mediaId), ['v1'], 'watched rides the bundle');

  await __resetDatabaseForTests(); // wipes per-user state, keeps the account + cookie
  assert.deepEqual(userStore.getWatchedIds(session.user.id), [], 'precondition: latch wiped');

  const restoreRes = await fetch(`${base}/api/admin/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  assert.equal(restoreRes.status, 200);
  assert.deepEqual(userStore.getWatchedIds(session.user.id), ['v1'], 'latch restored');
});
