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

test('gate C1: the VIDEO down listener registers on exactly ONE event (the pointerdown+touchstart double-fire zeroed the stamp)', () => {
  // One physical touch fires BOTH events; two invocations were not
  // idempotent (the first's reveal removed the class the second read).
  assert.match(PLAYER_JS, /var videoDownEvt = \(typeof window !== 'undefined' && window\.PointerEvent\) \? 'pointerdown' : 'touchstart';/);
  assert.match(PLAYER_JS, /mediaPlayer\.addEventListener\(videoDownEvt, function \(\) \{/);
  // The two-event loop must contain ONLY the bar's stamp-less blind reveal -
  // re-adding mediaPlayer there resurrects the double-fire.
  const loop = /\['touchstart', 'pointerdown'\]\.forEach\(function \(evt\) \{([\s\S]*?)\n {4}\}\);/.exec(PLAYER_JS);
  assert.ok(loop, 'the bar reveal loop exists');
  assert.ok(!/mediaPlayer/.test(loop[1]), 'mediaPlayer must NOT be in the two-event loop');
});

test('the stamp write routes through nextVideoTapStamp BEFORE the reveal strips the class it reads', () => {
  const listener = /if \(!inImmersiveMode\(\)\) \{ videoTapConsumedByRevealAt = 0; return; \}([\s\S]*?)\}, \{ passive: true \}\);/.exec(PLAYER_JS);
  assert.ok(listener, 'blind-reveal listener body not found');
  const stampIdx = listener[1].indexOf('videoTapConsumedByRevealAt = nextVideoTapStamp(');
  const revealIdx = listener[1].indexOf('revealControlsAndReArm();');
  assert.ok(stampIdx !== -1 && revealIdx !== -1, 'stamp call + reveal present');
  assert.ok(stampIdx < revealIdx, 'the stamp MUST precede the reveal');
  assert.match(listener[1], /host\.classList\.contains\('controls-autohidden'\)/, 'the hidden read feeds the pure stamp function');
});

test('gate W1: the consume window absorbs dwell + the 350ms debounce; both constants variableized', () => {
  // 600 left only 250ms dwell budget; hold-to-2x caps playing-tap dwell at
  // HOLD_MS (500), so 500 + 350 + slack = 1000 covers every classifiable tap.
  assert.match(PLAYER_JS, /var VIDEO_TAP_REVEAL_CONSUME_MS = 1000;/);
  assert.match(PLAYER_JS, /var VIDEO_TAP_SAME_GESTURE_MS = 150;/);
});

test('gate W2: a drag past tolerance vetoes ONLY the single-tap scheduling (scroll-on-video must never pause)', () => {
  assert.match(PLAYER_JS, /tapGestureMoved = false; \/\/ gate W2 .*fresh gesture/);
  const move = /el\.addEventListener\('touchmove', function \(e\) \{([\s\S]*?)\}, \{ passive: true \}\);/.exec(PLAYER_JS);
  assert.ok(move, 'touchmove handler not found');
  // Gate W-DELTA (delta round 2): the veto must be pinned INSIDE the
  // MOVE_TOL conjunct - hoisted to fire on ANY touchmove, sub-tolerance
  // thumb jitter (the v1.22.1 class) would veto ordinary taps and
  // tap-to-pause would go intermittently dead, all green.
  assert.match(move[1], /if \(Math\.abs\(t\.clientX - startX\) > MOVE_TOL \|\| Math\.abs\(t\.clientY - startY\) > MOVE_TOL\) \{[\s\S]*?tapGestureMoved = true;/,
    'the veto sets ONLY past the movement tolerance');
  // ...and EXACTLY once - an ADDED unconditional set above the conjunct is
  // the same harm as a moved one (my own M11 repro survived the pin alone:
  // I ADDED a hoisted set where the reviewer MOVED it; both variants must red).
  assert.strictEqual((move[1].match(/tapGestureMoved = true;/g) || []).length, 1,
    'exactly one veto set in the touchmove handler, inside the conjunct');
  assert.match(PLAYER_JS, /if \(shouldArtSingleTapAct\(state, onSingleTap\) && !tapGestureMoved\) \{/,
    'the veto gates exactly the scheduling conjunct - skip/hold/double-tap paths untouched');
});

// ---- nextVideoTapStamp (pure) - the C1 idempotence belt, BEHAVIORALLY ------

const { nextVideoTapStamp } = require('../../public/js/player.js');

test('C1 double-fire sequence: the second down event of the SAME gesture preserves the stamp the first wrote', () => {
  // The reviewer's sim as a pure two-step: down#1 sees the hidden bar and
  // stamps; its reveal makes the bar visible; down#2 (same touch, ms later)
  // reads visible + a fresh stamp -> must PRESERVE, not zero. This is the
  // exact sequence that paused-on-reveal in the shipped round-1 shape.
  const t0 = 100000;
  const first = nextVideoTapStamp(true, 0, t0, 150);
  assert.strictEqual(first, t0, 'hidden bar -> stamp now');
  const second = nextVideoTapStamp(false, first, t0 + 5, 150);
  assert.strictEqual(second, t0, 'same-gesture double-fire must preserve the stamp');
});

test('a genuinely LATER gesture against a visible bar zeroes the stamp (no cross-gesture leakage)', () => {
  assert.strictEqual(nextVideoTapStamp(false, 100000, 100300, 150), 0, 'a 300ms-later down is a new gesture');
  assert.strictEqual(nextVideoTapStamp(false, 100000, 100150, 150), 0, 'exactly the epsilon -> new gesture (exclusive boundary)');
  assert.strictEqual(nextVideoTapStamp(false, 0, 100000, 150), 0, 'no prior stamp -> stays zero');
  assert.strictEqual(nextVideoTapStamp(false, null, 100000, 150), 0, 'garbage prior -> zero');
});
