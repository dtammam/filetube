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

test('mutual exclusion (source-lock): attemptBackgroundAudioHandoff is called ONLY inside the shouldPauseForLifecycleEvent(...) truthy branch of handleBackgroundLifecycle', () => {
  const fnMatch = /function handleBackgroundLifecycle\(eventType, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(fnMatch, 'expected to find handleBackgroundLifecycle\'s source body');
  const body = fnMatch[1];
  const callSites = body.match(/attemptBackgroundAudioHandoff\(\)/g) || [];
  assert.strictEqual(callSites.length, 1, 'expected exactly one call site for attemptBackgroundAudioHandoff()');
  const pauseBranch = /if \(shouldPauseForLifecycleEvent\(eventType, ctx\)\) \{([\s\S]*?)\n {4}\}/.exec(body);
  assert.ok(pauseBranch, 'expected the shouldPauseForLifecycleEvent branch to exist');
  assert.match(pauseBranch[1], /attemptBackgroundAudioHandoff\(\)/, 'the ONE call site must be inside this branch (never in the inNativePresentation branch, which is reached separately/later)');
});

// ---- Source-lock: force-close teardown releases BOTH elements ------------

test('releaseAudioSession() stops+releases BOTH mediaPlayer AND bgAudioEl (the exact leak the v1.25.10 force-close fix exists to kill)', () => {
  const match = /function releaseAudioSession\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find releaseAudioSession()\'s source body');
  const body = match[1];
  assert.match(body, /mediaPlayer\.pause\(\);/);
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
  assert.ok(!/fetch\('\/api\/settings'\)/.test(PLAYER_JS.match(/function attemptBackgroundAudioHandoff\(\) \{([\s\S]*?)\n {2}\}/)[1]), 'the handoff attempt itself must never fetch settings fresh');
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
  assert.match(
    body,
    /if \(body\) bgAudioStatusKnown = body\.audioStatus \|\| null;/,
    'expected the prepare-audio response to always overwrite bgAudioStatusKnown whenever a response body was actually received, even when the field itself is absent'
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

test('F3 source-lock: primeBackgroundAudioElement() no longer gates on bgAudioSettingCached (fires on the FIRST gesture regardless)', () => {
  const match = /function primeBackgroundAudioElement\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find primeBackgroundAudioElement()\'s source body');
  const body = match[1];
  assert.ok(!/bgAudioSettingCached/.test(body), 'the settings-fetch race must never be able to skip priming for the whole session');
  assert.match(body, /if \(bgAudioGesturePrimed \|\| !bgAudioEl\) return;/);
});

test('F3 source-lock: the prime\'s success continuation never pauses bgAudioEl once a real handoff has taken over (bgAudioState !== INLINE_VIDEO)', () => {
  const match = /function primeBackgroundAudioElement\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  const thenBranch = /p\.then\(function \(\) \{([\s\S]*?)\n {8}\}, function \(\) \{/.exec(body);
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

  const handoffMatch = /function attemptBackgroundAudioHandoff\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
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
