'use strict';

// [UNIT] v1.107 (Dean): the MODERN theme's font is Geist, applied across all
// elements and self-hosted like Roboto. These bind the pieces the era-typography
// + v1262-pwa-chrome locks don't: the woff2 ships, and the pre-theme `:root`
// default mirrors Modern (no Roboto->Geist FOUC flash before data-theme paints).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');

test('v1.107: the Geist woff2 actually ships under public/fonts (the Dockerfile copies public/)', () => {
  const p = path.join(ROOT, 'public', 'fonts', 'geist.woff2');
  assert.ok(fs.existsSync(p), 'public/fonts/geist.woff2 exists');
  const buf = fs.readFileSync(p);
  assert.equal(buf.slice(0, 4).toString('latin1'), 'wOF2', 'it is a real woff2 (wOF2 magic)');
  assert.ok(buf.length > 5000, 'non-empty font file');
  // Roboto stays bundled as the fallback.
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'fonts', 'roboto.woff2')), 'roboto.woff2 stays as the fallback');
});

test('v1.107: the :root pre-theme default is Geist (mirrors Modern), so there is no Roboto->Geist FOUC flash', () => {
  const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(rootBlock, 'the :root block exists');
  assert.match(rootBlock[1], /--font-family:\s*'Geist',\s*'Roboto'/, ':root body font = Geist (Roboto fallback)');
  assert.match(rootBlock[1], /--heading-font:\s*'Geist',\s*'Roboto'/, ':root heading font = Geist');
  assert.match(rootBlock[1], /--logo-font:\s*'Geist'/, ':root logo font = Geist');
});

test('v1.107: the retro eras are UNTOUCHED (no Geist leaks into 2005/2009/2014)', () => {
  for (const era of ['2005', '2009', '2014']) {
    const block = new RegExp(`\\[data-theme="${era}"\\] \\{([\\s\\S]*?)\\}`).exec(css)[1];
    assert.doesNotMatch(block, /Geist/, `era ${era} must not name Geist - Geist is Modern-only`);
  }
});
