'use strict';

// [UNIT] The pure resume-overlay-suppression decision extracted from the
// persistent player controller (public/js/player.js, FR-4b, T3; threshold
// made configurable in D2, v1.24.0, T13). The overlay shows for a normal
// navigation to a video with saved progress AT OR ABOVE a configurable
// threshold (default ~60s) -- but is suppressed for the ONE load that was
// reached by autoplay advancing to the next video (a one-shot flag set in
// handleAutoplayNext immediately before navigate(), consumed here), so the
// autoplay flow is never interrupted by a "Resume at..." prompt. The
// DOM-heavy wiring (the actual overlay show/hide, `mediaPlayer.currentTime`/
// `play()` calls, and the LIVE `localStorage` read of the threshold via
// `getStoredResumeThreshold`) is intentionally NOT covered here (no jsdom/
// browser harness in this codebase -- see CONTRIBUTING.md); Dean's on-device
// pass is the documented arbiter for that feel.
const { test } = require('node:test');
const assert = require('node:assert');
const { shouldShowResumeOverlay, resolveResumeThreshold, captureAutoplayAdvanceForLoad } = require('../../public/js/player.js');

// ---- shouldShowResumeOverlay: default threshold (~60s) ---------------------

// D2 conversion note: this is the OLD ">5s shows the overlay" test, updated
// (not deleted) to the new default-threshold behavior -- 42s is real,
// meaningful saved progress, but it is BELOW the new ~60s default, so it no
// longer shows the interrupting overlay (it still resumes quietly via the
// `savedProgress > 5` direct-resume fallback in handleResumePlayback, which
// this pure decision does not cover).
test('shouldShowResumeOverlay: saved progress below the default threshold (~60s) does not show the overlay, autoplay or not', () => {
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 42, autoplayAdvance: false }), false);
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 42, autoplayAdvance: true }), false);
});

test('shouldShowResumeOverlay: saved progress AT OR ABOVE the default threshold (~60s) shows the overlay when not autoplay-advanced', () => {
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 60, autoplayAdvance: false }), true); // exactly at the threshold -- inclusive
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 90, autoplayAdvance: false }), true);
});

// D2 conversion note: this is the OLD "real saved progress + autoplay
// suppresses" test, updated to use progress ABOVE the new default threshold
// (90s, was 42s) so it actually exercises the autoplay-suppression branch --
// under the new default, 42s alone would already be suppressed by the
// threshold, which would no longer prove autoplay is what's doing the
// suppressing here.
test('shouldShowResumeOverlay: real saved progress ABOVE the threshold + an autoplay-advanced load still suppresses the overlay', () => {
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 90, autoplayAdvance: true }), false);
});

test('shouldShowResumeOverlay: no meaningful saved progress (<=5s) never shows the overlay, autoplay or not', () => {
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 5, autoplayAdvance: false }), false);
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 0, autoplayAdvance: false }), false);
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 5, autoplayAdvance: true }), false);
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 0, autoplayAdvance: true }), false);
});

// D2 conversion note: this is the OLD "progress just over the (old, fixed)
// 5s threshold shows the overlay" test -- 5.1s is now well below the new
// ~60s default, so the assertion flips to false. A NEW test just below
// covers the equivalent "just under the (new) threshold" case at the actual
// new boundary.
test('shouldShowResumeOverlay: progress just over the OLD fixed 5s cutoff still skips under the new, higher default threshold', () => {
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 5.1, autoplayAdvance: false }), false);
});

test('shouldShowResumeOverlay: progress just under the new default threshold skips; just at/over it shows', () => {
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 59.9, autoplayAdvance: false }), false);
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 60.1, autoplayAdvance: false }), true);
});

test('shouldShowResumeOverlay: a missing/undefined ctx is treated as no progress, no autoplay -- never shows, never throws', () => {
  assert.strictEqual(shouldShowResumeOverlay(undefined), false);
  assert.strictEqual(shouldShowResumeOverlay({}), false);
});

// ---- shouldShowResumeOverlay: a custom stored threshold (ctx.threshold) ----
// (`ctx.threshold` is what the live call site -- getStoredResumeThreshold(),
// player.js -- supplies after reading+validating localStorage; these tests
// exercise the pure decision's own honoring of whatever value it's given.)

test('shouldShowResumeOverlay: a custom (lower) threshold shows the overlay for progress that would be skipped under the default', () => {
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 20, autoplayAdvance: false, threshold: 15 }), true);
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 10, autoplayAdvance: false, threshold: 15 }), false);
});

test('shouldShowResumeOverlay: a custom (higher) threshold skips progress that would show under the default', () => {
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 90, autoplayAdvance: false, threshold: 120 }), false);
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 150, autoplayAdvance: false, threshold: 120 }), true);
});

test('shouldShowResumeOverlay: an invalid ctx.threshold (garbage/negative/missing) falls back to the 60s default', () => {
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 42, autoplayAdvance: false, threshold: 'garbage' }), false); // 42 < 60 default
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 90, autoplayAdvance: false, threshold: -5 }), true); // 90 >= 60 default
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 90, autoplayAdvance: false }), true); // threshold omitted entirely
});

test('shouldShowResumeOverlay: threshold 0 ("always prompt") prompts for ANY real progress but NEVER for a never-watched (0s) video', () => {
  // v1.24.4 gate fix: the `> 0` guard. threshold 0 is a valid opt-in
  // ("always prompt, even for 1s"), but a fresh video with 0 saved progress
  // must not surface a pointless "Resume at 0:00" overlay (0 >= 0 would).
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 1, autoplayAdvance: false, threshold: 0 }), true); // 1s of real progress -> prompt
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 0, autoplayAdvance: false, threshold: 0 }), false); // never-watched -> never prompt
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 0, autoplayAdvance: false }), false); // 0 progress at the default threshold too
});

// ---- resolveResumeThreshold (the pure validator behind both ctx.threshold
// fallback above and the live localStorage read, getStoredResumeThreshold) --

test('resolveResumeThreshold: a valid non-negative numeric or numeric-string value is passed through unchanged', () => {
  assert.strictEqual(resolveResumeThreshold(30), 30);
  assert.strictEqual(resolveResumeThreshold('30'), 30);
  assert.strictEqual(resolveResumeThreshold(0), 0); // "always prompt" is a valid opt-in, not garbage
  assert.strictEqual(resolveResumeThreshold(120.5), 120.5);
});

test('resolveResumeThreshold: garbage, negative, or missing/localStorage-disabled values fall back to the 60s default', () => {
  assert.strictEqual(resolveResumeThreshold('garbage'), 60);
  assert.strictEqual(resolveResumeThreshold(-10), 60);
  assert.strictEqual(resolveResumeThreshold(null), 60); // localStorage.getItem's "missing key" result
  assert.strictEqual(resolveResumeThreshold(undefined), 60);
  assert.strictEqual(resolveResumeThreshold(''), 60);
  assert.strictEqual(resolveResumeThreshold(NaN), 60);
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

  // Load B: the user manually opens a DIFFERENT video with saved progress
  // ABOVE the default threshold. Pre-fix, handleResumePlayback would have
  // read a leaked `true` here. Post-fix, load B captures its OWN (correctly
  // false) snapshot at its own load start.
  const loadBCapture = captureAutoplayAdvanceForLoad(autoplayAdvancePending);
  assert.strictEqual(loadBCapture.value, false);
  assert.strictEqual(shouldShowResumeOverlay({ savedProgress: 90, autoplayAdvance: loadBCapture.value }), true);
});
