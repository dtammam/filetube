'use strict';

// [UNIT] v1.17.0 FR-6, T5 -- stuck one-off download modal teardown.
//
// Root cause (confirmed in docs/exec-plans/completed/2026-07-06-v1.17-polish.md's
// Design -> FR-6): `.oneoff-modal-backdrop` set `display: flex` with NO
// `[hidden]` override, so `backdrop.hidden = true` (the entire teardown
// `closeModal` used to do) never actually hid the full-viewport overlay. It
// stayed painted and ate every touch: the page read dimmed and dead after
// tapping away without submitting a URL.
//
// Sweep S9: the dialog is a ui.sheet now (bottom sheet on a phone, dialog on
// desktop). The class of bug is the same - an overlay that survives its
// dismissal - so this file still drives the REAL
// `injectOneOffDownloadButtonIfEnabled` end-to-end (now against jsdom and the
// real ui.js) and binds that EVERY way out (the scrim, Close, Esc) removes the
// scrim and the sheet from the document, that a reopen builds a fresh sheet,
// and that a click inside the form never closes it.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
let dom = null;
let saved = null;

function boot() {
  saved = { window: global.window, document: global.document, fetch: global.fetch };
  delete global.window; delete global.document;
  delete require.cache[COMMON];
  const common = require(COMMON); // no document at require: boot skipped
  dom = new JSDOM('<!doctype html><html><body><header><div class="header-right"></div></header></body></html>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Boots the module-enabled injection and opens the dialog from the header button.
async function bootAndOpen() {
  const common = boot();
  common.injectOneOffDownloadButtonIfEnabled();
  await flush(); await flush();
  const headerBtn = dom.window.document.getElementById('ytdlp-oneoff-btn');
  assert.ok(headerBtn, 'expected the header button to be injected');
  headerBtn.click();
  const d = dom.window.document;
  const sheet = d.querySelector('.ui-sheet');
  assert.ok(sheet, 'the dialog opened as a ui.sheet');
  assert.strictEqual(sheet.querySelector('.ui-sheet__title').textContent, 'One-off download');
  assert.ok(sheet.querySelector('.ui-sheet__body > .oneoff-form input.ui-field__input'), 'the form is its content');
  assert.strictEqual(d.querySelectorAll('.ui-scrim').length, 1, 'ONE scrim');
  return { headerBtn, sheet, scrim: d.querySelector('.ui-scrim') };
}

function assertGone(why) {
  const d = dom.window.document;
  assert.strictEqual(d.querySelector('.ui-sheet'), null, 'no sheet left in the document: ' + why);
  assert.strictEqual(d.querySelector('.ui-scrim'), null, 'no scrim (the click-eater) left in the document: ' + why);
}

test('a tap on the scrim WITHOUT submitting a URL fully tears down the dialog: the scrim and the sheet leave the document', async () => {
  const { sheet, scrim } = await bootAndOpen();
  scrim.click();
  assert.ok(sheet.classList.contains('is-closing'), 'the dismissal started at once');
  await drain();
  assertGone('scrim tap');
});

test('the Close button hits the SAME teardown as a scrim tap', async () => {
  const { sheet } = await bootAndOpen();
  const closeBtn = sheet.querySelector('.ui-sheet__close');
  assert.ok(closeBtn && /\bui-btn--icon\b/.test(closeBtn.className), 'the sheet\'s one icon Close');
  closeBtn.click();
  await drain();
  assertGone('Close');
});

test('Esc fully tears down an OPEN dialog the same way', async () => {
  await bootAndOpen();
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await drain();
  assertGone('Esc');
});

test('Esc is an inert no-op once the dialog is already closed (no dangling reference/duplicate teardown)', async () => {
  const { scrim } = await bootAndOpen();
  scrim.click();
  await drain();
  assertGone('scrim tap');
  assert.doesNotThrow(() => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assertGone('a stray Esc after the close');
});

test('reopening after a teardown rebuilds a FRESH dialog (a new node), not a reference to the torn-down one', async () => {
  const { headerBtn, sheet: first, scrim } = await bootAndOpen();
  scrim.click();
  await drain();
  headerBtn.click(); // reopen
  const second = dom.window.document.querySelector('.ui-sheet');
  assert.ok(second, 'a fresh dialog opened');
  assert.notStrictEqual(second, first, 'reopen must rebuild fresh, not reuse the torn-down node');
  assert.strictEqual(dom.window.document.querySelectorAll('.ui-scrim').length, 1, 'one scrim, never two');
});

test('a click inside the form (and a drag from a field to outside) does NOT tear it down', async () => {
  const { sheet } = await bootAndOpen();
  const field = sheet.querySelector('.oneoff-form input');
  field.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  sheet.querySelector('.oneoff-form').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  // v1.289 by construction: a drag from the field released outside clicks the common
  // ancestor (body) - the scrim is a sibling of the sheet, never its ancestor.
  field.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
  dom.window.document.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.ok(!sheet.classList.contains('is-closing') && sheet.isConnected, 'still open');
});
