'use strict';

// [UNIT] v1.364.0 W2c (Dean 2026-10-05: "the new Add chapters button for music view is centered
// instead of left aligned. why"). The v1.363.1 chapters rows carry `ui-btn ui-btn--plain` (the
// lint's bespoke-button rule; their bare siblings are counted carve-out debt, which is never
// widened), and `.ui-btn` centres its content, fixes its height, sets its own font size, weight and
// line height and draws a tint layer. The sticker menu resets exactly those on the two row families,
// AFTER both row bases. Measured in a real browser (phone 390x844 + desktop 1440x900, eras 2021 and
// 2005, light and dark): the chapters row's icon x, label x, height and font equal its neighbour's.
// This lock reads the rules BY VALUE with comments stripped (LESSONS 3) and binds their order.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { cssRules, readStyleCss } = require('../helpers/stylesheets');

const rules = cssRules(readStyleCss());
const one = (sel) => {
  const hits = rules.filter((r) => r.sel.replace(/\s+/g, ' ') === sel && !r.at);
  assert.strictEqual(hits.length, 1, 'exactly one top-level rule ' + sel + ' (found ' + hits.length + ')');
  return hits[0];
};
const decls = (body) => {
  const m = {};
  body.split(';').map((d) => d.trim()).filter(Boolean).forEach((d) => { const i = d.indexOf(':'); m[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
  return m;
};

test('W2c: the Extras chapters row (ui-btn + mms-sm-act) lays out from the start like its siblings, at their height and in their font', () => {
  const r = one('.mms-sticker-menu .ui-btn.mms-sm-act');
  const d = decls(r.body);
  assert.strictEqual(d['justify-content'], 'flex-start', 'never ui-btn\'s centre (Dean\'s "centered")');
  assert.strictEqual(d.height, 'auto', 'ui-btn\'s fixed height is dropped; min-height comes from the row base');
  for (const p of ['font-weight', 'line-height', 'font-style', 'white-space']) assert.strictEqual(d[p], 'revert', p + ' back to what the bare siblings get');
  assert.ok(!('font-family' in d) && !('font' in d), 'the family stays the menu\'s (.mms-sticker-menu button): a revert there measured Arial');
});

test('W2c: the pop-out chapters row (ui-btn + mms-sm-extras) matches the Extras/Home rows: height and font', () => {
  const d = decls(one('.mms-sticker-menu .ui-btn.mms-sm-extras').body);
  assert.strictEqual(d.height, 'auto');
  for (const p of ['font', 'white-space', 'border-radius']) assert.strictEqual(d[p], 'revert', p + ' back to the button default the siblings render in (13.33px/400)');
  assert.strictEqual(d['font-family'], 'var(--font-ui)', 'then the menu\'s family back (.mms-sticker-menu button), never the UA Arial');
  const keys = Object.keys(d);
  assert.ok(keys.indexOf('font-family') > keys.indexOf('font'), 'the family AFTER the shorthand (the shorthand would reset it)');
  assert.ok(!('justify-content' in d), 'the row base\'s space-between stays (label left, chevron right)');
});

test('W2c: no ui-btn tint layer on those rows (the siblings have none; the act rows keep their own hover fill)', () => {
  const d = decls(one('.mms-sticker-menu .ui-btn:is(.mms-sm-act, .mms-sm-extras)::after').body);
  assert.strictEqual(d.content, 'none');
});

test('W2c: file order - the resets sit AFTER both row bases (equal specificity elsewhere would let the base win)', () => {
  const act = one('.mms-sticker-menu .ui-btn.mms-sm-act');
  const ext = one('.mms-sticker-menu .ui-btn.mms-sm-extras');
  const actBase = one('.mms-sticker-menu .mms-sm-act');
  const extBase = rules.find((r) => r.sel.replace(/\s+/g, ' ') === '.mms-sticker-menu .mms-sm-extras, .mms-sticker-menu .mms-sm-back');
  assert.ok(extBase, 'the extras/back base rule exists');
  assert.ok(act.index > actBase.index && act.index > extBase.index, 'act reset after both bases');
  assert.ok(ext.index > actBase.index && ext.index > extBase.index, 'extras reset after both bases');
});

test('W2c: the rows the resets are for still render with ui-btn (reachability of the selectors)', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'skin-surface.js'), 'utf8');
  assert.match(js, /class="ui-btn ui-btn--plain mms-sm-act" data-skin-x="chapters"/, 'the Extras chapters row');
  assert.match(js, /class="ui-btn ui-btn--plain mms-sm-extras" data-skin-chapters/, 'the pop-out chapters row');
});
