'use strict';

// [UNIT] v1.249 (F-EXTRAS) -> v1.388.0 (the sticker SHEET): the watch-page action set
// (Share/Download/Like on the tile grid; Watched/Queue/Transcript/Reheat/Move/Delete on the More page)
// for the playing music/YouTube-audio track. Boots real music.js (the music-sticker-menu
// harness) and binds, behaviourally: the "Extras >" entry's eligibility (library-
// backed tracks only, never a native music-library track), the open-time
// /api/videos/:baseId fetch (with the ::c chapter-suffix strip), per-action
// availability gating (watchUrl / hasSubtitles / canModifyLibrary), each action
// driving its REAL endpoint or shared common.js flow (anti-INERT), the two-page
// nav (Back / reopen-resets-to-page-1), and the stale-fetch guard (menu closed
// while the open fetch is in flight renders nothing - the TOCTOU class).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const SS = require('../helpers/sticker-sheet.js');

const musicPath = require.resolve('../../public/js/music.js');
require('../../public/js/common.js');

const AK = 'The Band␟Great Album';
const LIB_TRACKS = [
  { id: 's1', title: 'Song One', artist: 'The Band', album: 'Great Album', albumKey: AK, durationSec: 180, source: 'library', streamSrc: '/audio/s1' },
  { id: 's2', title: 'Song Two', artist: 'The Band', album: 'Great Album', albumKey: AK, durationSec: 200, source: 'library', streamSrc: '/audio/s2' },
];
// A NATIVE music-library track: no `source` marker (publicTrackListItem only
// stamps one on the Wave G projection) -> no watch-page item behind it.
const NATIVE_TRACKS = [
  { id: 'n1', title: 'Ripped One', artist: 'The Band', album: 'Great Album', albumKey: AK, durationSec: 180 },
  { id: 'n2', title: 'Ripped Two', artist: 'The Band', album: 'Great Album', albumKey: AK, durationSec: 200 },
];

const VIDEO_DEFAULT = {
  id: 's1', title: 'Song One', filePath: '/media/tube/song-one.mp3',
  watchUrl: 'https://www.youtube.com/watch?v=abc123DEF45', hasSubtitles: true,
  liked: false, watchState: 'unwatched', channelName: 'The Band',
};

// Adversarial gate (divergent-fixture scar): #music-nowplaying and
// #music-popout-btn are PRODUCTION elements (music.html 184/127). Omitting the
// former made updateNowPlaying() early-return, silently disabling the whole
// track-advance repaint pathway - the staleness axis the extras guards exist
// for was structurally unreachable in this suite.
const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <select id="music-sort-select"></select>
  <button id="music-view-toggle" hidden><i></i></button>
  <button id="music-popout-btn" type="button" hidden aria-pressed="false"></button>
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

// boot real music.js: mobile viewport + ?play=<first track> so the skin panel
// (and its sticker) renders. `opts`: tracks, video (the /api/videos payload;
// null => 404), me (the /api/auth/me shape), meReject (fetchCurrentUser
// rejects), deferVideo (hold the /api/videos response until opts.releaseVideo()
// is called), statusEntries (successive /api/subscriptions/status oneShots
// payloads), failLike (like/watched writes answer 500), desktop (wide viewport
// - the in-tab skin stays off, the pop-out becomes available).
async function boot(run, opts) {
  opts = opts || {};
  const tracks = opts.tracks || LIB_TRACKS;
  const playId = tracks[0].id;
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music?play=' + encodeURIComponent(playId) });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController, isYtdlpManagedItem: global.isYtdlpManagedItem };
  const mobile = !opts.desktop;
  dom.window.matchMedia = () => ({ matches: mobile, media: '(max-width: 768px)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } });
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;

  const calls = []; // every fetch as {url, method}
  const toasts = [];
  const shares = []; // shareExternalUrl calls
  const fileShares = []; // v1.287: shareMediaFile calls
  const choiceModals = []; // showChoiceModal calls (title + labels + onPicks)
  const moveModals = []; // showMoveModal calls
  const confirmModals = []; // showConfirmModal calls
  const hardDeletes = []; // showHardDeleteModal calls
  const transcripts = []; // openTranscriptFor calls
  const queued = []; // addToQueue calls
  const requestedMoves = []; // requestMoveItem calls
  const state = { closed: false };
  const videoWaiters = [];
  let statusIdx = 0;

  function fetchMap(url, init) {
    const u = String(url);
    const method = (init && init.method) || 'GET';
    calls.push({ url: u, method });
    if (opts.failLike && (u.indexOf('/api/liked/') === 0 || u.indexOf('/api/watched/') === 0)) {
      return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    }
    const vm = u.match(/^\/api\/videos\/([^/?]+)$/);
    if (vm && method === 'GET') {
      const body = opts.video === null ? null : { ...VIDEO_DEFAULT, ...(opts.video || {}), id: decodeURIComponent(vm[1]) };
      const respond = () => (body
        ? { ok: true, json: async () => body }
        : { ok: false, status: 404, json: async () => ({ error: 'Media file not found' }) });
      // deferVideo: QUEUE the resolvers FIFO so a test can hold several opens in flight at
      // once and release them out of order (the token-guard binding needs exactly that).
      if (opts.deferVideo) return new Promise((resolve) => { videoWaiters.push(() => resolve(respond())); });
      return Promise.resolve(respond());
    }
    if (u === '/api/config') return Promise.resolve({ ok: true, json: async () => ({ folders: ['Music', 'Podcasts'] }) });
    if (u.indexOf('/api/ytdlp/repull-metadata/item/') === 0) {
      // repull404: 'plain' = a module-off install (no route -> Express HTML 404,
      // json() rejects); 'body' = the real route's error-bodied 404 (no source).
      if (opts.repull404 === 'plain') return Promise.resolve({ status: 404, json: async () => { throw new Error('not json'); } });
      if (opts.repull404 === 'body') return Promise.resolve({ status: 404, json: async () => ({ error: 'That video is not eligible for a metadata re-pull.' }) });
      return Promise.resolve({ status: 202, json: async () => ({}) });
    }
    if (u === '/api/subscriptions/status') {
      const entries = opts.statusEntries || [];
      const oneShots = entries[Math.min(statusIdx++, entries.length - 1)] || {};
      return Promise.resolve({ ok: true, json: async () => ({ oneShots }) });
    }
    if (method === 'DELETE' && u.indexOf('/api/videos/') === 0) return Promise.resolve({ status: 200, ok: true, json: async () => ({ success: true, outcome: 'clean' }) });
    if (method !== 'GET') return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    if (u.indexOf('album=') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: tracks }) });
    if (u.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [tracks[0]] }) });
    const idm = u.match(/^\/api\/music\/([^?]+)$/);
    if (idm) { const t = tracks.find((x) => x.id === decodeURIComponent(idm[1])); return Promise.resolve({ ok: true, json: async () => (t || {}) }); }
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  }

  const metaById = (id) => { const t = tracks.find((x) => x.id === id); return t ? { isMusic: true, id: t.id, title: t.title, artist: t.artist, album: t.album, albumKey: t.albumKey } : null; };
  let registered = null;
  const navHolder = { nav: null }; // the {onPrev,onNext} music.js registers - drives a REAL track advance
  const likedTotalCalls = [];
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player: {
      currentId: playId, getState: () => 'full', expand: () => {}, dock: () => {},
      getCurrentMeta: () => metaById(dom.window.FileTube.player.currentId),
      load: (id) => { dom.window.FileTube.player.currentId = id; },
      setTrackNav: (nav) => { navHolder.nav = nav; },
      isLoopEnabled: () => false, setLoop: () => {},
      close: () => { state.closed = true; dom.window.FileTube.player.currentId = null; },
    },
  };
  // The shared common.js flows the Extras page reuses - recorded stubs on the
  // jsdom window (music.js references every one as window.<name>).
  dom.window.fetchCurrentUser = () => (opts.meReject
    ? Promise.reject(new Error('auth probe down'))
    : Promise.resolve(opts.me !== undefined ? opts.me : { user: { role: 'admin' } }));
  dom.window.fetchLikedTotal = (force) => { likedTotalCalls.push(force); return Promise.resolve(0); };
  dom.window.showToast = (msg) => { toasts.push(String(msg)); };
  dom.window.shareExternalUrl = (url, title) => { shares.push({ url, title }); return Promise.resolve('shared'); };
  dom.window.shareMediaFile = (o) => { fileShares.push(o); return Promise.resolve('shared'); }; // v1.287 file-share
  dom.window.withShareStartTime = (url, s) => url + '&t=' + Math.floor(s) + 's';
  dom.window.showChoiceModal = (title, choices) => { choiceModals.push({ title, choices }); return () => {}; };
  dom.window.showMoveModal = (item, folders, onMove) => { moveModals.push({ item, folders, onMove }); };
  dom.window.requestMoveItem = (id, folder) => { requestedMoves.push({ id, folder }); return Promise.resolve({ success: true }); };
  // UI pass S7: the Extras Delete asks ui.confirm (the card menu's copy, main.js
  // cardDeleteConfirmCopy). The real ui.js with a HELD confirm: each call is recorded and the
  // test answers it (onConfirm -> true, onCancel -> false). The legacy modals are still stubbed,
  // only to prove nothing reaches them any more.
  dom.window.showConfirmModal = (title, body, onConfirm) => { confirmModals.push({ legacy: true, title, body, onConfirm }); };
  dom.window.showHardDeleteModal = (item, onConfirm) => { hardDeletes.push({ item, onConfirm }); };
  delete require.cache[require.resolve('../../public/js/ui.js')];
  dom.window.ui = Object.assign({}, require('../../public/js/ui.js'), {
    confirm: (o) => new Promise((resolve) => { confirmModals.push({ title: o.title, body: o.body, opts: o, onConfirm: () => resolve(true), onCancel: () => resolve(false) }); }),
  });
  dom.window.FTIcons = require('../../public/js/icons.js'); // the sheet's icons (ui.icon throws on an unknown name)
  dom.window.cardDeleteConfirmCopy = require('../../public/js/main.js').cardDeleteConfirmCopy;
  dom.window.openTranscriptFor = (o) => { transcripts.push(o); return Promise.resolve(null); };
  dom.window.addToQueue = (id, position, kind) => { queued.push({ id, position, kind }); };
  dom.window.isYtdlpManagedItem = require('../../public/js/common.js').isYtdlpManagedItem;
  global.isYtdlpManagedItem = dom.window.isYtdlpManagedItem; // main.js cardDeleteConfirmCopy reads it as a page global
  dom.window.deleteResultToast = () => 'deleted-toast';
  global.fetch = (u, init) => fetchMap(u, init);
  delete require.cache[require.resolve('../../public/js/music-skins.js')];
  require('../../public/js/music-skins.js');
  // v1.250 (F-UNIFY): the Extras page renders through the shared engine now - load it into
  // this window exactly as music.html does (after music-skins.js, before music.js).
  delete require.cache[require.resolve('../../public/js/skin-surface.js')];
  require('../../public/js/skin-surface.js');
  const root = () => dom.window.document.getElementById('view-root');
  const ctx = { calls, toasts, shares, fileShares, choiceModals, moveModals, confirmModals, hardDeletes, transcripts, queued, requestedMoves, state, likedTotalCalls, nav: () => navHolder.nav, releaseVideo: () => { const w = videoWaiters.shift(); if (w) w(); } };
  try {
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(root());
    for (let i = 0; i < 12; i++) await settle();
    await run(dom, ctx);
  } finally {
    // QA delta CRITICAL: destroy() must run on a RED assertion too - it sat
    // after run() inside the try, so a failing test skipped it and the pop-out
    // window's perpetual 250ms pipClock survived the global restore, throwing
    // forever and WEDGING the whole node:test runner (measured: a 17-minute
    // hang before a manual kill). destroy() tears the pop-out down
    // (activePopoutTeardown -> clearInterval + win.close), so it belongs in
    // the finally, before the globals are restored.
    try { if (registered) registered.destroy(); } catch (_) { /* best-effort teardown */ }
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
}

const panel = SS.panelOf;
const menu = SS.menuOf;
const click = SS.clickEl;
const inSheet = SS.inSheet;
const act = (dom, name) => inSheet(dom, '[data-skin-x="' + name + '"]');
const tile = (dom, flag) => inSheet(dom, '[data-skin-' + flag + ']');
const unavailable = (el) => !!el && el.getAttribute('aria-disabled') === 'true';

// open the sheet (item load settled): page 1 = the tile grid. openMore goes on to the More page.
const openExtras = (dom) => SS.openSheet(dom);
const openMore = (dom) => SS.openMore(dom);

test('the Like / Share / Download tiles and the More page are live for a library-backed track, and DISABLED IN PLACE for a native music-library track', async () => {
  await boot(async (dom) => {
    await openExtras(dom);
    for (const f of ['like', 'share', 'download']) assert.ok(tile(dom, f) && !unavailable(tile(dom, f)), 'library track: the ' + f + ' tile is live');
    assert.ok(tile(dom, 'speedtoggle'), 'the quick controls sit beside them (this is not a blank sheet)');
    assert.ok(tile(dom, 'more') && !unavailable(tile(dom, 'more')), 'More is always live');
  });
  await boot(async (dom) => {
    await openExtras(dom);
    for (const f of ['like', 'share', 'download']) {
      assert.ok(tile(dom, f), 'R1: the ' + f + ' tile is still THERE (fixed positions)');
      assert.ok(unavailable(tile(dom, f)), 'native track (no library source): the ' + f + ' tile is dimmed in place');
    }
    const before = dom.window.document.querySelectorAll('.mms-ss-root [data-skin-x]').length;
    click(dom, tile(dom, 'like'));
    await SS.settle();
    assert.strictEqual(dom.window.document.querySelectorAll('.mms-ss-root [data-skin-x]').length, before, 'a tap on a disabled tile does nothing (the sheet is unchanged)');
  }, { tracks: NATIVE_TRACKS });
});

test('opening the sheet fetches /api/videos/:id and the grid + More page render the FULL action set (admin, all capabilities)', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    assert.ok(ctx.calls.some((c) => c.url === '/api/videos/s1' && c.method === 'GET'), 'fetched the media item at open');
    for (const name of ['share', 'download', 'like']) assert.ok(act(dom, name), 'tile rendered: ' + name);
    const dl = act(dom, 'download');
    assert.strictEqual(dl.tagName, 'A', 'Download is a real anchor (native download navigation)');
    assert.strictEqual(dl.getAttribute('href'), '/video/s1?download=1', 'Download hits the byte route download arm');
    assert.ok(dl.hasAttribute('download'), 'and carries the download attribute');
    assert.strictEqual(inSheet(dom, '[data-skin-extras-back]'), null, 'page 1 has no Back');
    await openMore(dom);
    for (const name of ['watched', 'queue', 'queue-next', 'transcript', 'reheat', 'move', 'delete']) {
      assert.ok(act(dom, name), 'More row rendered: ' + name);
    }
    assert.ok(inSheet(dom, '[data-skin-extras-back]'), 'a Back control is present on the page');
    assert.strictEqual(menu(dom).querySelector('[data-skin-speedtoggle]'), null, 'the page replaced the tile grid');
  });
});

test('a ::c chapter id is STRIPPED to its base file id for the open fetch', async () => {
  await boot(async (dom, ctx) => {
    // simulate the player holding a chapter track of another file (nav-back
    // reseed: not in the live queue -> eligibility is unknown -> the tiles try,
    // the fetch decides). The fetch must hit the BASE id.
    dom.window.FileTube.player.currentId = 's9::c3';
    await openExtras(dom);
    assert.ok(ctx.calls.some((c) => c.url === '/api/videos/s9' && c.method === 'GET'), 'fetched the base id, not the ::c id');
    assert.ok(!ctx.calls.some((c) => c.url.indexOf('%3A%3Ac') !== -1 || c.url.indexOf('::c') !== -1), 'no chapter-suffixed fetch');
  });
});

test('availability gating: no watchUrl -> no Reheat; no subtitles -> no Transcript; no RBAC -> no Move/Delete', async () => {
  await boot(async (dom) => {
    await openMore(dom);
    assert.strictEqual(act(dom, 'reheat'), null, 'no watchUrl: Reheat absent');
    assert.strictEqual(act(dom, 'transcript'), null, 'no subtitles: Transcript absent');
    assert.strictEqual(act(dom, 'move'), null, 'member without canModifyLibrary: Move absent');
    assert.strictEqual(act(dom, 'delete'), null, 'member without canModifyLibrary: Delete absent');
    // the ungated core is still there (this test is not a blank page passing vacuously)
    assert.ok(act(dom, 'watched') && act(dom, 'queue') && act(dom, 'queue-next'), 'core More rows present');
    click(dom, inSheet(dom, '[data-skin-extras-back]'));
    assert.ok(act(dom, 'share') && act(dom, 'download') && act(dom, 'like'), 'v1.287: Share is UNIVERSAL - the tile is live even with no watchUrl (file-share)');
    assert.ok(!unavailable(act(dom, 'share')) && !unavailable(act(dom, 'like')), 'and not dimmed');
  }, { video: { watchUrl: undefined, hasSubtitles: false }, me: { user: { role: 'member' } } });
  // a member WITH the capability gets Move/Delete (the RBAC axis binds in both directions)
  await boot(async (dom) => {
    await openMore(dom);
    assert.ok(act(dom, 'move') && act(dom, 'delete'), 'canModifyLibrary member: Move/Delete present');
  }, { me: { user: { role: 'member', canModifyLibrary: true } } });
});

test('a 404 item (native track that slipped through / deleted): the tiles stay disabled in place and the More page says so, no actions', async () => {
  await boot(async (dom) => {
    dom.window.FileTube.player.currentId = 's9'; // unknown to the queue -> eligible until the fetch settles it
    await openExtras(dom);
    for (const f of ['like', 'share', 'download']) assert.ok(unavailable(tile(dom, f)), 'no item behind it: the ' + f + ' tile is dimmed');
    await openMore(dom);
    const note = menu(dom).querySelector('.mms-ss__note');
    assert.ok(note, 'a note is rendered');
    assert.ok(note.textContent.indexOf('aren’t available') !== -1, 'it says so honestly');
    assert.strictEqual(menu(dom).querySelectorAll('[data-skin-x]').length, 0, 'no action rows');
    assert.ok(inSheet(dom, '[data-skin-extras-back]'), 'Back still offered');
  }, { video: null });
});

test('anti-INERT Like/Watched: each tap fires the REAL media-store endpoint and flips only on success', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    assert.strictEqual(act(dom, 'like').querySelector('.mms-ss__cap').textContent, 'track', 'R2: the caption says what it will like');
    click(dom, act(dom, 'like'));
    await SS.settle(); await SS.settle();
    assert.ok(ctx.calls.some((c) => c.url === '/api/liked/s1' && c.method === 'POST'), 'Like POSTs /api/liked/:id');
    assert.strictEqual(act(dom, 'like').querySelector('.mms-ss__cap').textContent, 'Liked', 'the tile reflects the new state');
    assert.strictEqual(act(dom, 'like').getAttribute('aria-pressed'), 'true', 'selected');
    // QA gate (v1.33.1 class): the count-gated Liked sidebar cache is re-primed
    assert.deepStrictEqual(ctx.likedTotalCalls, [true], 'fetchLikedTotal(force) busts the session cache');
    click(dom, act(dom, 'like'));
    await SS.settle(); await SS.settle();
    assert.ok(ctx.calls.some((c) => c.url === '/api/liked/s1' && c.method === 'DELETE'), 'second tap DELETEs (unlike)');
    assert.strictEqual(act(dom, 'like').querySelector('.mms-ss__cap').textContent, 'track');
    await openMore(dom);
    click(dom, act(dom, 'watched'));
    await SS.settle(); await SS.settle();
    assert.ok(ctx.calls.some((c) => c.url === '/api/watched/s1' && c.method === 'POST'), 'Watched POSTs /api/watched/:id');
    assert.strictEqual(act(dom, 'watched').textContent, 'Watched');
  });
});

test('anti-INERT Queue: Add-to-queue / Play-next call the shared addToQueue with the MEDIA kind (watch-page parity)', async () => {
  await boot(async (dom, ctx) => {
    await openMore(dom);
    click(dom, act(dom, 'queue'));
    assert.deepStrictEqual(ctx.queued, [{ id: 's1', position: 'end', kind: undefined }], 'kind stays the default media kind - a projected id is NOT in ns.tracks, kind track would 404');
    assert.ok(!SS.isOpen(dom), 'the sheet closes after queueing');
    await openMore(dom);
    click(dom, act(dom, 'queue-next'));
    assert.strictEqual(ctx.queued.length, 2);
    assert.deepStrictEqual(ctx.queued[1], { id: 's1', position: 'next', kind: undefined });
  });
});

test('v1.287 Share (source exists, no position) -> a BOTH choice: Share file OR Share link', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    click(dom, act(dom, 'share'));
    await SS.settle();
    // an item WITH a source link offers both file and link (Dean's "both when a source exists").
    assert.strictEqual(ctx.choiceModals.length, 1, 'choice modal offered');
    assert.deepStrictEqual(ctx.choiceModals[0].choices.map((c) => c.label), ['Share file', 'Share link'], 'no position -> file + link only');
    ctx.choiceModals[0].choices[0].onPick(); // Share file
    await SS.settle();
    assert.strictEqual(ctx.fileShares.length, 1, 'Share file -> shareMediaFile');
    assert.strictEqual(ctx.fileShares[0].url, '/video/s1?download=1', 'file-share fetches the download arm');
    ctx.choiceModals[0].choices[1].onPick(); // Share link
    await SS.settle();
    assert.strictEqual(ctx.shares[0].url, VIDEO_DEFAULT.watchUrl, 'Share link -> the original YouTube link');
  });
});

test('v1.287 Share with a live position >= 1s adds a "Share link at <time>" choice', async () => {
  await boot(async (dom, ctx) => {
    dom.window.FileTube.player.getCurrentTime = () => 65;
    await openExtras(dom);
    click(dom, act(dom, 'share'));
    assert.strictEqual(ctx.choiceModals.length, 1, 'choice modal offered');
    assert.strictEqual(ctx.choiceModals[0].choices.length, 3, 'file + link + link-at-time');
    ctx.choiceModals[0].choices[2].onPick(); // the timed link
    await SS.settle();
    assert.strictEqual(ctx.shares[0].url, VIDEO_DEFAULT.watchUrl + '&t=65s', 'the timed pick shares withShareStartTime');
  });
});

test('v1.287 Share with NO source link (podcast/local) -> file-share directly, no choice modal', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    click(dom, act(dom, 'share'));
    await SS.settle();
    assert.strictEqual(ctx.choiceModals.length, 0, 'no source -> no choice');
    assert.strictEqual(ctx.fileShares.length, 1, 'file-share directly');
  }, { video: { watchUrl: undefined } });
});

test('anti-INERT Transcript: hands the item to the shared openTranscriptFor flow', async () => {
  await boot(async (dom, ctx) => {
    await openMore(dom);
    click(dom, act(dom, 'transcript'));
    assert.strictEqual(ctx.transcripts.length, 1);
    assert.strictEqual(ctx.transcripts[0].id, 's1');
    assert.strictEqual(ctx.transcripts[0].title, 'Song One');
  });
});

test('anti-INERT Reheat: POSTs the repull route; the 202 poll reports OUR terminal entry, never a stale other-item one', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  await boot(async (dom, ctx) => {
    await openMore(dom);
    click(dom, act(dom, 'reheat'));
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.ok(ctx.calls.some((c) => c.url === '/api/ytdlp/repull-metadata/item/s1' && c.method === 'POST'), 'fired the repull');
    assert.ok(ctx.toasts.includes('Reheating…'), '202 acknowledged');
    // tick 1: a STALE terminal entry from another item's reheat - must be ignored
    t.mock.timers.tick(1000);
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.ok(!ctx.toasts.some((m) => m === 'Reheat finished.'), 'a stale other-item entry is not reported as ours');
    // tick 2: ours lands
    t.mock.timers.tick(1000);
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.ok(ctx.toasts.includes('Reheat finished.'), 'our terminal entry is reported');
  }, {
    statusEntries: [
      { 'repull-metadata-item': { state: 'done', mediaId: 'other-id', networkRan: true } },
      { 'repull-metadata-item': { state: 'done', mediaId: 's1', networkRan: true } },
    ],
  });
});

test('Reheat honesty: a no-source run says so, a failed outcome is never dressed as success', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  await boot(async (dom, ctx) => {
    await openMore(dom);
    click(dom, act(dom, 'reheat'));
    for (let i = 0; i < 4; i++) await SS.settle();
    t.mock.timers.tick(1000);
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.ok(ctx.toasts.some((m) => m.indexOf('nothing to refresh') !== -1), 'networkRan:false reports the truth');
    assert.ok(!ctx.toasts.includes('Reheat finished.'));
  }, { statusEntries: [{ 'repull-metadata-item': { state: 'done', mediaId: 's1', networkRan: false } }] });
});

test('anti-INERT Move: loads the folder list, opens the shared move modal; a confirmed move re-keys -> player closed + view refreshed', async () => {
  await boot(async (dom, ctx) => {
    await openMore(dom);
    click(dom, act(dom, 'move'));
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.ok(ctx.calls.some((c) => c.url === '/api/config'), 'fetched the folder list');
    assert.strictEqual(ctx.moveModals.length, 1, 'showMoveModal opened');
    assert.deepStrictEqual(ctx.moveModals[0].folders, ['Music', 'Podcasts']);
    assert.strictEqual(ctx.moveModals[0].item.id, 's1');
    // confirm a folder through the modal's callback contract
    let toreDown = false;
    const statusEl = dom.window.document.createElement('div');
    ctx.moveModals[0].onMove('Podcasts', { teardown: () => { toreDown = true; }, statusEl, reenable: () => {} });
    for (let i = 0; i < 6; i++) await SS.settle();
    assert.deepStrictEqual(ctx.requestedMoves, [{ id: 's1', folder: 'Podcasts' }], 'requestMoveItem fired');
    assert.ok(toreDown, 'modal torn down on success');
    assert.ok(ctx.state.closed, 'player closed (the move re-keys the id the player still holds)');
    assert.ok(ctx.toasts.includes('File moved.'));
  });
});

// UI pass S7 (converted from "Delete routes a yt-dlp item through the TRASH confirm and a local
// item through the HARD-delete modal"): ONE danger ui.confirm with the card menu's copy
// (cardDeleteConfirmCopy: DELETE /api/videos/:id moves to Trash for every item; a LOCAL file adds
// that it cannot be re-downloaded), and only its OK fires the real DELETE. Cancel sends nothing.
// The legacy modals are never reached.
test('Delete asks ONE danger ui.confirm (the card menu copy) and only its OK fires the real DELETE; Cancel sends nothing', async () => {
  // yt-dlp-managed (channelName present)
  await boot(async (dom, ctx) => {
    await openMore(dom);
    click(dom, act(dom, 'delete'));
    assert.strictEqual(ctx.confirmModals.length, 1, 'one confirm opened');
    const c = ctx.confirmModals[0];
    assert.ok(!c.legacy, 'through ui.confirm, not the legacy modal');
    assert.strictEqual(ctx.hardDeletes.length, 0, 'never the hard-delete modal');
    assert.strictEqual(c.title, 'Move to Trash?');
    assert.strictEqual(c.opts.confirmLabel, 'Move to Trash', 'the button says what the route does');
    assert.strictEqual(c.opts.danger, true, 'the danger fill');
    assert.ok(c.body.indexOf('Song One') !== -1, 'the confirm names the item');
    assert.ok(c.body.indexOf('cannot be re-downloaded') === -1, 'a yt-dlp item has no local-file line');
    assert.ok(c.opts.signal, 'bound to the view signal (a teardown closes it)');
    assert.ok(!SS.isOpen(dom), 'the sheet closed behind the confirm');
    await openMore(dom); // reopen More under the held confirm and tap Delete again
    click(dom, act(dom, 'delete'));
    assert.strictEqual(ctx.confirmModals.length, 1, 'a second Delete while the confirm is open opens nothing');
    assert.ok(!ctx.calls.some((x) => x.method === 'DELETE'), 'nothing is deleted before the answer');
    c.onConfirm();
    for (let i = 0; i < 8; i++) await SS.settle();
    assert.strictEqual(ctx.calls.filter((x) => x.method === 'DELETE').length, 1, 'exactly one DELETE');
    assert.ok(ctx.calls.some((x) => x.url === '/api/videos/s1' && x.method === 'DELETE'), 'the real DELETE, same route');
    assert.ok(ctx.state.closed, 'player closed before the DELETE');
    assert.ok(ctx.toasts.includes('deleted-toast'), 'outcome reported via the shared deleteResultToast mapper');
    assert.ok(!dom.window.document.body.classList.contains('mms-on'), 'the full-screen skin tore down after the delete');
    assert.ok(ctx.likedTotalCalls.includes(true), 'the Liked sidebar cache is re-primed (a liked item may just have vanished)');
  });
  // local/irreplaceable (no channel identity): the same confirm, with the local-file line
  await boot(async (dom, ctx) => {
    await openMore(dom);
    click(dom, act(dom, 'delete'));
    assert.strictEqual(ctx.hardDeletes.length, 0, 'no hard-delete modal');
    assert.strictEqual(ctx.confirmModals.length, 1);
    assert.ok(ctx.confirmModals[0].body.indexOf('This local file cannot be re-downloaded.') !== -1, 'a local file says it cannot be re-downloaded');
    ctx.confirmModals[0].onCancel();
    for (let i = 0; i < 8; i++) await SS.settle();
    assert.ok(!ctx.calls.some((x) => x.method === 'DELETE'), 'Cancel deletes nothing');
    assert.strictEqual(ctx.state.closed, false, 'and leaves playback alone');
  }, { video: { channelName: undefined, channelId: undefined, channelUrl: undefined, watchUrl: undefined } });
});

// v1.339 R1 (T-C4), the real mobile path end to end: the trash confirm is HELD open, a real
// track advance (the registered onNext -> playAt -> load) happens under it, then the user
// confirms. The confirmed item is still deleted, but the player now plays s2 - it must not be
// closed, and the view (engine onMutated forward -> music afterExtrasMutation) must keep s2's
// skin up. The Delete test above is the control (s1 still playing: closed, skin torn down).
test('R1 T-C4: an auto-advance while the Delete confirm is open - s1 is deleted, s2 keeps playing and keeps its skin', async () => {
  await boot(async (dom, ctx) => {
    await openMore(dom);
    click(dom, act(dom, 'delete'));
    assert.strictEqual(ctx.confirmModals.length, 1, 'precondition: the trash confirm is open (held)');
    ctx.nav().onNext(); // the track ends under the modal: the production advance path
    for (let i = 0; i < 12; i++) await SS.settle();
    assert.strictEqual(dom.window.FileTube.player.currentId, 's2', 'precondition: the player advanced to s2');
    ctx.confirmModals[0].onConfirm();
    for (let i = 0; i < 12; i++) await SS.settle();
    assert.ok(ctx.calls.some((c) => c.url === '/api/videos/s1' && c.method === 'DELETE'), 'the confirmed item (s1) is deleted');
    assert.strictEqual(ctx.state.closed, false, 'the player playing s2 was NOT closed');
    assert.strictEqual(dom.window.FileTube.player.currentId, 's2', 's2 is still the current track');
    assert.ok(dom.window.document.body.classList.contains('mms-on'), 's2\'s full-screen skin stays up (the view kept its playing state)');
  });
});

test('two-page nav: Back returns to the tile grid; closing and reopening the sheet RESETS to page 1', async () => {
  await boot(async (dom) => {
    await openMore(dom);
    assert.ok(act(dom, 'queue'), 'on the More page');
    click(dom, inSheet(dom, '[data-skin-extras-back]'));
    assert.ok(menu(dom).querySelector('[data-skin-speedtoggle]'), 'Back re-renders the tile grid');
    assert.strictEqual(menu(dom).querySelector('[data-skin-x="queue"]'), null, 'the More rows are gone');
    // now: More open -> close the whole sheet -> reopen -> page 1 (never a stale More resume)
    await openMore(dom);
    await SS.closeSheet(dom);
    assert.ok(!SS.isOpen(dom), 'closed');
    await SS.openSheet(dom);
    assert.ok(menu(dom).querySelector('[data-skin-speedtoggle]'), 'reopen lands on page 1');
    assert.strictEqual(menu(dom).querySelector('[data-skin-x="queue"]'), null, 'not on More');
  });
});

test('a REAL track advance (setTrackNav.onNext) repaints the panel and closes an open More page: a late tap on its stale Delete does nothing', async () => {
  await boot(async (dom, ctx) => {
    await openMore(dom);
    const staleDelete = act(dom, 'delete');
    assert.ok(staleDelete, 'More is up with a live Delete for s1');
    assert.ok(typeof ctx.nav().onNext === 'function', 'music.js registered a real onNext');
    ctx.nav().onNext(); // the production advance path: playAt -> loadTrack -> repaint
    for (let i = 0; i < 12; i++) await SS.settle();
    assert.strictEqual(dom.window.FileTube.player.currentId, 's2', 'the player advanced');
    assert.ok(!SS.isOpen(dom), 'the open sheet CLOSED with the repaint (it described s1)');
    click(dom, staleDelete); // the sheet is sliding out: the activation guard refuses a late tap
    assert.strictEqual(ctx.confirmModals.length, 0, 'a late tap on the stale Delete opened no confirm - it cannot delete the wrong track');
    assert.strictEqual(panel(dom).querySelectorAll('[data-skin-x]').length, 0, 'no extras action lives in the panel');
  });
});

test('a late item load after Back lands on page 1 as live tiles and never draws More over it (page guard)', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom); // the /api/videos fetch is held
    assert.ok(unavailable(tile(dom, 'like')), 'while the item is out the Like tile is dimmed in place');
    click(dom, tile(dom, 'more'));
    assert.ok(menu(dom).querySelector('.mms-ss__note'), 'More says Loading while the item is out');
    click(dom, inSheet(dom, '[data-skin-extras-back]'));
    assert.ok(menu(dom).querySelector('[data-skin-speedtoggle]'), 'Back landed on page 1 with the fetch still in flight');
    ctx.releaseVideo();
    for (let i = 0; i < 6; i++) await SS.settle();
    assert.ok(menu(dom).querySelector('[data-skin-speedtoggle]'), 'still page 1 after the late response');
    assert.ok(!unavailable(tile(dom, 'like')), 'the late item enabled the Like tile');
    assert.strictEqual(menu(dom).querySelector('[data-skin-x="queue"]'), null, 'and drew no More rows over page 1');
  }, { deferVideo: true });
});

test('a SILENT track change mid-fetch (no repaint event) is caught by the same-id guard', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom); // the fetch is held
    // direct assignment fires no media event - nothing repaints the panel, so
    // only the post-await same-id re-check stands between the s1 payload and a
    // sheet claiming to act on what is now s2.
    dom.window.FileTube.player.currentId = 's2';
    ctx.releaseVideo();
    for (let i = 0; i < 6; i++) await SS.settle();
    assert.ok(unavailable(tile(dom, 'like')), 'the stale s1 payload did not enable the tiles');
    await openMore(dom);
    assert.strictEqual(menu(dom).querySelectorAll('[data-skin-x]').length, 0, 'and More drew no rows for it');
  }, { deferVideo: true });
});

test('a FAILED like/watched write flips NOTHING and says so (the flips-only-on-2xx contract)', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    click(dom, act(dom, 'like'));
    await SS.settle(); await SS.settle();
    assert.strictEqual(act(dom, 'like').querySelector('.mms-ss__cap').textContent, 'track', 'a 500 leaves the shown state alone');
    assert.strictEqual(act(dom, 'like').getAttribute('aria-pressed'), 'false');
    assert.ok(ctx.toasts.includes('Could not update Like.'), 'the failure is reported');
    assert.deepStrictEqual(ctx.likedTotalCalls, [], 'no cache bust on failure');
    click(dom, act(dom, 'like'));
    await SS.settle(); await SS.settle();
    const likeCalls = ctx.calls.filter((c) => c.url === '/api/liked/s1');
    assert.deepStrictEqual(likeCalls.map((c) => c.method), ['POST', 'POST'], 'internal state did not flip either - the retry is still an ADD');
    await openMore(dom);
    click(dom, act(dom, 'watched'));
    await SS.settle(); await SS.settle();
    assert.strictEqual(act(dom, 'watched').textContent, 'Mark watched', 'watched failure leaves state alone too');
  }, { failLike: true });
});

test('a second Reheat tap replaces the first poll - no orphaned interval keeps hitting the status route', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  await boot(async (dom, ctx) => {
    const statusCalls = () => ctx.calls.filter((c) => c.url === '/api/subscriptions/status').length;
    await openMore(dom);
    click(dom, act(dom, 'reheat')); // 202 -> poll 1 armed (the sheet closes)
    for (let i = 0; i < 4; i++) await SS.settle();
    await openMore(dom);
    click(dom, act(dom, 'reheat')); // 202 -> poll 1 must be STOPPED, poll 2 armed
    for (let i = 0; i < 4; i++) await SS.settle();
    t.mock.timers.tick(1000); // running
    for (let i = 0; i < 4; i++) await SS.settle();
    t.mock.timers.tick(1000); // terminal for s1 -> toast + stop
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.ok(ctx.toasts.includes('Reheat finished.'), 'the poll reached the terminal entry');
    const quiescent = statusCalls();
    assert.strictEqual(quiescent, 2, 'exactly ONE poll ran (one status fetch per tick)');
    t.mock.timers.tick(3000);
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.strictEqual(statusCalls(), quiescent, 'nothing polls after the terminal entry - no leaked interval');
  }, {
    statusEntries: [
      { 'repull-metadata-item': { state: 'running', mediaId: 's1' } },
      { 'repull-metadata-item': { state: 'done', mediaId: 's1', networkRan: true } },
    ],
  });
});

test('the desktop POP-OUT sticker sheet never offers the item actions (its modals would open in the main window behind it)', async () => {
  const pipDom = new JSDOM('<body></body>', { url: 'http://localhost/pip' });
  try {
    await boot(async (dom) => {
      dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pipDom.window) };
      const btn = dom.window.document.getElementById('music-popout-btn');
      click(dom, btn);
      for (let i = 0; i < 8; i++) await SS.settle();
      const pipPanel = pipDom.window.document.getElementById('music-nowplaying-panel');
      assert.ok(pipPanel, 'the pop-out surface mounted');
      const pipSticker = pipPanel.querySelector('[data-skin-sticker]');
      assert.ok(pipSticker, 'the pop-out has the sticker');
      pipSticker.dispatchEvent(new pipDom.window.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 6; i++) await SS.settle();
      const pipSheet = pipDom.window.document.querySelector('.mms-ss-root');
      assert.ok(pipSheet, 'the sheet opened IN the pop-out document (not behind it in the main window)');
      assert.strictEqual(dom.window.document.querySelector('.mms-ss-root'), null, 'and not in the main document');
      assert.ok(pipSheet.querySelector('[data-skin-speedtoggle]'), 'quick controls render there (this test is not passing on a blank sheet)');
      for (const f of ['like', 'share', 'download']) assert.strictEqual(pipSheet.querySelector('[data-skin-' + f + ']').getAttribute('aria-disabled'), 'true', 'the ' + f + ' tile is dimmed in the pop-out (main-document surface only)');
      assert.strictEqual(pipSheet.querySelector('[data-skin-home]'), null, 'no Home icon in the pop-out');
      pipSheet.querySelector('[data-skin-more]').dispatchEvent(new pipDom.window.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 4; i++) await SS.settle();
      assert.strictEqual(pipSheet.querySelectorAll('[data-skin-x]').length, 0, 'More carries no item-action rows in the pop-out');
    }, { desktop: true });
  } finally {
    // QA delta CRITICAL (belt to boot()'s braces): even if teardown regresses,
    // no perpetual pip timer may outlive a red run of THIS test.
    try { pipDom.window.close(); } catch (_) { /* already closed by teardownPopout */ }
  }
});

test('Reheat 404 honesty: an error-bodied 404 (real route) says "no source"; a bodyless 404 (module off) never lies', async () => {
  // Adversarial delta residual (N2): both arms of the module-off branch bound.
  await boot(async (dom, ctx) => {
    await openMore(dom);
    click(dom, act(dom, 'reheat'));
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.ok(ctx.toasts.includes('This track has no source to reheat from.'), 'the real route 404 keeps the no-source copy');
  }, { repull404: 'body' });
  await boot(async (dom, ctx) => {
    await openMore(dom);
    click(dom, act(dom, 'reheat'));
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.ok(ctx.toasts.includes('Reheat isn’t available on this server.'), 'a bodyless Express 404 = module off, said honestly');
    assert.ok(!ctx.toasts.some((m) => m.indexOf('no source') !== -1), 'and never the no-source lie');
  }, { repull404: 'plain' });
});

test('RBAC probe failure fails CLOSED: a rejected fetchCurrentUser hides Move/Delete', async () => {
  await boot(async (dom) => {
    await openMore(dom);
    assert.strictEqual(act(dom, 'move'), null, 'no Move on a failed capability probe');
    assert.strictEqual(act(dom, 'delete'), null, 'no Delete on a failed capability probe');
    assert.ok(act(dom, 'queue') && act(dom, 'watched'), 'the ungated core still rendered');
    click(dom, inSheet(dom, '[data-skin-extras-back]'));
    assert.ok(act(dom, 'download') && act(dom, 'like'), 'and the tiles');
  }, { meReject: true });
});

test('the TOCTOU TOKEN alone rejects a superseded load: close + reopen while the FIRST fetch is in flight (adversarial S1)', async () => {
  // Constructed so every OTHER post-await guard passes for the stale response: after a close and a
  // fresh open the sheet is connected, open, and the SAME base id is playing - only the bumped token
  // distinguishes fetch #1 from fetch #2. Binds the token check distinctly (its removal mutant
  // survived every v1.249 test - a carried vacuity).
  await boot(async (dom, ctx) => {
    await openExtras(dom);                       // fetch #1 in flight
    await SS.closeSheet(dom);                    // token bump
    await SS.openSheet(dom);                     // fetch #2 in flight, same id playing
    ctx.releaseVideo();                          // resolve fetch #1 (STALE)
    for (let i = 0; i < 6; i++) await SS.settle();
    assert.ok(unavailable(tile(dom, 'like')), 'the superseded response enabled nothing (only the token could reject it)');
    ctx.releaseVideo();                          // resolve fetch #2 (CURRENT)
    for (let i = 0; i < 6; i++) await SS.settle();
    assert.ok(!unavailable(tile(dom, 'like')), 'the current load enabled the tiles');
  }, { deferVideo: true });
});

test('stale-fetch guard (TOCTOU): closing the sheet while the open fetch is in flight draws nothing', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom); // fetch deferred - the tiles are dimmed
    assert.ok(unavailable(tile(dom, 'like')), 'dimmed while deferred');
    await SS.closeSheet(dom); // close with the fetch still pending
    assert.ok(!SS.isOpen(dom));
    ctx.releaseVideo();
    for (let i = 0; i < 6; i++) await SS.settle();
    assert.ok(!SS.isOpen(dom), 'the late response did not reopen or redraw anything');
    // and the guard is not just "never renders": a fresh open still works
    await SS.openSheet(dom);
    ctx.releaseVideo();
    for (let i = 0; i < 6; i++) await SS.settle();
    assert.ok(!unavailable(tile(dom, 'like')), 'a fresh open enables the tiles (the guard is scoped, not a dead switch)');
  }, { deferVideo: true });
});

test('the Like heart and the Watched glyph survive an in-place toggle (the tile and row are redrawn whole, never textContent-flattened)', async () => {
  // v1.255 slim-gate CRITICAL (adversarial-measured at 9479a80f): extrasToggleFlag's bare el.textContent write destroyed the
  // row's glyph on the menu's most-tapped rows. In the sheet the flag's hook redraws the tile / row from the item, so the
  // icon, label and caption all survive; the label text stays exactly what the flag wrote.
  await boot(async (dom) => {
    await openExtras(dom);
    click(dom, act(dom, 'like'));
    for (let i = 0; i < 4; i++) await SS.settle();
    const like = act(dom, 'like');
    assert.ok(like.querySelector('.ui-btn__icon svg use'), 'the heart survives the Like toggle');
    assert.strictEqual(like.querySelector('.ui-btn__label').textContent, 'Like', 'the label stays');
    assert.strictEqual(like.querySelector('.mms-ss__cap').textContent, 'Liked', 'the caption reads Liked');
    assert.strictEqual(like.querySelector('use').getAttribute('href'), '#i-favorite-fill', 'and the heart is the FILLED one');
    await openMore(dom);
    click(dom, act(dom, 'watched'));
    for (let i = 0; i < 4; i++) await SS.settle();
    assert.ok(act(dom, 'watched').querySelector('.ui-row__media svg'), 'the row glyph survives the Watched toggle');
    assert.strictEqual(act(dom, 'watched').textContent, 'Watched', 'the toggled text still reads exactly Watched');
  });
});
