'use strict';

// [UNIT] v1.40.0 — the per-card "Like" control (Dean). Source/asset locks in
// the established style of shuffle-rescan-icon.test.js: the heart is a real SVG
// mask painted in currentColor (NOT the U+2665 emoji codepoint), the card
// button mirrors the download/delete corner controls, the toggle uses the same
// db.liked API the watch page does (non-optimistic), and the list endpoint
// tags each item with `liked` so cards render their initial state. DOM behavior
// is validated on-device; these lock the wiring so a refactor fails loudly.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
const mainSrc = fs.readFileSync(path.join(__dirname, '../../public/js/main.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

test('assets: heart.svg exists and is a valid single-path <svg>', () => {
  const svg = fs.readFileSync(path.join(__dirname, '../../public/assets/icons/heart.svg'), 'utf8');
  assert.ok(svg.includes('<svg'), 'expected a valid <svg> document');
  assert.ok(svg.includes('<path'), 'expected a heart path');
});

test('style.css: .icon-heart is in the base chrome-icon sizing group, the @supports fill guard, and maps to heart.svg', () => {
  assert.match(css, /\.icon-heart,[\s\S]*?\.icon-shuffle\s*\{[\s\S]*?mask-repeat:\s*no-repeat;/, 'heart in the shared sizing/mask group');
  assert.match(css, /@supports[\s\S]*?\.icon-heart,\s*\.icon-download,\s*\.icon-shuffle\s*\{\s*background-color:\s*currentColor;/, 'heart in the currentColor fill guard');
  assert.match(css, /\.icon-heart\s*\{\s*-webkit-mask-image:\s*url\(\/assets\/icons\/heart\.svg\);/, 'heart maps to its SVG mask');
});

test('style.css: NOT the U+2665 emoji codepoint -- the heart is a mask asset, not a content glyph', () => {
  // Guard against a regression to a bare unicode heart (iOS renders U+2665 as
  // the red-heart emoji), mirroring the ⏮/⏭ lesson.
  assert.ok(!/\.icon-heart::before\s*\{\s*content/.test(css), 'heart must not be a ::before content glyph');
});

test('style.css: .card-like-btn is a bottom-left corner control that turns red when liked', () => {
  const rule = /\.card-like-btn\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a .card-like-btn rule');
  assert.match(rule[1], /position:\s*absolute;/);
  assert.match(rule[1], /bottom:\s*6px;/);
  assert.match(rule[1], /left:\s*6px;/);
  assert.match(css, /\.card-like-btn\.liked\s*\{[^}]*color:\s*var\(--yt-red\)/, 'liked state paints the heart red');
});

test('the corner controls anchor to the thumbnail via .card-media (so bottom:6px reaches the thumbnail, not the card bottom)', () => {
  // v1.40.0 gate fix: overlays live in a thumbnail-height positioning box, not
  // directly on .video-card (whose bottom is below the title/meta/rating).
  assert.match(css, /\.card-media\s*\{[^}]*position:\s*relative;/, 'expected .card-media { position: relative }');
  assert.ok(mainSrc.includes('<div class="card-media">'), 'the card wraps the thumbnail + overlays in .card-media');
});

test('main.js: the card renders a .card-like-btn reflecting item.liked, and toggles via POST/DELETE /api/liked/:id (non-optimistic)', () => {
  assert.ok(mainSrc.includes('class="card-like-btn${item.liked ? \' liked\' : \'\'}"'), 'the card seeds the liked class from item.liked');
  assert.ok(mainSrc.includes("'/api/liked/' + encodeURIComponent(id)"), 'toggle hits the liked API by id');
  assert.ok(mainSrc.includes("method: currentlyLiked ? 'DELETE' : 'POST'"), 'DELETE when liked, POST when not');
  // Non-optimistic: the heart flips inside the resolved .then, guarded by res.ok.
  assert.ok(mainSrc.includes("if (!res.ok) throw new Error('like request failed"), 'a failed request never fakes success');
});

test('server.js: the GET /api/videos list tags each item with a `liked` flag from db.liked', () => {
  assert.match(serverSrc, /liked:\s*Array\.isArray\(db\.liked\)\s*&&\s*db\.liked\.includes\(item\.id\)/);
});
