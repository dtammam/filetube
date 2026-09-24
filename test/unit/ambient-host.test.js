'use strict';

// [UNIT] v1.317 M4: the SHARED ambient host (public/js/ambient.js createAmbientHost) - the
// v1.312 watch wiring factored out so the watch view and the desktop music view run the
// same engine through the same start/stop funnel. Driven on a real DOM (jsdom) with the
// host's OWN default image loader and canvas (a fake Image + a stubbed 2D context stand in
// for the browser's), so the paths below are the production ones:
//   - the watch shape (sprite rung, no view gate) paints exactly as v1.312 did;
//   - BOTH axes of every gate: ON + dark + playing + visible paints; OFF, light, paused,
//     hidden, or the view's own canRun() false paints nothing; and the CLEAR axis on a
//     POPULATED glow (turn each one off after it painted);
//   - every listener and observer the host adds dies on the view's abort (the signals it
//     passed are aborted, the observers disconnected), a torn-down host never re-lights,
//     and a host built for an already-aborted view is never built at all;
//   - a media element that appears AFTER the host (a cold /music load clones the player
//     host on the first play) is bound on the first evaluate that finds it;
//   - the `observe` element (music: #player-slot) re-evaluates on a childList change;
//   - the ONE writer of the cog's Ambient row, and the same-origin art guard.
// Music-side integration (the real music.js, the real ?play= shape): music-ambient.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const A = require('../../public/js/ambient.js');

const settle = () => new Promise((r) => setImmediate(r));
async function settleN(n) { for (let i = 0; i < (n || 6); i++) await settle(); }

const PAGE = `<!doctype html><html data-mode="dark"><body>
  <div id="settings-menu"></div>
  <div class="stage"><div id="glow" class="ambient-glow" aria-hidden="true" hidden>
    <div class="ambient-glow-layer"></div><div class="ambient-glow-layer"></div></div>
    <div id="slot"></div></div>
  <div id="dock"></div>
</body></html>`;

// A realm with the browser collaborators the host reaches through free identifiers
// (document / localStorage / Image / MutationObserver / AbortController), each wrapped so
// a test can see what was bound and what was torn down.
function realm(opts) {
  opts = opts || {};
  const dom = new JSDOM(PAGE, { url: 'http://localhost/watch.html?v=vid1', pretendToBeVisual: true }); // visual: document.hidden is false (a visible tab)
  const W = dom.window;
  const D = W.document;
  const saved = {};
  for (const k of ['window', 'document', 'localStorage', 'Image', 'MutationObserver', 'AbortController', 'location']) saved[k] = global[k];
  const loads = [];
  const failing = new Set(opts.failing || []);
  class FakeImage {
    constructor() { this.naturalWidth = 0; this.naturalHeight = 0; }
    set src(u) {
      this._src = u; loads.push(u);
      setImmediate(() => {
        if (failing.has(u)) { if (this.onerror) this.onerror(); return; }
        this.naturalWidth = 320; this.naturalHeight = 180;
        if (this.onload) this.onload();
      });
    }
    get src() { return this._src; }
  }
  const observers = [];
  class SpyMO extends W.MutationObserver {
    constructor(cb) { super(cb); this.disconnected = false; observers.push(this); }
    disconnect() { this.disconnected = true; return super.disconnect(); }
  }
  // Every listener the host adds is recorded with the signal it was bound on.
  const bound = [];
  const origAdd = W.EventTarget.prototype.addEventListener;
  W.EventTarget.prototype.addEventListener = function (type, fn, o) {
    if (o && typeof o === 'object' && o.signal) bound.push({ target: this, type, signal: o.signal });
    return origAdd.call(this, type, fn, o);
  };
  // The 2D context: a draw records the image, a read returns a colour derived from its
  // URL (so two different images are two different fields), toDataURL a real PNG prefix.
  let lastDrawn = null;
  let pngs = 0;
  W.HTMLCanvasElement.prototype.getContext = function () {
    return {
      drawImage(img) { lastDrawn = img; },
      getImageData(x, y, w, h) {
        const u = (lastDrawn && lastDrawn.src) || '';
        let hsh = 2166136261; for (let i = 0; i < u.length; i++) hsh = Math.imul(hsh ^ u.charCodeAt(i), 16777619) >>> 0; // FNV-1a: one char apart = a far colour
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i += 4) { data[i] = hsh % 256; data[i + 1] = (hsh >> 8) % 256; data[i + 2] = (hsh >> 16) % 256; data[i + 3] = 255; }
        return { data, width: w, height: h };
      },
      putImageData() {},
    };
  };
  W.HTMLCanvasElement.prototype.toDataURL = function () { pngs++; return 'data:image/png;base64,QUJD' + pngs; };
  Object.assign(global, { window: W, document: D, localStorage: W.localStorage, Image: FakeImage, MutationObserver: SpyMO, AbortController: W.AbortController, location: W.location });
  if (opts.pref !== undefined) W.localStorage.setItem('ft-ambient', opts.pref);
  const media = D.createElement('video');
  media.id = 'media-player';
  const state = { paused: true, ended: false, readyState: 4, currentTime: 0 };
  Object.defineProperty(media, 'paused', { get: () => state.paused, configurable: true });
  Object.defineProperty(media, 'ended', { get: () => state.ended, configurable: true });
  Object.defineProperty(media, 'readyState', { get: () => state.readyState, configurable: true });
  Object.defineProperty(media, 'currentTime', { get: () => state.currentTime, set: (v) => { state.currentTime = v; }, configurable: true });
  const ctl = new W.AbortController();
  const glow = D.getElementById('glow');
  const row = () => A.ensureAmbientToggleRow(D);
  // restore() ALWAYS aborts the view first: a failed assertion must never leave a live engine
  // clock behind (it would keep the runner's process alive).
  const restore = () => { try { ctl.abort(); } catch (_) { /* already */ } W.EventTarget.prototype.addEventListener = origAdd; for (const k of Object.keys(saved)) global[k] = saved[k]; };
  return {
    W, D, media, state, ctl, glow, row, loads, observers, bound, restore,
    slot: D.getElementById('slot'), dock: D.getElementById('dock'),
    play() { state.paused = false; media.dispatchEvent(new W.Event('playing')); },
    pause() { state.paused = true; media.dispatchEvent(new W.Event('pause')); },
    painted() { return [...glow.querySelectorAll('.ambient-glow-layer')].some((l) => /^url\("data:image\/png/.test(l.style.getPropertyValue('background-image'))); },
    lit() { return glow.classList.contains('is-on') && !glow.hidden && D.documentElement.hasAttribute('data-ambient-on'); },
    anyLit() { return !glow.hidden || glow.classList.contains('is-on') || D.documentElement.hasAttribute('data-ambient-on'); },
  };
}

// The watch shape: the sprite rung (a storyboard geometry + an id), no view gate.
const GEOM = { v: 1, interval: 2.5, count: 40, cols: 10, rows: 4, tileW: 320, tileH: 180 };
const SB = { frameForTime: () => 0, tile: () => ({ index: 0, col: 0, row: 0 }) };
function watchHost(r, extra) {
  r.slot.appendChild(r.media);
  const c = r.row();
  return A.createAmbientHost(Object.assign({
    glow: r.glow, check: c.check, row: c.row,
    getMedia: () => r.D.getElementById('media-player'),
    getMediaData: () => ({ type: 'video', duration: 100, storyboard: GEOM }),
    mediaId: 'vid1', storyboard: SB, signal: r.ctl.signal,
  }, extra || {}));
}

test('v1.317 host, watch shape: ON + dark + playing paints the SPRITE through the default loader and an off-DOM canvas (the v1.312 behavior)', async () => {
  const r = realm({ pref: '1' });
  try {
    const h = watchHost(r);
    assert.ok(h, 'a host');
    assert.strictEqual(r.row().check.checked, true, 'the checkbox reflects the stored pref');
    assert.strictEqual(r.anyLit(), false, 'paused: nothing lit yet');
    r.play(); await settleN();
    assert.deepStrictEqual(r.loads, ['/storyboard/vid1'], 'the watch sprite URL, through the host\'s own Image loader');
    assert.ok(r.lit(), 'glow on + unhidden + the root sidebar signal');
    assert.ok(r.painted(), 'a layer carries the PNG data URL');
    assert.strictEqual(r.D.querySelectorAll('canvas').length, 0, 'the sample canvas never enters the document');
  } finally { r.restore(); }
});

test('v1.317 host: every gate axis OFF paints nothing - pref off, light, paused, hidden tab, and the view\'s canRun() false', async () => {
  const cases = [
    ['pref off', { pref: '0' }, (r) => r.play()],
    ['light', { pref: '1' }, (r) => { r.D.documentElement.setAttribute('data-mode', 'light'); r.play(); }],
    ['paused', { pref: '1' }, () => {}],
    ['hidden tab', { pref: '1' }, (r) => { Object.defineProperty(r.D, 'hidden', { get: () => true, configurable: true }); r.play(); }],
    ['canRun false', { pref: '1', extra: { canRun: () => false } }, (r) => r.play()],
  ];
  for (const [label, o, drive] of cases) {
    const r = realm({ pref: o.pref });
    try {
      watchHost(r, o.extra);
      drive(r); await settleN();
      assert.deepStrictEqual(r.loads, [], label + ': no image is even requested');
      assert.strictEqual(r.anyLit(), false, label + ': glow hidden, not is-on, no root signal');
      assert.strictEqual(r.painted(), false, label + ': no layer painted');
    } finally { r.restore(); }
  }
});

test('v1.317 host: the CLEAR axis on a POPULATED glow - pause, the cog toggle, a flip to light, a hidden tab and canRun() turning false each tear it down', async () => {
  const clears = [
    ['pause', (r) => r.pause()],
    ['toggle off', (r) => { const c = r.row().check; c.checked = false; c.dispatchEvent(new r.W.Event('change')); }],
    ['flip to light', async (r) => { r.D.documentElement.setAttribute('data-mode', 'light'); await settle(); }],
    ['tab hidden', (r) => { Object.defineProperty(r.D, 'hidden', { get: () => true, configurable: true }); r.D.dispatchEvent(new r.W.Event('visibilitychange')); }],
    ['canRun false', (r, gate, h) => { gate.ok = false; h.evaluate(); }],
  ];
  for (const [label, clear] of clears) {
    const r = realm({ pref: '1' });
    const gate = { ok: true };
    try {
      const h = watchHost(r, { canRun: () => gate.ok });
      r.play(); await settleN();
      assert.ok(r.lit() && r.painted(), label + ': precondition - populated and lit');
      await clear(r, gate, h); await settleN();
      assert.strictEqual(r.anyLit(), false, label + ': cleared (is-on off, hidden, root signal gone)');
      assert.strictEqual(h.engine.running(), false, label + ': the engine clock stopped');
    } finally { r.restore(); }
  }
});

// gate r1 (qa W1 / adversary W3): the music view reloads the SAME media element on every
// track change - player.js teardownMediaState: 'pause' + 'emptied' at readyState 0 (the
// browser has already reset it when the queued events fire), then the new src's
// 'loadeddata' + 'playing' at readyState 4. The hold (loadHoldMs) keeps a LIT glow across
// that gap; every other axis still clears, a real pause (readyState 4) and a natural end
// clear at once, and the gap is bounded by the hold timer.
function fakeTimers() {
  const t = [];
  return {
    list: t,
    setTimeout: (fn, ms) => { t.push({ fn, ms, cleared: false }); return t.length; },
    clearTimeout: (id) => { if (t[id - 1]) t[id - 1].cleared = true; },
    live: () => t.filter((x) => !x.cleared && !x.fired),
    fireLive: () => { const x = t.find((y) => !y.cleared && !y.fired); x.fired = true; x.fn(); },
  };
}
function loadGap(r) {
  r.state.paused = true; r.state.ended = false; r.state.readyState = 0; r.state.currentTime = 0;
  r.media.dispatchEvent(new r.W.Event('pause'));
  r.media.dispatchEvent(new r.W.Event('emptied'));
}
function newSrcPlays(r) {
  r.state.readyState = 4; r.state.paused = false;
  r.media.dispatchEvent(new r.W.Event('loadeddata'));
  r.media.dispatchEvent(new r.W.Event('playing'));
}

test('v1.317 gate r1 host: the LOAD-GAP hold - a lit glow survives pause + emptied at readyState 0 and the new src playing, with ONE bounded timer that the resume clears', async () => {
  const r = realm({ pref: '1' });
  const T = fakeTimers();
  try {
    const h = watchHost(r, { loadHoldMs: 5000, setTimeout: T.setTimeout, clearTimeout: T.clearTimeout });
    loadGap(r); // a gap BEFORE anything is lit (the first load) holds nothing
    assert.strictEqual(T.list.length, 0, 'an UNLIT glow arms no hold');
    assert.strictEqual(r.anyLit(), false);
    r.state.readyState = 4; r.play(); await settleN();
    assert.ok(r.lit() && r.painted(), 'precondition: lit and populated');
    loadGap(r);
    assert.ok(r.lit(), 'mid-gap: is-on, unhidden, root signal still set');
    assert.strictEqual(h.engine.running(), true, 'the engine keeps its clock (the next cover cross-fades in)');
    assert.strictEqual(T.live().length, 1, 'one hold timer, armed at the gap\'s first event (not re-armed by the second)');
    assert.strictEqual(T.live()[0].ms, 5000, 'bounded by loadHoldMs');
    newSrcPlays(r);
    assert.ok(r.lit(), 'the new src plays: lit');
    assert.strictEqual(T.live().length, 0, 'the resume cleared the hold timer');
  } finally { r.restore(); }
});

test('v1.317 gate r1 host: the hold never swallows a real clear - the bound, a pause DURING the gap, a user pause, a natural end, light, a hidden tab and the view gate each clear', async () => {
  const cases = [
    ['the bound passes with nothing playing', (r, T) => { loadGap(r); assert.ok(r.lit(), 'held first'); T.fireLive(); }],
    ['a user pause during the gap (data arrives paused)', (r) => { loadGap(r); assert.ok(r.lit(), 'held first'); r.state.readyState = 4; r.media.dispatchEvent(new r.W.Event('loadeddata')); }],
    ['a user pause at readyState 4', (r) => { r.pause(); }],
    ['a natural end (pause then ended, readyState 4)', (r) => { r.state.ended = true; r.state.paused = true; r.media.dispatchEvent(new r.W.Event('pause')); r.media.dispatchEvent(new r.W.Event('ended')); }],
    ['a flip to light during the gap', async (r) => { loadGap(r); r.D.documentElement.setAttribute('data-mode', 'light'); await settle(); }],
    ['a hidden tab during the gap', (r) => { loadGap(r); Object.defineProperty(r.D, 'hidden', { get: () => true, configurable: true }); r.D.dispatchEvent(new r.W.Event('visibilitychange')); }],
    ['the view gate false during the gap (a dock)', (r, T, gate, h) => { loadGap(r); gate.ok = false; h.evaluate(); }],
  ];
  for (const [label, clear] of cases) {
    const r = realm({ pref: '1' });
    const T = fakeTimers();
    const gate = { ok: true };
    try {
      const h = watchHost(r, { loadHoldMs: 5000, setTimeout: T.setTimeout, clearTimeout: T.clearTimeout, canRun: () => gate.ok });
      r.state.readyState = 4; r.play(); await settleN();
      assert.ok(r.lit(), label + ': precondition lit');
      await clear(r, T, gate, h); await settleN();
      assert.strictEqual(r.anyLit(), false, label + ': cleared (is-on off, hidden, root signal gone)');
      assert.strictEqual(h.engine.running(), false, label + ': the engine clock stopped');
      assert.strictEqual(T.live().length, 0, label + ': no hold timer left armed');
    } finally { r.restore(); }
  }
});

test('v1.317 gate r1 host: WITHOUT loadHoldMs (the watch view) the gap clears exactly as v1.312 did, and no loadeddata listener is bound', async () => {
  const r = realm({ pref: '1' });
  try {
    watchHost(r);
    r.state.readyState = 4; r.play(); await settleN();
    assert.ok(r.lit(), 'precondition: lit');
    assert.strictEqual(r.bound.some((b) => b.target === r.media && b.type === 'loadeddata'), false, 'watch binds no loadeddata');
    loadGap(r);
    assert.strictEqual(r.anyLit(), false, 'watch: not playing = cleared at once (unchanged)');
  } finally { r.restore(); }
});

test('v1.317 gate r1 host (adversary S3): a view with no glow or no Ambient toggle gets NO host - nothing bound, nothing observed, nothing lit', () => {
  for (const [label, drop] of [['no toggle (a mount without the cog menu)', 'check'], ['no glow pair', 'glow']]) {
    const r = realm({ pref: '1' });
    try {
      r.slot.appendChild(r.media);
      r.state.paused = false;
      const c = r.row();
      const o = { glow: r.glow, check: c.check, row: c.row, getMedia: () => r.media, signal: r.ctl.signal };
      o[drop] = null;
      const before = r.bound.length;
      assert.strictEqual(A.createAmbientHost(o), null, label + ': null');
      assert.strictEqual(r.bound.length, before, label + ': no listener bound');
      assert.strictEqual(r.observers.length, 0, label + ': no observer');
      assert.strictEqual(r.anyLit(), false, label + ': nothing lit');
    } finally { r.restore(); }
  }
});

test('v1.317 host: the cog toggle writes the SHARED pref key both ways, and a light theme hides the row', async () => {
  const r = realm({ pref: '0' });
  try {
    watchHost(r);
    const c = r.row().check;
    c.checked = true; c.dispatchEvent(new r.W.Event('change'));
    assert.strictEqual(r.W.localStorage.getItem('ft-ambient'), '1', 'ON persisted under ft-ambient');
    c.checked = false; c.dispatchEvent(new r.W.Event('change'));
    assert.strictEqual(r.W.localStorage.getItem('ft-ambient'), '0', 'OFF persisted');
    assert.strictEqual(r.row().row.hidden, false, 'dark: the row shows');
    r.D.documentElement.setAttribute('data-mode', 'light'); await settleN();
    assert.strictEqual(r.row().row.hidden, true, 'light: the row hides (the theme observer re-evaluates)');
  } finally { r.restore(); }
});

test('v1.317 host teardown: the view abort clears a lit glow, aborts EVERY signal the host bound on, disconnects both observers, and nothing re-lights after', async () => {
  const r = realm({ pref: '1' });
  try {
    const h = watchHost(r, { observe: r.slot });
    r.play(); await settleN();
    assert.ok(r.lit(), 'precondition: lit');
    assert.strictEqual(r.observers.length, 2, 'the theme observer + the observe (slot) observer');
    const mediaBinds = r.bound.filter((b) => b.target === r.media);
    assert.deepStrictEqual(mediaBinds.map((b) => b.type).sort(), ['emptied', 'ended', 'pause', 'play', 'playing'], 'the five media events');
    assert.ok(r.bound.some((b) => b.target === r.D && b.type === 'visibilitychange'), 'visibilitychange bound');
    assert.ok(r.bound.some((b) => b.target === r.row().check && b.type === 'change'), 'the toggle bound');
    r.ctl.abort();
    assert.strictEqual(r.anyLit(), false, 'the abort cleared the glow + root signal');
    for (const b of r.bound) assert.strictEqual(b.signal.aborted, true, b.type + ': its binding signal is aborted (the listener is gone)');
    for (const o of r.observers) assert.strictEqual(o.disconnected, true, 'observer disconnected');
    // the torn host never re-lights - not even through a direct evaluate() (a late seam of a dead view)
    r.state.paused = false;
    h.evaluate(); await settleN();
    assert.strictEqual(r.anyLit(), false, 'a late evaluate() after teardown lights nothing');
    assert.strictEqual(h.engine.running(), false);
  } finally { r.restore(); }
});

test('v1.317 host: a host requested for an ALREADY-aborted view is never built (no observer, no listener, no light)', async () => {
  const r = realm({ pref: '1' });
  try {
    r.slot.appendChild(r.media);
    r.state.paused = false;
    r.ctl.abort();
    const c = r.row();
    const h = A.createAmbientHost({ glow: r.glow, check: c.check, row: c.row, getMedia: () => r.media, getMediaData: () => ({ type: 'audio', artUrl: '/albumart/t1' }), mediaId: null, signal: r.ctl.signal });
    await settleN();
    assert.strictEqual(h, null);
    assert.strictEqual(r.observers.length, 0, 'no observer was created');
    assert.strictEqual(r.anyLit(), false, 'nothing lit');
    assert.deepStrictEqual(r.loads, [], 'nothing loaded');
  } finally { r.restore(); }
});

test('v1.317 host: a media element that appears AFTER the host is bound on the first evaluate that finds it (a cold /music load)', async () => {
  const r = realm({ pref: '1' });
  try {
    const c = r.row();
    let media = null;
    const h = A.createAmbientHost({ glow: r.glow, check: c.check, row: c.row, getMedia: () => media, getMediaData: () => ({ type: 'audio', artUrl: '/albumart/t1' }), mediaId: null, signal: r.ctl.signal });
    assert.strictEqual(r.bound.filter((b) => b.target === r.media).length, 0, 'nothing to bind yet');
    media = r.media; r.slot.appendChild(r.media);
    h.evaluate(); // the view's mount seam
    assert.strictEqual(r.bound.filter((b) => b.target === r.media).length, 5, 'bound at the seam');
    h.evaluate();
    assert.strictEqual(r.bound.filter((b) => b.target === r.media).length, 5, 'bound ONCE (a second seam adds nothing)');
    r.play(); await settleN(); // the element's own event now drives it
    assert.ok(r.lit() && r.painted(), 'the playing event lit it');
    assert.deepStrictEqual(r.loads, ['/albumart/t1'], 'the art-only shape: the artUrl is the image (no id in play)');
  } finally { r.restore(); }
});

test('v1.317 host: the `observe` element re-evaluates on a childList change (music: the player moving into / out of the slot)', async () => {
  const r = realm({ pref: '1' });
  try {
    const c = r.row();
    r.slot.appendChild(r.media);
    r.state.paused = false;
    A.createAmbientHost({
      glow: r.glow, check: c.check, row: c.row, getMedia: () => r.media,
      getMediaData: () => ({ type: 'audio', artUrl: '/albumart/t1' }), mediaId: null,
      canRun: () => r.slot.contains(r.media), observe: r.slot, signal: r.ctl.signal,
    });
    await settleN();
    assert.ok(r.lit(), 'precondition: mounted in the slot and playing -> lit');
    r.dock.appendChild(r.media); // the player docks: no media event fires, only the DOM move
    await settleN();
    assert.strictEqual(r.anyLit(), false, 'the slot observer caught the dock and cleared the glow');
    r.slot.appendChild(r.media); // expand again
    await settleN();
    assert.ok(r.lit(), 'and re-lit on the way back');
  } finally { r.restore(); }
});

test('v1.317 ensureAmbientToggleRow: the ONE writer - null without a cog menu, injects once, every later call reuses the same row', () => {
  const r = realm();
  try {
    const menu = r.D.getElementById('settings-menu');
    menu.remove();
    assert.strictEqual(A.ensureAmbientToggleRow(r.D), null, 'no host (no cog menu) yet -> null, nothing written');
    r.D.body.insertAdjacentHTML('afterbegin', '<div id="settings-menu"></div>');
    const a = A.ensureAmbientToggleRow(r.D);
    const b = A.ensureAmbientToggleRow(r.D);
    assert.ok(a && a.check && a.row);
    assert.strictEqual(a.check, b.check, 'the same checkbox');
    assert.strictEqual(r.D.querySelectorAll('#watch-ambient-check').length, 1, 'exactly one row');
    assert.strictEqual(a.row.getAttribute('for'), 'watch-ambient-check');
    assert.strictEqual(a.row.parentNode.id, 'settings-menu', 'inside the cog menu');
  } finally { r.restore(); }
});

test('v1.317 ambientSameOriginUrl: only a same-origin URL may be sampled (a tainted canvas hard-fails the engine)', () => {
  const O = 'http://localhost:3000';
  assert.strictEqual(A.ambientSameOriginUrl('/albumart/t1', O), '/albumart/t1');
  assert.strictEqual(A.ambientSameOriginUrl('/thumbnail/abc%3A%3Ac1', O), '/thumbnail/abc%3A%3Ac1');
  assert.strictEqual(A.ambientSameOriginUrl('http://localhost:3000/albumart/t1', O), 'http://localhost:3000/albumart/t1', 'an absolute SAME-origin URL passes');
  for (const bad of ['https://evil.example/x.jpg', '//evil.example/x.jpg', '/\\evil.example/x.jpg', 'data:image/png;base64,AAAA', 'http://localhost:3001/x.jpg', 'javascript:alert(1)', '', null, undefined, 42]) {
    assert.strictEqual(A.ambientSameOriginUrl(bad, O), '', 'refused: ' + String(bad));
  }
  assert.strictEqual(A.ambientSameOriginUrl('/albumart/t1', ''), '', 'no origin to compare against (no location) -> refused, fail closed');
});
