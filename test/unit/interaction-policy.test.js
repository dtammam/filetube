'use strict';

// [UNIT] The native-interaction policy, JS half (public/js/interaction.js; D6 and
// D8.3 of the UI professionalism pass).
//
// Every test drives the REAL listeners with real jsdom PointerEvents (jsdom 29
// ships a working PointerEvent; see LESSONS 2) and asserts the observable
// outcome: handler calls, defaultPrevented, the DOM, the custom property. Timers
// run under node:test's mock timers through an injected `win` shim, so "never
// before 450ms" is exact. jsdom has no layout, so swipeRow gets an injected
// `measure` (row 400px, actions 160px).
//
// The swipe tests are the D8.3 destructive-safety floor: a danger action (the
// notification Delete) must never run from a drag, a fast swipe, a full swipe,
// the click that ends a drag, a swipe-then-tap on the content, or a double tap. The one
// exception is opt-in (v1.403.0, Modern home's Move to Trash, `dangerFullSwipe: true`).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const I = require('../../public/js/interaction.js');

const HTML = '<!doctype html><body>'
  + '<div id="list"><div id="before">b</div>'
  + '<div id="row" class="n-row" data-k="1"><span id="title">Some title text</span><button id="inner">x</button></div>'
  + '<div id="row2">second</div><div id="after">a</div>'
  + '<input id="field"><div id="ce" contenteditable="true"><span id="ce-in">edit</span></div>'
  + '<div id="menu-item">item</div></div></body>';

// Timers resolve through the (mockable) globals at call time.
const WIN = {
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (id) => clearTimeout(id),
};

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = new JSDOM(HTML);
  const w = dom.window;
  const doc = w.document;
  const $ = (id) => doc.getElementById(id);
  function pe(type, el, o = {}) {
    const e = new w.PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: o.pointerId ?? 1, pointerType: o.pointerType ?? 'touch',
      isPrimary: o.isPrimary ?? true, button: o.button ?? 0, buttons: o.buttons ?? 0,
      clientX: o.x ?? 100, clientY: o.y ?? 100,
    });
    const notPrevented = el.dispatchEvent(e);
    return { e, notPrevented };
  }
  function click(el, detail = 1) {
    const e = new w.MouseEvent('click', { bubbles: true, cancelable: true, detail });
    el.dispatchEvent(e);
    return e;
  }
  function ctx(el, o = {}) {
    const e = o.pointerType !== undefined
      ? new w.PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: o.pointerType, clientX: o.x ?? 50, clientY: o.y ?? 60, button: 2 })
      : new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: o.x ?? 50, clientY: o.y ?? 60, button: 2 });
    el.dispatchEvent(e);
    return e;
  }
  function touchmove(el) {
    const e = new w.Event('touchmove', { bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  }
  const tick = (ms) => t.mock.timers.tick(ms);
  return { dom, w, doc, $, pe, click, ctx, touchmove, tick };
}

// ---- onLongPress -----------------------------------------------------------

test('onLongPress: fires exactly once after ms, never before', (t) => {
  const s = setup(t);
  const calls = [];
  I.onLongPress(s.$('row'), (e, pt) => calls.push({ e, pt }), { win: WIN });
  s.pe('pointerdown', s.$('title'), { x: 30, y: 40 });
  s.tick(449);
  assert.equal(calls.length, 0, 'not at 449ms');
  s.tick(1);
  assert.equal(calls.length, 1, 'fires at 450ms');
  assert.deepEqual(calls[0].pt, { x: 30, y: 40 });
  assert.equal(calls[0].e.type, 'pointerdown');
  s.tick(5000);
  assert.equal(calls.length, 1, 'never twice for one press');
  s.pe('pointerup', s.$('title'), { x: 30, y: 40 });
  s.tick(5000);
  assert.equal(calls.length, 1);
});

test('onLongPress: the default hold is 450ms with 8px tolerance', () => {
  assert.equal(I.LONG_PRESS_MS, 450);
  assert.equal(I.LONG_PRESS_TOLERANCE_PX, 8);
});

test('onLongPress: movement beyond tolerance cancels; movement within it does not', (t) => {
  const s = setup(t);
  let n = 0;
  I.onLongPress(s.$('row'), () => n++, { win: WIN });
  s.pe('pointerdown', s.$('title'), { x: 100, y: 100 });
  s.pe('pointermove', s.$('title'), { x: 109, y: 100 });   // 9px
  s.tick(1000);
  assert.equal(n, 0, 'a 9px drift cancels');
  s.pe('pointerup', s.$('title'));
  s.pe('pointerdown', s.$('title'), { x: 100, y: 100 });
  s.pe('pointermove', s.$('title'), { x: 105, y: 105 });   // 7.07px
  s.tick(450);
  assert.equal(n, 1, 'a 7px drift still fires');
});

test('onLongPress: pointerup or pointercancel before ms cancels without firing', (t) => {
  const s = setup(t);
  let n = 0;
  I.onLongPress(s.$('row'), () => n++, { win: WIN });
  s.pe('pointerdown', s.$('title'));
  s.tick(300);
  s.pe('pointerup', s.$('title'));
  s.tick(1000);
  assert.equal(n, 0, 'pointerup');
  s.pe('pointerdown', s.$('title'));
  s.tick(300);
  s.pe('pointercancel', s.$('title'));
  s.tick(1000);
  assert.equal(n, 0, 'pointercancel');
});

test('onLongPress: a second finger cancels the hold (a pinch is not a long-press)', (t) => {
  const s = setup(t);
  let n = 0;
  I.onLongPress(s.$('row'), () => n++, { win: WIN });
  s.pe('pointerdown', s.$('title'), { pointerId: 1 });
  s.pe('pointerdown', s.$('title'), { pointerId: 2, isPrimary: false });
  s.tick(1000);
  assert.equal(n, 0);
});

test('onLongPress: never prevents pointerdown or touchstart', (t) => {
  const s = setup(t);
  I.onLongPress(s.$('row'), () => {}, { win: WIN });
  const { e, notPrevented } = s.pe('pointerdown', s.$('title'));
  assert.equal(e.defaultPrevented, false);
  assert.equal(notPrevented, true);
  const ts = new s.w.Event('touchstart', { bubbles: true, cancelable: true });
  s.$('title').dispatchEvent(ts);
  assert.equal(ts.defaultPrevented, false);
  s.tick(450);   // even after it fires, a new touchstart is untouched
  const ts2 = new s.w.Event('touchstart', { bubbles: true, cancelable: true });
  s.$('title').dispatchEvent(ts2);
  assert.equal(ts2.defaultPrevented, false);
});

test('onLongPress: touchmove is listened to (passive:false) and prevented ONLY while armed', (t) => {
  const s = setup(t);
  const el = s.$('row');
  const adds = [];
  const removes = [];
  const origAdd = el.addEventListener.bind(el);
  const origRemove = el.removeEventListener.bind(el);
  el.addEventListener = (type, fn, o) => { if (type === 'touchmove') adds.push(o); return origAdd(type, fn, o); };
  el.removeEventListener = (type, fn, o) => { if (type === 'touchmove') removes.push(o); return origRemove(type, fn, o); };
  I.onLongPress(el, () => {}, { win: WIN });
  assert.equal(adds.length, 0, 'no touchmove listener at setup');
  s.pe('pointerdown', s.$('title'));
  assert.equal(adds.length, 0, 'none on pointerdown');
  assert.equal(s.touchmove(s.$('title')).defaultPrevented, false, 'a scroll before it fires is free');
  s.tick(450);
  assert.equal(adds.length, 1, 'attached when it fires');
  assert.equal(adds[0].passive, false);
  assert.equal(s.touchmove(s.$('title')).defaultPrevented, true, 'prevented while armed');
  s.pe('pointerup', s.$('title'));
  assert.equal(removes.length >= 1, true, 'removed on release');
  assert.equal(s.touchmove(s.$('title')).defaultPrevented, false, 'free again after release');
});

test('onLongPress: contextmenu is prevented while pressed and just after firing, not otherwise', (t) => {
  const s = setup(t);
  I.onLongPress(s.$('row'), () => {}, { win: WIN });
  assert.equal(s.ctx(s.$('title')).defaultPrevented, false, 'no press: untouched');
  s.pe('pointerdown', s.$('title'), { pointerType: 'mouse' });
  assert.equal(s.ctx(s.$('title')).defaultPrevented, true, 'during a press');
  s.tick(450);
  assert.equal(s.ctx(s.$('title')).defaultPrevented, true, 'after it fired, still down');
  s.pe('pointerup', s.$('title'), { pointerType: 'mouse' });
  assert.equal(s.ctx(s.$('title')).defaultPrevented, true, 'just after release of a fired press');
  s.tick(1000);
  assert.equal(s.ctx(s.$('title')).defaultPrevented, false, 'grace over');
});

test('onLongPress: a touch contextmenu before the timer IS the long press - fires once, now', (t) => {
  const s = setup(t);
  let n = 0;
  I.onLongPress(s.$('row'), () => n++, { win: WIN });
  s.pe('pointerdown', s.$('title'));
  s.tick(300);
  const c = s.ctx(s.$('title'), { pointerType: 'touch' });
  assert.equal(c.defaultPrevented, true);
  assert.equal(n, 1);
  s.tick(1000);
  assert.equal(n, 1, 'the timer does not fire it again');
});

test('onLongPress: the ONE click after a fired press is swallowed (any target), the next passes', (t) => {
  const s = setup(t);
  const rowClicks = [];
  const menuClicks = [];
  s.$('row').addEventListener('click', () => rowClicks.push(1));
  s.$('menu-item').addEventListener('click', () => menuClicks.push(1));
  I.onLongPress(s.$('row'), () => {}, { win: WIN });
  s.pe('pointerdown', s.$('title'));
  s.tick(450);
  s.pe('pointerup', s.$('title'));
  // The release lands on the menu that opened under the finger.
  const c1 = s.click(s.$('menu-item'));
  assert.equal(c1.defaultPrevented, true);
  assert.equal(menuClicks.length, 0, 'the release is not a tap on the menu');
  const c2 = s.click(s.$('title'));
  assert.equal(c2.defaultPrevented, false);
  assert.equal(rowClicks.length, 1, 'exactly one click swallowed');
});

test('onLongPress: the swallow expires, and a press that did not fire swallows nothing', (t) => {
  const s = setup(t);
  let clicks = 0;
  s.$('row').addEventListener('click', () => clicks++);
  I.onLongPress(s.$('row'), () => {}, { win: WIN });
  s.pe('pointerdown', s.$('title'));
  s.tick(200);
  s.pe('pointerup', s.$('title'));
  s.click(s.$('title'));
  assert.equal(clicks, 1, 'a plain tap clicks');
  s.pe('pointerdown', s.$('title'));
  s.tick(450);
  s.pe('pointerup', s.$('title'));
  s.tick(I.CLICK_SWALLOW_MS + 1);
  s.click(s.$('title'));
  assert.equal(clicks, 2, 'a later deliberate tap is not eaten');
});

test('onLongPress: firing clears the text selection', (t) => {
  const s = setup(t);
  const sel = s.doc.getSelection();
  const r = s.doc.createRange();
  r.selectNodeContents(s.$('title'));
  sel.addRange(r);
  assert.equal(sel.rangeCount, 1, 'precondition: a selection exists');
  I.onLongPress(s.$('row'), () => {}, { win: WIN });
  s.pe('pointerdown', s.$('title'));
  s.tick(449);
  assert.equal(sel.rangeCount, 1, 'untouched before it fires');
  s.tick(1);
  assert.equal(sel.rangeCount, 0);
});

test('onLongPress: a press inside a field is ignored (the native caret menu stays)', (t) => {
  const s = setup(t);
  let n = 0;
  const wrap = s.$('list');
  I.onLongPress(wrap, () => n++, { win: WIN });
  s.pe('pointerdown', s.$('field'));
  s.tick(1000);
  s.pe('pointerdown', s.$('ce-in'));
  s.tick(1000);
  assert.equal(n, 0);
  s.pe('pointerup', s.$('ce-in'));
  s.pe('pointerdown', s.$('title'));
  s.tick(450);
  assert.equal(n, 1, 'control: the same wrapper fires outside fields');
});

test('onLongPress: a mouse right button never starts a hold', (t) => {
  const s = setup(t);
  let n = 0;
  I.onLongPress(s.$('row'), () => n++, { win: WIN });
  s.pe('pointerdown', s.$('title'), { pointerType: 'mouse', button: 2 });
  s.tick(1000);
  assert.equal(n, 0);
});

test('onLongPress: off() removes every listener and timer', (t) => {
  const s = setup(t);
  let n = 0;
  const off = I.onLongPress(s.$('row'), () => n++, { win: WIN });
  s.pe('pointerdown', s.$('title'));
  off();
  s.tick(1000);
  assert.equal(n, 0, 'a pending press dies with off()');
  s.pe('pointerdown', s.$('title'));
  s.tick(1000);
  assert.equal(n, 0);
  assert.equal(s.ctx(s.$('title')).defaultPrevented, false);
});

// ---- onContextMenu ---------------------------------------------------------

test('onContextMenu: a mouse right-click is prevented and opens our menu at the pointer', (t) => {
  const s = setup(t);
  const calls = [];
  I.onContextMenu(s.$('row'), (e, pt) => calls.push(pt));
  const c = s.ctx(s.$('title'), { pointerType: 'mouse', x: 11, y: 22 });
  assert.equal(c.defaultPrevented, true);
  assert.deepEqual(calls, [{ x: 11, y: 22 }]);
  const c2 = s.ctx(s.$('title'), { x: 5, y: 6 });   // Firefox/Safari: a plain MouseEvent
  assert.equal(c2.defaultPrevented, true);
  assert.equal(calls.length, 2);
});

test('onContextMenu: fields keep the native menu', (t) => {
  const s = setup(t);
  let n = 0;
  I.onContextMenu(s.$('list'), () => n++);
  assert.equal(s.ctx(s.$('field'), { pointerType: 'mouse' }).defaultPrevented, false);
  assert.equal(s.ctx(s.$('ce-in'), { pointerType: 'mouse' }).defaultPrevented, false);
  assert.equal(n, 0);
  assert.equal(s.ctx(s.$('title'), { pointerType: 'mouse' }).defaultPrevented, true, 'control');
  assert.equal(n, 1);
});

test('onContextMenu: a touch long-press contextmenu is not its business', (t) => {
  const s = setup(t);
  let n = 0;
  I.onContextMenu(s.$('row'), () => n++);
  s.ctx(s.$('title'), { pointerType: 'touch' });
  assert.equal(n, 0, 'Chrome: pointerType touch');
  s.pe('pointerdown', s.$('title'), { pointerType: 'touch' });
  s.ctx(s.$('title'));   // Safari: a plain MouseEvent during a touch press
  assert.equal(n, 0);
  s.pe('pointerup', s.$('title'), { pointerType: 'touch' });
});

test('onContextMenu: off() removes it', (t) => {
  const s = setup(t);
  let n = 0;
  const off = I.onContextMenu(s.$('row'), () => n++);
  off();
  assert.equal(s.ctx(s.$('title'), { pointerType: 'mouse' }).defaultPrevented, false);
  assert.equal(n, 0);
});

// ---- onActionMenu ----------------------------------------------------------

test('onActionMenu: a touch long-press opens the menu once, whatever contextmenu the platform adds', (t) => {
  const s = setup(t);
  let n = 0;
  I.onActionMenu(s.$('row'), () => n++, { win: WIN });
  // Safari shape: plain MouseEvent contextmenu during the press, then after release.
  s.pe('pointerdown', s.$('title'));
  s.tick(450);
  s.ctx(s.$('title'));
  s.pe('pointerup', s.$('title'));
  const late = s.ctx(s.$('title'));
  assert.equal(late.defaultPrevented, true);
  assert.equal(n, 1, 'Safari shape: once');
  s.tick(2000);
  // Chrome/Android shape: contextmenu (pointerType touch) before our timer.
  s.pe('pointerdown', s.$('title'));
  s.tick(300);
  s.ctx(s.$('title'), { pointerType: 'touch' });
  s.tick(1000);
  s.pe('pointerup', s.$('title'));
  s.ctx(s.$('title'));
  assert.equal(n, 2, 'Chrome shape: once more');
});

test('onActionMenu: a desktop right-click opens it once', (t) => {
  const s = setup(t);
  let n = 0;
  I.onActionMenu(s.$('row'), () => n++, { win: WIN });
  s.pe('pointerdown', s.$('title'), { pointerType: 'mouse', button: 2 });
  const c = s.ctx(s.$('title'), { pointerType: 'mouse' });
  s.pe('pointerup', s.$('title'), { pointerType: 'mouse', button: 2 });
  s.tick(1000);
  assert.equal(c.defaultPrevented, true);
  assert.equal(n, 1);
});

test('onActionMenu: off() removes both paths', (t) => {
  const s = setup(t);
  let n = 0;
  const off = I.onActionMenu(s.$('row'), () => n++, { win: WIN });
  off();
  s.pe('pointerdown', s.$('title'));
  s.tick(1000);
  s.ctx(s.$('title'), { pointerType: 'mouse' });
  assert.equal(n, 0);
});

// ---- swipeRow --------------------------------------------------------------

const MEASURE = { rowWidth: () => 400, actionsWidth: () => 160 };

function mkActions(log) {
  return [
    { id: 'dismiss', label: 'Dismiss', icon: 'close', kind: 'neutral', onSelect: (c) => log.push(['dismiss', c.via]) },
    { id: 'delete', label: 'Delete', icon: 'delete', kind: 'danger', onSelect: (c) => log.push(['delete', c.via]) },
  ];
}
function mkRow(s, log, extra = {}) {
  return I.swipeRow(s.$('row'), { actions: mkActions(log), fullSwipe: 'dismiss', measure: MEASURE, win: WIN, ...extra });
}
// A horizontal drag on the row content: down at x0, moves to each x, up at the last.
function drag(s, xs, o = {}) {
  const el = o.el || s.$('title');
  const y = o.y ?? 100;
  s.pe('pointerdown', el, { x: xs[0], y, pointerId: o.id ?? 7 });
  for (const x of xs.slice(1)) s.pe('pointermove', el, { x, y: o.ys ? o.ys.shift() : y, pointerId: o.id ?? 7 });
  if (o.cancel) s.pe('pointercancel', el, { x: xs[xs.length - 1], y, pointerId: o.id ?? 7 });
  else if (!o.hold) s.pe('pointerup', el, { x: xs[xs.length - 1], y, pointerId: o.id ?? 7 });
}
const wrapOf = (s) => s.$('row').parentNode;
const offsetOf = (s) => wrapOf(s).style.getPropertyValue('--swipe-x');
const btn = (s, id) => wrapOf(s).querySelector('[data-action="' + id + '"]');
function tapButton(s, b, detail = 1) {
  s.pe('pointerdown', b, { pointerId: 9, x: 350, y: 100 });
  s.pe('pointerup', b, { pointerId: 9, x: 350, y: 100 });
  return s.click(b, detail);
}

test('swipeRow: wraps the row in place with the fixed DOM contract', (t) => {
  const s = setup(t);
  const log = [];
  mkRow(s, log);
  const wrap = wrapOf(s);
  assert.equal(wrap.className, 'ui-swipe');
  assert.equal(wrap.previousElementSibling.id, 'before');
  assert.equal(wrap.nextElementSibling.id, 'row2');
  assert.equal(wrap.children.length, 2);
  const under = wrap.children[0];
  assert.equal(under.className, 'ui-swipe__actions');
  assert.equal(under.getAttribute('aria-hidden'), 'true', 'hidden while closed');
  assert.equal(under.hasAttribute('inert'), true, 'inert while closed');
  assert.equal(wrap.children[1].id, 'row');
  assert.equal(s.$('row').className, 'n-row ui-swipe__content');
  const bs = [...under.children];
  assert.deepEqual(bs.map((b) => [b.tagName, b.type, b.className, b.dataset.action, b.textContent]), [
    ['BUTTON', 'button', 'ui-swipe__action ui-swipe__action--neutral', 'dismiss', 'Dismiss'],
    ['BUTTON', 'button', 'ui-swipe__action ui-swipe__action--danger', 'delete', 'Delete'],
  ]);
});

test('swipeRow: destroy() restores the original DOM exactly (closed, open, and a row with no class)', (t) => {
  const s = setup(t);
  const before = s.$('list').innerHTML;
  const c1 = mkRow(s, []);
  c1.destroy();
  assert.equal(s.$('list').innerHTML, before, 'closed');
  const c2 = mkRow(s, []);
  drag(s, [300, 280, 200]);
  assert.equal(c2.isOpen(), true, 'precondition: open');
  c2.destroy();
  assert.equal(s.$('list').innerHTML, before, 'open');
  const r2 = s.$('row2');
  const c3 = I.swipeRow(r2, { actions: mkActions([]), fullSwipe: null, measure: MEASURE, win: WIN });
  c3.destroy();
  assert.equal(r2.hasAttribute('class'), false);
  assert.equal(s.$('list').innerHTML, before, 'classless row');
  // destroyed means dead: a drag on the old row neither wraps nor moves anything
  drag(s, [300, 280, 200]);
  assert.equal(s.$('list').innerHTML, before);
});

test('swipeRow: the same row cannot get two controllers', (t) => {
  const s = setup(t);
  mkRow(s, []);
  assert.throws(() => mkRow(s, []), /already has a swipe controller/);
});

test('swipeRow: direction lock - a mostly vertical move releases the gesture entirely', (t) => {
  const s = setup(t);
  const c = mkRow(s, []);
  s.pe('pointerdown', s.$('title'), { x: 300, y: 100 });
  s.pe('pointermove', s.$('title'), { x: 296, y: 103 });   // 5px: undecided
  assert.equal(wrapOf(s).classList.contains('is-dragging'), false, 'undecided under 8px');
  s.pe('pointermove', s.$('title'), { x: 294, y: 120 });   // vertical
  s.pe('pointermove', s.$('title'), { x: 150, y: 125 });   // a later sideways move is ignored
  assert.equal(wrapOf(s).classList.contains('is-dragging'), false);
  assert.equal(offsetOf(s), '', 'the row never moved');
  s.pe('pointerup', s.$('title'), { x: 150, y: 125 });
  assert.equal(c.isOpen(), false);
});

test('swipeRow: a horizontal drag moves the row via --swipe-x with is-dragging', (t) => {
  const s = setup(t);
  mkRow(s, []);
  drag(s, [300, 290, 250], { hold: true });
  assert.equal(wrapOf(s).classList.contains('is-dragging'), true);
  assert.equal(offsetOf(s), '-50px');
  s.pe('pointermove', s.$('title'), { x: 400, y: 100, pointerId: 7 });
  assert.equal(offsetOf(s), '0px', 'never past closed');
  s.pe('pointerup', s.$('title'), { x: 400, y: 100, pointerId: 7 });
  assert.equal(wrapOf(s).classList.contains('is-dragging'), false);
});

test('swipeRow: release past half the actions snaps open, short of it snaps closed', (t) => {
  const s = setup(t);
  const c = mkRow(s, []);
  drag(s, [300, 290, 219]);   // 81px > 80
  assert.equal(c.isOpen(), true);
  assert.equal(wrapOf(s).classList.contains('is-open'), true);
  assert.equal(offsetOf(s), '-160px', 'open at the actions natural width');
  const under = wrapOf(s).children[0];
  assert.equal(under.hasAttribute('aria-hidden'), false);
  assert.equal(under.hasAttribute('inert'), false);
  c.close();
  s.tick(1000);
  drag(s, [300, 290, 221]);   // 79px < 80
  assert.equal(c.isOpen(), false);
  assert.equal(offsetOf(s), '0px');
  assert.equal(under.getAttribute('aria-hidden'), 'true');
});

test('swipeRow: a full swipe past the threshold runs ONLY the fullSwipe action', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkRow(s, log);
  drag(s, [390, 380, 150]);   // 240px = 0.6 * 400
  assert.deepEqual(log, [['dismiss', 'full-swipe']]);
  assert.equal(c.isOpen(), false);
  s.tick(1000);
  drag(s, [390, 380, 151]);   // 239px: short of the threshold -> just opens
  assert.deepEqual(log, [['dismiss', 'full-swipe']]);
  assert.equal(c.isOpen(), true);
});

test('swipeRow: fullSwipe:null never runs anything from a drag', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkRow(s, log, { fullSwipe: null });
  drag(s, [399, 380, 0]);
  assert.deepEqual(log, []);
  assert.equal(c.isOpen(), true);
});

test('swipeRow: a danger fullSwipe throws at setup (and the DOM is untouched)', (t) => {
  const s = setup(t);
  const before = s.$('list').innerHTML;
  assert.throws(() => mkRow(s, [], { fullSwipe: 'delete' }), /danger action can never be the full-swipe/);
  assert.equal(s.$('list').innerHTML, before);
  assert.throws(() => mkRow(s, [], { fullSwipe: 'nope' }), /not an action id/);
  assert.throws(() => I.swipeRow(s.$('row'), { actions: [{ id: 'd', label: 'D', onSelect() {} }], measure: MEASURE }), /needs kind/);
  assert.throws(() => mkRow(s, [], { threshold: 0 }), /threshold/);
  assert.equal(s.$('list').innerHTML, before);
});

test('swipeRow D8.3: no drag sequence ever runs the danger action', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkRow(s, log);
  const del = () => btn(s, 'delete');
  const deletes = () => log.filter((l) => l[0] === 'delete').length;

  // 1. a fast swipe (two samples, far) - the full swipe dismisses, never deletes
  drag(s, [395, 5]);
  s.click(del());                 // the release click landing on the underlay
  assert.equal(deletes(), 0, 'fast swipe');
  s.tick(1000);

  // 2. open, then the drag-ending click lands on the revealed Delete
  drag(s, [300, 290, 200]);
  assert.equal(c.isOpen(), true);
  s.click(del());
  assert.equal(deletes(), 0, 'drag-ending click on Delete');
  s.tick(1000);

  // 3. open row: a drag that STARTS on the Delete button, then clicks
  s.pe('pointerdown', del(), { pointerId: 9, x: 350 });
  s.pe('pointermove', del(), { pointerId: 9, x: 330 });
  s.pe('pointerup', del(), { pointerId: 9, x: 330 });
  s.click(del());
  assert.equal(deletes(), 0, 'a pan off the button is not a tap');

  // 4. mid-drag: a click on Delete while the content is being dragged
  drag(s, [300, 290, 280], { hold: true, id: 8 });
  assert.equal(wrapOf(s).classList.contains('is-dragging'), true);
  s.click(del(), 0);
  s.click(del(), 1);
  assert.equal(deletes(), 0, 'mid-drag');
  s.pe('pointercancel', s.$('title'), { pointerId: 8 });
  s.tick(1000);

  // 5. swipe then tap on the content, twice (double tap)
  c.close();
  drag(s, [300, 290, 200]);
  s.tick(1000);
  s.pe('pointerdown', s.$('title'), { x: 100 }); s.pe('pointerup', s.$('title'), { x: 100 }); s.click(s.$('title'));
  s.pe('pointerdown', s.$('title'), { x: 100 }); s.pe('pointerup', s.$('title'), { x: 100 }); s.click(s.$('title'));
  assert.equal(deletes(), 0, 'swipe then double tap');

  // 6. a closed row: any click on the hidden Delete does nothing
  assert.equal(c.isOpen(), false);
  tapButton(s, del(), 1);
  tapButton(s, del(), 0);
  assert.equal(deletes(), 0, 'closed row');

  // 7. pointercancel mid-drag runs nothing
  drag(s, [390, 380, 50], { cancel: true });
  assert.equal(deletes(), 0);
  assert.deepEqual(log.filter((l) => l[0] === 'dismiss').length, 1, 'only the one full swipe of step 1 dismissed');
});

test('swipeRow D8.3: the danger action runs from a real tap on its revealed button, once', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkRow(s, log);
  drag(s, [300, 290, 200]);
  s.tick(1000);
  const del = btn(s, 'delete');
  const e = tapButton(s, del);
  assert.deepEqual(log, [['delete', 'button']]);
  assert.equal(e.defaultPrevented, true);
  assert.equal(c.isOpen(), false, 'selecting closes the row');
  tapButton(s, del);   // the double tap's second tap
  assert.deepEqual(log, [['delete', 'button']], 'a second tap cannot reach it again');
});

test('swipeRow: keyboard activation (detail 0) of a revealed action works while open', (t) => {
  const s = setup(t);
  const log = [];
  mkRow(s, log);
  drag(s, [300, 290, 200]);
  s.tick(1000);
  s.click(btn(s, 'dismiss'), 0);
  assert.deepEqual(log, [['dismiss', 'button']]);
});

test('swipeRow: the click that ends a drag activates nothing on the row', (t) => {
  const s = setup(t);
  let rowClicks = 0;
  s.$('row').addEventListener('click', () => rowClicks++);
  const log = [];
  mkRow(s, log);
  drag(s, [300, 290, 250]);       // snaps closed
  const c1 = s.click(s.$('title'));
  assert.equal(c1.defaultPrevented, true);
  assert.equal(rowClicks, 0);
  s.tick(1000);
  s.click(s.$('title'));
  assert.equal(rowClicks, 1, 'control: a later tap on the closed row works');
  assert.deepEqual(log, []);
});

test('swipeRow: tapping the content of an open row only closes it', (t) => {
  const s = setup(t);
  let rowClicks = 0;
  s.$('inner').addEventListener('click', () => rowClicks++);
  const log = [];
  const c = mkRow(s, log);
  drag(s, [300, 290, 200]);
  s.tick(1000);
  s.pe('pointerdown', s.$('inner'), { x: 100 });
  s.pe('pointerup', s.$('inner'), { x: 100 });
  const e = s.click(s.$('inner'));
  assert.equal(e.defaultPrevented, true);
  assert.equal(rowClicks, 0);
  assert.equal(c.isOpen(), false);
  assert.deepEqual(log, []);
});

test('swipeRow: opening one row closes any other open row in the document', (t) => {
  const s = setup(t);
  const a = mkRow(s, []);
  const b = I.swipeRow(s.$('row2'), { actions: mkActions([]), fullSwipe: null, measure: MEASURE, win: WIN });
  drag(s, [300, 290, 200]);
  assert.equal(a.isOpen(), true);
  s.tick(1000);
  drag(s, [300, 290, 200], { el: s.$('row2') });
  assert.equal(b.isOpen(), true);
  assert.equal(a.isOpen(), false);
  assert.equal(wrapOf(s).classList.contains('is-open'), false);
});

test('swipeRow: a pointerdown outside an open row closes it', (t) => {
  const s = setup(t);
  const c = mkRow(s, []);
  drag(s, [300, 290, 200]);
  assert.equal(c.isOpen(), true);
  s.pe('pointerdown', s.$('after'));
  assert.equal(c.isOpen(), false);
});

// ---- v1.403.0: the opt-in danger full swipe ---------------------------------------
// Each test below builds the input ONLY its guard refuses (LESSONS 2); the mutants are in the plan's Evidence.
function mkDanger(s, log, extra = {}) {
  return I.swipeRow(s.$('row'), { actions: mkActions(log), fullSwipe: 'delete', dangerFullSwipe: true, measure: MEASURE, win: WIN, ...extra });
}

test('swipeRow v1.403: the opt-in is exactly true; anything else still throws, DOM untouched', (t) => {
  const s = setup(t);
  const before = s.$('list').innerHTML;
  for (const v of [undefined, false, 1, 'true', {}]) {
    assert.throws(() => mkRow(s, [], { fullSwipe: 'delete', dangerFullSwipe: v }), /danger action can never be the full-swipe/, String(v));
  }
  assert.equal(s.$('list').innerHTML, before);
});

test('swipeRow v1.403: notifications\' shape (no opt-in) still throws, and its full swipe still runs the neutral action', (t) => {
  const s = setup(t);
  const log = [];
  assert.throws(() => mkRow(s, log, { fullSwipe: 'delete' }), /danger/);
  mkRow(s, log);
  drag(s, [390, 380, 100]);
  assert.deepEqual(log, [['dismiss', 'full-swipe']]);
});

test('swipeRow v1.403: with the opt-in a full swipe fires once, and only on release', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkDanger(s, log);
  drag(s, [390, 380, 100], { hold: true });
  assert.deepEqual(log, [], 'nothing runs while the finger is down');
  s.pe('pointerup', s.$('title'), { x: 100, y: 100, pointerId: 7 });
  assert.deepEqual(log, [['delete', 'full-swipe']]);
  assert.equal(c.isOpen(), false);
  // the same gesture's trailing events fire nothing more
  s.pe('pointermove', s.$('title'), { x: 50, y: 100, pointerId: 7 });
  s.pe('pointerup', s.$('title'), { x: 50, y: 100, pointerId: 7 });
  assert.equal(log.length, 1, 'a second firing needs a new gesture');
  s.tick(1000);
  drag(s, [390, 380, 100]);
  assert.equal(log.length, 2, 'a new gesture fires again (the CONTROL for the line above)');
});

test('swipeRow v1.403: a drag short of max(threshold, actions) opens, never fires - both terms bind', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkDanger(s, log);
  drag(s, [390, 380, 151]);   // 239px of 400: short of 0.6
  assert.deepEqual(log, []);
  assert.equal(c.isOpen(), true);
  c.close();
  s.tick(1000);
  // Actions WIDER than the threshold: 300px of actions on a 400px row. 250px passes 0.6 but not the actions.
  c.destroy();
  const log2 = [];
  const c2 = mkDanger(s, log2, { measure: { rowWidth: () => 400, actionsWidth: () => 300 } });
  drag(s, [390, 380, 140]);
  assert.deepEqual(log2, [], 'past the threshold, short of the actions: no fire');
  assert.equal(c2.isOpen(), true);
  c2.close();
  s.tick(1000);
  drag(s, [390, 380, 60]);
  assert.deepEqual(log2, [['delete', 'full-swipe']], 'past both, and the margin: fires');
});

test('swipeRow v1.403: a vertical drag, a sideways drift inside a scroll, a pointercancel and a tap fire nothing', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkDanger(s, log);
  // vertical from the first lock decision; the far-left later moves must not count
  s.pe('pointerdown', s.$('title'), { x: 390, y: 100, pointerId: 7 });
  s.pe('pointermove', s.$('title'), { x: 388, y: 120, pointerId: 7 });
  s.pe('pointermove', s.$('title'), { x: 100, y: 130, pointerId: 7 });
  s.pe('pointerup', s.$('title'), { x: 100, y: 130, pointerId: 7 });
  assert.deepEqual(log, [], 'released to the page at the lock');
  // a scroll with ~20px of drift
  s.pe('pointerdown', s.$('title'), { x: 200, y: 400, pointerId: 8 });
  s.pe('pointermove', s.$('title'), { x: 190, y: 340, pointerId: 8 });
  s.pe('pointermove', s.$('title'), { x: 180, y: 100, pointerId: 8 });
  s.pe('pointerup', s.$('title'), { x: 180, y: 100, pointerId: 8 });
  assert.deepEqual(log, []);
  assert.equal(c.isOpen(), false);
  // a locked full-distance drag that the browser takes back
  drag(s, [390, 380, 100], { cancel: true });
  assert.deepEqual(log, [], 'pointercancel runs nothing');
  assert.equal(c.isOpen(), false);
  assert.equal(wrapOf(s).classList.contains('is-dragging'), false);
  // a tap
  s.pe('pointerdown', s.$('title'), { x: 200, y: 100, pointerId: 9 });
  s.pe('pointerup', s.$('title'), { x: 200, y: 100, pointerId: 9 });
  s.click(s.$('title'));
  assert.deepEqual(log, []);
});

test('swipeRow v1.403: a drag that starts on a revealed button never fires the full swipe', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkDanger(s, log);
  drag(s, [390, 380, 300]);
  assert.equal(c.isOpen(), true);
  s.tick(1000);
  const b = btn(s, 'delete');
  s.pe('pointerdown', b, { x: 390, y: 100, pointerId: 11 });
  s.pe('pointermove', b, { x: 300, y: 100, pointerId: 11 });
  s.pe('pointermove', b, { x: 50, y: 100, pointerId: 11 });
  s.pe('pointerup', b, { x: 50, y: 100, pointerId: 11 });
  assert.deepEqual(log, []);
});

test('swipeRow v1.403: the revealed danger button still needs a real tap that began on it (S3 is the caller\'s onSelect)', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkDanger(s, log);
  drag(s, [390, 380, 300]);
  s.tick(1000);
  s.click(btn(s, 'delete'), 1);
  assert.deepEqual(log, [], 'a click with no press on the button does nothing');
  assert.equal(c.isOpen(), true);
  tapButton(s, btn(s, 'delete'));
  assert.deepEqual(log, [['delete', 'button']]);
  tapButton(s, btn(s, 'delete'));
  assert.equal(log.length, 1, 'selecting closed the row: a second tap reaches nothing');
});

test('swipeRow v1.403: destroy mid-drag fires nothing on the release that follows', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkDanger(s, log);
  const title = s.$('title');
  drag(s, [390, 380, 100], { hold: true });
  c.destroy();
  s.pe('pointerup', title, { x: 100, y: 100, pointerId: 7 });
  assert.deepEqual(log, []);
});

test('swipeRow v1.403: enabled() refuses at the press, at the lock and at the release', (t) => {
  const s = setup(t);
  const log = [];
  let on = false;
  const c = mkDanger(s, log, { enabled: () => on });
  drag(s, [390, 380, 100]);
  assert.deepEqual(log, [], 'off at the press: the row never moves');
  // on again by the first move: a press that began while off stays off for its whole gesture
  s.tick(1000);
  s.pe('pointerdown', s.$('title'), { x: 390, y: 100, pointerId: 7 });
  on = true;
  s.pe('pointermove', s.$('title'), { x: 380, y: 100, pointerId: 7 });
  assert.equal(wrapOf(s).classList.contains('is-dragging'), false, 'off at the press alone refuses the gesture');
  s.pe('pointermove', s.$('title'), { x: 100, y: 100, pointerId: 7 });
  s.pe('pointerup', s.$('title'), { x: 100, y: 100, pointerId: 7 });
  assert.deepEqual(log, []);
  on = false;
  assert.ok(['', '0px'].includes(offsetOf(s)), 'no offset written');
  s.tick(1000);
  // off only at the lock: on at the press, turned off before the first lock-deciding move
  on = true;
  s.pe('pointerdown', s.$('title'), { x: 390, y: 100, pointerId: 7 });
  on = false;
  s.pe('pointermove', s.$('title'), { x: 380, y: 100, pointerId: 7 });
  on = true;
  s.pe('pointermove', s.$('title'), { x: 100, y: 100, pointerId: 7 });
  s.pe('pointerup', s.$('title'), { x: 100, y: 100, pointerId: 7 });
  assert.deepEqual(log, [], 'off at the lock: released');
  assert.equal(wrapOf(s).classList.contains('is-dragging'), false);
  // off only at the release: a menu came up under the finger
  drag(s, [390, 380, 100], { hold: true });
  on = false;
  s.pe('pointerup', s.$('title'), { x: 100, y: 100, pointerId: 7 });
  assert.deepEqual(log, [], 'off at the release: nothing fires');
  assert.equal(c.isOpen(), false);
  assert.equal(offsetOf(s), '0px');
  s.tick(1000);
  on = true;
  drag(s, [390, 380, 100]);
  assert.deepEqual(log, [['delete', 'full-swipe']], 'on throughout: fires (the CONTROL)');
});

test('swipeRow v1.403: a mouse whose release was lost cannot drag by hovering, and a click cannot fire it', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkDanger(s, log);
  const m = { pointerType: 'mouse', pointerId: 1 };
  s.pe('pointerdown', s.$('title'), { ...m, x: 390, y: 100, buttons: 1 });
  s.pe('pointermove', s.$('title'), { ...m, x: 300, y: 100, buttons: 0 });   // the button came up outside the window
  s.pe('pointermove', s.$('title'), { ...m, x: 100, y: 100, buttons: 0 });
  s.pe('pointerup', s.$('title'), { ...m, x: 100, y: 100, buttons: 0 });
  assert.deepEqual(log, [], 'hovering is not dragging');
  assert.equal(c.isOpen(), false);
  s.tick(1000);
  drag(s, [390, 380, 100].map((x) => x), {});
  assert.deepEqual(log, [['delete', 'full-swipe']], 'CONTROL: a touch drag still fires');
  s.tick(1000);
  s.pe('pointerdown', s.$('title'), { ...m, x: 390, y: 100, buttons: 1 });
  s.pe('pointermove', s.$('title'), { ...m, x: 100, y: 100, buttons: 1 });
  s.pe('pointerup', s.$('title'), { ...m, x: 100, y: 100, buttons: 0 });
  assert.equal(log.length, 2, 'CONTROL: a real mouse drag with the button held fires');
});

test('swipeRow v1.403: a new primary press drops a drag whose release was lost; a second finger does not', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkDanger(s, log);
  drag(s, [390, 380, 100], { hold: true });   // the release never arrives
  s.pe('pointerdown', s.$('title'), { x: 200, y: 100, pointerId: 20 });
  assert.equal(wrapOf(s).classList.contains('is-dragging'), false);
  assert.equal(offsetOf(s), '0px');
  s.pe('pointerup', s.$('title'), { x: 200, y: 100, pointerId: 7 });
  assert.deepEqual(log, [], 'the stale pointer\'s late release fires nothing');
  s.pe('pointerup', s.$('title'), { x: 200, y: 100, pointerId: 20 });
  s.tick(1000);
  // a second finger (isPrimary false) leaves the running drag alone
  drag(s, [390, 380, 100], { hold: true });
  s.pe('pointerdown', s.$('title'), { x: 50, y: 300, pointerId: 21, isPrimary: false });
  assert.equal(wrapOf(s).classList.contains('is-dragging'), true);
  s.pe('pointerup', s.$('title'), { x: 100, y: 100, pointerId: 7 });
  assert.deepEqual(log, [['delete', 'full-swipe']]);
  assert.equal(c.isOpen(), false);
});

test('swipeRow v1.403: reset() ends a running drag without firing and closes an open row', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkDanger(s, log);
  drag(s, [390, 380, 100], { hold: true });
  c.reset();
  assert.equal(wrapOf(s).classList.contains('is-dragging'), false);
  s.pe('pointerup', s.$('title'), { x: 100, y: 100, pointerId: 7 });
  assert.deepEqual(log, []);
  s.tick(1000);
  drag(s, [390, 380, 300]);
  assert.equal(c.isOpen(), true);
  c.reset();
  assert.equal(c.isOpen(), false);
  assert.equal(offsetOf(s), '0px');
});

test('swipeRow v1.403: a label function is read again at each lock; an icon draws above the label; text stays the default', (t) => {
  const s = setup(t);
  let liked = false;
  const actions = [
    { id: 'like', kind: 'neutral', label: () => (liked ? 'Unlike' : 'Like'), icon: () => { const i = s.$('list').ownerDocument.createElement('i'); i.className = 'g'; return i; }, onSelect() {} },
    { id: 'plain', kind: 'neutral', label: 'Plain', onSelect() {} },
  ];
  I.swipeRow(s.$('row'), { actions, fullSwipe: null, measure: MEASURE, win: WIN });
  const like = btn(s, 'like');
  assert.equal(like.querySelector('.ui-swipe__label').textContent, 'Like');
  assert.ok(like.querySelector('i.g'), 'the icon is drawn');
  assert.equal(btn(s, 'plain').textContent, 'Plain');
  assert.equal(btn(s, 'plain').children.length, 0, 'no icon: bare text, as before');
  liked = true;
  assert.equal(like.querySelector('.ui-swipe__label').textContent, 'Like', 'not read until the next lock');
  drag(s, [390, 380, 300]);
  assert.equal(like.querySelector('.ui-swipe__label').textContent, 'Unlike');
  assert.equal(like.querySelectorAll('i.g').length, 1, 'the repaint replaces, never stacks');
});

test('swipeRow v1.403: a tap on a closed row keeps its click (tapping a card plays it)', (t) => {
  const s = setup(t);
  mkDanger(s, []);
  s.pe('pointerdown', s.$('title'), { x: 200, y: 100, pointerId: 9 });
  s.pe('pointerup', s.$('title'), { x: 200, y: 100, pointerId: 9 });
  const e = s.click(s.$('title'));
  assert.equal(e.defaultPrevented, false, 'the click passes untouched');
});

test('swipeRow v1.403: a tap on a just-revealed button inside the swallow window works; a pressless click there is still eaten', (t) => {
  const s = setup(t);
  const log = [];
  mkDanger(s, log);
  drag(s, [390, 380, 300]);
  // no time passes: a touch drag raises no click, so the swallow is still armed
  const stray = s.click(s.$('title'));
  assert.equal(stray.defaultPrevented, true, 'the click ending the drag is eaten');
  assert.deepEqual(log, []);
  // again, with a real press this time
  s.tick(1000);
  s.tick(1000);
  // close by a tap on the content, re-open, then tap inside the window
  s.pe('pointerdown', s.$('title'), { x: 200, pointerId: 3 });
  s.pe('pointerup', s.$('title'), { x: 200, pointerId: 3 });
  s.click(s.$('title'));
  s.tick(1000);
  drag(s, [390, 380, 300]);
  tapButton(s, btn(s, 'dismiss'));
  assert.deepEqual(log, [['dismiss', 'button']], 'the press began a new gesture: its click is its own');
});

// ---- v1.403.0 gate r1: the real proportions (actions at or above the threshold), which the 400 / 160 fixture cannot show
const PHONE = { rowWidth: () => 358, actionsWidth: () => 218 }; // the geometry the gate's C1 reproduced on

test('swipeRow v1.403 gate C1: a wobble on an OPEN row fires nothing, at any distance, and the row stays open', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkDanger(s, log, { measure: PHONE });
  drag(s, [340, 330, 120]);   // open, short of the full point
  assert.equal(c.isOpen(), true);
  assert.deepEqual(log, []);
  for (const nudge of [8, 10, 14, 20, 30, 100, 300]) {
    s.tick(1000);
    drag(s, [200, 200 - nudge]);
    assert.deepEqual(log, [], nudge + 'px');
    assert.equal(c.isOpen(), true, nudge + 'px');
  }
  // the gate's scroll shape on an open row: a first sample that locks sideways, then the finger goes up
  s.tick(1000);
  s.pe('pointerdown', s.$('title'), { x: 200, y: 400, pointerId: 7 });
  s.pe('pointermove', s.$('title'), { x: 191, y: 398, pointerId: 7 });
  s.pe('pointermove', s.$('title'), { x: 188, y: 150, pointerId: 7 });
  s.pe('pointerup', s.$('title'), { x: 188, y: 150, pointerId: 7 });
  assert.deepEqual(log, []);
});

test('swipeRow v1.403 gate C1: the same wobble on a non-danger full swipe keeps today\'s behaviour (notifications)', (t) => {
  const s = setup(t);
  const log = [];
  const c = I.swipeRow(s.$('row'), { actions: mkActions(log), fullSwipe: 'dismiss', measure: PHONE, win: WIN });
  drag(s, [340, 330, 130]);
  assert.equal(c.isOpen(), true);
  s.tick(1000);
  drag(s, [200, 190]);
  assert.deepEqual(log, [['dismiss', 'full-swipe']], 'unchanged: the opt-in alone tightens the rule');
});

test('swipeRow v1.403 gate W1: a danger full swipe must still be mostly horizontal at release', (t) => {
  const s = setup(t);
  const log = [];
  const c = mkDanger(s, log, { measure: PHONE });
  const go = (dx, dy) => {
    c.close(); // each from a CLOSED row: the open-row guard would mask this one (LESSONS 2)
    s.tick(1000);
    s.pe('pointerdown', s.$('title'), { x: 340, y: 700, pointerId: 7 });
    s.pe('pointermove', s.$('title'), { x: 331, y: 698, pointerId: 7 }); // locks sideways
    s.pe('pointermove', s.$('title'), { x: 340 + dx, y: 700 + dy, pointerId: 7 });
    s.pe('pointerup', s.$('title'), { x: 340 + dx, y: 700 + dy, pointerId: 7 });
  };
  go(-260, -483);
  assert.deepEqual(log, [], 'up and left, 25 degrees off vertical');
  go(-260, -260);
  assert.deepEqual(log, [], 'exactly diagonal is not horizontal');
});

test('swipeRow v1.403 gate W1 CONTROL: a sloppy but horizontal full swipe fires', (t) => {
  const s = setup(t);
  const log = [];
  mkDanger(s, log, { measure: PHONE });
  s.pe('pointerdown', s.$('title'), { x: 340, y: 700, pointerId: 7 });
  s.pe('pointermove', s.$('title'), { x: 331, y: 698, pointerId: 7 });
  s.pe('pointermove', s.$('title'), { x: 80, y: 640, pointerId: 7 });
  s.pe('pointerup', s.$('title'), { x: 80, y: 640, pointerId: 7 });
  assert.deepEqual(log, [['delete', 'full-swipe']]);
});

test('swipeRow v1.403 gate W2: revealing every button never doubles as Trash: the margin past the buttons binds', (t) => {
  const m = I.DANGER_FULL_SWIPE_MARGIN_PX;
  assert.equal(m, 24);
  const s = setup(t);
  const log = [];
  // row 300, actions 176: the threshold (180) is below actions + margin (200), so only the margin decides
  const c = mkDanger(s, log, { measure: { rowWidth: () => 300, actionsWidth: () => 176 } });
  drag(s, [290, 280, 290 - 176]);
  assert.deepEqual(log, [], 'exactly the buttons: opens');
  assert.equal(c.isOpen(), true);
  c.close();
  s.tick(1000);
  drag(s, [290, 280, 290 - 199]);
  assert.deepEqual(log, [], 'one short of the margin: opens');
  c.close();
  s.tick(1000);
  drag(s, [290, 280, 290 - 200]);
  assert.deepEqual(log, [['delete', 'full-swipe']], 'at the margin: fires');
});
