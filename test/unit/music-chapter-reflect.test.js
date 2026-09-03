'use strict';

// [UNIT] v1.237 (Dean): a chaptered album is ONE file streamed by all its `::c` chapter
// tracks (chapterStartSec offsets). When playback ROLLS across a chapter boundary the
// player's currentId stays the loaded ::c id, so the now-playing title never updated. A
// timeupdate watcher (reflectChapter) re-derives the current chapter from currentTime and
// repaints the displayed identity WITHOUT reloading. Boots real music.js with a chaptered
// album + a driveable <div> media element, and binds the boundary-cross behaviourally.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
require('../../public/js/common.js');

const AK = 'DJ Mix␟Live Set';
// A chaptered file 'film' -> 3 virtual chapter tracks (ascending chapterStartSec), all one file.
const CHAPTERS = [
  { id: 'film::c0', title: 'Chapter One', artist: 'DJ', album: 'Live Set', albumKey: AK, durationSec: 120, source: 'library-chapter', chapterStartSec: 0, streamSrc: '/video/film' },
  { id: 'film::c1', title: 'Chapter Two', artist: 'DJ', album: 'Live Set', albumKey: AK, durationSec: 120, source: 'library-chapter', chapterStartSec: 120, streamSrc: '/video/film' },
  { id: 'film::c2', title: 'Chapter Three', artist: 'DJ', album: 'Live Set', albumKey: AK, durationSec: 120, source: 'library-chapter', chapterStartSec: 240, streamSrc: '/video/film' },
];
const RECENT = [CHAPTERS[0]];

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <select id="music-sort-select"></select>
  <button id="music-view-toggle" hidden><i></i></button>
  <div id="player-slot"></div>
  <video id="media-player"></video>
  <div id="music-nowplaying-panel" class="music-nowplaying-panel"></div>
  <button type="button" class="music-nowplaying" id="music-nowplaying" hidden></button>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
    <button type="button" class="music-tab" data-tab="songs" role="tab">Songs</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((r) => setImmediate(r));

function fetchMap() {
  return (url, init) => {
    const method = (init && init.method) || 'GET';
    if (method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    if (url.indexOf('album=') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: CHAPTERS }) });
    if (url.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: RECENT }) });
    const idm = url.match(/\/api\/music\/([^?]+)$/);
    if (idm) { const t = CHAPTERS.find((x) => x.id === decodeURIComponent(idm[1])); return Promise.resolve({ ok: true, json: async () => (t || {}) }); }
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
}

async function boot(url, run, opts) {
  opts = opts || {};
  const albumOrder = opts.chapters || CHAPTERS; // the /api/music?album= ordering (may be non-ascending)
  const dom = new JSDOM(VIEW_HTML, { url });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  // opts.mobile (v1.250): boot with the SKIN active (mobile viewport + the engine + iPod skin)
  // so a REAL wheel gesture can be live - the chapter-loop scrub-skip seam needs one.
  if (opts.mobile) {
    dom.window.matchMedia = () => ({ matches: true, media: '(max-width: 768px)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } });
    try { dom.window.localStorage.setItem('ft-music-skin', 'ipod'); } catch (_) { /* ignore */ }
  }
  const metaById = (id) => { const t = CHAPTERS.find((x) => x.id === id); return t ? { isMusic: true, id: t.id, title: t.title, artist: t.artist, album: t.album, albumKey: t.albumKey } : null; };
  const playerState = { state: 'docked', currentId: null, meta: null };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  let registered = null;
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player: {
      currentId: null, getState: () => playerState.state, expand: () => { playerState.state = 'full'; },
      getCurrentMeta: () => playerState.meta,
      // opts.mobile: the REAL player expands itself on a fresh play (straight-to-player);
      // this stub mirrors that so the skin (which needs state 'full') actually paints.
      load: (id) => { playerState.currentId = id; dom.window.FileTube.player.currentId = id; playerState.meta = metaById(id); if (opts.mobile) playerState.state = 'full'; }, setTrackNav: () => {},
    },
  };
  global.window.addToQueue = () => {};
  global.fetch = (url2) => (String(url2).indexOf('album=') !== -1 ? Promise.resolve({ ok: true, json: async () => ({ items: albumOrder }) }) : fetchMap()(url2));
  const root = () => dom.window.document.getElementById('view-root');
  const ctx = { playerState, dom, reinit: async () => { registered.destroy(); registered.init(root()); for (let i = 0; i < 10; i++) await settle(); } };
  try {
    if (opts.mobile) {
      // production script order: music-skins.js -> skin-surface.js -> music.js
      delete require.cache[require.resolve('../../public/js/music-skins.js')];
      require('../../public/js/music-skins.js');
      delete require.cache[require.resolve('../../public/js/skin-surface.js')];
      require('../../public/js/skin-surface.js');
    }
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(root());
    for (let i = 0; i < 10; i++) await settle();
    await run(dom, ctx);
    registered.destroy();
  } finally { delete require.cache[musicPath]; Object.assign(global, saved); }
}

const playingId = (dom) => { const r = dom.window.document.querySelector('#music-content .music-song-row.playing'); return r ? r.getAttribute('data-id') : null; };

test('v1.237: playback rolling across a chapter boundary re-reflects the CURRENT chapter (no reload)', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    assert.strictEqual(playingId(dom), 'film::c0', 'starts on chapter one');
    const mp = dom.window.document.getElementById('media-player');
    // the file rolls into chapter two (>= 120s) - fire timeupdate WITHOUT any reload
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 130 });
    mp.dispatchEvent(new dom.window.Event('timeupdate'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c1', 'the current-chapter highlight advanced to chapter two on the boundary cross');
    // and into chapter three
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 250 });
    mp.dispatchEvent(new dom.window.Event('timeupdate'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c2', 'and to chapter three');
  });
});

test('v1.237: a within-chapter timeupdate does NOT churn the identity (only a boundary cross)', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    const mp = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 40 }); // still in chapter one
    mp.dispatchEvent(new dom.window.Event('timeupdate'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c0', 'staying inside chapter one keeps the identity');
  });
});

// ---- v1.240 (Dean's loop bug): a ::c chapter loops its SEGMENT when Loop is on ----------
// The file-level loop only fires at the WHOLE file's end, so a chaptered `::c` "song" (a
// slice of the shared file) never looped. enforceChapterLoop seeks back to the chapter's
// start at its end boundary. Make currentTime SETTABLE (the seek-back writes it) + duration
// known, and turn the fake player's Loop on.
function loopable(dom, dur) {
  const mp = dom.window.document.getElementById('media-player');
  let ct = 0;
  Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => ct, set: (v) => { ct = Number(v); } });
  Object.defineProperty(mp, 'duration', { configurable: true, get: () => dur });
  return { mp, set: (v) => { ct = v; mp.dispatchEvent(new dom.window.Event('timeupdate')); } };
}

test('v1.240: with Loop ON, a ::c chapter loops its SEGMENT - seeks back at the end boundary, never advances', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    const { mp, set } = loopable(dom, 360); // 3 x 120s chapters
    dom.window.FileTube.player.isLoopEnabled = () => true;
    set(119.9); await settle(); // approach chapter one's end (boundary 120)
    assert.strictEqual(mp.currentTime, 0, 'looped back to chapter one start');
    assert.strictEqual(playingId(dom), 'film::c0', 'stayed on chapter one (did NOT advance to two)');
  });
});

test('v1.250 (adversarial W2): a LIVE wheel scrub in the boundary band is NOT yanked back; releasing re-arms the loop (both axes)', async () => {
  // The one new cross-module seam this refactor created: enforceChapterLoop now reads the
  // ENGINE's isScrubbing() instead of music.js's own wheelSpin. Drive a REAL gesture
  // (pointerdown + a confirmed-move, NO pointerup) on the painted iPod wheel, then fire a
  // timeupdate inside the loop band - the deliberate scrub must not be yanked back to the
  // chapter start (the v1.239/v1.240 carried interaction). Then release and prove the loop
  // enforcement is ALIVE again (the axis pair - kills the isScrubbing():false mutant one
  // way and the always-true mutant the other).
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c1'), async (dom) => {
    const { mp, set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => true;
    set(130); await settle();
    const panel = dom.window.document.getElementById('music-nowplaying-panel');
    assert.ok(panel.classList.contains('mms-full') && panel.classList.contains('mms-ipod'), 'the iPod skin painted (mobile boot)');
    const wheel = panel.querySelector('.ip-wheel');
    assert.ok(wheel, 'the wheel rendered');
    // start a live scrub: down off-center, one confirmed move (>8px travel, rotation)
    wheel.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    wheel.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 86.6, clientY: 50 }));
    // the playhead lands in chapter two's loop band (end 240) while the finger is still down.
    // Without the isScrubbing skip, enforceChapterLoop (bound FIRST) would yank to 120 before
    // reflectChapter ever saw the tick - the mutant turns the next assert red.
    set(239.9);
    assert.ok(Math.abs(mp.currentTime - 239.9) < 0.5, 'mid-scrub: the band tick did NOT yank back to 120 (isScrubbing skip)');
    // with the yank skipped, that same tick sits in the chapter-advance tolerance too, so the
    // DISPLAY rolls to chapter three and the repaint drops the gesture (production behavior -
    // paint() clears mid-gesture state; pre-U3 paintSkin did the same).
    await settle();
    wheel.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    // the enforcement axis: with the gesture over, the (now chapter-three) band loops again -
    // the always-true mutant leaves 359.9 untouched and reds this.
    dom.window.FileTube.player.isLoopEnabled = () => true;
    set(359.9); await settle();
    assert.strictEqual(mp.currentTime, 240, 'after release the loop enforcement is live again (yanked to chapter three start)');
  }, { mobile: true });
});

test('v1.240: Loop ON loops the PICKED middle chapter (back to its own start, not the file start)', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c1'), async (dom) => {
    const { mp, set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => true;
    // seed the playhead inside chapter two so its identity is established, then hit its end (240)
    set(130); await settle();
    assert.strictEqual(playingId(dom), 'film::c1', 'on chapter two');
    set(239.9); await settle();
    assert.strictEqual(mp.currentTime, 120, 'looped back to chapter TWO start (120), not the file start');
    assert.strictEqual(playingId(dom), 'film::c1', 'stayed on chapter two');
  });
});

test('v1.240: with Loop OFF, crossing a boundary ADVANCES normally (no seek-back)', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    const { mp, set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    // 119.9 sits WITHIN the loop's [end-0.25, end+1) band (adversarial SUGGESTION A): so with
    // Loop OFF this behaviourally kills a "remove the isLoopEnabled() gate" mutant (which would
    // otherwise seek back to 0 here), not just the source-lock. Clean code leaves it untouched.
    set(119.9); await settle();
    assert.strictEqual(mp.currentTime, 119.9, 'no seek-back when Loop is off (even inside the band)');
    assert.strictEqual(playingId(dom), 'film::c1', 'advanced to chapter two as usual');
  });
});

test('v1.240 (QA WARNING): a far position past the boundary is NOT yanked back - the loop trigger is upper-capped', async () => {
  // Simulates the post-scrub stale tick: Loop ON, displayed chapter is still c0 (reflect
  // has not run yet), but currentTime is already deep in chapter 3 (a forward scrub landed).
  // enforceChapterLoop runs FIRST with stale bounds {0,120}; without the end+1 cap it would
  // seek back to 0 (yank). With the cap, it must NOT seek, and reflect then advances to c2.
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    const { mp, set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => true;
    assert.strictEqual(playingId(dom), 'film::c0', 'displayed chapter one before the tick');
    set(250); await settle(); // far into chapter three, in ONE tick (stale chapterViewId=c0)
    assert.strictEqual(mp.currentTime, 250, 'NOT yanked back to 0 - a deliberate far scrub survives');
    assert.strictEqual(playingId(dom), 'film::c2', 'reflect then advanced the displayed chapter to three');
  });
});

test('v1.240 source-lock: enforceChapterLoop is bound BEFORE reflectChapter and SKIPS during a scrub', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  // bound first so a loop seek-back lands before the reflect can advance the displayed chapter
  assert.match(js, /addEventListener\('timeupdate', enforceChapterLoop[\s\S]*?addEventListener\('timeupdate', reflectChapter/, 'enforceChapterLoop is bound before reflectChapter');
  const m = /function enforceChapterLoop\(\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(m, 'enforceChapterLoop exists');
  // v1.250 (F-UNIFY): the live-scrub state lives in the shared engine; the loop enforcement
  // asks whichever surface exists via the engine's isScrubbing() accessor.
  assert.match(m[1], /inTabEngine && inTabEngine\.isScrubbing\(\)/, 'skips during an in-tab wheel scrub (the v1.239 carried interaction)');
  // v1.251 (R3): the pop-out lives behind the shared shell now - same seam, new address.
  assert.match(m[1], /popoutShell && popoutShell\.isScrubbing\(\)/, 'and during a pop-out wheel scrub (via the shared shell)');
  assert.match(m[1], /isLoopEnabled\(\)/, 'gated on the loop flag');
});

// ---- source locks ----------------------------------------------------------------------
test('v1.237: the chapter watcher is wired (timeupdate -> reflectChapter) and the renders prefer chapterViewId', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  assert.match(js, /addEventListener\('timeupdate', reflectChapter/, 'reflectChapter is bound to timeupdate (ensureChapterReflect)');
  assert.match(js, /chapterViewId = isChapter \? item\.id : null/, 'loadTrack seeds chapterViewId from the loaded chapter');
  // the base-gated effective id: prefer chapterViewId ONLY while the loaded chaptered file is
  // still the live track (gate W1) - used by BOTH the web render and the pop-out.
  assert.match(js, /function effectiveCurrentId\(\)/, 'the base-gated effective-current-id helper exists');
  assert.match(js, /replace\(\/::c\\d\+\$\/, ''\) === String\(live\)\.replace\(\/::c\\d\+\$\/, ''\)/, 'the override is gated on the live track sharing the chaptered file base');
  const prefers = js.match(/var curId = effectiveCurrentId\(\);/g) || [];
  assert.ok(prefers.length >= 2, 'updateNowPlayingPanel AND currentSkinIndex both use effectiveCurrentId');
  assert.match(js, /var currentId = effectiveCurrentId\(\);/, 'the "Playing from" label uses it too (W2)');
  const m = /function currentChapterId\(\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(m, 'currentChapterId exists');
  assert.match(m[1], /chapterStartSec/, 'derives the current chapter from chapterStartSec boundaries');
  assert.match(m[1], /library-chapter/, 'only over the loaded file\'s chapter tracks');
  assert.match(m[1], /\.slice\(\)\.sort\(/, 'sorts the chapter tracks by chapterStartSec (order-independent - gate W2)');
});

test('v1.237 (W2): the current chapter is derived order-independently (a sorted/shuffled album)', async () => {
  const reversed = [CHAPTERS[2], CHAPTERS[1], CHAPTERS[0]]; // Title Z-A / Longest / Shuffle can reverse queue order
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    const mp = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 130 }); // inside chapter two (120-240)
    mp.dispatchEvent(new dom.window.Event('timeupdate'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c1', 'derived chapter two despite the non-ascending queue order (not chaps[0])');
  }, { chapters: reversed });
});

test('v1.237 (W1): a dock-return mid-album does NOT blank the now-playing panel (stale chapterViewId reset on reseed)', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const mp = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 130 });
    mp.dispatchEvent(new dom.window.Event('timeupdate')); await settle(); // chapterViewId advanced to film::c1
    assert.strictEqual(playingId(dom), 'film::c1', 'rolled into chapter two');
    // a real dock-return re-inits WITHOUT ?play= (it seeds from the live player, no reload). The
    // SAME module instance keeps the survived chapterViewId (=film::c1); seedNowPlayingFromPlayer
    // must reset it to the live loaded id (film::c0) so the guard doesn't blank the panel.
    dom.reconfigure({ url: 'http://localhost/music?nowplaying=1' });
    await ctx.reinit();
    const mp2 = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp2, 'currentTime', { configurable: true, value: 130 });
    mp2.dispatchEvent(new dom.window.Event('timeupdate')); await settle();
    const panel = dom.window.document.getElementById('music-nowplaying-panel');
    assert.strictEqual(panel.hidden, false, 'the panel is NOT blanked after the dock-return (stale chapterViewId reset on reseed)');
  });
});

// NOTE: the adversarial's cross-media hide (a video live after a chaptered session must not
// show stale music) is covered by the effectiveCurrentId base-gate SOURCE-LOCK above - jsdom
// hides that panel via other init guards regardless of the gate, so a behavioral here would be
// vacuous (it passed even with the gate mutated off). The base-compare in effectiveCurrentId is
// the real bind; the W1 dock-return behavioral binds the reset discipline.

test('v1.237 (tolerance): the -0.25 anti-flicker band advances JUST before the exact boundary', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    const mp = dom.window.document.getElementById('media-player');
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 119.8 }); // 119.8 >= 120 - 0.25 = 119.75
    mp.dispatchEvent(new dom.window.Event('timeupdate'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c1', 'crossed into chapter two within the tolerance band (-0.25), not at the exact 120');
  });
});

test('v1.237 (W1 neg): a non-music video on the shared host HIDES stale music (base-gate falls to live)', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const mp = dom.window.document.getElementById('media-player');
    ctx.playerState.state = 'full';                 // expanded, so the panel show/hide branch is reached
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 130 });
    mp.dispatchEvent(new dom.window.Event('timeupdate'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c1', 'rolled into chapter two (chapterViewId advanced to film::c1)');

    // A NON-MUSIC video becomes the live track WITHOUT a music loadTrack; its id shares no base
    // with the chaptered file. isMusic:false makes seedNowPlayingFromPlayer early-return, so
    // nowPlaying STAYS the stale film::c1 (== the stale chapterViewId) - the exact poison setup.
    ctx.playerState.currentId = 'clip-xyz';
    dom.window.FileTube.player.currentId = 'clip-xyz';
    ctx.playerState.meta = { isMusic: false, id: 'clip-xyz', title: 'Home Movie' };
    ctx.playerState.state = 'full';
    dom.reconfigure({ url: 'http://localhost/music' });  // plain nav back, no ?play=
    await ctx.reinit();

    const panel = dom.window.document.getElementById('music-nowplaying-panel');
    assert.strictEqual(panel.hidden, true,
      'the now-playing panel HIDES stale music while a non-music video plays (effectiveCurrentId falls to the live id)');
  });
});

test('v1.237 (W2 residual): the SAME file played as a raw (non-::c) video HIDES stale music', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const mp = dom.window.document.getElementById('media-player');
    ctx.playerState.state = 'full';
    Object.defineProperty(mp, 'currentTime', { configurable: true, value: 130 });
    mp.dispatchEvent(new dom.window.Event('timeupdate'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c1', 'rolled into chapter two');
    // the base video of the SAME file becomes live (id 'film' - shares the base, but NO `::c`).
    // effectiveCurrentId's `::c`-on-live conjunct must reject the stale chapterViewId (film::c1)
    // and fall to the live id, so the music panel HIDES over the raw video (binds the conjunct
    // itself - the different-base W1-neg test above cannot, since base-only would also hide it).
    ctx.playerState.currentId = 'film';
    dom.window.FileTube.player.currentId = 'film';
    ctx.playerState.meta = { isMusic: false, id: 'film', title: 'The Film' };
    ctx.playerState.state = 'full';
    dom.reconfigure({ url: 'http://localhost/music' });
    await ctx.reinit();
    const panel = dom.window.document.getElementById('music-nowplaying-panel');
    assert.strictEqual(panel.hidden, true, 'panel HIDES stale music while the raw (non-::c) video of the same file plays (::c-on-live gate)');
  });
});
