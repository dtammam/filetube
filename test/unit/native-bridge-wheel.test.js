'use strict';

// [UNIT] v1.384.0 (native bridge D6): the click wheel's haptics through a native host, driven through the REAL skin
// engine (skin-surface.js), the REAL registry and the REAL adapter (host-adapter.js) with a FAKE host (test/helpers/
// fake-host.js) and REAL pointer sequences on a fake performance clock. Proves: with `haptics` announced the switch-
// tracking ghost never mounts and a tick is posted per detent at the HAPTIC_MIN_MS throttle on BOTH engines (ghost
// and sweep), per letter in letter mode, once for the centre hold and once for the MENU hold-to-home, none with Buzz
// off; and with no host (or no `haptics` capability) the ghost path is exactly as it was and nothing is posted.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { installFakeHost, loadAdapter } = require('../helpers/fake-host');
const { cmpStr } = require('../../lib/music/query');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const wheelConfigPath = require.resolve('../../public/js/wheel-config.js');
const skins = require(skinsPath);

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
  return {
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of q) if (t.at <= end && (!next || t.at < next.t.at)) next = { id, t };
        if (!next) break;
        q.delete(next.id); now = next.t.at; next.t.fn();
      }
      now = end;
    },
  };
}

function library(n) {
  const letters = ['#'].concat('ABCDEFGHIJKLMNOPRSTUVWYZ'.split(''));
  const out = [];
  for (let i = 0; i < n; i++) {
    const l = letters[i % letters.length];
    out.push({ id: 't' + i, title: (l === '#' ? String(i % 10) : l) + ' song ' + String(i).padStart(4, '0'), artist: 'X', hasArt: true, albumKey: 'k' + (i % 40) });
  }
  return out.sort((a, b) => cmpStr(a.title, b.title));
}
const LIB = library(3008);

// o.host: null (a browser) or { capabilities } (a native host). o.cfg: a saved wheel config (engine/buzz).
function boot(o = {}) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music', pretendToBeVisual: true, runScripts: 'outside-only' });
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  const win = dom.window;
  const clock = fakeClock(win);
  win.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(win.HTMLInputElement.prototype, 'switch', { value: false, configurable: true }); // a switch-capable phone
  win.ontouchstart = null;
  const fake = o.host ? installFakeHost(win, o.host) : null;
  loadAdapter(win);
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  win.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  if (o.cfg) {
    delete require.cache[wheelConfigPath];
    win.FileTubeWheelConfig = require(wheelConfigPath);
    win.FileTubeWheelConfig.write(o.cfg, win.localStorage);
  }
  const spy = { home: 0 };
  const panel = win.document.getElementById('panel');
  const engine = win.FileTubeSkinSurface.create({
    panel, win,
    getSkinId: () => 'ipod',
    getCtx: () => ({ track: { title: 'T', artist: 'A', artUrl: '/albumart/now' }, upNext: [], fullList: [], playing: true }),
    hostCtl: (id) => win.document.getElementById(id),
    onSelectIndex: () => {}, onDock: () => {}, onHome: () => { spy.home += 1; },
    volume: { available: () => false, level: () => null, set: () => {} },
    sticker: {},
    menu: {
      load: (n) => Promise.resolve(n.type === 'songs'
        ? { items: skins.menuSongItems(LIB, (id, a) => a || ('/albumart/' + id)), tracks: LIB, play: { ctx: { sort: 'title-asc' } }, letters: true }
        : { items: [] }),
      onPlay: () => {}, onShuffleAll: () => {}, hasCurrent: () => true, currentId: () => null, dataVersion: () => 0,
    },
  });
  engine.paint();
  const wheel = panel.querySelector('.ip-wheel');
  wheel.getBoundingClientRect = () => ({ left: -120, top: -120, width: 240, height: 240, right: 120, bottom: 120 });
  return { dom, win, fake, engine, panel, wheel, clock, spy, restore: () => { Object.assign(global, saved); try { win.close(); } catch (_) { /* gone */ } } };
}

const at = (deg) => { const r = deg * Math.PI / 180; return { clientX: 100 * Math.cos(r), clientY: 100 * Math.sin(r) }; };
const mouse = (b, type, p) => new b.win.MouseEvent(type, Object.assign({ bubbles: true }, p || {}));
// pointerdown on the ring, `moves` pointermoves of `step` degrees `ms` apart on a fake performance clock, then release.
function spin(b, { from = 0, moves, step, ms, lift = true }) {
  const realNow = performance.now;
  let t = realNow.call(performance);
  Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => t });
  try {
    b.wheel.dispatchEvent(mouse(b, 'pointerdown', at(from)));
    let deg = from;
    for (let i = 0; i < moves; i++) { t += ms; deg += step; b.wheel.dispatchEvent(mouse(b, 'pointermove', at(deg))); }
    if (lift) b.wheel.dispatchEvent(mouse(b, 'pointerup'));
  } finally { Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: realNow }); }
}
const ticks = (b) => b.fake.of('haptics.tick');
const styles = (b) => ticks(b).map((m) => m.style);
const flush = () => new Promise((r) => setImmediate(r));
const tap = (b, el) => { el.dispatchEvent(mouse(b, 'pointerdown')); el.dispatchEvent(mouse(b, 'pointerup')); el.dispatchEvent(mouse(b, 'click')); };
const tapLabel = (b, label) => {
  const r = [...b.panel.querySelectorAll('.ipm-row:not(.ipm-skel)')].find((x) => x.querySelector('.ipm-lbl').textContent === label);
  tap(b, r);
};
async function openSongs(b) {
  tap(b, b.panel.querySelector('[data-skin-menu]'));
  tap(b, b.panel.querySelector('[data-skin-select]')); // Main -> Music (the cursor starts on Music)
  tapLabel(b, 'Songs'); await flush();
  assert.strictEqual(b.engine.menuState().title, 'Songs');
}

test('host haptics: the switch-tracking ghost never mounts, no carve-out class, no body lock (a switch-capable phone)', () => {
  const b = boot({ host: {} });
  try {
    assert.strictEqual(b.panel.querySelector('.mms-haptic-ghost'), null, 'no ghost element');
    assert.ok(!b.panel.classList.contains('mms-haptic'), 'no touch-action carve-out');
    assert.notStrictEqual(b.win.document.body.style.position, 'fixed', 'no body scroll lock from the ghost');
  } finally { b.restore(); }
});

test('host haptics: a gesture posts prepare once, then one detent tick per 3.75 degrees (the ghost engine, default config)', () => {
  const b = boot({ host: {} });
  try {
    b.fake.clear();
    spin(b, { moves: 5, step: 4, ms: 20 }); // 4 deg per move: one detent per move
    assert.deepStrictEqual(b.fake.types().filter((t) => t === 'haptics.prepare'), ['haptics.prepare'], 'prepare once at the gesture start');
    assert.strictEqual(b.fake.types()[0], 'haptics.prepare', 'and it comes first');
    assert.deepStrictEqual(styles(b), ['detent', 'detent', 'detent', 'detent', 'detent']);
    b.fake.clear();
    spin(b, { moves: 3, step: 1, ms: 20 }); // 3 deg in total: under one detent
    assert.deepStrictEqual(styles(b), [], 'rotation under a detent is silent');
    b.fake.clear();
    spin(b, { moves: 4, step: 1, ms: 20 }); // 4 deg: exactly one detent, the remainder carried inside the gesture
    assert.deepStrictEqual(styles(b), ['detent']);
  } finally { b.restore(); }
});

test('host haptics: the same HAPTIC_MIN_MS throttle as the ghost - a tick inside 8 ms of the last is dropped, never queued', () => {
  const b = boot({ host: {} });
  try {
    b.fake.clear();
    spin(b, { moves: 10, step: 4, ms: 1 }); // ten detents crossed 1 ms apart
    assert.strictEqual(ticks(b).length, 2, 'detents at 1 ms spacing: the first passes, the next passes 8 ms later - the rest are dropped');
    b.fake.clear();
    spin(b, { moves: 10, step: 4, ms: 8 }); // exactly the throttle: every detent passes
    assert.strictEqual(ticks(b).length, 10);
    b.fake.clear();
    spin(b, { moves: 1, step: 11.25, ms: 20 }); // three detents inside ONE move: one tick (the OS also reads one crossing per move)
    assert.strictEqual(ticks(b).length, 1);
  } finally { b.restore(); }
});

test('host haptics: the sweep engine ticks per detent too (it keeps no detent counter of its own - the host branch owns the one)', () => {
  const b = boot({ host: {}, cfg: { engine: 'sweep', detent: 3.75, dither: 18, capture: '8px', buzz: true } });
  try {
    b.fake.clear();
    spin(b, { moves: 5, step: 4, ms: 20 });
    assert.deepStrictEqual(styles(b), ['detent', 'detent', 'detent', 'detent', 'detent']);
    assert.strictEqual(b.panel.querySelector('.mms-haptic-ghost'), null);
  } finally { b.restore(); }
});

test('host haptics: the config\'s Detent step is honoured (8 degrees: a 4 degree move ticks every second move)', () => {
  const b = boot({ host: {}, cfg: { engine: 'ghost', detent: 8, dither: 18, capture: '8px', buzz: true } });
  try {
    b.fake.clear();
    spin(b, { moves: 6, step: 4, ms: 20 });
    assert.strictEqual(ticks(b).length, 3);
  } finally { b.restore(); }
});

test('host haptics: Buzz OFF posts no ticks at all', () => {
  for (const engine of ['ghost', 'sweep']) {
    const b = boot({ host: {}, cfg: { engine, detent: 3.75, dither: 18, capture: '8px', buzz: false } });
    try {
      b.fake.clear();
      spin(b, { moves: 8, step: 4, ms: 20 });
      assert.deepStrictEqual(b.fake.types().filter((t) => t === 'haptics.tick'), [], engine);
    } finally { b.restore(); }
  }
});

test('host haptics: letter mode posts a tick per LETTER (style letter), none per degree', async () => {
  const b = boot({ host: {} });
  try {
    await openSongs(b);
    b.fake.clear();
    // a FAST flick (11.5 deg every 8 ms = 1.44 deg/ms) engages letter mode, as the Pocket quick-scroll suite proves
    spin(b, { moves: 8, step: 11.5, ms: 8 });
    assert.strictEqual(b.engine.menuState().letterMode, true, 'precondition: the flick engaged letter mode');
    const s = styles(b);
    assert.ok(s.includes('letter'), 'a letter crossing ticks with the letter style: ' + s.join(','));
    assert.match(s.join(','), /^(detent,)*letter(,letter)*$/, 'the move before the letter mode engages ticks per detent (as the ghost path does); from the first letter on, only letter ticks: ' + s.join(','));
  } finally { b.restore(); }
});

test('host haptics: letter ticks go through the same throttle (letters crossed 1 ms apart are dropped, not queued)', async () => {
  const counts = [];
  for (const ms of [8, 1]) {
    const b = boot({ host: {} });
    try {
      await openSongs(b);
      b.fake.clear();
      spin(b, { moves: 8, step: 11.5, ms });
      assert.strictEqual(b.engine.menuState().letterMode, true, 'precondition: letter mode at ' + ms + ' ms');
      counts.push(styles(b).filter((x) => x === 'letter').length);
    } finally { b.restore(); }
  }
  assert.ok(counts[0] >= 2, 'at 8 ms spacing several letters tick');
  assert.ok(counts[1] < counts[0], 'at 1 ms spacing the throttle drops them: ' + counts.join(' vs '));
});

test('host haptics: the centre hold ticks ONCE (style detent) at the fire, and its press posts prepare only', () => {
  const b = boot({ host: {} });
  try {
    const center = b.panel.querySelector('[data-skin-select]');
    b.fake.clear();
    center.dispatchEvent(new b.win.PointerEvent('pointerdown', { bubbles: true, clientX: 2, clientY: 3, pointerId: 1, pointerType: 'touch', isPrimary: true }));
    assert.deepStrictEqual(b.fake.types(), ['haptics.prepare'], 'the press: prepare, no tick');
    b.clock.advance(700);
    assert.deepStrictEqual(styles(b), ['detent'], 'the hold fire: one detent tick');
    center.dispatchEvent(new b.win.PointerEvent('pointerup', { bubbles: true, clientX: 2, clientY: 3, pointerId: 1, pointerType: 'touch', isPrimary: true }));
    assert.strictEqual(ticks(b).length, 1, 'the release adds none');
  } finally { b.restore(); }
});

test('host haptics: the MENU hold-to-home ticks ONCE (style detent) then goes home', () => {
  const b = boot({ host: {} });
  try {
    const menu = b.panel.querySelector('[data-skin-menu]');
    b.fake.clear();
    menu.dispatchEvent(mouse(b, 'pointerdown', { clientX: 0, clientY: -100 }));
    b.clock.advance(700);
    assert.deepStrictEqual(styles(b), ['detent'], 'one tick at the hold fire');
    assert.strictEqual(b.spy.home, 1, 'and it went home');
    menu.dispatchEvent(mouse(b, 'pointerup'));
    assert.strictEqual(ticks(b).length, 1);
  } finally { b.restore(); }
});

test('no host (a browser): the ghost mounts as before and nothing is posted - the wheel gesture is the old path', () => {
  const b = boot({ host: null });
  try {
    assert.strictEqual(b.win.FileTube.host.present, false);
    const g = b.panel.querySelector('.mms-haptic-ghost');
    assert.ok(g, 'the ghost mounted');
    assert.ok(b.panel.classList.contains('mms-haptic'));
    const rest = g.style.transform;
    b.wheel.dispatchEvent(mouse(b, 'pointerdown', at(0)));
    assert.notStrictEqual(g.style.transform, rest, 'the ghost rides under the finger from the press');
    b.wheel.dispatchEvent(mouse(b, 'pointerup'));
  } finally { b.restore(); }
});

test('a host WITHOUT the haptics capability keeps the browser path: ghost mounted, nothing posted', () => {
  const b = boot({ host: { capabilities: ['battery'] } });
  try {
    assert.ok(b.panel.querySelector('.mms-haptic-ghost'), 'the ghost mounted');
    b.fake.clear();
    spin(b, { moves: 5, step: 4, ms: 20 });
    assert.deepStrictEqual(b.fake.types(), [], 'no haptics message without the capability');
  } finally { b.restore(); }
});
