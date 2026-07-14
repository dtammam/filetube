'use strict';

// [INTEGRATION] v1.30.0 T7 (v1.30 Scale Performance + Polish Wave, A5) -- the
// home grid consumes T6's paginated `GET /api/videos` contract
// (`{ items, total, offset, limit }`, default page size 60) instead of a bare
// array. Covers AC3.4 (the headline): initial render is PAGE 0 ONLY (never an
// eager full-library render), further pages are fetched one-at-a-time by an
// IntersectionObserver sentinel and APPENDED (never a full grid rebuild), the
// sentinel correctly stops once the end of the filtered/sorted set is
// reached, every sort/format/shuffle "reset" refetches a FRESH page 0 (with a
// new random `seed` on a re-roll), and `window.__filetubeRefreshLibrary`
// (the T8 in-place-refresh hook) still re-renders from page 0 under
// pagination.
//
// HARNESS: reuses test/integration/rescan-scan-poll.test.js's exact
// `loadIndexWithFetchStub`-style loading shape (a real jsdom `index.html`
// document, `runScripts: 'dangerously'`, static files served from disk via a
// `resources.interceptors` request interceptor) -- own copy per this repo's
// documented small-per-file-harness-duplication convention (see that file's
// own header comment for the list of prior art this follows). `fetch` is
// replaced with a fully controllable stub that answers `/api/config`,
// `/api/settings`, and every `/api/videos?...` list request from an
// in-memory fixture; `/api/subscriptions/pins` (an unrelated, independent
// sidebar fetch) is left permanently unresolved, mirroring shell-smoke.test
// .js's own "don't care about it" stubbing philosophy.
//
// jsdom ships no `IntersectionObserver` implementation at all -- this suite
// supplies its own small controllable stub (`beforeParse`) that records every
// constructed instance and lets a test manually fire a "the sentinel just
// scrolled into view" intersection via `.trigger(true)`, which is how the
// pagination tests below simulate scrolling without any real layout engine.
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

// A deterministic media-item fixture -- only the fields main.js's card
// markup / sort-badge path actually reads.
function makeItem(i) {
  return {
    id: `item-${i}`,
    title: `Video ${i}`,
    type: 'video',
    ext: '.mp4',
    duration: 120,
    size: 1000 + i,
    addedAt: 100000 - i,
    folderName: 'folder',
    progressPercent: 0,
  };
}

function makeFullList(count) {
  const list = [];
  for (let i = 0; i < count; i++) list.push(makeItem(i));
  return list;
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
    if (url.indexOf('/api/videos?') === 0 && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => videosResponseFor(fullList, url) });
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

function loadIndexWithFetchStub(fetchImpl, ioInstances) {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const windowErrors = [];
  const unhandledRejections = [];
  const virtualConsole = new VirtualConsole();
  // Errors are captured for debuggability but NOT asserted zero by every
  // test below -- this suite cares about the pagination behavior, not a
  // full-page-error-free guarantee (that's shell-smoke.test.js's job).

  const dom = new JSDOM(html, {
    url: 'http://localhost/',
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

function videosCallCount(calls) {
  return calls.filter((c) => c.url.indexOf('/api/videos?') === 0).length;
}

// ---------------------------------------------------------------------------
// AC3.4 headline: page-0-only initial render, N sentinel intersections -> N
// additional page fetches + appends, guarded at end-of-list.
// ---------------------------------------------------------------------------

test('home grid: initial load renders PAGE 0 ONLY (60 of 130), not an eager full-library render (AC3.4)', async () => {
  const fullList = makeFullList(130);
  const ioInstances = [];
  const { fetchImpl, calls } = makeHomeFetchStub({ fullList });

  const { dom } = await loadIndexWithFetchStub(fetchImpl, ioInstances);
  try {
    await settle();
    const { document } = dom.window;
    const cards = document.querySelectorAll('#video-grid .video-card');
    assert.strictEqual(cards.length, HOME_PAGE_LIMIT, 'expected exactly one page (60) of cards after the initial load, not all 130');
    assert.strictEqual(videosCallCount(calls), 1, 'expected exactly one /api/videos fetch for the initial page');

    const sentinel = document.getElementById('video-grid-sentinel');
    assert.ok(sentinel, 'expected the IntersectionObserver sentinel element to have been created');
    assert.strictEqual(ioInstances.length, 1, 'expected exactly one IntersectionObserver to have been created');
  } finally {
    dom.window.close();
  }
});

test('home grid: N sentinel intersections fetch+append N more pages, stopping exactly at the end of the list (AC3.4)', async () => {
  const fullList = makeFullList(130); // 60 + 60 + 10 across 3 pages
  const ioInstances = [];
  const { fetchImpl, calls } = makeHomeFetchStub({ fullList });

  const { dom } = await loadIndexWithFetchStub(fetchImpl, ioInstances);
  try {
    await settle();
    const { document } = dom.window;
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 60);
    assert.strictEqual(ioInstances.length, 1);
    const observer = ioInstances[0];

    // Intersection #1 -> page 2 (offset 60, 60 more items -> 120 total).
    observer.trigger(true);
    await settle();
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 120, 'expected 120 cards after the first sentinel intersection');
    assert.strictEqual(videosCallCount(calls), 2);

    // Intersection #2 -> page 3 (offset 120, the final 10 items -> 130 total).
    observer.trigger(true);
    await settle();
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 130, 'expected all 130 cards after the second sentinel intersection');
    assert.strictEqual(videosCallCount(calls), 3);

    // Intersection #3 -- offset(120)+limit(60) >= total(130): the end of the
    // list has been reached. This must NOT fire another fetch/append.
    observer.trigger(true);
    await settle();
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 130, 'expected no further cards past the end of the list');
    assert.strictEqual(videosCallCount(calls), 3, 'expected NO additional /api/videos fetch once offset+limit >= total');
  } finally {
    dom.window.close();
  }
});

test('home grid: an appended page uses createElement/append -- the already-rendered first-page cards are never re-parsed/replaced', async () => {
  const fullList = makeFullList(90);
  const ioInstances = [];
  const { fetchImpl } = makeHomeFetchStub({ fullList });

  const { dom } = await loadIndexWithFetchStub(fetchImpl, ioInstances);
  try {
    await settle();
    const { document } = dom.window;
    const firstCardBefore = document.querySelector('#video-grid .video-card');
    assert.ok(firstCardBefore, 'expected at least one rendered card after the initial page');
    // Tag the actual DOM node so identity survives only if it's never
    // replaced by an innerHTML rebuild.
    firstCardBefore.__paginationIdentityTag = 'still-the-same-node';

    ioInstances[0].trigger(true);
    await settle();

    const firstCardAfter = document.querySelector('#video-grid .video-card');
    assert.strictEqual(
      firstCardAfter.__paginationIdentityTag, 'still-the-same-node',
      'expected the first page\'s first card to be the SAME DOM node after an append -- an innerHTML rebuild would have destroyed this tag'
    );
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 90);
  } finally {
    dom.window.close();
  }
});

// ---------------------------------------------------------------------------
// Reset semantics: sort/format/search/shuffle changes refetch page 0 with
// fresh params (a new seed on a re-roll) and REPLACE the grid.
// ---------------------------------------------------------------------------

test('home grid: a sort change refetches a fresh page 0 with the new sort param and REPLACES the grid', async () => {
  const fullList = makeFullList(200);
  const ioInstances = [];
  const { fetchImpl, calls } = makeHomeFetchStub({ fullList });

  const { dom } = await loadIndexWithFetchStub(fetchImpl, ioInstances);
  try {
    await settle();
    const { document } = dom.window;
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 60);
    assert.strictEqual(videosCallCount(calls), 1);

    // v1.41.2: the sort control is a custom dropdown -- pick an option by
    // clicking its menu item (the same UI path a user takes).
    const sortItem = document.querySelector('#sort-menu [data-sort="title-asc"]');
    sortItem.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await settle();

    assert.strictEqual(videosCallCount(calls), 2, 'expected the sort change to trigger exactly one more /api/videos fetch');
    // REPLACED, not appended: still exactly one page's worth of cards.
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 60, 'expected the grid to be REPLACED with a fresh page 0, not appended to');

    const lastVideosCall = calls.filter((c) => c.url.indexOf('/api/videos?') === 0).pop();
    const params = parseQueryParams(lastVideosCall.url);
    assert.strictEqual(params.get('sort'), 'title-asc');
    assert.strictEqual(params.get('offset'), '0', 'expected the reset to start at offset 0');
  } finally {
    dom.window.close();
  }
});

test('home grid: the format toggle refetches page 0 with the new format param', async () => {
  const fullList = makeFullList(20);
  const ioInstances = [];
  const { fetchImpl, calls } = makeHomeFetchStub({ fullList });

  const { dom } = await loadIndexWithFetchStub(fetchImpl, ioInstances);
  try {
    await settle();
    const { document } = dom.window;
    assert.strictEqual(videosCallCount(calls), 1);

    const videoToggleBtn = document.querySelector('.format-toggle-btn[data-format-mode="video"]');
    assert.ok(videoToggleBtn, 'expected the format toggle\'s "Videos" button to exist');
    videoToggleBtn.click();
    await settle();

    assert.strictEqual(videosCallCount(calls), 2, 'expected the format-toggle change to trigger exactly one more /api/videos fetch');
    const lastVideosCall = calls.filter((c) => c.url.indexOf('/api/videos?') === 0).pop();
    const params = parseQueryParams(lastVideosCall.url);
    assert.strictEqual(params.get('format'), 'video');
    assert.strictEqual(params.get('offset'), '0');
  } finally {
    dom.window.close();
  }
});

test('home grid: "shuffle again" re-fetches page 0 with a FRESH seed each time (a re-roll actually re-randomizes)', async () => {
  const fullList = makeFullList(20);
  const ioInstances = [];
  const { fetchImpl, calls } = makeHomeFetchStub({ fullList });

  const { dom } = await loadIndexWithFetchStub(fetchImpl, ioInstances);
  try {
    await settle();
    const { document, window } = dom.window;
    // Switch to "random" via the custom sort dropdown (the same UI path a
    // user would take) -- this both persists `filetube_sort=random` AND
    // triggers the reset that makes the Shuffle button visible.
    const sortItem = document.querySelector('#sort-menu [data-sort="random"]');
    sortItem.dispatchEvent(new window.Event('click', { bubbles: true }));
    await settle();

    const firstSeedCall = calls.filter((c) => c.url.indexOf('/api/videos?') === 0).pop();
    const firstSeed = parseQueryParams(firstSeedCall.url).get('seed');
    assert.ok(firstSeed, 'expected a seed param on the random-sort fetch');

    const shuffleBtn = document.getElementById('shuffle-again-btn');
    assert.ok(shuffleBtn, 'expected #shuffle-again-btn to exist');
    assert.strictEqual(shuffleBtn.hidden, false, 'expected the shuffle button to be visible once sort=random');

    shuffleBtn.click();
    await settle();

    const secondSeedCall = calls.filter((c) => c.url.indexOf('/api/videos?') === 0).pop();
    const secondSeed = parseQueryParams(secondSeedCall.url).get('seed');
    assert.notStrictEqual(secondSeed, firstSeed, 'expected "shuffle again" to mint a NEW seed, not reuse the previous one');
  } finally {
    dom.window.close();
  }
});

// ---------------------------------------------------------------------------
// In-place refresh (T8 fence): window.__filetubeRefreshLibrary must still
// re-render from a fresh page 0 under pagination.
// ---------------------------------------------------------------------------

test('window.__filetubeRefreshLibrary re-renders from a FRESH page 0 under pagination (T8 fence)', async () => {
  const fullList = makeFullList(130);
  const ioInstances = [];
  const { fetchImpl } = makeHomeFetchStub({ fullList });

  const { dom } = await loadIndexWithFetchStub(fetchImpl, ioInstances);
  try {
    await settle();
    const { document, window } = dom.window;

    // Scroll one page in, so the grid holds MORE than one page's worth --
    // proving the refresh below genuinely resets rather than just happening
    // to already be at page 0.
    ioInstances[0].trigger(true);
    await settle();
    assert.strictEqual(document.querySelectorAll('#video-grid .video-card').length, 120);

    assert.strictEqual(typeof window.__filetubeRefreshLibrary, 'function', 'expected the home view to have installed the in-place-refresh hook');
    window.__filetubeRefreshLibrary();
    await settle();

    assert.strictEqual(
      document.querySelectorAll('#video-grid .video-card').length, 60,
      'expected the in-place refresh to reset the grid back to a single fresh page 0, not leave the previously-appended pages in place'
    );
    // The sentinel/observer must be reused, not duplicated, across a refresh.
    assert.strictEqual(ioInstances.length, 1, 'expected the SAME sentinel/observer to be reused across an in-place refresh, not a second one created');
  } finally {
    dom.window.close();
  }
});
