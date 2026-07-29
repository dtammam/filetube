'use strict';

// [UNIT] v1.50 T2: the per-user watched-state filter primitives in
// lib/videoQuery.js -- `normalizeWatchFilter`, `deriveWatchState`, and
// `filterByWatchState`. The latch semantics (sticky 'watched' overriding a
// low live timestamp -- the looping-video case Dean flagged at intake) are
// the load-bearing behavior here.
const { test } = require('node:test');
const assert = require('node:assert');

const {
  WATCH_FILTER_MODES, WATCHED_PCT, WATCHING_MIN_PCT,
  normalizeWatchFilter, deriveWatchState, filterByWatchState,
} = require('../../lib/videoQuery.js');

// ---- constants -------------------------------------------------------------

test('WATCH_FILTER_MODES: exactly the 4 modes, "all" first (the default)', () => {
  assert.deepStrictEqual(WATCH_FILTER_MODES, ['all', 'new', 'watching', 'watched']);
});

test('thresholds: watched at >=90%, watching above the same 0.5% the home progress bar uses', () => {
  assert.strictEqual(WATCHED_PCT, 90);
  assert.strictEqual(WATCHING_MIN_PCT, 0.5);
});

// ---- normalizeWatchFilter --------------------------------------------------

test('normalizeWatchFilter: passes through each valid mode', () => {
  for (const mode of WATCH_FILTER_MODES) {
    assert.strictEqual(normalizeWatchFilter(mode), mode);
  }
});

test('normalizeWatchFilter: anything unrecognized/missing falls back to "all"', () => {
  assert.strictEqual(normalizeWatchFilter('garbage'), 'all');
  assert.strictEqual(normalizeWatchFilter(undefined), 'all');
  assert.strictEqual(normalizeWatchFilter(''), 'all');
  assert.strictEqual(normalizeWatchFilter(null), 'all');
  assert.strictEqual(normalizeWatchFilter(['watched']), 'all');
});

// ---- deriveWatchState ------------------------------------------------------

test('deriveWatchState: no progress and no latch is "new"', () => {
  assert.strictEqual(deriveWatchState(0, false), 'new');
});

test('deriveWatchState: exactly the watching threshold (0.5%) is still "new" -- strict >, matching the progress-bar rule', () => {
  assert.strictEqual(deriveWatchState(0.5, false), 'new');
  assert.strictEqual(deriveWatchState(0.51, false), 'watching');
});

test('deriveWatchState: mid-progress is "watching"', () => {
  assert.strictEqual(deriveWatchState(50, false), 'watching');
  assert.strictEqual(deriveWatchState(89.99, false), 'watching');
});

test('deriveWatchState: exactly 90% is "watched" (inclusive boundary)', () => {
  assert.strictEqual(deriveWatchState(90, false), 'watched');
  assert.strictEqual(deriveWatchState(100, false), 'watched');
});

test('deriveWatchState: the LATCH overrides a low live position -- the looping/rewatch case', () => {
  // A fully-watched video whose loop restarted (live timestamp near 0) must
  // stay watched; this is the whole reason the latch exists.
  assert.strictEqual(deriveWatchState(0, true), 'watched');
  assert.strictEqual(deriveWatchState(3, true), 'watched');
});

test('deriveWatchState: garbage percent fails safe to "new", never throws', () => {
  assert.strictEqual(deriveWatchState(NaN, false), 'new');
  assert.strictEqual(deriveWatchState(undefined, false), 'new');
  assert.strictEqual(deriveWatchState('50', false), 'new');
});

// ---- filterByWatchState ----------------------------------------------------

const ITEMS = [
  { id: 'fresh' },                 // no progress row
  { id: 'started' },               // 40% in
  { id: 'boundary-low' },          // exactly 0.5% -> new
  { id: 'boundary-high' },         // exactly 90% -> watched (live, no latch)
  { id: 'done' },                  // 100% (also latched)
  { id: 'looped' },                // latched, live position back at 2%
];
const PROGRESS = {
  started: { timestamp: 40, duration: 100 },
  'boundary-low': { timestamp: 0.5, duration: 100 },
  'boundary-high': { timestamp: 90, duration: 100 },
  done: { timestamp: 100, duration: 100 },
  looped: { timestamp: 2, duration: 100 },
};
const LATCHED = new Set(['done', 'looped']);

test('filterByWatchState: "new" keeps only never-meaningfully-played items', () => {
  const out = filterByWatchState(ITEMS, 'new', PROGRESS, LATCHED);
  assert.deepStrictEqual(out.map((i) => i.id), ['fresh', 'boundary-low']);
});

test('filterByWatchState: "watching" keeps only in-flight items -- a latched loop-restart never reappears here', () => {
  const out = filterByWatchState(ITEMS, 'watching', PROGRESS, LATCHED);
  assert.deepStrictEqual(out.map((i) => i.id), ['started']);
});

test('filterByWatchState: "watched" = latched items PLUS un-latched >=90% live positions (pre-v1.50 rows)', () => {
  const out = filterByWatchState(ITEMS, 'watched', PROGRESS, LATCHED);
  assert.deepStrictEqual(out.map((i) => i.id), ['boundary-high', 'done', 'looped']);
});

test('filterByWatchState: the three modes partition the list -- every item appears in exactly one', () => {
  const ids = ['new', 'watching', 'watched']
    .flatMap((m) => filterByWatchState(ITEMS, m, PROGRESS, LATCHED).map((i) => i.id))
    .sort();
  assert.deepStrictEqual(ids, ITEMS.map((i) => i.id).sort());
});

test('filterByWatchState: "all" and any unrecognized mode return everything unchanged (fail-safe toward showing items)', () => {
  assert.deepStrictEqual(filterByWatchState(ITEMS, 'all', PROGRESS, LATCHED).map((i) => i.id), ITEMS.map((i) => i.id));
  assert.deepStrictEqual(filterByWatchState(ITEMS, 'bogus', PROGRESS, LATCHED).map((i) => i.id), ITEMS.map((i) => i.id));
  assert.deepStrictEqual(filterByWatchState(ITEMS, undefined, PROGRESS, LATCHED).map((i) => i.id), ITEMS.map((i) => i.id));
});

test('filterByWatchState: a zero/missing duration can never divide to a percent -- such items are "new"', () => {
  const items = [{ id: 'zero-dur' }, { id: 'no-dur' }];
  const map = {
    'zero-dur': { timestamp: 50, duration: 0 },
    'no-dur': { timestamp: 50 },
  };
  assert.deepStrictEqual(filterByWatchState(items, 'new', map, new Set()).map((i) => i.id), ['zero-dur', 'no-dur']);
  assert.deepStrictEqual(filterByWatchState(items, 'watched', map, new Set()), []);
});

test('filterByWatchState: never mutates the input; never throws on garbage inputs', () => {
  const copy = ITEMS.map((i) => ({ ...i }));
  filterByWatchState(ITEMS, 'watched', PROGRESS, LATCHED);
  assert.deepStrictEqual(ITEMS, copy);
  assert.deepStrictEqual(filterByWatchState(undefined, 'new', undefined, undefined), []);
  assert.deepStrictEqual(filterByWatchState(null, 'watched', null, 'not-a-set'), []);
  assert.doesNotThrow(() => filterByWatchState([{}, { id: 'x' }], 'new', {}, new Set()));
});

test('filterByWatchState: an item with no id carries no per-user state -- "new" by definition', () => {
  const items = [{ title: 'no-id' }];
  assert.strictEqual(filterByWatchState(items, 'new', {}, new Set()).length, 1);
  assert.strictEqual(filterByWatchState(items, 'watched', {}, new Set()).length, 0);
  assert.strictEqual(filterByWatchState(items, 'watching', {}, new Set()).length, 0);
});

test('filterByWatchState: a hostile "__proto__" media id never reads inherited prototype state', () => {
  // progressMap rows come from user input via POST /api/progress ids; an
  // own-property probe (not truthiness) is what keeps Object.prototype
  // pollution out of the derivation.
  const items = [{ id: 'constructor' }, { id: '__proto__' }];
  const out = filterByWatchState(items, 'watched', {}, new Set());
  assert.deepStrictEqual(out, []);
});
