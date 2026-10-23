'use strict';

// [INTEGRATION] v1.394.0 W2: `media_source_comments` (lib/media/sourceComments.js) rides every
// id-keyed carrier, through the REAL routes. Each case populates FIRST, then drives the move /
// clear / refuse axis (no vacuous floor):
//   - move re-keys the row to the new path's id (no row left under the old id);
//   - trash re-keys it to the trashId, restore re-keys it back, purge reaps it (no orphan);
//   - a hard delete (file already gone) reaps it;
//   - a restore whose bundle carries a malformed snapshot is a 400 BEFORE the wipe;
//   - a bundle WITHOUT the key keeps the snapshots of the videos the bundle still has, and only those;
//   - the writer refuses a NUL-bearing id (node:sqlite reads it back truncated).

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, __resetDatabaseForTests, sourceCommentStore, getMediaId, userStore } = require('../../server');
const { seedState, trashStore } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
let auth;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(async () => {
  await __resetDatabaseForTests();
  // a users-restoring restore bumps the admin's token_version: re-sign the harness cookie (backup-restore.test.js's posture)
  auth.restore();
  auth = authenticateFetch(server, base);
});

const SNAP = {
  state: 'ok', fetchedAt: '2026-10-20T00:00:00.000Z',
  comments: [{ id: 'c1', text: 'first! https://example.com at 0:30', author: 'Viewer', likeCount: 3, isPinned: true }],
};
const SETTINGS = { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30, trashRetentionDays: 30 };

function itemAt(filePath, root) {
  const id = getMediaId(filePath);
  return { id, title: 'Clip', name: path.basename(filePath), filePath, folderName: 'M', rootFolder: root, type: 'video', ext: '.mp4', duration: 10, size: 1, addedAt: 1 };
}
function seedOne(filePath, root, extraFolders) {
  const it = itemAt(filePath, root);
  seedState({ folders: [root, ...(extraFolders || [])], folderSettings: {}, liked: [], metadata: { [it.id]: it }, settings: SETTINGS });
  sourceCommentStore.apply(it.id, SNAP);
  assert.deepStrictEqual(sourceCommentStore.get(it.id), SNAP, 'precondition: a real snapshot to carry');
  return it;
}

test('move: the snapshot follows the item to its new id; nothing is left under the old id', async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sc-src-'));
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sc-dst-'));
  const fp = path.join(src, 'clip.mp4');
  fs.writeFileSync(fp, 'bytes');
  const it = seedOne(fp, src, [dst]);
  const res = await fetch(`${base}/api/videos/${it.id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetFolder: dst }) });
  assert.strictEqual(res.status, 200, await res.text());
  const newId = getMediaId(path.join(dst, 'clip.mp4'));
  assert.notStrictEqual(newId, it.id);
  assert.deepStrictEqual(sourceCommentStore.get(newId), SNAP, 'the snapshot is under the new id');
  assert.strictEqual(sourceCommentStore.get(it.id), null, 'no row under the old id');
  assert.strictEqual(sourceCommentStore.size(), 1, 'one row, no orphan');
});

test('trash -> restore -> trash -> purge: re-keyed both ways, then reaped', async () => {
  const fp = path.join(DATA_DIR, 'sc-trash.mp4');
  fs.writeFileSync(fp, 'bytes');
  const it = seedOne(fp, DATA_DIR);
  const del = await fetch(`${base}/api/videos/${it.id}`, { method: 'DELETE' });
  assert.strictEqual(del.status, 200, await del.text());
  const tid = Object.keys(trashStore().getAll())[0];
  assert.ok(tid && tid !== it.id, 'trashed, not hard-deleted');
  assert.deepStrictEqual(sourceCommentStore.get(tid), SNAP, 'the snapshot rode to the trashId');
  assert.strictEqual(sourceCommentStore.get(it.id), null);

  const back = await fetch(`${base}/api/trash/${encodeURIComponent(tid)}/restore`, { method: 'POST' });
  assert.strictEqual(back.status, 200, await back.text());
  assert.deepStrictEqual(sourceCommentStore.get(it.id), SNAP, 'restore brought it back to the original id');
  assert.strictEqual(sourceCommentStore.get(tid), null);

  const del2 = await fetch(`${base}/api/videos/${it.id}`, { method: 'DELETE' });
  assert.strictEqual(del2.status, 200);
  const tid2 = Object.keys(trashStore().getAll())[0];
  assert.deepStrictEqual(sourceCommentStore.get(tid2), SNAP);
  const purge = await fetch(`${base}/api/trash/${encodeURIComponent(tid2)}`, { method: 'DELETE' });
  assert.strictEqual(purge.status, 200, await purge.text());
  assert.strictEqual(sourceCommentStore.size(), 0, 'the purge reaped it; no orphan anywhere');
});

test('hard delete (file already gone) reaps the snapshot', async () => {
  const it = seedOne(path.join(DATA_DIR, 'sc-gone.mp4'), DATA_DIR); // never written to disk
  const res = await fetch(`${base}/api/videos/${it.id}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 200, await res.text());
  assert.deepStrictEqual(trashStore().getAll(), {}, 'the hard-delete branch, not a trash move');
  assert.strictEqual(sourceCommentStore.size(), 0);
});

test('removeMediaState / rekeyMediaState carry the row (the choke point every path calls)', () => {
  sourceCommentStore.apply('a1', SNAP);
  sourceCommentStore.apply('b2', { ...SNAP, fetchedAt: '2026-10-01T00:00:00.000Z' }); // a stale row at the destination
  userStore.rekeyMediaState('a1', 'b2');
  assert.deepStrictEqual(sourceCommentStore.get('b2'), SNAP, 'the moved snapshot replaces the stale destination row');
  assert.strictEqual(sourceCommentStore.get('a1'), null);
  userStore.removeMediaState(['b2']);
  assert.strictEqual(sourceCommentStore.size(), 0);
});

test('restore: a malformed sourceComments is a 400 before the wipe; the live snapshot survives', async () => {
  const it = seedOne(path.join(DATA_DIR, 'sc-keep.mp4'), DATA_DIR);
  const bundle = await (await fetch(`${base}/api/admin/backup`)).json();
  assert.deepStrictEqual(bundle.sourceComments, { [it.id]: SNAP }, 'precondition: the bundle carries it');
  for (const bad of [
    [],
    { [it.id]: { state: 'ok', fetchedAt: '2026-10-20T00:00:00.000Z', comments: [] } }, // an empty 'ok' is not a snapshot (R9)
    { [it.id]: { state: 'weird', fetchedAt: '2026-10-20T00:00:00.000Z', comments: SNAP.comments } },
    { [it.id]: { state: 'ok', fetchedAt: 'not a date', comments: SNAP.comments } },
    { ['x\u0000y']: SNAP },
  ]) {
    const res = await fetch(`${base}/api/admin/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...bundle, sourceComments: bad }) });
    assert.strictEqual(res.status, 400, JSON.stringify(bad).slice(0, 80));
    assert.deepStrictEqual(sourceCommentStore.get(it.id), SNAP, 'untouched by the refused restore');
  }
});

test('restore: a bundle WITHOUT sourceComments keeps the snapshots of videos it still has, and drops the rest', async () => {
  const it = seedOne(path.join(DATA_DIR, 'sc-old.mp4'), DATA_DIR);
  const bundle = await (await fetch(`${base}/api/admin/backup`)).json();
  delete bundle.sourceComments; // a pre-v1.394.0 export
  sourceCommentStore.apply('not-in-bundle', SNAP);
  const res = await fetch(`${base}/api/admin/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) });
  assert.strictEqual(res.status, 200, await res.text());
  assert.deepStrictEqual(sourceCommentStore.get(it.id), SNAP, 'a video in the bundle keeps its snapshot');
  assert.strictEqual(sourceCommentStore.get('not-in-bundle'), null, 'no orphan for a video the restore does not have');
});

test('the writer refuses a NUL-bearing id and an empty id', () => {
  assert.throws(() => sourceCommentStore.apply('abc\u0000def', SNAP), /U\+0000/);
  assert.throws(() => sourceCommentStore.apply('', SNAP), /non-empty/);
  assert.strictEqual(sourceCommentStore.size(), 0);
});

async function trashedWithBundle() {
  const fp = path.join(DATA_DIR, 'sc-trashed.mp4');
  fs.writeFileSync(fp, 'bytes');
  const it = seedOne(fp, DATA_DIR);
  assert.strictEqual((await fetch(`${base}/api/videos/${it.id}`, { method: 'DELETE' })).status, 200);
  const tid = Object.keys(trashStore().getAll())[0];
  assert.deepStrictEqual(sourceCommentStore.get(tid), SNAP, 'precondition: the trashed video\'s snapshot is under its trashId');
  return { tid, bundle: await (await fetch(`${base}/api/admin/backup`)).json() };
}
const restore = (bundle) => fetch(`${base}/api/admin/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) });

test('gate r1 (adversary S4 + qa S4): a bundle WITH sourceComments imports only ids the restore has - the library AND the trash; orphans are dropped', async () => {
  const { tid, bundle } = await trashedWithBundle();
  const res = await restore({ ...bundle, sourceComments: { ...bundle.sourceComments, 'not-a-video': SNAP, ['__proto__']: SNAP } });
  assert.strictEqual(res.status, 200, await res.text());
  assert.deepStrictEqual(sourceCommentStore.get(tid), SNAP, 'the trashed video keeps its comments');
  assert.strictEqual(sourceCommentStore.size(), 1, 'the orphans were not imported');
});

test('gate r1: a bundle WITHOUT sourceComments keeps a trashed video\'s live snapshot (its trashId is in the restored trash)', async () => {
  const { tid, bundle } = await trashedWithBundle();
  delete bundle.sourceComments;
  const res = await restore(bundle);
  assert.strictEqual(res.status, 200, await res.text());
  assert.deepStrictEqual(sourceCommentStore.get(tid), SNAP);
});
