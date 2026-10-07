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
const RADIO = [{ id: 'r1', title: 'Radio One', artist: 'Kin', durationSec: 200, source: 'native' }, { id: 'r2', title: 'Radio Two', artist: 'Kin 2', durationSec: 200, source: 'native' }];

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
  dom.window.localStorage.setItem('ft-music-autoplay', opts.autoplay ? '1' : '0'); // opts.autoplay: a station (RADIO) appends
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
    if (opts.gate && opts.gate(s)) return opts.gate(s); // a held response (a race window)
    if (s.indexOf('/api/music/radio?') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: RADIO.map((t) => Object.assign({}, t)) }) });
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

// v1.368.0 gate r1 (adversary W5): a Shuffle flip while a drill load is in flight (drill AHEAD of queue)
// must not paint the new album's header over the old album's rows (the v1.273 W1 class). The adversary's repro.
test('v1.368.0 gate r1 adversary W5: a Shuffle flip from another tab while a drill load is in flight never paints the NEW drill header over the OLD rows', async () => {
  let release = null;
  const held = new Promise((r) => { release = r; });
  const B = [{ id: 'b0', title: 'B Song', artist: 'Other', albumArtist: 'Other', album: 'Second', albumKey: 'Other␟Second', trackNo: 1, durationSec: 200, source: 'native' }];
  const gate = (s) => (s.indexOf('album=' + encodeURIComponent('Other␟Second')) !== -1) ? held.then(() => ({ ok: true, json: async () => ({ items: B }) })) : null;
  await boot('http://localhost/music?play=t0', async (dom, ctx) => {
    await next(ctx); // t1 playing (so there is a tail after it)
    // drill into album B (its load is held open): drill = B, queue still = album A
    registeredOpenDrill(dom);
    for (let i = 0; i < 4; i++) await settle();
    dom.window.localStorage.setItem('ft-music-shuffle', '1');
    dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'ft-music-shuffle', newValue: '1' }));
    const title = dom.window.document.querySelector('#music-content .music-drill-header, #music-content .music-drill');
    const head = title ? title.textContent : '';
    const rowIdsNow = rowIds(dom);
    release();
    for (let i = 0; i < 10; i++) await settle();
    assert.ok(!(/Second/.test(head) && rowIdsNow.some((id) => /^t\d$/.test(id))), 'album B\'s header never sits over album A\'s rows');
  }, { gate });
});
function registeredOpenDrill(dom) {
  // the drill header's album-card path: an album card click drills (shared #music-content delegation)
  const content = dom.window.document.getElementById('music-content');
  const card = dom.window.document.createElement('div');
  card.className = 'music-album-card';
  card.setAttribute('data-album-key', 'Other␟Second');
  card.innerHTML = '<span class="music-album-title">Second</span>';
  content.appendChild(card);
  card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

// v1.368.0 gate r1 (adversary W6): Shuffle never mixes station picks ahead of YOUR songs - after Prev
// back into your songs, Shuffle ON, then a silent Autoplay-off: Next plays your song. The adversary's repro.
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
test('v1.368.0 gate r1 adversary W6 seed ' + seed + ': Shuffle ON after the station was appended, then Autoplay off arrives silently: Next still plays YOUR remaining songs', async () => {
  await boot('http://localhost/music?play=t0', async (dom, ctx) => {
    dom.window.document.querySelector('#music-content .music-song-row[data-id="t8"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 10; i++) await settle();
    assert.ok(ctx.getNav() && ctx.getNav().onNext, 'precondition: the station was appended after t8');
    ctx.getNav().onPrev(); for (let i = 0; i < 4; i++) await settle();
    ctx.getNav().onPrev(); for (let i = 0; i < 4; i++) await settle();
    assert.strictEqual(ctx.playerState.currentId, 't6');
    dom.window.document.getElementById('music-shufflemode-btn').click();
    for (let i = 0; i < 4; i++) await settle();
    const order = [...dom.window.document.querySelectorAll('#music-content .music-song-row')].map((r) => r.getAttribute('data-id'));
    dom.window.localStorage.setItem('ft-music-autoplay', '0'); // prefs-sync: a silent write from another device
    ctx.getNav().onNext(); for (let i = 0; i < 4; i++) await settle();
    assert.ok(ctx.playerState.currentId === 't7' || ctx.playerState.currentId === 't8', 'Next played one of your own songs (t7/t8), got ' + ctx.playerState.currentId + ' (rows after Shuffle ON: ' + order.join(' ') + ')');
  }, { autoplay: true, seed });
});
}

// v1.368.0 gate r1 (adversary M3, shuffleCarry): a station batch appended WHILE shuffled keeps the shuffle
// state (the append makes a new queue array); OFF then restores your songs' order with the picks after.
test('v1.368.0 gate r1 M3: a batch appended while shuffled keeps the shuffle - OFF restores your order with the station after it', async () => {
  await boot('http://localhost/music?play=t0', async (dom, ctx) => {
    chip(dom).click(); // ON at t0: your songs shuffled
    const shuffled = rowIds(dom);
    assert.notDeepStrictEqual(shuffled, IDS, 'precondition: shuffled');
    for (let k = 0; k < 8; k++) await next(ctx); // walk to the last of your songs: the station appends
    for (let i = 0; i < 6; i++) await settle();
    assert.strictEqual(ctx.urls.filter((u) => u.indexOf('/api/music/radio?') === 0).length, 1, 'precondition: the station was fetched at your last song');
    // back up two of your songs so there IS something to restore, then OFF
    ctx.getNav().onPrev(); await settle(); await settle();
    ctx.getNav().onPrev(); await settle(); await settle();
    chip(dom).click(); // OFF
    const order = (await playOrder(ctx)).slice(1, 5); // the next four plays
    const mine = order.filter((id) => /^t/.test(id));
    assert.strictEqual(mine.length, 2, 'two of your songs remain: ' + order.join(' '));
    assert.deepStrictEqual(mine, IDS.filter((id) => mine.includes(id)), 'your remaining songs come back in album order');
    assert.deepStrictEqual(order.slice(2), ['r1', 'r2'], 'and the station follows them, in station order: ' + order.join(' '));
  }, { autoplay: true });
});
