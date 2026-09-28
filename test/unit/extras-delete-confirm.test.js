'use strict';

// [UNIT] UI pass S7 (plan D4.8 / F33; destructive = the full gate, LESSONS 9): the player
// Extras menu's Delete - the SHARED core (skin-surface.js createExtrasMenu) the music sticker,
// the pop-out and the desktop actions menu run, and the podcast adapter's own onDelete
// (podcasts.js) - asks ONE danger ui.confirm and sends the SAME request only when it resolves
// exactly `true`. Driven through the REAL ui.js confirm (its sheet, scrim, Close, Esc and
// buttons) on a jsdom document; every way out without a yes is tried and must send nothing.
//
//   music / video items: DELETE /api/videos/:id (a move to Trash for every item) - the copy is
//     the card menu's (main.js cardDeleteConfirmCopy), a local file adding that it cannot be
//     re-downloaded;
//   podcast episodes:     DELETE /api/podcasts/episodes/:id (the episode list's own copy).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const surfacePath = require.resolve('../../public/js/skin-surface.js');
const uiPath = require.resolve('../../public/js/ui.js');
const skinsPath = require.resolve('../../public/js/music-skins.js');
const podcastsPath = require.resolve('../../public/js/podcasts.js');
const { cardDeleteConfirmCopy } = require('../../public/js/main.js');
const { isYtdlpManagedItem } = require('../../public/js/common.js');

const settle = () => new Promise((r) => setImmediate(r));
async function settleMany(n) { for (let i = 0; i < (n || 12); i++) await settle(); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the shared Extras core -----------------------------------------------------------------
function bootCore(opts) {
  const o = opts || {};
  const dom = new JSDOM('<body><div id="menu" hidden></div></body>', { url: 'https://x.test/music', pretendToBeVisual: true });
  const w = dom.window;
  const saved = { window: global.window, document: global.document, fetch: global.fetch, isYtdlpManagedItem: global.isYtdlpManagedItem };
  const calls = [];
  const state = { closes: 0, mutated: 0, toasts: [] };
  const item = Object.assign({ id: 'base9', title: 'Night Transit', liked: false, watchState: 'unwatched', filePath: '/lib/night.mp3', channelName: 'Halden Arcs' }, o.item || {});
  w.fetch = (url, init) => {
    const u = String(url);
    const method = (init && init.method) || 'GET';
    calls.push(method + ' ' + u);
    let body = {};
    if (method === 'GET' && u === '/api/videos/base9') body = item;
    else if (method === 'DELETE') body = { success: true };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  w.fetchCurrentUser = () => Promise.resolve({ user: { role: 'admin' } });
  w.isYtdlpManagedItem = isYtdlpManagedItem;
  w.cardDeleteConfirmCopy = cardDeleteConfirmCopy;
  w.showToast = (m) => state.toasts.push(String(m));
  // tripwires: the legacy modals must never be reached again
  w.showConfirmModal = () => { state.legacy = (state.legacy || 0) + 1; };
  w.showHardDeleteModal = () => { state.legacy = (state.legacy || 0) + 1; };
  global.window = w; global.document = w.document; global.fetch = w.fetch;
  global.isYtdlpManagedItem = isYtdlpManagedItem; // main.js reads it as a page global
  delete require.cache[uiPath]; require(uiPath); // the REAL primitives (window.ui)
  delete require.cache[surfacePath];
  const api = require(surfacePath);
  const menuEl = w.document.getElementById('menu');
  const ctl = new w.AbortController();
  const menu = api.createExtrasMenu({
    getMenuEl: () => menuEl,
    getBaseId: () => 'base9',
    getPlayer: () => ({ getCurrentTime: () => 0, close: () => { state.closes += 1; } }),
    getSignal: () => ctl.signal,
    close: () => { menuEl.hidden = true; },
    backHtml: () => '',
    stillOnPage: () => !menuEl.hidden,
    onMutated: () => { state.mutated += 1; },
  });
  return {
    w, menuEl, menu, calls, state, ctl,
    deletes: () => calls.filter((c) => c.indexOf('DELETE ') === 0),
    sheets: () => w.document.querySelectorAll('.ui-sheet'),
    dialog: () => w.document.querySelector('.ui-sheet'),
    btn: (which) => { const b = w.document.querySelectorAll('.ui-confirm__actions .ui-btn'); return which === 'ok' ? b[1] : b[0]; },
    click: (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
    done: () => { delete require.cache[surfacePath]; delete require.cache[uiPath]; Object.assign(global, saved); },
  };
}
async function openDelete(b) {
  b.menuEl.hidden = false;
  b.menu.open();
  await settleMany();
  assert.ok(b.menuEl.querySelector('[data-skin-x="delete"]'), 'precondition: the Extras page rendered its Delete');
  b.menu.handleAction('delete', null);
  await wait(30); // the sheet opens on the next frame
  assert.strictEqual(b.sheets().length, 1, 'precondition: one confirm dialog is open');
  assert.ok(b.dialog().classList.contains('is-open'), 'precondition: it is live');
}

test('Extras Delete: the confirm is ONE danger ui.confirm with the card menu copy (a local file says it cannot be re-downloaded)', async () => {
  for (const [label, item, local] of [['yt-dlp', {}, false], ['local', { channelName: undefined }, true]]) {
    const b = bootCore({ item });
    try {
      await openDelete(b);
      const d = b.dialog();
      assert.strictEqual(d.querySelector('.ui-sheet__title').textContent, 'Move to Trash?', label + ': title');
      assert.ok(d.querySelector('.ui-confirm__body').textContent.indexOf('Night Transit') !== -1, label + ': names the item');
      assert.strictEqual(d.querySelector('.ui-confirm__body').textContent.indexOf('This local file cannot be re-downloaded.') !== -1, local, label + ': the local-file line');
      assert.strictEqual(b.btn('ok').textContent, 'Move to Trash', label + ': the button says what the route does');
      assert.ok(b.btn('ok').classList.contains('ui-btn--destructive'), label + ': the danger fill');
      assert.strictEqual(b.state.legacy, undefined, label + ': never a legacy modal');
      assert.deepStrictEqual(b.deletes(), [], label + ': nothing sent while it asks');
    } finally { b.done(); }
  }
});

for (const [way, act] of [
  ['Cancel', (b) => b.click(b.btn('cancel'))],
  ['Esc', (b) => b.w.document.dispatchEvent(new b.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))],
  ['the scrim', (b) => b.click(b.w.document.querySelector('.ui-scrim'))],
  ['Close', (b) => b.click(b.dialog().querySelector('.ui-sheet__close'))],
  ['Enter on the dialog', (b) => b.dialog().dispatchEvent(new b.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))],
]) {
  test('Extras Delete: ' + way + ' sends NOTHING and leaves playback alone', async () => {
    const b = bootCore();
    try {
      await openDelete(b);
      act(b);
      await wait(400); // past the sheet's exit
      assert.deepStrictEqual(b.deletes(), [], 'no DELETE');
      assert.strictEqual(b.state.closes, 0, 'player untouched');
      assert.strictEqual(b.state.mutated, 0, 'no view refresh');
    } finally { b.done(); }
  });
}

test('Extras Delete: OK sends EXACTLY one DELETE to the same route; a double tap on OK is still one', async () => {
  const b = bootCore();
  try {
    await openDelete(b);
    const ok = b.btn('ok');
    b.click(ok);
    b.click(ok);
    await settleMany();
    assert.deepStrictEqual(b.deletes(), ['DELETE /api/videos/base9'], 'one DELETE, the same route');
    assert.strictEqual(b.state.closes, 1, 'the still-playing item was closed before it');
    assert.strictEqual(b.state.mutated, 1, 'the view refreshed once');
  } finally { b.done(); }
});

test('Extras Delete: a second Delete while the confirm is open opens nothing more and still sends one', async () => {
  const b = bootCore();
  try {
    await openDelete(b);
    b.menuEl.hidden = false;
    b.menu.open();
    await settleMany();
    b.menu.handleAction('delete', null); // the double tap / a re-opened menu
    await wait(30);
    assert.strictEqual(b.sheets().length, 1, 'still one dialog');
    b.click(b.btn('ok'));
    await settleMany();
    assert.deepStrictEqual(b.deletes(), ['DELETE /api/videos/base9'], 'one DELETE');
  } finally { b.done(); }
});

test('Extras Delete: a late OK on a dialog already closing (after Esc) stays a cancel', async () => {
  const b = bootCore();
  try {
    await openDelete(b);
    const ok = b.btn('ok');
    b.w.document.dispatchEvent(new b.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    b.click(ok); // tapped during the exit animation
    await wait(400);
    assert.deepStrictEqual(b.deletes(), [], 'no DELETE');
  } finally { b.done(); }
});

test('Extras Delete: a view teardown (its signal aborts) with the confirm up closes it and a stale OK after sends nothing', async () => {
  const b = bootCore();
  try {
    await openDelete(b);
    const ok = b.btn('ok');
    b.ctl.abort();
    b.click(ok);
    await wait(400);
    assert.deepStrictEqual(b.deletes(), [], 'no DELETE');
    assert.strictEqual(b.sheets().length, 0, 'nothing stranded on <body>');
  } finally { b.done(); }
});

test('Extras Delete: no ui.confirm on the page means NO delete (never a confirm-less fallback)', async () => {
  const b = bootCore();
  try {
    b.menuEl.hidden = false;
    b.menu.open();
    await settleMany();
    delete b.w.ui;
    b.menu.handleAction('delete', null);
    await settleMany();
    assert.deepStrictEqual(b.deletes(), [], 'no DELETE');
    assert.strictEqual(b.state.legacy, undefined, 'and no legacy modal either');
  } finally { b.done(); }
});

// ---- the podcast adapter (podcasts.js onDelete) -----------------------------------------------
const POD_HTML = `<body><div id="view-root" data-view="podcasts">
  <video id="media-player"></video>
  <button id="podcast-theater-btn" type="button" hidden aria-pressed="false"></button>
  <button id="podcast-popout-btn" type="button" hidden aria-pressed="false"></button>
  <div id="podcast-stage" class="music-stage"><div id="player-slot"></div><div id="podcast-nowplaying-panel" hidden></div></div>
  <div class="music-crumb" id="podcasts-crumb" hidden></div>
  <div id="podcasts-status" role="status" hidden></div>
  <div id="podcasts-content"></div>
  <div class="music-empty" id="podcasts-empty" hidden></div>
</div></body>`;

async function bootPodcast(run) {
  const dom = new JSDOM(POD_HTML, { url: 'http://localhost/podcasts', pretendToBeVisual: true });
  const w = dom.window;
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController, requestAnimationFrame: global.requestAnimationFrame };
  const player = { currentId: 'e1', closes: 0, getState: () => 'closed', getCurrentMeta: () => null, load() {}, expand() {}, setTrackNav() {}, close() { player.closes += 1; } };
  let registered = null;
  let engineCfg = null;
  const fetches = [];
  global.window = w; global.document = w.document; global.localStorage = w.localStorage;
  global.AbortController = w.AbortController;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  w.scrollTo = function () {};
  w.showToast = () => {};
  w.showConfirmModal = () => { throw new Error('the legacy confirm must never be reached'); };
  w.FileTube = { registerView: (n, m) => { registered = m; }, shimmerArt: () => {}, player };
  global.fetch = (u, init) => {
    const url = String(u);
    const method = (init && init.method) || 'GET';
    fetches.push(method + ' ' + url);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(/\/api\/podcasts\/shows$/.test(url) ? { shows: [] } : {}) });
  };
  try {
    delete require.cache[skinsPath]; require(skinsPath);
    delete require.cache[surfacePath]; require(surfacePath);
    const realCreate = w.FileTubeSkinSurface.create;
    w.FileTubeSkinSurface.create = (cfg) => { engineCfg = cfg; return realCreate(cfg); };
    delete require.cache[uiPath]; require(uiPath);
    delete require.cache[podcastsPath]; require(podcastsPath);
    registered.init(w.document.getElementById('view-root'));
    await settleMany();
    const extras = engineCfg && engineCfg.sticker && engineCfg.sticker.extras;
    assert.ok(extras && typeof extras.onDelete === 'function', 'precondition: the podcast Extras adapter is wired');
    await run({ w, player, fetches, extras, registered, deletes: () => fetches.filter((f) => f.indexOf('DELETE ') === 0) });
  } finally {
    try { if (registered) registered.destroy(); } catch (_) { /* already torn down */ }
    delete require.cache[podcastsPath]; delete require.cache[surfacePath]; delete require.cache[skinsPath]; delete require.cache[uiPath];
    Object.assign(global, saved);
  }
}
const podBtn = (w, which) => { const b = w.document.querySelectorAll('.ui-confirm__actions .ui-btn'); return which === 'ok' ? b[1] : b[0]; };

test('podcast Extras Delete: Cancel sends nothing; OK (tapped twice) sends exactly one DELETE /api/podcasts/episodes/:id', async () => {
  await bootPodcast(async (c) => {
    const done = [];
    c.extras.onDelete({ id: 'e1', title: 'One Ep' }, (r) => done.push(r), c.player);
    await wait(30);
    assert.strictEqual(c.w.document.querySelectorAll('.ui-sheet').length, 1, 'one dialog');
    assert.ok(podBtn(c.w, 'ok').classList.contains('ui-btn--destructive'), 'the danger fill');
    c.extras.onDelete({ id: 'e1', title: 'One Ep' }, (r) => done.push(r), c.player); // a second tap while open
    await wait(30);
    assert.strictEqual(c.w.document.querySelectorAll('.ui-sheet').length, 1, 'still one dialog');
    c.w.document.querySelector('.ui-sheet').dispatchEvent(new c.w.MouseEvent('click', { bubbles: true })); // a tap inside, not a button
    podBtn(c.w, 'cancel').dispatchEvent(new c.w.MouseEvent('click', { bubbles: true }));
    await wait(400);
    assert.deepStrictEqual(c.deletes(), [], 'Cancel: nothing');
    assert.strictEqual(c.player.closes, 0);
    c.extras.onDelete({ id: 'e1', title: 'One Ep' }, (r) => done.push(r), c.player);
    await wait(30);
    const ok = podBtn(c.w, 'ok');
    ok.dispatchEvent(new c.w.MouseEvent('click', { bubbles: true }));
    ok.dispatchEvent(new c.w.MouseEvent('click', { bubbles: true }));
    await settleMany();
    assert.deepStrictEqual(c.deletes(), ['DELETE /api/podcasts/episodes/e1'], 'exactly one DELETE, the same route');
    assert.strictEqual(c.player.closes, 1, 'the still-playing episode closed');
    assert.deepStrictEqual(done, [true], 'onSuccess once');
  });
});

test('podcast Extras Delete: a view teardown with the confirm up sends nothing', async () => {
  await bootPodcast(async (c) => {
    c.extras.onDelete({ id: 'e1', title: 'One Ep' }, () => {}, c.player);
    await wait(30);
    const ok = podBtn(c.w, 'ok');
    c.registered.destroy();
    ok.dispatchEvent(new c.w.MouseEvent('click', { bubbles: true }));
    await wait(400);
    assert.deepStrictEqual(c.deletes(), [], 'no DELETE');
  });
});
