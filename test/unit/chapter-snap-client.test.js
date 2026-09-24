'use strict';

// [UNIT] Chapter Snap (2026-09-24) - the MUSIC entry points, driven through REAL music.js
// (+ skin-surface.js and music-skins.js, as music.html loads them) with a routed
// fetch spy and a spy on the ONE editor (window.showChapterSnapEditor):
//   (1) the album drill's "Fix times" - only on a chaptered album, only for a
//       viewer who may modify the library, and it opens the editor on the backing
//       FILE (never a row id, never a row list - the editor seeds from storage);
//   (2) now playing's "This chapter starts wrong" - through BOTH writers of the
//       Extras cfg (the mobile sticker page and the desktop actions menu), on the
//       PLAYING chapter's index, hidden for a non-modifier and for a plain file;
//   the RE-REGISTER seam: a save's new start times patch the live queue in place,
//   so the drill repaints ("Edited" + the new spans) and the chapter watcher
//   re-derives which chapter the playhead is in NOW (the display follows).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const musicPath = require.resolve('../../public/js/music.js');
require('../../public/js/common.js');

const AK = 'NESTALGIA␟The Mix';
function tracksFixture() {
  const base = { artist: 'NESTALGIA', album: 'The Mix', albumKey: AK, progressEndpoint: '/api/progress' };
  return [
    { ...base, id: 'f1::c0', title: 'Opening', durationSec: 60, source: 'library-chapter', streamSrc: '/video/f1', artUrl: '/thumbnail/f1', chapterStartSec: 0, liked: false },
    { ...base, id: 'f1::c1', title: 'Second Song', durationSec: 60, source: 'library-chapter', streamSrc: '/video/f1', artUrl: '/thumbnail/f1', chapterStartSec: 60, liked: false },
    { ...base, id: 'f1::c2', title: 'Closer', durationSec: 60, source: 'library-chapter', streamSrc: '/video/f1', artUrl: '/thumbnail/f1', chapterStartSec: 120, liked: false },
    { ...base, id: 'lib1', title: 'Plain File', durationSec: 90, source: 'library', streamSrc: '/video/lib1', artUrl: '/thumbnail/lib1', liked: false },
  ];
}
const FILE_CHAPTERS = [{ startTime: 0, title: 'Opening' }, { startTime: 60, title: 'Second Song' }, { startTime: 120, title: 'Closer' }];

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

// opts: playId, desktop, canModify (default true), state ('full' now playing | 'docked' drill)
async function boot(run, opts) {
  opts = opts || {};
  const tracks = tracksFixture();
  const playId = opts.playId || 'f1::c1';
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music?play=' + encodeURIComponent(playId) + (opts.listen ? '&listen=1' : '') });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  const mobile = !opts.desktop;
  dom.window.matchMedia = () => ({ matches: mobile, media: '(max-width: 768px)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } });
  global.window = dom.window; global.document = dom.window.document;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  const calls = [];
  const editor = [];
  const navs = [];
  global.fetch = (url, init) => {
    const u = String(url);
    const method = (init && init.method) || 'GET';
    calls.push(method + ' ' + u);
    const vm = u.match(/^\/api\/videos\/([^/?]+)$/);
    if (vm && method === 'GET') {
      const id = decodeURIComponent(vm[1]);
      if (opts.videos && opts.videos[id]) return Promise.resolve({ ok: true, json: async () => opts.videos[id] });
      return Promise.resolve({ ok: true, json: async () => ({ id, type: 'audio', title: id === 'f1' ? 'The Mix' : 'Plain File', chapters: id === 'f1' ? (opts.fileChapters || FILE_CHAPTERS) : [], chaptersVersion: opts.version, liked: false, watchState: 'unwatched', channelName: 'NESTALGIA' }) });
    }
    if (u === '/api/subscriptions/status') return Promise.resolve({ ok: true, json: async () => ({ oneShots: {} }) });
    if (u.indexOf('filter=recent-listening') !== -1) {
      const baseOf = (id) => String(id).replace(/::c\d+$/, '');
      const items = /::c\d+$/.test(playId) ? tracks.filter((t) => t.source === 'library-chapter' && baseOf(t.id) === baseOf(playId)) : [tracks.find((t) => t.id === playId)];
      return Promise.resolve({ ok: true, json: async () => ({ items: items.concat(opts.extraQueue || []) }) });
    }
    if (u.indexOf('album=') !== -1) {
      const items = (opts.server && opts.server.drill) || opts.drillTracks || tracks.slice(0, 3);
      return Promise.resolve({ ok: true, json: async () => ({ items }) });
    }
    const idm = u.match(/^\/api\/music\/([^?]+)$/);
    if (idm) {
      const t = tracks.find((x) => x.id === decodeURIComponent(idm[1]));
      return Promise.resolve(t ? { ok: true, json: async () => t } : { ok: false, status: 404, json: async () => ({}) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ items: (opts.server && opts.server.drill) || opts.drillTracks || tracks.slice(0, 3) }) });
  };
  const metaById = (id) => { const t = tracks.find((x) => x.id === id); return t ? { isMusic: true, id: t.id, title: t.title, artist: t.artist, album: t.album, albumKey: t.albumKey } : null; };
  let registered = null;
  dom.window.FileTube = {
    registerView: (n, m) => { registered = m; },
    encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player: {
      currentId: playId, getState: () => opts.state || 'full', expand: () => {}, dock: () => {},
      getCurrentMeta: () => metaById(dom.window.FileTube.player.currentId),
      load: (id) => { dom.window.FileTube.player.currentId = id; },
      setTrackNav: (nav) => { navs.push(nav || {}); }, isLoopEnabled: () => false, setLoop: () => {},
      close: () => { dom.window.FileTube.player.currentId = null; },
    },
  };
  const canModify = opts.canModify !== false;
  dom.window.fetchCurrentUser = () => Promise.resolve({ user: canModify ? { role: 'admin' } : { role: 'member', canModifyLibrary: false } });
  dom.window.fetchLikedTotal = () => Promise.resolve(0);
  dom.window.showToast = () => {};
  dom.window.addToQueue = () => {};
  dom.window.showChapterSnapEditor = (id, o) => { editor.push({ id, opts: o }); return { close() {} }; };
  dom.window.showChaptersEditor = (id, lines, onSaved, d, o) => { editor.push({ id, text: true, lines, opts: Object.assign({ onSaved }, o || {}) }); };
  delete require.cache[require.resolve('../../public/js/music-skins.js')];
  require('../../public/js/music-skins.js');
  delete require.cache[require.resolve('../../public/js/skin-surface.js')];
  require('../../public/js/skin-surface.js');
  try {
    delete require.cache[musicPath];
    require(musicPath);
    registered.init(dom.window.document.getElementById('view-root'));
    await settleN(12);
    await run(dom, { calls, editor, navs, registered, root: dom.window.document.getElementById('view-root') });
  } finally {
    try { if (registered) registered.destroy(); } catch (_) { /* best-effort */ }
    delete require.cache[musicPath];
    Object.assign(global, saved);
  }
}

const doc = (dom) => dom.window.document;
const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const panel = (dom) => doc(dom).getElementById('music-nowplaying-panel');
async function openStickerExtras(dom) {
  const menu = panel(dom).querySelector('[data-skin-sticker-menu]');
  const sticker = panel(dom).querySelector('.mms-sticker[data-skin-sticker]');
  assert.ok(sticker, 'the skin sticker rendered (mobile)');
  if (menu.hidden) click(dom, sticker);
  const entry = menu.querySelector('[data-skin-extras]');
  assert.ok(entry, 'the Extras entry is on page 1');
  click(dom, entry);
  await settleN(8);
  return menu;
}
async function openDesktopActions(dom) {
  const btn = doc(dom).getElementById('music-actions-btn');
  assert.ok(btn && !btn.hidden, 'the desktop actions trigger shows');
  click(dom, btn);
  await settleN(8);
  return doc(dom).getElementById('music-actions-menu');
}
const snapRow = (menu) => menu.querySelector('[data-skin-x="chapter-snap"]');

for (const [label, open, desktop] of [['sticker Extras page', openStickerExtras, false], ['desktop actions menu', openDesktopActions, true]]) {
  test(`${label}: "This chapter starts wrong" opens the ONE editor on the backing file at the PLAYING chapter`, async () => {
    await boot(async (dom, ctx) => {
      const menu = await open(dom);
      assert.ok(menu.querySelector('[data-skin-x="like"]'), 'the Extras page rendered (non-vacuous)');
      const row = snapRow(menu);
      assert.ok(row, 'the row is offered on a playing chapter');
      assert.match(row.textContent, /This chapter starts wrong/);
      click(dom, row);
      await settleN(2);
      assert.strictEqual(ctx.editor.length, 1, 'the editor opened once');
      assert.strictEqual(ctx.editor[0].id, 'f1', 'on the backing FILE, never the `::c` id');
      assert.strictEqual(ctx.editor[0].opts.focusIndex, 1, 'on the chapter that is playing');
      assert.strictEqual(typeof ctx.editor[0].opts.onSaved, 'function');
    }, { desktop });
  });

  test(`${label}: hidden for a viewer who may not modify the library, and for a plain (unchaptered) file`, async () => {
    await boot(async (dom) => {
      const menu = await open(dom);
      assert.ok(menu.querySelector('[data-skin-x="like"]'), 'the Extras page rendered for the member (populated)');
      assert.strictEqual(snapRow(menu), null, 'no entry without modify rights');
    }, { desktop, canModify: false });
    await boot(async (dom) => {
      const menu = await open(dom);
      assert.ok(menu.querySelector('[data-skin-x="like"]'), 'the Extras page rendered for the plain file (populated)');
      assert.strictEqual(snapRow(menu), null, 'no entry on a plain file');
    }, { desktop, playId: 'lib1' });
  });
}

test('the RE-REGISTER seam: a save from now playing patches the live queue, so the chapter watcher re-derives the playing chapter from the NEW starts', async () => {
  await boot(async (dom, ctx) => {
    const mp = doc(dom).getElementById('media-player');
    Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => 62, set: () => {} });
    Object.defineProperty(mp, 'duration', { configurable: true, get: () => 180 });
    const menu = await openDesktopActions(dom);
    click(dom, snapRow(menu));
    await settleN(2);
    const before = doc(dom).getElementById('music-nowplaying-panel').textContent;
    assert.match(before, /^Second Song/, 'precondition: at 62s the playhead is in chapter 2 (starts 60) - the panel leads with it');
    // The save moved chapter 2's start to 65: at 62s the playhead is now still in chapter 1.
    ctx.editor[0].opts.onSaved({ chapters: [{ startTime: 0, title: 'Opening' }, { startTime: 65, title: 'Second Song' }, { startTime: 120, title: 'Closer' }], chaptersSource: 'manual', chaptersEdited: true });
    await settleN(4);
    const after = doc(dom).getElementById('music-nowplaying-panel').textContent;
    assert.match(after, /^Opening/, 'the display follows the NEW boundary without a reload');
    assert.match(after, /1:05Second Song/, 'and the Up next list shows the patched spans (chapter 1 now 65s)');
  }, { desktop: true });
});

test('drill (1): "Fix times" on a chaptered album opens the editor on the FILE; the save repaints the drill with the new spans and the Edited badge', async () => {
  await boot(async (dom, ctx) => {
    const btn = doc(dom).querySelector('.music-drill-snap');
    assert.ok(doc(dom).querySelector('.music-drill'), 'the drill rendered');
    assert.ok(btn, 'the Fix times button is on the chaptered album');
    assert.strictEqual(doc(dom).querySelector('.music-drill-edited'), null, 'no Edited badge before any correction (populated below)');
    click(dom, btn);
    await settleN(2);
    assert.strictEqual(ctx.editor.length, 1);
    assert.strictEqual(ctx.editor[0].id, 'f1', 'the backing file');
    assert.strictEqual(ctx.editor[0].opts.focusIndex, undefined, 'the drill opens the whole list');
    ctx.editor[0].opts.onSaved({ chapters: [{ startTime: 0, title: 'Opening' }, { startTime: 75, title: 'Second Song' }, { startTime: 120, title: 'Closer' }], chaptersSource: 'manual', chaptersEdited: true });
    await settleN(4);
    assert.ok(doc(dom).querySelector('.music-drill-edited'), 'the Edited badge appears');
    const rowText = (id) => doc(dom).querySelector('.music-song-row[data-id="' + id + '"]').textContent;
    assert.match(rowText('f1::c0'), /1:15/, 'chapter 1 now spans 75s');
    assert.match(rowText('f1::c1'), /0:45/, 'chapter 2 now spans 45s');
    // Revert (chaptersEdited false) clears the badge again - the clear axis on a POPULATED badge.
    ctx.editor[0].opts.onSaved({ chapters: FILE_CHAPTERS, chaptersSource: 'embedded', chaptersEdited: false });
    await settleN(4);
    assert.strictEqual(doc(dom).querySelector('.music-drill-edited'), null, 'the badge clears on revert');
  }, { state: 'docked', playId: 'f1::c0' });
});

test('drill (1): no Fix times for a viewer who may not modify the library, nor on a non-chapter album', async () => {
  await boot(async (dom) => {
    assert.ok(doc(dom).querySelector('.music-drill'), 'the drill rendered (populated)');
    assert.strictEqual(doc(dom).querySelector('.music-drill-snap'), null);
  }, { state: 'docked', playId: 'f1::c0', canModify: false });
  await boot(async (dom) => {
    assert.ok(doc(dom).querySelector('.music-drill'), 'the drill rendered (populated)');
    assert.strictEqual(doc(dom).querySelector('.music-drill-snap'), null, 'a mixed/plain album is not one file\'s chapters');
  }, { state: 'docked', playId: 'f1::c0', drillTracks: tracksFixture() });
});

test('the seam touches ONLY the saved file: another chaptered file queued beside it keeps its spans (adversary MB)', async () => {
  // The album list the ?play= path queues (music.js playTrackInAlbum) carries a SECOND
  // chaptered file's chapters beside f1's.
  const base = { artist: 'NESTALGIA', album: 'The Mix', albumKey: AK, progressEndpoint: '/api/progress', source: 'library-chapter', streamSrc: '/video/f2', artUrl: '/thumbnail/f2' };
  const extraQueue = [
    { ...base, id: 'f2::c0', title: 'Other One', durationSec: 30, chapterStartSec: 0 },
    { ...base, id: 'f2::c1', title: 'Other Two', durationSec: 30, chapterStartSec: 30 },
  ];
  await boot(async (dom, ctx) => {
    const menu = await openDesktopActions(dom);
    click(dom, snapRow(menu));
    await settleN(2);
    const before = doc(dom).getElementById('music-nowplaying-panel').textContent;
    assert.match(before, /Other One[^0-9]*0:30/, 'precondition: the second file is queued, 30 s spans');
    ctx.editor[0].opts.onSaved({ chapters: [{ startTime: 0, title: 'Opening' }, { startTime: 65, title: 'Second Song' }, { startTime: 120, title: 'Closer' }], chaptersSource: 'manual', chaptersEdited: true });
    await settleN(4);
    const after = doc(dom).getElementById('music-nowplaying-panel').textContent;
    assert.match(after, /1:05Second Song/, 'the saved file took its new spans (non-vacuous)');
    assert.match(after, /Other One[^0-9]*0:30/, 'the OTHER file kept its own spans');
    assert.match(after, /Other Two[^0-9]*0:30/);
  }, { desktop: true, server: { drill: tracksFixture().slice(0, 3).concat(extraQueue) } });
});

test('a COUNT-changing save (a consented revert 3 -> 2) in the drill RE-FETCHES the rows: no ghost row, and each row\'s like targets the chapter its title names (adversary W5)', async () => {
  const server = { drill: null };
  await boot(async (dom, ctx) => {
    click(dom, doc(dom).querySelector('.music-drill-snap'));
    await settleN(2);
    assert.ok(doc(dom).querySelector('.music-song-row[data-id="f1::c2"]'), 'precondition: three chapter rows');
    const albumFetchesBefore = ctx.calls.filter((c) => c.indexOf('album=') !== -1).length;
    // The server's truth after the revert: two chapters, `::c1` is now "Closer".
    const base = { artist: 'NESTALGIA', album: 'The Mix', albumKey: 'NESTALGIA␟The Mix', progressEndpoint: '/api/progress', source: 'library-chapter', streamSrc: '/video/f1', artUrl: '/thumbnail/f1', liked: false };
    server.drill = [
      { ...base, id: 'f1::c0', title: 'Opening', durationSec: 90, chapterStartSec: 0 },
      { ...base, id: 'f1::c1', title: 'Closer', durationSec: 90, chapterStartSec: 90 },
    ];
    ctx.editor[0].opts.onSaved({ chapters: [{ startTime: 0, title: 'Opening' }, { startTime: 90, title: 'Closer' }], chaptersSource: 'embedded', chaptersEdited: false });
    await settleN(12);
    assert.ok(ctx.calls.filter((c) => c.indexOf('album=') !== -1).length > albumFetchesBefore, 'the drill re-fetched from the server');
    assert.strictEqual(doc(dom).querySelector('.music-song-row[data-id="f1::c2"]'), null, 'no ghost row for a chapter that no longer exists');
    const c1 = doc(dom).querySelector('.music-song-row[data-id="f1::c1"]');
    assert.ok(c1, 'the ::c1 row is there');
    assert.match(c1.textContent, /Closer/, '...titled with the song ::c1 now IS');
    assert.doesNotMatch(c1.textContent, /Second Song/);
    // Liking that row likes `f1::c1`, which the server calls "Closer" - what the row says.
    click(dom, c1.querySelector('button[data-like-id]'));
    await settleN(4);
    assert.ok(ctx.calls.indexOf('POST /api/liked/' + encodeURIComponent('f1::c1')) !== -1, 'the like targets f1::c1');
  }, { state: 'docked', playId: 'f1::c0', server });
});

test('a count change from NOW PLAYING re-lists from the server: no ghost chapter, survivors re-titled (adversary W5)', async () => {
  const server = { drill: null };
  await boot(async (dom, ctx) => {
    const menu = await openDesktopActions(dom);
    click(dom, snapRow(menu));
    await settleN(2);
    assert.match(doc(dom).getElementById('music-nowplaying-panel').textContent, /Closer/, 'precondition: chapter 3 queued');
    const b = { artist: 'NESTALGIA', album: 'The Mix', albumKey: AK, progressEndpoint: '/api/progress', source: 'library-chapter', streamSrc: '/video/f1', artUrl: '/thumbnail/f1', liked: false };
    server.drill = [{ ...b, id: 'f1::c0', title: 'Opening', durationSec: 90, chapterStartSec: 0 }, { ...b, id: 'f1::c1', title: 'Finale', durationSec: 90, chapterStartSec: 90 }];
    ctx.editor[0].opts.onSaved({ chapters: [{ startTime: 0, title: 'Opening' }, { startTime: 90, title: 'Finale' }], chaptersSource: 'embedded', chaptersEdited: false });
    // SYNCHRONOUSLY - before the re-list lands - the queue itself is already consistent
    // (the ghost dropped, ::c1 re-titled): nothing can play or like a stale row meanwhile.
    const sync = doc(dom).getElementById('music-nowplaying-panel').textContent;
    assert.doesNotMatch(sync, /Closer/, 'the ghost left the queue at once');
    assert.match(sync, /Finale/, '::c1 re-titled at once');
    await settleN(12);
    const after = doc(dom).getElementById('music-nowplaying-panel').textContent;
    assert.doesNotMatch(after, /Closer/, 'the ghost third chapter left the queue');
    assert.doesNotMatch(after, /Second Song/, 'the old title of ::c1 is gone');
    assert.match(after, /Finale/, '::c1 carries its new title');
  }, { desktop: true, server });
});

test('entry 4 from the drill (qa S10): a text-editor save - the path the time editor\'s "Fix times..." also hands through - re-derives the PLAYING chapter while paused, and the seed is lossless with the version', async () => {
  await boot(async (dom, ctx) => {
    const mp = doc(dom).getElementById('media-player');
    Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => 55, set: () => {} });
    Object.defineProperty(mp, 'duration', { configurable: true, get: () => 180 });
    Object.defineProperty(mp, 'paused', { configurable: true, get: () => true });
    click(dom, doc(dom).querySelector('.music-drill-chapters'));
    await settleN(8);
    const ed = ctx.editor.find((e) => e.text);
    assert.ok(ed, 'the text editor opened');
    assert.strictEqual(ed.lines, '0:00 Opening\n1:00.5 Second Song\n2:00 Closer', 'the seed keeps the fraction (never 1:00)');
    assert.strictEqual(ed.opts.version, 'ver-f1', 'the seed carries the item\'s version token');
    const row = (id) => doc(dom).querySelector('.music-song-row[data-id="' + id + '"]');
    assert.ok(row('f1::c0').classList.contains('playing'), 'precondition: chapter 1 marked playing');
    // The save moved chapter 2 to 50 s: at 55 s (paused) the playhead is now IN chapter 2.
    ed.opts.onSaved({ chapters: [{ startTime: 0, title: 'Opening' }, { startTime: 50, title: 'Second Song' }, { startTime: 120, title: 'Closer' }], chaptersSource: 'manual', chaptersEdited: false });
    await settleN(12);
    assert.ok(row('f1::c1').classList.contains('playing'), 'the playing chapter re-derived from the NEW starts without a timeupdate');
    assert.ok(!row('f1::c0').classList.contains('playing'), 'and the old row cleared');
  }, { state: 'docked', playId: 'f1::c0', fileChapters: [{ startTime: 0, title: 'Opening' }, { startTime: 60.5, title: 'Second Song' }, { startTime: 120, title: 'Closer' }], version: 'ver-f1' });
});

// ---- gate r2 (adversary W2, qa S5): a count change re-registers nav by the NEW index ----
const chapRow = (id, title, start, extra) => ({ artist: 'NESTALGIA', album: 'The Mix', albumKey: AK, progressEndpoint: '/api/progress', source: 'library-chapter', streamSrc: '/video/f1', artUrl: '/thumbnail/f1', liked: false, id, title, durationSec: 60, chapterStartSec: start, ...(extra || {}) });
const lastNav = (ctx) => ctx.navs[ctx.navs.length - 1] || {};

test('3 -> 2 revert while PLAYING f1::c1 (in order): nav re-registers at once - no stale Next, and the radio arms because ::c1 became the LAST chapter', async () => {
  const server = { drill: [chapRow('f1::c0', 'Opening', 0), chapRow('f1::c1', 'Second Song', 60), chapRow('f1::c2', 'Closer', 120)] };
  await boot(async (dom, ctx) => {
    // The playhead sits at 62 s - inside ::c1 before AND after the save.
    const mp = doc(dom).getElementById('media-player');
    Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => 62, set: () => {} });
    Object.defineProperty(mp, 'duration', { configurable: true, get: () => 180 });
    const menu = await openDesktopActions(dom);
    click(dom, snapRow(menu));
    await settleN(2);
    assert.strictEqual(typeof lastNav(ctx).onNext, 'function', 'precondition: ::c1 had a Next (::c2)');
    const regsBefore = ctx.navs.length;
    const artistFetchesBefore = ctx.calls.filter((c) => c.indexOf('artist=') !== -1).length;
    server.drill = [chapRow('f1::c0', 'Opening', 0), chapRow('f1::c1', 'Closer', 60, { durationSec: 120 })];
    ctx.editor[0].opts.onSaved({ chapters: [{ startTime: 0, title: 'Opening' }, { startTime: 60, title: 'Closer' }], chaptersSource: 'embedded', chaptersEdited: false });
    assert.ok(ctx.navs.length > regsBefore, 'nav re-registered SYNCHRONOUSLY on the save (the playing id did not change)');
    assert.strictEqual(lastNav(ctx).onNext, undefined, 'no stale Next: ::c1 is now the last chapter');
    await settleN(12);
    assert.strictEqual(lastNav(ctx).onNext, undefined, 'and still none after the re-list');
    assert.ok(ctx.calls.filter((c) => c.indexOf('artist=') !== -1).length > artistFetchesBefore, 'the last-index radio armed (the autoplay picker fetched)');
    lastNav(ctx).onPrev();
    assert.strictEqual(dom.window.FileTube.player.currentId, 'f1::c0', 'Prev goes to the right row');
  }, { desktop: true, server });
});

test('a dropped row BEFORE the playing one (a shuffled list) keeps Prev/Next pointing at the right rows', async () => {
  // Queue order c2, c0, c1 - playing c1 at index 2. The revert drops c2 (index 0), so c1 moves to index 1.
  const server = { drill: [chapRow('f1::c2', 'Closer', 120), chapRow('f1::c0', 'Opening', 0), chapRow('f1::c1', 'Second Song', 60)] };
  await boot(async (dom, ctx) => {
    const mp = doc(dom).getElementById('media-player');
    Object.defineProperty(mp, 'currentTime', { configurable: true, get: () => 62, set: () => {} });
    Object.defineProperty(mp, 'duration', { configurable: true, get: () => 180 });
    const menu = await openDesktopActions(dom);
    click(dom, snapRow(menu));
    await settleN(2);
    server.drill = [chapRow('f1::c0', 'Opening', 0), chapRow('f1::c1', 'Second Song', 60)];
    ctx.editor[0].opts.onSaved({ chapters: [{ startTime: 0, title: 'Opening' }, { startTime: 60, title: 'Second Song' }], chaptersSource: 'embedded', chaptersEdited: false });
    // Synchronously, before any re-list: Prev must be ::c0 (the stale closure was playAt(1) = ::c1 itself).
    lastNav(ctx).onPrev();
    assert.strictEqual(dom.window.FileTube.player.currentId, 'f1::c0', 'Prev is the row BEFORE the playing one in the filtered queue');
    await settleN(12); // let the re-list settle inside the test
  }, { desktop: true, server });
});

test('Listen mode (qa S5): a chapter dropped by a count change does NOT come back after a dock-return (the listen stash is filtered too)', async () => {
  const v1 = { id: 'v1', type: 'video', title: 'A Long Talk', channelName: 'Someone', duration: 180, chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 60, title: 'Middle Part' }, { startTime: 120, title: 'Outro Ghost' }], liked: false, watchState: 'unwatched' };
  await boot(async (dom, ctx) => {
    await settleN(8);
    const menu = await openDesktopActions(dom);
    const row = snapRow(menu);
    assert.ok(row, 'the listen chapter offers "This chapter starts wrong"');
    click(dom, row);
    await settleN(2);
    assert.match(doc(dom).getElementById('music-nowplaying-panel').textContent, /Outro Ghost/, 'precondition: three listen chapters queued');
    ctx.editor[0].opts.onSaved({ chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 60, title: 'Middle Part' }], chaptersSource: 'embedded', chaptersEdited: false });
    await settleN(4);
    assert.doesNotMatch(doc(dom).getElementById('music-nowplaying-panel').textContent, /Outro Ghost/, 'gone from the live queue');
    // Dock-return: the view re-inits and restores the listen queue FROM THE STASH.
    ctx.registered.destroy();
    dom.reconfigure({ url: 'http://localhost/music?nowplaying=1' });
    ctx.registered.init(ctx.root);
    await settleN(12);
    assert.match(doc(dom).getElementById('music-nowplaying-panel').textContent, /Middle Part/, 'the restored queue is there (non-vacuous)');
    assert.doesNotMatch(doc(dom).getElementById('music-nowplaying-panel').textContent, /Outro Ghost/, 'the dropped chapter did not come back from the stash');
  }, { desktop: true, playId: 'v1', listen: true, videos: { v1 } });
});

// ---- (3) the watch page chapters menu ------------------------------------------------
// This repo has no player-boot jsdom harness (CONTRIBUTING.md); the REAL-browser
// reachability of "Fix chapter times..." is measured by scripts/chapter-snap-probe.js
// (it opens the menu and clicks the entry in headless Chromium). What is bound here,
// by the SEMANTIC unit (each function body, brace-matched, never a character window):
// the entry is appended ONLY inside the playerCanModifyLibrary arm, it opens the ONE
// editor on the loaded item at the playhead's chapter, and a save re-derives the menu
// and drops the armed loop (the boundaries moved).
test('watch (3): the menu entry sits inside the write-RBAC arm and opens the ONE editor through the shared save seam', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  // Comments stripped ONCE at read (the comment-porous lock lesson: a commented-out call
  // must not satisfy a lock) - block comments, then line comments.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, pre) => pre);
  const blockFrom = (start) => {
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    return assert.fail('unbalanced block at ' + start);
  };
  const bodyOf = (name) => {
    const start = src.indexOf('function ' + name + '(');
    assert.notStrictEqual(start, -1, name + ' exists');
    return blockFrom(start);
  };
  const build = bodyOf('buildChaptersMenu');
  const armAt = build.indexOf('if (playerCanModifyLibrary) {');
  assert.notStrictEqual(armAt, -1, 'the write-RBAC arm exists');
  const arm = blockFrom(src.indexOf(build) + armAt);
  assert.match(arm, /appendChapterSnapEntry\(\);/, 'the entry is appended INSIDE the arm');
  assert.strictEqual((build.match(/appendChapterSnapEntry\(\)/g) || []).length, 1, 'and nowhere else in the builder');
  const entry = bodyOf('appendChapterSnapEntry');
  assert.match(entry, /currentChapters\.length < 2/, 'only for a real chapter list');
  assert.match(entry, /addEventListener\('click', openChapterSnapFromMenu\)/);
  const open = bodyOf('openChapterSnapFromMenu');
  assert.match(open, /window\.showChapterSnapEditor\(currentId, \{/, 'the ONE editor, on the loaded item');
  assert.match(open, /applySavedChapters\(resolved\);/, 'a save goes through the shared seam (its EFFECT is bound behaviorally in chapter-snap-watch.test.js)');
  assert.match(bodyOf('applySavedChapters'), /applyChaptersForMedia\(data\);/, 'which is applyChaptersForMedia');
  assert.match(bodyOf('appendChaptersEditedBadge'), /currentData\.chaptersEdited === true/, 'the badge reads the server flag');
});
