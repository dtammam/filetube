'use strict';

// [UNIT] v1.68 T3 - the bell panel's per-row dismiss X (Dean ruling 3),
// bound at the DOM by EXECUTING the real injectNotificationBellIfEnabled
// against a jsdom document + scripted fetch (the history-nav-gate pattern):
// the X renders per row as a SIBLING of the row anchor (a <button> must
// never nest in an <a> - the card-corner rule), a click POSTs exactly
// {id} to /api/notifications/dismiss and is NON-OPTIMISTIC (v1.54 law:
// only confirmed answers REMOVE - success removes the row and refreshes
// the badge, failure keeps the row and re-enables the button), and
// dismissing never navigates or fires the row's own read/seed click.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const { injectNotificationBellIfEnabled, __stopNotificationBellPollForTests } = require('../../public/js/common.js');

const ROWS = [
  { id: 41, mediaId: 'Vídeo-One', title: 'Vídeo One', createdAt: 1767000000000, unread: true, channelName: 'Chännel', hasThumbnail: false },
  { id: 42, mediaId: 'Vídeo-Two', title: 'Vídeo Two', createdAt: 1767000100000, unread: false, channelName: 'Chännel', hasThumbnail: false },
];

function withBellDom(opts, fn) {
  const dom = new JSDOM('<body><header><div class="header-right" id="header-right"></div></header></body>', { url: 'http://localhost/' });
  global.document = dom.window.document;
  global.window = dom.window;
  const calls = [];
  const failDismiss = !!(opts && opts.failDismiss);
  let badgeCount = 2;
  const realFetch = global.fetch;
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
      if (failDismiss) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      badgeCount -= 1;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };
  return Promise.resolve()
    .then(() => fn(calls))
    .finally(() => {
      // Stand the injector's badge poll down BEFORE the globals go - its
      // pending setTimeout is a Node timer that survives window.close().
      __stopNotificationBellPollForTests();
      global.fetch = realFetch;
      delete global.document;
      delete global.window;
      dom.window.close();
    });
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function openPanel(dom) {
  injectNotificationBellIfEnabled();
  await settle(); await settle();
  const bell = global.document.getElementById('notif-bell-btn');
  assert.ok(bell, 'the bell injected');
  bell.dispatchEvent(new global.window.Event('click', { bubbles: true }));
  await settle(); await settle();
}

test('each row renders a dismiss X as a SIBLING of the anchor; clicking it POSTs {id} and removes ONLY that row on success', () =>
  withBellDom({}, async (calls) => {
    await openPanel();
    const doc = global.document;
    const dismissBtns = doc.querySelectorAll('#notif-panel-list .notif-row-dismiss');
    assert.strictEqual(dismissBtns.length, 2, 'one X per row');
    assert.strictEqual(dismissBtns[0].tagName, 'BUTTON');
    assert.ok(!dismissBtns[0].closest('a'), 'the X must never nest inside the row anchor');

    dismissBtns[0].dispatchEvent(new global.window.Event('click', { bubbles: true }));
    await settle(); await settle(); await settle();

    const dismissCalls = calls.filter((c) => c.url === '/api/notifications/dismiss');
    assert.strictEqual(dismissCalls.length, 1, 'one dismiss POST');
    assert.deepStrictEqual(JSON.parse(dismissCalls[0].body), { id: 41 }, 'exactly the clicked row\'s id');
    assert.strictEqual(calls.filter((c) => c.url === '/api/notifications/read').length, 0,
      'the X must NOT fire the row\'s own read/navigate click');
    const rows = doc.querySelectorAll('#notif-panel-list .notif-row');
    assert.strictEqual(rows.length, 1, 'exactly one row left');
    assert.ok(rows[0].textContent.includes('Vídeo Two'), 'the OTHER row survived');
    // QA gate: a keyboard user stays IN the list - focus moves to the
    // remaining row's X, never dropped to <body>.
    assert.strictEqual(doc.activeElement, doc.querySelector('.notif-row-dismiss'),
      'focus lands on the surviving row\'s X after removal');
    // QA gate: the badge refetch honors the panel-open suppression the 60s
    // poll enforces - an open panel means /seen semantics own the badge, so
    // the refetched count must NOT paint while the panel is visible.
    const badgeEl = doc.getElementById('notif-bell-badge');
    assert.ok(badgeEl.hidden || badgeEl.textContent === '',
      'no stale count painted beside an open, fully-seen panel');
    assert.strictEqual(doc.querySelector('.notif-row-dismiss').textContent, '×',
      'the repo-standard U+00D7 close glyph (QA consistency note)');
  }));

test('NON-OPTIMISTIC: a failed dismiss keeps the row and re-enables the X (v1.54 law)', () =>
  withBellDom({ failDismiss: true }, async () => {
    await openPanel();
    const doc = global.document;
    const btn = doc.querySelectorAll('.notif-row-dismiss')[0];
    btn.dispatchEvent(new global.window.Event('click', { bubbles: true }));
    await settle(); await settle(); await settle();
    assert.strictEqual(doc.querySelectorAll('#notif-panel-list .notif-row').length, 2, 'nothing removed on failure');
    assert.strictEqual(btn.disabled, false, 'the X re-enabled for retry');
  }));
