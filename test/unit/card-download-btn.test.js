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
//   2. A structural, source-text regression lock (AC64): the rendered
//      `.card-download-btn` anchor must be a SIBLING of `.thumbnail-
//      container`'s `<a>`, never nested inside it -- an `<a>` nested inside
//      another `<a>` would still trigger the OUTER watch-page navigation on
//      click in every browser, defeating the whole feature. Mirrors the
//      existing `.card-delete-btn` overlay's proven placement (a `<button>`
//      can't nest in an `<a>` at all; `.card-download-btn` is itself an `<a>`
//      so this is the one placement mistake that's easy to make silently).

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

test('card template: .card-download-btn is a SIBLING of .thumbnail-container\'s <a>, never nested inside it', () => {
  const cardMatch = /<div class="video-card">([\s\S]*?)<div class="video-info">/.exec(mainJs);
  assert.ok(cardMatch, 'expected to find the video-card template block in main.js');
  const cardBody = cardMatch[1];

  const thumbOpenIdx = cardBody.indexOf('class="thumbnail-container"');
  assert.ok(thumbOpenIdx !== -1, 'expected a .thumbnail-container anchor in the card template');

  // The FIRST </a> after the thumbnail anchor opens is that anchor's own
  // closing tag (it contains only an <img> + non-anchor overlay divs, no
  // nested <a>).
  const thumbCloseIdx = cardBody.indexOf('</a>', thumbOpenIdx);
  assert.ok(thumbCloseIdx !== -1, 'expected the thumbnail anchor to close');

  const downloadIdx = cardBody.indexOf('card-download-btn');
  assert.ok(downloadIdx !== -1, 'expected a .card-download-btn element in the card template');

  assert.ok(
    downloadIdx > thumbCloseIdx,
    '.card-download-btn must appear AFTER the thumbnail anchor closes (a sibling under .video-card), never between its open/close tags (which would nest it inside the watch-page link)'
  );
});

test('card template: .card-download-btn is its own <a>, not nested inside the thumbnail-container <a> or the delete <button>', () => {
  const cardMatch = /<div class="video-card">([\s\S]*?)<div class="video-info">/.exec(mainJs);
  const cardBody = cardMatch[1];

  const deleteBtnMatch = /<button[^>]*class="card-delete-btn"[\s\S]*?<\/button>/.exec(cardBody);
  assert.ok(deleteBtnMatch, 'expected the existing .card-delete-btn button in the card template');

  const downloadBtnMatch = /<a[^>]*class="card-download-btn"[\s\S]*?<\/a>/.exec(cardBody);
  assert.ok(downloadBtnMatch, 'expected a standalone .card-download-btn <a>...</a> element');

  // Neither overlay's markup contains the other's -- both are flat siblings
  // directly under .video-card, not nested in one another.
  assert.ok(!deleteBtnMatch[0].includes('card-download-btn'));
  assert.ok(!downloadBtnMatch[0].includes('card-delete-btn'));
});

test('card template: the download anchor reuses buildCardDownloadHref/buildCardDownloadFilename (not a hand-rolled duplicate) and is escapeHtml-wrapped', () => {
  assert.match(mainJs, /href="\$\{buildCardDownloadHref\(item\.id\)\}"/);
  assert.match(mainJs, /download="\$\{escapeHtml\(buildCardDownloadFilename\(item\.title, item\.ext\)\)\}"/);
  assert.match(mainJs, /aria-label="Save to device"/);
});
