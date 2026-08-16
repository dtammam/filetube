'use strict';

// [UNIT] v1.134 (Dean, 2026-08-16): tap ANYWHERE on the VIDEO surface toggles
// play/pause with the fading cover-art glyph - the iOS "tap the picture"
// convention. Rides the EXISTING gesture layer: wireSkipHoldGestures'
// onSingleTap slot (empty for video since v1.21) is finally filled, so
// double-tap ±15s skip / hold-to-2x / the tap classifier are untouched and
// desktop is byte-identical (the slot is touch-path only).
//
// THE RACE this wave must not re-open (the v1.120 "reveal that pauses"
// class): the video surface carries v1.119 blind-reveal touchstart/
// pointerdown listeners (the audio art deliberately does not), so by
// single-tap classification time a bar the SAME gesture woke is already
// visible and a naive reveal-first guard would toggle. The blind-reveal
// listener therefore stamps videoTapConsumedByRevealAt whenever its own
// touch woke a HIDDEN bar - rewritten on EVERY gesture (immersive hidden ->
// now, immersive visible -> 0, inline -> 0), consumed by the pure
// shouldConsumeTapAsReveal decision.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { shouldConsumeTapAsReveal } = require('../../public/js/player.js');

// ---- shouldConsumeTapAsReveal (pure) ---------------------------------------

test('a fresh stamp within the window consumes the tap', () => {
  assert.strictEqual(shouldConsumeTapAsReveal(1000, 1300, 600), true);
  assert.strictEqual(shouldConsumeTapAsReveal(1000, 1001, 600), true);
});

test('zero/absent stamp NEVER consumes (0 = no pending reveal-consume, the per-gesture reset value)', () => {
  assert.strictEqual(shouldConsumeTapAsReveal(0, 1000, 600), false);
  assert.strictEqual(shouldConsumeTapAsReveal(null, 1000, 600), false);
  assert.strictEqual(shouldConsumeTapAsReveal(undefined, 1000, 600), false);
});

test('the window boundary is exclusive and the comparison direction is bound (the v1.132 W2 arithmetic lesson)', () => {
  assert.strictEqual(shouldConsumeTapAsReveal(1000, 1600, 600), false, 'exactly the window -> stale, do not consume');
  assert.strictEqual(shouldConsumeTapAsReveal(1000, 1599, 600), true, 'one ms inside -> consume');
  assert.strictEqual(shouldConsumeTapAsReveal(1000, 5000, 600), false, 'long stale -> never consume');
});

// ---- source locks (no jsdom player harness - the device pass is the feel arbiter)

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

test('the video call site passes the single-tap callback (the whole feature - reverting to the empty slot goes red)', () => {
  assert.match(PLAYER_JS, /wireSkipHoldGestures\(mediaPlayer, videoSingleTapOrReveal\);/);
  assert.match(PLAYER_JS, /wireSkipHoldGestures\(audioBgArt, artSingleTapOrReveal\);/, 'the art call site is untouched');
});

test('videoSingleTapOrReveal: consume-check FIRST, reveal-first belt SECOND, then the ONE toggle+flash writer', () => {
  const body = /function videoSingleTapOrReveal\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(body, 'videoSingleTapOrReveal body not found');
  const consumeIdx = body[1].indexOf('shouldConsumeTapAsReveal(videoTapConsumedByRevealAt, Date.now(), VIDEO_TAP_REVEAL_CONSUME_MS)');
  const revealIdx = body[1].indexOf("host.classList.contains('controls-autohidden')");
  const toggleIdx = body[1].indexOf('toggleArtPlayPause();');
  assert.ok(consumeIdx !== -1 && revealIdx !== -1 && toggleIdx !== -1, 'all three stages present');
  assert.ok(consumeIdx < revealIdx && revealIdx < toggleIdx, 'stage order: consume -> reveal-first belt -> toggle');
  // Parity by construction: the toggle routes through the art's own
  // toggle+flash writer - no bare play()/pause() may appear here.
  assert.ok(!/mediaPlayer\.(play|pause)\(/.test(body[1]), 'no duplicated playback writes');
});

test('the blind-reveal listener rewrites the stamp on EVERY gesture, reading the hidden state BEFORE revealing', () => {
  // Inline gestures zero it (no cross-mode staleness after a fullscreen exit).
  assert.match(PLAYER_JS, /if \(!inImmersiveMode\(\)\) \{ videoTapConsumedByRevealAt = 0; return; \}/);
  // Immersive: hidden -> stamp now, visible -> 0 - ONE ternary, and it must
  // run before revealControlsAndReArm() strips the class it reads.
  const listener = /if \(!inImmersiveMode\(\)\) \{ videoTapConsumedByRevealAt = 0; return; \}([\s\S]*?)\}, \{ passive: true \}\);/.exec(PLAYER_JS);
  assert.ok(listener, 'blind-reveal listener body not found');
  const stampIdx = listener[1].indexOf("videoTapConsumedByRevealAt = (host && host.classList.contains('controls-autohidden')) ? Date.now() : 0;");
  const revealIdx = listener[1].indexOf('revealControlsAndReArm();');
  assert.ok(stampIdx !== -1 && revealIdx !== -1, 'stamp ternary + reveal present');
  assert.ok(stampIdx < revealIdx, 'the stamp MUST precede the reveal - reversed, the ternary reads an already-revealed bar and never stamps');
});

test('the consume window is variableized and generous-but-bounded', () => {
  assert.match(PLAYER_JS, /var VIDEO_TAP_REVEAL_CONSUME_MS = 600;/);
});
