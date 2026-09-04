'use strict';

// [UNIT] v1.246 (Dean): the SHARED mobile-skin engine (public/js/skin-surface.js) that drives
// podcasts on the iPod/Apple/Spotify skin. Proves the engine is REACHABLE and its ported logic
// works end-to-end (anti-inert): paint renders the chosen skin into a panel from a supplied ctx;
// the transport buttons PROXY to the hidden host controls (#pp-btn / #track-prev/next-btn /
// #seek-bar); the click-wheel moves the list cursor and SELECT fires the view's onSelectIndex;
// reflect() syncs the progress fill from the live element; destroy() clears body.mms-on (the
// v1.227 leak guard). jsdom has no layout (the gesture ANGLE math + DOM bookkeeping are what we
// exercise; scroll/marquee are device-verified), mirroring music-skin-integration.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');

// A minimal host: the hidden controls the skin proxies to + a panel to render into.
const HTML = `<body>
  <video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" />
  <div id="panel" class="music-nowplaying-panel" hidden></div>
</body>`;

function bootEngine({ onSelect, onDock, skin, engineCfg } = {}) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/podcasts' });
  const saved = { window: global.window, document: global.document, performance: global.performance, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document;
  global.Event = dom.window.Event; // so the engine's `new Event('change')` is same-realm as the jsdom seek-bar
  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  // load the pure skin registry + the engine into this window (both dual-export)
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const spy = { select: [], dock: 0 };
  const ctx = {
    track: { title: 'Ep 3', artist: 'The Show', album: 'The Show', artUrl: '/podcastart/sub1' },
    upNext: rows(), fullList: rows(), playing: false, posSec: 0, durSec: 300,
    posLabel: '0:00', remLabel: '-5:00', curNum: 3, total: 5,
  };
  const engine = dom.window.FileTubeSkinSurface.create(Object.assign({
    panel: dom.window.document.getElementById('panel'),
    getSkinId: () => skin || 'ipod',
    getCtx: () => ctx,
    hostCtl: (id) => dom.window.document.getElementById(id),
    onSelectIndex: (i) => { spy.select.push(i); if (onSelect) onSelect(i); },
    onDock: () => { spy.dock += 1; if (onDock) onDock(); },
    win: dom.window,
  }, engineCfg || {}));
  return { dom, engine, spy, ctx, restore: () => Object.assign(global, saved) };
}
function rows() {
  return [0, 1, 2, 3, 4].map((i) => ({ index: i, title: 'Ep ' + i, artist: 'The Show', durLabel: '5:00',
    state: i < 2 ? 'played' : (i === 2 ? 'current' : 'next') }));
}
const panel = (dom) => dom.window.document.getElementById('panel');

// the same synthetic-spin helper shape music-skin-integration uses.
function spin(wheel, dom, angles) {
  const at = (deg) => { const rad = deg * Math.PI / 180; return { clientX: 100 * Math.cos(rad), clientY: 100 * Math.sin(rad) }; };
  const s = at(0);
  wheel.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: s.clientX, clientY: s.clientY }));
  angles.forEach((deg) => { const q = at(deg); wheel.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: q.clientX, clientY: q.clientY })); });
  wheel.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
}

test('engine creates only when music-skins.js is present (graceful null otherwise)', () => {
  const dom = new JSDOM(HTML);
  const saved = global.window; global.window = dom.window;
  delete require.cache[surfacePath]; require(surfacePath);
  // no FileTubeMusicSkins on this window -> create returns null (no crash)
  const eng = dom.window.FileTubeSkinSurface.create({ panel: dom.window.document.getElementById('panel') });
  assert.strictEqual(eng, null, 'no skin registry -> null engine (podcasts.js guards on this)');
  global.window = saved;
});

test('paint renders the chosen skin into the panel (reachable: mms-full + the iPod wheel)', () => {
  const { dom, engine, restore } = bootEngine();
  try {
    engine.paint();
    const p = panel(dom);
    assert.ok(p.classList.contains('mms-full'), 'panel became the full-screen skin');
    assert.ok(p.classList.contains('mms-ipod'), 'the chosen (ipod) skin id class is on');
    assert.ok(p.querySelector('.ip-wheel'), 'the click-wheel rendered');
    assert.strictEqual(p.hidden, false, 'panel is shown');
  } finally { restore(); }
});

test('transport buttons PROXY to the hidden host controls (play -> #pp-btn, next -> #track-next-btn)', () => {
  const { dom, engine, restore } = bootEngine();
  try {
    engine.paint();
    let pp = 0, next = 0;
    dom.window.document.getElementById('pp-btn').addEventListener('click', () => { pp += 1; });
    dom.window.document.getElementById('track-next-btn').addEventListener('click', () => { next += 1; });
    panel(dom).querySelector('[data-skin-play]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    panel(dom).querySelector('[data-skin-next]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(pp, 1, 'the skin play button clicked the hidden #pp-btn');
    assert.strictEqual(next, 1, 'the skin next button clicked the hidden #track-next-btn');
  } finally { restore(); }
});

test('SELECT opens the list, a wheel spin moves the cursor, SELECT again fires onSelectIndex (the view playAt)', () => {
  const { dom, engine, spy, restore } = bootEngine();
  try {
    engine.paint();
    const p = panel(dom);
    // center Select opens the song list
    p.querySelector('[data-skin-select]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.ok(engine.isListMode(), 'Select opened the episode list');
    // spin clockwise -> the cursor moves down from the seeded current (index 2)
    spin(p.querySelector('.ip-wheel'), dom, [40, 80, 120, 160]);
    const cursor = p.querySelector('.ip-listview .mms-row.is-cursor');
    assert.ok(cursor, 'a row is the cursor after the spin');
    assert.ok(parseInt(cursor.getAttribute('data-skin-go'), 10) > 2, 'clockwise moved the cursor forward');
    // Select plays the cursor row via onSelectIndex, and returns to Now Playing. A real tap fires
    // a fresh pointerdown first, which clears the spin's one-shot click-suppress flag (as on device).
    p.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }));
    p.querySelector('[data-skin-select]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.ok(!engine.isListMode(), 'Select returned to Now Playing');
    assert.strictEqual(spy.select.length, 1, 'onSelectIndex fired exactly once (the podcasts playAt)');
    assert.ok(spy.select[0] > 2, 'it played the cursor position the wheel landed on');
  } finally { restore(); }
});

test('a direct row tap (data-skin-go) plays that index via onSelectIndex', () => {
  const { dom, engine, spy, restore } = bootEngine();
  try {
    engine.paint();
    engine.setListMode(true);
    const row = panel(dom).querySelector('.ip-listview .mms-row[data-skin-go="4"]');
    row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.deepStrictEqual(spy.select, [4], 'tapping episode row 4 played index 4');
  } finally { restore(); }
});

test('the iPod MENU from Now Playing DOCKS (never closes) - onDock fires', () => {
  const { dom, engine, spy, restore } = bootEngine();
  try {
    engine.paint(); // Now Playing (not list mode) -> MENU docks
    panel(dom).querySelector('[data-skin-menu]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(spy.dock, 1, 'MENU from Now Playing docked the player');
  } finally { restore(); }
});

test('reflect() syncs the fill AND FLIPS the iPod play indicator from the LIVE element', () => {
  const { dom, engine, restore } = bootEngine({ skin: 'ipod' });
  try {
    engine.paint();
    const mp = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'duration', { value: 200, configurable: true });
    Object.defineProperty(mp, 'currentTime', { value: 100, configurable: true });
    let paused = false; Object.defineProperty(mp, 'paused', { configurable: true, get: () => paused });
    engine.reflect();
    const p = panel(dom);
    assert.strictEqual(p.querySelector('.mms-fill').style.width, '50%', 'reflect set the fill to 100/200 = 50%');
    const pind = p.querySelector('.mms-playind');
    assert.ok(pind, 'the iPod status-bar play indicator exists');
    assert.strictEqual(pind.textContent, '▶', 'playing -> play triangle');
    paused = true; engine.reflect();
    assert.strictEqual(pind.textContent, '❚❚', 'paused -> pause bars (non-vacuous: the indicator actually flipped)');
  } finally { restore(); }
});

test('reflect() SWAPS the play-button GLYPH on the default Apple skin (adversarial W1: icon, not just a class)', () => {
  const { dom, engine, restore } = bootEngine({ skin: 'apple' });
  try {
    engine.paint();
    const mp = dom.window.document.getElementById('media-player');
    let paused = true; Object.defineProperty(mp, 'paused', { configurable: true, get: () => paused });
    engine.reflect();
    const btn = panel(dom).querySelector('.mms-play');
    assert.ok(btn, 'the Apple skin renders a real .mms-play glyph button');
    assert.match(btn.innerHTML, /M8 5v14/, 'paused -> the PLAY triangle glyph shows');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Play');
    paused = false; engine.reflect();
    assert.match(btn.innerHTML, /M6 5h4v14/, 'playing -> the PAUSE bars glyph shows (the icon ACTUALLY changed, not just a class)');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Pause');
  } finally { restore(); }
});

test('a moved spin SWALLOWS exactly its release click (the v1.233 suppress guard, now bound)', () => {
  const { dom, engine, restore } = bootEngine({ skin: 'ipod' });
  try {
    engine.paint();
    engine.setListMode(true); // a spin here is a cursor move -> moved=true -> arms the suppress flag
    let pp = 0;
    dom.window.document.getElementById('pp-btn').addEventListener('click', () => { pp += 1; });
    spin(panel(dom).querySelector('.ip-wheel'), dom, [40, 80, 120]);
    // the synthetic release click on a transport zone must be swallowed (no phantom play/pause)
    panel(dom).querySelector('[data-skin-play]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(pp, 0, 'the spin-ending click was suppressed');
    // a FRESH tap (its own pointerdown clears the one-shot flag) proceeds normally
    panel(dom).dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
    panel(dom).querySelector('[data-skin-play]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(pp, 1, 'a fresh tap after the spin proceeds (the flag was one-shot)');
  } finally { restore(); }
});

test('a Now-Playing wheel spin SCRUBS the live element (not the list) and commits on pointerup', () => {
  const { dom, engine, restore } = bootEngine();
  try {
    engine.paint(); // NOT in list mode -> scrub mode
    const mp = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'duration', { value: 300, configurable: true });
    let ct = 150; Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => ct, set: (v) => { ct = v; } });
    let committed = 0;
    dom.window.document.getElementById('seek-bar').addEventListener('change', () => { committed += 1; });
    spin(panel(dom).querySelector('.ip-wheel'), dom, [40, 80, 120, 160]); // clockwise
    assert.ok(ct > 150, 'the clockwise spin scrubbed the playhead forward (live)');
    assert.strictEqual(committed, 1, 'pointerup committed the scrub through #seek-bar once');
    assert.strictEqual(panel(dom).querySelector('.ip-listview .mms-row.is-cursor'), null, 'no list cursor - this was a scrub, not a cursor move');
  } finally { restore(); }
});

test('podcasts.js WIRES the engine (reachable): creates it with a podcast ctx, forks the panel on the gate, and tears it down on destroy', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'podcasts.js'), 'utf8');
  // creates the shared engine, driven by the podcast ctx + playAt select hook
  // v1.251 (R3): the config is a BUILDER shared by the in-tab panel and the pop-out shell.
  assert.match(src, /window\.FileTubeSkinSurface\.create\(podcastEngineConfig\(nowPlayingPanel, window\)\)/, 'podcasts creates the shared skin engine via its config builder');
  assert.match(src, /getCtx: podcastSkinCtx/, 'driven by the PODCAST ctx (episode list, /podcastart art)');
  assert.match(src, /createPopoutShell\(\{[\s\S]{0,400}engineConfigFor: function \(panel, winRef\) \{ return podcastEngineConfig\(panel, winRef\); \}/, 'and the pop-out shell rides the SAME builder (v1.251 R3)');
  assert.match(src, /onSelectIndex: function \(i\) \{ playAt\(i\); \}/, 'the wheel/select play hook is the podcasts playAt');
  assert.match(src, /artUrl: artSub \? \('\/podcastart\/'/, 'the ctx art is the show art (/podcastart)');
  // the updateNowPlayingPanel fork: mount the skin on the gate, and teardown clears mms-on
  assert.match(src, /if \(skinActive\(\) && skinEngine\) \{[\s\S]{0,120}skinEngine\.paint\(\);/, 'on mobile+podcast the panel BECOMES the skin');
  assert.match(src, /skinEngine.*document\.body\.classList\.remove\('mms-on'\)/, 'the teardown branch clears the full-screen body class (v1.227 leak guard)');
  // destroy tears the skin down (module-scoped handle) so a view swap never strands mms-on
  assert.match(src, /activeSkinEngine\.destroy\(\)/, 'destroy() tears the skin engine down');
  // v1.250 (F-UNIFY ride-along): the deferred v1.246 polish is ON for podcasts - the sticker
  // quick-menu (speed/loop/skin) and hold-to-fast-scan - but NEVER the Extras page (podcasts
  // keep their own episode actions, the locked v1.249 intake). The engine behaviors are bound
  // above/in U1-U2; this locks the podcast WIRING that makes them reachable.
  assert.match(src, /fastScan: true/, 'podcasts enable hold-to-fast-scan');
  assert.match(src, /sticker: \{[\s\S]{0,400}onSkinChange: function \(\) \{ updateNowPlayingPanel\(\); \}/, 'podcasts enable the sticker quick-menu with the repaint hook');
  const stickerBlock = /sticker: \{([\s\S]*?)\n {8}\},/.exec(src);
  assert.ok(stickerBlock, 'the podcast sticker config block parses');
  assert.ok(!/extras/.test(stickerBlock[1]), 'NO extras hooks - podcasts keep their own actions');
  // and skin-surface.js is loaded on the podcasts shell (before podcasts.js, after music-skins.js)
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'podcasts.html'), 'utf8');
  assert.match(html, /music-skins\.js"><\/script>\s*<script src="\/js\/skin-surface\.js"/, 'skin-surface.js loads after music-skins.js on podcasts.html');
});

test('adversarial W1 (v1.250): a FOREIGN-window surface still shimmers its art via the MAIN window FileTube', () => {
  // The pop-out is a blank scriptless window - win.FileTube is undefined there. shimmerArt
  // works cross-document (panel.querySelectorAll), so paint must call the MAIN window's, the
  // way music.js's deleted paintSkin always did; the port briefly read win.FileTube and a
  // slow/404 cover would shimmer forever in an always-on-top window.
  const pipDom = new JSDOM('<body><div id="panel" class="music-nowplaying-panel"></div></body>', { url: 'http://localhost/pip' });
  const { dom, engine, restore } = bootEngine(); // establishes global.window/document = the MAIN dom
  try {
    const shimmered = [];
    dom.window.FileTube = { shimmerArt: (p) => { shimmered.push(p); } };
    assert.strictEqual(pipDom.window.FileTube, undefined, 'the foreign window really has no FileTube (non-vacuous)');
    const eng2 = dom.window.FileTubeSkinSurface.create({
      panel: pipDom.window.document.getElementById('panel'),
      getSkinId: () => 'ipod', getCtx: () => ({ track: {}, upNext: [], fullList: [] }),
      hostCtl: (id) => dom.window.document.getElementById(id),
      win: pipDom.window,
    });
    eng2.paint();
    assert.strictEqual(shimmered.length, 1, 'the MAIN window shimmerArt ran for the foreign panel');
    assert.strictEqual(shimmered[0], pipDom.window.document.getElementById('panel'), 'with the pop-out panel (cross-document reveal)');
    eng2.destroy();
    engine.destroy();
  } finally { restore(); }
});

test('v1.251 (adversarial W5): buildPanelHtml ESCAPES row title/artist/artUrl - feed prose in an innerHTML sink, locked at the moved code', () => {
  // The builder moved files this wave - exactly when escapes get dropped. Hostile podcast
  // feed values through every row field; the meta escapes are bound in music-view.test.js.
  const api = require('../../public/js/skin-surface.js');
  const html = api.buildPanelHtml({ title: 'Show', subline: 'sub' }, [{
    id: 'e1',
    artUrl: '/podcastart/x"><img src=x onerror=alert(1)>',
    title: '<script>evil()</script>',
    artist: '"><b>bold</b>',
    index: 0,
    state: 'current',
  }]);
  assert.ok(html.indexOf('<script>') === -1, 'the raw <script> never lands');
  assert.ok(html.indexOf('<img src=x') === -1, 'the artUrl cannot break out of the src attribute');
  assert.ok(html.indexOf('<b>bold</b>') === -1, 'the artist markup never lands');
  assert.ok(html.indexOf('&lt;script&gt;') !== -1, 'the title renders as escaped text');
  assert.ok(html.indexOf('&quot;&gt;&lt;img') !== -1, 'the artUrl quote is entity-escaped inside src');
});

test('SHELL PARITY (v1.250 gate CRITICAL): every shell that ships music-skins.js ships skin-surface.js right after it', () => {
  // The SPA soft-nav lazy-loads music.js/podcasts.js into WHATEVER shell the user cold-loaded
  // (common.js VIEW_SCRIPT_SRC), so the engine must be present wherever the skin registry is -
  // else the mobile skin silently regresses to the default panel on the most common phone path
  // (home shell -> Music). The QA seat caught exactly that: eight shells carried music-skins.js
  // without the engine. Enumerate the REAL shell set every run, never a hardcoded list.
  const fs = require('node:fs');
  const path = require('node:path');
  const pub = path.join(__dirname, '..', '..', 'public');
  const shells = fs.readdirSync(pub).filter((f) => f.endsWith('.html'));
  assert.ok(shells.length >= 10, 'the shell enumeration found the real set (not an empty dir)');
  let checked = 0;
  for (const f of shells) {
    const html = fs.readFileSync(path.join(pub, f), 'utf8');
    if (!/music-skins\.js/.test(html)) continue;
    checked += 1;
    assert.match(html, /music-skins\.js"><\/script>\s*<script src="\/js\/skin-surface\.js"><\/script>/,
      f + ': skin-surface.js must load immediately after music-skins.js');
  }
  assert.ok(checked >= 10, 'the parity check actually covered the shells that ship the registry (found ' + checked + ')');
});

// ---- U1 (F-UNIFY v1.250): the engine capabilities ported from music.js ----

test('U1 marquee: an overflowing title gets the .mms-mq span + CSS vars after paint; marquee:false stays inert', async () => {
  const tick = () => new Promise((r) => setTimeout(r, 1));
  // default (marquee on)
  {
    const { dom, engine, restore } = bootEngine();
    try {
      engine.paint();
      const ttl = panel(dom).querySelector('.ip-ttl');
      assert.ok(ttl, 'the iPod title line rendered');
      // jsdom has no layout: fake the overflow the rAF measurement reads
      Object.defineProperty(ttl, 'scrollWidth', { value: 300, configurable: true });
      Object.defineProperty(ttl, 'clientWidth', { value: 100, configurable: true });
      await tick(); // the harness maps rAF -> setTimeout(0)
      const mq = ttl.querySelector('.mms-mq');
      assert.ok(mq, 'overflow -> the marquee span wrapped the text');
      assert.strictEqual(mq.textContent, 'Ep 3', 'textContent both ways (no injection)');
      assert.ok(ttl.classList.contains('mms-mq-on'));
      assert.strictEqual(ttl.style.getPropertyValue('--mms-mq-shift'), '-200px', 'shift = -(overflow)');
      assert.ok(parseFloat(ttl.style.getPropertyValue('--mms-mq-dur')) >= 4, 'constant-speed duration set');
    } finally { restore(); }
  }
  // marquee: false -> no wrap even with overflow
  {
    const { dom, engine, restore } = bootEngine({ engineCfg: { marquee: false } });
    try {
      engine.paint();
      const ttl = panel(dom).querySelector('.ip-ttl');
      Object.defineProperty(ttl, 'scrollWidth', { value: 300, configurable: true });
      Object.defineProperty(ttl, 'clientWidth', { value: 100, configurable: true });
      await tick();
      assert.strictEqual(ttl.querySelector('.mms-mq'), null, 'marquee:false is inert');
    } finally { restore(); }
  }
  // a NON-overflowing line is never wrapped (the ellipsis stays)
  {
    const { dom, engine, restore } = bootEngine();
    try {
      engine.paint();
      const ttl = panel(dom).querySelector('.ip-ttl');
      Object.defineProperty(ttl, 'scrollWidth', { value: 100, configurable: true });
      Object.defineProperty(ttl, 'clientWidth', { value: 100, configurable: true });
      await tick();
      assert.strictEqual(ttl.querySelector('.mms-mq'), null, 'no overflow -> no marquee');
    } finally { restore(); }
  }
});

test('U1 wheel-volume is GONE (Dean 2026-09-02): a Now-Playing spin SCRUBS on every surface and never touches volume', () => {
  // Binds the ruling that retired music.js's v1.235 pop-out wheel-volume: there is no
  // allowVolume config, the spin scrubs, and media.volume stays put.
  const { dom, engine, restore } = bootEngine({ engineCfg: { allowVolume: true } }); // even a stale flag is inert
  try {
    engine.paint();
    const mp = dom.window.document.getElementById('media-player');
    mp.volume = 0.5;
    Object.defineProperty(mp, 'duration', { value: 300, configurable: true });
    let ct = 150; Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => ct, set: (v) => { ct = v; } });
    spin(panel(dom).querySelector('.ip-wheel'), dom, [40, 80, 120]);
    assert.ok(ct > 150, 'the spin scrubbed the playhead');
    assert.strictEqual(mp.volume, 0.5, 'volume untouched (wheel-volume retired)');
    assert.ok(!panel(dom).classList.contains('mms-voladj'), 'the volume bar never engages');
  } finally { restore(); }
});

// drive the fastScan hold deterministically: the engine arms timers on the PANEL's window,
// so the test replaces that window's timer fns with manual-fire fakes BEFORE the press.
function fakeWinTimers(dom) {
  const t = { timeouts: [], intervals: [] };
  dom.window.setTimeout = (fn) => { t.timeouts.push(fn); return t.timeouts.length; };
  dom.window.clearTimeout = (id) => { t.timeouts[id - 1] = null; };
  dom.window.setInterval = (fn) => { t.intervals.push(fn); return t.intervals.length; };
  dom.window.clearInterval = (id) => { t.intervals[id - 1] = null; };
  return t;
}

test('U1 fastScan: HOLDING the ffwd zone scans ~2x, release commits via #seek-bar and swallows the skip click', () => {
  const { dom, engine, restore } = bootEngine({ engineCfg: { fastScan: true } });
  try {
    engine.paint();
    const timers = fakeWinTimers(dom);
    const mp = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'duration', { value: 300, configurable: true });
    let ct = 100; Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => ct, set: (v) => { ct = v; } });
    let committed = []; let nextClicks = 0;
    dom.window.document.getElementById('seek-bar').addEventListener('change', (e) => { committed.push(e.target.value); });
    dom.window.document.getElementById('track-next-btn').addEventListener('click', () => { nextClicks += 1; });
    const zone = panel(dom).querySelector('.ip-wheel [data-skin-next]') || panel(dom).querySelector('[data-skin-next]');
    zone.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 0 }));
    assert.strictEqual(timers.timeouts.length, 1, 'the hold timer armed on the panel window');
    timers.timeouts[0](); // the 400ms hold fires -> scan engages
    assert.ok(Math.abs(ct - 100.4) < 1e-9, 'the hold stepped immediately (+0.4s)');
    assert.strictEqual(timers.intervals.length, 1, 'the scan interval armed');
    timers.intervals[0](); timers.intervals[0]();
    assert.ok(Math.abs(ct - 101.2) < 1e-9, 'each tick steps +0.4s (~2x realtime at 200ms)');
    zone.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    assert.strictEqual(committed.length, 1, 'pointerup committed exactly once through the seek pipeline');
    assert.ok(Math.abs(parseFloat(committed[0]) - (101.2 / 300)) < 1e-6, 'the committed ratio is the landed position (101.2/300)');
    // the release's synthetic click on the zone must NOT also skip the track
    zone.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(nextClicks, 0, 'the post-scan click was suppressed (no phantom skip)');
  } finally { restore(); }
});

test('U1 fastScan: a quick TAP still skips (hold never fires), and a ROTATE cancels the pending hold', () => {
  const { dom, engine, restore } = bootEngine({ engineCfg: { fastScan: true } });
  try {
    engine.paint();
    const timers = fakeWinTimers(dom);
    const mp = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'duration', { value: 300, configurable: true });
    let ct = 100; Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => ct, set: (v) => { ct = v; } });
    let nextClicks = 0;
    dom.window.document.getElementById('track-next-btn').addEventListener('click', () => { nextClicks += 1; });
    const zone = panel(dom).querySelector('.ip-wheel [data-skin-next]') || panel(dom).querySelector('[data-skin-next]');
    // quick tap: down -> up before the hold timer fires -> the zone's click skips normally
    zone.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 0 }));
    zone.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    zone.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(nextClicks, 1, 'a quick tap still skips the track');
    // rotate after pressing the zone: the hold is cancelled, the gesture is a scrub, never a scan
    zone.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    const wheel = panel(dom).querySelector('.ip-wheel');
    wheel.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 70, clientY: 70 }));
    const held = timers.timeouts.filter(Boolean);
    if (held.length) held.forEach((fn) => fn()); // firing a survived hold must NOT scan (moved guard)
    assert.strictEqual(timers.intervals.length, 0, 'no scan interval after a rotate (the hold was cancelled/inert)');
    wheel.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
  } finally { restore(); }
});

test('U1 onShuffle: the [data-skin-shuffle] zone fires the hook; without the hook it falls through harmlessly', () => {
  // with the hook
  {
    const { dom, engine, restore } = bootEngine({ engineCfg: { onShuffle: null } });
    try {
      let shuffles = 0;
      const eng2 = dom.window.FileTubeSkinSurface.create({
        panel: panel(dom), getSkinId: () => 'ipod', getCtx: () => ({ track: {}, upNext: [], fullList: [] }),
        hostCtl: (id) => dom.window.document.getElementById(id), win: dom.window,
        onShuffle: () => { shuffles += 1; },
      });
      eng2.paint();
      const btn = dom.window.document.createElement('button');
      btn.setAttribute('data-skin-shuffle', '');
      panel(dom).appendChild(btn);
      btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.strictEqual(shuffles, 1, 'the shuffle zone drove the view hook');
      eng2.destroy();
      engine.destroy();
    } finally { restore(); }
  }
  // without the hook: no crash, no proxy
  {
    const { dom, engine, restore } = bootEngine();
    try {
      engine.paint();
      const btn = dom.window.document.createElement('button');
      btn.setAttribute('data-skin-shuffle', '');
      panel(dom).appendChild(btn);
      btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); // must not throw
      assert.ok(true);
    } finally { restore(); }
  }
});

// ---- U2 (F-UNIFY v1.250): the sticker quick-menu + Extras, now ENGINE capabilities ----

// bootEngine + the sticker's collaborators: a recorded fetch map, the shared common.js flow
// stubs on the window, and a player facade with loop/close/getCurrentTime.
function bootSticker({ extras, eligible, video, skin } = {}) {
  const calls = []; const toasts = []; const spy = { skinChange: 0, mutated: 0, setLoop: [], closed: 0 };
  const state = { loop: false };
  const savedFetch = global.fetch;
  const boot = bootEngine({
    skin,
    engineCfg: {
      sticker: {
        onSkinChange: () => { spy.skinChange += 1; },
        getPlayer: () => ({
          isLoopEnabled: () => state.loop,
          setLoop: (on) => { state.loop = !!on; spy.setLoop.push(!!on); },
          close: () => { spy.closed += 1; },
        }),
        extras: extras === false ? undefined : {
          getBaseId: () => 's1',
          isEligible: () => (eligible !== false),
          onMutated: () => { spy.mutated += 1; },
          signal: new AbortController().signal,
        },
      },
    },
  });
  const { dom } = boot;
  dom.window.showToast = (m) => toasts.push(String(m));
  dom.window.fetchCurrentUser = () => Promise.resolve({ user: { role: 'admin' } });
  dom.window.fetchLikedTotal = () => Promise.resolve(0);
  dom.window.isYtdlpManagedItem = (it) => !!(it && it.channelName);
  dom.window.showConfirmModal = (t, b, onConfirm) => { spy.confirm = { t, b, onConfirm }; };
  dom.window.showHardDeleteModal = (it, onConfirm) => { spy.hard = { it, onConfirm }; };
  dom.window.deleteResultToast = () => 'deleted-toast';
  global.fetch = (url, init) => {
    const u = String(url); const method = (init && init.method) || 'GET';
    calls.push({ url: u, method });
    if (/^\/api\/videos\/s1$/.test(u) && method === 'GET') {
      const body = video === null ? null : Object.assign({
        id: 's1', title: 'Song One', filePath: '/m/s1.mp3', watchUrl: 'https://www.youtube.com/watch?v=x', hasSubtitles: true,
        liked: false, watchState: 'unwatched', channelName: 'The Band',
      }, video || {});
      return Promise.resolve(body ? { ok: true, json: async () => body } : { ok: false, status: 404, json: async () => ({}) });
    }
    if (method === 'DELETE' && u.indexOf('/api/videos/') === 0) return Promise.resolve({ status: 200, json: async () => ({ success: true }) });
    if (u.indexOf('/api/ytdlp/repull-metadata/item/') === 0) return Promise.resolve({ status: 202, json: async () => ({}) });
    if (u === '/api/subscriptions/status') return Promise.resolve({ ok: true, json: async () => ({ oneShots: { 'repull-metadata-item': { state: 'running', mediaId: 's1' } } }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };
  const settle2 = () => new Promise((r) => setImmediate(r));
  return Object.assign(boot, {
    calls, toasts, spy, state, settle: settle2,
    restoreAll: () => { global.fetch = savedFetch; boot.restore(); },
  });
}
const sClick = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const sMenu = (dom) => panel(dom).querySelector('[data-skin-sticker-menu]');

test('U2 sticker: absent without config (podcasts today); with config it paints, toggles, and drives speed/loop/skin', async () => {
  // default engine (no sticker config) -> no sticker markup at all
  {
    const { dom, engine, restore } = bootEngine();
    try {
      engine.paint();
      assert.strictEqual(panel(dom).querySelector('[data-skin-sticker]'), null, 'no config -> no sticker');
    } finally { restore(); }
  }
  const b = bootSticker({ extras: false });
  try {
    b.engine.paint();
    const st = panel(b.dom).querySelector('[data-skin-sticker]');
    assert.ok(st, 'sticker painted');
    assert.strictEqual(sMenu(b.dom).hidden, true, 'menu starts hidden');
    sClick(b.dom, st);
    assert.strictEqual(sMenu(b.dom).hidden, false, 'sticker tap opened the menu');
    // speed drives the REAL element (both rate properties + persisted ft-rate)
    const mp = b.dom.window.document.getElementById('media-player');
    sClick(b.dom, sMenu(b.dom).querySelector('[data-skin-speed="1.5"]'));
    assert.strictEqual(mp.playbackRate, 1.5, 'playbackRate set');
    assert.strictEqual(mp.defaultPlaybackRate, 1.5, 'defaultPlaybackRate set (the survives-a-load carry, v1.238 CRITICAL)');
    assert.strictEqual(b.dom.window.localStorage.getItem('ft-rate'), '1.5', 'ft-rate persisted');
    // loop proxies the player facade
    sClick(b.dom, sMenu(b.dom).querySelector('[data-skin-loop]'));
    assert.deepStrictEqual(b.spy.setLoop, [true], 'loop toggle drove player.setLoop(true)');
    // skin pick: setActiveSkin persists + the view re-render hook fires
    sClick(b.dom, sMenu(b.dom).querySelector('[data-skin-pick="apple"]'));
    assert.strictEqual(b.dom.window.localStorage.getItem('ft-music-skin'), 'apple', 'SKINS.setActiveSkin persisted the pick');
    assert.strictEqual(b.spy.skinChange, 1, 'onSkinChange fired (the view repaints its surfaces)');
  } finally { b.restoreAll(); }
});

test('U2 extras entry: requires the hooks AND eligibility AND the main document', () => {
  // sticker without extras hooks (the podcasts shape) -> no Extras entry
  {
    const b = bootSticker({ extras: false });
    try {
      b.engine.paint();
      sClick(b.dom, panel(b.dom).querySelector('[data-skin-sticker]'));
      assert.ok(sMenu(b.dom).querySelector('[data-skin-speed]'), 'quick controls render');
      assert.strictEqual(sMenu(b.dom).querySelector('[data-skin-extras]'), null, 'no extras hooks -> no entry');
    } finally { b.restoreAll(); }
  }
  // hooks + eligible -> entry present; hooks + NOT eligible -> absent
  {
    const b = bootSticker({});
    try {
      b.engine.paint();
      sClick(b.dom, panel(b.dom).querySelector('[data-skin-sticker]'));
      assert.ok(sMenu(b.dom).querySelector('[data-skin-extras]'), 'eligible -> the Extras entry shows');
    } finally { b.restoreAll(); }
  }
  {
    const b = bootSticker({ eligible: false });
    try {
      b.engine.paint();
      sClick(b.dom, panel(b.dom).querySelector('[data-skin-sticker]'));
      assert.strictEqual(sMenu(b.dom).querySelector('[data-skin-extras]'), null, 'view says ineligible -> no entry');
    } finally { b.restoreAll(); }
  }
});

test('U2 extras page: opens with the /api/videos fetch, renders the gated action set, Like fires the real endpoint', async () => {
  const b = bootSticker({});
  try {
    b.engine.paint();
    sClick(b.dom, panel(b.dom).querySelector('[data-skin-sticker]'));
    sClick(b.dom, sMenu(b.dom).querySelector('[data-skin-extras]'));
    for (let i = 0; i < 6; i++) await b.settle();
    assert.ok(b.calls.some((c) => c.url === '/api/videos/s1' && c.method === 'GET'), 'the open fetched the item');
    for (const name of ['share', 'download', 'like', 'watched', 'queue', 'queue-next', 'transcript', 'reheat', 'move', 'delete']) {
      assert.ok(sMenu(b.dom).querySelector('[data-skin-x="' + name + '"]'), 'action rendered: ' + name);
    }
    assert.strictEqual(sMenu(b.dom).querySelector('[data-skin-speed]'), null, 'page 2 replaced the quick controls');
    sClick(b.dom, sMenu(b.dom).querySelector('[data-skin-x="like"]'));
    for (let i = 0; i < 4; i++) await b.settle();
    assert.ok(b.calls.some((c) => c.url === '/api/liked/s1' && c.method === 'POST'), 'Like POSTed the media-store endpoint');
    assert.strictEqual(sMenu(b.dom).querySelector('[data-skin-x="like"]').textContent, 'Liked', 'flipped on 2xx');
    // Back returns to page 1
    sClick(b.dom, sMenu(b.dom).querySelector('[data-skin-extras-back]'));
    assert.ok(sMenu(b.dom).querySelector('[data-skin-speed]'), 'Back lands on the quick controls');
  } finally { b.restoreAll(); }
});

test('U2 extras delete: the trash confirm -> real DELETE -> player.close + onMutated (the view refresh hook)', async () => {
  const b = bootSticker({});
  try {
    b.engine.paint();
    sClick(b.dom, panel(b.dom).querySelector('[data-skin-sticker]'));
    sClick(b.dom, sMenu(b.dom).querySelector('[data-skin-extras]'));
    for (let i = 0; i < 6; i++) await b.settle();
    sClick(b.dom, sMenu(b.dom).querySelector('[data-skin-x="delete"]'));
    assert.ok(b.spy.confirm, 'yt-dlp item -> the trash confirm opened');
    assert.ok(b.spy.confirm.b.indexOf('Song One') !== -1, 'the confirm names the item');
    b.spy.confirm.onConfirm();
    for (let i = 0; i < 6; i++) await b.settle();
    assert.ok(b.calls.some((c) => c.url === '/api/videos/s1' && c.method === 'DELETE'), 'the real DELETE fired');
    assert.strictEqual(b.spy.closed, 1, 'the player was closed before the DELETE');
    assert.strictEqual(b.spy.mutated, 1, 'onMutated fired - the view clears state and refreshes');
    assert.ok(b.toasts.includes('deleted-toast'), 'outcome via the shared mapper');
  } finally { b.restoreAll(); }
});

test('U2 pop-out exclusion at the ENGINE level: a non-main-document surface never offers Extras even when eligible', () => {
  const pipDom = new JSDOM('<body><div id="panel" class="music-nowplaying-panel"></div></body>', { url: 'http://localhost/pip' });
  const mainBoot = bootSticker({ extras: false }); // establishes global.document = the MAIN dom
  try {
    const eng2 = mainBoot.dom.window.FileTubeSkinSurface.create({
      panel: pipDom.window.document.getElementById('panel'),
      getSkinId: () => 'ipod', getCtx: () => ({ track: {}, upNext: [], fullList: [] }),
      hostCtl: (id) => mainBoot.dom.window.document.getElementById(id),
      win: pipDom.window,
      sticker: {
        onSkinChange: () => {},
        // v1.252 (adversarial W1): a watchBack hook that SAYS VISIBLE - only the engine's
        // in-main-document gate can reject it here, so the assert below binds that gate
        // distinctly (a normal-track fixture would pass vacuously via visible() false).
        watchBack: { visible: () => true, onTap: () => {} },
        extras: { getBaseId: () => 's1', isEligible: () => true, onMutated: () => {}, signal: new AbortController().signal },
      },
    });
    eng2.paint();
    const pipPanel = pipDom.window.document.getElementById('panel');
    const st = pipPanel.querySelector('[data-skin-sticker]');
    assert.ok(st, 'the pop-out surface still gets the sticker (quick controls)');
    st.dispatchEvent(new pipDom.window.MouseEvent('click', { bubbles: true }));
    const m = pipPanel.querySelector('[data-skin-sticker-menu]');
    assert.ok(m.querySelector('[data-skin-speed]'), 'quick controls render there (non-vacuous)');
    assert.strictEqual(m.querySelector('[data-skin-extras]'), null, 'but never the Extras entry (main-document only)');
    assert.strictEqual(m.querySelector('[data-skin-watchback]'), null, 'and never the Watch row either - a pop-out row must not navigate the window BEHIND it (v1.252 W1)');
    eng2.destroy();
  } finally { mainBoot.restoreAll(); }
});

test('v1.254 autoplay toggle: the hook renders the page-1 row, a tap flips via onToggle and re-renders; no hook (podcasts) = no row', () => {
  const state = { on: true };
  const b = bootSticker({ extras: false });
  try {
    // graft the hook onto a fresh engine instance (bootSticker's cfg has none)
    const eng = b.dom.window.FileTubeSkinSurface.create({
      panel: panel(b.dom),
      getSkinId: () => 'ipod', getCtx: () => ({ track: {}, upNext: [], fullList: [] }),
      hostCtl: (id) => b.dom.window.document.getElementById(id),
      sticker: {
        onSkinChange: () => {},
        autoplay: { enabled: () => state.on, onToggle: () => { state.on = !state.on; } },
      },
    });
    eng.paint();
    sClick(b.dom, panel(b.dom).querySelector('[data-skin-sticker]'));
    let row = sMenu(b.dom).querySelector('[data-skin-autoplay]');
    assert.ok(row, 'the Autoplay row rendered (hook present)');
    assert.strictEqual(row.getAttribute('aria-checked'), 'true', 'reflects enabled()');
    assert.match(row.textContent, /On/, 'says On');
    sClick(b.dom, row);
    assert.strictEqual(state.on, false, 'the tap flipped the view state via onToggle');
    row = sMenu(b.dom).querySelector('[data-skin-autoplay]');
    assert.strictEqual(row.getAttribute('aria-checked'), 'false', 're-rendered to the new state');
    assert.match(row.textContent, /Off/, 'says Off');
    eng.destroy();
    // podcast parity: bootSticker's own engine (no autoplay hook) renders NO row
    b.engine.paint();
    sClick(b.dom, panel(b.dom).querySelector('[data-skin-sticker]'));
    assert.ok(sMenu(b.dom).querySelector('[data-skin-loop]'), 'quick menu up (non-vacuous)');
    assert.strictEqual(sMenu(b.dom).querySelector('[data-skin-autoplay]'), null, 'no hook = no row (podcasts keep their menu)');
  } finally { b.restoreAll(); }
});

test('v1.254 autoplay toggle: the POP-OUT surface DOES offer it (device-global setting - unlike the main-doc-only Watch/Extras rows)', () => {
  const pipDom = new JSDOM('<body><div id="panel" class="music-nowplaying-panel"></div></body>', { url: 'http://localhost/pip' });
  const mainBoot = bootSticker({ extras: false });
  try {
    const state = { on: true };
    const eng2 = mainBoot.dom.window.FileTubeSkinSurface.create({
      panel: pipDom.window.document.getElementById('panel'),
      getSkinId: () => 'ipod', getCtx: () => ({ track: {}, upNext: [], fullList: [] }),
      hostCtl: (id) => mainBoot.dom.window.document.getElementById(id),
      win: pipDom.window,
      sticker: {
        onSkinChange: () => {},
        autoplay: { enabled: () => state.on, onToggle: () => { state.on = !state.on; } },
      },
    });
    eng2.paint();
    const pipPanel = pipDom.window.document.getElementById('panel');
    pipPanel.querySelector('[data-skin-sticker]').dispatchEvent(new pipDom.window.MouseEvent('click', { bubbles: true }));
    const m = pipPanel.querySelector('[data-skin-sticker-menu]');
    const row = m.querySelector('[data-skin-autoplay]');
    assert.ok(row, 'the pop-out offers the Autoplay row (nothing window-bound happens on a flip)');
    row.dispatchEvent(new pipDom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(state.on, false, 'the pop-out tap flips the shared setting');
    eng2.destroy();
  } finally { mainBoot.restoreAll(); }
});

test('U2 destroy(): stops a live reheat poll and invalidates an in-flight extras fetch (nothing outlives the surface)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const b = bootSticker({});
  try {
    b.engine.paint();
    sClick(b.dom, panel(b.dom).querySelector('[data-skin-sticker]'));
    sClick(b.dom, sMenu(b.dom).querySelector('[data-skin-extras]'));
    for (let i = 0; i < 6; i++) await b.settle();
    sClick(b.dom, sMenu(b.dom).querySelector('[data-skin-x="reheat"]'));
    for (let i = 0; i < 4; i++) await b.settle();
    assert.ok(b.toasts.includes('Reheating…'), 'the 202 armed the poll');
    const before = b.calls.filter((c) => c.url === '/api/subscriptions/status').length;
    b.engine.destroy();
    t.mock.timers.tick(3000);
    for (let i = 0; i < 4; i++) await b.settle();
    assert.strictEqual(b.calls.filter((c) => c.url === '/api/subscriptions/status').length, before, 'destroy stopped the poll (no post-destroy status fetches)');
  } finally { b.restoreAll(); }
});

test('destroy() clears body.mms-on and unbinds (the v1.227 swap-leak guard)', () => {
  const { dom, engine, restore } = bootEngine();
  try {
    engine.paint();
    dom.window.document.body.classList.add('mms-on');
    engine.destroy();
    assert.ok(!dom.window.document.body.classList.contains('mms-on'), 'destroy cleared the full-screen body class');
    // after destroy, a play tap no longer proxies (listeners removed)
    let pp = 0;
    dom.window.document.getElementById('pp-btn').addEventListener('click', () => { pp += 1; });
    const btn = panel(dom).querySelector('[data-skin-play]');
    if (btn) btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(pp, 0, 'destroy unbound the panel click proxy');
  } finally { restore(); }
});

// ---- v1.256 WHEEL HAPTICS (the ghost-switch engine; feel is Dean's device) ----------

function bootHaptic(opts) {
  const b = bootEngine(opts);
  // capability stubs BEFORE paint(): the switch property probe + a touch signal
  Object.defineProperty(b.dom.window.HTMLInputElement.prototype, 'switch', { value: false, configurable: true });
  b.dom.window.ontouchstart = null;
  return b;
}
const ghostOf = (dom) => panel(dom).querySelector('.mms-haptic-ghost');

test('v1.256 haptics: a capable device mounts the ghost (switch attr, hidden, arming scale), the carve-out class, and the body lock', () => {
  const b = bootHaptic({});
  try {
    b.engine.paint();
    const g = ghostOf(b.dom);
    assert.ok(g, 'the ghost mounted inside the wheel skin');
    assert.ok(g.closest('.ip-wheel'), 'inside .ip-wheel (every rotation touchstart lands on it)');
    assert.ok(g.hasAttribute('switch'), 'a REAL switch control (the haptic source)');
    assert.strictEqual(g.getAttribute('aria-hidden'), 'true', 'invisible to AT');
    assert.strictEqual(g.tabIndex, -1, 'out of the tab order');
    assert.strictEqual(g.style.transform, 'scale(7.5)', 'resting at the arming cover scale');
    assert.ok(panel(b.dom).classList.contains('mms-haptic'), 'the touch-action carve-out class is on');
    assert.strictEqual(b.dom.window.document.body.style.position, 'fixed', 'the body scroll lock replaced touch-action:none');
  } finally { b.restore(); }
});

test('v1.256 haptics OFF path: no switch support = no ghost, no class, no lock (byte-identical behavior)', () => {
  const b = bootEngine({});
  try {
    b.engine.paint();
    assert.strictEqual(ghostOf(b.dom), null, 'no ghost without capability');
    assert.ok(!panel(b.dom).classList.contains('mms-haptic'), 'no carve-out class');
    assert.strictEqual(b.dom.window.document.body.style.position, '', 'body untouched');
  } finally { b.restore(); }
});

test('v1.271 haptics: the tick engine - one bias flip per detent (3.75deg Classic parity), the 8ms floor DROPS excess, ghost rides the finger; no .checked writes ever', () => {
  const b = bootHaptic({});
  const savedPerf = global.performance;
  let t = 1000;
  global.performance = { now: () => t };
  try {
    b.engine.paint();
    const g = ghostOf(b.dom);
    Object.defineProperty(g, 'checked', { set() { throw new Error('JS wrote .checked - kills WebKit tracking'); }, get() { return false; } });
    const wheel = panel(b.dom).querySelector('.ip-wheel');
    const at = (deg) => { const rad = deg * Math.PI / 180; return { clientX: 100 * Math.cos(rad), clientY: 100 * Math.sin(rad) }; };
    const mv = (deg, dt) => { t += dt; const q = at(deg); wheel.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: q.clientX, clientY: q.clientY })); return q; };
    const s = at(0);
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: s.clientX, clientY: s.clientY }));
    assert.match(g.style.transform, /^translate\(/, 'gesture start: the ghost shrank from the cover to ride the finger');
    assert.strictEqual(g.style.transform, `translate(${s.clientX + 18}px,${s.clientY}px)`, 'initial bias +18px past the midline');
    let q = mv(6, 100); // 6deg = 1 detent at 3.75 (rem 2.25), dt 100ms > floor -> flip to -18
    assert.strictEqual(g.style.transform, `translate(${q.clientX - 18}px,${q.clientY}px)`, 'detent 1 flipped the bias (a crossing = a tick)');
    q = mv(8, 5);       // +2deg -> crosses a detent (carry 2.25) but dt 5ms -> THROTTLED, bias unchanged
    assert.strictEqual(g.style.transform, `translate(${q.clientX - 18}px,${q.clientY}px)`, 'a throttled detent follows without flipping');
    // v1.271: retimed for the 8ms floor. A DROP does not stamp hapLast, so this lands
    // 7ms after the FLIP (5 + 2), still inside the floor -> dropped, not queued. Under
    // the old 30ms floor the original dt of 5 put this at 10ms, which now legitimately
    // ticks - the timeline had to move with the constant, not the assertion.
    q = mv(14, 2);      // 7ms since the flip -> THROTTLED (dropped, not queued)
    assert.strictEqual(g.style.transform, `translate(${q.clientX - 18}px,${q.clientY}px)`, 'the Taptic floor drops the tick, never queues it');
    q = mv(24, 100);    // three detents accumulate at 3.75 (carry 2.75+10); one flip allowed -> back to +18
    assert.strictEqual(g.style.transform, `translate(${q.clientX + 18}px,${q.clientY}px)`, 'a fast burst still saturates to one tick per floor interval');
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointercancel', { bubbles: true }));
    assert.strictEqual(g.style.transform, 'scale(7.5)', 'cancel restores the arming cover (the dual-arm teardown discipline)');
  } finally { global.performance = savedPerf; b.restore(); }
});

test('v1.256 haptics: a click landing on the ghost ROUTES to the real control under it (zones/center survive the overlay)', () => {
  const b = bootHaptic({});
  try {
    b.engine.paint();
    const g = ghostOf(b.dom);
    const play = panel(b.dom).querySelector('[data-skin-play]');
    assert.ok(play, 'the play zone exists (non-vacuous)');
    let routed = 0;
    play.addEventListener('click', () => { routed += 1; });
    b.dom.window.document.elementsFromPoint = () => [g, play];
    g.dispatchEvent(new b.dom.window.MouseEvent('click', { bubbles: true, clientX: 0, clientY: 100 }));
    assert.strictEqual(routed, 1, 'the covered zone received its click');
  } finally { b.restore(); }
});

test('v1.256 haptics: the body lock NEVER outlives the ghost - reflect() self-heals a view-side teardown, destroy() always unlocks', () => {
  const b = bootHaptic({});
  try {
    b.engine.paint();
    assert.strictEqual(b.dom.window.document.body.style.position, 'fixed', 'locked while the ghost lives');
    // the v1.227 leak class: the VIEW replaces the panel content without destroy()
    ghostOf(b.dom).remove();
    b.engine.reflect();
    assert.strictEqual(b.dom.window.document.body.style.position, '', 'reflect() healed the orphaned lock');
    b.engine.paint(); // remount
    assert.strictEqual(b.dom.window.document.body.style.position, 'fixed', 'repaint re-locks');
    b.engine.destroy();
    assert.strictEqual(b.dom.window.document.body.style.position, '', 'destroy() unlocks unconditionally');
  } finally { b.restore(); }
});

test('v1.256 (QA CRITICAL binding): a VIEW-side teardown with NO media event and NO click still unlocks the body (the observer release)', async () => {
  // The paused-dock strand: updateNowPlayingPanel clears the panel synchronously without
  // destroy(); paused audio means reflect() never fires and the panel's click handler is
  // unreachable - the event-driven heals cannot run, and the browse view stays pinned.
  // The MutationObserver releases the lock the moment the ghost leaves the DOM.
  const b = bootHaptic({});
  try {
    b.engine.paint();
    assert.strictEqual(b.dom.window.document.body.style.position, 'fixed', 'locked while the skin is up (populated first)');
    // the exact view teardown shape: innerHTML cleared + skin classes dropped, nothing else
    panel(b.dom).innerHTML = '';
    panel(b.dom).className = 'music-nowplaying-panel';
    await new Promise((r) => setImmediate(r)); // MutationObserver callbacks are microtasks
    assert.strictEqual(b.dom.window.document.body.style.position, '', 'the observer unlocked with no reflect/click/destroy involved');
  } finally { b.restore(); }
});

test('v1.256 (QA S1 binding): a scan-engaged move ticks NOTHING - the ghost holds still through a fast-scan wobble', () => {
  const b = bootHaptic({ engineCfg: { fastScan: true } });
  try {
    b.engine.paint();
    const timers = fakeWinTimers(b.dom);
    const mp = b.dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'duration', { value: 300, configurable: true });
    let ct = 100; Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => ct, set: (v) => { ct = v; } });
    const g = ghostOf(b.dom);
    const zone = panel(b.dom).querySelector('.ip-wheel [data-skin-next]') || panel(b.dom).querySelector('[data-skin-next]');
    b.dom.window.document.elementsFromPoint = () => [g, zone]; // the press lands on the ghost, routed to the zone
    g.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 0 }));
    timers.timeouts[0](); // the 400ms hold fires -> scan engages
    const held = g.style.transform;
    // a wobble during the scan: rotation coords that would cross several detents
    g.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 30, clientY: 40 }));
    assert.strictEqual(g.style.transform, held, 'the scanning early-return precedes the haptic engine - no tick, no follow (the plan claim, bound)');
  } finally { b.restore(); }
});

test('v1.256 (QA S2 binding): a rotate-then-release on the ghost suppresses the click BEFORE the zone route - no phantom zone action', () => {
  const b = bootHaptic({});
  try {
    b.engine.paint();
    const g = ghostOf(b.dom);
    const play = panel(b.dom).querySelector('[data-skin-play]');
    let routed = 0;
    play.addEventListener('click', () => { routed += 1; });
    b.dom.window.document.elementsFromPoint = () => [g, play];
    // a real rotation on the ghost (>8px movement sets st.moved -> suppress arms on release)
    g.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    g.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 70, clientY: 70 }));
    g.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 70, clientY: 70 }));
    g.dispatchEvent(new b.dom.window.MouseEvent('click', { bubbles: true, clientX: 70, clientY: 70 }));
    assert.strictEqual(routed, 0, 'the suppress check runs before the ghost route - a spin release never fires a zone');
  } finally { b.restore(); }
});

test('v1.271 (was v1.256 W1+W2): the FEEL constants are pinned at their boundaries - 3.75deg Classic parity (Deans ruling, unchanged) and the 8ms floor (was 30) - and a throttled detent DROPS, never queues', () => {
  // The seat proved step=1/6 and min=100 (and while->if queueing) all survived the
  // cadence test - Dean's iPod-Classic ruling was unbound. Pin both axes at their
  // exact boundaries, and distinguish drop from queue with a sub-detent follow-up.
  const b = bootHaptic({});
  const savedPerf = global.performance;
  let t = 5000;
  global.performance = { now: () => t };
  try {
    b.engine.paint();
    const g = ghostOf(b.dom);
    const wheel = panel(b.dom).querySelector('.ip-wheel');
    const at = (deg) => { const rad = deg * Math.PI / 180; return { clientX: 100 * Math.cos(rad), clientY: 100 * Math.sin(rad) }; };
    const mv = (deg, dt) => { t += dt; const q = at(deg); wheel.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: q.clientX, clientY: q.clientY })); return q; };
    const s = at(0);
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: s.clientX, clientY: s.clientY }));
    // STEP boundary (v1.256.2, Dean's Classic-parity ruling: 3.75deg = 96/rev): 3.7
    // accumulated = NO flip; +0.1 more crosses 3.75 = FLIP.
    let q = mv(3.7, 100);
    assert.strictEqual(g.style.transform, `translate(${q.clientX + 18}px,${q.clientY}px)`, '3.7deg accumulated: below the 3.75 step, no flip (kills step->1/3)');
    q = mv(3.8, 100);
    assert.strictEqual(g.style.transform, `translate(${q.clientX - 18}px,${q.clientY}px)`, '3.8deg crosses the 3.75 boundary: flip (kills step->4.5/6)');
    // FLOOR boundary, v1.271: 30 -> 8. Dean asked for more feedback ("it really should
    // feel like the real thing"), and the investigation measured 30 pegging delivery at
    // a flat ~30 ticks/s regardless of speed - 69% of a 1 rev/s spin's ticks discarded,
    // where a real Classic's rate rises with the hand. 8 sits below the 8.33ms ProMotion
    // frame, so it can never bind before the mechanism's own ceiling (one tick per
    // pointermove). SAFE because Dean device-confirmed the engine DROPS, not queues.
    // Pinned to exactly (7, 8] by the same 1ms-landing trick as before: a drop does not
    // stamp hapLast, so the 7ms detent lands 1ms later = exactly 8ms after the FLIP.
    q = mv(7.6, 7);
    assert.strictEqual(g.style.transform, `translate(${q.clientX - 18}px,${q.clientY}px)`, 'a detent 7ms after a flip is dropped (the 8ms floor holds exactly)');
    q = mv(11.4, 1);
    assert.strictEqual(g.style.transform, `translate(${q.clientX + 18}px,${q.clientY}px)`, 'a detent 8ms after the last FLIP ticks (the floor is 8, not more)');
    // DROP vs QUEUE: a multi-detent burst consumes its backlog even where the throttle
    // suppressed the intervening flips - the carry is spent, not banked.
    // v1.271 slim W1: this pair is the ONLY thing binding drop-vs-queue (the `while` ->
    // `if` mutant survives without it). I deleted it while retiming and the loss was
    // silent - the very property the 8ms change's safety argument rests on.
    q = mv(26.4, 100);  // 15deg burst = 4 detents at 3.75, one flip allowed -> bias back to -18
    assert.strictEqual(g.style.transform, `translate(${q.clientX - 18}px,${q.clientY}px)`, 'a burst saturates to one flip');
    q = mv(27.4, 100);  // +1deg sub-detent drift (carry 1.15 < 3.75), long after the throttle window
    assert.strictEqual(g.style.transform, `translate(${q.clientX - 18}px,${q.clientY}px)`, 'no phantom tick after the finger slows: the backlog was CONSUMED, not queued');
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true }));
  } finally { global.performance = savedPerf; b.restore(); }
});

test('v1.256.1 (Dean device regression): a zone tap routes by the POINTERDOWN point - the click\'s centered lie cannot reach the select button', () => {
  // On-device, every zone "acted like the middle button": iOS fires a checkbox's click
  // at the CONTROL'S CENTER (= the wheel center, where the select button lives), not at
  // the finger. The route now uses the stashed pointerdown coordinates.
  const b = bootHaptic({});
  try {
    b.engine.paint();
    const g = ghostOf(b.dom);
    const play = panel(b.dom).querySelector('[data-skin-play]');
    const select = panel(b.dom).querySelector('[data-skin-select]');
    assert.ok(play && select, 'zones + center exist (non-vacuous)');
    let playFired = 0; let selectFired = 0;
    play.addEventListener('click', () => { playFired += 1; });
    select.addEventListener('click', () => { selectFired += 1; });
    // a REAL point-sensitive hit-test stub: the zone point finds the zone, the center finds select
    b.dom.window.document.elementsFromPoint = (x, y) => (y > 50 ? [g, play] : [g, select]);
    // finger taps the PLAY zone (0,100); iOS then lies: the click arrives at the center (0,0)
    g.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 100 }));
    g.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 0, clientY: 100 }));
    g.dispatchEvent(new b.dom.window.MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    assert.strictEqual(playFired, 1, 'the tap reached the ZONE the finger touched (the stash wins over the lying click coords)');
    assert.strictEqual(selectFired, 0, 'the wheel-center select button did NOT swallow it');
  } finally { b.restore(); }
});

test('v1.256.1: the hit resolves UPWARD to the zone control when the deepest element is its svg glyph (WebKit SVGElement has no .click)', () => {
  const b = bootHaptic({});
  try {
    b.engine.paint();
    const g = ghostOf(b.dom);
    const next = panel(b.dom).querySelector('[data-skin-next]');
    const glyph = next && next.querySelector('svg');
    assert.ok(glyph, 'the zone renders an svg glyph (non-vacuous)');
    let nextFired = 0;
    next.addEventListener('click', () => { nextFired += 1; });
    b.dom.window.document.elementsFromPoint = () => [g, glyph];
    g.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 60, clientY: 0 }));
    g.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 60, clientY: 0 }));
    g.dispatchEvent(new b.dom.window.MouseEvent('click', { bubbles: true, clientX: 60, clientY: 0 }));
    assert.strictEqual(nextFired, 1, 'the svg hit resolved upward to its zone button');
  } finally { b.restore(); }
});

test('v1.256.1 (slim-gate CRITICAL): a CENTER tap refreshes the stash - a stale zone can never replay onto Select (real-rect harness)', () => {
  // The zero-rect jsdom fixture never trips the dead-center guard, which is exactly how
  // the stale-stash bug shipped (divergent-fixture class). Stub a REAL wheel rect so the
  // guard executes: after a zone tap, a center tap must route to Select, not replay Next.
  const b = bootHaptic({});
  try {
    b.engine.paint();
    const g = ghostOf(b.dom);
    const wheel = panel(b.dom).querySelector('.ip-wheel');
    wheel.getBoundingClientRect = () => ({ left: -120, top: -120, width: 240, height: 240, right: 120, bottom: 120 });
    const next = panel(b.dom).querySelector('[data-skin-next]');
    const select = panel(b.dom).querySelector('[data-skin-select]');
    let nextFired = 0; let selectFired = 0;
    next.addEventListener('click', () => { nextFired += 1; });
    select.addEventListener('click', () => { selectFired += 1; });
    // point-sensitive hit-test: far-from-center finds the zone, near-center finds select
    b.dom.window.document.elementsFromPoint = (x, y) => (Math.hypot(x, y) < 48 ? [g, select] : [g, next]);
    const tap = (x, y, cx, cy) => {
      g.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
      g.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
      g.dispatchEvent(new b.dom.window.MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy })); // iOS lies: center coords
    };
    tap(100, 0, 0, 0);  // a NEXT tap (outside the 48px dead center; the click lies to 0,0)
    assert.strictEqual(nextFired, 1, 'the zone tap routed to Next (populated first)');
    tap(0, 10, 0, 0);   // a CENTER tap - the dead-center guard early-returns in onDown
    assert.strictEqual(selectFired, 1, 'the center tap reached Select - the stash refreshed BEFORE the guard');
    assert.strictEqual(nextFired, 1, 'the stale zone did NOT replay (move the stash below the guard and this reds)');
  } finally { b.restore(); }
});

test('v1.257 TRAY: a MAIN-document engine with a grafted tray hook still renders NO row - only the inMainDoc gate can reject it', () => {
  // The shell injects the hook only in pop-outs, so in production the tab never has one -
  // which means the gate itself was unbound (its deletion mutant survived). The v1.252
  // adversarial-W1 pattern: a hook that SAYS ENABLED on the main document, so only the
  // engine's own surface gate can keep the row out.
  const b = bootSticker({ extras: false });
  try {
    const eng = b.dom.window.FileTubeSkinSurface.create({
      panel: panel(b.dom),
      getSkinId: () => 'ipod', getCtx: () => ({ track: {}, upNext: [], fullList: [] }),
      hostCtl: (id) => b.dom.window.document.getElementById(id),
      sticker: {
        onSkinChange: () => {},
        tray: { enabled: () => true, onToggle: () => {} },
      },
    });
    eng.paint();
    sClick(b.dom, panel(b.dom).querySelector('[data-skin-sticker]'));
    const m = sMenu(b.dom);
    assert.ok(m.querySelector('[data-skin-loop]'), 'the menu rendered (non-vacuous)');
    assert.strictEqual(m.querySelector('[data-skin-tray]'), null, 'the main-document surface refuses the row even with a willing hook (delete the gate and this reds)');
    eng.destroy();
  } finally { b.restoreAll(); }
});

test('v1.258.1 (Dean): the iPod LCD track bar is CLICK-SEEKABLE - a click maps x to the seek pipeline (parity with the apple/spotify bars)', () => {
  const { dom, engine, restore } = bootEngine({ skin: 'ipod' });
  try {
    engine.paint();
    const bar = panel(dom).querySelector('.ip-track');
    assert.ok(bar, 'the LCD bar rendered (non-vacuous)');
    assert.ok(bar.hasAttribute('data-skin-seek'), 'the bar carries the seek hook (it was display-only before)');
    assert.strictEqual(bar.getAttribute('role'), 'slider', 'announced as a slider');
    let committed = null;
    dom.window.document.getElementById('seek-bar').addEventListener('change', (e) => { committed = e.target.value; });
    // jsdom rects are zero, so the handler's (x - left) / (width || 1) = clientX clamped
    bar.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 0.5, clientY: 0 }));
    assert.strictEqual(committed, '0.5', 'the click position reached the REAL seek pipeline');
  } finally { restore(); }
});

test('v1.258.1 (slim W1): a tap on the menu\'s DEAD SPACE closes it; a control tap does NOT (both axes)', () => {
  const b = bootSticker({ extras: false });
  try {
    b.engine.paint();
    sClick(b.dom, panel(b.dom).querySelector('[data-skin-sticker]'));
    const m = sMenu(b.dom);
    assert.strictEqual(m.hidden, false, 'menu open (populated first)');
    // a control tap keeps it open (speed chips re-render in place)
    sClick(b.dom, m.querySelector('[data-skin-speed]'));
    assert.strictEqual(sMenu(b.dom).hidden, false, 'a speed pick re-renders, does not dismiss');
    // a dead-space tap - the Speed HEADING - closes (the tray overlay has no other honest exit)
    const heading = [...sMenu(b.dom).querySelectorAll('.mms-sm-h')].find((h) => /Speed/.test(h.textContent));
    assert.ok(heading, 'the heading exists (non-vacuous)');
    sClick(b.dom, heading);
    assert.strictEqual(sMenu(b.dom).hidden, true, 'dead space dismisses the menu');
  } finally { b.restoreAll(); }
});


test('v1.261 haptics (slim W1): the arming cover DERIVES from the wheel rect - a 132px Zune pad gets scale(4.125), never the iPod 7.5 spilling onto the scrub bar', () => {
  const b = bootHaptic({});
  try {
    // real-rect stub BEFORE paint (mount measures during paint; zero-rect jsdom would
    // exercise only the fallback - the v1.256.1 lesson)
    b.dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
      const base = { left: 0, top: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
      if (this.classList && this.classList.contains('ip-wheel')) return { ...base, width: 132, height: 132, right: 132, bottom: 132 };
      return { ...base, width: 0, height: 0 };
    };
    b.engine.paint();
    const g = ghostOf(b.dom);
    assert.ok(g, 'the ghost mounted');
    assert.strictEqual(g.style.transform, 'scale(4.125)', 'the cover fits the 132px pad (132/32) - a fixed 7.5 here covered the seek bar and routed taps to 0:00');
    // round-2 W3: the RESTORE call site must derive too - a bare ghostRestTransform()
    // at gesture-end resurrects the spill after the user's FIRST spin (per-call-site
    // kill, the v1.254 per-conjunct class).
    const wheel = panel(b.dom).querySelector('.ip-wheel');
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 66, clientY: 20 }));
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 90, clientY: 40 }));
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true }));
    assert.strictEqual(g.style.transform, 'scale(4.125)', 'gesture-end restores the DERIVED cover, not the fixed 7.5');
  } finally { b.restore(); }
});

test('v1.267 (Dean, device-confirmed): the iPod wheel arms EDGE TO EDGE - a 288px wheel gets scale(9), not the old 7.5 that left dead strips top and bottom', () => {
  const b = bootHaptic({});
  try {
    b.dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
      const base = { left: 0, top: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
      if (this.classList && this.classList.contains('ip-wheel')) return { ...base, width: 288, height: 288, right: 288, bottom: 288 };
      return { ...base, width: 0, height: 0 };
    };
    b.engine.paint();
    const g = ghostOf(b.dom);
    assert.ok(g, 'the ghost mounted');
    // 52x32 scaled by 9 = 468x288: the cover's HEIGHT now equals the wheel's, so
    // the top/bottom strips that never armed (240 tall over a 273-288 wheel) are
    // gone. Re-add the Math.min cap and this reds.
    assert.strictEqual(g.style.transform, 'scale(9)', 'the cover matches the wheel exactly (288/32) - no dead strip');
  } finally { b.restore(); }
});


test('v1.267 INVARIANT: the arming cover is exactly the wheel tall at every MEASURABLE size, with h=0 the one documented exception (slim W2: derived, not absolute)', () => {
  // The old protection was a magic cap (7.5). The real property is that the
  // cover's HEIGHT equals the wheel's height, so it spans the wheel and nothing
  // above it - at every size, including ones no skin uses today.
  // NOTE the exception, asserted below rather than glossed: an unmeasurable wheel
  // (h=0) falls back to 7.5, which on a SMALL pad would be taller than the pad -
  // the very geometry v1.261 W1 fixed. It is the right trade (a collapsed cover
  // arms nothing) and is unreachable in production, but it is not "structural".
  for (const h of [96, 132, 200, 273, 288, 400]) {
    const b = bootHaptic({});
    try {
      b.dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
        const base = { left: 0, top: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
        if (this.classList && this.classList.contains('ip-wheel')) return { ...base, width: h, height: h, right: h, bottom: h };
        return { ...base, width: 0, height: 0 };
      };
      b.engine.paint();
      const g = ghostOf(b.dom);
      assert.ok(g, `ghost mounted at h=${h}`);
      const scale = Number(/scale\(([\d.]+)\)/.exec(g.style.transform)[1]);
      // the ghost box is 32px tall (public/css/style.css .mms-haptic-ghost)
      assert.strictEqual(scale * 32, h, `h=${h}: cover height ${scale * 32} must equal the wheel's ${h} - taller would reach the seek bar, shorter leaves a dead strip`);
    } finally { b.restore(); }
  }
  // The documented exception, bound so it can never drift silently.
  const z = bootHaptic({});
  try {
    z.engine.paint(); // jsdom rects are all zero
    const g = ghostOf(z.dom);
    assert.strictEqual(g.style.transform, 'scale(7.5)', 'an UNMEASURABLE wheel falls back to 7.5 - it must never collapse to nothing');
  } finally { z.restore(); }
});

test('v1.271: a repaint DURING a live spin is DEFERRED, not allowed to kill the drag', () => {
  const b = bootHaptic({});
  try {
    b.engine.paint();
    const panel = b.dom.window.document.querySelector('.music-nowplaying-panel');
    const wheel = panel.querySelector('.ip-wheel');
    const before = wheel;
    // start a spin
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 40, pointerId: 1 }));
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 230, clientY: 80, pointerId: 1 }));
    // a track change lands mid-drag: the panel must NOT be rebuilt under the finger
    b.engine.paint();
    assert.strictEqual(panel.querySelector('.ip-wheel'), before,
      'the wheel node the gesture is bound to SURVIVES the repaint - replacing it stranded the listeners, skipped endWheel, left pointer capture held and the lift-off click unsuppressed (measured: 15 ticks before, 0 after)');
    // the drag still works
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 260, clientY: 140, pointerId: 1 }));
    assert.ok(true, 'the gesture continues');
    // lifting flushes the deferred repaint
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true, pointerId: 1 }));
    assert.notStrictEqual(panel.querySelector('.ip-wheel'), before,
      'and the repaint lands the instant the finger lifts - deferred, never dropped');
  } finally { b.restore(); }
});

test('v1.271: the deferred repaint cannot outlive the surface', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'skin-surface.js'), 'utf8');
  // Loosened per slim S2: the literal shape-lock redded on a CORRECT refactor (the
  // CRITICAL-1 fix) while a semantically wrong variant keeping the first line passed.
  // The behavioural tests carry the weight; this only insists the mechanism exists.
  assert.match(src, /if \(wheelSpin\) \{[\s\S]{0,400}?paintPending = true; return; \}/,
    'paint() defers while a LIVE spin holds a connected wheel');
  assert.match(src, /wheelSpin\.wheel && wheelSpin\.wheel\.isConnected/,
    'and only then - a spin whose wheel the view tore out must NOT freeze every future repaint (slim CRITICAL-1)');
  assert.match(src, /if \(paintPending\) paint\(\);/, 'endWheel flushes it - the one seam that owns endings');
  // window sized to the comment that legitimately sits between them (#213: distance
  // locks break on valid insertions, so bind the PAIR loosely and let the behavioural
  // test above carry the real weight).
  assert.match(src, /function destroy\(\) \{[\s\S]{0,400}?paintPending = false;/,
    'and destroy() drops it, so a queued repaint never fires at a dead surface');
});

test('v1.271 slim CRITICAL-1: a view-side panel clear during a live press must NOT freeze paint() forever', () => {
  const b = bootHaptic({});
  try {
    b.engine.paint();
    const panel = b.dom.window.document.querySelector('.music-nowplaying-panel');
    const wheel = panel.querySelector('.ip-wheel');
    // finger down (a press is enough - wheelSpin is set on any non-dead-centre pointerdown)
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 40, pointerId: 1 }));
    // the VIEW clears the panel without destroy() - music.js:1081 and podcasts.js:850 both
    // do this, and the v1.256 QA CRITICAL documents that this path delivers NO events, so
    // the gesture can never reach endWheel on its own.
    panel.innerHTML = '';
    // a later repaint must still work. Before the fix the deferral jumped over the
    // stale-spin heal and every subsequent paint returned early - permanently.
    b.engine.paint();
    assert.ok(panel.querySelector('.ip-wheel'),
      'the panel repainted - a spin whose wheel the view tore out is ended, not waited on (a frozen paint left a blank skin with a dead wheel and no in-app recovery)');
    b.engine.paint();
    assert.ok(panel.querySelector('.ip-wheel'), 'and keeps repainting');
  } finally { b.restore(); }
});

test('v1.271 slim round-2 WARNING: a MOUSE released OFF the wheel still ends the gesture - a connected wheel is not proof the gesture can reach endWheel', () => {
  const b = bootHaptic({});
  try {
    b.engine.paint();
    const panel = b.dom.window.document.querySelector('.music-nowplaying-panel');
    const wheel = panel.querySelector('.ip-wheel');
    const before = wheel;
    // Press the wheel and release somewhere else entirely. Pointer capture is only taken
    // after 8px of travel (or a fast-scan start) and a MOUSE gets no implicit capture at
    // pointerdown the way a touch does, so the wheel-only pointerup listener never fires.
    // The wheel is still CONNECTED, so the isConnected defer reads the spin as live.
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 40, pointerId: 1 }));
    b.dom.window.document.body.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true, pointerId: 1 }));
    // Without the document-level end arm the spin stayed live forever and every future
    // paint deferred: the desktop pop-out froze on the current track until it was closed.
    b.engine.paint();
    assert.notStrictEqual(panel.querySelector('.ip-wheel'), before,
      'the repaint LANDED - the release off the wheel ended the gesture (a frozen paint left the pop-out showing a stale track with a dead wheel, where v1.270 self-healed on the next repaint)');
    // and the wheel takes a fresh gesture (onDown early-returns while wheelSpin is set)
    const w2 = panel.querySelector('.ip-wheel');
    w2.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 40, pointerId: 2 }));
    w2.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 230, clientY: 80, pointerId: 2 }));
    b.engine.paint();
    assert.strictEqual(panel.querySelector('.ip-wheel'), w2, 'and a NEW spin is accepted and deferred normally');
  } finally { b.restore(); }
});

// jsdom has no PointerEvent, and MouseEvent SILENTLY DROPS a `pointerId` passed in its
// init dict - so every fixture in this file that reads `{ ..., pointerId: 1 }` is really
// dispatching `undefined`, which happens to match the equally-undefined st.id. Any test
// that means to DISCRIMINATE two pointers has to define the property for real.
function pointerEv(dom, type, init, id) {
  const ev = new dom.window.MouseEvent(type, init);
  Object.defineProperty(ev, 'pointerId', { value: id, configurable: true });
  return ev;
}

test('v1.271 slim round-2: the document end arm is pointerId-FILTERED - a second finger lifting elsewhere does not end your spin', () => {
  const b = bootHaptic({});
  try {
    b.engine.paint();
    const panel = b.dom.window.document.querySelector('.music-nowplaying-panel');
    const wheel = panel.querySelector('.ip-wheel');
    const before = wheel;
    wheel.dispatchEvent(pointerEv(b.dom, 'pointerdown', { bubbles: true, clientX: 200, clientY: 40 }, 1));
    wheel.dispatchEvent(pointerEv(b.dom, 'pointermove', { bubbles: true, clientX: 230, clientY: 80 }, 1));
    // a DIFFERENT pointer lifts somewhere else on the page. The wheel's own arm is
    // deliberately unfiltered (a second finger's up ON THE WHEEL still ends the gesture,
    // as it always has); this document-wide arm must not inherit that reach, or any
    // stray tap on the page would kill a drag in progress.
    b.dom.window.document.body.dispatchEvent(pointerEv(b.dom, 'pointerup', { bubbles: true }, 2));
    b.engine.paint();
    assert.strictEqual(panel.querySelector('.ip-wheel'), before,
      'the spin is STILL live - the repaint is deferred, so the foreign pointerup was ignored');
    // and this pointer's own release still ends it
    b.dom.window.document.body.dispatchEvent(pointerEv(b.dom, 'pointerup', { bubbles: true }, 1));
    b.engine.paint();
    assert.notStrictEqual(panel.querySelector('.ip-wheel'), before, 'while ITS OWN pointerup does end it');
  } finally { b.restore(); }
});

test('v1.271 slim round-2: the document end arm UNBINDS on every teardown arm - it must not accumulate one listener per gesture', () => {
  const b = bootHaptic({});
  try {
    b.engine.paint();
    const doc = b.dom.window.document;
    const panel = doc.querySelector('.music-nowplaying-panel');
    // count only the document-level pointer end listeners (the ones this wave added)
    let live = 0;
    const add = doc.addEventListener.bind(doc), rem = doc.removeEventListener.bind(doc);
    doc.addEventListener = function (t, fn, o) { if (t === 'pointerup' || t === 'pointercancel') live += 1; return add(t, fn, o); };
    doc.removeEventListener = function (t, fn, o) { if (t === 'pointerup' || t === 'pointercancel') live -= 1; return rem(t, fn, o); };
    const press = () => {
      const w = panel.querySelector('.ip-wheel');
      w.dispatchEvent(pointerEv(b.dom, 'pointerdown', { bubbles: true, clientX: 200, clientY: 40 }, 1));
      return w;
    };
    // arm 1: a normal release on the wheel
    const w1 = press();
    w1.dispatchEvent(pointerEv(b.dom, 'pointerup', { bubbles: true }, 1));
    assert.strictEqual(live, 0, 'the wheel-release arm removed both document listeners');
    // arm 2: a release OFF the wheel (the arm this wave added)
    press();
    doc.body.dispatchEvent(pointerEv(b.dom, 'pointerup', { bubbles: true }, 1));
    assert.strictEqual(live, 0, 'the document-release arm removed them too');
    // arm 3: the view tears the panel out, and a later repaint ends the stale spin
    press();
    panel.innerHTML = '';
    b.engine.paint();
    assert.strictEqual(live, 0, 'and so does the stale-spin end inside paint()');
    // arm 4: the surface dies mid-gesture
    press();
    b.engine.destroy();
    assert.strictEqual(live, 0,
      'and destroy() - a document listener stranded per gesture holds its whole dead gesture closure alive (the v1.163 lesson: unbind on EVERY teardown arm, not just the happy one)');
  } finally { b.restore(); }
});

test('v1.271 slim round-2 S1: ending a STALE spin from paint() tears its fast-scan timers down - not just its identity', () => {
  const { dom, engine, restore } = bootEngine({ engineCfg: { fastScan: true } });
  try {
    engine.paint();
    const timers = fakeWinTimers(dom);
    const mp = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'duration', { value: 300, configurable: true });
    let ct = 100; Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => ct, set: (v) => { ct = v; } });
    const zone = panel(dom).querySelector('.ip-wheel [data-skin-next]') || panel(dom).querySelector('[data-skin-next]');
    zone.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 0 }));
    timers.timeouts[0](); // the hold fires: the scan engages and owns the gesture
    assert.strictEqual(timers.intervals.length, 1, 'the scan interval armed');
    // the VIEW clears the panel mid-hold - no pointerup ever arrives (music.js:1081)
    panel(dom).innerHTML = '';
    engine.paint();
    // paint() ends the stale gesture. Nulling wheelSpin alone would heal the IDENTITY and
    // leave this interval stepping currentTime with no finger down (measured runaway on
    // v1.270 too) - the teardown is what makes the stale branch worth its endWheel call.
    assert.strictEqual(timers.intervals[0], null, 'the scan interval was CLEARED by the stale endWheel');
    const at = ct;
    if (timers.intervals[0]) timers.intervals[0]();
    assert.strictEqual(ct, at, 'and currentTime stops advancing - no runaway scan behind a repainted panel');
  } finally { restore(); }
});
