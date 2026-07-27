'use strict';

// CI regression guards for the icon-asset system (the visual rendering itself is
// device/manual, but these mechanical invariants ARE checkable): the SVGs are
// bundled, nothing references a CDN, and no replaced chrome emoji crept back in.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', '..', 'public');
const ICON_DIR = path.join(PUB, 'assets', 'icons');
const EXPECTED = [
  'home', 'folder', 'settings', 'search', 'dark_mode', 'light_mode',
  'menu', 'play_arrow', 'delete', 'refresh', 'keyboard_arrow_up', 'keyboard_arrow_down',
  'download', // FR-7 (v1.17.0, T6): real download.svg mask, added across all 3 vector sets
  'shuffle', // v1.25.4 fix: replaces the old fixed ::before emoji glyph with a
             // real mask, added across all 3 vector sets (see README.md)
];

// icon-sets extends the outlined set above with two more full 13-icon vector
// sets, bundled under subdirectories using the SAME glyph names as `outlined`
// except for the filled set's two documented substitutes + one documented
// rename (README.md).
const ROUNDED_EXPECTED = EXPECTED;
const FILLED_EXPECTED = [
  'home', 'folder', 'settings', 'search', 'menu', 'play_arrow', 'delete',
  'refresh', 'keyboard_arrow_up', 'keyboard_arrow_down',
  'wb_sunny', 'brightness_2', // substitutes for light_mode/dark_mode (see README.md)
  'download', // renamed from the source's file_download for cross-set filename parity (see README.md)
  'shuffle', // v1.25.4 fix: real filled/shuffle.svg mask (see README.md)
];

test('icon assets: all Material Symbol SVGs are bundled and valid', () => {
  for (const name of EXPECTED) {
    const p = path.join(ICON_DIR, `${name}.svg`);
    assert.ok(fs.existsSync(p), `missing icon: ${name}.svg`);
    const svg = fs.readFileSync(p, 'utf8');
    assert.ok(svg.includes('<svg'), `${name}.svg is not an SVG`);
    assert.ok(svg.trim().length > 20, `${name}.svg is empty`);
  }
});

test('icon assets: all Material Symbols Rounded SVGs are bundled and valid', () => {
  for (const name of ROUNDED_EXPECTED) {
    const p = path.join(ICON_DIR, 'rounded', `${name}.svg`);
    assert.ok(fs.existsSync(p), `missing rounded icon: ${name}.svg`);
    const svg = fs.readFileSync(p, 'utf8');
    assert.ok(svg.includes('<svg'), `rounded/${name}.svg is not an SVG`);
    assert.ok(svg.trim().length > 20, `rounded/${name}.svg is empty`);
  }
});

test('icon assets: all Material Icons Classic (filled) SVGs are bundled and valid', () => {
  for (const name of FILLED_EXPECTED) {
    const p = path.join(ICON_DIR, 'filled', `${name}.svg`);
    assert.ok(fs.existsSync(p), `missing filled icon: ${name}.svg`);
    const svg = fs.readFileSync(p, 'utf8');
    assert.ok(svg.includes('<svg'), `filled/${name}.svg is not an SVG`);
    assert.ok(svg.trim().length > 20, `filled/${name}.svg is empty`);
  }
});

test('icon assets: no CDN (googleapis/gstatic) references in served CSS/HTML', () => {
  for (const f of ['css/style.css', 'index.html', 'setup.html', 'watch.html']) {
    const c = fs.readFileSync(path.join(PUB, f), 'utf8');
    assert.ok(!/googleapis|gstatic/i.test(c), `CDN reference found in ${f} (icons must be fully self-hosted)`);
  }
});

test('icon assets: no replaced chrome emoji remains in markup/JS', () => {
  // These were swapped for Material Symbols. Allowed to remain: the gold ★/☆
  // rating glyphs, the ▶▶ speed badge, and emoji inside mock comment TEXT
  // (public/js/watch.js) — those are content/ratings, not UI chrome, so they're
  // not in this list or the checked file set. style.css is intentionally
  // EXCLUDED from this check (icon-sets): it now carries these same 12 glyphs
  // on purpose, as \XXXX CSS unicode escapes, for the 'emoji' icon set's
  // ::before content — see public/css/style.css's [data-icons="emoji"] block
  // and public/assets/icons/README.md. HTML/JS must still contain zero
  // literal emoji chars — only CSS may.
  const CHROME = ['🌙', '☀️', '🔄', '▲', '▼', '☰', '🏠', '📁', '⚙', '🗑', '🔍', '🔀'];
  for (const f of ['index.html', 'setup.html', 'watch.html', 'js/common.js', 'js/main.js']) {
    const c = fs.readFileSync(path.join(PUB, f), 'utf8');
    for (const emoji of CHROME) {
      assert.ok(!c.includes(emoji), `stray chrome emoji ${emoji} still in ${f}`);
    }
  }
});

// ---- v1.47.6 hotfix: mask-image WITHOUT a fill renders nothing -------------
//
// Dean, on-device: the new Share button was "a blank box" while the other four
// glyphs rendered correctly. Cause: a mask-icon needs TWO enumerated selector
// lists in style.css -- the sizing/mask block AND the `@supports` block that
// paints `background-color: currentColor`. `.icon-share` was added to the first
// and missed in the second, so it had a mask but no colour to cut: invisible.
//
// That is this repo's recurring "enumerate every writer" class (v1.41.4). This
// test kills the CLASS rather than the instance: every icon with a mask-image
// must also be in the fill list, so the next icon added cannot repeat it.

const styleCssForFillParity = fs.readFileSync(
  path.join(__dirname, '../../public/css/style.css'), 'utf8');

test('PARITY: every mask-image icon is also in the @supports currentColor fill list', () => {
  // Base (non-set-scoped) mask declarations, e.g. `.icon-share { -webkit-mask-image: ... }`
  const masked = new Set(
    [...styleCssForFillParity.matchAll(/^\.(icon-[a-z-]+) \{ -webkit-mask-image:/gm)]
      .map((m) => m[1]),
  );
  assert.ok(masked.size >= 5, `expected to find mask-icon declarations (found ${masked.size})`);

  const supportsIdx = styleCssForFillParity.indexOf('@supports (mask-image: url("#"))');
  assert.notEqual(supportsIdx, -1, 'expected the @supports fill block');
  const block = styleCssForFillParity.slice(supportsIdx, styleCssForFillParity.indexOf('}', styleCssForFillParity.indexOf('background-color: currentColor', supportsIdx)));

  const missing = [...masked].filter((cls) => !block.includes(`.${cls}`));
  assert.deepEqual(missing, [],
    `these icons declare a mask but are never painted, so they render INVISIBLE: ${missing.join(', ')}`);
});

test('the share glyph is fully wired (mask + fill + sizing), matching .icon-heart', () => {
  // .icon-heart is the closest precedent: base-directory svg, no per-set
  // override, three enumerated entries. Share must match it exactly.
  for (const cls of ['icon-heart', 'icon-share']) {
    assert.match(styleCssForFillParity, new RegExp(`^\\.${cls} \\{ -webkit-mask-image:`, 'm'), `${cls} mask`);
    assert.match(styleCssForFillParity, new RegExp(`\\.${cls},`), `${cls} sizing list`);
    assert.match(styleCssForFillParity, new RegExp(`\\.${cls}[,)]`), `${cls} referenced in a selector list`);
  }
  const supportsIdx = styleCssForFillParity.indexOf('@supports (mask-image: url("#"))');
  const fillBlock = styleCssForFillParity.slice(supportsIdx, supportsIdx + 600);
  assert.ok(fillBlock.includes('.icon-share'), 'share must be painted, or it is an invisible box');
  assert.ok(fillBlock.includes('.icon-heart'), 'sanity: heart is painted (the precedent)');
});
