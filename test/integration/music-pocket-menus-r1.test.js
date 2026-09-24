'use strict';

// [INTEGRATION] Pocket menus - the gate r1 fixes (K1-K6), each driven through the REAL music.js
// view + skin engine against a REAL server (its own DATA_DIR), the shared harness in
// test/helpers/pocket-menu-harness.js. The fixture adds, beside the base library: a NATIVE
// music-store track with no artist tag (the untagged-artist bucket) and a library item whose
// title / artist / album / genre are crafted markup (the runtime escaping probe).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pocketmenus-r1-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, musicDb } = require('../../server');
const musicStore = require('../../lib/music/store');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { createPocketHarness } = require('../helpers/pocket-menu-harness');

// The REAL library-changed seam (common.js), required with no document so its shell boot stays off.
const savedDoc = global.document; const savedWin = global.window;
delete global.document; delete global.window;
const COMMON = require.resolve('../../public/js/common.js');
delete require.cache[COMMON];
const { notifyLibraryChanged, LIBRARY_CHANGED_EVENT } = require(COMMON);
if (savedDoc) global.document = savedDoc;
if (savedWin) global.window = savedWin;

let server, base, auth, authedFetch;
const ROOT = path.join(DATA_DIR, 'ytdlp');
const { menu, select, labels, cursorLabel, title, tapRow, inMenu, stepDown, settleNet, click, boot } = createPocketHarness(() => ({ base, authedFetch }));
const XSS = '<img src=x onerror=window.__pwn=1>';
const AUTOPLAY_KEY = 'ft-music-autoplay'; // music.js AUTOPLAY_STORAGE_KEY

function audioItem(id, folderName, artistName, tags, extra) {
  return Object.assign({
    id, type: 'audio', title: (tags && tags.title) || id, name: `${id}.mp3`,
    filePath: path.join(ROOT, folderName, `${id}.mp3`), rootFolder: ROOT, folderName, channelName: artistName,
    duration: 200, hasThumbnail: true, ext: '.mp3', addedAt: 1788000000000,
    tags: Object.assign({ artist: artistName }, tags || {}),
  }, extra || {});
}
const MIX_CHAPTERS = [{ startTime: 0, title: 'Intro' }, { startTime: 300, title: 'Track A' }, { startTime: 900, title: 'Track B' }];
const MIX_TEXT = '0:00 Intro\n5:00 Track A\n15:00 Track B';

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  authedFetch = global.fetch;
  seedState({ folders: [ROOT], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    db.metadata = {
      nd1: audioItem('nd1', 'tonzak', 'Tonzak', { title: 'Neon Arrival', album: 'Night Drive', track: '1', genre: 'Synthwave' }, { addedAt: 1788000000001 }),
      nd2: audioItem('nd2', 'tonzak', 'Tonzak', { title: 'Overpass', album: 'Night Drive', track: '2', genre: 'Synthwave' }, { addedAt: 1788000000002 }),
      nd3: audioItem('nd3', 'tonzak', 'Tonzak', { title: 'Tail Lights', album: 'Night Drive', track: '3', genre: 'Synthwave' }, { addedAt: 1788000000003 }),
      rm1: audioItem('rm1', 'nestalgiamusic', 'NESTALGIA', { title: 'Cartridge Blues', album: 'Retro Mix', track: '1', genre: 'Music' }),
      rm2: audioItem('rm2', 'nestalgiamusic', 'NESTALGIA', { title: 'Pixel Rain', album: 'Retro Mix', track: '2', genre: 'Music' }),
      djmix1: audioItem('djmix1', 'nestalgiamusic', 'NESTALGIA', { title: 'Full Album Mix', genre: 'Music' },
        { title: 'Full Album Mix', duration: 1800, chapters: MIX_CHAPTERS }),
      za1: audioItem('za1', 'zarchivo', 'Zarchivo', { title: 'Loose Single' }),
      // crafted markup in EVERY string a menu level renders (title, artist, album, genre)
      xss1: audioItem('xss1', 'evil', XSS, { title: XSS + ' song', album: '<b class=pwn>alb</b>', genre: '<i class=pwn>g</i>' }),
    };
    // thirty fillers (title-sorted LAST) so the Songs list is longer than one browse chunk (K3)
    for (let f = 1; f <= 30; f++) {
      const id = 'fil' + f;
      db.metadata[id] = audioItem(id, 'fillers', 'Filler Band', { title: 'Zz Filler ' + String(f).padStart(2, '0'), album: 'Fillers', track: String(f), genre: 'Filler' });
    }
    musicDb.mutate((h) => {
      const ns = musicStore.ensureMusic(h);
      ns.folders = [ROOT];
      // a NATIVE track with neither artist nor album artist: the untagged-artist bucket ('')
      ns.tracks = { nat1: { id: 'nat1', title: 'Nameless Tune', artist: '', albumArtist: '', album: '', filePath: path.join(ROOT, 'native/nat1.mp3'), rootFolder: ROOT, folderName: 'native', ext: '.mp3', codec: 'mp3', durationSec: 100, albumArtKey: null, addedAt: '2026-01-01T00:00:00.000Z' } };
      return true;
    });
    return true;
  });
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

async function realApi(pathname) { const r = await authedFetch(base + pathname); return r.json(); }
async function setMixChapters(text) {
  const r = await authedFetch(base + '/api/videos/djmix1/chapters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  assert.ok(r.ok, 'the chapter write landed');
}
const adminSetup = (onEditor) => (dom) => {
  dom.window.showToast = () => {};
  dom.window.fetchCurrentUser = async () => ({ user: { role: 'admin' } });
  dom.window.showChaptersEditor = (id, lines, onSaved) => { onEditor(id, lines, onSaved); };
};
const mp = (h, t, dur) => {
  const el = h.D.getElementById('media-player');
  Object.defineProperty(el, 'duration', { configurable: true, get: () => dur });
  Object.defineProperty(el, 'currentTime', { configurable: true, get: () => t.v, set(v) { t.v = v; } });
  return el;
};
async function tick(h, el, t, v) { t.v = v; el.dispatchEvent(new h.dom.window.Event('timeupdate')); await settleNet(5); }
async function openSongs(h) { menu(h); select(h); tapRow(h, 'Songs'); await settleNet(); }

// ---------------------------------------------------------------- K1
test('K1 (adversary W1): the queue advancing while you browse the list it plays from keeps YOUR row - Select plays the row you parked on', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    await openSongs(h);
    tapRow(h, labels(h)[0]); await settleNet(); // play row 0 (the playing context = Songs)
    menu(h);
    await stepDown(h); await stepDown(h); await stepDown(h); await stepDown(h);
    const parked = cursorLabel(h);
    const songs = (await realApi('/api/music?sort=title-asc&limit=10000')).items;
    const parkedId = songs.find((t) => t.title === parked).id;
    h.spy.nav.onNext(); await settleNet(); // the track ends: the queue advances
    assert.ok(inMenu(h), 'still in the list');
    assert.strictEqual(cursorLabel(h), parked, 'the advance did not move the highlight you parked on');
    const cur = h.panel.querySelector('.ipm-row.is-current .ipm-lbl');
    assert.strictEqual(cur && cur.textContent, songs[1].title, 'the speaker mark moved to what now plays');
    select(h); await settleNet();
    assert.strictEqual(h.player.currentId, parkedId, 'Select played the parked row');
  } });
});

// ---------------------------------------------------------------- K2
test('K2 (qa W1 + adversary W2): a chapter save RE-TIMES and DROPS - the open album level and the cached Songs re-load, and a pick plays the server\'s truth', async () => {
  let pending = null;
  try {
    await boot({
      skin: 'ipod', play: 'nd1',
      setup: adminSetup((id, lines, onSaved) => { pending = { id, onSaved }; }),
      run: async (h) => {
        await openSongs(h); // cache the whole library (the mix's three chapters)
        menu(h); tapRow(h, 'Albums'); await settleNet();
        tapRow(h, 'Full Album Mix'); await settleNet();
        tapRow(h, 'Intro'); await settleNet(); // the album drill is the browse view behind
        const btn = h.D.querySelector('#music-content .music-drill-chapters');
        assert.ok(btn, 'the drill offers Edit chapters (admin)');
        click(h.dom, btn); await settleNet(60);
        assert.ok(pending && pending.id === 'djmix1', 'the editor opened on the mix');
        // (1) RE-TIME: Track A now starts at 10:00, and a new Track C at 25:00
        await setMixChapters('0:00 Intro\n10:00 Renamed A\n20:00 Track B\n25:00 Track C');
        pending.onSaved(); await settleNet(40);
        menu(h); // Now Playing -> the album level ALREADY open (no skin repaint in between)
        await settleNet();
        assert.strictEqual(title(h), 'Full Album Mix');
        assert.deepStrictEqual(labels(h), ['Intro', 'Renamed A', 'Track B', 'Track C'], 'the open level re-loaded the server\'s chapters');
        tapRow(h, 'Renamed A'); await settleNet();
        const last = h.spy.loads[h.spy.loads.length - 1];
        assert.strictEqual(last.id, 'djmix1::c1');
        assert.strictEqual(last.data.chapterStartSec, 600, 'the re-timed offset plays, not the old 300');
        // (2) DROP: back to two chapters; the Songs level (cached before any edit) re-loads too
        pending = null;
        click(h.dom, h.D.querySelector('#music-content .music-drill-chapters')); await settleNet(60);
        await setMixChapters('0:00 Intro\n5:00 Track A');
        pending.onSaved(); await settleNet(40);
        menu(h); menu(h); menu(h); // np -> album -> Albums -> Music
        tapRow(h, 'Songs'); await settleNet();
        const server = (await realApi('/api/music?sort=title-asc&limit=10000')).items.map((t) => t.title);
        assert.deepStrictEqual(labels(h), server, 'the Songs level shows the server\'s list after the drop');
        assert.ok(!labels(h).includes('Track B') && !labels(h).includes('Track C'), 'the dropped chapters are gone');
      },
    });
  } finally { await setMixChapters(MIX_TEXT); }
});

test('K2: the ONE seam - a library-changed event from ANY writer (common.js notifyLibraryChanged, the event the chapters editor raises) re-loads an open level', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    await openSongs(h);
    const songsUrl = (u) => /^\/api\/music\?sort=title-asc&limit=10000$/.test(u);
    assert.strictEqual(h.log.filter(songsUrl).length, 1);
    assert.strictEqual(LIBRARY_CHANGED_EVENT, 'filetube:library-changed');
    assert.strictEqual(notifyLibraryChanged({ kind: 'chapters', mediaId: 'djmix1' }, h.D), true, 'the seam raised its event');
    await stepDown(h); // the next user action on the open level
    await settleNet();
    assert.strictEqual(h.log.filter(songsUrl).length, 2, 'the open Songs level re-loaded from the server');
    assert.ok(labels(h).length > 0 && !h.panel.querySelector('.ipm-skel'));
  } });
});

test('K2 (qa S8): an unlike re-loads an OPEN Liked Songs level', async () => {
  const r = await authedFetch(base + '/api/liked/nd3', { method: 'POST' });
  assert.ok(r.ok);
  await boot({ skin: 'ipod', play: 'nd1', setup: (dom) => { dom.window.showToast = () => {}; }, run: async (h) => {
    menu(h); select(h); tapRow(h, 'Playlists'); tapRow(h, 'Liked Songs'); await settleNet();
    assert.deepStrictEqual(labels(h), ['Tail Lights']);
    tapRow(h, 'Tail Lights'); await settleNet(); // Now Playing; the Liked list is the browse view behind
    const heart = h.D.querySelector('#music-content .music-song-row[data-id="nd3"] .music-like-btn[data-like-id]');
    assert.ok(heart, 'the browse row offers its heart');
    click(h.dom, heart); await settleNet();
    menu(h); await settleNet(); // back into the open Liked Songs level
    assert.deepStrictEqual(labels(h), [], 'the unliked song left the open Liked level');
    assert.match(h.panel.querySelector('.ipm-note').textContent, /Songs you like/);
  } });
});

// ---------------------------------------------------------------- K4
test('K4 (the Architect\'s ruling): a chapter picked from a FLAT list plays its own segment, then the LIST moves on (never the rest of the file, never a station mid-list)', async () => {
  const songs = (await realApi('/api/music?sort=title-asc&limit=10000')).items;
  const at = (title) => songs.findIndex((t) => t.title === title);
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    await openSongs(h);
    const logBefore = h.log.length;
    tapRow(h, 'Intro'); await settleNet();
    assert.strictEqual(h.player.currentId, 'djmix1::c0');
    assert.ok(!h.log.slice(logBefore).some((u) => /sort=random/.test(u)), 'no station is primed for a flat pick');
    const t = { v: 0 }; const el = mp(h, t, 1800);
    await tick(h, el, t, 150); await tick(h, el, t, 299.2); await tick(h, el, t, 299.9);
    assert.strictEqual(h.player.currentId, songs[at('Intro') + 1].id, 'at the end of Intro\'s segment the list moved to ITS next row (' + songs[at('Intro') + 1].title + ')');
    // a chapter whose next ROW is the file's own next segment (title order: Track A, Track B):
    // the file rolls on into it untouched - no reload gap - and the list's mark follows
    assert.strictEqual(songs[at('Track A') + 1].title, 'Track B', 'precondition: Track B follows Track A in the list');
    menu(h); tapRow(h, 'Track A'); await settleNet();
    assert.strictEqual(h.player.currentId, 'djmix1::c1');
    const loads = h.spy.loads.length;
    const t2 = { v: 300 }; const el2 = mp(h, t2, 1800);
    await tick(h, el2, t2, 600); await tick(h, el2, t2, 899.9); await tick(h, el2, t2, 900.4);
    assert.strictEqual(h.spy.loads.length, loads, 'no reload: the next row is the next segment of the same file');
    menu(h);
    assert.strictEqual(h.panel.querySelector('.ipm-row.is-current .ipm-lbl').textContent, 'Track B', 'the list\'s mark rolled on to Track B');
  } });
});

test('K4: an artist\'s All Songs (a flat list whose chapters sit together) rolls the file on into the next chapter with no reload (the album-pick v1.311 rule stays bound in music-pocket-menus.test.js)', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h); tapRow(h, 'Artists'); await settleNet();
    tapRow(h, 'NESTALGIA'); await settleNet();
    tapRow(h, 'All Songs'); await settleNet();
    assert.deepStrictEqual(labels(h).slice(labels(h).indexOf('Intro'), labels(h).indexOf('Intro') + 2), ['Intro', 'Track A'], 'precondition: the mix\'s chapters sit together, in order: ' + labels(h).join('|'));
    tapRow(h, 'Intro'); await settleNet();
    const loads = h.spy.loads.length;
    const t = { v: 0 }; const el = mp(h, t, 1800);
    await tick(h, el, t, 299.9); await tick(h, el, t, 300.3);
    assert.strictEqual(h.spy.loads.length, loads, 'the next row IS the file\'s next segment: no reload gap');
    menu(h);
    assert.strictEqual(h.panel.querySelector('.ipm-row.is-current .ipm-lbl').textContent, 'Track A', 'the file rolled on into Track A');
  } });
});

// ---------------------------------------------------------------- K6 bindings
test('K6 A9: a Shuffle Songs fetch that lands AFTER a later menu pick never plays over it', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  await boot({
    skin: 'ipod', play: 'nd1',
    intercept: (u) => (/sort=random&seed=\d+&limit=10000/.test(u)
      ? { ok: true, status: 200, json: async () => { await gate; return (await authedFetch(base + u)).json(); } } : null),
    run: async (h) => {
      menu(h); tapRow(h, 'Shuffle Songs'); await settleNet(5);
      menu(h); tapRow(h, 'Music'); tapRow(h, 'Albums'); await settleNet();
      tapRow(h, 'Retro Mix'); await settleNet();
      tapRow(h, 'Pixel Rain'); await settleNet();
      assert.strictEqual(h.player.currentId, 'rm2');
      release(); await settleNet(40);
      assert.strictEqual(h.player.currentId, 'rm2', 'the late shuffle stood down');
    },
  });
});

test('K6 A10: an in-flight browse album select cannot play over a menu pick', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h); tapRow(h, 'Albums'); await settleNet();
    tapRow(h, 'Retro Mix'); await settleNet(); // the menu level is ready
    click(h.dom, h.D.querySelector('.music-tab[data-tab="songs"]')); await settleNet();
    const row = h.D.querySelector('#music-content .music-song-row[data-id="za1"] .music-song-main');
    assert.ok(row, 'the Songs tab lists the single');
    click(h.dom, row); // a browse select: it drills into za1's album first (an awaited render)...
    tapRow(h, 'Pixel Rain'); // ...and before that lands, a pick from the menu
    await settleNet(40);
    assert.strictEqual(h.player.currentId, 'rm2', 'the menu pick stands - the stale album select stood down');
  } });
});

test('K6 A15: the artist cache is dropped by a rescan (a re-entered artist re-fetches)', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    const artistCalls = () => h.log.filter((u) => /^\/api\/music\?artist=Tonzak&/.test(u)).length;
    menu(h); select(h); tapRow(h, 'Artists'); await settleNet();
    tapRow(h, 'Tonzak'); await settleNet();
    menu(h); tapRow(h, 'Tonzak'); await settleNet();
    assert.strictEqual(artistCalls(), 1, 'cached within the session');
    click(h.dom, h.D.getElementById('music-scan-btn')); await settleNet();
    menu(h); await settleNet(); // the open Artists level re-loads (the library changed)
    tapRow(h, 'Tonzak'); await settleNet();
    assert.strictEqual(artistCalls(), 2, 'the rescan dropped the artist cache');
  } });
});

test('K6 A23: Recently Added and Recently Played are the real smart lists', async () => {
  const added = (await realApi('/api/music?sort=newest&limit=100')).items.map((t) => t.title);
  const p = await authedFetch(base + '/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'nd2', timestamp: 30, duration: 200 }) });
  assert.ok(p.ok, 'progress saved for Overpass');
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h); tapRow(h, 'Playlists');
    tapRow(h, 'Recently Added'); await settleNet();
    assert.ok(labels(h).length >= 20, 'rows rendered');
    assert.deepStrictEqual(labels(h), added.slice(0, labels(h).length), 'newest first, the /api/music?sort=newest list (the rendered window of it)');
    menu(h); tapRow(h, 'Recently Played'); await settleNet();
    assert.ok(labels(h).includes('Overpass'), 'a song with a saved position is Recently Played: ' + labels(h).join('|'));
    assert.ok(!labels(h).includes('Tail Lights'), '...and only those');
  } });
});

test('K6 A24: an untagged NATIVE track lives under "Unknown Artist" alone (never the whole library)', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h); tapRow(h, 'Artists'); await settleNet();
    tapRow(h, 'Unknown Artist'); await settleNet();
    assert.deepStrictEqual(labels(h), ['Unknown Album'], 'one (untitled) album');
    tapRow(h, 'Unknown Album'); await settleNet();
    assert.deepStrictEqual(labels(h), ['Nameless Tune'], 'only the untagged track');
  } });
});

test('K6 A20/A22: crafted markup in a title, artist, album or genre never becomes markup on ANY level of either skin', async () => {
  for (const skin of ['ipod', 'zune-classic']) {
    await boot({ skin, play: 'nd1', run: async (h) => {
      const injected = () => h.panel.querySelectorAll('.ip-menuview img:not(.ipm-art-img), .ip-menuview .pwn, .ip-np img, .ip-np .pwn').length;
      const seen = [];
      const check = (where) => { seen.push(where); assert.strictEqual(injected(), 0, skin + ' ' + where + ': injected markup'); };
      menu(h); check('main');
      select(h); await settleNet(); check('music');
      if (skin === 'zune-classic') {
        for (let k = 0; k < 5; k++) { await settleNet(); check('pivot ' + k); click(h.dom, h.panel.querySelector('[data-skin-next]')); }
        tapRow(h, XSS); await settleNet(); check('artist');
        tapRow(h, '<b class=pwn>alb</b>'); await settleNet(); check('album');
        assert.ok(h.panel.querySelector('.ipm-title').textContent.indexOf('<b class=pwn>') >= 0, 'the drilled title shows the crafted text as TEXT');
      } else {
        tapRow(h, 'Artists'); await settleNet(); check('artists');
        tapRow(h, XSS); await settleNet(); check('artist');
        tapRow(h, '<b class=pwn>alb</b>'); await settleNet(); check('artist album');
        menu(h); menu(h); menu(h); tapRow(h, 'Albums'); await settleNet(); check('albums');
        tapRow(h, '<b class=pwn>alb</b>'); await settleNet(); check('album');
        menu(h); menu(h); tapRow(h, 'Songs'); await settleNet(); check('songs');
        menu(h); tapRow(h, 'Genres'); await settleNet(); check('genres');
        tapRow(h, '<i class=pwn>g</i>'); await settleNet(); check('genre');
      }
      assert.strictEqual(h.dom.window.__pwn, undefined);
      assert.ok(seen.length >= 6);
    } });
  }
});

// ---------------------------------------------------------------- K3
test('K3 (qa W2 + adversary W3): a pick from a long flat list clears the browse view at once and re-builds it in chunks AFTER the tap - index-true, and a newer pick abandons the older build', async () => {
  const songs = (await realApi('/api/music?sort=title-asc&limit=10000')).items;
  assert.ok(songs.length > 40, 'precondition: longer than two chunks (' + songs.length + ')');
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    await openSongs(h);
    tapRow(h, 'Cartridge Blues');
    const rowsNow = h.D.querySelectorAll('#music-content .music-song-row').length;
    assert.strictEqual(rowsNow, 0, 'the tap built NO browse rows (was: every row, synchronously)');
    assert.strictEqual(h.player.currentId, 'rm1', 'the song started in the tap');
    // a NEWER flat pick before the first build finishes: its chunks must not interleave
    menu(h); menu(h); tapRow(h, 'Playlists'); tapRow(h, 'Recently Added'); await settleNet();
    const added = (await realApi('/api/music?sort=newest&limit=100')).items;
    tapRow(h, labels(h)[0]);
    await settleNet(120);
    const behind = [...h.D.querySelectorAll('#music-content .music-song-row')];
    assert.deepStrictEqual(behind.map((r) => r.getAttribute('data-id')), added.map((t) => t.id), 'only the NEWER list, whole and in order');
    assert.ok(behind.every((r, i) => r.getAttribute('data-index') === String(i)), 'every row indexes the queue');
    const late = behind[behind.length - 3];
    click(h.dom, late.querySelector('.music-song-main'));
    await settleNet();
    assert.strictEqual(h.player.currentId, late.getAttribute('data-id'), 'a late-built row plays its own track');
  } });
});

test('adversary S7 (closes D6): a browse drill render still in flight when a flat menu pick lands never paints its drill header over the pick\'s list', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    await openSongs(h); // the Songs level is loaded and on screen
    click(h.dom, h.D.querySelector('.music-tab[data-tab="albums"]')); await settleNet();
    const card = h.D.querySelector('#music-content .music-album-card[data-album-key]');
    assert.ok(card, 'the browse Albums grid');
    click(h.dom, card); // openDrill -> render(): the drill arm awaits its load...
    tapRow(h, 'Loose Single'); // ...and a flat pick lands first
    await settleNet(80);
    assert.strictEqual(h.D.querySelector('#music-content .music-drill'), null, 'no stale drill header');
    assert.strictEqual(h.D.getElementById('music-crumb').textContent, 'Songs');
    assert.strictEqual(h.player.currentId, 'za1');
  } });
});

test('K3: an autoplay append landing mid-build (a pick of a long list\'s LAST row) never strands the browse list half-built', async () => {
  await boot({ skin: 'ipod', play: 'nd1', run: async (h) => {
    menu(h); select(h); tapRow(h, 'Genres'); await settleNet();
    tapRow(h, 'Filler'); await settleNet();
    assert.strictEqual(labels(h).length, 30, 'precondition: thirty fillers');
    tapRow(h, 'Zz Filler 30'); // the LAST row: its load arms the endless-autoplay append
    await settleNet(160);
    assert.ok(h.log.some((u) => /sort=random/.test(u)), 'precondition: the autoplay append was fetched');
    const behind = [...h.D.querySelectorAll('#music-content .music-song-row')];
    assert.strictEqual(behind.length, 30, 'every row of the list was built');
    assert.ok(behind.every((r, i) => r.getAttribute('data-index') === String(i)));
  } });
});

test('K4: a flat list\'s LAST row, a chapter mid-file, still ends at its own segment once autoplay has appended a station', async () => {
  const r = await authedFetch(base + '/api/liked/' + encodeURIComponent('djmix1::c1'), { method: 'POST' });
  assert.ok(r.ok, 'liked the chapter Track A');
  // the station is deterministic: its picks are REAL library rows of other files (the random
  // arms would otherwise sometimes pick this mix's own next chapter, which rolls on by design)
  const station = (await realApi('/api/music?sort=title-asc&limit=10000')).items.filter((t) => t.id === 'za1' || t.id === 'nd2');
  try {
    await boot({ skin: 'ipod', play: 'nd1', intercept: (u) => (/sort=random/.test(u) ? { ok: true, status: 200, json: async () => ({ items: station }) } : null), run: async (h) => {
      menu(h); select(h); tapRow(h, 'Playlists'); tapRow(h, 'Liked Songs'); await settleNet();
      assert.deepStrictEqual(labels(h), ['Track A']);
      tapRow(h, 'Track A'); await settleNet(60); // the last (only) row: the autoplay append lands
      assert.ok(h.log.some((u) => /sort=random/.test(u)), 'precondition: a station was appended');
      const loads = h.spy.loads.length;
      const t = { v: 300 }; const el = mp(h, t, 1800);
      await tick(h, el, t, 600); await tick(h, el, t, 899.9);
      assert.strictEqual(h.spy.loads.length, loads + 1, 'at its segment end the queue moved on to its next row (a load)');
      assert.ok(['za1', 'nd2'].includes(h.player.currentId), 'onto the appended station, never on through the rest of the file (' + h.player.currentId + ')');
    } });
  } finally { await authedFetch(base + '/api/liked/' + encodeURIComponent('djmix1::c1'), { method: 'DELETE' }); }
});

test('K4 x v1.320: with Autoplay switched OFF after the station was appended, a flat chapter\'s segment end stops there - it never steps into a station pick', async () => {
  const r = await authedFetch(base + '/api/liked/' + encodeURIComponent('djmix1::c1'), { method: 'POST' });
  assert.ok(r.ok);
  const station = (await realApi('/api/music?sort=title-asc&limit=10000')).items.filter((t) => t.id === 'za1' || t.id === 'nd2');
  try {
    await boot({ skin: 'ipod', play: 'nd1', intercept: (u) => (/sort=random/.test(u) ? { ok: true, status: 200, json: async () => ({ items: station }) } : null), run: async (h) => {
      menu(h); select(h); tapRow(h, 'Playlists'); tapRow(h, 'Liked Songs'); await settleNet();
      tapRow(h, 'Track A'); await settleNet(60);
      assert.ok(h.log.some((u) => /sort=random/.test(u)), 'precondition: the station was appended');
      h.dom.window.localStorage.setItem(AUTOPLAY_KEY, '0'); // Autoplay switched off (e.g. on another device)
      const loads = h.spy.loads.length;
      const t = { v: 300 }; const el = mp(h, t, 1800);
      let paused = 0; el.pause = () => { paused += 1; };
      await tick(h, el, t, 600); await tick(h, el, t, 899.9);
      assert.strictEqual(h.spy.loads.length, loads, 'no step into the station');
      assert.strictEqual(paused, 1, 'the list ended at the chapter\'s own segment end');
    } });
  } finally { await authedFetch(base + '/api/liked/' + encodeURIComponent('djmix1::c1'), { method: 'DELETE' }); }
});
