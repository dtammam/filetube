'use strict';

// [UNIT] POCKET LIGHTING (Dean 2026-09-24, plan 2026-09-24-pocket-gyro-lighting). The pure half
// (public/js/pocket-lighting.js: the tilt mapping, the neutral-pose filter, the strength setting)
// and the driver, driven through the REAL engine (skin-surface.js create()/paint()/click) with REAL
// event shapes: a `deviceorientation` event on the window carrying beta/gamma, a `pointermove` with
// pointerType, the dock (innerHTML cleared with NO destroy), a hidden document, a skin switch, the
// tray, reduced motion, destroy. Every arm is asserted by LISTENER COUNT and rAF presence, never by
// prose. Plus the CSS lock (the Click wheel / dome read the light; no filter / blur / mask /
// backdrop in any lighting rule) and the dynamic shell parity (every shell that loads
// skin-surface.js loads pocket-lighting.js).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const lightPath = require.resolve('../../public/js/pocket-lighting.js');
const skins = require(skinsPath);
const L = require(lightPath);

// ---------------------------------------------------------------- the pure half
test('mapTilt: device axes to screen axes by the screen rotation; a null component is no sample', () => {
  assert.deepStrictEqual(L.mapTilt(10, 5, 0), { x: 5, y: 10 }, 'portrait: x = gamma (left/right), y = beta (front/back)');
  assert.deepStrictEqual(L.mapTilt(10, 5, 90), { x: 10, y: -5 });
  assert.deepStrictEqual(L.mapTilt(10, 5, 180), { x: -5, y: -10 });
  assert.deepStrictEqual(L.mapTilt(10, 5, 270), { x: -10, y: 5 });
  assert.deepStrictEqual(L.mapTilt(10, 5, -90), { x: -10, y: 5 }, 'the legacy window.orientation -90 is 270');
  assert.strictEqual(L.mapTilt(null, 5, 0), null, 'desktop Chrome fires the event with nulls: no sample');
  assert.strictEqual(L.mapTilt(1, undefined, 0), null);
  assert.strictEqual(L.mapTilt('x', 1, 0), null);
});

test('the filter: the FIRST sample is neutral; a tilt to the right moves the light LEFT (opposite); a held tilt re-centres; the edge is TILT_RANGE_DEG', () => {
  const st = L.newFilter();
  let g = L.recentre(st, 3, 40, 16);
  assert.deepStrictEqual(g, { x: 0, y: 0 }, 'the pose the skin opened in is neutral, whatever it is');
  g = L.recentre(st, 3 + L.TILT_RANGE_DEG / 2, 40, 16);
  assert.ok(g.x < -0.45 && g.x > -0.5, `half the range right -> the light about half way LEFT (got ${g.x})`);
  g = L.recentre(st, 3 + 200, 40, 16);
  assert.strictEqual(g.x, -1, 'clamped at the edge');
  // hold that tilt: the baseline drifts to it and the goal returns to 0 (G5)
  for (let i = 0; i < 5 * L.RECENTER_TAU_MS / 16; i++) g = L.recentre(st, 3 + 20, 40, 16);
  assert.ok(Math.abs(g.x) < 0.01, `a held tilt reads as level again within ~5 tau (got ${g.x})`);
  // ease: moves toward the goal, reports a write only past WRITE_EPS
  const e = L.newFilter();
  assert.strictEqual(L.ease(e, 0, 0, 16, L.SMOOTH_TAU_MS), false, 'at the goal: nothing to write');
  assert.strictEqual(L.ease(e, 1, 0, 16, L.SMOOTH_TAU_MS), true);
  assert.ok(e.x > 0.1 && e.x < 1, 'eased, not snapped');
  for (let i = 0; i < 100; i++) L.ease(e, 1, 0, 16, L.SMOOTH_TAU_MS);
  assert.ok(e.x > 0.999, 'converges');
  assert.deepStrictEqual(L.pointerLight(150, 50, { left: 100, top: 0, width: 100, height: 200 }), { x: 0, y: -0.5 });
  assert.strictEqual(L.pointerLight(1, 1, { left: 0, top: 0, width: 0, height: 0 }), null, 'no layout yet (jsdom / first frame): no light');
});

test('strength: device-local, default Off, garbage normalizes to Off; music-skins and the driver agree on the three values', () => {
  const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  assert.strictEqual(L.readStrength(ls), 'off');
  assert.strictEqual(L.setStrength('pronounced', ls), 'pronounced');
  assert.strictEqual(L.readStrength(ls), 'pronounced');
  assert.strictEqual(L.setStrength('loud', ls), 'off');
  assert.deepStrictEqual(L.STRENGTHS, skins.LIGHTING_STRENGTHS.map((r) => r.value), 'one list of strengths, two modules: a census');
  assert.deepStrictEqual(L.GAIN, { off: 0, subtle: 0.5, pronounced: 1 });
  const rows = skins.menuLightingItems({ strength: 'subtle', note: '' });
  assert.deepStrictEqual(rows.map((r) => [r.label, r.action, r.value, r.check]), [['Off', 'lighting', 'off', false], ['Subtle', 'lighting', 'subtle', true], ['Pronounced', 'lighting', 'pronounced', false]]);
  assert.deepStrictEqual(skins.menuLightingItems(null).map((r) => r.check), [true, false, false], 'no driver state: Off is checked');
  const noted = skins.menuLightingItems({ strength: 'pronounced', note: L.NOTE_DENIED });
  assert.strictEqual(noted.length, 4);
  assert.deepStrictEqual(noted[3], { label: L.NOTE_DENIED, note: true, info: true }, 'a read-only note row');
  assert.deepStrictEqual(skins.menuStaticItems({ type: 'settings' }, { hasLighting: true }).map((r) => r.label), ['Lighting', 'About']);
  assert.deepStrictEqual(skins.menuStaticItems({ type: 'settings' }, {}).map((r) => r.label), ['About'], 'no driver: no row that leads nowhere');
  assert.strictEqual(skins.menuTitle({ type: 'lighting' }, 'click'), 'Lighting');
  assert.ok(!skins.menuIsItemLevel({ type: 'lighting' }), 'a menu level (Click keeps the cover drift there)');
  const html = skins.renderMenuList({ style: 'click', items: noted, cursor: 1, start: 0, end: 4, rowH: 0, state: 'ready' });
  const d = new JSDOM('<div>' + html + '</div>').window.document;
  assert.strictEqual(d.querySelectorAll('.ipm-check').length, 1, 'one check');
  assert.ok(d.querySelector('.ipm-row.is-checked .ipm-lbl').textContent === 'Pronounced');
  assert.ok(d.querySelector('.ipm-noterow') && !d.querySelector('.ipm-noterow[data-skin-mi]'), 'the note wraps and is not an option');
});

// ---------------------------------------------------------------- the driver through the REAL engine
const HTML = `<body>
  <video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" />
  <div id="panel" class="music-nowplaying-panel" hidden></div>
</body>`;

function fakeClock(win) {
  let now = 0; let seq = 0;
  const q = new Map();
  win.setTimeout = (fn, ms) => { seq += 1; q.set(seq, { at: now + (Number(ms) || 0), fn }); return seq; };
  win.clearTimeout = (id) => { q.delete(id); };
  win.requestAnimationFrame = (fn) => win.setTimeout(() => fn(now), 16);
  win.cancelAnimationFrame = (id) => win.clearTimeout(id);
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of q) if (t.at <= end && (!next || t.at < next.t.at)) next = { id, t };
      if (!next) break;
      q.delete(next.id); now = next.t.at; next.t.fn();
    }
    now = end;
  }
  return { advance, live: () => q.size, now: () => now };
}

function boot({ skin = 'ipod', strength = 'pronounced', reduced = false, finePointer = true, permission, otherDoc = false, menu = true } = {}) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music', pretendToBeVisual: true, runScripts: 'outside-only' });
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  const sdom = otherDoc ? new JSDOM(HTML, { url: 'http://localhost/popout', pretendToBeVisual: true }) : dom;
  const win = sdom.window;
  const clock = fakeClock(win);
  win.matchMedia = (q) => ({ matches: (/reduced-motion/.test(q) && !!reduced) || (/pointer: fine/.test(q) && !!finePointer), media: q, addEventListener() {}, removeEventListener() {} });
  if (permission) win.DeviceOrientationEvent = { requestPermission: permission };
  const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  ls.setItem(L.KEY, strength);
  delete require.cache[skinsPath]; delete require.cache[surfacePath]; delete require.cache[lightPath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  dom.window.FileTubePocketLighting = require(lightPath);
  require(surfacePath);
  const state = { skin };
  const panelEl = sdom.window.document.getElementById('panel');
  // listener balance per target and type (the unbind-BALANCE discipline)
  const bal = { types: {} };
  const wrapT = (target, key) => {
    const a0 = target.addEventListener.bind(target); const r0 = target.removeEventListener.bind(target);
    target.addEventListener = function (t, f, o) { bal.types[key + ':' + t] = (bal.types[key + ':' + t] || 0) + 1; return a0(t, f, o); };
    target.removeEventListener = function (t, f, o) { bal.types[key + ':' + t] = (bal.types[key + ':' + t] || 0) - 1; return r0(t, f, o); };
  };
  wrapT(sdom.window.document, 'doc'); wrapT(win, 'win'); wrapT(panelEl, 'panel');
  const engine = dom.window.FileTubeSkinSurface.create({
    panel: panelEl,
    win,
    getSkinId: () => state.skin,
    getCtx: () => ({ track: { title: 'T', artist: 'A', artUrl: '/albumart/now' }, upNext: [], fullList: [], playing: true }),
    hostCtl: (id) => sdom.window.document.getElementById(id),
    onSelectIndex: () => {},
    onDock: () => {},
    lightingStore: ls,
    lightingNow: clock.now,
    menu: menu ? {
      load: () => Promise.resolve({ items: [] }),
      onPlay: () => {}, onShuffleAll: () => {}, hasCurrent: () => true, currentId: () => 'now', dataVersion: () => 0,
    } : undefined,
  });
  const count = (t) => bal.types[t] || 0;
  return { dom, win, doc: sdom.window.document, panel: panelEl, engine, state, clock, ls, bal, count, restore: () => Object.assign(global, saved) };
}
const P = (b) => b.panel;
const tap = (b, el) => {
  el.dispatchEvent(new b.win.MouseEvent('pointerdown', { bubbles: true }));
  el.dispatchEvent(new b.win.MouseEvent('pointerup', { bubbles: true }));
  el.dispatchEvent(new b.win.MouseEvent('click', { bubbles: true }));
};
const pressMenu = (b) => tap(b, P(b).querySelector('[data-skin-menu]'));
const lbls = (b) => [...P(b).querySelectorAll('.ipm-row:not(.ipm-skel) .ipm-lbl')].map((x) => x.textContent);
const tapLabel = (b, label) => {
  const r = [...P(b).querySelectorAll('.ipm-row:not(.ipm-skel)')].find((x) => x.querySelector('.ipm-lbl').textContent === label);
  if (!r) throw new Error('no row ' + label + ' in ' + lbls(b).join('|'));
  tap(b, r);
};
const flush = () => new Promise((r) => setImmediate(r));
// the REAL event shape: a `deviceorientation` event on the window with beta/gamma (jsdom has no
// DeviceOrientationEvent class; the handler reads the two fields off the event, as it does on iOS)
function tiltTo(b, beta, gamma) {
  const e = new b.win.Event('deviceorientation');
  Object.defineProperty(e, 'beta', { value: beta }); Object.defineProperty(e, 'gamma', { value: gamma });
  b.win.dispatchEvent(e);
}
function mouseAt(b, x, y, type = 'mouse') {
  const e = new b.win.MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerType', { value: type });
  P(b).dispatchEvent(e);
}
const lx = (b) => Number(P(b).style.getPropertyValue('--lx'));
const ly = (b) => Number(P(b).style.getPropertyValue('--ly'));
const lit = (b) => P(b).classList.contains('mms-lit');
const S = (b) => b.engine.lightingState();
// (visibilitychange is counted apart: the engine binds its own on the document while bound - the
// driver adds one more; 2 = engine + driver, 1 = engine only, 0 = destroyed)
const listening = (b) => ({ orient: b.count('win:deviceorientation'), move: b.count('panel:pointermove'), leave: b.count('panel:pointerleave') });
const vis = (b) => b.count('doc:visibilitychange');

test('AC1 reachability: a REAL deviceorientation event moves --lx/--ly on the panel through the real engine; opposite the tilt; scaled by the strength', () => {
  const b = boot({ strength: 'pronounced' });
  try {
    b.engine.paint();
    assert.ok(lit(b) && S(b).listening, 'a painted Click skin with the strength on is lit and listening');
    assert.deepStrictEqual(listening(b), { orient: 1, move: 1, leave: 1 }, 'exactly one listener each');
    assert.strictEqual(vis(b), 2, 'the engine\'s visibilitychange + the driver\'s');
    tiltTo(b, 40, 3);              // the neutral pose (whatever you hold it at)
    b.clock.advance(200);
    assert.strictEqual(lx(b), 0, 'the opening pose is neutral: no offset');
    tiltTo(b, 40, 3 + 28);         // tilt RIGHT by the full range
    b.clock.advance(100);
    assert.ok(S(b).raf, 'the frame loop is live while samples stream');
    b.clock.advance(600);
    assert.ok(lx(b) < -0.9, `the light slides LEFT (opposite the tilt): --lx = ${lx(b)}`);
    assert.ok(Math.abs(ly(b)) < 0.05, 'no front/back tilt: --ly stays ~0');
    // Subtle halves it
    b.ls.setItem(L.KEY, 'subtle');
    tiltTo(b, 40, 3 + 28); b.clock.advance(700); // the next sample re-reads the strength
    assert.ok(lx(b) < -0.38 && lx(b) > -0.55, `subtle = half the amplitude, less ~1 s of re-centring (got ${lx(b)})`);
    // a HELD tilt (G5): the neutral pose drifts onto it, the light eases home, and only then
    // does the loop park (no rAF, no timer, no writes) until the next sample
    b.clock.advance(5 * L.RECENTER_TAU_MS);
    assert.ok(Math.abs(lx(b)) < 0.02, `a held tilt re-centres through the real engine (got ${lx(b)})`);
    assert.strictEqual(S(b).raf, false, 'settled and no new sample: the loop parked');
    const w0 = S(b).writes;
    b.clock.advance(2000);
    assert.strictEqual(S(b).writes, w0, 'no writes while parked');
    assert.strictEqual(b.clock.live(), 0, 'no timer of any kind pending');
    tiltTo(b, 40, 3 + 28);
    assert.ok(S(b).raf, 'the next sample re-arms the loop');
  } finally { b.restore(); }
});

test('AC1 desktop: a MOUSE pointermove over the panel drives the light when no sensor sample is live; a touch never does; leaving eases home', () => {
  const b = boot({ strength: 'pronounced' });
  try {
    b.engine.paint();
    P(b).getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 800 });
    mouseAt(b, 100, 400, 'touch');
    b.clock.advance(300);
    assert.strictEqual(P(b).style.getPropertyValue('--lx'), '', 'a finger never moves the light');
    mouseAt(b, 100, 400, 'mouse');    // left quarter -> the light at x = -0.5
    b.clock.advance(1000);
    assert.ok(Math.abs(lx(b) + 0.5) < 0.02, `the pointer IS the light (got ${lx(b)})`);
    const leave = new b.win.MouseEvent('pointerleave', { bubbles: false });
    Object.defineProperty(leave, 'pointerType', { value: 'mouse' });
    P(b).dispatchEvent(leave);
    b.clock.advance(3000);
    assert.ok(Math.abs(lx(b)) < 0.01, 'eases back to neutral after the pointer leaves');
    // a live sensor outranks the mouse
    tiltTo(b, 40, 3); b.clock.advance(100); tiltTo(b, 40, 3 + 14); b.clock.advance(500);
    const sensorX = lx(b);
    assert.ok(sensorX < -0.4, 'the sensor drives');
    mouseAt(b, 380, 400, 'mouse'); b.clock.advance(500);
    assert.ok(lx(b) < -0.4, `a mouse move while the sensor is fresh is ignored (got ${lx(b)})`);
  } finally { b.restore(); }
});

test('AC2 both axes on a POPULATED panel: Off clears the properties, the class and every listener; Subtle then Pronounced binds ONE listener, never two', async () => {
  const b = boot({ strength: 'pronounced' });
  try {
    b.engine.paint();
    tiltTo(b, 40, 3); b.clock.advance(50); tiltTo(b, 40, 30); b.clock.advance(500);
    assert.ok(lx(b) < -0.5 && lit(b), 'populated AND lit before the clear axis is driven');
    // through the REAL Settings > Lighting path
    pressMenu(b); tapLabel(b, 'Settings');
    assert.deepStrictEqual(lbls(b), ['Lighting', 'About']);
    tapLabel(b, 'Lighting');
    assert.deepStrictEqual(lbls(b), ['Off', 'Subtle', 'Pronounced']);
    assert.strictEqual(P(b).querySelector('.ipm-row.is-checked .ipm-lbl').textContent, 'Pronounced');
    tapLabel(b, 'Off'); await flush();
    assert.strictEqual(P(b).querySelector('.ipm-row.is-checked .ipm-lbl').textContent, 'Off', 'the check moved');
    assert.strictEqual(P(b).style.getPropertyValue('--lx'), '', '--lx cleared');
    assert.strictEqual(P(b).style.getPropertyValue('--ly'), '', '--ly cleared');
    assert.ok(!lit(b), 'the lit class dropped');
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'every listener unbound');
    assert.strictEqual(vis(b), 1, 'only the engine\'s own visibilitychange remains');
    assert.strictEqual(S(b).raf, false);
    assert.strictEqual(b.ls.getItem(L.KEY), 'off', 'stored');
    tapLabel(b, 'Subtle'); await flush();
    tapLabel(b, 'Pronounced'); await flush();
    assert.deepStrictEqual(listening(b), { orient: 1, move: 1, leave: 1 }, 'two picks: still exactly one listener each');
    assert.strictEqual(vis(b), 2);
    assert.ok(lit(b));
    tiltTo(b, 40, 3); b.clock.advance(50); tiltTo(b, 40, 30); b.clock.advance(500);
    assert.ok(lx(b) < -0.5, 'lit again through the real path');
  } finally { b.restore(); }
});

test('AC3 every teardown arm unbinds: the dock (no destroy), a hidden document, a repaint as Cider, the tray, reduced motion, destroy - measured over repeated mounts', async () => {
  const b = boot({ strength: 'pronounced' });
  try {
    const zero = { orient: 0, move: 0, leave: 0 };
    const one = { orient: 1, move: 1, leave: 1 };
    const light = () => { b.engine.paint(); tiltTo(b, 40, 3); b.clock.advance(50); tiltTo(b, 40, 30); b.clock.advance(300); assert.deepStrictEqual(listening(b), one); assert.ok(lit(b) && lx(b) < 0); };
    for (let n = 0; n < 3; n++) {
      // (a) the DOCK: the view clears the panel synchronously WITHOUT destroy() (v1.256 class)
      light();
      P(b).hidden = true; P(b).innerHTML = '';
      b.clock.advance(40); // one frame: the LIVE loop notices and stops itself (the observer would too)
      assert.deepStrictEqual(listening(b), zero, `dock #${n}: unbound within a frame`);
      assert.strictEqual(vis(b), 1, 'the driver\'s visibilitychange went; the engine\'s stays (it is still bound)');
      assert.strictEqual(S(b).raf, false);
      assert.strictEqual(b.clock.live(), 0, 'nothing pending');
      P(b).hidden = false;
      // (b) a hidden document (the tab in the background)
      light();
      Object.defineProperty(b.doc, 'hidden', { configurable: true, value: true });
      b.doc.dispatchEvent(new b.win.Event('visibilitychange'));
      assert.deepStrictEqual(listening(b), zero, `hidden #${n}: unbound on visibilitychange`);
      Object.defineProperty(b.doc, 'hidden', { configurable: true, value: false });
      b.engine.paint();
      assert.deepStrictEqual(listening(b), one, 'visible + painted again: re-bound (through paint)');
      // (c) a repaint as a non-Click skin
      b.state.skin = 'apple'; b.engine.paint();
      assert.deepStrictEqual(listening(b), zero, `Cider #${n}: no lighting`);
      assert.ok(!lit(b));
      b.state.skin = 'zune-classic'; b.engine.paint();
      assert.deepStrictEqual(listening(b), zero, `Seattle #${n}: out of scope (Dean), never lit`);
      assert.ok(!lit(b) && P(b).style.getPropertyValue('--lx') === '');
      b.state.skin = 'ipod-matte';
      // (d) the tray (the pop-out's Nano strip)
      b.doc.body.classList.add('mms-tray'); b.engine.paint();
      assert.deepStrictEqual(listening(b), zero, `tray #${n}: no lighting`);
      b.doc.body.classList.remove('mms-tray');
      // (e) destroy
      light();
      b.engine.destroy();
      assert.deepStrictEqual(listening(b), zero, `destroy #${n}`);
      assert.strictEqual(vis(b), 0, 'destroy: engine and driver both unbound');
      assert.strictEqual(S(b).raf, false);
      assert.strictEqual(P(b).style.getPropertyValue('--lx'), '');
    }
  } finally { b.restore(); }
});

test('AC3 the PARKED dock (the probe\'s finding): with no sample in flight the frame loop is parked, so the release must be STRUCTURAL - the panel emptying or hiding unbinds within a microtask', async () => {
  const b = boot({ strength: 'pronounced' });
  try {
    b.engine.paint();
    assert.deepStrictEqual(listening(b), { orient: 1, move: 1, leave: 1 });
    assert.strictEqual(S(b).raf, false, 'no sample yet: parked (no rAF to notice a dock)');
    P(b).hidden = true; P(b).innerHTML = '';
    await flush();
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'the observer released it');
    assert.strictEqual(vis(b), 1);
    P(b).hidden = false; b.engine.paint();
    assert.deepStrictEqual(listening(b), { orient: 1, move: 1, leave: 1 }, 'a repaint re-binds');
    P(b).hidden = true; // hidden alone (the attribute arm), the DOM still populated
    await flush();
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'hidden alone releases too');
  } finally { b.restore(); }
});

test('AC3 reduced motion: nothing binds, nothing is written; the Lighting level says why', async () => {
  const b = boot({ strength: 'pronounced', reduced: true });
  try {
    b.engine.paint();
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 });
    assert.strictEqual(vis(b), 1, 'the engine\'s own only');
    assert.ok(!lit(b));
    tiltTo(b, 40, 30); b.clock.advance(500);
    assert.strictEqual(P(b).style.getPropertyValue('--lx'), '');
    pressMenu(b); tapLabel(b, 'Settings'); tapLabel(b, 'Lighting'); tapLabel(b, 'Subtle'); await flush();
    assert.ok(lbls(b).includes(L.NOTE_REDUCED), 'the note row');
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'a pick under reduced motion binds nothing');
  } finally { b.restore(); }
});

test('AC4 iOS permission: asked ONCE from the tap; denied keeps the strength + the note and binds nothing that streams; granted binds', async () => {
  let asks = 0;
  const b = boot({ strength: 'off', permission: () => { asks += 1; return Promise.resolve('denied'); } });
  try {
    b.engine.paint();
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'Off: nothing');
    pressMenu(b); tapLabel(b, 'Settings'); tapLabel(b, 'Lighting');
    tapLabel(b, 'Pronounced');
    assert.strictEqual(asks, 1, 'requestPermission ran inside the tap (user activation)');
    await flush(); await flush();
    assert.ok(lbls(b).includes(L.NOTE_DENIED), 'denied: the note row');
    assert.strictEqual(b.ls.getItem(L.KEY), 'pronounced', 'the pick is kept (Dean: keep the strength + a note)');
    assert.strictEqual(P(b).querySelector('.ipm-row.is-checked .ipm-lbl').textContent, 'Pronounced');
    // iOS streams nothing after a deny; the listener is harmless but the look must stay as today
    tiltTo(b, 40, 30); b.clock.advance(500);
    assert.ok(lx(b) === 0 || Number.isNaN(lx(b)) || Math.abs(lx(b)) < 0.05, 'no offset from a synthetic sample after a deny (first sample is neutral anyway)');
    tapLabel(b, 'Off'); await flush();
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 });
  } finally { b.restore(); }
  let asks2 = 0;
  const g = boot({ strength: 'off', permission: () => { asks2 += 1; return Promise.resolve('granted'); } });
  try {
    g.engine.paint();
    pressMenu(g); tapLabel(g, 'Settings'); tapLabel(g, 'Lighting'); tapLabel(g, 'Subtle');
    await flush(); await flush();
    assert.strictEqual(asks2, 1);
    assert.ok(!lbls(g).includes(L.NOTE_DENIED) && lit(g), 'granted: lit, no note');
    assert.deepStrictEqual(listening(g), { orient: 1, move: 1, leave: 1 });
    tiltTo(g, 40, 3); g.clock.advance(50); tiltTo(g, 40, 30); g.clock.advance(500);
    assert.ok(lx(g) < -0.3 && lx(g) > -0.6, `subtle after a grant (got ${lx(g)})`);
  } finally { g.restore(); }
  // no permission API (Android / desktop): binds directly; no sensor AND no fine pointer: the note
  const n = boot({ strength: 'off', finePointer: false });
  try {
    n.engine.paint(); pressMenu(n); tapLabel(n, 'Settings'); tapLabel(n, 'Lighting'); tapLabel(n, 'Pronounced'); await flush();
    assert.ok(!lbls(n).includes(L.NOTE_NO_SENSOR), 'not yet: a sensor may still stream');
    n.clock.advance(L.SENSOR_WAIT_MS + 10); await flush(); await flush();
    assert.ok(lbls(n).includes(L.NOTE_NO_SENSOR), 'a coarse pointer and no sample within the wait: says so');
    assert.deepStrictEqual(listening(n), { orient: 1, move: 1, leave: 1 }, 'still bound: a sensor that appears later streams');
  } finally { n.restore(); }
});

test('the pop-out surface (another document): the driver listens on THAT window and panel, and dies with the pop-out engine', () => {
  const b = boot({ strength: 'pronounced', otherDoc: true, menu: true });
  try {
    b.engine.paint();
    assert.deepStrictEqual(listening(b), { orient: 1, move: 1, leave: 1 }, 'bound on the pop-out window/document');
    tiltTo(b, 10, 0); b.clock.advance(50); tiltTo(b, 10, 20); b.clock.advance(400);
    assert.ok(lx(b) < -0.3);
    b.engine.destroy();
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 });
    assert.strictEqual(vis(b), 0);
  } finally { b.restore(); }
});

test('a shell without pocket-lighting.js: the engine paints, Settings shows About only, no lighting state', () => {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music', pretendToBeVisual: true });
  const saved = { window: global.window, document: global.document };
  global.window = dom.window; global.document = dom.window.document;
  try {
    delete require.cache[skinsPath]; delete require.cache[surfacePath]; global.module = undefined;
    dom.window.FileTubeMusicSkins = require(skinsPath);
    delete dom.window.FileTubePocketLighting;
    require(surfacePath);
    const panel = dom.window.document.getElementById('panel');
    const engine = dom.window.FileTubeSkinSurface.create({ panel, win: dom.window, getSkinId: () => 'ipod',
      getCtx: () => ({ track: { title: 'T' }, upNext: [], fullList: [], playing: true }), hostCtl: (id) => dom.window.document.getElementById(id),
      menu: { load: () => Promise.resolve({ items: [] }), onPlay() {}, hasCurrent: () => true, currentId: () => 'x', dataVersion: () => 0 } });
    engine.paint();
    assert.strictEqual(engine.lightingState(), null);
    tap({ win: dom.window }, panel.querySelector('[data-skin-menu]'));
    const rows = [...panel.querySelectorAll('.ipm-row .ipm-lbl')].map((x) => x.textContent);
    const settings = [...panel.querySelectorAll('.ipm-row')].find((r) => r.querySelector('.ipm-lbl').textContent === 'Settings');
    tap({ win: dom.window }, settings);
    assert.deepStrictEqual([...panel.querySelectorAll('.ipm-row .ipm-lbl')].map((x) => x.textContent), ['About'], 'no driver: no Lighting row; rows were ' + rows.join('|'));
  } finally { Object.assign(global, saved); }
});

// ---------------------------------------------------------------- the CSS lock (jsdom-invisible)
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
function rule(selector) {
  const i = CSS.indexOf('\n  ' + selector + '{');
  assert.ok(i >= 0, 'rule present: ' + selector);
  return CSS.slice(i, CSS.indexOf('}', i) + 1);
}
test('AC6 CSS lock: the three Click wheels and domes read the light (unset = the old constants); Seattle does not; the band and glass exist only when lit; no filter / blur / mask / backdrop anywhere in the lighting rules', () => {
  const clickWheels = ['.mms-ipod .ip-wheel', '.mms-ipod-black .ip-wheel', '.mms-ipod-matte .ip-wheel'];
  const clickDomes = ['.mms-ipod .ip-center', '.mms-ipod-black .ip-center', '.mms-ipod-matte .ip-center'];
  for (const sel of clickWheels) {
    const r = rule(sel);
    assert.match(r, /at calc\(50% \+ var\(--lx,0\) \* 30%\) calc\(-8% \+ var\(--ly,0\) \* 26%\)/, sel + ': the sheen sits where the light is (unset = 50% -8%, the old constant)');
    assert.match(r, /circle at calc\(50% \+ var\(--lx,0\) \* 10%\) calc\(4[02]% \+ var\(--ly,0\) \* 10%\)/, sel + ': the base ramp follows');
  }
  assert.match(rule('.mms-ipod .ip-wheel'), /box-shadow:var\(--mms-lit-wheel-shadow, var\(--mms-ipod-wheel-shadow\)\)/, 'the rim / recess / drop turn directional only when lit (the static token is the fallback)');
  for (const sel of clickDomes) assert.match(rule(sel), /circle at calc\(50% \+ var\(--lx,0\) \* 16%\) calc\((40|38)% \+ var\(--ly,0\) \* 16%\)/, sel);
  assert.match(rule('.mms-ipod .ip-center'), /box-shadow:var\(--mms-lit-dome-shadow, var\(--mms-ipod-center-shadow\)\)/);
  // Seattle untouched (Dean's ruling): its pad, center and flanks keep literal positions and the static shadow
  assert.match(rule('.mms-zune-classic .ip-wheel.znc-pad'), /at 50% -8%/);
  assert.match(rule('.mms-zune-classic .ip-center.znc-center'), /circle at 50% 40%/);
  assert.match(rule('.mms-zune-classic .znc-flank'), /box-shadow:var\(--mms-ipod-wheel-shadow\)/);
  assert.ok(!/\.mms-zune-classic[^{]*\{[^}]*--l[xy]/.test(CSS), 'no Seattle rule reads --lx/--ly');
  // the lit-only tokens: defined ONCE, on the lit panel; the band + glass are pseudo-elements gated by .mms-lit
  assert.strictEqual((CSS.match(/--mms-lit-wheel-shadow\s*:/g) || []).length, 1);
  assert.strictEqual((CSS.match(/--mms-lit-dome-shadow\s*:/g) || []).length, 1);
  const litRoot = rule('.mms-ipod.mms-lit');
  assert.match(litRoot, /--mms-lit-wheel-shadow:calc\(var\(--lx,0\) \* -4px\) calc\(1px \+ var\(--ly,0\) \* -4px\) 2px var\(--mms-lit-drop\), inset calc\(var\(--lx,0\) \* 2px\) calc\(1px \+ var\(--ly,0\) \* 2px\) 1px var\(--mms-lit-rim\), inset calc\(var\(--lx,0\) \* -2px\) calc\(-2px \+ var\(--ly,0\) \* -2px\) 4px var\(--mms-lit-recess\)/, 'at --lx/--ly = 0 this is byte-identical to the static wheel shadow (0 1px 2px, inset 0 1px 1px, inset 0 -2px 4px)');
  const band = rule('.mms-ipod.mms-lit::before');
  assert.match(band, /position:absolute; inset:-40%; z-index:-1;/, 'the band sits over the body ramp, under the LCD and wheel');
  assert.match(band, /pointer-events:none/);
  assert.match(band, /transform:translate3d\(calc\(var\(--lx,0\) \* 12%\), calc\(var\(--ly,0\) \* 10%\), 0\)/, 'a transform on one gradient layer (compositor-only)');
  const glass = rule('.mms-ipod.mms-lit .ip-lcd-in::after');
  assert.match(glass, /pointer-events:none/, 'the glass streak never takes a tap');
  assert.match(glass, /var\(--mms-lit-glass\)/);
  assert.ok(!/\n {2}\.mms-ipod::before\{/.test(CSS) && !/\n {2}\.mms-ipod \.ip-lcd-in::after\{/.test(CSS), 'no band or glass layer exists when NOT lit');
  // the HARD constraint: nothing animated is a filter, blur, mask or backdrop - vendor + case + sibling spellings (v1.313 lesson)
  const litRules = CSS.split('\n').filter((l) => /--l[xy]|mms-lit/.test(l)).join('\n');
  assert.ok(!/(?:^|[^-\w])(?:-webkit-)?(?:filter|backdrop-filter|mask(?:-image)?)\s*:/i.test(litRules), 'no filter / backdrop / mask in any lighting rule: ' + litRules.match(/[^\n]*(?:filter|mask)[^\n]*/i));
  assert.ok(!/blur\(/i.test(litRules), 'no blur()');
  // Matte is softer, Black dimmer than Click (G1)
  const alpha = (name) => Number((CSS.match(new RegExp(name + ':rgba\\(255,255,255,(\\.\\d+)\\)')) || [])[1]);
  assert.ok(alpha('--mms-lit-band') > alpha('--mms-litk-band') && alpha('--mms-litk-band') > alpha('--mms-litm-band'), 'Click > Black > Matte band strength');
});

// ---------------------------------------------------------------- shell parity (dynamic, never a list)
test('AC7 every shell that loads skin-surface.js loads pocket-lighting.js right after it (the SPA lazy-loads a view into whatever shell was cold-loaded)', () => {
  const shells = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html'));
  let checked = 0;
  for (const f of shells) {
    const html = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
    const srcs = [...html.matchAll(/<script[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>/gi)].map((m) => m[1]);
    const i = srcs.indexOf('/js/skin-surface.js');
    if (i < 0) { assert.ok(!srcs.includes('/js/pocket-lighting.js'), f + ': lighting without the engine makes no sense'); continue; }
    checked += 1;
    assert.strictEqual(srcs[i + 1], '/js/pocket-lighting.js', f + ': pocket-lighting.js must follow skin-surface.js');
    assert.strictEqual(srcs.filter((s) => s === '/js/pocket-lighting.js').length, 1, f + ': once');
  }
  assert.ok(checked >= 10, 'the engine shells were enumerated (' + checked + ')');
});
