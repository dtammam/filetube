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

async function boot({ mobile, isMusic, run }) {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController, requestAnimationFrame: global.requestAnimationFrame };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.matchMedia = (q) => ({ matches: !!mobile && /max-width:\s*768px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  dom.window.scrollTo = function () {};
  global.fetch = () => Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  const ppClicks = { n: 0 };
  const meta = isMusic ? { isMusic: true, id: 't1', title: 'Track A', artist: 'NESTALGIA', album: 'Retro Mix', albumKey: 'k' } : { isMusic: false, id: 'v1', title: 'A Video' };
  let mod = null;
  dom.window.FileTube = {
    registerView: (n, m) => { mod = m; }, encodeListContext: () => '', decodeListContext: () => null, shimmerArt: () => {},
    player: { currentId: meta.id, getState: () => 'full', getCurrentMeta: () => meta, expand() {}, setTrackNav() {}, load() {}, dock() {} },
  };
  // load the skins module into this window (sets window.FileTubeMusicSkins)
  delete require.cache[skinsPath]; global.module = undefined;
  require(skinsPath);
  dom.window.FileTubeMusicSkins = require(skinsPath);
  dom.window.document.getElementById('pp-btn').addEventListener('click', () => { ppClicks.n += 1; });
  try {
    delete require.cache[musicPath];
    require(musicPath);
    mod.init(dom.window.document.getElementById('view-root'));
    for (let i = 0; i < 10; i++) await settle();
    await run(dom, ppClicks);
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

test('the skin play button PROXIES to the hidden #pp-btn (engine untouched)', async () => {
  await boot({ mobile: true, isMusic: true, run: async (dom, ppClicks) => {
    panel(dom).querySelector('[data-skin-play]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(ppClicks.n, 1, 'tapping the skin play clicked the real #pp-btn (which primes bg-audio + toggles)');
  } });
});

test('the skin switcher picks a skin - persists + re-renders (the "themes" picker)', async () => {
  await boot({ mobile: true, isMusic: true, run: async (dom) => {
    assert.match(panel(dom).className, /\bmms-apple\b/, 'starts on the default (apple)');
    panel(dom).querySelector('[data-skin-set="ipod"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 4; i++) await settle();
    assert.match(panel(dom).className, /\bmms-ipod\b/, 'switched to iPod');
    assert.strictEqual(dom.window.localStorage.getItem('ft-music-skin'), 'ipod', 'choice persisted per-device');
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
