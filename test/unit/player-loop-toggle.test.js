'use strict';

// [UNIT] FR-7 (v1.22.0, TF)'s pure 'ended'-action decision helper
// (public/js/player.js's `resolveEndedAction`) -- the regression lock for
// AC49's precedence rule: `loop: true` ALWAYS yields `'repeat'`, regardless
// of `autoplayNext`/`hasNext`, matching Dean's reconciliation instruction
// (loop = repeat THIS; autoplay = next) exactly. The live 'ended'-cluster
// wiring (the new loop listener + `handleAutoplayNext`'s early-return) is a
// hand-written mirror of this table against LIVE state read at 'ended' time
// -- not a caller of it -- so this table is what's regression-locked here;
// the DOM-heavy replay/navigate side effects are Dean's manual-test AC48/
// AC50/AC51/AC53 (no jsdom/browser harness in this codebase, see
// CONTRIBUTING.md).
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveEndedAction } = require('../../public/js/player.js');

// ---- loop ON always wins (AC49) ----------------------------------------------

test('resolveEndedAction: loop on, autoplay on, has next -- still repeat (loop wins)', () => {
  assert.strictEqual(resolveEndedAction({ loop: true, autoplayNext: true, hasNext: true }), 'repeat');
});

test('resolveEndedAction: loop on, autoplay on, no next -- still repeat (loop wins)', () => {
  assert.strictEqual(resolveEndedAction({ loop: true, autoplayNext: true, hasNext: false }), 'repeat');
});

test('resolveEndedAction: loop on, autoplay off, has next -- still repeat (loop wins)', () => {
  assert.strictEqual(resolveEndedAction({ loop: true, autoplayNext: false, hasNext: true }), 'repeat');
});

test('resolveEndedAction: loop on, autoplay off, no next -- still repeat (loop wins)', () => {
  assert.strictEqual(resolveEndedAction({ loop: true, autoplayNext: false, hasNext: false }), 'repeat');
});

// ---- loop OFF -- today's existing behavior, unchanged ------------------------

test('resolveEndedAction: loop off, autoplay on, has next -- advance', () => {
  assert.strictEqual(resolveEndedAction({ loop: false, autoplayNext: true, hasNext: true }), 'advance');
});

test('resolveEndedAction: loop off, autoplay on, no next -- stop (end of the order, no wrap)', () => {
  assert.strictEqual(resolveEndedAction({ loop: false, autoplayNext: true, hasNext: false }), 'stop');
});

test('resolveEndedAction: loop off, autoplay off, has next -- stop (autoplay setting is off)', () => {
  assert.strictEqual(resolveEndedAction({ loop: false, autoplayNext: false, hasNext: true }), 'stop');
});

test('resolveEndedAction: loop off, autoplay off, no next -- stop', () => {
  assert.strictEqual(resolveEndedAction({ loop: false, autoplayNext: false, hasNext: false }), 'stop');
});

// ---- defaults/missing input ---------------------------------------------------

test('resolveEndedAction: missing/empty ctx defaults to stop (never throws)', () => {
  assert.strictEqual(resolveEndedAction(), 'stop');
  assert.strictEqual(resolveEndedAction({}), 'stop');
});
