'use strict';

// [UNIT] v1.238 (Dean): the "sticker" quick-menu. A FileTube-logo sticker in the
// bottom-left of every music skin (+ the desktop pop-out) opens a compact menu =
// speed + loop + skin picker. The menu items PROXY the existing controls so player.js
// stays byte-unchanged: speed -> #media-player.playbackRate + 'ft-rate'; loop ->
// player.setLoop/isLoopEnabled; skin -> SKINS.setActiveSkin. Boots real music.js with a
// mobile viewport + an expanded music track so the skin panel actually renders, and binds
// the sticker's presence on EVERY skin, the three actions behaviourally (anti-INERT: each
// drives the REAL target), and a source-lock of the speed rows to player.js PLAYBACK_RATES.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const skinsApi = require('../../public/js/music-skins.js');
const playerPure = require('../../public/js/player.js'); // module.exports carries buildSpeedMenuModel
require('../../public/js/common.js');

const AK = 'The Band␟Great Album';
const TRACKS = [
  { id: 's1', title: 'Song One', artist: 'The Band', album: 'Great Album', albumKey: AK, durationSec: 180, source: 'library', streamSrc: '/audio/s1' },
  { id: 's2', title: 'Song Two', artist: 'The Band', album: 'Great Album', albumKey: AK, durationSec: 200, source: 'library', streamSrc: '/audio/s2' },
];
const RECENT = [TRACKS[0]];

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <select id="music-sort-select"></select>
  <button id="music-view-toggle" hidden><i></i></button>
  <div id="player-slot"></div>
  <video id="media-player"></video>
  <div id="music-nowplaying-panel" class="music-nowplaying-panel"></div>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((r) => setImmediate(r));

function fetchMap(url, init) {
  const method = (init && init.method) || 'GET';
  if (method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
  if (String(url).indexOf('album=') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: TRACKS }) });
  if (String(url).indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: RECENT }) });
  const idm = String(url).match(/\/api\/music\/([^?]+)$/);
  if (idm) { const t = TRACKS.find((x) => x.id === decodeURIComponent(idm[1])); return Promise.resolve({ ok: true, json: async () => (t || {}) }); }
  return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
}

// boot with a MOBILE viewport (matchMedia matches) + an EXPANDED music track, so the skin
// panel renders (and with it the sticker). `skin` seeds ft-music-skin. Returns {dom, loop, setLoopCalls}.
async function boot(run, opts) {
  opts = opts || {};
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music?play=s1' });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  dom.window.matchMedia = () => ({ matches: true, media: '(max-width: 768px)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } });
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  if (opts.skin) { try { dom.window.localStorage.setItem('ft-music-skin', opts.skin); } catch (_) { /* ignore */ } }
  const metaById = (id) => { const t = TRACKS.find((x) => x.id === id); return t ? { isMusic: true, id: t.id, title: t.title, artist: t.artist, album: t.album, albumKey: t.albumKey } : null; };
  const state = { s: 'full', loop: false, setLoopCalls: [] };
  let registered = null;
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player: {
      currentId: 's1', getState: () => state.s, expand: () => { state.s = 'full'; }, dock: () => { state.s = 'docked'; },
      getCurrentMeta: () => metaById(dom.window.FileTube.player.currentId),
      load: (id) => { dom.window.FileTube.player.currentId = id; }, setTrackNav: () => {},
      isLoopEnabled: () => state.loop,
      setLoop: (on) => { state.loop = !!on; state.setLoopCalls.push(!!on); },
    },
  };
  global.window.addToQueue = () => {};
  global.fetch = (u, init) => fetchMap(u, init);
  // Load music-skins.js INTO the jsdom window (its IIFE attaches window.FileTubeMusicSkins),
  // mirroring music.html loading it before music.js - music.js reads it at init time.
  delete require.cache[require.resolve('../../public/js/music-skins.js')];
  require('../../public/js/music-skins.js');
  const root = () => dom.window.document.getElementById('view-root');
  const ctx = { state, reinit: async () => { registered.destroy(); registered.init(root()); for (let i = 0; i < 12; i++) await settle(); } };
  try {
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(root());
    for (let i = 0; i < 12; i++) await settle();
    await run(dom, ctx);
    registered.destroy();
  } finally { delete require.cache[musicPath]; Object.assign(global, saved); }
}

const panel = (dom) => dom.window.document.getElementById('music-nowplaying-panel');
const sticker = (dom) => panel(dom).querySelector('.mms-sticker[data-skin-sticker]');
const menu = (dom) => panel(dom).querySelector('[data-skin-sticker-menu]');
const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

test('T2: the sticker renders on the panel with a hidden menu (default skin)', async () => {
  await boot(async (dom) => {
    assert.ok(panel(dom).classList.contains('mms-full'), 'the skin panel rendered (mobile + expanded music)');
    assert.ok(sticker(dom), 'a sticker button is present');
    const m = menu(dom);
    assert.ok(m, 'the menu element is present');
    assert.strictEqual(m.hidden, true, 'the menu starts hidden');
    // default icon = the FileTube logo mark
    assert.ok(sticker(dom).querySelector('img.mms-sticker-ic[src="/favicon.svg"]'), 'default icon is the FileTube favicon logo');
  });
});

test('T2 (shell coverage): the sticker renders on EVERY registered skin', async () => {
  for (const id of skinsApi.IDS) {
    await boot(async (dom) => {
      assert.ok(panel(dom).classList.contains('mms-' + id.replace('ipod-black', 'ipod-black')), 'panel carries the skin id class for ' + id);
      assert.ok(sticker(dom), 'sticker present on skin ' + id);
      assert.ok(menu(dom), 'menu present on skin ' + id);
    }, { skin: id });
  }
});

test('T3: tapping the sticker opens the menu; a second tap closes it', async () => {
  await boot(async (dom) => {
    assert.strictEqual(menu(dom).hidden, true);
    click(dom, sticker(dom));
    assert.strictEqual(menu(dom).hidden, false, 'opened');
    assert.strictEqual(sticker(dom).getAttribute('aria-expanded'), 'true');
    click(dom, sticker(dom));
    assert.strictEqual(menu(dom).hidden, true, 'closed');
    assert.strictEqual(sticker(dom).getAttribute('aria-expanded'), 'false');
  });
});

test('T3 (source-lock): the speed rows are EXACTLY player.js PLAYBACK_RATES', async () => {
  const expected = playerPure.buildSpeedMenuModel(1).map((r) => r.rate);
  await boot(async (dom) => {
    click(dom, sticker(dom)); // open (builds the rows fresh)
    const rows = [...menu(dom).querySelectorAll('[data-skin-speed]')].map((b) => Number(b.getAttribute('data-skin-speed')));
    assert.deepStrictEqual(rows, expected, 'sticker speed rows match player.js PLAYBACK_RATES exactly (order + values)');
  });
});

test('T3 (anti-INERT): picking a speed sets #media-player.playbackRate AND persists ft-rate', async () => {
  await boot(async (dom) => {
    const mp = dom.window.document.getElementById('media-player');
    click(dom, sticker(dom));
    const opt = menu(dom).querySelector('[data-skin-speed="1.5"]');
    assert.ok(opt, 'a 1.5x row exists');
    click(dom, opt);
    assert.strictEqual(mp.playbackRate, 1.5, 'the real media element rate changed');
    assert.strictEqual(dom.window.localStorage.getItem('ft-rate'), '1.5', 'persisted to the key player.js re-reads');
    // the active highlight reflects the new rate
    assert.ok(menu(dom).querySelector('[data-skin-speed="1.5"].is-on'), 'the 1.5x row is now marked active');
  });
});

test('T3 (anti-INERT): the loop toggle drives player.setLoop and reflects state', async () => {
  await boot(async (dom, ctx) => {
    click(dom, sticker(dom));
    assert.ok(menu(dom).querySelector('.mms-sm-loop:not(.is-on)'), 'loop starts Off');
    click(dom, menu(dom).querySelector('[data-skin-loop]'));
    assert.deepStrictEqual(ctx.state.setLoopCalls, [true], 'player.setLoop(true) was called');
    assert.strictEqual(ctx.state.loop, true, 'loop is now on');
    assert.ok(menu(dom).querySelector('.mms-sm-loop.is-on'), 'the loop row reflects On');
    click(dom, menu(dom).querySelector('[data-skin-loop]'));
    assert.deepStrictEqual(ctx.state.setLoopCalls, [true, false], 'a second tap turns it back off');
  });
});

test('T3 (anti-INERT): picking a skin chip calls SKINS.setActiveSkin and re-renders that skin', async () => {
  await boot(async (dom) => {
    click(dom, sticker(dom));
    const chip = menu(dom).querySelector('[data-skin-pick="ipod"]');
    assert.ok(chip, 'an iPod chip exists');
    click(dom, chip);
    assert.strictEqual(dom.window.localStorage.getItem('ft-music-skin'), 'ipod', 'setActiveSkin persisted the choice');
    assert.ok(panel(dom).classList.contains('mms-ipod'), 'the panel re-rendered as the iPod skin');
    // the freshly re-rendered iPod panel still carries its sticker
    assert.ok(sticker(dom), 'sticker survives the skin re-render');
  });
});

test('T3: a click elsewhere on the panel closes an open menu', async () => {
  await boot(async (dom) => {
    click(dom, sticker(dom));
    assert.strictEqual(menu(dom).hidden, false, 'open');
    // click the panel background (not inside the sticker wrap)
    click(dom, panel(dom));
    assert.strictEqual(menu(dom).hidden, true, 'closed by an outside click');
  });
});
