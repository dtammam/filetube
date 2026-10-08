'use strict';

// [UNIT] v1.376.0 W6 (c) (plan docs/exec-plans/completed/2026-10-08-v1376-notify-podcasts-polish.md, W6): Music's art
// URLs carry the VERSION of the picture they point at, so the browser can never keep painting a stale cover.
//
//   - lib/music/artVersion.js: the version (the art file's mtime + size), the URL writers, and artFileFor (the ONE
//     resolution of the file /albumart serves - native album art, else the base media item's thumbnail).
//   - public/js/music.js albumArtSrc / musicArtUrl / musicArtV: the client writer appends `v=`; an explicit artUrl
//     (already versioned by the server) wins; no version = the URL as before.
//   - public/js/main.js musicArtSrc: Home's twin of albumArtSrc, locked byte-equal to it here.
// The payload wiring (every route that sends an art id) is test/integration/music-art-version.test.js.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const artVersion = require('../../lib/music/artVersion');

let tmp; let ALBUMART_DIR; let THUMBNAIL_DIR; let tracks; let metadata; let av;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-art-version-'));
  ALBUMART_DIR = path.join(tmp, '.albumart');
  THUMBNAIL_DIR = path.join(tmp, '.thumbnails');
  fs.mkdirSync(ALBUMART_DIR); fs.mkdirSync(THUMBNAIL_DIR);
  tracks = Object.create(null); metadata = Object.create(null);
  av = artVersion.createArtVersions({
    fs, path, ALBUMART_DIR, THUMBNAIL_DIR,
    readTrack: (id) => (Object.prototype.hasOwnProperty.call(tracks, id) ? tracks[id] : null),
    readMediaItem: (id) => (Object.prototype.hasOwnProperty.call(metadata, id) ? metadata[id] : null),
  });
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const setTime = (file, ms) => fs.utimesSync(file, ms / 1000, ms / 1000);

test('versionOfStat: mtime (ms, base 36) and size; nothing for no stat', () => {
  assert.strictEqual(artVersion.versionOfStat({ mtimeMs: 1791466671593.9, size: 12345 }), (1791466671593).toString(36) + '-' + (12345).toString(36));
  assert.strictEqual(artVersion.versionOfStat(null), '');
  assert.strictEqual(artVersion.versionOfStat(undefined), '');
});

test('withArtVersion / albumArtUrl: v joins with ? or &, encoded; no version leaves the URL as it was', () => {
  assert.strictEqual(artVersion.withArtVersion('/thumbnail/abc', 'k1-2'), '/thumbnail/abc?v=k1-2');
  assert.strictEqual(artVersion.withArtVersion('/albumart/abc?s=256', 'k1-2'), '/albumart/abc?s=256&v=k1-2');
  assert.strictEqual(artVersion.withArtVersion('/thumbnail/abc', ''), '/thumbnail/abc');
  assert.strictEqual(artVersion.withArtVersion(undefined, 'k'), undefined);
  assert.strictEqual(artVersion.albumArtUrl('a b/c', { size: 256, v: 'x&y' }), '/albumart/a%20b%2Fc?s=256&v=x%26y');
  assert.strictEqual(artVersion.albumArtUrl('id1'), '/albumart/id1');
  assert.strictEqual(artVersion.albumArtUrl('id1', { v: 'v1' }), '/albumart/id1?v=v1');
});

test('artFileFor: a native track -> its album art (.jpg, then .png); no art -> null (the placeholder); never the thumbnail', () => {
  tracks.t1 = { id: 't1', albumArtKey: 'k1' };
  tracks.t2 = { id: 't2', albumArtKey: 'k2' };
  tracks.t3 = { id: 't3', albumArtKey: null };
  fs.writeFileSync(path.join(ALBUMART_DIR, 'k1.jpg'), 'J');
  fs.writeFileSync(path.join(ALBUMART_DIR, 'k2.png'), 'P');
  fs.writeFileSync(path.join(THUMBNAIL_DIR, 't3.jpg'), 'T'); // a thumbnail never stands in for a native track
  assert.deepStrictEqual(av.artFileFor('t1'), { kind: 'album', file: path.join(ALBUMART_DIR, 'k1.jpg'), key: 'k1' });
  assert.deepStrictEqual(av.artFileFor('t2'), { kind: 'album', file: path.join(ALBUMART_DIR, 'k2.png'), key: 'k2' });
  assert.strictEqual(av.artFileFor('t3'), null);
  assert.strictEqual(av.versionOf('t3'), '');
});

test('artFileFor: a library audio item (and each ::c<n> chapter of it) -> the BASE item\'s thumbnail; a video or a thumbnail-less item -> null', () => {
  metadata.m1 = { id: 'm1', type: 'audio', hasThumbnail: true };
  metadata.v1 = { id: 'v1', type: 'video', hasThumbnail: true };
  metadata.m2 = { id: 'm2', type: 'audio', hasThumbnail: false };
  for (const id of ['m1', 'v1', 'm2']) fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'T');
  assert.deepStrictEqual(av.artFileFor('m1'), { kind: 'thumb', file: path.join(THUMBNAIL_DIR, 'm1.jpg'), baseId: 'm1' });
  assert.deepStrictEqual(av.artFileFor('m1::c3'), { kind: 'thumb', file: path.join(THUMBNAIL_DIR, 'm1.jpg'), baseId: 'm1' });
  assert.strictEqual(av.artFileFor('v1'), null);
  assert.strictEqual(av.artFileFor('m2'), null);
  assert.strictEqual(av.artFileFor('nope'), null);
  assert.strictEqual(av.artFileFor(''), null);
  assert.strictEqual(av.artFileFor('__proto__'), null);
});

test('versionOf follows the PICTURE: a rewritten thumbnail (the cover re-embed + re-extract) is a new version; an untouched one keeps its own', () => {
  metadata.m1 = { id: 'm1', type: 'audio', hasThumbnail: true };
  metadata.m2 = { id: 'm2', type: 'audio', hasThumbnail: true };
  const f1 = path.join(THUMBNAIL_DIR, 'm1.jpg');
  const f2 = path.join(THUMBNAIL_DIR, 'm2.jpg');
  fs.writeFileSync(f1, 'OWN-ART'); setTime(f1, 1_700_000_000_000);
  fs.writeFileSync(f2, 'OTHER'); setTime(f2, 1_700_000_000_000);
  const v1 = av.versionOf('m1');
  const v2 = av.versionOf('m2');
  assert.ok(v1, 'a version');
  fs.writeFileSync(f1, 'ALBUM-COVER!'); setTime(f1, 1_700_000_005_000);
  assert.notStrictEqual(av.versionOf('m1'), v1, 'the changed picture has a new version');
  assert.strictEqual(av.versionOf('m1::c1'), av.versionOf('m1'), 'every chapter of the file shares it');
  assert.strictEqual(av.versionOf('m2'), v2, 'an untouched picture keeps its version (its cache stays good)');
  // the same SIZE with a new mtime still moves (a same-size re-extract)
  const before = av.versionOf('m2');
  fs.writeFileSync(f2, 'OTHEX'); setTime(f2, 1_700_000_009_000);
  assert.notStrictEqual(av.versionOf('m2'), before);
});

test('memo: one stat per FILE for one payload; by id or by the track record, the same version as versionOf', () => {
  metadata.m1 = { id: 'm1', type: 'audio', hasThumbnail: true };
  fs.writeFileSync(path.join(THUMBNAIL_DIR, 'm1.jpg'), 'A');
  const m = av.memo();
  const first = m.ofId('m1');
  assert.strictEqual(first, av.versionOf('m1'));
  fs.writeFileSync(path.join(THUMBNAIL_DIR, 'm1.jpg'), 'ABCDEF');
  assert.strictEqual(m.ofId('m1'), first, 'memoized within the payload');
  assert.strictEqual(m.ofTrack({ id: 'm1::c2', source: 'library-chapter', hasEmbeddedArt: true }), first, 'the same file, by a chapter track record');
  assert.notStrictEqual(av.memo().ofId('m1'), first, 'a new payload reads again');
});

test('the by-track form follows THE rule: a native record -> its album art (.jpg, then .png), a projected one -> its base thumbnail; equal to versionOf(id)', () => {
  tracks.t1 = { id: 't1', albumArtKey: 'k1' };
  tracks.t2 = { id: 't2', albumArtKey: 'k2' };
  tracks.t3 = { id: 't3', albumArtKey: null };
  metadata.m1 = { id: 'm1', type: 'audio', hasThumbnail: true };
  metadata.m2 = { id: 'm2', type: 'audio', hasThumbnail: false };
  fs.writeFileSync(path.join(ALBUMART_DIR, 'k1.jpg'), 'J');
  fs.writeFileSync(path.join(ALBUMART_DIR, 'k2.png'), 'PNG!');
  fs.writeFileSync(path.join(THUMBNAIL_DIR, 'm1.jpg'), 'T');
  fs.writeFileSync(path.join(THUMBNAIL_DIR, 'm2.jpg'), 'T2'); // present on disk, but the item says no thumbnail
  fs.writeFileSync(path.join(THUMBNAIL_DIR, 't3.jpg'), 'T3'); // a thumbnail never stands in for a native track
  const m = av.memo();
  const cases = [
    [tracks.t1, 't1'], [tracks.t2, 't2'], [tracks.t3, 't3'],
    [{ id: 'm1', source: 'library', hasEmbeddedArt: true }, 'm1'],
    [{ id: 'm1::c4', source: 'library-chapter', hasEmbeddedArt: true }, 'm1::c4'],
    [{ id: 'm2', source: 'library', hasEmbeddedArt: false }, 'm2'],
  ];
  for (const [track, id] of cases) assert.strictEqual(m.ofTrack(track), av.versionOf(id), `${id}: by track == by id`);
  assert.ok(av.versionOf('t2'), 'a .png cover has a version');
  assert.strictEqual(av.versionOf('t3'), '');
  assert.strictEqual(av.versionOf('m2'), '');
  // a representative's id read through the payload's own list (no lookup) gives the same version
  assert.strictEqual(av.memo().ofId('t1', new Map([['t1', tracks.t1]])), av.versionOf('t1'));
});

// ---- the client writers ----------------------------------------------------------------------------------------

const musicPath = require.resolve('../../public/js/music.js');
const mainPath = require.resolve('../../public/js/main.js');
function load(p) {
  delete require.cache[p];
  const saved = global.window;
  global.window = undefined;
  try { return require(p); } finally { global.window = saved; delete require.cache[p]; }
}

test('music.js albumArtSrc: `v=` joins the size; no version = the v1.339 URL; musicArtUrl keeps an explicit (server-versioned) artUrl', () => {
  const M = load(musicPath);
  assert.strictEqual(M.albumArtSrc('t1', 54, 'k1-2'), '/albumart/t1?s=128&v=k1-2');
  assert.strictEqual(M.albumArtSrc('t1', 0, 'k1-2'), '/albumart/t1?v=k1-2');
  assert.strictEqual(M.albumArtSrc('t1', 54), '/albumart/t1?s=128');
  assert.strictEqual(M.albumArtSrc('t1', 54, ''), '/albumart/t1?s=128');
  assert.strictEqual(M.albumArtSrc('a b', 0, 'x&y'), '/albumart/a%20b?v=x%26y');
  assert.strictEqual(M.musicArtUrl('t1', '', 54, 'k'), '/albumart/t1?s=128&v=k');
  assert.strictEqual(M.musicArtUrl('t1', '/thumbnail/m1?v=k', 54, 'other'), '/thumbnail/m1?v=k', 'the explicit art wins as sent');
  assert.strictEqual(M.musicArtV({ artV: 'k' }), 'k');
  assert.strictEqual(M.musicArtV({}), '');
  assert.strictEqual(M.musicArtV(null), '');
});

test('main.js musicArtSrc (Home / search / Liked cards) writes the SAME URL as music.js albumArtSrc for every size and version', () => {
  const M = load(musicPath);
  const H = load(mainPath);
  // music.js takes a CSS box and picks the size; main.js is handed the size: compare at each allowlisted size
  const boxFor = { 128: 128, 256: 256, 512: 512 }; // at DPR 1 a box of exactly a size picks that size
  for (const id of ['t1', 'a b/c', 'm1::c2']) {
    for (const v of ['', 'k1-2', 'x&y']) {
      assert.strictEqual(H.musicArtSrc(id, 0, v), M.albumArtSrc(id, 0, v), `${id} ${v} full size`);
      for (const size of [128, 256, 512]) {
        const saved = global.window;
        global.window = { devicePixelRatio: 1, innerWidth: 1440 };
        try { assert.strictEqual(H.musicArtSrc(id, size, v), M.albumArtSrc(id, boxFor[size], v), `${id} ${v} ${size}`); } finally { global.window = saved; }
      }
    }
  }
});

test('the client song row, album card, artist mosaic and drill header carry the version they were sent', () => {
  const M = load(musicPath);
  assert.match(M.buildSongRowHtml({ id: 't1', artId: 'rep', artV: 'k9', title: 'Mr. Jambo', artist: 'Kyle Gordon' }, 0), /\/albumart\/rep\?s=128&amp;v=k9"/);
  assert.match(M.buildAlbumCardHtml({ albumKey: 'k', album: 'A', artist: 'B', artId: 'rep', artV: 'k9', trackCount: 2 }), /\/albumart\/rep\?s=\d+&amp;v=k9/);
  assert.match(M.buildArtistCardHtml({ artist: 'B', artIds: ['r1', 'r2'], artVs: ['v1', 'v2'], albumCount: 2, trackCount: 3 }), /\/albumart\/r1\?s=\d+&amp;v=v1"[\s\S]*\/albumart\/r2\?s=\d+&amp;v=v2"/);
});

// Gate r1 (qa W1 + adversary W2): the iPod menus build their art through music.js's ONE rule
// (musicArtUrl) and must hand it the version the payload carries - an album's artV, an
// artist's artVs[0], a track's artV - or a changed cover stays stale in iPod > Albums / Artists /
// Songs / Recently played / the cover drift. Driven with the REAL musicArtUrl.
test('iPod menus: every art site carries its version (albums, artists, songs, artist albums, recents, cover pool)', () => {
  const M = load(musicPath);
  const SK = load(require.resolve('../../public/js/music-skins.js'));
  const art = M.musicArtUrl;
  assert.strictEqual(SK.menuAlbumItems([{ album: 'A', artId: 'al1', artV: 'k1-2s' }], art)[0].art, '/albumart/al1?v=k1-2s');
  assert.strictEqual(SK.menuArtistItems([{ artist: 'R', artIds: ['ar1', 'ar2'], artVs: ['v1', 'v2'] }], art)[0].art, '/albumart/ar1?v=v1');
  const tracks = [{ id: 't1', artId: 'al1', artV: 'kv', title: 'S', artist: 'R', album: 'A', albumKey: 'R\u0000A', hasArt: true }];
  assert.strictEqual(SK.menuSongItems(tracks, art)[0].art, '/albumart/al1?v=kv');
  assert.strictEqual(SK.menuArtistAlbumItems(tracks, { key: 'R' }, art).map((i) => i.art).filter(Boolean)[0], '/albumart/al1?v=kv');
  assert.strictEqual(SK.menuRecentArtistItems(tracks, art)[0].art, '/albumart/al1?v=kv');
  assert.strictEqual(SK.menuRecentAlbumItems(tracks, art)[0].art, '/albumart/al1?v=kv');
  const pool = SK.menuCoverPool(tracks, art);
  assert.ok(pool.length > 0 && pool.every((u) => /\?v=kv$/.test(u)), 'the cover drift pool: ' + JSON.stringify(pool));
  // No version sent (an older cached payload) = the URL as before; an explicit artUrl is used as sent.
  assert.strictEqual(SK.menuAlbumItems([{ album: 'A', artId: 'al1' }], art)[0].art, '/albumart/al1');
  assert.strictEqual(SK.menuSongItems([{ id: 'm', artUrl: '/thumbnail/m?v=z', artV: 'other' }], art)[0].art, '/thumbnail/m?v=z');
});
