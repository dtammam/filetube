'use strict';

// [UNIT] v1.84 T3 - the bare-home layout PRECEDENCE (modern > feed > classic)
// and the chip resolver, both pure + exported from common.js so the decision is
// bound here rather than only asserted by reading main.js's gate. Plus a source-
// lock that the CLIENT chip list equals the SERVER's MODERN_GRID_FILTERS, so the
// two halves cannot drift (a divergent list would 404-free but silently mis-map
// a chip to 'all').

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveHomeLayout, resolveModernChip, MODERN_CHIP_FILTERS, MODERN_SORT_OPTIONS, resolveModernSort } = require('../../public/js/common.js');
const { MODERN_GRID_FILTERS, MODERN_GRID_SORTS } = require('../../lib/home/feed.js');
const MAIN = fs.readFileSync(path.join(__dirname, '../../public/js/main.js'), 'utf8');

test('resolveHomeLayout: precedence modern > feed > classic', () => {
  assert.strictEqual(resolveHomeLayout({ bareHome: true, forceGrid: false, modern: true, feed: true }), 'modern', 'both on -> modern wins');
  assert.strictEqual(resolveHomeLayout({ bareHome: true, forceGrid: false, modern: true, feed: false }), 'modern');
  assert.strictEqual(resolveHomeLayout({ bareHome: true, forceGrid: false, modern: false, feed: true }), 'feed');
  assert.strictEqual(resolveHomeLayout({ bareHome: true, forceGrid: false, modern: false, feed: false }), 'classic');
});

test('resolveHomeLayout: only a bare, non-force-gridded home can be modern/feed', () => {
  // A drilled-in view (folder/search/liked/subs) -> bareHome false -> classic,
  // even with modern on (the modern grid is the LANDING only).
  assert.strictEqual(resolveHomeLayout({ bareHome: false, forceGrid: false, modern: true, feed: true }), 'classic');
  // ?browse=1 forces the classic grid (the Recently-added See-all escape).
  assert.strictEqual(resolveHomeLayout({ bareHome: true, forceGrid: true, modern: true, feed: true }), 'classic');
  // Missing opts default to classic (never throw).
  assert.strictEqual(resolveHomeLayout(), 'classic');
  assert.strictEqual(resolveHomeLayout({}), 'classic');
});

test('resolveModernChip: known chips pass; unknown/absent -> all', () => {
  for (const f of MODERN_CHIP_FILTERS) assert.strictEqual(resolveModernChip(f), f);
  assert.strictEqual(resolveModernChip('bogus'), 'all');
  assert.strictEqual(resolveModernChip(undefined), 'all');
  assert.strictEqual(resolveModernChip('ALL'), 'all', 'case-exact');
});

test('source-lock: the client chip list EQUALS the server MODERN_GRID_FILTERS', () => {
  assert.deepStrictEqual(MODERN_CHIP_FILTERS, MODERN_GRID_FILTERS,
    'client (common.js) and server (lib/home/feed.js) filter lists must stay identical - a drift silently mis-maps a chip');
});

// ---- v1.86.0: the sort control's client<->server binding --------------------

test('source-lock: the client sort values EQUAL the server MODERN_GRID_SORTS', () => {
  const clientValues = MODERN_SORT_OPTIONS.map(([v]) => v);
  assert.deepStrictEqual([...clientValues].sort(), [...MODERN_GRID_SORTS].sort(),
    'client (common.js) sort values and server (lib/home/feed.js) MODERN_GRID_SORTS must stay identical - a drift means a menu option the server bounces to newest, or a server key with no menu entry');
});

test('resolveModernSort: known values pass; unknown/absent -> newest (mirrors the server)', () => {
  for (const [v] of MODERN_SORT_OPTIONS) assert.strictEqual(resolveModernSort(v), v);
  assert.strictEqual(resolveModernSort('bogus'), 'newest');
  assert.strictEqual(resolveModernSort(undefined), 'newest');
  assert.strictEqual(resolveModernSort(null), 'newest');
  assert.strictEqual(resolveModernSort('NEWEST'), 'newest', 'case-exact');
});

// ---- v1.86.2 (Dean): the modern grid LAZY-LOADS (source-locks on main.js) ----

test('the modern grid PAGINATES: buildModernGridUrl carries seed/limit/offset for /api/home?view=grid', () => {
  const fn = MAIN.slice(MAIN.indexOf('function buildModernGridUrl'), MAIN.indexOf('function buildVideosApiUrl'));
  assert.match(fn, /\/api\/home\?view=grid/, 'targets the grid endpoint');
  assert.match(fn, /seed=\$\{encodeURIComponent\(currentSeed\)\}/, 'carries the stable scroll-session seed');
  assert.match(fn, /limit=\$\{HOME_PAGE_LIMIT\}/, 'requests an explicit page size');
  assert.match(fn, /offset=\$\{offset\}/, 'carries the page offset');
});

test('fetchModernGrid mints a fresh seed on reset + wires the shared sentinel (ensureGridSentinel)', () => {
  const fn = MAIN.slice(MAIN.indexOf('async function fetchModernGrid'), MAIN.indexOf('async function renderModernHome'));
  assert.match(fn, /currentSeed = generateSeed\(\)/, 'a chip/sort change re-shuffles (fresh seed)');
  assert.match(fn, /currentOffset = 0/, 'page 0 on reset');
  assert.match(fn, /currentTotal = typeof data\.total === 'number'/, 'reads total from the paginated response (the sentinel end-guard)');
  assert.match(fn, /ensureGridSentinel\(\)/, 'arms the lazy-load sentinel after page 0');
});

test('maybeLoadNextPage has a modern branch that APPENDS the next page (never replaces) and drops a stale filter mid-fetch', () => {
  const fn = MAIN.slice(MAIN.indexOf('async function maybeLoadNextPage'), MAIN.indexOf('async function maybeLoadNextPage') + 1400);
  assert.match(fn, /if \(modernMode\) \{/, 'a modern-mode branch exists');
  const modernBranch = fn.slice(fn.indexOf('if (modernMode) {'));
  assert.match(modernBranch, /buildModernGridUrl\(nextOffset\)/, 'fetches the NEXT page URL');
  assert.match(modernBranch, /if \(token !== modernReqToken\) return/, 'a chip/sort change mid-fetch drops the stale append');
  assert.match(modernBranch, /videoGrid\.insertAdjacentHTML\('beforeend'/, 'APPENDS cards (never innerHTML-replaces)');
});

test('(v1.86.2 #2) the card delete second tap deletes STRAIGHT to trash - no checkbox-modal escalation', () => {
  // Dean: revert the card trash icon to the pre-YouTube-feed inline 2-tap.
  const handler = MAIN.slice(MAIN.indexOf("closest('.card-delete-btn')"), MAIN.indexOf("closest('.card-delete-btn')") + 1400);
  assert.match(handler, /if \(result\.deleted\) \{[\s\S]*deleteCardById\(id\)/, 'the confirming tap deletes directly');
  assert.doesNotMatch(handler, /showHardDeleteModal|isYtdlpManagedItem/, 'the card no longer escalates local files to the checkbox hard-delete modal');
});

test('(v1.86.3 Dean) the sort control is a keyboard_arrow_down mask-icon, not a half-height ▾ text caret', () => {
  const fn = MAIN.slice(MAIN.indexOf('function injectModernHeaderSort'), MAIN.indexOf('function injectModernHeaderSort') + 2600);
  assert.match(fn, /caret\.className = 'icon-arrow-down modern-sort-caret'/,
    'the caret is an icon-arrow-down (keyboard_arrow_down) mask - a 1em glyph that sizes like the download/search icons');
  assert.doesNotMatch(fn, /textContent = '▾'/, 'no ▾ text-character caret (it read half-height vs the icon family)');
});
