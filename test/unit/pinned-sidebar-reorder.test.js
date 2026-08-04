'use strict';

// [UNIT] v1.76 T6 - the pinned sidebar's drag-to-reorder, in a REAL DOM.
//
// The v1.37.0 gate found (both seats, CRITICAL) that a mixed id list hitting
// the ytdlp endpoint tail-dropped every book id, and the response re-render
// made book pins vanish from the sidebar. The fix was a per-source partition:
// channel pins reorder among channel pins, book shelves among book shelves,
// podcast shows among shows, each persisting to its OWN endpoint. That fix has
// been guarded ever since by a SOURCE lock - assertions that certain strings
// appear in common.js - which proves presence, not binding, and which this
// wave's rewiring would have broken while the property itself still held.
//
// So this file replaces the presence proof with an execution proof: render the
// real pinned sidebar into a real jsdom document, drive real pointer events
// through the real gesture layer, and assert on what actually reaches fetch().
//
// (test/unit/pinned-sidebar.test.js keeps its hand-built fake DOM - it proves
// construction discipline, which needs an innerHTML-throws element rather than
// a real one.)

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const common = require('../../public/js/common.js');

const PINS = [
  { id: 'c1', label: 'Channel One', channelDir: '/media/c1' },
  { id: 'c2', label: 'Channel Two', channelDir: '/media/c2' },
  { id: 'b1', label: 'Shelf One', channelDir: '/books/s1', pinSource: 'books', href: '/books?shelf=s1' },
  { id: 'b2', label: 'Shelf Two', channelDir: '/books/s2', pinSource: 'books', href: '/books?shelf=s2' },
];

function withPinnedSidebar(pins, fn) {
  const dom = new JSDOM('<body><div id="sidebar"><div id="sidebar-folders-list"></div></div></body>', {
    url: 'http://localhost/',
  });
  global.document = dom.window.document;
  global.window = dom.window;
  const posts = [];
  global.fetch = (url, init) => {
    if (init && init.method === 'POST') posts.push({ url, body: JSON.parse(init.body) });
    return Promise.resolve({ ok: true, json: async () => [] });
  };
  const cleanup = () => {
    delete global.document;
    delete global.window;
    delete global.fetch;
    dom.window.close();
  };
  let result;
  try {
    common.renderPinnedSidebar(pins);
    result = fn(dom, { posts });
  } catch (err) { cleanup(); throw err; }
  if (result && typeof result.then === 'function') {
    return result.then((v) => { cleanup(); return v; }, (e) => { cleanup(); throw e; });
  }
  cleanup();
  return result;
}

const pinRows = (dom) =>
  Array.prototype.slice.call(dom.window.document.querySelectorAll('#sidebar-pinned-section .sidebar-item[data-pin-id]'));

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

test('the fixture renders one wired row per pin (a broken fixture would pass every lock below vacuously)', () => {
  withPinnedSidebar(PINS, (dom) => {
    const rows = pinRows(dom);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((r) => r.getAttribute('data-pin-id')), ['c1', 'c2', 'b1', 'b2']);
    for (const row of rows) {
      assert.ok(row.classList.contains('reorder-row'), 'stamped by the shared gesture layer');
      // QA gate C1: explicitly "false", not absent. These rows ARE <a>
      // elements, and an <a href> with no draggable attribute is draggable by
      // UA default - so "absent" would leave the browser free to start a
      // native link drag and cancel the pointer gesture.
      assert.equal(row.getAttribute('draggable'), 'false', 'native drag is turned OFF, not merely unset');
    }
  });
});

test('v1.76: reordering within one source persists that source ids to that source endpoint', () => {
  return withPinnedSidebar(PINS, async (dom, ctx) => {
    const rows = pinRows(dom);
    layOut(rows);
    drag(dom, rows, 0, 30 + 22); // channel c1 onto the bottom half of c2
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(ctx.posts.length, 1);
    assert.equal(ctx.posts[0].url, '/api/subscriptions/pins/reorder');
    assert.deepEqual(ctx.posts[0].body.orderedIds, ['c2', 'c1'], 'ONLY this source ids, in their new order');
  });
});

test('v1.76: book shelves reorder to the BOOKS endpoint, never the ytdlp one', () => {
  return withPinnedSidebar(PINS, async (dom, ctx) => {
    const rows = pinRows(dom);
    layOut(rows);
    drag(dom, rows, 3, 2 * 30 + 5); // shelf b2 onto the top half of b1
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(ctx.posts.length, 1);
    assert.equal(ctx.posts[0].url, '/api/books/pins/reorder');
    assert.deepEqual(ctx.posts[0].body.orderedIds, ['b2', 'b1']);
  });
});

test('v1.76 (the v1.37.0 CRITICAL, re-proven by EXECUTION): a cross-source drop persists nothing', () => {
  // Dragging a channel pin down among the book shelves. The old bug was a
  // mixed id list reaching the ytdlp endpoint, which tail-dropped every book
  // id and made the shelves vanish from the sidebar.
  return withPinnedSidebar(PINS, async (dom, ctx) => {
    const rows = pinRows(dom);
    layOut(rows);
    drag(dom, rows, 0, 3 * 30 + 22); // c1 onto the bottom half of b2
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(ctx.posts, [], 'no request at all - not a partial one, not a filtered one');
  });
});

test('v1.76: a foreign row never even lights up as a drop target mid-drag', () => {
  return withPinnedSidebar(PINS, async (dom, ctx) => {
    const rows = pinRows(dom);
    layOut(rows);
    const at = (el, type, y) => el.dispatchEvent(new dom.window.PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: y,
    }));
    at(rows[0], 'pointerdown', 5);
    at(dom.window.document, 'pointermove', 20);
    at(dom.window.document, 'pointermove', 3 * 30 + 22); // over a book shelf
    assert.equal(rows[3].className.includes('drag-over'), false, 'no drop line on a foreign row');
    at(dom.window.document, 'pointermove', 30 + 22);     // back over a channel
    assert.equal(rows[1].classList.contains('drag-over-after'), true, 'and it returns over its own source');
    // Escape rather than a drop: this test is about the indicator, and
    // abandoning the gesture also proves Escape reaches this surface.
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    at(dom.window.document, 'pointerup', 30 + 22);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(ctx.posts, [], 'an abandoned drag persists nothing');
    assert.equal(rows[1].className.includes('drag-over'), false, 'and clears its indicators');
  });
});

test('v1.76: an id-less pin no longer misaligns the rows after it', () => {
  // The rows are stamped only for pins with a string id, while the old wiring
  // indexed the FULL pin list by row index - so one id-less pin shifted every
  // later row onto the wrong record. Here the id-less pin sits FIRST, which
  // under the old indexing made row 0 (c1) resolve to the id-less pin.
  const pins = [
    { label: 'No Id', channelDir: '/media/x' },
    { id: 'c1', label: 'Channel One', channelDir: '/media/c1' },
    { id: 'c2', label: 'Channel Two', channelDir: '/media/c2' },
  ];
  return withPinnedSidebar(pins, async (dom, ctx) => {
    const rows = pinRows(dom);
    assert.deepEqual(rows.map((r) => r.getAttribute('data-pin-id')), ['c1', 'c2'], 'only id-bearing pins are rows');
    layOut(rows);
    drag(dom, rows, 0, 30 + 22);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(ctx.posts[0].body.orderedIds, ['c2', 'c1']);
  });
});
