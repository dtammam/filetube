'use strict';

// [UNIT] v1.26.4 Item 4 (minimal offline service worker). `public/sw.js`
// runs in a genuine ServiceWorkerGlobalScope in the browser (`self`/
// `caches`/`clients`, no `window`/`document`) -- there is no lightweight way
// to execute it directly under `node:test` without a real
// ServiceWorkerContainer, so this file uses the same CSS-lock/source-lock
// pattern established by test/unit/v1262-*.test.js: it asserts the file
// exists and its SOURCE carries every safety-critical property by regex,
// which is exactly what a reviewer would otherwise eyeball by hand. This
// mirrors test/unit/subscribe-button.test.js's static-source regression
// guards used elsewhere in this suite for logic that's impractical to
// execute directly.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SW_PATH = path.join(ROOT, 'public', 'sw.js');
const OFFLINE_HTML_PATH = path.join(ROOT, 'public', 'offline.html');
const COMMON_JS_PATH = path.join(ROOT, 'public', 'js', 'common.js');
const ESLINT_CONFIG_PATH = path.join(ROOT, 'eslint.config.js');

const swSrc = fs.readFileSync(SW_PATH, 'utf8');
const offlineHtml = fs.readFileSync(OFFLINE_HTML_PATH, 'utf8');
const commonJs = fs.readFileSync(COMMON_JS_PATH, 'utf8');
const eslintConfig = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');

test('public/sw.js exists', () => {
  assert.ok(fs.existsSync(SW_PATH));
});

test('public/offline.html exists', () => {
  assert.ok(fs.existsSync(OFFLINE_HTML_PATH));
});

// ---- Never-intercept path list (the app's live data surfaces) -------------

test('sw.js never intercepts /api/, /video/, /audio/, or /thumbnail/ -- the fetch handler returns before respondWith for all four', () => {
  const neverInterceptDecl = /NEVER_INTERCEPT_PREFIXES\s*=\s*\[([^\]]*)\]/.exec(swSrc);
  assert.ok(neverInterceptDecl, 'expected a NEVER_INTERCEPT_PREFIXES array');
  for (const prefix of ['/api/', '/video/', '/audio/', '/thumbnail/']) {
    assert.match(neverInterceptDecl[1], new RegExp(`'${prefix}'`), `expected ${prefix} in NEVER_INTERCEPT_PREFIXES`);
  }
  // The fetch handler must actually consult this list BEFORE ever calling
  // event.respondWith -- a bare early `return` (no respondWith call) is what
  // lets the browser fall through to its own default (un-intercepted)
  // handling for a matching request.
  const fetchHandler = /self\.addEventListener\('fetch',[\s\S]*?\}\);/.exec(swSrc);
  assert.ok(fetchHandler);
  assert.match(fetchHandler[0], /isNeverIntercepted\(url\.pathname\)\)\s*return;/);
  const neverInterceptIdx = fetchHandler[0].indexOf('isNeverIntercepted(url.pathname)) return;');
  const respondWithIdx = fetchHandler[0].indexOf('event.respondWith(');
  assert.ok(neverInterceptIdx > -1 && respondWithIdx > -1 && neverInterceptIdx < respondWithIdx,
    'the never-intercept check must run BEFORE respondWith is ever called');
});

test('sw.js only ever handles GET -- every other method returns before respondWith', () => {
  assert.match(swSrc, /request\.method !== 'GET'\)\s*return;/);
});

test('sw.js ignores cross-origin requests (never intercepts a third-party fetch)', () => {
  assert.match(swSrc, /url\.origin !== self\.location\.origin\)\s*return;/);
});

// ---- Network-first strategy -------------------------------------------------

function extractFunctionBody(source, functionName) {
  const re = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(source);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  while (depth > 0 && i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(m.index, i);
}

const networkFirstBody = extractFunctionBody(swSrc, 'networkFirst');

test('sw.js is network-first: fetch() is attempted before any cache read, and a cache PUT only happens on a genuine, non-navigation, same-origin, non-partial success', () => {
  assert.ok(networkFirstBody, 'expected a networkFirst function');
  const src = networkFirstBody;
  const fetchIdx = src.indexOf('fetch(request)');
  const cacheMatchIdx = src.indexOf('cache.match(request)');
  assert.ok(fetchIdx > -1 && cacheMatchIdx > -1 && fetchIdx < cacheMatchIdx,
    'fetch() must be attempted before any cache.match() fallback');
  // (v1.26.4 wave-2, F6) status === 200 (not response.ok) excludes 206
  // partial-content responses from ever being cached.
  assert.match(src, /!isNavigation && response && response\.status === 200 && response\.type === 'basic'/,
    'only a genuine, NON-navigation, same-origin, full (200, not 206) response may be cached');
  assert.match(src, /cache\.put\(request, copy\)/);
});

test('sw.js (v1.26.4 wave-2, F1) threads the fetch event into networkFirst and wraps the cache write in event.waitUntil()', () => {
  assert.match(swSrc, /function networkFirst\(event, isNavigation\)/, 'expected networkFirst to take the fetch event, not just the request');
  assert.match(swSrc, /event\.respondWith\(networkFirst\(event, isNavigation\)\)/);
  const src = networkFirstBody;
  const waitUntilIdx = src.indexOf('event.waitUntil(');
  const cachePutIdx = src.indexOf('cache.put(request, copy)');
  assert.ok(waitUntilIdx > -1 && cachePutIdx > -1 && waitUntilIdx < cachePutIdx,
    'the cache.put() call must be wrapped inside an event.waitUntil(...) call');
});

test('sw.js (v1.26.4 wave-2, F2) NEVER writes a navigation to the cache -- the cache.put gate explicitly excludes isNavigation', () => {
  assert.match(networkFirstBody, /if \(!isNavigation && response/);
});

test('sw.js (v1.26.4 wave-2, F2) falls back straight to the precached offline page on a FAILED navigation -- no per-navigation cache.match at all', () => {
  const src = networkFirstBody;
  assert.match(src, /if \(isNavigation\) return caches\.match\(OFFLINE_URL\);/);
  // The failure-branch offline fallback must not first attempt a
  // cache.match(request) lookup for the navigation itself (there is nothing
  // to find -- navigations are never cached) before reaching for
  // OFFLINE_URL.
  const catchBranch = /\.catch\(\(\) => \{([\s\S]*)\}\);\n\}/.exec(src);
  assert.ok(catchBranch, 'expected a .catch(() => { ... }); failure branch in networkFirst');
  const isNavigationIdx = catchBranch[1].indexOf('if (isNavigation)');
  const cacheOpenIdx = catchBranch[1].indexOf('caches.open(CACHE_NAME)');
  assert.ok(isNavigationIdx > -1 && cacheOpenIdx > -1 && isNavigationIdx < cacheOpenIdx,
    'the isNavigation offline-fallback check must come before any caches.open()/cache.match(request) lookup');
});

test('sw.js precaches the offline page at install time, failure-swallowed so install can never wedge', () => {
  const install = /self\.addEventListener\('install',[\s\S]*?\}\);/.exec(swSrc);
  assert.ok(install);
  assert.match(install[0], /cache\.add\(OFFLINE_URL\)/);
  assert.match(install[0], /\.catch\(\(\) => \{/);
});

test('sw.js (v1.26.4 wave-2, F4) retries the offline-page precache in activate, idempotently and failure-swallowed', () => {
  const activate = /self\.addEventListener\('activate',[\s\S]*?\}\);/.exec(swSrc);
  assert.ok(activate);
  // match-then-add: an already-present entry must be left untouched (no
  // redundant re-add), and the retry itself must swallow a repeat failure
  // (activation must never wedge on this, same as install).
  assert.match(activate[0], /cache\.match\(OFFLINE_URL\)/);
  assert.match(activate[0], /cache\.add\(OFFLINE_URL\)\.catch\(\(\) => \{/);
});

// ---- Stale-shell wedge guards (the #1 SW failure mode) ---------------------

test('sw.js calls self.skipWaiting() on install and self.clients.claim() on activate (a new deploy takes over immediately)', () => {
  assert.match(swSrc, /self\.addEventListener\('install'[\s\S]*?self\.skipWaiting\(\);/);
  assert.match(swSrc, /self\.addEventListener\('activate'[\s\S]*?clients\.claim\(\)/);
});

test('sw.js activate deletes every OTHER filetube-shell-* cache, and ONLY caches with that prefix (v1.26.4 wave-2, F3: scoped, not "every cache !== CACHE_NAME")', () => {
  const activate = /self\.addEventListener\('activate',[\s\S]*?\}\);/.exec(swSrc);
  assert.ok(activate);
  assert.match(activate[0], /caches\.keys\(\)/);
  assert.match(activate[0], /name\.startsWith\('filetube-shell-'\) && name !== CACHE_NAME/);
  assert.match(activate[0], /caches\.delete\(name\)/);
  // The old, over-broad filter (bare `name !== CACHE_NAME`, deleting
  // literally every cache regardless of prefix/ownership) must be gone.
  assert.doesNotMatch(activate[0], /\.filter\(\(name\) => name !== CACHE_NAME\)/);
});

test('sw.js declares a single, named, versioned CACHE_NAME constant, currently v2 (v1.26.4 wave-2, F5: this release changes the caching policy/js assets)', () => {
  assert.match(swSrc, /const CACHE_NAME = 'filetube-shell-v\d+';/);
  assert.match(swSrc, /const CACHE_NAME = 'filetube-shell-v2';/);
});

test('sw.js header comment states the bump policy plainly: structural/key changes and orphan cleanup, not routine content updates', () => {
  assert.match(swSrc, /network-first, a version bump is needed only for STRUCTURAL changes/);
});

// ---- eslint env for service-worker globals ---------------------------------

test('eslint.config.js gives public/sw.js a service-worker global environment', () => {
  const block = /files:\s*\['public\/sw\.js'\][\s\S]*?globals:\s*\{\s*\.\.\.globals\.serviceworker\s*\}/.exec(eslintConfig);
  assert.ok(block, 'expected a dedicated eslint block for public/sw.js using globals.serviceworker');
});

// ---- Registration wiring (public/js/common.js) -----------------------------

test('common.js registers the service worker, feature-detected on navigator.serviceWorker, scope "/"', () => {
  assert.match(commonJs, /function registerServiceWorker\(/);
  assert.match(commonJs, /'serviceWorker' in navigator/, 'must feature-detect before touching navigator.serviceWorker');
  assert.match(commonJs, /navigator\.serviceWorker\.register\('\/sw\.js',\s*\{\s*scope:\s*'\/'\s*\}\)/);
});

test('common.js actually CALLS registerServiceWorker at boot (not just defines it)', () => {
  const callSites = (commonJs.match(/registerServiceWorker\(\)/g) || []).length;
  // One definition-site reference inside addEventListener('load', registerServiceWorker, ...)
  // (passed by reference, no parens) plus at least one direct call --
  // require at least one *call* (with parens) beyond the function's own
  // declaration line.
  assert.ok(callSites >= 1, 'expected at least one registerServiceWorker() call');
});

test('common.js never lets a rejected SW registration throw uncaught (a .catch is always present)', () => {
  const registerCall = /navigator\.serviceWorker\.register\('\/sw\.js'[\s\S]{0,200}/.exec(commonJs);
  assert.ok(registerCall);
  assert.match(registerCall[0], /\.catch\(/);
});

test('common.js (v1.26.4 wave-2, F7) wraps the synchronous, readyState==="complete" registerServiceWorker() call in try/catch so a synchronous throw cannot abort the rest of the DOMContentLoaded handler', () => {
  const readyStateBranch = /if \(document\.readyState === 'complete'\) \{([\s\S]*?)\} else \{/.exec(commonJs);
  assert.ok(readyStateBranch, 'expected an if/else readyState branch around the direct registerServiceWorker() call');
  const body = readyStateBranch[1];
  assert.match(body, /try \{ registerServiceWorker\(\); \} catch \(err\) \{/, 'expected the direct call wrapped in try/catch, swallowed like the .catch() rejection path');
});

// ---- offline.html: self-contained, no external dependencies ---------------

test('offline.html has no external stylesheet/script/font references -- only an inline <style> and inline <script>', () => {
  assert.doesNotMatch(offlineHtml, /<link[^>]*rel="stylesheet"/);
  assert.doesNotMatch(offlineHtml, /<script[^>]*\ssrc=/);
  assert.doesNotMatch(offlineHtml, /<link[^>]*\sas="font"/);
  assert.match(offlineHtml, /<style>/);
  assert.match(offlineHtml, /<script>/);
});

test('offline.html carries the "FileTube is offline" message and a Try again affordance', () => {
  assert.match(offlineHtml, /FileTube is offline/);
  assert.match(offlineHtml, /Is the server reachable\?/);
  assert.match(offlineHtml, /Try again/);
  assert.doesNotMatch(offlineHtml, /onclick=/, 'must wire the retry button via addEventListener, not an inline onclick attribute');
});
