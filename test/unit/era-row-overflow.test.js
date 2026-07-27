'use strict';

// [UNIT] v1.47.5 (Dean, on-device) -- era-independent row containment.
//
// Dean: "when using the newest era everything is absolutely perfect on Mobile
// size-wise. But if I go to the earliest era the Download, Delete, Move, Like
// Share row goes a little too far off the right (not properly constrained
// within the bounds). Can you review all eras and normalize all to make them
// all fit?"
//
// ROOT CAUSE -- corrected at the v1.47.5 gate, which disproved this file's
// first version. The DOMINANT cause is button COUNT, not the era: the group
// grew from 3 to 5 (watch.html ships Download + Delete; watch.js appends Move,
// Like, Share), which overflows a 360px viewport in Roboto too. Verdana just
// makes it visible first.
//
// The era asymmetry is real but SECONDARY, and narrower than first claimed: no
// era redefines --fs-*, but each DOES set its own --density (which drives
// padding/gap), so "they differ only in font family" was false. 2005 is the
// Verdana era and also the densest, which partially counteracts it.
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

test('every era ships the SAME type scale (but NOT the same density)', () => {
  // If the eras also diverged on --fs-* tokens, "2005 overflows" could be a
  // type-scale bug. They do not. But they DO each set --density, so the width
  // difference is not font metrics alone -- an earlier version of this test
  // passed while the prose it existed to pin ("differ only in font family")
  // was false, which is exactly the failure mode a lock is supposed to prevent.
  const densities = {};
  for (const era of ERAS) {
    const block = eraBlock(era);
    assert.doesNotMatch(block, /--fs-[a-z0-9-]+\s*:/,
      `era ${era} must not redefine type-scale tokens -- the scale is global`);
    assert.match(block, /--font-family\s*:/, `era ${era} defines its own font family`);
    const density = /--density\s*:\s*([0-9]+)px/.exec(block);
    assert.ok(density, `era ${era} defines its own --density`);
    densities[era] = Number(density[1]);
  }
  // Pinned so the comment's "2005 is also the densest" stays true.
  assert.equal(densities['2005'], Math.min(...Object.values(densities)),
    '2005 must remain the tightest density -- it partially counteracts Verdana');
});

test('the DOMINANT cause is button count, not the era (5 buttons in the group)', () => {
  // watch.html ships two; watch.js appends three more. The row Dean described
  // by name -- "Download, Delete, Move, Like Share" -- is five items, which is
  // why it overflows in Roboto too.
  const WATCH_JS = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');
  const HTML = fs.readFileSync(path.join(__dirname, '../../public/watch.html'), 'utf8');
  const group = HTML.slice(HTML.indexOf('<div class="watch-action-btns">'));
  const staticBtns = (group.slice(0, group.indexOf('</div>')).match(/class="btn"/g) || []).length;
  assert.equal(staticBtns, 2, 'Download + Delete ship in markup');
  for (const appended of ['Move', 'Like', 'Share']) {
    assert.ok(new RegExp(appended, 'i').test(WATCH_JS), `${appended} is appended by watch.js`);
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

test('desktop keeps nowrap; the phone breakpoint DELIBERATELY REVERSES v1.25.4', () => {
  // Correction from the gate: v1.25.4's "Move must not orphan" rule lives INSIDE
  // the max-width:768px block, so it was exclusively a PHONE fix. This change
  // therefore reverses that guarantee on phones rather than preserving it -- the
  // right trade (unreachable off-screen content beats a second line), but it is
  // a reversal and must be disclosed as one, not framed as preserved.
  const base = CSS.slice(CSS.indexOf('.watch-action-btns {'));
  assert.match(base.slice(0, base.indexOf('}')), /flex-wrap: nowrap/,
    'the base (desktop) rule must still prefer a single row');
  // And the v1.25.4 button rule really is phone-scoped, which is what makes the
  // above a reversal rather than a preservation.
  const mobileBlock = CSS.slice(CSS.indexOf('@media (max-width: 768px)'));
  assert.ok(mobileBlock.includes('.watch-actions .btn {'),
    'v1.25.4\'s button sizing is inside the phone breakpoint -- it was never a desktop rule');
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
