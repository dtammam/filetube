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
// attribute) vs. `'custom'` (this file's own control bar) -- is REMOVED.
// v1.22.0's `'native'` case (mobile video) was itself the CRITICAL
// regression this round fixes (iOS's inline `<video controls playsinline>`
// strip auto-hides during playback and does not reliably re-reveal under
// this file's own gesture layer, leaving mobile-video users with no visible
// controls at all). The fix retires the native-controls path entirely --
// EVERY case (desktop video, desktop audio, mobile audio, mobile video) is
// now `'custom'`, so a mediaType/isMobile lookup table is vestigial. The
// section below locks the NEW, stronger contract directly against the
// `applyControlsMode()` source (no DOM harness needed for this): it never
// sets the `controls` attribute, unconditionally removes it, and still
// toggles `.ff-mobile` from the SAME shared mobile signal -- an equivalent,
// stronger regression lock than the old four-way table (see the exec plan's
// "Risks and mitigations").
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

test('applyControlsMode: NEVER sets the `controls` attribute -- the native-controls path is fully retired', () => {
  const body = applyControlsModeMatch[1];
  assert.ok(!/setAttribute\(\s*['"]controls['"]/.test(body), 'applyControlsMode must never setAttribute(\'controls\', ...) -- the native mobile-video control strip is retired (v1.22.1 FR-1)');
});

test('applyControlsMode: unconditionally removes the `controls` attribute (no state/mediaType branch gating it)', () => {
  const body = applyControlsModeMatch[1];
  assert.match(body, /mediaPlayer\.removeAttribute\(\s*['"]controls['"]\s*\)\s*;/, 'expected an unconditional mediaPlayer.removeAttribute(\'controls\') call');
});

test('applyControlsMode: still toggles `.ff-mobile` on `host` from the shared mobile-form-factor signal', () => {
  const body = applyControlsModeMatch[1];
  assert.match(body, /isMobileFormFactor\(\)/, 'expected applyControlsMode to still call isMobileFormFactor()');
  assert.match(body, /host\.classList\.toggle\(\s*['"]ff-mobile['"]\s*,\s*mobile\s*\)/, 'expected host.classList.toggle(\'ff-mobile\', mobile) to remain');
});

test('resolveControlsMode: fully removed from player.js -- no lingering definition or export (superseded by the applyControlsMode contract above)', () => {
  // Prose comments are allowed to reference the retired helper by name (see
  // this file's own module comment, and player.js's own retirement notes) --
  // only an actual FUNCTION DEFINITION or CALL SITE would be a regression.
  assert.ok(!/function resolveControlsMode\(/.test(PLAYER_JS), 'resolveControlsMode must have no remaining function definition in player.js');
  assert.ok(!/resolveControlsMode\(/.test(applyControlsModeMatch[1]), 'applyControlsMode must not call resolveControlsMode anymore');
  assert.strictEqual(require('../../public/js/player.js').resolveControlsMode, undefined);
});
