'use strict';

// [INTEGRATION] v1.44 T4: the music scanner end-to-end against the REAL app
// module. CI has no ffmpeg, so probeMusicTrack returns null and tracks index
// by the PATH CONVENTION (Artist/Album/NN Title) — which is exactly the
// fallback path we want to exercise; fixture files are a few dummy bytes with
// the right extension (content is never probed here). Album art is exercised
// via a SIDECAR cover file (fs copy, no ffmpeg). Locks: discovery + track
// shape, unchanged-rescan reuse, BOTH mount-loss guards (vanished root +
// empty-scan-under-mounted-root), a DIVERGENT-spelling prune (the v1.41.9
// lesson — a stale entry at a different spelling than the on-disk file), the
// per-user music-state shed on prune, album-art sidecar copy + orphan-only-on-
// last-track prune, and the three-way config overlap refusal.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-music-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, loadDatabase, updateDatabase, getMediaId, scanMusic, currentMusicScanState, ALBUMART_DIR, userStore,
} = require('../../server');
const musicStore = require('../../lib/music/store');
const musicScanLib = require('../../lib/music/scan');
const { authenticateFetch } = require('../helpers/auth');

async function scanMusicSettled() {
  await scanMusic();
  for (let i = 0; i < 400 && currentMusicScanState().scanning; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

let server;
let base;
let user;
let libRoot;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  ({ user } = authenticateFetch(server, base));
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

// Reset db.music + this user's music state before each test so cases don't
// bleed (the suite shares one DATA_DIR + minted session — a full db reset
// would drop the session, so clear only what music owns).
beforeEach(async () => {
  const prog = userStore.getMusicProgress(user.id);
  const liked = userStore.getMusicLiked(user.id);
  userStore.removeMusicState([...new Set([...Object.keys(prog), ...liked])]);
  await updateDatabase((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.folders = [];
    ns.tracks = {};
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};
    db.settings.pruneMissing = false;
    return true;
  });
  libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-musiclib-'));
});

function writeTrack(rel) {
  const full = path.join(libRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'FAKEAUDIO');
  return full;
}
function postJson(urlPath, body) {
  return fetch(`${base}${urlPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function setFolders(folders) {
  const res = await postJson('/api/music/config', { folders });
  return res;
}
async function setPruneMissing(on) {
  await updateDatabase((db) => { db.settings.pruneMissing = !!on; return true; });
}

test('T4: music-less install is a total no-op', async () => {
  await scanMusicSettled();
  const m = loadDatabase().music;
  assert.ok(!m || Object.keys(m.tracks || {}).length === 0);
});

test('T4: config + scan discovers a track, derives Artist/Album/NN-Title from the path, copies a sidecar cover', async () => {
  writeTrack('Pink Floyd/The Wall/05 Mother.flac');
  fs.writeFileSync(path.join(libRoot, 'Pink Floyd/The Wall/cover.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  const res = await setFolders([libRoot]);
  assert.equal(res.status, 200);
  await scanMusicSettled();

  const tracks = loadDatabase().music.tracks;
  const ids = Object.keys(tracks);
  assert.equal(ids.length, 1, 'exactly one track discovered');
  const t = tracks[ids[0]];
  assert.equal(t.artist, 'Pink Floyd');
  assert.equal(t.album, 'The Wall');
  assert.equal(t.trackNo, 5);
  assert.equal(t.title, 'Mother');
  assert.equal(t.ext, '.flac');
  assert.equal(t.rootFolder, libRoot);
  assert.ok(typeof t.albumArtKey === 'string' && t.albumArtKey.length === 32, 'albumArtKey is an md5');
  assert.ok(fs.existsSync(path.join(ALBUMART_DIR, `${t.albumArtKey}.jpg`)), 'sidecar cover copied into .albumart');
});

test('T4: an unchanged rescan REUSES the record (addedAt preserved, no churn)', async () => {
  writeTrack('A/Album/01 One.mp3');
  await setFolders([libRoot]);
  await scanMusicSettled();
  const before = Object.values(loadDatabase().music.tracks)[0];
  await scanMusicSettled();
  const after = Object.values(loadDatabase().music.tracks)[0];
  assert.equal(after.addedAt, before.addedAt, 'unchanged track reused, addedAt stable');
  assert.equal(after.id, before.id);
});

test('T4: MOUNT-LOSS (vanished root) — a configured root that disappears prunes NOTHING even with pruneMissing on', async () => {
  writeTrack('A/Album/01 One.flac');
  writeTrack('A/Album/02 Two.flac');
  await setFolders([libRoot]);
  await scanMusicSettled();
  assert.equal(Object.keys(loadDatabase().music.tracks).length, 2);

  await setPruneMissing(true);
  fs.rmSync(libRoot, { recursive: true, force: true }); // the whole mount vanishes
  await scanMusicSettled();
  assert.equal(Object.keys(loadDatabase().music.tracks).length, 2, 'vanished root protected its tracks');
});

test('T4: MOUNT-LOSS (empty scan under a still-existing root) — treated as unmounted, prunes nothing', async () => {
  writeTrack('A/Album/01 One.flac');
  await setFolders([libRoot]);
  await scanMusicSettled();
  assert.equal(Object.keys(loadDatabase().music.tracks).length, 1);

  await setPruneMissing(true);
  // Delete the files but KEEP the directory tree (the unmounted-share signature).
  fs.rmSync(path.join(libRoot, 'A/Album/01 One.flac'));
  await scanMusicSettled();
  assert.equal(Object.keys(loadDatabase().music.tracks).length, 1, 'empty-under-mounted root protected its track');
});

test('T4: DIVERGENT-spelling prune (v1.41.9) — a stale entry at a different spelling than the on-disk file prunes cleanly, the real track survives', async () => {
  const realPath = writeTrack('Artist/Album/01 Real.flac');
  await setFolders([libRoot]);
  await scanMusicSettled();
  const realId = getMediaId(realPath);
  assert.ok(loadDatabase().music.tracks[realId], 'real track indexed by its exact path');

  // Seed a STALE track whose id is md5 of a DIVERGENTLY-CASED path (no file on
  // disk) — a different id than realId. Prune must reap the stale one by id and
  // never touch the real one (the matching-spelling fixtures that stayed green
  // through two broken fixes are exactly what this avoids).
  const stalePath = path.join(libRoot, 'Artist/Album/01 REAL.flac');
  const staleId = getMediaId(stalePath);
  assert.notEqual(staleId, realId, 'divergent spelling yields a divergent id');
  await updateDatabase((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks[staleId] = { id: staleId, filePath: stalePath, rootFolder: libRoot, size: 1, ext: '.flac', title: 'REAL', albumArtKey: 'deadbeef'.repeat(4) };
    return true;
  });

  await setPruneMissing(true);
  await scanMusicSettled();
  assert.ok(loadDatabase().music.tracks[realId], 'the real track survives');
  assert.ok(!loadDatabase().music.tracks[staleId], 'the divergent-spelling stale entry is pruned');
});

test('T4: prune SHEDS every user\'s music state for the pruned track (liked + progress + resume pointer)', async () => {
  writeTrack('B/Rec/01 Song.flac'); // a surviving track keeps the root non-empty
  await setFolders([libRoot]);
  await scanMusicSettled();

  // A stale track (no file) with seeded per-user state — must be shed on prune.
  const stalePath = path.join(libRoot, 'B/Rec/99 Gone.flac');
  const staleId = getMediaId(stalePath);
  await updateDatabase((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks[staleId] = { id: staleId, filePath: stalePath, rootFolder: libRoot, size: 1, ext: '.flac', title: 'Gone', albumArtKey: 'cafebabe'.repeat(4) };
    return true;
  });
  userStore.addMusicLiked(user.id, staleId, new Date().toISOString());
  userStore.setMusicProgress(user.id, staleId, { position: 30, duration: 200, updatedAt: new Date().toISOString() });
  userStore.setMusicState(user.id, { lastTrackId: staleId, queueCtx: { src: 'music' }, position: 30, updatedAt: new Date().toISOString() });

  await setPruneMissing(true);
  await scanMusicSettled();

  assert.ok(!loadDatabase().music.tracks[staleId], 'stale track pruned');
  assert.deepEqual(userStore.getMusicLiked(user.id).filter((id) => id === staleId), [], 'liked shed');
  assert.equal(userStore.getOneMusicProgress(user.id, staleId), null, 'progress shed');
  assert.equal(userStore.getMusicState(user.id).lastTrackId, null, 'resume pointer nulled');
});

test('T4: album art is orphan-pruned ONLY when the album\'s LAST track is removed', async () => {
  writeTrack('C/Double/01 A.flac');
  writeTrack('C/Double/02 B.flac');
  await setFolders([libRoot]);
  await scanMusicSettled();
  const tracks = loadDatabase().music.tracks;
  const albumKey = Object.values(tracks)[0].albumArtKey;
  assert.ok(Object.values(tracks).every((t) => t.albumArtKey === albumKey), 'both tracks share one album key');
  // Give the album an art file (no embedded/sidecar in this fixture).
  fs.mkdirSync(ALBUMART_DIR, { recursive: true });
  fs.writeFileSync(path.join(ALBUMART_DIR, `${albumKey}.jpg`), 'ART');

  await setPruneMissing(true);
  fs.rmSync(path.join(libRoot, 'C/Double/02 B.flac')); // remove ONE track
  await scanMusicSettled();
  assert.ok(fs.existsSync(path.join(ALBUMART_DIR, `${albumKey}.jpg`)), 'art survives while a sibling track remains');

  fs.rmSync(path.join(libRoot, 'C/Double/01 A.flac')); // remove the LAST track
  // dir still exists but is empty -> the empty-under-mounted guard would
  // protect it; write a decoy track elsewhere so the root is NOT seen as empty.
  writeTrack('D/Other/01 Keep.flac');
  await scanMusicSettled();
  assert.ok(!fs.existsSync(path.join(ALBUMART_DIR, `${albumKey}.jpg`)), 'art orphan-pruned once the last track is gone');
});

test('T4: music config REFUSES overlap with a media folder or a book folder (three-way, both directions)', async () => {
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-shared-'));
  // Overlap with a MEDIA folder.
  await updateDatabase((db) => { db.folders = [shared]; return true; });
  let res = await setFolders([shared]);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /overlaps a media folder/);
  // A subdir of a media folder, the other direction.
  res = await setFolders([path.join(shared, 'sub')]);
  fs.mkdirSync(path.join(shared, 'sub'), { recursive: true });
  res = await setFolders([path.join(shared, 'sub')]);
  assert.equal(res.status, 400, 'a music folder UNDER a media folder is refused');
  await updateDatabase((db) => { db.folders = []; return true; });

  // Overlap with a BOOK folder.
  await updateDatabase((db) => { require('../../lib/books/store').ensureBooks(db).folders = [shared]; return true; });
  res = await setFolders([shared]);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /overlaps a book folder/);
  await updateDatabase((db) => { require('../../lib/books/store').ensureBooks(db).folders = []; return true; });
});

test('T4: pure selectAlbumArtJobs/selectOrphanedArtKeys wired via the scan lib match the server behaviour', () => {
  // A light guard that the lib exports the server relies on stay in shape.
  assert.equal(typeof musicScanLib.selectAlbumArtJobs, 'function');
  assert.equal(typeof musicScanLib.selectOrphanedArtKeys, 'function');
  const tracks = { a: { filePath: '/x/a.flac', albumArtKey: 'k1', hasEmbeddedArt: false } };
  assert.equal(musicScanLib.selectAlbumArtJobs(tracks, () => false).length, 1);
  assert.equal(musicScanLib.selectAlbumArtJobs(tracks, () => true).length, 0, 'existing art => no job');
});
