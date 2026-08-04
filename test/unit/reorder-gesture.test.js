'use strict';

// [UNIT] v1.76 T1 -- the ONE drag-to-reorder gesture layer (common.js's
// `wireReorderable` + its two pure decisions).
//
// The five HTML5-DnD wirings this replaces all carried the same standing
// comment: "DOM drag events are untestable-by-necessity". That was true of
// `dragstart`/`drop`, whose DataTransfer jsdom does not implement -- it is NOT
// true of pointer events. jsdom 29 has a working PointerEvent constructor
// (measured), and the one thing it genuinely cannot supply is LAYOUT:
// `getBoundingClientRect()` returns all-zero rects and `elementFromPoint` does
// not exist at all. So the helper takes an injectable `measure` hook and
// resolves its drop target from measured rects rather than elementFromPoint --
// which lets these tests drive the REAL listeners, through the REAL arming
// rules, and assert the REAL (from, to) pair the caller would persist.
//
// That is the difference between a presence lock and a binding lock: every
// assertion below fails if the handler chain stops working, not merely if a
// function stops existing.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const {
  resolveReorderTarget, computeAutoScrollDelta, wireReorderable,
  REORDER_LONG_PRESS_MS, REORDER_MOUSE_THRESHOLD_PX, REORDER_TOUCH_SLOP_PX,
  REORDER_AUTOSCROLL_EDGE_PX, REORDER_AUTOSCROLL_STEP_PX,
} = require('../../public/js/common.js');

// ---- resolveReorderTarget (pure) -------------------------------------------

// Four rows, 20px tall, stacked with a 10px gap: [0,20] [30,50] [60,80] [90,110]
const RECTS = [
  { top: 0, bottom: 20 },
  { top: 30, bottom: 50 },
  { top: 60, bottom: 80 },
  { top: 90, bottom: 110 },
];

test('resolveReorderTarget: the top half of a row is a before-drop, the bottom half an after-drop', () => {
  assert.deepEqual(resolveReorderTarget(RECTS, 34), { index: 1, before: true });
  assert.deepEqual(resolveReorderTarget(RECTS, 46), { index: 1, before: false });
});

test('resolveReorderTarget: the exact midpoint belongs to the after-half (no ambiguous pixel)', () => {
  assert.deepEqual(resolveReorderTarget(RECTS, 40), { index: 1, before: false });
});

test('resolveReorderTarget: above the first row clamps to the first row before-half', () => {
  assert.deepEqual(resolveReorderTarget(RECTS, -500), { index: 0, before: true });
});

test('resolveReorderTarget: below the last row clamps to the last row after-half', () => {
  assert.deepEqual(resolveReorderTarget(RECTS, 9999), { index: 3, before: false });
});

test('resolveReorderTarget: a pointer in the GAP between rows resolves to the nearer edge', () => {
  // Gap between row 0 [0,20] and row 1 [30,50].
  assert.deepEqual(resolveReorderTarget(RECTS, 22), { index: 0, before: false }, 'nearer the row above');
  assert.deepEqual(resolveReorderTarget(RECTS, 28), { index: 1, before: true }, 'nearer the row below');
  assert.deepEqual(resolveReorderTarget(RECTS, 25), { index: 0, before: false }, 'a tie goes to the row above');
});

test('resolveReorderTarget: an empty list resolves to null rather than throwing', () => {
  assert.equal(resolveReorderTarget([], 10), null);
  assert.equal(resolveReorderTarget(null, 10), null);
});

// ---- computeAutoScrollDelta (pure) -----------------------------------------

// The SHIPPED band/step, not test-local numbers -- these tests bind the values
// the wiring actually passes.
const EDGE = REORDER_AUTOSCROLL_EDGE_PX;
const STEP = REORDER_AUTOSCROLL_STEP_PX;
const BOX = { top: 0, bottom: 400 };

test('computeAutoScrollDelta: zero in the middle of the container', () => {
  assert.equal(computeAutoScrollDelta(BOX, 200, EDGE, STEP), 0);
});

test('computeAutoScrollDelta: negative near the top edge, positive near the bottom edge', () => {
  assert.ok(computeAutoScrollDelta(BOX, 5, EDGE, STEP) < 0, 'scrolls up near the top');
  assert.ok(computeAutoScrollDelta(BOX, 395, EDGE, STEP) > 0, 'scrolls down near the bottom');
});

test('computeAutoScrollDelta: ramps with proximity and never exceeds the step', () => {
  const near = Math.abs(computeAutoScrollDelta(BOX, 2, EDGE, STEP));
  const far = Math.abs(computeAutoScrollDelta(BOX, EDGE - 6, EDGE, STEP));
  assert.ok(near > far, `closer to the edge must scroll faster (${near} vs ${far})`);
  assert.ok(near <= STEP, 'never faster than the configured step');
});

test('computeAutoScrollDelta: a pointer dragged clean OUTSIDE the box keeps scrolling at full step', () => {
  // The stall this prevents: a finger past the edge is exactly when the user
  // most wants the list to keep coming.
  assert.equal(computeAutoScrollDelta(BOX, -50, EDGE, STEP), -STEP);
  assert.equal(computeAutoScrollDelta(BOX, 450, EDGE, STEP), STEP);
});

test('computeAutoScrollDelta: a missing rect or a zero band/step is inert', () => {
  assert.equal(computeAutoScrollDelta(null, 10, EDGE, STEP), 0);
  assert.equal(computeAutoScrollDelta(BOX, 5, 0, STEP), 0);
  assert.equal(computeAutoScrollDelta(BOX, 5, EDGE, 0), 0);
});

// ---- the wiring, driven end-to-end in jsdom --------------------------------

// Builds a 4-row list whose rows measure as RECTS above. `rowHtml` lets a test
// put real interactive children inside a row.
function buildList(rowHtml) {
  const dom = new JSDOM('<!doctype html><html><body><div id="list"></div></body></html>', { pretendToBeVisual: true });
  const { window } = dom;
  const doc = window.document;
  const container = doc.getElementById('list');
  container.innerHTML = RECTS.map((_, i) =>
    `<div class="row" data-i="${i}">${typeof rowHtml === 'function' ? rowHtml(i) : (rowHtml || '')}</div>`
  ).join('');
  const rows = Array.prototype.slice.call(container.querySelectorAll('.row'));
  const measure = (el) => RECTS[rows.indexOf(el)];
  return { dom, window, doc, container, rows, measure };
}

// A recording `onReorder`, plus the option bag every test starts from.
function wire(fixture, extra) {
  const moves = [];
  wireReorderable(fixture.container, Object.assign({
    rowSelector: '.row',
    measure: fixture.measure,
    onReorder: (from, to, info) => moves.push({ from, to, source: info && info.source }),
  }, extra || {}));
  return moves;
}

function pointer(window, el, type, props) {
  el.dispatchEvent(new window.PointerEvent(type, Object.assign({
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0,
  }, props || {})));
}

// One complete mouse drag: press on `fromRow`, travel past the threshold, land
// at `clientY`, release. Every event goes through the REAL listeners.
function mouseDrag(fixture, fromIndex, clientY) {
  const { window, doc, rows } = fixture;
  pointer(window, rows[fromIndex], 'pointerdown', { clientX: 0, clientY: RECTS[fromIndex].top + 5 });
  pointer(window, doc, 'pointermove', { clientX: 0, clientY: RECTS[fromIndex].top + 5 + REORDER_MOUSE_THRESHOLD_PX + 1 });
  pointer(window, doc, 'pointermove', { clientX: 0, clientY });
  pointer(window, doc, 'pointerup', { clientX: 0, clientY });
}

test('wireReorderable: a mouse drag from the first row onto the last row reorders to the end', () => {
  const f = buildList();
  const moves = wire(f);
  mouseDrag(f, 0, 105); // bottom half of row 3
  assert.deepEqual(moves, [{ from: 0, to: 3, source: 'pointer' }]);
});

test('wireReorderable: a mouse drag upward onto a row\'s top half inserts BEFORE it', () => {
  const f = buildList();
  const moves = wire(f);
  mouseDrag(f, 3, 34); // top half of row 1
  assert.deepEqual(moves, [{ from: 3, to: 1, source: 'pointer' }]);
});

test('wireReorderable: a press with no travel is a CLICK, not a reorder', () => {
  // The regression this pins: sidebar rows are <a> links, so arming a drag on
  // a bare mousedown would break every navigation click in the sidebar.
  const f = buildList();
  const moves = wire(f);
  pointer(f.window, f.rows[0], 'pointerdown', { clientY: 5 });
  pointer(f.window, f.doc, 'pointerup', { clientY: 5 });
  assert.deepEqual(moves, [], 'no reorder was requested');
});

test('wireReorderable: travel BELOW the mouse threshold still does not arm a drag', () => {
  const f = buildList();
  const moves = wire(f);
  pointer(f.window, f.rows[0], 'pointerdown', { clientY: 5 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 5 + REORDER_MOUSE_THRESHOLD_PX - 1 });
  pointer(f.window, f.doc, 'pointerup', { clientY: 5 + REORDER_MOUSE_THRESHOLD_PX - 1 });
  assert.deepEqual(moves, []);
});

test('wireReorderable: dropping a row back onto itself reorders nothing', () => {
  const f = buildList();
  const moves = wire(f);
  mouseDrag(f, 1, 34); // row 1's own top half
  assert.deepEqual(moves, [], 'a no-op drag must not persist a "new" order');
});

test('wireReorderable: a completed drag SUPPRESSES the row click that follows it', () => {
  // Without this, dropping a sidebar folder navigates to it.
  const f = buildList();
  wire(f);
  mouseDrag(f, 0, 105);
  const click = new f.window.MouseEvent('click', { bubbles: true, cancelable: true });
  f.rows[0].dispatchEvent(click);
  assert.equal(click.defaultPrevented, true, 'the post-drag click is swallowed');

  // ...and only THAT click: the next one must work normally.
  const next = new f.window.MouseEvent('click', { bubbles: true, cancelable: true });
  f.rows[0].dispatchEvent(next);
  assert.equal(next.defaultPrevented, false, 'suppression is one-shot, never sticky');
});

test('wireReorderable: a click with no drag before it is never suppressed', () => {
  const f = buildList();
  wire(f);
  pointer(f.window, f.rows[0], 'pointerdown', { clientY: 5 });
  pointer(f.window, f.doc, 'pointerup', { clientY: 5 });
  const click = new f.window.MouseEvent('click', { bubbles: true, cancelable: true });
  f.rows[0].dispatchEvent(click);
  assert.equal(click.defaultPrevented, false);
});

test('wireReorderable: pointercancel mid-drag abandons the reorder', () => {
  const f = buildList();
  const moves = wire(f);
  pointer(f.window, f.rows[0], 'pointerdown', { clientY: 5 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 105 });
  pointer(f.window, f.doc, 'pointercancel', { clientY: 105 });
  pointer(f.window, f.doc, 'pointerup', { clientY: 105 });
  assert.deepEqual(moves, [], 'a cancelled gesture persists nothing');
});

test('wireReorderable: Escape mid-drag abandons the reorder', () => {
  const f = buildList();
  const moves = wire(f);
  pointer(f.window, f.rows[0], 'pointerdown', { clientY: 5 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 105 });
  f.doc.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  pointer(f.window, f.doc, 'pointerup', { clientY: 105 });
  assert.deepEqual(moves, []);
});

test('wireReorderable: the drop indicator tracks the pointer and is cleared when the gesture ends', () => {
  const f = buildList();
  wire(f);
  pointer(f.window, f.rows[0], 'pointerdown', { clientY: 5 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 105 });
  assert.equal(f.rows[3].classList.contains('drag-over-after'), true, 'the landing row shows an after-line');
  assert.equal(f.rows[0].classList.contains('dragging'), true, 'the dragged row is marked');
  pointer(f.window, f.doc, 'pointermove', { clientY: 34 });
  assert.equal(f.rows[3].classList.contains('drag-over-after'), false, 'the stale indicator is dropped');
  assert.equal(f.rows[1].classList.contains('drag-over-before'), true);
  pointer(f.window, f.doc, 'pointerup', { clientY: 34 });
  const leftover = f.rows.filter((r) => r.className.includes('drag-over') || r.classList.contains('dragging'));
  assert.deepEqual(leftover, [], 'no indicator class survives the gesture');
});

test('wireReorderable: each surface keeps its OWN class family', () => {
  const f = buildList();
  wire(f, { classes: { dragging: 'sub-row-dragging', before: 'sub-row-drag-over-before', after: 'sub-row-drag-over-after' } });
  pointer(f.window, f.rows[0], 'pointerdown', { clientY: 5 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 105 });
  assert.equal(f.rows[0].classList.contains('sub-row-dragging'), true);
  assert.equal(f.rows[3].classList.contains('sub-row-drag-over-after'), true);
  assert.equal(f.rows[0].classList.contains('dragging'), false, 'the default family is not also applied');
});

// ---- auto-scroll: the USE, not just the decision ---------------------------

test('wireReorderable: dragging to the edge of a scrolling box actually scrolls it, and stops on drop', async () => {
  // Binding the USE, not the pure helper: a correct computeAutoScrollDelta
  // wired to nothing would still pass every test above it.
  const f = buildList();
  const box = { top: 0, bottom: 400, scrollTop: 200, getBoundingClientRect() { return { top: this.top, bottom: this.bottom }; } };
  wire(f, { scrollContainer: box });
  pointer(f.window, f.rows[0], 'pointerdown', { clientY: 200 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 200 + REORDER_MOUSE_THRESHOLD_PX + 1 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 2 }); // hard against the top edge
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(box.scrollTop < 200, `the box scrolled up while the drag sat at its edge (scrollTop ${box.scrollTop})`);

  const atDrop = box.scrollTop;
  pointer(f.window, f.doc, 'pointerup', { clientY: 2 });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(box.scrollTop, atDrop, 'the auto-scroll timer does not outlive the gesture');
});

test('wireReorderable: a drag in the MIDDLE of a scrolling box never scrolls it', async () => {
  const f = buildList();
  const box = { top: 0, bottom: 400, scrollTop: 200, getBoundingClientRect() { return { top: this.top, bottom: this.bottom }; } };
  wire(f, { scrollContainer: box });
  mouseDrag(f, 0, 200);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(box.scrollTop, 200);
});

// ---- touch: the long press, and the scroll it must not steal ---------------

function touchDown(f, index, clientY) {
  pointer(f.window, f.rows[index], 'pointerdown', { pointerType: 'touch', clientX: 0, clientY });
}

test('wireReorderable: a touch long-press arms the drag and the drop reorders', async () => {
  const f = buildList();
  const moves = wire(f);
  touchDown(f, 0, 5);
  // A finger is never perfectly still: travel WITHIN the slop must not cancel
  // the press.
  pointer(f.window, f.doc, 'pointermove', { pointerType: 'touch', clientY: 5 + REORDER_TOUCH_SLOP_PX - 1 });
  assert.deepEqual(moves, [], 'nothing happens before the press matures');
  await new Promise((r) => setTimeout(r, REORDER_LONG_PRESS_MS + 40));
  pointer(f.window, f.doc, 'pointermove', { pointerType: 'touch', clientY: 105 });
  pointer(f.window, f.doc, 'pointerup', { pointerType: 'touch', clientY: 105 });
  assert.deepEqual(moves, [{ from: 0, to: 3, source: 'pointer' }]);
});

test('wireReorderable: a touch that MOVES before the long press matures is a scroll, not a drag', async () => {
  // The whole reason the long press exists: the row is the drag surface, so
  // without this rule the list could never be scrolled with a finger.
  const f = buildList();
  const moves = wire(f);
  touchDown(f, 0, 5);
  pointer(f.window, f.doc, 'pointermove', { pointerType: 'touch', clientY: 5 + REORDER_TOUCH_SLOP_PX + 5 });
  await new Promise((r) => setTimeout(r, REORDER_LONG_PRESS_MS + 40));
  pointer(f.window, f.doc, 'pointermove', { pointerType: 'touch', clientY: 105 });
  pointer(f.window, f.doc, 'pointerup', { pointerType: 'touch', clientY: 105 });
  assert.deepEqual(moves, [], 'the gesture was handed back to the browser as a scroll');
});

test('wireReorderable: a touch on the HANDLE arms immediately, with no long press', () => {
  const f = buildList((i) => `<span class="h" data-h="${i}"></span>`);
  const moves = wire(f, { handleSelector: '.h' });
  const handle = f.rows[0].querySelector('.h');
  handle.dispatchEvent(new f.window.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', button: 0, clientX: 0, clientY: 5,
  }));
  pointer(f.window, f.doc, 'pointermove', { pointerType: 'touch', clientY: 105 });
  pointer(f.window, f.doc, 'pointerup', { pointerType: 'touch', clientY: 105 });
  assert.deepEqual(moves, [{ from: 0, to: 3, source: 'pointer' }]);
});

test('wireReorderable: once armed, touchmove is preventDefaulted so the page cannot scroll under the drag', async () => {
  const f = buildList();
  wire(f);
  touchDown(f, 0, 5);
  const before = new f.window.Event('touchmove', { bubbles: true, cancelable: true });
  f.doc.dispatchEvent(before);
  assert.equal(before.defaultPrevented, false, 'scrolling is untouched before the drag arms');
  await new Promise((r) => setTimeout(r, REORDER_LONG_PRESS_MS + 40));
  const after = new f.window.Event('touchmove', { bubbles: true, cancelable: true });
  f.doc.dispatchEvent(after);
  assert.equal(after.defaultPrevented, true, 'the armed drag pins the page');
});

// ---- guards ----------------------------------------------------------------

test('wireReorderable: a drag never starts from an interactive child of the row', () => {
  const f = buildList('<input type="text" class="name" /><button class="btn">x</button>');
  const moves = wire(f);
  const input = f.rows[0].querySelector('.name');
  input.dispatchEvent(new f.window.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 5,
  }));
  pointer(f.window, f.doc, 'pointermove', { clientY: 105 });
  pointer(f.window, f.doc, 'pointerup', { clientY: 105 });
  assert.deepEqual(moves, [], 'text selection in a field is not a reorder gesture');
});

test('wireReorderable: a row that IS an interactive element still drags (the sidebar rows are anchors)', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="list"></div></body></html>');
  const doc = dom.window.document;
  const container = doc.getElementById('list');
  container.innerHTML = RECTS.map((_, i) => `<a href="/?root=${i}" class="row"></a>`).join('');
  const rows = Array.prototype.slice.call(container.querySelectorAll('.row'));
  const moves = [];
  wireReorderable(container, {
    rowSelector: '.row',
    measure: (el) => RECTS[rows.indexOf(el)],
    onReorder: (from, to) => moves.push({ from, to }),
  });
  const f = { window: dom.window, doc, rows };
  mouseDrag(f, 0, 105);
  assert.deepEqual(moves, [{ from: 0, to: 3 }], 'the ignore rule must not veto the row itself');
});

test('wireReorderable: a cross-GROUP drop is refused (the pinned sidebar partition)', () => {
  const f = buildList();
  // Rows 0,1 are channels; rows 2,3 are book shelves.
  const moves = wire(f, { groupOf: (i) => (i < 2 ? 'channel' : 'books') });
  mouseDrag(f, 0, 105); // channel dropped among the shelves
  assert.deepEqual(moves, [], 'no cross-source order is ever persisted');
  // ...and the indicator never lit up on the foreign row either.
  assert.equal(f.rows[3].className.includes('drag-over'), false);
});

test('wireReorderable: a WITHIN-group drop still works with a group guard installed', () => {
  const f = buildList();
  const moves = wire(f, { groupOf: (i) => (i < 2 ? 'channel' : 'books') });
  mouseDrag(f, 2, 105);
  assert.deepEqual(moves, [{ from: 2, to: 3, source: 'pointer' }]);
});

test('wireReorderable: native HTML5 draggable is stripped from every row it wires', () => {
  // Leaving it on lets the browser start a native drag out from under the
  // pointer gesture and cancel it -- the two mechanisms cannot coexist.
  const f = buildList();
  f.rows.forEach((r) => r.setAttribute('draggable', 'true'));
  wire(f);
  assert.deepEqual(f.rows.map((r) => r.getAttribute('draggable')), [null, null, null, null]);
});

test('wireReorderable: an aborted caller signal tears the listeners down', () => {
  const f = buildList();
  const ac = new f.window.AbortController();
  const moves = wire(f, { signal: ac.signal });
  ac.abort();
  mouseDrag(f, 0, 105);
  assert.deepEqual(moves, [], 'a torn-down list wires nothing');
});

test('wireReorderable: aborting the caller signal DURING a drag ends it without reordering', () => {
  const f = buildList();
  const ac = new f.window.AbortController();
  const moves = wire(f, { signal: ac.signal });
  pointer(f.window, f.rows[0], 'pointerdown', { clientY: 5 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 105 });
  ac.abort();
  pointer(f.window, f.doc, 'pointerup', { clientY: 105 });
  assert.deepEqual(moves, []);
  assert.equal(f.rows[0].classList.contains('dragging'), false, 'the drag visuals are cleaned up too');
});

test('wireReorderable: a second pointer never joins a gesture already in progress', () => {
  const f = buildList();
  const moves = wire(f);
  pointer(f.window, f.rows[0], 'pointerdown', { pointerId: 1, clientY: 5 });
  pointer(f.window, f.rows[2], 'pointerdown', { pointerId: 2, clientY: 65 });
  pointer(f.window, f.doc, 'pointermove', { pointerId: 1, clientY: 105 });
  pointer(f.window, f.doc, 'pointerup', { pointerId: 2, clientY: 65 });
  assert.deepEqual(moves, [], 'the second pointer\'s release does not commit the first pointer\'s drag');
  pointer(f.window, f.doc, 'pointerup', { pointerId: 1, clientY: 105 });
  assert.deepEqual(moves, [{ from: 0, to: 3, source: 'pointer' }]);
});

test('wireReorderable: a right-click never starts a drag', () => {
  const f = buildList();
  const moves = wire(f);
  pointer(f.window, f.rows[0], 'pointerdown', { button: 2, clientY: 5 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 105 });
  pointer(f.window, f.doc, 'pointerup', { clientY: 105 });
  assert.deepEqual(moves, []);
});

test('wireReorderable: an empty container, a missing onReorder and a missing rowSelector are all inert', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="list"></div></body></html>');
  const container = dom.window.document.getElementById('list');
  assert.doesNotThrow(() => wireReorderable(container, { rowSelector: '.row', onReorder: () => {} }));
  assert.doesNotThrow(() => wireReorderable(container, { rowSelector: '.row' }));
  assert.doesNotThrow(() => wireReorderable(null, { rowSelector: '.row', onReorder: () => {} }));
});

// ---- keyboard parity (the up/down buttons this wave deletes) ---------------

test('wireReorderable: the handle carries a real accessible name and arrow keys reorder', () => {
  const f = buildList((i) => `<span class="h" data-h="${i}"></span>`);
  const moves = wire(f, { handleSelector: '.h', labelOf: (i) => `Row ${i}` });
  const handle = f.rows[1].querySelector('.h');
  assert.equal(handle.getAttribute('tabindex'), '0', 'reachable by keyboard');
  assert.equal(handle.getAttribute('role'), 'button');
  assert.equal(handle.getAttribute('aria-label'), 'Reorder Row 1');
  handle.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  handle.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  handle.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  handle.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  assert.deepEqual(moves, [
    { from: 1, to: 0, source: 'keyboard' },
    { from: 1, to: 2, source: 'keyboard' },
    { from: 1, to: 0, source: 'keyboard' },
    { from: 1, to: 3, source: 'keyboard' },
  ]);
});

test('wireReorderable: arrow keys at the ends of the list are refused, not clamped into no-ops', () => {
  const f = buildList((i) => `<span class="h"></span>`);
  const moves = wire(f, { handleSelector: '.h' });
  f.rows[0].querySelector('.h').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  f.rows[3].querySelector('.h').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.deepEqual(moves, []);
});

test('wireReorderable: keyboard reorder is NOT wired without a handle (the sidebar links keep their arrow keys)', () => {
  const f = buildList();
  const moves = wire(f); // no handleSelector
  f.rows[1].dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.deepEqual(moves, [], 'arrow keys still scroll a focused link, as they always did');
});

test('wireReorderable: focus follows the item across the re-render a keyboard move causes', () => {
  // Without this the first arrow press strands focus on <body> and the second
  // press does nothing -- a keyboard user could move an item exactly once.
  const f = buildList((i) => `<span class="h" data-h="${i}"></span>`);
  const order = [0, 1, 2, 3];
  const rewire = () => wireReorderable(f.container, {
    rowSelector: '.row',
    handleSelector: '.h',
    focusKey: 'test-list',
    measure: f.measure,
    onReorder: (from, to) => {
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      // Re-render exactly like a real caller: fresh rows, fresh handles.
      f.container.innerHTML = order.map((id) => `<div class="row" data-i="${id}"><span class="h" data-h="${id}"></span></div>`).join('');
      f.rows = Array.prototype.slice.call(f.container.querySelectorAll('.row'));
      rewire();
    },
  });
  rewire();
  f.rows[3].querySelector('.h').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  assert.deepEqual(order, [0, 1, 3, 2], 'the item moved');
  const focused = f.doc.activeElement;
  assert.equal(focused && focused.getAttribute('data-h'), '3', 'focus landed on the SAME item at its new index');
  assert.equal(focused.closest('.row').getAttribute('data-i'), '3');
});

test('wireReorderable: a POINTER reorder does not steal focus on the next render', () => {
  const f = buildList((i) => `<span class="h" data-h="${i}"></span>`);
  wire(f, { handleSelector: '.h', focusKey: 'ptr-list' });
  mouseDrag(f, 0, 105);
  // Re-wiring after the caller's re-render must not focus anything: only a
  // KEYBOARD move records a pending focus.
  wire(f, { handleSelector: '.h', focusKey: 'ptr-list' });
  assert.equal(f.doc.activeElement, f.doc.body, 'a mouse user is never yanked into a handle');
});
