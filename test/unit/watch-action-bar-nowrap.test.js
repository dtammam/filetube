'use strict';

// [UNIT] v1.25.4 polish: the watch-page action-button row (Download/Delete/
// Move -- glyph + short label, shipped v1.25.0) wrapped on a narrow mobile
// viewport: Download+Delete stayed on row 1 but Move (the last button,
// appended by watch.js's setupMoveButton) dropped onto its own orphaned
// row 2. Fix: tighten `.watch-actions`'s gap and `.watch-actions .btn`'s
// padding/font-size inside the existing `@media (max-width: 768px)` block so
// all three buttons fit on one row, without reintroducing the vestigial
// `btn-sm` class or an inline style (both removed from this row in v1.25.0).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'watch.html');
const WATCH_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'watch.js');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const watchJs = fs.readFileSync(WATCH_JS_PATH, 'utf8');

// Locate the SAME `@media (max-width: 768px)` block that already holds the
// `.watch-action-bar { flex-direction: column; ... }` mobile rule -- the fix
// is scoped inside it (this file has several independent 768px blocks for
// different features, so isolate by content, not just the media query).
function findMobileBlockContaining(marker) {
  const mediaRe = /@media \(max-width: 768px\)\s*\{/g;
  let m;
  while ((m = mediaRe.exec(css))) {
    const start = m.index + m[0].length;
    // Find this block's matching close brace by depth-counting.
    let depth = 1;
    let i = start;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(start, i - 1);
    if (body.includes(marker)) return body;
  }
  return null;
}

const mobileBlock = findMobileBlockContaining('.watch-action-bar {');

test('style.css: the watch-action-bar mobile block exists (sanity check for the block-isolation helper)', () => {
  assert.ok(mobileBlock, 'expected to find the @media (max-width: 768px) block containing .watch-action-bar');
});

test('style.css: .watch-actions gets a tightened gap on mobile (scoped to the watch-action-bar mobile block)', () => {
  const rule = /\.watch-actions\s*\{([^}]*)\}/.exec(mobileBlock);
  assert.ok(rule, 'expected a mobile-scoped .watch-actions rule');
  assert.match(rule[1], /gap:\s*\d+px;/);
});

test('style.css: .watch-actions .btn is tightened (padding + font-size) on mobile so Download/Delete/Move fit on one row', () => {
  const rule = /\.watch-actions \.btn\s*\{([^}]*)\}/.exec(mobileBlock);
  assert.ok(rule, 'expected a mobile-scoped .watch-actions .btn rule');
  assert.match(rule[1], /padding:\s*[\d.]+px\s+[\d.]+px;/);
  const fontMatch = /font-size:\s*(\d+)px;/.exec(rule[1]);
  assert.ok(fontMatch, 'expected a font-size declaration');
  assert.ok(Number(fontMatch[1]) < 12, 'expected the mobile .watch-actions .btn font-size to be smaller than the desktop 12px .btn default');
});

test('style.css: the mobile .watch-actions .btn tightening is scoped ONLY to the watch-actions row, not the global .btn class', () => {
  // A bare, unscoped `.btn { ... font-size: 11px ... }` inside the SAME
  // mobile block would regress every other button on the page (header,
  // setup, sidebar). The fix must always be qualified by `.watch-actions`.
  assert.ok(!/(?:^|\n)\s*\.btn\s*\{[^}]*padding:\s*6px 10px;/.test(mobileBlock), 'the tightened padding must not leak onto the bare .btn class');
});

test('watch.html/watch.js: no btn-sm class or inline style is reintroduced for the Download/Delete/Move buttons (v1.25.0 removed both)', () => {
  assert.doesNotMatch(html, /id="download-media-btn"[^>]*style=/, 'the Download button must not carry an inline style');
  assert.doesNotMatch(html, /btn-sm/, 'watch.html must not reference btn-sm anywhere');
  assert.doesNotMatch(watchJs, /moveBtn\.className\s*=\s*'btn btn-sm'/, 'the Move button must not reintroduce btn-sm');
});

test('watch.html/watch.js: Download, Delete, and the dynamically-created Move button all still use the plain .btn class (one consistent family)', () => {
  assert.match(html, /class="btn"[^>]*id="download-media-btn"/);
  assert.match(html, /class="btn"[^>]*id="delete-media-btn"/);
  assert.match(watchJs, /moveBtn\.className\s*=\s*'btn';/);
});

test('watch.html: the three action buttons keep their aria-labels unchanged', () => {
  assert.match(html, /id="download-media-btn"[^>]*aria-label="Download video"/);
  assert.match(html, /id="delete-media-btn"[^>]*aria-label="Delete video"/);
  assert.match(watchJs, /moveBtn\.setAttribute\('aria-label',\s*'Move to another folder'\);/);
});

test('style.css: .watch-actions keeps flex-wrap: wrap as a graceful fallback at extreme narrowness (never flex-wrap: nowrap, which would clip)', () => {
  const rule = /\.watch-actions\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected the base .watch-actions rule');
  assert.match(rule[1], /flex-wrap:\s*wrap;/);
});
