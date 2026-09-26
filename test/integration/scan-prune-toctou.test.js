'use strict';

// [INTEGRATION] v1.339 FOUC / TOCTOU audit, slice S3 (plan
// docs/exec-plans/active/2026-09-26-fouc-toctou-audit.md, findings T-S2 and
// T-S4, decision D3): the media scan's destructive decisions are re-validated
// against FRESH state before they act.
//
//   T-S2        an item trashed and then RESTORED while the walk runs is in the
//               Phase-1 prune candidates; the final mutator must keep it (live
//               again, file on disk) and shed NONE of its state - metadata,
//               per-user progress / like, view count, thumbnail. A genuinely
//               removed file in the SAME pass still prunes (the control).
//   T-S2 (W4)   a restore/wipe landing mid-walk abandons the merge; the
//               abandoned merge must also skip its per-user / view-count /
//               sidecar prunes (they used to run regardless of the epoch).
//   T-S4        the same-inode trash-leftover reconcile acts on a Phase-1
//               trash record; a restore committing inside its
//               destroyMediaStreams await must not have its restored file
//               unlinked (both with the restore's trash-side unlink failing
//               EBUSY, and succeeding - the latter freed the inode outright).
//
// Every interleaving is EVENT-LOOP ORDER, never timing (LESSONS 2): the walk
// is held open on a manually resolved promise at its readdir of the item's
// folder, and the restore's commit is held on its own promise and released
// from inside the scan's await.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scanprune-toctou-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, loadDatabase, updateDatabase, scanDirectories, trashItem, restoreTrashItem,
  userStore, viewCountStore, activeMediaStreams, __resetDatabaseForTests,
} = require('../../server');
const { seedState, trashStore } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
const ISO = '2026-09-26T12:00:00.000Z';
const realReaddir = fs.promises.readdir;

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
  await __resetDatabaseForTests();
});

afterEach(() => {
  fs.promises.readdir = realReaddir;
  activeMediaStreams.clear();
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const SETTINGS = { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, trashRetentionDays: 30 };

function entry(root, filePath) {
  const st = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  return {
    id: getMediaId(filePath), name: path.basename(filePath), title: path.basename(filePath, '.mp4'), filePath,
    folderName: 'Chan', rootFolder: root, size: st ? st.size : 10, mtime: st ? st.mtime.toISOString() : ISO,
    ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 60,
  };
}

// A library: `clip.mp4` (the raced item), `keep.mp4` (a bystander, so the
// folder is never "vanished"), and `gone.mp4` (metadata ONLY: its file is
// genuinely gone - the normal prune the fix must keep working).
function seedLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scanprune-lib-'));
  const chan = path.join(root, 'Chan');
  fs.mkdirSync(chan, { recursive: true });
  const clip = path.join(chan, 'clip.mp4');
  const keep = path.join(chan, 'keep.mp4');
  const gone = path.join(chan, 'gone.mp4');
  fs.writeFileSync(clip, 'clip-bytes');
  fs.writeFileSync(keep, 'keep-bytes');
  const metadata = {};
  for (const fp of [clip, keep, gone]) metadata[getMediaId(fp)] = entry(root, fp);
  seedState({ folders: [root], folderSettings: {}, metadata, settings: SETTINGS });
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  return { root, chan, clip, keep, gone, clipId: getMediaId(clip), keepId: getMediaId(keep), goneId: getMediaId(gone) };
}

function seedUserState(id, seconds) {
  userStore.setProgress(uid, id, { timestamp: seconds, duration: 60, updatedAt: ISO });
  userStore.addLiked(uid, id, ISO);
  viewCountStore.set(id, 7);
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), `thumb-${id}`);
}

function assertStateSurvived(id, seconds, label) {
  const p = userStore.getOneProgress(uid, id);
  assert.ok(p && p.timestamp === seconds, `${label}: the per-user progress survived (got ${JSON.stringify(p)})`);
  assert.ok(userStore.getLiked(uid).includes(id), `${label}: the Like survived`);
  assert.equal(viewCountStore.get(id), 7, `${label}: the view count survived`);
  assert.ok(fs.existsSync(path.join(THUMBNAIL_DIR, `${id}.jpg`)), `${label}: the thumbnail survived`);
}

const trashDeps = () => ({ loadDatabase, updateDatabase, getMediaId });

// Hold the walk at its readdir of `dir`. `onHold(realListing)` runs while the
// scan is parked: `mode: 'before'` hands it nothing and lists AFTER it
// returns; `mode: 'twoStage'` runs `beforeList`, lists, then `afterList`,
// and hands the scan that (by then stale) listing.
function holdReaddir(dir, { beforeList, afterList }) {
  let armed = true;
  const done = deferred();
  fs.promises.readdir = async function heldReaddir(p, opts) {
    if (armed && p === dir) {
      armed = false;
      try {
        if (beforeList) await beforeList();
        const listing = await realReaddir.call(fs.promises, p, opts);
        if (afterList) await afterList();
        return listing;
      } finally {
        done.resolve();
      }
    }
    return realReaddir.call(fs.promises, p, opts);
  };
  return done.promise;
}

test('T-S2: an item trashed then RESTORED while the walk runs keeps its metadata, per-user state, view count and thumbnail; a genuinely gone file in the same pass still prunes', async () => {
  const lib = seedLibrary();
  seedUserState(lib.clipId, 44);
  seedUserState(lib.goneId, 12);

  let trashId = null;
  const held = holdReaddir(lib.chan, {
    // The scan's Phase-1 snapshot (taken before the walk) holds clip live.
    // Trash it BEFORE the walk lists the folder, so the walk never sees it ...
    beforeList: async () => {
      const tr = await trashItem(trashDeps(), lib.clipId);
      assert.equal(tr.ok, true, 'precondition: the trash landed mid-walk');
      trashId = tr.trashId;
      assert.equal(fs.existsSync(lib.clip), false, 'precondition: the file left the library folder');
    },
    // ... and restore it AFTER the listing, before the final merge.
    afterList: async () => {
      const res = await restoreTrashItem(trashDeps(), trashId);
      assert.equal(res.ok, true, 'precondition: the restore landed mid-walk');
      assert.ok(fs.existsSync(lib.clip), 'precondition: the file is back');
      assert.ok(loadDatabase().metadata[lib.clipId], 'precondition: the restore re-created the metadata entry');
      assert.equal(userStore.getOneProgress(uid, lib.clipId).timestamp, 44, 'precondition: the restore re-keyed the progress home');
    },
  });

  await scanDirectories();
  await held;

  const db = loadDatabase();
  assert.ok(db.metadata[lib.clipId], 'THE finding: the restored item is still in the library after the scan');
  assert.equal(db.metadata[lib.clipId].filePath, lib.clip);
  assert.equal(fs.readFileSync(lib.clip, 'utf8'), 'clip-bytes', 'the restored file is untouched');
  assertStateSurvived(lib.clipId, 44, 'restored item');

  // The control: the genuinely gone file pruned in the very same pass.
  assert.equal(db.metadata[lib.goneId], undefined, 'control: a genuinely removed file still prunes');
  assert.equal(userStore.getOneProgress(uid, lib.goneId), null, 'control: its per-user progress pruned');
  assert.ok(!userStore.getLiked(uid).includes(lib.goneId), 'control: its Like pruned');
  assert.equal(viewCountStore.get(lib.goneId), 0, 'control: its view count pruned');
  assert.equal(fs.existsSync(path.join(THUMBNAIL_DIR, `${lib.goneId}.jpg`)), false, 'control: its thumbnail pruned');
  assert.ok(db.metadata[lib.keepId], 'the bystander stays');
});

test('T-S2 (W4 path): a restore landing mid-walk abandons the merge AND every prune - the restored per-user state, view count and thumbnail survive', async () => {
  const lib = seedLibrary();
  seedUserState(lib.goneId, 12);

  const held = holdReaddir(lib.chan, {
    // The walk lists the folder (gone.mp4 absent), THEN a restore replaces
    // the persisted state - here with the gone item back and its file put
    // back on disk, its per-user state restored with it.
    afterList: async () => {
      await __resetDatabaseForTests(); // the wipe-and-replace: bumps the epoch
      fs.writeFileSync(lib.gone, 'gone-bytes-restored');
      const metadata = {};
      for (const fp of [lib.clip, lib.keep, lib.gone]) metadata[getMediaId(fp)] = entry(lib.root, fp);
      seedState({ folders: [lib.root], folderSettings: {}, metadata, settings: SETTINGS });
      seedUserState(lib.goneId, 12);
    },
  });

  await scanDirectories();
  await held;

  assert.ok(loadDatabase().metadata[lib.goneId], 'precondition: the abandoned merge did not touch the restored library');
  assertStateSurvived(lib.goneId, 12, 'THE finding: the abandoned merge pruned nothing');
});

// T-S4: drive the restore to the point where its link exists and its commit is
// PENDING, start the scan (the walk sees the linked file, the post-walk trash
// snapshot still holds the record), and release the restore's commit from
// INSIDE the scan's destroyMediaStreams await (a stand-in stream registered on
// the path, whose destroy() releases the commit and whose close fires once
// the restore has returned).
async function raceRestoreIntoReconcile({ trashUnlinkFails }) {
  const lib = seedLibrary();
  seedUserState(lib.clipId, 44);
  const tr = await trashItem(trashDeps(), lib.clipId);
  assert.equal(tr.ok, true);
  assert.equal(fs.existsSync(lib.clip), false, 'precondition: trashed');

  const commitGate = deferred();
  const linked = deferred();
  let call = 0;
  const heldUpdate = async (mutator) => {
    call += 1;
    if (call === 2) { // restore's main mutator: the link already exists
      linked.resolve();
      await commitGate.promise;
    }
    return updateDatabase(mutator);
  };
  const restoreFs = trashUnlinkFails
    ? {
      ...fs,
      unlinkSync(p) {
        if (p === tr.trashPath) {
          const err = new Error(`EBUSY: resource busy or locked, unlink '${p}'`);
          err.code = 'EBUSY';
          throw err;
        }
        return fs.unlinkSync(p);
      },
    }
    : fs;
  const restoreP = restoreTrashItem({ loadDatabase, updateDatabase: heldUpdate, getMediaId, fs: restoreFs }, tr.trashId);
  await linked.promise;
  assert.equal(fs.statSync(lib.clip).ino, fs.statSync(tr.trashPath).ino, 'precondition: the half-restored same-inode shape');
  assert.ok(trashStore().get(tr.trashId), 'precondition: the record is still present (commit pending)');

  let destroyedBy = 0;
  const stand = new EventEmitter();
  stand.closed = false;
  stand.destroyed = false;
  stand.destroy = () => {
    destroyedBy += 1;
    commitGate.resolve();
    restoreP.then(() => { stand.closed = true; stand.emit('close'); });
  };
  activeMediaStreams.set(lib.clip, new Set([stand]));

  await scanDirectories();
  const res = await restoreP;

  assert.equal(destroyedBy, 1, 'precondition: the scan reached the reconcile branch and awaited destroyMediaStreams');
  assert.equal(res.ok, true, 'precondition: the restore committed');
  assert.equal(trashStore().get(tr.trashId), undefined, 'precondition: the record retired with the restore');
  return { lib, tr };
}

test('T-S4: a restore committing inside the reconcile\'s await (trash-side unlink FAILS, EBUSY) - the restored file is NOT unlinked', async () => {
  const { lib, tr } = await raceRestoreIntoReconcile({ trashUnlinkFails: true });
  assert.ok(fs.existsSync(lib.clip), 'THE finding: the restored file is still in the library');
  assert.equal(fs.readFileSync(lib.clip, 'utf8'), 'clip-bytes');
  assert.ok(fs.existsSync(tr.trashPath), 'precondition: the trash-side link survived its failed unlink');
  const db = loadDatabase();
  assert.ok(db.metadata[lib.clipId], 'the restored item is still indexed after the scan');
  assert.equal(db.metadata[lib.clipId].filePath, lib.clip);
  assertStateSurvived(lib.clipId, 44, 'restored item');
});

test('T-S4: a restore committing inside the reconcile\'s await (trash-side unlink SUCCEEDS) - the inode is NOT freed', async () => {
  const { lib, tr } = await raceRestoreIntoReconcile({ trashUnlinkFails: false });
  assert.equal(fs.existsSync(tr.trashPath), false, 'precondition: the restore removed the trash-side link');
  assert.ok(fs.existsSync(lib.clip), 'THE finding: the only remaining link (the restored file) survives');
  assert.equal(fs.readFileSync(lib.clip, 'utf8'), 'clip-bytes');
  assert.ok(loadDatabase().metadata[lib.clipId], 'the restored item is still indexed after the scan');
  assertStateSurvived(lib.clipId, 44, 'restored item');
});

test('T-S4 control: a genuine crash leftover (live record, same inode, no live item) is still reconciled away', async () => {
  const lib = seedLibrary();
  const tr = await trashItem(trashDeps(), lib.clipId);
  assert.equal(tr.ok, true);
  fs.linkSync(tr.trashPath, lib.clip); // death between the trash commit and the source unlink
  const stand = new EventEmitter();
  stand.closed = false;
  stand.destroyed = false;
  stand.destroy = () => { setImmediate(() => { stand.closed = true; stand.emit('close'); }); };
  activeMediaStreams.set(lib.clip, new Set([stand]));

  await scanDirectories();

  assert.equal(fs.existsSync(lib.clip), false, 'the leftover dirent was reconciled away');
  assert.ok(fs.existsSync(tr.trashPath), 'the bytes are intact in the trash');
  assert.ok(trashStore().get(tr.trashId), 'the record is untouched');
  assert.equal(loadDatabase().metadata[lib.clipId], undefined, 'no resurrection');
});
