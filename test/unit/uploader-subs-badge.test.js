'use strict';

// [UNIT] v1.50 (Dean, mid-wave ask): the watch page's subscriber count is
// presented as a BADGE (the classic-YouTube boxed-count treatment) rather
// than a bare text line. The badge must be built ENTIRELY from era tokens --
// that's what makes it square in 2005/2009, rounded in 2021, and correct in
// both light and dark without any era-specific rules of its own.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'watch.html'), 'utf8');

function ruleBody(selector) {
  const m = new RegExp(`\\n\\${selector} \\{([\\s\\S]*?)\\}`).exec(css);
  assert.ok(m, `expected a ${selector} rule in style.css`);
  return m[1];
}

test('.uploader-subs is a token-built badge (surface, border, radius) -- no hardcoded colors or radii', () => {
  const body = ruleBody('.uploader-subs');
  assert.match(body, /display:\s*inline-block/, 'a badge shrink-wraps its text');
  assert.match(body, /background-color:\s*var\(--btn-bg\)/, 'surface from the era token');
  assert.match(body, /border:\s*1px solid var\(--border-color\)/, 'border from the era token');
  assert.match(body, /border-radius:\s*var\(--radius\)/, 'radius from the era token (square 2005/2009, rounded 2021)');
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, 'no hardcoded colors -- both data-mode palettes must work');
});

test('the badge element still exists in watch.html with its populateMetadata id', () => {
  assert.match(html, /class="uploader-subs" id="uploader-subs-count"/);
});
