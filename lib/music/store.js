'use strict';

// v1.44 T1 (music): the `db.music` namespace owner -- backfill, item shape,
// and prune policy. Mirrors lib/books/store.js's namespace discipline exactly
// (which itself mirrors lib/ytdlp/store.js): nothing in this file ever reads
// or writes `db.folders`/`db.metadata`/`db.books`, and nothing outside the
// music module writes `db.music` -- so `updateDatabase` round-trips untouched
// keys verbatim and the media scan's Phase-2 merge (the 5-strike persist-gate
// class) can never clobber a music field.
//
// HARD INVARIANT: `db.music.folders` is a SEPARATE root list from
// `db.folders` AND `db.books.folders`. The config route rejects overlap with
// EITHER at save time (three-way, both directions); this module never consults
// the other lists.

// Field/record-separator for the album grouping key: U+241F (SYMBOL FOR UNIT
// SEPARATOR) -- a printable glyph, never a raw control byte (the v1.37.5
// lesson) and never a character a real artist/album name would contain, so it
// can't collide two distinct (artist, album) pairs into one group.
const ALBUM_KEY_SEP = '␟';

/**
 * Namespace backfill -- the ensureBooks posture verbatim: a missing/broken
 * namespace (or sub-key) is replaced with a fresh, well-formed value; a
 * present one is left completely untouched (never a shared/frozen reference).
 * Mutates IN MEMORY on every read; persists on whatever write next touches
 * the db. Use ONLY inside an updateDatabase mutator or against a private
 * loadDatabase() copy -- read paths (GET routes) use readMusic instead.
 */
function ensureMusic(db) {
  if (!db.music || typeof db.music !== 'object' || Array.isArray(db.music)) {
    db.music = { folders: [], tracks: {}, settings: {} };
    return db.music;
  }
  const ns = db.music;
  if (!Array.isArray(ns.folders)) ns.folders = [];
  if (!ns.tracks || typeof ns.tracks !== 'object' || Array.isArray(ns.tracks)) ns.tracks = {};
  if (!ns.settings || typeof ns.settings !== 'object' || Array.isArray(ns.settings)) ns.settings = {};
  return ns;
}

/**
 * The NON-MUTATING read view for GET routes (the readBooks invariant):
 * `ensureMusic` backfills BY MUTATING its argument, which violates the read-
 * cache invariant when called against getCachedDatabase(). Read paths use
 * this instead -- same defensive per-key shape, zero writes to the passed
 * object.
 */
function readMusic(db) {
  const ns = db && db.music;
  if (!ns || typeof ns !== 'object' || Array.isArray(ns)) {
    return { folders: [], tracks: {}, settings: {} };
  }
  return {
    folders: Array.isArray(ns.folders) ? ns.folders : [],
    tracks: ns.tracks && typeof ns.tracks === 'object' && !Array.isArray(ns.tracks) ? ns.tracks : {},
    settings: ns.settings && typeof ns.settings === 'object' && !Array.isArray(ns.settings) ? ns.settings : {},
  };
}

/**
 * Pure prune policy -- the selectPrunableBookIds mount-loss posture verbatim:
 * a track is prunable ONLY when (a) the `pruneMissing` setting is on, (b) its
 * file did not survive this walk, AND (c) its root folder is NOT in
 * `missingRoots` (an unmounted/vanished root prunes NOTHING under it -- the
 * absence of a mount is never the deletion of a library).
 * @param {Object<string, object>} tracks db.music.tracks
 * @param {Set<string>|string[]} survivingIds ids the current walk found
 * @param {{missingRoots?: (Set<string>|string[]), pruneMissing?: boolean}} opts
 * @returns {string[]} ids safe to prune
 */
function selectPrunableTrackIds(tracks, survivingIds, { missingRoots, pruneMissing, erroredDirs } = {}) {
  if (pruneMissing !== true) return [];
  const surviving = survivingIds instanceof Set ? survivingIds : new Set(Array.isArray(survivingIds) ? survivingIds : []);
  const missing = missingRoots instanceof Set ? missingRoots : new Set(Array.isArray(missingRoots) ? missingRoots : []);
  const errored = erroredDirs instanceof Set ? [...erroredDirs] : (Array.isArray(erroredDirs) ? erroredDirs : []);
  const prunable = [];
  for (const id of Object.keys(tracks || {})) {
    if (surviving.has(id)) continue;
    const item = tracks[id];
    const root = item && typeof item.rootFolder === 'string' ? item.rootFolder : null;
    if (root && missing.has(root)) continue; // whole-root mount-loss guard
    // Subtree conservatism (gate ADV-WARNING-1): a track whose file sits UNDER
    // a directory that errored this pass (EACCES / failed automount) is NOT
    // prunable -- a transient unreadable subtree must never delete a track (or
    // its per-user liked/progress) whose file is still on disk. The whole-root
    // guard misses this because the root as a whole still has survivors.
    const fp = item && typeof item.filePath === 'string' ? item.filePath : '';
    if (fp && errored.some((d) => typeof d === 'string' && d !== '' && (fp === d || fp.startsWith(`${d}/`) || fp.startsWith(`${d}\\`)))) continue;
    prunable.push(id);
  }
  return prunable;
}

/**
 * The stable album grouping key for a track: `<albumArtist||artist>␟<album>`.
 * Album art is cached per-album keyed by a hash of THIS value, so two tracks
 * of the same album share one art file, while a compilation's "Various
 * Artists" album stays one group. Missing pieces degrade to '' -- a track
 * with no album tag groups under its artist's empty-album bucket, never
 * cross-contaminating another album.
 */
function albumKeyFor(track) {
  const t = track || {};
  const artist = (typeof t.albumArtist === 'string' && t.albumArtist.trim())
    || (typeof t.artist === 'string' && t.artist.trim())
    || '';
  const album = (typeof t.album === 'string' && t.album.trim()) || '';
  return `${artist}${ALBUM_KEY_SEP}${album}`;
}

module.exports = {
  ensureMusic,
  readMusic,
  selectPrunableTrackIds,
  albumKeyFor,
  ALBUM_KEY_SEP,
};
