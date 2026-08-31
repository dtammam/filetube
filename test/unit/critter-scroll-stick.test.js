'use strict';

// [UNIT] v1.219 (Dean, device) - a critter anchored to a tile INSIDE a horizontal
// strip (the Music "Recently played" shelf) used to stay pinned to the document
// while the strip scrolled under it, so it detached and looked broken. The fix:
// on an INNER-container scroll, re-glue those critters to their anchors' new
// document positions so they ride along. A PAGE scroll leaves document coords
// fixed, so it must no-op. These drive the real functions with injected placements
// and a stubbed anchor rect (jsdom has no layout).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const {
  repositionCrittersForScroll, onCritterInnerScroll,
  setCritterPlacementsForTest, wireCritterContentNudge, unwireCritterContentNudge,
} = require('../../public/js/common.js');

// Build a jsdom with a #critter-layer holding one wrapper, and an anchor whose
// getBoundingClientRect we control. Returns handles + a way to move the anchor.
function scene() {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="strip"><a id="anchor"></a></div><div id="critter-layer"></div></body>', { url: 'http://localhost/' });
  const saved = { window: global.window, document: global.document };
  global.window = dom.window;
  global.document = dom.window.document;
  dom.window.requestAnimationFrame = (fn) => { fn(); return 1; }; // synchronous, for onCritterInnerScroll
  dom.window.cancelAnimationFrame = () => {};
  const doc = dom.window.document;
  const layer = doc.getElementById('critter-layer');
  const wrap = doc.createElement('div');
  wrap.setAttribute('data-critter-id', 'c1');
  wrap.style.left = '0px'; wrap.style.top = '0px';
  layer.appendChild(wrap);
  const anchor = doc.getElementById('anchor');
  let rect = { left: 200, top: 100, width: 60, height: 60, right: 260, bottom: 160 };
  anchor.getBoundingClientRect = () => rect;
  const moveAnchor = (left, top) => { rect = { left, top, width: 60, height: 60, right: left + 60, bottom: top + 60 }; };
  // A placement peeking from behind the anchor: anchor doc-pos (200,100); critter at (210,90) 80x80.
  const placement = { id: 'c1', anchorEl: anchor, anchor: { x: 200, y: 100, w: 60, h: 60 }, x: 210, y: 90, w: 80, h: 80, angle: 0, flip: 1 };
  setCritterPlacementsForTest([placement]);
  return { dom, doc, layer, wrap, anchor, placement, moveAnchor, restore: () => { setCritterPlacementsForTest([]); Object.assign(global, saved); dom.window.close(); } };
}

test('v1.219: repositionCrittersForScroll shifts a critter by its anchor scroll delta (rides the strip)', () => {
  const s = scene();
  try {
    s.moveAnchor(160, 100); // the strip scrolled the tile 40px LEFT (200 -> 160)
    repositionCrittersForScroll();
    assert.strictEqual(s.placement.x, 170, 'the critter followed by -40 (210 -> 170)');
    assert.strictEqual(s.placement.anchor.x, 160, 'the placement re-based its anchor doc-position');
    const pad = Math.round(80 * 0.3); // 24
    assert.strictEqual(s.wrap.style.left, (170 - pad) + 'px', 'the wrapper element moved with it');
  } finally { s.restore(); }
});

test('v1.219: an UNMOVED anchor (a page scroll) is a no-op - no shift, no wrapper write', () => {
  const s = scene();
  try {
    s.wrap.style.left = '999px';
    repositionCrittersForScroll(); // anchor rect unchanged -> delta 0
    assert.strictEqual(s.placement.x, 210, 'no shift when the anchor did not move');
    assert.strictEqual(s.wrap.style.left, '999px', 'the wrapper was not touched');
  } finally { s.restore(); }
});

test('v1.219: onCritterInnerScroll re-glues on an INNER-element scroll but SKIPS a page (document) scroll', () => {
  const s = scene();
  try {
    s.moveAnchor(150, 100); // tile moved
    // A page scroll: target is the document -> skipped, no reposition.
    onCritterInnerScroll({ target: s.doc });
    assert.strictEqual(s.placement.x, 210, 'a document-target (page) scroll does not re-glue');
    // An inner-element scroll: target is the strip -> re-glues (sync rAF stub).
    onCritterInnerScroll({ target: s.doc.getElementById('strip') });
    assert.strictEqual(s.placement.x, 160, 'an inner scroll re-glued (210 + (150-200) = 160)');
  } finally { s.restore(); }
});

test('v1.219: wire attaches onCritterInnerScroll as a PASSIVE + CAPTURE scroll listener; unwire removes the exact ref', () => {
  const s = scene();
  const added = []; const removed = [];
  const realAdd = s.doc.addEventListener.bind(s.doc);
  const realRemove = s.doc.removeEventListener.bind(s.doc);
  s.doc.addEventListener = (type, fn, opts) => { if (type === 'scroll') added.push({ fn, opts }); return realAdd(type, fn, opts); };
  s.doc.removeEventListener = (type, fn, opts) => { if (type === 'scroll') removed.push({ fn, opts }); return realRemove(type, fn, opts); };
  try {
    wireCritterContentNudge();
    const a = added.find((x) => x.fn === onCritterInnerScroll);
    assert.ok(a, 'wire registered onCritterInnerScroll for scroll');
    assert.ok(a.opts && a.opts.capture === true && a.opts.passive === true, 'passive + capture (no scroll-perf hit; catches inner scroll)');
    unwireCritterContentNudge();
    assert.ok(removed.some((x) => x.fn === onCritterInnerScroll && x.opts && x.opts.capture === true),
      'unwire removed the exact listener with capture (so it actually detaches)');
  } finally { unwireCritterContentNudge(); s.restore(); }
});
