'use strict';

// [UNIT] The pure helpers extracted from the custom blocky control bar
// (public/js/player.js, FR-2, T2, v1.21.0): `clampVolume` (volume-persistence
// clamp/parse, AC10) and `seekCommitTarget` (the seek bar's scrub-vs-commit
// reducer, AC15/AC16). Also `classifyTapGesture` (v1.21 FIX 1, post-gate
// hardening): the single-vs-double-tap decision table behind
// `wireSkipHoldGestures`'s touchend handling, now shared by BOTH the video
// surface (#media-player) and the audio cover-art surface (#audio-bg-art) --
// see that fix's own doc comment in player.js for the audio-mode dead-
// gesture regression this closes. Also `shouldArtSingleTapAct` (v1.21 FIX A,
// post-post-gate correction): the state gate behind that same touchend
// handler's single-tap branch -- decides whether the audio cover-art tap
// should act (preventDefault + arm the debounced play/pause toggle) or leave
// the tap alone to bubble to `#player-dock`'s tap-to-expand handler. Also
// (v1.22.1) `nextPlaybackRate` (FR-4's `#speed-btn` cycle lookup) and
// `shouldDesktopVideoTapToggle` (FR-5's desktop-only video click-to-toggle
// guard). The DOM-heavy wiring (actual range-input listeners, the rAF fill
// loop, the iOS `volumeIsSettable` feature-detect, cover-art click-to-play,
// fullscreen retarget, the actual touch/mouse event listeners) is
// intentionally NOT covered here (no jsdom/browser harness in this codebase
// -- see CONTRIBUTING.md); Dean's on-device pass (especially iOS Safari) is
// the documented arbiter for that feel, per the exec plan's HEAVIEST-gate
// note for this FR.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  clampVolume,
  seekCommitTarget,
  classifyTapGesture,
  shouldArtSingleTapAct,
  nextPlaybackRate,
  shouldDesktopVideoTapToggle,
} = require('../../public/js/player.js');

// ---- clampVolume -------------------------------------------------------------

test('clampVolume: an in-range value passes through unchanged', () => {
  assert.strictEqual(clampVolume(0.5), 0.5);
  assert.strictEqual(clampVolume('0.5'), 0.5);
  assert.strictEqual(clampVolume(0), 0);
  assert.strictEqual(clampVolume(1), 1);
});

test('clampVolume: an out-of-range but numeric value is clamped to the nearest bound, not rejected', () => {
  assert.strictEqual(clampVolume(1.5), 1);
  assert.strictEqual(clampVolume(-0.3), 0);
  assert.strictEqual(clampVolume('2'), 1);
  assert.strictEqual(clampVolume('-1'), 0);
});

test('clampVolume: garbage/non-numeric input returns null, never NaN or a coerced default', () => {
  assert.strictEqual(clampVolume('abc'), null);
  assert.strictEqual(clampVolume(''), null);
  assert.strictEqual(clampVolume(NaN), null);
  assert.strictEqual(clampVolume(undefined), null);
  assert.strictEqual(clampVolume(null), null);
  assert.strictEqual(clampVolume('not-a-number'), null);
});

test('clampVolume: Infinity/-Infinity are rejected (not finite) rather than silently clamped', () => {
  assert.strictEqual(clampVolume(Infinity), null);
  assert.strictEqual(clampVolume(-Infinity), null);
});

// ---- seekCommitTarget ---------------------------------------------------------

test('seekCommitTarget: a normal (non-live) source resolves the ratio against `duration`', () => {
  assert.strictEqual(seekCommitTarget({ duration: 200, ratio: 0.5, liveMode: false }), 100);
});

test('seekCommitTarget: ratio 0 always resolves to the absolute start, regardless of source', () => {
  assert.strictEqual(seekCommitTarget({ duration: 200, ratio: 0, liveMode: false }), 0);
  assert.strictEqual(seekCommitTarget({ duration: 30, ratio: 0, liveMode: true, liveTotal: 200 }), 0);
});

test('seekCommitTarget: ratio 1 always resolves to the absolute end, regardless of source', () => {
  assert.strictEqual(seekCommitTarget({ duration: 200, ratio: 1, liveMode: false }), 200);
  assert.strictEqual(seekCommitTarget({ duration: 30, ratio: 1, liveMode: true, liveTotal: 200 }), 200);
});

test('seekCommitTarget: a live-transcode source resolves the ratio against `liveTotal` (the full source), NOT the short live-restarted `duration`', () => {
  // mediaPlayer.duration is only ~30s (the currently-live-restarted stream);
  // the real source is 200s (currentData.duration) -- the target must be
  // computed against the latter, mirroring the existing skip() handling.
  assert.strictEqual(seekCommitTarget({ duration: 30, ratio: 0.5, liveMode: true, liveTotal: 200 }), 100);
});

test('seekCommitTarget: a live-transcode source with no liveTotal yet degrades to 0 -- never seeks based on the short live-restarted `duration` (v1.21 FIX 5)', () => {
  // Before FIX 5 this fell back to `duration` (the short buffered stream's
  // own length, e.g. 40s), producing a wildly wrong absolute target for a
  // long real source (e.g. 20s instead of somewhere near the true middle of
  // a 400s video). Now it honestly reports "not yet resolved" (0) instead
  // of a plausible-looking but incorrect number.
  assert.strictEqual(seekCommitTarget({ duration: 40, ratio: 0.5, liveMode: true, liveTotal: undefined }), 0);
  assert.strictEqual(seekCommitTarget({ duration: 40, ratio: 0.5, liveMode: true, liveTotal: 0 }), 0);
  assert.strictEqual(seekCommitTarget({ duration: 40, ratio: 0.5, liveMode: true, liveTotal: NaN }), 0);
});

test('seekCommitTarget: an out-of-range ratio is clamped into [0,1] rather than producing a negative/overshooting target', () => {
  assert.strictEqual(seekCommitTarget({ duration: 200, ratio: -0.5, liveMode: false }), 0);
  assert.strictEqual(seekCommitTarget({ duration: 200, ratio: 1.5, liveMode: false }), 200);
});

test('seekCommitTarget: a not-yet-resolved duration (0/NaN/Infinity) degrades to 0, never NaN', () => {
  assert.strictEqual(seekCommitTarget({ duration: 0, ratio: 0.5, liveMode: false }), 0);
  assert.strictEqual(seekCommitTarget({ duration: NaN, ratio: 0.5, liveMode: false }), 0);
  assert.strictEqual(seekCommitTarget({ duration: Infinity, ratio: 0.5, liveMode: false }), 0);
});

test('seekCommitTarget: a missing/undefined ctx never throws and degrades to 0', () => {
  assert.strictEqual(seekCommitTarget(undefined), 0);
  assert.strictEqual(seekCommitTarget({}), 0);
});

// ---- classifyTapGesture (v1.21 FIX 1) ---------------------------------------

test('classifyTapGesture: a lone tap (no prior tap yet) is a single-tap candidate', () => {
  assert.strictEqual(
    classifyTapGesture({ now: 1000, lastTapTime: 0, lastTapLeft: false, onLeft: true, doubleTapMs: 350 }),
    'single-tap'
  );
});

test('classifyTapGesture: a second tap on the SAME side within the window is a double-tap-skip toward that side', () => {
  assert.strictEqual(
    classifyTapGesture({ now: 1200, lastTapTime: 1000, lastTapLeft: true, onLeft: true, doubleTapMs: 350 }),
    'skip-back'
  );
  assert.strictEqual(
    classifyTapGesture({ now: 1200, lastTapTime: 1000, lastTapLeft: false, onLeft: false, doubleTapMs: 350 }),
    'skip-fwd'
  );
});

test('classifyTapGesture: a second tap on the OPPOSITE side is treated as a fresh single-tap candidate, not a double-tap', () => {
  assert.strictEqual(
    classifyTapGesture({ now: 1200, lastTapTime: 1000, lastTapLeft: true, onLeft: false, doubleTapMs: 350 }),
    'single-tap'
  );
});

test('classifyTapGesture: a second tap AFTER the double-tap window has elapsed is a fresh single-tap candidate', () => {
  assert.strictEqual(
    classifyTapGesture({ now: 1400, lastTapTime: 1000, lastTapLeft: true, onLeft: true, doubleTapMs: 350 }),
    'single-tap'
  );
});

test('classifyTapGesture: a zero or negative gap (clock skew/duplicate event) never misclassifies as a double-tap', () => {
  assert.strictEqual(
    classifyTapGesture({ now: 1000, lastTapTime: 1000, lastTapLeft: true, onLeft: true, doubleTapMs: 350 }),
    'single-tap'
  );
  assert.strictEqual(
    classifyTapGesture({ now: 900, lastTapTime: 1000, lastTapLeft: true, onLeft: true, doubleTapMs: 350 }),
    'single-tap'
  );
});

test('classifyTapGesture: a missing/undefined ctx never throws and degrades to single-tap', () => {
  assert.strictEqual(classifyTapGesture(undefined), 'single-tap');
  assert.strictEqual(classifyTapGesture({}), 'single-tap');
});

// ---- shouldArtSingleTapAct (v1.21 FIX A) --------------------------------------

test('shouldArtSingleTapAct: acts (true) for the audio cover-art single tap while FULL', () => {
  assert.strictEqual(shouldArtSingleTapAct('full', function () {}), true);
});

test('shouldArtSingleTapAct: does NOT act while DOCKED, even with an onSingleTap callback -- so the tap bubbles to the dock\'s tap-to-expand handler instead of toggling play/pause', () => {
  assert.strictEqual(shouldArtSingleTapAct('docked', function () {}), false);
});

test('shouldArtSingleTapAct: does NOT act while CLOSED (or any other non-FULL state)', () => {
  assert.strictEqual(shouldArtSingleTapAct('closed', function () {}), false);
  assert.strictEqual(shouldArtSingleTapAct('anything-else', function () {}), false);
});

test('shouldArtSingleTapAct: never acts with no onSingleTap at all (the video surface), even while FULL', () => {
  assert.strictEqual(shouldArtSingleTapAct('full', undefined), false);
  assert.strictEqual(shouldArtSingleTapAct('full', null), false);
});

// ---- nextPlaybackRate (FR-4, v1.22.1) ----------------------------------------

test('nextPlaybackRate: steps forward through the fixed rate cycle', () => {
  assert.strictEqual(nextPlaybackRate(1), 1.25);
  assert.strictEqual(nextPlaybackRate(1.25), 1.5);
  assert.strictEqual(nextPlaybackRate(1.5), 1.75);
  assert.strictEqual(nextPlaybackRate(1.75), 2);
});

test('nextPlaybackRate: wraps from the fastest rate back to the slowest', () => {
  assert.strictEqual(nextPlaybackRate(2), 1);
});

test('nextPlaybackRate: an unrecognized/foreign current rate degrades to the first rate in the cycle, never throws', () => {
  assert.strictEqual(nextPlaybackRate(3), 1);
  assert.strictEqual(nextPlaybackRate(0), 1);
  assert.strictEqual(nextPlaybackRate(undefined), 1);
  assert.strictEqual(nextPlaybackRate(null), 1);
  assert.strictEqual(nextPlaybackRate(NaN), 1);
});

// ---- shouldDesktopVideoTapToggle (FR-5, v1.22.1) -----------------------------

test('shouldDesktopVideoTapToggle: acts (true) on desktop while FULL', () => {
  assert.strictEqual(shouldDesktopVideoTapToggle('full', false), true);
});

test('shouldDesktopVideoTapToggle: does NOT act on mobile, even while FULL (AC29 -- desktop-only)', () => {
  assert.strictEqual(shouldDesktopVideoTapToggle('full', true), false);
});

test('shouldDesktopVideoTapToggle: does NOT act while DOCKED or CLOSED, even on desktop', () => {
  assert.strictEqual(shouldDesktopVideoTapToggle('docked', false), false);
  assert.strictEqual(shouldDesktopVideoTapToggle('closed', false), false);
});

// ---- FIX 1 (v1.22.1 gate round): persisted rate must survive mediaPlayer.load() ---
// `mediaPlayer.load()` (called by teardownMediaState() on every genuine new
// item and by startLiveStream() on every desktop live-transcode skip/seek)
// resets `playbackRate` back to `defaultPlaybackRate` per the HTML media load
// algorithm. Both places that set the PERSISTENT rate (initPlaybackRate() and
// the #speed-btn click handler) must therefore set `defaultPlaybackRate`
// ALONGSIDE `playbackRate`, so the browser preserves the chosen rate across
// every future load automatically. The TRANSIENT hold-2x path (engageHold/
// releaseHold) must do the opposite -- touch ONLY `playbackRate` -- otherwise
// a press-and-hold gesture would leak into becoming the new persistent base
// rate. No jsdom/browser harness in this codebase (see CONTRIBUTING.md), so
// this is locked directly against the source text, mirroring
// test/unit/player-form-factor.test.js's applyControlsMode() source-contract
// posture.

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
const initPlaybackRateMatch = /function initPlaybackRate\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
const speedBtnClickMatch = /speedBtn\.addEventListener\(\s*['"]click['"],\s*function \(\) \{([\s\S]*?)\n {6}\}\);/.exec(PLAYER_JS);
const engageHoldMatch = /function engageHold\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
const releaseHoldMatch = /function releaseHold\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);

test('FIX 1: initPlaybackRate() and the #speed-btn click handler are found for inspection', () => {
  assert.ok(initPlaybackRateMatch, 'expected to find initPlaybackRate()\'s source body in player.js');
  assert.ok(speedBtnClickMatch, 'expected to find the #speed-btn click handler\'s source body in player.js');
  assert.ok(engageHoldMatch, 'expected to find engageHold()\'s source body in player.js');
  assert.ok(releaseHoldMatch, 'expected to find releaseHold()\'s source body in player.js');
});

test('FIX 1: initPlaybackRate() sets defaultPlaybackRate alongside playbackRate -- the stored rate must survive every future load()', () => {
  const body = initPlaybackRateMatch[1];
  assert.match(body, /mediaPlayer\.playbackRate\s*=\s*rate\s*;/);
  assert.match(body, /mediaPlayer\.defaultPlaybackRate\s*=\s*rate\s*;/);
});

test('FIX 1: the #speed-btn click handler sets defaultPlaybackRate alongside playbackRate -- a manually-chosen rate must also survive every future load()', () => {
  // v1.41.11: the trio (playbackRate + defaultPlaybackRate + label/persist)
  // moved from the click handler into the shared applyPlaybackRate() so the
  // new </> keyboard shortcuts can never diverge from the button. The lock
  // follows: the click handler must route through applyPlaybackRate, and
  // applyPlaybackRate must still carry FIX 1's defaultPlaybackRate write.
  const body = speedBtnClickMatch[1];
  assert.match(body, /applyPlaybackRate\(nextPlaybackRate\(mediaPlayer\.playbackRate\)\)/);
  const applyMatch = /function applyPlaybackRate\(rate\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(applyMatch, 'expected to find applyPlaybackRate()\'s source body in player.js');
  assert.match(applyMatch[1], /mediaPlayer\.playbackRate\s*=\s*rate\s*;/);
  assert.match(applyMatch[1], /mediaPlayer\.defaultPlaybackRate\s*=\s*rate\s*;/);
  assert.match(applyMatch[1], /persistPlaybackRate\(rate\)\s*;/);
});

test('FIX 1: engageHold() (transient hold-2x) sets ONLY playbackRate, never defaultPlaybackRate -- the transient 2x must not become the persistent base rate', () => {
  const body = engageHoldMatch[1];
  assert.match(body, /mediaPlayer\.playbackRate\s*=\s*2\s*;/);
  assert.ok(!/defaultPlaybackRate/.test(body), 'engageHold() must not touch mediaPlayer.defaultPlaybackRate');
});

test('FIX 1: releaseHold() (transient hold-2x restore) sets ONLY playbackRate, never defaultPlaybackRate', () => {
  const body = releaseHoldMatch[1];
  assert.match(body, /mediaPlayer\.playbackRate\s*=\s*prevRate/);
  assert.ok(!/defaultPlaybackRate/.test(body), 'releaseHold() must not touch mediaPlayer.defaultPlaybackRate');
});

// ---- v1.41.11 (Dean): YouTube-style shortcuts -------------------------------
// stepPlaybackRateClamped (the </> keys) + source-locks on the keydown
// switch, the wheel-over-volume-slider gesture, and watch.js's trackNav
// registration (the piece that makes hardware previous/next media keys
// actually fire -- browsers only auto-wire play/pause; prev/next need
// MediaSession handlers). Gate fix round: the keyboard pair CLAMPS at both
// ends (adversarial W4 -- '<' at 1x wrapping to 2x was an intent inversion;
// YouTube clamps), while #speed-btn keeps its wrapping cycle.

const { stepPlaybackRateClamped } = require('../../public/js/player.js');

test('stepPlaybackRateClamped: steps down through the rate list ('<' key)', () => {
  assert.strictEqual(stepPlaybackRateClamped(2, -1), 1.75);
  assert.strictEqual(stepPlaybackRateClamped(1.75, -1), 1.5);
  assert.strictEqual(stepPlaybackRateClamped(1.5, -1), 1.25);
  assert.strictEqual(stepPlaybackRateClamped(1.25, -1), 1);
});

test('stepPlaybackRateClamped: CLAMPS at both ends -- no wrap-around intent inversion (gate W4)', () => {
  assert.strictEqual(stepPlaybackRateClamped(1, -1), 1, "'<' at minimum speed is a no-op, never a jump to 2x");
  assert.strictEqual(stepPlaybackRateClamped(2, 1), 2, "'>' at maximum speed is a no-op");
});

test('stepPlaybackRateClamped: steps up ('>' key) and degrades a foreign rate to the first rate', () => {
  assert.strictEqual(stepPlaybackRateClamped(1, 1), 1.25);
  assert.strictEqual(stepPlaybackRateClamped(3, -1), 1);
  assert.strictEqual(stepPlaybackRateClamped(undefined, 1), 1);
  assert.strictEqual(stepPlaybackRateClamped(NaN, -1), 1);
});

test('v1.41.11 source-lock: the FULL-only keydown switch carries the YouTube set', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
  const start = src.indexOf('the switch below mirrors YouTube');
  assert.ok(start >= 0, 'the v1.41.11 shortcut block exists');
  const block = src.slice(start, start + 5200); // wide enough to span the whole switch incl. the live-aware digit case
  assert.match(block, /case 'ArrowLeft': e\.preventDefault\(\); skip\(-5\);/, 'arrows are YouTube 5s now (J/L own the 10s step)');
  assert.match(block, /case 'j': case 'J': e\.preventDefault\(\); skip\(-10\);/, 'J rewinds 10s');
  assert.match(block, /case 'ArrowUp': e\.preventDefault\(\); adjustVolume\(VOLUME_STEP\);/, 'ArrowUp raises volume');
  assert.match(block, /applyPlaybackRate\(stepPlaybackRateClamped\(mediaPlayer\.playbackRate, 1\)\)/, '> speeds up through the shared apply path (clamped)');
  assert.match(block, /applyPlaybackRate\(stepPlaybackRateClamped\(mediaPlayer\.playbackRate, -1\)\)/, '< slows down through the same path (clamped)');
  assert.match(block, /case 'N':\s*if \(e\.shiftKey && trackNavHandlers/, 'Shift+N drives the registered trackNav seam');
  assert.match(block, /case '9': \{/, 'digit percent-seek cases exist');
  assert.match(block, /case 'k':\s*case 'K':\s*case ' ':/, 'K joins Space on togglePlayPause');
});

test('v1.41.11 source-lock: wheel over the volume slider adjusts volume (slider only, passive:false)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
  assert.match(src, /volBar\.addEventListener\('wheel', function \(e\) \{[\s\S]*?e\.preventDefault\(\);[\s\S]*?adjustVolume\(e\.deltaY < 0 \? VOLUME_STEP : -VOLUME_STEP\);[\s\S]*?\}, \{ passive: false \}\)/,
    'the wheel listener is on volBar (never the whole video -- Dean picked slider-only), preventDefaults, and steps 5%');
});

test('v1.41.11 source-lock: watch.js registers its context-aware prev/next with the player trackNav seam', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'watch.js'), 'utf8');
  assert.match(src, /window\.FileTube\.player\.setTrackNav\(\{\s*onPrev: prevId \? \(\) => navigateToWatch\(prevId\) : undefined,\s*onNext: nextId \? \(\) => navigateToWatch\(nextId\) : undefined,\s*\}\)/,
    'setupPrevNext hands its computed neighbors to setTrackNav (media keys + lock screen + Shift+N/P all ride this one registration)');
});

test('v1.41.11 source-lock: setTrackNav stores handlers for the keyboard seam and still sets MediaSession per-direction', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
  assert.match(src, /trackNavHandlers = \(hasPrev \|\| hasNext\) \? handlers : null;/, 'handlers stored for Shift+N/P');
  assert.match(src, /setMediaSessionAction\('previoustrack', hasPrev \? function \(\) \{ handlers\.onPrev\(\); \} : null\);/, 'per-direction MediaSession wiring unchanged');
});

// ---- v1.41.11 gate fix round: source-locks for the three seat findings ------

test('gate W1: skip() derives the ripple label from the ACTUAL delta (shells hard-code 15s)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
  const skipStart = src.indexOf('function skip(delta)');
  assert.ok(skipStart >= 0);
  const body = src.slice(skipStart, skipStart + 1200);
  assert.match(body, /ripple\.textContent = delta < 0\s*\? '« ' \+ Math\.abs\(delta\) \+ 's'\s*: Math\.abs\(delta\) \+ 's »';/,
    'a 5s arrow press must flash "5s »", never the markup\'s hard-coded 15');
});

test('gate W2: the digit percent-seek honors the liveMode invariant (startLiveStream, never a raw currentTime write) and saves immediately', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
  const caseStart = src.indexOf("case '0': case '1':");
  assert.ok(caseStart >= 0);
  const body = src.slice(caseStart, caseStart + 1800);
  assert.match(body, /if \(liveMode\) \{[\s\S]*?startLiveStream\(liveTarget, true\);[\s\S]*?saveProgressToServer\(liveTarget\);/,
    'live branch routes through startLiveStream + immediate save (skip()/seekToChapter parity)');
  assert.match(body, /digitEl\.currentTime = dur \* fraction;\s*saveProgressToServer\(currentAbsTime\(\)\);/,
    'non-live branch seeks the active element and saves immediately');
});

test('gate W3: setupPrevNext bails on a stale (aborted) view before registering trackNav handlers', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'watch.js'), 'utf8');
  const regIdx = src.indexOf('window.FileTube.player.setTrackNav({');
  assert.ok(regIdx >= 0);
  const guardIdx = src.lastIndexOf('if (signal.aborted) return;', regIdx);
  assert.ok(guardIdx >= 0 && regIdx - guardIdx < 600,
    'the staleness guard sits immediately before the registration -- a departed view\'s slow fetch must never overwrite the current view\'s (or the reader\'s) media-key handlers');
});
