'use strict';

// v1.30 A5 (T6): pure sort comparators + format/search predicates +
// pagination-parameter normalizers, shared by the server's paginated
// `GET /api/videos` (server.js) and mirroring the client's `sortItems`/
// `filterByMediaType` (public/js/common.js) EXACTLY, so both sides share one
// authoritative ordering. See docs/exec-plans/active/
// 2026-07-11-v1.30-scale-perf-and-polish.md ("### A5 -- pagination
// contract") for the full pipeline this backs:
//
//   getCachedDatabase() -> hidden-folder filter (home only) -> search ->
//   root/folder filter -> format filter -> sort the FULL filtered list ->
//   slice [offset, offset+limit) -> overlay pending progress -> respond
//   { items, total, offset, limit }.
//
// This module intentionally does NOT `require('../public/js/common.js')` --
// a browser file -- it independently replicates the exact same algorithms
// (`sortItems`, `filterByMediaType`, `fisherYatesShuffle`,
// `resolveReleaseDateSortValue`) so `server.js` has zero runtime dependency
// on client code. Parity between the two implementations is proven by
// test/unit/videoquery-parity.test.js, which requires BOTH modules and
// asserts identical output for representative inputs.

const SORT_KEYS = ['newest', 'oldest', 'title-asc', 'title-desc', 'size-desc', 'size-asc', 'release-date', 'random'];
const FORMAT_MODES = ['both', 'video', 'audio'];
const DEFAULT_LIMIT = 60;
// Sanity ceiling on `?limit=` -- well above any real page size (default 60)
// or the largest synthetic fixture this wave's tests exercise (~1300), just
// enough to stop a malformed/malicious value from forcing an absurdly large
// single response. Not a "normal" bound; normal paging never approaches it.
const MAX_LIMIT = 10000;

// ---- Sort comparators (mirrors public/js/common.js:sortItems) -------------

// Mirrors public/js/common.js's resolveReleaseDateSortValue exactly: an
// item's captured `releaseDate` (epoch ms) when present and numeric, else
// its `addedAt` epoch ms, else 0 (never NaN/undefined).
function resolveReleaseDateSortValue(item) {
  if (item && typeof item.releaseDate === 'number' && !Number.isNaN(item.releaseDate)) return item.releaseDate;
  return (item && item.addedAt) || 0;
}

// Mirrors public/js/common.js's fisherYatesShuffle exactly: pure, returns a
// NEW array containing every element of `items` exactly once in a uniformly
// random order, never mutates the input. `rng` defaults to Math.random but
// accepts an injected zero-arg generator returning a number in [0, 1) (see
// `createSeededRng` below) so output is reproducible given the same rng call
// sequence.
function fisherYatesShuffle(items, rng) {
  const rand = typeof rng === 'function' ? rng : Math.random;
  const arr = Array.isArray(items) ? items.slice() : [];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// A tiny deterministic PRNG (mulberry32) -- the SAME algorithm the existing
// test suite already uses to seed `fisherYatesShuffle` deterministically
// (test/unit/quickwins-sort.test.js, test/unit/prev-next.test.js). Given an
// integer `seed`, returns a zero-arg generator producing numbers in [0, 1);
// the SAME seed always produces the SAME call sequence -- exactly the
// property AC3.2 needs to keep `random` stable across sequential page
// fetches (the server builds one rng per request, seeded from the client's
// `seed` query param, so page 0 and page 1 of the same shuffle agree).
function createSeededRng(seed) {
  let a = seed | 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mirrors public/js/common.js's sortItems exactly: same switch, same
// fallback-to-`newest` for an unrecognized/missing sortKey, same
// non-mutating `.slice()` copy. `rng` is only consulted for `random` -- pass
// a `createSeededRng(seed)` generator for stable paging, or omit it for
// one-shot (non-reproducible) randomness.
function sortItems(items, sortKey, rng) {
  const list = Array.isArray(items) ? items.slice() : [];
  switch (sortKey) {
    case 'oldest': list.sort((a, b) => a.addedAt - b.addedAt); return list;
    case 'title-asc': list.sort((a, b) => (a.title || '').localeCompare(b.title || '')); return list;
    case 'title-desc': list.sort((a, b) => (b.title || '').localeCompare(a.title || '')); return list;
    case 'size-desc': list.sort((a, b) => (b.size || 0) - (a.size || 0)); return list;
    case 'size-asc': list.sort((a, b) => (a.size || 0) - (b.size || 0)); return list;
    case 'random': return fisherYatesShuffle(list, rng);
    case 'release-date': list.sort((a, b) => resolveReleaseDateSortValue(b) - resolveReleaseDateSortValue(a)); return list;
    case 'newest':
    default: list.sort((a, b) => b.addedAt - a.addedAt); return list;
  }
}

// ---- Format + search predicates --------------------------------------------

// Mirrors public/js/common.js's filterByMediaType exactly: 'both' (or any
// unrecognized/missing mode) returns everything unchanged; an item whose own
// `type` is missing/ambiguous is never hidden by either the 'video' or
// 'audio' filter (fails safe toward inclusion). Never mutates `list`.
function filterByFormat(list, mode) {
  const items = Array.isArray(list) ? list : [];
  if (mode !== 'video' && mode !== 'audio') return items.slice();
  return items.filter((item) => {
    const t = item && item.type;
    if (t !== 'video' && t !== 'audio') return true; // ambiguous/missing -- never hidden
    return t === mode;
  });
}

// The SERVER's pre-existing (pre-pagination) `/api/videos` search predicate,
// extracted byte-for-byte from the old inline filter: case-insensitive
// `includes` against `title` OR `folderName`. `search` must already be
// lowercased+trimmed by the caller (matches the original inline call site).
//
// NOTE (flagged in the T6 report): this is intentionally NOT the same as the
// client's richer search-results ranking (`tokenize`/`rankRelated` in
// common.js, used by the dedicated search page) -- that is a different
// feature. `/api/videos`'s simple list filter keeps its existing behavior
// unchanged here, per this task's explicit instruction not to silently
// change server search semantics.
function matchesSearch(item, search) {
  if (!search) return true;
  return item.title.toLowerCase().includes(search) || item.folderName.toLowerCase().includes(search);
}

// ---- Pagination-parameter normalizers --------------------------------------
//
// Defensive parsing for the new `limit`/`offset`/`seed` query params: a bad/
// missing/garbage value never 500s -- it falls back to a sane default
// (mirrors this route's existing permissive-filter posture: `folder`/`root`/
// `search` have never validated their input either, an unmatched value just
// yields an empty/unfiltered result).

// `raw` -> a positive integer limit, defaulting to `DEFAULT_LIMIT` for
// anything non-numeric, non-positive, or non-finite; clamped to `MAX_LIMIT`.
function normalizeLimit(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// `raw` -> a non-negative integer offset, defaulting to 0 for anything
// non-numeric, negative, or non-finite.
function normalizeOffset(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

// `raw` -> a finite integer seed, or `undefined` when absent/non-numeric
// (callers should fall back to unseeded `Math.random` randomness in that
// case -- see `sortItems`'s `rng` param).
function normalizeSeed(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

module.exports = {
  SORT_KEYS,
  FORMAT_MODES,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  resolveReleaseDateSortValue,
  fisherYatesShuffle,
  createSeededRng,
  sortItems,
  filterByFormat,
  matchesSearch,
  normalizeLimit,
  normalizeOffset,
  normalizeSeed,
};
