'use strict';

// [UNIT] v1.87.1 (Dean) - the first-paint chrome glyphs (bottom-nav + top-right
// header) are inline <svg> (chrome-icon), NOT `.icon-*` CSS masks.
//
// Why: a mask element shows NOTHING until its mask image is DECODED, so on a
// mobile PWA cold start the labels painted first and the glyphs "popped in" a
// beat later. The notification bell + queue never lagged because they are inline
// <svg> (they ride the text layer, no decode gate). v1.87.0 tried inlining the
// mask as a data-URI to kill the async fetch; on Dean's device the pop-in was
// UNCHANGED, proving the fetch was never the cause - the mask DECODE was. The
// fix: render these glyphs the way the bell/queue already do.
//
// This binds: (a) each map entry's path is the on-disk asset (rounded/ where it
// exists, else outlined) BYTE-FOR-BYTE - a drift or swapped asset goes red (the
// repo's "presence not binding" lesson: bind identity, not a weaker proxy);
// (b) the static bottom-nav markup in index.html is exactly chromeIconMarkup()
// output for each glyph, and carries NO `.icon-*` mask <i> anymore; (c) the
// builder produces a well-formed namespaced <svg>; (d) the JS build sites +
// main.js sort caret go through chromeIconEl (source-locked, comments stripped).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const ICON_DIR = path.join(REPO, 'public', 'assets', 'icons');
const COMMON = require.resolve('../../public/js/common.js');

// A fresh require of common.js with a jsdom document (for chromeIconEl).
function loadCommon() {
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  const c = require(COMMON); // boot is skipped (no document at require time)
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  return { c, dom };
}

const common = (() => { delete require.cache[COMMON]; return require(COMMON); })();
const { CHROME_ICON_SVG, chromeIconMarkup } = common;

// chrome-icon name -> on-disk asset basename (rounded/ preferred, outlined
// fallback for the four glyphs with no rounded variant on disk).
const NAME_ASSET = {
  home: 'home', liked: 'star', folder: 'folder', history: 'history',
  podcast: 'podcast', music: 'play_arrow', books: 'books', downloads: 'downloads',
  moon: 'dark_mode', sun: 'light_mode', cog: 'settings', search: 'search',
  download: 'download', caret: 'keyboard_arrow_down',
};

function assetSvg(asset) {
  const rounded = path.join(ICON_DIR, 'rounded', `${asset}.svg`);
  const p = fs.existsSync(rounded) ? rounded : path.join(ICON_DIR, `${asset}.svg`);
  return fs.readFileSync(p, 'utf8');
}

test('the map covers every chrome glyph exactly once and is well-formed', () => {
  assert.deepStrictEqual(
    Object.keys(CHROME_ICON_SVG).sort(),
    Object.keys(NAME_ASSET).sort(),
    'CHROME_ICON_SVG and the asset map must list the same glyphs');
  for (const [name, g] of Object.entries(CHROME_ICON_SVG)) {
    assert.match(g.vb, /^-?\d+ -?\d+ \d+ \d+$/, `${name}: a real viewBox`);
    assert.ok(g.d && g.d.length > 20, `${name}: a real path`);
  }
});

for (const [name, asset] of Object.entries(NAME_ASSET)) {
  test(`${name} path == on-disk ${asset}.svg BYTE-FOR-BYTE (right glyph, uncorrupted)`, () => {
    const svg = assetSvg(asset);
    const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1];
    const d = (svg.match(/<path d="([^"]+)"/) || [])[1];
    assert.strictEqual(CHROME_ICON_SVG[name].vb, vb, `${name} viewBox matches the asset`);
    assert.strictEqual(CHROME_ICON_SVG[name].d, d, `${name} path matches the asset byte-for-byte`);
  });
}

// The bottom-nav glyph roster (class -> chrome name), in nav order.
const BOTTOM_NAV_GLYPHS = ['home', 'liked', 'folder', 'history', 'podcast', 'music', 'books', 'downloads', 'moon', 'cog'];

// The bottom-nav is DUPLICATED per shell, so bind EVERY shell, not just index -
// the v1.87.1 slim gate caught that binding only index.html + only `liked`
// cross-shell left a hole: a single-glyph revert to a decode-lagging mask on any
// of the 8 non-index shells shipped green (the exact pop-in this wave prevents).
// This iterates every shell that carries a bottom-nav and asserts all 10 glyphs
// are the exact inline chromeIconMarkup output, with no `.icon-*` mask left.
const SHELLS = fs.readdirSync(path.join(REPO, 'public'))
  .filter((f) => f.endsWith('.html'))
  .filter((f) => fs.readFileSync(path.join(REPO, 'public', f), 'utf8').includes('<nav class="bottom-nav"'));

test('roster sanity: at least the 9 known shells carry a bottom-nav (guards the loop against going vacuous)', () => {
  assert.ok(SHELLS.length >= 9, `expected >=9 shells with a bottom-nav, found ${SHELLS.length}: ${SHELLS.join(', ')}`);
});

for (const shell of SHELLS) {
  test(`${shell}: every bottom-nav glyph is the inline chrome-icon <svg> (byte-exact), NO .icon-* mask`, () => {
    const html = fs.readFileSync(path.join(REPO, 'public', shell), 'utf8');
    const start = html.indexOf('<nav class="bottom-nav"');
    const block = html.slice(start, html.indexOf('</nav>', start));
    assert.ok(start > -1 && block, 'the bottom-nav block exists');
    // Each glyph is the exact chromeIconMarkup output (itself byte-bound to the
    // on-disk asset above), so no shell can drift from the shared source.
    for (const name of BOTTOM_NAV_GLYPHS) {
      assert.ok(block.includes(chromeIconMarkup(name)),
        `the bottom-nav ${name} item embeds the inline chrome-icon <svg>`);
    }
    assert.doesNotMatch(block, /<i class="icon-/,
      'no `.icon-*` mask <i> survives in the bottom-nav (a mask decode-lags -> pop-in)');
  });
}

test('chromeIconEl builds a namespaced <svg class="chrome-icon"> with the right path', () => {
  const { c, dom } = loadCommon();
  const el = c.chromeIconEl('search');
  assert.strictEqual(el.namespaceURI, 'http://www.w3.org/2000/svg', 'SVG namespace');
  assert.ok(el.getAttribute('class').split(' ').includes('chrome-icon'), 'chrome-icon class');
  assert.strictEqual(el.getAttribute('viewBox'), CHROME_ICON_SVG.search.vb);
  const p = el.querySelector('path');
  assert.strictEqual(p.getAttribute('d'), CHROME_ICON_SVG.search.d);
  // extra class is appended (used by the sort caret)
  const caret = c.chromeIconEl('caret', 'modern-sort-caret');
  assert.ok(caret.getAttribute('class').split(' ').includes('modern-sort-caret'));
  dom.window.close();
});

test('the JS build sites go through chromeIconEl, not an `.icon-*` mask <i> (source-lock, comments stripped)', () => {
  const src = fs.readFileSync(COMMON, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.match(src, /chromeIconEl\('search'\)/, 'the header search toggle uses chromeIconEl');
  assert.match(src, /chromeIconEl\('download'\)/, 'the one-off download button uses chromeIconEl');
  assert.match(src, /chromeIconEl\(dark \? 'sun' : 'moon'\)/, 'the nav theme item builds the inline svg for the current mode');
  assert.match(src, /icon\.replaceWith\(swapped\)/, 'and swaps the whole element (not a class)');
  // The one-off download button's old mask-<i> builder is gone (this exact
  // append pattern). NOTE: `icon-search`/`icon-download` masks survive ELSEWHERE
  // on purpose - the "no results" error-state search glyph and the sidebar
  // Library download entry are NOT first-paint chrome, so they stay masks.
  assert.doesNotMatch(src, /icon\.className = 'icon-download';\s*btn\.appendChild/, 'no leftover icon-download mask <i> builder in the one-off button');
});

test('main.js sort caret uses chromeIconEl (inline svg), not an icon-arrow-down mask', () => {
  const src = fs.readFileSync(path.join(REPO, 'public', 'js', 'main.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.match(src, /chromeIconEl\('caret', 'modern-sort-caret'\)/, 'the modern sort caret is an inline chrome-icon svg');
  assert.doesNotMatch(src, /className = 'icon-arrow-down modern-sort-caret'/, 'no leftover arrow-down mask caret');
});
