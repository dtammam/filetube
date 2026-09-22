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
  // v1.311: opts.radio feeds the endless-autoplay picker's random library fetch, so a test can
  // prove a natural chapter playthrough stations on (append tracks) at the last chapter.
  global.fetch = (url2) => {
    const s = String(url2);
    if (s.indexOf('album=') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: albumOrder }) });
    if (opts.radio && s.indexOf('/api/music?') !== -1 && s.indexOf('sort=random') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: opts.radio }) });
    if (opts.songsList && s.indexOf('/api/music?') !== -1 && s.indexOf('artist=') === -1 && s.indexOf('filter=') === -1) return Promise.resolve({ ok: true, json: async () => ({ items: CHAPTERS }) });
    return fetchMap()(url2);
  };
  const root = () => dom.window.document.getElementById('view-root');
  const ctx = { playerState, dom, getNav: () => lastNav, reinit: async () => { registered.destroy(); registered.init(root()); for (let i = 0; i < 10; i++) await settle(); } };
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
    for (let i = 0; i < 10; i++) await settle(); // let the picker's async fetch + append + re-register settle
    const nav = ctx.getNav();
    assert.ok(nav && typeof nav.onNext === 'function', 'the last chapter now has a Next (the appended radio track)');
    nav.onNext();
    await settle();
    // Before the fix the last chapter never armed the radio on a natural playthrough, so the whole-file
    // ended-advance replayed a chapter of THIS file. The fix stations on to the appended track.
    assert.strictEqual(ctx.playerState.currentId, 'next-album-track', 'Next from the last chapter plays the stationed-on radio track, not this file');
  }, { radio: RADIO });
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
    for (let i = 0; i < 10; i++) await settle(); // let playAt + the pre-fetched station settle
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'the tapped chapter is loaded');
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle(); // playing inside chapter two [120,240)
    set(240); await settle(); // reach chapter two's END boundary -> must EXIT, not roll into c2
    for (let i = 0; i < 6; i++) await settle();
    assert.strictEqual(ctx.playerState.currentId, 'station-track', 'exited to the station track at the segment end');
    assert.notStrictEqual(ctx.playerState.currentId, 'film::c2', 'did NOT bleed into the next chapter of the same file');
  }, { radio: RADIO });
});

test('v1.311: Loop chapter OUTRANKS the solo-chapter exit (loop the segment, never exit)', async () => {
  const RADIO = [{ id: 'station-track', title: 'Fresh Song', artist: 'Someone', album: 'Other', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    clickSel(dom, '#music-content .music-song-row[data-index="1"]'); // solo-select chapter two
    for (let i = 0; i < 10; i++) await settle();
    const { mp, set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => true; // Loop chapter ON
    set(130); await settle();
    set(239.9); await settle(); // hit the end band with loop ON
    for (let i = 0; i < 4; i++) await settle();
    assert.strictEqual(mp.currentTime, 120, 'looped back to chapter two start, not exited');
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'stayed on chapter two - the exit did not fire');
  }, { radio: RADIO });
});

test('v1.311: the album PLAY button plays straight through - a middle boundary does NOT exit', async () => {
  const RADIO = [{ id: 'station-track', title: 'Fresh Song', artist: 'Someone', album: 'Other', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    clickSel(dom, '#music-content .music-drill-play'); // play the whole album from the top
    for (let i = 0; i < 10; i++) await settle();
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle(); // cross into chapter two
    for (let i = 0; i < 4; i++) await settle();
    assert.strictEqual(ctx.playerState.currentId, 'film::c0', 'straight-through: no reload/exit at a mid-album boundary (same file keeps playing)');
    assert.strictEqual(playingId(dom), 'film::c1', 'the displayed chapter advanced (reflect), but playback did not exit');
  }, { radio: RADIO });
});

// ---- v1.311 gate r2: adversary findings (surface binding + seek cap + last-chapter + guards) ----
test('v1.311 (gate r2 F3): a chapter tapped from the SONGS list exits after its segment (playTrackInAlbum solo callsite)', async () => {
  const RADIO = [{ id: 'station-track', title: 'Fresh Song', artist: 'Someone', album: 'Other', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music', async (dom, ctx) => {
    // booted on the Songs tab: c0/c1/c2 as a flat list, drill=null. Tap c1 -> NOT-in-album path.
    clickSel(dom, '#music-content .music-song-row[data-index="1"]');
    for (let i = 0; i < 14; i++) await settle(); // drill render + play + station prime
    assert.strictEqual(ctx.playerState.currentId, 'film::c1', 'the tapped chapter plays inside its album');
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle();
    set(240); await settle();
    for (let i = 0; i < 6; i++) await settle();
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
    for (let i = 0; i < 12; i++) await settle();
    assert.strictEqual(ctx.playerState.currentId, 'film::c2', 'the last chapter is playing');
    const nav = ctx.getNav();
    assert.ok(nav && typeof nav.onNext === 'function', 'the last-index endless-autoplay armed a Next (the ONE station run)');
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(250); await settle();   // inside the last chapter [240,360)
    set(359.9); await settle(); // reach the file/last-segment end
    for (let i = 0; i < 6; i++) await settle();
    // The last chapter is EXCLUDED from the solo-exit (nothing to skip) - so enforceChapterExit must
    // NOT fire here. Its end is the whole-file end, handled by player.js's ended-advance (not this
    // jsdom seam). Without the exclusion, a solo-exit would fire at 359.9 and append a DUPLICATE
    // station run, jumping the player onto it.
    assert.strictEqual(ctx.playerState.currentId, 'film::c2', 'no solo-exit fired for the last chapter (the ended-advance owns the last-segment station-on)');
  }, { radio: RADIO });
});

test('v1.311 (gate r2 F2): a forward SEEK into a later chapter does NOT trigger the exit (bounded fire window)', async () => {
  const RADIO = [{ id: 'station-track', title: 'S', artist: 'A', album: 'O', albumKey: 'X', durationSec: 200, source: 'library' }];
  await boot('http://localhost/music?play=' + encodeURIComponent('film::c0'), async (dom, ctx) => {
    clickSel(dom, '#music-content .music-song-row[data-index="1"]'); // solo-select chapter two
    for (let i = 0; i < 10; i++) await settle();
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle();          // playing inside chapter two
    set(300); await settle();          // SEEK far forward into chapter THREE (delta 170 >> a normal step)
    for (let i = 0; i < 6; i++) await settle();
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
    for (let i = 0; i < 10; i++) await settle();
    const { set } = loopable(dom, 360);
    dom.window.FileTube.player.isLoopEnabled = () => false;
    set(130); await settle();
    set(240); await settle(); // reach the boundary with no station primed
    for (let i = 0; i < 6; i++) await settle();
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
