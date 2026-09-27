'use strict';

// v1.340 (Dean, 2026-09-26: "notify button shifts unreasonably - should be stable"): the
// stable-width two-state label (common.js stableToggleLabelHtml) and the CSS that makes it
// stable. Gate r1 W1: every one of these rules could be deleted with the suite green (only the
// manual scripts/channel-row-probe.js saw it) - so each is locked here by value.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const COMMON_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');
const { stableToggleLabelHtml, CHROME_ICON_SVG } = require('../../public/js/common.js');

// The ONE top-level rule for a selector, as { prop: value } (whitespace-normalized).
function decls(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  const found = [...CSS.matchAll(new RegExp('(^|[}\\s])' + esc + '\\s*\\{([^}]*)\\}', 'g'))];
  assert.strictEqual(found.length, 1, `exactly one rule for ${selector}`);
  const out = {};
  for (const d of found[0][2].split(';')) {
    const i = d.indexOf(':');
    if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim().replace(/\s+/g, ' ');
  }
  return out;
}

test('W1: every label shares ONE grid cell (the button is as wide as its longest label)', () => {
  assert.strictEqual(decls('.btn-label-stack').display, 'inline-grid');
  assert.strictEqual(decls('.btn-label-slot')['grid-area'], '1 / 1');
});

test('W1: only the current label is visible (the idle ones keep their width, and leave the accessible name)', () => {
  assert.strictEqual(decls('.btn-label-slot[data-idle]').visibility, 'hidden');
});

test('W1/W2: the row stays level - the stacked buttons middle-align, and a glyph never grows its line', () => {
  assert.strictEqual(decls('.btn:has(> .btn-label-stack)')['vertical-align'], 'middle');
  const g = decls('.btn .btn-glyph');
  assert.strictEqual(g.margin, '-0.2em 0.3em -0.2em 0', 'negative block margins keep the glyph inside the text line');
  assert.strictEqual(decls('.btn .btn-glyph-after').margin, '-0.2em 0 -0.2em 0.3em');
});

test('stableToggleLabelHtml: every label laid out, the current one named and visible, the rest idle', () => {
  const html = stableToggleLabelHtml('B', ['A', 'B']);
  assert.strictEqual(html, '<span class="btn-label-stack" data-label="B"><span class="btn-label-slot" data-idle>A</span><span class="btn-label-slot">B</span></span>');
});

test('stableToggleLabelHtml: a glyph sits INSIDE its slot, before the words or after them', () => {
  const html = stableToggleLabelHtml('On', ['On', 'Off'], { On: 'bell', Off: { name: 'bellOff', after: true } });
  assert.ok(html.includes('<span class="btn-label-slot"><svg class="chrome-icon btn-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="' + CHROME_ICON_SVG.bell.d + '"/></svg>On</span>'));
  assert.ok(html.includes('<span class="btn-label-slot" data-idle>Off<svg class="chrome-icon btn-glyph btn-glyph-after" viewBox="0 0 24 24" aria-hidden="true"><path d="' + CHROME_ICON_SVG.bellOff.d + '"/></svg></span>'));
});

test('stableToggleLabelHtml: labels are escaped (the call sites pass literals; this is the belt)', () => {
  const html = stableToggleLabelHtml('<b>"x"&', ['<b>"x"&']);
  assert.ok(!/<b>/.test(html));
  assert.ok(html.includes('data-label="&lt;b&gt;&quot;x&quot;&amp;"'));
});

test('the header bell draws the SHARED bell path (one glyph everywhere, not a private copy)', () => {
  assert.match(COMMON_SRC, /bellPath\.setAttribute\('d', CHROME_ICON_SVG\.bell\.d\)/);
  assert.ok(!COMMON_SRC.includes("bellPath.setAttribute('d', 'M"), 'no literal path left on the header bell');
});
