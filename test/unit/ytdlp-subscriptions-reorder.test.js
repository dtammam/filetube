'use strict';

// [UNIT] v1.76 adversarial gate W1 - the subscriptions list's reorder decision.
//
// The finding: this surface was migrated to the shared gesture layer with NO
// execution binding at all. The seat measured it - swapping the two index
// arguments, so every drag persists a DIFFERENT order than the one dropped,
// survived all 4472 unit tests. Reverting the wave's own row-alignment fix
// survived too. What existed was a presence lock (the census sees the
// `rowSelector:` site) which cannot see either mutant.
//
// The wiring closure is nested inside `initSubscriptionsView` and is not
// reachable from a test, and re-implementing its body in a fixture would be
// this repo's own divergent-fixture class (a green test through broken code).
// So the DECISION was hoisted to module scope instead, and these tests execute
// the real thing with the real `moveArrayItem`.

const { test } = require('node:test');
const assert = require('node:assert');

const { moveArrayItem } = require('../../public/js/common.js');
const { deriveReorderRowSubs, buildSubscriptionReorderHandler } = require('../../lib/ytdlp/client/subscriptions.js');

const SUBS = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'c', name: 'Charlie' },
  { id: 'd', name: 'Delta' },
];

// Builds the handler exactly as the view closure does, with the REAL mover.
function handlerFor(subs) {
  const persisted = [];
  const onReorder = buildSubscriptionReorderHandler({
    getSubs: () => subs,
    persist: (ids) => persisted.push(ids),
    move: moveArrayItem,
  });
  return { onReorder, persisted };
}

// ---- deriveReorderRowSubs ---------------------------------------------------

test('deriveReorderRowSubs: keeps exactly the subscriptions that get a data-sub-id row', () => {
  // Same predicate as createSubscriptionRow's stamp. A subscription without a
  // usable id still RENDERS a row, but that row is not a drag target - so it
  // must not occupy an index in the reorder list.
  const mixed = [{ id: 'a' }, { name: 'no id' }, { id: '' }, { id: 'b' }, null];
  assert.deepEqual(deriveReorderRowSubs(mixed).map((s) => s.id), ['a', 'b']);
});

test('deriveReorderRowSubs: a non-array degrades to empty rather than throwing', () => {
  assert.deepEqual(deriveReorderRowSubs(undefined), []);
  assert.deepEqual(deriveReorderRowSubs('junk'), []);
});

// ---- the handler: argument order --------------------------------------------

test('W1: dragging the FIRST row to the last position persists that order, not its inverse', () => {
  // The exact mutant the seat landed: `move(rowSubs, toIndex, fromIndex)`
  // survived the whole suite. This assertion is what kills it.
  const { onReorder, persisted } = handlerFor(SUBS);
  onReorder(0, 3);
  assert.deepEqual(persisted, [['b', 'c', 'd', 'a']]);
});

test('W1: dragging the LAST row to the first position is not the same as the reverse move', () => {
  const { onReorder, persisted } = handlerFor(SUBS);
  onReorder(3, 0);
  assert.deepEqual(persisted, [['d', 'a', 'b', 'c']]);
});

test('W1: an adjacent swap is directional', () => {
  const down = handlerFor(SUBS);
  down.onReorder(1, 2);
  assert.deepEqual(down.persisted, [['a', 'c', 'b', 'd']]);
  // Same PAIR, opposite direction: for a single adjacent swap the resulting
  // array is identical, so this case alone can NEVER catch a swapped-argument
  // mutant - which is precisely why the end-to-end moves above exist.
  const up = handlerFor(SUBS);
  up.onReorder(2, 1);
  assert.deepEqual(up.persisted, [['a', 'c', 'b', 'd']]);
});

test('W1: a middle row moved across the list keeps every other id in relative order', () => {
  const { onReorder, persisted } = handlerFor(SUBS);
  onReorder(1, 3);
  assert.deepEqual(persisted, [['a', 'c', 'd', 'b']]);
});

// ---- the handler: row alignment ---------------------------------------------

test('W1: an id-less subscription does not shift the rows after it', () => {
  // The wave's own alignment fix, bound. With the old full-list indexing, row 0
  // ('a') would resolve to the id-less record and the persisted order would be
  // wrong for every row after it.
  const withGap = [{ name: 'no id' }, { id: 'a' }, { id: 'b' }, { id: 'c' }];
  const { onReorder, persisted } = handlerFor(withGap);
  onReorder(0, 2); // row 0 IS 'a' - the id-less record is not a row
  assert.deepEqual(persisted, [['b', 'c', 'a']]);
});

test('W1: id-less subscriptions never reach the persisted payload', () => {
  const withGaps = [{ id: 'a' }, { name: 'x' }, { id: 'b' }, { id: '' }, { id: 'c' }];
  const { onReorder, persisted } = handlerFor(withGaps);
  onReorder(2, 0);
  assert.deepEqual(persisted, [['c', 'a', 'b']], 'only real ids, in the dragged order');
});

test('W1: the handler reads the subscriptions LIVE, never a stale snapshot', () => {
  // `getSubs` is a thunk so the handler reads whatever the view currently
  // holds rather than whatever it held when the rows were wired.
  //
  // CORRECTED (adversarial gate round 2): an earlier version of this comment
  // claimed "the list is replaced wholesale by every poll and every persist
  // response". That is false, and measurably so - `currentSubs` has exactly
  // three assignments (the initializer plus two `.then` handlers), and BOTH
  // writers call `renderSubscriptions()` on the very next line, which re-wires
  // with a fresh handler. The ~2.5s status poll never assigns it at all; it
  // goes through `applyStatusUpdatesInPlace`, whose own contract is that it
  // "never removes/reorders/replaces any row".
  //
  // So thunk and snapshot agree everywhere EXCEPT inside a gesture still in
  // flight when a rebuild lands - and there neither is right: a live read
  // moves whatever now sits at the dragged index, a snapshot moves a record
  // that may no longer exist. That case is refused upstream now, by the
  // detached-row check in `wireReorderable`'s endGesture, which is why the
  // thunk can go on being simply "the live read" without needing to justify
  // itself as a race fix. It is not one.
  let subs = [{ id: 'a' }, { id: 'b' }];
  const persisted = [];
  const onReorder = buildSubscriptionReorderHandler({
    getSubs: () => subs,
    persist: (ids) => persisted.push(ids),
    move: moveArrayItem,
  });
  subs = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
  onReorder(0, 2);
  assert.deepEqual(persisted, [['y', 'z', 'x']]);
});

test('W1: an empty list persists an empty payload rather than throwing', () => {
  const { onReorder, persisted } = handlerFor([]);
  onReorder(0, 0);
  assert.deepEqual(persisted, [[]]);
});
