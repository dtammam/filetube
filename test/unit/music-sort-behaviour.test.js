'use strict';

// [UNIT] v1.103 - the music sort control is now PER TAB and drives the album +
// artist grids (not just Songs). These bind the real init() against a jsdom
// music view: what sort the grid FETCHES, that a stored per-tab sort is honoured,
// that tabs don't cross-contaminate each other's sort, and that a drill hides the
// top sort control. Source-locks alone would be the presence-not-binding strike
// this repo keeps paying for, so every assertion runs the wiring.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');

// A music view WITH the sort toolbar (the retired-tab harness omits it).
const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div class="music-toolbar"><h2>Music</h2><div class="music-toolbar-actions">
    <select id="music-sort-select" class="btn btn-sm" aria-label="Sort music"></select>
    <button class="btn btn-sm" id="music-shuffle-btn" type="button">Shuffle</button>
    <button class="btn btn-sm" id="music-scan-btn" type="button">Scan</button>
  </div></div>
  <div id="player-slot"></div>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
    <button type="button" class="music-tab" data-tab="artists" role="tab">Artists</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div class="music-crumb" id="music-crumb" hidden></div>
  <div id="music-status" role="status" hidden></div>
  <div id="music-content">SENTINEL</div>
  <div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Boots the REAL music view; `storage` seeds localStorage; returns the jsdom + a
// live log of every fetched URL so assertions can read what the grid requested.
// `opts.rejectArtists` makes the /api/music/artists fetch REJECT (the abort/error
// path) so a test can prove the seeded skeleton is CLEARED, not stranded.
async function bootMusicView(storage, run, opts) {
  opts = opts || {};
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const saved = {
    window: global.window, document: global.document,
    localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController,
  };
  const fetches = [];
  let registered = null;
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.AbortController = dom.window.AbortController;
  dom.window.FileTube = { registerView: (name, mod) => { registered = mod; }, shimmerArt: () => {} };
  global.fetch = (url) => {
    const u = String(url);
    fetches.push(u);
    if (opts.rejectArtists && u.indexOf('/api/music/artists') >= 0) return Promise.reject(new Error('network fail'));
    let body = { items: [] };
    if (u.indexOf('/api/music/artists') >= 0) body = { items: [{ artist: 'Boards', albumCount: 2, trackCount: 8, artIds: ['x', 'y'] }] };
    else if (u.indexOf('/api/music/albums') >= 0) body = { items: opts.albums || [{ albumKey: 'k1', album: 'One', artist: 'Boards', artId: 'x', trackCount: 4 }] };
    else if (opts.songs && /\/api\/music\?/.test(u)) body = { items: opts.songs }; // v1.373.0: an album page's rows
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
  Object.keys(storage || {}).forEach((k) => dom.window.localStorage.setItem(k, storage[k]));
  try {
    delete require.cache[require.resolve('../../public/js/ui.js')]; require('../../public/js/ui.js'); // UI pass S7: every shell loads ui.js (window.ui) before the view
    delete require.cache[musicPath];
    require(musicPath);
    assert.ok(registered && typeof registered.init === 'function', 'view registered');
    registered.init(dom.window.document.getElementById('view-root'));
    await settle(); await settle();
    await run(dom, fetches);
    registered.destroy();
  } finally {
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
}

const lastGrid = (fetches, kind) => [...fetches].reverse().find((u) => u.indexOf('/api/music/' + kind) >= 0);
const sel = (dom) => dom.window.document.getElementById('music-sort-select');
const clickTab = async (dom, name) => {
  dom.window.document.querySelector(`.music-tab[data-tab="${name}"]`).click();
  await settle(); await settle();
};

test('v1.103: the albums grid fetches with the albums default sort (title-asc)', async () => {
  await bootMusicView({ filetube_music_tab: 'albums' }, async (dom, fetches) => {
    const url = lastGrid(fetches, 'albums');
    assert.ok(url && /[?&]sort=title-asc\b/.test(url), 'albums fetched sort=title-asc, got: ' + url);
    // The select is populated with the albums options and shows the default.
    assert.equal(sel(dom).value, 'title-asc');
    assert.ok([...sel(dom).options].some((o) => o.value === 'year-desc'), 'album-only key present');
    assert.ok(![...sel(dom).options].some((o) => o.value === 'duration-desc'), 'no song-only key on albums');
  });
});

test('v1.103: a stored per-tab sort is honoured on that tab and drives the fetch', async () => {
  await bootMusicView({ filetube_music_tab: 'albums', filetube_music_sort: JSON.stringify({ albums: 'newest' }) }, async (dom, fetches) => {
    assert.equal(sel(dom).value, 'newest', 'menu restores the stored album sort');
    assert.ok(/[?&]sort=newest\b/.test(lastGrid(fetches, 'albums')), 'and the grid fetched it');
  });
});

test('v1.103: sort is isolated per tab - switching tabs does not carry one tab\'s sort to another', async () => {
  await bootMusicView({ filetube_music_tab: 'albums', filetube_music_sort: JSON.stringify({ albums: 'newest', artists: 'tracks-desc' }) }, async (dom, fetches) => {
    assert.equal(sel(dom).value, 'newest', 'albums shows its own sort');
    await clickTab(dom, 'artists');
    assert.equal(sel(dom).value, 'tracks-desc', 'artists shows ITS own sort, not albums\'');
    assert.ok(/[?&]sort=tracks-desc\b/.test(lastGrid(fetches, 'artists')), 'artists fetched its sort');
  });
});

test('v1.103: changing the select persists that tab\'s sort and re-fetches', async () => {
  await bootMusicView({ filetube_music_tab: 'albums' }, async (dom, fetches) => {
    const s = sel(dom);
    s.value = 'year-desc';
    s.dispatchEvent(new dom.window.Event('change'));
    await settle(); await settle();
    assert.ok(/[?&]sort=year-desc\b/.test(lastGrid(fetches, 'albums')), 're-fetched with the new sort');
    const stored = JSON.parse(dom.window.localStorage.getItem('filetube_music_sort'));
    assert.equal(stored.albums, 'year-desc', 'persisted under the albums tab');
  });
});

test('v1.103: a pre-v1.103 plain-string sort pref does not crash - it falls to the tab default', async () => {
  // Old builds stored a bare string (e.g. "duration-desc"); JSON.parse throws and
  // the map read degrades to {} -> defaults, never an exception.
  await bootMusicView({ filetube_music_tab: 'albums', filetube_music_sort: 'duration-desc' }, async (dom) => {
    assert.equal(sel(dom).value, 'title-asc', 'legacy string ignored -> album default');
  });
});

test('v1.103 (gate ADV-W2, reveal-once BOTH axes): a rejected artists fetch CLEARS the seeded skeleton - no stranded shimmer', async () => {
  // The v1.102 gate blocked on exactly this class with a presence-only test. Drive
  // the error path for real: the Artists (now DEFAULT) tab seeds a skeleton, its
  // fetch rejects, and the catch must wipe #music-content (no skeleton-shimmer, no
  // art-shimmer left sweeping under a dead grid) and show the error state (UI pass S7, D9).
  await bootMusicView({ filetube_music_tab: 'artists' }, async (dom) => {
    const content = dom.window.document.getElementById('music-content');
    assert.ok(!/skeleton-shimmer/.test(content.innerHTML), 'no stranded skeleton shimmer after the fetch failed');
    assert.ok(!/art-shimmer/.test(content.innerHTML), 'no stranded art shimmer');
    // UI pass S7 (D9): a failed load is an ERROR state with Retry in #music-content - never the
    // empty library's "No music yet" (which would tell a user with a full library it is empty).
    const err = content.querySelector('.ui-state.music-load-error');
    assert.ok(err, 'the error state replaced the skeleton');
    assert.match(err.textContent, /Couldn.t load your music/, 'it says the load failed');
    assert.ok(err.querySelector('button.ui-btn'), 'with a Retry');
    assert.equal(content.children.length, 1, 'only the error state - nothing of the skeleton left');
    assert.equal(dom.window.document.getElementById('music-empty').hidden, true, 'the empty-library state stays hidden');
  }, { rejectArtists: true });
});

test('friction: an ALBUM drill shows a sortable control, defaulting to album order', async () => {
  await bootMusicView({ filetube_music_tab: 'albums' }, async (dom, fetches) => {
    assert.equal(sel(dom).hidden, false, 'visible on the grid');
    dom.window.document.querySelector('.music-album-card').click();
    await settle(); await settle();
    // The drill is now SORTABLE (Dean): the control stays visible, defaulting to
    // album order (disc/track sequence - the intended listen) with the drill
    // option list (release date included).
    assert.equal(sel(dom).hidden, false, 'the sort control is shown inside the drill');
    assert.equal(sel(dom).value, 'album-order', 'an album drill defaults to album order');
    assert.ok(sel(dom).innerHTML.includes('Release date (newest)'), 'the drill sort offers release date');
    const songUrl = [...fetches].reverse().find((u) => /\/api\/music\?/.test(u));
    assert.ok(/[?&]sort=album-order\b/.test(songUrl), 'drill songs fetched album-order, got: ' + songUrl);
  });
});

test('friction: an ARTIST drill defaults to RELEASE DATE (Dean: not arbitrary order)', async () => {
  await bootMusicView({ filetube_music_tab: 'artists' }, async (dom, fetches) => {
    dom.window.document.querySelector('.music-artist-card').click();
    await settle(); await settle();
    assert.equal(sel(dom).hidden, false, 'the sort control is shown on an artist drill');
    assert.equal(sel(dom).value, 'release-newest', 'an artist drill defaults to release date (newest)');
    const songUrl = [...fetches].reverse().find((u) => /\/api\/music\?/.test(u));
    assert.ok(/[?&]sort=release-newest\b/.test(songUrl), 'drill songs fetched release-newest, got: ' + songUrl);
    // Changing the drill sort must persist under the DRILL key (drill-artist),
    // not the parent tab: pick Title A-Z -> the drill re-fetches with it. If the
    // handler wrote to the 'artists' tab key, the drill would keep defaulting to
    // release-newest and this url would not carry title-asc (binds the write-key).
    const before = fetches.length;
    sel(dom).value = 'title-asc';
    sel(dom).dispatchEvent(new dom.window.Event('change'));
    await settle(); await settle();
    const after = [...fetches].slice(before).reverse().find((u) => /\/api\/music\?/.test(u));
    assert.ok(after && /[?&]sort=title-asc\b/.test(after), 'the changed drill sort re-fetched title-asc (persisted under the drill key), got: ' + after);
  });
});

// ---- v1.373.0: an album's track listing (Dean: "should an 'album' I download have a track listing and be sorted by 'track'") ----
const SONGS = [
  { id: 's1', title: 'Introduction', artist: 'Kyle Gordon', album: 'One', albumKey: 'k1', trackNo: 1, durationSec: 60 },
  { id: 's2', title: 'Mr. Jambo', artist: 'Kyle Gordon', album: 'One', albumKey: 'k1', trackNo: 2, discNo: 1, durationSec: 60 },
  { id: 's3', title: 'Bonus', artist: 'Kyle Gordon', album: 'One', albumKey: 'k1', trackNo: 1, discNo: 2, durationSec: 60 },
  { id: 's4', title: 'No Number', artist: 'Kyle Gordon', album: 'One', albumKey: 'k1', durationSec: 60 },
];
const trackLabels = (dom) => [...dom.window.document.querySelectorAll('.music-drill .music-song-row')].map((r) => { const o = r.querySelector('.music-song-track'); return o ? o.textContent : ''; });

test('v1.373.0: an album page in album order numbers its tracks ("Track N", "Disc 2 · Track N", none without a number)', async () => {
  await bootMusicView({ filetube_music_tab: 'albums' }, async (dom) => {
    dom.window.document.querySelector('.music-album-card').click();
    await settle(); await settle();
    assert.deepStrictEqual(trackLabels(dom), ['Track 1', 'Track 2', 'Disc 2 \u00b7 Track 1', '']);
    const o = dom.window.document.querySelector('.music-song-track');
    assert.ok(o.classList.contains('ui-row__overline'), 'the kit\'s overline slot (TV episode codes use it), no new style');
    sel(dom).value = 'title-asc';
    sel(dom).dispatchEvent(new dom.window.Event('change'));
    await settle(); await settle();
    assert.deepStrictEqual(trackLabels(dom), ['', '', '', ''], 'another order numbers nothing (it would number out of order)');
  }, { songs: SONGS });
});

test('v1.373.0: every album OPENS in album order - a sort picked on one album (or saved by an older build) is not carried to the next', async () => {
  const albums = [{ albumKey: 'k1', album: 'One', artist: 'Boards', artId: 'x', trackCount: 4 }, { albumKey: 'k2', album: 'Two', artist: 'Boards', artId: 'y', trackCount: 4 }];
  await bootMusicView({ filetube_music_tab: 'albums', filetube_music_sort: JSON.stringify({ 'drill-album': 'release-newest' }) }, async (dom, fetches) => {
    dom.window.document.querySelectorAll('.music-album-card')[0].click();
    await settle(); await settle();
    assert.equal(sel(dom).value, 'album-order', 'the old saved "Release date" no longer decides');
    sel(dom).value = 'release-newest';
    sel(dom).dispatchEvent(new dom.window.Event('change'));
    await settle(); await settle();
    const songUrl = [...fetches].reverse().find((u) => /\/api\/music\?/.test(u));
    assert.ok(/[?&]sort=release-newest\b/.test(songUrl), 'the pick applies to this album: ' + songUrl);
    assert.strictEqual(dom.window.localStorage.getItem('filetube_music_sort'), JSON.stringify({ 'drill-album': 'release-newest' }), 'an album pick is not saved (the stored map is untouched)');
    dom.window.document.querySelector('.music-tab[data-tab="albums"]').click();
    await settle(); await settle();
    dom.window.document.querySelectorAll('.music-album-card')[1].click();
    await settle(); await settle();
    assert.equal(sel(dom).value, 'album-order', 'the next album opens in album order');
    const url2 = [...fetches].reverse().find((u) => /\/api\/music\?/.test(u));
    assert.ok(/[?&]sort=album-order\b/.test(url2), url2);
  }, { songs: SONGS, albums });
});
