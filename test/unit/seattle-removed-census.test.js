'use strict';

// [UNIT] v1.332 (Dean, D6): the Seattle skin is removed ENTIRELY - its registry entry, renderer,
// pivots, swipe, pad-moves-pivot, Games row, two-line lists, Metro screen, tokens and CSS. AC1's
// census: none of its vocabulary survives in public/, scripts/ or test/ (comments stripped once at
// read, so a comment can neither hide a live use nor fail the census), except the ONE legacy-map
// entry that moves a saved Seattle device onto Click (D1) and the tests that bind that map.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const FORBIDDEN = [/zune-classic/i, /seattle/i, /znc-/i, /mms-zn-/i, /pivot/i, /data-skin-swipe/i];
// The legacy map's own tests (they name the retired id on purpose) and this census.
const TEST_ALLOW = new Set([
  'test/unit/music-skins.test.js',
  'test/integration/music-pocket-menus.test.js',
  'test/unit/seattle-removed-census.test.js',
]);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|css|html|mjs|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
// Comments out ONCE at read: block comments everywhere, line comments in scripts (a `//` inside a
// URL string keeps its line - the lookbehind skips `:` so `http://` survives).
function stripComments(src, file) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/\.(js|mjs|cjs|html)$/.test(file)) s = s.replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');
  if (/\.html$/.test(file)) s = s.replace(/<!--[\s\S]*?-->/g, '');
  return s;
}

test('AC1: no Seattle vocabulary survives in public/, scripts/ or test/ (comments stripped) except the legacy map and its tests', () => {
  const files = [...walk(path.join(ROOT, 'public'), []), ...walk(path.join(ROOT, 'scripts'), []), ...walk(path.join(ROOT, 'test'), [])];
  assert.ok(files.length > 100, 'precondition: the census reads the tree (' + files.length + ' files)');
  const hits = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (TEST_ALLOW.has(rel)) continue;
    const lines = stripComments(fs.readFileSync(f, 'utf8'), rel).split('\n');
    lines.forEach((line, i) => {
      if (!FORBIDDEN.some((re) => re.test(line))) return;
      // the ONE allowed survivor: the legacy map entry in the registry module
      if (rel === 'public/js/music-skins.js' && /^\s*var LEGACY_IDS = \{ 'zune-classic': 'ipod' \};\s*$/.test(line)) return;
      hits.push(rel + ':' + (i + 1) + ': ' + line.trim().slice(0, 140));
    });
  }
  assert.deepStrictEqual(hits, [], 'Seattle vocabulary left behind');
});

test('AC1: the legacy map is the retired id\'s ONLY home in the registry module, and the census would catch a revival', () => {
  const src = stripComments(fs.readFileSync(path.join(ROOT, 'public', 'js', 'music-skins.js'), 'utf8'), 'x.js');
  assert.strictEqual((src.match(/zune-classic/g) || []).length, 1, 'exactly one live mention: the legacy map entry');
  // the census is not vacuous: a revived registry entry trips its first pattern
  assert.ok(FORBIDDEN.some((re) => re.test("{ id: 'zune-classic', label: 'Seattle', base: 'ipod' }")));
  assert.ok(FORBIDDEN.some((re) => re.test("'[data-skin-swipe]'")));
});

test('AC1: the Settings picker lists exactly the live skins, each with a blurb', () => {
  const skins = require('../../public/js/music-skins.js');
  assert.deepStrictEqual(skins.SKINS.map((s) => s.label), ['Cider', 'Nordic', 'Click', 'Click (Black)', 'Click (Matte)', 'Click (Red)', 'Click (Silver)', 'Click (Encore)', 'Click (Blue)', 'Click (Green)', 'Click (Pink)', 'Click (Gold)']);
  assert.ok(!skins.SKINS.some((s) => s.menus && s.menus !== 'click'), 'no second pocket-menu style survives');
});
