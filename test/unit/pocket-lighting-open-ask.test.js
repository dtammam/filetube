'use strict';

// [UNIT] v1.334 (Dean 2026-09-25: "if I open up the music player on mobile and I press the sticker, it pops
// me for the motion prompt. Is it possible to just have it pop for that prompt on opening up the media
// player in that skin in general without requiring the sticker button?"). Plan
// 2026-09-25-pocket-open-ask-sticker-light, item 1.
//
// The first-tap ask arms only once the Click panel is PAINTED - after the async open - so the opening tap
// never asked (measured before the fix: 0 asks in the opening tap, 1 on the next tap, the sticker). The
// fix asks from inside the opening tap at the seams every open passes through synchronously: the router's
// navigate() into the player and the views' play seams. Driven here through the REAL modules and the
// REAL event shapes: music.js + podcasts.js views, the engine, the driver, and common.js's live router.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const lightPath = require.resolve('../../public/js/pocket-lighting.js');
const musicPath = require.resolve('../../public/js/music.js');
const podcastsPath = require.resolve('../../public/js/podcasts.js');
const { isPlayerOpenUrl } = require('../../public/js/common.js');

const settle = () => new Promise((r) => setImmediate(r));
async function settleAll(n = 20) { for (let i = 0; i < n; i++) await settle(); await new Promise((r) => setTimeout(r, 5)); }

// An iPhone-shaped window: a phone-width viewport (the skins' breakpoint), a coarse pointer, the iOS
// permission API (counted, answered by the test), reduced motion as asked.
function phoneWindow(W, { mobile = true, fine = false, reduced = false, api = true } = {}) {
  W.matchMedia = (q) => ({ matches: (/max-width:\s*768px/.test(q) && mobile) || (/pointer:\s*fine/.test(q) && fine) || (/reduced-motion/.test(q) && reduced), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  W.scrollTo = () => {};
  W.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  const asks = { n: 0, answer: null, reject: null };
  if (api) {
    W.DeviceOrientationEvent = function () {};
    W.DeviceOrientationEvent.requestPermission = () => { asks.n += 1; return new Promise((res, rej) => { asks.answer = res; asks.reject = rej; }); };
  }
  return asks;
}
function loadModules(W, { skin = 'ipod', strength = 'pronounced' } = {}) {
  W.localStorage.setItem('ft-music-skin', skin);
  if (strength) W.localStorage.setItem('ft-pocket-lighting', strength);
  delete require.cache[skinsPath]; delete require.cache[surfacePath]; delete require.cache[lightPath];
  global.module = undefined;
  W.FileTubeMusicSkins = require(skinsPath);
  W.FileTubePocketLighting = require(lightPath);
  require(surfacePath);
}
function withGlobals(W) {
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController, requestAnimationFrame: global.requestAnimationFrame, Event: global.Event };
  Object.assign(global, { window: W, document: W.document, localStorage: W.localStorage, AbortController: W.AbortController, Event: W.Event, requestAnimationFrame: (cb) => setTimeout(cb, 0) });
  return () => Object.assign(global, saved);
}
function tapEl(W, el) {
  el.dispatchEvent(new W.Event('touchend', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true }));
}

// ---------------------------------------------------------------- the pure half
test('isPlayerOpenUrl: /music and /podcasts with ?play= (a launch) or ?nowplaying=1 (the mini player\'s return) open the player; browsing and other routes do not', () => {
  assert.strictEqual(isPlayerOpenUrl('/music', '?nowplaying=1'), true, 'the dock tap (music.js readerHref)');
  assert.strictEqual(isPlayerOpenUrl('/podcasts', '?nowplaying=1'), true, 'the dock tap (podcasts.js readerHref)');
  assert.strictEqual(isPlayerOpenUrl('/music', '?play=t1'), true);
  assert.strictEqual(isPlayerOpenUrl('/music', '?play=v1&listen=1'), true, 'a listen launch');
  assert.strictEqual(isPlayerOpenUrl('/podcasts', '?play=e1'), true);
  assert.strictEqual(isPlayerOpenUrl('/music', ''), false, 'the music tab');
  assert.strictEqual(isPlayerOpenUrl('/music', '?nowplaying=0'), false);
  assert.strictEqual(isPlayerOpenUrl('/music', '?nowplaying=10'), false, 'the exact value, not a prefix');
  assert.strictEqual(isPlayerOpenUrl('/watch.html', '?v=x&nowplaying=1'), false, 'a video never opens a Click skin');
  assert.strictEqual(isPlayerOpenUrl('/', '?play=x'), false);
});

test('askForOpen: asks exactly when the open will show a Click skin that would light (every arm), once per session', () => {
  const cases = [
    { name: 'the ask', want: 1 },
    { name: 'Off', want: 0, strength: 'off' },
    { name: 'no strength stored', want: 0, strength: null },
    { name: 'a non-Click skin (Cider)', want: 0, skin: 'apple' },
    { name: 'a fine pointer (desktop)', want: 0, win: { fine: true } },
    { name: 'reduced motion', want: 0, win: { reduced: true } },
    { name: 'no permission API (Android)', want: 0, win: { api: false } },
    { name: 'a desktop-width viewport (no skin)', want: 0, win: { mobile: false } },
    { name: 'the tray', want: 0, tray: true },
    { name: 'no live user activation (a cold ?play=)', want: 0, inactive: true },
    { name: 'a live user activation', want: 1, active: true },
    { name: 'another Click colorway (Click Red)', want: 1, skin: 'ipod-red' },
  ];
  for (const c of cases) {
    const dom = new JSDOM('<body></body>', { url: 'http://localhost/music', pretendToBeVisual: true });
    const W = dom.window;
    const restore = withGlobals(W);
    try {
      const asks = phoneWindow(W, c.win || {});
      loadModules(W, { skin: c.skin || 'ipod', strength: c.strength === undefined ? 'pronounced' : c.strength });
      if (c.tray) W.document.body.classList.add('mms-tray');
      if (c.inactive || c.active) Object.defineProperty(W.navigator, 'userActivation', { configurable: true, value: { isActive: !!c.active, hasBeenActive: true } });
      const r = W.FileTubePocketLighting.askForOpen(W);
      assert.strictEqual(asks.n, c.want, c.name + ': asks');
      assert.strictEqual(r, c.want === 1, c.name + ': the return says whether it asked');
      if (c.want === 1) {
        W.FileTubePocketLighting.askForOpen(W);
        assert.strictEqual(asks.n, 1, c.name + ': once per session (the ask is pending)');
      }
    } finally { restore(); }
  }
});

// ---------------------------------------------------------------- the session through the REAL engine
const ENGINE_HTML = '<body><video id="media-player"></video><button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button><input id="seek-bar" type="range" /><div id="panel" class="music-nowplaying-panel" hidden></div></body>';
function engineBoot(W) {
  const panel = W.document.getElementById('panel');
  return W.FileTubeSkinSurface.create({
    panel, win: W, getSkinId: () => 'ipod',
    getCtx: () => ({ track: { title: 'T', artist: 'A', artUrl: '/albumart/now' }, upNext: [], fullList: [], playing: true }),
    hostCtl: (id) => W.document.getElementById(id), onSelectIndex: () => {}, onDock: () => {},
  });
}
function tiltTo(W, beta, gamma) {
  const e = new W.Event('deviceorientation');
  Object.defineProperty(e, 'beta', { value: beta }); Object.defineProperty(e, 'gamma', { value: gamma });
  W.dispatchEvent(e);
}
function engineWorld() {
  const dom = new JSDOM(ENGINE_HTML, { url: 'http://localhost/music', pretendToBeVisual: true });
  const W = dom.window;
  const restore = withGlobals(W);
  const asks = phoneWindow(W);
  loadModules(W);
  const L = W.FileTubePocketLighting;
  const panel = W.document.getElementById('panel');
  return { W, restore, asks, L, panel };
}

test('the open-ask\'s answer flows like a Settings pick: a deny = the note on the driver the open painted (no second ask, nothing streams); a grant lights on the first sample', async () => {
  const w = engineWorld();
  try {
    assert.strictEqual(w.L.askForOpen(w.W), true);
    const e = engineBoot(w.W); e.paint(); // the player opens AFTER the tap (the async open)
    assert.ok(!e.lightingState().askArmed, 'the session asked: the painted driver arms no second ask');
    tapEl(w.W, w.W.document.body);
    assert.strictEqual(w.asks.n, 1, 'the next tap asks nothing (Dean: not the sticker)');
    w.asks.answer('denied'); await settleAll(4);
    const st = e.lightingState();
    assert.strictEqual(st.permission, 'denied');
    assert.strictEqual(st.note, w.L.NOTE_DENIED, 'the deny note, exactly as a Settings pick shows it');
    assert.ok(!w.panel.classList.contains('mms-lit') && !st.on, 'not lit, nothing streams');
    e.destroy();
    const e2 = engineBoot(w.W); e2.paint(); // a view swap: a driver born after the answer
    assert.strictEqual(e2.lightingState().note, w.L.NOTE_DENIED, 'a later driver adopts the session\'s answer');
    assert.ok(!e2.lightingState().askArmed && !e2.lightingState().on, 'and neither arms nor streams');
    assert.strictEqual(w.L.askForOpen(w.W), false, 'an answered session never asks again');
    assert.strictEqual(w.asks.n, 1);
    e2.destroy();
  } finally { w.restore(); }
  const g = engineWorld();
  try {
    g.L.askForOpen(g.W);
    const e = engineBoot(g.W); e.paint();
    g.asks.answer('granted'); await settleAll(4);
    assert.strictEqual(e.lightingState().permission, 'granted');
    assert.ok(!g.panel.classList.contains('mms-lit'), 'granted: still waiting for the first sample (the lit gate)');
    tiltTo(g.W, 0, 3);
    assert.ok(g.panel.classList.contains('mms-lit') && g.panel.classList.contains('mms-lit-strong'), 'lit on the first sample, Pronounced = strong');
    e.destroy();
  } finally { g.restore(); }
});

test('a late answer after the driver died re-binds nothing: the open-ask pending, the engine destroyed (a view swap), the grant lands - no sensor listener, no lit panel', async () => {
  const w = engineWorld();
  let orient = 0;
  const a0 = w.W.addEventListener.bind(w.W); const r0 = w.W.removeEventListener.bind(w.W);
  w.W.addEventListener = (t, f, o) => { if (t === 'deviceorientation') orient += 1; return a0(t, f, o); };
  w.W.removeEventListener = (t, f, o) => { if (t === 'deviceorientation') orient -= 1; return r0(t, f, o); };
  try {
    w.L.askForOpen(w.W);
    const e = engineBoot(w.W); e.paint();
    assert.strictEqual(orient, 1, 'populated: the painted driver listens');
    e.destroy();
    assert.strictEqual(orient, 0);
    w.asks.answer('granted'); await settleAll(4);
    assert.strictEqual(orient, 0, 'the late grant found no live driver to re-bind');
    assert.ok(!w.panel.classList.contains('mms-lit'));
  } finally { w.restore(); }
});

test('a Lighting pick\'s answer is the SESSION\'s: a driver born after a deny adopts the note; a re-pick clears the session\'s old answer, so a driver born while it is pending adopts nothing stale', async () => {
  const w = engineWorld();
  try {
    const d = w.L.create({ panel: w.panel, win: w.W, isPocket: () => true, store: w.W.localStorage });
    d.choose('subtle');
    w.asks.answer('denied'); await settleAll(4);
    d.destroy();
    const e = engineBoot(w.W); e.paint();
    assert.strictEqual(e.lightingState().note, w.L.NOTE_DENIED, 'the deny a row pick got is the session\'s answer');
    e.destroy();
    const d2 = w.L.create({ panel: w.panel, win: w.W, isPocket: () => true, store: w.W.localStorage });
    d2.choose('pronounced'); // a re-pick after the deny: asks again, the old answer is gone
    assert.strictEqual(w.asks.n, 2);
    const e2 = engineBoot(w.W); e2.paint();
    assert.strictEqual(e2.lightingState().note, '', 'born while the re-pick is pending: no stale deny adopted');
    assert.strictEqual(e2.lightingState().permission, '');
    e2.destroy(); d2.destroy();
  } finally { w.restore(); }
});

test('a REJECTED ask (no gesture: WebKit\'s NotAllowedError) is not a deny: no note, the session stays un-asked, the first-tap ask re-arms and the next tap asks', async () => {
  const w = engineWorld();
  try {
    w.L.askForOpen(w.W);
    const e = engineBoot(w.W); e.paint();
    assert.ok(!e.lightingState().askArmed);
    const err = new Error('Requesting device orientation access requires a user gesture to prompt'); err.name = 'NotAllowedError';
    w.asks.reject(err); await settleAll(4);
    const st = e.lightingState();
    assert.strictEqual(st.note, '', 'no deny note for a question nobody was asked');
    assert.strictEqual(st.asked, false, 'the session is un-asked');
    assert.ok(st.askArmed, 'the first-tap ask is armed again');
    tapEl(w.W, w.W.document.body);
    assert.strictEqual(w.asks.n, 2, 'the next tap asks');
    e.destroy();
  } finally { w.restore(); }
});

test('one gesture never asks twice: the painted panel\'s capture listener and a view seam in the SAME tap = one ask; a row pick owns its own ask', async () => {
  const w = engineWorld();
  try {
    const e = engineBoot(w.W); e.paint();
    assert.ok(e.lightingState().askArmed, 'a painted, un-asked panel arms the first-tap ask');
    const btn = w.W.document.createElement('button'); w.W.document.body.appendChild(btn);
    btn.addEventListener('click', () => w.L.askForOpen(w.W)); // a view seam (an up-next tap -> playAt)
    btn.dispatchEvent(new w.W.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(w.asks.n, 1, 'the capture listener asked first; the seam found the session asked');
    e.destroy();
  } finally { w.restore(); }
  const q = engineWorld();
  try {
    const e = engineBoot(q.W); e.paint();
    assert.ok(e.lightingState().askArmed, 'armed');
    q.L.askForOpen(q.W); // an open seam asked (its own gesture, or none) while the painted panel's listener stayed bound
    assert.strictEqual(q.asks.n, 1);
    tapEl(q.W, q.W.document.body);
    assert.strictEqual(q.asks.n, 1, 'the next tap finds the session asked: no second ask while the first is pending');
    e.destroy();
  } finally { q.restore(); }
  const r = engineWorld();
  try {
    const e = engineBoot(r.W); e.paint();
    e.lightingState();
    // a Lighting pick counts as the session's ask: a later open never re-asks
    r.W.FileTubePocketLighting.askForOpen(r.W); // asks (1)
    r.asks.answer('granted'); await settleAll(4);
    assert.strictEqual(r.L.askForOpen(r.W), false, 'granted this session: never again');
    assert.strictEqual(r.asks.n, 1);
    e.destroy();
  } finally { r.restore(); }
});

test('the session\'s other askers supersede the open-ask: a Lighting pick (choose) IS the session\'s ask, and a streaming sensor sample IS a grant - a later open never asks', async () => {
  const w = engineWorld();
  try {
    const d = w.L.create({ panel: w.panel, win: w.W, isPocket: () => true, store: w.W.localStorage });
    d.choose('subtle'); // the Settings / sticker Lighting row: asks itself, inside its own tap
    assert.strictEqual(w.asks.n, 1, 'the row asked');
    assert.strictEqual(w.L.askForOpen(w.W), false, 'pending row answer: the open does not ask again');
    w.asks.answer('granted'); await settleAll(4);
    assert.strictEqual(w.L.askForOpen(w.W), false, 'answered: never again');
    assert.strictEqual(w.asks.n, 1);
    d.destroy();
  } finally { w.restore(); }
  const g = engineWorld();
  try {
    const e = engineBoot(g.W); e.paint();
    assert.ok(e.lightingState().askArmed, 'un-asked, painted: the first-tap ask is armed');
    tiltTo(g.W, 0, 3); // a remembered grant streams without any ask
    assert.strictEqual(e.lightingState().permission, 'granted');
    assert.strictEqual(g.L.askForOpen(g.W), false, 'a streaming sensor is a grant for the whole session');
    assert.strictEqual(g.asks.n, 0, 'nothing ever asked');
    e.destroy();
  } finally { g.restore(); }
});

// ---------------------------------------------------------------- the REAL music.js open paths
const MUSIC_VIEW = `<body><div id="view-root" data-view="music">
  <div class="music-toolbar"><div class="music-toolbar-actions">
    <select id="music-sort-select"></select><button id="music-view-toggle" hidden></button>
    <button id="music-popout-btn" hidden></button><button id="music-shuffle-btn"></button><button id="music-scan-btn"></button>
    <div class="music-actions-wrap"><button id="music-actions-btn" type="button" hidden></button><div class="mms-sticker-menu" id="music-actions-menu" role="menu" hidden></div></div>
  </div></div>
  <div id="music-stage"><div id="player-slot"><div id="player-wrapper"><video id="media-player"></video>
    <div id="player-controls"><button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button><input id="seek-bar" type="range" /><button id="settings-btn"></button></div></div></div>
    <div id="music-nowplaying-panel" class="music-nowplaying-panel" hidden></div></div>
  <button class="music-nowplaying" id="music-nowplaying" hidden></button>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs"><button class="music-tab active" data-tab="songs">Songs</button></div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

async function bootMusic({ album = false, skin = 'ipod', win = {}, query = '', userActivation, tab = 'songs' } = {}) {
  const dom = new JSDOM(MUSIC_VIEW, { url: 'http://localhost/music' + query, pretendToBeVisual: true });
  const W = dom.window;
  const restore = withGlobals(W);
  const asks = phoneWindow(W, win);
  if (userActivation) Object.defineProperty(W.navigator, 'userActivation', { configurable: true, value: userActivation });
  const track = { id: 't1', title: 'Song', artist: 'A', album: album ? 'Alb' : '', albumKey: album ? 'A\u0000Alb' : '', durationSec: 100 };
  global.fetch = () => Promise.resolve({ ok: true, json: async () => ({ items: [track], total: 1 }) });
  const pl = { state: 'closed', cur: null, meta: null };
  let mod = null;
  W.FileTube = {
    registerView: (n, m) => { mod = m; }, encodeListContext: () => '', decodeListContext: () => null, shimmerArt: () => {},
    player: {
      get currentId() { return pl.cur; },
      getState: () => pl.state, getCurrentMeta: () => pl.meta, expand() { pl.state = 'full'; }, setTrackNav() {}, dock() { pl.state = 'docked'; },
      load(id, data) { pl.cur = id; pl.meta = Object.assign({ isMusic: true, id }, data); pl.state = 'full'; },
      ensureTheaterButton: () => null,
    },
  };
  W.localStorage.setItem('filetube_music_tab', tab);
  loadModules(W, { skin });
  delete require.cache[musicPath];
  require(musicPath);
  mod.init(W.document.getElementById('view-root'));
  await settleAll(10);
  return { W, asks, pl, mod, restore: () => { try { mod.destroy(); } catch (_) { /* best-effort */ } delete require.cache[musicPath]; restore(); } };
}

test('music: the Songs-row tap that OPENS the Click player asks inside that tap (the direct play and the album drill), exactly once; the sticker afterwards asks nothing', async () => {
  for (const album of [false, true]) {
    const m = await bootMusic({ album });
    try {
      const D = m.W.document;
      const row = D.querySelector('.music-song-row');
      assert.ok(row, 'the Songs list rendered');
      assert.strictEqual(m.asks.n, 0, 'browsing asks nothing');
      tapEl(m.W, row);
      assert.strictEqual(m.asks.n, 1, (album ? 'album drill' : 'direct') + ': the ask ran INSIDE the opening tap (before any await)');
      await settleAll();
      const panel = D.getElementById('music-nowplaying-panel');
      assert.ok(panel.querySelector('.ip-wheel') && !panel.hidden, 'the Click player opened');
      tapEl(m.W, panel.querySelector('[data-skin-sticker]'));
      assert.strictEqual(m.asks.n, 1, 'the sticker no longer asks (Dean\'s report)');
    } finally { m.restore(); }
  }
});

test('music: the Jump-back tile tap asks inside the tap; a non-Click skin, a desktop and a cold ?play= with no live activation never ask from the open (the painted panel\'s first tap still does)', async () => {
  const j = await bootMusic();
  try {
    const host = j.W.document.getElementById('music-jumpback');
    const tile = host.querySelector('.music-jump-tile');
    assert.ok(tile, 'the strip rendered a tile');
    tapEl(j.W, tile);
    assert.strictEqual(j.asks.n, 1, 'the tile\'s tap asked');
  } finally { j.restore(); }
  const c = await bootMusic({ skin: 'apple' });
  try { tapEl(c.W, c.W.document.querySelector('.music-song-row')); await settleAll(); assert.strictEqual(c.asks.n, 0, 'Cider: never'); } finally { c.restore(); }
  const d = await bootMusic({ win: { mobile: false, fine: true } });
  try { tapEl(d.W, d.W.document.querySelector('.music-song-row')); await settleAll(); assert.strictEqual(d.asks.n, 0, 'a desktop: never'); } finally { d.restore(); }
  const n = await bootMusic({ query: '?play=t1', userActivation: { isActive: false, hasBeenActive: false } });
  try {
    await settleAll();
    assert.strictEqual(n.asks.n, 0, 'a notification\'s cold ?play= has no gesture: no ask from the open');
    const panel = n.W.document.getElementById('music-nowplaying-panel');
    assert.ok(panel.querySelector('.ip-wheel'), 'the Click player is up');
    tapEl(n.W, panel.querySelector('.ip-lcd') || panel);
    assert.strictEqual(n.asks.n, 1, 'the first tap on the player asks (the v1.330 first-tap ask stands)');
  } finally { n.restore(); }
});

// gate r1 (adversary W2): both Shuffle buttons play only after loadSongs' fetch AND its JSON read - WebKit keeps
// a tap's gesture across the fetch but the body read leaves it media-only, so the ask must run in the handler
test('music: both Shuffle buttons (the toolbar\'s and an album page\'s) ask INSIDE their tap, before the fetch', async () => {
  const t = await bootMusic();
  try {
    tapEl(t.W, t.W.document.getElementById('music-shuffle-btn'));
    assert.strictEqual(t.asks.n, 1, 'the toolbar Shuffle asked in the same turn as its tap');
    await settleAll(); // its play lands after the fetch (and must not leak into the next realm)
    assert.strictEqual(t.asks.n, 1, 'and the play that follows the fetch does not ask again');
  } finally { t.restore(); }
  const d = await bootMusic({ album: true, tab: 'albums' });
  try {
    const card = d.W.document.querySelector('.music-album-card');
    assert.ok(card, 'the Albums grid rendered');
    tapEl(d.W, card); await settleAll();
    assert.strictEqual(d.asks.n, 0, 'opening an album is browsing, not the player');
    const sh = d.W.document.querySelector('.music-drill-shuffle');
    assert.ok(sh, 'the album page has its Shuffle');
    tapEl(d.W, sh);
    assert.strictEqual(d.asks.n, 1, 'the album page\'s Shuffle asked in the same turn as its tap');
  } finally { d.restore(); }
});

// ---------------------------------------------------------------- the REAL podcasts.js open path
function podcastsViewHtml() {
  const shell = new JSDOM(fs.readFileSync(path.join(ROOT, 'public', 'podcasts.html'), 'utf8')).window.document;
  return '<body>' + shell.getElementById('view-root').outerHTML + '<video id="media-player"></video><button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button><input id="seek-bar" type="range" /></body>';
}
test('podcasts: the episode tap that opens the Click player asks inside that tap (the real podcasts.html view, podcasts.js playAt)', async () => {
  const dom = new JSDOM(podcastsViewHtml(), { url: 'http://localhost/podcasts', pretendToBeVisual: true });
  const W = dom.window;
  const restore = withGlobals(W);
  const asks = phoneWindow(W);
  const show = { id: 's1', name: 'Show', title: 'Show', episodeCount: 1 };
  const ep = { id: 'e1', subId: 's1', title: 'Ep 1', status: 'downloaded', durationSec: 60, publishedAt: '2026-09-01T00:00:00Z' };
  global.fetch = (u) => Promise.resolve({ ok: true, json: async () => (/\/episodes$/.test(u) ? { show, episodes: [ep] } : /\/shows$/.test(u) ? { shows: [show] } : {}) });
  const pl = { state: 'closed', cur: null, meta: null };
  let mod = null;
  W.FileTube = {
    registerView: (n, m) => { mod = m; }, shimmerArt: () => {}, encodeListContext: () => '', decodeListContext: () => null,
    player: { get currentId() { return pl.cur; }, getState: () => pl.state, getCurrentMeta: () => pl.meta, expand() { pl.state = 'full'; }, setTrackNav() {}, dock() {}, load(id, data) { pl.cur = id; pl.meta = Object.assign({ resumeMode: 'podcast', id }, data); pl.state = 'full'; }, ensureTheaterButton: () => null },
  };
  loadModules(W);
  delete require.cache[podcastsPath];
  try {
    require(podcastsPath);
    mod.init(W.document.getElementById('view-root'));
    await settleAll();
    const card = W.document.querySelector('.podcast-card');
    assert.ok(card, 'the shows grid rendered');
    tapEl(W, card);
    assert.strictEqual(asks.n, 0, 'opening a SHOW is browsing, not the player');
    await settleAll();
    const main = W.document.querySelector('.podcast-episode-main');
    assert.ok(main, 'the episode list rendered');
    tapEl(W, main);
    assert.strictEqual(asks.n, 1, 'the episode tap asked inside the gesture');
    mod.destroy();
  } finally { delete require.cache[podcastsPath]; restore(); }
});

// ---------------------------------------------------------------- the REAL router (common.js navigate)
function routerWorld({ skin = 'ipod', strength = 'pronounced', url = 'http://localhost/' } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="view-root" data-view="home"></div></body></html>', { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const W = dom.window;
  const asks = phoneWindow(W);
  W.fetch = () => new Promise(() => {}); // the view fetch never lands: the ask must have run before it
  W.localStorage.setItem('ft-music-skin', skin);
  W.localStorage.setItem('ft-pocket-lighting', strength);
  for (const f of ['music-skins.js', 'pocket-lighting.js', 'common.js']) W.eval(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'));
  W.document.dispatchEvent(new W.Event('DOMContentLoaded'));
  return { W, asks };
}
test('the router: a navigation INTO the player (the mini player\'s return, a card\'s ?play=) asks synchronously inside navigate(), before the view fetch; browsing, a video and a same-URL no-op never do', () => {
  const worlds = [];
  const world = (o) => { const w = routerWorld(o); worlds.push(w); return w; };
  try {
  const r = world();
  assert.strictEqual(typeof r.W.FileTube.navigate, 'function', 'the live router booted');
  r.W.FileTube.navigate('/music');
  assert.strictEqual(r.asks.n, 0, 'the music tab is browsing');
  r.W.FileTube.navigate('/watch.html?v=abc');
  assert.strictEqual(r.asks.n, 0, 'a video');
  r.W.FileTube.navigate('/music?nowplaying=1');
  assert.strictEqual(r.asks.n, 1, 'the dock tap into the player asked in the same turn');
  r.W.FileTube.navigate('/podcasts?play=e1');
  assert.strictEqual(r.asks.n, 1, 'once per session');
  const c = world({ url: 'http://localhost/music?play=t1' });
  c.W.FileTube.navigate('/music?play=t1');
  assert.strictEqual(c.asks.n, 0, 'a same-URL no-op opens nothing');
  c.W.FileTube.navigate('/podcasts?play=e1');
  assert.strictEqual(c.asks.n, 1, 'a card into the podcast player');
  const o = world({ strength: 'off' });
  o.W.FileTube.navigate('/music?nowplaying=1');
  assert.strictEqual(o.asks.n, 0, 'Off');
  const k = world({ skin: 'spotify' });
  k.W.FileTube.navigate('/music?nowplaying=1');
  assert.strictEqual(k.asks.n, 0, 'a non-Click skin');
  } finally { for (const w of worlds) w.W.close(); } // the live router's timers die with its window, red or green
});
