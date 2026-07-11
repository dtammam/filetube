'use strict';

// [UNIT] v1.30 C1 (AC7.1) -- type-scale tokens. style.css's font-size
// declarations were swept onto a small `--fs-*` custom-property scale
// defined in `:root` (tokenize, not restyle -- every token's value equals
// the literal it replaced, so no declaration's rendered size changed). This
// is a static-scan guard mirroring the repo's existing CSS-lock-test
// convention (see test/unit/player-media-aspect-css.test.js,
// test/unit/v1262-mobile-input-zoom.test.js): it asserts every `font-size:`
// declaration in the stylesheet references a `var(--fs-*)` token rather than
// a hardcoded px literal, except an explicit, documented allowlist.
//
// Allowlist for THIS scan: none. Every real font-size declaration in
// style.css (including glyph/icon-dimension ones, e.g. `.sidebar-item i`,
// `.player-dock-close`) maps cleanly onto an existing scale token, so none
// needed to stay a literal. The `--fs-*` TOKEN DEFINITIONS themselves (in
// `:root`, e.g. `--fs-base: 13px;`) are declarations of a *custom property*
// named `--fs-base`, not of the `font-size` property, so they never match
// this scan's `font-size:` pattern in the first place -- no special-casing
// required to exempt them.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// Matches only real `font-size:` PROPERTY declarations (colon immediately
// after the property name, a value, then `;` or the rule's closing `}`) --
// this deliberately does NOT match plain-English mentions of the word
// "font-size" inside comments (e.g. "computed font-size is under 16px"),
// since those lack the `font-size:` + value + terminator shape.
const FONT_SIZE_DECL_RE = /font-size:\s*([^;}]+)[;}]/g;

function findAllFontSizeDeclarations(source) {
  const results = [];
  let m;
  while ((m = FONT_SIZE_DECL_RE.exec(source))) {
    const lineNo = source.slice(0, m.index).split('\n').length;
    results.push({ value: m[1].trim(), lineNo });
  }
  return results;
}

function parseRootFsTokens(source) {
  const rootMatch = /:root\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(rootMatch, 'expected a :root block in style.css');
  const tokens = {};
  const re = /(--fs-[a-z0-9-]+):\s*([0-9]+)px/g;
  let m;
  while ((m = re.exec(rootMatch[1]))) {
    tokens[m[1]] = Number(m[2]);
  }
  return tokens;
}

test('style.css defines a type-scale token block in :root, including --fs-input-min', () => {
  const tokens = parseRootFsTokens(css);
  assert.ok(Object.keys(tokens).length > 0, 'expected at least one --fs-* token defined in :root');
  assert.strictEqual(tokens['--fs-input-min'], 16, 'expected --fs-input-min to be defined as 16px in :root (the v1.26.2 floor, AC7.2)');
});

test('every font-size: declaration in style.css uses a var(--fs-*) token (AC7.1) -- no undocumented hardcoded literal', () => {
  const declarations = findAllFontSizeDeclarations(css);
  assert.ok(declarations.length > 0, 'expected to find font-size declarations to scan');

  const offenders = declarations.filter((d) => !/^var\(--fs-[a-z0-9-]+\)$/.test(d.value));
  assert.deepStrictEqual(
    offenders,
    [],
    `expected every font-size: declaration to read \`var(--fs-*)\`; found hardcoded/non-token values at line(s): ${offenders.map((o) => `${o.lineNo} (${o.value})`).join(', ')}`
  );
});

test('every font-size: var(--fs-*) reference in style.css points at a token actually defined in :root (no stray/typo\'d token name)', () => {
  const tokens = parseRootFsTokens(css);
  const declarations = findAllFontSizeDeclarations(css);
  const undefinedRefs = declarations.filter((d) => {
    const m = /^var\((--fs-[a-z0-9-]+)\)$/.exec(d.value);
    return !m || tokens[m[1]] === undefined;
  });
  assert.deepStrictEqual(
    undefinedRefs,
    [],
    `expected every var(--fs-*) reference to resolve to a token defined in :root; found unresolved reference(s) at line(s): ${undefinedRefs.map((o) => `${o.lineNo} (${o.value})`).join(', ')}`
  );
});

test('the type scale is small relative to the raw declaration count it replaces (tokenization, not per-declaration renaming)', () => {
  const tokens = parseRootFsTokens(css);
  const declarations = findAllFontSizeDeclarations(css);
  assert.ok(
    Object.keys(tokens).length < declarations.length / 2,
    `expected a meaningfully smaller token set (${Object.keys(tokens).length}) than the raw declaration count (${declarations.length})`
  );
});
