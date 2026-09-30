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

test('AC1: the Settings picker lists exactly the live skins (each blurb: setup-music-skin-picker.test.js)', () => {
  const skins = require('../../public/js/music-skins.js');
  assert.deepStrictEqual(skins.SKINS.map((s) => s.label), ['Cider','Nordic','Classic 4G White (2004)','Classic 4G Special Edition (2004)','Classic 5G White (2005)','Classic 5G Black (2005)','Classic 6G Silver (2007)','Classic 6G Black (2007)','Classic 6G Black (2008)','Mini 1G Silver (2004)','Mini 1G Gold (2004)','Mini 1G Blue (2004)','Mini 1G Pink (2004)','Mini 1G Green (2004)','Mini 2G Blue (2005)','Mini 2G Green (2005)','Mini 2G Pink (2005)','Mini 2G Silver (2005)','Nano 2G Green (2006)','Nano 2G Blue (2006)','Nano 2G Pink (2006)','Nano 2G Red (2006)','Nano 2G Silver (2006)','Nano 2G Black (2006)','Nano 3G Silver (2007)','Nano 3G Blue (2007)','Nano 3G Green (2007)','Nano 3G Red (2007)','Nano 3G Pink (2008)','Nano 3G Black (2007)','Nano 4G Blue (2008)','Nano 4G Purple (2008)','Nano 4G Orange (2008)','Nano 4G Yellow (2008)','Nano 4G Silver (2008)','Nano 4G Green (2008)','Nano 4G Pink (2008)','Nano 4G Black (2008)','Nano 4G Red (2008)','Nano 5G Green (2009)','Nano 5G Orange (2009)','Nano 5G Pink (2009)','Nano 5G Silver (2009)','Nano 5G Blue (2009)','Nano 5G Purple (2009)','Nano 5G Yellow (2009)','Nano 5G Black (2009)','Nano 5G Red (2009)','Nano 6G Green (2010)','Nano 6G Orange (2010)','Nano 6G Pink (2010)','Nano 6G Silver (2010)','Nano 6G Graphite (2010)','Nano 6G Blue (2010)','Nano 6G Red (2010)','Nano 7G Pink (2012)','Nano 7G Yellow (2012)','Nano 7G Blue (2015)','Nano 7G Green (2012)','Nano 7G Purple (2012)','Nano 7G Slate (2012)','Nano 7G Red (2012)','Nano 7G Space Gray (2013)','Nano 7G Gold (2015)','Nano 7G Blue (2012)','Nano 7G Silver (2012)','Nano 7G Space Gray (2015)','Nano 7G Pink (2015)','Nano 7G Red (2015)','Shuffle 2G Purple (2007)','Shuffle 2G Green (2008)','Shuffle 2G Gold (2009)','Shuffle 2G Silver (2005)','Shuffle 2G Pink (2007)','Shuffle 2G Green (2007)','Shuffle 2G Blue (2007)','Shuffle 2G Orange (2007)','Shuffle 2G Teal (2007)','Shuffle 2G Red (2007)','Shuffle 2G Light Green (2007)','Shuffle 2G Blue (2008)','Shuffle 2G Red (2008)','Shuffle 2G Pink (2008)','Shuffle 3G Pink (2009)','Shuffle 3G Blue (2009)','Shuffle 3G Silver (2009)','Shuffle 3G Black (2009)','Shuffle 3G Green (2009)','Shuffle 3G Stainless Steel (2009)','Shuffle 4G Blue (2010)','Shuffle 4G Silver (2010)','Shuffle 4G Green (2010)','Shuffle 4G Orange (2010)','Shuffle 4G Pink (2010)','Shuffle 4G Pink (2012)','Shuffle 4G Yellow (2012)','Shuffle 4G Blue (2012)','Shuffle 4G Green (2012)','Shuffle 4G Purple (2012)','Shuffle 4G Silver (2012)','Shuffle 4G Slate (2012)','Shuffle 4G Red (2012)','Shuffle 4G Space Gray (2013)','Shuffle 4G Gold (2015)','Shuffle 4G Space Gray (2015)','Shuffle 4G Blue (2015)','Shuffle 4G Pink (2015)','Shuffle 4G Red (2015)','Shuffle 1G White (2005)','Nano 1G Black (2005)','Nano 1G White (2005)','Touch 1G-3G Black (2007)','Touch 4G Black (2010)','Touch 4G White (2011)','Touch 5G Black and Slate (2012)','Touch 5G White and Silver (2012)','Touch 5G Pink (2012)','Touch 5G Yellow (2012)','Touch 5G Blue (2012)','Touch 5G Red (2012)','Touch 5G Space Gray (2013)','Touch 6G-7G Blue (2015)','Touch 6G-7G Silver (2015)','Touch 6G-7G Gold (2015)','Touch 6G-7G Space Gray (2015)','Touch 6G-7G Pink (2015)','Touch 6G-7G Red (2015)','Custom 5G Transparent (2005)','Click (Original)']);
  assert.ok(!skins.SKINS.some((s) => s.menus && s.menus !== 'click'), 'no second pocket-menu style survives');
});
