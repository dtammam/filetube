'use strict';

// [UNIT] v1.207 (Dean) - the music player defaults to the ALBUM view when you
// pick a song, and that view persists across the mini-player round-trip. Boots
// the REAL music.js init() in jsdom with a mock persistent player + a fetch map
// that serves the album, and asserts the browse view becomes the album drill.
// (The music view's interaction wiring is otherwise device-validated; this
// binds the two new paths - play-drills-into-album and dock-return-restores-
// album - behaviourally.)

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
require('../../public/js/common.js'); // window-gated boot is inert (window still undefined here)

const ALBUM_KEY = 'Pink Floyd␟The Wall';
// Album tracks returned for /api/music?album=<ALBUM_KEY>
const ALBUM = [
  { id: 't1', title: 'In the Flesh', artist: 'Pink Floyd', album: 'The Wall', albumKey: ALBUM_KEY, durationSec: 200 },
  { id: 't2', title: 'The Thin Ice', artist: 'Pink Floyd', album: 'The Wall', albumKey: ALBUM_KEY, durationSec: 150 },
  { id: 't3', title: 'Another Brick', artist: 'Pink Floyd', album: 'The Wall', albumKey: ALBUM_KEY, durationSec: 240 },
];
// A recent-listening list (the ?play= queue) containing the target track + a
// loose (album-less) track.
const RECENT = [
  { id: 't2', title: 'The Thin Ice', artist: 'Pink Floyd', album: 'The Wall', albumKey: ALBUM_KEY, durationSec: 150 },
  { id: 'loose', title: 'A Loose File', artist: 'Nobody', album: '', albumKey: '', durationSec: 90 },
];

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div id="player-slot"></div>
  <div id="media-player"></div>
  <div id="music-nowplaying-panel"></div>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
    <button type="button" class="music-tab" data-tab="artists" role="tab">Artists</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((resolve) => setImmediate(resolve));

function fetchMapFor(opts) {
  return (url, init) => {
    const method = (init && init.method) || 'GET';
    if (method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) }); // resume etc.
    if (url.indexOf('/api/music/albums') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    if (url.indexOf('/api/music/artists') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    if (url.indexOf('album=') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: ALBUM }) });
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: RECENT }) });
    const idMatch = url.match(/\/api\/music\/([^?]+)$/);
    if (idMatch) { const t = RECENT.concat(ALBUM).find((x) => x.id === decodeURIComponent(idMatch[1])); return Promise.resolve({ ok: true, json: async () => (t || {}) }); }
    if (url.indexOf('/api/music') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: (opts && opts.songs) || [] }) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
}

async function boot(url, playerState, opts, run) {
  const dom = new JSDOM(VIEW_HTML, { url });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  const calls = { load: [], setTrackNav: [], expand: [] };
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.AbortController = dom.window.AbortController;
  let registered = null;
  dom.window.FileTube = {
    registerView: (name, mod) => { registered = mod; },
    encodeListContext: (ctx) => JSON.stringify(ctx),
    decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } },
    shimmerArt: () => {},
    player: {
      currentId: playerState.currentId || null,
      getState: () => playerState.state,
      expand: (slot) => { calls.expand.push(slot); playerState.state = 'full'; },
      getCurrentMeta: () => playerState.meta || null,
      load: (id, data, o) => { calls.load.push({ id, data, o }); playerState.currentId = id; },
      setTrackNav: (nav) => { calls.setTrackNav.push(nav); },
    },
  };
  global.window.addToQueue = () => {};
  global.fetch = fetchMapFor(opts);
  if (opts && opts.tabPref) { try { dom.window.localStorage.setItem('filetube_music_tab', opts.tabPref); } catch (_) { /* ignore */ } }
  try {
    delete require.cache[musicPath];
    require(musicPath);
    assert.ok(registered && typeof registered.init === 'function', 'view registered');
    registered.init(dom.window.document.getElementById('view-root'));
    for (let i = 0; i < 8; i++) await settle();
    await run(dom, calls);
    registered.destroy();
  } finally {
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
}

const content = (dom) => dom.window.document.getElementById('music-content');

test('v1.207: a ?play= song opens its ALBUM view (the drill), not the flat song list', async () => {
  await boot('http://localhost/music?play=t2', { state: 'docked', currentId: null }, {}, async (dom, calls) => {
    const html = content(dom).innerHTML;
    assert.match(html, /music-drill/, 'the browse view is the album drill');
    // all three album tracks are the queue/list (not just the one recent track)
    for (const t of ['In the Flesh', 'The Thin Ice', 'Another Brick']) assert.ok(html.includes(t), `album track ${t} shown`);
    // the tapped track actually started playing, from within the album
    assert.ok(calls.load.some((c) => c.id === 't2'), 'the picked track loaded into the player');
  });
});

test('v1.207: a ?play= song with NO album stays in the flat list (album-less -> no drill, Dean)', async () => {
  await boot('http://localhost/music?play=loose', { state: 'docked', currentId: null }, {}, async (dom, calls) => {
    const html = content(dom).innerHTML;
    assert.doesNotMatch(html, /music-drill/, 'no album to drill into -> stays the song list');
    assert.match(html, /music-song-list/, 'the flat list rendered');
    assert.ok(calls.load.some((c) => c.id === 'loose'), 'the loose track still played');
  });
});

test('v1.207: returning via the mini-player (?nowplaying=1) restores the now-playing track ALBUM view', async () => {
  const meta = { isMusic: true, id: 't2', title: 'The Thin Ice', artist: 'Pink Floyd', album: 'The Wall', albumKey: ALBUM_KEY, browseCtx: JSON.stringify({ src: 'music', album: ALBUM_KEY }) };
  await boot('http://localhost/music?nowplaying=1', { state: 'docked', currentId: 't2', meta }, {}, async (dom, calls) => {
    const html = content(dom).innerHTML;
    assert.match(html, /music-drill/, 'the browse view is restored to the album drill (persists across the round-trip)');
    assert.ok(html.includes('The Thin Ice') && html.includes('Another Brick'), 'the album tracks are the list');
    assert.equal(calls.expand.length, 1, 'the docked player still expanded into #player-slot (unchanged)');
    // Prev/Next were registered around the playing track inside the restored album queue
    assert.ok(calls.setTrackNav.length >= 1, 'lock-screen nav registered for the restored album queue');
  });
});

test('v1.207: tapping a song ROW in the flat Songs list drills into its album (every new song -> album, Dean)', async () => {
  const songs = [
    { id: 't2', title: 'The Thin Ice', artist: 'Pink Floyd', album: 'The Wall', albumKey: ALBUM_KEY, durationSec: 150 },
    { id: 'loose', title: 'A Loose File', artist: 'Nobody', album: '', albumKey: '', durationSec: 90 },
  ];
  await boot('http://localhost/music', { state: 'docked', currentId: null }, { songs, tabPref: 'songs' }, async (dom, calls) => {
    const doc = dom.window.document;
    // sanity: the flat songs list rendered first
    assert.match(content(dom).innerHTML, /music-song-list/, 'songs tab rendered the flat list');
    const row = doc.querySelector('.music-song-row[data-id="t2"]');
    assert.ok(row, 'the target song row exists');
    row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.match(content(dom).innerHTML, /music-drill/, 'the row tap drilled into the album');
    assert.ok(content(dom).innerHTML.includes('Another Brick'), 'the album (not just the tapped song) is now the list');
    assert.ok(calls.load.some((c) => c.id === 't2'), 'the tapped song is playing, from the album');
  });
});

test('v1.207: a plain /music visit (no nowplaying, no play) is UNCHANGED - default tab, no forced drill', async () => {
  const meta = { isMusic: true, id: 't2', albumKey: ALBUM_KEY };
  await boot('http://localhost/music', { state: 'docked', currentId: 't2', meta }, {}, async (dom) => {
    // default tab is artists (a grid), NOT the album drill - we only force the
    // album on an explicit dock-return or a fresh play.
    assert.doesNotMatch(content(dom).innerHTML, /music-drill/, 'a plain visit does not force the album drill');
  });
});
