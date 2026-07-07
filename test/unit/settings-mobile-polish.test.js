'use strict';

// [UNIT] v1.13.0 item 6 (AC28) -- a lightweight CSS-presence check for the
// Setup (Library Settings) and /subscriptions page layout/spacing pass.
// Visual correctness itself is Dean's on-device + on-desktop call (AC26/27/
// 29); this just proves the mobile-breakpoint rules touching the selectors
// this item targets actually exist, and that the shared desktop-facing
// classes (`.setup-box`, `.folder-item-row`) were widened/loosened rather
// than left untouched.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// The Setup page and the /subscriptions page both build their sections out
// of `.setup-box` (public/setup.html + lib/ytdlp/views/subscriptions.html),
// so this shared selector is the one the item-6 desktop pass is expected to
// widen for both pages at once.
test('desktop: .setup-box is wider than the pre-fix 650px (both Setup and /subscriptions build sections from it)', () => {
  const rule = /\.setup-box\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'expected a .setup-box rule');
  const maxWidthMatch = /max-width:\s*(\d+)px/.exec(rule[1]);
  assert.ok(maxWidthMatch, 'expected .setup-box to declare a pixel max-width');
  assert.ok(Number(maxWidthMatch[1]) > 650, '.setup-box max-width must be widened beyond the cramped 650px it shipped with');
});

test('desktop: .form-group and .folder-item-row carry more breathing room than the pre-fix values', () => {
  const formGroupRule = /\.form-group\s*\{([^}]*)\}/.exec(css);
  assert.ok(formGroupRule, 'expected a .form-group rule');
  const marginMatch = /margin-bottom:\s*(\d+)px/.exec(formGroupRule[1]);
  assert.ok(marginMatch && Number(marginMatch[1]) > 20, '.form-group margin-bottom must be increased beyond the cramped 20px it shipped with');

  const folderRowRule = /\.folder-item-row\s*\{([^}]*)\}/.exec(css);
  assert.ok(folderRowRule, 'expected a .folder-item-row rule');
  assert.match(folderRowRule[1], /gap:/, '.folder-item-row should use an explicit gap for its (now-wrappable) children');
});

test('mobile: a media query gives .setup-box comfortable controls (min-height tap targets, scoped to .setup-box only)', () => {
  const mobileBlockRe = /@media \(max-width: 768px\) \{([\s\S]*?)\n\}\n\n\/\* In landscape/;
  const block = mobileBlockRe.exec(css);
  assert.ok(block, 'expected the main mobile (max-width:768px) media query block');
  const body = block[1];
  assert.match(body, /\.setup-box\s*\{/, 'the mobile block must adjust .setup-box spacing');
  assert.match(
    body,
    /\.setup-box \.btn,[\s\S]*?\.setup-box \.setup-select,[\s\S]*?min-height:\s*\d+px/,
    'the mobile block must set a comfortable min-height tap target for Setup/.subscriptions controls, scoped to .setup-box'
  );
});

test('mobile: .folder-item-row and .sub-row stack vertically on a narrow phone (comfortable wrapping, not per-row overflow)', () => {
  const mobileBlockRe = /@media \(max-width: 768px\) \{([\s\S]*?)\n\}\n\n\/\* In landscape/;
  const block = mobileBlockRe.exec(css);
  assert.ok(block);
  assert.match(block[1], /\.folder-item-row,\s*\n\s*\.sub-row\s*\{[^}]*flex-direction:\s*column/);
});

test('v1.19.0 FR-2a: #sub-list-container gets a SCOPED size override (taller/roomier than the shared .folder-list-builder default), which the Setup folder builder and one-shot list do not', () => {
  const sharedRule = /\.folder-list-builder\s*\{([^}]*)\}/.exec(css);
  assert.ok(sharedRule, 'expected the shared .folder-list-builder rule');
  assert.match(sharedRule[1], /max-height:\s*240px/, 'the shared class default must be unchanged -- #folders-builder-list and #oneshot-list-container must not grow');
  assert.match(sharedRule[1], /padding:\s*12px/, 'the shared class padding must be unchanged');

  const scopedRule = /#sub-list-container\s*\{([^}]*)\}/.exec(css);
  assert.ok(scopedRule, 'expected a scoped #sub-list-container override (an ID selector, not a change to the shared class)');
  const maxHeightMatch = /max-height:\s*(\d+)px/.exec(scopedRule[1]);
  assert.ok(maxHeightMatch && Number(maxHeightMatch[1]) > 240, '#sub-list-container must be taller than the shared 240px default');
  const paddingMatch = /padding:\s*(\d+)px/.exec(scopedRule[1]);
  assert.ok(paddingMatch && Number(paddingMatch[1]) > 12, '#sub-list-container must have roomier padding than the shared 12px default');
});

test('the /subscriptions page and the Setup page share the same .setup-box/.form-group/.folder-item-row selectors (one fix improves both)', () => {
  const setupHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
  const subsHtml = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'),
    'utf8'
  );
  for (const cls of ['setup-box', 'form-group', 'folder-list-builder']) {
    assert.ok(setupHtml.includes(`class="${cls}"`), `setup.html must use .${cls}`);
    assert.ok(subsHtml.includes(`class="${cls}"`), `subscriptions.html must use .${cls}`);
  }
});
