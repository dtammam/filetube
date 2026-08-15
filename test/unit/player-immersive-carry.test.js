'use strict';

// [UNIT] v1.130 immersive carry-on-advance (Dean, 2026-08-15): a playback
// CONTINUATION (autoplay 'ended', queue advance, manual track Next/Prev,
// lock-screen/media-key next, Shift+N/P) keeps the immersive overlay - faux
// CSS video fullscreen (.css-fullscreen) or the expanded audio now-playing
// view (.audio-expanded) - across the load boundary, instead of the teardown's
// v1.34.2 "never leak the fixed overlay across loads" drop dumping him onto
// the raw landscape page. Keyed on the immersive STATE at advance time, never
// orientation (ruling 3); cross-kind advances land on the NEW item's own
// surface (ruling 2). Spec: docs/exec-plans/active/immersive-carry-on-advance.md.
//
// Testing posture mirrors test/unit/player-audio-expand.test.js: the two PURE
// decision helpers are exercised directly; the impure wiring (arm sites, the
// teardown gate, load()'s capture/reconcile sequence) is locked against the
// public/js/player.js source text - this codebase has no jsdom/browser player
// harness, and Dean's on-device pass is the documented arbiter of feel.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { captureImmersiveCarryForLoad, resolveImmersiveCarryTarget } = require('../../public/js/player.js');

// ---- captureImmersiveCarryForLoad (pure) -----------------------------------

test('captureImmersiveCarryForLoad: an armed carry with a LIVE immersive class captures that kind', () => {
  assert.deepStrictEqual(captureImmersiveCarryForLoad(true, 'video'), { value: 'video', nextPending: false });
  assert.deepStrictEqual(captureImmersiveCarryForLoad(true, 'audio'), { value: 'audio', nextPending: false });
});

test('captureImmersiveCarryForLoad: a STALE arm (no live immersive class at load start) is inert', () => {
  // The leak scenario this guard exists for: an edge tap whose handler
  // no-op'd left the arm set, the user then manually EXITED fullscreen and
  // browsed to a fresh pick - that load must not re-enter fullscreen.
  assert.strictEqual(captureImmersiveCarryForLoad(true, null).value, null);
  assert.strictEqual(captureImmersiveCarryForLoad(true, undefined).value, null);
  assert.strictEqual(captureImmersiveCarryForLoad(true, 'native').value, null); // desktop native fs is classless + out of scope
});

test('captureImmersiveCarryForLoad: an UN-ARMED load never carries, even with a live immersive class (the v1.34.2 belt)', () => {
  // A leaked .css-fullscreen/.audio-expanded class on a non-continuation
  // load must still be dropped by the teardown - carry is opt-in per seam.
  assert.strictEqual(captureImmersiveCarryForLoad(false, 'video').value, null);
  assert.strictEqual(captureImmersiveCarryForLoad(false, 'audio').value, null);
  assert.strictEqual(captureImmersiveCarryForLoad(undefined, 'video').value, null);
});

test('captureImmersiveCarryForLoad: nextPending is ALWAYS false - the arm is one-shot, cleared at every load start', () => {
  // Same leak-proof shape as captureAutoplayAdvanceForLoad: whatever the
  // inputs, the module-level arm is reset the instant a new load begins.
  assert.strictEqual(captureImmersiveCarryForLoad(true, 'video').nextPending, false);
  assert.strictEqual(captureImmersiveCarryForLoad(true, null).nextPending, false);
  assert.strictEqual(captureImmersiveCarryForLoad(false, 'audio').nextPending, false);
  assert.strictEqual(captureImmersiveCarryForLoad(false, null).nextPending, false);
});

// ---- resolveImmersiveCarryTarget (pure) ------------------------------------

test('resolveImmersiveCarryTarget: video->video keeps faux fullscreen', () => {
  assert.strictEqual(resolveImmersiveCarryTarget('video', 'video'), 'video-fs');
});

test('resolveImmersiveCarryTarget: cross-kind advances land on the NEW item\'s own surface (ruling 2)', () => {
  assert.strictEqual(resolveImmersiveCarryTarget('video', 'audio'), 'audio-expanded');
  assert.strictEqual(resolveImmersiveCarryTarget('audio', 'video'), 'video-fs');
});

test('resolveImmersiveCarryTarget: audio->audio keeps the expanded now-playing view', () => {
  assert.strictEqual(resolveImmersiveCarryTarget('audio', 'audio'), 'audio-expanded');
});

test('resolveImmersiveCarryTarget: a non-audio destination type defaults to the video surface (video items carry no explicit type branch here)', () => {
  assert.strictEqual(resolveImmersiveCarryTarget('video', undefined), 'video-fs');
  assert.strictEqual(resolveImmersiveCarryTarget('audio', 'book'), 'video-fs');
});

test('resolveImmersiveCarryTarget: no carried kind -> no reconcile at all (the common case is a byte-identical no-op)', () => {
  assert.strictEqual(resolveImmersiveCarryTarget(null, 'video'), null);
  assert.strictEqual(resolveImmersiveCarryTarget(undefined, 'audio'), null);
  assert.strictEqual(resolveImmersiveCarryTarget(false, 'video'), null);
  assert.strictEqual(resolveImmersiveCarryTarget('native', 'video'), null); // classless desktop native fs never carries
});

// ---- source-level regression locks (no DOM harness - see module comment) ---

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

test('load() captures the carry (arm + live kind) BEFORE teardown and hands the snapshot to teardownMediaState', () => {
  // The capture must read BOTH the one-shot arm and the live class, clear
  // the arm, apply the dock guard (a dock destination never carries), and
  // the teardown call must receive exactly this load's snapshot.
  assert.match(PLAYER_JS, /var capturedImmersiveCarry = captureImmersiveCarryForLoad\(immersiveCarryPending, currentImmersiveKind\(\)\);/);
  assert.match(PLAYER_JS, /loadImmersiveCarry = options\.dock \? null : capturedImmersiveCarry\.value;/);
  assert.match(PLAYER_JS, /immersiveCarryPending = capturedImmersiveCarry\.nextPending;/);
  assert.match(PLAYER_JS, /teardownMediaState\(\{ preserveImmersive: loadImmersiveCarry \}\);/);
});

test('teardownMediaState gates BOTH immersive drops on the preserve flag - and still drops by default', () => {
  // The v1.34.2 fullscreen drop and the AC5 audio-expand drop each keep
  // running for every non-carried load; only a carried continuation skips
  // them. Deleting either gate (or hard-wiring preserve on) goes red here.
  assert.match(PLAYER_JS, /var preserveImmersive = !!\(opts && opts\.preserveImmersive\);/);
  assert.match(PLAYER_JS, /if \(!preserveImmersive\) setCssFullscreen\(false\);/);
  assert.match(PLAYER_JS, /if \(!preserveImmersive\) exitAudioExpand\(\);/);
});

test('load() reconciles the carried state onto the new item immediately after setupForMedia', () => {
  assert.match(PLAYER_JS, /setupForMedia\(id, currentData\);\n\s*applyCarriedImmersive\(\);/);
  // The reconcile itself routes through the pure target helper and the two
  // canonical setters (never hand-toggled classes).
  const applyBody = /function applyCarriedImmersive\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(applyBody, 'applyCarriedImmersive body not found');
  assert.match(applyBody[1], /resolveImmersiveCarryTarget\(loadImmersiveCarry, currentData && currentData\.type\)/);
  assert.match(applyBody[1], /setCssFullscreen\(true\);/);
  assert.match(applyBody[1], /setAudioExpanded\(true\);/);
});

test('every continuation seam arms the one-shot carry', () => {
  // The 8 seams (spec "Design"): queue advance, autoplay context advance,
  // manual track step, the \'ended\' trackNav fallback, MediaSession
  // prev+next, keyboard Shift+P/N. Each arm is the bare statement
  // `immersiveCarryPending = true` - count them so a dropped seam (or a
  // refactor that silently loses one) goes red, then pin the two
  // highest-value sites structurally.
  const arms = PLAYER_JS.match(/immersiveCarryPending = true/g) || [];
  assert.strictEqual(arms.length, 8, 'expected exactly 8 arm sites, found ' + arms.length);
  // Lock-screen/media-key next - THE in-fullscreen skip path (the page's own
  // Next button sits under the fixed overlay and is untappable there).
  assert.match(PLAYER_JS, /setMediaSessionAction\('nexttrack', hasNext \? function \(\) \{ immersiveCarryPending = true; handlers\.onNext\(\); \} : null\);/);
  // The queue advance both autoplay-\'ended\' and manual steps funnel through.
  assert.match(PLAYER_JS, /autoplayAdvancePending = true;\n\s*immersiveCarryPending = true; .*\n\s*window\.FileTube\.navigate\(advanceHref\);/);
});
