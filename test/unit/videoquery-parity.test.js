'use strict';

// [UNIT] v1.30 A5 (T6): proves lib/videoQuery.js's sort/filter comparators
// are byte-for-byte equivalent to the client's own sortItems/
// filterByMediaType (public/js/common.js) for representative inputs -- the
// single-authoritative-ordering property AC3.2 depends on. This is the ONLY
// place that requires BOTH modules together; lib/videoQuery.js itself never
// requires the browser file (see its header comment).
const { test } = require('node:test');
const assert = require('node:assert');
const videoQuery = require('../../lib/videoQuery');
const clientCommon = require('../../public/js/common.js');

function makeLibrary() {
  return [
    { id: 'a', title: 'Alpha', type: 'video', addedAt: 5000, size: 300, folderName: 'F1', releaseDate: 100 },
    { id: 'b', title: 'bravo', type: 'audio', addedAt: 1000, size: 900, folderName: 'F2' },
    { id: 'c', title: 'Charlie', type: 'video', addedAt: 9000, size: 100, folderName: 'F1', releaseDate: 500 },
    { id: 'd', title: 'delta', type: 'audio', addedAt: 3000, size: 500, folderName: 'F3' },
    { id: 'e', title: 'Echo', type: 'video', addedAt: 7000, size: 700, folderName: 'F2', releaseDate: 50 },
  ];
}

// mulberry32 -- the same deterministic PRNG both the client's own tests
// (test/unit/quickwins-sort.test.js) and lib/videoQuery.js's
// `createSeededRng` use, kept as a local copy here so this parity test does
// not depend on either module's internal seeding implementation being
// identical -- only the OUTPUT ORDER (given equivalent rng call sequences)
// needs to match.
function seededRng(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SORT_KEYS = ['newest', 'oldest', 'title-asc', 'title-desc', 'size-desc', 'size-asc', 'release-date'];

for (const sortKey of SORT_KEYS) {
  test(`videoQuery.sortItems parity with client sortItems for sortKey="${sortKey}"`, () => {
    const library = makeLibrary();
    const serverOrder = videoQuery.sortItems(library, sortKey).map((i) => i.id);
    const clientOrder = clientCommon.sortItems(library, sortKey).map((i) => i.id);
    assert.deepEqual(serverOrder, clientOrder, `server and client orderings must match for "${sortKey}"`);
  });
}

test('videoQuery.sortItems parity with client sortItems for an unrecognized sortKey (both fall back to newest)', () => {
  const library = makeLibrary();
  const serverOrder = videoQuery.sortItems(library, 'not-a-real-sort').map((i) => i.id);
  const clientOrder = clientCommon.sortItems(library, 'not-a-real-sort').map((i) => i.id);
  assert.deepEqual(serverOrder, clientOrder);
});

test('videoQuery.sortItems("random") parity with client sortItems("random") given an equivalent seeded rng call sequence', () => {
  const library = makeLibrary();
  const serverOrder = videoQuery.sortItems(library, 'random', seededRng(99)).map((i) => i.id);
  const clientOrder = clientCommon.sortItems(library, 'random', seededRng(99)).map((i) => i.id);
  assert.deepEqual(serverOrder, clientOrder, 'the SAME rng call sequence must permute both implementations identically');
});

test('videoQuery.filterByFormat parity with client filterByMediaType across all three modes', () => {
  const library = makeLibrary();
  for (const mode of ['both', 'video', 'audio']) {
    const serverResult = videoQuery.filterByFormat(library, mode).map((i) => i.id);
    const clientResult = clientCommon.filterByMediaType(library, mode).map((i) => i.id);
    assert.deepEqual(serverResult, clientResult, `mode="${mode}"`);
  }
});

test('videoQuery.filterByFormat parity with client filterByMediaType for an item with a missing/ambiguous type', () => {
  const library = [{ id: 'x', type: undefined }, { id: 'y', type: 'weird' }];
  for (const mode of ['both', 'video', 'audio']) {
    const serverResult = videoQuery.filterByFormat(library, mode).map((i) => i.id);
    const clientResult = clientCommon.filterByMediaType(library, mode).map((i) => i.id);
    assert.deepEqual(serverResult, clientResult, `mode="${mode}"`);
  }
});

// `resolveReleaseDateSortValue` itself is not directly exported from
// common.js (only used internally by its `sortItems`) -- its parity is
// already proven indirectly by the `sortKey="release-date"` case in the
// loop above, which exercises both implementations' full comparators
// (including this helper) end to end.
