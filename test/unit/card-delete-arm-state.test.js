'use strict';

// [UNIT] v1.17.0 FR-3(b), T2 -- home/library card trash-can arm/disarm.
//
// `nextArmState` is the pure reducer that drives the card trash-can
// affordance's "first tap arms, second tap confirms" behavior
// (public/js/main.js's delegated #video-grid click listener). It is
// deliberately DOM/timer-free (main.js owns the ~3s auto-disarm timer and
// the document click/scroll outside-tap wiring) so the state machine itself
// is directly, exhaustively unit-testable -- mirrors this codebase's other
// pure-reducer tests (decideOneOffTerminalAction, nextArmState's sibling in
// common.js).

const { test } = require('node:test');
const assert = require('node:assert');
const { nextArmState } = require('../../public/js/common.js');

test('idle + tap arms the card WITHOUT deleting (first tap)', () => {
  const result = nextArmState('idle', 'tap');
  assert.deepStrictEqual(result, { state: 'armed', deleted: false });
});

test('armed + tap on the SAME control deletes (second/confirming tap)', () => {
  const result = nextArmState('armed', 'tap');
  assert.deepStrictEqual(result, { state: 'idle', deleted: true });
});

test('disarm from armed resets to idle WITHOUT ever deleting (timeout / outside click / scroll)', () => {
  const result = nextArmState('armed', 'disarm');
  assert.deepStrictEqual(result, { state: 'idle', deleted: false });
});

test('disarm from idle is a no-op (still idle, never deletes) -- defensive, e.g. a stray timeout after an already-disarmed card', () => {
  const result = nextArmState('idle', 'disarm');
  assert.deepStrictEqual(result, { state: 'idle', deleted: false });
});

test('an unrecognized action is defensive: never deletes, and preserves whatever "armed" state was already current', () => {
  assert.deepStrictEqual(nextArmState('armed', 'unknown-action'), { state: 'armed', deleted: false });
  assert.deepStrictEqual(nextArmState('idle', 'unknown-action'), { state: 'idle', deleted: false });
});

test('only a deleted:true result should ever fire the network call -- every non-tap-on-armed path returns deleted:false', () => {
  const allNonConfirmingTransitions = [
    nextArmState('idle', 'tap'),
    nextArmState('idle', 'disarm'),
    nextArmState('armed', 'disarm'),
    nextArmState('idle', 'noop'),
    nextArmState('armed', 'noop'),
  ];
  allNonConfirmingTransitions.forEach((result) => assert.strictEqual(result.deleted, false));
});
