'use strict';

// [UNIT] v1.106 - the top bar must clear the status-bar safe area at ALL widths,
// not just <=768px. Bug: on an installed iPad PWA in landscape (>768px, the
// DESKTOP header rule), the header ran UNDER the iPadOS status bar AFTER exiting
// native video fullscreen - because iPadOS flips the status bar from RESERVED to
// OVERLAY on exit (env(safe-area-inset-top) goes 0 -> non-zero), but the desktop
// header rule never consumed env. These source-lock the env consumption in the
// BASE (non-media-query) rules; env is 0 on a real desktop so there is no visual
// change there. Removing the env clearance reds these.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');

// The FIRST `header {` block is the base (desktop) rule; the mobile one lives
// inside the max-width:768px block further down. Slice to just the base rule.
function baseRule(selector) {
  // Line-anchored so a descendant rule (e.g. `html.reader-immersive .app-container`)
  // that appears earlier can't shadow the standalone base rule.
  const start = css.indexOf('\n' + selector + ' {');
  assert.ok(start >= 0, `${selector} base rule exists`);
  const end = css.indexOf('}', start);
  return css.slice(start, end + 1);
}

test('v1.106: the base header rule pads for the top safe-area (padding-top + height both consume env)', () => {
  const rule = baseRule('header');
  assert.match(rule, /position:\s*fixed/, 'the base fixed header rule');
  assert.match(rule, /padding:\s*env\(safe-area-inset-top\)\s+var\(--space-8\)\s+0/, 'top padding = the safe-area inset (content pushed below the status bar)');
  assert.match(rule, /height:\s*calc\(var\(--header-h\)\s*\+\s*env\(safe-area-inset-top\)\)/, 'the header box grows by the inset (border-box keeps the content row at --header-h)');
});

test('v1.106: the fixed-header clearances all consume the top safe-area at base width', () => {
  assert.match(baseRule('.app-container'), /padding-top:\s*calc\(var\(--header-h\)\s*\+\s*env\(safe-area-inset-top\)\)/, 'content clears the taller (safe-area) header');
  assert.match(baseRule('.sidebar'), /top:\s*calc\(var\(--header-h\)\s*\+\s*env\(safe-area-inset-top\)\)/, 'the fixed sidebar pins below the safe-area header');
  // --sticky-bar-top is separately bound in sticky-filter-bar.test.js.
});

test('v1.106: this is additive - env is 0 on desktop, so --header-h stays 56px (token-scale-lock authority) and desktop is unchanged', () => {
  // Guard against a regression that "simplifies" the calc back to a raw literal
  // or drops --header-h (which token-scale-lock pins at 56px).
  assert.match(css, /--header-h:\s*56px/, '--header-h is still the 56px content-height token');
});
