'use strict';

// [UNIT] v1.202: the `.icon-attribute` glyph (Material `drive_file_move`).
// Locks the three CSS sites (size block, mask line, @supports fill - the
// v1.47.6 blank-box scar), the asset + README row, and that watch.js emits
// it (and no longer the mask-less `icon-user`). Comments stripped at read.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', '..', 'public');
const stripCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJs = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('icon-attribute: drive_file_move.svg is bundled (Material 960 viewBox, the folder+arrow path) and documented', () => {
  const svg = fs.readFileSync(path.join(PUB, 'assets', 'icons', 'drive_file_move.svg'), 'utf8');
  assert.match(svg, /viewBox="0 -960 960 960"/);
  assert.match(svg, /<path d="M160-160q-33 0-56.5-23.5T80-240v-480/);
  assert.match(fs.readFileSync(path.join(PUB, 'assets', 'icons', 'README.md'), 'utf8'), /`drive_file_move\.svg` \| `drive_file_move` \| `\.icon-attribute`/);
});

test('icon-attribute: style.css carries the mask, the 1em size-block membership AND the @supports fill; no icon-user anywhere', () => {
  const css = stripCss(fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8'));
  assert.match(css, /\.icon-attribute \{ -webkit-mask-image: url\(\/assets\/icons\/drive_file_move\.svg\); mask-image: url\(\/assets\/icons\/drive_file_move\.svg\); \}/);
  assert.match(css, /\.icon-transcript,\n\.icon-attribute,[\s\S]*?\{[^}]*width: 1em;[^}]*height: 1em;/, 'joins the shared 1em size block');
  const supportsIdx = css.indexOf('@supports (mask-image: url("#"))');
  const supportsBlock = css.slice(supportsIdx, css.indexOf('background-color: currentColor', supportsIdx));
  assert.ok(supportsBlock.includes('.icon-attribute,'), 'in the @supports fill list');
  assert.ok(!/icon-user/.test(css), 'the mask-less class is gone from CSS (it never existed there)');
});

test('icon-attribute: watch.js (Attribute button) and main.js (folder bulk tool) emit icon-attribute and never the old mask-less class', () => {
  for (const f of ['watch.js', 'main.js']) {
    const js = stripJs(fs.readFileSync(path.join(PUB, 'js', f), 'utf8'));
    assert.match(js, /icon\.className = 'icon-attribute';/, f);
    assert.ok(!/icon-user/.test(js), `no icon-user left in ${f}`);
  }
});
