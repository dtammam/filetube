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

// Comments stripped ONCE at read (the v1.50.3 lock lesson, re-struck by the
// transcript-wave gate): a comment quoting `.watch-action-btns .btn { ... }`
// must never satisfy - or defeat - these locks.
const CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

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

test('the DOMINANT cause is button count, not the era (now 8 buttons in the group incl. More)', () => {
  // watch.html ships two (Download + Delete); watch.js appends three more
  // (Move, Like, Share) -- the five-item row of the original overflow
  // diagnosis. v1.63 (DELIBERATE lock update): the queue verbs (Queue +
  // Next) join the markup, making four static / seven total. The
  // CONTAINMENT test below is the structural guarantee that holds for any
  // count ("any future button added to the group" -- its own words), and
  // both new buttons wrap their words in .btn-label, the phone-collapse
  // treatment. The seven-item row at phone widths is a NAMED device probe
  // for Dean in the v1.63 Stop packet.
  const WATCH_JS = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');
  const HTML = fs.readFileSync(path.join(__dirname, '../../public/watch.html'), 'utf8');
  const group = HTML.slice(HTML.indexOf('<div class="watch-action-btns">'));
  const staticBtns = (group.slice(0, group.indexOf('</div>')).match(/class="btn"/g) || []).length;
  // v1.202 DELIBERATE lock update: the compact-mode "More" button joins the
  // markup (hidden outside compact mode). Four static -> five.
  assert.equal(staticBtns, 5, 'Download + Delete + Queue + Next + More ship in markup');
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

test('the base (desktop) rule WRAPS too since the transcript wave, and the buttons themselves NEVER deform (Dean 2026-08-28)', () => {
  // History: v1.25.4's "Move must not orphan" rule lived INSIDE the
  // max-width:768px block (a PHONE fix); v1.47.5 reversed it on phones
  // (wrap beats unreachable off-screen content) while the desktop base rule
  // stayed nowrap. The transcript wave (2026-08-28) MEASURED what desktop
  // nowrap really did once the row grew to 10-11 buttons: a row wider than
  // its column SHRINKS its items - "Mark watched" broke onto two lines and
  // every button grew 31->42px at 1280/1366/1600. Dean's ruling ("do it
  // once, do it right", codified in docs/CONTRIBUTING.md): the GROUP wraps
  // at every width and a BUTTON never shrinks or line-breaks. This test
  // would FAIL against the old `flex-wrap: nowrap` base rule.
  const base = CSS.slice(CSS.indexOf('.watch-action-btns {'));
  assert.match(base.slice(0, base.indexOf('}')), /flex-wrap: wrap/,
    'the base (desktop) rule must let the group wrap - a nowrap row deforms its buttons instead');
  const btn = /\.watch-action-btns \.btn \{([^}]*)\}/.exec(CSS);
  assert.ok(btn, 'a base .watch-action-btns .btn rule (the no-deform rule) must exist');
  assert.match(btn[1], /white-space: nowrap;/, 'a button label never line-breaks');
  assert.match(btn[1], /flex-shrink: 0;/, 'a button never shrinks below its natural width');
  assert.match(btn[1], /line-height: var\(--lh-relaxed\);/,
    'uniform line-height: <a class="btn"> (Download) and <button>s had different natural heights (31 vs 28), exposed by a wrapped second row');
  // The v1.25.4 button rule really is phone-scoped (its sizing lives in the
  // phone breakpoint) - still true, still the reason the phone story is a
  // reversal rather than a preservation.
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

// ---- v1.47.6: labels hidden at phone widths (Dean's follow-up) -------------
//
// After v1.47.5 the row was CONTAINED but Share still dropped to a second line
// in Original (Verdana) and Classic (Arial), while Flat (Arial) / Modern (Geist
// since v1.107, Roboto before) fit --
// an exact font-width ordering, confirming the row was only marginally over
// budget. Five labelled buttons cannot fit a ~328px content box in a wide font;
// five glyphs fit any font with room to spare. Same treatment `.section-actions`
// already uses (v1.45.3), so this is the established pattern here.

test('the five action labels are hidden at the phone breakpoint (glyphs remain)', () => {
  const mobile = CSS.slice(CSS.indexOf('@media (max-width: 768px)'));
  assert.match(mobile, /\.watch-action-btns \.btn \.btn-label \{\s*display: none;\s*\}/,
    'the words must be dropped at phone widths -- padding tuning cannot recover ~60px');
});

test('wrapping is RETAINED as the safety net, not replaced by the label hiding', () => {
  // Hiding labels makes overflow unlikely; flex-wrap makes it impossible. If a
  // future change re-adds a sixth button, the wrap is what still saves it.
  const rule = CSS.slice(CSS.lastIndexOf('.watch-action-btns {'));
  assert.match(rule.slice(0, rule.indexOf('}')), /flex-wrap: wrap/,
    'the structural guarantee must survive the aesthetic fix');
});

test('every label-bearing action button also carries a GLYPH (or hiding it empties the button)', () => {
  const WATCH_JS = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');
  const HTML = fs.readFileSync(path.join(__dirname, '../../public/watch.html'), 'utf8');
  // Download + Delete ship in markup with their icons.
  const group = HTML.slice(HTML.indexOf('<div class="watch-action-btns">'));
  const groupHtml = group.slice(0, group.indexOf('</div>'));
  assert.match(groupHtml, /icon-download[\s\S]*?btn-label">Download/);
  assert.match(groupHtml, /icon-delete[\s\S]*?btn-label">Delete/);
  // Move/Like/Share are appended by watch.js -- each needs an icon, because a
  // hidden label on an icon-less button renders as a blank tap target.
  for (const [icon, label] of [['icon-folder', 'Move'], ['icon-heart', 'Like'], ['icon-share', 'Share']]) {
    assert.ok(WATCH_JS.includes(`'${icon}'`), `${label} must carry the ${icon} glyph`);
  }
});

test('the Like button no longer uses a unicode heart (v1.38 lesson: glyphs in CSS, never emoji)', () => {
  const WATCH_JS = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');
  // iOS renders emoji codepoints inconsistently, and .icon-heart has existed
  // since v1.40 -- the old "there is no heart glyph" comment was long stale.
  assert.ok(!WATCH_JS.includes('Liked ♥'), 'the unicode heart must be gone from the Like label');
});

test('the share glyph asset exists and is mapped (base dir, like heart.svg)', () => {
  const svg = path.join(__dirname, '../../public/assets/icons/share.svg');
  assert.ok(fs.existsSync(svg), 'share.svg must exist');
  assert.match(fs.readFileSync(svg, 'utf8'), /^<svg[^>]*viewBox="0 -960 960 960"/,
    'must match the icon set\'s established viewBox');
  assert.match(CSS, /\.icon-share \{[^}]*mask-image: url\(\/assets\/icons\/share\.svg\)/);
  // Per-set overrides are enumerated individually, so a base-only icon falls
  // back correctly in every set -- exactly how .icon-heart already behaves.
  assert.doesNotMatch(CSS, /\[data-icons="[a-z]+"\] \.icon-share/,
    'no per-set override is needed (or wanted) for a base-only glyph');
});
