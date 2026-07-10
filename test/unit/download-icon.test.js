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
  assert.match(css, /\.icon-download\s*\{\s*-webkit-mask-image:\s*url\(\/assets\/icons\/download\.svg\);\s*mask-image:\s*url\(\/assets\/icons\/download\.svg\);\s*\}/);
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
  // NOTE: v1.25.4 appended `.icon-shuffle` to this same selector group
  // (see shuffle-rescan-icon.test.js) -- `.icon-download,` may now be
  // followed by one more selector line before the opening `{`, so the
  // pattern allows (but does not require) that.
  const neutralizeMatch = /\[data-icons="emoji"\] \.icon-home,[\s\S]*?\.icon-download,?[\s\S]{0,80}?\{([\s\S]*?)\}/.exec(css);
  assert.ok(neutralizeMatch, 'expected .icon-download to be listed in the emoji neutralize group');
  assert.match(neutralizeMatch[1], /mask-image:\s*none/);
  assert.match(neutralizeMatch[1], /background-color:\s*transparent/);
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
