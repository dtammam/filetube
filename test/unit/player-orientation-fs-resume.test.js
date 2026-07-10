'use strict';

// [UNIT] On-device bug fix (2026-07-10): rotating a playing video from
// LANDSCAPE back to PORTRAIT paused it instead of continuing to play. Root
// cause: the rotate-to-fullscreen orientation handler
// (`onOrientationChange`, public/js/player.js) exits native fullscreen on
// landscape->portrait via `mediaPlayer.webkitExitFullscreen()`/
// `document.exitFullscreen()`, and iOS pauses the video as a SIDE EFFECT of
// exiting native fullscreen -- there is no explicit `.pause()` call in that
// handler. The fix captures whether the media was playing right before the
// exit is requested (`shouldResumeAfterOrientationFsExit`, a pure, exported
// helper) and arms a pending flag (`resumeAfterFsExit`) that `onFsChange`
// consumes once iOS's exit-fullscreen signal
// (`webkitendfullscreen`/`fullscreenchange`) confirms the exit completed,
// re-asserting play() -- mirroring the existing "wasPlaying && paused ->
// play()" re-assert pattern already used by `mountInSlot()`/`dock()`.
//
// The pure decision table below is exercised directly (`node:test`-able, no
// DOM). The DOM-only wiring in `onOrientationChange`/`onFsChange` themselves
// (both live inside the `if (typeof window === 'undefined') return;`-guarded
// IIFE, so neither is exported) is locked against source text instead,
// mirroring the existing precedent at
// test/unit/player-gesture-native-controls-guard.test.js and
// test/unit/player-hardening.test.js. Dean's on-device iOS pass -- does
// exiting native fullscreen actually pause; does the re-assert `play()`
// resume without a fresh user gesture (iOS may reject a programmatic
// `play()` outside a user gesture -- the `.catch(() => {})` just keeps that
// safe, it doesn't guarantee resume) -- is the documented arbiter for actual
// runtime behavior.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { shouldResumeAfterOrientationFsExit } = require('../../public/js/player.js');

// ---- shouldResumeAfterOrientationFsExit (pure) -----------------------------

test('shouldResumeAfterOrientationFsExit: media playing before the rotate-driven fullscreen exit -> resume', () => {
  assert.strictEqual(shouldResumeAfterOrientationFsExit(true), true);
});

test('shouldResumeAfterOrientationFsExit: media the user themselves paused before rotating -> do NOT resume', () => {
  assert.strictEqual(shouldResumeAfterOrientationFsExit(false), false);
});

test('shouldResumeAfterOrientationFsExit: a missing/undefined wasPlaying is treated as not-playing -- never throws, never force-resumes', () => {
  assert.strictEqual(shouldResumeAfterOrientationFsExit(undefined), false);
  assert.strictEqual(shouldResumeAfterOrientationFsExit(null), false);
});

// ---- DOM-only wiring (source-text lock; no jsdom harness in this codebase) -

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

const onFsChangeMatch = /function onFsChange\(\) \{([\s\S]*?)\n {4}\}/.exec(PLAYER_JS);
const onOrientationChangeMatch = /function onOrientationChange\(\) \{([\s\S]*?)\n {4}\}/.exec(PLAYER_JS);

test('wiring: onFsChange() and onOrientationChange() are isolated for inspection', () => {
  assert.ok(onFsChangeMatch, "expected to find onFsChange()'s source body in player.js");
  assert.ok(onOrientationChangeMatch, "expected to find onOrientationChange()'s source body in player.js");
});

test('wiring: onOrientationChange captures wasPlaying via shouldResumeAfterOrientationFsExit BEFORE requesting the fullscreen exit', () => {
  const body = onOrientationChangeMatch[1];
  const armIndex = body.indexOf('resumeAfterFsExit = shouldResumeAfterOrientationFsExit(!mediaPlayer.paused)');
  const webkitExitIndex = body.indexOf('mediaPlayer.webkitExitFullscreen()');
  const standardExitIndex = body.indexOf('document.exitFullscreen()');
  assert.notStrictEqual(armIndex, -1, 'expected the landscape->portrait branch to arm resumeAfterFsExit via shouldResumeAfterOrientationFsExit');
  assert.notStrictEqual(webkitExitIndex, -1, 'expected the webkitExitFullscreen() exit call to remain present');
  assert.notStrictEqual(standardExitIndex, -1, 'expected the standard exitFullscreen() fallback to remain present');
  assert.ok(armIndex < webkitExitIndex, 'wasPlaying must be captured BEFORE webkitExitFullscreen() is called, not after');
  assert.ok(armIndex < standardExitIndex, 'wasPlaying must be captured BEFORE the standard exitFullscreen() fallback is called, not after');
});

test('wiring: onOrientationChange never sets resumeAfterFsExit on the portrait->landscape (enter) branch', () => {
  const body = onOrientationChangeMatch[1];
  const enterBranch = body.slice(0, body.indexOf('} else if'));
  assert.ok(!/resumeAfterFsExit/.test(enterBranch), 'the enter-fullscreen branch must not touch resumeAfterFsExit -- only the exit branch arms it');
});

test('wiring: onFsChange only re-asserts play() when resumeAfterFsExit is armed, and always clears the flag after consuming it', () => {
  const body = onFsChangeMatch[1];
  assert.match(body, /if \(resumeAfterFsExit\) \{/, 'expected onFsChange to gate the resume on the pending resumeAfterFsExit flag');
  assert.match(body, /resumeAfterFsExit = false;/, 'expected onFsChange to clear the pending flag once consumed, so a later normal fullscreen exit is never force-resumed');
  assert.match(body, /mediaPlayer\.play\(\)\.catch\(/, 'expected onFsChange to call mediaPlayer.play() (guarded by .catch, since iOS may reject a programmatic play() without a fresh user gesture)');
});

test('wiring: onFsChange only re-asserts play() while actually paused (never double-calls play() on an already-playing element)', () => {
  const body = onFsChangeMatch[1];
  assert.match(body, /if \(mediaPlayer\.paused\) mediaPlayer\.play\(\)\.catch\(/, 'expected the resume to be conditioned on mediaPlayer.paused');
});

test('wiring: onFsChange still resets autoFullscreen on a real fullscreen exit (pre-existing behavior preserved)', () => {
  const body = onFsChangeMatch[1];
  assert.match(body, /autoFullscreen = false;/, 'expected autoFullscreen to still be cleared on exit, unchanged from before this fix');
});
