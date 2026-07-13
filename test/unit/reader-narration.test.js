'use strict';

// [UNIT] v1.39.0 — the pure chapter-clamp helper behind the reader's prev/next
// CHAPTER narration controls. (The DOM-heavy bar wiring is validated on-device.)

const { test } = require('node:test');
const assert = require('node:assert');

const { clampSpineIndex } = require('../../public/js/read.js');

test('clampSpineIndex: keeps an in-range index', () => {
  assert.strictEqual(clampSpineIndex(0, 5), 0);
  assert.strictEqual(clampSpineIndex(3, 5), 3);
  assert.strictEqual(clampSpineIndex(4, 5), 4);
});

test('clampSpineIndex: returns null past the last chapter (next at the end)', () => {
  assert.strictEqual(clampSpineIndex(5, 5), null);
  assert.strictEqual(clampSpineIndex(6, 5), null);
});

test('clampSpineIndex: returns null before the first chapter (prev at the start)', () => {
  assert.strictEqual(clampSpineIndex(-1, 5), null);
});

test('clampSpineIndex: null count enforces only the lower bound (unknown length)', () => {
  assert.strictEqual(clampSpineIndex(9999, null), 9999);
  assert.strictEqual(clampSpineIndex(0, null), 0);
  assert.strictEqual(clampSpineIndex(-1, null), null);
});

test('clampSpineIndex: rejects non-integers', () => {
  assert.strictEqual(clampSpineIndex(1.5, 5), null);
  assert.strictEqual(clampSpineIndex(NaN, 5), null);
  assert.strictEqual(clampSpineIndex('2', 5), null);
});
