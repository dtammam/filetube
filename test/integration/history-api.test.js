'use strict';

// [INTEGRATION] v1.64 watch history -- GET /api/history against the REAL
// app: the merged user_progress + user_watched listing, newest first by the
// per-media max(updated_at, completed_at), with the staged coalescer
// overlay (read-your-writes), dead-media filtering at read time, the
// {items,total,offset,limit} page shape, and per-user isolation. Auth is
// the real gate (patched-fetch helper); 401s are the census suite's
// business. PROGRESS_FLUSH_MS is set far above the suite's runtime so the
// debounce timer NEVER fires on its own -- staged-vs-flushed state is
// controlled explicitly via the exported flushPendingProgress.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-historyapi-'));
process.env.PROGRESS_FLUSH_MS = '600000';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app,
  updateDatabase,
  userStore,
  flushPendingProgress,
  __resetDatabaseForTests,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, uid;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  uid = auth.user.id;
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  // Drain any staged pings BEFORE the reset (the reset wipes the tables the
  // flush writes into, leaving both the map and the tables empty).
  await flushPendingProgress();
  await __resetDatabaseForTests();
  await updateDatabase((db) => {
    for (const n of [1, 2, 3, 4]) {
      db.metadata[`vid-${n}`] = {
        id: `vid-${n}`, name: `Clip ${n}.mp4`, title: `Clip ${n}`, type: 'video', ext: '.mp4',
        filePath: `/lib/Clip ${n}.mp4`, size: 10, duration: 100,
        addedAt: Date.UTC(2026, 5, 20) + n, folderName: 'Chan', channelName: 'Chan',
      };
    }
  });
});

const GET = (qs) => fetch(`${base}/api/history${qs || ''}`).then((r) => r.json());
const ping = (id, timestamp, duration) => fetch(`${base}/api/progress`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id, timestamp, duration }),
});

const T = (d, h) => `2026-07-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;

test('empty history: {items: [], total: 0} in the page shape', async () => {
  const body = await GET();
  assert.deepEqual(body.items, []);
  assert.equal(body.total, 0);
  assert.equal(typeof body.offset, 'number');
  assert.equal(typeof body.limit, 'number');
});

test('merged newest-first: progress-only, watched-only and both-rows items order by max(updated_at, completed_at)', async () => {
  // vid-1: started only, oldest signal.
  userStore.setProgress(uid, 'vid-1', { timestamp: 10, duration: 100, updatedAt: T(1, 0) });
  // vid-2: watched latch only (no progress row) -- must still appear.
  userStore.markWatched(uid, 'vid-2', T(2, 0));
  // vid-3: BOTH rows; the newer completed_at must win the ordering key.
  userStore.setProgress(uid, 'vid-3', { timestamp: 95, duration: 100, updatedAt: T(1, 12) });
  userStore.markWatched(uid, 'vid-3', T(3, 0));

  const body = await GET();
  assert.deepEqual(body.items.map((i) => i.id), ['vid-3', 'vid-2', 'vid-1']);
  assert.equal(body.total, 3);

  const [v3, v2, v1] = body.items;
  assert.equal(v3.watchState, 'watched');
  assert.equal(v3.lastWatchedAt, T(3, 0), 'both-rows item is dated by the newer signal');
  assert.equal(v3.progress, 95, 'the resume point rides along');
  assert.equal(v2.watchState, 'watched', 'latch-only item derives watched with zero progress');
  assert.equal(v2.progress, 0);
  assert.equal(v2.lastWatchedAt, T(2, 0));
  assert.equal(v1.watchState, 'watching');
  assert.equal(Math.round(v1.progressPercent), 10);
  assert.equal(v1.title, 'Clip 1', 'items carry the full metadata for card rendering');
});

test('a staged (un-flushed) ping is visible immediately and leads the list -- read-your-writes', async () => {
  userStore.setProgress(uid, 'vid-1', { timestamp: 10, duration: 100, updatedAt: T(1, 0) });
  const res = await ping('vid-2', 42, 100);
  assert.equal(res.status, 200);

  const body = await GET();
  assert.deepEqual(body.items.map((i) => i.id), ['vid-2', 'vid-1'], 'the just-watched item is first, pre-flush');
  assert.equal(body.items[0].progress, 42, 'the staged position, not a committed row, is what the page shows');

  // And the same answer AFTER the flush commits it (the overlay and the
  // durable row agree).
  await flushPendingProgress();
  const after1 = await GET();
  assert.deepEqual(after1.items.map((i) => i.id), ['vid-2', 'vid-1']);
  assert.equal(after1.items[0].progress, 42);
});

test('dead media ids are filtered at read time -- items AND total', async () => {
  userStore.setProgress(uid, 'vid-1', { timestamp: 10, duration: 100, updatedAt: T(1, 0) });
  userStore.setProgress(uid, 'ghost-id', { timestamp: 50, duration: 100, updatedAt: T(5, 0) });
  userStore.markWatched(uid, 'ghost-latch', T(6, 0));

  const body = await GET();
  assert.deepEqual(body.items.map((i) => i.id), ['vid-1'], 'rows without live metadata never surface');
  assert.equal(body.total, 1, 'total counts the LIVE set, not the raw rows');
});

test('pagination: limit/offset slice the merged set; total stays the full count', async () => {
  for (const n of [1, 2, 3, 4]) {
    userStore.setProgress(uid, `vid-${n}`, { timestamp: 10, duration: 100, updatedAt: T(10, n) });
  }
  const page1 = await GET('?limit=2&offset=0');
  const page2 = await GET('?limit=2&offset=2');
  assert.deepEqual(page1.items.map((i) => i.id), ['vid-4', 'vid-3']);
  assert.deepEqual(page2.items.map((i) => i.id), ['vid-2', 'vid-1']);
  assert.equal(page1.total, 4);
  assert.equal(page2.total, 4);
  assert.equal(page1.limit, 2);
  assert.equal(page2.offset, 2);
});

test('per-user isolation: another user\'s rows never appear', async () => {
  const other = userStore.createUser({ username: 'other-hist', displayName: 'O', passwordHash: 'h', role: 'member' }, T(1, 0));
  userStore.setProgress(other.id, 'vid-1', { timestamp: 10, duration: 100, updatedAt: T(9, 0) });
  userStore.markWatched(other.id, 'vid-2', T(9, 0));
  userStore.setProgress(uid, 'vid-3', { timestamp: 10, duration: 100, updatedAt: T(1, 0) });

  const body = await GET();
  assert.deepEqual(body.items.map((i) => i.id), ['vid-3']);
  assert.equal(body.total, 1);
});

test('a null updated_at row (legacy batch shape) still lists, sorted oldest', async () => {
  userStore.setProgressBatch([
    { userId: uid, mediaId: 'vid-1', value: { timestamp: 10, duration: 100, updatedAt: null } },
  ]);
  userStore.setProgress(uid, 'vid-2', { timestamp: 10, duration: 100, updatedAt: T(1, 0) });
  const body = await GET();
  assert.deepEqual(body.items.map((i) => i.id), ['vid-2', 'vid-1']);
  assert.equal(body.items[1].lastWatchedAt, null, 'an unknown stamp is surfaced as null, not an empty string');
});
