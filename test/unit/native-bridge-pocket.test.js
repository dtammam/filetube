'use strict';

// [UNIT] v1.384.0 (native bridge D5 + D8): Pocket's two host seams through the REAL skin engine (skin-surface.js) and the
// REAL adapter, with a FAKE host. D5: the full player locks the phone to portrait while it is up and EVERY exit unlocks
// it (hide, a class reset, destroy, the panel leaving the page with no engine call at all, pagehide), never while the
// per-device Sideways setting is on, never from a pop-out. D8: the real battery level drawn on the .mms-ipod panel, the
// subscription following the status bar's life, a bad event clamped. No host: nothing posted, nothing written.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { installFakeHost, loadAdapter } = require('../helpers/fake-host');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');

const HTML = `<body>
  <video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" />
  <div id="panel" class="music-nowplaying-panel" hidden></div>
  <div id="panel2" class="music-nowplaying-panel" hidden></div>
</body>`;

// A manual interval clock on the window (the 1 s self-heal poll): tick(ms) fires what is due.
function intervalClock(win) {
  const list = []; let now = 0;
  win.setInterval = (fn, ms) => { list.push({ fn, ms, next: now + ms, live: true }); return list.length; };
  win.clearInterval = (id) => { if (list[id - 1]) list[id - 1].live = false; };
  return {
    live: () => list.filter((t) => t.live).length,
    tick(ms) { const end = now + ms; for (;;) { const due = list.filter((t) => t.live && t.next <= end).sort((a, b) => a.next - b.next)[0]; if (!due) break; now = due.next; due.next += due.ms; due.fn(); } now = end; },
  };
}

// o.host: null | { capabilities }. o.sideways: the per-device setting on. o.popout: the panel lives in another document.
function boot(o = {}) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music', pretendToBeVisual: true, runScripts: 'outside-only' });
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  const win = dom.window;
  const clock = intervalClock(win);
  win.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  win.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  if (o.sideways) win.localStorage.setItem('ft-pocket-sideways', '1');
  const fake = o.host ? installFakeHost(win, o.host) : null;
  loadAdapter(win);
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  win.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const sdom = o.popout ? new JSDOM(HTML, { url: 'http://localhost/popout', pretendToBeVisual: true }) : dom;
  const make = (id, skin) => win.FileTubeSkinSurface.create({
    panel: sdom.window.document.getElementById(id), win: sdom.window,
    getSkinId: () => skin || 'ipod',
    getCtx: () => ({ track: { title: 'T', artist: 'A', artUrl: '' }, upNext: [], fullList: [], playing: true }),
    hostCtl: (cid) => win.document.getElementById(cid),
    onSelectIndex: () => {}, onDock: () => {},
  });
  const engine = make('panel');
  return { dom, win, sdom, fake, clock, engine, make, panel: sdom.window.document.getElementById('panel'), restore: () => { Object.assign(global, saved); try { win.close(); } catch (_) { /* gone */ } } };
}
const msgs = (b) => b.fake.types().filter((t) => /^orientation\./.test(t));
const flushMO = () => new Promise((r) => setImmediate(r)); // a MutationObserver callback is a microtask; one macrotask is plenty

// ---------------------------------------------------------------- D5
test('D5: opening the full player locks portrait once; docking it (hidden) unlocks - and a double exit adds no second unlock', async () => {
  const b = boot({ host: {} });
  try {
    b.fake.clear();
    b.engine.paint();
    assert.deepStrictEqual(b.fake.of('orientation.lock'), [{ v: 1, type: 'orientation.lock', orientation: 'portrait' }]);
    b.engine.paint(); b.engine.paint(); // repaints (a track change) never re-lock
    assert.strictEqual(b.fake.of('orientation.lock').length, 1);
    b.panel.hidden = true; // what music.js does when the player is docked
    await flushMO();
    assert.strictEqual(b.fake.of('orientation.unlock').length, 1, 'hidden = an exit');
    b.engine.destroy();
    b.clock.tick(5000);
    assert.strictEqual(b.fake.of('orientation.unlock').length, 1, 'a later destroy / poll never double-unlocks');
  } finally { b.restore(); }
});

test('D5: every exit unlocks - the class reset the view does, destroy, and the panel leaving the page with NO engine call', async () => {
  // 1. the view resets className (drops mms-full) and hides, without calling destroy (music.js updateNowPlayingPanel)
  let b = boot({ host: {} });
  try {
    b.engine.paint(); b.fake.clear();
    b.panel.className = 'music-nowplaying-panel'; b.panel.hidden = true; b.panel.innerHTML = '';
    await flushMO();
    assert.deepStrictEqual(msgs(b), ['orientation.unlock'], 'class reset');
  } finally { b.restore(); }
  // 2. destroy()
  b = boot({ host: {} });
  try {
    b.engine.paint(); b.fake.clear();
    b.engine.destroy();
    assert.deepStrictEqual(msgs(b), ['orientation.unlock'], 'destroy');
  } finally { b.restore(); }
  // 3. the SPA swaps the view: the panel is removed from the document, nothing calls the engine (a crash mid-view, a thrown render)
  b = boot({ host: {} });
  try {
    b.engine.paint(); b.fake.clear();
    assert.strictEqual(b.clock.live(), 1, 'the self-heal poll runs while locked');
    b.panel.remove();
    b.clock.tick(1000);
    assert.deepStrictEqual(msgs(b), ['orientation.unlock'], 'detached: the poll unlocks within a second');
    assert.strictEqual(b.clock.live(), 0, 'and the poll stops with nothing left to watch');
  } finally { b.restore(); }
});

test('D5: pagehide unlocks (the phone leaves the page); pageshow re-locks while Pocket is still up', () => {
  const b = boot({ host: {} });
  try {
    b.engine.paint(); b.fake.clear();
    b.win.dispatchEvent(new b.win.Event('pagehide'));
    assert.deepStrictEqual(msgs(b), ['orientation.unlock']);
    b.win.dispatchEvent(new b.win.Event('pageshow'));
    assert.deepStrictEqual(msgs(b), ['orientation.unlock', 'orientation.lock'], 'back from the bfcache with Pocket open: locked again');
  } finally { b.restore(); }
});

test('D5: Sideways ON never locks; turning it on while Pocket is up unlocks within a second; off again re-locks', () => {
  let b = boot({ host: {}, sideways: true });
  try {
    b.engine.paint();
    assert.deepStrictEqual(msgs(b), [], 'Sideways on: not a single orientation message');
  } finally { b.restore(); }
  b = boot({ host: {} });
  try {
    b.engine.paint(); b.fake.clear();
    b.win.FileTubeMusicSkins.setPocketSideways(true, b.win);
    b.clock.tick(1000);
    assert.deepStrictEqual(msgs(b), ['orientation.unlock']);
    b.win.FileTubeMusicSkins.setPocketSideways(false, b.win);
    b.clock.tick(1000);
    assert.deepStrictEqual(msgs(b), ['orientation.unlock', 'orientation.lock']);
  } finally { b.restore(); }
});

test('D5: two engines (music + a second surface): locked while ANY shows, unlocked when the last one leaves', async () => {
  const b = boot({ host: {} });
  try {
    const second = b.make('panel2');
    b.engine.paint(); second.paint();
    assert.strictEqual(b.fake.of('orientation.lock').length, 1, 'one phone, one lock');
    b.fake.clear();
    b.panel.hidden = true; await flushMO();
    assert.deepStrictEqual(msgs(b), [], 'the other surface still shows: stay locked');
    b.sdom.window.document.getElementById('panel2').hidden = true; await flushMO();
    assert.deepStrictEqual(msgs(b), ['orientation.unlock']);
  } finally { b.restore(); }
});

test('D5: a pop-out surface (another document) never locks; a host without `orientation` never gets a message', () => {
  let b = boot({ host: {}, popout: true });
  try { b.engine.paint(); assert.deepStrictEqual(msgs(b), []); } finally { b.restore(); }
  b = boot({ host: { capabilities: ['haptics'] } });
  try { b.engine.paint(); assert.deepStrictEqual(msgs(b), [], 'capability not announced'); } finally { b.restore(); }
});

test('D5: no host - nothing is posted, no timer, no observer (the browser path is untouched)', () => {
  const b = boot({ host: null });
  try {
    b.engine.paint();
    assert.strictEqual(b.clock.live(), 0, 'no self-heal poll without a host');
    b.panel.hidden = true; b.engine.destroy();
    assert.strictEqual(b.win.FileTube.host.present, false);
  } finally { b.restore(); }
});

// ---------------------------------------------------------------- D8
const level = (b) => b.panel.style.getPropertyValue('--pk-batt-level');

test('D8: subscribe when the status bar shows; the level lands on the .mms-ipod PANEL as a whole percent; unsubscribe when it goes', async () => {
  const b = boot({ host: {} });
  try {
    b.fake.clear();
    b.engine.paint();
    assert.ok(b.panel.classList.contains('mms-ipod'), 'precondition: the Click panel wears .mms-ipod (style.css declares --pk-batt-level on it)');
    assert.ok(b.panel.querySelector('.ip-batt'), 'precondition: the status bar has a battery');
    assert.deepStrictEqual(b.fake.of('battery.subscribe'), [{ v: 1, type: 'battery.subscribe' }]);
    assert.strictEqual(level(b), '', 'nothing drawn until the host reports');
    b.fake.emit({ v: 1, type: 'battery', level: 0.4249, state: 'unplugged' });
    assert.strictEqual(level(b), '42%');
    assert.strictEqual(b.win.document.documentElement.style.getPropertyValue('--pk-batt-level'), '', 'not on html (the panel declares its own and beats it)');
    assert.strictEqual(b.panel.querySelector('.ip-batt i').style.getPropertyValue('--pk-batt-level'), '', 'not on .ip-batt i (ipScreen rebuilds it)');
    b.engine.paint(); // a repaint rebuilds the status bar: the level is re-applied, no second subscribe
    assert.strictEqual(level(b), '42%');
    assert.strictEqual(b.fake.of('battery.subscribe').length, 1);
    b.fake.emit({ v: 1, type: 'battery', level: null, state: 'unknown' });
    assert.strictEqual(level(b), '', 'unknown: today\'s drawing (the static value) comes back');
    b.fake.emit({ v: 1, type: 'battery', level: 1, state: 'full' });
    assert.strictEqual(level(b), '100%');
    b.panel.hidden = true; await flushMO();
    assert.strictEqual(b.fake.of('battery.unsubscribe').length, 1);
    b.fake.emit({ v: 1, type: 'battery', level: 0.1, state: 'unplugged' });
    assert.strictEqual(level(b), '100%', 'unsubscribed: later events are ignored');
  } finally { b.restore(); }
});

test('D8: a hostile or buggy event is data - out-of-range / wrong-typed levels draw nothing new (the adapter drops them) and never throw', () => {
  const b = boot({ host: {} });
  try {
    b.engine.paint();
    b.fake.emit({ v: 1, type: 'battery', level: 0.5, state: 'full' });
    for (const bad of [{ level: 9, state: 'full' }, { level: -3, state: 'full' }, { level: '0.1', state: 'full' }, { level: Infinity, state: 'full' }, { level: 0.2 }]) {
      b.fake.emit(Object.assign({ v: 1, type: 'battery' }, bad));
    }
    assert.strictEqual(level(b), '50%');
  } finally { b.restore(); }
});

test('D8: a skin without a status-bar battery never subscribes; a host without `battery` posts nothing; no host writes nothing', () => {
  let b = boot({ host: {} });
  try {
    b.fake.clear();
    const e = b.make('panel2', 'cider');
    e.paint();
    assert.deepStrictEqual(b.fake.of('battery.subscribe'), [], 'the Cider skin has no .ip-batt');
  } finally { b.restore(); }
  b = boot({ host: { capabilities: ['haptics'] } });
  try { b.engine.paint(); assert.deepStrictEqual(b.fake.of('battery.subscribe'), []); } finally { b.restore(); }
  b = boot({ host: null });
  try { b.engine.paint(); assert.strictEqual(level(b), ''); assert.strictEqual(b.panel.getAttribute('style'), null, 'no inline style at all'); } finally { b.restore(); }
});

test('D8: destroy unsubscribes', () => {
  const b = boot({ host: {} });
  try {
    b.engine.paint(); b.fake.clear();
    b.engine.destroy();
    assert.deepStrictEqual(b.fake.of('battery.unsubscribe').length, 1);
  } finally { b.restore(); }
});
