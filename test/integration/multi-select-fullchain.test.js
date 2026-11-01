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

// Six media items (v2 already liked), plus a second page of three for the append test.
function makeItems(n, from) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = (from || 1) + i;
    out.push({
      id: 'v' + k, title: 'Video ' + k, type: 'video', ext: '.mp4', duration: 100 + k, size: 1000 * k,
      addedAt: 100000 - k, folderName: 'folder', progressPercent: 0, channelName: 'A Channel', liked: k === 2,
    });
  }
  return out;
}

// Scriptable fetch stub. `opts.items` (page 0), `opts.page2` (the append), `opts.total`,
// `opts.meCanModify`, `opts.healthOk`, `opts.fail` = { '<METHOD> <url>': status } for a per-request
// failure. Every call is recorded.
function makeFetchStub(opts) {
  const calls = [];
  let items = opts.items || makeItems(6);
  const page2 = opts.page2 || [];
  const total = typeof opts.total === 'number' ? opts.total : items.length;
  const limit = typeof opts.limit === 'number' ? opts.limit : 60;
  const fail = opts.fail || {};
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    calls.push({ url, method, body: init && init.body });
    const key = method + ' ' + url;
    if (Object.prototype.hasOwnProperty.call(fail, key)) {
      const status = fail[key];
      return Promise.resolve({ ok: false, status, json: async () => ({ error: 'nope ' + status }) });
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
    return new Promise(() => {}); // pins / bell / the next view's html - irrelevant here
  };
  return { fetchImpl, calls, setItems: (next) => { items = next; } };
}

function loadIndex(fetchImpl, pageUrl) {
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
