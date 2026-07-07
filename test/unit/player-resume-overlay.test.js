'use strict';

// [UNIT] The pure resume-overlay-suppression decision extracted from the
// persistent player controller (public/js/player.js, FR-4b, T3). The overlay
// shows for a normal navigation to a video with meaningful saved progress
// (>5s), exactly as before -- but is suppressed for the ONE load that was
// reached by autoplay advancing to the next video (a one-shot flag set in
// handleAutoplayNext immediately before navigate(), consumed here), so the
// autoplay flow is never interrupted by a "Resume at..." prompt. The
// DOM-heavy wiring (the actual overlay show/hide, `mediaPlayer.currentTime`/
// `play()` calls) is intentionally NOT covered here (no jsdom/browser harness
// in this codebase -- see CONTRIBUTING.md); Dean's on-device pass is the
// documented arbiter for that feel.
const { test } = require('node:test');
const assert = require('node:assert');
const { shouldShowResumeOverlay, captureAutoplayAdvanceForLoad } = require('../../public/js/player.js');

test('shouldShowResumeOverlay: real saved progress + a normal (non-autoplay) navigation shows the overlay', () => {
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 42, autoplayAdvance: false }), true);
});

test('shouldShowResumeOverlay: real saved progress + an autoplay-advanced load suppresses the overlay', () => {
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 42, autoplayAdvance: true }), false);
});

test('shouldShowResumeOverlay: no meaningful saved progress (<=5s) never shows the overlay, autoplay or not', () => {
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 5, autoplayAdvance: false }), false);
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 0, autoplayAdvance: false }), false);
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 5, autoplayAdvance: true }), false);
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 0, autoplayAdvance: true }), false);
});

test('shouldShowResumeOverlay: progress just over the threshold (>5s) shows the overlay when not autoplay-advanced', () => {
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 5.1, autoplayAdvance: false }), true);
});

test('shouldShowResumeOverlay: a missing/undefined ctx is treated as no progress, no autoplay -- never shows, never throws', () => {
  assert.strictEqual(shouldShowResumeOverlay(undefined), false);
  assert.strictEqual(shouldShowResumeOverlay({}), false);
});

// [UNIT] Bug-fix regression coverage (v1.17.0 two-reviewer gate): the
// leak-prone version of this feature read/reset the one-shot
// `autoplayAdvancePending` global lazily inside `handleResumePlayback`,
// AFTER the `awaitingTranscode` early-return guard -- so an autoplay-advanced
// load that needed a transcode which then failed (or was navigated away from)
// left the global `true` forever, wrongly suppressing the resume overlay on
// a LATER, unrelated manually-opened video. The fix makes
// `captureAutoplayAdvanceForLoad` the single source of truth for how every
// NEW load must snapshot-then-clear the global, at load START -- these tests
// pin that contract directly (the DOM-heavy "call this at the top of load()"
// wiring itself is not covered here -- no jsdom/browser harness in this
// codebase; see CONTRIBUTING.md).
test('captureAutoplayAdvanceForLoad: a pending autoplay-advance is captured as true and the global is unconditionally reset', () => {
  const captured = captureAutoplayAdvanceForLoad(true);
  assert.strictEqual(captured.value, true);
  assert.strictEqual(captured.nextPending, false);
});

test('captureAutoplayAdvanceForLoad: no pending autoplay-advance is captured as false and the global stays reset', () => {
  const captured = captureAutoplayAdvanceForLoad(false);
  assert.strictEqual(captured.value, false);
  assert.strictEqual(captured.nextPending, false);
});

test('captureAutoplayAdvanceForLoad: a missing/undefined pending value is treated as false, never throws', () => {
  assert.deepStrictEqual(captureAutoplayAdvanceForLoad(undefined), { value: false, nextPending: false });
});

test('captureAutoplayAdvanceForLoad + shouldShowResumeOverlay: simulates the fixed leak scenario end-to-end', () => {
  // Load A: reached via autoplay-advance, needs a transcode that ultimately
  // FAILS -- handleResumePlayback never gets to run for load A at all.
  let autoplayAdvancePending = true; // armed by handleAutoplayNext just before navigating
  const loadACapture = captureAutoplayAdvanceForLoad(autoplayAdvancePending);
  autoplayAdvancePending = loadACapture.nextPending; // load() resets the global immediately, at load start
  assert.strictEqual(loadACapture.value, true); // load A itself still correctly knows it was autoplay-advanced
  assert.strictEqual(autoplayAdvancePending, false); // ...but the global is already clear for whoever loads next

  // (load A's transcode fails here; handleResumePlayback is never reached
  // for load A -- nothing further happens with loadACapture.value)

  // Load B: the user manually opens a DIFFERENT video with saved progress.
  // Pre-fix, handleResumePlayback would have read a leaked `true` here. Post-fix,
  // load B captures its OWN (correctly false) snapshot at its own load start.
  const loadBCapture = captureAutoplayAdvanceForLoad(autoplayAdvancePending);
  assert.strictEqual(loadBCapture.value, false);
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 42, autoplayAdvance: loadBCapture.value }), true);
});
