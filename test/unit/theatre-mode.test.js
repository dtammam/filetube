'use strict';

// [UNIT] The pure helpers behind the watch-page theatre-mode toggle
// (public/js/watch.js, FR-9, T8, v1.21.0): `nextTheaterState` (the toggle's
// reducer) and the `isTheaterModeActive`/`theaterModeStorageValue`
// persisted-preference read/write pair (AC63, `localStorage['ft-theater']`).
// The DOM-mutating half (creating/appending the button, flipping the
// `.theater-mode` class, the actual widened/desktop-only layout feel) is
// intentionally NOT covered here (no jsdom/browser harness in this codebase
// -- see CONTRIBUTING.md); Dean's on-device pass is the documented arbiter
// for that feel, per the exec plan's LIGHT-gate note for this FR.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  nextTheaterState,
  isTheaterModeActive,
  theaterModeStorageValue,
} = require('../../public/js/watch.js');

// ---- nextTheaterState ---------------------------------------------------------

test('nextTheaterState: flips off to on', () => {
  assert.strictEqual(nextTheaterState(false), true);
});

test('nextTheaterState: flips on to off', () => {
  assert.strictEqual(nextTheaterState(true), false);
});

// ---- isTheaterModeActive -------------------------------------------------------

test('isTheaterModeActive: the persisted "on" sentinel reads as active', () => {
  assert.strictEqual(isTheaterModeActive('1'), true);
});

test('isTheaterModeActive: an unset/never-persisted preference (localStorage returns null) reads as inactive', () => {
  assert.strictEqual(isTheaterModeActive(null), false);
});

test('isTheaterModeActive: the persisted "off" sentinel reads as inactive', () => {
  assert.strictEqual(isTheaterModeActive('0'), false);
});

test('isTheaterModeActive: fails safe on garbage/foreign stored values -- never active by accident', () => {
  assert.strictEqual(isTheaterModeActive('true'), false);
  assert.strictEqual(isTheaterModeActive('yes'), false);
  assert.strictEqual(isTheaterModeActive(''), false);
  assert.strictEqual(isTheaterModeActive(undefined), false);
  assert.strictEqual(isTheaterModeActive('[object Object]'), false);
});

// ---- theaterModeStorageValue ---------------------------------------------------

test('theaterModeStorageValue: serializes active/inactive to the exact sentinel isTheaterModeActive expects back', () => {
  assert.strictEqual(theaterModeStorageValue(true), '1');
  assert.strictEqual(theaterModeStorageValue(false), '0');
  // Round-trips through the parser above.
  assert.strictEqual(isTheaterModeActive(theaterModeStorageValue(true)), true);
  assert.strictEqual(isTheaterModeActive(theaterModeStorageValue(false)), false);
});
