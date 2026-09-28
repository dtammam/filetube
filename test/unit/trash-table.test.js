'use strict';

// [UNIT] v1.159 (Dean): the Trash list as a sortable table (Title | Size |
// Expires + Restore/Purge). Here we bind the per-ROW wiring: the Title cell escapes
// a hostile title (textContent), the actions carry data-trash-id, and Purge (behind
// the ui.confirm step since sweep S8) DELETEs the CORRECT item even after a sort.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { loadUi, openDialog, parts, answer, settle, drainSheets, DISMISSALS } = require('../helpers/ui-dialogs');

const common = require('../../public/js/common.js');
global.buildSortableTable = common.buildSortableTable;
const setup = require('../../public/js/setup.js');

test('buildTrashTitleCell: escapes a hostile title via textContent + carries the thumbnail', () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.document = dom.window.document;
  try {
    const cell = setup.buildTrashTitleCell({ trashId: 'tid1', title: '<img src=x onerror=alert(1)>' });
    assert.strictEqual(cell.querySelector('.trash-title').textContent, '<img src=x onerror=alert(1)>');
    assert.strictEqual(cell.querySelectorAll('img').length, 1, 'only the thumbnail img - the title is text, not parsed HTML');
    // retire R3: the thumbnail is a ui-thumb (a box with its img inside)
    assert.ok(cell.querySelector('.trash-thumb').classList.contains('ui-thumb'), 'the thumbnail is the ui-thumb primitive');
    assert.match(cell.querySelector('.trash-thumb .ui-thumb__img').getAttribute('src'), /\/thumbnail\/tid1/);
  } finally { delete global.document; dom.window.close(); }
});

const ITEMS = [
  { trashId: 't-a', title: 'Alpha', size: 5 * 1024 ** 3, trashedAt: 3000 },
  { trashId: 't-b', title: 'Bravo', size: 1 * 1024 ** 3, trashedAt: 1000 },
  { trashId: 't-c', title: 'Charlie', size: 9 * 1024 ** 3, trashedAt: 2000 },
];

function mountTrash() {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div id="trash-toolbar" hidden><span id="trash-total"></span><button id="trash-empty-all">Empty trash</button></div>
    <div id="trash-list"></div>
    <div id="trash-empty" hidden></div>
  </body>`, { url: 'http://localhost/setup.html' });
  global.window = dom.window; global.document = dom.window.document;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  loadUi(); // the REAL ui.js: Purge / Empty trash confirm first (sweep S8)
  return dom;
}
function teardownTrash(dom) {
  try { global.window.localStorage.clear(); } catch (_) { /* ignore */ }
  delete global.window; delete global.document; delete global.fetch; delete global.requestAnimationFrame; dom.window.close();
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const titles = (host) => Array.from(host.querySelectorAll('.stable-row .stable-cell--name .trash-title')).map((c) => c.textContent);

test('renders Title|Size|Expires columns; sort by Size works', async () => {
  const dom = mountTrash();
  try {
    global.fetch = (url) => {
      if (url === '/api/trash') return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: ITEMS, total: 3, totalSizeBytes: 15 * 1024 ** 3, retentionDays: 30 }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    };
    setup.renderTrashSection(new dom.window.AbortController().signal);
    await tick();
    const listEl = global.document.getElementById('trash-list');
    const headers = Array.from(listEl.querySelectorAll('.stable-th')).map((t) => t.textContent).filter(Boolean);
    assert.deepEqual(headers, ['Title', 'Size', 'Expires']);
    listEl.querySelector('.stable-th[data-col="size"]').dispatchEvent(new dom.window.Event('click')); // Size desc
    assert.deepEqual(titles(listEl), ['Charlie', 'Alpha', 'Bravo'], '9 GB > 5 GB > 1 GB');
  } finally { teardownTrash(dom); }
});

// Sweep S8 (D4.8, AC12 conversion of the v1.159 two-tap gates): Purge opens a danger
// ui.confirm naming the item; the DELETE goes to the item whose button was tapped - after a
// sort too - and only once the confirm resolves true.
test('GATE: Purge DELETEs the CORRECT item after a sort, only after the confirm resolves true', async () => {
  const dom = mountTrash();
  const calls = [];
  try {
    global.fetch = (url, opts) => {
      if (url === '/api/trash') return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: ITEMS, total: 3, totalSizeBytes: 15 * 1024 ** 3, retentionDays: 30 }) });
      calls.push({ url, method: (opts && opts.method) || 'GET' });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    };
    setup.renderTrashSection(new dom.window.AbortController().signal);
    await tick();
    const listEl = global.document.getElementById('trash-list');
    // Sort by Size desc -> row 0 is Charlie (t-c).
    listEl.querySelector('.stable-th[data-col="size"]').dispatchEvent(new dom.window.Event('click'));
    assert.deepEqual(titles(listEl), ['Charlie', 'Alpha', 'Bravo']);
    const purgeBtn = listEl.querySelectorAll('.stable-row')[0].querySelector('.trash-purge-btn');
    purgeBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 0, 'a tap only opens the confirm');
    const k = parts(openDialog(global.document));
    assert.match(k.title, /Charlie/, 'the confirm names the row that was tapped');
    assert.ok(k.ok.classList.contains('ui-btn--destructive'), 'a danger confirm');
    answer(global.document, 'ok');
    await settle();
    const dels = calls.filter((c) => c.method === 'DELETE');
    assert.deepStrictEqual(dels.map((c) => c.url), ['/api/trash/t-c'], 'DELETEd Charlie (the actual row-0 item), exactly once');
    await drainSheets(dom.window);
  } finally { teardownTrash(dom); }
});

test('GATE: every dismissal of the Purge confirm deletes nothing, and a sort meanwhile never re-targets it', async () => {
  const dom = mountTrash();
  const calls = [];
  try {
    global.fetch = (url, opts) => {
      if (url === '/api/trash') return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: ITEMS, total: 3, totalSizeBytes: 15 * 1024 ** 3, retentionDays: 30 }) });
      calls.push({ url, method: (opts && opts.method) || 'GET' });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    };
    setup.renderTrashSection(new dom.window.AbortController().signal);
    await tick();
    const listEl = global.document.getElementById('trash-list');
    const btnFor = (tid) => listEl.querySelector('.trash-purge-btn[data-trash-id="' + tid + '"]');
    for (const how of DISMISSALS) {
      btnFor('t-a').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await settle();
      answer(global.document, how);
      await settle();
      assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 0, how + ': nothing deleted');
      await drainSheets(dom.window);
    }
    // Open for t-a, re-sort underneath the dialog, confirm: still t-a.
    btnFor('t-a').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();
    listEl.querySelector('.stable-th[data-col="size"]').dispatchEvent(new dom.window.Event('click'));
    answer(global.document, 'ok');
    await settle();
    assert.deepStrictEqual(calls.filter((c) => c.method === 'DELETE').map((c) => c.url), ['/api/trash/t-a']);
    await drainSheets(dom.window);
  } finally { teardownTrash(dom); }
});

// Gate r1 (adversary 5): the two backup checks behind the Purge confirm (a PERMANENT delete),
// each bound by the ONE input only it refuses. The real ui.confirm answers only true/false
// and a view abort closes it (false), so it masks both; a stand-in window.ui.confirm
// (installed after loadUi) isolates them.
function trashFetch(calls) {
  return (url, opts) => {
    if (url === '/api/trash') return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: ITEMS, total: 3, totalSizeBytes: 15 * 1024 ** 3, retentionDays: 30 }) });
    calls.push({ url, method: (opts && opts.method) || 'GET' });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
  };
}

test('GATE: confirmDestructive takes only an answer of exactly `true` - a truthy non-true answer (1, "yes", {}) purges nothing', async () => {
  for (const answerValue of [1, 'yes', {}, true]) { // `true`: the positive control
    const dom = mountTrash();
    const calls = [];
    try {
      global.fetch = trashFetch(calls);
      setup.renderTrashSection(new dom.window.AbortController().signal);
      await tick();
      global.window.ui = { confirm: () => Promise.resolve(answerValue) };
      global.document.querySelector('.trash-purge-btn[data-trash-id="t-a"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await settle();
      assert.deepStrictEqual(calls.filter((c) => c.method !== 'GET').map((c) => c.method + ' ' + c.url),
        answerValue === true ? ['DELETE /api/trash/t-a'] : [], `an answer of ${JSON.stringify(answerValue)}`);
    } finally { teardownTrash(dom); }
  }
});

test('GATE: a Purge yes that lands after the Trash section was torn down (its signal aborted) purges nothing', async () => {
  const dom = mountTrash();
  const calls = [];
  try {
    global.fetch = trashFetch(calls);
    const ac = new dom.window.AbortController();
    setup.renderTrashSection(ac.signal);
    await tick();
    let yes;
    global.window.ui = { confirm: () => new Promise((r) => { yes = r; }) }; // ignores its signal
    global.document.querySelector('.trash-purge-btn[data-trash-id="t-a"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();
    assert.strictEqual(typeof yes, 'function', 'the confirm was asked');
    ac.abort(); // the user leaves Settings with the dialog up
    yes(true);
    await settle();
    assert.deepStrictEqual(calls.filter((c) => c.method !== 'GET'), [], 'nothing purged after the section went away');
  } finally { teardownTrash(dom); }
});

test('GATE (positive control for the test above): the same stand-in yes on a LIVE section purges exactly that item', async () => {
  const dom = mountTrash();
  const calls = [];
  try {
    global.fetch = trashFetch(calls);
    setup.renderTrashSection(new dom.window.AbortController().signal);
    await tick();
    let yes;
    global.window.ui = { confirm: () => new Promise((r) => { yes = r; }) };
    global.document.querySelector('.trash-purge-btn[data-trash-id="t-a"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();
    yes(true);
    await settle();
    assert.deepStrictEqual(calls.filter((c) => c.method !== 'GET').map((c) => c.method + ' ' + c.url), ['DELETE /api/trash/t-a']);
  } finally { teardownTrash(dom); }
});
