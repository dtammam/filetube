'use strict';

// [UNIT] v1.221 chapter-albums, slice 4 (playback wiring). A virtual chapter-track
// (source 'library-chapter') plays the SHARED file (streamSrc /video/<file>) seeked
// to its chapterStartSec. Two binds: (1) BEHAVIOURAL - music.js's loadTrack builds
// the player `data` with the media routes + the chapterStartSec offset (jsdom mock
// player captures it); (2) SOURCE-LOCK the player's own handling (it has no jsdom
// harness - tech-debt #180): handleResumePlayback seeks to chapterStartSec BEFORE
// the music resume branch, and saveProgressToServer skips a chapter-track (its id
// is not a media id, so /api/progress would 404).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const PLAYER_JS = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <select id="music-sort-select"></select>
  <button id="music-view-toggle" hidden><i></i></button>
  <div id="player-slot"></div>
  <button class="music-nowplaying" id="music-nowplaying" hidden></button>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs"><button class="music-tab active" data-tab="songs" data-tab="songs">Songs</button></div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((resolve) => setImmediate(resolve));

// One chapter-track in the Songs list (the shape publicTrackListItem emits).
const CHAPTER_TRACK = {
  id: 'djmix1::c1', title: 'Track A', artist: 'NESTALGIA', album: 'The Mix', albumKey: 'NESTALGIA␟The Mix',
  durationSec: 600, source: 'library-chapter', streamSrc: '/video/djmix1', artUrl: '/thumbnail/djmix1',
  progressEndpoint: '/api/progress', chapterStartSec: 300,
};

test('v1.221 (slice 4): playing a chapter-track loads the SHARED file with the media routes + chapterStartSec', async () => {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  const loads = [];
  global.fetch = (url, init) => {
    const u = String(url); const method = (init && init.method) || 'GET';
    if (method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    // The Songs tab list AND the album drill both return our one chapter-track.
    if (u.indexOf('/api/music/albums') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    if (u.indexOf('/api/music/artists') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    if (u.indexOf('/api/music') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [CHAPTER_TRACK] }) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  let mod = null;
  dom.window.FileTube = {
    registerView: (name, m) => { mod = m; },
    encodeListContext: () => '', decodeListContext: () => null, shimmerArt: () => {},
    player: {
      currentId: null, getState: () => 'docked', expand: () => {}, setTrackNav: () => {},
      load: (id, data) => { loads.push({ id, data }); },
    },
  };
  try { dom.window.localStorage.setItem('filetube_music_tab', 'songs'); } catch (_) { /* ignore */ }
  try {
    delete require.cache[musicPath];
    require(musicPath);
    mod.init(dom.window.document.getElementById('view-root'));
    for (let i = 0; i < 10; i++) await settle();
    const row = dom.window.document.querySelector('.music-song-row');
    assert.ok(row, 'the chapter-track rendered as a song row');
    row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 10; i++) await settle();
    const load = loads.find((l) => l.id === 'djmix1::c1');
    assert.ok(load, 'the chapter-track was loaded into the player');
    assert.strictEqual(load.data.streamSrc, '/video/djmix1', 'streams the SHARED file (media route), not /track');
    assert.strictEqual(load.data.progressEndpoint, '/api/progress', 'the media progress endpoint, not /api/music/progress');
    assert.strictEqual(load.data.chapterStartSec, 300, 'carries the chapter seek offset');
  } finally {
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
});

test('v1.221 (slice 4, gate SUGGESTION): the FIRST chapter (chapterStartSec 0) carries 0 into the player data - never dropped as falsy', async () => {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  const loads = [];
  const intro = Object.assign({}, CHAPTER_TRACK, { id: 'djmix1::c0', title: 'Intro', chapterStartSec: 0 });
  global.fetch = (url, init) => {
    const method = (init && init.method) || 'GET';
    if (method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    if (String(url).indexOf('/api/music/albums') === 0 || String(url).indexOf('/api/music/artists') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    if (String(url).indexOf('/api/music') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [intro] }) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  let mod = null;
  dom.window.FileTube = {
    registerView: (name, m) => { mod = m; }, encodeListContext: () => '', decodeListContext: () => null, shimmerArt: () => {},
    player: { currentId: null, getState: () => 'docked', expand: () => {}, setTrackNav: () => {}, load: (id, data) => { loads.push({ id, data }); } },
  };
  try { dom.window.localStorage.setItem('filetube_music_tab', 'songs'); } catch (_) { /* ignore */ }
  try {
    delete require.cache[musicPath];
    require(musicPath);
    mod.init(dom.window.document.getElementById('view-root'));
    for (let i = 0; i < 10; i++) await settle();
    dom.window.document.querySelector('.music-song-row').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 10; i++) await settle();
    const load = loads.find((l) => l.id === 'djmix1::c0');
    assert.ok(load, 'the first chapter played');
    assert.strictEqual(load.data.chapterStartSec, 0, 'chapterStartSec 0 is carried as 0 (a number), not undefined - the seek to file start still fires');
  } finally {
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
});

test('v1.222 (slice 4 behavioural): a chapter-track load carries baseMediaId + chapterResumeSec from its saved progress', async () => {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  const loads = [];
  // The recent entry: chapter c1 of djmix1, resuming at file position 450 (the
  // server put resumeSec on the chapter's progress).
  const resumeTrack = Object.assign({}, CHAPTER_TRACK, { id: 'djmix1::c1', progress: { position: 150, duration: 600, updatedAt: 'x', resumeSec: 450 } });
  global.fetch = (url, init) => {
    const method = (init && init.method) || 'GET';
    if (method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    if (String(url).indexOf('/api/music/albums') === 0 || String(url).indexOf('/api/music/artists') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    if (String(url).indexOf('/api/music') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [resumeTrack] }) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  let mod = null;
  dom.window.FileTube = {
    registerView: (name, m) => { mod = m; }, encodeListContext: () => '', decodeListContext: () => null, shimmerArt: () => {},
    player: { currentId: null, getState: () => 'docked', expand: () => {}, setTrackNav: () => {}, load: (id, data) => { loads.push({ id, data }); } },
  };
  try { dom.window.localStorage.setItem('filetube_music_tab', 'songs'); } catch (_) { /* ignore */ }
  try {
    delete require.cache[musicPath];
    require(musicPath);
    mod.init(dom.window.document.getElementById('view-root'));
    for (let i = 0; i < 10; i++) await settle();
    dom.window.document.querySelector('.music-song-row').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 10; i++) await settle();
    const load = loads.find((l) => l.id === 'djmix1::c1');
    assert.ok(load, 'the chapter played');
    assert.strictEqual(load.data.baseMediaId, 'djmix1', 'the save id is the BASE file id (a real media id), not the ::c chapter id');
    assert.strictEqual(load.data.chapterResumeSec, 450, 'the resume seek is the saved absolute file position');
  } finally {
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
});

test('v1.222 (slice 4 SOURCE-LOCK): the player seeks a chapter-track to chapterResumeSec-else-chapterStartSec, BEFORE the music resume branch', () => {
  const fn = PLAYER_JS.slice(PLAYER_JS.indexOf('function handleResumePlayback'), PLAYER_JS.indexOf('function saveProgressToServer'));
  // resume seek prefers chapterResumeSec (the saved file position) and falls back
  // to the chapter head, then seeks via resumeDirectly.
  assert.match(fn, /typeof currentData\.chapterResumeSec === 'number'[\s\S]*?currentData\.chapterResumeSec[\s\S]*?currentData\.chapterStartSec/,
    'the chapter seek prefers the saved resume position, else the chapter head');
  assert.match(fn, /resumeDirectly\(chapterSeek\)/, 'and seeks there via resumeDirectly');
  // Still decided BEFORE the music resume branch (else it fetches /api/progress/<chapterId> and plays from 0).
  assert.ok(fn.indexOf("chapterStartSec === 'number'") < fn.indexOf("resumeMode === 'music'"),
    'the chapter seek is decided before the music resume branch');
});

test('v1.222 (slice 4 SOURCE-LOCK): saveProgressToServer records a chapter under baseMediaId (a real media id), never the synthetic ::c id', () => {
  const fn = PLAYER_JS.slice(PLAYER_JS.indexOf('function saveProgressToServer'), PLAYER_JS.indexOf('function saveProgressToServer') + 1400);
  // The save id is the base file id for a chapter, else the current id.
  assert.match(fn, /var saveId = isChapterSave \? currentData\.baseMediaId : currentId;/, 'a chapter saves under its base file id');
  assert.match(fn, /id: saveId,/, 'the POST body carries that id, not the ::c chapter id');
  // Guard: never POST a synthetic id if baseMediaId is somehow missing.
  assert.match(fn, /if \(isChapterSave && !\(currentData && currentData\.baseMediaId\)\) return;/,
    'a chapter with no baseMediaId skips (never 404s the synthetic id)');
});
