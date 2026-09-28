'use strict';

// [UNIT] UI pass sweep S4 - the notification panel on the primitives, driven in jsdom with
// the REAL injector, ui.js and interaction.js (test/helpers/notif-panel-harness.js).
//
//   - D4.6: the panel is ONE ui.sheet (a popover under the bell on desktop, a bottom sheet on
//     the phone); its open class is applied under Reduce Motion too (the F48 class);
//   - F28 / AC5: every row renders EVERY column - lead (the dot column), media, body, aside
//     (the thumbnail) and exactly one action slot (the kebab) - whatever its kind or read
//     state, so no optional child can move a column (the rendered x-offsets are G1's,
//     test/geometry);
//   - D4.4: a podcast row's media is its show ART (a rounded ui-art), a channel row a circle;
//   - AC4: no text glyph and no retired control (the X, the "Sure?" arm) is left;
//   - D9: loading is the real row grid, empty and error are ui.state.

const { test } = require('node:test');
const assert = require('node:assert');
const { mountBell, until, wait, res } = require('../helpers/notif-panel-harness');

test('D4.6: the panel is a ui.sheet - a popover anchored at the bell on desktop, a bottom sheet on the phone', async () => {
  let h = await mountBell();
  try {
    await h.open();
    const p = h.panel();
    assert.ok(p.classList.contains('ui-sheet') && p.classList.contains('ui-sheet--popover'), p.className);
    assert.strictEqual(p.querySelector('.ui-sheet__title').textContent, 'Notifications');
    assert.strictEqual(h.bell.getAttribute('aria-expanded'), 'true');
    h.key(h.doc, 'Escape');
    await until(() => !p.classList.contains('is-open'), 'Esc closes');
    assert.strictEqual(h.bell.getAttribute('aria-expanded'), 'false');
  } finally { await h.teardown(); }
  h = await mountBell({ phone: true });
  try {
    await h.open();
    assert.ok(h.panel().classList.contains('ui-sheet--bottom'), h.panel().className);
  } finally { await h.teardown(); }
});

test('F48 class: under Reduce Motion the panel still gets its open class (visible), and closes', async () => {
  const h = await mountBell({ reducedMotion: true, phone: true });
  try {
    await h.open();
    assert.ok(h.panel().classList.contains('is-open'), 'the open class is applied');
    const scrim = Array.from(h.doc.querySelectorAll('.ui-scrim')).pop();
    assert.ok(scrim.classList.contains('is-open'));
    h.click(scrim);
    await until(() => !h.doc.getElementById('notif-panel'), 'the scrim closes it (and it leaves the DOM)', 1500);
  } finally { await h.teardown(); }
});

test('F28 / AC5: every row renders every column - lead, media, body, aside thumb and ONE kebab - whatever its kind or read state', async () => {
  const h = await mountBell();
  try {
    await h.open();
    const list = h.doc.getElementById('notif-panel-list');
    for (const cls of ['ui-list--lead', 'ui-list--media-avatar', 'ui-list--aside-thumb', 'ui-list--actions-1']) {
      assert.ok(list.classList.contains(cls), `the list declares ${cls}`);
    }
    const rows = h.rows();
    assert.deepStrictEqual(rows.map((r) => r.dataset.kind), ['media', 'media', 'podcast', 'engine']);
    for (const r of rows) {
      const slots = Array.from(r.children).map((c) => c.className.split(' ')[0]);
      assert.deepStrictEqual(slots, ['ui-row__lead', 'ui-row__media', 'ui-row__body', 'ui-row__aside', 'ui-row__actions'], `row ${r.dataset.notifId}`);
      const acts = r.querySelector('.ui-row__actions').children;
      assert.strictEqual(acts.length, 1, 'exactly one action slot');
      assert.ok(acts[0].classList.contains('ui-btn') && acts[0].classList.contains('ui-btn--icon') && acts[0].classList.contains('notif-more'), 'the kebab is a ui-btn icon (the 44px --hit area is the primitive\'s)');
      assert.strictEqual(acts[0].querySelector('use').getAttribute('href'), '#i-more_vert');
      assert.ok(r.querySelector('.ui-row__aside > .ui-thumb'), 'the thumbnail column is filled on every row');
      assert.strictEqual(r.querySelector('.ui-row__meta .notif-row-time').textContent.length > 0, true, 'the time line (masked in captures by .notif-row-time)');
    }
    // the dot marks unread rows only; its column is there on read rows too
    assert.deepStrictEqual(rows.map((r) => !!r.querySelector('.ui-row__lead > .ui-row__dot')), [true, false, true, false]);
    // no retired control and no text glyph (AC4)
    const panel = h.panel();
    assert.strictEqual(panel.querySelectorAll('.notif-row-dismiss, .notif-row-delete, .notif-row-delete-confirm').length, 0);
    assert.doesNotMatch(panel.textContent, /[×✕⋮▴▾]|Sure\?/);
    for (const b of panel.querySelectorAll('button')) assert.match(b.className, /\bui-/, `every button is a primitive: ${b.outerHTML.slice(0, 80)}`);
  } finally { await h.teardown(); }
});

test('D4.4: a podcast row\'s media is its show ART (rounded ui-art), a media row a circle; the engine row a monogram', async () => {
  const rows = [
    { id: 1, mediaId: 'v', kind: 'media', title: 'V', createdAt: 1767000000000, unread: false, channelName: 'Harbor Workshop', channelAvatarUrl: 'https://yt3.example/av.jpg', hasThumbnail: true },
    { id: 2, mediaId: 'e', kind: 'podcast', title: 'E', createdAt: 1767000000000, unread: false, channelName: 'Harbor Lights Radio', artUrl: '/podcastart/pod-harbor' },
    { id: 3, mediaId: 'engine:updated:1', kind: 'engine', title: 'Downloader engine updated to 1', createdAt: 1767000000000, unread: false },
  ];
  const h = await mountBell({ rows });
  try {
    await h.open();
    const media = (id) => h.row(id).querySelector('.ui-row__media').firstElementChild;
    assert.ok(media(1).classList.contains('ui-avatar'), 'a channel is a circle');
    assert.strictEqual(media(1).querySelector('img').getAttribute('src'), 'https://yt3.example/av.jpg');
    assert.ok(media(2).classList.contains('ui-art'), 'a podcast is rounded art');
    assert.strictEqual(media(2).querySelector('img').getAttribute('src'), '/podcastart/pod-harbor', 'its artwork, never a generated glyph');
    assert.strictEqual(media(3).querySelector('.ui-avatar__mono').textContent, 'DE', 'no art: the monogram');
  } finally { await h.teardown(); }
});

test('the row tap marks read, clears its dot and closes the panel; a media row seeds the watch page, a podcast row does not', async () => {
  const h = await mountBell();
  try {
    await h.open();
    const link = h.row(41).querySelector('a.ui-row__link');
    assert.strictEqual(link.getAttribute('href'), '/watch.html?v=Vídeo-One');
    h.click(link);
    await until(() => !h.panel() || !h.panel().classList.contains('is-open'), 'the panel closes');
    const reads = h.calls.filter((c) => c.url === '/api/notifications/read');
    assert.deepStrictEqual(reads.map((c) => JSON.parse(c.body)), [{ id: 41 }]);
    assert.strictEqual(h.row(41).querySelector('.ui-row__dot'), null, 'the dot is gone');
    assert.deepStrictEqual(h.deletes(), []);
  } finally { await h.teardown(); }
});

test('D9: loading is the real row grid (skeleton rows in the same list); empty and error are ui.state (error retries)', async () => {
  let release;
  let fail = true;
  const gate = new Promise((r) => { release = r; });
  const h = await mountBell({
    route: (method, url) => {
      if (url === '/api/notifications' && method === 'GET') {
        if (fail) return gate.then(() => res(500, {}));
        return res(200, { items: [] });
      }
      return null;
    },
  });
  try {
    h.click(h.bell);
    await until(() => h.doc.querySelector('#notif-panel-list .ui-row[aria-hidden="true"]'), 'the skeleton');
    const sk = h.doc.querySelectorAll('#notif-panel-list > .ui-row[aria-hidden="true"]');
    assert.strictEqual(sk.length, 3);
    assert.deepStrictEqual(Array.from(sk[0].children).map((c) => c.className.split(' ')[0]), ['ui-row__lead', 'ui-row__media', 'ui-row__body', 'ui-row__aside', 'ui-row__actions']);
    release();
    await until(() => h.doc.querySelector('#notif-panel .ui-state'), 'the error state');
    assert.match(h.doc.querySelector('#notif-panel .ui-state').textContent, /Could not load notifications/);
    fail = false;
    h.click(h.doc.querySelector('#notif-panel .ui-state button'));
    await until(() => /No notifications yet/.test((h.doc.querySelector('#notif-panel .ui-state') || {}).textContent || ''), 'the empty state after a retry');
  } finally { await h.teardown(); }
});

test('Open channel / Open show navigate through the router and close the panel', async () => {
  const h = await mountBell();
  try {
    const went = [];
    h.w.FileTube = { navigate: (href) => went.push(href) };
    await h.open();
    let items = await h.openMenu(41);
    h.click(items['Open channel']);
    await wait(20);
    assert.deepStrictEqual(went, ['/?folder=' + encodeURIComponent('Chännel Földer')]);
    await until(() => !h.panel() || !h.panel().classList.contains('is-open'), 'the panel closes');
    await wait(400);
    await h.open();
    items = await h.openMenu(43);
    h.click(items['Open show']);
    await wait(20);
    assert.deepStrictEqual(went[1], '/podcasts?show=' + encodeURIComponent('süb'));
    assert.deepStrictEqual(h.deletes(), []);
  } finally { await h.teardown(); }
});

// The ui.css primitive addition this sweep made (its own commit): swipeRow wraps a row in
// div.ui-swipe, so each `.ui-list > .ui-row` rule has a `.ui-list > .ui-swipe > .ui-row` twin
// (media padding, the divider, the last-row divider drop, the undeclared lead/media hide), a
// closed row's underlay is not painted (the translucent hover/press tints showed Dismiss /
// Delete through the row in the first render), and a swipe row in a sheet slides over the
// sheet's surface.
test('ui.css: every list-child rule has its swipe-wrapped twin; a closed underlay is hidden; the sheet surface under a swipe row', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { cssRules } = require('../helpers/stylesheets');
  const rules = cssRules(fs.readFileSync(path.join(__dirname, '../../public/css/ui.css'), 'utf8'));
  const sels = (r) => r.sel.split(',').map((x) => x.trim());
  const ruleWith = (sel) => rules.find((r) => sels(r).includes(sel));
  for (const [plain, twin] of [
    ['.ui-list--media > .ui-row', '.ui-list--media > .ui-swipe > .ui-row'],
    ['.ui-list--divider-inset > .ui-row', '.ui-list--divider-inset > .ui-swipe > .ui-row'],
    ['.ui-list > .ui-row:last-child', '.ui-list > .ui-swipe:last-child > .ui-row'],
    ['.ui-list:not(.ui-list--lead) > .ui-row > .ui-row__lead', '.ui-list:not(.ui-list--lead) > .ui-swipe > .ui-row > .ui-row__lead'],
  ]) {
    const a = ruleWith(plain);
    const b = ruleWith(twin);
    assert.ok(a && b, `${plain} has its twin ${twin}`);
    assert.strictEqual(a.body, b.body, `${twin} carries the same declarations`);
  }
  const hide = ruleWith('.ui-swipe:not(.is-open):not(.is-dragging) > .ui-swipe__actions');
  assert.ok(hide && /visibility:\s*hidden/.test(hide.body), 'a closed row paints no underlay');
  const surf = ruleWith('.ui-sheet .ui-swipe__content');
  assert.ok(surf && /background-color:\s*var\(--surface-overlay\)/.test(surf.body));
});
