'use strict';

// [UNIT] UI professionalism pass, AC11 (plan D2.1/D2.5): every role token and era knob is
// written in EVERY era x mode block of public/css/tokens.css. A block that omits a role
// silently inherits it - from :root (Modern light) in a retro era, or from the era's
// light block in dark mode - which is exactly how a dark era ends up with a white card
// or a retro era with Geist. Same shape as the Pocket colorway role-block lock.

const { test } = require('node:test');
const assert = require('node:assert');
const { eraBlock, readTokensCss, readStyleCss } = require('../helpers/stylesheets');

const ROLES = [
  // D2.1 surfaces, ink and colour roles
  '--surface-0', '--surface-1', '--surface-2', '--surface-overlay', '--scrim', '--separator',
  '--ink-1', '--ink-2', '--ink-3', '--ink-on-accent', '--ink-link',
  '--accent', '--accent-fill', '--danger', '--indicator', '--progress',
  '--fill-selected', '--tint-press', '--tint-hover', '--focus-ring', '--outline',
  '--thumb-ground', '--star', '--shadow-overlay',
  // D2.5 era knobs (+ the era-varying radii)
  '--font-ui', '--font-heading', '--btn-radius', '--btn-fill', '--btn-border', '--btn-shadow',
  '--btn-weight', '--row-divider-style', '--thumb-radius', '--r-sm', '--r-md', '--r-lg',
];
const ERAS = ['2005', '2009', '2014', '2021'];
const MODES = ['light', 'dark'];

const defines = (block, name) => new RegExp(`(^|[;{\\s])${name.replace(/-/g, '\\-')}\\s*:`).test(block);

test('every era x mode block defines every role and era knob (8 blocks x ' + ROLES.length + ')', () => {
  const missing = [];
  for (const era of ERAS) {
    for (const mode of MODES) {
      const block = eraBlock(era, mode);
      assert.ok(block !== null, `tokens.css has a ${era} ${mode} block`);
      for (const r of ROLES) if (!defines(block, r)) missing.push(`${era} ${mode}: ${r}`);
    }
  }
  assert.deepStrictEqual(missing, [], 'a block that omits a role inherits another era or mode\'s value');
});

test('every block sets color-scheme to its own mode (native controls, scrollbars and form fields follow)', () => {
  for (const era of ERAS) {
    for (const mode of MODES) {
      assert.match(eraBlock(era, mode), new RegExp(`color-scheme:\\s*${mode};`), `${era} ${mode}`);
    }
  }
  assert.match(eraBlock('2021'), /accent-color:\s*var\(--accent-fill\);/, 'any native control left takes the accent fill (F09, F66)');
});

test('role tokens are defined ONLY in tokens.css (style.css never shadows a role)', () => {
  const style = readStyleCss().replace(/\/\*[\s\S]*?\*\//g, '');
  const shadowed = ROLES.filter((r) => defines(style, r));
  assert.deepStrictEqual(shadowed, [], 'a role redefined in style.css would override every era at once');
});

test('step 7: the eight exact aliases are retired - defined nowhere, used nowhere, banned by ui-lint', () => {
  const RETIRED = ['--font-family', '--heading-font', '--bg-color', '--card-bg', '--bg-secondary', '--text-primary', '--text-secondary', '--border-color'];
  const css = readTokensCss() + readStyleCss();
  for (const old of RETIRED) {
    const re = new RegExp(`(?<![\\w-])${old.replace(/-/g, '\\-')}(?![\\w-])`);
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), re, `${old} is neither defined nor used (a var() of it would paint nothing)`);
  }
  const { tokensInfo } = require('../../scripts/ui-lint.js');
  const info = tokensInfo(require('node:path').join(__dirname, '..', '..'));
  for (const old of RETIRED) assert.ok(info.legacy.has(old), `${old} stays banned (no-legacy-tokens)`);
});

test('red roles: selected state is a neutral fill, never the accent (D8.8)', () => {
  for (const era of ERAS) {
    for (const mode of MODES) {
      const m = /--fill-selected:\s*([^;]+);/.exec(eraBlock(era, mode));
      assert.ok(m && /^rgba\(120, 120, 128,/.test(m[1].trim()), `${era} ${mode}: --fill-selected is the neutral grey tint`);
    }
  }
});
