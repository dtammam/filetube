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
  <video id="media-player"></video>
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
    requestAnimationFrame: global.requestAnimationFrame,
  };
  const mock = makePlayer(initialState, opts.meta);
  let registered = null;
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.AbortController = dom.window.AbortController;
  // v1.106: a fresh select scrolls the expanded player into view - record it.
  mock.scrollCalls = [];
  dom.window.scrollTo = function () { mock.scrollCalls.push(Array.prototype.slice.call(arguments)); };
  // The `emptied` listener defers via requestAnimationFrame; jsdom provides one.
  global.requestAnimationFrame = dom.window.requestAnimationFrame
    ? dom.window.requestAnimationFrame.bind(dom.window)
    : (cb) => setTimeout(cb, 0);
  dom.window.FileTube = {
    registerView: (name, m) => { registered = m; },
    shimmerArt: () => {},
    player: mock.player,
    decodeListContext: opts.decode || (() => null),
    encodeListContext: () => 'CTX',
  };
  dom.window.encodeListContext = () => 'CTX';
  const fetches = [];
  mock.fetches = fetches;
  global.fetch = (url, init) => {
    const u = String(url);
    fetches.push(u);
    const songs = opts.songs || SONGS;
    if (/\/api\/music\?/.test(u) || /\/api\/music$/.test(u)) return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: songs, total: songs.length, offset: 0, limit: 1000 }) });
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
const clickTab = async (dom, name) => {
  dom.window.document.querySelector(`.music-tab[data-tab="${name}"]`).click();
  await settle(); await settle();
};
const lastLoad = (mock) => mock.s.loadCalls[mock.s.loadCalls.length - 1];

test('v1.106: a fresh SELECT while EXPANDED mounts full into #player-slot (stays expanded)', async () => {
  // v1.106: a select always mounts full; the keep-position-on-NAV behaviour is
  // bound separately below (the onNext test + "NAV while DOCKED keeps it docked").
  await boot({ filetube_music_tab: 'songs' }, 'full', async (dom, mock) => {
    await clickRow(dom, 1); // select a different track while expanded
    const call = lastLoad(mock);
    assert.equal(call.id, 't2', 'loaded the tapped track');
    assert.ok(call.opts.slot, 'mounted into #player-slot (expanded), not docked');
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

test('v1.106: a fresh track tap EXPANDS (selecting opens the now-playing view) + scrolls it into view', async () => {
  await boot({ filetube_music_tab: 'songs' }, 'closed', async (dom, mock) => {
    await clickRow(dom, 0);
    const call = lastLoad(mock);
    assert.ok(call.opts.slot, 'a fresh select mounts FULL into #player-slot (was dock pre-v1.106)');
    assert.ok(!call.opts.dock, 'not docked');
    assert.equal(mock.s.value, 'full', 'player is expanded after a select');
    assert.ok(mock.scrollCalls.some((a) => a[0] === 0 && a[1] === 0), 'scrolled the expanded player into view');
  });
});

test('v1.106: a NAV step (next/prev) while DOCKED keeps it docked (does NOT force-expand)', async () => {
  await boot({ filetube_music_tab: 'songs' }, 'full', async (dom, mock) => {
    await clickRow(dom, 0); // select -> expands, registers trackNav for index 0
    mock.setState('docked'); // player later docked (e.g. browsed away and back)
    mock.scrollCalls.length = 0;
    mock.s.trackNav.onNext(); // next = a NAV, keepPosition
    await settle(); await settle();
    const call = lastLoad(mock);
    assert.ok(call.opts.dock === true && !call.opts.slot, 'nav kept the docked position');
    assert.equal(mock.scrollCalls.length, 0, 'a nav does not scroll');
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
    // v1.223: the panel lists the WHOLE queue. Playing t1 (first): t1 is the current
    // row (marked), t2 (index 1) + t3 (index 2) are up next (plain rows).
    assert.match(el.innerHTML, /class="mnp-queue-row is-current" aria-current="true" data-index="0"[\s\S]*>Alpha</, 'the current track is in the list, marked');
    assert.match(el.innerHTML, /class="mnp-queue-row" data-index="1"[\s\S]*>Bravo</, 't2 up next (plain)');
    assert.match(el.innerHTML, /class="mnp-queue-row" data-index="2"[\s\S]*>Charlie</, 't3 up next (plain)');
  });
});

test('v1.223 (Dean): the panel shows the WHOLE queue - already-played tracks grey out (is-played) but stay clickable', async () => {
  await boot({ filetube_music_tab: 'songs' }, 'full', async (dom, mock) => {
    await clickRow(dom, 1); // play t2 (the MIDDLE track) -> t1 is now behind us
    const el = panel(dom);
    // t1 (index 0) is BEHIND the current -> greyed, but still a clickable row.
    assert.match(el.innerHTML, /class="mnp-queue-row is-played" data-index="0"[\s\S]*>Alpha</, 'the played track stays in the list, greyed');
    assert.match(el.innerHTML, /class="mnp-queue-row is-current" aria-current="true" data-index="1"[\s\S]*>Bravo</, 't2 is the current row');
    assert.match(el.innerHTML, /class="mnp-queue-row" data-index="2"[\s\S]*>Charlie</, 't3 still up next');
    // the played row is clickable -> jumps back to it (loads t1)
    dom.window.document.querySelector('.mnp-queue-row[data-index="0"]').click();
    await settle(); await settle();
    assert.strictEqual(lastLoad(mock).id, 't1', 'tapping a played (greyed) row jumps back to it');
  });
});

test('v1.223 (gate WARNING fix): a DEEP current index still shows the current + up-next, not a cap full of only played rows', async () => {
  // The Songs tab loads up to 1000. If the 200-row cap were anchored at the queue
  // START, a current index past ~200 would fill the panel with only played rows
  // (no current, no up-next). The window is anchored near the current instead.
  const many = [];
  for (let i = 0; i < 300; i++) many.push({ id: 'm' + i, title: 'Song ' + i, artist: 'Boards', album: '', albumKey: '', durationSec: 100 });
  await boot({ filetube_music_tab: 'songs' }, 'full', async (dom) => {
    await clickRow(dom, 250); // play a deep track (album-less -> flat queue, ci=250)
    const el = panel(dom);
    assert.match(el.innerHTML, /class="mnp-queue-row is-current" aria-current="true" data-index="250"/, 'the current row is present at depth 250');
    assert.match(el.innerHTML, /class="mnp-queue-row" data-index="251"/, 'up-next rows follow the current (not silently dropped)');
    assert.doesNotMatch(el.innerHTML, /data-index="0"/, 'the window is anchored near the current track, not the queue start');
  }, { songs: many });
});

test('v1.104/v1.106 (panel): DOCKED playback keeps the panel HIDDEN (reached via a nav while docked)', async () => {
  await boot({ filetube_music_tab: 'songs' }, 'full', async (dom, mock) => {
    await clickRow(dom, 0); // select -> expands (panel shown)
    assert.equal(panel(dom).hidden, false, 'panel populated first (non-vacuous)');
    assert.ok(panel(dom).innerHTML.length > 0, 'has content to strand');
    mock.setState('docked'); // browsed away -> docked
    mock.s.trackNav.onNext(); // nav keeps it docked
    await settle(); await settle();
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

test('v1.104 (reveal-once CLEAR, gate WARNING): a panel that WAS shown clears when the player docks', async () => {
  // Non-vacuous: populate the panel first, THEN drive the docked axis - so the
  // clear branch is exercised (removing it strands the previous track's metadata).
  await boot({ filetube_music_tab: 'songs' }, 'full', async (dom, mock) => {
    await clickRow(dom, 0);
    assert.equal(panel(dom).hidden, false, 'panel populated first');
    assert.ok(panel(dom).innerHTML.length > 0, 'has content to strand');
    mock.setState('docked'); // the player docked out from under the expanded view
    await clickTab(dom, 'songs'); // any re-render re-runs updateNowPlayingPanel
    assert.equal(panel(dom).hidden, true, 'panel HIDDEN once docked');
    assert.equal(panel(dom).innerHTML, '', 'and CLEARED - no stranded stale metadata');
  });
});

test('v1.104 (gate CRITICAL): a Songs-tab dock-return does NOT double-fetch /api/music (render owns the queue; rebuild bails)', async () => {
  // The dead `if(queue.length)` guard let rebuildPlayingQueue race render()'s
  // loadSongs on the Songs tab, desyncing row data-index from queue -> wrong
  // track. The fix bails rebuild on Songs/drill. Bind it: exactly ONE song fetch.
  const meta = { id: 't2', title: 'Bravo', artist: 'Boards', album: 'One', albumKey: 'k1', browseCtx: 'CTX', isMusic: true };
  await boot({ filetube_music_tab: 'songs' }, 'full', async (dom, mock) => {
    const songFetches = mock.fetches.filter((u) => /\/api\/music(\?|$)/.test(u));
    assert.equal(songFetches.length, 1, 'render() issued the ONE song load; rebuild did not race a second');
  }, { meta, decode: (s) => (s === 'CTX' ? { src: 'music', album: 'One', sort: 'album-order' } : null) });
});

test('v1.104 (reveal-once CLEAR): closing the player (emptied) clears a shown panel', async () => {
  await boot({ filetube_music_tab: 'songs' }, 'full', async (dom, mock) => {
    await clickRow(dom, 0);
    assert.equal(panel(dom).hidden, false, 'panel shown');
    // Simulate a close: currentId gone, the shared #media-player fires `emptied`.
    mock.player.currentId = null;
    dom.window.document.getElementById('media-player').dispatchEvent(new dom.window.Event('emptied'));
    await new Promise((r) => setTimeout(r, 30)); // let the rAF-deferred handler run
    assert.equal(panel(dom).hidden, true, 'panel hidden after the player closed');
    assert.equal(panel(dom).innerHTML, '', 'cleared, not stranded');
  });
});

// v1.224 (Dean) SOURCE-LOCK: the up-next now includes played history above the
// current row, so the panel scrolls the (bounded) list to the PLAYING song when
// it renders - jsdom has no layout to measure, so lock the glue behaviourally-
// adjacent: it targets the is-current row and scrolls the queue box (scrollTop),
// never the page.
test('v1.224: updateNowPlayingPanel scrolls the queue to the current row (not the page)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../public/js/music.js'), 'utf8');
  assert.match(src, /nowPlayingPanel\.querySelector\('\.mnp-queue-row\.is-current'\)/, 'it targets the current row');
  assert.match(src, /mnpQueue\.scrollTop = Math\.max\(0, \(curRow\.offsetTop - mnpQueue\.offsetTop\) - 8\)/, 'it scrolls the queue box by scrollTop, not scrollIntoView/window');
});
