'use strict';

// [UNIT] v1.368.0 gate r1 (adversary W3, qa W2): Autoplay never goes silent because of the client. The
// REAL music.js in jsdom, the REAL picker (lib/music/radio.js) behind the faked route - the adversary's
// repro. (1) An album's LAST song tapped while nothing else is close by: the server must be told what
// the queue holds (exclude), or it hands back the album and the client drops it all. (2) A library
// too small for the exclude list: the server's recycle (R11) must be appended, not filtered out.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const common = require('../../public/js/common.js');

const AK = 'Band␟Record';
const TRACKS = [];
for (let n = 0; n < 9; n++) TRACKS.push({ id: 't' + n, title: 'Song ' + n, artist: 'Band', albumArtist: 'Band', album: 'Record', albumKey: AK, trackNo: n + 1, durationSec: 200, source: 'native', genre: 'Shoegaze', year: '1991', folderName: 'Band' });
const JAZZ = Array.from({ length: 50 }, (_, i) => ({ id: 'j' + i, title: 'Jazz ' + i, artist: 'Jazz ' + (i % 10), genre: 'Jazz', year: '1960', folderName: 'jazz' + (i % 10), durationSec: 200, source: 'native' }));
const radioLib = require('../../lib/music/radio'); const { createSeededRng } = require('../../lib/videoQuery');

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
  dom.window.localStorage.setItem('ft-music-autoplay', opts.autoplay ? '1' : '0'); // no station in these tests (W2 binds the append)
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
    if (s.indexOf('/api/music/radio?') === 0) { const q = new URL(s, 'http://x').searchParams; const L = opts.lib || TRACKS.concat(JAZZ); const prof = radioLib.buildStationProfile(radioLib.parseSeed(q.get('seed')), L); const picks = prof ? radioLib.pickRadioBatch(prof, L, { exclude: (q.get('exclude') || '').split(',').filter(Boolean), count: Number(q.get('count')) }, createSeededRng(Number(q.get('rng')))) : []; return Promise.resolve({ ok: true, json: async () => ({ items: picks.map((t) => Object.assign({}, t)) }) }); }
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




test('v1.368.0 gate r1 adversary W3: the album\'s LAST song tapped (Autoplay on, the real picker behind the route): the station appends', async () => {
  await boot('http://localhost/music?play=t0', async (dom, ctx) => {
    const row = dom.window.document.querySelector('#music-content .music-song-row[data-id="t8"]');
    row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 20; i++) await settle();
    assert.strictEqual(ctx.playerState.currentId, 't8', 'precondition: the last song plays');
    const calls = ctx.urls.filter((u) => u.indexOf('/api/music/radio?') === 0);
    const ex = new URL(calls[calls.length - 1], 'http://x').searchParams.get('exclude').split(',');
    assert.ok(['t0', 't3', 't7', 't8'].every((id) => ex.includes(id)), 'the queued album went to the server as the exclude list: ' + ex.join(','));
    assert.strictEqual(ex[ex.length - 1], 't8', 'the most recent play stays LAST (the spacing tail)');
    const nav = ctx.getNav();
    assert.ok(nav && typeof nav.onNext === 'function', 'the station lined up a next song (playback continues)');
  }, { autoplay: true });
});

test('v1.368.0 gate r1 qa W2: a library smaller than the session (everything already queued) - the server\'s RECYCLE is appended, never filtered into silence', async () => {
  await boot('http://localhost/music?play=t0', async (dom, ctx) => {
    const row = dom.window.document.querySelector('#music-content .music-song-row[data-id="t8"]');
    row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 20; i++) await settle();
    assert.strictEqual(ctx.playerState.currentId, 't8', 'precondition: the album\'s last song (the whole library) plays');
    const nav = ctx.getNav();
    assert.ok(nav && typeof nav.onNext === 'function', 'a recycled song was lined up');
    nav.onNext();
    for (let i = 0; i < 6; i++) await settle();
    assert.ok(/^t[0-7]$/.test(ctx.playerState.currentId), 'it is an album song behind the cursor, played again (' + ctx.playerState.currentId + ')');
  }, { autoplay: true, lib: TRACKS });
});
