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
const { resolveMobileFormFactor, isDesktopClassPlatform } = require('../../public/js/player.js');

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

// v1.45.4 (Dean, Surface Laptop Studio): a hybrid whose PRIMARY pointer is touch
// reports coarse + hover:none (so the primary-only check above would call it
// mobile), but it has a trackpad — any-pointer:fine — on a laptop-sized screen.
test('resolveMobileFormFactor: a Surface-type touch laptop (touch PRIMARY but a trackpad + wide screen) is DESKTOP', () => {
  assert.strictEqual(
    resolveMobileFormFactor({ coarsePointer: true, noHover: true, anyPointerFine: true, narrowViewport: false }),
    false,
  );
});

// v1.45.5 (Dean, Surface Laptop Studio — the REAL fix): Chromium on a Windows
// touch laptop reports coarse + hover:none + any-pointer:fine=FALSE + any-hover
// =FALSE (media-query-identical to a phone; confirmed on Dean's device), so the
// v1.45.4 any-pointer signal can't catch it. The OS is the only reliable tell.
test('resolveMobileFormFactor: a Windows touch laptop (no fine pointer reported, but desktopPlatform) is DESKTOP', () => {
  assert.strictEqual(
    resolveMobileFormFactor({ coarsePointer: true, noHover: true, anyPointerFine: false, desktopPlatform: true, narrowViewport: false }),
    false,
  );
});

// The desktopPlatform signal must NOT rescue a real phone/tablet: those never
// report a desktop-class platform (see isDesktopClassPlatform).
test('resolveMobileFormFactor: a phone (no fine pointer, NOT a desktop platform) stays MOBILE even though coarse+noHover', () => {
  assert.strictEqual(
    resolveMobileFormFactor({ coarsePointer: true, noHover: true, anyPointerFine: false, desktopPlatform: false, narrowViewport: true }),
    true,
  );
});

// ---- isDesktopClassPlatform (v1.45.5) --------------------------------------
// The safety-critical part: match Windows/Chrome OS, NEVER a string a phone/
// tablet reports (Android => "Linux armv8l"/"Android"; iPadOS => "MacIntel").

test('isDesktopClassPlatform: matches Windows (navigator.platform Win32/Win64 and userAgentData "Windows")', () => {
  assert.strictEqual(isDesktopClassPlatform('Win32'), true);
  assert.strictEqual(isDesktopClassPlatform('Win64'), true);
  assert.strictEqual(isDesktopClassPlatform('Windows'), true);
});

test('isDesktopClassPlatform: matches the userAgentData Chrome OS value ("Chrome OS")', () => {
  // The REAL signal: navigator.userAgentData.platform === "Chrome OS".
  assert.strictEqual(isDesktopClassPlatform('Chrome OS'), true);
  // NOTE: Chrome OS navigator.platform is "Linux x86_64" (NOT "CrOS") — the
  // "CrOS" token is UA-string-only — so a Chromebook on http (no userAgentData)
  // falls back to mobile via the mobile-string assertions below. The /cros/ arm
  // is a defensive belt for the UA-CH value only.
});

test('isDesktopClassPlatform: NEVER matches a mobile-device platform string (the safety invariant)', () => {
  assert.strictEqual(isDesktopClassPlatform('Linux armv8l'), false, 'Android navigator.platform must NOT read as desktop');
  assert.strictEqual(isDesktopClassPlatform('Android'), false, 'Android userAgentData must NOT read as desktop');
  assert.strictEqual(isDesktopClassPlatform('iPhone'), false);
  assert.strictEqual(isDesktopClassPlatform('iPad'), false);
  assert.strictEqual(isDesktopClassPlatform('MacIntel'), false, 'iPadOS masquerades as MacIntel — must NOT read as desktop');
  assert.strictEqual(isDesktopClassPlatform('macOS'), false, 'a real Mac is desktop via its fine pointer, never via this');
  assert.strictEqual(isDesktopClassPlatform('Linux x86_64'), false, 'a Linux desktop is desktop via its fine pointer, and this shares Android\'s string family');
});

test('isDesktopClassPlatform: empty/garbage/non-string is false (fail toward the pointer logic)', () => {
  assert.strictEqual(isDesktopClassPlatform(''), false);
  assert.strictEqual(isDesktopClassPlatform(undefined), false);
  assert.strictEqual(isDesktopClassPlatform(null), false);
  assert.strictEqual(isDesktopClassPlatform(42), false);
});

// v1.45.4 DISCLOSED collateral: an iPad (>768px) with a Magic Keyboard trackpad
// or a mouse reports the SAME signals as the Surface (iPadOS keeps the primary
// touch-friendly but flips any-pointer:fine true — WebKit r268086), so it is
// indistinguishable from a Windows touch laptop and is now DESKTOP too. There is
// no media-query way to fix the Surface without this. A BARE iPad (no pointer)
// reports any-pointer:fine false and stays mobile (the touch-only cases below).
test('resolveMobileFormFactor: an iPad WITH a trackpad/mouse (wide + any-pointer:fine) is DESKTOP — disclosed Surface-rule collateral', () => {
  assert.strictEqual(
    resolveMobileFormFactor({ coarsePointer: true, noHover: true, anyPointerFine: true, narrowViewport: false }),
    false,
  );
});

// The guard that keeps phones mobile: a stylus phone (S-Pen => any-pointer:fine)
// on a NARROW screen must NOT be declassified — only a precise pointer AND room.
test('resolveMobileFormFactor: a stylus PHONE (any-pointer:fine via an S-Pen, but narrow) stays MOBILE', () => {
  assert.strictEqual(
    resolveMobileFormFactor({ coarsePointer: true, noHover: true, anyPointerFine: true, narrowViewport: true }),
    true,
  );
});

test('resolveMobileFormFactor: a touch-only phone (no fine pointer anywhere) stays MOBILE regardless of width', () => {
  assert.strictEqual(resolveMobileFormFactor({ coarsePointer: true, noHover: true, anyPointerFine: false, narrowViewport: true }), true);
  assert.strictEqual(resolveMobileFormFactor({ coarsePointer: true, noHover: true, anyPointerFine: false, narrowViewport: false }), true, 'a big touch-only tablet is still mobile');
});

test('resolveMobileFormFactor: anyPointerFine undefined (query unsupported) keeps the exact prior coarse&&noHover behaviour', () => {
  assert.strictEqual(resolveMobileFormFactor({ coarsePointer: true, noHover: true, anyPointerFine: undefined, narrowViewport: false }), true);
  assert.strictEqual(resolveMobileFormFactor({ coarsePointer: true, noHover: true, narrowViewport: false }), true, 'omitted entirely == undefined == prior behaviour');
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
