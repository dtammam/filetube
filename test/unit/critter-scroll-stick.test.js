'use strict';

// [UNIT] v1.219 (Dean, device) - a critter anchored to a tile INSIDE a horizontal
// strip (the Music "Recently played" shelf) used to stay pinned to the document
// while the strip scrolled under it, so it detached and looked broken. The fix:
// on an INNER-container scroll, re-glue those critters to their anchors' new
// document positions so they ride along. A PAGE scroll leaves document coords
// fixed, so it must no-op. These drive the real functions with injected placements
// and a stubbed anchor rect (jsdom has no layout).
//
// SLIM-GATE CRITICAL (fixed): wireCritterContentNudge calls unwireCritterContentNudge
// mid-function to refresh its observer, which strips the scroll listener - so the
// listener MUST be (re-)attached AFTER that unwire, and this must be tested with
// global.MutationObserver present (the browser path), asserting the listener stays
// NET-ATTACHED, not merely that addEventListener was called.

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
  const saved = { window: global.window, document: global.document, MutationObserver: global.MutationObserver };
  global.window = dom.window;
  global.document = dom.window.document;
  dom.window.requestAnimationFrame = (fn) => { fn(); return 1; }; // synchronous, for onCritterInnerScroll
  dom.window.cancelAnimationFrame = () => {};
  const doc = dom.window.document;
  const layer = doc.getElementById('critter-layer');
  const wrap = doc.createElement('div');
  wrap.style.left = '0px'; wrap.style.top = '0px';
  layer.appendChild(wrap);
  const anchor = doc.getElementById('anchor');
  let rect = { left: 200, top: 100, width: 60, height: 60, right: 260, bottom: 160 };
  anchor.getBoundingClientRect = () => rect;
  const moveAnchor = (left, top) => { rect = { left, top, width: 60, height: 60, right: left + 60, bottom: top + 60 }; };
  const placement = { id: 'c1', anchorEl: anchor, anchor: { x: 200, y: 100, w: 60, h: 60 }, x: 210, y: 90, w: 80, h: 80, angle: 0, flip: 1 };
  setCritterPlacementsForTest([placement]);
  return { dom, doc, layer, wrap, anchor, placement, moveAnchor, restore: () => { setCritterPlacementsForTest([]); Object.assign(global, saved); if (global.MutationObserver === undefined) delete global.MutationObserver; dom.window.close(); } };
}

test('v1.219: repositionCrittersForScroll shifts a critter by its anchor scroll delta (rides the strip)', () => {
  const s = scene();
  try {
    s.moveAnchor(160, 100); // the strip scrolled the tile 40px LEFT (200 -> 160)
    repositionCrittersForScroll();
    assert.strictEqual(s.placement.x, 170, 'the critter followed by -40 (210 -> 170)');
    assert.strictEqual(s.placement.anchor.x, 160, 'the placement re-based its anchor doc-position');
    const pad = Math.round(80 * 0.3); // 24
    assert.strictEqual(s.wrap.style.left, (170 - pad) + 'px', 'the wrapper element (matched by INDEX) moved with it');
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
    onCritterInnerScroll({ target: s.doc }); // a page scroll -> skipped
    assert.strictEqual(s.placement.x, 210, 'a document-target (page) scroll does not re-glue');
    onCritterInnerScroll({ target: s.doc.getElementById('strip') }); // inner scroll -> re-glues (sync rAF)
    assert.strictEqual(s.placement.x, 160, 'an inner scroll re-glued (210 + (150-200) = 160)');
  } finally { s.restore(); }
});

test('v1.219 (gate CRITICAL): with MutationObserver present (browser path), ONE wire leaves the scroll listener NET-ATTACHED and working', () => {
  const s = scene();
  global.MutationObserver = s.dom.window.MutationObserver; // the real browser path (was omitted, hiding the strip-listener bug)
  const added = []; const removed = [];
  const realAdd = s.doc.addEventListener.bind(s.doc);
  const realRemove = s.doc.removeEventListener.bind(s.doc);
  s.doc.addEventListener = (type, fn, opts) => { if (type === 'scroll') added.push({ fn, opts }); return realAdd(type, fn, opts); };
  s.doc.removeEventListener = (type, fn, opts) => { if (type === 'scroll') removed.push({ fn, opts }); return realRemove(type, fn, opts); };
  try {
    wireCritterContentNudge(); // internally calls unwire (observer refresh) - the listener must SURVIVE that
    const net = added.filter((a) => a.fn === onCritterInnerScroll).length - removed.filter((r) => r.fn === onCritterInnerScroll).length;
    assert.strictEqual(net, 1, 'exactly one scroll listener remains attached after wire (the CRITICAL: it was 0 - added then stripped by the observer-refresh unwire)');
    const a = added.find((x) => x.fn === onCritterInnerScroll);
    assert.ok(a.opts && a.opts.capture === true && a.opts.passive === true, 'passive + capture');
    // And it actually works: an inner scroll now repositions.
    s.moveAnchor(140, 100);
    onCritterInnerScroll({ target: s.doc.getElementById('strip') });
    assert.strictEqual(s.placement.x, 150, 'the surviving listener re-glues (210 + (140-200))');
    unwireCritterContentNudge();
    const net2 = added.filter((a2) => a2.fn === onCritterInnerScroll).length - removed.filter((r) => r.fn === onCritterInnerScroll).length;
    assert.strictEqual(net2, 0, 'unwire removed the exact listener (net back to 0)');
  } finally { unwireCritterContentNudge(); s.restore(); }
});

test('v1.219 (gate WARNING 2): duplicate SPRITE ids resolve to distinct wrappers by INDEX (each critter moves its own)', () => {
  const dom = new JSDOM('<!DOCTYPE html><body><a id="a0"></a><a id="a1"></a><div id="critter-layer"></div></body>', { url: 'http://localhost/' });
  const saved = { window: global.window, document: global.document };
  global.window = dom.window; global.document = dom.window.document;
  const doc = dom.window.document;
  const layer = doc.getElementById('critter-layer');
  const w0 = doc.createElement('div'); w0.setAttribute('data-critter-id', 'dup'); w0.style.left = '0px'; layer.appendChild(w0);
  const w1 = doc.createElement('div'); w1.setAttribute('data-critter-id', 'dup'); w1.style.left = '0px'; layer.appendChild(w1);
  const a0 = doc.getElementById('a0'); a0.getBoundingClientRect = () => ({ left: 90, top: 100, width: 60, height: 60 });  // moved -10 from 100
  const a1 = doc.getElementById('a1'); a1.getBoundingClientRect = () => ({ left: 320, top: 100, width: 60, height: 60 }); // moved +20 from 300
  // TWO placements, SAME sprite id 'dup', in the same order as the wrappers.
  setCritterPlacementsForTest([
    { id: 'dup', anchorEl: a0, anchor: { x: 100, y: 100, w: 60, h: 60 }, x: 110, y: 90, w: 80, h: 80 },
    { id: 'dup', anchorEl: a1, anchor: { x: 300, y: 100, w: 60, h: 60 }, x: 310, y: 90, w: 80, h: 80 },
  ]);
  try {
    repositionCrittersForScroll();
    const pad = 24;
    assert.strictEqual(w0.style.left, (100 - pad) + 'px', 'wrapper 0 moved by placement 0 delta (-10)'); // 110-10=100
    assert.strictEqual(w1.style.left, (330 - pad) + 'px', 'wrapper 1 moved by placement 1 delta (+20)'); // 310+20=330
  } finally { setCritterPlacementsForTest([]); Object.assign(global, saved); dom.window.close(); }
});
