'use strict';

// [UNIT] v1.339 S2 (plan docs/exec-plans/active/2026-09-26-fouc-toctou-audit.md,
// finding T-C1, decision D2): the Settings folder form's Save is
// compare-and-set. loadConfig() remembers the `configVersion` the form was
// built from; saveFolderConfig() POSTs it as `baseVersion`; a 409 (another
// device changed the folder config since) shows "Folders changed on another
// device - reloaded, review and save again" as an error status and reloads the
// form from storage, which also takes the new base. Driven through the REAL
// setup.js functions in jsdom, with a fetch stub standing in for the server.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const common = require('../../public/js/common.js');
const setup = require('../../public/js/setup.js');
const glyphPool = require('../../public/js/glyph-pool.js');

const MESSAGE = 'Folders changed on another device - reloaded, review and save again';
const SHELL = '<body><div id="sidebar"><div id="sidebar-folders-list"></div></div>'
  + '<div id="folders-builder-list"></div><div id="scan-status"></div></body>';

async function withSetup(opts, fn) {
  const dom = new JSDOM(SHELL, { url: 'http://localhost/setup.html' });
  const globals = {
    document: dom.window.document,
    window: dom.window,
    moveArrayItem: common.moveArrayItem,
    computeDropIndex: common.computeDropIndex,
    rebuildFullFolderOrder: common.rebuildFullFolderOrder,
    visibleSidebarFolders: common.visibleSidebarFolders,
    isSyntheticFolder: common.isSyntheticFolder,
    wireReorderable: common.wireReorderable,
    sidebarMoveAnchor: common.sidebarMoveAnchor,
    applySidebarMoveByPath: common.applySidebarMoveByPath,
    persistSidebarMoveByPath: common.persistSidebarMoveByPath,
    setActionStatus: common.setActionStatus,
    escapeHtml: common.escapeHtml,
    resolveFolderGlyphClass: glyphPool.resolveFolderGlyphClass,
    GLYPH_POOL: glyphPool.GLYPH_POOL, // the folder form's glyph pickers (renderFolders)
    DEFAULT_FOLDER_GLYPH: glyphPool.DEFAULT_FOLDER_GLYPH,
    applyLikedSidebarEntry: () => {},
  };
  const posts = [];
  const gets = [];
  globals.fetch = (url, init) => {
    if (init && init.method === 'POST') {
      const body = JSON.parse(init.body);
      posts.push({ url, body });
      const { status, json } = opts.onPost(posts.length, body);
      return Promise.resolve({ ok: status === 200, status, json: async () => json });
    }
    gets.push(url);
    const cfg = opts.onGet(gets.length, url);
    return Promise.resolve({ ok: true, status: 200, json: async () => cfg });
  };
  for (const [k, v] of Object.entries(globals)) global[k] = v;
  const controller = new dom.window.AbortController();
  controller.abort(); // pollScanStatus (the success path's follow-up) stops at once
  setup.__setFolderStateForTests({
    folders: opts.folders || [], settings: opts.settings || {}, synthetic: [], controller,
    configVersion: Object.prototype.hasOwnProperty.call(opts, 'configVersion') ? opts.configVersion : null,
  });
  try {
    return await fn(dom, { posts, gets, statusEl: dom.window.document.getElementById('scan-status') });
  } finally {
    for (const k of Object.keys(globals)) delete global[k];
    dom.window.close();
  }
}

test('S2: a Save whose base is STALE shows the conflict message as an error, reloads the form from storage, and takes the new base', async () => {
  const stored = {
    folders: ['/media/a', '/media/b', '/media/c'],
    folderSettings: { '/media/c': { name: 'Sea' } },
    syntheticFolders: [], folderDisplayNames: {}, configVersion: 'v-new',
  };
  await withSetup({
    folders: ['/media/a', '/media/b'], settings: {}, configVersion: 'v-old',
    onPost: () => ({ status: 409, json: { error: 'stale', configVersion: 'v-new' } }),
    onGet: () => stored,
  }, async (dom, ctx) => {
    await setup.saveFolderConfig(ctx.statusEl);
    assert.equal(ctx.posts.length, 1, 'one POST - a refused Save is never retried behind the user');
    assert.equal(ctx.posts[0].body.baseVersion, 'v-old', 'the base the form was loaded with rides along');
    assert.deepEqual(ctx.posts[0].body.folders, ['/media/a', '/media/b']);
    assert.equal(ctx.statusEl.textContent, MESSAGE);
    assert.ok(ctx.statusEl.classList.contains('action-status-error'), 'shown as an error');
    assert.ok(!ctx.statusEl.classList.contains('action-status-busy'), 'the busy state cleared');
    assert.deepEqual(ctx.gets, ['/api/config'], 'the config was reloaded');
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), stored.folders, 'the form now holds the stored folders (c included)');
    assert.ok(dom.window.document.getElementById('folders-builder-list').textContent.includes('/media/c'), 'and the form re-rendered with c');
    assert.deepEqual(Array.from(dom.window.document.querySelectorAll('#sidebar-folders-list .sidebar-item')).map((a) => a.getAttribute('title')),
      stored.folders, 'the sidebar re-rendered from storage too');
    assert.equal(setup.__getConfigBaseVersionForTests(), 'v-new', 'the next Save is built on the reloaded base');
  });
});

test('S2: loadConfig seeds the base, a Save sends it, and a successful Save adopts the returned version for the next one', async () => {
  let saves = 0;
  await withSetup({
    folders: [], settings: {},
    onGet: () => ({ folders: ['/media/a'], folderSettings: {}, syntheticFolders: [], folderDisplayNames: {}, configVersion: 'v-load' }),
    onPost: () => { saves++; return { status: 200, json: { success: true, folders: ['/media/a'], folderSettings: {}, configVersion: 'v-save' + saves } }; },
  }, async (dom, ctx) => {
    await setup.loadConfig();
    assert.equal(setup.__getConfigBaseVersionForTests(), 'v-load');
    await setup.saveFolderConfig(ctx.statusEl);
    assert.equal(ctx.posts[0].body.baseVersion, 'v-load', 'the Save carries the loaded base');
    assert.equal(setup.__getConfigBaseVersionForTests(), 'v-save1');
    await setup.saveFolderConfig(ctx.statusEl);
    assert.equal(ctx.posts[1].body.baseVersion, 'v-save1', 'a second Save is based on the first one, never a spurious 409');
    assert.notEqual(ctx.statusEl.textContent, MESSAGE);
  });
});

test('S2: with no known base (an old server), the Save omits baseVersion - the legacy path', async () => {
  await withSetup({
    folders: ['/media/a'], settings: {}, configVersion: null,
    onGet: () => ({}),
    onPost: () => ({ status: 200, json: { success: true, folders: ['/media/a'], folderSettings: {} } }),
  }, async (dom, ctx) => {
    await setup.saveFolderConfig(ctx.statusEl);
    assert.ok(!Object.prototype.hasOwnProperty.call(ctx.posts[0].body, 'baseVersion'));
  });
});
