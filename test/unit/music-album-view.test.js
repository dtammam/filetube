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
  <select id="music-sort-select"></select>
  <button id="music-view-toggle" hidden><i></i></button>
  <div id="player-slot"></div>
  <div id="media-player"></div>
  <div id="music-nowplaying-panel"></div>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
    <button type="button" class="music-tab" data-tab="artists" role="tab">Artists</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((resolve) => setImmediate(resolve));

function fetchMapFor(opts, calls) {
  return (url, init) => {
    if (calls) calls.fetches.push(url);
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
  const calls = { load: [], setTrackNav: [], expand: [], fetches: [] };
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
  global.fetch = (opts && opts.fetch) ? opts.fetch(calls) : fetchMapFor(opts, calls);
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
    // gate WARNING 2: Prev/Next registered around the ACTUAL playing index - t2
    // is #1 in the album [t1,t2,t3], so BOTH neighbours exist (not registered at
    // -1 / not-found).
    const nav = calls.setTrackNav[calls.setTrackNav.length - 1];
    assert.ok(nav && typeof nav.onPrev === 'function', 'onPrev bound (t2 has a previous album track)');
    assert.ok(nav && typeof nav.onNext === 'function', 'onNext bound (t2 has a next album track)');
    // gate WARNING 3 (the v1.104 scar guard): the album is loaded EXACTLY ONCE
    // (render's drill load). If rebuildPlayingQueue did not early-return on
    // `drill`, a SECOND album=... load would race render's and desync the queue.
    const albumFetches = calls.fetches.filter((u) => u.indexOf('album=') !== -1);
    assert.equal(albumFetches.length, 1, 'exactly one album load on return - no double load (rebuildPlayingQueue early-returned on drill)');
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

test('v1.207 (gate WARNING 1): a rapid cross-album double-tap plays ONLY the last tap, never the first (the wrong-track race)', async () => {
  // Two albums; the Songs list holds one track from each. Tap A then B before
  // either album fetch returns, then resolve B FIRST, A LAST (the inversion the
  // adversarial repro used). With the select-generation guard, only B plays.
  const KA = 'ArtistA␟Album A';
  const KB = 'ArtistB␟Album B';
  const ALBUMS = {
    [KA]: [{ id: 'a1', title: 'A-one', artist: 'ArtistA', album: 'Album A', albumKey: KA, durationSec: 100 }, { id: 'a2', title: 'A-two', artist: 'ArtistA', album: 'Album A', albumKey: KA, durationSec: 100 }],
    [KB]: [{ id: 'b1', title: 'B-one', artist: 'ArtistB', album: 'Album B', albumKey: KB, durationSec: 100 }, { id: 'b2', title: 'B-two', artist: 'ArtistB', album: 'Album B', albumKey: KB, durationSec: 100 }],
  };
  const SONGS = [
    { id: 'a1', title: 'A-one', artist: 'ArtistA', album: 'Album A', albumKey: KA, durationSec: 100 },
    { id: 'b1', title: 'B-one', artist: 'ArtistB', album: 'Album B', albumKey: KB, durationSec: 100 },
  ];
  const pend = {};
  const customFetch = (calls) => (url, init) => {
    calls.fetches.push(url);
    const method = (init && init.method) || 'GET';
    if (method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    if (url.indexOf('/api/music/albums') === 0 || url.indexOf('/api/music/artists') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    const m = url.match(/album=([^&]+)/);
    if (m) { const key = decodeURIComponent(m[1]).replace(/\+/g, ' '); return new Promise((res) => { pend[key] = () => res({ ok: true, json: async () => ({ items: ALBUMS[key] }) }); }); }
    if (url.indexOf('/api/music') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: SONGS }) }); // the Songs-tab list
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot('http://localhost/music', { state: 'docked', currentId: null }, { tabPref: 'songs', fetch: customFetch }, async (dom, calls) => {
    const doc = dom.window.document;
    const rowA = doc.querySelector('.music-song-row[data-id="a1"]');
    const rowB = doc.querySelector('.music-song-row[data-id="b1"]');
    assert.ok(rowA && rowB, 'both cross-album song rows exist');
    rowA.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    rowB.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 4; i++) await settle();
    // Resolve album B (the LAST tap) first, then album A (the first tap) last.
    if (pend[KB]) pend[KB]();
    for (let i = 0; i < 6; i++) await settle();
    if (pend[KA]) pend[KA]();
    for (let i = 0; i < 6; i++) await settle();
    const played = calls.load.map((c) => c.id);
    assert.ok(played.includes('b1'), 'the LAST tapped track (album B) plays');
    assert.ok(!played.includes('a1'), 'the FIRST tapped track (album A) is superseded and NEVER plays (no wrong-track)');
    // gate delta (WARNING 1 residual): the loser's late load must NOT clobber
    // the queue back to album A - the rendered list AND the registered Prev/Next
    // must stay inside the winner's album B.
    const html = content(dom).innerHTML;
    assert.ok(html.includes('B-one') && html.includes('B-two'), 'the list shows album B (the winner)');
    assert.ok(!html.includes('A-one'), 'the list is NOT clobbered back to album A');
    const nav = calls.setTrackNav[calls.setTrackNav.length - 1];
    assert.ok(nav && typeof nav.onNext === 'function', 'b1 has a next track in album B');
    nav.onNext();
    for (let i = 0; i < 4; i++) await settle();
    const afterNav = calls.load.map((c) => c.id);
    assert.equal(afterNav[afterNav.length - 1], 'b2', 'pressing Next plays album B track 2 - NOT a wrong-album track');
    assert.ok(!afterNav.includes('a1') && !afterNav.includes('a2'), 'no album-A track ever plays on nav');
  });
});

test('v1.207 (gate SUGGESTION): tapping a second song INSIDE the same album does not re-fetch/re-drill (just plays)', async () => {
  await boot('http://localhost/music?play=t2', { state: 'docked', currentId: null }, {}, async (dom, calls) => {
    // ?play=t2 has drilled into The Wall; now tap another track in that album.
    const before = calls.fetches.filter((u) => u.indexOf('album=') !== -1).length;
    const doc = dom.window.document;
    const row = doc.querySelector('.music-song-row[data-id="t3"]');
    assert.ok(row, 'another album track row exists (we are in the album drill)');
    row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 6; i++) await settle();
    const after = calls.fetches.filter((u) => u.indexOf('album=') !== -1).length;
    assert.equal(after, before, 'a same-album re-tap issues NO new album fetch (alreadyInAlbum -> playAt directly)');
    assert.ok(calls.load.some((c) => c.id === 't3'), 'and the tapped track plays');
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

// ---- Wave G: a PROJECTED library-audio song plays via its OWN media routes ----

test('Wave G: tapping a projected library song loads it with /video + /thumbnail + /api/progress (not the /track music routes)', async () => {
  // A projected library track carries source:'library' + its media routes and an
  // empty album (untitled), so it plays directly from the flat Songs list (the
  // album-less path) - which routes through loadTrack, the seam that must PREFER
  // the item's own routes over the /track,/albumart,/api/music/progress defaults.
  const songs = [{
    id: 'lib1', title: 'A NESTALGIA Mix', artist: 'NESTALGIA', album: '', albumKey: '', durationSec: 1800,
    source: 'library', streamSrc: '/video/lib1', artUrl: '/thumbnail/lib1', progressEndpoint: '/api/progress',
  }];
  await boot('http://localhost/music', { state: 'docked', currentId: null }, { songs, tabPref: 'songs' }, async (dom, calls) => {
    const doc = dom.window.document;
    const row = doc.querySelector('.music-song-row[data-id="lib1"]');
    assert.ok(row, 'the projected song row exists in the flat list');
    row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 8; i++) await settle();
    const loaded = calls.load.find((c) => c.id === 'lib1');
    assert.ok(loaded, 'the projected track loaded into the player');
    assert.strictEqual(loaded.data.streamSrc, '/video/lib1', 'streams the mp3 from the media byte route');
    assert.strictEqual(loaded.data.artUrl, '/thumbnail/lib1', 'art is the media thumbnail');
    assert.strictEqual(loaded.data.progressEndpoint, '/api/progress', 'progress unified with the feed (media store)');
    // resumeMode stays 'music' so the read hits progressEndpoint with the music
    // smart-resume / no-prompt feel (a native track would use the SAME field).
    assert.strictEqual(loaded.data.resumeMode, 'music', 'keeps the music now-playing + no-prompt resume');
  });
});

test('Wave G: a NATIVE track still uses the /track music routes (the override is source-gated)', async () => {
  // Mutation guard: the override must be behind `source === 'library'`, not merely
  // "has a streamSrc field". So the native fixture DELIBERATELY carries media
  // routes but NO source - the /track defaults must still win (removing the
  // `isLib &&` from the ternary would then red this, binding the source gate
  // itself, per the adversarial gate's MUTANT L).
  const songs = [{
    id: 'nat1', title: 'Real Song', artist: 'A', album: '', albumKey: '', durationSec: 200,
    streamSrc: '/video/nat1', artUrl: '/thumbnail/nat1', progressEndpoint: '/api/progress', // present, but NO source
  }];
  await boot('http://localhost/music', { state: 'docked', currentId: null }, { songs, tabPref: 'songs' }, async (dom, calls) => {
    const doc = dom.window.document;
    doc.querySelector('.music-song-row[data-id="nat1"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 8; i++) await settle();
    const loaded = calls.load.find((c) => c.id === 'nat1');
    assert.ok(loaded, 'the native track loaded');
    assert.strictEqual(loaded.data.streamSrc, '/track/nat1', 'native track streams from /track');
    assert.strictEqual(loaded.data.artUrl, '/albumart/nat1', 'native track art from /albumart');
    assert.strictEqual(loaded.data.progressEndpoint, '/api/music/progress', 'native track uses the music coalescer');
  });
});

test('redesign: Music opens on the HOME shelves by default; a shelf "See all" opens the full tab', async () => {
  const homeFetch = () => (url) => {
    if (url.indexOf('/api/music/artists') === 0) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [
        { artist: 'NESTALGIA', avatarUrl: 'https://yt3.example/n.jpg', albumCount: 1, trackCount: 5, artIds: ['x'] },
      ] }) });
    }
    if (url.indexOf('/api/music/albums') === 0) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [
        { albumKey: 'k1', album: 'DK64 Jazz', artist: 'Phantasia Records', trackCount: 15, artId: 'a1' },
      ] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot('http://localhost/music', { state: 'docked', currentId: null }, { fetch: homeFetch }, async (dom) => {
    const doc = dom.window.document;
    const home = doc.querySelector('.music-home');
    assert.ok(home, 'the default landing is the HOME shelves, not a flat grid');
    // The sort control is inert on Home (fixed recently-added shelves), so it's
    // hidden there - never a mislabeled dropdown on the landing (QA gate).
    assert.ok(doc.getElementById('music-sort-select').hidden, 'the sort control is hidden on Home');
    const shelves = home.querySelectorAll('.music-shelf');
    assert.strictEqual(shelves.length, 2, 'Your artists + Recently added shelves');
    assert.match(home.innerHTML, /Your artists/, 'the artists shelf');
    assert.match(home.innerHTML, /Recently added/, 'the albums shelf');
    assert.ok(home.querySelector('.music-artist-card'), 'the artist shelf reuses the artist card');
    // "See all" on the artists shelf -> the full Artists tab (a flat grid).
    const seeAll = home.querySelector('.music-shelf-seeall[data-seeall="artists"]');
    assert.ok(seeAll, 'the artists shelf has a See all');
    seeAll.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    const content = doc.getElementById('music-content');
    assert.ok(content.querySelector('.music-card-grid'), 'See all opened a full grid');
    assert.ok(!content.querySelector('.music-home'), 'the home shelves are gone (now on the full tab)');
    // Bind the DESTINATION specifically - both Albums and Artists render a
    // .music-card-grid, so a wrong-but-valid target would otherwise be invisible
    // (the divergent-fixture class). The artists shelf's See-all must land on
    // ARTISTS: the tab strip highlights it, and the grid holds artist cards.
    const active = doc.querySelector('.music-tab.active');
    assert.strictEqual(active.getAttribute('data-tab'), 'artists', 'See all landed on the ARTISTS tab specifically');
    assert.ok(content.querySelector('.music-artist-card'), 'the full grid is the Artists grid (artist cards)');
    assert.ok(!doc.getElementById('music-sort-select').hidden, 'the sort control returns on a sortable full tab');
  });
});

test('friction: the Artists view toggle flips circles <-> compact list', async () => {
  const artistsFetch = () => (url) => {
    if (url.indexOf('/api/music/artists') === 0) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [
        { artist: 'NESTALGIA', avatarUrl: '', albumCount: 1, trackCount: 5, artIds: ['x'] },
      ] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot('http://localhost/music', { state: 'docked', currentId: null }, { tabPref: 'artists', fetch: artistsFetch }, async (dom) => {
    const doc = dom.window.document;
    const toggle = doc.getElementById('music-view-toggle');
    assert.ok(toggle && !toggle.hidden, 'the view toggle shows on the Artists tab');
    const content = doc.getElementById('music-content');
    assert.ok(content.querySelector('.music-card-grid'), 'default is the circle grid');
    // Toggle -> compact list.
    toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.ok(content.querySelector('.music-artist-list'), 'toggled to the compact list');
    assert.ok(content.querySelector('.music-artist-row[data-artist="NESTALGIA"]'), 'a list row per artist (drillable)');
    // Toggle back -> circles.
    toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.ok(content.querySelector('.music-card-grid'), 'toggled back to the circle grid');
    assert.ok(!content.querySelector('.music-artist-list'), 'the list is gone');
  });
});

test('friction: the view toggle is HIDDEN off the Artists tab (Home)', async () => {
  await boot('http://localhost/music', { state: 'docked', currentId: null }, {}, async (dom) => {
    // default landing is Home -> the artists-only toggle is hidden.
    assert.ok(dom.window.document.getElementById('music-view-toggle').hidden, 'no view toggle on Home');
  });
});

test('redesign S1: the "Jump back in" strip renders recent tracks and a tile resumes on tap', async () => {
  // The harness fetchMap serves filter=recent-listening -> RECENT (t2 + a loose
  // album-less track). renderJumpBackIn populates #music-jumpback on init.
  await boot('http://localhost/music', { state: 'docked', currentId: null }, {}, async (dom, calls) => {
    const doc = dom.window.document;
    const strip = doc.getElementById('music-jumpback');
    assert.ok(strip && !strip.hidden, 'the strip is shown when there are recent tracks');
    const tiles = strip.querySelectorAll('.music-jump-tile');
    assert.ok(tiles.length >= 2, 'a tile per recent track');
    assert.match(strip.innerHTML, /Jump back in/, 'the heading');
    // Tap the loose (album-less) tile -> it plays directly (resume path).
    const loose = strip.querySelector('.music-jump-tile[data-id="loose"]');
    assert.ok(loose, 'the loose recent track has a tile');
    loose.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.ok(calls.load.some((c) => c.id === 'loose'), 'tapping a Jump-back tile resumes that track');
  });
});

test('redesign S1: the "Jump back in" strip stays HIDDEN when there is no recent history', async () => {
  const noRecent = () => (url) => {
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot('http://localhost/music', { state: 'docked', currentId: null }, { fetch: noRecent }, async (dom) => {
    const strip = dom.window.document.getElementById('music-jumpback');
    assert.ok(strip && strip.hidden, 'no recent history -> the strip is hidden (never a bare "Jump back in" header)');
  });
});

test('redesign S1: an artist avatar circle reveals on LOAD and DROPS on ERROR (both axes, to the monogram)', async () => {
  // Default tab = artists; serve two channel artists with avatars. revealMusicArt
  // wires each .maa-img: load -> .is-loaded (reveal), error -> removed (the
  // monogram behind shows). Binds BOTH axes (the reveal-once recurring class).
  const artistsFetch = () => (url) => {
    if (url.indexOf('/api/music/artists') === 0) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [
        { artist: 'NESTALGIA', avatarUrl: 'https://yt3.example/n.jpg', albumCount: 1, trackCount: 5, artIds: ['x'] },
        { artist: 'Koopa Keys', avatarUrl: 'https://yt3.example/k.jpg', albumCount: 1, trackCount: 3, artIds: ['y'] },
      ] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot('http://localhost/music', { state: 'docked', currentId: null }, { fetch: artistsFetch }, async (dom) => {
    const doc = dom.window.document;
    const imgs = doc.querySelectorAll('.maa-img');
    assert.strictEqual(imgs.length, 2, 'two avatar circles rendered');
    // ERROR axis: the first avatar fails -> its img is removed, the monogram remains.
    imgs[0].dispatchEvent(new dom.window.Event('error'));
    const nest = doc.querySelector('.music-artist-card[data-artist="NESTALGIA"]');
    assert.ok(!nest.querySelector('.maa-img'), 'a broken avatar is DROPPED (monogram shows), never a broken-image glyph');
    assert.ok(nest.querySelector('.maa-mono'), 'the monogram is still there');
    // LOAD axis: the second avatar loads -> .is-loaded (revealed).
    imgs[1].dispatchEvent(new dom.window.Event('load'));
    assert.ok(doc.querySelector('.music-artist-card[data-artist="Koopa Keys"] .maa-img').classList.contains('is-loaded'),
      'a loaded avatar reveals (.is-loaded)');
  });
});
