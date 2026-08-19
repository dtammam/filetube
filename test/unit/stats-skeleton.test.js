'use strict';

// [UNIT] v1.102 shimmer sweep (tranche 4) - the Fun-stats dashboard seeds a
// shape-matched shimmer into all 11 containers BEFORE its two fetches, then
// each render* swaps it for real content (reveal-once). This binds the reveal
// (not mere presence): the skeleton is present after seeding and GONE after the
// dashboard renders, and a failed /api/stats clears every stats-fed skeleton so
// nothing shimmers forever.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const STATS = require.resolve('../../public/js/stats.js');

// The container ids the dashboard shell ships (mirrors stats.html).
const ALL_IDS = [
  'stats-glance-grid', 'stats-by-type', 'stats-folder-list', 'stats-channel-list',
  'stats-records-grid', 'stats-most-watched-list', 'stats-books-grid',
  'stats-books-folder-list', 'stats-duplicates-list', 'stats-inventory-list', 'stats-about',
];

function loadStats() {
  delete global.document; delete global.window;
  const dom = new JSDOM(
    '<!DOCTYPE html><body>' +
      ALL_IDS.map((id) => `<div id="${id}"></div>`).join('') +
    '</body>',
    { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  delete require.cache[STATS];
  const mod = require(STATS); // boot is guarded; require does not fetch
  return { mod, dom, doc: dom.window.document };
}

const shimmerCount = (el) => el.querySelectorAll('.skeleton-shimmer').length;

// A minimal-but-complete /api/stats payload (every field renderStatsDashboard
// reads); empty lists/records exercise the empty-state render paths, which all
// clearChildren first - so they still bind "the skeleton was replaced".
const STATS_DATA = {
  count: { total: 0, video: 0, audio: 0 },
  totalDurationSeconds: 0, totalSizeBytes: 0,
  byType: {
    video: { count: 0, totalDurationSeconds: 0, totalSizeBytes: 0 },
    audio: { count: 0, totalDurationSeconds: 0, totalSizeBytes: 0 },
  },
  byFolder: [], byChannel: [], mostWatched: [], books: {}, inventory: {}, system: {},
};

test('seedStatsSkeleton seeds all 11 containers with shape-matched shimmer', () => {
  const { mod, dom, doc } = loadStats();
  // Prediction: exactly 11 render-target containers, seeded via two maps.
  const seeded = new Set([
    ...mod.STATS_TILE_GRIDS.map((e) => e[0]),
    ...mod.STATS_LIST_CONTAINERS.map((e) => e[0]),
  ]);
  assert.strictEqual(seeded.size, 11, 'exactly 11 distinct containers are seeded');

  mod.seedStatsSkeleton();
  for (const id of ALL_IDS) {
    assert.ok(shimmerCount(doc.getElementById(id)) > 0, `${id} shimmers after seeding`);
  }
  // Fixed-shape tile grids get their exact real tile counts (true zero-shift).
  assert.strictEqual(doc.getElementById('stats-glance-grid').querySelectorAll('.theme-card').length, 5);
  assert.strictEqual(doc.getElementById('stats-by-type').querySelectorAll('.theme-card').length, 2);
  assert.strictEqual(doc.getElementById('stats-records-grid').querySelectorAll('.theme-card').length, 3);
  assert.strictEqual(doc.getElementById('stats-books-grid').querySelectorAll('.theme-card').length, 5);
  dom.window.close();
});

test('reveal-once: renderStatsDashboard REPLACES every stats-fed skeleton (binding, not presence)', () => {
  const { mod, dom, doc } = loadStats();
  mod.seedStatsSkeleton();
  // Precondition: the skeleton really is there before the render.
  assert.ok(shimmerCount(doc.getElementById('stats-glance-grid')) > 0, 'seeded pre-render');

  mod.renderStatsDashboard(STATS_DATA);

  // Every stats-fed container is now shimmer-free (the render cleared+filled it).
  for (const id of mod.STATS_FETCH_CONTAINERS) {
    assert.strictEqual(shimmerCount(doc.getElementById(id)), 0, `${id} shimmer gone after render`);
  }
  // ...and glance holds the 5 REAL stat tiles with text (not skeleton lines).
  const tiles = doc.getElementById('stats-glance-grid').querySelectorAll('.theme-card .stat-tile-value');
  assert.strictEqual(tiles.length, 5, 'the 5 real glance tiles rendered');
  assert.ok(tiles[0].textContent.length > 0, 'the real tile carries text');
  // The duplicates list is a SEPARATE fetch - renderStatsDashboard must NOT
  // touch it, so its seeded skeleton is still present.
  assert.ok(shimmerCount(doc.getElementById('stats-duplicates-list')) > 0,
    'duplicates skeleton is untouched by renderStatsDashboard (its own fetch owns it)');
  dom.window.close();
});

test('renderStatsError clears every stats-fed skeleton (no forever-shimmer) but leaves duplicates', () => {
  const { mod, dom, doc } = loadStats();
  mod.seedStatsSkeleton();
  mod.renderStatsError();
  for (const id of mod.STATS_FETCH_CONTAINERS) {
    assert.strictEqual(shimmerCount(doc.getElementById(id)), 0, `${id} shimmer cleared on error`);
  }
  assert.match(doc.getElementById('stats-glance-grid').textContent, /Could not load stats/);
  // duplicates has its own fetch + error path - renderStatsError leaves it be.
  assert.ok(shimmerCount(doc.getElementById('stats-duplicates-list')) > 0,
    'duplicates skeleton survives a /api/stats error (its own fetch cleans it)');
  dom.window.close();
});

test('init seeds the skeleton BEFORE the fetches (source-lock, comments stripped)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/stats.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  // seedStatsSkeleton() must appear before the first /api/stats fetch in init.
  const seedAt = src.indexOf('seedStatsSkeleton();');
  const fetchAt = src.indexOf("fetch('/api/stats'"); // v1.151: now fetch('/api/stats', { signal }) - match the call, not the exact arg list
  assert.ok(seedAt > -1 && fetchAt > -1, 'both the seed call and the fetch exist');
  assert.ok(seedAt < fetchAt, 'seedStatsSkeleton() runs before /api/stats fetch (shimmer before the wait)');
});
