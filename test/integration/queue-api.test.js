'use strict';

// [INTEGRATION] v1.63 playback queue -- the six /api/queue endpoints against
// the REAL app: add end/next, strict-bijection reorder (409 for stale
// clients), pointer semantics over HTTP, remove (incl. the pointer-back
// rule), clear, dead-media filtering at read, the NINTH id-keyed carrier
// (removeMediaState purges queues), per-user isolation, and the backup
// export shape. Auth is the real gate (patched-fetch helper); 401s are the
// census suite's business.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-queueapi-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, userStore, __resetDatabaseForTests } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await __resetDatabaseForTests();
  await updateDatabase((db) => {
    for (const n of [1, 2, 3]) {
      db.metadata[`vid-${n}`] = {
        id: `vid-${n}`, name: `Clip ${n}.mp4`, title: `Clip ${n}`, type: 'video', ext: '.mp4',
        filePath: `/lib/Clip ${n}.mp4`, size: 10, addedAt: Date.UTC(2026, 5, 20) + n,
        folderName: 'Chan', channelName: 'Chan',
      };
    }
  });
  userStore.setQueue(auth.user.id, [], null, 0);
});

const j = async (r) => { assert.ok(r.ok || r.status < 500, `no 5xx: ${r.status}`); return { status: r.status, body: await r.json() }; };
const GET = () => fetch(`${base}/api/queue`).then((r) => r.json());
const add = (mediaId, position) => fetch(`${base}/api/queue/items`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaId, position }),
}).then(j);

test('empty queue: entries [], null pointer (the header icon existence check)', async () => {
  const q = await GET();
  assert.deepEqual(q.entries, []);
  assert.equal(q.pointerUid, null);
});

test('add end + add next land per the reducer; unknown media is 404; items ride shaped', async () => {
  const a = await add('vid-1');
  assert.equal(a.status, 200);
  assert.equal(a.body.added.mediaId, 'vid-1');
  await add('vid-2');
  // start playback at vid-1, then Play Next should slot vid-3 between them
  const q1 = await GET();
  await fetch(`${base}/api/queue/pointer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: q1.entries[0].uid }) });
  await add('vid-3', 'next');
  const q2 = await GET();
  assert.deepEqual(q2.entries.map((e) => e.mediaId), ['vid-1', 'vid-3', 'vid-2']);
  assert.equal(q2.entries[0].item.title, 'Clip 1', 'entries carry the full metadata item for card rendering');
  const missing = await add('ghost-id');
  assert.equal(missing.status, 404);
});

test('reorder: happy path persists; a stale uid set is 409 REFUSED, state untouched', async () => {
  await add('vid-1'); await add('vid-2'); await add('vid-3');
  const q = await GET();
  const rev = q.entries.map((e) => e.uid).reverse();
  const ok = await fetch(`${base}/api/queue/reorder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderedUids: rev }) }).then(j);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.queue.entries.map((e) => e.mediaId), ['vid-3', 'vid-2', 'vid-1']);
  const stale = await fetch(`${base}/api/queue/reorder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderedUids: rev.slice(1) }) }).then(j);
  assert.equal(stale.status, 409);
  assert.deepEqual((await GET()).entries.map((e) => e.mediaId), ['vid-3', 'vid-2', 'vid-1'], 'refused reorder mutated nothing');
});

test('remove: now-playing removal steps the pointer BACK (next lands on the successor); ghost uid 404', async () => {
  await add('vid-1'); await add('vid-2'); await add('vid-3');
  const q = await GET();
  const mid = q.entries[1];
  await fetch(`${base}/api/queue/pointer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: mid.uid }) });
  const r = await fetch(`${base}/api/queue/items/${mid.uid}`, { method: 'DELETE' }).then(j);
  assert.equal(r.status, 200);
  assert.equal(r.body.queue.pointerUid, q.entries[0].uid, 'pointer stepped back to the predecessor');
  const ghost = await fetch(`${base}/api/queue/items/nope`, { method: 'DELETE' }).then(j);
  assert.equal(ghost.status, 404);
});

test('pointer: null restarts; ghost uid 404; bad body 400', async () => {
  await add('vid-1');
  const q = await GET();
  const set = await fetch(`${base}/api/queue/pointer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: q.entries[0].uid }) }).then(j);
  assert.equal(set.body.queue.pointerUid, q.entries[0].uid);
  const restart = await fetch(`${base}/api/queue/pointer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: null }) }).then(j);
  assert.equal(restart.body.queue.pointerUid, null);
  assert.equal((await fetch(`${base}/api/queue/pointer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: 'ghost' }) }).then(j)).status, 404);
  assert.equal((await fetch(`${base}/api/queue/pointer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: 5 }) }).then(j)).status, 400);
});

test('clear: the whole queue dies in one call', async () => {
  await add('vid-1'); await add('vid-2');
  const r = await fetch(`${base}/api/queue`, { method: 'DELETE' }).then(j);
  assert.equal(r.status, 200);
  const q = await GET();
  assert.deepEqual(q.entries, []);
  assert.equal(q.pointerUid, null);
});

test('dead-media filter at READ: an id that leaves metadata vanishes from the view (pointer re-normalized)', async () => {
  await add('vid-1'); await add('vid-2');
  const q = await GET();
  await fetch(`${base}/api/queue/pointer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: q.entries[1].uid }) });
  await updateDatabase((db) => { delete db.metadata['vid-2']; });
  const filtered = await GET();
  assert.deepEqual(filtered.entries.map((e) => e.mediaId), ['vid-1'], 'dead id filtered');
  assert.equal(filtered.pointerUid, null, 'orphaned pointer re-normalized, never served dangling');
});

test('NINTH carrier: removeMediaState purges the entry from the STORE (not just the view)', async () => {
  await add('vid-1'); await add('vid-2');
  userStore.removeMediaState('vid-1');
  const raw = userStore.getQueue(auth.user.id);
  assert.deepEqual(raw.entries.map((e) => e.mediaId), ['vid-2'], 'the row itself is gone');
});

test('rekeyMediaState re-keys queue entries (relocation survival)', async () => {
  await add('vid-1');
  userStore.rekeyMediaState('vid-1', 'vid-1-moved');
  const raw = userStore.getQueue(auth.user.id);
  assert.deepEqual(raw.entries.map((e) => e.mediaId), ['vid-1-moved']);
});

test('per-user isolation + backup export shape (the NINTH carrier rides users[])', async () => {
  await add('vid-1');
  const other = userStore.createUser({ username: 'qother', passwordHash: 'scrypt$32768$8$1$aa$bb', role: 'member' }, new Date().toISOString());
  assert.deepEqual(userStore.getQueue(other.id).entries, [], 'a second user has their own empty queue');
  const exported = userStore.exportUsersForBackup().find((u) => u.id === auth.user.id);
  assert.ok(exported.queue, 'queue rides the bundle');
  assert.equal(exported.queue.entries.length, 1);
  assert.equal(exported.queue.entries[0].mediaId, 'vid-1');
  assert.ok(Object.prototype.hasOwnProperty.call(exported.queue, 'pointerUid'));
});
