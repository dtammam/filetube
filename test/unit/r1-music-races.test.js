'use strict';

// [UNIT] v1.339 R1 (plan 2026-09-26-fouc-toctou-audit, T-C5 / T-C6 / T-C7 + the music half of
// T-C4): wrong-item races in the REAL public/js/music.js view, booted in jsdom against a mock
// player. Every race holds one fetch open with a manually resolved promise, performs the
// competing action while it is pending (a view teardown, a tab switch, a newer load), releases
// it, and asserts the stale continuation did NOT act. Each has a control proving the normal
// path still acts (so a guard that simply kills the feature goes red too).
//
// T-C5: the ?play= deep-link continuations (playListenItem, playTrackFromContinue ->
//   playTrackInAlbum) and the ?nowplaying=1 album restore had no `signal.aborted` re-check
//   after their awaits: a late playAt replaced whatever the user moved on to, a late
//   location.replace hijacked their navigation, a late registerTrackNav overwrote the
//   player's global lock-screen nav. (rebuildPlayingQueue is the same class - bound here too.)
// T-C6: render()'s stillMine() compared only the menu-pick generation, so a stale tab / sort /
//   drill response painted over the active one.
// T-C7: a superseded loadSongs returned the LIVE queue and Shuffle played its row 0.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM, VirtualConsole } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div class="music-toolbar"><div class="music-toolbar-actions">
    <select id="music-sort-select"></select>
    <button id="music-shuffle-btn" type="button">Shuffle</button>
    <button id="music-scan-btn" type="button">Scan</button>
    <div class="music-actions-wrap"><button id="music-actions-btn" type="button" hidden></button>
    <div class="mms-sticker-menu" id="music-actions-menu" role="menu" hidden></div></div>
  </div></div>
  <div id="player-slot"></div>
  <div id="music-nowplaying-panel" class="music-nowplaying-panel" hidden></div>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab" data-tab="albums" role="tab">Albums</button>
    <button type="button" class="music-tab" data-tab="artists" role="tab">Artists</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function settleMany(n) { for (let i = 0; i < (n || 12); i++) await settle(); }

function defer() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// A library track (source 'library' - never a chapter, so playAt goes straight to player.load).
const track = (id, extra) => Object.assign({ id, title: 'T ' + id, artist: 'Band', album: '', albumKey: '', source: 'library', durationSec: 100 }, extra || {});

// Boot the REAL music init(). `route(url)` answers each fetch: an object = 200 JSON, a Promise
// = held until the test resolves it, `{ __status }` = a non-OK response.
async function bootMusic(opts, run) {
  const vc = new VirtualConsole();
  const navigations = [];
  vc.on('jsdomError', (e) => { if (/navigation/i.test(String(e && e.message))) navigations.push(String(e.message)); });
  const dom = new JSDOM(VIEW_HTML, { url: opts.url || 'http://localhost/music', virtualConsole: vc });
  const saved = {
    window: global.window, document: global.document, localStorage: global.localStorage,
    fetch: global.fetch, AbortController: global.AbortController,
  };
  const fetches = [];
  const loads = [];
  const navs = [];
  let registered = null;
  let extrasCfg = null;
  let state = opts.playerState || 'closed';
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.AbortController = dom.window.AbortController;
  dom.window.scrollTo = function () {};
  const player = {
    currentId: opts.currentId || null,
    getState: () => state,
    getCurrentMeta: () => opts.meta || null,
    load: (id, data, o) => { loads.push(id); player.currentId = id; state = (o && o.slot) ? 'full' : 'docked'; },
    setTrackNav: (h) => { navs.push(h); },
    expand: () => { state = 'full'; },
    close: () => {},
  };
  dom.window.FileTube = Object.assign({
    registerView: (name, mod) => { registered = mod; },
    shimmerArt: () => {},
    player,
  }, opts.fileTube || {});
  // The REAL skin-surface.js (as music.html loads it), with createExtrasMenu wrapped so the test
  // can read the cfg music hands the desktop actions menu.
  delete require.cache[surfacePath];
  require(surfacePath);
  const realCreateExtras = dom.window.FileTubeSkinSurface.createExtrasMenu;
  dom.window.FileTubeSkinSurface.createExtrasMenu = (cfg) => { extrasCfg = cfg; return realCreateExtras(cfg); };
  global.fetch = (url) => {
    const u = String(url);
    fetches.push(u);
    return Promise.resolve(opts.route(u)).then((body) => (body && body.__status)
      ? { ok: false, status: body.__status, json: async () => ({}) }
      : { ok: true, json: async () => body });
  };
  Object.keys(opts.storage || {}).forEach((k) => dom.window.localStorage.setItem(k, opts.storage[k]));
  try {
    delete require.cache[musicPath];
    require(musicPath);
    assert.ok(registered && typeof registered.init === 'function', 'view registered');
    registered.init(dom.window.document.getElementById('view-root'));
    let destroyed = false;
    const ctx = {
      dom, fetches, loads, navs, navigations, player,
      content: () => dom.window.document.getElementById('music-content'),
      destroy: () => { destroyed = true; registered.destroy(); },
      extrasCfg: () => extrasCfg,
    };
    await run(ctx);
    if (!destroyed) registered.destroy();
  } finally {
    delete require.cache[musicPath];
    delete require.cache[surfacePath];
    Object.assign(global, saved);
  }
}

// ---- T-C5: deep-link continuations re-check the view's signal after every await ----------------

for (const leave of [true, false]) {
  test('T-C5 playListenItem: ' + (leave ? 'the view left during /api/videos -> the late answer plays NOTHING' : 'control - the view stays -> the listen item plays'), async () => {
    const hold = defer();
    await bootMusic({
      url: 'http://localhost/music?play=v1&listen=1',
      route: (u) => (u === '/api/videos/v1' ? hold.promise : { items: [] }),
    }, async (c) => {
      await settleMany();
      assert.ok(c.fetches.includes('/api/videos/v1'), 'precondition: the listen fetch is in flight');
      if (leave) c.destroy();
      hold.resolve({ id: 'v1', title: 'A video', channelName: 'Ch', duration: 60 });
      await settleMany();
      assert.deepStrictEqual(c.loads, leave ? [] : ['v1']);
    });
  });

  test('T-C5 playListenItem miss: ' + (leave ? 'the view left -> the late 404 does NOT bounce (location.replace)' : 'control - the view stays -> the 404 bounces to /watch'), async () => {
    const hold = defer();
    await bootMusic({
      url: 'http://localhost/music?play=v1&listen=1',
      route: (u) => (u === '/api/videos/v1' ? hold.promise : { items: [] }),
    }, async (c) => {
      await settleMany();
      if (leave) c.destroy();
      hold.resolve({ __status: 404 });
      await settleMany();
      assert.strictEqual(c.navigations.length, leave ? 0 : 1, 'navigations: ' + JSON.stringify(c.navigations));
    });
  });

  test('T-C5 playTrackFromContinue: ' + (leave ? 'the view left during the recent-listening fetch -> nothing plays' : 'control - the tapped track plays'), async () => {
    const hold = defer();
    await bootMusic({
      url: 'http://localhost/music?play=t1',
      route: (u) => (u.indexOf('/api/music?filter=recent-listening') === 0 ? hold.promise : { items: [] }),
    }, async (c) => {
      await settleMany();
      assert.ok(c.fetches.some((u) => u.indexOf('filter=recent-listening') >= 0), 'precondition: the recent fetch is in flight');
      if (leave) c.destroy();
      hold.resolve({ items: [track('t0'), track('t1')] });
      await settleMany();
      assert.deepStrictEqual(c.loads, leave ? [] : ['t1']);
    });
  });

  test('T-C5 playTrackFromContinue fallback fetch: ' + (leave ? 'the view left during /api/music/<id> -> the late track does NOT play' : 'control - it plays'), async () => {
    const hold = defer();
    await bootMusic({
      url: 'http://localhost/music?play=t9&ao=1',
      route: (u) => (u === '/api/music/t9' ? hold.promise : { items: [] }),
    }, async (c) => {
      await settleMany();
      assert.ok(c.fetches.includes('/api/music/t9'), 'precondition: the fallback fetch is in flight');
      if (leave) c.destroy();
      hold.resolve(track('t9'));
      await settleMany();
      assert.deepStrictEqual(c.loads, leave ? [] : ['t9']);
    });
  });

  test('T-C5 playTrackFromContinue ao miss: ' + (leave ? 'the view left -> the late miss does NOT bounce to /watch' : 'control - the miss bounces'), async () => {
    const hold = defer();
    await bootMusic({
      url: 'http://localhost/music?play=t9&ao=1',
      route: (u) => (u === '/api/music/t9' ? hold.promise : { items: [] }),
    }, async (c) => {
      await settleMany();
      if (leave) c.destroy();
      hold.resolve({ __status: 404 });
      await settleMany();
      assert.strictEqual(c.navigations.length, leave ? 0 : 1, 'navigations: ' + JSON.stringify(c.navigations));
    });
  });

  test('T-C5 playTrackInAlbum: ' + (leave ? 'the view left during the album load -> nothing plays' : 'control - the track plays in its album'), async () => {
    const hold = defer();
    const t1 = track('t1', { album: 'Rec', albumKey: 'k1' });
    await bootMusic({
      url: 'http://localhost/music?play=t1',
      route: (u) => {
        if (u.indexOf('/api/music?filter=recent-listening') === 0) return { items: [t1] };
        if (u.indexOf('/api/music?') === 0 && u.indexOf('album=k1') >= 0) return hold.promise;
        return { items: [] };
      },
    }, async (c) => {
      await settleMany();
      assert.ok(c.fetches.some((u) => u.indexOf('album=k1') >= 0), 'precondition: the album load is in flight');
      if (leave) c.destroy();
      hold.resolve({ items: [track('t0', { albumKey: 'k1' }), t1] });
      await settleMany();
      assert.deepStrictEqual(c.loads, leave ? [] : ['t1']);
    });
  });

  test('T-C5 ?nowplaying=1 album restore: ' + (leave ? 'the view left during the album load -> the lock-screen nav is NOT re-registered' : 'control - nav is registered around the playing track'), async () => {
    const hold = defer();
    const meta = { id: 't1', isMusic: true, title: 'T t1', artist: 'Band', album: 'Rec', albumKey: 'k1', browseCtx: '' };
    await bootMusic({
      url: 'http://localhost/music?nowplaying=1',
      currentId: 't1', playerState: 'docked', meta,
      route: (u) => (u.indexOf('/api/music?') === 0 && u.indexOf('album=k1') >= 0 ? hold.promise : { items: [] }),
    }, async (c) => {
      await settleMany();
      assert.ok(c.fetches.some((u) => u.indexOf('album=k1') >= 0), 'precondition: the album restore is in flight');
      const before = c.navs.length;
      if (leave) c.destroy();
      hold.resolve({ items: [track('t1', { albumKey: 'k1' }), track('t2', { albumKey: 'k1' })] });
      await settleMany();
      const after = c.navs.slice(before);
      if (leave) assert.strictEqual(after.length, 0, 'no registration from the dead view');
      else assert.ok(after.some((h) => h && typeof h.onNext === 'function'), 'nav armed around t1 (t2 is next)');
    });
  });

  test('T-C5 class, rebuildPlayingQueue: ' + (leave ? 'the view left during its queue load -> nav is NOT re-registered' : 'control - nav is registered'), async () => {
    const hold = defer();
    const meta = { id: 't1', isMusic: true, title: 'T t1', artist: 'Band', album: 'Rec', albumKey: '', browseCtx: 'ctx' };
    await bootMusic({
      storage: { filetube_music_tab: 'albums' },
      currentId: 't1', playerState: 'full', meta,
      fileTube: { decodeListContext: () => ({ src: 'music', album: 'k1' }) },
      route: (u) => (u.indexOf('/api/music?') === 0 && u.indexOf('album=k1') >= 0 ? hold.promise : { items: [] }),
    }, async (c) => {
      await settleMany();
      assert.ok(c.fetches.some((u) => u.indexOf('album=k1') >= 0), 'precondition: the rebuild load is in flight');
      const before = c.navs.length;
      if (leave) c.destroy();
      hold.resolve({ items: [track('t1'), track('t2')] });
      await settleMany();
      const after = c.navs.slice(before);
      if (leave) assert.strictEqual(after.length, 0, 'no registration from the dead view');
      else assert.ok(after.some((h) => h && typeof h.onNext === 'function'), 'nav re-armed around t1');
    });
  });
}

// ---- T-C6: a stale render never paints over the newer one -------------------------------------

for (const switchTab of [true, false]) {
  test('T-C6: ' + (switchTab ? 'Albums -> Artists while the albums fetch is pending: the late albums answer does NOT paint over Artists' : 'control - with no switch the albums grid paints'), async () => {
    const hold = defer();
    let albumCalls = 0;
    await bootMusic({
      storage: { filetube_music_tab: 'albums' },
      route: (u) => {
        if (u.indexOf('/api/music/albums') === 0) { albumCalls += 1; return albumCalls === 1 ? hold.promise : { items: [] }; }
        if (u.indexOf('/api/music/artists') === 0) return { items: [{ artist: 'Boards', albumCount: 1, trackCount: 3, artIds: ['x'] }] };
        return { items: [] };
      },
    }, async (c) => {
      await settleMany();
      assert.strictEqual(albumCalls, 1, 'precondition: the albums fetch is in flight');
      if (switchTab) {
        c.dom.window.document.querySelector('.music-tab[data-tab="artists"]').click();
        await settleMany();
        assert.ok(c.content().querySelector('.music-artist-card, .music-artist-row, [data-artist]'), 'precondition: Artists painted');
      }
      hold.resolve({ items: [{ albumKey: 'k1', album: 'One', artist: 'Boards', artId: 'x', trackCount: 4 }] });
      await settleMany();
      const albumCards = c.content().querySelectorAll('.music-album-card').length;
      if (switchTab) {
        assert.strictEqual(albumCards, 0, 'the stale albums grid did not paint');
        assert.ok(c.content().querySelector('.music-artist-card, .music-artist-row, [data-artist]'), 'Artists is still on screen');
      } else {
        assert.strictEqual(albumCards, 1, 'the albums grid painted');
      }
    });
  });
}

// ---- T-C7: a superseded Shuffle load plays nothing --------------------------------------------

for (const supersede of [true, false]) {
  test('T-C7: ' + (supersede ? 'Shuffle, then the Songs tab loads first: the superseded shuffle does NOT play row 0' : 'control - Shuffle alone plays the top of the shuffled list'), async () => {
    const hold = defer();
    await bootMusic({
      storage: { filetube_music_tab: 'albums' },
      route: (u) => {
        if (u.indexOf('/api/music?') === 0 && u.indexOf('sort=random') >= 0) return hold.promise;
        if (u.indexOf('/api/music?') === 0) return { items: [track('s1'), track('s2')] };
        return { items: [] };
      },
    }, async (c) => {
      await settleMany();
      c.dom.window.document.getElementById('music-shuffle-btn').click();
      await settleMany();
      assert.ok(c.fetches.some((u) => u.indexOf('sort=random') >= 0), 'precondition: the shuffle load is in flight');
      if (supersede) {
        c.dom.window.document.querySelector('.music-tab[data-tab="songs"]').click(); // a newer loadSongs
        await settleMany();
      }
      hold.resolve({ items: [track('s2'), track('s1')] });
      await settleMany();
      assert.deepStrictEqual(c.loads, supersede ? [] : ['s2']);
    });
  });
}

// ---- T-C4, the music half: onMutated({ playingRemoved:false }) keeps the NEW track's state ----

for (const removed of [false, true]) {
  test('T-C4 music afterExtrasMutation: playingRemoved ' + removed + ' -> ' + (removed ? 'the playing highlight is cleared (control)' : 'the still-playing track keeps its highlight'), async () => {
    await bootMusic({
      storage: { filetube_music_tab: 'songs' },
      currentId: 's1', playerState: 'full',
      route: (u) => (u.indexOf('/api/music?') === 0 ? { items: [track('s1'), track('s2')] } : { items: [] }),
    }, async (c) => {
      await settleMany();
      const playingRow = () => c.content().querySelector('.music-song-row.playing');
      assert.ok(playingRow() && playingRow().getAttribute('data-id') === 's1', 'precondition: s1 is highlighted as playing');
      c.dom.window.document.getElementById('music-actions-btn').click(); // builds the desktop Extras menu
      const cfg = c.extrasCfg();
      assert.ok(cfg && typeof cfg.onMutated === 'function', 'precondition: music handed its onMutated to the Extras core');
      cfg.onMutated({ playingRemoved: removed });
      await settleMany();
      if (removed) assert.strictEqual(playingRow(), null, 'the removed item\'s playing state is cleared');
      else assert.ok(playingRow() && playingRow().getAttribute('data-id') === 's1', 'the track that plays NOW stays highlighted');
    });
  });
}
