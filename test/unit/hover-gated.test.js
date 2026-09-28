'use strict';

// [UNIT] UI professionalism pass step 4, AC6 (touch states): every :hover rule in the
// app's stylesheets sits inside @media (hover: hover). A touch screen (iOS Safari,
// the PWA) matches :hover on the element last TAPPED and keeps it until the next
// tap elsewhere, so an ungated hover tint sticks after every tap. On a mouse device
// the media query matches and nothing changes (@media adds no specificity, and the
// wrap kept every rule in its cascade position).
//
// The full ui-lint `hover-gated` rule arrives separately; this pins the stylesheets
// the shells load (tokens.css, ui.css, style.css). Comments are stripped by the
// parser, so a :hover in prose cannot satisfy or trip it. Out of scope here:
// lib/ytdlp/views/subscriptions.html's inline <style> (sweep S5 moves it) and
// diag.html's standalone inline <style> (a diagnostics page with its own sheet).

const { test } = require('node:test');
const assert = require('node:assert');
const { cssRules, isHoverGated, readTokensCss, readUiCss, readStyleCss } = require('../helpers/stylesheets');

const SHEETS = { 'tokens.css': readTokensCss(), 'ui.css': readUiCss(), 'style.css': readStyleCss() };
const ungated = (css) => cssRules(css).filter((r) => /:hover/.test(r.sel) && !isHoverGated(r.at)).map((r) => r.sel);

test('the parser sees style.css and its hover rules (guards the lock below against going vacuous)', () => {
  const rules = cssRules(SHEETS['style.css']);
  assert.ok(rules.length > 2000, `style.css rules parsed: ${rules.length}`);
  const hovers = rules.filter((r) => /:hover/.test(r.sel));
  // The floor only proves the parser SEES hover rules (a vacuous lock passes on zero). The
  // sweeps delete bespoke hover rules as surfaces move onto ui.css (92 at step 4, 48 after S4),
  // so it is a small floor, not a count to hold.
  assert.ok(hovers.length > 20, `style.css :hover rules parsed: ${hovers.length}`);
});

for (const [name, css] of Object.entries(SHEETS)) {
  test(`${name}: no :hover rule outside @media (hover: hover) (AC6)`, () => {
    assert.deepStrictEqual(ungated(css), [], `${name} has ungated :hover rules`);
  });
}

test('canaries: the check flags an ungated hover (top level and inside a width query) and accepts the gated forms', () => {
  assert.deepStrictEqual(ungated('.a:hover { color: red; }'), ['.a:hover']);
  assert.deepStrictEqual(ungated('@media (max-width: 768px) { .a:hover { color: red; } }'), ['.a:hover']);
  assert.deepStrictEqual(ungated('.a, .b:hover { color: red; }'), ['.a, .b:hover'], 'a mixed list is flagged whole');
  assert.deepStrictEqual(ungated('/* .x:hover { } */ .a { color: red; }'), [], 'prose is not a rule');
  assert.deepStrictEqual(ungated('@media (hover: hover) { .a:hover { color: red; } }'), []);
  assert.deepStrictEqual(ungated('@media (max-width: 768px) { @media (hover: hover) { .a:hover { color: red; } } }'), []);
  assert.deepStrictEqual(ungated('@media (hover:hover) and (pointer: fine) { .a:hover { color: red; } }'), []);
  assert.deepStrictEqual(ungated('@media (hover: none) { .a:hover { color: red; } }'), ['.a:hover'], 'hover: none is not a gate');
  assert.deepStrictEqual(ungated('@media not all and (hover: hover) { .a:hover { color: red; } }'), ['.a:hover'], 'a negated query is not a gate');
});
