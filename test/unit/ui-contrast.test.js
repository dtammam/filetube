'use strict';

// [UNIT] UI professionalism pass, AC8 (plan D2.1): every text/background token pair a
// primitive uses meets WCAG AA - 4.5:1 for text, 3:1 for non-text (indicators, focus
// rings, filled controls) - in every era and mode. Values are resolved from
// public/css/tokens.css the way the cascade does on <html>: :root (Modern light), then
// the era's light block, then its dark block, with var() references followed.
// Translucent fills (--fill-selected) are composited over the surface they sit on.
//
// Deliberately NOT in the table (and why):
// - --ink-2/--ink-3 on --surface-2: secondary text does not sit on tonal fills (chips,
//   inputs and tonal buttons carry ink-1); 2014 light's era-authentic #757575 on
//   #f5f5f5 is 4.2:1, so a primitive that ever puts secondary text there must add it here.
// - --outline: the 1px border of a secondary button. The label and the 44px box identify
//   the control, so WCAG 1.4.11 does not require the border itself to reach 3:1 (the
//   iOS separator grey does not either).
// - --progress: drawn over video frames and thumbnails, not a token surface.

const { test } = require('node:test');
const assert = require('node:assert');
const { eraBlock, readTokensCss } = require('../helpers/stylesheets');

function decls(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function resolved(era, mode) {
  const map = { ...decls(eraBlock('2021')) };
  if (era !== '2021') Object.assign(map, decls(eraBlock(era)));
  if (mode === 'dark') {
    // the every-era dark block (the inverted toast), then the era's own dark block
    const css = readTokensCss().replace(/\/\*[\s\S]*?\*\//g, '');
    const i = css.indexOf(':root[data-mode="dark"] {');
    assert.ok(i !== -1, 'the every-era dark block exists');
    Object.assign(map, decls(css.slice(i, css.indexOf('}', i))));
    Object.assign(map, decls(eraBlock(era, 'dark')));
  }
  const get = (name, depth = 0) => {
    assert.ok(depth < 8, `var() cycle at ${name}`);
    const v = map[name];
    assert.ok(v !== undefined, `${era} ${mode}: ${name} is undefined`);
    const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v);
    return ref ? get(ref[1], depth + 1) : v;
  };
  return get;
}

function parseColor(v) {
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(v);
  assert.ok(m, `not a colour: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
function luminance([r, g, b]) {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['--surface-0', '--surface-1', '--surface-overlay'];
// [foreground, background, minimum, background-composited-over (for a translucent bg)]
const PAIRS = [
  ...['--surface-0', '--surface-1', '--surface-2', '--surface-overlay'].map((bg) => ['--ink-1', bg, 4.5]),
  ...SURFACES.flatMap((bg) => ['--ink-2', '--ink-3', '--accent', '--danger'].map((fg) => [fg, bg, 4.5])),
  ['--ink-link', '--surface-0', 4.5], ['--ink-link', '--surface-1', 4.5],
  ['--ink-on-accent', '--accent-fill', 4.5],
  ['--ink-1', '--fill-selected', 4.5, '--surface-0'], ['--ink-1', '--fill-selected', 4.5, '--surface-1'],
  // non-text: the unread dot / count badge, the focus ring, a filled primary button's shape
  ...SURFACES.map((bg) => ['--indicator', bg, 3]),
  ['--focus-ring', '--surface-0', 3], ['--focus-ring', '--surface-1', 3],
  ['--accent-fill', '--surface-0', 3], ['--accent-fill', '--surface-1', 3],
  // step 3 primitives: monogram initials on every avatar tone; the inverted toast
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ['--ink-on-accent', `--av-tone-${n}`, 4.5]),
  ['--toast-ink', '--toast-ground', 4.5],
];

for (const era of ['2005', '2009', '2014', '2021']) {
  for (const mode of ['light', 'dark']) {
    test(`WCAG AA: every primitive token pair in ${era} ${mode}`, () => {
      const get = resolved(era, mode);
      const fails = [];
      for (const [fg, bg, min, base] of PAIRS) {
        let b = parseColor(get(bg));
        if (base) b = over(b, parseColor(get(base)));
        else assert.equal(b[3], 1, `${bg} must be opaque to be a text ground`);
        const f = over(parseColor(get(fg)), b);
        const r = ratio(f, b);
        if (r < min) fails.push(`${fg} on ${bg}${base ? ` over ${base}` : ''}: ${r.toFixed(2)} < ${min}`);
      }
      assert.deepStrictEqual(fails, []);
    });
  }
}

test('the checker itself: known ratios (black/white 21, #777 on white ~4.48)', () => {
  assert.equal(ratio(parseColor('#000000'), parseColor('#ffffff')).toFixed(1), '21.0');
  const grey = ratio(parseColor('#777777'), parseColor('#ffffff'));
  assert.ok(grey > 4.4 && grey < 4.5, `#777 on white is just under AA (${grey})`);
});
