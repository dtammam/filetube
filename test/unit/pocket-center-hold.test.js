'use strict';

// [UNIT] v1.364.0 W2a: HOLD the Click wheel's center on Now Playing (Dean 2026-10-05, outcome 4).
// Through the REAL skin engine (skin-surface.js) and the REAL registry (music-skins.js), with REAL
// pointer sequences (LESSONS 2: jsdom rects are 0, so the wheel rect is stubbed or the dead-center
// guard never trips; the ghost path stubs document.elementsFromPoint).
// The ruling ("speaker only"): with a speaker on, the hold opens the existing volume bar; with the
// phone playing itself it shows a short LCD note "Use the side buttons" (iPhone Safari ignores page
// volume writes). Either way the release never ALSO fires the tap (Now Playing -> up-next list).
// A tap, a menu level, list mode, search and a takeover are unchanged; the desktop pop-out never arms.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const HOLD_MS = 600;   // HOME_HOLD_MS: the wheel's own hold (MENU home uses it)
const NOTE_MS = 1500;
const NOTE_TEXT = 'Use the side buttons';

const HTML = `<body>
  <video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" />
  <div id="panel" class="music-nowplaying-panel" hidden></div>
</body>`;

// o.speaker: true = this phone controls a speaker (level 0.5); false = the phone plays itself.
// o.haptic: the switch-capable device (the ghost covers the wheel). o.popout: the panel lives in
// another document (the desktop pop-out). o.menu: pocket menus (default on).
function boot(o = {}) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music' });
  const sdom = o.popout ? new JSDOM(HTML, { url: 'http://localhost/popout' }) : dom;
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  const w = sdom.window;
  // manual timers on the PANEL's window: tick(ms) advances the fake clock and fires what is due
  const clock = { now: 0, list: [] };
  w.setTimeout = (fn, ms) => { const t = { fn, at: clock.now + (ms || 0), live: true, ms }; clock.list.push(t); return clock.list.length; };
  w.clearTimeout = (id) => { const t = clock.list[id - 1]; if (t) t.live = false; };
  if (o.haptic) {
    Object.defineProperty(w.HTMLInputElement.prototype, 'switch', { value: false, configurable: true });
    w.ontouchstart = null;
  }
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const st = { speaker: !!o.speaker, level: 0.5, sets: [] };
  const volume = {
    available: () => st.speaker,
    level: () => (st.speaker ? st.level : null),
    set: (v) => { st.sets.push(v); st.level = v; },
  };
  const panel = sdom.window.document.getElementById('panel');
  const cfg = {
    panel, win: w, getSkinId: () => 'ipod',
    getCtx: () => ({ track: { title: 'T', artist: 'A', album: 'B', artUrl: '' }, upNext: [{ title: 'U' }], fullList: [{ title: 'T' }, { title: 'U' }],
      playing: true, posSec: 10, durSec: 100, posLabel: '0:10', remLabel: '-1:30',
      remote: st.speaker ? { label: 'Desk' } : undefined, volume: volume.level() }),
    hostCtl: (id) => dom.window.document.getElementById(id),
    onSelectIndex: () => {}, onDock: () => {}, onHome: () => { st.home = (st.home || 0) + 1; },
    volume, fastScan: true, sticker: {},
  };
  if (o.menu !== false) cfg.menu = { load: () => Promise.resolve({ items: [] }), onPlay: () => {}, onShuffleAll: () => {}, hasCurrent: () => true, currentId: () => null };
  const engine = dom.window.FileTubeSkinSurface.create(cfg);
  engine.paint();
  const wheel = panel.querySelector('.ip-wheel');
  // a REAL wheel rect centred on (0,0), 240 px: the dead center is r.width * DEAD_FRAC (0.20) = 48 px
  wheel.getBoundingClientRect = () => ({ left: -120, top: -120, width: 240, height: 240, right: 120, bottom: 120 });
  const tick = (ms) => {
    const end = clock.now + ms;
    for (;;) {
      const due = clock.list.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false; clock.now = Math.max(clock.now, due.at); due.fn();
    }
    clock.now = end;
  };
  return { dom, sdom, w, engine, st, panel, wheel, tick, clock, restore: () => Object.assign(global, saved) };
}
// Pointer events carry a pointerId (LESSONS 2: a MouseEvent has none, so `ev.pointerId !== c.id` is
// undefined !== undefined and a pointerId filter is never exercised). The finger is pointer 1.
const ev = (b, type, x, y, id = 1) => (/^pointer/.test(type)
  ? new b.w.PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: id, pointerType: 'touch', isPrimary: id === 1 })
  : new b.w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
const center = (b) => b.panel.querySelector('[data-skin-select]');
// a press at the wheel's centre: down on the center button (or the ghost), held ms, then up + the click
function hold(b, ms, opts = {}) {
  const tgt = opts.target || center(b);
  const x = opts.x == null ? 2 : opts.x; const y = opts.y == null ? 3 : opts.y;
  tgt.dispatchEvent(ev(b, 'pointerdown', x, y));
  if (opts.midMove) { b.tick(opts.midMove.at); b.w.document.dispatchEvent(ev(b, 'pointermove', opts.midMove.x, opts.midMove.y)); b.tick(ms - opts.midMove.at); } else b.tick(ms);
  const ux = opts.midMove ? opts.midMove.x : x; const uy = opts.midMove ? opts.midMove.y : y;
  tgt.dispatchEvent(ev(b, opts.cancel ? 'pointercancel' : 'pointerup', ux, uy));
  if (!opts.cancel) tgt.dispatchEvent(ev(b, 'click', ux, uy));
}
const upNext = (b) => b.panel.classList.contains('mms-listmode');
const volOpen = (b) => b.panel.classList.contains('mms-voladj');
const note = (b) => b.panel.querySelector('.ip-lcd-note');
const liveTimers = (b) => b.clock.list.filter((t) => t.live).length;

test('W2a (1): speaker on, Now Playing, hold 700 ms + release: the volume bar opens, the up-next list does NOT (the release click is swallowed)', () => {
  const b = boot({ speaker: true });
  try {
    assert.ok(b.panel.classList.contains('mms-full'), 'precondition: the skin painted full');
    assert.ok(b.panel.querySelector('.ip-vol'), 'precondition: the speaker volume bar is rendered (hidden)');
    hold(b, 700);
    assert.strictEqual(volOpen(b), true, 'the hold opened the volume bar');
    assert.strictEqual(upNext(b), false, 'the release did not also open up-next');
    assert.strictEqual(note(b), null, 'no note with a speaker');
  } finally { b.restore(); }
});

test('W2a (1b): the hold ticks once (the wheel\'s own haptic tick, the ghost flips once at the fire)', () => {
  const b = boot({ speaker: true, haptic: true });
  try {
    const g = b.panel.querySelector('.mms-haptic-ghost');
    assert.ok(g, 'precondition: the haptic ghost mounted');
    b.dom.window.document.elementsFromPoint = () => [g, center(b)];
    const seen = [];
    const gs = g.style;
    let cur = gs.transform;
    Object.defineProperty(gs, 'transform', { configurable: true, get: () => cur, set: (v) => { cur = v; seen.push(v); } });
    g.dispatchEvent(ev(b, 'pointerdown', 2, 3));
    const placed = seen.filter((v) => /translate/.test(v)).length;
    b.tick(700);
    const flips = seen.filter((v) => /translate/.test(v)).length - placed;
    assert.strictEqual(flips, 1, 'exactly one tick at the fire');
    g.dispatchEvent(ev(b, 'pointerup', 2, 3));
    g.dispatchEvent(ev(b, 'click', 2, 3));
    assert.strictEqual(volOpen(b), true);
    assert.strictEqual(upNext(b), false);
  } finally { b.restore(); }
});

test('W2a (2): the phone playing itself (no speaker): the hold shows "Use the side buttons", no up-next, no volume; the note goes after 1500 ms', () => {
  const b = boot({ speaker: false });
  try {
    hold(b, 700);
    assert.ok(note(b), 'the LCD note shows');
    assert.strictEqual(note(b).textContent, NOTE_TEXT);
    assert.strictEqual(upNext(b), false, 'the release did not also open up-next');
    assert.strictEqual(volOpen(b), false, 'no volume bar without a speaker');
    b.tick(NOTE_MS - (700 - HOLD_MS) - 10); // the note went up at the fire (600 ms), the release came at 700
    assert.ok(note(b), 'still up just before 1500 ms');
    b.tick(20);
    assert.strictEqual(note(b), null, 'gone after 1500 ms');
  } finally { b.restore(); }
});

test('W2a (3): a tap (down + up at 100 ms) is the center tap as today: up-next opens, no volume, no note', () => {
  for (const speaker of [true, false]) {
    const b = boot({ speaker });
    try {
      hold(b, 100);
      assert.strictEqual(upNext(b), true, 'speaker=' + speaker + ': the tap opened up-next');
      assert.strictEqual(volOpen(b), false);
      assert.strictEqual(note(b), null);
      b.tick(HOLD_MS * 2);
      assert.strictEqual(volOpen(b), false, 'nothing fires later either');
      assert.strictEqual(note(b), null);
    } finally { b.restore(); }
  }
});

test('W2a (4): hold, then move 12 px before 600 ms: nothing fires, and the release is a normal click (up-next)', () => {
  const b = boot({ speaker: true });
  try {
    hold(b, 700, { midMove: { at: 300, x: 14, y: 3 } });
    assert.strictEqual(volOpen(b), false, 'the move cancelled the hold');
    assert.strictEqual(note(b), null);
    assert.strictEqual(upNext(b), true, 'the release clicked the center as a tap');
  } finally { b.restore(); }
});

test('W2a (4b): a second finger on the ring before 600 ms cancels the pending hold (any new press drops it)', () => {
  const b = boot({ speaker: true });
  try {
    center(b).dispatchEvent(new b.w.MouseEvent('pointerdown', { bubbles: true, clientX: 2, clientY: 3 }));
    b.tick(300);
    const nz = b.panel.querySelector('[data-skin-next]');
    nz.dispatchEvent(new b.w.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    b.tick(400);
    assert.strictEqual(volOpen(b), false, 'the ring press cancelled the center hold');
    assert.strictEqual(note(b), null);
  } finally { b.restore(); }
});

test('W2a (5a): on a MENU level a 700 ms hold behaves exactly as a tap (Select drills, no volume, no note)', () => {
  const b = boot({ speaker: true });
  try {
    b.panel.querySelector('[data-skin-menu]').click();
    assert.strictEqual(b.engine.menuState().screen, 'menu', 'precondition: on the Main menu');
    const before = b.engine.menuState();
    const t0 = liveTimers(b);
    center(b).dispatchEvent(ev(b, 'pointerdown', 2, 3));
    assert.strictEqual(liveTimers(b), t0, 'no hold armed on a menu');
    b.tick(700);
    center(b).dispatchEvent(ev(b, 'pointerup', 2, 3));
    center(b).dispatchEvent(ev(b, 'click', 2, 3));
    assert.strictEqual(volOpen(b), false);
    assert.strictEqual(note(b), null);
    assert.notDeepStrictEqual(b.engine.menuState(), before, 'the release ran Select (the menu moved)');
  } finally { b.restore(); }
});

test('W2a (5b): in list mode (up-next showing) a 700 ms hold behaves as a tap (back to Now Playing on the cursor row)', () => {
  const b = boot({ speaker: false });
  try {
    hold(b, 100);
    assert.strictEqual(upNext(b), true, 'precondition: list mode');
    const t0 = liveTimers(b);
    center(b).dispatchEvent(ev(b, 'pointerdown', 2, 3));
    assert.strictEqual(liveTimers(b), t0, 'no hold armed in list mode');
    b.tick(700);
    center(b).dispatchEvent(ev(b, 'pointerup', 2, 3));
    center(b).dispatchEvent(ev(b, 'click', 2, 3));
    assert.strictEqual(upNext(b), false, 'the release ran the list-mode Select');
    assert.strictEqual(note(b), null);
  } finally { b.restore(); }
});

test('W2a (5c): in Music > Search a 700 ms hold behaves as a tap (no note, no volume; search is a menu level)', async () => {
  const b = boot({ speaker: true });
  try {
    b.panel.querySelector('[data-skin-menu]').click();
    const rowsOf = () => [...b.panel.querySelectorAll('.ipm-row:not(.ipm-skel)')];
    const tapLabel = (l) => { const r = rowsOf().find((x) => x.querySelector('.ipm-lbl').textContent === l); if (!r) throw new Error('no row ' + l); r.click(); };
    tapLabel('Music'); tapLabel('Search');
    assert.strictEqual(b.engine.menuState().title, 'Search', 'precondition: on Search');
    const t0 = liveTimers(b);
    center(b).dispatchEvent(ev(b, 'pointerdown', 2, 3));
    assert.strictEqual(liveTimers(b), t0, 'no hold armed on Search');
    b.tick(700);
    center(b).dispatchEvent(ev(b, 'pointerup', 2, 3));
    center(b).dispatchEvent(ev(b, 'click', 2, 3));
    assert.strictEqual(volOpen(b), false);
    assert.strictEqual(note(b), null);
    assert.strictEqual(b.engine.menuState().title, 'Search', 'still on Search (Select typed the marker cell)');
  } finally { b.restore(); }
});

test('W2a (5d): under a takeover (Brick) a 700 ms hold is the takeover\'s Select, once; no volume, no note', () => {
  const b = boot({ speaker: true });
  try {
    let sel = 0;
    b.engine.setWheelTakeover({ onRotate: () => {}, onSelect: () => { sel += 1; } });
    const t0 = liveTimers(b);
    center(b).dispatchEvent(ev(b, 'pointerdown', 2, 3));
    assert.strictEqual(liveTimers(b), t0, 'no hold armed under a takeover');
    b.tick(700);
    center(b).dispatchEvent(ev(b, 'pointerup', 2, 3));
    center(b).dispatchEvent(ev(b, 'click', 2, 3));
    assert.strictEqual(sel, 1, 'the takeover got its Select');
    assert.strictEqual(volOpen(b), false);
    assert.strictEqual(note(b), null);
  } finally { b.restore(); }
});

test('W2a (5e): the volume bar already open: a hold is the tap (puts the scrubber back), never re-arms', () => {
  const b = boot({ speaker: true });
  try {
    b.engine.openVolume();
    assert.strictEqual(volOpen(b), true, 'precondition');
    const t0 = liveTimers(b);
    center(b).dispatchEvent(ev(b, 'pointerdown', 2, 3));
    assert.strictEqual(liveTimers(b), t0, 'no hold armed while the bar is up');
    b.tick(700);
    center(b).dispatchEvent(ev(b, 'pointerup', 2, 3));
    center(b).dispatchEvent(ev(b, 'click', 2, 3));
    assert.strictEqual(volOpen(b), false, 'the release closed the bar, as the tap does');
  } finally { b.restore(); }
});

test('W2a (6): the neighbours are unchanged: MENU hold still goes home, a rewind/ffwd hold still scans', () => {
  const b = boot({ speaker: false });
  try {
    const mz = b.panel.querySelector('.ip-z-menu');
    mz.dispatchEvent(ev(b, 'pointerdown', 0, -100));
    b.tick(700);
    mz.dispatchEvent(ev(b, 'pointerup', 0, -100));
    mz.dispatchEvent(ev(b, 'click', 0, -100));
    assert.strictEqual(b.st.home, 1, 'MENU hold went home');
    assert.strictEqual(note(b), null, 'and showed no center note');
    const mp = b.dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'duration', { value: 300, configurable: true });
    const m = { ct: 100 };
    Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => m.ct, set: (v) => { m.ct = v; } });
    const nz = b.panel.querySelector('[data-skin-next]');
    nz.dispatchEvent(ev(b, 'pointerdown', 100, 0));
    b.tick(450);
    assert.ok(m.ct > 100, 'the ffwd hold scanned');
    nz.dispatchEvent(ev(b, 'pointerup', 100, 0));
  } finally { b.restore(); }
});

test('W2a (7): via the haptic ghost: the press lands on the ghost and the hold still fires once (speaker -> volume)', () => {
  const b = boot({ speaker: true, haptic: true });
  try {
    const g = b.panel.querySelector('.mms-haptic-ghost');
    assert.ok(g, 'precondition: the ghost covers the wheel');
    b.dom.window.document.elementsFromPoint = () => [g, center(b)];
    let opened = 0;
    const cl = b.panel.classList; const add0 = cl.add.bind(cl);
    cl.add = (...a) => { if (a.includes('mms-voladj')) opened += 1; return add0(...a); };
    hold(b, 700, { target: g });
    assert.strictEqual(opened, 1, 'the hold fired exactly once');
    assert.strictEqual(volOpen(b), true);
    assert.strictEqual(upNext(b), false, 'the ghost\'s release click was swallowed, not re-routed to Select');
  } finally { b.restore(); }
});

test('W2a (8): teardown: the panel leaves mms-full mid-hold: the timer never fires (no note, no volume)', () => {
  const b = boot({ speaker: false });
  try {
    center(b).dispatchEvent(ev(b, 'pointerdown', 2, 3));
    b.tick(200);
    b.panel.classList.remove('mms-full');
    b.tick(800);
    assert.strictEqual(note(b), null, 'no note on an un-rendered panel');
    assert.strictEqual(volOpen(b), false);
  } finally { b.restore(); }
});

test('W2a (8b): destroy mid-hold drops the timer (no live hold timer left)', () => {
  const b = boot({ speaker: true });
  try {
    const t0 = liveTimers(b);
    center(b).dispatchEvent(ev(b, 'pointerdown', 2, 3));
    assert.strictEqual(liveTimers(b), t0 + 1, 'precondition: the press armed one hold timer');
    b.engine.destroy();
    assert.strictEqual(liveTimers(b), t0, 'destroy cleared it');
  } finally { b.restore(); }
});

test('W2a (9): the desktop pop-out never arms the hold (a tap there is the tap)', () => {
  const b = boot({ speaker: true, popout: true });
  try {
    const t0 = liveTimers(b);
    center(b).dispatchEvent(ev(b, 'pointerdown', 2, 3));
    assert.strictEqual(liveTimers(b), t0, 'no hold armed in the pop-out');
    b.tick(700);
    center(b).dispatchEvent(ev(b, 'pointerup', 2, 3));
    center(b).dispatchEvent(ev(b, 'click', 2, 3));
    assert.strictEqual(volOpen(b), false);
    assert.strictEqual(upNext(b), true, 'the release was the plain tap');
  } finally { b.restore(); }
});

// ---- gate r1 (adversary W2): every cancel path, each bound by its own row ----

test('W2a (10): pointercancel at 300 ms (iOS took the touch): nothing fires at 700 ms, and the next tap is a normal click (up-next)', () => {
  const b = boot({ speaker: true });
  try {
    hold(b, 300, { cancel: true });
    b.tick(400);
    assert.strictEqual(volOpen(b), false, 'the cancel dropped the hold: no volume bar');
    assert.strictEqual(note(b), null, 'and no note');
    assert.strictEqual(upNext(b), false, 'a cancel is no click');
    hold(b, 100);
    assert.strictEqual(upNext(b), true, 'the next tap is the plain center tap');
    assert.strictEqual(volOpen(b), false);
  } finally { b.restore(); }
});

test('W2a (11): a release at 300 ms with no click (the finger slid off the button): nothing fires at 700 ms', () => {
  const b = boot({ speaker: true });
  try {
    center(b).dispatchEvent(ev(b, 'pointerdown', 2, 3));
    b.tick(300);
    b.w.document.dispatchEvent(ev(b, 'pointerup', 2, 3));
    b.tick(400);
    assert.strictEqual(upNext(b), false, 'precondition: no click ran, so list mode cannot mask the release');
    assert.strictEqual(volOpen(b), false, 'the release dropped the hold: no volume bar');
    assert.strictEqual(note(b), null);
  } finally { b.restore(); }
});

test('W2a (12): a second finger (another pointerId) moving 50 px does NOT cancel the hold: the volume opens at 600 ms', () => {
  const b = boot({ speaker: true });
  try {
    center(b).dispatchEvent(ev(b, 'pointerdown', 2, 3));
    b.tick(200);
    b.w.document.dispatchEvent(ev(b, 'pointermove', 52, 3, 2));
    b.tick(500);
    assert.strictEqual(volOpen(b), true, 'the foreign move was ignored (pointerId filter)');
  } finally { b.restore(); }
});

test('W2a (13): a second finger (another pointerId) lifting or cancelling does NOT cancel the hold: the volume opens at 600 ms', () => {
  for (const type of ['pointerup', 'pointercancel']) {
    const b = boot({ speaker: true });
    try {
      center(b).dispatchEvent(ev(b, 'pointerdown', 2, 3));
      b.tick(200);
      b.w.document.dispatchEvent(ev(b, type, 60, 3, 2));
      b.tick(500);
      assert.strictEqual(volOpen(b), true, type + ' from pointer 2 was ignored (pointerId filter)');
    } finally { b.restore(); }
  }
});

test('W2a (14): the wheel leaves the document mid-hold (a repaint swapped it): the fire re-check shows no note', () => {
  const b = boot({ speaker: false });
  try {
    center(b).dispatchEvent(ev(b, 'pointerdown', 2, 3));
    b.tick(200);
    assert.ok(b.panel.classList.contains('mms-full') && b.panel.querySelector('.ip-lcd-in'), 'precondition: still full, the LCD still there');
    b.wheel.remove();
    b.tick(500);
    assert.strictEqual(note(b), null, 'no note for a wheel that is gone');
    assert.strictEqual(volOpen(b), false);
  } finally { b.restore(); }
});

test('W2a (15): destroy with the LCD note up removes the note and drops its timer', () => {
  const b = boot({ speaker: false });
  try {
    const t0 = liveTimers(b);
    hold(b, 700);
    assert.ok(note(b), 'precondition: the note is up');
    assert.strictEqual(liveTimers(b), t0 + 1, 'precondition: one live timer (the note\'s)');
    b.engine.destroy();
    assert.strictEqual(note(b), null, 'destroy took the note down');
    assert.strictEqual(liveTimers(b), t0, 'and its 1500 ms timer');
  } finally { b.restore(); }
});
