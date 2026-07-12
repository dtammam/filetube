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
