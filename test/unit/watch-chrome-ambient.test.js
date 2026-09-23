'use strict';

// [UNIT] v1.186 (Dean): watch-chrome consolidation + Ambient mode.
//  1. page Prev/Next buttons REMOVED (player track-nav covers feed-order + queue)
//  2. Theatre icon RELOCATED next to the cog (desktop)
//  3. Autoplay + Loop moved INTO the cog menu
//  4. Ambient mode - dark-only, opt-in, YouTube-style glow behind the player
//     (v1.312 REBUILT as a colour-only gradient glow - its engine, CSS geometry and
//     the no-video-drawImage constraint are bound in ambient-glow-engine.test.js;
//     the v1.186-v1.187.2 canvas/mask/blur locks were retired with the canvas)
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
  // v1.191 (Dean): the popcorn glyph - two paths (evenodd striped tub + puffs),
  // scaled to match the cog's footprint. The transform is what makes it "the same
  // size as the cog"; bind it so a future edit can't silently shrink the glyph.
  assert.match(fn, /fill-rule="evenodd"/, 'the popcorn tub uses evenodd (the cut-out stripes)');
  assert.match(fn, /<g transform="matrix\(1\.2 0 0 1\.2 -98 54\)">/, 'scaled + re-centred to match the settings-cog footprint');
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
  // Faux fullscreen drops the stage context so the fixed overlay escapes - for
  // BOTH video (ft-css-fullscreen) AND audio (ft-audio-expanded). The AUDIO twin
  // (v1.194.2, Dean device) closes the v1.186.1 gap: v1.186.1 dropped the context
  // for video only, leaving an expanded audio overlay TRAPPED behind the chrome on
  // the watch page (audio never rotate-fullscreened while video did). Symmetric
  // invariant - bind BOTH axes (the presence-not-binding-on-the-sibling lesson).
  const dropStart = STYLE_CSS.indexOf('body.ft-css-fullscreen .watch-player-stage');
  assert.ok(dropStart !== -1, 'the faux-fullscreen stage-drop rule exists');
  const dropBlock = STYLE_CSS.slice(dropStart, STYLE_CSS.indexOf('}', dropStart) + 1);
  assert.match(dropBlock, /body\.ft-css-fullscreen \.watch-player-stage/,
    'VIDEO faux fullscreen drops the stage context (the fixed .css-fullscreen overlay is not trapped)');
  assert.match(dropBlock, /body\.ft-audio-expanded \.watch-player-stage/,
    'AUDIO expand drops the stage context too - deleting this selector re-traps audio rotate-fullscreen behind the chrome (the v1.186.1 bug)');
  assert.match(dropBlock, /z-index:\s*auto;/, 'both selectors drop to z-index:auto');
});

test('v1.194.3: the ambient stage clips X on MOBILE (kills the scaled-glow sideways-scroll)', () => {
  // The .ambient-glow is scale()'d >1, so its box overflows the viewport
  // horizontally on a phone and iOS's weak root overflow-x:clip lets the page
  // scroll sideways. A mobile-scoped `.watch-player-stage { overflow-x: clip }`
  // clamps it (overflow-y stays visible -> vertical bloom preserved; desktop
  // untouched -> the v1.188 sidebar bleed survives). Deleting it reds this.
  const mq = /@media \(max-width:\s*768px\)\s*\{[\s\S]*?\.watch-player-stage\s*\{[^}]*overflow-x:\s*clip[^}]*\}/;
  assert.match(STYLE_CSS, mq,
    'a mobile @media block must clip the watch stage horizontally (removing it re-opens the iOS ambient sideways-scroll)');
  // It must be X-only (never overflow:hidden / overflow-y) so the vertical glow
  // bloom above/below the player survives on mobile.
  const stageMobile = /@media \(max-width:\s*768px\)\s*\{\s*\.watch-player-stage\s*\{([^}]*)\}/.exec(STYLE_CSS);
  if (stageMobile) assert.doesNotMatch(stageMobile[1], /overflow-y|overflow:\s*hidden/,
    'the mobile clip is overflow-x ONLY - clamping Y would crop the vertical ambient bloom');
});

test('v1.186.1 theatre toggle re-scatters critters for the new layout (exposed hook + call)', () => {
  assert.match(COMMON_JS, /window\.FileTube\.scheduleCritterScatter = scheduleCritterScatter;/,
    'common.js exposes the scatter hook for in-view layout changes');
  const th = WATCH_JS.slice(WATCH_JS.indexOf('function setupTheatreToggle'), WATCH_JS.indexOf('\n    // v1.186 (Dean): AMBIENT MODE'));
  assert.match(th, /theaterBtn\.addEventListener\('click'[\s\S]*window\.FileTube\.scheduleCritterScatter\(\)/,
    'the theatre toggle re-scatters critters after flipping the layout class');
});

// ---- v1.187 (Dean): ambient INTENSITY ladder + organic light falloff --------

test('v1.187 resolveAmbientLevel: the four rungs; unset/garbage -> normal (a step DOWN from v1.186)', () => {
  const { resolveAmbientLevel, AMBIENT_LEVELS } = require('../../public/js/watch.js');
  assert.deepStrictEqual(AMBIENT_LEVELS, ['subtle', 'normal', 'intense', 'extreme'], 'Dean\'s four rungs, in order');
  for (const lvl of AMBIENT_LEVELS) assert.strictEqual(resolveAmbientLevel(lvl), lvl, `${lvl} round-trips`);
  assert.strictEqual(resolveAmbientLevel(null), 'normal', 'unset -> normal (the new default)');
  assert.strictEqual(resolveAmbientLevel('blinding'), 'normal', 'garbage -> normal (fail-safe)');
  assert.strictEqual(resolveAmbientLevel(''), 'normal');
});

test('v1.187 the ambient intensity select is INJECTED into the cog (the parity-locked host stays untouched)', () => {
  assert.doesNotMatch(WATCH_HTML, /id="watch-ambient-level"/, 'not baked into the shared markup (nine-shell parity)');
  const fn = WATCH_JS.slice(WATCH_JS.indexOf('function ensureCogControlsInjected'), WATCH_JS.indexOf('\n    // FR-9 (v1.21.0) / v1.186'));
  assert.match(fn, /id="watch-ambient-level"/, 'injected with the other cog controls');
  assert.match(fn, /id="ambient-level-row"/, 'its row is addressable for the dark-only gate');
  for (const opt of ['subtle', 'normal', 'intense', 'extreme']) {
    assert.match(fn, new RegExp('value="' + opt + '"'), `the ${opt} option is offered`);
  }
});

test('v1.188 ambient bleeds over the LEFT BAR: root data-ambient-on toggled at the start/stop funnel drops the sidebar bg + border', () => {
  // Dean: "the ambience hard-stops against the left bar - let it go over the bar
  // like it does with Related files." The opaque .sidebar (z-index 99) painted
  // over the glow's left bleed and its border-right drew the hard line.
  const fn = WATCH_JS.slice(WATCH_JS.indexOf('function setupAmbientMode'), WATCH_JS.indexOf('\n    // v1.22.0 FR-7 (TF): the "Loop"'));
  // Set in start() and cleared in stop() - the SAME funnel as the glow's is-on,
  // so the root signal tracks ambient exactly (and clears on teardown/light).
  const startFn = fn.slice(fn.indexOf('function start()'), fn.indexOf('function stop()'));
  const stopFn = fn.slice(fn.indexOf('function stop()'), fn.indexOf('function evaluate()'));
  assert.match(startFn, /glow\.classList\.add\('is-on'\)/, 'start still arms the glow');
  assert.match(startFn, /document\.documentElement\.setAttribute\('data-ambient-on', ''\)/, 'start sets the root signal');
  assert.match(stopFn, /glow\.classList\.remove\('is-on'\)/, 'stop still disarms the glow');
  assert.match(stopFn, /document\.documentElement\.removeAttribute\('data-ambient-on'\)/, 'stop clears the root signal (restores the bar; also fires on teardown + light)');
  // The CSS half: while the signal is present the sidebar goes see-through so the
  // bloom flows across; `transparent` (a keyword) keeps it census-clean.
  const rule = /:root\[data-ambient-on\] \.sidebar \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(rule, 'the ambient sidebar override rule exists');
  assert.match(rule[1], /background-color:\s*transparent;/, 'the opaque sidebar bg is dropped so the glow shows through');
  assert.match(rule[1], /border-right-color:\s*transparent;/, 'the hard border-right line is dropped');
});

