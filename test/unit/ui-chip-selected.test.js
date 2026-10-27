'use strict';

// [UNIT] v1.396.0 (Dean, 2026-10-27): a toggle pill that is ON must read ON. v1.349's ON was
// --fill-selected (a 16% / 32% grey) LAYERED over the pill's own --surface-2: three shades of one grey
// with hover. ON is now INVERTED: the ground is --ink-1 and the ink --surface-1 (never red: the D2.1
// role rule), in every era and mode. This test resolves the paints from tokens.css per era x mode and
// requires a LARGE step from the OFF ground, that no rule re-grounds a chip behind the inversion's back,
// that hover / press keep the inverted ground (they set background-color at equal specificity and would
// otherwise undo ON), and that the pill does not change its weight (width). The Music Loop / Shuffle /
// Autoplay toggles are these chips (music-playback-modes.test.js binds that); the toggle BUTTONS opt in
// by .ui-btn--toggle (ui-btn-selected.test.js).

const { test } = require('node:test');
const assert = require('node:assert');
const { eraBlock, cssRules, readUiCss, readStyleCss } = require('./../helpers/stylesheets.js');

const ERAS = ['2021', '2014', '2009', '2005'];
const MODES = ['light', 'dark'];
const MIN_STEP = 128; // the largest channel step between the ON ground (--ink-1) and the OFF ground, 0-255

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

const norm = (sel) => sel.replace(/\s+/g, ' ').trim();

test('the ON chip is the inverted ground (never red, never a weight change), and hover / press keep it', () => {
  const rules = cssRules(readUiCss());
  const on = rules.find((r) => norm(r.sel) === '.ui-chip--filter[aria-pressed="true"], .ui-btn--toggle[aria-pressed="true"]');
  assert.ok(on, 'the ON rule covers the chip AND the toggle button');
  assert.match(on.body, /background-color:\s*var\(--ink-1\)/, 'the ground is --ink-1');
  assert.match(on.body, /background-image:\s*none/, 'any layered fill is cleared');
  assert.match(on.body, /(?:^|[;\s])color:\s*var\(--surface-1\)/, 'the ink is --surface-1');
  assert.doesNotMatch(on.body, /--accent|--yt-red|--danger/, 'never red');
  assert.doesNotMatch(on.body, /font-weight/, 'pressing must not change the weight (the chip would grow 3px: measured in 2014 / 2009 / 2005)');
  const press = rules.find((r) => norm(r.sel) === '.ui-chip--filter[aria-pressed="true"]:active');
  const hover = rules.find((r) => norm(r.sel) === '.ui-chip--filter[aria-pressed="true"]:hover');
  assert.ok(press && hover, 'an ON chip has its own press and hover rules');
  assert.match(press.body, /background-color:\s*var\(--ink-1\)[\s\S]*background-image:\s*linear-gradient\(var\(--tint-press\), var\(--tint-press\)\)/, 'press layers the tint over the inverted ground');
  assert.match(hover.body, /background-color:\s*var\(--ink-1\)[\s\S]*background-image:\s*linear-gradient\(var\(--tint-hover\), var\(--tint-hover\)\)/, 'hover layers the tint over the inverted ground');
  assert.match(hover.at, /hover:\s*hover/, 'hover is gated on a hover-capable pointer');
  // the plain hover / press (.ui-chip--filter:hover, 0,2,0) come LATER in the file, so the ON ones win on
  // specificity (attribute + pseudo-class, 0,3,0) - not on order. Mutating the attribute out of them goes red here.
  assert.match(hover.sel, /\[aria-pressed="true"\]:hover/);
  assert.match(press.sel, /\[aria-pressed="true"\]:active/);
  const base = rules.find((r) => r.sel === '.ui-chip--filter');
  assert.match(base.body, /background-color:\s*var\(--surface-2\)/, 'the OFF ground');
  // nothing - an era gloss, a toolbar recipe - repaints a chip's background (it would hide the inversion)
  const allowed = new Set([norm(on.sel), norm(press.sel), norm(hover.sel), base.sel, '.ui-chip--filter:active', '.ui-chip--filter:hover']);
  const all = cssRules(readUiCss()).concat(cssRules(readStyleCss()));
  const regrounds = all.filter((r) => /ui-chip--filter|music-mode-btn/.test(r.sel) && !allowed.has(norm(r.sel))
    && /(?:^|[;\s])background(?:-image|-color)?\s*:/.test(r.body));
  // the one sanctioned exception: the phone Sticker sheet keeps its own ON look (v1.388.0)
  // R4 / the toggle buttons: no stylesheet rule may re-weight, re-pad or repaint a PRESSED chip or toggle button
  // (a pressed font-weight grew the chips 3.06px; a repaint under white ink is unreadable) - the Sticker sheet
  // exemption is the one sanctioned scope.
  const pressedRules = all.filter((r) => /aria-pressed="true"/.test(r.sel) && /ui-chip--filter|music-mode-btn|ui-btn--toggle|music-remote-btn|music-popout-btn|podcast-popout-btn/.test(r.sel) && !/^\.mms-ss-root /.test(norm(r.sel)));
  assert.ok(pressedRules.length >= 3, 'precondition: the pressed chip / toggle rules were found');
  for (const r of pressedRules) assert.doesNotMatch(r.body, /font-weight|(?:^|[;\s])padding|letter-spacing/, norm(r.sel) + ' must not change the pill\'s width');
  const toggleRepaints = all.filter((r) => !/:not\(\.ui-btn--toggle\)/.test(r.sel) && /ui-btn--toggle|music-remote-btn|music-popout-btn|podcast-popout-btn/.test(r.sel) && /aria-pressed="true"/.test(r.sel)
    && /(?:^|[;\s])background(?:-image|-color)?\s*:/.test(r.body) && norm(r.sel) !== norm(on.sel) && norm(r.sel) !== '[data-theme="2009"] .ui-btn--toggle[aria-pressed="true"]');
  assert.deepStrictEqual(toggleRepaints.map((r) => norm(r.sel)), [], 'no other rule repaints an ON toggle button');
  assert.deepStrictEqual(regrounds.map((r) => norm(r.sel)).filter((s) => !/^\.mms-ss-root \.ui-chip--filter\[aria-pressed="true"\](:active|:hover)?$/.test(s)), [], 'no other rule sets a chip\'s background');
});

test('the Sticker sheet skin keeps its own ON look, scoped to .mms-ss-root', () => {
  const rules = cssRules(readStyleCss());
  const sheet = rules.find((r) => norm(r.sel) === '.mms-ss-root .ui-chip--filter[aria-pressed="true"]');
  assert.ok(sheet, 'the exemption exists');
  assert.match(sheet.body, /background-color:\s*var\(--surface-2\)/, 'the OFF ground is restored');
  assert.match(sheet.body, /background-image:\s*linear-gradient\(var\(--fill-selected\), var\(--fill-selected\)\)/, 'the layered fill is restored');
  assert.match(sheet.body, /color:\s*var\(--sticker-accent\)/, 'accent ink');
});

for (const era of ERAS) {
  for (const mode of MODES) {
    test(`ON shows: the inverted ON chip is at least ${MIN_STEP} levels off the OFF chip, with AA ink - ${era} ${mode}`, () => {
      const off = rgba(tokenOf(era, mode, '--surface-2'));
      const ground = rgba(tokenOf(era, mode, '--ink-1'));
      const ink = rgba(tokenOf(era, mode, '--surface-1'));
      assert.ok(off && ground && ink, 'precondition: the tokens resolve (' + era + ' ' + mode + ')');
      const step = Math.max(...ground.slice(0, 3).map((c, i) => Math.abs(c - off[i])));
      assert.ok(step >= MIN_STEP, `${era} ${mode}: the ON chip is ${step.toFixed(1)} levels off the OFF chip (need ${MIN_STEP})`);
      const lum = (c) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      for (const [name, tint] of [['rest', null], ['hover', '--tint-hover'], ['press', '--tint-press']]) {
        const g = tint ? over(rgba(tokenOf(era, mode, tint)), ground) : ground;
        const [hi, lo] = [lum(g), lum(ink)].sort((a, b) => b - a);
        const cr = (hi + 0.05) / (lo + 0.05);
        assert.ok(cr >= 4.5, `${era} ${mode}: ON ${name} ink contrast ${cr.toFixed(2)} < 4.5`);
      }
    });
  }
}
