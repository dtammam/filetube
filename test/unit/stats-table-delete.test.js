'use strict';

// [UNIT] v1.162 (Dean) - the Stats-table per-item DELETE (DESTRUCTIVE). The
// tried-and-true trash icon + two-tap confirm on the tables that list deletable
// media (Videos & audio, Most watched, and Duplicates per-copy), same flow as a
// card: DELETE /api/videos/:id -> Trash, NON-OPTIMISTIC, library-write only. The
// load-bearing safety is the v1.159 class: a two-tap arm must NEVER survive a
// sort/filter re-render into a one-tap delete. Executed against jsdom with the
// real buildSortableTable (the stats-av-table harness).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const common = require('../../public/js/common.js');
const stats = require('../../public/js/stats.js');

function mount(opts) {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="host"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.buildSortableTable = common.buildSortableTable;
  global.nextArmState = common.nextArmState;
  global.deleteResultToast = common.deleteResultToast;
  global.showToast = () => {};
  const calls = [];
  const fail = !!(opts && opts.failDelete);
  global.fetch = (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push({ url, method });
    if (method === 'DELETE' && url.indexOf('/api/videos/') === 0) {
      if (fail) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, deleted: 1 }) });
    }
    if (url === '/api/auth/me') {
      return Promise.resolve({ ok: true, status: 200, json: async () => (opts && opts.me) || { user: {} } });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };
  return { dom, calls };
}
function teardown(dom) {
  try { global.window.localStorage.clear(); } catch (_) { /* ignore */ }
  delete global.window; delete global.document;
  delete global.buildSortableTable; delete global.nextArmState; delete global.deleteResultToast; delete global.showToast;
  delete global.fetch;
  dom.window.close();
}
const settle = () => new Promise((r) => setImmediate(r));
const click = (el) => el.dispatchEvent(new global.window.Event('click', { bubbles: true }));

const AV_ITEMS = [
  { id: 'vid-big', title: 'Big Movie', type: 'video', durationSeconds: 6000, sizeBytes: 3 * 1024 ** 3 },
  { id: 'vid-small', title: 'Small Song', type: 'audio', durationSeconds: 200, sizeBytes: 5 * 1024 ** 2 },
];

// ---- capability gate --------------------------------------------------------

test('renderAvTable shows delete buttons ONLY for library-write (canModify); read-only sees none', () => {
  const { dom } = mount();
  try {
    const host = () => global.document.getElementById('host');
    stats.renderAvTable(host(), AV_ITEMS, false);
    assert.strictEqual(host().querySelectorAll('.stable-delete-btn').length, 0, 'read-only: no delete controls');
    // backward-compat: the old 2-arg call (no canModify) also shows none.
    global.document.getElementById('host').innerHTML = '';
    stats.renderAvTable(host(), AV_ITEMS);
    assert.strictEqual(host().querySelectorAll('.stable-delete-btn').length, 0, 'undefined canModify: no delete controls');
    global.document.getElementById('host').innerHTML = '';
    stats.renderAvTable(host(), AV_ITEMS, true);
    assert.strictEqual(host().querySelectorAll('.stable-delete-btn').length, 2, 'library-write: one delete per row');
  } finally { teardown(dom); }
});

test('resolveStatsCanModify: admin OR the modify-library flag; false on a non-ok/absent response', async () => {
  let { dom } = mount({ me: { user: { role: 'admin' } } });
  try { assert.strictEqual(await stats.resolveStatsCanModify(), true, 'admin role'); } finally { teardown(dom); }
  ({ dom } = mount({ me: { user: { canModifyLibrary: true } } }));
  try { assert.strictEqual(await stats.resolveStatsCanModify(), true, 'the flag'); } finally { teardown(dom); }
  ({ dom } = mount({ me: { user: { role: 'user', canModifyLibrary: false } } }));
  try { assert.strictEqual(await stats.resolveStatsCanModify(), false, 'plain user'); } finally { teardown(dom); }
});

// ---- the DESTRUCTIVE two-tap ------------------------------------------------

test('DESTRUCTIVE two-tap: one tap arms and NEVER deletes; the second DELETEs the right id and removes the row', async () => {
  const { dom, calls } = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderAvTable(host, AV_ITEMS, true);
    const firstRowDelete = () => host.querySelector('.stable-row .stable-delete-btn');
    const del = firstRowDelete();
    // default Size-desc -> row 0 is Big Movie (vid-big).
    click(del); await settle();
    assert.ok(del.classList.contains('stable-delete-armed'), 'one tap arms');
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 0, 'ONE tap NEVER deletes');
    assert.strictEqual(host.querySelectorAll('.stable-row').length, 2, 'row still there after one tap');
    click(del); await settle(); await settle();
    const dels = calls.filter((c) => c.method === 'DELETE');
    assert.strictEqual(dels.length, 1, 'the second tap deletes');
    assert.strictEqual(dels[0].url, '/api/videos/vid-big', 'deletes the clicked row\'s id');
    assert.strictEqual(host.querySelectorAll('.stable-row').length, 1, 'only that row removed');
    assert.ok(!host.textContent.includes('Big Movie'), 'the deleted row is gone');
    assert.ok(host.textContent.includes('Small Song'), 'the other row survived');
  } finally { teardown(dom); }
});

test('v1.159 SAFETY: an armed delete does NOT survive a re-sort into a one-tap delete', async () => {
  const { dom, calls } = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderAvTable(host, AV_ITEMS, true);
    // Arm the first row's delete...
    click(host.querySelector('.stable-row .stable-delete-btn')); await settle();
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 0, 'armed, not deleted');
    // ...then RE-SORT by clicking the Size header (rebuilds every row + fires onRender).
    const sizeHeader = Array.from(host.querySelectorAll('.stable-th')).find((t) => t.textContent === 'Size');
    click(sizeHeader); await settle();
    // The rebuilt buttons are IDLE and the shared arm was reset: a SINGLE tap on
    // any row must only ARM (never delete).
    const del = host.querySelector('.stable-row .stable-delete-btn');
    assert.ok(!del.classList.contains('stable-delete-armed'), 'no button is armed after a re-sort');
    click(del); await settle();
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 0, 'one tap after a re-sort ARMS, never deletes');
    assert.ok(del.classList.contains('stable-delete-armed'), 'it armed instead');
  } finally { teardown(dom); }
});

test('NON-OPTIMISTIC: a failed DELETE keeps the row and re-enables the button', async () => {
  const { dom, calls } = mount({ failDelete: true });
  try {
    const host = global.document.getElementById('host');
    stats.renderAvTable(host, AV_ITEMS, true);
    const del = host.querySelector('.stable-row .stable-delete-btn');
    click(del); await settle(); // arm
    click(del); await settle(); await settle(); // confirm -> fails
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 1, 'attempted');
    assert.strictEqual(host.querySelectorAll('.stable-row').length, 2, 'nothing removed on failure');
    assert.strictEqual(del.disabled, false, 're-enabled for retry');
  } finally { teardown(dom); }
});

test('only ONE delete is armed at a time (across rows)', async () => {
  const { dom } = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderAvTable(host, AV_ITEMS, true);
    const dels = host.querySelectorAll('.stable-row .stable-delete-btn');
    click(dels[0]); await settle();
    click(dels[1]); await settle();
    assert.ok(dels[1].classList.contains('stable-delete-armed'), 'second armed');
    assert.ok(!dels[0].classList.contains('stable-delete-armed'), 'first DISARMED');
  } finally { teardown(dom); }
});

// ---- Duplicates per-copy expando -------------------------------------------

const DUP_REPORT = {
  nameGroups: [{
    key: 'clip.mp4',
    items: [
      { id: 'copy-a', filePath: '/movies/clip.mp4', size: 100 },
      { id: 'copy-b', filePath: '/backup/clip.mp4', size: 100 },
      { id: 'copy-c', filePath: '/old/clip.mp4', size: 100 },
    ],
    totalBytes: 300, wastedBytes: 200,
  }],
  idGroups: [],
};

test('Duplicates: library-write gets an expand toggle -> per-copy deletes of the EXACT copy chosen', async () => {
  const { dom, calls } = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderDuplicates(host, DUP_REPORT, true);
    const toggle = host.querySelector('.stable-expand-btn');
    assert.ok(toggle, 'the expand toggle renders for library-write');
    assert.strictEqual(host.querySelectorAll('.dup-copy-row').length, 0, 'copies hidden until expanded');
    click(toggle); await settle();
    const copyRows = host.querySelectorAll('.dup-copy-row');
    assert.strictEqual(copyRows.length, 3, 'expands to one row per copy');
    // Delete the SECOND copy (copy-b) - a two-tap on its own button.
    const del = copyRows[1].querySelector('.stable-delete-btn');
    click(del); await settle();
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 0, 'one tap arms');
    click(del); await settle(); await settle();
    const dels = calls.filter((c) => c.method === 'DELETE');
    assert.strictEqual(dels.length, 1);
    assert.strictEqual(dels[0].url, '/api/videos/copy-b', 'deletes exactly the chosen copy');
    assert.strictEqual(host.querySelectorAll('.dup-copy-row').length, 2, 'that copy row removed; the group stays (2 copies left)');
  } finally { teardown(dom); }
});

test('Duplicates: deleting down to a single copy removes the whole group row (no longer a duplicate)', async () => {
  const { dom } = mount();
  try {
    const host = global.document.getElementById('host');
    // A 2-copy group: deleting one leaves 1 -> the group row must disappear.
    stats.renderDuplicates(host, {
      nameGroups: [{ key: 'x.mp4', items: [{ id: 'x1', filePath: '/a/x.mp4', size: 50 }, { id: 'x2', filePath: '/b/x.mp4', size: 50 }], totalBytes: 100, wastedBytes: 50 }],
      idGroups: [],
    }, true);
    click(host.querySelector('.stable-expand-btn')); await settle();
    const del = host.querySelectorAll('.dup-copy-row')[0].querySelector('.stable-delete-btn');
    click(del); await settle(); // arm
    click(del); await settle(); await settle(); // confirm
    assert.strictEqual(host.querySelectorAll('.stable-row').length, 0, 'the group row is gone once it holds <=1 copy');
  } finally { teardown(dom); }
});

test('Duplicates: read-only sees NO expand toggle (report unchanged)', () => {
  const { dom } = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderDuplicates(host, DUP_REPORT, false);
    assert.strictEqual(host.querySelectorAll('.stable-expand-btn').length, 0);
    assert.strictEqual(host.querySelectorAll('.stable-delete-btn').length, 0);
  } finally { teardown(dom); }
});
