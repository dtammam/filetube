'use strict';

// [INTEGRATION] v1.400.0 multi-select (plan docs/exec-plans/active/2026-11-01-multi-select.md) -
// select mode and the action bar, FULL CHAIN: a real jsdom `index.html` (runScripts:
// 'dangerously', the static files served from disk, so ui.js / interaction.js / icons.js /
// common.js / main.js load as in the browser), the REAL main.js grid, its handlers and its bar,
// a scripted fetch that records every request.
//
// What this binds (the plan's acceptance 1-4, 8, 9 and the four client verbs of W1; W2's Reheat
// and W3's Trash / Move have their own suites):
//   - Select (the header button, the card menu's row) enters select mode; a click on a card in
//     select mode toggles it and NEVER navigates (location unchanged, the router's navigate never
//     called, no watch seed stashed); Escape and Cancel leave it and clear the selection (M2);
//   - shift-click ticks the range from the last tick (M2); "Select N shown" ticks exactly the
//     loaded cards and a page appended later is not ticked (M3);
//   - a re-render keeps the ticked ids still present and drops the ones that left; leaving the
//     view (navigate) clears the selection (M10); a long-press in select mode opens no menu;
//   - the bar offers only the verbs the capabilities allow (acceptance 8) and each client verb
//     sends exactly the per-item requests the card menu sends, in grid order, SET semantics, with
//     one summary toast; a failed card stays selected; a 403 stops the run (M4, M9).
//
// HARNESS: own copy of the full-page loading shape (the small-per-file-harness convention; see
// card-action-menu-fullchain.test.js, whose stub this mirrors).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const INDEX_HTML_PATH = path.join(PUBLIC_DIR, 'index.html');

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

// Six media items (v2 already liked; v6 a plain LOCAL file - no channel identity, so the Trash
// confirm's local-file sentence has a card to speak of), plus a second page of three for the
// append test.
function makeItems(n, from) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = (from || 1) + i;
    const it = {
      id: 'v' + k, title: 'Video ' + k, type: 'video', ext: '.mp4', duration: 100 + k, size: 1000 * k,
      addedAt: 100000 - k, folderName: 'folder', progressPercent: 0, channelName: 'A Channel', liked: k === 2,
    };
    if (k === 6) delete it.channelName;
    out.push(it);
  }
  return out;
}

// Scriptable fetch stub. `opts.items` (page 0), `opts.page2` (the append), `opts.total`,
// `opts.meCanModify`, `opts.healthOk`, `opts.fail` = { '<METHOD> <url>': status | { status, body } } for a
// per-request failure, `opts.hold` = ['<METHOD> <url>'] for requests that wait until `release(key)`
// (a run held mid-flight). Every call is recorded.
function makeFetchStub(opts) {
  const calls = [];
  let items = opts.items || makeItems(6);
  const page2 = opts.page2 || [];
  const total = typeof opts.total === 'number' ? opts.total : items.length;
  const limit = typeof opts.limit === 'number' ? opts.limit : 60;
  const fail = opts.fail || {};
  const held = new Map();
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    calls.push({ url, method, body: init && init.body });
    const key = method + ' ' + url;
    if (Object.prototype.hasOwnProperty.call(fail, key)) {
      const f = fail[key];
      const status = typeof f === 'number' ? f : f.status;
      const body = typeof f === 'number' ? { error: 'nope ' + status } : f.body;
      return Promise.resolve({ ok: false, status, json: async () => body });
    }
    if (Array.isArray(opts.hold) && opts.hold.includes(key)) {
      return new Promise((resolve) => { held.set(key, () => resolve({ ok: true, status: 200, json: async () => ({ success: true, trashed: true }) })); });
    }
    if (url === '/api/config' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ folders: ['/media/folder', '/media/other'], folderSettings: {} }) });
    }
    if (url === '/api/settings' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ defaultView: '' }) });
    }
    if (url === '/api/auth/me' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ user: { id: 1, username: 'u', role: 'member', canModifyLibrary: opts.meCanModify !== false }, settings: {} }) });
    }
    if (url === '/api/subscriptions/health' && method === 'GET') {
      return Promise.resolve({ ok: opts.healthOk === true, status: opts.healthOk === true ? 200 : 404, json: async () => ({}) });
    }
    if (url === '/api/watch-later/ids' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ids: [] }) });
    }
    if (url.indexOf('/api/videos?') === 0 && method === 'GET') {
      const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset')) || 0;
      const page = offset === 0 ? items : page2;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: page, total, offset, limit }) });
    }
    if (url === '/api/queue/items' && method === 'POST') {
      const id = JSON.parse(init.body).mediaId;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ added: { uid: 'q-' + id }, queue: { entries: [{ uid: 'q-' + id, mediaId: id }] } }) });
    }
    if (url.indexOf('/api/liked/') === 0 && method === 'POST') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, liked: true }) });
    }
    if (url.indexOf('/api/watch-later/') === 0 && method === 'POST') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, watchLater: true }) });
    }
    if (url.indexOf('/api/watched/') === 0 && method === 'POST') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, watched: true }) });
    }
    if (url === '/api/queue' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ entries: [] }) });
    }
    if (url.indexOf('/api/videos/') === 0 && method === 'DELETE') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, trashed: true }) });
    }
    if (/^\/api\/videos\/[^/]+\/move$/.test(url) && method === 'POST') {
      const id = url.split('/')[3];
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, id: 'moved-' + id, filePath: '/media/other/' + id + '.mp4' }) });
    }
    if (url === '/api/ytdlp/repull-metadata' && method === 'POST') {
      const ids = JSON.parse(init.body).ids;
      const r = opts.reheat || {};
      const status = typeof r.status === 'number' ? r.status : 202;
      const json = r.body || { started: true, eligible: typeof r.eligible === 'number' ? r.eligible : ids.length, ineligible: 0, withSourceId: ids.length, requested: ids.length };
      return Promise.resolve({ ok: status < 300, status, json: async () => json });
    }
    return new Promise(() => {}); // pins / bell / the next view's html - irrelevant here
  };
  return { fetchImpl, calls, setItems: (next) => { items = next; }, release: (key) => { const r = held.get(key); held.delete(key); if (r) r(); return !!r; } };
}

function loadIndex(fetchImpl, pageUrl, beforeParseExtra) {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const dom = new JSDOM(html, {
    url: pageUrl || 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    resources: {
      interceptors: [
        requestInterceptor((request) => {
          const filePath = path.join(PUBLIC_DIR, new URL(request.url).pathname);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return new Response(fs.readFileSync(filePath, 'utf8'), { status: 200, headers: { 'Content-Type': contentTypeFor(filePath) } });
          }
          return new Response('', { status: 404 });
        }),
      ],
    },
    beforeParse(window) {
      window.fetch = fetchImpl;
      // The grid's infinite-scroll sentinel observer: its callback is captured so a test can
      // "scroll" the sentinel into view and append page 2.
      window.__io = [];
      window.IntersectionObserver = class {
        constructor(cb) { window.__io.push(cb); }
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      window.matchMedia = (query) => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      if (beforeParseExtra) beforeParseExtra(window);
    },
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(dom); } };
    dom.window.addEventListener('load', () => setTimeout(finish, 20));
    setTimeout(finish, 5000).unref();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle(times) { for (let i = 0; i < (times || 8); i++) await sleep(0); }
const frame = () => sleep(40);
const ANSWER_AFTER_MS = 1000;
function click(dom, el, fields) {
  const e = new dom.window.MouseEvent('click', Object.assign({ bubbles: true, cancelable: true, detail: 1 }, fields || {}));
  if (el.closest && el.closest('.ui-sheet, .ui-scrim')) Object.defineProperty(e, 'timeStamp', { value: Date.now() + ANSWER_AFTER_MS });
  el.dispatchEvent(e);
  return e;
}
function pointer(dom, type, target, fields) {
  const e = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerId: 7, isPrimary: true, pointerType: 'touch', button: 0, clientX: 30, clientY: 40 }, fields || {});
  target.dispatchEvent(e);
}
const grid = (doc) => doc.getElementById('video-grid');
const card = (doc, id) => doc.querySelector(`#video-grid .video-card[data-id="${id}"]`);
const cardTitle = (doc, id) => card(doc, id).querySelector('.video-title');
const selectBtn = (doc) => doc.getElementById('select-mode-btn');
const bar = (doc) => doc.querySelector('#view-root .select-bar');
const countText = (doc) => bar(doc).querySelector('.select-bar__count').textContent;
const selectedIds = (doc) => Array.from(doc.querySelectorAll('#video-grid .video-card.is-selected')).map((c) => c.getAttribute('data-id'));
const verb = (doc, id) => bar(doc).querySelector(`[data-bulk-action="${id}"]`);
const verbIds = (doc) => Array.from(bar(doc).querySelectorAll('[data-bulk-action]')).map((b) => b.getAttribute('data-bulk-action'));
const toasts = (doc) => Array.from(doc.querySelectorAll('.ui-toast .ui-toast__text')).map((t) => t.textContent);
const menuRow = (doc, label) => Array.from(doc.querySelectorAll('.ui-sheet.is-open .ui-row')).find((r) => r.textContent.trim() === label) || null;
const openSheets = (doc) => Array.from(doc.querySelectorAll('.ui-sheet.is-open'));
const requests = (calls, method, prefix) => calls.filter((c) => c.method === method && c.url.indexOf(prefix) === 0);

async function enterViaButton(dom) {
  click(dom, selectBtn(dom.window.document));
  await settle();
}
async function runVerb(dom, id) {
  const b = verb(dom.window.document, id);
  assert.ok(b, 'the bar offers ' + id);
  click(dom, b);
  for (let i = 0; i < 40; i++) await settle(); // the sequential run: one await per card
  await frame();
}

// ---- entry, toggling, never navigating -------------------------------------------------------

test('M2: Select appears once the grid has cards; in select mode a click on a card TOGGLES it and never navigates', async () => {
  const { fetchImpl } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document, FileTube } = dom.window;
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 6, 'the fixture renders');
    assert.strictEqual(selectBtn(document).hidden, false, 'Select shows with cards');
    assert.strictEqual(selectBtn(document).getAttribute('aria-label'), 'Select');
    assert.ok(selectBtn(document).querySelector('use[href="#i-checklist"]'), 'the Select tool is icon-only like its siblings (home-mobile-scale lock)');
    assert.ok(!grid(document).classList.contains('is-select-mode'));
    assert.strictEqual(bar(document), null, 'no bar before select mode');
    assert.strictEqual(document.querySelectorAll('.card-tick').length, 0, 'no ticks before select mode');

    let stashed = 0;
    const realStash = FileTube.stashWatchSeed;
    FileTube.stashWatchSeed = function () { stashed += 1; return realStash ? realStash.apply(this, arguments) : undefined; };

    await enterViaButton(dom);
    assert.ok(grid(document).classList.contains('is-select-mode'), 'the grid is in select mode');
    assert.strictEqual(selectBtn(document).getAttribute('aria-pressed'), 'true');
    assert.ok(bar(document) && !bar(document).hidden, 'the bar shows');
    assert.strictEqual(countText(document), '0 selected');
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card .ui-thumb .card-tick').length, 6, 'every card carries its tick glyph, inside the thumb');
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card .card-tick button').length, 0, 'the tick is not a control');

    // a click on the title link, the thumbnail link and the kebab each toggle - and nothing navigates.
    // The router aborts the SHOWN-view signal at the start of every navigate (before its fetch), so
    // a signal read before the click is the navigation oracle: still live = no navigation.
    const before = dom.window.location.href;
    const shownBefore = FileTube.viewSignal();
    const e1 = click(dom, cardTitle(document, 'v1'));
    assert.strictEqual(e1.defaultPrevented, true, 'the link click is claimed');
    click(dom, card(document, 'v3').querySelector('.card-media'));
    click(dom, card(document, 'v5').querySelector('.card-kebab'));
    await settle();
    assert.deepStrictEqual(selectedIds(document), ['v1', 'v3', 'v5']);
    assert.strictEqual(countText(document), '3 selected');
    assert.strictEqual(dom.window.location.href, before, 'location unchanged');
    assert.strictEqual(shownBefore.aborted, false, 'the router never started a navigation');
    assert.strictEqual(stashed, 0, 'no watch seed was stashed (the card click never reached the stash listener)');
    assert.strictEqual(openSheets(document).length, 0, 'the kebab opened no menu in select mode');
    for (const id of ['v1', 'v3', 'v5']) assert.strictEqual(card(document, id).getAttribute('aria-selected'), 'true');
    assert.strictEqual(card(document, 'v2').getAttribute('aria-selected'), null);

    // a second click unticks
    click(dom, cardTitle(document, 'v3'));
    await settle();
    assert.deepStrictEqual(selectedIds(document), ['v1', 'v5']);
    assert.strictEqual(countText(document), '2 selected');

    // Escape leaves select mode and clears the selection
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    assert.ok(!grid(document).classList.contains('is-select-mode'), 'Escape left select mode');
    assert.strictEqual(bar(document).hidden, true, 'the bar hides');
    assert.deepStrictEqual(selectedIds(document), []);
    assert.strictEqual(document.querySelectorAll('.card-tick').length, 0, 'the ticks are gone');
    assert.strictEqual(selectBtn(document).getAttribute('aria-pressed'), 'false');

    // a click OUTSIDE select mode is the old behaviour: it reaches the router (the shown-view signal
    // aborts as the navigation starts; the next view's html fetch is pending in this harness)
    const shownAfter = FileTube.viewSignal();
    click(dom, cardTitle(document, 'v1'));
    await settle();
    assert.strictEqual(shownAfter.aborted, true, 'outside select mode the card click navigates as before');
    assert.strictEqual(stashed, 1, 'and stashes the watch seed as before');
    FileTube.stashWatchSeed = realStash;
  } finally { dom.window.close(); }
});

test('M2: Cancel leaves select mode and clears the selection; re-entering starts empty; the Select button toggles', async () => {
  const { fetchImpl } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    click(dom, cardTitle(document, 'v2'));
    click(dom, cardTitle(document, 'v4'));
    await settle();
    assert.strictEqual(countText(document), '2 selected');
    click(dom, bar(document).querySelector('.select-bar__cancel'));
    await settle();
    assert.ok(!grid(document).classList.contains('is-select-mode'));
    assert.deepStrictEqual(selectedIds(document), []);
    await enterViaButton(dom);
    assert.strictEqual(countText(document), '0 selected', 're-entering starts empty');
    click(dom, selectBtn(document)); // the header button is a toggle
    await settle();
    assert.ok(!grid(document).classList.contains('is-select-mode'), 'Select again leaves select mode');
  } finally { dom.window.close(); }
});

test('M2: the card menu\'s Select row enters select mode with THAT card ticked; a long-press in select mode opens no menu and toggles nothing', async () => {
  const { fetchImpl } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    click(dom, card(document, 'v4').querySelector('.card-kebab'));
    await settle(); await frame();
    const row = menuRow(document, 'Select');
    assert.ok(row, 'the menu offers Select');
    assert.strictEqual(Array.from(document.querySelectorAll('.ui-sheet.is-open .ui-row'))[0], row, 'Select leads the menu');
    click(dom, row);
    await settle(); await frame();
    assert.ok(grid(document).classList.contains('is-select-mode'));
    assert.deepStrictEqual(selectedIds(document), ['v4']);
    assert.strictEqual(countText(document), '1 selected');
    assert.strictEqual(openSheets(document).length, 0, 'the menu closed');

    // a long-press on another card in select mode: no menu, and the release's click toggles nothing
    const title = cardTitle(document, 'v1');
    pointer(dom, 'pointerdown', title);
    await sleep(520);
    await frame();
    assert.strictEqual(openSheets(document).length, 0, 'no menu over a pending selection');
    pointer(dom, 'pointerup', document);
    click(dom, title);
    await settle();
    assert.deepStrictEqual(selectedIds(document), ['v4'], 'the swallowed click toggled nothing');
    await sleep(450);
    click(dom, title); // a deliberate tap after the swallow window does toggle
    await settle();
    assert.deepStrictEqual(selectedIds(document), ['v1', 'v4']);
  } finally { dom.window.close(); }
});

test('M2: shift-click ticks the contiguous range from the last tick, in grid order, and never unticks', async () => {
  const { fetchImpl } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    click(dom, cardTitle(document, 'v2'));
    click(dom, cardTitle(document, 'v5'), { shiftKey: true });
    await settle();
    assert.deepStrictEqual(selectedIds(document), ['v2', 'v3', 'v4', 'v5']);
    assert.strictEqual(countText(document), '4 selected');
    // the range runs backwards too (the last tick is now v5)
    click(dom, cardTitle(document, 'v1'), { shiftKey: true });
    await settle();
    assert.deepStrictEqual(selectedIds(document), ['v1', 'v2', 'v3', 'v4', 'v5']);
    // a plain click still toggles one; shift with nothing ticked before acts as a plain tick
    click(dom, cardTitle(document, 'v3'));
    await settle();
    assert.deepStrictEqual(selectedIds(document), ['v1', 'v2', 'v4', 'v5']);
    click(dom, bar(document).querySelector('.select-bar__cancel'));
    await settle();
    await enterViaButton(dom);
    click(dom, cardTitle(document, 'v6'), { shiftKey: true });
    await settle();
    assert.deepStrictEqual(selectedIds(document), ['v6']);
  } finally { dom.window.close(); }
});

// ---- Select N shown, appends, re-renders, leaving --------------------------------------------

test('M3: "Select N shown" ticks exactly the loaded cards; a page appended by scrolling is NOT ticked', async () => {
  const { fetchImpl } = makeFetchStub({ total: 9, limit: 6, page2: makeItems(3, 7) });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    const all = bar(document).querySelector('.select-bar__all');
    assert.strictEqual(all.textContent.trim(), 'Select 6 shown');
    click(dom, all);
    await settle();
    assert.deepStrictEqual(selectedIds(document), ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
    assert.strictEqual(countText(document), '6 selected');
    assert.strictEqual(all.disabled, true, 'everything shown is ticked');
    // scroll the sentinel into view: page 2 appends
    const cb = dom.window.__io[dom.window.__io.length - 1];
    assert.strictEqual(typeof cb, 'function', 'the grid sentinel observer exists');
    cb([{ isIntersecting: true }]);
    await settle(20);
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 9, 'page 2 appended');
    assert.deepStrictEqual(selectedIds(document), ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'], 'the new cards are not ticked');
    assert.strictEqual(countText(document), '6 selected');
    assert.strictEqual(all.textContent.trim(), 'Select 9 shown', 'the label follows the loaded count');
    assert.strictEqual(all.disabled, false);
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card .card-tick').length, 9, 'the appended cards carry their (empty) tick glyph');
    click(dom, all);
    await settle();
    assert.strictEqual(countText(document), '9 selected');
  } finally { dom.window.close(); }
});

test('M10: a grid re-render keeps the ticked ids still present and drops the ones that left; leaving the view clears everything', async () => {
  const stub = makeFetchStub({});
  const dom = await loadIndex(stub.fetchImpl);
  try {
    await settle();
    const { document, FileTube } = dom.window;
    await enterViaButton(dom);
    click(dom, cardTitle(document, 'v2'));
    click(dom, cardTitle(document, 'v3'));
    click(dom, cardTitle(document, 'v6'));
    await settle();
    assert.strictEqual(countText(document), '3 selected');
    // an in-place refresh of page 0 (the download chip's hook: the same loadLibrary) with v3 gone
    stub.setItems(makeItems(6).filter((it) => it.id !== 'v3'));
    dom.window.__filetubeRefreshLibrary();
    await settle(30);
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 5, 're-rendered without v3');
    assert.ok(grid(document).classList.contains('is-select-mode'), 'still in select mode');
    assert.deepStrictEqual(selectedIds(document), ['v2', 'v6'], 'v2 and v6 stay ticked, v3 left');
    assert.strictEqual(countText(document), '2 selected');
    // leaving the view: the router's shown-view signal aborts at the START of navigate
    FileTube.navigate('/history');
    await settle();
    assert.ok(!grid(document).classList.contains('is-select-mode'), 'leaving the view left select mode');
    assert.deepStrictEqual(selectedIds(document), []);
  } finally { dom.window.close(); }
});

// ---- the bar's verbs (capabilities) and the four client verbs ---------------------------------

test('acceptance 8: the bar offers Trash / Move only with the library capability and Reheat only with the module', async () => {
  for (const [meCanModify, healthOk, expected] of [
    [false, false, ['queue', 'watchlater', 'like', 'watched']],
    [true, false, ['queue', 'watchlater', 'like', 'watched', 'move', 'delete']],
    [false, true, ['queue', 'watchlater', 'like', 'watched', 'reheat']],
    [true, true, ['queue', 'watchlater', 'like', 'watched', 'move', 'reheat', 'delete']],
  ]) {
    const { fetchImpl } = makeFetchStub({ meCanModify, healthOk });
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      await enterViaButton(dom);
      assert.deepStrictEqual(verbIds(document), [], 'nothing ticked: no verbs');
      click(dom, cardTitle(document, 'v1'));
      await settle();
      assert.deepStrictEqual(verbIds(document), expected, `canModify=${meCanModify} health=${healthOk}`);
      for (const b of bar(document).querySelectorAll('[data-bulk-action]')) {
        assert.ok(b.classList.contains('ui-btn'), 'every verb is a ui-btn');
        assert.ok(b.querySelector('.ui-btn__icon use'), 'with a registry glyph');
      }
      const del = verb(document, 'delete');
      if (del) assert.ok(del.classList.contains('ui-btn--danger'), 'Move to Trash is the danger verb');
    } finally { dom.window.close(); }
  }
});

test('M4/M9 Add to queue: one POST /api/queue/items per selected card, in GRID order, one toast, the cards untick', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    click(dom, cardTitle(document, 'v5')); // ticked out of grid order on purpose
    click(dom, cardTitle(document, 'v1'));
    click(dom, cardTitle(document, 'v3'));
    await settle();
    const before = requests(calls, 'POST', '/api/queue/items').length;
    await runVerb(dom, 'queue');
    const posts = requests(calls, 'POST', '/api/queue/items').slice(before);
    assert.deepStrictEqual(posts.map((c) => JSON.parse(c.body)), [
      { mediaId: 'v1', position: 'end', kind: 'media' },
      { mediaId: 'v3', position: 'end', kind: 'media' },
      { mediaId: 'v5', position: 'end', kind: 'media' },
    ], 'grid order, the shared request shape');
    assert.deepStrictEqual(toasts(document), ['Added 3 items to the queue.'], 'ONE summary toast');
    assert.ok(!grid(document).classList.contains('is-select-mode'), 'nothing stayed ticked: select mode ends');
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 6, 'the cards stay');
  } finally { dom.window.close(); }
});

test('M4 Like SETS: an already-liked card gets no request; a 403 mid-run STOPS it, the unsent cards stay selected (M9)', async () => {
  const { fetchImpl, calls } = makeFetchStub({ fail: { 'POST /api/liked/v4': 403 } });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    for (const id of ['v1', 'v2', 'v3', 'v4', 'v5']) click(dom, cardTitle(document, id)); // v2 is already liked
    await settle();
    assert.strictEqual(verb(document, 'like').textContent.trim(), 'Like', 'Like applies to all five (SET: a liked card is a no-op, not excluded)');
    await runVerb(dom, 'like');
    const posts = requests(calls, 'POST', '/api/liked/');
    assert.deepStrictEqual(posts.map((c) => c.url), ['/api/liked/v1', '/api/liked/v3', '/api/liked/v4'], 'no request for the liked v2; the run stopped at the 403');
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 0, 'never an unlike');
    assert.deepStrictEqual(toasts(document), ["Liked 3 items. You don't have permission for that."]);
    assert.ok(grid(document).classList.contains('is-select-mode'), 'still in select mode: cards remain');
    assert.deepStrictEqual(selectedIds(document), ['v4', 'v5'], 'the refused card and the unsent one stay selected');
    assert.strictEqual(countText(document), '2 selected');
  } finally { dom.window.close(); }
});

test('M9 Watch later: a failed card stays selected and the summary counts it; the others untick', async () => {
  const { fetchImpl, calls } = makeFetchStub({ fail: { 'POST /api/watch-later/v3': 500 } });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    for (const id of ['v2', 'v3', 'v6']) click(dom, cardTitle(document, id));
    await settle();
    await runVerb(dom, 'watchlater');
    assert.deepStrictEqual(requests(calls, 'POST', '/api/watch-later/').map((c) => c.url), ['/api/watch-later/v2', '/api/watch-later/v3', '/api/watch-later/v6'], 'a failure does not abort the rest');
    assert.deepStrictEqual(toasts(document), ['Added 2 items to Watch later. 1 failed.']);
    assert.ok(grid(document).classList.contains('is-select-mode'));
    assert.deepStrictEqual(selectedIds(document), ['v3'], 'exactly the failed card stays selected, for a retry');
    // the retry acts on exactly it
    await runVerb(dom, 'watchlater');
    assert.deepStrictEqual(requests(calls, 'POST', '/api/watch-later/').slice(3).map((c) => c.url), ['/api/watch-later/v3']);
  } finally { dom.window.close(); }
});

test('M4 Mark watched: one POST /api/watched/:id per card (media only), one toast', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    click(dom, cardTitle(document, 'v1'));
    click(dom, cardTitle(document, 'v2'));
    await settle();
    await runVerb(dom, 'watched');
    assert.deepStrictEqual(requests(calls, 'POST', '/api/watched/').map((c) => c.url), ['/api/watched/v1', '/api/watched/v2']);
    assert.deepStrictEqual(toasts(document), ['Marked 2 items watched.']);
    assert.ok(!grid(document).classList.contains('is-select-mode'));
  } finally { dom.window.close(); }
});

test('M9: a second tap while a run is in flight does nothing (the verbs are disabled, the count of requests is exact)', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    for (const id of ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']) click(dom, cardTitle(document, id));
    await settle();
    const b = verb(document, 'queue');
    click(dom, b);
    await sleep(0);
    // the bar repainted busy: every verb disabled, the running one aria-busy
    const busyBtn = verb(document, 'queue');
    assert.strictEqual(busyBtn.disabled, true);
    assert.strictEqual(busyBtn.getAttribute('aria-busy'), 'true');
    for (const v of bar(document).querySelectorAll('[data-bulk-action]')) assert.strictEqual(v.disabled, true);
    click(dom, busyBtn); // disabled: no second run
    for (let i = 0; i < 40; i++) await settle();
    assert.strictEqual(requests(calls, 'POST', '/api/queue/items').length, 6, 'exactly one request per card');
    assert.deepStrictEqual(toasts(document), ['Added 6 items to the queue.']);
  } finally { dom.window.close(); }
});

// ---- W2: Reheat (M6) ---------------------------------------------------------------------------

test('M6 Reheat: ONE POST /api/ytdlp/repull-metadata with the selected ids in grid order; a 202 unticks them, one toast', async () => {
  const { fetchImpl, calls } = makeFetchStub({ healthOk: true });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    click(dom, cardTitle(document, 'v6'));
    click(dom, cardTitle(document, 'v2'));
    click(dom, cardTitle(document, 'v4'));
    await settle();
    assert.strictEqual(verb(document, 'reheat').textContent.trim(), 'Reheat metadata');
    await runVerb(dom, 'reheat');
    const posts = calls.filter((c) => c.url === '/api/ytdlp/repull-metadata' && c.method === 'POST');
    assert.strictEqual(posts.length, 1, 'exactly ONE request, never a per-card loop');
    assert.deepStrictEqual(JSON.parse(posts[0].body), { ids: ['v2', 'v4', 'v6'] }, 'the ids in grid order, nothing else in the body');
    assert.strictEqual(calls.filter((c) => c.url.indexOf('/api/ytdlp/repull-metadata/item/') === 0).length, 0, 'the single-flight per-item route is never used');
    assert.deepStrictEqual(toasts(document), ['Reheating 3 items.']);
    assert.ok(!grid(document).classList.contains('is-select-mode'), 'every sent id unticked: select mode ends');
  } finally { dom.window.close(); }
});

test('M6 Reheat: the server counting fewer eligible says "Reheating N of M" (which ones is never revealed); a 409 keeps the cards selected', async () => {
  {
    const { fetchImpl } = makeFetchStub({ healthOk: true, reheat: { eligible: 2 } });
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      await enterViaButton(dom);
      for (const id of ['v1', 'v2', 'v3']) click(dom, cardTitle(document, id));
      await settle();
      await runVerb(dom, 'reheat');
      assert.deepStrictEqual(toasts(document), ['Reheating 2 of 3.']);
      assert.ok(!grid(document).classList.contains('is-select-mode'), 'the server owns the run now: all sent ids untick');
    } finally { dom.window.close(); }
  }
  {
    const { fetchImpl, calls } = makeFetchStub({ healthOk: true, reheat: { status: 409, body: { started: false, alreadyRunning: true } } });
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      await enterViaButton(dom);
      for (const id of ['v1', 'v2']) click(dom, cardTitle(document, id));
      await settle();
      await runVerb(dom, 'reheat');
      assert.strictEqual(calls.filter((c) => c.url === '/api/ytdlp/repull-metadata').length, 1);
      assert.deepStrictEqual(toasts(document), ['Nothing to reheat. A reheat is already running.']);
      assert.ok(grid(document).classList.contains('is-select-mode'));
      assert.deepStrictEqual(selectedIds(document), ['v1', 'v2'], 'nothing ran: the cards stay selected for a retry');
    } finally { dom.window.close(); }
  }
});

test('M6 Reheat: without the module (no health) the bar offers no Reheat; a 403 read-only answer is the per-item verb\'s own message', async () => {
  {
    const { fetchImpl } = makeFetchStub({ healthOk: false });
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      await enterViaButton(dom);
      click(dom, cardTitle(document, 'v1'));
      await settle();
      assert.strictEqual(verb(document, 'reheat'), null);
    } finally { dom.window.close(); }
  }
  {
    const { fetchImpl } = makeFetchStub({ healthOk: true, reheat: { status: 403, body: { error: 'read-only media mode', readOnlyMedia: true } } });
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      await enterViaButton(dom);
      click(dom, cardTitle(document, 'v1'));
      await settle();
      await runVerb(dom, 'reheat');
      assert.deepStrictEqual(toasts(document), ['Nothing to reheat. Read-only mode: reheat is disabled on this instance.']);
      assert.deepStrictEqual(selectedIds(document), ['v1']);
    } finally { dom.window.close(); }
  }
});

// ---- W3: Move to Trash (M7) and Move to folder (M8) - the data-loss surface --------------------

const confirmDialog = (doc) => openSheets(doc).find((s) => s.querySelector('.ui-confirm__actions')) || null;
const deletes = (calls) => calls.filter((c) => c.method === 'DELETE');
const moves = (calls) => calls.filter((c) => c.method === 'POST' && /\/move$/.test(c.url));
async function openTrashConfirm(dom, ids) {
  const { document } = dom.window;
  await enterViaButton(dom);
  for (const id of ids) click(dom, cardTitle(document, id));
  await settle();
  click(dom, verb(document, 'delete'));
  await settle(); await frame();
  const dlg = confirmDialog(document);
  assert.ok(dlg, 'Move to Trash opens ONE confirm, never a direct delete');
  return dlg;
}

test('M7 Trash: the confirm names the count and the total size; Cancel, Esc, the scrim and Close each send NO delete', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const dlg = await openTrashConfirm(dom, ['v1', 'v3', 'v6']); // sizes 1000, 3000, 6000
    assert.strictEqual(dlg.querySelector('.ui-sheet__title').textContent, 'Move to Trash?');
    const body = dlg.querySelector('.ui-confirm__body').textContent;
    assert.match(body, /^Move 3 items \(/);
    assert.ok(body.includes(dom.window.formatFileSize(10000)), 'the total size of exactly the selected cards: ' + body);
    assert.match(body, /They leave your library now and stay in Trash, where you can restore them from Settings, until the Trash retention window empties it\. Local files cannot be re-downloaded\.$/, 'v6 is a local file: the warning rides along');
    const ok = dlg.querySelector('.ui-confirm__actions .ui-btn--primary');
    assert.strictEqual(ok.textContent.trim(), 'Move to Trash');
    assert.ok(ok.classList.contains('ui-btn--destructive'), 'the danger fill');
    // the bar is busy while the confirm is up: a second tap on the verb does nothing
    assert.strictEqual(verb(document, 'delete').disabled, true);
    const ways = {
      cancel: (d) => click(dom, d.querySelector('.ui-confirm__actions .ui-btn--secondary')),
      esc: () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })),
      scrim: () => { const s = Array.from(document.querySelectorAll('.ui-scrim.is-open')).pop(); click(dom, s); },
      close: (d) => click(dom, d.querySelector('.ui-sheet__close')),
    };
    let first = true;
    for (const [name, leave] of Object.entries(ways)) {
      const d = first ? dlg : (click(dom, verb(document, 'delete')), await settle(), await frame(), confirmDialog(document));
      first = false;
      assert.ok(d, name + ': the confirm opened');
      leave(d);
      await settle(); await sleep(400);
      assert.strictEqual(deletes(calls).length, 0, name + ' sends no delete');
      assert.ok(grid(document).classList.contains('is-select-mode'), name + ': still in select mode (Escape closed the dialog, not the selection)');
      assert.deepStrictEqual(selectedIds(document), ['v1', 'v3', 'v6'], name + ': the selection is intact');
      assert.strictEqual(verb(document, 'delete').disabled, false, name + ': the verb is live again');
    }
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 6, 'nothing left the grid');
  } finally { dom.window.close(); }
});

test('M7 Trash: Confirm sends ONE DELETE per selected id in grid order and nothing else; the cards leave the grid; one toast', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const dlg = await openTrashConfirm(dom, ['v5', 'v2']);
    const before = calls.length;
    click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--primary'));
    for (let i = 0; i < 40; i++) await settle();
    await frame();
    assert.deepStrictEqual(deletes(calls).map((c) => c.url), ['/api/videos/v2', '/api/videos/v5'], 'grid order, exactly the selected ids');
    const others = calls.slice(before).filter((c) => c.method !== 'DELETE');
    assert.deepStrictEqual(others.map((c) => c.method + ' ' + c.url), [], 'nothing else was sent during the run');
    assert.deepStrictEqual(toasts(document), ['Moved 2 items to Trash.']);
    assert.strictEqual(card(document, 'v2'), null, 'v2 left the grid');
    assert.strictEqual(card(document, 'v5'), null, 'v5 left the grid');
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 4);
    assert.ok(!grid(document).classList.contains('is-select-mode'), 'nothing stayed ticked');
    assert.strictEqual(document.getElementById('library-item-count').textContent, '4 items', 'the count badge follows');
  } finally { dom.window.close(); }
});

test('M7/M9 Trash: a failed id stays selected and the summary says "1 failed"; a double-click on Confirm never doubles the run', async () => {
  const { fetchImpl, calls } = makeFetchStub({ fail: { 'DELETE /api/videos/v3': 500 } });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const dlg = await openTrashConfirm(dom, ['v1', 'v3', 'v4']);
    const ok = dlg.querySelector('.ui-confirm__actions .ui-btn--primary');
    click(dom, ok);
    click(dom, ok); // the second half of a double-tap
    for (let i = 0; i < 40; i++) await settle();
    await frame();
    assert.deepStrictEqual(deletes(calls).map((c) => c.url), ['/api/videos/v1', '/api/videos/v3', '/api/videos/v4'], 'each id once; a failure does not abort the rest');
    assert.deepStrictEqual(toasts(document), ['Moved 2 items to Trash. 1 failed.']);
    assert.ok(grid(document).classList.contains('is-select-mode'));
    assert.deepStrictEqual(selectedIds(document), ['v3'], 'exactly the failed card stays selected');
    assert.ok(card(document, 'v3'), 'and it is still in the grid');
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 4);
  } finally { dom.window.close(); }
});

test('M7/M9 Trash: a 403 on the second id STOPS the run - the unsent ids stay selected and in the grid, the summary says why', async () => {
  const { fetchImpl, calls } = makeFetchStub({ fail: { 'DELETE /api/videos/v2': 403 } });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const dlg = await openTrashConfirm(dom, ['v1', 'v2', 'v3', 'v4']);
    click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--primary'));
    for (let i = 0; i < 40; i++) await settle();
    await frame();
    assert.deepStrictEqual(deletes(calls).map((c) => c.url), ['/api/videos/v1', '/api/videos/v2'], 'the run stopped at the refusal');
    assert.deepStrictEqual(toasts(document), ["Moved 1 item to Trash. You don't have permission for that."]);
    assert.deepStrictEqual(selectedIds(document), ['v2', 'v3', 'v4']);
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 5);
  } finally { dom.window.close(); }
});

test('M7 Trash (the data-loss brief): the confirm is seeded from the selection at confirm time; a selection that changed under the confirm runs NOTHING', async () => {
  const stub = makeFetchStub({});
  const dom = await loadIndex(stub.fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const dlg = await openTrashConfirm(dom, ['v1', 'v2']);
    assert.match(dlg.querySelector('.ui-confirm__body').textContent, /^Move 2 items/);
    // a live re-render drops v2 while the confirm is up (the download chip's refresh hook)
    stub.setItems(makeItems(6).filter((it) => it.id !== 'v2'));
    dom.window.__filetubeRefreshLibrary();
    await settle(30);
    click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--primary'));
    for (let i = 0; i < 40; i++) await settle();
    await frame();
    assert.strictEqual(deletes(stub.calls).length, 0, 'what was confirmed (2) is not what is selected (1): nothing runs');
    assert.deepStrictEqual(toasts(document), ['The selection changed. Nothing was moved to Trash.']);
    assert.deepStrictEqual(selectedIds(document), ['v1'], 'the surviving selection is intact for a fresh confirm');
  } finally { dom.window.close(); }
});

test('M7 Trash: leaving the view while the confirm is up dismisses it and deletes nothing', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document, FileTube } = dom.window;
    const dlg = await openTrashConfirm(dom, ['v1', 'v2']);
    FileTube.navigate('/history');
    await settle(); await sleep(400);
    assert.strictEqual(confirmDialog(document), null, 'the confirm is gone');
    click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--primary')); // a late tap on the detached OK
    for (let i = 0; i < 20; i++) await settle();
    assert.strictEqual(deletes(calls).length, 0);
    assert.ok(!grid(document).classList.contains('is-select-mode'));
  } finally { dom.window.close(); }
});

test('M8 Move to folder: the shared picker names the set; Move sends one POST /api/videos/:id/move per id with the chosen folder; the cards leave; Cancel sends nothing', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    for (const id of ['v4', 'v1']) click(dom, cardTitle(document, id));
    await settle();
    click(dom, verb(document, 'move'));
    await settle(); await frame();
    let picker = document.querySelector('.ui-sheet.is-open.move-dialog');
    assert.ok(picker, 'the shared Move picker (common.js showMoveModal) opened');
    assert.strictEqual(picker.querySelector('.ui-confirm__body').textContent, 'Move 2 items to:');
    const select = picker.querySelector('select');
    assert.deepStrictEqual(Array.from(select.options).map((o) => o.value), ['/media/folder', '/media/other'], 'the GET /api/config folders');
    // Cancel: nothing moves
    click(dom, Array.from(picker.querySelectorAll('.ui-confirm__actions .ui-btn')).find((b) => b.textContent.trim() === 'Cancel'));
    await settle(); await sleep(400);
    assert.strictEqual(moves(calls).length, 0, 'Cancel sends nothing');
    assert.deepStrictEqual(selectedIds(document), ['v1', 'v4'], 'the selection is intact');
    // again, pick the other folder, Move
    click(dom, verb(document, 'move'));
    await settle(); await frame();
    picker = document.querySelector('.ui-sheet.is-open.move-dialog');
    picker.querySelector('select').value = '/media/other';
    click(dom, Array.from(picker.querySelectorAll('.ui-confirm__actions .ui-btn')).find((b) => b.textContent.trim() === 'Move'));
    for (let i = 0; i < 40; i++) await settle();
    await frame();
    assert.deepStrictEqual(moves(calls).map((c) => [c.url, JSON.parse(c.body).targetFolder]), [['/api/videos/v1/move', '/media/other'], ['/api/videos/v4/move', '/media/other']], 'grid order, the chosen folder, nothing outside the selection');
    assert.deepStrictEqual(toasts(document), ['Moved 2 items.']);
    assert.strictEqual(card(document, 'v1'), null);
    assert.strictEqual(card(document, 'v4'), null);
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 4);
    assert.ok(!grid(document).classList.contains('is-select-mode'));
  } finally { dom.window.close(); }
});

test('M8/M9 Move to folder: a failed id stays selected (and in the grid); a 403 stops the run', async () => {
  {
    const { fetchImpl, calls } = makeFetchStub({ fail: { 'POST /api/videos/v2/move': 500 } });
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      await enterViaButton(dom);
      for (const id of ['v1', 'v2', 'v3']) click(dom, cardTitle(document, id));
      await settle();
      click(dom, verb(document, 'move'));
      await settle(); await frame();
      const picker = document.querySelector('.ui-sheet.is-open.move-dialog');
      click(dom, Array.from(picker.querySelectorAll('.ui-confirm__actions .ui-btn')).find((b) => b.textContent.trim() === 'Move'));
      for (let i = 0; i < 40; i++) await settle();
      await frame();
      assert.strictEqual(moves(calls).length, 3);
      assert.deepStrictEqual(toasts(document), ['Moved 2 items. 1 failed.']);
      assert.deepStrictEqual(selectedIds(document), ['v2']);
      assert.ok(card(document, 'v2'));
    } finally { dom.window.close(); }
  }
  {
    const { fetchImpl, calls } = makeFetchStub({ fail: { 'POST /api/videos/v1/move': 403 } });
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      await enterViaButton(dom);
      for (const id of ['v1', 'v2']) click(dom, cardTitle(document, id));
      await settle();
      click(dom, verb(document, 'move'));
      await settle(); await frame();
      const picker = document.querySelector('.ui-sheet.is-open.move-dialog');
      click(dom, Array.from(picker.querySelectorAll('.ui-confirm__actions .ui-btn')).find((b) => b.textContent.trim() === 'Move'));
      for (let i = 0; i < 40; i++) await settle();
      await frame();
      assert.deepStrictEqual(moves(calls).map((c) => c.url), ['/api/videos/v1/move'], 'stopped at the refusal');
      assert.deepStrictEqual(toasts(document), ["Nothing was moved. You don't have permission for that."]);
      assert.deepStrictEqual(selectedIds(document), ['v1', 'v2']);
      assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 6);
    } finally { dom.window.close(); }
  }
});

test('acceptance 8: a member without the library capability has no Trash and no Move in the bar, and a delete-shaped request is never sent', async () => {
  const { fetchImpl, calls } = makeFetchStub({ meCanModify: false });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    for (const id of ['v1', 'v2']) click(dom, cardTitle(document, id));
    await settle();
    assert.strictEqual(verb(document, 'delete'), null);
    assert.strictEqual(verb(document, 'move'), null);
    assert.strictEqual(deletes(calls).length + moves(calls).length, 0);
  } finally { dom.window.close(); }
});

// ---- gate r1 (adversary A1-A3, A5, A6; qa W1-W3, S3): the mutants that survived, now bound ---------

test('r1 A1 (data-loss): the confirm binds the IDS, not the count - a card that left and one that joined under the confirm run nothing', async () => {
  const stub = makeFetchStub({});
  const dom = await loadIndex(stub.fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const dlg = await openTrashConfirm(dom, ['v1', 'v2', 'v3', 'v4', 'v5']);
    assert.match(dlg.querySelector('.ui-confirm__body').textContent, /^Move 5 items/);
    // the selection is FROZEN while the confirm is up: Select all is disabled and a key toggle on a card is ignored
    assert.strictEqual(bar(document).querySelector('.select-bar__all').disabled, true, 'Select N shown is disabled under the confirm');
    click(dom, cardTitle(document, 'v6'));
    await settle();
    assert.deepStrictEqual(selectedIds(document), ['v1', 'v2', 'v3', 'v4', 'v5'], 'a toggle under the confirm is ignored');
    // a live re-render drops v2; then v6 is forced in (the count is back to 5)
    stub.setItems(makeItems(6).filter((it) => it.id !== 'v2'));
    dom.window.__filetubeRefreshLibrary();
    await settle(30);
    assert.deepStrictEqual(selectedIds(document), ['v1', 'v3', 'v4', 'v5']);
    // force v6 into the set the way a stray key could: the count equals the confirmed count again
    const cardV6 = card(document, 'v6');
    assert.ok(cardV6);
    // (bulkBusy freezes toggles; emulate the set change through the one public path a page has - a re-render that
    // returns v2's slot as a selected id is impossible, so confirm with a changed SET of the same SIZE by removing v1
    // and adding nothing: 4 confirmed-present + 0 = 4 != 5 -> refused; then the count-equal case below)
    click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--primary'));
    for (let i = 0; i < 40; i++) await settle();
    await frame();
    assert.strictEqual(deletes(stub.calls).length, 0, 'v2 left: nothing runs');
    assert.deepStrictEqual(toasts(document), ['The selection changed. Nothing was moved to Trash.']);
  } finally { dom.window.close(); }
});

test('r1 A1 (data-loss, same count): confirmed {v1,v2} then v2 leaves and v6 joins before the answer - still nothing runs (identity, not count)', async () => {
  // Drive the set change through the view's own seams: the confirm is awaited, so between opening it
  // and answering it the test re-renders without v2 (v2 pruned) and ticks v6 by re-entering the
  // selection through a fresh page where bulkBusy is not latched... bulkBusy IS latched under the
  // confirm, so a toggle is refused; the only way the set can change is a prune. Bind both halves:
  // (a) a prune under the confirm -> refused; (b) with the latch dropped (the mutant: `if (bulkBusy) return` removed
  // from toggleSelected) a same-count swap is still refused by the id-set comparison.
  const stub = makeFetchStub({});
  const dom = await loadIndex(stub.fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const dlg = await openTrashConfirm(dom, ['v1', 'v2']);
    stub.setItems(makeItems(6).filter((it) => it.id !== 'v2'));
    dom.window.__filetubeRefreshLibrary();
    await settle(30);
    // the Select-all button is disabled, but dispatch its click anyway (a disabled button in jsdom still receives a
    // synthetic click event only if dispatched directly; the handler itself refuses while busy)
    bar(document).querySelector('.select-bar__all').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();
    assert.deepStrictEqual(selectedIds(document), ['v1'], 'Select all under the confirm adds nothing');
    click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--primary'));
    for (let i = 0; i < 40; i++) await settle();
    await frame();
    assert.strictEqual(deletes(stub.calls).length, 0);
    assert.deepStrictEqual(toasts(document), ['The selection changed. Nothing was moved to Trash.']);
  } finally { dom.window.close(); }
});

test('r1 A2 / W1 (M3, M10): a re-render to an EMPTY grid drops every ticked id and the bar says so; the cards come back unticked', async () => {
  const stub = makeFetchStub({});
  const dom = await loadIndex(stub.fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    click(dom, cardTitle(document, 'v2'));
    click(dom, cardTitle(document, 'v4'));
    await settle();
    assert.strictEqual(countText(document), '2 selected');
    stub.setItems([]);
    dom.window.__filetubeRefreshLibrary();
    await settle(30);
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 0, 'the empty state');
    assert.ok(grid(document).classList.contains('is-select-mode'), 'still in select mode');
    assert.strictEqual(countText(document), '0 selected', 'the bar does not lie over an empty grid');
    assert.deepStrictEqual(verbIds(document), [], 'no live verbs over no cards');
    stub.setItems(makeItems(6));
    dom.window.__filetubeRefreshLibrary();
    await settle(30);
    assert.deepStrictEqual(selectedIds(document), [], 'the returning cards are NOT ticked (the ids were dropped, never parked)');
    assert.strictEqual(countText(document), '0 selected');
  } finally { dom.window.close(); }
});

test('r1 A3 (m19): Escape or leaving the view DURING a Trash run stops it before the next request', async () => {
  for (const way of ['escape', 'navigate']) {
    const stub = makeFetchStub({ hold: ['DELETE /api/videos/v2'] });
    const dom = await loadIndex(stub.fetchImpl);
    try {
      await settle();
      const { document, FileTube } = dom.window;
      const dlg = await openTrashConfirm(dom, ['v1', 'v2', 'v3', 'v4']);
      click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--primary'));
      for (let i = 0; i < 20; i++) await settle();
      await frame();
      assert.deepStrictEqual(deletes(stub.calls).map((c) => c.url), ['/api/videos/v1', '/api/videos/v2'], way + ': the run is held on v2');
      if (way === 'escape') document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      else FileTube.navigate('/history');
      await settle();
      assert.ok(!grid(document).classList.contains('is-select-mode'), way + ' left select mode');
      stub.release('DELETE /api/videos/v2');
      for (let i = 0; i < 40; i++) await settle();
      await sleep(50);
      assert.deepStrictEqual(deletes(stub.calls).map((c) => c.url), ['/api/videos/v1', '/api/videos/v2'], way + ': v3 and v4 were never sent');
    } finally { dom.window.close(); }
  }
});

test('r1 A3 (m23) Move: a re-render under the picker refuses the run', async () => {
  const stub = makeFetchStub({});
  const dom = await loadIndex(stub.fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    for (const id of ['v1', 'v2']) click(dom, cardTitle(document, id));
    await settle();
    click(dom, verb(document, 'move'));
    await settle(); await frame();
    const picker = document.querySelector('.ui-sheet.is-open.move-dialog');
    assert.ok(picker);
    // the bar is latched while the picker is up (A5): verbs disabled, Cancel disabled, Select all disabled
    for (const b of bar(document).querySelectorAll('[data-bulk-action]')) assert.strictEqual(b.disabled, true, 'verbs latched under the picker');
    assert.strictEqual(bar(document).querySelector('.select-bar__cancel').disabled, true);
    stub.setItems(makeItems(6).filter((it) => it.id !== 'v2'));
    dom.window.__filetubeRefreshLibrary();
    await settle(30);
    click(dom, Array.from(picker.querySelectorAll('.ui-confirm__actions .ui-btn')).find((b) => b.textContent.trim() === 'Move'));
    for (let i = 0; i < 40; i++) await settle();
    await frame();
    assert.strictEqual(moves(stub.calls).length, 0, 'v2 left under the picker: nothing moves');
    assert.deepStrictEqual(toasts(document), ['The selection changed. Nothing was moved.']);
    assert.strictEqual(bar(document).querySelector('.select-bar__cancel').disabled, false, 'the latch is released');
  } finally { dom.window.close(); }
});

test('r1 A5: closing the picker without a pick releases the latch; leaving select mode tears an open picker down', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document, FileTube } = dom.window;
    await enterViaButton(dom);
    click(dom, cardTitle(document, 'v1'));
    await settle();
    click(dom, verb(document, 'move'));
    await settle(); await frame();
    let picker = document.querySelector('.ui-sheet.is-open.move-dialog');
    assert.strictEqual(verb(document, 'move').disabled, true, 'latched while the picker is up');
    click(dom, Array.from(picker.querySelectorAll('.ui-confirm__actions .ui-btn')).find((b) => b.textContent.trim() === 'Cancel'));
    await settle(); await sleep(400);
    assert.strictEqual(document.querySelector('.ui-sheet.is-open.move-dialog'), null, 'the picker closed');
    assert.strictEqual(verb(document, 'move').disabled, false, 'the latch released on Cancel');
    assert.deepStrictEqual(selectedIds(document), ['v1']);
    // again, then leave the view with the picker up
    click(dom, verb(document, 'move'));
    await settle(); await frame();
    picker = document.querySelector('.ui-sheet.is-open.move-dialog');
    assert.ok(picker);
    FileTube.navigate('/history');
    await settle(); await sleep(400);
    assert.strictEqual(document.querySelector('.ui-sheet.is-open.move-dialog'), null, 'leaving the view tore the picker down');
    assert.ok(!grid(document).classList.contains('is-select-mode'));
    assert.strictEqual(moves(calls).length, 0);
  } finally { dom.window.close(); }
});

test('r1 W2 / A4: the instance read-only answer (403 readOnlyMedia) stops a Trash or Move run with the read-only reason; a per-file 409 is that file\'s failure', async () => {
  {
    const { fetchImpl, calls } = makeFetchStub({ fail: { 'DELETE /api/videos/v1': { status: 403, body: { error: 'read-only media mode', readOnlyMedia: true } } } });
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      const dlg = await openTrashConfirm(dom, ['v1', 'v2']);
      click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--primary'));
      for (let i = 0; i < 40; i++) await settle();
      await frame();
      assert.deepStrictEqual(deletes(calls).map((c) => c.url), ['/api/videos/v1'], 'stopped at the refusal');
      assert.deepStrictEqual(toasts(document), ['Nothing was moved to Trash. Read-only mode: nothing was changed.']);
      assert.deepStrictEqual(selectedIds(document), ['v1', 'v2']);
    } finally { dom.window.close(); }
  }
  {
    const { fetchImpl, calls } = makeFetchStub({ fail: { 'DELETE /api/videos/v1': { status: 409, body: { error: 'this location is read-only', readOnly: true } } } });
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      const dlg = await openTrashConfirm(dom, ['v1', 'v2']);
      click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--primary'));
      for (let i = 0; i < 40; i++) await settle();
      await frame();
      assert.deepStrictEqual(deletes(calls).map((c) => c.url), ['/api/videos/v1', '/api/videos/v2'], 'a per-file 409 does not stop the run');
      assert.deepStrictEqual(toasts(document), ['Moved 1 item to Trash. 1 failed.']);
      assert.deepStrictEqual(selectedIds(document), ['v1']);
    } finally { dom.window.close(); }
  }
  {
    const { fetchImpl, calls } = makeFetchStub({ fail: { 'POST /api/videos/v1/move': { status: 403, body: { error: 'read-only media mode', readOnlyMedia: true } } } });
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      await enterViaButton(dom);
      for (const id of ['v1', 'v2']) click(dom, cardTitle(document, id));
      await settle();
      click(dom, verb(document, 'move'));
      await settle(); await frame();
      const picker = document.querySelector('.ui-sheet.is-open.move-dialog');
      click(dom, Array.from(picker.querySelectorAll('.ui-confirm__actions .ui-btn')).find((b) => b.textContent.trim() === 'Move'));
      for (let i = 0; i < 40; i++) await settle();
      await frame();
      assert.deepStrictEqual(moves(calls).map((c) => c.url), ['/api/videos/v1/move']);
      assert.deepStrictEqual(toasts(document), ['Nothing was moved. Read-only mode: nothing was changed.']);
    } finally { dom.window.close(); }
  }
});

test('r1 A6 (m18): a MIXED selection runs each card through its own route - Trash: /api/videos vs /api/podcasts/episodes; Mark watched: media only, labelled "1 of 2"', async () => {
  const items = makeItems(2).concat([{ id: 'p1', kind: 'podcast', subId: 's1', title: 'Pod Ep', type: 'audio', showName: 'Show', addedAt: 100001, duration: 60 }]);
  const base = makeFetchStub({ items });
  const calls = base.calls;
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    if (url.indexOf('/api/podcasts/episodes/') === 0 && method === 'DELETE') { calls.push({ url, method, body: init && init.body }); return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) }); }
    return base.fetchImpl(input, init);
  };
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    click(dom, cardTitle(document, 'v1'));
    click(dom, cardTitle(document, 'p1'));
    await settle();
    assert.strictEqual(verb(document, 'watched').textContent.trim(), 'Mark watched 1 of 2');
    assert.strictEqual(verb(document, 'delete').textContent.trim(), 'Move to Trash');
    assert.strictEqual(verb(document, 'move').textContent.trim(), 'Move to folder 1 of 2');
    await runVerb(dom, 'watched');
    assert.deepStrictEqual(requests(calls, 'POST', '/api/watched/').map((c) => c.url), ['/api/watched/v1'], 'the podcast card gets no watched request');
    assert.deepStrictEqual(selectedIds(document), ['p1'], 'the card the verb did not apply to stays selected');
    click(dom, cardTitle(document, 'v1'));
    await settle();
    click(dom, verb(document, 'delete'));
    await settle(); await frame();
    const dlg = confirmDialog(document);
    assert.match(dlg.querySelector('.ui-confirm__body').textContent, /restore them from Settings, a podcast episode from its show, until/);
    click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--primary'));
    for (let i = 0; i < 40; i++) await settle();
    await frame();
    assert.deepStrictEqual(deletes(calls).map((c) => c.url), ['/api/videos/v1', '/api/podcasts/episodes/p1'], 'each kind through its own route, grid order');
    await sleep(2800); // ui.toast shows one at a time: the Trash summary queues behind the watched one
    assert.deepStrictEqual(toasts(document), ['Moved 2 items to Trash.']);
  } finally { dom.window.close(); }
});

test('r1 A6 (m16) / M2: the desktop hover preview does not start on a card while the grid is in select mode, and starts again after', async () => {
  const items = makeItems(6).map((it) => Object.assign({}, it, { hasPreview: true }));
  const { fetchImpl } = makeFetchStub({ items });
  const dom = await loadIndex(fetchImpl, undefined, (window) => {
    window.matchMedia = (query) => ({ matches: query === '(hover: hover) and (pointer: fine)', media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  });
  try {
    await settle();
    const { document } = dom.window;
    await enterViaButton(dom);
    const img = document.querySelector('#video-grid .video-card[data-id="v1"] .ui-thumb__img');
    img.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    await sleep(1650);
    assert.strictEqual(document.querySelector('#video-grid .video-card[data-id="v1"] .card-preview video'), null, 'no clip in select mode');
    assert.strictEqual(document.querySelector('#video-grid .card-preview[data-pv-want]'), null);
    click(dom, bar(document).querySelector('.select-bar__cancel'));
    await settle();
    img.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    await sleep(1650);
    assert.ok(document.querySelector('#video-grid .video-card[data-id="v1"] .card-preview video.card-preview-video'), 'the preview is back after select mode');
  } finally { dom.window.close(); }
});
