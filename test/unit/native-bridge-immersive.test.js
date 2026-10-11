'use strict';

// [UNIT] v1.385.0 (immersive Pocket, D2-D5): the status bar owner, Pocket's own clock + connection mark, the one shared
// network subscription and the swipe-back re-assert, through the REAL skin engine and the REAL adapter with a FAKE host.
// A tiny host model replays the posts: it is "released" by a simulated main-frame commit, exactly what the app does.

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

// What the native side holds right now, replayed from the posts (+ a simulated release on a navigation commit).
function held(b) {
  const h = { orientation: false, statusBar: false, battery: 0, network: 0 };
  for (const t of b.fake.types()) {
    if (t === 'orientation.lock') h.orientation = true; else if (t === 'orientation.unlock') h.orientation = false;
    else if (t === 'statusBar.hide') h.statusBar = true; else if (t === 'statusBar.show') h.statusBar = false;
    else if (t === 'battery.subscribe') h.battery++; else if (t === 'battery.unsubscribe') h.battery = Math.max(0, h.battery - 1);
    else if (t === 'network.subscribe') h.network++; else if (t === 'network.unsubscribe') h.network = Math.max(0, h.network - 1);
  }
  return h;
}
const ALL = { capabilities: ['orientation', 'haptics', 'battery', 'serverSettings', 'statusBar', 'network'] };
const sb = (b) => b.fake.types().filter((t) => /^statusBar\./.test(t));
const nw = (b) => b.fake.types().filter((t) => /^network\./.test(t));
const rt = (b) => b.panel.querySelector('.ip-status-rt');
const flushMO = () => new Promise((r) => setImmediate(r));
const net = (b, detail) => b.fake.emit(Object.assign({ v: 1, type: 'network' }, detail));

test('D2: the full player hides the status bar once; every exit shows it; Sideways does not block it; the pop-out never hides it', async () => {
  let b = boot({ host: ALL });
  try {
    b.fake.clear(); b.engine.paint(); b.engine.paint(); b.engine.paint();
    assert.deepStrictEqual(sb(b), ['statusBar.hide'], 'repaints never re-hide');
    b.panel.hidden = true; await flushMO();
    assert.deepStrictEqual(sb(b), ['statusBar.hide', 'statusBar.show']);
    b.engine.destroy(); b.clock.tick(5000);
    assert.deepStrictEqual(sb(b), ['statusBar.hide', 'statusBar.show'], 'no double show');
  } finally { b.restore(); }
  b = boot({ host: ALL });
  try { b.engine.paint(); b.panel.className = 'music-nowplaying-panel'; b.panel.hidden = true; b.panel.innerHTML = ''; await flushMO(); assert.strictEqual(held(b).statusBar, false, 'class reset'); } finally { b.restore(); }
  b = boot({ host: ALL });
  try { b.engine.paint(); b.engine.destroy(); assert.strictEqual(held(b).statusBar, false, 'destroy'); } finally { b.restore(); }
  b = boot({ host: ALL });
  try {
    b.engine.paint(); b.panel.remove(); b.clock.tick(1000);
    assert.strictEqual(held(b).statusBar, false, 'panel removed with no engine call: the poll shows it within a second');
    assert.strictEqual(b.clock.live(), 0, 'and the poll stops');
  } finally { b.restore(); }
  b = boot({ host: ALL });
  try { b.engine.paint(); b.win.dispatchEvent(new b.win.Event('pagehide')); assert.strictEqual(held(b).statusBar, false, 'pagehide'); } finally { b.restore(); }
  b = boot({ host: ALL, sideways: true });
  try {
    b.engine.paint();
    assert.deepStrictEqual(b.fake.of('orientation.lock'), [], 'Sideways: no rotation lock');
    assert.deepStrictEqual(sb(b), ['statusBar.hide'], 'but a sideways Pocket is still immersive');
  } finally { b.restore(); }
  b = boot({ host: ALL, popout: true });
  try { b.fake.clear(); b.engine.paint(); assert.deepStrictEqual(b.fake.types(), [], 'a pop-out is another window with no host of its own'); } finally { b.restore(); }
});

test('D2: statusBar alone (no orientation capability) still hides and shows', async () => {
  const b = boot({ host: { capabilities: ['statusBar'] } });
  try {
    b.fake.clear(); b.engine.paint();
    assert.deepStrictEqual(b.fake.types(), ['statusBar.hide']);
    b.panel.hidden = true; await flushMO();
    assert.deepStrictEqual(b.fake.types(), ['statusBar.hide', 'statusBar.show']);
  } finally { b.restore(); }
});

test('D3: the bar gains the time (statusBar) and the connection mark (network too); re-drawn after every repaint', () => {
  const b = boot({ host: ALL });
  try {
    b.engine.paint();
    const clockEl = rt(b).querySelector('.ip-clock');
    assert.ok(clockEl, 'the clock is in the right cluster');
    assert.strictEqual(rt(b).firstElementChild, clockEl);
    assert.strictEqual(clockEl.textContent, new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    assert.strictEqual(rt(b).querySelector('.ip-conn').getAttribute('data-conn'), 'none', 'nothing reported yet: the no-connection mark');
    net(b, { connection: 'wifi' });
    assert.strictEqual(rt(b).querySelector('.ip-conn').getAttribute('data-conn'), 'wifi');
    assert.ok(rt(b).querySelector('.ip-conn svg path'));
    net(b, { connection: 'cellular', constrained: true });
    assert.strictEqual(rt(b).querySelector('.ip-conn').getAttribute('data-conn'), 'cellular');
    assert.ok(rt(b).querySelector('.ip-conn').classList.contains('is-constrained'));
    net(b, { connection: 'satellite' });
    assert.strictEqual(rt(b).querySelector('.ip-conn').getAttribute('data-conn'), 'other', 'an unknown future kind reads as other');
    net(b, { connection: 'wired', expensive: true });
    b.engine.paint(); // ipScreen rebuilds the markup
    assert.strictEqual(rt(b).querySelectorAll('.ip-clock').length, 1);
    assert.strictEqual(rt(b).querySelector('.ip-conn').getAttribute('data-conn'), 'wired', 'the last report survives a repaint');
    assert.ok(!rt(b).querySelector('.ip-conn').classList.contains('is-constrained'));
    net(b, { connection: 'none' });
    assert.strictEqual(rt(b).querySelector('.ip-conn').getAttribute('data-conn'), 'none');
  } finally { b.restore(); }
});

test('D3: statusBar without network draws the time and no connection mark; network without statusBar draws nothing and subscribes nothing', () => {
  let b = boot({ host: { capabilities: ['statusBar'] } });
  try { b.engine.paint(); assert.ok(rt(b).querySelector('.ip-clock')); assert.ok(!rt(b).querySelector('.ip-conn')); assert.deepStrictEqual(nw(b), []); } finally { b.restore(); }
  b = boot({ host: { capabilities: ['network', 'battery'] } });
  try { b.engine.paint(); assert.ok(!rt(b).querySelector('.ip-clock'), 'no statusBar = the PWA-like path: no second clock'); assert.ok(!rt(b).querySelector('.ip-conn')); assert.deepStrictEqual(nw(b), []); } finally { b.restore(); }
});

test('D3: the clock is a minute-boundary timeout, never a per-second timer', () => {
  const b = boot({ host: ALL });
  try {
    const delays = []; const fns = [];
    const real = b.win.setTimeout.bind(b.win);
    b.win.setTimeout = (fn, ms, ...r) => { delays.push(ms); fns.push(fn); return real(fn, ms, ...r); };
    b.engine.paint();
    assert.strictEqual(delays.length, 1);
    assert.ok(delays[0] > 0 && delays[0] <= 60050, 'next minute boundary: ' + delays[0]);
    assert.strictEqual(b.clock.live(), 1, 'only the shared 1 s self-heal poll exists (the v1.384.0 one), no clock interval');
    b.engine.paint(); b.engine.paint();
    assert.strictEqual(delays.length, 1, 'repaints never re-arm it');
    fns[0](); // the minute boundary arrives: the clock is re-drawn and the NEXT minute armed (not a short interval)
    assert.strictEqual(delays.length, 2);
    assert.ok(delays[1] <= 60050 && (delays[1] > 1050 || (Date.now() % 60000) > 58900), 'the next minute boundary, not a short poll: ' + delays[1]);
    b.engine.destroy();
    assert.strictEqual(b.clock.live(), 0);
  } finally { b.restore(); }
});

test('D4: ONE network subscription across two engines, dropped with the last bar; bad events cannot throw', async () => {
  const b = boot({ host: ALL });
  try {
    b.fake.clear();
    const e2 = b.make('panel2');
    b.engine.paint(); e2.paint();
    assert.deepStrictEqual(nw(b), ['network.subscribe'], 'one subscription for two bars');
    b.engine.destroy();
    assert.deepStrictEqual(nw(b), ['network.subscribe'], 'the other bar still shows');
    e2.destroy();
    assert.deepStrictEqual(nw(b), ['network.subscribe', 'network.unsubscribe']);
    b.fake.emit({ v: 1, type: 'network', connection: 7 });
    b.fake.emit({ v: 1, type: 'network' });
  } finally { b.restore(); }
});

test('D5: swipe-back - the host releases everything on a commit; a persisted pageshow re-sends exactly what is wanted, once', () => {
  const b = boot({ host: ALL });
  try {
    b.engine.paint();
    assert.deepStrictEqual(held(b), { orientation: true, statusBar: true, battery: 1, network: 1 });
    // the page leaves (pagehide), the host drops all on the commit; the bfcache restores it WITHOUT running a script
    b.win.dispatchEvent(new b.win.Event('pagehide'));
    assert.deepStrictEqual(held(b), { orientation: false, statusBar: false, battery: 0, network: 0 }, 'pagehide releases all four');
    const ps = new b.win.Event('pageshow'); ps.persisted = true;
    b.win.dispatchEvent(ps); b.win.dispatchEvent(ps);
    assert.deepStrictEqual(held(b), { orientation: true, statusBar: true, battery: 1, network: 1 }, 'back with Pocket up: all four, never doubled');
    net(b, { connection: 'wifi' });
    assert.strictEqual(rt(b).querySelector('.ip-conn').getAttribute('data-conn'), 'wifi', 'the re-subscribed listener is live (and only one)');
    assert.ok(b.clock.live() <= 1);
  } finally { b.restore(); }
});

test('D5: swipe-back after Pocket closed re-sends nothing (no re-lock, no hidden bar, no subscription)', async () => {
  const b = boot({ host: ALL });
  try {
    b.engine.paint(); b.panel.hidden = true; await flushMO();
    b.fake.clear();
    b.win.dispatchEvent(new b.win.Event('pagehide'));
    const ps = new b.win.Event('pageshow'); ps.persisted = true;
    b.win.dispatchEvent(ps);
    assert.deepStrictEqual(b.fake.types().filter((t) => !/(unlock|show|unsubscribe)$/.test(t)), [], 'only releases, never a hold');
    assert.deepStrictEqual(held(b), { orientation: false, statusBar: false, battery: 0, network: 0 });
  } finally { b.restore(); }
});

test('D6: no host and a host without the new capabilities draw an identical panel and post nothing new', () => {
  const a = boot({});
  const c = boot({ host: { capabilities: ['orientation', 'haptics', 'battery', 'serverSettings'] } });
  try {
    a.engine.paint(); c.engine.paint();
    const strip = (el) => el.innerHTML.replace(/style="[^"]*"/g, '');
    assert.strictEqual(strip(a.panel), strip(c.panel), 'identical DOM');
    assert.ok(!a.panel.querySelector('.ip-clock, .ip-conn'));
    assert.deepStrictEqual(c.fake.types().filter((t) => /^(statusBar|network)\./.test(t)), []);
    assert.strictEqual(a.clock.live(), 0, 'no host: no timers');
  } finally { a.restore(); c.restore(); }
});

test('gate r1 W1: a skin with no status bar of its own (Cider, Nordic) keeps iOS\'s bar; only a bar that replaces it hides it', () => {
  for (const skin of ['apple', 'spotify']) {
    const b = boot({ host: ALL });
    try {
      const e = b.make('panel', skin);
      b.fake.clear(); e.paint();
      assert.ok(!b.panel.querySelector('.ip-status-rt'), skin + ' draws no ip status bar');
      assert.deepStrictEqual(sb(b), [], skin + ': iOS\'s bar is not hidden when nothing replaces it');
      assert.deepStrictEqual(nw(b), []);
      assert.deepStrictEqual(b.fake.of('orientation.lock').length, 1, 'the rotation lock still applies');
    } finally { b.restore(); }
  }
});

test('gate r1 W2: a bad optional field never swallows the connection change; a reopened bar never shows the old kind', async () => {
  const b = boot({ host: ALL });
  try {
    b.engine.paint();
    net(b, { connection: 'wifi' });
    net(b, { connection: 'cellular', constrained: 'yes' });
    assert.strictEqual(rt(b).querySelector('.ip-conn').getAttribute('data-conn'), 'cellular');
    assert.ok(!rt(b).querySelector('.ip-conn').classList.contains('is-constrained'));
    net(b, { connection: 7 }); net(b, {});
    assert.strictEqual(rt(b).querySelector('.ip-conn').getAttribute('data-conn'), 'cellular', 'garbage changes nothing');
    b.panel.hidden = true; await flushMO();
    b.panel.hidden = false;
    b.engine.paint();
    assert.strictEqual(rt(b).querySelector('.ip-conn').getAttribute('data-conn'), 'none', 'reopened before the first report: the no-connection mark, not the old kind');
  } finally { b.restore(); }
});

test('gate r1: pagehide stops the clock timeout and drops the host listeners; a cycle never stacks them; an unknown mark kind is the none mark', () => {
  const b = boot({ host: ALL });
  try {
    let adds = 0; let removes = 0; const clears = [];
    const ae = b.win.addEventListener.bind(b.win); const re = b.win.removeEventListener.bind(b.win);
    b.win.addEventListener = (t, ...r) => { if (t === 'filetube-host') adds++; return ae(t, ...r); };
    b.win.removeEventListener = (t, ...r) => { if (t === 'filetube-host') removes++; return re(t, ...r); };
    const ct = b.win.clearTimeout.bind(b.win);
    b.win.clearTimeout = (id) => { clears.push(id); return ct(id); };
    b.engine.paint();
    assert.strictEqual(adds, 2, 'one battery + one network listener');
    b.win.dispatchEvent(new b.win.Event('pagehide'));
    assert.strictEqual(removes, 2, 'both dropped on release');
    assert.strictEqual(clears.length, 1, 'the clock timeout is cleared on pagehide');
    for (let i = 0; i < 3; i++) { b.win.dispatchEvent(new b.win.Event('pageshow')); b.win.dispatchEvent(new b.win.Event('pagehide')); }
    assert.strictEqual(adds - removes, 0, 'cycles never leak a listener');
    const SK = b.win.FileTubeMusicSkins;
    assert.strictEqual(SK.connGlyph('bogus'), SK.connGlyph('none'));
    assert.strictEqual(SK.connGlyph('constructor'), SK.connGlyph('none'));
  } finally { b.restore(); }
});
