'use strict';

// C4 "fun stats" page (v1.24 UX Round, Wave 3): pure aggregation helpers over
// `db.metadata`. Every function here is a plain synchronous transform --
// object/array in, plain data out -- with NO filesystem access, no database
// I/O, and no `require('../server')`. `GET /api/stats` (server.js) is a thin
// HTTP wrapper: `loadDatabase()` once, then `computeLibraryStats(db.metadata)`
// exactly once per request. This is a deliberate LIVE compute, not a cached
// aggregate -- see the exec-plan's Design section ("C4 cached stats
// aggregate ... rejected"): at home-server scale (thousands of items, not
// millions) an O(n) pass per request is trivial and always fresh; a cached
// aggregate would need its own invalidation story for zero real benefit.
//
// "Most-watched" is backed by `db.metadata[id].viewCount` (additive integer,
// default 0 when absent -- never backfilled by re-processing/re-scanning,
// per the thumbnail-backfill-regression lesson). It is incremented ONCE per
// watch-page open by the dedicated `POST /api/videos/:id/view` route in
// server.js -- see that route's own comment for why it is deliberately NOT
// folded into `POST /api/progress` or the `/video/:id` Range-serve.

const DEFAULT_MOST_WATCHED_LIMIT = 10;

// `db.metadata` (an id -> item map) -> a plain array of items. Tolerant of a
// missing/malformed map (returns `[]`) so every caller below can assume a
// real array without its own guard.
function toItemList(metadata) {
  if (!metadata || typeof metadata !== 'object') return [];
  return Object.values(metadata);
}

// A finite, non-negative number from a possibly-missing/malformed field --
// every numeric aggregator below reads fields through this so a single
// corrupt/legacy record (a string, `NaN`, a negative stray value) can never
// poison a running total for the whole library.
function safeNumber(value) {
  return (typeof value === 'number' && Number.isFinite(value) && value >= 0) ? value : 0;
}

function isVideo(item) { return !!item && item.type === 'video'; }
function isAudio(item) { return !!item && item.type === 'audio'; }

// `{ total, video, audio }`. video/audio are NOT assumed to sum to total: an
// item with a missing/unrecognized `type` still counts toward `total` (it is
// real library content) but toward neither the video nor the audio bucket --
// mirrors C3's own fail-safe posture for an ambiguous type, just inverted
// (C3 fails an unknown type safe to "show it"; this fails it safe to "don't
// silently misclassify it").
function computeCounts(items) {
  const list = Array.isArray(items) ? items : [];
  return {
    total: list.length,
    video: list.filter(isVideo).length,
    audio: list.filter(isAudio).length,
  };
}

function computeTotalDuration(items) {
  const list = Array.isArray(items) ? items : [];
  return list.reduce((sum, item) => sum + safeNumber(item && item.duration), 0);
}

function computeTotalSize(items) {
  const list = Array.isArray(items) ? items : [];
  return list.reduce((sum, item) => sum + safeNumber(item && item.size), 0);
}

// Generic grouped breakdown: groups `items` by `keyFn(item)`, skipping any
// item whose key is missing/blank (e.g. a non-yt-dlp file has no
// `channelUrl` at all -- that is "not in any channel group," not a group
// literally named "undefined"). Returns an array (never a plain object, so
// consumers don't need `Object.keys` + a second sort pass), sorted by count
// descending then by key ascending -- a stable, fully deterministic order so
// the exact same fixture always renders identically in a test or on screen.
function groupBy(items, keyFn) {
  const list = Array.isArray(items) ? items : [];
  const groups = new Map();
  for (const item of list) {
    const key = typeof keyFn === 'function' ? keyFn(item) : undefined;
    if (typeof key !== 'string' || key.trim() === '') continue;
    let group = groups.get(key);
    if (!group) {
      group = { key, count: 0, totalDurationSeconds: 0, totalSizeBytes: 0 };
      groups.set(key, group);
    }
    group.count += 1;
    group.totalDurationSeconds += safeNumber(item && item.duration);
    group.totalSizeBytes += safeNumber(item && item.size);
  }
  return [...groups.values()].sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
}

function computeBreakdownByFolder(items) {
  return groupBy(items, (item) => item && item.folderName).map((g) => ({
    folderName: g.key, count: g.count, totalDurationSeconds: g.totalDurationSeconds, totalSizeBytes: g.totalSizeBytes,
  }));
}

// Grouped by `channelUrl` -- only ever set on yt-dlp-managed items (see
// server.js's Phase-2 channel-identity bridge). Non-yt-dlp library files
// have no `channelUrl` and are correctly excluded (they don't belong to any
// channel), not folded into a misleading catch-all bucket.
function computeBreakdownByChannel(items) {
  return groupBy(items, (item) => item && item.channelUrl).map((g) => ({
    channelUrl: g.key, count: g.count, totalDurationSeconds: g.totalDurationSeconds, totalSizeBytes: g.totalSizeBytes,
  }));
}

function computeBreakdownByType(items) {
  const list = Array.isArray(items) ? items : [];
  const video = list.filter(isVideo);
  const audio = list.filter(isAudio);
  return {
    video: { count: video.length, totalDurationSeconds: computeTotalDuration(video), totalSizeBytes: computeTotalSize(video) },
    audio: { count: audio.length, totalDurationSeconds: computeTotalDuration(audio), totalSizeBytes: computeTotalSize(audio) },
  };
}

// Small display-only projection of a full metadata record: the id/title/
// folderName every record card wants, plus whichever extra field(s) the
// caller asks for. Deliberately never returns the raw item -- keeps the API
// response small and avoids leaking fields (e.g. `filePath`) the stats page
// has no use for.
function pickSummary(item, extraFields) {
  const summary = { id: item.id, title: item.title, folderName: item.folderName };
  for (const field of extraFields) summary[field] = item[field];
  return summary;
}

// Longest/shortest by `duration`. Items with a missing/zero/negative
// duration (undetermined -- e.g. metadata extraction failed or hasn't run
// yet) are excluded from BOTH, so an undetermined record can never
// masquerade as "shortest." Returns `null` on an empty/all-undetermined list.
function findLongest(items) {
  const list = (Array.isArray(items) ? items : []).filter((item) => safeNumber(item && item.duration) > 0);
  if (list.length === 0) return null;
  const longest = list.reduce((best, item) => (item.duration > best.duration ? item : best));
  return pickSummary(longest, ['duration']);
}

function findShortest(items) {
  const list = (Array.isArray(items) ? items : []).filter((item) => safeNumber(item && item.duration) > 0);
  if (list.length === 0) return null;
  const shortest = list.reduce((best, item) => (item.duration < best.duration ? item : best));
  return pickSummary(shortest, ['duration']);
}

// Newest by `addedAt`. `null` on an empty list.
function findNewest(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return null;
  const newest = list.reduce((best, item) => (safeNumber(item && item.addedAt) > safeNumber(best && best.addedAt) ? item : best));
  return pickSummary(newest, ['addedAt']);
}

// Top `limit` most-watched items by `viewCount` (additive, default 0 -- see
// this module's header comment). Items with a zero/missing `viewCount` are
// excluded entirely (nothing has been "watched" yet under this field) rather
// than padding the list with zero-view noise; ties broken by title ascending
// for a stable, deterministic order.
function findMostWatched(items, limit) {
  const list = Array.isArray(items) ? items : [];
  const cap = (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) ? Math.floor(limit) : DEFAULT_MOST_WATCHED_LIMIT;
  return list
    .filter((item) => safeNumber(item && item.viewCount) > 0)
    .sort((a, b) => (safeNumber(b.viewCount) - safeNumber(a.viewCount)) || String(a.title).localeCompare(String(b.title)))
    .slice(0, cap)
    .map((item) => pickSummary(item, ['viewCount']));
}

// The single entry point `GET /api/stats` calls: `metadata` is `db.metadata`
// (an id -> item map) straight off a freshly-`loadDatabase()`d db, computed
// LIVE on every call (no cached aggregate -- see this module's header
// comment). Pure; never throws on a missing/malformed `metadata`.
function computeLibraryStats(metadata) {
  const items = toItemList(metadata);
  return {
    count: computeCounts(items),
    totalDurationSeconds: computeTotalDuration(items),
    totalSizeBytes: computeTotalSize(items),
    byFolder: computeBreakdownByFolder(items),
    byChannel: computeBreakdownByChannel(items),
    byType: computeBreakdownByType(items),
    longest: findLongest(items),
    shortest: findShortest(items),
    newest: findNewest(items),
    mostWatched: findMostWatched(items, DEFAULT_MOST_WATCHED_LIMIT),
  };
}

module.exports = {
  toItemList,
  computeCounts,
  computeTotalDuration,
  computeTotalSize,
  computeBreakdownByFolder,
  computeBreakdownByChannel,
  computeBreakdownByType,
  findLongest,
  findShortest,
  findNewest,
  findMostWatched,
  computeLibraryStats,
  DEFAULT_MOST_WATCHED_LIMIT,
};
