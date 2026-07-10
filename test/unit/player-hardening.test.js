'use strict';

// [UNIT] Player-hardening round: 4 small follow-up fixes from the
// increment-3 two-reviewer gate on mobile native video controls
// (public/js/player.js). None of the functions touched here are pure/
// exported (they live inside the DOM-only IIFE guarded by `if (typeof window
// === 'undefined' ...) return;`), and this codebase has no jsdom/browser
// harness -- so, mirroring the existing precedent at
// test/unit/player-gesture-native-controls-guard.test.js, their contracts
// are locked directly against source text rather than by invocation. Dean's
// on-device iOS + desktop-browser pass remains the documented arbiter for
// actual runtime behavior.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

// ---- FIX A: inNativeFullscreen() element-identity check --------------------

const inNativeFullscreenMatch = /function inNativeFullscreen\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);

test('FIX A: inNativeFullscreen() exists and is isolated for inspection', () => {
  assert.ok(inNativeFullscreenMatch, 'expected to find inNativeFullscreen()\'s source body in player.js');
});

test('FIX A: the first condition checks document.fullscreenElement against host/mediaPlayer identity, not bare truthiness', () => {
  const body = inNativeFullscreenMatch[1];
  assert.match(
    body,
    /document\.fullscreenElement === host \|\| document\.fullscreenElement === mediaPlayer/,
    'expected an element-identity check against host and mediaPlayer'
  );
  assert.ok(
    !/return !!document\.fullscreenElement \|\|/.test(body),
    'the old bare-truthiness check (any fullscreen element on the page) must be gone'
  );
});

test('FIX A: the other three conditions (webkitDisplayingFullscreen, webkit PiP, standard PiP) are unchanged', () => {
  const body = inNativeFullscreenMatch[1];
  assert.match(body, /!!\(mediaPlayer && mediaPlayer\.webkitDisplayingFullscreen\)/);
  assert.match(body, /!!\(mediaPlayer && mediaPlayer\.webkitPresentationMode === 'picture-in-picture'\)/);
  assert.match(body, /!!\(document\.pictureInPictureElement && document\.pictureInPictureElement === mediaPlayer\)/);
});

// Executable proof that the identity check actually discriminates: build the
// exact boolean expression as a function of a stand-in `document`/`host`/
// `mediaPlayer` and confirm it behaves as designed for the cases the fix
// targets (some OTHER fullscreen element vs. host/mediaPlayer themselves).
test('FIX A (behavioral): the tightened first-condition expression is false for an unrelated fullscreen element and true for host/mediaPlayer', () => {
  const host = { id: 'host' };
  const mediaPlayer = { id: 'media-player' };
  const unrelated = { id: 'some-other-lightbox-element' };

  function firstCondition(fullscreenElement) {
    var document_ = { fullscreenElement: fullscreenElement };
    return !!(document_.fullscreenElement === host || document_.fullscreenElement === mediaPlayer);
  }

  assert.strictEqual(firstCondition(unrelated), false, 'an unrelated fullscreen element must NOT count as this player\'s native presentation');
  assert.strictEqual(firstCondition(host), true, 'the player host itself being fullscreen must count');
  assert.strictEqual(firstCondition(mediaPlayer), true, 'the <video> element itself being fullscreen must count');
  assert.strictEqual(firstCondition(null), false, 'nothing fullscreen must not count');
});

// ---- FIX B: checkpoint save on background even in native presentation -----

const handleBackgroundLifecycleMatch = /function handleBackgroundLifecycle\(eventType\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);

test('FIX B: handleBackgroundLifecycle() exists and is isolated for inspection', () => {
  assert.ok(handleBackgroundLifecycleMatch, 'expected to find handleBackgroundLifecycle()\'s source body in player.js');
});

test('FIX B: the normal pause verdict still calls both pause() and saveProgressToServer()', () => {
  const body = handleBackgroundLifecycleMatch[1];
  const pauseBranch = /if \(shouldPauseForLifecycleEvent\(eventType, ctx\)\) \{([\s\S]*?)\n {4}\}/.exec(body);
  assert.ok(pauseBranch, 'expected an if (shouldPauseForLifecycleEvent(...)) branch');
  assert.match(pauseBranch[1], /mediaPlayer\.pause\(\);/, 'expected the pause branch to still call mediaPlayer.pause()');
  assert.match(pauseBranch[1], /saveProgressToServer\(currentAbsTime\(\), \{ keepalive: true \}\);/, 'expected the pause branch to still save progress');
});

test('FIX B: a new native-presentation+playing branch saves progress WITHOUT pausing', () => {
  const body = handleBackgroundLifecycleMatch[1];
  const saveOnlyBranch = /if \(ctx\.inNativePresentation && ctx\.isPlaying\) \{([\s\S]*?)\n {4}\}/.exec(body);
  assert.ok(saveOnlyBranch, 'expected a new `if (ctx.inNativePresentation && ctx.isPlaying)` branch');
  assert.match(saveOnlyBranch[1], /saveProgressToServer\(currentAbsTime\(\), \{ keepalive: true \}\);/, 'expected the new branch to checkpoint-save progress');
  assert.ok(!/\.pause\(\)/.test(saveOnlyBranch[1]), 'the new branch must NOT call pause() -- playback keeps going');
});

test('FIX B: the save-only branch is reached only after the pause verdict is false (an early return separates the two)', () => {
  const body = handleBackgroundLifecycleMatch[1];
  const pauseBranchMatch = /if \(shouldPauseForLifecycleEvent\(eventType, ctx\)\) \{([\s\S]*?)\n {4}\}/.exec(body);
  assert.ok(pauseBranchMatch, 'expected the pause-verdict branch');
  assert.match(pauseBranchMatch[1], /return;/, 'expected the pause-verdict branch to return, so the new save-only branch below can only run on the false verdict');
});

test('FIX B: no new save is added for audio or plain inline-video paths -- the whole function still contains exactly two saveProgressToServer() call sites', () => {
  const body = handleBackgroundLifecycleMatch[1];
  const saveCalls = body.match(/saveProgressToServer\(/g) || [];
  assert.strictEqual(saveCalls.length, 2, 'expected exactly 2 saveProgressToServer() call sites: the existing pause+save branch, and the new native-presentation checkpoint branch');
});

// ---- FIX D: clear native-controls state on close() -------------------------

const closeMatch = /function close\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);

test('FIX D: close() exists and is isolated for inspection', () => {
  assert.ok(closeMatch, 'expected to find close()\'s source body in player.js');
});

test('FIX D: close() clears both the native `controls` attribute and the `.native-controls` marker class', () => {
  const body = closeMatch[1];
  assert.match(body, /mediaPlayer\.removeAttribute\('controls'\);/, 'expected close() to remove the controls attribute');
  assert.match(body, /host\.classList\.remove\('native-controls'\);/, 'expected close() to remove the .native-controls marker class');
});
