'use strict';

// [UNIT] Player-lifecycle round: PART A (force-quit background-audio fix)
// and PART B (gated on-screen lifecycle-event debug log), both in
// public/js/player.js.
//
// PART A: a hard kill (force-quit) leaves VIDEO in native-fullscreen/PiP, or
// a playing AUDIO track, still running -- `shouldPauseForLifecycleEvent`
// correctly exempts both from ORDINARY backgrounding (that's the whole point
// of FR-5's "smart" behavior, and must never regress -- see the second test
// block below), but nothing releases the OS media/audio session on a real,
// terminal unload. `shouldReleaseForLifecycleEvent` is the new pure helper
// that identifies that ONE signal (a `pagehide` with `event.persisted ===
// false`); it is covered directly below. `handleBackgroundLifecycle` and the
// debug recorder/overlay live inside player.js's DOM-only IIFE (guarded by
// `if (typeof window === 'undefined' ...) return;`) and this codebase has no
// jsdom/browser harness (see CONTRIBUTING.md) -- mirroring the existing
// precedent at test/unit/player-hardening.test.js, their contracts are
// locked directly against source text rather than by invocation. Dean's
// on-device iOS pass remains the documented arbiter for actual runtime
// behavior.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { shouldPauseForLifecycleEvent, shouldReleaseForLifecycleEvent } = require('../../public/js/player.js');

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

// ---- shouldReleaseForLifecycleEvent (pure) ---------------------------------

test('shouldReleaseForLifecycleEvent: a terminal pagehide (persisted: false) releases', () => {
  assert.strictEqual(shouldReleaseForLifecycleEvent('pagehide', { persisted: false }), true);
});

test('shouldReleaseForLifecycleEvent: a pagehide entering bfcache (persisted: true) never releases -- it may resume', () => {
  assert.strictEqual(shouldReleaseForLifecycleEvent('pagehide', { persisted: true }), false);
});

test('shouldReleaseForLifecycleEvent: visibilitychange-hidden never releases, even with persisted: false -- routine backgrounding, not an unload signal', () => {
  assert.strictEqual(shouldReleaseForLifecycleEvent('visibilitychangeHidden', { persisted: false }), false);
});

test('shouldReleaseForLifecycleEvent: freeze never releases, even with persisted: false', () => {
  assert.strictEqual(shouldReleaseForLifecycleEvent('freeze', { persisted: false }), false);
});

test('shouldReleaseForLifecycleEvent: an unrecognized event type never releases', () => {
  assert.strictEqual(shouldReleaseForLifecycleEvent('click', { persisted: false }), false);
  assert.strictEqual(shouldReleaseForLifecycleEvent(undefined, { persisted: false }), false);
});

test('shouldReleaseForLifecycleEvent: a missing/undefined ctx is a no-op (never throws)', () => {
  assert.strictEqual(shouldReleaseForLifecycleEvent('pagehide', undefined), false);
  assert.strictEqual(shouldReleaseForLifecycleEvent('pagehide', {}), false);
});

test('shouldReleaseForLifecycleEvent: a non-boolean/missing persisted field never releases (only a strict `false` counts, not merely falsy)', () => {
  assert.strictEqual(shouldReleaseForLifecycleEvent('pagehide', { persisted: undefined }), false);
  assert.strictEqual(shouldReleaseForLifecycleEvent('pagehide', { persisted: null }), false);
  assert.strictEqual(shouldReleaseForLifecycleEvent('pagehide', {}), false);
});

// ---- Regression lock: shouldPauseForLifecycleEvent is completely unchanged
// ---- (PART A must be strictly ADDITIVE, never alter a single pause verdict)

test('regression lock: a playing mobile video in native fullscreen/PiP is still never paused (background-audio-for-video path)', () => {
  assert.strictEqual(
    shouldPauseForLifecycleEvent('pagehide', { isAudio: false, isPlaying: true, isMobile: true, inNativePresentation: true }),
    false
  );
});

test('regression lock: a playing inline mobile video is still paused+persisted', () => {
  assert.strictEqual(
    shouldPauseForLifecycleEvent('pagehide', { isAudio: false, isPlaying: true, isMobile: true, inNativePresentation: false }),
    true
  );
});

test('regression lock: a playing audio track is still exempt (kept running) on every hooked event', () => {
  for (const eventType of ['pagehide', 'freeze', 'visibilitychangeHidden']) {
    assert.strictEqual(shouldPauseForLifecycleEvent(eventType, { isAudio: true, isPlaying: true, isMobile: true }), false);
  }
});

test('regression lock: a playing desktop video still keeps playing across tab switches (AC56)', () => {
  assert.strictEqual(shouldPauseForLifecycleEvent('pagehide', { isAudio: false, isPlaying: true, isMobile: false }), false);
});

// ---- Source-contract: handleBackgroundLifecycle (PART A wiring) -----------

const handleBackgroundLifecycleMatch = /function handleBackgroundLifecycle\(eventType, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);

test('handleBackgroundLifecycle() now accepts a second `extraCtx` parameter (threads `persisted` through)', () => {
  assert.ok(handleBackgroundLifecycleMatch, 'expected to find handleBackgroundLifecycle(eventType, extraCtx)\'s source body in player.js');
});

test('handleBackgroundLifecycle(): the release verdict is computed via shouldReleaseForLifecycleEvent(eventType, ctx)', () => {
  const body = handleBackgroundLifecycleMatch[1];
  assert.match(body, /var shouldRelease = shouldReleaseForLifecycleEvent\(eventType, ctx\);/, 'expected the release branch to be gated on shouldReleaseForLifecycleEvent');
});

test('handleBackgroundLifecycle(): ctx.persisted is threaded from extraCtx (not hardcoded)', () => {
  const body = handleBackgroundLifecycleMatch[1];
  assert.match(body, /persisted:\s*!!\(extraCtx && extraCtx\.persisted\)/, 'expected ctx.persisted to be derived from the extraCtx parameter');
});

test('handleBackgroundLifecycle(): every release call site is gated behind `if (shouldRelease)`, never unconditional', () => {
  const body = handleBackgroundLifecycleMatch[1];
  const releaseCalls = body.match(/releaseAudioSession\(\);/g) || [];
  // v1.27.0 (background-audio-for-video, EXPERIMENTAL) added a 4th site: the
  // `attemptBackgroundAudioHandoff()` success branch, nested INSIDE the
  // existing pause branch -- a terminal pagehide must still release even
  // mid-handoff (stops BOTH elements -- see releaseAudioSession's own
  // comment), so this is intentionally additive to the pre-existing 3.
  assert.strictEqual(releaseCalls.length, 4, 'expected exactly 4 releaseAudioSession() call sites: the background-audio-handoff branch, the pause branch, the native-presentation-checkpoint branch, and the exempt-tail branch');
  // Three of the four sites use the single-line `if (shouldRelease)
  // releaseAudioSession();` form (the new handoff branch, plus the
  // pre-existing pause and native-presentation branches); the fourth uses
  // the block `if (shouldRelease) { ... releaseAudioSession(); }` form (the
  // exempt tail branch). Together that accounts for all 4 -- i.e. none is a
  // bare, unconditional call.
  const singleLineGuarded = body.match(/if \(shouldRelease\) releaseAudioSession\(\);/g) || [];
  assert.strictEqual(singleLineGuarded.length, 3, 'expected 3 single-line-guarded release calls');
  const blockGuarded = /if \(shouldRelease\) \{\s*\n\s*checkpointProgress\(\);\s*\n\s*releaseAudioSession\(\);\s*\n\s*\}/.exec(body);
  assert.ok(blockGuarded, 'expected 1 block-guarded release call (checkpoint then release)');
});

test('handleBackgroundLifecycle(): the pause-verdict branch still saves progress BEFORE any release, on the plain (non-handoff) fallback path (order preserved)', () => {
  const body = handleBackgroundLifecycleMatch[1];
  const pauseBranch = /if \(shouldPauseForLifecycleEvent\(eventType, ctx\)\) \{([\s\S]*?)\n {4}\}/.exec(body);
  assert.ok(pauseBranch, 'expected the existing shouldPauseForLifecycleEvent branch to still exist');
  // v1.27.0 added a nested `if (attemptBackgroundAudioHandoff('visibility'))
  // { ... }` branch (with its own, earlier releaseAudioSession() call)
  // INSIDE this pause branch -- scope this check to the text AFTER that
  // nested block's closing brace, i.e. the original, unchanged plain-pause
  // fallback (the `pauseSuppressingHandoff(mediaPlayer);
  // saveProgressToServer(...); if (shouldRelease) releaseAudioSession();`
  // sequence -- F-D, v1.27.1, routed the bare `mediaPlayer.pause()` through
  // `pauseSuppressingHandoff` so this lifecycle-driven pause never
  // re-triggers the second, pause-hidden handoff trigger), so this remains a
  // precise regression lock on THAT specific sequence rather than an
  // ambiguous indexOf over text that now contains two releaseAudioSession()
  // calls.
  const fallbackSequence = /pauseSuppressingHandoff\(mediaPlayer\);[^\n]*\n\s*(saveProgressToServer\(currentAbsTime\(\), \{ keepalive: true \}\);)[\s\S]*?(releaseAudioSession\(\);)/.exec(pauseBranch[1]);
  assert.ok(fallbackSequence, 'expected the plain-pause fallback sequence (pause -> save -> conditional release) to still exist, unchanged');
  assert.ok(fallbackSequence.index !== -1, 'expected the fallback sequence to be found');
});

test("handleBackgroundLifecycle(): v1.27.0 background-audio handoff is attempted FIRST (passing the 'visibility' trigger label), inside the pause branch, before the plain pause+save fallback", () => {
  const body = handleBackgroundLifecycleMatch[1];
  const pauseBranch = /if \(shouldPauseForLifecycleEvent\(eventType, ctx\)\) \{([\s\S]*?)\n {4}\}/.exec(body);
  assert.ok(pauseBranch, 'expected the existing shouldPauseForLifecycleEvent branch to still exist');
  const handoffIdx = pauseBranch[1].indexOf("if (attemptBackgroundAudioHandoff('visibility')) {");
  const fallbackPauseIdx = pauseBranch[1].indexOf('pauseSuppressingHandoff(mediaPlayer);');
  assert.ok(handoffIdx !== -1, 'expected the handoff attempt to be wired inside the pause branch');
  assert.ok(fallbackPauseIdx !== -1, 'expected the plain pause fallback to still exist');
  assert.ok(handoffIdx < fallbackPauseIdx, 'the handoff attempt must run BEFORE the plain pause fallback (it returns early on success)');
});

test('handleBackgroundLifecycle(): the exempt-from-both-branches tail (audio / not-currently-playing) still checkpoints before releasing', () => {
  const body = handleBackgroundLifecycleMatch[1];
  const tailBranch = /if \(shouldRelease\) \{([\s\S]*?)\n {4}\}\s*$/.exec(body);
  assert.ok(tailBranch, 'expected a final `if (shouldRelease) { ... }` tail branch');
  const checkpointIdx = tailBranch[1].indexOf('checkpointProgress();');
  const releaseIdx = tailBranch[1].indexOf('releaseAudioSession();');
  assert.ok(checkpointIdx !== -1 && releaseIdx !== -1 && checkpointIdx < releaseIdx, 'expected checkpointProgress() to run before releaseAudioSession() in the tail branch');
});

// FIX B regression lock (player-hardening round): confirm this round did NOT
// disturb the exact invariant test/unit/player-hardening.test.js locks --
// still exactly 2 literal saveProgressToServer(...) call sites inside
// handleBackgroundLifecycle itself (the new PART A save runs through the
// separate checkpointProgress() wrapper instead, defined outside this
// function -- see the source-contract test below).
test('handleBackgroundLifecycle(): still exactly 2 literal saveProgressToServer() call sites (PART A reuses checkpointProgress(), not a 3rd inline call)', () => {
  const body = handleBackgroundLifecycleMatch[1];
  const saveCalls = body.match(/saveProgressToServer\(/g) || [];
  assert.strictEqual(saveCalls.length, 2, 'expected PART A to route its new save through checkpointProgress() rather than adding a 3rd literal saveProgressToServer(...) call inside handleBackgroundLifecycle');
});

// ---- Source-contract: releaseAudioSession / checkpointProgress ------------

test('releaseAudioSession() exists and performs the LIGHT release (pause + clear Media Session metadata + setPlaybackState(\'none\'))', () => {
  const match = /function releaseAudioSession\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find releaseAudioSession()\'s source body in player.js');
  const body = match[1];
  // F-D (v1.27.1): routed through pauseSuppressingHandoff() rather than a
  // bare mediaPlayer.pause() -- see that helper's own source-lock tests.
  assert.match(body, /pauseSuppressingHandoff\(mediaPlayer\);/);
  assert.match(body, /navigator\.mediaSession\.metadata = null;/);
  assert.match(body, /setPlaybackState\('none'\);/);
});

test('releaseAudioSession() does NOT perform the heavier CLOSED-path teardown (no removeAttribute(\'src\')/load())', () => {
  const match = /function releaseAudioSession\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match);
  const body = match[1];
  assert.ok(!/removeAttribute\('src'\)/.test(body), 'the light release deliberately does not clear the <video> src -- the page is unloading anyway');
  assert.ok(!/mediaPlayer\.load\(\)/.test(body), 'the light release deliberately does not call load()');
});

test('checkpointProgress() exists and wraps the same keepalive save shape used elsewhere', () => {
  const match = /function checkpointProgress\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find checkpointProgress()\'s source body in player.js');
  assert.match(match[1], /saveProgressToServer\(currentAbsTime\(\), \{ keepalive: true \}\);/);
});

// ---- Source-contract: the pagehide listener threads event.persisted -------

test('the pagehide listener threads event.persisted into both the recorder and handleBackgroundLifecycle', () => {
  const match = /window\.addEventListener\('pagehide', function \(e\) \{([\s\S]*?)\n {2}\}\);/.exec(PLAYER_JS);
  assert.ok(match, 'expected a pagehide listener taking the event parameter `e`');
  const body = match[1];
  assert.match(body, /persisted:\s*!!\(e && e\.persisted\)/, 'expected the listener to read event.persisted');
  assert.match(body, /recordLifecycleEvent\('pagehide', extraCtx\);/);
  assert.match(body, /handleBackgroundLifecycle\('pagehide', extraCtx\);/);
});

test('the freeze and visibilitychange-hidden listeners are unchanged in intent -- still call handleBackgroundLifecycle with no persisted ctx', () => {
  assert.match(PLAYER_JS, /document\.addEventListener\('freeze', function \(\) \{[\s\S]*?handleBackgroundLifecycle\('freeze'\);[\s\S]*?\}\);/);
  assert.match(PLAYER_JS, /if \(document\.visibilityState === 'hidden'\) handleBackgroundLifecycle\('visibilitychangeHidden'\);/);
});

// ---- Source-contract: PART B debug recorder + overlay are flag-gated ------

test('isDebugLifecycleEnabled() reads a single, dedicated localStorage flag', () => {
  const match = /function isDebugLifecycleEnabled\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find isDebugLifecycleEnabled()\'s source body');
  assert.match(match[1], /localStorage\.getItem\(DEBUG_LIFECYCLE_STORAGE_KEY\) === '1'/);
});

test('recordLifecycleEvent() is a no-op (returns immediately) unless the debug flag is on', () => {
  const match = /function recordLifecycleEvent\(type, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find recordLifecycleEvent()\'s source body');
  assert.match(match[1].trim(), /^if \(!isDebugLifecycleEnabled\(\)\) return;/, 'expected the very first statement to bail out when the flag is off');
});

test('recordLifecycleEvent() caps the ring buffer at 30 entries (bumped from 20 in v1.27.1 for the extra bgAudio:* diagnostic events)', () => {
  const match = /function recordLifecycleEvent\(type, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.match(match[1], /LIFECYCLE_LOG_CAP/);
  assert.match(PLAYER_JS, /var LIFECYCLE_LOG_CAP = 30;/);
});

test('recordLifecycleEvent() wraps localStorage access in try/catch (never throws)', () => {
  const match = /function recordLifecycleEvent\(type, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.match(match[1], /try \{[\s\S]*localStorage\.setItem\(LIFECYCLE_LOG_STORAGE_KEY[\s\S]*\} catch \(_\)/);
});

// ---- F2 (two-reviewer gate, v1.27.1 post-release): corrupt-log self-heal --
// A corrupt (non-JSON) localStorage['ft-lifecycle-log'] value used to throw
// INSIDE the single outer try in recordLifecycleEvent, skipping
// localStorage.setItem entirely and leaving recording PERMANENTLY dead for
// the rest of the session -- every future call hit the exact same throw on
// the exact same corrupt value -- even though the overlay kept rendering
// "(no lifecycle events recorded yet)" as if nothing were ever wrong.

test('F2 source-lock: recordLifecycleEvent() wraps JSON.parse in its OWN inner try/catch (self-heals to an empty array), separate from the outer try/catch that wraps localStorage.setItem', () => {
  const match = /function recordLifecycleEvent\(type, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find recordLifecycleEvent()\'s source body');
  const body = match[1];
  assert.match(
    body,
    /try \{\s*\n\s*log = raw \? JSON\.parse\(raw\) : \[\];\s*\n\s*\} catch \(_\) \{\s*\n\s*log = \[\];\s*\n\s*\}/,
    'expected a dedicated inner try/catch around JSON.parse that resets log to [] on failure'
  );
  // The inner catch must be textually BEFORE localStorage.setItem, so a
  // corrupt value is healed on the SAME call that observed it, not merely
  // on some later call.
  const innerCatchIdx = body.search(/catch \(_\) \{\s*\n\s*log = \[\];\s*\n\s*\}/);
  const setItemIdx = body.indexOf('localStorage.setItem(LIFECYCLE_LOG_STORAGE_KEY');
  assert.ok(innerCatchIdx !== -1 && setItemIdx !== -1 && innerCatchIdx < setItemIdx, 'expected the parse self-heal to happen before the write, on the same call');
});

test('F2 (executable): a corrupt raw value self-heals on the VERY NEXT record call -- recording is never permanently bricked', () => {
  // No jsdom/browser harness in this repo (see file banner) -- reproduces
  // recordLifecycleEvent()'s exact fixed parse contract (inner try/catch
  // around JSON.parse only, locked structurally by the source-lock test
  // just above) against a minimal fake localStorage, demonstrating the
  // actual self-heal behavior rather than merely asserting the shape of
  // the fix -- mirrors the "executable proof" pattern used for FIX A in
  // test/unit/player-hardening.test.js.
  function fakeLocalStorage(initialRaw) {
    var store = { 'ft-lifecycle-log': initialRaw };
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = v; },
    };
  }
  // Exact reproduction of recordLifecycleEvent()'s fixed read-parse-append-write sequence.
  function readAndAppend(localStorage, entry) {
    var raw = localStorage.getItem('ft-lifecycle-log');
    var log;
    try {
      log = raw ? JSON.parse(raw) : [];
    } catch (_) {
      log = [];
    }
    if (!Array.isArray(log)) log = [];
    log.push(entry);
    localStorage.setItem('ft-lifecycle-log', JSON.stringify(log));
    return log;
  }

  const ls = fakeLocalStorage('{not valid json!!'); // simulates a corrupt prior write
  assert.doesNotThrow(
    () => readAndAppend(ls, { type: 'first-after-corruption' }),
    'a corrupt stored value must never throw out of the record call'
  );
  const afterFirst = JSON.parse(ls.getItem('ft-lifecycle-log'));
  assert.deepStrictEqual(
    afterFirst,
    [{ type: 'first-after-corruption' }],
    'the corrupt value must be overwritten with a fresh, valid log on the very call that observed it'
  );

  // A second call now reads back genuinely valid JSON -- proves the heal
  // was a real, persisted fix, not a one-off fluke tied to the corrupt-value branch.
  readAndAppend(ls, { type: 'second-after-heal' });
  const afterSecond = JSON.parse(ls.getItem('ft-lifecycle-log'));
  assert.deepStrictEqual(afterSecond, [{ type: 'first-after-corruption' }, { type: 'second-after-heal' }]);
});

test('renderLifecycleOverlay() is a no-op unless the debug flag is on, and never creates the overlay element otherwise', () => {
  const match = /function renderLifecycleOverlay\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find renderLifecycleOverlay()\'s source body');
  assert.match(match[1].trim(), /^if \(!isDebugLifecycleEnabled\(\)\) return;/, 'expected the very first statement to bail out when the flag is off, before touching the DOM');
});

test('ensureLifecycleOverlayEl() builds the overlay element in JS (no shell HTML edited) with a fixed, high z-index, semi-transparent, monospace style', () => {
  const match = /function ensureLifecycleOverlayEl\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find ensureLifecycleOverlayEl()\'s source body');
  const body = match[1];
  assert.match(body, /document\.createElement\('div'\)/);
  assert.match(body, /'position:fixed'/);
  assert.match(body, /'z-index:999999'/);
  assert.match(body, /'font:11px\/1\.4 monospace'/);
  assert.match(body, /document\.body\.appendChild\(el\);/);
});

test('the overlay is tap-to-clear (a click listener removes the stored log and re-renders)', () => {
  const match = /function ensureLifecycleOverlayEl\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  const body = match[1];
  assert.match(body, /el\.addEventListener\('click', function \(\) \{/);
  assert.match(body, /localStorage\.removeItem\(LIFECYCLE_LOG_STORAGE_KEY\);/);
  assert.match(body, /renderLifecycleOverlay\(\);/);
});

test('initDebugLifecycleFlag() sets the flag on ?debugLifecycle=1 and clears it on ?debugLifecycle=0', () => {
  const match = /function initDebugLifecycleFlag\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find initDebugLifecycleFlag()\'s source body');
  const body = match[1];
  assert.match(body, /localStorage\.setItem\(DEBUG_LIFECYCLE_STORAGE_KEY, '1'\)/);
  assert.match(body, /localStorage\.removeItem\(DEBUG_LIFECYCLE_STORAGE_KEY\)/);
});

// ---- v1.27.1: optional `detail` field on lifecycle-log entries ------------
// Added so the background-audio diagnostics (test/unit/player-background-
// audio.test.js) can attach a short, human-readable reason/summary string
// to a recorded event, rendered on the overlay right after the type. Every
// PRE-EXISTING caller omits `extraCtx.detail` entirely, so this must be a
// strictly additive, backward-compatible field (recorded as `null` when
// absent), never a required one.

test('recordLifecycleEvent() records an optional `detail` string from extraCtx.detail, defaulting to null when absent (backward-compatible with every pre-existing caller)', () => {
  const match = /function recordLifecycleEvent\(type, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find recordLifecycleEvent()\'s source body');
  const body = match[1];
  assert.match(body, /detail: extraCtx && 'detail' in extraCtx \? extraCtx\.detail : null,/);
});

test('renderLifecycleOverlay() renders `detail` right after the type, truncated to 60 chars, and omits it entirely when absent', () => {
  const match = /function renderLifecycleOverlay\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(match, 'expected to find renderLifecycleOverlay()\'s source body');
  const body = match[1];
  assert.match(body, /var detailStr = entry && entry\.detail \? ' \(' \+ String\(entry\.detail\)\.slice\(0, 60\) \+ '\)' : '';/);
  const lineTemplateIdx = body.indexOf("(entry.type || '?') + detailStr + ' · persisted='");
  assert.ok(lineTemplateIdx !== -1, 'expected detailStr to be concatenated directly after the type');
});

test('the pre-existing non-bgAudio listeners (pagehide/freeze/visibilitychange/resume/pageshow) never pass a `detail` -- they still record `detail: null`, confirming the field is additive-only', () => {
  assert.match(PLAYER_JS, /recordLifecycleEvent\('pagehide', extraCtx\);/);
  assert.match(PLAYER_JS, /recordLifecycleEvent\('freeze', \{\}\);/);
  assert.match(PLAYER_JS, /recordLifecycleEvent\('visibilitychange', \{\}\);/);
  assert.match(PLAYER_JS, /recordLifecycleEvent\('resume', \{\}\);/);
  assert.match(PLAYER_JS, /recordLifecycleEvent\('pageshow', \{\}\);/);
});

test('recordLifecycleEvent() is STILL a complete no-op (zero recording, zero DOM) unless the debug flag is on -- the v1.27.1 bgAudio:* additions did not weaken this gate', () => {
  const match = /function recordLifecycleEvent\(type, extraCtx\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.match(match[1].trim(), /^if \(!isDebugLifecycleEnabled\(\)\) return;/, 'expected the very first statement to still bail out when the flag is off, even with the extra bgAudio call sites added elsewhere in the file');
});

test('pageshow and resume listeners only record -- they never call handleBackgroundLifecycle (no behavior change, PART B is pure observation)', () => {
  const pageshowLineMatch = /window\.addEventListener\('pageshow', function \(\) \{ ([\s\S]*?) \}\);/.exec(PLAYER_JS);
  const resumeLineMatch = /document\.addEventListener\('resume', function \(\) \{ ([\s\S]*?) \}\);/.exec(PLAYER_JS);
  assert.ok(pageshowLineMatch, 'expected a pageshow listener');
  assert.ok(resumeLineMatch, 'expected a resume listener');
  assert.match(pageshowLineMatch[1], /recordLifecycleEvent\('pageshow', \{\}\);/);
  assert.ok(!/handleBackgroundLifecycle/.test(pageshowLineMatch[1]), 'pageshow must never drive a pause/release decision');
  assert.match(resumeLineMatch[1], /recordLifecycleEvent\('resume', \{\}\);/);
  assert.ok(!/handleBackgroundLifecycle/.test(resumeLineMatch[1]), 'resume must never drive a pause/release decision');
});
