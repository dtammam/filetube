'use strict';

// [UNIT] v1.364.0 W2b - a way into the iPod with NO song (Dean 2026-10-05: "within 1 to 2 taps get to
// the click ipod view. i may want to use my phone as a remote and not choose a song to then pause to
// then go to speaker"). One seam, /music?pocket=1 (the view's openPocketSeam), through the REAL music
// view (music.js), the REAL skin engine and registry, and the REAL remote controller; two entries:
// the bottom bar's Music tab tapped again on /music (the REAL router, common.js), and the /music
// toolbar's iPod button. The idle iPod lands on the Main menu, cursor on Music; MENU there closes it
// back to the browse view without pl.dock() (no track to dock); with a speaker MENU is unchanged.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const skinsPath = require.resolve('../../public/js/music-skins.js');
const remotePath = require.resolve('../../public/js/remote.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const COMMON_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
const { musicTabPocketUrl } = require('../../public/js/common.js');

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div class="music-toolbar"><div class="music-toolbar-actions">
    <select id="music-sort-select"></select><button id="music-view-toggle" hidden></button>
    <button id="music-pocket-btn" type="button" hidden>iPod</button>
    <button id="music-popout-btn" hidden></button><button id="music-shuffle-btn"></button><button id="music-scan-btn"></button>
    <div class="music-actions-wrap"><button id="music-actions-btn" type="button" hidden></button><div class="mms-sticker-menu" id="music-actions-menu" role="menu" hidden></div></div>
  </div></div>
  <div id="music-stage">
    <div id="player-slot">
      <div id="player-wrapper"><video id="media-player"></video>
      <div id="player-controls">
        <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
        <input id="seek-bar" type="range" /><button id="settings-btn"></button>
      </div></div>
    </div>
    <div id="music-nowplaying-panel" class="music-nowplaying-panel" hidden></div>
  </div>
  <button class="music-nowplaying" id="music-nowplaying" hidden></button>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs"><button class="music-tab active" data-tab="songs">Songs</button></div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((r) => setImmediate(r));
const targets = [{ deviceId: 'pc-1', label: 'Desk', controlled: false, state: { deviceId: 'pc-1', label: 'Desk', state: 'playing', position: 10, duration: 200, hasPrev: false, hasNext: false, at: 1, ageMs: 0, track: { id: 'x1', title: 'Song', artist: 'A', album: 'B', artUrl: '' } } }];

// o.track: 'none' (nothing loaded), 'docked' (a music track in the mini), 'full'. o.phone, o.skin, o.query, o.remote.
async function boot(o, run) {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' + (o.query || '') });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController, requestAnimationFrame: global.requestAnimationFrame, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  global.Event = dom.window.Event;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.matchMedia = (q) => ({ matches: /pointer:\s*coarse|max-width:\s*768px/.test(q) ? !!o.phone : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  dom.window.scrollTo = function () {};
  if (o.phone) dom.window.document.documentElement.classList.add('is-phone');
  const base = () => Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  global.fetch = o.remote ? ((u, x) => (/\/api\/remote\/targets/.test(String(u)) ? Promise.resolve({ ok: true, status: 200, json: async () => targets }) : base(u, x))) : base;
  const spy = { dock: 0, expand: 0, rc: null };
  const st = { state: o.track === 'none' ? 'hidden' : (o.track || 'hidden') };
  const meta = o.track === 'none' ? null : { isMusic: true, id: 't1', title: 'Track A', artist: 'X', album: 'Y', albumKey: 'k' };
  let mod = null;
  dom.window.FileTube = {
    registerView: (n, m) => { mod = m; }, encodeListContext: () => '', decodeListContext: () => null, shimmerArt: () => {},
    player: { currentId: meta ? meta.id : null, getState: () => st.state, getCurrentMeta: () => meta, expand() { spy.expand += 1; st.state = 'full'; }, setTrackNav() {}, load() {}, dock() { spy.dock += 1; st.state = 'docked'; }, ensureTheaterButton: () => null },
  };
  if (o.remote) {
    delete require.cache[remotePath]; global.module = undefined;
    const api = require(remotePath);
    dom.window.fetch = (u, x) => global.fetch(u, x);
    dom.window.EventSource = function () { this.addEventListener = () => {}; this.close = () => {}; };
    dom.window.FileTube.getDeviceId = () => 'phone-1';
    dom.window.FileTube.getDeviceLabel = () => 'Pixel';
    const env = api.browserEnv(dom.window); env.storage = dom.window.sessionStorage;
    spy.rc = dom.window.FileTube.remoteControl = api.createController(env);
    spy.rc.select(targets[0]);
  }
  delete require.cache[skinsPath]; global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  if (o.skin) dom.window.localStorage.setItem('ft-music-skin', o.skin);
  delete require.cache[surfacePath];
  require(surfacePath);
  try {
    delete require.cache[musicPath];
    require(musicPath);
    mod.init(dom.window.document.getElementById('view-root'));
    for (let i = 0; i < 10; i++) await settle();
    await run(dom, spy, mod);
  } finally { try { mod && mod.destroy && mod.destroy(); if (spy.rc) { spy.rc.leave(); dom.window.close(); } } catch (_) {} delete require.cache[musicPath]; delete require.cache[skinsPath]; Object.assign(global, saved); }
}
const P = (dom) => dom.window.document.getElementById('music-nowplaying-panel');
const engineMenu = (dom) => {
  const cur = P(dom).querySelector('.ipm-row.is-cursor .ipm-lbl');
  return { onMenu: P(dom).querySelector('.ipm-row') !== null && !P(dom).classList.contains('mms-listmode'), cursor: cur && cur.textContent };
};
const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const menuShown = (dom) => !!P(dom).querySelector('.ip-lcd .ipm-row');

test('W2b seam, no song: /music?pocket=1 on a phone with an iPod skin shows the iPod on the Main menu, cursor on Music; the param is stripped after', async () => {
  await boot({ phone: true, skin: 'ipod', track: 'none', query: '?pocket=1' }, async (dom, spy) => {
    const p = P(dom);
    assert.strictEqual(p.hidden, false, 'the panel shows');
    assert.ok(p.classList.contains('mms-full'), 'the full iPod');
    assert.ok(dom.window.document.body.classList.contains('mms-on'));
    assert.ok(menuShown(dom), 'the Main menu is on the LCD');
    assert.strictEqual(engineMenu(dom).cursor, 'Music', 'the cursor sits on Music');
    const labels = [...p.querySelectorAll('.ipm-row .ipm-lbl')].map((e) => e.textContent);
    assert.ok(!labels.includes('Now Playing'), 'no Now Playing row with no song (' + labels.join(',') + ')');
    assert.strictEqual(dom.window.location.search, '', 'pocket=1 stripped after the landing');
    assert.strictEqual(spy.expand, 0, 'nothing to expand');
  });
});

test('W2b seam, with a song in the mini: the player comes up (expanded) and the iPod lands on the Main menu too', async () => {
  await boot({ phone: true, skin: 'ipod', track: 'docked', query: '?pocket=1' }, async (dom, spy) => {
    assert.strictEqual(spy.expand, 1, 'the docked track expanded');
    assert.strictEqual(P(dom).hidden, false);
    assert.ok(menuShown(dom), 'on the Main menu');
    assert.strictEqual(engineMenu(dom).cursor, 'Music');
    assert.strictEqual(dom.window.location.search, '');
  });
});

test('W2b seam is a no-op where the iPod cannot open: not a phone, or a skin without menus (Cider); the param is still stripped', async () => {
  for (const o of [{ phone: false, skin: 'ipod' }, { phone: true, skin: 'apple' }]) {
    await boot(Object.assign({ track: 'none', query: '?pocket=1' }, o), async (dom) => {
      assert.strictEqual(P(dom).hidden, true, JSON.stringify(o) + ': no panel');
      assert.ok(!dom.window.document.body.classList.contains('mms-on'));
      assert.strictEqual(dom.window.location.search, '', 'stripped');
    });
  }
});

test('W2b MENU on the idle Main menu (no song, no speaker) closes the iPod back to the browse view, never pl.dock()', async () => {
  await boot({ phone: true, skin: 'ipod', track: 'none', query: '?pocket=1' }, async (dom, spy) => {
    assert.ok(menuShown(dom), 'precondition: the idle iPod is up (populated first)');
    click(dom, P(dom).querySelector('[data-skin-menu]'));
    assert.strictEqual(P(dom).hidden, true, 'the panel closed');
    assert.ok(!P(dom).classList.contains('mms-full'));
    assert.ok(!dom.window.document.body.classList.contains('mms-on'), 'the browse view is back');
    assert.strictEqual(spy.dock, 0, 'no dock() (nothing to dock)');
  });
});

test('W2b the collapse control on the idle iPod closes it the same way (one exit, both controls)', async () => {
  await boot({ phone: true, skin: 'ipod', track: 'none', query: '?pocket=1' }, async (dom, spy) => {
    const c = P(dom).querySelector('[data-skin-collapse]');
    if (!c) return; // the iPod skin may draw no collapse; MENU above is then the only exit
    click(dom, c);
    assert.strictEqual(P(dom).hidden, true);
    assert.strictEqual(spy.dock, 0);
  });
});

test('W2b with a speaker: the seam shows the speaker\'s iPod on the Main menu, and MENU there steps aside as today (no idle state left behind)', async () => {
  await boot({ phone: true, skin: 'ipod', track: 'none', remote: true, query: '?pocket=1' }, async (dom, spy) => {
    assert.ok(spy.rc.isRemote(), 'precondition: controlling the speaker');
    assert.ok(menuShown(dom), 'Main menu');
    const labels = [...P(dom).querySelectorAll('.ipm-row .ipm-lbl')].map((e) => e.textContent);
    assert.ok(labels.includes('Speakers'), 'Speakers is on the Main menu (the remote use; ' + labels.join(',') + ')');
    assert.strictEqual(engineMenu(dom).cursor, 'Music');
    click(dom, P(dom).querySelector('[data-skin-menu]'));
    assert.strictEqual(P(dom).hidden, true, 'stepped aside (remoteDocked), as before');
    assert.strictEqual(spy.dock, 0, 'a remote mirror never docks the local player');
  });
});

test('W2b toolbar iPod button: shown on a phone with an iPod skin, hidden without (desktop, or Cider) - both axes - and a tap opens the idle iPod', async () => {
  await boot({ phone: true, skin: 'ipod', track: 'none' }, async (dom) => {
    const b = dom.window.document.getElementById('music-pocket-btn');
    assert.strictEqual(b.hidden, false, 'shown');
    assert.strictEqual(P(dom).hidden, true, 'precondition: nothing up yet');
    click(dom, b);
    assert.strictEqual(P(dom).hidden, false, 'the tap opened the iPod');
    assert.ok(menuShown(dom));
    assert.strictEqual(engineMenu(dom).cursor, 'Music');
  });
  for (const o of [{ phone: false, skin: 'ipod' }, { phone: true, skin: 'apple' }]) {
    await boot(Object.assign({ track: 'none' }, o), async (dom) => {
      const b = dom.window.document.getElementById('music-pocket-btn');
      assert.strictEqual(b.hidden, true, JSON.stringify(o) + ': hidden');
    });
  }
});

test('W2b musicTabPocketUrl: only the Music tab, only on the same URL, only when the iPod can open', () => {
  assert.strictEqual(musicTabPocketUrl('music', '/music', '/music', true), '/music?pocket=1');
  assert.strictEqual(musicTabPocketUrl('music', '/music', '/music', false), null, 'no iPod: the tap is the old no-op');
  assert.strictEqual(musicTabPocketUrl('music', '/music?artist=X', '/music', true), null, 'a different URL is a plain nav');
  assert.strictEqual(musicTabPocketUrl('home', '/', '/', true), null, 'another tab');
  assert.strictEqual(musicTabPocketUrl(null, '/music', '/music', true), null, 'a Music link that is not the bottom bar\'s');
});

// The REAL router (common.js in jsdom): a tap on the bottom bar's Music tab while /music is up.
function routerWorld(pocketAvailable) {
  const rdom = new JSDOM('<!doctype html><html><body><div id="view-root" data-view="music"></div><nav id="bottom-nav"><a href="/music" class="bottom-nav-item" data-nav="music">Music</a><a href="/" class="bottom-nav-item" data-nav="home">Home</a></nav><a id="other" href="/music">Music elsewhere</a></body></html>', { url: 'http://localhost/music', runScripts: 'outside-only', pretendToBeVisual: true });
  const W = rdom.window;
  const fetches = [];
  W.fetch = (u) => { fetches.push(String(u)); return new Promise(() => {}); };
  W.eval(COMMON_SRC);
  W.document.dispatchEvent(new W.Event('DOMContentLoaded'));
  W.history.replaceState({ view: 'music', url: '/music', scrollY: 0, viewState: null }, '');
  if (pocketAvailable !== undefined) W.FileTubeMusicSkins = { pocketEntryAvailable: () => pocketAvailable };
  W.FileTube.registerView('music', { init() {}, destroy() {} }); // the view script is "loaded", so a navigate reaches its fetch
  return { W, fetches, close: () => W.close() };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('W2b the Music tab tapped again on /music opens the iPod (navigates to /music?pocket=1); without an iPod it stays the old no-op', async () => {
  const a = routerWorld(true);
  try {
    a.W.document.querySelector('#bottom-nav [data-nav="music"]').dispatchEvent(new a.W.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await wait(20);
    assert.ok(a.fetches.some((u) => /\/music\?pocket=1$/.test(u)), 'navigated to the seam (' + a.fetches.join(',') + ')');
  } finally { a.close(); }
  for (const avail of [false, undefined]) {
    const b = routerWorld(avail);
    try {
      b.W.document.querySelector('#bottom-nav [data-nav="music"]').dispatchEvent(new b.W.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      await wait(20);
      assert.deepStrictEqual(b.fetches.filter((u) => /^http:\/\/localhost\/music(\?|$)/.test(u)), [], 'pocket ' + avail + ': no navigation (the same-URL no-op)');
    } finally { b.close(); }
  }
  const c = routerWorld(true);
  try {
    c.W.document.getElementById('other').dispatchEvent(new c.W.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await wait(20);
    assert.deepStrictEqual(c.fetches.filter((u) => /^http:\/\/localhost\/music(\?|$)/.test(u)), [], 'a /music link outside the bottom bar is untouched');
  } finally { c.close(); }
});
