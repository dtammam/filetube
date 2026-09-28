'use strict';

// [UNIT] v1.158 (Dean) - the Trash toolbar: the total-held line + the "Empty trash"
// button (bulk purge-all). Two layers:
//   1. the pure label strings (resting total + the confirm's title), and
//   2. a jsdom mount of renderTrashSection (with the REAL ui.js) that binds the
//      DESTRUCTIVE contract. Sweep S8 (D4.8) replaced the v1.158 two-tap arm with the
//      one ui.confirm step: a tap only opens a danger confirm that names the damage,
//      every dismissal (Cancel, Esc, the scrim, Close) sends nothing, and POST
//      /api/trash/purge-all goes out exactly once, only after it resolves true. A
//      regression that fired on the tap would let a single misclick wipe the trash.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { loadUi, openDialog, parts, answer, settle, drainSheets, DISMISSALS } = require('../helpers/ui-dialogs');

// v1.159: renderTrashSection renders the list via the shared table component
// (a common.js global in the browser); wire it for node.
global.buildSortableTable = require('../../public/js/common.js').buildSortableTable;
const {
  formatTrashToolbarLabel, formatTrashEmptyTitle, renderTrashSection,
} = require('../../public/js/setup.js');

const GB = 1024 ** 3;

// ---- pure label strings ----------------------------------------------------

test('formatTrashToolbarLabel: singular/plural + size, omitting an unknown size', () => {
  assert.equal(formatTrashToolbarLabel(1, 2.5 * GB), '1 item - 2.5 GB');
  assert.equal(formatTrashToolbarLabel(3, 2.5 * GB), '3 items - 2.5 GB');
  assert.equal(formatTrashToolbarLabel(2, 0), '2 items', 'zero/unknown size -> just the count');
  assert.equal(formatTrashToolbarLabel(0, 0), '0 items');
});

test('formatTrashEmptyTitle: the confirm names exactly what emptying destroys', () => {
  assert.equal(formatTrashEmptyTitle(12, 2.5 * GB), 'Permanently delete 12 items (2.5 GB)?');
  assert.equal(formatTrashEmptyTitle(1, 0), 'Permanently delete 1 item?', 'no size -> no parenthetical; singular');
});

// ---- source locks ----------------------------------------------------------

test('setup.html: the trash toolbar ships hidden with the total + a danger Empty-all button', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
  assert.match(html, /<div id="trash-toolbar" class="trash-toolbar" hidden>/, 'toolbar exists + hidden');
  assert.match(html, /id="trash-total"/);
  assert.match(html, /id="trash-empty-all" class="ui-btn ui-btn--danger ui-btn--sm trash-empty-all">Empty trash<\/button>/);
});

test('style.css: the toolbar has a real style source incl. the [hidden] guard; the armed state is retired', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.trash-toolbar\s*\{[^}]*display:\s*flex/, '.trash-toolbar is a flex row');
  assert.match(css, /\.trash-toolbar\[hidden\]\s*\{[^}]*display:\s*none/, 'the [hidden] guard beats display:flex');
  assert.doesNotMatch(css, /trash-confirming/, 'the two-tap armed class is gone');
});

// ---- jsdom: the confirm-first destructive contract -------------------------

function mountTrashDom() {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div id="trash-toolbar" class="trash-toolbar" hidden>
      <span id="trash-total"></span>
      <button type="button" id="trash-empty-all" class="ui-btn ui-btn--danger ui-btn--sm trash-empty-all">Empty trash</button>
    </div>
    <div id="trash-list"></div>
    <div id="trash-empty" hidden></div>
  </body>`, { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  loadUi();
  return dom;
}
function teardown(dom) {
  delete global.fetch; delete global.document; delete global.window; delete global.requestAnimationFrame;
  dom.window.close();
}
const tick = () => new Promise((r) => setTimeout(r, 0));
function trashFetch(calls) {
  return (url, opts) => {
    calls.push({ url, method: (opts && opts.method) || 'GET' });
    if (url === '/api/trash') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        items: [
          { trashId: 't1', title: 'A', trashedAt: 1700000000000, size: 1.5 * GB, type: 'video' },
          { trashId: 't2', title: 'B', trashedAt: 1700000000000, size: 1.0 * GB, type: 'video' },
        ],
        total: 2, totalSizeBytes: 2.5 * GB, retentionDays: 30,
      }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, purgedCount: 2, freedBytes: 2.5 * GB }) });
  };
}

test('Empty trash: a tap only opens a DANGER confirm naming the damage; every dismissal purges nothing', async () => {
  const dom = mountTrashDom();
  const calls = [];
  global.fetch = trashFetch(calls);
  try {
    renderTrashSection(new dom.window.AbortController().signal);
    await tick(); // the initial GET /api/trash resolves
    const doc = dom.window.document;
    assert.equal(doc.getElementById('trash-toolbar').hidden, false, 'toolbar shown when the trash is non-empty');
    assert.equal(doc.getElementById('trash-total').textContent, '2 items - 2.5 GB', 'the total line');
    const btn = doc.getElementById('trash-empty-all');
    const purges = () => calls.filter((c) => c.url === '/api/trash/purge-all');
    for (const how of DISMISSALS) {
      btn.dispatchEvent(new dom.window.Event('click'));
      await settle();
      const k = parts(openDialog(doc));
      assert.equal(k.title, 'Permanently delete 2 items (2.5 GB)?', 'the confirm names the damage');
      assert.ok(k.ok.classList.contains('ui-btn--destructive'), 'the danger fill');
      assert.equal(purges().length, 0, 'opening the confirm purges nothing');
      answer(doc, how);
      await settle();
      assert.equal(purges().length, 0, how + ': nothing purged');
      await drainSheets(dom.window);
    }
  } finally { teardown(dom); }
});

test('Empty trash: OK POSTs purge-all exactly once, and only then', async () => {
  const dom = mountTrashDom();
  const calls = [];
  global.fetch = trashFetch(calls);
  try {
    renderTrashSection(new dom.window.AbortController().signal);
    await tick();
    const doc = dom.window.document;
    doc.getElementById('trash-empty-all').dispatchEvent(new dom.window.Event('click'));
    await settle();
    const k = answer(doc, 'ok');
    k.ok.click(); // a second tap on the closing dialog must not purge twice
    await settle();
    const purge = calls.filter((c) => c.url === '/api/trash/purge-all');
    assert.equal(purge.length, 1, 'exactly one POST');
    assert.equal(purge[0].method, 'POST');
    await drainSheets(dom.window);
  } finally { teardown(dom); }
});

test('Empty trash: a confirm left open when the view is torn down never purges', async () => {
  const dom = mountTrashDom();
  const calls = [];
  global.fetch = trashFetch(calls);
  const setup = require('../../public/js/setup.js');
  const ac = new dom.window.AbortController();
  setup.__setFolderStateForTests({ controller: ac }); // the view's controller (its signal rides the confirm)
  try {
    renderTrashSection(ac.signal);
    await tick();
    const doc = dom.window.document;
    doc.getElementById('trash-empty-all').dispatchEvent(new dom.window.Event('click'));
    await settle();
    const k = parts(openDialog(doc));
    ac.abort(); // navigate away
    await settle();
    k.ok.click();
    await settle();
    assert.equal(calls.filter((c) => c.url === '/api/trash/purge-all').length, 0, 'the teardown answered false');
    await drainSheets(dom.window);
  } finally { setup.__setFolderStateForTests({ controller: null }); teardown(dom); }
});

test('a bare empty trash never shows the toolbar (nothing to purge)', async () => {
  const dom = mountTrashDom();
  global.fetch = (url) => {
    if (url === '/api/trash') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], total: 0, totalSizeBytes: 0, retentionDays: 30 }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  try {
    renderTrashSection(new dom.window.AbortController().signal);
    await tick();
    assert.equal(dom.window.document.getElementById('trash-toolbar').hidden, true, 'empty trash -> toolbar hidden');
  } finally { teardown(dom); }
});
