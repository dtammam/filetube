'use strict';

// [UNIT] v1.368.0 (plan docs/exec-plans/active/2026-10-06-v1368-music-radio.md, W3, R5 + R16): the
// Shuffle MODE toggle. Boots the REAL music.js on an album drill (?play=), drives the REAL desktop
// chip (#music-shufflemode-btn), the storage event another tab fires, and a prefs-sync flip that
// lands in storage silently. Binds: ON keeps the playing song and the played prefix byte-identical
// and permutes the rest; OFF restores the exact original order; a queue STARTED while ON is shuffled
// (R16); rows on screen follow the queue (data-index -> id, the wrong-track class); the one-shot
// Shuffle button never writes the mode.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const common = require('../../public/js/common.js');

const AK = 'Band␟Record';
const TRACKS = [];
for (let n = 0; n < 9; n++) TRACKS.push({ id: 't' + n, title: 'Song ' + n, artist: 'Band', albumArtist: 'Band', album: 'Record', albumKey: AK, trackNo: n + 1, durationSec: 200, source: 'native' });
const IDS = TRACKS.map((t) => t.id);

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
      load: (id) => { playerState.currentId = id; dom.window.FileTube.player.currentId = id; playerState.meta = metaById(id); },
      setTrackNav: (h) => { lastNav = h || null; },
      isLoopEnabled: () => false,
    },
  };
  global.window.addToQueue = () => {};
  const urls = [];
  global.fetch = (u) => {
    const s = String(u);
    urls.push(s);
    if (s.indexOf('album=') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: TRACKS.map((t) => Object.assign({}, t)) }) });
    // the Songs tab's list (a NEW queue array, list order = the album order here)
    if (/\/api\/music\?/.test(s) && s.indexOf('filter=') === -1 && s.indexOf('sort=random') === -1) return Promise.resolve({ ok: true, json: async () => ({ items: TRACKS.map((t) => Object.assign({}, t)), total: TRACKS.length }) });
    const idm = s.match(/\/api\/music\/([^?]+)$/);
    if (idm) { const t = TRACKS.find((x) => x.id === decodeURIComponent(idm[1])); return Promise.resolve({ ok: true, json: async () => Object.assign({}, t || {}) }); }
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  const root = () => dom.window.document.getElementById('view-root');
  const ctx = { playerState, urls, getNav: () => lastNav };
  try {
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(root());
    for (let i = 0; i < 10; i++) await settle();
    await run(dom, ctx);
    registered.destroy();
  } finally { delete require.cache[musicPath]; Math.random = saved.random; Object.assign(global, { window: saved.window, document: saved.document, localStorage: saved.localStorage, fetch: saved.fetch, AbortController: saved.AbortController, fisherYatesShuffle: saved.fisherYatesShuffle }); }
}

// the rows on screen, in order, as [data-index, data-id]
const rows = (dom) => [...dom.window.document.querySelectorAll('#music-content .music-song-row')].map((r) => [Number(r.getAttribute('data-index')), r.getAttribute('data-id')]);
const rowIds = (dom) => rows(dom).map((r) => r[1]);
const chip = (dom) => dom.window.document.getElementById('music-shufflemode-btn');
// walk Next from the playing song to the end of the queue: the PLAY order, read through the nav
async function playOrder(ctx) {
  const out = [ctx.playerState.currentId];
  for (let k = 0; k < 20; k++) {
    const nav = ctx.getNav();
    if (!nav || typeof nav.onNext !== 'function') break;
    nav.onNext();
    await settle(); await settle();
    out.push(ctx.playerState.currentId);
  }
  return out;
}
async function next(ctx) { ctx.getNav().onNext(); await settle(); await settle(); }

test('ON keeps the playing song and the played prefix byte-identical and permutes the rest; the rows follow the queue', async () => {
  await boot('http://localhost/music?play=t0', async (dom, ctx) => {
    assert.deepStrictEqual(rowIds(dom), IDS, 'precondition: the album drill lists the album in order');
    await next(ctx); await next(ctx); // t0 -> t1 -> t2 (played prefix t0, t1)
    assert.strictEqual(ctx.playerState.currentId, 't2');
    assert.strictEqual(chip(dom).getAttribute('aria-pressed'), 'false');
    chip(dom).click();
    assert.strictEqual(dom.window.localStorage.getItem('ft-music-shuffle'), '1', 'the chip wrote the synced pref');
    assert.strictEqual(chip(dom).getAttribute('aria-pressed'), 'true');
    const after = rowIds(dom);
    assert.deepStrictEqual(after.slice(0, 3), ['t0', 't1', 't2'], 'the played prefix and the playing song stay put');
    assert.notDeepStrictEqual(after.slice(3), IDS.slice(3), 'the rest is in a new order');
    assert.deepStrictEqual([...after.slice(3)].sort(), IDS.slice(3).sort(), 'and it is the same songs');
    assert.deepStrictEqual(rows(dom).map((r) => r[0]), IDS.map((_, i) => i), 'every row\'s data-index is its place in the queue (no wrong-track rows)');
    assert.strictEqual(ctx.playerState.currentId, 't2', 'the playing song is untouched');
    const order = await playOrder(ctx);
    assert.deepStrictEqual(order, after.slice(2), 'Next walks the shuffled order');
  });
});

test('OFF restores the EXACT original order of the songs not yet played', async () => {
  await boot('http://localhost/music?play=t0', async (dom, ctx) => {
    chip(dom).click(); // ON at t0
    const shuffled = rowIds(dom);
    assert.notDeepStrictEqual(shuffled, IDS, 'precondition: shuffled');
    await next(ctx); await next(ctx); // two songs into the shuffled order
    const playing = ctx.playerState.currentId;
    const playedSoFar = shuffled.slice(0, 3);
    assert.strictEqual(playing, playedSoFar[2]);
    chip(dom).click(); // OFF
    assert.strictEqual(dom.window.localStorage.getItem('ft-music-shuffle'), '0');
    const restored = rowIds(dom);
    assert.deepStrictEqual(restored.slice(0, 3), playedSoFar, 'what was played stays where it was');
    assert.deepStrictEqual(restored.slice(3), IDS.filter((id) => !playedSoFar.includes(id)), 'the rest is back in album order');
  });
});

test('R16: a queue STARTED while Shuffle is on plays shuffled (the tapped song first, the rest random)', async () => {
  await boot('http://localhost/music?play=t4', async (dom, ctx) => {
    assert.strictEqual(chip(dom).getAttribute('aria-pressed'), 'true', 'the chip reflects the stored mode');
    const ids = rowIds(dom);
    assert.deepStrictEqual(ids.slice(0, 5), IDS.slice(0, 5), 'the songs before the tapped one keep their place');
    assert.notDeepStrictEqual(ids.slice(5), IDS.slice(5), 'the songs after it are shuffled');
    assert.deepStrictEqual([...ids.slice(5)].sort(), IDS.slice(5).sort());
    assert.strictEqual(ctx.playerState.currentId, 't4');
  }, { shuffle: true, seed: 11 });
});

test('another TAB flips the mode (storage event): this tab reorders now; a prefs-sync flip (silent storage write) applies at the next song', async () => {
  await boot('http://localhost/music?play=t0', async (dom, ctx) => {
    dom.window.localStorage.setItem('ft-music-shuffle', '1');
    dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'ft-music-shuffle', newValue: '1' }));
    assert.notDeepStrictEqual(rowIds(dom).slice(1), IDS.slice(1), 'the storage event reordered the queue');
    assert.strictEqual(chip(dom).getAttribute('aria-pressed'), 'true', 'and the chip reflects it');
    dom.window.localStorage.setItem('ft-music-shuffle', '0'); // prefs-sync: no event
    const before = rowIds(dom);
    assert.deepStrictEqual(rowIds(dom), before, 'a silent write changes nothing yet');
    await next(ctx); // the next song's registerTrackNav reconciles
    const now = rowIds(dom);
    const at = now.indexOf(ctx.playerState.currentId);
    assert.deepStrictEqual(now.slice(at + 1), IDS.filter((id) => !now.slice(0, at + 1).includes(id)), 'the flip applied at the next song: the rest is back in album order');
  });
});

test('R16: a NEW queue after an earlier shuffle is shuffled afresh (the old queue\'s restore order never carries over)', async () => {
  await boot('http://localhost/music?play=t0', async (dom, ctx) => {
    chip(dom).click(); // ON: the album queue is shuffled
    assert.notDeepStrictEqual(rowIds(dom).slice(1), IDS.slice(1), 'precondition: the album queue is shuffled');
    // the Songs tab lists the library: a NEW queue array holding the playing song
    dom.window.document.querySelector('.music-tab[data-tab="songs"]').click();
    for (let i = 0; i < 10; i++) await settle();
    assert.ok(ctx.urls.some((u) => /\/api\/music\?/.test(u) && u.indexOf('album=') === -1), 'precondition: the Songs list was fetched');
    await next(ctx); // the next song re-arms the nav around the NEW queue: R16 shuffles it there
    const ids = rowIds(dom);
    const at = ids.indexOf(ctx.playerState.currentId);
    assert.ok(at >= 0 && ids.length === IDS.length, 'precondition: the Songs list holds the playing song');
    assert.notDeepStrictEqual(ids.slice(at + 1), IDS.filter((id) => !ids.slice(0, at + 1).includes(id)), 'the new queue is shuffled after the playing song');
    assert.deepStrictEqual(rows(dom).map((r) => r[0]), IDS.map((_, i) => i), 'rows index the new queue');
  }, { seed: 5 });
});

test('the one-shot Shuffle all button never writes the mode', async () => {
  await boot('http://localhost/music?play=t0', async (dom) => {
    dom.window.document.getElementById('music-shuffle-btn').click();
    for (let i = 0; i < 5; i++) await settle();
    assert.strictEqual(dom.window.localStorage.getItem('ft-music-shuffle'), null, 'the mode is untouched');
  });
});
