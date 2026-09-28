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

// Sweep S8 (AC12 conversion): the v1.13.0 phone column-stack is replaced by ONE layout at
// every width - a card whose controls row wraps (the name field takes its own full line),
// so nothing overflows a narrow phone and no mobile rule has to reshape the row.
test('the folder row wraps its controls at every width instead of a phone-only column stack (sweep S8)', () => {
  const rule = (sel) => { const m = new RegExp(sel.replace(/[.>]/g, (c) => '\\' + c) + '\\s*\\{([^}]*)\\}').exec(css); assert.ok(m, sel); return m[1]; };
  assert.match(rule('.folder-item-controls'), /flex-wrap:\s*wrap/, 'the controls row wraps');
  assert.match(rule('.folder-item-controls > .folder-name-input'), /flex:\s*1 1 100%/, 'the name field takes a full line');
  assert.match(rule('.folder-item-body'), /min-width:\s*0/, 'the body can shrink (long paths break, never overflow)');
  // and no rule anywhere turns the row back into a column (the retired phone stack)
  const rows = css.match(/\.folder-item-row\s*\{[^}]*\}/g) || [];
  assert.ok(rows.length >= 1);
  for (const r of rows) assert.doesNotMatch(r, /flex-direction:\s*column/, 'no column stack: ' + r.slice(0, 60));
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

test('Settings and /subscriptions fields are the shared ui-field primitive (one fix improves every form that adopts it); Settings keeps the .folder-list-builder container', () => {
  const setupHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
  const subsHtml = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'),
    'utf8'
  );
  // v1.156 (T3) the forms moved into panels; UI pass S5 builds them from ui-field /
  // ui-select / ui-switch (D4.10), so the shared fix is the primitive in ui.css.
  // setup.html keeps its own .setup-box/.form-group chrome until sweep S8.
  assert.ok(setupHtml.includes('class="setup-box'), 'setup.html must use .setup-box');
  // Sweep S8: Settings' fields left .form-group for the ui-field primitive (S5 moves the
  // Subscriptions forms the same way); the list container is still shared.
  assert.ok(setupHtml.includes('class="folder-list-builder'), 'setup.html must use .folder-list-builder');
  // (S5 retired .folder-list-builder from the Subscriptions view: its lists are ui-lists.)
  assert.ok(!subsHtml.includes('class="folder-list-builder'), 'the Subscriptions view has no bespoke list container left');
  assert.ok(!setupHtml.includes('class="form-group'), 'setup.html fields are ui-field, not .form-group');
  assert.ok(setupHtml.includes('class="ui-field setup-field"'), 'setup.html uses ui-field');
  assert.ok(subsHtml.includes('class="ui-field"'), 'subscriptions.html uses .ui-field');
  assert.doesNotMatch(subsHtml, /class="(form-group|setup-box|setup-select)/, 'no pre-primitive form chrome left on subscriptions.html');
});
