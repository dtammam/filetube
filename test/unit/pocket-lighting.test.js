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
test('mapTilt: device axes to screen axes by the screen rotation; the roll is gravity-projected (no gimbal flip upright); a null component is no sample', () => {
  const near = (a, b, m) => assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, m + ` got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
  near(L.mapTilt(0, 5, 0), { x: 5, y: 0 }, 'flat (beta 0): x = gamma (left/right), y = beta (front/back)');
  near(L.mapTilt(0, 5, 90), { x: 0, y: -5 }, 'landscape 90');
  near(L.mapTilt(0, 5, 180), { x: -5, y: 0 }, 'upside down');
  near(L.mapTilt(0, 5, 270), { x: 0, y: 5 }, 'landscape 270');
  near(L.mapTilt(0, 5, -90), { x: 0, y: 5 }, 'the legacy window.orientation -90 is 270');
  // gate r1 (qa S3): held UPRIGHT the raw gamma is unstable and flips sign past vertical; the
  // projected roll shrinks smoothly toward 0 at vertical and keeps its sign through it
  const r40 = L.mapTilt(40, 30, 0).x, r80 = L.mapTilt(80, 30, 0).x, r90 = L.mapTilt(90, 30, 0).x, r100 = L.mapTilt(100, -30, 0).x;
  assert.ok(r40 > 20 && r40 < 30 && r80 > 0 && r80 < r40 && Math.abs(r90) < 1e-9, `the same physical roll reads smaller the more upright the phone (${r40}, ${r80}, ${r90})`);
  assert.ok(r100 > 0 && r100 < 10, `past vertical gamma flips sign (W3C) but the projected roll keeps its sign (${r100})`);
  assert.ok(Math.abs(L.mapTilt(40, 0, 0).y - 40) < 1e-9, 'flat-rolled: the pitch is beta');
  // gate r2 (adversary W5): a physical pose swept THROUGH vertical (W3C Euler angles built from the
  // up-vector, roll 20 deg): raw beta jumps 70 -> 110 at the crossing; the atan2 pitch is continuous
  const euler = (pitchDeg, rollDeg) => { // the device's up-vector in its own frame -> W3C beta/gamma
    const p = pitchDeg * Math.PI / 180, r = rollDeg * Math.PI / 180;
    const gx = -Math.cos(p) * Math.sin(r), gy = Math.sin(p), gz = Math.cos(p) * Math.cos(r);
    const beta = Math.atan2(gy, gz) * 180 / Math.PI;
    const gamma = Math.atan2(-gx, Math.hypot(gy, gz)) * 180 / Math.PI * (Math.cos(beta * Math.PI / 180) < 0 ? -1 : 1);
    return [beta, gamma];
  };
  const ys = [-0.4, -0.2, 0.2, 0.4].map((d) => L.mapTilt(...euler(90 + d, 20), 0).y);
  for (let i = 1; i < ys.length; i++) assert.ok(Math.abs(ys[i] - ys[i - 1]) < 1.5, `continuous through vertical: ${ys.map((v) => v.toFixed(1))}`);
  const xs = [-0.4, 0.4].map((d) => L.mapTilt(...euler(90 + d, 20), 0).x);
  assert.ok(Math.abs(xs[0] - xs[1]) < 1.5, `the roll stays continuous too: ${xs.map((v) => v.toFixed(1))}`);
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
  g = L.recentre(st, 3 + 100, 40, 16);
  assert.strictEqual(g.x, -1, 'clamped at the edge (a 100-degree roll is past the range; the wrap-safe difference keeps its sign below 180)');
  // hold that tilt: the baseline drifts to it and the goal returns to 0 (G5)
  for (let i = 0; i < 5 * L.RECENTER_TAU_MS / 16; i++) g = L.recentre(st, 3 + 20, 40, 16);
  assert.ok(Math.abs(g.x) < 0.01, `a held tilt reads as level again within ~5 tau (got ${g.x})`);
  // gate r2 (qa W5): the pitch wraps at +-180 (lying on your back, the phone overhead): the goal never
  // jumps across the seam, and the baseline follows the short way round
  const w = L.newFilter();
  L.recentre(w, 2, 179.5, 16);
  const seam = [[2, -179.8], [2, 179.6], [2, -179.5], [2, 179.9]].map(([x, y]) => L.recentre(w, x, y, 16).y);
  assert.ok(seam.every((v) => Math.abs(v) < 0.05), `jitter across the +-180 seam reads as a tiny tilt, never edge to edge: ${seam.map((v) => v.toFixed(3))}`);
  for (let i = 0; i < 3000; i++) L.recentre(w, 2, -179.6, 16);
  assert.ok(Math.abs(Math.abs(w.by) - 179.6) < 0.5, `the baseline settled on the held pose the short way round (by ${w.by})`);
  assert.strictEqual(L.wrapDiff(-179, 179), 2); assert.strictEqual(L.wrapDiff(179, -179), -2); assert.strictEqual(L.wrapDiff(10, 4), 6);
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

test('strength: device-local, default Off, garbage normalizes to Off; music-skins and the driver agree on the four values', () => {
  const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  assert.strictEqual(L.readStrength(ls), 'off');
  assert.strictEqual(L.setStrength('pronounced', ls), 'pronounced');
  assert.strictEqual(L.readStrength(ls), 'pronounced');
  assert.strictEqual(L.setStrength('loud', ls), 'off');
  assert.deepStrictEqual(L.STRENGTHS, skins.LIGHTING_STRENGTHS.map((r) => r.value), 'one list of strengths, two modules: a census');
  assert.deepStrictEqual(L.STRENGTHS, ['off', 'subtle', 'pronounced', 'ambient'], 'v1.333: Ambient is the 4th strength, Off still first (the default)');
  assert.strictEqual(L.setStrength('ambient', ls), 'ambient'); assert.strictEqual(L.readStrength(ls), 'ambient');
  assert.deepStrictEqual(L.GAIN, { off: 0, subtle: 0.8, pronounced: 1, ambient: 1 }, 'second swing: Subtle = the old Pronounced travel, Pronounced = the same + the strong profile; v1.333: Ambient = Pronounced\'s travel (D2: the mechanics unchanged)');
  assert.strictEqual(L.TILT_RANGE_DEG, 20, 'a wrist tilt reaches the edge');
  const rows = skins.menuLightingItems({ strength: 'subtle', note: '' });
  assert.deepStrictEqual(rows.map((r) => [r.label, r.action, r.value, r.check]), [['Off', 'lighting', 'off', false], ['Subtle', 'lighting', 'subtle', true], ['Pronounced', 'lighting', 'pronounced', false], ['Ambient', 'lighting', 'ambient', false]]);
  assert.deepStrictEqual(skins.menuLightingItems(null).map((r) => r.check), [true, false, false, false], 'no driver state: Off is checked');
  assert.deepStrictEqual(skins.menuLightingItems({ strength: 'ambient', note: '' }).map((r) => r.check), [false, false, false, true], 'Ambient checks Ambient');
  const noted = skins.menuLightingItems({ strength: 'pronounced', note: L.NOTE_DENIED });
  assert.strictEqual(noted.length, 5);
  assert.deepStrictEqual(noted[4], { label: L.NOTE_DENIED, note: true, info: true }, 'a read-only note row');
  assert.deepStrictEqual(skins.menuStaticItems({ type: 'settings' }, { hasLighting: true }).map((r) => r.label), ['Lighting', 'About']);
  assert.deepStrictEqual(skins.menuStaticItems({ type: 'settings' }, {}).map((r) => r.label), ['About'], 'no driver: no row that leads nowhere');
  assert.deepStrictEqual(skins.menuStaticItems({ type: 'settings' }, { hasLighting: false }).map((r) => r.label), ['About'], 'hasLighting false: no row');
  assert.strictEqual(skins.menuTitle({ type: 'lighting' }, 'click'), 'Lighting');
  assert.ok(!skins.menuIsItemLevel({ type: 'lighting' }), 'a menu level (Click keeps the cover drift there)');
  const html = skins.renderMenuList({ style: 'click', items: noted, cursor: 1, start: 0, end: 5, rowH: 0, state: 'ready' });
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

function boot({ skin = 'ipod', strength = 'pronounced', reduced = false, finePointer = true, permission, otherDoc = false, menu = true, sticker } = {}) {
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
    sticker,
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
// The REAL wheel gesture (pocket-quick-scroll.test.js's spin): pointerdown on the ring, `moves`
// pointermoves of `step` degrees each, `ms` apart on a fake performance clock, then release.
function spin(b, { from = 0, moves, step, ms }) {
  const wheel = P(b).querySelector('.ip-wheel');
  const at = (deg) => { const r = deg * Math.PI / 180; return { clientX: 100 * Math.cos(r), clientY: 100 * Math.sin(r) }; };
  const realNow = performance.now;
  let t = realNow.call(performance);
  Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => t });
  try {
    const s = at(from);
    wheel.dispatchEvent(new b.win.MouseEvent('pointerdown', { bubbles: true, clientX: s.clientX, clientY: s.clientY }));
    let deg = from;
    for (let i = 0; i < moves; i++) { t += ms; deg += step; const q = at(deg); wheel.dispatchEvent(new b.win.MouseEvent('pointermove', { bubbles: true, clientX: q.clientX, clientY: q.clientY })); }
    wheel.dispatchEvent(new b.win.MouseEvent('pointerup', { bubbles: true }));
  } finally { Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: realNow }); }
}
const slowSpin = (b, detents, dir = 1) => spin(b, { moves: detents * 4, step: 5.6 * dir, ms: 60 });
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
// (visibilitychange is counted apart: the engine binds its own on the document while bound, and the
// driver binds ONE from create() to destroy() - gate r1 W1: the RETURN from a hidden tab is what
// re-lights the panel, so that listener never goes with a stop(); 2 = engine + driver, 0 = destroyed)
const listening = (b) => ({ orient: b.count('win:deviceorientation'), move: b.count('panel:pointermove'), leave: b.count('panel:pointerleave') });
const vis = (b) => b.count('doc:visibilitychange');

test('AC1 reachability: a REAL deviceorientation event moves --lx/--ly on the panel through the real engine; opposite the tilt; scaled by the strength', () => {
  const b = boot({ strength: 'pronounced' });
  try {
    b.engine.paint();
    assert.ok(lit(b) && S(b).listening, 'a painted Click skin with the strength on is lit and listening');
    assert.deepStrictEqual(listening(b), { orient: 1, move: 1, leave: 1 }, 'exactly one listener each');
    assert.strictEqual(vis(b), 2, 'the engine\'s visibilitychange + the driver\'s');
    tiltTo(b, 0, 3);              // the neutral pose (whatever you hold it at)
    b.clock.advance(200);
    assert.strictEqual(lx(b), 0, 'the opening pose is neutral: no offset');
    tiltTo(b, 0, 3 + L.TILT_RANGE_DEG);         // tilt RIGHT by the full range
    b.clock.advance(100);
    assert.ok(S(b).raf, 'the frame loop is live while samples stream');
    b.clock.advance(600);
    assert.ok(lx(b) < -0.9, `the light slides LEFT (opposite the tilt): --lx = ${lx(b)}`);
    assert.ok(Math.abs(ly(b)) < 0.05, 'no front/back tilt: --ly stays ~0');
    // Subtle halves it
    b.ls.setItem(L.KEY, 'subtle'); b.engine.paint(); // (in production a pick goes through choose() -> sync(); a paint re-syncs the same way)
    tiltTo(b, 0, 3); b.clock.advance(50); tiltTo(b, 0, 3 + L.TILT_RANGE_DEG); b.clock.advance(700); // a fresh start: a fresh neutral, then the tilt
    assert.ok(lx(b) < -0.62 && lx(b) > -0.85, `subtle = 0.8 of the amplitude, less ~1 s of re-centring (got ${lx(b)})`);
    assert.ok(!P(b).classList.contains('mms-lit-strong') && lit(b), 'Subtle: lit, but never the strong profile');
    b.ls.setItem(L.KEY, 'pronounced'); b.engine.paint();
    assert.ok(P(b).classList.contains('mms-lit-strong'), 'Pronounced: the strong profile class (AC1)');
    tiltTo(b, 0, 3 + L.TILT_RANGE_DEG); b.clock.advance(700);
    assert.ok(Number(P(b).style.getPropertyValue('--lm')) > 0.6, `--lm = the light's distance from centre (AC2; less ~0.7 s of re-centring): ${P(b).style.getPropertyValue('--lm')}`);
    // gate r2 (adversary S5, J2): a hide while the loop is LIVE cancels the pending frame (the clock,
    // not the driver's own flag); no menu is open here, so nothing else may pend
    tiltTo(b, 0, 3 + 20);
    assert.ok(S(b).raf && b.clock.live() >= 1, 'a frame is pending');
    Object.defineProperty(b.doc, 'hidden', { configurable: true, value: true }); b.doc.dispatchEvent(new b.win.Event('visibilitychange'));
    assert.strictEqual(b.clock.live(), 0, 'stop() cancelled the frame (cancelAnimationFrame is bound)');
    Object.defineProperty(b.doc, 'hidden', { configurable: true, value: false }); b.doc.dispatchEvent(new b.win.Event('visibilitychange'));
    tiltTo(b, 0, 3); b.clock.advance(50); tiltTo(b, 0, 3 + L.TILT_RANGE_DEG); b.clock.advance(700);
    // a HELD tilt (G5): the neutral pose drifts onto it, the light eases home, and only then
    // does the loop park (no rAF, no timer, no writes) until the next sample
    b.clock.advance(7 * L.RECENTER_TAU_MS);
    assert.ok(Math.abs(lx(b)) < 0.02, `a held tilt re-centres through the real engine (got ${lx(b)})`);
    assert.strictEqual(S(b).raf, false, 'settled and no new sample: the loop parked');
    const w0 = S(b).writes;
    b.clock.advance(2000);
    assert.strictEqual(S(b).writes, w0, 'no writes while parked');
    assert.strictEqual(b.clock.live(), 0, 'no timer of any kind pending');
    tiltTo(b, 0, 3 + L.TILT_RANGE_DEG);
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
    tiltTo(b, 0, 3); b.clock.advance(100); tiltTo(b, 0, 3 + 14); b.clock.advance(500);
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
    tiltTo(b, 0, 3); b.clock.advance(50); tiltTo(b, 0, 30); b.clock.advance(500);
    assert.ok(lx(b) < -0.5 && lit(b), 'populated AND lit before the clear axis is driven');
    // through the REAL Settings > Lighting path
    pressMenu(b); tapLabel(b, 'Settings');
    assert.deepStrictEqual(lbls(b), ['Lighting', 'About']);
    tapLabel(b, 'Lighting');
    assert.deepStrictEqual(lbls(b), ['Off', 'Subtle', 'Pronounced', 'Ambient']);
    assert.strictEqual(P(b).querySelector('.ipm-row.is-checked .ipm-lbl').textContent, 'Pronounced');
    tapLabel(b, 'Off'); await flush();
    assert.strictEqual(P(b).querySelector('.ipm-row.is-checked .ipm-lbl').textContent, 'Off', 'the check moved');
    assert.strictEqual(P(b).style.getPropertyValue('--lx'), '', '--lx cleared');
    assert.strictEqual(P(b).style.getPropertyValue('--ly'), '', '--ly cleared');
    assert.strictEqual(P(b).style.getPropertyValue('--lm'), '', '--lm cleared');
    assert.ok(!lit(b) && !P(b).classList.contains('mms-lit-strong'), 'both lit classes dropped');
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'every listener unbound');
    assert.strictEqual(vis(b), 2, 'the driver keeps its visibilitychange (it re-lights on a return), the engine its own');
    assert.strictEqual(S(b).raf, false, 'the frame loop was live (samples streamed): Off cancelled its rAF (gate r1 J2/J3)');
    assert.strictEqual(S(b).raf, false);
    assert.strictEqual(b.ls.getItem(L.KEY), 'off', 'stored');
    tapLabel(b, 'Subtle'); await flush();
    tapLabel(b, 'Pronounced'); await flush();
    assert.deepStrictEqual(listening(b), { orient: 1, move: 1, leave: 1 }, 'two picks: still exactly one listener each');
    assert.strictEqual(vis(b), 2);
    assert.ok(lit(b));
    tiltTo(b, 0, 3); b.clock.advance(50); tiltTo(b, 0, 30); b.clock.advance(500);
    assert.ok(lx(b) < -0.5, 'lit again through the real path');
  } finally { b.restore(); }
});

test('AC3 every teardown arm unbinds: the dock (no destroy), a hidden document, a repaint as Cider, the tray, reduced motion, destroy - measured over repeated mounts', async () => {
  const b = boot({ strength: 'pronounced' });
  try {
    const zero = { orient: 0, move: 0, leave: 0 };
    const one = { orient: 1, move: 1, leave: 1 };
    const light = () => { b.engine.paint(); tiltTo(b, 0, 3); b.clock.advance(50); tiltTo(b, 0, 30); b.clock.advance(300); assert.deepStrictEqual(listening(b), one); assert.ok(lit(b) && lx(b) < 0); };
    for (let n = 0; n < 3; n++) {
      // (a) the DOCK: the view clears the panel synchronously WITHOUT destroy() (v1.256 class)
      light();
      P(b).hidden = true; P(b).innerHTML = '';
      b.clock.advance(40); // one frame: the LIVE loop notices and stops itself (the observer would too)
      assert.deepStrictEqual(listening(b), zero, `dock #${n}: unbound within a frame`);
      assert.strictEqual(vis(b), 2, 'the driver\'s visibilitychange stays (it re-lights on a return); the engine\'s too');
      assert.strictEqual(S(b).raf, false);
      assert.strictEqual(b.clock.live(), 0, 'nothing pending');
      P(b).hidden = false;
      // (b) a hidden document (the tab in the background)
      light();
      Object.defineProperty(b.doc, 'hidden', { configurable: true, value: true });
      b.doc.dispatchEvent(new b.win.Event('visibilitychange'));
      assert.deepStrictEqual(listening(b), zero, `hidden #${n}: unbound on visibilitychange`);
      Object.defineProperty(b.doc, 'hidden', { configurable: true, value: false });
      b.doc.dispatchEvent(new b.win.Event('visibilitychange'));
      assert.deepStrictEqual(listening(b), one, `return #${n}: re-bound by the visibility listener alone, NO paint (gate r1 W1: an iPhone unlock)`);
      assert.ok(lit(b));
      tiltTo(b, 0, 3); b.clock.advance(50); tiltTo(b, 0, 30); b.clock.advance(300);
      assert.ok(lx(b) < 0, 'and it moves again after the return');
      // (c) a repaint as a non-Click skin
      b.state.skin = 'apple'; b.engine.paint();
      assert.deepStrictEqual(listening(b), zero, `Cider #${n}: no lighting`);
      assert.ok(!lit(b));
      assert.ok(P(b).style.getPropertyValue('--lx') === '', `Cider #${n}: the light is cleared`);
      b.state.skin = 'ipod-matte';
      // (d) the tray (the pop-out's Nano strip)
      b.doc.body.classList.add('mms-tray'); b.engine.paint();
      assert.deepStrictEqual(listening(b), zero, `tray #${n}: no lighting`);
      b.doc.body.classList.remove('mms-tray');
    }
    // (e) destroy - terminal (the view / pop-out shell never paints a destroyed engine again)
    light();
    b.engine.destroy();
    assert.deepStrictEqual(listening(b), zero, 'destroy');
    assert.strictEqual(vis(b), 0, 'destroy: engine and driver both unbound');
    assert.strictEqual(S(b).raf, false);
    assert.strictEqual(P(b).style.getPropertyValue('--lx'), '');
    b.doc.dispatchEvent(new b.win.Event('visibilitychange'));
    assert.deepStrictEqual(listening(b), zero, 'a visibility flip after destroy re-binds nothing');
  } finally { b.restore(); }
});

// v1.333 (plan 2026-09-25-pocket-lighting-ambient, AC1): Ambient = Pronounced's classes plus ONE more that
// swaps only the body's reflection layers. Both axes on a POPULATED panel: every arm that clears the light
// clears all three classes (the v1.271 unbind class), and Pronounced never carries the Ambient class.
test('AC1 Ambient: lit = mms-lit + mms-lit-strong + mms-lit-ambient; Pronounced never carries mms-lit-ambient; Off, a pick, the dock, a hidden document, a skin switch, the tray and destroy clear all three', async () => {
  const b = boot({ strength: 'ambient' });
  const cls = () => ['mms-lit', 'mms-lit-strong', 'mms-lit-ambient'].filter((c) => P(b).classList.contains(c));
  const ALL3 = ['mms-lit', 'mms-lit-strong', 'mms-lit-ambient'];
  try {
    const light = () => { b.engine.paint(); tiltTo(b, 0, 3); b.clock.advance(50); tiltTo(b, 0, 30); b.clock.advance(300); assert.deepStrictEqual(cls(), ALL3, 'Ambient lights with all three classes'); assert.ok(lx(b) < -0.5, 'Pronounced\'s travel (gain 1)'); };
    light();
    assert.strictEqual(S(b).strength, 'ambient');
    // through the REAL Settings > Lighting path: Pronounced drops ONLY the Ambient class, Ambient restores it
    pressMenu(b); tapLabel(b, 'Settings'); tapLabel(b, 'Lighting');
    assert.strictEqual(P(b).querySelector('.ipm-row.is-checked .ipm-lbl').textContent, 'Ambient');
    tapLabel(b, 'Pronounced'); await flush();
    assert.deepStrictEqual(cls(), ['mms-lit', 'mms-lit-strong'], 'Pronounced: never the Ambient class');
    tapLabel(b, 'Subtle'); await flush();
    assert.deepStrictEqual(cls(), ['mms-lit'], 'Subtle: the base profile only');
    tapLabel(b, 'Ambient'); await flush();
    assert.deepStrictEqual(cls(), ALL3, 'Ambient again');
    tapLabel(b, 'Off'); await flush();
    assert.deepStrictEqual(cls(), [], 'Off clears all three');
    tapLabel(b, 'Ambient'); await flush();
    // (a) the dock, (b) a hidden document, (c) a non-Click repaint, (d) the tray - each from a LIT Ambient panel
    light();
    P(b).hidden = true; P(b).innerHTML = ''; b.clock.advance(40);
    assert.deepStrictEqual(cls(), [], 'the dock clears all three');
    P(b).hidden = false;
    light();
    Object.defineProperty(b.doc, 'hidden', { configurable: true, value: true });
    b.doc.dispatchEvent(new b.win.Event('visibilitychange'));
    assert.deepStrictEqual(cls(), [], 'a hidden document clears all three');
    Object.defineProperty(b.doc, 'hidden', { configurable: true, value: false });
    b.doc.dispatchEvent(new b.win.Event('visibilitychange'));
    assert.deepStrictEqual(cls(), ALL3, 'the return re-lights Ambient (no paint)');
    b.state.skin = 'apple'; b.engine.paint();
    assert.deepStrictEqual(cls(), [], 'a non-Click skin: none of the three');
    b.state.skin = 'ipod-red';
    light();
    b.doc.body.classList.add('mms-tray'); b.engine.paint();
    assert.deepStrictEqual(cls(), [], 'the tray: none of the three');
    b.doc.body.classList.remove('mms-tray');
    light();
    b.engine.destroy();
    assert.deepStrictEqual(cls(), [], 'destroy clears all three');
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'and unbinds');
  } finally { b.restore(); }
});

// v1.333 (plan 2026-09-25-pocket-lighting-ambient, AC6; Dean: "I think we could add lighting there as well"):
// the sticker menu's Lighting chips ARE the Settings > Lighting pick - the same driver call, inside the tap.
// gate r1 adversary W1: on an iPhone (a permission API, no fine pointer) the panel stays UNLIT until the session's first
// sample - the Ambient class included (its room light and grain would otherwise show a still, lit-looking body after a
// relaunch whose grant iOS forgot). Both axes: absent before the sample, present after it.
test('AC1 the lit gate holds for Ambient: no mms-lit-ambient before the first sample behind a permission gate; all three after it', async () => {
  const b = boot({ strength: 'ambient', finePointer: false, permission: () => Promise.resolve('granted') });
  try {
    b.engine.paint();
    assert.ok(S(b).on, 'precondition: the driver is listening (the question is only the class)');
    for (const c of ['mms-lit', 'mms-lit-strong', 'mms-lit-ambient']) assert.ok(!P(b).classList.contains(c), c + ': not before the first sample');
    tiltTo(b, 0, 3); b.clock.advance(50);
    for (const c of ['mms-lit', 'mms-lit-strong', 'mms-lit-ambient']) assert.ok(P(b).classList.contains(c), c + ': after the first sample');
  } finally { b.restore(); }
});

// gate r1 W2 (both seats, measured): a pick from the STICKER moves Settings > Lighting's check on the LCD too
test('AC6 sticker: a Lighting chip moves the LCD\'s Settings > Lighting check (the level open underneath)', async () => {
  const b = boot({ strength: 'off', sticker: { getPlayer: () => null, onSkinChange() {} } });
  try {
    b.engine.paint();
    pressMenu(b); tapLabel(b, 'Settings'); tapLabel(b, 'Lighting');
    const checked = () => P(b).querySelector('.ipm-row.is-checked .ipm-lbl').textContent;
    assert.strictEqual(checked(), 'Off', 'populated: the LCD shows Off checked');
    tap(b, P(b).querySelector('[data-skin-sticker]'));
    tap(b, P(b).querySelector('[data-skin-lighting="ambient"]'));
    assert.strictEqual(checked(), 'Ambient', 'the LCD check followed the sticker pick at once');
    await flush(); await flush();
    assert.strictEqual(checked(), 'Ambient', 'and after the answer');
    assert.strictEqual(b.ls.getItem(L.KEY), 'ambient');
  } finally { b.restore(); }
});

// gate r1 qa W2 / adversary S1: the delayed answer re-draws page 1 ONLY if the menu is still on page 1 - never over the
// Skin or Extras page the user moved to (a device with no permission API and no fine pointer answers after SENSOR_WAIT_MS)
test('AC6 sticker: the late answer re-draws page 1 (the no-sensor note) but never pulls the user off the Skin or Extras page', async () => {
  const b = boot({ strength: 'off', finePointer: false, sticker: { getPlayer: () => null, onSkinChange() {} } });
  const menuEl = () => P(b).querySelector('[data-skin-sticker-menu]');
  try {
    b.engine.paint();
    tap(b, P(b).querySelector('[data-skin-sticker]'));
    // the SHOWING axis first: stay on page 1 and the answer lands there
    tap(b, menuEl().querySelector('[data-skin-lighting="subtle"]'));
    b.clock.advance(L.SENSOR_WAIT_MS + 50); await flush(); await flush();
    assert.strictEqual((menuEl().querySelector('.mms-sm-note') || {}).textContent, L.NOTE_NO_SENSOR, 'populated: the late answer re-drew page 1 with its note');
    // the Skin page: a pick, then the Skin row before the answer
    tap(b, menuEl().querySelector('[data-skin-lighting="pronounced"]'));
    tap(b, menuEl().querySelector('[data-skin-skins]'));
    assert.strictEqual(menuEl().getAttribute('data-sm-page'), 'skins');
    b.clock.advance(L.SENSOR_WAIT_MS + 50); await flush(); await flush();
    assert.strictEqual(menuEl().getAttribute('data-sm-page'), 'skins', 'the answer left the Skin page alone');
    assert.ok(menuEl().querySelector('[data-skin-pick]'), 'its chips still there');
    // the Extras page (the same page marker the Extras menu sets)
    tap(b, menuEl().querySelector('[data-skin-extras-back]'));
    tap(b, menuEl().querySelector('[data-skin-lighting="ambient"]'));
    menuEl().setAttribute('data-sm-page', 'extras'); menuEl().innerHTML = '<div class="mms-sm-sec">extras</div>';
    b.clock.advance(L.SENSOR_WAIT_MS + 50); await flush(); await flush();
    assert.strictEqual(menuEl().getAttribute('data-sm-page'), 'extras', 'the answer left the Extras page alone');
    assert.strictEqual(menuEl().textContent, 'extras');
  } finally { b.restore(); }
});

test('AC6 sticker: the four Lighting chips (the stored one checked) ask iOS from INSIDE the tap and light the pick; never on a non-Click skin or in the tray; no Brick row; Skin is its own page', async () => {
  let asks = 0; let answer = 'granted';
  const permission = () => { asks += 1; return Promise.resolve(answer); };
  const stickerCfg = () => ({ getPlayer: () => null, onSkinChange() {}, brick: { visible: () => true, onTap() {} } });
  const b = boot({ strength: 'off', finePointer: false, permission, sticker: stickerCfg() });
  const menuEl = () => P(b).querySelector('[data-skin-sticker-menu]');
  const openSticker = () => { if (menuEl().hidden) tap(b, P(b).querySelector('[data-skin-sticker]')); assert.ok(!menuEl().hidden, 'the sticker menu is open'); return menuEl(); };
  const chips = () => [...menuEl().querySelectorAll('[data-skin-lighting]')];
  try {
    b.dom.window.localStorage.setItem('ft-music-skin', 'ipod'); // the chips + the Skin row read the GLOBAL pick (SKINS.activeSkinId)
    b.engine.paint();
    let m = openSticker();
    assert.deepStrictEqual(chips().map((c) => [c.getAttribute('data-skin-lighting'), c.textContent]), [['off', 'Off'], ['subtle', 'Subtle'], ['pronounced', 'Pronounced'], ['ambient', 'Ambient']], 'the registry\'s four strengths, in order');
    assert.deepStrictEqual(chips().filter((c) => c.getAttribute('aria-checked') === 'true').map((c) => c.getAttribute('data-skin-lighting')), ['off'], 'the stored strength is checked');
    assert.ok(!m.querySelector('[data-skin-brick]') && !/Brick/.test(m.textContent), 'no Brick row, even with the view\'s hook saying yes (D4)');
    assert.strictEqual(m.querySelectorAll('[data-skin-pick]').length, 0, 'no skin chips on page 1 (D6)');
    assert.match(m.querySelector('[data-skin-skins]').textContent, /Skin.*Click/, 'the Skin row names the active skin');
    // the pick: the motion ask runs INSIDE the tap (user activation), the pick is stored and checked
    tap(b, chips().find((c) => c.getAttribute('data-skin-lighting') === 'ambient'));
    assert.strictEqual(asks, 1, 'requestPermission ran synchronously inside the chip tap');
    assert.strictEqual(b.ls.getItem(L.KEY), 'ambient', 'stored');
    assert.ok(!menuEl().hidden, 'the menu stays open on the pick');
    assert.deepStrictEqual(chips().filter((c) => c.classList.contains('is-on')).map((c) => c.getAttribute('data-skin-lighting')), ['ambient'], 'the check moved');
    await flush(); await flush();
    tiltTo(b, 0, 3); b.clock.advance(50); tiltTo(b, 0, 30); b.clock.advance(300);
    assert.ok(['mms-lit', 'mms-lit-strong', 'mms-lit-ambient'].every((c) => P(b).classList.contains(c)), 'the chip lit Ambient through the driver');
    assert.ok(lx(b) < -0.5, 'and the light moves');
    // a DENY shows the driver's note under the chips once the answer is in (the menu still on page 1)
    answer = 'denied';
    tap(b, chips().find((c) => c.getAttribute('data-skin-lighting') === 'pronounced'));
    assert.strictEqual(asks, 2);
    await flush(); await flush();
    assert.strictEqual((menuEl().querySelector('.mms-sm-note') || {}).textContent, L.NOTE_DENIED, 'the note, as Settings > Lighting shows it');
    // Skin page: the chips, Back to page 1; a chip there still switches skins
    tap(b, menuEl().querySelector('[data-skin-skins]'));
    assert.strictEqual(menuEl().getAttribute('data-sm-page'), 'skins');
    assert.strictEqual(menuEl().querySelectorAll('[data-skin-pick]').length, skins.SKINS.length, 'every skin on the Skin page');
    assert.strictEqual(chips().length, 0, 'the Skin page is only the skins');
    tap(b, menuEl().querySelector('[data-skin-extras-back]'));
    assert.ok(!menuEl().getAttribute('data-sm-page') && chips().length === 4, 'Back lands on page 1');
    // a non-Click skin: no Lighting chips (the driver cannot light it)
    b.state.skin = 'apple'; b.engine.paint();
    m = openSticker();
    assert.strictEqual(chips().length, 0, 'a non-Click skin offers no Lighting chips');
    assert.ok(m.querySelector('[data-skin-skins]'), 'but still its Skin row');
  } finally { b.restore(); }
  // the pop-out: offered (its Settings > Lighting row exists there, the pick is device-local) - but never in the tray
  for (const tray of [false, true]) {
    const cfg = Object.assign(stickerCfg(), { tray: { enabled: () => tray, onToggle() {} } });
    const p = boot({ strength: 'subtle', otherDoc: true, sticker: cfg });
    try {
      if (tray) p.doc.body.classList.add('mms-tray');
      p.engine.paint();
      tap(p, P(p).querySelector('[data-skin-sticker]'));
      const mm = P(p).querySelector('[data-skin-sticker-menu]');
      assert.strictEqual(mm.querySelectorAll('[data-skin-lighting]').length, tray ? 0 : 4, (tray ? 'the tray: no' : 'the pop-out: four') + ' Lighting chips');
      assert.strictEqual(!!mm.querySelector('[data-skin-skins]'), !tray, tray ? 'the tray keeps its inline Color chips' : 'the pop-out gets the Skin row');
      if (tray) assert.ok(mm.querySelectorAll('[data-skin-pick]').length >= 3, 'the tray\'s Color chips');
    } finally { p.restore(); }
  }
  // the plain-window pop-out fallback: body.mms-tray with NO tray hook - the tray is never lit, so no chips there either
  const q = boot({ strength: 'subtle', otherDoc: true, sticker: stickerCfg() });
  try {
    q.doc.body.classList.add('mms-tray'); q.engine.paint();
    tap(q, P(q).querySelector('[data-skin-sticker]'));
    const qm = P(q).querySelector('[data-skin-sticker-menu]');
    assert.strictEqual(qm.querySelectorAll('[data-skin-lighting]').length, 0, 'a tray body with no tray hook: no Lighting chips');
    // gate r1 adversary W3: ...and its inline chips exactly as v1.332 drew them (the whole list, headed Skin), no Skin row
    assert.strictEqual(qm.querySelectorAll('[data-skin-pick]').length, skins.SKINS.length, 'every skin inline, as before');
    assert.ok(!qm.querySelector('[data-skin-skins]'), 'no Skin page there');
    assert.match(qm.textContent, /Skin/);
  } finally { q.restore(); }
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
    assert.strictEqual(vis(b), 2, 'the standing visibility listeners stay (engine + driver)');
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
    assert.strictEqual(vis(b), 2, 'the driver\'s standing visibility listener + the engine\'s; nothing else');
    assert.ok(!lit(b));
    tiltTo(b, 0, 30); b.clock.advance(500);
    assert.strictEqual(P(b).style.getPropertyValue('--lx'), '');
    pressMenu(b); tapLabel(b, 'Settings'); tapLabel(b, 'Lighting'); tapLabel(b, 'Subtle'); await flush();
    assert.ok(lbls(b).includes(L.NOTE_REDUCED), 'the note row');
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'a pick under reduced motion binds nothing');
  } finally { b.restore(); }
});

test('AC4 iOS permission: asked ONCE from the tap; denied keeps the strength + the note and binds nothing that streams; granted binds', async () => {
  let asks = 0;
  const b = boot({ strength: 'off', finePointer: false, permission: () => { asks += 1; return Promise.resolve('denied'); } });
  try {
    b.engine.paint();
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'Off: nothing');
    pressMenu(b); tapLabel(b, 'Settings'); tapLabel(b, 'Lighting');
    tapLabel(b, 'Pronounced');
    assert.strictEqual(asks, 1, 'requestPermission ran inside the tap (user activation)');
    await flush(); await flush();
    assert.ok(lbls(b).includes(L.NOTE_DENIED), 'denied: the note row');
    // gate r1 qa S2 / r2 adversary R8: the wheel never parks the highlight on the note row
    slowSpin(b, 4, 1);
    assert.strictEqual(b.engine.menuState().cursor, 3, 'clamped to the last option (Ambient since v1.333), not the note');
    assert.strictEqual(P(b).querySelector('.ipm-row.is-cursor .ipm-lbl').textContent, 'Ambient');
    slowSpin(b, 1, -1);
    assert.strictEqual(P(b).querySelector('.ipm-row.is-cursor .ipm-lbl').textContent, 'Pronounced', 'the wheel still moves among the options');
    assert.strictEqual(b.ls.getItem(L.KEY), 'pronounced', 'the pick is kept (Dean: keep the strength + a note)');
    assert.strictEqual(P(b).querySelector('.ipm-row.is-checked .ipm-lbl').textContent, 'Pronounced');
    // gate r1 (adversary W3): a deny on a device with no mouse = the look stays TODAY's - not lit,
    // not listening (a lit band waiting for samples that never come is not "as today")
    assert.ok(!lit(b), 'not lit after a deny');
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'nothing bound after a deny');
    tiltTo(b, 0, 30); b.clock.advance(500);
    assert.strictEqual(P(b).style.getPropertyValue('--lx'), '', 'no offset ever written after a deny');
    tapLabel(b, 'Off'); await flush();
    assert.ok(!lbls(b).includes(L.NOTE_DENIED), 'a re-pick clears the stale note (gate r1 J15)');
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
    tiltTo(g, 0, 3); g.clock.advance(50); tiltTo(g, 0, 30); g.clock.advance(500);
    assert.ok(lx(g) < -0.6 && lx(g) > -0.9, `subtle after a grant (got ${lx(g)})`);
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
  // a FINE pointer (a desktop) never gets the no-sensor note: the mouse is the light (gate r1 J12)
  const f = boot({ strength: 'off', finePointer: true });
  try {
    f.engine.paint(); pressMenu(f); tapLabel(f, 'Settings'); tapLabel(f, 'Lighting'); tapLabel(f, 'Pronounced'); await flush();
    f.clock.advance(L.SENSOR_WAIT_MS + 10); await flush(); await flush();
    assert.ok(!lbls(f).includes(L.NOTE_NO_SENSOR), 'no note on a desktop');
  } finally { f.restore(); }
  // gate r2 (qa W4): a RELAUNCH with the strength stored, behind a permission API, on a device with no
  // mouse - a remembered deny or a forgotten grant streams nothing: the panel must not be lit until the
  // first sample proves the sensor streams (never a lit-but-still band on every launch)
  const rl = boot({ strength: 'pronounced', finePointer: false, permission: () => Promise.resolve('granted') });
  try {
    rl.engine.paint();
    assert.deepStrictEqual(listening(rl), { orient: 1, move: 1, leave: 1 }, 'bound (a remembered grant streams at once on iOS)');
    assert.ok(!lit(rl), 'NOT lit before a sample');
    rl.clock.advance(5000);
    assert.ok(!lit(rl) && P(rl).style.getPropertyValue('--lx') === '', 'still today\'s look: nothing streamed');
    assert.ok(!P(rl).classList.contains('mms-lit-strong'), 'nor the strong profile before a sample');
    tiltTo(rl, 0, 3);
    assert.ok(lit(rl) && P(rl).classList.contains('mms-lit-strong'), 'lit (and strong: pronounced) the moment the sensor streams');
    // a stop/start cycle re-gates
    P(rl).hidden = true; P(rl).innerHTML = ''; await flush(); P(rl).hidden = false; rl.engine.paint();
    assert.ok(!lit(rl), 'a fresh start waits for its own first sample');
  } finally { rl.restore(); }
  // ...and a desktop (a fine pointer) or Android (no permission API) is lit at once
  const dk = boot({ strength: 'pronounced', finePointer: true, permission: () => Promise.resolve('granted') });
  try { dk.engine.paint(); assert.ok(lit(dk), 'a fine pointer drives: lit at once'); } finally { dk.restore(); }
  const an = boot({ strength: 'pronounced', finePointer: false });
  try { an.engine.paint(); assert.ok(lit(an), 'no permission API: lit at once'); } finally { an.restore(); }
  // a LATE answer after destroy() re-binds nothing (gate r1 S2)
  let late = null;
  const d = boot({ strength: 'off', permission: () => new Promise((r) => { late = r; }) });
  try {
    d.engine.paint(); pressMenu(d); tapLabel(d, 'Settings'); tapLabel(d, 'Lighting'); tapLabel(d, 'Pronounced');
    d.engine.destroy();
    assert.deepStrictEqual(listening(d), { orient: 0, move: 0, leave: 0 });
    late('granted'); await flush(); await flush();
    assert.deepStrictEqual(listening(d), { orient: 0, move: 0, leave: 0 }, 'the late grant found a destroyed driver');
    assert.strictEqual(vis(d), 0);
  } finally { d.restore(); }
});

test('the first-tap ask (Dean 2026-09-25: the installed app forgets the motion grant at every launch): with a strength stored and no grant, the FIRST tap anywhere asks from inside the gesture, once per session; a grant lights, a deny notes; a Lighting-row pick or a streaming sample supersedes it; every arm unbinds', async () => {
  const strong = (x) => P(x).classList.contains('mms-lit-strong');
  let asks = 0;
  const b = boot({ strength: 'pronounced', finePointer: false, permission: () => { asks += 1; return Promise.resolve('granted'); } });
  try {
    b.engine.paint();
    assert.ok(!lit(b) && S(b).askArmed, 'a relaunch: bound, not lit, the first-tap ask armed');
    assert.strictEqual(b.count('doc:click'), 1, 'one capture listener on the document');
    assert.strictEqual(b.count('doc:touchend'), 1);
    assert.strictEqual(asks, 0, 'nothing asked without a gesture');
    b.doc.body.dispatchEvent(new b.win.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(asks, 1, 'the first tap asked (inside the gesture)');
    assert.strictEqual(b.count('doc:click') + b.count('doc:touchend'), 0, 'the listeners went with the ask');
    await flush(); await flush();
    assert.strictEqual(S(b).permission, 'granted');
    b.doc.body.dispatchEvent(new b.win.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(asks, 1, 'once per session');
    tiltTo(b, 0, 3);
    assert.ok(lit(b) && strong(b), 'the grant streams: lit (Pronounced = strong) on the first sample');
    P(b).hidden = true; P(b).innerHTML = ''; await flush(); P(b).hidden = false; b.engine.paint();
    assert.ok(!S(b).askArmed && b.count('doc:click') === 0, 'granted this session: no ask armed on a repaint');
  } finally { b.restore(); }
  let asks2 = 0;
  const d = boot({ strength: 'pronounced', finePointer: false, permission: () => { asks2 += 1; return Promise.resolve('denied'); } });
  try {
    d.engine.paint();
    d.doc.body.dispatchEvent(new d.win.Event('touchend', { bubbles: true }));
    await flush(); await flush();
    assert.strictEqual(asks2, 1, 'a touch lifting counts as the gesture');
    assert.ok(!lit(d) && S(d).note === L.NOTE_DENIED, 'denied: not lit, the note');
    assert.deepStrictEqual(listening(d), { orient: 0, move: 0, leave: 0 }, 'a deny binds nothing that streams');
    pressMenu(d); tapLabel(d, 'Settings'); tapLabel(d, 'Lighting');
    assert.ok(lbls(d).includes(L.NOTE_DENIED), 'the Lighting level shows the note');
    tapLabel(d, 'Subtle'); await flush();
    assert.strictEqual(asks2, 2, 'the Lighting row still asks itself (a re-pick after a deny)');
  } finally { d.restore(); }
  for (const opts of [{ strength: 'off', finePointer: false, permission: () => Promise.resolve('granted') }, { strength: 'pronounced', finePointer: true, permission: () => Promise.resolve('granted') }, { strength: 'pronounced', finePointer: false }]) {
    const n = boot(opts);
    try { n.engine.paint(); assert.strictEqual(n.count('doc:click') + n.count('doc:touchend'), 0, JSON.stringify(Object.keys(opts)) + ': no first-tap ask'); assert.ok(!S(n).askArmed); } finally { n.restore(); }
  }
  const s = boot({ strength: 'pronounced', finePointer: false, permission: () => Promise.resolve('granted') });
  try {
    s.engine.paint(); assert.strictEqual(s.count('doc:click'), 1);
    s.ls.setItem(L.KEY, 'off'); s.engine.paint();
    assert.strictEqual(s.count('doc:click') + s.count('doc:touchend'), 0, 'Off disarms the ask');
    s.ls.setItem(L.KEY, 'pronounced'); s.engine.paint(); assert.strictEqual(s.count('doc:click'), 1);
    s.engine.destroy();
    assert.strictEqual(s.count('doc:click') + s.count('doc:touchend'), 0, 'destroy disarms the ask');
  } finally { s.restore(); }
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
    assert.strictEqual(vis(b), 0, 'destroy drops the driver\'s standing visibility listener with the engine\'s');
  } finally { b.restore(); }
});

test('gate r1 hardening: a fresh open is a fresh neutral pose (J9); the observer never leaks (J1); pointerLight clamps (J8); a still stream writes nothing (J4); pointerleave never eases a SENSOR-driven light (J7); screen.orientation maps the axes (J11)', async () => {
  const b = boot({ strength: 'pronounced' });
  try {
    // J1: observers balance over start/stop cycles
    let observing = 0;
    const MO = b.win.MutationObserver;
    b.win.MutationObserver = class extends MO { observe(...a) { observing += 1; return super.observe(...a); } disconnect() { observing -= 1; return super.disconnect(); } };
    for (let i = 0; i < 4; i++) { b.engine.paint(); assert.strictEqual(observing, 1, 'one observer while lit'); P(b).hidden = true; P(b).innerHTML = ''; await flush(); assert.strictEqual(observing, 0, 'none after the dock'); P(b).hidden = false; }
    // J9: the neutral pose is the pose of THIS open, not the last one
    b.engine.paint();
    tiltTo(b, 0, 3); b.clock.advance(50); tiltTo(b, 0, 30); b.clock.advance(400);
    assert.ok(lx(b) < -0.5, 'lit and offset');
    P(b).hidden = true; P(b).innerHTML = ''; await flush(); P(b).hidden = false;
    b.engine.paint();
    tiltTo(b, 0, 30); b.clock.advance(400); // the SAME pose the last open ended in is neutral now
    assert.strictEqual(P(b).style.getPropertyValue('--lx'), '', 'the first sample of a fresh open is neutral (nothing written)');
    // J4: a still device at its neutral pose (the same sample every frame) writes NOTHING
    const w0 = S(b).writes;
    for (let i = 0; i < 60; i++) { tiltTo(b, 0, 30); b.clock.advance(16); }
    assert.strictEqual(S(b).writes - w0, 0, 'a still device streams samples but writes nothing (gate r1 J4)');
    // J7: a pointerleave while the SENSOR drives does not ease the light home
    tiltTo(b, 0, 30 + 14); b.clock.advance(1000);
    const before = lx(b);
    assert.ok(before < -0.3, 'offset');
    const leave = new b.win.MouseEvent('pointerleave', { bubbles: false }); Object.defineProperty(leave, 'pointerType', { value: 'mouse' });
    P(b).dispatchEvent(leave); b.clock.advance(300); // frames run BEFORE the next sample
    assert.ok(Math.abs(lx(b) - before) < 0.05, `sensor-driven: the mouse leaving changes nothing (${before} -> ${lx(b)})`);
    tiltTo(b, 0, 30 + 14); b.clock.advance(300);
    assert.ok(Math.abs(lx(b) - before) < 0.05, 'and the next sample continues from there');
  } finally { b.restore(); }
  // J8: the pointer far outside the panel (a captured drag) clamps to the edge
  assert.deepStrictEqual(L.pointerLight(5000, -5000, { left: 0, top: 0, width: 100, height: 100 }), { x: 1, y: -1 });
  // J11: screen.orientation.angle 90 swaps the axes through the real listener
  const r = boot({ strength: 'pronounced' });
  try {
    Object.defineProperty(r.win, 'screen', { configurable: true, value: { orientation: { angle: 90 } } });
    r.engine.paint();
    tiltTo(r, 0, 3); r.clock.advance(50); tiltTo(r, 0, 30); r.clock.advance(500); // a gamma tilt...
    assert.ok(Math.abs(lx(r)) < 0.05 && ly(r) > 0.5, `...lands on --ly in landscape (lx ${lx(r)}, ly ${ly(r)})`);
  } finally { r.restore(); }
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
test('AC6 CSS lock: the ONE Click wheel and dome rule reads the light (unset = the old constants); the band and glass exist only when lit; no filter / blur / mask / backdrop anywhere in the lighting rules', () => {
  // v1.332 (the pocket design system): ONE wheel and ONE dome rule serve every colorway - the colorway
  // sets only its role tokens (the light origin --pk-c-wheel-oy / --pk-c-center-oy among them)
  for (const sel of ['.mms-ipod .ip-wheel']) {
    const r = rule(sel);
    assert.match(r, /at calc\(50% \+ var\(--lx,0\) \* 30%\) calc\(-8% \+ var\(--ly,0\) \* 26%\)/, sel + ': the sheen sits where the light is (unset = 50% -8%, the old constant)');
    assert.match(r, /circle at calc\(50% \+ var\(--lx,0\) \* 10%\) calc\(var\(--pk-c-wheel-oy\) \+ var\(--ly,0\) \* 10%\)/, sel + ': the base ramp follows');
  }
  assert.ok(!/\n {2}\.mms-ipod-[a-z]+[^{]*\.ip-(wheel|center)/.test(CSS), 'no colorway-specific wheel or dome rule exists');
  assert.match(rule('.mms-ipod .ip-wheel'), /box-shadow:var\(--mms-lit-wheel-shadow, var\(--mms-ipod-wheel-shadow\)\)/, 'the rim / recess / drop turn directional only when lit (the static token is the fallback)');
  assert.match(rule('.mms-ipod .ip-center'), /circle at calc\(50% \+ var\(--lx,0\) \* 16%\) calc\(var\(--pk-c-center-oy\) \+ var\(--ly,0\) \* 16%\)/);
  assert.match(rule('.mms-ipod .ip-center'), /box-shadow:var\(--mms-lit-dome-shadow, var\(--mms-ipod-center-shadow\)\)/);
  // the lit-only tokens: defined ONCE, on the lit panel; the band + glass are pseudo-elements gated by .mms-lit
  assert.strictEqual((CSS.match(/--mms-lit-wheel-shadow\s*:/g) || []).length, 2, 'the base profile and the strong override, nowhere else');
  assert.strictEqual((CSS.match(/--mms-lit-dome-shadow\s*:/g) || []).length, 2);
  const strong = rule('.mms-ipod.mms-lit-strong');
  assert.match(strong, /--mms-lit-wheel-shadow:calc\(var\(--lx,0\) \* -7px\)/, 'the strong drop is longer (7px) and softer (5px blur)');
  assert.match(strong, /inset calc\(var\(--lx,0\) \* -9px\) calc\(2px \+ var\(--ly,0\) \* -9px\) 12px -3px var\(--mms-lit-arc\)/, 'the lit rim arc: an inset crescent offset AWAY from the light (so it paints on the lit edge)');
  assert.match(strong, /inset calc\(var\(--lx,0\) \* 9px\) calc\(-2px \+ var\(--ly,0\) \* 9px\) 14px -4px var\(--mms-lit-darc\)/, 'the dark arc opposite');
  const litRoot = rule('.mms-ipod.mms-lit');
  assert.match(litRoot, /--mms-lit-wheel-shadow:calc\(var\(--lx,0\) \* -4px\) calc\(1px \+ var\(--ly,0\) \* -4px\) 2px var\(--mms-lit-drop\), inset calc\(var\(--lx,0\) \* -2px\) calc\(1px \+ var\(--ly,0\) \* -2px\) 1px var\(--mms-lit-rim\), inset calc\(var\(--lx,0\) \* 2px\) calc\(-2px \+ var\(--ly,0\) \* 2px\) 4px var\(--mms-lit-recess\)/, 'at --lx/--ly = 0 this is byte-identical to the static wheel shadow (0 1px 2px, inset 0 1px 1px, inset 0 -2px 4px); the inset rim takes the light NEGATED (a +x inset offset paints the LEFT edge), the recess as is');
  const band = rule('.mms-ipod.mms-lit::before');
  assert.match(band, /position:absolute; inset:-25%; z-index:-1;/, 'the band sits over the body ramp, under the LCD and wheel; 2.25x the panel, not more (gate r1 S3)');
  assert.match(band, /pointer-events:none/);
  assert.match(band, /transform:translate3d\(calc\(var\(--lx,0\) \* 12%\), calc\(var\(--ly,0\) \* 10%\), 0\)/, 'a transform on one gradient layer (compositor-only)');
  const glass = rule('.mms-ipod.mms-lit .ip-lcd-in::after');
  assert.match(glass, /pointer-events:none/, 'the glass streak never takes a tap');
  assert.match(glass, /var\(--mms-lit-glass\)/);
  assert.ok(!/\n {2}\.mms-ipod::before\{/.test(CSS) && !/\n {2}\.mms-ipod \.ip-lcd-in::after\{/.test(CSS), 'no band or glass layer exists when NOT lit');
  // the HARD constraint: nothing animated is a filter, blur, mask or backdrop - vendor + case + sibling
  // spellings (v1.313 lesson), over WHOLE RULES (gate r1 W4: a line filter let a filter on its own line
  // inside the band rule through): every rule whose selector names mms-lit or whose body reads --lx/--ly.
  const allRules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const litRuleList = allRules.filter((r) => /mms-lit/.test(r.sel) || /--l[xy]\b/.test(r.body));
  assert.ok(litRuleList.length >= 8, 'the lighting rules were found (' + litRuleList.length + ')');
  const litRules = litRuleList.map((r) => r.sel + '{' + r.body + '}').join('\n');
  assert.ok(!/(?:^|[^-\w])(?:-webkit-)?(?:filter|backdrop-filter|mask(?:-image)?)\s*:/i.test(litRules), 'no filter / backdrop / mask in any lighting rule: ' + litRules.match(/[^\n]*(?:filter|mask)[^\n]*/i));
  assert.ok(!/blur\(/i.test(litRules), 'no blur()');
  // v1.333: no blend mode and no animation on a lit layer either (a blend mode composites against
  // everything beneath it every frame - the same iPhone video-layer class), vendor + case spellings
  // (gate r1 adversary S3: the mask family's other members and box-reflect too)
  assert.ok(!/(?:^|[^-\w])(?:-webkit-)?(?:mask-box-image|mask-border|box-reflect)\s*:/i.test(litRules), 'no mask-border / mask-box-image / box-reflect in any lighting rule');
  assert.ok(!/(?:^|[^-\w])(?:-webkit-)?(?:mix-blend-mode|background-blend-mode|animation(?:-name)?)\s*:/i.test(litRules), 'no blend mode / animation in any lighting rule: ' + litRules.match(/[^\n]*(?:blend|animation)[^\n]*/i));
  // v1.333 AMBIENT (plan 2026-09-25-pocket-lighting-ambient; Dean's pick 4, the satin sheen): three rules,
  // all under .mms-lit-ambient, and nothing else names the class - the wheel, dome, glass and shadows stay
  // Pronounced's (the class rides on top of .mms-lit-strong)
  const ambSel = allRules.filter((r) => /mms-lit-ambient/.test(r.sel.replace(/\/\*[\s\S]*?\*\//g, ''))).map((r) => r.sel.replace(/\/\*[\s\S]*?\*\//g, '').trim()).sort();
  assert.deepStrictEqual(ambSel, ['.mms-ipod.mms-lit.mms-lit-ambient', '.mms-ipod.mms-lit.mms-lit-ambient::after', '.mms-ipod.mms-lit.mms-lit-ambient::before'], 'Ambient swaps only the body\'s reflection layers, and only on a LIT panel (gate r1 W1: keyed on .mms-lit too)');
  assert.match(rule('.mms-ipod.mms-lit.mms-lit-ambient'), /background:var\(--mms-lita-grain\) 0 0 \/ 32px 32px repeat, var\(--pk-c-body\);/, 'the grain: a static tile over the colorway\'s own body');
  const astreak = rule('.mms-ipod.mms-lit.mms-lit-ambient::before');
  assert.match(astreak, /transform:translate3d\(calc\(var\(--lx,0\) \* 20%\), calc\(var\(--ly,0\) \* 16%\), 0\) rotate\(22deg\);/, 'Pronounced\'s travel; the rotation is the band\'s own 112deg direction');
  assert.ok(!/var\(--l[xym]/.test(astreak.replace(/transform:[^;]*;/, '')), 'the streak itself never reads the light: its layer rasterises once and only moves');
  assert.match(astreak, /rgba\(var\(--pk-c-lita-glow\), \.\d+\)/); assert.match(astreak, /rgba\(var\(--pk-c-lita-core\), \.\d+\)/);
  assert.ok((astreak.match(/radial-gradient\(/g) || []).length >= 4, 'an uneven streak of several soft pieces, not one ruled line');
  assert.ok(!/linear-gradient|255,\s*255,\s*255/.test(astreak), 'no straight band and no pure white: the colorway tints it');
  const aroom = rule('.mms-ipod.mms-lit.mms-lit-ambient::after');
  assert.match(aroom, /content:""; position:absolute; inset:-35%; z-index:-1;/); assert.match(aroom, /pointer-events:none/);
  assert.match(aroom, /radial-gradient\(120% 80% at calc\(50% \+ var\(--lx,0\) \* 35%\) calc\(10% \+ var\(--ly,0\) \* 30%\), rgba\(var\(--pk-c-lita-glow\), /, 'Pronounced\'s room light geometry, tinted');
  assert.match(aroom, /transform:translate3d\(calc\(var\(--lx,0\) \* 20%\), calc\(var\(--ly,0\) \* 16%\), 0\);/, 'and its travel');
  assert.match(CSS, /\n {2}--mms-lita-grain:url\("data:image\/png;base64,[A-Za-z0-9+/=]+"\);/, 'the grain is ONE token (a data URI: no extra request, no service-worker list to join)');
  // the STRONG profile (the second swing): exists for the Click wheel and dome (one rule each), the band and the
  // glass; only under .mms-lit-strong; its layers travel inside their overhang
  for (const sel of ['.mms-ipod.mms-lit-strong .ip-wheel']) {
    const r = rule(sel);
    assert.match(r, /90% 55% at calc\(50% \+ var\(--lx,0\) \* 40%\) calc\(-8% \+ var\(--ly,0\) \* 30%\)/, sel + ': the sheen travels further');
    assert.match(r, /circle at calc\(50% \+ var\(--lx,0\) \* 14%\)/, sel + ': the base ramp follows further');
  }
  for (const sel of ['.mms-ipod.mms-lit-strong .ip-center']) assert.match(rule(sel), /var\(--mms-lit-far\)/, sel + ': the dark far side');
  const hot = rule('.mms-ipod.mms-lit-strong .ip-center::after');
  assert.match(hot, /pointer-events:none/); assert.match(hot, /opacity:calc\(1 - var\(--lm,0\) \* \.45\)/, 'the hot spot dims as the light moves off-centre');
  const sband = rule('.mms-ipod.mms-lit-strong::before');
  assert.match(sband, /inset:-35%;/, 'the strong band layer: 1.7x'); assert.match(sband, /translate3d\(calc\(var\(--lx,0\) \* 20%\), calc\(var\(--ly,0\) \* 16%\), 0\)/);
  // (the strong band: 20% x 1.7 = 34% < 35% overhang; 16% x 1.7 = 27%: never exposed)
  const sglass = rule('.mms-ipod.mms-lit-strong .ip-lcd-in::after');
  assert.match(sglass, /inset:0 -70%;/); assert.match(sglass, /translate3d\(calc\(var\(--lx,0\) \* 25%\), 0, 0\)/);
  // (the strong glass: 25% x 2.4 = 60% < 70% overhang: never exposed)
  assert.strictEqual((CSS.match(/\.mms-lit-strong/g) || []).length >= 6, true, 'the strong profile is a class the driver adds (pronounced only)');
  // Matte is softer, Black dimmer than Click (G1): the band roles in each colorway's block
  const alpha = (name) => Number((CSS.match(new RegExp(name + ':rgba\\(255,255,255,(\\.\\d+)\\)')) || [])[1]);
  const blockBand = (cls) => Number((/--pk-c-lit-band:rgba\(255,255,255,(\.\d+)\)/.exec((new RegExp('\\n {2}\\.' + cls + '\\{([^}]*)\\}').exec(CSS) || [])[1] || '') || [])[1]);
  assert.ok(alpha('--mms-lit-band') > blockBand('mms-ipod-black') && blockBand('mms-ipod-black') > blockBand('mms-ipod-matte'), 'Click > Black > Matte band strength');
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
