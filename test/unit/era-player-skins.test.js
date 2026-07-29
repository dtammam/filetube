'use strict';

// [UNIT] v1.50 T7 (Dean: "make the custom player resemble the YouTube eras.
// Same controls/spacing/etc. but make them visually represent the eras").
// The base control-bar rules are the 2005 Original skin; 2009/2014/2021 get
// era-scoped overrides. This suite locks the two HARD RULES from the skin
// block's header comment:
//   1. visual-only -- no era rule may touch the bar's geometry (the mobile
//      two-row layout has a long trap history: v1.34.1, v1.47.5/6);
//   2. token/rgba-only -- no hardcoded palette hex inside the skin block,
//      which is what makes every skin correct in BOTH data-mode palettes
//      with zero mode-scoped rules.
// Plus each era's signature so a skin can't silently vanish.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

const BLOCK_START = css.indexOf('=== v1.50 (Dean): era player skins');
const BLOCK_END = css.indexOf('---- docked mini-player', BLOCK_START);

test('the era skin block exists, between the base (2005) rules and the docked rules', () => {
  assert.notEqual(BLOCK_START, -1, 'expected the era-player-skins block');
  assert.notEqual(BLOCK_END, -1, 'expected the block to end before the docked mini-player rules');
});

const block = css.slice(BLOCK_START, BLOCK_END);
// The block minus comments -- hard-rule assertions must judge CODE only.
const code = block.replace(/\/\*[\s\S]*?\*\//g, '');

test('2005 has NO skin block -- the base rules ARE its skin', () => {
  assert.doesNotMatch(code, /\[data-theme="2005"\]/, 'the base is the 2005 skin; a 2005 override would mean the base drifted');
});

test('HARD RULE 1 (geometry): no era rule touches the bar\'s height/padding/gap/order', () => {
  // Bar geometry properties are forbidden anywhere in the skin block EXCEPT
  // the slider-internal track/thumb sizing (height inside the range input's
  // fixed 16px hit area does not move layout). Strip the pseudo-element
  // rules first, then assert the remainder is geometry-free.
  const nonSliderRules = code
    .split('}')
    .filter((rule) => !/::-webkit-slider|::-moz-range/.test(rule))
    .join('}');
  // Property-boundary matches -- a bare substring scan false-positives on
  // `border: none` (contains "order:") and `border-width` (contains "width").
  for (const prop of ['height', 'padding(?:-\\w+)?', 'gap', 'order', 'margin(?:-\\w+)?', 'width', 'flex(?:-\\w+)?']) {
    const re = new RegExp(`(?<![-a-zA-Z])${prop}\\s*:`);
    assert.ok(!re.test(nonSliderRules), `era skin rules must be visual-only -- found forbidden "${prop}" outside the slider pseudo-elements`);
  }
});

test('HARD RULE 2 (both modes): no hardcoded palette hex -- tokens and rgba() overlays only', () => {
  assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, 'a hardcoded hex can only be right in ONE data-mode palette');
});

test('2009 signature: glossy gradient chrome on the bar and buttons', () => {
  assert.match(code, /\[data-theme="2009"\] \.player-controls\s*\{[^}]*linear-gradient\(to bottom/, 'the bar carries the era glass gradient');
  assert.match(code, /\[data-theme="2009"\] \.pc-btn\s*\{[^}]*linear-gradient\(to bottom/, 'buttons carry the era glass gradient');
});

test('2014 signature: flat ghost buttons and the red dot scrubber', () => {
  const btn = /\[data-theme="2014"\] \.pc-btn\s*\{([^}]*)\}/.exec(code);
  assert.ok(btn, 'expected the 2014 .pc-btn rule');
  assert.match(btn[1], /border:\s*none/);
  assert.match(btn[1], /background-color:\s*transparent/);
  assert.match(btn[1], /box-shadow:\s*none/);
  assert.match(code, /\[data-theme="2014"\] \.pc-range::-webkit-slider-thumb\s*\{[^}]*border-radius:\s*50%[^}]*background-color:\s*var\(--yt-red\)/, 'the era red dot scrubber');
});

test('2021 signature: circular button hover, pill tracks, round red scrubber', () => {
  const btn = /\[data-theme="2021"\] \.pc-btn\s*\{([^}]*)\}/.exec(code);
  assert.ok(btn, 'expected the 2021 .pc-btn rule');
  assert.match(btn[1], /border-radius:\s*50%/, 'circular button treatment');
  assert.match(btn[1], /background-color:\s*transparent/);
  assert.match(code, /\[data-theme="2021"\] \.pc-range::-webkit-slider-runnable-track\s*\{[^}]*border-radius:\s*999px/, 'pill track');
  assert.match(code, /\[data-theme="2021"\] \.pc-range::-webkit-slider-thumb\s*\{[^}]*border-radius:\s*50%[^}]*background-color:\s*var\(--yt-red\)/, 'round red scrubber');
});

test('thumb centering math: every era thumb margin-top centers its thumb on its track', () => {
  // margin-top = -(thumb - track) / 2. 2014 keeps the base 6px track with a
  // 12px thumb (-3px); 2021 slims the track to 4px with a 12px thumb (-4px).
  assert.match(code, /\[data-theme="2014"\] \.pc-range::-webkit-slider-thumb\s*\{[^}]*margin-top:\s*-3px/);
  assert.match(code, /\[data-theme="2021"\] \.pc-range::-webkit-slider-thumb\s*\{[^}]*margin-top:\s*-4px/);
  assert.match(code, /\[data-theme="2021"\] \.pc-range::-webkit-slider-runnable-track\s*\{[^}]*height:\s*4px/);
});

test('the base (2005) bar rules survive byte-meaningfully: blocky bevel intact', () => {
  const base = /\n\.pc-btn \{([\s\S]*?)\}/.exec(css);
  assert.ok(base, 'expected the base .pc-btn rule');
  assert.match(base[1], /border-radius:\s*0/, 'the 2005 blocky look is the base and must stay');
  assert.match(base[1], /inset 1px 1px 0 rgba\(255, 255, 255, 0\.5\)/, 'the outset bevel is the 2005 signature');
});

test('the seek/vol JS fill contract (--seek-fill/--vol-fill) is preserved in every era override', () => {
  // player.js drives the WebKit fill through these vars; an era override
  // that drops them would freeze the red bar at 0%/100% in that era only.
  const overrides = [...code.matchAll(/#(?:seek|vol)-bar::-webkit-slider-runnable-track\s*\{([^}]*)\}/g)];
  assert.ok(overrides.length >= 6, 'expected seek+vol overrides for all three skinned eras');
  for (const [, body] of overrides) {
    assert.match(body, /var\(--(?:seek|vol)-fill/, 'every era fill gradient must stay driven by the JS fill var');
  }
});
