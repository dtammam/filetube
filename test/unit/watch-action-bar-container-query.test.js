'use strict';

// [UNIT] v1.201 (Dean: "on desktop the button moves over to a 2nd row if not
// in theatre mode"): the labelled action row fits only a column wider than
// ~1095px, so the WORDS are dropped (glyphs kept) via a CSS container query
// on `.watch-action-bar` - driven by the COLUMN, not the viewport, which is
// what lets theatre (wide column) keep the words at the same viewport width
// where the non-theatre column (sidebar beside it) shows glyphs. Locks the
// mechanism: the container is the bar (a block child of the column - never
// the flex item, whose inline-size containment would collapse it), the
// query hides exactly the label span, and the phone rule stays. Comments
// stripped once at read (the v1.50.3 lock lesson).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('style.css: .watch-action-bar is the named inline-size container (not .watch-actions, not .watch-action-btns)', () => {
  const bar = /\.watch-action-bar\s*\{([^}]*)\}/.exec(css);
  assert.ok(bar, 'the base .watch-action-bar rule');
  assert.match(bar[1], /container-type:\s*inline-size;/);
  assert.match(bar[1], /container-name:\s*watch-action-bar;/);
  for (const sel of ['.watch-actions', '.watch-action-btns']) {
    const rule = new RegExp(sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}').exec(css);
    assert.ok(rule && !/container-type/.test(rule[1]), `${sel} must NOT be a size container (a flex item with inline-size containment collapses)`);
  }
});

test('style.css: the container query hides ONLY the label span below 960px of column width, and the phone block keeps its own label hide', () => {
  const q = /@container watch-action-bar \(max-width: 959px\)\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(q, 'the @container block exists with the measured threshold (labelled buttons 953px -> words fit from 960px up)');
  assert.match(q[1], /\.watch-action-btns \.btn \.btn-label\s*\{\s*display:\s*none;\s*\}/);
  assert.ok(!/\.btn\s*\{/.test(q[1]), 'it must not restyle the buttons themselves (no deformation by another route)');
  assert.match(css, /\.watch-action-btns \.btn > i,\s*\.watch-action-btns \.btn > svg\s*\{\s*min-height: calc\(var\(--lh-relaxed\) \* 1em\);\s*\}/, 'the glyph keeps the label\'s line box so glyph-only buttons stay 32px (measured 30px without it)');
  const phone = css.slice(css.indexOf('@media (max-width: 768px)'));
  assert.match(phone, /\.watch-action-btns \.btn \.btn-label\s*\{\s*display:\s*none;\s*\}/, 'the v1.47.6 phone rule is still there');
});
