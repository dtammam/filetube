'use strict';

// [UNIT] UI pass S7 (D8.8; the v1.284.1 class): a selected / ON filter chip must SHOW in every era
// and mode - ink on the tonal --fill-selected, never red. v1.284.1's bug was an ON state painted
// under the 2009 gloss and invisible there; the chip's first cut SWAPPED its --surface-2 ground for
// the translucent fill, which composited over the page and came out within 4 levels of the
// unselected chip in 2009 light. The rule now LAYERS the fill over the chip's own ground. This test
// resolves both paints from tokens.css per era x mode, the way the cascade composites them, and
// requires a visible step; it also requires that no era rule re-grounds a chip (a gloss or a
// background shorthand would hide the layer again). The Music Loop / Autoplay toggles are these
// chips (music-playback-modes.test.js binds that).

const { test } = require('node:test');
const assert = require('node:assert');
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

test('the selected chip layers --fill-selected OVER its own ground (never swaps it), and no rule re-grounds a chip', () => {
  const rules = cssRules(readUiCss());
  const on = rules.find((r) => r.sel === '.ui-chip--filter[aria-pressed="true"]');
  assert.ok(on, 'the selected chip rule');
  assert.match(on.body, /background-image:\s*linear-gradient\(var\(--fill-selected\), var\(--fill-selected\)\)/, 'layered');
  assert.doesNotMatch(on.body, /background(?:-color)?\s*:\s*var\(--fill-selected\)/, 'not swapped for the ground');
  assert.doesNotMatch(on.body, /--accent|--yt-red/, 'never red');
  const base = rules.find((r) => r.sel === '.ui-chip--filter');
  assert.match(base.body, /background-color:\s*var\(--surface-2\)/, 'the ground the layer sits on');
  // nothing - an era gloss, a toolbar recipe - repaints a chip's background (it would hide the layer)
  const all = cssRules(readUiCss()).concat(cssRules(readStyleCss()));
  const regrounds = all.filter((r) => /ui-chip--filter|music-mode-btn/.test(r.sel) && r.sel !== on.sel && r.sel !== base.sel
    && /(?:^|[;\s])background(?:-image)?\s*:/.test(r.body));
  assert.deepStrictEqual(regrounds.map((r) => r.sel), [], 'no other rule sets a chip\'s background / background-image');
});

for (const era of ERAS) {
  for (const mode of MODES) {
    test(`ON shows: a selected chip is at least ${MIN_STEP} levels off an unselected one - ${era} ${mode}`, () => {
      const ground = rgba(tokenOf(era, mode, '--surface-2'));
      const fill = rgba(tokenOf(era, mode, '--fill-selected'));
      assert.ok(ground && fill, 'precondition: both tokens resolve (' + era + ' ' + mode + ')');
      const onPaint = over(fill, ground);
      const step = Math.max(...onPaint.map((c, i) => Math.abs(c - ground[i])));
      assert.ok(step >= MIN_STEP, `${era} ${mode}: the ON chip is ${step.toFixed(1)} levels off the OFF chip (need ${MIN_STEP})`);
    });
  }
}
