'use strict';

// [UNIT] v1.84 T2 - the Modern-grid chip filter (PURE, lib/home/feed.js).
// resolveGridFilter bounds a hand-typed ?filter=; matchesGridFilter decides
// per-chip membership. Both axes of every chip are bound (the v1.83 symmetry
// lesson: a one-sided assertion hides a surviving mutant).

const { test } = require('node:test');
const assert = require('node:assert');
const { MODERN_GRID_FILTERS, resolveGridFilter, MODERN_GRID_SORTS, resolveGridSort, matchesGridFilter } = require('../../lib/home/feed.js');
const videoQuery = require('../../lib/videoQuery.js');

const media = (over) => Object.assign({ kind: 'media', type: 'video', inProgress: false, watched: false }, over);
const pod = (over) => Object.assign({ kind: 'podcast', type: 'audio', inProgress: false, watched: false }, over);

test('resolveGridFilter: known values pass; unknown/absent -> all', () => {
  for (const f of MODERN_GRID_FILTERS) assert.strictEqual(resolveGridFilter(f), f);
  assert.strictEqual(resolveGridFilter('bogus'), 'all');
  assert.strictEqual(resolveGridFilter(undefined), 'all');
  assert.strictEqual(resolveGridFilter(''), 'all');
  assert.strictEqual(resolveGridFilter('ALL'), 'all', 'case-exact');
});

test('all: every gathered candidate (media video/audio + podcast)', () => {
  assert.ok(matchesGridFilter(media({ type: 'video' }), 'all'));
  assert.ok(matchesGridFilter(media({ type: 'audio' }), 'all'));
  assert.ok(matchesGridFilter(pod(), 'all'));
});

test('videos: media type video ONLY', () => {
  assert.ok(matchesGridFilter(media({ type: 'video' }), 'videos'));
  assert.ok(!matchesGridFilter(media({ type: 'audio' }), 'videos'));
  assert.ok(!matchesGridFilter(pod(), 'videos'), 'a podcast is never a video');
});

test('audio: media type audio ONLY (not podcasts)', () => {
  assert.ok(matchesGridFilter(media({ type: 'audio' }), 'audio'));
  assert.ok(!matchesGridFilter(media({ type: 'video' }), 'audio'));
  assert.ok(!matchesGridFilter(pod(), 'audio'), 'a podcast is not the Audio chip (that is yt-dlp MP3s)');
});

test('podcasts: podcast episodes ONLY', () => {
  assert.ok(matchesGridFilter(pod(), 'podcasts'));
  assert.ok(!matchesGridFilter(media({ type: 'audio' }), 'podcasts'));
  assert.ok(!matchesGridFilter(media({ type: 'video' }), 'podcasts'));
});

test('continue: anything in progress (media OR podcast); nothing not-in-progress', () => {
  assert.ok(matchesGridFilter(media({ inProgress: true }), 'continue'));
  assert.ok(matchesGridFilter(pod({ inProgress: true }), 'continue'));
  assert.ok(!matchesGridFilter(media({ inProgress: false }), 'continue'));
  assert.ok(!matchesGridFilter(pod({ inProgress: false }), 'continue'));
});

test('unwatched: media neither latched nor finished-by-threshold; watched/finished out; podcasts out', () => {
  assert.ok(matchesGridFilter(media({ watched: false }), 'unwatched'));
  assert.ok(!matchesGridFilter(media({ watched: true }), 'unwatched'), 'a latched video is out');
  assert.ok(!matchesGridFilter(media({ watched: false, finished: true }), 'unwatched'),
    'a finished-by-threshold (e.g. 95% unlatched) video is out too (QA suggestion) - not both unwatched AND done');
  assert.ok(!matchesGridFilter(pod({ watched: false }), 'unwatched'), 'podcasts have no watched latch -> never in Unwatched');
});

// ---- v1.86.0: resolveGridSort (PURE) ---------------------------------------

test('resolveGridSort: known values pass; unknown/absent -> newest', () => {
  for (const s of MODERN_GRID_SORTS) assert.strictEqual(resolveGridSort(s), s);
  assert.strictEqual(resolveGridSort('bogus'), 'newest');
  assert.strictEqual(resolveGridSort(undefined), 'newest');
  assert.strictEqual(resolveGridSort(''), 'newest');
  assert.strictEqual(resolveGridSort('NEWEST'), 'newest', 'case-exact');
});

test('resolveGridSort whitelist is exactly the canonical sort-key set (a literal parity check, hand-kept with videoQuery)', () => {
  // NOTE (v1.86.0 gate SUGGESTION): this is a LITERAL parity check, NOT derived
  // from videoQuery.sortItems - the functional bind below is what actually ties
  // the whitelist to videoQuery's behaviour.
  assert.deepStrictEqual(
    [...MODERN_GRID_SORTS].sort(),
    ['newest', 'oldest', 'release-date', 'title-asc', 'title-desc', 'size-desc', 'size-asc', 'random'].sort(),
  );
});

test('every MODERN_GRID_SORTS key is genuinely HANDLED by videoQuery.sortItems (a deleted case falls to default=newest and fails here)', () => {
  // Functional bind (addresses the gate SUGGESTION that the parity check above is
  // vacuous vs videoQuery): each whitelisted key must produce its OWN order. If a
  // videoQuery case is deleted, that key falls through to default (newest =
  // [C,B,A]), which differs from every non-newest expected order -> RED here.
  const items = [
    { id: 'A', addedAt: 100, title: 'C', size: 30, releaseDate: 300 },
    { id: 'B', addedAt: 200, title: 'A', size: 10, releaseDate: 100 },
    { id: 'C', addedAt: 300, title: 'B', size: 20, releaseDate: 200 },
  ];
  const order = (key) => videoQuery.sortItems(items, key).map((i) => i.id);
  assert.deepStrictEqual(order('newest'), ['C', 'B', 'A']);
  assert.deepStrictEqual(order('oldest'), ['A', 'B', 'C']);
  assert.deepStrictEqual(order('title-asc'), ['B', 'C', 'A']);
  assert.deepStrictEqual(order('title-desc'), ['A', 'C', 'B']);
  assert.deepStrictEqual(order('size-desc'), ['A', 'C', 'B']);
  assert.deepStrictEqual(order('size-asc'), ['B', 'C', 'A']);
  assert.deepStrictEqual(order('release-date'), ['A', 'C', 'B']);
  assert.deepStrictEqual(order('random').slice().sort(), ['A', 'B', 'C'], 'random keeps every item (a real shuffle, not a drop)');
  for (const key of MODERN_GRID_SORTS) {
    assert.ok(Array.isArray(videoQuery.sortItems(items, key)), `sortItems returns an array for ${key}`);
  }
});
