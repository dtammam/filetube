'use strict';

// [INTEGRATION] v1.376 W3 (R3, Dean: "filtered to audio, opened a video from a notification,
// tapped the channel name: Blank... has happened to me more than once"). A channel link opened
// from an item carries that item's type (`&format=video|audio`, common.js channelHrefForItem /
// watch.js resolveUploaderLinkHref); the home view's folder / root grid honours the URL format
// over the remembered `filetube_format` for THAT view and never writes it back; an empty grid
// while a format filter applies says so ("No audio here." / "No videos here.") with a "Show
// all" that lifts the filter for the view only. Drives the REAL index.html + main.js in jsdom
// (the library-pagination.test.js harness, own copy per this repo's convention) against a fetch
// stub that filters like the server does, and the REAL router for the same-route navigation.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const INDEX_HTML_PATH = path.join(PUBLIC_DIR, 'index.html');

const HOME_PAGE_LIMIT = 60;

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

function resolveResourcePath(pathname) {
  return path.join(PUBLIC_DIR, pathname);
}

function parseQueryParams(url) {
  const qIndex = url.indexOf('?');
  return new URLSearchParams(qIndex === -1 ? '' : url.slice(qIndex + 1));
}

// Slices `fullList` per the request's `offset`/`limit` query params --
// mirrors T6's server contract shape (`{ items, total, offset, limit }`)
// closely enough for this suite's purposes (this suite asserts CLIENT
// pagination behavior against a scripted server response, not the server's
// own sort/filter correctness -- that's T6's own test coverage).
function videosResponseFor(fullList, url) {
  const params = parseQueryParams(url);
  const offset = parseInt(params.get('offset') || '0', 10);
  const limit = parseInt(params.get('limit') || String(HOME_PAGE_LIMIT), 10);
  const total = fullList.length;
  const items = fullList.slice(offset, offset + limit);
  return { items, total, offset, limit };
}

// Builds the controllable `window.fetch` stub + a class-based
// `IntersectionObserver` stub, and records every call/instance for
// assertions.
function makeHomeFetchStub({ fullList }) {
  const calls = [];
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    calls.push({ url, method });
    if (url === '/api/config' && method === 'GET') {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ folders: ['/media/folder'], folderSettings: {} }),
      });
    }
    if (url === '/api/settings' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ defaultView: '' }) });
    }
    // v1.67: the corner-pref latch made /api/auth/me part of the home boot
    // contract (loadLibrary races it with /api/config before the first card
    // render), so the "leave it permanently unresolved" default below would
    // hang the grid. Empty settings -> the C5 default corner layout; the
    // corner BEHAVIOR itself is card-corners-fullchain.test.js's job.
    if (url === '/api/auth/me' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 1, username: 'u', settings: {} }) });
    }
    if (url.indexOf('/api/videos?') === 0 && method === 'GET') {
      // The SERVER's format filter (lib/videoQuery.js filterByFormat): 'video' / 'audio'
      // keep that type, anything else keeps all. Scoped by the folder the request names.
      const p = parseQueryParams(url);
      const fmt = p.get('format');
      const folder = p.get('folder');
      const scoped = fullList.filter((it) => (!folder || it.folderName === folder) && (fmt !== 'video' && fmt !== 'audio' ? true : it.type === fmt));
      return Promise.resolve({ ok: true, status: 200, json: async () => videosResponseFor(scoped, url) });
    }
    // An SPA navigation fetches the target page's HTML (the home shell for '/?...').
    if (url.indexOf('/api/') !== 0 && /^(http:\/\/localhost)?\/(\?|$)/.test(url) && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, text: async () => fs.readFileSync(INDEX_HTML_PATH, 'utf8') });
    }
    return new Promise(() => {}); // /api/subscriptions/pins etc. -- irrelevant here
  };
  return { fetchImpl, calls };
}

function makeIntersectionObserverStub(instances) {
  return class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.target = null;
      this.disconnected = false;
      instances.push(this);
    }
    observe(target) { this.target = target; }
    unobserve() { /* not used by main.js today */ }
    disconnect() { this.disconnected = true; }
    // Test-only helper: simulates the sentinel crossing into view.
    trigger(isIntersecting) {
      this.callback([{ isIntersecting, target: this.target }]);
    }
  };
}

function loadIndexWithFetchStub(fetchImpl, ioInstances, opts) {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const windowErrors = [];
  const unhandledRejections = [];
  const virtualConsole = new VirtualConsole();
  // Errors are captured for debuggability but NOT asserted zero by every
  // test below -- this suite cares about the pagination behavior, not a
  // full-page-error-free guarantee (that's shell-smoke.test.js's job).

  const dom = new JSDOM(html, {
    url: 'http://localhost' + ((opts && opts.path) || '/'),
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    resources: {
      interceptors: [
        requestInterceptor((request) => {
          const requestUrl = new URL(request.url);
          const filePath = resolveResourcePath(requestUrl.pathname);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const body = fs.readFileSync(filePath, 'utf8');
            return new Response(body, { status: 200, headers: { 'Content-Type': contentTypeFor(filePath) } });
          }
          return new Response('', { status: 404 });
        }),
      ],
    },
    beforeParse(window) {
      window.fetch = fetchImpl;
      if (opts && opts.storedFormat) window.localStorage.setItem('filetube_format', opts.storedFormat);
      window.IntersectionObserver = makeIntersectionObserverStub(ioInstances);
      window.matchMedia = function (query) {
        return {
          matches: false,
          media: query,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
        };
      };
    },
  });

  dom.window.addEventListener('error', (event) => {
    windowErrors.push({ message: event.message, stack: event.error && event.error.stack });
  });
  dom.window.addEventListener('unhandledrejection', (event) => {
    unhandledRejections.push(String(event.reason));
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ dom, windowErrors, unhandledRejections });
    };
    dom.window.addEventListener('load', () => setTimeout(finish, 20));
    setTimeout(finish, 5000);
  });
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Several macrotask turns -- the initial load chains multiple `await fetch`
// calls (config -> settings -> videos), each needing its own tick to settle.
async function settle(times) {
  for (let i = 0; i < (times || 6); i++) await flush();
}

// v1.72: the bare-home "Continue watching" row issues ONE
// /api/videos?filter=recent-watching&limit=10 selection fetch alongside the
// grid's page fetches. AC3.4's contract is about GRID PAGE fetches (no
// eager full-library render), so the row's bounded selection is excluded
// here - and by gridVideosCalls below for the param-assertion pops.
function gridVideosCalls(calls) {
  return calls.filter((c) => c.url.indexOf('/api/videos?') === 0 && c.url.indexOf('filter=recent-watching') === -1);
}

// Two channels: 'Video Only' (videos) and 'Audio Only' (audio).
function makeLibrary() {
  const list = [];
  for (let i = 0; i < 3; i++) list.push({ id: `vid-${i}`, title: `Video ${i}`, type: 'video', ext: '.mp4', duration: 120, size: 1000 + i, addedAt: 100000 - i, folderName: 'Video Only', progressPercent: 0 });
  for (let i = 0; i < 2; i++) list.push({ id: `aud-${i}`, title: `Audio ${i}`, type: 'audio', ext: '.m4a', duration: 120, size: 2000 + i, addedAt: 90000 - i, folderName: 'Audio Only', progressPercent: 0 });
  return list;
}

async function open(pathAndQuery, storedFormat) {
  const ioInstances = [];
  const { fetchImpl, calls } = makeHomeFetchStub({ fullList: makeLibrary() });
  const { dom } = await loadIndexWithFetchStub(fetchImpl, ioInstances, { path: pathAndQuery, storedFormat });
  await settle(10);
  const w = dom.window;
  const d = w.document;
  return {
    dom, w, d, calls,
    lastGridParams: () => { const c = gridVideosCalls(calls).pop(); return c ? parseQueryParams(c.url) : null; },
    cards: () => d.querySelectorAll('#video-grid .video-card').length,
    stateTitle: () => { const t = d.querySelector('#video-grid .ui-state__title'); return t ? t.textContent : null; },
    stateBody: () => { const t = d.querySelector('#video-grid .ui-state__body'); return t ? t.textContent : null; },
    showAll: () => d.querySelector('#video-grid [data-format-show-all]'),
    chip: (v) => d.querySelector(`#library-filter-chips .ui-chip[data-group="format"][data-chip="${v}"]`),
    pressed: (v) => { const c = d.querySelector(`#library-filter-chips .ui-chip[data-group="format"][data-chip="${v}"]`); return c ? c.getAttribute('aria-pressed') : null; },
    stored: () => w.localStorage.getItem('filetube_format'),
  };
}

test('a URL format wins over the remembered filter for THIS view and is never written back (the bug: Audio remembered, a video channel)', async () => {
  const h = await open('/?folder=Video%20Only&format=video', 'audio');
  try {
    assert.strictEqual(h.lastGridParams().get('format'), 'video', 'the grid asks the server for videos');
    assert.strictEqual(h.cards(), 3, 'the channel shows its videos, not a blank list');
    assert.strictEqual(h.pressed('video'), 'true', 'the toolbar shows the format that applies');
    assert.strictEqual(h.pressed('audio'), 'false');
    assert.strictEqual(h.stored(), 'audio', 'the remembered filter is untouched');
  } finally { h.dom.window.close(); }
});

test('without a URL format the remembered filter applies as before (a channel with none of that type is the filtered empty state)', async () => {
  const h = await open('/?folder=Video%20Only', 'audio');
  try {
    assert.strictEqual(h.lastGridParams().get('format'), 'audio');
    assert.strictEqual(h.cards(), 0);
    assert.strictEqual(h.stateTitle(), 'No audio here.', 'the empty state names the filter, not "This folder is empty."');
    assert.strictEqual(h.stateBody(), 'The Audio filter is on.');
    assert.ok(h.showAll(), 'a Show all button');
    assert.strictEqual(h.showAll().textContent.trim(), 'Show all');
  } finally { h.dom.window.close(); }
});

test('the filtered empty state reads "No videos here." under a Videos filter (URL or remembered)', async () => {
  const a = await open('/?folder=Audio%20Only', 'video');
  try {
    assert.strictEqual(a.stateTitle(), 'No videos here.');
    assert.strictEqual(a.stateBody(), 'The Videos filter is on.');
  } finally { a.dom.window.close(); }
  const b = await open('/?folder=Audio%20Only&format=video', 'both');
  try {
    assert.strictEqual(b.lastGridParams().get('format'), 'video');
    assert.strictEqual(b.stateTitle(), 'No videos here.', 'a URL format that empties the list says so too');
    assert.ok(b.showAll());
  } finally { b.dom.window.close(); }
});

test('"Show all" shows every format for THIS view only: the grid refetches format=both, the URL keeps it, the remembered filter is untouched', async () => {
  const h = await open('/?folder=Video%20Only', 'audio');
  try {
    const before = gridVideosCalls(h.calls).length;
    h.showAll().click();
    await settle(8);
    assert.strictEqual(gridVideosCalls(h.calls).length, before + 1, 'one refetch');
    assert.strictEqual(h.lastGridParams().get('format'), 'both');
    assert.strictEqual(h.lastGridParams().get('offset'), '0');
    assert.strictEqual(h.cards(), 3, 'the videos show');
    assert.strictEqual(h.stateTitle(), null, 'the empty state is gone');
    assert.strictEqual(new URLSearchParams(h.w.location.search).get('format'), 'both', 'a reload or Back lands the same');
    assert.strictEqual(new URLSearchParams(h.w.location.search).get('folder'), 'Video Only', 'the scope is kept');
    assert.strictEqual(h.pressed('audio'), 'false', 'the toolbar no longer shows Audio');
    assert.strictEqual(h.pressed('video'), 'false');
    assert.strictEqual(h.stored(), 'audio', 'the remembered filter is untouched');
  } finally { h.dom.window.close(); }
});

test('the format chip is the remembered filter\'s control: a tap writes it and ends the visit\'s URL format', async () => {
  const h = await open('/?folder=Video%20Only&format=video', 'audio');
  try {
    assert.strictEqual(h.pressed('video'), 'true');
    h.chip('audio').click();
    await settle(8);
    assert.strictEqual(h.stored(), 'audio', 'the tap wrote the remembered filter (audio)');
    assert.strictEqual(h.lastGridParams().get('format'), 'audio', 'the grid follows the chip');
    assert.strictEqual(new URLSearchParams(h.w.location.search).get('format'), null, 'the URL format is dropped');
    assert.strictEqual(h.stateTitle(), 'No audio here.');
    h.chip('audio').click(); // tapping the selected chip again = All
    await settle(8);
    assert.strictEqual(h.stored(), 'both');
    assert.strictEqual(h.lastGridParams().get('format'), 'both', 'after the override is gone the remembered filter drives the grid');
  } finally { h.dom.window.close(); }
});

test('no filter, empty folder: the old "This folder is empty." copy stays (the filtered copy is only for a filter)', async () => {
  const h = await open('/?folder=Nothing%20Here', 'both');
  try {
    assert.strictEqual(h.stateTitle(), 'This folder is empty.');
    assert.strictEqual(h.showAll(), null);
  } finally { h.dom.window.close(); }
});

test('a home card\'s channel link carries the card\'s own type (video card -> videos, audio card -> audio)', async () => {
  const g = await open('/', 'both');
  try {
    const byline = (id) => {
      const t = g.d.querySelector(`#video-grid .video-card .video-title[href*="${id}"]`);
      return t ? t.closest('.video-card').querySelector('.video-uploader a').getAttribute('href') : null;
    };
    assert.strictEqual(byline('vid-0'), '/?folder=Video%20Only&format=video');
    assert.strictEqual(byline('aud-0'), '/?folder=Audio%20Only&format=audio');
  } finally { g.dom.window.close(); }
});

test('same-route navigation (home -> home, a query change): tapping a card\'s channel link re-renders with the link\'s format, and back on Home the remembered filter applies', async () => {
  const h = await open('/?folder=Audio%20Only&format=both', 'audio');
  try {
    assert.strictEqual(h.cards(), 2);
    const before = gridVideosCalls(h.calls).length;
    // the router handles the in-app link exactly as a tap would
    await h.w.FileTube.navigate('/?folder=Video%20Only&format=video');
    await settle(12);
    assert.strictEqual(h.w.location.search, '?folder=Video%20Only&format=video');
    assert.ok(gridVideosCalls(h.calls).length > before, 'the new view fetched its grid');
    assert.strictEqual(h.lastGridParams().get('folder'), 'Video Only');
    assert.strictEqual(h.lastGridParams().get('format'), 'video', 'the re-rendered view uses the NEW URL format');
    assert.strictEqual(h.cards(), 3);
    assert.strictEqual(h.pressed('video'), 'true');
    assert.strictEqual(h.stored(), 'audio');
    await h.w.FileTube.navigate('/?folder=Audio%20Only');
    await settle(12);
    assert.strictEqual(h.lastGridParams().get('format'), 'audio', 'a link without a format: the remembered filter applies again');
    assert.strictEqual(h.pressed('audio'), 'true');
  } finally { h.dom.window.close(); }
});
