'use strict';

// [UNIT] v1.67.5 - the faux-fullscreen SCROLL KEEPER (Dean's on-device
// trigger, 2026-08-02: exit the mobile custom player's fullscreen via its
// button and the page sits partially scrolled - the video top tucked under
// the fixed header). Mechanism: custom-mode mobile fullscreen is CSS
// faux-fullscreen (`setCssFullscreen`, host position:fixed) whose only
// scroll defense is `body.ft-css-fullscreen { overflow: hidden }` - and iOS
// Safari does NOT lock body scrolling via overflow:hidden, so touch
// gestures on the overlay (scrubbing, double-tap skip, rubber-banding)
// drift the page scroll underneath; exiting restored the layout but never
// the scroll.
//
// The fix: `setCssFullscreen` (the single authority both classes already
// move through, v1.34.4) now captures window scroll on the OFF->ON
// transition and restores it on ON->OFF - but ONLY while the player is
// still FULL: the dock/close off-path (`applyControlsMode`'s
// state !== STATE_FULL guard) fires AFTER a navigation's own scroll
// restore, and restoring the watch page's saved offset onto the DESTINATION
// view would clobber it (the cross-view hazard is the reason the pure plan
// takes `stateFull` at all).
//
// Shape per this file's established convention (player-orientation-fs-
// resume / player-hardening precedent): the DECISION is a pure exported
// helper unit-tested here; the WIRING inside the window-guarded IIFE is
// locked against comment-stripped source; Dean's on-device pass (enter faux
// fullscreen -> scrub around -> exit via the button -> the page sits where
// it was) is the documented arbiter for the iOS gesture-drift itself.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { resolveCssFsScrollPlan } = require('../../public/js/player.js');

// ---- the pure plan ----------------------------------------------------------

test('entering (off -> on) captures the current scroll and restores nothing', () => {
  assert.deepStrictEqual(resolveCssFsScrollPlan(false, true, true, null, 340), { savedY: 340, restoreTo: null });
  assert.deepStrictEqual(resolveCssFsScrollPlan(false, true, false, null, 0), { savedY: 0, restoreTo: null });
});

test('exiting (on -> off) while FULL restores the captured scroll and clears it', () => {
  assert.deepStrictEqual(resolveCssFsScrollPlan(true, false, true, 340, 512), { savedY: null, restoreTo: 340 });
  // A zero capture restores to zero (0 is a real position, not "nothing").
  assert.deepStrictEqual(resolveCssFsScrollPlan(true, false, true, 0, 87), { savedY: null, restoreTo: 0 });
});

test('exiting while NOT FULL (dock/close, incl. the navigate-away path) clears WITHOUT restoring - never clobber the destination view\'s scroll', () => {
  assert.deepStrictEqual(resolveCssFsScrollPlan(true, false, false, 340, 512), { savedY: null, restoreTo: null });
});

test('exiting with nothing captured restores nothing (off-calls can outnumber on-calls)', () => {
  assert.deepStrictEqual(resolveCssFsScrollPlan(true, false, true, null, 512), { savedY: null, restoreTo: null });
});

test('no-transition calls are inert: off -> off keeps nothing, on -> on keeps the ORIGINAL capture (never re-captures drifted scroll)', () => {
  // applyControlsMode/resetForNextLoad re-assert `off` constantly - those
  // must neither restore nor invent a capture.
  assert.deepStrictEqual(resolveCssFsScrollPlan(false, false, true, null, 512), { savedY: null, restoreTo: null });
  assert.deepStrictEqual(resolveCssFsScrollPlan(false, false, false, null, 512), { savedY: null, restoreTo: null });
  // A second `on` while already on (e.g. the webkitbeginfullscreen
  // intercept re-firing) must keep the PRE-ENTRY capture - re-capturing
  // would save an already-drifted position and defeat the restore.
  assert.deepStrictEqual(resolveCssFsScrollPlan(true, true, true, 340, 512), { savedY: 340, restoreTo: null });
});

test('garbage saved values never restore (typeof guard, the assert.equal-coercion scar)', () => {
  for (const junk of [undefined, 'x', NaN]) {
    const plan = resolveCssFsScrollPlan(true, false, true, junk, 512);
    assert.strictEqual(plan.restoreTo, null, `saved=${String(junk)} must not restore`);
    assert.strictEqual(plan.savedY, null);
  }
});

// ---- the wiring inside the IIFE (comment-stripped source contract) ----------

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const setCssFsMatch = /function setCssFullscreen\(on\) \{([\s\S]*?)\n {2}\}/.exec(stripComments(PLAYER_JS));

test('setCssFullscreen: reads the WAS state BEFORE toggling, runs the plan, applies the restore via window.scrollTo', () => {
  assert.ok(setCssFsMatch, 'expected the setCssFullscreen function body');
  const body = setCssFsMatch[1];
  const wasIdx = body.indexOf("classList.contains('css-fullscreen')");
  const toggleIdx = body.indexOf("classList.toggle('css-fullscreen'");
  assert.ok(wasIdx !== -1, 'reads the previous on/off state');
  assert.ok(toggleIdx !== -1, 'still toggles the host class');
  assert.ok(wasIdx < toggleIdx, 'the WAS read must precede the toggle (reading after always sees the NEW state and the plan never fires)');
  assert.ok(body.includes('resolveCssFsScrollPlan('), 'the wiring consumes THE pure plan, not a re-derived copy');
  assert.match(body, /state === STATE_FULL/, 'the FULL-state gate rides into the plan');
  assert.match(body, /window\.scrollTo\(0, /, 'the restore is applied');
  assert.match(body, /restoreTo !== null/, 'restore only when the plan says so (0 is a real position)');
});

test('setCssFullscreen remains the SINGLE authority: no other site toggles ft-css-fullscreen or css-fullscreen classes', () => {
  const stripped = stripComments(PLAYER_JS);
  const bodyToggles = stripped.match(/classList\.toggle\('ft-css-fullscreen'/g) || [];
  assert.strictEqual(bodyToggles.length, 1, 'exactly one ft-css-fullscreen toggle (inside setCssFullscreen)');
  const hostToggles = stripped.match(/classList\.toggle\('css-fullscreen'/g) || [];
  assert.strictEqual(hostToggles.length, 1, 'exactly one css-fullscreen toggle (inside setCssFullscreen)');
});
