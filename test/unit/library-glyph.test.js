'use strict';

// ---- v1.77 Stop D: per-user Library glyphs ---------------------------------
//
// Intake ruling 5: every Library entry is assignable, not just the Books and
// Podcasts Dean named. Ruling 7: per-user, server-truth (the v1.67 card-corner
// posture) rather than a localStorage device seed.
//
// Two failure modes this binds, both of which this repo has actually shipped:
//
// 1. HALF THE SURFACES. Each entry appears in a sidebar AND (opt-in) a bottom
//    bar. A repainter that updated one would leave the same destination wearing
//    two different glyphs. That is the v1.41.4 every-writer scar.
//
// 2. THE LATE INJECTOR. The Library entries are injected by ASYNC capability
//    probes, so an entry can land after the settings fetch resolves. A design
//    that only repainted at boot would leave late entries on the default glyph
//    until the next navigation - intermittent, and invisible to a test that
//    injects synchronously. libraryGlyphClassFor is what closes it, and it is
//    bound here in that order.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const common = require('../../public/js/common.js');
const { LIBRARY_GLYPH_SLOTS, resolveLibraryGlyphClass } = require('../../public/js/glyph-pool.js');

// glyph-pool.js is a real <script> tag before common.js on every shell, so its
// exports are plain globals in the browser. This harness stands in for that
// script loading, the same way setup-sidebar-reorder.test.js provides the eight
// globals common.js hands to setup.js.
function withDom(html, fn) {
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.LIBRARY_GLYPH_SLOTS = LIBRARY_GLYPH_SLOTS;
  global.resolveLibraryGlyphClass = resolveLibraryGlyphClass;
  try { return fn(dom); } finally {
    for (const k of ['document', 'window', 'LIBRARY_GLYPH_SLOTS', 'resolveLibraryGlyphClass']) delete global[k];
    dom.window.close();
  }
}

// A shell carrying BOTH surfaces for every slot, exactly as the real ones do.
const SHELL = '<body>' +
  LIBRARY_GLYPH_SLOTS.map((s) =>
    `<a data-nav-sidebar="${s.nav}" href="/x"><i class="${s.fallback}"></i> ${s.name}</a>` +
    `<a data-nav="${s.nav}" href="/x"><i class="${s.fallback}"></i></a>`).join('') +
  '</body>';

// ---- the resolver ---------------------------------------------------------

test('resolveLibraryGlyphClass: a chosen pool id wins; anything else keeps the shipped glyph', () => {
  for (const slot of LIBRARY_GLYPH_SLOTS) {
    assert.equal(resolveLibraryGlyphClass({ [slot.key]: 'shows' }, slot.key), 'icon-shows');
    // Absence, the explicit 'default' meta-value, and garbage all mean "the
    // glyph this entry has always had" - so a user can always get back to the
    // original, and an untouched install is pixel-identical to today.
    for (const v of [undefined, null, 'default', 'nope', 42, {}, '"><img src=x>']) {
      assert.equal(resolveLibraryGlyphClass({ [slot.key]: v }, slot.key), slot.fallback,
        `${slot.key} with ${JSON.stringify(v)} must keep ${slot.fallback}`);
    }
  }
  assert.equal(resolveLibraryGlyphClass({}, 'glyphNotASlot'), null, 'an unknown slot resolves to nothing');
});

test('every slot fallback is the glyph that entry actually shipped with', () => {
  // Guards against a typo'd fallback silently changing an entry's default look
  // for every user who never opens the picker.
  const expected = {
    glyphDownloads: 'icon-downloads', glyphMusic: 'icon-play', glyphBooks: 'icon-books',
    glyphPodcasts: 'icon-podcast', glyphHistory: 'icon-history',
  };
  assert.deepEqual(
    Object.fromEntries(LIBRARY_GLYPH_SLOTS.map((s) => [s.key, s.fallback])), expected);
});

// ---- the repaint (the USE) ------------------------------------------------

test('applyLibraryGlyphs repaints BOTH surfaces of every slot', () => {
  withDom(SHELL, (dom) => {
    const settings = Object.fromEntries(LIBRARY_GLYPH_SLOTS.map((s) => [s.key, 'shows']));
    common.applyLibraryGlyphs(settings);
    for (const slot of LIBRARY_GLYPH_SLOTS) {
      assert.equal(dom.window.document.querySelector(`[data-nav-sidebar="${slot.nav}"] i`).className,
        'icon-shows', `${slot.nav}: sidebar entry not repainted`);
      assert.equal(dom.window.document.querySelector(`[data-nav="${slot.nav}"] i`).className,
        'icon-shows', `${slot.nav}: BOTTOM BAR item not repainted - the same destination now shows two different glyphs`);
    }
  });
});

test('applyLibraryGlyphs with no settings leaves every entry on its shipped glyph', () => {
  withDom(SHELL, (dom) => {
    common.applyLibraryGlyphs(null);
    for (const slot of LIBRARY_GLYPH_SLOTS) {
      assert.equal(dom.window.document.querySelector(`[data-nav-sidebar="${slot.nav}"] i`).className,
        slot.fallback, `${slot.nav} must look exactly as it does today`);
    }
  });
});

test('one slot changed repaints ONLY that slot', () => {
  withDom(SHELL, (dom) => {
    common.applyLibraryGlyphs({ glyphBooks: 'school' });
    assert.equal(dom.window.document.querySelector('[data-nav-sidebar="books"] i').className, 'icon-school');
    for (const slot of LIBRARY_GLYPH_SLOTS.filter((s) => s.key !== 'glyphBooks')) {
      assert.equal(dom.window.document.querySelector(`[data-nav-sidebar="${slot.nav}"] i`).className,
        slot.fallback, `${slot.nav} was collaterally repainted`);
    }
  });
});

test('a garbage stored value repaints to the shipped glyph, never an injected class', () => {
  withDom(SHELL, (dom) => {
    common.applyLibraryGlyphs({ glyphBooks: '"><img src=x onerror=alert(1)>' });
    const i = dom.window.document.querySelector('[data-nav-sidebar="books"] i');
    assert.equal(i.className, 'icon-books');
    assert.equal(dom.window.document.querySelectorAll('img').length, 0);
  });
});

// ---- the late injector ----------------------------------------------------

test('LATE INJECTION: an entry injected AFTER the fetch still gets the chosen glyph', () => {
  withDom(SHELL, () => {
    common.applyLibraryGlyphs({ glyphPodcasts: 'radio' });
    // The async capability probe lands now, building a fresh entry with its
    // shipped default as the caller's fallback.
    assert.equal(common.libraryGlyphClassFor('podcasts', 'icon-podcast'), 'icon-radio',
      'a late-injected entry must pick up the stored choice, not the caller default');
    assert.equal(common.libraryGlyphClassFor('books', 'icon-books'), 'icon-books',
      'and an unset slot still takes the caller default');
    assert.equal(common.libraryGlyphClassFor('not-a-slot', 'icon-folder'), 'icon-folder',
      'an unknown nav key falls through to the caller default');
  });
});

// ---- the Playlists sheet mirror -------------------------------------------

test('the Playlists sheet MIRRORS each entry\'s glyph off the sidebar, so the two cannot disagree', () => {
  withDom(SHELL, () => {
    common.applyLibraryGlyphs({ glyphMusic: 'music-note', glyphHistory: 'archive' });
    const html = common.libraryEntriesHtml();
    assert.match(html, /<i class="icon-music-note"><\/i> Music/, 'Music mirrors the chosen glyph');
    assert.match(html, /<i class="icon-archive"><\/i> History/, 'History mirrors the chosen glyph');
    assert.match(html, /<i class="icon-books"><\/i> Books/, 'an unchosen entry mirrors its shipped glyph');
  });
});

test('the sheet mirror refuses a non-resolver-shaped class from the DOM', () => {
  // Defence in depth: the mirror reads a class OUT of the DOM and writes it
  // back into string-built innerHTML. If anything ever manages to put a junk
  // class on a sidebar entry, it must not become an injection vector.
  withDom('<body><a data-nav-sidebar="books" href="/x"><i class="evil&quot;&gt;&lt;img src=x&gt;"></i></a></body>', () => {
    const html = common.libraryEntriesHtml();
    assert.match(html, /<i class="icon-books"><\/i> Books/, 'fell back to the shipped glyph');
    assert.ok(!html.includes('<img'), 'no markup escaped through the mirror');
  });
});
