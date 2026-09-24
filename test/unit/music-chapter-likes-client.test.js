'use strict';

// [UNIT] M3 chapter likes (v1.317): the CLIENT write surfaces for "Like a given
// chapter as a song" (Dean), driven through REAL music.js (+ skin-surface.js and
// music-skins.js, exactly as music.html loads them) with a routed fetch spy:
//   AC9  the song-row heart: a projected row (a yt-dlp audio file, or one `::c`
//        chapter of it) writes the MEDIA like store under ITS OWN id
//        (POST/DELETE /api/liked/<id>), a native music-library row keeps the
//        music-native lane; the heart flips ONLY on a 2xx - a 404 leaves the
//        shown state alone and toasts (before this it flipped on every 404,
//        which was EVERY projected row);
//   AC10 the Extras "Like" row - through BOTH writers of the Extras cfg (the
//        mobile sticker page and the desktop actions menu) - reads the playing
//        CHAPTER's like flag (overlaid from GET /api/music/<chapterId>) and
//        writes /api/liked/<chapterId>; a plain library track still writes the
//        FILE; a listen-mode chapter of a VIDEO keeps the file (audio only).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
require('../../public/js/common.js');

const AK = 'NESTALGIA␟The Mix';
// The SAME shape publicTrackListItem serializes for a chaptered yt-dlp audio file:
// two chapter rows (source 'library-chapter', ids minted by chapterTrackId), a
// plain projected file (source 'library') and a NATIVE track (no source marker).
function tracksFixture(overrides) {
  const base = { artist: 'NESTALGIA', album: 'The Mix', albumKey: AK, progressEndpoint: '/api/progress' };
  const rows = [
    { ...base, id: 'f1::c0', title: 'Opening', durationSec: 60, source: 'library-chapter', streamSrc: '/video/f1', artUrl: '/thumbnail/f1', chapterStartSec: 0, liked: false },
    { ...base, id: 'f1::c1', title: 'Second Song', durationSec: 60, source: 'library-chapter', streamSrc: '/video/f1', artUrl: '/thumbnail/f1', chapterStartSec: 60, liked: true },
    { ...base, id: 'lib1', title: 'Plain File', durationSec: 90, source: 'library', streamSrc: '/video/lib1', artUrl: '/thumbnail/lib1', liked: false },
    { ...base, id: 'n1', title: 'Ripped Native', durationSec: 100, liked: false },
    // a listen-mode chapter of a VIDEO (the client mints these from a chaptered watch item)
    { ...base, id: 'v1::c1', title: 'Film Part 2', durationSec: 60, source: 'library-chapter', streamSrc: '/video/v1', artUrl: '/thumbnail/v1', chapterStartSec: 60, liked: false },
  ];
  return rows.map((r) => Object.assign(r, (overrides && overrides[r.id]) || {}));
}

// Every production element the sticker/extras harness needs (music.html 119-184),
// PLUS the desktop actions trigger + popover (music.html, v1.278) so the SECOND
// Extras writer is drivable in the same harness.
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

// opts: tracks, playId, desktop (wide viewport: no in-tab skin, the toolbar actions
// menu instead), failLike (every /api/liked/ write answers 404), videoType (the
// `type` the /api/videos/:id payload carries; default 'audio').
async function boot(run, opts) {
  opts = opts || {};
  const tracks = opts.tracks || tracksFixture();
  const playId = opts.playId || 'f1::c1';
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music?play=' + encodeURIComponent(playId) });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  const mobile = !opts.desktop;
  dom.window.matchMedia = () => ({ matches: mobile, media: '(max-width: 768px)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } });
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;

  const calls = [];
  const toasts = [];
  const likedTotalCalls = [];
  function fetchMap(url, init) {
    const u = String(url);
    const method = (init && init.method) || 'GET';
    calls.push({ url: u, method });
    if (method !== 'GET' && u.indexOf('/api/liked/') === 0) {
      if (opts.failLike) return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'Media file not found' }) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, liked: method === 'POST' }) });
    }
    if (method !== 'GET' && u.indexOf('/api/music/liked/') === 0) return Promise.resolve({ ok: true, status: 200, json: async () => ({ liked: method === 'POST' }) });
    const vm = u.match(/^\/api\/videos\/([^/?]+)$/);
    if (vm && method === 'GET') {
      const id = decodeURIComponent(vm[1]);
      const type = id === 'v1' ? 'video' : (opts.videoType || 'audio');
      return Promise.resolve({ ok: true, json: async () => ({ id, type, title: 'The Mix', filePath: '/media/tube/' + id + '.mp3', watchUrl: 'https://www.youtube.com/watch?v=abc123DEF45', hasSubtitles: false, liked: false, watchState: 'unwatched', channelName: 'NESTALGIA' }) });
    }
    if (u === '/api/config') return Promise.resolve({ ok: true, json: async () => ({ folders: ['Music'] }) });
    if (u === '/api/subscriptions/status') return Promise.resolve({ ok: true, json: async () => ({ oneShots: {} }) });
    if (method !== 'GET') return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    if (u.indexOf('album=') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: tracks }) });
    if (u.indexOf('filter=recent-listening') !== -1) return Promise.resolve({ ok: true, json: async () => ({ items: [tracks.find((t) => t.id === playId)] }) });
    const idm = u.match(/^\/api\/music\/([^?]+)$/);
    if (idm) { const t = tracks.find((x) => x.id === decodeURIComponent(idm[1])); return Promise.resolve(t ? { ok: true, json: async () => t } : { ok: false, status: 404, json: async () => ({}) }); }
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  }

  const metaById = (id) => { const t = tracks.find((x) => x.id === id); return t ? { isMusic: true, id: t.id, title: t.title, artist: t.artist, album: t.album, albumKey: t.albumKey } : null; };
  let registered = null;
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player: {
      currentId: playId, getState: () => 'full', expand: () => {}, dock: () => {},
      getCurrentMeta: () => metaById(dom.window.FileTube.player.currentId),
      load: (id) => { dom.window.FileTube.player.currentId = id; },
      setTrackNav: () => {},
      isLoopEnabled: () => false, setLoop: () => {},
      close: () => { dom.window.FileTube.player.currentId = null; },
    },
  };
  dom.window.fetchCurrentUser = () => Promise.resolve({ user: { role: 'admin' } });
  dom.window.fetchLikedTotal = (force) => { likedTotalCalls.push(force); return Promise.resolve(0); };
  dom.window.showToast = (msg) => { toasts.push(String(msg)); };
  dom.window.addToQueue = () => {};
  dom.window.isYtdlpManagedItem = require('../../public/js/common.js').isYtdlpManagedItem;
  global.fetch = (u, init) => fetchMap(u, init);
  delete require.cache[require.resolve('../../public/js/music-skins.js')];
  require('../../public/js/music-skins.js');
  delete require.cache[require.resolve('../../public/js/skin-surface.js')];
  require('../../public/js/skin-surface.js');
  const root = () => dom.window.document.getElementById('view-root');
  const ctx = { calls, toasts, likedTotalCalls };
  try {
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(root());
    for (let i = 0; i < 12; i++) await settle();
    await run(dom, ctx);
  } finally {
    try { if (registered) registered.destroy(); } catch (_) { /* best-effort teardown */ }
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
}

const doc = (dom) => dom.window.document;
const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const heart = (dom, id) => {
  const row = doc(dom).querySelector('.music-song-row[data-id="' + id + '"]');
  assert.ok(row, 'the song row for ' + id + ' rendered');
  return row.querySelector('button[data-like-id]');
};
const settleN = async (n) => { for (let i = 0; i < n; i++) await settle(); };
const writes = (ctx, lane) => ctx.calls.filter((c) => c.method !== 'GET' && c.url.indexOf(lane) === 0).map((c) => c.method + ' ' + c.url);
const ENC_C0 = encodeURIComponent('f1::c0');
const ENC_C1 = encodeURIComponent('f1::c1');

// ---- AC9: the song-row heart -----------------------------------------------------

test('the row heart of a `::c` chapter row writes the MEDIA store under the CHAPTER id and flips on 200 (POST, then DELETE)', async () => {
  await boot(async (dom, ctx) => {
    const h = heart(dom, 'f1::c0');
    assert.strictEqual(h.getAttribute('data-like-store'), 'media', 'a chapter row carries the media-store marker');
    assert.ok(!h.classList.contains('liked'), 'starts unliked (the list flag)');
    click(dom, h);
    await settleN(4);
    assert.deepStrictEqual(writes(ctx, '/api/liked/'), ['POST /api/liked/' + ENC_C0], 'ONE POST to the media lane under the chapter id');
    assert.deepStrictEqual(writes(ctx, '/api/music/liked/'), [], 'never the music-native lane (ownTrack-gated: 404 for every projected row)');
    assert.ok(h.classList.contains('liked'), 'flipped on the 2xx');
    assert.strictEqual(h.getAttribute('aria-label'), 'Unlike');
    assert.deepStrictEqual(ctx.likedTotalCalls, [true], 'the Liked sidebar count is re-primed');
    click(dom, h);
    await settleN(4);
    assert.deepStrictEqual(writes(ctx, '/api/liked/'), ['POST /api/liked/' + ENC_C0, 'DELETE /api/liked/' + ENC_C0], 'the second tap unlikes the same chapter');
    assert.ok(!h.classList.contains('liked'));
  });
});

test('the row heart flips NOTHING on a 404 and says so (the silent-flip lie is gone)', async () => {
  await boot(async (dom, ctx) => {
    const h = heart(dom, 'f1::c0');
    click(dom, h);
    await settleN(4);
    assert.deepStrictEqual(writes(ctx, '/api/liked/'), ['POST /api/liked/' + ENC_C0], 'the write was attempted');
    assert.ok(!h.classList.contains('liked'), 'a 404 leaves the heart unliked');
    assert.strictEqual(h.getAttribute('aria-label'), 'Like');
    assert.deepStrictEqual(ctx.toasts, ['Could not update Like.'], 'and the user is told');
    assert.deepStrictEqual(ctx.likedTotalCalls, [], 'no count re-prime on failure');
    // A retry is still an ADD (internal state did not flip either).
    click(dom, h);
    await settleN(4);
    assert.deepStrictEqual(writes(ctx, '/api/liked/').map((w) => w.split(' ')[0]), ['POST', 'POST']);
  }, { failLike: true });
});

test('a plain projected file row writes the media store under the FILE id; a native row keeps the music-native lane', async () => {
  await boot(async (dom, ctx) => {
    const lib = heart(dom, 'lib1');
    assert.strictEqual(lib.getAttribute('data-like-store'), 'media', 'a projected library row is media-store');
    click(dom, lib);
    await settleN(4);
    assert.deepStrictEqual(writes(ctx, '/api/liked/'), ['POST /api/liked/lib1'], 'the file like (D11: the base file\'s like stays for non-chapter items)');
    assert.ok(lib.classList.contains('liked'));

    const nat = heart(dom, 'n1');
    assert.strictEqual(nat.getAttribute('data-like-store'), null, 'a native row carries NO media marker');
    click(dom, nat);
    await settleN(4);
    assert.deepStrictEqual(writes(ctx, '/api/music/liked/'), ['POST /api/music/liked/n1'], 'native rows still use the music-native lane');
    assert.deepStrictEqual(writes(ctx, '/api/liked/'), ['POST /api/liked/lib1'], 'and never the media lane');
    assert.ok(nat.classList.contains('liked'));
  });
});

// ---- AC10: the Extras "Like" row, BOTH writers -----------------------------------

const panel = (dom) => doc(dom).getElementById('music-nowplaying-panel');
const stickerMenu = (dom) => panel(dom).querySelector('[data-skin-sticker-menu]');
async function openStickerExtras(dom) {
  const sticker = panel(dom).querySelector('.mms-sticker[data-skin-sticker]');
  assert.ok(sticker, 'the skin sticker rendered (mobile)');
  if (stickerMenu(dom).hidden) click(dom, sticker);
  const entry = stickerMenu(dom).querySelector('[data-skin-extras]');
  assert.ok(entry, 'the Extras entry is on page 1');
  click(dom, entry);
  await settleN(8);
  return stickerMenu(dom);
}
async function openDesktopActions(dom) {
  const btn = doc(dom).getElementById('music-actions-btn');
  assert.ok(btn && !btn.hidden, 'the desktop actions trigger shows for a FULL library-backed track');
  click(dom, btn);
  await settleN(8);
  return doc(dom).getElementById('music-actions-menu');
}
const likeRow = (menu) => menu.querySelector('[data-skin-x="like"]');

for (const [label, open, desktop] of [['sticker Extras page', openStickerExtras, false], ['desktop actions menu', openDesktopActions, true]]) {
  test(`${label}: the Like row reads the playing CHAPTER's flag (overlaid from /api/music/<chapterId>, not the file's) and toggles /api/liked/<chapterId>`, async () => {
    // Playing f1::c1, whose row is liked:true while the FILE (/api/videos/f1) says liked:false.
    await boot(async (dom, ctx) => {
      const menu = await open(dom);
      assert.ok(ctx.calls.some((c) => c.url === '/api/videos/f1' && c.method === 'GET'), 'fetched the base item on open (Share/Download/Delete act on the file)');
      assert.ok(ctx.calls.some((c) => c.url === '/api/music/' + ENC_C1 && c.method === 'GET'), 'AND the chapter row, for its own like flag');
      const row = likeRow(menu);
      assert.ok(row, 'the Like row rendered');
      assert.strictEqual(row.querySelector('.mms-sm-actlbl').textContent, 'Liked', 'shows the CHAPTER as liked although the file is not');
      assert.ok(row.classList.contains('is-on'));
      click(dom, row);
      await settleN(4);
      assert.deepStrictEqual(writes(ctx, '/api/liked/'), ['DELETE /api/liked/' + ENC_C1], 'the tap unlikes the CHAPTER, never the file');
      assert.strictEqual(row.querySelector('.mms-sm-actlbl').textContent, 'Like');
    }, { desktop });
    // The other direction: an unliked chapter POSTs its chapter id.
    await boot(async (dom, ctx) => {
      const menu = await open(dom);
      const row = likeRow(menu);
      assert.strictEqual(row.querySelector('.mms-sm-actlbl').textContent, 'Like');
      click(dom, row);
      await settleN(4);
      assert.deepStrictEqual(writes(ctx, '/api/liked/'), ['POST /api/liked/' + ENC_C1], 'POST under the chapter id');
      assert.strictEqual(row.querySelector('.mms-sm-actlbl').textContent, 'Liked');
      assert.deepStrictEqual(ctx.likedTotalCalls, [true], 'the Liked sidebar count is re-primed');
    }, { desktop, tracks: tracksFixture({ 'f1::c1': { liked: false } }) });
  });

  test(`${label}: a plain library track's Like still targets the FILE; a listen-mode chapter of a VIDEO keeps the file (audio only)`, async () => {
    await boot(async (dom, ctx) => {
      const menu = await open(dom);
      click(dom, likeRow(menu));
      await settleN(4);
      assert.deepStrictEqual(writes(ctx, '/api/liked/'), ['POST /api/liked/lib1'], 'a non-chapter track likes the file');
    }, { desktop, playId: 'lib1' });
    await boot(async (dom, ctx) => {
      const menu = await open(dom);
      assert.ok(ctx.calls.some((c) => c.url === '/api/videos/v1' && c.method === 'GET'), 'fetched the base VIDEO item');
      click(dom, likeRow(menu));
      await settleN(4);
      assert.deepStrictEqual(writes(ctx, '/api/liked/'), ['POST /api/liked/v1'], 'a video chapter likes the whole video (today\'s behaviour; the server accepts chapter likes for audio items only)');
    }, { desktop, playId: 'v1::c1' });
  });
}

test('the chapter target is captured at OPEN time: a chapter roll while the menu is open does not retarget the tap', async () => {
  await boot(async (dom, ctx) => {
    const menu = await openDesktopActions(dom);
    // The player advances to the NEXT chapter of the same file while the menu stays open
    // (the desktop menu only closes on a BASE-id change).
    dom.window.FileTube.player.currentId = 'f1::c0';
    click(dom, likeRow(menu));
    await settleN(4);
    assert.deepStrictEqual(writes(ctx, '/api/liked/'), ['DELETE /api/liked/' + ENC_C1], 'acts on the chapter the row SHOWED (c1), not the one now playing (c0)');
  }, { desktop: true });
});
