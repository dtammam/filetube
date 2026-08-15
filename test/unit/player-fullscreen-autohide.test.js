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
  assert.match(body, /if \(!inImmersiveMode\(\)\) return;/, 'only arms in an immersive overlay');
  // v1.124 F2: the mobile-only bail is GONE - desktop immersive views auto-hide
  // too (with a mousemove reveal). The immersive gate above still keeps INLINE
  // (reserved-strip) always-visible.
  assert.ok(!/if \(!isMobileFormFactor\(\)\) return;/.test(body),
    'v1.124 F2: the mobile-only exclusion must be removed so desktop immersive auto-hides');
  assert.match(body, /if \(!mediaPlayer \|\| mediaPlayer\.paused \|\| mediaPlayer\.ended\) return;/, 'never arms while paused/ended (bar stays up)');
  // The fire callback RE-checks the same guards (a pause/exit during the window
  // cancels the hide) AND never hides mid-scrub (a seek drag never pauses, so
  // `!paused` alone would fade the seek bar under the finger -- gate WARNING).
  assert.match(body, /setTimeout\(function \(\) \{[\s\S]*?inImmersiveMode\(\) && mediaPlayer && !mediaPlayer\.paused && !mediaPlayer\.ended && !isScrubbing[\s\S]*?classList\.add\('controls-autohidden'\)/,
    'the fire callback re-checks faux + playing + NOT scrubbing before hiding');
});

test('v1.124.1: inImmersiveMode treats NATIVE fullscreen as immersive (desktop fs-btn adds no class)', () => {
  // Dean's device pass caught v1.124 F2 inert on desktop: the fs-btn uses
  // requestFullscreen() (native, classless), and the gate only knew the faux/
  // audio classes. The gate must also accept document.fullscreenElement inside
  // the host. Source-lock + executable proof of the gate expression.
  const m = /function inImmersiveMode\(\) \{([\s\S]*?)\n {2}\}/.exec(SRC);
  assert.ok(m, 'inImmersiveMode exists');
  assert.match(m[1], /document\.fullscreenElement && host\.contains\(document\.fullscreenElement\)/,
    'the gate must accept a native fullscreen element inside the host');

  // Executable proof of the same shape: class OR contained fullscreenElement.
  function immersive(host, doc) {
    if (!host) return false;
    if (host.classes.includes('css-fullscreen') || host.classes.includes('audio-expanded')) return true;
    return !!(doc.fullscreenElement && host.contains(doc.fullscreenElement));
  }
  const mkHost = (classes, containedEls) => ({ classes, contains: (el) => containedEls.includes(el) });
  const video = {};
  assert.strictEqual(immersive(mkHost([], []), { fullscreenElement: null }), false, 'inline is never immersive');
  assert.strictEqual(immersive(mkHost(['css-fullscreen'], []), { fullscreenElement: null }), true, 'faux still immersive');
  assert.strictEqual(immersive(mkHost([], [video]), { fullscreenElement: video }), true, 'NATIVE fullscreen (host or child) is immersive');
  assert.strictEqual(immersive(mkHost([], []), { fullscreenElement: video }), false, 'someone else\'s fullscreen element is not ours');
});

test('v1.124.1: a fullscreenchange transition arms the fade (enter) / restores the bar (exit)', () => {
  // Entering native fullscreen mid-playback fires no `play` event, so without
  // this listener nothing armed the fade - the exact no-fade Dean reported.
  assert.match(SRC,
    /document\.addEventListener\('fullscreenchange', function \(\) \{\s*\n\s*if \(inImmersiveMode\(\)\) revealControlsAndReArm\(\);\s*\n\s*else \{ clearControlsAutoHide\(\); showControlsBar\(\); \}\s*\n\s*\}\);/,
    'expected a fullscreenchange listener mirroring setCssFullscreen\'s arm/clear');
});

test('v1.124.1: the native :fullscreen CSS twins exist (transition, fade, cursor)', () => {
  assert.match(STYLE_CSS, /\.player-container:fullscreen \.player-controls \{\s*\n\s*transition: opacity/,
    'native fullscreen bar needs the fade transition');
  assert.match(STYLE_CSS, /\.player-container:fullscreen\.controls-autohidden \.player-controls/,
    'native fullscreen needs the autohidden opacity/pointer-events rule');
  assert.match(STYLE_CSS, /\.player-container:fullscreen\.controls-autohidden \{[\s\S]{0,80}cursor: none/,
    'native fullscreen hides the cursor with the bar');
});

test('v1.124 F2: a host mousemove reveals the auto-hidden bar and re-arms the fade (desktop reveal path)', () => {
  // Desktop has no touch; the mousemove reveal is what lets the bar come back
  // (and the cursor with it) after it auto-hides. Guarded by inImmersiveMode so
  // inline is never affected.
  assert.match(SRC, /host\.addEventListener\('mousemove', function \(\) \{ if \(inImmersiveMode\(\)\) revealControlsAndReArm\(\); \}\);/,
    'expected a host mousemove listener that reveals + re-arms in immersive mode');
});

test('v1.124 F2: the cursor hides with the controls in faux fullscreen (YouTube convention)', () => {
  assert.match(STYLE_CSS, /#player-wrapper\.css-fullscreen\.controls-autohidden,\s*\n\s*\.player-container:fullscreen\.controls-autohidden \{\s*\n\s*cursor: none;/,
    'expected cursor:none on the auto-hidden faux-fullscreen wrapper');
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

test('a tap on the video or the bar reveals + re-arms (additive/passive; skip-gesture untouched)', () => {
  // Reveal listeners on the video + bar, gated on an immersive overlay, passive.
  const loop = /\['touchstart', 'pointerdown'\]\.forEach\(function \(evt\) \{([\s\S]*?)\n {4}\}\);/.exec(SRC);
  assert.ok(loop, 'the reveal-listener loop exists');
  assert.match(loop[1], /mediaPlayer\.addEventListener\(evt, function \(\) \{ if \(inImmersiveMode\(\)\) revealControlsAndReArm\(\); \}, \{ passive: true \}\);/, 'video reveal');
  assert.match(loop[1], /playerControls\.addEventListener\(evt, function \(\) \{ if \(inImmersiveMode\(\)\) revealControlsAndReArm\(\); \}, \{ passive: true \}\);/, 'bar reveal');
  // v1.120 gate fix: the audio cover art is NOT in this blind-reveal loop -- its
  // own click handler reveals-without-toggling (a blind reveal here would also
  // toggle play/pause on the same tap).
  assert.ok(!/audioBgArt\.addEventListener\(evt,/.test(loop[1]), 'audio art must NOT be a blind-reveal surface');
});

test('v1.120: an audio cover-art tap reveals a HIDDEN bar without toggling playback (on TOUCH, not just mouse)', () => {
  // Gate-round fix: the reveal-if-hidden logic lives in artSingleTapOrReveal,
  // which is the action wired to the TOUCH single-tap (wireSkipHoldGestures'
  // onSingleTap -> scheduleArtSingleTap(onSingleTap)). This is the iOS path,
  // where a touchend preventDefault suppresses the synthetic 'click' -- so a
  // reveal guard in the click handler alone was DEAD on a phone.
  const fn = /function artSingleTapOrReveal\(\) \{([\s\S]*?)\n {2}\}/.exec(SRC);
  assert.ok(fn, 'artSingleTapOrReveal exists');
  assert.match(fn[1], /if \(inImmersiveMode\(\) && host && host\.classList\.contains\('controls-autohidden'\)\) \{\s*revealControlsAndReArm\(\);\s*return;\s*\}[\s\S]*?toggleArtPlayPause\(\);/,
    'reveal-if-hidden short-circuits BEFORE the play/pause toggle');
  // It is the TOUCH single-tap action (the real iOS reveal path), not a
  // click-only guard.
  assert.match(SRC, /wireSkipHoldGestures\(audioBgArt, artSingleTapOrReveal\)/, 'the touch single-tap routes through the reveal-or-toggle action');
  // And the mouse click path uses the SAME action (parity).
  assert.match(SRC, /scheduleArtSingleTap\(artSingleTapOrReveal\)/, 'the click path uses the same action');
});

test('inImmersiveMode covers BOTH video faux fullscreen AND the audio expanded view', () => {
  const m = /function inImmersiveMode\(\) \{([\s\S]*?)\n {2}\}/.exec(SRC);
  assert.ok(m, 'inImmersiveMode exists');
  assert.match(m[1], /classList\.contains\('css-fullscreen'\) \|\| host\.classList\.contains\('audio-expanded'\)/,
    'the one shared predicate is css-fullscreen OR audio-expanded');
});

// ---- CSS ------------------------------------------------------------------

test('CSS: the auto-hidden bar is opacity 0 + pointer-events none for BOTH overlays, with a tokenised transition', () => {
  // The hidden state is a comma-group covering video faux fullscreen AND the
  // audio expanded view.
  assert.match(STYLE_CSS, /#player-wrapper\.css-fullscreen\.controls-autohidden \.player-controls,\s*\n\s*\.player-container:fullscreen\.controls-autohidden \.player-controls,\s*\n\s*#player-wrapper\.audio-mode\.audio-expanded\.controls-autohidden \.player-controls \{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/,
    'both overlays fade the bar and let taps pass through');
  assert.match(STYLE_CSS, /#player-wrapper\.css-fullscreen \.player-controls \{[^}]*transition:\s*opacity var\(--dur-slow\) var\(--ease-ui\);/,
    'the video bar transitions opacity via motion TOKENS (census-clean)');
  assert.match(STYLE_CSS, /#player-wrapper\.audio-mode\.audio-expanded \.player-controls \{[^}]*transition:\s*opacity var\(--dur-slow\) var\(--ease-ui\);/,
    'the audio expanded bar transitions the same way (parity)');
  assert.match(STYLE_CSS, /@media \(prefers-reduced-motion: reduce\) \{\s*#player-wrapper\.css-fullscreen \.player-controls,\s*\n\s*\.player-container:fullscreen \.player-controls,\s*\n\s*#player-wrapper\.audio-mode\.audio-expanded \.player-controls \{ transition: none; \}/,
    'reduced-motion users get an instant toggle on both');
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
