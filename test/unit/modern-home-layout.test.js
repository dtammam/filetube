'use strict';

// [UNIT] v1.84 T3 - the bare-home layout PRECEDENCE (modern > feed > classic)
// and the chip resolver, both pure + exported from common.js so the decision is
// bound here rather than only asserted by reading main.js's gate. Plus a source-
// lock that the CLIENT chip list equals the SERVER's MODERN_GRID_FILTERS, so the
// two halves cannot drift (a divergent list would 404-free but silently mis-map
// a chip to 'all').

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveHomeLayout, resolveModernChip, MODERN_CHIP_FILTERS } = require('../../public/js/common.js');
const { MODERN_GRID_FILTERS } = require('../../lib/home/feed.js');

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
