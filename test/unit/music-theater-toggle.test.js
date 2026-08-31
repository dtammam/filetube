'use strict';

// [UNIT] v1.222 slice 3 (Dean): the desktop THEATRE toggle on the Music view -
// lays the album / up-next panel BESIDE the expanded player. This binds the
// wiring (the two-column layout itself is CSS, device-validated): the toggle
// rides `.is-theater` on #music-stage, persists to localStorage (ft-music-theater)
// and restores on init, and the button is HIDDEN until a track is expanded.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div class="music-toolbar"><div class="music-toolbar-actions">
    <select id="music-sort-select"></select>
    <button id="music-view-toggle" hidden></button>
    <button id="music-theater-btn" hidden aria-pressed="false"><svg></svg></button>
    <button id="music-shuffle-btn"></button>
    <button id="music-scan-btn"></button>
  </div></div>
  <div id="music-stage"><div id="player-slot"></div>
  <div id="music-nowplaying-panel" class="music-nowplaying-panel" hidden></div></div>
  <button class="music-nowplaying" id="music-nowplaying" hidden></button>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs"><button class="music-tab active" data-tab="songs">Songs</button></div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function boot(prep) {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  global.fetch = () => Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  let mod = null;
  dom.window.FileTube = {
    registerView: (name, m) => { mod = m; }, encodeListContext: () => '', decodeListContext: () => null, shimmerArt: () => {},
    player: { currentId: null, getState: () => 'docked', expand: () => {}, setTrackNav: () => {}, load: () => {} },
  };
  if (prep) prep(dom);
  try {
    delete require.cache[musicPath];
    require(musicPath);
    mod.init(dom.window.document.getElementById('view-root'));
    for (let i = 0; i < 6; i++) await settle();
    return { dom, restore: () => { delete require.cache[musicPath]; Object.assign(global, saved); } };
  } catch (e) { delete require.cache[musicPath]; Object.assign(global, saved); throw e; }
}

test('v1.222 slice 3: the theatre toggle flips .is-theater on #music-stage, persists, and updates aria-pressed', async () => {
  const { dom, restore } = await boot();
  try {
    const stage = dom.window.document.getElementById('music-stage');
    const btn = dom.window.document.getElementById('music-theater-btn');
    assert.ok(!stage.classList.contains('is-theater'), 'default OFF: no side-by-side');
    assert.strictEqual(btn.getAttribute('aria-pressed'), 'false');
    btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.ok(stage.classList.contains('is-theater'), 'ON: the stage goes two-column (CSS does the layout on desktop)');
    assert.strictEqual(btn.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(dom.window.localStorage.getItem('ft-music-theater'), '1', 'the choice persists');
    btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.ok(!stage.classList.contains('is-theater'), 'toggles back OFF');
    assert.strictEqual(dom.window.localStorage.getItem('ft-music-theater'), '0');
  } finally { restore(); }
});

test('v1.222 slice 3: a persisted theatre choice is restored on init', async () => {
  const { dom, restore } = await boot((d) => { try { d.window.localStorage.setItem('ft-music-theater', '1'); } catch (_) { /* ignore */ } });
  try {
    assert.ok(dom.window.document.getElementById('music-stage').classList.contains('is-theater'), 'restored ON from localStorage');
    assert.strictEqual(dom.window.document.getElementById('music-theater-btn').getAttribute('aria-pressed'), 'true');
  } finally { restore(); }
});

test('v1.222 slice 3: the theatre button stays HIDDEN while no track is expanded (nothing to lay out)', async () => {
  const { dom, restore } = await boot();
  try {
    // docked player, no now-playing -> updateNowPlayingPanel ran on init and hid it.
    assert.strictEqual(dom.window.document.getElementById('music-theater-btn').hidden, true,
      'no expanded track -> the toggle is hidden (it only makes sense with a player to sit beside)');
  } finally { restore(); }
});
