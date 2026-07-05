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
];

// icon-sets extends the outlined set above with two more full 12-icon vector
// sets, bundled under subdirectories using the SAME glyph names as `outlined`
// except for the filled set's two documented substitutes (README.md).
const ROUNDED_EXPECTED = EXPECTED;
const FILLED_EXPECTED = [
  'home', 'folder', 'settings', 'search', 'menu', 'play_arrow', 'delete',
  'refresh', 'keyboard_arrow_up', 'keyboard_arrow_down',
  'wb_sunny', 'brightness_2', // substitutes for light_mode/dark_mode (see README.md)
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
  const CHROME = ['🌙', '☀️', '🔄', '▲', '▼', '☰', '🏠', '📁', '⚙', '🗑', '🔍'];
  for (const f of ['index.html', 'setup.html', 'watch.html', 'js/common.js', 'js/main.js']) {
    const c = fs.readFileSync(path.join(PUB, f), 'utf8');
    for (const emoji of CHROME) {
      assert.ok(!c.includes(emoji), `stray chrome emoji ${emoji} still in ${f}`);
    }
  }
});
