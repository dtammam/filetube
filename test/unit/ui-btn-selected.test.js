'use strict';

// [UNIT] v1.349 -> v1.396.0: a pressed tonal button must SHOW in every era and mode. The three TOGGLE
// buttons (Remote control, the Music and Podcasts Pop out buttons: .ui-btn--toggle) are INVERTED when
// ON - an --ink-1 ground with --surface-1 ink, never red, the 2009 gloss replaced (ui-chip-selected.test.js
// has the shared ON rule and the hover / press contract). A pressed tonal button that swaps a LABEL (feed
// Fit / Fill, Read the opening) is NOT an on/off state: it keeps the v1.349 look, ink on --fill-selected
// layered over its own ground, and must never get the inverted one (it would paint "Fit" black). Both are
// resolved from tokens.css per era x mode, the way the cascade composites them; a gradient is checked at
// both stops.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { eraBlock, cssRules, readUiCss, readStyleCss } = require('./../helpers/stylesheets.js');

const ERAS = ['2021', '2014', '2009', '2005'];
const MODES = ['light', 'dark'];
const MIN_STEP = 12; // a label-swap button: the largest channel step between ON and OFF, 0-255
const MIN_INVERTED_STEP = 128; // a toggle button: the ON ground (--ink-1) against the OFF ground

function tokenOf(era, mode, name) {
  const own = eraBlock(era, mode) || '';
  const m = new RegExp('(?:^|\\s|;)' + name.replace(/[-]/g, '\\-') + ':\\s*([^;]+);').exec(own);
  if (m) return m[1].trim();
  if (!(era === '2021' && mode === 'light')) return tokenOf('2021', 'light', name); // :root default
  return null;
}
function rgba(v) {
  const s = String(v).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1);
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 1 : Number(m[4])];
  return null;
}
const over = (top, under) => top.slice(0, 3).map((c, i) => c * top[3] + under[i] * (1 - top[3]));

// the colour(s) a tonal button's ground paints in an era: --btn-fill's stops in 2009, else --surface-2
function groundsOf(era, mode) {
  if (era !== '2009') return [rgba(tokenOf(era, mode, '--surface-2'))];
  const fill = tokenOf(era, mode, '--btn-fill');
  const stops = [...String(fill).matchAll(/#[0-9a-f]{3,6}\b/gi)].map((m) => rgba(m[0]));
  return stops.length ? stops : [rgba(fill)];
}

const rules = () => cssRules(readUiCss()).concat(cssRules(readStyleCss()));

const norm = (sel) => sel.replace(/\s+/g, ' ').trim();

test('a label-swap tonal button keeps the layered --fill-selected look (over the 2009 gloss), never the inverted one', () => {
  const all = cssRules(readUiCss());
  const on = all.find((r) => norm(r.sel) === '.ui-btn--tonal[aria-pressed="true"]:not(.ui-btn--toggle)');
  assert.ok(on, 'the pressed tonal rule excludes the toggle buttons');
  assert.match(on.body, /background-image:\s*linear-gradient\(var\(--fill-selected\), var\(--fill-selected\)\)/, 'layered');
  assert.doesNotMatch(on.body, /font-weight/, 'pressing must not change the weight (the button would grow: 2014 Pop out shifted 3.8px)');
  const gloss = all.find((r) => norm(r.sel) === '[data-theme="2009"] .ui-btn--tonal[aria-pressed="true"]:not(.ui-btn--toggle)');
  assert.ok(gloss, 'the 2009 rule exists');
  assert.match(gloss.body, /background-image:\s*linear-gradient\(var\(--fill-selected\), var\(--fill-selected\)\),\s*var\(--btn-fill\)/, 'selected layer FIRST (on top), gloss under it');
  const pressed = rules().filter((r) => /\.ui-btn--tonal/.test(r.sel) && /aria-pressed="true"/.test(r.sel));
  assert.ok(pressed.length >= 2, 'precondition: the pressed tonal rules were found');
  for (const r of pressed) {
    assert.doesNotMatch(r.body, /--accent|--yt-red|--danger/, r.sel + ' is never red');
    assert.doesNotMatch(r.body, /--ink-1/, r.sel + ' is not the inverted look (that is .ui-btn--toggle only)');
  }
});

test('a toggle button is inverted ON in every era, and 2009 drops the gloss for it', () => {
  const all = cssRules(readUiCss());
  const era = all.find((r) => norm(r.sel) === '[data-theme="2009"] .ui-btn--toggle[aria-pressed="true"]');
  assert.ok(era, 'the 2009 override exists');
  assert.match(era.body, /background:\s*var\(--ink-1\)/, 'a background SHORTHAND, so the gloss gradient is dropped with the layer');
  const glossed = all.find((r) => /^\[data-theme="2009"\] \.ui-btn--secondary, \[data-theme="2009"\] \.ui-btn--tonal$/.test(norm(r.sel)));
  assert.ok(glossed, 'the 2009 gloss rule');
  assert.ok(era.index > glossed.index, 'it comes after the gloss rule (equal-or-lower specificity must not matter)');
  const on = all.find((r) => /\.ui-btn--toggle\[aria-pressed="true"\]$/.test(norm(r.sel)) && /ui-chip--filter/.test(r.sel));
  assert.ok(on && /background-color:\s*var\(--ink-1\)/.test(on.body) && /color:\s*var\(--surface-1\)/.test(on.body), 'the shared inverted ON rule');
});

test('the toggle buttons carry .ui-btn--toggle and a check glyph; a label swap does not', () => {
  const root = path.join(__dirname, '..', '..', 'public');
  const music = fs.readFileSync(path.join(root, 'music.html'), 'utf8');
  const podcasts = fs.readFileSync(path.join(root, 'podcasts.html'), 'utf8');
  const btn = (html, id) => new RegExp('<button[^>]*id="' + id + '"[\\s\\S]*?</button>').exec(html)[0];
  for (const [html, id] of [[music, 'music-remote-btn'], [music, 'music-popout-btn'], [podcasts, 'podcast-popout-btn']]) {
    const b = btn(html, id);
    assert.match(b, /class="[^"]*\bui-btn--toggle\b/, id + ' opts in to the inverted ON look');
    assert.match(b, /<svg class="[^"]*\bui-toggle__off\b[^"]*"[^>]*><use href="#i-(?!check)[a-z_]+"\/><\/svg><svg class="[^"]*\bui-toggle__on\b[^"]*"[^>]*><use href="#i-check"\/><\/svg>/, id + ' has its glyph and the check in one box');
  }
  const feed = fs.readFileSync(path.join(root, 'js', 'feed.js'), 'utf8');
  assert.doesNotMatch(feed, /ui-btn--toggle/, 'feed.js label swaps (Fit / Fill, Read the opening) never opt in');
  const skin = fs.readFileSync(path.join(root, 'js', 'skin-surface.js'), 'utf8');
  assert.doesNotMatch(skin, /ui-btn--toggle/, 'the Sticker sheet tiles never opt in');
});

test('the check swaps in on aria-pressed alone (one state, so the glyph cannot go stale against the colour)', () => {
  const css = cssRules(readUiCss());
  const hideOn = css.find((r) => norm(r.sel) === '.ui-toggle__on');
  assert.ok(hideOn && /display:\s*none/.test(hideOn.body), 'the check is hidden by default');
  const hideOff = css.find((r) => /aria-pressed="true"\]\s*>\s*\.ui-toggle__off/.test(r.sel));
  const showOn = css.find((r) => /aria-pressed="true"\]\s*>\s*\.ui-toggle__on/.test(r.sel));
  assert.ok(hideOff && /display:\s*none/.test(hideOff.body), 'ON hides the glyph');
  assert.ok(showOn && /display:\s*block/.test(showOn.body), 'ON shows the check');
  assert.ok(/\.ui-btn__icon\s*>\s*\.ui-toggle__on/.test(showOn.sel) && /\.ui-btn__icon\s*>\s*\.ui-toggle__off/.test(hideOff.sel), 'both the chip (bare svg) and the button (.ui-btn__icon) shapes');
});

for (const era of ERAS) {
  for (const mode of MODES) {
    test(`ON shows: a label-swap button is at least ${MIN_STEP} levels off, a toggle button ${MIN_INVERTED_STEP} - ${era} ${mode}`, () => {
      const fill = rgba(tokenOf(era, mode, '--fill-selected'));
      const grounds = groundsOf(era, mode);
      if (era === '2009') assert.ok(grounds.length >= 2, 'the 2009 gloss gradient resolves to its stops');
      assert.ok(fill && grounds.length && grounds.every(Boolean), 'precondition: tokens resolve (' + era + ' ' + mode + ')');
      const inkGround = rgba(tokenOf(era, mode, '--ink-1'));
      for (const ground of grounds) {
        const step = Math.max(...over(fill, ground).map((c, i) => Math.abs(c - ground[i])));
        assert.ok(step >= MIN_STEP, `${era} ${mode}: the ON swap button is ${step.toFixed(1)} levels off the OFF button (need ${MIN_STEP})`);
        const inv = Math.max(...inkGround.slice(0, 3).map((c, i) => Math.abs(c - ground[i])));
        assert.ok(inv >= MIN_INVERTED_STEP, `${era} ${mode}: the ON toggle button is ${inv.toFixed(1)} levels off the OFF button (need ${MIN_INVERTED_STEP})`);
      }
    });
  }
}

test('the Remote control label holds both wordings in one cell, so the width is the same pressed and unpressed', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'music.html'), 'utf8');
  const btn = /<button[^>]*id="music-remote-btn"[\s\S]*?<\/button>/.exec(html)[0];
  assert.match(btn, /<span class="ui-btn__label ui-btn__label--swap"><span class="ui-btn__swap-off">Remote control<\/span><span class="ui-btn__swap-on">Remote control: On<\/span><\/span>/);
  assert.match(btn, /aria-label="Remote control"/, 'aria-pressed carries the state; the name stays');
  const css = readUiCss();
  assert.match(css, /\.ui-btn__label--swap\s*\{\s*display:\s*inline-grid;\s*\}/, 'a grid');
  assert.match(css, /\.ui-btn__label--swap > span\s*\{\s*grid-area:\s*1 \/ 1;\s*\}/, 'both in one cell');
  const onRule = cssRules(css).find((r) => r.sel === '.ui-btn__swap-on');
  assert.ok(onRule && /font-weight:\s*var\(--fw-semibold\)/.test(onRule.body), 'the On wording is always sized at the pressed weight (measured: 2014 grew 9px without it)');
  // the unseen one is visibility:hidden (keeps its size), never display:none (would change the width)
  const hide = cssRules(css).find((r) => /ui-btn__swap-on/.test(r.sel) && /ui-btn__swap-off/.test(r.sel));
  assert.ok(hide, 'the swap rule');
  assert.match(hide.body, /visibility:\s*hidden/);
  assert.doesNotMatch(hide.body, /display\s*:/);
  assert.match(hide.sel, /\[aria-pressed="false"\][^,]*swap-on/, 'off hides the On wording');
  assert.match(hide.sel, /\[aria-pressed="true"\][^,]*swap-off/, 'on hides the Off wording');
});
