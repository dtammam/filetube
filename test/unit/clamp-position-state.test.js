'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { clampPositionState } = require('../../public/js/common.js');

test('clampPositionState: returns a valid object for good input', () => {
  assert.deepEqual(clampPositionState(100, 30, 1), { duration: 100, position: 30, playbackRate: 1 });
});

test('clampPositionState: returns null for a zero or unknown duration', () => {
  // The AVI live-transcode / streaming case — must skip setPositionState, not throw.
  assert.equal(clampPositionState(0, 0, 1), null);
  assert.equal(clampPositionState(NaN, 0, 1), null);
  assert.equal(clampPositionState(Infinity, 0, 1), null);
  assert.equal(clampPositionState(-10, 0, 1), null);
  assert.equal(clampPositionState(undefined, 0, 1), null);
});

test('clampPositionState: clamps position into [0, duration]', () => {
  assert.equal(clampPositionState(100, 150, 1).position, 100, 'over-duration clamps down');
  assert.equal(clampPositionState(100, -5, 1).position, 0, 'negative clamps to 0');
  assert.equal(clampPositionState(100, NaN, 1).position, 0, 'NaN -> 0');
  assert.equal(clampPositionState(100, Infinity, 1).position, 0, 'non-finite position -> 0');
});

test('clampPositionState: defaults an invalid playbackRate to 1', () => {
  assert.equal(clampPositionState(100, 10, 0).playbackRate, 1);
  assert.equal(clampPositionState(100, 10, -2).playbackRate, 1);
  assert.equal(clampPositionState(100, 10, NaN).playbackRate, 1);
  assert.equal(clampPositionState(100, 10, 2).playbackRate, 2, 'valid rate preserved');
});
