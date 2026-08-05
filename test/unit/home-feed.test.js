'use strict';

// v1.79 home feed - the PURE row assembler (lib/home/feed.js). No server, no
// DB: every record is a hand-built light candidate. Each assertion is written
// to KILL a specific mutant (flip a filter, a sort direction, a cap, drop the
// dedup, drop the empty-omission) - the v1.73 "prove what the code REMOVES"
// discipline.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  assembleHomeRows,
  selectContinueWatching,
  selectNewFromSubs,
  selectRecentlyAdded,
  rankChannelFolders,
  selectChannelRow,
  selectPopular,
  selectWatchAgain,
  HOME_ROW_CAP,
  MAX_CHANNEL_ROWS,
  POPULAR_MIN_ITEMS,
} = require('../../lib/home/feed');

// A record with sane defaults; override per test.
function rec(over) {
  return Object.assign({
    id: 'x', kind: 'media',
    inProgress: false, finished: false, watched: false,
    progressAt: '', addedAt: 0, watchCount: 0, folderKey: null, isSub: false,
  }, over);
}

function rowById(rows, id) {
  return rows.find((r) => r.id === id) || null;
}

// ---------------------------------------------------------------------------
// selectContinueWatching
// ---------------------------------------------------------------------------

test('continue-watching: in-progress non-finished only, by progress recency', () => {
  const ids = selectContinueWatching([
    rec({ id: 'a', inProgress: true, progressAt: '2026-08-01T10:00:00Z' }),
    rec({ id: 'b', inProgress: true, progressAt: '2026-08-03T10:00:00Z' }),
    rec({ id: 'c', inProgress: true, finished: true, progressAt: '2026-08-05T10:00:00Z' }), // finished -> excluded
    rec({ id: 'd', inProgress: false, progressAt: '2026-08-04T10:00:00Z' }),               // not in progress -> excluded
  ], 8);
  assert.deepEqual(ids, ['b', 'a']); // newest first; c and d excluded
});

test('continue-watching: spans all three kinds', () => {
  const ids = selectContinueWatching([
    rec({ id: 'v', kind: 'media', inProgress: true, progressAt: '2026-08-01T00:00:00Z' }),
    rec({ id: 't', kind: 'track', inProgress: true, progressAt: '2026-08-02T00:00:00Z' }),
    rec({ id: 'p', kind: 'podcast', inProgress: true, progressAt: '2026-08-03T00:00:00Z' }),
  ], 8);
  assert.deepEqual(ids, ['p', 't', 'v']);
});

test('continue-watching: honors the cap', () => {
  const many = [];
  for (let i = 0; i < 20; i++) many.push(rec({ id: `id${i}`, inProgress: true, progressAt: `2026-08-01T00:00:${String(i).padStart(2, '0')}Z` }));
  assert.equal(selectContinueWatching(many, 8).length, 8);
  assert.equal(selectContinueWatching(many, 3).length, 3);
});

// ---------------------------------------------------------------------------
// selectNewFromSubs
// ---------------------------------------------------------------------------

test('new-from-subs: subscription items only, unwatched before watched', () => {
  const ids = selectNewFromSubs([
    rec({ id: 'old-unwatched', isSub: true, watched: false, addedAt: 1 }),
    rec({ id: 'new-watched', isSub: true, watched: true, addedAt: 100 }),
    rec({ id: 'not-sub', isSub: false, watched: false, addedAt: 200 }),
  ], 8);
  // unwatched wins over a newer watched item; the non-sub is absent entirely
  assert.deepEqual(ids, ['old-unwatched', 'new-watched']);
});

test('new-from-subs: within a watched-class, newest first', () => {
  const ids = selectNewFromSubs([
    rec({ id: 'a', isSub: true, watched: false, addedAt: 10 }),
    rec({ id: 'b', isSub: true, watched: false, addedAt: 30 }),
    rec({ id: 'c', isSub: true, watched: false, addedAt: 20 }),
  ], 8);
  assert.deepEqual(ids, ['b', 'c', 'a']);
});

// ---------------------------------------------------------------------------
// selectRecentlyAdded
// ---------------------------------------------------------------------------

test('recently-added: newest first, watched INCLUDED (the thesis)', () => {
  const ids = selectRecentlyAdded([
    rec({ id: 'a', addedAt: 10, watched: true }),
    rec({ id: 'b', addedAt: 30, watched: true }),  // watched must NOT be filtered out
    rec({ id: 'c', addedAt: 20, watched: false }),
  ], 8, new Set());
  assert.deepEqual(ids, ['b', 'c', 'a']);
});

test('recently-added: excludes ids already shown above (top-cluster dedup)', () => {
  const records = [
    rec({ id: 'a', addedAt: 30 }),
    rec({ id: 'b', addedAt: 20 }),
    rec({ id: 'c', addedAt: 10 }),
  ];
  const ids = selectRecentlyAdded(records, 8, new Set(['a']));
  assert.deepEqual(ids, ['b', 'c']); // 'a' suppressed
});

// ---------------------------------------------------------------------------
// rankChannelFolders + selectChannelRow
// ---------------------------------------------------------------------------

test('rankChannelFolders: by total watch count desc, zero-signal folders dropped', () => {
  const ranked = rankChannelFolders([
    rec({ id: 'a', folderKey: 'F1', watchCount: 2 }),
    rec({ id: 'b', folderKey: 'F1', watchCount: 3 }), // F1 total = 5
    rec({ id: 'c', folderKey: 'F2', watchCount: 4 }), // F2 total = 4
    rec({ id: 'd', folderKey: 'F3', watchCount: 0 }), // F3 = 0 -> dropped
    rec({ id: 'e', folderKey: null, watchCount: 9 }), // no folder -> ignored
  ], 3);
  assert.deepEqual(ranked, ['F1', 'F2']);
});

test('rankChannelFolders: capped at maxRows', () => {
  const records = [];
  for (let i = 0; i < 6; i++) records.push(rec({ id: `id${i}`, folderKey: `F${i}`, watchCount: 6 - i }));
  assert.equal(rankChannelFolders(records, MAX_CHANNEL_ROWS).length, MAX_CHANNEL_ROWS);
});

test('selectChannelRow: only that folder, newest first', () => {
  const ids = selectChannelRow([
    rec({ id: 'a', folderKey: 'F1', addedAt: 10 }),
    rec({ id: 'b', folderKey: 'F1', addedAt: 30 }),
    rec({ id: 'c', folderKey: 'F2', addedAt: 99 }),
  ], 'F1', 8);
  assert.deepEqual(ids, ['b', 'a']);
});

// ---------------------------------------------------------------------------
// selectPopular
// ---------------------------------------------------------------------------

test('popular: most-watched desc, watchCount>0 only', () => {
  const ids = selectPopular([
    rec({ id: 'a', watchCount: 1 }),
    rec({ id: 'b', watchCount: 5 }),
    rec({ id: 'c', watchCount: 3 }),
    rec({ id: 'z', watchCount: 0 }), // excluded
  ], 8);
  assert.deepEqual(ids, ['b', 'c', 'a']);
});

test('popular: hidden below the item floor', () => {
  const few = [];
  for (let i = 0; i < POPULAR_MIN_ITEMS - 1; i++) few.push(rec({ id: `id${i}`, watchCount: 1 }));
  assert.deepEqual(selectPopular(few, 8), []);
  few.push(rec({ id: 'extra', watchCount: 1 }));
  assert.equal(selectPopular(few, 8).length, POPULAR_MIN_ITEMS);
});

// ---------------------------------------------------------------------------
// selectWatchAgain
// ---------------------------------------------------------------------------

test('watch-again: finished only, most-recently-finished first', () => {
  const ids = selectWatchAgain([
    rec({ id: 'a', finished: true, progressAt: '2026-08-01T00:00:00Z' }),
    rec({ id: 'b', finished: true, progressAt: '2026-08-05T00:00:00Z' }),
    rec({ id: 'c', finished: false, progressAt: '2026-08-09T00:00:00Z' }), // not finished
  ], 8);
  assert.deepEqual(ids, ['b', 'a']);
});

// ---------------------------------------------------------------------------
// assembleHomeRows (integration of the selectors)
// ---------------------------------------------------------------------------

test('assemble: omits empty rows entirely', () => {
  // Only a recently-added candidate; every other row is empty.
  const { rows } = assembleHomeRows({ records: [rec({ id: 'a', addedAt: 5 })] });
  const ids = rows.map((r) => r.id);
  assert.deepEqual(ids, ['recently-added']);
  assert.equal(rowById(rows, 'continue-watching'), null);
  assert.equal(rowById(rows, 'popular'), null);
});

test('assemble: full feed keeps the fixed row order', () => {
  const records = [
    rec({ id: 'cw', inProgress: true, progressAt: '2026-08-05T00:00:00Z', addedAt: 50, folderKey: 'F1', watchCount: 4 }),
    rec({ id: 'sub', isSub: true, watched: false, addedAt: 40, folderKey: 'F1', watchCount: 1 }),
    rec({ id: 'ra', addedAt: 30, folderKey: 'F1', watchCount: 2 }),
    rec({ id: 'fin', finished: true, progressAt: '2026-08-02T00:00:00Z', addedAt: 20, folderKey: 'F1', watchCount: 5 }),
  ];
  const { rows } = assembleHomeRows({ records });
  const order = rows.map((r) => r.id);
  // continue -> subs -> recently -> channel(s) -> popular -> watch-again
  assert.ok(order.indexOf('continue-watching') < order.indexOf('new-from-subs'));
  assert.ok(order.indexOf('new-from-subs') < order.indexOf('recently-added'));
  assert.ok(order.indexOf('recently-added') < order.indexOf('popular'));
  assert.ok(order.indexOf('popular') < order.indexOf('watch-again'));
  assert.ok(order.some((id) => id.startsWith('channel:')));
});

test('assemble: recently-added dedups against continue + subs', () => {
  const records = [
    rec({ id: 'a', inProgress: true, progressAt: '2026-08-05T00:00:00Z', addedAt: 100 }),
    rec({ id: 'b', isSub: true, watched: false, addedAt: 90 }),
    rec({ id: 'c', addedAt: 80 }),
  ];
  const { rows } = assembleHomeRows({ records });
  const ra = rowById(rows, 'recently-added');
  assert.deepEqual(ra.itemIds, ['c']); // a (continue) and b (subs) suppressed
});

test('assemble: channel row uses the provided title + href', () => {
  const records = [];
  for (let i = 0; i < 3; i++) records.push(rec({ id: `id${i}`, folderKey: 'UC123', addedAt: 10 + i, watchCount: 2 }));
  const { rows } = assembleHomeRows({
    records,
    folderTitles: new Map([['UC123', 'Cool Channel']]),
    folderHrefs: new Map([['UC123', '/?folder=UC123']]),
  });
  const row = rowById(rows, 'channel:UC123');
  assert.equal(row.title, 'More from Cool Channel');
  assert.equal(row.seeAllHref, '/?folder=UC123');
});

test('assemble: default cap is HOME_ROW_CAP; a custom cap is honored', () => {
  const records = [];
  for (let i = 0; i < 20; i++) records.push(rec({ id: `id${i}`, addedAt: i }));
  assert.equal(rowById(assembleHomeRows({ records }).rows, 'recently-added').itemIds.length, HOME_ROW_CAP);
  assert.equal(rowById(assembleHomeRows({ records, cap: 4 }).rows, 'recently-added').itemIds.length, 4);
});

test('assemble: empty input yields no rows, never throws', () => {
  assert.deepEqual(assembleHomeRows({ records: [] }).rows, []);
  assert.deepEqual(assembleHomeRows({}).rows, []);
  assert.deepEqual(assembleHomeRows().rows, []);
});

test('assemble: an id of __proto__ is an inert value, not a phantom', () => {
  // The module keys nothing on ids; a __proto__ id flows through as data only.
  const { rows } = assembleHomeRows({ records: [rec({ id: '__proto__', addedAt: 1 })] });
  assert.deepEqual(rowById(rows, 'recently-added').itemIds, ['__proto__']);
  // no prototype was polluted
  assert.equal({}.polluted, undefined);
});
