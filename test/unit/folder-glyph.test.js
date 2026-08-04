'use strict';

// ---- v1.77 Stop C: the per-folder glyph, at all FOUR render sites ----------
//
// Dean asked to change a folder's glyph "out of a pool" - a Shows folder gets a
// TV. The chosen id lives in folderSettings[path].glyph and is resolved to a
// class by resolveFolderGlyphClass.
//
// The failure this file exists to prevent is the one this repo keeps repeating
// (v1.41.4 "the seat that forgot to CALL the shared helper", and four separate
// decision-vs-use strikes since v1.66): a resolver that is beautifully tested
// while one of its CALL SITES still hardcodes the old glyph. Testing the
// resolver's return value proves nothing about what any sidebar paints.
//
// So: the resolver gets its own tests, and then each of the four sites is bound
// SEPARATELY. Two have real test seams and are asserted as rendered DOM. Two
// (main.js's home sidebar, watch.js's watch sidebar) live inside registered
// view closures with no seam - the same honest limitation the v1.76 reorder
// suite states about the same two surfaces - so they get source locks that bind
// the CALL and the absence of the hardcoded glyph, plus Dean's device pass.
// That is stated plainly rather than papered over.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const glyphPool = require(path.join(REPO, 'public/js/glyph-pool.js'));
const common = require(path.join(REPO, 'public/js/common.js'));
const setup = require(path.join(REPO, 'public/js/setup.js'));

// ---- 1. the resolver (the DECISION) ---------------------------------------

test('resolveFolderGlyphClass: a known id resolves to its class', () => {
  assert.equal(glyphPool.resolveFolderGlyphClass('shows'), 'icon-shows');
  assert.equal(glyphPool.resolveFolderGlyphClass('school'), 'icon-school');
  assert.equal(glyphPool.resolveFolderGlyphClass('folder'), 'icon-folder');
});

test('resolveFolderGlyphClass: anything unknown falls back to the default folder glyph', () => {
  // The garbage-defense layer. The server validates on write, but a database
  // written by an older build, restored from a backup, or hand-edited must
  // still paint something sane - and must never emit an arbitrary class.
  for (const bad of [undefined, null, '', 'nope', 'icon-shows', 42, {}, [], true,
    'shows"><script>alert(1)</script>', '../../etc/passwd']) {
    assert.equal(glyphPool.resolveFolderGlyphClass(bad), 'icon-folder',
      `expected the default for ${JSON.stringify(bad)}`);
  }
});

test('resolveFolderGlyphClass can only ever return a known-safe class', () => {
  // The four render sites interpolate this into a `class` attribute in
  // string-built HTML. Nothing that escapes an attribute may come out of it,
  // for ANY input - so the output is bound to the registry, not to a regex.
  const legal = new Set(glyphPool.GLYPH_POOL.map((g) => 'icon-' + g.id));
  const inputs = ['shows', 'nope', '"', '" onload="x', '<i>', null, undefined, 0,
    'folder', 'a'.repeat(500)];
  for (const v of inputs) {
    const out = glyphPool.resolveFolderGlyphClass(v);
    assert.ok(legal.has(out), `resolver emitted a class outside the registry: ${out}`);
    assert.match(out, /^icon-[a-z0-9-]+$/, `unsafe class shape: ${out}`);
  }
});

// ---- 2. the render sites (the USE) ----------------------------------------

const FOLDERS = ['/media/shows', '/media/school'];
const SETTINGS = {
  '/media/shows': { name: 'Shows', glyph: 'shows' },
  '/media/school': { name: 'School', glyph: 'school' },
};

function withDom(shellHtml, fn) {
  const dom = new JSDOM(shellHtml, { url: 'http://localhost/' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.resolveFolderGlyphClass = glyphPool.resolveFolderGlyphClass;
  global.visibleSidebarFolders = common.visibleSidebarFolders;
  global.isSyntheticFolder = common.isSyntheticFolder;
  global.wireReorderable = common.wireReorderable;
  global.applyLikedSidebarEntry = () => {};
  global.fetch = () => Promise.resolve({ ok: true, json: async () => ({}) });
  try { return fn(dom); } finally {
    for (const k of ['document', 'window', 'resolveFolderGlyphClass', 'visibleSidebarFolders',
      'isSyntheticFolder', 'wireReorderable', 'applyLikedSidebarEntry', 'fetch']) delete global[k];
    dom.window.close();
  }
}

test('SITE 1/4 (setup.js sidebar): each folder row RENDERS its chosen glyph', () => {
  withDom('<body><div id="sidebar"><div id="sidebar-folders-list"></div></div></body>', (dom) => {
    setup.__setFolderStateForTests({
      folders: FOLDERS, settings: SETTINGS, synthetic: [],
      controller: new dom.window.AbortController(),
    });
    setup.renderSidebarFolders(FOLDERS, SETTINGS);
    const glyphs = [...dom.window.document.querySelectorAll('#sidebar-folders-list .sidebar-item i')]
      .map((i) => i.className);
    assert.deepEqual(glyphs, ['icon-shows', 'icon-school']);
  });
});

test('SITE 2/4 (common.js Playlists sheet): each folder row RENDERS its chosen glyph', () => {
  withDom('<body><div id="playlists-sheet-list"></div></body>', (dom) => {
    common.renderPlaylistsSheet(FOLDERS, SETTINGS, []);
    const glyphs = [...dom.window.document.querySelectorAll('#playlists-sheet-list .sidebar-item i')]
      .map((i) => i.className);
    assert.deepEqual(glyphs, ['icon-shows', 'icon-school']);
  });
});

test('SITE 1+2: a folder with NO glyph set still renders the default (no blank, no crash)', () => {
  // The upgrade path: every existing folder on Dean's server has no glyph key.
  withDom('<body><div id="playlists-sheet-list"></div></body>', (dom) => {
    common.renderPlaylistsSheet(['/media/old'], { '/media/old': { name: 'Old' } }, []);
    const i = dom.window.document.querySelector('#playlists-sheet-list .sidebar-item i');
    assert.equal(i.className, 'icon-folder');
  });
});

test('SITE 1+2: a hand-edited/garbage glyph renders the default, never an injected class', () => {
  withDom('<body><div id="playlists-sheet-list"></div></body>', (dom) => {
    common.renderPlaylistsSheet(['/media/x'],
      { '/media/x': { name: 'X', glyph: '"><img src=x onerror=alert(1)>' } }, []);
    const list = dom.window.document.querySelector('#playlists-sheet-list');
    assert.equal(list.querySelector('.sidebar-item i').className, 'icon-folder');
    assert.equal(list.querySelectorAll('img').length, 0, 'no markup escaped the class attribute');
  });
});

// The two closure-bound sites. These locks bind the CALL and the ABSENCE of the
// old hardcoded glyph - reverting either site to `<i class="icon-folder">`
// fails here, which is the mutant that matters.
for (const [label, file] of [
  ['SITE 3/4 (main.js home sidebar)', 'public/js/main.js'],
  ['SITE 4/4 (watch.js watch sidebar)', 'public/js/watch.js'],
]) {
  test(`${label}: calls the resolver, and no folder row hardcodes a glyph`, () => {
    const src = fs.readFileSync(path.join(REPO, file), 'utf8');
    assert.ok(src.includes('resolveFolderGlyphClass(settings[f] && settings[f].glyph)'),
      `${file}: the folder-row renderer must resolve the folder's glyph`);
    // The USE: the resolved value has to reach the markup.
    assert.match(src, /<i class="\$\{glyphClass\}">/,
      `${file}: the resolved class must be what the row renders`);
    // The mutant: a folder row that went back to the fixed glyph. Scoped to
    // rows built around a `?root=` link so the Playlists BUTTON in the bottom
    // bar (a legitimately fixed .icon-folder) is not caught.
    const folderRows = [...src.matchAll(/\?root=[\s\S]{0,300}?<\/a>/g)].map((m) => m[0]);
    assert.ok(folderRows.length >= 1, `${file}: expected to find a folder-row template`);
    for (const row of folderRows) {
      assert.ok(!row.includes('class="icon-folder"'),
        `${file}: a folder row still hardcodes icon-folder - the glyph choice is ignored there`);
    }
  });
}

// ---- 3. no site was missed ------------------------------------------------

test('COVERAGE: exactly four folder-row render sites exist, and all four resolve', () => {
  // If a fifth sidebar surface is added later, this fails and forces it to be
  // wired and bound rather than silently shipping the default glyph forever.
  const files = ['public/js/setup.js', 'public/js/main.js', 'public/js/watch.js', 'public/js/common.js'];
  let sites = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    for (const m of src.matchAll(/\?root=[\s\S]{0,400}?<\/a>/g)) {
      if (/<i class=/.test(m[0])) sites++;
    }
  }
  assert.equal(sites, 4, `expected 4 folder-row render sites, found ${sites} - a new one must be wired to the glyph resolver`);
});
