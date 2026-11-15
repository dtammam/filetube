'use strict';

// [UNIT] v1.408.0 W3 - Hold's stages (plan docs/exec-plans/completed/2026-11-15-ipod-hold-switch.md, Dean's R4 "C"): Hold on keeps the
// phone awake; HOLD_DIM_MS with no touch dims and freezes the player (no motion, the screen written once a HOLD_TICK_MS);
// HOLD_SLEEP_MS with no touch lets the phone lock; a touch wakes back to stage 1. Through the REAL skin engine with the real
// pocket lighting and Pocket menus on a fake clock, the Screen Wake Lock stubbed the way the spec shapes it (a promise of a
// sentinel with release() and a 'release' event). The cover drift's freeze rides the real music view: pocket-idle-art.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const lightPath = require.resolve('../../public/js/pocket-lighting.js');
const SS = require(surfacePath);
const L = require(lightPath);

const HTML = `<body><video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" /><div id="panel" class="music-nowplaying-panel" hidden></div></body>`;

function fakeClock(win) {
  let now = 0; let seq = 0; const q = new Map();
  win.setTimeout = (fn, ms) => { seq += 1; q.set(seq, { at: now + (Number(ms) || 0), fn }); return seq; };
  win.clearTimeout = (id) => { q.delete(id); };
  win.setInterval = (fn, ms) => { seq += 1; q.set(seq, { at: now + ms, fn, every: ms }); return seq; };
  win.clearInterval = (id) => { q.delete(id); };
  win.requestAnimationFrame = (fn) => win.setTimeout(() => fn(now), 16);
  win.cancelAnimationFrame = (id) => win.clearTimeout(id);
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of q) if (t.at <= end && (!next || t.at < next.t.at)) next = { id, t };
      if (!next) break;
      now = next.t.at;
      if (next.t.every) next.t.at += next.t.every; else q.delete(next.id);
      next.t.fn();
    }
    now = end;
  }
  return { advance, now: () => now, live: () => q.size, intervals: () => [...q.values()].filter((t) => t.every).length };
}
function wakeLockStub(win, { auto = true } = {}) {
  const s = { requests: 0, held: [], resolvers: [] };
  Object.defineProperty(win.navigator, 'wakeLock', { configurable: true, value: { request(type) {
    s.requests += 1;
    const sentinel = { type, released: false, fns: [],
      release() { if (!this.released) { this.released = true; s.held = s.held.filter((x) => x !== this); this.fns.forEach((f) => f()); } return Promise.resolve(); },
      addEventListener(t, f) { if (t === 'release') this.fns.push(f); } };
    s.held.push(sentinel);
    if (auto) return Promise.resolve(sentinel);
    return new Promise((r) => { s.resolvers.push(() => r(sentinel)); });
  } } });
  return s;
}
const flush = () => new Promise((r) => setImmediate(r));

function boot({ lock = true, auto = true, strength = 'pronounced', sticker = false } = {}) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music', pretendToBeVisual: true });
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  const win = dom.window;
  const clock = fakeClock(win);
  win.matchMedia = (q) => ({ matches: /pointer: fine/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  const wl = lock ? wakeLockStub(win, { auto }) : null;
  let hidden = false;
  Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => hidden });
  const store = new Map(); const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  ls.setItem(L.KEY, strength);
  delete require.cache[skinsPath]; delete require.cache[surfacePath]; delete require.cache[lightPath];
  global.module = undefined;
  win.FileTubeMusicSkins = require(skinsPath);
  win.FileTubePocketLighting = require(lightPath);
  require(surfacePath);
  const mp = win.document.getElementById('media-player');
  const media = { t: 10, d: 200 };
  Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => media.t, set: (v) => { media.t = v; } });
  Object.defineProperty(mp, 'duration', { configurable: true, get: () => media.d });
  Object.defineProperty(mp, 'paused', { configurable: true, get: () => false });
  const panel = win.document.getElementById('panel');
  const engine = win.FileTubeSkinSurface.create({ panel, win, getSkinId: () => 'ipod',
    getCtx: () => ({ track: { title: 'T', artist: 'A' }, upNext: [], fullList: [], playing: true, posLabel: '0:10', remLabel: '-3:10' }),
    hostCtl: (id) => win.document.getElementById(id), lightingStore: ls, lightingNow: clock.now,
    sticker: sticker ? { onSkinChange() {} } : undefined,
    menu: { load: () => Promise.resolve({ items: [] }), onPlay() {}, onShuffleAll() {}, hasCurrent: () => true, currentId: () => 'now', dataVersion: () => 0 } });
  engine.paint();
  const setHidden = (h) => { hidden = h; if (h && wl) wl.held.slice().forEach((x) => x.release()); win.document.dispatchEvent(new win.Event('visibilitychange')); };
  return { dom, win, panel, engine, clock, wl, media, setHidden, restore: () => { try { engine.destroy(); } catch (_) { /* gone */ } Object.assign(global, saved); } };
}
const dimmed = (b) => b.panel.classList.contains('mms-hold-dim');
const fillW = (b) => b.panel.querySelector('.mms-fill').style.width;
function touchElsewhere(b) {
  const e = new b.win.MouseEvent('pointerdown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'pointerId', { value: 9 });
  b.panel.querySelector('.ip-wheel').dispatchEvent(e);
  return e;
}

test('the constants (R4): 30 s to the dim, 5 min to letting the phone lock, a 1 s screen; one stage per timer', () => {
  assert.strictEqual(SS.HOLD_DIM_MS, 30000);
  assert.strictEqual(SS.HOLD_SLEEP_MS, 300000);
  assert.strictEqual(SS.HOLD_TICK_MS, 1000);
  assert.strictEqual(SS.holdStageWait(1), 30000);
  assert.strictEqual(SS.holdStageWait(2), 270000);
  assert.strictEqual(SS.holdStageWait(3), null, 'stage 3 waits for a touch');
  assert.strictEqual(SS.holdStageWait(0), null);
});

test('stage 1 keeps the phone awake; 30 s with no touch dims (still awake); 5 min lets it lock - Hold stays on throughout', async () => {
  const b = boot();
  try {
    assert.strictEqual(b.engine.holdStage(), 0); assert.strictEqual(b.wl.requests, 0, 'no wake lock before Hold');
    b.engine.setHold(true); await flush();
    assert.strictEqual(b.engine.holdStage(), 1);
    assert.strictEqual(b.wl.requests, 1); assert.strictEqual(b.wl.held.length, 1, 'awake: the wake lock is held');
    assert.ok(!dimmed(b));
    b.clock.advance(29999);
    assert.strictEqual(b.engine.holdStage(), 1, 'not yet');
    b.clock.advance(1);
    assert.strictEqual(b.engine.holdStage(), 2, '30 s: the dimmed stage');
    assert.ok(dimmed(b)); assert.strictEqual(b.wl.held.length, 1, 'still kept awake');
    b.clock.advance(270000 - 1);
    assert.strictEqual(b.engine.holdStage(), 2);
    b.clock.advance(1);
    assert.strictEqual(b.engine.holdStage(), 3, '5 min: the phone may lock');
    assert.strictEqual(b.wl.held.length, 0, 'the wake lock is let go');
    assert.ok(dimmed(b), 'still dimmed'); assert.ok(b.engine.isHold(), 'Hold stays on');
    b.clock.advance(3600000);
    assert.strictEqual(b.engine.holdStage(), 3, 'nothing after stage 3');
  } finally { b.restore(); }
});

test('a touch elsewhere wakes: full brightness, the clock starts again, the wake lock comes back after stage 3; it does nothing else', async () => {
  const b = boot();
  try {
    b.engine.setHold(true); await flush();
    b.clock.advance(30000); assert.strictEqual(b.engine.holdStage(), 2);
    const e = touchElsewhere(b);
    assert.ok(e.defaultPrevented, 'the touch itself is still swallowed');
    assert.strictEqual(b.engine.holdStage(), 1); assert.ok(!dimmed(b), 'awake');
    b.clock.advance(29999); assert.strictEqual(b.engine.holdStage(), 1, 'the 30 s start again from the touch');
    b.clock.advance(1); assert.strictEqual(b.engine.holdStage(), 2);
    b.clock.advance(270000); assert.strictEqual(b.engine.holdStage(), 3); assert.strictEqual(b.wl.held.length, 0);
    touchElsewhere(b); await flush();
    assert.strictEqual(b.engine.holdStage(), 1); assert.strictEqual(b.wl.held.length, 1, 'kept awake again');
    // a key wakes too, and a press on the switch
    b.clock.advance(30000); assert.strictEqual(b.engine.holdStage(), 2);
    b.win.document.body.dispatchEvent(new b.win.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    assert.strictEqual(b.engine.holdStage(), 1, 'a key wakes');
    b.clock.advance(30000);
    const sw = b.panel.querySelector('[data-skin-hold]');
    const p = new b.win.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 5 }); Object.defineProperty(p, 'pointerId', { value: 4 });
    sw.dispatchEvent(p);
    assert.strictEqual(b.engine.holdStage(), 1, 'a press on the switch wakes');
  } finally { b.restore(); }
});

test('Hold off from any stage: everything back - no dim, no wake lock, no timer, no tick', async () => {
  for (const at of [0, 30000, 300000]) {
    const b = boot();
    try {
      b.clock.advance(1000); // the paint's own settle timers run out first
      const live0 = b.clock.live();
      b.engine.setHold(true); await flush();
      b.clock.advance(at);
      b.engine.setHold(false);
      assert.strictEqual(b.engine.holdStage(), 0, 'at ' + at);
      assert.strictEqual(b.clock.live(), live0, 'no stage timer or tick left pending (at ' + at + ')');
      assert.ok(!dimmed(b)); assert.strictEqual(b.wl.held.length, 0, 'the wake lock is gone at ' + at);
      assert.strictEqual(b.clock.intervals(), 0, 'the 1 s tick stopped at ' + at);
      b.clock.advance(600000);
      assert.ok(!dimmed(b), 'no timer dims it later (at ' + at + ')');
    } finally { b.restore(); }
  }
});

test('the wake lock asked for and let go before it arrives is released as it lands (the request is a promise)', async () => {
  const b = boot({ auto: false });
  try {
    b.engine.setHold(true);
    assert.strictEqual(b.wl.requests, 1);
    b.engine.setHold(false); // before the grant
    b.wl.resolvers.forEach((r) => r()); await flush(); await flush();
    assert.strictEqual(b.wl.held.length, 0, 'the late sentinel was released');
    b.engine.setHold(true);
    assert.strictEqual(b.wl.requests, 2, 'a new Hold asks again (the pending one is over)');
    b.wl.resolvers.slice(1).forEach((r) => r()); await flush(); await flush();
    assert.strictEqual(b.wl.held.length, 1, 'and keeps that one');
    // a surface destroyed while a grant is in flight lets it go too
    b.engine.setHold(false); b.engine.setHold(true);
    b.engine.destroy();
    b.wl.resolvers.slice(2).forEach((r) => r()); await flush(); await flush();
    assert.strictEqual(b.wl.held.length, 0, 'destroyed mid-grant: released');
  } finally { b.restore(); }
});

test('the page hidden (the browser drops the wake lock) and back: Hold wakes to stage 1 and asks again; a hidden page never asks', async () => {
  const b = boot();
  try {
    b.engine.setHold(true); await flush();
    b.clock.advance(30000); assert.strictEqual(b.engine.holdStage(), 2);
    b.setHidden(true);
    assert.strictEqual(b.wl.held.length, 0, 'the browser released it');
    touchElsewhere(b); await flush();
    assert.strictEqual(b.wl.requests, 1, 'no request while hidden');
    b.setHidden(false); await flush();
    assert.strictEqual(b.engine.holdStage(), 1, 'back: full brightness');
    assert.strictEqual(b.wl.requests, 2); assert.strictEqual(b.wl.held.length, 1, 'kept awake again');
    b.engine.setHold(false);
    b.setHidden(true); b.setHidden(false); await flush();
    assert.strictEqual(b.wl.requests, 2, 'Hold off: the return asks nothing');
  } finally { b.restore(); }
});

test('without the Wake Lock API (an older iPhone, a desktop): the stages run the same and nothing throws', async () => {
  const b = boot({ lock: false });
  try {
    b.engine.setHold(true); await flush();
    b.clock.advance(30000); assert.strictEqual(b.engine.holdStage(), 2);
    b.clock.advance(270000); assert.strictEqual(b.engine.holdStage(), 3);
    touchElsewhere(b); assert.strictEqual(b.engine.holdStage(), 1);
  } finally { b.restore(); }
});

test('the dimmed screen is written once a second by its own tick; the view\'s faster calls write nothing; waking catches up at once', async () => {
  const b = boot();
  try {
    b.engine.reflect();
    assert.strictEqual(fillW(b), '5%', 'precondition: 10 s of 200 s');
    b.engine.setHold(true); await flush();
    b.clock.advance(30000); assert.strictEqual(b.engine.holdStage(), 2);
    b.media.t = 40;
    for (let i = 0; i < 4; i++) b.engine.reflect(); // timeupdate, about 4 a second
    assert.strictEqual(fillW(b), '5%', 'the view\'s calls write nothing under the dim');
    b.clock.advance(999); assert.strictEqual(fillW(b), '5%');
    b.clock.advance(1); assert.strictEqual(fillW(b), '20%', 'the 1 s tick writes it');
    b.media.t = 60;
    b.clock.advance(1000); assert.strictEqual(fillW(b), '30%', 'and the next second');
    b.media.t = 80;
    touchElsewhere(b);
    assert.strictEqual(fillW(b), '40%', 'a wake catches up at once');
    b.media.t = 90; b.engine.reflect();
    assert.strictEqual(fillW(b), '45%', 'awake: the view writes it again');
    assert.strictEqual(b.clock.intervals(), 0, 'no tick while awake');
  } finally { b.restore(); }
});

test('the light freezes under the dim: the running loop ends, and no tilt sample starts one; a wake moves it again', async () => {
  const b = boot();
  try {
    b.panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 800 }); // jsdom lays nothing out (pocket-lighting.test.js does the same)
    // the tilt sensor is not an input Hold swallows: its samples keep coming under Hold and under the dim
    const tilt = (beta, gamma) => { const e = new b.win.Event('deviceorientation'); Object.defineProperty(e, 'beta', { value: beta }); Object.defineProperty(e, 'gamma', { value: gamma }); b.win.dispatchEvent(e); };
    b.engine.setHold(true); await flush();
    // awake under Hold, tilting all the way to the dim: the loop is live (a frame queued) the moment the dim lands
    for (let t = 0; t < 30000; t += 100) { tilt(30 + (t % 3000) / 100, (t % 2000) / 100); b.clock.advance(100); }
    assert.strictEqual(b.engine.holdStage(), 2, 'the dim landed');
    const w1 = b.engine.lightingState().writes;
    assert.ok(w1 > 0, 'precondition: the light was moving');
    b.clock.advance(3000);
    assert.strictEqual(b.engine.lightingState().writes, w1, 'the loop that was running ended (no write after the dim)');
    assert.strictEqual(b.engine.lightingState().raf, false, 'and none is queued');
    for (let i = 0; i < 10; i++) {
      tilt(70 - i * 4, 40 - i * 4);
      assert.strictEqual(b.engine.lightingState().raf, false, 'a sample under the dim queues no frame (' + i + ')');
      b.clock.advance(250);
    }
    assert.strictEqual(b.engine.lightingState().writes, w1, 'nothing written for the whole dim');
    touchElsewhere(b); // awake (stage 1): the next sample moves the light again
    for (let i = 0; i < 10; i++) { tilt(20 + i * 5, -10 - i * 3); b.clock.advance(50); }
    assert.ok(b.engine.lightingState().writes > w1, 'awake: the light follows the phone again');
  } finally { b.restore(); }
});

test('the dim layer: drawn last by the renderer, shown only under the dimmed stage, fading by opacity; every animation and transition under it stops', () => {
  const { readStyleCss, readTokensCss, cssRules } = require('../helpers/stylesheets.js');
  const rules = cssRules(readStyleCss());
  const P = ':where(html.is-phone) .mms-full.mms-ipod';
  const by = (sel) => rules.filter((r) => !r.at && r.sel.trim() === sel);
  assert.match(by('.mms-ipod .ip-dim')[0].body, /display:none/);
  const base = by(P + ' .ip-dim')[0].body;
  for (const want of ['position:absolute', 'inset:0', 'background:var(--pk-hold-dim)', 'z-index:var(--pk-hold-dim-z)', 'pointer-events:none', 'opacity:0', 'visibility:hidden']) assert.ok(base.includes(want), want);
  assert.match(by(P + '.mms-hold-dim .ip-dim')[0].body, /opacity:1; visibility:visible;/);
  const freeze = rules.find((r) => !r.at && r.sel.includes(P + '.mms-hold-dim :not(.ip-dim)'));
  assert.ok(freeze && /animation-play-state:paused/.test(freeze.body) && /transition:none/.test(freeze.body), 'the freeze');
  assert.ok(freeze.sel.includes('*::before') && freeze.sel.includes('*::after'), 'pseudo-elements too (the lit sheen, the wheel ring)');
  // the dim sits over EVERY local layer the player draws: every numeric z-index on a player rule (derived from the sheet, so a
  // new layer joins the census) is under it (the sticker, 40, is injected AFTER the dim, so an equal z would paint it over)
  const dimZ = Number((/--pk-hold-dim-z:\s*(\d+);/.exec(readTokensCss()) || [])[1]);
  const player = rules.filter((r) => /\.(mms-|ip-|ipm-|ipod-brick)/.test(r.sel) && /z-index:\s*\d+/.test(r.body));
  assert.ok(player.length >= 6, 'the census reaches the player layers (' + player.length + ')');
  const top = Math.max(...player.filter((r) => !/\.mms-full\{|\.mms-full\s*$/.test(r.sel.trim()) && !/--z-/.test(r.body)).map((r) => Number(/z-index:\s*(\d+)/.exec(r.body)[1])));
  assert.ok(dimZ >= top && dimZ <= 40, 'the dim (' + dimZ + ') at the top of the local band, never under a player layer (' + top + ')');
  const atTop = player.filter((r) => Number(/z-index:\s*(\d+)/.exec(r.body)[1]) === dimZ).map((r) => r.sel.trim());
  assert.deepStrictEqual(atTop, [':where(html.is-phone, html.mms-popout) .mms-sticker-wrap'], 'the one layer sharing its z is the sticker, which the engine inserts BEFORE the dim (bound in the next test)');
  const SK = require(skinsPath);
  for (const id of SK.clickColorways()) assert.ok(SK.renderFull(id, {}).endsWith('<span class="ip-dim" aria-hidden="true"></span>'), id);
});

test('a repaint under the dim keeps the dim (gate r1 qa W1: every track change repainted it away)', async () => {
  const b = boot();
  try {
    b.engine.setHold(true); await flush();
    b.clock.advance(30000); assert.ok(dimmed(b));
    b.engine.paint(); // a track change, an autoplay append, a chapter cross
    assert.ok(dimmed(b), 'still dimmed after the repaint');
    assert.ok(b.panel.classList.contains('mms-hold'));
    touchElsewhere(b);
    b.engine.paint();
    assert.ok(!dimmed(b), 'awake: a repaint brings no dim back');
  } finally { b.restore(); }
});

test('the sticker is inserted BEFORE the dim layer, so the dim (the same local z) covers it by DOM order', () => {
  const b = boot({ sticker: true });
  try {
    const wrap = b.panel.querySelector('.mms-sticker-wrap'); const dim = b.panel.querySelector('.ip-dim');
    assert.ok(wrap && dim, 'precondition: both are drawn');
    assert.ok(wrap.compareDocumentPosition(dim) & b.win.Node.DOCUMENT_POSITION_FOLLOWING, 'the dim follows the sticker');
    b.engine.paint();
    const wrap2 = b.panel.querySelector('.mms-sticker-wrap'); const dim2 = b.panel.querySelector('.ip-dim');
    assert.ok(wrap2.compareDocumentPosition(dim2) & b.win.Node.DOCUMENT_POSITION_FOLLOWING, 'after a repaint too');
  } finally { b.restore(); }
});

test('the dim tells the page (filetube:hold-dim) so the player\'s own frame loop slows to once a second (player.js; measured in Chromium by the probe)', async () => {
  const b = boot();
  try {
    const seen = [];
    b.win.document.addEventListener('filetube:hold-dim', (e) => seen.push(e.detail.on));
    b.engine.setHold(true); await flush();
    b.clock.advance(30000);
    assert.deepStrictEqual(seen, [true], 'entering the dim');
    b.clock.advance(270000);
    assert.deepStrictEqual(seen, [true], 'stage 3 stays dimmed: nothing new');
    touchElsewhere(b);
    assert.deepStrictEqual(seen, [true, false], 'a wake ends it');
    b.clock.advance(30000); b.engine.setHold(false);
    assert.deepStrictEqual(seen, [true, false, true, false], 'Hold off from the dim ends it too');
  } finally { b.restore(); }
  // player.js's half (no jsdom harness exists for player.js: a SOURCE lock, comments stripped; the real-browser count is the probe's)
  const src = require('node:fs').readFileSync(require.resolve('../../public/js/player.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(src, /if \(holdDimmed\) seekFillTimer = setTimeout\(fillTick, HOLD_FILL_MS\);\s*else seekFillRafId = requestAnimationFrame\(fillTick\);/);
  assert.match(src, /document\.addEventListener\('filetube:hold-dim', function \(e\) \{\s*holdDimmed = !!\(e && e\.detail && e\.detail\.on\);/);
  assert.match(src, /if \(seekFillTimer != null\) \{ clearTimeout\(seekFillTimer\); seekFillTimer = null; \}/, 'stopFillLoop clears the timer too');
  assert.match(src, /var HOLD_FILL_MS = 1000;/, 'once a second (gate r2 S6: 16 would be a frame loop again)');
  assert.match(src, /if \(!holdDimmed && seekFillTimer != null\) \{ clearTimeout\(seekFillTimer\); seekFillTimer = null; startFillLoop\(\); \}/, 'the wake hands the timer back to the frame loop at once (gate r2 S6)');
});
