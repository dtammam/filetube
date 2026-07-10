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

test('a global mobile rule floors every <input>/<select>/<textarea> to 16px (the iOS no-zoom threshold)', () => {
  const blocks = mobileBlocks(css);
  const hasGlobalRule = blocks.some((block) =>
    /input,\s*\n\s*select,\s*\n\s*textarea\s*\{\s*\n\s*font-size:\s*16px;/.test(block)
  );
  assert.ok(hasGlobalRule, 'expected a bare `input, select, textarea { font-size: 16px; }` rule inside a max-width: 768px block');
});

test('class-selector surfaces the global element-selector rule cannot outrank (higher CSS specificity) get explicit mobile overrides', () => {
  const blocks = mobileBlocks(css);
  const hasOverride = blocks.some((block) => {
    const rule = /\.comment-input-box,\s*\n\s*\.sort-select,\s*\n\s*\.folder-name-input\s*\{([^}]*)\}/.exec(block);
    return rule && /font-size:\s*16px;/.test(rule[1]);
  });
  assert.ok(hasOverride, 'expected an explicit mobile 16px override for .comment-input-box/.sort-select/.folder-name-input');
});

test('.folder-name-input (public/js/setup.js) no longer carries an inline font-size -- inline styles beat every stylesheet rule, including the global mobile floor', () => {
  const inputLine = /<input type="text" class="folder-name-input"[\s\S]*?\/>/.exec(setupJs);
  assert.ok(inputLine, 'expected the .folder-name-input markup in setup.js');
  assert.ok(!/font-size/.test(inputLine[0]), '.folder-name-input must not carry an inline font-size (moved to a real CSS class rule)');
});

test('.folder-name-input has a real desktop-sized (12px) base CSS rule outside any media query, so the mobile override above has something to override', () => {
  // Anchored to line-start (unindented): rules nested inside an @media block
  // are indented in this file's style, so `^\.selector` only matches the
  // top-level (non-media-query) rule.
  const rule = /^\.folder-name-input\s*\{([^}]*)\}/m.exec(css);
  assert.ok(rule, 'expected a base (non-media-query) .folder-name-input rule');
  assert.match(rule[1], /font-size:\s*12px;/);
});

test('desktop sizing for the systemic-fix surfaces is unchanged outside the mobile breakpoint (12px/13px bases still present)', () => {
  const sortSelectRule = /^\.sort-select\s*\{([^}]*)\}/m.exec(css);
  assert.ok(sortSelectRule, 'expected a base (non-media-query) .sort-select rule');
  assert.match(sortSelectRule[1], /font-size:\s*12px;/, 'expected .sort-select base to stay 12px on desktop');

  const commentBoxRule = /^\.comment-input-box\s*\{([^}]*)\}/m.exec(css);
  assert.ok(commentBoxRule, 'expected a base (non-media-query) .comment-input-box rule');
  assert.match(commentBoxRule[1], /font-size:\s*13px;/, 'expected .comment-input-box base to stay 13px on desktop');
});
