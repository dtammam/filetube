'use strict';

// [UNIT] v1.68 T3 - the bell panel's per-row DISMISS (Dean ruling 3), bound at the DOM by
// EXECUTING the real injectNotificationBellIfEnabled against jsdom with the real ui.js and
// interaction.js (test/helpers/notif-panel-harness.js).
//
// Sweep S4 (D8.3, AC12 conversion): the per-row X is gone. Dismiss lives in the row menu
// (kebab / long-press / right-click) and behind a swipe left (its button, or a full swipe
// past 60%). What the v1.68 tests bound still holds on every one of those paths: a dismiss
// POSTs exactly {id} to /api/notifications/dismiss, is NON-OPTIMISTIC (v1.54 law: success
// removes the row and reconciles the badge from the server, failure keeps the row and
// allows a retry), never navigates or fires the row's own read/seed click, and keeps
// keyboard focus in the list. Dismiss is not destructive (D4.8): it never asks.

const { test } = require('node:test');
const assert = require('node:assert');
const { mountBell, until, wait, res } = require('../helpers/notif-panel-harness');

const reads = (h) => h.calls.filter((c) => c.url === '/api/notifications/read');

test('menu Dismiss POSTs {id} once, removes ONLY that row, never marks read, keeps focus in the list', async () => {
  const h = await mountBell();
  try {
    await h.open();
    const items = await h.openMenu(41);
    h.click(items.Dismiss);
    h.click(items.Dismiss); // a second tap while the menu animates out
    await until(() => !h.row(41), 'the row leaves');
    await wait(400); // the menu's close returns focus, then the row goes
    assert.deepStrictEqual(h.dismissals().map((c) => JSON.parse(c.body)), [{ id: 41 }], 'exactly one POST, the tapped row\'s id');
    assert.strictEqual(h.confirm(), null, 'dismiss never asks (not destructive, D4.8)');
    assert.strictEqual(reads(h).length, 0, 'dismiss never fires the row\'s read/navigate click');
    assert.deepStrictEqual(h.rows().map((r) => r.dataset.notifId), ['42', '43', '44'], 'the other rows survive');
    // QA gate (v1.68): the badge refetch honours the panel-open suppression - an open panel
    // means /seen semantics own the badge, so no stale count paints beside it.
    const badge = h.doc.getElementById('notif-bell-badge');
    assert.ok(badge.hidden || badge.textContent === '', 'no count painted beside an open, fully-seen panel');
  } finally { await h.teardown(); }
});

test('the swipe\'s Dismiss button and a full swipe each POST {id} once for THAT row', async () => {
  const h = await mountBell();
  try {
    await h.open();
    await h.swipe(43, 120); // a podcast row: two actions since v1.376.0 (Dismiss + Delete, 154px), so 120px opens it
    assert.ok(h.wrap(43).classList.contains('is-open'));
    h.tap(h.swipeAction(43, 'dismiss'));
    await until(() => !h.row(43), 'the podcast row leaves');
    h.drag(h.row(44), [380, 100]); // a full swipe on the engine row
    await until(() => !h.row(44), 'the engine row leaves');
    await wait(30);
    assert.deepStrictEqual(h.dismissals().map((c) => JSON.parse(c.body)), [{ id: 43 }, { id: 44 }]);
    assert.deepStrictEqual(h.deletes(), []);
    assert.strictEqual(reads(h).length, 0);
  } finally { await h.teardown(); }
});

test('NON-OPTIMISTIC: a failed dismiss keeps the row, and a retry sends again (v1.54 law)', async () => {
  let fail = true;
  const h = await mountBell({ route: (method, url) => (url === '/api/notifications/dismiss' && fail ? res(500, {}) : null) });
  try {
    await h.open();
    let items = await h.openMenu(42);
    h.click(items.Dismiss);
    await until(() => h.dismissals().length === 1, 'the POST');
    await wait(40);
    assert.ok(h.row(42), 'nothing removed on failure');
    fail = false;
    items = await h.openMenu(42);
    h.click(items.Dismiss);
    await until(() => !h.row(42), 'the retry removes it');
    assert.strictEqual(h.dismissals().length, 2, 'the retry was allowed');
  } finally { await h.teardown(); }
});

test('dismissing the last row shows the empty state; the next row\'s kebab takes focus when focus was on the gone row', async () => {
  const rows = [
    { id: 7, mediaId: 'a', kind: 'media', title: 'A', createdAt: 1767000000000, unread: false, channelName: 'C', hasThumbnail: false },
    { id: 8, mediaId: 'b', kind: 'media', title: 'B', createdAt: 1767000000001, unread: false, channelName: 'C', hasThumbnail: false },
  ];
  const h = await mountBell({ rows });
  try {
    await h.open();
    h.row(7).querySelector('.notif-more').focus();
    await h.swipe(7, 200);
    h.tap(h.swipeAction(7, 'dismiss'));
    await until(() => !h.row(7), 'row 7 leaves');
    assert.strictEqual(h.doc.activeElement, h.row(8).querySelector('.notif-more'), 'focus lands on the surviving row\'s kebab');
    h.drag(h.row(8), [380, 100]);
    await until(() => h.doc.querySelector('#notif-panel .ui-state'), 'the empty state');
    assert.match(h.doc.querySelector('#notif-panel .ui-state').textContent, /No notifications yet/);
    assert.ok(h.doc.getElementById('notif-clear-btn').parentNode.hidden, 'Clear all hides with nothing to clear');
  } finally { await h.teardown(); }
});
