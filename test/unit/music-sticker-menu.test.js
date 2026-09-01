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
  if (opts.sticker) { try { dom.window.localStorage.setItem('ft-sticker', JSON.stringify(opts.sticker)); } catch (_) { /* ignore */ } }
  const metaById = (id) => { const t = TRACKS.find((x) => x.id === id); return t ? { isMusic: true, id: t.id, title: t.title, artist: t.artist, album: t.album, albumKey: t.albumKey } : null; };
  const state = { s: 'full', loop: false, setLoopCalls: [] };
  let registered = null;
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player: {
      currentId: 's1', getState: () => state.s, expand: () => { state.s = 'full'; }, dock: () => { state.s = 'docked'; },
      getCurrentMeta: () => metaById(dom.window.FileTube.player.currentId),
      // load() mirrors the browser's HTML resource-load reset: playbackRate snaps back to
      // defaultPlaybackRate (the ONLY mid-session carry - player.js reads ft-rate once at
      // init). So a sticker-set rate survives an advance ONLY if defaultPlaybackRate was set.
      load: (id) => { dom.window.FileTube.player.currentId = id; const mp = dom.window.document.getElementById('media-player'); if (mp) mp.playbackRate = mp.defaultPlaybackRate; },
      setTrackNav: () => {},
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

test('T3 (anti-INERT): picking a speed sets playbackRate AND defaultPlaybackRate AND persists ft-rate', async () => {
  await boot(async (dom) => {
    const mp = dom.window.document.getElementById('media-player');
    click(dom, sticker(dom));
    const opt = menu(dom).querySelector('[data-skin-speed="1.5"]');
    assert.ok(opt, 'a 1.5x row exists');
    click(dom, opt);
    assert.strictEqual(mp.playbackRate, 1.5, 'the real media element rate changed');
    // v1.238 gate CRITICAL: defaultPlaybackRate MUST be set too, else the rate reverts on
    // the next load(). This is the axis that both seats found unbound.
    assert.strictEqual(mp.defaultPlaybackRate, 1.5, 'defaultPlaybackRate set (the survives-a-load carry)');
    assert.strictEqual(dom.window.localStorage.getItem('ft-rate'), '1.5', 'persisted for a page-reload re-apply');
    assert.ok(menu(dom).querySelector('[data-skin-speed="1.5"].is-on'), 'the 1.5x row is now marked active');
  });
});

test('T3 (gate CRITICAL): a sticker-set speed SURVIVES a track-change load() (the v1.22.1 revert class)', async () => {
  await boot(async (dom) => {
    const mp = dom.window.document.getElementById('media-player');
    click(dom, sticker(dom));
    click(dom, menu(dom).querySelector('[data-skin-speed="2"]'));
    assert.strictEqual(mp.playbackRate, 2, 'plays at 2x on the current track');
    // Simulate the player auto-advancing to a separate-file track: load() snaps playbackRate
    // back to defaultPlaybackRate (the browser's real behaviour, mirrored in the fake load).
    dom.window.FileTube.player.load('s2');
    assert.strictEqual(mp.playbackRate, 2, 'the chosen 2x SURVIVES the load() (would be 1 if defaultPlaybackRate were unset)');
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

test('v1.240: an IMAGE sticker (logo default / custom) marks the button mms-sticker--img (un-circled); an emoji does NOT', async () => {
  // default (logo) -> image
  await boot(async (dom) => {
    assert.ok(sticker(dom).classList.contains('mms-sticker--img'), 'default logo is an image -> un-circled marker present');
  });
  // custom upload -> image
  await boot(async (dom) => {
    assert.ok(sticker(dom).classList.contains('mms-sticker--img'), 'custom image -> un-circled marker present');
    assert.ok(sticker(dom).querySelector('img.mms-sticker-ic'), 'renders the uploaded image');
  }, { sticker: { kind: 'custom', v: 123 } });
  // emoji -> NOT an image (keeps the round chip)
  await boot(async (dom) => {
    assert.ok(!sticker(dom).classList.contains('mms-sticker--img'), 'emoji keeps the circular chip (no un-circle marker)');
    assert.ok(sticker(dom).querySelector('.mms-sticker-emoji'), 'renders the emoji');
  }, { sticker: { kind: 'emoji', value: '🎵' } });
  // a PARTIAL emoji pref with no value falls through to the logo image -> must be marked img
  // (both gate seats: the marker keys off what's rendered, not off kind alone).
  await boot(async (dom) => {
    assert.ok(sticker(dom).querySelector('img.mms-sticker-ic'), 'no-value emoji renders the logo image');
    assert.ok(sticker(dom).classList.contains('mms-sticker--img'), 'and is un-circled (not a chip around a logo)');
  }, { sticker: { kind: 'emoji' } });
});

test('v1.240 source-lock (CSS): an image sticker drops the circle/clip', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.mms-sticker--img\{[^}]*background:transparent[^}]*border-radius:0/, 'an image sticker drops the circular background + radius');
  assert.match(css, /\.mms-sticker--img \.mms-sticker-ic\{[^}]*border-radius:0/, 'the image itself is not round-clipped');
});

test('v1.241: injectSticker applies the SIZE and TILT classes (defaults, and an explicit pref)', async () => {
  // default pref -> default size + left tilt
  await boot(async (dom) => {
    const cl = sticker(dom).classList;
    assert.ok(cl.contains('mms-sticker-sz-default'), 'default size class');
    assert.ok(cl.contains('mms-sticker-tilt-left'), 'default tilt = left');
  });
  // explicit size + tilt (preserved alongside kind)
  await boot(async (dom) => {
    const cl = sticker(dom).classList;
    assert.ok(cl.contains('mms-sticker-sz-3x'), 'size 3x class applied');
    assert.ok(cl.contains('mms-sticker-tilt-right'), 'tilt right class applied');
  }, { sticker: { kind: 'logo', size: '3x', tilt: 'right' } });
  // an unknown size/tilt falls back to the defaults
  await boot(async (dom) => {
    const cl = sticker(dom).classList;
    assert.ok(cl.contains('mms-sticker-sz-default'), 'unknown size -> default');
    assert.ok(cl.contains('mms-sticker-tilt-left'), 'unknown tilt -> left');
  }, { sticker: { kind: 'logo', size: 'huge', tilt: 'sideways' } });
});

test('v1.241 source-lock (CSS): size classes scale via --mms-sticker-px; tilt classes rotate; base bumped to 52px', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.mms-sticker\{[^}]*--mms-sticker-px:52px/, 'base size var is 52px (bumped from 44)');
  assert.match(css, /\.mms-sticker-sz-2x\{[^}]*--mms-sticker-px:104px/, '2x doubles the size var');
  assert.match(css, /\.mms-sticker-sz-5x\{[^}]*--mms-sticker-px:260px/, '5x = 5 x base');
  assert.match(css, /\.mms-sticker-tilt-straight\{[^}]*transform:rotate\(0deg\)/, 'straight = no rotation');
  assert.match(css, /\.mms-sticker-tilt-left\{[^}]*transform:rotate\(-14deg\)/, 'left tilt');
  assert.match(css, /\.mms-sticker-tilt-right\{[^}]*transform:rotate\(14deg\)/, 'right tilt');
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
