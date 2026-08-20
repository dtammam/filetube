'use strict';

// [UNIT] v1.159 (Dean): the Trash list as a sortable table (Title | Size |
// Expires + Restore/Purge). The v1.158 two-tap "Empty trash" toolbar is
// untouched; here we bind the per-ROW wiring: the Title cell escapes a hostile
// title (textContent), the actions carry data-trash-id, and the per-item two-tap
// Purge still DELETEs the CORRECT item even after a sort reorders the rows.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

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
    assert.match(cell.querySelector('.trash-thumb').getAttribute('src'), /\/thumbnail\/tid1/);
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
  return dom;
}
function teardownTrash(dom) {
  try { global.window.localStorage.clear(); } catch (_) { /* ignore */ }
  delete global.window; delete global.document; delete global.fetch; dom.window.close();
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

test('GATE: the per-item two-tap Purge DELETEs the CORRECT item after a sort', async () => {
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
    // First tap arms (no DELETE), second tap purges t-c.
    purgeBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 0, 'one tap does not purge');
    assert.ok(purgeBtn.classList.contains('trash-confirming'), 'armed after tap 1');
    purgeBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await tick();
    const del = calls.find((c) => c.method === 'DELETE');
    assert.ok(del, 'the second tap purged');
    assert.strictEqual(del.url, '/api/trash/t-c', 'DELETEd Charlie (the actual row-0 item), not a stale index');
  } finally { teardownTrash(dom); }
});

test('GATE SUGGESTION: a sort while a Purge is armed CLEARS the arm (no invisible one-tap delete)', async () => {
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
    // Arm the Purge for a SPECIFIC item (t-a), then sort so it moves position.
    btnFor('t-a').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    listEl.querySelector('.stable-th[data-col="size"]').dispatchEvent(new dom.window.Event('click')); // Size desc -> t-a is no longer row 0
    assert.strictEqual(listEl.querySelector('.trash-purge-btn.trash-confirming'), null, 'no button is left visibly armed after the re-render');
    // A SINGLE tap on the SAME item t-a must only RE-ARM, never DELETE (without
    // the onRender disarm, the stale arm would make this one tap delete t-a).
    btnFor('t-a').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 0, 'the stale arm did not carry into a one-tap delete of t-a');
    assert.ok(btnFor('t-a').classList.contains('trash-confirming'), 're-armed cleanly instead');
  } finally { teardownTrash(dom); }
});
