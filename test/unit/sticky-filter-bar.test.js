'use strict';

// [UNIT] v1.45.0 T1 -- the home filter/action bar (sort + All/Videos/Audio +
// Shuffle + Rescan) is pinned on scroll so Dean can re-shuffle mid-scroll
// without scrolling back to the top. Visual/iOS-sticky correctness is Dean's
// on-device call (no browser harness -- see CONTRIBUTING.md); this is the
// mechanical guard that the sticky rule exists, is home-scoped, has the solid
// background + z-index that keep grid rows from showing through / overlapping,
// and clears the taller mobile header.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

// The base (desktop) sticky rule.
function ruleBody(selectorLiteral) {
  const idx = css.indexOf(selectorLiteral + ' {');
  assert.notStrictEqual(idx, -1, 'expected a `' + selectorLiteral + '` rule in style.css');
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

test('the home filter bar is sticky and HOME-SCOPED (not the bare .section-title, so other views are untouched)', () => {
  const body = ruleBody('#library-content .section-title');
  assert.match(body, /position:\s*sticky/, 'must be position: sticky');
  assert.match(body, /top:\s*56px/, 'pins below the fixed 56px desktop header');
  // Solid background so grid rows scroll UNDER it rather than showing through.
  assert.match(body, /background-color:\s*var\(--bg-color\)/, 'needs a solid background');
  // Above grid cards (z-index 2), below the sort-menu (30) and dock/modals.
  assert.match(body, /z-index:\s*20/, 'z-index 20: above cards, below the sort-menu/dock');
});

test('the mobile override clears the taller --mobile-header-h, and stays home-scoped', () => {
  // A separate #library-content .section-title rule inside the mobile block
  // overrides `top` -- assert one of them carries the mobile-header var.
  const re = /#library-content \.section-title\s*\{[^}]*top:\s*var\(--mobile-header-h\)/;
  assert.match(css, re, 'mobile sticky top must clear var(--mobile-header-h)');
});

test('the bare .section-title is NOT made sticky (would leak the pin onto any future reuse)', () => {
  // The generic `.section-title` rule (font-size/flex) must stay non-sticky;
  // only the #library-content-scoped rule pins.
  const generic = ruleBody('.section-title');
  assert.doesNotMatch(generic, /position:\s*sticky/, 'the unscoped rule must not be sticky');
});
