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

function makePlayer(initialState) {
  const s = { value: initialState || 'closed', loadCalls: [], expandCalls: [], trackNav: null };
  const player = {
    currentId: null,
    getState: () => s.value,
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

async function boot(storage, initialState, run) {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const saved = {
    window: global.window, document: global.document,
    localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController,
  };
  const mock = makePlayer(initialState);
  let registered = null;
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.AbortController = dom.window.AbortController;
  dom.window.FileTube = { registerView: (name, m) => { registered = m; }, shimmerArt: () => {}, player: mock.player };
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
