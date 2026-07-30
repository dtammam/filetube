'use strict';

// [UNIT] Tier 2 Step 0 - the zero-delta certifier's fixture suite. The old
// scratchpad verifier had two MUTATION-PROVEN blind spots (slim-gate W1):
// custom-property definition changes passed silently, and selector renames
// passed silently. Both holes carry killing tests here, plus the
// equivalence semantics the certifier promises. The Tier 2 ban on the old
// script lifts only while this suite is green.

const { test } = require('node:test');
const assert = require('node:assert');
const { diffCss, resolveValue, canonicalize } = require('../../scripts/css-equivalence-diff.js');

const BASE = `
:root { --fw-bold: 700; --accent-x: #cc0000; --pad: 8px; }
[data-theme="2005"] { --accent-x: #990000; }
[data-theme="2005"][data-mode="dark"] { --accent-x: #660000; }
.a { font-weight: bold; color: #ffffff; }
.b { padding: var(--pad); color: var(--accent-x); }
@media (max-width: 768px) { .a { color: #000; } }
`;

test('identical input is EQUIVALENT across every era/mode context', () => {
  const r = diffCss(BASE, BASE);
  assert.equal(r.equivalent, true);
  assert.ok(r.contexts.length >= 3, 'default + 2005 light/dark contexts enumerated');
});

test('comment-only and whitespace changes are EQUIVALENT', () => {
  const b = BASE.replace('.a {', '.a { /* a trailing note */')
    .replace('color: #ffffff;', 'color:   #ffffff;  /* token-exempt: x */');
  assert.equal(diffCss(BASE, b).equivalent, true);
});

test('HOLE 1 killed: a CONSUMED definition value change DIFFERS, in the right contexts only', () => {
  const b = BASE.replace('--pad: 8px', '--pad: 9px');
  const r = diffCss(BASE, b);
  assert.equal(r.equivalent, false, 'the old verifier passed this silently');
  const line = JSON.stringify(r.report);
  assert.match(line, /9px/);
  // era-scoped def change: only that era's contexts report
  const c = diffCss(BASE, BASE.replace('[data-theme="2005"] { --accent-x: #990000; }', '[data-theme="2005"] { --accent-x: #991111; }'));
  assert.equal(c.equivalent, false);
  const ctxNames = c.report.map((x) => x.context);
  assert.deepEqual(ctxNames, ['2005-light'], 'the dark context keeps its own more-specific override; default untouched');
});

test('HOLE 2 killed: a selector rename DIFFERS', () => {
  const b = BASE.replace('.b {', '.b-renamed {');
  const r = diffCss(BASE, b);
  assert.equal(r.equivalent, false, 'the old verifier compared declarations only');
  assert.match(JSON.stringify(r.report), /b-renamed/);
});

test('an ADDED but UNCONSUMED definition is EQUIVALENT (documented by-design: no rendered delta)', () => {
  const b = BASE.replace(':root { ', ':root { --brand-new-token: 42px; ');
  assert.equal(diffCss(BASE, b).equivalent, true);
});

test('token adoption equivalence: bold vs var(--fw-bold), longhand vs shorthand hex', () => {
  const b = BASE
    .replace('font-weight: bold', 'font-weight: var(--fw-bold)')
    .replace('color: #ffffff', 'color: #fff');
  assert.equal(diffCss(BASE, b).equivalent, true,
    'resolution + canonicalization must certify a 1:1 adoption pass with zero substitution tables');
});

test('declaration order: distinct-property reorder is EQUIVALENT; same-property duplicate swap DIFFERS', () => {
  const a = '.x { color: #111111; margin: 1px; }';
  const b = '.x { margin: 1px; color: #111111; }';
  assert.equal(diffCss(a, b).equivalent, true);
  const dupA = '.x { color: #111111; color: #222222; }';
  const dupB = '.x { color: #222222; color: #111111; }';
  assert.equal(diffCss(dupA, dupB).equivalent, false, 'last-one-wins makes this a rendering change');
});

test('RULE order matters: swapping two rules DIFFERS (cascade order is rendering-relevant)', () => {
  const a = '.x { color: #111111; } .y { color: #222222; }';
  const b = '.y { color: #222222; } .x { color: #111111; }';
  assert.equal(diffCss(a, b).equivalent, false);
});

test('@media context is part of selector identity', () => {
  const a = '.x { color: #111111; } @media (max-width: 768px) { .x { color: #222222; } }';
  const b = '.x { color: #222222; } @media (max-width: 768px) { .x { color: #111111; } }';
  assert.equal(diffCss(a, b).equivalent, false);
});

test('era x mode resolution: the dark-mode combo tier outranks the era tier', () => {
  // resolveValue itself via defMapFor is exercised through diffCss; assert
  // the resolved streams by probing a value change ONLY in the dark combo
  const b = BASE.replace('--accent-x: #660000', '--accent-x: #661111');
  const r = diffCss(BASE, b);
  assert.equal(r.equivalent, false);
  assert.deepEqual(r.report.map((x) => x.context), ['2005-dark']);
});

test('an unresolved var (no definition, no fallback) is marked, and name changes DIFFER', () => {
  const a = '.x { color: var(--ghost); }';
  const b = '.x { color: var(--ghost2); }';
  assert.equal(diffCss(a, a).equivalent, true);
  assert.equal(diffCss(a, b).equivalent, false);
  assert.match(resolveValue('var(--ghost)', {}, 0), /UNRESOLVED\(--ghost\)/);
});

test('var() fallbacks resolve: the ghost-token pattern var(--accent, #cc0000) renders its fallback', () => {
  assert.equal(resolveValue('var(--accent, #cc0000)', {}, 0), '#cc0000');
  assert.equal(resolveValue('var(--accent, var(--fw-bold))', { '--fw-bold': '700' }, 0), '700');
});

test('canonicalize: font-weight keywords, hex case, rgba spacing', () => {
  assert.equal(canonicalize('font-weight', 'bold'), '700');
  assert.equal(canonicalize('color', '#ABC'), '#aabbcc');
  assert.equal(canonicalize('background', 'rgba(0,0,0,0.5)'), canonicalize('background', 'rgba(0, 0, 0, 0.5)'));
});

test('@keyframes bodies are compared (opaque pseudo-rules) - a changed keyframe DIFFERS', () => {
  const a = '@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }';
  const b = a.replace('360deg', '180deg');
  assert.equal(diffCss(a, a).equivalent, true);
  assert.equal(diffCss(a, b).equivalent, false);
});

test('an opaque at-block never leaks its context onto later rules (the @font-face :: label bug)', () => {
  const a = '@font-face { font-family: X; } .after { color: #111111; } @media (max-width: 768px) { .after { color: #222222; } }';
  const { parseCss } = require('../../scripts/css-equivalence-diff.js');
  const rules = parseCss(a).rules;
  const after = rules.find((r) => r.selector === '.after');
  assert.equal(after.atContext, '', 'a closed @font-face must not prefix later selectors');
  const inMedia = rules.filter((r) => r.selector === '.after');
  assert.equal(inMedia.length, 2);
  assert.match(inMedia[1].atContext, /@media/, 'the @media pairing survives an earlier opaque block');
  // and ASYMMETRIC opaque blocks must not scramble equivalence
  const b = '.after { color: #111111; } @media (max-width: 768px) { .after { color: #222222; } }';
  const r = diffCss(a, b);
  assert.equal(r.equivalent, false, 'the missing @font-face itself is a real reported delta');
  assert.ok(!JSON.stringify(r.report).includes('@font-face :: .after'), 'and .after is never mislabeled');
});
