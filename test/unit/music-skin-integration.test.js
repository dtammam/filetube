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
    player: playerOverride || { currentId: meta.id, getState: () => 'full', getCurrentMeta: () => meta, expand() {}, setTrackNav() {}, load() {}, dock() { spy.dock += 1; } },
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
  assert.match(js, /if \(st\.scanTimer\) \{ try \{ st\.win\.clearTimeout\(st\.scanTimer\)[\s\S]*?\}\s*\n\s*try \{ st\.wheel\.setPointerCapture/, 'the moved (rotate) branch clears the pending hold-timer before capturing');
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

test('v1.257 (QA S3+W1b): the tray menu hides the inert Skin chips, and the plain-window fallback never offers the Tray row', async () => {
  await boot({ mobile: false, isMusic: true, skin: 'apple', run: async (dom) => {
    // full pop-out: chips present, Tray row present (both non-vacuous baselines)
    const holder = { pip: makePipWindow() };
    dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(holder.pip) };
    clickPopout(dom); await settle(); await settle();
    const full = holder.pip;
    pipPanelOf(full).querySelector('[data-skin-sticker]').dispatchEvent(new full.MouseEvent('click', { bubbles: true }));
    assert.ok(pipPanelOf(full).querySelector('[data-skin-pick]'), 'full pop-out offers the Skin chips');
    // toggle to tray: the chips vanish (the donor is forced - a pick would visibly no-op)
    holder.pip = makePipWindow();
    pipPanelOf(full).querySelector('[data-skin-tray]').dispatchEvent(new full.MouseEvent('click', { bubbles: true }));
    await settle(); await settle();
    const tray = holder.pip;
    pipPanelOf(tray).querySelector('[data-skin-sticker]').dispatchEvent(new tray.MouseEvent('click', { bubbles: true }));
    assert.ok(pipPanelOf(tray).querySelector('[data-skin-tray]'), 'the Tray row is there to toggle back (non-vacuous)');
    // v1.258: the chips are the COLORWAYS in tray - the ipod family only (those picks
    // genuinely restyle the tray body; apple/spotify would visibly no-op)
    const trayChips = [...pipPanelOf(tray).querySelectorAll('[data-skin-pick]')].map((c) => c.getAttribute('data-skin-pick'));
    assert.deepStrictEqual(trayChips.sort(), ['ipod', 'ipod-black'], 'exactly the two colorway chips inside the tray');
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

test('v1.257 (adversarial W-A) source-lock: the Nano reshape rules exist - without them the tray is the full iPod crammed into 340x210', () => {
  // Measured gap: deleting the whole tray CSS block left the suite green (jsdom has no
  // layout), and the plan CLAIMED a lock that was never written after the Nano pivot.
  // Lock the load-bearing reshapes; the selectors deliberately omit the skin-base class
  // (the v1.232 first-occurrence locks - see the block's own comment).
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /body\.mms-tray \.ip-wheelwrap, body\.mms-tray \.ip-listview\{ display:none; \}/, 'the wheel and list are hidden - the tray is the LCD alone');
  assert.match(css, /body\.mms-tray \.ip-lcd\{[^}]*margin:var\(--space-3\) var\(--space-4\)/, 'the LCD insets into the body frame (the v1.258 Nano feel)');
  assert.match(css, /body\.mms-tray \.ip-npmain\{ display:flex; align-items:center/, 'art sits beside the meta (the Nano-5g row)');
  assert.match(css, /body\.mms-tray \.ip-cover\{ width:88px; height:88px/, 'the Nano art box');
  assert.match(css, /body\.mms-tray \.ip-ttl\{[^}]*text-overflow:ellipsis/, 'the title ellipsizes in the strip');
  assert.match(css, /body\.mms-tray \.mms-sticker\{ transform:scale\(\.55\)/, 'only the sticker BUTTON shrinks (the menu keeps thumb sizes - QA S4)');
  assert.match(css, /body\.mms-tray \.music-nowplaying-panel\{ position:fixed; inset:0; border-radius:var\(--radius-lg\)/, 'the panel fills the pip viewport, rounded like the shell');
});


test('v1.258 colorways: a Pocket Classic (Black) pick keeps its BLACK body in the tray (the variant-aware donor)', async () => {
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