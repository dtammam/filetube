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

// ---- T9: the reader's pure contract pieces -----------------------------------

const readView = require('../../public/js/read.js');

test('T9: READER_BLOCK_SELECTOR is the locked listen-from-here contract (change only with the wave-2 server chunker, in lockstep)', () => {
  assert.equal(readView.READER_BLOCK_SELECTOR, 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, td');
});

test('T9: clampReaderFontSize -- bounded, stepped, junk-safe', () => {
  assert.equal(readView.clampReaderFontSize(100), 100);
  assert.equal(readView.clampReaderFontSize(1000), 170);
  assert.equal(readView.clampReaderFontSize(10), 80);
  assert.equal(readView.clampReaderFontSize(104), 100, 'snaps to the step');
  assert.equal(readView.clampReaderFontSize('junk'), 100);
});

test('T9: normalizeReaderTheme -- allowlisted, defaults to paper', () => {
  assert.equal(readView.normalizeReaderTheme('night'), 'night');
  assert.equal(readView.normalizeReaderTheme('hotdog-stand'), 'paper');
  assert.equal(readView.normalizeReaderTheme(undefined), 'paper');
});

test('T9: locator builders match the server contract -- bounded cfi, optional integer wave-2 keys, positive pdf page', () => {
  const epub = readView.buildEpubLocator('epubcfi(/6/14!/4/2)', 3, 41);
  assert.deepEqual(epub, { kind: 'epub', cfi: 'epubcfi(/6/14!/4/2)', spineIndex: 3, blockIndex: 41 });
  const noKeys = readView.buildEpubLocator('x', null, -1);
  assert.deepEqual(noKeys, { kind: 'epub', cfi: 'x' }, 'invalid wave-2 keys simply omitted');
  assert.equal(readView.buildEpubLocator('y'.repeat(3000)).cfi.length, 2000, 'cfi bounded to the server cap');
  assert.deepEqual(readView.buildPdfLocator(12), { kind: 'pdf', page: 12 });
  assert.deepEqual(readView.buildPdfLocator(-1), { kind: 'pdf', page: 1 }, 'junk pages degrade to 1');
});

// ---- T10: the home-page book surfaces (pure builders in main.js) -------------

const mainView = require('../../public/js/main.js');

test('T10: buildBooksHomeSectionHtml -- empty items = EMPTY STRING (books-less home stays byte-identical); populated = escaped row', () => {
  assert.equal(mainView.buildBooksHomeSectionHtml([], 'Continue reading', '/books'), '');
  assert.equal(mainView.buildBooksHomeSectionHtml('junk', 'X', null), '');
  const html = mainView.buildBooksHomeSectionHtml(
    [{ id: 'b1', title: '<i>Sly</i> Book', progress: { percent: 40 } }],
    'Continue reading',
    '/books',
  );
  assert.ok(html.includes('Continue reading'));
  assert.ok(html.includes('/read.html?b=b1'));
  assert.ok(!html.includes('<i>Sly</i>'), 'titles escaped');
  assert.ok(html.includes('width: 40%'), 'progress fill');
  assert.ok(html.includes('href="/books"'), 'see-all link');
});

test('T10: buildBookRowCardHtml -- encoded ids, no progress bar on unread', () => {
  const html = mainView.buildBookRowCardHtml({ id: 'a/b', title: 'T' });
  assert.ok(html.includes('/read.html?b=a%2Fb'));
  assert.ok(html.includes('/bookcover/a%2Fb'));
  assert.ok(!html.includes('book-row-progress'));
});

// ---- v1.37.0 (Dean's orphaned-pin report): the unpin control -----------------

const commonSrc = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');

test('unpin: fetchAllPins tags every pin with its source, and pinDeleteEndpoint routes to the OWNING module', () => {
  const common = require('../../public/js/common.js');
  assert.equal(common.pinDeleteEndpoint({ id: 'a b', pinSource: 'books' }), '/api/books/pins/a%20b');
  assert.equal(common.pinDeleteEndpoint({ id: 'x', pinSource: 'channel' }), '/api/subscriptions/pins/x');
  assert.equal(common.pinDeleteEndpoint({ id: 'x' }), '/api/subscriptions/pins/x', 'untagged legacy pins default to the channel endpoint');
  assert.ok(commonSrc.includes("pinSource: 'channel'") && commonSrc.includes("pinSource: 'books'"), 'fetchAllPins tags both sources');
});

test('unpin: BOTH pinned surfaces (sidebar + playlists sheet) attach buildUnpinButton to every row (source locks)', () => {
  const calls = (commonSrc.match(/buildUnpinButton\(/g) || []).length;
  assert.ok(calls >= 3, 'the builder + two renderer call sites');
  assert.ok(commonSrc.includes('link.appendChild(buildUnpinButton(sourcePin, refreshAllPinSurfaces))'), 'sidebar rows carry the control');
  assert.ok(commonSrc.includes('link.appendChild(buildUnpinButton(sheetSourcePin, refreshAllPinSurfaces))'), 'sheet rows carry the control');
});

test('unpin: the control is arm/confirm (card-delete pattern) and never navigates the row link', () => {
  const fnStart = commonSrc.indexOf('function buildUnpinButton');
  const fnBody = commonSrc.slice(fnStart, commonSrc.indexOf('\nfunction ', fnStart + 10));
  assert.ok(fnBody.includes('event.preventDefault()') && fnBody.includes('event.stopPropagation()'), 'clicks never fall through to the row link');
  assert.ok(fnBody.includes("classList.contains('armed')"), 'first tap arms');
  assert.ok(fnBody.includes("method: 'DELETE'"), 'second tap deletes');
});

// ---- GATE FIXES (both reviewers' CRITICAL + warnings): source locks ----------

test('GATE FIX C1: pin drag-reorder is SOURCE-SCOPED -- cross-source drops blocked, per-source ids to the owning endpoint, merged re-render', () => {
  // v1.76: the first two assertions used to pin the EXACT text of the
  // hand-rolled cross-source checks inside the native-HTML5 `dragover`/`drop`
  // handlers. Those handlers are gone - the partition is now a `groupOf`
  // option on the shared gesture layer, which refuses the drop AND withholds
  // the drop indicator. The PROPERTY is unchanged, and it is now proven by
  // EXECUTION rather than by string presence, in
  // test/unit/pinned-sidebar-reorder.test.js (a real jsdom render, real
  // pointer events, asserting on what reaches fetch). What remains here is
  // the endpoint dispatch, which is still worth a source lock because its
  // three arms are otherwise only exercised two at a time.
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  assert.ok(src.includes('function pinSourceOf(pin)'), 'the source decision helper exists');
  assert.ok(src.includes('groupOf: (index) => pinSourceOf(rowPins[index]),'), 'the drag partition is keyed on the pin source');
  assert.ok(src.includes(".filter((p) => pinSourceOf(p) === source)"), 'only the source own ids persist');
  // v1.72: the dispatch grew a podcasts arm - the lock binds all three.
  assert.ok(src.includes("source === 'books' ? '/api/books/pins/reorder'"), 'the endpoint follows the source -- the books reorder route is no longer client-dead');
  assert.ok(src.includes("source === 'podcasts' ? '/api/podcasts/pins/reorder'"), 'the podcasts reorder route rides the same dispatch');
  assert.ok(src.includes(": '/api/subscriptions/pins/reorder'"), 'channel pins keep the default arm');
  assert.ok(src.includes('.finally(() => refreshAllPinSurfaces());'), 'the re-render is ALWAYS the merged fetch, never a single endpoint response');
});

test('GATE FIX (QA W4/W6 + S1/S9): sidebar highlight, injection guard, sheet enabled-hint, protocol-relative href rejection', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  assert.ok(src.includes("books: '/books'"), 'hrefByNavKey lights the Books sidebar link after SPA navigation');
  assert.ok(src.includes('[data-nav-sidebar="books"]'), 'the injection guard covers the sidebar marker too');
  assert.ok(src.includes("!p.href.startsWith('//')"), 'protocol-relative hrefs never qualify as same-app');
  assert.ok(src.includes("Boolean(document.querySelector('[data-nav=\"subscriptions\"]'))"), 'the sheet empty-state hint follows the real ytdlp enablement probe');
  const common = require('../../public/js/common.js');
  const entry = common.derivePinnedPlaylistEntries([{ channelDir: '/b/x', label: 'X', href: '//evil.com/path' }]);
  assert.equal(entry[0].href, null, 'behavioral: //host hrefs drop to null');
});

// ---- v1.37.1 hotfix locks (Dean's stuck-"Opening book" report) ---------------

test("v1.37.1: ePub() is called with openAs:'epub' -- the extension-less /book/:id/file URL otherwise type-sniffs as an unpacked DIRECTORY and hangs fetching container.xml", () => {
  const readSrc = fs.readFileSync(path.join(__dirname, '../../public/js/read.js'), 'utf8');
  assert.ok(readSrc.includes("{ openAs: 'epub' }"), 'the archived-epub hint must be explicit');
});

test('v1.37.1: books/reader styles live in the SHARED stylesheet -- the SPA router swaps only #view-root, so page-local <head> styles are lost on in-app navigation', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  for (const cls of ['.reader-chassis', '.reader-topbar', '.reader-drawer', '.books-grid', '.book-cover-link', '.books-shelf-chip']) {
    assert.ok(css.includes(`${cls} {`) || css.includes(`${cls},`), `${cls} must be in style.css`);
  }
  for (const page of ['books.html', 'read.html']) {
    const html = fs.readFileSync(path.join(__dirname, `../../public/${page}`), 'utf8');
    assert.ok(!html.includes('<style>'), `${page} must carry NO page-local style block (lost on SPA swap)`);
  }
});

// ---- v1.37.3 (Dean's pagination report): explicit-pixel rendering locks ------

test('v1.37.3: epub.js is NEVER handed percentage dimensions -- explicit measured pixels at open (settled via waitForPaneSize) and on refit', () => {
  const readSrc = fs.readFileSync(path.join(__dirname, '../../public/js/read.js'), 'utf8');
  assert.ok(!readSrc.includes("width: '100%'"), 'percentage width caused whole-chapter-as-one-page rendering');
  assert.ok(readSrc.includes('waitForPaneSize(pane, signal)'), 'open waits for settled pane dimensions');
  assert.ok(readSrc.includes('width: paneSize.width'), 'renderTo gets explicit pixels');
  assert.ok(readSrc.includes('minSpreadWidth: 800'), 'phones stay strictly single-page; wide panes get two');
  assert.ok(readSrc.includes('rendition.resize(w, h)'), 'refit passes explicit measured pixels');
});

// ---- v1.73.2 (Dean): Books' own glyph ----------------------------------------

test('v1.73.2 SOURCE-LOCK: Books wears icon-books everywhere - injector, sheet mirror, all nine shells, real mask asset + emoji entry', () => {
  const pub = path.join(__dirname, '../../public');
  const commonSrc = fs.readFileSync(path.join(pub, 'js/common.js'), 'utf8');
  assert.ok(commonSrc.includes("injectLibraryNavEntry('books', '/books', 'Books', 'icon-books')"), 'the Library injector');
  // v1.77: the sheet mirror no longer hardcodes the glyph - Library entries
  // are user-assignable now, so it MIRRORS the injected sidebar entry's glyph
  // (exactly as Downloads' href has always been mirrored) with icon-books as
  // the shipped fallback. Both halves are bound: that Books is the fallback,
  // and that the mirror is what renders. A revert to a hardcoded glyph fails
  // the second assertion, and losing the Books default fails the first.
  assert.ok(commonSrc.includes("mirroredGlyph('books', 'icon-books')"),
    'the Playlists sheet mirror resolves Books through the shared mirror, defaulting to icon-books');
  assert.ok(/<i class="' \+ mirroredGlyph\('books', 'icon-books'\) \+ '"><\/i> Books/.test(commonSrc),
    'and that mirrored class is what the sheet row actually renders');
  assert.ok(!commonSrc.includes('\'icon-folder\'); // v1.73.2'), 'no stale folder-icon books call survives');
  const css = fs.readFileSync(path.join(pub, 'css/style.css'), 'utf8');
  assert.ok(css.includes('.icon-books { -webkit-mask-image: url(/assets/icons/books.svg)'), 'a real mask rule');
  assert.ok(css.includes('[data-icons="emoji"] .icon-books::before { content: "\\1F4DA"; }'), 'the emoji-set entry (no silent drop - the v1.73 W2 lesson)');
  assert.ok(fs.existsSync(path.join(pub, 'assets/icons/books.svg')), 'the asset exists');
  assert.ok(fs.readFileSync(path.join(pub, 'assets/icons/books.svg'), 'utf8').includes('<svg'), 'and is a real svg, not a corrupted husk (slim-gate S2)');
  // Slim-gate W1: the two memberships the first lock left unbound - both
  // survived the FULL suite as deletion mutants.
  // v1.77: this asserted `.icon-books` was the LAST entry in the sizing group
  // (`\.icon-books \{`), which bound its POSITION, not the membership the
  // comment says it protects. v1.77 appended 20 pool glyphs after it and the
  // lock failed on a change that broke nothing. Rewritten to bind membership:
  // still fails if `.icon-books` is dropped from the group (the mutant this
  // lock exists to kill - re-verified in the v1.77 fix round), but survives
  // the list legitimately growing. Comments are stripped first so a future
  // comment naming a class cannot satisfy it (the v1.50 source-lock lesson).
  const sizingGroup = css.slice(css.indexOf('\n.icon-home,\n'), css.indexOf('{', css.indexOf('\n.icon-home,\n')))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(sizingGroup, /\.icon-books(?![a-z0-9-])/, 'base sizing-group membership (dropped = zero-area icon in every mask set)');
  assert.ok(css.includes('[data-icons="emoji"] .icon-books,'), 'emoji mask-STRIP membership (dropped = the documented colored-box-behind-the-emoji class)');
  const shells = fs.readdirSync(pub).filter((f) => f.endsWith('.html'))
    .filter((f) => fs.readFileSync(path.join(pub, f), 'utf8').includes('data-nav="books"'));
  assert.ok(shells.length >= 9, `full shell roster (${shells.length})`);
  for (const f of shells) {
    const html = fs.readFileSync(path.join(pub, f), 'utf8');
    assert.match(html, /data-nav="books" hidden>\s*<i class="icon-books"><\/i>/, `${f}: the bottom item wears the glyph`);
  }
});
