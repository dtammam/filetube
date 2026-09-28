'use strict';
// v1.341.1 (Dean, desktop): opening any panel that locks the page (notifications, the account
// menu, a card's menu or right-click menu, every dialog) shifted the whole page by the scrollbar's
// width: body-scroll-lock.js pins <body>, the page stops overflowing, a classic scrollbar vanishes.
// Measured headless with classic scrollbars: the header bell moved 1296 -> 1308px on all four
// surfaces; with the gutter reserved it holds 1296 on every one, and on a page too short to scroll.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('the root reserves the scrollbar gutter, so a scroll lock never shifts the page', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/(^|\})\s*html\s*\{([^}]*)\}/g)].map((m) => m[2]);
  assert.ok(rules.some((r) => /scrollbar-gutter:\s*stable\s*;/.test(r)), 'html { scrollbar-gutter: stable }');
  // Nothing may undo it later in the cascade on the root.
  const all = [...css.matchAll(/([^{}]+)\{([^}]*scrollbar-gutter[^}]*)\}/g)];
  for (const [, sel, body] of all) {
    if (/(^|,)\s*(html|:root)\b/.test(sel.trim())) assert.match(body, /scrollbar-gutter:\s*stable/, `${sel.trim()} must keep the gutter stable`);
  }
});
