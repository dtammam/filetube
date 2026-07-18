'use strict';

// [UNIT] v1.44 T6 — lib/music/query.js: pure browse/search/sort/group helpers.

const { test } = require('node:test');
const assert = require('node:assert');
const q = require('../../lib/music/query');

function trk(o) {
  return Object.assign({ id: 'x', title: '', artist: '', album: '', albumArtist: '', trackNo: null, discNo: null, durationSec: 0, year: null, addedAt: '2026-01-01T00:00:00.000Z', filePath: '/m/x.flac', albumArtKey: 'k' }, o);
}

test('T6: matchesSearch matches title/artist/album/albumArtist case-insensitively', () => {
  const t = trk({ title: 'Mother', artist: 'Pink Floyd', album: 'The Wall' });
  assert.ok(q.matchesSearch(t, 'moth'));
  assert.ok(q.matchesSearch(t, 'PINK'));
  assert.ok(q.matchesSearch(t, 'wall'));
  assert.ok(!q.matchesSearch(t, 'zeppelin'));
  assert.ok(q.matchesSearch(t, ''), 'empty search matches all');
});

test('T6: matchesArtist matches track artist OR album artist', () => {
  const t = trk({ artist: 'Track Guy', albumArtist: 'Various Artists' });
  assert.ok(q.matchesArtist(t, 'Track Guy'));
  assert.ok(q.matchesArtist(t, 'Various Artists'));
  assert.ok(!q.matchesArtist(t, 'Nobody'));
});

test('T6: matchesRoot is a path-prefix (folder itself or under it)', () => {
  const t = trk({ filePath: '/m/A/Album/01.flac' });
  assert.ok(q.matchesRoot(t, '/m/A'));
  assert.ok(q.matchesRoot(t, '/m/A/Album/01.flac'));
  assert.ok(!q.matchesRoot(t, '/m/B'));
  assert.ok(!q.matchesRoot(t, '/m/A/Alb'), 'prefix must be a path boundary, not a substring');
});

test('T6: sortTracks — newest/oldest by addedAt, title asc/desc, album-order by disc+track', () => {
  const a = trk({ id: 'a', title: 'Bravo', addedAt: '2026-03-01T00:00:00Z', album: 'X', discNo: 1, trackNo: 2 });
  const b = trk({ id: 'b', title: 'Alpha', addedAt: '2026-01-01T00:00:00Z', album: 'X', discNo: 1, trackNo: 1 });
  const c = trk({ id: 'c', title: 'Charlie', addedAt: '2026-02-01T00:00:00Z', album: 'X', discNo: 2, trackNo: 1 });
  assert.deepEqual(q.sortTracks([a, b, c], 'newest').map((t) => t.id), ['a', 'c', 'b']);
  assert.deepEqual(q.sortTracks([a, b, c], 'oldest').map((t) => t.id), ['b', 'c', 'a']);
  assert.deepEqual(q.sortTracks([a, b, c], 'title-asc').map((t) => t.id), ['b', 'a', 'c']);
  assert.deepEqual(q.sortTracks([a, b, c], 'title-desc').map((t) => t.id), ['c', 'a', 'b']);
  // album-order: disc 1 track 1, disc 1 track 2, disc 2 track 1
  assert.deepEqual(q.sortTracks([a, b, c], 'album-order').map((t) => t.id), ['b', 'a', 'c']);
});

test('T6: sortTracks random is a pure permutation (seeded rng)', () => {
  const items = Array.from({ length: 8 }, (_, i) => trk({ id: `t${i}` }));
  const seeded = require('../../lib/videoQuery').createSeededRng(42);
  const out = q.sortTracks(items, 'random', seeded);
  assert.equal(out.length, 8);
  assert.deepEqual(out.map((t) => t.id).sort(), items.map((t) => t.id).sort(), 'no items lost/duped');
});

test('T6: groupAlbums groups by album key, counts tracks, picks min year + a representative id', () => {
  const t1 = trk({ id: 't1', artist: 'A', album: 'One', year: 2001 });
  const t2 = trk({ id: 't2', artist: 'A', album: 'One', year: 1999, hasEmbeddedArt: true });
  const t3 = trk({ id: 't3', artist: 'A', album: 'Two', year: 2010 });
  const albums = q.groupAlbums([t1, t2, t3]);
  assert.equal(albums.length, 2);
  const one = albums.find((a) => a.album === 'One');
  assert.equal(one.trackCount, 2);
  assert.equal(one.year, 1999, 'min year');
  assert.equal(one.artId, 't2', 'embedded-art track is the art representative');
  assert.equal(one.artist, 'A');
});

test('T6: groupArtists counts distinct albums + tracks per artist (album-artist preferred)', () => {
  const t1 = trk({ artist: 'X', albumArtist: 'X', album: 'A1' });
  const t2 = trk({ artist: 'X', albumArtist: 'X', album: 'A2' });
  const t3 = trk({ artist: 'Track Guy', albumArtist: 'VA', album: 'Comp' });
  const artists = q.groupArtists([t1, t2, t3]);
  const x = artists.find((a) => a.artist === 'X');
  assert.equal(x.albumCount, 2);
  assert.equal(x.trackCount, 2);
  const va = artists.find((a) => a.artist === 'VA');
  assert.equal(va.trackCount, 1, 'grouped under album artist, not track artist');
});
