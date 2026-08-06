'use strict';

// [UNIT] v1.85.1 - source-lock the mobile header overrides at the SPECIFICITY
// that makes them win. The v1.85 device-pass failure was a pure CSS cascade bug:
// the base rules for .search-toggle-btn / .account-menu-trigger /
// .account-menu-dropdown live LATER in style.css than the mobile @media
// overrides, and a media query adds NO specificity, so a same-specificity later
// rule won and silently defeated the whole mobile search + account UX. The fix
// scopes each override under `.header-right` (0,2,0) so it beats its (0,1,0)
// base regardless of source order. This binds that the scoped form survives -
// a revert to the bare `.search-toggle-btn {...}` form goes red here. (It cannot
// prove the cascade in general - CSS cascade is a device concern - but it pins
// this exact fix.)

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

test('the magnifier show is scoped under .header-right (out-specifies the base display:none)', () => {
  assert.match(css, /\.header-right \.search-toggle-btn \{\s*display:\s*inline-flex/,
    'the mobile magnifier-show must be .header-right-scoped to beat the later base rule');
});

test('the mobile header-avatar hide is scoped under .header-right', () => {
  assert.match(css, /\.header-right \.account-menu-trigger \{\s*display:\s*none/,
    'the mobile trigger-hide must be .header-right-scoped');
});

test('the mobile account dropdown bottom-sheet is scoped under .header-right', () => {
  assert.match(css, /\.header-right \.account-menu-dropdown \{[^}]*position:\s*fixed/,
    'the mobile bottom-sheet reposition must be .header-right-scoped');
});

test('(#E) the mobile header collapses to the logo-row height (no empty band under the banner)', () => {
  // v1.85 hides the search bar by default, so the mobile header no longer needs
  // the 96px two-row height; the single --mobile-header-h var (which the header
  // min-height + content offset + sticky-bar all read) is the compact 56px.
  assert.match(css, /--mobile-header-h:\s*calc\(56px \+ env\(safe-area-inset-top\)\)/,
    'the mobile header default must be the compact logo-row height, not the old 96px');
});

test('(#D) the one-off Download button is un-hidden on mobile via id specificity', () => {
  // The v1.82 `.header-right .btn { display:none }` (0,2,0) hides it on phones;
  // the id selector (1,1,0) beats it so the button shows in the top-right.
  assert.match(css, /\.header-right #ytdlp-oneoff-btn \{\s*display:\s*inline-flex/,
    'the mobile Download exemption must use the id selector to out-specify the .btn hide');
});

test('(v1.86.0) the mobile Download button is GLYPH-ONLY (its .btn-label is hidden; desktop keeps the word)', () => {
  assert.match(css, /\.header-right #ytdlp-oneoff-btn \.btn-label \{\s*display:\s*none/,
    'mobile Download hides its .btn-label -> glyph-only');
});

test('(v1.86.1 Dean) the mobile Download button drops the .btn box (bell/search styling) and is sized to match the siblings', () => {
  const rule = (css.match(/\.header-right #ytdlp-oneoff-btn \{[^}]*\}/) || [''])[0];
  assert.match(rule, /background:\s*none/, 'no .btn background box');
  assert.match(rule, /border:\s*none/, 'no .btn border box');
  assert.match(rule, /border-radius:\s*var\(--radius-full\)/, 'circular hit area like the bell');
  assert.match(rule, /font-size:\s*var\(--fs-4xl\)/, 'sized to the 22px header-glyph box (== bell/queue SVG), not the small .btn --fs-sm');
});

test('(v1.86.0) the search magnifier owns the far-right corner (order) + a split gap + a touch larger', () => {
  const rule = (css.match(/\.header-right \.search-toggle-btn \{[^}]*order:\s*1[^}]*\}/) || [''])[0];
  assert.ok(rule, 'a .header-right .search-toggle-btn rule sets order:1 (rightmost corner)');
  assert.match(rule, /margin-left:\s*var\(--space-6\)/, 'a split gap before the search glyph');
  assert.match(rule, /font-size:\s*var\(--fs-4xl\)/, 'the search glyph is sized to the uniform 22px header-glyph box');
});
