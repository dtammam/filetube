'use strict';

// Sweep S8: drive the REAL ui.js confirm / prompt dialogs in a jsdom test, the way a user
// answers them. `loadUi()` evaluates ui.js against the CURRENT global window (it binds
// window.ui at load), so call it after the test sets global.window / global.document.
//
//   const dlg = openDialog(document);        // the newest open ui.sheet dialog (or throws)
//   answer(document, 'ok' | 'cancel' | 'esc' | 'scrim' | 'close');
//   await drainSheets(window);               // let closing sheets finish before teardown

const assert = require('node:assert');

const uiPath = require.resolve('../../public/js/ui.js');

function loadUi() {
  delete require.cache[uiPath];
  return require(uiPath);
}

function dialogs(doc) {
  return Array.from(doc.querySelectorAll('.ui-sheet--dialog'));
}

// The newest dialog that is still OPEN (a closing one keeps its node until its timer fires).
function openDialog(doc) {
  const open = dialogs(doc).filter((d) => !d.hasAttribute('data-s8-answered'));
  assert.ok(open.length > 0, 'a ui.confirm / ui.prompt dialog is open');
  return open[open.length - 1];
}

function parts(dlg) {
  const btns = dlg.querySelectorAll('.ui-confirm__actions .ui-btn');
  return {
    dlg,
    cancel: btns[0],
    ok: btns[1],
    input: dlg.querySelector('.ui-field__input'),
    reveal: dlg.querySelector('.ui-field__reveal'),
    close: dlg.querySelector('.ui-sheet__close'),
    title: (dlg.querySelector('.ui-sheet__title') || { textContent: '' }).textContent,
    text: dlg.textContent,
  };
}

// Answer the newest open dialog. Every way out but 'ok' is a dismissal.
function answer(doc, how) {
  const dlg = openDialog(doc);
  const p = parts(dlg);
  dlg.setAttribute('data-s8-answered', how);
  const win = doc.defaultView;
  if (how === 'ok') p.ok.click();
  else if (how === 'cancel') p.cancel.click();
  else if (how === 'close') p.close.click();
  else if (how === 'esc') doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  else if (how === 'scrim') {
    const scrims = doc.querySelectorAll('.ui-scrim');
    scrims[scrims.length - 1].click();
  } else throw new Error('answer: unknown way ' + how);
  return p;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n) { for (let i = 0; i < (n || 8); i++) await tick(); }

// A closing ui.sheet finishes on a fallback timer (~320ms in jsdom, no transitionend).
async function drainSheets(win) {
  for (let i = 0; i < 60 && win.document.querySelector('.ui-sheet'); i++) await new Promise((r) => setTimeout(r, 20));
}

module.exports = { loadUi, openDialog, parts, answer, settle, drainSheets, DISMISSALS: ['cancel', 'esc', 'scrim', 'close'] };
