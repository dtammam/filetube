'use strict';

// [UNIT] v1.388.0 (plan 2026-10-12-sticker-sheet): the sticker is a FileTube bottom sheet with the daily controls first.
// The engine level (skin-surface.js with a hand-built sticker config), so every hook the view supplies can be set per
// test. Binds, one by one: the tile grid's FIXED order and R1 (a tile that does not apply is dimmed in place, never
// removed), the Chapters tile (the existing editor, chaptered track + modify rights), R2 (Like says what it will like),
// R3 (an off-default tile is selected), the Speed strip, a dispatch per tile, the Skin page (search, Recent, groups, one
// line per row), R5 (the swatch), R7 (Download: the app's offline tile, the web's browser download), the Bold relabel with the
// stored value untouched, the skin tint, the activation guard, and the desktop /music actions menu rendering exactly as
// it did on main 35bbccdf.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const SS = require('../helpers/sticker-sheet.js');
const { readStyleCss, cssRules } = require('../helpers/stylesheets.js');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const SKINS = require(skinsPath);

const HTML = `<body>
  <video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" />
  <div id="panel" class="music-nowplaying-panel" hidden></div>
</body>`;
const settle = () => new Promise((r) => setImmediate(r));
const rows = () => [0, 1, 2, 3, 4].map((i) => ({ index: i, title: 'T' + i, artist: 'A', durLabel: '3:00', state: i < 2 ? 'played' : (i === 2 ? 'current' : 'next') }));

// o: { sticker (hooks merged over the defaults), ctx (merged over the track ctx), skin, video (the /api/videos payload) }
function bootSheet(o) {
  o = o || {};
  const dom = new JSDOM(HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, fetch: global.fetch, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  const spy = { loop: [], skinChange: 0, taps: [], toasts: [], calls: [], shuffle: 0, chaptersDocs: [] };
  const state = { loop: false, shuffle: false, chapter: false };
  SS.installUi(dom);
  dom.window.showToast = (m) => spy.toasts.push(String(m));
  dom.window.fetchCurrentUser = () => Promise.resolve({ user: { role: o.admin === false ? 'member' : 'admin' } });
  dom.window.fetchLikedTotal = () => Promise.resolve(0);
  dom.window.shareMediaFile = (x) => { spy.taps.push(['shareFile', x.url]); return Promise.resolve('shared'); };
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  global.fetch = (url, init) => {
    const u = String(url); const method = (init && init.method) || 'GET';
    spy.calls.push(method + ' ' + u);
    if (/^\/api\/videos\/s1$/.test(u) && method === 'GET') {
      const body = Object.assign({ id: 's1', title: 'Song One', watchUrl: undefined, liked: false, watchState: 'unwatched', chapters: [] }, o.video || {});
      return Promise.resolve({ ok: true, json: async () => body });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };
  const ctx = Object.assign({
    track: { title: 'Midnight City', artist: 'M83', album: 'Hurry Up', artUrl: '/albumart/x' },
    upNext: rows(), fullList: rows(), playing: false, posSec: 0, durSec: 300, posLabel: '0:00', remLabel: '-5:00', curNum: 4, total: 12,
  }, o.ctx || {});
  const hooks = Object.assign({
    onSkinChange: () => { spy.skinChange += 1; },
    getPlayer: () => ({ isLoopEnabled: () => state.loop, setLoop: (on) => { state.loop = !!on; spy.loop.push(!!on); }, getCurrentTime: () => null, close() {} }),
    isChapterTrack: () => state.chapter,
    shuffle: { enabled: () => state.shuffle, onToggle: () => { state.shuffle = !state.shuffle; spy.shuffle += 1; } },
    extras: { getBaseId: () => 's1', isEligible: () => true, onMutated() {}, signal: new AbortController().signal },
  }, o.sticker || {});
  const engine = dom.window.FileTubeSkinSurface.create({
    panel: dom.window.document.getElementById('panel'),
    getSkinId: () => o.skin || 'ipod',
    getCtx: () => ctx,
    hostCtl: (id) => dom.window.document.getElementById(id),
    onSelectIndex: () => {}, onDock: () => {}, win: dom.window,
    onHome: o.home === false ? undefined : () => { spy.taps.push(['home']); },
    sticker: hooks,
  });
  engine.paint();
  const sticker = () => dom.window.document.querySelector('#panel [data-skin-sticker]');
  return { dom, engine, spy, state, ctx, sticker, restore: () => { try { engine.destroy(); } catch (_) { /* gone */ } global.fetch = saved.fetch; Object.assign(global, { window: saved.window, document: saved.document, Event: saved.Event }); } };
}
async function open(b, rounds) {
  SS.clickEl(b.dom, b.sticker());
  for (let i = 0; i < (rounds || 6); i++) await settle();
  return SS.menuOf(b.dom);
}
const tile = (b, f) => SS.inSheet(b.dom, '[data-skin-' + f + ']');
const off = (el) => el.getAttribute('aria-disabled') === 'true';
const click = (b, el) => SS.clickEl(b.dom, el);
const capOf = (el) => el.querySelector('.mms-ss__cap').textContent;
const lblOf = (el) => el.querySelector('.ui-btn__label').textContent;

// ---- the grid: fixed order, fixed positions (R1) ----------------------------------------------------------------------
test('D2/R1: the grid is 8 tiles in a FIXED order; a chapterless plain song dims Chapters in place instead of removing it', async () => {
  const b = bootSheet({});
  try {
    const m = await open(b);
    const tiles = [...m.querySelectorAll('.mms-ss__tile')];
    assert.deepStrictEqual(tiles.map(lblOf), ['Like', 'Chapters', 'Loop', 'Shuffle', 'Speed', 'Share', 'Download', 'More'], 'Like, Chapters, Loop, Shuffle / Speed, Share, Download, More');
    assert.strictEqual(m.querySelector('.mms-ss__grid').getAttribute('role'), 'group');
    const ch = tile(b, 'chapters');
    assert.ok(off(ch), 'a chapterless track: Chapters is DISABLED in place (aria-disabled), not removed');
    assert.ok(ch.classList.contains('is-unavailable'));
    // every other tile is live (this is not a grid of dimmed tiles passing vacuously)
    for (const f of ['like', 'loop', 'shufflemode', 'speedtoggle', 'share', 'download', 'more']) assert.ok(!off(tile(b, f)), f + ' is live');
    // a tap on the dimmed tile does nothing (no editor hook is even wired here, so the proof is the sheet staying put on page 1)
    click(b, ch);
    assert.ok(SS.isOpen(b.dom) && !SS.menuOf(b.dom).getAttribute('data-sm-page'), 'a tap on it neither closes the sheet nor changes the page');
  } finally { b.restore(); }
});

test('R1: every tile that needs the item or a hook DIMS IN PLACE when it is missing - Like / Share / Download without extras, Shuffle without its hook', async () => {
  const b = bootSheet({ sticker: { extras: undefined, shuffle: undefined } });
  try {
    const m = await open(b);
    assert.strictEqual(m.querySelectorAll('.mms-ss__tile').length, 8, 'still 8 tiles');
    for (const f of ['like', 'share', 'download', 'shufflemode', 'chapters']) assert.ok(off(tile(b, f)), f + ' is dimmed');
    for (const f of ['loop', 'speedtoggle', 'more']) assert.ok(!off(tile(b, f)), f + ' stays live');
  } finally { b.restore(); }
});

// ---- Chapters ------------------------------------------------------------------------------------------------------------
test('Chapters tile (Dean, 2026-10-13: the existing editor): live only on a chaptered track the viewer may edit, "N of M" from the queue, the tap hands the editor THIS document', async () => {
  const seen = [];
  const hook = { visible: () => true, label: () => 'Edit chapters', onTap: (d) => seen.push(d) };
  const b = bootSheet({ sticker: { chapters: hook } });
  try {
    b.state.chapter = true;
    const m = await open(b);
    const ch = tile(b, 'chapters');
    assert.ok(!off(ch), 'chaptered + editable: live');
    assert.strictEqual(capOf(ch), '4 of 12', 'caption: the playing chapter of the whole list');
    click(b, ch);
    assert.strictEqual(seen.length, 1, 'one tap, one editor open');
    assert.strictEqual(seen[0], b.dom.window.document, 'handed this document');
    assert.ok(!SS.isOpen(b.dom), 'the sheet closed');
    assert.ok(m);
  } finally { b.restore(); }
  // a viewer who may not edit (visible() false) on a chaptered track: dimmed, not hidden
  const c = bootSheet({ sticker: { chapters: { visible: () => false, onTap: () => seen.push('no') } } });
  try {
    c.state.chapter = true;
    await open(c);
    assert.ok(off(tile(c, 'chapters')), 'no modify rights: dimmed in place');
    click(c, tile(c, 'chapters'));
    assert.ok(!seen.includes('no'), 'and a tap opens nothing');
  } finally { c.restore(); }
  // chaptered but the view supplies no chapters hook at all: dimmed
  const d = bootSheet({});
  try { d.state.chapter = true; await open(d); assert.ok(off(tile(d, 'chapters')), 'no hook: dimmed'); } finally { d.restore(); }
});

// ---- R2 / R3 ---------------------------------------------------------------------------------------------------------------
test('R2: the Like tile says what it will like - the chapter when the item stamps a chapter target, else the track; Liked once liked', async () => {
  const mk = (extras) => bootSheet({ sticker: { extras: Object.assign({ getBaseId: () => 's1', isEligible: () => true, onMutated() {}, signal: new AbortController().signal }, extras) } });
  const a = mk({ fetchItem: () => ({ id: 's1', title: 'S', liked: false, likeTargetId: 's1::c3' }) });
  try { await open(a); assert.strictEqual(capOf(tile(a, 'like')), 'chapter'); assert.strictEqual(tile(a, 'like').getAttribute('aria-pressed'), 'false'); } finally { a.restore(); }
  const b = mk({ fetchItem: () => ({ id: 's1', title: 'S', liked: false }) });
  try { await open(b); assert.strictEqual(capOf(tile(b, 'like')), 'track'); } finally { b.restore(); }
  const c = mk({ fetchItem: () => ({ id: 's1', title: 'S', liked: true, likeTargetId: 's1::c3' }) });
  try {
    await open(c);
    assert.strictEqual(capOf(tile(c, 'like')), 'Liked', 'liked: the caption says so');
    assert.strictEqual(tile(c, 'like').getAttribute('aria-pressed'), 'true', 'and the tile is selected');
    assert.strictEqual(tile(c, 'like').querySelector('use').getAttribute('href'), '#i-favorite-fill', 'with the filled heart');
  } finally { c.restore(); }
});

test('R3: a leftover 1.5x, Loop on and Shuffle on each render their tile SELECTED; the defaults do not', async () => {
  const b = bootSheet({});
  try {
    await open(b);
    for (const f of ['speedtoggle', 'loop', 'shufflemode']) assert.strictEqual(tile(b, f).getAttribute('aria-pressed'), 'false', f + ' off by default');
    // flip each through its real control
    click(b, tile(b, 'loop')); click(b, tile(b, 'shufflemode'));
    click(b, tile(b, 'speedtoggle')); click(b, SS.inSheet(b.dom, '[data-skin-speed="1.5"]'));
    assert.strictEqual(tile(b, 'loop').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(tile(b, 'shufflemode').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(tile(b, 'speedtoggle').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(tile(b, 'speedtoggle').querySelector('.mms-ss__glyph').textContent, '1.5×', 'the glyph is the rate');
    assert.strictEqual(capOf(tile(b, 'loop')), 'On');
    assert.strictEqual(capOf(tile(b, 'shufflemode')), 'On');
    // back to 1x: the tile is no longer selected
    click(b, tile(b, 'speedtoggle')); click(b, SS.inSheet(b.dom, '[data-skin-speed="1"]'));
    assert.strictEqual(tile(b, 'speedtoggle').getAttribute('aria-pressed'), 'false');
    assert.strictEqual(tile(b, 'speedtoggle').querySelector('.mms-ss__glyph').textContent, '1×');
  } finally { b.restore(); }
});

test('Speed strip: 8 pills in ONE horizontally scrolling row directly under the grid, the current one selected; a rate closes it and sets the element', async () => {
  const b = bootSheet({});
  try {
    const m = await open(b);
    const strip = m.querySelector('.mms-ss__strip');
    assert.ok(strip.hidden, 'closed at first');
    assert.strictEqual(strip.previousElementSibling, m.querySelector('.mms-ss__grid'), 'directly under the grid');
    click(b, tile(b, 'speedtoggle'));
    const open2 = SS.menuOf(b.dom).querySelector('.mms-ss__strip');
    assert.ok(!open2.hidden);
    const pills = [...open2.querySelectorAll('.ui-chip--filter')];
    assert.strictEqual(pills.length, 8);
    assert.deepStrictEqual(pills.map((p) => p.getAttribute('aria-pressed')), ['false', 'false', 'false', 'true', 'false', 'false', 'false', 'false'], 'only 1x selected');
    const mp = b.dom.window.document.getElementById('media-player');
    click(b, SS.inSheet(b.dom, '[data-skin-speed="0.75"]'));
    assert.strictEqual(mp.playbackRate, 0.75);
    assert.strictEqual(mp.defaultPlaybackRate, 0.75, 'and defaultPlaybackRate (the survives-a-load carry)');
    assert.ok(SS.menuOf(b.dom).querySelector('.mms-ss__strip').hidden, 'the pick closed the strip');
  } finally { b.restore(); }
});

// ---- a dispatch per tile ---------------------------------------------------------------------------------------------------
test('every tile dispatches through its existing handler: Loop, Shuffle, Speed, Like, Share, Download, More', async () => {
  const b = bootSheet({ video: { watchUrl: 'https://www.youtube.com/watch?v=x' } });
  b.dom.window.showChoiceModal = (title, opts) => { b.spy.taps.push(['choice', opts.map((x) => x.label).join('|')]); return () => {}; };
  try {
    await open(b);
    click(b, tile(b, 'loop'));
    assert.deepStrictEqual(b.spy.loop, [true], 'Loop -> player.setLoop(true)');
    click(b, tile(b, 'shufflemode'));
    assert.strictEqual(b.spy.shuffle, 1, 'Shuffle -> the view hook once');
    click(b, tile(b, 'like'));
    await settle(); await settle();
    assert.ok(b.spy.calls.includes('POST /api/liked/s1'), 'Like -> the media-store write');
    const dl = tile(b, 'download');
    assert.strictEqual(dl.tagName, 'A', 'web Download is a link');
    assert.strictEqual(dl.getAttribute('href'), '/video/s1?download=1');
    assert.ok(dl.hasAttribute('download'));
    click(b, tile(b, 'more'));
    assert.strictEqual(SS.menuOf(b.dom).getAttribute('data-sm-page'), 'more', 'More -> the More page');
    click(b, SS.inSheet(b.dom, '[data-skin-extras-back]'));
    click(b, tile(b, 'share'));
    await settle();
    assert.deepStrictEqual(b.spy.taps.filter((t) => t[0] === 'choice'), [['choice', 'Share file|Share link']], 'Share -> the shared Share flow (a source link exists, so file + link)');
  } finally { b.restore(); }
});

// ---- capabilities: a media type that offers a SUBSET (podcasts) draws only that subset -----------------------------------------
test('capabilities: a subset (share + like only) dims Download in place and leaves More with none of the rows the type does not offer', async () => {
  const b = bootSheet({ sticker: { extras: { getBaseId: () => 's1', isEligible: () => true, onMutated() {}, signal: new AbortController().signal, capabilities: ['share', 'like'], fetchItem: () => ({ id: 's1', title: 'Ep', liked: false, watchState: 'unwatched', hasSubtitles: true, watchUrl: 'https://x.test/v' }) } } });
  try {
    await open(b);
    assert.ok(!off(tile(b, 'share')) && !off(tile(b, 'like')), 'the offered tiles are live');
    assert.ok(off(tile(b, 'download')), 'Download is not offered: dimmed in place, not removed');
    click(b, tile(b, 'more'));
    for (const gone of ['watched', 'queue', 'queue-next', 'transcript', 'reheat', 'move', 'delete', 'chapters', 'chapter-snap']) {
      assert.strictEqual(SS.menuOf(b.dom).querySelector('[data-skin-x="' + gone + '"]'), null, gone + ' is not offered by this type');
    }
  } finally { b.restore(); }
});

// ---- the header (R4) ---------------------------------------------------------------------------------------------------------
test('D1/R4: the header shows the playing item (art, one-line title, meta) with Home and Go to channel as icon buttons, only where they apply; Close sits last', async () => {
  const b = bootSheet({ sticker: { channel: { visible: () => true, onTap: () => b.spy.taps.push(['channel']) } } });
  try {
    await open(b);
    const head = SS.inSheet(b.dom, '.ui-sheet__header');
    assert.strictEqual(head.querySelector('.mms-ss__t').textContent, 'Midnight City');
    assert.strictEqual(head.querySelector('.mms-ss__m').textContent, 'M83 · Hurry Up');
    assert.ok(head.querySelector('.ui-avatar, .ui-art'), 'art');
    assert.ok(head.querySelector('[data-skin-home][aria-label="Home"]'));
    assert.ok(head.querySelector('[data-skin-channel][aria-label="Go to channel"]'));
    const last = head.lastElementChild;
    assert.ok(last.classList.contains('ui-sheet__close'), 'Close is the last control');
    click(b, head.querySelector('[data-skin-channel]'));
    assert.deepStrictEqual(b.spy.taps.filter((t) => t[0] === 'channel'), [['channel']]);
    assert.ok(!SS.isOpen(b.dom), 'the tap closed the sheet on its way out');
  } finally { b.restore(); }
  const c = bootSheet({ home: false });
  try {
    await open(c);
    const head = SS.inSheet(c.dom, '.ui-sheet__header');
    assert.strictEqual(head.querySelector('[data-skin-home]'), null, 'no onHome hook: no Home button');
    assert.strictEqual(head.querySelector('[data-skin-channel]'), null, 'no channel hook: no channel button');
  } finally { c.restore(); }
});

// ---- the Skin page --------------------------------------------------------------------------------------------------------
test('D5: the Skin page - search filters as you type, Recent holds the active skin first then the last picks (4 at most), groups are the registry\'s own, rows drop the line name', async () => {
  const b = bootSheet({});
  try {
    b.dom.window.localStorage.setItem('ft-music-skin', 'ipod');
    b.dom.window.localStorage.setItem('ft-sticker-recent-skins', JSON.stringify(['ipod-black', 'ipod-silver', 'apple', 'spotify', 'ipod-gold', 'ipod-red']));
    await open(b);
    click(b, tile(b, 'more')); click(b, SS.inSheet(b.dom, '[data-skin-extras-back]'));
    click(b, SS.inSheet(b.dom, '[data-skin-skins]'));
    const m = SS.menuOf(b.dom);
    assert.strictEqual(m.getAttribute('data-sm-page'), 'skins');
    assert.ok(m.querySelector('input[type="search"]'), 'a search field');
    const recent = [...m.querySelectorAll('.mms-ss__chips [data-skin-pick]')].map((c) => c.getAttribute('data-skin-pick'));
    assert.deepStrictEqual(recent, ['ipod', 'ipod-black', 'ipod-silver', 'apple'], 'the active skin first, then the last picks, 4 in all');
    assert.strictEqual(m.querySelector('.mms-ss__chips [data-skin-pick="ipod"]').getAttribute('aria-pressed'), 'true');
    const fams = SKINS.skinFamilies();
    const groups = [...m.querySelectorAll('.mms-ss__grp')];
    assert.deepStrictEqual(groups.map((g) => g.querySelector('.mms-ss__h').textContent), fams.map((f) => f.label), 'the groups ARE skinFamilies() (SKIN_LINES)');
    const all = [...m.querySelectorAll('.ui-row[data-skin-pick]')];
    assert.strictEqual(all.length, SKINS.SKINS.length, 'every registered skin is a row, once');
    const lbl = (id) => m.querySelector('.ui-row[data-skin-pick="' + id + '"] .ui-row__title').textContent;
    assert.strictEqual(lbl('ipod'), '5G White · 2005', 'the line name is dropped (the group header says it)');
    assert.strictEqual(lbl('ipod-2004'), '4G White · 2004');
    assert.strictEqual(m.querySelector('.ui-row[data-skin-pick="ipod"]').getAttribute('aria-current'), 'true', 'the active skin is marked');
    assert.ok(m.querySelector('.ui-row[data-skin-pick="ipod"] svg use[href="#i-check"]'), 'with a check');
    assert.strictEqual(m.querySelectorAll('.ui-row[aria-current="true"]').length, 1, 'only the active one');
    // search: type "nano" - only nano rows stay, empty groups hide, Recent steps aside; "zzz" says nothing matches
    const input = m.querySelector('input[type="search"]');
    input.value = 'nano';
    input.dispatchEvent(new b.dom.window.Event('input', { bubbles: true }));
    const shown = all.filter((r) => !r.hidden);
    assert.ok(shown.length > 5 && shown.length < all.length, 'a filtered subset (' + shown.length + ')');
    assert.ok(shown.every((r) => /nano/.test(r.getAttribute('data-label'))), 'every shown row is a Nano');
    assert.ok(groups.filter((g) => g.hidden).length > 0 && groups.filter((g) => !g.hidden).every((g) => /^nano/i.test(g.getAttribute('data-fam'))), 'non-matching groups hide');
    assert.ok(m.querySelector('.mms-ss__recent').hidden, 'Recent steps aside while searching');
    input.value = 'zzzz'; input.dispatchEvent(new b.dom.window.Event('input', { bubbles: true }));
    assert.ok(all.every((r) => r.hidden));
    const none = [...m.querySelectorAll('.mms-ss__note')].find((n) => /No skins match/.test(n.textContent));
    assert.ok(none && !none.hidden, 'the empty state says so');
    input.value = ''; input.dispatchEvent(new b.dom.window.Event('input', { bubbles: true }));
    assert.ok(all.every((r) => !r.hidden) && !m.querySelector('.mms-ss__recent').hidden, 'clearing restores everything');
    // a pick records Recent (active first next time) and closes
    click(b, m.querySelector('.ui-row[data-skin-pick="ipod-gold"]'));
    assert.deepStrictEqual(JSON.parse(b.dom.window.localStorage.getItem('ft-sticker-recent-skins')).slice(0, 2), ['ipod-gold', 'ipod-black'], 'the pick is now the newest');
    assert.strictEqual(b.dom.window.localStorage.getItem('ft-music-skin'), 'ipod-gold');
  } finally { b.restore(); }
});

test('D5: a corrupt or foreign Recent value is ignored (localStorage in try/catch, only registered ids)', async () => {
  const b = bootSheet({});
  try {
    b.dom.window.localStorage.setItem('ft-music-skin', 'ipod');
    b.dom.window.localStorage.setItem('ft-sticker-recent-skins', '{not json');
    await open(b);
    click(b, SS.inSheet(b.dom, '[data-skin-skins]'));
    assert.deepStrictEqual([...SS.menuOf(b.dom).querySelectorAll('.mms-ss__chips [data-skin-pick]')].map((c) => c.getAttribute('data-skin-pick')), ['ipod'], 'only the active skin');
    b.dom.window.localStorage.setItem('ft-sticker-recent-skins', JSON.stringify(['nope', 7, 'apple']));
    click(b, SS.inSheet(b.dom, '[data-skin-extras-back]'));
    click(b, SS.inSheet(b.dom, '[data-skin-skins]'));
    assert.deepStrictEqual([...SS.menuOf(b.dom).querySelectorAll('.mms-ss__chips [data-skin-pick]')].map((c) => c.getAttribute('data-skin-pick')), ['ipod', 'apple'], 'unknown ids dropped');
  } finally { b.restore(); }
});

test('R5: the Skin row carries a swatch of the ACTIVE skin (the Settings picker\'s own .skin-swatch classes, no invented colour), its label and a chevron', async () => {
  const b = bootSheet({});
  try {
    b.dom.window.localStorage.setItem('ft-music-skin', 'ipod-black');
    await open(b);
    const row = SS.inSheet(b.dom, '[data-skin-skins]');
    const sw = row.querySelector('.skin-swatch');
    assert.ok(sw, 'a swatch');
    assert.ok(sw.classList.contains('mms-ipod-black') && sw.classList.contains('mms-ipod'), 'the same classes setup.js skinSwatchClasses draws: ' + sw.className);
    assert.strictEqual(row.querySelector('.ui-row__meta').textContent, SKINS.skinById('ipod-black').label, 'the active label');
    assert.ok(row.querySelector('svg use[href="#i-chevron_right"]'), 'a chevron');
  } finally { b.restore(); }
});

// ---- R7: the Download tile --------------------------------------------------------------------------------------------------
function fakeOffline() {
  const items = {}; const listeners = []; const ran = [];
  const api = {
    enabled: true,
    state: (kind, id) => items[kind + ':' + id] || { state: 'none' },
    menuEntry: (kind, id) => { const s = api.state(kind, id); return s.state === 'done' ? { id: 'offline-remove', label: 'Remove offline copy' } : (['queued', 'downloading'].indexOf(s.state) >= 0 ? { id: 'offline-remove', label: 'Saving' } : { id: 'offline-add', label: 'Make available offline' }); },
    runMenuAction: (act, kind, id) => { ran.push([act, kind, id]); return true; },
    errorCopy: (c) => 'ERR:' + c,
    onChange: (fn) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
  };
  return { api, ran, set: (kind, id, v) => { items[kind + ':' + id] = v; listeners.slice().forEach((f) => f()); }, listeners };
}

test('R7 (the iOS app): the Download tile is the offline save - Save, then a progress ring and percent, Saved, tap removes, Save again; it follows onChange and stops listening when the sheet closes', async () => {
  const off2 = fakeOffline();
  const b = bootSheet({ ctx: {} });
  b.dom.window.FileTube = { offline: off2.api };
  try {
    await open(b);
    let t = tile(b, 'download');
    assert.strictEqual(t.tagName, 'BUTTON', 'in the app it is a button, not the browser download link');
    assert.ok(!t.hasAttribute('href') && !t.hasAttribute('download'));
    assert.strictEqual(capOf(t), 'Save');
    assert.strictEqual(off2.listeners.length, 1, 'subscribed while the sheet is open');
    click(b, t);
    assert.deepStrictEqual(off2.ran, [['offline-add', 'track', 's1']], 'the tap adds through runMenuAction with the base id');
    off2.set('track', 's1', { state: 'downloading', progress: 0.4 });
    t = tile(b, 'download');
    assert.strictEqual(capOf(t), '40%', 'progress text');
    assert.ok(t.querySelector('.mms-ss__ring'), 'a progress ring replaces the glyph');
    assert.strictEqual(t.querySelector('.mms-ss__ring').style.getPropertyValue('--p'), '0.4', 'at 40%');
    assert.strictEqual(t.getAttribute('aria-pressed'), 'true', 'selected while saving');
    off2.set('track', 's1', { state: 'downloading', progress: 0.9 });
    assert.strictEqual(capOf(tile(b, 'download')), '90%', 'the tile follows each change');
    off2.set('track', 's1', { state: 'done' });
    t = tile(b, 'download');
    assert.strictEqual(capOf(t), 'Saved');
    assert.ok(!t.querySelector('.mms-ss__ring'));
    click(b, t);
    assert.deepStrictEqual(off2.ran.pop(), ['offline-remove', 'track', 's1'], 'tapping Saved removes the copy');
    off2.set('track', 's1', { state: 'none' });
    assert.strictEqual(capOf(tile(b, 'download')), 'Save', 'back to Save after the remove');
    off2.set('track', 's1', { state: 'failed', error: 'storageFull' });
    assert.strictEqual(capOf(tile(b, 'download')), 'Retry');
    const note = SS.menuOf(b.dom).querySelector('.mms-ss__note');
    assert.ok(note && note.textContent === 'ERR:storageFull' && note.getAttribute('role') === 'status', 'the failure\'s own words under the grid');
    off2.set('track', 's1', { state: 'none' });
    assert.strictEqual(SS.menuOf(b.dom).querySelector('.mms-ss__note'), null, 'the note clears with the failure');
    await SS.closeSheet(b.dom);
    assert.strictEqual(off2.listeners.length, 0, 'closing the sheet unsubscribes (no listener leaks past the sheet)');
  } finally { b.restore(); }
});

test('R7 (the parent id): a chapter row saves its PARENT file - the id comes from the view\'s base id, never the ::c id', async () => {
  const off2 = fakeOffline();
  const b = bootSheet({ sticker: { extras: { getBaseId: () => 'f9', isEligible: () => true, onMutated() {}, signal: new AbortController().signal } } });
  b.dom.window.FileTube = { offline: off2.api };
  try {
    await open(b);
    click(b, tile(b, 'download'));
    assert.deepStrictEqual(off2.ran, [['offline-add', 'track', 'f9']]);
  } finally { b.restore(); }
});

test('R7 (the plain web): with no offline host the Download tile stays today\'s browser download link, whatever FileTube.offline says', async () => {
  const b = bootSheet({});
  b.dom.window.FileTube = { offline: { enabled: false } };
  try {
    await open(b);
    const t = tile(b, 'download');
    assert.strictEqual(t.tagName, 'A');
    assert.strictEqual(t.getAttribute('href'), '/video/s1?download=1');
    assert.ok(t.hasAttribute('download'));
    assert.strictEqual(capOf(t).trim(), '', 'caption blank');
  } finally { b.restore(); }
});

// ---- the Bold relabel ------------------------------------------------------------------------------------------------------
test('Bold: the third strength SHOWS as Bold on the More page and the LCD menu, the stored value stays "pronounced", and a stored "pronounced" selects Bold', async () => {
  assert.deepStrictEqual(SKINS.LIGHTING_STRENGTHS.map((r) => [r.value, r.label]), [['off', 'Off'], ['subtle', 'Subtle'], ['pronounced', 'Bold'], ['ambient', 'Ambient']]);
  assert.deepStrictEqual(SKINS.menuLightingItems({ strength: 'pronounced' }).map((r) => r.label), ['Off', 'Subtle', 'Bold', 'Ambient'], 'the LCD Settings > Lighting level');
  assert.ok(SKINS.menuLightingItems({ strength: 'pronounced' }).find((r) => r.label === 'Bold').check, 'a stored pronounced is the checked Bold');
  const lightSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'pocket-lighting.js'), 'utf8');
  assert.match(lightSrc, /var STRENGTHS = \['off', 'subtle', 'pronounced', 'ambient'\];/, 'the stored values are untouched');
});

// ---- tint, guard, focus -----------------------------------------------------------------------------------------------------
test('D6: the sheet\'s selected / active states take ONE custom property, --sticker-accent: the skin\'s accent where it defines one (Cider, Nordic), else the app accent', async () => {
  const css = readStyleCss().replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = cssRules(css);
  const one = (sel) => rules.filter((r) => r.sel.replace(/\s+/g, ' ') === sel && !r.at);
  assert.match(one('.mms-ss-root')[0].body, /--sticker-accent:\s*var\(--accent\)/, 'the default is the app accent');
  assert.match(one('.mms-ss-root[data-skin="apple"]')[0].body, /--sticker-accent:\s*var\(--mms-apple-accent\)/);
  assert.match(one('.mms-ss-root[data-skin="spotify"]')[0].body, /--sticker-accent:\s*var\(--mms-sp-accent\)/);
  // every selected / active state reads the property, none paints a skin colour of its own
  for (const sel of ['.mms-ss-root .ui-switch[aria-checked="true"]', '.mms-ss-root .ui-segmented__item[aria-checked="true"]', '.mms-ss-root .ui-chip--filter[aria-pressed="true"]']) {
    const r = one(sel);
    assert.strictEqual(r.length, 1, sel);
    assert.match(r[0].body, /var\(--sticker-accent\)/, sel + ' reads the tint');
  }
  assert.ok(rules.some((r) => r.sel.replace(/\s+/g, ' ').indexOf('.mms-ss-root .mms-ss__tile[aria-pressed="true"]') === 0 && /var\(--sticker-accent\)/.test(r.body)), 'a selected tile reads the tint');
  const b = bootSheet({ skin: 'apple' });
  try { await open(b); assert.strictEqual(SS.sheetOf(b.dom).getAttribute('data-skin'), 'apple', 'the sheet names the skin the CSS keys on'); } finally { b.restore(); }
});

test('LESSONS 4: a pointer click inside the activation window (the second tap of the double tap that opened the sheet) answers nothing; a later one does', async () => {
  const b = bootSheet({});
  try {
    await open(b);
    const early = new b.dom.window.MouseEvent('click', { bubbles: true, detail: 1 });
    // the sheet opened a moment ago: a REAL pointer click (detail 1) on a tile is the double tap's second tap
    tile(b, 'loop').dispatchEvent(early);
    assert.deepStrictEqual(b.spy.loop, [], 'refused inside the window');
    await new Promise((r) => setTimeout(r, b.dom.window.ui.ACTIVATION_GUARD_MS + 60));
    tile(b, 'loop').dispatchEvent(new b.dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
    assert.deepStrictEqual(b.spy.loop, [true], 'answered once the window has passed');
  } finally { b.restore(); }
});

test('focus: closing the sheet returns focus to the sticker (ui.sheet\'s opener), Escape closes, and the sticker\'s aria-expanded follows', async () => {
  const b = bootSheet({});
  try {
    b.sticker().focus();
    await open(b);
    assert.strictEqual(b.sticker().getAttribute('aria-expanded'), 'true');
    b.dom.window.document.dispatchEvent(new b.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!SS.isOpen(b.dom));
    assert.strictEqual(b.sticker().getAttribute('aria-expanded'), 'false');
    await new Promise((r) => setTimeout(r, 400)); // the sheet finishes its exit and hands focus back
    assert.strictEqual(b.dom.window.document.activeElement, b.sticker(), 'focus is back on the sticker');
  } finally { b.restore(); }
});

test('the sheet is bound to the view\'s signal: aborting it (a nav away) closes the sheet', async () => {
  const ac = new AbortController();
  const b = bootSheet({ sticker: { extras: { getBaseId: () => 's1', isEligible: () => true, onMutated() {}, signal: ac.signal } } });
  try {
    await open(b);
    assert.ok(SS.isOpen(b.dom));
    ac.abort();
    assert.ok(!SS.isOpen(b.dom), 'closed with the view');
  } finally { b.restore(); }
});

// ---- the desktop /music actions menu is NOT the sticker ---------------------------------------------------------------------
test('the desktop /music actions menu (buildExtrasHtml through createExtrasMenu) renders EXACTLY as on main 35bbccdf', async () => {
  const dom = new JSDOM('<body><div id="m" class="mms-sticker-menu"></div></body>', { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, fetch: global.fetch };
  global.window = dom.window; global.document = dom.window.document;
  dom.window.fetchCurrentUser = () => Promise.resolve({ user: { role: 'admin' } });
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const item = { id: 's1', title: 'Song One', watchUrl: 'https://www.youtube.com/watch?v=x', hasSubtitles: true, liked: true, watchState: 'unwatched', chapters: [{ startTime: 0, title: 'A' }], chapterSnapIndex: 0 };
  global.fetch = () => Promise.resolve({ ok: true, json: async () => item });
  try {
    const menu = dom.window.document.getElementById('m');
    menu.removeAttribute('hidden');
    const EM = dom.window.FileTubeSkinSurface.createExtrasMenu({
      getMenuEl: () => menu, getBaseId: () => 's1', getPlayer: () => null, getSignal: () => null, close() {},
      backHtml: () => '', // the desktop menu is ONE page: music.js passes no Back chrome
      stillOnPage: () => true, onRendered() {}, onMutated() {},
      hasWatchBack: () => true, hasChannel: () => true, onWatch() {}, onChannel() {}, onChapterSnap() {}, onChapters() {},
    });
    EM.open();
    for (let i = 0; i < 8; i++) await settle();
    const golden = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'desktop-actions-menu-v1.387.3.html'), 'utf8').replace(/\n$/, '');
    assert.strictEqual(menu.innerHTML, golden, 'byte-identical to the markup main 35bbccdf drew for the same item (the fixture was captured from main)');
  } finally { global.fetch = saved.fetch; Object.assign(global, { window: saved.window, document: saved.document }); }
});
