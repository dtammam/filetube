'use strict';

// [UNIT] v1.408.0 W4 - idleDisplay (plan docs/exec-plans/completed/2026-11-15-ipod-hold-switch.md; docs/references/native-bridge.md): Hold's
// stages told to a host that can really keep the phone awake and really dim it. Through the REAL skin engine and the REAL adapter
// with a FAKE host on a fake clock; a tiny host model replays the posts ("what native holds now"). The web owns the clock: the
// host is told display.hold (stages 1-2) and display.dim (stages 2-3), each only on a change; released on close, Hold off,
// destroy and pagehide; re-sent on a persisted pageshow; nothing at all without the capability or without a host.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { installFakeHost, loadAdapter } = require('../helpers/fake-host');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');

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
  return { advance(ms) { const end = now + ms; for (;;) { let n = null; for (const [id, t] of q) if (t.at <= end && (!n || t.at < n.t.at)) n = { id, t }; if (!n) break; now = n.t.at; if (n.t.every) n.t.at += n.t.every; else q.delete(n.id); n.t.fn(); } now = end; } };
}

function boot(o = {}) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music', pretendToBeVisual: true, runScripts: 'outside-only' });
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  const win = dom.window;
  const clock = fakeClock(win);
  win.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const fake = o.host === null ? null : installFakeHost(win, { capabilities: o.caps || ['idleDisplay'] });
  loadAdapter(win);
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  win.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const panel = win.document.getElementById('panel');
  const engine = win.FileTubeSkinSurface.create({ panel, win, getSkinId: () => 'ipod',
    getCtx: () => ({ track: { title: 'T', artist: 'A' }, upNext: [], fullList: [], playing: true }), hostCtl: (id) => win.document.getElementById(id) });
  engine.paint();
  if (fake) fake.clear();
  return { dom, win, panel, engine, clock, fake, restore: () => { try { engine.destroy(); } catch (_) { /* gone */ } Object.assign(global, saved); try { win.close(); } catch (_) { /* gone */ } } };
}
// what the host holds now, replayed from the posts (+ a simulated release on a navigation commit)
function held(b) {
  const h = { hold: false, dim: false };
  for (const m of b.fake.posts) { if (m.type === 'display.hold') h.hold = m.on; if (m.type === 'display.dim') h.dim = m.on; }
  return h;
}
const disp = (b) => b.fake.posts.filter((m) => /^display\./.test(m.type)).map((m) => m.type + ':' + m.on);
const flush = () => new Promise((r) => setImmediate(r));
function touch(b) { const e = new b.win.MouseEvent('pointerdown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'pointerId', { value: 7 }); b.panel.querySelector('.ip-wheel').dispatchEvent(e); }

test('the stages, told to the host once each: hold on at Hold; dim at 30 s; hold off at 5 min (let iOS lock); a wake undims and holds again', () => {
  const b = boot();
  try {
    b.engine.setHold(true);
    assert.deepStrictEqual(disp(b), ['display.hold:true'], 'Hold on: keep the phone awake');
    b.clock.advance(30000);
    assert.deepStrictEqual(disp(b), ['display.hold:true', 'display.dim:true'], '30 s: dim (still awake)');
    b.clock.advance(270000);
    assert.deepStrictEqual(disp(b), ['display.hold:true', 'display.dim:true', 'display.hold:false'], '5 min: let iOS lock, still dimmed');
    touch(b);
    assert.deepStrictEqual(held(b), { hold: true, dim: false }, 'a wake: awake and bright');
    const n = disp(b).length;
    touch(b); touch(b); b.clock.advance(1000);
    assert.strictEqual(disp(b).length, n, 'only on a change: more touches in stage 1 post nothing');
    for (const m of b.fake.posts) assert.deepStrictEqual(Object.keys(m).sort(), ['on', 'type', 'v'], 'the contract shape');
  } finally { b.restore(); }
});

test('every way Hold ends releases the host: Hold off, the full player closing (no engine call), the surface destroyed, a pagehide for good', async () => {
  for (const end of ['off', 'close', 'destroy', 'pagehide']) {
    const b = boot();
    try {
      b.engine.setHold(true); b.clock.advance(30000);
      assert.deepStrictEqual(held(b), { hold: true, dim: true }, 'precondition: held and dimmed (' + end + ')');
      if (end === 'off') b.engine.setHold(false);
      if (end === 'close') { b.panel.hidden = true; await flush(); }
      if (end === 'destroy') b.engine.destroy();
      if (end === 'pagehide') b.win.dispatchEvent(new b.win.Event('pagehide'));
      assert.deepStrictEqual(held(b), { hold: false, dim: false }, end + ' releases both');
    } finally { b.restore(); }
  }
});

test('a page kept in the back-forward cache: pagehide releases (the host drops it all on the commit anyway), pageshow re-sends what Hold still wants', () => {
  const b = boot();
  try {
    b.engine.setHold(true); b.clock.advance(30000);
    const hide = new b.win.Event('pagehide'); Object.defineProperty(hide, 'persisted', { value: true });
    b.win.dispatchEvent(hide);
    assert.deepStrictEqual(held(b), { hold: false, dim: false }, 'released on the way out');
    assert.ok(b.engine.isHold(), 'Hold itself stays (the same session)');
    const show = new b.win.Event('pageshow'); Object.defineProperty(show, 'persisted', { value: true });
    b.win.dispatchEvent(show);
    assert.deepStrictEqual(held(b), { hold: true, dim: true }, 're-sent on the way back');
  } finally { b.restore(); }
});

test('the self-heal: a panel that leaves the page with no engine call is dropped within a second', () => {
  const b = boot();
  try {
    b.engine.setHold(true);
    assert.deepStrictEqual(held(b), { hold: true, dim: false });
    // the view empties and detaches the panel without destroy() (the v1.256 class); the observer cannot see a detach
    b.panel.remove();
    b.clock.advance(1000);
    assert.deepStrictEqual(held(b), { hold: false, dim: false }, 'the 1 s poll dropped the owner');
  } finally { b.restore(); }
});

test('no idleDisplay announced, or no host at all: nothing is posted, and Hold works the same', () => {
  for (const o of [{ caps: ['orientation', 'statusBar'] }, { host: null }]) {
    const b = boot(o);
    try {
      b.engine.setHold(true); b.clock.advance(300000);
      assert.strictEqual(b.engine.holdStage(), 3, 'the web\'s stages run');
      if (b.fake) assert.deepStrictEqual(disp(b), [], 'nothing reaches a host that did not announce idleDisplay');
      assert.strictEqual(b.win.FileTube.host.post('display.hold', { on: true }), false, 'the adapter refuses it too');
    } finally { b.restore(); }
  }
});

test('the adapter: display.hold / display.dim carry exactly a required boolean `on`', () => {
  const b = boot();
  try {
    const h = b.win.FileTube.host;
    assert.strictEqual(h.post('display.hold', { on: true }), true);
    assert.strictEqual(h.post('display.dim', { on: false, extra: 1 }), true);
    assert.strictEqual(h.post('display.hold', {}), false, 'on is required');
    assert.strictEqual(h.post('display.dim', { on: 'yes' }), false, 'on is a boolean');
    assert.deepStrictEqual(b.fake.posts.slice(-2), [{ v: 1, type: 'display.hold', on: true }, { v: 1, type: 'display.dim', on: false }], 'unknown fields never leave');
  } finally { b.restore(); }
});

test('a hide (the app resigned active: it turned the idle timer back on and restored the brightness) and the return: the web tells the host again (gate r1 adversary W1)', () => {
  for (const at of [0, 30000]) {
    const b = boot();
    try {
      let hidden = false;
      Object.defineProperty(b.win.document, 'hidden', { configurable: true, get: () => hidden });
      b.engine.setHold(true); b.clock.advance(at);
      const before = held(b);
      hidden = true; b.win.document.dispatchEvent(new b.win.Event('visibilitychange'));
      const n = b.fake.posts.length;
      hidden = false; b.win.document.dispatchEvent(new b.win.Event('visibilitychange'));
      const after = b.fake.posts.slice(n).filter((m) => /^display\./.test(m.type)).map((m) => m.type + ':' + m.on);
      assert.ok(after.includes('display.hold:true'), 'the return re-sends the keep-awake (stage ' + (at ? 2 : 1) + '): ' + after.join(','));
      assert.deepStrictEqual(held(b), { hold: true, dim: false }, 'awake and bright after the return (the web wakes on it); before: ' + JSON.stringify(before));
    } finally { b.restore(); }
  }
});

test('a hidden page tells the host nothing however long it stays hidden (the 1 s poll runs on under Hold\'s music); the return tells it both (gate r2, both seats)', () => {
  for (const at of [0, 30000]) {
    const b = boot();
    try {
      let hidden = false;
      Object.defineProperty(b.win.document, 'hidden', { configurable: true, get: () => hidden });
      b.engine.setHold(true); b.clock.advance(at);
      hidden = true; b.win.document.dispatchEvent(new b.win.Event('visibilitychange'));
      const n = b.fake.posts.length;
      b.clock.advance(5000); // the poll ticks five times, the stage clock runs on
      assert.deepStrictEqual(disp({ fake: { posts: b.fake.posts.slice(n) } }), [], 'nothing while hidden (stage ' + (at ? 2 : 1) + ')');
      hidden = false; b.win.document.dispatchEvent(new b.win.Event('visibilitychange'));
      const back = b.fake.posts.slice(n).map((m) => m.type + ':' + m.on);
      assert.deepStrictEqual(back.slice().sort(), ['display.dim:false', 'display.hold:true'], 'the return tells it BOTH: ' + back.join(','));
    } finally { b.restore(); }
  }
});

test('with nothing held, a hide and a return tell the host nothing (gate r2 S5)', () => {
  const b = boot();
  try {
    let hidden = false;
    Object.defineProperty(b.win.document, 'hidden', { configurable: true, get: () => hidden });
    b.engine.setHold(true); b.engine.setHold(false); // the page is bound; nothing is held now
    const n = b.fake.posts.length;
    hidden = true; b.win.document.dispatchEvent(new b.win.Event('visibilitychange'));
    hidden = false; b.win.document.dispatchEvent(new b.win.Event('visibilitychange'));
    b.clock.advance(2000);
    assert.deepStrictEqual(b.fake.posts.slice(n).map((m) => m.type), [], 'no re-send');
  } finally { b.restore(); }
});
