'use strict';

// [UNIT] UI pass sweep S4 - the playback queue panel on the primitives, driven in jsdom with
// the REAL injectQueueChrome, ui.js and interaction.js (test/helpers/notif-panel-harness.js).
//
//   - F48: the panel opened INVISIBLE under iOS Reduce Motion (openOverlay skipped the open
//     class, so .queue-panel sat at opacity 0). It is a ui.sheet now, which applies its open
//     class in every motion mode (the CSS makes reduced motion an opacity-only change);
//   - rows are ui-rows with reserved columns: art (media) and three action slots - Move up,
//     Move down, Remove from queue - on every row, the unavailable move DISABLED in place;
//   - the verbs are unchanged (reorder, remove - a queue edit, never a file delete);
//   - Clear goes through ui.confirm (the in-button "Really clear?" arm is gone, D4.8).

const { test } = require('node:test');
const assert = require('node:assert');
const { mountQueue, until, wait } = require('../helpers/notif-panel-harness');

test('F48: under Reduce Motion the queue panel opens WITH its open class (visible), on the phone and on desktop', async () => {
  for (const phone of [true, false]) {
    const q = await mountQueue({ reducedMotion: true, phone });
    try {
      await q.open();
      await until(() => q.panel().classList.contains('is-open'), 'the open class', 500);
      assert.ok(q.panel().classList.contains(phone ? 'ui-sheet--bottom' : 'ui-sheet--popover'), q.panel().className);
      assert.ok(Array.from(q.doc.querySelectorAll('.ui-scrim')).pop().classList.contains('is-open'), 'the scrim too');
    } finally { await q.teardown(); }
  }
});

test('rows reserve their columns: art + three icon actions on EVERY row; the unavailable move is disabled in place', async () => {
  const q = await mountQueue();
  try {
    await q.open();
    const list = q.doc.getElementById('queue-panel-list');
    assert.ok(list.classList.contains('ui-list--media-art') && list.classList.contains('ui-list--actions-3'));
    const rows = q.rows();
    assert.deepStrictEqual(rows.map((r) => r.dataset.uid), ['u1', 'u2', 'u3']);
    for (const r of rows) {
      assert.deepStrictEqual(Array.from(r.children).map((c) => c.className.split(' ')[0]), ['ui-row__lead', 'ui-row__media', 'ui-row__body', 'ui-row__aside', 'ui-row__actions']);
      const acts = Array.from(r.querySelector('.ui-row__actions').children);
      assert.deepStrictEqual(acts.map((b) => b.getAttribute('aria-label')), ['Move up', 'Move down', 'Remove from queue']);
      for (const b of acts) assert.ok(b.classList.contains('ui-btn') && b.classList.contains('ui-btn--icon'), 'a ui-btn icon (the 44px --hit area is the primitive\'s)');
      assert.deepStrictEqual(acts.map((b) => b.querySelector('use').getAttribute('href')), ['#i-arrow_upward', '#i-arrow_downward', '#i-close']);
    }
    assert.deepStrictEqual(rows.map((r) => r.querySelector('[aria-label="Move up"]').disabled), [true, false, false]);
    assert.deepStrictEqual(rows.map((r) => r.querySelector('[aria-label="Move down"]').disabled), [false, false, true]);
    assert.deepStrictEqual(rows.map((r) => [r.classList.contains('queue-item--played'), r.classList.contains('queue-item--playing')]),
      [[true, false], [false, true], [false, false]], 'played before the pointer, playing at it');
    assert.match(rows[1].querySelector('.ui-row__meta').textContent, /^Now playing - Harbor$/);
    assert.doesNotMatch(q.panel().textContent, /[×▴▾]|Really clear/);
    for (const b of q.panel().querySelectorAll('button')) assert.match(b.className, /\bui-/);
  } finally { await q.teardown(); }
});

test('Move down sends the reordered uids; Remove sends DELETE /api/queue/items/:uid (a queue edit) - and the rows re-render', async () => {
  const q = await mountQueue();
  try {
    await q.open();
    q.click(q.rows()[0].querySelector('[aria-label="Move down"]'));
    await until(() => q.rows()[0].dataset.uid === 'u2', 'the re-render');
    const reorder = q.calls.filter((c) => c.url === '/api/queue/reorder');
    assert.deepStrictEqual(reorder.map((c) => JSON.parse(c.body)), [{ orderedUids: ['u2', 'u1', 'u3'] }]);
    q.click(q.rows()[2].querySelector('[aria-label="Remove from queue"]'));
    await until(() => q.rows().length === 2, 'the removal');
    assert.deepStrictEqual(q.calls.filter((c) => c.method === 'DELETE').map((c) => c.url), ['/api/queue/items/u3']);
    assert.strictEqual(q.calls.filter((c) => /\/api\/videos\//.test(c.url)).length, 0, 'never a file delete');
    assert.strictEqual(q.doc.getElementById('queue-panel-heading').textContent, 'Queue - 2 items');
  } finally { await q.teardown(); }
});

test('Clear asks first: Cancel / Esc / the scrim send nothing; OK sends ONE DELETE /api/queue and closes the panel', async () => {
  const q = await mountQueue();
  try {
    await q.open();
    const clear = q.doc.getElementById('queue-clear-btn');
    const confirm = () => { const a = Array.from(q.doc.querySelectorAll('.ui-sheet--dialog.is-open .ui-confirm__actions')).pop(); return a ? { cancel: a.children[0], ok: a.children[1], sheet: a.closest('.ui-sheet') } : null; };
    const clears = () => q.calls.filter((c) => c.url === '/api/queue' && c.method === 'DELETE');
    for (const how of ['cancel', 'esc', 'scrim']) {
      q.click(clear);
      await until(confirm, 'the confirm');
      const c = confirm();
      assert.strictEqual(c.sheet.querySelector('.ui-sheet__title').textContent, 'Clear the queue?');
      assert.ok(c.ok.classList.contains('ui-btn--destructive'));
      if (how === 'cancel') q.click(c.cancel);
      else if (how === 'esc') q.key(q.doc, 'Escape');
      else q.click(Array.from(q.doc.querySelectorAll('.ui-scrim')).pop());
      await until(() => !confirm(), 'closed');
      await wait(20);
      assert.strictEqual(clears().length, 0, `${how} clears nothing`);
      assert.ok(q.panel().classList.contains('is-open'), 'the queue panel stays open under a dismissed confirm');
    }
    q.click(clear);
    await until(confirm, 'the confirm');
    q.click(confirm().ok);
    q.click(confirm() ? confirm().ok : clear);
    await until(() => clears().length === 1, 'the DELETE');
    await wait(40);
    assert.strictEqual(clears().length, 1);
  } finally { await q.teardown(); }
});

test('the empty queue shows the ui.state copy and the panel stays open (v1.68.3)', async () => {
  const q = await mountQueue({ queue: { pointerUid: null, entries: [{ uid: 'x', mediaId: 'm', kind: 'media', item: { title: 'Only' } }] } });
  try {
    await q.open();
    q.click(q.rows()[0].querySelector('[aria-label="Remove from queue"]'));
    await until(() => q.doc.querySelector('#queue-panel .ui-state'), 'the empty state');
    assert.match(q.doc.querySelector('#queue-panel .ui-state').textContent, /No queued items yet.*Items you queue up to play show here\./);
    assert.ok(q.panel().classList.contains('is-open'), 'an open panel never slams shut on empty');
    assert.ok(q.btn.hidden, 'the button itself hides (ruling 4)');
  } finally { await q.teardown(); }
});
