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
function groupAlbums(tracks, sortKey) {
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
        addedAt: '',
      };
      byKey.set(key, g);
    }
    g.trackCount += 1;
    if (Number.isInteger(t.year) && (g.year === null || t.year < g.year)) g.year = t.year;
    if (typeof t.addedAt === 'string' && t.addedAt > g.addedAt) g.addedAt = t.addedAt;
    // Prefer a representative track that actually carries embedded art for artId.
    if (t.hasEmbeddedArt && !g._hasArtRep) { g.artId = t.id; g._hasArtRep = true; }
  }
  const out = [...byKey.values()];
  for (const g of out) delete g._hasArtRep;
  // Album grids sort by album title within the same artist as a stable tiebreak.
  const withArtistTiebreak = sortKey === 'title-asc' || !sortKey
    ? out.sort((a, b) => cmpStr(a.album, b.album) || cmpStr(a.artist, b.artist))
    : sortGroups(out, sortKey, 'album');
  return withArtistTiebreak;
}

// Group tracks into artists (album-artist preferred, else track artist). Each
// carries album + track counts plus `artIds`: up to 4 representative album-art
// track ids for the client's 2x2 mosaic card (v1.103). One id per distinct
// album, art-carrying albums first (so the mosaic front-loads real imagery over
// placeholders), then album-title order — deterministic regardless of scan or
// track-iteration order. RBAC is enforced by the caller filtering `tracks`
// before grouping, so `artIds` can never reference a track the viewer can't see.
// Deterministic album representative for the artist mosaic: prefer an embedded-
// art track; then the earliest disc/track; then the lexicographically-lowest id.
// Without the last two tiebreaks the representative was the FIRST art track SEEN,
// so a re-scan (different track-iteration order) could flip the chosen artId -
// changing the tile's /albumart URL and busting its cache (gate ADV-WARNING 1).
function isBetterAlbumRep(hasArt, sortVal, id, rep) {
  if (hasArt !== rep.hasArt) return hasArt;
  if (sortVal !== rep.sortVal) return sortVal < rep.sortVal;
  return String(id) < String(rep.artId);
}

function groupArtists(tracks, sortKey) {
  const byName = new Map();
  for (const t of tracks) {
    const name = (typeof t.albumArtist === 'string' && t.albumArtist) || (typeof t.artist === 'string' && t.artist) || '';
    let g = byName.get(name);
    if (!g) {
      g = { artist: name, albums: new Map(), trackCount: 0, addedAt: '' };
      byName.set(name, g);
    }
    g.trackCount += 1;
    if (typeof t.addedAt === 'string' && t.addedAt > g.addedAt) g.addedAt = t.addedAt;
    // Music redesign Slice 1: the artist's round-circle avatar (channel picture,
    // carried on projected library tracks - native tracks have none). Pick the
    // avatar of the lexicographically-lowest track id that has one, so a re-scan
    // (different iteration order) never flips the picture (the artId lesson).
    if (typeof t.avatarUrl === 'string' && t.avatarUrl
      && (g.avatarId === undefined || String(t.id) < g.avatarId)) {
      g.avatarUrl = t.avatarUrl;
      g.avatarId = String(t.id);
    }
    const key = store.albumKeyFor(t);
    const rep = g.albums.get(key);
    const hasArt = !!t.hasEmbeddedArt;
    const sortVal = albumSortValue(t);
    if (!rep) {
      g.albums.set(key, { album: typeof t.album === 'string' ? t.album : '', artId: t.id, hasArt: hasArt, sortVal: sortVal });
    } else if (isBetterAlbumRep(hasArt, sortVal, t.id, rep)) {
      rep.artId = t.id; rep.hasArt = hasArt; rep.sortVal = sortVal;
    }
  }
  const out = [...byName.values()].map((g) => ({
    artist: g.artist,
    albumCount: g.albums.size,
    trackCount: g.trackCount,
    addedAt: g.addedAt,
    avatarUrl: g.avatarUrl || '', // '' -> the client falls back to the album-art mosaic
    artIds: [...g.albums.values()]
      .sort((a, b) => (Number(b.hasArt) - Number(a.hasArt)) || cmpStr(a.album, b.album))
      .slice(0, 4)
      .map((a) => a.artId),
  }));
  return sortGroups(out, sortKey, 'artist');
}

// Shared ordering for the album/artist grid tabs. `nameField` is the group's
// display-name field ('album' or 'artist'). Keys mirror the client menu's
// grid-appropriate subset; unknown/empty keys fall back to name order so the
// endpoints' historical default (name-sorted) is preserved.
function sortGroups(groups, sortKey, nameField) {
  const list = groups.slice();
  switch (sortKey) {
    case 'newest':
      return list.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)) || cmpStr(a[nameField], b[nameField]));
    case 'oldest':
      return list.sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)) || cmpStr(a[nameField], b[nameField]));
    case 'tracks-desc':
      return list.sort((a, b) => (b.trackCount - a.trackCount) || cmpStr(a[nameField], b[nameField]));
    case 'title-desc':
      return list.sort((a, b) => cmpStr(b[nameField], a[nameField]));
    case 'year-desc':
      // Albums only (artists carry no year); artists fall through to name order.
      return list.sort((a, b) => ((b.year || 0) - (a.year || 0)) || cmpStr(a[nameField], b[nameField]));
    case 'title-asc':
    default:
      return list.sort((a, b) => cmpStr(a[nameField], b[nameField]));
  }
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
