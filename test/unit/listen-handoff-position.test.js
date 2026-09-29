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
const { liveListenPosition, listenHandoffChapterIndex, chapterStartFor, CHAPTER_RESUME_TAIL_SEC } = require(musicPath);

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
async function listenWith(player) {
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
    global.fetch = (u) => (String(u).indexOf('/api/videos/') === 0
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(CHAPTERED_VIDEO) })
      : Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) }));
    dom.window.FileTube = { registerView: (n, m) => { registered = m; }, player, shimmerArt: () => {}, pushViewState: () => {}, replaceViewState: () => {}, navigate: () => {} };
    require(musicPath);
    registered.init(dom.window.document.getElementById('view-root'));
    for (let k = 0; k < 8; k++) await settle();
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

test('Watch -> Listen on a chaptered video starts in the playhead chapter, at the second read AT LOAD', async () => {
  // 130 s at the tap, 131.5 s by the time the row loads (the audio played on through the fetches):
  // the load must seek to the LATER reading, or the handoff rewinds by the wait.
  const loads = await listenWith(basePlayer('vidX', [130, 131.5]));
  assert.strictEqual(loads.length, 1, 'exactly one load');
  assert.strictEqual(loads[0].id, 'vidX::c1', '130 s is in chapter 2 (120-240), not chapter 1');
  assert.strictEqual(loads[0].data.chapterStartSec, 120);
  assert.strictEqual(loads[0].data.chapterResumeSec, 131.5, 'seeks to the load-time playhead');
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
