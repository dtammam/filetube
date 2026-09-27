'use strict';

// [INTEGRATION] v1.339 FOUC / TOCTOU audit, slice S3 (plan
// docs/exec-plans/completed/2026-09-26-fouc-toctou-audit.md, finding T-S3,
// decision D3): the music, Shows and books scan runners now carry the media
// scan's v1.42 W4 persistedStateEpoch guard. Before it, an admin restore
// landing while one of them walked was merged against: the restored items
// the walk never saw (here: a restored folder list with a second root the
// Phase-1 walk did not cover) were pruned, and their restored per-user state
// shed with them.
//
// Each case is EVENT-LOOP ORDER, never timing (LESSONS 2): the walk is held
// open on a manually resolved promise at its fs.promises.stat of the one file
// under the Phase-1 root, the restore (wipe-and-replace, then the restored
// rows) runs while it is parked, then the walk resumes.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-runners-epoch-'));

const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  app, scanMusic, scanTv, scanBooks, musicDb, tvDb, booksDb, userStore,
  __resetDatabaseForTests, __getPersistedStateEpoch,
} = require('../../server');
const { settingsStore } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

const ISO = '2026-09-26T12:00:00.000Z';
const realStat = fs.promises.stat;
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
  fs.promises.stat = realStat;
});

function pruneOn() {
  settingsStore().update({ pruneMissing: true });
}

function writeFile(full, bytes) {
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
  return full;
}

// Park the walk at its stat of `filePath`; run `during` while it is parked.
function holdStat(filePath, during) {
  let armed = true;
  let ran = false;
  fs.promises.stat = async function heldStat(p, ...rest) {
    if (armed && p === filePath) {
      armed = false;
      await during();
      ran = true;
    }
    return realStat.call(fs.promises, p, ...rest);
  };
  return () => ran;
}

// The shared shape: index BOTH roots for real (so the restored rows are the
// runner's own record shape), remember that namespace as the "backup", then
// narrow the Phase-1 state to root A only. While the next scan walks A, the
// "restore" wipes the state (the epoch bump) and puts the backup back with the
// per-user state for B's item. The scan must not prune B or its state.
async function raceRestoreIntoWalk({ db, scan, rootA, rootB, holdPath, pathB, itemsKey, seedUser, assertUser }) {
  db.replaceAll({ folders: [rootA, rootB] });
  pruneOn();
  await scan();
  const backup = db.read();
  const ids = Object.keys(backup[itemsKey]);
  assert.equal(ids.length, 3, `precondition: both roots indexed (${ids.length})`);
  const idB = ids.find((id) => backup[itemsKey][id].filePath === pathB);
  const idA = ids.find((id) => backup[itemsKey][id].rootFolder === rootA);
  assert.ok(idA && idB, 'precondition: the root-A item and the raced root-B item are indexed');

  // Phase-1 state: root A only (B is what the restore brings back).
  db.replaceAll({ ...backup, folders: [rootA], [itemsKey]: { [idA]: backup[itemsKey][idA] } });
  pruneOn();

  const epochBefore = __getPersistedStateEpoch();
  const held = holdStat(holdPath, async () => {
    await __resetDatabaseForTests(); // the wipe-and-replace: bumps the epoch
    db.replaceAll(backup);
    pruneOn();
    seedUser(idB);
  });

  await scan();

  assert.equal(held(), true, 'precondition: the restore landed while the walk was parked');
  assert.equal(__getPersistedStateEpoch(), epochBefore + 1, 'precondition: the restore bumped the epoch');
  const after = db.read();
  assert.ok(after[itemsKey][idB], 'THE finding: the restored item under the restored root is still indexed');
  assert.deepEqual(after.folders, [rootA, rootB], 'the restored folder list stands');
  assertUser(idB);

  // Recovery: the NEXT scan rebuilds against the restored state (both roots),
  // and a genuinely removed file still prunes with its state (the control; a
  // bystander under root B keeps the root from reading as unmounted).
  fs.rmSync(pathB);
  await scan();
  assert.equal(db.read()[itemsKey][idB], undefined, 'control: once its file is really gone, the next scan prunes it');
  return { idB };
}

test('T-S3 music: a restore landing mid-walk does not prune restored tracks or shed their liked/progress', async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-epoch-music-'));
  const rootA = path.join(lib, 'A');
  const rootB = path.join(lib, 'B');
  const holdPath = writeFile(path.join(rootA, 'Artist/Album/01 One.mp3'), 'FAKEAUDIO');
  const pathB = writeFile(path.join(rootB, 'Other/Record/01 Two.mp3'), 'FAKEAUDIO2');
  writeFile(path.join(rootB, 'Other/Record/02 Three.mp3'), 'FAKEAUDIO3');
  const { idB } = await raceRestoreIntoWalk({
    db: musicDb, scan: scanMusic, rootA, rootB, holdPath, pathB, itemsKey: 'tracks',
    seedUser: (id) => {
      userStore.addMusicLiked(uid, id, ISO);
      userStore.setMusicProgress(uid, id, { position: 33, duration: 200, updatedAt: ISO });
    },
    assertUser: (id) => {
      assert.ok(userStore.getMusicLiked(uid).includes(id), 'the restored Like survived');
      const prog = userStore.getMusicProgress(uid)[id];
      assert.ok(prog && prog.position === 33, `the restored progress survived (got ${JSON.stringify(prog)})`);
    },
  });
  assert.ok(!userStore.getMusicLiked(uid).includes(idB), 'control: the genuine prune shed the Like');
});

test('T-S3 tv: a restore landing mid-walk does not prune restored episodes or shed their progress/liked', async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-epoch-tv-'));
  const rootA = path.join(lib, 'A');
  const rootB = path.join(lib, 'B');
  const holdPath = writeFile(path.join(rootA, 'Show One/Show One S01E01.mp4'), 'bytes-a');
  const pathB = writeFile(path.join(rootB, 'Show Two/Show Two S01E01.mp4'), 'bytes-b');
  writeFile(path.join(rootB, 'Show Two/Show Two S01E02.mp4'), 'bytes-b2');
  const { idB } = await raceRestoreIntoWalk({
    db: tvDb, scan: scanTv, rootA, rootB, holdPath, pathB, itemsKey: 'episodes',
    seedUser: (id) => {
      userStore.setTvProgress(uid, id, { position: 90, duration: 1200, updatedAt: ISO });
      userStore.addTvLiked(uid, id, ISO);
    },
    assertUser: (id) => {
      const prog = userStore.getOneTvProgress(uid, id);
      assert.ok(prog && prog.position === 90, `the restored progress survived (got ${JSON.stringify(prog)})`);
      assert.ok(userStore.getTvLiked(uid).some((r) => r.episodeId === id), 'the restored Like survived');
    },
  });
  assert.ok(!userStore.getTvLiked(uid).some((r) => r.episodeId === idB), 'control: the genuine prune shed the Like');
});

test('T-S3 books: a restore landing mid-walk does not prune restored books or shed their reading position/like', async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-epoch-books-'));
  const rootA = path.join(lib, 'A');
  const rootB = path.join(lib, 'B');
  const holdPath = writeFile(path.join(rootA, 'Manual_One.pdf'), '%PDF-1.4 fake one');
  const pathB = writeFile(path.join(rootB, 'Manual_Two.pdf'), '%PDF-1.4 fake two');
  writeFile(path.join(rootB, 'Manual_Three.pdf'), '%PDF-1.4 fake three');
  const { idB } = await raceRestoreIntoWalk({
    db: booksDb, scan: scanBooks, rootA, rootB, holdPath, pathB, itemsKey: 'items',
    seedUser: (id) => {
      userStore.setBookProgress(uid, id, { page: 17, updatedAt: ISO });
      userStore.addBookLiked(uid, id, ISO);
    },
    assertUser: (id) => {
      const prog = userStore.getBookProgress(uid)[id];
      assert.ok(prog && prog.page === 17, `the restored reading position survived (got ${JSON.stringify(prog)})`);
      assert.ok(userStore.getBookLiked(uid).some((r) => r.bookId === id), 'the restored Like survived');
    },
  });
  assert.equal(userStore.getBookProgress(uid)[idB], undefined, 'control: the genuine prune shed the reading position');
});
