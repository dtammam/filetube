'use strict';

// [UNIT] UI professionalism pass, sweep S10 (Books and the reader; finding F69, plan D9).
// The two views run for real in jsdom (books.js and read.js init() against their shells'
// #view-root markup, window.ui = the real public/js/ui.js), with fetch stubbed:
//   Books   - a failed load is an ERROR state with Retry (never "No books yet", D9), an
//             empty library / an empty shelf say different things; shelf chips are ui-chip
//             filters that navigate; the selected shelf's Pin toggle posts; the sort menu
//             (ui.menu) re-fetches and remembers; destroy() closes an open menu.
//   Reader  - the toolbar's slots are RESERVED (Like / More disabled, never hidden, until
//             the detail resolves); Like is a pressed icon toggle, never a red fill; More is
//             a ui.menu (finished / save / share); Contents is a panel sheet built from the
//             adapter's TOC; Aa is a sheet with the theme segmented control and the text-size
//             stepper; the arrow keys stand down while a sheet is open; destroy() closes the
//             sheets; a book that cannot open shows the error ui-state.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ui = require('../../public/js/ui.js');
const PUB = path.join(__dirname, '..', '..', 'public');
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
// ui.sheet adds .is-open on the NEXT frame (jsdom pretendToBeVisual: ~16ms), so a test
// about closing must first SEE it open (a clear asserted on a never-opened sheet is vacuous).
const frame = () => new Promise((r) => setTimeout(r, 40));

// The shell's #view-root, verbatim, so the test drives the markup that ships.
function viewRootOf(page) {
  const html = fs.readFileSync(path.join(PUB, page), 'utf8');
  const start = html.indexOf('<div id="view-root"');
  const end = html.indexOf('</main>');
  return html.slice(start, end);
}

const saved = {};
let active = null; // { view, dom }
function setGlobals(dom) {
  for (const k of ['window', 'document', 'localStorage', 'fetch', 'AbortController', 'getComputedStyle', 'requestAnimationFrame']) saved[k] = global[k];
  global.window = dom.window;
  global.AbortController = dom.window.AbortController; // the views' listeners take jsdom's signal
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window); // read.js reads the --reader-* tokens
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
}
afterEach(() => {
  if (active && active.view) { try { active.view.destroy(); } catch (_) { /* torn down */ } }
  if (active && active.dom) active.dom.window.close();
  active = null;
  for (const k of Object.keys(saved)) global[k] = saved[k];
});

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// ------------------------------------------------------------------ Books
function mountBooks({ url = 'http://localhost/books', routes }) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${viewRootOf('books.html')}</body>`, { url, pretendToBeVisual: true });
  setGlobals(dom);
  const calls = [];
  const navigations = [];
  dom.window.ui = ui;
  global.fetch = async (u, opts) => {
    calls.push({ url: String(u), method: (opts && opts.method) || 'GET', body: opts && opts.body });
    for (const [prefix, fn] of routes) if (String(u).startsWith(prefix)) return fn(String(u), opts);
    return json({ items: [] });
  };
  let view = null;
  dom.window.FileTube = { registerView: (n, v) => { if (n === 'books') view = v; }, navigate: (u) => { navigations.push(u); } };
  const BOOKS = require.resolve('../../public/js/books.js');
  delete require.cache[BOOKS];
  require(BOOKS);
  view.init(dom.window.document.getElementById('view-root'));
  active = { view, dom };
  return { dom, doc: dom.window.document, calls, navigations, view };
}
const ITEMS = [{ id: 'a', title: 'Alpha', author: 'A. Author', progress: { percent: 40 } }, { id: 'b', title: 'Beta', author: '' }];
const FOLDERS = [{ name: 'Night', dir: '/b/night', count: 1, pinned: false, pinId: null }, { name: 'Harbor', dir: '/b/harbor', count: 3, pinned: true, pinId: 'p1' }];

test('books D9: a FAILED load shows the error state with Retry - never "No books yet" - and Retry recovers', async () => {
  let fail = true;
  const { doc, calls } = mountBooks({ routes: [
    ['/api/books/folders', () => json({ folders: [] })],
    ['/api/books?sort', () => (fail ? json({ error: 'boom' }, 500) : json({ items: ITEMS }))],
  ] });
  await flush();
  const host = doc.getElementById('books-state');
  assert.strictEqual(host.hidden, false, 'the state block is shown');
  const block = host.querySelector('.ui-state');
  assert.strictEqual(block.getAttribute('data-state'), 'error');
  assert.match(block.textContent, /Couldn.t load your books/);
  assert.doesNotMatch(host.textContent, /No books yet/, 'a fetch error is not an empty library');
  assert.strictEqual(doc.querySelectorAll('#books-grid .book-card').length, 0, 'the skeleton is cleared, not stranded');
  const retry = block.querySelector('button.ui-btn');
  assert.strictEqual(retry.textContent, 'Retry');
  const before = calls.filter((c) => c.url.startsWith('/api/books?sort')).length;
  fail = false;
  retry.click();
  await flush();
  assert.strictEqual(calls.filter((c) => c.url.startsWith('/api/books?sort')).length, before + 1, 'Retry re-fetches');
  assert.strictEqual(host.hidden, true, 'the state clears on success');
  assert.strictEqual(doc.querySelectorAll('#books-grid .book-card').length, 2, 'and the cards render');
});

test('books D9: an EMPTY library says how to add books (Open Settings navigates); an empty shelf says so without the setup advice', async () => {
  const a = mountBooks({ routes: [['/api/books/folders', () => json({ folders: [] })]] });
  await flush();
  const block = a.doc.querySelector('#books-state .ui-state');
  assert.strictEqual(block.getAttribute('data-state'), 'empty');
  assert.match(block.textContent, /No books yet/);
  block.querySelector('button.ui-btn').click();
  assert.deepStrictEqual(a.navigations, ['/setup.html']);
  a.view.destroy(); a.dom.window.close(); active = null;

  const b = mountBooks({ url: 'http://localhost/books?root=%2Fb%2Fnight', routes: [['/api/books/folders', () => json({ folders: FOLDERS })]] });
  await flush();
  const shelf = b.doc.querySelector('#books-state .ui-state');
  assert.strictEqual(shelf.getAttribute('data-state'), 'empty-filtered');
  assert.match(shelf.textContent, /No books on this shelf/);
  assert.doesNotMatch(shelf.textContent, /No books yet|Settings/, 'no setup advice on a filtered view');
  assert.strictEqual(shelf.querySelector('button'), null, 'and no action');
});

test('books: shelf chips are ui-chip filters (All selected by default) that navigate; no Pin on the All view', async () => {
  const { doc, navigations } = mountBooks({ routes: [
    ['/api/books/folders', () => json({ folders: FOLDERS })],
    ['/api/books?sort', () => json({ items: ITEMS })],
  ] });
  await flush();
  const chips = [...doc.querySelectorAll('#books-shelf-chips .ui-chip--filter')];
  assert.deepStrictEqual(chips.map((c) => c.textContent), ['All', 'Harbor (3)', 'Night (1)'], 'All first, shelves by name');
  assert.deepStrictEqual(chips.map((c) => c.getAttribute('aria-pressed')), ['true', 'false', 'false']);
  assert.ok(chips.every((c) => c.tagName === 'BUTTON'), 'real buttons (a chip is not a link)');
  chips[2].click();
  assert.deepStrictEqual(navigations, ['/books?root=%2Fb%2Fnight'], 'the shelf URL, encoded, through the SPA router');
  chips[0].click();
  assert.strictEqual(navigations.length, 1, 'the selected chip is a no-op');
  assert.strictEqual(doc.querySelector('#books-shelf-pin-host').children.length, 0, 'the All view has no Pin');
  assert.strictEqual(doc.querySelector('.books-shelf-pin-btn, [class*="shelf-pin-btn"]'), null, 'the star pin buttons are gone');
});

test('books: the SELECTED shelf gets the Pin toggle (keep / keep.fill, "Pin shelf" / "Pinned"); a tap posts the pin, busy until the re-render', async () => {
  let posted = null;
  const { doc } = mountBooks({ url: 'http://localhost/books?root=%2Fb%2Fnight', routes: [
    ['/api/books/folders', () => json({ folders: FOLDERS })],
    ['/api/books/pins', (u, o) => { posted = JSON.parse(o.body); return json({ ok: true }); }],
    ['/api/books?sort', () => json({ items: ITEMS })],
  ] });
  await flush();
  const selected = [...doc.querySelectorAll('#books-shelf-chips .ui-chip--filter')].find((c) => c.getAttribute('aria-pressed') === 'true');
  assert.strictEqual(selected.textContent, 'Night (1)');
  const pin = doc.getElementById('books-shelf-pin-btn');
  assert.ok(pin && pin.classList.contains('ui-btn') && pin.classList.contains('ui-btn--plain'), 'a plain ui-btn toggle');
  assert.strictEqual(pin.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(pin.querySelector('.ui-btn__stack').getAttribute('data-label'), 'Pin shelf');
  assert.strictEqual(pin.querySelector('use').getAttribute('href'), '#i-keep');
  pin.click();
  assert.strictEqual(pin.getAttribute('aria-busy'), 'true', 'busy while the request runs');
  await flush();
  assert.deepStrictEqual(posted, { dir: '/b/night', label: 'Night' });
});

test('books: the pinned shelf paints Pinned + keep.fill, and a tap DELETEs its pin by id', async () => {
  const { doc, calls } = mountBooks({ url: 'http://localhost/books?root=%2Fb%2Fharbor', routes: [
    ['/api/books/folders', () => json({ folders: FOLDERS })],
    ['/api/books/pins/', () => json({ ok: true })],
    ['/api/books?sort', () => json({ items: ITEMS })],
  ] });
  await flush();
  const pin = doc.getElementById('books-shelf-pin-btn');
  assert.strictEqual(pin.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(pin.querySelector('.ui-btn__stack').getAttribute('data-label'), 'Pinned');
  assert.strictEqual(pin.querySelector('use').getAttribute('href'), '#i-keep-fill');
  pin.click();
  await flush();
  assert.ok(calls.some((c) => c.url === '/api/books/pins/p1' && c.method === 'DELETE'), 'the pin id, DELETE');
});

test('books: the sort button opens a ui.menu (checked = current); a pick re-fetches, repaints the label and is remembered; destroy() closes an open menu', async () => {
  const { doc, calls, view } = mountBooks({ routes: [
    ['/api/books/folders', () => json({ folders: [] })],
    ['/api/books?sort', () => json({ items: ITEMS })],
  ] });
  await flush();
  const btn = doc.getElementById('books-sort-btn');
  assert.strictEqual(doc.getElementById('books-sort-label').textContent, 'Recently added');
  btn.click();
  const sheet = doc.querySelector('.ui-sheet');
  assert.ok(sheet, 'a menu sheet opens');
  const rows = [...sheet.querySelectorAll('.ui-row')];
  assert.deepStrictEqual(rows.map((r) => r.querySelector('.ui-row__title').textContent),
    ['Recently added', 'Title A-Z', 'Title Z-A', 'Author', 'Recently read']);
  assert.strictEqual(rows[0].getAttribute('aria-current'), 'true', 'the current sort carries the check');
  rows[1].click();
  await flush();
  assert.strictEqual(doc.defaultView.localStorage.getItem('filetube_books_sort'), 'title-asc', 'remembered');
  assert.strictEqual(doc.getElementById('books-sort-label').textContent, 'Title A-Z');
  assert.strictEqual(btn.getAttribute('aria-label'), 'Sort books: Title A-Z');
  assert.ok(calls.some((c) => c.url.startsWith('/api/books?sort=title-asc')), 're-fetched with the new order');
  await new Promise((res) => setTimeout(res, 400)); // the first menu's exit
  btn.click();
  await frame();
  assert.strictEqual(doc.querySelectorAll('.ui-sheet.is-open').length, 1, 'precondition: the menu is OPEN');
  view.destroy();
  assert.strictEqual(doc.querySelectorAll('.ui-sheet.is-open').length, 0, 'an in-app nav away never strands the menu');
  active.view = null;
});

test('books: Scan is busy (spinner, no double request) until the refresh', async () => {
  const { doc, calls } = mountBooks({ routes: [['/api/books/folders', () => json({ folders: [] })]] });
  await flush();
  const scan = doc.getElementById('books-scan-btn');
  scan.click();
  scan.click();
  assert.strictEqual(scan.getAttribute('aria-busy'), 'true');
  assert.strictEqual(calls.filter((c) => c.url === '/api/books/scan').length, 1, 'one scan per press');
});

// ------------------------------------------------------------------ Reader
const READER_TOKENS = ['--reader-paper-fg', '--reader-paper-bg', '--reader-sepia-fg', '--reader-sepia-bg', '--reader-night-fg', '--reader-night-bg'];

function mountReader({ detail, detailStatus = 200, toc = [], likeOk = true, broken = false }) {
  const dom = new JSDOM(`<!DOCTYPE html><head></head><body>${viewRootOf('read.html')}</body>`,
    { url: 'http://localhost/read.html?b=b1', pretendToBeVisual: true });
  setGlobals(dom);
  const win = dom.window;
  const doc = win.document;
  win.ui = ui;
  for (const t of READER_TOKENS) doc.documentElement.style.setProperty(t, '#123456');
  // loadScriptOnce resolves for a script already on the page; ePub is the fake below.
  for (const src of ['/vendor/jszip/jszip.min.js', '/vendor/epubjs/epub.min.js', '/js/page-turn.js']) {
    const s = doc.createElement('script'); s.setAttribute('src', src); doc.head.appendChild(s);
  }
  // v1.402.0: the real page turn holds the book as a POOL of renditions (page-turn.js, loaded for real);
  // Reduce Motion is emulated so a turn lands in one step (P5) and the place can be read at once.
  win.FileTubePageTurn = require('../../public/js/page-turn.js');
  win.matchMedia = (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q), addEventListener: () => {}, removeEventListener: () => {} });
  const pane = doc.getElementById('reader-pane');
  Object.defineProperty(pane, 'clientWidth', { value: 600 });
  Object.defineProperty(pane, 'clientHeight', { value: 800 });
  const flips = { next: 0, prev: 0, displayed: [], fontSize: [], overrides: [], renditions: 0, pool: [], serializeHooks: [], contentHooks: [], renderOpts: [], order: [] };
  const makeRendition = (el, opts) => {
    flips.renderOpts.push(opts);
    flips.order.push('renderTo');
    flips.renditions++;
    const n = flips.renditions;
    const handlers = {};
    const r = {
      el,
      cfi: `epubcfi(/6/${2 * n}!/4/2)`,
      fire: (ev, arg) => (handlers[ev] || []).forEach((fn) => fn(arg)),
      themes: { override: (k, v) => flips.overrides.push([k, v]), fontSize: (v) => flips.fontSize.push(v) },
      hooks: { content: { register: () => {} } },
      on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
      display: async (x) => { flips.displayed.push(x); if (typeof x === 'string' && x.startsWith('refuse')) throw new Error('No Section Found'); },
      next: async () => { flips.next++; },
      prev: async () => { flips.prev++; },
      currentLocation: () => ({ start: { cfi: r.cfi, index: 0, displayed: { page: 1, total: 9 } } }),
      resize: () => {},
      getContents: () => [],
      destroy: () => {},
    };
    flips.pool.push(r);
    return r;
  };
  // epub.js's own serialize hook (an archived book's blob: URL swap) is registered WHILE THE BOOK OPENS and
  // rewrites section.output from the ORIGINAL markup it is handed (vendored source) - modelled exactly, so a
  // guard registered before it is undone here as it is in the browser.
  const epubOwnHook = (t, e) => { e.output = t.replace(/OEBPS\//g, 'blob:x/'); };
  win.ePub = () => ({
    on: (ev, fn) => { if (ev === 'openFailed') { flips.openFailed = fn; if (broken) setTimeout(fn, 0); } },
    renderTo: (el, opts) => makeRendition(el, opts),
    spine: {
      spineItems: [{ href: 'c1.xhtml' }, { href: 'c2.xhtml' }],
      hooks: {
        content: { register: (fn) => { flips.contentHooks.push(fn); } },
        serialize: { register: (fn) => { flips.serializeHooks.push(fn); flips.order.push('serialize'); } },
      },
    },
    ready: broken ? new Promise(() => {}) : Promise.resolve().then(() => { flips.serializeHooks.push(epubOwnHook); flips.order.push('epub-hook'); }),
    locations: { length: () => 0, generate: async () => {}, save: () => '', load: () => {} },
    loaded: { navigation: Promise.resolve({ toc }) },
    destroy: () => {},
  });
  const calls = [];
  const shares = [];
  win.shareMediaFile = (o) => { shares.push(o); return Promise.resolve('shared'); };
  let releaseDetail;
  const detailGate = new Promise((r) => { releaseDetail = r; });
  global.fetch = async (u, opts) => {
    const url = String(u);
    calls.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body });
    if (url === '/api/books/tts/config') return json({ available: false });
    if (url === '/api/books/b1') { await detailGate; return json(detail, detailStatus); }
    if (url.startsWith('/api/books/liked/')) return json({ ok: likeOk }, likeOk ? 200 : 500);
    if (url.startsWith('/api/books/b1/finished')) return json({ ok: true });
    return json({});
  };
  let view = null;
  win.FileTube = { registerView: (n, v) => { if (n === 'read') view = v; }, navigate: () => {} };
  const READ = require.resolve('../../public/js/read.js');
  delete require.cache[READ];
  require(READ);
  view.init(doc.getElementById('view-root'));
  active = { view, dom };
  return { dom, win, doc, calls, shares, flips, view, releaseDetail };
}
const EPUB = { id: 'b1', title: 'The Lamplighter', format: 'epub', size: 10, liked: false, finished: false, spine: [{}, {}] };
const key = (win, k) => win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));

test('reader F69: the toolbar slots are RESERVED - Like and More are present and disabled (never hidden) until the detail resolves, then enabled', async () => {
  const r = mountReader({ detail: { ...EPUB, progress: { percent: 38 } } });
  const like = r.doc.getElementById('reader-like-btn');
  const more = r.doc.getElementById('reader-more-btn');
  for (const b of [like, more, r.doc.getElementById('reader-toc-btn'), r.doc.getElementById('reader-settings-btn')]) {
    assert.strictEqual(b.hidden, false, `${b.id} holds its slot`);
    assert.ok(b.classList.contains('ui-btn--icon'), `${b.id} is a ui-btn icon button (44px hit area)`);
  }
  assert.strictEqual(like.disabled, true, 'Like waits for the detail');
  assert.strictEqual(more.disabled, true, 'More waits for the detail');
  r.releaseDetail();
  await flush(10);
  assert.strictEqual(like.disabled, false);
  assert.strictEqual(more.disabled, false);
  assert.strictEqual(r.doc.getElementById('reader-title').textContent, 'The Lamplighter');
  // The saved position paints the bottom bar as DATA (--p), never an inline width.
  const fill = r.doc.getElementById('reader-progress-fill');
  assert.strictEqual(fill.style.getPropertyValue('--p'), '0.38');
  assert.strictEqual(fill.style.width, '', 'no inline width');
  assert.strictEqual(r.doc.getElementById('reader-percent').textContent, '38%');
});

test('reader F69: Like is a pressed ICON toggle (favorite -> favorite.fill), never the red btn-primary fill; non-optimistic on failure', async () => {
  const r = mountReader({ detail: EPUB });
  r.releaseDetail();
  await flush(10);
  const like = r.doc.getElementById('reader-like-btn');
  like.click();
  assert.strictEqual(like.getAttribute('aria-busy'), 'true', 'busy during the request');
  await flush();
  assert.ok(r.calls.some((c) => c.url === '/api/books/liked/b1' && c.method === 'POST'));
  assert.strictEqual(like.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(like.querySelector('use').getAttribute('href'), '#i-favorite-fill');
  assert.ok(!like.classList.contains('btn-primary'), 'no red fill (D8.8)');
  assert.strictEqual(like.hasAttribute('aria-busy'), false);

  const bad = mountReader({ detail: EPUB, likeOk: false });
  bad.releaseDetail();
  await flush(10);
  const l2 = bad.doc.getElementById('reader-like-btn');
  l2.click();
  await flush();
  assert.strictEqual(l2.getAttribute('aria-pressed'), 'false', 'a failed request never flips the toggle');
});

test('reader: More is a ui.menu - Mark as finished posts the toggle, Save to device and Share act on the book file', async () => {
  const r = mountReader({ detail: EPUB });
  r.releaseDetail();
  await flush(10);
  const more = r.doc.getElementById('reader-more-btn');
  more.click();
  let rows = [...r.doc.querySelectorAll('.ui-sheet.is-open .ui-row, .ui-sheet .ui-row')];
  assert.deepStrictEqual(rows.map((x) => x.querySelector('.ui-row__title').textContent), ['Mark as finished', 'Save to device', 'Share']);
  rows[2].click();
  assert.strictEqual(r.shares.length, 1);
  assert.strictEqual(r.shares[0].url, '/book/b1/file?download=1');
  assert.strictEqual(r.shares[0].title, 'The Lamplighter');
  await new Promise((res) => setTimeout(res, 400)); // the menu's exit
  more.click();
  rows = [...r.doc.querySelectorAll('.ui-sheet .ui-row')];
  rows[0].click();
  await flush();
  const fin = r.calls.find((c) => c.url === '/api/books/b1/finished');
  assert.ok(fin && fin.method === 'POST', 'the finished toggle posts');
  assert.deepStrictEqual(JSON.parse(fin.body), { finished: true });
  assert.match(r.doc.querySelector('.ui-toast').textContent, /Marked as finished/, 'the result is said, not silent');
  await new Promise((res) => setTimeout(res, 400));
  more.click();
  rows = [...r.doc.querySelectorAll('.ui-sheet .ui-row')];
  assert.strictEqual(rows[0].querySelector('.ui-row__title').textContent, 'Mark as unfinished', 'the label says what a tap will do');
});

test('reader: Contents is a PANEL sheet of the book TOC (sub-entries indented); a pick displays it and closes the sheet', async () => {
  const toc = [{ label: 'The Quay', href: 'c1.xhtml', subitems: [{ label: 'At Dusk', href: 'c1.xhtml#d' }] }, { label: 'Ledger Lines', href: 'c2.xhtml' }];
  const r = mountReader({ detail: EPUB, toc });
  r.releaseDetail();
  await flush(20);
  r.doc.getElementById('reader-toc-btn').click();
  const sheet = r.doc.querySelector('.ui-sheet');
  assert.ok(sheet.classList.contains('ui-sheet--panel'), 'the panel variant');
  assert.strictEqual(sheet.querySelector('.ui-sheet__title').textContent, 'Contents');
  const rows = [...sheet.querySelectorAll('.ui-row')];
  assert.deepStrictEqual(rows.map((x) => x.querySelector('.ui-row__title').textContent), ['The Quay', 'At Dusk', 'Ledger Lines']);
  assert.deepStrictEqual(rows.map((x) => x.classList.contains('reader-toc-sub')), [false, true, false]);
  rows[2].click();
  await flush(10);
  assert.deepStrictEqual(r.flips.displayed.slice(-1), ['c2.xhtml'], 'the pick re-parks the page viewers on it');
  assert.strictEqual(sheet.classList.contains('is-open'), false, 'the pick closes the sheet');
});

test('reader: a book without a TOC opens Contents on the empty ui-state, not a bare line', async () => {
  const r = mountReader({ detail: EPUB, toc: [] });
  r.releaseDetail();
  await flush(20);
  r.doc.getElementById('reader-toc-btn').click();
  const st = r.doc.querySelector('.ui-sheet .ui-state');
  assert.ok(st, 'the empty state');
  assert.match(st.textContent, /No contents/);
});

test('reader: Aa opens a sheet with the theme segmented control (writes the pref, themes pane + page) and the text-size stepper (bounded)', async () => {
  const r = mountReader({ detail: EPUB });
  r.releaseDetail();
  await flush(20);
  r.win.localStorage.setItem('filetube_reader_fontsize', '160');
  r.doc.getElementById('reader-settings-btn').click();
  const sheet = r.doc.querySelector('.ui-sheet');
  const seg = sheet.querySelector('.ui-segmented');
  assert.ok(seg, 'the theme picker is ui.segmented');
  const items = [...seg.querySelectorAll('.ui-segmented__item')];
  assert.deepStrictEqual(items.map((i) => i.textContent), ['Paper', 'Sepia', 'Night']);
  assert.strictEqual(items[0].getAttribute('aria-checked'), 'true', 'the active theme is shown (F69: it was not)');
  items[2].click();
  assert.strictEqual(r.win.localStorage.getItem('filetube_reader_theme'), 'night');
  assert.ok(r.doc.getElementById('reader-content').classList.contains('theme-night'), 'the pane follows');
  assert.deepStrictEqual(r.flips.overrides.slice(-2), [['color', '#123456'], ['background', '#123456']], 'the page follows (override, never select)');
  const larger = sheet.querySelector('#reader-font-larger');
  const value = sheet.querySelector('.reader-stepper__value');
  assert.strictEqual(value.textContent, '160%');
  larger.click();
  assert.strictEqual(value.textContent, '170%');
  assert.strictEqual(larger.disabled, true, 'the top of the range disables Larger');
  assert.strictEqual(r.flips.fontSize.slice(-1)[0], '170%');
});

test('reader: the arrow keys stand down while a reader sheet is open (the segmented control owns them), and flip pages again once it closes', async () => {
  const r = mountReader({ detail: EPUB });
  r.releaseDetail();
  await flush(20);
  // v1.402.0: an arrow is a page TURN (the page-turn engine; Reduce Motion emulated, so it lands in one step).
  const placeOf = () => r.doc.getElementById('reader-pane').dataset.ptPlace;
  const settled = async () => { for (let i = 0; i < 20; i++) { await frame(); } };
  await settled();
  assert.strictEqual(placeOf(), '1:0', 'precondition: the book opened on its first page');
  key(r.win, 'ArrowRight');
  await settled();
  assert.strictEqual(placeOf(), '1:1', 'a closed reader flips');
  r.doc.getElementById('reader-settings-btn').click();
  key(r.win, 'ArrowRight');
  key(r.win, 'ArrowLeft');
  await settled();
  assert.strictEqual(placeOf(), '1:1', 'no flip under the sheet');
  key(r.win, 'Escape');
  key(r.win, 'ArrowLeft');
  await settled();
  assert.strictEqual(placeOf(), '1:0', 'flips again after Esc closes it');
});

test('reader P8: a parked pool view moving (epub.js relocated) never saves the place; the visible page does', async () => {
  const r = mountReader({ detail: EPUB });
  r.releaseDetail();
  await flush(20);
  for (let i = 0; i < 20; i++) await frame();
  assert.strictEqual(r.flips.pool.length, 6, 'precondition: the one-page pool (6 renditions)');
  // The visible page: the front of the top rig (the one-page forward rig at rest).
  const visibleEl = r.doc.querySelector('.pt-rig.is-top > .pt-mask > .pt-inner > .reader-epub-page');
  const visible = r.flips.pool.find((x) => x.el === visibleEl);
  assert.ok(visible, 'precondition: the visible rendition is found');
  for (const hidden of r.flips.pool.filter((x) => x !== visible)) {
    hidden.fire('relocated', { start: { cfi: `hidden-${hidden.cfi}`, index: 3, displayed: { page: 2, total: 9 } } });
  }
  const posts = () => r.calls.filter((c) => c.url === '/api/books/b1/progress' && c.method === 'POST').map((c) => JSON.parse(c.body).locator);
  r.view.destroy(); // sends the last place now (keepalive)
  active.view = null;
  const sent = posts();
  assert.strictEqual(sent.length, 1, 'the place is sent on leave');
  assert.strictEqual(sent[0].cfi, visible.cfi, 'it is the VISIBLE page, never a parked neighbour');
  assert.strictEqual(sent[0].spineIndex, 0);
});

test('reader P8: the visible view relocating (a re-layout) does save its place', async () => {
  const r = mountReader({ detail: EPUB });
  r.releaseDetail();
  await flush(20);
  for (let i = 0; i < 20; i++) await frame();
  const visibleEl = r.doc.querySelector('.pt-rig.is-top > .pt-mask > .pt-inner > .reader-epub-page');
  const visible = r.flips.pool.find((x) => x.el === visibleEl);
  visible.fire('relocated', { start: { cfi: 'epubcfi(/6/8!/4/2/1:0)', index: 3, displayed: { page: 1, total: 9 } } });
  r.view.destroy();
  active.view = null;
  const sent = r.calls.filter((c) => c.url === '/api/books/b1/progress' && c.method === 'POST').map((c) => JSON.parse(c.body).locator);
  assert.deepStrictEqual(sent.map((l) => [l.cfi, l.spineIndex]), [['epubcfi(/6/8!/4/2/1:0)', 3]]);
});

test('reader P9 wiring: the chapter guard is registered on the book before any page view exists, it rewrites what renders, and the views run scripts ON only under it', async () => {
  const r = mountReader({ detail: EPUB });
  r.releaseDetail();
  await flush(20);
  for (let i = 0; i < 10; i++) await frame();
  assert.strictEqual(r.flips.serializeHooks.length, 2, "epub.js's hook and the reader's guard");
  assert.ok(r.flips.order.indexOf('serialize') < r.flips.order.indexOf('renderTo'), 'the guard is registered before the first renderTo');
  // epub.js triggers every serialize hook in registration order with (the original output, the section)
  const render = (raw, section) => { section.output = raw; for (const h of r.flips.serializeHooks) h(raw, section); return section.output; };
  assert.ok(r.flips.renderOpts.length >= 6 && r.flips.renderOpts.every((o) => o.allowScriptedContent === true && o.spread === 'none'), 'every pool view: scripts on (P9) and one page');
  const hostile = '<html xmlns="http://www.w3.org/1999/xhtml"><div>x</div><head></head><body><SCRIPT>top.p=1</SCRIPT><p onclick="x()">t</p><img src="OEBPS/a.png"/></body></html>';
  const out = render(hostile, { href: 'c1.xhtml', output: null });
  assert.ok(out.startsWith('<meta http-equiv="Content-Security-Policy"'), 'what renders starts with the policy (the guard runs after epub.js\'s own hook)');
  assert.doesNotMatch(out, /<script|onclick/i, 'and carries no code');
  assert.match(out, /blob:x\/a\.png/, "and keeps epub.js's resource rewrite");
  const again = render(hostile, { href: 'c1.xhtml', output: null }); // a second pool view rendering the same chapter
  assert.ok(again.startsWith('<meta http-equiv="Content-Security-Policy"'), 'every render of the chapter gets it (the cached rewrite)');
});

test('reader P8: a Contents entry that names no chapter leaves the reader where it is (never the book\'s start)', async () => {
  const toc = [{ label: 'Map', href: '../images/map.png' }, { label: 'Two', href: '../c2.xhtml#s' }];
  const r = mountReader({ detail: EPUB, toc });
  r.releaseDetail();
  await flush(20);
  for (let i = 0; i < 10; i++) await frame();
  const placeOf = () => r.doc.getElementById('reader-pane').dataset.ptPlace;
  const before = placeOf();
  const shown = r.flips.displayed.length;
  r.doc.getElementById('reader-toc-btn').click();
  let rows = [...r.doc.querySelectorAll('.ui-sheet .ui-row')];
  rows[0].click();
  await flush(10);
  assert.strictEqual(placeOf(), before, 'no jump');
  assert.strictEqual(r.flips.displayed.length, shown, 'nothing displayed');
  await new Promise((res) => setTimeout(res, 400));
  r.doc.getElementById('reader-toc-btn').click();
  rows = [...r.doc.querySelectorAll('.ui-sheet .ui-row')];
  rows[1].click();
  await flush(10);
  assert.deepStrictEqual(r.flips.displayed.slice(-1), ['c2.xhtml#s'], 'a chapter entry jumps to the spine\'s own href, fragment kept');
});

test('reader: a damaged book (epub.js openFailed; book.ready never settles) shows the error state, never a stuck "Opening book" (gate r2 qa)', async () => {
  const r = mountReader({ detail: EPUB, broken: true });
  r.releaseDetail();
  await flush(20);
  await frame();
  const status = r.doc.getElementById('reader-status');
  assert.strictEqual(status.hidden, false);
  assert.match(status.textContent, /Could not open this book/);
  assert.strictEqual(r.flips.renditions, 0, 'no page view is built for a book that failed to open');
});

test('reader P8: a re-anchor epub.js refuses (font change) falls back to the place\'s CHAPTER, never the book\'s start (gate r2 adversary Q17/Q18)', async () => {
  const r = mountReader({ detail: EPUB });
  r.releaseDetail();
  await flush(20);
  for (let i = 0; i < 10; i++) await frame();
  const visibleEl = r.doc.querySelector('.pt-rig.is-top > .pt-mask > .pt-inner > .reader-epub-page');
  const visible = r.flips.pool.find((x) => x.el === visibleEl);
  visible.fire('relocated', { start: { cfi: 'refuse-this-cfi', index: 3, displayed: { page: 1, total: 9 } } });
  const before = r.flips.displayed.length;
  r.doc.getElementById('reader-settings-btn').click();
  r.doc.querySelector('#reader-font-larger').click(); // a font change re-anchors the pool on the place
  await flush(20);
  for (let i = 0; i < 10; i++) await frame();
  const after = r.flips.displayed.slice(before);
  assert.ok(after.includes('refuse-this-cfi'), 'the pool re-anchors on the place');
  assert.ok(after.includes(3), "a refused CFI falls back to the place's chapter");
  assert.ok(!after.includes(undefined), "never display() with no target (the book's start)");
});

test('reader: destroy() closes an open sheet (it lives on <body>, outside #view-root)', async () => {
  const r = mountReader({ detail: EPUB });
  r.releaseDetail();
  await flush(20);
  r.doc.getElementById('reader-toc-btn').click();
  await frame();
  assert.strictEqual(r.doc.querySelectorAll('.ui-sheet.is-open').length, 1, 'precondition: the sheet is OPEN');
  r.view.destroy();
  active.view = null;
  assert.strictEqual(r.doc.querySelectorAll('.ui-sheet.is-open').length, 0, 'closing on nav-away');
});

test('reader D9: a book that cannot open shows the error ui-state with a way back, not a bare line', async () => {
  const r = mountReader({ detail: { error: 'nope' }, detailStatus: 404 });
  r.releaseDetail();
  await flush(10);
  const status = r.doc.getElementById('reader-status');
  assert.strictEqual(status.hidden, false);
  const st = status.querySelector('.ui-state');
  assert.ok(st, 'a ui-state block');
  assert.match(st.querySelector('.ui-state__title').textContent, /Could not open this book/);
  assert.strictEqual(st.querySelector('button.ui-btn').textContent, 'Back to books');
});

test('reader pure: readerMoreMenuItems and readerFontStepper', () => {
  const { readerMoreMenuItems, readerFontStepper } = require('../../public/js/read.js');
  assert.deepStrictEqual(readerMoreMenuItems({ finished: false }).map((i) => i.value), ['finished', 'save', 'share']);
  assert.strictEqual(readerMoreMenuItems({ finished: true })[0].label, 'Mark as unfinished');
  assert.deepStrictEqual(readerFontStepper(100, 'epub'), { value: 100, label: '100%', canShrink: true, canGrow: true });
  assert.deepStrictEqual(readerFontStepper(80, 'epub'), { value: 80, label: '80%', canShrink: false, canGrow: true });
  assert.deepStrictEqual(readerFontStepper(170, 'epub'), { value: 170, label: '170%', canShrink: true, canGrow: false });
  assert.deepStrictEqual(readerFontStepper(100, 'pdf'), { value: 100, label: 'Fixed', canShrink: false, canGrow: false }, 'PDF pages are fixed-layout');
});

test('source: books.js and read.js never write an inline visual style (only --p / --reader-h as data)', () => {
  for (const f of ['books.js', 'read.js']) {
    const src = fs.readFileSync(path.join(PUB, 'js', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const writes = [...src.matchAll(/(\w+)\.style\.(\w+)\s*=/g)].map((m) => `${m[1]}.${m[2]}`);
    // The one write left is read.js's PDF adapter sizing the rendered PAGE canvas
    // (reader content, not chrome) - named exactly, so a chrome write cannot hide behind it.
    const allowed = f === 'read.js' ? ['canvas.width'] : [];
    assert.deepStrictEqual(writes.filter((w) => !allowed.includes(w)), [], `${f}: no .style.X = writes`);
    for (const m of src.matchAll(/setProperty\('([^']+)'/g)) assert.ok(['--p', '--reader-h'].includes(m[1]), `${f}: setProperty(${m[1]})`);
    assert.doesNotMatch(src, /style="/, `${f}: no inline style attribute in markup strings`);
  }
});
