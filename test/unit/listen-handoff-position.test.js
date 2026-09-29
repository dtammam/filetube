'use strict';

// [UNIT] Watch -> Listen keeps its place on a chaptered video (Dean, 2026-09-29: "it like loses its
// place and starts from the beginning"). Measured before the fix in headless Chromium (plan
// 2026-09-29-watch-listen-position): Watch at 132.4 s -> Listen at 3.8 s, because playListenItem
// always played `<id>::c0`, a fresh load (not a same-id adopt) that seeks to chapter 1. The pure
// helpers are bound directly; the wiring runs the REAL init() (the listen-chapter-dock-return.test.js
// harness) so the chapter pick AND the load-time read are proven reachable, not just present.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
const fs = require('node:fs');
const path = require('node:path');
const { liveListenPosition, listenHandoffChapterIndex, chapterStartFor, handoffPaused, CHAPTER_RESUME_TAIL_SEC } = require(musicPath);

const rows = (starts) => starts.map((s, i) => ({ id: 'v::c' + i, chapterStartSec: s }));

test('listenHandoffChapterIndex: the last chapter begun by t, else the first', () => {
  const r = rows([0, 120, 240]);
  assert.strictEqual(listenHandoffChapterIndex(r, 0), 0);
  assert.strictEqual(listenHandoffChapterIndex(r, 119.9), 0);
  assert.strictEqual(listenHandoffChapterIndex(r, 120), 1, 'a boundary belongs to the chapter it starts');
  assert.strictEqual(listenHandoffChapterIndex(r, 130), 1);
  assert.strictEqual(listenHandoffChapterIndex(r, 9999), 2, 'past the last start = the last chapter');
  assert.strictEqual(listenHandoffChapterIndex(rows([30, 90]), 10), 0, 'before the first chapter = the first row');
  assert.strictEqual(listenHandoffChapterIndex(null, 50), 0);
  assert.strictEqual(listenHandoffChapterIndex([{ id: 'a', chapterStartSec: 'x' }, { id: 'b', chapterStartSec: 60 }], 70), 1, 'an unparseable start is skipped');
});

test('liveListenPosition: only the SAME item with a real, seekable, non-zero time', () => {
  const pl = (id, t) => ({ currentId: id, getCurrentTime: () => t });
  assert.strictEqual(liveListenPosition(pl('vid', 130.5), 'vid'), 130.5);
  assert.strictEqual(liveListenPosition(pl('other', 130.5), 'vid'), null, 'another item playing');
  assert.strictEqual(liveListenPosition(pl('vid::c1', 130.5), 'vid'), null, 'a chapter row is not the base video');
  assert.strictEqual(liveListenPosition(pl('vid', null), 'vid'), null, 'a live transcode reports null');
  assert.strictEqual(liveListenPosition(pl('vid', 0), 'vid'), null, 'position 0 = nothing to keep');
  assert.strictEqual(liveListenPosition(pl('vid', NaN), 'vid'), null);
  assert.strictEqual(liveListenPosition({ currentId: 'vid' }, 'vid'), null, 'no getCurrentTime');
  assert.strictEqual(liveListenPosition(null, 'vid'), null);
});

test('chapterStartFor: a handoff seeks to the live second; otherwise the saved place, unchanged', () => {
  const item = { id: 'vid::c1', chapterStartSec: 120, durationSec: 120, progress: { resumeSec: 150 } };
  const pl = { currentId: 'vid', getCurrentTime: () => 200 };
  assert.strictEqual(chapterStartFor(item, { handoffFrom: 'vid' }, pl), 200, 'the live second wins over a saved place');
  assert.strictEqual(chapterStartFor(item, {}, pl), 150, 'no handoff = the saved place (chapterResumeSecFor)');
  assert.strictEqual(chapterStartFor(item, undefined, pl), 150);
  assert.strictEqual(chapterStartFor(item, { handoffFrom: 'vid' }, { currentId: 'x', getCurrentTime: () => 200 }), 150,
    'a handoff whose video is no longer loaded falls back to the saved place');
  // the saved place's tail rule (restart a chapter heard to its end) must not eat a live handoff
  const tail = 120 + 120 - CHAPTER_RESUME_TAIL_SEC + 1;
  assert.strictEqual(chapterStartFor(item, { handoffFrom: 'vid' }, { currentId: 'vid', getCurrentTime: () => tail }), tail);
});

// ---- the wiring: the REAL init() on /music?play=vidX&listen=1 --------------------------------------
const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <div id="player-slot"></div>
  <div id="music-nowplaying-panel" hidden></div>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;
const CHAPTERED_VIDEO = {
  id: 'vidX', title: 'A Long Talk', duration: 300, channelName: 'The Channel',
  chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 120, title: 'Middle' }, { startTime: 240, title: 'End' }],
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Boots the listen arm against `player` and returns the load() calls. `player.getCurrentTime` is the
// probe: the watch page's playhead as the music view reads it.
async function listenWith(player, hooks) {
  hooks = hooks || {};
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  const loads = [];
  const realLoad = player.load;
  player.load = function (id, data) { loads.push({ id, data }); return realLoad ? realLoad.call(this, id, data) : true; };
  let registered = null;
  try {
    delete require.cache[musicPath];
    const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music?play=vidX&listen=1' });
    global.window = dom.window; global.document = dom.window.document;
    global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
    if (typeof hooks.mediaPaused === 'boolean') { // the shared player's element, as the watch page left it
      dom.window.document.body.insertAdjacentHTML('beforeend', '<audio id="media-player"></audio>');
      Object.defineProperty(dom.window.document.getElementById('media-player'), 'paused', { configurable: true, get: () => hooks.mediaPaused });
    }
    global.fetch = hooks.fetch || ((u) => (String(u).indexOf('/api/videos/') === 0
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(CHAPTERED_VIDEO) })
      : Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) })));
    dom.window.FileTube = { registerView: (n, m) => { registered = m; }, player, shimmerArt: () => {}, pushViewState: () => {}, replaceViewState: () => {}, navigate: () => {} };
    require(musicPath);
    registered.init(dom.window.document.getElementById('view-root'));
    for (let k = 0; k < 8; k++) await settle();
    if (hooks.afterBoot) { await hooks.afterBoot(dom); for (let k = 0; k < 8; k++) await settle(); }
    registered.destroy();
  } finally {
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
  return loads;
}
const basePlayer = (currentId, times) => {
  let n = 0;
  return {
    currentId, state: 'full',
    getCurrentTime() { const t = times[Math.min(n, times.length - 1)]; n += 1; return t; },
    load(id) { this.currentId = id; }, getState() { return this.state; }, expand() {}, dock() {}, setTrackNav() {},
  };
};

test('Watch -> Listen on a chaptered video starts in the playhead chapter, at the playhead', async () => {
  // The normal path: the chapter pick and the load run back to back after the /api/videos fetch,
  // so both reads see the same second.
  const loads = await listenWith(basePlayer('vidX', [130]));
  assert.strictEqual(loads.length, 1, 'exactly one load');
  assert.strictEqual(loads[0].id, 'vidX::c1', '130 s is in chapter 2 (120-240), not chapter 1');
  assert.strictEqual(loads[0].data.chapterStartSec, 120);
  assert.strictEqual(loads[0].data.chapterResumeSec, 130, 'seeks to the playhead, not the chapter head');
});

test('a handoff that WAITS on the chapter file check seeks to the second read at load, not at the pick', async () => {
  // The waiting path (measured by the gate on a real server: a tap-time read rewound 3.5 s here).
  // Returning to the app during the listen fetch arms the file check (returnEpoch > 0), so the pick
  // parks in verifyChapterFileThenPlay while its own /api/videos check runs and the watch audio plays
  // on; the waiter's replay must carry handoffFrom and read the playhead again.
  let now = 130;
  const player = basePlayer('vidX', []);
  player.getCurrentTime = () => now;
  let videoCalls = 0;
  let releaseListen;
  let releaseCheck;
  const reply = () => ({ ok: true, json: () => Promise.resolve(CHAPTERED_VIDEO) });
  const loads = await listenWith(player, {
    fetch: (u) => {
      if (String(u).indexOf('/api/videos/') !== 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
      videoCalls += 1;
      if (videoCalls === 1) return new Promise((r) => { releaseListen = () => r(reply()); });
      if (videoCalls === 2) return new Promise((r) => { releaseCheck = () => r(reply()); });
      return Promise.resolve(reply());
    },
    afterBoot: async (dom) => {
      Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, get: () => 'visible' });
      dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange')); // the app comes back
      releaseListen();
      for (let k = 0; k < 8; k++) await settle();
      assert.strictEqual(typeof releaseCheck, 'function', 'the pick is parked on the chapter file check');
      now = 133.5; // the watch audio played on through the check
      releaseCheck();
    },
  });
  assert.strictEqual(loads.length, 1, 'exactly one load, after the check');
  assert.strictEqual(loads[0].id, 'vidX::c1', 'the chapter picked at 130 s');
  assert.strictEqual(loads[0].data.chapterResumeSec, 133.5, 'seeks to the playhead read at load');
});

test('Listen with no live position for that video starts at chapter 1, as before', async () => {
  const other = await listenWith(basePlayer('someOtherVideo', [130]));
  assert.strictEqual(other[0].id, 'vidX::c0', 'another item playing: chapter 1');
  assert.strictEqual(other[0].data.chapterResumeSec, undefined, 'no seek past the chapter head');
  const live = await listenWith(basePlayer('vidX', [null]));
  assert.strictEqual(live[0].id, 'vidX::c0', 'a live transcode (null time): chapter 1');
  assert.strictEqual(live[0].data.chapterResumeSec, undefined);
  const none = await listenWith(basePlayer(null, [130]));
  assert.strictEqual(none[0].id, 'vidX::c0', 'nothing loaded: chapter 1');
});

// ---- Dean's ruling (2026-09-29): Listen keeps a PAUSED video paused ---------------------------------
test('handoffPaused: only a live handoff whose element is paused', () => {
  const pl = { currentId: 'vid', getCurrentTime: () => 130 };
  assert.strictEqual(handoffPaused({ handoffFrom: 'vid' }, pl, { paused: true }), true);
  assert.strictEqual(handoffPaused({ handoffFrom: 'vid' }, pl, { paused: false }), false, 'playing stays playing');
  assert.strictEqual(handoffPaused({}, pl, { paused: true }), false, 'not a handoff (a row tap) = the usual auto-start');
  assert.strictEqual(handoffPaused(undefined, pl, { paused: true }), false);
  assert.strictEqual(handoffPaused({ handoffFrom: 'vid' }, { currentId: 'other', getCurrentTime: () => 130 }, { paused: true }), false, 'the video is no longer loaded');
  assert.strictEqual(handoffPaused({ handoffFrom: 'vid' }, pl, null), false, 'no element');
});

test('Watch PAUSED -> Listen: the chapter row loads with startPaused; a playing Watch loads without it', async () => {
  const paused = await listenWith(basePlayer('vidX', [130]), { mediaPaused: true });
  assert.strictEqual(paused[0].id, 'vidX::c1');
  assert.strictEqual(paused[0].data.chapterResumeSec, 130);
  assert.strictEqual(paused[0].data.startPaused, true, 'a paused watch video stays paused on Listen');
  const playing = await listenWith(basePlayer('vidX', [130]), { mediaPaused: false });
  assert.strictEqual(playing[0].data.startPaused, false, 'a playing watch video keeps playing');
  const other = await listenWith(basePlayer('someOtherVideo', [130]), { mediaPaused: true });
  assert.strictEqual(other[0].data.startPaused, false, 'no handoff: the usual auto-start, whatever the old element says');
});

test('player.js SOURCE-LOCK: a startPaused chapter load seeks WITHOUT auto-starting, before resumeDirectly', () => {
  // The player's load path has no behavioural harness (tech-debt #180; music-chapter-playback.test.js
  // locks the same function the same way). Measured in the real app: see the plan's Research table.
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');
  const start = src.indexOf('  function handleResumePlayback(gen, id) {');
  assert.ok(start > 0, 'handleResumePlayback found');
  const fn = src.slice(start, src.indexOf("resumeMode === 'music'", start));
  const m = /if \(currentData\.startPaused === true && !liveMode\) \{ ([^}]*) \}/.exec(fn);
  assert.ok(m, 'the startPaused branch sits in the chapter branch');
  assert.strictEqual(m[1].trim(), 'mediaPlayer.currentTime = chapterSeek; return;', 'it only seeks, then returns');
  assert.ok(fn.indexOf('currentData.startPaused') < fn.indexOf('resumeDirectly(chapterSeek)'), 'checked before the auto-starting seek');
});

// ---- the mirror (Dean, 2026-09-29): Listen -> Watch keeps the place, and a pause ---------------------
test('player resolveBaseHandoff: only the chapter row of THE SAME file, with a real position, not live', () => {
  const { resolveBaseHandoff } = require('../../public/js/player.js');
  assert.deepStrictEqual(resolveBaseHandoff('vid::c2', 'vid', 133.5, true, false), { t: 133.5, paused: true });
  assert.deepStrictEqual(resolveBaseHandoff('vid::c2', 'vid', 133.5, false, false), { t: 133.5, paused: false });
  assert.strictEqual(resolveBaseHandoff('vid', 'vid::c1', 133.5, false, false), null, 'Watch -> Listen is music.js handoffFrom, not this');
  assert.strictEqual(resolveBaseHandoff('vid::c1', 'vid::c2', 133.5, false, false), null, 'a chapter-to-chapter load');
  assert.strictEqual(resolveBaseHandoff('vid::c2', 'other', 133.5, false, false), null, 'another file');
  assert.strictEqual(resolveBaseHandoff('vidX::c2', 'vid', 133.5, false, false), null, 'a prefix is not the base');
  assert.strictEqual(resolveBaseHandoff('vid::c2', 'vid', 0, false, false), null, 'no real position');
  assert.strictEqual(resolveBaseHandoff('vid::c2', 'vid', NaN, false, false), null);
  assert.strictEqual(resolveBaseHandoff('vid::c2', 'vid', 133.5, false, true), null, 'a live source');
  assert.strictEqual(resolveBaseHandoff(null, 'vid', 133.5, false, false), null, 'nothing loaded');
});

test('player.js SOURCE-LOCK: load() captures the handoff BEFORE the teardown; the resume applies it ahead of saved progress', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');
  const load = src.slice(src.indexOf('  function load(id, data, opts) {'), src.indexOf('  var api = {'));
  const cap = load.indexOf('loadBaseHandoff = resolveBaseHandoff(currentId, id, mediaPlayer ? mediaPlayer.currentTime : null, mediaPlayer ? mediaPlayer.paused : true, liveMode);');
  assert.ok(cap > 0, 'load() captures from the outgoing element');
  const teardown = load.indexOf('    teardownMediaState({ preserveImmersive: loadImmersiveCarry });');
  assert.ok(teardown > 0 && cap < teardown, 'before the teardown call resets it');
  assert.ok(cap > load.indexOf('if (adopt) {'), 'after the adopt early return (an adopt keeps the element as is)');
  const start = src.indexOf('  function handleResumePlayback(gen, id) {');
  const fn = src.slice(start, src.indexOf("fetch('/api/progress/' + id)", start));
  const m = /if \(loadBaseHandoff && !liveMode\) \{([\s\S]*?)\n {4}\}/.exec(fn);
  assert.ok(m, 'the handoff branch is in handleResumePlayback');
  assert.match(m[1], /if \(loadBaseHandoff\.paused\) mediaPlayer\.currentTime = loadBaseHandoff\.t;\s*else resumeDirectly\(loadBaseHandoff\.t\);\s*return;/,
    'paused: seek only; playing: the auto-starting seek; then return (no saved-progress ladder, no toast)');
  assert.ok(fn.indexOf('loadBaseHandoff && !liveMode') < fn.indexOf("resumeMode === 'music'"), 'ahead of every saved-progress branch');
});
