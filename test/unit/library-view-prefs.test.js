'use strict';

// [UNIT] v1.45.6 — library view preferences: per-page sort (#1) + card/list
// view mode (#2). Pure/persistence helpers in common.js; DOM wiring in main.js
// is source-locked (no browser harness — Dean's on-device pass is the arbiter
// for the actual reflow/rendering).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  pageSortKey,
  getStoredViewMode, setStoredViewMode,
  isPerPageSortEnabled, setPerPageSortEnabled, getPerPageSort, setPerPageSort,
} = require('../../public/js/common.js');

// An in-memory localStorage stub (the helpers read `localStorage` at call time,
// so installing it on `global` before the call is enough; without it they hit
// the try/catch and return defaults — which the default-value tests exercise).
function installStubStorage() {
  const m = new Map();
  global.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
  return m;
}

// ---- pageSortKey (pure) ----------------------------------------------------

test('pageSortKey: a folder (root) → root:<folder>', () => {
  assert.strictEqual(pageSortKey({ root: 'Movies' }), 'root:Movies');
});

test('pageSortKey: liked → liked; base home (no scope) → home', () => {
  assert.strictEqual(pageSortKey({ liked: true }), 'liked');
  assert.strictEqual(pageSortKey({}), 'home');
  assert.strictEqual(pageSortKey(), 'home');
});

test('pageSortKey: root wins over liked; the root: prefix stops a folder named "home"/"liked" colliding', () => {
  assert.strictEqual(pageSortKey({ root: 'X', liked: true }), 'root:X');
  assert.strictEqual(pageSortKey({ root: 'home' }), 'root:home');
  assert.strictEqual(pageSortKey({ root: 'liked' }), 'root:liked');
});

// ---- view mode (localStorage) ----------------------------------------------

test('getStoredViewMode: defaults to card (no storage) and normalizes garbage to card', () => {
  delete global.localStorage; // no storage at all
  assert.strictEqual(getStoredViewMode(), 'card');
  installStubStorage();
  assert.strictEqual(getStoredViewMode(), 'card', 'empty storage → card');
  global.localStorage.setItem('ft-view-mode', 'nonsense');
  assert.strictEqual(getStoredViewMode(), 'card', 'a bad stored value → card');
});

test('setStoredViewMode: round-trips card/list and normalizes a bad set to card', () => {
  installStubStorage();
  assert.strictEqual(setStoredViewMode('list'), 'list');
  assert.strictEqual(getStoredViewMode(), 'list');
  assert.strictEqual(setStoredViewMode('card'), 'card');
  assert.strictEqual(getStoredViewMode(), 'card');
  assert.strictEqual(setStoredViewMode('garbage'), 'card', 'a bad mode normalizes to card');
});

// ---- per-page sort (localStorage) ------------------------------------------

test('per-page sort flag: default off, round-trips on/off', () => {
  installStubStorage();
  assert.strictEqual(isPerPageSortEnabled(), false);
  setPerPageSortEnabled(true);
  assert.strictEqual(isPerPageSortEnabled(), true);
  setPerPageSortEnabled(false);
  assert.strictEqual(isPerPageSortEnabled(), false);
});

test('per-page sort map: independent value per key; unset → null', () => {
  installStubStorage();
  assert.strictEqual(getPerPageSort('root:A'), null);
  setPerPageSort('root:A', 'title-asc');
  setPerPageSort('home', 'newest');
  assert.strictEqual(getPerPageSort('root:A'), 'title-asc');
  assert.strictEqual(getPerPageSort('home'), 'newest');
  assert.strictEqual(getPerPageSort('root:B'), null, 'each page independent');
});

test('per-page sort map: a __proto__ key is never written (no prototype pollution)', () => {
  installStubStorage();
  setPerPageSort('__proto__', 'title-asc');
  assert.strictEqual(getPerPageSort('__proto__'), null, 'write skipped for the reserved key');
  assert.strictEqual({}.title, undefined, 'prototype untouched');
});

test('per-page sort map: a corrupt stored map falls back to null, never throws', () => {
  installStubStorage();
  global.localStorage.setItem('ft-sort-by-page', '{not valid json');
  assert.strictEqual(getPerPageSort('home'), null);
});

// ---- source-locks: the DOM wiring (no browser harness) ---------------------

const MAIN = fs.readFileSync(path.join(__dirname, '../../public/js/main.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
const SETUP_HTML = fs.readFileSync(path.join(__dirname, '../../public/setup.html'), 'utf8');

test('SOURCE-LOCK (#2): the view toggle applies .list-view to #video-grid, persists, and the CSS + button + glyphs exist', () => {
  assert.match(MAIN, /videoGrid\.classList\.toggle\('list-view'/, 'applies the list-view class to the persistent grid');
  assert.match(MAIN, /setStoredViewMode\(next\)/, 'persists the mode on toggle');
  assert.match(HTML, /id="view-mode-btn"/, 'the toggle button is in the bar');
  assert.match(CSS, /\.video-grid\.list-view\b/, 'the list-view reflow CSS exists');
  assert.match(CSS, /\.icon-grid \{[^}]*grid_view\.svg/, 'grid glyph registered');
  assert.match(CSS, /\.icon-list \{[^}]*view_list\.svg/, 'list glyph registered');
});

test('SOURCE-LOCK v1.160 (#7): the MODERN home injects a card/list toggle driving the SAME ft-view-mode', () => {
  // The classic #view-mode-btn lives in .section-actions, which modern mode
  // hides; modern home needs its own control (Dean). It must drive the SAME
  // key/helpers so a change in Downloads and a change here are one setting.
  assert.match(MAIN, /function injectModernViewToggle\(/, 'a modern view toggle is defined');
  assert.match(MAIN, /injectModernViewToggle\(sig\)/, 'and injected in renderModernHome');
  const fn = MAIN.slice(MAIN.indexOf('function injectModernViewToggle('));
  const body = fn.slice(0, fn.indexOf('\n        }\n'));
  assert.match(body, /getStoredViewMode\(\)/, 'reads the shared view-mode key');
  assert.match(body, /setStoredViewMode\(next\)/, 'persists to the SAME key');
  assert.match(body, /applyViewMode\(next\)/, 'applies via the SAME reflow path');
  assert.match(body, /modern-view-toggle/, 'a distinct class for placement + cleanup');
  // cleaned up on destroy like the modern sort (no orphan in the persistent shell)
  assert.match(body, /\.modern-view-toggle'\)/, 'removed on the abort/destroy path');
});

test('SOURCE-LOCK (#1): per-page sort reads/writes by pageSortKey only when enabled, and pins over defaultSort', () => {
  assert.match(MAIN, /perPageSortActive = isPerPageSortEnabled\(\)/, 'reads the flag');
  assert.match(MAIN, /getPerPageSort\(sortPageKeyValue\)/, "reads this page's stored sort");
  assert.match(MAIN, /if \(perPageSortActive\) setPerPageSort\(sortPageKeyValue, currentSort\)/, "writes this page's sort when enabled");
  assert.match(MAIN, /!storedSortPick && !sortPinnedByPage/, 'a pinned page sort outranks the server defaultSort');
  assert.match(SETUP_HTML, /id="per-page-sort-check"/, 'the Settings toggle exists');
});
