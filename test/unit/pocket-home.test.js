'use strict';

// [UNIT] Home from the player (v1.332, Dean D7: "Right now I must press menu many times then the
// FileTube icon"). Two ways, both through the REAL skin engine (skin-surface.js):
//   AC10 - a Home row at the TOP of the corner sticker's menu on every skin that draws the sticker,
//          in the main document (the pop-out has none - the watch-back posture: its router is the
//          main window's, and a pop-out Home would navigate a tab you are not looking at);
//   AC11 - press-and-HOLD MENU on the Click wheel (600 ms; the rewind/ffwd hold-to-scan is 400 ms)
//          goes home exactly like the row, the release never also fires MENU, a short press is
//          unchanged, and moving off the zone / pointercancel / a takeover / an un-rendered panel /
//          destroy cancel it with every listener and timer released.
// Both call the VIEW's onHome hook (music.js / podcasts.js: dock quietly, then the SPA router to /);
// the integration suites drive the real views end to end.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const HOLD_MS = 600;

const HTML = `<body>
  <video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" />
  <div id="panel" class="music-nowplaying-panel" hidden></div>
</body>`;

function boot({ skin = 'ipod', onHome = true, otherDoc = false, menu = true, trackListeners = false } = {}) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music' });
  const sdom = otherDoc ? new JSDOM(HTML, { url: 'http://localhost/popout' }) : dom;
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const spy = { home: 0, dock: 0 };
  const state = { skin };
  const panel = sdom.window.document.getElementById('panel');
  const timers = new Set();
  const w = sdom.window;
  const st0 = w.setTimeout.bind(w); const ct0 = w.clearTimeout.bind(w);
  w.setTimeout = (fn, ms) => { const id = st0(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  w.clearTimeout = (id) => { timers.delete(id); return ct0(id); };
  const bal = { add: 0, remove: 0 };
  if (trackListeners) {
    for (const t of [panel, sdom.window.document]) {
      const a0 = t.addEventListener.bind(t); const r0 = t.removeEventListener.bind(t);
      t.addEventListener = function (ty, f, o) { if (/^pointer/.test(ty)) bal.add += 1; return a0(ty, f, o); };
      t.removeEventListener = function (ty, f, o) { if (/^pointer/.test(ty)) bal.remove += 1; return r0(ty, f, o); };
    }
  }
  const cfg = {
    panel, win: sdom.window, getSkinId: () => state.skin,
    getCtx: () => ({ track: { title: 'T', artist: 'A', album: 'B' }, upNext: [], fullList: [], playing: true, posLabel: '0:01', remLabel: '-0:09', posSec: 1, durSec: 10 }),
    hostCtl: (id) => dom.window.document.getElementById(id),
    onSelectIndex: () => {}, onDock: () => { spy.dock += 1; },
    sticker: {},
  };
  if (onHome) cfg.onHome = () => { spy.home += 1; };
  if (menu) cfg.menu = { load: () => Promise.resolve({ items: [] }), onPlay: () => {}, onShuffleAll: () => {}, hasCurrent: () => true, currentId: () => null };
  const engine = dom.window.FileTubeSkinSurface.create(cfg);
  engine.paint();
  return { dom, sdom, engine, spy, state, panel, timers, bal, restore: () => Object.assign(global, saved) };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (b, el) => {
  const W = b.sdom.window;
  el.dispatchEvent(new W.MouseEvent('pointerdown', { bubbles: true }));
  el.dispatchEvent(new W.MouseEvent('pointerup', { bubbles: true }));
  el.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
};
const openSticker = (b) => b.panel.querySelector('[data-skin-sticker]').dispatchEvent(new b.sdom.window.MouseEvent('click', { bubbles: true }));
const rows = (b) => [...b.panel.querySelectorAll('[data-skin-sticker-menu] .mms-sm-sec')];
const menuZone = (b) => b.panel.querySelector('.ip-z-menu');
const down = (b, el, x, y) => el.dispatchEvent(new b.sdom.window.MouseEvent('pointerdown', { bubbles: true, clientX: x == null ? 90 : x, clientY: y == null ? 0 : y }));
const move = (b, el, x, y) => el.dispatchEvent(new b.sdom.window.MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
const up = (b, el, type) => el.dispatchEvent(new b.sdom.window.MouseEvent(type || 'pointerup', { bubbles: true, clientX: 90, clientY: 0 }));
const clickOnly = (b, el) => el.dispatchEvent(new b.sdom.window.MouseEvent('click', { bubbles: true }));

// ---------------------------------------------------------------- AC10: the sticker's Home row
test('AC10: the sticker menu\'s FIRST row is Home on every skin that draws the sticker; one tap goes home and closes the menu', () => {
  const skins = require('../../public/js/music-skins.js').IDS;
  assert.ok(skins.length >= 12, 'precondition: every registry skin (' + skins.length + ')');
  for (const skin of skins) {
    const b = boot({ skin });
    try {
      openSticker(b);
      const first = rows(b)[0];
      const home = first && first.querySelector('[data-skin-home]');
      assert.ok(home, skin + ': the first row is Home');
      assert.match(home.textContent, /Home/);
      assert.ok(home.querySelector('.icon-home'), skin + ': the app\'s home icon');
      assert.match(rows(b)[1].textContent, /Speed/, skin + ': the menu\'s other rows follow, unchanged (Speed next)');
      clickOnly(b, home);
      assert.strictEqual(b.spy.home, 1, skin + ': ONE tap after opening the sticker goes home');
      assert.strictEqual(b.spy.dock, 0, skin + ': the view\'s onHome docks - never the engine\'s origin-returning dock as well');
      assert.strictEqual(b.panel.querySelector('[data-skin-sticker-menu]').hidden, true, skin + ': the menu closed');
    } finally { b.restore(); }
  }
});

test('AC10: no Home row without the view\'s hook, and none in the desktop pop-out (decided: its router is the main window\'s)', () => {
  const a = boot({ onHome: false });
  try { openSticker(a); assert.ok(!a.panel.querySelector('[data-skin-home]'), 'no hook: no row (never a row that leads nowhere)'); } finally { a.restore(); }
  const p = boot({ otherDoc: true });
  try {
    openSticker(p);
    assert.ok(p.panel.querySelector('[data-skin-sticker-menu] .mms-sm-sec'), 'precondition: the pop-out menu rendered');
    assert.ok(!p.panel.querySelector('[data-skin-home]'), 'the pop-out draws no Home row');
  } finally { p.restore(); }
});

// ---------------------------------------------------------------- AC11: hold MENU
test('AC11: a short MENU press is unchanged (climbs to the Main Menu), and never goes home', async () => {
  const b = boot();
  try {
    const t0 = b.timers.size;
    down(b, menuZone(b));
    assert.strictEqual(b.timers.size, t0 + 1, 'precondition: the press armed the hold');
    await wait(120); up(b, menuZone(b));
    assert.strictEqual(b.timers.size, t0, 'the release (an end arm) dropped the hold AT ONCE, not when it would have fired');
    clickOnly(b, menuZone(b));
    assert.strictEqual(b.engine.menuState().screen, 'menu', 'the short press climbed Now Playing -> Main Menu');
    await wait(HOLD_MS);
    assert.strictEqual(b.spy.home, 0, 'no home after a short press');
    assert.strictEqual(b.timers.size, 0, 'no timer left behind');
  } finally { b.restore(); }
});

test('AC11: a HELD MENU goes home exactly once, and the release fires no MENU (no climb, no dock)', async () => {
  const b = boot({ trackListeners: true });
  try {
    const z = menuZone(b);
    const net0 = b.bal.add - b.bal.remove;
    down(b, z);
    assert.ok(b.bal.add - b.bal.remove > net0, 'precondition: the press bound the gesture\'s listeners');
    await wait(HOLD_MS - 200);
    assert.strictEqual(b.spy.home, 0, 'not before the threshold');
    await wait(300);
    assert.strictEqual(b.spy.home, 1, 'the hold went home');
    up(b, z); clickOnly(b, z);
    assert.strictEqual(b.spy.home, 1, 'once');
    assert.strictEqual(b.spy.dock, 0, 'the release\'s click never also docked');
    assert.strictEqual(b.engine.menuState().screen, 'np', 'and never climbed to the menu');
    assert.strictEqual(b.bal.add - b.bal.remove, net0, 'the hold released every pointer listener the gesture added');
    assert.strictEqual(b.timers.size, 0, 'no timer left behind');
    // the NEXT short press is a normal MENU again (the swallow was one click)
    click(b, z);
    assert.strictEqual(b.engine.menuState().screen, 'menu', 'the next press climbs');
  } finally { b.restore(); }
});

test('AC11: every cancel arm - moving off the zone, pointercancel, a takeover, an un-rendered panel, destroy - never goes home and leaves no timer', async () => {
  // moving off the zone (the wheel's 8px rotation threshold)
  let b = boot();
  try { const z = menuZone(b); const t0 = b.timers.size; down(b, z, 90, 0); assert.strictEqual(b.timers.size, t0 + 1, 'armed'); move(b, z, 90, 20); assert.strictEqual(b.timers.size, t0, 'the move dropped the hold at once'); await wait(HOLD_MS + 100); assert.strictEqual(b.spy.home, 0, 'moved: a spin, not a hold'); up(b, z); assert.strictEqual(b.timers.size, 0); } finally { b.restore(); }
  // pointercancel
  b = boot();
  try { const z = menuZone(b); down(b, z); await wait(100); const t1 = b.timers.size; up(b, z, 'pointercancel'); assert.strictEqual(b.timers.size, t1 - 1, 'pointercancel dropped the hold at once'); await wait(HOLD_MS); assert.strictEqual(b.spy.home, 0, 'cancelled'); assert.strictEqual(b.timers.size, 0); } finally { b.restore(); }
  // a wheel takeover (Brick) owns MENU
  b = boot();
  try { b.engine.setWheelTakeover({ onRotate() {}, onMenu() { return true; }, onSelect() {} }); const z = menuZone(b); const t0 = b.timers.size; down(b, z); assert.strictEqual(b.timers.size, t0, 'no hold is armed under a takeover'); await wait(HOLD_MS + 100); assert.strictEqual(b.spy.home, 0, 'a takeover: no hold-home'); up(b, z); } finally { b.restore(); }
  // the view un-rendered the panel mid-hold (a dock from elsewhere)
  b = boot();
  try { const z = menuZone(b); down(b, z); await wait(100); b.panel.className = 'music-nowplaying-panel'; b.panel.innerHTML = ''; await wait(HOLD_MS); assert.strictEqual(b.spy.home, 0, 'an un-rendered panel never goes home'); } finally { b.restore(); }
  // destroy mid-hold
  b = boot();
  try { const z = menuZone(b); down(b, z); await wait(100); b.engine.destroy(); await wait(HOLD_MS); assert.strictEqual(b.spy.home, 0, 'destroyed'); assert.strictEqual(b.timers.size, 0, 'destroy released the timer'); } finally { b.restore(); }
  // the control: the same hold with no cancel DOES go home (so the five arms above are not vacuous)
  b = boot();
  try { const z = menuZone(b); down(b, z); await wait(HOLD_MS + 100); assert.strictEqual(b.spy.home, 1, 'the control hold went home'); up(b, z); } finally { b.restore(); }
});

test('AC11: a hold on any OTHER zone never goes home, and hold-home is off without the view\'s hook or in the pop-out', async () => {
  let b = boot();
  try { const z = b.panel.querySelector('.ip-z-down'); down(b, z); await wait(HOLD_MS + 100); up(b, z); assert.strictEqual(b.spy.home, 0, 'the play zone'); } finally { b.restore(); }
  b = boot({ onHome: false });
  try { const z = menuZone(b); down(b, z); await wait(HOLD_MS + 100); up(b, z); clickOnly(b, z); assert.strictEqual(b.spy.home, 0); assert.strictEqual(b.engine.menuState().screen, 'menu', 'no hook: the hold is just a MENU press'); } finally { b.restore(); }
  b = boot({ otherDoc: true });
  try { const z = menuZone(b); down(b, z); await wait(HOLD_MS + 100); up(b, z); assert.strictEqual(b.spy.home, 0, 'the pop-out: no hold-home'); } finally { b.restore(); }
});
