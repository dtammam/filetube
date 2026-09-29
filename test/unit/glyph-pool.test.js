'use strict';

// ---- v1.77: the glyph pool's CSS/asset completeness lock -------------------
//
// Every pool member needs FIVE disjoint enumerations in style.css plus THREE
// SVG assets. Twenty members = 100 CSS enumerations + 60 files, all of which
// would otherwise be maintained by hand. (Seven enumerations until the UI pass
// retired the emoji icon set, D2.6: its neutralize group and ::before went with it.)
//
// This repo has shipped that exact failure twice:
//   - v1.41.4: a writer of a rendered element that nobody remembered to update.
//   - v1.47.6: `.icon-share` was added to the mask block and MISSED in the
//     `@supports` fill list, so it had a mask with no colour to cut. Dean's
//     device showed "a blank box" while the four glyphs beside it rendered.
//
// So this test does not check a list I typed. It iterates the registry in
// public/js/glyph-pool.js and re-derives what style.css must contain for each
// member - including the exact mask URLs for every set.
// Adding a glyph to the pool and forgetting any one of the five sites, or
// shipping a member whose SVG is absent from any set, fails CI here.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const ICON_DIR = path.join(REPO, 'public', 'assets', 'icons');
// Comments are stripped ONCE, at read, so every check below sees only live
// CSS. Doing it per-extraction was not enough and shipped porous:
// `selectorList` stripped (site 2, and the emoji group then) and the fill-list extraction stripped
// (site 3), but the four checks that match against the raw stylesheet - the
// base mask, the rounded and filled overrides, and (then) the emoji ::before -
// did not. The adversarial seat reproduced both of Dean's on-device failure modes
// through that hole with the whole suite green:
//
//   - Comment out a base mask rule and the literal survives INSIDE the comment,
//     so site 1 passes. The glyph keeps its sizing rule and its currentColor
//     fill with no mask to cut: a SOLID COLOURED SQUARE (the AC7 class).
//   - Comment out a rounded/filled override and that set silently falls back
//     (the emoji ::before, while that set lived, rendered nothing).
//
// "Temporarily disabled, see TODO" is exactly how a real commented-out rule
// enters a stylesheet, so this is not a contrived mutant. Strip at the source
// and the whole file inherits it.
const css = fs.readFileSync(path.join(REPO, 'public', 'css', 'style.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const pool = require(path.join(REPO, 'public', 'js', 'glyph-pool.js'));
const ENTRIES = pool.allGlyphEntries();
const { ICON_SETS, effectiveMask } = require('../helpers/icon-sets');

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
    // D2.6: the emoji icon set is retired, and its codepoints with it.
    assert.ok(!('emoji' in g), `${g.id} still carries an emoji codepoint for the retired emoji set`);
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

// The @supports fill rule's SELECTOR LIST only - sliced to the `{` that opens
// the rule carrying `background-color: currentColor`, not to the declaration
// itself. (QA gate v1.77 S7: slicing to the first `background-color:
// currentColor` meant a second rule inserted above the fill rule would let a
// glyph satisfy site 3 from an unrelated selector list. This matches how
// SIZING_LIST is already bounded.)
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

test('FIVE-SITE LOCK: every glyph is enumerated in all 5 style.css sites', () => {
  const failures = [];
  for (const g of ENTRIES) {
    const cls = pool.glyphClassName(g.id);

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
    ];

    for (const [site, ok] of checks) {
      if (!ok) failures.push(`${cls}: missing site ${site}`);
    }
  }
  assert.deepEqual(failures, [],
    `glyphs missing a required style.css enumeration (a mask without a fill renders INVISIBLE):\n${failures.join('\n')}`);
});

// Sites 4/5 prove the override EXISTS; this proves it is what PAINTS. The emoji set's
// site 6 carried a scope-prefix scar (an unscoped kill blanked .icon-liked in every
// set with the suite green); its three-set form: under each set, both mask spellings
// resolve to that set's asset, so a later set-scoped kill or a prefix-only rule is red.
test('every glyph paints its own asset in every icon set (the cascade, both spellings)', () => {
  const failures = [];
  const dir = { outlined: '', rounded: 'rounded/', filled: 'filled/' };
  assert.deepEqual(Object.keys(dir), ICON_SETS, 'one directory per set on the axis');
  for (const g of ENTRIES) {
    const cls = pool.glyphClassName(g.id);
    for (const set of ICON_SETS) {
      const want = `url(/assets/icons/${dir[set]}${g.asset}.svg)`;
      const m = effectiveMask(css, set, cls);
      if (m.std !== want) failures.push(`${cls} @ ${set}: mask-image is ${m.std}, not ${want}`);
      if (m.webkit !== want) failures.push(`${cls} @ ${set}: -webkit-mask-image is ${m.webkit}, not ${want}`);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
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

test('the registry carries no literal emoji (icon-assets rule)', () => {
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

// ---- v1.77 (Dean): no two chrome glyphs may share a picture -----------------
//
// Dean, on reading the shipped-gaps disclosure: "i want downloads and shows to
// not share". `.icon-shows` (the new Shows folder glyph) and `.icon-downloads`
// (v1.73 ruling 4) had both landed on U+1F4FA TELEVISION, so in the emoji set
// two different destinations wore the same picture. Downloads moved to U+1F4FC
// VIDEOCASSETTE; Shows kept the TV.
//
// Until the UI pass this bound the emoji set's codepoints. That set is retired
// (D2.6), so the rule is bound where the pictures now are: the mask each glyph
// class paints under each of the three sets. It reads the stylesheet rather than
// the registry on purpose: `.icon-downloads` is NOT a pool member, and it was half
// of the collision.
const PICTURE_TWINS_ALLOWED = [
  // One intent: `.icon-tv` is the Shows library's own nav glyph (v1.195) and
  // `.icon-shows` the Shows pool glyph a folder can wear. Both are the TV.
  ['icon-shows', 'icon-tv'],
];

test('no two chrome glyphs share a picture in any icon set (except documented twins)', () => {
  const classes = new Set();
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/mask-image/.test(rule[2])) continue;
    for (const sel of rule[1].split(',')) {
      const m = /^\s*\.(icon-[a-z0-9-]+)\s*$/.exec(sel);
      if (m) classes.add(m[1]);
    }
  }
  // Vacuity guard: a changed rule shape must not silently empty this.
  assert.ok(classes.size >= 40, `expected to find the masked glyph classes, found ${classes.size}`);

  const allowed = new Set(PICTURE_TWINS_ALLOWED.map((pair) => pair.slice().sort().join('+')));
  const collisions = [];
  for (const set of ICON_SETS) {
    const byPicture = new Map();
    for (const cls of classes) {
      const url = effectiveMask(css, set, cls).std;
      if (!byPicture.has(url)) byPicture.set(url, []);
      byPicture.get(url).push(cls);
    }
    for (const [url, worn] of byPicture) {
      if (worn.length < 2) continue;
      if (allowed.has(worn.slice().sort().join('+'))) continue;
      collisions.push(`${set}: ${url} is worn by ${worn.join(' and ')}`);
    }
  }
  assert.deepEqual(collisions, [],
    `two chrome glyphs would render the same picture - pick a distinct one, or add the pair to PICTURE_TWINS_ALLOWED with a reason:\n${collisions.join('\n')}`);
});

test("Dean's ruling, concretely: Shows keeps the TV and Downloads never wears it, in every set", () => {
  // The general rule above would also be satisfied by moving SHOWS, which is
  // not what was ruled. This pins which one keeps the TV.
  const dir = { outlined: '', rounded: 'rounded/', filled: 'filled/' };
  for (const set of ICON_SETS) {
    const shows = effectiveMask(css, set, 'icon-shows').std;
    assert.equal(shows, `url(/assets/icons/${dir[set]}tv.svg)`, `${set}: Shows wears the TV - the literal read of a Shows folder`);
    assert.notEqual(effectiveMask(css, set, 'icon-downloads').std, shows, `${set}: Downloads does not share the TV with Shows`);
  }
});

// ---- v1.77 (adversarial gate round 2, W2): the sizing rule must still SIZE --
//
// The five-site lock binds every glyph's MEMBERSHIP in the shared sizing rule
// and slices that list off at its `{` - it never looked at what the rule
// declares. One character too early.
//
// Deleting `width: 1em; height: 1em` from that one rule turns every masked
// chrome glyph into a 0x0 inline-block: EVERY icon in the application
// disappears, every set, all 44 classes, with the whole suite green. That
// is a larger blast radius than the invisible-box bug this file was built for.
//
// The asymmetry is what makes it a finding rather than scenery: download-icon
// .test.js already bound the (since retired) EMOJI group's declarations (strengthened in
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
// is the established idiom in this stylesheet (the retired emoji set worked that
// way) - so a contradictory `.icon-shows { mask-image: none }` appended after
// the pool block would pass all five sites. Adversarial round 2, SUGGESTION.
test('no later rule overrides a pool glyph mask: the base declaration is the LAST word', () => {
  // RULE-WISE, not line-wise (adversarial round 3, ask 3). The first cut
  // anchored on `(^|\})\s*\.icon-x`, which required the class to sit at the
  // head of a rule or a line - so a single-line grouped selector
  // (`.icon-decoy, .icon-shows { mask-image: none }`) slipped past, as did the
  // `mask:` shorthand and a `-webkit-mask-image`-only kill. That last one
  // breaks WebKit ONLY, i.e. Dean's phone, which is precisely the asymmetry
  // 431a22d closed for the emoji group earlier in this same wave.
  //
  // Splitting the stylesheet into selector/body pairs and testing the class
  // token against the whole selector catches all three.
  //
  // STILL OPEN, and deliberately: `!important` on an earlier rule, and a
  // higher-specificity selector (`.sidebar-item i.icon-shows`). Both need a
  // real cascade model, which is more than a stylesheet grep should promise -
  // so this test binds DOCUMENT ORDER, not the cascade, and says so rather
  // than letting a reader assume more.
  const offenders = [];
  for (const g of ENTRIES) {
    const cls = pool.glyphClassName(g.id);
    const tok = new RegExp(`\\.${cls}(?![a-z0-9-])`);
    const values = [];
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!tok.test(rule[1])) continue;
      if (/\[data-icons=/.test(rule[1])) continue; // the deliberate per-set overrides
      const decls = [...rule[2].matchAll(/(?:^|[^-\w])(?:-webkit-)?mask(?:-image)?\s*:\s*([^;]+)/g)];
      if (decls.length) values.push(decls[decls.length - 1][1].trim());
    }
    if (values.length === 0) continue; // site 1 already covers absence
    const last = values[values.length - 1];
    if (last !== `url(/assets/icons/${g.asset}.svg)`) {
      offenders.push(`${cls}: last unscoped mask declaration is \`${last}\`, not its base asset`);
    }
  }
  assert.deepEqual(offenders, [],
    `a later rule overrides a pool glyph's mask:\n${offenders.join('\n')}`);
});

// ---- the Library FALLBACK glyphs (QA gate round 2, SUGGESTION) -------------
//
// v1.77 elevated five chrome classes into this registry's contract as
// `LIBRARY_GLYPH_SLOTS[].fallback`. They are not pool members - but they are
// what EVERY user who never opens the picker actually sees on the Downloads,
// Music, Books, Podcasts and History entries, so the wave made them part of
// what it promises while giving them none of the coverage it built.
//
// Measured before this test existed: deleting `.icon-play`'s base mask rule
// outright passed the full suite (6137 tests, 0 fail). The class stays in the
// sizing group and in the @supports fill list, so it renders a solid 1em
// currentColor square - Dean's AC7/blank-box class - on the Music entry in
// every sidebar and bottom bar.
//
// The fill-list half is already covered for these classes by v1.47.6's PARITY
// test (verified: dropping `.icon-play` from the fill list is killed there).
// The uncovered halves were the base mask rule and sizing-group membership,
// which is what this closes. The asset name is NOT hardcoded - only that a base
// mask exists - so swapping an asset stays a one-line change.
test('the five Library fallback glyphs are masked and sized, like the pool members', () => {
  const fallbacks = pool.LIBRARY_GLYPH_SLOTS.map((s) => s.fallback);
  assert.ok(fallbacks.length >= 5, `expected >=5 Library slots, got ${fallbacks.length}`);
  // Tightened at the adversarial gate (round 3, ask 4) - my first cut used
  // `[^}]*mask-image:`, which matches INSIDE `-webkit-mask-image:`. So a
  // webkit-only mask passed while FIREFOX rendered a solid square: the same
  // prefixed/standard asymmetry 431a22d closed for the emoji group earlier in
  // this wave, re-opened on a new lock. Both spellings are required now, the
  // url() must be non-empty, the asset must exist ON DISK (the ASSET LOCK above
  // iterates pool ENTRIES only, so a fallback's file was never checked), and a
  // later rule must not kill the mask (same reason).
  //
  // Left open deliberately: swapping in another VALID asset. That is the
  // "asset name is not hardcoded" design, so an asset swap stays a one-liner.
  const failures = [];
  for (const cls of fallbacks) {
    const tok = new RegExp(`\\.${cls}(?![a-z0-9-])`);
    let last = null;
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!tok.test(rule[1]) || /\[data-icons=/.test(rule[1])) continue;
      const body = rule[2];
      const webkit = /-webkit-mask-image\s*:\s*([^;]+)/.exec(body);
      const std = /(?:^|[^-\w])mask-image\s*:\s*([^;]+)/.exec(body);
      if (webkit && !std) failures.push(`${cls}: -webkit-mask-image with no standard mask-image - a solid square in Firefox`);
      if (std && !webkit) failures.push(`${cls}: mask-image with no -webkit- prefix - a solid square in older WebKit`);
      if (std) last = std[1].trim();
    }
    if (!last) {
      failures.push(`${cls}: no base mask rule - it will render as a solid currentColor square`);
    } else {
      const url = /^url\(([^)]+)\)$/.exec(last);
      if (!url || !url[1].trim()) {
        failures.push(`${cls}: its last mask declaration is \`${last}\`, not a real asset url`);
      } else {
        const asset = path.join(REPO, 'public', url[1].trim().replace(/^\//, ''));
        if (!fs.existsSync(asset)) failures.push(`${cls}: mask points at a missing file (${url[1].trim()})`);
      }
    }
    if (!listHasClass(SIZING_LIST, cls)) failures.push(`${cls}: missing from the shared sizing group`);
  }
  assert.deepEqual(failures, [],
    `Library fallback glyphs are what an untouched install shows:\n${failures.join('\n')}`);
});
