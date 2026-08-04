'use strict';

// [UNIT] v1.76 T3 - the Setup page's configured-directories list, driven
// through its REAL render and its REAL gesture wiring.
//
// Dean's report: the row's handle "is decorative, at least in the original
// theme", and on desktop the row only dragged "from a small portion of the
// card". Both were true, for two different reasons:
//   - native HTML5 drag (the v1.15.0 mechanism) does not fire on iOS touch at
//     all, so on his phone the handle really was decoration; and
//   - native drag never starts inside a text input, so the display-name field
//     and both checkboxes were dead zones on desktop.
// The fix is the shared pointer-event layer, and these tests bind it here: the
// whole row drags, the interactive children still behave as inputs, and the
// list's DEFERRED persist posture (this list has a Save button, unlike the
// sidebar) is unchanged.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const common = require('../../public/js/common.js');
const setup = require('../../public/js/setup.js');
// v1.77: the wizard rows now carry a glyph <select> built from the shared
// registry, which every shell loads as a script before setup.js.
const { GLYPH_POOL, DEFAULT_FOLDER_GLYPH } = require('../../public/js/glyph-pool.js');

const FOLDERS = ['/media/a', '/media/b', '/media/c'];
const SETTINGS = { '/media/a': { name: 'Alpha' }, '/media/b': {}, '/media/c': { hidden: true } };

function withFolderList(fn, opts) {
  const dom = new JSDOM('<body><div class="folder-list-builder" id="folders-builder-list"></div></body>', {
    url: 'http://localhost/setup.html',
  });
  global.document = dom.window.document;
  global.window = dom.window;
  // setup.js reaches these as plain browser globals (script order:
  // common -> main -> setup). The REAL implementations, never stubs.
  global.moveArrayItem = common.moveArrayItem;
  global.computeDropIndex = common.computeDropIndex;
  global.isSyntheticFolder = common.isSyntheticFolder;
  global.wireReorderable = common.wireReorderable;
  global.GLYPH_POOL = GLYPH_POOL;
  global.DEFAULT_FOLDER_GLYPH = DEFAULT_FOLDER_GLYPH;
  const fetchCalls = [];
  global.fetch = (...args) => { fetchCalls.push(args); return Promise.resolve({ ok: true, json: async () => ({}) }); };
  const controller = new dom.window.AbortController();
  setup.__setFolderStateForTests({
    folders: (opts && opts.folders) || FOLDERS.slice(),
    settings: SETTINGS,
    synthetic: (opts && opts.synthetic) || [],
    controller,
  });
  const cleanup = () => {
    delete global.document;
    delete global.window;
    delete global.moveArrayItem;
    delete global.computeDropIndex;
    delete global.isSyntheticFolder;
    delete global.wireReorderable;
    delete global.GLYPH_POOL;
    delete global.DEFAULT_FOLDER_GLYPH;
    delete global.fetch;
    dom.window.close();
  };
  let result;
  try {
    setup.renderFolders();
    result = fn(dom, { fetchCalls, controller });
  } catch (err) {
    cleanup();
    throw err;
  }
  // The touch test awaits a real long-press timer, so the fixture must outlive
  // an async body -- tearing the window down at the first `return` closed the
  // document out from under it.
  if (result && typeof result.then === 'function') {
    return result.then((v) => { cleanup(); return v; }, (e) => { cleanup(); throw e; });
  }
  cleanup();
  return result;
}

const rowsIn = (dom) => Array.prototype.slice.call(dom.window.document.querySelectorAll('.folder-item-row'));

// jsdom does no layout: give the rows the geometry a browser would.
// 60px rows stacked from 0, which is roughly what the real row measures.
function layOut(rows) {
  rows.forEach((row, i) => { row.getBoundingClientRect = () => ({ top: i * 60, bottom: i * 60 + 60, height: 60 }); });
}

function pointerAt(dom, el, type, clientY, extra) {
  el.dispatchEvent(new dom.window.PointerEvent(type, Object.assign({
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY,
  }, extra || {})));
}

// A full mouse drag from row `from` to `clientY`, through the real listeners.
function drag(dom, rows, from, clientY, pointerType) {
  const start = from * 60 + 10;
  pointerAt(dom, rows[from], 'pointerdown', start, { pointerType: pointerType || 'mouse' });
  pointerAt(dom, dom.window.document, 'pointermove', start + 10, { pointerType: pointerType || 'mouse' });
  pointerAt(dom, dom.window.document, 'pointermove', clientY, { pointerType: pointerType || 'mouse' });
  pointerAt(dom, dom.window.document, 'pointerup', clientY, { pointerType: pointerType || 'mouse' });
}

// ---- the arrows are gone, the handle is the control -------------------------

test('v1.76: the up/down reorder buttons are gone from the directory rows', () => {
  withFolderList((dom) => {
    assert.equal(dom.window.document.querySelectorAll('.reorder-btn').length, 0);
    assert.equal(rowsIn(dom).length, 3, 'the rows themselves still render');
  });
});

test('v1.76: every row turns native HTML5 drag OFF explicitly', () => {
  // The two mechanisms cannot coexist: a native drag started by the browser
  // cancels the pointer gesture out from under it. QA gate C1: "off" must be
  // an explicit `false` rather than an absent attribute, since an absent one
  // means "UA default" and that default is TRUE for some elements.
  withFolderList((dom) => {
    for (const row of rowsIn(dom)) assert.equal(row.getAttribute('draggable'), 'false');
  });
});

test('v1.76: every row has a focusable, ITEM-NAMED handle (the accessibility the buttons carried)', () => {
  withFolderList((dom) => {
    const handles = rowsIn(dom).map((r) => r.querySelector('.drag-handle'));
    assert.equal(handles.filter(Boolean).length, 3);
    assert.equal(handles[0].getAttribute('tabindex'), '0');
    assert.equal(handles[0].getAttribute('role'), 'button');
    // The display name when there is one, the folder's basename otherwise.
    assert.equal(handles[0].getAttribute('aria-label'), 'Reorder Alpha');
    assert.equal(handles[1].getAttribute('aria-label'), 'Reorder b');
    // It is no longer aria-hidden: it is now a real control, not an ornament.
    assert.equal(handles[0].getAttribute('aria-hidden'), null);
  });
});

// ---- the drag itself --------------------------------------------------------

test('v1.76: dragging the first row to the bottom reorders the array', () => {
  withFolderList((dom) => {
    const rows = rowsIn(dom);
    layOut(rows);
    drag(dom, rows, 0, 2 * 60 + 45); // bottom half of the last row
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), ['/media/b', '/media/c', '/media/a']);
  });
});

test('v1.76: dragging upward onto a row\'s top half inserts BEFORE it', () => {
  withFolderList((dom) => {
    const rows = rowsIn(dom);
    layOut(rows);
    drag(dom, rows, 2, 10); // top half of the first row
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), ['/media/c', '/media/a', '/media/b']);
  });
});

test('v1.76: the WHOLE row drags, not just the handle (Dean: "only from a small portion of the card")', () => {
  withFolderList((dom) => {
    const rows = rowsIn(dom);
    layOut(rows);
    // Press on the path text, which is neither the handle nor an input.
    const pathText = rows[0].querySelector('.folder-path-text');
    pointerAt(dom, pathText, 'pointerdown', 10);
    pointerAt(dom, dom.window.document, 'pointermove', 20);
    pointerAt(dom, dom.window.document, 'pointermove', 2 * 60 + 45);
    pointerAt(dom, dom.window.document, 'pointerup', 2 * 60 + 45);
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), ['/media/b', '/media/c', '/media/a']);
  });
});

test('v1.76: a TOUCH long-press drags the row (the whole reason this wave exists)', async () => {
  await withFolderList(async (dom) => {
    const rows = rowsIn(dom);
    layOut(rows);
    pointerAt(dom, rows[0], 'pointerdown', 10, { pointerType: 'touch' });
    await new Promise((r) => setTimeout(r, common.REORDER_LONG_PRESS_MS + 60));
    pointerAt(dom, dom.window.document, 'pointermove', 2 * 60 + 45, { pointerType: 'touch' });
    pointerAt(dom, dom.window.document, 'pointerup', 2 * 60 + 45, { pointerType: 'touch' });
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), ['/media/b', '/media/c', '/media/a']);
  });
});

test('v1.76: a TOUCH swipe that never long-presses leaves the list alone (it is a scroll)', async () => {
  await withFolderList(async (dom) => {
    const rows = rowsIn(dom);
    layOut(rows);
    pointerAt(dom, rows[0], 'pointerdown', 10, { pointerType: 'touch' });
    // Moving straight away is a scroll, not a grab.
    pointerAt(dom, dom.window.document, 'pointermove', 60, { pointerType: 'touch' });
    await new Promise((r) => setTimeout(r, common.REORDER_LONG_PRESS_MS + 60));
    pointerAt(dom, dom.window.document, 'pointermove', 2 * 60 + 45, { pointerType: 'touch' });
    pointerAt(dom, dom.window.document, 'pointerup', 2 * 60 + 45, { pointerType: 'touch' });
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), FOLDERS, 'nothing moved');
  });
});

test('v1.76: a press inside the display-name field never starts a drag', () => {
  // The field must stay a field -- selecting text in it is not a reorder.
  withFolderList((dom) => {
    const rows = rowsIn(dom);
    layOut(rows);
    const input = rows[0].querySelector('.folder-name-input');
    pointerAt(dom, input, 'pointerdown', 10);
    pointerAt(dom, dom.window.document, 'pointermove', 20);
    pointerAt(dom, dom.window.document, 'pointermove', 2 * 60 + 45);
    pointerAt(dom, dom.window.document, 'pointerup', 2 * 60 + 45);
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), FOLDERS, 'the order is untouched');
  });
});

test('v1.76: a press on the "Hide from home" checkbox never starts a drag', () => {
  withFolderList((dom) => {
    const rows = rowsIn(dom);
    layOut(rows);
    const cb = rows[0].querySelector('.folder-hidden-check');
    pointerAt(dom, cb, 'pointerdown', 10);
    pointerAt(dom, dom.window.document, 'pointermove', 2 * 60 + 45);
    pointerAt(dom, dom.window.document, 'pointerup', 2 * 60 + 45);
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), FOLDERS);
  });
});

test('v1.77: a press on the glyph picker never starts a drag', () => {
  // The row is a drag surface and v1.77 added a new interactive child to it.
  // Three things independently make it a dead zone: this list is
  // handleSelector-gated to `.drag-handle`, the picker sits inside a <label>,
  // and `select` is in wireReorderable's REORDER_DEFAULT_IGNORE (common.js).
  // The adversarial gate measured that removing only the `select` token leaves
  // this green - so this test binds the OUTCOME (pressing the picker reorders
  // nothing), not any one of those three mechanisms. Stripping the ignore list
  // entirely does turn it red, so it is not vacuous. Worth having because
  // Dean's v1.76 report was precisely that parts of this row would not drag
  // (and, inversely, that its controls were unusable). A dropdown you cannot
  // open because the row steals the gesture is the same bug wearing a hat.
  withFolderList((dom) => {
    const rows = rowsIn(dom);
    layOut(rows);
    const sel = rows[0].querySelector('.folder-glyph-select');
    assert.ok(sel, 'the row must carry a glyph picker');
    pointerAt(dom, sel, 'pointerdown', 10);
    pointerAt(dom, dom.window.document, 'pointermove', 2 * 60 + 45);
    pointerAt(dom, dom.window.document, 'pointerup', 2 * 60 + 45);
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), FOLDERS,
      'pressing the picker must not reorder anything');
  });
});

test('v1.76: a press on the remove button never starts a drag', () => {
  withFolderList((dom) => {
    const rows = rowsIn(dom);
    layOut(rows);
    const btn = rows[0].querySelector('.remove-folder-btn');
    pointerAt(dom, btn, 'pointerdown', 10);
    pointerAt(dom, dom.window.document, 'pointermove', 2 * 60 + 45);
    pointerAt(dom, dom.window.document, 'pointerup', 2 * 60 + 45);
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), FOLDERS);
  });
});

// ---- the DEFERRED persist posture (this list has a Save button) -------------

test('v1.76: a drag persists NOTHING on its own - this list waits for Save', () => {
  // The sidebar surfaces persist on drop; this one deliberately does not, and
  // that difference survives the migration to the shared helper.
  withFolderList((dom, ctx) => {
    const rows = rowsIn(dom);
    layOut(rows);
    drag(dom, rows, 0, 2 * 60 + 45);
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), ['/media/b', '/media/c', '/media/a'], 'the array moved');
    assert.deepEqual(ctx.fetchCalls, [], 'and NOTHING was sent to the server');
  });
});

test('v1.76: per-folder settings stay keyed to their own folder across a reorder', () => {
  // They are keyed by PATH, so a reorder must never re-key them onto whatever
  // now sits at that index.
  withFolderList((dom) => {
    const rows = rowsIn(dom);
    layOut(rows);
    drag(dom, rows, 0, 2 * 60 + 45);
    const after = rowsIn(dom);
    const nameOf = (row) => row.querySelector('.folder-name-input').value;
    const pathOf = (row) => row.querySelector('.folder-path-text').textContent;
    assert.deepEqual(after.map(pathOf), ['/media/b', '/media/c', '/media/a']);
    assert.equal(nameOf(after[2]), 'Alpha', '/media/a kept its display name at its new index');
    assert.equal(after[1].querySelector('.folder-hidden-check').checked, true, '/media/c kept its hidden flag');
    assert.equal(after[2].querySelector('.folder-hidden-check').checked, false);
  });
});

// ---- keyboard parity --------------------------------------------------------

test('v1.76: arrow keys on the handle reorder, and focus follows the item', () => {
  withFolderList((dom) => {
    const rows = rowsIn(dom);
    layOut(rows);
    rows[0].querySelector('.drag-handle').dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), ['/media/b', '/media/a', '/media/c']);
    const focused = dom.window.document.activeElement;
    assert.ok(focused && focused.classList.contains('drag-handle'), 'focus stayed on a handle');
    assert.equal(
      focused.closest('.folder-item-row').querySelector('.folder-path-text').textContent, '/media/a',
      'and on the SAME folder at its new index - a second press must keep working',
    );
  });
});

test('v1.76: End moves a row to the bottom, Home to the top', () => {
  withFolderList((dom) => {
    layOut(rowsIn(dom));
    rowsIn(dom)[0].querySelector('.drag-handle').dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })
    );
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), ['/media/b', '/media/c', '/media/a']);
    layOut(rowsIn(dom));
    rowsIn(dom)[2].querySelector('.drag-handle').dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })
    );
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), ['/media/a', '/media/b', '/media/c']);
  });
});

// ---- the synthetic Downloads row -------------------------------------------

test('v1.76: the synthetic downloads folder is still reorderable, still not removable', () => {
  // Its own tooltip promises exactly this ("rename or reorder it here, but it
  // can't be removed"), so the migration must not quietly make it undraggable.
  withFolderList((dom) => {
    const rows = rowsIn(dom);
    layOut(rows);
    assert.equal(rows[2].querySelector('.remove-folder-btn').disabled, true, 'not removable');
    assert.ok(rows[2].querySelector('.drag-handle'), 'but it has a grip');
    drag(dom, rows, 2, 10);
    assert.deepEqual(setup.__getConfiguredFoldersForTests(), ['/media/c', '/media/a', '/media/b'], 'and it reorders');
  }, { synthetic: ['/media/c'] });
});
