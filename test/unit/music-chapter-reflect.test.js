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

async function boot(url, run) {
  const dom = new JSDOM(VIEW_HTML, { url });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  const playerState = { state: 'docked', currentId: null };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  let registered = null;
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player: {
      currentId: null, getState: () => playerState.state, expand: () => { playerState.state = 'full'; },
      getCurrentMeta: () => playerState.meta || null,
      load: (id) => { playerState.currentId = id; dom.window.FileTube.player.currentId = id; }, setTrackNav: () => {},
    },
  };
  global.window.addToQueue = () => {};
  global.fetch = fetchMap();
  try {
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(dom.window.document.getElementById('view-root'));
    for (let i = 0; i < 10; i++) await settle();
    await run(dom);
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
  // both the in-tab/web render (updateNowPlayingPanel) and the pop-out (currentSkinIndex) prefer it
  const prefers = js.match(/var curId = chapterViewId \|\| \(p && p\.currentId\) \|\| null;/g) || [];
  assert.ok(prefers.length >= 2, 'updateNowPlayingPanel AND currentSkinIndex prefer chapterViewId over player.currentId');
  const m = /function currentChapterId\(\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(m, 'currentChapterId exists');
  assert.match(m[1], /chapterStartSec/, 'derives the current chapter from chapterStartSec boundaries');
  assert.match(m[1], /library-chapter/, 'only over the loaded file\'s chapter tracks');
});
