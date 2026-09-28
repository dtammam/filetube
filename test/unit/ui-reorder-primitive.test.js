'use strict';

// [UNIT] Step 7 retire (R3 primitive fix): ui-reorder, the item of a drag-to-reorder list.
// The gesture layer (common.js wireReorderable) stamps its DEFAULT state classes on the item it
// moves (dragging / drag-over-before / drag-over-after); a list whose items wear .ui-reorder
// shows the drag through these ui.css rules instead of a per-surface family in style.css.
// Pins: the three state rules exist as exact selectors, the drop line is a role colour (never the
// red accent fill or a legacy name), the grip takes touch-action (and only the grip), and the
// grip's keyboard focus draws the one focus ring (D2: red is reserved).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { cssRules } = require('../helpers/stylesheets');

const UI_CSS = fs.readFileSync(path.join(__dirname, '../../public/css/ui.css'), 'utf8');
const rules = cssRules(UI_CSS);
const sels = (r) => r.sel.split(',').map((x) => x.trim().replace(/\s+/g, ' '));
const ruleFor = (sel, from = rules) => from.filter((r) => sels(r).includes(sel));
const one = (sel, from = rules) => {
  const found = ruleFor(sel, from);
  assert.strictEqual(found.length, 1, `exactly one ${sel} rule in ui.css (found ${found.length})`);
  return found[0].body;
};

test('ui-reorder: the three gesture-state rules exist on the primitive, with wireReorderable\'s default class names', () => {
  // the class names the gesture layer stamps (common.js REORDER_DEFAULT_CLASSES)
  const common = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  const m = /REORDER_DEFAULT_CLASSES\s*=\s*\{\s*dragging:\s*'([^']+)',\s*before:\s*'([^']+)',\s*after:\s*'([^']+)'\s*\}/.exec(common);
  assert.ok(m, 'the gesture layer still names its default state classes');
  const [, dragging, before, after] = m;
  assert.match(one(`.ui-reorder.${dragging}`), /opacity:\s*0\.5/, 'the dragged item dims');
  const b = one(`.ui-reorder.${before}`);
  const a = one(`.ui-reorder.${after}`);
  assert.match(b, /box-shadow:\s*inset 0 var\(--ring-w\) 0 0 var\(--indicator\)/, 'the before line: top edge, the indicator role');
  assert.match(a, /box-shadow:\s*inset 0 calc\(0px - var\(--ring-w\)\) 0 0 var\(--indicator\)/, 'the after line: bottom edge, the indicator role');
  for (const body of [b, a]) assert.doesNotMatch(body, /--yt-red|--accent-fill|#[0-9a-f]{3,8}\b/i, 'a role colour, never a legacy name, the fill or a literal');
});

test('ui-reorder__handle: the grip owns touch-action (and nothing else in ui.css takes it for a reorder item), and focus draws the focus ring', () => {
  const h = one('.ui-reorder__handle');
  assert.match(h, /touch-action:\s*none/, 'a press on the grip arms at once');
  assert.match(h, /cursor:\s*grab/);
  assert.doesNotMatch(one('.ui-reorder'), /touch-action/, 'the item keeps the list scrollable by finger');
  const f = one('.ui-reorder__handle:focus-visible');
  assert.match(f, /outline:\s*var\(--ring-w\) solid var\(--focus-ring\)/, 'the one focus ring, not red');
  assert.match(one('.ui-reorder__handle::before'), /content:\s*"\\22EE\\22EE"/, 'the grip glyph is drawn by CSS (no text glyph in a template)');
});

test('ui-reorder: a mutated state rule is caught (the lock can fail)', () => {
  const mutated = cssRules(UI_CSS.replace(/\.ui-reorder\.drag-over-after\s*\{[^}]*\}/, ''));
  assert.strictEqual(ruleFor('.ui-reorder.drag-over-after', mutated).length, 0);
  const commented = cssRules('/* .ui-reorder.dragging { opacity: 0.5 } */ .x { color: red }');
  assert.strictEqual(ruleFor('.ui-reorder.dragging', commented).length, 0, 'a comment is never a rule');
});
