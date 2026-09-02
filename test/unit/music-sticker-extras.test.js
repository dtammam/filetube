'use strict';

// [UNIT] v1.249 (F-EXTRAS): the sticker menu's SECOND page - the watch-page action
// set (Share/Download/Like/Watched/Queue/Transcript/Reheat/Move/Delete) for the
// playing music/YouTube-audio track. Boots real music.js (the music-sticker-menu
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
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  const mobile = !opts.desktop;
  dom.window.matchMedia = () => ({ matches: mobile, media: '(max-width: 768px)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } });
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;

  const calls = []; // every fetch as {url, method}
  const toasts = [];
  const shares = []; // shareExternalUrl calls
  const choiceModals = []; // showChoiceModal calls (title + labels + onPicks)
  const moveModals = []; // showMoveModal calls
  const confirmModals = []; // showConfirmModal calls
  const hardDeletes = []; // showHardDeleteModal calls
  const transcripts = []; // openTranscriptFor calls
  const queued = []; // addToQueue calls
  const requestedMoves = []; // requestMoveItem calls
  const state = { closed: false };
  let releaseVideo = null;
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
      if (opts.deferVideo) return new Promise((resolve) => { releaseVideo = () => resolve(respond()); });
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
  dom.window.withShareStartTime = (url, s) => url + '&t=' + Math.floor(s) + 's';
  dom.window.showChoiceModal = (title, choices) => { choiceModals.push({ title, choices }); return () => {}; };
  dom.window.showMoveModal = (item, folders, onMove) => { moveModals.push({ item, folders, onMove }); };
  dom.window.requestMoveItem = (id, folder) => { requestedMoves.push({ id, folder }); return Promise.resolve({ success: true }); };
  dom.window.showConfirmModal = (title, body, onConfirm) => { confirmModals.push({ title, body, onConfirm }); };
  dom.window.showHardDeleteModal = (item, onConfirm) => { hardDeletes.push({ item, onConfirm }); };
  dom.window.openTranscriptFor = (o) => { transcripts.push(o); return Promise.resolve(null); };
  dom.window.addToQueue = (id, position, kind) => { queued.push({ id, position, kind }); };
  dom.window.isYtdlpManagedItem = require('../../public/js/common.js').isYtdlpManagedItem;
  dom.window.deleteResultToast = () => 'deleted-toast';
  global.fetch = (u, init) => fetchMap(u, init);
  delete require.cache[require.resolve('../../public/js/music-skins.js')];
  require('../../public/js/music-skins.js');
  const root = () => dom.window.document.getElementById('view-root');
  const ctx = { calls, toasts, shares, choiceModals, moveModals, confirmModals, hardDeletes, transcripts, queued, requestedMoves, state, likedTotalCalls, nav: () => navHolder.nav, releaseVideo: () => releaseVideo && releaseVideo() };
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

const panel = (dom) => dom.window.document.getElementById('music-nowplaying-panel');
const sticker = (dom) => panel(dom).querySelector('.mms-sticker[data-skin-sticker]');
const menu = (dom) => panel(dom).querySelector('[data-skin-sticker-menu]');
const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const act = (dom, name) => menu(dom).querySelector('[data-skin-x="' + name + '"]');

// open the menu (if not already open), tap "Extras >", settle the open fetch.
async function openExtras(dom) {
  if (menu(dom).hidden) click(dom, sticker(dom));
  const entry = menu(dom).querySelector('[data-skin-extras]');
  assert.ok(entry, 'the Extras entry is on page 1');
  click(dom, entry);
  for (let i = 0; i < 6; i++) await settle();
}

test('the Extras entry shows for a library-backed track and NOT for a native music-library track', async () => {
  await boot(async (dom) => {
    click(dom, sticker(dom));
    assert.ok(menu(dom).querySelector('[data-skin-extras]'), 'library track: Extras entry present');
    // page 1 keeps its quick controls alongside it
    assert.ok(menu(dom).querySelector('[data-skin-speed]'), 'speed rows still on page 1');
  });
  await boot(async (dom) => {
    click(dom, sticker(dom));
    assert.strictEqual(menu(dom).querySelector('[data-skin-extras]'), null, 'native track (no library source): no Extras entry');
  }, { tracks: NATIVE_TRACKS });
});

test('opening Extras fetches /api/videos/:id and renders the FULL action set (admin, all capabilities)', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    assert.ok(ctx.calls.some((c) => c.url === '/api/videos/s1' && c.method === 'GET'), 'fetched the media item on open');
    for (const name of ['share', 'download', 'like', 'watched', 'queue', 'queue-next', 'transcript', 'reheat', 'move', 'delete']) {
      assert.ok(act(dom, name), 'action rendered: ' + name);
    }
    const dl = act(dom, 'download');
    assert.strictEqual(dl.tagName, 'A', 'Download is a real anchor (native download navigation)');
    assert.strictEqual(dl.getAttribute('href'), '/video/s1?download=1', 'Download hits the byte route download arm');
    assert.ok(menu(dom).querySelector('[data-skin-extras-back]'), 'a Back control is present');
    assert.strictEqual(menu(dom).querySelector('[data-skin-speed]'), null, 'page 2 replaced the quick controls');
  });
});

test('a ::c chapter id is STRIPPED to its base file id for the open fetch', async () => {
  await boot(async (dom, ctx) => {
    // simulate the player holding a chapter track of another file (nav-back
    // reseed: not in the live queue -> eligibility is unknown -> entry shows,
    // the fetch decides). The fetch must hit the BASE id.
    dom.window.FileTube.player.currentId = 's9::c3';
    await openExtras(dom);
    assert.ok(ctx.calls.some((c) => c.url === '/api/videos/s9' && c.method === 'GET'), 'fetched the base id, not the ::c id');
    assert.ok(!ctx.calls.some((c) => c.url.indexOf('%3A%3Ac') !== -1 || c.url.indexOf('::c') !== -1), 'no chapter-suffixed fetch');
  });
});

test('availability gating: no watchUrl -> no Share/Reheat; no subtitles -> no Transcript; no RBAC -> no Move/Delete', async () => {
  await boot(async (dom) => {
    await openExtras(dom);
    assert.strictEqual(act(dom, 'share'), null, 'no watchUrl: Share absent');
    assert.strictEqual(act(dom, 'reheat'), null, 'no watchUrl: Reheat absent');
    assert.strictEqual(act(dom, 'transcript'), null, 'no subtitles: Transcript absent');
    assert.strictEqual(act(dom, 'move'), null, 'member without canModifyLibrary: Move absent');
    assert.strictEqual(act(dom, 'delete'), null, 'member without canModifyLibrary: Delete absent');
    // the ungated core is still there (this test is not a blank page passing vacuously)
    assert.ok(act(dom, 'download') && act(dom, 'like') && act(dom, 'watched') && act(dom, 'queue'), 'core actions present');
  }, { video: { watchUrl: undefined, hasSubtitles: false }, me: { user: { role: 'member' } } });
  // a member WITH the capability gets Move/Delete (the RBAC axis binds in both directions)
  await boot(async (dom) => {
    await openExtras(dom);
    assert.ok(act(dom, 'move') && act(dom, 'delete'), 'canModifyLibrary member: Move/Delete present');
  }, { me: { user: { role: 'member', canModifyLibrary: true } } });
});

test('a 404 item (native track that slipped through / deleted) renders the honest note, no actions', async () => {
  await boot(async (dom) => {
    dom.window.FileTube.player.currentId = 's9'; // unknown to the queue -> entry shows
    await openExtras(dom);
    assert.ok(menu(dom).querySelector('.mms-sm-note'), 'a note is rendered');
    assert.strictEqual(menu(dom).querySelectorAll('[data-skin-x]').length, 0, 'no action buttons');
    assert.ok(menu(dom).querySelector('[data-skin-extras-back]'), 'Back still offered');
  }, { video: null });
});

test('anti-INERT Like/Watched: each tap fires the REAL media-store endpoint and flips only on success', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    click(dom, act(dom, 'like'));
    await settle(); await settle();
    assert.ok(ctx.calls.some((c) => c.url === '/api/liked/s1' && c.method === 'POST'), 'Like POSTs /api/liked/:id');
    assert.strictEqual(act(dom, 'like').textContent, 'Liked', 'button reflects the new state');
    assert.ok(act(dom, 'like').classList.contains('is-on'));
    // QA gate (v1.33.1 class): the count-gated Liked sidebar cache is re-primed
    assert.deepStrictEqual(ctx.likedTotalCalls, [true], 'fetchLikedTotal(force) busts the session cache');
    click(dom, act(dom, 'like'));
    await settle(); await settle();
    assert.ok(ctx.calls.some((c) => c.url === '/api/liked/s1' && c.method === 'DELETE'), 'second tap DELETEs (unlike)');
    assert.strictEqual(act(dom, 'like').textContent, 'Like');
    click(dom, act(dom, 'watched'));
    await settle(); await settle();
    assert.ok(ctx.calls.some((c) => c.url === '/api/watched/s1' && c.method === 'POST'), 'Watched POSTs /api/watched/:id');
    assert.strictEqual(act(dom, 'watched').textContent, 'Watched');
  });
});

test('anti-INERT Queue: Add-to-queue / Play-next call the shared addToQueue with the MEDIA kind (watch-page parity)', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    click(dom, act(dom, 'queue'));
    assert.deepStrictEqual(ctx.queued, [{ id: 's1', position: 'end', kind: undefined }], 'kind stays the default media kind - a projected id is NOT in ns.tracks, kind track would 404');
    assert.strictEqual(menu(dom).hidden, true, 'menu closes after queueing');
    await openExtras(dom);
    click(dom, act(dom, 'queue-next'));
    assert.strictEqual(ctx.queued.length, 2);
    assert.deepStrictEqual(ctx.queued[1], { id: 's1', position: 'next', kind: undefined });
  });
});

test('anti-INERT Share: no meaningful position -> shares the watchUrl directly via shareExternalUrl', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    click(dom, act(dom, 'share'));
    await settle();
    assert.strictEqual(ctx.shares.length, 1, 'shareExternalUrl called');
    assert.strictEqual(ctx.shares[0].url, VIDEO_DEFAULT.watchUrl, 'shares the ORIGINAL YouTube link');
    assert.strictEqual(ctx.choiceModals.length, 0, 'no position -> no choice modal');
  });
});

test('Share with a live position >= 1s offers the share-at-current-time choice (watch-page fidelity)', async () => {
  await boot(async (dom, ctx) => {
    dom.window.FileTube.player.getCurrentTime = () => 65;
    await openExtras(dom);
    click(dom, act(dom, 'share'));
    assert.strictEqual(ctx.choiceModals.length, 1, 'choice modal offered');
    assert.strictEqual(ctx.choiceModals[0].choices.length, 2);
    ctx.choiceModals[0].choices[1].onPick();
    await settle();
    assert.strictEqual(ctx.shares.length, 1);
    assert.strictEqual(ctx.shares[0].url, VIDEO_DEFAULT.watchUrl + '&t=65s', 'the timed pick shares withShareStartTime');
  });
});

test('anti-INERT Transcript: hands the item to the shared openTranscriptFor flow', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    click(dom, act(dom, 'transcript'));
    assert.strictEqual(ctx.transcripts.length, 1);
    assert.strictEqual(ctx.transcripts[0].id, 's1');
    assert.strictEqual(ctx.transcripts[0].title, 'Song One');
  });
});

test('anti-INERT Reheat: POSTs the repull route; the 202 poll reports OUR terminal entry, never a stale other-item one', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    click(dom, act(dom, 'reheat'));
    for (let i = 0; i < 4; i++) await settle();
    assert.ok(ctx.calls.some((c) => c.url === '/api/ytdlp/repull-metadata/item/s1' && c.method === 'POST'), 'fired the repull');
    assert.ok(ctx.toasts.includes('Reheating…'), '202 acknowledged');
    // tick 1: a STALE terminal entry from another item's reheat - must be ignored
    t.mock.timers.tick(1000);
    for (let i = 0; i < 4; i++) await settle();
    assert.ok(!ctx.toasts.some((m) => m === 'Reheat finished.'), 'a stale other-item entry is not reported as ours');
    // tick 2: ours lands
    t.mock.timers.tick(1000);
    for (let i = 0; i < 4; i++) await settle();
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
    await openExtras(dom);
    click(dom, act(dom, 'reheat'));
    for (let i = 0; i < 4; i++) await settle();
    t.mock.timers.tick(1000);
    for (let i = 0; i < 4; i++) await settle();
    assert.ok(ctx.toasts.some((m) => m.indexOf('nothing to refresh') !== -1), 'networkRan:false reports the truth');
    assert.ok(!ctx.toasts.includes('Reheat finished.'));
  }, { statusEntries: [{ 'repull-metadata-item': { state: 'done', mediaId: 's1', networkRan: false } }] });
});

test('anti-INERT Move: loads the folder list, opens the shared move modal; a confirmed move re-keys -> player closed + view refreshed', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    click(dom, act(dom, 'move'));
    for (let i = 0; i < 4; i++) await settle();
    assert.ok(ctx.calls.some((c) => c.url === '/api/config'), 'fetched the folder list');
    assert.strictEqual(ctx.moveModals.length, 1, 'showMoveModal opened');
    assert.deepStrictEqual(ctx.moveModals[0].folders, ['Music', 'Podcasts']);
    assert.strictEqual(ctx.moveModals[0].item.id, 's1');
    // confirm a folder through the modal's callback contract
    let toreDown = false;
    const statusEl = dom.window.document.createElement('div');
    ctx.moveModals[0].onMove('Podcasts', { teardown: () => { toreDown = true; }, statusEl, reenable: () => {} });
    for (let i = 0; i < 6; i++) await settle();
    assert.deepStrictEqual(ctx.requestedMoves, [{ id: 's1', folder: 'Podcasts' }], 'requestMoveItem fired');
    assert.ok(toreDown, 'modal torn down on success');
    assert.ok(ctx.state.closed, 'player closed (the move re-keys the id the player still holds)');
    assert.ok(ctx.toasts.includes('File moved.'));
  });
});

test('Delete routes a yt-dlp item through the TRASH confirm and a local item through the HARD-delete modal; confirm fires the real DELETE', async () => {
  // yt-dlp-managed (channelName present) -> trash confirm
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    click(dom, act(dom, 'delete'));
    assert.strictEqual(ctx.confirmModals.length, 1, 'trash confirm opened');
    assert.strictEqual(ctx.hardDeletes.length, 0);
    assert.ok(ctx.confirmModals[0].body.indexOf('Song One') !== -1, 'the confirm names the item');
    ctx.confirmModals[0].onConfirm();
    for (let i = 0; i < 6; i++) await settle();
    assert.ok(ctx.calls.some((c) => c.url === '/api/videos/s1' && c.method === 'DELETE'), 'the real DELETE fired');
    assert.ok(ctx.state.closed, 'player closed before the DELETE');
    assert.ok(ctx.toasts.includes('deleted-toast'), 'outcome reported via the shared deleteResultToast mapper');
    assert.ok(!dom.window.document.body.classList.contains('mms-on'), 'the full-screen skin tore down after the delete');
    assert.ok(ctx.likedTotalCalls.includes(true), 'the Liked sidebar cache is re-primed (a liked item may just have vanished)');
  });
  // local/irreplaceable (no channel identity) -> escalated hard-delete modal
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    click(dom, act(dom, 'delete'));
    assert.strictEqual(ctx.confirmModals.length, 0);
    assert.strictEqual(ctx.hardDeletes.length, 1, 'hard-delete modal opened for a local file');
    assert.strictEqual(ctx.hardDeletes[0].item.id, 's1');
  }, { video: { channelName: undefined, channelId: undefined, channelUrl: undefined, watchUrl: undefined } });
});

test('two-page nav: Back returns to the quick controls; closing and reopening the menu RESETS to page 1', async () => {
  await boot(async (dom) => {
    await openExtras(dom);
    assert.ok(act(dom, 'like'), 'on page 2');
    click(dom, menu(dom).querySelector('[data-skin-extras-back]'));
    assert.ok(menu(dom).querySelector('[data-skin-speed]'), 'Back re-renders the quick controls');
    assert.strictEqual(menu(dom).querySelector('[data-skin-x]'), null, 'the actions are gone');
    // now: page 2 open -> close the whole menu -> reopen -> page 1 (never a stale Extras resume)
    await openExtras(dom);
    click(dom, sticker(dom)); // close
    assert.strictEqual(menu(dom).hidden, true);
    click(dom, sticker(dom)); // reopen
    assert.ok(menu(dom).querySelector('[data-skin-speed]'), 'reopen lands on page 1');
  });
});

test('a REAL track advance (setTrackNav.onNext) repaints the panel and destroys an open Extras page', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    const staleDelete = act(dom, 'delete');
    assert.ok(staleDelete, 'page 2 is up with a live Delete for s1');
    assert.ok(typeof ctx.nav().onNext === 'function', 'music.js registered a real onNext');
    ctx.nav().onNext(); // the production advance path: playAt -> loadTrack -> repaint
    for (let i = 0; i < 12; i++) await settle();
    assert.strictEqual(dom.window.FileTube.player.currentId, 's2', 'the player advanced');
    assert.ok(!staleDelete.isConnected, 'the old Delete button is DETACHED - a late tap cannot delete the wrong track');
    assert.strictEqual(panel(dom).querySelectorAll('[data-skin-x]').length, 0, 'no extras action survives the repaint');
    const m = menu(dom);
    assert.ok(m && m.hidden, 'the fresh panel carries a closed page-1 menu');
  });
});

test('a late open-fetch response after Back never repaints page 2 over page 1 (token/page guard)', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom); // deferred - Loading note up
    click(dom, menu(dom).querySelector('[data-skin-extras-back]'));
    assert.ok(menu(dom).querySelector('[data-skin-speed]'), 'Back landed on page 1 with the fetch still in flight');
    ctx.releaseVideo();
    for (let i = 0; i < 6; i++) await settle();
    assert.ok(menu(dom).querySelector('[data-skin-speed]'), 'still page 1 after the late response');
    assert.strictEqual(menu(dom).querySelectorAll('[data-skin-x]').length, 0, 'the late response rendered nothing');
  }, { deferVideo: true });
});

test('a SILENT track change mid-fetch (no repaint event) is caught by the same-id guard', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom); // deferred
    // direct assignment fires no media event - nothing repaints the panel, so
    // only the post-await same-id re-check stands between the s1 payload and a
    // menu claiming to act on what is now s2.
    dom.window.FileTube.player.currentId = 's2';
    ctx.releaseVideo();
    for (let i = 0; i < 6; i++) await settle();
    assert.strictEqual(menu(dom).querySelectorAll('[data-skin-x]').length, 0, 'the stale s1 payload did not render');
    assert.ok(menu(dom).querySelector('.mms-sm-note'), 'the page stays on its note');
  }, { deferVideo: true });
});

test('a FAILED like/watched write flips NOTHING and says so (the flips-only-on-2xx contract)', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    click(dom, act(dom, 'like'));
    await settle(); await settle();
    assert.strictEqual(act(dom, 'like').textContent, 'Like', 'a 500 leaves the shown state alone');
    assert.ok(!act(dom, 'like').classList.contains('is-on'));
    assert.ok(ctx.toasts.includes('Could not update Like.'), 'the failure is reported');
    assert.deepStrictEqual(ctx.likedTotalCalls, [], 'no cache bust on failure');
    click(dom, act(dom, 'like'));
    await settle(); await settle();
    const likeCalls = ctx.calls.filter((c) => c.url === '/api/liked/s1');
    assert.deepStrictEqual(likeCalls.map((c) => c.method), ['POST', 'POST'], 'internal state did not flip either - the retry is still an ADD');
    click(dom, act(dom, 'watched'));
    await settle(); await settle();
    assert.strictEqual(act(dom, 'watched').textContent, 'Mark watched', 'watched failure leaves state alone too');
  }, { failLike: true });
});

test('a second Reheat tap replaces the first poll - no orphaned interval keeps hitting the status route', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  await boot(async (dom, ctx) => {
    const statusCalls = () => ctx.calls.filter((c) => c.url === '/api/subscriptions/status').length;
    await openExtras(dom);
    click(dom, act(dom, 'reheat')); // 202 -> poll 1 armed (menu closes)
    for (let i = 0; i < 4; i++) await settle();
    await openExtras(dom);
    click(dom, act(dom, 'reheat')); // 202 -> poll 1 must be STOPPED, poll 2 armed
    for (let i = 0; i < 4; i++) await settle();
    t.mock.timers.tick(1000); // running
    for (let i = 0; i < 4; i++) await settle();
    t.mock.timers.tick(1000); // terminal for s1 -> toast + stop
    for (let i = 0; i < 4; i++) await settle();
    assert.ok(ctx.toasts.includes('Reheat finished.'), 'the poll reached the terminal entry');
    const quiescent = statusCalls();
    assert.strictEqual(quiescent, 2, 'exactly ONE poll ran (one status fetch per tick)');
    t.mock.timers.tick(3000);
    for (let i = 0; i < 4; i++) await settle();
    assert.strictEqual(statusCalls(), quiescent, 'nothing polls after the terminal entry - no leaked interval');
  }, {
    statusEntries: [
      { 'repull-metadata-item': { state: 'running', mediaId: 's1' } },
      { 'repull-metadata-item': { state: 'done', mediaId: 's1', networkRan: true } },
    ],
  });
});

test('the desktop POP-OUT sticker menu never offers Extras (its modals would open in the main window behind it)', async () => {
  const pipDom = new JSDOM('<body></body>', { url: 'http://localhost/pip' });
  try {
    await boot(async (dom) => {
      dom.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(pipDom.window) };
      const btn = dom.window.document.getElementById('music-popout-btn');
      click(dom, btn);
      for (let i = 0; i < 8; i++) await settle();
      const pipPanel = pipDom.window.document.getElementById('music-nowplaying-panel');
      assert.ok(pipPanel, 'the pop-out surface mounted');
      const pipMenu = pipPanel.querySelector('[data-skin-sticker-menu]');
      assert.ok(pipMenu, 'the pop-out has the sticker menu');
      assert.ok(pipMenu.querySelector('[data-skin-speed]'), 'quick controls render there (this test is not passing on a blank menu)');
      assert.strictEqual(pipMenu.querySelector('[data-skin-extras]'), null, 'but no Extras entry - main-document surface only');
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
    await openExtras(dom);
    click(dom, act(dom, 'reheat'));
    for (let i = 0; i < 4; i++) await settle();
    assert.ok(ctx.toasts.includes('This track has no source to reheat from.'), 'the real route 404 keeps the no-source copy');
  }, { repull404: 'body' });
  await boot(async (dom, ctx) => {
    await openExtras(dom);
    click(dom, act(dom, 'reheat'));
    for (let i = 0; i < 4; i++) await settle();
    assert.ok(ctx.toasts.includes('Reheat isn’t available on this server.'), 'a bodyless Express 404 = module off, said honestly');
    assert.ok(!ctx.toasts.some((m) => m.indexOf('no source') !== -1), 'and never the no-source lie');
  }, { repull404: 'plain' });
});

test('RBAC probe failure fails CLOSED: a rejected fetchCurrentUser hides Move/Delete', async () => {
  await boot(async (dom) => {
    await openExtras(dom);
    assert.strictEqual(act(dom, 'move'), null, 'no Move on a failed capability probe');
    assert.strictEqual(act(dom, 'delete'), null, 'no Delete on a failed capability probe');
    assert.ok(act(dom, 'download') && act(dom, 'like'), 'the ungated core still rendered');
  }, { meReject: true });
});

test('stale-fetch guard (TOCTOU): closing the menu while the open fetch is in flight renders NO extras', async () => {
  await boot(async (dom, ctx) => {
    await openExtras(dom); // fetch deferred - page shows Loading
    assert.ok(menu(dom).querySelector('.mms-sm-note'), 'loading note up while deferred');
    click(dom, sticker(dom)); // close with the fetch still pending
    assert.strictEqual(menu(dom).hidden, true);
    ctx.releaseVideo();
    for (let i = 0; i < 6; i++) await settle();
    assert.strictEqual(menu(dom).querySelectorAll('[data-skin-x]').length, 0, 'the late response did not render into the closed menu');
    // and the guard is not just "never renders": a fresh open still works
    click(dom, sticker(dom));
    click(dom, menu(dom).querySelector('[data-skin-extras]'));
    await settle();
    ctx.releaseVideo();
    for (let i = 0; i < 6; i++) await settle();
    assert.ok(act(dom, 'like'), 'a fresh open renders normally (the guard is scoped, not a dead switch)');
  }, { deferVideo: true });
});
