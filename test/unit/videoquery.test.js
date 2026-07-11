'use strict';

// [UNIT] v1.30 A5 (T6): lib/videoQuery.js's own pure-function tests -- the
// sort comparators, the seeded-random shuffle, the format/search predicates,
// and the pagination-parameter normalizers used by the paginated
// `GET /api/videos` (server.js). See test/unit/videoquery-parity.test.js for
// the cross-check against the client's own sortItems/filterByMediaType
// (public/js/common.js), and test/integration/videos-pagination.test.js for
// the end-to-end AC3.1/AC3.2 coverage.
const { test } = require('node:test');
const assert = require('node:assert');
const videoQuery = require('../../lib/videoQuery');

function item(overrides) {
  return {
    id: 'x', title: 'x', type: 'video', addedAt: 0, size: 0, folderName: 'F',
    ...overrides,
  };
}

// ---- sortItems: each comparator --------------------------------------------

test('sortItems: default/newest sorts by addedAt descending', () => {
  const list = [item({ id: 'a', addedAt: 1 }), item({ id: 'b', addedAt: 3 }), item({ id: 'c', addedAt: 2 })];
  assert.deepEqual(videoQuery.sortItems(list, 'newest').map((i) => i.id), ['b', 'c', 'a']);
  assert.deepEqual(videoQuery.sortItems(list, undefined).map((i) => i.id), ['b', 'c', 'a'], 'missing sortKey falls back to newest');
  assert.deepEqual(videoQuery.sortItems(list, 'not-a-real-key').map((i) => i.id), ['b', 'c', 'a'], 'unrecognized sortKey falls back to newest');
});

test('sortItems: oldest sorts by addedAt ascending', () => {
  const list = [item({ id: 'a', addedAt: 1 }), item({ id: 'b', addedAt: 3 }), item({ id: 'c', addedAt: 2 })];
  assert.deepEqual(videoQuery.sortItems(list, 'oldest').map((i) => i.id), ['a', 'c', 'b']);
});

test('sortItems: title-asc sorts case-insensitively (localeCompare) A -> Z, missing title treated as empty', () => {
  const list = [item({ id: 'a', title: 'Banana' }), item({ id: 'b', title: 'apple' }), item({ id: 'c', title: undefined })];
  assert.deepEqual(videoQuery.sortItems(list, 'title-asc').map((i) => i.id), ['c', 'b', 'a']);
});

test('sortItems: title-desc sorts Z -> A', () => {
  const list = [item({ id: 'a', title: 'Banana' }), item({ id: 'b', title: 'apple' })];
  assert.deepEqual(videoQuery.sortItems(list, 'title-desc').map((i) => i.id), ['a', 'b']);
});

test('sortItems: size-desc sorts largest first, missing size treated as 0', () => {
  const list = [item({ id: 'a', size: 100 }), item({ id: 'b', size: 500 }), item({ id: 'c', size: undefined })];
  assert.deepEqual(videoQuery.sortItems(list, 'size-desc').map((i) => i.id), ['b', 'a', 'c']);
});

test('sortItems: size-asc sorts smallest first', () => {
  const list = [item({ id: 'a', size: 100 }), item({ id: 'b', size: 500 }), item({ id: 'c', size: undefined })];
  assert.deepEqual(videoQuery.sortItems(list, 'size-asc').map((i) => i.id), ['c', 'a', 'b']);
});

test('sortItems: release-date sorts by resolveReleaseDateSortValue (releaseDate when numeric, else addedAt) descending', () => {
  const list = [
    item({ id: 'a', addedAt: 10, releaseDate: 5 }),
    item({ id: 'b', addedAt: 1, releaseDate: 99 }),
    item({ id: 'c', addedAt: 50 }), // no releaseDate -> falls back to addedAt
  ];
  assert.deepEqual(videoQuery.sortItems(list, 'release-date').map((i) => i.id), ['b', 'c', 'a']);
});

test('sortItems: never mutates the input array', () => {
  const list = [item({ id: 'a', addedAt: 1 }), item({ id: 'b', addedAt: 2 })];
  const copy = list.slice();
  videoQuery.sortItems(list, 'newest');
  assert.deepEqual(list, copy);
});

// ---- resolveReleaseDateSortValue -------------------------------------------

test('resolveReleaseDateSortValue: numeric releaseDate wins over addedAt', () => {
  assert.equal(videoQuery.resolveReleaseDateSortValue({ releaseDate: 42, addedAt: 1 }), 42);
});

test('resolveReleaseDateSortValue: falls back to addedAt when releaseDate is absent/non-numeric/NaN', () => {
  assert.equal(videoQuery.resolveReleaseDateSortValue({ addedAt: 7 }), 7);
  assert.equal(videoQuery.resolveReleaseDateSortValue({ releaseDate: 'not-a-number', addedAt: 7 }), 7);
  assert.equal(videoQuery.resolveReleaseDateSortValue({ releaseDate: NaN, addedAt: 7 }), 7);
});

test('resolveReleaseDateSortValue: falls back to 0 when both are absent, never NaN/undefined', () => {
  assert.equal(videoQuery.resolveReleaseDateSortValue({}), 0);
  assert.equal(videoQuery.resolveReleaseDateSortValue(null), 0);
});

// ---- random sort + seeded rng ----------------------------------------------

test('sortItems("random"): the same seed produces the same order across separate calls', () => {
  const list = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' }), item({ id: 'd' }), item({ id: 'e' })];
  const rngA = videoQuery.createSeededRng(42);
  const rngB = videoQuery.createSeededRng(42);
  const a = videoQuery.sortItems(list, 'random', rngA).map((i) => i.id);
  const b = videoQuery.sortItems(list, 'random', rngB).map((i) => i.id);
  assert.deepEqual(a, b, 'same seed -> same permutation');
});

test('sortItems("random"): a different seed generally produces a different order', () => {
  const list = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' }), item({ id: 'd' }), item({ id: 'e' }), item({ id: 'f' }), item({ id: 'g' }), item({ id: 'h' })];
  const a = videoQuery.sortItems(list, 'random', videoQuery.createSeededRng(1)).map((i) => i.id);
  const b = videoQuery.sortItems(list, 'random', videoQuery.createSeededRng(2)).map((i) => i.id);
  assert.notDeepEqual(a, b);
});

test('sortItems("random"): with no rng supplied, falls back to Math.random (still returns every element exactly once)', () => {
  const list = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })];
  const shuffled = videoQuery.sortItems(list, 'random');
  assert.deepEqual(shuffled.map((i) => i.id).sort(), ['a', 'b', 'c']);
});

test('createSeededRng: produces values in [0, 1) across many draws', () => {
  const rng = videoQuery.createSeededRng(123);
  for (let i = 0; i < 200; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `expected [0,1), got ${v}`);
  }
});

test('fisherYatesShuffle: does not mutate the input and preserves every element exactly once', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const copy = items.slice();
  const shuffled = videoQuery.fisherYatesShuffle(items, videoQuery.createSeededRng(7));
  assert.deepEqual(items, copy, 'input untouched');
  assert.deepEqual(shuffled.map((i) => i.id).sort(), ['a', 'b', 'c', 'd']);
});

// ---- filterByFormat ---------------------------------------------------------

test('filterByFormat: "both" (and any unrecognized/missing mode) returns everything unchanged', () => {
  const list = [item({ id: 'a', type: 'video' }), item({ id: 'b', type: 'audio' })];
  assert.deepEqual(videoQuery.filterByFormat(list, 'both').map((i) => i.id), ['a', 'b']);
  assert.deepEqual(videoQuery.filterByFormat(list, undefined).map((i) => i.id), ['a', 'b']);
  assert.deepEqual(videoQuery.filterByFormat(list, 'garbage').map((i) => i.id), ['a', 'b']);
});

test('filterByFormat: "video" / "audio" partition by item.type', () => {
  const list = [item({ id: 'a', type: 'video' }), item({ id: 'b', type: 'audio' })];
  assert.deepEqual(videoQuery.filterByFormat(list, 'video').map((i) => i.id), ['a']);
  assert.deepEqual(videoQuery.filterByFormat(list, 'audio').map((i) => i.id), ['b']);
});

test('filterByFormat: an item with a missing/ambiguous type is never excluded by either filter (fail-safe toward inclusion)', () => {
  const list = [item({ id: 'a', type: undefined }), item({ id: 'b', type: 'unknown-type' })];
  assert.deepEqual(videoQuery.filterByFormat(list, 'video').map((i) => i.id), ['a', 'b']);
  assert.deepEqual(videoQuery.filterByFormat(list, 'audio').map((i) => i.id), ['a', 'b']);
});

test('filterByFormat: never mutates the input list', () => {
  const list = [item({ id: 'a', type: 'video' })];
  const copy = list.slice();
  videoQuery.filterByFormat(list, 'audio');
  assert.deepEqual(list, copy);
});

// ---- matchesSearch (server list-filter semantics) --------------------------

test('matchesSearch: matches on title, case-insensitively (search pre-lowercased by the caller)', () => {
  assert.equal(videoQuery.matchesSearch(item({ title: 'A Great Vacation', folderName: 'Home' }), 'vacation'), true);
});

test('matchesSearch: matches on folderName when title does not match', () => {
  assert.equal(videoQuery.matchesSearch(item({ title: 'Unrelated', folderName: 'Vacation Photos' }), 'vacation'), true);
});

test('matchesSearch: no match returns false', () => {
  assert.equal(videoQuery.matchesSearch(item({ title: 'Nothing', folderName: 'Other' }), 'vacation'), false);
});

test('matchesSearch: an empty/falsy search term matches everything', () => {
  assert.equal(videoQuery.matchesSearch(item({ title: 'Anything' }), ''), true);
});

// ---- normalizeLimit / normalizeOffset / normalizeSeed ----------------------

test('normalizeLimit: valid positive integers pass through unchanged', () => {
  assert.equal(videoQuery.normalizeLimit('25'), 25);
  assert.equal(videoQuery.normalizeLimit(10), 10);
});

test('normalizeLimit: missing/non-numeric/zero/negative falls back to the default', () => {
  assert.equal(videoQuery.normalizeLimit(undefined), videoQuery.DEFAULT_LIMIT);
  assert.equal(videoQuery.normalizeLimit('not-a-number'), videoQuery.DEFAULT_LIMIT);
  assert.equal(videoQuery.normalizeLimit('0'), videoQuery.DEFAULT_LIMIT);
  assert.equal(videoQuery.normalizeLimit('-5'), videoQuery.DEFAULT_LIMIT);
});

test('normalizeLimit: clamps an oversized value to MAX_LIMIT rather than 500ing', () => {
  assert.equal(videoQuery.normalizeLimit('999999999'), videoQuery.MAX_LIMIT);
});

test('normalizeOffset: valid non-negative integers pass through unchanged, including 0', () => {
  assert.equal(videoQuery.normalizeOffset('120'), 120);
  assert.equal(videoQuery.normalizeOffset('0'), 0);
});

test('normalizeOffset: missing/non-numeric/negative falls back to 0', () => {
  assert.equal(videoQuery.normalizeOffset(undefined), 0);
  assert.equal(videoQuery.normalizeOffset('not-a-number'), 0);
  assert.equal(videoQuery.normalizeOffset('-1'), 0);
});

test('normalizeSeed: a valid integer string is parsed', () => {
  assert.equal(videoQuery.normalizeSeed('42'), 42);
  assert.equal(videoQuery.normalizeSeed('-7'), -7);
});

test('normalizeSeed: missing/empty/non-numeric returns undefined (caller falls back to unseeded randomness)', () => {
  assert.equal(videoQuery.normalizeSeed(undefined), undefined);
  assert.equal(videoQuery.normalizeSeed(''), undefined);
  assert.equal(videoQuery.normalizeSeed('not-a-number'), undefined);
});
