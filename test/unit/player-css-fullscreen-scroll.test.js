'use strict';

// [UNIT] v1.67.5 - the faux-fullscreen SCROLL KEEPER (Dean's on-device
// trigger, 2026-08-02: exit the mobile custom player's fullscreen via its
// button and the page sits partially scrolled - the video top tucked under
// the fixed header). Mechanism: custom-mode mobile fullscreen is CSS
// faux-fullscreen (`setCssFullscreen`, host position:fixed) whose only
// scroll defense is `body.ft-css-fullscreen { overflow: hidden }` - and iOS
// Safari does NOT lock body scrolling via overflow:hidden, so touch
// gestures on the overlay drift the page scroll underneath; exiting
// restored the layout but never the scroll.
//
// The fix: `setCssFullscreen` captures window scroll on OFF->ON and
// restores it on ON->OFF - but ONLY for the restore-eligible caller. Gate
// C1 (adversarial, measured): eligibility is the CALL SITE, not player
// state - watch->watch navigation never docks, so the TEARDOWN off-call
// runs with state still FULL, AFTER the router placed the new page's
// scroll, and a state-gated restore stamped the OLD capture onto the NEW
// page (the queue/autoplay-advance and back-navigation clobber). Only the
// fullscreen exit button passes `{ restoreScroll: true }`.
//
// Gate W1 (adversarial): the first-cut wiring locks bound PRESENCE, not
// behavior - four crafted mutants survived (wrong plan field consumed,
// persist gated behind the restore, inverted WAS read, widened gate). The
// locks below are the seat's verified prescription: EXACT-STATEMENT
// matches plus ordering assertions, each chosen to go red under the named
// mutant. Dean's on-device pass stays the arbiter for the iOS gesture
// drift itself.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { resolveCssFsScrollPlan } = require('../../public/js/player.js');

// ---- the pure plan ----------------------------------------------------------

test('entering (off -> on) captures the current scroll and restores nothing', () => {
  assert.deepStrictEqual(resolveCssFsScrollPlan(false, true, false, null, 340), { savedY: 340, restoreTo: null });
  assert.deepStrictEqual(resolveCssFsScrollPlan(false, true, true, null, 0), { savedY: 0, restoreTo: null });
});

test('exiting (on -> off) via the ELIGIBLE caller restores the capture and clears it', () => {
  assert.deepStrictEqual(resolveCssFsScrollPlan(true, false, true, 340, 512), { savedY: null, restoreTo: 340 });
  // A zero capture restores to zero (0 is a real position, not "nothing").
  assert.deepStrictEqual(resolveCssFsScrollPlan(true, false, true, 0, 87), { savedY: null, restoreTo: 0 });
});

test('exiting via an INELIGIBLE caller clears WITHOUT restoring - the teardown/dock off-paths run around navigations whose scroll must win (gate C1)', () => {
  // The C1 repro sequence, plan-level: video A fullscreen at capture 340;
  // autoplay advances watch->watch (no dock, state stays FULL); the router
  // scrolls the NEW page to 0; teardown fires ON->OFF. Eligibility is
  // false (teardown never passes restoreScroll), so the plan must clear
  // and NOT hand back 340 - video B's page stays where the router put it.
  assert.deepStrictEqual(resolveCssFsScrollPlan(true, false, false, 340, 0), { savedY: null, restoreTo: null });
});

test('exiting with nothing captured restores nothing (off-calls can outnumber on-calls)', () => {
  assert.deepStrictEqual(resolveCssFsScrollPlan(true, false, true, null, 512), { savedY: null, restoreTo: null });
});

test('no-transition calls are inert: off -> off keeps nothing, on -> on keeps the ORIGINAL capture (never re-captures drifted scroll)', () => {
  assert.deepStrictEqual(resolveCssFsScrollPlan(false, false, true, null, 512), { savedY: null, restoreTo: null });
  assert.deepStrictEqual(resolveCssFsScrollPlan(false, false, false, null, 512), { savedY: null, restoreTo: null });
  // A second `on` while already on (the webkitbeginfullscreen intercept
  // re-firing) must keep the PRE-ENTRY capture - re-capturing would save
  // an already-drifted position and defeat the restore.
  assert.deepStrictEqual(resolveCssFsScrollPlan(true, true, true, 340, 512), { savedY: 340, restoreTo: null });
});

test('garbage saved values never restore (typeof + NaN guard, the coercion scar)', () => {
  for (const junk of [undefined, 'x', NaN]) {
    const plan = resolveCssFsScrollPlan(true, false, true, junk, 512);
    assert.strictEqual(plan.restoreTo, null, `saved=${String(junk)} must not restore`);
    assert.strictEqual(plan.savedY, null);
  }
});

test('v1.68: entering with a capture ALREADY HELD keeps it (the native->faux rotate handoff must not re-capture clobbered scroll)', () => {
  // Sequence: rotate -> native enter captured 340 -> the intercept exits
  // native and enters faux. By faux-enter time iOS may have already moved
  // the page; the ORIGINAL capture must survive.
  assert.deepStrictEqual(resolveCssFsScrollPlan(false, true, false, 340, 999), { savedY: 340, restoreTo: null });
});

// ---- the wiring inside the IIFE (comment-stripped EXACT-STATEMENT locks) ----

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const STRIPPED = stripComments(PLAYER_JS);
const setCssFsMatch = /function setCssFullscreen\(on, opts\) \{([\s\S]*?)\n {2}\}/.exec(STRIPPED);

test('setCssFullscreen wiring: exact statements, in the load-bearing order (each lock kills a measured W1 mutant)', () => {
  assert.ok(setCssFsMatch, 'expected the setCssFullscreen(on, opts) function body');
  const body = setCssFsMatch[1];

  // M3 killer: the exact WAS read (an inverted `!(...)` no longer matches),
  // and it must precede the toggle (reading after always sees the NEW state).
  const wasIdx = body.indexOf("var wasOn = !!(host && host.classList.contains('css-fullscreen'));");
  assert.ok(wasIdx !== -1, 'exact WAS-read statement');
  const toggleIdx = body.indexOf("classList.toggle('css-fullscreen'");
  assert.ok(toggleIdx !== -1 && wasIdx < toggleIdx, 'WAS read precedes the toggle');

  // M4 killer: the exact eligibility derivation - caller opt-in AND FULL.
  assert.ok(
    body.includes('var restoreEligible = !!(opts && opts.restoreScroll) && state === STATE_FULL;'),
    'exact eligibility statement (no widened gate)'
  );

  // The exact five-arg plan call - the wiring consumes THE pure plan.
  assert.ok(
    body.includes('var plan = resolveCssFsScrollPlan(wasOn, !!on, restoreEligible, cssFsSavedScrollY, currentY);'),
    'exact plan invocation'
  );

  // M2 killer: the persist is UNCONDITIONAL and PRECEDES the restore - a
  // persist gated inside the restore branch never saves on entry.
  const persistIdx = body.indexOf('cssFsSavedScrollY = plan.savedY;');
  assert.ok(persistIdx !== -1, 'exact persist statement');

  // M1 killer: the exact restore statement consumes restoreTo, guarded on
  // restoreTo !== null (0 is a real position).
  const restoreIdx = body.indexOf('if (plan.restoreTo !== null) window.scrollTo(0, plan.restoreTo);');
  assert.ok(restoreIdx !== -1, 'exact restore statement');
  assert.ok(persistIdx < restoreIdx, 'persist precedes restore (unconditional persist cannot hide inside the restore branch)');
});

test('call sites: ONLY explicit USER-EXIT paths opt into restore; teardown and the state off-guard stay clear-only (gate C1)', () => {
  // v1.118 (Dean): restore-eligible is now the THREE explicit user-exit paths --
  // the fullscreen button, the rotate-back-to-portrait faux exit, and the Fix A
  // genuine-native-exit faux drop. All three are a user LEAVING fullscreen while
  // still on the watch page (state === STATE_FULL), so putting the page back
  // where they were is correct -- the SAME intent gate C1 granted the button.
  // The clear-only callers (teardown / dock / the applyControlsMode state guard)
  // still pass NO options: they run around navigations whose own scroll must win.
  const optIns = STRIPPED.match(/restoreScroll: true/g) || [];
  assert.strictEqual(optIns.length, 3, 'exactly THREE restore-eligible (user-exit) call sites');
  assert.ok(
    STRIPPED.includes("setCssFullscreen(!host.classList.contains('css-fullscreen'), { restoreScroll: true });"),
    'the exit button toggle'
  );
  assert.ok(
    STRIPPED.includes('setCssFullscreen(false, { restoreScroll: true });'),
    'the rotate-back / Fix A faux exits (setCssFullscreen(false, { restoreScroll: true }))'
  );
  // The clear-only callers must remain option-free: teardown (the C1
  // clobber path) and the applyControlsMode state guard.
  assert.ok(STRIPPED.includes('if (state !== STATE_FULL) setCssFullscreen(false);'),
    'the applyControlsMode off-guard passes no options');
  const bareOffCalls = STRIPPED.match(/setCssFullscreen\(false\);/g) || [];
  assert.ok(bareOffCalls.length >= 2, 'teardown + the state guard remain bare clear-only calls');
});

// ---- v1.68: NATIVE fullscreen coverage (the remaining uncovered door) -------
//
// iOS clobbers page scroll on native fullscreen exits (the Done/X path in
// native-controls mode) and v1.67.5's keeper only covered faux. The same
// keeper state now serves both flavors: capture on the player's OWN native
// enter (element-scoped, mobile-only, capture-if-not-held), restore on the
// native exit event - suppressed when faux took over (the rotate handoff)
// and when the player is no longer FULL (the C1 cross-view discipline) -
// and the LOAD BOUNDARY clears the capture outright (a capture from video
// A must never restore onto video B's page at a later Done-exit).

test('native keeper wiring: capture on the player\'s own native enter, restore in onFsChange, clear at the load boundary (exact statements)', () => {
  const stripped = STRIPPED;
  assert.ok(stripped.includes('function keeperNativeFsCapture()'), 'the native capture helper exists');
  assert.ok(stripped.includes('function keeperNativeFsExit()'), 'the native exit helper exists');
  // Capture: mobile-only + capture-if-not-held, reading the same shared state.
  const cap = /function keeperNativeFsCapture\(\) \{([\s\S]*?)\n {2}\}/.exec(stripped);
  assert.ok(cap, 'capture body');
  assert.ok(cap[1].includes('if (!isMobileFormFactor()) return;'), 'mobile-only (desktop fullscreen behavior untouched)');
  assert.ok(cap[1].includes('if (cssFsSavedScrollY !== null) return;'), 'capture-if-not-held');
  // Gate W2: the element-scoped guard (FIX A - never a bare truthiness
  // fullscreen check). Without it, ANY element's fullscreen on mobile
  // captures scroll and a later player exit restores that stale capture.
  assert.ok(cap[1].includes('if (!inNativeFullscreen()) return;'), 'element-scoped to the player\'s OWN fullscreen');
  // Exit: handoff suppression BEFORE anything else, C1 state discipline,
  // unconditional clear.
  const ex = /function keeperNativeFsExit\(\) \{([\s\S]*?)\n {2}\}/.exec(stripped);
  assert.ok(ex, 'exit body');
  const handoffIdx = ex[1].indexOf("if (host && host.classList.contains('css-fullscreen')) return;");
  assert.ok(handoffIdx !== -1, 'the rotate handoff suppresses the restore (faux now owns the capture)');
  assert.ok(ex[1].includes('state === STATE_FULL'), 'the C1 discipline rides the native exit too');
  assert.ok(ex[1].includes('isMobileFormFactor()'), 'gate S2: the restore is mobile-gated (desktop untouched)');
  const clearIdx = ex[1].indexOf('cssFsSavedScrollY = null;');
  assert.ok(clearIdx !== -1 && clearIdx > handoffIdx, 'the capture ALWAYS clears on a native exit (after the handoff early-return)');
  // Call sites: enter via onEnterFullscreen, exit via onFsChange, clear at
  // the load boundary (teardown).
  const enterFn = /function onEnterFullscreen\(\) \{([\s\S]*?)\}/.exec(stripped);
  assert.ok(enterFn && enterFn[1].includes('keeperNativeFsCapture();'), 'onEnterFullscreen captures');
  const fsChange = /function onFsChange\(\) \{([\s\S]*?)\n {4}\}/.exec(stripped);
  assert.ok(fsChange && fsChange[1].includes('keeperNativeFsExit();'), 'onFsChange restores/clears');
  // QA gate: the regex arm alone - the prior includes() disjunct was
  // unsatisfiable at HEAD and any future comment-trailed clear anywhere
  // would have satisfied it with the load-boundary clear deleted.
  assert.ok(/setCssFullscreen\(false\);\s*\n\s*cssFsSavedScrollY = null;/.test(stripped),
    'the load boundary clears the keeper capture right after its faux off-call');
});

test('setCssFullscreen remains the SINGLE authority: no other site toggles the fullscreen classes', () => {
  const bodyToggles = STRIPPED.match(/classList\.toggle\('ft-css-fullscreen'/g) || [];
  assert.strictEqual(bodyToggles.length, 1, 'exactly one ft-css-fullscreen toggle (inside setCssFullscreen)');
  const hostToggles = STRIPPED.match(/classList\.toggle\('css-fullscreen'/g) || [];
  assert.strictEqual(hostToggles.length, 1, 'exactly one css-fullscreen toggle (inside setCssFullscreen)');
});
