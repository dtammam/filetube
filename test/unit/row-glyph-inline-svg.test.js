'use strict';

// [UNIT] v1.102 shimmer sweep (tranche 4) - the music SONG ROW and podcast
// EPISODE ROW action glyphs (queue/download/like/delete) swap from `.icon-*` CSS
// masks to inline chrome-icon SVGs. A mask paints NOTHING until its image
// decodes, so on an iOS cold start these glyphs popped in a beat after the row
// (the v1.87 class); an inline svg rides the text layer and reveals instantly.
//
// The swap is SURGICAL: the card-corner queue mask and the watch action-row
// masks are NOT first-paint-lagging in the same way and stay masks (bound by
// card-corner-renderer.test.js / era-row-overflow.test.js). This test binds the
// two row surfaces flipped AND that the survivors did not.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// common.js required with window UNDEFINED (its window-gated boot touches
// document), THEN window.chromeIconMarkup attached - buildSongRowHtml reads it at
// call time, so we see the browser's real inline svg output.
const { chromeIconMarkup } = require('../../public/js/common.js');
global.window = global.window || {};
global.window.chromeIconMarkup = chromeIconMarkup;
const { buildSongRowHtml } = require('../../public/js/music.js');

// ---- the 3 new glyphs exist in the shared map -------------------------------

test('CHROME_ICON_SVG gained queue, heart, delete (the row action glyphs)', () => {
  const map = require('../../public/js/common.js').CHROME_ICON_SVG;
  for (const name of ['queue', 'heart', 'delete']) {
    assert.ok(map[name] && map[name].d && map[name].vb, `${name} is in the chrome-icon map`);
  }
});

// ---- music song row: inline svgs, no masks ----------------------------------

test('music song row: queue/download/like are inline chrome-icon svgs, NO .icon-* masks', () => {
  const html = buildSongRowHtml({ id: 't1', title: 'x', artist: 'a', album: 'b', durationSec: 60, liked: false }, 0);
  // Three inline chrome-icon svgs (queue, download, heart), each with its path.
  assert.strictEqual((html.match(/<svg class="chrome-icon"/g) || []).length, 3, 'three inline chrome-icon glyphs');
  assert.match(html, /<path d="M3 6h13v2H3V6/, 'queue glyph path');
  assert.match(html, /<path d="M480-337/, 'download glyph path');
  assert.match(html, /<path d="m480-120-58-52/, 'heart glyph path');
  // No decode-lagging mask <i> survives in the row.
  assert.doesNotMatch(html, /<i class="icon-(queue|download|heart)"/, 'no .icon-* mask <i> in the song row');
});

test('music.js reaches chromeIconMarkup via window (no bare require - the client-scripts convention)', () => {
  const src = stripComments(read('public/js/music.js'));
  assert.match(src, /window\.chromeIconMarkup/, 'the row builder reads window.chromeIconMarkup');
  assert.doesNotMatch(src, /require\(\s*['"]\.\/common/, 'no bare require of common.js in a client script');
  // The three row buttons emit the glyph via the resolver, not a mask <i>.
  assert.match(src, /rowGlyphMarkup\('queue'\)/);
  assert.match(src, /rowGlyphMarkup\('download'\)/);
  assert.match(src, /rowGlyphMarkup\('heart'\)/);
});

// ---- podcast episode row: chromeIconEl, no mask className -------------------

test('podcast episode row: like/queue/save/delete build via chromeIconEl, NO icon-* mask className', () => {
  const src = stripComments(read('public/js/podcasts.js'));
  for (const name of ['heart', 'queue', 'download', 'delete']) {
    assert.match(src, new RegExp("rowGlyphEl\\('" + name + "'\\)"), `episode-row ${name} builds an inline chrome-icon el`);
  }
  // The old mask <i> builders (className = 'icon-*') are gone from the episode row.
  assert.doesNotMatch(src, /\.className = 'icon-(heart|queue|download|delete)'/,
    'no .icon-* mask <i> className assignment survives in the episode row');
});

test('style.css: .podcast-ep-action sizes the inline chrome-icon (parity with the old 14px mask)', () => {
  const css = read('public/css/style.css');
  assert.match(css, /\.podcast-ep-action \.chrome-icon\b/, 'the svg glyph is sized in the ep-action button');
  assert.match(css, /\.podcast-ep-action[^{]*\.chrome-icon[^{]*\{[^}]*width: 14px/,
    'same 14px box the mask had (no size regression)');
});

// ---- SURGICAL SCOPE: the survivors stay masks -------------------------------

test('surgical scope: the card-corner queue mask and watch-row masks are NOT swapped', () => {
  // The card-corner queue button (main.js) is a promoted mask, deliberately kept
  // (card-corner-renderer.test.js binds it) - a mask here does not first-paint-lag
  // the way the row glyphs did.
  assert.match(read('public/js/main.js'), /icon-queue/, 'the card-corner queue mask survives');
  // The watch action row keeps its masks (era-row-overflow.test.js binds them).
  const watch = read('public/watch.html') + read('public/js/watch.js');
  assert.match(watch, /icon-heart/, 'the watch action-row like mask survives');
});
