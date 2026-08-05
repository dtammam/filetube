'use strict';

// v1.79 home feed - the PURE row assembler.
//
// Given LIGHT per-user candidate records (no DB rows, no request, no rendering),
// it returns the ordered / capped / de-duplicated row structure as ids + row
// metadata. The GET /api/home route gathers the per-user inputs, computes the
// two derived booleans this module needs (`finished`, `inProgress` - via
// lib/videoQuery.js's own deriveWatchState, the single source of truth for the
// 90%/0.5% thresholds, so this module NEVER hardcodes a threshold and cannot
// drift from it), calls this assembler, then resolves the selected ids to
// render fields. Mirrors lib/presence/store.js's purity posture.
//
// A candidate record (route-produced):
//   { id:string, kind:'media'|'track'|'podcast',
//     inProgress:bool, finished:bool, watched:bool, liked:bool,
//     progressAt:string,     // dual-purpose ISO ts, '' when none:
//                            //   in-progress row -> progress updatedAt;
//                            //   watch-again row  -> the completion (latch) time
//     likedAt:string,        // liked_at ISO ts, '' when not liked
//     addedAt:number,        // recency key (item addedAt epoch ms; 0 unknown)
//     folderKey:string|null, // grouping key for per-channel/folder rows
//     isSub:bool }           // folderKey maps to a subscription
//
// NOTE on "most-watched": there is deliberately NO per-item view COUNT here,
// because the store has none - `user_watched` is a boolean latch (completed_at,
// ON CONFLICT DO NOTHING), so a real popularity number does not exist to
// surface. Per-channel ranking therefore uses the COUNT of completed (watched)
// items per folder - a genuine per-user engagement signal the latch does carry
// - and the tail row is "From your Liked" (an explicit per-user signal), not a
// fabricated "Popular". Building a row on a number we do not have would be the
// opposite of this repo's honesty norm.
//
// Everything here operates on that shape ONLY. Ids are used as Set/array
// values, never as object keys, so a record id of '__proto__' is inert (the
// route still does its own own-property checks when resolving - v1.42 lesson).

// Uniform per-row cap (existing home constant, HOME_ROW_CAP in main.js:157).
const HOME_ROW_CAP = 8;

// At most this many per-channel/folder "More from X" rows.
const MAX_CHANNEL_ROWS = 3;

function arr(v) {
  return Array.isArray(v) ? v : [];
}

// Deterministic descending sort by a numeric/string key with an id tiebreak, so
// the row order is STABLE across identical inputs (tests + within-session
// stability both depend on this). Never sorts in place.
function sortDesc(records, keyFn) {
  return records.slice().sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    if (ka < kb) return 1;
    if (ka > kb) return -1;
    // tiebreak: ascending id (string compare), total + deterministic
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

// ---- Row selectors (each named + exported so it is bindable by test; the
// v1.73 W1 lesson: an inlined selector survives all its mutants). Each returns
// an array of ids, capped, most-relevant first. ----

// 1. Continue watching - in-progress across all kinds, NOT finished, by
// progress recency. `progressAt` is an ISO string so lexical compare == time
// order; '' (no progress) sorts last, which is correct (it would not be
// inProgress anyway).
function selectContinueWatching(records, cap) {
  const pool = arr(records).filter((r) => r && r.inProgress && !r.finished);
  return sortDesc(pool, (r) => r.progressAt || '').slice(0, cap).map((r) => r.id);
}

// 2. New from subscriptions - items under a subscription folder, UNWATCHED
// first, then newest. Two-key order via a composite: unwatched outranks watched
// regardless of age (the "new to you" intent), ties broken by addedAt.
function selectNewFromSubs(records, cap) {
  const pool = arr(records).filter((r) => r && r.isSub);
  return sortDesc(pool, (r) => (r.watched ? 0 : 1) * 1e16 + (r.addedAt || 0))
    .slice(0, cap).map((r) => r.id);
}

// 3. Recently added - newest library-wide, ALL kinds, WATCHED INCLUDED (the
// wave thesis: "what's new in the library, not what's new to watch"). `exclude`
// carries the ids already shown in the two rows above so the top-of-feed
// cluster never shows the same card twice looking identical (Dean's intake
// concern); scoped rows below (per-channel, watch-again) are NOT deduped -
// overlap there is expected and desirable.
function selectRecentlyAdded(records, cap, exclude) {
  const skip = exclude instanceof Set ? exclude : new Set();
  const pool = arr(records).filter((r) => r && !skip.has(r.id));
  return sortDesc(pool, (r) => r.addedAt || 0).slice(0, cap).map((r) => r.id);
}

// The top folders/channels to give their own "More from X" row, ranked by the
// COUNT of completed (watched) items the user has in each folder (most-engaged
// first). Folders with zero watch signal never surface - this is a
// re-engagement feed. The latch is boolean, so this counts distinct completed
// items, which is the truest "most-watched" signal the store actually carries.
function rankChannelFolders(records, maxRows) {
  const byFolder = new Map();
  for (const r of arr(records)) {
    if (!r || !r.folderKey) continue;
    const prev = byFolder.get(r.folderKey) || 0;
    byFolder.set(r.folderKey, prev + (r.watched ? 1 : 0));
  }
  const ranked = [...byFolder.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; // stable folder tiebreak
    });
  return ranked.slice(0, maxRows).map(([folderKey]) => folderKey);
}

// 4. One channel/folder row's ids - that folder's items, newest first.
function selectChannelRow(records, folderKey, cap) {
  const pool = arr(records).filter((r) => r && r.folderKey === folderKey);
  return sortDesc(pool, (r) => r.addedAt || 0).slice(0, cap).map((r) => r.id);
}

// 5. From your Liked - explicitly-liked items across all kinds, most-recently-
// liked first. An explicit per-user signal (no floor: even one favorite is a
// real, wanted row). Replaces a "Popular" row the store has no view count for.
function selectFromLiked(records, cap) {
  const pool = arr(records).filter((r) => r && r.liked);
  return sortDesc(pool, (r) => r.likedAt || '').slice(0, cap).map((r) => r.id);
}

// 6. Watch again - finished items, most-recently-finished first (finished items
// carry their latch time in progressAt for this purpose - the route stamps the
// completed_at there for finished records).
function selectWatchAgain(records, cap) {
  const pool = arr(records).filter((r) => r && r.finished);
  return sortDesc(pool, (r) => r.progressAt || '').slice(0, cap).map((r) => r.id);
}

/**
 * Assemble the full ordered row structure.
 *
 * @param {object} input
 * @param {Array} input.records   candidate records (shape above)
 * @param {Map<string,string>} [input.folderTitles]  folderKey -> display title
 * @param {Map<string,string>} [input.folderHrefs]   folderKey -> See-all href
 * @param {number} [input.cap]
 * @returns {{rows: Array<{id,title,kind,seeAllHref,itemIds}>}}
 *   Only NON-EMPTY rows are returned. `kind` is the row kind, not a media kind.
 *   itemIds are ids into the caller's own resolution; this module resolves
 *   nothing.
 */
function assembleHomeRows(input) {
  const opts = input || {};
  const records = arr(opts.records);
  const cap = Number.isInteger(opts.cap) && opts.cap > 0 ? opts.cap : HOME_ROW_CAP;
  const folderTitles = opts.folderTitles instanceof Map ? opts.folderTitles : new Map();
  const folderHrefs = opts.folderHrefs instanceof Map ? opts.folderHrefs : new Map();

  const rows = [];
  const push = (row) => { if (row.itemIds.length > 0) rows.push(row); };

  const continueIds = selectContinueWatching(records, cap);
  push({ id: 'continue-watching', title: 'Continue watching', kind: 'row', seeAllHref: null, itemIds: continueIds });

  const subsIds = selectNewFromSubs(records, cap);
  push({ id: 'new-from-subs', title: 'New from your subscriptions', kind: 'row', seeAllHref: '/subscriptions', itemIds: subsIds });

  // The top-cluster dedup set: the two rows above. Recently-added excludes them.
  const topShown = new Set([...continueIds, ...subsIds]);
  const recentIds = selectRecentlyAdded(records, cap, topShown);
  push({ id: 'recently-added', title: 'Recently added', kind: 'row', seeAllHref: '/', itemIds: recentIds });

  for (const folderKey of rankChannelFolders(records, MAX_CHANNEL_ROWS)) {
    const ids = selectChannelRow(records, folderKey, cap);
    push({
      id: `channel:${folderKey}`,
      title: `More from ${folderTitles.get(folderKey) || folderKey}`,
      kind: 'row',
      seeAllHref: folderHrefs.get(folderKey) || null,
      itemIds: ids,
    });
  }

  push({ id: 'from-liked', title: 'From your Liked', kind: 'row', seeAllHref: '/playlists', itemIds: selectFromLiked(records, cap) });
  push({ id: 'watch-again', title: 'Watch again', kind: 'row', seeAllHref: null, itemIds: selectWatchAgain(records, cap) });

  return { rows };
}

module.exports = {
  assembleHomeRows,
  selectContinueWatching,
  selectNewFromSubs,
  selectRecentlyAdded,
  rankChannelFolders,
  selectChannelRow,
  selectFromLiked,
  selectWatchAgain,
  HOME_ROW_CAP,
  MAX_CHANNEL_ROWS,
};
