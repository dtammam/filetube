'use strict';

// [UNIT] v1.342 Clean up page (FULL GATE: it moves files to Trash). Drives the REAL cleanup.js view
// in jsdom with the real ui.js. What is bound: nothing is pre-selected; no request leaves before the
// ui.confirm says yes; Cancel/Esc send nothing; a yes sends ONLY `DELETE /api/videos/<id>` for the
// ids the user ticked (no body, no query, no criteria); a shortlist that changed under the user
// aborts with nothing deleted; a double tap asks once; the pure helpers hold their contracts.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', 'cleanup.js'), 'utf8');
const UI_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', 'ui.js'), 'utf8');
const ICONS_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', 'icons.js'), 'utf8');
const helpers = require('../../public/js/cleanup.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const item = (id, size, extra) => Object.assign({ id, title: 'T-' + id, size, reason: 'r', addedAt: '2020-01-01T00:00:00.000Z' }, extra || {});
const SHORTLIST = () => ({
  days: 30,
  watched: [item('w1', 1000, { lastPlayedAt: '2020-02-01T00:00:00.000Z' })],
  stale_subscriptions: [],
  duplicates: [item('d1', 500, { keepId: 'k1', keepTitle: 'Original' })],
  largest: [item('l1', 4000)],
});

function boot({ fresh } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="view-root">
    <span id="cleanup-summary"></span>
    <button id="cleanup-trash-btn" type="button" disabled>Move to Trash</button>
    <div id="cleanup-days"></div><div id="cleanup-groups"></div></div></body></html>`,
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/cleanup' });
  const w = dom.window;
  const calls = [];
  let shortlists = 0;
  w.fetch = (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push({ url: String(url), method, body: init && init.body });
    if (String(url).indexOf('/api/cleanup/suggestions') === 0) {
      shortlists += 1;
      const body = shortlists > 1 && fresh ? fresh() : SHORTLIST();
      return Promise.resolve({ ok: true, status: 200, json: async () => body });
    }
    if (method === 'DELETE') return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  };
  let initFn = null;
  w.FileTube = { registerView: (name, v) => { if (name === 'cleanup') initFn = v.init; } };
  w.eval(ICONS_SRC);
  w.eval(UI_SRC);
  w.eval(SRC);
  assert.ok(initFn, 'cleanup.js registered its view');
  initFn(w.document.getElementById('view-root'));
  return { dom, w, calls, doc: w.document };
}
const deletes = (calls) => calls.filter((c) => c.method === 'DELETE');
const confirmOpen = (doc) => Array.from(doc.querySelectorAll('.ui-sheet.is-open')).find((s) => s.querySelector('.ui-confirm__actions')) || null;
const click = (w, el) => {
  const e = new w.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  if (el.closest('.ui-sheet, .ui-scrim')) Object.defineProperty(e, 'timeStamp', { value: Date.now() + 1000 });
  return el.dispatchEvent(e);
};
const tick = (doc, w, id) => click(w, doc.querySelector(`#cleanup-groups .ui-row[data-id="${id}"] .ui-switch`));

test('renders the four kinds of suggestion with nothing pre-selected and the button disabled', async () => {
  const { dom, doc } = boot();
  try {
    await sleep(50);
    assert.strictEqual(doc.querySelectorAll('#cleanup-groups .ui-row[data-id]').length, 3);
    assert.strictEqual(doc.querySelectorAll('#cleanup-groups .ui-switch[aria-checked="true"]').length, 0, 'nothing pre-selected');
    assert.strictEqual(doc.getElementById('cleanup-trash-btn').disabled, true);
    assert.ok(/keeping "Original"/.test(doc.querySelector('[data-id="d1"]').textContent), 'a duplicate names the copy that stays');
  } finally { dom.window.close(); }
});

test('Move to Trash: the confirm names count + size; Cancel and Esc send nothing; OK sends only DELETE /api/videos/<id> for the ticked ids', async () => {
  const { dom, w, calls, doc } = boot();
  try {
    await sleep(50);
    const btn = doc.getElementById('cleanup-trash-btn');
    tick(doc, w, 'w1'); tick(doc, w, 'l1');
    assert.strictEqual(btn.disabled, false);
    assert.ok(/2 items - 4\.9 KB/.test(doc.getElementById('cleanup-summary').textContent), doc.getElementById('cleanup-summary').textContent);
    click(w, btn);
    await sleep(40);
    let dlg = confirmOpen(doc);
    assert.ok(dlg, 'the confirm opened');
    assert.ok(/Move 2 items \(4\.9 KB\) to Trash\?/.test(dlg.textContent));
    assert.strictEqual(deletes(calls).length, 0, 'nothing sent before the answer');
    click(w, dlg.querySelector('.ui-confirm__actions .ui-btn--secondary'));
    await sleep(400);
    assert.strictEqual(deletes(calls).length, 0, 'Cancel sent nothing');
    click(w, btn);
    await sleep(40);
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(400);
    assert.strictEqual(deletes(calls).length, 0, 'Esc sent nothing');
    click(w, btn);
    await sleep(40);
    dlg = confirmOpen(doc);
    click(w, dlg.querySelector('.ui-confirm__actions .ui-btn--primary'));
    await sleep(150);
    assert.deepStrictEqual(deletes(calls).map((c) => c.url), ['/api/videos/w1', '/api/videos/l1']);
    for (const c of deletes(calls)) assert.strictEqual(c.body, undefined, 'no body: ids in the path, never criteria');
    assert.strictEqual(doc.querySelector('[data-id="w1"]'), null, 'a moved row leaves');
    assert.ok(doc.querySelector('[data-id="d1"]'), 'an unticked row stays');
  } finally { dom.window.close(); }
});

test('a shortlist that changed under the user deletes NOTHING (the ticked id dropped off the fresh list)', async () => {
  const { dom, w, calls, doc } = boot({ fresh: () => Object.assign(SHORTLIST(), { largest: [] }) });
  try {
    await sleep(50);
    tick(doc, w, 'w1'); tick(doc, w, 'l1');
    click(w, doc.getElementById('cleanup-trash-btn'));
    await sleep(40);
    click(w, confirmOpen(doc).querySelector('.ui-confirm__actions .ui-btn--primary'));
    await sleep(150);
    assert.strictEqual(deletes(calls).length, 0, 'not even the still-valid id was sent');
    assert.strictEqual(doc.querySelector('[data-id="l1"]'), null, 'the list re-rendered from the fresh answer');
  } finally { dom.window.close(); }
});

test('a double tap on Move to Trash opens ONE confirm', async () => {
  const { dom, w, doc } = boot();
  try {
    await sleep(50);
    tick(doc, w, 'w1');
    const btn = doc.getElementById('cleanup-trash-btn');
    click(w, btn); click(w, btn);
    await sleep(60);
    assert.strictEqual(doc.querySelectorAll('.ui-sheet--dialog').length, 1);
  } finally { dom.window.close(); }
});

test('helpers: byte labels, days choices, still-suggested, the delete runner stops on 403', async () => {
  assert.strictEqual(helpers.cleanupFormatBytes(0), '0 B');
  assert.strictEqual(helpers.cleanupFormatBytes(1536), '1.5 KB');
  assert.strictEqual(helpers.cleanupNormalizeDays('90'), 90);
  assert.strictEqual(helpers.cleanupNormalizeDays('45'), 30);
  assert.strictEqual(helpers.cleanupNormalizeDays(null), 30);
  const s = helpers.cleanupStillSuggested(['w1', 'gone'], SHORTLIST());
  assert.deepStrictEqual(s, { keep: ['w1'], dropped: 1 });
  const moved = helpers.cleanupStillSuggested(['d1'], { duplicates: [{ id: 'd1', reason: 'r', keepId: 'k2' }] },
    { d1: { id: 'd1', reason: 'r', keepId: 'k1' } });
  assert.deepStrictEqual(moved, { keep: [], dropped: 1 }, 'a changed keeper is a different decision');
  const urls = [];
  await helpers.cleanupRunDeletes(['a/b?c'], (url) => { urls.push(url); return Promise.resolve({ ok: true, status: 200 }); });
  assert.deepStrictEqual(urls, ['/api/videos/a%2Fb%3Fc'], 'ids are encoded, never spliced into the path');
  const seen = [];
  const statuses = { a: 200, b: 404, c: 403, d: 200 };
  const res = await helpers.cleanupRunDeletes(['a', 'b', 'c', 'd'], (url) => {
    const id = url.split('/').pop(); seen.push(id);
    return Promise.resolve({ ok: statuses[id] === 200, status: statuses[id] });
  });
  assert.deepStrictEqual(res, { done: ['a'], gone: ['b'], failed: ['c'], stopped: true });
  assert.deepStrictEqual(seen, ['a', 'b', 'c'], 'nothing after the 403 was attempted');
});
