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
  global.fetch = (url, init) => {
    if (init && init.method === 'POST') posts.push({ url, body: JSON.parse(init.body) });
    return Promise.resolve({ ok: true, json: async () => ({ success: true, folders: [], folderSettings: {} }) });
  };
  const controller = new dom.window.AbortController();
  setup.__setFolderStateForTests({ folders: o.folders || [], settings: o.settings || {}, synthetic: o.synthetic || [], controller });
  const cleanup = () => {
    for (const k of ['document', 'window', 'moveArrayItem', 'computeDropIndex', 'rebuildFullFolderOrder',
      'visibleSidebarFolders', 'isSyntheticFolder', 'wireReorderable', 'applyLikedSidebarEntry', 'fetch',
      'resolveFolderGlyphClass']) delete global[k];
    dom.window.close();
  };
  let result;
  try {
    setup.renderSidebarFolders(o.folders || [], o.settings || {});
    result = fn(dom, { posts });
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
