'use strict';

// [UNIT] v1.238 (Dean): the player-STICKER icon picker lives on the Settings page
// (the Mobile player section since v1.349), beside the Music-skin picker. Three kinds mirroring the music.js resolver:
// 'logo' (the FileTube favicon, default), 'emoji' (a preset gallery OR any typed emoji),
// and 'custom' (an uploaded image, per-user via /api/me/sticker, the T1 endpoint). Setup.js
// has no jsdom harness in this repo (CONTRIBUTING.md), so these are source locks, mirroring
// setup-music-skin-picker.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', '..', 'public');
const SETUP_HTML = fs.readFileSync(path.join(PUB, 'setup.html'), 'utf8');
const SETUP_JS = fs.readFileSync(path.join(PUB, 'js', 'setup.js'), 'utf8');

// ---- setup.html: the Mobile player section carries the picker + hidden file input --------

// the <details> of one Settings section, by its data-collapse-key
function sectionHtml(key) {
  const m = new RegExp('<details[^>]*data-collapse-key="' + key + '"[\\s\\S]*?</details>').exec(SETUP_HTML);
  assert.ok(m, 'the ' + key + ' section exists in setup.html');
  return m[0];
}

test('setup.html: a "Player sticker" heading + #sticker-picker + a hidden file input exist', () => {
  assert.match(SETUP_HTML, /<h3[^>]*>Player sticker<\/h3>/, 'a "Player sticker" subheading');
  assert.match(SETUP_HTML, /<div id="sticker-picker" class="sticker-picker">/, 'the picker container');
  assert.match(SETUP_HTML, /<input type="file" id="sticker-file-input"[^>]*accept="image\/png,image\/jpeg,image\/webp"[^>]*hidden/, 'a hidden image file input for the custom upload');
});

test('setup.html (v1.349): the sticker picker and its file input live in mobile-player and NOT in appearance', () => {
  const mobile = sectionHtml('mobile-player');
  assert.match(mobile, /id="sticker-picker"/, 'picker inside mobile-player');
  assert.match(mobile, /id="sticker-file-input"/, 'file input inside mobile-player');
  assert.doesNotMatch(sectionHtml('appearance'), /sticker-picker|sticker-file-input/, 'neither inside appearance');
});

test('setup.html (v1.350): Player sticker comes first in Mobile player and the whole Music skin grid comes last', () => {
  const mobile = sectionHtml('mobile-player');
  const sticker = mobile.indexOf('id="sticker-picker"');
  const skin = mobile.indexOf('id="music-skin-picker"');
  assert.ok(sticker > 0 && skin > 0, 'both pickers are in the section');
  assert.ok(sticker < skin, 'sticker first, skins last');
  assert.ok(mobile.indexOf('id="sticker-file-input"') < skin, 'the sticker file input is above the skin grid too');
  assert.ok(/<\/div>\s*$/.test(mobile.slice(skin, mobile.lastIndexOf('</details>')).trim()) , 'the skin group is the last block');
  assert.strictEqual((mobile.slice(skin).match(/class="setup-group"/g) || []).length, 0, 'no setup-group follows the skin grid');
});

// ---- setup.js: renderStickerPicker reads ft-sticker + wires the three kinds ------------

test('setup.js: renderStickerPicker builds the cards, reads/writes ft-sticker, and guards like the skin picker', () => {
  const m = /async function renderStickerPicker\(\) \{([\s\S]*?)\n\}/.exec(SETUP_JS);
  assert.ok(m, 'renderStickerPicker() is defined');
  const body = m[1];
  assert.match(body, /getElementById\('sticker-picker'\)/, 'targets its container');
  assert.match(body, /if \(!container \|\| !controller\) return;/, 'same premature-call guard as renderMusicSkinPicker');
  assert.match(body, /data-sticker-kind="logo"/, 'a logo card');
  assert.match(body, /data-sticker-kind="emoji"/, 'emoji preset cards');
  assert.match(body, /\/favicon\.svg/, 'the logo card previews the FileTube favicon');
  assert.match(body, /\{ signal: controller\.signal \}/, 'listeners are torn down with the view (sig)');
});

test('setup.js: STICKER pref helpers key on ft-sticker and default to the logo', () => {
  assert.match(SETUP_JS, /const STICKER_PREF_KEY = 'ft-sticker';/, 'the localStorage key matches music.js');
  const r = /function readStickerPref\(\) \{([\s\S]*?)\n\}/.exec(SETUP_JS);
  assert.ok(r, 'readStickerPref exists');
  assert.match(r[1], /return \{ kind: 'logo' \};/, 'unset / bad json -> the logo default');
  assert.match(r[1], /o\.kind === 'logo' \|\| o\.kind === 'emoji' \|\| o\.kind === 'custom'/, 'only the three known kinds are honored');
});

test('setup.js: the custom upload POSTs to /api/me/sticker and stores kind:custom with the returned version', () => {
  const m = /async function renderStickerPicker\(\) \{([\s\S]*?)\n\}/.exec(SETUP_JS);
  const body = m[1];
  assert.match(body, /fetch\('\/api\/me\/sticker', \{ method: 'POST'/, 'uploads to the T1 POST endpoint');
  assert.match(body, /mergeStickerPref\(\{ kind: 'custom', value: undefined, v: \(body\.sticker && body\.sticker\.version\)/, 'stores kind:custom + the cache-bust version from the response (merge keeps size/tilt)');
  assert.match(body, /fetch\('\/api\/me\/sticker', \{ method: 'DELETE' \}\)/, 'remove hits the DELETE endpoint');
  assert.match(body, /if \(readStickerPref\(\)\.kind === 'custom'\) mergeStickerPref\(\{ kind: 'logo'/, 'removing a custom image in use reverts to the logo');
});

test('setup.js: a typed emoji writes kind:emoji with the trimmed value; presets escape their emoji', () => {
  const m = /async function renderStickerPicker\(\) \{([\s\S]*?)\n\}/.exec(SETUP_JS);
  const body = m[1];
  assert.match(body, /mergeStickerPref\(\{ kind: 'emoji', value: v, v: undefined \}\)/, 'the typed-emoji "Use emoji" path stores kind:emoji (merge keeps size/tilt)');
  assert.match(body, /escStickerHtml\(em\)/, 'preset emoji are HTML-escaped when rendered (user-facing input class)');
});

test('setup.js: renderStickerPicker is CALLED in init (beside renderMusicSkinPicker) - not dead code', () => {
  assert.match(SETUP_JS, /renderMusicSkinPicker\(\);[^\n]*\n\s*renderStickerPicker\(\);/,
    'init calls renderStickerPicker right after renderMusicSkinPicker');
});

test('v1.241: the Size + Tilt pickers exist, MERGE (preserve other fields), and offer the right options', () => {
  assert.match(SETUP_JS, /const STICKER_SIZES = \[\['default'[\s\S]*?\['3x'/, 'the size options are default/2x/3x');
  assert.doesNotMatch(SETUP_JS, /\['5x'/, 'v1.243: 5x size removed (overlapped the wheel)');
  assert.match(SETUP_JS, /const STICKER_TILTS = \[\['straight'[\s\S]*?\['right'/, 'the tilt options straight/left/right');
  assert.match(SETUP_JS, /function mergeStickerPref\(patch\) \{ writeStickerPref\(Object\.assign\(\{\}, readStickerPref\(\), patch\)\)/, 'mergeStickerPref keeps existing fields (size/tilt survive a kind change and vice-versa)');
  // Sweep S8: Size and Tilt are ui.segmented controls (behaviour: settings-forms-sweep.test.js
  // clicks them through the real renderStickerPicker); each item keeps its data-sticker-* hook.
  assert.match(SETUP_JS, /\[\['size', STICKER_SIZES, pref\.size \|\| 'default', 'Sticker size'\], \['tilt', STICKER_TILTS, pref\.tilt \|\| 'left', 'Sticker tilt'\]\]/, 'renders a size and a tilt segmented control');
  assert.match(SETUP_JS, /b\.setAttribute\('data-sticker-' \+ key, b\.getAttribute\('data-value'\)\)/, 'each segment keeps its data-sticker-* hook');
  assert.match(SETUP_JS, /onChange: \(v\) => \{ mergeStickerPref\(\{ \[key\]: v \}\); renderStickerPicker\(\); \}/, 'a pick merges just that one field');
  // the kind-change writes now MERGE (so size/tilt persist across a kind change)
  assert.match(SETUP_JS, /mergeStickerPref\(\{ kind: 'emoji'[^)]*value: btn\.dataset\.stickerEmoji/, 'picking an emoji preset merges (keeps size/tilt)');
});

// ---- the shared shell-coverage guard already binds music-skins.js on every setup shell;
// the sticker picker needs no extra registry, so no new shell requirement here. ----------
