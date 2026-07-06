'use strict';

// [UNIT] v1.15.1 hotfix (FIX-B): the "Shuffle again" and "Rescan Files"
// buttons on the home page previously both used .icon-refresh -- visually
// indistinguishable on mobile, where .btn-label collapses and only the icon
// remains. Shuffle now gets its own distinct .icon-shuffle glyph; Rescan
// keeps .icon-refresh.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'index.html');
const MAIN_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'main.js');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const mainJs = fs.readFileSync(MAIN_JS_PATH, 'utf8');

test('index.html: the shuffle-again button uses a distinct .icon-shuffle icon, not .icon-refresh', () => {
  const shuffleButtonMatch = /<button[^>]*id="shuffle-again-btn"[^>]*>[\s\S]*?<\/button>/.exec(html);
  assert.ok(shuffleButtonMatch, 'expected to find the shuffle-again-btn markup');
  assert.match(shuffleButtonMatch[0], /<i class="icon-shuffle"><\/i>/);
  assert.doesNotMatch(shuffleButtonMatch[0], /icon-refresh/);
});

test('index.html: the shuffle-again button keeps its accessible name/title unchanged', () => {
  assert.match(html, /id="shuffle-again-btn"[^>]*title="Shuffle again"/);
  assert.match(html, /id="shuffle-again-btn"[^>]*aria-label="Shuffle again"/);
});

test('index.html: the rescan-library button still uses .icon-refresh', () => {
  const rescanButtonMatch = /<button[^>]*id="rescan-library-btn"[^>]*>[\s\S]*?<\/button>/.exec(html);
  assert.ok(rescanButtonMatch, 'expected to find the rescan-library-btn markup');
  assert.match(rescanButtonMatch[0], /<i class="icon-refresh"><\/i>/);
});

test('main.js: rescanBtn re-renders keep .icon-refresh (never re-render the shuffle button\'s icon at all)', () => {
  assert.doesNotMatch(mainJs, /shuffleAgainBtn\.innerHTML/, 'the shuffle button markup is static; main.js must not overwrite its icon');
  const rescanInnerHtmlMatches = mainJs.match(/rescanBtn\.innerHTML\s*=\s*'[^']*'/g) || [];
  assert.ok(rescanInnerHtmlMatches.length > 0, 'expected at least one rescanBtn.innerHTML assignment');
  for (const assignment of rescanInnerHtmlMatches) {
    assert.match(assignment, /icon-refresh/, `rescanBtn re-render should keep icon-refresh: ${assignment}`);
  }
});

test('style.css: .icon-shuffle is defined as a fixed unicode glyph, independent of the icon-set system (mirrors .icon-download/.icon-star)', () => {
  assert.match(css, /\.icon-shuffle::before\s*\{\s*content:\s*"\\1F500";?\s*\}/);
});
