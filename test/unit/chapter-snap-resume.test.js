'use strict';

// [UNIT] Chapter Snap persist follow-up (2026-09-24, Dean: "it's as if it's completely off
// time of the track like the relative offset underneath is off"). A chapter TAP resumes at
// the saved file position (v1.222) when that position lies in the tapped chapter. The
// position rides each queue row as `progress.resumeSec`, attached by the SERVER against the
// chapter bounds of the moment the list was fetched. A snap save moves the bounds IN PLACE
// (applySnappedChapterTimes) but the rows keep the progress of the OLD bounds, so after
// moving a chapter's start LATER past the saved place, tapping it seeked BEFORE its new
// start: the row said chapter N, the audio played the tail of chapter N-1 (measured in real
// Chromium: new start 498, the tap seeked to 491.1). The rule now: a resume is honored only
// INSIDE the tapped chapter's CURRENT bounds, read from the row itself at tap time.
// Driven through REAL music.js (+ skin-surface.js, music-skins.js): the album drill, its
// "Fix times" save seam, and a real row click into a player.load spy.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
require('../../public/js/common.js');

const AK = 'NESTALGIA␟The Mix';
// The file f1: three chapters [0,60) [60,120) [120,180). The saved file position (70 s)
// lies in chapter 2, so the SERVER attached it to that row (musicListProgressMap).
function tracksFixture() {
  const base = { artist: 'NESTALGIA', album: 'The Mix', albumKey: AK, progressEndpoint: '/api/progress', source: 'library-chapter', streamSrc: '/video/f1', artUrl: '/thumbnail/f1', liked: false };
  return [
    { ...base, id: 'f1::c0', title: 'Opening', durationSec: 60, chapterStartSec: 0 },
    { ...base, id: 'f1::c1', title: 'Second Song', durationSec: 60, chapterStartSec: 60, progress: { position: 10, duration: 60, updatedAt: 'x', resumeSec: 70 } },
    { ...base, id: 'f1::c2', title: 'Closer', durationSec: 60, chapterStartSec: 120 },
  ];
}

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <select id="music-sort-select"></select>
  <button id="music-view-toggle" hidden><i></i></button>
  <button id="music-popout-btn" type="button" hidden aria-pressed="false"></button>
  <div class="music-actions-wrap"><button type="button" id="music-actions-btn" aria-haspopup="true" aria-expanded="false" hidden></button>
  <div class="mms-sticker-menu" id="music-actions-menu" role="menu" hidden></div></div>
  <div id="player-slot"></div>
  <video id="media-player"></video>
  <div id="music-nowplaying-panel" class="music-nowplaying-panel"></div>
  <button type="button" class="music-nowplaying" id="music-nowplaying" hidden></button>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((r) => setImmediate(r));
const settleN = async (n) => { for (let i = 0; i < n; i++) await settle(); };

async function boot(run) {
  const tracks = tracksFixture();
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music?play=' + encodeURIComponent('f1::c0') });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  dom.window.matchMedia = () => ({ matches: false, media: '(max-width: 768px)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } });
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  const editor = [];
  const loads = [];
  global.fetch = (url, init) => {
    const u = String(url);
    const method = (init && init.method) || 'GET';
    if (method !== 'GET') return Promise.resolve({ ok: true, json: async () => ({}) });
    if (u === '/api/subscriptions/status') return Promise.resolve({ ok: true, json: async () => ({ oneShots: {} }) });
    const idm = u.match(/^\/api\/music\/([^?]+)$/);
    if (idm) {
      const t = tracks.find((x) => x.id === decodeURIComponent(idm[1]));
      return Promise.resolve(t ? { ok: true, json: async () => t } : { ok: false, status: 404, json: async () => ({}) });
    }
    if (u.indexOf('/api/music/albums') === 0 || u.indexOf('/api/music/artists') === 0) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    return Promise.resolve({ ok: true, json: async () => ({ items: tracks }) });
  };
  let registered = null;
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player: {
      currentId: null, getState: () => 'docked', expand: () => {}, dock: () => {}, getCurrentMeta: () => null,
      load: (id, data) => { dom.window.FileTube.player.currentId = id; loads.push({ id, data }); },
      setTrackNav: () => {}, isLoopEnabled: () => false, setLoop: () => {}, close: () => {},
    },
  };
  dom.window.fetchCurrentUser = () => Promise.resolve({ user: { role: 'admin' } });
  dom.window.fetchLikedTotal = () => Promise.resolve(0);
  dom.window.showToast = () => {};
  dom.window.addToQueue = () => {};
  dom.window.showChapterSnapEditor = (id, o) => { editor.push({ id, opts: o }); return { close() {} }; };
  delete require.cache[require.resolve('../../public/js/music-skins.js')];
  require('../../public/js/music-skins.js');
  delete require.cache[require.resolve('../../public/js/skin-surface.js')];
  require('../../public/js/skin-surface.js');
  try {
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(dom.window.document.getElementById('view-root'));
    await settleN(12);
    await run(dom, { editor, loads });
  } finally {
    try { if (registered) registered.destroy(); } catch (_) { /* best-effort */ }
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
}

const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const row = (dom, id) => dom.window.document.querySelector('.music-song-row[data-id="' + id + '"]');
const lastLoadOf = (loads, id) => loads.filter((l) => l.id === id).pop();

test('Dean\'s shape: a chapter whose start a snap save moved LATER past the saved place starts at its NEW head, never back in the previous song', async () => {
  await boot(async (dom, ctx) => {
    assert.ok(row(dom, 'f1::c1'), 'the drill rendered the chapter rows');
    // Control (the fixture REACHES the resume state): before any save, the tap resumes at 70 s.
    click(dom, row(dom, 'f1::c1'));
    await settleN(6);
    const before = lastLoadOf(ctx.loads, 'f1::c1');
    assert.ok(before, 'the chapter played');
    assert.strictEqual(before.data.chapterStartSec, 60);
    assert.strictEqual(before.data.chapterResumeSec, 70, 'precondition: a saved place inside the chapter resumes (v1.222)');
    // The snap save: chapter 2 now starts at 75 - AFTER the saved place (70 s is chapter 1 now).
    click(dom, dom.window.document.querySelector('.music-drill-snap'));
    await settleN(2);
    assert.strictEqual(ctx.editor.length, 1, 'Fix times opened the ONE editor');
    ctx.editor[0].opts.onSaved({ chapters: [{ startTime: 0, title: 'Opening' }, { startTime: 75, title: 'Second Song' }, { startTime: 120, title: 'Closer' }], chaptersSource: 'manual', chaptersEdited: true });
    await settleN(4);
    click(dom, row(dom, 'f1::c1'));
    await settleN(6);
    const after = lastLoadOf(ctx.loads, 'f1::c1');
    assert.notStrictEqual(after, before, 'the chapter was tapped again');
    assert.strictEqual(after.data.chapterStartSec, 75, 'the row carries the NEW start');
    assert.strictEqual(after.data.chapterResumeSec, undefined,
      'no seek to 70 s: that is the previous song now - the tap starts at the chapter\'s new head');
  });
});

test('chapterResumeSecFor: a saved place BEFORE the chapter\'s start is not a resume (the lower bound); AT the start it is', () => {
  delete global.window; delete global.document;
  delete require.cache[musicPath];
  const { chapterResumeSecFor } = require(musicPath);
  const ch = (resumeSec) => ({ chapterStartSec: 8, durationSec: 8, progress: { resumeSec } }); // [8, 16)
  assert.strictEqual(chapterResumeSecFor(ch(7.99)), undefined, 'just before the start: the chapter head');
  assert.strictEqual(chapterResumeSecFor(ch(0)), undefined, 'far before the start: the chapter head');
  assert.strictEqual(chapterResumeSecFor(ch(8)), 8, 'exactly at the start: resume (inside)');
  assert.strictEqual(chapterResumeSecFor(ch(10.99)), 10.99, 'inside, before the tail: resume');
  assert.strictEqual(chapterResumeSecFor({ chapterStartSec: 8, durationSec: 0, progress: { resumeSec: 5 } }), undefined,
    'an unknown span still refuses a place before the start');
  assert.strictEqual(chapterResumeSecFor({ durationSec: 8, progress: { resumeSec: 2 } }), 2, 'a missing start reads as 0 (the v1.222 default): 2 s is inside');
  delete require.cache[musicPath];
});
