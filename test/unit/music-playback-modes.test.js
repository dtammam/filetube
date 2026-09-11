'use strict';

// [UNIT] v1.284 (Dean): the desktop music player gained Loop + Autoplay toggles (the two
// playback-MODE switches the mobile skin already had). Before, a loop turned on from the phone
// (the shared, cross-device-synced ft-loop setting) kept looping on desktop with NO off-switch.
// These drive the REAL init() with a mock player and assert the toggles reflect the live state,
// toggle the SAME player.setLoop / autoplay setting, and that Loop relabels to "Loop chapter"
// for a chaptered `::c` track (matching the mobile skin).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');

const musicPath = require.resolve('../../public/js/music.js');

test('music.html actually carries the Loop + Autoplay toggles in the toolbar (the behavioural boot uses its own HTML)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'music.html'), 'utf8');
  assert.match(html, /id="music-loop-btn"[^>]*aria-pressed=/, 'the Loop toggle is in music.html with an aria-pressed state');
  assert.match(html, /id="music-loop-btn"[\s\S]{0,140}class="music-mode-lbl">Loop</, 'the Loop label span (relabelled to "Loop chapter" at runtime)');
  assert.match(html, /id="music-autoplay-btn"[^>]*aria-pressed=/, 'the Autoplay toggle is in music.html');
  // the ON-state styling reuses the theatre toggle's token, not a raw literal (census stays 0).
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.music-mode-btn\[aria-pressed="true"\] \{ background: var\(--bg-secondary\); \}/, 'the pressed style uses the --bg-secondary token');
});

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div id="player-slot"></div>
  <div id="music-nowplaying-panel" hidden></div>
  <div class="music-toolbar-actions">
    <button id="music-loop-btn" type="button" aria-pressed="false"><span class="music-mode-lbl">Loop</span></button>
    <button id="music-autoplay-btn" type="button" aria-pressed="false">Autoplay</button>
    <button id="music-shuffle-btn" type="button">Shuffle</button>
  </div>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Boot the real init() once, with a mock player + a controllable loop store.
async function boot(url, playerState, run) {
  const saved = {
    window: global.window, document: global.document,
    localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController,
  };
  const setLoopCalls = [];
  const player = {
    currentId: playerState.currentId || null,
    state: playerState.state || 'full',
    _loop: !!playerState.loop,
    isLoopEnabled() { return this._loop; },
    setLoop(on) { setLoopCalls.push(on); this._loop = !!on; },
    getState() { return this.state; },
    getCurrentMeta() { return playerState.meta || null; },
    dock() { this.state = 'docked'; },
    expand() { this.state = 'full'; },
  };
  const dom = new JSDOM(VIEW_HTML, { url });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.AbortController = dom.window.AbortController;
  if (playerState.autoplayStored != null) {
    try { dom.window.localStorage.setItem('ft-music-autoplay', playerState.autoplayStored); } catch (_) { /* ignore */ }
  }
  global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
  let registered = null;
  dom.window.FileTube = {
    registerView: (name, mod) => { registered = mod; },
    player, shimmerArt: () => {}, pushViewState: () => {}, replaceViewState: () => {}, navigate: () => {},
  };
  try {
    delete require.cache[musicPath];
    require(musicPath);
    assert.ok(registered && typeof registered.init === 'function', 'view registered');
    registered.init(dom.window.document.getElementById('view-root'));
    await settle(); await settle();
    await run(dom, { player, setLoopCalls });
    registered.destroy();
  } finally {
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
}

test('the Loop button reflects the live loop state on init, and a click toggles player.setLoop', async () => {
  await boot('http://localhost/music', { loop: true, currentId: 's1', state: 'full' }, async (dom, { setLoopCalls }) => {
    const btn = dom.window.document.getElementById('music-loop-btn');
    assert.equal(btn.getAttribute('aria-pressed'), 'true', 'loop ON -> pressed (the off-switch is visible as engaged)');
    btn.click();
    assert.deepStrictEqual(setLoopCalls, [false], 'clicking an ON loop calls setLoop(false) - the desktop off-switch');
    assert.equal(btn.getAttribute('aria-pressed'), 'false', 'and the button reflects the new OFF state');
  });
});

test('a loop that is OFF reflects unpressed, and a click turns it ON', async () => {
  await boot('http://localhost/music', { loop: false, currentId: 's1', state: 'full' }, async (dom, { setLoopCalls }) => {
    const btn = dom.window.document.getElementById('music-loop-btn');
    assert.equal(btn.getAttribute('aria-pressed'), 'false', 'loop OFF -> unpressed');
    btn.click();
    assert.deepStrictEqual(setLoopCalls, [true], 'setLoop(true)');
  });
});

test('the Loop button relabels to "Loop chapter" for a chaptered ::c track (matches the mobile skin)', async () => {
  await boot('http://localhost/music', { loop: true, currentId: 'vid::c2', state: 'full' }, async (dom) => {
    const btn = dom.window.document.getElementById('music-loop-btn');
    assert.equal(btn.querySelector('.music-mode-lbl').textContent, 'Loop chapter', 'a ::c track -> "Loop chapter"');
    assert.equal(btn.getAttribute('aria-label'), 'Loop chapter', 'aria-label tracks the label');
  });
  await boot('http://localhost/music', { loop: true, currentId: 'song1', state: 'full' }, async (dom) => {
    const btn = dom.window.document.getElementById('music-loop-btn');
    assert.equal(btn.querySelector('.music-mode-lbl').textContent, 'Loop', 'a normal track -> plain "Loop"');
  });
});

test('the toggles reflect on a COLD /music load with nothing playing (the init paint, not the panel update)', async () => {
  // no expanded track -> updateNowPlayingPanel early-returns before it could reflect, so the
  // explicit init paint is what surfaces a stuck loop the user needs to turn OFF. This is Dean's
  // exact case: land on /music, loop stuck on from the phone, need the off-switch visible.
  await boot('http://localhost/music', { loop: true, currentId: null, state: 'closed', autoplayStored: '0' }, async (dom) => {
    assert.equal(dom.window.document.getElementById('music-loop-btn').getAttribute('aria-pressed'), 'true', 'stuck loop shows pressed even with no track');
    assert.equal(dom.window.document.getElementById('music-autoplay-btn').getAttribute('aria-pressed'), 'false', 'autoplay OFF reflected with no track');
  });
});

test('the Autoplay button reflects the stored setting (default ON) and toggles it', async () => {
  // default: no stored value -> autoplayEnabled() is true
  await boot('http://localhost/music', { currentId: 's1', state: 'full' }, async (dom) => {
    const btn = dom.window.document.getElementById('music-autoplay-btn');
    assert.equal(btn.getAttribute('aria-pressed'), 'true', 'autoplay defaults ON');
    btn.click();
    assert.equal(dom.window.localStorage.getItem('ft-music-autoplay'), '0', 'click turns it OFF (stored 0)');
    assert.equal(btn.getAttribute('aria-pressed'), 'false', 'and the button reflects OFF');
  });
  // stored OFF -> reflects OFF
  await boot('http://localhost/music', { currentId: 's1', state: 'full', autoplayStored: '0' }, async (dom) => {
    const btn = dom.window.document.getElementById('music-autoplay-btn');
    assert.equal(btn.getAttribute('aria-pressed'), 'false', 'stored 0 -> unpressed');
  });
});
