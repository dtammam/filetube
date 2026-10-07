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
  assert.strictEqual(doc.querySelectorAll('.ui-sheet:not(.is-closing)').length, 1, 'and opens no menu: only the confirm is up');
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
