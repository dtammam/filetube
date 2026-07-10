'use strict';

// [UNIT] v1.26.2 CSS/polish wave -- Item 5 (PWA chrome details): the
// status-bar-style meta, the toast's safe-area-aware bottom offset, and the
// font preload -- all five HTML shells must carry identical markup (see
// test/unit/player-cc-btn-parity.test.js for the established five-shell
// parity pattern this file follows).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SHELLS = [
  path.join(ROOT, 'public', 'index.html'),
  path.join(ROOT, 'public', 'watch.html'),
  path.join(ROOT, 'public', 'setup.html'),
  path.join(ROOT, 'public', 'stats.html'),
  path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html'),
];
const CSS_PATH = path.join(ROOT, 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

test('every shell carries apple-mobile-web-app-status-bar-style="default" immediately after apple-mobile-web-app-capable', () => {
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.match(
      html,
      /<meta name="apple-mobile-web-app-capable" content="yes">[\s\S]{0,1200}?<meta name="apple-mobile-web-app-status-bar-style" content="default">/,
      `${shellPath} is missing apple-mobile-web-app-status-bar-style="default" near apple-mobile-web-app-capable`
    );
  }
});

test('every shell preloads the app font (matches the @font-face src in style.css exactly)', () => {
  const fontFaceSrc = /@font-face\s*\{[^}]*src:\s*url\('([^']+)'\)\s*format\('woff2'\);/.exec(css);
  assert.ok(fontFaceSrc, 'expected to find the @font-face src in style.css');
  const preloadRe = new RegExp(
    `<link rel="preload" href="${fontFaceSrc[1].replace(/\//g, '\\/')}" as="font" type="font\\/woff2" crossorigin>`
  );
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.match(html, preloadRe, `${shellPath} is missing the font preload link (or its href diverges from the real @font-face src)`);
  }
});

test('every shell\'s font preload appears in <head>, before the stylesheet link (so the browser starts fetching before it even parses style.css)', () => {
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    const preloadIdx = html.indexOf('rel="preload" href="/fonts/roboto.woff2"');
    const stylesheetIdx = html.indexOf('rel="stylesheet" href="/css/style.css"');
    assert.ok(preloadIdx > -1, `${shellPath} is missing the font preload`);
    assert.ok(stylesheetIdx > -1, `${shellPath} is missing the stylesheet link`);
    assert.ok(preloadIdx < stylesheetIdx, `${shellPath}: font preload must come before the stylesheet <link>`);
  }
});

test('the @font-face rule keeps font-display: swap (preload shrinks the swap window; it does not replace swap)', () => {
  const fontFaceBlock = /@font-face\s*\{([^}]*)\}/.exec(css);
  assert.ok(fontFaceBlock);
  assert.match(fontFaceBlock[1], /font-display:\s*swap;/);
});

test('.toast bottom offset adds env(safe-area-inset-bottom) on top of the existing 24px, with a 0px fallback', () => {
  // The BASE (non-media-query, unindented) .toast rule -- there is also an
  // earlier mobile-scoped `.toast { bottom: ... }` override (clears the
  // bottom nav), which a bare (non-anchored) regex would match first.
  const rule = /^\.toast\s*\{([^}]*)\}/m.exec(css);
  assert.ok(rule, 'expected a base .toast rule');
  assert.match(rule[1], /bottom:\s*calc\(24px \+ env\(safe-area-inset-bottom,\s*0px\)\);/);
});

test('the mobile .toast override (clearing the bottom nav) is unchanged by the safe-area fix -- it already routes safe-area-inset-bottom via --mobile-bottom-nav-h', () => {
  assert.match(css, /\.toast\s*\{\s*bottom:\s*calc\(var\(--mobile-bottom-nav-h\)\s*\+\s*12px\);\s*\}/);
});
