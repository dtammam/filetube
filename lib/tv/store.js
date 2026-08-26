'use strict';

// v1.195 T1 (TV Shows): the `db.tv` namespace owner -- backfill, item shape, and
// prune policy. Mirrors lib/music/store.js's namespace discipline exactly: nothing
// in this file ever reads or writes `db.folders`/`db.metadata`/`db.music`/`db.books`,
// and nothing outside the tv module writes `db.tv` -- so `updateDatabase`
// round-trips untouched keys verbatim and the media scan's Phase-2 merge (the
// 5-strike persist-gate class) can never clobber a tv field.
//
// INTERNAL NAMESPACE NOTE: the UI calls this "Shows" / "TV Shows", but the code
// namespace is `tv` throughout -- "shows" was already taken internally (podcast
// grouping resolveShowDir/showDirName, yt-dlp shows, RBAC idx.shows), so a `tv`
// namespace avoids the collision (exec-plan decision 5).
//
// HARD INVARIANT: `db.tv.folders` is a SEPARATE root list from `db.folders`,
// `db.music.folders`, `db.books.folders`, and the podcast roots. The config route
// rejects overlap with EVERY one at save time (both directions); this module never
// consults the other lists.

/**
 * Namespace backfill -- the ensureMusic posture verbatim: a missing/broken
 * namespace (or sub-key) is replaced with a fresh, well-formed value; a present
 * one is left completely untouched (never a shared/frozen reference). Mutates IN
 * MEMORY on every read; persists on whatever write next touches the db. Use ONLY
 * inside an updateDatabase mutator or against a private loadDatabase() copy --
 * read paths (GET routes) use readTv instead.
 */
function ensureTv(db) {
  if (!db.tv || typeof db.tv !== 'object' || Array.isArray(db.tv)) {
    db.tv = { folders: [], episodes: {}, settings: {} };
    return db.tv;
  }
  const ns = db.tv;
  if (!Array.isArray(ns.folders)) ns.folders = [];
  if (!ns.episodes || typeof ns.episodes !== 'object' || Array.isArray(ns.episodes)) ns.episodes = {};
  if (!ns.settings || typeof ns.settings !== 'object' || Array.isArray(ns.settings)) ns.settings = {};
  return ns;
}

/**
 * The NON-MUTATING read view for GET routes (the readMusic invariant):
 * `ensureTv` backfills BY MUTATING its argument, which violates the read-cache
 * invariant when called against getCachedDatabase(). Read paths use this instead
 * -- same defensive per-key shape, zero writes to the passed object.
 */
function readTv(db) {
  const ns = db && db.tv;
  if (!ns || typeof ns !== 'object' || Array.isArray(ns)) {
    return { folders: [], episodes: {}, settings: {} };
  }
  return {
    folders: Array.isArray(ns.folders) ? ns.folders : [],
    episodes: ns.episodes && typeof ns.episodes === 'object' && !Array.isArray(ns.episodes) ? ns.episodes : {},
    settings: ns.settings && typeof ns.settings === 'object' && !Array.isArray(ns.settings) ? ns.settings : {},
  };
}

/**
 * Pure prune policy -- the selectPrunableTrackIds mount-loss posture verbatim: an
 * episode is prunable ONLY when (a) the `pruneMissing` setting is on, (b) its file
 * did not survive this walk, AND (c) its root folder is NOT in `missingRoots` (an
 * unmounted/vanished root prunes NOTHING under it -- the absence of a mount is
 * never the deletion of a library), AND (d) its file is NOT under a directory that
 * errored this pass (a transient unreadable subtree must never delete an episode
 * whose file is still on disk -- the subtree-conservatism guard).
 * @param {Object<string, object>} episodes db.tv.episodes
 * @param {Set<string>|string[]} survivingIds ids the current walk found
 * @param {{missingRoots?, pruneMissing?, erroredDirs?}} opts
 * @returns {string[]} ids safe to prune
 */
function selectPrunableEpisodeIds(episodes, survivingIds, { missingRoots, pruneMissing, erroredDirs } = {}) {
  if (pruneMissing !== true) return [];
  const surviving = survivingIds instanceof Set ? survivingIds : new Set(Array.isArray(survivingIds) ? survivingIds : []);
  const missing = missingRoots instanceof Set ? missingRoots : new Set(Array.isArray(missingRoots) ? missingRoots : []);
  const errored = erroredDirs instanceof Set ? [...erroredDirs] : (Array.isArray(erroredDirs) ? erroredDirs : []);
  const prunable = [];
  for (const id of Object.keys(episodes || {})) {
    if (surviving.has(id)) continue;
    const item = episodes[id];
    const root = item && typeof item.rootFolder === 'string' ? item.rootFolder : null;
    if (root && missing.has(root)) continue; // whole-root mount-loss guard
    const fp = item && typeof item.filePath === 'string' ? item.filePath : '';
    if (fp && errored.some((d) => typeof d === 'string' && d !== '' && (fp === d || fp.startsWith(`${d}/`) || fp.startsWith(`${d}\\`)))) continue;
    prunable.push(id);
  }
  return prunable;
}

module.exports = {
  ensureTv,
  readTv,
  selectPrunableEpisodeIds,
};
