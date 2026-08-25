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
  // v1.187.2: the sampler is a plain timer, NOT rAF - rAF woke it 60x a second
  // to early-return on all but ~2 of them, keeping the compositor hot for a 2fps
  // effect (part of the cost that made iOS freeze the page and pause playback).
  assert.match(fn, /if \(timerId != null\) clearTimeout\(timerId\);\n\s*timerId = null;/,
    'stop() cancels AND NULLS the handle - timerId is also the "already running" guard, so leaving it set makes start() early-return forever (ambient never returns after a pause)');
  assert.doesNotMatch(fn, /requestAnimationFrame/, 'a slow sampler must NOT sit in the frame loop');
  assert.match(fn, /timerId = setTimeout\(tick, MIN_INTERVAL\);/, 'it re-arms on the interval');
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

// ---- v1.187 (Dean): ambient INTENSITY ladder + organic light falloff --------

test('v1.187 resolveAmbientLevel: the four rungs; unset/garbage -> normal (a step DOWN from v1.186)', () => {
  const { resolveAmbientLevel, AMBIENT_LEVELS } = require('../../public/js/watch.js');
  assert.deepStrictEqual(AMBIENT_LEVELS, ['subtle', 'normal', 'intense', 'extreme'], 'Dean\'s four rungs, in order');
  for (const lvl of AMBIENT_LEVELS) assert.strictEqual(resolveAmbientLevel(lvl), lvl, `${lvl} round-trips`);
  assert.strictEqual(resolveAmbientLevel(null), 'normal', 'unset -> normal (the new default)');
  assert.strictEqual(resolveAmbientLevel('blinding'), 'normal', 'garbage -> normal (fail-safe)');
  assert.strictEqual(resolveAmbientLevel(''), 'normal');
});

test('v1.187 the intensity ladder is CSS-owned per level, and v1.186\'s look is now the "intense" rung', () => {
  const lvl = (name) => {
    const m = new RegExp('\\.ambient-glow\\[data-ambient="' + name + '"\\]\\s*\\{([^}]*)\\}').exec(STYLE_CSS);
    assert.ok(m, `the ${name} rung exists`);
    return m[1];
  };
  const num = (decls, prop) => parseFloat(new RegExp('--ambient-' + prop + ':\\s*([0-9.]+)').exec(decls)[1]);
  const o = (n) => num(lvl(n), 'opacity');
  // strictly increasing intensity across the ladder
  assert.ok(o('subtle') < o('normal'), 'subtle is WAY less than normal');
  assert.ok(o('normal') < o('intense'), 'normal is slightly less than intense');
  assert.ok(o('intense') < o('extreme'), 'extreme is more than what we had');
  assert.strictEqual(o('intense'), 0.7, 'the "intense" rung IS v1.186\'s shipped 0.7 (Dean: "what we have")');
  // Gate W3: "intense" must restore v1.186's LOOK, not just its opacity - the
  // first cut had quietly changed blur 72->64 and saturate 1.4->1.35 globally,
  // so picking Intense would NOT have given Dean his old glow back.
  // v1.187.2: intense no longer matches v1.186's 72px blur - the 32x18 backing
  // store is CSS-upscaled, so it is soft by construction and a huge blur was pure
  // GPU cost (the cost that made iOS freeze the page and pause playback).
  assert.ok(num(lvl('intense'), 'blur') <= 36, 'the blur radius stays CHEAP (the v1.187.2 playback-pause fix)');
  assert.strictEqual(num(lvl('intense'), 'scale'), 1.3, 'and v1.186\'s 1.3 spread (gate O6 - the third half of "restores the old look")');
  const glowRule = /\.ambient-glow\s*\{([^}]*)\}/.exec(STYLE_CSS)[1];
  assert.match(glowRule, /saturate\(1\.4\)/, 'the global saturate is back to v1.186\'s 1.4');
  assert.match(glowRule, /blur\(var\(--ambient-blur, 30px\)\)/, 'the blur fallback matches the NORMAL default (gate S3)');
  assert.match(glowRule, /scale\(var\(--ambient-scale, 1\.25\)\)/, 'the scale fallback matches the NORMAL default');
  // the level drives CSS only - the running sample loop is never restarted
  const fn = WATCH_JS.slice(WATCH_JS.indexOf('function setupAmbientMode'), WATCH_JS.indexOf('\n    // v1.22.0 FR-7 (TF): the "Loop"'));
  assert.match(fn, /glow\.setAttribute\('data-ambient', level\)/, 'the level rides a data attribute (CSS owns the numbers)');
  assert.match(fn, /localStorage\.setItem\('ft-ambient-intensity', level\)/, 'the choice persists');
  assert.match(fn, /if \(levelRow\) levelRow\.hidden = !dark \|\| !prefOn;/, 'the intensity row needs BOTH a dark theme and the effect ON (gate S5)');
  // Gate W5: the CSS half is what actually HIDES it - `[hidden]` loses to the
  // label's `display: inline-flex` (the repo's standing lesson), so the
  // !important override is load-bearing and must be bound, not just the JS.
  assert.match(STYLE_CSS, /#ambient-toggle-row\[hidden\],\s*\n#ambient-level-row\[hidden\] \{ display: none !important; \}/, 'both ambient rows carry the [hidden] !important override');
  assert.match(STYLE_CSS, /:root:not\(\[data-mode="dark"\]\) #ambient-toggle-row,\s*\n:root:not\(\[data-mode="dark"\]\) #ambient-level-row \{ display: none; \}/, 'and the light-theme CSS belt covers both rows');
});

test('v1.187 ORGANIC FALLOFF: the glow carries a radial alpha mask under BOTH spellings (the v1.77 lesson)', () => {
  // Dean: "hard cuts where it just stops on lines - it should fade out
  // organically like normal light." An unmasked rectangle terminates on a line
  // (and html{overflow-x:clip} guillotines it at the viewport).
  const glow = /\.ambient-glow\s*\{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(glow, '.ambient-glow rule exists');
  assert.match(glow[1], /-webkit-mask-image:\s*radial-gradient\(ellipse closest-side[^;]*transparent/, 'the -webkit- spelling (iOS), CLOSEST-SIDE sized');
  assert.match(glow[1], /\n\s*mask-image:\s*radial-gradient\(ellipse closest-side[^;]*transparent/, 'AND the standard spelling (Firefox), CLOSEST-SIDE sized');
  // Gate W3: the default farthest-corner sizing left 11-45% mask alpha at the
  // element edge, so the viewport clip still produced a hard line on mobile
  // (worst at `extreme` - the rung picked for MORE light). closest-side puts the
  // transparent stop genuinely INSIDE the box.
  assert.doesNotMatch(glow[1], /radial-gradient\(ellipse at center/, 'the farthest-corner default must not return');
  // the blur/scale are per-level vars now, so "extreme" reads as more LIGHT
  assert.match(glow[1], /filter:\s*blur\(var\(--ambient-blur/, 'blur is per-level');
  assert.match(glow[1], /transform:\s*scale\(var\(--ambient-scale/, 'spread is per-level');
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

test('v1.187.1 THE REACH INVARIANT: every rung must bleed BEYOND the player, on BOTH mask spellings', () => {
  // Dean, device: "I see the options for ambient but nothing renders, at any
  // level." Root cause was pure geometry, not wiring: the canvas is exactly the
  // player's box and paints BEHIND it (the player has an opaque letterbox-black
  // background), so ONLY the part spilling outside the player is ever visible.
  // v1.187's mask faded alpha to ZERO at 76% of the half-extent; after the
  // 1.18-1.30 scale the glow's outer boundary landed at 0.90-0.99 of the player's
  // own half-size - entirely inside the footprint, painted over, at three of the
  // four rungs.
  //
  // Gate W1: the FIRST cut of this test read only the first `transparent N%` in
  // the rule - the `-webkit-` line, which every modern engine OVERRIDES with the
  // standard spelling below it. Editing only the standard line shipped the
  // invisible glow gate-green (the v1.77 divergent-spelling class, landing on the
  // very invariant written to prevent it). It now reads BOTH declarations,
  // requires them to agree, and refuses a second `.ambient-glow` base rule that
  // could shadow the mask entirely (the v1.187 `.critter-pose` shadowing gotcha).
  const baseRules = STYLE_CSS.match(/(^|\n)\.ambient-glow\s*\{/g) || [];
  assert.strictEqual(baseRules.length, 1, 'exactly ONE .ambient-glow base rule (a second would shadow the mask)');
  const decls = [...STYLE_CSS.matchAll(/(-webkit-)?mask-image:\s*radial-gradient\(ellipse closest-side at center, black (\d+)%, transparent (\d+)%\)/g)];
  assert.strictEqual(decls.length, 2, 'both mask spellings present, and nothing else declares the glow mask');
  const cores = new Set(decls.map((d) => Number(d[2])));
  const stops = new Set(decls.map((d) => Number(d[3])));
  assert.strictEqual(cores.size, 1, 'the two spellings must not DIVERGE on the solid core');
  assert.strictEqual(stops.size, 1, 'the two spellings must not DIVERGE on the transparent stop');
  const core = [...cores][0] / 100;
  const stop = [...stops][0] / 100;
  // Gate S1: the ramp must stay a RAMP. A near-100% core (e.g. black 99%) keeps
  // every reach assertion green while collapsing the falloff into a hard edge in
  // mid-air above the player - exactly Dean's original complaint.
  assert.ok(stop - core >= 0.5, `the falloff must stay organic: core ${core} -> stop ${stop} is only ${(stop - core).toFixed(2)} of the half-extent`);
  // The fade must complete BY the element edge, or the border-box mask cut lands
  // in mid-air at real alpha (a hard line).
  assert.ok(stop <= 1, `the fade must reach zero by the element edge (stop ${stop} > 1 leaves a hard cut)`);
  // THE invariant: every rung must escape the player, or it is invisible.
  const { AMBIENT_LEVELS } = require('../../public/js/watch.js'); // gate S3: drive from the JS ladder, not a hardcoded list
  for (const rung of AMBIENT_LEVELS) {
    const body = new RegExp('\\.ambient-glow\\[data-ambient="' + rung + '"\\] \\{([^}]*)\\}').exec(STYLE_CSS);
    assert.ok(body, `${rung} has a CSS rung`);
    const scale = Number(/--ambient-scale:\s*([0-9.]+)/.exec(body[1])[1]);
    assert.ok(stop * scale > 1,
      `${rung}: stop ${stop} x scale ${scale} = ${(stop * scale).toFixed(3)} - the glow must reach PAST the player's half-size (>1) or it is hidden behind the player entirely`);
  }
  // intense keeps v1.186's REACH exactly (its brightness necessarily differs -
  // the falloff dims the edge; that IS the fix for the hard cut).
  const intense = /\.ambient-glow\[data-ambient="intense"\] \{([^}]*)\}/.exec(STYLE_CSS)[1];
  assert.strictEqual(Number(/--ambient-scale:\s*([0-9.]+)/.exec(intense)[1]) * stop, 1.3,
    'intense reaches 1.3 - the same geometric bleed v1.186 had');
});

test('v1.187.2 THE COST INVARIANT: the sampler must stay cheap enough not to get the page frozen', () => {
  // Dean, device: playback paused itself ~2-3s in AND the Dynamic Island lost its
  // artwork - on BOTH audio and video. Both symptoms are one function,
  // releaseAudioSession() (pause + `mediaSession.metadata = null`), which fires
  // when the page is going away. iOS was freezing/discarding the page because the
  // effect cost too much: a full-size canvas repainted through an intermediate
  // buffer, under a 64-88px CSS blur, driven by a 60Hz rAF loop for a 2fps
  // sampler. Audio pausing too is what proved it was the COST, not the
  // video-sampling - the audio path never draws the video element at all.
  const fn = WATCH_JS.slice(WATCH_JS.indexOf('function setupAmbientMode'), WATCH_JS.indexOf('\n    // v1.22.0 FR-7 (TF): the "Loop"'));
  // 0. AUDIO must never draw the video element - gated on the app's own
  //    `audio-mode` signal, NOT on WebKit's videoWidth (an audio file with
  //    embedded cover art can report a non-zero videoWidth, which made the
  //    "audio never draws the video" falsification an assumption, not a fact).
  // Bound as the EXACT expression (gate WARNING B): the first cut asserted only
  // the class spelling and the gated-site count, so `getElementById('...NOPE')`
  // or `return false && ...` left the gate permanently FALSE, silently reverting
  // to the pre-fix videoWidth behaviour with the suite green - the v1.185 INERT
  // class, on the very gate that exists to keep the next device A/B clean.
  assert.match(fn, /function isAudioItem\(\) \{\n\s*return !!\(mediaData && mediaData\.type === 'audio'\);\n\s*\}/,
    'the audio gate reads THIS VIEW\'s own media type, exactly - not a class that also requires extractable art, and not an expression that can be neutered to a constant');
  assert.strictEqual((fn.match(/!isAudioItem\(\) && video && video\.videoWidth > 0/g) || []).length, 2,
    'BOTH paint sites (the interval tick and the first paint in start) gate the video draw on not-audio');
  // 0b. the hard-fail guard must be in start() too (S1) - a throw in the FIRST
  //     paint must not arm a timer. Anchored to start(), not tick().
  assert.match(fn, /if \(hardFailed\) return; \/\/ S1: a throw in that first paint must NOT arm a timer\n\s*schedule\(\);/,
    'start() refuses to re-arm after a hard failure');
  // 1. the backing store stays TINY - never resized to the element's pixel box.
  assert.match(fn, /glow\.width = SRC_W;/, 'the canvas backing store is the 32x18 sample, not the player box');
  assert.doesNotMatch(fn, /glow\.width = Math\.max/, 'the canvas must never be resized to its display box (a megapixel upload per paint)');
  assert.doesNotMatch(fn, /getBoundingClientRect\(\)/, 'no per-paint layout measurement');
  // 2. no frame-loop residency for a 2fps effect.
  assert.doesNotMatch(fn, /requestAnimationFrame/, 'the sampler must not sit in the frame loop');
  // 3. the CSS blur stays cheap at EVERY rung (the upscale does the smoothing).
  for (const rung of ['subtle', 'normal', 'intense', 'extreme']) {
    const body = new RegExp('\\.ambient-glow\\[data-ambient="' + rung + '"\\] \\{([^}]*)\\}').exec(STYLE_CSS)[1];
    const blur = Number(/--ambient-blur:\s*([0-9.]+)px/.exec(body)[1]);
    assert.ok(blur <= 40, `${rung}: blur ${blur}px - a large-radius blur on a full-width layer is the GPU cost that got the page frozen (cap 40px)`);
  }
  // 4. the paint INTERVAL is the single biggest cost lever - a 16ms interval would
  //    repaint the blurred, scaled, masked layer at 60fps, far worse than pre-fix.
  assert.match(fn, /const MIN_INTERVAL = isMobile \? 500 : 200;/, 'the throttle stays coarse (2fps mobile / 5fps desktop)');
  // 5. no intermediate canvas: the old pipeline allocated a second surface per view.
  assert.doesNotMatch(fn, /createElement\('canvas'\)/, 'no intermediate buffer canvas');
  // 6. no permanently-promoted GPU surface for a show/hide transition - swept over
  //    EVERY .ambient-glow rule, not just the base one (the every-writer class: a
  //    `will-change` on `.is-on` pins the surface exactly when it is visible).
  const everyGlowRule = [...STYLE_CSS.matchAll(/\.ambient-glow[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join('\n');
  assert.doesNotMatch(everyGlowRule.replace(/\/\*[\s\S]*?\*\//g, ''), /will-change/,
    'NO .ambient-glow rule may pin a GPU surface (it was pinned for a transition that only runs on show/hide)');
});
