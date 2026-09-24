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
// Widened (Dean): #268 - a re-tap of the LOADED chapter whose bounds moved away from the
// playhead (the player ADOPTS a same-id load) seeks to it; #269 - a page coming back
// (visibilitychange / bfcache pageshow) re-checks the file's chapters against the server.

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

const FILE_CHAPTERS = [{ startTime: 0, title: 'Opening' }, { startTime: 60, title: 'Second Song' }, { startTime: 120, title: 'Closer' }];

// opts.server: { chapters, chaptersEdited, hold } - GET /api/videos/f1 answers `chapters` (the
// server's CURRENT resolved list); `hold` = true parks each answer until ctx.release() is called.
async function boot(run, opts) {
  opts = opts || {};
  const server = Object.assign({ chapters: FILE_CHAPTERS, chaptersEdited: false, hold: false }, opts.server || {});
  const tracks = tracksFixture().concat(opts.extraRows || []);
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music?play=' + encodeURIComponent('f1::c0') });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  dom.window.matchMedia = () => ({ matches: false, media: '(max-width: 768px)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } });
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  const editor = [];
  const loads = [];
  const videoGets = [];
  const parked = [];
  let visibility = 'visible';
  let playerState = 'docked';
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, get: () => visibility });
  // Every return-listener registration, with its options (the teardown binding reads the signal).
  const returnListeners = [];
  for (const [target, type] of [[dom.window.document, 'visibilitychange'], [dom.window, 'pageshow']]) {
    const orig = target.addEventListener.bind(target);
    target.addEventListener = (t, fn, o) => { if (t === type) returnListeners.push({ type: t, options: o }); return orig(t, fn, o); };
  }
  // The media element: a settable playhead and a play() counter. The player stub below models
  // the real load(): a SAME-id load is an ADOPT (player.js isAdoptLoad) and never touches it; a
  // genuine load seeks to chapterResumeSec, else chapterStartSec (player.js handleResumePlayback).
  const mp = dom.window.document.getElementById('media-player');
  const media = { t: 0, plays: 0, seeks: [] };
  Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => media.t, set: (v) => { media.t = v; media.seeks.push(v); } });
  Object.defineProperty(mp, 'duration', { configurable: true, get: () => 180 });
  mp.play = () => { media.plays += 1; return Promise.resolve(); };
  mp.pause = () => {};
  const fetchLog = [];
  const toasts = [];
  const navs = [];
  global.fetch = (url, init) => {
    const u = String(url);
    const method = (init && init.method) || 'GET';
    fetchLog.push(method + ' ' + u);
    if (method !== 'GET') return Promise.resolve({ ok: true, json: async () => ({}) });
    if (u === '/api/videos/f1') {
      videoGets.push(u);
      if (server.fail) return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
      const body = { id: 'f1', type: 'audio', title: 'The Mix', chapters: server.chapters.map((c) => ({ ...c })), chaptersSource: server.chaptersEdited ? 'manual' : 'embedded', chaptersEdited: server.chaptersEdited, duration: 180 };
      const res = { ok: true, json: async () => body };
      if (server.hold) return new Promise((resolve) => parked.push(() => resolve(res)));
      return Promise.resolve(res);
    }
    const other = u.match(/^\/api\/videos\/([^/?]+)$/);
    if (other && server.files && server.files[other[1]]) {
      videoGets.push(u);
      const f = server.files[other[1]];
      return Promise.resolve({ ok: true, json: async () => ({ id: other[1], type: 'audio', chapters: f.chapters.map((c) => ({ ...c })), chaptersSource: 'manual', chaptersEdited: !!f.chaptersEdited, duration: f.duration || 90 }) });
    }
    if (server.listFail && /^\/api\/music\?/.test(u)) return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
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
      currentId: null, getState: () => playerState, expand: () => {}, dock: () => {}, getCurrentMeta: () => null,
      load: (id, data) => {
        loads.push({ id, data });
        // ADOPT (player.js isAdoptLoad): the same id on a player that is not closed - the media is untouched.
        if (id === dom.window.FileTube.player.currentId && playerState !== 'closed') return true;
        dom.window.FileTube.player.currentId = id;
        playerState = 'docked';
        // A genuine load: a NEW src (the element reads 0 at once); the player's own resume seek lands later.
        media.t = 0;
        const target = typeof data.chapterResumeSec === 'number' ? data.chapterResumeSec : (Number(data.chapterStartSec) || 0);
        Promise.resolve().then(() => { media.t = target; });
        return true;
      },
      setTrackNav: (nav) => { navs.push(nav || {}); }, isLoopEnabled: () => false, setLoop: () => {}, close: () => {},
    },
  };
  dom.window.fetchCurrentUser = () => Promise.resolve({ user: { role: 'admin' } });
  dom.window.fetchLikedTotal = () => Promise.resolve(0);
  dom.window.showToast = (m) => { toasts.push(m); };
  dom.window.addToQueue = () => {};
  dom.window.showChapterSnapEditor = (id, o) => { editor.push({ id, opts: o }); return { close() {} }; };
  delete require.cache[require.resolve('../../public/js/music-skins.js')];
  require('../../public/js/music-skins.js');
  delete require.cache[require.resolve('../../public/js/skin-surface.js')];
  require('../../public/js/skin-surface.js');
  // The skin engine config (the pocket menus' onPlay = music.js playFromMenu), captured the way
  // the r1 qa seat did: through the pop-out shell factory music.js hands it to.
  let engineCfgFactory = null;
  { const SS = dom.window.FileTubeSkinSurface || global.FileTubeSkinSurface; const orig = SS.createPopoutShell; SS.createPopoutShell = (c) => { engineCfgFactory = c; return orig(c); }; }
  try {
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(dom.window.document.getElementById('view-root'));
    await settleN(12);
    await run(dom, {
      editor, loads, media, videoGets, server, registered, returnListeners, fetchLog, toasts, navs,
      engineCfg: () => engineCfgFactory && engineCfgFactory.engineConfigFor(dom.window.document.getElementById('music-nowplaying-panel'), dom.window),
      setVisibility: (v) => { visibility = v; },
      setPlayerState: (v) => { playerState = v; },
      release: () => { while (parked.length) parked.shift()(); },
    });
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

// ---- Tracker #268: a tap on the LOADED chapter whose bounds moved away from the playhead ----------

const snapSave = async (dom, ctx, chapters) => {
  click(dom, dom.window.document.querySelector('.music-drill-snap'));
  await settleN(2);
  ctx.editor[ctx.editor.length - 1].opts.onSaved({ chapters, chaptersSource: 'manual', chaptersEdited: true });
  await settleN(4);
};
const MOVED = [{ startTime: 0, title: 'Opening' }, { startTime: 75, title: 'Second Song' }, { startTime: 120, title: 'Closer' }];

test('#268: re-tapping the LOADED chapter after a save moved its start past the playhead seeks to the NEW start and plays; inside its bounds the adopt still stands', async () => {
  await boot(async (dom, ctx) => {
    click(dom, row(dom, 'f1::c1'));
    await settleN(6);
    assert.strictEqual(dom.window.FileTube.player.currentId, 'f1::c1', 'chapter 2 is the loaded id');
    assert.strictEqual(ctx.media.t, 70, 'precondition: it resumed at the saved place 70 s');
    // Control (both axes): the playhead is INSIDE chapter 2 - a re-tap is an adopt, no seek, no restart.
    const seeksBefore = ctx.media.seeks.length;
    const playsBefore = ctx.media.plays;
    click(dom, row(dom, 'f1::c1'));
    await settleN(6);
    assert.strictEqual(ctx.media.t, 70, 'inside the chapter the adopt keeps the playhead');
    assert.strictEqual(ctx.media.seeks.length, seeksBefore, 'no seek');
    assert.strictEqual(ctx.media.plays, playsBefore, 'no forced play');
    // The save moves chapter 2 to 75 s: the playhead (70 s) is now in chapter 1.
    await snapSave(dom, ctx, MOVED);
    click(dom, row(dom, 'f1::c1'));
    await settleN(6);
    assert.strictEqual(lastLoadOf(ctx.loads, 'f1::c1').data.chapterStartSec, 75, 'the tap is an adopt of the moved chapter');
    assert.strictEqual(ctx.media.t, 75, 'the playhead lands on the NEW start (not left in the previous song)');
    assert.ok(ctx.media.plays > playsBefore, 'and it plays');
  });
});

test('#268: a playthrough that rolled past the loaded chapter - a tap on that chapter goes back to it (its saved place when inside, else its head)', async () => {
  await boot(async (dom, ctx) => {
    click(dom, row(dom, 'f1::c1'));
    await settleN(6);
    ctx.media.t = 130; // the file rolled on into chapter 3 while f1::c1 stayed the loaded id
    click(dom, row(dom, 'f1::c1'));
    await settleN(6);
    assert.strictEqual(ctx.media.t, 70, 'back inside chapter 2, at its saved place (70 s lies inside [60, 120))');
  });
});

test('#268 chapterAdoptSeekFor: undefined inside the bounds (with the watcher\'s 0.25 s tolerance), the head or the in-bounds saved place outside', () => {
  delete global.window; delete global.document;
  delete require.cache[musicPath];
  const { chapterAdoptSeekFor } = require(musicPath);
  const ch = (extra) => Object.assign({ source: 'library-chapter', chapterStartSec: 60, durationSec: 60 }, extra || {}); // [60, 120)
  assert.strictEqual(chapterAdoptSeekFor(ch(), 60), undefined, 'at the start: inside');
  assert.strictEqual(chapterAdoptSeekFor(ch(), 59.8), undefined, 'within the 0.25 s tolerance: inside');
  assert.strictEqual(chapterAdoptSeekFor(ch(), 119.9), undefined, 'just before the end: inside');
  assert.strictEqual(chapterAdoptSeekFor(ch(), 59.7), 60, 'before the start (past the tolerance): the head');
  assert.strictEqual(chapterAdoptSeekFor(ch(), 120), 60, 'at the end: the head');
  assert.strictEqual(chapterAdoptSeekFor(ch({ progress: { resumeSec: 90 } }), 130), 90, 'outside, with a saved place inside: resume there');
  assert.strictEqual(chapterAdoptSeekFor(ch({ progress: { resumeSec: 50 } }), 130), 60, 'a saved place outside the chapter is never used');
  assert.strictEqual(chapterAdoptSeekFor(ch({ durationSec: 0 }), 500), undefined, 'an unknown span: anything past the start is inside');
  assert.strictEqual(chapterAdoptSeekFor({ source: 'library', chapterStartSec: 60 }, 10), undefined, 'not a chapter track');
  delete require.cache[musicPath];
});

// ---- Tracker #269: a page that comes back after the times were corrected elsewhere ---------------

const fire = (dom, name, init) => {
  const e = new dom.window.Event(name);
  if (init) Object.assign(e, init);
  (name === 'pageshow' ? dom.window : dom.window.document).dispatchEvent(e);
};
const rowText = (dom, id) => row(dom, id).textContent;

test('#269: back to visible after ANOTHER device moved a start - the rows, the spans and the next tap follow the server; unchanged -> nothing applied', async () => {
  await boot(async (dom, ctx) => {
    assert.match(rowText(dom, 'f1::c0'), /1:00/, 'precondition: chapter 1 spans 60 s');
    // Unchanged on the server: one request, nothing applied (the drill keeps its rows).
    ctx.setVisibility('hidden'); fire(dom, 'visibilitychange'); await settleN(4);
    assert.strictEqual(ctx.videoGets.length, 0, 'hidden: no request');
    const rowBefore = row(dom, 'f1::c0'); // the drill re-renders its rows on an apply
    ctx.setVisibility('visible'); fire(dom, 'visibilitychange'); await settleN(6);
    assert.strictEqual(ctx.videoGets.length, 1, 'visible: ONE request for the file');
    assert.match(rowText(dom, 'f1::c0'), /1:00/, 'unchanged -> the rows are untouched');
    assert.ok(rowBefore.isConnected, 'unchanged -> nothing applied (the drill was not re-rendered)');
    assert.strictEqual(dom.window.document.querySelector('.music-drill-edited'), null, 'no Edited badge (the populated clear axis follows below)');
    // Another device saves chapter 2 at 75 s.
    ctx.server.chapters = MOVED; ctx.server.chaptersEdited = true;
    ctx.setVisibility('hidden'); fire(dom, 'visibilitychange');
    ctx.setVisibility('visible'); fire(dom, 'visibilitychange'); await settleN(8);
    assert.strictEqual(ctx.videoGets.length, 2);
    assert.match(rowText(dom, 'f1::c0'), /1:15/, 'chapter 1 now spans 75 s');
    assert.match(rowText(dom, 'f1::c1'), /0:45/, 'chapter 2 now spans 45 s');
    assert.ok(dom.window.document.querySelector('.music-drill-edited'), 'the Edited badge follows');
    click(dom, row(dom, 'f1::c1'));
    await settleN(6);
    const load = lastLoadOf(ctx.loads, 'f1::c1');
    assert.strictEqual(load.data.chapterStartSec, 75, 'a tap plays the NEW start');
    assert.strictEqual(load.data.chapterResumeSec, undefined, 'the stale saved place (70 s, now chapter 1) is not used');
    assert.strictEqual(ctx.media.t, 75);
    // And back again: a revert elsewhere clears the badge on the next return.
    ctx.server.chapters = FILE_CHAPTERS; ctx.server.chaptersEdited = false;
    fire(dom, 'pageshow', { persisted: false }); await settleN(4);
    assert.strictEqual(ctx.videoGets.length, 2, 'a NON-bfcache pageshow asks nothing (the load itself fetched fresh)');
    fire(dom, 'pageshow', { persisted: true }); await settleN(8);
    assert.strictEqual(ctx.videoGets.length, 3, 'a bfcache restore asks once');
    assert.match(rowText(dom, 'f1::c0'), /1:00/, 'the reverted spans');
    assert.strictEqual(dom.window.document.querySelector('.music-drill-edited'), null, 'the badge clears');
  });
});

test('#269: a local save that lands while the return re-check is in flight wins - the older server answer is not applied over it', async () => {
  await boot(async (dom, ctx) => {
    ctx.server.hold = true; // the server still answers the OLD list (60 s), and slowly
    fire(dom, 'visibilitychange'); await settleN(2);
    assert.strictEqual(ctx.videoGets.length, 1, 'the re-check is in flight');
    fire(dom, 'visibilitychange'); await settleN(2);
    assert.strictEqual(ctx.videoGets.length, 1, 'one re-check at a time');
    await snapSave(dom, ctx, MOVED); // this tab saves 75 s meanwhile
    assert.match(rowText(dom, 'f1::c0'), /1:15/, 'precondition: the local save applied');
    ctx.release(); await settleN(8);
    assert.match(rowText(dom, 'f1::c0'), /1:15/, 'the in-flight answer (60 s) did not undo the newer save');
    click(dom, row(dom, 'f1::c1')); await settleN(6);
    assert.strictEqual(lastLoadOf(ctx.loads, 'f1::c1').data.chapterStartSec, 75);
  });
});

test('#269: the return listeners go with the view - after destroy a visibilitychange or a bfcache pageshow asks nothing', async () => {
  await boot(async (dom, ctx) => {
    fire(dom, 'visibilitychange'); await settleN(4);
    assert.strictEqual(ctx.videoGets.length, 1, 'bound while the view lives (populated axis)');
    const regs = ctx.returnListeners.filter((r) => r.type === 'visibilitychange' || r.type === 'pageshow');
    assert.ok(regs.some((r) => r.type === 'visibilitychange') && regs.some((r) => r.type === 'pageshow'), 'both return listeners were registered');
    assert.ok(regs.every((r) => r.options && r.options.signal && !r.options.signal.aborted), 'each rides a live view signal');
    ctx.registered.destroy();
    assert.ok(regs.every((r) => r.options.signal.aborted), 'destroy aborts every one (the listener is REMOVED, not merely inert)');
    fire(dom, 'visibilitychange'); fire(dom, 'pageshow', { persisted: true }); await settleN(4);
    assert.strictEqual(ctx.videoGets.length, 1, 'removed on teardown - no leak');
  });
});

test('#269 queuedChaptersDiffer: a moved start, title, span-to-next or a dropped chapter is a change; the same list, other files and a subset are not', () => {
  delete global.window; delete global.document;
  delete require.cache[musicPath];
  const { queuedChaptersDiffer } = require(musicPath);
  const rows = tracksFixture();
  const other = { id: 'g9::c0', source: 'library-chapter', chapterStartSec: 5, durationSec: 1, title: 'Else' };
  assert.strictEqual(queuedChaptersDiffer(rows.concat([other]), 'f1', FILE_CHAPTERS), false, 'the same list (another file ignored)');
  assert.strictEqual(queuedChaptersDiffer([rows[1]], 'f1', FILE_CHAPTERS), false, 'a subset of rows (a search) is not a change');
  assert.strictEqual(queuedChaptersDiffer(rows, 'f1', MOVED), true, 'a moved start');
  assert.strictEqual(queuedChaptersDiffer(rows, 'f1', [FILE_CHAPTERS[0], { startTime: 60, title: 'Renamed' }, FILE_CHAPTERS[2]]), true, 'a new title');
  assert.strictEqual(queuedChaptersDiffer(rows, 'f1', FILE_CHAPTERS.concat([{ startTime: 150, title: 'Bonus' }])), true, 'a chapter added after the last row (its span changed)');
  assert.strictEqual(queuedChaptersDiffer(rows, 'f1', FILE_CHAPTERS.slice(0, 2)), true, 'a dropped chapter');
  assert.strictEqual(queuedChaptersDiffer(rows, 'f1', [FILE_CHAPTERS[0], { startTime: 60, title: '' }, FILE_CHAPTERS[2]]), true, 'a blank title reads "Track 2", not "Second Song"');
  assert.strictEqual(queuedChaptersDiffer(rows, 'f1', FILE_CHAPTERS.map((c, i) => (i === 1 ? { startTime: 60.0004, title: c.title } : c))), false, 'sub-millisecond noise is not a move');
  delete require.cache[musicPath];
});

test('#269: the re-check follows the PLAYING chapter\'s file even when the list mixes files (no single chapter album on screen)', async () => {
  const g9 = { id: 'g9::c0', title: 'Elsewhere', artist: 'NESTALGIA', album: 'The Mix', albumKey: AK, durationSec: 30, chapterStartSec: 0, source: 'library-chapter', streamSrc: '/video/g9', artUrl: '/thumbnail/g9', progressEndpoint: '/api/progress', liked: false };
  await boot(async (dom, ctx) => {
    assert.strictEqual(dom.window.FileTube.player.currentId, 'f1::c0', 'precondition: a chapter of f1 is playing');
    assert.ok(row(dom, 'g9::c0'), 'precondition: the list mixes two files');
    ctx.server.chapters = MOVED;
    fire(dom, 'visibilitychange'); await settleN(8);
    assert.strictEqual(ctx.videoGets.length, 1, 'asked for the playing file f1');
    click(dom, row(dom, 'f1::c1')); await settleN(6);
    assert.strictEqual(lastLoadOf(ctx.loads, 'f1::c1').data.chapterStartSec, 75, 'and applied its new bounds');
  }, { extraRows: [g9] });
});

test('#268: a CLOSED player with the same id is a genuine load, never an adopt - music does not seek over the player\'s own resume', async () => {
  await boot(async (dom, ctx) => {
    click(dom, row(dom, 'f1::c1'));
    await settleN(6);
    assert.strictEqual(ctx.media.t, 70, 'precondition: chapter 2 loaded and resumed');
    ctx.setPlayerState('closed'); // the player was closed; its currentId still names f1::c1
    const seeksBefore = ctx.media.seeks.length;
    click(dom, row(dom, 'f1::c1'));
    await settleN(6);
    assert.strictEqual(ctx.media.seeks.length, seeksBefore, 'no music-side seek on a genuine load (the element read 0 mid-load)');
    assert.strictEqual(ctx.media.t, 70, 'the player\'s own resume stands');
  });
});

// ---- Gate r1 fixes -------------------------------------------------------------------------------

// P1 (gate r1 CRITICAL, adversary 1 = qa 1): the continue / re-mount arms never seek.
test('r1 P1: a re-mount of /music?play=<the LOADED chapter> (history BACK) with the file rolled on keeps playing where it is - no seek, no forced play', async () => {
  await boot(async (dom, ctx) => {
    assert.strictEqual(dom.window.FileTube.player.currentId, 'f1::c0', 'precondition: the ?play= chapter is loaded');
    ctx.media.t = 130; // the playthrough rolled on into chapter 3 while f1::c0 stayed the loaded id
    const seeks = ctx.media.seeks.length;
    const plays = ctx.media.plays;
    ctx.registered.destroy();
    ctx.registered.init(dom.window.document.getElementById('view-root'));
    await settleN(20);
    assert.ok(ctx.loads.filter((l) => l.id === 'f1::c0').length >= 2, 'the re-mount reached loadTrack again (an adopt - non-vacuous)');
    assert.strictEqual(ctx.media.t, 130, 'the playhead stays where the file played to');
    assert.deepStrictEqual(ctx.media.seeks.slice(seeks), [], 'no seek');
    assert.strictEqual(ctx.media.plays, plays, 'no forced play');
  });
});

test('r1 P1: Prev/Next is a pick - Prev onto the LOADED chapter after the file rolled past it goes back to that chapter', async () => {
  await boot(async (dom, ctx) => {
    click(dom, row(dom, 'f1::c1'));
    await settleN(6);
    assert.strictEqual(dom.window.FileTube.player.currentId, 'f1::c1');
    // the file rolls on into chapter 3: the chapter watcher re-registers nav around chapter 3
    ctx.media.t = 130;
    dom.window.document.getElementById('media-player').dispatchEvent(new dom.window.Event('timeupdate'));
    await settleN(4);
    const nav = ctx.navs[ctx.navs.length - 1];
    assert.ok(nav && typeof nav.onPrev === 'function', 'a Prev is armed around chapter 3');
    nav.onPrev();
    await settleN(6);
    assert.strictEqual(lastLoadOf(ctx.loads, 'f1::c1').data.chapterStartSec, 60, 'Prev picked chapter 2 (the loaded id: an adopt)');
    assert.strictEqual(ctx.media.t, 70, 'and moved the playhead back into it (its saved place)');
  });
});

test('r1 P1 (qa S5): the adopt test is player.js\'s own isAdoptLoad when it is on the page', async () => {
  await boot(async (dom, ctx) => {
    click(dom, row(dom, 'f1::c1'));
    await settleN(6);
    await snapSave(dom, ctx, MOVED);
    const calls = [];
    dom.window.isAdoptLoad = (cur, id, state) => { calls.push([cur, id, state]); return false; }; // the player says: NOT an adopt
    const seeks = ctx.media.seeks.length;
    click(dom, row(dom, 'f1::c1'));
    await settleN(6);
    assert.deepStrictEqual(calls[0], ['f1::c1', 'f1::c1', 'docked'], 'asked the player\'s predicate with (currentId, id, state)');
    assert.deepStrictEqual(ctx.media.seeks.slice(seeks), [], 'its "no adopt" answer wins - music does not seek');
  });
});

// P2 (gate r1 W, adversary 2 = qa 2): a partial queue is patched in place, never re-listed.
const RECENT = { label: 'Recently Played', ctx: { src: 'music', filter: 'recent-listening' } };
const G9_ROW = { id: 'g9::c0', title: 'Elsewhere', artist: 'X', album: 'Y', albumKey: 'X␟Y', durationSec: 30, chapterStartSec: 0, source: 'library-chapter', streamSrc: '/video/g9', artUrl: '/thumbnail/g9', progressEndpoint: '/api/progress', liked: false };
const g9row = () => ({ ...G9_ROW });

test('r1 P2: a return after a remote edit patches a FLAT pocket-menu list [f1::c1, g9::c0] IN PLACE - no library re-list, the list and its Next stay', async () => {
  await boot(async (dom, ctx) => {
    const ec = ctx.engineCfg();
    assert.ok(ec && ec.menu && typeof ec.menu.onPlay === 'function', 'the pocket-menu engine config');
    const G9 = g9row();
    ec.menu.onPlay({ tracks: [tracksFixture()[1], G9], index: 0, play: RECENT });
    await settleN(30);
    assert.strictEqual(dom.window.FileTube.player.currentId, 'f1::c1');
    const crumb = dom.window.document.getElementById('music-crumb');
    assert.strictEqual(crumb.textContent, 'Recently Played');
    const ids = () => Array.prototype.map.call(dom.window.document.querySelectorAll('.music-song-row'), (r) => r.getAttribute('data-id'));
    assert.deepStrictEqual(ids(), ['f1::c1', 'g9::c0']);
    ctx.server.chapters = MOVED; ctx.server.chaptersEdited = true; // same count, chapter 2 now 75 s
    const logFrom = ctx.fetchLog.length;
    fire(dom, 'visibilitychange'); await settleN(30);
    const after = ctx.fetchLog.slice(logFrom);
    assert.deepStrictEqual(after.filter((u) => /\/api\/music\?/.test(u)), [], 'no /api/music re-list');
    assert.ok(after.indexOf('GET /api/videos/f1') >= 0, 'the playing file was re-checked');
    assert.deepStrictEqual(ids(), ['f1::c1', 'g9::c0'], 'the flat list is still the picked list');
    assert.ok(!crumb.hidden && crumb.textContent === 'Recently Played', 'its crumb stays');
    assert.match(row(dom, 'f1::c1').textContent, /0:45/, 'the queued chapter took its new span in place');
    const nav = ctx.navs[ctx.navs.length - 1];
    const before = ctx.loads.length;
    nav.onNext(); await settleN(10);
    assert.deepStrictEqual(ctx.loads.slice(before).map((l) => l.id), ['g9::c0'], 'Next is still the list\'s next row');
  }, { extraRows: [g9row()] });
});

test('r1 P2: a flat list whose chapter was DROPPED by a remote edit loses only that row (redrawn from the list, not re-listed)', async () => {
  await boot(async (dom, ctx) => {
    const ec = ctx.engineCfg();
    const rows = tracksFixture();
    ec.menu.onPlay({ tracks: [rows[0], rows[2], g9row()], index: 0, play: RECENT });
    await settleN(30);
    ctx.server.chapters = FILE_CHAPTERS.slice(0, 2); // chapter 3 no longer exists
    const logFrom = ctx.fetchLog.length;
    fire(dom, 'visibilitychange'); await settleN(30);
    assert.deepStrictEqual(ctx.fetchLog.slice(logFrom).filter((u) => /\/api\/music\?/.test(u)), [], 'no library re-list');
    const ids = Array.prototype.map.call(dom.window.document.querySelectorAll('.music-song-row'), (r) => r.getAttribute('data-id'));
    assert.deepStrictEqual(ids, ['f1::c0', 'g9::c0'], 'only the dropped chapter left the list');
    assert.strictEqual(dom.window.document.getElementById('music-crumb').textContent, 'Recently Played');
  }, { extraRows: [g9row()] });
});

test('r1 P2: the album drill (the file\'s COMPLETE list) still re-lists on a count change; a failed passive re-list shows no "saved" toast', async () => {
  await boot(async (dom, ctx) => {
    ctx.server.chapters = FILE_CHAPTERS.concat([{ startTime: 150, title: 'Bonus' }]); // 3 -> 4 chapters elsewhere
    ctx.server.listFail = true;
    const logFrom = ctx.fetchLog.length;
    fire(dom, 'visibilitychange'); await settleN(30);
    assert.ok(ctx.fetchLog.slice(logFrom).some((u) => /\/api\/music\?/.test(u)), 'the drill re-lists (a new chapter needs its own row)');
    // render() CATCHES a failed list fetch (it never rejects), so the "Chapters saved, but the list
    // could not be refreshed" toast in applySnappedChapterTimes is not reached by a failed re-list at
    // all - measured here on the passive path (qa W2's toast concern, by reading, does not occur).
    assert.deepStrictEqual(ctx.toasts, [], 'no "Chapters saved" toast on a device that saved nothing');
  });
});

// P3 (gate r1 qa W3, the Architect's ruling): other queued chaptered files are verified on their first pick.
const G2_ROWS = [
  { id: 'g9::c0', title: 'G One', artist: 'X', album: 'Y', albumKey: 'X␟Y', durationSec: 40, chapterStartSec: 0, source: 'library-chapter', streamSrc: '/video/g9', artUrl: '/thumbnail/g9', progressEndpoint: '/api/progress', liked: false },
  { id: 'g9::c1', title: 'G Two', artist: 'X', album: 'Y', albumKey: 'X␟Y', durationSec: 50, chapterStartSec: 40, source: 'library-chapter', streamSrc: '/video/g9', artUrl: '/thumbnail/g9', progressEndpoint: '/api/progress', liked: false },
];
const g2 = () => G2_ROWS.map((r) => ({ ...r })); // fresh copies: a save patches rows IN PLACE
const G9_MOVED = [{ startTime: 0, title: 'G One' }, { startTime: 48, title: 'G Two' }];

test('r1 P3: after a return, the first pick of ANOTHER queued file\'s moved chapter asks the server once and lands on its NEW start; a second pick does not ask again', async () => {
  await boot(async (dom, ctx) => {
    const ec = ctx.engineCfg();
    const rows = tracksFixture();
    const G2 = g2();
    ec.menu.onPlay({ tracks: [rows[0], G2[0], G2[1]], index: 0, play: RECENT });
    await settleN(30);
    assert.strictEqual(dom.window.FileTube.player.currentId, 'f1::c0', 'file f1 plays');
    ctx.server.files = { g9: { chapters: G9_MOVED, chaptersEdited: true, duration: 90 } }; // another device moved g9's chapter 2 40 -> 48
    fire(dom, 'visibilitychange'); await settleN(20);
    assert.deepStrictEqual(ctx.videoGets, ['/api/videos/f1'], 'the return re-checked only the playing file');
    click(dom, row(dom, 'g9::c1')); await settleN(20);
    assert.deepStrictEqual(ctx.videoGets, ['/api/videos/f1', '/api/videos/g9'], 'the first pick of g9 asked the server');
    const load = lastLoadOf(ctx.loads, 'g9::c1');
    assert.ok(load, 'and then played it');
    assert.strictEqual(load.data.chapterStartSec, 48, 'at the NEW start');
    click(dom, row(dom, 'g9::c0')); await settleN(20);
    assert.strictEqual(ctx.videoGets.length, 2, 'g9 is verified: no second request until the next return');
  }, { extraRows: g2() });
});

test('r1 P3: without a return, a pick of another file never asks (the control axis)', async () => {
  await boot(async (dom, ctx) => {
    const ec = ctx.engineCfg();
    const G2 = g2();
    ec.menu.onPlay({ tracks: [tracksFixture()[0], G2[0], G2[1]], index: 0, play: RECENT });
    await settleN(30);
    ctx.server.files = { g9: { chapters: G9_MOVED } };
    click(dom, row(dom, 'g9::c1')); await settleN(20);
    assert.deepStrictEqual(ctx.videoGets, [], 'no request');
    assert.strictEqual(lastLoadOf(ctx.loads, 'g9::c1').data.chapterStartSec, 40, 'the queued row plays as listed');
  }, { extraRows: g2() });
});

// P4 (gate r1 adversary 3): the three unbound #269 arms.
test('r1 P4: nothing of the file playing - the re-check falls back to the chapter album on screen', async () => {
  await boot(async (dom, ctx) => {
    dom.window.FileTube.player.currentId = null; // the player was closed; the album drill stays on screen
    ctx.server.chapters = MOVED;
    fire(dom, 'visibilitychange'); await settleN(10);
    assert.deepStrictEqual(ctx.videoGets, ['/api/videos/f1'], 'asked for the album on screen');
    assert.match(row(dom, 'f1::c0').textContent, /1:15/, 'and applied its change');
  });
});

test('r1 P4: a FAILED re-check (offline) clears the in-flight flag - the next return asks again and applies', async () => {
  await boot(async (dom, ctx) => {
    ctx.server.fail = true;
    fire(dom, 'visibilitychange'); await settleN(10);
    assert.strictEqual(ctx.videoGets.length, 1, 'the offline return tried once');
    ctx.server.fail = false; ctx.server.chapters = MOVED;
    fire(dom, 'visibilitychange'); await settleN(10);
    assert.strictEqual(ctx.videoGets.length, 2, 'the next return asked again');
    assert.match(row(dom, 'f1::c0').textContent, /1:15/, 'and applied the change');
  });
});

test('r1 P4: an answer that lands after the view was torn down applies nothing (the post-await liveness check)', async () => {
  await boot(async (dom, ctx) => {
    ctx.server.hold = true; ctx.server.chapters = MOVED;
    fire(dom, 'visibilitychange'); await settleN(4);
    assert.strictEqual(ctx.videoGets.length, 1, 'in flight');
    ctx.registered.destroy();
    const navCalls = ctx.navs.length;
    ctx.release(); await settleN(10);
    assert.strictEqual(ctx.navs.length, navCalls, 'no nav re-registered from a dead view (applySnappedChapterTimes never ran)');
  });
});

test('r1 S4: queuedChaptersDiffer sees a +0.5 s shift of one queued chapter (the start precision)', () => {
  delete global.window; delete global.document;
  delete require.cache[musicPath];
  const { queuedChaptersDiffer } = require(musicPath);
  const rows = tracksFixture();
  const shifted = FILE_CHAPTERS.map((c, i) => (i === 0 ? c : { startTime: c.startTime + 0.5, title: c.title }));
  assert.strictEqual(queuedChaptersDiffer([rows[1]], 'f1', shifted), true, 'a subset queue [c1]: the shift is seen on its start');
  assert.strictEqual(queuedChaptersDiffer([rows[2]], 'f1', shifted), true, 'the last row: the shift is seen on its start');
  delete require.cache[musicPath];
});
