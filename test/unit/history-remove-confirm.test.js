'use strict';

// [UNIT] UI pass sweep S2 (D4.8 F33, LESSONS 9): removing History clears the
// item's resume position and watched mark (DELETE /api/history/:id), and Clear
// all clears every one (DELETE /api/history). Both are destructive, so both go
// through ui.confirm - the v1.64 in-row two-tap arming is retired. This drives
// the REAL history.js view (its init, registered through FileTube.registerView)
// in jsdom with the real ui.js: no request is sent unless the confirm resolves
// true; Cancel / Esc send nothing; a confirmed remove sends exactly one DELETE
// of THAT id.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'history.js'), 'utf8');
const UI_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'ui.js'), 'utf8');
const ICONS_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'icons.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="view-root">
    <button id="history-clear-btn" type="button" hidden>Clear all</button>
    <div id="history-list"></div><div id="history-empty" hidden></div>
    <button id="history-loadmore" type="button" hidden>More</button></div></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/history' });
  const w = dom.window;
  const calls = [];
  w.fetch = (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push({ url: String(url), method });
    if (String(url).indexOf('/api/history?') === 0) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ total: 2, items: [
        { id: 'a1', title: 'One', duration: 60, folderName: 'Ch', lastWatchedAt: new Date().toISOString(), progressPercent: 30 },
        { id: 'b2', title: 'Two', duration: 60, folderName: 'Ch', lastWatchedAt: new Date().toISOString() },
      ] }) });
    }
    if (method === 'DELETE') return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  };
  let initFn = null;
  w.FileTube = { registerView: (name, v) => { if (name === 'history') initFn = v.init; } };
  w.eval(ICONS_SRC);
  w.eval(UI_SRC);
  w.eval(SRC);
  assert.ok(initFn, 'history.js registered its view');
  initFn(w.document.getElementById('view-root'));
  return { dom, w, calls, doc: w.document };
}
const deletes = (calls) => calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
const confirmOpen = (doc) => Array.from(doc.querySelectorAll('.ui-sheet.is-open')).find((s) => s.querySelector('.ui-confirm__actions')) || null;
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));

test('History Remove: asks ui.confirm first; Cancel and Esc send nothing; OK sends exactly one DELETE of THAT row', async () => {
  const { dom, w, calls, doc } = boot();
  try {
    await sleep(50);
    const rows = doc.querySelectorAll('#history-list .ui-row[data-id]');
    assert.strictEqual(rows.length, 2, 'two rows rendered');
    const removeOf = (id) => doc.querySelector(`#history-list .ui-row[data-id="${id}"] .history-remove`);
    click(w, removeOf('b2'));
    await sleep(40);
    let dlg = confirmOpen(doc);
    assert.ok(dlg, 'the confirm opened');
    assert.strictEqual(dlg.querySelector('.ui-sheet__title').textContent, 'Remove from history?');
    assert.strictEqual(deletes(calls).length, 0, 'nothing sent before the answer');
    click(w, dlg.querySelector('.ui-confirm__actions .ui-btn--secondary'));
    await sleep(400);
    assert.strictEqual(deletes(calls).length, 0, 'Cancel sent nothing');
    click(w, removeOf('b2'));
    await sleep(40);
    doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(400);
    assert.strictEqual(deletes(calls).length, 0, 'Esc sent nothing');
    click(w, removeOf('b2'));
    await sleep(40);
    dlg = confirmOpen(doc);
    click(w, dlg.querySelector('.ui-confirm__actions .ui-btn--primary'));
    await sleep(50);
    assert.deepStrictEqual(deletes(calls), ['/api/history/b2'], 'exactly one DELETE, of that row');
    assert.strictEqual(doc.querySelector('#history-list .ui-row[data-id="b2"]'), null, 'the row left after the server answered');
  } finally { dom.window.close(); }
});

test('History Clear all: asks ui.confirm first; only a yes clears', async () => {
  const { dom, w, calls, doc } = boot();
  try {
    await sleep(50);
    const clear = doc.getElementById('history-clear-btn');
    assert.strictEqual(clear.hidden, false, 'Clear all shows with history present');
    click(w, clear);
    await sleep(40);
    let dlg = confirmOpen(doc);
    assert.strictEqual(dlg.querySelector('.ui-sheet__title').textContent, 'Clear all watch history?');
    click(w, dlg.querySelector('.ui-confirm__actions .ui-btn--secondary'));
    await sleep(400);
    assert.strictEqual(deletes(calls).length, 0, 'Cancel sent nothing');
    click(w, clear);
    await sleep(40);
    dlg = confirmOpen(doc);
    click(w, dlg.querySelector('.ui-confirm__actions .ui-btn--primary'));
    await sleep(50);
    assert.deepStrictEqual(deletes(calls), ['/api/history']);
  } finally { dom.window.close(); }
});
