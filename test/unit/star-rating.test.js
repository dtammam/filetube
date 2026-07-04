'use strict';

// getStarRating lives in the browser common.js, which exposes it to Node via a
// `typeof module` guard purely for this test.
const { test } = require('node:test');
const assert = require('node:assert');
const { getStarRating } = require('../../public/js/common.js');

test('getStarRating: always returns 3, 4, or 5', () => {
  for (let i = 0; i < 300; i++) {
    const r = getStarRating('media-id-' + i);
    assert.ok([3, 4, 5].includes(r), `id ${i} produced out-of-range ${r}`);
  }
});

test('getStarRating: deterministic for the same id (card and watch page agree)', () => {
  assert.equal(getStarRating('abc123'), getStarRating('abc123'));
  assert.equal(getStarRating('9f8e7d'), getStarRating('9f8e7d'));
});

test('getStarRating: handles empty/undefined id without throwing', () => {
  assert.ok([3, 4, 5].includes(getStarRating('')));
  assert.ok([3, 4, 5].includes(getStarRating(undefined)));
});

test('getStarRating: varies across ids (not a constant)', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(getStarRating('item' + i));
  assert.ok(seen.size > 1, 'should produce more than one distinct rating');
});
