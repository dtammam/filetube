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

const { buildSidebarSkeletonRows } = require('../../public/js/main.js');

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
});
