'use strict';

// [UNIT] UI pass S5 (F33, D4.8) - DESTRUCTIVE PATHS on the Subscriptions page (full gate).
//
// Every delete the page can issue - Unsubscribe (DELETE /api/subscriptions/:id), a
// failure record (DELETE /api/subscriptions/failures/:id) and Clear all
// (DELETE /api/subscriptions/failures/all) - goes through ui.confirm with a danger
// fill, and the SAME request as before runs only after the confirm resolves true.
// This mounts the REAL view with the REAL ui.js in jsdom and drives every way in:
// the row menu, the settings sheet, a double tap, the keyboard, the scrim, Close, Esc,
// a view teardown with the dialog up, and a late tap on a dialog already closing.
// The assertion that matters is the request log: no DELETE ever leaves without a
// confirm answered OK, and one OK sends exactly one.

const { test } = require('node:test');
const assert = require('node:assert');
const { mountSubsView, jsonRes, settle, click, wait } = require('../helpers/subs-view-harness');

const SUBS = [
  { id: 's1', name: 'Alpha Channel', channelDir: '/dl/Alpha', channelUrl: 'https://www.youtube.com/@alpha', lastStatus: 'ok' },
  { id: 's2', name: 'Bravo Channel', channelUrl: 'https://www.youtube.com/@bravo', lastStatus: 'error: HTTP Error 403' },
];
const FAILURES = [
  { id: 'f1', ts: '2026-09-27T10:00:00.000Z', source: 'one-off', videoId: 'v1', title: 'First failure', reason: 'ERROR: gone' },
  { id: 'f2', ts: '2026-09-27T09:00:00.000Z', source: 'subscription', videoId: 'v2', title: 'Second failure', reason: 'ERROR: 403' },
];

function mount() {
  return mountSubsView((method, url) => {
    if (method === 'GET' && url === '/api/subscriptions') return jsonRes(200, SUBS.map((s) => ({ ...s })));
    if (method === 'GET' && url === '/api/subscriptions/failures') return jsonRes(200, { entries: FAILURES.map((f) => ({ ...f })) });
    if (method === 'DELETE') return jsonRes(200, { success: true });
    return undefined;
  });
}

const deletes = (calls) => calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
const openConfirm = (document) => document.querySelector('.ui-sheet.ui-sheet--dialog.is-open .ui-confirm__actions');
const confirmButtons = (document) => {
  const acts = openConfirm(document);
  return acts ? { cancel: acts.children[0], ok: acts.children[1], sheet: acts.closest('.ui-sheet') } : null;
};
const openConfirmCount = (document) => document.querySelectorAll('.ui-sheet.is-open .ui-confirm__actions').length;
const rowOf = (document, id) => document.querySelector(`.ui-row[data-sub-id="${id}"]`);
async function ready(document) { await settle(() => !!rowOf(document, 's1') && !!document.querySelector('[data-failure-id="f1"]'), 'rows + failures rendered'); }

async function menuUnsubscribe(window, document, id) {
  click(window, rowOf(document, id).querySelector('.subs-more'));
  await settle(() => [...document.querySelectorAll('.ui-sheet.is-open button.ui-row')].some((b) => b.textContent === 'Unsubscribe'), 'the row menu');
  const item = [...document.querySelectorAll('.ui-sheet.is-open button.ui-row')].find((b) => b.textContent === 'Unsubscribe');
  assert.ok(item.classList.contains('ui-row--danger'), 'Unsubscribe reads as destructive in the menu');
  click(window, item);
  await settle(() => !!openConfirm(document), 'the confirm dialog');
  return confirmButtons(document);
}

test('F33: Unsubscribe from the row menu confirms first (danger fill, the channel named as text); Cancel / Esc / scrim / Close send NOTHING', async () => {
  const { window, document, handlers, calls } = mount();
  try {
    await ready(document);
    let c = await menuUnsubscribe(window, document, 's1');
    assert.strictEqual(c.sheet.querySelector('.ui-sheet__title').textContent, 'Unsubscribe from Alpha Channel?');
    assert.ok(c.ok.classList.contains('ui-btn--destructive'), 'the confirm button is the danger fill');
    assert.strictEqual(c.ok.textContent, 'Unsubscribe');
    assert.match(c.sheet.textContent, /Videos already downloaded stay in your library/, 'the copy says what actually happens');

    click(window, c.cancel);
    await settle(() => !openConfirm(document), 'Cancel closes');
    c = await menuUnsubscribe(window, document, 's1');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    await settle(() => !openConfirm(document), 'Esc closes');
    c = await menuUnsubscribe(window, document, 's1');
    click(window, document.querySelector('.ui-scrim.is-open') || [...document.querySelectorAll('.ui-scrim')].pop());
    await settle(() => !openConfirm(document), 'the scrim closes');
    c = await menuUnsubscribe(window, document, 's1');
    click(window, c.sheet.querySelector('.ui-sheet__close'));
    await settle(() => !openConfirm(document), 'Close closes');
    await wait(50);
    assert.deepStrictEqual(deletes(calls), [], 'no dismissal path sends a DELETE');
  } finally {
    handlers.destroy();
  }
});

test('F33: OK sends exactly ONE DELETE to the same route as before; a double tap on OK still sends one', async () => {
  const { window, document, handlers, calls } = mount();
  try {
    await ready(document);
    const c = await menuUnsubscribe(window, document, 's2');
    click(window, c.ok);
    click(window, c.ok); // a double tap
    await settle(() => deletes(calls).length === 1, 'the DELETE');
    await wait(50);
    assert.deepStrictEqual(deletes(calls), ['/api/subscriptions/s2']);
    await settle(() => calls.filter((x) => x.method === 'GET' && x.url === '/api/subscriptions').length === 2, 'the list reloads after the delete');
  } finally {
    handlers.destroy();
  }
});

test('F33: the settings sheet\'s Unsubscribe confirms too; a double tap opens ONE dialog and one OK sends ONE DELETE', async () => {
  const { window, document, handlers, calls } = mount();
  try {
    await ready(document);
    click(window, rowOf(document, 's1').querySelector('.ui-row__link'));
    await settle(() => !!document.querySelector('.ui-sheet.is-open .subs-unsubscribe'), 'the settings sheet');
    const unsub = document.querySelector('.ui-sheet.is-open .subs-unsubscribe');
    click(window, unsub);
    click(window, unsub); // double tap
    await settle(() => !!openConfirm(document), 'the confirm');
    await wait(40);
    assert.strictEqual(openConfirmCount(document), 1, 'one dialog, not two stacked');
    assert.deepStrictEqual(deletes(calls), [], 'nothing before OK');
    click(window, confirmButtons(document).ok);
    await settle(() => deletes(calls).length === 1, 'the DELETE');
    await wait(50);
    assert.deepStrictEqual(deletes(calls), ['/api/subscriptions/s1']);
  } finally {
    handlers.destroy();
  }
});

test('F33: the keyboard cannot confirm by accident - Enter anywhere does nothing, Esc cancels; a late OK on a closing dialog stays a cancel', async () => {
  const { window, document, handlers, calls } = mount();
  try {
    await ready(document);
    let c = await menuUnsubscribe(window, document, 's1');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    c.sheet.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(30);
    assert.ok(openConfirm(document), 'Enter does not answer the dialog');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    click(window, c.ok); // tapped while the dialog animates out
    await wait(400);
    assert.deepStrictEqual(deletes(calls), [], 'Esc then a late OK sends nothing');
    c = null;
  } finally {
    handlers.destroy();
  }
});

test('F33: a view teardown (SPA nav away) with the confirm up closes it and answers false - no DELETE, even if OK is tapped after', async () => {
  // Two guards, each bound here: the confirm takes the view's signal (the teardown
  // CLOSES the dialog - asserted before any tap), and the post-answer re-check of the
  // signal (a stale OK on the closed dialog stays a cancel). Each alone is masked by
  // the other for the request log, so the stranded-dialog assert binds the first.
  const { window, document, handlers, calls } = mount();
  await ready(document);
  const c = await menuUnsubscribe(window, document, 's1');
  handlers.destroy();
  await settle(() => document.querySelectorAll('.ui-sheet').length === 0, 'the teardown closed the dialog (no stranded overlay on <body>)', 1500);
  click(window, c.ok);
  await wait(100);
  assert.deepStrictEqual(deletes(calls), [], 'the torn-down view deletes nothing');
});

test('F33: deleting ONE failure record confirms first; Cancel sends nothing, OK sends one DELETE for that record', async () => {
  const { window, document, handlers, calls } = mount();
  try {
    await ready(document);
    const del = document.querySelector('[data-failure-id="f1"] .subs-failure-delete');
    click(window, del);
    await settle(() => !!openConfirm(document), 'the confirm');
    let c = confirmButtons(document);
    assert.strictEqual(c.sheet.querySelector('.ui-sheet__title').textContent, 'Delete this failure record?');
    assert.ok(c.ok.classList.contains('ui-btn--destructive'));
    click(window, c.cancel);
    await wait(40);
    assert.deepStrictEqual(deletes(calls), []);
    click(window, del);
    click(window, del); // double tap while the first confirm is pending
    await settle(() => !!openConfirm(document), 'the confirm again');
    await wait(40);
    assert.strictEqual(openConfirmCount(document), 1, 'one dialog per record');
    c = confirmButtons(document);
    click(window, c.ok);
    await settle(() => deletes(calls).length === 1, 'the DELETE');
    await wait(50);
    assert.deepStrictEqual(deletes(calls), ['/api/subscriptions/failures/f1']);
  } finally {
    handlers.destroy();
  }
});

test('F33: Clear all confirms first (the count named); Cancel sends nothing, OK sends ONE DELETE /failures/all', async () => {
  const { window, document, handlers, calls } = mount();
  try {
    await ready(document);
    const clearBtn = document.querySelector('.subs-failures-clear');
    click(window, clearBtn);
    await settle(() => !!openConfirm(document), 'the confirm');
    let c = confirmButtons(document);
    assert.strictEqual(c.sheet.querySelector('.ui-sheet__title').textContent, 'Delete all 2 failure records?');
    click(window, c.cancel);
    await wait(40);
    assert.deepStrictEqual(deletes(calls), []);
    click(window, clearBtn);
    click(window, clearBtn);
    await settle(() => !!openConfirm(document), 'the confirm again');
    await wait(40);
    assert.strictEqual(openConfirmCount(document), 1);
    c = confirmButtons(document);
    click(window, c.ok);
    click(window, c.ok);
    await settle(() => deletes(calls).length === 1, 'the DELETE');
    await wait(50);
    assert.deepStrictEqual(deletes(calls), ['/api/subscriptions/failures/all']);
  } finally {
    handlers.destroy();
  }
});

test('F33 census: tapping EVERY other control on the page - the toolbar, every row control, every menu item but Unsubscribe, every sheet button - sends no DELETE', async () => {
  const { window, document, handlers, calls } = mount();
  try {
    await ready(document);
    const closeAll = async () => {
      for (let i = 0; i < 4 && document.querySelector('.ui-sheet.is-open'); i++) {
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
        await wait(5);
      }
      await settle(() => !document.querySelector('.ui-sheet.is-open'), 'all sheets closed');
    };
    // the toolbar and the in-view controls
    for (const b of document.querySelectorAll('#view-root button')) {
      if (b.classList.contains('subs-failures-clear') || b.classList.contains('subs-failure-delete')) continue; // bound above
      click(window, b);
      await wait(5);
      await closeAll();
    }
    // every row menu item except Unsubscribe
    for (const id of ['s1', 's2']) {
      for (let i = 0; i < 5; i++) {
        click(window, rowOf(document, id).querySelector('.subs-more'));
        await settle(() => document.querySelectorAll('.ui-sheet.is-open button.ui-row').length > 0, 'menu');
        const items = [...document.querySelectorAll('.ui-sheet.is-open button.ui-row')].filter((b) => b.textContent !== 'Unsubscribe');
        if (i >= items.length) { await closeAll(); break; }
        click(window, items[i]);
        await wait(5);
        await closeAll();
      }
    }
    // every settings-sheet button except Unsubscribe
    click(window, rowOf(document, 's2').querySelector('.ui-row__link'));
    await settle(() => !!document.querySelector('.ui-sheet.is-open .subs-save'), 'sheet');
    for (const b of document.querySelectorAll('.ui-sheet.is-open button:not(.subs-unsubscribe)')) click(window, b);
    await wait(50);
    await closeAll();
    assert.deepStrictEqual(deletes(calls), [], 'no DELETE without a confirm answered OK');
    assert.strictEqual(openConfirmCount(document), 0, 'and no confirm was ever needed for those');
  } finally {
    handlers.destroy();
  }
});
