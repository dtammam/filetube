'use strict';

// [UNIT] v1.289 (Dean): the drag-safe backdrop dismiss (public/js/common.js
// bindBackdropDismiss). The download and subscribe modals used to close on a
// text-selection DRAG that began inside a field and released on the backdrop -
// the browser dispatches the synthesized `click` on the common ancestor of
// press-and-release (the backdrop), so `e.target === backdrop` was true and the
// modal vanished mid-edit. The fix requires the pointerdown to have landed on
// the backdrop too. These tests drive the two axes: a clean tap CLOSES, and a
// drag that starts inside the modal NEVER closes, regardless of where it ends.

const { test } = require('node:test');
const assert = require('node:assert');
const { bindBackdropDismiss } = require('../../public/js/common.js');

// A minimal fake backdrop: captures listeners by type and lets a test fire a
// synthetic event with a chosen `target`. The backdrop object IS the identity
// bindBackdropDismiss compares `e.target` against.
function makeBackdrop() {
  const listeners = {};
  const backdrop = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, target) { for (const fn of (listeners[type] || [])) fn({ target }); },
  };
  return backdrop;
}

test('clean tap on the backdrop (pointerdown + click both on backdrop) CLOSES', () => {
  const backdrop = makeBackdrop();
  let closed = 0;
  bindBackdropDismiss(backdrop, () => { closed += 1; });
  backdrop.fire('pointerdown', backdrop);
  backdrop.fire('click', backdrop);
  assert.equal(closed, 1, 'a genuine backdrop tap still dismisses');
});

test('drag from a field onto the backdrop (pointerdown inside, click on backdrop) does NOT close', () => {
  const backdrop = makeBackdrop();
  const urlInput = { name: 'url-input' }; // any non-backdrop target
  let closed = 0;
  bindBackdropDismiss(backdrop, () => { closed += 1; });
  // Press begins inside the modal's field, release lands on the backdrop -> the
  // synthesized click's target is the backdrop, but the press was not.
  backdrop.fire('pointerdown', urlInput);
  backdrop.fire('click', backdrop);
  assert.equal(closed, 0, 'the exact bug Dean hit: selecting text must not eat the modal');
});

test('drag from the backdrop into the modal (pointerdown on backdrop, click on a child) does NOT close', () => {
  const backdrop = makeBackdrop();
  const child = { name: 'modal-child' };
  let closed = 0;
  bindBackdropDismiss(backdrop, () => { closed += 1; });
  backdrop.fire('pointerdown', backdrop);
  backdrop.fire('click', child);
  assert.equal(closed, 0, 'a click whose target is not the backdrop never dismisses');
});

test('the backdrop-press flag is CONSUMED: a second click needs its own fresh press', () => {
  const backdrop = makeBackdrop();
  let closed = 0;
  bindBackdropDismiss(backdrop, () => { closed += 1; });
  backdrop.fire('pointerdown', backdrop);
  backdrop.fire('click', backdrop); // closes (1)
  backdrop.fire('click', backdrop); // no new pointerdown -> must NOT re-fire
  assert.equal(closed, 1, 'a lone click after a consumed press does not re-close');
});

test('a press inside the modal that never released on the backdrop leaves the flag false', () => {
  const backdrop = makeBackdrop();
  const field = { name: 'field' };
  let closed = 0;
  bindBackdropDismiss(backdrop, () => { closed += 1; });
  // First a real drag-from-field (flag stays false), THEN a clean backdrop tap
  // must still work - the flag is re-evaluated on every pointerdown.
  backdrop.fire('pointerdown', field);
  backdrop.fire('click', backdrop); // drag case -> no close
  assert.equal(closed, 0);
  backdrop.fire('pointerdown', backdrop);
  backdrop.fire('click', backdrop); // clean tap -> close
  assert.equal(closed, 1, 'pointerdown target is re-evaluated each interaction');
});

test('defensive: a missing backdrop or non-function onClose never throws', () => {
  assert.doesNotThrow(() => bindBackdropDismiss(null, () => {}));
  assert.doesNotThrow(() => bindBackdropDismiss(undefined));
  const backdrop = makeBackdrop();
  assert.doesNotThrow(() => {
    bindBackdropDismiss(backdrop, 'not-a-function');
    backdrop.fire('pointerdown', backdrop);
    backdrop.fire('click', backdrop);
  });
});

// v1.289: bind that BOTH paste-a-URL modals actually route their dismiss through
// the drag-safe helper (a source-lock - the fix is worthless if a builder still
// carries the old inline `e.target === backdrop` close). Enumerate the two
// builders and assert each calls bindBackdropDismiss and no longer inline-closes.
test('both the download and subscribe modals route dismiss through bindBackdropDismiss', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../public/js/common.js'), 'utf8');
  const oneoff = src.slice(src.indexOf('function buildOneOffModal('), src.indexOf('function buildOneOffModal(') + 900);
  const subscribe = src.slice(src.indexOf('function buildSubscribeModal('), src.indexOf('function buildSubscribeModal(') + 900);
  assert.match(oneoff, /bindBackdropDismiss\(backdrop,/, 'the download modal must use the drag-safe helper');
  assert.match(subscribe, /bindBackdropDismiss\(backdrop,/, 'the subscribe modal must use the drag-safe helper');
  // The porous inline pattern must be gone from BOTH builders (it would reintroduce the bug).
  assert.doesNotMatch(oneoff, /backdrop\.addEventListener\('click'/, 'no inline backdrop click-close survives in the download modal');
  assert.doesNotMatch(subscribe, /backdrop\.addEventListener\('click'/, 'no inline backdrop click-close survives in the subscribe modal');
});
