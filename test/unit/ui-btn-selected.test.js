'use strict';

// [UNIT] v1.349: a pressed tonal button (Remote control, the Pop out buttons) must SHOW in every era and
// mode: ink on the tonal --fill-selected layered over the button's own ground, never red - the
// same recipe as the selected chip (ui-chip-selected.test.js). The ground is --surface-2 in every
// era except 2009, where it is the gloss (--btn-fill, a gradient), so the layer must sit OVER the
// gloss there. Both paints are resolved from tokens.css per era x mode, the way the cascade
// composites them, and must differ by a visible step; a gradient is checked at both stops.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { eraBlock, cssRules, readUiCss, readStyleCss } = require('./../helpers/stylesheets.js');

const ERAS = ['2021', '2014', '2009', '2005'];
const MODES = ['light', 'dark'];
const MIN_STEP = 12; // the largest channel step between ON and OFF, 0-255

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

test('the pressed tonal button layers --fill-selected (over the 2009 gloss), keeps its weight, and is never red', () => {
  const all = cssRules(readUiCss());
  const on = all.find((r) => r.sel === '.ui-btn--tonal[aria-pressed="true"]');
  assert.ok(on, 'the pressed tonal rule');
  assert.match(on.body, /background-image:\s*linear-gradient\(var\(--fill-selected\), var\(--fill-selected\)\)/, 'layered');
  assert.doesNotMatch(on.body, /font-weight/, 'pressing must not change the weight (the button would grow: 2014 Pop out shifted 3.8px)');
  const gloss = all.find((r) => r.sel === '[data-theme="2009"] .ui-btn--tonal[aria-pressed="true"]');
  assert.ok(gloss, 'the 2009 rule exists');
  assert.match(gloss.body, /background-image:\s*linear-gradient\(var\(--fill-selected\), var\(--fill-selected\)\),\s*var\(--btn-fill\)/, 'selected layer FIRST (on top), gloss under it');
  const pressed = rules().filter((r) => /\.ui-btn--tonal/.test(r.sel) && /aria-pressed="true"/.test(r.sel));
  assert.ok(pressed.length >= 2, 'precondition: the pressed tonal rules were found');
  for (const r of pressed) {
    assert.doesNotMatch(r.body, /--accent|--yt-red|--danger/, r.sel + ' is never red');
    assert.doesNotMatch(r.body, /background(?:-color)?\s*:\s*var\(--fill-selected\)/, r.sel + ' layers, never swaps the ground');
  }
});

for (const era of ERAS) {
  for (const mode of MODES) {
    test(`ON shows: a pressed tonal button is at least ${MIN_STEP} levels off an unpressed one - ${era} ${mode}`, () => {
      const fill = rgba(tokenOf(era, mode, '--fill-selected'));
      const grounds = groundsOf(era, mode);
      if (era === '2009') assert.ok(grounds.length >= 2, 'the 2009 gloss gradient resolves to its stops');
      assert.ok(fill && grounds.length && grounds.every(Boolean), 'precondition: tokens resolve (' + era + ' ' + mode + ')');
      for (const ground of grounds) {
        const step = Math.max(...over(fill, ground).map((c, i) => Math.abs(c - ground[i])));
        assert.ok(step >= MIN_STEP, `${era} ${mode}: the ON button is ${step.toFixed(1)} levels off the OFF button (need ${MIN_STEP})`);
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
