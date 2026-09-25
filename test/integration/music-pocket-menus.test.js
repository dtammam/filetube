'use strict';

// [INTEGRATION] POCKET MENUS (Dean 2026-09-24: "I'd love classic pocket skin to truly
// emulate. Show artists, albums, songs, etc. fully interactive"). The Click family + Seattle
// carry the device's menu tree over the WHOLE music library. This suite drives the REAL data
// shape end to end: a real server (isolated DATA_DIR) seeded with projected library audio -
// albums, artists, genres and a CHAPTERED file whose chapters are `<id>::c<n>` songs - and the
// REAL music.js view + skin engine in jsdom, whose every fetch goes to that server. No hand-typed
// ids: every id a test plays is one the server's /api/music routes returned.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pocketmenus-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { createPocketHarness } = require('../helpers/pocket-menu-harness');


let server, base, auth, authedFetch;
const ROOT = path.join(DATA_DIR, 'ytdlp');

function audioItem(id, folderName, artistName, tags, extra) {
  return Object.assign({
    id, type: 'audio', title: (tags && tags.title) || id, name: `${id}.mp3`,
    filePath: path.join(ROOT, folderName, `${id}.mp3`), rootFolder: ROOT, folderName, channelName: artistName,
    duration: 200, hasThumbnail: true, ext: '.mp3', addedAt: 1788000000000,
    tags: Object.assign({ artist: artistName }, tags || {}),
  }, extra || {});
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  authedFetch = global.fetch; // the cookie-carrying fetch the jsdom view will route through
  seedState({ folders: [ROOT], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    db.metadata = {
      // Tonzak: one real album, three tracks, a real genre.
      nd1: audioItem('nd1', 'tonzak', 'Tonzak', { title: 'Neon Arrival', album: 'Night Drive', track: '1', genre: 'Synthwave' }, { addedAt: 1788000000001 }),
      nd2: audioItem('nd2', 'tonzak', 'Tonzak', { title: 'Overpass', album: 'Night Drive', track: '2', genre: 'Synthwave' }, { addedAt: 1788000000002 }),
      nd3: audioItem('nd3', 'tonzak', 'Tonzak', { title: 'Tail Lights', album: 'Night Drive', track: '3', genre: 'Synthwave' }, { addedAt: 1788000000003 }),
      // NESTALGIA: a two-track album AND a chaptered full-album mix (one file, three chapters).
      rm1: audioItem('rm1', 'nestalgiamusic', 'NESTALGIA', { title: 'Cartridge Blues', album: 'Retro Mix', track: '1', genre: 'Music' }),
      rm2: audioItem('rm2', 'nestalgiamusic', 'NESTALGIA', { title: 'Pixel Rain', album: 'Retro Mix', track: '2', genre: 'Music' }),
      djmix1: audioItem('djmix1', 'nestalgiamusic', 'NESTALGIA', { title: 'Full Album Mix', genre: 'Music' },
        { title: 'Full Album Mix', duration: 1800, chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 300, title: 'Track A' }, { startTime: 900, title: 'Track B' }] }),
      // Zarchivo: no album tag, no genre (the Unknown buckets).
      za1: audioItem('za1', 'zarchivo', 'Zarchivo', { title: 'Loose Single' }),
    };
    return true;
  });
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const { menu, select, rows, labels, cursorLabel, title, tapRow, inMenu, stepDown, settleNet, click, boot } = createPocketHarness(() => ({ base, authedFetch }));
async function realApi(pathname) { const r = await authedFetch(base + pathname); return r.json(); }

test('Click: MENU climbs Now Playing -> Main Menu, every Music level renders the REAL library, and MENU walks back out to the dock', async () => {
  const songs = (await realApi('/api/music?sort=title-asc&limit=10000')).items;
  const albums = (await realApi('/api/music/albums?limit=10000&sort=title-asc')).items;
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    assert.strictEqual(h.player.currentId, 'nd1', 'precondition: ?play loaded the real track');
    assert.ok(h.panel.classList.contains('mms-ipod'), 'the Click skin is up');
    assert.ok(!inMenu(h), 'opens on Now Playing (something is playing)');
    menu(h);
    assert.ok(inMenu(h), 'MENU from Now Playing climbs into the menu');
    assert.strictEqual(title(h), 'Click', 'status bar = the Main Menu name');
    assert.deepStrictEqual(labels(h), ['Music', 'Settings', 'Shuffle Songs', 'Now Playing'], 'the device order (no Extras: this harness has no Brick hook)');
    assert.strictEqual(cursorLabel(h), 'Music', 'the blue bar starts on the first row');
    select(h); // center = drill in
    assert.strictEqual(title(h), 'Music');
    assert.deepStrictEqual(labels(h), ['Recent Artists', 'Playlists', 'Artists', 'Albums', 'Songs', 'Genres']);
    assert.ok(rows(h).every((r) => r.querySelector('.ipm-chev')), 'drill-in rows carry the chevron');
    // the wheel: three detents down -> Albums, then the center drills in
    await stepDown(h); await stepDown(h); await stepDown(h);
    assert.strictEqual(cursorLabel(h), 'Albums', 'rotation moved the highlight three rows (the shared cursor engine)');
    select(h);
    assert.strictEqual(title(h), 'Albums');
    await settleNet();
    assert.deepStrictEqual(labels(h), albums.map((a) => a.album || 'Unknown Album'), 'the Albums level IS the /api/music/albums payload, in its order');
    // tap (phone users): the chaptered mix
    tapRow(h, 'Full Album Mix');
    await settleNet();
    assert.strictEqual(title(h), 'Full Album Mix');
    const mixIds = songs.filter((t) => /^djmix1::c\d+$/.test(t.id));
    assert.strictEqual(mixIds.length, 3, 'precondition: the real server expanded the mix into three chapter songs');
    assert.deepStrictEqual(labels(h), ['Intro', 'Track A', 'Track B'], 'a chaptered album lists its chapters as songs');
    // MENU climbs one level at a time, keeping each level's position
    menu(h); assert.strictEqual(title(h), 'Albums'); assert.strictEqual(cursorLabel(h), 'Full Album Mix', 'back on the album it drilled from');
    menu(h); assert.strictEqual(title(h), 'Music'); assert.strictEqual(cursorLabel(h), 'Albums');
    menu(h); assert.strictEqual(title(h), 'Click');
    assert.strictEqual(h.spy.dock, 0, 'no level docked on the way up');
    menu(h);
    assert.strictEqual(h.spy.dock, 1, 'MENU on the Main Menu is the way out (docks)');
  } });
});

test('a CHAPTER chosen from a menu plays in its album (the real ::c id), shows Now Playing, and MENU returns to that list on that song', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h);                     // Main -> Music
    tapRow(h, 'Albums'); await settleNet();
    tapRow(h, 'Full Album Mix'); await settleNet();
    await stepDown(h);                      // Intro -> Track A
    assert.strictEqual(cursorLabel(h), 'Track A');
    const logBefore = h.log.length;
    select(h);                              // center = play
    await settleNet();
    // v1.331 (Dean): an album pick plays the album ON - it is not a v1.311 solo select, so no exit
    // station is pre-fetched at the pick (the boundary itself is driven in the v1.331 tests below).
    assert.ok(!h.log.slice(logBefore).some((u) => /sort=random/.test(u)),
      'an album pick primes no solo-chapter exit station: ' + h.log.slice(logBefore).join(' | '));
    const last = h.spy.loads[h.spy.loads.length - 1];
    assert.strictEqual(last.id, 'djmix1::c1', 'played the REAL chapter id the server returned');
    assert.strictEqual(last.data.chapterStartSec, 300, 'the chapter seek offset rode along (the real row, not a copy)');
    assert.ok(!inMenu(h), 'choosing a song shows Now Playing');
    // the queue context: the album. Next is the album's next chapter, not some other list.
    assert.ok(h.spy.nav && typeof h.spy.nav.onNext === 'function', 'nav registered around the played index');
    // the browse view behind mirrors the queue exactly (its rows index INTO the queue)
    const rowsBehind = [...h.D.querySelectorAll('#music-content .music-song-row')].map((r) => r.getAttribute('data-id'));
    assert.deepStrictEqual(rowsBehind, ['djmix1::c0', 'djmix1::c1', 'djmix1::c2'], 'the album drill behind the skin = the queue');
    menu(h);
    assert.ok(inMenu(h));
    assert.strictEqual(title(h), 'Full Album Mix', 'MENU climbs to the menu the song came from');
    assert.strictEqual(cursorLabel(h), 'Track A', '...with the highlight on that song');
    const cur = h.panel.querySelector('.ipm-row.is-current');
    assert.ok(cur && cur.querySelector('.ipm-lbl').textContent === 'Track A' && cur.querySelector('.ipm-now'), 'the playing row carries the speaker mark');
  } });
});

test('the album ADVANCES without a reload (chapter roll + queue next): the playing list follows at EVERY advance', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h);
    tapRow(h, 'Albums'); await settleNet();
    tapRow(h, 'Full Album Mix'); await settleNet();
    tapRow(h, 'Intro'); await settleNet();
    assert.strictEqual(h.player.currentId, 'djmix1::c0');
    // (1) the ONE file rolls into chapter three with NO reload: a timeupdate past 900s
    const mp = h.D.getElementById('media-player');
    Object.defineProperty(mp, 'duration', { configurable: true, get: () => 1800 });
    Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => 905, set() {} });
    mp.dispatchEvent(new h.dom.window.Event('timeupdate'));
    await settleNet(5);
    assert.strictEqual(h.spy.loads.length >= 1 && h.spy.loads[h.spy.loads.length - 1].id, 'djmix1::c0', 'no reload: the loaded id is still chapter one');
    menu(h);
    assert.strictEqual(cursorLabel(h), 'Track B', 'the list the song came from followed the chapter roll');
    assert.strictEqual(h.panel.querySelector('.ipm-row.is-current .ipm-lbl').textContent, 'Track B', 'the speaker mark moved too');
    menu(h); // back on Albums
    menu(h); // Music
    // (2) a queue advance (the lock-screen / ended Next): Night Drive, then Next
    tapRow(h, 'Albums'); await settleNet();
    tapRow(h, 'Night Drive'); await settleNet();
    tapRow(h, 'Neon Arrival'); await settleNet();
    assert.strictEqual(h.player.currentId, 'nd1');
    h.spy.nav.onNext();
    await settleNet();
    assert.strictEqual(h.player.currentId, 'nd2', 'Next = the album\'s next song (the list was the queue)');
    menu(h);
    assert.strictEqual(title(h), 'Night Drive');
    assert.strictEqual(cursorLabel(h), 'Overpass', 'the list followed the queue advance');
  } });
});

test('a repaint while browsing (a track advance mid-menu) keeps you IN the list, on your row', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h);
    tapRow(h, 'Songs'); await settleNet();
    await stepDown(h); await stepDown(h);
    const at = cursorLabel(h);
    h.spy.nav.onNext(); // the view repaints the skin (a new track loads) while the menu is up
    await settleNet();
    assert.ok(inMenu(h), 'the repaint did not throw the menu back to Now Playing');
    assert.strictEqual(title(h), 'Songs');
    assert.strictEqual(cursorLabel(h), at, 'same row (the menu list was not the playing context)');
  } });
});

test('Songs: the whole library in title order; a pick plays IN that list and the browse rows behind stay index-true', async () => {
  const songs = (await realApi('/api/music?sort=title-asc&limit=10000')).items;
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h);
    tapRow(h, 'Songs'); await settleNet();
    assert.deepStrictEqual(labels(h), songs.map((t) => t.title), 'every song, chapters included, the /api/music title order');
    tapRow(h, 'Pixel Rain'); await settleNet();
    assert.strictEqual(h.player.currentId, 'rm2');
    assert.strictEqual(h.D.getElementById('music-crumb').textContent, 'Songs', 'the list behind is labelled');
    // a browse-row tap behind the skin must play THAT row (the v1.104/v1.207 wrong-track class)
    const behind = [...h.D.querySelectorAll('#music-content .music-song-row')];
    assert.deepStrictEqual(behind.map((r) => r.getAttribute('data-id')), songs.map((t) => t.id), 'the Songs list behind = the queue');
    const row = behind.find((r) => r.getAttribute('data-id') === 'za1');
    click(h.dom, row.querySelector('.music-song-main') || row);
    await settleNet();
    const played = h.spy.loads[h.spy.loads.length - 1].id;
    assert.strictEqual(played, 'za1', 'the tapped browse row played its own track');
  } });
});

test('Artists > artist > All Songs / an album > songs, and Genres > genre > songs, from the real routes', async () => {
  const artists = (await realApi('/api/music/artists?limit=10000&sort=title-asc')).items;
  await boot({ skin: 'ipod-black', play: 'nd1', run: async (h) => {
    menu(h); select(h);
    tapRow(h, 'Artists'); await settleNet();
    assert.deepStrictEqual(labels(h), artists.map((a) => a.artist));
    tapRow(h, 'NESTALGIA'); await settleNet();
    assert.strictEqual(title(h), 'NESTALGIA');
    assert.strictEqual(labels(h)[0], 'All Songs', 'more than one album -> the device\'s All Songs row leads');
    assert.deepStrictEqual(labels(h).slice(1).sort(), ['Full Album Mix', 'Retro Mix']);
    tapRow(h, 'Retro Mix'); await settleNet();
    assert.deepStrictEqual(labels(h), ['Cartridge Blues', 'Pixel Rain']);
    menu(h);
    tapRow(h, 'All Songs'); await settleNet();
    assert.strictEqual(labels(h).length, 5, 'All Songs = both albums\' songs (2 + 3 chapters)');
    tapRow(h, 'Cartridge Blues'); await settleNet();
    assert.strictEqual(h.player.currentId, 'rm1');
    const drillHead = h.D.querySelector('#music-content .music-drill');
    assert.ok(drillHead, 'the artist drill is the browse view behind the skin');
    // Genres: Genre > Songs (the thin-data choice), untagged gathered under Unknown Genre
    menu(h); menu(h); menu(h); menu(h); // Now Playing -> All Songs -> NESTALGIA -> Artists -> Music
    assert.strictEqual(title(h), 'Music');
    tapRow(h, 'Genres'); await settleNet();
    assert.deepStrictEqual(labels(h), ['Music', 'Synthwave', 'Unknown Genre']);
    tapRow(h, 'Synthwave'); await settleNet();
    assert.deepStrictEqual(labels(h).sort(), ['Neon Arrival', 'Overpass', 'Tail Lights']);
    menu(h);
    tapRow(h, 'Unknown Genre'); await settleNet();
    assert.deepStrictEqual(labels(h), ['Loose Single']);
  } });
});

test('Playlists > Liked Songs is the real liked set (a projected track liked through the media store)', async () => {
  const r = await authedFetch(base + '/api/liked/nd3', { method: 'POST' });
  assert.ok(r.ok, 'precondition: liked nd3 through the real route');
  await boot({ skin: 'ipod-matte', play: 'nd1', run: async (h) => {
    menu(h); select(h);
    tapRow(h, 'Playlists');
    assert.deepStrictEqual(labels(h), ['Liked Songs', 'Recently Added', 'Recently Played']);
    tapRow(h, 'Liked Songs'); await settleNet();
    assert.deepStrictEqual(labels(h), ['Tail Lights']);
    tapRow(h, 'Tail Lights'); await settleNet();
    assert.strictEqual(h.player.currentId, 'nd3');
  } });
  await authedFetch(base + '/api/liked/nd3', { method: 'DELETE' });
});

test('Shuffle Songs shuffles the WHOLE library and plays through from the top', async () => {
  const total = (await realApi('/api/music?limit=10000')).items.length;
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h);
    tapRow(h, 'Shuffle Songs');
    await settleNet();
    const shuffleCall = h.log.find((u) => /\/api\/music\?sort=random&seed=\d+&limit=10000/.test(u));
    assert.ok(shuffleCall, 'fetched the whole library, randomly ordered: ' + h.log.join(' | '));
    assert.ok(!inMenu(h), 'Now Playing shows');
    const behind = h.D.querySelectorAll('#music-content .music-song-row');
    assert.strictEqual(behind.length, total, 'the queue is the whole library');
    assert.strictEqual(h.player.currentId, behind[0].getAttribute('data-id'), 'played from the top of the shuffle');
  } });
});

test('reveal-once, both axes: a level seeds a skeleton before its fetch, a FAILED load says so, and the center retries it', async () => {
  await boot({ skin: 'ipod', play: 'nd1', failOnce: /\/api\/music\/albums/, run: async (h) => {
    menu(h); select(h);
    tapRow(h, 'Albums');
    assert.ok(h.panel.querySelector('.ipm-skel .skeleton-shimmer'), 'the skeleton rows are up BEFORE the fetch resolves');
    await settleNet();
    assert.ok(!h.panel.querySelector('.ipm-skel'), 'the skeleton cleared on the error exit (never stranded)');
    assert.match(h.panel.querySelector('.ipm-note').textContent, /Couldn.t load/);
    select(h); // retry
    await settleNet();
    assert.ok(labels(h).includes('Night Drive'), 'the retry revealed the real albums');
    assert.ok(!h.panel.querySelector('.ipm-note'), 'the error note cleared on the successful reveal');
  } });
});

test('Seattle: the Zune main menu, the Music PIVOTS moved by the pad and by a swipe, and a song played from a pivot', async () => {
  const artists = (await realApi('/api/music/artists?limit=10000&sort=title-asc')).items;
  await boot({ skin: 'zune-classic', play: 'nd1', run: async (h) => {
    assert.ok(!inMenu(h), 'opens on Now Playing');
    click(h.dom, h.panel.querySelector('[data-skin-next]'));
    assert.strictEqual(h.spy.next, 1, 'on Now Playing the pad right still skips a track');
    menu(h);
    assert.ok(h.panel.querySelector('.ipm-seattle.ipm-root'), 'the Zune main menu (big type, no header)');
    assert.deepStrictEqual(labels(h), ['Music', 'Settings', 'Shuffle Songs', 'Now Playing']);
    select(h);
    const pivots = () => [...h.panel.querySelectorAll('.ipm-pv')].map((b) => b.textContent);
    assert.deepStrictEqual(pivots(), ['Artists', 'Albums', 'Songs', 'Playlists', 'Genres', 'Recent'], 'the pivot strip leads with the active pivot');
    await settleNet();
    assert.deepStrictEqual(labels(h), artists.map((a) => a.artist), 'the artists pivot lists the real artists');
    click(h.dom, h.panel.querySelector('[data-skin-next]'));
    await settleNet();
    assert.strictEqual(h.spy.next, 1, 'on a pivot level the pad right moved the pivot - it did NOT skip a track');
    assert.strictEqual(pivots()[0], 'Albums');
    // visit Songs once (it loads), then back to Albums with the pad - the pad left moves back
    click(h.dom, h.panel.querySelector('[data-skin-next]'));
    await settleNet();
    assert.strictEqual(pivots()[0], 'Songs');
    click(h.dom, h.panel.querySelector('[data-skin-prev]'));
    await settleNet();
    assert.strictEqual(pivots()[0], 'Albums', 'pad left moves back');
    assert.strictEqual(h.spy.prev, 0, '...without skipping back a track');
    // swipe left across the list -> the next pivot (Songs, already loaded: it renders at once)
    const loadsBeforeSwipe = h.spy.loads.length;
    const list = h.panel.querySelector('[data-skin-swipe]');
    list.dispatchEvent(new h.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 100 }));
    list.dispatchEvent(new h.dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 150, clientY: 110 }));
    assert.strictEqual(pivots()[0], 'Songs', 'a left swipe moved to the next pivot');
    // a mouse's lift-off click lands on the (new) song row under the pointer: swallowed
    const under = h.panel.querySelector('[data-skin-swipe] .ipm-row[data-skin-mi]');
    assert.ok(under, 'precondition: a real song row sits under the pointer');
    under.dispatchEvent(new h.dom.window.MouseEvent('click', { bubbles: true }));
    await settleNet();
    assert.strictEqual(h.spy.loads.length, loadsBeforeSwipe, 'the swipe\'s click did not play the row under it');
    assert.ok(inMenu(h), '...the menu stayed up');
    assert.strictEqual(pivots()[0], 'Songs');
    // a swipe RIGHT goes back a pivot
    const list2 = h.panel.querySelector('[data-skin-swipe]');
    list2.dispatchEvent(new h.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
    list2.dispatchEvent(new h.dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 260, clientY: 95 }));
    await settleNet();
    assert.strictEqual(pivots()[0], 'Albums', 'a right swipe moved back');
    tapRow(h, 'Night Drive'); await settleNet();
    assert.ok(h.panel.querySelector('.ipm-title'), 'a drilled level carries the big dim title');
    tapRow(h, 'Tail Lights'); await settleNet();
    assert.strictEqual(h.player.currentId, 'nd3');
    menu(h);
    assert.strictEqual(cursorLabel(h), 'Tail Lights', 'MENU (Back) returns to the list on the song');
    menu(h);
    assert.strictEqual(pivots()[0], 'Albums', 'Back again lands on the pivot you drilled from');
  } });
});

test('Click: in a menu the |<< >>| zones still skip tracks (the device\'s own); a browse load in flight cannot land over a menu pick', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h);
    click(h.dom, h.panel.querySelector('[data-skin-next]'));
    click(h.dom, h.panel.querySelector('[data-skin-prev]'));
    assert.strictEqual(h.spy.next, 1, 'next skipped a track from inside the menu');
    assert.strictEqual(h.spy.prev, 1, 'prev too');
    assert.ok(inMenu(h), '...and the menu stayed up');
    tapRow(h, 'Albums'); await settleNet();
    tapRow(h, 'Retro Mix'); await settleNet();
    // a browse load goes in flight BEHIND the skin (the Songs tab re-fetches the whole library)...
    click(h.dom, h.D.querySelector('.music-tab[data-tab="songs"]'));
    // ...and before it lands, a song is picked from the menu
    tapRow(h, 'Pixel Rain');
    await settleNet();
    assert.strictEqual(h.player.currentId, 'rm2');
    const behind = [...h.D.querySelectorAll('#music-content .music-song-row')].map((r) => r.getAttribute('data-id'));
    assert.deepStrictEqual(behind, ['rm1', 'rm2'], 'the stale Songs load did not repaint the browse view over the picked album');
    h.spy.nav.onPrev();
    await settleNet();
    assert.strictEqual(h.player.currentId, 'rm1', 'Prev walks the PICKED album - the stale load did not replace the queue');
  } });
});

const songsUrl = (u) => /^\/api\/music\?sort=title-asc&limit=10000$/.test(u);
test('the menus drop their library cache on a rescan AND after a delete/move (a removed track never lingers in a menu)', async () => {
  // (1) the Scan button: the next Songs open re-fetches the library
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h);
    tapRow(h, 'Songs'); await settleNet();
    assert.strictEqual(h.log.filter(songsUrl).length, 1);
    menu(h);
    tapRow(h, 'Songs'); await settleNet();
    assert.strictEqual(h.log.filter(songsUrl).length, 1, 'cached within the session (one fetch for two opens)');
    click(h.dom, h.D.getElementById('music-scan-btn'));
    await settleNet();
    menu(h);
    tapRow(h, 'Songs'); await settleNet();
    assert.strictEqual(h.log.filter(songsUrl).length, 2, 'the rescan invalidated the cached library');
  } });
  // (2) a delete through the skin's own Extras (the real flow; the DELETE itself is faked -
  // there is no file on disk in this fixture - and answers success, so afterExtrasMutation runs)
  let deletes = 0;
  await boot({
    skin: 'ipod', play: 'nd1',
    intercept: (u, o) => (o.method === 'DELETE' && /^\/api\/videos\//.test(u)) ? (deletes += 1, { ok: true, status: 200, json: async () => ({ success: true }) }) : null,
    setup: (dom) => {
      dom.window.fetchCurrentUser = async () => ({ user: { role: 'admin' } });
      dom.window.isYtdlpManagedItem = () => false;
      dom.window.showHardDeleteModal = (item, doDelete) => doDelete();
      dom.window.showToast = () => {};
    },
    run: async (h) => {
      menu(h); select(h);
      tapRow(h, 'Songs'); await settleNet();
      tapRow(h, 'Neon Arrival'); await settleNet(); // Now Playing on nd1, played FROM the menu
      assert.strictEqual(h.log.filter(songsUrl).length, 1);
      click(h.dom, h.panel.querySelector('[data-skin-sticker]'));
      click(h.dom, h.panel.querySelector('[data-skin-extras]'));
      await settleNet();
      const del = h.panel.querySelector('[data-skin-x="delete"]');
      assert.ok(del, 'the Extras page offers Delete (admin)');
      click(h.dom, del);
      await settleNet();
      assert.strictEqual(deletes, 1, 'the delete ran');
      // play again from the browse list behind (the menu queue's Songs list), bringing the skin back
      const row = h.D.querySelector('#music-content .music-song-row[data-id="nd2"] .music-song-main');
      assert.ok(row, 'the browse list is there to play from');
      click(h.dom, row);
      await settleNet();
      assert.strictEqual(h.player.currentId, 'nd2');
      menu(h); // Now Playing -> the Songs level ALREADY on the stack (opened before the delete)
      assert.strictEqual(title(h), 'Songs');
      await settleNet();
      assert.strictEqual(h.log.filter(songsUrl).length, 2, 'the delete invalidated the cache AND the open level re-loaded');
      assert.ok(labels(h).length > 0 && !h.panel.querySelector('.ipm-skel'), 'the re-loaded level revealed');
    },
  });
});

// ---------------------------------------------------------------- v1.331 (Dean): an album pick plays the album
// Dean (ROADMAP, 2026-09-24): "when I go to a recent artist and I pick the artist and I go into the
// album and I pick something in an album, it just plays that song and then goes to a completely
// other song from the artist, almost like a shuffle". A chaptered album's pick armed the v1.311
// solo exit (a station of the artist's songs at the chapter's end). An ALBUM level now plays the
// album on: at the chapter boundary the file rolls into the next chapter (no reload, no station).
// Driven on Dean's EXACT path (a real recent-listening row seeds Recent Artists) and on Albums.
const mixClock = (h, t) => {
  const el = h.D.getElementById('media-player');
  Object.defineProperty(el, 'duration', { configurable: true, get: () => 1800 });
  Object.defineProperty(el, 'currentTime', { configurable: true, get: () => t.v, set(v) { t.v = v; } });
  return el;
};
async function mixTick(h, el, t, v) { t.v = v; el.dispatchEvent(new h.dom.window.Event('timeupdate')); await settleNet(5); }
async function pickTrackAThenCrossItsEnd(h, albumTitle) {
  assert.deepStrictEqual(labels(h), ['Intro', 'Track A', 'Track B'], 'precondition: the album level lists the mix\'s chapters in order');
  const logBefore = h.log.length;
  const loadsBefore = h.spy.loads.length;
  tapRow(h, 'Track A'); await settleNet();
  assert.strictEqual(h.spy.loads.length, loadsBefore + 1, 'the pick loaded once');
  assert.strictEqual(h.player.currentId, 'djmix1::c1', 'the pick played the real chapter id');
  assert.ok(!h.log.slice(logBefore).some((u) => /sort=random/.test(u)),
    'an album pick primes NO exit station (it plays the album on): ' + h.log.slice(logBefore).join(' | '));
  const loads = h.spy.loads.length;
  const t = { v: 300 }; const el = mixClock(h, t);
  // normal playback through Track A's end (900 s): the solo band [899.75, 901) and the sparse cross
  await mixTick(h, el, t, 600); await mixTick(h, el, t, 899.2); await mixTick(h, el, t, 899.9); await mixTick(h, el, t, 900.4); await mixTick(h, el, t, 903);
  assert.strictEqual(h.spy.loads.length, loads, 'no reload at the boundary: the album rolled on (a station would load another song): ' + h.spy.loads.slice(loads).map((l) => l.id).join(','));
  assert.strictEqual(h.player.currentId, 'djmix1::c1', 'still the same file, playing on');
  menu(h);
  if (albumTitle) assert.strictEqual(title(h), albumTitle, 'MENU climbs to the album the song came from');
  const cur = h.panel.querySelector('.ipm-row.is-current .ipm-lbl');
  assert.strictEqual(cur && cur.textContent, 'Track B', 'the album\'s playing mark followed the file into the next chapter');
  assert.strictEqual(cursorLabel(h), 'Track B', 'the list the song came from followed the chapter roll');
  // the registered nav re-armed around the LIVE chapter (the v1.311 re-register): Previous from
  // Track B early in its segment steps back to the album's Track A, never a station row.
  assert.ok(h.spy.nav && typeof h.spy.nav.onPrev === 'function', 'nav registered around Track B');
  h.spy.nav.onPrev(); await settleNet();
  assert.strictEqual(h.spy.loads[h.spy.loads.length - 1].id, 'djmix1::c1', 'Previous from Track B = the album\'s Track A (nav followed the roll)');
}

test('v1.331 (Dean): Recent Artists > artist > album > a chapter plays ON through the album at the chapter end (never a station of the artist)', async () => {
  // seed Dean's path for real: a played NESTALGIA track puts the artist in Recent Artists
  const r = await authedFetch(base + '/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'rm1', timestamp: 42, duration: 200 }) });
  assert.ok(r.ok, 'precondition: the real progress route recorded the listen');
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h);
    tapRow(h, 'Recent Artists'); await settleNet();
    assert.ok(labels(h).includes('NESTALGIA'), 'precondition: the played artist is a Recent Artist: ' + labels(h).join('|'));
    tapRow(h, 'NESTALGIA'); await settleNet();
    tapRow(h, 'Full Album Mix'); await settleNet();
    assert.strictEqual(title(h), 'Full Album Mix');
    await pickTrackAThenCrossItsEnd(h, 'Full Album Mix');
  } });
});

test('v1.331 (Dean): Albums > album > a chapter plays ON through the album at the chapter end', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h);
    tapRow(h, 'Albums'); await settleNet();
    tapRow(h, 'Full Album Mix'); await settleNet();
    await pickTrackAThenCrossItsEnd(h, 'Full Album Mix');
  } });
});

test('v1.331 (Dean: "regular album play as well"): Artists > artist > album > a chapter plays ON through the album (the non-recent artist path)', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h);
    tapRow(h, 'Artists'); await settleNet();
    tapRow(h, 'NESTALGIA'); await settleNet();
    tapRow(h, 'Full Album Mix'); await settleNet();
    await pickTrackAThenCrossItsEnd(h, 'Full Album Mix');
  } });
});

test('v1.331 (Dean: "regular album play as well"): Seattle\'s Albums pivot > album > a chapter plays ON through the album', async () => {
  await boot({ skin: 'zune-classic', play: 'nd1', run: async (h) => {
    menu(h); select(h); await settleNet();
    click(h.dom, h.panel.querySelector('[data-skin-next]')); await settleNet(); // Artists -> the Albums pivot
    assert.strictEqual(h.panel.querySelector('.ipm-pv').textContent, 'Albums', 'precondition: on the Albums pivot');
    tapRow(h, 'Full Album Mix'); await settleNet();
    await pickTrackAThenCrossItsEnd(h, null); // Seattle's status line is not the level name
    assert.strictEqual(h.panel.querySelector('.ipm-title') && h.panel.querySelector('.ipm-title').textContent, 'Full Album Mix', 'Back climbs to the album the song came from');
  } });
});
