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

test('vrNativeNotice: a sphere that gives way to the browser\'s own full screen is disclosed ONCE, on the way back', () => {
  const N = { ...ON, nativePresentation: true };
  let n = { lost: false, shown: false };
  let r = W.vrNativeNotice(n, N, true); // the sphere was up, the browser takes the video over
  assert.deepStrictEqual(r, { lost: true, shown: false, show: false }, 'no toast while Apple\'s player is up (never seen)');
  r = W.vrNativeNotice({ lost: r.lost, shown: r.shown }, ON, false); // back on the page
  assert.deepStrictEqual(r, { lost: false, shown: true, show: true }, 'the note shows on the way back');
  n = { lost: r.lost, shown: r.shown };
  r = W.vrNativeNotice(n, N, true); r = W.vrNativeNotice({ lost: r.lost, shown: r.shown }, ON, false);
  assert.strictEqual(r.show, false, 'once per page view');
  // No sphere up (switch off, a flat video): the native full screen says nothing.
  r = W.vrNativeNotice({ lost: false, shown: false }, N, false); r = W.vrNativeNotice({ lost: r.lost, shown: r.shown }, ON, false);
  assert.strictEqual(r.show, false, 'no sphere was lost, nothing to disclose');
  assert.match(W.VR_NATIVE_NOTE, /flat picture/);
  assert.ok(!/\u2014/.test(W.VR_NATIVE_NOTE), 'no em dash in user copy');
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
