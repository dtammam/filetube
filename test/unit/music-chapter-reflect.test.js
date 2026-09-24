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
  <button id="music-autoplay-btn" type="button" aria-pressed="false">Autoplay</button>
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
  // v1.311: boot straight onto the Songs tab with the chaptered album as the flat list (drill=null),
  // so a row tap exercises the NOT-in-album playRowAt -> playTrackInAlbum({solo}) callsite.
  if (opts.songsList) { try { dom.window.localStorage.setItem('filetube_music_tab', 'songs'); } catch (_) { /* ignore */ } }
  const metaById = (id) => { const t = CHAPTERS.find((x) => x.id === id); return t ? { isMusic: true, id: t.id, title: t.title, artist: t.artist, album: t.album, albumKey: t.albumKey } : null; };
  const playerState = { state: 'docked', currentId: null, meta: null };
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  let registered = null;
  let lastNav = null; // v1.311: the most recent setTrackNav({onPrev,onNext}) - so a test can bind the ended-advance target
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player: {
      currentId: null, getState: () => playerState.state, expand: () => { playerState.state = 'full'; },
      getCurrentMeta: () => playerState.meta,
      // opts.mobile: the REAL player expands itself on a fresh play (straight-to-player);
      // this stub mirrors that so the skin (which needs state 'full') actually paints.
      load: (id) => { playerState.currentId = id; dom.window.FileTube.player.currentId = id; playerState.meta = metaById(id); if (opts.mobile) playerState.state = 'full'; },
      setTrackNav: (h) => { lastNav = h || null; },
    },
  };
  global.window.addToQueue = () => {};
  // v1.311 gate r3 (F5 flake fix): every fetch body's json() promise is TRACKED so a test can drain
  // the async station prefetch DETERMINISTICALLY before driving the segment boundary - the solo-exit
  // hand-off is one-shot at the boundary tick (reflect advances chapterViewId right after), so if the
  // prefetch has not resolved by then it degrades and the reveal never fires. `drain` awaits all
  // outstanding json() promises, re-looping to catch the picker's SEQUENTIAL artist-then-library
  // fetches (the library one is not even issued until the artist json resolves).
  const jsonPending = [];
  const body = (items) => ({ ok: true, json: () => { const p = Promise.resolve({ items: items }); jsonPending.push(p); return p; } });
  // v1.311: opts.radio feeds the endless-autoplay picker's random library fetch, so a test can
  // prove a natural chapter playthrough stations on (append tracks) at the last chapter.
  global.fetch = (url2) => {
    const s = String(url2);
    // gate r1 (adversary S5): opts.trackGate answers the ALAC prewarm's ranged GET /track/<id>
    // (a test can hold it open while it switches Autoplay off)
    if (opts.trackGate && s.indexOf('/track/') === 0) return opts.trackGate(s);
    if (s.indexOf('album=') !== -1) return Promise.resolve(body(albumOrder));
    if (opts.radio && s.indexOf('/api/music?') !== -1 && s.indexOf('sort=random') !== -1) return Promise.resolve(body(opts.radio));
    if (opts.songsList && s.indexOf('/api/music?') !== -1 && s.indexOf('artist=') === -1 && s.indexOf('filter=') === -1) return Promise.resolve(body(CHAPTERS));
    return fetchMap()(url2);
  };
  const drain = async () => { for (let k = 0; k < 30 && jsonPending.length; k++) { const batch = jsonPending.splice(0); await Promise.allSettled(batch); await settle(); } await settle(); };
  const root = () => dom.window.document.getElementById('view-root');
  const ctx = { playerState, dom, getNav: () => lastNav, drain, reinit: async () => { registered.destroy(); registered.init(root()); for (let i = 0; i < 10; i++) await settle(); } };
  try {
    if (opts.mobile || opts.panel) { // opts.panel: the desktop now-playing panel's renderer lives in skin-surface.js too
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
// v1.311: click a rendered drill control/row (bubbles to the #music-content delegation).
const clickSel = (dom, sel) => { const el = dom.window.document.querySelector(sel); if (!el) throw new Error('no element: ' + sel); el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); return el; };

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
    // with the yank skipped, that same tick sits in the chapter-advance tolerance too, so
    // the DISPLAY rolls to chapter three. NOTE (v1.271): the repaint NO LONGER drops the
    // gesture - paint() defers while a spin is live and endWheel flushes it, so the wheel
    // node the finger is on survives (measured: survived=true at v1.271, false before).
    // This is the one place a reader would come to learn that, so it must not still say
    // the old thing. The chapter roll itself is deliberately NOT guarded by isScrubbing:
    // guarding it delays the roll past release and breaks this test's loop contract.
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

// ---- v1.311 (Dean, tech-debt #230 part i): a natural chapter playthrough re-registers nav ----
// The bug: registerTrackNav ran once at LOAD (on the started chapter); reflectChapter advanced
// the displayed identity WITHOUT re-registering, so onNext/onPrev froze at the load index and the
// last-index-only radio arm never fired on a natural playthrough. The whole-file ended-advance
// then replayed the frozen onNext (back into THIS file) instead of stationing on. These bind the
// re-registration behaviourally (the nav CLOSURE, not a source-lock), both axes: mid-album Next
// tracks the playhead, and the LAST chapter arms the radio.
test('v1.311: rolling to a middle chapter re-registers Next around the LIVE chapter (not the load index)', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle();                     // roll into chapter two (index 1)
    assert.strictEqual(playingId(dom), 'film::c1', 'displayed chapter advanced to two');
    const nav = ctx.getNav();
    assert.ok(nav && typeof nav.onNext === 'function', 'Next is registered on chapter two');
    assert.ok(typeof nav.onPrev === 'function', 'Prev is registered on chapter two (it is no longer the first)');
    nav.onNext();                                  // the ended-advance / lock-screen Next fires this
    await settle();
    // Without the reflect re-register, onNext was frozen at the load index (c0) -> onNext = playAt(1)
    // -> c1, i.e. it would REPLAY chapter two. The fix advances it to chapter THREE.
    assert.strictEqual(ctx.playerState.currentId, 'film::c2', 'Next from chapter two loads chapter THREE, not a replay');
  });
});

test('v1.311: a natural playthrough to the LAST chapter arms the radio (stations on, does not loop the file)', async () => {
  const RADIO = [{ id: 'next-album-track', title: 'Fresh Song', artist: 'Someone', album: 'Other', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle();  // -> chapter two
    set(250); await settle();  // -> chapter three (the LAST chapter): the radio arm must finally fire
    await ctx.drain();         // deterministically settle the picker's fetch + append + re-register
    const nav = ctx.getNav();
    assert.ok(nav && typeof nav.onNext === 'function', 'the last chapter now has a Next (the appended radio track)');
    nav.onNext();
    await settle();
    // Before the fix the last chapter never armed the radio on a natural playthrough, so the whole-file
    // ended-advance replayed a chapter of THIS file. The fix stations on to the appended track.
    assert.strictEqual(ctx.playerState.currentId, 'next-album-track', 'Next from the last chapter plays the stationed-on radio track, not this file');
  }, { radio: RADIO });
});

// v1.311.3 (Dean: "a chaptered album should play ALL its chapters before radio", reproduced END TO
// END in headless Chromium): the test above fires onNext straight after the arm - it never drove the
// whole-file END. At 'ended' the player's cascade rewinds the element to 0 (runEndedCompletionCascade)
// BEFORE the async ended-advance resolves, and that rewind's timeupdate read as a cross back into
// chapter one: registerTrackNav(0) replaced the armed onNext with playAt(1) and the album looped from
// chapter two. Drive the REAL order: arm on the last chapter, 'ended', the rewind tick, THEN the advance.
test('v1.311.3: the whole-file END rewind does not re-register nav - the ended advance stations on', async () => {
  const RADIO = [{ id: 'next-album-track', title: 'Fresh Song', artist: 'Someone', album: 'Other', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const { mp, set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle();
    set(250); await settle();  // the LAST chapter: the radio arms
    await ctx.drain();
    set(360); await settle();
    mp.dispatchEvent(new dom.window.Event('ended'));
    set(0); await settle();    // the cascade's el.currentTime = 0 -> its timeupdate
    mp.dispatchEvent(new dom.window.Event('seeked')); await settle(); // ...and the rewind's own seeked (at 0)
    await ctx.drain();
    assert.strictEqual(playingId(dom), 'film::c2', 'the rewind is not a cross: the last chapter stays shown');
    ctx.getNav().onNext();     // the ended advance (handleAutoplayNext -> fallbackToTrackNav)
    await settle();
    assert.strictEqual(ctx.playerState.currentId, 'next-album-track', 'the album END stations on - never back into chapter two');
  }, { radio: RADIO });
});

test('v1.311.3: after the end rewind, a PLAY (a loop replay / the user) re-reflects chapter one normally', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const { mp, set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(250); await settle();
    assert.strictEqual(playingId(dom), 'film::c2');
    mp.dispatchEvent(new dom.window.Event('ended'));
    set(0); await settle();
    assert.strictEqual(playingId(dom), 'film::c2', 'held on the end rewind');
    mp.dispatchEvent(new dom.window.Event('play'));
    set(1); await settle();
    assert.strictEqual(playingId(dom), 'film::c0', 'playing again from the top shows chapter one (the hold is not sticky)');
    const nav = ctx.getNav();
    nav.onNext(); await settle();
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'and Next is registered around chapter one again');
  });
});

test('v1.311.3 gate r1 S3/S4: the end hold clears on a new LOAD, and a paused SEEK after the end follows the user', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const { mp, set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(250); await settle();
    mp.dispatchEvent(new dom.window.Event('ended'));
    set(0); await settle();
    assert.strictEqual(playingId(dom), 'film::c2', 'held on the end rewind');
    // S4: autoplay off, no advance - the user drags into chapter two while paused
    set(150);
    mp.dispatchEvent(new dom.window.Event('seeked'));
    await settle();
    assert.strictEqual(playingId(dom), 'film::c1', 'a paused seek after the end re-reflects the chapter sought into');
    ctx.getNav().onNext(); await settle();
    assert.strictEqual(ctx.playerState.currentId, 'film::c2', 'and Next follows it (chapter three), not the stale radio arm');
    // S3: a fresh end, then a new load (loadstart) - the hold must not survive it
    mp.dispatchEvent(new dom.window.Event('ended'));
    set(0); await settle();
    mp.dispatchEvent(new dom.window.Event('loadstart'));
    set(130); await settle();
    assert.strictEqual(playingId(dom), 'film::c1', 'after a loadstart the watcher reflects again');
  });
});

// ---- v1.311 (Dean, first-class chapters): a SELECTED chapter exits after its own segment -------
// Tapping ONE chapter row plays only that chapter's segment and then EXITS to the station (a related
// new album), never bleeding into the rest of the shared file. The album's Play button still plays
// straight through. These bind the boundary hand-off behaviourally (queue + player state), all axes.
test('v1.311: tapping ONE chapter row exits to the station at that chapter\'s end (does not bleed into the next chapter)', async () => {
  const RADIO = [{ id: 'station-track', title: 'Fresh Song', artist: 'Someone', album: 'Other', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    // the album drill is rendered (rows c0/c1/c2). Tap the MIDDLE chapter row -> a solo select.
    clickSel(dom, '#music-content .music-song-row[data-index="1"]');
    await ctx.drain(); // deterministically settle playAt + the pre-fetched station BEFORE the boundary
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'the tapped chapter is loaded');
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle(); // playing inside chapter two [120,240)
    set(240); await settle(); // reach chapter two's END boundary -> must EXIT, not roll into c2
    await ctx.drain();
    assert.strictEqual(ctx.playerState.currentId, 'station-track', 'exited to the station track at the segment end');
    assert.notStrictEqual(ctx.playerState.currentId, 'film::c2', 'did NOT bleed into the next chapter of the same file');
  }, { radio: RADIO });
});

test('v1.311: Loop chapter OUTRANKS the solo-chapter exit (loop the segment, never exit)', async () => {
  const RADIO = [{ id: 'station-track', title: 'Fresh Song', artist: 'Someone', album: 'Other', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    clickSel(dom, '#music-content .music-song-row[data-index="1"]'); // solo-select chapter two
    await ctx.drain(); // the station IS primed and ready - so the assertion proves Loop OUTRANKS a ready exit
    const { mp, set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => true; // Loop chapter ON
    set(130); await settle();
    set(239.9); await settle(); // hit the end band with loop ON
    for (let i = 0; i < 4; i++) await settle();
    assert.strictEqual(mp.currentTime, 120, 'looped back to chapter two start, not exited');
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'stayed on chapter two - the exit did not fire');
  }, { radio: RADIO });
});

test('v1.311: the album PLAY button plays straight through - the FIRST chapter\'s own boundary does NOT exit', async () => {
  // gate r2 F2: drive chapter ONE's OWN end band (119.9), where a misclassified-solo mutant WOULD
  // fire the exit - the r1 version drove set(130), past c0's band, so the mutant slipped through.
  const RADIO = [{ id: 'station-track', title: 'Fresh Song', artist: 'Someone', album: 'Other', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    clickSel(dom, '#music-content .music-drill-play'); // play the whole album from the top (NOT solo)
    await ctx.drain();
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(60); await settle();    // inside chapter ONE
    set(119.9); await settle(); // chapter ONE's END BAND - a solo would exit HERE (radio is primed & ready)
    await ctx.drain();
    assert.strictEqual(ctx.playerState.currentId, 'film::c0', 'play-all did NOT exit at chapter one\'s own boundary band');
    set(130); await settle();   // cross into chapter two
    assert.strictEqual(ctx.playerState.currentId, 'film::c0', 'straight-through: the same file keeps playing');
    assert.strictEqual(playingId(dom), 'film::c1', 'the displayed chapter advanced (reflect), but playback did not exit');
  }, { radio: RADIO });
});

test('v1.311 (gate r2 F2): a continue-listening RESUME of a mid-album chapter plays straight through (not solo)', async () => {
  // ?play=film::c1 -> playTrackFromContinue -> playTrackInAlbum(c1) with NO opts -> resume, NOT a
  // single-chapter select. A misclassify (solo on every chapter load) would exit at c1's boundary.
  const RADIO = [{ id: 'station-track', title: 'S', artist: 'A', album: 'O', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c1'), async (dom, ctx) => {
    await ctx.drain();
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'resumed onto chapter two');
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle();   // inside chapter two
    set(239.9); await settle(); // chapter two's END BAND - a misclassified resume-as-solo would exit here
    await ctx.drain();
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'the resume plays straight through the boundary (not a solo exit)');
  }, { radio: RADIO });
});

// ---- v1.311 gate r2: adversary findings (surface binding + seek cap + last-chapter + guards) ----
test('v1.311 (gate r2 F3): a chapter tapped from the SONGS list exits after its segment (playTrackInAlbum solo callsite)', async () => {
  const RADIO = [{ id: 'station-track', title: 'Fresh Song', artist: 'Someone', album: 'Other', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music', async (dom, ctx) => {
    // booted on the Songs tab: c0/c1/c2 as a flat list, drill=null. Tap c1 -> NOT-in-album path.
    clickSel(dom, '#music-content .music-song-row[data-index="1"]');
    await ctx.drain(); // drill render + play + station prime, deterministically
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'the tapped chapter plays inside its album');
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle();
    set(240); await settle();
    await ctx.drain();
    assert.strictEqual(ctx.playerState.currentId, 'station-track', 'the songs-list solo callsite passed the flag - exited to the station');
  }, { radio: RADIO, songsList: true });
});

// The skin onSelectIndex and now-playing up-next callsites only exist behind the mobile skin /
// expanded panel (the desktop harness never enters that state, and the skin owns its own up-next),
// so their solo classification is bound HERE as a callsite lock - "does this line pass the flag" -
// while the DOWNSTREAM effect (playAt with soloChapter -> exit-after-segment) is proven behaviorally
// by the songs-list, in-album-re-tap, and middle-chapter tests above. Deleting the flag at either
// callsite (the M6c/M6d mutants) turns this red. Comment-stripped so a commented-out line can't pass.
test('v1.311 (gate r2 F3): the skin-select and up-next callsites pass soloChapter (classification lock)', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  const js = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''); // strip line + block comments
  assert.match(js, /onSelectIndex:\s*function\s*\(i\)\s*\{\s*playAt\(i,\s*\{\s*soloChapter:\s*true\s*\}\)/, 'the skin track-select callsite passes soloChapter:true');
  assert.match(js, /if\s*\(!isNaN\(idx\)\)\s*playAt\(idx,\s*\{\s*soloChapter:\s*true\s*\}\)/, 'the now-playing up-next row-tap callsite passes soloChapter:true');
});

test('v1.311 (gate r2 F1): solo-selecting the LAST chapter does NOT arm a solo-exit (no double-prime / duplicate append)', async () => {
  const RADIO = [
    { id: 'st1', title: 'S1', artist: 'A', album: 'O', albumKey: 'X', durationSec: 200, source: 'library' },
    { id: 'st2', title: 'S2', artist: 'A', album: 'O', albumKey: 'X', durationSec: 200, source: 'library' },
    { id: 'st3', title: 'S3', artist: 'A', album: 'O', albumKey: 'X', durationSec: 200, source: 'library' },
  ];
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    clickSel(dom, '#music-content .music-song-row[data-index="2"]'); // tap the LAST chapter
    await ctx.drain();
    assert.strictEqual(ctx.playerState.currentId, 'film::c2', 'the last chapter is playing');
    const nav = ctx.getNav();
    assert.ok(nav && typeof nav.onNext === 'function', 'the last-index endless-autoplay armed a Next (the ONE station run)');
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(250); await settle();   // inside the last chapter [240,360)
    set(359.9); await settle(); // reach the file/last-segment end
    await ctx.drain();
    // The last chapter is EXCLUDED from the solo-exit (nothing to skip) - so enforceChapterExit must
    // NOT fire here. Its end is the whole-file end, handled by player.js's ended-advance (not this
    // jsdom seam). Without the exclusion, a solo-exit would fire at 359.9 and append a DUPLICATE
    // station run, jumping the player onto it.
    assert.strictEqual(ctx.playerState.currentId, 'film::c2', 'no solo-exit fired for the last chapter (the ended-advance owns the last-segment station-on)');
  }, { radio: RADIO });
});

test('v1.311 (gate r3 F1b): with a station already in up-next, a chapter tap lands on the EXISTING station (no duplicate, no skipped rows)', async () => {
  const RADIO = [];
  for (let n = 1; n <= 7; n++) RADIO.push({ id: 'st' + n, title: 'S' + n, artist: 'A', album: 'O', albumKey: 'X', durationSec: 200, source: 'library' });
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    // play-all to the LAST chapter so maybeExtendQueueForAutoplay appends st1..st5 to the VISIBLE up-next
    set(250); await settle();
    await ctx.drain();
    const navAfterExtend = ctx.getNav();
    assert.ok(navAfterExtend && typeof navAfterExtend.onNext === 'function', 'the play-all extend appended a visible station');
    // now tap a MIDDLE chapter row (still c0/c1/c2 in the drill; the station is not rendered there)
    clickSel(dom, '#music-content .music-song-row[data-index="1"]');
    await ctx.drain(); // solo prime (fetches st6/st7, excluding the already-queued st1..st5)
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'the middle chapter is loaded');
    set(130); await settle(); // back inside chapter two
    set(240); await settle(); // its end boundary
    await ctx.drain();
    // Must land on st1 - the FIRST already-visible station row - not append st6/st7 over the top and
    // jump onto them (which would skip st1..st5 the user can see: the r2 F1b finding).
    assert.strictEqual(ctx.playerState.currentId, 'st1', 'exited onto the EXISTING first up-next station, not a freshly-appended duplicate');
  }, { radio: RADIO });
});

test('v1.311 (gate r2 F2): a forward SEEK into a later chapter does NOT trigger the exit (bounded fire window)', async () => {
  const RADIO = [{ id: 'station-track', title: 'S', artist: 'A', album: 'O', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    clickSel(dom, '#music-content .music-song-row[data-index="1"]'); // solo-select chapter two
    await ctx.drain(); // ensure the station IS primed, so a false-fire would actually reach a station
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle();          // playing inside chapter two
    set(300); await settle();          // SEEK far forward into chapter THREE (delta 170 >> a normal step)
    await ctx.drain();
    assert.notStrictEqual(ctx.playerState.currentId, 'station-track', 'a deliberate seek past the segment did NOT throw us to a station');
    assert.strictEqual(playingId(dom), 'film::c2', 'the seek landed in chapter three (reflect advanced), exit intent dropped');
  }, { radio: RADIO });
});

test('v1.311 (gate r2 F4): with autoplay OFF a solo chapter has no station - it plays straight through (no exit, no crash)', async () => {
  // radio IS available - so the ONLY thing that must prevent a station is the autoplay-OFF gate in
  // primeSoloExitStation (drop that gate and this reds: the chapter would exit to a station).
  const RADIO = [{ id: 'station-track', title: 'S', artist: 'A', album: 'O', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    try { dom.window.localStorage.setItem('ft-music-autoplay', '0'); } catch (_) { /* ignore */ }
    clickSel(dom, '#music-content .music-song-row[data-index="1"]'); // solo-select chapter two, autoplay OFF
    await ctx.drain();
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle();
    set(240); await settle(); // reach the boundary with no station primed
    await ctx.drain();
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'no station -> stayed on the file (degrade to straight-through); the display then advances via reflect');
    assert.strictEqual(playingId(dom), 'film::c2', 'playback rolled into chapter three (not exited, not crashed)');
  }, { radio: RADIO });
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

// ---- v1.279 (Dean): the chapter loop was INCONSISTENT - a sparse timeupdate that jumped
// across the tight [end-0.25, end+1) band slipped past and rolled into the next chapter.
// The crossing clause catches a NORMAL-step playback crossing regardless of the band, while
// a big jump (a scrub, or the stale post-scrub tick) is still rejected. ---------------------

test('v1.279: a SPARSE tick that JUMPS the band (below -> above, normal step) STILL loops the chapter', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    const { mp, set } = loopable(dom, 360); // 3 x 120s chapters, boundary at 120
    dom.window.FileTube.player.isLoopEnabled = () => true;
    set(119); await settle();     // BELOW the band [119.75, 121) - no seek yet
    assert.strictEqual(mp.currentTime, 119, 'not yet at the boundary');
    set(121.6); await settle();   // ABOVE the band (a 2.6s throttled gap) - the OLD code slipped here
    assert.strictEqual(mp.currentTime, 0, 'the sparse crossing STILL looped back to chapter one start');
    assert.strictEqual(playingId(dom), 'film::c0', 'stayed on chapter one (did NOT roll to chapter two)');
  });
});

test('v1.279: a BIG jump past the boundary (delta > the normal step) is NOT looped - the scrub protection holds', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    const { mp, set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => true;
    set(118); await settle();     // inside chapter one
    set(128); await settle();     // +10s in one tick (far past end 120) - a scrub-sized jump, not playback
    assert.strictEqual(mp.currentTime, 128, 'a big jump is NOT yanked back (a forward scrub survives)');
  });
});

test('v1.279 (gate lock): a normal-speed forward SCRUB crossing a boundary SURVIVES - via reflect-advance, not the delta', async () => {
  // Both gate seats: the crossing clause could yank a forward scrub. It does NOT for a
  // normal-speed scrub, because reflectChapter (bound to timeupdate, NOT scrub-guarded)
  // advances chapterViewId DURING the drag - so by the post-release tick the bounds are the
  // NEXT chapter and the frozen `last` sits below its start -> crossed cannot fire. This locks
  // that protector (the residual is only a scrub so fast NO mid-tick fires - tech-debt).
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    const { mp, set } = loopable(dom, 360); // 3 x 120s, boundary at 120
    dom.window.FileTube.player.isLoopEnabled = () => true;
    set(118); await settle(); // establish chapter one; lastLoopTime = 118
    const panel = dom.window.document.getElementById('music-nowplaying-panel');
    const wheel = panel.querySelector('.ip-wheel');
    assert.ok(wheel, 'the wheel rendered (mobile skin)');
    wheel.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    wheel.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 86.6, clientY: 50 }));
    set(121); await settle();  // mid-drag: crosses the boundary -> reflect advances to chapter two
    assert.strictEqual(playingId(dom), 'film::c1', 'reflect advanced the displayed chapter during the drag');
    wheel.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
    set(122); await settle();  // the stale post-release tick, just past the OLD boundary
    assert.ok(Math.abs(mp.currentTime - 122) < 0.5, 'the forward scrub SURVIVED - not yanked back to a chapter start');
  }, { mobile: true });
});

test('v1.279 (Dean A): the sticker Loop row reads "Loop chapter" while a chaptered ::c track plays', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom) => {
    const panel = dom.window.document.getElementById('music-nowplaying-panel');
    const stickerBtn = panel.querySelector('[data-skin-sticker]');
    assert.ok(stickerBtn, 'the sticker button rendered (mobile skin)');
    stickerBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();
    const loop = panel.querySelector('.mms-sm-loop .mms-sm-lbl');
    assert.ok(loop, 'the Loop row rendered');
    assert.match(loop.textContent, /Loop chapter/, 'a chaptered track: the label makes clear it loops the CHAPTER');
    assert.doesNotMatch(loop.textContent, /Loop chapter chapter/, 'not doubled');
  }, { mobile: true });
});

test('v1.279 (Dean A): the Loop label is chapter-CONDITIONAL (plain "Loop" for a normal song)', () => {
  const skin = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'skin-surface.js'), 'utf8');
  assert.match(skin, /loopIsChapter \? 'Loop chapter' : 'Loop'/, 'the label is a ternary on the chapter test - never unconditional');
  assert.match(skin, /stickerCfg\.isChapterTrack\(\)/, 'derived from the view-supplied chapter test');
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  assert.match(js, /isChapterTrack: function \(\) \{ var id = effectiveCurrentId\(\);[^}]*::c/, 'music.js reports a ::c track as a chapter');
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

// ---- Music follow-ups item 0 (2026-09-24): what "Autoplay off" means --------------------------
// Autoplay is the STATION (the tracks lined up when YOUR queue runs out). MEASURED in headless
// Chromium before this: the station is appended EARLY (when the last track starts), so turning
// Autoplay off during that last track left the picks in the queue and the natural end played on
// into them (the M4 adversary's side observation). Bound here on both axes, through the REAL
// toolbar button and through a pref that arrives in storage with no toggle (prefs-sync).
const STATION = () => { const r = []; for (let n = 1; n <= 5; n++) r.push({ id: 'st' + n, title: 'S' + n, artist: 'A', album: 'O', albumKey: 'X', durationSec: 200, source: 'library' }); return r; };
const autoplayBtn = (dom) => dom.window.document.getElementById('music-autoplay-btn');
// the desktop now-playing panel's rendered up-next row titles (the title span of each row)
const upNextTitles = (dom) => [...dom.window.document.querySelectorAll('#music-nowplaying-panel .mnp-queue-row')]
  .map((r) => { const t = r.querySelector('.mnp-queue-title'); return (t ? t.textContent : r.textContent).trim(); });

test('item 0: Autoplay turned OFF (the REAL toolbar button) on the last chapter RETRACTS the unplayed station - the end stops where the album ends; ON again lines it up now', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    ctx.playerState.state = 'full'; // the expanded desktop player: the now-playing panel renders its up-next
    set(250); await settle(); // play through to the LAST chapter: the station is appended early
    await ctx.drain();
    assert.ok(ctx.getNav() && typeof ctx.getNav().onNext === 'function', 'precondition: the station is up (a Next exists past the album)');
    assert.deepStrictEqual(upNextTitles(dom).filter((t) => /^S\d/.test(t)), ['S1', 'S2', 'S3', 'S4', 'S5'], 'precondition: the station rows are ON SCREEN (populated before the clear)');
    assert.strictEqual(autoplayBtn(dom).getAttribute('aria-pressed'), 'true', 'precondition: Autoplay is on (the default)');
    autoplayBtn(dom).click();
    assert.strictEqual(dom.window.localStorage.getItem('ft-music-autoplay'), '0', 'the toggle wrote the shared pref');
    assert.strictEqual(autoplayBtn(dom).getAttribute('aria-pressed'), 'false');
    assert.strictEqual(ctx.getNav().onNext, undefined, 'the station is retracted: the last chapter is the end of the queue again (no Next for the ended-advance)');
    // gate r1 (qa W3 = adversary W2): AC0(b) - the rendered up-next shows the truth
    assert.deepStrictEqual(upNextTitles(dom), ['Chapter One', 'Chapter Two', 'Chapter Three'], 'the up-next rows no longer list the station');
    assert.strictEqual(ctx.playerState.currentId, 'film::c0', 'the playing file is untouched');
    // the ON axis: switching it back on while on the last chapter lines the station up NOW
    autoplayBtn(dom).click();
    assert.strictEqual(autoplayBtn(dom).getAttribute('aria-pressed'), 'true');
    await ctx.drain();
    assert.ok(upNextTitles(dom).some((t) => /^S\d/.test(t)), 'the station is back on screen');
    const nav = ctx.getNav();
    assert.ok(nav && typeof nav.onNext === 'function', 'ON on the last track re-armed the station without waiting for a load');
    nav.onNext();
    await settle();
    assert.strictEqual(ctx.playerState.currentId, 'st1', 'and the end stations on');
  }, { radio: STATION(), panel: true });
});

test('item 0: a pref that reaches storage with NO toggle (another device, prefs-sync) - the advance refuses the station pick and retracts it; YOUR queue still plays through', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    // your queue first: with Autoplay OFF the album's own next chapter is NOT a station pick
    dom.window.localStorage.setItem('ft-music-autoplay', '0');
    const first = ctx.getNav();
    assert.ok(first && typeof first.onNext === 'function', 'precondition: chapter one has a Next (chapter two)');
    first.onNext();
    await settle();
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'Autoplay off never stops YOUR queue (the album plays through)');
    // now on: the last chapter appends the station; then the pref flips in storage only
    dom.window.localStorage.setItem('ft-music-autoplay', '1');
    set(250); await settle();
    await ctx.drain();
    const armed = ctx.getNav();
    assert.ok(armed && typeof armed.onNext === 'function', 'precondition: the station is up');
    dom.window.localStorage.setItem('ft-music-autoplay', '0'); // no toggle in this view
    armed.onNext(); // the natural-end advance (the player's ended cascade calls exactly this)
    await settle();
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'the advance did NOT enter the station pick');
    assert.strictEqual(ctx.getNav().onNext, undefined, 'the picks were retracted and the nav re-armed with no Next');
  }, { radio: STATION() });
});

test('item 0: the solo-chapter exit re-checks Autoplay at the hand-off - a station primed while on is never appended once it is off (storage-only flip)', async () => {
  const RADIO = [{ id: 'station-track', title: 'Fresh Song', artist: 'Someone', album: 'Other', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    clickSel(dom, '#music-content .music-song-row[data-index="1"]'); // solo-select chapter two
    await ctx.drain(); // the station is primed and ready (the v1.311 test above exits onto it)
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'precondition: the tapped chapter is loaded');
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    dom.window.localStorage.setItem('ft-music-autoplay', '0'); // flipped with no toggle
    set(130); await settle();
    set(240); await settle(); // the segment end: the hand-off point
    await ctx.drain();
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'no station was appended or loaded: a straight-through listen');
  }, { radio: RADIO });
});

test('item 0: the solo-chapter exit onto an EXISTING station row (gate r3 F1b) is refused once Autoplay is off (storage-only flip) - the row is retracted, nothing loads', async () => {
  const RADIO = [];
  for (let n = 1; n <= 7; n++) RADIO.push({ id: 'st' + n, title: 'S' + n, artist: 'A', album: 'O', albumKey: 'X', durationSec: 200, source: 'library' });
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(250); await settle();
    await ctx.drain(); // the play-all extend appended st1..st5 (visible up-next)
    clickSel(dom, '#music-content .music-song-row[data-index="1"]'); // solo-select chapter two
    await ctx.drain();
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'precondition: the middle chapter is loaded');
    dom.window.localStorage.setItem('ft-music-autoplay', '0');
    set(130); await settle();
    set(240); await settle(); // its end boundary: the F1b branch would land on st1
    await ctx.drain();
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'did NOT land on the existing station row');
  }, { radio: RADIO });
});

test('item 0: switched OFF while a station pick is PLAYING, that pick keeps playing and only the picks after it retract (it becomes the end; Prev still steps back into the album)', async () => {
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(250); await settle();
    await ctx.drain(); // the station is appended at the last chapter
    ctx.getNav().onNext(); await settle(); // onto the first station pick
    await ctx.drain();
    assert.strictEqual(ctx.playerState.currentId, 'st1', 'precondition: a station pick is playing');
    assert.strictEqual(typeof ctx.getNav().onNext, 'function', 'precondition: more picks follow it');
    autoplayBtn(dom).click();
    const nav = ctx.getNav();
    assert.strictEqual(ctx.playerState.currentId, 'st1', 'the playing pick is untouched');
    assert.strictEqual(nav.onNext, undefined, 'the picks after it are retracted: it is the end of the queue');
    assert.strictEqual(typeof nav.onPrev, 'function', 'Prev is still armed');
    nav.onPrev(); await settle();
    assert.strictEqual(ctx.playerState.currentId, 'film::c2', 'Prev lands on the album\'s last chapter (the playing pick kept its place)');
  }, { radio: STATION() });
});

test('item 0: a station the solo-chapter exit appended is a station too - switched OFF while its first track plays, the rest retract', async () => {
  const RADIO = [1, 2].map((n) => ({ id: 'sx' + n, title: 'SX' + n, artist: 'A', album: 'O', albumKey: 'X', durationSec: 200, source: 'library' }));
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    clickSel(dom, '#music-content .music-song-row[data-index="1"]'); // solo-select chapter two
    await ctx.drain(); // the exit station is primed
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle();
    set(240); await settle(); // the segment end: the exit appends the primed station and plays its first track
    await ctx.drain();
    assert.strictEqual(ctx.playerState.currentId, 'sx1', 'precondition: exited onto the appended station');
    assert.strictEqual(typeof ctx.getNav().onNext, 'function', 'precondition: the second station track follows');
    autoplayBtn(dom).click();
    assert.strictEqual(ctx.getNav().onNext, undefined, 'the rest of the exit station is retracted');
    assert.strictEqual(ctx.playerState.currentId, 'sx1', 'the playing track is untouched');
  }, { radio: RADIO });
});

// ---- Gate r1 fixes (music follow-ups) ------------------------------------------------------
// qa W1 = adversary W1 (a regression): Autoplay OFF then ON during a SOLO chapter selection lost
// the exit station (the retract nulled the primed picks). Both axes through the REAL toolbar.
test('gate r1 F1: Autoplay OFF then ON during a solo chapter keeps its exit station (stations on at the segment end); OFF alone still listens straight through', async () => {
  const RADIO = [{ id: 'station-track', title: 'Fresh Song', artist: 'Someone', album: 'Other', albumKey: 'X', durationSec: 200, source: 'library' }];
  for (const [clicks, expected, label] of [[2, 'station-track', 'OFF then ON: stations on'], [1, 'film::c1', 'OFF: straight through']]) {
    await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
      clickSel(dom, '#music-content .music-song-row[data-index="1"]'); // solo-select chapter two
      await ctx.drain(); // the exit station is primed
      assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'precondition: the tapped chapter is loaded');
      for (let k = 0; k < clicks; k++) autoplayBtn(dom).click();
      assert.strictEqual(dom.window.localStorage.getItem('ft-music-autoplay'), clicks === 2 ? '1' : '0', 'precondition: the toggle state');
      const { set } = loopable(dom, 360);
      dom.window.FileTube.player.isLoopEnabled = () => false;
      set(130); await settle();
      set(240); await settle(); // the segment end
      await ctx.drain();
      assert.strictEqual(ctx.playerState.currentId, expected, label);
    }, { radio: RADIO });
  }
});

// adversary S5: Autoplay switched OFF while a station pick's ALAC rendition is being prepared
// (the prewarm's ranged GET held open) - the pick is not started when the rendition turns ready.
test('gate r1 F5: a station pick still being PREPARED when Autoplay goes off (toolbar, or a storage-only flip) or whose row was retracted is not started; with Autoplay left on it starts (control)', async () => {
  const RADIO = [1, 2].map((n) => ({ id: 'al' + n, title: 'AL' + n, artist: 'A', album: 'O', albumKey: 'X', durationSec: 200, source: 'music', needsTranscode: true }));
  // 'toolbar': OFF by the button (the row is retracted too); 'storage': a prefs-sync flip (the row
  // is still queued, only the pref says off); 'offon': OFF then ON (the pref is on again, but the
  // held pick's row was retracted and a fresh station lined up); false: the control
  for (const turnOff of ['toolbar', 'storage', 'offon', false]) {
    let release = null;
    const trackGate = () => new Promise((resolve) => { release = () => resolve({ ok: true, status: 206, body: null }); });
    await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
      const { set } = loopable(dom, 360);
      dom.window.FileTube.player.isLoopEnabled = () => false;
      set(250); await settle();
      await ctx.drain(); // the station (two ALAC picks) is appended at the last chapter
      ctx.getNav().onNext(); // the natural-end advance into the first pick: its prewarm starts
      for (let i = 0; i < 5; i++) await settle();
      assert.ok(release, 'precondition: the prewarm GET /track/al1 is in flight');
      if (turnOff === 'toolbar') autoplayBtn(dom).click();
      if (turnOff === 'storage') dom.window.localStorage.setItem('ft-music-autoplay', '0');
      if (turnOff === 'offon') { autoplayBtn(dom).click(); autoplayBtn(dom).click(); }
      release();
      for (let i = 0; i < 10; i++) await settle();
      if (turnOff) {
        assert.strictEqual(ctx.playerState.currentId, 'film::c0', turnOff + ': the prepared pick was NOT started');
        assert.strictEqual(dom.window.document.getElementById('music-status').hidden, true, 'the "Preparing" status is cleared');
      } else {
        assert.strictEqual(ctx.playerState.currentId, 'al1', 'control: with Autoplay on the prepared pick starts');
      }
    }, { radio: RADIO, trackGate });
  }
});
