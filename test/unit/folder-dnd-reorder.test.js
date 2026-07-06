'use strict';

// v1.15.0 item 1 (folder drag-and-drop reordering) -- the pure client-side
// reorder helpers exposed from the browser common.js via the same
// `typeof module` guard as the other client-side pure helpers (mirrors
// test/unit/quickwins-sidebar-view.test.js). These three helpers are the
// SHARED model behind both the new native HTML5 drag-and-drop (Setup folder
// list + left sidebar) and the existing up/down `.reorder-btn` fallback --
// they mutate/derive the SAME `configuredFolders`/`folders` array the
// up/down buttons already swap entries in, so a DnD reorder and an
// equivalent up/down sequence converge on the identical resulting array
// (proven end-to-end, against the real POST/GET /api/config persistence
// path, in test/integration/folder-dnd-order.test.js).
const { test } = require('node:test');
const assert = require('node:assert');
const { moveArrayItem, computeDropIndex, rebuildFullFolderOrder } = require('../../public/js/common.js');

// ---- moveArrayItem ----------------------------------------------------------

test('moveArrayItem: moves an item forward, preserving the relative order of everything else', () => {
  assert.deepEqual(moveArrayItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
});

test('moveArrayItem: moves an item backward, preserving the relative order of everything else', () => {
  assert.deepEqual(moveArrayItem(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
});

test('moveArrayItem: moving an item to its own index is a no-op', () => {
  assert.deepEqual(moveArrayItem(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']);
});

test('moveArrayItem: never mutates the input array', () => {
  const input = ['a', 'b', 'c'];
  moveArrayItem(input, 0, 2);
  assert.deepEqual(input, ['a', 'b', 'c'], 'the original array must be untouched');
});

test('moveArrayItem: an out-of-range fromIndex returns an unchanged copy rather than throwing', () => {
  assert.deepEqual(moveArrayItem(['a', 'b'], 5, 0), ['a', 'b']);
  assert.deepEqual(moveArrayItem(['a', 'b'], -1, 0), ['a', 'b']);
});

test('moveArrayItem: an out-of-range toIndex clamps to the nearest valid position rather than throwing', () => {
  assert.deepEqual(moveArrayItem(['a', 'b', 'c'], 0, 99), ['b', 'c', 'a']);
  assert.deepEqual(moveArrayItem(['a', 'b', 'c'], 2, -5), ['c', 'a', 'b']);
});

test('moveArrayItem: a non-array input is treated as empty', () => {
  assert.deepEqual(moveArrayItem(undefined, 0, 1), []);
});

// ---- computeDropIndex -------------------------------------------------------

test('computeDropIndex: dropping an item onto itself is a no-op', () => {
  assert.equal(computeDropIndex(2, 2, true), 2);
  assert.equal(computeDropIndex(2, 2, false), 2);
});

test('computeDropIndex: dragging forward (from < target) and dropping BEFORE the target row', () => {
  // Moving index 0 to land immediately before index 2's current item -- after
  // removing index 0, that item shifts to index 1, so the drop lands at 1.
  assert.equal(computeDropIndex(0, 2, true), 1);
});

test('computeDropIndex: dragging forward (from < target) and dropping AFTER the target row', () => {
  assert.equal(computeDropIndex(0, 2, false), 2);
});

test('computeDropIndex: dragging backward (from > target) and dropping BEFORE the target row', () => {
  assert.equal(computeDropIndex(3, 1, true), 1);
});

test('computeDropIndex: dragging backward (from > target) and dropping AFTER the target row', () => {
  assert.equal(computeDropIndex(3, 1, false), 2);
});

test('computeDropIndex composed with moveArrayItem: matches the expected final order for a forward drag dropped before the target', () => {
  const arr = ['a', 'b', 'c', 'd'];
  const to = computeDropIndex(0, 2, true); // move 'a' to just before 'c'
  assert.deepEqual(moveArrayItem(arr, 0, to), ['b', 'a', 'c', 'd']);
});

test('computeDropIndex composed with moveArrayItem: matches the expected final order for a backward drag dropped after the target', () => {
  const arr = ['a', 'b', 'c', 'd'];
  const to = computeDropIndex(3, 1, false); // move 'd' to just after 'b'
  assert.deepEqual(moveArrayItem(arr, 3, to), ['a', 'b', 'd', 'c']);
});

// ---- rebuildFullFolderOrder --------------------------------------------------

test('rebuildFullFolderOrder: a hidden-from-sidebar folder keeps its absolute position while the visible subset reorders around it', () => {
  const full = ['/media/a', '/media/hidden', '/media/b', '/media/c'];
  const settings = { '/media/hidden': { hiddenFromSidebar: true } };
  // Visible subset was [a, b, c]; the sidebar drag reordered it to [c, a, b].
  const newVisibleOrder = ['/media/c', '/media/a', '/media/b'];
  assert.deepEqual(
    rebuildFullFolderOrder(full, settings, newVisibleOrder),
    ['/media/c', '/media/hidden', '/media/a', '/media/b'],
    'the hidden folder must stay at index 1; the visible slots (0,2,3) fill from the reordered visible list in order'
  );
});

test('rebuildFullFolderOrder: with nothing hidden, the full order is simply the new visible order', () => {
  const full = ['/media/a', '/media/b', '/media/c'];
  const newVisibleOrder = ['/media/c', '/media/a', '/media/b'];
  assert.deepEqual(rebuildFullFolderOrder(full, {}, newVisibleOrder), ['/media/c', '/media/a', '/media/b']);
});

test('rebuildFullFolderOrder: a synthetic-folder-like entry (present in fullFolders, not in db.folders) reorders like any other visible entry', () => {
  // Mirrors what the sidebar actually receives from GET /api/config: the
  // synthetic Downloads folder is just another entry in the merged `folders`
  // array by the time it reaches the client -- the client never distinguishes
  // it from a real folder; only server.js knows it must never be written to
  // db.folders (see test/integration/folder-dnd-order.test.js).
  const full = ['/media/a', '/downloads', '/media/b'];
  const newVisibleOrder = ['/downloads', '/media/a', '/media/b'];
  assert.deepEqual(rebuildFullFolderOrder(full, {}, newVisibleOrder), ['/downloads', '/media/a', '/media/b']);
});

test('rebuildFullFolderOrder: empty fullFolders returns an empty array', () => {
  assert.deepEqual(rebuildFullFolderOrder([], {}, []), []);
});
