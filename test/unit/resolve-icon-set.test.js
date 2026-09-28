'use strict';

// resolveIconSet lives in the browser common.js, which exposes it to Node via
// a `typeof module` guard purely for this test. Mirrors
// test/unit/resolve-theme.test.js's style/pattern exactly.
//
// UI pass D2.6: the icon sets are outlined | rounded | filled. The emoji set is
// retired: a stored `emoji` (this device's ft-icons, a prefs-sync row, or the
// v1.43 user-settings mirror) resolves to `filled`, and auto maps every retro era
// to `filled`. The same mapping lives in each shell's inline FOUC bootstrap, and
// the second half of this file RUNS every one of those bootstraps against
// resolveIconSet, so a shell that drifts goes red here.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  resolveIconSet, migrateIconPref, ICON_SETS, ICON_SET_REGISTRY, AUTO_ERA_ICON_MAP,
} = require('../../public/js/common.js');
const FTIcons = require('../../public/js/icons.js');
const { liveCss, scopedSetNames } = require('../helpers/icon-sets');

const ROOT = path.join(__dirname, '..', '..');

test('resolveIconSet: explicit outlined pref wins regardless of era', () => {
  assert.strictEqual(resolveIconSet('outlined', '2021'), 'outlined');
});

test('resolveIconSet: explicit rounded pref wins regardless of era', () => {
  assert.strictEqual(resolveIconSet('rounded', '2005'), 'rounded');
});

test('resolveIconSet: explicit filled pref wins regardless of era', () => {
  assert.strictEqual(resolveIconSet('filled', '2014'), 'filled');
});

test('resolveIconSet: a stored emoji pref (the retired set) resolves to filled at every era', () => {
  for (const era of ['2005', '2009', '2014', '2021', 'bogus', null]) {
    assert.strictEqual(resolveIconSet('emoji', era), 'filled', `emoji at era ${era}`);
  }
});

test('migrateIconPref: only the retired emoji id is rewritten; everything else passes through', () => {
  assert.strictEqual(migrateIconPref('emoji'), 'filled');
  for (const v of ['outlined', 'rounded', 'filled', 'auto', 'bogus', '', null, undefined, 'constructor', 'toString']) {
    assert.strictEqual(migrateIconPref(v), v, `passes ${String(v)} through`);
  }
});

test('resolveIconSet: auto maps 2005 to filled', () => {
  assert.strictEqual(resolveIconSet('auto', '2005'), 'filled');
});

test('resolveIconSet: auto maps 2009 to filled', () => {
  assert.strictEqual(resolveIconSet('auto', '2009'), 'filled');
});

test('resolveIconSet: auto maps 2014 to filled', () => {
  assert.strictEqual(resolveIconSet('auto', '2014'), 'filled');
});

test('resolveIconSet: auto maps 2021 to rounded', () => {
  assert.strictEqual(resolveIconSet('auto', '2021'), 'rounded');
});

test('resolveIconSet: auto with an unrecognized era falls back to the default era mapping', () => {
  assert.strictEqual(resolveIconSet('auto', '2050'), 'rounded'); // DEFAULT_ERA is '2021' -> rounded
});

test('resolveIconSet: nothing stored (null) defaults to outlined at any era', () => {
  assert.strictEqual(resolveIconSet(null, '2014'), 'outlined');
});

test('resolveIconSet: an unrecognized stored value falls back to outlined', () => {
  assert.strictEqual(resolveIconSet('bogus', '2021'), 'outlined');
});

// ---- D2.6: the axis is exactly three sets, everywhere it is spelled ---------

test('the axis is outlined | rounded | filled: ICON_SETS, the auto map, the picker and the sprite registry agree', () => {
  assert.deepStrictEqual(ICON_SETS, ['outlined', 'rounded', 'filled']);
  assert.deepStrictEqual(AUTO_ERA_ICON_MAP, { 2005: 'filled', 2009: 'filled', 2014: 'filled', 2021: 'rounded' });
  assert.deepStrictEqual(ICON_SET_REGISTRY.map((s) => s.id), ['auto', 'outlined', 'rounded', 'filled'],
    'the Settings picker offers Auto plus the three sets, no Emoji');
  assert.deepStrictEqual(Object.keys(FTIcons.ICONS).sort(), [...ICON_SETS].sort(),
    'the sprite registry draws exactly the three sets');
});

test('no stylesheet scopes a rule to a set outside the axis (the emoji rules are gone, not orphaned)', () => {
  const names = scopedSetNames(liveCss());
  assert.ok(names.includes('rounded') && names.includes('filled'), `vacuity guard: found ${names.join(', ')}`);
  const stray = names.filter((n) => !ICON_SETS.includes(n));
  assert.deepStrictEqual(stray, [], `[data-icons] rules for sets that no longer exist: ${stray.join(', ')}`);
});

// ---- the inline FOUC bootstraps, executed ------------------------------------
//
// Every shell resolves data-icons in <head> before paint with its own copy of
// resolveIconSet. Each copy is run here in a vm with a stub localStorage and
// <html>, over every stored value x era, and must agree with resolveIconSet.

const SHELLS = [
  ...fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html')).map((f) => path.join('public', f)),
  path.join('lib', 'ytdlp', 'views', 'subscriptions.html'),
];

function bootstrapScript(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const head = html.slice(0, html.indexOf('<body'));
  const scripts = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return scripts.find((s) => s.includes("getItem('ft-icons')")) || null;
}

function runBootstrap(src, store) {
  const attrs = {};
  const documentElement = {
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    style: { setProperty() {} },
  };
  const sandbox = {
    localStorage: { getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null) },
    document: { documentElement },
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent: 'node' },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(src, sandbox);
  return attrs;
}

const bootShells = SHELLS.map((rel) => [rel, bootstrapScript(rel)]).filter(([, src]) => src);

test('every shell with an icon bootstrap is found (13 of them)', () => {
  assert.strictEqual(bootShells.length, 13, `found: ${bootShells.map(([r]) => r).join(', ')}`);
});

for (const [rel, src] of bootShells) {
  test(`${rel}: the inline FOUC bootstrap resolves data-icons exactly like resolveIconSet (emoji -> filled, the new auto map)`, () => {
    for (const era of ['2005', '2009', '2014', '2021', null, 'bogus']) {
      for (const icons of ['emoji', 'auto', 'outlined', 'rounded', 'filled', 'bogus', null]) {
        const store = {};
        if (era !== null) store['ft-era'] = era;
        if (icons !== null) store['ft-icons'] = icons;
        const attrs = runBootstrap(src, store);
        assert.strictEqual(attrs['data-icons'], resolveIconSet(icons, attrs['data-theme']),
          `${rel}: ft-icons=${icons} ft-era=${era} (data-theme ${attrs['data-theme']})`);
      }
    }
    assert.strictEqual(runBootstrap(src, { 'ft-icons': 'emoji' })['data-icons'], 'filled', `${rel}: a stored emoji paints filled`);
    assert.strictEqual(runBootstrap(src, { 'ft-icons': 'auto', 'ft-era': '2005' })['data-icons'], 'filled', `${rel}: auto at 2005 paints filled`);
  });
}
