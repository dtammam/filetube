'use strict';

// [INTEGRATION] v1.30.0 T3 (v1.30 Scale Performance + Polish Wave, A2) --
// the rescan button's client-side flow now consumes T2's `POST /api/scan`
// 202-ack + `GET /api/scan-status` contract instead of awaiting the whole
// scan and hard-reloading the page. Covers AC2.3 (the headline, reload-never
// contract generalized from the v1.29 BUG-2 fix to scan completion):
//
//   - POST /api/scan -> 202 -> the handler polls GET /api/scan-status (never
//     redirects/reloads) until `scanning` flips false, then invokes the
//     in-place refresh hook (`window.__filetubeRefreshLibrary`) exactly
//     once -- not once per poll tick.
//   - `alreadyInProgress: true` still lands in the SAME poll-then-refresh
//     path (no distinct error/redirect branch).
//   - A network failure / non-2xx on the initial POST still alerts and
//     resets the button, and never reloads either.
//   - `window.location.reload` (and any other full navigation) is asserted
//     to be called ZERO times across every scenario above (see
//     `loadIndexWithFetchStub`'s own comment for how this is observed
//     against a REAL jsdom `window.location`, which cannot be spied on by
//     simple property override).
//
// HARNESS: this repo's one real (non-fake-DOM) interactive jsdom harness is
// test/integration/shell-smoke.test.js's `loadShell()` -- it boots a real
// shell HTML document (script tags executed for real via jsdom's
// `runScripts: 'dangerously'`, static files served from disk through a
// `resources.interceptors` request interceptor) and proves `main.js`'s home
// `init()` genuinely ran. This suite reuses that EXACT loading shape (own
// copy, per this repo's existing convention of small per-file harness
// duplication rather than a shared cross-file test helper -- see e.g. the
// `FakeElement`/`makeFakeDocument()` pair duplicated across
// test/unit/oneoff-modal-teardown.test.js, oneoff-modal-mobile-polish.test.js,
// and oneoff-minimize-chip-refresh.test.js), but swaps shell-smoke's
// never-resolving `fetch` stub for a CONTROLLABLE one that answers
// `POST /api/scan` and `GET /api/scan-status` with per-test scripted
// responses (every other endpoint -- /api/config, /api/videos,
// /api/settings, /api/subscriptions/pins -- stays never-resolving: this
// suite only cares about the rescan flow, not the initial library render).
//
// No Express app / DATA_DIR is booted here -- like shell-smoke.test.js, this
// is a pure static-file + jsdom test.

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

// Builds a `window.fetch` stub that answers `POST /api/scan` and
// `GET /api/scan-status` from per-test scripted responses, recording every
// call (url + method) into `log` for assertions, and leaves every other
// endpoint on a never-resolving Promise (mirrors shell-smoke.test.js's own
// stub rationale: this suite never needs those responses to arrive).
function makeScanFetchStub({ postScanResponse, scanStatusResponses }) {
  const log = [];
  let scanStatusCallCount = 0;
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    log.push({ url, method });
    if (url === '/api/scan' && method === 'POST') {
      return Promise.resolve(postScanResponse());
    }
    if (url === '/api/scan-status' && method === 'GET') {
      const idx = Math.min(scanStatusCallCount, scanStatusResponses.length - 1);
      scanStatusCallCount += 1;
      const body = scanStatusResponses[idx];
      return Promise.resolve({ ok: true, status: 200, json: async () => body });
    }
    return new Promise(() => {}); // never settles -- irrelevant to this suite
  };
  return { fetchImpl, log, getScanStatusCallCount: () => scanStatusCallCount };
}

// Loads the real index.html shell with its full real script set executed,
// wiring the given controllable fetch stub instead of shell-smoke's
// never-resolving one. Resolves once the page's 'load' event fires (plus one
// settle tick), by which point main.js's home `init()` has synchronously
// registered the rescan click listener (see main.js's own header comment:
// the listener is wired well before `loadLibrary()`'s fetches ever resolve).
// `window.location.reload` is a [LegacyUnforgeable] Location member (per the
// HTML living standard -- a deliberate anti-frame-spoofing lockdown Location
// objects apply that ordinary WebIDL interfaces don't), so jsdom implements
// it as a non-configurable OWN property: `Object.defineProperty(window
// .location, 'reload', ...)` throws `TypeError: Cannot redefine property`,
// meaning a direct override-and-count spy (the technique used elsewhere in
// this repo, e.g. test/unit/oneoff-minimize-chip-refresh.test.js's plain
// `{ location: { reload: () => {...} } }` stub object) is not available
// against a REAL jsdom `window.location`. jsdom instead surfaces an ACTUALLY
// invoked `reload()` (it has no real navigation to perform) as a
// `not-implemented: navigation` `jsdomError` on the `VirtualConsole` -- the
// exact same channel test/integration/shell-smoke.test.js already uses for
// its own error-detection. That channel is this suite's reload spy: zero
// `not-implemented: navigation` jsdomErrors across a full rescan flow is the
// behavioral proof AC2.3 asks for.
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

function realDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('rescan: POST /api/scan 202 -> polls /api/scan-status until done -> refreshes in place, NEVER window.location.reload (AC2.3)', async () => {
  const { fetchImpl, log } = makeScanFetchStub({
    postScanResponse: () => ({ ok: true, status: 202, json: async () => ({ scanning: true, alreadyInProgress: false }) }),
    scanStatusResponses: [
      { scanning: true, processed: 10, total: 100, phase: 'scanning' },
      { scanning: true, processed: 60, total: 100, phase: 'scanning' },
      { scanning: false, processed: 100, total: 100, phase: 'idle' },
    ],
  });

  const { dom, windowErrors, unhandledRejections, navigationErrors } = await loadIndexWithFetchStub(fetchImpl);
  try {
    const { document, window } = dom.window;
    let refreshCalls = 0;
    window.__filetubeRefreshLibrary = () => { refreshCalls += 1; };

    const rescanBtn = document.getElementById('rescan-library-btn');
    assert.ok(rescanBtn, 'expected #rescan-library-btn to exist');

    rescanBtn.click();
    await flush();
    assert.match(rescanBtn.innerHTML, /Scanning\.\.\./, 'expected the button to show its scanning state immediately');
    assert.strictEqual(rescanBtn.disabled, true);

    // Two "still scanning" ticks, ~1s cadence each (mirrors setup.js's
    // pollAutomationScanStatus()), then the third tick reports done.
    await realDelay(1100);
    await flush();
    await realDelay(1100);
    await flush();

    assert.strictEqual(refreshCalls, 1, 'expected the in-place refresh hook to have fired exactly once');
    assert.deepStrictEqual(navigationErrors, [], 'window.location.reload (or any other full navigation) must NEVER be called on the scan-completion path');
    assert.match(rescanBtn.innerHTML, /Rescan<\/span>/, 'expected the button to return to its resting "Rescan" label');
    assert.strictEqual(rescanBtn.disabled, false);

    const scanStatusCalls = log.filter((c) => c.url === '/api/scan-status');
    assert.strictEqual(scanStatusCalls.length, 3, 'expected exactly 3 scan-status polls (2 scanning + 1 done)');

    assert.deepStrictEqual(windowErrors, [], `expected zero uncaught window errors, got: ${JSON.stringify(windowErrors)}`);
    assert.deepStrictEqual(unhandledRejections, [], `expected zero unhandled rejections, got: ${JSON.stringify(unhandledRejections)}`);
  } finally {
    dom.window.close();
  }
});

test('rescan: alreadyInProgress:true still lands in the poll-then-refresh path (no error branch, no reload)', async () => {
  const { fetchImpl, log } = makeScanFetchStub({
    postScanResponse: () => ({ ok: true, status: 202, json: async () => ({ scanning: true, alreadyInProgress: true }) }),
    scanStatusResponses: [
      { scanning: false, processed: 100, total: 100, phase: 'idle' },
    ],
  });

  const { dom, navigationErrors } = await loadIndexWithFetchStub(fetchImpl);
  try {
    const { document, window } = dom.window;
    let refreshCalls = 0;
    window.__filetubeRefreshLibrary = () => { refreshCalls += 1; };

    const rescanBtn = document.getElementById('rescan-library-btn');
    rescanBtn.click();
    await flush();
    await flush(); // let the immediate first scan-status poll resolve

    assert.strictEqual(refreshCalls, 1, 'expected the in-place refresh hook to have fired for the already-in-progress scan too');
    assert.deepStrictEqual(navigationErrors, []);
    assert.strictEqual(rescanBtn.disabled, false);
    assert.match(rescanBtn.innerHTML, /Rescan<\/span>/);

    const scanPostCalls = log.filter((c) => c.url === '/api/scan' && c.method === 'POST');
    assert.strictEqual(scanPostCalls.length, 1);
  } finally {
    dom.window.close();
  }
});

test('rescan: a non-2xx POST /api/scan alerts and resets the button, and never reloads', async () => {
  const { fetchImpl } = makeScanFetchStub({
    postScanResponse: () => ({ ok: false, status: 500, json: async () => ({ error: 'scan failed to start' }) }),
    scanStatusResponses: [{ scanning: false }],
  });

  const { dom, navigationErrors } = await loadIndexWithFetchStub(fetchImpl);
  try {
    const { document, window } = dom.window;
    let refreshCalls = 0;
    window.__filetubeRefreshLibrary = () => { refreshCalls += 1; };

    const alerts = [];
    window.alert = (msg) => alerts.push(msg);

    const rescanBtn = document.getElementById('rescan-library-btn');
    rescanBtn.click();
    await flush();
    await flush();

    assert.strictEqual(alerts.length, 1, 'expected exactly one alert on a non-2xx POST');
    assert.match(alerts[0], /scan failed to start/);
    assert.strictEqual(rescanBtn.disabled, false, 'expected the button to be re-enabled after the error');
    assert.match(rescanBtn.innerHTML, /Rescan<\/span>/, 'expected the button label reset to "Rescan"');
    assert.strictEqual(refreshCalls, 0, 'the in-place refresh hook must never fire on the error path');
    assert.deepStrictEqual(navigationErrors, [], 'window.location.reload must never be called on the error path either');
  } finally {
    dom.window.close();
  }
});

test('rescan: a network-level failure on POST /api/scan alerts and resets the button, and never reloads', async () => {
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    if (url === '/api/scan' && method === 'POST') return Promise.reject(new Error('network down'));
    return new Promise(() => {});
  };

  const { dom, navigationErrors } = await loadIndexWithFetchStub(fetchImpl);
  try {
    const { document, window } = dom.window;
    let refreshCalls = 0;
    window.__filetubeRefreshLibrary = () => { refreshCalls += 1; };

    const alerts = [];
    window.alert = (msg) => alerts.push(msg);
    // main.js's catch block also does `console.error(err)` -- keep the test
    // output clean without hiding a genuinely unexpected second error.
    const originalConsoleError = window.console.error;
    window.console.error = () => {};

    const rescanBtn = document.getElementById('rescan-library-btn');
    rescanBtn.click();
    await flush();
    await flush();

    assert.strictEqual(alerts.length, 1);
    assert.match(alerts[0], /Network error/);
    assert.strictEqual(rescanBtn.disabled, false);
    assert.match(rescanBtn.innerHTML, /Rescan<\/span>/);
    assert.strictEqual(refreshCalls, 0);
    assert.deepStrictEqual(navigationErrors, []);

    window.console.error = originalConsoleError;
  } finally {
    dom.window.close();
  }
});
