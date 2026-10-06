'use strict';

// [UNIT] v1.366.0 W4 (VR / 360): the client half. watch.js's pure mount decision (each condition binds on its
// own: a fixture varying ONLY that input, LESSONS 2), the native-presentation detector, the owner's menu rows;
// vr-view.js's pure helpers, the no-WebGL refusal, and the source rules the plan sets (nothing draws the video
// into a 2D canvas; the canvas sits after the video; the script is loaded lazily, never by a shell).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const W = require('../../public/js/watch.js');
const V = require('../../public/js/vr-view.js');

const PUB = path.join(__dirname, '..', '..', 'public');
const ON = { projection: '360', toggleOn: true, viewAlive: true, playerState: 'full', playerId: 'a', itemId: 'a', nativePresentation: false, nativeControls: false };

test('vrMountDecision: a sphere, the switch on, the view alive, FULL with this item, no native presentation: mount', () => {
  assert.strictEqual(W.vrMountDecision(ON), true);
  for (const p of ['360-tb', '360-sbs', '180', '180-sbs', '180-tb']) assert.strictEqual(W.vrMountDecision({ ...ON, projection: p }), true, p);
});

test('vrMountDecision: each condition alone stops the mount', () => {
  const off = {
    'flat (no projection)': { projection: '' },
    'flat (owner said flat)': { projection: 'flat' },
    'no projection field': { projection: undefined },
    'switch off': { toggleOn: false },
    'view gone': { viewAlive: false },
    'docked': { playerState: 'docked' },
    'closed': { playerState: 'closed' },
    'another item is playing': { playerId: 'b' },
    'no item': { itemId: null, playerId: null },
    'native full screen / PiP': { nativePresentation: true },
    'native controls': { nativeControls: true },
  };
  for (const [why, over] of Object.entries(off)) assert.strictEqual(W.vrMountDecision({ ...ON, ...over }), false, why);
  assert.strictEqual(W.vrMountDecision(null), false);
  assert.strictEqual(W.vrMountDecision({ ...ON, toggleOn: 'true' }), false, 'only a real true');
});

test('vrViewIsOn: only the literal "1" is on; storage that throws is off', () => {
  const st = (v) => ({ getItem: (k) => (k === W.VR_VIEW_STORAGE_KEY ? v : null) });
  assert.strictEqual(W.VR_VIEW_STORAGE_KEY, 'ft-vr-view');
  assert.strictEqual(W.vrViewIsOn(st('1')), true);
  for (const v of [null, '0', 'true', '']) assert.strictEqual(W.vrViewIsOn(st(v)), false, String(v));
  assert.strictEqual(W.vrViewIsOn({ getItem() { throw new Error('SecurityError'); } }), false);
  assert.strictEqual(W.vrViewIsOn(null), false);
});

test('nativeVideoPresentation: the <video> itself in full screen or PiP counts; the app host in full screen does not', () => {
  const doc = new JSDOM('<div id="h"><video id="v"></video></div>').window.document;
  const v = doc.getElementById('v');
  const h = doc.getElementById('h');
  assert.strictEqual(W.nativeVideoPresentation(v, { fullscreenElement: null }), false);
  assert.strictEqual(W.nativeVideoPresentation(v, { fullscreenElement: h }), false, 'the app host full screen keeps the sphere');
  assert.strictEqual(W.nativeVideoPresentation(v, { fullscreenElement: v }), true);
  assert.strictEqual(W.nativeVideoPresentation(v, { pictureInPictureElement: v }), true);
  v.webkitDisplayingFullscreen = true;
  assert.strictEqual(W.nativeVideoPresentation(v, {}), true, 'iPhone native full screen');
  v.webkitDisplayingFullscreen = false;
  v.webkitPresentationMode = 'picture-in-picture';
  assert.strictEqual(W.nativeVideoPresentation(v, {}), true);
  assert.strictEqual(W.nativeVideoPresentation(null, {}), false);
});

test('nativePresentationKind: PiP and the element\'s own full screen are told apart; the app host is neither', () => {
  const doc = new JSDOM('<div id="h"><video id="v"></video></div>').window.document;
  const v = doc.getElementById('v');
  assert.strictEqual(W.nativePresentationKind(v, { fullscreenElement: doc.getElementById('h') }), '');
  assert.strictEqual(W.nativePresentationKind(v, { fullscreenElement: v }), 'fullscreen');
  assert.strictEqual(W.nativePresentationKind(v, { pictureInPictureElement: v }), 'pip');
  v.webkitPresentationMode = 'picture-in-picture';
  assert.strictEqual(W.nativePresentationKind(v, {}), 'pip', 'WebKit PiP');
  v.webkitPresentationMode = 'inline';
  v.webkitDisplayingFullscreen = true;
  assert.strictEqual(W.nativePresentationKind(v, {}), 'fullscreen', 'iPhone native full screen');
  assert.strictEqual(W.nativePresentationKind(null, {}), '');
});

test('vrNativeNotice: a HELD native presentation that replaced a sphere is disclosed once per kind, in its own words, on the way back', () => {
  const FS = { ...ON, nativePresentation: true, nativeKind: 'fullscreen' };
  const PIP = { ...ON, nativePresentation: true, nativeKind: 'pip' };
  const step = (n, st, had) => { const r = W.vrNativeNotice(n, st, had); return [{ lost: r.lost, shown: r.shown }, r.show]; };
  let n = { lost: '', shown: {} };
  let shown;
  [n, shown] = step(n, FS, true);
  assert.strictEqual(shown, '', 'no toast while Apple\'s player is up (never seen)');
  assert.strictEqual(n.lost, 'fullscreen');
  [n, shown] = step(n, ON, false);
  assert.strictEqual(shown, W.VR_NATIVE_NOTE, 'the full-screen note on the way back');
  [n, shown] = step(n, FS, true); [n, shown] = step(n, ON, false);
  assert.strictEqual(shown, '', 'once per page view');
  // PiP has its OWN words (the picture in the PiP window is flat; it is not full screen).
  [n, shown] = step(n, PIP, true); assert.strictEqual(shown, '');
  [n, shown] = step(n, ON, false);
  assert.strictEqual(shown, W.VR_PIP_NOTE);
  assert.match(W.VR_PIP_NOTE, /^Picture in picture shows the flat picture/);
  // A presentation that did NOT hold (the iPhone bounce: st.nativePresentation false) says nothing, sphere or not.
  let m = { lost: '', shown: {} };
  [m, shown] = step(m, { ...ON, nativePresentation: false, nativeKind: '' }, true);
  assert.strictEqual(m.lost, '', 'a bounce never latches');
  [m, shown] = step(m, ON, true);
  assert.strictEqual(shown, '');
  // No sphere up (switch off, a flat video): nothing to disclose.
  m = { lost: '', shown: {} };
  [m, shown] = step(m, FS, false); [m, shown] = step(m, ON, false);
  assert.strictEqual(shown, '', 'no sphere was lost, nothing to disclose');
  for (const t of [W.VR_NATIVE_NOTE, W.VR_PIP_NOTE, W.VR_MOTION_DENIED_NOTE]) assert.ok(!/\u2014/.test(t), 'no em dash in user copy: ' + t);
  assert.ok(W.VR_NATIVE_SETTLE_MS > 5 * 45, 'the settle window outlasts player.js\'s bounce retries (5 x 45 ms)');
});

test('vrMotionSupported: the motion API AND a coarse pointer (a phone or tablet); a desktop or no API is off', () => {
  const win = (doe, coarse) => ({ DeviceOrientationEvent: doe, matchMedia: (q) => ({ matches: q === '(pointer: coarse)' && coarse }) });
  function DOE() {}
  assert.strictEqual(W.vrMotionSupported(win(DOE, true)), true);
  assert.strictEqual(W.vrMotionSupported(win(DOE, false)), false, 'desktop: the API without a sensor');
  assert.strictEqual(W.vrMotionSupported(win(undefined, true)), false, 'no API');
  assert.strictEqual(W.vrMotionSupported({ DeviceOrientationEvent: DOE }), false, 'no matchMedia');
  assert.strictEqual(W.vrMotionSupported(null), false);
});

test('videoTypeMenuItems: the plan\'s eight rows in order, the current pick checked (no pick = Auto)', () => {
  const labels = W.VIDEO_TYPE_OPTIONS.map((o) => o.label);
  assert.deepStrictEqual(labels, ['Auto (from the file)', 'Flat', '360', '360 top-bottom', '360 side-by-side', '180', '180 side-by-side', '180 top-bottom']);
  assert.deepStrictEqual(W.videoTypeMenuItems(undefined).filter((r) => r.checked).map((r) => r.value), ['auto']);
  assert.deepStrictEqual(W.videoTypeMenuItems('180-sbs').filter((r) => r.checked).map((r) => r.value), ['180-sbs']);
  // Every row value the route accepts (auto -> null on the wire).
  const P = require('../../lib/media/projection');
  for (const o of W.VIDEO_TYPE_OPTIONS) assert.ok(o.value === 'auto' || P.isOverride(o.value), o.value);
  assert.strictEqual(W.VIDEO_TYPE_OPTIONS.length, P.OVERRIDES.length + 1, 'every override has a row');
});

test('vr-view: uniforms per projection (span and the LEFT eye), and a frame over the texture limit is refused', () => {
  assert.deepStrictEqual(V.uniformsFor('360'), { span: 1, eye: [0, 0, 1, 1] });
  assert.deepStrictEqual(V.uniformsFor('360-tb'), { span: 1, eye: [0, 0, 1, 0.5] });
  assert.deepStrictEqual(V.uniformsFor('360-sbs'), { span: 1, eye: [0, 0, 0.5, 1] });
  assert.deepStrictEqual(V.uniformsFor('180'), { span: 0.5, eye: [0, 0, 1, 1] });
  assert.deepStrictEqual(V.uniformsFor('180-sbs'), { span: 0.5, eye: [0, 0, 0.5, 1] });
  assert.deepStrictEqual(V.uniformsFor('180-tb'), { span: 0.5, eye: [0, 0, 1, 0.5] });
  assert.strictEqual(V.frameTooLarge(8192, 4096, 4096), true);
  assert.strictEqual(V.frameTooLarge(4096, 4097, 4096), true);
  assert.strictEqual(V.frameTooLarge(4096, 2048, 4096), false, 'exactly the limit fits');
});

test('vr-view: a drag right turns the view (yaw grows), pitch is clamped short of the pole, zoom is clamped', () => {
  const v0 = { yaw: 0, pitch: 0, fovDeg: V.FOV_DEFAULT_DEG };
  const right = V.dragView(v0, 100, 0, 400, 1.5);
  assert.ok(right.yaw > 0 && right.pitch === 0);
  const up = V.dragView(v0, 0, 100000, 400, 1.5);
  assert.ok(up.pitch < Math.PI / 2 && up.pitch > 1.5);
  assert.strictEqual(V.zoomView(v0, 5).fovDeg, V.FOV_MIN_DEG);
  assert.strictEqual(V.zoomView(v0, 500).fovDeg, V.FOV_MAX_DEG);
});

test('vr-view.mount: no WebGL -> null, and nothing is added to the page', () => {
  const dom = new JSDOM('<div id="h"><video id="v"></video><div id="after"></div></div>');
  const saved = { document: global.document };
  global.document = dom.window.document;
  try {
    dom.window.HTMLCanvasElement.prototype.getContext = () => null;
    const h = dom.window.document.getElementById('h');
    const r = V.mount(dom.window.document.getElementById('v'), h, '360');
    assert.strictEqual(r, null);
    assert.strictEqual(h.querySelectorAll('canvas').length, 0);
    assert.ok(!h.classList.contains('vr-view-on'));
    assert.strictEqual(V.mount(dom.window.document.getElementById('v'), h, 'flat'), null, 'flat is never a projection');
  } finally { global.document = saved.document; dom.window.close(); }
});

test('source rules: nothing reads the video into a 2D canvas; the canvas goes right after the video; vr-view.js is lazy', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  const vr = strip(fs.readFileSync(path.join(PUB, 'js', 'vr-view.js'), 'utf8'));
  assert.doesNotMatch(vr, /drawImage\s*\(/, 'no drawImage (the v1.312 iPhone blackout shape)');
  assert.doesNotMatch(vr, /getContext\(\s*'2d'/, 'no 2D context at all');
  assert.match(vr, /texImage2D\([^)]*\bvideo\)/, 'the frame is uploaded straight from the <video>');
  assert.match(vr, /host\.insertBefore\(canvas, video\.nextSibling\)/);
  const watch = strip(fs.readFileSync(path.join(PUB, 'js', 'watch.js'), 'utf8'));
  assert.match(watch, /el\.src = '\/js\/vr-view\.js'/, 'loaded on the first sphere mount');
  for (const f of fs.readdirSync(PUB).filter((x) => x.endsWith('.html'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(PUB, f), 'utf8'), /vr-view\.js/, f + ' never loads vr-view.js: a flat page carries none of it');
  }
});

// ---- the fake-GL mount (gate r1 A): vr-view.js's mount driven for real, with a recording WebGL stand-in ----
function fakeGl(maxTex) {
  const calls = [];
  const consts = { MAX_TEXTURE_SIZE: 'MAX_TEXTURE_SIZE', UNPACK_FLIP_Y_WEBGL: 'UNPACK_FLIP_Y_WEBGL' };
  const gl = new Proxy({}, {
    get(t, k) {
      if (k in consts) return consts[k];
      if (typeof k !== 'string') return undefined;
      if (/^[A-Z_0-9]+$/.test(k)) return k;
      if (k === 'getParameter') return (p) => { calls.push(['getParameter', p]); return p === 'MAX_TEXTURE_SIZE' ? maxTex : 0; };
      if (k === 'getShaderParameter' || k === 'getProgramParameter') return () => true;
      if (k === 'getExtension') return (n) => { calls.push(['getExtension', n]); return n === 'WEBGL_lose_context' ? { loseContext: () => calls.push(['loseContext']) } : null; };
      if (/^(create|get)/.test(k)) return (...a) => { calls.push([k, ...a]); return { k }; };
      return (...a) => { calls.push([k, ...a]); };
    },
  });
  return { gl, calls };
}
function mountRealm(o) {
  const opts = o || {};
  const dom = new JSDOM('<div id="h"><video id="v"></video><div id="after"></div></div>', { pretendToBeVisual: true });
  const w = dom.window;
  const saved = { document: global.document, window: global.window, raf: global.requestAnimationFrame, caf: global.cancelAnimationFrame };
  global.document = w.document; global.window = w;
  let q = [];
  global.requestAnimationFrame = (f) => { q.push(f); return q.length; };
  global.cancelAnimationFrame = () => {};
  const flush = () => { for (let i = 0; i < 5 && q.length; i++) { const run = q; q = []; run.forEach((f) => f(0)); } };
  const { gl, calls } = fakeGl(opts.maxTex || 4096);
  w.HTMLCanvasElement.prototype.getContext = function (t) { return t === 'webgl' ? gl : null; };
  const video = w.document.getElementById('v');
  const host = w.document.getElementById('h');
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
  Object.defineProperty(video, 'videoWidth', { value: opts.vw || 512, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: opts.vh || 256, configurable: true });
  Object.defineProperty(video, 'paused', { value: true, configurable: true });
  const cb = { fail: 0, tooLarge: 0, tap: 0 };
  const h = V.mount(video, host, opts.projection || '360', { onFail: () => cb.fail++, onTooLarge: () => cb.tooLarge++, onTap: () => cb.tap++ });
  if (h) {
    Object.defineProperty(h.canvas, 'clientWidth', { value: 600, configurable: true });
    Object.defineProperty(h.canvas, 'clientHeight', { value: 300, configurable: true });
  }
  flush();
  const ptr = (type, id, x, y) => { const e = new w.Event(type, { bubbles: true, cancelable: true }); e.pointerId = id; e.clientX = x; e.clientY = y; h.canvas.dispatchEvent(e); flush(); };
  const drag = (dx, dy) => { ptr('pointerdown', 1, 300, 150); ptr('pointermove', 1, 300 + dx, 150 + dy); ptr('pointerup', 1, 300 + dx, 150 + dy); };
  const lastRot = () => { const c = calls.filter((x) => x[0] === 'uniformMatrix3fv'); return c.length ? Array.from(c[c.length - 1][3]) : null; };
  const close = () => { global.document = saved.document; global.window = saved.window; global.requestAnimationFrame = saved.raf; global.cancelAnimationFrame = saved.caf; w.close(); };
  return { w, dom, video, host, h, cb, calls, flush, drag, ptr, lastRot, close };
}
// The shader's OWN mapping lines (V.FRAG), evaluated in JS for the view ray at the canvas centre: a mutated sign in
// the shipped shader text changes this result (a JS twin of the formula would not).
function centreSample(rot, span) {
  const line = (name) => { const m = new RegExp('float ' + name + ' = ([^;]+);').exec(V.FRAG); assert.ok(m, 'the shader computes ' + name); return m[1]; };
  const body = 'const lon = ' + line('lon') + '; const lat = ' + line('lat') + '; const u = ' + line('u') + '; const v = ' + line('v') + '; return { u, v };';
  const f = new Function('d', 'uSpan', 'atan', 'asin', 'clamp', body);
  const d = { x: -rot[6], y: -rot[7], z: -rot[8] }; // uRot * (0, 0, -1) at vNdc = (0, 0)
  return f(d, span || 1, (y, x) => Math.atan2(y, x), Math.asin, (a, lo, hi) => Math.min(hi, Math.max(lo, a)));
}

test('vr-view.mount (fake GL): the canvas goes in after the video, a frame is uploaded straight from it, destroy removes the canvas and frees the context', () => {
  const r = mountRealm();
  try {
    assert.ok(r.h, 'mounted');
    const c = r.host.querySelector('canvas.vr-view-canvas');
    assert.ok(c && c.previousElementSibling === r.video, 'right after the video');
    assert.ok(r.host.classList.contains('vr-view-on'));
    const up = r.calls.filter((x) => x[0] === 'texImage2D');
    assert.ok(up.length >= 1 && up[0][up[0].length - 1] === r.video, 'texImage2D from the <video> itself');
    assert.ok(r.calls.some((x) => x[0] === 'drawArrays'), 'drawn');
    r.h.destroy();
    assert.strictEqual(r.host.querySelectorAll('canvas').length, 0, 'destroy removes the canvas from over the video');
    assert.ok(!r.host.classList.contains('vr-view-on'));
    assert.ok(r.calls.some((x) => x[0] === 'loseContext'), 'the GPU context is released at once');
  } finally { r.close(); }
});

test('vr-view.mount (fake GL): a frame over MAX_TEXTURE_SIZE calls onTooLarge once and is never uploaded (refused, not shrunk)', () => {
  const r = mountRealm({ maxTex: 1024, vw: 2048, vh: 1024 });
  try {
    assert.strictEqual(r.cb.tooLarge, 1, 'the refusal is reported');
    assert.strictEqual(r.calls.filter((x) => x[0] === 'texImage2D').length, 0, 'nothing uploaded');
    r.video.dispatchEvent(new r.w.Event('timeupdate')); r.flush();
    assert.strictEqual(r.cb.tooLarge, 1, 'once');
  } finally { r.close(); }
  const ok = mountRealm({ maxTex: 1024, vw: 1024, vh: 512 });
  try { assert.strictEqual(ok.cb.tooLarge, 0, 'a frame at the limit is fine (discrimination)'); } finally { ok.close(); }
});

test('vr-view.mount (fake GL): a lost WebGL context is reported through onFail (and its default prevented)', () => {
  const r = mountRealm();
  try {
    const e = new r.w.Event('webglcontextlost', { cancelable: true });
    r.h.canvas.dispatchEvent(e);
    assert.strictEqual(r.cb.fail, 1);
    assert.strictEqual(e.defaultPrevented, true);
  } finally { r.close(); }
});

test('vr-view.mount (fake GL): the picture follows the finger and is neither mirrored nor upside down (the shader\'s own mapping)', () => {
  const r = mountRealm();
  try {
    const s0 = centreSample(r.lastRot());
    assert.ok(Math.abs(s0.u - 0.5) < 1e-6 && Math.abs(s0.v - 0.5) < 1e-6, 'yaw 0 looks at the frame centre (the front)');
    r.drag(-120, 0); // the finger moves LEFT: the scene moves left, the view turns RIGHT
    const s1 = centreSample(r.lastRot());
    assert.ok(s1.u > 0.55, 'a drag left shows what is to the RIGHT of the front (u > 0.5): ' + s1.u);
    assert.ok(Math.abs(s1.v - 0.5) < 1e-6, 'a level drag keeps the horizon');
    r.drag(120, 0);
    r.drag(0, 80); // the finger moves DOWN: the scene moves down, the view turns UP
    const s2 = centreSample(r.lastRot());
    assert.ok(s2.v < 0.45, 'a drag down shows what is ABOVE (the top of the frame, v < 0.5): ' + s2.v);
    assert.ok(!r.calls.some((x) => x[0] === 'pixelStorei' && x[1] === 'UNPACK_FLIP_Y_WEBGL' && x[2]), 'no FLIP_Y: the frame\'s top row is v 0');
  } finally { r.close(); }
});

test('vr-view.mount (fake GL): motion - requestPermission is asked synchronously by enableMotion, orientation turns the view, a drag still offsets it, denied stays off', async () => {
  const r = mountRealm();
  try {
    let asked = 0;
    let answer = 'granted';
    function DOE() {}
    DOE.requestPermission = () => { asked++; return Promise.resolve(answer); };
    r.w.DeviceOrientationEvent = DOE;
    const p = r.h.enableMotion();
    assert.strictEqual(asked, 1, 'asked synchronously, inside the caller\'s gesture');
    assert.strictEqual(await p, true);
    assert.strictEqual(r.h.motionOn(), true);
    const orient = (alpha, beta, gamma) => { const e = new r.w.Event('deviceorientation'); e.alpha = alpha; e.beta = beta; e.gamma = gamma; r.w.dispatchEvent(e); r.flush(); };
    orient(0, 90, 0); // upright, the first sample: keep looking where the view was (the front)
    let s = centreSample(r.lastRot());
    assert.ok(Math.abs(s.u - 0.5) < 1e-3 && Math.abs(s.v - 0.5) < 1e-3, 'the first sample keeps the view: ' + JSON.stringify(s));
    orient(90, 90, 0); // the phone turns 90 degrees LEFT: the view looks LEFT (u 0.25)
    s = centreSample(r.lastRot());
    assert.ok(Math.abs(s.u - 0.25) < 1e-3, 'turning left looks left: ' + s.u);
    orient(90, 120, 0); // the phone tips up: the view looks up
    assert.ok(centreSample(r.lastRot()).v < 0.45, 'tipping up looks up');
    orient(90, 90, 0);
    r.drag(-120, 0); // with motion on, a drag still turns the view (it offsets the motion heading)
    s = centreSample(r.lastRot());
    assert.ok(s.u > 0.25 + 0.05, 'the drag offsets the heading: ' + s.u);
    r.h.disableMotion(); r.flush();
    assert.strictEqual(r.h.motionOn(), false);
    const before = r.lastRot();
    orient(0, 90, 0);
    assert.deepStrictEqual(r.lastRot(), before, 'motion off: orientation moves nothing');
    answer = 'denied';
    assert.strictEqual(await r.h.enableMotion(), false, 'denied: off');
    assert.strictEqual(r.h.motionOn(), false);
  } finally { r.close(); }
});
