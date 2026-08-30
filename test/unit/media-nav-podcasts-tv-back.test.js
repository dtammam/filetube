'use strict';

// [UNIT] v1.218 - the in-view back-stack adopted by Podcasts and TV (the
// media-nav arc, after Music v1.217). Each has ONE in-view drill level
// (browse -> a show); opening a show now stamps a history level via
// FileTube.pushViewState and reconciles in onPopState, so OS/browser back steps
// back to the grid instead of leaving the section. Books already follows the
// pattern (opening a book NAVIGATES to the reader), so it needs no adoption.
// These boot the REAL views in jsdom with a mock FileTube (capturing
// pushViewState + the registered module) and drive: a show descent pushes; a
// browse-root pop collapses to the grid; a show pop re-opens; the in-app Back
// button consumes the pushed entry via history.back().

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Generic boot: sets globals, mocks FileTube (capturing the module + pushes +
// history.back calls), installs a fetch map, requires the view fresh, inits it.
async function bootView({ modulePath, html, url, fetchMap, initArg }, run) {
  const dom = new JSDOM(html, { url });
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
      dom.window.history.pushState({ view: name(url), url: '/x', scrollY: 0, depth: pushes.length, viewState: vs }, '', '/x');
    },
    replaceViewState: () => {},
    navigate: () => {},
    player: { currentId: null, getState: () => 'closed', expand: () => {}, load: () => {}, setTrackNav: () => {} },
    shimmerArt: () => {},
  };
  function name(u) { return u.indexOf('/podcasts') !== -1 ? 'podcasts' : 'tv'; }
  const resolved = require.resolve(modulePath);
  try {
    delete require.cache[resolved];
    require(resolved);
    assert.ok(mod && typeof mod.init === 'function', 'view registered with init');
    assert.strictEqual(typeof mod.onPopState, 'function', 'view registered an onPopState hook');
    mod.init(initArg === undefined ? dom.window.document.getElementById('view-root') : initArg);
    for (let i = 0; i < 8; i++) await settle();
    await run(dom, { mod, pushes, backs });
    mod.destroy();
  } finally {
    delete require.cache[resolved];
    Object.assign(global, saved);
  }
}

// ---- Podcasts --------------------------------------------------------------

const PODCASTS_HTML = `<body><div id="view-root" data-view="podcasts">
  <div id="podcasts-crumb" hidden></div>
  <div id="podcasts-status" role="status" hidden></div>
  <div id="podcasts-content"></div>
  <div id="podcasts-empty" hidden></div>
  <div id="player-slot"></div>
  <div id="podcast-nowplaying-panel" class="music-nowplaying-panel" hidden></div>
</div></body>`;

function podcastsFetch(url) {
  const u = String(url);
  if (u.indexOf('/api/podcasts/shows/') !== -1 && u.indexOf('/episodes') !== -1) {
    return Promise.resolve({ ok: true, json: async () => ({ show: { id: 'sh1', name: 'Show One' }, episodes: [] }) });
  }
  if (u.indexOf('/api/podcasts/shows') !== -1) {
    return Promise.resolve({ ok: true, json: async () => ({ shows: [{ id: 'sh1', name: 'Show One' }] }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

const bootPodcasts = (run) => bootView({ modulePath: '../../public/js/podcasts.js', html: PODCASTS_HTML, url: 'http://localhost/podcasts', fetchMap: podcastsFetch }, run);
const pcContent = (dom) => dom.window.document.getElementById('podcasts-content');

test('v1.218 podcasts: opening a show from the grid PUSHES a {t:show} history level', async () => {
  await bootPodcasts(async (dom, ctx) => {
    const card = pcContent(dom).querySelector('.podcast-card');
    assert.ok(card, 'a show card rendered');
    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.strictEqual(ctx.pushes.length, 1, 'exactly one level pushed on the descent');
    assert.strictEqual(ctx.pushes[0].t, 'show');
    assert.strictEqual(ctx.pushes[0].id, 'sh1');
  });
});

test('v1.218 podcasts: onPopState(browse-root) COLLAPSES to the grid; onPopState(show) RE-OPENS', async () => {
  await bootPodcasts(async (dom, ctx) => {
    pcContent(dom).querySelector('.podcast-card').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.ok(!pcContent(dom).querySelector('.podcast-card'), 'in the show view (grid gone)');
    assert.strictEqual(ctx.mod.onPopState({ view: 'podcasts', viewState: null }), true, 'handled the within-view pop');
    for (let i = 0; i < 8; i++) await settle();
    assert.ok(pcContent(dom).querySelector('.podcast-card'), 'collapsed back to the shows grid');
    // Forward re-pop into the show payload re-opens it.
    assert.strictEqual(ctx.mod.onPopState({ view: 'podcasts', viewState: { t: 'show', id: 'sh1', name: 'Show One' } }), true);
    for (let i = 0; i < 8; i++) await settle();
    assert.ok(!pcContent(dom).querySelector('.podcast-card'), 're-popping the show payload re-opens the show');
  });
});

test('v1.218 podcasts: the in-app Back button CONSUMES the pushed entry via history.back()', async () => {
  await bootPodcasts(async (dom, ctx) => {
    pcContent(dom).querySelector('.podcast-card').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.strictEqual(dom.window.history.state.viewState.t, 'show', 'the top entry is the show push');
    const back = dom.window.document.querySelector('#podcasts-crumb button');
    assert.ok(back, 'the show view has a back button');
    back.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.strictEqual(ctx.backs.length, 1, 'Back went through history.back(), not a bare collapse');
  });
});

test('v1.218 podcasts: destroy() disarms onPopState (returns false after teardown)', async () => {
  let captured = null;
  await bootPodcasts(async (dom, ctx) => { captured = ctx.mod; });
  assert.strictEqual(captured.onPopState({ view: 'podcasts', viewState: null }), false, 'no live handler after destroy -> router falls through');
});

// ---- TV --------------------------------------------------------------------

const TV_HTML = `<body><div id="view-root" data-view="tv">
  <div id="tv-status" role="status" hidden></div>
  <div id="tv-crumb" hidden></div>
  <div id="tv-heading"></div>
  <div id="tv-empty" hidden></div>
  <div id="tv-content"></div>
  <button id="tv-scan-btn" type="button">Scan</button>
</div></body>`;

function tvFetch(url) {
  const u = String(url);
  if (/\/api\/tv\/[^/]+$/.test(u)) {
    return Promise.resolve({ ok: true, json: async () => ({ id: 'sh1', name: 'Show One', seasons: [] }) });
  }
  if (u.indexOf('/api/tv') !== -1) {
    return Promise.resolve({ ok: true, json: async () => ({ shows: [{ id: 'sh1', name: 'Show One', seasonCount: 1, episodeCount: 1 }], cont: [] }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

const bootTv = (run) => bootView({ modulePath: '../../public/js/tv.js', html: TV_HTML, url: 'http://localhost/tv', fetchMap: tvFetch, initArg: null }, run);
const tvContent = (dom) => dom.window.document.getElementById('tv-content');

test('v1.218 tv: opening a show from the grid PUSHES a {t:show} history level', async () => {
  await bootTv(async (dom, ctx) => {
    const card = tvContent(dom).querySelector('.show-card');
    assert.ok(card, 'a show card rendered');
    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.strictEqual(ctx.pushes.length, 1, 'exactly one level pushed on the descent');
    assert.strictEqual(ctx.pushes[0].t, 'show');
    assert.strictEqual(ctx.pushes[0].id, 'sh1');
  });
});

test('v1.218 tv: onPopState(browse-root) COLLAPSES to the grid; onPopState(show) RE-OPENS', async () => {
  await bootTv(async (dom, ctx) => {
    tvContent(dom).querySelector('.show-card').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.ok(!tvContent(dom).querySelector('.show-card'), 'in the show detail (grid gone)');
    assert.strictEqual(ctx.mod.onPopState({ view: 'tv', viewState: null }), true, 'handled the within-view pop');
    for (let i = 0; i < 8; i++) await settle();
    assert.ok(tvContent(dom).querySelector('.show-card'), 'collapsed back to the shows grid');
    assert.strictEqual(ctx.mod.onPopState({ view: 'tv', viewState: { t: 'show', id: 'sh1' } }), true);
    for (let i = 0; i < 8; i++) await settle();
    assert.ok(!tvContent(dom).querySelector('.show-card'), 're-popping the show payload re-opens the show');
  });
});

test('v1.218 tv: the #tv-back button CONSUMES the pushed entry via history.back()', async () => {
  await bootTv(async (dom, ctx) => {
    tvContent(dom).querySelector('.show-card').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.strictEqual(dom.window.history.state.viewState.t, 'show', 'the top entry is the show push');
    const back = dom.window.document.getElementById('tv-back');
    assert.ok(back, 'the show detail has #tv-back');
    back.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
    assert.strictEqual(ctx.backs.length, 1, '#tv-back went through history.back()');
  });
});
