'use strict';

// [UNIT] v1.84 T2 - the Modern-grid chip filter (PURE, lib/home/feed.js).
// resolveGridFilter bounds a hand-typed ?filter=; matchesGridFilter decides
// per-chip membership. Both axes of every chip are bound (the v1.83 symmetry
// lesson: a one-sided assertion hides a surviving mutant).

const { test } = require('node:test');
const assert = require('node:assert');
const { MODERN_GRID_FILTERS, resolveGridFilter, matchesGridFilter } = require('../../lib/home/feed.js');

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
