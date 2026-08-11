'use strict';

// [UNIT] v1.104 - the expanded now-playing view. Two Dean-reported gaps in the
// #player-slot expanded view: (B) next/prev collapsed it to the mini-bar because
// every track change loaded with {dock:true}; (A) it showed no track metadata.
// These boot the REAL music view against a jsdom document with a stateful mock
// player and assert BEHAVIOUR (what position the player is loaded into, what the
// now-playing panel renders), not source strings.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');

// A music view with #player-slot, the now-playing panel, tabs, and content.
const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div id="player-slot"></div>
  <div id="music-nowplaying-panel" hidden></div>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
    <button type="button" class="music-tab" data-tab="artists" role="tab">Artists</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <button type="button" class="music-nowplaying" id="music-nowplaying" hidden></button>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const SONGS = [
  { id: 't1', title: 'Alpha', artist: 'Boards', album: 'One', albumKey: 'k1', durationSec: 100 },
  { id: 't2', title: 'Bravo', artist: 'Boards', album: 'One', albumKey: 'k1', durationSec: 110 },
  { id: 't3', title: 'Charlie', artist: 'Boards', album: 'One', albumKey: 'k1', durationSec: 120 },
];

const settle = () => new Promise((resolve) => setImmediate(resolve));

function makePlayer(initialState, meta) {
  const s = { value: initialState || 'closed', loadCalls: [], expandCalls: [], trackNav: null };
  const player = {
    currentId: meta ? meta.id : null,
    getState: () => s.value,
    getCurrentMeta: () => meta || null,
    load: (id, data, opts) => {
      s.loadCalls.push({ id, data, opts: opts || {} });
      player.currentId = id;
      if (opts && opts.slot) s.value = 'full';
      else if (opts && opts.dock) s.value = 'docked';
    },
    expand: (slot) => { s.expandCalls.push(slot); s.value = 'full'; },
    setTrackNav: (h) => { s.trackNav = h; },
  };
  return { player, s, setState: (v) => { s.value = v; } };
}

async function boot(storage, initialState, run, opts) {
  opts = opts || {};
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const saved = {
    window: global.window, document: global.document,
    localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController,
  };
  const mock = makePlayer(initialState, opts.meta);
  let registered = null;
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.AbortController = dom.window.AbortController;
  dom.window.FileTube = {
    registerView: (name, m) => { registered = m; },
    shimmerArt: () => {},
    player: mock.player,
    decodeListContext: opts.decode || (() => null),
    encodeListContext: () => 'CTX',
  };
  dom.window.encodeListContext = () => 'CTX';
  global.fetch = (url, init) => {
    const u = String(url);
    if (/\/api\/music\?/.test(u) || /\/api\/music$/.test(u)) return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: SONGS, total: SONGS.length, offset: 0, limit: 1000 }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
  };
  Object.keys(storage || {}).forEach((k) => dom.window.localStorage.setItem(k, storage[k]));
  try {
    delete require.cache[musicPath];
    require(musicPath);
    assert.ok(registered && typeof registered.init === 'function', 'view registered');
    registered.init(dom.window.document.getElementById('view-root'));
    await settle(); await settle();
    await run(dom, mock);
    registered.destroy();
  } finally {
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
}

const clickRow = async (dom, idx) => {
  dom.window.document.querySelector(`.music-song-row[data-index="${idx}"]`).click();
  await settle(); await settle();
};
const lastLoad = (mock) => mock.s.loadCalls[mock.s.loadCalls.length - 1];

test('v1.104 (fix B): a track change while EXPANDED keeps the player in #player-slot (stays expanded)', async () => {
  await boot({ filetube_music_tab: 'songs' }, 'full', async (dom, mock) => {
    // Player is expanded (full in the slot). Tap a different track.
    await clickRow(dom, 1);
    const call = lastLoad(mock);
    assert.equal(call.id, 't2', 'loaded the tapped track');
    assert.ok(call.opts.slot, 'loaded INTO #player-slot (stays expanded), not docked');
    assert.ok(!call.opts.dock, 'not dock:true');
    assert.equal(mock.s.value, 'full', 'player is still full/expanded after');
  });
});

test('v1.104 (fix B): the same via the NEXT-track handler (setTrackNav.onNext) stays expanded', async () => {
  await boot({ filetube_music_tab: 'songs' }, 'full', async (dom, mock) => {
    await clickRow(dom, 0); // play t1 (registers trackNav with onNext -> t2)
    assert.ok(mock.s.trackNav && typeof mock.s.trackNav.onNext === 'function', 'onNext registered');
    mock.s.trackNav.onNext(); // press "next" from the expanded view
    await settle(); await settle();
    const call = lastLoad(mock);
    assert.equal(call.id, 't2', 'next advanced to t2');
    assert.ok(call.opts.slot && !call.opts.dock, 'next stayed in the expanded slot');
  });
});

test('v1.104: a track tap while DOCKED/closed still DOCKS (browse-while-playing unchanged)', async () => {
  await boot({ filetube_music_tab: 'songs' }, 'closed', async (dom, mock) => {
    await clickRow(dom, 0);
    const call = lastLoad(mock);
    assert.ok(call.opts.dock === true, 'a fresh list tap docks');
    assert.ok(!call.opts.slot, 'not mounted full');
  });
});

const panel = (dom) => dom.window.document.getElementById('music-nowplaying-panel');

test('v1.104 (panel): playing while EXPANDED shows track metadata + up-next queue', async () => {
  await boot({ filetube_music_tab: 'songs' }, 'full', async (dom) => {
    await clickRow(dom, 0); // play t1 while expanded
    const el = panel(dom);
    assert.equal(el.hidden, false, 'panel visible when expanded + playing');
    assert.match(el.innerHTML, /class="mnp-title"[^>]*>Alpha</, 'shows the playing track title');
    assert.match(el.innerHTML, /class="mnp-sub">Boards · One</, 'artist · album');
    // Up next = the queue AFTER t1: t2 (index 1), t3 (index 2).
    assert.match(el.innerHTML, /class="mnp-queue-row" data-index="1"[\s\S]*>Bravo</);
    assert.match(el.innerHTML, /data-index="2"[\s\S]*>Charlie</);
  });
});

test('v1.104 (panel): DOCKED playback keeps the panel HIDDEN (it is the expanded-view surface)', async () => {
  await boot({ filetube_music_tab: 'songs' }, 'closed', async (dom) => {
    await clickRow(dom, 0); // docks
    assert.equal(panel(dom).hidden, true, 'no now-playing panel while docked');
    assert.equal(panel(dom).innerHTML, '', 'panel cleared, not stranded');
  });
});

test('v1.104 (panel): tapping an up-next row jumps to that track', async () => {
  await boot({ filetube_music_tab: 'songs' }, 'full', async (dom, mock) => {
    await clickRow(dom, 0); // play t1, panel lists t2/t3
    dom.window.document.querySelector('.mnp-queue-row[data-index="2"]').click();
    await settle(); await settle();
    assert.equal(lastLoad(mock).id, 't3', 'up-next tap played the tapped track');
  });
});

test('v1.104 (re-init seed): a dock-tap expand re-inits with nowPlaying=null - the panel re-seeds metadata + rebuilds up-next from browseCtx', async () => {
  // Arrive on the ALBUMS grid (no queue) with a music track still playing and the
  // player expanded, exactly like a dock-tap return. getCurrentMeta supplies the
  // metadata; decodeListContext + the songs fetch rebuild up-next.
  const meta = { id: 't2', title: 'Bravo', artist: 'Boards', album: 'One', albumKey: 'k1', browseCtx: 'CTX', isMusic: true };
  await boot(
    { filetube_music_tab: 'albums', filetube_music_sort: JSON.stringify({ albums: 'title-asc' }) },
    'full',
    async (dom) => {
      const el = panel(dom);
      assert.equal(el.hidden, false, 'panel shows despite a fresh (null) nowPlaying');
      assert.match(el.innerHTML, /mnp-title"[^>]*>Bravo</, 're-seeded the playing title from the live player');
      // up-next rebuilt from the album queue (SONGS after t2 -> t3).
      assert.match(el.innerHTML, /class="mnp-queue-row"[\s\S]*>Charlie</, 'up-next rebuilt from browseCtx');
    },
    { meta, decode: (s) => (s === 'CTX' ? { src: 'music', album: 'One', sort: 'album-order' } : null) },
  );
});

test('v1.104 (re-init seed): a NON-music item on the shared host does NOT show the music panel', async () => {
  const meta = { id: 'v9', title: 'A Video', artist: '', album: '', browseCtx: '', isMusic: false };
  await boot({ filetube_music_tab: 'albums' }, 'full', async (dom) => {
    assert.equal(panel(dom).hidden, true, 'a video/book on the host never shows the music now-playing panel');
  }, { meta });
});
