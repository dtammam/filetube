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

test('v1.107: the Geist woff2 actually ships under public/fonts (the Dockerfile copies public/)', () => {
  const p = path.join(ROOT, 'public', 'fonts', 'geist.woff2');
  assert.ok(fs.existsSync(p), 'public/fonts/geist.woff2 exists');
  const buf = fs.readFileSync(p);
  assert.equal(buf.slice(0, 4).toString('latin1'), 'wOF2', 'it is a real woff2 (wOF2 magic)');
  assert.ok(buf.length > 5000, 'non-empty font file');
  // Roboto stays bundled as the fallback.
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'fonts', 'roboto.woff2')), 'roboto.woff2 stays as the fallback');
});

// UI pass step 1 (DELIBERATE lock update): the token blocks moved to tokens.css and the
// families are the --font-ui / --font-heading knobs (--font-family / --heading-font alias them).
const { eraBlock, readTokensCss } = require('../helpers/stylesheets');

test('v1.107: the :root pre-theme default is Geist (mirrors Modern), so there is no Roboto->Geist FOUC flash', () => {
  const rootBlock = eraBlock('2021');
  assert.ok(rootBlock, 'the :root block exists');
  assert.match(rootBlock, /--font-ui:\s*'Geist',\s*'Roboto'/, ':root body font = Geist (Roboto fallback)');
  assert.match(rootBlock, /--font-heading:\s*'Geist',\s*'Roboto'/, ':root heading font = Geist');
  assert.match(rootBlock, /--logo-font:\s*'Geist'/, ':root logo font = Geist');
  assert.match(readTokensCss(), /--font-family:\s*var\(--font-ui\);/, 'the body family reads the knob');
});

test('v1.107: the retro eras are UNTOUCHED (no Geist leaks into 2005/2009/2014)', () => {
  for (const era of ['2005', '2009', '2014']) {
    for (const mode of ['light', 'dark']) {
      const block = eraBlock(era, mode);
      assert.ok(block, `era ${era} ${mode} block exists`);
      assert.doesNotMatch(block, /Geist/, `era ${era} must not name Geist - Geist is Modern-only`);
      assert.match(block, /--font-ui:/, `era ${era} ${mode} sets its own family (never inherits Modern Geist)`);
    }
  }
});

test('v1.107 (gate coverage): EVERY shell that loads style.css preloads geist.woff2, before the stylesheet', () => {
  // Widens the v1262-pwa-chrome preload lock (which only covers 5 of 12 shells)
  // to ALL shells - incl. login.html, the pre-login/cold-visit surface whose FOUC
  // matters most. Any shell that references the stylesheet must preload the font.
  const dirs = [path.join(ROOT, 'public'), path.join(ROOT, 'lib', 'ytdlp', 'views')];
  let checked = 0;
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      const cssIdx = html.indexOf('rel="stylesheet" href="/css/style.css"');
      if (cssIdx === -1) continue; // not a full shell
      checked++;
      const preIdx = html.indexOf('rel="preload" href="/fonts/geist.woff2"');
      assert.ok(preIdx > -1, `${f} loads style.css but does not preload geist.woff2`);
      assert.ok(preIdx < cssIdx, `${f}: the geist preload must precede the stylesheet <link>`);
      // UI pass step 1: tokens.css loads FIRST, right before style.css (and after the preload).
      const tokIdx = html.indexOf('rel="stylesheet" href="/css/tokens.css"');
      assert.ok(tokIdx > preIdx && tokIdx < cssIdx, `${f}: tokens.css must load after the preload and before style.css`);
      // step 3: the primitives load between the tokens and the surface stylesheet.
      const uiIdx = html.indexOf('rel="stylesheet" href="/css/ui.css"');
      assert.ok(uiIdx > tokIdx && uiIdx < cssIdx, `${f}: ui.css must load after tokens.css and before style.css`);
      assert.ok(!html.includes('preload" href="/fonts/roboto.woff2"'), `${f} still preloads the OLD roboto font`);
      // Forcing guard: no shell should reference the OLD font at all (the Modern
      // face is Geist; Roboto is only a CSS fallback, never named in a shell).
      // Catches stale "before Roboto takes over"-style comments before they ship.
      assert.ok(!/Roboto/.test(html), `${f} still references "Roboto" (a stale font reference - the shells' font is Geist)`);
    }
  }
  assert.ok(checked >= 12, `expected >=12 shells to be checked, saw ${checked}`);
});

test('v1.107: the era-picker blurb for Modern names Geist, not the old Roboto (shipped-feature self-consistency)', () => {
  const common = fs.readFileSync(path.join(ROOT, 'public', 'js', 'common.js'), 'utf8');
  const modern = /id:\s*'2021'[\s\S]*?blurb:\s*'([^']*)'/.exec(common);
  assert.ok(modern, 'the Modern (2021) THEME_REGISTRY entry exists');
  assert.match(modern[1], /Geist/, "the Modern era-picker blurb must say Geist");
  assert.doesNotMatch(modern[1], /Roboto/, "the Modern blurb must not still say Roboto (it renders Geist)");
});
