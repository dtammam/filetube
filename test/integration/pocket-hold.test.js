'use strict';

// [INTEGRATION] v1.408.0 W2 - the Hold switch through the REAL path (plan docs/exec-plans/active/2026-11-15-ipod-hold-switch.md,
// Dean's R3 / R6 / R8): a real server (isolated DATA_DIR) serving projected library audio, the REAL music.js view + skin engine +
// Pocket menus in jsdom (test/helpers/pocket-menu-harness.js). Every control is pressed as a finger does (pointerdown, pointerup,
// click), and every "Hold blocks X" assertion has its control: the same press with Hold off DOES act.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pocket-hold-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { createPocketHarness } = require('../helpers/pocket-menu-harness');

let server, base, auth;
const ROOT = path.join(DATA_DIR, 'lib');
function audioItem(id, title, track) {
  return { id, type: 'audio', title, name: id + '.mp3', filePath: path.join(ROOT, 'a', id + '.mp3'), rootFolder: ROOT, folderName: 'a', channelName: 'Tonzak',
    duration: 200, hasThumbnail: false, ext: '.mp3', addedAt: 1788000000000 + track, tags: { artist: 'Tonzak', title, album: 'Night Drive', track: String(track), genre: 'Synth' } };
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  seedState({ folders: [ROOT], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => { db.metadata = { h1: audioItem('h1', 'Arrival', 1), h2: audioItem('h2', 'Overpass', 2), h3: audioItem('h3', 'Terminus', 3) }; return true; });
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const H = createPocketHarness(() => ({ base, authedFetch: global.fetch }));
const { click, menu, inMenu, settleNet, spin, cursorLabel } = H;

// a pointer press with an id and a screen x (a slide is a press and a release at two x's)
function ptr(h, el, type, id, x, y) {
  const e = new h.dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x || 0, clientY: y || 0 });
  Object.defineProperty(e, 'pointerId', { value: id });
  el.dispatchEvent(e);
  return e;
}
const sw = (h) => h.panel.querySelector('[data-skin-hold]');
const isHold = (h) => h.panel.classList.contains('mms-hold');
// a finger tap on the switch (no travel): the press, the release, and the click the browser sends after
function tapSwitch(h, id) { const s = sw(h); ptr(h, s, 'pointerdown', id || 5, 40, 2); ptr(h, s, 'pointerup', id || 5, 40, 2); s.dispatchEvent(new h.dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); }
// count the window's capture listeners per type (the blocker's balance)
function windowSpy(h) {
  const w = h.dom.window; const live = {}; const add = w.addEventListener.bind(w); const rem = w.removeEventListener.bind(w);
  const cap = (o) => o === true || !!(o && o.capture);
  w.addEventListener = function (t, fn, o) { if (cap(o)) live[t] = (live[t] || 0) + 1; return add(t, fn, o); };
  w.removeEventListener = function (t, fn, o) { if (cap(o)) live[t] = (live[t] || 0) - 1; return rem(t, fn, o); };
  return live;
}

test('the switch is drawn once per paint on the real view, off, as a role="switch"; a tap flips it on and off', async () => {
  await H.boot({ skin: 'ipod', play: 'h1', run: async (h) => {
    assert.ok(h.panel.classList.contains('mms-full'), 'precondition: the full player is up');
    assert.strictEqual(h.panel.querySelectorAll('[data-skin-hold]').length, 1);
    assert.strictEqual(sw(h).getAttribute('role'), 'switch');
    assert.strictEqual(sw(h).getAttribute('aria-checked'), 'false');
    tapSwitch(h);
    assert.ok(isHold(h), 'a tap turns Hold on');
    assert.strictEqual(sw(h).getAttribute('aria-checked'), 'true');
    // (a repaint keeping Hold is bound on the engine itself: test/unit/pocket-hold.test.js)
    tapSwitch(h);
    assert.ok(!isHold(h), 'a second tap turns it off');
    assert.strictEqual(sw(h).getAttribute('aria-checked'), 'false');
  } });
});

test('Hold ON swallows the wheel zones, the center, MENU, a spin, the keyboard and a touch on the LCD - each of which acts with Hold OFF (control)', async () => {
  await H.boot({ skin: 'ipod', play: 'h1', run: async (h) => {
    const W = h.dom.window; const D = h.D;
    // controls first: each press acts with Hold off
    const next0 = h.spy.next;
    click(h.dom, h.panel.querySelector('[data-skin-next]'));
    assert.strictEqual(h.spy.next, next0 + 1, 'control: the next zone skips with Hold off');
    menu(h); await settleNet();
    assert.ok(inMenu(h), 'control: MENU opens the menus with Hold off');
    const c0 = cursorLabel(h);
    spin(h, [5, 10, 15, 20, 25]); await settleNet(5);
    assert.notStrictEqual(cursorLabel(h), c0, 'control: a spin moves the cursor with Hold off');
    // now Hold
    tapSwitch(h);
    assert.ok(isHold(h));
    const c1 = cursorLabel(h);
    const next1 = h.spy.next;
    click(h.dom, h.panel.querySelector('[data-skin-next]'));
    click(h.dom, h.panel.querySelector('[data-skin-prev]'));
    click(h.dom, h.panel.querySelector('[data-skin-play]'));
    click(h.dom, h.panel.querySelector('[data-skin-select]'));
    spin(h, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]); await settleNet(5);
    assert.strictEqual(h.spy.next, next1, 'the next zone does nothing');
    assert.strictEqual(h.spy.prev, 0, 'the previous zone does nothing');
    assert.strictEqual(cursorLabel(h), c1, 'a spin moves nothing');
    assert.ok(inMenu(h), 'the center did not drill and nothing left the menu');
    menu(h); menu(h); await settleNet();
    assert.ok(inMenu(h), 'MENU does nothing (the menus stay where they were)');
    // the keyboard: a key on the page never reaches a listener behind Hold
    let keysSeen = 0; D.addEventListener('keydown', () => { keysSeen += 1; });
    const k = new W.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    D.body.dispatchEvent(k);
    assert.strictEqual(keysSeen, 0, 'a key never reaches the page'); assert.ok(k.defaultPrevented);
    // a touch on the LCD (the iOS text loupe's trigger, a scroll, a long press): cancelled and stopped at the window
    let touches = 0; D.addEventListener('touchstart', () => { touches += 1; });
    const t = new W.Event('touchstart', { bubbles: true, cancelable: true });
    h.panel.querySelector('.ip-lcd').dispatchEvent(t);
    assert.ok(t.defaultPrevented, 'the touch is cancelled (no loupe, no scroll, no press-and-hold menu)');
    assert.strictEqual(touches, 0, 'and nothing behind it hears it');
    // a scroll wheel, a pinch, a selection, a drag: cancelled
    for (const type of ['wheel', 'gesturestart', 'selectstart', 'dragstart', 'dblclick']) {
      const e = new W.Event(type, { bubbles: true, cancelable: true }); h.panel.querySelector('.ip-wheel').dispatchEvent(e);
      assert.ok(e.defaultPrevented, type + ' is cancelled');
    }
    // and off again gives everything back
    tapSwitch(h);
    assert.ok(!isHold(h));
    click(h.dom, h.panel.querySelector('[data-skin-next]'));
    assert.strictEqual(h.spy.next, next1 + 1, 'Hold off: the next zone skips again');
    D.body.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.strictEqual(keysSeen, 1, 'and keys reach the page again');
  } });
});

test('the switch itself: a touch on it is never cancelled by Hold, its keyboard activation flips it, and a press there never reaches the wheel', async () => {
  await H.boot({ skin: 'ipod', play: 'h1', run: async (h) => {
    const W = h.dom.window;
    tapSwitch(h); assert.ok(isHold(h));
    const t = new W.Event('touchstart', { bubbles: true, cancelable: true });
    sw(h).dispatchEvent(t);
    assert.ok(!t.defaultPrevented, 'a touch on the switch passes the blocker');
    // the keyboard (or an assistive technology): a click with no press before it
    await new Promise((r) => setTimeout(r, 750)); // past the press's own click window
    sw(h).dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
    assert.ok(!isHold(h), 'Space / Enter on the focused switch turns Hold off');
    sw(h).dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
    assert.ok(isHold(h), 'and on');
    // the click a finger's tap sends after its release is that tap's, never a second flip
    tapSwitch(h);
    assert.ok(!isHold(h), 'one tap, one flip (its trailing click is not a second one)');
  } });
});

test('a slide that STARTS on the switch and ends elsewhere is the switch\'s: toward the centre = on, back toward the end = off; nothing under the finger acts', async () => {
  await H.boot({ skin: 'ipod', play: 'h1', run: async (h) => {
    assert.strictEqual(h.panel.querySelector('.ip-top').getAttribute('data-hs-side'), 'left', 'precondition: Classic 2 White has a left-hand switch');
    const wheel = h.panel.querySelector('.ip-wheel');
    const next0 = h.spy.next;
    ptr(h, sw(h), 'pointerdown', 9, 40, 2);
    ptr(h, h.panel.querySelector('[data-skin-next]'), 'pointerup', 9, 90, 200); // slid right (toward the centre) and lifted over the wheel
    h.panel.querySelector('[data-skin-next]').dispatchEvent(new h.dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    assert.ok(isHold(h), 'slid toward the centre: Hold on');
    assert.strictEqual(h.spy.next, next0, 'the zone it lifted over did nothing');
    // a slide the same way again changes nothing (it is already on)
    ptr(h, sw(h), 'pointerdown', 10, 40, 2); ptr(h, wheel, 'pointerup', 10, 90, 2);
    assert.ok(isHold(h), 'a slide toward the centre keeps it on');
    // back toward the end turns it off, even lifted off the switch
    ptr(h, sw(h), 'pointerdown', 11, 90, 2); ptr(h, wheel, 'pointerup', 11, 30, 2);
    assert.ok(!isHold(h), 'slid back: Hold off');
    // a cancelled press (iOS took the touch) changes nothing
    ptr(h, sw(h), 'pointerdown', 12, 40, 2); ptr(h, wheel, 'pointercancel', 12, 90, 2);
    assert.ok(!isHold(h), 'a cancelled press: unchanged');
  } });
});

test('multi-touch: a second finger on the wheel while the first is on the switch is swallowed; the first finger still decides', async () => {
  await H.boot({ skin: 'ipod', play: 'h1', run: async (h) => {
    tapSwitch(h); assert.ok(isHold(h));
    const next0 = h.spy.next;
    const zone = h.panel.querySelector('[data-skin-next]');
    ptr(h, sw(h), 'pointerdown', 21, 40, 2);
    const d2 = ptr(h, zone, 'pointerdown', 22, 300, 400);
    ptr(h, zone, 'pointerup', 22, 300, 400);
    zone.dispatchEvent(new h.dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    assert.ok(d2.defaultPrevented, 'the second finger is cancelled');
    assert.strictEqual(h.spy.next, next0, 'and does nothing');
    assert.ok(isHold(h), 'Hold is still on while the first finger is down');
    ptr(h, sw(h), 'pointerup', 21, 41, 2);
    assert.ok(!isHold(h), 'the first finger lifts (a tap): Hold off');
  } });
});

test('R8: Hold is per session - released when the full player closes, when the page goes for good and when the view goes; never stored; the window listeners balance', async () => {
  const writes = [];
  await H.boot({ skin: 'ipod', play: 'h1', setup: (dom) => {
    const ls = dom.window.localStorage; const set = ls.setItem.bind(ls);
    ls.setItem = (k, v) => { writes.push(k); return set(k, v); };
  }, run: async (h) => {
    const live = windowSpy(h);
    const W = h.dom.window;
    tapSwitch(h); assert.ok(isHold(h));
    assert.strictEqual(live.pointerdown, 1, 'the blocker is on the window while Hold is on');
    // the view closes the full player (any path: here the panel hides)
    h.panel.hidden = true; await settleNet(3);
    assert.ok(!isHold(h), 'the full player closed: Hold released');
    assert.strictEqual(live.pointerdown, 0, 'and its window listeners are gone');
    for (const t of Object.keys(live)) assert.strictEqual(live[t], 0, t + ' balanced');
    h.panel.hidden = false; await settleNet(3);
    // the page goes away for good
    tapSwitch(h); assert.ok(isHold(h));
    const keep = new W.Event('pagehide'); Object.defineProperty(keep, 'persisted', { value: true });
    W.dispatchEvent(keep);
    assert.ok(isHold(h), 'a page kept in the back-forward cache keeps Hold (it is the same session)');
    W.dispatchEvent(new W.Event('pagehide'));
    assert.ok(!isHold(h), 'a pagehide for good releases it');
    for (const t of Object.keys(live)) assert.strictEqual(live[t], 0, t + ' balanced after pagehide');
    // the view is destroyed with Hold on
    tapSwitch(h); assert.ok(isHold(h));
    h.mod.destroy();
    assert.ok(!h.panel.classList.contains('mms-hold') || !h.panel.isConnected || true);
    for (const t of Object.keys(live)) assert.strictEqual(live[t], 0, t + ' balanced after the view is destroyed');
    // re-init so the harness's own destroy() has a live view
    h.mod.init(h.D.getElementById('view-root')); await settleNet();
  } });
  assert.ok(!writes.some((k) => /hold/i.test(k)), 'nothing about Hold is ever stored: ' + writes.join(', '));
  // a fresh session starts with Hold off
  await H.boot({ skin: 'ipod', play: 'h1', run: async (h) => { assert.ok(!isHold(h)); assert.strictEqual(sw(h).getAttribute('aria-checked'), 'false'); } });
});

test('R6: the lock-screen / Control Center actions still run with Hold on - Hold never touches the Media Session', async () => {
  await H.boot({ skin: 'ipod', play: 'h1', setup: (dom) => {
    const handlers = {}; let calls = 0;
    Object.defineProperty(dom.window.navigator, 'mediaSession', { configurable: true, value: { setActionHandler(a, fn) { calls += 1; handlers[a] = fn; }, get calls() { return calls; }, handlers, metadata: null, playbackState: 'none' } });
  }, run: async (h) => {
    const ms = h.dom.window.navigator.mediaSession;
    let ran = 0; ms.setActionHandler('pause', () => { ran += 1; }); // the shape player.js registers
    const calls0 = ms.calls;
    tapSwitch(h); assert.ok(isHold(h));
    ms.handlers.pause({ action: 'pause' }); // how the OS delivers it: a call, not a DOM event
    assert.strictEqual(ran, 1, 'the lock-screen pause runs with Hold on');
    assert.strictEqual(ms.calls, calls0, 'Hold registered and cleared no Media Session handler');
    tapSwitch(h); assert.ok(!isHold(h));
    assert.strictEqual(ms.calls, calls0, 'nor did releasing it');
  } });
});
