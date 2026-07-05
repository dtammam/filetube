'use strict';

// resolveAudioArtUrl lives in the browser common.js, which exposes it to Node
// via a `typeof module` guard purely for this test. See
// docs/exec-plans/active/2026-07-05-audio-art-and-related.md ("Feature 1")
// for the full design/contract.
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveAudioArtUrl } = require('../../public/js/common.js');

test('resolveAudioArtUrl: real thumbnail resolves to /thumbnail/:id', () => {
  assert.strictEqual(resolveAudioArtUrl({ id: 'abc', hasThumbnail: true }), '/thumbnail/abc');
});

test('resolveAudioArtUrl: hasThumbnail false (placeholder-only) returns null', () => {
  assert.strictEqual(resolveAudioArtUrl({ id: 'abc', hasThumbnail: false }), null);
});

test('resolveAudioArtUrl: hasThumbnail missing/undefined returns null', () => {
  assert.strictEqual(resolveAudioArtUrl({ id: 'abc' }), null);
});

test('resolveAudioArtUrl: null item returns null without throwing', () => {
  assert.strictEqual(resolveAudioArtUrl(null), null);
});

test('resolveAudioArtUrl: undefined item returns null without throwing', () => {
  assert.strictEqual(resolveAudioArtUrl(undefined), null);
});

test('resolveAudioArtUrl: item without id returns null', () => {
  assert.strictEqual(resolveAudioArtUrl({ hasThumbnail: true }), null);
});

test('resolveAudioArtUrl: deterministic across repeated calls with identical input', () => {
  const item = { id: 'xyz', hasThumbnail: true };
  const first = resolveAudioArtUrl(item);
  const second = resolveAudioArtUrl(item);
  assert.strictEqual(first, second);
  assert.strictEqual(first, '/thumbnail/xyz');
});
