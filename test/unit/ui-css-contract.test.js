'use strict';

// [UNIT] UI professionalism pass step 3: the primitives' stylesheet keeps its own rules
// (plan D4 conventions). Step 4's ui-lint generalizes these to every stylesheet; until
// then this pins them on public/css/ui.css, comments stripped (a lock satisfied by prose
// is the v1.50.3 class).

const { test } = require('node:test');
const assert = require('node:assert');
const { readUiCss } = require('../helpers/stylesheets');

const CSS = readUiCss().replace(/\/\*[\s\S]*?\*\//g, '');

// top-level rules and the @media block each sits in ('' at top level)
function rules(css) {
  const out = [];
  let i = 0; const stack = [];
  let prelude = '';
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      const p = prelude.trim(); prelude = '';
      if (p.startsWith('@')) { stack.push(p); i++; continue; }
      const end = css.indexOf('}', i);
      out.push({ sel: p, body: css.slice(i + 1, end), at: stack.filter((s) => s.startsWith('@media')).join(' ') });
      i = end + 1; continue;
    }
    if (ch === '}') { stack.pop(); prelude = ''; i++; continue; }
    prelude += ch; i++;
  }
  return out;
}
const RULES = rules(CSS);

test('the parser sees the stylesheet (guards the checks below against going vacuous)', () => {
  assert.ok(RULES.length > 150, `rules found: ${RULES.length}`);
});

test('every :hover is inside @media (hover: hover) (AC6: a touch screen never keeps a hover tint)', () => {
  const bad = RULES.filter((r) => /:hover/.test(r.sel) && !/\(hover:\s*hover\)/.test(r.at)).map((r) => r.sel);
  assert.deepStrictEqual(bad, []);
});

test('every interactive primitive has a pressed state (AC6)', () => {
  for (const part of ['.ui-btn', '.ui-chip--filter', 'a.ui-row', 'button.ui-row', '.ui-row__link', '.ui-switch', '.ui-segmented__item', '.ui-swipe__action']) {
    assert.ok(RULES.some((r) => r.sel.split(',').some((s) => s.includes(part) && /:active|\[data-pressed\]/.test(s))), `${part} has :active`);
  }
});

test('no transition names a layout property, and none is `all` (AC9)', () => {
  const LAYOUT = /\b(width|height|margin|padding|top|left|right|bottom|inset|grid-[a-z-]+|gap|flex-basis)\b/;
  for (const r of RULES) {
    const m = /(?:^|;)\s*transition(?:-property)?\s*:([^;]+)/.exec(r.body);
    if (!m) continue;
    assert.doesNotMatch(m[1], /\ball\b/, `${r.sel}: transition: all`);
    for (const part of m[1].split(',')) {
      assert.doesNotMatch(part.trim().split(/\s+/)[0], LAYOUT, `${r.sel}: transitions a layout property (${part.trim()})`);
    }
  }
});

test('no vertical-align anywhere in the primitives (centring is by box, AC4)', () => {
  assert.doesNotMatch(CSS, /vertical-align/);
});

test('[hidden] always wins, and the icon sprite never takes a box', () => {
  assert.ok(RULES.some((r) => r.sel === '[hidden]' && /display:\s*none\s*!important/.test(r.body) && r.at === ''));
  assert.ok(RULES.some((r) => r.sel === '#ft-icon-sprite' && /display:\s*none/.test(r.body)));
});

test('F20: a row link never underlines, and the rule outranks style.css\'s 2005 `a` underline', () => {
  const r = RULES.find((x) => /\[data-theme\] \.ui-row__link/.test(x.sel));
  assert.ok(r && /text-decoration:\s*none/.test(r.body), 'the [data-theme]-prefixed no-underline rule exists');
  assert.ok(/\[data-theme\] a\.ui-row/.test(r.sel));
});

test('reduced motion: sheets fade only, and nothing gates the open class (F48)', () => {
  const rm = RULES.filter((r) => /prefers-reduced-motion:\s*reduce/.test(r.at) && /\.ui-sheet/.test(r.sel));
  assert.ok(rm.some((r) => /transform:\s*none/.test(r.body) && /transition:\s*opacity/.test(r.body)));
  assert.ok(RULES.some((r) => r.sel === '.ui-sheet.is-open' && /opacity:\s*1/.test(r.body)), 'is-open shows the sheet in every motion mode');
});

test('lists: column-gap 0 (each declared column carries its own spacing), and undeclared slots are hidden WITHOUT leaving the grid', () => {
  const row = RULES.find((r) => r.sel === '.ui-row');
  assert.match(row.body, /column-gap:\s*0;/, 'a zero-width column would still cost its gap');
  const hide = RULES.find((r) => /\.ui-list:not\(\.ui-list--lead\) > \.ui-row > \.ui-row__lead/.test(r.sel));
  assert.ok(hide && /\.ui-list--media-none > \.ui-row > \.ui-row__media/.test(hide.sel));
  assert.match(hide.body, /visibility:\s*hidden/);
  assert.doesNotMatch(hide.body, /display/, 'display:none would drop the slot and shift the body into column 1');
  assert.ok(RULES.some((r) => r.sel === '.ui-list--lead' && /--lead-w:\s*var\(--space-8\)/.test(r.body)));
  assert.ok(RULES.some((r) => r.sel === '.ui-list' && /--lead-w:\s*0px/.test(r.body)), 'no lead column unless declared');
});

test('a list inside a sheet (every ui.menu) takes the group inset', () => {
  const r = RULES.find((x) => x.sel === '.ui-sheet__body > .ui-list');
  assert.ok(r && /--row-pad-start:\s*var\(--inset\)/.test(r.body));
});

test('a rounded overlay that scrolls splits clip from scroll (LESSONS 6)', () => {
  const sheet = RULES.find((r) => r.sel === '.ui-sheet');
  assert.match(sheet.body, /overflow:\s*hidden/);
  const body = RULES.find((r) => r.sel === '.ui-sheet__body');
  assert.match(body.body, /overflow-y:\s*auto/);
  assert.doesNotMatch(body.body, /border-radius/);
});

// Sweep S8: Settings' switches are native checkboxes wearing .ui-switch (their .checked and
// change wiring stay native). The checkbox form must drop the UA box and paint exactly what
// the button form paints for each state, or a Settings switch and a kit switch diverge.
test('ui-switch on a native checkbox: UA appearance dropped, :checked mirrors aria-checked (sweep S8)', () => {
  const body = (sel) => { const r = RULES.find((x) => x.sel === sel && x.at === ''); assert.ok(r, `rule ${sel}`); return r.body.replace(/\s+/g, ' ').trim(); };
  const inputRule = body('input.ui-switch');
  assert.match(inputRule, /(^|;)\s*appearance: none/);
  assert.match(inputRule, /-webkit-appearance: none/);
  assert.strictEqual(body('.ui-switch:checked'), body('.ui-switch[aria-checked="true"]'));
  assert.strictEqual(body('.ui-switch:checked::before'), body('.ui-switch[aria-checked="true"]::before'));
  assert.strictEqual(body('.ui-switch:checked:active::before'), body('.ui-switch[aria-checked="true"]:active::before'));
});
