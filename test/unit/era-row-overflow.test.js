'use strict';

// [UNIT] v1.47.5 (Dean, on-device) -- era-independent row containment.
//
// Dean: "when using the newest era everything is absolutely perfect on Mobile
// size-wise. But if I go to the earliest era the Download, Delete, Move, Like
// Share row goes a little too far off the right (not properly constrained
// within the bounds). Can you review all eras and normalize all to make them
// all fit?"
//
// THE ROOT CAUSE IS AN ERA ASYMMETRY, and these tests pin it so it cannot drift:
// all four eras share an IDENTICAL type scale and differ only in --font-family.
// 2005 is the sole era on Verdana (~10% wider than Arial/Roboto), so the same
// tokens and padding produce a wider button group in exactly one era.
//
// A CSS/layout-blind test suite cannot measure "does it fit" -- that is Dean's
// device pass (this repo's own v1.45.2 lesson). What IS mechanically checkable,
// and what actually guarantees containment, is the STRUCTURAL property: a
// wrapping flex row's min-content width is its widest single item, whereas a
// nowrap row's is the SUM of its items. Only the former can never overflow.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');

const ERAS = ['2005', '2009', '2014', '2021'];

function eraBlock(era) {
  const marker = `[data-theme="${era}"] {`;
  const start = CSS.indexOf(marker);
  assert.notEqual(start, -1, `expected an era block for ${era}`);
  return CSS.slice(start, CSS.indexOf('}', start));
}

// ---- the asymmetry itself --------------------------------------------------

test('every era ships the SAME type scale -- only the font family differs', () => {
  // This is what makes the diagnosis specific rather than a guess: if the eras
  // also diverged on --fs-* tokens, "2005 overflows" could be a token bug. They
  // do not, so the width difference is font metrics alone.
  for (const era of ERAS) {
    const block = eraBlock(era);
    assert.doesNotMatch(block, /--fs-[a-z0-9-]+\s*:/,
      `era ${era} must not redefine type-scale tokens -- the scale is global`);
    assert.match(block, /--font-family\s*:/, `era ${era} defines its own font family`);
  }
});

test('2005 is the wide-font outlier (documents WHY it, and only it, overflowed)', () => {
  assert.match(eraBlock('2005'), /--font-family:\s*Verdana/,
    'the diagnosis depends on 2005 being the Verdana era');
  for (const era of ['2009', '2014', '2021']) {
    assert.doesNotMatch(eraBlock(era), /Verdana/, `era ${era} should not be on Verdana`);
  }
});

// ---- the structural guarantee ---------------------------------------------

test('CONTAINMENT: the watch action group wraps at the phone breakpoint', () => {
  // The fix that actually holds for any era, any font, and any future button
  // added to the group. Per-era padding tuning would only move the font size at
  // which it breaks.
  // Anchored on the LAST occurrence: the base (desktop) rule appears earlier in
  // the file than the phone breakpoint's override, and an earlier `@media
  // (max-width: 768px)` block sits above the base rule too -- so slicing from
  // the first media query would pick up the base rule and pass/fail wrongly.
  const rule = CSS.slice(CSS.lastIndexOf('.watch-action-btns {'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.notEqual(CSS.indexOf('.watch-action-btns {'), CSS.lastIndexOf('.watch-action-btns {'),
    'expected BOTH a base rule and a distinct mobile override');
  assert.match(body, /flex-wrap: wrap/,
    'a nowrap row min-contents to the SUM of its items and therefore overflows');
  assert.match(body, /max-width: 100%/, 'it must never exceed its container');
  assert.match(body, /min-width: 0/, 'and must be allowed to shrink below intrinsic width');
});

test('desktop keeps the nowrap preference (the v1.25.4 "Move must not orphan" intent)', () => {
  // The base rule is unchanged; only the phone breakpoint relaxes it. Wrapping
  // everywhere would regress a deliberate desktop layout for no benefit -- there
  // is room there.
  const base = CSS.slice(CSS.indexOf('.watch-action-btns {'));
  assert.match(base.slice(0, base.indexOf('}')), /flex-wrap: nowrap/,
    'the base (desktop) rule must still prefer a single row');
});

test('the fix is font-independent -- no era-scoped override was used to paper over it', () => {
  // A `[data-theme="2005"] .watch-action-btns`-style patch would "fix" Dean's
  // report while leaving the same latent overflow for any future wide font, and
  // would rot silently. The containment must be structural, not per-era.
  assert.doesNotMatch(CSS, /\[data-theme="\d{4}"\][^{]*\.watch-action-btns/,
    'containment must not be implemented as a per-era special case');
  assert.doesNotMatch(CSS, /\[data-theme="\d{4}"\][^{]*\.watch-actions \.btn/,
    'nor as a per-era button-size special case');
});
