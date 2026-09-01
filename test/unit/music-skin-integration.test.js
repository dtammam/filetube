'use strict';

// [UNIT] Mobile music skins - INTEGRATION into the /music view (music.js). On a
// mobile viewport + a music item, the now-playing panel becomes the chosen skin,
// body.mms-on hides the default host chrome, and the skin's buttons PROXY to the
// player's existing hidden controls (#pp-btn / #track-prev/next-btn). Desktop /
// non-music get NONE of this. jsdom has no layout, but the render + gate + proxy
// wiring are fully testable.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const skinsPath = require.resolve('../../public/js/music-skins.js');

// The music view + a player host carrying the hidden controls the skin proxies to.
const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div class="music-toolbar"><div class="music-toolbar-actions">
    <select id="music-sort-select"></select><button id="music-view-toggle" hidden></button>
    <button id="music-theater-btn" hidden></button><button id="music-popout-btn" hidden></button><button id="music-shuffle-btn"></button><button id="music-scan-btn"></button>
  </div></div>
  <div id="music-stage">
    <div id="player-slot">
      <div id="player-wrapper"><video id="media-player"></video>
      <div id="player-controls">
        <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
        <input id="seek-bar" type="range" />
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

async function boot({ mobile, isMusic, run, skin, mockOverflow, smallOverflow, reducedMotion }) {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  if (mockOverflow) {
    // jsdom has no layout (scrollWidth=0), so fake an overflowing .ip-ttl to exercise
    // the marquee measurement path (the real scroll is device-verified). smallOverflow
    // gives a 24px overrun (raw dur 1.0s) to bind the 4s constant-speed floor.
    const scroll = smallOverflow ? 124 : 300;
    // any skin's title line: iPod .ip-ttl, Apple/Spotify .mms-ttl (v1.232.1 marquee-all).
    const isTitle = (el) => el.classList && (el.classList.contains('ip-ttl') || el.classList.contains('mms-ttl'));
    Object.defineProperty(dom.window.Element.prototype, 'scrollWidth', { configurable: true, get() { return isTitle(this) ? scroll : 0; } });
    Object.defineProperty(dom.window.Element.prototype, 'clientWidth', { configurable: true, get() { return isTitle(this) ? 100 : 0; } });
  }
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController, requestAnimationFrame: global.requestAnimationFrame, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  global.Event = dom.window.Event; // so music.js's `new Event('change')` is same-realm as the jsdom element (browser: === window.Event)
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.matchMedia = (q) => ({ matches: (/max-width:\s*768px/.test(q) ? !!mobile : (/prefers-reduced-motion/.test(q) ? !!reducedMotion : false)), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  dom.window.scrollTo = function () {};
  global.fetch = () => Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  const spy = { pp: 0, prev: 0, next: 0, seek: 0, dock: 0, shuffle: 0 };
  const meta = isMusic ? { isMusic: true, id: 't1', title: 'Track A', artist: 'NESTALGIA', album: 'Retro Mix', albumKey: 'k' } : { isMusic: false, id: 'v1', title: 'A Video' };
  let mod = null;
  dom.window.FileTube = {
    registerView: (n, m) => { mod = m; }, encodeListContext: () => '', decodeListContext: () => null, shimmerArt: () => {},
    player: { currentId: meta.id, getState: () => 'full', getCurrentMeta: () => meta, expand() {}, setTrackNav() {}, load() {}, dock() { spy.dock += 1; } },
  };
  // load the skins module into this window (sets window.FileTubeMusicSkins)
  delete require.cache[skinsPath]; global.module = undefined;
  require(skinsPath);
  dom.window.FileTubeMusicSkins = require(skinsPath);
  // v1.230: the Settings-page picker persists ft-music-skin; the music view reads it
  // on render. Preset it to simulate "picked in Settings, then opened the player".
  if (skin) dom.window.localStorage.setItem('ft-music-skin', skin);
  const D = dom.window.document;
  D.getElementById('pp-btn').addEventListener('click', () => { spy.pp += 1; });
  D.getElementById('track-prev-btn').addEventListener('click', () => { spy.prev += 1; });
  D.getElementById('track-next-btn').addEventListener('click', () => { spy.next += 1; });
  D.getElementById('seek-bar').addEventListener('change', () => { spy.seek += 1; });
  D.getElementById('music-shuffle-btn').addEventListener('click', () => { spy.shuffle += 1; });
  try {
    delete require.cache[musicPath];
    require(musicPath);
    mod.init(dom.window.document.getElementById('view-root'));
    for (let i = 0; i < 10; i++) await settle();
    await run(dom, spy, mod);
  } finally { delete require.cache[musicPath]; delete require.cache[skinsPath]; Object.assign(global, saved); }
}

const panel = (dom) => dom.window.document.getElementById('music-nowplaying-panel');

test('mobile + music: the now-playing panel becomes the skin, body.mms-on set, default chrome hidden', async () => {
  await boot({ mobile: true, isMusic: true, run: async (dom) => {
    const el = panel(dom);
    assert.match(el.className, /\bmms-full\b/, 'panel is the full skin');
    assert.match(el.className, /\bmms-apple\b/, 'default skin (apple) applied');
    assert.ok(dom.window.document.body.classList.contains('mms-on'), 'body.mms-on hides the default host chrome');
    assert.ok(el.querySelector('[data-skin-play]'), 'the skin renders its transport');
    assert.strictEqual(el.hidden, false, 'panel visible');
  } });
});

test('every transport button PROXIES to the real hidden control (engine untouched)', async () => {
  await boot({ mobile: true, isMusic: true, run: async (dom, spy) => {
    const p = panel(dom);
    const click = (sel) => p.querySelector(sel).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 10 }));
    click('[data-skin-play]'); assert.strictEqual(spy.pp, 1, 'play -> #pp-btn (primes bg-audio + toggles)');
    click('[data-skin-prev]'); assert.strictEqual(spy.prev, 1, 'prev -> #track-prev-btn (setTrackNav path)');
    click('[data-skin-next]'); assert.strictEqual(spy.next, 1, 'next -> #track-next-btn');
    click('[data-skin-seek]'); assert.strictEqual(spy.seek, 1, 'seek -> #seek-bar change (full pipeline: commit + saveProgress)');
    click('[data-skin-collapse]'); assert.strictEqual(spy.dock, 1, 'collapse -> player.dock() (the mini returns you)');
  } });
});

test('gate CRITICAL: destroy() CLEARS body.mms-on (else it collapses the next view\'s player)', async () => {
  await boot({ mobile: true, isMusic: true, run: async (dom, spy, mod) => {
    assert.ok(dom.window.document.body.classList.contains('mms-on'), 'active while the music view lives');
    mod.destroy(); // the router's teardown on nav-away
    assert.ok(!dom.window.document.body.classList.contains('mms-on'), 'cleared on destroy - watch/podcasts/read never inherit the 0-height takeover');
  } });
});

test('v1.230: the music view HONORS the skin persisted by the Settings picker (ft-music-skin)', async () => {
  // Skin picking lives on the Settings page now (no in-player switcher, no event).
  // It writes ft-music-skin; the music view reads that on render. Preset iPod and
  // confirm the now-playing renders the iPod skin, not the apple default.
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    assert.match(panel(dom).className, /\bmms-ipod\b/, 'renders the persisted skin (iPod)');
    assert.ok(!panel(dom).querySelector('[data-skin-set]'), 'no in-player switcher');
  } });
});

test('v1.231 iPod: Select toggles the song list; MENU steps back (list->now-playing->dock)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom, spy) => {
    const p = panel(dom);
    const click = (sel) => p.querySelector(sel).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.ok(!p.classList.contains('mms-listmode'), 'starts on Now Playing');
    click('[data-skin-select]');
    assert.ok(p.classList.contains('mms-listmode'), 'Select opens the song list');
    assert.strictEqual(p.querySelector('.ip-np').textContent, 'Songs', 'status bar follows the level');
    click('[data-skin-menu]');
    assert.ok(!p.classList.contains('mms-listmode'), 'MENU from the list returns to Now Playing');
    assert.strictEqual(spy.dock, 0, 'MENU on the list did NOT exit the player');
    click('[data-skin-menu]');
    assert.strictEqual(spy.dock, 1, 'MENU from Now Playing docks/exits the player (the way out)');
  } });
});

test('v1.231 iPod: tapping a song row (data-skin-go) leaves list mode', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    const p = panel(dom);
    p.querySelector('[data-skin-select]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.ok(p.classList.contains('mms-listmode'), 'in the list');
    // the live harness has an empty queue, so inject a row to exercise the hook -
    // playAt(0) safely no-ops on the empty queue; the list-mode clear is the point.
    const row = dom.window.document.createElement('button');
    row.className = 'mms-row'; row.setAttribute('data-skin-go', '0');
    p.querySelector('.ip-listview').appendChild(row);
    row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.ok(!p.classList.contains('mms-listmode'), 'tapping a row returns to Now Playing');
  } });
});

test('v1.231 Spotify: the shuffle button PROXIES to the real #music-shuffle-btn', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'spotify', run: async (dom, spy) => {
    const btn = panel(dom).querySelector('[data-skin-shuffle]');
    assert.ok(btn, 'spotify renders a shuffle control');
    btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(spy.shuffle, 1, 'shuffle -> #music-shuffle-btn (the real reshuffle)');
  } });
});

test('v1.232: the black iPod carries BOTH mms-ipod-black AND the base mms-ipod class', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod-black', run: async (dom) => {
    const cn = panel(dom).className;
    assert.match(cn, /\bmms-ipod-black\b/, 'the black id class (palette override)');
    assert.match(cn, /(^|\s)mms-ipod(\s|$)/, 'AND the base class, so all shared iPod CSS applies');
    assert.ok(panel(dom).querySelector('.ip-wheel'), 'renders the same iPod structure');
  } });
});

test('v1.232 iPod: a long title MARQUEES - wraps in .mms-mq + sets the shift/duration vars', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', mockOverflow: true, run: async (dom) => {
    const ttl = panel(dom).querySelector('.ip-ttl');
    assert.ok(ttl, 'has a title');
    assert.ok(ttl.classList.contains('mms-mq-on'), 'an overflowing title marquees');
    assert.ok(ttl.querySelector('.mms-mq'), 'the text is wrapped in a marquee span');
    assert.match(ttl.style.getPropertyValue('--mms-mq-shift'), /^-\d+px$/, 'shift = the negative overflow px');
    assert.ok(parseFloat(ttl.style.getPropertyValue('--mms-mq-dur')) >= 4, 'a constant-speed duration (>= the 4s floor)');
  } });
});

test('v1.232 iPod: a SMALL overflow floors the marquee duration at 4s (constant speed, not a fast twitch)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', mockOverflow: true, smallOverflow: true, run: async (dom) => {
    const ttl = panel(dom).querySelector('.ip-ttl');
    assert.ok(ttl.classList.contains('mms-mq-on'), 'still marquees a small overflow');
    // over=24px -> raw 24/24=1.0s -> Math.max(4, 1.0) = 4.0s (the floor).
    assert.strictEqual(ttl.style.getPropertyValue('--mms-mq-dur'), '4.0s', 'duration floored at 4s');
  } });
});

test('v1.232.4: the seek fill RESETS to 0 on a track swap (loadstart), not the old track fill', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'apple', run: async (dom) => {
    const fill = panel(dom).querySelector('.mms-fill');
    assert.ok(fill, 'apple has a scrubber fill');
    fill.style.width = '52%'; // simulate the previous track's position still showing
    const rem = panel(dom).querySelector('.mms-rem');
    if (rem) rem.textContent = '-1:23'; // stale remaining from the previous track
    const mp = dom.window.document.getElementById('media-player');
    // loadstart fires on a prev/next swap before playback; with no duration yet, the
    // fill must drop to 0 (not keep the stale 52%) - that was the "fill then refresh" flash.
    mp.dispatchEvent(new dom.window.Event('loadstart', { bubbles: true }));
    assert.strictEqual(fill.style.width, '0%', 'fill drops to 0 while the new track loads (no stale-fill flash)');
    // bind BOTH axes (the repo's reveal-once lesson): the remaining-time label clears too.
    if (rem) assert.strictEqual(rem.textContent, '', 'the remaining-time label clears while loading (not the stale value)');
  } });
});

test('v1.232.1: the marquee also applies to Apple/Spotify titles (.mms-ttl), not just iPod', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'apple', mockOverflow: true, run: async (dom) => {
    const ttl = panel(dom).querySelector('.mms-ttl');
    assert.ok(ttl, 'the Apple skin has a .mms-ttl');
    assert.ok(ttl.classList.contains('mms-mq-on'), 'an overflowing Apple title marquees too');
    assert.ok(ttl.querySelector('.mms-mq'), 'text wrapped in a marquee span');
  } });
});

test('v1.232 iPod: reduced-motion keeps the ellipsis (no marquee wrap)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', mockOverflow: true, reducedMotion: true, run: async (dom) => {
    const ttl = panel(dom).querySelector('.ip-ttl');
    assert.ok(!ttl.classList.contains('mms-mq-on'), 'no marquee under prefers-reduced-motion');
    assert.ok(!ttl.querySelector('.mms-mq'), 'text left as-is (keeps its ellipsis)');
  } });
});

test('DESKTOP + music: NO skin - the default panel renders, no mms-on', async () => {
  await boot({ mobile: false, isMusic: true, run: async (dom) => {
    const el = panel(dom);
    assert.doesNotMatch(el.className, /\bmms-full\b/, 'no skin on desktop');
    assert.ok(!dom.window.document.body.classList.contains('mms-on'), 'default host chrome intact on desktop');
  } });
});

test('mobile + NON-music (video/podcast/book): NO skin', async () => {
  await boot({ mobile: true, isMusic: false, run: async (dom) => {
    assert.doesNotMatch(panel(dom).className, /\bmms-full\b/, 'a non-music item never gets the music skin');
    assert.ok(!dom.window.document.body.classList.contains('mms-on'));
  } });
});

// ---- v1.233: the iPod click wheel ROTARY SCROLL (list-only cursor + accel) ----------
// The gesture uses Pointer events on .ip-wheel; jsdom has no layout (getBoundingClientRect
// is all-zero, so the wheel center is 0,0) but the angle math + cursor bookkeeping are
// fully exercisable. We inject list rows (the harness queue is empty) exactly as the
// v1.231 row test does, mark one .is-current, open the list, then dispatch a synthetic
// spin and assert the .is-cursor highlight moves. A big/fast sweep clamps at an end, which
// makes the direction assertions deterministic despite the accel timing.
function seedList(p, dom, n, currentIdx) {
  const lv = p.querySelector('.ip-listview');
  for (let i = 0; i < n; i++) {
    const row = dom.window.document.createElement('button');
    row.className = 'mms-row' + (i === currentIdx ? ' is-current' : '');
    row.setAttribute('data-skin-go', String(i));
    lv.appendChild(row);
  }
  return lv;
}
const openList = (p, dom) => p.querySelector('[data-skin-select]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const cursorIdx = (p) => { const c = p.querySelector('.ip-listview .mms-row.is-cursor'); return c ? parseInt(c.getAttribute('data-skin-go'), 10) : -1; };
function spin(wheel, dom, angles) {
  // pointerdown at 0deg (point on +x axis), then sweep through `angles` (degrees).
  const at = (deg) => { const rad = deg * Math.PI / 180; return { clientX: 100 * Math.cos(rad), clientY: 100 * Math.sin(rad) }; };
  const start = at(0);
  wheel.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: start.clientX, clientY: start.clientY }));
  angles.forEach((deg) => { const q = at(deg); wheel.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: q.clientX, clientY: q.clientY })); });
  wheel.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
}

test('v1.233 iPod: the cursor seeds on the CURRENT song when the list opens', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    const p = panel(dom);
    seedList(p, dom, 6, 2);
    openList(p, dom);
    await settle();
    assert.ok(p.classList.contains('mms-listmode'), 'list open');
    assert.strictEqual(cursorIdx(p), 2, 'cursor starts on the current (is-current) row');
  } });
});

test('v1.233 iPod: spinning the wheel CLOCKWISE moves the cursor DOWN the list', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    const p = panel(dom); seedList(p, dom, 6, 0); openList(p, dom); await settle();
    assert.strictEqual(cursorIdx(p), 0, 'cursor starts at row 0');
    spin(p.querySelector('.ip-wheel'), dom, [40, 80, 120, 160]); // a firm clockwise sweep
    assert.ok(cursorIdx(p) > 0, 'clockwise moved the cursor forward (down the list)');
    assert.strictEqual(cursorIdx(p), 5, 'a firm sweep clamps at the last row (never runs off the end)');
  } });
});

test('v1.233 iPod: spinning COUNTER-clockwise moves the cursor UP, clamped at the first row', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    const p = panel(dom); seedList(p, dom, 6, 5); openList(p, dom); await settle();
    assert.strictEqual(cursorIdx(p), 5, 'cursor starts at the last row');
    spin(p.querySelector('.ip-wheel'), dom, [-40, -80, -120, -160]);
    assert.ok(cursorIdx(p) < 5, 'counter-clockwise moved the cursor back (up the list)');
    assert.strictEqual(cursorIdx(p), 0, 'clamped at the first row (never negative)');
  } });
});

test('v1.233 iPod: a spin in Now Playing (list CLOSED) does nothing (Dean: list-only)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    const p = panel(dom); seedList(p, dom, 6, 2);
    assert.ok(!p.classList.contains('mms-listmode'), 'list is closed (Now Playing)');
    spin(p.querySelector('.ip-wheel'), dom, [40, 80, 120]);
    assert.strictEqual(cursorIdx(p), -1, 'no cursor engaged while the list is closed');
  } });
});

test('v1.233 iPod: a pure TAP on the wheel (no rotation) does NOT move the cursor', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    const p = panel(dom); seedList(p, dom, 6, 3); openList(p, dom); await settle();
    const wheel = p.querySelector('.ip-wheel');
    wheel.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    wheel.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    assert.strictEqual(cursorIdx(p), 3, 'a tap leaves the cursor put (only a rotation moves it)');
  } });
});

test('v1.233 iPod: a moved spin SWALLOWS exactly its release click, then never eats a later tap', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom, spy) => {
    const p = panel(dom); seedList(p, dom, 6, 0); openList(p, dom); await settle();
    spin(p.querySelector('.ip-wheel'), dom, [40, 80, 120]); // a real rotation => suppress armed
    // the synthetic click a real wheel would fire on release is swallowed:
    p.querySelector('[data-skin-play]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(spy.pp, 0, 'the spin-ending click did NOT trigger play');
    // ...but the very next real tap proceeds (the flag is one-shot / self-clearing):
    p.querySelector('[data-skin-play]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(spy.pp, 1, 'a later real tap is NOT eaten');
  } });
});

test('v1.233 iPod: center-select in the list PLAYS the cursor row and closes the list', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    const p = panel(dom); seedList(p, dom, 6, 1); openList(p, dom); await settle();
    spin(p.querySelector('.ip-wheel'), dom, [40, 80]); // move the cursor off the current
    const target = cursorIdx(p);
    assert.ok(target > 1, 'cursor advanced past the current');
    // center-select: reads the cursor row's data-skin-go and plays it (empty queue -> no-op
    // playAt is fine; the observable contract is the list closing after a cursor select).
    // A real follow-up tap carries its own pointerdown (which clears the spin's one-shot
    // click-suppress) before its click - simulate that fresh touch on a non-wheel target.
    p.querySelector('.ip-listview').dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
    p.querySelector('[data-skin-select]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.ok(!p.classList.contains('mms-listmode'), 'center-select from the list returns to Now Playing');
  } });
});

// ---- v1.233 gate fix-round binds (adversarial S1 pointerId + S2 dead-center) ---------
function ptr(dom, type, x, y, id) {
  const ev = new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(ev, 'pointerId', { value: id, configurable: true });
  return ev;
}

test('v1.233 iPod: a SECOND finger\'s moves are ignored (pointerId filter, no jitter jump)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    const p = panel(dom); seedList(p, dom, 6, 0); openList(p, dom); await settle();
    const wheel = p.querySelector('.ip-wheel');
    wheel.dispatchEvent(ptr(dom, 'pointerdown', 100, 0, 1));   // finger 1 owns the gesture
    // finger 2 rotates hard - must NOT move the cursor (its coords aren't finger 1's)
    [40, 80, 120, 160].forEach((deg) => { const r = deg * Math.PI / 180; wheel.dispatchEvent(ptr(dom, 'pointermove', 100 * Math.cos(r), 100 * Math.sin(r), 2)); });
    assert.strictEqual(cursorIdx(p), 0, 'a second finger does not move the cursor');
    // finger 1 rotates - now it moves
    [40, 80, 120, 160].forEach((deg) => { const r = deg * Math.PI / 180; wheel.dispatchEvent(ptr(dom, 'pointermove', 100 * Math.cos(r), 100 * Math.sin(r), 1)); });
    assert.ok(cursorIdx(p) > 0, 'the gesture\'s own finger moves the cursor');
    wheel.dispatchEvent(ptr(dom, 'pointerup', 0, 0, 1));
  } });
});

test('v1.233 iPod: a press on the dead-center (Select) never starts a spin; the ring does', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    const p = panel(dom); seedList(p, dom, 6, 0); openList(p, dom); await settle();
    const wheel = p.querySelector('.ip-wheel');
    // give the wheel a REAL rect (jsdom is all-zero): 200x200 at origin, center (100,100),
    // so the dead-center radius (r.width*0.2 = 40) is exercisable.
    wheel.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0 });
    const at = (cx, cy, deg, rad) => ({ x: cx + rad * Math.cos(deg * Math.PI / 180), y: cy + rad * Math.sin(deg * Math.PI / 180) });
    // press dead center (100,100): dist 0 < 40 -> ignored, no gesture; rotating does nothing.
    wheel.dispatchEvent(ptr(dom, 'pointerdown', 100, 100, 1));
    [0, 45, 90, 135].forEach((deg) => { const q = at(100, 100, deg, 20); wheel.dispatchEvent(ptr(dom, 'pointermove', q.x, q.y, 1)); });
    assert.strictEqual(cursorIdx(p), 0, 'a dead-center press does not scroll the list (Select tap passes through)');
    // press on the ring (radius 90): engages, and a sweep moves the cursor.
    wheel.dispatchEvent(ptr(dom, 'pointerdown', 100, 10, 2));
    [-45, 0, 45, 90].forEach((deg) => { const q = at(100, 100, deg, 90); wheel.dispatchEvent(ptr(dom, 'pointermove', q.x, q.y, 2)); });
    assert.ok(cursorIdx(p) > 0, 'a press on the wheel ring DOES scroll');
    wheel.dispatchEvent(ptr(dom, 'pointerup', 0, 0, 2));
  } });
});

// ---- v1.234: DESKTOP pop-out player (Document PiP + independent-window fallback) --------
// The pop-out is a SECOND skin surface rendered into a separate window/document. jsdom has
// no real Document PiP, so we stub documentPictureInPicture.requestWindow / window.open to
// return a fresh JSDOM window and assert the manager mounts the skin, proxies back to the
// MAIN controls, reflects live, and tears down. The pop-out button is desktop-only, so these
// boot with mobile:false; we click the (harmlessly hidden - empty test queue) button directly.
function makePipWindow() {
  const d = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/music' });
  const w = d.window;
  w.closed = false;
  w._closeCalls = 0;
  const orig = typeof w.close === 'function' ? w.close.bind(w) : function () {};
  w.close = function () { w._closeCalls += 1; w.closed = true; try { orig(); } catch (_) { /* jsdom */ } };
  return w;
}
const pipPanelOf = (w) => w.document.getElementById('music-nowplaying-panel');
const clickPopout = (dom) => dom.window.document.getElementById('music-popout-btn').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

test('v1.234 desktop: Document PiP renders the PICKED skin into the pop-out window', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom) => {
    const pip = makePipWindow();
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    const panel = pipPanelOf(pip);
    assert.ok(panel, 'a skin panel is mounted in the pop-out document');
    assert.match(panel.className, /\bmms-full\b/, 'it is the full skin');
    assert.match(panel.className, /\bmms-ipod\b/, 'it HONORS the picked skin (iPod)');
    assert.ok(pip.document.body.classList.contains('mms-on'), 'the pop-out body carries mms-on');
  } });
});

test('v1.234 desktop: window.open FALLBACK when Document PiP is unavailable', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'spotify', run: async (dom) => {
    const pip = makePipWindow();
    delete dom.window.documentPictureInPicture;
    dom.window.open = () => pip;
    clickPopout(dom); await settle(); await settle();
    const panel = pipPanelOf(pip);
    assert.ok(panel, 'mounts into the plain independent window');
    assert.match(panel.className, /\bmms-spotify\b/, 'honors the picked skin (Nordic/spotify) in the fallback too');
  } });
});

test('v1.234: the pop-out gets the app stylesheet(s) linked (skin is styled, not naked)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom) => {
    const link = dom.window.document.createElement('link'); link.rel = 'stylesheet'; link.href = '/css/style.css';
    dom.window.document.head.appendChild(link);
    const pip = makePipWindow();
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    const links = pip.document.querySelectorAll('link[rel="stylesheet"]');
    assert.ok(links.length >= 1, 'a stylesheet link is injected into the pop-out');
    assert.ok(Array.prototype.some.call(links, (l) => /style\.css/.test(l.href)), 'the app stylesheet is the one linked');
  } });
});

test('v1.234: a pop-out transport click PROXIES to the MAIN document controls (reachability, not a dead handler)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'apple', run: async (dom, spy) => {
    const pip = makePipWindow();
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    const play = pipPanelOf(pip).querySelector('[data-skin-play]');
    assert.ok(play, 'the pop-out skin has a play control');
    play.dispatchEvent(new pip.MouseEvent('click', { bubbles: true })); // an event from the POP-OUT realm
    assert.strictEqual(spy.pp, 1, 'the pop-out play reaches the MAIN #pp-btn (engine untouched)');
  } });
});

test('v1.234: the live element REFLECTS into the open pop-out (fill resets on a track swap)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'apple', run: async (dom) => {
    const pip = makePipWindow();
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    const fill = pipPanelOf(pip).querySelector('.mms-fill');
    assert.ok(fill, 'the pop-out skin has a scrubber fill');
    fill.style.width = '52%'; // simulate a stale position
    dom.window.document.getElementById('media-player').dispatchEvent(new dom.window.Event('loadstart', { bubbles: true }));
    assert.strictEqual(fill.style.width, '0%', 'a media event on the MAIN element reflects into the POP-OUT surface');
  } });
});

test('v1.234: closing the pop-out DROPS the surface (reflect stops touching it) - no dead-document query', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'apple', run: async (dom) => {
    const pip = makePipWindow();
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    const mp = dom.window.document.getElementById('media-player');
    const fill = pipPanelOf(pip).querySelector('.mms-fill');
    // live before close: a reflect resets it
    fill.style.width = '52%'; mp.dispatchEvent(new dom.window.Event('loadstart', { bubbles: true }));
    assert.strictEqual(fill.style.width, '0%', 'reflected while open');
    // close the pop-out (the window's pagehide fires the teardown)
    pip.dispatchEvent(new pip.Event('pagehide'));
    // after close, a reflect must NOT touch the dropped surface
    fill.style.width = '77%'; mp.dispatchEvent(new dom.window.Event('loadstart', { bubbles: true }));
    assert.strictEqual(fill.style.width, '77%', 'a CLOSED pop-out is no longer reflected (surface dropped)');
  } });
});

test('v1.234: destroy() (cross-view swap) CLOSES the pop-out window (it must not outlive the view)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'apple', run: async (dom, spy, mod) => {
    const pip = makePipWindow();
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    assert.ok(!pip.closed, 'open before destroy');
    mod.destroy();
    assert.ok(pip._closeCalls >= 1 && pip.closed, 'the pop-out window is closed on view destroy');
  } });
});

test('v1.234: the pop-out button is HIDDEN on mobile (the in-tab full-screen skin is used instead)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    assert.ok(dom.window.document.getElementById('music-popout-btn').hidden, 'no pop-out button on a mobile viewport');
  } });
});

// ---- v1.234 gate fix-round binds -------------------------------------------------------
test('v1.234: on desktop with a music track current, the pop-out button IS shown (gate S3: gates on the track, not the queue)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom) => {
    // the harness queue is empty (browsing-grid shape), but a music track is current -
    // the button must still show (popping out is most useful while browsing).
    assert.strictEqual(dom.window.document.getElementById('music-popout-btn').hidden, false, 'button shown on desktop with a current music track even when the queue is empty');
  } });
});

test('v1.234: a wide->narrow resize TEARS DOWN an open pop-out and hides the button (enforces never-both-live)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom) => {
    const pip = makePipWindow();
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    assert.ok(!pip.closed, 'pop-out open on the wide viewport');
    // now the window becomes narrow (mobile breakpoint) - the in-tab skin would take over
    dom.window.matchMedia = (q) => ({ matches: /max-width:\s*768px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    assert.ok(pip._closeCalls >= 1 && pip.closed, 'the pop-out is closed when the viewport crosses into narrow');
    assert.ok(dom.window.document.getElementById('music-popout-btn').hidden, 'the button hides on the narrow viewport');
  } });
});

test('v1.234: a Document-PiP grant that resolves AFTER destroy() is closed, never mounted (async TOCTOU)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom, spy, mod) => {
    const pip = makePipWindow();
    let resolveWin = null;
    dom.window.documentPictureInPicture = { requestWindow: () => new Promise((r) => { resolveWin = r; }) };
    clickPopout(dom); await settle(); // requestWindow pending
    mod.destroy();                    // view torn down while the grant is in flight (signal aborts)
    resolveWin(pip);                  // the window is granted AFTER destroy
    await settle(); await settle();
    // the abort guard closes the late-granted window and returns BEFORE mounting - the mount
    // path never calls close(), so `closed` here proves it was aborted, not mounted+frozen.
    assert.ok(pip._closeCalls >= 1 && pip.closed, 'the late-granted pop-out is closed, not left frozen/open (never mounted)');
  } });
});

test('v1.234: a double pagehide (close then re-entrant teardown) is idempotent - no throw, no double close', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom) => {
    const pip = makePipWindow();
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    pip.dispatchEvent(new pip.Event('pagehide'));
    pip.dispatchEvent(new pip.Event('pagehide')); // must be a clean no-op (state already nulled)
    assert.strictEqual(pip._closeCalls, 1, 'the window is closed exactly once across re-entrant teardowns');
  } });
});

test('v1.234: teardown explicitly DROPS the surface from the reflect set (splice bound, not just the isConnected backstop)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'apple', run: async (dom) => {
    const pip = makePipWindow();
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    const panel = pipPanelOf(pip);
    const mp = dom.window.document.getElementById('media-player');
    pip.dispatchEvent(new pip.Event('pagehide')); // teardown: splice + close
    // keep the panel CONNECTED (adopt into the main doc) so the isConnected backstop can't be
    // what drops it - only the explicit splice can. If the splice were gone, reflect would run.
    dom.window.document.body.appendChild(panel);
    assert.ok(panel.isConnected, 'panel kept connected for the test');
    panel.querySelector('.mms-fill').style.width = '77%';
    mp.dispatchEvent(new dom.window.Event('loadstart', { bubbles: true }));
    assert.strictEqual(panel.querySelector('.mms-fill').style.width, '77%', 'a torn-down surface is not reflected even while connected (explicit splice bound)');
  } });
});
