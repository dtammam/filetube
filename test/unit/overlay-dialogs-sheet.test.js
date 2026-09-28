'use strict';

// [UNIT] UI professionalism pass, sweep S9 (plan D4.6): the chapters editor (common.js
// showChaptersEditor) on the ONE overlay primitive, driven in jsdom with the real ui.js.
// Bound here:
//   - it opens as a ui.sheet dialog titled "Edit chapters", the field its content, one scrim;
//   - Esc, the scrim and Close each dismiss it while idle;
//   - while a save is IN FLIGHT none of the three dismisses it (the v1.26.2 busy guard,
//     kept - guardSheetDismiss), and a double tap on Save sends ONE request;
//   - v1.289 drag safety holds by construction: a drag that starts in the textarea and
//     releases outside clicks the common ancestor, never the scrim;
//   - guardSheetDismiss's Esc belongs to the TOP sheet only.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
let dom = null;
let saved = null;

function boot(fetchImpl) {
  saved = { window: global.window, document: global.document, fetch: global.fetch };
  delete global.window; delete global.document;
  delete require.cache[COMMON];
  const common = require(COMMON);
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.fetch = fetchImpl || (() => new Promise(() => {}));
  return common;
}
async function drain() {
  for (let i = 0; i < 60 && dom.window.document.querySelector('.ui-sheet, .ui-scrim'); i++) await new Promise((r) => setTimeout(r, 20));
}
afterEach(async () => {
  if (dom) await drain();
  if (dom) dom.window.close();
  dom = null;
  delete require.cache[COMMON];
  if (saved) Object.assign(global, saved);
  saved = null;
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const esc = () => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const dismiss = (h, how) => { if (how === 'esc') esc(); else if (how === 'scrim') click(h.sheet.scrim); else click(h.sheet.el.querySelector('.ui-sheet__close')); };

test('the chapters editor opens as a ui.sheet dialog titled "Edit chapters" with the field as its content', () => {
  const common = boot();
  const h = common.showChaptersEditor('vid1', '0:00 A\n1:00 B', () => {}, dom.window.document);
  const d = dom.window.document;
  assert.strictEqual(d.querySelectorAll('.ui-sheet').length, 1);
  assert.strictEqual(d.querySelectorAll('.ui-scrim').length, 1, 'one scrim');
  assert.ok(h.sheet.el.classList.contains('ui-sheet--dialog'));
  assert.strictEqual(h.sheet.el.querySelector('.ui-sheet__title').textContent, 'Edit chapters');
  assert.ok(h.sheet.body.contains(h.textarea), 'the textarea is the sheet content');
  assert.strictEqual(h.textarea.value, '0:00 A\n1:00 B');
  assert.strictEqual(h.backdrop, h.sheet.scrim);
  assert.strictEqual(d.querySelector('.modal-backdrop'), null, 'no bespoke backdrop');
  for (const b of [h.cancelBtn, h.saveBtn, h.snapBtn]) assert.ok(b.classList.contains('ui-btn'), 'every action is a ui-btn');
  assert.ok(h.saveBtn.classList.contains('ui-btn--primary'), 'Save is the one primary');
});

for (const how of ['esc', 'scrim', 'close']) {
  test(`idle: ${how} dismisses the editor`, async () => {
    const common = boot();
    const h = common.showChaptersEditor('vid1', '0:00 A', () => {}, dom.window.document);
    dismiss(h, how);
    assert.strictEqual(h.sheet.isOpen(), false, how + ' closed it');
    await drain();
    assert.strictEqual(dom.window.document.querySelector('.ui-sheet'), null);
  });

  test(`busy: ${how} does NOT dismiss while a save is in flight; the save then closes it`, async () => {
    const posts = [];
    let answer;
    const common = boot((url, init) => { posts.push([url, init && init.method]); return new Promise((r) => { answer = r; }); });
    let saved2 = 0;
    const h = common.showChaptersEditor('vid1', '0:00 A', () => { saved2 += 1; }, dom.window.document, { version: 'v7' });
    click(h.saveBtn);
    click(h.saveBtn); // a double tap sends ONE request
    assert.strictEqual(posts.length, 1, 'one save request for a double tap');
    assert.deepStrictEqual(posts[0], ['/api/videos/vid1/chapters', 'POST']);
    dismiss(h, how);
    assert.strictEqual(h.sheet.isOpen(), true, how + ' is refused while saving');
    assert.ok(!h.sheet.el.classList.contains('is-closing'));
    answer({ ok: true, json: async () => ({ chapters: [] }) });
    await flush(); await flush(); await flush();
    assert.strictEqual(saved2, 1, 'onSaved once');
    assert.strictEqual(h.sheet.isOpen(), false, 'a successful save closes the editor');
  });
}

test('a failed save re-arms the dismissals (not busy any more)', async () => {
  let answer;
  const common = boot(() => new Promise((r) => { answer = r; }));
  const h = common.showChaptersEditor('vid1', '0:00 A', () => {}, dom.window.document);
  click(h.saveBtn);
  answer({ ok: false, json: async () => ({ error: 'nope' }) });
  await flush(); await flush(); await flush();
  assert.strictEqual(h.statusEl.textContent, 'nope');
  assert.strictEqual(h.sheet.isOpen(), true);
  esc();
  assert.strictEqual(h.sheet.isOpen(), false, 'Esc works again once the save failed');
});

test('v1.289 drag safety by construction: the scrim is a sibling of the sheet, so a drag from the field released outside never closes it', () => {
  const common = boot();
  const h = common.showChaptersEditor('vid1', '0:00 A', () => {}, dom.window.document);
  assert.strictEqual(h.sheet.scrim.contains(h.textarea), false, 'the field is not inside the scrim');
  assert.strictEqual(h.sheet.scrim.parentElement, h.sheet.el.parentElement, 'scrim and sheet are siblings');
  h.textarea.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
  click(dom.window.document.body); // the browser clicks the common ancestor of press and release
  click(h.textarea);
  assert.strictEqual(h.sheet.isOpen(), true);
});

test('guardSheetDismiss: Esc belongs to the TOP sheet - a dialog stacked over the editor takes it, the editor stays', () => {
  const common = boot();
  const h = common.showChaptersEditor('vid1', '0:00 A', () => {}, dom.window.document);
  const ui = require('../../public/js/ui.js');
  const top = ui.sheet({ variant: 'dialog', title: 'Top', doc: dom.window.document, win: dom.window }).open();
  esc();
  assert.strictEqual(top.isOpen(), false, 'the top sheet closed');
  assert.strictEqual(h.sheet.isOpen(), true, 'the editor under it did not');
  esc();
  assert.strictEqual(h.sheet.isOpen(), false, 'the next Esc closes the editor');
});

test('guardSheetDismiss: once the editor closed, its listeners are gone (a later Esc/scrim on another sheet is untouched)', async () => {
  const common = boot();
  const h = common.showChaptersEditor('vid1', '0:00 A', () => {}, dom.window.document);
  click(h.cancelBtn);
  await drain();
  const ui = require('../../public/js/ui.js');
  const other = ui.sheet({ variant: 'dialog', title: 'Other', doc: dom.window.document, win: dom.window }).open();
  esc();
  assert.strictEqual(other.isOpen(), false, 'the other sheet still answers its own Esc');
});
