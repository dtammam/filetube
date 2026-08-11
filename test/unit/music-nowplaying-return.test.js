'use strict';

// [UNIT] v1.103 - the dock-return determinism fix. Dean's bug: "tapping the mini
// player doesn't always bring the player back." Root cause: `?nowplaying=1` is a
// transient expand TRIGGER, but it USED to persist in the URL. After the first
// dock-tap navigated to `/music?nowplaying=1`, a later re-tap navigated to the
// SAME url the bar already showed, and the router's same-URL no-op (navigate,
// tech-debt #46) swallowed it - stranding the docked player with an empty slot.
//
// Fix: init() STRIPS ?nowplaying after consuming it (stripNowPlayingParam), so the
// bar never durably holds the marker and every dock-tap is a real transition.
// These bind the fix behaviourally: the marker is gone after init, AND the router
// guard therefore treats the next dock-tap as a real nav (not a no-op). Delete the
// strip and assertion #2/#3 go red.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
// isSameLocationNav is the router guard the bug hinges on - grab it with `window`
// still undefined (common.js's boot is window-gated), then supply the global.
const { isSameLocationNav } = require('../../public/js/common.js');

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div id="player-slot"></div>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
    <button type="button" class="music-tab" data-tab="artists" role="tab">Artists</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Boot the REAL init() with a mock persistent player in `playerState`.
async function bootWith(url, playerState, run) {
  const dom = new JSDOM(VIEW_HTML, { url });
  const saved = {
    window: global.window, document: global.document,
    localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController,
  };
  let registered = null;
  const expandCalls = [];
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.AbortController = dom.window.AbortController;
  dom.window.FileTube = {
    registerView: (name, mod) => { registered = mod; },
    player: {
      currentId: playerState.currentId || null,
      getState: () => playerState.state,
      expand: (slot) => { expandCalls.push(slot); playerState.state = 'full'; },
    },
    shimmerArt: () => {},
  };
  global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
  try {
    delete require.cache[musicPath];
    require(musicPath);
    assert.ok(registered && typeof registered.init === 'function', 'view registered');
    registered.init(dom.window.document.getElementById('view-root'));
    await settle(); await settle();
    await run(dom, expandCalls);
    registered.destroy();
  } finally {
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
}

test('v1.103: arriving at /music?nowplaying=1 with a docked player EXPANDS it', async () => {
  await bootWith('http://localhost/music?nowplaying=1', { state: 'docked', currentId: 't1' }, async (dom, expandCalls) => {
    assert.equal(expandCalls.length, 1, 'the docked player expanded into #player-slot');
  });
});

test('v1.103 (THE FIX): init strips ?nowplaying so the marker never persists in the bar', async () => {
  await bootWith('http://localhost/music?nowplaying=1', { state: 'docked', currentId: 't1' }, async (dom) => {
    assert.equal(dom.window.location.search, '', 'nowplaying stripped -> bar is /music, truthfully DOCKED-not-expanded');
    assert.equal(dom.window.location.pathname, '/music', 'path preserved');
  });
});

test('v1.103 (THE FIX): stripping preserves any OTHER query params', async () => {
  await bootWith('http://localhost/music?tab=artists&nowplaying=1', { state: 'docked', currentId: 't1' }, async (dom) => {
    const params = new dom.window.URLSearchParams(dom.window.location.search);
    assert.equal(params.get('nowplaying'), null, 'only nowplaying removed');
    assert.equal(params.get('tab'), 'artists', 'sibling params kept');
  });
});

test('v1.103 (the strand, at the router guard): after the strip a dock re-tap is a REAL nav, not a no-op', () => {
  // The dock readerHref is /music?nowplaying=1. With the fix, the bar is /music
  // after each expand, so the guard sees a genuine transition and re-inits+expands.
  assert.equal(isSameLocationNav('/music', '/music?nowplaying=1'), false, 'FIXED: real transition -> expand fires');
  // The bug (no strip): the bar still held the target, so the guard no-op'd it.
  assert.equal(isSameLocationNav('/music?nowplaying=1', '/music?nowplaying=1'), true, 'BUG: same URL -> swallowed -> strand');
});

test('v1.103: the dock-return href music sets is /music?nowplaying=1 (the trigger the strip consumes)', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(musicPath, 'utf8');
  assert.match(src, /readerHref: '\/music\?nowplaying=1'/, 'loadTrack sets the expand-trigger href');
  assert.match(src, /function stripNowPlayingParam/, 'and init strips it after consuming');
});
