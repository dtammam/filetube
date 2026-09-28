'use strict';

// [UNIT] v1.162 (Dean) - the Stats-table per-item DELETE (DESTRUCTIVE, full gate). The trash
// icon on the tables that list deletable media (Videos & audio, Most watched, and Duplicates
// per-copy) sends the SAME request as a card: DELETE /api/videos/:id (the file moves to Trash),
// NON-OPTIMISTIC, library-write only.
//
// Retire R3 (DELIBERATE conversion, D4.8 / F33 - the rule sweep S8 applied to Settings): the
// v1.162 two-tap in-row arm ("Sure?") is replaced by the one danger ui.confirm. The old
// load-bearing safety (an arm must never survive a re-sort into a one-tap delete) is now
// structural - a tap never deletes on its own, whatever rendered before it - and this file
// binds the new contract with the REAL ui.js in jsdom and the real buildSortableTable:
// Cancel / Esc / the scrim / Close send nothing; OK sends exactly one DELETE, of the row the
// user tapped; a double tap asks once; a failed DELETE keeps the row; a view teardown with the
// dialog up sends nothing, and a stale OK after it sends nothing either.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { loadUi, openDialog, parts, answer, settle, drainSheets, DISMISSALS } = require('../helpers/ui-dialogs');

const common = require('../../public/js/common.js');
const stats = require('../../public/js/stats.js');

function mount(opts) {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="host"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.buildSortableTable = common.buildSortableTable;
  global.deleteResultToast = common.deleteResultToast;
  global.showToast = () => {};
  loadUi();
  const calls = [];
  const fail = !!(opts && opts.failDelete);
  global.fetch = (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push({ url, method });
    if (method === 'DELETE' && url.indexOf('/api/videos/') === 0) {
      if (fail) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, trashed: true }) });
    }
    if (url === '/api/auth/me') {
      return Promise.resolve({ ok: true, status: 200, json: async () => (opts && opts.me) || { user: {} } });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };
  return { dom, calls };
}
async function teardown(dom) {
  try { stats.destroy(); } catch (_) { /* ignore */ }
  await drainSheets(dom.window);
  try { global.window.localStorage.clear(); } catch (_) { /* ignore */ }
  delete global.window; delete global.document; delete global.requestAnimationFrame;
  delete global.buildSortableTable; delete global.deleteResultToast; delete global.showToast;
  delete global.fetch;
  dom.window.close();
}
const click = (el) => el.dispatchEvent(new global.window.Event('click', { bubbles: true }));
const deletes = (calls) => calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
const dialogCount = (doc) => doc.querySelectorAll('.ui-sheet--dialog').length;
const rowsOf = (host) => host.querySelectorAll('.stable-body > [role="row"]');

const AV_ITEMS = [
  { id: 'vid-big', title: 'Big Movie', type: 'video', durationSeconds: 6000, sizeBytes: 3 * 1024 ** 3 },
  { id: 'vid-small', title: 'Small Song', type: 'audio', durationSeconds: 200, sizeBytes: 5 * 1024 ** 2 },
];

// ---- capability gate --------------------------------------------------------

test('renderAvTable shows delete buttons ONLY for library-write (canModify); read-only sees none; each is a plain icon ui-btn', async () => {
  const { dom } = mount();
  try {
    const host = () => global.document.getElementById('host');
    stats.renderAvTable(host(), AV_ITEMS, false);
    assert.strictEqual(host().querySelectorAll('.stats-delete-btn').length, 0, 'read-only: no delete controls');
    // backward-compat: the old 2-arg call (no canModify) also shows none.
    global.document.getElementById('host').innerHTML = '';
    stats.renderAvTable(host(), AV_ITEMS);
    assert.strictEqual(host().querySelectorAll('.stats-delete-btn').length, 0, 'undefined canModify: no delete controls');
    global.document.getElementById('host').innerHTML = '';
    stats.renderAvTable(host(), AV_ITEMS, true);
    const dels = host().querySelectorAll('.stats-delete-btn');
    assert.strictEqual(dels.length, 2, 'library-write: one delete per row');
    for (const d of dels) {
      assert.ok(d.classList.contains('ui-btn') && d.classList.contains('ui-btn--plain') && d.classList.contains('ui-btn--icon'), 'a plain icon ui-btn');
      assert.match(d.getAttribute('aria-label'), /^Delete (Big Movie|Small Song)$/, 'named for its item');
      assert.strictEqual(d.querySelector('use').getAttribute('href'), '#i-delete', 'the registry trash glyph');
    }
  } finally { await teardown(dom); }
});

test('resolveStatsCanModify: admin OR the modify-library flag; false on a non-ok/absent response', async () => {
  let { dom } = mount({ me: { user: { role: 'admin' } } });
  try { assert.strictEqual(await stats.resolveStatsCanModify(), true, 'admin role'); } finally { await teardown(dom); }
  ({ dom } = mount({ me: { user: { canModifyLibrary: true } } }));
  try { assert.strictEqual(await stats.resolveStatsCanModify(), true, 'the flag'); } finally { await teardown(dom); }
  ({ dom } = mount({ me: { user: { role: 'user', canModifyLibrary: false } } }));
  try { assert.strictEqual(await stats.resolveStatsCanModify(), false, 'plain user'); } finally { await teardown(dom); }
});

// ---- the DESTRUCTIVE confirm ------------------------------------------------

test('DESTRUCTIVE: a tap only opens a DANGER "Move to Trash?" confirm naming the item; every dismissal sends NOTHING', async () => {
  const { dom, calls } = mount();
  try {
    const doc = dom.window.document;
    const host = doc.getElementById('host');
    stats.renderAvTable(host, AV_ITEMS, true);
    for (const how of DISMISSALS) {
      click(host.querySelector('.stats-delete-btn')); await settle();
      const k = parts(openDialog(doc));
      assert.strictEqual(k.title, 'Move to Trash?', 'the copy says what the route does (Trash, never "permanently")');
      assert.match(k.text, /"Big Movie" leaves your library now/, 'the item is named (default Size-desc: row 0 is Big Movie)');
      assert.ok(k.ok.classList.contains('ui-btn--destructive'), 'the danger fill');
      assert.strictEqual(k.ok.textContent, 'Move to Trash');
      assert.deepStrictEqual(deletes(calls), [], 'opening the confirm deletes nothing');
      answer(doc, how); await settle();
      assert.deepStrictEqual(deletes(calls), [], how + ': nothing deleted');
      assert.strictEqual(rowsOf(host).length, 2, how + ': the row stays');
      await drainSheets(dom.window);
    }
  } finally { await teardown(dom); }
});

test('DESTRUCTIVE: OK sends exactly ONE DELETE, of the tapped row\'s id, and removes only that row', async () => {
  const { dom, calls } = mount();
  try {
    const doc = dom.window.document;
    const host = doc.getElementById('host');
    stats.renderAvTable(host, AV_ITEMS, true);
    click(host.querySelector('.stats-delete-btn')); await settle();
    const k = answer(doc, 'ok');
    k.ok.click(); // a second tap on the closing dialog must not delete twice
    await settle();
    assert.deepStrictEqual(deletes(calls), ['/api/videos/vid-big'], 'one DELETE, the tapped row');
    assert.strictEqual(rowsOf(host).length, 1, 'only that row removed');
    assert.ok(!host.textContent.includes('Big Movie'), 'the deleted row is gone');
    assert.ok(host.textContent.includes('Small Song'), 'the other row survived');
  } finally { await teardown(dom); }
});

test('DESTRUCTIVE: a double tap asks ONCE, and one OK sends one request', async () => {
  const { dom, calls } = mount();
  try {
    const doc = dom.window.document;
    const host = doc.getElementById('host');
    stats.renderAvTable(host, AV_ITEMS, true);
    const del = host.querySelector('.stats-delete-btn');
    click(del); click(del); await settle();
    assert.strictEqual(dialogCount(doc), 1, 'one dialog for a double tap');
    answer(doc, 'ok'); await settle();
    assert.deepStrictEqual(deletes(calls), ['/api/videos/vid-big']);
  } finally { await teardown(dom); }
});

test('DESTRUCTIVE: a re-sort between taps never re-targets - the button deletes the row it sits on', async () => {
  const { dom, calls } = mount();
  try {
    const doc = dom.window.document;
    const host = doc.getElementById('host');
    stats.renderAvTable(host, AV_ITEMS, true);
    // Size desc (default) -> click Size once more = asc: row 0 is now Small Song.
    const sizeHeader = Array.from(host.querySelectorAll('.stable-th')).find((t) => t.textContent === 'Size');
    click(sizeHeader); await settle();
    assert.ok(rowsOf(host)[0].textContent.includes('Small Song'), 'precondition: the sort flipped');
    click(rowsOf(host)[0].querySelector('.stats-delete-btn')); await settle();
    assert.match(parts(openDialog(doc)).text, /"Small Song"/);
    answer(doc, 'ok'); await settle();
    assert.deepStrictEqual(deletes(calls), ['/api/videos/vid-small'], 'the id of the row the button sits on');
  } finally { await teardown(dom); }
});

test('NON-OPTIMISTIC: a failed DELETE keeps the row and re-enables the button', async () => {
  const { dom, calls } = mount({ failDelete: true });
  try {
    const doc = dom.window.document;
    const host = doc.getElementById('host');
    stats.renderAvTable(host, AV_ITEMS, true);
    const del = host.querySelector('.stats-delete-btn');
    click(del); await settle();
    answer(doc, 'ok'); await settle();
    assert.strictEqual(deletes(calls).length, 1, 'attempted');
    assert.strictEqual(rowsOf(host).length, 2, 'nothing removed on failure');
    assert.strictEqual(del.disabled, false, 're-enabled for retry');
  } finally { await teardown(dom); }
});

test('DESTRUCTIVE: a view teardown with the confirm up sends nothing, and a stale OK after it sends nothing', async () => {
  const { dom, calls } = mount();
  try {
    const doc = dom.window.document;
    doc.body.insertAdjacentHTML('beforeend', '<div id="stats-av-list"></div>');
    stats.init(doc.body); // the view's controller, whose signal the confirm is bound to
    await settle();
    const host = doc.getElementById('host');
    stats.renderAvTable(host, AV_ITEMS, true);
    click(host.querySelector('.stats-delete-btn')); await settle();
    const k = parts(openDialog(doc));
    stats.destroy(); // navigate away with the dialog up
    await settle();
    k.ok.click(); await settle();
    assert.deepStrictEqual(deletes(calls), [], 'nothing deleted after the view went away');
  } finally { await teardown(dom); }
});

// Gate r1 (adversary 5): the two backup checks after the confirm, each bound by the ONE input
// only it refuses. The real ui.confirm answers only true/false and an abort closes it (false),
// so it masks both; a stand-in confirm (window.ui.confirm replaced after loadUi) isolates them.
test('DESTRUCTIVE: only an answer of exactly `true` deletes - a truthy non-true answer (1, "yes", {}) sends nothing', async () => {
  for (const answerValue of [1, 'yes', {}, true]) { // `true`: the positive control
    const { dom, calls } = mount();
    try {
      const doc = dom.window.document;
      const host = doc.getElementById('host');
      stats.renderAvTable(host, AV_ITEMS, true);
      global.window.ui = { confirm: () => Promise.resolve(answerValue) };
      click(host.querySelector('.stats-delete-btn')); await settle();
      assert.deepStrictEqual(deletes(calls), answerValue === true ? ['/api/videos/vid-big'] : [], `an answer of ${JSON.stringify(answerValue)}`);
    } finally { await teardown(dom); }
  }
});

test('DESTRUCTIVE: a yes that lands after the view was torn down sends nothing (the signal captured at the tap, re-checked after the answer)', async () => {
  for (const leave of ['stay', 'leave', 'leave-and-return']) { // 'stay': the positive control
    const { dom, calls } = mount();
    try {
      const doc = dom.window.document;
      doc.body.insertAdjacentHTML('beforeend', '<div id="stats-av-list"></div>');
      stats.init(doc.body);
      await settle();
      const host = doc.getElementById('host');
      stats.renderAvTable(host, AV_ITEMS, true);
      let yes;
      global.window.ui = { confirm: () => new Promise((r) => { yes = r; }) }; // ignores its signal
      click(host.querySelector('.stats-delete-btn')); await settle();
      assert.strictEqual(typeof yes, 'function', 'the confirm was asked');
      if (leave !== 'stay') stats.destroy(); // the user leaves Stats with the dialog up
      if (leave === 'leave-and-return') { stats.init(doc.body); await settle(); } // ... and comes back: a FRESH controller
      yes(true);
      await settle();
      assert.deepStrictEqual(deletes(calls), leave === 'stay' ? ['/api/videos/vid-big'] : [], leave);
    } finally { await teardown(dom); }
  }
});

// ---- Duplicates per-copy expando -------------------------------------------

const DUP_REPORT = () => ({
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
});

test('Duplicates: library-write gets an expand toggle (a plain icon ui-btn) -> per-copy confirmed deletes of the EXACT copy chosen', async () => {
  const { dom, calls } = mount();
  try {
    const doc = dom.window.document;
    const host = doc.getElementById('host');
    stats.renderDuplicates(host, DUP_REPORT(), true);
    const toggle = host.querySelector('.dup-expand');
    assert.ok(toggle && toggle.classList.contains('ui-btn--icon'), 'the expand toggle renders for library-write');
    assert.strictEqual(host.querySelectorAll('.dup-copy').length, 0, 'copies hidden until expanded');
    click(toggle); await settle();
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
    const copyRows = host.querySelectorAll('.dup-copy');
    assert.strictEqual(copyRows.length, 3, 'expands to one line per copy');
    // Delete the SECOND copy (copy-b): a tap asks, a dismissal sends nothing, OK sends it.
    const del = copyRows[1].querySelector('.stats-delete-btn');
    click(del); await settle();
    assert.match(parts(openDialog(doc)).text, /"\/backup\/clip\.mp4"/, 'the confirm names the copy by its path');
    answer(doc, 'cancel'); await settle(); await drainSheets(dom.window);
    assert.deepStrictEqual(deletes(calls), [], 'Cancel deletes nothing');
    click(del); await settle();
    answer(doc, 'ok'); await settle();
    assert.deepStrictEqual(deletes(calls), ['/api/videos/copy-b'], 'deletes exactly the chosen copy');
    assert.strictEqual(host.querySelectorAll('.dup-copy').length, 2, 'that copy line removed; the group stays (2 copies left)');
  } finally { await teardown(dom); }
});

test('Duplicates: deleting down to a single copy removes the whole group row (no longer a duplicate)', async () => {
  const { dom } = mount();
  try {
    const doc = dom.window.document;
    const host = doc.getElementById('host');
    stats.renderDuplicates(host, {
      nameGroups: [{ key: 'x.mp4', items: [{ id: 'x1', filePath: '/a/x.mp4', size: 50 }, { id: 'x2', filePath: '/b/x.mp4', size: 50 }], totalBytes: 100, wastedBytes: 50 }],
      idGroups: [],
    }, true);
    click(host.querySelector('.dup-expand')); await settle();
    click(host.querySelectorAll('.dup-copy')[0].querySelector('.stats-delete-btn')); await settle();
    answer(doc, 'ok'); await settle();
    assert.strictEqual(rowsOf(host).length, 0, 'the group row is gone once it holds <=1 copy');
  } finally { await teardown(dom); }
});

test('Duplicates: read-only sees NO expand toggle and no delete (report unchanged)', async () => {
  const { dom } = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderDuplicates(host, DUP_REPORT(), false);
    assert.strictEqual(host.querySelectorAll('.dup-expand').length, 0);
    assert.strictEqual(host.querySelectorAll('.stats-delete-btn').length, 0);
  } finally { await teardown(dom); }
});
