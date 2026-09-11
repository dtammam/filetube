'use strict';

// [UNIT] v1.282 (Dean, #222): the BEHAVIOURAL half of the dock-return fix (the gate's
// shared finding: the dispatch branch in listen-video-chapters.test.js is source-locked +
// mutant-verified, but nothing EXECUTED a real ?nowplaying=1 re-init to prove the branch is
// reached and comes back with the multi-chapter queue intact - the reachability/clobber class
// this repo has repeatedly paid for). This drives the REAL init() twice against ONE required
// module instance (so the module-scoped stash `activeListenChapters` survives the dock-tap
// re-init, exactly as production does) and asserts, through the player's setTrackNav contract,
// that the chaptered-listen queue is genuinely restored rather than collapsed into an empty
// album. loadTrack only touches pl.load / pl.getState / player.currentId, so the mock is tiny.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div id="player-slot"></div>
  <div id="music-nowplaying-panel" hidden></div>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
    <button type="button" class="music-tab" data-tab="artists" role="tab">Artists</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

// a chaptered VIDEO (mp4) resolved by /api/videos/X - 3 chapters -> 3 `::c` tracks.
const CHAPTERED_VIDEO = {
  id: 'vidX', title: 'A Long Talk', duration: 300, channelName: 'The Channel',
  chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 120, title: 'Middle' }, { startTime: 240, title: 'End' }],
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('dock-return REALLY restores the chaptered-listen queue (one required module, two init()s)', async () => {
  const saved = {
    window: global.window, document: global.document,
    localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController,
  };
  // ONE shared player across both boots - loadTrack sets currentId via load(); the dock-return
  // reads it back. setTrackNav records the LAST nav registration (the behavioural probe).
  let lastNav = 'never-called';
  const player = {
    currentId: null,
    state: 'full',
    load(id) { this.currentId = id; },
    getState() { return this.state; },
    expand() { this.state = 'full'; },
    setTrackNav(nav) { lastNav = nav; },
  };
  let registered = null;
  // window.FileTube is read at module-load (registerView) and again at call time (player); the
  // no-op view-state hooks keep the drill/back-stack machinery from throwing.
  function makeFileTube() {
    return {
      registerView: (name, mod) => { registered = mod; },
      player,
      shimmerArt: () => {},
      pushViewState: () => {}, replaceViewState: () => {}, navigate: () => {},
    };
  }
  function installDom(url) {
    const dom = new JSDOM(VIEW_HTML, { url });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    global.AbortController = dom.window.AbortController;
    global.fetch = (u) => {
      const s = String(u);
      if (s.indexOf('/api/videos/') === 0) return Promise.resolve({ ok: true, json: () => Promise.resolve(CHAPTERED_VIDEO) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
    };
    dom.window.FileTube = makeFileTube();
    return dom;
  }

  try {
    // --- BOOT 1: play the chaptered video as Listen; playListenItem expands + stashes ------
    delete require.cache[musicPath];
    const dom1 = installDom('http://localhost/music?play=vidX&listen=1');
    require(musicPath); // registers the view ONCE against dom1's FileTube
    assert.ok(registered && typeof registered.init === 'function', 'view registered');
    registered.init(dom1.window.document.getElementById('view-root'));
    await settle(); await settle(); await settle();
    assert.match(String(player.currentId), /::c\d+$/, 'boot 1 loaded a ::c chapter (the expansion ran)');
    registered.destroy();

    // --- simulate a mid-album advance before docking: the live chapter is now ::c1 ---------
    player.currentId = 'vidX::c1';

    // --- BOOT 2: the dock-return. New document/URL, SAME module instance (cache NOT cleared),
    //     so the module-scoped stash survives - exactly the production dock-tap re-init. -----
    lastNav = 'never-called';
    const dom2 = installDom('http://localhost/music?nowplaying=1');
    registered.init(dom2.window.document.getElementById('view-root'));
    await settle(); await settle(); await settle();

    // THE PROOF: a mid-album chapter (index 1 of 3) restores neighbors on BOTH sides. The old
    // bug drilled into an EMPTY album (fetch -> {items:[]}) and would register i=-1 -> both
    // undefined. onNext defined = the 3-track chapter queue genuinely came back.
    assert.notStrictEqual(lastNav, 'never-called', 'the dock-return registered track nav');
    assert.strictEqual(typeof lastNav.onNext, 'function', 'onNext is bound -> a later chapter exists (queue not collapsed)');
    assert.strictEqual(typeof lastNav.onPrev, 'function', 'onPrev is bound -> an earlier chapter exists (mid-album restore)');
    assert.strictEqual(player.currentId, 'vidX::c1', 'restore is view-only - it never reloaded/reset the live chapter');

    registered.destroy();
  } finally {
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
});

test('a NON-chaptered listen video does NOT arm the dock-return restore (stash stays null)', async () => {
  const saved = {
    window: global.window, document: global.document,
    localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController,
  };
  let lastNav = 'never-called';
  const player = { currentId: null, state: 'full', load(id) { this.currentId = id; }, getState() { return this.state; }, expand() {}, setTrackNav(nav) { lastNav = nav; } };
  let registered = null;
  const SINGLE = { id: 'vidY', title: 'Short', duration: 60, channelName: 'Ch' }; // no chapters
  function installDom(url) {
    const dom = new JSDOM(VIEW_HTML, { url });
    global.window = dom.window; global.document = dom.window.document;
    global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
    global.fetch = (u) => (String(u).indexOf('/api/videos/') === 0
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(SINGLE) })
      : Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) }));
    dom.window.FileTube = { registerView: (n, m) => { registered = m; }, player, shimmerArt: () => {}, pushViewState: () => {}, replaceViewState: () => {}, navigate: () => {} };
    return dom;
  }
  try {
    delete require.cache[musicPath];
    const d1 = installDom('http://localhost/music?play=vidY&listen=1');
    require(musicPath);
    registered.init(d1.window.document.getElementById('view-root'));
    await settle(); await settle(); await settle();
    assert.strictEqual(player.currentId, 'vidY', 'a 0-chapter listen video plays as the single base track (no ::c)');
    registered.destroy();

    // dock-return: currentId is the base id, NOT a ::c -> isListenChapterActive() is false ->
    // the branch is skipped and the ordinary now-playing path runs (no bogus chapter restore).
    lastNav = 'never-called';
    const d2 = installDom('http://localhost/music?nowplaying=1');
    registered.init(d2.window.document.getElementById('view-root'));
    await settle(); await settle(); await settle();
    // no `::c` live id -> the restore branch cannot claim it; nav is never bound to a phantom queue.
    if (lastNav !== 'never-called') {
      assert.strictEqual(typeof lastNav.onNext, 'undefined', 'a single listen track has no next chapter to bind');
    }
    registered.destroy();
  } finally {
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
});
