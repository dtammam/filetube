'use strict';

// [UNIT] v1.238 (Dean): the player-STICKER icon picker lives on the Settings page
// (Appearance), beside the Music-skin picker. Three kinds mirroring the music.js resolver:
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

// ---- setup.html: the Appearance section carries the picker + hidden file input --------

test('setup.html: an Appearance "Player sticker" heading + #sticker-picker + a hidden file input exist', () => {
  assert.match(SETUP_HTML, /<h3[^>]*>Player sticker<\/h3>/, 'a "Player sticker" subheading in Appearance');
  assert.match(SETUP_HTML, /<div id="sticker-picker" class="sticker-picker">/, 'the picker container');
  assert.match(SETUP_HTML, /<input type="file" id="sticker-file-input"[^>]*accept="image\/png,image\/jpeg,image\/webp"[^>]*hidden/, 'a hidden image file input for the custom upload');
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
  assert.match(SETUP_JS, /const STICKER_SIZES = \[\['default'[\s\S]*?\['5x'/, 'the size options include default..5x');
  assert.match(SETUP_JS, /const STICKER_TILTS = \[\['straight'[\s\S]*?\['right'/, 'the tilt options straight/left/right');
  assert.match(SETUP_JS, /function mergeStickerPref\(patch\) \{ writeStickerPref\(Object\.assign\(\{\}, readStickerPref\(\), patch\)\)/, 'mergeStickerPref keeps existing fields (size/tilt survive a kind change and vice-versa)');
  assert.match(SETUP_JS, /data-sticker-size=/, 'renders size chips');
  assert.match(SETUP_JS, /data-sticker-tilt=/, 'renders tilt chips');
  assert.match(SETUP_JS, /mergeStickerPref\(\{ size: b\.dataset\.stickerSize \}\)/, 'a size click merges just the size');
  assert.match(SETUP_JS, /mergeStickerPref\(\{ tilt: b\.dataset\.stickerTilt \}\)/, 'a tilt click merges just the tilt');
  // the kind-change writes now MERGE (so size/tilt persist across a kind change)
  assert.match(SETUP_JS, /mergeStickerPref\(\{ kind: 'emoji'[^)]*value: btn\.dataset\.stickerEmoji/, 'picking an emoji preset merges (keeps size/tilt)');
});

// ---- the shared shell-coverage guard already binds music-skins.js on every setup shell;
// the sticker picker needs no extra registry, so no new shell requirement here. ----------
