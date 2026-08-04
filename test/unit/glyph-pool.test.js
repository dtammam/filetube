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
// Comments are stripped ONCE, at read, so every check below sees only live
// CSS. Doing it per-extraction was not enough and shipped porous:
// `selectorList` stripped (sites 2 and 6) and the fill-list extraction stripped
// (site 3), but the four checks that match against the raw stylesheet - the
// base mask, the rounded and filled overrides, and the emoji ::before - did
// not. The adversarial seat reproduced both of Dean's on-device failure modes
// through that hole with the whole suite green:
//
//   - Comment out a base mask rule and the literal survives INSIDE the comment,
//     so site 1 passes. The glyph keeps its sizing rule and its currentColor
//     fill with no mask to cut: a SOLID COLOURED SQUARE (the AC7 class).
//   - Comment out a rounded/filled override or an emoji ::before and that set
//     silently falls back or renders nothing.
//
// "Temporarily disabled, see TODO" is exactly how a real commented-out rule
// enters a stylesheet, so this is not a contrived mutant. Strip at the source
// and the whole file inherits it.
const css = fs.readFileSync(path.join(REPO, 'public', 'css', 'style.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

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
      //
      // The SCOPE PREFIX is part of the assertion, not decoration. Membership
      // alone was satisfied by a line that had lost its `[data-icons="emoji"]`
      // prefix - and an unscoped entry in this group is WORSE than absence: it
      // applies `mask-image: none; background-color: transparent` in EVERY set,
      // so the glyph renders nothing at all in the default outlined theme. The
      // adversarial seat reproduced that on `.icon-liked` (all ten Liked
      // surfaces blank) with the suite green.
      ['6 emoji neutralize group', new RegExp(
        `\\[data-icons="emoji"\\]\\s+\\.${cls}(?![a-z0-9-])`).test(EMOJI_GROUP)],
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
  // The range must cover every codepoint the registry actually uses. The first
  // cut was [1F300-1FAFF, 2600-27BF], which misses U+2B50 ⭐ - the emoji for
  // `.icon-favorites` AND `.icon-liked`, i.e. two of this wave's own entries.
  // A literal ⭐ here passed the full suite (adversarial gate, SUGGESTION 2).
  // Widened to the Miscellaneous Symbols and Arrows block, which is where 2B50
  // lives. U+FE0F (the variation selector) is deliberately NOT in the class:
  // eslint's no-misleading-character-class rejects it there - it COMBINES with
  // the preceding character rather than standing alone - and it is not an emoji
  // by itself, so every glyph that uses one is already caught by its base
  // codepoint. (The pre-commit hook refused this commit until that was right,
  // which is the hook doing its job.)
  const literalEmoji = src.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu);
  assert.equal(literalEmoji, null,
    `glyph-pool.js must carry codepoints, not literal emoji (found: ${literalEmoji && literalEmoji.join(' ')})`);
});

// ---- v1.77 (Dean): no two chrome glyphs may share an emoji codepoint -------
//
// Dean, on reading the shipped-gaps disclosure: "i want downloads and shows to
// not share". `.icon-shows` (the new Shows folder glyph) and `.icon-downloads`
// (v1.73 ruling 4) had both landed on U+1F4FA TELEVISION, so in the emoji set
// two different destinations wore the same picture. Downloads moved to U+1F4FC
// VIDEOCASSETTE; Shows kept the TV.
//
// This binds the RULE rather than that one pair, because nothing bound the
// downloads codepoint at all before now - a typo there, or the next glyph that
// reaches for an obvious emoji, would have been invisible to the whole suite.
// It reads the stylesheet rather than the registry on purpose: `.icon-downloads`
// is NOT a pool member, and it was half of the collision.
const EMOJI_TWINS_ALLOWED = [
  // Deliberate: same picture, different intents, kept as separate classes so
  // the Liked lane's glyph can change later without dragging every folder that
  // chose "Favorites" along with it. Documented in glyph-pool.js.
  ['icon-favorites', 'icon-liked'],
];

test('no two emoji-set glyphs share a codepoint (except documented twins)', () => {
  const byCodepoint = new Map();
  const re = /\[data-icons="emoji"\]\s*\.(icon-[a-z0-9-]+)::before\s*\{\s*content:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    if (!byCodepoint.has(m[2])) byCodepoint.set(m[2], []);
    byCodepoint.get(m[2]).push(m[1]);
  }
  // Vacuity guard: a changed rule shape must not silently empty this.
  assert.ok(byCodepoint.size >= 30,
    `expected to find the emoji-set glyphs, found ${byCodepoint.size} codepoints`);

  const allowed = new Set(EMOJI_TWINS_ALLOWED.map((pair) => pair.slice().sort().join('+')));
  const collisions = [];
  for (const [cp, classes] of byCodepoint) {
    if (classes.length < 2) continue;
    if (allowed.has(classes.slice().sort().join('+'))) continue;
    collisions.push(`${cp} is worn by ${classes.join(' and ')}`);
  }
  assert.deepEqual(collisions, [],
    `two chrome glyphs would render the same emoji - pick a distinct one, or add the pair to EMOJI_TWINS_ALLOWED with a reason:\n${collisions.join('\n')}`);
});

test("Dean's ruling, concretely: Shows keeps the TV and Downloads wears a tape", () => {
  // The general rule above would also be satisfied by moving SHOWS, which is
  // not what was ruled. This pins which one moved.
  assert.match(css, /\[data-icons="emoji"\] \.icon-shows::before \{ content: "\\1F4FA"; \}/,
    'Shows keeps U+1F4FA TELEVISION - a TV is the literal read of a Shows folder');
  assert.match(css, /\[data-icons="emoji"\] \.icon-downloads::before \{ content: "\\1F4FC"; \}/,
    'Downloads wears U+1F4FC VIDEOCASSETTE (moved from the TV it shared with Shows)');
});

// ---- v1.77 (adversarial gate round 2, W2): the sizing rule must still SIZE --
//
// The seven-site lock binds every glyph's MEMBERSHIP in the shared sizing rule
// and slices that list off at its `{` - it never looked at what the rule
// declares. One character too early.
//
// Deleting `width: 1em; height: 1em` from that one rule turns every masked
// chrome glyph into a 0x0 inline-block: EVERY icon in the application
// disappears, all four sets, all 44 classes, with the whole suite green. That
// is a larger blast radius than the invisible-box bug this file was built for.
//
// The asymmetry is what makes it a finding rather than scenery: download-icon
// .test.js already binds the EMOJI group's declarations (strengthened in
// 431a22d), and this file already extracts this rule's selector list.
test('the shared sizing rule still SIZES: membership in it is worthless if its body is gone', () => {
  const brace = css.indexOf('{', css.indexOf('\n.icon-home,\n'));
  assert.notEqual(brace, -1, 'expected the shared icon sizing rule');
  const decls = css.slice(brace, css.indexOf('}', brace));
  for (const d of [
    'display: inline-block',           // without it, width/height do not apply
    'width: 1em', 'height: 1em',       // without these, every glyph is 0x0
    '-webkit-mask-size: contain', 'mask-size: contain',
    '-webkit-mask-repeat: no-repeat', 'mask-repeat: no-repeat',
  ]) {
    assert.ok(decls.includes(d),
      `the shared icon sizing rule lost \`${d}\` - EVERY masked glyph in the app is affected`);
  }
});

// A later duplicate rule silently overrides an earlier one, and later-override
// is the established idiom in this stylesheet (the whole emoji set works that
// way) - so a contradictory `.icon-shows { mask-image: none }` appended after
// the pool block would pass all seven sites. Adversarial round 2, SUGGESTION.
test('no later rule overrides a pool glyph mask: the base declaration is the LAST word', () => {
  const offenders = [];
  for (const g of ENTRIES) {
    const cls = pool.glyphClassName(g.id);
    // Every unscoped `mask-image` declaration for this exact class token, in
    // document order. Set-scoped rules ([data-icons=...]) are the deliberate
    // overrides and are excluded.
    const re = new RegExp(`(^|\\})\\s*\\.${cls}(?![a-z0-9-])[^{}]*\\{[^}]*?(?:^|[^-])mask-image:\\s*([^;]+);`, 'gms');
    const values = [...css.matchAll(re)].map((m) => m[2].trim());
    if (values.length === 0) continue; // site 1 already covers absence
    const last = values[values.length - 1];
    if (last !== `url(/assets/icons/${g.asset}.svg)`) {
      offenders.push(`${cls}: last unscoped mask-image is \`${last}\`, not its base asset`);
    }
  }
  assert.deepEqual(offenders, [],
    `a later rule overrides a pool glyph's mask:\n${offenders.join('\n')}`);
});
