'use strict';

// [UNIT] v1.376.0 W1 (Dean's R1): "Watch later" on a notification row (Dean called it "Add to watch later"). One tap adds
// the item to Watch later (the existing POST /api/watch-later/:id) AND dismisses that
// notification for this user (the existing POST /api/notifications/dismiss), without opening
// the item. NON-OPTIMISTIC: the row leaves only after BOTH answered 2xx; a failure keeps it.
//
// The panel is the REAL injectNotificationBellIfEnabled with the REAL ui.js / interaction.js
// (test/helpers/notif-panel-harness.js). The request LOG is the assertion: order, count, and
// that no read / navigation happened.

const { test } = require('node:test');
const assert = require('node:assert');
const { mountBell, until, wait, res } = require('../helpers/notif-panel-harness');

const WL_URL = '/api/watch-later/' + encodeURIComponent('Vídeo-One');
const isWlPost = (c) => c.method === 'POST' && c.url === WL_URL;
const isDismiss = (c) => c.url === '/api/notifications/dismiss';

// Mount with a scripted Watch later route, a toast log and an optional held add.
async function mountWl(o) {
  const opts = o || {};
  const toasts = [];
  let release = null;
  const h = await mountBell({
    route(method, url) {
      if (url === '/api/watch-later/ids') return res(200, { ids: opts.listed || [] });
      if (method === 'POST' && url.indexOf('/api/watch-later/') === 0) {
        if (opts.addStatus && opts.addStatus !== 200) return res(opts.addStatus, { error: 'no' });
        if (opts.holdAdd) return new Promise((r) => { release = () => r(res(200, { success: true, watchLater: true })); });
        return res(200, { success: true, watchLater: true });
      }
      if (url === '/api/notifications/dismiss' && opts.dismissStatus) return res(opts.dismissStatus, { error: 'no' });
      return null;
    },
  });
  h.w.showToast = (m) => toasts.push(m);
  h.toasts = toasts;
  h.release = () => release && release();
  return h;
}

test('W1: Watch later adds, THEN dismisses, then the row leaves - the item never opens', async () => {
  const h = await mountWl();
  try {
    await h.open();
    const items = await h.openMenu(41);
    assert.ok(items['Watch later'], 'the media row offers it');
    h.click(items['Watch later']);
    await until(() => !h.row(41), 'the row to leave');
    const adds = h.calls.filter(isWlPost);
    const dismissals = h.calls.filter(isDismiss);
    assert.strictEqual(adds.length, 1, 'one add');
    assert.strictEqual(dismissals.length, 1, 'one dismiss');
    assert.deepStrictEqual(JSON.parse(dismissals[0].body), { id: 41 }, 'the dismiss names THIS notification');
    assert.ok(h.calls.indexOf(adds[0]) < h.calls.indexOf(dismissals[0]), 'the add answers before the dismiss is sent');
    assert.strictEqual(h.calls.filter((c) => c.url === '/api/notifications/read').length, 0, 'the item was not opened (no row tap)');
    assert.ok(h.panel().classList.contains('is-open'), 'the panel stays open');
    assert.deepStrictEqual(h.toasts, ['Added to Watch later']);
    assert.ok(h.row(42), 'the other rows stay');
  } finally { await h.teardown(); }
});

test('W1: a failed add sends no dismiss and keeps the row (non-optimistic)', async () => {
  const h = await mountWl({ addStatus: 500 });
  try {
    await h.open();
    h.click((await h.openMenu(41))['Watch later']);
    await until(() => h.toasts.length > 0, 'the failure toast');
    await wait(30);
    assert.strictEqual(h.calls.filter(isDismiss).length, 0, 'no dismiss after a failed add');
    assert.ok(h.row(41), 'the row stays');
    assert.deepStrictEqual(h.toasts, ['Could not add to Watch later.']);
  } finally { await h.teardown(); }
});

test('W1: a good add then a failed dismiss keeps the row, says so, and the menu stops offering the add', async () => {
  const h = await mountWl({ dismissStatus: 500 });
  try {
    await h.open();
    h.click((await h.openMenu(41))['Watch later']);
    await until(() => h.toasts.length > 0, 'the toast');
    await wait(30);
    assert.ok(h.row(41), 'the row stays when the dismiss failed');
    assert.deepStrictEqual(h.toasts, ['Added to Watch later, but could not dismiss the notification.']);
    await until(() => !h.menuItems(), 'the menu to close');
    const again = await h.openMenu(41);
    assert.strictEqual(again['Watch later'], undefined, 'the item is in Watch later now: not offered again');
    assert.ok(again.Dismiss, 'the plain dismiss is still there for a retry');
  } finally { await h.teardown(); }
});

test('W1: an item already in Watch later is not offered (membership read fresh on open)', async () => {
  const h = await mountWl({ listed: ['Vídeo-One'] });
  try {
    await h.open();
    await until(() => h.calls.some((c) => c.url === '/api/watch-later/ids'), 'the membership read');
    await wait(10);
    const items = await h.openMenu(41);
    assert.deepStrictEqual(Object.keys(items), ['Open channel', 'Dismiss', 'Delete file']);
    h.key(h.doc, 'Escape');
    await until(() => !h.menuItems(), 'the menu to close');
    assert.ok((await h.openMenu(42))['Watch later'], 'a row NOT listed still offers it');
  } finally { await h.teardown(); }
});

test('W1: a second tap while the add is in flight sends nothing more (the busy row)', async () => {
  const h = await mountWl({ holdAdd: true });
  try {
    await h.open();
    h.click((await h.openMenu(41))['Watch later']);
    await until(() => h.calls.some(isWlPost), 'the held add');
    await until(() => !h.menuItems(), 'the menu to close');
    h.click((await h.openMenu(41))['Watch later']);
    await wait(20);
    assert.strictEqual(h.calls.filter(isWlPost).length, 1, 'still one add');
    h.release();
    await until(() => !h.row(41), 'the row to leave');
    assert.strictEqual(h.calls.filter(isDismiss).length, 1, 'one dismiss');
  } finally { await h.teardown(); }
});

test('W2: a podcast row adds with its kind stated (?kind=podcast), then dismisses', async () => {
  const h = await mountWl();
  try {
    await h.open();
    h.click((await h.openMenu(43))['Watch later']);
    await until(() => !h.row(43), 'the row to leave');
    const adds = h.calls.filter((c) => c.method === 'POST' && c.url.indexOf('/api/watch-later/') === 0);
    assert.deepStrictEqual(adds.map((c) => c.url), ['/api/watch-later/ep-1?kind=podcast']);
    assert.deepStrictEqual(h.calls.filter(isDismiss).map((c) => JSON.parse(c.body)), [{ id: 43 }]);
  } finally { await h.teardown(); }
});

test('W2: a podcast already listed (its `podcast:` key) is not offered; the same id as a MEDIA key does not hide it', async () => {
  const h = await mountWl({ listed: ['podcast:ep-1'] });
  try {
    await h.open();
    await until(() => h.calls.some((c) => c.url === '/api/watch-later/ids'), 'the membership read');
    await wait(10);
    assert.strictEqual((await h.openMenu(43))['Watch later'], undefined);
  } finally { await h.teardown(); }
  const h2 = await mountWl({ listed: ['ep-1'] });
  try {
    await h2.open();
    await until(() => h2.calls.some((c) => c.url === '/api/watch-later/ids'), 'the membership read');
    await wait(10);
    assert.ok((await h2.openMenu(43))['Watch later'], 'a bare id is a media key, not this episode');
  } finally { await h2.teardown(); }
});

test('W1: engine rows never offer Watch later', async () => {
  const h = await mountWl();
  try {
    await h.open();
    assert.strictEqual((await h.openMenu(44))['Watch later'], undefined, 'engine row');
  } finally { await h.teardown(); }
});
