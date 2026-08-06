'use strict';

// [UNIT] FR-7 (v1.17.0, T6): the download icon moves from a hardcoded fixed
// Unicode glyph (`.icon-download::before { content: "\2B07"; }`, independent
// of the icon-set system) to a real Material-Symbols SVG mask, wired into
// every icon-set block exactly like every other chrome icon (e.g.
// `.icon-delete`) -- see public/css/style.css's icon-set-axis section and
// public/assets/icons/README.md. The actual visual rendering across icon
// sets/eras/light-dark is device/manual (no headless-browser harness in this
// repo -- see CONTRIBUTING.md); these are the mechanical invariants that ARE
// checkable: the asset exists in all 3 vector sets, the CSS wires
// `.icon-download` into the same rule groups as its siblings, and the old
// fixed-glyph rule is gone.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

test('style.css: the OLD fixed-unicode .icon-download::before rule is gone', () => {
  assert.doesNotMatch(css, /\.icon-download::before\s*\{\s*content:\s*"\\2B07"/,
    'the old hardcoded "\\2B07" downwards-arrow rule should have been removed by FR-7');
});

test('style.css: .icon-download is in the base currentColor mask group, alongside .icon-delete', () => {
  const baseGroupMatch = /\.icon-home,[\s\S]*?\.icon-download\s*\{/.exec(css);
  assert.ok(baseGroupMatch, 'expected .icon-download to be listed in the base mask-group selector');
  assert.match(baseGroupMatch[0], /\.icon-delete,/, 'the base group should still include .icon-delete');
});

test('style.css: .icon-download has an outlined (default) mask-image assignment', () => {
  // v1.87.0 (Dean): the DEFAULT-set download mask is now INLINED as a data-URI
  // (first-paint icon - no async /assets fetch, so it no longer pops in on a
  // mobile PWA cold start). The rounded/filled variants below stay url(/assets).
  assert.match(css, /^\.icon-download \{ -webkit-mask-image: url\("data:image\/svg\+xml,[^"]+"\); mask-image: url\("data:image\/svg\+xml,[^"]+"\); \}/m,
    'the default .icon-download mask is an inlined data-URI (v1.87.0 first-paint inlining)');
});

test('style.css: .icon-download participates in the @supports currentColor fill guard', () => {
  const supportsBlockMatch = /@supports \(mask-image: url\("#"\)\)[\s\S]*?\{([\s\S]*?)\}\n\}/.exec(css);
  assert.ok(supportsBlockMatch, 'expected the @supports currentColor fill guard block');
  assert.match(supportsBlockMatch[1], /\.icon-download/, 'the fill guard should cover .icon-download too');
});

test('style.css: [data-icons="rounded"] wires .icon-download to rounded/download.svg', () => {
  assert.match(css, /\[data-icons="rounded"\]\s*\.icon-download\s*\{\s*-webkit-mask-image:\s*url\(\/assets\/icons\/rounded\/download\.svg\);\s*mask-image:\s*url\(\/assets\/icons\/rounded\/download\.svg\);\s*\}/);
});

test('style.css: [data-icons="filled"] wires .icon-download to filled/download.svg', () => {
  assert.match(css, /\[data-icons="filled"\]\s*\.icon-download\s*\{\s*-webkit-mask-image:\s*url\(\/assets\/icons\/filled\/download\.svg\);\s*mask-image:\s*url\(\/assets\/icons\/filled\/download\.svg\);\s*\}/);
});

test('style.css: [data-icons="emoji"] neutralizes the .icon-download mask (no solid box) and supplies an emoji ::before', () => {
  // NOTE: v1.25.4 appended `.icon-shuffle` to this same selector group (see
  // shuffle-rescan-icon.test.js), and the pattern was widened to a {0,80}
  // window after `.icon-download,` to tolerate it. v1.77 appended 20 pool
  // glyphs to the same group, blew past that window, and the lazy match then
  // found the WRONG block entirely (the `::before` rule below), failing on a
  // change that broke nothing.
  //
  // Rewritten to extract the group by its real bounds and assert MEMBERSHIP
  // plus the group's declarations - which is what this lock is actually for.
  // Both mutants it exists to kill still fail it (re-verified in the v1.77 fix
  // round): dropping `.icon-download` from the group, and dropping either
  // declaration. Comments are stripped so one naming a class cannot satisfy
  // the membership check (the v1.50 source-lock lesson).
  const groupStart = css.indexOf('[data-icons="emoji"] .icon-home,');
  assert.notEqual(groupStart, -1, 'expected the emoji neutralize group');
  const groupBrace = css.indexOf('{', groupStart);
  const selectors = css.slice(groupStart, groupBrace).replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = css.slice(groupBrace, css.indexOf('}', groupBrace));
  assert.match(selectors, /\.icon-download(?![a-z0-9-])/, 'expected .icon-download to be listed in the emoji neutralize group');
  // v1.77: these were one `/mask-image:\s*none/` assertion, which the PREFIXED
  // `-webkit-mask-image: none` already satisfies - so deleting the STANDARD
  // property survived the lock (found by mutation-testing the rewrite above
  // against its own commit; it was porous before that rewrite too, and the
  // rewrite carried it forward unchanged). Dropping the standard property
  // leaves the mask applied in every non-WebKit browser, i.e. Firefox shows a
  // masked box behind the emoji. Both properties are now bound separately.
  assert.match(declarations, /-webkit-mask-image:\s*none/, 'the webkit-prefixed mask kill');
  assert.match(declarations, /(^|[^-\w])mask-image:\s*none/m, 'the STANDARD mask kill (non-WebKit browsers)');
  assert.match(declarations, /background-color:\s*transparent/);
  assert.match(css, /\[data-icons="emoji"\]\s*\.icon-download::before\s*\{\s*content:\s*"\\1F4E5";?\s*\}/,
    'expected an emoji ::before for .icon-download (U+1F4E5 inbox tray)');
});

test('icon assets: the new download.svg files are self-hosted (no CDN references)', () => {
  for (const f of ['assets/icons/download.svg', 'assets/icons/rounded/download.svg', 'assets/icons/filled/download.svg']) {
    const p = path.join(__dirname, '..', '..', 'public', f);
    assert.ok(fs.existsSync(p), `missing ${f}`);
    const svg = fs.readFileSync(p, 'utf8');
    assert.ok(!/googleapis|gstatic/i.test(svg), `${f} must not reference a CDN`);
  }
});
