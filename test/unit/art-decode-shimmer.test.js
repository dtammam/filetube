'use strict';

// [UNIT] v1.102 shimmer sweep (tranche 4) - the ART-DECODE reveal. Every card
// image (album/song/drill/sticky art, podcast show/episode art, book covers,
// history thumbs, mobile avatar) ships the `art-shimmer` class so its reserved
// box shimmers instead of flashing a flat tint then popping to the decoded
// picture. FileTube.shimmerArt() drops the class the instant the image decodes
// (load) or fails (error), AND immediately for an image that is already complete
// from cache - the named cached-image edge, without which a warm image would
// shimmer forever under a fully-visible picture.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

// ---- behavioural: the helper's three reveal paths ---------------------------

function domWithCommon() {
  delete global.document; delete global.window;
  const COMMON = require.resolve('../../public/js/common.js');
  delete require.cache[COMMON];
  const c = require(COMMON); // boot guarded (no document at require time)
  const dom = new JSDOM('<!DOCTYPE html><body><div id="host"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  return { c, dom };
}

function makeImg(doc, host, complete) {
  const img = doc.createElement('img');
  img.className = 'art-shimmer';
  Object.defineProperty(img, 'complete', { value: complete, configurable: true });
  host.appendChild(img);
  return img;
}

test('shimmerArt: an in-flight image keeps shimmering, then clears on `load`', () => {
  const { c, dom } = domWithCommon();
  const host = dom.window.document.getElementById('host');
  const img = makeImg(dom.window.document, host, false); // not yet decoded
  c.shimmerArt(host);
  assert.ok(img.classList.contains('art-shimmer'), 'still shimmers while decoding');
  img.dispatchEvent(new dom.window.Event('load'));
  assert.ok(!img.classList.contains('art-shimmer'), 'reveals once decoded');
  dom.window.close();
});

test('shimmerArt: an image that fails clears too (no forever-shimmer over a broken box)', () => {
  const { c, dom } = domWithCommon();
  const host = dom.window.document.getElementById('host');
  const img = makeImg(dom.window.document, host, false);
  c.shimmerArt(host);
  img.dispatchEvent(new dom.window.Event('error'));
  assert.ok(!img.classList.contains('art-shimmer'), 'a broken image stops shimmering');
  dom.window.close();
});

test('shimmerArt: an ALREADY-COMPLETE (cached) image clears IMMEDIATELY - the named cached edge', () => {
  const { c, dom } = domWithCommon();
  const host = dom.window.document.getElementById('host');
  const img = makeImg(dom.window.document, host, true); // decoded before JS ran (cache)
  c.shimmerArt(host);
  // No load event will ever fire for a cached image; without the complete-check
  // this stays shimmering forever under a fully-visible picture.
  assert.ok(!img.classList.contains('art-shimmer'), 'cleared synchronously, no event needed');
  dom.window.close();
});

test('shimmerArt: scoped to its root, tolerant of a non-element arg', () => {
  const { c, dom } = domWithCommon();
  const doc = dom.window.document;
  const host = doc.getElementById('host');
  const outside = makeImg(doc, doc.body, false); // sibling of host, NOT inside it
  const inside = makeImg(doc, host, true);
  c.shimmerArt(host);
  assert.ok(!inside.classList.contains('art-shimmer'), 'the in-scope cached image cleared');
  assert.ok(outside.classList.contains('art-shimmer'), 'an image outside the root is untouched');
  assert.doesNotThrow(() => c.shimmerArt(null), 'a null root falls back to document, never throws');
  dom.window.close();
});

// ---- source locks: the 10 img sites ship the class; each surface reveals -----

const ART_SITES = [
  ['public/js/music.js', 'class="music-album-art art-shimmer"'],
  ['public/js/music.js', 'class="music-song-thumb art-shimmer"'],
  ['public/js/music.js', 'class="music-drill-art art-shimmer"'],
  ['public/js/music.js', 'class="music-sticky-thumb art-shimmer"'],
  ['public/js/music.js', 'class="art-shimmer" src="/albumart/'], // v1.103: the artist mosaic tile
  ['public/js/podcasts.js', "'podcast-card-art art-shimmer'"],
  ['public/js/podcasts.js', "'podcast-show-art art-shimmer'"],
  ['public/js/books.js', 'class="book-cover-img art-shimmer"'],
  ['public/js/history.js', 'class="history-thumb-img art-shimmer"'],
  ['public/js/main.js', "img.className = 'art-shimmer';"],
];

test('all 10 art image sites ship the art-shimmer class (prediction: exactly 10)', () => {
  assert.strictEqual(ART_SITES.length, 10, 'the audit predicted 10 art img sites (v1.103: +artist mosaic tile)');
  for (const [file, needle] of ART_SITES) {
    assert.ok(read(file).includes(needle), `${file} ships ${needle}`);
  }
});

test('every surface hands its rendered art to FileTube.shimmerArt', () => {
  // music/podcasts/books route through a local reveal helper that calls it;
  // history/main call it inline. Each must reference window.FileTube.shimmerArt.
  for (const file of ['public/js/music.js', 'public/js/podcasts.js', 'public/js/books.js', 'public/js/history.js', 'public/js/main.js']) {
    assert.match(read(file), /window\.FileTube\.shimmerArt\(/, `${file} calls shimmerArt after render`);
  }
});

test('the CSS shimmer rides the img background (token-only, reduced-motion carve-out)', () => {
  const css = read('public/css/style.css');
  assert.match(css, /img\.art-shimmer\s*\{[\s\S]*?background-image: linear-gradient\([^)]*var\(--bg-secondary\)[^)]*var\(--border-color\)/,
    'a token-only gradient (no raw literal) on the img background');
  assert.match(css, /@keyframes art-shimmer-sweep/, 'its own background-position sweep keyframe');
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*img\.art-shimmer \{ animation: none/,
    'reduced-motion drops the sweep');
});
