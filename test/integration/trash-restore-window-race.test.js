'use strict';

// [INTEGRATION] v1.339 T-S5 (docs/exec-plans/active/2026-09-26-fouc-toctou-audit.md,
// decision D3) -- trashItem's post-commit window vs a restore of the SAME
// trashId, against the REAL app, the REAL routes and REAL files on disk.
//
// The race: trashItem commits the media_trash row (the library entry is gone),
// then awaits destroyMediaStreams(oldPath) -- up to ~3s with a live stream --
// and only THEN unlinks the source path P. P and trashPath are the same inode
// in that window, so a restore arriving there took the W9 crash-heal branch
// (`alreadyLinked`: skip the link), committed the metadata back and unlinked
// trashPath. trashItem then resumed and unlinked P: BOTH links gone while the
// metadata said the item was live.
//
// The window is held open deterministically (LESSONS 2: event-loop order, not
// timing): the DELETE route calls destroyMediaStreams(filePath) BEFORE
// trashItem, then trashItem calls it again after its commit. A first fake
// stream closes at once on the route's pass and, as it closes, registers a
// SECOND fake stream on the same path; the route's pass snapshotted its set
// already, so only trashItem's post-commit pass sees the second stream, and
// that stream's destroy() is the "window reached" signal. It never closes
// until the test emits 'close' by hand.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashwin-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, loadDatabase, userStore, __resetDatabaseForTests,
  registerMediaStream, activeMediaStreams,
} = require('../../server');
const { seedState, trashStore } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { TRASH_DIR_NAME } = require('../../lib/trashPaths');

const ISO = '2026-08-01T12:00:00.000Z';
let server, base, uid;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  uid = authenticateFetch(server, base).user.id;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  activeMediaStreams.clear();
  await __resetDatabaseForTests();
});

function seedLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashwinlib-'));
  fs.mkdirSync(path.join(root, 'Chan'), { recursive: true });
  const filePath = path.join(root, 'Chan', 'movie.mp4');
  fs.writeFileSync(filePath, 'movie-bytes');
  const id = getMediaId(filePath);
  seedState({
    folders: [root],
    folderSettings: {},
    metadata: {
      [id]: {
        id, name: 'movie.mp4', title: 'The Movie', filePath, folderName: 'Chan',
        rootFolder: root, size: 11, ext: '.mp4', type: 'video', addedAt: 1700000000000, duration: 90,
      },
    },
    settings: { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0 },
  });
  userStore.setProgress(uid, id, { timestamp: 44, duration: 90, updatedAt: ISO });
  userStore.addLiked(uid, id, ISO);
  userStore.markWatched(uid, id, ISO);
  userStore.setQueue(uid, [{ uid: 'q1', mediaId: id }], null, 1);
  return { root, id, filePath };
}

// Registers the two-stage fake stream on `filePath` and returns the handle
// the test drives: `windowReached` resolves when trashItem's post-commit
// destroyMediaStreams call reaches the held stream; `release()` closes it.
function holdPostCommitWindow(filePath) {
  let signalWindow;
  const windowReached = new Promise((resolve) => { signalWindow = resolve; });
  const held = new EventEmitter();
  held.closed = false;
  held.destroyed = false;
  held.destroyCalls = 0;
  held.destroy = () => {
    held.destroyCalls++;
    held.destroyed = true;
    signalWindow(); // never emits 'close' by itself
  };
  const first = new EventEmitter();
  first.closed = false;
  first.destroyed = false;
  first.destroy = () => {
    first.destroyed = true;
    registerMediaStream(filePath, held); // only the NEXT destroyMediaStreams pass sees it
    setImmediate(() => { first.closed = true; first.emit('close'); });
  };
  registerMediaStream(filePath, first);
  return {
    windowReached,
    held,
    release() { held.closed = true; held.emit('close'); },
  };
}

const delVideo = (id) => fetch(`${base}/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
const restore = (tid) => fetch(`${base}/api/trash/${encodeURIComponent(tid)}/restore`, { method: 'POST' });

function onlyTrashId() {
  const ids = Object.keys(trashStore().getAll());
  assert.equal(ids.length, 1, 'exactly one trash record exists');
  return ids[0];
}

function assertPerUserStateHome(id) {
  assert.equal(userStore.getOneProgress(uid, id).timestamp, 44, 'resume point re-linked');
  assert.deepEqual(userStore.getLiked(uid), [id], 'the Like re-linked');
  assert.equal(userStore.getWatchedTimes(uid)[id], ISO, 'the watched latch re-linked');
  assert.deepEqual(userStore.getQueue(uid).entries.map((e) => e.mediaId), [id], 'the queue entry re-linked');
}

test('T-S5: a restore inside trashItem\'s post-commit window never leaves live metadata with no file (both links survive the race)', async () => {
  const { id, filePath } = seedLibrary();
  const hold = holdPostCommitWindow(filePath);

  const delPending = delVideo(id);
  await hold.windowReached;
  // Inside the window: committed (record present, library entry gone), and
  // P + trashPath are ONE inode -- the exact shape the W9 heal keys on.
  const tid = onlyTrashId();
  const trashPath = trashStore().get(tid).trashPath;
  assert.equal(loadDatabase().metadata[id], undefined, 'precondition: the trash commit landed');
  assert.ok(fs.existsSync(filePath), 'precondition: the source path is not unlinked yet');
  assert.equal(fs.statSync(filePath).ino, fs.statSync(trashPath).ino, 'precondition: same inode (alreadyLinked shape)');

  const inWindow = await restore(tid);
  const inWindowBody = await inWindow.json();

  hold.release();
  const delRes = await delPending;
  assert.equal(delRes.status, 200);
  assert.equal(hold.held.destroyCalls, 1, 'the held stream was reached exactly once (trashItem\'s pass)');

  // The data-loss invariant, whichever way the restore went: metadata live
  // => the bytes are at P; record present => the bytes are at trashPath.
  const live = loadDatabase().metadata[id];
  const rec = trashStore().get(tid);
  if (live) assert.ok(fs.existsSync(filePath), 'metadata is live, so the file MUST exist at P');
  if (rec) assert.ok(fs.existsSync(rec.trashPath), 'the record is present, so the trashed bytes MUST exist');
  assert.ok(live || rec, 'the item is either live or in the trash, never neither');

  // The fix's contract: the in-window restore is refused honestly, and the
  // trash then completes cleanly.
  assert.equal(inWindow.status, 409, `in-window restore refused (got ${inWindow.status} ${JSON.stringify(inWindowBody)})`);
  assert.match(inWindowBody.error, /still being moved to the trash/i);
  assert.equal(live, undefined, 'the refused restore changed nothing');
  assert.ok(rec, 'the trash record is kept');
  assert.equal(fs.existsSync(filePath), false, 'the trash finished: the source path is unlinked');
  assert.equal(fs.readFileSync(trashPath, 'utf8'), 'movie-bytes', 'the bytes are safe in the trash');

  // Retrying once the trash finished restores everything.
  const retry = await restore(tid);
  assert.equal(retry.status, 200);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'movie-bytes', 'the file is back at P with its bytes');
  assert.equal(loadDatabase().metadata[id].title, 'The Movie', 'metadata is live');
  assert.equal(trashStore().get(tid), undefined, 'the record retired');
  assert.equal(fs.existsSync(trashPath), false, 'the trash-side link retired');
  assertPerUserStateHome(id);
});

test('T-S5 control: a trash with a held stream and NO concurrent restore still unlinks P, and a restore afterwards works (the in-flight mark clears)', async () => {
  const { root, id, filePath } = seedLibrary();
  const hold = holdPostCommitWindow(filePath);

  const delPending = delVideo(id);
  await hold.windowReached;
  const tid = onlyTrashId();
  hold.release();
  const delBody = await (await delPending).json();
  assert.equal(delBody.trashed, true);
  assert.equal(delBody.trashId, tid);
  assert.equal(fs.existsSync(filePath), false, 'the source path is unlinked');
  const trashPath = trashStore().get(tid).trashPath;
  assert.equal(path.dirname(trashPath), path.join(root, TRASH_DIR_NAME));
  assert.equal(fs.readFileSync(trashPath, 'utf8'), 'movie-bytes');

  const res = await restore(tid);
  assert.equal(res.status, 200, 'a finished trash no longer refuses its restore');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'movie-bytes');
  assert.equal(loadDatabase().metadata[id].title, 'The Movie');
  assertPerUserStateHome(id);
});

test('T-S5 control: a plain trash + restore (no streams at all) round-trips', async () => {
  const { id, filePath } = seedLibrary();
  const delBody = await (await delVideo(id)).json();
  assert.equal(delBody.trashed, true);
  assert.equal(fs.existsSync(filePath), false, 'the source path is unlinked');
  const res = await restore(delBody.trashId);
  assert.equal(res.status, 200);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'movie-bytes');
  assert.equal(loadDatabase().metadata[id].title, 'The Movie');
  assertPerUserStateHome(id);
});
