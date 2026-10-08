'use strict';

// [UNIT] v1.375.0 "radio that feels like radio" (plan docs/exec-plans/active/2026-10-08-v1375-radio-like-radio.md),
// END TO END (LESSONS 2, 5): the REAL music.js in jsdom, the REAL picker (lib/music/radio.js) behind a fake
// /api/music/radio that answers exactly as the route does (seed, exclude, queued, widen, count, rng), on the
// Kirby-shaped library (test/helpers/radio-kirby-library.js, the real chapter projection). Dean's case: he
// played Prince, then opened a Kirby album and pressed Radio; v1.368.0's session anchor turned the station
// into Pop, and Pop was mostly Prince. Each test plays a Pop session FIRST (10 Prince songs, the client's
// own play memory carries them to the server as `exclude`), then starts the Kirby station from one entry
// point, walks 25 plays with Next, and counts - over several client seeds, never one sample.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const common = require('../../public/js/common.js');
const radioLib = require('../../lib/music/radio');
const store = require('../../lib/music/store');
const { createSeededRng } = require('../../lib/videoQuery');
const K = require('../helpers/radio-kirby-library');

const LIB = K.buildLibrary().map((t) => Object.assign({ albumKey: store.albumKeyFor(t) }, t));
const byId = new Map(LIB.map((t) => [t.id, t]));
const PRINCE_ALBUM = LIB.filter((t) => t.album === 'Purple Rain');
const KIRBY = LIB.filter((t) => t.album === K.KIRBY_SETS.vapid); // Vapid's "2 Hours of Happy and Underrated Kirby Music"
const KIRBY_KEY = KIRBY[0].albumKey;

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
function seededRandom(seed) {
  let a = seed | 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const copy = (t) => Object.assign({}, t);

// the fake route: GET /api/music/radio exactly as lib/music/routes.js calls the picker
function radioAnswer(u) {
  const q = new URL(u, 'http://x').searchParams;
  const list = (q.get('exclude') || '').split(',').filter(Boolean).map(decodeURIComponent);
  const queued = (q.get('queued') || '').split(',').filter(Boolean).map(decodeURIComponent);
  const prof = radioLib.buildStationProfile(radioLib.parseSeed(q.get('seed')), LIB);
  const picks = prof ? radioLib.pickRadioBatch(prof, LIB, { exclude: list, queued, widen: q.get('widen') === '1', count: Number(q.get('count')) }, createSeededRng(Number(q.get('rng')))) : [];
  return { items: picks.map(copy) };
}

async function boot(url, run, seed) {
  const dom = new JSDOM(VIEW_HTML, { url });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController, fisherYatesShuffle: global.fisherYatesShuffle, random: Math.random };
  dom.window.localStorage.setItem('ft-music-autoplay', '0'); // the Pop session is played by hand, no station
  const playerState = { state: 'docked', currentId: null, meta: null };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  global.fisherYatesShuffle = common.fisherYatesShuffle;
  Math.random = seededRandom(seed);
  let registered = null;
  let lastNav = null;
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player: {
      currentId: null, getState: () => playerState.state, expand: () => { playerState.state = 'full'; },
      getCurrentMeta: () => playerState.meta,
      load: (id, data) => { playerState.currentId = id; dom.window.FileTube.player.currentId = id; const t = byId.get(id); playerState.meta = Object.assign({ isMusic: true, id }, t ? { title: t.title, artist: t.artist, album: t.album, albumKey: t.albumKey } : {}, { browseCtx: data && data.browseCtx }); },
      setTrackNav: (h) => { lastNav = h || null; },
      isLoopEnabled: () => false,
    },
  };
  global.window.addToQueue = () => {};
  const menus = [];
  dom.window.ui = { menu: (o) => { menus.push(o); } };
  dom.window.encodeListContext = common.encodeListContext;
  const urls = [];
  global.fetch = (u) => {
    const s = String(u);
    urls.push(s);
    const ok = (body) => Promise.resolve({ ok: true, json: async () => body });
    if (s.indexOf('/api/music/radio?') === 0) return ok(radioAnswer(s));
    const sp = new URL(s, 'http://x').searchParams;
    if (sp.has('album')) { const items = LIB.filter((t) => t.albumKey === sp.get('album')).map(copy); return ok({ items, total: items.length }); }
    if (/^\/api\/music\?/.test(s)) return ok({ items: PRINCE_ALBUM.map(copy), total: PRINCE_ALBUM.length });
    const idm = s.match(/^\/api\/music\/([^?/]+)$/);
    if (idm) return ok(copy(byId.get(decodeURIComponent(idm[1])) || {}));
    return ok({ items: [] });
  };
  const ctx = { playerState, urls, menus, getNav: () => lastNav };
  try {
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(dom.window.document.getElementById('view-root'));
    for (let i = 0; i < 12; i++) await settle();
    await run(dom, ctx);
    registered.destroy();
  } finally { delete require.cache[musicPath]; Math.random = saved.random; Object.assign(global, { window: saved.window, document: saved.document, localStorage: saved.localStorage, fetch: saved.fetch, AbortController: saved.AbortController, fisherYatesShuffle: saved.fisherYatesShuffle }); }
}

const ENTRY_POINTS = {
  // the album page's Radio button (the drill's .music-drill-radio): seed album:<key>
  'the album page Radio': async (dom, ctx) => {
    dom.window.document.querySelector('#music-content .music-drill-radio').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  },
  // a song's row menu > Start radio: seed track:<id>
  'a song\'s Start radio': async (dom, ctx) => {
    const row = dom.window.document.querySelector('#music-content .music-song-row[data-id="' + KIRBY[3].id + '"]');
    row.querySelector('.music-song-more').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 4; i++) await settle();
    ctx.menus[ctx.menus.length - 1].items.find((x) => x.label === 'Start radio').onSelect();
  },
  // Autoplay: the album's LAST song tapped with Autoplay on - the station is the song that runs out
  'Autoplay after the album': async (dom) => {
    const rows = dom.window.document.querySelectorAll('#music-content .music-song-row');
    rows[rows.length - 1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  },
};

async function playKirbyStation(entry, seed) {
  const out = { session: [], station: [], firstExclude: null, seeds: [] };
  await boot('http://localhost/music?play=' + PRINCE_ALBUM[0].id, async (dom, ctx) => {
    for (let i = 0; i < 9; i++) { ctx.getNav().onNext(); for (let k = 0; k < 4; k++) await settle(); }
    out.session = PRINCE_ALBUM.map((t) => t.id);
    assert.strictEqual(ctx.playerState.currentId, PRINCE_ALBUM[9].id, 'precondition: the Pop session played the whole Prince album');
    dom.window.localStorage.setItem('ft-music-autoplay', '1');
    // open the Kirby album as its Albums card does
    const card = dom.window.document.createElement('button');
    card.className = 'ui-tile music-album-card';
    card.setAttribute('data-album-key', KIRBY_KEY);
    dom.window.document.getElementById('music-content').appendChild(card);
    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 12; i++) await settle();
    assert.ok(dom.window.document.querySelector('#music-content .music-song-row[data-id="' + KIRBY[0].id + '"]'), 'precondition: the Kirby album page is open');
    const before = ctx.urls.length;
    await ENTRY_POINTS[entry](dom, ctx);
    for (let i = 0; i < 16; i++) await settle();
    const calls = ctx.urls.slice(before).filter((u) => u.indexOf('/api/music/radio?') === 0).map((u) => new URL(u, 'http://x').searchParams);
    assert.ok(calls.length >= 1, 'precondition: the station was asked');
    out.firstExclude = (calls[0].get('exclude') || '').split(',').map(decodeURIComponent);
    out.seeds = calls.map((c) => c.get('seed'));
    let cur = ctx.playerState.currentId;
    if (entry === 'Autoplay after the album') { // the album's last song plays first; the station follows it
      ctx.getNav().onNext(); for (let k = 0; k < 8; k++) await settle(); cur = ctx.playerState.currentId;
    }
    out.station.push(cur);
    while (out.station.length < 25) {
      const nav = ctx.getNav();
      if (!nav || typeof nav.onNext !== 'function') break;
      nav.onNext();
      for (let k = 0; k < 8; k++) await settle();
      out.station.push(ctx.playerState.currentId);
    }
  }, seed);
  return out;
}

for (const entry of Object.keys(ENTRY_POINTS)) {
  test('v1.375.0 Q1/Q3 end to end: after a Prince session, ' + entry + ' on a Kirby album plays Kirby from several channels first, then game music - never Prince (real client + real picker, 6 client seeds)', async () => {
    let kirbyFirst = 0; let prince = 0; let firstBatchKirby = 0; let real = 0; let plays = 0;
    const channels = new Set();
    const RUNS = 6;
    for (let s = 1; s <= RUNS; s += 1) {
      const r = await playKirbyStation(entry, 1000 + s);
      assert.ok(r.session.every((id) => r.firstExclude.includes(id)), 'precondition: the client TOLD the server the Pop session (exclude carries every Prince play)');
      assert.ok(r.seeds.every((x) => x === r.seeds[0]), 'one station seed for every batch: ' + r.seeds.join(' '));
      const t = r.station.map((id) => byId.get(id));
      assert.strictEqual(t.length, 25, 'the station played on for 25 songs (got ' + t.length + ')');
      plays += t.length;
      if (K.isKirby(t[0])) kirbyFirst += 1;
      firstBatchKirby += t.slice(0, 5).filter(K.isKirby).length;
      for (const x of t.slice(0, 10)) if (K.isKirby(x)) channels.add(x.albumArtist);
      prince += t.filter((x) => x.artist === 'Prince').length;
      real += t.filter(K.isRealGenre).length;
    }
    assert.strictEqual(prince, 0, 'Prince picks in ' + plays + ' station plays');
    assert.strictEqual(real, 0, 'real-genre (native non-game) picks in the first 25 plays of each station: ' + real);
    assert.strictEqual(kirbyFirst, RUNS, 'the first station song is Kirby (' + kirbyFirst + '/' + RUNS + ')');
    assert.ok(firstBatchKirby >= 3 * RUNS, 'the first 5 songs are mostly Kirby: ' + firstBatchKirby + ' of ' + 5 * RUNS);
    assert.ok(channels.size >= 4, 'Kirby from several channels, not only one: ' + [...channels].join(', '));
  });
}
