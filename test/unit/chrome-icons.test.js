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
// UI professionalism pass step 2 (DELIBERATE lock update): the glyphs are still inline
// <svg> (they still ride the text layer), but each draws a <symbol> from the icon
// registry's sprite (public/js/icons.js) via <use href="#i-NAME">, injected by the first
// script in <body>. The path-identity binding moved with the paths: icons-registry.test.js
// binds every registry entry to its Material Symbols source byte-for-byte. This file binds:
// (a) each chrome name to its registry icon (the glyph IDENTITY - a swapped name goes red);
// (b) the static bottom-nav + sidebar markup in every shell is exactly chromeIconMarkup()
// output, with NO `.icon-*` mask <i>; (c) the builder makes a namespaced <svg><use>;
// (d) the JS build sites + main.js sort caret go through chromeIconEl (source-locked).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
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
const { CHROME_ICON, chromeIconMarkup, uiIconMarkup } = common;
const FTIcons = require('../../public/js/icons.js');

// chrome name -> registry icon. Pinned whole: a glyph swap is a visible change and must be
// deliberate. (Step 2 changes, from the pre-registry assets: music play_arrow -> music_note,
// the Subs tab refresh -> subscriptions, podcast -> podcasts (the whole glyph: the old map
// kept 1 of its asset's 3 paths, F29), books -> menu_book, downloads -> smart_display, caret keyboard_arrow_down -> expand_more,
// queue -> playlist_play, heart -> favorite.)
const EXPECTED = {
  home: 'home', liked: 'star', folder: 'folder', history: 'history', podcast: 'podcasts',
  music: 'music_note', books: 'menu_book', downloads: 'smart_display', moon: 'dark_mode',
  sun: 'light_mode', cog: 'settings', search: 'search', download: 'download', caret: 'expand_more',
  queue: 'playlist_play', heart: 'favorite', delete: 'delete', menu: 'menu', star: 'star',
  refresh: 'subscriptions', bell: 'notifications', bellOff: 'notifications_off', starFilled: 'star.fill',
};

test('the map binds every chrome glyph to its registry icon, and every one exists', () => {
  assert.deepStrictEqual(CHROME_ICON, EXPECTED);
  for (const [name, reg] of Object.entries(CHROME_ICON)) assert.ok(FTIcons.has(reg), `${name} -> ${reg} is in the registry`);
});

test('chromeIconMarkup is <svg class="chrome-icon"><use href="#i-..."/></svg> (no path of its own)', () => {
  assert.strictEqual(chromeIconMarkup('search'), '<svg class="chrome-icon" aria-hidden="true"><use href="#i-search"/></svg>');
  assert.strictEqual(chromeIconMarkup('starFilled', 'btn-glyph'), '<svg class="chrome-icon btn-glyph" aria-hidden="true"><use href="#i-star-fill"/></svg>');
  assert.strictEqual(chromeIconMarkup('nope'), '');
});

// The bottom-nav glyph roster (class -> chrome name), in nav order.
const BOTTOM_NAV_GLYPHS = ['home', 'liked', 'folder', 'history', 'podcast', 'music', 'books', 'downloads', 'moon', 'cog'];

// The bottom-nav is DUPLICATED per shell, so bind EVERY shell, not just index -
// the v1.87.1 slim gate caught that binding only index.html + only `liked`
// cross-shell left a hole: a single-glyph revert to a decode-lagging mask on any
// of the 8 non-index shells shipped green (the exact pop-in this wave prevents).
// This iterates every shell that carries a bottom-nav and asserts all 10 glyphs
// are the exact inline sprite markup, with no `.icon-*` mask left.
// Sweep S1 (DELIBERATE lock update, F49): a tab is a ui-btn stack, so its glyph is the
// ui.icon markup at the tab size (uiIconMarkup(registry name, 'lg'), a ui-icon--lg in the
// fixed 24px icon slot), still a sprite <use> that paints with the text.
const SHELLS = fs.readdirSync(path.join(REPO, 'public'))
  .filter((f) => f.endsWith('.html'))
  .filter((f) => fs.readFileSync(path.join(REPO, 'public', f), 'utf8').includes('<nav class="bottom-nav"'));

test('roster sanity: at least the 9 known shells carry a bottom-nav (guards the loop against going vacuous)', () => {
  assert.ok(SHELLS.length >= 9, `expected >=9 shells with a bottom-nav, found ${SHELLS.length}: ${SHELLS.join(', ')}`);
});

for (const shell of SHELLS) {
  test(`${shell}: every bottom-nav glyph is the inline sprite ui-icon <svg> in the tab's icon slot (byte-exact), NO .icon-* mask`, () => {
    const html = fs.readFileSync(path.join(REPO, 'public', shell), 'utf8');
    const start = html.indexOf('<nav class="bottom-nav"');
    const block = html.slice(start, html.indexOf('</nav>', start));
    assert.ok(start > -1 && block, 'the bottom-nav block exists');
    // Each glyph is the exact chromeIconMarkup output (the registry binds the path),
    // so no shell can drift from the shared source.
    for (const name of BOTTOM_NAV_GLYPHS) {
      assert.ok(block.includes('<span class="ui-btn__icon">' + uiIconMarkup(CHROME_ICON[name], 'lg') + '</span>'),
        `the bottom-nav ${name} item embeds the inline sprite ui-icon <svg> in its icon slot`);
    }
    assert.doesNotMatch(block, /chrome-icon/, 'no pre-S1 chrome-icon glyph survives in the bar');
    assert.doesNotMatch(block, /<i class="icon-/,
      'no `.icon-*` mask <i> survives in the bottom-nav (a mask decode-lags -> pop-in)');
  });
}

// v1.157 (P2a): the header hamburger + the desktop-sidebar Home/Settings/Stats
// glyphs were `.icon-*` masks - masks show nothing until decoded, so on an iOS
// cold start the hamburger popped in a beat late. Converted to inline
// chrome-icon <svg> across EVERY sidebar shell (the pop-in hits each shell's
// cold launch, not just index - the bottom-nav cross-shell lesson). Binds each
// to the byte-exact chromeIconMarkup output + asserts no menu/home/cog/star
// mask survives. (The home-toolbar shuffle/rescan/view-mode masks were left as
// masks - out of scope for the hamburger+sidebar ask.)
const SIDEBAR_ICON_SHELLS = fs.readdirSync(path.join(REPO, 'public'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => path.join('public', f))
  .concat(['lib/ytdlp/views/subscriptions.html'])
  .filter((rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').includes('id="sidebar"'));

test('roster sanity: the sidebar-icon shell set is non-vacuous', () => {
  assert.ok(SIDEBAR_ICON_SHELLS.length >= 9, `expected >=9 sidebar shells, found ${SIDEBAR_ICON_SHELLS.length}`);
});

for (const rel of SIDEBAR_ICON_SHELLS) {
  test(`${rel}: hamburger + sidebar Home/Settings/Stats are inline sprite <svg>s, NO menu/home/cog/star mask`, () => {
    const html = fs.readFileSync(path.join(REPO, rel), 'utf8');
    // Sweep S1: the hamburger is a plain ui-btn icon button, its glyph the ui.icon markup.
    assert.ok(html.includes('<span class="ui-btn__icon">' + uiIconMarkup('menu', 'md') + '</span></button>'),
      `${rel}: the hamburger embeds the sprite ui-icon in its ui-btn icon slot`);
    for (const name of ['home', 'cog', 'star']) {
      assert.ok(html.includes(chromeIconMarkup(name)),
        `${rel} must embed the inline chrome-icon <svg> for "${name}" (byte-exact chromeIconMarkup output)`);
    }
    assert.doesNotMatch(html, /class="icon-(menu|home|cog|star)"/,
      `no menu/home/cog/star icon-* mask may survive in ${rel} (decode-lag -> iOS cold-start pop-in)`);
  });
}

test('chromeIconEl builds a namespaced <svg class="chrome-icon"> that uses the sprite symbol', () => {
  const { c, dom } = loadCommon();
  const el = c.chromeIconEl('search');
  assert.strictEqual(el.namespaceURI, 'http://www.w3.org/2000/svg', 'SVG namespace');
  assert.ok(el.getAttribute('class').split(' ').includes('chrome-icon'), 'chrome-icon class');
  const use = el.querySelector('use');
  assert.strictEqual(use.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.strictEqual(use.getAttribute('href'), '#i-search');
  assert.strictEqual(el.getAttribute('fill'), 'currentColor', 'the symbol inherits the text colour');
  // extra class is appended (used by the sort caret)
  const caret = c.chromeIconEl('caret', 'modern-sort-caret');
  assert.ok(caret.getAttribute('class').split(' ').includes('modern-sort-caret'));
  assert.strictEqual(c.spriteIconEl('keep.fill').querySelector('use').getAttribute('href'), '#i-keep-fill');
  dom.window.close();
});

test('the JS build sites go through chromeIconEl, not an `.icon-*` mask <i> (source-lock, comments stripped)', () => {
  const src = fs.readFileSync(COMMON, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  // Sweep S1 (DELIBERATE lock update): the header glyph buttons are ui-btn icon buttons
  // built by chromeButtonEl with the registry name, and the tabs by bottomNavItemEl.
  assert.match(src, /chromeButtonEl\(\{ cls: 'search-toggle-btn', icon: CHROME_ICON\.search/, 'the header search toggle is a ui-btn with the sprite search glyph');
  assert.match(src, /chromeButtonEl\(\{ cls: 'oneoff-download-btn', icon: CHROME_ICON\.download/, 'the one-off download button is a ui-btn with the sprite download glyph');
  assert.match(src, /bottomNavItemEl\(\{ tag: 'button', nav: 'oneoff-download', icon: CHROME_ICON\.download/, 'its bottom-bar tab too');
  assert.match(src, /use\.setAttribute\('href', iconHref\(CHROME_ICON\[dark \? 'sun' : 'moon'\]\)\)/, 'the nav theme item swaps its sprite reference for the current mode');
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
