'use strict';

// [UNIT] The two pure helpers behind FR-1's responsive controls-mode split
// (public/js/player.js, T1, v1.22.0): `resolveMobileFormFactor` (the shared
// "is this a mobile form factor?" signal, reused unmodified by FR-8(a)'s
// pause-on-hidden scoping -- AC78) and `resolveControlsMode` (the
// mediaType/isMobile -> 'native'|'custom' lookup, AC10's four-way
// regression lock). Both are explicit-signal/two-argument pure functions
// with no DOM dependency, per the exec plan's "## Design (FR-1)". The
// impure applier (`applyControlsMode`), the actual `controls`-attribute/
// `.ff-mobile`-class side effects, and the on-device native-vs-custom feel
// (fullscreen/speed/AirPlay/PiP, gesture-layer coexistence, dock
// suppression, text-selection) are NOT covered here -- no jsdom/browser
// harness in this codebase (see CONTRIBUTING.md); Dean's iOS on-device pass
// is the documented arbiter for that feel, per the exec plan's HEAVIEST-gate
// note for this FR.
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveMobileFormFactor, resolveControlsMode } = require('../../public/js/player.js');

// ---- resolveMobileFormFactor (AC1) -------------------------------------------

test('resolveMobileFormFactor: coarse pointer + no hover (a phone/touch tablet) is mobile', () => {
  assert.strictEqual(resolveMobileFormFactor({ coarsePointer: true, noHover: true, narrowViewport: false }), true);
});

test('resolveMobileFormFactor: fine pointer + hover (an ordinary desktop/laptop) is desktop', () => {
  assert.strictEqual(resolveMobileFormFactor({ coarsePointer: false, noHover: false, narrowViewport: false }), false);
});

test('resolveMobileFormFactor: a desktop window narrowed below the mobile breakpoint is still desktop -- fine pointer + hover wins over width', () => {
  assert.strictEqual(resolveMobileFormFactor({ coarsePointer: false, noHover: false, narrowViewport: true }), false);
});

test('resolveMobileFormFactor: a large tablet in portrait (coarse pointer + no hover, but wide) is mobile -- capability wins over width', () => {
  assert.strictEqual(resolveMobileFormFactor({ coarsePointer: true, noHover: true, narrowViewport: false }), true);
});

test('resolveMobileFormFactor: a touchscreen laptop (touch AND a trackpad, hover-capable) is desktop', () => {
  assert.strictEqual(resolveMobileFormFactor({ coarsePointer: true, noHover: false, narrowViewport: false }), false);
});

test('resolveMobileFormFactor: the width fallback is used ONLY when coarsePointer/noHover are undefined (unsupported media queries)', () => {
  assert.strictEqual(resolveMobileFormFactor({ coarsePointer: undefined, noHover: undefined, narrowViewport: true }), true);
  assert.strictEqual(resolveMobileFormFactor({ coarsePointer: undefined, noHover: undefined, narrowViewport: false }), false);
});

test('resolveMobileFormFactor: a partially-unsupported query (one of the two signals undefined) also falls back to width, never half-trusts the primary signal', () => {
  assert.strictEqual(resolveMobileFormFactor({ coarsePointer: true, noHover: undefined, narrowViewport: true }), true);
  assert.strictEqual(resolveMobileFormFactor({ coarsePointer: undefined, noHover: true, narrowViewport: false }), false);
});

test('resolveMobileFormFactor: missing/empty signals object defaults to desktop (no narrowViewport, no primary signal)', () => {
  assert.strictEqual(resolveMobileFormFactor(), false);
  assert.strictEqual(resolveMobileFormFactor({}), false);
});

// ---- resolveControlsMode (AC10 four-way regression lock) ---------------------

test('resolveControlsMode: mobile video -> native (the ONLY case that changes from v1.21)', () => {
  assert.strictEqual(resolveControlsMode('video', true), 'native');
});

test('resolveControlsMode: desktop video -> custom (byte-identical to v1.21)', () => {
  assert.strictEqual(resolveControlsMode('video', false), 'custom');
});

test('resolveControlsMode: mobile audio -> custom (byte-identical to v1.21)', () => {
  assert.strictEqual(resolveControlsMode('audio', true), 'custom');
});

test('resolveControlsMode: desktop audio -> custom (byte-identical to v1.21)', () => {
  assert.strictEqual(resolveControlsMode('audio', false), 'custom');
});

test('resolveControlsMode: an unrecognized mediaType is treated as non-video -- custom, never native', () => {
  assert.strictEqual(resolveControlsMode(undefined, true), 'custom');
  assert.strictEqual(resolveControlsMode('', true), 'custom');
});
