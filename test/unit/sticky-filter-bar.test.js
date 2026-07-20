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
  assert.match(body, /top:\s*var\(--sticky-bar-top\)/, 'pins at the --sticky-bar-top offset (the fixed header height)');
  // Solid background so grid rows scroll UNDER it rather than showing through.
  assert.match(body, /background-color:\s*var\(--bg-color\)/, 'needs a solid background');
  // Above grid cards (z-index 2), below the sort-menu (30) and dock/modals.
  assert.match(body, /z-index:\s*20/, 'z-index 20: above cards, below the sort-menu/dock');
});

test('--sticky-bar-top is the desktop header height and is overridden to the taller mobile header', () => {
  // Base :root default = desktop 56px header.
  assert.match(css, /--sticky-bar-top:\s*56px/, 'base var is the 56px desktop header');
  // The mobile :root (inside the max-width:768px block, alongside --mobile-header-h)
  // re-points it at the taller mobile header.
  assert.match(css, /--sticky-bar-top:\s*var\(--mobile-header-h\)/, 'mobile override clears the taller header');
});

test('NEITHER the desktop NOR the mobile bare .section-title rule is made sticky (would leak the pin onto any future reuse)', () => {
  // Only the #library-content-scoped rule may pin. Check EVERY bare
  // `.section-title {` block (desktop base AND the mobile flex-wrap block), not
  // just the first — a regression that stuck the mobile bare rule would leak
  // stickiness onto any future .section-title reuse on phones specifically.
  let from = 0;
  let checked = 0;
  for (;;) {
    const idx = css.indexOf('.section-title {', from);
    if (idx === -1) break;
    // Skip the scoped rule (its match is `#library-content .section-title {`,
    // whose `.section-title {` substring starts mid-selector — detect by the
    // char just before the dot being a space preceded by 'content').
    const open = css.indexOf('{', idx);
    const close = css.indexOf('}', open);
    const preceding = css.slice(Math.max(0, idx - 20), idx);
    if (!/#library-content\s$/.test(preceding)) {
      assert.doesNotMatch(css.slice(open + 1, close), /position:\s*sticky/,
        'a bare .section-title rule near index ' + idx + ' must not be sticky');
      checked += 1;
    }
    from = close + 1;
  }
  assert.ok(checked >= 2, 'expected to check both the desktop and mobile bare .section-title rules (found ' + checked + ')');
});
