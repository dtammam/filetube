'use strict';

// [UNIT] v1.131 CarPlay pause-provenance diagnostics (Dean, 2026-08-16):
// wired CarPlay + physical volume knob/steering wheel -> playback pauses and
// only the IN-APP play button resumes it (the car's play button does not).
// A web app gets NO volume events on iOS, so the pause is delivered by
// something between the head unit and WebKit - either a MediaSession 'pause'
// action (car-sent transport command) or a bare element pause (audio-session
// interruption, never auto-resumed for web media). The ?debugLifecycle=1
// overlay recorded neither; this wave adds exactly that evidence:
//  - `msAction:<name>` on every MediaSession action arrival (one wrapper at
//    the setMediaSessionAction registration seam - call sites byte-identical)
//  - `media:pause` with a provenance line (element, gesture age, suppression,
//    ended, bg-audio state) on BOTH elements, plus `media:play` pairs.
// Diagnosis discipline: this wave is INSTRUMENTATION ONLY - no behavior
// change; the fix ships after Dean's car repro names the mechanism.
//
// Testing posture mirrors the sibling player test files: the pure formatter
// is exercised directly; the impure wiring is locked against the source text
// (no jsdom player harness; the car repro is the arbiter).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { formatPauseProvenance } = require('../../public/js/player.js');

// ---- formatPauseProvenance (pure) ------------------------------------------

test('formatPauseProvenance: a gesture-adjacent pause carries its age in ms', () => {
  assert.strictEqual(
    formatPauseProvenance({ el: 'video', gestureAgeMs: 1234, suppressed: false, ended: false, state: 'INLINE_VIDEO' }),
    'el=video gestureAge=1234ms suppressed=0 ended=0 state=INLINE_VIDEO');
  // Gate W2 (v1.131 fix round): age ZERO is a same-millisecond user tap and
  // must render '0ms', never 'none' - a `>= 0` -> `> 0` mutant would dress a
  // USER pause in the SYSTEM-pause signature, the exact distinction this
  // diagnostic exists to make.
  assert.match(formatPauseProvenance({ el: 'video', gestureAgeMs: 0 }), / gestureAge=0ms /);
});

test('formatPauseProvenance: no gesture yet (null/undefined/non-finite/negative) reads "none" - the system-pause signature', () => {
  assert.match(formatPauseProvenance({ el: 'video', gestureAgeMs: null }), / gestureAge=none /);
  assert.match(formatPauseProvenance({ el: 'video' }), / gestureAge=none /);
  assert.match(formatPauseProvenance({ el: 'video', gestureAgeMs: Infinity }), / gestureAge=none /);
  assert.match(formatPauseProvenance({ el: 'video', gestureAgeMs: NaN }), / gestureAge=none /);
  assert.match(formatPauseProvenance({ el: 'video', gestureAgeMs: -5 }), / gestureAge=none /);
});

test('formatPauseProvenance: ages beyond the readable window collapse to ">99s" ("long ago" IS the signal)', () => {
  assert.match(formatPauseProvenance({ el: 'video', gestureAgeMs: 100000 }), / gestureAge=>99s /);
  assert.match(formatPauseProvenance({ el: 'video', gestureAgeMs: 99999 }), / gestureAge=99999ms /);
});

test('formatPauseProvenance: suppression/ended flags render as 1/0; bgAudio element and state pass through', () => {
  assert.strictEqual(
    formatPauseProvenance({ el: 'bgAudio', gestureAgeMs: 10, suppressed: true, ended: true, state: 'BACKGROUND_AUDIO' }),
    'el=bgAudio gestureAge=10ms suppressed=1 ended=1 state=BACKGROUND_AUDIO');
});

test('formatPauseProvenance: missing element/state degrade to "?" and a bare call never throws', () => {
  assert.strictEqual(formatPauseProvenance({}), 'el=? gestureAge=none suppressed=0 ended=0 state=?');
  assert.strictEqual(formatPauseProvenance(), 'el=? gestureAge=none suppressed=0 ended=0 state=?');
});

// ---- source-level regression locks (no DOM harness - see module comment) ---

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

test('setMediaSessionAction records every action ARRIVAL before the real handler, and a null handler stays null', () => {
  const body = /function setMediaSessionAction\(action, handler\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(body, 'setMediaSessionAction body not found');
  // The wrapper: non-null handlers record first, then delegate with the
  // action details intact; null (clearing a registration - per-direction
  // prev/next availability, teardown clears) is preserved as null.
  assert.match(body[1], /var wrapped = handler \? function \(details\) \{\s*recordLifecycleEvent\('msAction:' \+ action, \{\}\);\s*return handler\(details\);\s*\} : null;/,
    'the msAction wrapper must record BEFORE delegating and preserve null');
  assert.match(body[1], /setActionHandler\(action, wrapped\)/, 'the WRAPPED handler must be what registers');
  assert.ok(!/setActionHandler\(action, handler\)/.test(body[1]), 'the raw handler must never register directly (that silently drops the diagnostics)');
});

test('recordDiagnosticPauseEvent: flag-gated before any context read, and reads the four live provenance sources', () => {
  const body = /function recordDiagnosticPauseEvent\(elName\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(body, 'recordDiagnosticPauseEvent body not found');
  assert.match(body[1], /^\s*if \(!isDebugLifecycleEnabled\(\)\) return;/, 'the flag gate must come FIRST (context reads never run with the overlay off)');
  // Gate W1 (v1.131 fix round): the element-selection ternary is what makes
  // the `ended` bit truthful - swapped, a video pause would read
  // bgAudioEl.ended and a real end-of-track pause would wear the
  // interruption-pause signature (ended=0). Bind the exact mapping.
  assert.match(body[1], /var el = elName === 'bgAudio' \? bgAudioEl : mediaPlayer;/,
    'the provenance must read the element it names - swapped, the ended bit lies');
  assert.match(body[1], /formatPauseProvenance\(\{/, 'the detail line must come from the ONE pure formatter');
  assert.match(body[1], /gestureAgeMs: lastUserGestureAt \? \(Date\.now\(\) - lastUserGestureAt\) : null,/);
  assert.match(body[1], /suppressed: suppressPauseHandoff,/);
  assert.match(body[1], /ended: !!\(el && el\.ended\),/);
  assert.match(body[1], /state: bgAudioState,/);
});

test('BOTH elements wire the pause/play provenance pair (a pause on the non-active sidecar is itself signal)', () => {
  assert.match(PLAYER_JS, /mediaPlayer\.addEventListener\('pause', function \(\) \{ recordDiagnosticPauseEvent\('video'\); \}\);/);
  assert.match(PLAYER_JS, /mediaPlayer\.addEventListener\('play', function \(\) \{ recordLifecycleEvent\('media:play', \{ detail: 'el=video' \}\); \}\);/);
  assert.match(PLAYER_JS, /bgAudioEl\.addEventListener\('pause', function \(\) \{ recordDiagnosticPauseEvent\('bgAudio'\); \}\);/);
  assert.match(PLAYER_JS, /bgAudioEl\.addEventListener\('play', function \(\) \{ recordLifecycleEvent\('media:play', \{ detail: 'el=bgAudio' \}\); \}\);/);
});

test('the diagnostics are PASSIVE: the provenance recorder never touches playback state', () => {
  const body = /function recordDiagnosticPauseEvent\(elName\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(body);
  assert.ok(!/\.(play|pause)\(\)/.test(body[1]), 'no play()/pause() calls - instrumentation must never become the bug');
  assert.ok(!/setPlaybackState|setCssFullscreen|setAudioExpanded/.test(body[1]), 'no state machinery calls from the recorder');
});
