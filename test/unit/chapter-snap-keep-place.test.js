'use strict';
// v1.341.1 (Dean, desktop, Music "Fix times"): a nudge re-rendered every row, destroying the
// button that had focus, and Chrome then scrolled the list back to the top (measured headless on
// the Music page: scrollTop 1200 -> 21 after one nudge, 0 after two). A re-render must keep the
// list's scroll position and focus on the same control of the same row.
const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { showChapterSnapEditor } = require('../../public/js/common.js');

const N = 25;
function seedState() {
  return {
    version: 'v1', title: 'Long Mix', duration: N * 60 + 30, minGapSec: 0.1, edited: false, chaptersSource: 'manual',
    chapters: Array.from({ length: N }, (_, i) => ({ index: i, title: 'Song ' + (i + 1), sourceStart: i * 60, startTime: i * 60 })),
    silence: { state: 'unavailable' }, suggestions: [], snapAll: [],
  };
}

async function openEditor() {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/music', pretendToBeVisual: true });
  const d = dom.window.document;
  const fetchImpl = (url) => Promise.resolve({
    ok: !/\/scan$/.test(url), status: /\/scan$/.test(url) ? 409 : 200,
    json: async () => (/\/scan$/.test(url) ? { error: 'unavailable' } : seedState()),
  });
  const h = showChapterSnapEditor('f1', { doc: d, fetchImpl, pollMs: 60000 });
  await h.ready;
  return { dom, d, h, scroller: d.querySelector('.chapter-snap-scroll') };
}

// A pointer-free click (detail 0) the way a keyboard press or el.click() arrives.
function click(b) { b.dispatchEvent(new b.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, detail: 0 })); }

test('a nudge keeps focus on the same button of the same row, and the list where it was', async () => {
  const { d, h, scroller } = await openEditor();
  assert.strictEqual(d.querySelectorAll('.chapter-snap-item').length, N);
  scroller.scrollTop = 1200;
  const sel = '.chapter-snap-item[data-index="14"] button[data-act="nudge"][data-delta="1"]';
  const before = d.querySelector(sel);
  before.focus();
  // The re-render must restore the position even when the rebuild moved it (Chrome did).
  const orig = h.list.removeChild.bind(h.list);
  h.list.removeChild = function (c) { scroller.scrollTop = 0; return orig(c); };
  click(before);
  const after = d.querySelector(sel);
  assert.notStrictEqual(after, before, 'the row really was re-rendered (a new button)');
  assert.strictEqual(d.activeElement, after, 'focus is on the same control of the same row');
  assert.strictEqual(scroller.scrollTop, 1200, 'the list stays where the reader was');
  assert.match(h.statusEl.textContent + d.querySelector(sel).closest('li').textContent, /14:01|was/, 'the nudge applied');
  h.close();
});

test('a click with nothing in the list focused does not pull focus into the list', async () => {
  const { d, h, scroller } = await openEditor();
  scroller.scrollTop = 300;
  d.body.focus();
  // Undo re-renders the whole list from a head button (outside the list).
  click(d.querySelector('.chapter-snap-undo'));
  assert.ok(!h.list.contains(d.activeElement), 'focus stays out of the list');
  assert.strictEqual(scroller.scrollTop, 300);
  h.close();
});
