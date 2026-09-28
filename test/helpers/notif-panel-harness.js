'use strict';

// Sweep S4: mount the REAL notification bell + panel (public/js/common.js
// injectNotificationBellIfEnabled) or the REAL queue chrome (injectQueueChrome) in
// jsdom, with the REAL ui.js and interaction.js bound to the same window, and a
// scripted fetch that logs every request. jsdom has no layout, so the swipe's two
// measurements are answered by a getBoundingClientRect stub: a row is 390px wide and
// each revealed swipe action 77px (the phone), so a full swipe must pass 234px (60%).
//
//   const h = await mountBell({ rows, routes });  // injects, then h.open() opens the panel
//   h.calls                                       // [{ url, method, body }]
//   h.deletes()                                   // the /api/videos DELETE requests
//   await h.teardown();

const { JSDOM } = require('jsdom');
const assert = require('node:assert');

const UI_PATH = require.resolve('../../public/js/ui.js');
const IX_PATH = require.resolve('../../public/js/interaction.js');
const common = require('../../public/js/common.js');

const ROW_W = 390;
const ACTION_W = 77;

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n) { for (let i = 0; i < (n || 8); i++) await tick(); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms) {
  const end = Date.now() + (ms || 2000);
  while (Date.now() < end) { if (fn()) return; await wait(5); }
  assert.fail('timed out waiting for ' + what);
}

function mount(opts) {
  const o = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><header><div class="header-right"></div></header><main id="view-root"></main></body></html>',
    { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  global.window = w;
  global.document = w.document;
  if (o.reducedMotion || o.phone) {
    w.matchMedia = (q) => ({
      matches: (o.reducedMotion && /prefers-reduced-motion: reduce/.test(q)) || (o.phone && /max-width: 768px/.test(q)) || false,
      media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    });
  }
  // The primitives bind window.ui / window.FTInteraction when they load: load them now.
  delete require.cache[UI_PATH];
  require(UI_PATH);
  delete require.cache[IX_PATH];
  require(IX_PATH);
  // Each instance baked in THIS window; a later plain require() gets a fresh module.
  delete require.cache[UI_PATH];
  delete require.cache[IX_PATH];
  w.Element.prototype.getBoundingClientRect = function () {
    let width = 0;
    let height = 0;
    if (this.classList && this.classList.contains('ui-swipe__actions')) { width = ACTION_W * this.children.length; height = 64; }
    else if (this.classList && this.classList.contains('ui-swipe__content')) { width = ROW_W; height = 64; }
    return { left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON() {} };
  };
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = (url, init) => {
    const method = (init && init.method) || 'GET';
    const call = { url, method, body: init && init.body };
    calls.push(call);
    const custom = o.route && o.route(method, url, call);
    if (custom) return Promise.resolve(custom);
    return Promise.resolve(res(200, {}));
  };
  function pe(type, el, p) {
    const q = p || {};
    const e = new w.PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: q.id ?? 7, pointerType: q.pointerType ?? 'touch', isPrimary: true, button: q.button ?? 0,
      clientX: q.x ?? 300, clientY: q.y ?? 100,
    });
    el.dispatchEvent(e);
    return e;
  }
  function click(el, detail) {
    const e = new w.MouseEvent('click', { bubbles: true, cancelable: true, detail: detail === undefined ? 1 : detail });
    el.dispatchEvent(e);
    return e;
  }
  function key(el, k) {
    const e = new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  }
  // A horizontal drag on `el` (a row's content): down at xs[0], a move to each x, up at the last.
  function drag(el, xs, q) {
    const p = q || {};
    pe('pointerdown', el, { x: xs[0], id: p.id });
    for (const x of xs.slice(1)) pe('pointermove', el, { x, id: p.id });
    pe('pointerup', el, { x: xs[xs.length - 1], id: p.id });
  }
  // A real tap on a revealed swipe action: down + up on it, then the click.
  function tap(el, detail) {
    pe('pointerdown', el, { id: 9, x: 350 });
    pe('pointerup', el, { id: 9, x: 350 });
    return click(el, detail);
  }
  async function teardown() {
    try { if (typeof common.__stopNotificationBellPollForTests === 'function') common.__stopNotificationBellPollForTests(); } catch (_) { /* no bell */ }
    // Let closing sheets finish (their fallback timer) before the window goes.
    for (let i = 0; i < 60 && w.document.querySelector('.ui-sheet'); i++) {
      w.document.querySelectorAll('.ui-sheet').forEach(() => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })));
      await wait(20);
    }
    global.fetch = realFetch;
    delete global.window;
    delete global.document;
    w.close();
  }
  return { dom, w, doc: w.document, calls, pe, click, key, drag, tap, teardown };
}

function res(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// ---- the bell ----

// Rows: one of each kind the panel renders, read and unread (the server shape,
// lib/notifications/routes.js). Ids and titles are divergent spellings on purpose.
const BELL_ROWS = [
  { id: 41, mediaId: 'Vídeo-One', kind: 'media', title: 'Vídeo One', createdAt: 1767000000000, unread: true, channelName: 'Chännel', folderName: 'Chännel Földer', channelAvatarUrl: '', hasThumbnail: true, type: 'video', durationSec: 754 },
  { id: 42, mediaId: 'Vídeo-Two', kind: 'media', title: 'Vídeo Two', createdAt: 1767000100000, unread: false, channelName: 'Chännel', folderName: 'Chännel Földer', channelAvatarUrl: '', hasThumbnail: false, type: 'video' },
  { id: 43, mediaId: 'ep-1', kind: 'podcast', title: 'Episode', createdAt: 1767000200000, unread: true, channelName: 'Show', folderName: 'Show', channelAvatarUrl: '', hasThumbnail: false, artUrl: '/podcastart/s%C3%BCb', type: 'audio', durationSec: 1800 },
  { id: 44, mediaId: 'engine:updated:2026.9.1', kind: 'engine', title: 'Downloader engine updated to 2026.9.1', createdAt: 1767000300000, unread: false, channelName: 'Downloader engine', folderName: '', channelAvatarUrl: '', hasThumbnail: false, type: 'engine' },
];

async function mountBell(opts) {
  const o = opts || {};
  const rows = o.rows || BELL_ROWS;
  let badge = o.badge ?? 4;
  const h = mount({
    ...o,
    route(method, url, call) {
      if (o.route) { const r = o.route(method, url, call); if (r) return r; }
      if (url === '/api/notifications/badge') return res(200, { count: badge });
      if (url === '/api/notifications' && method === 'GET') return res(200, { items: rows.map((r) => ({ ...r })), unseenCount: badge });
      if (url === '/api/notifications/dismiss') { badge = Math.max(0, badge - 1); return res(200, { success: true }); }
      if (method === 'DELETE' && url.indexOf('/api/videos/') === 0) return res(200, { success: true, trashed: true });
      return null;
    },
  });
  common.injectNotificationBellIfEnabled();
  await until(() => h.doc.getElementById('notif-bell-btn'), 'the bell');
  const bell = h.doc.getElementById('notif-bell-btn');
  const api = {
    ...h,
    bell,
    deletes: () => h.calls.filter((c) => c.method === 'DELETE'),
    dismissals: () => h.calls.filter((c) => c.url === '/api/notifications/dismiss'),
    panel: () => h.doc.getElementById('notif-panel'),
    rows: () => Array.from(h.doc.querySelectorAll('#notif-panel-list .ui-row[data-notif-id]')),
    row: (id) => h.doc.querySelector(`#notif-panel-list .ui-row[data-notif-id="${id}"]`),
    wrap: (id) => { const r = api.row(id); return r && r.parentNode.classList.contains('ui-swipe') ? r.parentNode : null; },
    swipeAction: (id, which) => api.wrap(id).querySelector(`.ui-swipe__action[data-action="${which}"]`),
    async open() {
      h.click(bell);
      await until(() => api.rows().length > 0 || h.doc.querySelector('#notif-panel .ui-state'), 'the panel rows');
      await until(() => api.panel().classList.contains('is-open'), 'the panel open class');
    },
    // The newest open ui.confirm dialog's parts, or null.
    confirm() {
      const acts = Array.from(h.doc.querySelectorAll('.ui-sheet--dialog.is-open .ui-confirm__actions')).pop();
      if (!acts) return null;
      const sheet = acts.closest('.ui-sheet');
      return { sheet, cancel: acts.children[0], ok: acts.children[1], close: sheet.querySelector('.ui-sheet__close'), title: sheet.querySelector('.ui-sheet__title').textContent };
    },
    openConfirms: () => h.doc.querySelectorAll('.ui-sheet--dialog.is-open .ui-confirm__actions').length,
    async waitConfirm() { await until(() => api.confirm(), 'the confirm dialog'); return api.confirm(); },
    // The open row menu's items by label.
    menuItems() {
      const sheets = Array.from(h.doc.querySelectorAll('.ui-sheet.is-open')).filter((s) => s.id !== 'notif-panel' && !s.querySelector('.ui-confirm__actions'));
      const m = sheets.pop();
      if (!m) return null;
      const items = {};
      m.querySelectorAll('button.ui-row').forEach((b) => { items[b.textContent] = b; });
      return items;
    },
    async openMenu(id) {
      h.click(api.row(id).querySelector('.notif-more'));
      await until(() => api.menuItems(), 'the row menu');
      return api.menuItems();
    },
    // Swipe a row's content left by `px` (release there), then let the drag's swallowed-click
    // window (interaction.js CLICK_SWALLOW_MS, 400ms) pass, as a finger lifting and coming
    // back down to tap does: a tap inside it is eaten by design.
    async swipe(id, px) {
      const content = api.row(id);
      h.drag(content, [360, 340, 360 - px]);
      await wait(450);
    },
  };
  return api;
}

// ---- the queue ----

const QUEUE = {
  pointerUid: 'u2',
  entries: [
    { uid: 'u1', mediaId: 'm1', kind: 'media', item: { title: 'First', channelName: 'Harbor', hasThumbnail: true, type: 'video' } },
    { uid: 'u2', mediaId: 'm2', kind: 'media', item: { title: 'Second', channelName: 'Harbor', hasThumbnail: true, type: 'video' } },
    { uid: 'u3', mediaId: 'ep9', kind: 'podcast', item: { title: 'Third', channelName: 'Show', artUrl: '/podcastart/show' } },
  ],
};

async function mountQueue(opts) {
  const o = opts || {};
  let q = JSON.parse(JSON.stringify(o.queue || QUEUE));
  const h = mount({
    ...o,
    route(method, url, call) {
      if (o.route) { const r = o.route(method, url, call); if (r) return r; }
      if (url === '/api/queue' && method === 'GET') return res(200, q);
      if (url === '/api/queue' && method === 'DELETE') { q = { pointerUid: null, entries: [] }; return res(200, { queue: q }); }
      if (url === '/api/queue/reorder') {
        const order = JSON.parse(call.body).orderedUids;
        q = { ...q, entries: order.map((u) => q.entries.find((e) => e.uid === u)) };
        return res(200, { queue: q });
      }
      if (method === 'DELETE' && url.indexOf('/api/queue/items/') === 0) {
        const uid = url.slice('/api/queue/items/'.length);
        q = { ...q, entries: q.entries.filter((e) => e.uid !== uid) };
        return res(200, { queue: q });
      }
      return null;
    },
  });
  common.injectQueueChrome();
  await until(() => h.doc.getElementById('queue-btn'), 'the queue button');
  const btn = h.doc.getElementById('queue-btn');
  const api = {
    ...h,
    btn,
    panel: () => h.doc.getElementById('queue-panel'),
    rows: () => Array.from(h.doc.querySelectorAll('#queue-panel-list .ui-row[data-uid]')),
    async open() {
      h.click(btn);
      await until(() => api.rows().length > 0 || h.doc.querySelector('#queue-panel .ui-state'), 'the queue rows');
      await until(() => api.panel().classList.contains('is-open'), 'the panel open class');
    },
  };
  return api;
}

module.exports = { mountBell, mountQueue, BELL_ROWS, QUEUE, settle, wait, until, res, ROW_W, ACTION_W };
