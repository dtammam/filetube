'use strict';

// [UNIT] v1.24.0 "UX Round" Wave 1, T3-WIRE: wires T3's pure/DOM-builder
// library-toolbar helpers (public/js/common.js -- countItems/
// renderItemCountBadge (C2), filterByMediaType/getStoredFormatFilter/
// setStoredFormatFilter/renderFormatToggle (C3), sortItems' `release-date`
// case (C5)) into the home/folder/playlist/channel grid render
// (public/js/main.js).
//
// main.js has no jsdom/browser harness in this codebase (see
// CONTRIBUTING.md) and its render pipeline (`renderSorted`/`loadLibrary`/
// `init`) lives entirely inside a private view-module IIFE -- not exported
// for `node:test` the way its two pure helpers
// (`buildCardDownloadHref`/`buildCardDownloadFilename`) are. Mirrors
// test/unit/card-download-btn.test.js's established pattern for this exact
// situation: a structural, source-text regression lock read straight off the
// file's own source, asserting the wiring calls the RIGHT helpers with the
// RIGHT arguments in the RIGHT order, rather than a full DOM simulation. The
// pure helpers themselves are already fully unit-tested in isolation by
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

// ---- renderSorted(): format-filter applied BEFORE sort, C2/C3 controls rendered ----

test('renderSorted: filterByMediaType(currentItems, getStoredFormatFilter()) runs BEFORE sortItems -- the grid never sorts an unfiltered list', () => {
  const fnMatch = /function renderSorted\(\) \{([\s\S]*?)\n {4}\}/.exec(mainJs);
  assert.ok(fnMatch, 'expected to find renderSorted() in main.js');
  const body = fnMatch[1];

  const filterIdx = body.indexOf('filterByMediaType(currentItems, getStoredFormatFilter())');
  assert.ok(filterIdx !== -1, 'expected renderSorted to call filterByMediaType(currentItems, getStoredFormatFilter())');

  const sortMatch = /sortItems\(([^,]+),\s*currentSort\)/.exec(body);
  assert.ok(sortMatch, 'expected renderSorted to call sortItems(<filtered>, currentSort)');
  const sortIdx = body.indexOf(sortMatch[0]);

  assert.ok(filterIdx < sortIdx, 'filterByMediaType must run before sortItems, so the grid sorts an already-filtered list');
  // sortItems must consume the FILTERED result (not the raw currentItems)
  // as its first argument -- i.e. a variable, not `currentItems` itself.
  assert.notStrictEqual(sortMatch[1].trim(), 'currentItems');
});

test('renderSorted: renders the C2 item-count badge against the header, using the same filtered/sorted list the grid renders', () => {
  const fnMatch = /function renderSorted\(\) \{([\s\S]*?)\n {4}\}/.exec(mainJs);
  const body = fnMatch[1];
  assert.match(body, /renderItemCountBadge\(videosHeader,\s*items\)/);
});

test('renderSorted: mounts the C3 format toggle into .section-actions with the current mode + a re-render onChange', () => {
  const fnMatch = /function renderSorted\(\) \{([\s\S]*?)\n {4}\}/.exec(mainJs);
  const body = fnMatch[1];
  assert.match(
    body,
    /renderFormatToggle\(sectionActions,\s*getStoredFormatFilter\(\),\s*\(\)\s*=>\s*renderSorted\(\)\)/,
    'expected renderFormatToggle to be mounted with the live stored mode and an onChange that re-renders'
  );
});

test('main.js: sectionActions resolves ".section-actions" (the existing sort/shuffle/rescan actions row), not a new/duplicate container', () => {
  assert.match(mainJs, /const sectionActions = root\.querySelector\('\.section-actions'\);/);
});

test('main.js: never assigns innerHTML for the C2/C3 wiring additions (createElement/textContent-only helpers stay createElement/textContent-only)', () => {
  const fnMatch = /function renderSorted\(\) \{([\s\S]*?)\n {4}\}/.exec(mainJs);
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
