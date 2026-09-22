'use strict';

// [UNIT] v1.310 (Dean): the anti-BLEED census - the "net, not spot-fix" for the
// overlap/bleed class after three shipped device bugs (v1.309.0/.1 + one more)
// that each bled content over a panel header by a DIFFERENT mechanism.
//
// scripts/overlay-containment-lint.js binds two enumerable CSS invariants over
// public/css/style.css:
//   (a) corner-clip: a rule with a non-zero border-radius + overflow:auto/scroll
//       is the iOS rounded-corner clip-escape shape - FAIL unless it carries a
//       reviewed `corner-clip-safe: <reason>` comment.
//   (b) sticky-z:   every position:sticky rule declares a z-index.
//
// The real-stylesheet assertion is the ratchet (held at zero); the fixtures are
// the anti-vacuity floor - the linter's own history proves an unproven linter
// rots (css-token-lint's one-line/multi-line holes). Sibling guard:
// panel-chrome-mirror.test.js (the two panels' header z-index + row isolation).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { lintOverlay, radiusIsNonZero } = require('../../scripts/overlay-containment-lint.js');

const REPO = path.join(__dirname, '..', '..');
const STYLE_CSS = fs.readFileSync(path.join(REPO, 'public', 'css', 'style.css'), 'utf8');

// ---- the ratchet: the real stylesheet is clean --------------------------------

test('overlay-containment: public/css/style.css has ZERO violations (the ratchet)', () => {
  const violations = lintOverlay(STYLE_CSS);
  assert.deepStrictEqual(
    violations.map((v) => `${v.kind}:${v.selector}`),
    [],
    'every rounded scroll surface either splits clip from scroll or carries a reviewed corner-clip-safe exemption; every sticky rule carries a z-index'
  );
});

// ---- (a) corner-clip: anti-vacuity fixtures -----------------------------------

test('corner-clip: FAILS on a rule combining a non-zero border-radius with overflow:auto', () => {
  const v = lintOverlay('.x { border-radius: 8px; overflow: auto; }');
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].kind, 'corner-clip');
  assert.strictEqual(v[0].selector, '.x');
});

test('corner-clip: also trips on overflow-y and overflow-x scroll, and on a var() radius', () => {
  assert.strictEqual(lintOverlay('.x { border-radius: 8px; overflow-y: scroll; }').length, 1);
  assert.strictEqual(lintOverlay('.x { border-radius: 8px; overflow-x: auto; }').length, 1);
  assert.strictEqual(lintOverlay('.x { border-radius: var(--radius-lg); overflow-y: auto; }').length, 1);
});

test('corner-clip: PASSES when the rule carries a corner-clip-safe comment', () => {
  const v = lintOverlay('.x { border-radius: 8px; overflow: auto; /* corner-clip-safe: native control */ }');
  assert.deepStrictEqual(v, []);
});

test('corner-clip: a multi-line corner-clip-safe comment still exempts the rule', () => {
  const css = '.x {\n  border-radius: 8px;\n  /* corner-clip-safe:\n     a two-line reason */\n  overflow: auto;\n}';
  assert.deepStrictEqual(lintOverlay(css), []);
});

test('corner-clip: does NOT trip when border-radius is zero (the negative control)', () => {
  assert.deepStrictEqual(lintOverlay('.x { border-radius: 0; overflow: auto; }'), []);
  assert.deepStrictEqual(lintOverlay('.x { border-radius: 0px 0px 0 0; overflow-y: scroll; }'), []);
});

test('corner-clip: does NOT trip on overflow:hidden (the safe clip form) or a radius with no overflow', () => {
  assert.deepStrictEqual(lintOverlay('.x { border-radius: 8px; overflow: hidden; }'), []);
  assert.deepStrictEqual(lintOverlay('.x { border-radius: 8px; }'), []);
  assert.deepStrictEqual(lintOverlay('.x { overflow: auto; }'), []);
});

test('corner-clip: catches the two-value overflow form (overflow: hidden auto scrolls one axis)', () => {
  assert.strictEqual(lintOverlay('.x { border-radius: 8px; overflow: hidden auto; }').length, 1);
  assert.strictEqual(lintOverlay('.x { border-radius: 8px; overflow: auto hidden; }').length, 1);
  assert.deepStrictEqual(lintOverlay('.x { border-radius: 8px; overflow: hidden clip; }'), []);
});

test('corner-clip: one-line rules are seen (the css-token-lint one-line blind-spot must not recur)', () => {
  assert.strictEqual(lintOverlay('.x{border-radius:8px;overflow-y:auto;display:flex}').length, 1);
});

// ---- (b) sticky-z: anti-vacuity fixtures --------------------------------------

test('sticky-z: FAILS on a position:sticky rule with no z-index', () => {
  const v = lintOverlay('.y { position: sticky; top: 0; }');
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].kind, 'sticky-zindex');
});

test('sticky-z: PASSES when the sticky rule declares a z-index', () => {
  assert.deepStrictEqual(lintOverlay('.y { position: sticky; top: 0; z-index: 1; }'), []);
});

test('sticky-z: covers -webkit-sticky too', () => {
  assert.strictEqual(lintOverlay('.y { position: -webkit-sticky; top: 0; }').length, 1);
});

// ---- radiusIsNonZero unit ------------------------------------------------------

test('radiusIsNonZero: zero forms are zero; px/%/var forms are non-zero', () => {
  for (const z of ['0', '0px', '0 0 0 0', 'none', 'inherit']) assert.strictEqual(radiusIsNonZero(z), false, z);
  for (const nz of ['8px', '50%', 'var(--radius-lg)', 'var(--radius-lg) var(--radius-lg) 0 0']) {
    assert.strictEqual(radiusIsNonZero(nz), true, nz);
  }
});
