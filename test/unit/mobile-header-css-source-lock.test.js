'use strict';

// [UNIT] v1.85.1 - the mobile header overrides must WIN the cascade. The v1.85 device-pass
// failure was a pure CSS cascade bug: the base rules for the search magnifier / the account
// trigger / the account dropdown lived LATER in style.css than the mobile @media overrides,
// and a media query adds NO specificity, so a same-specificity later rule won and silently
// defeated the whole mobile search + account UX.
//
// Sweep S1 (AC12, the triage's "risky conversion": convert to a RENDERED check at phone
// width, not a selector lock). The header's glyphs are ui-btn icon buttons and the account
// menu is a ui.sheet, so the Download-button and dropdown value locks this file held have no
// element left to pin. What they protected - the phone header SHOWS the magnifier (rightmost),
// HIDES the avatar, and every glyph is one evenly spaced 44px button - is now measured on
// the live page by the geometry check HDR (test/geometry/checks.js evalHeader, surface
// `header` in test/geometry/scenes.js, all eras x modes x phone/desktop; its phone scene is in
// the pre-push fast set) and mutation-proven there (hdr-cascade-hides-magnifier re-creates the
// v1.85 bug and HDR goes red). This file keeps the two source facts a render cannot name, and
// binds the replacement's wiring so it cannot be dropped silently.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const css = strip(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8'));

test('the phone magnifier-show out-specifies the LATER desktop hide (the v1.85 cascade fix, by specificity)', () => {
  const show = css.search(/header \.header-right > \.search-toggle-btn \{\s*display:\s*inline-flex;/);
  const hide = css.search(/\n\.header-right > \.search-toggle-btn \{\s*display:\s*none;/);
  assert.ok(show > 0, 'the phone show is `header .header-right > .search-toggle-btn` (0,2,1)');
  assert.ok(hide > 0, 'the desktop hide is `.header-right > .search-toggle-btn` (0,2,0)');
  assert.ok(show < hide, 'the hide sits LATER in the file - which is exactly why the show must out-specify it');
});

test('the mobile header-avatar hide is scoped under .header-right', () => {
  assert.match(css, /\.header-right \.account-menu-trigger \{\s*display:\s*none/,
    'the mobile trigger-hide must be .header-right-scoped (0,2,0) to beat the ui-btn display (0,1,0)');
});

test('(#E) the mobile header collapses to the logo-row height (no empty band under the banner)', () => {
  // v1.85 hides the search bar by default, so the mobile header no longer needs
  // the 96px two-row height; the single --mobile-header-h var (which the header
  // min-height + content offset + sticky-bar all read) is the compact 56px.
  assert.match(css, /--mobile-header-h:\s*calc\(56px \+ env\(safe-area-inset-top\)\)/,
    'the mobile header default must be the compact logo-row height, not the old 96px');
});

test('the rendered replacement is wired: the header geometry surface runs HDR on the phone, pre-push, with its cascade mutant', () => {
  const { SURFACES, FAST_SCENES } = require('../geometry/scenes.js');
  const { MUTATIONS } = require('../geometry/mutations.js');
  const header = SURFACES.find((s) => s.id === 'header');
  assert.ok(header && !header.pending, 'the header surface is live');
  assert.ok(header.checks.includes('HDR'), 'it runs HDR');
  assert.ok(!header.vps || header.vps.includes('phone'), 'on the phone');
  assert.ok(FAST_SCENES.some((f) => f.surface === 'header' && f.vp === 'phone'), 'in the pre-push fast set');
  const m = MUTATIONS['hdr-cascade-hides-magnifier'];
  assert.ok(m && m.check === 'HDR' && m.target.vp === 'phone', 'the v1.85 cascade bug is a mutation HDR must kill');
});
