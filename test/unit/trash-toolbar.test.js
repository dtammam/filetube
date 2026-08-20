'use strict';

// [UNIT] v1.158 (Dean) - the Trash toolbar: the total-held line + the two-tap
// "Empty trash" button (bulk purge-all). Two layers:
//   1. the pure label strings (resting total + armed confirm), and
//   2. a jsdom mount of renderTrashSection that binds the DESTRUCTIVE contract -
//      ONE tap only ARMS (never hits the network); the SECOND tap within the
//      window is what POSTs /api/trash/purge-all. A regression that fired on the
//      first tap would let a single misclick wipe the trash.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

// v1.159: renderTrashSection renders the list via the shared table component
// (a common.js global in the browser); wire it for node.
global.buildSortableTable = require('../../public/js/common.js').buildSortableTable;
const {
  formatTrashToolbarLabel, formatTrashArmLabel, renderTrashSection,
} = require('../../public/js/setup.js');

const GB = 1024 ** 3;

// ---- pure label strings ----------------------------------------------------

test('formatTrashToolbarLabel: singular/plural + size, omitting an unknown size', () => {
  assert.equal(formatTrashToolbarLabel(1, 2.5 * GB), '1 item - 2.5 GB');
  assert.equal(formatTrashToolbarLabel(3, 2.5 * GB), '3 items - 2.5 GB');
  assert.equal(formatTrashToolbarLabel(2, 0), '2 items', 'zero/unknown size -> just the count');
  assert.equal(formatTrashToolbarLabel(0, 0), '0 items');
});

test('formatTrashArmLabel: names exactly what the second tap destroys', () => {
  assert.equal(formatTrashArmLabel(12, 2.5 * GB), 'Sure? Deletes 12 (2.5 GB)');
  assert.equal(formatTrashArmLabel(1, 0), 'Sure? Deletes 1', 'no size -> no parenthetical');
});

// ---- source locks ----------------------------------------------------------

test('setup.html: the trash toolbar ships hidden with the total + Empty-all button', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
  assert.match(html, /<div id="trash-toolbar" class="trash-toolbar" hidden>/, 'toolbar exists + hidden');
  assert.match(html, /id="trash-total"/);
  assert.match(html, /id="trash-empty-all"[^>]*>Empty trash<\/button>/);
});

test('style.css: the toolbar has a real style source incl. the [hidden] guard', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.trash-toolbar\s*\{[^}]*display:\s*flex/, '.trash-toolbar is a flex row');
  assert.match(css, /\.trash-toolbar\[hidden\]\s*\{[^}]*display:\s*none/, 'the [hidden] guard beats display:flex');
  assert.match(css, /\.trash-empty-all\.trash-confirming\s*\{[^}]*var\(--yt-red\)/, 'armed state reddens');
});

// ---- jsdom: the two-tap destructive contract -------------------------------

function mountTrashDom() {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <div id="trash-toolbar" class="trash-toolbar" hidden>
      <span id="trash-total"></span>
      <button type="button" id="trash-empty-all" class="btn btn-sm trash-empty-all">Empty trash</button>
    </div>
    <div id="trash-list"></div>
    <div id="trash-empty" hidden></div>
  </body>`, { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  return dom;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('two-tap: renders the total, ARMS on tap 1 (no network), PURGES on tap 2', async () => {
  const dom = mountTrashDom();
  const calls = [];
  global.fetch = (url, opts) => {
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
    // purge-all
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, purgedCount: 2, freedBytes: 2.5 * GB }) });
  };

  try {
    const ac = new dom.window.AbortController(); // jsdom's own AbortSignal type
    renderTrashSection(ac.signal);
    await tick(); // the initial GET /api/trash resolves

    const doc = dom.window.document;
    const toolbar = doc.getElementById('trash-toolbar');
    const total = doc.getElementById('trash-total');
    const btn = doc.getElementById('trash-empty-all');
    assert.equal(toolbar.hidden, false, 'toolbar shown when the trash is non-empty');
    assert.equal(total.textContent, '2 items - 2.5 GB', 'the total line');

    const getCalls = () => calls.filter((c) => c.url === '/api/trash/purge-all');

    // Tap 1: arms only.
    btn.dispatchEvent(new dom.window.Event('click'));
    await tick();
    assert.equal(getCalls().length, 0, 'ONE tap must NOT purge (no network)');
    assert.match(btn.textContent, /^Sure\? Deletes 2 \(2\.5 GB\)$/, 'armed label names the damage');
    assert.ok(btn.classList.contains('trash-confirming'), 'armed class on');

    // Tap 2: purges.
    btn.dispatchEvent(new dom.window.Event('click'));
    await tick();
    const purge = getCalls();
    assert.equal(purge.length, 1, 'the SECOND tap POSTs purge-all');
    assert.equal(purge[0].method, 'POST');
  } finally {
    delete global.fetch; delete global.document; delete global.window;
    dom.window.close();
  }
});

test('two-tap: the arm auto-disarms after ~4s - a stale first tap never carries into a later purge', async (t) => {
  const dom = mountTrashDom();
  const calls = [];
  global.fetch = (url, opts) => {
    calls.push({ url, method: (opts && opts.method) || 'GET' });
    if (url === '/api/trash') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        items: [{ trashId: 't1', title: 'A', trashedAt: 1700000000000, size: 1024 ** 3, type: 'video' }],
        total: 1, totalSizeBytes: 1024 ** 3, retentionDays: 30,
      }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
  };
  try {
    renderTrashSection(new dom.window.AbortController().signal);
    await tick(); // initial GET resolves (real timers)

    const btn = dom.window.document.getElementById('trash-empty-all');
    const purges = () => calls.filter((c) => c.url === '/api/trash/purge-all').length;

    t.mock.timers.enable({ apis: ['setTimeout'] }); // now control the 4s disarm window
    btn.dispatchEvent(new dom.window.Event('click'));  // tap 1: arms
    assert.ok(btn.classList.contains('trash-confirming'), 'armed after tap 1');
    t.mock.timers.tick(4000); // the window elapses with no second tap
    assert.ok(!btn.classList.contains('trash-confirming'), 'auto-disarmed');
    assert.strictEqual(btn.textContent, 'Empty trash', 'label reset');

    // A later single tap must ARM again, NOT purge (the stale arm is gone).
    btn.dispatchEvent(new dom.window.Event('click'));
    assert.strictEqual(purges(), 0, 'a lone tap after the window never purges');
    assert.ok(btn.classList.contains('trash-confirming'), 're-arms cleanly');
  } finally {
    t.mock.timers.reset();
    delete global.fetch; delete global.document; delete global.window;
    dom.window.close();
  }
});

test('two-tap: a bare empty trash never shows the toolbar (nothing to purge)', async () => {
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
  } finally {
    delete global.fetch; delete global.document; delete global.window;
    dom.window.close();
  }
});
