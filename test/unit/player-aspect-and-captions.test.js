'use strict';

// [UNIT] Two v1.26.1 features' pure helpers, extracted from the persistent
// player controller (public/js/player.js) so they're directly node:test-able
// with no DOM/browser harness (this codebase has none -- see CONTRIBUTING.md).
// The DOM-heavy wiring around them (applyMediaAspect's --media-aspect/
// .portrait-media class toggling, renderActiveCueOverlay's textContent
// writes, the cc-btn/cuechange listeners) is NOT covered here -- Dean's
// on-device pass is the documented arbiter for that feel, matching every
// other DOM-adjacent player.js suite in this repo.
//
// Feature A (Shorts player-size jump): computeMediaAspectRatio/
// isPortraitMediaAspect -- the reserved-aspect CSS custom-property value +
// the mobile-portrait height-clamp marker decision.
// Feature B (audio-mode caption overlay): stripVttCueTags/
// buildCaptionOverlayText -- the VTT-markup-stripping + multi-cue-join logic
// behind the custom overlay iOS needs (native <track> rendering can't paint
// over the cover-art layer in audio mode).
const { test } = require('node:test');
const assert = require('node:assert');
const {
  computeMediaAspectRatio,
  isPortraitMediaAspect,
  mediaAspectOrientationMismatch,
  stripVttCueTags,
  buildCaptionOverlayText,
} = require('../../public/js/player.js');

// ---------------------------------------------------------------------------
// computeMediaAspectRatio
// ---------------------------------------------------------------------------

test('computeMediaAspectRatio: returns a valid CSS aspect-ratio "W / H" string for landscape (16:9) dimensions', () => {
  assert.strictEqual(computeMediaAspectRatio(1920, 1080), '1920 / 1080');
});

test('computeMediaAspectRatio: returns a valid CSS aspect-ratio "W / H" string for portrait (9:16, Shorts-style) dimensions', () => {
  assert.strictEqual(computeMediaAspectRatio(1080, 1920), '1080 / 1920');
});

test('computeMediaAspectRatio: returns a valid CSS aspect-ratio "W / H" string for 4:3 dimensions', () => {
  assert.strictEqual(computeMediaAspectRatio(640, 480), '640 / 480');
});

test('computeMediaAspectRatio: returns null for missing/undefined width or height -- callers fall back to the CSS var(--media-aspect, 16/9) default', () => {
  assert.strictEqual(computeMediaAspectRatio(undefined, 1080), null);
  assert.strictEqual(computeMediaAspectRatio(1920, undefined), null);
  assert.strictEqual(computeMediaAspectRatio(undefined, undefined), null);
  assert.strictEqual(computeMediaAspectRatio(null, null), null);
});

test('computeMediaAspectRatio: returns null for zero, negative, NaN, or Infinity input', () => {
  assert.strictEqual(computeMediaAspectRatio(0, 1080), null);
  assert.strictEqual(computeMediaAspectRatio(1920, -1), null);
  assert.strictEqual(computeMediaAspectRatio(NaN, 1080), null);
  assert.strictEqual(computeMediaAspectRatio(1920, Infinity), null);
});

test('computeMediaAspectRatio: accepts numeric strings (Number() coercion) the same way the server-provided data.width/data.height might arrive after a JSON round-trip', () => {
  assert.strictEqual(computeMediaAspectRatio('1080', '1920'), '1080 / 1920');
});

// ---------------------------------------------------------------------------
// isPortraitMediaAspect
// ---------------------------------------------------------------------------

test('isPortraitMediaAspect: true for genuinely taller-than-wide (portrait/Shorts-style) dimensions', () => {
  assert.strictEqual(isPortraitMediaAspect(1080, 1920), true);
  assert.strictEqual(isPortraitMediaAspect(9, 16), true);
});

test('isPortraitMediaAspect: false for landscape (16:9) and 4:3 dimensions', () => {
  assert.strictEqual(isPortraitMediaAspect(1920, 1080), false);
  assert.strictEqual(isPortraitMediaAspect(640, 480), false);
});

test('isPortraitMediaAspect: false for exactly square dimensions', () => {
  assert.strictEqual(isPortraitMediaAspect(1000, 1000), false);
});

test('isPortraitMediaAspect: false (the safe default) for missing/invalid input', () => {
  assert.strictEqual(isPortraitMediaAspect(undefined, undefined), false);
  assert.strictEqual(isPortraitMediaAspect(0, 1920), false);
  assert.strictEqual(isPortraitMediaAspect(NaN, 1920), false);
});

// ---------------------------------------------------------------------------
// mediaAspectOrientationMismatch (F2, v1.26.1 two-reviewer follow-up)
// ---------------------------------------------------------------------------

test('mediaAspectOrientationMismatch: true when stored dims are landscape but the browser reports portrait', () => {
  assert.strictEqual(mediaAspectOrientationMismatch(1920, 1080, 1080, 1920), true);
});

test('mediaAspectOrientationMismatch: true when stored dims are portrait but the browser reports landscape', () => {
  assert.strictEqual(mediaAspectOrientationMismatch(1080, 1920, 1920, 1080), true);
});

test('mediaAspectOrientationMismatch: false when both sides agree (landscape/landscape)', () => {
  assert.strictEqual(mediaAspectOrientationMismatch(1920, 1080, 1920, 1080), false);
});

test('mediaAspectOrientationMismatch: false when both sides agree (portrait/portrait), even if the exact values differ', () => {
  assert.strictEqual(mediaAspectOrientationMismatch(1080, 1920, 1088, 1936), false);
});

test('mediaAspectOrientationMismatch: false when either side is missing/invalid -- never spuriously heals from bad input', () => {
  assert.strictEqual(mediaAspectOrientationMismatch(undefined, undefined, 1080, 1920), false);
  assert.strictEqual(mediaAspectOrientationMismatch(1920, 1080, undefined, undefined), false);
  assert.strictEqual(mediaAspectOrientationMismatch(0, 1080, 1080, 1920), false);
  assert.strictEqual(mediaAspectOrientationMismatch(1920, 1080, NaN, 1920), false);
});

test('mediaAspectOrientationMismatch: false for square dims on either side (isPortraitMediaAspect\'s own "false" default for non-taller-than-wide)', () => {
  assert.strictEqual(mediaAspectOrientationMismatch(1000, 1000, 1080, 1920), true, 'square-vs-portrait: isPortraitMediaAspect(1000,1000) is false, isPortraitMediaAspect(1080,1920) is true -- these DO disagree');
  assert.strictEqual(mediaAspectOrientationMismatch(1000, 1000, 1920, 1080), false, 'square-vs-landscape: both resolve to isPortraitMediaAspect === false -- no mismatch');
});

// ---------------------------------------------------------------------------
// stripVttCueTags
// ---------------------------------------------------------------------------

test('stripVttCueTags: strips a voice tag, leaving the spoken text', () => {
  assert.strictEqual(stripVttCueTags('<v Roger Bingham>We are in New York City'), 'We are in New York City');
});

test('stripVttCueTags: strips italic/bold spans', () => {
  assert.strictEqual(stripVttCueTags('<i>whispering</i> something <b>important</b>'), 'whispering something important');
});

test('stripVttCueTags: strips a class span and timestamp tags', () => {
  assert.strictEqual(stripVttCueTags('<c.yellow.bg_blue>Hi</c> <00:00:01.000>there'), 'Hi there');
});

test('stripVttCueTags: plain text with no markup is returned unchanged', () => {
  assert.strictEqual(stripVttCueTags('just plain caption text'), 'just plain caption text');
});

test('stripVttCueTags: non-string input degrades to an empty string, never throws', () => {
  assert.strictEqual(stripVttCueTags(undefined), '');
  assert.strictEqual(stripVttCueTags(null), '');
  assert.strictEqual(stripVttCueTags(42), '');
});

// ---------------------------------------------------------------------------
// buildCaptionOverlayText
// ---------------------------------------------------------------------------

test('buildCaptionOverlayText: a single active cue renders as-is (after tag-stripping)', () => {
  assert.strictEqual(buildCaptionOverlayText(['<v Speaker>Hello there']), 'Hello there');
});

test('buildCaptionOverlayText: multiple SIMULTANEOUSLY active cues are joined one per line', () => {
  assert.strictEqual(buildCaptionOverlayText(['<v A>First line', '<v B>Second line']), 'First line\nSecond line');
});

test('buildCaptionOverlayText: empty/whitespace-only cues (after stripping) are dropped, never rendering a blank line', () => {
  assert.strictEqual(buildCaptionOverlayText(['Real text', '   ', '<i></i>', '']), 'Real text');
});

test('buildCaptionOverlayText: returns "" (never null/undefined) when there is nothing to show -- the overlay-hide signal', () => {
  assert.strictEqual(buildCaptionOverlayText([]), '');
  assert.strictEqual(buildCaptionOverlayText(['', '   ']), '');
  assert.strictEqual(buildCaptionOverlayText(undefined), '');
  assert.strictEqual(buildCaptionOverlayText(null), '');
});

test('buildCaptionOverlayText: each cue is trimmed of leading/trailing whitespace before joining', () => {
  assert.strictEqual(buildCaptionOverlayText(['  padded text  ']), 'padded text');
});
