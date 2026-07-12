'use strict';

// [UNIT] The pure helper behind FR-1's mobile-form-factor detection
// (public/js/player.js, T1, v1.22.0): `resolveMobileFormFactor` (the shared
// "is this a mobile form factor?" signal, reused unmodified by FR-8(a)'s
// pause-on-hidden scoping -- AC78, and by v1.22.1's FR-5 desktop-only
// click-to-toggle guard). An explicit-signal/two-argument-free pure function
// with no DOM dependency, per the exec plan's "## Design (FR-1)". The impure
// applier (`applyControlsMode`) and the on-device native-vs-custom feel
// (fullscreen/speed/AirPlay/PiP, gesture-layer coexistence, dock
// suppression, text-selection) are NOT covered here -- no jsdom/browser
// harness in this codebase (see CONTRIBUTING.md); Dean's iOS on-device pass
// is the documented arbiter for that feel, per the exec plan's HEAVIEST-gate
// note for this FR.
//
// v1.22.1 FR-1 (mobile-player-fixes): `resolveControlsMode(mediaType,
// isMobile)` -- the sibling helper that used to live alongside
// `resolveMobileFormFactor` and decide `'native'` (the iOS `controls`
// attribute) vs. `'custom'` (this file's own control bar) -- was REMOVED.
// v1.22.0's `'native'` case (mobile video) was itself the CRITICAL
// regression that round fixed (iOS's inline `<video controls playsinline>`
// strip auto-hides during playback and does not reliably re-reveal under
// this file's own gesture layer, leaving mobile-video users with no visible
// controls at all). v1.22.1 retired the native-controls path entirely and
// routed every case through the custom bar; `resolveControlsMode` itself
// stays removed (no reintroduced mediaType/isMobile lookup table below).
//
// Mobile-native-controls round: mobile VIDEO gets native `controls` back,
// but ONLY while FULL (never DOCKED -- the docked miniplayer keeps the
// custom bar), and the coexistence failure v1.22.1 fixed is addressed
// directly this time: `wireSkipHoldGestures()`'s gesture handlers now bail
// out whenever native controls are the active surface (see
// `inNativeControlsMode()`, tested via the source-contract suite in
// test/unit/player-gesture-native-guard.test.js), so the custom gesture
// layer and the native strip never fight over the same surface. Desktop
// (any media type), mobile AUDIO, and DOCKED mobile video are unaffected --
// they never set `controls`/`.native-controls`. The section below locks the
// NEW contract directly against the `applyControlsMode()` source (no DOM
// harness needed for this): native ONLY for mobile+video+FULL; `.ff-mobile`
// toggling from the SAME shared mobile signal is unchanged.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveMobileFormFactor } = require('../../public/js/player.js');

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

// ---- applyControlsMode source-contract regression lock (v1.22.1 FR-1) -------
// `applyControlsMode()` is impure (reads/writes live DOM: `host`,
// `mediaPlayer`) and this codebase has no jsdom/browser harness, so its
// contract is locked directly against its source text instead of by
// invocation -- the same posture test/unit/player-responsive-controls.test.js
// already uses for style.css's DOM-reactive rules.

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
const applyControlsModeMatch = /function applyControlsMode\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);

test('applyControlsMode: the function exists and is isolated for inspection', () => {
  assert.ok(applyControlsModeMatch, 'expected to find applyControlsMode()\'s source body in player.js');
});

test('applyControlsMode: derives `isVideo` from `currentData.type` and gates native controls on mobile + video + FULL only', () => {
  const body = applyControlsModeMatch[1];
  assert.match(body, /var isVideo = !!\(currentData && currentData\.type !== 'audio'\);/, 'expected isVideo to be derived from currentData.type !== \'audio\'');
  // v1.34 T4: the mobileCustomPlayer setting VETOES native -- the three
  // positive conditions are unchanged, with the cached setting flag as the
  // fourth (negated) term.
  assert.match(body, /var native = mobile && isVideo && state === STATE_FULL && !mobileCustomPlayerCached;/, 'expected native to require mobile + isVideo + FULL and no custom-player override');
});

test('applyControlsMode: mobile+video+FULL sets the native `controls` attribute AND adds `.native-controls` on host', () => {
  const body = applyControlsModeMatch[1];
  const ifBlockMatch = /if \(native\) \{([\s\S]*?)\} else \{/.exec(body);
  assert.ok(ifBlockMatch, 'expected an `if (native) { ... } else { ... }` branch in applyControlsMode');
  const ifBlock = ifBlockMatch[1];
  assert.match(ifBlock, /mediaPlayer\.setAttribute\(\s*['"]controls['"]\s*,\s*['"]['"]\s*\)\s*;/, 'expected mediaPlayer.setAttribute(\'controls\', \'\') in the native branch');
  assert.match(ifBlock, /host\.classList\.add\(\s*['"]native-controls['"]\s*\)\s*;/, 'expected host.classList.add(\'native-controls\') in the native branch');
});

test('applyControlsMode: audio, desktop, and DOCKED (any non-native case) remove the `controls` attribute AND `.native-controls`', () => {
  const body = applyControlsModeMatch[1];
  const elseBlockMatch = /\} else \{([\s\S]*)/.exec(body);
  assert.ok(elseBlockMatch, 'expected an `else { ... }` branch in applyControlsMode');
  const elseBlock = elseBlockMatch[1];
  assert.match(elseBlock, /mediaPlayer\.removeAttribute\(\s*['"]controls['"]\s*\)\s*;/, 'expected mediaPlayer.removeAttribute(\'controls\') in the non-native (else) branch');
  assert.match(elseBlock, /host\.classList\.remove\(\s*['"]native-controls['"]\s*\)\s*;/, 'expected host.classList.remove(\'native-controls\') in the non-native (else) branch');
});

test('applyControlsMode: still toggles `.ff-mobile` on `host` from the shared mobile-form-factor signal', () => {
  const body = applyControlsModeMatch[1];
  assert.match(body, /isMobileFormFactor\(\)/, 'expected applyControlsMode to still call isMobileFormFactor()');
  assert.match(body, /host\.classList\.toggle\(\s*['"]ff-mobile['"]\s*,\s*mobile\s*\)/, 'expected host.classList.toggle(\'ff-mobile\', mobile) to remain');
});

test('resolveControlsMode: still fully removed from player.js -- no reintroduced lookup-table helper (native/custom decided inline in applyControlsMode instead)', () => {
  // Prose comments are allowed to reference the retired helper by name (see
  // this file's own module comment, and player.js's own retirement notes) --
  // only an actual FUNCTION DEFINITION or CALL SITE would be a regression.
  assert.ok(!/function resolveControlsMode\(/.test(PLAYER_JS), 'resolveControlsMode must have no remaining function definition in player.js');
  assert.ok(!/resolveControlsMode\(/.test(applyControlsModeMatch[1]), 'applyControlsMode must not call resolveControlsMode anymore');
  assert.strictEqual(require('../../public/js/player.js').resolveControlsMode, undefined);
});

// ---- inNativeControlsMode() (mobile-native-controls round) -----------------

const inNativeControlsModeMatch = /function inNativeControlsMode\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);

test('inNativeControlsMode: the function exists and reads the `.native-controls` marker class off `host`', () => {
  assert.ok(inNativeControlsModeMatch, 'expected to find inNativeControlsMode()\'s source body in player.js');
  assert.match(inNativeControlsModeMatch[1], /host\.classList\.contains\(\s*['"]native-controls['"]\s*\)/, 'expected inNativeControlsMode to check host.classList.contains(\'native-controls\')');
});
