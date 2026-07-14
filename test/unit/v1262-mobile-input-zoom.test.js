'use strict';

// [UNIT] v1.26.2 CSS/polish wave -- Item 3 (global iOS input-zoom kill).
// Mechanical CSS/markup-presence guards, mirroring
// test/unit/player-media-aspect-css.test.js's style-locking pattern. Visual
// feel (does iOS Safari actually refrain from zooming) is Dean's on-device
// arbiter; these lock that the SYSTEMIC rule + its necessary companions
// actually exist, rather than relying solely on the pre-existing per-surface
// patches.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CSS_PATH = path.join(ROOT, 'public', 'css', 'style.css');
const SETUP_JS_PATH = path.join(ROOT, 'public', 'js', 'setup.js');

const css = fs.readFileSync(CSS_PATH, 'utf8');
const setupJs = fs.readFileSync(SETUP_JS_PATH, 'utf8');

// v1.30 C1 (AC7.1/AC7.2): style.css's font-size declarations are now
// token-driven (`var(--fs-*)`) rather than bare px literals -- see the
// `:root` block. Parse the token definitions once so these tests can resolve
// `var(--fs-*)` back to a px number and keep asserting the FLOOR VALUE
// (>=16px), not a specific source-text spelling.
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

const fsTokens = parseRootFsTokens(css);

// Resolves a font-size declaration's VALUE (e.g. "16px" or
// "var(--fs-input-min)") to a numeric px, following the token indirection
// through the parsed :root block.
function resolveFontSizePx(value) {
  const trimmed = value.trim();
  const varMatch = /^var\((--fs-[a-z0-9-]+)\)$/.exec(trimmed);
  if (varMatch) {
    const px = fsTokens[varMatch[1]];
    assert.ok(px !== undefined, `expected token ${varMatch[1]} to be defined in :root`);
    return px;
  }
  const pxMatch = /^([0-9]+)px$/.exec(trimmed);
  assert.ok(pxMatch, `expected a px literal or var(--fs-*) token, got "${value}"`);
  return Number(pxMatch[1]);
}

function mobileBlocks(source) {
  const blocks = [];
  const re = /@media \(max-width: 768px\)\s*\{/g;
  let m;
  while ((m = re.exec(source))) {
    // Balance braces from the opening `{` to find this block's real extent
    // (blocks can nest rules with their own `{}` pairs).
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    blocks.push(source.slice(m.index, i));
  }
  return blocks;
}

test('a global mobile rule floors every <input>/<select>/<textarea> to >=16px via --fs-input-min (the iOS no-zoom threshold)', () => {
  const blocks = mobileBlocks(css);
  let matchedValue = null;
  const hasGlobalRule = blocks.some((block) => {
    const rule = /input,\s*\n\s*select,\s*\n\s*textarea\s*\{\s*\n\s*font-size:\s*([^;]+);/.exec(block);
    if (!rule) return false;
    matchedValue = rule[1];
    return true;
  });
  assert.ok(hasGlobalRule, 'expected a bare `input, select, textarea { font-size: ...; }` rule inside a max-width: 768px block');
  assert.strictEqual(matchedValue.trim(), 'var(--fs-input-min)', 'expected the global mobile floor to be tokenized via --fs-input-min (AC7.2)');
  assert.ok(resolveFontSizePx(matchedValue) >= 16, `expected --fs-input-min to resolve to >=16px, got ${resolveFontSizePx(matchedValue)}px`);
});

test('class-selector surfaces the global element-selector rule cannot outrank (higher CSS specificity) get explicit mobile overrides, still >=16px via --fs-input-min', () => {
  const blocks = mobileBlocks(css);
  let matchedValue = null;
  const hasOverride = blocks.some((block) => {
    // v1.41.2: .sort-select was removed from this group -- the sort control is
    // now a custom .btn dropdown (not a native <select>), so it's no longer a
    // <16px focus-zoom surface and needs no floor override.
    const rule = /\.comment-input-box,\s*\n\s*\.folder-name-input\s*\{([^}]*)\}/.exec(block);
    if (!rule) return false;
    const fontSize = /font-size:\s*([^;]+);/.exec(rule[1]);
    if (!fontSize) return false;
    matchedValue = fontSize[1];
    return true;
  });
  assert.ok(hasOverride, 'expected an explicit mobile floor override for .comment-input-box/.folder-name-input');
  assert.strictEqual(matchedValue.trim(), 'var(--fs-input-min)', 'expected the override to be tokenized via --fs-input-min (AC7.2)');
  assert.ok(resolveFontSizePx(matchedValue) >= 16, `expected --fs-input-min to resolve to >=16px, got ${resolveFontSizePx(matchedValue)}px`);
});

test('.folder-name-input (public/js/setup.js) no longer carries an inline font-size -- inline styles beat every stylesheet rule, including the global mobile floor', () => {
  const inputLine = /<input type="text" class="folder-name-input"[\s\S]*?\/>/.exec(setupJs);
  assert.ok(inputLine, 'expected the .folder-name-input markup in setup.js');
  assert.ok(!/font-size/.test(inputLine[0]), '.folder-name-input must not carry an inline font-size (moved to a real CSS class rule)');
});

test('.folder-name-input has a real desktop-sized (12px, tokenized) base CSS rule outside any media query, so the mobile override above has something to override', () => {
  // Anchored to line-start (unindented): rules nested inside an @media block
  // are indented in this file's style, so `^\.selector` only matches the
  // top-level (non-media-query) rule.
  const rule = /^\.folder-name-input\s*\{([^}]*)\}/m.exec(css);
  assert.ok(rule, 'expected a base (non-media-query) .folder-name-input rule');
  const fontSize = /font-size:\s*([^;]+);/.exec(rule[1]);
  assert.ok(fontSize, 'expected a font-size declaration on the base .folder-name-input rule');
  assert.strictEqual(resolveFontSizePx(fontSize[1]), 12, 'expected .folder-name-input desktop base to stay 12px (via its token)');
});

test('desktop sizing for the systemic-fix surfaces is unchanged outside the mobile breakpoint (13px base still present, tokenized)', () => {
  // v1.41.2: the former .sort-select (12px) is gone -- the sort control is now a
  // custom .btn dropdown (.sort-select-btn), which inherits .btn's --fs-sm (12px)
  // and, being a button not a <select>, never triggers the iOS focus-zoom this
  // suite guards. So this now only pins .comment-input-box's desktop base.
  const commentBoxRule = /^\.comment-input-box\s*\{([^}]*)\}/m.exec(css);
  assert.ok(commentBoxRule, 'expected a base (non-media-query) .comment-input-box rule');
  const commentBoxFontSize = /font-size:\s*([^;]+);/.exec(commentBoxRule[1]);
  assert.ok(commentBoxFontSize, 'expected a font-size declaration on the base .comment-input-box rule');
  assert.strictEqual(resolveFontSizePx(commentBoxFontSize[1]), 13, 'expected .comment-input-box base to stay 13px on desktop');
});
