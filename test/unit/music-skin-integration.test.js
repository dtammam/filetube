'use strict';

// [UNIT] Mobile music skins - INTEGRATION into the /music view (music.js). On a
// mobile viewport + a music item, the now-playing panel becomes the chosen skin,
// body.mms-on hides the default host chrome, and the skin's buttons PROXY to the
// player's existing hidden controls (#pp-btn / #track-prev/next-btn). Desktop /
// non-music get NONE of this. jsdom has no layout, but the render + gate + proxy
// wiring are fully testable.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const skinsPath = require.resolve('../../public/js/music-skins.js');

// The music view + a player host carrying the hidden controls the skin proxies to.
const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div class="music-toolbar"><div class="music-toolbar-actions">
    <select id="music-sort-select"></select><button id="music-view-toggle" hidden></button>
    <button id="music-theater-btn" hidden></button><button id="music-shuffle-btn"></button><button id="music-scan-btn"></button>
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
  <div class="music-tabs" id="music-tabs"><button class="music-tab active" data-tab="songs">Songs</button></div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((r) => setImmediate(r));

async function boot({ mobile, isMusic, run, skin }) {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController, requestAnimationFrame: global.requestAnimationFrame, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  global.Event = dom.window.Event; // so music.js's `new Event('change')` is same-realm as the jsdom element (browser: === window.Event)
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.matchMedia = (q) => ({ matches: !!mobile && /max-width:\s*768px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  dom.window.scrollTo = function () {};
  global.fetch = () => Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  const spy = { pp: 0, prev: 0, next: 0, seek: 0, dock: 0, shuffle: 0 };
  const meta = isMusic ? { isMusic: true, id: 't1', title: 'Track A', artist: 'NESTALGIA', album: 'Retro Mix', albumKey: 'k' } : { isMusic: false, id: 'v1', title: 'A Video' };
  let mod = null;
  dom.window.FileTube = {
    registerView: (n, m) => { mod = m; }, encodeListContext: () => '', decodeListContext: () => null, shimmerArt: () => {},
    player: { currentId: meta.id, getState: () => 'full', getCurrentMeta: () => meta, expand() {}, setTrackNav() {}, load() {}, dock() { spy.dock += 1; } },
  };
  // load the skins module into this window (sets window.FileTubeMusicSkins)
  delete require.cache[skinsPath]; global.module = undefined;
  require(skinsPath);
  dom.window.FileTubeMusicSkins = require(skinsPath);
  // v1.230: the Settings-page picker persists ft-music-skin; the music view reads it
  // on render. Preset it to simulate "picked in Settings, then opened the player".
  if (skin) dom.window.localStorage.setItem('ft-music-skin', skin);
  const D = dom.window.document;
  D.getElementById('pp-btn').addEventListener('click', () => { spy.pp += 1; });
  D.getElementById('track-prev-btn').addEventListener('click', () => { spy.prev += 1; });
  D.getElementById('track-next-btn').addEventListener('click', () => { spy.next += 1; });
  D.getElementById('seek-bar').addEventListener('change', () => { spy.seek += 1; });
  D.getElementById('music-shuffle-btn').addEventListener('click', () => { spy.shuffle += 1; });
  try {
    delete require.cache[musicPath];
    require(musicPath);
    mod.init(dom.window.document.getElementById('view-root'));
    for (let i = 0; i < 10; i++) await settle();
    await run(dom, spy, mod);
  } finally { delete require.cache[musicPath]; delete require.cache[skinsPath]; Object.assign(global, saved); }
}

const panel = (dom) => dom.window.document.getElementById('music-nowplaying-panel');

test('mobile + music: the now-playing panel becomes the skin, body.mms-on set, default chrome hidden', async () => {
  await boot({ mobile: true, isMusic: true, run: async (dom) => {
    const el = panel(dom);
    assert.match(el.className, /\bmms-full\b/, 'panel is the full skin');
    assert.match(el.className, /\bmms-apple\b/, 'default skin (apple) applied');
    assert.ok(dom.window.document.body.classList.contains('mms-on'), 'body.mms-on hides the default host chrome');
    assert.ok(el.querySelector('[data-skin-play]'), 'the skin renders its transport');
    assert.strictEqual(el.hidden, false, 'panel visible');
  } });
});

test('every transport button PROXIES to the real hidden control (engine untouched)', async () => {
  await boot({ mobile: true, isMusic: true, run: async (dom, spy) => {
    const p = panel(dom);
    const click = (sel) => p.querySelector(sel).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 10 }));
    click('[data-skin-play]'); assert.strictEqual(spy.pp, 1, 'play -> #pp-btn (primes bg-audio + toggles)');
    click('[data-skin-prev]'); assert.strictEqual(spy.prev, 1, 'prev -> #track-prev-btn (setTrackNav path)');
    click('[data-skin-next]'); assert.strictEqual(spy.next, 1, 'next -> #track-next-btn');
    click('[data-skin-seek]'); assert.strictEqual(spy.seek, 1, 'seek -> #seek-bar change (full pipeline: commit + saveProgress)');
    click('[data-skin-collapse]'); assert.strictEqual(spy.dock, 1, 'collapse -> player.dock() (the mini returns you)');
  } });
});

test('gate CRITICAL: destroy() CLEARS body.mms-on (else it collapses the next view\'s player)', async () => {
  await boot({ mobile: true, isMusic: true, run: async (dom, spy, mod) => {
    assert.ok(dom.window.document.body.classList.contains('mms-on'), 'active while the music view lives');
    mod.destroy(); // the router's teardown on nav-away
    assert.ok(!dom.window.document.body.classList.contains('mms-on'), 'cleared on destroy - watch/podcasts/read never inherit the 0-height takeover');
  } });
});

test('v1.230: the music view HONORS the skin persisted by the Settings picker (ft-music-skin)', async () => {
  // Skin picking lives on the Settings page now (no in-player switcher, no event).
  // It writes ft-music-skin; the music view reads that on render. Preset iPod and
  // confirm the now-playing renders the iPod skin, not the apple default.
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    assert.match(panel(dom).className, /\bmms-ipod\b/, 'renders the persisted skin (iPod)');
    assert.ok(!panel(dom).querySelector('[data-skin-set]'), 'no in-player switcher');
  } });
});

test('v1.231 iPod: Select toggles the song list; MENU steps back (list->now-playing->dock)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom, spy) => {
    const p = panel(dom);
    const click = (sel) => p.querySelector(sel).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.ok(!p.classList.contains('mms-listmode'), 'starts on Now Playing');
    click('[data-skin-select]');
    assert.ok(p.classList.contains('mms-listmode'), 'Select opens the song list');
    assert.strictEqual(p.querySelector('.ip-np').textContent, 'Songs', 'status bar follows the level');
    click('[data-skin-menu]');
    assert.ok(!p.classList.contains('mms-listmode'), 'MENU from the list returns to Now Playing');
    assert.strictEqual(spy.dock, 0, 'MENU on the list did NOT exit the player');
    click('[data-skin-menu]');
    assert.strictEqual(spy.dock, 1, 'MENU from Now Playing docks/exits the player (the way out)');
  } });
});

test('v1.231 Spotify: the shuffle button PROXIES to the real #music-shuffle-btn', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'spotify', run: async (dom, spy) => {
    const btn = panel(dom).querySelector('[data-skin-shuffle]');
    assert.ok(btn, 'spotify renders a shuffle control');
    btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(spy.shuffle, 1, 'shuffle -> #music-shuffle-btn (the real reshuffle)');
  } });
});

test('DESKTOP + music: NO skin - the default panel renders, no mms-on', async () => {
  await boot({ mobile: false, isMusic: true, run: async (dom) => {
    const el = panel(dom);
    assert.doesNotMatch(el.className, /\bmms-full\b/, 'no skin on desktop');
    assert.ok(!dom.window.document.body.classList.contains('mms-on'), 'default host chrome intact on desktop');
  } });
});

test('mobile + NON-music (video/podcast/book): NO skin', async () => {
  await boot({ mobile: true, isMusic: false, run: async (dom) => {
    assert.doesNotMatch(panel(dom).className, /\bmms-full\b/, 'a non-music item never gets the music skin');
    assert.ok(!dom.window.document.body.classList.contains('mms-on'));
  } });
});
