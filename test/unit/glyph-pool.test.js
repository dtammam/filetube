'use strict';

// ---- v1.77: the glyph pool's CSS/asset completeness lock -------------------
//
// Every pool member needs SEVEN disjoint enumerations in style.css plus THREE
// SVG assets. Twenty members = 140 CSS enumerations + 60 files, all of which
// would otherwise be maintained by hand.
//
// This repo has shipped that exact failure twice:
//   - v1.41.4: a writer of a rendered element that nobody remembered to update.
//   - v1.47.6: `.icon-share` was added to the mask block and MISSED in the
//     `@supports` fill list, so it had a mask with no colour to cut. Dean's
//     device showed "a blank box" while the four glyphs beside it rendered.
//
// So this test does not check a list I typed. It iterates the registry in
// public/js/glyph-pool.js and re-derives what style.css must contain for each
// member - including the exact mask URLs and the exact emoji codepoint escape.
// Adding a glyph to the pool and forgetting any one of the seven sites, or
// shipping a member whose SVG is absent from any set, fails CI here.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const ICON_DIR = path.join(REPO, 'public', 'assets', 'icons');
const css = fs.readFileSync(path.join(REPO, 'public', 'css', 'style.css'), 'utf8');

const pool = require(path.join(REPO, 'public', 'js', 'glyph-pool.js'));
const ENTRIES = pool.allGlyphEntries();

// The registry is the spec; if it silently emptied, every assertion below
// would vacuously pass. (A test that can't fail is the "self-proof" trap this
// repo logged in v1.75/v1.76 - bind the count, not just the loop.)
test('registry sanity: the pool is non-empty and every entry is well-formed', () => {
  assert.ok(ENTRIES.length >= 20, `expected >=20 glyph entries, got ${ENTRIES.length}`);
  const ids = new Set();
  for (const g of ENTRIES) {
    assert.match(g.id, /^[a-z][a-z0-9-]*$/, `bad glyph id: ${g.id}`);
    assert.ok(!ids.has(g.id), `duplicate glyph id: ${g.id}`);
    ids.add(g.id);
    assert.match(g.asset, /^[a-z][a-z0-9_]*$/, `bad asset name for ${g.id}: ${g.asset}`);
    assert.match(g.emoji, /^[0-9A-F]{4,6}( [0-9A-F]{4,6})*$/, `bad emoji codepoints for ${g.id}: ${g.emoji}`);
    assert.ok(g.name && typeof g.name === 'string', `missing display name for ${g.id}`);
  }
});

// Extracts a grouped selector list (everything from `start` up to its `{`),
// with CSS comments stripped. The strip is not cosmetic: these lists are
// checked for `.icon-foo` membership, and a comment that merely MENTIONS a
// class would otherwise satisfy the check for a glyph that was never actually
// added - a false green on the exact invariant this file exists to hold. That
// is the v1.50 lesson ("source-lock regexes must strip comments") applied
// before it can bite rather than after.
function selectorList(start) {
  const i = css.indexOf(start);
  assert.notEqual(i, -1, `expected to find the selector list starting at: ${start}`);
  const brace = css.indexOf('{', i);
  assert.notEqual(brace, -1, `unterminated selector list at: ${start}`);
  return css.slice(i, brace).replace(/\/\*[\s\S]*?\*\//g, '');
}

const SIZING_LIST = selectorList('\n.icon-home,\n');
const EMOJI_GROUP = selectorList('\n[data-icons="emoji"] .icon-home,\n');

// The @supports fill rule's SELECTOR LIST only - sliced to the `{` that opens
// the rule carrying `background-color: currentColor`, not to the declaration
// itself. (QA gate v1.77 S7: slicing to the first `background-color:
// currentColor` meant a second rule inserted above the fill rule would let a
// glyph satisfy site 3 from an unrelated selector list. This matches how
// SIZING_LIST and EMOJI_GROUP are already bounded.)
const FILL_BLOCK = (() => {
  const i = css.indexOf('@supports (mask-image: url("#"))');
  assert.notEqual(i, -1, 'expected the @supports fill block');
  const decl = css.indexOf('background-color: currentColor', i);
  assert.notEqual(decl, -1, 'expected the currentColor fill declaration');
  // Walk back to the `{` that opens the rule containing that declaration, then
  // forward from whichever comes LATER: the @supports block's own `{`, or the
  // `}` of the last rule preceding this one inside it. Both bounds are needed -
  // the first cut of this fix used only the @supports brace, and a decoy rule
  // inserted above the fill rule still satisfied the check (caught by
  // mutation-testing the fix itself, not by review).
  const ruleBrace = css.lastIndexOf('{', decl);
  const supportsBrace = css.indexOf('{', i);
  assert.ok(ruleBrace > supportsBrace,
    'expected the fill declaration inside a rule nested in the @supports block');
  const prevRuleEnd = css.lastIndexOf('}', ruleBrace);
  const start = Math.max(supportsBrace, prevRuleEnd) + 1;
  return css.slice(start, ruleBrace).replace(/\/\*[\s\S]*?\*\//g, '');
})();

// A class token must match WHOLE - `.icon-work` must not be satisfied by
// `.icon-work-thing`, and `.icon-star` must not be satisfied by matching
// inside `.icon-star-rating`. Without this the whole lock is porous.
function listHasClass(list, cls) {
  return new RegExp(`\\.${cls}(?![a-z0-9-])`).test(list);
}

test('SEVEN-SITE LOCK: every glyph is enumerated in all 7 style.css sites', () => {
  const failures = [];
  for (const g of ENTRIES) {
    const cls = pool.glyphClassName(g.id);
    const emojiEsc = g.emoji.split(' ').map((c) => '\\' + c).join('');

    const checks = [
      ['1 base mask', css.includes(
        `.${cls} { -webkit-mask-image: url(/assets/icons/${g.asset}.svg); mask-image: url(/assets/icons/${g.asset}.svg); }`)],
      ['2 sizing list', listHasClass(SIZING_LIST, cls)],
      // The one that made v1.47.6 an invisible box on Dean's device.
      ['3 @supports fill list', listHasClass(FILL_BLOCK, cls)],
      ['4 rounded override', css.includes(
        `[data-icons="rounded"] .${cls} { -webkit-mask-image: url(/assets/icons/rounded/${g.asset}.svg); mask-image: url(/assets/icons/rounded/${g.asset}.svg); }`)],
      ['5 filled override', css.includes(
        `[data-icons="filled"] .${cls} { -webkit-mask-image: url(/assets/icons/filled/${g.asset}.svg); mask-image: url(/assets/icons/filled/${g.asset}.svg); }`)],
      // Without this the emoji set paints a solid currentColor box BEHIND the
      // emoji (the AC7 no-square fix).
      ['6 emoji neutralize group', listHasClass(EMOJI_GROUP, cls)],
      ['7 emoji ::before content', new RegExp(
        `\\[data-icons="emoji"\\] \\.${cls}::before\\s*\\{\\s*content: "${emojiEsc.replace(/\\/g, '\\\\')}";`).test(css)],
    ];

    for (const [site, ok] of checks) {
      if (!ok) failures.push(`${cls}: missing site ${site}`);
    }
  }
  assert.deepEqual(failures, [],
    `glyphs missing a required style.css enumeration (a mask without a fill renders INVISIBLE):\n${failures.join('\n')}`);
});

test('ASSET LOCK: every glyph ships a valid SVG in all three vector sets', () => {
  const missing = [];
  for (const g of ENTRIES) {
    for (const dir of ['', 'rounded', 'filled']) {
      const p = path.join(ICON_DIR, dir, `${g.asset}.svg`);
      if (!fs.existsSync(p)) { missing.push(`${dir || 'outlined'}/${g.asset}.svg`); continue; }
      const svg = fs.readFileSync(p, 'utf8');
      if (!svg.includes('<svg') || !svg.includes('<path') || svg.trim().length < 120) {
        missing.push(`${dir || 'outlined'}/${g.asset}.svg (present but not a usable icon)`);
      }
    }
  }
  assert.deepEqual(missing, [], `pool assets missing or unusable:\n${missing.join('\n')}`);
});

test('the registry carries codepoints, never literal emoji (icon-assets rule)', () => {
  // The repo's rule is that chrome emoji live in CSS as \XXXX escapes, never as
  // literal characters in HTML/JS. icon-assets.test.js enforces that for a
  // fixed 12-glyph list across five named files - glyph-pool.js is NOT one of
  // them, so this file is what holds the rule here rather than inheriting it
  // (QA gate v1.77 S2: the comment used to cite icon-assets.test.js as if its
  // coverage were repo-wide).
  const src = fs.readFileSync(path.join(REPO, 'public', 'js', 'glyph-pool.js'), 'utf8');
  const literalEmoji = src.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
  assert.equal(literalEmoji, null,
    `glyph-pool.js must carry codepoints, not literal emoji (found: ${literalEmoji && literalEmoji.join(' ')})`);
});
