'use strict';

// [INTEGRATION] v1.339 FOUC / TOCTOU audit, slice S5 (plan
// docs/exec-plans/active/2026-09-26-fouc-toctou-audit.md, findings T-S4 and
// T-S2, decision D3): the two gaps the S3 builder left open between a trash
// RESTORE and a running media scan.
//
//   G1  the scan's same-inode trash-leftover reconcile re-reads the live
//       record after its await (S3), but a restore whose link exists and whose
//       commit is still PENDING leaves the record standing: the scan unlinked
//       the restored link, the restore then committed and unlinked the trash
//       side - both links gone, the metadata live with no file. Same when a
//       restore heals a genuine crash leftover while the scan reconciles it
//       the other way. Two guards, each bound by its own isolating test:
//         A  lib/media/trash.js `restoresInFlight`: the reconcile skips a path
//            a restore has claimed (the claim is exclusive and released in a
//            finally);
//         B  restore's last-link re-check: it never unlinks the trash side
//            unless originalPath still holds the same inode (re-links it when
//            it vanished; keeps the trash copy when a different file is there).
//   G2  an item restored mid-walk whose id the Phase-1 snapshot lacked is
//       re-indexed as a NEW file, and the wholesale merge wrote the re-probed
//       stranger over the restored entry. The final mutator now keeps the
//       fresh entry for the same file (same path + size + codec fields).
//
// Every interleaving is EVENT-LOOP ORDER, never timing (LESSONS 2): the
// restore is held on manually resolved promises at its updateDatabase calls,
// the walk on a manually resolved readdir.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scanrestore-toctou-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, loadDatabase, updateDatabase, scanDirectories, trashItem, restoreTrashItem,
  userStore, viewCountStore, progressStore, activeMediaStreams, __resetDatabaseForTests,
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

// A persisted entry with EVERY class of field a restore must bring back: the
// probed technical fields, the manual / user fields (chaptersManual, the
// manual channel attribution unit, sourceUrl), the reheat-written group, and
// fields that ONLY a non-scan writer sets (audioStatus, attributionConflict)
// and that no Phase-2 gap-fill carries.
function richEntry(root, filePath, extra = {}) {
  const st = fs.statSync(filePath);
  return {
    id: getMediaId(filePath), name: path.basename(filePath), title: 'Src Title', filePath,
    folderName: 'Chan', rootFolder: root, size: st.size, ext: '.mp4', type: 'video',
    addedAt: 1600000000000, duration: 61, hasThumbnail: true, artist: 'Someone', tags: { comment: 'kept' },
    videoCodec: 'h264', audioCodec: 'aac', needsTranscode: false, width: 1920, height: 1080,
    releaseDate: 1500000000000, youtubeId: null, hasSubtitles: false,
    chapters: [{ title: 'Embedded', start: 0 }],
    chaptersManual: [{ title: 'Manual chapter', start: 5 }],
    sourceUrl: 'https://example.com/watch/1', sourceTitle: 'Src Title',
    channelAttributedManually: true, channelUrl: 'https://example.com/c/manual', channelName: 'Manual Channel',
    sourceExtractor: 'Generic', sourceId: 'abc123',
    metadataRepulledAt: 1650000000000, sourceViewCount: 5, sourceViewCountCapturedAt: 1650000000000,
    audioStatus: 'ready',
    attributionConflict: { kept: 'Manual Channel', discovered: 'Other Channel' },
    ...extra,
  };
}

// A library: `clip.mp4` (the raced item) and `keep.mp4` (a bystander, so the
// folder is never "vanished").
function seedLibrary(clipExtra) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scanrestore-lib-'));
  const chan = path.join(root, 'Chan');
  fs.mkdirSync(chan, { recursive: true });
  const clip = path.join(chan, 'clip.mp4');
  const keep = path.join(chan, 'keep.mp4');
  fs.writeFileSync(clip, 'clip-bytes');
  fs.writeFileSync(keep, 'keep-bytes');
  const metadata = {
    [getMediaId(clip)]: richEntry(root, clip, clipExtra),
    [getMediaId(keep)]: richEntry(root, keep),
  };
  seedState({ folders: [root], folderSettings: {}, metadata, settings: SETTINGS });
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  return { root, chan, clip, keep, clipId: getMediaId(clip), keepId: getMediaId(keep) };
}

function seedUserState(id, seconds) {
  userStore.setProgress(uid, id, { timestamp: seconds, duration: 60, updatedAt: ISO });
  userStore.addLiked(uid, id, ISO);
  viewCountStore.set(id, 7);
  progressStore.set(id, { timestamp: seconds, duration: 60 });
}

function assertUserStateSurvived(id, seconds, label) {
  const p = userStore.getOneProgress(uid, id);
  assert.ok(p && p.timestamp === seconds, `${label}: the per-user progress survived (got ${JSON.stringify(p)})`);
  assert.ok(userStore.getLiked(uid).includes(id), `${label}: the Like survived`);
  assert.equal(viewCountStore.get(id), 7, `${label}: the view count survived`);
}

const trashDeps = () => ({ loadDatabase, updateDatabase, getMediaId });

// Start a restore whose updateDatabase call number `holdCall` (1 = the
// destination-tombstone mutator, before the link; 2 = the main commit, after
// the link) is parked until `release()`. Resolves `reached` when parked.
function heldRestore(trashId, holdCall, extraDeps = {}) {
  const gate = deferred();
  const reached = deferred();
  let call = 0;
  const heldUpdate = async (mutator) => {
    call += 1;
    if (call === holdCall) {
      reached.resolve();
      await gate.promise;
    }
    return updateDatabase(mutator);
  };
  const done = restoreTrashItem({ loadDatabase, updateDatabase: heldUpdate, getMediaId, ...extraDeps }, trashId);
  return { done, reached: reached.promise, release: () => gate.resolve() };
}

// A stand-in stream on `filePath` that closes on the next turn: the scan's
// destroyMediaStreams await completes without releasing anything, and the
// counter witnesses that the scan reached the reconcile branch.
function witnessStream(filePath) {
  const stand = new EventEmitter();
  stand.closed = false;
  stand.destroyed = false;
  stand.hits = 0;
  stand.destroy = () => {
    stand.hits += 1;
    setImmediate(() => { stand.closed = true; stand.emit('close'); });
  };
  activeMediaStreams.set(filePath, new Set([stand]));
  return stand;
}

// ---------------------------------------------------------------------------
// G1, guard A (restoresInFlight) - isolating tests. The INTERMEDIATE assert
// (the restored link still exists right after the scan, while the restore is
// still held) is what only guard A can satisfy: guard B repairs only later,
// when the restore resumes.
// ---------------------------------------------------------------------------

test('G1/A: the scan\'s reconcile runs while a restore\'s commit is PENDING - the restored link is not unlinked, and the restore lands with both the file and the metadata', async () => {
  const lib = seedLibrary();
  seedUserState(lib.clipId, 44);
  const tr = await trashItem(trashDeps(), lib.clipId);
  assert.equal(tr.ok, true, 'precondition: trashed');
  assert.equal(fs.existsSync(lib.clip), false, 'precondition: the library path is empty');

  const r = heldRestore(tr.trashId, 2); // parked at its commit, the link already made
  await r.reached;
  assert.equal(fs.statSync(lib.clip).ino, fs.statSync(tr.trashPath).ino, 'precondition: the half-restored same-inode shape');
  assert.ok(trashStore().get(tr.trashId), 'precondition: the record still stands (commit pending)');

  const stand = witnessStream(lib.clip);
  await scanDirectories(); // the reconcile's re-check runs BEFORE the restore commits

  assert.equal(stand.hits, 1, 'precondition: the scan reached the reconcile branch and awaited destroyMediaStreams');
  assert.ok(trashStore().get(tr.trashId), 'precondition: the record was still standing when the scan re-checked');
  assert.ok(fs.existsSync(lib.clip), 'THE finding (guard A): the scan did NOT unlink the restored link while the restore was in flight');

  r.release();
  const res = await r.done;
  assert.equal(res.ok, true, `the restore completed (${JSON.stringify(res)})`);
  assert.equal(res.relinked, undefined, 'guard B never had to repair anything (guard A held)');
  assert.equal(fs.readFileSync(lib.clip, 'utf8'), 'clip-bytes', 'the bytes are at the original path');
  assert.equal(fs.existsSync(tr.trashPath), false, 'the trash side was retired normally');
  const entry = loadDatabase().metadata[lib.clipId];
  assert.ok(entry && entry.filePath === lib.clip, 'the restored item is live');
  assertUserStateSurvived(lib.clipId, 44, 'restored item');
});

test('G1/A: a restore HEALING a genuine crash leftover while the scan reconciles it the other way - the scan keeps its hands off, the heal completes', async () => {
  const lib = seedLibrary();
  seedUserState(lib.clipId, 44);
  const tr = await trashItem(trashDeps(), lib.clipId);
  assert.equal(tr.ok, true);
  fs.linkSync(tr.trashPath, lib.clip); // death between a restore's link and its commit

  const r = heldRestore(tr.trashId, 1); // claimed + stat'd (alreadyLinked), parked before its tombstone mutator
  await r.reached;

  const stand = witnessStream(lib.clip);
  await scanDirectories();

  assert.equal(stand.hits, 1, 'precondition: the scan reached the reconcile branch');
  assert.ok(fs.existsSync(lib.clip), 'THE finding (guard A): the leftover the restore is healing was NOT unlinked');

  r.release();
  const res = await r.done;
  assert.equal(res.ok, true, `the heal completed (${JSON.stringify(res)})`);
  assert.equal(fs.readFileSync(lib.clip, 'utf8'), 'clip-bytes');
  assert.equal(fs.existsSync(tr.trashPath), false);
  assert.ok(loadDatabase().metadata[lib.clipId], 'the healed item is live');
  assertUserStateSurvived(lib.clipId, 44, 'healed item');
});

test('G1/A claim is released on EVERY path: after a restore that failed mid-way, a scan reconciles the crash leftover again', async () => {
  const lib = seedLibrary();
  const tr = await trashItem(trashDeps(), lib.clipId);
  assert.equal(tr.ok, true);
  fs.linkSync(tr.trashPath, lib.clip); // the crash-leftover shape

  const failing = async () => { throw new Error('disk full'); };
  const res = await restoreTrashItem({ loadDatabase, updateDatabase: failing, getMediaId }, tr.trashId);
  assert.equal(res.ok, false, 'precondition: the restore failed AFTER claiming the path');
  assert.equal(res.status, 500);

  const stand = witnessStream(lib.clip);
  await scanDirectories();

  assert.equal(stand.hits, 1, 'precondition: the scan reached the reconcile branch');
  assert.equal(fs.existsSync(lib.clip), false, 'THE binding: the released claim no longer shields the leftover - reconciled away');
  assert.ok(fs.existsSync(tr.trashPath), 'the bytes are intact in the trash');
  assert.ok(trashStore().get(tr.trashId), 'the record is untouched');
});

test('G1/A claim is EXCLUSIVE: a second restore onto a claimed path is refused (409) and does not drop the first restore\'s claim', async () => {
  const lib = seedLibrary();
  const tr = await trashItem(trashDeps(), lib.clipId);
  assert.equal(tr.ok, true);

  const r = heldRestore(tr.trashId, 2);
  await r.reached;

  const second = await restoreTrashItem(trashDeps(), tr.trashId);
  assert.equal(second.ok, false, `THE binding: the double restore was refused (${JSON.stringify(second)})`);
  assert.equal(second.status, 409);
  assert.equal(second.error, 'This item is already being restored - try again in a moment');

  // The first restore's claim still stands after the refusal returned.
  const stand = witnessStream(lib.clip);
  await scanDirectories();
  assert.equal(stand.hits, 1, 'precondition: the scan reached the reconcile branch');
  assert.ok(fs.existsSync(lib.clip), 'the first restore\'s claim still shields its link');

  r.release();
  const res = await r.done;
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(lib.clip, 'utf8'), 'clip-bytes');
  assert.equal(fs.existsSync(tr.trashPath), false);
});

// ---------------------------------------------------------------------------
// G1, guard B (the last-link re-check) - isolating tests: NO scan runs, so
// guard A is not in play; the restored link is removed / replaced from
// outside while the commit is held (a remover the in-process claim cannot
// see, e.g. another process).
// ---------------------------------------------------------------------------

test('G1/B: the restored link VANISHES before the restore finishes - the trash side is NOT unlinked; the file is re-linked and the item is live with its bytes', async () => {
  const lib = seedLibrary();
  seedUserState(lib.clipId, 44);
  const tr = await trashItem(trashDeps(), lib.clipId);
  assert.equal(tr.ok, true);

  const r = heldRestore(tr.trashId, 2);
  await r.reached;
  fs.unlinkSync(lib.clip); // an out-of-process remover takes the fresh link
  r.release();
  const res = await r.done;

  assert.ok(fs.existsSync(lib.clip) || fs.existsSync(tr.trashPath), 'THE finding (guard B): the bytes still exist somewhere');
  assert.equal(res.ok, true, `the restore reports success (${JSON.stringify(res)})`);
  assert.equal(res.relinked, true, 'and says it had to re-link');
  assert.equal(fs.readFileSync(lib.clip, 'utf8'), 'clip-bytes', 'the file is back at its original path');
  assert.equal(fs.existsSync(tr.trashPath), false, 'the trash side retired only after the re-link verified');
  assert.ok(loadDatabase().metadata[lib.clipId], 'the committed entry has its file');
  assertUserStateSurvived(lib.clipId, 44, 'restored item');
});

test('G1/B: a DIFFERENT file appears at the original path before the restore finishes - the trash copy is KEPT, the restore says so, the other file is untouched', async () => {
  const lib = seedLibrary();
  const tr = await trashItem(trashDeps(), lib.clipId);
  assert.equal(tr.ok, true);

  const r = heldRestore(tr.trashId, 2);
  await r.reached;
  fs.unlinkSync(lib.clip);
  fs.writeFileSync(lib.clip, 'someone-elses-bytes');
  r.release();
  const res = await r.done;

  assert.ok(fs.existsSync(tr.trashPath), 'THE finding (guard B): the trash-side bytes were NOT unlinked');
  assert.equal(fs.readFileSync(tr.trashPath, 'utf8'), 'clip-bytes');
  assert.equal(res.ok, false, `an honest failure (${JSON.stringify(res)})`);
  assert.equal(res.status, 409);
  // v1.339 r1: the text says where the copy is in words (the trash folder),
  // never the server's absolute trash path.
  assert.equal(res.error, 'The item was restored, but the file at its original location changed before the restore finished - the trashed copy was kept in the trash folder');
  assert.ok(!res.error.includes(tr.trashPath) && !res.error.includes(path.dirname(tr.trashPath)), 'no absolute path in the message');
  assert.equal(fs.readFileSync(lib.clip, 'utf8'), 'someone-elses-bytes', 'the other file is untouched');
});

test('G1 control: a plain restore (no race) still retires the trash side and returns a plain success', async () => {
  const lib = seedLibrary();
  seedUserState(lib.clipId, 44);
  const tr = await trashItem(trashDeps(), lib.clipId);
  const res = await restoreTrashItem(trashDeps(), tr.trashId);
  assert.deepEqual(res, { ok: true, trashId: tr.trashId, restoredId: lib.clipId, originalPath: lib.clip });
  assert.equal(fs.readFileSync(lib.clip, 'utf8'), 'clip-bytes');
  assert.equal(fs.existsSync(tr.trashPath), false);
  assertUserStateSurvived(lib.clipId, 44, 'restored item');
});

// ---------------------------------------------------------------------------
// G2: restored mid-walk, walked as a NEW file.
// ---------------------------------------------------------------------------

// Trash clip BEFORE the scan (so the Phase-1 snapshot has no entry for its
// id), then run `midWalk` while the walk is parked at its readdir of the
// folder, BEFORE the listing is taken (so the walk sees the restored file).
async function scanWithMidWalk(lib, midWalk) {
  let armed = true;
  fs.promises.readdir = async function heldReaddir(p, opts) {
    if (armed && p === lib.chan) {
      armed = false;
      await midWalk();
    }
    return realReaddir.call(fs.promises, p, opts);
  };
  await scanDirectories();
  assert.equal(armed, false, 'precondition: the walk reached the held readdir');
}

test('G2: an item restored mid-walk (id absent from the Phase-1 snapshot) keeps its WHOLE restored entry - not overwritten by a re-probed stranger', async () => {
  const lib = seedLibrary();
  seedUserState(lib.clipId, 44);
  const tr = await trashItem(trashDeps(), lib.clipId);
  assert.equal(tr.ok, true);

  let restored = null;
  await scanWithMidWalk(lib, async () => {
    const res = await restoreTrashItem(trashDeps(), tr.trashId);
    assert.equal(res.ok, true, 'precondition: the restore landed mid-walk');
    restored = JSON.parse(JSON.stringify(loadDatabase().metadata[lib.clipId]));
  });

  const after = loadDatabase().metadata[lib.clipId];
  assert.ok(after, 'the restored item is live');
  assert.deepEqual(after, restored, 'THE finding: the entry the restore committed is exactly what the scan left');
  // The named casualties, spelled out (each differs from a re-probe here).
  assert.equal(after.addedAt, 1600000000000, 'addedAt (the library position) kept');
  assert.equal(after.audioStatus, 'ready', 'audioStatus kept');
  assert.deepEqual(after.attributionConflict, { kept: 'Manual Channel', discovered: 'Other Channel' }, 'attributionConflict kept');
  assert.equal(after.duration, 61, 'duration kept (the re-probe of these bytes yields 0)');
  assert.equal(after.videoCodec, 'h264', 'codecs kept (the re-probe yields null)');
  // The manual fields the finding named (the Phase-2 gap-fills already carried
  // these before S5 too - kept here as the regression net).
  assert.deepEqual(after.chaptersManual, [{ title: 'Manual chapter', start: 5 }]);
  assert.equal(after.sourceUrl, 'https://example.com/watch/1');
  assert.equal(after.channelAttributedManually, true);
  assert.equal(after.channelName, 'Manual Channel');
  assertUserStateSurvived(lib.clipId, 44, 'restored item');
});

test('G2 control: a genuinely NEW file (no live entry anywhere) is still indexed from its own probe', async () => {
  const lib = seedLibrary();
  const fresh = path.join(lib.chan, 'brand-new.mp4');
  fs.writeFileSync(fresh, 'brand-new-bytes!');
  await scanDirectories();
  const entry = loadDatabase().metadata[getMediaId(fresh)];
  assert.ok(entry, 'the new file is indexed');
  assert.equal(entry.filePath, fresh);
  assert.equal(entry.size, 16, 'with its own probed size');
  assert.ok(Object.prototype.hasOwnProperty.call(entry, 'videoCodec'), 'with the probed-once codec fields');
  assert.equal(entry.title, 'brand-new');
});

test('G2 conjunct (size): restored mid-walk, then CHANGED before the walk saw it - the scan\'s probe wins for the file, the manual fields still carry', async () => {
  const lib = seedLibrary();
  const tr = await trashItem(trashDeps(), lib.clipId);
  assert.equal(tr.ok, true);

  await scanWithMidWalk(lib, async () => {
    const res = await restoreTrashItem(trashDeps(), tr.trashId);
    assert.equal(res.ok, true);
    fs.appendFileSync(lib.clip, '-re-encoded');
  });

  const after = loadDatabase().metadata[lib.clipId];
  assert.equal(after.size, fs.statSync(lib.clip).size, 'THE binding: the changed file\'s own size, not the restored entry\'s');
  assert.notEqual(after.size, 'clip-bytes'.length);
  assert.deepEqual(after.chaptersManual, [{ title: 'Manual chapter', start: 5 }], 'manual chapters carried (gap-fill)');
  assert.equal(after.sourceUrl, 'https://example.com/watch/1', 'sourceUrl carried (gap-fill)');
  assert.equal(after.channelAttributedManually, true, 'manual attribution carried');
  assert.equal(after.channelName, 'Manual Channel');
});

test('G2 conjunct (codec fields): a restored VIDEO entry with no codec fields (same size) takes the scan\'s probe, the manual fields still carry', async () => {
  const lib = seedLibrary({ videoCodec: undefined, audioCodec: undefined });
  // JSON drops the undefined keys: the persisted entry has NO codec keys.
  assert.equal(Object.prototype.hasOwnProperty.call(loadDatabase().metadata[lib.clipId], 'videoCodec'), false, 'precondition: a legacy entry');
  const tr = await trashItem(trashDeps(), lib.clipId);
  assert.equal(tr.ok, true);

  await scanWithMidWalk(lib, async () => {
    const res = await restoreTrashItem(trashDeps(), tr.trashId);
    assert.equal(res.ok, true);
  });

  const after = loadDatabase().metadata[lib.clipId];
  assert.ok(Object.prototype.hasOwnProperty.call(after, 'videoCodec'), 'THE binding: the probe ran and its codec fields landed');
  assert.deepEqual(after.chaptersManual, [{ title: 'Manual chapter', start: 5 }], 'manual chapters carried (gap-fill)');
  assert.equal(after.sourceUrl, 'https://example.com/watch/1');
});

test('G2 conjunct (filePath): a live row under a new file\'s id that names ANOTHER path is never adopted', async () => {
  const lib = seedLibrary();
  const fresh = path.join(lib.chan, 'brand-new.mp4');
  fs.writeFileSync(fresh, 'brand-new-bytes!');
  const freshId = getMediaId(fresh);
  await scanWithMidWalk(lib, async () => {
    await updateDatabase((db) => {
      db.metadata[freshId] = {
        id: freshId, name: 'brand-new.mp4', title: 'Impostor', filePath: path.join(lib.root, 'elsewhere.mp4'),
        folderName: 'Chan', rootFolder: lib.root, size: 16, ext: '.mp4', type: 'video', videoCodec: 'h264', audioCodec: 'aac',
      };
      return true;
    });
  });
  const entry = loadDatabase().metadata[freshId];
  assert.equal(entry.filePath, fresh, 'THE binding: the entry names the walked file');
  assert.equal(entry.title, 'brand-new');
});
