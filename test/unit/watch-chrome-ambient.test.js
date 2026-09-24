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
} = require('../../public/js/watch.js'); // v1.317 M4: re-exported from ambient.js (moved verbatim)

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
  // v1.317 (Dean, T1): the theatre button's markup has ONE writer - player.js's
  // ensureTheaterButton (id-guarded there; the music view injects the same button
  // through it). watch.js CALLS it and carries no copy of the glyph. The writer's
  // own shape (before the cog, evenodd tub, the 1.2x cog-matching transform) is
  // bound in music-theater-toggle.test.js by executing it.
  assert.match(fn, /window\.FileTube\.player\.ensureTheaterButton\(\)/, 'theater-btn is injected through the shared writer');
  assert.doesNotMatch(fn, /id="theater-btn"|fill-rule="evenodd"/, 'no second copy of the button markup in watch.js');
  const PLAYER_JS = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');
  const writer = PLAYER_JS.slice(PLAYER_JS.indexOf('var THEATER_BTN_HTML'), PLAYER_JS.indexOf('\nif (typeof module'));
  assert.match(writer, /d\.getElementById\('theater-btn'\)/, 'the writer is id-guarded');
  assert.match(writer, /cog\.insertAdjacentHTML\('beforebegin'/, 'theater icon goes just before the cog');
  assert.match(writer, /fill-rule="evenodd"/, 'the popcorn tub uses evenodd (the cut-out stripes)');
  assert.match(writer, /<g transform="matrix\(1\.2 0 0 1\.2 -98 54\)">/, 'scaled + re-centred to match the settings-cog footprint');
  // v1.317 M4: the Ambient row has ONE writer - ambient.js ensureAmbientToggleRow - because
  // the music view injects the same row when it mounts first. Autoplay + Loop keep their own
  // id guard and land BEFORE an Ambient row that is already there (menu order preserved);
  // the order is bound by execution in music-ambient.test.js.
  assert.match(fn, /!document\.getElementById\('watch-autoplay-check'\)/, 'the Autoplay + Loop injection is id-guarded on its OWN id');
  assert.match(fn, /id="watch-autoplay-check"[\s\S]*id="watch-loop-check"/, 'Autoplay + Loop injected into the menu');
  assert.doesNotMatch(fn, /id="watch-ambient-check"/, 'no second copy of the Ambient row markup in watch.js');
  assert.match(fn, /window\.FileTubeAmbient\.ensureAmbientToggleRow\(document\)/, 'the Ambient row through the shared writer');
  const AMBIENT_JS = fs.readFileSync(path.join(__dirname, '../../public/js/ambient.js'), 'utf8');
  const rowWriter = AMBIENT_JS.slice(AMBIENT_JS.indexOf('var AMBIENT_ROW_HTML'), AMBIENT_JS.indexOf('\n// v1.317 M4: THE HOST'));
  assert.match(rowWriter, /id="ambient-toggle-row" for="watch-ambient-check"[\s\S]*id="watch-ambient-check"/, 'the writer carries the v1.186 ids the CSS belts key off');
  assert.match(rowWriter, /var check = d\.getElementById\('watch-ambient-check'\);\s*if \(!check\) \{/, 'the writer is id-guarded');
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
  // v1.317 gate r2 (qa W1): a cheap source backstop for the click's view-signal binding
  // (the button is shared with /music now); the EXECUTED binding is the "gate r2 W1" test
  // in watch-init-behavioral.test.js.
  assert.match(th, /\}, \{ signal \}\);\s*\}\s*$/, 'the theatre click is bound on the view signal');
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
  // v1.317 M4: the music view's player stage owns a context too - the SAME drop covers it
  // for both body classes (a music expanded-audio overlay must escape exactly like watch's).
  assert.match(dropBlock, /body\.ft-css-fullscreen \.music-player-stage/, 'VIDEO faux fullscreen drops the MUSIC stage context');
  assert.match(dropBlock, /body\.ft-audio-expanded \.music-player-stage/, 'AUDIO expand drops the MUSIC stage context');
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

// ---- v1.187 ambient INTENSITY ladder: RETIRED in v1.312 (Dean: one YouTube-matched
// look, no picker). The ladder's absence is bound in ambient-glow-engine.test.js.

test('v1.188 ambient bleeds over the LEFT BAR: root data-ambient-on toggled at the start/stop funnel drops the sidebar bg + border', () => {
  // Dean: "the ambience hard-stops against the left bar - let it go over the bar
  // like it does with Related files." The opaque .sidebar (z-index 99) painted
  // over the glow's left bleed and its border-right drew the hard line.
  // v1.317 M4: the start/stop funnel is the SHARED host's now (ambient.js createAmbientHost),
  // which the watch view and the music view both run through.
  const AMBIENT_JS = fs.readFileSync(path.join(__dirname, '../../public/js/ambient.js'), 'utf8');
  const fn = AMBIENT_JS.slice(AMBIENT_JS.indexOf('function createAmbientHost'), AMBIENT_JS.indexOf('\nvar FileTubeAmbientApi'));
  // Set in start() and cleared in stop() - the SAME funnel as the glow's is-on,
  // so the root signal tracks ambient exactly (and clears on teardown/light).
  // Gate r1 (qa S2 / adversary S1): each span ends at ITS OWN closing brace (a missing
  // end anchor used to run stop() to the end of the host, so a removal moved into
  // teardown() still matched here).
  const own = (header) => {
    const a = fn.indexOf(header);
    assert.ok(a > 0, header + ' found in the host');
    const b = fn.indexOf('\n  }', a);
    assert.ok(b > a, header + ' closes');
    return fn.slice(a, b);
  };
  const startFn = own('function start() {');
  const stopFn = own('function stop() {');
  assert.match(startFn, /glow\.classList\.add\('is-on'\)/, 'start still arms the glow');
  assert.match(startFn, /doc\.documentElement\.setAttribute\('data-ambient-on', ''\)/, 'start sets the root signal');
  assert.match(stopFn, /glow\.classList\.remove\('is-on'\)/, 'stop still disarms the glow');
  assert.match(stopFn, /doc\.documentElement\.removeAttribute\('data-ambient-on'\)/, 'stop clears the root signal (restores the bar; also fires on teardown + light)');
  // The CSS half: while the signal is present the sidebar goes see-through so the
  // bloom flows across; `transparent` (a keyword) keeps it census-clean.
  const rule = /:root\[data-ambient-on\] \.sidebar \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(rule, 'the ambient sidebar override rule exists');
  assert.match(rule[1], /background-color:\s*transparent;/, 'the opaque sidebar bg is dropped so the glow shows through');
  assert.match(rule[1], /border-right-color:\s*transparent;/, 'the hard border-right line is dropped');
});

