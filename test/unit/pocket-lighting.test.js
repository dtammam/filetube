'use strict';

// [UNIT] POCKET LIGHTING (Dean 2026-09-24; the reflection swing 2026-09-25, plan
// 2026-09-25-pocket-lighting-reflection). The pure half (public/js/pocket-lighting.js: the tilt mapping,
// the reflected angle against a gravity-referenced key pose, the key glide, the per-surface geometry,
// the strength setting) and the driver, driven through the REAL engine (skin-surface.js
// create()/paint()/click) with REAL event shapes: a `deviceorientation` event on the window carrying
// beta/gamma, a `pointermove` with pointerType, the dock (innerHTML cleared with NO destroy), a hidden
// document, a skin switch, the tray, reduced motion, destroy. Every arm is asserted by LISTENER COUNT and
// rAF presence, never by prose. Plus the CSS lock (the environment map per material; no filter / blur /
// mask / backdrop / blend mode / CSS trig in any lighting rule) and the dynamic shell parity.

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
const RAD = Math.PI / 180;
// beta/gamma that land on a given SCREEN pose (x = the projected roll, y = the pitch), portrait: the
// driver's roll is asin(Gx) and its pitch atan2(Gy, Gz) of the up-vector G = (cos b sin g, sin b, cos b cos g),
// so G = (sin x, cos x sin y, cos x cos y) and beta = asin(Gy), gamma = atan2(Gx, Gz)
const bgFor = (x, y) => [Math.asin(Math.cos(x * RAD) * Math.sin(y * RAD)) / RAD, Math.atan2(Math.sin(x * RAD), Math.cos(x * RAD) * Math.cos(y * RAD)) / RAD];

// ---------------------------------------------------------------- the pure half
test('mapTilt: device axes to screen axes by the screen rotation; the roll is gravity-projected and the pitch an atan2 (no gimbal flip upright); a null component is no sample', () => {
  const near = (a, b, m) => assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, m + ` got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
  near(L.mapTilt(0, 5, 0), { x: 5, y: 0 }, 'flat (beta 0): x = gamma (left/right), y = beta (front/back)');
  near(L.mapTilt(0, 5, 90), { x: 0, y: -5 }, 'landscape 90');
  near(L.mapTilt(0, 5, 180), { x: -5, y: 0 }, 'upside down');
  near(L.mapTilt(0, 5, 270), { x: 0, y: 5 }, 'landscape 270');
  near(L.mapTilt(0, 5, -90), { x: 0, y: 5 }, 'the legacy window.orientation -90 is 270');
  const r40 = L.mapTilt(40, 30, 0).x, r80 = L.mapTilt(80, 30, 0).x, r90 = L.mapTilt(90, 30, 0).x, r100 = L.mapTilt(100, -30, 0).x;
  assert.ok(r40 > 20 && r40 < 30 && r80 > 0 && r80 < r40 && Math.abs(r90) < 1e-9, `the same physical roll reads smaller the more upright the phone (${r40}, ${r80}, ${r90})`);
  assert.ok(r100 > 0 && r100 < 10, `past vertical gamma flips sign (W3C) but the projected roll keeps its sign (${r100})`);
  assert.ok(Math.abs(L.mapTilt(40, 0, 0).y - 40) < 1e-9, 'flat-rolled: the pitch is beta');
  const [b6, g6] = bgFor(-10, 64);
  const m = L.mapTilt(b6, g6, 0);
  assert.ok(Math.abs(m.x + 10) < 0.05 && Math.abs(m.y - 64) < 0.05, `the test's pose helper round-trips through mapTilt (${m.x}, ${m.y})`);
  assert.strictEqual(L.mapTilt(null, 5, 0), null, 'desktop Chrome fires the event with nulls: no sample');
  assert.strictEqual(L.mapTilt(1, undefined, 0), null);
});

test('the reflected angle: twice the tilt away from the KEY pose; a 6 deg tilt moves the flat reflection half the face (12 k px); the dome about 15x slower; the dome image fades off the rim; the pitch difference takes the short way round', () => {
  assert.deepStrictEqual({ x: L.KEY_X, y: L.KEY_Y }, { x: -3, y: 58 }, 'the key pose: the research\'s pitch, x a touch off-axis (at -10 a straight hold showed no window - gate r1 qa W2)');
  // at a straight hold (roll 0) the window's near pane still overlaps the face: |ex| k minus the window's
  // half-width (5.6 deg k) is inside the half-face (195 px at 390 wide)
  assert.ok((Math.abs(L.reflected(L.newFilter(), 0, L.KEY_Y).ex) - 5.6) * (844 / L.FACE_DEG) < 195, 'at a straight hold (roll 0) the window is still on the face');
  const st = L.newFilter();
  assert.deepStrictEqual(L.reflected(st, L.KEY_X, L.KEY_Y), { ex: 0, ey: 0 }, 'at the key pose the map sits centred');
  const r = L.reflected(st, L.KEY_X, L.KEY_Y + 6);
  assert.deepStrictEqual(r, { ex: 0, ey: 12 }, 'a mirror turns a reflection by twice the tilt');
  const k = 844 / L.FACE_DEG, R = 54;
  const s = L.surfaces(0, 12, k, R);
  assert.ok(Math.abs(s.fy - 12 * k) < 1e-9 && Math.abs(s.fy - 422) < 1, `the flat face moves 12 k px = half the face (${s.fy})`);
  assert.ok(Math.abs(s.dy - R * 12 / 30) < 1e-9, 'the dome: R x e / (2 beta), beta = 15 deg');
  const ratio = s.fy / s.dy;
  assert.ok(ratio > 12 && ratio < 22, `the dome moves about 15x slower than the flat face (${ratio.toFixed(1)}x)`);
  assert.strictEqual(L.surfaces(0, 28, k, R).dom, 1, 'the dome image is full up to 28 deg');
  assert.strictEqual(L.surfaces(0, 34, k, R).dom, 0, '...and gone past 34 deg (off the rim)');
  assert.ok(Math.abs(L.surfaces(0, 60, k, R).dy - R * 1.3) < 1e-9, 'the dome offset clamps at 1.3 R');
  assert.ok(Math.abs(L.surfaces(10, 10, k, R).la - 45) < 1e-9 && L.surfaces(0, 0, k, R).la === 0, 'the light azimuth for the lip ring');
  assert.ok(Math.abs(L.surfaces(0, 17, k, R).wt - 0.5) < 1e-9, 'the wheel tone fades to 0 at 34 deg');
  assert.deepStrictEqual([L.surfaces(24, 0, k, R).lx, L.surfaces(-6, 0, k, R).lx], [1, -0.5], '--lx: the reflected angle over 12 deg, clamped');
  // the seam (lying on your back, phone overhead): the pitch difference never jumps 360 deg
  const w = L.newFilter(); w.ky = 179;
  assert.ok(Math.abs(L.reflected(w, 0, -179.5).ey - 3) < 1e-9, 'the short way round');
  assert.strictEqual(L.wrapDiff(-179, 179), 2); assert.strictEqual(L.wrapDiff(179, -179), -2); assert.strictEqual(L.wrapDiff(10, 4), 6);
});

test('the key glide - the ONLY re-centre: a held tilt stays lit; a pose over 35 deg off for over 2 s glides the key to it with tau 1.5 s', () => {
  const st = L.newFilter();
  let now = 0;
  for (let i = 0; i < 600; i++) { now += 16; assert.strictEqual(L.glideKey(st, L.KEY_Y + 20, 16, now), false); }
  assert.strictEqual(st.ky, L.KEY_Y, 'a 20 deg tilt held for 10 s: the key never moves (the reflection stays where it is)');
  const far = L.newFilter(); now = 0;
  for (let i = 0; i < 120; i++) { now += 16; L.glideKey(far, L.KEY_Y + 50, 16, now); }
  assert.strictEqual(far.ky, L.KEY_Y, 'within the first 2 s nothing glides');
  for (let i = 0; i < 60 * 8; i++) { now += 16; L.glideKey(far, L.KEY_Y + 50, 16, now); }
  assert.ok(Math.abs(far.ky - (L.KEY_Y + 50)) < 1, `after ~8 s the key sits on the held pose (${far.ky})`);
  assert.strictEqual(far.gliding, false, 'and the glide has ended');
  assert.ok(Math.abs(L.reflected(far, L.KEY_X, L.KEY_Y + 50).ey) < 2, 'so the reflection is centred again');
  assert.strictEqual(far.ky, L.KEY_Y + 50, 'the glide ends ON the pose (the last half degree snaps)');
  const back = L.newFilter(); back.ky = L.KEY_Y + 50; now = 0;
  for (let i = 0; i < 60; i++) { now += 16; L.glideKey(back, L.KEY_Y + 50 + 10, 16, now); }
  assert.strictEqual(back.offSince, -1, 'near the (glided) key: not counting');
  // the 2 s count is per excursion, never cumulative (gate r1 adversary W3): two 1.5 s excursions with a
  // near-key sample between them never glide
  const ex = L.newFilter(); now = 0;
  for (let i = 0; i < 94; i++) { now += 16; L.glideKey(ex, L.KEY_Y + 50, 16, now); }
  now += 16; L.glideKey(ex, L.KEY_Y, 16, now);
  for (let i = 0; i < 94; i++) { now += 16; L.glideKey(ex, L.KEY_Y + 50, 16, now); }
  assert.strictEqual(ex.ky, L.KEY_Y, 'two brief excursions do not add up to a glide');
  // the glide's time constant: one tau after it starts, about 63% of the gap is closed
  const tau = L.newFilter(); now = 0;
  for (let i = 0; i < 126; i++) { now += 16; L.glideKey(tau, L.KEY_Y + 50, 16, now); }
  for (let i = 0; i < Math.round(L.GLIDE_TAU_MS / 16); i++) { now += 16; L.glideKey(tau, L.KEY_Y + 50, 16, now); }
  const closed = (tau.ky - L.KEY_Y) / 50;
  assert.ok(closed > 0.55 && closed < 0.72, `one tau (${L.GLIDE_TAU_MS} ms) closes ~63% of the gap (${closed.toFixed(2)})`);
});

test('strength: device-local, default Off, garbage normalizes to Off; GAIN is the alpha factor (Subtle .6); music-skins and the driver agree on the three values', () => {
  const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  assert.strictEqual(L.readStrength(ls), 'off');
  assert.strictEqual(L.setStrength('pronounced', ls), 'pronounced');
  assert.strictEqual(L.readStrength(ls), 'pronounced');
  assert.strictEqual(L.setStrength('loud', ls), 'off');
  assert.deepStrictEqual(L.STRENGTHS, skins.LIGHTING_STRENGTHS.map((r) => r.value), 'one list of strengths, two modules: a census');
  assert.deepStrictEqual(L.GAIN, { off: 0, subtle: 0.6, pronounced: 1 }, 'the research: Subtle = 0.6 x alpha');
  const rows = skins.menuLightingItems({ strength: 'subtle', note: '' });
  assert.deepStrictEqual(rows.map((r) => [r.label, r.action, r.value, r.check]), [['Off', 'lighting', 'off', false], ['Subtle', 'lighting', 'subtle', true], ['Pronounced', 'lighting', 'pronounced', false]]);
  assert.deepStrictEqual(skins.menuLightingItems(null).map((r) => r.check), [true, false, false], 'no driver state: Off is checked');
  const noted = skins.menuLightingItems({ strength: 'pronounced', note: L.NOTE_DENIED });
  assert.strictEqual(noted.length, 4);
  assert.deepStrictEqual(noted[3], { label: L.NOTE_DENIED, note: true, info: true }, 'a read-only note row');
  assert.deepStrictEqual(skins.menuStaticItems({ type: 'settings' }, { hasLighting: true }).map((r) => r.label), ['Lighting', 'About']);
  assert.deepStrictEqual(skins.menuStaticItems({ type: 'settings' }, {}).map((r) => r.label), ['About'], 'no driver: no row that leads nowhere');
  assert.deepStrictEqual(skins.menuStaticItems({ type: 'settings' }, { hasLighting: false, style: 'seattle' }).map((r) => r.label), ['About'], 'Seattle: the engine passes hasLighting false (Dean\'s ruling)');
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
// a SCREEN pose (x = the projected roll, y = the pitch) through the real event
const pose = (b, x, y) => { const [beta, gamma] = bgFor(x, y); tiltTo(b, beta, gamma); };
const atKey = (b) => pose(b, L.KEY_X, L.KEY_Y);
function mouseAt(b, x, y, type = 'mouse') {
  const e = new b.win.MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerType', { value: type });
  P(b).dispatchEvent(e);
}
const px = (b, name) => Number(String(P(b).style.getPropertyValue(name)).replace('px', ''));
const prop = (b, name) => P(b).style.getPropertyValue(name);
const lit = (b) => P(b).classList.contains('mms-lit');
const strong = (b) => P(b).classList.contains('mms-lit-strong');
const S = (b) => b.engine.lightingState();
const listening = (b) => ({ orient: b.count('win:deviceorientation'), move: b.count('panel:pointermove'), leave: b.count('panel:pointerleave') });
const vis = (b) => b.count('doc:visibilitychange');
const K = 844 / L.FACE_DEG; // jsdom has no layout: the driver's default panel height (844 px)

test('AC1/AC2 reachability + geometry: a REAL deviceorientation event at the key pose centres the map; a 6 deg pitch tilt writes --fy = 12 k px; the dome moves ~15x slower; --dom / --la / --wt / --lx follow; a held tilt never drifts; Pronounced adds the strong class, Subtle only scales --lk', () => {
  const b = boot({ strength: 'pronounced' });
  try {
    b.engine.paint();
    assert.ok(lit(b) && strong(b) && S(b).listening, 'a painted Click skin with Pronounced is lit, strong and listening');
    assert.deepStrictEqual(listening(b), { orient: 1, move: 1, leave: 1 }, 'exactly one listener each');
    assert.strictEqual(vis(b), 2, 'the engine\'s visibilitychange + the driver\'s');
    assert.strictEqual(prop(b, '--lk'), '1', 'Pronounced: the alpha factor 1');
    assert.ok(Math.abs(px(b, '--k') - K) < 0.1, `--k = the panel height / 24 (${prop(b, '--k')})`);
    atKey(b); b.clock.advance(400);
    assert.ok(Math.abs(px(b, '--fx')) < 1 && Math.abs(px(b, '--fy')) < 1, `at the key pose the map is centred (${prop(b, '--fx')}, ${prop(b, '--fy')})`);
    assert.strictEqual(prop(b, '--dom'), '1.000', 'the dome image full');
    pose(b, L.KEY_X, L.KEY_Y + 6); b.clock.advance(600);
    assert.ok(Math.abs(px(b, '--fy') - 12 * K) < 3, `a 6 deg tilt: the flat reflection moves 12 k px = half the face (${prop(b, '--fy')} vs ${(12 * K).toFixed(1)})`);
    assert.ok(Math.abs(px(b, '--fx')) < 2, 'no roll: --fx stays ~0');
    const dy = px(b, '--dy');
    assert.ok(dy > 0 && px(b, '--fy') / dy > 12 && px(b, '--fy') / dy < 22, `the dome moves ~15x slower (${(px(b, '--fy') / dy).toFixed(1)}x)`);
    assert.ok(Math.abs(Number(prop(b, '--la')) - 90) < 1, 'the light azimuth: straight down (+y)');
    assert.ok(Number(prop(b, '--wt')) > 0.6 && Number(prop(b, '--wt')) < 0.7, `the wheel tone at 12 deg (${prop(b, '--wt')})`);
    assert.ok(Math.abs(Number(prop(b, '--ly')) - 1) < 0.02 && Math.abs(Number(prop(b, '--lx'))) < 0.02, '--ly clamps at 12 deg');
    pose(b, L.KEY_X + 6, L.KEY_Y); b.clock.advance(600);
    assert.ok(Math.abs(px(b, '--fx') - 12 * K) < 3 && Math.abs(px(b, '--fy')) < 2, `a 6 deg roll moves --fx by 12 k (${prop(b, '--fx')})`);
    pose(b, L.KEY_X, L.KEY_Y + 20); b.clock.advance(100);
    assert.ok(S(b).raf, 'the loop is live while samples stream');
    b.clock.advance(700);
    assert.strictEqual(prop(b, '--dom'), '0.000', 'a 40 deg reflected angle: the dome image is off the rim');
    assert.ok(px(b, '--fy') > 35 * K, 'the flat reflection is well past the face');
    const held = px(b, '--fy');
    for (let i = 0; i < 400; i++) { pose(b, L.KEY_X, L.KEY_Y + 20); b.clock.advance(16); }
    assert.ok(Math.abs(px(b, '--fy') - held) < 1, `held for 6 s: the reflection has not drifted (${held} -> ${prop(b, '--fy')})`);
    assert.deepStrictEqual(S(b).key, { x: L.KEY_X, y: L.KEY_Y }, 'the key never moved');
    b.clock.advance(2000);
    assert.strictEqual(S(b).raf, false, 'settled and no new sample: parked');
    const w0 = S(b).writes; b.clock.advance(2000);
    assert.strictEqual(S(b).writes, w0, 'no writes while parked');
    b.ls.setItem(L.KEY, 'subtle'); b.engine.paint();
    assert.ok(lit(b) && !strong(b), 'Subtle: lit, never strong');
    assert.strictEqual(prop(b, '--lk'), '0.6');
    pose(b, L.KEY_X, L.KEY_Y + 6); b.clock.advance(600);
    assert.ok(Math.abs(px(b, '--fy') - 12 * K) < 3, 'Subtle moves exactly as far (alpha, not travel, is what differs)');
  } finally { b.restore(); }
});

test('gate r1 qa W3 + W1: the FIRST sample of a start snaps the reflection into place (no sweep across the face at an unlock); a resize re-measures the geometry', () => {
  const b = boot({ strength: 'pronounced' });
  try {
    b.engine.paint();
    pose(b, L.KEY_X + 6, L.KEY_Y); // the first sample, far from the key
    assert.ok(Math.abs(px(b, '--fx') - 12 * K) < 1, `snapped to the pose on the first sample, before any frame (${prop(b, '--fx')})`);
    b.clock.advance(16);
    assert.ok(Math.abs(px(b, '--fx') - 12 * K) < 1, 'and the first frame does not ease it back');
    // a resize: the geometry is re-measured (the panel reports a new height) and the map re-written
    P(b).getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 600 });
    P(b).querySelector('.ip-lcd-in').getBoundingClientRect = () => ({ left: 20, top: 30, width: 350, height: 240 });
    P(b).querySelector('.ip-center').getBoundingClientRect = () => ({ left: 145, top: 400, width: 100, height: 100 });
    b.win.dispatchEvent(new b.win.Event('resize'));
    assert.ok(Math.abs(px(b, '--k') - 600 / L.FACE_DEG) < 0.1, `--k follows the new height (${prop(b, '--k')})`);
    assert.ok(Math.abs(px(b, '--fx') - 12 * (600 / L.FACE_DEG)) < 1, 'the map is re-written at the new scale');
    // the seam (gate r1 adversary W1): the glass map is offset by the panel centre MINUS the LCD centre
    assert.strictEqual(prop(b, '--lcx'), '0.0px', 'LCD centred horizontally: --lcx 0');
    assert.strictEqual(prop(b, '--lcy'), '150.0px', 'panel centre 300, LCD centre 150: --lcy = +150 (the sign that keeps the panes collinear)');
    assert.strictEqual(prop(b, '--dr'), '50.0px', 'the dome radius');
    b.engine.destroy();
    assert.strictEqual(b.count('win:resize'), 0, 'the resize listener goes with the rest');
  } finally { b.restore(); }
});

test('AC1 desktop: a MOUSE pointermove over the panel drives the reflection (+-12 deg at the edges) when no sensor sample is live; a touch never does; leaving eases home', () => {
  const b = boot({ strength: 'pronounced' });
  try {
    b.engine.paint();
    P(b).getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 800 });
    mouseAt(b, 100, 400, 'touch');
    b.clock.advance(300);
    assert.ok(Math.abs(px(b, '--fx')) < 0.5, 'a finger never moves the light (the map stays centred at the key)');
    mouseAt(b, 100, 400, 'mouse');
    b.clock.advance(1000);
    assert.ok(Math.abs(px(b, '--fx') + 6 * K) < 3, `the pointer IS the light (got ${prop(b, '--fx')} want ${(-6 * K).toFixed(1)})`);
    const leave = new b.win.MouseEvent('pointerleave', { bubbles: false });
    Object.defineProperty(leave, 'pointerType', { value: 'mouse' });
    P(b).dispatchEvent(leave);
    b.clock.advance(3000);
    assert.ok(Math.abs(px(b, '--fx')) < 1, 'eases back to the key after the pointer leaves');
    pose(b, L.KEY_X + 6, L.KEY_Y); b.clock.advance(500);
    assert.ok(px(b, '--fx') > 10 * K, 'the sensor drives');
    mouseAt(b, 380, 400, 'mouse'); b.clock.advance(500);
    assert.ok(px(b, '--fx') > 10 * K, `a mouse move while the sensor is fresh is ignored (got ${prop(b, '--fx')})`);
  } finally { b.restore(); }
});

test('AC4 both axes on a POPULATED panel: Off clears every property, both classes and every listener; Subtle then Pronounced binds ONE listener, never two', async () => {
  const b = boot({ strength: 'pronounced' });
  try {
    b.engine.paint();
    pose(b, L.KEY_X + 6, L.KEY_Y); b.clock.advance(500);
    assert.ok(px(b, '--fx') > 10 * K && lit(b) && strong(b), 'populated AND lit before the clear axis is driven');
    pressMenu(b); tapLabel(b, 'Settings');
    assert.deepStrictEqual(lbls(b), ['Lighting', 'About']);
    tapLabel(b, 'Lighting');
    assert.deepStrictEqual(lbls(b), ['Off', 'Subtle', 'Pronounced']);
    tapLabel(b, 'Off'); await flush();
    assert.strictEqual(P(b).querySelector('.ipm-row.is-checked .ipm-lbl').textContent, 'Off', 'the check moved');
    for (const name of ['--fx', '--fy', '--dx', '--dy', '--dom', '--la', '--wt', '--lx', '--ly', '--k', '--dr', '--lcx', '--lcy', '--lk']) assert.strictEqual(prop(b, name), '', name + ' cleared');
    assert.ok(!lit(b) && !strong(b), 'both lit classes dropped');
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'every listener unbound');
    assert.strictEqual(vis(b), 2, 'the driver keeps its visibilitychange (it re-lights on a return), the engine its own');
    assert.strictEqual(S(b).raf, false, 'Off cancelled its rAF');
    assert.strictEqual(b.ls.getItem(L.KEY), 'off', 'stored');
    tapLabel(b, 'Subtle'); await flush();
    tapLabel(b, 'Pronounced'); await flush();
    assert.deepStrictEqual(listening(b), { orient: 1, move: 1, leave: 1 }, 'two picks: still exactly one listener each');
    assert.strictEqual(vis(b), 2);
    assert.ok(lit(b) && strong(b));
    pose(b, L.KEY_X + 6, L.KEY_Y); b.clock.advance(500);
    assert.ok(px(b, '--fx') > 10 * K, 'lit again through the real path');
  } finally { b.restore(); }
});

test('AC4 every teardown arm unbinds: the dock (no destroy), a hidden document (the RETURN re-lights with no paint), a repaint as Cider, Seattle (no row, never lit), the tray, destroy (terminal) - measured over repeated mounts', async () => {
  const b = boot({ strength: 'pronounced' });
  try {
    const zero = { orient: 0, move: 0, leave: 0 };
    const one = { orient: 1, move: 1, leave: 1 };
    const light = () => { b.engine.paint(); pose(b, L.KEY_X + 6, L.KEY_Y); b.clock.advance(300); assert.deepStrictEqual(listening(b), one); assert.ok(lit(b) && px(b, '--fx') > 5 * K); };
    for (let n = 0; n < 3; n++) {
      light();
      P(b).hidden = true; P(b).innerHTML = '';
      b.clock.advance(40);
      assert.deepStrictEqual(listening(b), zero, `dock #${n}: unbound within a frame`);
      assert.strictEqual(vis(b), 2, 'the standing visibility listeners stay');
      assert.strictEqual(S(b).raf, false);
      assert.strictEqual(b.clock.live(), 0, 'nothing pending');
      P(b).hidden = false;
      light();
      Object.defineProperty(b.doc, 'hidden', { configurable: true, value: true });
      b.doc.dispatchEvent(new b.win.Event('visibilitychange'));
      assert.deepStrictEqual(listening(b), zero, `hidden #${n}: unbound on visibilitychange`);
      Object.defineProperty(b.doc, 'hidden', { configurable: true, value: false });
      b.doc.dispatchEvent(new b.win.Event('visibilitychange'));
      assert.deepStrictEqual(listening(b), one, `return #${n}: re-bound by the visibility listener alone, NO paint (an iPhone unlock)`);
      assert.ok(lit(b));
      pose(b, L.KEY_X + 6, L.KEY_Y); b.clock.advance(300);
      assert.ok(px(b, '--fx') > 5 * K, 'and it moves again after the return');
      b.state.skin = 'apple'; b.engine.paint();
      assert.deepStrictEqual(listening(b), zero, `Cider #${n}: no lighting`);
      assert.ok(!lit(b));
      b.state.skin = 'zune-classic'; b.engine.paint();
      assert.deepStrictEqual(listening(b), zero, `Seattle #${n}: out of scope (Dean), never lit`);
      assert.ok(!lit(b) && prop(b, '--fx') === '');
      pressMenu(b); tapLabel(b, 'Settings');
      assert.deepStrictEqual(lbls(b), ['About'], `Seattle #${n}: Settings shows no Lighting row`);
      pressMenu(b); pressMenu(b);
      b.state.skin = 'ipod-matte';
      b.doc.body.classList.add('mms-tray'); b.engine.paint();
      assert.deepStrictEqual(listening(b), zero, `tray #${n}: no lighting`);
      b.doc.body.classList.remove('mms-tray');
    }
    light();
    b.engine.destroy();
    assert.deepStrictEqual(listening(b), zero, 'destroy');
    assert.strictEqual(vis(b), 0, 'destroy: engine and driver both unbound');
    assert.strictEqual(S(b).raf, false);
    assert.strictEqual(prop(b, '--fx'), '');
    b.doc.dispatchEvent(new b.win.Event('visibilitychange'));
    assert.deepStrictEqual(listening(b), zero, 'a visibility flip after destroy re-binds nothing');
  } finally { b.restore(); }
});

test('AC4 the PARKED dock: with no sample in flight the frame loop is parked, so the release is STRUCTURAL - the panel emptying or hiding unbinds within a microtask', async () => {
  const b = boot({ strength: 'pronounced' });
  try {
    b.engine.paint();
    assert.deepStrictEqual(listening(b), { orient: 1, move: 1, leave: 1 });
    assert.strictEqual(S(b).raf, false, 'no sample yet: parked (no rAF to notice a dock)');
    P(b).hidden = true; P(b).innerHTML = '';
    await flush();
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'the observer released it');
    P(b).hidden = false; b.engine.paint();
    assert.deepStrictEqual(listening(b), { orient: 1, move: 1, leave: 1 }, 'a repaint re-binds');
    P(b).hidden = true;
    await flush();
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'hidden alone releases too');
  } finally { b.restore(); }
});

test('AC4 reduced motion: nothing binds, nothing is written; the Lighting level says why', async () => {
  const b = boot({ strength: 'pronounced', reduced: true });
  try {
    b.engine.paint();
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 });
    assert.strictEqual(vis(b), 2, 'the driver\'s standing visibility listener + the engine\'s; nothing else');
    assert.ok(!lit(b));
    pose(b, L.KEY_X + 6, L.KEY_Y); b.clock.advance(500);
    assert.strictEqual(prop(b, '--fx'), '');
    pressMenu(b); tapLabel(b, 'Settings'); tapLabel(b, 'Lighting'); tapLabel(b, 'Subtle'); await flush();
    assert.ok(lbls(b).includes(L.NOTE_REDUCED), 'the note row');
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'a pick under reduced motion binds nothing');
  } finally { b.restore(); }
});

test('AC4 iOS permission: asked ONCE from the tap; a deny on a device with no mouse = not lit, nothing bound, the note (kept strength); the wheel never parks on the note row; granted binds; a relaunch waits for the first sample; a late answer after destroy re-binds nothing', async () => {
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
    assert.strictEqual(b.ls.getItem(L.KEY), 'pronounced', 'the pick is kept (Dean: keep the strength + a note)');
    assert.strictEqual(P(b).querySelector('.ipm-row.is-checked .ipm-lbl').textContent, 'Pronounced');
    slowSpin(b, 4, 1);
    assert.strictEqual(b.engine.menuState().cursor, 2, 'clamped to the last option (Pronounced), not the note');
    slowSpin(b, 1, -1);
    assert.strictEqual(P(b).querySelector('.ipm-row.is-cursor .ipm-lbl').textContent, 'Subtle', 'the wheel still moves among the options');
    assert.ok(!lit(b), 'not lit after a deny');
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 }, 'nothing bound after a deny');
    pose(b, L.KEY_X + 6, L.KEY_Y); b.clock.advance(500);
    assert.strictEqual(prop(b, '--fx'), '', 'no offset ever written after a deny');
    tapLabel(b, 'Off'); await flush();
    assert.ok(!lbls(b).includes(L.NOTE_DENIED), 'a re-pick clears the stale note');
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 });
  } finally { b.restore(); }
  let asks2 = 0;
  const g = boot({ strength: 'off', permission: () => { asks2 += 1; return Promise.resolve('granted'); } });
  try {
    g.engine.paint();
    pressMenu(g); tapLabel(g, 'Settings'); tapLabel(g, 'Lighting'); tapLabel(g, 'Subtle');
    await flush(); await flush();
    assert.strictEqual(asks2, 1);
    assert.ok(!lbls(g).includes(L.NOTE_DENIED) && lit(g) && !strong(g), 'granted: lit (Subtle, not strong), no note');
    assert.deepStrictEqual(listening(g), { orient: 1, move: 1, leave: 1 });
    pose(g, L.KEY_X + 6, L.KEY_Y); g.clock.advance(500);
    assert.ok(px(g, '--fx') > 10 * K, 'Subtle after a grant moves the full distance');
  } finally { g.restore(); }
  const n = boot({ strength: 'off', finePointer: false });
  try {
    n.engine.paint(); pressMenu(n); tapLabel(n, 'Settings'); tapLabel(n, 'Lighting'); tapLabel(n, 'Pronounced'); await flush();
    assert.ok(!lbls(n).includes(L.NOTE_NO_SENSOR), 'not yet: a sensor may still stream');
    n.clock.advance(L.SENSOR_WAIT_MS + 10); await flush(); await flush();
    assert.ok(lbls(n).includes(L.NOTE_NO_SENSOR), 'a coarse pointer and no sample within the wait: says so');
    assert.deepStrictEqual(listening(n), { orient: 1, move: 1, leave: 1 }, 'still bound: a sensor that appears later streams');
  } finally { n.restore(); }
  const f = boot({ strength: 'off', finePointer: true });
  try {
    f.engine.paint(); pressMenu(f); tapLabel(f, 'Settings'); tapLabel(f, 'Lighting'); tapLabel(f, 'Pronounced'); await flush();
    f.clock.advance(L.SENSOR_WAIT_MS + 10); await flush(); await flush();
    assert.ok(!lbls(f).includes(L.NOTE_NO_SENSOR), 'no note on a desktop');
  } finally { f.restore(); }
  const rl = boot({ strength: 'pronounced', finePointer: false, permission: () => Promise.resolve('granted') });
  try {
    rl.engine.paint();
    assert.deepStrictEqual(listening(rl), { orient: 1, move: 1, leave: 1 }, 'bound (a remembered grant streams at once on iOS)');
    assert.ok(!lit(rl) && !strong(rl), 'NOT lit before a sample');
    rl.clock.advance(5000);
    assert.ok(!lit(rl) && Math.abs(px(rl, '--fx')) < 0.5, 'still today\'s look: nothing streamed (no lit class = no layers; the centred properties are inert)');
    atKey(rl);
    assert.ok(lit(rl) && strong(rl), 'lit (and strong: pronounced) the moment the sensor streams');
    P(rl).hidden = true; P(rl).innerHTML = ''; await flush(); P(rl).hidden = false; rl.engine.paint();
    assert.ok(!lit(rl), 'a fresh start waits for its own first sample');
  } finally { rl.restore(); }
  const dk = boot({ strength: 'pronounced', finePointer: true, permission: () => Promise.resolve('granted') });
  try { dk.engine.paint(); assert.ok(lit(dk), 'a fine pointer drives: lit at once'); } finally { dk.restore(); }
  const an = boot({ strength: 'pronounced', finePointer: false });
  try { an.engine.paint(); assert.ok(lit(an), 'no permission API: lit at once'); } finally { an.restore(); }
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

test('the pop-out surface (another document): the driver listens on THAT window and panel, and dies with the pop-out engine', () => {
  const b = boot({ strength: 'pronounced', otherDoc: true, menu: true });
  try {
    b.engine.paint();
    assert.deepStrictEqual(listening(b), { orient: 1, move: 1, leave: 1 }, 'bound on the pop-out window/document');
    pose(b, L.KEY_X + 6, L.KEY_Y); b.clock.advance(400);
    assert.ok(px(b, '--fx') > 5 * K);
    b.engine.destroy();
    assert.deepStrictEqual(listening(b), { orient: 0, move: 0, leave: 0 });
    assert.strictEqual(vis(b), 0, 'destroy drops the driver\'s standing visibility listener with the engine\'s');
  } finally { b.restore(); }
});

test('hardening: the observer never leaks; a still device at its pose writes nothing; a pointerleave never eases a SENSOR-driven light; the seam holds through the engine; landscape maps the axes; pointerLight clamps', async () => {
  const b = boot({ strength: 'pronounced' });
  try {
    let observing = 0;
    const MO = b.win.MutationObserver;
    b.win.MutationObserver = class extends MO { observe(...a) { observing += 1; return super.observe(...a); } disconnect() { observing -= 1; return super.disconnect(); } };
    for (let i = 0; i < 4; i++) { b.engine.paint(); assert.strictEqual(observing, 1, 'one observer while lit'); P(b).hidden = true; P(b).innerHTML = ''; await flush(); assert.strictEqual(observing, 0, 'none after the dock'); P(b).hidden = false; }
    b.engine.paint();
    pose(b, L.KEY_X + 6, L.KEY_Y); b.clock.advance(1000);
    const w0 = S(b).writes;
    for (let i = 0; i < 60; i++) { pose(b, L.KEY_X + 6, L.KEY_Y); b.clock.advance(16); }
    assert.strictEqual(S(b).writes - w0, 0, 'a still device streams samples but writes nothing');
    const before = px(b, '--fx');
    const leave = new b.win.MouseEvent('pointerleave', { bubbles: false }); Object.defineProperty(leave, 'pointerType', { value: 'mouse' });
    P(b).dispatchEvent(leave); b.clock.advance(300);
    assert.ok(Math.abs(px(b, '--fx') - before) < 1, `sensor-driven: the mouse leaving changes nothing (${before} -> ${prop(b, '--fx')})`);
  } finally { b.restore(); }
  // the +-180 seam through the real engine: the key glided onto an overhead pose (lying on your back);
  // jitter across the seam never throws the reflection across the face
  const seam = boot({ strength: 'pronounced' });
  try {
    seam.engine.paint();
    for (let i = 0; i < 60 * 12; i++) { tiltTo(seam, 179.5, 2); seam.clock.advance(16); }
    assert.ok(Math.abs(L.wrapDiff(S(seam).key.y, 179.5)) < 2, `12 s overhead: the key glided there (${S(seam).key.y})`);
    const fy0 = px(seam, '--fy');
    for (const beta of [-179.8, 179.6, -179.5, 179.9]) { tiltTo(seam, beta, 2); seam.clock.advance(100); assert.ok(Math.abs(px(seam, '--fy') - fy0) < 2.2 * K, `seam jitter (0.7 deg = 1.4 deg reflected) reads as a small tilt, never edge to edge (${prop(seam, '--fy')} vs ${fy0})`); }
  } finally { seam.restore(); }
  assert.deepStrictEqual(L.pointerLight(5000, -5000, { left: 0, top: 0, width: 100, height: 100 }), { ex: L.MOUSE_DEG, ey: -L.MOUSE_DEG });
  assert.strictEqual(L.pointerLight(1, 1, { left: 0, top: 0, width: 0, height: 0 }), null, 'no layout yet: no light');
  const r = boot({ strength: 'pronounced' });
  try {
    Object.defineProperty(r.win, 'screen', { configurable: true, value: { orientation: { angle: 90 } } });
    r.engine.paint();
    // landscape (angle 90): screen x = the device pitch (beta), screen y = -roll; the key pose is in
    // screen terms, so beta = KEY_X sits on the key's x and a 6 deg beta change lands on --fx
    tiltTo(r, L.KEY_X, 0); r.clock.advance(300);
    const fx0 = px(r, '--fx');
    tiltTo(r, L.KEY_X + 6, 0); r.clock.advance(500);
    assert.ok(Math.abs((px(r, '--fx') - fx0) - 12 * K) < 3, `landscape: a pitch change lands on --fx (${fx0} -> ${prop(r, '--fx')})`);
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
    const settings = [...panel.querySelectorAll('.ipm-row')].find((r) => r.querySelector('.ipm-lbl').textContent === 'Settings');
    tap({ win: dom.window }, settings);
    assert.deepStrictEqual([...panel.querySelectorAll('.ipm-row .ipm-lbl')].map((x) => x.textContent), ['About'], 'no driver: no Lighting row');
  } finally { Object.assign(global, saved); }
});

// ---------------------------------------------------------------- the CSS lock (jsdom-invisible)
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
function rule(selector) {
  const i = CSS.indexOf('\n  ' + selector + '{');
  assert.ok(i >= 0, 'rule present: ' + selector);
  return CSS.slice(i, CSS.indexOf('}', i) + 1);
}
test('AC3/AC5 CSS lock: ONE environment map per material (sharp panes on Click + Black body AND glass; the soft metal blob on Matte; the wheel reads --la only; the dome --dx/--dy/--dom; no --lm anywhere); Off = no base rule changed; Seattle untouched; no filter / blur / mask / backdrop / blend mode / CSS trig in any lighting rule', () => {
  for (const sel of ['.mms-ipod .ip-wheel', '.mms-ipod-black .ip-wheel', '.mms-ipod-matte .ip-wheel']) assert.match(rule(sel), /at calc\(50% \+ var\(--lx,0\) \* 30%\) calc\(-8% \+ var\(--ly,0\) \* 26%\)/, sel + ': the base rule is the v1.327 one');
  assert.match(rule('.mms-ipod .ip-wheel'), /box-shadow:var\(--mms-ipod-wheel-shadow\); \}/, 'the base wheel shadow is the static token again (no dead fallback)');
  assert.match(rule('.mms-ipod .ip-center'), /box-shadow:var\(--mms-ipod-center-shadow\); \}/);
  for (const [sel, pos] of [['.mms-ipod.mms-lit .ip-center', '50% 40%'], ['.mms-ipod-black.mms-lit .ip-center', '50% 40%'], ['.mms-ipod-matte.mms-lit .ip-center', '50% 38%']]) assert.match(rule(sel), new RegExp('background:radial-gradient\\(circle at ' + pos + ','), sel + ': the base dome is STATIC under lit; only its window image moves (the base --lx calc would saturate at 6 deg)');
  assert.match(rule('.mms-zune-classic .ip-wheel.znc-pad'), /at 50% -8%/, 'Seattle untouched');
  assert.ok(!/\.mms-zune-classic[^{]*\{[^}]*--(?:fx|fy|lx|ly|la|dx)/.test(CSS), 'no Seattle rule reads the light');
  assert.ok(!/--lm\b/.test(CSS), 'the dome no longer dims with distance (--lm is gone)');
  assert.match(rule('.mms-ipod.mms-lit::before'), /var\(--mms-env-veil-white\)/, 'white gloss: a veil for headroom');
  assert.match(rule('.mms-ipod-black.mms-lit::before'), /var\(--mms-env-veil-black\)/);
  assert.match(rule('.mms-ipod-matte.mms-lit::before'), /content:none/, 'anodized: no veil');
  const map = rule('.mms-ipod.mms-lit::after');
  assert.match(map, /var\(--mms-env-pane\)/, 'the sharp panes'); assert.match(map, /var\(--mms-env-lamp\)/, 'the lamp'); assert.match(map, /var\(--mms-env-shoulder\)/, 'the shoulder');
  assert.match(map, /background-position:calc\(50% \+ var\(--fx,0px\) \+ var\(--k,35px\) \* 22\) calc\(50% \+ var\(--fy,0px\) \+ var\(--k,35px\) \* 4\), calc\(50% \+ var\(--fx,0px\) - var\(--k,35px\) \* 3\.05\) calc\(50% \+ var\(--fy,0px\)\), calc\(50% \+ var\(--fx,0px\) \+ var\(--k,35px\) \* 3\.05\) calc\(50% \+ var\(--fy,0px\)\)/, 'the lamp sits +22/+4 deg from the window, the two panes +-3.05 deg from its centre; all ride --fx/--fy');
  assert.match(map, /background-size:calc\(var\(--k,35px\) \* 14\) calc\(var\(--k,35px\) \* 14\), calc\(var\(--k,35px\) \* 4\.9\) calc\(var\(--k,35px\) \* 16\)/, 'sizes in degrees x k: each pane 4.9 x 16 deg');
  assert.match(map, /var\(--mms-env-pane-sill\)/, 'a pane is brighter at the sky than at the sill');
  assert.match(map, /opacity:calc\(var\(--lk,1\) \* \.9\)/, 'Subtle scales the map by --lk');
  assert.match(rule('.mms-ipod-black.mms-lit::after'), /var\(--mms-env-ramp-ceil\)/, 'black gloss: the room ramp');
  const matte = rule('.mms-ipod-matte.mms-lit::after');
  assert.match(matte, /var\(--mms-env-metal\)/, 'anodized: the soft metal-tinted blob'); assert.ok(!/--mms-env-pane\b/.test(matte), 'anodized: no sharp panes on the body');
  const glass = rule('.mms-ipod.mms-lit .ip-lcd-in::after');
  assert.match(glass, /var\(--mms-env-pane\)/); assert.match(glass, /calc\(50% \+ var\(--fx,0px\) \+ var\(--lcx,0px\) - var\(--k,35px\) \* 3\.05\) calc\(50% \+ var\(--fy,0px\) \+ var\(--lcy,0px\)\)/, 'panel coordinates (the same pane offsets, the LCD centre subtracted)');
  assert.match(glass, /pointer-events:none/); assert.match(glass, /opacity:calc\(var\(--lk,1\) \* \.23\)/, 'panes at .14 over content');
  assert.strictEqual((glass.match(/linear-gradient\(180deg, var\(--mms-env-pane\) 0%, var\(--mms-env-pane-sill\) 100%\)/g) || []).length, 2, 'the glass carries BOTH panes (gate r1 qa C1: it had one 90deg pane with three positions)');
  assert.ok(!/90deg/.test(glass), 'no single-pane image on the glass');
  const topLevel = (v) => { let d = 0, n = 1; for (const ch of v) { if (ch === '(') d += 1; else if (ch === ')') d -= 1; else if (ch === ',' && d === 0) n += 1; } return n; };
  const layersOf = (r) => ({ img: topLevel(r.match(/background-image:([^;]*);/)[1]), size: topLevel(r.match(/background-size:([^;]*);/)[1]), pos: topLevel(r.match(/background-position:([^;]*)[;}]/)[1]) });
  for (const sel of ['.mms-ipod.mms-lit::after', '.mms-ipod-black.mms-lit::after', '.mms-ipod-matte.mms-lit::after', '.mms-ipod.mms-lit .ip-lcd-in::after', '.mms-ipod.mms-lit .ip-center::after']) {
    const l = layersOf(rule(sel));
    assert.ok(l.img === l.size && l.img === l.pos, sel + ': every background image has exactly one size and one position (' + JSON.stringify(l) + ')');
  }
  // gate r1 qa S1: the signs and axes the lock did not bind
  assert.match(rule('.mms-ipod-black.mms-lit::after'), /calc\(50% \+ var\(--fx,0px\) - var\(--k,35px\) \* 3\.05\) calc\(50% \+ var\(--fy,0px\)\), calc\(50% \+ var\(--fx,0px\) \+ var\(--k,35px\) \* 3\.05\) calc\(50% \+ var\(--fy,0px\)\)/, 'black: the panes ride +--fx');
  assert.match(matte, /calc\(50% \+ var\(--fx,0px\)\) calc\(50% \+ var\(--fy,0px\)\); \}/, 'matte: the blob rides +--fx/+--fy');
  assert.match(rule('.mms-ipod.mms-lit .ip-center::after'), /calc\(50% \+ var\(--dx,0px\) \+ var\(--dr,54px\) \* \.73\)/, 'the sparkle rides +--dx');
  for (const sel of ['.mms-ipod.mms-lit .ip-wheel::before', '.mms-ipod.mms-lit .ip-wheel::after', '.mms-ipod-black.mms-lit .ip-wheel::before', '.mms-ipod-matte.mms-lit .ip-wheel::before']) assert.ok(!/--(?:fx|fy|lx|ly|dx|dy)\b/.test(rule(sel)), sel + ': no moving specular on the wheel\'s layers either');
  assert.match(rule('.mms-ipod.mms-lit .ip-lcd-in'), /inset calc\(var\(--lx,0\) \* -2px\) calc\(var\(--ly,0\) \* -2px\) 3px var\(--mms-env-bezel-move\)/, 'the one moving bezel shadow');
  const wheel = rule('.mms-ipod.mms-lit .ip-wheel');
  assert.match(wheel, /conic-gradient\(from calc\(var\(--la,0\) \* 1deg - 40deg\)/, 'the lip ring keyed to the azimuth');
  assert.ok(!/--(?:fx|fy|lx|ly)\b/.test(wheel), 'no moving specular on matte plastic');
  assert.match(wheel, /isolation:isolate/);
  assert.match(rule('.mms-ipod.mms-lit .ip-wheel::before'), /inset:1\.5px/, 'the flat face inset 1.5 px');
  assert.match(rule('.mms-ipod.mms-lit .ip-wheel::after'), /opacity:var\(--wt,0\)/, 'the tone overlay');
  const dome = rule('.mms-ipod.mms-lit .ip-center::after');
  assert.match(dome, /opacity:calc\(var\(--dom,0\) \* var\(--lk,1\)\)/); assert.match(dome, /calc\(50% \+ var\(--dx,0px\)\) calc\(50% \+ var\(--dy,0px\)\)/); assert.match(dome, /background-size:6px 6px, 40% 55%/, 'the window image 0.4R x 0.55R, soft-edged');
  assert.match(rule('.mms-ipod.mms-lit .ip-center'), /position:relative; overflow:hidden/, 'the image clips at the rim');
  assert.match(rule('.mms-ipod.mms-lit .ip-center'), /0 0 0 1px var\(--mms-env-btn-gap\)/); assert.match(wheel, /0 0 0 1px var\(--mms-env-gap\)/);
  const allRules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const litRuleList = allRules.filter((r) => /mms-lit/.test(r.sel) || /--(?:fx|fy|dx|dy|dom|la|wt|lx|ly)\b/.test(r.body));
  assert.ok(litRuleList.length >= 20, 'the lighting rules were found (' + litRuleList.length + ')');
  const litRules = litRuleList.map((r) => r.sel + '{' + r.body + '}').join('\n');
  assert.ok(!/(?:^|[^-\w])(?:-webkit-)?(?:filter|backdrop-filter|mask(?:-image)?)\s*:/i.test(litRules), 'no filter / backdrop / mask in any lighting rule');
  assert.ok(!/blur\(/i.test(litRules), 'no blur()');
  assert.ok(!/(?:mix|background)-blend-mode\s*:/i.test(litRules), 'no blend modes (the research source uses them; we do not)');
  assert.ok(!/(?:^|[^-\w])(?:a?sin|a?cos|a?tan2?|hypot)\(/i.test(litRules), 'no CSS trig functions (the math lives in JS)');
  assert.ok(!/\n {2}\.mms-ipod::after\{/.test(CSS) && !/\n {2}\.mms-ipod \.ip-lcd-in::after\{/.test(CSS) && !/\n {2}\.mms-ipod \.ip-wheel::before\{/.test(CSS), 'no map / glass / face layer exists when NOT lit');
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
