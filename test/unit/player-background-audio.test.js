'use strict';

// [UNIT] v1.27.0 "Background audio for video" (EXPERIMENTAL, default OFF,
// public/js/player.js). PURE state-machine/eligibility helpers are exported
// and tested by invocation (node:test-able with no DOM). Every DOM-only
// runtime behavior (the actual handoff/swap-back, gesture-prime, force-close
// release) lives inside the browser-only IIFE this codebase has no
// jsdom/browser harness for (see CONTRIBUTING.md) -- mirroring the existing
// precedent at test/unit/player-lifecycle-release.test.js /
// test/unit/player-hardening.test.js, those contracts are locked directly
// against source text rather than by invocation. Dean's on-device iOS pass
// remains the documented arbiter for actual runtime behavior.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  BG_AUDIO_STATES,
  nextBackgroundAudioState,
  shouldHandOffToBackgroundAudio,
  shouldPauseForLifecycleEvent,
} = require('../../public/js/player.js');

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

// ---- nextBackgroundAudioState (pure state machine) -----------------------
// Signature: (state, event, ctx) -> next state.

test('BG_AUDIO_STATES exposes the three named states', () => {
  assert.equal(BG_AUDIO_STATES.INLINE_VIDEO, 'inline_video');
  assert.equal(BG_AUDIO_STATES.HANDING_OFF, 'handing_off');
  assert.equal(BG_AUDIO_STATES.BACKGROUND_AUDIO, 'background_audio');
});

test('BACKGROUND: INLINE_VIDEO -> HANDING_OFF only when ctx.eligible is true', () => {
  assert.equal(
    nextBackgroundAudioState(BG_AUDIO_STATES.INLINE_VIDEO, 'BACKGROUND', { eligible: true }),
    BG_AUDIO_STATES.HANDING_OFF
  );
});

test('BACKGROUND: INLINE_VIDEO stays INLINE_VIDEO when not eligible (today\'s pause path is used instead)', () => {
  assert.equal(
    nextBackgroundAudioState(BG_AUDIO_STATES.INLINE_VIDEO, 'BACKGROUND', { eligible: false }),
    BG_AUDIO_STATES.INLINE_VIDEO
  );
  assert.equal(
    nextBackgroundAudioState(BG_AUDIO_STATES.INLINE_VIDEO, 'BACKGROUND', {}),
    BG_AUDIO_STATES.INLINE_VIDEO
  );
});

test('BACKGROUND: a no-op from any state other than INLINE_VIDEO (already mid-handoff/backgrounded)', () => {
  assert.equal(
    nextBackgroundAudioState(BG_AUDIO_STATES.HANDING_OFF, 'BACKGROUND', { eligible: true }),
    BG_AUDIO_STATES.HANDING_OFF
  );
  assert.equal(
    nextBackgroundAudioState(BG_AUDIO_STATES.BACKGROUND_AUDIO, 'BACKGROUND', { eligible: true }),
    BG_AUDIO_STATES.BACKGROUND_AUDIO
  );
});

test('HANDOFF_SUCCEEDED: HANDING_OFF -> BACKGROUND_AUDIO', () => {
  assert.equal(
    nextBackgroundAudioState(BG_AUDIO_STATES.HANDING_OFF, 'HANDOFF_SUCCEEDED', {}),
    BG_AUDIO_STATES.BACKGROUND_AUDIO
  );
});

test('HANDOFF_SUCCEEDED: a no-op from INLINE_VIDEO or BACKGROUND_AUDIO', () => {
  assert.equal(nextBackgroundAudioState(BG_AUDIO_STATES.INLINE_VIDEO, 'HANDOFF_SUCCEEDED', {}), BG_AUDIO_STATES.INLINE_VIDEO);
  assert.equal(nextBackgroundAudioState(BG_AUDIO_STATES.BACKGROUND_AUDIO, 'HANDOFF_SUCCEEDED', {}), BG_AUDIO_STATES.BACKGROUND_AUDIO);
});

test('HANDOFF_FAILED: HANDING_OFF -> INLINE_VIDEO (degrades to today\'s pause behavior)', () => {
  assert.equal(
    nextBackgroundAudioState(BG_AUDIO_STATES.HANDING_OFF, 'HANDOFF_FAILED', {}),
    BG_AUDIO_STATES.INLINE_VIDEO
  );
});

test('HANDOFF_FAILED: a no-op from INLINE_VIDEO or BACKGROUND_AUDIO', () => {
  assert.equal(nextBackgroundAudioState(BG_AUDIO_STATES.INLINE_VIDEO, 'HANDOFF_FAILED', {}), BG_AUDIO_STATES.INLINE_VIDEO);
  assert.equal(nextBackgroundAudioState(BG_AUDIO_STATES.BACKGROUND_AUDIO, 'HANDOFF_FAILED', {}), BG_AUDIO_STATES.BACKGROUND_AUDIO);
});

test('FOREGROUND: BACKGROUND_AUDIO -> INLINE_VIDEO (SWAP_BACK)', () => {
  assert.equal(
    nextBackgroundAudioState(BG_AUDIO_STATES.BACKGROUND_AUDIO, 'FOREGROUND', {}),
    BG_AUDIO_STATES.INLINE_VIDEO
  );
});

test('FOREGROUND: HANDING_OFF -> INLINE_VIDEO too (foregrounded before the handoff promise settled)', () => {
  assert.equal(
    nextBackgroundAudioState(BG_AUDIO_STATES.HANDING_OFF, 'FOREGROUND', {}),
    BG_AUDIO_STATES.INLINE_VIDEO
  );
});

test('FOREGROUND: a no-op from INLINE_VIDEO', () => {
  assert.equal(nextBackgroundAudioState(BG_AUDIO_STATES.INLINE_VIDEO, 'FOREGROUND', {}), BG_AUDIO_STATES.INLINE_VIDEO);
});

test('TEARDOWN: always resets to INLINE_VIDEO from any state', () => {
  for (const s of Object.values(BG_AUDIO_STATES)) {
    assert.equal(nextBackgroundAudioState(s, 'TEARDOWN', {}), BG_AUDIO_STATES.INLINE_VIDEO);
  }
});

test('an unrecognized event never crashes and leaves the state unchanged', () => {
  for (const s of Object.values(BG_AUDIO_STATES)) {
    assert.equal(nextBackgroundAudioState(s, 'NOT_A_REAL_EVENT', {}), s);
    assert.equal(nextBackgroundAudioState(s, undefined, {}), s);
  }
});

test('a missing ctx never throws for any event', () => {
  for (const event of ['BACKGROUND', 'HANDOFF_SUCCEEDED', 'HANDOFF_FAILED', 'FOREGROUND', 'TEARDOWN']) {
    assert.doesNotThrow(() => nextBackgroundAudioState(BG_AUDIO_STATES.INLINE_VIDEO, event, undefined));
  }
});

// ---- shouldHandOffToBackgroundAudio (pure eligibility gate) --------------

test('eligible: setting ON + audioStatus ready + currently INLINE_VIDEO', () => {
  assert.equal(
    shouldHandOffToBackgroundAudio({ settingOn: true, audioStatus: 'ready', bgAudioState: BG_AUDIO_STATES.INLINE_VIDEO }),
    true
  );
});

test('not eligible: setting OFF (default), even with audio ready', () => {
  assert.equal(
    shouldHandOffToBackgroundAudio({ settingOn: false, audioStatus: 'ready', bgAudioState: BG_AUDIO_STATES.INLINE_VIDEO }),
    false
  );
});

test('not eligible: audioStatus not yet ready (pending/processing/failed/unknown) -- never extracts mid-event', () => {
  for (const audioStatus of ['pending', 'processing', 'failed', undefined, null]) {
    assert.equal(
      shouldHandOffToBackgroundAudio({ settingOn: true, audioStatus, bgAudioState: BG_AUDIO_STATES.INLINE_VIDEO }),
      false,
      `audioStatus=${audioStatus} must never be eligible`
    );
  }
});

test('not eligible: already mid-handoff or already backgrounded (defensive -- avoids a double-handoff)', () => {
  assert.equal(
    shouldHandOffToBackgroundAudio({ settingOn: true, audioStatus: 'ready', bgAudioState: BG_AUDIO_STATES.HANDING_OFF }),
    false
  );
  assert.equal(
    shouldHandOffToBackgroundAudio({ settingOn: true, audioStatus: 'ready', bgAudioState: BG_AUDIO_STATES.BACKGROUND_AUDIO }),
    false
  );
});

test('a missing/undefined ctx is a safe no-op (never throws, never eligible)', () => {
  assert.equal(shouldHandOffToBackgroundAudio(undefined), false);
  assert.equal(shouldHandOffToBackgroundAudio({}), false);
});

// ---- Mutual exclusion with inNativePresentation (regression lock) --------
// The two "keep playing while backgrounded" mechanisms (native fullscreen/
// PiP vs. background-audio handoff) must never both engage for the same
// event -- by construction, since the handoff is only ever attempted INSIDE
// shouldPauseForLifecycleEvent's own truthy branch, which already excludes
// inNativePresentation.

test('mutual exclusion: shouldPauseForLifecycleEvent (the sole gate before a handoff is ever attempted) is false whenever inNativePresentation is true', () => {
  assert.equal(
    shouldPauseForLifecycleEvent('pagehide', { isAudio: false, isPlaying: true, isMobile: true, inNativePresentation: true }),
    false,
    'a native-fullscreen/PiP video must never reach the handoff-attempt branch'
  );
});

test("mutual exclusion (source-lock): attemptBackgroundAudioHandoff('visibility') is called ONLY inside the shouldPauseForLifecycleEvent(...) truthy branch of handleBackgroundLifecycle (F-D added a SEPARATE second call site elsewhere in the file -- handlePossibleIOSPrePauseHandoff -- but never a second one INSIDE this function)", () => {
  const fnMatch = /function handleBackgroundLifecycle\(eventType, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(fnMatch, 'expected to find handleBackgroundLifecycle\'s source body');
  const body = fnMatch[1];
  const callSites = body.match(/attemptBackgroundAudioHandoff\(/g) || [];
  assert.strictEqual(callSites.length, 1, "expected exactly one call site for attemptBackgroundAudioHandoff(...) inside handleBackgroundLifecycle itself");
  const pauseBranch = /if \(shouldPauseForLifecycleEvent\(eventType, ctx\)\) \{([\s\S]*?)\n {4}\}/.exec(body);
  assert.ok(pauseBranch, 'expected the shouldPauseForLifecycleEvent branch to exist');
  assert.match(pauseBranch[1], /attemptBackgroundAudioHandoff\('visibility'\)/, "the ONE call site must be inside this branch (never in the inNativePresentation branch, which is reached separately/later), passing the 'visibility' trigger label");
});

// ---- Source-lock: force-close teardown releases BOTH elements ------------

test('releaseAudioSession() stops+releases BOTH mediaPlayer AND bgAudioEl (the exact leak the v1.25.10 force-close fix exists to kill)', () => {
  const match = /function releaseAudioSession\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find releaseAudioSession()\'s source body');
  const body = match[1];
  // F-D (v1.27.1): mediaPlayer's pause is now routed through
  // pauseSuppressingHandoff() (not a bare mediaPlayer.pause()) -- see that
  // helper's own source-lock tests for why.
  assert.match(body, /pauseSuppressingHandoff\(mediaPlayer\);/);
  assert.match(body, /bgAudioEl\.pause\(\);/, 'a terminal pagehide mid-background-audio must also pause the hidden audio element');
  assert.match(body, /nextBackgroundAudioState\(bgAudioState, 'TEARDOWN', \{\}\)/, 'expected the state machine to reset on release');
});

// ---- Source-lock: hidden <audio> element lifecycle ------------------------

test('ensureHost() creates the hidden <audio> element in JS (no shell/template edit), preload="none", never shown', () => {
  const match = /function ensureHost\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find ensureHost()\'s source body');
  const body = match[1];
  assert.match(body, /bgAudioEl = document\.createElement\('audio'\);/);
  assert.match(body, /bgAudioEl\.preload = 'none';/);
  assert.match(body, /bgAudioEl\.hidden = true;/);
  assert.match(body, /host\.appendChild\(bgAudioEl\);/, 'must be appended INSIDE host so it rides the reparented host across FULL/DOCKED');
});

test('teardownMediaState() and close() both reset the state machine to INLINE_VIDEO and stop+detach bgAudioEl', () => {
  for (const fnName of ['teardownMediaState', 'close']) {
    const match = new RegExp(`function ${fnName}\\(\\) \\{([\\s\\S]*?)\\n {2}\\}`).exec(PLAYER_JS);
    assert.ok(match, `expected to find ${fnName}()'s source body`);
    const body = match[1];
    assert.match(body, /nextBackgroundAudioState\(bgAudioState, 'TEARDOWN', \{\}\)/, `${fnName} must reset the background-audio state machine`);
    assert.match(body, /bgAudioEl\.pause\(\);/, `${fnName} must pause bgAudioEl`);
    assert.match(body, /bgAudioEl\.removeAttribute\('src'\)/, `${fnName} must detach bgAudioEl's src`);
  }
});

// ---- Source-lock: the gesture pre-warm exists in the gesture path --------

test('primeBackgroundAudioElement() exists and is one-shot per load (bgAudioGesturePrimed guard)', () => {
  const match = /function primeBackgroundAudioElement\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find primeBackgroundAudioElement()\'s source body');
  const body = match[1];
  assert.match(body, /if \(bgAudioGesturePrimed/, 'expected a one-shot guard');
  assert.match(body, /bgAudioGesturePrimed = true;/);
  assert.match(body, /bgAudioEl\.muted = true;/, 'expected a MUTED prime (never audible)');
  assert.match(body, /bgAudioEl\.play\(\)/);
});

test('the ppBtn click handler primes BEFORE calling togglePlayPause (same synchronous gesture)', () => {
  const match = /ppBtn\.addEventListener\('click', function \(\) \{([\s\S]*?)\n {6}\}\);/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find the ppBtn click listener\'s source body');
  const body = match[1];
  const primeIdx = body.indexOf('primeBackgroundAudioElement();');
  const toggleIdx = body.indexOf('togglePlayPause();');
  assert.ok(primeIdx !== -1 && toggleIdx !== -1);
  assert.ok(primeIdx < toggleIdx, 'priming must happen before togglePlayPause() inside the same gesture callback');
});

test('mediaPlayer has a touchstart (capture-phase, passive) listener priming for the native-controls path', () => {
  assert.match(
    PLAYER_JS,
    /mediaPlayer\.addEventListener\('touchstart', primeBackgroundAudioElement, \{ passive: true, capture: true \}\);/,
    'expected a capture-phase touchstart prime so it fires before native <video controls> handling'
  );
});

// ---- Source-lock: activeMediaElement() retargeting ------------------------

test('activeMediaElement() returns bgAudioEl during HANDING_OFF/BACKGROUND_AUDIO, mediaPlayer otherwise', () => {
  const match = /function activeMediaElement\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find activeMediaElement()\'s source body');
  const body = match[1];
  assert.match(body, /BG_AUDIO_STATES\.HANDING_OFF/);
  assert.match(body, /BG_AUDIO_STATES\.BACKGROUND_AUDIO/);
  assert.match(body, /\? bgAudioEl : mediaPlayer/);
});

test('the Media Session play/pause/seekto action handlers are retargeted to activeMediaElement(), not a hardcoded mediaPlayer', () => {
  assert.match(PLAYER_JS, /setMediaSessionAction\('play', function \(\) \{\s*\n\s*var el = activeMediaElement\(\);/);
  assert.match(PLAYER_JS, /setMediaSessionAction\('pause', function \(\) \{\s*\n\s*var el = activeMediaElement\(\);/);
  assert.match(PLAYER_JS, /setMediaSessionAction\('seekto', function \(details\) \{\s*\n\s*var el = activeMediaElement\(\);/);
});

// ---- F1 (two-reviewer gate, v1.27.1 post-release): the MediaSession -------
// ---- 'pause' action handler must never feed the F-D handoff trigger -------
// A lock-screen/Control-Center Pause tap is a genuine, explicit user pause,
// but it necessarily arrives while document.visibilityState === 'hidden'
// (the only time the OS surfaces that control at all) -- exactly the signal
// handlePossibleIOSPrePauseHandoff uses to decide "try a background-audio
// handoff". Left as a bare el.pause(), that could feed an unwanted handoff
// on the VIDEO element (full repro: failed first handoff -> lock-screen
// Play -> lock-screen Pause -> unwanted un-pause). bgAudioEl is never
// observed by that trigger (wired only on mediaPlayer's own 'pause' event),
// so its pause is deliberately left bare.

test("F1 source-lock: the MediaSession 'pause' action handler routes mediaPlayer's pause through pauseSuppressingHandoff, but leaves any OTHER active element (bgAudioEl) with a bare .pause()", () => {
  const match = /setMediaSessionAction\('pause', function \(\) \{([\s\S]*?)\n {2}\}\);/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find the MediaSession \'pause\' action handler\'s source body');
  const body = match[1];
  assert.match(body, /if \(el === mediaPlayer\) pauseSuppressingHandoff\(mediaPlayer\);/);
  assert.match(body, /else el\.pause\(\);/);
  const ifIdx = body.indexOf('if (el === mediaPlayer) pauseSuppressingHandoff(mediaPlayer);');
  const elseIdx = body.indexOf('else el.pause();');
  assert.ok(ifIdx !== -1 && elseIdx !== -1 && ifIdx < elseIdx, 'expected the mediaPlayer branch before the bare bgAudioEl fallback');
});

test("F1 source-lock: the MediaSession 'play' action handler is UNCHANGED (still a bare el.play(), regardless of which element is active) -- only 'pause' needed the fix, since a lock-screen Play can never be misread as the iOS pre-pause-ordering signal", () => {
  const match = /setMediaSessionAction\('play', function \(\) \{([\s\S]*?)\n {2}\}\);/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find the MediaSession \'play\' action handler\'s source body');
  assert.match(match[1], /el\.play\(\)\.catch\(function \(\) \{\}\);/);
  assert.ok(!/pauseSuppressingHandoff/.test(match[1]), 'the play handler must never reference the pause-suppression wrapper');
});

test('F1 comment-lock: the F-D trigger\'s own comment correctly documents the MediaSession pause exception rather than asserting a real user pause only ever happens while visible', () => {
  const match = /function handlePossibleIOSPrePauseHandoff\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  assert.ok(!/a real user pause only ever happens while visible/.test(body), 'the old, now-incorrect premise must be gone from the guard comment');
  assert.match(body, /almost every real user pause happens while visible/, 'expected the corrected, hedged premise naming the MediaSession exception');
});

test('skip() is retargeted to activeMediaElement() for the non-live-mode path', () => {
  const match = /function skip\(delta\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find skip()\'s source body');
  assert.match(match[1], /var el = activeMediaElement\(\);/);
});

test('startProgressSaver() checks activeMediaElement().paused, not a hardcoded mediaPlayer.paused (progress must keep saving through BACKGROUND_AUDIO)', () => {
  const match = /function startProgressSaver\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find startProgressSaver()\'s source body');
  assert.match(match[1], /var el = activeMediaElement\(\);/);
  assert.match(match[1], /el && !el\.paused/);
});

test('updatePositionState() reads activeMediaElement(), not a hardcoded mediaPlayer', () => {
  const match = /function updatePositionState\(force\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find updatePositionState()\'s source body');
  assert.match(match[1], /var el = activeMediaElement\(\);/);
});

// ---- Source-lock: SWAP_BACK wiring at the visibilitychange re-assert -----

test('handleForegroundSwapBack() runs the video.currentTime = audio.currentTime; video.play() sequence, then releases the audio element', () => {
  const match = /function handleForegroundSwapBack\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find handleForegroundSwapBack()\'s source body');
  const body = match[1];
  assert.match(body, /mediaPlayer\.currentTime = resumeTime;/);
  assert.match(body, /mediaPlayer\.play\(\)\.catch/);
  assert.match(body, /releaseBackgroundAudioElement\(\);/);
});

test('the visibilitychange-visible re-assert listener calls handleForegroundSwapBack() BEFORE re-asserting Media Session', () => {
  const match = /document\.addEventListener\('visibilitychange', function \(\) \{\s*\n\s*if \(document\.visibilityState !== 'visible'[\s\S]*?\n {2}\}\);/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find the visible re-assert listener');
  const body = match[0];
  const swapIdx = body.indexOf('handleForegroundSwapBack();');
  const reassertIdx = body.indexOf('setupMediaSession(');
  assert.ok(swapIdx !== -1 && reassertIdx !== -1);
  assert.ok(swapIdx < reassertIdx, 'SWAP_BACK must run before the Media Session re-assert reads activeMediaElement()');
});

// ---- Source-lock: setupForMedia caches the setting once per load ---------

test('setupForMedia() caches backgroundAudioForVideo ONCE via /api/settings (never fetched inside the background lifecycle event itself)', () => {
  const match = /function setupForMedia\(id, data\) \{([\s\S]*?)\n {4}setupMediaSession\(id, data\.channelName, data\.title\);/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find the start of setupForMedia()\'s source body');
  const body = match[1];
  assert.match(body, /bgAudioSettingCached = false;/);
  assert.match(body, /fetch\('\/api\/settings'\)/);
  assert.match(body, /bgAudioSettingCached = !!\(settings && settings\.backgroundAudioForVideo\);/);
  assert.match(body, /prepare-audio/, 'expected the pre-warm POST to prepare-audio');
  assert.ok(!/fetch\('\/api\/settings'\)/.test(PLAYER_JS.match(/function attemptBackgroundAudioHandoff\(trigger\) \{([\s\S]*?)\n {2}\}/)[1]), 'the handoff attempt itself must never fetch settings fresh');
});

test('setupForMedia() gates the settings fetch/pre-warm on video + mobile only (desktop/audio items never fetch)', () => {
  const match = /function setupForMedia\(id, data\) \{([\s\S]*?)\n {4}setupMediaSession\(id, data\.channelName, data\.title\);/.exec(PLAYER_JS);
  const body = match[1];
  assert.match(body, /if \(data\.type !== 'audio' && isMobileFormFactor\(\) && bgAudioEl\) \{/);
});

// ---- F1 (two-reviewer gate): the bgAudioStatusKnown === 'ready' short- ----
// ---- circuit is gone -- prepare-audio always fires when the setting is ---
// ---- on, and its FRESH response is the only thing trusted afterward ------

test("F1 source-lock: setupForMedia() no longer short-circuits the prepare-audio POST on a cached bgAudioStatusKnown === 'ready'", () => {
  const match = /function setupForMedia\(id, data\) \{([\s\S]*?)\n {4}setupMediaSession\(id, data\.channelName, data\.title\);/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find the start of setupForMedia()\'s source body');
  const body = match[1];
  assert.ok(
    !/bgAudioStatusKnown === 'ready'/.test(body),
    'a stale cached "ready" must never skip the prepare-audio self-heal round trip'
  );
  // The ONLY remaining gate before firing prepare-audio is the freshly
  // resolved setting itself.
  assert.match(body, /if \(!bgAudioSettingCached\) return;/);
});

test('F1 source-lock: the prepare-audio response is trusted UNCONDITIONALLY (never left at the stale load-time snapshot)', () => {
  const match = /function setupForMedia\(id, data\) \{([\s\S]*?)\n {4}setupMediaSession\(id, data\.channelName, data\.title\);/.exec(PLAYER_JS);
  const body = match[1];
  // F6 (two-reviewer gate, v1.27.1 post-release): widened from `if (body)
  // bgAudioStatusKnown = ...` to an unconditional ternary -- a non-ok
  // response (`body === null`) must explicitly reset to UNKNOWN (`null`),
  // never silently leave the load-time snapshot standing in (see the F6
  // tests below for the behavioral contract this enables).
  assert.match(
    body,
    /bgAudioStatusKnown = body \? \(body\.audioStatus \|\| null\) : null;/,
    'expected the prepare-audio response to always overwrite bgAudioStatusKnown -- to the fresh status on a successful response, to null (unknown) on a non-ok one'
  );
});

// ---- F2 (two-reviewer gate): bgAudioEl's own 'ended' + the shared --------
// ---- completion cascade ---------------------------------------------------

test("F2 source-lock: bgAudioEl has an 'ended' listener gated on bgAudioState === BACKGROUND_AUDIO", () => {
  const match = /bgAudioEl\.addEventListener\('ended', function \(\) \{([\s\S]*?)\n {4}\}\);/.exec(PLAYER_JS);
  assert.ok(match, "expected to find bgAudioEl's own 'ended' listener");
  const body = match[1];
  assert.match(body, /if \(bgAudioState !== BG_AUDIO_STATES\.BACKGROUND_AUDIO\) return;/);
  assert.match(body, /runEndedCompletionCascade\(bgAudioEl, \{ backgrounded: true \}\);/);
});

test('F2 source-lock: mediaPlayer\'s own \'ended\' listener calls the SAME shared cascade (deduplicated, not copy-pasted)', () => {
  assert.match(
    PLAYER_JS,
    /mediaPlayer\.addEventListener\('ended', function \(\) \{\s*\n\s*runEndedCompletionCascade\(mediaPlayer\);\s*\n\s*\}\);/,
    "expected mediaPlayer's 'ended' listener to delegate to runEndedCompletionCascade(mediaPlayer)"
  );
});

test('F2 source-lock: runEndedCompletionCascade preserves the pre-existing save/reset/setPlaybackState/loop/autoplay semantics', () => {
  const match = /function runEndedCompletionCascade\(el, opts\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find runEndedCompletionCascade()\'s source body');
  const body = match[1];
  assert.match(body, /saveProgressToServer\(0\);/);
  assert.match(body, /clearProgressInterval\(\);/);
  assert.match(body, /if \(!liveMode && el\) el\.currentTime = 0;/);
  assert.match(body, /setPlaybackState\('none'\);/);
  assert.match(body, /if \(isLoopEnabled\(\)\) \{/, 'loop must still take precedence over autoplay-advance (AC49)');
  assert.match(body, /handleAutoplayNext\(\);/);
});

test('F2 decision: runEndedCompletionCascade DEFERS autoplay-next (via pendingAutoplayNextOnForeground) rather than attempting handleAutoplayNext while backgrounded', () => {
  const match = /function runEndedCompletionCascade\(el, opts\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  assert.match(body, /var backgrounded = !!\(opts && opts\.backgrounded\);/);
  assert.match(body, /if \(backgrounded\) \{/);
  assert.match(body, /pendingAutoplayNextOnForeground = true;/);
  // `handleAutoplayNext()` must be the UNCONDITIONAL foreground fallthrough
  // -- i.e. AFTER (not inside) the `if (backgrounded)` early-return branch.
  const backgroundedIdx = body.indexOf('if (backgrounded) {');
  const handleAutoplayIdx = body.lastIndexOf('handleAutoplayNext();');
  assert.ok(backgroundedIdx !== -1 && handleAutoplayIdx !== -1);
  assert.ok(backgroundedIdx < handleAutoplayIdx, 'the deferred-while-backgrounded branch must come before the immediate foreground call');
});

test('F2 source-lock: loop-replay while backgrounded acts on `el` (the hidden audio element), never re-foregrounds the video', () => {
  const match = /function runEndedCompletionCascade\(el, opts\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  const loopBranch = /if \(isLoopEnabled\(\)\) \{([\s\S]*?)\n {4}\}/.exec(body);
  assert.ok(loopBranch, 'expected the loop-replay branch');
  assert.match(loopBranch[1], /el\.currentTime = 0;/);
  assert.match(loopBranch[1], /el\.play\(\)\.catch/);
  assert.ok(!/mediaPlayer\.play\(\)/.test(loopBranch[1]), 'loop-replay must never hardcode mediaPlayer -- it must act on whichever element actually ended');
});

test('F2 source-lock: handleForegroundSwapBack() consumes a deferred pendingAutoplayNextOnForeground exactly once', () => {
  const match = /function handleForegroundSwapBack\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find handleForegroundSwapBack()\'s source body');
  const body = match[1];
  assert.match(body, /if \(pendingAutoplayNextOnForeground\) \{/);
  assert.match(body, /pendingAutoplayNextOnForeground = false;/);
  assert.match(body, /handleAutoplayNext\(\);/);
});

test('F2 source-lock: pendingAutoplayNextOnForeground is reset alongside every other per-load background-audio flag (teardownMediaState + close)', () => {
  for (const fnName of ['teardownMediaState', 'close']) {
    const match = new RegExp(`function ${fnName}\\(\\) \\{([\\s\\S]*?)\\n {2}\\}`).exec(PLAYER_JS);
    assert.ok(match, `expected to find ${fnName}()'s source body`);
    assert.match(match[1], /pendingAutoplayNextOnForeground = false;/, `${fnName} must reset the deferred-autoplay-next flag`);
  }
});

// ---- F3 (two-reviewer gate): the gesture prime always fires + never -------
// ---- pauses a real handoff out from under itself ---------------------------

// F-B (v1.27.1 REGRESSION FIX): F3's original "never gate on
// bgAudioSettingCached" decision is REVERSED here -- see the long comment
// above primeBackgroundAudioElement() in player.js for the full rationale
// (priming's own play/pause cycle on bgAudioEl was racing MediaSession
// playbackState against the real video on EVERY default-OFF install, the
// v1.25.2 regression). F-A (the activeMediaElement()-gated listeners) closes
// that hole structurally, but priming an element that will never be used is
// still pure waste, so priming is now setting-gated again.
test('F-B source-lock: primeBackgroundAudioElement() now DOES gate on bgAudioSettingCached === true (reverses F3 -- priming an element the setting keeps OFF is pure waste now that F-A makes the old "always safe" claim moot)', () => {
  const match = /function primeBackgroundAudioElement\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find primeBackgroundAudioElement()\'s source body');
  const body = match[1];
  assert.match(body, /if \(bgAudioSettingCached !== true\) return;/);
  assert.match(body, /if \(bgAudioGesturePrimed \|\| !bgAudioEl\) return;/);
  // The setting-gate must be checked BEFORE bgAudioGesturePrimed is ever
  // set, so a later gesture in the same session -- once the settings fetch
  // resolves -- still gets a real, un-consumed chance to prime (mirrors the
  // pre-existing bgAudioState !== INLINE_VIDEO early-return's own pattern).
  const settingGateIdx = body.indexOf('if (bgAudioSettingCached !== true) return;');
  const primedSetIdx = body.indexOf('bgAudioGesturePrimed = true;');
  assert.ok(settingGateIdx !== -1 && primedSetIdx !== -1 && settingGateIdx < primedSetIdx);
});

test('F3 source-lock: the prime\'s success continuation never pauses bgAudioEl once a real handoff has taken over (bgAudioState !== INLINE_VIDEO)', () => {
  const match = /function primeBackgroundAudioElement\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  const thenBranch = /p\.then\(function \(\) \{([\s\S]*?)\n {8}\}, function \(err\) \{/.exec(body);
  assert.ok(thenBranch, "expected the prime play()'s success (.then) continuation");
  const thenBody = thenBranch[1];
  assert.match(thenBody, /bgAudioEl\.muted = wasMuted;/, 'mute state must always be restored, even when a real handoff has taken over');
  assert.match(thenBody, /if \(bgAudioState !== BG_AUDIO_STATES\.INLINE_VIDEO\) return;/, 'must bail BEFORE pause() once a real handoff is in progress/succeeded');
  const muteIdx = thenBody.indexOf('bgAudioEl.muted = wasMuted;');
  const guardIdx = thenBody.indexOf('if (bgAudioState !== BG_AUDIO_STATES.INLINE_VIDEO) return;');
  const pauseIdx = thenBody.indexOf('bgAudioEl.pause();');
  assert.ok(muteIdx !== -1 && guardIdx !== -1 && pauseIdx !== -1);
  assert.ok(muteIdx < guardIdx && guardIdx < pauseIdx, 'expected order: restore mute, THEN guard, THEN (conditionally) pause');
});

// ---- F3b (two-reviewer follow-up): no-network prime -----------------------
// A default-OFF feature must not cause real /audio/:id requests (and
// possible FFmpeg-extraction enqueues) on every mobile video's first
// gesture. primeBackgroundAudioElement now primes with a LOCAL silent
// data-URI clip, never the real network URL.

test('F3b source-lock: primeBackgroundAudioElement() references SILENT_PRIME_SRC and NEVER references \'/audio/\'', () => {
  const match = /function primeBackgroundAudioElement\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find primeBackgroundAudioElement()\'s source body');
  const body = match[1];
  assert.match(body, /bgAudioEl\.src = SILENT_PRIME_SRC;/, 'expected the prime to assign the silent data-URI clip');
  assert.ok(!/'\/audio\//.test(body), 'primeBackgroundAudioElement must never reference the real /audio/:id URL');
});

test('F3b source-lock: SILENT_PRIME_SRC is a LOCAL data: URI (never a network URL), defined once at module scope', () => {
  assert.match(PLAYER_JS, /var SILENT_PRIME_SRC = 'data:audio\/wav;base64,[A-Za-z0-9+/=]+';/);
});

test('F3b: SILENT_PRIME_SRC is a small (well under a few hundred bytes), valid data: URI', () => {
  const match = /var SILENT_PRIME_SRC = '(data:audio\/wav;base64,[A-Za-z0-9+/=]+)';/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find the SILENT_PRIME_SRC declaration');
  const dataUri = match[1];
  assert.match(dataUri, /^data:audio\/wav;base64,/);
  const b64 = dataUri.slice(dataUri.indexOf(',') + 1);
  const decoded = Buffer.from(b64, 'base64');
  assert.ok(decoded.length < 300, `expected a tiny clip well under a few hundred bytes, got ${decoded.length}`);
  // Sanity-check it is at least a well-formed WAV (RIFF/WAVE magic).
  assert.equal(decoded.toString('ascii', 0, 4), 'RIFF');
  assert.equal(decoded.toString('ascii', 8, 12), 'WAVE');
});

test('F3b source-lock: primeBackgroundAudioElement() never primes while a real handoff is already active (bgAudioState !== INLINE_VIDEO)', () => {
  const match = /function primeBackgroundAudioElement\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  assert.match(body, /if \(bgAudioState !== BG_AUDIO_STATES\.INLINE_VIDEO\) return;/, 'expected an early return before ever assigning the silent src or setting bgAudioGesturePrimed');
  // The guard must come BEFORE bgAudioGesturePrimed is set, so a real
  // handoff already in progress leaves a later gesture a genuine second
  // chance to prime once back to INLINE_VIDEO.
  const guardIdx = body.indexOf('if (bgAudioState !== BG_AUDIO_STATES.INLINE_VIDEO) return;');
  const primedIdx = body.indexOf('bgAudioGesturePrimed = true;');
  assert.ok(guardIdx !== -1 && primedIdx !== -1 && guardIdx < primedIdx);
});

test('F3b source-lock: the ONLY bgAudioEl.src assignment to the real /audio/:id URL lives inside attemptBackgroundAudioHandoff (already setting-gated)', () => {
  const assignmentSites = [...PLAYER_JS.matchAll(/bgAudioEl\.src\s*=\s*[^;]+;/g)].map((m) => m[0]);
  // Exactly two real assignment sites in the whole file: the silent prime
  // (primeBackgroundAudioElement) and the real handoff (attemptBackgroundAudioHandoff).
  assert.strictEqual(assignmentSites.length, 2, `expected exactly 2 bgAudioEl.src assignment sites, found: ${JSON.stringify(assignmentSites)}`);
  assert.ok(assignmentSites.some((s) => s.includes('SILENT_PRIME_SRC')), 'expected the silent-prime assignment');
  assert.ok(assignmentSites.some((s) => s.includes('audioUrl')), 'expected the real-handoff assignment (via the audioUrl local)');

  const handoffMatch = /function attemptBackgroundAudioHandoff\(trigger\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(handoffMatch, 'expected to find attemptBackgroundAudioHandoff()\'s source body');
  assert.match(handoffMatch[1], /var audioUrl = '\/audio\/' \+ currentId;/, 'the real /audio/:id URL must be assigned inside attemptBackgroundAudioHandoff');
  // attemptBackgroundAudioHandoff only ever runs past shouldHandOffToBackgroundAudio's
  // settingOn gate (see the mutual-exclusion source-lock test above) -- so
  // this real-src assignment is itself setting-gated by construction.
});

test('F3b: with the setting OFF, setupForMedia() never assigns bgAudioEl.src to the real /audio/:id URL at all', () => {
  const match = /function setupForMedia\(id, data\) \{([\s\S]*?)\n {4}setupMediaSession\(id, data\.channelName, data\.title\);/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find the start of setupForMedia()\'s source body');
  const body = match[1];
  assert.ok(!/bgAudioEl\.src\s*=/.test(body), 'setupForMedia must never itself assign bgAudioEl.src -- only attemptBackgroundAudioHandoff (setting-gated) and the silent prime may');
});

// ---- F6 (nit, two-reviewer gate): the debug overlay reports truthfully ---
// ---- during BACKGROUND_AUDIO ------------------------------------------------

test('F6 source-lock: recordLifecycleEvent() reads activeMediaElement(), not a hardcoded mediaPlayer', () => {
  const match = /function recordLifecycleEvent\(type, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find recordLifecycleEvent()\'s source body');
  const body = match[1];
  assert.match(body, /var activeEl = activeMediaElement\(\);/);
  assert.match(body, /playing: !!\(activeEl && !activeEl\.paused\),/);
  assert.ok(!/mediaPlayer && !mediaPlayer\.paused/.test(body), 'must never read a hardcoded mediaPlayer.paused -- that lies during BACKGROUND_AUDIO');
});

// ---- v1.27.1: background-audio handoff diagnostics ------------------------
// The owner cannot distinguish, remotely, WHY a real handoff didn't engage
// (setting off? sidecar not ready? the iOS gesture wall? priming never ran?
// the setting cache never populated?). Every decision point in the
// background-audio path now records a `?debugLifecycle=1` overlay event via
// the EXISTING `recordLifecycleEvent`, extended with an optional `detail`
// string -- covered here by source-lock (no jsdom/browser harness, see the
// file banner above) plus the pure `bgAudioSkipReason()` helper (invoked
// directly, since it reads only module-scoped state via closures it can't
// reach from node:test -- so it's exercised through the source-lock instead).

test('bgAudioSkipReason() precedence mirrors shouldHandOffToBackgroundAudio(): setting-off, then status-<x>, then state-<x>', () => {
  const match = /function bgAudioSkipReason\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find bgAudioSkipReason()\'s source body');
  const body = match[1];
  assert.match(body, /if \(!bgAudioSettingCached\) return 'setting-off';/);
  assert.match(body, /if \(bgAudioStatusKnown !== 'ready'\) return 'status-' \+ \(bgAudioStatusKnown \|\| 'none'\);/);
  assert.match(body, /return 'state-' \+ bgAudioState;/);
  const settingIdx = body.indexOf("return 'setting-off';");
  const statusIdx = body.indexOf("return 'status-'");
  const stateIdx = body.indexOf("return 'state-'");
  assert.ok(settingIdx !== -1 && statusIdx !== -1 && stateIdx !== -1);
  assert.ok(settingIdx < statusIdx && statusIdx < stateIdx, 'expected the same short-circuit order as shouldHandOffToBackgroundAudio');
});

test("attemptBackgroundAudioHandoff(): records 'bgAudio:skip' with bgAudioSkipReason() detail on the ineligible early-out, still returns false (no behavior change)", () => {
  const match = /function attemptBackgroundAudioHandoff\(trigger\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find attemptBackgroundAudioHandoff()\'s source body');
  const body = match[1];
  const skipBranch = /if \(!eligible\) \{([\s\S]*?)\n {4}\}/.exec(body);
  assert.ok(skipBranch, 'expected the !eligible early-out branch');
  assert.match(skipBranch[1], /recordLifecycleEvent\('bgAudio:skip', \{ detail: bgAudioSkipReason\(\) \}\);/);
  assert.match(skipBranch[1], /return false;/);
  const recordIdx = skipBranch[1].indexOf("recordLifecycleEvent('bgAudio:skip'");
  const returnFalseIdx = skipBranch[1].indexOf('return false;');
  assert.ok(recordIdx !== -1 && returnFalseIdx !== -1 && recordIdx < returnFalseIdx, 'the record must happen before the (unchanged) false return within this branch');
});

test("attemptBackgroundAudioHandoff(): records 'bgAudio:handoff' with position + primed + trigger detail right after the state transitions to HANDING_OFF, before play() is even attempted", () => {
  const match = /function attemptBackgroundAudioHandoff\(trigger\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  // F-D (v1.27.1): the detail also names WHICH trigger fired ('visibility',
  // the default, or 'pause-hidden') -- defaults to 'visibility' when the
  // caller omits the argument (the original, pre-F-D call shape).
  assert.match(body, /recordLifecycleEvent\('bgAudio:handoff', \{ detail: 'pos=' \+ resumeTime\.toFixed\(1\) \+ 's primed=' \+ bgAudioGesturePrimed \+ ' trigger:' \+ \(trigger \|\| 'visibility'\) \}\);/);
  const handoffRecordIdx = body.indexOf("recordLifecycleEvent('bgAudio:handoff'");
  const playIdx = body.indexOf('playAttempt = bgAudioEl.play();');
  assert.ok(handoffRecordIdx !== -1 && playIdx !== -1 && handoffRecordIdx < playIdx);
});

test("attemptBackgroundAudioHandoff(): records 'bgAudio:ok' (with the element's currentTime) on play() resolving, 'bgAudio:fail' (err.name + truncated message) on play() rejecting -- neither alters the pre-existing state-transition/save/UI calls", () => {
  const match = /function attemptBackgroundAudioHandoff\(trigger\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  const thenBranch = /Promise\.resolve\(playAttempt\)\.then\(function \(\) \{([\s\S]*?)\n {4}\}, function \(err\) \{([\s\S]*?)\n {4}\}\);/.exec(body);
  assert.ok(thenBranch, 'expected the play() resolve/reject continuation with an `err` parameter on the reject side');
  const resolveBody = thenBranch[1];
  const rejectBody = thenBranch[2];
  assert.match(resolveBody, /recordLifecycleEvent\('bgAudio:ok', \{ detail: 't=' \+ \(bgAudioEl\.currentTime \|\| 0\)\.toFixed\(1\) \+ 's' \}\);/);
  assert.match(resolveBody, /nextBackgroundAudioState\(bgAudioState, 'HANDOFF_SUCCEEDED', \{\}\);/, 'the existing success state transition must be unchanged');
  assert.match(resolveBody, /setupMediaSession\(currentId, currentChannelName, currentData && currentData\.title\);/, 'the existing Media Session re-assert must be unchanged');
  assert.match(rejectBody, /recordLifecycleEvent\('bgAudio:fail', \{ detail: \(err && err\.name \|\| 'Error'\) \+ ':' \+ String\(\(err && err\.message\) \|\| ''\)\.slice\(0, 40\) \}\);/);
  assert.match(rejectBody, /nextBackgroundAudioState\(bgAudioState, 'HANDOFF_FAILED', \{\}\);/, 'the existing failure state transition must be unchanged');
});

test('mutual exclusion (source-lock) is unaffected: attemptBackgroundAudioHandoff still has exactly one call site inside handleBackgroundLifecycle, still inside the shouldPauseForLifecycleEvent(...) truthy branch (neither the diagnostics nor F-D moved it)', () => {
  const fnMatch = /function handleBackgroundLifecycle\(eventType, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = fnMatch[1];
  const callSites = body.match(/attemptBackgroundAudioHandoff\(/g) || [];
  assert.strictEqual(callSites.length, 1);
});

test("handleBackgroundLifecycle(): records 'bgAudio:skip' with detail 'native-presentation' or 'not-video' for the two early-outs that bypass attemptBackgroundAudioHandoff entirely, gated on LIFECYCLE_PAUSE_EVENTS + ctx.isPlaying (never noise on a paused item or an unrelated event type)", () => {
  const fnMatch = /function handleBackgroundLifecycle\(eventType, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = fnMatch[1];
  const guardBranch = /if \(LIFECYCLE_PAUSE_EVENTS\[eventType\] && ctx\.isPlaying\) \{([\s\S]*?)\n {4}\}/.exec(body);
  assert.ok(guardBranch, 'expected the gated diagnostic-skip block');
  const guardBody = guardBranch[1];
  assert.match(guardBody, /if \(ctx\.inNativePresentation\) \{\s*\n\s*recordLifecycleEvent\('bgAudio:skip', \{ detail: 'native-presentation' \}\);/);
  assert.match(guardBody, /\} else if \(ctx\.isAudio\) \{\s*\n\s*recordLifecycleEvent\('bgAudio:skip', \{ detail: 'not-video' \}\);/);
  // Must be evaluated BEFORE the shouldPauseForLifecycleEvent(...) branch,
  // mirroring that function's own inNativePresentation-before-isAudio order.
  const guardIdx = body.indexOf('if (LIFECYCLE_PAUSE_EVENTS[eventType] && ctx.isPlaying) {');
  const pauseCheckIdx = body.indexOf('if (shouldPauseForLifecycleEvent(eventType, ctx)) {');
  assert.ok(guardIdx !== -1 && pauseCheckIdx !== -1 && guardIdx < pauseCheckIdx);
});

test("primeBackgroundAudioElement(): records 'bgAudio:prime' ok/fail on its own play() continuation, still never pauses a real handoff out from under itself (F3 regression unchanged)", () => {
  const match = /function primeBackgroundAudioElement\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  const thenBranch = /p\.then\(function \(\) \{([\s\S]*?)\n {8}\}, function \(err\) \{([\s\S]*?)\n {8}\}\);/.exec(body);
  assert.ok(thenBranch, "expected the prime play()'s resolve/reject continuation with an `err` parameter on the reject side");
  assert.match(thenBranch[1], /recordLifecycleEvent\('bgAudio:prime', \{ detail: 'ok' \}\);/);
  assert.match(thenBranch[2], /recordLifecycleEvent\('bgAudio:prime', \{ detail: 'fail:' \+ \(err && err\.name \|\| 'Error'\) \}\);/);
  // Regression: the 'ok' record must run BEFORE the INLINE_VIDEO guard, so it
  // is recorded even when a real handoff has already raced ahead -- but the
  // guard (and therefore the skipped pause()) must be unchanged.
  const recordIdx = thenBranch[1].indexOf("recordLifecycleEvent('bgAudio:prime'");
  const guardIdx = thenBranch[1].indexOf('if (bgAudioState !== BG_AUDIO_STATES.INLINE_VIDEO) return;');
  const pauseIdx = thenBranch[1].indexOf('bgAudioEl.pause();');
  assert.ok(recordIdx !== -1 && guardIdx !== -1 && pauseIdx !== -1);
  assert.ok(recordIdx < guardIdx && guardIdx < pauseIdx);
});

test("handleForegroundSwapBack(): records 'bgAudio:swapback' with the audio->video position handoff, still releases the background element and consumes a deferred autoplay-advance exactly once (unchanged)", () => {
  const match = /function handleForegroundSwapBack\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  assert.match(body, /recordLifecycleEvent\('bgAudio:swapback', \{ detail: 'audio=' \+ resumeTime\.toFixed\(1\) \+ 's->video=' \+ \(mediaPlayer \? mediaPlayer\.currentTime\.toFixed\(1\) : '\?'\) \+ 's' \}\);/);
  const recordIdx = body.indexOf("recordLifecycleEvent('bgAudio:swapback'");
  const releaseIdx = body.indexOf('releaseBackgroundAudioElement();');
  assert.ok(recordIdx !== -1 && releaseIdx !== -1 && recordIdx < releaseIdx, 'expected the record to happen before the element is released (still reading real state, not torn down)');
});

test("setupForMedia(): records 'bgAudio:arm' once the setting resolves ON, using the FRESH prepare-audio audioStatus (never the stale load-time snapshot)", () => {
  const match = /function setupForMedia\(id, data\) \{([\s\S]*?)\n {4}setupMediaSession\(id, data\.channelName, data\.title\);/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find the start of setupForMedia()\'s source body');
  const body = match[1];
  assert.match(body, /recordLifecycleEvent\('bgAudio:arm', \{ detail: 'status=' \+ \(bgAudioStatusKnown \|\| 'none'\) \}\);/);
  // F6 (two-reviewer gate, v1.27.1 post-release): the assignment widened
  // from `if (body) bgAudioStatusKnown = ...` to an unconditional ternary
  // (see the F6 tests below) -- still refreshed BEFORE the arm record either way.
  const statusAssignIdx = body.indexOf("bgAudioStatusKnown = body ? (body.audioStatus || null) : null;");
  const armRecordIdx = body.indexOf("recordLifecycleEvent('bgAudio:arm'");
  assert.ok(statusAssignIdx !== -1 && armRecordIdx !== -1 && statusAssignIdx < armRecordIdx, 'the arm record must read bgAudioStatusKnown AFTER it has been refreshed from the prepare-audio response');
});

test('setupForMedia(): never records bgAudio:arm when the setting resolves OFF (the early `if (!bgAudioSettingCached) return;` still short-circuits before the prepare-audio POST)', () => {
  const match = /function setupForMedia\(id, data\) \{([\s\S]*?)\n {4}setupMediaSession\(id, data\.channelName, data\.title\);/.exec(PLAYER_JS);
  const body = match[1];
  const settingOffReturnIdx = body.indexOf('if (!bgAudioSettingCached) return;');
  const armRecordIdx = body.indexOf("recordLifecycleEvent('bgAudio:arm'");
  assert.ok(settingOffReturnIdx !== -1 && armRecordIdx !== -1 && settingOffReturnIdx < armRecordIdx, 'expected the setting-off early-return to remain textually before (and therefore still guard) the arm record');
});

// ---- F-C (v1.27.1, first-watch handoff fix): bounded prepare-audio re-poll

test('F-C source-lock: setupForMedia() kicks off scheduleAudioStatusRepoll() when the FIRST prepare-audio response is non-terminal (not ready, not failed)', () => {
  const match = /function setupForMedia\(id, data\) \{([\s\S]*?)\n {4}setupMediaSession\(id, data\.channelName, data\.title\);/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find the start of setupForMedia()\'s source body');
  const body = match[1];
  assert.match(
    body,
    /if \(bgAudioStatusKnown !== 'ready' && bgAudioStatusKnown !== 'failed'\) \{\s*\n\s*scheduleAudioStatusRepoll\(id, gen, BG_AUDIO_STATUS_REPOLL_MAX_ATTEMPTS\);\s*\n\s*\}/
  );
  const armIdx = body.indexOf("recordLifecycleEvent('bgAudio:arm'");
  const repollIdx = body.indexOf('scheduleAudioStatusRepoll(id, gen, BG_AUDIO_STATUS_REPOLL_MAX_ATTEMPTS);');
  assert.ok(armIdx !== -1 && repollIdx !== -1 && armIdx < repollIdx, 'expected the initial arm record before the repoll is scheduled');
});

test('scheduleAudioStatusRepoll() exists, is capped at BG_AUDIO_STATUS_REPOLL_MAX_ATTEMPTS = 12, and polls every BG_AUDIO_STATUS_REPOLL_INTERVAL_MS = 5000ms', () => {
  assert.match(PLAYER_JS, /var BG_AUDIO_STATUS_REPOLL_MAX_ATTEMPTS = 12;/);
  assert.match(PLAYER_JS, /var BG_AUDIO_STATUS_REPOLL_INTERVAL_MS = 5000;/);
  const match = /function scheduleAudioStatusRepoll\(id, gen, attemptsLeft\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find scheduleAudioStatusRepoll()\'s source body');
  const body = match[1];
  assert.match(body, /if \(attemptsLeft <= 0\) return;/, 'expected an attempts-remaining guard as the very first statement');
  assert.match(body, /setTimeout\(function \(\) \{/);
  assert.match(body, /\}, BG_AUDIO_STATUS_REPOLL_INTERVAL_MS\);/);
});

test('scheduleAudioStatusRepoll() is generation-guarded (both before scheduling the fetch and again before acting on its response) so a superseded load can never mutate the WRONG item\'s bgAudioStatusKnown', () => {
  const match = /function scheduleAudioStatusRepoll\(id, gen, attemptsLeft\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  const genChecks = body.match(/gen !== loadGeneration/g) || [];
  assert.strictEqual(genChecks.length, 2, 'expected exactly 2 gen !== loadGeneration checks: one before the fetch, one before applying its response');
});

test('scheduleAudioStatusRepoll() fetches the SAME idempotent POST prepare-audio endpoint used by the initial (load-time) call', () => {
  const match = /function scheduleAudioStatusRepoll\(id, gen, attemptsLeft\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  assert.match(body, /fetch\('\/api\/videos\/' \+ encodeURIComponent\(id\) \+ '\/prepare-audio', \{ method: 'POST' \}\)/);
});

test("scheduleAudioStatusRepoll() stops re-scheduling once the status is TERMINAL ('ready' or 'failed'), but keeps going (attemptsLeft - 1) for any other status (pending/processing)", () => {
  const match = /function scheduleAudioStatusRepoll\(id, gen, attemptsLeft\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  assert.match(body, /if \(newStatus !== 'ready' && newStatus !== 'failed'\) \{\s*\n\s*scheduleAudioStatusRepoll\(id, gen, attemptsLeft - 1\);\s*\n\s*\}/);
});

test("scheduleAudioStatusRepoll() records 'bgAudio:arm' (detail 'status=ready (repoll)') exactly on the transition INTO 'ready', never on every still-pending poll (no overlay spam)", () => {
  const match = /function scheduleAudioStatusRepoll\(id, gen, attemptsLeft\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  assert.match(body, /var justBecameReady = newStatus === 'ready' && bgAudioStatusKnown !== 'ready';/);
  assert.match(body, /if \(justBecameReady\) \{\s*\n\s*recordLifecycleEvent\('bgAudio:arm', \{ detail: 'status=ready \(repoll\)' \}\);\s*\n\s*\}/);
  // The transition check must read the OLD bgAudioStatusKnown before it is
  // overwritten by the fresh response.
  const justBecameReadyIdx = body.indexOf('var justBecameReady');
  const assignIdx = body.indexOf('bgAudioStatusKnown = newStatus;');
  assert.ok(justBecameReadyIdx !== -1 && assignIdx !== -1 && justBecameReadyIdx < assignIdx);
});

test('scheduleAudioStatusRepoll() never throws/propagates on a failed fetch -- the chain simply stops (best-effort, matching the initial prepare-audio call\'s own degrade-gracefully contract)', () => {
  const match = /function scheduleAudioStatusRepoll\(id, gen, attemptsLeft\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  assert.match(body, /\.catch\(function \(\) \{/);
});

// ---- F7 (two-reviewer NIT, v1.27.1 post-release): scheduleAudioStatusRepoll's
// ---- own setTimeout handle is captured + cleared like the file's other timers

test('F7 source-lock: audioStatusRepollTimer is declared alongside the file\'s other player-scoped timer handles (progressInterval, skipRevealTimer, transcodePollTimer)', () => {
  const timerBlockMatch = /var progressInterval = null;\s*\n\s*var skipRevealTimer = null;\s*\n\s*var transcodePollTimer = null;([\s\S]*?)var audioStatusRepollTimer = null;/.exec(PLAYER_JS);
  assert.ok(timerBlockMatch, 'expected audioStatusRepollTimer to be declared in the same block as the other player-scoped timers');
});

test('F7 source-lock: scheduleAudioStatusRepoll() assigns its setTimeout handle to audioStatusRepollTimer, and clears it to null as the first statement inside the callback', () => {
  const match = /function scheduleAudioStatusRepoll\(id, gen, attemptsLeft\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  assert.match(body, /audioStatusRepollTimer = setTimeout\(function \(\) \{/);
  const callbackMatch = /audioStatusRepollTimer = setTimeout\(function \(\) \{([\s\S]*?)\n\s*\}, BG_AUDIO_STATUS_REPOLL_INTERVAL_MS\);/.exec(body);
  assert.ok(callbackMatch, 'expected the setTimeout callback body to be isolated for inspection');
  assert.match(callbackMatch[1].trim(), /^audioStatusRepollTimer = null;/, 'expected the handle to be cleared to null as the very first statement once the timer actually fires');
});

test('F7 source-lock: teardownMediaState() and close() both cancel a still-pending audioStatusRepollTimer, mirroring how they already cancel progressInterval/transcodePollTimer', () => {
  for (const fnName of ['teardownMediaState', 'close']) {
    const match = new RegExp(`function ${fnName}\\(\\) \\{([\\s\\S]*?)\\n {2}\\}`).exec(PLAYER_JS);
    assert.ok(match, `expected to find ${fnName}()'s source body`);
    assert.match(
      match[1],
      /if \(audioStatusRepollTimer\) \{ clearTimeout\(audioStatusRepollTimer\); audioStatusRepollTimer = null; \}/,
      `expected ${fnName}() to cancel a still-pending audioStatusRepollTimer`
    );
  }
});

// ---- F6 (two-reviewer gate, v1.27.1 post-release): don't trust a stale ----
// ---- 'ready' snapshot when the prepare-audio round trip fails -------------
// On a non-ok response (or an outright fetch failure), the load-time
// `data.audioStatus` snapshot (possibly a STALE 'ready' -- see F1's own
// comment above) must never survive as bgAudioStatusKnown: it is explicitly
// reset to null (unknown), so shouldHandOffToBackgroundAudio's `audioStatus
// !== 'ready'` check fails safe rather than trusting a value this very
// request just failed to refresh.

test("F6 source-lock: a non-ok prepare-audio response (body === null) resets bgAudioStatusKnown to null, never leaving the stale load-time snapshot standing in", () => {
  const match = /function setupForMedia\(id, data\) \{([\s\S]*?)\n {4}setupMediaSession\(id, data\.channelName, data\.title\);/.exec(PLAYER_JS);
  const body = match[1];
  assert.match(body, /bgAudioStatusKnown = body \? \(body\.audioStatus \|\| null\) : null;/);
});

test('F6 (executable): the fixed ternary resolves to null for a non-ok (null body) response, and to the fresh status (including an explicitly-absent field) for a successful one', () => {
  // Exact reproduction of the fixed assignment expression -- locked
  // structurally by the source-lock test above.
  function resolveBgAudioStatusKnown(body) {
    return body ? (body.audioStatus || null) : null;
  }
  assert.strictEqual(resolveBgAudioStatusKnown(null), null, 'a non-ok response (body === null) must resolve to UNKNOWN, never a stale prior value');
  assert.strictEqual(resolveBgAudioStatusKnown({ audioStatus: 'ready' }), 'ready');
  assert.strictEqual(resolveBgAudioStatusKnown({ audioStatus: 'pending' }), 'pending');
  assert.strictEqual(resolveBgAudioStatusKnown({}), null, 'a successful response that omits the field must still resolve to null (unknown), not silently keep a stale prior value');
});

test('F6 source-lock: a fetch-level failure of the settings/prepare-audio chain (not merely a non-ok status) also resets bgAudioStatusKnown to null, generation-guarded', () => {
  const match = /function setupForMedia\(id, data\) \{([\s\S]*?)\n {4}setupMediaSession\(id, data\.channelName, data\.title\);/.exec(PLAYER_JS);
  const body = match[1];
  const catchMatch = /\.catch\(function \(\) \{([\s\S]*?)\n\s*\}\);\s*\n\s*\}\s*\n\s*\n\s*\/\/ A6/.exec(body);
  assert.ok(catchMatch, 'expected to find the settings/prepare-audio chain\'s own .catch() block');
  assert.match(catchMatch[1], /if \(gen === loadGeneration\) bgAudioStatusKnown = null;/);
});

// ---- F-A (v1.27.1 REGRESSION FIX): bgAudioEl's play/pause listeners are ---
// ---- gated on activeMediaElement() === bgAudioEl --------------------------
// Without this guard, primeBackgroundAudioElement()'s own muted play()-
// >pause() "bless" cycle ALSO fired these listeners on every gesture, on
// every install (regardless of the setting) -- racing setPlaybackState(...)
// against the real video's own listeners and silently poisoning MediaSession
// playbackState back to 'paused' out from under a still-playing video (the
// v1.25.2 regression Dean hit on-device). Source-locked directly (no jsdom/
// browser harness, see the file banner above).

const wireHostListenersMatch = /function wireHostListeners\(\) \{([\s\S]*?)\n {2}\}\n/.exec(PLAYER_JS);

test('F-A source-lock: wireHostListeners() exists and is isolated for inspection', () => {
  assert.ok(wireHostListenersMatch, 'expected to find wireHostListeners()\'s source body in player.js');
});

test("F-A source-lock: all four bgAudioEl play/pause listeners (progress-saver start/stop, MediaSession playbackState playing/paused) are guarded by `if (activeMediaElement() !== bgAudioEl) return;` as their first statement", () => {
  const body = wireHostListenersMatch[1];
  assert.match(
    body,
    /bgAudioEl\.addEventListener\('play', function \(\) \{ if \(activeMediaElement\(\) !== bgAudioEl\) return; startProgressSaver\(\); \}\);/,
    'expected the progress-saver START listener to be guarded'
  );
  assert.match(
    body,
    /bgAudioEl\.addEventListener\('pause', function \(\) \{ if \(activeMediaElement\(\) !== bgAudioEl\) return; stopProgressSaver\(\); \}\);/,
    'expected the progress-saver STOP listener to be guarded'
  );
  assert.match(
    body,
    /bgAudioEl\.addEventListener\('play', function \(\) \{ if \(activeMediaElement\(\) !== bgAudioEl\) return; setPlaybackState\('playing'\); updatePositionState\(true\); \}\);/,
    "expected the MediaSession 'playing' listener to be guarded"
  );
  assert.match(
    body,
    /bgAudioEl\.addEventListener\('pause', function \(\) \{ if \(activeMediaElement\(\) !== bgAudioEl\) return; setPlaybackState\('paused'\); updatePositionState\(true\); \}\);/,
    "expected the MediaSession 'paused' listener to be guarded"
  );
});

test("F-A source-lock: mediaPlayer's own play/pause listeners (progress saver) are UNCHANGED -- unguarded, no regression to the primary video path", () => {
  const body = wireHostListenersMatch[1];
  assert.match(body, /mediaPlayer\.addEventListener\('play', startProgressSaver\);/);
  assert.match(body, /mediaPlayer\.addEventListener\('pause', stopProgressSaver\);/);
});

// ---- Full skip-reason vocabulary (documentation-as-test) -------------------
// Pins the exact 5 reason strings the overlay can ever show for a
// background-audio handoff that did not happen, split across the two call
// sites that produce them.

test('the full bgAudio:skip vocabulary is exactly: setting-off | status-<x> | state-<x> (from attemptBackgroundAudioHandoff) and native-presentation | not-video (from handleBackgroundLifecycle)', () => {
  const handoffMatch = /function attemptBackgroundAudioHandoff\(trigger\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.match(handoffMatch[1], /'bgAudio:skip'/);
  const skipReasonMatch = /function bgAudioSkipReason\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.match(skipReasonMatch[1], /'setting-off'/);
  assert.match(skipReasonMatch[1], /'status-'/);
  assert.match(skipReasonMatch[1], /'state-'/);
  const lifecycleMatch = /function handleBackgroundLifecycle\(eventType, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.match(lifecycleMatch[1], /'native-presentation'/);
  assert.match(lifecycleMatch[1], /'not-video'/);
});

// ---- F-D (v1.27.1): dual-trigger handoff for iOS pre-pause ordering -------
// On-device investigation found iOS can system-pause an inline video BEFORE
// `visibilitychangeHidden` ever fires, so `ctx.isPlaying` is already `false`
// by the time `handleBackgroundLifecycle` runs its own gate -- the handoff
// was never even attempted for that specific interleaving. A precise SECOND
// trigger (`handlePossibleIOSPrePauseHandoff`, wired on mediaPlayer's own
// 'pause' event) covers it, safe by construction (a real user pause only
// ever happens while `document.visibilityState === 'visible'`, and every
// one of this file's own lifecycle-driven pauses is wrapped in
// `pauseSuppressingHandoff`/`suppressPauseHandoff` so it never re-enters).

test('F-D source-lock: suppressPauseHandoff is declared as per-instance state (not per-load -- never reset in teardownMediaState/close)', () => {
  assert.match(PLAYER_JS, /var suppressPauseHandoff = false;/);
  for (const fnName of ['teardownMediaState', 'close']) {
    const match = new RegExp(`function ${fnName}\\(\\) \\{([\\s\\S]*?)\\n {2}\\}`).exec(PLAYER_JS);
    assert.ok(match, `expected to find ${fnName}()'s source body`);
    assert.ok(!/suppressPauseHandoff/.test(match[1]), `${fnName} must never touch suppressPauseHandoff -- it is only ever meaningful for the synchronous extent of a single pause() call, nothing to reset per-load`);
  }
});

test('F-D source-lock: pauseSuppressingHandoff(el) sets suppressPauseHandoff BEFORE calling el.pause(), and resets it via a DEFERRED setTimeout (never an immediate try/finally, which would clear the flag before the async \'pause\' event ever fires)', () => {
  const match = /function pauseSuppressingHandoff\(el\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find pauseSuppressingHandoff()\'s source body');
  const body = match[1];
  assert.match(body, /if \(!el\) return;/);
  assert.match(body, /suppressPauseHandoff = true;/);
  assert.match(body, /el\.pause\(\);/);
  assert.match(body, /setTimeout\(function \(\) \{ suppressPauseHandoff = false; \}, 0\);/);
  // Order: set true, THEN pause(), THEN the (deferred) reset registration --
  // never a synchronous try/finally around the reset itself.
  const setTrueIdx = body.indexOf('suppressPauseHandoff = true;');
  const pauseIdx = body.indexOf('el.pause();');
  const resetRegisterIdx = body.indexOf('setTimeout(function () { suppressPauseHandoff = false; }, 0);');
  assert.ok(setTrueIdx !== -1 && pauseIdx !== -1 && resetRegisterIdx !== -1);
  assert.ok(setTrueIdx < pauseIdx && pauseIdx < resetRegisterIdx);
  assert.ok(!/finally/.test(body), 'must never use try/finally to reset the flag synchronously -- that would clear it before the async pause event fires');
});

test('F-D/F1/F5 source-lock: every one of this file\'s own lifecycle-driven mediaPlayer pauses is routed through pauseSuppressingHandoff (releaseAudioSession, attemptBackgroundAudioHandoff, handleBackgroundLifecycle\'s plain-pause fallback, teardownMediaState, close(), the MediaSession \'pause\' action handler) -- never a bare mediaPlayer.pause() at any of those SIX sites', () => {
  const releaseMatch = /function releaseAudioSession\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.match(releaseMatch[1], /pauseSuppressingHandoff\(mediaPlayer\);/);
  assert.ok(!/mediaPlayer\.pause\(\);/.test(releaseMatch[1]), 'expected no bare mediaPlayer.pause() left in releaseAudioSession');

  const handoffMatch = /function attemptBackgroundAudioHandoff\(trigger\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.match(handoffMatch[1], /pauseSuppressingHandoff\(mediaPlayer\);/);

  const lifecycleMatch = /function handleBackgroundLifecycle\(eventType, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const pauseBranch = /if \(shouldPauseForLifecycleEvent\(eventType, ctx\)\) \{([\s\S]*?)\n {4}\}/.exec(lifecycleMatch[1]);
  assert.ok(pauseBranch);
  assert.match(pauseBranch[1], /pauseSuppressingHandoff\(mediaPlayer\);/);

  // F5 (two-reviewer gate, structural consistency, v1.27.1 post-release):
  // the two remaining bare lifecycle pauses, extended to the same wrapper.
  const teardownMatch = /function teardownMediaState\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(teardownMatch, 'expected to find teardownMediaState()\'s source body');
  assert.match(teardownMatch[1], /pauseSuppressingHandoff\(mediaPlayer\);/);
  assert.ok(!/mediaPlayer\.pause\(\);/.test(teardownMatch[1]), 'expected no bare mediaPlayer.pause() left in teardownMediaState');

  const closeMatch = /function close\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(closeMatch, 'expected to find close()\'s source body');
  assert.match(closeMatch[1], /pauseSuppressingHandoff\(mediaPlayer\);/);
  assert.ok(!/mediaPlayer\.pause\(\);/.test(closeMatch[1]), 'expected no bare mediaPlayer.pause() left in close()');

  // F1 (two-reviewer gate, v1.27.1 post-release): the lock-screen/Control-
  // Center MediaSession 'pause' action handler, mediaPlayer branch only.
  assert.match(PLAYER_JS, /if \(el === mediaPlayer\) pauseSuppressingHandoff\(mediaPlayer\);\s*\n\s*else el\.pause\(\);/);
});

test('F-D source-lock: user-driven pauses (togglePlayPause, the spacebar shortcut) are UNCHANGED -- still a bare mediaPlayer.pause(), never routed through pauseSuppressingHandoff (they must keep firing the real \'pause\' event/listeners normally)', () => {
  const toggleMatch = /function togglePlayPause\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(toggleMatch, 'expected to find togglePlayPause()\'s source body');
  assert.match(toggleMatch[1], /else mediaPlayer\.pause\(\);/);
  assert.ok(!/pauseSuppressingHandoff/.test(toggleMatch[1]), 'a real user play/pause toggle must never be treated as a lifecycle-driven pause');
});

test('F-D source-lock: handlePossibleIOSPrePauseHandoff() consumes suppressPauseHandoff and checks document.visibilityState === \'hidden\' as its first two guards, in that order, before re-deriving video/mobile/native-presentation/state-machine preconditions independently', () => {
  const match = /function handlePossibleIOSPrePauseHandoff\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find handlePossibleIOSPrePauseHandoff()\'s source body');
  const body = match[1];
  // F3 (two-reviewer gate hardening, v1.27.1 post-release): consume-once --
  // read THEN immediately clear the flag, rather than merely reading it (see
  // the dedicated F3 tests below for the full behavioral contract).
  assert.match(body, /var suppressed = suppressPauseHandoff;/);
  assert.match(body, /suppressPauseHandoff = false;/);
  assert.match(body, /if \(suppressed\) return;/);
  assert.match(body, /if \(document\.visibilityState !== 'hidden'\) return;/);
  assert.match(body, /if \(!currentData \|\| currentData\.type === 'audio'\) return;/, 'video-only feature, re-derived independently of handleBackgroundLifecycle');
  assert.match(body, /if \(inNativeFullscreen\(\)\) return;/, 'native presentation sustains its own background audio -- must never double-trigger');
  // F4 (two-reviewer gate, v1.27.1 post-release): the mobile check the
  // shared-gate contract assigns to each trigger, previously omitted here.
  assert.match(body, /if \(!isMobileFormFactor\(\)\) return;/, 'must re-derive the shared-gate contract\'s mobile precondition explicitly, like the primary "visibility" trigger');
  assert.match(body, /if \(bgAudioState !== BG_AUDIO_STATES\.INLINE_VIDEO\) return;/, 'already mid-handoff/backgrounded -- avoid a double-handoff');

  const readIdx = body.indexOf('var suppressed = suppressPauseHandoff;');
  const clearIdx = body.indexOf('suppressPauseHandoff = false;');
  const suppressedReturnIdx = body.indexOf('if (suppressed) return;');
  const visIdx = body.indexOf("if (document.visibilityState !== 'hidden') return;");
  const mobileIdx = body.indexOf('if (!isMobileFormFactor()) return;');
  const stateIdx = body.indexOf('if (bgAudioState !== BG_AUDIO_STATES.INLINE_VIDEO) return;');
  assert.ok(
    readIdx !== -1 && clearIdx !== -1 && suppressedReturnIdx !== -1 && visIdx !== -1 && mobileIdx !== -1 && stateIdx !== -1,
    'expected every guard to be present and locatable'
  );
  assert.ok(readIdx < clearIdx && clearIdx < suppressedReturnIdx, 'expected the flag to be read, THEN cleared, THEN acted on -- true consume-once semantics');
  assert.ok(suppressedReturnIdx < visIdx, 'expected the (consumed) suppress check before visibilityState');
  assert.ok(visIdx < mobileIdx && mobileIdx < stateIdx, 'expected the mobile check after visibility/video/native-presentation but before the state-machine check');
});

// ---- F3 (two-reviewer gate hardening, v1.27.1 post-release): consume-once -
// ---- suppress-flag semantics -----------------------------------------------
// pauseSuppressingHandoff's own DEFERRED setTimeout(fn, 0) reset and the
// media element's queued 'pause' task run on different task sources (timer
// vs. DOM manipulation) -- the HTML spec never guarantees which a user agent
// services first. handlePossibleIOSPrePauseHandoff must not depend on that
// unspecified ordering, so it now CONSUMES (reads then immediately clears)
// the flag itself the moment it runs; the setTimeout reset remains only as a
// backstop for a pause() call that never dispatches a 'pause' event at all
// (e.g. calling pause() on an already-paused element).

test('F3 (executable): consume-once semantics make the read authoritative regardless of which task (the queued pause event vs. the deferred setTimeout reset) the platform happens to run first', () => {
  // Exact reproduction of the fixed read/clear/act sequence, locked
  // structurally by the source-lock test above.
  function handlePossibleTrigger(state) {
    const suppressed = state.suppressPauseHandoff;
    state.suppressPauseHandoff = false;
    if (suppressed) return 'suppressed';
    return 'acted';
  }

  // Case A: the 'pause' event task runs BEFORE the setTimeout reset would
  // have fired (the intended/typical ordering) -- flag is still true.
  const stateA = { suppressPauseHandoff: true };
  assert.strictEqual(handlePossibleTrigger(stateA), 'suppressed');
  assert.strictEqual(stateA.suppressPauseHandoff, false, 'expected the flag to be consumed (cleared) by the handler itself');

  // Case B: even if a caller mistakenly invoked this AFTER something else
  // already cleared the flag (e.g. the setTimeout backstop had already
  // fired first -- the exact "unspecified ordering" scenario F3 hardens
  // against), the read is simply false and the trigger proceeds normally --
  // no crash, no double-consumption, no reliance on which task ran first.
  const stateB = { suppressPauseHandoff: false };
  assert.strictEqual(handlePossibleTrigger(stateB), 'acted');
  assert.strictEqual(stateB.suppressPauseHandoff, false);
});

test('F-D source-lock: handlePossibleIOSPrePauseHandoff() consults the SAME shared shouldHandOffToBackgroundAudio(...) gate the primary trigger uses, then calls attemptBackgroundAudioHandoff(\'pause-hidden\') -- never a duplicated/divergent eligibility check', () => {
  const match = /function handlePossibleIOSPrePauseHandoff\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  assert.match(body, /var eligible = shouldHandOffToBackgroundAudio\(\{\s*\n\s*settingOn: bgAudioSettingCached,\s*\n\s*audioStatus: bgAudioStatusKnown,\s*\n\s*bgAudioState: bgAudioState,\s*\n\s*\}\);/);
  assert.match(body, /if \(!eligible\) return;/);
  assert.match(body, /attemptBackgroundAudioHandoff\('pause-hidden'\);/);
  const eligibleIdx = body.indexOf('var eligible = shouldHandOffToBackgroundAudio(');
  const callIdx = body.indexOf("attemptBackgroundAudioHandoff('pause-hidden');");
  assert.ok(eligibleIdx !== -1 && callIdx !== -1 && eligibleIdx < callIdx);
});

test("F-D source-lock: wireHostListeners() wires handlePossibleIOSPrePauseHandoff on mediaPlayer's own 'pause' event, alongside (not replacing) the existing stopProgressSaver listener", () => {
  const wireMatch = /function wireHostListeners\(\) \{([\s\S]*?)\n {2}\}\n/.exec(PLAYER_JS);
  assert.ok(wireMatch, 'expected to find wireHostListeners()\'s source body');
  const body = wireMatch[1];
  assert.match(body, /mediaPlayer\.addEventListener\('pause', stopProgressSaver\);/);
  assert.match(body, /mediaPlayer\.addEventListener\('pause', handlePossibleIOSPrePauseHandoff\);/);
});

test('F-D: shouldHandOffToBackgroundAudio (the shared gate) is invocation-tested with a ctx that omits isPlaying entirely -- proving it is genuinely trigger-agnostic (works identically whether isPlaying was ever part of ctx or not)', () => {
  assert.equal(
    shouldHandOffToBackgroundAudio({ settingOn: true, audioStatus: 'ready', bgAudioState: BG_AUDIO_STATES.INLINE_VIDEO }),
    true,
    'no isPlaying field anywhere in ctx -- eligibility must not silently depend on one'
  );
});
