'use strict';

// [UNIT] v1.339 (L1, M2): the client half of sized + de-duplicated album art. Every
// music art builder asks /albumart for the rendition fitting its CSS box at the
// (capped) DPR, and keys the URL on the server's shared `artId` (one URL per cover),
// falling back to the track id. The server allowlist and the client size set are the
// same list (a size the server does not know would silently serve the full file).

const { test } = require('node:test');
const assert = require('node:assert');

const musicPath = require.resolve('../../public/js/music.js');
function load(win) {
  delete require.cache[musicPath];
  const saved = global.window;
  global.window = win;
  try { return require(musicPath); } finally { global.window = saved; delete require.cache[musicPath]; }
}
const M = load(undefined);

test('the client size set IS the server allowlist', () => {
  assert.deepEqual(M.MUSIC_ART_SIZES, require('../../lib/music/artRendition').ART_RENDITION_SIZES.slice());
});

test('musicArtSize: smallest rendition covering the box at min(DPR, 2); 0 = full file', () => {
  assert.equal(M.MUSIC_ART_DPR_CAP, 2);
  assert.equal(M.musicArtSize(54, 1), 128);
  assert.equal(M.musicArtSize(54, 3), 128, 'a row thumb at DPR 3 (capped to 2: 108px) -> 128');
  assert.equal(M.musicArtSize(120, 3), 256, 'a phone card (240px at the cap) -> 256');
  assert.equal(M.musicArtSize(216, 1), 256, 'a wide desktop card at DPR 1 -> 256');
  assert.equal(M.musicArtSize(216, 2), 512, 'at DPR 2 -> 512');
  assert.equal(M.musicArtSize(220, 3), 512, 'the drill header at the cap -> 512');
  assert.equal(M.musicArtSize(400, 2), 0, 'bigger than the largest rendition -> the original');
  assert.equal(M.musicArtSize(0, 2), 0);
  assert.equal(M.musicArtSize(128, 1), 128, 'exactly a size -> that size (>=, not >)');
  assert.equal(M.musicArtSize(129, 1), 256);
});

test('musicArtSize reads window.devicePixelRatio when no DPR is passed', () => {
  const W = load({ devicePixelRatio: 1, innerWidth: 390 });
  const saved = global.window;
  global.window = { devicePixelRatio: 1, innerWidth: 390 };
  try { assert.equal(W.musicArtSize(120), 128); global.window.devicePixelRatio = 3; assert.equal(W.musicArtSize(120), 256); } finally { global.window = saved; }
});

test('musicArtCardPx: a phone grid cell vs a wide desktop cell', () => {
  const saved = global.window;
  try {
    global.window = { innerWidth: 390 }; assert.equal(M.musicArtCardPx(), 120);
    global.window = { innerWidth: 1440 }; assert.equal(M.musicArtCardPx(), 216);
  } finally { global.window = saved; }
});

test('albumArtSrc / musicArtUrl: sized query only for a box, encoded id, explicit art wins', () => {
  assert.equal(M.albumArtSrc('a b/c', 54), '/albumart/a%20b%2Fc?s=128');
  assert.equal(M.albumArtSrc('x'), '/albumart/x', 'no box -> the full-size file');
  assert.equal(M.musicArtUrl('t1', '', 54), '/albumart/t1?s=128');
  assert.equal(M.musicArtUrl('t1', '/thumbnail/v1', 54), '/thumbnail/v1', 'a projected/listen track keeps its own art');
  assert.equal(M.musicArtUrl('t1'), '/albumart/t1', 'the historical two-arg call is unchanged (full size)');
});

test('musicArtId: the shared artId, else the track id', () => {
  assert.equal(M.musicArtId({ id: 't2', artId: 'rep' }), 'rep');
  assert.equal(M.musicArtId({ id: 't2', artId: '' }), 't2');
  assert.equal(M.musicArtId({ id: 't2' }), 't2');
  assert.equal(M.musicArtId(null), '');
});

test('every track-art builder keys on artId - a 12-track album is ONE URL per surface', () => {
  const album = Array.from({ length: 12 }, (_, i) => ({ id: 'trk' + i, artId: 'rep', title: 'S' + i, artist: 'A', album: 'Al' }));
  const srcs = (html) => [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
  const rows = album.map((t, i) => M.buildSongRowHtml(t, i)).join('');
  assert.deepEqual([...new Set(srcs(rows))], ['/albumart/rep?s=128'], 'song rows: one URL');
  const jump = album.map(M.buildJumpBackTileHtml).join('');
  assert.equal(new Set(srcs(jump)).size, 1, 'jump-back tiles: one URL');
  assert.match(srcs(jump)[0], /^\/albumart\/rep\?s=\d+$/);
  const recent = album.map(M.buildRecentArtistTileHtml).join('');
  assert.equal(new Set(srcs(recent)).size, 1, 'recent-artist tiles: one URL');
  assert.match(M.buildDrillHeaderHtml({ type: 'album', label: 'Al' }, album), /src="\/albumart\/rep\?s=\d+"/, 'drill header');
  assert.match(M.buildStickyBarHtml({ type: 'album', label: 'Al' }, album), /src="\/albumart\/rep\?s=128"/, 'sticky bar');
  // An older payload without artId still renders per-track art (never an empty URL).
  assert.match(M.buildSongRowHtml({ id: 'solo', title: 'x' }, 0), /src="\/albumart\/solo\?s=128"/);
});

test('the pocket menus (music-skins.js) key track art on artId too; explicit art still wins', () => {
  const skins = require('../../public/js/music-skins.js');
  const artFor = (id, explicit) => explicit || ('/albumart/' + encodeURIComponent(id));
  const tracks = [
    { id: 'n1', artId: 'rep', title: 'A', artist: 'X', albumKey: 'k', hasArt: true },
    { id: 'n2', artId: 'rep', title: 'B', artist: 'X', albumKey: 'k', hasArt: true },
    { id: 'lib::c1', title: 'C', artist: 'Y', albumKey: 'k2', artUrl: '/thumbnail/lib', hasArt: true },
  ];
  assert.deepEqual(skins.menuSongItems(tracks, artFor).map((r) => r.art), ['/albumart/rep', '/albumart/rep', '/thumbnail/lib']);
  assert.deepEqual(skins.menuSongItems(tracks, artFor).map((r) => r.id), ['n1', 'n2', 'lib::c1'], 'the row id stays the TRACK id (only the art is shared)');
  assert.equal(skins.menuArtistAlbumItems(tracks.slice(0, 2), { key: 'X' }, artFor)[0].art, '/albumart/rep');
  assert.equal(skins.menuRecentArtistItems(tracks.slice(0, 1), artFor)[0].art, '/albumart/rep');
  assert.deepEqual(skins.menuCoverPool(tracks.slice(0, 2), artFor, () => 0), ['/albumart/rep']);
});
