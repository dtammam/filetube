'use strict';

// [UNIT] v1.24.0 "UX Round" Wave 1, T3-WIRE: wires T3's pure/DOM-builder
// library-toolbar helpers (public/js/common.js -- countItems/
// renderItemCountBadge (C2), filterByMediaType/getStoredFormatFilter/
// setStoredFormatFilter/renderFormatToggle (C3), sortItems' `release-date`
// case (C5)) into the home/folder/playlist/channel grid render
// (public/js/main.js).
//
// v1.30.0 T7 (A5) UPDATE: the local `renderSorted()` pipeline this file
// originally locked (`filterByMediaType(currentItems, ...)` +
// `sortItems(filtered, currentSort)`, run against the client's OWN
// already-fetched `currentItems`) is GONE by design -- `GET /api/videos` is
// now paginated and SERVER-authoritative for sort/filter (see T6), so
// main.js sends `sort`/`format` as query params instead of re-deriving them
// locally. The equivalent "page 0 reset" entry point is now
// `fetchLibraryPage0()` (query-building in `buildVideosApiUrl()`); the C2/C3
// wiring itself (item-count badge, format toggle) is otherwise unchanged in
// spirit, just re-pointed at the new functions/params below.
//
// main.js has no jsdom/browser harness for MOST of its surface in this
// codebase (see CONTRIBUTING.md) and its render pipeline lives entirely
// inside a private view-module IIFE -- not exported for `node:test` the way
// its two pure helpers (`buildCardDownloadHref`/`buildCardDownloadFilename`)
// are. Mirrors test/unit/card-download-btn.test.js's established pattern for
// this exact situation: a structural, source-text regression lock read
// straight off the file's own source, asserting the wiring calls the RIGHT
// helpers with the RIGHT arguments in the RIGHT order, rather than a full DOM
// simulation. (T7 ALSO added a real interactive jsdom harness for the
// pagination behavior itself -- see
// test/integration/library-pagination.test.js -- this file stays a static
// scan, focused narrowly on the C2/C3 wiring.) The pure helpers themselves
// are already fully unit-tested in isolation by
// test/unit/library-toolbar.test.js (C2/C3) and test/unit/quickwins-sort.test.js
// (C5) -- this file only locks the WIRING, not the helpers' own behavior.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MAIN_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'main.js');
const mainJs = fs.readFileSync(MAIN_JS_PATH, 'utf8');


// ---- fetchLibraryPage0()/buildVideosApiUrl(): server-authoritative sort/format, C2/C3 controls rendered ----

test('buildVideosApiUrl: sends sort/format to the SERVER as query params -- no local re-derivation of either', () => {
  const fnMatch = /function buildVideosApiUrl\(offset\) \{([\s\S]*?)\n {4}\}/.exec(mainJs);
  assert.ok(fnMatch, 'expected to find buildVideosApiUrl() in main.js');
  const body = fnMatch[1];
  assert.match(body, /sort=\$\{encodeURIComponent\(currentSort\)\}/, 'expected the sort param to be forwarded to the server');
  assert.match(body, /format=\$\{encodeURIComponent\(getStoredFormatFilter\(\)\)\}/, 'expected the format param to be forwarded to the server');
  assert.match(body, /limit=\$\{HOME_PAGE_LIMIT\}/, 'expected an explicit limit param (never relying on the server default)');
  assert.match(body, /offset=\$\{offset\}/);
  assert.match(body, /seed=\$\{currentSeed\}/);
});

test('main.js: the OLD local filterByMediaType(currentItems, ...)/sortItems(filtered, currentSort) pipeline is GONE -- the server is now authoritative (A5)', () => {
  assert.doesNotMatch(
    mainJs, /filterByMediaType\(currentItems/,
    'the client must no longer locally filter currentItems by format -- GET /api/videos\'s format param is authoritative'
  );
  assert.doesNotMatch(
    mainJs, /sortItems\(filtered,\s*currentSort\)/,
    'the client must no longer locally sort a filtered copy of currentItems -- GET /api/videos\'s sort param is authoritative'
  );
});

test('fetchLibraryPage0: renders the C2 item-count badge, the chip row (guarded twin), and the page-0 grid', () => {
  const fnMatch = /async function fetchLibraryPage0\(\) \{([\s\S]*?)\n {4}\}/.exec(mainJs);
  assert.ok(fnMatch, 'expected to find fetchLibraryPage0() in main.js');
  const body = fnMatch[1];

  assert.match(body, /renderMediaGridPage\(currentItems,\s*\{\s*append:\s*false\s*\}\)/, 'expected fetchLibraryPage0 to render page 0 as a full REPLACE, never an append');
  assert.match(body, /updateItemCountBadge\(\)/, 'expected fetchLibraryPage0 to refresh the C2 item-count badge');
  // UI pass sweep S2 (F19): the format + watch filters are dimensions of the ONE
  // chip row (mountLibraryChips) - its guarded twin mount lives here.
  assert.match(body, /ensureLibraryChips\(\);/, 'expected the guarded chip row twin mount');
});

test('updateItemCountBadge: renders the C2 item-count badge using the SERVER-authoritative currentTotal, not just the rendered page', () => {
  const fnMatch = /function updateItemCountBadge\(\) \{([\s\S]*?)\n {4}\}/.exec(mainJs);
  assert.ok(fnMatch, 'expected to find updateItemCountBadge() in main.js');
  const body = fnMatch[1];
  assert.match(
    body,
    /renderItemCountBadge\(videosHeader,\s*new Array\(Math\.max\(0,\s*currentTotal\)\)\)/,
    'expected the badge to reflect currentTotal (the full server-side filtered count under pagination), not the current page size'
  );
});

test('main.js: sectionActions resolves ".section-actions" (the existing sort/shuffle/rescan actions row), not a new/duplicate container', () => {
  assert.match(mainJs, /const sectionActions = root\.querySelector\('\.section-actions'\);/);
});

test('main.js: fetchLibraryPage0 never assigns innerHTML directly for the C2/C3 wiring additions (createElement/textContent-only helpers stay createElement/textContent-only)', () => {
  const fnMatch = /async function fetchLibraryPage0\(\) \{([\s\S]*?)\n {4}\}/.exec(mainJs);
  const body = fnMatch[1];
  assert.doesNotMatch(body, /\.innerHTML\s*=/);
});

// ---- v1.50 T3: watched-state toggle wiring ---------------------------------

test('buildVideosApiUrl: forwards the watched-state filter to the server (pagination makes a client-side filter wrong)', () => {
  const fnMatch = /function buildVideosApiUrl\(offset\) \{([\s\S]*?)\n {4}\}/.exec(mainJs);
  const body = fnMatch[1];
  assert.match(body, /watch=\$\{encodeURIComponent\(getStoredWatchFilter\(\)\)\}/, 'expected the watch param to be forwarded to the server');
});

// UI pass sweep S2 (F19; converts the v1.50 watch-toggle mount + container-
// scoped de-dupe locks, AC12): the chip row persists each dimension through the
// SAME storage helpers and reloads ONCE per tap; its host is view-scoped (a
// root.querySelector, never a document-wide lookup - the doubled-row class).
test('mountLibraryChips: format + watch persist through their storage helpers and a tap resets to a fresh page 0, once', () => {
  const body = mainJs.slice(mainJs.indexOf('function mountLibraryChips() {'), mainJs.indexOf('function updateShuffleButtonVisibility() {'));
  assert.match(body, /groups\.push\(\{ key: 'format', value: getStoredFormatFilter\(\), all: 'both'/, 'format: the live stored mode');
  assert.match(body, /groups\.push\(\{ key: 'watch', value: getStoredWatchFilter\(\), all: 'all'/, 'watch: the live stored mode');
  assert.match(body, /if \('format' in changes\) setStoredFormatFilter\(changes\.format\);/);
  assert.match(body, /if \('watch' in changes\) setStoredWatchFilter\(changes\.watch\);/);
  assert.strictEqual((body.match(/resetAndReload\(\)/g) || []).length, 1, 'one reload per tap');
  assert.match(body, /chipHost\.replaceChildren\(row\)/, 'the row replaces its host content - never a second row');
  assert.match(mainJs, /const chipHost = root\.querySelector\('#library-chip-host'\)/, 'the host is scoped to this view root');
});

test('common.js: the count badge de-dupes via a container-scoped lookup, never document.getElementById (the doubled-row bug class)', () => {
  const commonJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
  const badgeMatch = /function renderItemCountBadge\(headerEl[\s\S]*?\n\}/.exec(commonJs);
  assert.ok(badgeMatch, 'expected to find renderItemCountBadge in common.js');
  assert.match(badgeMatch[0], /headerEl\.parentNode\.querySelector\('#library-item-count'\)/);
  assert.doesNotMatch(badgeMatch[0], /document\.getElementById/);
  const row = /function buildFilterChipRow\([\s\S]*?\n\}/.exec(commonJs);
  assert.ok(row && !/document\.getElementById/.test(row[0]), 'the chip row builder never looks anything up document-wide');
});

test('style.css (sweep S2, converts the v1.50 two-row mobile lock): on a phone the toolbar is ONE full-width row that never wraps', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  const { cssRules } = require('../helpers/stylesheets');
  const mobile = cssRules(css).filter((r) => r.sel === '.section-actions' && /max-width:\s*768px/.test(r.at));
  assert.ok(mobile.length >= 1, 'the phone .section-actions rule exists');
  for (const r of mobile) {
    assert.match(r.body, /width:\s*100%/, 'row 2 is the full width');
    assert.doesNotMatch(r.body, /flex-wrap:\s*wrap/, 'never a second toolbar row');
  }
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.watch-toggle|\.format-toggle/, 'the segmented-toggle recipe is gone');
});

// ---- index.html: C5 release-date sort option ---------------------------------

// UI pass sweep S2: the sort control is a ui-btn icon that opens a ui.menu of
// main.js's SORT_MENU_OPTIONS (the options moved from index.html's <ul> into
// the view); the C5 option lock follows them there.
const sortOptions = () => {
  const block = /const SORT_MENU_OPTIONS = \[([\s\S]*?)\];/.exec(mainJs);
  assert.ok(block, 'expected SORT_MENU_OPTIONS in main.js');
  return [...block[1].matchAll(/\{ value: '([^']+)', label: '([^']+)' \}/g)].map((m) => [m[1], m[2]]);
};

test('the sort menu offers a "release-date" option (available, not first)', () => {
  const opts = sortOptions();
  assert.ok(opts.some(([v, l]) => v === 'release-date' && l === 'Release date'));
  assert.strictEqual(opts[0][0], 'newest', 'the first option remains "newest"');
});

test('every sort option is still present in the sort menu, and the menu checks the current sort', () => {
  assert.deepStrictEqual(sortOptions().map((o) => o[0]), [
    'newest', 'oldest', 'release-date', 'title-asc', 'title-desc', 'size-desc', 'size-asc', 'random',
  ]);
  assert.match(mainJs, /items: SORT_MENU_OPTIONS\.map\(\(o\) => \(\{ label: o\.label, value: o\.value, checked: o\.value === currentSort \}\)\)/);
  assert.match(mainJs, /onSelect: \(value\) => chooseSort\(value\)/);
});
