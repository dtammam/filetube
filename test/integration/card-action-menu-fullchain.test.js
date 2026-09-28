'use strict';

// [INTEGRATION] UI pass sweep S2 (D8.5) - the card action menu, FULL CHAIN: a
// real jsdom `index.html` (runScripts: 'dangerously', static files served from
// disk, so ui.js / interaction.js / icons.js / common.js / main.js all load as
// in the browser), the REAL main.js grid and its handlers, a scripted fetch.
// Converted from the v1.67 card-corners full-chain suite (AC12): the corner
// layout is gone; each old bind carries over to the menu - applicability per
// item (C4), capability gates (v1.81), share / reheat / queue reaching the same
// endpoints - and the destructive path gets its own suite:
//
//   DELETE IS DESTRUCTIVE (LESSONS 9, the full gate). The card's Delete
//   ("Move to Trash") must NEVER reach `DELETE /api/videos/:id` unless a
//   ui.confirm resolved TRUE. Every entry path to the menu is driven - the
//   kebab (pointer click), the kebab by keyboard (a detail-0 click), a
//   long-press (pointer events, the real FTInteraction timer) and a desktop
//   right-click (contextmenu) - and every way of leaving the confirm without
//   saying yes (Cancel, Esc, the scrim, the Close button, Enter, a late tap on
//   Move to Trash after a Cancel) is asserted to send NO delete. Only the
//   confirm's own "Move to Trash" button sends exactly one.
//
// HARNESS: own copy of the full-page loading shape (the small-per-file-harness
// convention; see library-pagination.test.js for the prior-art chain).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const INDEX_HTML_PATH = path.join(PUBLIC_DIR, 'index.html');

const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

// Two items: `yt1` is yt-dlp-managed (channelName) WITH a server-derived
// watchUrl; `local1` is a plain local file (no watchUrl -> no Share).
function makeItems() {
  return [
    {
      id: 'yt1', title: 'From YouTube', type: 'video', ext: '.mp4',
      duration: 120, size: 1000, addedAt: 100000, folderName: 'folder',
      progressPercent: 0, channelName: 'A Channel', watchUrl: WATCH_URL,
    },
    {
      id: 'local1', title: 'Local File', type: 'video', ext: '.mp4',
      duration: 60, size: 2000, addedAt: 99999, folderName: 'folder',
      progressPercent: 0,
    },
  ];
}

// Scriptable fetch stub. `opts.me`: 'fail' -> 500, 'network' -> rejected; else a
// member whose canModifyLibrary is `opts.meCanModify !== false`. `opts.healthOk`:
// /api/subscriptions/health 200 vs 404. Every call is recorded.
function makeFetchStub(opts) {
  const calls = [];
  const items = opts.items || makeItems();
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    calls.push({ url, method, body: init && init.body });
    if (url === '/api/config' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ folders: ['/media/folder'], folderSettings: {} }) });
    }
    if (url === '/api/settings' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ defaultView: '' }) });
    }
    if (url === '/api/auth/me' && method === 'GET') {
      if (opts.me === 'network') return Promise.reject(new Error('offline'));
      if (opts.me === 'fail') return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ user: { id: 1, username: 'u', role: 'member', canModifyLibrary: opts.meCanModify !== false }, settings: {} }) });
    }
    if (url === '/api/subscriptions/health' && method === 'GET') {
      return Promise.resolve({ ok: opts.healthOk === true, status: opts.healthOk === true ? 200 : 404, json: async () => ({}) });
    }
    if (url.indexOf('/api/videos?') === 0 && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ items, total: items.length, offset: 0, limit: 60 }) });
    }
    if (url.indexOf('/api/ytdlp/repull-metadata/item/') === 0 && method === 'POST') {
      return Promise.resolve({ ok: true, status: 202, json: async () => ({ started: true }) });
    }
    if (url === '/api/queue/items' && method === 'POST') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ queue: { entries: [{ uid: 'q1', mediaId: 'yt1' }] } }) });
    }
    if (url.indexOf('/api/videos/') === 0 && method === 'DELETE') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, trashed: true }) });
    }
    return new Promise(() => {}); // pins/bell/etc. -- irrelevant here
  };
  return { fetchImpl, calls };
}

function loadIndex(fetchImpl, beforeParseExtra) {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
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
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
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
// A sheet gets .is-open on the next animation frame; let it land.
const frame = () => sleep(40);

// A person reads a sheet before answering it: ui.js ignores a pointer activation of a sheet's
// controls until it has been open ACTIVATION_GUARD_MS (the double-tap guard, gate r1), so a
// pointer click aimed INSIDE an open sheet (or at its scrim) carries a timeStamp
// ANSWER_AFTER_MS past the page's clock. The guard itself is bound by
// ui-activation-guard.test.js and the geometry DBLTAP check.
const ANSWER_AFTER_MS = 1000;
function click(dom, el) {
  const e = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  if (el.closest && el.closest('.ui-sheet, .ui-scrim')) Object.defineProperty(e, 'timeStamp', { value: Date.now() + ANSWER_AFTER_MS });
  el.dispatchEvent(e);
}
const openSheets = (doc) => Array.from(doc.querySelectorAll('.ui-sheet.is-open'));
const menuRow = (doc, label) => {
  const rows = Array.from(doc.querySelectorAll('.ui-sheet.is-open .ui-row'));
  return rows.find((r) => r.textContent.trim() === label) || null;
};
const menuLabels = (doc) => Array.from(doc.querySelectorAll('.ui-sheet.is-open .ui-row')).map((r) => r.textContent.trim());
const kebabOf = (doc, id) => doc.querySelector(`#video-grid .video-card[data-id="${id}"] .card-kebab`);
const deletes = (calls) => calls.filter((c) => c.method === 'DELETE');

async function openMenuByKebab(dom, id) {
  click(dom, kebabOf(dom.window.document, id));
  await settle(); await frame();
}
// The confirm dialog: a dialog sheet holding the ui-confirm actions row.
function confirmDialog(doc) {
  return openSheets(doc).find((s) => s.querySelector('.ui-confirm__actions')) || null;
}
async function openDeleteConfirm(dom, id) {
  await openMenuByKebab(dom, id);
  const row = menuRow(dom.window.document, 'Move to Trash');
  assert.ok(row, 'the menu offers Move to Trash');
  click(dom, row);
  await settle(); await frame();
  const dlg = confirmDialog(dom.window.document);
  assert.ok(dlg, 'Move to Trash opens a confirm - never a direct delete');
  return dlg;
}

// ---- the clean card ----------------------------------------------------------

test('D8.5 in the real grid: every card shows ONE control (the kebab) and a thumbnail with only its badge', async () => {
  const { fetchImpl } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const cards = document.querySelectorAll('#video-grid .video-card');
    assert.strictEqual(cards.length, 2, 'both fixture items render');
    for (const card of cards) {
      assert.strictEqual(card.querySelectorAll('button, a[download]').length, 1, 'one control per card');
      assert.ok(card.querySelector('.video-info > .card-kebab.ui-btn'), 'the kebab, in the info row');
      assert.strictEqual(card.querySelector('.card-media button, .card-media [class*="card-corner"]'), null, 'nothing over the thumbnail');
      assert.ok(card.querySelector('.card-media .ui-thumb__duration'), 'the one duration badge');
      assert.strictEqual(card.querySelector('.card-type'), null, 'no search type label on a plain library card');
    }
  } finally { dom.window.close(); }
});

test('the kebab opens ONE menu with what applies to THAT item (C4): Share only with the server link; Move to Trash with the capability', async () => {
  const { fetchImpl } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    await openMenuByKebab(dom, 'yt1');
    assert.deepStrictEqual(menuLabels(document), ['Add to queue', 'Like', 'Share', 'Save to device', 'Move to Trash']);
    assert.strictEqual(openSheets(document).length, 1, 'one sheet');
    const trash = menuRow(document, 'Move to Trash');
    assert.ok(trash.classList.contains('ui-row--danger'), 'the destructive entry reads as danger');
    click(dom, document.querySelector('.ui-sheet.is-open .ui-sheet__close'));
    await settle(); await frame();
    await openMenuByKebab(dom, 'local1');
    assert.deepStrictEqual(menuLabels(document), ['Add to queue', 'Like', 'Save to device', 'Move to Trash'], 'no Share without a server-derived link (never a substitute)');
  } finally { dom.window.close(); }
});

test('v1.81 write-RBAC: no Move to Trash for a member without the capability, nor when auth/me fails (fail-safe); the grid never blocks', async () => {
  for (const opts of [{ meCanModify: false }, { me: 'fail' }, { me: 'network' }]) {
    const { fetchImpl } = makeFetchStub(opts);
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      assert.ok(kebabOf(document, 'yt1'), `cards render (${JSON.stringify(opts)})`);
      await openMenuByKebab(dom, 'yt1');
      assert.ok(!menuLabels(document).includes('Move to Trash'), `no delete entry (${JSON.stringify(opts)})`);
      assert.ok(menuLabels(document).includes('Save to device'), 'the rest of the menu is intact');
    } finally { dom.window.close(); }
  }
});

test('SHARE: the menu runs the native share sheet with the SERVER-derived {title, url}; with no sheet and no clipboard it toasts', async () => {
  const shareCalls = [];
  const { fetchImpl } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl, (window) => {
    window.navigator.share = (payload) => { shareCalls.push(payload); return Promise.resolve(); };
  });
  try {
    await settle();
    await openMenuByKebab(dom, 'yt1');
    click(dom, menuRow(dom.window.document, 'Share'));
    await settle();
    assert.strictEqual(shareCalls.length, 1, 'one native share invocation');
    assert.strictEqual(shareCalls[0].url, WATCH_URL, 'the SERVER-derived URL, straight through');
    assert.strictEqual(shareCalls[0].title, 'From YouTube', 'the item title rides into the sheet');
  } finally { dom.window.close(); }
  const second = makeFetchStub({});
  const dom2 = await loadIndex(second.fetchImpl);
  try {
    await settle();
    await openMenuByKebab(dom2, 'yt1');
    click(dom2, menuRow(dom2.window.document, 'Share'));
    await settle();
    const toasts = Array.from(dom2.window.document.querySelectorAll('.ui-toast')).map((t) => t.textContent);
    assert.ok(toasts.some((t) => t.includes('Could not share the link.')), `expected the failure toast, saw: ${JSON.stringify(toasts)}`);
  } finally { dom2.window.close(); }
});

test('REHEAT: offered once the module health answers OK (a background probe - the grid never waits); it POSTs the per-item endpoint', async () => {
  const { fetchImpl, calls } = makeFetchStub({ healthOk: true });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    await openMenuByKebab(dom, 'yt1');
    const row = menuRow(dom.window.document, 'Reheat metadata');
    assert.ok(row, 'reheat is offered with the module enabled');
    click(dom, row);
    await settle();
    assert.strictEqual(calls.filter((c) => c.method === 'POST' && c.url === '/api/ytdlp/repull-metadata/item/yt1').length, 1);
  } finally { dom.window.close(); }
  const off = makeFetchStub({ healthOk: false });
  const dom2 = await loadIndex(off.fetchImpl);
  try {
    await settle();
    await openMenuByKebab(dom2, 'yt1');
    assert.strictEqual(menuRow(dom2.window.document, 'Reheat metadata'), null, 'no reheat without the module (C4)');
  } finally { dom2.window.close(); }
});

test('QUEUE: Add to queue goes through the one shared verb (POST /api/queue/items)', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    await openMenuByKebab(dom, 'yt1');
    click(dom, menuRow(dom.window.document, 'Add to queue'));
    await settle();
    const posts = calls.filter((c) => c.method === 'POST' && c.url === '/api/queue/items');
    assert.strictEqual(posts.length, 1);
    assert.strictEqual(JSON.parse(posts[0].body).mediaId, 'yt1');
  } finally { dom.window.close(); }
});

// ---- DELETE SAFETY (destructive: the full gate) ----------------------------------

test('DELETE: the confirm says what the route does (a move to Trash) - and a LOCAL file is told it cannot be re-downloaded', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    let dlg = await openDeleteConfirm(dom, 'yt1');
    assert.strictEqual(dlg.querySelector('.ui-sheet__title').textContent, 'Move to Trash?');
    assert.match(dlg.querySelector('.ui-confirm__body').textContent, /^"From YouTube" leaves your library now\. It stays in Trash, where you can restore it from Settings, until the Trash retention window empties it\.$/);
    const ok = dlg.querySelector('.ui-confirm__actions .ui-btn--primary');
    assert.strictEqual(ok.textContent.trim(), 'Move to Trash');
    assert.ok(ok.classList.contains('ui-btn--destructive'), 'the confirm button is the danger fill');
    click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--secondary'));
    await settle(); await frame();
    dlg = await openDeleteConfirm(dom, 'local1');
    assert.match(dlg.querySelector('.ui-confirm__body').textContent, /This local file cannot be re-downloaded\.$/);
    click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--secondary'));
    await settle();
    assert.strictEqual(deletes(calls).length, 0);
  } finally { dom.window.close(); }
});

test('DELETE: Cancel, Esc, the scrim, the Close button and Enter each leave the confirm with NO delete request', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const ways = {
      cancel: (dlg) => click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--secondary')),
      esc: () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })),
      scrim: () => { const s = Array.from(document.querySelectorAll('.ui-scrim.is-open')).pop(); click(dom, s); },
      close: (dlg) => click(dom, dlg.querySelector('.ui-sheet__close')),
    };
    for (const [name, leave] of Object.entries(ways)) {
      const dlg = await openDeleteConfirm(dom, 'yt1');
      // Enter on the open dialog is not a yes (the confirm has no Enter binding).
      dlg.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await settle();
      assert.strictEqual(deletes(calls).length, 0, `${name}: Enter sent nothing`);
      leave(dlg);
      await settle(); await sleep(400); // past the sheet exit
      assert.strictEqual(deletes(calls).length, 0, `${name}: no DELETE`);
      assert.strictEqual(confirmDialog(document), null, `${name}: the confirm closed`);
      assert.ok(document.querySelector('#video-grid .video-card[data-id="yt1"]'), `${name}: the card stays`);
    }
  } finally { dom.window.close(); }
});

test('DELETE: a tap on Move to Trash AFTER Cancel (the dialog animating out) never flips the answer; only the live confirm deletes, exactly once', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    let dlg = await openDeleteConfirm(dom, 'yt1');
    const ok = dlg.querySelector('.ui-confirm__actions .ui-btn--primary');
    click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--secondary'));
    click(dom, ok); // the late tap, while the sheet is closing
    await settle(); await sleep(400);
    assert.strictEqual(deletes(calls).length, 0, 'a late yes after Cancel sends nothing');

    dlg = await openDeleteConfirm(dom, 'yt1');
    const yes = dlg.querySelector('.ui-confirm__actions .ui-btn--primary');
    click(dom, yes);
    click(dom, yes); // a double tap
    await settle(); await sleep(50);
    assert.deepStrictEqual(deletes(calls).map((c) => c.url), ['/api/videos/yt1'], 'exactly ONE delete, of THAT item, the same route the watch page uses');
    await settle();
    assert.strictEqual(document.querySelector('#video-grid .video-card[data-id="yt1"]'), null, 'the card leaves the grid after the server answered');
    assert.ok(document.querySelector('#video-grid .video-card[data-id="local1"]'), 'the other card stays');
  } finally { dom.window.close(); }
});

// Gate r1 (adversary 3): home (and its folder filters) is CACHED on nav-away and its own
// AbortController never fires, so a confirm bound only to it stayed up over the next view and
// its OK still sent DELETE. The confirm now carries the router's shown-view signal
// (FileTube.viewSignal), which a navigation or a popstate aborts the moment it starts. The
// stub never answers the next page's fetch, so the swap never happens: only the leave-start
// abort can close the dialog here (swapToView's own abort is not what this binds).
for (const [how, leave] of [
  ['FileTube.navigate (a tap on a nav link)', (w) => { w.FileTube.navigate('/history'); }],
  ['popstate (a Back swipe)', (w) => { w.dispatchEvent(new w.PopStateEvent('popstate', { state: { view: 'history', url: '/history', scrollY: 0, depth: 0 } })); }],
]) {
  test(`DELETE: leaving the view by ${how} with the confirm open dismisses it; its OK then sends nothing`, async () => {
    const { fetchImpl, calls } = makeFetchStub({});
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      const dlg = await openDeleteConfirm(dom, 'yt1');
      const ok = dlg.querySelector('.ui-confirm__actions .ui-btn--primary');
      assert.strictEqual(typeof dom.window.FileTube.viewSignal, 'function', 'the router exposes viewSignal');
      leave(dom.window);
      await settle();
      assert.strictEqual(confirmDialog(document), null, 'the confirm is no longer open after the user left');
      click(dom, ok); // the OK a user reaches on the next view
      await settle(); await sleep(400);
      assert.strictEqual(deletes(calls).length, 0, 'no DELETE after the view was left');
      assert.strictEqual(document.querySelector('.ui-sheet'), null, 'the dialog left the DOM');
    } finally { dom.window.close(); }
  });
}

// Gate r2 (adversary + qa): the card MENU is bound to the shown-view signal too. Before, the
// confirm closed on leave but the menu that opens it stayed up over the next view, kept the
// scroll lock, and its Move to Trash then OK still sent DELETE.
for (const [how, leave] of [
  ['FileTube.navigate (a tap on a nav link)', (w) => { w.FileTube.navigate('/history'); }],
  ['popstate (a Back swipe)', (w) => { w.dispatchEvent(new w.PopStateEvent('popstate', { state: { view: 'history', url: '/history', scrollY: 0, depth: 0 } })); }],
]) {
  test(`MENU: leaving the view by ${how} with the card menu open closes it; its Move to Trash then opens nothing and sends nothing`, async () => {
    const { fetchImpl, calls } = makeFetchStub({});
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      await openMenuByKebab(dom, 'yt1');
      const row = menuRow(document, 'Move to Trash');
      assert.ok(row, 'precondition: the menu is open and offers Move to Trash');
      leave(dom.window);
      await settle();
      assert.strictEqual(openSheets(document).length, 0, 'the menu is no longer open after the user left');
      click(dom, row); // the row a user reaches on the next view
      await settle(); await frame();
      assert.strictEqual(confirmDialog(document), null, 'no confirm opens from a menu of a view already left');
      await sleep(400);
      assert.strictEqual(deletes(calls).length, 0, 'no DELETE after the view was left');
      assert.strictEqual(document.querySelector('.ui-sheet'), null, 'the menu left the DOM (its scroll lock released)');
    } finally { dom.window.close(); }
  });
}

test('SORT MENU: leaving the view with the home Sort menu open closes it (no sheet, no scroll lock over the next view)', async () => {
  const { fetchImpl } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const btn = document.getElementById('sort-select-btn');
    assert.ok(btn, 'precondition: the home has its Sort button');
    click(dom, btn);
    await settle(); await frame();
    assert.ok(menuRow(document, 'Newest first'), 'precondition: the Sort menu is open');
    dom.window.FileTube.navigate('/history');
    await settle();
    assert.strictEqual(openSheets(document).length, 0, 'the Sort menu closed when the user left');
    await sleep(400);
    assert.strictEqual(document.querySelector('.ui-sheet'), null, 'it left the DOM (its scroll lock released)');
  } finally { dom.window.close(); }
});

test('source lock (gate r2): every menu the home view opens is bound to the shown-view signal', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');
  const calls = src.split(/\.menu\(\{/).slice(1);
  assert.ok(calls.length >= 3, 'the card menu and both Sort menus are found');
  for (const body of calls) {
    const head = body.slice(0, body.indexOf('items:'));
    assert.match(head, /signal: shownViewSignal\(\)/, 'a home menu without the shown-view signal stays up over the next view');
  }
});

// The same, for a confirm opened on the old view WHILE the next one is fetching (the leave
// already happened, so only the swap's own abort can close this one).
test('DELETE: a confirm opened while a navigation is in flight closes at the swap; its OK then sends nothing', async () => {
  const { fetchImpl: base, calls } = makeFetchStub({});
  let answerPage;
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    if (url === 'http://localhost/history') return new Promise((r) => { answerPage = r; });
    return base(input, init);
  };
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    dom.window.FileTube.navigate('/history');
    await settle();
    assert.strictEqual(typeof answerPage, 'function', 'the next view is fetching');
    const dlg = await openDeleteConfirm(dom, 'yt1'); // the old view is still on screen
    const ok = dlg.querySelector('.ui-confirm__actions .ui-btn--primary');
    const html = '<!DOCTYPE html><html><head><title>History</title></head><body><div id="view-root"><div id="history-list"></div></div></body></html>';
    answerPage({ ok: true, status: 200, text: async () => html });
    await settle(); await frame();
    assert.ok(document.getElementById('history-list'), 'precondition: the swap happened');
    assert.strictEqual(confirmDialog(document), null, 'the confirm closed at the swap');
    click(dom, ok);
    await settle(); await sleep(400);
    assert.strictEqual(deletes(calls).length, 0, 'no DELETE after the view was swapped out');
  } finally { dom.window.close(); }
});

test('DELETE by KEYBOARD: a detail-0 activation of the kebab and of Move to Trash still needs the confirm; Esc cancels', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const kebab = kebabOf(document, 'yt1');
    kebab.focus();
    kebab.click(); // keyboard / programmatic activation (detail 0)
    await settle(); await frame();
    menuRow(document, 'Move to Trash').click();
    await settle(); await frame();
    assert.ok(confirmDialog(document), 'the confirm opened');
    assert.strictEqual(deletes(calls).length, 0, 'no delete before the answer');
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle(); await sleep(400);
    assert.strictEqual(deletes(calls).length, 0, 'Esc cancels');
  } finally { dom.window.close(); }
});

// Pointer events in jsdom: a plain Event carrying the pointer fields (LESSONS 2).
function pointer(dom, type, target, fields) {
  const e = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerId: 7, isPrimary: true, pointerType: 'touch', button: 0, clientX: 30, clientY: 40 }, fields || {});
  target.dispatchEvent(e);
}

test('DELETE by LONG-PRESS: holding a card opens the SAME menu; its Move to Trash still needs the confirm', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const title = document.querySelector('#video-grid .video-card[data-id="yt1"] .video-title');
    pointer(dom, 'pointerdown', title);
    await sleep(520); // past FTInteraction's 450ms hold
    await frame();
    assert.ok(menuRow(document, 'Move to Trash'), 'the long-press opened the card menu');
    pointer(dom, 'pointerup', document);
    click(dom, title); // the release's own click is swallowed - it must not select a menu row or navigate
    await settle();
    assert.ok(menuRow(document, 'Move to Trash'), 'the menu is still open after the release');
    await sleep(450); // past the one-click swallow window
    click(dom, menuRow(document, 'Move to Trash'));
    await settle(); await frame();
    const dlg = confirmDialog(document);
    assert.ok(dlg, 'the confirm opened');
    assert.strictEqual(deletes(calls).length, 0, 'no delete from the long-press path without an answer');
    click(dom, dlg.querySelector('.ui-confirm__actions .ui-btn--secondary'));
    await settle(); await sleep(400);
    assert.strictEqual(deletes(calls).length, 0, 'Cancel sends nothing');
  } finally { dom.window.close(); }
});

test('DELETE by RIGHT-CLICK (desktop): the contextmenu opens the SAME menu (native menu suppressed); Move to Trash still needs the confirm', async () => {
  const { fetchImpl, calls } = makeFetchStub({});
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const thumb = document.querySelector('#video-grid .video-card[data-id="yt1"] .ui-thumb');
    const cm = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 50, clientY: 60 });
    thumb.dispatchEvent(cm);
    await settle(); await frame();
    assert.strictEqual(cm.defaultPrevented, true, 'the browser menu is replaced by ours');
    click(dom, menuRow(document, 'Move to Trash'));
    await settle(); await frame();
    const dlg = confirmDialog(document);
    assert.ok(dlg, 'the confirm opened');
    click(dom, Array.from(document.querySelectorAll('.ui-scrim.is-open')).pop());
    await settle(); await sleep(400);
    assert.strictEqual(deletes(calls).length, 0, 'the scrim cancels - no delete');
  } finally { dom.window.close(); }
});

test('source guard: the ONLY caller of the delete request is confirmAndDeleteCard, after `ok !== true` returns', () => {
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'main.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  assert.strictEqual((src.match(/method: 'DELETE' \}\)/g) || []).length >= 1, true);
  const callers = src.match(/deleteCardById\(/g) || [];
  assert.strictEqual(callers.length, 2, 'the definition + ONE call');
  const fn = src.slice(src.indexOf('async function confirmAndDeleteCard(item) {'), src.indexOf('function runCardAction('));
  // Gate r1 (adversary 3): the confirm carries the router's shown-view signal (this view is
  // cached on nav-away), and both signals are re-checked after the answer.
  assert.match(fn, /const ok = await u\.confirm\(Object\.assign\(\{\}, cardDeleteConfirmCopy\(item\), \{ signal: shown \}\)\);\s*if \(ok !== true\) return;\s*if \(shown\.aborted \|\| signal\.aborted\) return;\s*deleteCardById\(item\.id\);/);
  assert.match(src, /\} else if \(action === 'delete'\) \{\s*confirmAndDeleteCard\(item\);/, 'the menu entry routes through the confirm');
});

// Reachability (LESSONS 2, inert feature): the v1.94 desktop hover preview finds
// its overlay through the card's media link. Sweep S2 renamed that link
// (`.thumbnail-container` -> `.card-media`); a hover on the thumbnail must still
// start the clip (the /preview/:id <video> appears after the 1.5s intent delay).
test('the desktop hover preview still reaches its clip through the card media link', async () => {
  const items = makeItems().map((it) => Object.assign({}, it, { hasPreview: true }));
  const { fetchImpl } = makeFetchStub({ items });
  const dom = await loadIndex(fetchImpl, (window) => {
    window.matchMedia = (query) => ({ matches: query === '(hover: hover) and (pointer: fine)', media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  });
  try {
    await settle();
    const { document } = dom.window;
    const img = document.querySelector('#video-grid .video-card[data-id="yt1"] .ui-thumb__img');
    img.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    await sleep(1650);
    const video = document.querySelector('#video-grid .video-card[data-id="yt1"] .card-preview video.card-preview-video');
    assert.ok(video, 'the hover started the preview clip');
    assert.strictEqual(video.getAttribute('src'), '/preview/yt1');
  } finally { dom.window.close(); }
});
