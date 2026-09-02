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
  assert.match(src, /window\.FileTubeSkinSurface\.create\(\{/, 'podcasts creates the shared skin engine');
  assert.match(src, /getCtx: podcastSkinCtx/, 'driven by the PODCAST ctx (episode list, /podcastart art)');
  assert.match(src, /onSelectIndex: function \(i\) \{ playAt\(i\); \}/, 'the wheel/select play hook is the podcasts playAt');
  assert.match(src, /artUrl: artSub \? \('\/podcastart\/'/, 'the ctx art is the show art (/podcastart)');
  // the updateNowPlayingPanel fork: mount the skin on the gate, and teardown clears mms-on
  assert.match(src, /if \(skinActive\(\) && skinEngine\) \{[\s\S]{0,120}skinEngine\.paint\(\);/, 'on mobile+podcast the panel BECOMES the skin');
  assert.match(src, /skinEngine.*document\.body\.classList\.remove\('mms-on'\)/, 'the teardown branch clears the full-screen body class (v1.227 leak guard)');
  // destroy tears the skin down (module-scoped handle) so a view swap never strands mms-on
  assert.match(src, /activeSkinEngine\.destroy\(\)/, 'destroy() tears the skin engine down');
  // and skin-surface.js is loaded on the podcasts shell (before podcasts.js, after music-skins.js)
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'podcasts.html'), 'utf8');
  assert.match(html, /music-skins\.js"><\/script>\s*<script src="\/js\/skin-surface\.js"/, 'skin-surface.js loads after music-skins.js on podcasts.html');
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
