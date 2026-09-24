'use strict';

// [UNIT] Mobile music skins - INTEGRATION into the /music view (music.js). On a
// mobile viewport + a music item, the now-playing panel becomes the chosen skin,
// body.mms-on hides the default host chrome, and the skin's buttons PROXY to the
// player's existing hidden controls (#pp-btn / #track-prev/next-btn). Desktop /
// non-music get NONE of this. jsdom has no layout, but the render + gate + proxy
// wiring are fully testable.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM, VirtualConsole } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
// v1.317 (T1): the theatre control is the player's own #theater-btn, injected through
// player.js's one writer; the default player stub exposes it like the real api does.
const { ensureTheaterButton } = require('../../public/js/player.js');

// The music view + a player host carrying the hidden controls the skin proxies to.
const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div class="music-toolbar"><div class="music-toolbar-actions">
    <select id="music-sort-select"></select><button id="music-view-toggle" hidden></button>
    <button id="music-popout-btn" hidden></button><button id="music-shuffle-btn"></button><button id="music-scan-btn"></button>
    <div class="music-actions-wrap"><button id="music-actions-btn" type="button" hidden aria-haspopup="true" aria-expanded="false"></button><div class="mms-sticker-menu" id="music-actions-menu" role="menu" hidden></div></div>
  </div></div>
  <div id="music-stage">
    <div id="player-slot">
      <div id="player-wrapper"><video id="media-player"></video>
      <div id="player-controls">
        <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
        <input id="seek-bar" type="range" />
        <button id="settings-btn"></button>
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

async function boot({ mobile, isMusic, run, skin, mockOverflow, smallOverflow, reducedMotion, query, fetchImpl, navLog, playerOverride, runSync }) {
  // jsdom won't let location.replace be overridden - it hard-navigates and emits a jsdomError.
  // Capture that so a test can assert a /watch bounce was ATTEMPTED (reachability); the exact
  // URL + ::c strip are source-locked in audio-opens-in-music.test.js.
  let vcOpt = {};
  if (navLog) {
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => { navLog.push(e && e.message ? e.message : String(e)); });
    vcOpt = { virtualConsole: vc };
  }
  const dom = new JSDOM(VIEW_HTML, Object.assign({ url: 'http://localhost/music' + (query || '') }, vcOpt));
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
  global.fetch = fetchImpl || (() => Promise.resolve({ ok: true, json: async () => ({ items: [] }) }));
  const spy = { pp: 0, prev: 0, next: 0, seek: 0, dock: 0, shuffle: 0 };
  const meta = isMusic ? { isMusic: true, id: 't1', title: 'Track A', artist: 'NESTALGIA', album: 'Retro Mix', albumKey: 'k' } : { isMusic: false, id: 'v1', title: 'A Video' };
  let mod = null;
  dom.window.FileTube = {
    registerView: (n, m) => { mod = m; }, encodeListContext: () => '', decodeListContext: () => null, shimmerArt: () => {},
    player: playerOverride || { currentId: meta.id, getState: () => 'full', getCurrentMeta: () => meta, expand() {}, setTrackNav() {}, load() {}, dock() { spy.dock += 1; }, ensureTheaterButton: () => ensureTheaterButton(dom.window.document) },
  };
  // load the skins module into this window (sets window.FileTubeMusicSkins)
  delete require.cache[skinsPath]; global.module = undefined;
  require(skinsPath);
  dom.window.FileTubeMusicSkins = require(skinsPath);
  // v1.250 (F-UNIFY): music.js renders through the shared engine now - load it into this
  // window exactly as music.html does (after music-skins.js, before music.js).
  delete require.cache[surfacePath];
  require(surfacePath);
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
    if (runSync) await runSync(dom, spy, mod);   // inspect the SYNCHRONOUS post-init state (fetch still pending)
    for (let i = 0; i < 10; i++) await settle();
    if (run) await run(dom, spy, mod);
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

// ---- v1.239 (Dean): mobile Now-Playing wheel spin SCRUBS the timeline -----------------
// iOS makes media.volume read-only, so on the in-tab iPhone skin a Now-Playing spin (which
// used to be a no-op) now scrubs the playhead - the mobile analog of the pop-out's
// wheel-volume. jsdom stubs media, so make the shared element scrubbable: a backing
// currentTime + a fixed duration, so a spin moves the playhead and a release commits.
function makeScrubbable(dom, cur, dur) {
  const mp = dom.window.document.getElementById('media-player');
  let ct = cur;
  Object.defineProperty(mp, 'duration', { configurable: true, get: () => dur });
  Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => ct, set: (v) => { ct = Number(v); } });
  return mp;
}

test('v1.239 iPod: a Now-Playing spin SCRUBS the playhead forward, COMMITS on release, and does NOT engage the cursor', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom, spy) => {
    const p = panel(dom); const mp = makeScrubbable(dom, 150, 300); // mid-track
    seedList(p, dom, 6, 2); // rows present but the list is CLOSED - a scrub must not touch them
    assert.ok(!p.classList.contains('mms-listmode'), 'Now Playing (list closed)');
    spin(p.querySelector('.ip-wheel'), dom, [40, 80, 120, 160]); // firm clockwise
    assert.ok(mp.currentTime > 150, 'clockwise scrubbed the playhead FORWARD (live)');
    assert.strictEqual(spy.seek, 1, 'release committed via #seek-bar change (real pipeline: seekCommitTarget + saveProgress)');
    // "scrub, NOT cursor": a cursor-mode spin would have marked an .is-cursor row; scrub must not.
    assert.strictEqual(cursorIdx(p), -1, 'no list row became the cursor - this was a scrub, not a cursor move');
  } });
});

test('v1.239 iPod: a big BACKWARD Now-Playing spin clamps EXACTLY at 0 (never negative)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    const p = panel(dom); const mp = makeScrubbable(dom, 30, 300); // near the start (ratio 0.1)
    // ~ -320deg total (~0.89 of the track) from ratio 0.1 => drives well below 0, so the
    // lower clamp is genuinely EXERCISED (the adversarial's surviving mutant-C fixture gap).
    spin(p.querySelector('.ip-wheel'), dom, [-40, -80, -120, -160, -200, -240, -280, -320]);
    assert.strictEqual(mp.currentTime, 0, 'clamped exactly at 0 (deleting the Math.max(0,...) reds this)');
  } });
});

test('v1.239 iPod: a big FORWARD Now-Playing spin clamps EXACTLY at the duration (never past the end)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    const p = panel(dom); const mp = makeScrubbable(dom, 270, 300); // near the end (ratio 0.9)
    spin(p.querySelector('.ip-wheel'), dom, [40, 80, 120, 160, 200, 240, 280, 320]); // ~ +320deg
    assert.strictEqual(mp.currentTime, 300, 'clamped exactly at the duration (deleting the Math.min(1,...) reds this)');
  } });
});

test('v1.239 iPod: a pointercancel mid-scrub does NOT commit (no lost seek; next save carries it)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom, spy) => {
    const p = panel(dom); const mp = makeScrubbable(dom, 150, 300);
    const wheel = p.querySelector('.ip-wheel');
    const at = (deg) => { const rad = deg * Math.PI / 180; return { clientX: 100 * Math.cos(rad), clientY: 100 * Math.sin(rad) }; };
    wheel.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    [40, 80, 120].forEach((deg) => { const q = at(deg); wheel.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: q.clientX, clientY: q.clientY })); });
    wheel.dispatchEvent(new dom.window.MouseEvent('pointercancel', { bubbles: true }));
    assert.ok(mp.currentTime > 150, 'the live scrub still moved the playhead');
    assert.strictEqual(spy.seek, 0, 'but a CANCEL never dispatched the seek-bar commit');
  } });
});

test('v1.239 iPod: a Now-Playing spin with NO known duration is a safe no-op (loading track)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom, spy) => {
    const p = panel(dom); // duration left at the jsdom default (NaN) - no makeScrubbable
    spin(p.querySelector('.ip-wheel'), dom, [40, 80, 120]);
    assert.strictEqual(spy.seek, 0, 'no commit when there is no duration to scrub against');
  } });
});

test('v1.244 source-lock: a ?play open MOUNTS a full-screen skin cover immediately (covers #music-content), torn down only on the miss->list fallback', () => {
  const js = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  // v1.252 (QA gate W3): the cover is the SHARED mountEarlyCover now - one implementation
  // for BOTH ?play= arms; lock the helper's mechanics and that both arms call it.
  const h = /function mountEarlyCover\(\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(h, 'mountEarlyCover exists');
  assert.match(h[1], /coverEarly = !!\(SKINS && typeof SKINS\.skinActiveFor === 'function' && SKINS\.skinActiveFor\(\{ isMusic: true \}\)\)/, 'coverEarly gated on the mobile skin surface');
  assert.match(h[1], /if \(coverEarly && nowPlayingPanel\) \{[\s\S]*?classList\.add\('mms-on'\);[\s\S]*?nowPlayingPanel\.className = 'music-nowplaying-panel mms mms-full mms-'[\s\S]*?nowPlayingPanel\.hidden = false;/, 'mounts a full-screen skin cover immediately');
  // v1.301 (Dean): the cover paints the skin's DEVICE CHROME (renderFull with the no-current
  // ctx) as the launch frame, not a bare empty body that read as a jarring grey slab.
  assert.match(h[1], /SKINS\.renderFull\(_sid, buildSkinCtx\(-1\)\)/, 'the cover paints the skin device chrome, not an empty slab');
  // v1.301 (slim-gate SUGGESTION): the chrome render is wrapped in try/catch with a blank-cover
  // fallback, so a skin render that ever threw can never break the launch path. Bind the net.
  assert.match(h[1], /try \{[\s\S]*?SKINS\.renderFull\(_sid, buildSkinCtx\(-1\)\)[\s\S]*?\} catch \(_\) \{ nowPlayingPanel\.innerHTML = ''; \}/, 'the device-chrome render is guarded so a throw falls back to the blank cover');
  const m = /async function playTrackFromContinue\(trackId, bounceOnMiss\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(m, 'playTrackFromContinue exists');
  assert.match(m[1], /var coverEarly = mountEarlyCover\(\);/, 'the continue arm rides the shared cover');
  assert.match(js, /async function playListenItem\(mediaId\) \{\s*\n\s*mountEarlyCover\(\);/, 'the listen arm rides the shared cover too');
  // the ONLY path that shows the list (a non-bounce miss -> render) tears the cover down first
  assert.match(m[1], /straightToPlayerPending = false;[\s\S]*?document\.body\.classList\.remove\('mms-on'\);[\s\S]*?nowPlayingPanel\.hidden = true;[\s\S]*?\}\s*\n\s*await render\(\);/, 'the miss->list fallback clears the pending flag + tears the cover down before render()');
});

test('v1.244 (adversarial CRITICAL): the ?play cover SURVIVES init\'s synchronous epilogue (not torn down before paint)', async () => {
  // The REAL straight-to-player state: docked, nothing playing yet, ?play=, mobile skin.
  // playTrackFromContinue mounts the cover then suspends at its fetch; init then synchronously
  // runs its epilogue updateNowPlayingPanel() - which must NOT tear the cover down (the
  // straightToPlayerPending guard). Inspect SYNCHRONOUSLY right after init(), fetch still pending.
  const pending = new Promise(() => {}); // recent-listening never resolves -> stays suspended
  await boot({
    mobile: true, isMusic: true, skin: 'ipod', query: '?play=t1',
    playerOverride: { currentId: null, getState: () => 'docked', getCurrentMeta: () => null, expand() {}, setTrackNav() {}, load() {}, dock() {} },
    fetchImpl: () => Promise.resolve({ ok: true, json: () => pending }),
    runSync: async (dom) => {
      const p = dom.window.document.getElementById('music-nowplaying-panel');
      assert.ok(dom.window.document.body.classList.contains('mms-on'), 'body.mms-on stays set through init\'s epilogue');
      assert.match(p.className, /\bmms-full\b/, 'the full-screen skin cover is STILL mounted (not torn down before the skin paints)');
      assert.strictEqual(p.hidden, false, 'the cover is visible');
      // v1.301 (Dean, "the screen that launches before it loads"): the cover paints the skin's
      // DEVICE CHROME while the track loads, not a bare grey body. For the iPod skin that's the
      // click wheel + transport. Mutation guard: reverting mountEarlyCover to innerHTML='' drops
      // these and reds the test.
      assert.ok(p.querySelector('.ip-wheel'), 'the launch cover shows the click wheel (device chrome), not an empty slab');
      assert.ok(p.querySelector('[data-skin-play]'), 'the launch cover shows the transport while the track loads');
    },
  });
});

test('v1.244 source-lock: the straightToPlayerPending flag is RESET on destroy() and init() (no strand across the view swap)', () => {
  const js = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  // destroy() must clear the flag next to its mms-on removal (the v1.227 across-swap class)
  const d = /function destroy\(\) \{([\s\S]*?)\n {2}\}/.exec(js);
  assert.ok(d, 'destroy() exists');
  assert.match(d[1], /straightToPlayerPending = false;/, 'destroy() resets the cover flag');
  // init() starts it false so a fresh view never inherits a prior init's flag
  const i = /function init\(root\) \{([\s\S]{0,200})/.exec(js);
  assert.match(i[1], /straightToPlayerPending = false;/, 'init() resets the cover flag up front');
});

// ---- v1.242 (#2, Dean): HOLD rewind/ffwd = FAST-SCAN the timeline -----------------------
// Deterministic: intercept the ~400ms hold setTimeout and fire it by hand (no real wait).
// startScan steps currentTime immediately on the hold; the 200ms interval is left real (it
// never ticks within the synchronous test, and endWheel clears it on release).
function armHold(dom) {
  const real = dom.window.setTimeout;
  const holds = [];
  dom.window.setTimeout = (fn, ms) => { if (ms === 400) { holds.push(fn); return 987654; } return real(fn, ms); };
  return { fire: () => { const f = holds.shift(); if (f) f(); }, restore: () => { dom.window.setTimeout = real; } };
}
const zone = (p, sel) => p.querySelector(sel);

test('v1.242: HOLDING the ffwd zone fast-scans FORWARD, commits on release, and does NOT skip a track', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom, spy) => {
    const p = panel(dom); const mp = makeScrubbable(dom, 100, 300);
    const h = armHold(dom);
    const next = zone(p, '[data-skin-next]');
    next.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 90, clientY: 10 }));
    h.fire(); // the hold elapses -> startScan steps immediately
    assert.ok(mp.currentTime > 100, 'held ffwd scanned the playhead FORWARD');
    next.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    assert.strictEqual(spy.seek, 1, 'release committed the landed position via #seek-bar change');
    next.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(spy.next, 0, 'a HELD ffwd did NOT also skip to the next track (click suppressed)');
    h.restore();
  } });
});

test('v1.242: HOLDING the rewind zone scans BACKWARD (clamped at 0)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    const p = panel(dom); const mp = makeScrubbable(dom, 50, 300);
    const h = armHold(dom);
    const prev = zone(p, '[data-skin-prev]');
    prev.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    h.fire();
    assert.ok(mp.currentTime < 50, 'held rewind scanned BACKWARD');
    assert.ok(mp.currentTime >= 0, 'never negative');
    prev.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    h.restore();
  } });
});

test('v1.242: a QUICK tap on ffwd (hold never fires) still SKIPS a track', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom, spy) => {
    const p = panel(dom); makeScrubbable(dom, 100, 300);
    const h = armHold(dom); // captured but NOT fired = a quick release before the hold elapsed
    const next = zone(p, '[data-skin-next]');
    next.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 90, clientY: 10 }));
    next.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    next.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(spy.next, 1, 'a quick tap proxies to #track-next-btn (skip)');
    assert.strictEqual(spy.seek, 0, 'and never commits a scan');
    h.restore();
  } });
});

test('v1.242 (gate WARNING): a ROTATE during an active scan does NOT also scrub, and commits ONCE', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom, spy) => {
    const p = panel(dom); const mp = makeScrubbable(dom, 100, 300);
    const h = armHold(dom);
    const next = zone(p, '[data-skin-next]');
    next.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 90, clientY: 10 }));
    h.fire(); // scan engaged (st.moved = true)
    const afterScan = mp.currentTime;
    assert.ok(afterScan > 100, 'scan advanced the playhead');
    // now curve the thumb around the ring WITHOUT lifting - a rotation mid-scan
    const wheel = p.querySelector('.ip-wheel');
    [40, 80, 120].forEach((deg) => { const r = deg * Math.PI / 180; wheel.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 100 * Math.cos(r), clientY: 100 * Math.sin(r) })); });
    next.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    assert.strictEqual(spy.seek, 1, 'exactly ONE seek commit (the scan owns the gesture - no second scrub commit)');
    h.restore();
  } });
});

test('v1.242: a pointercancel mid-scan does NOT commit (no lost seek)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom, spy) => {
    const p = panel(dom); const mp = makeScrubbable(dom, 100, 300);
    const h = armHold(dom);
    const next = zone(p, '[data-skin-next]');
    next.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 90, clientY: 10 }));
    h.fire();
    assert.ok(mp.currentTime > 100, 'scanned');
    next.dispatchEvent(new dom.window.MouseEvent('pointercancel', { bubbles: true }));
    assert.strictEqual(spy.seek, 0, 'a cancel never dispatches the seek-bar commit');
    h.restore();
  } });
});

test('v1.242 source-lock: a rotate cancels the pending hold; endWheel clears the scan timer + interval', () => {
  // v1.250 (F-UNIFY): the fast-scan gesture lives in the shared engine now.
  const js = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'public', 'js', 'skin-surface.js'), 'utf8');
  // v1.303: a capture-mode gate (st.capture !== 'press'/'off') now sits between the hold-timer
  // clear and the capture. The lock ANCHORS on the moved branch's "cancel the pending hold"
  // comment so the span stays inside that branch (an un-anchored [\s\S]*? spanned all the way
  // from endWheel's clearTimeout to onDown's press-capture, making it vacuous - gate WARNING 1).
  assert.match(js, /cancel the pending hold[\s\S]*?clearTimeout\(st\.scanTimer\)[\s\S]*?st\.capture !== 'press' && st\.capture !== 'off'[\s\S]*?setPointerCapture/, 'the moved (rotate) branch clears the pending hold-timer, THEN the capture-mode gate captures');
  const ew = /function endWheel\(st, suppress\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(ew, 'endWheel exists');
  assert.match(ew[1], /clearTimeout\(st\.scanTimer\)/, 'endWheel clears the hold-timer (both end arms)');
  assert.match(ew[1], /clearInterval\(st\.scanInterval\)/, 'endWheel clears the scan interval (both end arms)');
});

test('v1.239 iPod: removing the early-return did NOT break tap-through - a Now-Playing wheel TAP still fires its zone', async () => {
  // The old `if (!listMode && !allowVolume) return;` used to short-circuit Now-Playing here;
  // now the handler proceeds to build the scrub gesture, so a pure TAP (no rotation) must
  // still leave its zone button click intact (moved=false -> no suppress). Bind it.
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom, spy) => {
    const p = panel(dom); makeScrubbable(dom, 150, 300);
    const prev = p.querySelector('[data-skin-prev]');
    // a real tap: pointerdown + pointerup with NO movement, then the synthetic click.
    prev.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    prev.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    prev.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(spy.prev, 1, 'the rewind zone tap still proxies to #track-prev-btn');
    assert.strictEqual(spy.seek, 0, 'a no-move tap never commits a scrub');
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
  // v1.235.x: the pop-out clock is a real 250ms setInterval on this window; left running it
  // keeps the test event loop alive (every pop-out test would hang). Make it INERT by default
  // - the dedicated clock test re-stubs these to capture/assert. Marquee/fade one-shots are
  // harmless (they resolve), only the repeating interval needs neutering.
  w.setInterval = function () { return 0; };
  w.clearInterval = function () {};
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

test('v1.234: a Document-PiP grant that resolves after a wide->narrow resize is closed, not mounted (both-live async seal)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom) => {
    const pip = makePipWindow();
    let resolveWin = null;
    dom.window.documentPictureInPicture = { requestWindow: () => new Promise((r) => { resolveWin = r; }) };
    clickPopout(dom); await settle();                 // grant pending, pipWin still null
    // window shrinks below 768px DURING the grant - the resize can't teardown (pipWin null)
    dom.window.matchMedia = (q) => ({ matches: /max-width:\s*768px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    resolveWin(pip); await settle(); await settle();  // grant resolves onto the now-narrow viewport
    assert.ok(pip._closeCalls >= 1 && pip.closed, 'mountPopout re-gates on popoutSupported() and closes the late grant on a narrow viewport (never both live)');
  } });
});

// ---- v1.235: the iPod wheel sets VOLUME in Now Playing (desktop pop-out only) -----------
function ptrOn(win, type, x, y, id) {
  const ev = new win.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(ev, 'pointerId', { value: id, configurable: true });
  return ev;
}
// spin the pop-out wheel through `angles` (deg) about the pop-out's zeroed rect origin.
function spinPip(pip, angles, id) {
  const wheel = pipPanelOf(pip).querySelector('.ip-wheel');
  const at = (deg) => { const r = deg * Math.PI / 180; return { x: 100 * Math.cos(r), y: 100 * Math.sin(r) }; };
  wheel.dispatchEvent(ptrOn(pip, 'pointerdown', 100, 0, id));
  angles.forEach((d) => { const q = at(d); wheel.dispatchEvent(ptrOn(pip, 'pointermove', q.x, q.y, id)); });
  wheel.dispatchEvent(ptrOn(pip, 'pointerup', 0, 0, id));
}
async function openPip(dom, skin) {
  const pip = makePipWindow();
  dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
  clickPopout(dom); await settle(); await settle();
  return pip;
}

test('v1.250 pop-out (Dean): a Now-Playing CLOCKWISE spin SCRUBS the playhead forward - volume untouched (wheel-volume retired)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom) => {
    const pip = await openPip(dom, 'ipod');
    const panel = pipPanelOf(pip);
    assert.ok(!panel.classList.contains('mms-listmode'), 'pop-out opens in Now Playing');
    const mp = dom.window.document.getElementById('media-player');
    makeScrubbable(dom, 150, 300);
    mp.volume = 0.5;
    spinPip(pip, [45, 90, 135, 180], 1); // a clockwise sweep
    assert.ok(mp.currentTime > 150, 'clockwise spin scrubbed the playhead forward ("like it does on mobile")');
    assert.strictEqual(mp.volume, 0.5, 'volume untouched - the v1.235 wheel-volume is retired');
    assert.ok(!panel.classList.contains('mms-voladj'), 'the volume bar never engages');
  } });
});

test('v1.250 pop-out: a COUNTER-clockwise spin scrubs backward and a pointerup COMMITS through the seek pipeline', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom) => {
    const pip = await openPip(dom, 'ipod');
    const mp = dom.window.document.getElementById('media-player');
    makeScrubbable(dom, 150, 300);
    let committed = 0;
    dom.window.document.getElementById('seek-bar').addEventListener('change', () => { committed += 1; });
    spinPip(pip, [-45, -90, -135, -180], 1); // counter-clockwise
    assert.ok(mp.currentTime < 150, 'counter-clockwise scrubbed backward');
    assert.ok(mp.currentTime >= 0, 'never below 0');
    assert.strictEqual(committed, 1, 'the release committed once via #seek-bar (persists like a real seek)');
  } });
});

test('v1.235: the IN-TAB skin (mobile / iOS) does NOT change volume on a Now-Playing spin (media.volume is read-only there)', async () => {
  await boot({ mobile: true, isMusic: true, skin: 'ipod', run: async (dom) => {
    const p = panel(dom); // the in-tab skin panel (mobile)
    assert.ok(!p.classList.contains('mms-listmode'), 'in-tab starts on Now Playing');
    const mp = dom.window.document.getElementById('media-player');
    mp.volume = 0.5;
    // spin the in-tab wheel (its rect is zeroed too); allowVolume is false here
    const wheel = p.querySelector('.ip-wheel');
    wheel.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    [45, 90, 135].forEach((deg) => { const r = deg * Math.PI / 180; wheel.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 100 * Math.cos(r), clientY: 100 * Math.sin(r) })); });
    wheel.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    assert.strictEqual(mp.volume, 0.5, 'volume untouched on iPhone (no inert gesture shipped)');
    assert.ok(!p.classList.contains('mms-voladj'), 'no volume bar on the in-tab skin');
  } });
});

test('v1.235 pop-out: in LIST mode the spin still scrolls the cursor, NOT volume', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom) => {
    const pip = await openPip(dom, 'ipod');
    const panel = pipPanelOf(pip);
    // seed rows + open the list in the pop-out
    const lv = panel.querySelector('.ip-listview');
    for (let i = 0; i < 6; i++) { const b = pip.document.createElement('button'); b.className = 'mms-row' + (i === 0 ? ' is-current' : ''); b.setAttribute('data-skin-go', String(i)); lv.appendChild(b); }
    panel.querySelector('[data-skin-select]').dispatchEvent(new pip.MouseEvent('click', { bubbles: true }));
    await settle();
    assert.ok(panel.classList.contains('mms-listmode'), 'list open in the pop-out');
    const mp = dom.window.document.getElementById('media-player');
    mp.volume = 0.5;
    spinPip(pip, [45, 90, 135, 180], 1);
    assert.strictEqual(mp.volume, 0.5, 'list-mode spin does not touch volume (it is cursor scroll)');
    const cur = panel.querySelector('.ip-listview .mms-row.is-cursor');
    assert.ok(cur && parseInt(cur.getAttribute('data-skin-go'), 10) > 0, 'the cursor moved instead');
  } });
});

test('v1.235.x pop-out: an OWN-window timer drives the clock (unfrozen when the main tab is throttled in PiP)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom) => {
    const pip = makePipWindow();
    let clockFn = null, clockMs = null, clearedId = null;
    pip.setInterval = (fn, ms) => { clockFn = fn; clockMs = ms; return 777; };
    pip.clearInterval = (id) => { clearedId = id; };
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    assert.strictEqual(typeof clockFn, 'function', 'a clock timer is started on the POP-OUT window (not the throttled main tab)');
    assert.ok(clockMs > 0 && clockMs <= 500, 'at a live-clock cadence (~4Hz)');
    // the own-window tick reflects the live element with NO main-tab timeupdate fired:
    const fill = pipPanelOf(pip).querySelector('.mms-fill');
    fill.style.width = '99%';
    clockFn();
    assert.strictEqual(fill.style.width, '0%', 'the tick reflects the live element (dur=0 in jsdom -> 0%), so the clock is not frozen');
    // teardown clears the timer on the pop-out window
    pip.dispatchEvent(new pip.Event('pagehide'));
    assert.strictEqual(clearedId, 777, 'teardown clears the pop-out clock on its own window');
  } });
});

// ---- v1.235 gate fix-round binds -------------------------------------------------------
test('v1.250: a pop-out spin arms NO volume fade timer (the v1.235 fade machinery retired with wheel-volume)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom) => {
    const pip = makePipWindow();
    let setCalls = 0;
    const realSetTimeout = pip.setTimeout;
    pip.setTimeout = (fn, ms) => { if (ms === 1000) setCalls += 1; return realSetTimeout ? realSetTimeout(fn, ms) : 0; };
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    makeScrubbable(dom, 150, 300);
    spinPip(pip, [30, 60], 1);
    assert.strictEqual(setCalls, 0, 'no 1s fade timer armed - the volume bar machinery is gone');
  } });
});

test('v1.235 fix: a tiny volume nudge (< 8px travel) does NOT suppress a following wheel-zone tap', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom, spy) => {
    const pip = await openPip(dom, 'ipod');
    const panel = pipPanelOf(pip);
    const wheel = panel.querySelector('.ip-wheel');
    wheel.dispatchEvent(ptrOn(pip, 'pointerdown', 100, 0, 1));
    wheel.dispatchEvent(ptrOn(pip, 'pointermove', 100, 2, 1)); // ~2px travel (a jittery tap), > 0.5deg though
    wheel.dispatchEvent(ptrOn(pip, 'pointerup', 100, 2, 1));
    panel.querySelector('[data-skin-play]').dispatchEvent(new pip.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(spy.pp, 1, 'the small-nudge release did not swallow the next zone tap (8px threshold, not 0.5deg)');
  } });
});

test('v1.235 fix: a double-click during the async grant opens only ONE pop-out window (pipPending)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom) => {
    const wins = []; const resolvers = [];
    dom.window.documentPictureInPicture = { requestWindow: () => new Promise((r) => { const w = makePipWindow(); wins.push(w); resolvers.push(function () { r(w); }); }) };
    clickPopout(dom);   // first - starts the grant, sets pipPending
    clickPopout(dom);   // second - during the pending grant, must be ignored
    await settle();
    assert.strictEqual(wins.length, 1, 'only ONE requestWindow issued during the pending grant (no double always-on-top window)');
    resolvers[0](); await settle(); await settle();
    pipPanelOf(wins[0]).ownerDocument.defaultView.dispatchEvent(new wins[0].Event('pagehide')); // tidy
  } });
});

test('v1.235: closing then re-opening the pop-out re-arms the clock (no stale/duplicate timer)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod', run: async (dom) => {
    const intervals = [];
    function mk() {
      const w = makePipWindow();
      w.setInterval = (fn, ms) => { intervals.push({ fn: fn, ms: ms, cleared: false }); return intervals.length; };
      w.clearInterval = (id) => { if (intervals[id - 1]) intervals[id - 1].cleared = true; };
      return w;
    }
    let pip = mk();
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    assert.strictEqual(intervals.length, 1, 'clock armed on open');
    pip.dispatchEvent(new pip.Event('pagehide'));
    assert.ok(intervals[0].cleared, 'clock cleared on close');
    pip = mk();
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    assert.strictEqual(intervals.length, 2, 're-open arms a fresh clock (no duplicate/stale timer)');
  } });
});

// ---- v1.236: rerouted-but-unresolvable audio BOUNCES to /watch (no dead end) -----------
test('v1.236: /music?play=<id> for a NON-resolvable id BOUNCES (attempts a navigation, not a dead-end browse view)', async () => {
  // recent-listening empty + /api/music/:id has no .id -> a miss. playTrackFromContinue must
  // REACH its final /watch bounce (not throw earlier), which jsdom surfaces as a navigation
  // attempt. Proves reachability; the exact /watch URL + ::c strip are source-locked.
  const navLog = [];
  const fetchImpl = () => Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  // &ao=1 = the reroute origin -> a miss bounces to /watch. (A bare ?play= would NOT bounce; see below.)
  await boot({ mobile: false, isMusic: true, query: '?play=ghost123&ao=1', fetchImpl, navLog, run: async () => {
    for (let i = 0; i < 12; i++) await settle();
    assert.ok(navLog.some((m) => /navigation/i.test(m)), 'the reroute miss reached location.replace (a /watch bounce), not the browse-view dead-end');
  } });
});

test('v1.236 (W1): a BARE ?play= miss (a legacy continue-listening card, no ao) does NOT bounce to /watch', async () => {
  const navLog = [];
  const fetchImpl = () => Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  await boot({ mobile: false, isMusic: true, query: '?play=native5', fetchImpl, navLog, run: async () => {
    for (let i = 0; i < 12; i++) await settle();
    assert.strictEqual(navLog.length, 0, 'a native continue-card miss stays in the music view (render()), never /watch (no regression)');
  } });
});

test('v1.236 (M10): a rerouted id NOT in recent but RESOLVABLE plays in music - no bounce (the common reroute case)', async () => {
  const navLog = [];
  // recent-listening empty (idx<0) BUT /api/music/song7 resolves to a real track (no albumKey)
  // -> queue=[t]; playAt(0); return. Must NOT fall through to the /watch bounce.
  const fetchImpl = (url) => Promise.resolve({ ok: true, json: async () => (/\/api\/music\/song7(\?|$)/.test(String(url)) ? { id: 'song7', title: 'Song 7' } : { items: [] }) });
  await boot({ mobile: false, isMusic: true, query: '?play=song7&ao=1', fetchImpl, navLog, run: async () => {
    for (let i = 0; i < 12; i++) await settle();
    assert.strictEqual(navLog.length, 0, 'a resolvable rerouted track plays in the music player and is NOT bounced to /watch');
  } });
});

// ---- v1.252 (Dean): LISTEN-MODE - a video played as audio in this presentation ----------

function listenPlayer(calls) {
  const p = {
    currentId: null,
    _meta: null,
    getState: () => 'full',
    getCurrentMeta: () => p._meta,
    expand() {}, dock() {},
    setTrackNav: (nav) => { calls.navs.push(nav || {}); },
    load: (id, data, opts) => {
      calls.loads.push({ id, data, opts: opts || {} });
      p.currentId = id;
      p._meta = { isMusic: true, id, title: data.title, artist: data.channelName, album: data.album, albumKey: data.albumKey };
    },
  };
  return p;
}
function listenFetch(log, videoBody) {
  return (u, init) => {
    const url = String(u);
    log.push({ url, method: (init && init.method) || 'GET' });
    if (/^\/api\/videos\//.test(url)) {
      return Promise.resolve(videoBody
        ? { ok: true, json: async () => videoBody }
        : { ok: false, status: 404, json: async () => ({ error: 'Media file not found' }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
}
const LISTEN_VIDEO = { id: 'vid1', title: 'A Long Video', channelName: 'The Channel', folderName: 'The Channel', duration: 903, type: 'video', filePath: '/lib/a.mp4' };

test('v1.252 listen=1: the video plays as a SINGLE listen track through the media routes - skin up, no prev/next, no music-API touch', async () => {
  const calls = { loads: [], navs: [] };
  const log = [];
  await boot({
    mobile: true, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, LISTEN_VIDEO), playerOverride: listenPlayer(calls),
    run: async (dom) => {
      assert.strictEqual(calls.loads.length, 1, 'exactly one load');
      const { id, data } = calls.loads[0];
      assert.strictEqual(id, 'vid1');
      assert.strictEqual(data.type, 'audio', 'presented as audio (the skin/lock-screen posture)');
      assert.strictEqual(data.streamSrc, '/video/vid1', 'streams the MEDIA byte route (the whole trick)');
      assert.strictEqual(data.artUrl, '/thumbnail/vid1', 'the video thumbnail is the art');
      assert.strictEqual(data.progressEndpoint, '/api/progress', 'the MEDIA progress store - the position carries watch<->listen');
      assert.strictEqual(data.channelName, 'The Channel', 'the channel is the artist line');
      // the skin took over (the full music presentation)
      assert.match(panel(dom).className, /\bmms-full\b/, 'the skin painted for the listen track');
      // single track: the nav registration carries NEITHER prev NOR next (the v1 intake)
      assert.ok(calls.navs.length >= 1, 'setTrackNav ran');
      const lastNav = calls.navs[calls.navs.length - 1];
      assert.strictEqual(lastNav.onPrev, undefined, 'no prev on a single-track listen');
      assert.strictEqual(lastNav.onNext, undefined, 'no next on a single-track listen');
      // no Music membership and no music-surface resolution:
      assert.ok(log.some((c) => c.url === '/api/videos/vid1'), 'resolved via /api/videos');
      assert.ok(!log.some((c) => c.url.indexOf('/api/music/resume') === 0), 'the music resume pointer is NEVER written for a listen track');
      assert.ok(!log.some((c) => c.url === '/api/music/vid1'), 'the listen id never resolves through the music track API');
      assert.ok(log.some((c) => c.url.indexOf('/api/music/albums') === 0), 'the S5 background browse rendered (the dock lands on real content)');
    },
  });
});

test('v1.252 both-axes: a NORMAL music track still writes the music resume pointer (the listen skip did not over-reach)', async () => {
  const calls = { loads: [], navs: [] };
  const log = [];
  const track = { id: 't9', title: 'Song', artist: 'Band', album: '', albumKey: '', durationSec: 100, source: 'library', streamSrc: '/video/t9' };
  const fetchImpl = (u, init) => {
    const url = String(u);
    log.push({ url, method: (init && init.method) || 'GET' });
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [track] }) });
    if (/^\/api\/music\/t9$/.test(url)) return Promise.resolve({ ok: true, json: async () => track });
    if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot({
    mobile: true, isMusic: true, query: '?play=t9',
    fetchImpl, playerOverride: listenPlayer(calls),
    run: async () => {
      assert.strictEqual(calls.loads.length >= 1, true, 'the track loaded');
      assert.ok(log.some((c) => c.url === '/api/music/resume' && c.method === 'POST'), 'a normal play still records the Continue-listening pointer');
    },
  });
});

test('v1.252 listen miss: an unresolvable id returns to the watch surface (never a dead music list)', async () => {
  const calls = { loads: [], navs: [] };
  const log = [];
  const navLog = [];
  await boot({
    mobile: true, isMusic: true, query: '?play=ghost&listen=1',
    fetchImpl: listenFetch(log, null), playerOverride: listenPlayer(calls), navLog,
    run: async () => {
      assert.strictEqual(calls.loads.length, 0, 'nothing loaded on a miss');
      assert.ok(navLog.some((m) => /navigation/i.test(m)), 'the miss reached location.replace (a /watch return), not a blank list');
    },
  });
});

test('v1.252 Extras interop: the listen track (library-backed by construction) gets the sticker Extras entry', async () => {
  const calls = { loads: [], navs: [] };
  const log = [];
  await boot({
    mobile: true, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, LISTEN_VIDEO), playerOverride: listenPlayer(calls),
    run: async (dom) => {
      const st = panel(dom).querySelector('[data-skin-sticker]');
      assert.ok(st, 'the sticker painted');
      st.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      const menu = panel(dom).querySelector('[data-skin-sticker-menu]');
      assert.ok(menu.querySelector('[data-skin-extras]'), 'the v1.249 Extras entry shows for the listen track');
    },
  });
});

test('v1.252 the Watch way back: page 1 offers "Watch" for a LISTEN track, taps navigate to the watch page; a NORMAL track never shows it', async () => {
  const calls = { loads: [], navs: [] };
  const log = [];
  await boot({
    mobile: true, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, LISTEN_VIDEO), playerOverride: listenPlayer(calls),
    run: async (dom) => {
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const st = panel(dom).querySelector('[data-skin-sticker]');
      st.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      const menu = panel(dom).querySelector('[data-skin-sticker-menu]');
      const wb = menu.querySelector('[data-skin-watchback]');
      assert.ok(wb, 'the "Watch" row renders on page 1 for a listen track');
      assert.match(wb.textContent, /Watch/, 'labeled Watch');
      wb.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.deepStrictEqual(navs, ['/watch.html?v=vid1'], 'the tap navigates back to THIS video\'s watch page');
      assert.strictEqual(menu.hidden, true, 'the menu closed on the way out');
    },
  });
});

test('v1.252 the Watch way back (negative axis): a NORMAL music track\'s page 1 has no Watch row', async () => {
  const calls = { loads: [], navs: [] };
  const track = { id: 't9', title: 'Song', artist: 'Band', album: '', albumKey: '', durationSec: 100, source: 'library', streamSrc: '/video/t9' };
  const fetchImpl = (u, init) => {
    const url = String(u);
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [track] }) });
    if (/^\/api\/music\/t9$/.test(url)) return Promise.resolve({ ok: true, json: async () => track });
    if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot({
    mobile: true, isMusic: true, query: '?play=t9',
    fetchImpl, playerOverride: listenPlayer(calls),
    run: async (dom) => {
      panel(dom).querySelector('[data-skin-sticker]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      const menu = panel(dom).querySelector('[data-skin-sticker-menu]');
      assert.ok(menu.querySelector('[data-skin-speed]'), 'the quick menu rendered (non-vacuous)');
      assert.strictEqual(menu.querySelector('[data-skin-watchback]'), null, 'no Watch row for a normal track');
    },
  });
});

test('v1.252 (QA gate W1): the Watch way back SURVIVES a dock round-trip re-init (the module-scoped listen marker)', async () => {
  // The scenario QA proved: dock (MENU) -> tap the mini -> /music?nowplaying=1 re-inits the
  // view; render() rebuilds `queue` from the audio-only projection (the listen VIDEO is never
  // in it), so a queue-only lookup lost the Watch row for the rest of the session. The
  // module-scoped activeListenId (set by playListenItem, surviving the re-init like
  // nowPlaying does) is the fix - bind the full round trip.
  const calls = { loads: [], navs: [] };
  const log = [];
  await boot({
    mobile: true, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, LISTEN_VIDEO), playerOverride: listenPlayer(calls),
    run: async (dom, spy, mod) => {
      assert.strictEqual(calls.loads.length, 1, 'the listen track loaded (populated first)');
      // the dock round trip: the view re-inits at /music?nowplaying=1 with the SAME module
      // instance (no re-require - exactly the SPA dock-return), the player still holding vid1.
      mod.destroy();
      dom.window.history.replaceState({}, '', '/music?nowplaying=1');
      mod.init(dom.window.document.getElementById('view-root'));
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      const st = panel(dom).querySelector('[data-skin-sticker]');
      assert.ok(st, 'the skin re-painted on the dock-return');
      st.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      const menu = panel(dom).querySelector('[data-skin-sticker-menu]');
      assert.ok(menu.querySelector('[data-skin-speed]'), 'the quick menu rendered (non-vacuous)');
      assert.ok(menu.querySelector('[data-skin-watchback]'), 'the Watch row SURVIVES the re-init (the queue lookup misses; the marker carries)');
      // adversarial W2 - the END-OF-SESSION axis: a NORMAL play on the SAME module instance
      // (a third re-init through the continue arm) must CLEAR the marker; the Watch row is
      // gone while the quick menu still renders (non-vacuous both ways). This kills the
      // never-cleared mutant the survive-axis test alone let live.
      mod.destroy();
      dom.window.history.replaceState({}, '', '/music?play=t9');
      global.fetch = (u, init) => {
        const url = String(u);
        const track = { id: 't9', title: 'Song', artist: 'Band', album: '', albumKey: '', durationSec: 100, source: 'library', streamSrc: '/video/t9' };
        if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [track] }) });
        if (/^\/api\/music\/t9$/.test(url)) return Promise.resolve({ ok: true, json: async () => track });
        if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      };
      mod.init(dom.window.document.getElementById('view-root'));
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      const st2 = panel(dom).querySelector('[data-skin-sticker]');
      assert.ok(st2, 'the skin painted for the normal track');
      st2.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      const menu2 = panel(dom).querySelector('[data-skin-sticker-menu]');
      assert.ok(menu2.querySelector('[data-skin-speed]'), 'quick menu up (non-vacuous)');
      assert.strictEqual(menu2.querySelector('[data-skin-watchback]'), null, 'the normal play ENDED the listen session - no stale Watch row');
      // ...and the DISTINCT stale-marker kill (adversarial W2's constructed harm): the OLD
      // listen id plays again through a NON-listen path while the queue cannot resolve it -
      // the queue lookup MISSES and only the (must-be-cleared) marker could answer. With the
      // never-cleared mutant the stale marker resurrects a Watch row here; committed code
      // says no. (Phase 3 alone could not kill it - t9 HITS the queue and short-circuits.)
      mod.destroy();
      dom.window.history.replaceState({}, '', '/music?nowplaying=1');
      global.fetch = () => Promise.resolve({ ok: true, json: async () => ({ items: [] }) }); // nothing resolvable - queue stays empty
      dom.window.FileTube.player.currentId = 'vid1';
      dom.window.FileTube.player._meta = { isMusic: true, id: 'vid1', title: 'A Long Video', artist: 'The Channel', album: '', albumKey: '' };
      mod.init(dom.window.document.getElementById('view-root'));
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      const st3 = panel(dom).querySelector('[data-skin-sticker]');
      assert.ok(st3, 'the skin painted (populated first)');
      st3.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      const menu3 = panel(dom).querySelector('[data-skin-sticker-menu]');
      assert.ok(menu3.querySelector('[data-skin-speed]'), 'quick menu up (non-vacuous)');
      assert.strictEqual(menu3.querySelector('[data-skin-watchback]'), null, 'the CLEARED marker cannot resurrect a Watch row on a queue miss (the stale-marker axis)');
    },
  });
});

test('v1.253 (Dean, listen-art): the skin cover renders the track\'s OWN artUrl - fresh listen, dock-return re-init, and the /albumart both-axes', async () => {
  // Dean's device report: the listen title showed but the art never loaded. buildSkinCtx
  // hardcoded /albumart/<id> - and the server's /albumart thumbnail fallback serves type
  // 'audio' only, so a listen (VIDEO) id got the placeholder SVG. Bind all three arms:
  // the explicit-artUrl preference, the re-init marker fallback (the rebuilt queue misses
  // the listen track), and the /albumart default for an artUrl-less track (no over-reach).
  const calls = { loads: [], navs: [] };
  const log = [];
  await boot({
    mobile: true, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, LISTEN_VIDEO), playerOverride: listenPlayer(calls),
    run: async (dom, spy, mod) => {
      // arm 1: the fresh listen paints the VIDEO THUMBNAIL as the cover
      const art1 = panel(dom).querySelector('.mms-art-img');
      assert.ok(art1, 'the skin cover img rendered (populated first)');
      assert.strictEqual(art1.getAttribute('src'), '/thumbnail/vid1', 'the cover is the video thumbnail, not the /albumart hardcode');
      // arm 2: the dock-return re-init - the rebuilt queue MISSES the listen track, so only
      // the activeListenId marker can supply the thumbnail route (delete the fallback and
      // this reverts to /albumart/vid1 -> the placeholder SVG Dean saw).
      mod.destroy();
      dom.window.history.replaceState({}, '', '/music?nowplaying=1');
      mod.init(dom.window.document.getElementById('view-root'));
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      const art2 = panel(dom).querySelector('.mms-art-img');
      assert.ok(art2, 'the skin re-painted a cover on the dock-return');
      assert.strictEqual(art2.getAttribute('src'), '/thumbnail/vid1', 'the re-init cover still resolves via the listen marker (the queue lookup misses)');
      // arm 3 (both-axes): an artUrl-LESS track keeps the /albumart route - the preference
      // must not over-reach onto native tracks (whose art is the extracted album-art file).
      mod.destroy();
      dom.window.history.replaceState({}, '', '/music?play=t9');
      global.fetch = (u, init) => {
        const url = String(u);
        const track = { id: 't9', title: 'Song', artist: 'Band', album: '', albumKey: '', durationSec: 100 };
        if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [track] }) });
        if (/^\/api\/music\/t9$/.test(url)) return Promise.resolve({ ok: true, json: async () => track });
        if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      };
      mod.init(dom.window.document.getElementById('view-root'));
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      const art3 = panel(dom).querySelector('.mms-art-img');
      assert.ok(art3, 'the skin painted the normal track\'s cover (non-vacuous)');
      assert.strictEqual(art3.getAttribute('src'), '/albumart/t9', 'an artUrl-less track keeps the /albumart route');
    },
  });
});

test('v1.253 (adversarial W2): the DESKTOP now-playing panel rows carry the track\'s own artUrl - a listen row shows the video thumbnail, an artUrl-less row keeps /albumart', async () => {
  // Adversarial-measured gap: both desktop arms (the updateNowPlayingPanel row
  // projection carrying queue[j].artUrl, and buildNowPlayingPanelHtml's
  // musicArtUrl call) survived reverts with the whole suite green - and desktop
  // is exactly where Listen renders THESE rows (no skin off-mobile), so a silent
  // revert resurrects Dean's placeholder-art bug there. Bind both arms.
  const calls = { loads: [], navs: [] };
  const log = [];
  await boot({
    mobile: false, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, LISTEN_VIDEO), playerOverride: listenPlayer(calls),
    run: async (dom, spy, mod) => {
      const thumb1 = panel(dom).querySelector('.mnp-queue-thumb');
      assert.ok(thumb1, 'the desktop panel rendered a queue row (populated first - no skin on desktop)');
      assert.strictEqual(thumb1.getAttribute('src'), '/thumbnail/vid1', 'the listen row art is the video thumbnail (kills the row-projection AND helper reverts)');
      // both-axes: a normal artUrl-less track's row keeps the /albumart route
      mod.destroy();
      dom.window.history.replaceState({}, '', '/music?play=t9');
      global.fetch = (u, init) => {
        const url = String(u);
        const track = { id: 't9', title: 'Song', artist: 'Band', album: '', albumKey: '', durationSec: 100 };
        if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [track] }) });
        if (/^\/api\/music\/t9$/.test(url)) return Promise.resolve({ ok: true, json: async () => track });
        if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      };
      mod.init(dom.window.document.getElementById('view-root'));
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      const thumb2 = panel(dom).querySelector('.mnp-queue-thumb');
      assert.ok(thumb2, 'the normal track\'s panel row rendered (non-vacuous)');
      assert.strictEqual(thumb2.getAttribute('src'), '/albumart/t9', 'an artUrl-less row keeps the /albumart route (no over-reach)');
    },
  });
});

// ---- v1.254 ENDLESS AUTOPLAY (Dean's locked intake) --------------------------------

test('v1.254 autoplay: the LAST track VISIBLY extends the queue (same-artist first, no session/queue repeats, nav re-armed); toggled OFF = dead', async () => {
  const calls = { loads: [], navs: [] };
  const log = [];
  const t9 = { id: 't9', title: 'Song', artist: 'Band', album: '', albumKey: '', durationSec: 100 };
  const t8 = { id: 't8', title: 'Other', artist: 'Band', album: '', albumKey: '', durationSec: 90 };
  // the artist arm returns the CURRENT track too (the server would) - the picker must skip it;
  // the library arm repeats b1 - the picker must not double-append it. FOUR eligible artist
  // items (adversarial S1): the ARTIST_MAX=3 cap must actually bite (b4 stays unpicked).
  const artistItems = [t9, { id: 'b1', title: 'B One', artist: 'Band', durationSec: 80 }, { id: 'b2', title: 'B Two', artist: 'Band', durationSec: 81 },
    { id: 'b3', title: 'B Three', artist: 'Band', durationSec: 82 }, { id: 'b4', title: 'B Four', artist: 'Band', durationSec: 83 }];
  const libItems = [t9, { id: 'b1', title: 'B One', artist: 'Band', durationSec: 80 },
    { id: 'l1', title: 'Lib One', artist: 'Other Band', durationSec: 70 },
    { id: 'l2', title: 'Lib Two', artist: 'Other Band', durationSec: 71 },
    { id: 'l3', title: 'Lib Three', artist: 'Third', durationSec: 72 },
    { id: 'l4', title: 'Lib Four', artist: 'Third', durationSec: 73 }];
  const fetchImpl = (u, init) => {
    const url = String(u);
    log.push({ url, method: (init && init.method) || 'GET' });
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [t9] }) });
    if (/^\/api\/music\/t9$/.test(url)) return Promise.resolve({ ok: true, json: async () => t9 });
    if (/^\/api\/music\/t8$/.test(url)) return Promise.resolve({ ok: true, json: async () => t8 });
    if (url.indexOf('/api/music?artist=') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: artistItems }) });
    if (url.indexOf('/api/music?sort=random') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: libItems }) });
    if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot({
    mobile: false, isMusic: true, query: '?play=t9',
    fetchImpl, playerOverride: listenPlayer(calls),
    run: async (dom, spy, mod) => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      // DEFAULT ON (ruling 4): no stored setting, yet the append happened.
      const rows = [...panel(dom).querySelectorAll('.mnp-queue-row')];
      assert.strictEqual(rows.length, 6, 'the single-song queue grew to 6 VISIBLE rows (1 playing + 5 appended - ruling 3, a queue you can see)');
      const titles = rows.map((r) => r.textContent);
      assert.match(titles[1], /B One/, 'same-artist picks lead (ruling 2)');
      assert.match(titles[2], /B Two/, 'artist picks before library neighbors');
      assert.match(titles[3], /B Three/, 'the artist arm fills to its cap');
      assert.ok(!titles.some((t) => /B Four/.test(t)), 'ARTIST_MAX bites: the fourth eligible artist item stays unpicked (adversarial S1 boundary)');
      assert.match(titles[4], /Lib One/, 'library fill follows');
      assert.strictEqual(titles.filter((t) => /Song/.test(t)).length, 1, 'the playing track is never re-picked (no repeats)');
      assert.strictEqual(titles.filter((t) => /B One/.test(t)).length, 1, 'the library arm cannot double-append an artist pick');
      const lastNav = calls.navs[calls.navs.length - 1];
      assert.strictEqual(typeof lastNav.onNext, 'function', 'the exhaustion is gone - Next exists for the ended-advance');
      // ---- the OFF axis (both axes: same flow, toggle off, nothing appends) ----
      dom.window.localStorage.setItem('ft-music-autoplay', '0');
      mod.destroy();
      dom.window.history.replaceState({}, '', '/music?play=t8');
      global.fetch = (u, init) => {
        const url = String(u);
        log.push({ url, method: (init && init.method) || 'GET' });
        if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [t8] }) });
        if (/^\/api\/music\/t8$/.test(url)) return Promise.resolve({ ok: true, json: async () => t8 });
        if (url.indexOf('/api/music?artist=') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: artistItems }) });
        if (url.indexOf('/api/music?sort=random') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: libItems }) });
        if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      };
      const offMark = log.length;
      mod.init(dom.window.document.getElementById('view-root'));
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      const rows2 = [...panel(dom).querySelectorAll('.mnp-queue-row')];
      assert.strictEqual(rows2.length, 1, 'OFF: the single track stays a single row');
      assert.ok(!log.slice(offMark).some((c) => c.url.indexOf('/api/music?artist=') === 0 || c.url.indexOf('/api/music?sort=random') === 0),
        'OFF: the picker never even fetches');
      const lastNav2 = calls.navs[calls.navs.length - 1];
      assert.strictEqual(lastNav2.onNext, undefined, 'OFF: exhaustion stays exhausted (the pre-wave behavior)');
    },
  });
});

test('v1.254 autoplay: a LISTEN track never autoplays into random songs (the locked-intake exclusion)', async () => {
  const calls = { loads: [], navs: [] };
  const log = [];
  await boot({
    mobile: true, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: (u, init) => {
      const url = String(u);
      log.push({ url, method: (init && init.method) || 'GET' });
      if (/^\/api\/videos\//.test(url)) return Promise.resolve({ ok: true, json: async () => LISTEN_VIDEO });
      // library content EXISTS - only the listen exclusion can explain a no-append
      if (url.indexOf('/api/music?sort=random') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [{ id: 'l1', title: 'Lib One', artist: 'X', durationSec: 70 }] }) });
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    },
    playerOverride: listenPlayer(calls),
    run: async () => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      assert.ok(calls.loads.length >= 1, 'the listen track loaded (populated first)');
      assert.ok(!log.some((c) => c.url.indexOf('/api/music?artist=') === 0 || c.url.indexOf('/api/music?sort=random') === 0),
        'the picker never fires for a listen track');
      const lastNav = calls.navs[calls.navs.length - 1];
      assert.strictEqual(lastNav.onNext, undefined, 'a listened video ends where it ends');
    },
  });
});

test('v1.254 (QA W1): the played memory SURVIVES a view re-init, and the RECYCLE arm keeps radio alive on a fully-played library', async () => {
  const calls = { loads: [], navs: [] };
  const log = [];
  const l1 = { id: 'l1', title: 'Lib One', artist: 'X', durationSec: 70 };
  const l2 = { id: 'l2', title: 'Lib Two', artist: 'Y', durationSec: 71 };
  const t9 = { id: 't9', title: 'Song', artist: 'Band', album: '', albumKey: '', durationSec: 100 };
  const t8 = { id: 't8', title: 'Other', artist: 'Band', album: '', albumKey: '', durationSec: 90 };
  const mkFetch = (recent, lib) => (u, init) => {
    const url = String(u);
    log.push({ url, method: (init && init.method) || 'GET' });
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [recent] }) });
    if (new RegExp('^/api/music/' + recent.id + '$').test(url)) return Promise.resolve({ ok: true, json: async () => recent });
    if (url.indexOf('/api/music?artist=') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    if (url.indexOf('/api/music?sort=random') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: lib }) });
    if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot({
    mobile: false, isMusic: true, query: '?play=l1',
    fetchImpl: mkFetch(l1, []), playerOverride: listenPlayer(calls),
    run: async (dom, spy, mod) => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      // phase 2: RE-INIT (the dock-return class) - the picker must still remember l1 was
      // played. With the memory wrongly init-scoped (the QA W1 bug), l1 gets re-picked
      // and a third row appears; module scope keeps it to [t9, l2].
      mod.destroy();
      dom.window.history.replaceState({}, '', '/music?play=t9');
      global.fetch = mkFetch(t9, [t9, l1, l2]);
      mod.init(dom.window.document.getElementById('view-root'));
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      let titles = [...panel(dom).querySelectorAll('.mnp-queue-row')].map((r) => r.textContent);
      assert.strictEqual(titles.length, 2, 'exactly one append (populated first, so the no-pick axis is non-vacuous)');
      assert.match(titles[1], /Lib Two/, 'the unplayed neighbor was picked');
      assert.ok(!titles.some((t) => /Lib One/.test(t)), 'the RE-INIT did not forget l1 was played (module-scope memory)');
      // phase 3: EVERYTHING in the library page is played or current - the recycle arm
      // relaxes to queue-only exclusion instead of ending in silence (Dean's radio intent).
      mod.destroy();
      dom.window.history.replaceState({}, '', '/music?play=t8');
      global.fetch = mkFetch(t8, [t8, l1]);
      mod.init(dom.window.document.getElementById('view-root'));
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      titles = [...panel(dom).querySelectorAll('.mnp-queue-row')].map((r) => r.textContent);
      assert.strictEqual(titles.length, 2, 'the recycle arm appended instead of letting playback die');
      assert.match(titles[1], /Lib One/, 'the recycled pick is the played-but-not-queued track');
    },
  });
});

test('v1.254 (QA W2): a same-queue track SWITCH mid-fetch drops the picks - the stale re-arm can never stomp the live nav', async () => {
  const calls = { loads: [], navs: [] };
  const log = [];
  const x = { id: 'x1', title: 'First', artist: 'Band', durationSec: 60 };
  const y = { id: 'y1', title: 'Last', artist: 'Band', durationSec: 61 };
  let releaseArtistFetch = null;
  const fetchImpl = (u, init) => {
    const url = String(u);
    log.push({ url, method: (init && init.method) || 'GET' });
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [x, y] }) });
    if (/^\/api\/music\/x1$/.test(url)) return Promise.resolve({ ok: true, json: async () => x });
    if (url.indexOf('/api/music?artist=') === 0) {
      // HANG until the test switches tracks - the TOCTOU window, held open
      return new Promise((resolve) => { releaseArtistFetch = () => resolve({ ok: true, json: async () => ({ items: [{ id: 'p1', title: 'Pick', artist: 'Band', durationSec: 50 }] }) }); });
    }
    if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot({
    mobile: false, isMusic: true, query: '?play=x1',
    fetchImpl, playerOverride: listenPlayer(calls),
    run: async (dom) => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      const rows = () => [...panel(dom).querySelectorAll('.mnp-queue-row')];
      assert.strictEqual(rows().length, 2, 'two-track queue rendered (populated first)');
      // play the LAST track - the picker fires and hangs on the artist fetch
      rows()[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
      assert.strictEqual(typeof releaseArtistFetch, 'function', 'the picker is in flight (non-vacuous window)');
      // mid-fetch: switch BACK to track 1 - same queue, so the tail check alone would pass
      rows()[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      releaseArtistFetch();
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      assert.strictEqual(rows().length, 2, 'the stale picks were DROPPED - no append onto a queue whose playing track moved');
      const lastNav = calls.navs[calls.navs.length - 1];
      assert.strictEqual(typeof lastNav.onNext, 'function', 'nav belongs to index 0 (has a real next)');
      assert.strictEqual(typeof lastNav.onPrev, 'undefined', 'nav belongs to index 0 (no prev) - the stale index-1 re-arm never landed');
    },
  });
});

test('v1.254 (adversarial W2+S2): a SAME-INSTANCE queue replacement mid-flight drops the picks; a non-last register never even fetches', async () => {
  const calls = { loads: [], navs: [] };
  const log = [];
  const x = { id: 'x1', title: 'First', artist: 'Band', durationSec: 60 };
  const y = { id: 'y1', title: 'Last', artist: 'Band', durationSec: 61 };
  let releaseArtistFetch = null;
  const pickerUrls = () => log.filter((c) => c.url.indexOf('/api/music?artist=') === 0 || (c.url.indexOf('/api/music?sort=random') === 0 && c.url.indexOf('limit=60') !== -1));
  const fetchImpl = (u, init) => {
    const url = String(u);
    log.push({ url, method: (init && init.method) || 'GET' });
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [x, y] }) });
    if (/^\/api\/music\/x1$/.test(url)) return Promise.resolve({ ok: true, json: async () => x });
    if (url.indexOf('/api/music?artist=') === 0) {
      return new Promise((resolve) => { releaseArtistFetch = () => resolve({ ok: true, json: async () => ({ items: [{ id: 'p1', title: 'Pick', artist: 'Band', durationSec: 50 }] }) }); });
    }
    // the SHUFFLE's loadSongs (limit=1000): fresh COPIES, the playing id landing at index 0
    if (url.indexOf('sort=random') !== -1 && url.indexOf('limit=1000') !== -1) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [{ ...y }, { ...x }] }) });
    }
    if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot({
    mobile: false, isMusic: true, query: '?play=x1',
    fetchImpl, playerOverride: listenPlayer(calls),
    run: async (dom) => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      const rows = () => [...panel(dom).querySelectorAll('.mnp-queue-row')];
      assert.strictEqual(rows().length, 2, 'two-track queue rendered (populated first)');
      // S2: playing index 0 (non-last) armed NO picker fetch - the last-track gate binds
      assert.strictEqual(pickerUrls().length, 0, 'no picker fetch on a non-last register (the exhaustion gate is real, not masked)');
      // play the LAST track - the picker flies and hangs on the artist fetch
      rows()[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
      assert.strictEqual(typeof releaseArtistFetch, 'function', 'the picker is in flight (non-vacuous window)');
      // SAME instance, queue REPLACED mid-flight: shuffle - fresh objects, the playing id
      // lands at index 0, playingId is UNCHANGED, so ONLY the tail-identity check rejects.
      dom.window.document.getElementById('music-shuffle-btn').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
      releaseArtistFetch();
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      const titles = rows().map((r) => r.textContent);
      assert.ok(!titles.some((t) => /Pick/.test(t)), 'the stale picks were DROPPED - no append onto the REPLACED queue (delete the tail-identity check and this reds)');
      const lastNav = calls.navs[calls.navs.length - 1];
      assert.strictEqual(typeof lastNav.onNext, 'function', 'nav belongs to shuffled index 0 (has a next)');
      assert.strictEqual(typeof lastNav.onPrev, 'undefined', 'nav belongs to shuffled index 0 (no prev) - the stale re-arm never landed');
    },
  });
});

test('v1.254 (adversarial W1): a TORN-DOWN instance\'s late flight is inert - the successor\'s nav is never stomped (signal.aborted)', async () => {
  const calls = { loads: [], navs: [] };
  const log = [];
  const x = { id: 'x1', title: 'First', artist: 'Band', durationSec: 60 };
  const t8 = { id: 't8', title: 'Other', artist: 'Band', durationSec: 90 };
  let releaseArtistFetch = null;
  const fetchImpl = (u, init) => {
    const url = String(u);
    log.push({ url, method: (init && init.method) || 'GET' });
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [x] }) });
    if (/^\/api\/music\/x1$/.test(url)) return Promise.resolve({ ok: true, json: async () => x });
    if (url.indexOf('/api/music?artist=') === 0 && !releaseArtistFetch) {
      // hold ONLY the first (old-instance) flight; the successor's arms resolve empty
      return new Promise((resolve) => { releaseArtistFetch = () => resolve({ ok: true, json: async () => ({ items: [{ id: 'p1', title: 'Pick', artist: 'Band', durationSec: 50 }] }) }); });
    }
    if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot({
    mobile: false, isMusic: true, query: '?play=x1',
    fetchImpl, playerOverride: listenPlayer(calls),
    run: async (dom, spy, mod) => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      assert.strictEqual(typeof releaseArtistFetch, 'function', 'the old instance\'s picker is in flight (single track = last)');
      // tear the instance down MID-FLIGHT and boot a successor on a different track
      mod.destroy();
      dom.window.history.replaceState({}, '', '/music?play=t8');
      global.fetch = (u, init) => {
        const url = String(u);
        log.push({ url, method: (init && init.method) || 'GET' });
        if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [t8] }) });
        if (/^\/api\/music\/t8$/.test(url)) return Promise.resolve({ ok: true, json: async () => t8 });
        if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      };
      mod.init(dom.window.document.getElementById('view-root'));
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      const navsBefore = calls.navs.length;
      const rowsBefore = [...panel(dom).querySelectorAll('.mnp-queue-row')].length;
      // release the DEAD instance's flight - every check on its own dead state would
      // pass (its queue/playingId are untouched); only signal.aborted can reject.
      releaseArtistFetch();
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      assert.strictEqual(calls.navs.length, navsBefore, 'no setTrackNav from the dead instance (delete the aborted check and this reds)');
      assert.strictEqual([...panel(dom).querySelectorAll('.mnp-queue-row')].length, rowsBefore, 'the successor\'s visible queue is untouched');
    },
  });
});

test('v1.254 (adversarial W3): a register SUPPRESSED by an in-flight picker is RETRIED after the flight drops - exhaustion cannot starve', async () => {
  const calls = { loads: [], navs: [] };
  const log = [];
  const x = { id: 'x1', title: 'First', artist: 'Band', durationSec: 60 };
  const y = { id: 'y1', title: 'Last', artist: 'Band', durationSec: 61 };
  let releaseArtistFetch = null;
  let artistCallCount = 0;
  const fetchImpl = (u, init) => {
    const url = String(u);
    log.push({ url, method: (init && init.method) || 'GET' });
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [x, y] }) });
    if (/^\/api\/music\/x1$/.test(url)) return Promise.resolve({ ok: true, json: async () => x });
    if (url.indexOf('/api/music?artist=') === 0) {
      artistCallCount += 1;
      if (artistCallCount === 1) {
        // hold the FIRST flight open (the starvation window)
        return new Promise((resolve) => { releaseArtistFetch = () => resolve({ ok: true, json: async () => ({ items: [] }) }); });
      }
      // the RETRY's flight resolves normally with a pick
      return Promise.resolve({ ok: true, json: async () => ({ items: [{ id: 'p1', title: 'Pick', artist: 'Band', durationSec: 50 }] }) });
    }
    // the shuffle's loadSongs: a ONE-track scope - the same playing id IS the new tail,
    // so its register is a legitimate exhaustion the in-flight flag suppresses
    if (url.indexOf('sort=random') !== -1 && url.indexOf('limit=1000') !== -1) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [{ ...y }] }) });
    }
    if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot({
    mobile: false, isMusic: true, query: '?play=x1',
    fetchImpl, playerOverride: listenPlayer(calls),
    run: async (dom) => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      const rows = () => [...panel(dom).querySelectorAll('.mnp-queue-row')];
      rows()[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); // play the tail - flight 1 held
      for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
      assert.strictEqual(typeof releaseArtistFetch, 'function', 'flight 1 in the window (non-vacuous)');
      dom.window.document.getElementById('music-shuffle-btn').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
      assert.strictEqual(artistCallCount, 1, 'the new tail\'s register was SUPPRESSED by the in-flight flag (the starvation setup holds)');
      releaseArtistFetch(); // flight 1 drops at the tail-identity check...
      for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
      assert.strictEqual(artistCallCount, 2, '...and the finally-retry re-ran the picker for the live tail (delete the retry and this reds)');
      const titles = rows().map((r) => r.textContent);
      assert.ok(titles.some((t) => /Pick/.test(t)), 'the missed exhaustion was healed - the append landed');
      const lastNav = calls.navs[calls.navs.length - 1];
      assert.strictEqual(typeof lastNav.onNext, 'function', 'Next exists - playback will not die at track end');
    },
  });
});

// ---- v1.257 TRAY PLAYER --------------------------------------------------------------

test('v1.257 TRAY: dims by mode, the body marker + ipod donor, the toggle round-trip, and mode memory on a fresh open', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'apple', run: async (dom) => {
    const dimsLog = [];
    const holder = { pip: makePipWindow() };
    dom.window.documentPictureInPicture = { requestWindow: (opts) => { dimsLog.push(opts); return Promise.resolve(holder.pip); } };
    clickPopout(dom); await settle(); await settle();
    // FULL mode: today's dims, the chosen skin, no marker, and the Tray row present+Off
    assert.deepStrictEqual(dimsLog[0], { width: 380, height: 700 }, 'full pop-out dims unchanged');
    const pip1 = holder.pip;
    assert.ok(!pip1.document.body.classList.contains('mms-tray'), 'no tray marker in full mode');
    assert.match(pipPanelOf(pip1).className, /mms-apple/, 'the user\'s chosen skin governs the full pop-out');
    pipPanelOf(pip1).querySelector('[data-skin-sticker]').dispatchEvent(new pip1.MouseEvent('click', { bubbles: true }));
    const menu1 = pipPanelOf(pip1).querySelector('[data-skin-sticker-menu]');
    const row1 = menu1.querySelector('[data-skin-tray]');
    assert.ok(row1, 'the pop-out sticker offers the Tray row');
    assert.strictEqual(row1.getAttribute('aria-checked'), 'false', 'Off before the toggle');
    // TOGGLE -> teardown + reopen at tray dims, marker on, ipod donor despite the apple pick
    holder.pip = makePipWindow();
    row1.dispatchEvent(new pip1.MouseEvent('click', { bubbles: true }));
    await settle(); await settle();
    assert.strictEqual(dimsLog.length, 2, 'the toggle reopened the window');
    assert.deepStrictEqual(dimsLog[1], { width: 310, height: 190 }, 'the Nano tray dims (v1.258: slightly smaller on net)');
    const pip2 = holder.pip;
    assert.ok(pip2.document.body.classList.contains('mms-tray'), 'the BODY marker (survives engine paint)');
    assert.match(pipPanelOf(pip2).className, /mms-ipod/, 'tray borrows the IPOD donor (the Nano is a Classic LCD sans wheel)');
    assert.ok(!/mms-apple\b/.test(pipPanelOf(pip2).className), 'the apple pick does not leak into the tray');
    assert.strictEqual(dom.window.localStorage.getItem('ft-tray-mode'), '1', 'the mode persisted');
    // the strip's row reads On; toggling BACK restores full mode
    pipPanelOf(pip2).querySelector('[data-skin-sticker]').dispatchEvent(new pip2.MouseEvent('click', { bubbles: true }));
    const row2 = pipPanelOf(pip2).querySelector('[data-skin-tray]');
    assert.strictEqual(row2.getAttribute('aria-checked'), 'true', 'On inside the tray');
    holder.pip = makePipWindow();
    row2.dispatchEvent(new pip2.MouseEvent('click', { bubbles: true }));
    await settle(); await settle();
    assert.deepStrictEqual(dimsLog[2], { width: 380, height: 700 }, 'toggling back restores the full dims');
    assert.ok(!holder.pip.document.body.classList.contains('mms-tray'), 'marker gone');
    assert.strictEqual(dom.window.localStorage.getItem('ft-tray-mode'), '0', 'the mode persisted off');
    // MODE MEMORY: set tray, close, and a FRESH open goes straight to the strip
    dom.window.localStorage.setItem('ft-tray-mode', '1');
    // jsdom's close() fires no pagehide - signal the closure the way the shell listens
    holder.pip.dispatchEvent(new holder.pip.Event('pagehide'));
    await settle();
    holder.pip = makePipWindow();
    clickPopout(dom); await settle(); await settle();
    assert.deepStrictEqual(dimsLog[3], { width: 310, height: 190 }, 'a fresh pop-out honors the stored tray mode');
    assert.ok(holder.pip.document.body.classList.contains('mms-tray'), 'straight to the strip');
  } });
});

test('v1.257 TRAY: the MAIN window\'s sticker never offers the row (the hook is shell-injected, pop-out only)', async () => {
  await boot({ mobile: true, isMusic: true, run: async (dom) => {
    const st = panel(dom).querySelector('[data-skin-sticker]');
    assert.ok(st, 'the in-tab sticker painted (populated first)');
    st.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const menu = panel(dom).querySelector('[data-skin-sticker-menu]');
    assert.ok(menu.querySelector('[data-skin-loop]'), 'the menu rendered (non-vacuous)');
    assert.strictEqual(menu.querySelector('[data-skin-tray]'), null, 'no Tray row in the tab - the view never declares the hook');
  } });
});

test('v1.257 (QA W1): the OLD window\'s queued pagehide cannot kill the freshly-toggled tray (the scoped teardown)', async () => {
  // close() QUEUES pagehide - after a toggle, the browser delivers the old window's
  // pagehide AFTER the new mount. Unscoped, that teardown destroyed the new window
  // (QA's measured repro). Bind: toggle, then fire the stale pagehide, new tray lives.
  await boot({ mobile: false, isMusic: true, skin: 'apple', run: async (dom) => {
    const holder = { pip: makePipWindow() };
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(holder.pip) };
    clickPopout(dom); await settle(); await settle();
    const oldPip = holder.pip;
    // the browser reality jsdom hides: a CLOSED window still delivers its queued pagehide.
    // jsdom's real close() neuters dispatch (QA's vacuous-repro warning), so this window's
    // close only MARKS - keeping the late pagehide deliverable, as in every real browser.
    oldPip.close = function () { oldPip._closeCalls += 1; oldPip.closed = true; };
    pipPanelOf(oldPip).querySelector('[data-skin-sticker]').dispatchEvent(new oldPip.MouseEvent('click', { bubbles: true }));
    holder.pip = makePipWindow();
    pipPanelOf(oldPip).querySelector('[data-skin-tray]').dispatchEvent(new oldPip.MouseEvent('click', { bubbles: true }));
    await settle(); await settle();
    const newPip = holder.pip;
    assert.ok(newPip.document.body.classList.contains('mms-tray'), 'the tray mounted (populated first)');
    // the browser reality jsdom's close() hides: the OLD window's pagehide lands LATE
    oldPip.dispatchEvent(new oldPip.Event('pagehide'));
    await settle();
    assert.strictEqual(newPip._closeCalls, 0, 'the stale pagehide did NOT close the new window (delete the pipWin===win scope and this reds)');
    assert.ok(pipPanelOf(newPip) && pipPanelOf(newPip).isConnected, 'the tray panel survives');
  } });
});

test('v1.257/v1.258: the tray menu offers ONLY the colorway chips (live-flipping the body), the full pop-out keeps ALL skins, and the plain-window fallback never offers the Tray row', async () => {
  // a PLAYING track is load-bearing: repaintPopout() early-returns with nothing playing
  // (production can only open the tray from a playing pop-out), and the LIVE colorway
  // flip below rides that repaint.
  const calls = { loads: [], navs: [] };
  const t9 = { id: 't9', title: 'Song', artist: 'Band', album: '', albumKey: '', durationSec: 100 };
  const fetchImpl = (u, init) => {
    const url = String(u);
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [t9] }) });
    if (/^\/api\/music\/t9$/.test(url)) return Promise.resolve({ ok: true, json: async () => t9 });
    if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot({ mobile: false, isMusic: true, skin: 'apple', query: '?play=t9', fetchImpl, playerOverride: listenPlayer(calls), run: async (dom) => {
    // full pop-out: chips present, Tray row present (both non-vacuous baselines)
    const holder = { pip: makePipWindow() };
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(holder.pip) };
    clickPopout(dom); await settle(); await settle();
    const full = holder.pip;
    pipPanelOf(full).querySelector('[data-skin-sticker]').dispatchEvent(new full.MouseEvent('click', { bubbles: true }));
    const fullChips = [...pipPanelOf(full).querySelectorAll('[data-skin-pick]')].map((c) => c.getAttribute('data-skin-pick')).sort();
    assert.deepStrictEqual(fullChips, ['apple', 'ipod', 'ipod-black', 'ipod-matte', 'spotify', 'zune-classic'], 'the FULL pop-out keeps ALL skin chips incl. every Click colorway and Seattle (adversarial W1: in-pip must not mean in-tray)');
    assert.match(pipPanelOf(full).querySelector('[data-skin-sticker-menu]').textContent, /Skin/, 'the full pop-out heading says Skin');
    // toggle to tray: the chips vanish (the donor is forced - a pick would visibly no-op)
    holder.pip = makePipWindow();
    pipPanelOf(full).querySelector('[data-skin-tray]').dispatchEvent(new full.MouseEvent('click', { bubbles: true }));
    await settle(); await settle();
    const tray = holder.pip;
    pipPanelOf(tray).querySelector('[data-skin-sticker]').dispatchEvent(new tray.MouseEvent('click', { bubbles: true }));
    assert.ok(pipPanelOf(tray).querySelector('[data-skin-tray]'), 'the Tray row is there to toggle back (non-vacuous)');
    // v1.258: the chips are the COLORWAYS in tray - the Click family only (those picks
    // genuinely restyle the tray body; apple/spotify would visibly no-op). v1.300: the
    // Click trio incl. the new Matte colorway.
    const trayChips = [...pipPanelOf(tray).querySelectorAll('[data-skin-pick]')].map((c) => c.getAttribute('data-skin-pick'));
    assert.deepStrictEqual(trayChips.sort(), ['ipod', 'ipod-black', 'ipod-matte'], 'exactly the three colorway chips inside the tray');
    assert.match(pipPanelOf(tray).querySelector('[data-skin-sticker-menu]').textContent, /Color/, 'the tray heading says Color (adversarial W2)');
    // the HEADLINE interaction: tapping a colorway restyles the LIVE tray (kills the
    // memoized-donor mutant - the wrap must consult the pick on every paint)
    pipPanelOf(tray).querySelector('[data-skin-pick="ipod-black"]').dispatchEvent(new tray.MouseEvent('click', { bubbles: true }));
    await settle();
    assert.match(pipPanelOf(tray).className, /mms-ipod-black/, 'the black colorway applied to the live tray on tap');
    pipPanelOf(tray).querySelector('[data-skin-sticker]').dispatchEvent(new tray.MouseEvent('click', { bubbles: true }));
    // dispose the tray + reset the mode so the fallback assertion is about the ROW, not dims
    holder.pip = makePipWindow(); // the toggle-back mounts a FRESH window
    pipPanelOf(tray).querySelector('[data-skin-tray]').dispatchEvent(new tray.MouseEvent('click', { bubbles: true }));
    await settle(); await settle();
    holder.pip.dispatchEvent(new holder.pip.Event('pagehide')); await settle();
    // the PLAIN fallback (no Document PiP): the named-window reuse breaks the toggle, so no row
    const plain = makePipWindow();
    delete dom.window.documentPictureInPicture;
    dom.window.open = () => plain;
    clickPopout(dom); await settle(); await settle();
    pipPanelOf(plain).querySelector('[data-skin-sticker]').dispatchEvent(new plain.MouseEvent('click', { bubbles: true }));
    assert.ok(pipPanelOf(plain).querySelector('[data-skin-loop]'), 'the fallback menu rendered (non-vacuous)');
    assert.strictEqual(pipPanelOf(plain).querySelector('[data-skin-tray]'), null, 'no Tray row without Document PiP');
  } });
});

test('v1.257 (adversarial W-A) source-lock: the Nano reshape rules exist - without them the tray is the full iPod crammed into the tray window', () => {
  // Measured gap: deleting the whole tray CSS block left the suite green (jsdom has no
  // layout), and the plan CLAIMED a lock that was never written after the Nano pivot.
  // Lock the load-bearing reshapes; the selectors deliberately omit the skin-base class
  // (the v1.232 first-occurrence locks - see the block's own comment).
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /body\.mms-tray\{ background:var\(--mms-black\); \}/, 'the dark pip body behind the rounded shell (adversarial W3: white corners without it)');
  assert.match(css, /body\.mms-tray \.ip-wheelwrap, body\.mms-tray \.ip-listview\{ display:none; \}/, 'the wheel and list are hidden - the tray is the LCD alone');
  assert.match(css, /body\.mms-tray \.ip-lcd\{[^}]*margin:var\(--space-3\) var\(--space-4\)/, 'the LCD insets into the body frame (the v1.258 Nano feel)');
  assert.match(css, /body\.mms-tray \.ip-npmain\{ display:flex; align-items:center/, 'art sits beside the meta (the Nano-5g row)');
  assert.match(css, /body\.mms-tray \.ip-cover\{ width:88px; height:88px/, 'the Nano art box');
  assert.match(css, /body\.mms-tray \.ip-ttl\{[^}]*text-overflow:ellipsis/, 'the title ellipsizes in the strip');
  assert.match(css, /body\.mms-tray \.mms-sticker\{ transform:scale\(\.55\)/, 'only the sticker BUTTON shrinks (the menu keeps thumb sizes - QA S4)');
  assert.match(css, /body\.mms-tray \.mms-sticker-menu\{ position:fixed; inset:var\(--space-3\)/, 'the tray menu is a FULL-WINDOW overlay (the upward-opening base menu clipped to a sliver at 190px - v1.258.1)');
  assert.match(css, /body\.mms-tray \.music-nowplaying-panel\{ position:fixed; inset:0; border-radius:var\(--radius-lg\)/, 'the panel fills the pip viewport, rounded like the shell');
});


test('v1.258 colorways: a Click (Black) pick keeps its BLACK body in the tray (the variant-aware donor)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod-black', run: async (dom) => {
    dom.window.localStorage.setItem('ft-tray-mode', '1');
    const holder = { pip: makePipWindow() };
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(holder.pip) };
    clickPopout(dom); await settle(); await settle();
    const pip = holder.pip;
    assert.ok(pip.document.body.classList.contains('mms-tray'), 'straight to the tray (populated first)');
    assert.match(pipPanelOf(pip).className, /mms-ipod-black/, 'the BLACK colorway rides the family pick (force the base donor and this reds)');
  } });
});

test('v1.300 colorways: a Click (Matte) pick keeps its MATTE body in the tray (the variant-aware donor)', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'ipod-matte', run: async (dom) => {
    dom.window.localStorage.setItem('ft-tray-mode', '1');
    const holder = { pip: makePipWindow() };
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(holder.pip) };
    clickPopout(dom); await settle(); await settle();
    const pip = holder.pip;
    assert.ok(pip.document.body.classList.contains('mms-tray'), 'straight to the tray (populated first)');
    assert.match(pipPanelOf(pip).className, /mms-ipod-matte/, 'the MATTE colorway rides the family pick (drop ipod-matte from the tray getSkinId donor and this reds)');
  } });
});

test('v1.260: a Seattle pick does NOT become the tray donor - the Nano stays a Click (base silver fallback)', async () => {
  // zune-classic shares base 'ipod' for the wheel CSS, but the tray colorway family is
  // the explicit iPod pair (ipod + ipod-black) - loosen the donor back to base-family and this reds.
  await boot({ mobile: false, isMusic: true, skin: 'zune-classic', run: async (dom) => {
    dom.window.localStorage.setItem('ft-tray-mode', '1');
    const holder = { pip: makePipWindow() };
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(holder.pip) };
    clickPopout(dom); await settle(); await settle();
    const pip = holder.pip;
    assert.ok(pip.document.body.classList.contains('mms-tray'), 'straight to the tray (populated first)');
    assert.match(pipPanelOf(pip).className, /mms-ipod\b/, 'the donor fell to base silver');
    assert.ok(!/mms-zune-classic/.test(pipPanelOf(pip).className), 'the brown Zune body never leaks into the Nano tray');
  } });
});

// v1.311.3 gate r1 W2 (adversary: the music.js wiring was source-locked only - a dead call
// survived). A crossing of the 768px gate re-runs updateNowPlayingPanel: narrow -> wide drops
// the skin (and body.mms-on), wide -> narrow paints it again. Driven with the REAL window
// resize and the REAL music-skins isMobileViewport (read live from matchMedia).
test('v1.311.3: a rotate across the 768px gate un-renders the music skin and a rotate back re-paints it', async () => {
  await boot({ mobile: true, isMusic: true, run: async (dom) => {
    const body = dom.window.document.body;
    const el = panel(dom);
    assert.match(el.className, /\bmms-full\b/, 'precondition: the full-screen skin');
    let narrow = true;
    dom.window.matchMedia = (q) => ({ matches: /max-width:\s*768px/.test(q) ? narrow : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    narrow = false;
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    await settle();
    assert.doesNotMatch(el.className, /\bmms-full\b/, 'wide: no skin classes on the panel');
    assert.strictEqual(el.querySelector('[data-skin-play]'), null, 'wide: the skin transport is gone');
    assert.ok(!body.classList.contains('mms-on'), 'wide: mms-on is gone');
    narrow = true;
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    await settle();
    assert.match(el.className, /\bmms-full\b/, 'rotating back re-paints the skin');
    assert.ok(el.querySelector('[data-skin-play]'), 'with its transport');
    assert.ok(body.classList.contains('mms-on'), 'and mms-on');
  } });
});

// v1.311.3 (Dean's device screenshot, "stuck skin"): a listen of a CHAPTERED album, rotate
// sideways, rotate back -> the DESKTOP now-playing panel (title, subline, whole queue) filled
// the phone on the skin's background, with no transport and no way out. Cause: while wide, a
// re-render that is NOT a rotate (reflectChapter repaints the panel at every chapter boundary)
// took the desktop branch, which kept the panel's `mms mms-full mms-<skin>` classes; rotating
// back re-applied `.mms-full` (position:fixed; inset:0) around desktop content. The theatre
// toggle stands in for the chapter boundary here (both call updateNowPlayingPanel).
test('v1.311.3 Dean\'s stuck panel: a wide re-render outside a rotate never leaves the desktop panel wearing the skin cover', async () => {
  await boot({ mobile: true, isMusic: true, run: async (dom) => {
    const el = panel(dom);
    assert.match(el.className, /\bmms-full\b/, 'precondition: the full-screen skin');
    let narrow = true;
    dom.window.matchMedia = (q) => ({ matches: /max-width:\s*768px/.test(q) ? narrow : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    narrow = false; // turned sideways
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    await settle();
    dom.window.document.getElementById('theater-btn').click(); // a chapter boundary re-renders while wide (v1.317: the in-player theatre button)
    await settle();
    assert.ok(el.querySelector('.mnp-title'), 'the wide re-render drew the desktop panel');
    assert.doesNotMatch(el.className, /\bmms-full\b/, 'and it does NOT wear the full-screen skin cover (the stuck state needs both)');
    narrow = true; // turned back
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    await settle();
    assert.match(el.className, /\bmms-full\b/, 'back in portrait: the real skin paints again');
    assert.ok(el.querySelector('[data-skin-play]'), 'with its transport - a way out');
  } });
});

// ---- v1.317 (M1, D6b): the now-playing ARTIST LINE is a real control on every skin SURFACE ----
// Driven clicks (never a source grep): the in-tab skin per renderer family + the pop-out. The
// tap opens the in-Music ARTIST drill (the "Playing from <Album>" line's model): the artist
// scope loads and the drill header paints in the MAIN document.

const ARTIST_TRACK = { id: 't1', title: 'Track A', artist: 'NESTALGIA', album: 'Retro Mix', albumKey: 'k', durationSec: 337 };
function artistFetch(log) {
  return (u) => {
    const url = String(u);
    log.push(url);
    if (/\/api\/music\?/.test(url) && /[?&]artist=/.test(url)) return Promise.resolve({ ok: true, json: async () => ({ items: [ARTIST_TRACK], total: 1, offset: 0, limit: 1000 }) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
}
const artistScopeLoaded = (log) => log.some((u) => /\/api\/music\?/.test(u) && /[?&]artist=NESTALGIA(&|$)/.test(u));

for (const sk of ['apple', 'spotify', 'ipod', 'zune-classic']) {
  test('v1.317 (M1) in-tab ' + sk + ': tapping the artist line opens the ARTIST drill (the artist-scope fetch + the drill header); no transport proxy fires', async () => {
    const log = [];
    await boot({ mobile: true, isMusic: true, skin: sk, fetchImpl: artistFetch(log), run: async (dom, spy) => {
      const btn = panel(dom).querySelector('[data-skin-artist]');
      assert.ok(btn, sk + ': the artist line rendered as the hook button');
      assert.strictEqual(btn.textContent, 'NESTALGIA', sk + ': it shows the playing artist');
      log.length = 0;
      btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 6; i++) await settle();
      assert.ok(artistScopeLoaded(log), sk + ': the artist scope loaded - ' + log.join(' | '));
      const head = dom.window.document.querySelector('.music-drill-header .music-drill-title');
      assert.ok(head && head.textContent === 'NESTALGIA', sk + ': the artist drill header is up in the view');
      assert.deepStrictEqual([spy.pp, spy.prev, spy.next, spy.seek, spy.dock, spy.shuffle], [0, 0, 0, 0, 0, 0], sk + ': no transport/dock/shuffle proxy fired');
    } });
  });
}

test('v1.317 (M1) pop-out: the artist line in the pop-out window drills the MAIN document\'s view (nothing window-bound; the pop-out stays open)', async () => {
  const log = [];
  await boot({ mobile: false, isMusic: true, skin: 'ipod', fetchImpl: artistFetch(log), run: async (dom) => {
    const pip = makePipWindow();
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
    clickPopout(dom); await settle(); await settle();
    const btn = pipPanelOf(pip).querySelector('[data-skin-artist]');
    assert.ok(btn, 'the pop-out skin carries the artist hook');
    log.length = 0;
    btn.dispatchEvent(new pip.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 6; i++) await settle();
    assert.ok(artistScopeLoaded(log), 'the main view loaded the artist scope - ' + log.join(' | '));
    const head = dom.window.document.querySelector('.music-drill-header .music-drill-title');
    assert.ok(head && head.textContent === 'NESTALGIA', 'the drill opened in the MAIN document');
    assert.ok(!pip.closed, 'the pop-out stays open');
  } });
});

// ---- v1.317 (M1, D5/D6a/D7): "Go to channel" on the sticker's page 1 ----------------------
// A LIBRARY-backed track (the Wave G projection / a listen track) with a folderName has a home
// grid behind it (`/?folder=<folderName>`, with its "Showing in Music" mark); a native music-
// store track never does. The tap LEAVES the view through the SPA router (only #view-root
// swaps - the persistent player host keeps playing), so the player sees no load/dock/close.

const CH_TRACK = { id: 'c1', title: 'From A Channel', artist: 'The Channel', album: '', albumKey: '', durationSec: 100, source: 'library', streamSrc: '/video/c1', artUrl: '/thumbnail/c1', progressEndpoint: '/api/progress', folderName: 'The Channel Dir' };
function continueFetch(track, log) {
  return (u, init) => {
    const url = String(u);
    if (log) log.push({ url, method: (init && init.method) || 'GET' });
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [track] }) });
    if (new RegExp('^/api/music/' + track.id + '$').test(url)) return Promise.resolve({ ok: true, json: async () => track });
    if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
}
// A player whose getCurrentMeta mirrors the REAL facade's carry (player.js: title/channelName/
// album/albumKey/channelFolder from the load data) and counts every lifecycle call.
function channelPlayer(calls) {
  const p = {
    currentId: null, _meta: null,
    getState: () => 'full',
    getCurrentMeta: () => p._meta,
    expand() {}, dock() { calls.docks += 1; }, close() { calls.closes += 1; },
    setTrackNav: (nav) => { calls.navs.push(nav || {}); },
    load: (id, data, opts) => {
      calls.loads.push({ id, data, opts: opts || {} });
      p.currentId = id;
      p._meta = { isMusic: true, id, title: data.title, artist: data.channelName, album: data.album, albumKey: data.albumKey, channelFolder: (typeof data.channelFolder === 'string') ? data.channelFolder : '' };
    },
  };
  return p;
}
const openSticker = (dom) => {
  panel(dom).querySelector('[data-skin-sticker]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  return panel(dom).querySelector('[data-skin-sticker-menu]');
};

test('v1.317 (M1): a LIBRARY-backed track with a channel folder gets "Go to channel" on page 1; the tap navigates via the SPA router to /?folder=<folder> and leaves the player alone', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  await boot({
    mobile: true, isMusic: true, query: '?play=c1',
    fetchImpl: continueFetch(CH_TRACK), playerOverride: channelPlayer(calls),
    run: async (dom) => {
      assert.strictEqual(calls.loads.length, 1, 'the track loaded (populated first)');
      assert.strictEqual(calls.loads[0].data.channelFolder, 'The Channel Dir', 'loadTrack carries the channel folder on the load data (the re-init seed, D7)');
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const menu = openSticker(dom);
      const row = menu.querySelector('[data-skin-channel]');
      assert.ok(row, 'the "Go to channel" row renders on page 1');
      assert.match(row.textContent, /Go to channel/, 'labeled Go to channel');
      row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.deepStrictEqual(navs, ['/?folder=The%20Channel%20Dir'], 'the SPA router navigates to the home grid filtered by THIS track\'s folder (D5)');
      assert.strictEqual(menu.hidden, true, 'the menu closed on the way out');
      assert.deepStrictEqual([calls.loads.length, calls.docks, calls.closes], [1, 0, 0], 'no load/dock/close: the persistent host keeps playing across the swap');
      assert.ok(dom.window.document.getElementById('media-player'), 'the media element is untouched');
    },
  });
});

test('v1.317 (M1) negative axes: a NATIVE track (folderName, no library source) and a library track WITHOUT a folder get NO "Go to channel" row while the quick menu still renders', async () => {
  const native = { id: 'n5', title: 'Ripped', artist: 'Band', album: '', albumKey: '', durationSec: 100, folderName: 'Music/Ripped' };
  const calls1 = { loads: [], navs: [], docks: 0, closes: 0 };
  await boot({
    mobile: true, isMusic: true, query: '?play=n5',
    fetchImpl: continueFetch(native), playerOverride: channelPlayer(calls1),
    run: async (dom) => {
      const menu = openSticker(dom);
      assert.ok(menu.querySelector('[data-skin-speed]'), 'the quick menu rendered (non-vacuous)');
      assert.strictEqual(menu.querySelector('[data-skin-channel]'), null, 'a native music-store track has no channel page');
      assert.strictEqual(calls1.loads[0].data.channelFolder, '', 'and carries no channel folder on the load data');
    },
  });
  const noFolder = { id: 'l7', title: 'Lib', artist: 'Band', album: '', albumKey: '', durationSec: 100, source: 'library', streamSrc: '/video/l7' };
  const calls2 = { loads: [], navs: [], docks: 0, closes: 0 };
  await boot({
    mobile: true, isMusic: true, query: '?play=l7',
    fetchImpl: continueFetch(noFolder), playerOverride: channelPlayer(calls2),
    run: async (dom) => {
      const menu = openSticker(dom);
      assert.ok(menu.querySelector('[data-skin-speed]'), 'the quick menu rendered (non-vacuous)');
      assert.strictEqual(menu.querySelector('[data-skin-channel]'), null, 'a library track without a folderName has nowhere to go');
    },
  });
});

test('v1.317 (M1, D7): a LISTEN track carries its channel folder - page 1 shows Watch AND "Go to channel" (Watch first), and the tap targets the video\'s folder', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  await boot({
    mobile: true, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch([], LISTEN_VIDEO), playerOverride: channelPlayer(calls),
    run: async (dom) => {
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const menu = openSticker(dom);
      const wb = menu.querySelector('[data-skin-watchback]');
      const ch = menu.querySelector('[data-skin-channel]');
      assert.ok(wb && ch, 'both rows render for a listen track');
      assert.ok(wb.compareDocumentPosition(ch) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, '"Go to channel" sits beside (after) Watch');
      ch.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.deepStrictEqual(navs, ['/?folder=The%20Channel'], 'the listen video\'s folderName is the target');
    },
  });
});

test('v1.317 (M1, D7): "Go to channel" SURVIVES the dock-return re-init - the channel folder rides the player meta (channelFolder), not the rebuilt queue', async () => {
  // The v1.252 W1 shape: dock -> tap the mini -> /music?nowplaying=1 re-inits the view on the
  // SAME module instance; render() leaves `queue` empty on a grid tab, so a queue-only lookup
  // would lose the row. nowPlaying re-seeds from getCurrentMeta().channelFolder (loadTrack put
  // it on the load data). Drop the carry on either side and this goes red.
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  await boot({
    mobile: true, isMusic: true, query: '?play=c1',
    fetchImpl: continueFetch(CH_TRACK), playerOverride: channelPlayer(calls),
    run: async (dom, spy, mod) => {
      assert.strictEqual(calls.loads.length, 1, 'the track loaded (populated first)');
      mod.destroy();
      dom.window.history.replaceState({}, '', '/music?nowplaying=1');
      global.fetch = (u, init) => ((init && init.method) === 'POST' ? Promise.resolve({ ok: true, json: async () => ({}) }) : Promise.resolve({ ok: true, json: async () => ({ items: [] }) })); // the re-init rebuilds NOTHING the row could read from
      mod.init(dom.window.document.getElementById('view-root'));
      for (let i = 0; i < 10; i++) await settle();
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const menu = openSticker(dom);
      assert.ok(menu.querySelector('[data-skin-speed]'), 'the quick menu rendered after the re-init (non-vacuous)');
      const row = menu.querySelector('[data-skin-channel]');
      assert.ok(row, 'the "Go to channel" row SURVIVES the re-init (the queue lookup misses; the meta carry serves it)');
      row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.deepStrictEqual(navs, ['/?folder=The%20Channel%20Dir'], 'and still targets the right folder');
      assert.strictEqual(calls.loads.length, 1, 'the re-init adopted the live player - no reload');
    },
  });
});

// ---- Gate r1 W2 (adversary): a LISTEN VIDEO's artist line goes to the CHANNEL, never an empty drill ----
// A video is never in the music projection, so its artist drill was always empty ("No music
// yet"). For a listen track with a channel folder the line is the channel grid (for YouTube
// content the channel IS the artist); with no channel folder it is not a control at all.

const LISTEN_NO_FOLDER = { id: 'vid2', title: 'Orphan Video', channelName: 'The Channel', duration: 500, type: 'video', filePath: '/lib/b.mp4' };

test('v1.317 gate r1 W2 in-tab: a LISTEN video\'s artist line navigates to /?folder=<enc> - no artist fetch, no drill, no empty-id art request', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  const log = [];
  await boot({
    mobile: true, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, LISTEN_VIDEO), playerOverride: channelPlayer(calls),
    run: async (dom) => {
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const btn = panel(dom).querySelector('[data-skin-artist]');
      assert.ok(btn, 'the listen track HAS a channel, so its artist line is a control');
      assert.strictEqual(btn.textContent, 'The Channel');
      // the S5 background browse (an empty albums grid here) owns #music-empty before the tap;
      // the tap must not TOUCH it (the old empty drill un-hid it as "No music yet").
      const content = dom.window.document.getElementById('music-content');
      const contentBefore = content.innerHTML;
      const emptyBefore = dom.window.document.getElementById('music-empty').hidden;
      log.length = 0;
      btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 6; i++) await settle();
      assert.deepStrictEqual(navs, ['/?folder=The%20Channel'], 'the tap goes to the channel grid');
      assert.ok(!log.some((c) => /[?&]artist=/.test(c.url)), 'no artist-scope fetch: ' + log.map((c) => c.url).join(' | '));
      assert.ok(!log.some((c) => /\/albumart\/(\?|$)/.test(c.url)), 'no empty-id /albumart/ request');
      assert.strictEqual(dom.window.document.querySelector('.music-drill-header'), null, 'no drill opened');
      assert.strictEqual(content.innerHTML, contentBefore, 'the browse behind the skin is untouched (no drill render)');
      assert.strictEqual(dom.window.document.getElementById('music-empty').hidden, emptyBefore, 'the "No music yet" note state is untouched by the tap');
    },
  });
});

test('v1.317 gate r1 W2 in-tab: a LISTEN video with NO channel folder renders the artist line as a plain div (no control, no tooltip)', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  await boot({
    mobile: true, isMusic: true, query: '?play=vid2&listen=1',
    fetchImpl: listenFetch([], LISTEN_NO_FOLDER), playerOverride: channelPlayer(calls),
    run: async (dom) => {
      const el = panel(dom);
      assert.match(el.className, /\bmms-full\b/, 'precondition: the skin painted for the listen track');
      const line = el.querySelector('.mms-sub');
      assert.ok(line, 'the artist line rendered (non-vacuous)');
      assert.strictEqual(line.tagName, 'DIV', 'a div - nowhere to go');
      assert.strictEqual(line.textContent, 'The Channel', 'the channel name still shows');
      assert.strictEqual(el.querySelector('[data-skin-artist]'), null, 'no hook');
      const menu = openSticker(dom);
      assert.strictEqual(menu.querySelector('[data-skin-channel]'), null, 'and no "Go to channel" row either (no folder)');
      assert.ok(menu.querySelector('[data-skin-watchback]'), 'the Watch way back is the escape');
    },
  });
});

test('v1.317 gate r1 W2 desktop panel: a LISTEN video\'s .mnp-sub navigates to the channel grid; with no channel folder it is a plain div', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  const log = [];
  await boot({
    mobile: false, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, LISTEN_VIDEO), playerOverride: channelPlayer(calls),
    run: async (dom) => {
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const sub = panel(dom).querySelector('.mnp-sub[data-artist]');
      assert.ok(sub, 'the desktop panel line is the control for a listen track with a channel');
      log.length = 0;
      sub.click();
      for (let i = 0; i < 6; i++) await settle();
      assert.deepStrictEqual(navs, ['/?folder=The%20Channel'], 'the desktop line goes to the channel grid too');
      assert.ok(!log.some((c) => /[?&]artist=/.test(c.url)), 'no artist-scope fetch');
      assert.strictEqual(dom.window.document.querySelector('.music-drill-header'), null, 'no drill opened');
    },
  });
  const calls2 = { loads: [], navs: [], docks: 0, closes: 0 };
  await boot({
    mobile: false, isMusic: true, query: '?play=vid2&listen=1',
    fetchImpl: listenFetch([], LISTEN_NO_FOLDER), playerOverride: channelPlayer(calls2),
    run: async (dom) => {
      const sub = panel(dom).querySelector('.mnp-sub');
      assert.ok(sub, 'the line rendered (non-vacuous)');
      assert.strictEqual(sub.tagName, 'DIV', 'no channel folder -> not a control');
      assert.strictEqual(sub.hasAttribute('data-artist'), false);
    },
  });
});

// ---- Gate r1 W3 (adversary): the D7 carry seams, DRIVEN ---------------------------------
// loadSongs replaces `queue` on every in-Music drill load, so after the feature's OWN flow
// (tap the artist line -> the drill) the row must come from the nowPlaying record, which
// channelFolderCurrent now reads ALONE (ADV-A); every seam that writes it is driven below
// (load: ADV-A, chapter cross: S1, listen restore: S4, the seed: the re-init test above). A chaptered listen video loads `vid1::c0` off buildListenChapter
// Tracks' carry (ADV-B). A NON-listen `::c` chapter of a projected file binds the
// 'library-chapter' arm on its own (adversary finding 4).

test('v1.317 gate r1 ADV-A: after the artist-line drill REPLACES the queue, "Go to channel" still renders (the nowPlaying carry) and navigates', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  const log = [];
  const fetchImpl = (u, init) => {
    const url = String(u);
    log.push({ url, method: (init && init.method) || 'GET' });
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [CH_TRACK] }) });
    if (/^\/api\/music\/c1$/.test(url)) return Promise.resolve({ ok: true, json: async () => CH_TRACK });
    if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) }); // the artist drill loads NOTHING -> queue = []
  };
  await boot({
    mobile: true, isMusic: true, query: '?play=c1',
    fetchImpl, playerOverride: channelPlayer(calls),
    run: async (dom) => {
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const btn = panel(dom).querySelector('[data-skin-artist]');
      assert.ok(btn, 'precondition: the artist line is a control for a normal library track');
      btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 6; i++) await settle();
      assert.ok(log.some((c) => /[?&]artist=The\+Channel|[?&]artist=The%20Channel/.test(c.url)), 'the artist drill loaded (and replaced the queue): ' + log.map((c) => c.url).join(' | '));
      const menu = openSticker(dom);
      assert.ok(menu.querySelector('[data-skin-speed]'), 'the quick menu rendered (non-vacuous)');
      const row = menu.querySelector('[data-skin-channel]');
      assert.ok(row, 'the channel row survives the queue replacement (served by the nowPlaying carry)');
      row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.deepStrictEqual(navs, ['/?folder=The%20Channel%20Dir']);
    },
  });
});

test('v1.317 gate r1 ADV-B: a CHAPTERED listen video loads vid1::c0 and its page 1 offers "Go to channel" (buildListenChapterTracks carries the folder)', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  const chaptered = Object.assign({}, LISTEN_VIDEO, { chapters: [{ startTime: 0, title: 'One' }, { startTime: 300, title: 'Two' }, { startTime: 600, title: 'Three' }] });
  await boot({
    mobile: true, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch([], chaptered), playerOverride: channelPlayer(calls),
    run: async (dom) => {
      assert.strictEqual(calls.loads.length, 1);
      assert.strictEqual(calls.loads[0].id, 'vid1::c0', 'the first chapter loaded');
      assert.strictEqual(calls.loads[0].data.channelFolder, 'The Channel', 'the chapter track carries the channel folder onto the load data');
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const menu = openSticker(dom);
      const row = menu.querySelector('[data-skin-channel]');
      assert.ok(row, 'the channel row renders for the chapter');
      row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.deepStrictEqual(navs, ['/?folder=The%20Channel']);
    },
  });
});

const CHAPTERED_LISTEN = Object.assign({}, LISTEN_VIDEO, { chapters: [{ startTime: 0, title: 'One' }, { startTime: 300, title: 'Two' }, { startTime: 600, title: 'Three' }] });
const clickSongsTab = (dom) => dom.window.document.querySelector('.music-tab[data-tab="songs"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

test('v1.317 gate r1 S1 (the reflectChapter seam): a chaptered listen video ROLLS into chapter two (no reload), the user browses to Songs (the queue is REPLACED) and "Go to channel" still renders from the chapter-cross record', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  const log = [];
  await boot({
    mobile: true, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, CHAPTERED_LISTEN), playerOverride: channelPlayer(calls),
    run: async (dom) => {
      assert.strictEqual(calls.loads.length, 1);
      assert.strictEqual(calls.loads[0].id, 'vid1::c0', 'precondition: chapter one loaded');
      const mp = dom.window.document.getElementById('media-player');
      Object.defineProperty(mp, 'currentTime', { configurable: true, value: 350 });
      mp.dispatchEvent(new dom.window.Event('timeupdate'));
      for (let i = 0; i < 3; i++) await settle();
      assert.match(panel(dom).querySelector('.mms-ttl').textContent, /^Two$/, 'reflectChapter rolled the displayed identity into chapter two (the seam under test ran)');
      assert.strictEqual(calls.loads.length, 1, 'the same file keeps playing - no reload');
      log.length = 0;
      clickSongsTab(dom);
      for (let i = 0; i < 6; i++) await settle();
      assert.ok(log.some((c) => /^\/api\/music\?/.test(c.url)), 'the Songs tab loaded (and replaced the queue): ' + log.map((c) => c.url).join(' | '));
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const menu = openSticker(dom);
      assert.ok(menu.querySelector('[data-skin-speed]'), 'the quick menu rendered (non-vacuous)');
      const row = menu.querySelector('[data-skin-channel]');
      assert.ok(row, 'the channel row survives: the chapter-cross record carries the folder');
      row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.deepStrictEqual(navs, ['/?folder=The%20Channel']);
    },
  });
});

test('v1.317 gate r1 S4 (the restoreListenChapterQueue seam): a chaptered listen video survives the dock-return re-init, then a browse to Songs REPLACES the queue - "Go to channel" still renders from the restored record', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  const log = [];
  await boot({
    mobile: true, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, CHAPTERED_LISTEN), playerOverride: channelPlayer(calls),
    run: async (dom, spy, mod) => {
      assert.strictEqual(calls.loads[0].id, 'vid1::c0', 'precondition: chapter one loaded');
      mod.destroy();
      dom.window.history.replaceState({}, '', '/music?nowplaying=1');
      // the player's meta carries NO folder on this re-init, so the SEED cannot serve the row:
      // only the restore seam (restoreListenChapterQueue, which runs after the seed) can.
      const p = dom.window.FileTube.player;
      p._meta = Object.assign({}, p._meta, { channelFolder: '' });
      mod.init(dom.window.document.getElementById('view-root'));
      for (let i = 0; i < 10; i++) await settle();
      assert.strictEqual(calls.loads.length, 1, 'the re-init adopted the live chapter (no reload)');
      log.length = 0;
      clickSongsTab(dom);
      for (let i = 0; i < 6; i++) await settle();
      assert.ok(log.some((c) => /^\/api\/music\?/.test(c.url)), 'the Songs tab loaded (and replaced the restored queue)');
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const menu = openSticker(dom);
      assert.ok(menu.querySelector('[data-skin-speed]'), 'the quick menu rendered (non-vacuous)');
      const row = menu.querySelector('[data-skin-channel]');
      assert.ok(row, 'the channel row survives: the restore seam rebuilt the record with the folder');
      row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.deepStrictEqual(navs, ['/?folder=The%20Channel']);
    },
  });
});

test('v1.317 gate r1 adversary finding 4 (+ qa): a NON-listen ::c chapter of a projected file (source library-chapter) offers "Go to channel"', async () => {
  const chapter = { id: 'f9::c1', title: 'Part 2', artist: 'The Channel', album: 'Long Mix', albumKey: 'f9', durationSec: 300, source: 'library-chapter', streamSrc: '/video/f9', artUrl: '/thumbnail/f9', progressEndpoint: '/api/progress', chapterStartSec: 300, folderName: 'Chan Dir' };
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  await boot({
    mobile: true, isMusic: true, query: '?play=f9::c1',
    fetchImpl: continueFetch(chapter), playerOverride: channelPlayer(calls),
    run: async (dom) => {
      assert.ok(calls.loads.length >= 1 && calls.loads[calls.loads.length - 1].id === 'f9::c1', 'the chapter loaded: ' + calls.loads.map((l) => l.id).join(','));
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const menu = openSticker(dom);
      const row = menu.querySelector('[data-skin-channel]');
      assert.ok(row, 'the library-chapter arm serves the row (no listen flag involved)');
      row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.deepStrictEqual(navs, ['/?folder=Chan%20Dir']);
    },
  });
});

test('v1.317 gate r1 adversary finding 6: the DESKTOP actions menu (real music.js wiring) renders "Go to channel" for a library track and its click navigates via the router', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  const fetchImpl = (u, init) => {
    const url = String(u);
    if (url === '/api/videos/c1') return Promise.resolve({ ok: true, json: async () => ({ id: 'c1', title: 'From A Channel', liked: false, watchState: 'unwatched' }) });
    return continueFetch(CH_TRACK)(u, init);
  };
  await boot({
    mobile: false, isMusic: true, query: '?play=c1',
    fetchImpl, playerOverride: channelPlayer(calls),
    run: async (dom) => {
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const D = dom.window.document;
      D.getElementById('music-actions-btn').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 6; i++) await settle();
      const menu = D.getElementById('music-actions-menu');
      assert.strictEqual(menu.hidden, false, 'the desktop menu opened');
      assert.ok(menu.querySelector('[data-skin-x="share"]'), 'the action set rendered (non-vacuous)');
      const row = menu.querySelector('[data-skin-x="channel"]');
      assert.ok(row, 'the "Go to channel" row is composed in by the real wiring (hasChannel: channelVisible)');
      row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.deepStrictEqual(navs, ['/?folder=The%20Channel%20Dir'], 'onChannel: channelTap');
      assert.strictEqual(menu.hidden, true, 'the menu closed on the way out');
    },
  });
});

test('v1.317 (M1, D7) source-lock: player.js getCurrentMeta carries channelFolder off the load data (the re-init seed above reads it) - no jsdom harness drives the real facade', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const PLAYER = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
  const m = /getCurrentMeta: function \(\) \{([\s\S]*?)\n {4}\},/.exec(PLAYER);
  assert.ok(m, 'getCurrentMeta is found and isolated');
  assert.match(m[1], /channelFolder: \(typeof currentData\.channelFolder === 'string'\) \? currentData\.channelFolder : ''/, 'the carry reads the load data\'s channelFolder (albumKey\'s precedent)');
  const MUSIC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  assert.match(MUSIC, /channelFolder: channelFolderOf\(item\),/, 'loadTrack puts the gated channel folder on the load data');
  // gate r1 W3: the seed routes the meta through the ONE writer, whose string `channelFolder` wins
  const seed = /function seedNowPlayingFromPlayer\(\) \{((?:(?!\n {4}(?:async )?function )[\s\S])*)/.exec(MUSIC);
  assert.ok(seed, 'seedNowPlayingFromPlayer is found and isolated');
  assert.match(seed[1], /nowPlaying = nowPlayingFrom\(meta\);/, 'seedNowPlayingFromPlayer reads it back through nowPlayingFrom');
  assert.match(MUSIC, /folderName: \(typeof t\.channelFolder === 'string'\) \? t\.channelFolder : channelFolderOf\(t\),/, 'nowPlayingFrom takes the meta carry');
});

// ---- Gate r2 (qa W1): a CHAPTERED listen video that rolled into a later chapter ----------
// activeListenId holds the LOADED chapter (`vid1::c0`); reflectChapter advances the live id to
// `vid1::c1` without a reload, and a browse then REPLACES `queue`. watchBackVisible's marker
// fallback compared the ids exactly, so the listen test failed: the artist tap opened the EMPTY
// artist drill ("No music yet") and the Watch row vanished. The drive is qa's probe shape: the
// REAL `?play=vid1&listen=1` -> /api/videos path, the chapter cross via timeupdate, the Songs tab.

async function crossIntoChapterTwoThenBrowse(dom, calls, log) {
  assert.strictEqual(calls.loads.length, 1);
  assert.strictEqual(calls.loads[0].id, 'vid1::c0', 'precondition: chapter one loaded');
  const mp = dom.window.document.getElementById('media-player');
  Object.defineProperty(mp, 'currentTime', { configurable: true, value: 350 });
  mp.dispatchEvent(new dom.window.Event('timeupdate'));
  for (let i = 0; i < 3; i++) await settle();
  assert.match(panel(dom).querySelector('.mms-ttl').textContent, /^Two$/, 'precondition: reflectChapter rolled the displayed identity into chapter two');
  assert.strictEqual(calls.loads.length, 1, 'the same file keeps playing - no reload');
  log.length = 0;
  clickSongsTab(dom);
  for (let i = 0; i < 6; i++) await settle();
  assert.ok(log.some((c) => /^\/api\/music\?/.test(c.url)), 'precondition: the Songs tab loaded (and replaced the queue): ' + log.map((c) => c.url).join(' | '));
}

test('v1.317 gate r2 qa W1: a CHAPTERED listen video rolled into chapter two, then a Songs browse - the artist tap goes to the CHANNEL grid (never the empty artist drill) and the Watch row stays', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  const log = [];
  await boot({
    mobile: true, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, CHAPTERED_LISTEN), playerOverride: channelPlayer(calls),
    run: async (dom) => {
      await crossIntoChapterTwoThenBrowse(dom, calls, log);
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const btn = panel(dom).querySelector('[data-skin-artist]');
      assert.ok(btn, 'the artist line is a control');
      const empty = dom.window.document.getElementById('music-empty');
      const emptyBefore = empty.hidden;
      log.length = 0;
      btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 6; i++) await settle();
      assert.deepStrictEqual(navs, ['/?folder=The%20Channel'], 'the tap goes to the channel grid (channelTap)');
      assert.ok(!log.some((c) => /[?&]artist=/.test(c.url)), 'no artist-scope fetch (the empty drill): ' + log.map((c) => c.url).join(' | '));
      assert.strictEqual(dom.window.document.querySelector('.music-drill-header'), null, 'no drill opened');
      assert.strictEqual(empty.hidden, emptyBefore, 'the "No music yet" note is untouched by the tap');
      const menu = openSticker(dom);
      assert.ok(menu.querySelector('[data-skin-speed]'), 'the quick menu rendered (non-vacuous)');
      assert.ok(menu.querySelector('[data-skin-watchback]'), 'the Watch row survives the chapter cross + browse');
      // a REPAINT while the browsed queue lacks the chapter (a skin pick from the same menu):
      // the cover's listen-marker fallback is the sibling reader of the same marker - it must
      // match the crossed chapter and serve the BASE video's thumbnail (a `::c` id is no media id).
      const pick = menu.querySelector('[data-skin-pick="spotify"]');
      assert.ok(pick, 'the skin picker row rendered');
      pick.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 3; i++) await settle();
      assert.match(panel(dom).className, /\bmms-spotify\b/, 'precondition: the skin repainted');
      assert.strictEqual(panel(dom).querySelector('.mms-art-img').getAttribute('src'), '/thumbnail/vid1', 'the repainted cover is the video thumbnail (not /albumart/ or /thumbnail/ of a ::c id)');
      const btn2 = panel(dom).querySelector('[data-skin-artist]');
      assert.ok(btn2, 'the repainted artist line is a control');
      assert.strictEqual(btn2.getAttribute('title'), 'Go to channel', 'titled for its target (gate r2 S4)');
      const menu2 = openSticker(dom);
      const wb = menu2.querySelector('[data-skin-watchback]');
      assert.ok(wb, 'the Watch row is still offered after the repaint');
      wb.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.deepStrictEqual(navs.slice(1), ['/watch.html?v=vid1'], 'and returns to the BASE video');
    },
  });
});

test('v1.317 gate r2 qa W1: the DESKTOP panel line of a chaptered listen video rolled into chapter two and browsed away is the channel control, titled "Go to channel"', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  const log = [];
  await boot({
    mobile: false, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, CHAPTERED_LISTEN), playerOverride: channelPlayer(calls),
    run: async (dom) => {
      assert.strictEqual(calls.loads[0].id, 'vid1::c0', 'precondition: chapter one loaded');
      const mp = dom.window.document.getElementById('media-player');
      Object.defineProperty(mp, 'currentTime', { configurable: true, value: 350 });
      mp.dispatchEvent(new dom.window.Event('timeupdate'));
      for (let i = 0; i < 3; i++) await settle();
      assert.match(panel(dom).querySelector('.mnp-title').textContent, /^Two$/, 'precondition: the panel rolled into chapter two');
      log.length = 0;
      clickSongsTab(dom);
      for (let i = 0; i < 6; i++) await settle();
      assert.ok(log.some((c) => /^\/api\/music\?/.test(c.url)), 'precondition: the Songs tab replaced the queue');
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const sub = panel(dom).querySelector('.mnp-sub[data-artist]');
      assert.ok(sub, 'the panel line is a control');
      assert.strictEqual(sub.getAttribute('title'), 'Go to channel', 'its tooltip names the channel (gate r2 S4)');
      log.length = 0;
      sub.click();
      for (let i = 0; i < 6; i++) await settle();
      assert.deepStrictEqual(navs, ['/?folder=The%20Channel'], 'the channel grid, never the artist drill');
      assert.ok(!log.some((c) => /[?&]artist=/.test(c.url)), 'no artist-scope fetch');
    },
  });
});

// ---- Gate r2 (qa W2, Dean's ruling): the desktop POP-OUT never navigates the window behind it ----
// The listen artist line's channel mode is a SPA navigation of the main window; the router's
// cross-view swap calls destroy(), which tears the pop-out down. In the pop-out a listen track's
// artist line is therefore PLAIN TEXT (the channel/Watch rows' main-document-only rule); the
// in-tab / desktop-panel control is unchanged, and a normal track keeps its pop-out drill.

test('v1.317 gate r2 qa W2: in the desktop POP-OUT a LISTEN video\'s artist line is plain text - no control, a click navigates nothing and the pop-out stays open', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  const log = [];
  await boot({
    mobile: false, isMusic: true, skin: 'ipod', query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, LISTEN_VIDEO), playerOverride: channelPlayer(calls),
    run: async (dom, spy, mod) => {
      const navs = [];
      // the router: record the nav, then swap the view exactly as common.js does (destroy())
      dom.window.FileTube.navigate = (u) => { navs.push(u); mod.destroy(); };
      const main = panel(dom).querySelector('.mnp-sub[data-artist]');
      assert.ok(main, 'precondition: the MAIN window\'s panel line is the channel control (the listen track has a channel)');
      const pip = makePipWindow();
      dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pip) };
      clickPopout(dom); await settle(); await settle();
      const pp = pipPanelOf(pip);
      assert.match(pp.className, /\bmms-ipod\b/, 'precondition: the pop-out painted the skin');
      const line = pp.querySelector('.ip-artist');
      assert.ok(line, 'the artist line rendered in the pop-out (non-vacuous)');
      assert.strictEqual(line.tagName, 'DIV', 'plain text, not a button');
      assert.strictEqual(line.textContent, 'The Channel', 'the channel name still shows');
      assert.strictEqual(pp.querySelector('[data-skin-artist]'), null, 'no artist hook in the pop-out');
      log.length = 0;
      line.dispatchEvent(new pip.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 6; i++) await settle();
      assert.deepStrictEqual(navs, [], 'the main window is not navigated');
      assert.ok(!pip.closed, 'the pop-out stays open');
      assert.ok(!log.some((c) => /[?&]artist=/.test(c.url)), 'and no artist drill either');
      assert.strictEqual(calls.loads.length, 1, 'playback untouched');
    },
  });
});

// ---- Gate r2 (adversary W1): the player ADOPT carries the channel folder ------------------
// Watch -> Listen re-opens the SAME id the player holds, so music's load ADOPTS (player.js
// isAdoptLoad) and the adopt branch keeps the WATCH load's data, refreshing only browseCtx +
// applyAdoptFlavor. The watch data never declares `channelFolder`, so getCurrentMeta() read ''
// and the first re-init lost "Go to channel" and the listen artist line. This mock drives the
// REAL exported isAdoptLoad/applyAdoptFlavor pair (the load() adopt branch's two calls), holds
// the load data like the facade, and mirrors getCurrentMeta over it (the source lock above binds
// the real facade's channelFolder line).
const { isAdoptLoad, applyAdoptFlavor } = require('../../public/js/player.js');
function adoptingPlayer(calls, preload) {
  const p = {
    currentId: null, _data: null, _state: 'closed',
    getState: () => p._state,
    getCurrentMeta: () => {
      if (!p.currentId || !p._data) return null;
      const d = p._data;
      return { id: p.currentId, title: d.title || '', artist: d.channelName || '', album: d.album || '', albumKey: d.albumKey || '',
        channelFolder: (typeof d.channelFolder === 'string') ? d.channelFolder : '',
        browseCtx: (typeof d.browseCtx === 'string') ? d.browseCtx : '', resumeMode: d.resumeMode || '', subId: d.subId || '',
        isMusic: d.resumeMode === 'music' };
    },
    expand() { p._state = 'full'; }, dock() { calls.docks += 1; p._state = 'docked'; }, close() { calls.closes += 1; p._state = 'closed'; },
    setTrackNav: (nav) => { calls.navs.push(nav || {}); },
    load: (id, data, opts) => {
      const adopt = isAdoptLoad(p.currentId, id, p._state);
      calls.loads.push({ id, data, opts: opts || {}, adopt });
      if (adopt) {
        // player.js load()'s adopt branch: browseCtx + applyAdoptFlavor, the media untouched
        if (data && typeof data.browseCtx === 'string' && p._data) p._data.browseCtx = data.browseCtx;
        applyAdoptFlavor(p._data, data);
      } else {
        p.currentId = id;
        p._data = Object.assign({}, data);
      }
      p._state = (opts && opts.dock) ? 'docked' : 'full';
      return true;
    },
  };
  if (preload) { p.currentId = preload.id; p._data = Object.assign({}, preload.data); p._state = 'docked'; }
  return p;
}
// watch.js's load data (initWatch: `{ ...mediaData, channelName, browseCtx, readerHref: null,
// resumeMode: null }`) - mediaData is the /api/videos/<id> body. The player docked on the way out.
const watchLoadData = (media) => Object.assign({}, media, { channelName: media.channelName || '', browseCtx: '', readerHref: null, resumeMode: null });

test('v1.317 gate r2 adversary W1: Watch -> Listen ADOPTS the loaded video, and "Go to channel" + the channel artist line SURVIVE the dock-return and the soft-nav re-init', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  const log = [];
  const player = adoptingPlayer(calls, { id: 'vid1', data: watchLoadData(LISTEN_VIDEO) });
  await boot({
    mobile: true, isMusic: true, query: '?play=vid1&listen=1',
    fetchImpl: listenFetch(log, LISTEN_VIDEO), playerOverride: player,
    run: async (dom, spy, mod) => {
      assert.strictEqual(calls.loads.length, 1);
      assert.strictEqual(calls.loads[0].adopt, true, 'precondition: the Listen load ADOPTED the watch page\'s video (same id, not closed)');
      assert.strictEqual(player.getCurrentMeta().isMusic, true, 'precondition: the adopt flipped the flavor to music');
      assert.strictEqual(player.getCurrentMeta().channelFolder, 'The Channel', 'the adopt refreshed the channel folder from the music load data');
      assert.ok(panel(dom).querySelector('[data-skin-artist]'), 'in-session the artist line is a control');
      for (const url of ['/music?nowplaying=1', '/music']) {
        mod.destroy();
        dom.window.history.replaceState({}, '', url);
        mod.init(dom.window.document.getElementById('view-root'));
        for (let i = 0; i < 10; i++) await settle();
        assert.strictEqual(calls.loads.length, 1, url + ': the re-init adopted the live player - no reload');
        const navs = [];
        dom.window.FileTube.navigate = (u) => { navs.push(u); };
        const menu = openSticker(dom);
        assert.ok(menu.querySelector('[data-skin-watchback]'), url + ': the Watch row (the listen marker) - non-vacuous');
        const row = menu.querySelector('[data-skin-channel]');
        assert.ok(row, url + ': "Go to channel" survives the re-init');
        row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        const btn = panel(dom).querySelector('[data-skin-artist]');
        assert.ok(btn && btn.tagName === 'BUTTON', url + ': the artist line is still the channel control');
        btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.deepStrictEqual(navs, ['/?folder=The%20Channel', '/?folder=The%20Channel'], url + ': both go to the channel grid');
      }
    },
  });
});

test('v1.317 gate r2 adversary W1 (second drive): an AUDIO item loaded by the watch page, then /music?play=<id> ADOPTS it - a re-init browsing Songs keeps "Go to channel"', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  const watchMedia = { id: 'c1', title: 'From A Channel', channelName: 'The Channel', folderName: 'The Channel Dir', duration: 100, type: 'audio', filePath: '/lib/c1.mp3' };
  const player = adoptingPlayer(calls, { id: 'c1', data: watchLoadData(watchMedia) });
  const log = [];
  const fetchImpl = (u, init) => {
    const url = String(u);
    log.push({ url, method: (init && init.method) || 'GET' });
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [CH_TRACK] }) });
    if (/^\/api\/music\/c1$/.test(url)) return Promise.resolve({ ok: true, json: async () => CH_TRACK });
    if ((init && init.method) === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    if (/^\/api\/music\?/.test(url)) return Promise.resolve({ ok: true, json: async () => ({ items: [CH_TRACK] }) }); // Songs lists c1
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  await boot({
    mobile: true, isMusic: true, query: '?play=c1',
    fetchImpl, playerOverride: player,
    run: async (dom, spy, mod) => {
      const last = calls.loads[calls.loads.length - 1];
      assert.ok(last && last.id === 'c1' && last.adopt === true, 'precondition: the music load ADOPTED the watch page\'s audio item');
      assert.strictEqual(player.getCurrentMeta().channelFolder, 'The Channel Dir', 'the adopt refreshed the channel folder');
      mod.destroy();
      dom.window.history.replaceState({}, '', '/music?nowplaying=1');
      mod.init(dom.window.document.getElementById('view-root'));
      for (let i = 0; i < 10; i++) await settle();
      log.length = 0;
      clickSongsTab(dom);
      for (let i = 0; i < 6; i++) await settle();
      assert.ok(log.some((c) => /^\/api\/music\?/.test(c.url)), 'precondition: the Songs tab re-fetched the queue (WITH c1)');
      const navs = [];
      dom.window.FileTube.navigate = (u) => { navs.push(u); };
      const menu = openSticker(dom);
      assert.ok(menu.querySelector('[data-skin-speed]'), 'the quick menu rendered (non-vacuous)');
      const row = menu.querySelector('[data-skin-channel]');
      assert.ok(row, '"Go to channel" survives: the seed read the adopted meta\'s folder');
      row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.deepStrictEqual(navs, ['/?folder=The%20Channel%20Dir']);
    },
  });
});

// ---- Gate r2 (qa W3, Dean's ruling): music's Nordic rows too - a 0/unknown length is BLANK ----
test('v1.317 gate r2 qa W3: a chaptered listen video with an UNKNOWN file duration - the Nordic rows show each known chapter span and NO span for the last (0) one', async () => {
  const calls = { loads: [], navs: [], docks: 0, closes: 0 };
  const noDur = Object.assign({}, CHAPTERED_LISTEN, { duration: 0 }); // the last chapter's end is unknown -> span 0
  await boot({
    mobile: true, isMusic: true, skin: 'spotify', query: '?play=vid1&listen=1',
    fetchImpl: listenFetch([], noDur), playerOverride: channelPlayer(calls),
    run: async (dom) => {
      assert.match(panel(dom).className, /\bmms-spotify\b/, 'precondition: the Nordic skin painted');
      const rows = [...panel(dom).querySelectorAll('.mms-qlist .mms-row')];
      assert.deepStrictEqual(rows.map((r) => r.querySelector('.mms-rt').textContent), ['One', 'Two', 'Three'], 'the three chapter rows (non-vacuous)');
      assert.deepStrictEqual(rows.map((r) => { const d = r.querySelector('.mms-rd'); return d ? d.textContent : null; }), ['5:00', '5:00', null], 'the 0-span chapter has no length span (never 0:00)');
    },
  });
});
