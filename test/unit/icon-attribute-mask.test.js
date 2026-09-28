'use strict';

// [UNIT] v1.202: the `.icon-attribute` glyph (Material `drive_file_move`).
// Locks the three CSS sites (size block, mask line, @supports fill - the
// v1.47.6 blank-box scar), the asset + README row, and (UI pass S3) that watch.js draws the registry glyph instead; watch.js used to emit
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

// Step 7 (UI pass, DELIBERATE conversion): the `.icon-attribute` mask is RETIRED with its last
// consumer (the watch page's Attribute became a More-menu entry drawing the registry `edit` glyph in sweep S3), so the lock on its three CSS sites became a lock that it is gone -
// and that nothing in the app still asks for it (a class with no rule renders an empty box).
test('step 7: the .icon-attribute mask is retired - no rule, no consumer in public/ or lib/', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /\.icon-attribute\b/, 'no sizing, mask or fill rule left');
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'assets' && e.name !== 'fonts') walk(q); } else if (/\.(js|html)$/.test(e.name)) files.push(q); } };
  walk(path.join(__dirname, '..', '..', 'public')); walk(path.join(__dirname, '..', '..', 'lib'));
  assert.ok(files.length > 20, 'the scan reached the tree');
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(code, /icon-attribute\b/, path.basename(f) + ' asks for no .icon-attribute');
  }
});

test('icon-attribute: no icon-user anywhere in style.css (the mask-less class never existed there)', () => {
  assert.ok(!/icon-user/.test(stripCss(fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8'))));
});

test('icon-attribute: watch.js (Attribute button) emits icon-attribute; main.js (folder bulk tool, a labelled ui-btn since sweep S2) needs no mask; neither uses the old mask-less class', () => {
  // UI pass sweep S3: the watch page's Attribute is a More-menu entry drawing the registry's
  // `edit` glyph (no mask).
  const watch = stripJs(fs.readFileSync(path.join(PUB, 'js', 'watch.js'), 'utf8'));
  assert.match(watch, /id: 'attribute', icon: 'edit', label: 'Attribute to a channel'/, 'watch.js');
  const main = stripJs(fs.readFileSync(path.join(PUB, 'js', 'main.js'), 'utf8'));
  assert.match(main, /cardUi\(\)\.button\(\{ variant: 'tonal', size: 'sm', pill: true, label: 'Attribute folder',/, 'main.js: a labelled ui-btn');
  for (const js of [watch, main]) assert.ok(!/icon-user/.test(js), 'no icon-user left');
});
