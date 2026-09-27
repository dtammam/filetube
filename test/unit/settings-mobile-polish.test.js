'use strict';

// [UNIT] v1.13.0 item 6 (AC28) -- a lightweight CSS-presence check for the
// Setup (Library Settings) and /subscriptions page layout/spacing pass.
// Visual correctness itself is Dean's on-device + on-desktop call (AC26/27/
// 29); this just proves the mobile-breakpoint rules touching the selectors
// this item targets actually exist, and that the shared desktop-facing
// classes (`.setup-box`, `.folder-item-row`) were widened/loosened rather
// than left untouched.
const { test } = require('node:test');

// Tier 2 (DELIBERATE lock updates): spacing literals became --space-* tokens;
// these locks pin VALUES, so extracted rule text is resolved back to px
// before asserting. The token VALUES themselves are pinned byte-exactly by
// test/unit/token-scale-lock.test.js (the single value authority).
const SPACE_TOKENS = { '--space-1': '2px', '--space-2': '4px', '--space-3': '6px', '--space-4': '8px', '--space-5': '10px', '--space-6': '12px', '--space-8': '16px', '--space-10': '20px', '--space-12': '24px', '--space-16': '32px' };
const SIZE_TOKENS = { '--size-touch': '44px', '--size-control': '36px', '--size-control-sm': '32px' };
const rs = (s) => String(s).replace(/var\((--space-\d+|--size-[\w-]+)\)/g, (_, n) => SPACE_TOKENS[n] || SIZE_TOKENS[n] || _);
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
  const marginMatch = /margin-bottom:\s*(\d+)px/.exec(rs(formGroupRule[1]));
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
    rs(body),
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

// v1.21.0 FR-3, T3 -> UI pass S5: the subscription row is a ui-row now (a grid with
// reserved columns, ui.css), which stays horizontal at every width; it must never be
// swept into the .folder-item-row column-stack rule.
test('mobile: the subscription row (a ui-row) is NOT swept into the .folder-item-row column-stack rule', () => {
  const mobileBlockRe = /@media \(max-width: 768px\) \{([\s\S]*?)\n\}\n\n\/\* In landscape/;
  const block = mobileBlockRe.exec(css);
  assert.ok(block);
  assert.doesNotMatch(
    block[1],
    /\.folder-item-row,\s*\n\s*\.(sub-row|ui-row)\s*\{[^}]*flex-direction:\s*column/,
    'the row must not share .folder-item-row\'s column-stack rule'
  );
});

// v1.21.0 FR-3, T3 (AC24): the v1.19.0 FR-2a `#sub-list-container` scoped
// max-height override (superseded) is gone entirely -- the subscriptions
// list is the page's PRIMARY content with NO scroll cap. The Setup folder builder
// is UNCHANGED -- still `.folder-list-builder` at its original 240px/12px sizing.
// UI pass S5: the list container is `.subs-list` (A-Z ui-lists inside).
test('v1.21.0 FR-3: #sub-list-container carries no scoped max-height override -- the subscriptions list has no scroll cap (AC24), while the shared .folder-list-builder default is untouched', () => {
  const sharedRule = /\.folder-list-builder\s*\{([^}]*)\}/.exec(css);
  assert.ok(sharedRule, 'expected the shared .folder-list-builder rule');
  assert.match(sharedRule[1], /max-height:\s*240px/, 'the shared class default must be unchanged -- #folders-builder-list must not grow');
  assert.match(rs(sharedRule[1]), /padding:\s*12px/, 'the shared class padding must be unchanged');

  const scopedRule = /#sub-list-container\s*\{([^}]*)\}/.exec(css);
  assert.ok(!scopedRule, '#sub-list-container must not carry its own rule block (AC24)');
  for (const sel of ['subs-list', 'subs-sections', 'subs-root']) {
    const rule = new RegExp(`\\.${sel}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(!rule || !/max-height|overflow/.test(rule[1]), `.${sel} must have NO scroll cap (AC24) -- the list is the page's PRIMARY content`);
  }
});

test('the /subscriptions forms are the shared ui-field primitive (one fix improves every form that adopts it)', () => {
  const setupHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
  const subsHtml = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'),
    'utf8'
  );
  // v1.156 (T3) the forms moved into panels; UI pass S5 builds them from ui-field /
  // ui-select / ui-switch (D4.10), so the shared fix is the primitive in ui.css.
  // setup.html keeps its own .setup-box/.form-group chrome until sweep S8.
  assert.ok(setupHtml.includes('class="setup-box'), 'setup.html must use .setup-box');
  assert.ok(setupHtml.includes('class="form-group'), 'setup.html must use .form-group');
  assert.ok(subsHtml.includes('class="ui-field"'), 'subscriptions.html uses .ui-field');
  assert.doesNotMatch(subsHtml, /class="(form-group|setup-box|setup-select)/, 'no pre-primitive form chrome left on subscriptions.html');
});
