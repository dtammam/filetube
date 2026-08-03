'use strict';

// [UNIT] v1.75 T4 - the music place's Liked tab is retired, and the device
// that had it SELECTED still gets a page.
//
// The landmine here is not the removal, it is the persistence. The active tab
// lives in localStorage ('filetube_music_tab'), and render() dispatches on the
// tab name with NO else-arm: on a device whose stored tab is 'liked', dropping
// the tab means no branch runs, #music-content is never written, and /music is
// a permanently blank page that survives every reload. (There is no ?tab= deep
// link to fall back from - re-derived, the plan's assumption; urlParams in
// music.js reads only 'play' and 'nowplaying'. The stale PREF is the whole
// exposure.)
//
// So this binds the fallback at its USE: the REAL init() is run against a jsdom
// music view with 'liked' already in storage, and the albums grid has to be on
// screen afterwards. The pure normalizer is tested too, but a green normalizer
// alone would be the decision-vs-use strike this repo keeps taking.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const { MUSIC_TABS, MUSIC_DEFAULT_TAB, normalizeMusicTab } = require('../../public/js/music.js');

// ---- the pure decision -------------------------------------------------------

test('v1.75: the tab roster is the three surviving tabs - Liked is not one of them', () => {
  assert.deepEqual(MUSIC_TABS, ['albums', 'artists', 'songs']);
  assert.equal(MUSIC_DEFAULT_TAB, 'albums');
  assert.ok(MUSIC_TABS.indexOf('liked') === -1);
});

test('v1.75: a remembered tab that no longer exists falls back to the default; real ones pass through', () => {
  assert.equal(normalizeMusicTab('liked'), 'albums', 'the retired tab is the case this exists for');
  for (const t of MUSIC_TABS) assert.equal(normalizeMusicTab(t), t, `${t} passes through untouched`);
  for (const junk of [null, undefined, '', 'nonsense', 0, {}, 'Albums']) {
    assert.equal(normalizeMusicTab(junk), 'albums', `${JSON.stringify(junk)} degrades to the default`);
  }
});

// ---- the removal ------------------------------------------------------------

test('v1.75 REMOVAL: the Liked tab is gone from the strip and from every render/query arm', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/music.html'), 'utf8');
  assert.ok(!html.includes('data-tab="liked"'), 'the tab button is gone from the strip');
  // `class="music-tab"` / `class="music-tab active"` - deliberately NOT
  // matching the `music-tabs` container that wraps them.
  assert.equal((html.match(/class="music-tab[" ]/g) || []).length, MUSIC_TABS.length, 'exactly one button per surviving tab');
  const src = fs.readFileSync(musicPath, 'utf8');
  assert.ok(!src.includes("tab === 'liked'"), 'no render/query arm still branches on the retired tab');
  assert.ok(!src.includes("ctx.filter = 'liked'"), "the liked filter no longer rides the music list's context");
});

test('v1.75 REMOVAL OVERREACH GUARD: the song-row heart still writes both directions', () => {
  // Ruling R1: the tab was the READ surface, the heart is the WRITE surface.
  const src = fs.readFileSync(musicPath, 'utf8');
  assert.ok(src.includes("fetch('/api/music/liked/' + encodeURIComponent(id), { method: 'DELETE' })"), 'unlike still calls the endpoint');
  assert.ok(src.includes("fetch('/api/music/liked/' + encodeURIComponent(id), { method: 'POST' })"), 'like still calls the endpoint');
  assert.ok(src.includes("btn.classList.toggle('liked', !liked)"), 'and the row still reflects the new state');
});

// ---- the USE: a real init() on a device that had the Liked tab selected -----

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
    <button type="button" class="music-tab" data-tab="artists" role="tab">Artists</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div class="music-crumb" id="music-crumb" hidden></div>
  <div id="music-status" role="status" hidden></div>
  <div id="music-content">SENTINEL-NOT-RENDERED</div>
  <div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Boots the REAL music view module against a jsdom document. music.js's IIFE
// self-registers only when `window` exists at load time, so the module cache is
// dropped and it is re-required inside the DOM.
async function bootMusicView(storedTab, fn) {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const saved = {
    window: global.window, document: global.document,
    localStorage: global.localStorage, fetch: global.fetch,
    AbortController: global.AbortController,
  };
  let registered = null;
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  // Same-realm controller: music.js registers listeners with `{ signal }`, and
  // jsdom rejects an AbortSignal minted in the Node realm.
  global.AbortController = dom.window.AbortController;
  dom.window.FileTube = { registerView: (name, mod) => { registered = mod; } };
  global.fetch = (url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).indexOf('/artists') >= 0 ? { items: [] } : { items: [] }),
  });
  if (storedTab !== null) dom.window.localStorage.setItem('filetube_music_tab', storedTab);
  try {
    delete require.cache[musicPath];
    require(musicPath);
    assert.ok(registered && typeof registered.init === 'function', 'music.js registered its view module');
    registered.init(dom.window.document.getElementById('view-root'));
    await settle();
    await settle();
    await fn(dom);
    registered.destroy();
  } finally {
    delete require.cache[musicPath];
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete global[k]; else global[k] = saved[k];
    }
    dom.window.close();
  }
  // Restore the plain Node-side module for the other tests in this file.
  require(musicPath);
}

test('v1.75 USE: a device whose stored tab is the RETIRED one still renders - it does not go blank', async () => {
  await bootMusicView('liked', (dom) => {
    const content = dom.window.document.getElementById('music-content');
    assert.ok(
      !content.innerHTML.includes('SENTINEL-NOT-RENDERED'),
      'nothing rendered: the stale tab hit no branch and /music is a blank page (the bug this guards)',
    );
    assert.match(content.innerHTML, /music-card-grid/, 'the default Albums grid rendered instead');
    const active = dom.window.document.querySelector('.music-tab.active');
    assert.equal(active.getAttribute('data-tab'), 'albums', 'and the strip highlights the tab that actually rendered');
  });
});

test('v1.75 USE: a stored tab that is still real is honoured (the fallback is not a blanket reset)', async () => {
  await bootMusicView('artists', (dom) => {
    const active = dom.window.document.querySelector('.music-tab.active');
    assert.equal(active.getAttribute('data-tab'), 'artists');
    assert.match(dom.window.document.getElementById('music-content').innerHTML, /music-artist-grid/);
  });
});

test('v1.75 USE: no stored tab at all renders the default', async () => {
  await bootMusicView(null, (dom) => {
    const active = dom.window.document.querySelector('.music-tab.active');
    assert.equal(active.getAttribute('data-tab'), 'albums');
  });
});
