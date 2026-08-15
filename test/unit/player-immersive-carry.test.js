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
  // Gate W3 (v1.130 fix round): BOTH surface-swap halves are pinned - deleting
  // either left every cross-kind carry as a two-overlay class stack with the
  // whole suite green (the adversarial seat's surviving-mutant pair).
  assert.match(applyBody[1], /exitAudioExpand\(\);/, 'the video-fs branch must drop a carried audio surface');
  assert.match(applyBody[1], /setCssFullscreen\(false\);/, 'the audio branch must drop a carried video surface');
  // Gate W1 (v1.130 fix round): the expanded overlay only exists as the
  // COMPOUND .audio-mode.audio-expanded, and setupForMedia adds .audio-mode
  // only when art resolves - an ARTLESS audio destination must degrade to the
  // plain page, never a bodiless .audio-expanded (scroll-frozen black page
  // with no overlay and no touch escape). The gated spelling is the lock:
  // hard-wiring setAudioExpanded(true) back to unconditional goes red here.
  assert.match(applyBody[1], /if \(host && host\.classList\.contains\('audio-mode'\)\) setAudioExpanded\(true\);/,
    'the audio-expanded reconcile must be gated on the surface actually existing');
  assert.ok(!/^\s*setAudioExpanded\(true\);/m.test(applyBody[1]), 'no unconditional setAudioExpanded(true) may exist in the reconcile');
  // Gate S1 (v1.130 fix round): a carried on->on entry re-seeds the scroll
  // keeper (teardown nulled it; the on->on call is a no-transition) so the
  // eventual manual exit restores the new page's top instead of nothing.
  assert.match(applyBody[1], /if \(cssFsSavedScrollY === null\) cssFsSavedScrollY = 0;/);
});

test('the adopt branch consumes a pending arm too (gate S2) - no arm survives past ANY load() entry', () => {
  // An adopt returns before the capture, so without this clear an armed carry
  // from a no-op'd advance would survive into a later unrelated load.
  assert.match(PLAYER_JS, /immersiveCarryPending = false;\n\s*\/\/ v1\.44\.2[\s\S]{0,200}if \(options\.dock\) dock\(\); else expand\(options\.slot\);\n\s*return true;/,
    'the adopt early-return must clear the one-shot arm before returning');
});

// Gate W4 (v1.130 fix round): the raw literal count was COMMENT-POROUS - a
// comment carrying `immersiveCarryPending = true` kept the count at 8 while a
// real seam was deleted (the v1.50/v1.77 comment-porous source-lock class).
// Strip comments ONCE at read (the house census pattern), count on CODE only,
// and pin every seam structurally so a dropped one names itself.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1'); // spare protocol `://` and quoted slashes
}

test('every continuation seam arms the one-shot carry (comment-stripped count + per-seam pins)', () => {
  // The 8 seams (spec "Design"): queue advance, autoplay context advance,
  // manual track step, the 'ended' trackNav fallback, MediaSession prev+next,
  // keyboard Shift+P/N.
  const CODE = stripComments(PLAYER_JS);
  const arms = CODE.match(/immersiveCarryPending = true/g) || [];
  assert.strictEqual(arms.length, 8, 'expected exactly 8 CODE arm sites, found ' + arms.length);
  // 1+2. MediaSession prev/next - THE in-fullscreen skip path (the page's own
  // Next button sits under the fixed overlay and is untappable there).
  assert.match(PLAYER_JS, /setMediaSessionAction\('nexttrack', hasNext \? function \(\) \{ immersiveCarryPending = true; handlers\.onNext\(\); \} : null\);/);
  assert.match(PLAYER_JS, /setMediaSessionAction\('previoustrack', hasPrev \? function \(\) \{ immersiveCarryPending = true; handlers\.onPrev\(\); \} : null\);/);
  // 3. The queue advance both autoplay-'ended' and manual steps funnel through.
  assert.match(PLAYER_JS, /autoplayAdvancePending = true;\n\s*immersiveCarryPending = true;[^\n]*\n\s*window\.FileTube\.navigate\(advanceHref\);/);
  // 4. The autoplay-'ended' browse-context advance.
  assert.match(PLAYER_JS, /autoplayAdvancePending = true;\n\s*immersiveCarryPending = true;[^\n]*\n[\s\S]{0,400}?window\.FileTube\.navigate\('\/watch\.html\?v=' \+ encodeURIComponent\(neighbors\.nextId\)/);
  // 5. The manual track step (on-screen prev/next pair), armed before the
  // handler runs regardless of queue-vs-context resolution.
  const manualStep = /function manualTrackStep\(dir\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(manualStep, 'manualTrackStep body not found');
  assert.match(stripComments(manualStep[1]), /immersiveCarryPending = true;\s*\n\s*if \(typeof h === 'function'\) h\(\);/);
  // 6. The 'ended' trackNav fallback (music/podcast advance path).
  const fallback = /var fallbackToTrackNav = function \(\) \{([\s\S]*?)\n {6}\};/.exec(PLAYER_JS);
  assert.ok(fallback, 'fallbackToTrackNav body not found');
  assert.match(stripComments(fallback[1]), /immersiveCarryPending = true;\s*\n\s*trackNavHandlers\.onNext\(\);/);
  // 7+8. The desktop Shift+N/Shift+P shortcuts.
  const caseN = /case 'N':([\s\S]*?)break;/.exec(PLAYER_JS);
  const caseP = /case 'P':([\s\S]*?)break;/.exec(PLAYER_JS);
  assert.ok(caseN && caseP, 'Shift+N/P keydown cases not found');
  assert.match(stripComments(caseN[1]), /immersiveCarryPending = true;\s*\n\s*trackNavHandlers\.onNext\(\);/);
  assert.match(stripComments(caseP[1]), /immersiveCarryPending = true;\s*\n\s*trackNavHandlers\.onPrev\(\);/);
});
