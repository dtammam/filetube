'use strict';

// [INTEGRATION] v1.26.4 Wave 2: jsdom shell smoke test.
//
// MOTIVATION: the v1.26.0-.2 subs-page regression (a fatal cross-file
// top-level `const` collision between public/js/common.js and
// lib/ytdlp/client/subscriptions.js -- both loaded as classic `<script>`
// tags, which share ONE global lexical scope, so the SECOND `const` was a
// SyntaxError at script instantiation and the entire subscriptions.js file
// silently never ran) was invisible to every check this repo had at the
// time: ESLint and `node --check` are per-file, and every `node:test` unit
// suite `require()`s these files into isolated CommonJS module scopes (see
// each file's own `if (typeof module !== 'undefined' ...)` export guard),
// which never reproduces the shared-global-scope hazard classic `<script>`
// tags create in a real browser. test/unit/shell-script-global-collisions
// .test.js (added by the v1.26.3 hotfix) now guards the SAME-SCOPE
// compile-time hazard directly (vm.Script, compile-only, no DOM). THIS file
// complements that one from the other end: it actually LOADS each shell's
// full HTML + script set in a real (virtual) browser-shaped environment
// (jsdom) and asserts nothing throws at evaluation/load time -- catching not
// just top-level `const`/`let`/`class` collisions but ANY load-time script
// error (a bad merge, a stray syntax error that somehow passed lint, a
// runtime TypeError in code that runs unconditionally at parse/boot time),
// for whichever class of regression next slips through the narrower guards.
//
// SCOPE: this is a SMOKE test, not a behavior test. It proves each shell's
// full script set parses and boots cleanly against the REAL served files (no
// fixtures/mocks of the scripts themselves) -- not that every feature on
// every page actually works end-to-end (this repo has no jsdom coverage of
// deep interactive behavior, and Dean's on-device pass remains the
// documented arbiter for that). Keep this test fast and load-focused.
//
// jsdom version: pinned via `npm install --save-dev jsdom` -- see
// package.json/package-lock.json (currently ^29.1.1, exact version locked
// by package-lock.json per normal npm semantics, same as every other
// devDependency in this repo).
//
// STUBBING DECISIONS (jsdom provides a DOM but not a full browser platform):
//
//  - `window.fetch`: jsdom ships no `fetch` global at all (confirmed absent
//    from jsdom's Window implementation as of this pinned version), and
//    EVERY shell fires real network fetches during its boot sequence
//    (capability probes, sidebar pin loads, the view's own data fetch,
//    etc.) -- without a stub, the very first `fetch(...)` call anywhere
//    would throw `TypeError: fetch is not a function`, well before we ever
//    got to test the thing this suite actually cares about (did the SCRIPT
//    ITSELF evaluate cleanly). We stub it with a function that returns a
//    Promise that NEVER settles (never resolves, never rejects) and records
//    the requested URL in `window.__ftFetchLog`. This is deliberately the
//    simplest possible stub: every `.then()`/`await` chain built on top of
//    it simply never continues, which means we exercise every shell's
//    SYNCHRONOUS boot-time code (top-level script evaluation, every view's
//    `init()` up to its first `await`/`.then()`) without having to hand-roll
//    a realistic `/api/*` mock server -- and, as a bonus, it also sidesteps
//    an entire class of "did I mock this fetch response correctly" false
//    positives/negatives that a fuller mock would risk. The trade-off
//    (documented, deliberate): this suite cannot see errors that only
//    surface AFTER a real fetch response arrives (e.g. a bug in a
//    `.then(data => ...)` render callback) -- that is explicitly out of
//    scope; the collision-class bug this suite exists to catch happens at
//    evaluation/parse time, long before any fetch would even fire.
//  - `window.matchMedia`: jsdom does not implement it (CSS media-query
//    evaluation is out of scope for jsdom's layout-free DOM). common.js
//    feature-detects most such gaps already, but at least one code path
//    calls it unconditionally at load time (`prefersReducedMotion()`), so a
//    real function returning a static, always-`false`-`matches`
//    `MediaQueryList`-shaped object is required, or that call throws.
//  - `localStorage`/`navigator.serviceWorker`: NOT stubbed. jsdom's
//    `window.localStorage` works out of the box once a real (non-
//    `about:blank`) `url` is supplied (see the `url` option below) -- every
//    shell already wraps its own `localStorage` reads/writes in `try/catch`
//    (private-mode-safe by design) regardless. `navigator.serviceWorker` is
//    simply absent on jsdom's `navigator`, which common.js already
//    feature-detects (`'serviceWorker' in navigator`) before ever touching
//    it -- no stub needed.
//  - Images/fonts/favicons/the web app manifest: NOT fetched at all. jsdom
//    only auto-loads "usable" resources when `resources` is configured --
//    frames/iframes, `<link rel="stylesheet">`, `<script>` (with
//    `runScripts: "dangerously"`), and `<img>` (only if the optional
//    `canvas` package is installed, which this repo deliberately does not
//    install). None of the 5 shells use frames/iframes, so in practice only
//    `<script src>` and the single `<link rel="stylesheet" href="/css/
//    style.css">` per shell are ever fetched -- both are resolved to the
//    real on-disk files by the `resourceInterceptor` below. Anything else
//    requested (there shouldn't be anything, but defensively) gets a
//    synthetic 404 rather than ever reaching a real network call.
//
// EXCLUDED FROM THIS SUITE (documented, not silently skipped):
//  - Actually invoking `window.FileTube.bootRouter()`'s downstream view
//    `init()` work PAST its first network call, and any deeper interactive
//    behavior (clicks, drags, playback) -- see the `fetch` stub note above.
//    bootRouter() itself DOES run naturally (it's called unconditionally
//    from common.js's own `DOMContentLoaded` handler), so each shell's
//    matching view's `init()` genuinely executes its synchronous prefix --
//    this suite leans on exactly that to assert real, view-specific,
//    network-independent DOM signals below (never a placeholder/no-op
//    assertion).
//  - CSS behavior/rendering (jsdom has no layout engine) -- style.css is
//    loaded and parsed (proving it's not malformed) but never asserted on
//    beyond "did it parse without a jsdomError".
//
// ERROR DETECTION: three independent channels are watched for the DURATION
// of each shell's load:
//   1. `window.addEventListener('error', ...)` -- uncaught exceptions from
//      script evaluation or synchronous event-handler code.
//   2. `window.addEventListener('unhandledrejection', ...)` -- a rejected
//      Promise nothing ever handled.
//   3. `virtualConsole.on('jsdomError', ...)` -- jsdom's OWN error channel,
//      which is where a same-scope top-level `const` collision (the
//      regression class this suite exists for) actually surfaces: it's a
//      SyntaxError thrown while jsdom evaluates the `<script>` tag, reported
//      as a `jsdomError` of type `'unhandled-exception'`.
// Channels 1-2, plus `jsdomError` types `'unhandled-exception'` and
// `'resource-loading'`, are ALWAYS fatal -- never allowlisted, per this
// suite's whole reason for existing. Only `jsdomError` types
// `'not-implemented'` (jsdom's stub-behavior notices for unimplemented
// platform features -- e.g. real navigation) and `'css-parsing'` (CSS
// parser warnings) MAY be allowlisted below, and only for specific,
// individually-justified messages -- currently NONE are needed (this repo's
// 5 shells load cleanly against this pinned jsdom version with zero
// `not-implemented`/`css-parsing` noise), so the allowlist starts empty;
// left in place, and documented, for the next time jsdom's own coverage
// gaps require it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SUBSCRIPTIONS_CLIENT_JS = path.join(ROOT, 'lib', 'ytdlp', 'client', 'subscriptions.js');
const COMMON_JS_PATH = path.join(PUBLIC_DIR, 'js', 'common.js');

// jsdomError kinds/messages that are known-benign platform-coverage gaps,
// never script errors. Empty today (see the header comment) -- kept as a
// real, exercised code path (not dead code) so a future genuinely-benign
// jsdom notice has an obvious, narrow place to go, WITHOUT ever widening to
// swallow `'unhandled-exception'`/`'resource-loading'`.
const BENIGN_JSDOM_ERROR_ALLOWLIST = [
  // { kind: 'not-implemented', messageIncludes: 'something specific' },
];

function isAllowlistedJsdomError(err) {
  if (err.kind !== 'not-implemented' && err.kind !== 'css-parsing') return false;
  return BENIGN_JSDOM_ERROR_ALLOWLIST.some(
    (entry) => entry.kind === err.kind && err.message && err.message.includes(entry.messageIncludes)
  );
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

// Maps a requested pathname to the real file the running server would serve
// it from. In production, `server.js` mounts `public/` as the static root at
// `/`; the ONE exception is `/js/subscriptions.js`, which common.js lazily
// fetches from the yt-dlp module's own client bundle (see common.js's
// `ensureSubscriptionsScriptLoaded`) -- on the subscriptions shell that
// script is instead statically `<script src>`'d, so it must resolve the
// same way here.
function resolveResourcePath(pathname) {
  if (pathname === '/js/subscriptions.js') return SUBSCRIPTIONS_CLIENT_JS;
  return path.join(PUBLIC_DIR, pathname);
}

// Instrumentation appended ONLY to common.js's SERVED (in-memory) response
// body -- never written to the real file on disk. Wraps `FileTube
// .registerView` with a spy that records every view name registered (in
// call order) into `window.__ftRegisteredViews`, then calls straight through
// to the real implementation -- so real router behavior is completely
// unaffected, we just get external visibility into a call that otherwise
// happens inside each view module's own closed-over IIFE. This is the
// "strongest cheap signal" the task calls for: a view module that failed to
// even parse (the collision-class bug) can never reach its own
// `registerView(...)` call.
const REGISTER_VIEW_SPY_SNIPPET = `
;(function () {
  if (!window.FileTube || typeof window.FileTube.registerView !== 'function') return;
  var __ftOrigRegisterView = window.FileTube.registerView;
  window.__ftRegisteredViews = [];
  window.FileTube.registerView = function (name, handlers) {
    window.__ftRegisteredViews.push(name);
    return __ftOrigRegisterView.apply(this, arguments);
  };
})();
`;

// Loads one shell's HTML in jsdom with real script/stylesheet execution and
// resolves once the page has finished loading (or after a generous timeout,
// so a hung/never-settling load can never wedge the whole suite -- though
// nothing here should ever legitimately hit it, since the fetch stub never
// blocks synchronous script evaluation).
function loadShell({ htmlPath, url }) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const virtualConsole = new VirtualConsole();
  const jsdomErrors = [];
  virtualConsole.on('jsdomError', (err) => {
    jsdomErrors.push({ kind: err.type, message: err.message });
  });
  // Deliberately NOT forwarded to the real Node console -- keeps test output
  // clean; failures below print the captured detail directly via assert.

  const windowErrors = [];
  const unhandledRejections = [];

  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    resources: {
      interceptors: [
        requestInterceptor((request) => {
          const requestUrl = new URL(request.url);
          const filePath = resolveResourcePath(requestUrl.pathname);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            let body = fs.readFileSync(filePath, 'utf8');
            if (filePath === COMMON_JS_PATH) body += REGISTER_VIEW_SPY_SNIPPET;
            return new Response(body, { status: 200, headers: { 'Content-Type': contentTypeFor(filePath) } });
          }
          // Nothing outside the 5 shells' own script/stylesheet set is
          // expected to be requested (see the header comment) -- fail closed
          // with a 404 rather than ever letting a request reach a real
          // network call.
          return new Response('', { status: 404 });
        }),
      ],
    },
    beforeParse(window) {
      // See the file header comment for the full rationale on both stubs.
      window.__ftFetchLog = [];
      window.fetch = function (input) {
        window.__ftFetchLog.push(typeof input === 'string' ? input : (input && input.url));
        return new Promise(() => {}); // never settles -- see header comment
      };
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
    windowErrors.push({
      message: event.message,
      stack: event.error && event.error.stack,
    });
  });
  dom.window.addEventListener('unhandledrejection', (event) => {
    unhandledRejections.push(String(event.reason));
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ dom, jsdomErrors, windowErrors, unhandledRejections });
    };
    dom.window.addEventListener('load', () => {
      // One extra macrotask turn so any promise-chain continuations that
      // were already-resolvable (not gated on our never-settling fetch
      // stub) get a chance to run and be observed.
      setTimeout(finish, 20);
    });
    // Generous fallback so a genuinely wedged load can never hang the suite.
    setTimeout(finish, 5000);
  });
}

function assertNoLoadErrors(result, label) {
  const { jsdomErrors, windowErrors, unhandledRejections } = result;
  const fatalJsdomErrors = jsdomErrors.filter((err) => !isAllowlistedJsdomError(err));
  assert.deepStrictEqual(
    windowErrors, [],
    `${label}: expected zero uncaught window errors, got: ${JSON.stringify(windowErrors, null, 2)}`
  );
  assert.deepStrictEqual(
    unhandledRejections, [],
    `${label}: expected zero unhandled promise rejections, got: ${JSON.stringify(unhandledRejections, null, 2)}`
  );
  assert.deepStrictEqual(
    fatalJsdomErrors, [],
    `${label}: expected zero (non-allowlisted) jsdomError virtual-console entries, got: ${JSON.stringify(fatalJsdomErrors, null, 2)}`
  );
}

// ---------------------------------------------------------------------------
// index.html (home)
// ---------------------------------------------------------------------------

test('shell smoke: index.html (home) loads with zero uncaught errors and the home view registers/boots', async () => {
  const result = await loadShell({ htmlPath: path.join(PUBLIC_DIR, 'index.html'), url: 'http://localhost/' });
  try {
    assertNoLoadErrors(result, 'index.html');
    assert.ok(result.dom.window.FileTube, 'expected window.FileTube to exist');
    assert.ok(
      result.dom.window.__ftRegisteredViews.includes('home'),
      'expected main.js to have registered the "home" view'
    );
    // Strongest cheap per-shell signal: main.js's home init() synchronously
    // seeds #video-grid with skeleton placeholders (buildSkeletonGrid, v1.26.4
    // wave 1) BEFORE its own `await fetch('/api/config')` -- this proves
    // bootRouter() correctly derived 'home' for '/' and actually invoked
    // main.js's init(), not just that the script parsed.
    const videoGrid = result.dom.window.document.getElementById('video-grid');
    assert.ok(videoGrid, 'expected #video-grid to exist');
    assert.match(videoGrid.innerHTML, /skeleton-card/, 'expected loadLibrary() to have synchronously rendered skeleton cards');
  } finally {
    result.dom.window.close();
  }
});

// ---------------------------------------------------------------------------
// watch.html
// ---------------------------------------------------------------------------

test('shell smoke: watch.html loads with zero uncaught errors and the watch view registers/boots', async () => {
  // `?v=<id>` avoids watch.js's own no-id redirect-home fallback
  // (`window.location.href = '/'`), which jsdom would otherwise report as a
  // benign-but-noisy `not-implemented: navigation` jsdomError -- a real
  // watch-page deep link always carries `?v=`, so this is also the more
  // representative case to smoke-test.
  const result = await loadShell({
    htmlPath: path.join(PUBLIC_DIR, 'watch.html'),
    url: 'http://localhost/watch.html?v=shell-smoke-test-id',
  });
  try {
    assertNoLoadErrors(result, 'watch.html');
    assert.ok(result.dom.window.FileTube, 'expected window.FileTube to exist');
    assert.ok(
      result.dom.window.__ftRegisteredViews.includes('watch'),
      'expected watch.js to have registered the "watch" view'
    );
    assert.ok(
      result.dom.window.FileTube.player,
      'expected player.js to have installed window.FileTube.player'
    );
    // Strongest cheap per-shell signal: watch.js's init() synchronously
    // (before any fetch) calls setupTheatreToggle(), which builds and mounts
    // a brand-new #watch-theater-btn -- proves bootRouter() derived 'watch'
    // for this URL and actually ran watch.js's init(), not just that the
    // script parsed.
    const theaterBtn = result.dom.window.document.getElementById('watch-theater-btn');
    assert.ok(theaterBtn, 'expected watch.js\'s init() to have synchronously mounted #watch-theater-btn');
  } finally {
    result.dom.window.close();
  }
});

// ---------------------------------------------------------------------------
// stats.html
// ---------------------------------------------------------------------------

test('shell smoke: stats.html loads with zero uncaught errors and stats.js boots', async () => {
  const result = await loadShell({ htmlPath: path.join(PUBLIC_DIR, 'stats.html'), url: 'http://localhost/stats.html' });
  try {
    assertNoLoadErrors(result, 'stats.html');
    assert.ok(result.dom.window.FileTube, 'expected window.FileTube to exist');
    // stats.html is deliberately NOT one of common.js's four router routes
    // (see public/js/stats.js's own header comment) -- bootRouter() is a
    // no-op here by design, so there is no registerView signal to check.
    // stats.js self-boots on its OWN `DOMContentLoaded` listener, and its
    // entire init() is a single `fetch('/api/stats')` -- reaching that call
    // (recorded via the fetch-log stub) is the strongest cheap, network-
    // independent-to-OBSERVE signal available: it proves stats.js's script
    // evaluated and its own DOMContentLoaded handler ran without throwing.
    assert.ok(
      result.dom.window.__ftFetchLog.includes('/api/stats'),
      'expected stats.js\'s init() to have called fetch(\'/api/stats\')'
    );
  } finally {
    result.dom.window.close();
  }
});

// ---------------------------------------------------------------------------
// setup.html
// ---------------------------------------------------------------------------

test('shell smoke: setup.html loads with zero uncaught errors and the setup view registers/boots', async () => {
  const result = await loadShell({ htmlPath: path.join(PUBLIC_DIR, 'setup.html'), url: 'http://localhost/setup.html' });
  try {
    assertNoLoadErrors(result, 'setup.html');
    assert.ok(result.dom.window.FileTube, 'expected window.FileTube to exist');
    assert.ok(
      result.dom.window.__ftRegisteredViews.includes('setup'),
      'expected setup.js to have registered the "setup" view'
    );
    // Strongest cheap per-shell signal: setup.js's init() synchronously (no
    // fetch involved) calls renderThemePicker()/renderIconPicker(), which
    // populate #theme-picker/#icon-picker's innerHTML. This ALSO
    // regression-locks a real load-time bug this suite's own development
    // caught: common.js's initIconSet() (run EARLIER in the SAME
    // DOMContentLoaded handler, via its `typeof renderIconPicker ===
    // 'function'` cross-module hook) used to call renderIconPicker() BEFORE
    // setup.js's own init() had set its module-level `controller`, throwing
    // `TypeError: Cannot read properties of null (reading 'signal')` and
    // aborting the rest of common.js's DOMContentLoaded handler entirely
    // (see setup.js's own comment on renderIconPicker's `controller` guard,
    // fixed alongside this suite).
    const themePicker = result.dom.window.document.getElementById('theme-picker');
    const iconPicker = result.dom.window.document.getElementById('icon-picker');
    assert.ok(themePicker, 'expected #theme-picker to exist');
    assert.ok(iconPicker, 'expected #icon-picker to exist');
    assert.match(themePicker.innerHTML, /theme-card/, 'expected renderThemePicker() to have synchronously rendered theme cards');
    assert.match(iconPicker.innerHTML, /theme-card/, 'expected renderIconPicker() to have synchronously rendered icon-set cards');
  } finally {
    result.dom.window.close();
  }
});

// ---------------------------------------------------------------------------
// lib/ytdlp/views/subscriptions.html
// ---------------------------------------------------------------------------

test('shell smoke: lib/ytdlp/views/subscriptions.html loads with zero uncaught errors and the subscriptions view registers/boots', async () => {
  const result = await loadShell({
    htmlPath: path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html'),
    url: 'http://localhost/subscriptions',
  });
  try {
    assertNoLoadErrors(result, 'lib/ytdlp/views/subscriptions.html');
    assert.ok(result.dom.window.FileTube, 'expected window.FileTube to exist');
    // The task's own headline signal: this is the exact shell/script pair
    // (subscriptions.html + lib/ytdlp/client/subscriptions.js) the v1.26.0-.2
    // regression silently broke -- registerView('subscriptions') is
    // reachable ONLY if the entire script evaluated cleanly (a top-level
    // `const` collision with common.js would have thrown a SyntaxError long
    // before this line, exactly as it did in production).
    assert.ok(
      result.dom.window.__ftRegisteredViews.includes('subscriptions'),
      'expected lib/ytdlp/client/subscriptions.js to have registered the "subscriptions" view'
    );
    // Secondary, network-touching corroboration: initSubscriptionsView()
    // reaches loadMembersOnlySetting() (called synchronously, right after
    // kicking off loadPins()) -- a subscriptions-specific endpoint no other
    // shell's script ever requests, proving execution proceeded well past
    // the view's own DOM-query setup.
    assert.ok(
      result.dom.window.__ftFetchLog.includes('/api/subscriptions/settings'),
      'expected initSubscriptionsView() to have reached loadMembersOnlySetting()\'s fetch(\'/api/subscriptions/settings\')'
    );
  } finally {
    result.dom.window.close();
  }
});
