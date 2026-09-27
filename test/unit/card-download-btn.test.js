'use strict';

// [UNIT] v1.22.0 FR-9 (T-H, AC62-67): home/library card "save to device"
// affordance (public/js/main.js's card template + `.card-download-btn` CSS,
// public/css/style.css). Reuses the EXISTING, unmodified `/video/:id?
// download=1` route shipped v1.19.0 on the watch page (see
// test/unit/uploader-channel-link.test.js's sibling FR-3 coverage and
// watch.js's `downloadBtn` wiring) -- no new server route, source-agnostic
// (works identically for a yt-dlp-managed item and a plain local file).
//
// Two things are covered here:
//   1. The pure href/filename builders (`buildCardDownloadHref`,
//      `buildCardDownloadFilename`), kept at module scope above main.js's
//      view IIFE (mirrors watch.js's own pure-helper + `module.exports`
//      guard pattern) so they're directly `require()`-able without a
//      jsdom/browser harness (none exists in this codebase, see
//      CONTRIBUTING.md).
//   2. AC64 (a download control never nests inside the thumbnail's watch-page
//      link): since UI pass sweep S2 the card has NO control on the media at
//      all - Save to device is an entry of the card's action menu (a transient
//      <a download> built on selection) - bound structurally below.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { buildCardDownloadHref, buildCardDownloadFilename } = require('../../public/js/main.js');

const MAIN_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'main.js');
const mainJs = fs.readFileSync(MAIN_JS_PATH, 'utf8');

// ---- buildCardDownloadHref --------------------------------------------------

test('buildCardDownloadHref: reuses the existing ?download=1 route, id encodeURIComponent-escaped', () => {
  assert.strictEqual(buildCardDownloadHref('abc123'), '/video/abc123?download=1');
});

test('buildCardDownloadHref: an id containing reserved/special characters is percent-encoded, never raw-interpolated', () => {
  // Guards against header/URL injection via a crafted id -- mirrors the
  // watch-page download button's own encodeURIComponent usage.
  assert.strictEqual(
    buildCardDownloadHref('a/b?c&d=e"f<g>h'),
    `/video/${encodeURIComponent('a/b?c&d=e"f<g>h')}?download=1`
  );
  assert.ok(!buildCardDownloadHref('a&b=c').includes('&b=c'), 'a literal "&" in the id must not leak an extra query param');
});

test('buildCardDownloadHref: works identically regardless of source (yt-dlp-managed vs. local item) -- the id is opaque to the builder', () => {
  assert.strictEqual(buildCardDownloadHref('local-item-1'), '/video/local-item-1?download=1');
  assert.strictEqual(buildCardDownloadHref('ytdlp-item-1'), '/video/ytdlp-item-1?download=1');
});

// ---- buildCardDownloadFilename ----------------------------------------------

test('buildCardDownloadFilename: joins title + extension exactly like watch.js\'s downloadBtn wiring', () => {
  assert.strictEqual(buildCardDownloadFilename('My Video', '.mp4'), 'My Video.mp4');
});

test('buildCardDownloadFilename: a missing/empty title falls back to "download", never blank or "undefined"', () => {
  assert.strictEqual(buildCardDownloadFilename('', '.mp4'), 'download.mp4');
  assert.strictEqual(buildCardDownloadFilename(undefined, '.mp4'), 'download.mp4');
  assert.strictEqual(buildCardDownloadFilename(null, '.mp4'), 'download.mp4');
});

test('buildCardDownloadFilename: a missing/empty extension is simply omitted, never "undefined"-suffixed', () => {
  assert.strictEqual(buildCardDownloadFilename('My Video', ''), 'My Video');
  assert.strictEqual(buildCardDownloadFilename('My Video', undefined), 'My Video');
});

test('buildCardDownloadFilename: returns the RAW (unescaped) string -- callers building an HTML attribute must escape it themselves', () => {
  assert.strictEqual(buildCardDownloadFilename('<script>alert(1)</script>', '.mp4'), '<script>alert(1)</script>.mp4');
});

// ---- card template: sibling/isolation structure (AC64) ----------------------
//
// UI pass sweep S2 (D8.5; converts the v1.22/v1.67 corner-anchor locks, AC12):
// Save to device is an entry of the card's ONE action menu. The AC64 invariant
// (a download control never nests inside the thumbnail's watch-page link) now
// holds by construction - the card has NO control on the media at all - and the
// menu's save reuses the SAME href/filename builders.

test('the card media link holds no download control (AC64 by construction: no control on the thumbnail)', () => {
  const src = mainJs.slice(mainJs.indexOf('function buildVideoCardEl(item, o) {'), mainJs.indexOf('function buildSkeletonCardEl('));
  assert.ok(src.length > 0, 'expected buildVideoCardEl in main.js');
  assert.doesNotMatch(src, /download/i, 'the card builder draws no download affordance');
  assert.doesNotMatch(mainJs, /card-download-btn/, 'the corner download family is gone');
});

test('the menu\'s Save to device reuses buildCardDownloadHref / buildCardDownloadFilename (not a hand-rolled duplicate), via setAttribute', () => {
  assert.match(mainJs, /function cardDownloadHref\(item\) \{[\s\S]{0,160}?return buildCardDownloadHref\(item\.id\);/);
  assert.match(mainJs, /a\.setAttribute\('download', cardKindPresentation\(item\) \? '' : buildCardDownloadFilename\(item\.title, item\.ext\)\);/);
  assert.match(mainJs, /\{ id: 'download', icon: 'download', label: 'Save to device' \}/);
});
