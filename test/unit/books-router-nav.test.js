'use strict';

// [UNIT] v1.37.0 T7: the books router/nav additions + the vendored-assets
// license lock. Same pure-helper coverage posture as router-helpers.test.js
// / active-nav-item.test.js (deliberate additive updates to that closed
// route set -- flagged in the exec plan as a reviewed decision).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const common = require('../../public/js/common.js');

test('T7: deriveRouteView maps /books, /books.html, and /read.html; unknown paths still fall through', () => {
  assert.equal(common.deriveRouteView('/books'), 'books');
  assert.equal(common.deriveRouteView('/books.html'), 'books');
  assert.equal(common.deriveRouteView('/read.html'), 'read');
  assert.equal(common.deriveRouteView('/bookcover/abc'), null, 'asset routes never become views');
});

test('T7: activeNavItem lights Books for the books page AND the reader', () => {
  assert.equal(common.activeNavItem('/books', ''), 'books');
  assert.equal(common.activeNavItem('/read.html', '?b=abc'), 'books');
  assert.equal(common.activeNavItem('/', ''), 'home', 'existing mappings untouched');
});

test('T7: shouldInjectBooksNav gates on CONTENT (>=1 configured folder), never mere route existence', () => {
  assert.equal(common.shouldInjectBooksNav({ folders: ['/srv/books'] }), true);
  assert.equal(common.shouldInjectBooksNav({ folders: [] }), false, 'books-less install = byte-identical chrome');
  assert.equal(common.shouldInjectBooksNav({}), false);
  assert.equal(common.shouldInjectBooksNav(null), false);
  assert.equal(common.shouldInjectBooksNav({ folders: 'junk' }), false);
});

test('T7: vendored reader libs carry their upstream LICENSE files with the expected license names (drift lock)', () => {
  const vendor = path.join(__dirname, '../../public/vendor');
  const jszip = fs.readFileSync(path.join(vendor, 'jszip/LICENSE'), 'utf8');
  assert.ok(/MIT/i.test(jszip), 'JSZip: MIT');
  const epubjs = fs.readFileSync(path.join(vendor, 'epubjs/LICENSE'), 'utf8');
  assert.ok(/BSD|FreeBSD|Redistribution and use/i.test(epubjs), 'epub.js: BSD-2');
  const pdfjs = fs.readFileSync(path.join(vendor, 'pdfjs/LICENSE'), 'utf8');
  assert.ok(/Apache/i.test(pdfjs), 'pdf.js: Apache-2.0');
  // The dists themselves exist and are non-trivial (a failed/HTML download
  // would be tiny or start with '<').
  for (const rel of ['jszip/jszip.min.js', 'epubjs/epub.min.js', 'pdfjs/pdf.min.mjs', 'pdfjs/pdf.worker.min.mjs']) {
    const buf = fs.readFileSync(path.join(vendor, rel));
    assert.ok(buf.length > 50000, `${rel} is a real dist`);
    assert.notEqual(buf.toString('utf8', 0, 1), '<', `${rel} is not an HTML error page`);
  }
});

// ---- T8: the books page's pure card/chip builders ----------------------------

const booksView = require('../../public/js/books.js');

test('T8: buildBookCardHtml -- escaped title/author, encoded id in hrefs, progress bar only when meaningful', () => {
  const html = booksView.buildBookCardHtml({
    id: 'abc/def', title: '<b>Sneaky</b> & Title', author: "O'Author",
    progress: { percent: 37.4 },
  });
  assert.ok(html.includes('/read.html?b=abc%2Fdef'), 'id URL-encoded');
  assert.ok(!html.includes('<b>Sneaky</b>'), 'title escaped');
  assert.ok(html.includes('&lt;b&gt;Sneaky&lt;/b&gt;'));
  assert.ok(html.includes('&#039;Author'), 'author escaped');
  assert.ok(html.includes('width: 37.4%'), 'progress fill');
  const fresh = booksView.buildBookCardHtml({ id: 'x', title: 'T', author: '' });
  assert.ok(!fresh.includes('book-progress-track'), 'no bar on unread books');
});

test('T8: deriveShelfChips -- sorted, malformed entries dropped, non-arrays degrade to []', () => {
  const chips = booksView.deriveShelfChips([
    { name: 'Zeta', dir: '/b/z', count: 1 },
    { name: 'Alpha', dir: '/b/a', count: 2 },
    { name: '', dir: '/b/broken' },
    null,
  ]);
  assert.deepEqual(chips.map((c) => c.name), ['Alpha', 'Zeta']);
  assert.deepEqual(booksView.deriveShelfChips('junk'), []);
});
