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

test('mobile: .folder-item-row stacks vertically on a narrow phone (comfortable wrapping, not per-row overflow)', () => {
  const mobileBlockRe = /@media \(max-width: 768px\) \{([\s\S]*?)\n\}\n\n\/\* In landscape/;
  const block = mobileBlockRe.exec(css);
  assert.ok(block);
  assert.match(block[1], /\.folder-item-row\s*\{[^}]*flex-direction:\s*column/);
});

// v1.21.0 FR-3, T3: `.sub-row`'s anatomy changed from a cramped multi-button
// cluster (which needed the column-stack fallback above) to a dense
// avatar+info+kebab row -- it now DELIBERATELY stays a horizontal flex row
// at every width, including mobile (a compact contact-list-style row is
// more comfortable there than stacking three thin sub-elements), so it must
// NOT be swept into the .folder-item-row column-stack rule anymore. See
// public/css/style.css's ".sub-row DELIBERATELY stays a horizontal flex
// row on mobile too" comment for the full rationale.
test('mobile: .sub-row is NOT swept into the .folder-item-row column-stack rule (v1.21.0 FR-3 -- it deliberately stays horizontal)', () => {
  const mobileBlockRe = /@media \(max-width: 768px\) \{([\s\S]*?)\n\}\n\n\/\* In landscape/;
  const block = mobileBlockRe.exec(css);
  assert.ok(block);
  assert.doesNotMatch(
    block[1],
    /\.folder-item-row,\s*\n\s*\.sub-row\s*\{[^}]*flex-direction:\s*column/,
    '.sub-row must not share .folder-item-row\'s column-stack rule -- its new avatar+info+kebab anatomy stays horizontal on mobile'
  );
});

// v1.21.0 FR-3, T3 (AC24): the v1.19.0 FR-2a `#sub-list-container` scoped
// max-height override (superseded) is gone entirely -- the subscriptions
// list is now the page's PRIMARY content and gets its own `.sub-list` class
// with NO scroll cap, rather than a bigger-but-still-capped box. The Setup
// folder builder and the one-shot job list are UNCHANGED -- still
// `.folder-list-builder` at its original 240px/12px sizing.
test('v1.21.0 FR-3: #sub-list-container no longer carries a scoped max-height override -- .sub-list has no scroll cap (AC24), while the shared .folder-list-builder default (Setup builder + one-shot list) is untouched', () => {
  const sharedRule = /\.folder-list-builder\s*\{([^}]*)\}/.exec(css);
  assert.ok(sharedRule, 'expected the shared .folder-list-builder rule');
  assert.match(sharedRule[1], /max-height:\s*240px/, 'the shared class default must be unchanged -- #folders-builder-list and #oneshot-list-container must not grow');
  assert.match(sharedRule[1], /padding:\s*12px/, 'the shared class padding must be unchanged');

  const scopedRule = /#sub-list-container\s*\{([^}]*)\}/.exec(css);
  assert.ok(!scopedRule, '#sub-list-container must no longer carry its own rule block -- AC24 replaces the v1.19.0 FR-2a "bigger box" override with .sub-list\'s uncapped container instead');

  const subListRule = /\.sub-list\s*\{([^}]*)\}/.exec(css);
  assert.ok(subListRule, 'expected a .sub-list rule (the new, uncapped primary-list container)');
  assert.doesNotMatch(subListRule[1], /max-height/, '.sub-list must have NO scroll cap (AC24) -- it is the page\'s PRIMARY content now');
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
