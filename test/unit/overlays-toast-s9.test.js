'use strict';

// [UNIT] Sweep S9 (F56, D4.7): every toast rides ui.toast's ONE queue. showToast (common.js)
// stays the shim its 116 callers use - plain globals in every view, window.showToast in
// others - and draws ui.toast: one toast visible at a time, the rest wait their turn, the
// optional action a sentence-case ui-btn, a kind's icon so colour is never the only signal,
// text by textContent. Driven for real: common.js + ui.js in jsdom, the queue on the mock
// clock.

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
const UI = require.resolve('../../public/js/ui.js');

let dom;
function boot({ withUi = true } = {}) {
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  const common = require(COMMON); // no document at require time: the boot block is skipped
  dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  if (withUi) {
    delete require.cache[UI];
    dom.window.ui = require(UI);
  }
  return common;
}
afterEach(() => {
  mock.timers.reset();
  if (dom) dom.window.close();
  dom = null;
  delete global.window; delete global.document;
  delete require.cache[COMMON];
});

const visible = () => Array.from(dom.window.document.querySelectorAll('.ui-toast-host .ui-toast'));
const texts = () => visible().map((t) => t.querySelector('.ui-toast__text').textContent);

test('three showToast calls: ONE toast on screen at a time, each waits for the one before (F56)', () => {
  const t = mock.timers; t.enable({ apis: ['setTimeout'] });
  const { showToast } = boot();
  showToast('Added to queue');
  showToast('Saved');
  showToast('Check failed');
  assert.deepStrictEqual(texts(), ['Added to queue'], 'only the first is in the host');
  assert.strictEqual(dom.window.document.querySelectorAll('.ui-toast-host').length, 1, 'one host');
  t.tick(2500); t.tick(220);
  assert.deepStrictEqual(texts(), ['Saved'], 'the second only after the first has gone');
  t.tick(2500); t.tick(220);
  assert.deepStrictEqual(texts(), ['Check failed']);
  t.tick(2500); t.tick(220);
  assert.deepStrictEqual(texts(), [], 'the queue drains');
  assert.strictEqual(dom.window.document.querySelectorAll('.toast').length, 0, 'no bespoke .toast node is ever made');
});

test('the action: a sentence-case plain ui-btn; one tap runs it ONCE and dismisses; it widens the window to 5s', () => {
  const t = mock.timers; t.enable({ apis: ['setTimeout'] });
  const { showToast } = boot();
  let undos = 0;
  showToast('Playing next', { label: 'Undo', onAction: () => { undos++; } });
  const btn = dom.window.document.querySelector('.ui-toast .ui-toast__action');
  assert.ok(btn && btn.classList.contains('ui-btn') && btn.classList.contains('ui-btn--plain'), 'a plain ui-btn');
  assert.strictEqual(btn.textContent, 'Undo', 'the label as given: no caps transform in the DOM');
  t.tick(2600);
  assert.strictEqual(visible().length, 1, 'still up past 2.5s: an action gets 5s');
  btn.click();
  btn.click();
  assert.strictEqual(undos, 1, 'the action runs once');
  t.tick(300);
  assert.strictEqual(visible().length, 0, 'the tap dismissed it');
});

test('a malformed action is ignored (no button), the message is text, never markup', () => {
  const { showToast } = boot();
  showToast('<img src=x onerror=alert(1)>', { label: 'Undo' });
  const toast = visible()[0];
  assert.strictEqual(toast.querySelector('img'), null, 'no element from the message');
  assert.strictEqual(toast.querySelector('.ui-toast__text').textContent, '<img src=x onerror=alert(1)>');
  assert.strictEqual(toast.querySelector('.ui-toast__action'), null, 'no onAction -> no button');
});

test('kind: success / error add the kind class AND its icon (colour is never the only signal); anything else is neutral', () => {
  const t = mock.timers; t.enable({ apis: ['setTimeout'] });
  const { showToast } = boot();
  showToast('Copied', null, { kind: 'success' });
  let el = visible()[0];
  assert.ok(el.classList.contains('ui-toast--success'));
  assert.strictEqual(el.querySelector('use').getAttribute('href'), '#i-check');
  t.tick(2500); t.tick(220);
  showToast('Failed', null, { kind: 'error' });
  el = visible()[0];
  assert.ok(el.classList.contains('ui-toast--error'));
  assert.strictEqual(el.querySelector('use').getAttribute('href'), '#i-warning');
  t.tick(2500); t.tick(220);
  showToast('Plain', null, { kind: 'loud' });
  el = visible()[0];
  assert.ok(el.classList.contains('ui-toast--neutral'));
  assert.strictEqual(el.querySelector('svg'), null, 'neutral has no icon');
});

test('the shim returns ui.toast\'s handle (dismiss works), and is a quiet no-op (null) with no ui.js on the page', () => {
  const t = mock.timers; t.enable({ apis: ['setTimeout'] });
  let { showToast } = boot();
  const h = showToast('One');
  assert.strictEqual(typeof h.dismiss, 'function');
  h.dismiss();
  t.tick(300);
  assert.strictEqual(visible().length, 0);
  dom.window.close();
  ({ showToast } = boot({ withUi: false }));
  assert.strictEqual(showToast('x'), null);
  assert.strictEqual(dom.window.document.querySelectorAll('.ui-toast, .toast').length, 0);
});
