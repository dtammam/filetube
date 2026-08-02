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
  // 30-day default. Gate round 3 (S-2): the sweep now KEEPS a record it
  // cannot restore rather than reaping it in the background -- so the
  // corrupt record survives the sweep untouched, and so does the live file.
  await sweepTrash(Date.now());
  assert.ok(fs.existsSync(filePath), 'the live library file survives the sweep');
  assert.ok(loadDatabase().trash.evil, 'S-2: an unrestorable record is NEVER auto-destroyed -- it waits for an explicit purge');
  assert.ok(loadDatabase().metadata[id], 'the library entry is untouched');

  // An EXPLICIT purge retires it -- still without touching the file
  // (layer 2: purge's own confinement).
  const purged = await purgeTrashItem({ loadDatabase, updateDatabase }, 'evil');
  assert.equal(purged.ok, true);
  assert.equal(loadDatabase().trash.evil, undefined, 'the corrupt record was retired harmlessly');
  assert.ok(fs.existsSync(filePath), 'and the live library file STILL survives');

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

  // The W5 regression, bound properly (gate round 3, adversarial W4: the
  // first version left hasThumbnail+jpg in place, so the route sendFile'd
  // and NEVER reached the placeholder branch that touches title.length --
  // the assertion could not fail). Remove the sidecar so the placeholder
  // path actually runs.
  fs.unlinkSync(path.join(process.env.DATA_DIR, '.thumbnails', `${tr.trashId}.jpg`));
  await updateDatabase((db) => { delete db.trash[tr.trashId].item.title; });
  const res2 = await fetch(`${base}/thumbnail/${tr.trashId}`);
  assert.equal(res2.status, 200, 'a title-less record must not crash the route');
  assert.match(res2.headers.get('content-type') || '', /image\/svg/, 'it falls to the SVG placeholder');
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

test('R3: a record whose destination is UNRELATED to both a root and its own trash dir is refused (structural confinement)', async () => {
  seedLibrary();
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-trashgate-out-'));
  const ELSEWHERE = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-trashgate-elsewhere-'));
  fs.mkdirSync(path.join(OUT, TRASH_DIR_NAME), { recursive: true });
  const plantedTrash = path.join(OUT, TRASH_DIR_NAME, 'planted.mp4');
  fs.writeFileSync(plantedTrash, 'planted-bytes');
  await updateDatabase((db) => {
    db.trash.outside = {
      // Destination in a THIRD tree: neither a configured root nor the
      // trash dir's own parent -- no construction path produces this.
      originalId: 'o', originalPath: path.join(ELSEWHERE, 'deep', 'written-outside.mp4'),
      trashPath: plantedTrash, trashedAt: Date.now(), rootFolder: null, item: { id: 'o' },
    };
  });

  const res = await restoreTrashItem(deps(), 'outside');
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.ok(!fs.existsSync(path.join(ELSEWHERE, 'deep', 'written-outside.mp4')), 'nothing was written');
});

// ---- Gate round 3: the delta's criticals + its three unbound protections ---

test('R3 CRITICAL-1a: an UNATTRIBUTABLE item (the app\'s own dirname fallback) round-trips trash -> restore', async () => {
  // A file outside every configured root -- retained by the mount-loss /
  // pruneMissing guards, trashed into <dirname(file)>/.filetube-trash per
  // the spec's own fallback design.
  seedLibrary();
  const ODD = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-trashgate-odd-'));
  fs.mkdirSync(path.join(ODD, 'Chan'), { recursive: true });
  const oddPath = path.join(ODD, 'Chan', 'retained.mp4');
  fs.writeFileSync(oddPath, 'retained-bytes');
  const oddId = getMediaId(oddPath);
  await updateDatabase((db) => {
    db.metadata[oddId] = {
      id: oddId, name: 'retained.mp4', title: 'Retained', filePath: oddPath,
      folderName: 'Chan', rootFolder: null, size: 14, ext: '.mp4', type: 'video',
      addedAt: Date.now(), duration: 30,
    };
  });

  const tr = await trashItem(deps(), oddId);
  assert.equal(tr.ok, true);
  assert.ok(tr.trashPath.includes(path.join('Chan', TRASH_DIR_NAME)), 'the app used its dirname fallback');

  const res = await restoreTrashItem(deps(), tr.trashId);
  assert.equal(res.ok, true, 'THE finding: the app\'s OWN record must never be "malformed"');
  assert.ok(fs.existsSync(oddPath), 'the bytes came home');
  assert.equal(fs.readFileSync(oddPath, 'utf8'), 'retained-bytes');
});

test('R3 CRITICAL-1b: removing the library folder does not make a trashed item un-restorable, and the sweep will NOT destroy it', async () => {
  const { id, filePath } = seedLibrary();
  const tr = await trashItem(deps(), id, { nowMs: Date.now() - 5 * DAY });
  assert.equal(tr.ok, true);
  await updateDatabase((db) => { db.folders = []; }); // the user removes the folder

  // Still inside its window: the sweep leaves it alone regardless.
  assert.equal(await sweepTrash(Date.now()), 0);
  assert.ok(fs.existsSync(tr.trashPath), 'the bytes are still there');

  // THE finding: round 2 made this a permanent 400. The record keeps the
  // app's structural shape (the item lived under the trash dir's own
  // parent), so it restores whether or not the folder is configured today.
  const res = await restoreTrashItem(deps(), tr.trashId);
  assert.equal(res.ok, true, 'the item restores on the app\'s structural shape');
  assert.ok(fs.existsSync(filePath));
});

test('R3 CRITICAL-2: the instance can restore ITS OWN backup when a trash record is present (export -> import round trip)', async () => {
  const { id } = seedLibrary();
  const ODD = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-trashgate-odd2-'));
  fs.mkdirSync(path.join(ODD, 'Chan'), { recursive: true });
  const oddPath = path.join(ODD, 'Chan', 'unattributed.mp4');
  fs.writeFileSync(oddPath, 'odd-bytes');
  const oddId = getMediaId(oddPath);
  await updateDatabase((db) => {
    db.metadata[oddId] = {
      id: oddId, name: 'unattributed.mp4', title: 'Odd', filePath: oddPath,
      folderName: 'Chan', rootFolder: null, size: 9, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 5,
    };
  });
  await trashItem(deps(), oddId);   // the unattributable shape
  await trashItem(deps(), id);      // and an ordinary root-attributed one

  const bundle = await (await fetch(`${base}/api/admin/backup`)).json();
  assert.equal(Object.keys(bundle.trash).length, 2, 'both records ride the bundle');
  // Restoring users bumps every token_version (v1.43) and would invalidate
  // this suite's session for the tests that follow -- the claim under test
  // is the TRASH namespace round-tripping, so drop the accounts half.
  delete bundle.users;

  const res = await fetch(`${base}/api/admin/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle),
  });
  assert.equal(res.status, 200, 'THE finding: a backup the app refuses to restore is a DR failure');
  assert.equal(Object.keys(loadDatabase().trash).length, 2, 'both records came back');
});

test('R3 BIND-n3a: restore\'s THROW rollback keeps the last link when the trash side is already gone', async () => {
  const { id, filePath } = seedLibrary();
  const tr = await trashItem(deps(), id);
  assert.equal(tr.ok, true);

  // A concurrent purge takes the trash-side link, THEN the main mutator
  // throws -- the round-1 CRITICAL shape, on the throw branch this time.
  let call = 0;
  const hostileUpdate = async (mutator) => {
    call += 1;
    if (call === 2) {
      fs.unlinkSync(tr.trashPath); // the purge's unlink half
      throw new Error('boom');
    }
    return updateDatabase(mutator);
  };
  const res = await restoreTrashItem({ loadDatabase, updateDatabase: hostileUpdate, getMediaId }, tr.trashId);
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
  assert.ok(fs.existsSync(filePath), 'THE binding: the fresh link is the last one and must be KEPT');
  assert.ok(!fs.existsSync(tr.trashPath));
});

test('R3 BIND-n3d: a bundle trash record whose item is not an object is refused whole', async () => {
  const { filePath } = seedLibrary();
  const bundle = {
    schema: 'filetube-backup-v1',
    folders: [ROOT],
    trash: {
      bad: {
        originalId: 'b', originalPath: path.join(ROOT, 'Chan', 'x.mp4'),
        trashPath: path.join(ROOT, TRASH_DIR_NAME, '1-abcdefgh-x.mp4'),
        trashedAt: 1, rootFolder: ROOT, item: ['not', 'an', 'object'],
      },
    },
  };
  const res = await fetch(`${base}/api/admin/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /item must be an object/);
  assert.ok(fs.existsSync(filePath), 'nothing was restored');
});

// ---- Gate round 4: the last two survivors, bound (zero-residual close) -----

test('R4 BIND-n4e: restore\'s STRUCTURAL trash-dir check is load-bearing -- a record naming a LIVE library file is refused, file untouched', async () => {
  const { id, filePath } = seedLibrary();
  const ELSEWHERE = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-trashgate-n4e-'));
  // trashPath names a live library file that is NOT inside any
  // .filetube-trash dir; destination is under that file's own parent tree,
  // so ONLY the structural check can refuse this. Restore ends with an
  // unconditional unlink(trashPath) -- without the check, the live file
  // would be hard-linked away and then deleted.
  await updateDatabase((db) => {
    db.trash.structural = {
      originalId: 's', originalPath: path.join(ROOT, 'Chan', 'written-by-restore.mp4'),
      trashPath: filePath, trashedAt: Date.now(), rootFolder: ROOT, item: { id: 's', title: 'S' },
    };
  });

  const res = await restoreTrashItem(deps(), 'structural');
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.ok(fs.existsSync(filePath), 'THE binding: the live library file survives');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'clip-bytes', 'byte-identical');
  assert.ok(!fs.existsSync(path.join(ROOT, 'Chan', 'written-by-restore.mp4')), 'nothing was written');
  assert.ok(loadDatabase().metadata[id], 'the library entry is intact');
  assert.ok(fs.existsSync(ELSEWHERE));
});

test('R4 BIND-n4d: the bundle validator refuses a record whose destination is in a THIRD tree (negative binding on the either-shape rule)', async () => {
  const { filePath } = seedLibrary();
  const OTHER = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-trashgate-n4d-'));
  const bundle = {
    schema: 'filetube-backup-v1',
    folders: [ROOT],
    trash: {
      thirdTree: {
        originalId: 't', originalPath: path.join(OTHER, 'unrelated', 'x.mp4'),
        // A legal-looking trash dir, but under neither a bundle folder nor
        // the destination's own tree.
        trashPath: path.join(OTHER, 'someplace', TRASH_DIR_NAME, '1-abcdefgh-x.mp4'),
        trashedAt: 1, rootFolder: null, item: { id: 't' },
      },
    },
  };
  const res = await fetch(`${base}/api/admin/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /bundle's library folders|item's own original location/);
  assert.ok(fs.existsSync(filePath), 'nothing was restored');
});

test('R4 W1: ONE predicate -- a record restore refuses is NEVER auto-destroyed by the sweep (the two shapes the hand-copy missed)', async () => {
  const { id } = seedLibrary();
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-trashgate-w1-'));
  fs.mkdirSync(path.join(OUT, TRASH_DIR_NAME), { recursive: true });
  const bytesA = path.join(OUT, TRASH_DIR_NAME, 'a.mp4');
  const bytesB = path.join(OUT, 'not-a-trash-dir', 'b.mp4');
  fs.mkdirSync(path.dirname(bytesB), { recursive: true });
  fs.writeFileSync(bytesA, 'A-bytes');
  fs.writeFileSync(bytesB, 'B-bytes');

  await updateDatabase((db) => {
    // Shape 1: a '..' segment in originalPath -- path.resolve normalizes it
    // away, so the sweep's hand-copy accepted what restore refuses.
    db.trash.dotdot = {
      // A LITERAL '..' segment (path.join would normalize it away here, the
      // same way path.resolve did inside the sweep's hand-copy).
      originalId: 'a', originalPath: `${OUT}/sub/../a.mp4`,
      trashPath: bytesA, trashedAt: Date.now() - 100 * DAY, rootFolder: null, item: { id: 'a' },
    };
    // Shape 2: trashPath not inside a trash dir -- the hand-copy never
    // gated on that at all.
    db.trash.notrash = {
      originalId: 'b', originalPath: path.join(OUT, 'not-a-trash-dir', 'b-restored.mp4'),
      trashPath: bytesB, trashedAt: Date.now() - 100 * DAY, rootFolder: null, item: { id: 'b' },
    };
  });

  assert.equal((await restoreTrashItem(deps(), 'dotdot')).status, 400, 'precondition: restore refuses shape 1');
  assert.equal((await restoreTrashItem(deps(), 'notrash')).status, 400, 'precondition: restore refuses shape 2');

  const purged = await sweepTrash(Date.now());
  assert.equal(purged, 0, 'THE binding: neither past-retention record was auto-purged');
  const db = loadDatabase();
  assert.ok(db.trash.dotdot && db.trash.notrash, 'both records stand, awaiting an explicit purge');
  assert.ok(fs.existsSync(bytesA), 'shape 1 bytes survive (the hand-copy destroyed these)');
  assert.ok(fs.existsSync(bytesB), 'shape 2 bytes survive');
  assert.ok(loadDatabase().metadata[id], 'the live library is untouched');
});

test('QA-R2 W1: trashing a queued item must NOT brick queue reorder (the hidden entry stays pinned; restore brings it back)', async () => {
  const { id } = seedLibrary();
  // Two more queueable items so there is something visible to reorder.
  const extra = ['x1', 'x2'].map((n) => {
    const p = path.join(ROOT, 'Chan', `${n}.mp4`);
    fs.writeFileSync(p, `${n}-bytes`);
    return { n, p, id: getMediaId(p) };
  });
  await updateDatabase((db) => {
    for (const e of extra) {
      db.metadata[e.id] = {
        id: e.id, name: `${e.n}.mp4`, title: e.n, filePath: e.p, folderName: 'Chan',
        rootFolder: ROOT, size: 8, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 10,
      };
    }
  });
  userStore.setQueue(uid, [
    { uid: 'q1', mediaId: id },        // this one gets trashed -> hidden
    { uid: 'q2', mediaId: extra[0].id },
    { uid: 'q3', mediaId: extra[1].id },
  ], null, 1);

  const tr = await trashItem(deps(), id);
  assert.equal(tr.ok, true);

  const visible = (await (await fetch(`${base}/api/queue`)).json()).entries.map((e) => e.uid);
  assert.deepEqual(visible, ['q2', 'q3'], 'precondition: the trashed entry is hidden from the client');

  // The client can only send what it was shown -- pre-fix this 409'd for
  // the entire retention window with no workaround.
  const res = await fetch(`${base}/api/queue/reorder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedUids: ['q3', 'q2'] }),
  });
  assert.equal(res.status, 200, 'THE binding: reorder works with a hidden entry in the raw queue');
  assert.deepEqual((await res.json()).queue.entries.map((e) => e.uid), ['q3', 'q2']);

  // The hidden entry survived (restore fidelity is the whole point) and is
  // still pinned at its ORIGINAL ABSOLUTE INDEX in the raw queue -- an
  // invisible row must never appear to move.
  assert.deepEqual(userStore.getQueue(uid).entries.map((e) => e.uid), ['q1', 'q3', 'q2']);

  const restored = await restoreTrashItem(deps(), tr.trashId);
  assert.equal(restored.ok, true);
  const after = (await (await fetch(`${base}/api/queue`)).json()).entries.map((e) => e.mediaId);
  assert.ok(after.includes(id), 'the restored item reappears in the queue');
});

// The two halves are SEPARATE tests deliberately (gate round 6): as one
// test the purge half threw first and the sweep half was never reached, so
// the sweep guarantee the name promised was unbound. Each half must kill
// mutant q9 (dropping destConfined's `trashConfined &&` crash guard) alone.
function plantMalformed(db, outsidePath, keys) {
  // originalPath OUTSIDE every configured root: with it under a root,
  // destConfined's root clause short-circuits TRUE and path.dirname is
  // never evaluated -- the crash cannot occur and the test proves nothing.
  for (const key of keys) {
    db.trash[key] = {
      originalId: 'm', originalPath: outsidePath,
      trashPath: undefined, trashedAt: Date.now() - 100 * DAY, rootFolder: null, item: { id: 'm' },
    };
  }
}

test('R5a (adversarial W1): purgeTrashItem cannot THROW on a malformed record (the crash guard round 4 wrongly called dead logic)', async () => {
  seedLibrary();
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-trashgate-w1a-'));
  await updateDatabase((db) => {
    let n = 0;
    for (const bad of [undefined, null, 42, {}, []]) {
      db.trash[`malformed-${n += 1}`] = {
        originalId: 'm', originalPath: path.join(OUT, 'm.mp4'),
        trashPath: bad, trashedAt: Date.now() - 100 * DAY, rootFolder: null, item: { id: 'm' },
      };
    }
  });
  for (const key of ['malformed-1', 'malformed-2', 'malformed-3', 'malformed-4', 'malformed-5']) {
    const res = await purgeTrashItem({ loadDatabase, updateDatabase }, key);
    assert.equal(res.ok, true, `purge must not throw on ${key}`);
  }
});

test('R5b (adversarial W1): ONE malformed record must not abort the whole retention sweep -- the healthy record still purges', async () => {
  const { id } = seedLibrary();
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-trashgate-w1b-'));
  // Malformed FIRST so the record loop reaches it BEFORE the healthy one:
  // under the mutant the sweep aborts there and the healthy record is left
  // unpurged, which is the real cost (with the healthy one first it would
  // already be purged before the throw and the severity would read wrong).
  await updateDatabase((db) => plantMalformed(db, path.join(OUT, 'm.mp4'), ['malformed']));
  const good = await trashItem(deps(), id, { nowMs: Date.now() - 100 * DAY });
  assert.equal(good.ok, true);

  const purged = await sweepTrash(Date.now());
  assert.equal(purged, 1, 'the sweep completed instead of aborting on the malformed record');
  assert.equal(loadDatabase().trash[good.trashId], undefined, 'and the healthy past-retention record WAS purged');
  assert.ok(!fs.existsSync(good.trashPath));
});

test('R5 (adversarial S1): a client sending MORE uids than visible slots is REFUSED, never silently trimmed', async () => {
  const { id } = seedLibrary();
  const extra = ['y1', 'y2'].map((n) => {
    const p = path.join(ROOT, 'Chan', `${n}.mp4`);
    fs.writeFileSync(p, `${n}-bytes`);
    return { n, p, id: getMediaId(p) };
  });
  await updateDatabase((db) => {
    for (const e of extra) {
      db.metadata[e.id] = {
        id: e.id, name: `${e.n}.mp4`, title: e.n, filePath: e.p, folderName: 'Chan',
        rootFolder: ROOT, size: 8, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 10,
      };
    }
  });
  userStore.setQueue(uid, [
    { uid: 'r1', mediaId: id },          // trashed -> hidden
    { uid: 'r2', mediaId: extra[0].id },
    { uid: 'r3', mediaId: extra[1].id },
  ], null, 1);
  assert.equal((await trashItem(deps(), id)).ok, true);

  // Two visible slots, THREE uids sent (the third invented). Without the
  // leftover concat these would be trimmed to the visible count and the
  // reorder would succeed -- the ledger-check posture says refuse.
  const res = await fetch(`${base}/api/queue/reorder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedUids: ['r3', 'r2', 'ghost'] }),
  });
  assert.equal(res.status, 409, 'THE binding: an over-long order is refused, not helpfully merged');
  assert.deepEqual(userStore.getQueue(uid).entries.map((e) => e.uid), ['r1', 'r2', 'r3'], 'raw queue untouched');
});
