'use strict';

// [UNIT] v1.15.1 hotfix (FIX-B): the "Shuffle again" and "Rescan Files"
// buttons on the home page previously both used .icon-refresh -- visually
// indistinguishable on mobile, where .btn-label collapses and only the icon
// remains. Shuffle now gets its own distinct .icon-shuffle glyph; Rescan
// keeps .icon-refresh.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'index.html');
const MAIN_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'main.js');
const { liveCss, beforeGlyphRules } = require('../helpers/icon-sets');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const mainJs = fs.readFileSync(MAIN_JS_PATH, 'utf8');

// UI pass sweep S2 (converts the v1.15.1 markup locks, AC12): the two tools are
// ui-btn icons drawing DISTINCT registry glyphs (shuffle vs refresh) - the v1.15.1
// bug was two identical glyphs side by side on a phone.
const toolButton = (id) => {
  const m = new RegExp(`<button[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`).exec(html);
  assert.ok(m, `expected to find the ${id} markup`);
  return m[0];
};

test('index.html: the shuffle-again tool draws the registry shuffle glyph, never refresh', () => {
  const b = toolButton('shuffle-again-btn');
  assert.match(b, /<use href="#i-shuffle"\/>/);
  assert.doesNotMatch(b, /i-refresh|icon-refresh/);
});

test('index.html: the shuffle-again tool keeps its accessible name', () => {
  assert.match(html, /id="shuffle-again-btn"[^>]*aria-label="Shuffle again"/);
});

test('index.html: the rescan tool draws the registry refresh glyph', () => {
  assert.match(toolButton('rescan-library-btn'), /<use href="#i-refresh"\/>/);
});

test('main.js: neither tool\'s markup is rewritten - the rescan busy state is aria-busy (the ui-btn spinner), never an innerHTML swap', () => {
  assert.doesNotMatch(mainJs, /shuffleAgainBtn\.innerHTML/, 'the shuffle button markup is static');
  assert.doesNotMatch(mainJs, /rescanBtn\.innerHTML/, 'the rescan glyph is never re-rendered');
  assert.match(mainJs, /function setRescanBusy\(on\) \{\s*rescanBtn\.disabled = !!on;[\s\S]{0,160}?u\.setBusy\(rescanBtn, !!on\)/);
});

// v1.25.4 fix: .icon-shuffle previously rendered as a fixed ::before unicode glyph (U+1F500)
// outside the icon-set system; it became a themed mask, then sweep S2 drew the home tool from
// the registry (`#i-shuffle`, the tests above). U+1F500 renders nowhere: no ::before glyph and no
// escape is left in any stylesheet.
test('no stylesheet paints the U+1F500 glyph', () => {
  const live = liveCss();
  assert.deepEqual(beforeGlyphRules(live, 'icon-shuffle').map((r) => r.sels.join(', ')), [], 'no rule paints a ::before glyph on .icon-shuffle');
  assert.doesNotMatch(live, /\\1F500/, 'no U+1F500 escape left in the stylesheets');
});

// Step 7 (UI pass, DELIBERATE conversion): the `.icon-shuffle` mask is RETIRED with its last
// consumer (the home Shuffle tool drew the registry glyph from sweep S2), so the lock on its three CSS sites became a lock that it is gone -
// and that nothing in the app still asks for it (a class with no rule renders an empty box).
test('step 7: the .icon-shuffle mask is retired - no rule, no consumer in public/ or lib/', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /\.icon-shuffle\b/, 'no sizing, mask or fill rule left');
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'assets' && e.name !== 'fonts') walk(q); } else if (/\.(js|html)$/.test(e.name)) files.push(q); } };
  walk(path.join(__dirname, '..', '..', 'public')); walk(path.join(__dirname, '..', '..', 'lib'));
  assert.ok(files.length > 20, 'the scan reached the tree');
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(code, /icon-shuffle\b/, path.basename(f) + ' asks for no .icon-shuffle');
  }
});

test('assets: shuffle.svg is bundled for all three vector icon sets (outlined/rounded/filled)', () => {
  const outlined = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'assets', 'icons', 'shuffle.svg'), 'utf8');
  const rounded = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'assets', 'icons', 'rounded', 'shuffle.svg'), 'utf8');
  const filled = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'assets', 'icons', 'filled', 'shuffle.svg'), 'utf8');
  for (const svg of [outlined, rounded, filled]) {
    assert.ok(svg.includes('<svg'), 'expected a valid <svg> document');
  }
});
