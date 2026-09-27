'use strict';

// [UNIT] UI professionalism pass, plan D4.2 / AC4: the icon registry.
// - public/js/icons.js is exactly what tools/icons/build.js makes from tools/icons/src
//   (a hand edit or a stale build fails), and every <path> of every source survives
//   (F29: the old Podcasts glyph kept one path of three, and a lock pinned the broken one).
// - Every name exists in all three sets, with its .fill twin where listed.
// - Every icon the app references exists (F39: the Shows tile fell back to `info`).
// - The sprite injects at the top of <body>, hidden, and swaps with the icon set.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const build = require('../../tools/icons/build.js');
const { NAMES, FILL, STYLES } = require('../../tools/icons/names.js');
const FTIcons = require('../../public/js/icons.js');

test('icons.js is the build of tools/icons/src, byte for byte (no hand edits, not stale)', () => {
  assert.equal(fs.readFileSync(build.OUT, 'utf8'), build.render(build.registry()),
    'run node tools/icons/build.js and commit the result');
});

test('every <path> of every source is kept, in order (F29)', () => {
  for (const set of Object.keys(STYLES)) {
    const dir = path.join(ROOT, 'tools', 'icons', 'src', set);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
      const svg = fs.readFileSync(path.join(dir, file), 'utf8');
      const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
      const entry = FTIcons.ICONS[set][file.replace(/\.svg$/, '')];
      assert.ok(entry, `${set}/${file} is in the registry`);
      assert.equal(typeof entry === 'string' ? entry : entry[1], paths.join(''), `${set}/${file}: all ${paths.length} path(s)`);
    }
  }
});

test('every name is in all three sets, and every FILL name has its .fill twin', () => {
  assert.deepStrictEqual(Object.keys(FTIcons.ICONS).sort(), ['filled', 'outlined', 'rounded']);
  const expected = NAMES.flatMap((n) => (FILL.includes(n) ? [n, `${n}.fill`] : [n])).sort();
  for (const set of Object.keys(FTIcons.ICONS)) {
    assert.deepStrictEqual(Object.keys(FTIcons.ICONS[set]).sort(), expected, `${set} carries exactly the listed names`);
  }
});

// Every `#i-NAME` the app references, from shells, views and client JS.
function referencedIcons() {
  const files = [];
  const walk = (dir, re) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['vendor', 'critters', 'assets', 'fonts'].includes(e.name)) walk(p, re); } else if (re.test(e.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'public'), /\.(html|js)$/);
  walk(path.join(ROOT, 'lib', 'ytdlp'), /\.(html|js)$/);
  const refs = new Map();
  for (const f of files) {
    if (f.endsWith(path.join('js', 'icons.js'))) continue;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/href="#i-([a-z0-9_-]+)"/g)) refs.set(m[1], path.relative(ROOT, f));
  }
  return refs;
}

test('every referenced icon exists in the registry (no silent blank glyph, F39)', () => {
  const ids = new Set(FTIcons.names().map((n) => FTIcons.symbolId(n).slice(2)));
  const refs = referencedIcons();
  assert.ok(refs.size >= 10, `the shells reference the sprite (${refs.size} names found)`);
  const missing = [...refs].filter(([id]) => !ids.has(id)).map(([id, f]) => `${id} (${f})`);
  assert.deepStrictEqual(missing, []);
});

test('every chrome glyph name maps to a registry icon', () => {
  const { CHROME_ICON } = require('../../public/js/common.js');
  for (const [name, reg] of Object.entries(CHROME_ICON)) assert.ok(FTIcons.has(reg), `CHROME_ICON.${name} -> ${reg}`);
});

test('inject(): a hidden sprite as the FIRST child of <body>, swapped in place on a set change', () => {
  const dom = new JSDOM('<!doctype html><html data-icons="rounded"><body><header id="h"></header></body></html>');
  const doc = dom.window.document;
  const sprite = FTIcons.inject(undefined, doc);
  assert.equal(doc.body.firstChild, sprite, 'first in body, so every later <use> resolves on first paint');
  assert.ok(sprite.hasAttribute('hidden'));
  // [hidden] is HTML-namespace only in the UA sheet: an SVG sprite needs its own rule, or it
  // keeps a 300x150 box and pushes the page down (caught in the step 2 render, desktop Home).
  assert.equal(sprite.getAttribute('width'), '0');
  assert.equal(sprite.getAttribute('height'), '0');
  const css = require('../helpers/stylesheets').readAllCss().replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /#ft-icon-sprite\s*\{\s*display:\s*none;\s*\}/, 'the sprite is display:none by stylesheet');
  assert.equal(sprite.getAttribute('aria-hidden'), 'true');
  assert.equal(sprite.getAttribute('data-set'), 'rounded', 'defaults to <html data-icons>');
  const home = doc.getElementById('i-home');
  assert.equal(home.querySelector('path').getAttribute('d'), FTIcons.ICONS.rounded.home);
  assert.ok(doc.getElementById('i-keep-fill'), 'fill twins get a -fill id');
  FTIcons.inject('filled', doc);
  assert.equal(doc.querySelectorAll('#ft-icon-sprite').length, 1, 'one sprite, never stacked');
  assert.equal(doc.getElementById('i-home').querySelector('path').getAttribute('d'), FTIcons.ICONS.filled.home);
  FTIcons.inject('emoji', doc);
  assert.equal(doc.getElementById('ft-icon-sprite').getAttribute('data-set'), 'outlined', 'an unknown set falls back to outlined');
});

test('every shell that draws a sprite icon loads icons.js in <head> and injects from the first <body> script', () => {
  const shells = [
    ...fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, 'public', f)),
    path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html'),
  ];
  let checked = 0;
  for (const f of shells) {
    const html = fs.readFileSync(f, 'utf8');
    if (!/href="#i-/.test(html)) continue;
    checked++;
    const head = html.slice(0, html.indexOf('</head>'));
    assert.match(head, /<script src="\/js\/icons\.js"><\/script>/, `${path.basename(f)} loads icons.js in <head>`);
    assert.match(html, /\n<body[^>]*>\s*<script>FTIcons\.inject\(\);<\/script>/, `${path.basename(f)}: the sprite script is the first thing in <body>`);
  }
  assert.ok(checked >= 11, `the 10 app shells + the Subscriptions view (${checked})`);
});
