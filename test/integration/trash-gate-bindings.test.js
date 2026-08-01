'use strict';

// [INTEGRATION] v1.65 GATE FIX ROUND -- one binding per gate finding, each
// derived from the seat's own runnable repro so the mutant that survived (or
// the repro that destroyed data) now goes red:
//   QA C1   bell phantom-prune vs trashed items (hidden, not phantom)
//   ADV C1  purge racing restore's link->mutator window (bytes must survive)
//   ADV C2  bundle-borne trash records: validation + purge/restore
//           confinement + the retention clamp
//   QA W2   trash-less bundle preserves current trash records
//   ADV W3  the sweep's confinement belt (corrupt record, in-window)
//   ADV W4  a live record's subtitles survive the orphan pass
//   ADV W5  restore retires the destination tombstone BEFORE the link
//   ADV W8+S1  crash-shaped leftover: no resurrection, no duplicate record
//   ADV W9  half-restored same-inode state completes instead of 409ing

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashgate-'));
// The QA C1 binding needs the notifications feature live (module enabled +
// >=1 subscription seeded in the test itself).
process.env.FILETUBE_YTDLP_ENABLED = 'true';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, loadDatabase, saveDatabase, updateDatabase, scanDirectories,
  trashItem, restoreTrashItem, purgeTrashItem, sweepTrash, userStore, __resetDatabaseForTests,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { TRASH_DIR_NAME } = require('../../lib/trashPaths');

const ISO = '2026-08-01T12:00:00.000Z';
const DAY = 86400000;
let server, base, uid;
let ROOT;

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

function seedLibrary(settingsOverrides) {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashgatelib-'));
  fs.mkdirSync(path.join(ROOT, 'Chan'), { recursive: true });
  const filePath = path.join(ROOT, 'Chan', 'clip.mp4');
  fs.writeFileSync(filePath, 'clip-bytes');
  const id = getMediaId(filePath);
  saveDatabase({
    folders: [ROOT],
    folderSettings: {},
    progress: {},
    metadata: {
      [id]: {
        id, name: 'clip.mp4', title: 'Clip', filePath, folderName: 'Chan',
        rootFolder: ROOT, size: 10, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 60,
      },
    },
    settings: {
      scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0,
      trashRetentionDays: 30, notificationsEnabled: true, ...settingsOverrides,
    },
  });
  return { id, filePath };
}

const deps = () => ({ loadDatabase, updateDatabase, getMediaId });

test('QA C1: opening the bell while an item sits in Trash leaves every carrier intact -- and restore re-links them', async () => {
  const { id } = seedLibrary();
  // The feature gate needs >=1 subscription (the seat's repro's own seed).
  await updateDatabase((db) => {
    db.ytdlp = db.ytdlp || {};
    db.ytdlp.subscriptions = [{ url: 'https://youtube.com/@chan', channelId: 'UCx', title: 'Chan' }];
  });
  userStore.recordNotifications([{ mediaId: id, createdAt: Date.now() }]);
  userStore.setProgress(uid, id, { timestamp: 44, duration: 60, updatedAt: ISO });
  userStore.addLiked(uid, id, ISO);
  userStore.markWatched(uid, id, ISO);
  userStore.setQueue(uid, [{ uid: 'q1', mediaId: id }], null, 1);

  const tr = await trashItem(deps(), id);
  assert.equal(tr.ok, true);

  const panel = await (await fetch(`${base}/api/notifications`)).json();
  assert.ok(!panel.items.some((r) => r.mediaId === tr.trashId), 'the trashed row is hidden from the panel');

  // THE finding: the panel-open above used to phantom-prune the trashId and
  // destroy all of these.
  assert.equal(userStore.getOneProgress(uid, tr.trashId).timestamp, 44, 'progress survived the bell-open');
  assert.deepEqual(userStore.getLiked(uid), [tr.trashId], 'the Like survived');
  assert.equal(userStore.getWatchedTimes(uid)[tr.trashId], ISO, 'the latch survived');
  assert.equal(userStore.getQueue(uid).entries[0].mediaId, tr.trashId, 'the queue row survived');

  const res = await restoreTrashItem(deps(), tr.trashId);
  assert.equal(res.ok, true);
  assert.equal(userStore.getOneProgress(uid, id).timestamp, 44, 'full fidelity held through a bell-open');
  assert.deepEqual(userStore.getQueue(uid).entries.map((e) => e.mediaId), [id]);
});

test('ADV C1: a purge landing inside restore\'s link->mutator window must NOT free the last link -- the bytes survive', async () => {
  const { id, filePath } = seedLibrary();
  const tr = await trashItem(deps(), id);
  assert.equal(tr.ok, true);

  // The seat's deterministic model of the race: restore's SECOND
  // updateDatabase call (the main mutator) is the window -- run the
  // concurrent purge right before delegating.
  let call = 0;
  const racedUpdate = async (mutator) => {
    call += 1;
    if (call === 2) {
      const purged = await purgeTrashItem({ loadDatabase, updateDatabase }, tr.trashId);
      assert.equal(purged.ok, true, 'precondition: the concurrent purge won the window');
    }
    return updateDatabase(mutator);
  };

  const res = await restoreTrashItem({ loadDatabase, updateDatabase: racedUpdate, getMediaId }, tr.trashId);
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
  // THE finding: pre-fix, both links were gone here -- the inode freed.
  assert.ok(fs.existsSync(filePath), 'the restored link is KEPT (the only remaining link to the bytes)');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'clip-bytes', 'byte-identical survival');
});

test('ADV C2: a hostile bundle trash record is REFUSED whole at validation (arbitrary-path unlink/move closed at the door)', async () => {
  const { filePath } = seedLibrary();
  const bundle = {
    schema: 'filetube-backup-v1',
    trash: {
      evil: {
        originalId: 'x', originalPath: '/tmp/anywhere/out.mp4',
        trashPath: filePath, // a LIVE library file as the unlink target
        trashedAt: 1, rootFolder: null, item: { id: 'x' },
      },
    },
  };
  const res = await fetch(`${base}/api/admin/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /trashPath/);
  assert.ok(fs.existsSync(filePath), 'the library file is untouched');

  // The settings amplifier: an out-of-set retention is a clean 400 too.
  const res2 = await fetch(`${base}/api/admin/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: 'filetube-backup-v1', settings: { trashRetentionDays: 1e-9 } }),
  });
  assert.equal(res2.status, 400);
  assert.match((await res2.json()).error, /trashRetentionDays/);
});

test('ADV C2 (defense in depth): a corrupt record ALREADY in db.trash -- purge retires it without touching the file; restore refuses it; the sweep clamp ignores a smuggled retention', async () => {
  const { id, filePath } = seedLibrary();
  // A corrupt record pointing at the live library file, planted directly
  // (modeling a pre-fix bundle or db corruption -- past the validator).
  // Gate round 2 (adversarial C1 of the delta): HERMETIC out-of-tree
  // targets -- a fixed shared-/tmp path made the release suite
  // non-deterministic and faked ten kill verdicts inside the gate itself.
  const OUT1 = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-trashgate-out-'));
  await updateDatabase((db) => {
    db.trash.evil = {
      originalId: 'x', originalPath: path.join(OUT1, 'planted.mp4'),
      trashPath: filePath, trashedAt: Date.now() - 100 * DAY, rootFolder: null, item: { id: 'x', title: 'evil' },
    };
    db.settings.trashRetentionDays = 1e-9; // the smuggled amplifier
  });

  // The retention clamp: 1e-9 is not in the allowed set -> treated as the
  // 30-day default, so the sweep runs -- and the record pass hits the
  // corrupt record, whose purge must NOT unlink the library file.
  await sweepTrash(Date.now());
  assert.ok(fs.existsSync(filePath), 'the live library file survives the sweep');
  assert.equal(loadDatabase().trash.evil, undefined, 'the corrupt record was retired harmlessly');
  assert.ok(loadDatabase().metadata[id], 'the library entry is untouched');

  // Restore of a same-shaped corrupt record refuses cleanly.
  const OUT2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-trashgate-out-'));
  await updateDatabase((db) => {
    db.trash.evil2 = {
      originalId: 'y', originalPath: path.join(OUT2, 'deep', 'planted2.mp4'),
      trashPath: filePath, trashedAt: Date.now(), rootFolder: null, item: { id: 'y' },
    };
  });
  const res = await restoreTrashItem(deps(), 'evil2');
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.ok(!fs.existsSync(path.join(OUT2, 'deep', 'planted2.mp4')), 'no arbitrary-path write happened');
});

test('QA W2: restoring a trash-less (pre-v1.65) bundle PRESERVES the current trash records', async () => {
  const { id } = seedLibrary();
  const tr = await trashItem(deps(), id);
  assert.equal(tr.ok, true);

  const bundle = {
    schema: 'filetube-backup-v1',
    folders: [ROOT], folderSettings: {}, progress: {}, metadata: {}, liked: [],
    settings: { trashRetentionDays: 30 },
  };
  const res = await fetch(`${base}/api/admin/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle),
  });
  assert.equal(res.status, 200);
  const db = loadDatabase();
  assert.ok(db.trash[tr.trashId], 'the trash record survived a bundle that never knew about trash');
  assert.ok(fs.existsSync(tr.trashPath), 'and its bytes remain restorable');
});

test('ADV W3: the sweep confinement belt -- a corrupt IN-WINDOW record aiming the orphan pass at a library folder must not eat bystanders', async () => {
  const { id, filePath } = seedLibrary();
  // The record is INSIDE its retention window (the seat's own correction:
  // an expired record is purged by the record pass and never exercises the
  // belt), and its trashPath dirname is a REAL library folder.
  await updateDatabase((db) => {
    db.trash.corrupt = {
      originalId: 'z', originalPath: filePath,
      trashPath: path.join(ROOT, 'Chan', 'not-really-trash.mp4'),
      trashedAt: Date.now() - 1 * DAY, rootFolder: ROOT, item: { id: 'z' },
    };
  });
  // A bystander in that folder, unreferenced and "old" (ctime is fresh, so
  // push `now` far out -- but keep the corrupt record in-window there too).
  await updateDatabase((db) => { db.trash.corrupt.trashedAt = Date.now() + 39 * DAY; });
  const future = Date.now() + 40 * DAY;

  await sweepTrash(future);
  assert.ok(fs.existsSync(filePath), 'the belt held: no file in a non-trash-named directory was touched');
  assert.ok(loadDatabase().metadata[id], 'the library entry is untouched');
});

test('ADV W4: a live record\'s trash-side SUBTITLES survive the orphan pass even when the record pass skips the record', async () => {
  const { id, filePath } = seedLibrary();
  const base_ = path.basename(filePath, '.mp4');
  fs.writeFileSync(path.join(ROOT, 'Chan', `${base_}.en.vtt`), 'the-only-copy');
  const tr = await trashItem(deps(), id);
  assert.equal(tr.ok, true);
  const trashBase = path.basename(tr.trashPath, '.mp4');
  const carriedSub = path.join(ROOT, TRASH_DIR_NAME, `${trashBase}.en.vtt`);
  assert.ok(fs.existsSync(carriedSub), 'precondition: the subtitle rode into trash');

  // Make the record un-purgeable by the record pass (future trashedAt --
  // clock skew / crafted), then sweep far in the future so ctime ages out.
  await updateDatabase((db) => { db.trash[tr.trashId].trashedAt = Date.now() + 400 * DAY; });
  await sweepTrash(Date.now() + 100 * DAY);

  assert.ok(fs.existsSync(tr.trashPath), 'the referenced media survives');
  assert.ok(fs.existsSync(carriedSub), 'THE finding: its subtitle (bytes exist nowhere else) survives too');
});

test('ADV W5: the destination tombstone is retired in its OWN commit BEFORE the restore link (observed at linkSync time)', async () => {
  const { id, filePath } = seedLibrary();
  const tr = await trashItem(deps(), id);
  assert.equal(tr.ok, true);
  await updateDatabase((db) => {
    db.deleteTombstones[id] = { filePath, deletedAt: Date.now() + 1000, youtubeId: null };
  });

  // The seat's binding: observe the COMMITTED tombstone state at the exact
  // moment the link is written -- the crash-window ordering the code claims.
  let tombstoneAtLinkTime = 'never-linked';
  const probeFs = new Proxy(fs, {
    get(target, prop) {
      if (prop === 'linkSync') {
        return (src, dst) => {
          tombstoneAtLinkTime = Object.prototype.hasOwnProperty.call(loadDatabase().deleteTombstones, id)
            ? 'STILL-PRESENT' : 'already-retired';
          return target.linkSync(src, dst);
        };
      }
      return target[prop];
    },
  });
  const res = await restoreTrashItem({ loadDatabase, updateDatabase, getMediaId, fs: probeFs }, tr.trashId);
  assert.equal(res.ok, true);
  assert.equal(tombstoneAtLinkTime, 'already-retired', 'mutator A committed before the filesystem was touched');
});

test('ADV W8 + S1 (tombstone shape): a failed source unlink (record + MINTED tombstone + dirent) reconciles on the next scan -- no resurrection, no duplicate record', async () => {
  const { id, filePath } = seedLibrary();
  // Model a source-unlink FAILURE (EIO): the record commits and the failure
  // path mints the deferred-retry tombstone. (The no-tombstone pure-crash
  // shape has its own test below -- the reconcile alone must cover it.)
  const dyingFs = new Proxy(fs, {
    get(target, prop) {
      if (prop === 'unlinkSync') {
        return (p) => {
          if (p === filePath) { const e = new Error('EIO: crash-shaped'); e.code = 'EIO'; throw e; }
          return target.unlinkSync(p);
        };
      }
      return target[prop];
    },
  });
  const tr = await trashItem({ loadDatabase, updateDatabase, getMediaId, fs: dyingFs }, id);
  assert.equal(tr.ok, true);
  assert.ok(fs.existsSync(filePath), 'precondition: the leftover dirent survives');
  assert.ok(loadDatabase().deleteTombstones[id], 'precondition: the failure path minted the tombstone');

  await scanDirectories();

  const db = loadDatabase();
  assert.equal(db.metadata[id], undefined, 'THE finding: the deleted item did not resurrect');
  assert.ok(!fs.existsSync(filePath), 'the leftover dirent was reconciled away');
  assert.equal(Object.keys(db.trash).length, 1, 'and NO duplicate trash record was minted (S1)');
  assert.ok(fs.existsSync(tr.trashPath), 'the real bytes sit exactly once, in trash');
  assert.equal(db.deleteTombstones[id], undefined, 'the tombstone was consumed');
});

test('ADV W8 contract: purge after the reconcile is genuinely verified destruction', async () => {
  const { id, filePath } = seedLibrary();
  const dyingFs = new Proxy(fs, {
    get(target, prop) {
      if (prop === 'unlinkSync') {
        return (p) => {
          if (p === filePath) { const e = new Error('EIO'); e.code = 'EIO'; throw e; }
          return target.unlinkSync(p);
        };
      }
      return target[prop];
    },
  });
  const tr = await trashItem({ loadDatabase, updateDatabase, getMediaId, fs: dyingFs }, id);
  await scanDirectories(); // reconcile the leftover
  const res = await purgeTrashItem({ loadDatabase, updateDatabase }, tr.trashId);
  assert.equal(res.ok, true);
  assert.ok(!fs.existsSync(tr.trashPath) && !fs.existsSync(filePath), 'no copy of the bytes survives a reported purge');
});

test('ADV W9: the half-restored same-inode state COMPLETES the restore instead of 409ing (carriers un-strand)', async () => {
  const { id, filePath } = seedLibrary();
  userStore.setProgress(uid, id, { timestamp: 44, duration: 60, updatedAt: ISO });
  const tr = await trashItem(deps(), id);
  assert.equal(tr.ok, true);

  // Model the crash between a restore's link and its mutator: the link
  // exists at originalPath (same inode as trashPath), record still present.
  fs.linkSync(tr.trashPath, filePath);

  const res = await restoreTrashItem(deps(), tr.trashId);
  assert.equal(res.ok, true, 'THE finding: this used to be a permanent 409');
  assert.equal(res.restoredId, id);
  const db = loadDatabase();
  assert.ok(db.metadata[id], 'metadata restored');
  assert.deepEqual(db.trash, {}, 'record retired');
  assert.equal(userStore.getOneProgress(uid, id).timestamp, 44, 'the stranded carriers re-linked home');
  assert.ok(fs.existsSync(filePath) && !fs.existsSync(tr.trashPath), 'exactly one link remains, at the library path');
});

// ---- Gate round 2: the delta seats' surviving mutants, each bound ----------

test('R2 BIND-v (the TRUE crash shape): record + same-inode leftover, NO tombstone -- the scan reconcile alone must prevent resurrection', async () => {
  const { id, filePath } = seedLibrary();
  const tr = await trashItem(deps(), id);
  assert.equal(tr.ok, true);
  assert.deepEqual(loadDatabase().deleteTombstones, {}, 'precondition: a clean trash mints NO tombstone');
  // The crash: re-create the leftover dirent as a hard link of the trash
  // copy (exactly what death between commit and unlink leaves behind).
  fs.linkSync(tr.trashPath, filePath);

  await scanDirectories();

  const db = loadDatabase();
  assert.equal(db.metadata[id], undefined, 'THE binding: no tombstone, and the item still must not resurrect');
  assert.ok(!fs.existsSync(filePath), 'the leftover was reconciled away');
  assert.equal(Object.keys(db.trash).length, 1, 'single record');
  assert.ok(fs.existsSync(tr.trashPath), 'bytes intact in trash');
});

test('R2 reconcile inode guard: NEW content at a record-covered path (no tombstone) indexes honestly, never blind-unlinked', async () => {
  const { id, filePath } = seedLibrary();
  const tr = await trashItem(deps(), id);
  assert.equal(tr.ok, true);
  fs.writeFileSync(filePath, 'BRAND-NEW-USER-CONTENT'); // different inode

  await scanDirectories();

  assert.ok(fs.existsSync(filePath), 'the new content survives');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'BRAND-NEW-USER-CONTENT');
  assert.ok(loadDatabase().metadata[id], 'and is indexed as the new content it is');
  assert.ok(loadDatabase().trash[tr.trashId], 'the old record is untouched');
});

test('R2 BIND-cc: DIFFERENT-inode content at a TOMBSTONED record-covered path is orphan-trashed (recoverable), never blind-unlinked', async () => {
  const { id, filePath } = seedLibrary();
  const tr = await trashItem(deps(), id);
  assert.equal(tr.ok, true);
  // New content lands at the old path, and a tombstone targets it (the
  // removeAnyway-of-a-successor distillation) with a covering record live.
  fs.writeFileSync(filePath, 'NEW-CONTENT-THE-RETRY-MUST-NOT-DESTROY');
  const past = new Date(Date.now() - 30 * DAY);
  fs.utimesSync(filePath, past, past); // mtime <= deletedAt so the retry fires
  await updateDatabase((db) => {
    db.deleteTombstones[id] = { filePath, deletedAt: Date.now(), youtubeId: null };
  });

  await scanDirectories();

  assert.ok(!fs.existsSync(filePath), 'the retry consumed the tombstoned path');
  const recs = Object.values(loadDatabase().trash);
  assert.equal(recs.length, 2, 'the new content became its own trash record');
  const orphanRec = recs.find((r) => r.trashPath !== tr.trashPath);
  assert.equal(fs.readFileSync(orphanRec.trashPath, 'utf8'), 'NEW-CONTENT-THE-RETRY-MUST-NOT-DESTROY', 'RECOVERABLE, never blind-unlinked');
});

test('R2 BIND-s: a smuggled out-of-set retention cannot rapid-purge LEGITIMATE records (the sweep clamp)', async () => {
  const { id } = seedLibrary();
  const tr = await trashItem(deps(), id, { nowMs: Date.now() - 5 * DAY }); // fresh under the 30d default
  await updateDatabase((db) => { db.settings.trashRetentionDays = 1e-9; }); // past the POST validator

  const purged = await sweepTrash(Date.now());
  assert.equal(purged, 0, 'THE binding: the clamp treats 1e-9 as the default, not as microseconds');
  assert.ok(loadDatabase().trash[tr.trashId], 'the legitimate record survives');
  assert.ok(fs.existsSync(tr.trashPath), 'its bytes survive');
});

test('R2 BIND-z: GET /thumbnail/<trashId> serves the re-keyed sidecar (and a title-less record is a placeholder, never a 500)', async () => {
  const { id } = seedLibrary();
  fs.writeFileSync(path.join(process.env.DATA_DIR, '.thumbnails', `${id}.jpg`), 'jpeg-bytes');
  await updateDatabase((db) => { db.metadata[id].hasThumbnail = true; });
  const tr = await trashItem(deps(), id);
  assert.equal(tr.ok, true);

  const res = await fetch(`${base}/thumbnail/${tr.trashId}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /image\/jpeg/, 'THE binding: the trash fallback serves the real sidecar');

  // The W5 regression: a snapshot with no title must fall to the SVG
  // placeholder, never a 500.
  await updateDatabase((db) => { delete db.trash[tr.trashId].item.title; });
  const res2 = await fetch(`${base}/thumbnail/${tr.trashId}`);
  assert.notEqual(res2.status, 500, 'a title-less record must not crash the route');
});

test('R2 (S-C): restore rollback on a mutator THROW unlinks the fresh link only when the trash side survives', async () => {
  const { id, filePath } = seedLibrary();
  const tr = await trashItem(deps(), id);
  assert.equal(tr.ok, true);

  let call = 0;
  const throwingUpdate = async (mutator) => {
    call += 1;
    if (call === 2) throw new Error('boom'); // the main mutator
    return updateDatabase(mutator);
  };
  const res = await restoreTrashItem({ loadDatabase, updateDatabase: throwingUpdate, getMediaId }, tr.trashId);
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
  assert.ok(!fs.existsSync(filePath), 'the fresh link was rolled back (trash side survives, so this is safe)');
  assert.ok(fs.existsSync(tr.trashPath), 'the trash copy is untouched');
  assert.ok(loadDatabase().trash[tr.trashId], 'the record is intact for a retry');
});

test('R2 (W4): a record whose trash dir sits OUTSIDE every configured root is restore-refused (the escape clause is closed)', async () => {
  seedLibrary();
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-trashgate-out-'));
  fs.mkdirSync(path.join(OUT, TRASH_DIR_NAME), { recursive: true });
  const plantedTrash = path.join(OUT, TRASH_DIR_NAME, 'planted.mp4');
  fs.writeFileSync(plantedTrash, 'planted-bytes');
  await updateDatabase((db) => {
    db.trash.outside = {
      originalId: 'o', originalPath: path.join(OUT, 'deep', 'written-outside.mp4'),
      trashPath: plantedTrash, trashedAt: Date.now(), rootFolder: null, item: { id: 'o' },
    };
  });

  const res = await restoreTrashItem(deps(), 'outside');
  assert.equal(res.ok, false);
  assert.equal(res.status, 400, 'a .filetube-trash parent outside every root is no longer a legal destination authority');
  assert.ok(!fs.existsSync(path.join(OUT, 'deep', 'written-outside.mp4')), 'nothing was written');
});
