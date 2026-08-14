'use strict';

// [UNIT] v1.119 (Dean, on-device v1.118 pass): the faux-fullscreen control bar
// OVERLAYS the picture (v1.34.4), so keeping it up permanently blocked the bottom
// of the frame + the captions. It now AUTO-HIDES after a few seconds of no
// interaction while playing, reveals on any tap, and stays up while paused (the
// native convention). Scoped to faux fullscreen only.
//
// player.js's DOM wiring lives inside the `typeof window === 'undefined'`-guarded
// runtime IIFE (not exported), so -- like the sibling player source-lock tests --
// this asserts against the source text. Dean's iOS pass is the runtime arbiter.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
const STYLE_CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

function stripLineComments(src) {
  return src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}
const SRC = stripLineComments(PLAYER_JS);

test('armControlsAutoHide is scoped to faux fullscreen AND never fires while paused/ended', () => {
  const m = /function armControlsAutoHide\(\) \{([\s\S]*?)\n {2}\}/.exec(SRC);
  assert.ok(m, 'armControlsAutoHide exists');
  const body = m[1];
  assert.match(body, /if \(!inFauxFullscreen\(\)\) return;/, 'only arms in faux fullscreen');
  assert.match(body, /if \(!mediaPlayer \|\| mediaPlayer\.paused \|\| mediaPlayer\.ended\) return;/, 'never arms while paused/ended (bar stays up)');
  // The fire callback RE-checks the same guards (a pause/exit during the window
  // cancels the hide) AND never hides mid-scrub (a seek drag never pauses, so
  // `!paused` alone would fade the seek bar under the finger -- gate WARNING).
  assert.match(body, /setTimeout\(function \(\) \{[\s\S]*?inFauxFullscreen\(\) && mediaPlayer && !mediaPlayer\.paused && !mediaPlayer\.ended && !isScrubbing[\s\S]*?classList\.add\('controls-autohidden'\)/,
    'the fire callback re-checks faux + playing + NOT scrubbing before hiding');
});

test('a committed scrub re-arms the fade (bar stays through a long drag, fades after release)', () => {
  // The seek 'change' handler (drag commit) restarts the auto-hide countdown, so
  // after a long scrub the bar reveals + fades again rather than staying stuck.
  assert.match(SRC, /seekBar\.addEventListener\('change', function \(\) \{\s*isScrubbing = false;\s*revealControlsAndReArm\(\);/,
    "the seek 'change' handler re-arms the fade after a scrub commits");
});

test('setCssFullscreen drives the auto-hide cycle (reveal+arm on enter, cancel+show on exit)', () => {
  const m = /function setCssFullscreen\(on, opts\) \{([\s\S]*?)\n {2}\}/.exec(SRC);
  assert.ok(m, 'setCssFullscreen body');
  assert.match(m[1], /if \(on\) revealControlsAndReArm\(\);\s*\n\s*else \{ clearControlsAutoHide\(\); showControlsBar\(\); \}/,
    'enter reveals+arms; exit cancels the timer and restores a visible bar');
});

test('playback events drive the auto-hide: play arms, pause/ended reveal+hold', () => {
  assert.match(SRC, /mediaPlayer\.addEventListener\('play', armControlsAutoHide\);/, 'play arms the fade');
  assert.match(SRC, /mediaPlayer\.addEventListener\('pause', function \(\) \{ clearControlsAutoHide\(\); showControlsBar\(\); \}\);/, 'pause reveals + holds');
  assert.match(SRC, /mediaPlayer\.addEventListener\('ended', function \(\) \{ clearControlsAutoHide\(\); showControlsBar\(\); \}\);/, 'ended reveals + holds');
});

test('any tap on the video OR the bar reveals + re-arms (additive/passive; skip-gesture untouched)', () => {
  // Reveal listeners on BOTH surfaces, gated on faux fullscreen, passive.
  assert.match(SRC, /\['touchstart', 'pointerdown'\]\.forEach\(function \(evt\) \{[\s\S]*?mediaPlayer\.addEventListener\(evt, function \(\) \{ if \(inFauxFullscreen\(\)\) revealControlsAndReArm\(\); \}, \{ passive: true \}\);[\s\S]*?playerControls\.addEventListener\(evt, function \(\) \{ if \(inFauxFullscreen\(\)\) revealControlsAndReArm\(\); \}, \{ passive: true \}\);/,
    'touchstart+pointerdown on video and bar reveal, passive, faux-gated');
});

// ---- CSS ------------------------------------------------------------------

test('CSS: the auto-hidden bar is opacity 0 + pointer-events none, with a tokenised transition', () => {
  assert.match(STYLE_CSS, /#player-wrapper\.css-fullscreen\.controls-autohidden \.player-controls \{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/,
    'the hidden state fades out and lets taps pass through to the video');
  assert.match(STYLE_CSS, /#player-wrapper\.css-fullscreen \.player-controls \{[^}]*transition:\s*opacity var\(--dur-slow\) var\(--ease-ui\);/,
    'the bar transitions opacity via motion TOKENS (census-clean)');
  assert.match(STYLE_CSS, /@media \(prefers-reduced-motion: reduce\) \{\s*#player-wrapper\.css-fullscreen \.player-controls \{ transition: none; \}/,
    'reduced-motion users get an instant toggle');
});

test('CSS: the faux-fullscreen overlay covers the VISUAL viewport edge-to-edge (iOS landscape bleed belt)', () => {
  const m = /#player-wrapper\.css-fullscreen \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(m, 'the .css-fullscreen rule');
  // dvh/dvw with a vh/vw fallback line each -- the belt for the iOS-landscape
  // safe-area strip where `inset:0` alone let the page peek through.
  assert.match(m[1], /height:\s*100vh !important;\s*height:\s*100dvh !important;/, 'height pins to the visual viewport (dvh, vh fallback)');
  assert.match(m[1], /width:\s*100vw !important;\s*width:\s*100dvw !important;/, 'width pins to the visual viewport');
  assert.match(STYLE_CSS, /body\.ft-css-fullscreen \{[^}]*background:\s*#000;/, 'the body paints black as a belt so any sliver reads as letterbox, not page content');
});
