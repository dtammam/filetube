'use strict';

// v1.14.0 item 1 (random "feeling lucky" sort + re-roll) -- fisherYatesShuffle,
// sortItems, and shouldShowShuffleButton live in the browser common.js, exposed
// to Node via the same `typeof module` guard as the other client-side pure
// helpers (mirrors test/unit/resolve-icon-set.test.js's pattern).
const { test } = require('node:test');
const assert = require('node:assert');
const { fisherYatesShuffle, sortItems, shouldShowShuffleButton } = require('../../public/js/common.js');

// A tiny deterministic PRNG (mulberry32) so fisherYatesShuffle's output is
// reproducible across runs/platforms without relying on Math.random.
function seededRng(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- fisherYatesShuffle -----------------------------------------------------

test('fisherYatesShuffle: with an injected rng, output is deterministic across repeated calls', () => {
  const items = [1, 2, 3, 4, 5];
  const a = fisherYatesShuffle(items, seededRng(42));
  const b = fisherYatesShuffle(items, seededRng(42));
  assert.deepEqual(a, b, 'same seed -> same permutation');
});

test('fisherYatesShuffle: a different seed produces a different order (sanity, not a strict guarantee)', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = fisherYatesShuffle(items, seededRng(1));
  const b = fisherYatesShuffle(items, seededRng(2));
  assert.notDeepEqual(a, b);
});

test('fisherYatesShuffle: every original element is present exactly once (no drops, no dupes)', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  const shuffled = fisherYatesShuffle(items, seededRng(7));
  assert.equal(shuffled.length, items.length);
  const originalIds = items.map((i) => i.id).sort();
  const shuffledIds = shuffled.map((i) => i.id).sort();
  assert.deepEqual(shuffledIds, originalIds);
});

test('fisherYatesShuffle: does not mutate the input array', () => {
  const items = [1, 2, 3, 4, 5];
  const copy = [...items];
  fisherYatesShuffle(items, seededRng(3));
  assert.deepEqual(items, copy, 'input array must be untouched');
});

test('fisherYatesShuffle: an empty array shuffles to an empty array (no throw)', () => {
  assert.deepEqual(fisherYatesShuffle([], seededRng(1)), []);
});

test('fisherYatesShuffle: a single-element array is returned unchanged', () => {
  assert.deepEqual(fisherYatesShuffle(['only'], seededRng(1)), ['only']);
});

test('fisherYatesShuffle: falls back to Math.random when no rng is injected (never throws)', () => {
  const result = fisherYatesShuffle([1, 2, 3]);
  assert.equal(result.length, 3);
  assert.deepEqual(result.slice().sort(), [1, 2, 3]);
});

// ---- sortItems --------------------------------------------------------------

const sample = [
  { title: 'Banana', addedAt: 200, size: 500 },
  { title: 'apple', addedAt: 300, size: 100 },
  { title: 'Cherry', addedAt: 100, size: 300 },
];

test('sortItems: newest sorts by addedAt descending (REGRESSION, existing default)', () => {
  const result = sortItems(sample, 'newest');
  assert.deepEqual(result.map((i) => i.addedAt), [300, 200, 100]);
});

test('sortItems: oldest sorts by addedAt ascending (REGRESSION)', () => {
  const result = sortItems(sample, 'oldest');
  assert.deepEqual(result.map((i) => i.addedAt), [100, 200, 300]);
});

test('sortItems: title-asc sorts case-insensitively A-Z (REGRESSION)', () => {
  const result = sortItems(sample, 'title-asc');
  assert.deepEqual(result.map((i) => i.title), ['apple', 'Banana', 'Cherry']);
});

test('sortItems: title-desc sorts case-insensitively Z-A (REGRESSION)', () => {
  const result = sortItems(sample, 'title-desc');
  assert.deepEqual(result.map((i) => i.title), ['Cherry', 'Banana', 'apple']);
});

test('sortItems: size-desc sorts largest first (REGRESSION)', () => {
  const result = sortItems(sample, 'size-desc');
  assert.deepEqual(result.map((i) => i.size), [500, 300, 100]);
});

test('sortItems: size-asc sorts smallest first (REGRESSION)', () => {
  const result = sortItems(sample, 'size-asc');
  assert.deepEqual(result.map((i) => i.size), [100, 300, 500]);
});

test('sortItems: an unrecognized/missing sortKey falls back to newest (REGRESSION, matches the old switch default)', () => {
  assert.deepEqual(sortItems(sample, 'bogus').map((i) => i.addedAt), [300, 200, 100]);
  assert.deepEqual(sortItems(sample, undefined).map((i) => i.addedAt), [300, 200, 100]);
});

test('sortItems: random shuffles via fisherYatesShuffle -- all items present, and an injected rng makes it deterministic', () => {
  const a = sortItems(sample, 'random', seededRng(9));
  const b = sortItems(sample, 'random', seededRng(9));
  assert.deepEqual(a, b, 'same seed -> same order');
  assert.deepEqual(a.map((i) => i.title).sort(), sample.map((i) => i.title).sort());
});

test('sortItems: never mutates the input array regardless of sortKey', () => {
  const items = [{ title: 'z' }, { title: 'a' }];
  const copy = [...items];
  sortItems(items, 'title-asc');
  assert.deepEqual(items, copy);
});

// ---- shouldShowShuffleButton -------------------------------------------------

test('shouldShowShuffleButton: true only when the sort is random', () => {
  assert.equal(shouldShowShuffleButton('random'), true);
});

test('shouldShowShuffleButton: false for every other existing sort option', () => {
  for (const key of ['newest', 'oldest', 'title-asc', 'title-desc', 'size-desc', 'size-asc', undefined, 'bogus']) {
    assert.equal(shouldShowShuffleButton(key), false, `${key} should not show the shuffle button`);
  }
});
