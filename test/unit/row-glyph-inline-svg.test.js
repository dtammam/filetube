'use strict';

// [UNIT] v1.102 shimmer sweep (tranche 4) - the music SONG ROW and podcast
// EPISODE ROW action glyphs (queue/download/like/delete) swap from `.icon-*` CSS
// masks to inline chrome-icon SVGs. A mask paints NOTHING until its image
// decodes, so on an iOS cold start these glyphs popped in a beat after the row
// (the v1.87 class); an inline svg rides the text layer and reveals instantly.
//
// The swap was SURGICAL: the card-corner queue mask and the watch action-row
// masks stayed masks then; UI pass sweeps S2 / S3 moved both onto registry
// icons (card-action-menu.test.js / watch-sweep-s3.test.js). This test binds the
// two row surfaces flipped AND (last test) where the card and watch glyphs come from now.

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

// UI pass step 2 (DELIBERATE lock update): the map names registry icons (the sprite draws
// them); icons-registry.test.js binds the paths.
test('CHROME_ICON has queue, heart, delete (the row action glyphs), each a registry icon', () => {
  const map = require('../../public/js/common.js').CHROME_ICON;
  const FTIcons = require('../../public/js/icons.js');
  for (const name of ['queue', 'heart', 'delete']) {
    assert.ok(map[name] && FTIcons.has(map[name]), `${name} is in the chrome-icon map`);
  }
});

// ---- music song row: inline svgs, no masks ----------------------------------

test('music song row: queue/download/like are inline chrome-icon svgs, NO .icon-* masks', () => {
  const html = buildSongRowHtml({ id: 't1', title: 'x', artist: 'a', album: 'b', durationSec: 60, liked: false }, 0);
  // Three inline chrome-icon svgs (queue, download, heart), each drawing its sprite symbol.
  assert.strictEqual((html.match(/<svg class="chrome-icon"/g) || []).length, 3, 'three inline chrome-icon glyphs');
  assert.match(html, /<use href="#i-playlist_play"\/>/, 'queue glyph');
  assert.match(html, /<use href="#i-download"\/>/, 'download glyph');
  assert.match(html, /<use href="#i-favorite"\/>/, 'heart glyph');
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

// ---- podcast episode row: registry sprite icons via ui.button, no masks -------
// UI pass S6 (AC12 conversion of the v1.102 lock): the episode row's actions are ui.button
// icon buttons (ui-btn--icon, a ui-icon <use href="#i-NAME"> from the sprite - the same
// no-decode-lag property the inline chrome-icon gave, now from the registry), and the old
// 14px `.podcast-ep-action .chrome-icon` sizing rule is replaced by the ui-btn icon slot
// contract in ui.css. podcasts-ui-sweep.test.js renders the row and binds the DOM.

test('podcast episode row: queue + more are ui.button sprite icons, NO icon-* mask and no bespoke glyph class', () => {
  const src = stripComments(read('public/js/podcasts.js'));
  assert.match(src, /ui\.button\(\{ variant: 'plain', shape: 'icon', icon: 'playlist_play', ariaLabel: 'Add to queue' \}\)/, 'the queue action is a plain icon ui-btn');
  assert.match(src, /ui\.button\(\{ variant: 'plain', shape: 'icon', icon: 'more_vert', ariaLabel: 'More actions' \}\)/, 'the more action is a plain icon ui-btn');
  const FTIcons = require('../../public/js/icons.js');
  for (const name of ['playlist_play', 'more_vert', 'favorite', 'favorite.fill', 'check', 'download', 'delete', 'refresh']) {
    assert.ok(FTIcons.has(name), `registry has ${name}`);
  }
  assert.doesNotMatch(src, /\.className = 'icon-(heart|queue|download|delete)'/, 'no .icon-* mask <i> className in the episode row');
  assert.doesNotMatch(src, /rowGlyphEl|podcast-ep-action/, 'the retired bespoke glyph path is gone');
});

test('ui.css: the ui-btn icon slot sizes the sprite glyph (replaces the 14px .podcast-ep-action rule)', () => {
  const css = read('public/css/ui.css');
  assert.match(css, /\.ui-btn__icon > \.ui-icon \{[^}]*width: var\(--btn-icon\);[^}]*height: var\(--btn-icon\);/, 'the icon takes the slot size');
  assert.doesNotMatch(read('public/css/style.css').replace(/\/\*[\s\S]*?\*\//g, ''), /\.podcast-ep-action/, 'the bespoke rule is deleted');
});

// ---- SURGICAL SCOPE: the survivors stay masks -------------------------------

test('the card and watch queue entries draw registry icons (sweeps S2, S3); the watch row carries no mask icon', () => {
  // UI pass sweep S2 retired the card-corner queue button: the card's queue is a
  // menu entry drawing the registry's playlist_add (card-action-menu.test.js).
  assert.match(read('public/js/main.js'), /icon: 'playlist_add', label: 'Add to queue'/, 'the card queue entry draws a registry icon');
  // UI pass sweep S3: the watch action bar and its More menu draw registry icons too - the
  // .icon-* masks (and their decode-after-text pop, F52) are gone from the watch page.
  const watchJs = read('public/js/watch.js');
  assert.match(watchJs, /icon: 'playlist_add', label: 'Add to queue'/, 'the watch More menu queue entry');
  assert.match(watchJs, /icon: \{ off: 'favorite', on: 'favorite\.fill' \}, labels: \['Like', 'Liked'\]/, 'the watch Like is a registry glyph toggle');
  const watch = read('public/watch.html') + watchJs;
  assert.doesNotMatch(watch, /class="icon-|className = 'icon-/, 'no mask icon on the watch page');
});
