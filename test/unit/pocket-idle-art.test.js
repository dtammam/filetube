'use strict';

// [UNIT] v1.377.0 W2 (Dean, 2026-10-08: "when one opens the iPod view, it always shows some art. right now if you
// double tap music to launch it without listening you see the placeholder music"). Measured on the real page: the
// idle iPod's art pane showed `/albumart/<the id the player still held>` (a paused podcast / video), which the server
// answers with its "Music" disc placeholder SVG, for the whole wait of the cover pool - and the pool read the WHOLE
// library (five sequential 5,000-row pages on Dean's 23,754 songs). Through the REAL music view (music.js), the REAL
// skin engine and registry, on /music?pocket=1 (the Music tab tapped again):
//   - the idle iPod never shows the held item's art; the pool landing AFTER the first render turns the pane to a cover;
//   - the pool is ONE random-sample request (no whole-library read), asked once per view instance however many
//     renders ask, and asked again after a library change;
//   - a sample with no covers falls back to the whole library only when the library is bigger than the sample.
// The engine's own drift axes (an empty pool keeps today's pane, reduced motion = one still cover, the view leaving
// mid-fetch) are bound in pocket-quick-scroll.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div class="music-toolbar"><div class="music-toolbar-actions">
    <select id="music-sort-select"></select><button id="music-view-toggle" hidden></button>
    <button id="music-pocket-btn" type="button" hidden>Pocket</button>
    <button id="music-popout-btn" hidden></button><button id="music-shuffle-btn"></button><button id="music-scan-btn"></button>
  </div></div>
  <div id="music-stage">
    <div id="player-slot">
      <div id="player-wrapper"><video id="media-player"></video>
      <div id="player-controls">
        <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
        <input id="seek-bar" type="range" /><button id="settings-btn"></button>
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
async function settleMany(n) { for (let i = 0; i < (n || 20); i++) { await settle(); await new Promise((r) => setTimeout(r, 1)); } }

// Library rows as /api/music serves them (hasArt + the shared art id + the art version).
const row = (i, art) => ({ id: 'tr' + i, title: 'Song ' + i, artist: 'A' + i, album: 'Album ' + i, albumKey: 'k' + i, artId: 'tr' + i, artV: 'v' + i, hasArt: art !== false, durationSec: 100 });

// o.held: the player holds a NON-music item (paused), as on Dean's phone. o.sample(url) / o.whole(url): the answers
// to the cover-pool requests (a promise of {items,total}); every other request answers an empty list.
async function boot(o, run) {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music?pocket=1', pretendToBeVisual: true });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController, requestAnimationFrame: global.requestAnimationFrame, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  global.Event = dom.window.Event;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.matchMedia = (q) => ({ matches: /pointer:\s*coarse|max-width:\s*768px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  dom.window.scrollTo = function () {};
  dom.window.document.documentElement.classList.add('is-phone');
  // the drift's 9 s slide timer, compressed (only the long timers: the engine's short ones keep their order)
  const realSet = dom.window.setTimeout.bind(dom.window);
  dom.window.setTimeout = (fn, ms, ...a) => realSet(fn, ms >= 5000 ? 5 : ms, ...a);
  const log = [];
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  global.fetch = (u) => {
    const url = String(u);
    log.push(url);
    if (/^\/api\/music\?sort=random&/.test(url) && o.sample) return Promise.resolve(o.sample(url)).then(json);
    if (/^\/api\/music\?sort=title-asc&/.test(url) && o.whole) return Promise.resolve(o.whole(url)).then(json);
    return Promise.resolve(json({ items: [], total: 0 }));
  };
  const meta = o.held ? { isMusic: false, id: 'vid-held', title: 'A podcast episode' } : null;
  let mod = null;
  dom.window.FileTube = {
    registerView: (n, m) => { mod = m; }, encodeListContext: () => '', decodeListContext: () => null, shimmerArt: () => {},
    player: { currentId: meta ? meta.id : null, getState: () => (meta ? 'docked' : 'hidden'), getCurrentMeta: () => meta, expand() {}, setTrackNav() {}, load() {}, dock() {}, ensureTheaterButton: () => null },
  };
  delete require.cache[skinsPath]; global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  dom.window.localStorage.setItem('ft-music-skin', 'ipod');
  delete require.cache[surfacePath];
  require(surfacePath);
  try {
    delete require.cache[musicPath];
    require(musicPath);
    mod.init(dom.window.document.getElementById('view-root'));
    await settleMany(10);
    await run({ dom, log, pane: () => dom.window.document.querySelector('#music-nowplaying-panel .ip-menuview .ipm-art') });
  } finally {
    try { mod && mod.destroy && mod.destroy(); } catch (_) { /* torn down */ }
    delete require.cache[musicPath]; delete require.cache[skinsPath]; delete require.cache[surfacePath];
    Object.assign(global, saved);
  }
}
const imgs = (box) => (box ? [...box.querySelectorAll('img')].map((i) => i.getAttribute('src')) : []);
const sampleReqs = (log) => log.filter((u) => /^\/api\/music\?sort=random&seed=\d+&limit=400$/.test(u));
const wholeReqs = (log) => log.filter((u) => /^\/api\/music\?sort=title-asc&/.test(u));
// jsdom never decodes an image: fire the load the browser would, so the engine swaps the preloaded cover in.
async function loadSlides(dom, box) {
  for (const img of box.querySelectorAll('img.ipm-slide')) img.dispatchEvent(new dom.window.Event('load'));
  await settleMany(10);
  await new Promise((r) => setTimeout(r, 50)); // the swap turns the layer on in a frame (jsdom's visual rAF: ~16 ms)
}

test('W2: the idle iPod (a podcast / video still held) never shows that item\'s art; the pool landing after the first render turns the pane to a cover', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  await boot({ held: true, sample: () => gate.then(() => ({ items: [row(1), row(2), row(3)], total: 3 })) }, async ({ dom, pane }) => {
    const box = pane();
    assert.ok(box, 'the Main menu\'s art pane is up (the idle iPod on /music?pocket=1)');
    assert.deepStrictEqual(imgs(box).filter((s) => /vid-held/.test(s)), [], 'no /albumart/<held id> (the server\'s "Music" disc placeholder)');
    assert.strictEqual(box.querySelector('img'), null, 'while the covers load the pane is empty - never the held item\'s placeholder art');
    release();
    await settleMany(10);
    const slide = box.querySelector('img.ipm-slide');
    assert.ok(slide && /^\/albumart\/tr[123]\?/.test(slide.getAttribute('src')), 'a library cover is preloaded once the pool lands (' + imgs(box).join(',') + ')');
    await loadSlides(dom, box);
    assert.ok(box.querySelector('img.ipm-slide.is-on'), 'and it is ON the pane after it decodes');
  });
});

test('W2: the cover pool is ONE random sample request per view instance - never the whole Songs list - and a library change asks again', async () => {
  await boot({ held: false, sample: () => ({ items: [row(1), row(2)], total: 23754 }) }, async ({ dom, log, pane }) => {
    await loadSlides(dom, pane());
    // more renders ask the engine for the pool (the slide timer swaps, the pane re-syncs): still one request
    for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 20)); await loadSlides(dom, pane()); }
    assert.strictEqual(sampleReqs(log).length, 1, 'one sample request (' + log.filter((u) => /\/api\/music\?/.test(u)).join(' | ') + ')');
    assert.deepStrictEqual(wholeReqs(log), [], 'no whole-library read for the covers');
    const seeds = sampleReqs(log).map((u) => u.match(/seed=(\d+)/)[1]);
    dom.window.document.dispatchEvent(new dom.window.CustomEvent('filetube:library-changed'));
    // the next slide asks the engine again (the library version moved): a NEW sample, a new seed
    for (let i = 0; i < 4 && sampleReqs(log).length < 2; i++) { await new Promise((r) => setTimeout(r, 20)); await loadSlides(dom, pane()); }
    assert.strictEqual(sampleReqs(log).length, 2, 'the library change dropped the cached pool: one more sample');
    assert.notStrictEqual(sampleReqs(log)[1].match(/seed=(\d+)/)[1], seeds[0], 'a fresh random seed');
  });
});

test('W2: a sample with no covers falls back to the whole library when the library is bigger than the sample (art on a few albums only)', async () => {
  await boot({ held: false, sample: () => ({ items: [row(1, false), row(2, false)], total: 5000 }),
    whole: () => ({ items: [row(1, false), row(2, false), row(77)], total: 3 }) }, async ({ log, pane }) => {
    await settleMany(10);
    assert.strictEqual(sampleReqs(log).length, 1);
    assert.ok(wholeReqs(log).length >= 1, 'the whole library was read for the few covers');
    assert.deepStrictEqual(imgs(pane()).filter((s) => /^\/albumart\/tr77\?/.test(s)).length, 1, 'the one cover drifts (' + imgs(pane()).join(',') + ')');
  });
});

test('W2: a sample that IS the whole library with no covers stays the empty pane - no second read', async () => {
  await boot({ held: false, sample: () => ({ items: [row(1, false), row(2, false)], total: 2 }), whole: () => ({ items: [row(9)], total: 1 }) }, async ({ log, pane }) => {
    await settleMany(10);
    assert.strictEqual(sampleReqs(log).length, 1);
    assert.deepStrictEqual(wholeReqs(log), [], 'nothing more to read: the library has no covers');
    assert.strictEqual(pane().querySelector('img'), null, 'the pane shows no cover');
  });
});
