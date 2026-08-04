'use strict';

// ---- v1.77 Stop E: the two Settings pickers --------------------------------
//
// Dean: "we have to add a little drop down in the settings menu for the
// folders. and for books and podcasts."
//
// Two pickers, two DELIBERATELY DIFFERENT persistence postures, and getting
// them crossed is the interesting failure:
//   - FOLDER glyph: mutates folderSettings and waits for the existing Save
//     button (POST /api/config). A change followed by no Save must persist
//     NOTHING - the wizard list's established contract.
//   - LIBRARY glyph: per-user server truth, one POST /api/me/settings per
//     change, no Save button and no localStorage (the v1.67 corner posture).
//
// Both are asserted as RENDERED DOM plus the actual network effect, not as
// option-list return values. A correct list that nothing renders, or renders
// through the wrong persistence path, is the decision-vs-use trap.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const setup = require('../../public/js/setup.js');
const common = require('../../public/js/common.js');
const { GLYPH_POOL, DEFAULT_FOLDER_GLYPH, LIBRARY_GLYPH_SLOTS, resolveLibraryGlyphClass,
  resolveFolderGlyphClass } = require('../../public/js/glyph-pool.js');

function withDom(html, fn, opts) {
  const o = opts || {};
  const dom = new JSDOM(html, { url: 'http://localhost/setup.html' });
  const posts = [];
  global.document = dom.window.document;
  global.window = dom.window;
  global.GLYPH_POOL = GLYPH_POOL;
  global.DEFAULT_FOLDER_GLYPH = DEFAULT_FOLDER_GLYPH;
  global.LIBRARY_GLYPH_SLOTS = LIBRARY_GLYPH_SLOTS;
  global.resolveLibraryGlyphClass = resolveLibraryGlyphClass;
  global.resolveFolderGlyphClass = resolveFolderGlyphClass;
  global.applyLibraryGlyphs = common.applyLibraryGlyphs;
  global.visibleSidebarFolders = common.visibleSidebarFolders;
  global.isSyntheticFolder = common.isSyntheticFolder;
  global.wireReorderable = common.wireReorderable;
  global.applyLikedSidebarEntry = () => {};
  global.showToast = () => {};
  global.escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  global.fetch = (url, init) => {
    if (init && init.method === 'POST') posts.push({ url: String(url), body: JSON.parse(init.body) });
    return Promise.resolve({
      ok: o.saveFails !== true,
      status: o.saveFails ? 500 : 200,
      json: async () => ({ settings: o.serverSettings || {} }),
    });
  };
  const cleanup = () => {
    for (const k of ['document', 'window', 'GLYPH_POOL', 'DEFAULT_FOLDER_GLYPH', 'LIBRARY_GLYPH_SLOTS',
      'resolveLibraryGlyphClass', 'resolveFolderGlyphClass', 'applyLibraryGlyphs', 'visibleSidebarFolders',
      'isSyntheticFolder', 'wireReorderable', 'applyLikedSidebarEntry', 'showToast', 'escapeHtml', 'fetch']) {
      delete global[k];
    }
    dom.window.close();
  };
  const done = (v) => { cleanup(); return v; };
  try {
    const r = fn(dom, { posts });
    return r && typeof r.then === 'function' ? r.then(done, (e) => { cleanup(); throw e; }) : done(r);
  } catch (e) { cleanup(); throw e; }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// ---- the option list (the decision) ---------------------------------------

// buildGlyphOptionsHtml reads the registry as a browser global (glyph-pool.js
// is a script tag before setup.js), so even the pure-decision tests run inside
// the harness that provides it.
test('the folder option list offers every pool glyph and no Default row', () => {
  withDom('<body></body>', () => {
  const html = setup.buildGlyphOptionsHtml('shows', false);
  assert.equal((html.match(/<option /g) || []).length, GLYPH_POOL.length);
  assert.ok(!html.includes('value="default"'),
    'a folder always HAS a glyph - Folder is a real pool member, so a Default row would be a second way to say the same thing');
  assert.match(html, /<option value="shows" selected>Shows<\/option>/);
  });
});

test('a folder with no stored glyph shows Folder selected', () => {
  withDom('<body></body>', () => {
    for (const v of [undefined, null, '', 'garbage']) {
      assert.match(setup.buildGlyphOptionsHtml(v, false), /<option value="folder" selected>/,
        `expected Folder preselected for ${JSON.stringify(v)}`);
    }
  });
});

test('the library option list leads with Default, selected when nothing valid is stored', () => {
  withDom('<body></body>', () => {
  const html = setup.buildGlyphOptionsHtml(undefined, true);
  assert.match(html, /^<option value="default" selected>Default<\/option>/);
  assert.equal((html.match(/<option /g) || []).length, GLYPH_POOL.length + 1);
  // A real stored choice moves the selection off Default.
  const chosen = setup.buildGlyphOptionsHtml('radio', true);
  assert.match(chosen, /<option value="default">Default<\/option>/);
  assert.match(chosen, /<option value="radio" selected>Radio<\/option>/);
  });
});

// ---- the folder picker (the use) ------------------------------------------

const SETUP_SHELL = '<body><div id="folders-builder-list"></div>' +
  '<div id="sidebar"><div id="sidebar-folders-list"></div></div></body>';

test('FOLDER PICKER: every wizard row renders a select preset to that folder\'s glyph', () => {
  withDom(SETUP_SHELL, (dom) => {
    setup.__setFolderStateForTests({
      folders: ['/m/shows', '/m/plain'],
      settings: { '/m/shows': { glyph: 'shows' } },
      synthetic: [], controller: new dom.window.AbortController(),
    });
    setup.renderFolders();
    const sels = dom.window.document.querySelectorAll('.folder-glyph-select');
    assert.equal(sels.length, 2, 'one picker per folder row');
    assert.equal(sels[0].value, 'shows');
    assert.equal(sels[1].value, 'folder', 'an unset folder shows the default');
  });
});

test('FOLDER PICKER: choosing a glyph updates the row AND the live sidebar preview', () => {
  withDom(SETUP_SHELL, (dom) => {
    setup.__setFolderStateForTests({
      folders: ['/m/a'], settings: {}, synthetic: [],
      controller: new dom.window.AbortController(),
    });
    setup.renderFolders();
    setup.renderSidebarFolders(['/m/a'], {});
    const before = dom.window.document.querySelector('#sidebar-folders-list .sidebar-item i');
    assert.equal(before.className, 'icon-folder');

    const sel = dom.window.document.querySelector('.folder-glyph-select');
    sel.value = 'school';
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    const after = dom.window.document.querySelector('#sidebar-folders-list .sidebar-item i');
    assert.equal(after.className, 'icon-school',
      'the preview must repaint - a picker whose effect you cannot see until you save and reload is not a picker');
  });
});

test('FOLDER PICKER: a change persists NOTHING until Save (the wizard contract)', async () => {
  await withDom(SETUP_SHELL, async (dom, ctx) => {
    setup.__setFolderStateForTests({
      folders: ['/m/a'], settings: {}, synthetic: [],
      controller: new dom.window.AbortController(),
    });
    setup.renderFolders();
    const sel = dom.window.document.querySelector('.folder-glyph-select');
    sel.value = 'games';
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flush();
    assert.deepEqual(ctx.posts, [],
      'this list has a Save button - a pick followed by no Save must reach the network never');
  });
});

// ---- the library picker (the use) -----------------------------------------

const LIB_SHELL = '<body><div id="library-glyph-editor"></div>' +
  LIBRARY_GLYPH_SLOTS.map((s) => `<a data-nav-sidebar="${s.nav}"><i class="${s.fallback}"></i></a>`).join('') +
  '</body>';

test('LIBRARY PICKER: one row per slot, each labelled and preset from the user record', async () => {
  await withDom(LIB_SHELL, async (dom) => {
    await setup.renderLibraryGlyphEditor();
    await flush();
    const rows = dom.window.document.querySelectorAll('#library-glyph-editor .card-corner-editor-row');
    assert.equal(rows.length, LIBRARY_GLYPH_SLOTS.length, 'every Library entry gets a picker (ruling 5)');
    const labels = [...rows].map((r) => r.querySelector('.card-corner-editor-label').textContent);
    assert.deepEqual(labels, LIBRARY_GLYPH_SLOTS.map((s) => s.name));
    assert.equal(dom.window.document.querySelectorAll('#library-glyph-editor select')[2].value, 'default');
  }, { serverSettings: {} });
});

test('LIBRARY PICKER: a stored choice is preselected', async () => {
  await withDom(LIB_SHELL, async (dom) => {
    await setup.renderLibraryGlyphEditor();
    await flush();
    const sel = dom.window.document.querySelectorAll('#library-glyph-editor select')[2]; // Books
    assert.equal(sel.value, 'school');
  }, { serverSettings: { glyphBooks: 'school' } });
});

test('LIBRARY PICKER: a change POSTs ONE key and repaints the live entry immediately', async () => {
  await withDom(LIB_SHELL, async (dom, ctx) => {
    await setup.renderLibraryGlyphEditor();
    await flush();
    const sel = dom.window.document.querySelectorAll('#library-glyph-editor select')[3]; // Podcasts
    sel.value = 'radio';
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flush();

    assert.equal(ctx.posts.length, 1, 'exactly one POST');
    assert.match(ctx.posts[0].url, /\/api\/me\/settings$/);
    assert.deepEqual(ctx.posts[0].body, { glyphPodcasts: 'radio' },
      'one key per change - never the whole settings blob');
    assert.equal(dom.window.document.querySelector('[data-nav-sidebar="podcasts"] i').className,
      'icon-radio', 'the live sidebar entry repaints without a reload');
    // The FIXTURE is what makes the assertion above able to fail (adversarial
    // gate W4, the divergent-fixture class this repo keeps re-learning). With
    // `serverSettings: {}` the one-key body and the whole-blob body are the
    // SAME object, so posting the entire settings blob passed - and that mutant
    // is a real outage: /api/me/settings is a hard allowlist that 400s on any
    // key outside MIRRORED_SETTING_KEYS, so every library-glyph save would fail
    // the moment a user record carried one non-mirrored key. The fixture below
    // carries exactly such keys, so the two spellings diverge.
  }, { serverSettings: { theme: 'dark', era: '2009', glyphBooks: 'school' } });
});

test('LIBRARY PICKER: keyboard users are not stranded by the redraw', async () => {
  // The QA S2 fix the corner editor earned: redrawing destroys the focused
  // <select>, and Firefox fires `change` on EVERY arrow press - so without
  // re-focusing the same slot's fresh select, one arrow key ends the
  // interaction.
  await withDom(LIB_SHELL, async (dom) => {
    await setup.renderLibraryGlyphEditor();
    await flush();
    const sel = dom.window.document.querySelectorAll('#library-glyph-editor select')[1];
    sel.value = 'games';
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    const focused = dom.window.document.activeElement;
    assert.equal(focused.tagName, 'SELECT');
    assert.equal([...dom.window.document.querySelectorAll('#library-glyph-editor select')].indexOf(focused), 1,
      'focus must land on the SAME slot after the redraw');
  }, { serverSettings: {} });
});

test('LIBRARY PICKER: a failed save re-seeds from the server rather than lying', async () => {
  await withDom(LIB_SHELL, async (dom) => {
    await setup.renderLibraryGlyphEditor();
    await flush();
    const sel = dom.window.document.querySelectorAll('#library-glyph-editor select')[2];
    sel.value = 'work';
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flush(); await flush();
    const after = dom.window.document.querySelectorAll('#library-glyph-editor select')[2];
    assert.equal(after.value, 'default',
      'the UI must not keep showing a choice the server rejected');
  }, { serverSettings: {}, saveFails: true });
});
