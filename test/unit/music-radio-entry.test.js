'use strict';

// [UNIT] v1.368.0 (plan docs/exec-plans/active/2026-10-06-v1368-music-radio.md, W2, R3 + R14): the
// desktop Start radio entry points on the REAL music.js - the song row menu and the album / artist
// drill's Radio button - and the pocket letter jump skipping a level's leading action row. The
// pocket levels, the station seed and the resume are bound end to end in
// test/integration/music-radio-api.test.js; the sticker row in skin-surface.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const common = require('../../public/js/common.js');
const skins = require('../../public/js/music-skins.js');

const RADIO = [{ id: 'r1', title: 'Radio One', artist: 'Kin', durationSec: 200, source: 'native' }, { id: 'r2', title: 'Radio Two', artist: 'Kin 2', durationSec: 200, source: 'native' }];
const AK = 'Band␟Record';
const TRACKS = [];
for (let n = 0; n < 9; n++) TRACKS.push({ id: 't' + n, title: 'Song ' + n, artist: 'Band', albumArtist: 'Band', album: 'Record', albumKey: AK, trackNo: n + 1, durationSec: 200, source: 'native' });

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <select id="music-sort-select"></select>
  <button id="music-view-toggle" hidden><i></i></button>
  <button id="music-loop-btn" type="button" aria-pressed="false"><span class="music-mode-lbl">Loop</span></button>
  <button id="music-shufflemode-btn" type="button" aria-pressed="false">Shuffle</button>
  <button id="music-autoplay-btn" type="button" aria-pressed="false">Autoplay</button>
  <button id="music-shuffle-btn" type="button">Shuffle all</button>
  <div id="player-slot"></div>
  <video id="media-player"></video>
  <div id="music-nowplaying-panel" class="music-nowplaying-panel"></div>
  <button type="button" class="music-nowplaying" id="music-nowplaying" hidden></button>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((r) => setImmediate(r));

// a seeded Math.random for the duration of a test (fisherYatesShuffle's default rng), so a
// "permuted" assertion can never pass or fail by luck
function seededRandom(seed) {
  let a = seed | 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function boot(url, run, opts) {
  opts = opts || {};
  const dom = new JSDOM(VIEW_HTML, { url });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController, fisherYatesShuffle: global.fisherYatesShuffle, random: Math.random };
  if (opts.shuffle) dom.window.localStorage.setItem('ft-music-shuffle', '1');
  dom.window.localStorage.setItem('ft-music-autoplay', '0'); // no station in these tests (W2 binds the append)
  const playerState = { state: 'docked', currentId: null, meta: null };
  const metaById = (id) => { const t = TRACKS.find((x) => x.id === id); return t ? { isMusic: true, id: t.id, title: t.title, artist: t.artist, album: t.album, albumKey: t.albumKey } : null; };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  global.fisherYatesShuffle = common.fisherYatesShuffle; // a page global in the browser (common.js)
  Math.random = seededRandom(opts.seed || 7);
  let registered = null;
  let lastNav = null;
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player: {
      currentId: null, getState: () => playerState.state, expand: () => { playerState.state = 'full'; },
      getCurrentMeta: () => playerState.meta,
      load: (id, data) => { playerState.currentId = id; dom.window.FileTube.player.currentId = id; playerState.meta = Object.assign({}, metaById(id) || { isMusic: true, id }, { browseCtx: data && data.browseCtx }); },
      setTrackNav: (h) => { lastNav = h || null; },
      isLoopEnabled: () => false,
    },
  };
  global.window.addToQueue = () => {};
  const menus = [];
  dom.window.ui = { menu: (o) => { menus.push(o); } }; // the row menu primitive: capture what it is asked to show
  dom.window.encodeListContext = common.encodeListContext; // the browser's page global
  const urls = [];
  global.fetch = (u) => {
    const s = String(u);
    urls.push(s);
    if (s.indexOf('/api/music/radio?') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: RADIO.map((t) => Object.assign({}, t)) }) });
    if (s.indexOf('album=') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: TRACKS.map((t) => Object.assign({}, t)) }) });
    // the Songs tab's list (a NEW queue array, list order = the album order here)
    if (/\/api\/music\?/.test(s) && s.indexOf('filter=') === -1 && s.indexOf('sort=random') === -1) return Promise.resolve({ ok: true, json: async () => ({ items: TRACKS.map((t) => Object.assign({}, t)), total: TRACKS.length }) });
    const idm = s.match(/\/api\/music\/([^?]+)$/);
    if (idm) { const t = TRACKS.find((x) => x.id === decodeURIComponent(idm[1])); return Promise.resolve({ ok: true, json: async () => Object.assign({}, t || {}) }); }
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  const root = () => dom.window.document.getElementById('view-root');
  const ctx = { playerState, urls, getNav: () => lastNav, menus };
  try {
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(root());
    for (let i = 0; i < 10; i++) await settle();
    await run(dom, ctx);
    registered.destroy();
  } finally { delete require.cache[musicPath]; Math.random = saved.random; Object.assign(global, { window: saved.window, document: saved.document, localStorage: saved.localStorage, fetch: saved.fetch, AbortController: saved.AbortController, fisherYatesShuffle: saved.fisherYatesShuffle }); }
}


async function next(ctx) { ctx.getNav().onNext(); await settle(); await settle(); }
const radioCalls = (ctx) => ctx.urls.filter((u) => u.indexOf('/api/music/radio?') === 0).map((u) => new URL(u, 'http://x'));
const ctxOf = (ctx) => { try { return JSON.parse(ctx.playerState.meta.browseCtx); } catch (_) { return null; } };

test('the song row menu offers Start radio: the song plays now, the station follows, the seed rides the context', async () => {
  await boot('http://localhost/music?play=t0', async (dom, ctx) => {
    const row = dom.window.document.querySelector('#music-content .music-song-row[data-id="t3"]');
    const more = row && row.querySelector('.music-song-more, [data-song-more], button[aria-label*="More"]');
    assert.ok(more, 'precondition: the row has its more button');
    more.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 4; i++) await settle();
    const m = ctx.menus[ctx.menus.length - 1];
    assert.ok(m, 'the row menu opened');
    const item = m.items.find((x) => x.label === 'Start radio');
    assert.ok(item, 'Start radio is offered: ' + m.items.map((x) => x.label).join(', '));
    assert.strictEqual(item.icon, 'radio');
    item.onSelect();
    for (let i = 0; i < 10; i++) await settle();
    const calls = radioCalls(ctx);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].searchParams.get('seed'), 'track:t3', 'seeded from THIS song');
    assert.strictEqual(ctx.playerState.currentId, 't3', 'the song plays now');
    assert.strictEqual((ctxOf(ctx) || {}).radio, 'track:t3', 'the seed rides the context');
    await next(ctx);
    assert.strictEqual(ctx.playerState.currentId, 'r1', 'then the station');
  });
});

test('the album drill\'s Radio button starts the album\'s station (the first coherent pick plays)', async () => {
  await boot('http://localhost/music?play=t0', async (dom, ctx) => {
    const btn = dom.window.document.querySelector('#music-content .music-drill-radio');
    assert.ok(btn, 'the drill offers Radio');
    btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 10; i++) await settle();
    const calls = radioCalls(ctx);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].searchParams.get('seed'), 'album:' + AK, 'seeded from the album key');
    assert.strictEqual(ctx.playerState.currentId, 'r1', 'the station\'s first pick plays (the queue was replaced)');
  });
});

test('pocket letter jump: a level\'s trailing Start radio row is not a title (the S run stays the songs\')', () => {
  const items = ['Alpha', 'Beta', 'Ruby'].map((l) => ({ label: l, song: true })).concat([{ label: 'Start radio', action: 'radio', seed: 'genre:x' }]);
  const runs = skins.menuLetterRuns(items);
  assert.deepStrictEqual(runs.map((r) => [r.letter, r.index]), [['A', 0], ['B', 1], ['R', 2]], 'no S run for the action row');
});

test('the drill\'s Radio button shows only with a seed: an album or a named artist, never an unnamed artist (a button that does nothing is never shown)', () => {
  delete require.cache[musicPath];
  const M = require(musicPath);
  const has = (drill) => /music-drill-radio/.test(M.buildDrillHeaderHtml(drill, [{ id: 'a', title: 'A', artist: 'X', album: 'Y', albumKey: 'X␟Y' }], {}));
  assert.ok(has({ type: 'album', key: 'X␟Y', label: 'Y' }), 'an album');
  assert.ok(has({ type: 'artist', key: 'X', label: 'X' }), 'a named artist');
  assert.ok(!has({ type: 'artist', key: '', label: 'Unknown Artist' }), 'no seed, no button');
  delete require.cache[musicPath];
});
