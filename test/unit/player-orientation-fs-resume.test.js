'use strict';

// [UNIT] On-device RE-FIX (2026-07-10): v1.25.9's fix for "rotating a playing
// video from LANDSCAPE back to PORTRAIT paused it" auto-exited native
// fullscreen on the landscape->portrait transition and then re-armed a
// pending `play()` re-assert (`resumeAfterFsExit` + the pure helper
// `shouldResumeAfterOrientationFsExit`, consumed by `onFsChange` once iOS's
// exit-fullscreen signal fired). On-device, this did NOT work: iOS pauses the
// video as a side effect of the PROGRAMMATIC `webkitExitFullscreen()`/
// `exitFullscreen()` call, and then rejects a programmatic `play()` that
// isn't tied to a fresh user gesture -- so the video stayed paused no matter
// how the resume was scheduled.
//
// The re-fix removes the auto-exit-and-resume approach entirely: the
// landscape->portrait branch no longer calls `webkitExitFullscreen()`/
// `exitFullscreen()` at all. Rotating back to portrait now simply leaves the
// video in native fullscreen (still playing); the user exits fullscreen
// themselves via the native Done/X control, which IS a real user gesture, so
// iOS keeps the video playing inline on that exit. `onFsChange` keeps its
// pre-v1.25.9 responsibility of resetting `autoFullscreen` once a real
// fullscreen-exit event fires, but the `resumeAfterFsExit` flag and the
// `shouldResumeAfterOrientationFsExit` helper it depended on are gone.
//
// The DOM-only wiring in `onOrientationChange`/`onFsChange` (both live inside
// the `if (typeof window === 'undefined') return;`-guarded IIFE, so neither
// is exported) is locked against source text, mirroring the existing
// precedent at test/unit/player-gesture-native-controls-guard.test.js and
// test/unit/player-hardening.test.js. Dean's on-device iOS pass -- rotate to
// landscape (fullscreen, playing), rotate back to portrait (STAYS fullscreen,
// still playing), tap Done (returns inline, still playing) -- is the
// documented arbiter for actual runtime behavior.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const playerExports = require('../../public/js/player.js');

// ---- the v1.25.9 resume machinery is fully gone ----------------------------

test('shouldResumeAfterOrientationFsExit is no longer exported -- the v1.25.9 resume helper was removed', () => {
  assert.strictEqual(playerExports.shouldResumeAfterOrientationFsExit, undefined);
});

// ---- DOM-only wiring (source-text lock; no jsdom harness in this codebase) -

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

const onFsChangeMatch = /function onFsChange\(\) \{([\s\S]*?)\n {4}\}/.exec(PLAYER_JS);
const onOrientationChangeMatch = /function onOrientationChange\(\) \{([\s\S]*?)\n {4}\}/.exec(PLAYER_JS);

// Strips `//`-style line comments so source-text assertions below check the
// actual CODE, not explanatory prose that may legitimately mention removed
// identifiers/APIs (e.g. this file's own comments explain why
// `webkitExitFullscreen()` is no longer called).
function stripLineComments(src) {
  return src
    .split('\n')
    .map(function (line) { return line.replace(/\/\/.*$/, ''); })
    .join('\n');
}

test('wiring: onFsChange() and onOrientationChange() are isolated for inspection', () => {
  assert.ok(onFsChangeMatch, "expected to find onFsChange()'s source body in player.js");
  assert.ok(onOrientationChangeMatch, "expected to find onOrientationChange()'s source body in player.js");
});

test('wiring: onOrientationChange no longer auto-exits native fullscreen on landscape->portrait', () => {
  const body = stripLineComments(onOrientationChangeMatch[1]);
  assert.ok(!/webkitExitFullscreen/.test(body), 'expected the landscape->portrait branch to no longer call mediaPlayer.webkitExitFullscreen()');
  assert.ok(!/exitFullscreen\(\)/.test(body), 'expected the landscape->portrait branch to no longer call document.exitFullscreen()');
});

test('wiring: onOrientationChange no longer references the removed resumeAfterFsExit/shouldResumeAfterOrientationFsExit machinery', () => {
  const body = stripLineComments(onOrientationChangeMatch[1]);
  assert.ok(!/resumeAfterFsExit/.test(body), 'expected resumeAfterFsExit to be fully removed from onOrientationChange');
  assert.ok(!/shouldResumeAfterOrientationFsExit/.test(body), 'expected shouldResumeAfterOrientationFsExit to be fully removed from onOrientationChange');
});

test('wiring: onOrientationChange still enters native fullscreen on portrait->landscape, guarded against double-enter', () => {
  const body = onOrientationChangeMatch[1];
  // v1.50 (item 6): the guard moved INTO shouldAutoFullscreenOnRotate --
  // `landscape` and `inFullscreen: inNativeFullscreen()` are its inputs and
  // the helper's own unit tests above prove the double-enter refusal; this
  // wiring lock now asserts the call site feeds it the real signals.
  assert.match(body, /shouldAutoFullscreenOnRotate\(\{/, 'expected the enter branch to route through the pure guard helper');
  assert.match(body, /inFullscreen:\s*inNativeFullscreen\(\)/, 'expected the double-enter guard signal to be fed from inNativeFullscreen()');
  assert.match(body, /enterFullscreen\(\)/, 'expected the portrait->landscape branch to still call enterFullscreen()');
});

test('wiring: onFsChange still resets autoFullscreen on a real fullscreen exit (pre-existing behavior preserved)', () => {
  const body = stripLineComments(onFsChangeMatch[1]);
  assert.match(body, /autoFullscreen = false;/, 'expected autoFullscreen to still be cleared on a real fullscreen exit');
});

test('wiring: onFsChange no longer contains the resumeAfterFsExit/play() re-assert machinery', () => {
  const body = stripLineComments(onFsChangeMatch[1]);
  assert.ok(!/resumeAfterFsExit/.test(body), 'expected resumeAfterFsExit to be fully removed from onFsChange');
  assert.ok(!/mediaPlayer\.play\(\)/.test(body), 'expected onFsChange to no longer re-assert play() -- iOS rejects a programmatic play() without a fresh user gesture');
});

// ---- v1.50 (Dean, item 6): auto-fullscreen requires PLAYING ----------------
// Rotating a phone with a paused/idle FULL player used to yank it fullscreen
// (no paused guard at all); it now falls through to the bounded landscape
// layout in style.css. Rotating WHILE PLAYING keeps the immersive behavior.

test('shouldAutoFullscreenOnRotate: landscape + not-fullscreen + playing is the ONLY yes', () => {
  const { shouldAutoFullscreenOnRotate } = playerExports;
  assert.strictEqual(shouldAutoFullscreenOnRotate({ landscape: true, inFullscreen: false, playing: true }), true);
  assert.strictEqual(shouldAutoFullscreenOnRotate({ landscape: true, inFullscreen: false, playing: false }), false, 'paused/idle rotation stays bounded inline');
  assert.strictEqual(shouldAutoFullscreenOnRotate({ landscape: true, inFullscreen: true, playing: true }), false, 'already fullscreen -- no double-enter');
  assert.strictEqual(shouldAutoFullscreenOnRotate({ landscape: false, inFullscreen: false, playing: true }), false, 'portrait never auto-enters');
  assert.strictEqual(shouldAutoFullscreenOnRotate(), false, 'missing context fails safe to no');
  assert.strictEqual(shouldAutoFullscreenOnRotate(null), false);
});

test('wiring: onOrientationChange routes its enter decision through shouldAutoFullscreenOnRotate with a real playing signal', () => {
  const body = stripLineComments(onOrientationChangeMatch[1]);
  assert.match(body, /shouldAutoFullscreenOnRotate\(\{/, 'the decision must go through the pure helper');
  assert.match(body, /playing:\s*!!\(mediaPlayer && !mediaPlayer\.paused && !mediaPlayer\.ended\)/, 'playing = not paused and not ended, from the live element');
  assert.match(body, /inFullscreen:\s*inNativeFullscreen\(\)/, 'the double-enter guard survives inside the helper context');
});

test('CSS: phone landscape non-fullscreen caps the media element height (picture + strip + header fit the viewport)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  const landscapeStart = css.indexOf('@media (max-width: 768px) and (orientation: landscape)');
  assert.notEqual(landscapeStart, -1, 'expected the phone-landscape media block');
  const block = css.slice(landscapeStart, css.indexOf('/* v1.13.0 item 2', landscapeStart));
  assert.match(
    block,
    /#player-slot #player-wrapper:not\(\.audio-expanded\):not\(\.css-fullscreen\):not\(:fullscreen\) #media-player\s*\{[^}]*max-height:\s*calc\(100vh - var\(--mobile-header-h, 96px\) - 96px\)/,
    'expected the landscape cap, scoped to the FULL slot and excluding both fullscreen modes'
  );
});
