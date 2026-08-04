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
  // `detail: 1` is load-bearing: a MouseEvent defaults to 0, which the S1 rule
  // reads as a keyboard activation and deliberately never suppresses. A
  // pointer click always carries >= 1.
  const click = new f.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  f.rows[0].dispatchEvent(click);
  assert.equal(click.defaultPrevented, true, 'the post-drag click is swallowed');

  // ...and only THAT click: the next one must work normally.
  const next = new f.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  f.rows[0].dispatchEvent(next);
  assert.equal(next.defaultPrevented, false, 'suppression is one-shot, never sticky');
});

test('wireReorderable (QA gate W1): a drag released OFF its own row never eats a later click', () => {
  // A `click` is dispatched on the common ancestor of press and release, so a
  // drag that ends elsewhere sends no click to the source row - and the
  // suppression flag, only ever cleared BY such a click, used to sit there
  // armed on a live node. The nastiest shape needs no re-render at all: drag a
  // row a few pixels onto its own edge (a no-op drop, so the list is not
  // rebuilt), then click that row's checkbox - and watch it not toggle.
  const f = buildList('<input type="checkbox" class="cb" />');
  const moves = wire(f);
  pointer(f.window, f.rows[1], 'pointerdown', { clientY: 34 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 40 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 28 }); // the gap above: resolves back to itself
  pointer(f.window, f.doc, 'pointerup', { clientY: 28 });
  assert.deepEqual(moves, [], 'the drop was a no-op, so nothing re-rendered');

  // The user's NEXT interaction with that row must work. Three shapes, because
  // they clear (or bypass) the stale flag by different routes. NOTE the
  // explicit `detail` on every one: a MouseEvent defaults to `detail: 0`,
  // which the S1 rule treats as keyboard - so a negative control without it
  // would pass no matter what the code did (QA delta S1 caught exactly that).
  const cb = f.rows[1].querySelector('.cb');
  // (a) a real tap/click, always preceded by its own pointerdown;
  pointer(f.window, cb, 'pointerdown', { clientY: 34 });
  pointer(f.window, f.doc, 'pointerup', { clientY: 34 });
  const click = new f.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  cb.dispatchEvent(click);
  assert.equal(click.defaultPrevented, false, 'the checkbox click is not swallowed');

  // (b) a real MOUSE click on an interactive child while the flag is stranded -
  // detail 1, so only the child-exemption can save it.
  f.rows[2].__reorderSuppressClick = true; // as a stranded gesture would leave it
  const childClick = new f.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  f.rows[2].querySelector('.cb').dispatchEvent(childClick);
  assert.equal(childClick.defaultPrevented, false, 'a click on a child is never the drag\'s echo');

  // (c) a KEYBOARD activation of the ROW ITSELF - Enter on a focused link
  // fires `click` with detail 0 and no pointer event, so nothing cleared the
  // flag and the child-exemption structurally cannot help (the row IS the
  // interactive element on the three sidebar surfaces).
  f.rows[3].__reorderSuppressClick = true;
  const keyClick = new f.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 });
  f.rows[3].dispatchEvent(keyClick);
  assert.equal(keyClick.defaultPrevented, false, 'a keyboard activation is never swallowed');
});

test('wireReorderable: a real post-drag mouse click IS still suppressed (the rule must not swallow itself)', () => {
  // The S1 detail-based exemption must not disarm the suppression it guards:
  // a genuine pointer click after a drag carries detail >= 1.
  const f = buildList();
  wire(f);
  mouseDrag(f, 0, 105);
  const click = new f.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  f.rows[0].dispatchEvent(click);
  assert.equal(click.defaultPrevented, true, 'the drag\'s own echo is still eaten');
});

test('wireReorderable (adversarial W5): a NEW press clears a stranded flag on an <a> row', () => {
  // The primary half of the W1 fix - `rows.forEach(clear)` at the top of
  // pointerdown - was unbound: deleting it survived 125 tests across 7 files.
  // The existing W1 test only ever reached its case through the CHILD
  // exemption, which structurally cannot help the three sidebar surfaces
  // whose rows ARE the interactive element. This drives that shape directly.
  const dom = new JSDOM('<!doctype html><html><body><div id="list"></div></body></html>');
  const doc = dom.window.document;
  const container = doc.getElementById('list');
  container.innerHTML = RECTS.map((_, i) => `<a href="/?root=${i}" class="row"></a>`).join('');
  const rows = Array.prototype.slice.call(container.querySelectorAll('.row'));
  wireReorderable(container, {
    rowSelector: '.row',
    measure: (el) => RECTS[rows.indexOf(el)],
    onReorder: () => {},
  });

  // A gesture ended without delivering a click to this row (a drop released
  // elsewhere), leaving the flag armed on a live node.
  rows[0].__reorderSuppressClick = true;

  // The user now presses that row again and clicks it normally.
  const at = (el, type, y, extra) => el.dispatchEvent(new dom.window.PointerEvent(type, Object.assign({
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: y,
  }, extra || {})));
  at(rows[0], 'pointerdown', 5);
  at(doc, 'pointerup', 5);
  const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  rows[0].dispatchEvent(click);
  assert.equal(click.defaultPrevented, false, 'the stranded flag was cleared by the new press - the link navigates');
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

test('wireReorderable (adversarial round 2, P3): a list REBUILT mid-drag refuses the drop', () => {
  // Native HTML5 drag ended when the source element was removed; the pointer
  // layer has no such thing, so a gesture can outlive the rows it started in
  // and commit against a detached DOM. The seat measured the consequence on
  // the subscriptions list: the user grabs row "a", a prior action's response
  // re-renders mid-drag, and the drop moves "c" instead.
  const f = buildList();
  const moves = wire(f);
  pointer(f.window, f.rows[0], 'pointerdown', { clientY: 5 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 20 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 105 });
  // A render lands: fresh rows replace the ones this gesture is holding.
  f.container.innerHTML = RECTS.map((_, i) => `<div class="row" data-i="${i}"></div>`).join('');
  assert.equal(f.rows[0].isConnected, false, 'the dragged row really is detached now');
  pointer(f.window, f.doc, 'pointerup', { clientY: 105 });
  assert.deepEqual(moves, [], 'the stale gesture commits nothing');
});

test('wireReorderable: a drop still commits when the rows are NOT rebuilt (P3 must not refuse everything)', () => {
  // The guard has to discriminate, not just refuse - a P3 that always returned
  // would pass the test above and break every reorder in the app.
  const f = buildList();
  const moves = wire(f);
  mouseDrag(f, 0, 105);
  assert.deepEqual(moves, [{ from: 0, to: 3, source: 'pointer' }]);
});

test('wireReorderable: a fake DOM with no isConnected is not treated as detached', () => {
  // `=== false` rather than falsy: several of this repo's test doubles have no
  // isConnected at all, and reading undefined as "detached" would silently
  // disable every reorder they exercise.
  const f = buildList();
  const moves = wire(f);
  f.rows.forEach((r) => { Object.defineProperty(r, 'isConnected', { get: () => undefined, configurable: true }); });
  mouseDrag(f, 0, 105);
  assert.deepEqual(moves, [{ from: 0, to: 3, source: 'pointer' }]);
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

test('wireReorderable (QA gate W2): a STATIONARY edge drag re-resolves the target as the list moves', async () => {
  // The whole point of auto-scroll is to hold the pointer at the edge and let
  // the list come to you - on touch the finger is parked there by definition.
  // The first implementation scrolled but never recomputed the drop target, so
  // the indicator froze and the drop committed against the row that had been
  // under the pointer ten rows ago.
  const dom = new JSDOM('<!doctype html><html><body><div id="list"></div></body></html>', { pretendToBeVisual: true });
  const doc = dom.window.document;
  const container = doc.getElementById('list');
  container.innerHTML = Array.from({ length: 10 }, (_, i) => `<div class="row" data-i="${i}"></div>`).join('');
  const rows = Array.prototype.slice.call(container.querySelectorAll('.row'));
  // A 100px-tall viewport onto 200px of rows; each row is 20px, offset by the
  // box's scroll position exactly as a real scrolling container behaves.
  const box = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0, bottom: 100 }) };
  const measure = (el) => {
    const i = rows.indexOf(el);
    return { top: i * 20 - box.scrollTop, bottom: i * 20 + 20 - box.scrollTop };
  };
  const moves = [];
  wireReorderable(container, {
    rowSelector: '.row', measure, scrollContainer: box,
    onReorder: (from, to) => moves.push({ from, to }),
  });

  const at = (el, type, y) => el.dispatchEvent(new dom.window.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: y,
  }));
  at(rows[0], 'pointerdown', 5);
  at(doc, 'pointermove', 15);
  at(doc, 'pointermove', 98); // parked hard against the bottom edge

  // What the target WOULD be with no scrolling: y=98 sits in row 4 [80,100].
  const targetBeforeScrolling = 4;
  await new Promise((r) => setTimeout(r, 120)); // ...and now hold still.
  assert.ok(box.scrollTop > 0, `the box scrolled (scrollTop ${box.scrollTop})`);
  at(doc, 'pointerup', 98);

  assert.equal(moves.length, 1);
  assert.ok(moves[0].to > targetBeforeScrolling,
    `the drop followed the scrolled list, not the frozen target (landed at ${moves[0].to}, stale answer was ${targetBeforeScrolling})`);
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
  //
  // Adversarial gate W4: this test used to dispatch its pointermove
  // SYNCHRONOUSLY after pointerdown, which no real device does - and that is
  // why it never reached the timer race it exists to exercise. The move now
  // lands partway through the press window, like a finger actually would.
  const f = buildList();
  const moves = wire(f);
  touchDown(f, 0, 5);
  await new Promise((r) => setTimeout(r, 50));
  pointer(f.window, f.doc, 'pointermove', { pointerType: 'touch', clientY: 5 + REORDER_TOUCH_SLOP_PX + 5 });
  await new Promise((r) => setTimeout(r, REORDER_LONG_PRESS_MS + 40));
  pointer(f.window, f.doc, 'pointermove', { pointerType: 'touch', clientY: 105 });
  pointer(f.window, f.doc, 'pointerup', { pointerType: 'touch', clientY: 105 });
  assert.deepEqual(moves, [], 'the gesture was handed back to the browser as a scroll');
});

// ---- the arming CONSTANTS, bound as values ---------------------------------
//
// Adversarial gate W4: every test above imports the same constants it
// exercises (`5 + REORDER_TOUCH_SLOP_PX + 5`), so no constant can fail its own
// test. The seat measured what that costs - three surviving mutants, each with
// a real user-visible consequence. These four tests use LITERAL numbers on
// purpose; if a constant is retuned, they are supposed to be re-derived by
// hand rather than to follow along silently.

test('W4: the mouse threshold is big enough that a 1px jitter click is not a drag', () => {
  // Mutant: REORDER_MOUSE_THRESHOLD_PX -> 0. Consequence measured by the seat:
  // a 1-pixel jitter while clicking a sidebar <a> row is swallowed as a drag,
  // and the sidebar stops navigating.
  assert.ok(REORDER_MOUSE_THRESHOLD_PX >= 3, `threshold ${REORDER_MOUSE_THRESHOLD_PX}px is too small to absorb jitter`);
  const f = buildList();
  const moves = wire(f);
  pointer(f.window, f.rows[0], 'pointerdown', { clientY: 5 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 6 }); // 1px of hand tremor
  pointer(f.window, f.doc, 'pointerup', { clientY: 6 });
  assert.deepEqual(moves, [], 'a 1px jitter is a click');
  const click = new f.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  f.rows[0].dispatchEvent(click);
  assert.equal(click.defaultPrevented, false, 'and the click is NOT swallowed - the row still navigates');
});

test('W4: the long press is long enough that a quick flick is a scroll, not a reorder', async () => {
  // Mutant: REORDER_LONG_PRESS_MS -> 0. Consequence: a flick 50ms after
  // touchdown becomes a reorder AND touchmove is preventDefaulted, so the list
  // can never be scrolled by finger again.
  assert.ok(REORDER_LONG_PRESS_MS >= 200, `${REORDER_LONG_PRESS_MS}ms is not a long press`);
  const f = buildList();
  const moves = wire(f);
  touchDown(f, 0, 5);
  await new Promise((r) => setTimeout(r, 50));
  pointer(f.window, f.doc, 'pointermove', { pointerType: 'touch', clientY: 105 });
  pointer(f.window, f.doc, 'pointerup', { pointerType: 'touch', clientY: 105 });
  assert.deepEqual(moves, [], 'a 50ms flick never reorders');
});

test('W4: the touch slop is small enough that real travel abandons the press', async () => {
  // Mutant: REORDER_TOUCH_SLOP_PX -> 1000, i.e. nothing ever abandons.
  assert.ok(REORDER_TOUCH_SLOP_PX <= 20, `slop ${REORDER_TOUCH_SLOP_PX}px would swallow a scroll`);
  const f = buildList();
  const moves = wire(f);
  touchDown(f, 0, 5);
  await new Promise((r) => setTimeout(r, 50));
  pointer(f.window, f.doc, 'pointermove', { pointerType: 'touch', clientY: 45 }); // 40px: a scroll
  await new Promise((r) => setTimeout(r, REORDER_LONG_PRESS_MS + 40));
  pointer(f.window, f.doc, 'pointerup', { pointerType: 'touch', clientY: 45 });
  assert.deepEqual(moves, [], '40px of travel is a scroll at any slop we would ship');
});

test('W4: the auto-scroll step is a nudge, not a jump', () => {
  // The comment above the auto-scroll tests used to claim they "bind the
  // values"; they bind the wiring's USE of them. A step of 1200 would pass
  // every one of those tests and make one tick scroll past the whole list.
  assert.ok(REORDER_AUTOSCROLL_STEP_PX > 0 && REORDER_AUTOSCROLL_STEP_PX <= 40,
    `${REORDER_AUTOSCROLL_STEP_PX}px per ~16ms tick is not a nudge`);
  assert.ok(REORDER_AUTOSCROLL_EDGE_PX >= 16 && REORDER_AUTOSCROLL_EDGE_PX <= 120,
    `${REORDER_AUTOSCROLL_EDGE_PX}px edge band is out of usable range`);
});

test('W3: a zero-height scroll container never starts the auto-scroll tick', () => {
  // The seat found that an unmeasured container read as "hard against both
  // edges", so every armed drag started an interval that its own !armed guard
  // could never stop - which turned a red test into a HANG. A box that cannot
  // scroll must contribute nothing.
  for (const y of [-50, 0, 10, 112, 9999]) {
    assert.equal(computeAutoScrollDelta({ top: 0, bottom: 0 }, y, REORDER_AUTOSCROLL_EDGE_PX, REORDER_AUTOSCROLL_STEP_PX), 0,
      `a zero-height box must not scroll at clientY=${y}`);
  }
  assert.equal(computeAutoScrollDelta({ top: 100, bottom: 40 }, 50, 36, 12), 0, 'an inverted rect is inert too');
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
  // Adversarial gate S2: the indicator assertion used to sit AFTER the drag
  // completed, where `endGesture` has already cleared every class
  // unconditionally - so it could not fail. Checked MID-drag now.
  pointer(f.window, f.rows[0], 'pointerdown', { clientY: 5 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 20 });
  pointer(f.window, f.doc, 'pointermove', { clientY: 105 }); // over a foreign row
  assert.equal(f.rows[3].className.includes('drag-over'), false, 'no drop line on a foreign row, WHILE dragging');
  pointer(f.window, f.doc, 'pointerup', { clientY: 105 });
  assert.deepEqual(moves, [], 'no cross-source order is ever persisted');
});

test('wireReorderable: a WITHIN-group drop still works with a group guard installed', () => {
  const f = buildList();
  const moves = wire(f, { groupOf: (i) => (i < 2 ? 'channel' : 'books') });
  mouseDrag(f, 2, 105);
  assert.deepEqual(moves, [{ from: 2, to: 3, source: 'pointer' }]);
});

test('wireReorderable: native HTML5 drag is turned OFF on every row it wires', () => {
  // Leaving it on lets the browser start a native drag out from under the
  // pointer gesture and cancel it -- the two mechanisms cannot coexist.
  const f = buildList();
  f.rows.forEach((r) => r.setAttribute('draggable', 'true'));
  wire(f);
  assert.deepEqual(f.rows.map((r) => r.getAttribute('draggable')), ['false', 'false', 'false', 'false']);
});

test('wireReorderable (QA gate C1): "false", never merely absent - <a> and <img> are draggable by DEFAULT', () => {
  // An absent `draggable` attribute means "UA default", and that default is
  // TRUE for <a href> and <img>. The original implementation removed the
  // attribute, which left three shipped sidebar surfaces (whose rows ARE <a>
  // elements, some containing <img> avatars) starting a native link/image
  // drag on desktop - taking the pointer, firing pointercancel, and killing
  // the reorder. jsdom implements no native DnD, so only this attribute-level
  // assertion can catch it here; the reflection it rests on is real, though:
  const dom = new JSDOM('<!doctype html><html><body><div id="list"></div></body></html>');
  const doc = dom.window.document;
  const probe = doc.createElement('a');
  probe.href = '/x';
  assert.equal(probe.getAttribute('draggable'), null);
  assert.equal(probe.draggable, true, 'an <a href> with NO draggable attribute is draggable anyway');

  const container = doc.getElementById('list');
  container.innerHTML = RECTS.map((_, i) =>
    `<a href="/?root=${i}" class="row"><img src="/avatar${i}.png" alt=""><span>label</span></a>`
  ).join('');
  const rows = Array.prototype.slice.call(container.querySelectorAll('.row'));
  wireReorderable(container, {
    rowSelector: '.row',
    measure: (el) => RECTS[rows.indexOf(el)],
    onReorder: () => {},
  });
  for (const row of rows) {
    assert.equal(row.getAttribute('draggable'), 'false', 'the <a> row is explicitly not draggable');
    assert.equal(row.draggable, false, 'and the PROPERTY - what the UA actually reads - agrees');
    const img = row.querySelector('img');
    assert.equal(img.draggable, false, 'the <img> avatar inside it too, or it drags on its own');
  }
});

test('wireReorderable (QA delta S4): a NESTED anchor inside a non-anchor row is disarmed too', () => {
  // The subscriptions list's real shape: the row is a <div>, but it contains
  // a channel link and an avatar <img>, each draggable by UA default on its
  // own. The previous fixture made the row itself the <a>, so the descendant
  // sweep was only held by a source-lock string - this binds it by execution.
  const dom = new JSDOM('<!doctype html><html><body><div id="list"></div></body></html>');
  const doc = dom.window.document;
  const container = doc.getElementById('list');
  container.innerHTML = RECTS.map((_, i) =>
    `<div class="row"><img src="/a${i}.png" alt=""><a href="https://example.com/c${i}">channel</a><span>x</span></div>`
  ).join('');
  const rows = Array.prototype.slice.call(container.querySelectorAll('.row'));
  wireReorderable(container, {
    rowSelector: '.row',
    measure: (el) => RECTS[rows.indexOf(el)],
    onReorder: () => {},
  });
  for (const row of rows) {
    assert.equal(row.draggable, false, 'the <div> row');
    assert.equal(row.querySelector('a').draggable, false, 'its nested channel link');
    assert.equal(row.querySelector('img').draggable, false, 'its nested avatar image');
  }
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
  // Adversarial gate S3: all three cases used to exit through `rows.length === 0`,
  // so deleting the `!onReorder || !rowSelector` guard survived. The rows-PRESENT
  // variants below are what actually reach it.
  const dom = new JSDOM('<!doctype html><html><body><div id="list"></div></body></html>');
  const container = dom.window.document.getElementById('list');
  assert.doesNotThrow(() => wireReorderable(container, { rowSelector: '.row', onReorder: () => {} }));
  assert.doesNotThrow(() => wireReorderable(null, { rowSelector: '.row', onReorder: () => {} }));

  // Rows present, no onReorder: must wire NOTHING rather than throw on drag.
  const f = buildList();
  assert.doesNotThrow(() => wireReorderable(f.container, { rowSelector: '.row', measure: f.measure }));
  assert.equal(f.rows[0].classList.contains('reorder-row'), false, 'a surface with no handler is not wired at all');
  assert.doesNotThrow(() => mouseDrag(f, 0, 105), 'and dragging it is inert');

  // Rows present, no rowSelector.
  const g = buildList();
  assert.doesNotThrow(() => wireReorderable(g.container, { onReorder: () => {}, measure: g.measure }));
  assert.equal(g.rows[0].classList.contains('reorder-row'), false);
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
