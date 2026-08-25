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
const fs = require('node:fs');
const path = require('node:path');
const {
  nextTheaterState,
  isTheaterModeActive,
  theaterModeStorageValue,
} = require('../../public/js/watch.js');

const STYLE_CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');

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

// ---- v1.190 (Dean): theatre must not clip the page bottom (the FEEL is Dean's
// device arbiter; this source-locks the height-cap mechanism) -----------------

test('v1.190 theatre caps the player HEIGHT to the viewport (width bound by 16:9 of the available height), centred, excluding fullscreen/audio-expanded', () => {
  const rule = /\.watch-container\.theater-mode #player-slot #player-wrapper:not\(\.audio-expanded\):not\(\.css-fullscreen\):not\(:fullscreen\) \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(rule, 'the theatre height-cap rule exists, scoped away from the two fullscreen paths + audio-expanded');
  const body = rule[1];
  // Width is bounded by the height the viewport can show, so 16:9 height never
  // exceeds it -> no bottom clip. `min(100%, ...)` keeps normal cases full-width.
  assert.match(body, /width:\s*min\(100%,\s*calc\(\(100vh - var\(--header-h\)[^;]*\*\s*16\s*\/\s*9\)\);/, 'vh: width = min(100%, availableHeight*16/9)');
  assert.match(body, /width:\s*min\(100%,\s*calc\(\(100dvh - var\(--header-h\)[^;]*\*\s*16\s*\/\s*9\)\);/, 'dvh twin present (the repo viewport-height convention)');
  assert.match(body, /margin-inline:\s*auto/, 'centred when height-bound (page bg to the sides, YouTube-style)');
});
