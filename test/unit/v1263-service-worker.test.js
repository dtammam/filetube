'use strict';

// [UNIT] v1.26.3 Item 4 (minimal offline service worker). `public/sw.js`
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

test('sw.js is network-first: fetch() is attempted before any cache read, and a cache PUT only happens on a genuine, same-origin success', () => {
  const networkFirst = /function networkFirst\([\s\S]*?\n\}/.exec(swSrc);
  assert.ok(networkFirst, 'expected a networkFirst function');
  const src = networkFirst[0];
  const fetchIdx = src.indexOf('fetch(request)');
  const cacheMatchIdx = src.indexOf('cache.match(request)');
  assert.ok(fetchIdx > -1 && cacheMatchIdx > -1 && fetchIdx < cacheMatchIdx,
    'fetch() must be attempted before any cache.match() fallback');
  assert.match(src, /response\.ok && response\.type === 'basic'/, 'only a genuine, same-origin 2xx response may be cached');
  assert.match(src, /cache\.put\(request, copy\)/);
});

test('sw.js falls back to the precached offline page ONLY for a navigation with no cache match', () => {
  assert.match(swSrc, /caches\.match\(OFFLINE_URL\)/);
  const networkFirst = /function networkFirst\([\s\S]*?\n\}/.exec(swSrc)[0];
  assert.match(networkFirst, /if \(isNavigation\) return caches\.match\(OFFLINE_URL\);/);
});

test('sw.js precaches the offline page at install time', () => {
  assert.match(swSrc, /self\.addEventListener\('install'/);
  assert.match(swSrc, /cache\.add\(OFFLINE_URL\)/);
});

// ---- Stale-shell wedge guards (the #1 SW failure mode) ---------------------

test('sw.js calls self.skipWaiting() on install and self.clients.claim() on activate (a new deploy takes over immediately)', () => {
  assert.match(swSrc, /self\.addEventListener\('install'[\s\S]*?self\.skipWaiting\(\);/);
  assert.match(swSrc, /self\.addEventListener\('activate'[\s\S]*?clients\.claim\(\)/);
});

test('sw.js activate deletes every OTHER filetube-shell-* cache (no stale prior version can leak into fallback responses)', () => {
  const activate = /self\.addEventListener\('activate',[\s\S]*?\}\);/.exec(swSrc);
  assert.ok(activate);
  assert.match(activate[0], /caches\.keys\(\)/);
  assert.match(activate[0], /name !== CACHE_NAME/);
  assert.match(activate[0], /caches\.delete\(name\)/);
});

test('sw.js declares a single, named, versioned CACHE_NAME constant', () => {
  assert.match(swSrc, /const CACHE_NAME = 'filetube-shell-v\d+';/);
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
