'use strict';

// [UNIT] v1.403.0 (plan 2026-11-05-modern-swipe-trash, W2; LESSONS 2, 4, 9): the swipe on Modern home's cards, driven
// through the REAL home view (main.js init on a jsdom page, with the real common.js, ui.js and interaction.js), real
// PointerEvents on the real listeners and a fake server that logs every request. The destructive surface: every test
// asserts WHICH request went out, for WHICH id. jsdom has no layout, so the rects are stubbed (card 400 px, actions 160 px,
// a full swipe at 240 px). scripts/modern-swipe-probe.js is the same proof in real browsers.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const PUBLIC = path.join(__dirname, '../../public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const SCRIPTS = ['js/icons.js', 'js/ui.js', 'js/interaction.js', 'js/common.js', 'js/main.js']
  .map((f) => new vm.Script(read(f), { filename: f }));
const SHELL = read('index.html').replace(/<script[\s\S]*?<\/script>/g, '');

const media = (n, extra) => Object.assign({ id: 'm' + n, type: 'video', title: 'Clip ' + n, folderName: 'clips', ext: '.mp4', duration: 20, liked: false }, extra);
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// A sheet reaches is-open on its next frame, which a loaded box delays: poll, never a fixed sleep.
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await wait(10); };

async function boot(opts = {}) {
  const dom = new JSDOM(SHELL, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  if (w.document.readyState !== 'complete') await new Promise((r) => w.addEventListener('load', r));
  if (opts.modern !== false) w.localStorage.setItem('ft-modern-mode', 'on');
  w.matchMedia = () => ({ matches: !!opts.reduced, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  const observers = [];
  w.IntersectionObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} unobserve() {} disconnect() {} };
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const width = this.classList && this.classList.contains('ui-swipe__actions') ? 160 : 400;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 100, width, height: 100 };
  };
  w.HTMLElement.prototype.setPointerCapture = function () {};
  w.HTMLElement.prototype.releasePointerCapture = function () {};
  const log = [];
  const server = {
    canModify: opts.canModify !== false,
    pages: opts.pages || [[media(1), media(2), media(3), media(4)]],
    total: opts.total,
    del: opts.del || null,      // (id) => a response override
    restore: opts.restore || null,
  };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
  w.fetch = async (url, init) => {
    const u = String(url);
    const method = (init && init.method) || 'GET';
    if (method !== 'GET') log.push(method + ' ' + u);
    if (u.startsWith('/api/home?view=grid')) {
      log.push('GET ' + u);
      const offset = Number(/offset=(-?\d+)/.exec(u)[1]);
      const filter = /filter=(\w+)/.exec(u)[1];
      const page = opts.gridFor ? opts.gridFor(filter, offset) : (server.pages[offset === 0 ? 0 : 1] || []);
      return res(200, { items: page, offset, limit: 60, total: server.total === undefined ? page.length : server.total });
    }
    if (u.startsWith('/api/videos?')) return res(200, { items: [media(1), media(2)], offset: 0, limit: 60, total: 2 });
    if (u === '/api/auth/me') return res(200, { user: { id: 1, role: server.canModify ? 'admin' : 'member', canModifyLibrary: server.canModify }, settings: {} });
    if (u === '/api/config') return res(200, { folders: ['/lib'], folderSettings: {}, settings: {} });
    if (u === '/api/watch-later/ids') return res(200, { ids: opts.watchLater || [] });
    if (method === 'DELETE' && u.startsWith('/api/videos/')) {
      const over = server.del && server.del(u);
      if (over) return over;
      return res(200, { success: true, trashed: true, trashId: 'trash-' + u.split('/').pop(), message: 'Moved to Trash' });
    }
    if (method === 'DELETE' && u.startsWith('/api/podcasts/episodes/')) return res(200, { ok: true, status: 'trashed' });
    if (method === 'POST' && u.endsWith('/restore')) {
      const over = server.restore && server.restore(u);
      if (over) return over;
      return res(200, { success: true, restoredId: decodeURIComponent(u.split('/')[3]).replace(/^trash-/, '') });
    }
    if (method === 'POST' && u.startsWith('/api/feed-hidden/')) return res(200, { ok: true });
    if (method === 'DELETE' && u.startsWith('/api/feed-hidden/')) return res(200, { ok: true });
    if (u.startsWith('/api/liked/')) return res(200, { liked: method === 'POST' });
    if (u.startsWith('/api/watch-later/')) return res(200, { ok: true });
    return res(404, {});
  };
  const ctx = dom.getInternalVMContext();
  SCRIPTS.slice(0, 4).forEach((s) => s.runInContext(ctx));
  w.resolveFolderGlyphClass = () => ''; // the sidebar's glyphs: another script's, not this surface
  let view = null;
  // the router never boots here (its DOMContentLoaded has passed), so the test catches main.js's registration and runs init itself
  const real = w.FileTube.registerView;
  w.FileTube.registerView = (n, m) => { if (n === 'home') view = m; real(n, m); };
  SCRIPTS[4].runInContext(ctx);
  const doc = w.document;
  const root = doc.getElementById('view-root');
  view.init(root);
  await tick(30);
  await wait(5);
  const b = {
    dom, w, doc, log, server, view, root, observers,
    cards: () => Array.from(doc.querySelectorAll('#video-grid .video-card[data-id]')),
    ids: () => b.cards().map((c) => c.getAttribute('data-id')),
    card: (id) => b.cards().find((c) => c.getAttribute('data-id') === id),
    wraps: () => Array.from(doc.querySelectorAll('#video-grid > .ui-swipe')),
    writes: () => log.filter((l) => !l.startsWith('GET ')),
    toasts: () => Array.from(doc.querySelectorAll('.ui-toast__text')).map((t) => t.textContent),
    undo: () => doc.querySelector('.ui-toast__action'),
    pe(type, el, o = {}) {
      el.dispatchEvent(new w.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: o.id ?? 7, pointerType: o.pointerType ?? 'touch',
        isPrimary: o.isPrimary ?? true, button: 0, buttons: o.buttons ?? 1, clientX: o.x ?? 100, clientY: o.y ?? 100 }));
    },
    // a drag on a card's content: xs[0] down, the rest moves, up at the last
    drag(id, xs, o = {}) {
      const el = o.el || b.card(id).querySelector('.video-info') || b.card(id);
      const y = 100;
      b.pe('pointerdown', el, { x: xs[0], y });
      xs.slice(1).forEach((x, i) => b.pe('pointermove', el, { x, y: o.dy ? y + o.dy * (i + 1) : y }));
      if (!o.hold) b.pe('pointerup', el, { x: xs[xs.length - 1], y });
    },
    fullSwipe: (id, o) => b.drag(id, [390, 380, 100], o),
    shortSwipe: (id, o) => b.drag(id, [390, 380, 290], o),
    btn: (id, action) => b.card(id).parentNode.querySelector('[data-action="' + action + '"]'),
    // a real tap on a revealed button; the click-swallow after a drag expires first
    async tap(btn) {
      await wait(420);
      b.pe('pointerdown', btn, { id: 9, x: 350 });
      b.pe('pointerup', btn, { id: 9, x: 350 });
      btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    },
    done() { try { view.destroy(); } catch (_) { /* best-effort */ } w.close(); },
  };
  return b;
}

test('CONTROL: Modern home wraps every card once; the wrapper is the grid item and the card sits inside it', async () => {
  const b = await boot();
  try {
    assert.deepStrictEqual(b.ids(), ['m1', 'm2', 'm3', 'm4']);
    assert.strictEqual(b.wraps().length, 4);
    b.wraps().forEach((wr) => {
      assert.strictEqual(wr.parentNode.id, 'video-grid');
      assert.strictEqual(wr.querySelectorAll('.video-card').length, 1);
    });
  } finally { b.done(); }
});

test('S5: the classic grid (Modern off) has no wrapper, no buttons, and a drag sends nothing', async () => {
  const b = await boot({ modern: false });
  try {
    assert.deepStrictEqual(b.ids(), ['m1', 'm2'], 'precondition: the classic grid rendered its cards');
    assert.strictEqual(b.doc.querySelectorAll('.ui-swipe').length, 0);
    assert.strictEqual(b.card('m1').parentNode.id, 'video-grid', 'the card is the grid item, as always');
    b.fullSwipe('m1');
    await tick();
    assert.deepStrictEqual(b.writes(), []);
  } finally { b.done(); }
});

test('S1: a full swipe sends ONE DELETE for THAT card, no confirm, the wrapper leaves too, and the toast offers Undo', async () => {
  const b = await boot();
  try {
    b.fullSwipe('m2');
    assert.strictEqual(b.doc.querySelector('.ui-sheet.is-open'), null, 'no confirm');
    await tick();
    assert.deepStrictEqual(b.writes(), ['DELETE /api/videos/m2']);
    assert.deepStrictEqual(b.ids(), ['m1', 'm3', 'm4']);
    assert.strictEqual(b.wraps().length, 3, 'no empty grid cell');
    assert.ok(b.wraps().every((wr) => wr.querySelector('.video-card')));
    assert.deepStrictEqual(b.toasts(), ['Moved to Trash']);
    assert.ok(b.undo(), 'the toast carries Undo');
  } finally { b.done(); }
});

test('S1: while the request runs the card has left the screen; it is the same DOM until the server answers', async () => {
  let release = null;
  const held = new Promise((r) => { release = r; });
  const b = await boot({ reduced: true });
  const inner = b.w.fetch;
  b.w.fetch = async (u, i) => { if (i && i.method === 'DELETE') await held; return inner(u, i); };
  try {
    const wr = b.card('m2').parentNode;
    b.fullSwipe('m2');
    assert.ok(wr.classList.contains('is-leaving'));
    assert.ok(wr.classList.contains('is-gone'), 'Reduce Motion: out of the grid at once');
    assert.deepStrictEqual(b.ids(), ['m1', 'm2', 'm3', 'm4'], 'still in the DOM: a refusal only has to reveal it');
    release();
    await tick();
    assert.deepStrictEqual(b.ids(), ['m1', 'm3', 'm4']);
  } finally { b.done(); }
});

test('S1: with motion on the card slides first, and only then leaves the grid', async () => {
  let release = null;
  const held = new Promise((r) => { release = r; });
  const b = await boot({ reduced: false });
  const inner = b.w.fetch;
  b.w.fetch = async (u, i) => { if (i && i.method === 'DELETE') await held; return inner(u, i); };
  try {
    const wr = b.card('m2').parentNode;
    b.fullSwipe('m2');
    assert.ok(wr.classList.contains('is-leaving'));
    assert.strictEqual(wr.classList.contains('is-gone'), false, 'the slide runs first');
    await wait(320);
    assert.ok(wr.classList.contains('is-gone'));
    release();
    await tick();
  } finally { b.done(); }
});

test('S1: Undo restores with the trashId the DELETE RETURNED, and the card returns to its old position, swipeable', async () => {
  const b = await boot({ del: (u) => (u.endsWith('/m3') ? { ok: true, status: 200, json: async () => ({ success: true, trashed: true, trashId: 'rec/42' }) } : null),
    restore: () => ({ ok: true, status: 200, json: async () => ({ success: true, restoredId: 'm3' }) }) });
  try {
    b.fullSwipe('m3');
    await tick();
    b.undo().click();
    await tick();
    assert.deepStrictEqual(b.writes(), ['DELETE /api/videos/m3', 'POST /api/trash/rec%2F42/restore'], 'only the id the delete returned, encoded');
    assert.deepStrictEqual(b.ids(), ['m1', 'm2', 'm3', 'm4'], 'in place');
    assert.strictEqual(b.wraps().length, 4);
    await wait(420);
    b.fullSwipe('m3');
    await tick();
    assert.strictEqual(b.writes().filter((l) => l === 'DELETE /api/videos/m3').length, 2, 'the returned card swipes again');
  } finally { b.done(); }
});

test('S1: Undo with its neighbours gone lands by the nearest one still loaded, and into an emptied grid it clears the empty state', async () => {
  const b = await boot();
  try {
    b.fullSwipe('m2');
    await tick();
    await wait(420);
    b.fullSwipe('m3'); // m3, m2's neighbour, leaves too
    await tick();
    await wait(450); // m2's toast has gone; m3's is the live one
    b.undo().click();
    await tick();
    assert.deepStrictEqual(b.ids(), ['m1', 'm3', 'm4'], 'm3 back before m4; m2 stays in Trash');
  } finally { b.done(); }
  const c = await boot({ pages: [[media(1)]] });
  try {
    c.fullSwipe('m1');
    await tick();
    assert.deepStrictEqual(c.ids(), []);
    assert.ok(c.doc.querySelector('#video-grid .ui-state, #video-grid .empty-state'), 'the empty state is up');
    c.undo().click();
    await tick();
    assert.deepStrictEqual(c.ids(), ['m1']);
    assert.strictEqual(c.doc.querySelector('#video-grid .ui-state, #video-grid .empty-state'), null, 'and gone again');
  } finally { c.done(); }
});

test('S1: Undo when the next neighbour has left lands before the next one still loaded (cardReturnSlot)', async () => {
  const b = await boot();
  try {
    b.fullSwipe('m3');
    await tick();
    const undoM3 = b.undo();
    await wait(420);
    b.fullSwipe('m4');  // m3's next neighbour leaves while m3's toast is still on screen
    await tick();
    undoM3.click();     // the toast being dismissed is still that item's own Undo
    await tick();
    assert.deepStrictEqual(b.ids(), ['m1', 'm2', 'm3'], 'after its nearest earlier neighbour, the later one being gone');
  } finally { b.done(); }
});

test('S1: only the newest trash offers Undo: the first toast is dismissed, so Undo can never restore the other card', async () => {
  const b = await boot();
  try {
    b.fullSwipe('m1');
    await tick();
    await wait(420);
    b.fullSwipe('m2');
    await tick();
    await wait(450); // the first toast's exit, then the second shows
    const live = Array.from(b.doc.querySelectorAll('.ui-toast__action'));
    assert.strictEqual(live.length, 1);
    live[0].click();
    await tick();
    assert.strictEqual(b.writes().filter((l) => l.endsWith('/restore')).join(), 'POST /api/trash/trash-m2/restore');
  } finally { b.done(); }
});

test('S6: a refused Trash (409, 403) leaves the card in place with today\'s message, offers no Undo, and never adds ?removeAnyway', async () => {
  for (const [status, re] of [[409, /read-only/], [403, /permission/]]) {
    const b = await boot({ reduced: true, del: () => ({ ok: false, status, json: async () => ({}) }) });
    try {
      const wr = b.card('m2').parentNode;
      b.fullSwipe('m2');
      await tick();
      assert.deepStrictEqual(b.ids(), ['m1', 'm2', 'm3', 'm4']);
      assert.strictEqual(wr.classList.contains('is-leaving') || wr.classList.contains('is-gone'), false, 'the card is back, visible');
      assert.match(b.toasts().join(), re);
      assert.strictEqual(b.undo(), null);
      assert.deepStrictEqual(b.writes(), ['DELETE /api/videos/m2']);
    } finally { b.done(); }
  }
});

test('a delete that did not land in Trash says so and offers no Undo (nothing to restore)', async () => {
  const b = await boot({ del: () => ({ ok: true, status: 200, json: async () => ({ success: true, message: 'File deleted successfully' }) }) });
  try {
    b.fullSwipe('m2');
    await tick();
    assert.deepStrictEqual(b.toasts(), ['File deleted.']);
    assert.strictEqual(b.undo(), null);
  } finally { b.done(); }
  const c = await boot({ del: () => ({ ok: true, status: 200, json: async () => ({ success: true, trashed: true, trashId: 't1', fileRemainsOnDisk: true }) }) });
  try {
    c.fullSwipe('m2');
    await tick();
    assert.match(c.toasts().join(), /finish cleaning up/, 'the honest line, as today');
    assert.ok(c.undo(), 'it IS in Trash: Undo stays');
  } finally { c.done(); }
});

test('a failed restore says so, points at Settings > Trash, and the card stays out; a podcast points at its show', async () => {
  const b = await boot({ restore: () => ({ ok: false, status: 409, json: async () => ({ error: 'x' }) }) });
  try {
    b.fullSwipe('m2');
    await tick();
    b.undo().click();
    await tick();
    await wait(450);
    assert.match(b.toasts().join(), /Settings > Trash/);
    assert.deepStrictEqual(b.ids(), ['m1', 'm3', 'm4']);
  } finally { b.done(); }
  const pod = { id: 'ep1', kind: 'podcast', type: 'audio', title: 'Ep', showName: 'Show', subId: 's1', liked: false };
  const c = await boot({ pages: [[media(1), pod]], restore: () => ({ ok: false, status: 410, json: async () => ({}) }) });
  try {
    c.fullSwipe('ep1');
    await tick();
    c.undo().click();
    await tick();
    await wait(450);
    assert.match(c.toasts().join(), /from its show/);
  } finally { c.done(); }
});

test('a podcast card: its own two routes, no Hide button, and Undo brings it back', async () => {
  const pod = { id: 'ep/1', kind: 'podcast', type: 'audio', title: 'Ep', showName: 'Show', subId: 's1', liked: false };
  const b = await boot({ pages: [[media(1), pod, media(2)]] });
  try {
    const labels = Array.from(b.card('ep/1').parentNode.querySelectorAll('.ui-swipe__action')).map((x) => x.getAttribute('data-action'));
    assert.deepStrictEqual(labels, ['like', 'watchlater', 'delete'], 'the menu offers no Hide on an episode');
    b.fullSwipe('ep/1');
    await tick();
    b.undo().click();
    await tick();
    assert.deepStrictEqual(b.writes(), ['DELETE /api/podcasts/episodes/ep%2F1', 'POST /api/podcasts/episodes/ep%2F1/restore']);
    assert.deepStrictEqual(b.ids(), ['m1', 'ep/1', 'm2']);
  } finally { b.done(); }
});

test('S2: the buttons come from the card\'s own menu, Trash last; no Trash in the roster = no button AND no full-swipe action', async () => {
  const b = await boot();
  try {
    const acts = Array.from(b.card('m1').parentNode.querySelectorAll('.ui-swipe__action'));
    assert.deepStrictEqual(acts.map((x) => x.getAttribute('data-action')), ['like', 'watchlater', 'feedhide', 'delete']);
    assert.ok(acts[3].classList.contains('ui-swipe__action--danger'));
  } finally { b.done(); }
  const c = await boot({ canModify: false });
  try {
    assert.deepStrictEqual(Array.from(c.card('m1').parentNode.querySelectorAll('.ui-swipe__action')).map((x) => x.getAttribute('data-action')), ['like', 'watchlater', 'feedhide']);
    c.fullSwipe('m1');
    await tick();
    assert.deepStrictEqual(c.writes(), [], 'a member without the capability: a full swipe sends nothing');
  } finally { c.done(); }
});

test('S2: each revealed button runs its menu twin for THAT card; a label follows the state', async () => {
  const b = await boot();
  try {
    b.shortSwipe('m2');
    assert.ok(b.card('m2').parentNode.classList.contains('is-open'));
    assert.deepStrictEqual(b.writes(), [], 'a short swipe runs nothing');
    const like = b.btn('m2', 'like');
    assert.strictEqual(like.getAttribute('data-label'), 'Like');
    await b.tap(like);
    await tick();
    assert.deepStrictEqual(b.writes(), ['POST /api/liked/m2']);
    assert.ok(like.querySelector('.ui-icon'), 'the icon the menu names resolved');
    await wait(420);
    b.shortSwipe('m2');
    assert.strictEqual(b.btn('m2', 'like').getAttribute('data-label'), 'Unlike', 'read again at the lock');
    assert.ok(b.btn('m2', 'like').querySelector('.ui-icon'), 'favorite.fill resolved too');
    await b.tap(b.btn('m2', 'watchlater'));
    await tick();
    assert.ok(b.writes().some((l) => /^POST \/api\/watch-later\/m2/.test(l)), b.writes().join());
    b.toasts();
  } finally { b.done(); }
});

test('S3: the revealed Trash button skips the confirm: same request, same Undo', async () => {
  const b = await boot();
  try {
    b.shortSwipe('m3');
    await b.tap(b.btn('m3', 'delete'));
    assert.strictEqual(b.doc.querySelector('.ui-sheet.is-open'), null, 'no confirm');
    await tick();
    assert.deepStrictEqual(b.writes(), ['DELETE /api/videos/m3']);
    assert.ok(b.undo());
  } finally { b.done(); }
});

test('S3: the kebab menu\'s Move to Trash still asks, and sends nothing until the answer', async () => {
  const b = await boot();
  try {
    b.card('m1').querySelector('.card-kebab').click();
    await until(() => b.doc.querySelector('.ui-sheet.is-open'));
    const row = Array.from(b.doc.querySelectorAll('.ui-sheet.is-open button, .ui-sheet.is-open [role="menuitem"]')).find((x) => /Move to Trash/.test(x.textContent));
    assert.ok(row, 'the menu offers it');
    await wait(420);
    row.click();
    await until(() => b.doc.querySelector('.ui-sheet.is-open .ui-confirm__actions'));
    assert.ok(b.doc.querySelector('.ui-sheet.is-open .ui-confirm__actions'), 'the confirm is up');
    assert.deepStrictEqual(b.writes(), [], 'nothing sent while it asks');
  } finally { b.done(); }
});

test('hide from feed: no empty cell, and its Undo puts the card back wrapped', async () => {
  const b = await boot();
  try {
    b.shortSwipe('m2');
    await b.tap(b.btn('m2', 'feedhide'));
    assert.deepStrictEqual(b.ids(), ['m1', 'm3', 'm4']);
    assert.strictEqual(b.wraps().length, 3, 'no empty grid cell');
    await tick();
    b.undo().click();
    await tick();
    assert.deepStrictEqual(b.ids(), ['m1', 'm2', 'm3', 'm4'], 'in place');
    assert.ok(b.card('m2').parentNode.classList.contains('ui-swipe'), 'wrapped again');
    assert.strictEqual(b.wraps().length, 4);
  } finally { b.done(); }
});

test('off while: select mode (a swipe neither opens nor fires; leaving restores it)', async () => {
  const b = await boot();
  try {
    b.doc.querySelector('.modern-select .ui-btn').click();
    await tick();
    b.fullSwipe('m2');
    b.shortSwipe('m2');
    await tick();
    assert.deepStrictEqual(b.writes(), []);
    assert.strictEqual(b.card('m2').parentNode.classList.contains('is-open'), false);
    b.doc.querySelector('.select-bar__cancel').click();
    await tick();
    await wait(420);
    b.shortSwipe('m2');
    assert.ok(b.card('m2').parentNode.classList.contains('is-open'), 'restored');
  } finally { b.done(); }
});

test('off while: entering select mode closes a row that was open', async () => {
  const b = await boot();
  try {
    b.shortSwipe('m2');
    assert.ok(b.card('m2').parentNode.classList.contains('is-open'));
    await wait(420); // the drag's click swallow expires
    b.doc.querySelector('.modern-select .ui-btn').click();
    await tick();
    assert.strictEqual(b.card('m2').parentNode.classList.contains('is-open'), false);
  } finally { b.done(); }
});

test('off while: a card menu is open: a drag running when it opened snaps back and fires nothing', async () => {
  const b = await boot();
  try {
    b.fullSwipe('m2', { hold: true }); // the finger is past the full-swipe point, not released
    b.card('m3').querySelector('.card-kebab').click(); // a menu comes up under it
    await until(() => b.doc.querySelector('.ui-sheet.is-open'));
    assert.ok(b.doc.querySelector('.ui-sheet.is-open'));
    const el = b.card('m2').querySelector('.video-info') || b.card('m2');
    b.pe('pointerup', el, { x: 100 });
    await tick();
    assert.deepStrictEqual(b.writes(), []);
    assert.strictEqual(b.card('m2').parentNode.classList.contains('is-dragging'), false);
    await wait(420);
    b.fullSwipe('m1');
    await tick();
    assert.deepStrictEqual(b.writes(), [], 'and a new swipe under the open menu does nothing');
  } finally { b.done(); }
});

test('off while: the kebab\'s confirm is up (the menu has closed, only the open sheet says so): a swipe sends nothing', async () => {
  const b = await boot();
  try {
    b.card('m1').querySelector('.card-kebab').click();
    await until(() => b.doc.querySelector('.ui-sheet.is-open'));
    const row = Array.from(b.doc.querySelectorAll('.ui-sheet.is-open button, .ui-sheet.is-open [role="menuitem"]')).find((x) => /Move to Trash/.test(x.textContent));
    await wait(420);
    row.click();
    await wait(500); // the menu's exit has run: only the confirm's sheet is left
    await until(() => b.doc.querySelector('.ui-sheet.is-open .ui-confirm__actions'));
    assert.ok(b.doc.querySelector('.ui-sheet.is-open .ui-confirm__actions'), 'precondition: the confirm is up');
    b.fullSwipe('m2');
    await tick();
    assert.deepStrictEqual(b.writes(), []);
    assert.strictEqual(b.card('m2').parentNode.classList.contains('is-dragging'), false);
  } finally { b.done(); }
});

test('off while: a card menu opened this very frame (its sheet not painted open yet): a swipe sends nothing', async () => {
  const b = await boot();
  try {
    b.card('m3').querySelector('.card-kebab').click();
    assert.strictEqual(b.doc.querySelector('.ui-sheet.is-open'), null, 'precondition: the sheet has not reached is-open');
    b.fullSwipe('m2');
    await tick();
    assert.deepStrictEqual(b.writes(), []);
  } finally { b.done(); }
});

test('LESSONS 4: a cached Home fires nothing off-Home; coming back resets what it left behind', async () => {
  const b = await boot();
  try {
    b.shortSwipe('m1');
    b.fullSwipe('m2', { hold: true });
    const grid = b.doc.getElementById('video-grid');
    const wr1 = b.card('m1').parentNode;
    const wr2 = b.card('m2').parentNode;
    const el = wr2.querySelector('.video-info');
    // the router's cache: #view-root is detached, destroy() is NOT called
    const parent = b.root.parentNode;
    parent.removeChild(b.root);
    assert.strictEqual(grid.isConnected, false);
    b.pe('pointerup', el, { x: 100 });
    await tick();
    assert.deepStrictEqual(b.writes(), [], 'the release off-Home fired nothing');
    wr2.querySelectorAll('.ui-swipe__action').forEach(() => {});
    b.pe('pointerdown', el, { x: 390, id: 8 });
    b.pe('pointermove', el, { x: 380, id: 8 });
    b.pe('pointermove', el, { x: 100, id: 8 });
    b.pe('pointerup', el, { x: 100, id: 8 });
    await tick();
    assert.deepStrictEqual(b.writes(), [], 'nor does a whole gesture on the detached grid');
    // back on Home: restoreSidebar is what common.js's restoreHomeFromCache calls
    parent.appendChild(b.root);
    b.view.restoreSidebar();
    assert.strictEqual(wr1.classList.contains('is-open'), false, 'no row comes back open');
    assert.strictEqual(wr2.classList.contains('is-dragging'), false, 'no drag comes back alive');
    await wait(420);
    b.fullSwipe('m2');
    await tick();
    assert.deepStrictEqual(b.writes(), ['DELETE /api/videos/m2'], 'CONTROL: it works again on Home');
  } finally { b.done(); }
});

test('a re-render replaces the controllers: a chip change leaves one wrapper per new card and none of the old', async () => {
  const b = await boot({ gridFor: (filter) => (filter === 'audio' ? [media(7, { type: 'audio' })] : [media(1), media(2)]) });
  try {
    assert.deepStrictEqual(b.ids(), ['m1', 'm2']);
    const stale = b.card('m1');
    const chip = Array.from(b.doc.querySelectorAll('.modern-chip-row button, .modern-chip-row .ui-chip')).find((x) => /Audio/.test(x.textContent));
    assert.ok(chip, 'the chip row rendered');
    chip.click();
    await tick(30);
    assert.deepStrictEqual(b.ids(), ['m7']);
    assert.strictEqual(b.wraps().length, 1);
    assert.strictEqual(stale.parentNode, null, 'the old card was unwrapped, its controller destroyed');
    assert.strictEqual(stale.classList.contains('ui-swipe__content'), false);
    // the wrong card after a re-render: the swipe trashes the card now on screen
    b.fullSwipe('m7');
    await tick();
    assert.deepStrictEqual(b.writes(), ['DELETE /api/videos/m7']);
  } finally { b.done(); }
});

test('an emptied chip takes the wrappers with it (the empty arm is a render path, LESSONS 4)', async () => {
  const b = await boot({ gridFor: (filter) => (filter === 'audio' ? [] : [media(1), media(2)]) });
  try {
    const stale = b.card('m1');
    Array.from(b.doc.querySelectorAll('.modern-chip-row button, .modern-chip-row .ui-chip')).find((x) => /Audio/.test(x.textContent)).click();
    await tick(30);
    assert.strictEqual(b.wraps().length, 0);
    assert.strictEqual(stale.classList.contains('ui-swipe__content'), false, 'destroyed, not just dropped');
  } finally { b.done(); }
});

test('Undo after the list changed: the file comes back, the card does not land in a different list', async () => {
  const b = await boot({ gridFor: (filter) => (filter === 'audio' ? [media(7, { type: 'audio' })] : [media(1), media(2)]) });
  try {
    b.fullSwipe('m1');
    await tick();
    const undo = b.undo();
    Array.from(b.doc.querySelectorAll('.modern-chip-row button, .modern-chip-row .ui-chip')).find((x) => /Audio/.test(x.textContent)).click();
    await tick(30);
    undo.click();
    await tick();
    assert.ok(b.writes().includes('POST /api/trash/trash-m1/restore'));
    assert.deepStrictEqual(b.ids(), ['m7'], 'not in Audio');
    await wait(450);
    assert.match(b.toasts().join(), /Restored/, 'and it says the file came back');
  } finally { b.done(); }
});

test('Undo answering a different id: the file is back, no card claims the old id', async () => {
  const b = await boot({ restore: () => ({ ok: true, status: 200, json: async () => ({ success: true, restoredId: 'somewhere-else' }) }) });
  try {
    b.fullSwipe('m2');
    await tick();
    b.undo().click();
    await tick();
    assert.deepStrictEqual(b.ids(), ['m1', 'm3', 'm4']);
  } finally { b.done(); }
});

test('pagination: the window shrinks with a trash and grows with its Undo, so the next page neither skips nor repeats', async () => {
  const nextOffsets = [];
  const page0 = [media(1), media(2), media(3), media(4)];
  const b = await boot({ total: 500, gridFor: (filter, offset) => { if (offset !== 0) nextOffsets.push(offset); return offset === 0 ? page0 : [media(100 + nextOffsets.length)]; } });
  try {
    const obs = () => b.observers[b.observers.length - 1];
    b.fullSwipe('m2');
    await tick();
    obs().cb([{ isIntersecting: true }]);
    await tick(20);
    assert.strictEqual(nextOffsets[0], 59, 'one card left the window: the next page starts one earlier (limit 60, offset 0)');
    assert.ok(b.undo());
    b.undo().click();
    await tick();
    obs().cb([{ isIntersecting: true }]);
    await tick(20);
    // the page above answered offset 59 (kept by the client as currentOffset), and Undo put one back
    assert.strictEqual(nextOffsets[1], 59 + 60 + 1, 'Undo grew it back');
  } finally { b.done(); }
});

test('one gesture, one request: a second swipe of a card whose Trash is in flight sends nothing', async () => {
  let release = null;
  const held = new Promise((r) => { release = r; });
  const b = await boot();
  const inner = b.w.fetch;
  let deletes = 0;
  b.w.fetch = async (u, i) => { if (i && i.method === 'DELETE') { deletes += 1; await held; } return inner(u, i); };
  try {
    b.fullSwipe('m2');
    await wait(420);
    b.fullSwipe('m2');
    await tick();
    assert.strictEqual(deletes, 1);
    release();
    await tick();
  } finally { b.done(); }
});

test('Undo when a refetch already shows the card: it stays one card, never two', async () => {
  const b = await boot();
  try {
    b.fullSwipe('m2');
    await tick();
    const undo = b.undo();
    await b.w.__filetubeRefreshLibrary(); // a rescan's in-place refresh, whose answer still lists it
    await tick(30);
    assert.deepStrictEqual(b.ids(), ['m1', 'm2', 'm3', 'm4']);
    undo.click();
    await tick();
    assert.deepStrictEqual(b.ids(), ['m1', 'm2', 'm3', 'm4']);
  } finally { b.done(); }
});

test('a tile that is neither media nor a podcast gets no swipe (S2, W2)', async () => {
  const b = await boot({ pages: [[media(1), { id: 'b1', kind: 'book', title: 'A book', liked: false }]] });
  try {
    assert.ok(b.card('m1').parentNode.classList.contains('ui-swipe'));
    assert.strictEqual(b.card('b1').parentNode.id, 'video-grid', 'the book tile is its own grid item');
  } finally { b.done(); }
});

test('the skeleton is not swipeable: no wrapper until real cards land', async () => {
  const b = await boot();
  try {
    const p = b.w.__filetubeRefreshLibrary(); // writes the skeleton first
    assert.ok(b.doc.querySelector('#video-grid .skeleton-card'), 'precondition: the skeleton is up');
    assert.strictEqual(b.wraps().length, 0);
    await p;
    await tick(30);
    assert.strictEqual(b.wraps().length, 4);
  } finally { b.done(); }
});

test('a mouse drag never starts the browser\'s own drag of a thumbnail or a link on Modern (Firefox ignores user-drag); classic is untouched', async () => {
  const b = await boot();
  try {
    const nodes = Array.from(b.card('m1').querySelectorAll('a, img'));
    assert.ok(nodes.length >= 2, 'precondition: the card has its links');
    assert.ok(nodes.every((n) => n.getAttribute('draggable') === 'false'));
  } finally { b.done(); }
  const c = await boot({ modern: false });
  try { assert.strictEqual(c.card('m1').querySelector('a[draggable]'), null); } finally { c.done(); }
});

test('opening the card menu by a long press on an open row closes that row', async () => {
  const b = await boot();
  try {
    b.shortSwipe('m2');
    const wr = b.card('m2').parentNode;
    assert.ok(wr.classList.contains('is-open'));
    await wait(420);
    const el = b.card('m2').querySelector('.video-info');
    b.pe('pointerdown', el, { x: 100, id: 12 });
    await wait(480);
    assert.ok(b.doc.querySelector('.ui-sheet'), 'precondition: the menu opened');
    assert.strictEqual(wr.classList.contains('is-open'), false);
    b.pe('pointerup', el, { x: 100, id: 12 });
  } finally { b.done(); }
});

test('LESSONS 4: coming back to a cached Home: a drag whose release never arrived, and an open row, are both gone', async () => {
  const b = await boot();
  try {
    b.fullSwipe('m2', { hold: true });
    const wr = b.card('m2').parentNode;
    assert.ok(wr.classList.contains('is-dragging'), 'precondition');
    const parent = b.root.parentNode;
    parent.removeChild(b.root); // the finger's release lands on a page where this row no longer is
    parent.appendChild(b.root);
    b.view.restoreSidebar();
    assert.strictEqual(wr.classList.contains('is-dragging'), false, 'no drag comes back alive');
  } finally { b.done(); }
  const c = await boot();
  try {
    c.shortSwipe('m2');
    const wr = c.card('m2').parentNode;
    assert.ok(wr.classList.contains('is-open'), 'precondition');
    const parent = c.root.parentNode;
    parent.removeChild(c.root);
    parent.appendChild(c.root);
    c.view.restoreSidebar();
    assert.strictEqual(wr.classList.contains('is-open'), false, 'no row comes back open');
  } finally { c.done(); }
});

test('a long press whose finger then drifts: opening the card menu drops the drag, so nothing moves and nothing fires', async () => {
  const b = await boot();
  try {
    const el = b.card('m2').querySelector('.video-info');
    b.pe('pointerdown', el, { x: 390 });
    await wait(480); // the hold fires: the menu opens with the finger still down
    assert.ok(b.doc.querySelector('.ui-sheet'), 'precondition: the menu opened (its sheet exists from the open call)');
    b.pe('pointermove', el, { x: 380 });
    assert.strictEqual(b.card('m2').parentNode.classList.contains('is-dragging'), false);
    b.pe('pointermove', el, { x: 100 });
    b.pe('pointerup', el, { x: 100 });
    await tick();
    assert.deepStrictEqual(b.writes(), []);
  } finally { b.done(); }
});

test('CSS lock: at rest the wrapper clips nothing and transforms nothing; four buttons never outgrow a narrow card', () => {
  const css = read('css/style.css');
  const REST = '.modern-home-mode #video-grid > .ui-swipe:not(.is-open):not(.is-dragging):not(.is-leaving)';
  assert.ok(css.includes(REST + ' { overflow: visible; }'), 'no clip at rest (the shared rule clips)');
  assert.ok(css.includes(REST + ' > .ui-swipe__content { transform: none; }'), 'no stacking context per card at rest');
  assert.match(css, /\.modern-home-mode #video-grid > \.ui-swipe \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);\s*min-width: 0;/, 'the card stretches to its row, a long title cannot widen the track');
  assert.match(css, /@media \(min-width: 481px\) and \(max-width: 1199px\) \{\s*\.modern-home-mode #video-grid \.ui-swipe__actions \{ display: grid; grid-template-columns: repeat\(2, var\(--hit\)\); \}/, 'two by two on three-up cards (measured 176 px of buttons on a 167 px card)');
  assert.match(css, /touch-action: pan-y pinch-zoom;/);
  const ui = read('css/ui.css');
  assert.ok(ui.indexOf('.ui-swipe {') !== -1 && css.includes('.modern-home-mode #video-grid > .ui-swipe.is-gone { display: none; }'));
});

test('source lock: every markup write to the grid goes through setGridHtml, which takes the controllers first', () => {
  const src = read('js/main.js').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const writes = src.match(/videoGrid\.innerHTML\s*=/g) || [];
  assert.strictEqual(writes.length, 1, 'only setGridHtml writes it');
  assert.match(src, /function setGridHtml\(html\) \{\s*detachAllCardSwipes\(\);\s*videoGrid\.innerHTML = html;/);
  assert.match(src, /if \(!append\) detachAllCardSwipes\(\);/, 'putCards too');
  assert.ok((src.match(/setGridHtml\(/g) || []).length >= 6, 'the skeleton, modern error, modern empty, classic error and classic empty arms');
});
