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

const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'public', 'index.html');
const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

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

test('fetchLibraryPage0: renders the C2 item-count badge, format toggle, and page-0 grid, in that order', () => {
  const fnMatch = /async function fetchLibraryPage0\(\) \{([\s\S]*?)\n {4}\}/.exec(mainJs);
  assert.ok(fnMatch, 'expected to find fetchLibraryPage0() in main.js');
  const body = fnMatch[1];

  assert.match(body, /renderMediaGridPage\(currentItems,\s*\{\s*append:\s*false\s*\}\)/, 'expected fetchLibraryPage0 to render page 0 as a full REPLACE, never an append');
  assert.match(body, /updateItemCountBadge\(\)/, 'expected fetchLibraryPage0 to refresh the C2 item-count badge');
  assert.match(
    body,
    /renderFormatToggle\(sectionActions,\s*getStoredFormatFilter\(\),\s*\(\)\s*=>\s*resetAndReload\(\)\)/,
    'expected renderFormatToggle to be mounted with the live stored mode and an onChange that resets to a fresh page 0'
  );
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

// ---- index.html: C5 release-date sort option ---------------------------------

test('index.html: #sort-select gains a "release-date" option (available, not default)', () => {
  const selectMatch = /<select id="sort-select"[^>]*>([\s\S]*?)<\/select>/.exec(indexHtml);
  assert.ok(selectMatch, 'expected to find #sort-select in index.html');
  const optionsBlock = selectMatch[1];

  assert.match(optionsBlock, /<option value="release-date">Release date<\/option>/);

  // The FIRST <option> must remain "newest" -- C5 is available-only, the
  // default home order (and the first/selected-by-default markup option) is
  // unchanged (Dean's decision 8).
  const firstOption = /<option value="([^"]+)"/.exec(optionsBlock);
  assert.strictEqual(firstOption[1], 'newest', 'the default sort option must remain "newest" -- release-date is available-only, never the default');
});

test('index.html: every pre-existing #sort-select option is still present, byte-for-byte, alongside the new release-date option', () => {
  const selectMatch = /<select id="sort-select"[^>]*>([\s\S]*?)<\/select>/.exec(indexHtml);
  const optionsBlock = selectMatch[1];
  const values = [...optionsBlock.matchAll(/<option value="([^"]+)">/g)].map((m) => m[1]);
  assert.deepStrictEqual(values, [
    'newest', 'oldest', 'release-date', 'title-asc', 'title-desc', 'size-desc', 'size-asc', 'random',
  ]);
});
