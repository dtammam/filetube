'use strict';

// [INTEGRATION] v1.30.0 T8 (v1.30 Scale Performance + Polish Wave, B1/B7) --
// "never silently drop a one-shot download's done-edge", proven end-to-end
// across the 3 surfaces the design (docs/exec-plans/active/2026-07-11-v1.30-
// scale-perf-and-polish.md, "### B1 -- done-edge / dirty-flag") calls out,
// against the REAL running app (real public/js/common.js + main.js +
// watch.js, real SPA router, real chip poll loop -- nothing here re-derives
// or mirrors the production logic; every assertion is against genuine
// runtime behavior):
//
//   - AC5.1 (on-home): a one-shot's done-edge, observed while home IS the
//     live refresh target, triggers a real `loadLibrary()` re-fetch/re-render
//     in place -- the newly-completed item is present in the rendered grid
//     afterwards.
//   - AC5.2 (off-home / cache-restore, BOTH directions, asserted in this ONE
//     test): (a) is exactly AC5.1 above (the design's own words: "same as
//     AC5.1"). (b) a done-edge observed with NO live refresh target defers
//     via a persistent dirty flag (`localStorage['filetube_home_dirty']`)
//     instead of being silently dropped; navigating back to the exact cached
//     home URL then reconciles by routing through a genuinely FRESH render
//     (a real second `fetch('/')` + a real second `loadLibrary()`) instead of
//     ever reattaching the stale cached DOM node -- the completed item
//     appears, and the flag is cleared.
//   - AC5.3 (backgrounded-PWA-resume): a job that finishes while the
//     document is `hidden`, AND has since been fully dropped from the
//     server's own `/api/subscriptions/status` snapshot by the time the tab
//     becomes visible again (the harder case than merely still-`done`), is
//     still surfaced via the retained `localStorage['filetube_pending_
//     oneshots']` marker and a real `visibilitychange`-triggered catch-up
//     poll that overrides the chip's own `document.hidden` early-return.
//   - AC5.4 (reload-never, all 3 surfaces): `window.location.reload`/any
//     other full navigation is asserted to be called ZERO times across the
//     ENTIRE scenario above.
//
// WHY ONE LONG CONTINUOUS TEST rather than several small ones: (1) the task
// explicitly requires AC5.2's both directions in the SAME test; (2)
// `injectDownloadStatusChip`'s own in-flight guard
// (`dlStatusChipInjectStarted`, common.js) is a MODULE-LEVEL latch that is
// deliberately never reset -- it mirrors a real browser tab's page-lifetime
// (injected at most once per page load) -- so within a single jsdom `window`
// (one simulated page load, exactly like a real tab), only the FIRST
// `injectDownloadStatusChip()` call ever does anything; the SPA router's
// `homeViewCache`/dirty-flag state is also only meaningfully continuous
// within one simulated page load/navigation session. A realistic "one user
// session, three things happen to them in sequence" scenario is therefore
// naturally ONE test, not several independently-booted ones.
//
// HARNESS: reuses the exact loading shape test/integration/rescan-scan-
// poll.test.js and test/integration/shell-smoke.test.js already established
// (real index.html + real `<script>` execution via jsdom's `runScripts:
// "dangerously"`, static files served from disk, a controllable `window
// .fetch` stub, `window.location.reload`/navigation detected via jsdom's
// `not-implemented: navigation` VirtualConsole channel -- see rescan-scan-
// poll.test.js's own comment on `loadIndexWithFetchStub` for why a direct
// `location.reload` property override is not possible against a REAL jsdom
// `Location`), own copy per this repo's established per-file harness-
// duplication convention.
//
// A NOTE ON TIMING: this suite polls REAL wall-clock time (`waitUntil`
// below) rather than fixed `setTimeout` delays keyed to the chip's own
// ~700ms fast-poll cadence -- jsdom's own module-load/script-compile
// overhead for a full shell (5 scripts + a stylesheet) is comparable to that
// cadence and varies by machine/load, so a fixed-delay design was observed
// to race unpredictably against the chip's OWN background poll loop. The
// `/api/subscriptions/status` stub is therefore a MUTABLE "current phase"
// supplier the test explicitly swaps at each checkpoint (repeated identical
// ticks against the same phase are idempotent/harmless -- `pollOnce`'s own
// seen-set already de-dupes a 'done' edge it's already consumed), and a
// persistent "keep-alive" decoy job keeps the poll cadence fast throughout
// the whole scenario without being the job any assertion cares about.
//
// A NOTE ON HOW "off-home, no live refresh target" IS REACHED HERE: this
// suite navigates home -> /watch.html (a real SPA navigation via `window
// .FileTube.navigate`), which -- per the SPA router's own documented
// behavior (common.js's `swapToView`, the `homeViewCache` comment) -- CACHES
// the outgoing home instance rather than destroying it, so its
// `window.__filetubeRefreshLibrary` hook actually remains technically live
// while cached. To exercise the genuinely-no-live-target branch the way a
// fresh session landing directly on a non-home page would (where the hook
// was simply never set), this suite clears the hook explicitly right after
// leaving home -- `window.__filetubeRefreshLibrary = null` -- documented
// here rather than silently done inline. Everything downstream of that one
// line (the chip's `pollOnce` observing the done-edge, deciding
// `refreshLibraryInPlace()` returned `false`, calling the real
// `markHomeGridDirty()`, and the real SPA router's `restoreHomeFromCache`
// later reconciling it) is genuine, unmodified production code.

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

function resolveResourcePath(pathname) {
  return path.join(PUBLIC_DIR, pathname);
}

function normalizeRequestUrl(input) {
  const raw = typeof input === 'string' ? input : (input && input.url) || '';
  try {
    const u = new URL(raw, 'http://localhost/');
    return { pathname: u.pathname, full: u.pathname + u.search };
  } catch (_) {
    return { pathname: raw, full: raw };
  }
}

function makeItem(id, title) {
  return {
    id,
    title,
    size: 2048,
    addedAt: Date.now(), // formatRelativeTime (common.js) expects an epoch-ms number, not an ISO string
    duration: 120,
    type: 'video',
    progressPercent: 0,
    folderName: 'Movies',
    ext: 'mp4',
  };
}

// A persistent, never-completing decoy job so `/api/subscriptions/status`
// always reports at least one freshly-`downloading` entry -- keeps the
// chip's poll cadence at its fast ~700ms rate (`nextDownloadChipPollDelay`)
// for the ENTIRE scenario, independent of which of jobA/jobB/jobC (the jobs
// under test) is currently active. Its `updatedAt` is recomputed fresh on
// every call (never stale per `isFreshlyActiveEntry`'s freshness window).
function keepAliveJob() {
  return { state: 'downloading', updatedAt: new Date().toISOString() };
}

// A minimal, valid `#view-root` fragment for a "watch" navigation target --
// deliberately WITHOUT `#player-slot`, so watch.js's own init() guard
// (`if (!playerSlot || ...) { showFatalViewError(root); return; }`) fails
// safe with zero further fetches -- this suite only needs a genuine,
// different-from-home view to navigate INTO, not real watch-page behavior.
const WATCH_FRAGMENT_HTML = '<!DOCTYPE html><html><head><title>Watch</title></head><body><div id="view-root" data-view="watch"></div></body></html>';

// Builds the controllable `window.fetch` stub every scripted response in
// this suite flows through. `/api/subscriptions/status` reads from a
// MUTABLE `state.statusSupplier` the test reassigns at each phase boundary
// (see the file header's "A NOTE ON TIMING"); `/api/videos` is indexed by
// call count (mirrors rescan-scan-poll.test.js's clamping pattern) so the
// test can assert exactly what each successive fetch returned.
function makeFetchStub({ videosScript, homeHtml }) {
  const calls = { status: 0, videos: 0, watchHtml: 0, homeHtml: 0 };
  const log = [];
  const state = { statusSupplier: () => ({ oneShots: { keepAlive: keepAliveJob() } }) };
  const fetchImpl = (input, init) => {
    const { pathname, full } = normalizeRequestUrl(input);
    const method = (init && init.method) || 'GET';
    log.push({ pathname, full, method });

    if (pathname === '/api/subscriptions/health' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200 });
    }
    if (pathname === '/api/subscriptions/status' && method === 'GET') {
      calls.status += 1;
      return Promise.resolve({ ok: true, json: async () => state.statusSupplier() });
    }
    if (pathname === '/api/config' && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => ({ folders: ['Movies'], folderSettings: {} }) });
    }
    if (pathname === '/api/settings' && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }
    if (pathname === '/api/videos' && method === 'GET') {
      const idx = Math.min(calls.videos, videosScript.length - 1);
      calls.videos += 1;
      return Promise.resolve({ ok: true, json: async () => videosScript[idx] });
    }
    if (pathname === '/api/subscriptions/pins' && method === 'GET') {
      return new Promise(() => {}); // irrelevant to this suite -- never resolves, mirrors rescan-scan-poll.test.js's convention
    }
    if (pathname === '/watch.html' && method === 'GET') {
      calls.watchHtml += 1;
      return Promise.resolve({ ok: true, status: 200, text: async () => WATCH_FRAGMENT_HTML });
    }
    if (pathname === '/' && method === 'GET') {
      // Only the router's own `loadFreshHomeView` (the dirty-flag reconcile
      // path, AC5.2b) ever fetches '/' via `window.fetch` -- the page's OWN
      // initial load is served by jsdom's static `resources.interceptors`
      // below, never through this stub.
      calls.homeHtml += 1;
      return Promise.resolve({ ok: true, status: 200, text: async () => homeHtml });
    }
    return Promise.reject(new Error('unexpected fetch: ' + method + ' ' + full));
  };
  return { fetchImpl, log, calls, state };
}

// Loads the real index.html shell with its full real script set executed --
// see rescan-scan-poll.test.js's `loadIndexWithFetchStub` for the full
// rationale behind every choice here (own copy per this repo's established
// convention); `navigationErrors` is the AC5.4 reload-never signal.
function loadIndexWithFetchStub(fetchImpl) {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const windowErrors = [];
  const unhandledRejections = [];
  const navigationErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    if (err.type === 'not-implemented' && /navigation/i.test(err.message)) {
      navigationErrors.push({ type: err.type, message: err.message });
    }
  });

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
      resolve({ dom, windowErrors, unhandledRejections, navigationErrors });
    };
    dom.window.addEventListener('load', () => setTimeout(finish, 20));
    setTimeout(finish, 5000); // fallback so a wedged load can never hang the suite
  });
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushMany(times) {
  for (let i = 0; i < times; i += 1) await flush();
}

function realDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polls `predicate` against REAL wall-clock time until it returns truthy, or
// throws once `timeoutMs` has elapsed -- see the file header's "A NOTE ON
// TIMING" for why this suite waits on OUTCOMES rather than fixed delays.
async function waitUntil(predicate, { timeoutMs = 4000, intervalMs = 15, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitUntil: "${label}" was not met within ${timeoutMs}ms`);
    }
    await realDelay(intervalMs);
  }
}

function setDocumentHidden(doc, hidden) {
  Object.defineProperty(doc, 'hidden', { value: hidden, configurable: true });
}

function videoTitles(document) {
  return [...document.querySelectorAll('.video-title')].map((el) => el.textContent.trim());
}

test('one-shot done-edge visibility: on-home refresh (AC5.1), off-home dirty-flag defer + cache-restore reconcile (AC5.2, both directions), backgrounded-resume via dropped-snapshot (AC5.3), and reload-never across all three surfaces (AC5.4)', async () => {
  const videosScript = [
    { items: [makeItem('v1', 'Old Item')], total: 1, offset: 0, limit: 60 }, // idx0: initial load
    { items: [makeItem('v1', 'Old Item'), makeItem('v2', 'Item A (from jobA)')], total: 2, offset: 0, limit: 60 }, // idx1: AC5.1 in-place refresh
    { items: [makeItem('v1', 'Old Item'), makeItem('v2', 'Item A (from jobA)'), makeItem('v3', 'Item B (from jobB)')], total: 3, offset: 0, limit: 60 }, // idx2: AC5.2b dirty-flag fresh reconcile
    { items: [makeItem('v1', 'Old Item'), makeItem('v2', 'Item A (from jobA)'), makeItem('v3', 'Item B (from jobB)'), makeItem('v4', 'Item C (from jobC)')], total: 4, offset: 0, limit: 60 }, // idx3: AC5.3 backgrounded-resume refresh
  ];

  const homeHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const { fetchImpl, calls, state } = makeFetchStub({ videosScript, homeHtml });

  const { dom, windowErrors, unhandledRejections, navigationErrors } = await loadIndexWithFetchStub(fetchImpl);
  try {
    const { document, window } = dom.window;

    // ---- Initial home load -------------------------------------------------
    await waitUntil(() => calls.videos >= 1, { label: 'initial /api/videos fetch' });
    await flushMany(3);
    assert.strictEqual(calls.videos, 1, 'expected exactly one initial /api/videos fetch (no job has transitioned to done yet)');
    assert.strictEqual(document.querySelectorAll('.video-card').length, 1, 'expected the initial single-item grid');
    assert.strictEqual(typeof window.__filetubeRefreshLibrary, 'function', 'expected home\'s init() to have exposed the refresh hook');
    assert.strictEqual(window.localStorage.getItem('filetube_home_dirty'), null);

    // ---- AC5.1 / AC5.2(a): on-home done-edge -> real in-place refresh -----
    state.statusSupplier = () => ({ oneShots: { keepAlive: keepAliveJob(), jobA: { state: 'done' } } });
    await waitUntil(() => videoTitles(document).includes('Item A (from jobA)'), { label: 'AC5.1 in-place refresh to render jobA\'s item' });

    assert.strictEqual(calls.videos, 2, 'expected jobA\'s done-edge to have triggered exactly one REAL second /api/videos fetch (in-place refresh)');
    assert.strictEqual(document.querySelectorAll('.video-card').length, 2, 'expected the newly-completed item (jobA) to be present in the rendered grid (AC5.1)');
    assert.strictEqual(window.localStorage.getItem('filetube_home_dirty'), null, 'a successfully-refreshed live target must never mark the grid dirty');

    // ---- Leave home for /watch.html (real SPA navigation) -----------------
    assert.ok(window.FileTube && typeof window.FileTube.navigate === 'function', 'expected the SPA router to expose window.FileTube.navigate');
    await window.FileTube.navigate('/watch.html?v=oneshot-visibility-test');
    await flushMany(3);
    assert.strictEqual(document.getElementById('view-root').getAttribute('data-view'), 'watch', 'expected the SPA navigation into /watch.html to have actually swapped the view');

    // See this file's header comment ("A NOTE ON HOW...") for exactly why
    // this line exists and what it stands in for.
    window.__filetubeRefreshLibrary = null;

    // ---- AC5.2(b): off-home done-edge -> deferred via the dirty flag ------
    state.statusSupplier = () => ({ oneShots: { keepAlive: keepAliveJob(), jobA: { state: 'done' }, jobB: { state: 'done' } } });
    await waitUntil(() => window.localStorage.getItem('filetube_home_dirty') === '1', {
      label: 'AC5.2b: jobB\'s done-edge (observed off-home) marking the grid dirty',
    });

    assert.strictEqual(calls.videos, 2, 'no live refresh target while off-home -- /api/videos must NOT have been fetched again yet');

    // ---- Return to the EXACT cached home URL: dirty-reconcile fires -------
    // This is a genuine cache-hit (homeViewCache still matches '/', per the
    // SPA router's own documented behavior -- see this file's header
    // comment); `restoreHomeFromCache`'s own `isHomeGridDirty()` check must
    // bypass the normal stale-node reattach and route through a real fresh
    // render instead.
    await window.FileTube.navigate('/');
    await waitUntil(() => calls.homeHtml >= 1, { label: 'AC5.2b: dirty-flagged cache-restore fetching a fresh \'/\'' });
    await waitUntil(() => videoTitles(document).includes('Item B (from jobB)'), { label: 'AC5.2b: fresh reconcile rendering jobB\'s item' });

    assert.strictEqual(calls.homeHtml, 1, 'expected the dirty-flagged cache-restore to have issued exactly one real fetch(\'/\') -- a plain reattach never fetches anything');
    assert.strictEqual(calls.videos, 3, 'expected the fresh home render to have re-invoked loadLibrary() (a third /api/videos fetch), not reattached the stale 2-card cached grid');
    assert.strictEqual(document.querySelectorAll('.video-card').length, 3, 'expected jobB\'s completed item to be present after the dirty-flag reconcile');
    assert.strictEqual(window.localStorage.getItem('filetube_home_dirty'), null, 'expected the dirty flag to be cleared once reconciled');
    assert.strictEqual(typeof window.__filetubeRefreshLibrary, 'function', 'expected the fresh home init() to have re-exposed a live refresh hook');

    // ---- AC5.3: backgrounded-PWA-resume, job dropped from the snapshot ----
    // jobC starts freshly downloading (while genuinely back on home) --
    // primes `pendingOneShotJobIds` via the chip's own per-tick write.
    state.statusSupplier = () => ({
      oneShots: { keepAlive: keepAliveJob(), jobA: { state: 'done' }, jobB: { state: 'done' }, jobC: { state: 'downloading', updatedAt: new Date().toISOString() } },
    });
    await waitUntil(() => {
      let pending = [];
      try { pending = JSON.parse(window.localStorage.getItem('filetube_pending_oneshots') || '[]'); } catch (_) { /* not yet valid JSON */ }
      return pending.includes('jobC');
    }, { label: 'AC5.3: jobC recorded as pending before backgrounding' });

    // Background the tab: going hidden re-records the pending marker (belt-
    // and-suspenders alongside the per-tick write above); the chip's own
    // `document.hidden` early-return structurally skips its status fetch
    // entirely while hidden (asserted below via a call-count delta, robust
    // regardless of how much real time elapses).
    const statusCallsBeforeHiding = calls.status;
    setDocumentHidden(document, true);
    document.dispatchEvent(new window.Event('visibilitychange'));
    await flushMany(3);

    // The server now fully DROPS jobC (not merely marks it 'done') -- the
    // harder AC5.3 case a plain done-edge check could never catch -- while
    // this tab is still hidden and therefore never observes it happen.
    state.statusSupplier = () => ({ oneShots: { keepAlive: keepAliveJob(), jobA: { state: 'done' }, jobB: { state: 'done' } } });
    await realDelay(300);
    await flushMany(3);
    assert.strictEqual(calls.status, statusCallsBeforeHiding, 'while hidden, the chip must not have polled /api/subscriptions/status again at all');

    // Resume: visibilitychange -> visible triggers a forced catch-up poll
    // (observing jobC's server-side removal) AND the pending-marker
    // reconcile.
    setDocumentHidden(document, false);
    document.dispatchEvent(new window.Event('visibilitychange'));

    await waitUntil(() => videoTitles(document).includes('Item C (from jobC)'), {
      label: 'AC5.3: backgrounded-resume reconcile rendering jobC\'s item despite the server having dropped it',
    });

    assert.strictEqual(calls.status, statusCallsBeforeHiding + 1, 'expected the visibility-resume catch-up to have issued exactly one forced status poll');
    assert.strictEqual(calls.videos, 4, 'expected jobC (dropped from the server snapshot while hidden) to still have been surfaced via a real in-place refresh on resume (AC5.3)');
    assert.strictEqual(document.querySelectorAll('.video-card').length, 4, 'expected jobC\'s completed item to be present after the backgrounded-resume reconcile');

    let pendingAfterResume = null;
    try { pendingAfterResume = JSON.parse(window.localStorage.getItem('filetube_pending_oneshots') || '[]'); } catch (_) { /* ignore */ }
    assert.ok(Array.isArray(pendingAfterResume) && !pendingAfterResume.includes('jobC'), 'expected jobC to have been cleared from the pending marker once reconciled');
    assert.strictEqual(window.localStorage.getItem('filetube_home_dirty'), null, 'a live-target resume-refresh must never (also) mark the grid dirty');

    // ---- AC5.4: reload-never, across ALL three surfaces above -------------
    assert.deepStrictEqual(navigationErrors, [], 'window.location.reload (or any other full navigation) must NEVER be called on any of the three one-shot-visibility surfaces');
    assert.deepStrictEqual(windowErrors, [], `expected zero uncaught window errors, got: ${JSON.stringify(windowErrors)}`);
    assert.deepStrictEqual(unhandledRejections, [], `expected zero unhandled rejections, got: ${JSON.stringify(unhandledRejections)}`);
  } finally {
    dom.window.close();
  }
});
