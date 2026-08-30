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

test('v1.103: groupArtists artIds — one per album, art-carrying first, title tiebreak, capped at 4', () => {
  // Artist "M" with 5 albums: only "B" and "D" carry embedded art.
  const mk = (id, album, hasArt) => trk({ id, artist: 'M', albumArtist: 'M', album, hasEmbeddedArt: !!hasArt });
  const tracks = [
    mk('a1', 'E', false), mk('a2', 'A', false), mk('a3', 'D', true),
    mk('a4', 'C', false), mk('a5', 'B', true),
    // a second track in album A with art must NOT create a second A tile.
    mk('a6', 'A', true),
  ];
  const m = q.groupArtists(tracks).find((a) => a.artist === 'M');
  assert.equal(m.albumCount, 5, '5 distinct albums');
  assert.equal(m.artIds.length, 4, 'mosaic capped at 4 tiles');
  // Art-carrying albums (B->a5, D->a3, and A upgraded to a6) lead, ordered by
  // album title (A, B, D), then the first non-art album by title (C->a4).
  assert.deepEqual(m.artIds, ['a6', 'a5', 'a3', 'a4']);
});

test('friction: sortTracks release-newest/oldest orders by releaseDate (addedAt tiebreak in the 0 bucket)', () => {
  const t = (id, releaseDate, addedAt) => trk({ id, releaseDate, addedAt });
  // THREE 0-releaseDate tracks whose INPUT order (e,f,g) matches NEITHER the DESC
  // nor the ASC addedAt tiebreak - so a dropped tiebreak (a stable sort keeps
  // input order) reds BOTH directions, not just one (adversarial: two 0-items
  // let one direction pass on stable-sort coincidence).
  const list = [
    t('a', 1000, '2026-01-01'), t('b', 3000, '2026-01-01'),
    t('e', 0, '2026-03-01'), t('f', 0, '2026-01-01'), t('g', 0, '2026-02-01'),
  ];
  assert.deepStrictEqual(q.sortTracks(list, 'release-newest').map((x) => x.id), ['b', 'a', 'e', 'g', 'f'],
    'newest release first; the 0-bucket by addedAt DESC (e, g, f) - NOT input order');
  assert.deepStrictEqual(q.sortTracks(list, 'release-oldest').map((x) => x.id), ['f', 'g', 'e', 'a', 'b'],
    'oldest release first; the 0-bucket by addedAt ASC (f, g, e) - NOT input order');
});

test('redesign S1: groupArtists emits the channel avatar for a channel-artist, "" for a native-only artist', () => {
  const AV = 'https://yt3.example/nestalgia.jpg';
  const chan = [
    trk({ id: 'n1', artist: 'NESTALGIA', albumArtist: 'NESTALGIA', album: '', avatarUrl: AV }),
    trk({ id: 'n2', artist: 'NESTALGIA', albumArtist: 'NESTALGIA', album: '', avatarUrl: AV }),
  ];
  const native = [trk({ id: 'z1', artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'The Wall' })]; // no avatarUrl
  const artists = q.groupArtists(chan.concat(native));
  assert.strictEqual(artists.find((a) => a.artist === 'NESTALGIA').avatarUrl, AV, 'channel artist -> its avatar');
  assert.strictEqual(artists.find((a) => a.artist === 'Pink Floyd').avatarUrl, '', 'native-only artist -> "" (client falls back to the mosaic)');
});

test('redesign S1: the artist avatar is order-INVARIANT (lowest-id track wins, so a re-scan never flips the picture)', () => {
  const A1 = 'https://yt3.example/a1.jpg';
  const A2 = 'https://yt3.example/a2.jpg'; // a stray differing avatar on a higher id
  const tracks = [
    trk({ id: 'b2', artist: 'C', albumArtist: 'C', avatarUrl: A2 }),
    trk({ id: 'a1', artist: 'C', albumArtist: 'C', avatarUrl: A1 }),
  ];
  const base = q.groupArtists(tracks).find((a) => a.artist === 'C').avatarUrl;
  assert.strictEqual(base, A1, 'the lowest-id track (a1) provides the avatar');
  const rev = q.groupArtists([tracks[1], tracks[0]]).find((a) => a.artist === 'C').avatarUrl;
  assert.strictEqual(rev, A1, 'a shuffled re-scan yields the identical avatar (deterministic)');
});

test('redesign S1: a REAL avatar wins over a lower-id track carrying "" (binds the empty-string guard)', () => {
  // The reachable case: two tracks share an artist name; the LOWER-id one is a
  // projected library item whose channel has no avatar (''), the higher-id one
  // has a real avatar. The `&& t.avatarUrl` guard must skip the '' so the real
  // avatar wins - dropping it lets the lower id claim the slot with '' (mosaic
  // fallback) and the circle silently vanishes.
  const REAL = 'https://yt3.example/real.jpg';
  const tracks = [
    trk({ id: 'aaa', artist: 'Shared', albumArtist: 'Shared', avatarUrl: '' }),
    trk({ id: 'zzz', artist: 'Shared', albumArtist: 'Shared', avatarUrl: REAL }),
  ];
  assert.strictEqual(q.groupArtists(tracks).find((a) => a.artist === 'Shared').avatarUrl, REAL,
    'the real avatar wins even though the LOWER id carries "" (drop the && t.avatarUrl guard -> this reds)');
});

test('v1.103 (gate ADV-W1): artIds are order-INVARIANT - a re-scan (shuffled tracks) yields identical ids, incl. the within-album representative', () => {
  // Album "One" has TWO embedded-art tracks (t2, t5) at different disc/track
  // positions; the representative must be stable (earliest disc/track -> t2),
  // never "first seen". Album "Two" also has two art tracks (same track no ->
  // id tiebreak).
  const mk = (id, album, hasArt, trackNo) => trk({ id, artist: 'A', albumArtist: 'A', album, hasEmbeddedArt: !!hasArt, trackNo, discNo: 1 });
  const tracks = [
    mk('t2', 'One', true, 1), mk('t5', 'One', true, 3), mk('t9', 'One', false, 2),
    mk('b7', 'Two', true, 1), mk('b3', 'Two', true, 1),
  ];
  const base = q.groupArtists(tracks).find((a) => a.artist === 'A').artIds;
  // Both albums carry art, so mosaic order = album title: One (rep t2, track 1 <
  // track 3) then Two (rep b3, track tie -> id 'b3' < 'b7').
  assert.deepEqual(base, ['t2', 'b3'], 'stable representatives, earliest disc/track then lowest id');
  // Every permutation must produce the identical artIds.
  const perms = [
    [...tracks].reverse(),
    [tracks[4], tracks[0], tracks[3], tracks[2], tracks[1]],
    [tracks[1], tracks[3], tracks[4], tracks[0], tracks[2]],
  ];
  for (const p of perms) {
    const got = q.groupArtists(p).find((a) => a.artist === 'A').artIds;
    assert.deepEqual(got, base, 'artIds are identical regardless of input/scan order');
  }
});

test('v1.103: groupArtists artIds empty-safe + single-album artist', () => {
  const solo = q.groupArtists([trk({ id: 's1', artist: 'Solo', albumArtist: 'Solo', album: 'Only' })])
    .find((a) => a.artist === 'Solo');
  assert.deepEqual(solo.artIds, ['s1'], 'one album -> one tile');
  assert.deepEqual(q.groupArtists([]), [], 'no tracks -> no artists');
});

test('v1.103: groupAlbums/groupArtists honor grid sort keys (name default preserved)', () => {
  const mk = (id, artist, album, addedAt, hasArt) => trk({ id, artist, albumArtist: artist, album, addedAt, hasEmbeddedArt: !!hasArt, year: 2000 });
  const tracks = [
    mk('z1', 'Zed', 'Zeta', '2026-01-01T00:00:00Z'),
    mk('a1', 'Ann', 'Alpha', '2026-03-01T00:00:00Z'),
    mk('a2', 'Ann', 'Alpha', '2026-03-02T00:00:00Z'), // Alpha has 2 tracks
    mk('m1', 'Moe', 'Mid', '2026-02-01T00:00:00Z'),
  ];
  // Default (no sort) = album/artist name order, unchanged from pre-v1.103.
  assert.deepEqual(q.groupAlbums(tracks).map((a) => a.album), ['Alpha', 'Mid', 'Zeta']);
  assert.deepEqual(q.groupArtists(tracks).map((a) => a.artist), ['Ann', 'Moe', 'Zed']);
  // newest = most-recent addedAt first (Alpha 03-02, Mid 02-01, Zeta 01-01).
  assert.deepEqual(q.groupAlbums(tracks, 'newest').map((a) => a.album), ['Alpha', 'Mid', 'Zeta']);
  assert.deepEqual(q.groupArtists(tracks, 'newest').map((a) => a.artist), ['Ann', 'Moe', 'Zed']);
  // title-desc = reverse name.
  assert.deepEqual(q.groupAlbums(tracks, 'title-desc').map((a) => a.album), ['Zeta', 'Mid', 'Alpha']);
  assert.deepEqual(q.groupArtists(tracks, 'title-desc').map((a) => a.artist), ['Zed', 'Moe', 'Ann']);
  // tracks-desc = most tracks first (Alpha has 2, tiebreak by name).
  assert.equal(q.groupAlbums(tracks, 'tracks-desc')[0].album, 'Alpha');
  assert.equal(q.groupArtists(tracks, 'tracks-desc')[0].artist, 'Ann');
});
