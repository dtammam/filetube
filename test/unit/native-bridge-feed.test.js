'use strict';

// [UNIT] v1.384.0 (native bridge D7): the Feed's snap tick, through the REAL feed view (test/helpers/feed-view-harness.js) and the
// REAL adapter with a FAKE host. A `haptics.tick { style: 'snap' }` for a swipe the user made - and for nothing else: not the first
// card, not an auto-advance, not "Hide this" or another tap on a control, not a quarter swipe that springs back to the same card.
// No host: the stack gets no extra listeners and nothing is posted.

const { test } = require('node:test');
const assert = require('node:assert');
const { feedRealm, POD, VID, SONG } = require('../helpers/feed-view-harness');

const CARDS = [Object.assign({}, VID, { id: 'a1' }), Object.assign({}, POD, { id: 'a2' }), Object.assign({}, SONG, { id: 'a3', track: Object.assign({}, SONG.track, { id: 'a3' }) }), Object.assign({}, VID, { id: 'a4' })];
function realm(host) { return feedRealm({ batches: [{ cards: CARDS, exhausted: false }], host }); }
async function start(r) { r.init(); await r.settle(); r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle(); }
const snaps = (r) => (r.fakeHost ? r.fakeHost.of('haptics.tick') : []);
const fire = (r, pairs) => { const ob = r.observers[r.observers.length - 1]; ob.cb(pairs.map(([i, ratio]) => ({ target: r.$$('.feed-card')[i], isIntersecting: ratio > 0, intersectionRatio: ratio }))); };
// a finger drag on the stack: touchstart then a touchmove `dy` px away
function drag(r, dy) {
  const stack = r.$('#feed-stack');
  const ev = (type, y) => { const e = new r.w.Event(type, { bubbles: true }); e.touches = [{ clientX: 100, clientY: y }]; return e; };
  stack.dispatchEvent(ev('touchstart', 300));
  stack.dispatchEvent(ev('touchmove', 300 + dy));
}

test('D7: a user swipe to the next card settles with ONE snap tick', async () => {
  const r = realm({});
  try {
    await start(r); r.show(0);
    assert.deepStrictEqual(snaps(r), [], 'the first card: no tick');
    drag(r, -120);
    fire(r, [[0, 0.3], [1, 0.7]]); // settled on card 1
    assert.deepStrictEqual(snaps(r), [{ v: 1, type: 'haptics.tick', style: 'snap' }]);
    fire(r, [[0, 0], [1, 0.95]]); // the observer reports the same settle again: still one
    assert.strictEqual(snaps(r).length, 1);
    drag(r, -120);
    fire(r, [[1, 0.2], [2, 0.8]]);
    assert.strictEqual(snaps(r).length, 2, 'the next swipe ticks again');
  } finally { r.close(); }
});

test('D7: no tick on the countdown auto-advance or Hide this (a tap on a control, no scroll gesture)', async () => {
  const r = realm({});
  try {
    await start(r); r.show(0);
    // a programmatic scroll with no finger on the stack (the countdown, Hide this): the card changes, nobody swiped
    fire(r, [[0, 0.3], [1, 0.7]]);
    assert.deepStrictEqual(snaps(r), [], 'no gesture, no tick');
    // a TAP on a control: a touchstart and a touchmove under the move threshold, then a programmatic scroll
    const stack = r.$('#feed-stack');
    const ev = (type, y) => { const e = new r.w.Event(type, { bubbles: true }); e.touches = [{ clientX: 100, clientY: y }]; return e; };
    stack.dispatchEvent(ev('touchstart', 300)); stack.dispatchEvent(ev('touchmove', 304));
    fire(r, [[1, 0.2], [2, 0.8]]);
    assert.deepStrictEqual(snaps(r), [], 'a tap that wobbled 4 px is not a scroll gesture');
  } finally { r.close(); }
});

test('D7: a gesture older than ~1 s does not make a later settle tick', async () => {
  const r = realm({});
  try {
    await start(r); r.show(0);
    drag(r, -120);
    r.advance(1500);
    fire(r, [[0, 0.3], [1, 0.7]]);
    assert.deepStrictEqual(snaps(r), []);
  } finally { r.close(); }
});

test('D7: a quarter swipe that springs back to the same card is silent; so is the first card', async () => {
  const r = realm({});
  try {
    await start(r); r.show(0);
    drag(r, -60);
    fire(r, [[0, 0.74], [1, 0.26]]); // early activation of card 1 at a quarter
    fire(r, [[0, 0.9], [1, 0.1]]);   // sprang back
    fire(r, [[0, 0.95], [1, 0]]);
    assert.deepStrictEqual(snaps(r), [], 'back on the card it left: no tick');
  } finally { r.close(); }
});

test('D7: a wheel gesture counts as a scroll gesture (a desktop-sized hosted view)', async () => {
  const r = realm({});
  try {
    await start(r); r.show(0);
    r.$('#feed-stack').dispatchEvent(new r.w.Event('wheel', { bubbles: true }));
    fire(r, [[0, 0.3], [1, 0.7]]);
    assert.strictEqual(snaps(r).length, 1);
  } finally { r.close(); }
});

test('D7: a host without `haptics`, and no host at all, post nothing and attach no gesture listener to the stack', async () => {
  for (const host of [{ capabilities: ['battery'] }, null, undefined]) {
    const r = realm(host);
    try {
      let attached = 0;
      const proto = r.w.EventTarget.prototype;
      const orig = proto.addEventListener;
      proto.addEventListener = function (t, f, o) { if (this && this.id === 'feed-stack' && /^(touchstart|touchmove|wheel)$/.test(t)) attached += 1; return orig.call(this, t, f, o); };
      await start(r); r.show(0);
      drag(r, -120);
      fire(r, [[0, 0.3], [1, 0.7]]);
      assert.deepStrictEqual(snaps(r), [], String(JSON.stringify(host)));
      assert.strictEqual(attached, 0, 'no gesture listener without the haptics capability');
    } finally { r.close(); }
  }
});

test('D7 (control): WITH the capability the same probe sees the three listeners attached', async () => {
  const r = realm({});
  try {
    let attached = 0;
    const proto = r.w.EventTarget.prototype;
    const orig = proto.addEventListener;
    proto.addEventListener = function (t, f, o) { if (this && this.id === 'feed-stack' && /^(touchstart|touchmove|wheel)$/.test(t)) attached += 1; return orig.call(this, t, f, o); };
    await start(r);
    assert.strictEqual(attached, 3);
  } finally { r.close(); }
});

test('D7: the FIRST settle is the baseline even with a gesture just made - no tick on the first card', async () => {
  const r = realm({});
  try {
    await start(r);
    drag(r, -120); // a finger on the stack before anything settled
    r.show(0);
    assert.deepStrictEqual(snaps(r), [], 'the first card never ticks');
  } finally { r.close(); }
});
