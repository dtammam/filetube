'use strict';

// [UNIT] v1.102 shimmer sweep (tranche 4) - the Library sidebar folder list
// seeds a shape-matched skeleton before /api/config, so the left rail never sits
// blank then snaps the folder links in. Reuses the real `.sidebar-item` box for a
// zero-shift reveal, and seeds ONLY on a COLD sidebar (no folder row yet) so an
// in-app re-nav never shimmers over the already-rendered folders.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { JSDOM } = require('jsdom');
const { buildSidebarSkeletonRows, clearSidebarSkeletonOnError } = require('../../public/js/main.js');

const countOf = (html, cls) => (html.match(new RegExp('class="[^"]*\\b' + cls + '(?![-\\w])', 'g')) || []).length;

test('buildSidebarSkeletonRows(n): exactly n real .sidebar-item rows, each a shimmer glyph + label line', () => {
  const html = buildSidebarSkeletonRows(5);
  assert.strictEqual(countOf(html, 'sidebar-item'), 5, 'exactly 5 rows reusing the real sidebar-item box');
  // Each row: one shimmer glyph box + one shimmer label line = 2 shimmers/row.
  assert.strictEqual((html.match(/skeleton-shimmer/g) || []).length, 10, 'a glyph + a label shimmer per row');
  assert.ok(html.includes('skeleton-line'), 'the label is a skeleton-line bar');
  assert.strictEqual((html.match(/aria-hidden="true"/g) || []).length, 5, 'every placeholder row is aria-hidden');
});

test('buildSidebarSkeletonRows: n<=0 / non-integer -> \'\' (never throws)', () => {
  assert.strictEqual(buildSidebarSkeletonRows(0), '');
  assert.strictEqual(buildSidebarSkeletonRows(-3), '');
  assert.strictEqual(buildSidebarSkeletonRows('nope'), '');
  assert.strictEqual(buildSidebarSkeletonRows(), '');
});

// v1.102 gate CRITICAL: a total /api/config failure must not leave the cold-load
// skeleton shimmering forever. clearSidebarSkeletonOnError clears the seeded
// skeleton on error - but ONLY the skeleton, never already-rendered real folders
// (a re-nav whose config fetch fails keeps its valid folder list). Behavioural,
// so it binds the reveal (the original miss slipped past a presence-only test).
test('clearSidebarSkeletonOnError: clears the seeded cold skeleton (no forever-shimmer)', () => {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="list"></div></body>', { url: 'http://localhost/' });
  const list = dom.window.document.getElementById('list');
  list.innerHTML = buildSidebarSkeletonRows(5);
  assert.ok(list.querySelector('.skeleton-shimmer'), 'skeleton seeded');
  clearSidebarSkeletonOnError(list);
  assert.ok(!list.querySelector('.skeleton-shimmer'), 'the stranded skeleton is cleared on error');
  assert.ok(!list.querySelector('.sidebar-item[aria-hidden="true"]'), 'no placeholder rows remain');
  dom.window.close();
});

test('clearSidebarSkeletonOnError: NEVER wipes already-rendered real folders (re-nav error keeps them)', () => {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="list"></div></body>', { url: 'http://localhost/' });
  const list = dom.window.document.getElementById('list');
  // A warm sidebar: real folder links (no aria-hidden), NOT a skeleton.
  list.innerHTML = '<a class="sidebar-item" href="/?root=A"><i class="icon-folder"></i> A</a>' +
                   '<a class="sidebar-item" href="/?root=B"><i class="icon-folder"></i> B</a>';
  clearSidebarSkeletonOnError(list);
  assert.strictEqual(list.querySelectorAll('a.sidebar-item').length, 2, 'real folders are untouched by a transient error');
  dom.window.close();
});

test('clearSidebarSkeletonOnError: null-safe (no list element)', () => {
  assert.doesNotThrow(() => clearSidebarSkeletonOnError(null));
});

test('main.js seeds the sidebar skeleton BEFORE /api/config, and ONLY when cold (source-lock, comments stripped)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/main.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  // The seed is guarded on a COLD sidebar (no real .sidebar-item yet) so an
  // in-app re-nav never shimmers over rendered folders (reverse-flash).
  assert.match(src, /if \(sidebarFoldersList && !sidebarFoldersList\.querySelector\('\.sidebar-item'\)\) \{\s*\n\s*sidebarFoldersList\.innerHTML = buildSidebarSkeletonRows\(SIDEBAR_SKELETON_ROWS\);/,
    'cold-only guard + seed present');
  // ...and it runs BEFORE the /api/config fetch (shimmer before the wait).
  const seedAt = src.indexOf('sidebarFoldersList.innerHTML = buildSidebarSkeletonRows');
  const fetchAt = src.indexOf("fetch('/api/config')");
  assert.ok(seedAt > -1 && fetchAt > -1 && seedAt < fetchAt, 'seed precedes the /api/config fetch');
  // ...and the load-failure catch clears the stranded skeleton (gate CRITICAL).
  assert.match(src, /clearSidebarSkeletonOnError\(sidebarFoldersList\)/,
    'the /api/config-failure catch clears the cold sidebar skeleton');
});
