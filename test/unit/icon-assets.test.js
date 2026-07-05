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

test('icon assets: all Material Symbol SVGs are bundled and valid', () => {
  for (const name of EXPECTED) {
    const p = path.join(ICON_DIR, `${name}.svg`);
    assert.ok(fs.existsSync(p), `missing icon: ${name}.svg`);
    const svg = fs.readFileSync(p, 'utf8');
    assert.ok(svg.includes('<svg'), `${name}.svg is not an SVG`);
    assert.ok(svg.trim().length > 20, `${name}.svg is empty`);
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
  // not in this list or the checked file set.
  const CHROME = ['🌙', '☀️', '🔄', '▲', '▼', '☰', '🏠', '📁', '⚙', '🗑', '🔍'];
  for (const f of ['index.html', 'setup.html', 'watch.html', 'js/common.js', 'js/main.js']) {
    const c = fs.readFileSync(path.join(PUB, f), 'utf8');
    for (const emoji of CHROME) {
      assert.ok(!c.includes(emoji), `stray chrome emoji ${emoji} still in ${f}`);
    }
  }
});
