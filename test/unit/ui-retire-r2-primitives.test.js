'use strict';

// [UNIT] Step 7 (retire R2, UI professionalism pass D10.4 amendment): the three small primitive
// additions Music and Podcasts retire their last hand-made controls onto, and the ladder rung
// for an in-content sticky bar. Source locks over the parsed rules (the cascade itself is
// measured by the before/after renders; jsdom cannot compute it):
//   - ui-tile: a card that is ONE button (Music's album / artist / Jump back in cards);
//   - ui-link: a text control that reads as its context (the artist lines);
//   - ui-row--current: the row that is playing now;
//   - --z-sticky: the in-content sticky bar's rung (the album drill's collapsed bar).

const { test } = require('node:test');
const assert = require('node:assert');
const { cssRules, isHoverGated, readUiCss, readTokensCss } = require('../helpers/stylesheets');

const RULES = cssRules(readUiCss());
const decls = (body) => {
  const out = {};
  for (const part of body.split(';')) {
    const i = part.indexOf(':');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
};
/** The one rule whose selector is exactly `sel` (fails loud on none or several). */
function rule(sel) {
  const hits = RULES.filter((r) => r.sel.split(',').map((s) => s.trim()).includes(sel) && !r.at);
  assert.strictEqual(hits.length, 1, `exactly one top-level rule lists ${sel} (got ${hits.length})`);
  return { ...hits[0], d: decls(hits[0].body) };
}

test('ui-tile: a chrome-less card button in the app type, with a press state and the focus ring', () => {
  const base = rule('.ui-tile');
  for (const [p, v] of Object.entries({ display: 'flex', 'flex-direction': 'column', padding: '0', border: '0', background: 'transparent', font: 'inherit', color: 'inherit', 'text-align': 'left', cursor: 'pointer', appearance: 'none', '-webkit-appearance': 'none' })) {
    assert.strictEqual(base.d[p], v, `.ui-tile ${p}`);
  }
  // transitions animate only a paint property (D2.4; never a layout one)
  assert.match(base.d.transition, /^opacity var\(--dur-press\) var\(--ease-std\)$/);
  const press = rule('.ui-tile:active');
  assert.ok(press.sel.includes('.ui-tile[data-pressed]'), 'the programmatic press twin shares the rule');
  assert.ok(Number(press.d.opacity) > 0 && Number(press.d.opacity) < 1, 'a press dims the card');
  assert.match(rule('.ui-tile:focus-visible').d.outline, /var\(--focus-ring\)/);
  assert.ok(!RULES.some((r) => /\.ui-tile[^,{]*:hover/.test(r.sel) && !isHoverGated(r.at)), 'no ungated hover');
});

test('ui-link: no chrome, its context\'s font and colour; --block fills its line and comes AFTER the base', () => {
  const base = rule('.ui-link');
  for (const [p, v] of Object.entries({ display: 'inline', margin: '0', padding: '0', border: '0', background: 'transparent', font: 'inherit', color: 'inherit', 'text-align': 'inherit', cursor: 'pointer', appearance: 'none' })) {
    assert.strictEqual(base.d[p], v, `.ui-link ${p}`);
  }
  const block = rule('.ui-link--block');
  assert.strictEqual(block.d.display, 'block');
  assert.strictEqual(block.d.width, '100%');
  // equal specificity: the modifier wins only by FILE ORDER (LESSONS 6)
  assert.ok(block.index > base.index, '.ui-link--block after .ui-link');
  const press = rule('.ui-link:active');
  assert.ok(press.sel.includes('.ui-link[data-pressed]'));
  assert.ok(Number(press.d.opacity) > 0 && Number(press.d.opacity) < 1);
  assert.match(rule('.ui-link:focus-visible').d.outline, /var\(--focus-ring\)/);
  // one class, never a type selector or :where - so a consumer's one-class rule in style.css
  // (loaded later) still wins by order, and a skin's two-class palette by specificity
  assert.ok(!RULES.some((r) => /:where\([^)]*ui-link/.test(r.sel)), 'no zero-specificity spelling');
});

test('ui-row--current: the selected tonal fill (never a red role) after the row base, and a heavier title', () => {
  const cur = rule('.ui-row--current');
  assert.strictEqual(cur.d['background-color'], 'var(--fill-selected)');
  assert.ok(cur.index > rule('.ui-row').index, 'after .ui-row (whose transparent ground it overrides at equal specificity)');
  assert.strictEqual(rule('.ui-row--current .ui-row__title').d['font-weight'], 'var(--fw-semibold)');
  assert.ok(!/accent|danger|indicator|progress/.test(cur.body), 'D8.8: selection is never red');
});

test('--z-sticky is a ladder rung in the local band: under the grandfathered sidebar (99) and every --z-* chrome rung', () => {
  const css = readTokensCss().replace(/\/\*[\s\S]*?\*\//g, '');
  const ladder = [...css.matchAll(/(--z-[\w-]+)\s*:\s*(\d+)\s*;/g)].map((m) => [m[1], Number(m[2])]);
  const sticky = ladder.find(([n]) => n === '--z-sticky');
  assert.ok(sticky, '--z-sticky is defined');
  assert.ok(sticky[1] > 0 && sticky[1] < 99, 'inside the local band, under the sidebar');
  for (const [n, v] of ladder) if (n !== '--z-sticky') assert.ok(v > sticky[1], `${n} above it`);
});
