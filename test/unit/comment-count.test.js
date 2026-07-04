'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { getCommentCount } = require('../../public/js/common.js');

test('getCommentCount: within 4–14 across many ids', () => {
  for (let i = 0; i < 300; i++) {
    const n = getCommentCount('vid-' + i, 100);
    assert.ok(n >= 4 && n <= 14, `id ${i} -> ${n} out of range`);
  }
});

test('getCommentCount: deterministic for the same id', () => {
  assert.equal(getCommentCount('abc123', 100), getCommentCount('abc123', 100));
});

test('getCommentCount: clamps to the pool size', () => {
  // Pool of 5 -> never asks for more than 5, even though the raw count can reach 14.
  for (let i = 0; i < 100; i++) {
    assert.ok(getCommentCount('x' + i, 5) <= 5);
  }
  // Tiny pool of 3 -> always clamped to 3.
  for (let i = 0; i < 100; i++) {
    assert.ok(getCommentCount('y' + i, 3) <= 3);
  }
});

test('getCommentCount: a large pool never inflates the count beyond 14', () => {
  for (let i = 0; i < 100; i++) {
    assert.ok(getCommentCount('z' + i, 9999) <= 14);
  }
});

test('getCommentCount: varies across ids (not constant)', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(getCommentCount('item' + i, 100));
  assert.ok(seen.size > 1);
});

test('getCommentCount: handles empty id without throwing', () => {
  const n = getCommentCount('', 100);
  assert.ok(n >= 4 && n <= 14);
});
