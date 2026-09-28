'use strict';

// [UNIT] UI professionalism pass step 2, F39: the Settings/Stats menu tiles draw from
// MD_ICON_PATHS (common.js), and mdSvg() silently falls back to `info` for an unknown
// name - which is how the Shows folders tile (data-md-icon="tv") showed an (i). Every
// tile and hero icon a shell names must exist, so a missing glyph fails here instead of
// shipping as the wrong one. (S8 moves these tiles onto the icon registry.)

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const COMMON = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');

function mdIconKeys() {
  const start = COMMON.indexOf('const MD_ICON_PATHS = {');
  assert.ok(start !== -1, 'MD_ICON_PATHS exists');
  const body = COMMON.slice(start, COMMON.indexOf('\n};', start));
  return new Set([...body.matchAll(/^ {2}([a-z]+): '/gm)].map((m) => m[1]));
}

test('every data-md-icon / data-md-hero-icon a shell names has a glyph (no silent info fallback)', () => {
  const keys = mdIconKeys();
  assert.ok(keys.size >= 25, `the tile glyph set is found (${keys.size})`);
  const shells = [
    ...fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html')).map((f) => path.join('public', f)),
    ...fs.readdirSync(path.join(ROOT, 'lib', 'ytdlp', 'views')).filter((f) => f.endsWith('.html')).map((f) => path.join('lib', 'ytdlp', 'views', f)),
  ];
  const missing = [];
  let seen = 0;
  for (const rel of shells) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of html.matchAll(/data-md-(?:hero-)?icon="([a-z]+)"/g)) {
      seen++;
      if (m[1] !== 'era' && !keys.has(m[1])) missing.push(`${rel}: ${m[1]}`); // era draws mdEraGlyph
    }
  }
  assert.ok(seen >= 25, `tiles found (${seen})`);
  assert.deepStrictEqual(missing, []);
});

test('the Shows folders tile draws a tv, not the info fallback (F39)', () => {
  const setup = fs.readFileSync(path.join(ROOT, 'public', 'setup.html'), 'utf8');
  assert.match(setup, /data-md-icon="tv"/);
  assert.ok(mdIconKeys().has('tv'));
});
