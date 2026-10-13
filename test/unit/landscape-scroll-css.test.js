'use strict';

// [UNIT] v1.390.0 D1 (plan 2026-10-13-landscape-scroll): a phone held sideways gets a SHORTER inline watch player
// (about 70% of the screen height, 16:9, centered), so the title peeks under it and the page has room to scroll.
// jsdom cannot measure the cascade, so this binds the rules by source (comments stripped, rules parsed with exact
// selectors, LESSONS 3); the numbers themselves come from tools/landscape-scroll-proof/probe-geometry.js (Evidence).

const { test } = require('node:test');
const assert = require('node:assert');
const { cssRules, readStyleCss, readTokensCss } = require('../helpers/stylesheets');

const rules = cssRules(readStyleCss());
const tokens = readTokensCss().replace(/\/\*[\s\S]*?\*\//g, '');

const WRAP = 'html.is-phone .watch-container #player-slot #player-wrapper:not(.audio-expanded):not(.css-fullscreen):not(:fullscreen)';
const NATIVE = 'html.is-phone .watch-container #player-slot #player-wrapper.native-controls:not(.audio-expanded):not(.css-fullscreen):not(:fullscreen)';
const only = (sel, at) => {
  const hit = rules.filter((r) => r.sel === sel && (at === undefined || r.at === at));
  assert.strictEqual(hit.length, 1, 'exactly one rule for ' + sel + (at ? ' in ' + at : '') + ' (found ' + hit.length + ')');
  return hit[0];
};
const decls = (r, prop) => r.body.split(';').map((d) => d.trim()).filter((d) => d.startsWith(prop + ':')).map((d) => d.slice(prop.length + 1).trim());

const LAND = '@media (orientation: landscape)';
const NARROW = '@media (max-width: 768px) and (orientation: landscape)';

test('D1 tokens: the share of the screen height and the three strips live in tokens.css', () => {
  assert.match(tokens, /--ls-player-frac:\s*0\.7;/);
  assert.match(tokens, /--ls-bar-one:\s*42px;/);
  assert.match(tokens, /--ls-bar-two:\s*82px;/);
  assert.match(tokens, /--ls-bar-none:\s*2px;/);
});

test('D1 the strip tokens are the reserves the player really keeps (padding-bottom + the 2px border)', () => {
  const one = only('#player-wrapper:not(.audio-expanded)', '');
  const two = only('#player-slot #player-wrapper:not(.audio-expanded)', '@media (max-width: 768px)');
  assert.deepStrictEqual(decls(one, 'padding-bottom').map((v) => parseInt(v, 10)), [40]);
  assert.deepStrictEqual(decls(two, 'padding-bottom').map((v) => parseInt(v, 10)), [80]);
});

test('D1 the wrapper is 16:9 at the capped height, centered, with a vh fallback and a dvh twin; the media is capped at the same height', () => {
  const w = only(WRAP, LAND);
  const widths = decls(w, 'width');
  assert.strictEqual(widths.length, 2, 'a vh line then a dvh line');
  assert.match(widths[0], /^min\(100%, calc\(\(var\(--ls-player-frac\) \* 100vh - var\(--ls-bar\)\) \* 16 \/ 9 \+ var\(--ls-bar-none\)\)\)$/);
  assert.match(widths[1], /^min\(100%, calc\(\(var\(--ls-player-frac\) \* 100dvh - var\(--ls-bar\)\) \* 16 \/ 9 \+ var\(--ls-bar-none\)\)\)$/);
  assert.deepStrictEqual(decls(w, 'margin-inline'), ['auto']);
  assert.deepStrictEqual(decls(w, '--ls-bar'), ['var(--ls-bar-one)']);
  const m = only(WRAP + ' #media-player', LAND);
  assert.deepStrictEqual(decls(m, 'max-height'), ['calc(var(--ls-player-frac) * 100vh - var(--ls-bar))', 'calc(var(--ls-player-frac) * 100dvh - var(--ls-bar))']);
});

test('D1 the strip follows the bar: two rows at <=768px, none with native controls (both widths)', () => {
  assert.deepStrictEqual(decls(only(WRAP, NARROW), '--ls-bar'), ['var(--ls-bar-two)']);
  assert.deepStrictEqual(decls(only(NATIVE, LAND), '--ls-bar'), ['var(--ls-bar-none)']);
  assert.deepStrictEqual(decls(only(NATIVE, NARROW), '--ls-bar'), ['var(--ls-bar-none)'], 'the narrow strip rule must not override the native one');
  const nativeIdx = rules.findIndex((r) => r.sel === NATIVE && r.at === NARROW);
  const wrapIdx = rules.findIndex((r) => r.sel === WRAP && r.at === NARROW);
  assert.ok(nativeIdx > wrapIdx, 'the native-controls strip comes after the two-row strip (same specificity class: order decides)');
});

test('D1 the loading frame reserves the same box, so the mount does not jump', () => {
  const e = only('html.is-phone .watch-container #player-slot:empty', LAND);
  assert.deepStrictEqual(decls(e, 'width').length, 2);
  assert.ok(decls(e, 'width').every((v) => v.includes('var(--ls-bar-one)') && v.includes('16 / 9')));
  assert.deepStrictEqual(decls(e, 'margin-inline'), ['auto']);
  const n = only('html.is-phone .watch-container #player-slot:empty', NARROW);
  assert.ok(decls(n, 'width').every((v) => v.includes('var(--ls-bar-two)')));
});

test('D1 scope: every rule of the block is landscape-only, phone-only and watch-only (portrait, desktop, the dock are untouched)', () => {
  const mine = rules.filter((r) => /--ls-|\bls-player-frac/.test(r.body));
  assert.ok(mine.length >= 7, 'the block is found (' + mine.length + ' rules)');
  for (const r of mine) {
    assert.ok(/\(orientation: landscape\)/.test(r.at), r.sel + ' sits in a landscape query, not ' + JSON.stringify(r.at));
    assert.ok(r.sel.startsWith('html.is-phone .watch-container #player-slot'), r.sel + ' is scoped to the phone device class and the watch page slot');
    assert.ok(!/#player-dock|\.audio-expanded\)?\s*[,{]/.test(r.sel.replace(':not(.audio-expanded)', '')), r.sel + ' never reaches the dock');
  }
  for (const r of mine.filter((m) => /#player-wrapper/.test(m.sel))) {
    assert.ok(r.sel.includes(':not(.css-fullscreen)') && r.sel.includes(':not(:fullscreen)') && r.sel.includes(':not(.audio-expanded)'), r.sel + ' keeps the fullscreen and expanded exclusions');
  }
});

test('D1 the faux fullscreen still releases every cap with `max-height: none !important` (the dvh cap must not out-rank it)', () => {
  const fs = only('#player-wrapper.css-fullscreen', '');
  assert.deepStrictEqual(decls(fs, 'max-height'), ['none !important']);
  // the cap rules never name `.css-fullscreen` positively, so they cannot match it at all
  for (const r of rules.filter((m) => /--ls-player-frac/.test(m.body))) assert.ok(!/(^|[^(])\.css-fullscreen/.test(r.sel.replace(':not(.css-fullscreen)', '')), r.sel);
});
