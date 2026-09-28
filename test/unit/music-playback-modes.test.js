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
  assert.match(html, /id="music-loop-btn"[\s\S]{0,400}class="music-mode-lbl">Loop</, 'the Loop label span (relabelled to "Loop chapter" at runtime)');
  assert.match(html, /id="music-autoplay-btn"[^>]*aria-pressed=/, 'the Autoplay toggle is in music.html');
  // v1.284.1 -> UI pass S7 (D8.8; plan step 0 risky conversion): the ON state must READ as
  // selected - and red is no longer a selected colour. The toggles are ui-chip filter chips: ON is
  // ink on the tonal --fill-selected, LAYERED over the chip's ground, and it must still show in 2009
  // (v1.284.1's bug: an ON painted under the 2009 gloss). test/unit/ui-chip-selected.test.js
  // measures the ON-vs-OFF step in every era x mode and that no rule re-grounds a chip (a gloss
  // would hide the layer); here: the toggles are those chips and no red ON rule survives.
  for (const id of ['music-loop-btn', 'music-autoplay-btn']) {
    assert.match(html, new RegExp('<button class="ui-chip ui-chip--filter music-mode-btn" id="' + id + '"'), id + ' is a filter chip');
  }
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /\.music-mode-btn\[aria-pressed="true"\][^{]*\{[^}]*--yt-red/, 'no red ON state');
  assert.doesNotMatch(css, /\.music-mode-btn\[aria-pressed="true"\]/, 'no bespoke ON rule at all - the chip primitive is the look');
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

test('the toggles reflect on a COLD /music load with nothing playing', async () => {
  // Dean's exact case: land on /music with loop stuck ON from the phone and nothing playing, and
  // the pressed off-switch must still be visible. updateNowPlayingPanel() runs unconditionally at
  // the end of init() and calls reflectPlaybackModes() BEFORE its no-track/expanded early return,
  // so the toggles reflect even with no track. (There is no separate init paint - that redundant
  // line was removed; this call is the single seam. Moving the reflect below that early return
  // would red this test.)
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
