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
    const preloadIdx = html.indexOf('rel="preload" href="/fonts/geist.woff2"'); // v1.107: Modern face is Geist
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

// Sweep S9 (F56, AC12 conversion of the toast half): the toast is ui.css's ui-toast now - ONE
// queue, one host - and the v1.26.2 intent survives on the primitive: the host clears the
// iOS home indicator (env(safe-area-inset-bottom) on top of its offset) on every width, and on
// a phone it clears the fixed bottom nav through --mobile-bottom-nav-h, which itself carries
// the safe-area inset (so the two never drift through the address-bar collapse). The old
// .toast rules are gone, so nothing in style.css can re-anchor a second toast family.
const UI_CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const CSS_NC = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('the toast host adds env(safe-area-inset-bottom) on top of its offset (ui.css .ui-toast-host, base rule)', () => {
  const rule = /^\.ui-toast-host\s*\{([^}]*)\}/m.exec(UI_CSS);
  assert.ok(rule, 'expected a base .ui-toast-host rule');
  assert.match(rule[1], /bottom:\s*calc\(var\(--toast-offset\) \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(rule[1], /position:\s*fixed/);
});

test('on a phone the toast host clears the bottom nav via --mobile-bottom-nav-h, and that token carries the safe-area inset', () => {
  assert.match(UI_CSS, /@media \(max-width: 768px\)\s*\{\s*\.ui-toast-host\s*\{\s*bottom:\s*calc\(var\(--mobile-bottom-nav-h, 0px\) \+ var\(--space-4\)\);\s*\}/);
  assert.match(CSS_NC, /--mobile-bottom-nav-h:\s*calc\(72px \+ env\(safe-area-inset-bottom\)\);/);
});

test('no bespoke toast family is left in style.css (every toast is a ui-toast, F56)', () => {
  assert.doesNotMatch(CSS_NC, /\.toast\b/, 'a .toast rule');
  assert.doesNotMatch(CSS_NC, /\.toast-action-btn\b/, 'the old red caps Undo');
});
