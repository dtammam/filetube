'use strict';

// [UNIT] v1.186 (Dean): watch-chrome consolidation + Ambient mode.
//  1. page Prev/Next buttons REMOVED (player track-nav covers feed-order + queue)
//  2. Theatre icon RELOCATED next to the cog (desktop)
//  3. Autoplay + Loop moved INTO the cog menu
//  4. Ambient mode - dark-only, opt-in, YouTube-style bloom behind the player
// The shared player host template is parity-locked byte-identical across nine
// shells (player-*-parity.test.js), so the watch-only cog controls are INJECTED
// at watch init (ensureCogControlsInjected), never baked into the shared markup.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  isAmbientEnabled, ambientStorageValue, ambientShouldRun, isDarkMode,
} = require('../../public/js/watch.js');

const WATCH_HTML = fs.readFileSync(path.join(__dirname, '../../public/watch.html'), 'utf8');
const WATCH_JS = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');
const STYLE_CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
const COMMON_JS = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');

// ---- pure helpers -----------------------------------------------------------

test('v1.186 isAmbientEnabled / ambientStorageValue: default OFF; only the literal "1" enables', () => {
  assert.strictEqual(isAmbientEnabled('1'), true);
  assert.strictEqual(isAmbientEnabled('0'), false);
  assert.strictEqual(isAmbientEnabled(null), false, 'unset -> off (default)');
  assert.strictEqual(isAmbientEnabled('yes'), false, 'garbage -> off');
  assert.strictEqual(ambientStorageValue(true), '1');
  assert.strictEqual(ambientStorageValue(false), '0');
  // round-trips
  assert.strictEqual(isAmbientEnabled(ambientStorageValue(true)), true);
  assert.strictEqual(isAmbientEnabled(ambientStorageValue(false)), false);
});

test('v1.186 ambientShouldRun: paints ONLY when prefOn AND dark AND playing AND docVisible', () => {
  const on = { prefOn: true, dark: true, playing: true, docVisible: true };
  assert.strictEqual(ambientShouldRun(on), true, 'all true -> run');
  // each single falsity tears it down
  assert.strictEqual(ambientShouldRun({ ...on, prefOn: false }), false, 'opted out -> no run');
  assert.strictEqual(ambientShouldRun({ ...on, dark: false }), false, 'LIGHT theme -> never runs (Dean ruling)');
  assert.strictEqual(ambientShouldRun({ ...on, playing: false }), false, 'paused -> no run (battery)');
  assert.strictEqual(ambientShouldRun({ ...on, docVisible: false }), false, 'tab hidden -> no run (battery)');
  assert.strictEqual(ambientShouldRun(null), false, 'null-safe');
  assert.strictEqual(ambientShouldRun({}), false, 'empty -> off');
});

test('v1.186 isDarkMode: reads data-mode="dark" off the document element; fail-safe', () => {
  const mk = (mode) => ({ documentElement: { getAttribute: (k) => (k === 'data-mode' ? mode : null) } });
  assert.strictEqual(isDarkMode(mk('dark')), true);
  assert.strictEqual(isDarkMode(mk('light')), false);
  assert.strictEqual(isDarkMode(mk(null)), false, 'unset -> not dark');
  assert.strictEqual(isDarkMode({ documentElement: { getAttribute() { throw new Error('boom'); } } }), false, 'throw -> false (fail-safe)');
});

// ---- item 1: page Prev/Next removed, track-nav preserved --------------------

test('v1.186 the page Prev/Next buttons + bar are GONE from watch.html', () => {
  assert.doesNotMatch(WATCH_HTML, /id="watch-prev-btn"/, 'no page Previous button');
  assert.doesNotMatch(WATCH_HTML, /id="watch-next-btn"/, 'no page Next button');
  assert.doesNotMatch(WATCH_HTML, /id="watch-prevnext"|class="watch-prevnext"/, 'no prev/next bar');
});

test('v1.186 navigation is NOT lost: the track-nav context still registers setTrackNav from computeNeighbors', () => {
  const fn = WATCH_JS.slice(WATCH_JS.indexOf('async function setupTrackNavContext'), WATCH_JS.indexOf('\n    async function setupAutoplayToggle'));
  assert.ok(fn.length > 0, 'setupTrackNavContext exists (renamed from setupPrevNext)');
  assert.match(fn, /computeNeighbors\(orderedIds, mediaId\)/, 'still derives feed-order neighbors');
  assert.match(fn, /window\.FileTube\.player\.setTrackNav\(/, 'registers them with the player (powers its prev/next + media keys)');
  assert.doesNotMatch(fn, /prevBtn|nextBtn/, 'no page-button references remain');
});

// ---- items 2/3: cog controls injected (shared template stays parity-locked) --

test('v1.186 the watch-only cog controls are NOT baked into watch.html (they are injected at runtime)', () => {
  // If these were static in watch.html, the nine-shell parity tests would break.
  assert.doesNotMatch(WATCH_HTML, /id="theater-btn"/, 'theater-btn is injected, not static');
  assert.doesNotMatch(WATCH_HTML, /id="watch-autoplay-check"/, 'autoplay row injected, not static');
  assert.doesNotMatch(WATCH_HTML, /id="watch-loop-check"/, 'loop row injected, not static');
  assert.doesNotMatch(WATCH_HTML, /id="watch-ambient-check"/, 'ambient row injected, not static');
});

test('v1.186 ensureCogControlsInjected injects the theater icon + 3 toggle rows, id-guarded (no double-inject)', () => {
  const fn = WATCH_JS.slice(WATCH_JS.indexOf('function ensureCogControlsInjected'), WATCH_JS.indexOf('\n    // FR-9 (v1.21.0) / v1.186'));
  assert.ok(fn.length > 0, 'ensureCogControlsInjected exists');
  assert.match(fn, /!document\.getElementById\('theater-btn'\)/, 'theater-btn injection is id-guarded');
  assert.match(fn, /cog\.insertAdjacentHTML\('beforebegin'/, 'theater icon goes just before the cog');
  assert.match(fn, /!document\.getElementById\('watch-ambient-check'\)/, 'toggle rows injection is id-guarded');
  assert.match(fn, /id="watch-autoplay-check"[\s\S]*id="watch-loop-check"[\s\S]*id="watch-ambient-check"/, 'all three rows injected into the menu');
  // it runs post-mount, before the setup wiring
  assert.match(WATCH_JS, /ensureCogControlsInjected\(\);\n\s*setupAutoplayToggle\(\);/, 'injected before the wiring, post-mount');
});

test('v1.186 the moved controls are RE-QUERIED post-mount (the v1.181 lesson: no pre-mount captured refs)', () => {
  const ap = WATCH_JS.slice(WATCH_JS.indexOf('async function setupAutoplayToggle'), WATCH_JS.indexOf('\n    // v1.22.0 FR-7 (TF): the "Loop"'));
  assert.match(ap, /const autoplayCheck = root\.querySelector\('#watch-autoplay-check'\);/, 'autoplay re-queries post-mount');
  const lp = WATCH_JS.slice(WATCH_JS.indexOf('function setupLoopToggle'), WATCH_JS.indexOf('\n    // FR-1/FR-3'));
  assert.match(lp, /const loopCheck = root\.querySelector\('#watch-loop-check'\);/, 'loop re-queries post-mount');
  const th = WATCH_JS.slice(WATCH_JS.indexOf('function setupTheatreToggle'), WATCH_JS.indexOf('\n    // v1.186 (Dean): AMBIENT MODE'));
  assert.match(th, /const theaterBtn = root\.querySelector\('#theater-btn'\);/, 'theatre re-queries #theater-btn post-mount');
});

// ---- item 4: ambient canvas (watch-view) + lifecycle ------------------------

test('v1.186 the ambient canvas + stage ARE in watch.html (view markup, not the shared host)', () => {
  assert.match(WATCH_HTML, /<canvas id="ambient-glow"[^>]*aria-hidden="true"[^>]*hidden><\/canvas>/, 'canvas present, starts hidden + aria-hidden');
  assert.match(WATCH_HTML, /class="watch-player-stage"/, 'the relative stage wraps the player slot');
});

test('v1.186 ambient loop is battery-safe: gated on ambientShouldRun, torn down on every off-signal', () => {
  const fn = WATCH_JS.slice(WATCH_JS.indexOf('function setupAmbientMode'), WATCH_JS.indexOf('\n    // v1.22.0 FR-7 (TF): the "Loop"'));
  assert.ok(fn.length > 0, 'setupAmbientMode exists');
  assert.match(fn, /ambientShouldRun\(\{/, 'the loop keys on the pure predicate');
  assert.match(fn, /if \(!shouldRun\(\)\) \{ stop\(\); return; \}/, 'a false predicate STOPS the loop (no idle cost)');
  assert.match(fn, /cancelAnimationFrame\(rafId\)/, 'the rAF handle is cancelled on stop (no leak)');
  // re-evaluated on every signal that flips the predicate
  assert.match(fn, /addEventListener\('visibilitychange', evaluate, \{ signal \}\)/, 'tab hide/show re-evaluates');
  assert.match(fn, /video\.addEventListener\('pause', evaluate, \{ signal \}\)/, 'pause re-evaluates');
  assert.match(fn, /attributeFilter: \['data-mode', 'data-theme'\]/, 'a theme flip re-evaluates (light kills it)');
  // teardown: signal abort stops the loop AND disconnects the theme observer
  assert.match(fn, /signal\.addEventListener\('abort'[\s\S]*stop\(\)[\s\S]*themeObs[\s\S]*disconnect\(\)/, 'view teardown stops the loop + disconnects the observer');
  // same-origin source (no canvas taint that could break playback)
  assert.match(fn, /'\/thumbnail\/' \+ encodeURIComponent\(mediaId\)/, 'audio cover sampled from the same-origin thumbnail');
});

// ---- v1.186.1 hotfix (Dean, device): fullscreen trap + theatre re-scatter ----

test('v1.186.1 the ambient stacking context lives on the STAGE, never on #player-slot (or it traps the fixed fullscreen overlay)', () => {
  // The v1.166 class: #player-wrapper.css-fullscreen is position:fixed
  // z-index:var(--z-sheet); a z-indexed ANCESTOR caps it below the chrome. So
  // #player-slot must carry NO z-index; the stage owns the context and drops it
  // in faux fullscreen.
  const stage = STYLE_CSS.slice(STYLE_CSS.indexOf('.watch-player-stage {'), STYLE_CSS.indexOf('.ambient-glow {'));
  assert.match(stage, /z-index:\s*0;/, 'the stage owns the ambient stacking context');
  const glow = STYLE_CSS.slice(STYLE_CSS.indexOf('.ambient-glow {'), STYLE_CSS.indexOf('.ambient-glow.is-on'));
  assert.match(glow, /z-index:\s*-1;/, 'the glow sits BEHIND #player-slot within the stage context');
  // #player-slot must NOT get a z-index (that was the trap).
  const slotRule = STYLE_CSS.match(/(^|\n)#player-slot\s*\{[^}]*\}/);
  if (slotRule) assert.doesNotMatch(slotRule[0], /z-index/, '#player-slot must NOT create a stacking context (it traps the fixed fullscreen overlay)');
  // Faux fullscreen drops the stage context so the fixed overlay escapes.
  assert.match(STYLE_CSS, /body\.ft-css-fullscreen \.watch-player-stage \{\s*z-index:\s*auto;\s*\}/,
    'faux fullscreen drops the stage stacking context so the fixed .css-fullscreen overlay is not trapped');
});

test('v1.186.1 theatre toggle re-scatters critters for the new layout (exposed hook + call)', () => {
  assert.match(COMMON_JS, /window\.FileTube\.scheduleCritterScatter = scheduleCritterScatter;/,
    'common.js exposes the scatter hook for in-view layout changes');
  const th = WATCH_JS.slice(WATCH_JS.indexOf('function setupTheatreToggle'), WATCH_JS.indexOf('\n    // v1.186 (Dean): AMBIENT MODE'));
  assert.match(th, /theaterBtn\.addEventListener\('click'[\s\S]*window\.FileTube\.scheduleCritterScatter\(\)/,
    'the theatre toggle re-scatters critters after flipping the layout class');
});
