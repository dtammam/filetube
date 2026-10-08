'use strict';

// [UNIT] UI pass sweep S4 (D8.3, Dean: "Notification delete leaves the row") - the
// notification panel's ONE destructive path, under the full gate (LESSONS 9).
//
// The panel is the REAL injectNotificationBellIfEnabled (public/js/common.js) with the
// REAL ui.js (sheet / menu / confirm) and the REAL interaction.js (onActionMenu,
// swipeRow) bound to one jsdom window (test/helpers/notif-panel-harness.js). Delete file
// is reached from the row menu (kebab, long-press, desktop right-click) and from a swipe
// left's Delete button; a full swipe dismisses. The assertion that matters is the
// request log: NO path reaches DELETE /api/videos/:id unless ui.confirm resolved true,
// and one OK sends exactly one request, with the same endpoint the v1.161 button used.

const { test } = require('node:test');
const assert = require('node:assert');
const { mountBell, until, wait, res, ROW_W } = require('../helpers/notif-panel-harness');
const common = require('../../public/js/common.js');

const DELETE_URL = '/api/videos/' + encodeURIComponent('Vídeo-One');
const DISMISSALS = ['cancel', 'esc', 'scrim', 'close'];

// Answer the open confirm without a yes.
function dismissConfirm(h, how) {
  const c = h.confirm();
  assert.ok(c, 'a confirm is open');
  if (how === 'cancel') h.click(c.cancel);
  else if (how === 'close') h.click(c.close);
  else if (how === 'esc') h.key(h.doc, 'Escape');
  else if (how === 'scrim') h.click(c.sheet.previousElementSibling && c.sheet.previousElementSibling.classList.contains('ui-scrim') ? c.sheet.previousElementSibling : Array.from(h.doc.querySelectorAll('.ui-scrim')).pop());
  else throw new Error(how);
}
async function closedConfirm(h) { await until(() => !h.confirm(), 'the confirm to close'); }

test('D8.3: the row menu holds Open channel, Dismiss and Delete file on a media row; Delete is danger and asks first', async () => {
  const h = await mountBell();
  try {
    await h.open();
    const items = await h.openMenu(41);
    assert.deepStrictEqual(Object.keys(items), ['Watch later', 'Open channel', 'Dismiss', 'Delete file']);
    assert.ok(items['Delete file'].classList.contains('ui-row--danger'), 'Delete file reads as destructive');
    h.click(items['Delete file']);
    const c = await h.waitConfirm();
    // The copy says what the one path does (lib/media/routes.js: a trash move).
    assert.strictEqual(c.title, 'Move to Trash?');
    assert.strictEqual(c.ok.textContent, 'Move to Trash');
    assert.ok(c.ok.classList.contains('ui-btn--destructive'), 'the confirm button is the danger fill');
    assert.match(c.sheet.textContent, /"Vídeo One" leaves your library now\. It stays in Trash/);
    assert.strictEqual(h.deletes().length, 0, 'nothing is deleted while the confirm is up');
    dismissConfirm(h, 'cancel');
    await closedConfirm(h);
  } finally { await h.teardown(); }
});

test('D8.3 / v1.376.0 W2: a podcast row offers Watch later and Delete (its own route, behind the confirm); an engine row only dismisses', async () => {
  const h = await mountBell();
  try {
    await h.open();
    let items = await h.openMenu(43);
    assert.deepStrictEqual(Object.keys(items), ['Watch later', 'Open show', 'Dismiss', 'Delete file'], 'a podcast row: the media row\'s options');
    h.key(h.doc, 'Escape');
    await until(() => !h.menuItems(), 'the menu to close');
    items = await h.openMenu(44);
    assert.deepStrictEqual(Object.keys(items), ['Dismiss'], 'an engine row only dismisses');
    h.key(h.doc, 'Escape');
    await until(() => !h.menuItems(), 'the menu to close');
    assert.deepStrictEqual(Array.from(h.wrap(43).querySelectorAll('.ui-swipe__action')).map((b) => b.dataset.action), ['dismiss', 'delete']);
    assert.deepStrictEqual(Array.from(h.wrap(44).querySelectorAll('.ui-swipe__action')).map((b) => b.dataset.action), ['dismiss']);
    assert.deepStrictEqual(Array.from(h.wrap(41).querySelectorAll('.ui-swipe__action')).map((b) => [b.dataset.action, b.className]),
      [['dismiss', 'ui-swipe__action ui-swipe__action--neutral'], ['delete', 'ui-swipe__action ui-swipe__action--danger']]);
  } finally { await h.teardown(); }
});

test('v1.376.0 W2: a podcast row\'s Delete asks with the EPISODE copy; Cancel sends nothing; OK sends ONE DELETE /api/podcasts/episodes/:id, then the dismiss, and never /api/videos', async () => {
  const h = await mountBell({ route: (method, url) => (method === 'DELETE' && url.indexOf('/api/podcasts/episodes/') === 0 ? res(200, { ok: true, status: 'trashed' }) : null) });
  try {
    await h.open();
    h.click((await h.openMenu(43))['Delete file']);
    let c = await h.waitConfirm();
    assert.strictEqual(c.title, 'Move to Trash?');
    assert.match(c.sheet.textContent, /“Episode” moves to Trash\. You can restore it from this episode list\./);
    dismissConfirm(h, 'cancel');
    await closedConfirm(h);
    await wait(20);
    assert.strictEqual(h.deletes().length, 0, 'Cancel: nothing sent');
    assert.ok(h.row(43), 'the row stays');
    h.click((await h.openMenu(43))['Delete file']);
    c = await h.waitConfirm();
    h.click(c.ok);
    await until(() => !h.row(43), 'the row to leave');
    assert.deepStrictEqual(h.deletes().map((d) => d.url), ['/api/podcasts/episodes/ep-1'], 'the episode route, once');
    assert.deepStrictEqual(h.dismissals().map((d) => JSON.parse(d.body)), [{ id: 43 }]);
  } finally { await h.teardown(); }
});

test('v1.376.0 W2: a failed podcast delete keeps the row and says so', async () => {
  const toasts = [];
  const h = await mountBell({ route: (method, url) => (method === 'DELETE' && url.indexOf('/api/podcasts/episodes/') === 0 ? res(403, { error: 'no' }) : null) });
  h.w.showToast = (m) => toasts.push(m);
  try {
    await h.open();
    h.click((await h.openMenu(43))['Delete file']);
    h.click((await h.waitConfirm()).ok);
    await until(() => toasts.length > 0, 'the toast');
    assert.deepStrictEqual(toasts, ['Could not delete the episode.']);
    assert.ok(h.row(43));
    assert.strictEqual(h.dismissals().length, 0);
  } finally { await h.teardown(); }
});

for (const how of DISMISSALS) {
  test(`menu Delete file, then ${how}: NO delete request, the row stays`, async () => {
    const h = await mountBell();
    try {
      await h.open();
      const items = await h.openMenu(41);
      h.click(items['Delete file']);
      await h.waitConfirm();
      dismissConfirm(h, how);
      await closedConfirm(h);
      await wait(30);
      assert.deepStrictEqual(h.deletes(), [], `${how} sends no DELETE`);
      assert.strictEqual(h.dismissals().length, 0, `${how} dismisses nothing`);
      assert.ok(h.row(41), 'the row is still there');
    } finally { await h.teardown(); }
  });
}

for (const how of DISMISSALS) {
  test(`swipe left, tap Delete, then ${how}: NO delete request`, async () => {
    const h = await mountBell();
    try {
      await h.open();
      await h.swipe(41, 120); // past half the two actions (154px): snaps open, short of a full swipe
      assert.ok(h.wrap(41).classList.contains('is-open'), 'the row is swiped open');
      h.tap(h.swipeAction(41, 'delete'));
      await h.waitConfirm();
      assert.ok(!h.wrap(41).classList.contains('is-open'), 'choosing an action closed the row');
      dismissConfirm(h, how);
      await closedConfirm(h);
      await wait(30);
      assert.deepStrictEqual(h.deletes(), []);
      assert.strictEqual(h.dismissals().length, 0);
    } finally { await h.teardown(); }
  });
}

test('a fast full swipe past 60% DISMISSES (the same POST as before) and never deletes, on a deletable media row', async () => {
  const h = await mountBell();
  try {
    await h.open();
    const fullAt = Math.ceil(ROW_W * 0.6);
    h.drag(h.row(41), [380, 380 - fullAt - 5]); // two samples, far: a flick
    await until(() => h.dismissals().length === 1, 'the dismiss');
    await wait(30);
    assert.deepStrictEqual(JSON.parse(h.dismissals()[0].body), { id: 41 });
    assert.deepStrictEqual(h.deletes(), [], 'a full swipe never deletes');
    assert.strictEqual(h.confirm(), null, 'and never even asks');
    await until(() => !h.row(41), 'the dismissed row leaves');
    assert.ok(h.row(42), 'the other rows stay');
  } finally { await h.teardown(); }
});

test('swipe then tap the row content: only closes the row - no navigation, no mark-read, no delete', async () => {
  const h = await mountBell();
  try {
    await h.open();
    await h.swipe(41, 120);
    assert.ok(h.wrap(41).classList.contains('is-open'));
    const link = h.row(41).querySelector('.ui-row__link');
    const e = h.click(link);
    assert.ok(e.defaultPrevented, 'the link does not navigate');
    assert.ok(!h.wrap(41).classList.contains('is-open'), 'the row closed');
    h.click(link); // a second tap is a normal tap on a closed row (navigation is the router's)
    await wait(30);
    assert.deepStrictEqual(h.deletes(), []);
    assert.strictEqual(h.confirm(), null);
    assert.strictEqual(h.calls.filter((c) => c.url === '/api/notifications/read').length, 1, 'only the second, closed-row tap marks read');
  } finally { await h.teardown(); }
});

test('a double tap on the revealed Delete opens ONE confirm; a double tap on the menu item opens ONE confirm', async () => {
  const h = await mountBell();
  try {
    await h.open();
    await h.swipe(41, 120);
    const del = h.swipeAction(41, 'delete');
    h.tap(del);
    h.tap(del); // the row closed on the first tap: the second is inert
    await h.waitConfirm();
    await wait(30);
    assert.strictEqual(h.openConfirms(), 1, 'one dialog');
    dismissConfirm(h, 'cancel');
    await closedConfirm(h);
    const items = await h.openMenu(41);
    h.click(items['Delete file']);
    h.click(items['Delete file']); // tapped again while the menu animates out
    await h.waitConfirm();
    await wait(30);
    assert.strictEqual(h.openConfirms(), 1, 'one dialog');
    dismissConfirm(h, 'esc');
    await closedConfirm(h);
    await wait(30);
    assert.deepStrictEqual(h.deletes(), []);
  } finally { await h.teardown(); }
});

test('keyboard: Enter / Space / a detail-0 click on a CLOSED row\'s Delete do nothing (the underlay is inert)', async () => {
  const h = await mountBell();
  try {
    await h.open();
    const actions = h.wrap(41).querySelector('.ui-swipe__actions');
    assert.ok(actions.hasAttribute('inert') && actions.getAttribute('aria-hidden') === 'true', 'closed: inert + aria-hidden');
    const del = h.swipeAction(41, 'delete');
    h.key(del, 'Enter');
    h.key(del, ' ');
    h.click(del, 0); // what a browser dispatches for a keyboard activation
    h.tap(del); // and a pointer tap
    await wait(40);
    assert.strictEqual(h.confirm(), null, 'no confirm');
    assert.deepStrictEqual(h.deletes(), []);
    // Enter anywhere while a confirm is up never answers it.
    const items = await h.openMenu(41);
    h.click(items['Delete file']);
    const c = await h.waitConfirm();
    h.key(h.doc, 'Enter');
    h.key(c.sheet, 'Enter');
    await wait(40);
    assert.ok(h.confirm(), 'Enter does not answer the dialog');
    assert.deepStrictEqual(h.deletes(), []);
    dismissConfirm(h, 'cancel');
    await closedConfirm(h);
  } finally { await h.teardown(); }
});

test('two rows swiped open in sequence: the first closes, its Delete goes inert; only the open row\'s Delete asks', async () => {
  const h = await mountBell();
  try {
    await h.open();
    await h.swipe(41, 120);
    await h.swipe(42, 120);
    assert.ok(!h.wrap(41).classList.contains('is-open'), 'opening the second closed the first');
    assert.ok(h.wrap(42).classList.contains('is-open'));
    h.tap(h.swipeAction(41, 'delete'));
    h.click(h.swipeAction(41, 'delete'), 0);
    await wait(40);
    assert.strictEqual(h.confirm(), null, 'the closed row\'s Delete is inert');
    assert.ok(!h.wrap(42).classList.contains('is-open'), 'a press outside the open row closed it too');
    await h.swipe(42, 120);
    h.tap(h.swipeAction(42, 'delete'));
    const c = await h.waitConfirm();
    assert.match(c.sheet.textContent, /"Vídeo Two"/, 'the confirm names the row that asked');
    dismissConfirm(h, 'scrim');
    await closedConfirm(h);
    await wait(30);
    assert.deepStrictEqual(h.deletes(), []);
  } finally { await h.teardown(); }
});

test('a late OK: Esc then OK on the closing dialog, the panel closing under it, a back navigation - none deletes', async () => {
  const h = await mountBell();
  try {
    await h.open();
    // 1. Esc, then OK tapped while the dialog animates out.
    let items = await h.openMenu(41);
    h.click(items['Delete file']);
    let c = await h.waitConfirm();
    h.key(h.doc, 'Escape');
    h.click(c.ok);
    await wait(400);
    assert.deepStrictEqual(h.deletes(), [], 'Esc then a late OK');
    // 2. A back navigation (popstate) closes the panel - and, through its signal, the confirm.
    items = await h.openMenu(41);
    h.click(items['Delete file']);
    c = await h.waitConfirm();
    h.w.dispatchEvent(new h.w.PopStateEvent('popstate', { state: null }));
    await closedConfirm(h);
    assert.ok(!h.panel().classList.contains('is-open'), 'the panel closed');
    h.click(c.ok); // the stale dialog's OK
    await wait(400);
    assert.deepStrictEqual(h.deletes(), [], 'a confirm left over the navigation never deletes');
    // 3. Any other path that closes the panel (here the bell's own toggle, called directly -
    // in a browser the scrims cover it) closes the confirm with it; its stale OK is dead.
    await h.open();
    items = await h.openMenu(41);
    h.click(items['Delete file']);
    c = await h.waitConfirm();
    h.bell.click();
    await closedConfirm(h);
    h.click(c.ok);
    await wait(400);
    assert.deepStrictEqual(h.deletes(), [], 'the panel closing answers the confirm false');
  } finally { await h.teardown(); }
});

test('POSITIVE: OK sends exactly ONE DELETE /api/videos/:id (no body), then dismisses that row\'s notification and drops the row', async () => {
  const h = await mountBell();
  try {
    await h.open();
    const items = await h.openMenu(41);
    h.click(items['Delete file']);
    const c = await h.waitConfirm();
    h.click(c.ok);
    h.click(c.ok); // a double tap on OK
    await until(() => h.deletes().length === 1, 'the DELETE');
    await until(() => !h.row(41), 'the row leaves');
    await wait(40);
    assert.deepStrictEqual(h.deletes().map((d) => [d.method, d.url, d.body]), [['DELETE', DELETE_URL, undefined]]);
    assert.deepStrictEqual(h.dismissals().map((d) => JSON.parse(d.body)), [{ id: 41 }], 'the deleted video\'s notification is dismissed');
    assert.strictEqual(h.calls.filter((x) => x.url === '/api/notifications/read').length, 0, 'deleting never marks read or navigates');
    assert.ok(h.row(42) && h.row(43) && h.row(44), 'only that row left');
  } finally { await h.teardown(); }
});

test('POSITIVE: the swipe\'s Delete then OK sends exactly one DELETE for THAT row', async () => {
  const h = await mountBell();
  try {
    await h.open();
    await h.swipe(42, 120);
    h.tap(h.swipeAction(42, 'delete'));
    const c = await h.waitConfirm();
    h.click(c.ok);
    await until(() => h.deletes().length === 1, 'the DELETE');
    await wait(40);
    assert.deepStrictEqual(h.deletes().map((d) => d.url), ['/api/videos/' + encodeURIComponent('Vídeo-Two')]);
  } finally { await h.teardown(); }
});

test('NON-OPTIMISTIC: a failed DELETE keeps the row and dismisses nothing; a retry asks again', async () => {
  const h = await mountBell({ route: (method, url) => (method === 'DELETE' ? res(500, {}) : null) });
  try {
    await h.open();
    let items = await h.openMenu(41);
    h.click(items['Delete file']);
    let c = await h.waitConfirm();
    h.click(c.ok);
    await until(() => h.deletes().length === 1, 'the DELETE');
    await wait(40);
    assert.ok(h.row(41), 'the row stays');
    assert.strictEqual(h.dismissals().length, 0, 'a failed delete never dismisses');
    items = await h.openMenu(41);
    h.click(items['Delete file']);
    c = await h.waitConfirm();
    dismissConfirm(h, 'cancel');
    await closedConfirm(h);
    await wait(30);
    assert.strictEqual(h.deletes().length, 1, 'the retry asked again and Cancel sent nothing');
  } finally { await h.teardown(); }
});

test('the row menu opens from the kebab, a long-press and a desktop right-click; none of them deletes', async () => {
  const h = await mountBell();
  try {
    await h.open();
    // long-press (the real FTInteraction timer)
    h.pe('pointerdown', h.row(42).querySelector('.ui-row__title'), { x: 100, y: 100, id: 3 });
    await until(() => h.menuItems(), 'the long-press menu', 1500);
    h.pe('pointerup', h.row(42).querySelector('.ui-row__title'), { x: 100, y: 100, id: 3 });
    h.key(h.doc, 'Escape');
    await until(() => !h.menuItems(), 'the menu to close');
    await wait(650); // past the fired press's contextmenu grace (interaction.js, 600ms)
    // desktop right-click
    const e = new h.w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 50, clientY: 60 });
    h.row(42).querySelector('.ui-row__title').dispatchEvent(e);
    assert.ok(e.defaultPrevented, 'the native menu is replaced');
    await until(() => h.menuItems(), 'the right-click menu');
    assert.deepStrictEqual(Object.keys(h.menuItems()), ['Watch later', 'Open channel', 'Dismiss', 'Delete file']);
    h.key(h.doc, 'Escape');
    await until(() => !h.menuItems(), 'the menu to close');
    await wait(30);
    assert.deepStrictEqual(h.deletes(), []);
  } finally { await h.teardown(); }
});

test('Clear all asks first (danger); Cancel clears nothing, OK sends the same POST /api/notifications/clear once', async () => {
  const h = await mountBell();
  try {
    await h.open();
    const clear = h.doc.getElementById('notif-clear-btn');
    h.click(clear);
    let c = await h.waitConfirm();
    assert.strictEqual(c.title, 'Clear all notifications?');
    assert.ok(c.ok.classList.contains('ui-btn--destructive'));
    dismissConfirm(h, 'cancel');
    await closedConfirm(h);
    await wait(30);
    assert.strictEqual(h.calls.filter((x) => x.url === '/api/notifications/clear').length, 0, 'Cancel clears nothing');
    assert.strictEqual(h.rows().length, 4);
    h.click(clear);
    c = await h.waitConfirm();
    h.click(c.ok);
    h.click(c.ok);
    await until(() => h.doc.querySelector('#notif-panel .ui-state'), 'the empty state');
    await wait(30);
    assert.deepStrictEqual(h.calls.filter((x) => x.url === '/api/notifications/clear').map((x) => x.method), ['POST']);
    assert.deepStrictEqual(h.deletes(), [], 'Clear all deletes no file');
  } finally { await h.teardown(); }
});

// The two guards ui.confirm itself masks (the mutation pass found both unbound): the wiring
// sends only on EXACTLY true, and re-checks the panel's signal AFTER the answer. Each is
// driven with a stand-in confirm that answers what the real one never would, so only that
// guard stands between the answer and the request.
test('only an answer of exactly `true` deletes: a truthy non-true answer (1, "yes", {}) sends nothing', async () => {
  const h = await mountBell();
  try {
    await h.open();
    for (const answer of [1, 'yes', {}]) {
      h.w.ui.confirm = () => Promise.resolve(answer);
      const items = await h.openMenu(41);
      h.click(items['Delete file']);
      await until(() => !h.menuItems(), 'the menu to close');
      await wait(30);
    }
    assert.deepStrictEqual(h.deletes(), []);
  } finally { await h.teardown(); }
});

test('a yes that lands after the panel closed sends nothing (the post-answer signal re-check)', async () => {
  const h = await mountBell();
  try {
    await h.open();
    let answer;
    h.w.ui.confirm = () => new Promise((r) => { answer = r; });
    const items = await h.openMenu(41);
    h.click(items['Delete file']);
    await until(() => typeof answer === 'function', 'the confirm to be asked');
    h.bell.click(); // the panel closes (in a browser: Esc, a back navigation, the feature going off)
    await until(() => !h.panel().classList.contains('is-open'), 'the panel to close');
    answer(true); // a stand-in confirm that ignored the abort
    await wait(40);
    assert.deepStrictEqual(h.deletes(), [], 'the panel closed first: the late yes is refused');
  } finally { await h.teardown(); }
});

test('the pure decisions: menu items per kind, the delete copy, the show link', () => {
  const media = common.buildNotificationRowModel({ id: 1, mediaId: 'a', title: 'T', createdAt: 1, folderName: 'Földer Ä' });
  assert.strictEqual(media.channelHref, '/?folder=' + encodeURIComponent('Földer Ä'));
  assert.deepStrictEqual(common.buildNotificationMenuItems(media).map((i) => [i.value, i.label, !!i.danger]),
    [['watchlater', 'Watch later', false], ['channel', 'Open channel', false], ['dismiss', 'Dismiss', false], ['delete', 'Delete file', true]]);
  // v1.376.0: an item already in Watch later is not offered again; unknown membership offers it.
  assert.deepStrictEqual(common.buildNotificationMenuItems(media, { inWatchLater: true }).map((i) => i.value), ['channel', 'dismiss', 'delete']);
  assert.deepStrictEqual(common.buildNotificationMenuItems(media, { inWatchLater: false }).map((i) => i.value)[0], 'watchlater');
  assert.deepStrictEqual(common.buildNotificationMenuItems(media, { inWatchLater: null }).map((i) => i.value)[0], 'watchlater');
  const noFolder = common.buildNotificationRowModel({ id: 2, mediaId: 'b', title: 'T', createdAt: 1 });
  assert.deepStrictEqual(common.buildNotificationMenuItems(noFolder).map((i) => i.value), ['watchlater', 'dismiss', 'delete'], 'no folder: no channel item');
  const pod = common.buildNotificationRowModel({ id: 3, mediaId: 'e', kind: 'podcast', title: 'E', createdAt: 1, artUrl: '/podcastart/s%C3%BCb%2Fx' });
  assert.strictEqual(pod.channelHref, '/podcasts?show=' + encodeURIComponent('süb/x'));
  assert.deepStrictEqual(common.buildNotificationMenuItems(pod).map((i) => i.value), ['watchlater', 'channel', 'dismiss', 'delete'], 'v1.376.0 W2');
  assert.deepStrictEqual(common.buildNotificationMenuItems(pod, { inWatchLater: true }).map((i) => i.value), ['channel', 'dismiss', 'delete']);
  const podCopy = common.notifDeleteConfirmCopy(pod);
  assert.match(podCopy.body, /“E” moves to Trash\. You can restore it from this episode list\./, 'a podcast row asks the episode copy');
  assert.strictEqual(common.notifShowHref('/podcastart/%E0%A4%A'), null, 'a malformed escape is no link');
  assert.strictEqual(common.notifShowHref('/thumbnail/x'), null);
  const eng = common.buildNotificationRowModel({ id: 4, mediaId: 'engine:updated:1', kind: 'engine', title: 'E', createdAt: 1 });
  assert.deepStrictEqual(common.buildNotificationMenuItems(eng).map((i) => i.value), ['dismiss']);
  assert.deepStrictEqual(common.buildNotificationMenuItems(eng, { inWatchLater: false }).map((i) => i.value), ['dismiss'], 'an engine row never offers Watch later');
  const copy = common.notifDeleteConfirmCopy({ title: 'Ünïcode' });
  assert.deepStrictEqual([copy.title, copy.confirmLabel, copy.danger], ['Move to Trash?', 'Move to Trash', true]);
  assert.doesNotMatch(copy.title + copy.body + copy.confirmLabel, /permanent/i, 'the path is a trash move, never "permanently"');
});
