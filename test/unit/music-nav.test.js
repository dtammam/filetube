'use strict';

// [UNIT] v1.44 T10 — the Music nav wiring + the IA rework (Books LEAVES the
// bottom-nav; Books+Music are LIBRARY-section sidebar entries + Playlists-sheet
// entries). Pure router helpers + source-lock assertions over common.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const common = require('../../public/js/common.js');

test('T10: deriveRouteView maps /music and /music.html to the music view', () => {
  assert.equal(common.deriveRouteView('/music'), 'music');
  assert.equal(common.deriveRouteView('/music.html'), 'music');
  assert.equal(common.deriveRouteView('/albumart/abc'), null, 'asset routes never become views');
});

test('T10: activeNavItem lights Music for the music page', () => {
  assert.equal(common.activeNavItem('/music', ''), 'music');
  assert.equal(common.activeNavItem('/music.html', ''), 'music');
  assert.equal(common.activeNavItem('/books', ''), 'books', 'existing mappings untouched');
});

test('T10: shouldInjectMusicNav gates on CONTENT (>=1 configured folder), never mere route existence', () => {
  assert.equal(common.shouldInjectMusicNav({ folders: ['/srv/music'] }), true);
  assert.equal(common.shouldInjectMusicNav({ folders: [] }), false, 'music-less = byte-identical chrome');
  assert.equal(common.shouldInjectMusicNav({}), false);
  assert.equal(common.shouldInjectMusicNav(null), false);
  assert.equal(common.shouldInjectMusicNav({ folders: 'junk' }), false);
});

test('T10 SOURCE-LOCK: Books + Music are Library-section entries; NEITHER injects a bottom-nav item', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  // The IA rework: no code path injects a bottom-nav Books/Music item anymore.
  assert.ok(!src.includes("setAttribute('data-nav', 'books')"), 'Books no longer injects a bottom-nav item (moved to the Library section)');
  assert.ok(!src.includes("setAttribute('data-nav', 'music')"), 'Music never injects a bottom-nav item');
  // Both inject a Library-section sidebar entry via the shared helper.
  assert.ok(src.includes("injectLibraryNavEntry('books', '/books', 'Books'"), 'Books injects a Library-section entry');
  assert.ok(src.includes("injectLibraryNavEntry('music', '/music', 'Music'"), 'Music injects a Library-section entry');
  // The shared helper anchors above #sidebar-folders-list (the Library section).
  assert.ok(src.includes("getElementById('sidebar-folders-list')"), 'Library entries anchor at the folders list');
  // Deterministic order: Music anchors before an existing Books entry.
  assert.ok(src.includes("document.querySelector('[data-nav-sidebar=\"books\"]') || foldersList"), 'Music sits above Books deterministically');
  // hrefByNavKey + VIEW_SCRIPT_SRC learn music.
  assert.ok(src.includes("music: '/music'"), 'hrefByNavKey lights the Music sidebar link after SPA nav');
  assert.ok(src.includes("music: '/js/music.js'"), 'the music view script is lazy-loadable');
  // The Playlists sheet surfaces Music + Books.
  assert.ok(src.includes('href="/music" class="sidebar-item"'), 'the Playlists sheet lists Music when enabled');
  assert.ok(src.includes('href="/books" class="sidebar-item"'), 'the Playlists sheet lists Books when enabled');
});

test('T10 SOURCE-LOCK: the sidebar section title is now "Library" in every shell', () => {
  const shells = ['index.html', 'watch.html', 'stats.html', 'setup.html', 'books.html', 'music.html', 'read.html'];
  for (const shell of shells) {
    const html = fs.readFileSync(path.join(__dirname, '../../public', shell), 'utf8');
    assert.ok(html.includes('>Library</div>'), `${shell}: sidebar section renamed to Library`);
    assert.ok(!html.includes('Playlists (Folders)'), `${shell}: old "Playlists (Folders)" title gone`);
  }
});
