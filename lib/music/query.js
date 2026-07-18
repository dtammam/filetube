'use strict';

// v1.44 T6 (music): pure browse/search/sort/group helpers over db.music.tracks,
// unit-tested on their own (no db, no ffmpeg). Mirrors lib/videoQuery.js's
// posture and reuses its seeded-RNG/shuffle/pagination primitives so a music
// `sort=random` shuffle is the same deterministic, ctx-reproducible shuffle a
// video list uses (the v1.40 context-aware next/prev contract).

const videoQuery = require('./../videoQuery');
const store = require('./store');

// Case-insensitive string compare; empty/absent values sort LAST so untitled
// oddities never lead a list.
function cmpStr(a, b) {
  const x = typeof a === 'string' ? a.trim() : '';
  const y = typeof b === 'string' ? b.trim() : '';
  if (x === '' && y === '') return 0;
  if (x === '') return 1;
  if (y === '') return -1;
  return x.localeCompare(y, undefined, { sensitivity: 'base' });
}

// Within-album ordering: disc-major, then track. Missing disc defaults to 1,
// missing track to 0 (leads the album — better than trailing for a stray
// untracked file).
function albumSortValue(t) {
  const disc = Number.isInteger(t && t.discNo) ? t.discNo : 1;
  const track = Number.isInteger(t && t.trackNo) ? t.trackNo : 0;
  return disc * 1000 + track;
}

function matchesSearch(track, search) {
  if (!search) return true;
  const s = String(search).toLowerCase();
  return [track.title, track.artist, track.album, track.albumArtist]
    .some((f) => typeof f === 'string' && f.toLowerCase().includes(s));
}

// True when a track belongs to the artist `name` (either the track artist or
// the album artist — a compilation track by "X" on a "Various Artists" album
// surfaces under BOTH, which is what a user expects when browsing by artist).
function matchesArtist(track, name) {
  if (!name) return true;
  return (typeof track.artist === 'string' && track.artist === name)
    || (typeof track.albumArtist === 'string' && track.albumArtist === name);
}

function matchesAlbum(track, albumKey) {
  if (!albumKey) return true;
  return store.albumKeyFor(track) === albumKey;
}

function matchesRoot(track, root) {
  if (!root) return true;
  const fp = track.filePath;
  if (typeof fp !== 'string') return false;
  const sep = root.endsWith('/') ? root : root + '/';
  return fp === root || fp.startsWith(sep);
}

// Sort keys mirror the client's music sort menu. `rng` (a seeded RNG) drives
// the 'random' case so the order is reproducible from the ctx seed.
function sortTracks(tracks, sortKey, rng) {
  const list = tracks.slice();
  switch (sortKey) {
    case 'oldest':
      return list.sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
    case 'title-asc':
      return list.sort((a, b) => cmpStr(a.title, b.title));
    case 'title-desc':
      return list.sort((a, b) => cmpStr(b.title, a.title));
    case 'artist-asc':
      return list.sort((a, b) => cmpStr(a.albumArtist || a.artist, b.albumArtist || b.artist)
        || cmpStr(a.album, b.album) || (albumSortValue(a) - albumSortValue(b)));
    case 'album-asc':
      return list.sort((a, b) => cmpStr(a.album, b.album) || (albumSortValue(a) - albumSortValue(b)));
    case 'duration-desc':
      return list.sort((a, b) => (Number(b.durationSec) || 0) - (Number(a.durationSec) || 0));
    case 'duration-asc':
      return list.sort((a, b) => (Number(a.durationSec) || 0) - (Number(b.durationSec) || 0));
    case 'album-order':
      // Album/artist context: disc/track order, then album, then artist.
      return list.sort((a, b) => cmpStr(a.albumArtist || a.artist, b.albumArtist || b.artist)
        || cmpStr(a.album, b.album) || (albumSortValue(a) - albumSortValue(b)));
    case 'random':
      return videoQuery.fisherYatesShuffle(list, rng);
    case 'newest':
    default:
      return list.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
  }
}

// Group tracks into albums. Each album carries a representative track id
// (`artId`) so the client can request `/albumart/<artId>`, plus the album art
// key, counts, and a display year (the min non-null year seen). Albums are
// returned sorted by album title.
function groupAlbums(tracks) {
  const byKey = new Map();
  for (const t of tracks) {
    const key = store.albumKeyFor(t);
    let g = byKey.get(key);
    if (!g) {
      g = {
        albumKey: key,
        album: typeof t.album === 'string' ? t.album : '',
        artist: (typeof t.albumArtist === 'string' && t.albumArtist) || (typeof t.artist === 'string' && t.artist) || '',
        albumArtKey: typeof t.albumArtKey === 'string' ? t.albumArtKey : null,
        artId: t.id,
        trackCount: 0,
        year: null,
      };
      byKey.set(key, g);
    }
    g.trackCount += 1;
    if (Number.isInteger(t.year) && (g.year === null || t.year < g.year)) g.year = t.year;
    // Prefer a representative track that actually carries embedded art for artId.
    if (t.hasEmbeddedArt && !g._hasArtRep) { g.artId = t.id; g._hasArtRep = true; }
  }
  const out = [...byKey.values()];
  for (const g of out) delete g._hasArtRep;
  return out.sort((a, b) => cmpStr(a.album, b.album) || cmpStr(a.artist, b.artist));
}

// Group tracks into artists (album-artist preferred, else track artist). Each
// carries album + track counts. Sorted by artist name.
function groupArtists(tracks) {
  const byName = new Map();
  for (const t of tracks) {
    const name = (typeof t.albumArtist === 'string' && t.albumArtist) || (typeof t.artist === 'string' && t.artist) || '';
    let g = byName.get(name);
    if (!g) {
      g = { artist: name, albumKeys: new Set(), trackCount: 0 };
      byName.set(name, g);
    }
    g.trackCount += 1;
    g.albumKeys.add(store.albumKeyFor(t));
  }
  return [...byName.values()]
    .map((g) => ({ artist: g.artist, albumCount: g.albumKeys.size, trackCount: g.trackCount }))
    .sort((a, b) => cmpStr(a.artist, b.artist));
}

module.exports = {
  cmpStr,
  albumSortValue,
  matchesSearch,
  matchesArtist,
  matchesAlbum,
  matchesRoot,
  sortTracks,
  groupAlbums,
  groupArtists,
};
