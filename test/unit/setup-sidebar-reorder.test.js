'use strict';

// [UNIT] v1.76 T5 - the Setup page's sidebar PREVIEW, migrated from its own
// copy of the native HTML5 DnD wiring to the shared pointer gesture layer.
//
// This surface is where the interesting persist chain lives, and it is
// UNCHANGED by the migration: a drop persists immediately (there is no Save
// button on a sidebar), through
//   moveArrayItem -> rebuildFullFolderOrder -> POST /api/config
// with hidden-from-sidebar and synthetic folders holding their ABSOLUTE
// positions in the submitted array - they never appear in the sidebar to be
// dragged, so a reorder of the visible subset must not move them.
//
// main.js's home sidebar is the same code against the same helpers; it lives
// inside a registered view closure with no test seam (as it did before this
// wave), so its binding here is the shared helper's own suite plus Dean's
// device pass. Stated plainly rather than papered over.
//
// v1.339 S2 (T-C1): the persist chain is now "record the move BY PATH, re-GET
// the config at drop time, apply the move onto THAT list, POST it with the
// fresh folderSettings + baseVersion, retry once on 409". The fetch stub
// answers the GET with the server's config, so the tests above still see their
// own lists come back; the S2 tests at the bottom make the server's config
// DIFFER from the page's. main.js's home sidebar now has a behavioural test of
// its own too: test/integration/home-sidebar-reorder-cas.test.js boots the real
// index.html.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const common = require('../../public/js/common.js');
const setup = require('../../public/js/setup.js');
// v1.77: the glyph registry is a real script tag on every shell, loaded before
// common.js. This harness stands in for the browser's script loading, so it has
// to provide it too - the folder-row renderer calls resolveFolderGlyphClass.
const glyphPool = require('../../public/js/glyph-pool.js');

const SHELL = '<body><div id="sidebar"><div id="sidebar-folders-list"></div></div></body>';

function withSidebar(fn, opts) {
  const o = opts || {};
  const dom = new JSDOM(SHELL, { url: 'http://localhost/setup.html' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.moveArrayItem = common.moveArrayItem;
  global.computeDropIndex = common.computeDropIndex;
  global.rebuildFullFolderOrder = common.rebuildFullFolderOrder;
  global.visibleSidebarFolders = common.visibleSidebarFolders;
  global.isSyntheticFolder = common.isSyntheticFolder;
  global.wireReorderable = common.wireReorderable;
  // v1.339 S2: the drop now persists by path onto a FRESH GET (common.js).
  global.sidebarMoveAnchor = common.sidebarMoveAnchor;
  global.applySidebarMoveByPath = common.applySidebarMoveByPath;
  global.persistSidebarMoveByPath = common.persistSidebarMoveByPath;
  global.resolveFolderGlyphClass = glyphPool.resolveFolderGlyphClass;
  // The count-gated Liked entry prepends a `.sidebar-item` WITHOUT a
  // data-index. Stood in for here (its own behaviour is tested elsewhere)
  // precisely so this file can prove it is never a drag target.
  global.applyLikedSidebarEntry = (container) => {
    const liked = container.ownerDocument.createElement('a');
    liked.className = 'sidebar-item';
    liked.href = '/?liked=1';
    liked.textContent = 'Liked';
    container.insertBefore(liked, container.firstChild);
  };
  const posts = [];
  const gets = [];
  // v1.339 S2: the GET answers with the SERVER's config - by default the same
  // lists the page rendered, or `o.server` (a config another device changed
  // after this page loaded; a function of the 1-based GET count for per-call state).
  // `o.postStatus(n)` picks each POST's status (409 = a stale base).
  const serverConfig = () => {
    const srv = typeof o.server === 'function' ? o.server(gets.length) : o.server;
    return srv || { folders: o.folders || [], folderSettings: o.settings || {}, syntheticFolders: o.synthetic || [], configVersion: 'v-page' };
  };
  global.fetch = (url, init) => {
    if (init && init.method === 'POST') {
      posts.push({ url, body: JSON.parse(init.body) });
      const status = o.postStatus ? o.postStatus(posts.length) : 200;
      if (status === 409) return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'stale', configVersion: 'v-moved' }) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, folders: [], folderSettings: {} }) });
    }
    gets.push(url);
    // v1.339 r1: `o.getFails` = the GET rejects (network) or answers 500.
    if (o.getFails === 'network') return Promise.reject(new TypeError('Failed to fetch'));
    if (o.getFails === 500) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Internal Server Error' }) });
    const cfg = serverConfig();
    return Promise.resolve({ ok: true, status: 200, json: async () => cfg });
  };
  const controller = new dom.window.AbortController();
  setup.__setFolderStateForTests({ folders: o.folders || [], settings: o.settings || {}, synthetic: o.synthetic || [], controller });
  const cleanup = () => {
    for (const k of ['document', 'window', 'moveArrayItem', 'computeDropIndex', 'rebuildFullFolderOrder',
      'visibleSidebarFolders', 'isSyntheticFolder', 'wireReorderable', 'applyLikedSidebarEntry', 'fetch',
      'resolveFolderGlyphClass', 'sidebarMoveAnchor', 'applySidebarMoveByPath', 'persistSidebarMoveByPath']) delete global[k];
    dom.window.close();
  };
  let result;
  try {
    setup.renderSidebarFolders(o.folders || [], o.settings || {});
    result = fn(dom, { posts, gets });
  } catch (err) { cleanup(); throw err; }
  if (result && typeof result.then === 'function') {
    return result.then((v) => { cleanup(); return v; }, (e) => { cleanup(); throw e; });
  }
  cleanup();
  return result;
}

const draggableRows = (dom) =>
  Array.prototype.slice.call(dom.window.document.querySelectorAll('#sidebar-folders-list .sidebar-item[data-index]'));

function layOut(rows) {
  rows.forEach((row, i) => { row.getBoundingClientRect = () => ({ top: i * 30, bottom: i * 30 + 30, height: 30 }); });
}

function drag(dom, rows, from, clientY) {
  const at = (el, type, y) => el.dispatchEvent(new dom.window.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: y,
  }));
  const start = from * 30 + 5;
  at(rows[from], 'pointerdown', start);
  at(dom.window.document, 'pointermove', start + 10);
  at(dom.window.document, 'pointermove', clientY);
  at(dom.window.document, 'pointerup', clientY);
}

const THREE = ['/media/a', '/media/b', '/media/c'];

test('v1.76: sidebar rows turn native HTML5 drag OFF explicitly', () => {
  // QA gate C1: these rows ARE <a> elements, which are draggable by UA
  // default - so the attribute must say `false`, not simply be absent.
  withSidebar((dom) => {
    const rows = draggableRows(dom);
    assert.equal(rows.length, 3);
    for (const row of rows) assert.equal(row.getAttribute('draggable'), 'false');
  }, { folders: THREE });
});

test('v1.76: a pointer drag persists the reordered folders immediately (no Save button here)', async () => {
  await withSidebar(async (dom, ctx) => {
    const rows = draggableRows(dom);
    layOut(rows);
    drag(dom, rows, 0, 2 * 30 + 22); // bottom half of the last row
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(ctx.posts.length, 1, 'exactly one POST');
    assert.equal(ctx.posts[0].url, '/api/config');
    assert.deepEqual(ctx.posts[0].body.folders, ['/media/b', '/media/c', '/media/a']);
  }, { folders: THREE });
});

test('v1.76: a hidden-from-sidebar folder keeps its ABSOLUTE position through a visible-subset drag', () => {
  // /media/hidden never renders in the sidebar, so it cannot be dragged - and
  // must not be shuffled by someone else's drag either. This is the property
  // rebuildFullFolderOrder exists for, re-proven through the new gesture.
  const folders = ['/media/a', '/media/hidden', '/media/b', '/media/c'];
  const settings = { '/media/hidden': { hiddenFromSidebar: true } };
  return withSidebar(async (dom, ctx) => {
    const rows = draggableRows(dom);
    assert.equal(rows.length, 3, 'only the three visible folders render');
    layOut(rows);
    drag(dom, rows, 0, 2 * 30 + 22);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(ctx.posts[0].body.folders, ['/media/b', '/media/hidden', '/media/c', '/media/a']);
    assert.equal(ctx.posts[0].body.folders[1], '/media/hidden', 'index 1 was and stays the hidden folder');
  }, { folders, settings });
});

test('v1.76: the injected Liked entry is never a drag target', () => {
  // It is not a db.folders row; dropping onto it would corrupt the order.
  return withSidebar(async (dom, ctx) => {
    const all = Array.prototype.slice.call(dom.window.document.querySelectorAll('#sidebar-folders-list .sidebar-item'));
    assert.equal(all.length, 4, 'Liked + three folders');
    assert.equal(all[0].getAttribute('data-index'), null, 'Liked has no index');
    const rows = draggableRows(dom);
    layOut(rows);
    drag(dom, rows, 2, 5); // onto the FIRST folder row's top half
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(ctx.posts[0].body.folders, ['/media/c', '/media/a', '/media/b'],
      'the drag is indexed against the folder rows, not the rendered children');
  }, { folders: THREE });
});

test('v1.76: a drop that changes nothing sends no POST', () => {
  return withSidebar(async (dom, ctx) => {
    const rows = draggableRows(dom);
    layOut(rows);
    drag(dom, rows, 1, 30 + 5); // row 1 onto its own top half
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(ctx.posts, [], 'no write for a no-op gesture');
  }, { folders: THREE });
});

test('v1.76: a plain click on a sidebar row is still a navigation, not a drag', () => {
  // These rows are links; arming on bare mousedown would break the sidebar.
  return withSidebar(async (dom, ctx) => {
    const rows = draggableRows(dom);
    layOut(rows);
    const at = (el, type, y) => el.dispatchEvent(new dom.window.PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: y,
    }));
    at(rows[0], 'pointerdown', 5);
    at(dom.window.document, 'pointerup', 5);
    const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    rows[0].dispatchEvent(click);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(click.defaultPrevented, false, 'the navigation is allowed through');
    assert.deepEqual(ctx.posts, []);
  }, { folders: THREE });
});

// ---- v1.339 S2 (T-C1): the drop persists by path onto the FRESH config -----

test('S2: a drop POSTs the FRESH config - a folder another device added after this page loaded survives, with the fresh settings and baseVersion', () => {
  // The page rendered [a, b]; the server now holds [a, b, c] with a rename on b.
  const server = {
    folders: ['/media/a', '/media/b', '/media/c'],
    folderSettings: { '/media/b': { name: 'Bee' }, '/media/c': { name: 'Sea' } },
    syntheticFolders: [], configVersion: 'v-fresh',
  };
  return withSidebar(async (dom, ctx) => {
    const rows = draggableRows(dom);
    assert.equal(rows.length, 2, 'populated: the page shows its stale two rows');
    layOut(rows);
    drag(dom, rows, 0, 30 + 22); // a -> after b
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(ctx.posts.length, 1, 'exactly one POST');
    const body = ctx.posts[0].body;
    assert.deepEqual(body.folders, ['/media/b', '/media/a', '/media/c'], 'the move applied by path onto the fresh list; c kept');
    assert.deepEqual(body.folderSettings, server.folderSettings, 'the FRESH settings, not the page copy');
    assert.equal(body.baseVersion, 'v-fresh', 'the fresh version rides as baseVersion');
    assert.equal(ctx.gets[0], '/api/config', 'the config was re-read at drop time');
  }, { folders: ['/media/a', '/media/b'], settings: {}, server });
});

test('S2: a 409 retries ONCE from a fresh GET, carrying the newer base', () => {
  const v1 = { folders: ['/media/a', '/media/b', '/media/c'], folderSettings: {}, syntheticFolders: [], configVersion: 'v1' };
  const v2 = { folders: ['/media/a', '/media/b', '/media/c', '/media/d'], folderSettings: { '/media/d': { name: 'Dee' } }, syntheticFolders: [], configVersion: 'v2' };
  return withSidebar(async (dom, ctx) => {
    const rows = draggableRows(dom);
    layOut(rows);
    drag(dom, rows, 2, 5); // c -> before a
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(ctx.posts.length, 2, 'the 409 was retried exactly once');
    assert.equal(ctx.posts[0].body.baseVersion, 'v1');
    assert.equal(ctx.posts[1].body.baseVersion, 'v2', 'the retry is built from the NEW GET');
    assert.deepEqual(ctx.posts[1].body.folders, ['/media/c', '/media/a', '/media/b', '/media/d']);
    assert.deepEqual(ctx.posts[1].body.folderSettings, v2.folderSettings);
  }, { folders: THREE, server: (n) => (n === 1 ? v1 : v2), postStatus: (n) => (n === 1 ? 409 : 200) });
});

test('S2: a SECOND 409 gives up - no third POST - and the sidebar re-renders from the fresh config', () => {
  const fresh = { folders: ['/media/a', '/media/b', '/media/c', '/media/new'], folderSettings: {}, syntheticFolders: [], configVersion: 'v9' };
  return withSidebar(async (dom, ctx) => {
    const rows = draggableRows(dom);
    layOut(rows);
    drag(dom, rows, 0, 2 * 30 + 22);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(ctx.posts.length, 2, 'one retry, then nothing else');
    const shown = draggableRows(dom).map((r) => r.getAttribute('title'));
    assert.deepEqual(shown, fresh.folders, 'the stale list was replaced by the stored one');
  }, { folders: THREE, server: fresh, postStatus: () => 409 });
});

test('S2: a dragged folder that is no longer a visible row in the fresh config writes NOTHING and re-renders', () => {
  // Another device removed /media/a; the drop must not resurrect it.
  const fresh = { folders: ['/media/b', '/media/c'], folderSettings: {}, syntheticFolders: [], configVersion: 'v3' };
  return withSidebar(async (dom, ctx) => {
    const rows = draggableRows(dom);
    layOut(rows);
    drag(dom, rows, 0, 2 * 30 + 22);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(ctx.posts, [], 'no write built on a folder that is gone');
    assert.deepEqual(draggableRows(dom).map((r) => r.getAttribute('title')), ['/media/b', '/media/c'], 're-rendered from storage');
  }, { folders: THREE, server: fresh });
});

test('S2: a synthetic folder keeps its absolute position through the by-path move (the FRESH synthetic list is threaded)', () => {
  // /dl is the yt-dlp Downloads root: in GET's folders, never a sidebar row.
  const fresh = { folders: ['/media/a', '/dl', '/media/b', '/media/c'], folderSettings: { '/dl': { name: 'Downloads' } }, syntheticFolders: ['/dl'], configVersion: 'v4' };
  return withSidebar(async (dom, ctx) => {
    const rows = draggableRows(dom);
    assert.equal(rows.length, 3, 'populated: the synthetic root is not a row');
    layOut(rows);
    drag(dom, rows, 0, 2 * 30 + 22); // a -> after c
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(ctx.posts[0].body.folders, ['/media/b', '/dl', '/media/c', '/media/a'], 'index 1 stays the synthetic root');
  }, { folders: ['/media/a', '/dl', '/media/b', '/media/c'], synthetic: ['/dl'], server: fresh });
});

// ---- v1.339 r1 (gate W): a drag never POSTs without a base ------------------

for (const getFails of ['network', 500]) {
  test(`r1 W: a drop whose drop-time GET fails (${getFails}) sends NO POST`, () => {
    return withSidebar(async (dom, ctx) => {
      const rows = draggableRows(dom);
      layOut(rows);
      drag(dom, rows, 0, 2 * 30 + 22);
      await new Promise((r) => setTimeout(r, 0));
      assert.ok(ctx.gets.length >= 1, 'populated: the drop reached its GET');
      assert.deepEqual(ctx.posts, [], 'nothing written from a failed read');
    }, { folders: THREE, getFails });
  });
}

test('r1 W: a drop whose GET carries NO configVersion sends no POST (never the unchecked legacy path)', () => {
  const noVersion = { folders: THREE.slice(), folderSettings: {}, syntheticFolders: [] };
  return withSidebar(async (dom, ctx) => {
    const rows = draggableRows(dom);
    layOut(rows);
    drag(dom, rows, 0, 2 * 30 + 22);
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(ctx.gets.length >= 1, 'populated: the drop reached its GET');
    assert.deepEqual(ctx.posts, [], 'no base-less write');
  }, { folders: THREE, server: noVersion });
});

test('r1 W: persistSidebarMoveByPath resolves error (config null) on a failed GET and never calls POST', async () => {
  const calls = [];
  const fetchImpl = (url, init) => { calls.push(init && init.method); return Promise.reject(new TypeError('Failed to fetch')); };
  const out = await common.persistSidebarMoveByPath({ draggedPath: '/media/a', anchorPath: '/media/b', insertBefore: false }, fetchImpl);
  assert.equal(out.status, 'error');
  assert.equal(out.config, null);
  assert.ok(!calls.includes('POST'));
});
