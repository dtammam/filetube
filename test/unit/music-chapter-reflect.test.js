'use strict';

// [UNIT] v1.237 (Dean): a chaptered album is ONE file streamed by all its `::c` chapter
// tracks (chapterStartSec offsets). When playback ROLLS across a chapter boundary the
// player's currentId stays the loaded ::c id, so the now-playing title never updated. A
// timeupdate watcher (reflectChapter) re-derives the current chapter from currentTime and
// repaints the displayed identity WITHOUT reloading. Boots real music.js with a chaptered
// album + a driveable <div> media element, and binds the boundary-cross behaviourally.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
require('../../public/js/common.js');

const AK = 'DJ Mix␟Live Set';
// A chaptered file 'film' -> 3 virtual chapter tracks (ascending chapterStartSec), all one file.
const CHAPTERS = [
  { id: 'film::c0', title: 'Chapter One', artist: 'DJ', album: 'Live Set', albumKey: AK, durationSec: 120, source: 'library-chapter', chapterStartSec: 0, streamSrc: '/video/film' },
  { id: 'film::c1', title: 'Chapter Two', artist: 'DJ', album: 'Live Set', albumKey: AK, durationSec: 120, source: 'library-chapter', chapterStartSec: 120, streamSrc: '/video/film' },
  { id: 'film::c2', title: 'Chapter Three', artist: 'DJ', album: 'Live Set', albumKey: AK, durationSec: 120, source: 'library-chapter', chapterStartSec: 240, streamSrc: '/video/film' },
];
const RECENT = [CHAPTERS[0]];

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <select id="music-sort-select"></select>
  <button id="music-view-toggle" hidden><i></i></button>
  <div id="player-slot"></div>
  <video id="media-player"></video>
  <div id="music-nowplaying-panel" class="music-nowplaying-panel"></div>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((r) => setImmediate(r));

function fetchMap() {
  return (url, init) => {
    const method = (init && init.method) || 'GET';
    if (method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    if (url.indexOf('album=') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: CHAPTERS }) });
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: RECENT }) });
    const idm = url.match(/\/api\/music\/([^?]+)$/);
    if (idm) { const t = CHAPTERS.find((x) => x.id === decodeURIComponent(idm[1])); return Promise.resolve({ ok: true, json: async () => (t || {}) }); }
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
}

async function boot(url, run, opts) {
  opts = opts || {};
  const albumOrder = opts.chapters || CHAPTERS; // the /api/music?album= ordering (may be non-ascending)
  const dom = new JSDOM(VIEW_HTML, { url });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  const metaById = (id) => { const t = CHAPTERS.find((x) => x.id === id); return t ? { isMusic: true, id: t.id, title: t.title, artist: t.artist, album: t.album, albumKey: t.albumKey } : null; };
  const playerState = { state: 'docked', currentId: null, meta: null };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  let registered = null;
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player: {
      currentId: null, getState: () => playerState.state, expand: () => { playerState.state = 'full'; },
      getCurrentMeta: () => playerState.meta,
      load: (id) => { playerState.currentId = id; dom.window.FileTube.player.currentId = id; playerState.meta = metaById(id); }, setTrackNav: () => {},
    },
  };
  global.window.addToQueue = () => {};
  global.fetch = (url2) => (String(url2).indexOf('album=') !== -1 ? Promise.resolve({ ok: true, json: async () => ({ items: albumOrder }) }) : fetchMap()(url2));
  const root = () => dom.window.document.getElementById('view-root');
  const ctx = { playerState, dom, reinit: async () => { registered.destroy(); registered.init(root()); for (let i = 0; i < 10; i++) await settle(); } };
  try {
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(root());
    for (let i = 0; i < 10; i++) await settle();
    await run(dom, ctx);
    registered.destroy();
  } finally { delete require.cache[musicPath]; Object.assign(global, saved); }
}

const playingId = (dom) => { const r = dom.window.document.querySelector('#music-content .music-song-row.playing'); return r ? r.getAttribute('data-id') : null; };

test('v1.237: playback rolling across a chapter boundary re-reflects the CURRENT chapter (no reload)', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    assert.strictEqual(playingId(dom), 'film::c0', 'starts on chapter one');
    const mp = dom.window.document.getElementById('media-player');
    // the file rolls into chapter two (>= 120s) - fire timeupdate WITHOUT any reload
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 130 });
    mp.dispatchEvent(new dom.window.Event('timeupdate'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c1', 'the current-chapter highlight advanced to chapter two on the boundary cross');
    // and into chapter three
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 250 });
    mp.dispatchEvent(new dom.window.Event('timeupdate'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c2', 'and to chapter three');
  });
});

test('v1.237: a within-chapter timeupdate does NOT churn the identity (only a boundary cross)', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    const mp = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 40 }); // still in chapter one
    mp.dispatchEvent(new dom.window.Event('timeupdate'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c0', 'staying inside chapter one keeps the identity');
  });
});

// ---- source locks ----------------------------------------------------------------------
test('v1.237: the chapter watcher is wired (timeupdate -> reflectChapter) and the renders prefer chapterViewId', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  assert.match(js, /addEventListener\('timeupdate', reflectChapter/, 'reflectChapter is bound to timeupdate (ensureChapterReflect)');
  assert.match(js, /chapterViewId = isChapter \? item\.id : null/, 'loadTrack seeds chapterViewId from the loaded chapter');
  // the base-gated effective id: prefer chapterViewId ONLY while the loaded chaptered file is
  // still the live track (gate W1) - used by BOTH the web render and the pop-out.
  assert.match(js, /function effectiveCurrentId\(\)/, 'the base-gated effective-current-id helper exists');
  assert.match(js, /replace\(\/::c\\d\+\$\/, ''\) === String\(live\)\.replace\(\/::c\\d\+\$\/, ''\)/, 'the override is gated on the live track sharing the chaptered file base');
  const prefers = js.match(/var curId = effectiveCurrentId\(\);/g) || [];
  assert.ok(prefers.length >= 2, 'updateNowPlayingPanel AND currentSkinIndex both use effectiveCurrentId');
  assert.match(js, /var currentId = effectiveCurrentId\(\);/, 'the "Playing from" label uses it too (W2)');
  const m = /function currentChapterId\(\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(m, 'currentChapterId exists');
  assert.match(m[1], /chapterStartSec/, 'derives the current chapter from chapterStartSec boundaries');
  assert.match(m[1], /library-chapter/, 'only over the loaded file\'s chapter tracks');
  assert.match(m[1], /\.slice\(\)\.sort\(/, 'sorts the chapter tracks by chapterStartSec (order-independent - gate W2)');
});

test('v1.237 (W2): the current chapter is derived order-independently (a sorted/shuffled album)', async () => {
  const reversed = [CHAPTERS[2], CHAPTERS[1], CHAPTERS[0]]; // Title Z-A / Longest / Shuffle can reverse queue order
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    const mp = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 130 }); // inside chapter two (120-240)
    mp.dispatchEvent(new dom.window.Event('timeupdate'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c1', 'derived chapter two despite the non-ascending queue order (not chaps[0])');
  }, { chapters: reversed });
});

test('v1.237 (W1): a dock-return mid-album does NOT blank the now-playing panel (stale chapterViewId reset on reseed)', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const mp = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 130 });
    mp.dispatchEvent(new dom.window.Event('timeupdate')); await settle(); // chapterViewId advanced to film::c1
    assert.strictEqual(playingId(dom), 'film::c1', 'rolled into chapter two');
    // a real dock-return re-inits WITHOUT ?play= (it seeds from the live player, no reload). The
    // SAME module instance keeps the survived chapterViewId (=film::c1); seedNowPlayingFromPlayer
    // must reset it to the live loaded id (film::c0) so the guard doesn't blank the panel.
    dom.reconfigure({ url: 'http://localhost/music?nowplaying=1' });
    await ctx.reinit();
    const mp2 = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp2, 'currentTime', { configurable: true, value: 130 });
    mp2.dispatchEvent(new dom.window.Event('timeupdate')); await settle();
    const panel = dom.window.document.getElementById('music-nowplaying-panel');
    assert.strictEqual(panel.hidden, false, 'the panel is NOT blanked after the dock-return (stale chapterViewId reset on reseed)');
  });
});

// NOTE: the adversarial's cross-media hide (a video live after a chaptered session must not
// show stale music) is covered by the effectiveCurrentId base-gate SOURCE-LOCK above - jsdom
// hides that panel via other init guards regardless of the gate, so a behavioral here would be
// vacuous (it passed even with the gate mutated off). The base-compare in effectiveCurrentId is
// the real bind; the W1 dock-return behavioral binds the reset discipline.

test('v1.237 (tolerance): the -0.25 anti-flicker band advances JUST before the exact boundary', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    const mp = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 119.8 }); // 119.8 >= 120 - 0.25 = 119.75
    mp.dispatchEvent(new dom.window.Event('timeupdate'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c1', 'crossed into chapter two within the tolerance band (-0.25), not at the exact 120');
  });
});

test('v1.237 (W1 neg): a non-music video on the shared host HIDES stale music (base-gate falls to live)', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const mp = dom.window.document.getElementById('media-player');
    ctx.playerState.state = 'full';                 // expanded, so the panel show/hide branch is reached
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 130 });
    mp.dispatchEvent(new dom.window.Event('timeupdate'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c1', 'rolled into chapter two (chapterViewId advanced to film::c1)');

    // A NON-MUSIC video becomes the live track WITHOUT a music loadTrack; its id shares no base
    // with the chaptered file. isMusic:false makes seedNowPlayingFromPlayer early-return, so
    // nowPlaying STAYS the stale film::c1 (== the stale chapterViewId) - the exact poison setup.
    ctx.playerState.currentId = 'clip-xyz';
    dom.window.FileTube.player.currentId = 'clip-xyz';
    ctx.playerState.meta = { isMusic: false, id: 'clip-xyz', title: 'Home Movie' };
    ctx.playerState.state = 'full';
    dom.reconfigure({ url: 'http://localhost/music' });  // plain nav back, no ?play=
    await ctx.reinit();

    const panel = dom.window.document.getElementById('music-nowplaying-panel');
    assert.strictEqual(panel.hidden, true,
      'the now-playing panel HIDES stale music while a non-music video plays (effectiveCurrentId falls to the live id)');
  });
});
