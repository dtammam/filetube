'use strict';

// [UNIT] v1.161 (Dean) - the bell panel's per-row DELETE button (DESTRUCTIVE),
// bound at the DOM by EXECUTING the real injectNotificationBellIfEnabled against
// a jsdom document + scripted fetch (the notification-dismiss-client harness).
// Contract: a delete button renders per MEDIA row as a SIBLING of the anchor (a
// <button> never nests in an <a>, so a tap can't navigate); it is a TWO-TAP arm
// (nextArmState) so ONE tap NEVER deletes; the second tap DELETE /api/videos/:id
// (-> Trash, same as a card) is NON-OPTIMISTIC (v1.54: only a confirmed 2xx
// removes); on success it also dismisses the notification server-side; podcast
// and engine rows get NO delete button; only ONE button is armed at a time.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const { injectNotificationBellIfEnabled, __stopNotificationBellPollForTests } = require('../../public/js/common.js');

// A media row (delete-able), a podcast row and an engine row (NOT delete-able).
const ROWS = [
  { id: 41, mediaId: 'Vídeo-One', title: 'Vídeo One', createdAt: 1767000000000, unread: true, channelName: 'Chännel', hasThumbnail: false },
  { id: 42, mediaId: 'Vídeo-Two', title: 'Vídeo Two', createdAt: 1767000100000, unread: false, channelName: 'Chännel', hasThumbnail: false },
  { id: 43, mediaId: 'ep-1', kind: 'podcast', title: 'Episode', createdAt: 1767000200000, unread: false, channelName: 'Show' },
  { id: 44, mediaId: 'eng-1', kind: 'engine', title: 'Engine switched', createdAt: 1767000300000, unread: false },
];

function withBellDom(opts, fn) {
  const dom = new JSDOM('<body><header><div class="header-right" id="header-right"></div></header></body>', { url: 'http://localhost/' });
  global.document = dom.window.document;
  global.window = dom.window;
  const calls = [];
  const failDelete = !!(opts && opts.failDelete);
  let badgeCount = 4;
  const realFetch = global.fetch;
  // showToast is present in the browser, absent under jsdom - the source guards
  // on `typeof window.showToast === 'function'`, so leaving it undefined here
  // exercises the guard (no timer leaks). deleteResultToast is a pure common.js
  // helper already in scope.
  global.fetch = (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push({ url, method, body: init && init.body });
    if (url === '/api/notifications/badge') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ count: badgeCount }) });
    }
    if (url === '/api/notifications' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: ROWS, unseenCount: badgeCount }) });
    }
    if (url === '/api/notifications/seen') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    }
    if (url === '/api/notifications/dismiss') {
      badgeCount -= 1;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    }
    if (method === 'DELETE' && url.indexOf('/api/videos/') === 0) {
      if (failDelete) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      badgeCount -= 1;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, deleted: 1 }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };
  return Promise.resolve()
    .then(() => fn(calls))
    .finally(() => {
      __stopNotificationBellPollForTests();
      global.fetch = realFetch;
      delete global.document;
      delete global.window;
      dom.window.close();
    });
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function openPanel() {
  injectNotificationBellIfEnabled();
  await settle(); await settle();
  const bell = global.document.getElementById('notif-bell-btn');
  assert.ok(bell, 'the bell injected');
  bell.dispatchEvent(new global.window.Event('click', { bubbles: true }));
  await settle(); await settle();
}
const click = (el) => el.dispatchEvent(new global.window.Event('click', { bubbles: true }));

test('a delete button renders on MEDIA rows only (never podcast/engine), as a SIBLING of the anchor', () =>
  withBellDom({}, async () => {
    await openPanel();
    const doc = global.document;
    const deletes = doc.querySelectorAll('#notif-panel-list .notif-row-delete');
    assert.strictEqual(deletes.length, 2, 'exactly the two media rows carry a delete button');
    assert.strictEqual(deletes[0].tagName, 'BUTTON');
    assert.ok(!deletes[0].closest('a'), 'the delete button must never nest inside the row anchor (no navigation on tap)');
    // The podcast/engine rows still have a dismiss X but no delete.
    assert.strictEqual(doc.querySelectorAll('#notif-panel-list .notif-row-dismiss').length, 4, 'every row keeps its dismiss X');
  }));

test('DESTRUCTIVE two-tap: ONE tap arms and NEVER deletes; the SECOND tap on the same button DELETEs /api/videos/:id and removes the row', () =>
  withBellDom({}, async (calls) => {
    await openPanel();
    const doc = global.document;
    const del = doc.querySelectorAll('#notif-panel-list .notif-row-delete')[0];

    // First tap: ARMED, no DELETE fired, row still present.
    click(del);
    await settle(); await settle();
    assert.ok(del.classList.contains('notif-row-delete-armed'), 'one tap arms (shows "Sure?")');
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 0, 'ONE tap must never fire a delete');
    assert.strictEqual(doc.querySelectorAll('#notif-panel-list .notif-row').length, 4, 'the row is still there after one tap');

    // Second tap on the SAME button: DELETE fires for that row's mediaId.
    click(del);
    await settle(); await settle(); await settle();
    const dels = calls.filter((c) => c.method === 'DELETE');
    assert.strictEqual(dels.length, 1, 'the second tap fires exactly one DELETE');
    assert.strictEqual(dels[0].url, '/api/videos/' + encodeURIComponent('Vídeo-One'), 'DELETEs the clicked row\'s mediaId (encoded)');
    // Never navigates: no read/seed click fired by the delete path.
    assert.strictEqual(calls.filter((c) => c.url === '/api/notifications/read').length, 0, 'delete never fires the row\'s read/navigate click');
    // The row is gone, and the video\'s notification was dismissed server-side.
    assert.strictEqual(doc.querySelectorAll('#notif-panel-list .notif-row').length, 3, 'only the deleted row is removed');
    const dismissCalls = calls.filter((c) => c.url === '/api/notifications/dismiss');
    assert.strictEqual(dismissCalls.length, 1, 'the notification is dismissed server-side after the video is deleted');
    assert.deepStrictEqual(JSON.parse(dismissCalls[0].body), { id: 41 }, 'the dismissed id is the deleted row\'s notification id');
  }));

test('NON-OPTIMISTIC: a failed DELETE keeps the row and re-enables the button (v1.54 law)', () =>
  withBellDom({ failDelete: true }, async (calls) => {
    await openPanel();
    const doc = global.document;
    const del = doc.querySelectorAll('#notif-panel-list .notif-row-delete')[0];
    click(del); await settle(); // arm
    click(del); await settle(); await settle(); await settle(); // confirm -> fails
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 1, 'the DELETE was attempted');
    assert.strictEqual(doc.querySelectorAll('#notif-panel-list .notif-row').length, 4, 'nothing removed on failure');
    assert.strictEqual(del.disabled, false, 'the button re-enabled for retry');
    assert.strictEqual(calls.filter((c) => c.url === '/api/notifications/dismiss').length, 0, 'a failed delete never dismisses the notification');
  }));

test('only ONE delete is armed at a time: arming a second row disarms the first', () =>
  withBellDom({}, async () => {
    await openPanel();
    const doc = global.document;
    const dels = doc.querySelectorAll('#notif-panel-list .notif-row-delete');
    click(dels[0]); await settle();
    assert.ok(dels[0].classList.contains('notif-row-delete-armed'), 'first row armed');
    click(dels[1]); await settle();
    assert.ok(dels[1].classList.contains('notif-row-delete-armed'), 'second row now armed');
    assert.ok(!dels[0].classList.contains('notif-row-delete-armed'), 'the first row DISARMED when the second armed');
  }));
