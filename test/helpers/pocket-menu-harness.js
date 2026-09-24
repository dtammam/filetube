'use strict';

// Pocket menus (2026-09-24): the shared jsdom harness for the integration suites that drive the
// REAL music.js view + the skin engine against a REAL server (music-pocket-menus*.test.js). Each
// suite boots its own server (its own DATA_DIR, set before it requires server.js) and hands this
// harness its base URL + cookie-carrying fetch; the harness never requires the server itself.

const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');

// env() -> { base, authedFetch } (read at boot time - the suite's before() fills them in)
function createPocketHarness(env) {
  let base = '';
  let authedFetch = null;
  const VIEW_HTML = `<body><div id="view-root" data-view="music">
    <div class="music-toolbar"><div class="music-toolbar-actions">
      <select id="music-sort-select"></select><button id="music-view-toggle" hidden></button>
      <button id="music-popout-btn" hidden></button><button id="music-shuffle-btn"></button><button id="music-scan-btn"></button>
    </div></div>
    <div id="music-stage">
      <div id="player-slot">
        <div id="player-wrapper"><video id="media-player"></video>
        <div id="player-controls">
          <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
          <input id="seek-bar" type="range" />
        </div></div>
      </div>
      <div id="music-nowplaying-panel" class="music-nowplaying-panel" hidden></div>
    </div>
    <button class="music-nowplaying" id="music-nowplaying" hidden></button>
    <section id="music-jumpback" hidden></section>
    <div class="music-tabs" id="music-tabs"><button class="music-tab" data-tab="home">Home</button><button class="music-tab" data-tab="songs">Songs</button><button class="music-tab" data-tab="albums">Albums</button></div>
    <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
    <div id="music-content"></div><div id="music-empty" hidden></div>
  </div></body>`;

  const settle = () => new Promise((r) => setImmediate(r));
  async function settleNet(n) { for (let i = 0; i < (n || 40); i++) { await settle(); await new Promise((r) => setTimeout(r, 2)); } }

  // Boot the REAL music view (mobile, the chosen skin) with `?play=<id>` so a track is loaded and
  // the skin is up. The player stub mirrors the real player's contract the view reads: load() makes
  // the id current + the item's meta live + the player expanded; setTrackNav records the nav.
  async function boot({ skin, play, failOnce, intercept, setup, run }) {
    const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' + (play ? '?play=' + encodeURIComponent(play) : '') });
    const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController, requestAnimationFrame: global.requestAnimationFrame, Event: global.Event };
    global.window = dom.window; global.document = dom.window.document;
    global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
    global.Event = dom.window.Event;
    global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    dom.window.matchMedia = (q) => ({ matches: /max-width:\s*768px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    dom.window.scrollTo = function () {};
    const log = [];
    const failed = new Set();
    global.fetch = (url, opts) => {
      const u = String(url);
      log.push(u);
      if (failOnce && failOnce.test(u) && !failed.has(u)) { failed.add(u); return Promise.resolve({ ok: false, status: 500, json: async () => ({}) }); }
      const faked = intercept ? intercept(u, opts || {}) : null;
      if (faked) return Promise.resolve(faked);
      return authedFetch(u.startsWith('http') ? u : base + u, opts);
    };
    const spy = { loads: [], next: 0, prev: 0, dock: 0, nav: null };
    const pstate = { state: 'docked', meta: null };
    const player = {
      currentId: null,
      getState: () => pstate.state,
      getCurrentMeta: () => pstate.meta,
      expand() { pstate.state = 'full'; },
      dock() { spy.dock += 1; pstate.state = 'docked'; },
      load(id, data) {
        player.currentId = id;
        pstate.meta = { isMusic: true, id, title: data.title, artist: data.channelName, album: data.album, albumKey: data.albumKey, browseCtx: data.browseCtx };
        pstate.state = 'full';
        spy.loads.push({ id, data });
      },
      setTrackNav(h) { spy.nav = h || null; },
      close() { player.currentId = null; pstate.meta = null; },
    };
    let mod = null;
    dom.window.FileTube = {
      registerView: (n, m) => { mod = m; }, shimmerArt: () => {},
      encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } },
      player,
    };
    if (skin) dom.window.localStorage.setItem('ft-music-skin', skin);
    if (setup) setup(dom);
    const D = dom.window.document;
    D.getElementById('track-next-btn').addEventListener('click', () => { spy.next += 1; });
    D.getElementById('track-prev-btn').addEventListener('click', () => { spy.prev += 1; });
    try {
      delete require.cache[skinsPath]; global.module = undefined;
      require(skinsPath);
      dom.window.FileTubeMusicSkins = require(skinsPath);
      delete require.cache[surfacePath];
      require(surfacePath);
      delete require.cache[musicPath];
      require(musicPath);
      mod.init(D.getElementById('view-root'));
      await settleNet();
      await run({ dom, D, spy, player, pstate, log, mod, panel: D.getElementById('music-nowplaying-panel') });
      mod.destroy();
    } finally {
      delete require.cache[musicPath]; delete require.cache[skinsPath]; delete require.cache[surfacePath];
      Object.assign(global, saved);
    }
  }

  // ---- drivers: every level reachable by TAP, by the wheel/pad, and the center/MENU buttons ----
  // a real TAP: pointerdown, pointerup, then the click (the engine clears its spin-suppress flag on
  // every press, so a click with no press before it would read as a spin's lift-off and be eaten).
  const click = (dom, el) => {
    el.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  };
  const menu = (h) => click(h.dom, h.panel.querySelector('[data-skin-menu]'));
  const select = (h) => click(h.dom, h.panel.querySelector('[data-skin-select]'));
  const rows = (h) => [...h.panel.querySelectorAll('.ip-menuview .ipm-row:not(.ipm-skel)')];
  const labels = (h) => rows(h).map((r) => r.querySelector('.ipm-lbl').textContent);
  const cursorLabel = (h) => { const r = h.panel.querySelector('.ip-menuview .ipm-row.is-cursor'); return r ? r.querySelector('.ipm-lbl').textContent : null; };
  const title = (h) => h.panel.querySelector('.ip-np').textContent;
  const tapRow = (h, label) => { const r = rows(h).find((x) => x.querySelector('.ipm-lbl').textContent === label); if (!r) throw new Error('no row ' + label + ' in ' + labels(h).join('|')); click(h.dom, r); };
  const inMenu = (h) => h.panel.classList.contains('mms-menumode');
  function spin(h, degs, msPerMove) {
    // the SAME gesture the v1.233 cursor tests drive: pointerdown on the wheel ring, sweep, release.
    // A fake clock paces the moves (jsdom dispatches them in the same millisecond, which the
    // engine's angular-speed accel reads as a flick): `msPerMove` apart = a real turn's speed.
    const wheel = h.panel.querySelector('.ip-wheel');
    const at = (deg) => { const rad = deg * Math.PI / 180; return { clientX: 100 * Math.cos(rad), clientY: 100 * Math.sin(rad) }; };
    const realNow = performance.now;
    let t = realNow.call(performance);
    Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => t });
    try {
      const s = at(0);
      wheel.dispatchEvent(new h.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: s.clientX, clientY: s.clientY }));
      degs.forEach((d) => { t += (msPerMove || 60); const q = at(d); wheel.dispatchEvent(new h.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: q.clientX, clientY: q.clientY })); });
      wheel.dispatchEvent(new h.dom.window.MouseEvent('pointerup', { bubbles: true }));
    } finally { Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: realNow }); }
  }
  // one slow detent: 25 degrees at a walking pace (> the 22-degree cursor step, multiplier 1)
  async function stepDown(h) { spin(h, [5, 10, 15, 20, 25]); await settle(); }

  const realBoot = boot;
  async function bootWithEnv(opts) { const e = env(); base = e.base; authedFetch = e.authedFetch; return realBoot(opts); }
  return { boot: bootWithEnv, settle, settleNet, click, menu, select, rows, labels, cursorLabel, title, tapRow, inMenu, spin, stepDown };
}

module.exports = { createPocketHarness };
