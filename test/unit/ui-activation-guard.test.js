'use strict';

// [UNIT] Gate r1 (adversary 1, CRITICAL): the second tap of a double-tap answered the
// ui.confirm the first tap opened. The dialog opened "open" at once and its OK checked only
// isOpen(), so a tap landing on the centred OK (over a phone row's Delete, a Trash Purge,
// a desktop menu's Move to Trash) 60-300ms later confirmed a delete nobody read. ui.sheet now
// ignores every activation of its controls until it has been open ACTIVATION_GUARD_MS,
// measured by the EVENT's own timeStamp, and a press that STARTED inside that window never
// answers even if it is released after it. These tests run the REAL ui.js on a jsdom page.
// Each rule is bound on its own: `tap()` is a pointer click (detail 1) with NO pointerdown
// (the timeStamp rule alone); the press rule gets a pointerdown and a late click; the key
// rule a keydown. A detail-0 click (a script's el.click(), a key's synthesised click) is not
// a pointer and is not time-gated, which is why the rest of the suite's el.click() still works.
//
// The clock: jsdom stamps an event with Date.now() (epoch ms), so the tests mock Date (and
// setTimeout, for the sheet's exit timer) on node:test's clock and tick it between taps.
// The high-res branch (a real engine's timeStamp, the performance.now() origin) has its own
// test with a stubbed win.performance.now and events carrying an explicit timeStamp.
// test/geometry/confirm-double-tap.check.js measures the same thing in Chromium with real
// taps at the OK button's screen position.

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const ui = require('../../public/js/ui.js');
const BL = require('../../public/js/body-scroll-lock.js');

const GUARD = ui.ACTIVATION_GUARD_MS;
const T0 = 1_750_000_000_000; // an epoch instant, like the one jsdom stamps events with

function page() {
  const dom = new JSDOM('<!DOCTYPE html><body><button id="opener">open</button></body>');
  const win = dom.window;
  win.FileTubeBodyLock = BL;
  win.scrollTo = () => {};
  win.matchMedia = (q) => ({ matches: false, media: q });
  return { win, doc: win.document };
}
function clock() { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 }); return mock.timers; }
afterEach(() => { mock.timers.reset(); });

function acts(doc) {
  const btns = doc.querySelectorAll('.ui-sheet .ui-confirm__actions .ui-btn');
  return { cancel: btns[0], ok: btns[1] };
}
// Did the promise settle yet, and with what? (Without awaiting forever.)
async function peek(p) {
  const PENDING = Symbol('pending');
  const v = await Promise.race([p, Promise.resolve(PENDING)]);
  return v === PENDING ? 'pending' : v;
}
function pointer(win, target, type) {
  // jsdom 29.1.1 has PointerEvent; a plain Event with pointerId is the fallback shape.
  const E = win.PointerEvent || win.Event;
  const e = new E(type, { bubbles: true, cancelable: true, pointerId: 1 });
  target.dispatchEvent(e);
  return e;
}
// A pointer click as a browser delivers it: a MouseEvent whose detail is the click count.
function tap(win, target, detail) {
  const e = new win.MouseEvent('click', { bubbles: true, cancelable: true, detail: detail || 1 });
  target.dispatchEvent(e);
  return e;
}
function key(win, target, k, repeat) {
  const e = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, repeat: !!repeat });
  target.dispatchEvent(e);
  return e;
}

test('the guard window is 450ms', () => {
  assert.strictEqual(GUARD, 450);
});

test('ui.confirm OK: a tap 0/60/180/300/449ms after the dialog opened is IGNORED; the first at >= 450ms confirms, once', async () => {
  const t = clock();
  const { doc, win } = page();
  const p = ui.confirm({ title: 'Delete for good?', confirmLabel: 'Delete', danger: true, doc, win });
  const { ok } = acts(doc);
  let at = 0;
  for (const gap of [0, 60, 180, 300, 449]) {
    t.tick(gap - at); at = gap;
    tap(win, ok, gap === 180 ? 2 : 1); // a double-CLICK's second click carries detail 2
    assert.strictEqual(await peek(p), 'pending', 'a tap ' + gap + 'ms after open must not answer the dialog');
    assert.ok(doc.querySelector('.ui-sheet.is-closing') === null, gap + 'ms: the dialog stays up');
  }
  t.tick(GUARD - at);
  tap(win, ok);
  assert.strictEqual(await p, true, 'a tap at the guard confirms');
  t.tick(400);
  assert.strictEqual(doc.querySelector('.ui-sheet'), null, 'closed');
});

test('ui.confirm Cancel: an early tap is ignored too (the dialog stays, unanswered); a later one resolves false', async () => {
  const t = clock();
  const { doc, win } = page();
  const p = ui.confirm({ title: 'Delete?', doc, win });
  const { cancel } = acts(doc);
  t.tick(120);
  tap(win, cancel);
  assert.strictEqual(await peek(p), 'pending', 'an early Cancel does not answer');
  t.tick(600);
  tap(win, cancel);
  assert.strictEqual(await p, false);
});

test('ui.confirm: a press that STARTED inside the window (a double-tap held down) does not answer when released after it', async () => {
  const t = clock();
  const { doc, win } = page();
  const p = ui.confirm({ title: 'Delete?', danger: true, doc, win });
  const { ok } = acts(doc);
  t.tick(150);
  pointer(win, ok, 'pointerdown');
  t.tick(500); // released at 650ms: the click comes after the window, the press did not
  tap(win, ok);
  assert.strictEqual(await peek(p), 'pending', 'the held second tap is still the double-tap');
  // An engine that reported a tap's click with detail 0 is still refused by its early press.
  pointer(win, ok, 'pointerdown');
  assert.strictEqual(await peek(p), 'pending');
  t.tick(0);
  const q = ui.confirm({ title: 'Again?', danger: true, doc, win });
  const again = Array.from(doc.querySelectorAll('.ui-sheet:not(.is-closing) .ui-confirm__actions .ui-btn'))[3];
  t.tick(100);
  pointer(win, again, 'pointerdown');
  again.click(); // detail 0, early press
  assert.strictEqual(await peek(q), 'pending', 'a detail-0 click of an early press does not answer');
  t.tick(600);
  pointer(win, ok, 'pointerdown'); // a fresh press on the first dialog, well after its window
  tap(win, ok);
  assert.strictEqual(await p, true, 'a deliberate tap confirms');
});

test('ui.confirm: a detail-0 click with no early press (a key\'s synthesised click, a script) is not time-gated', async () => {
  clock();
  const { doc, win } = page();
  const p = ui.confirm({ title: 'Go?', doc, win });
  acts(doc).ok.click();
  assert.strictEqual(await p, true);
});

test('ui.confirm keyboard: an early Enter/Space and an auto-repeated Enter are swallowed (no click synthesised); a fresh key press later is not', async () => {
  const t = clock();
  const { doc, win } = page();
  const p = ui.confirm({ title: 'Delete?', danger: true, doc, win });
  const { ok, cancel } = acts(doc);
  t.tick(100);
  assert.strictEqual(key(win, ok, 'Enter').defaultPrevented, true, 'early Enter on OK');
  assert.strictEqual(key(win, ok, ' ').defaultPrevented, true, 'early Space on OK');
  assert.strictEqual(key(win, cancel, 'Enter').defaultPrevented, true, 'early Enter on Cancel');
  t.tick(800);
  assert.strictEqual(key(win, ok, 'Enter', true).defaultPrevented, true, 'a held Enter\'s repeat never answers');
  assert.strictEqual(key(win, ok, 'Tab').defaultPrevented, false, 'other keys pass');
  assert.strictEqual(key(win, ok, 'Enter').defaultPrevented, false, 'a fresh Enter after the window activates');
  ok.click(); // the click a browser synthesises from that Enter
  assert.strictEqual(await p, true);
});

test('ui.confirm on a real engine\'s clock: a high-res event timeStamp is compared with performance.now() at open', async () => {
  clock();
  const { doc, win } = page();
  let now = 5000;
  win.performance.now = () => now;
  const p = ui.confirm({ title: 'Delete?', danger: true, doc, win }); // opened at 5000
  const { ok } = acts(doc);
  function tapAt(ts) {
    const e = new win.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    Object.defineProperty(e, 'timeStamp', { value: ts });
    ok.dispatchEvent(e);
  }
  now = 9000; // a busy main thread dispatches LATE: the tap's own time is what counts
  tapAt(5180);
  assert.strictEqual(await peek(p), 'pending', 'a tap that HAPPENED 180ms after open is ignored even when dispatched late');
  tapAt(5000 + GUARD);
  assert.strictEqual(await p, true);
});

test('ui.sheet: the scrim and Close ignore the rest of the opening tap; later they dismiss', async () => {
  const t = clock();
  const { doc, win } = page();
  const p = ui.confirm({ title: 'Delete?', doc, win });
  t.tick(200);
  tap(win, doc.querySelector('.ui-scrim'));
  tap(win, doc.querySelector('.ui-sheet__close'));
  assert.strictEqual(await peek(p), 'pending', 'early scrim / Close do nothing');
  t.tick(300);
  tap(win, doc.querySelector('.ui-scrim'));
  assert.strictEqual(await p, false, 'a later scrim tap dismisses');
});

test('ui.menu: a row under the finger that opened the menu is not picked by the rest of that tap; a later tap picks it', () => {
  const t = clock();
  const { doc, win } = page();
  const picks = [];
  ui.menu({ title: 'More', items: [{ label: 'Move to Trash', value: 'trash', danger: true }], onSelect: (v) => picks.push(v), doc, win });
  const row = doc.querySelector('.ui-sheet .ui-row');
  t.tick(180);
  tap(win, row);
  assert.deepStrictEqual(picks, [], 'an early tap picks nothing');
  assert.ok(doc.querySelector('.ui-sheet:not(.is-closing)'), 'the menu stays open');
  t.tick(400);
  tap(win, row);
  assert.deepStrictEqual(picks, ['trash']);
});

test('ui.prompt: its OK and Cancel carry the same guard', async () => {
  const t = clock();
  const { doc, win } = page();
  const p = ui.prompt({ title: 'Rename', label: 'Name', value: 'x', doc, win });
  const { ok } = acts(doc);
  t.tick(90);
  tap(win, ok);
  assert.strictEqual(await peek(p), 'pending');
  t.tick(500);
  tap(win, ok);
  assert.strictEqual(await p, 'x');
});

test('ui.prompt field: an auto-repeated Enter does not submit; a fresh Enter does', async () => {
  clock();
  const { doc, win } = page();
  const p = ui.prompt({ title: 'Rename', label: 'Name', value: 'y', doc, win });
  const input = doc.querySelector('.ui-sheet .ui-field__input');
  key(win, input, 'Enter', true);
  assert.strictEqual(await peek(p), 'pending');
  key(win, input, 'Enter');
  assert.strictEqual(await p, 'y');
});

test('ui.sheet re-opened while it animates out restarts the guard window (open() mid-exit)', async () => {
  const t = clock();
  const { doc, win } = page();
  const ctrl = ui.sheet({ variant: 'dialog', title: 'Panel', doc, win });
  ctrl.open();
  t.tick(1000);
  ctrl.close(); // is-closing: the exit animation
  ctrl.open(); // re-opened mid-exit: the same nodes, a fresh window
  assert.ok(ctrl.isOpen());
  t.tick(100);
  tap(win, doc.querySelector('.ui-scrim'));
  assert.ok(ctrl.isOpen(), 'a tap 100ms after the re-open is the rest of the tap that re-opened it');
  t.tick(500);
  tap(win, doc.querySelector('.ui-scrim'));
  assert.strictEqual(ctrl.isOpen(), false, 'a later tap dismisses');
  t.tick(400);
});
