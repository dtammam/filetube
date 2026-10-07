'use strict';

// [UNIT] v1.372.0 (Dean, 2026-10-07: "If you right-click or go to Move to Trash? and press Enter, it brings up the
// right-click menu"). Reproduced in Chromium with real keys (plan section 7): a menu item opened its confirm, the confirm
// took focus, then the MENU's exit finished ~280 ms later and handed focus back to the menu's opener - the card's button
// BEHIND the confirm - so Enter pressed that button and re-opened the menu; the confirm was never answered. The fix, in
// ui.js: (1) a closing sheet gives focus back only if focus is still its own; (2) a sheet opened from a CLOSING sheet
// inherits that sheet's opener. Enter itself still does nothing on a confirm (F33, kept by Dean's ruling 2026-10-07:
// "the keyboard cannot confirm by accident"; test/unit/subs-destructive-confirm.test.js). These run the REAL ui.js on a
// jsdom page with node:test's mocked clock.

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const ui = require('../../public/js/ui.js');
const BL = require('../../public/js/body-scroll-lock.js');

const GUARD = ui.ACTIVATION_GUARD_MS;
const T0 = 1_750_000_000_000;

function page() {
  const dom = new JSDOM('<!DOCTYPE html><body><button id="opener">More</button><button id="other">Other</button></body>');
  const win = dom.window;
  win.FileTubeBodyLock = BL;
  win.scrollTo = () => {};
  win.matchMedia = (q) => ({ matches: false, media: q });
  return { win, doc: win.document };
}
afterEach(() => { mock.timers.reset(); });
const clock = () => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 }); return mock.timers; };
async function peek(p) {
  const PENDING = Symbol('pending');
  const v = await Promise.race([p, Promise.resolve(PENDING)]);
  return v === PENDING ? 'pending' : v;
}
function key(win, target, k, repeat) {
  const e = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, repeat: !!repeat });
  target.dispatchEvent(e);
  return e;
}
const liveDialog = (doc) => doc.querySelector('.ui-sheet--dialog:not(.is-closing)');

// The card menu's shape: the opener focused, a menu whose item opens a confirm (main.js's Move to Trash).
function menuThenConfirm(win, doc) {
  const opener = doc.getElementById('opener');
  opener.focus();
  let answer;
  ui.menu({ anchor: opener, items: [{ label: 'Move to Trash', value: 'trash', onSelect: () => {
    answer = ui.confirm({ title: 'Move to Trash?', body: 'x', confirmLabel: 'Move to Trash', danger: true, doc, win });
  } }], doc, win });
  const item = [...doc.querySelectorAll('.ui-sheet button, .ui-sheet .ui-row')].find((b) => /Move to Trash/.test(b.textContent));
  item.focus();
  item.click(); // a detail-0 click (not time-gated): the menu closes, the confirm opens
  return { opener, answer: () => answer };
}

test('the menu\'s exit never takes focus back from the confirm it opened (the bug: focus went to the opener behind it)', () => {
  const t = clock();
  const { win, doc } = page();
  const { opener } = menuThenConfirm(win, doc);
  assert.ok(liveDialog(doc), 'the confirm is up');
  t.tick(2000); // the menu's exit finishes (its fallback timer; jsdom fires no transitionend)
  assert.ok(liveDialog(doc).contains(doc.activeElement), 'focus is still in the confirm');
  assert.notStrictEqual(doc.activeElement, opener, 'not on the button behind it');
});

test('Enter on the confirm reaches nothing behind it; when the confirm closes, focus goes back to the MENU\'s opener (inherited)', async () => {
  const t = clock();
  const { win, doc } = page();
  const { opener, answer } = menuThenConfirm(win, doc);
  t.tick(2000);
  const enter = key(win, liveDialog(doc), 'Enter');
  assert.strictEqual(await peek(answer()), 'pending', 'Enter on the dialog answers nothing (F33)');
  assert.strictEqual(enter.defaultPrevented, false);
  doc.querySelectorAll('.ui-sheet .ui-confirm__actions .ui-btn')[1].click(); // OK
  assert.strictEqual(await peek(answer()), true);
  t.tick(2000); // the confirm's exit finishes
  assert.strictEqual(doc.activeElement, opener);
});

test('a sheet that still holds focus when it finishes closing gives it back to its opener (unchanged)', () => {
  const t = clock();
  const { win, doc } = page();
  const opener = doc.getElementById('opener');
  opener.focus();
  const s = ui.sheet({ title: 'A sheet', content: doc.createElement('p'), doc, win });
  s.open();
  assert.ok(s.el.contains(doc.activeElement), 'focus moved in');
  s.close();
  t.tick(2000);
  assert.strictEqual(doc.activeElement, opener);
});

test('a sheet whose focus the user moved elsewhere (another live control) does not yank it back on finish', () => {
  const t = clock();
  const { win, doc } = page();
  const opener = doc.getElementById('opener');
  opener.focus();
  const s = ui.sheet({ title: 'A sheet', content: doc.createElement('p'), doc, win });
  s.open();
  s.close();
  doc.getElementById('other').focus(); // focus went somewhere live during the exit
  t.tick(2000);
  assert.strictEqual(doc.activeElement.id, 'other');
});

test('Esc still cancels a confirm', async () => {
  const t = clock();
  const { win, doc } = page();
  const p = ui.confirm({ title: 'Move to Trash?', body: 'x', doc, win });
  t.tick(GUARD + 10);
  key(win, liveDialog(doc), 'Escape');
  assert.strictEqual(await peek(p), false);
});

// gate r1 (adversary W5): the COMMON case - a sheet closed by its scrim or Close leaves focus on <body> (the clicked
// control left the page); the hand-back must still run then.
test('focus on <body> when a sheet finishes closing still goes back to the opener (the scrim / Close path)', () => {
  const t = clock();
  const { win, doc } = page();
  const opener = doc.getElementById('opener');
  opener.focus();
  const s = ui.sheet({ title: 'A sheet', content: doc.createElement('p'), doc, win });
  s.open();
  s.close();
  doc.activeElement.blur(); // what a click on the scrim leaves behind
  assert.strictEqual(doc.activeElement, doc.body);
  t.tick(2000);
  assert.strictEqual(doc.activeElement, opener);
});

test('ui.prompt takes the caller\'s signal: an abort closes it and answers null (gate r1 adversary W4)', async () => {
  const { win, doc } = page();
  const ac = new win.AbortController();
  const p = ui.prompt({ title: 'Song name', label: 'Song name', value: 'x', signal: ac.signal, doc, win });
  assert.ok(liveDialog(doc), 'the dialog is up');
  ac.abort();
  assert.strictEqual(await peek(p), null);
  assert.strictEqual(liveDialog(doc), null, 'no live dialog left over the next page');
});

test('gate r2: ui.prompt with an ALREADY aborted signal answers null at once and opens nothing (as ui.confirm answers false)', async () => {
  const { win, doc } = page();
  const ac = new win.AbortController();
  ac.abort();
  const p = ui.prompt({ title: 'Song name', label: 'Song name', signal: ac.signal, doc, win });
  assert.strictEqual(await peek(p), null);
  assert.strictEqual(liveDialog(doc), null);
});
