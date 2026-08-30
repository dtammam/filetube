'use strict';

// [UNIT] v1.217 - the in-view back-stack, Music adopter. Dean's device pass:
// the OS/browser back gesture left Music entirely instead of stepping back out
// of a drill. Music now stamps a history level on a drill DESCENT
// (FileTube.pushViewState) and reconciles the drill in its onPopState hook when
// the router hands a within-Music pop back. These boot the REAL music.js init()
// in jsdom with a mock FileTube (capturing pushViewState + the registered
// module) and drive: a descent pushes a drill payload; onPopState collapses to
// browse; onPopState re-opens a drill; the in-app Back button consumes the
// pushed entry via history.back(); destroy() disarms the handler.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <select id="music-sort-select"></select>
  <button id="music-view-toggle" hidden><i></i></button>
  <div id="player-slot"></div>
  <button class="music-nowplaying" id="music-nowplaying" hidden></button>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab" data-tab="home" role="tab">Home</button>
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
    <button type="button" class="music-tab" data-tab="artists" role="tab">Artists</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((resolve) => setImmediate(resolve));

const ALBUMS = [{ albumKey: 'Floyd␟Wall', album: 'The Wall', artist: 'Pink Floyd', artId: 'x', trackCount: 4 }];
const SONGS = [{ id: 't1', title: 'In the Flesh', artist: 'Pink Floyd', album: 'The Wall', albumKey: 'Floyd␟Wall', durationSec: 200 }];

function fetchMap(url) {
  const u = String(url);
  if (u.indexOf('/api/music/albums') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: ALBUMS }) });
  if (u.indexOf('/api/music/artists') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  if (u.indexOf('/api/music?') === 0 || u.indexOf('/api/music&') === 0 || u.indexOf('album=') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: SONGS }) });
  return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
}

// Boot the REAL init() with a mock FileTube; returns the jsdom, the registered
// module (init/destroy/onPopState), and the captured pushViewState payloads.
async function boot(run, opts) {
  opts = opts || {};
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.AbortController = dom.window.AbortController;
  global.fetch = fetchMap;
  const pushes = [];
  const backs = [];
  let mod = null;
  const realBack = dom.window.history.back.bind(dom.window.history);
  dom.window.history.back = () => { backs.push(1); realBack(); };
  dom.window.FileTube = {
    registerView: (name, m) => { mod = m; },
    pushViewState: (vs) => {
      pushes.push(vs);
      // Emulate the real router: a push adds a history entry carrying viewState.
      dom.window.history.pushState({ view: 'music', url: '/music', scrollY: 0, depth: pushes.length, viewState: vs }, '', '/music');
    },
    replaceViewState: () => {},
    player: { currentId: null, getState: () => 'closed', expand: () => {} },
    shimmerArt: () => {},
  };
  try { dom.window.localStorage.setItem('filetube_music_tab', opts.tab || 'albums'); } catch (_) { /* ignore */ }
  try {
    delete require.cache[musicPath];
    require(musicPath);
    assert.ok(mod && typeof mod.init === 'function', 'view registered');
    mod.init(dom.window.document.getElementById('view-root'));
    for (let i = 0; i < 8; i++) await settle();
    await run(dom, { mod, pushes, backs });
    mod.destroy();
  } finally {
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
}

const content = (dom) => dom.window.document.getElementById('music-content');

test('v1.217: descending into an album drill PUSHES a {t:drill} history level', async () => {
  await boot(async (dom, ctx) => {
    const card = content(dom).querySelector('.music-album-card');
    assert.ok(card, 'an album card rendered to drill from');
    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.match(content(dom).innerHTML, /music-drill/, 'the drill opened');
    assert.strictEqual(ctx.pushes.length, 1, 'exactly one history level pushed on the descent');
    assert.strictEqual(ctx.pushes[0].t, 'drill', 'the pushed payload marks a drill');
    assert.strictEqual(ctx.pushes[0].drill.key, 'Floyd␟Wall', 'and carries the drill descriptor');
  });
});

test('v1.217: onPopState with a browse-root entry COLLAPSES the drill in place (and returns true)', async () => {
  await boot(async (dom, ctx) => {
    content(dom).querySelector('.music-album-card').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.match(content(dom).innerHTML, /music-drill/, 'in a drill');
    // The router hands back the pre-drill (browse-root) entry: viewState null.
    const handled = ctx.mod.onPopState({ view: 'music', viewState: null });
    for (let i = 0; i < 8; i++) await settle();
    assert.strictEqual(handled, true, 'Music handled the within-view pop');
    assert.doesNotMatch(content(dom).innerHTML, /music-drill/, 'the drill collapsed back to the browse grid');
    assert.ok(content(dom).querySelector('.music-album-card'), 'the album grid is back');
  });
});

test('v1.217: onPopState with a {t:drill} entry RE-OPENS that drill (forward re-pop)', async () => {
  await boot(async (dom, ctx) => {
    // Start at browse, then a forward pop into a drill state re-opens it.
    const handled = ctx.mod.onPopState({ view: 'music', viewState: { t: 'drill', drill: { type: 'album', key: 'Floyd␟Wall', label: 'The Wall' } } });
    for (let i = 0; i < 8; i++) await settle();
    assert.strictEqual(handled, true);
    assert.match(content(dom).innerHTML, /music-drill/, 're-popping into a drill payload re-opens the drill');
  });
});

test('v1.217: the in-app Back button CONSUMES the pushed history entry via history.back() (keeps OS-back in sync)', async () => {
  await boot(async (dom, ctx) => {
    content(dom).querySelector('.music-album-card').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.strictEqual(dom.window.history.state.viewState.t, 'drill', 'the top entry is the drill push');
    const back = content(dom).querySelector('.music-drill-back');
    assert.ok(back, 'the drill has a Back button');
    back.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.strictEqual(ctx.backs.length, 1, 'the Back button went through history.back(), not a bare in-place collapse');
  });
});

test('v1.217: destroy() disarms onPopState (a stray pop after teardown is a no-op, returns false)', async () => {
  let captured = null;
  await boot(async (dom, ctx) => { captured = ctx.mod; });
  // boot() already called destroy() in its finally; the module handle survives.
  assert.strictEqual(captured.onPopState({ view: 'music', viewState: null }), false, 'no live handler after destroy -> false (router falls through)');
});
