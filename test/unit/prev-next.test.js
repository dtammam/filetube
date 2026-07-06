'use strict';

// [UNIT] FR-2/FR-3 (T3) shared, pure order-derivation helpers extracted into
// public/js/common.js: `deriveOrderedIds` (wraps `sortItems`, projecting down
// to just the id list) and `computeNeighbors` (position lookup -> prev/next,
// null at the ends). Both the watch view's Prev/Next controls (watch.js) and
// the persistent player controller's autoplay-next 'ended' handler
// (player.js) call these SAME two functions, so this file is the single
// source of truth both features are verified against -- no divergent order.
const { test } = require('node:test');
const assert = require('node:assert');
const { deriveOrderedIds, computeNeighbors } = require('../../public/js/common.js');

// A tiny deterministic PRNG (mulberry32), mirroring
// test/unit/quickwins-sort.test.js's own copy, so the `random` sort key is
// reproducible here too.
function seededRng(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sample = [
  { id: 'a', title: 'Banana', addedAt: 200, size: 500 },
  { id: 'b', title: 'apple', addedAt: 300, size: 100 },
  { id: 'c', title: 'Cherry', addedAt: 100, size: 300 },
];

// ---- deriveOrderedIds -------------------------------------------------------

test('deriveOrderedIds: newest sorts by addedAt descending (matches sortItems)', () => {
  assert.deepStrictEqual(deriveOrderedIds(sample, 'newest'), ['b', 'a', 'c']);
});

test('deriveOrderedIds: oldest sorts by addedAt ascending', () => {
  assert.deepStrictEqual(deriveOrderedIds(sample, 'oldest'), ['c', 'a', 'b']);
});

test('deriveOrderedIds: title-asc sorts case-insensitively A-Z', () => {
  assert.deepStrictEqual(deriveOrderedIds(sample, 'title-asc'), ['b', 'a', 'c']);
});

test('deriveOrderedIds: title-desc sorts case-insensitively Z-A', () => {
  assert.deepStrictEqual(deriveOrderedIds(sample, 'title-desc'), ['c', 'a', 'b']);
});

test('deriveOrderedIds: size-desc sorts largest first', () => {
  assert.deepStrictEqual(deriveOrderedIds(sample, 'size-desc'), ['a', 'c', 'b']);
});

test('deriveOrderedIds: size-asc sorts smallest first', () => {
  assert.deepStrictEqual(deriveOrderedIds(sample, 'size-asc'), ['b', 'c', 'a']);
});

test('deriveOrderedIds: random shuffles via sortItems -- an injected rng is deterministic and every id is present exactly once', () => {
  const a = deriveOrderedIds(sample, 'random', seededRng(9));
  const b = deriveOrderedIds(sample, 'random', seededRng(9));
  assert.deepStrictEqual(a, b, 'same seed -> same order');
  assert.deepStrictEqual(a.slice().sort(), ['a', 'b', 'c']);
});

test('deriveOrderedIds: an unrecognized/missing sortKey falls back to newest (matches sortItems default)', () => {
  assert.deepStrictEqual(deriveOrderedIds(sample, 'bogus'), ['b', 'a', 'c']);
  assert.deepStrictEqual(deriveOrderedIds(sample, undefined), ['b', 'a', 'c']);
});

test('deriveOrderedIds: ties preserve the original (pre-sort) relative order -- Array.sort is stable', () => {
  const tied = [
    { id: 'x1', addedAt: 100 },
    { id: 'x2', addedAt: 100 },
    { id: 'x3', addedAt: 100 },
  ];
  assert.deepStrictEqual(deriveOrderedIds(tied, 'newest'), ['x1', 'x2', 'x3']);
  assert.deepStrictEqual(deriveOrderedIds(tied, 'oldest'), ['x1', 'x2', 'x3']);
});

test('deriveOrderedIds: an empty list yields an empty id list', () => {
  assert.deepStrictEqual(deriveOrderedIds([], 'newest'), []);
});

test('deriveOrderedIds: a single-item list yields a single-id list', () => {
  assert.deepStrictEqual(deriveOrderedIds([{ id: 'only', addedAt: 1 }], 'newest'), ['only']);
});

// ---- computeNeighbors --------------------------------------------------------

test('computeNeighbors: a middle item has both a prev and a next', () => {
  assert.deepStrictEqual(computeNeighbors(['a', 'b', 'c'], 'b'), { prevId: 'a', nextId: 'c' });
});

test('computeNeighbors: the FIRST item has prevId null (no wrap) and a real nextId', () => {
  assert.deepStrictEqual(computeNeighbors(['a', 'b', 'c'], 'a'), { prevId: null, nextId: 'b' });
});

test('computeNeighbors: the LAST item has nextId null (no wrap) and a real prevId', () => {
  assert.deepStrictEqual(computeNeighbors(['a', 'b', 'c'], 'c'), { prevId: 'b', nextId: null });
});

test('computeNeighbors: a single-item list has both ends null', () => {
  assert.deepStrictEqual(computeNeighbors(['only'], 'only'), { prevId: null, nextId: null });
});

test('computeNeighbors: currentId not present in the ordered list yields both null (never throws)', () => {
  assert.deepStrictEqual(computeNeighbors(['a', 'b', 'c'], 'not-there'), { prevId: null, nextId: null });
});

test('computeNeighbors: an empty ordered list yields both null', () => {
  assert.deepStrictEqual(computeNeighbors([], 'anything'), { prevId: null, nextId: null });
});

test('computeNeighbors: a non-array orderedIds is treated as empty (defensive, never throws)', () => {
  assert.deepStrictEqual(computeNeighbors(null, 'a'), { prevId: null, nextId: null });
  assert.deepStrictEqual(computeNeighbors(undefined, 'a'), { prevId: null, nextId: null });
});

// ---- end-to-end: deriveOrderedIds -> computeNeighbors, each sort key --------

test('deriveOrderedIds + computeNeighbors together: newest order neighbors for the middle item', () => {
  const orderedIds = deriveOrderedIds(sample, 'newest'); // ['b', 'a', 'c']
  assert.deepStrictEqual(computeNeighbors(orderedIds, 'a'), { prevId: 'b', nextId: 'c' });
});

test('deriveOrderedIds + computeNeighbors together: title-asc order neighbors at the start', () => {
  const orderedIds = deriveOrderedIds(sample, 'title-asc'); // ['b', 'a', 'c']
  assert.deepStrictEqual(computeNeighbors(orderedIds, 'b'), { prevId: null, nextId: 'a' });
});

test('deriveOrderedIds + computeNeighbors together: size-desc order neighbors at the end', () => {
  const orderedIds = deriveOrderedIds(sample, 'size-desc'); // ['a', 'c', 'b']
  assert.deepStrictEqual(computeNeighbors(orderedIds, 'b'), { prevId: 'c', nextId: null });
});
