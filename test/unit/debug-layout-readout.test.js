'use strict';
// v1.341.3: ?debugLayout=1, the device-side readout for the Modern phone overflow (headless could
// not reproduce it). measureLayoutOverflow names the non-fixed elements past the right edge.
const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { measureLayoutOverflow } = require('../../public/js/common.js');

function page(boxes, fixedIds) {
  const dom = new JSDOM('<body>' + boxes.map((b) => `<div id="${b.id}" class="${b.cls || ''}"></div>`).join('') + '</body>');
  const w = dom.window;
  for (const b of boxes) {
    w.document.getElementById(b.id).getBoundingClientRect = () => ({ width: b.width, right: b.right });
  }
  const gcs = w.getComputedStyle.bind(w);
  w.getComputedStyle = (e) => (fixedIds.includes(e.id) ? { position: 'fixed' } : gcs(e));
  Object.defineProperty(w, 'innerWidth', { value: 430, configurable: true });
  w.matchMedia = () => ({ matches: false });
  return { doc: w.document, win: w };
}

test('lists the elements past the right edge, widest first, and skips fixed ones', () => {
  const { doc, win } = page([
    { id: 'grid', cls: 'video-grid list', width: 490, right: 506 },
    { id: 'ok', width: 398, right: 414 },
    { id: 'chip', cls: 'ui-chip', width: 100, right: 558 },
    { id: 'hdr', width: 520, right: 520 },
  ], ['hdr']);
  const m = measureLayoutOverflow(doc, win);
  assert.strictEqual(m.innerWidth, 430);
  assert.strictEqual(m.phoneQuery, false, 'the 480px phone query did not match (the Modern overflow suspicion)');
  assert.deepStrictEqual(m.wide.map((x) => x.sel), ['div#chip.ui-chip', 'div#grid.video-grid.list']);
  assert.deepStrictEqual(m.wide[1], { sel: 'div#grid.video-grid.list', right: 506, width: 490 });
});

test('never throws on a bare window', () => {
  const m = measureLayoutOverflow(null, null);
  assert.deepStrictEqual(m.wide, []);
});
