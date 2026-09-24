'use strict';

// [UNIT] POCKET MENUS (Dean 2026-09-24). The pure half (music-skins.js: the registry's
// `menus` field, static levels, payload builders, the list window, the two screen renderers) and
// the controller inside the shared engine (skin-surface.js createPocketMenu, driven through the
// REAL engine create()/paint()/click/gesture path with a stub data source). The real-data drive
// (a real server + the real music.js view) is test/integration/music-pocket-menus.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const skins = require(skinsPath);

const artFor = (id, explicit) => explicit || ('/albumart/' + encodeURIComponent(id));

// ---------------------------------------------------------------- the registry
test('registry census: a skin carries `menus` exactly when its screen is an LCD (Click x3 + Seattle), never Cider/Nordic', () => {
  const CTX = { track: { title: 'T', artist: 'A' }, upNext: [], fullList: [], playing: true };
  for (const s of skins.SKINS) {
    const lcd = /class="ip-lcd"/.test(skins.renderFull(s.id, CTX));
    assert.strictEqual(!!s.menus, lcd, `${s.id}: menus present <=> it draws an LCD`);
  }
  assert.deepStrictEqual(skins.IDS.map((id) => skins.menuStyle(id)), ['', '', 'click', 'click', 'click', 'seattle']);
  assert.strictEqual(skins.menuStyle('bogus'), '', 'an unknown id normalizes to the default (Cider): no menus');
});

// ---------------------------------------------------------------- static levels
test('static levels: Main Menu (Now Playing only while a track exists), Music in the iPod order, Playlists with Liked', () => {
  const lbl = (rows) => rows.map((r) => r.label);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'main' }, { hasCurrent: true })), ['Music', 'Shuffle Songs', 'Now Playing']);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'main' }, { hasCurrent: false })), ['Music', 'Shuffle Songs'], 'nothing playing: no Now Playing row');
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'music' })), ['Playlists', 'Artists', 'Albums', 'Songs', 'Genres']);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'playlists' })), ['Liked Songs', 'Recently Added', 'Recently Played']);
  assert.strictEqual(skins.menuStaticItems({ type: 'artists' }), null, 'a library level is not static');
  assert.deepStrictEqual(skins.menuPivots('seattle').map((p) => p.type), ['artists', 'albums', 'songs', 'playlists', 'genres']);
  assert.deepStrictEqual(skins.menuPivots('click'), [], 'Click has no pivots');
  assert.strictEqual(skins.menuTitle({ type: 'main' }, 'click'), 'Click');
  assert.strictEqual(skins.menuTitle({ type: 'main' }, 'seattle'), 'Seattle');
  assert.strictEqual(skins.menuTitle({ type: 'album', label: 'Night Drive' }, 'click'), 'Night Drive');
});

// ---------------------------------------------------------------- builders
test('builders: artists (avatar wins, else the first album art), albums, songs (index into the level\'s tracks, explicit art wins)', () => {
  const ar = skins.menuArtistItems([{ artist: 'Tonzak', artIds: ['nd1'], avatarUrl: '' }, { artist: 'NESTALGIA', artIds: ['rm1'], avatarUrl: 'https://yt/av.jpg' }, { artist: '', artIds: [] }], artFor);
  assert.deepStrictEqual(ar.map((r) => [r.label, r.node.type, r.node.key, r.art]), [
    ['Tonzak', 'artist', 'Tonzak', '/albumart/nd1'], ['NESTALGIA', 'artist', 'NESTALGIA', 'https://yt/av.jpg'], ['Unknown Artist', 'artist', '', ''],
  ]);
  const al = skins.menuAlbumItems([{ album: 'Night Drive', artist: 'Tonzak', albumKey: 'Tonzak\u0000Night Drive', artId: 'nd1' }, { album: '', albumKey: 'Z\u0000', artId: 'z1' }], artFor);
  assert.deepStrictEqual(al.map((r) => [r.label, r.sub, r.node.key, r.art]), [['Night Drive', 'Tonzak', 'Tonzak\u0000Night Drive', '/albumart/nd1'], ['Unknown Album', '', 'Z\u0000', '/albumart/z1']]);
  const so = skins.menuSongItems([{ id: 'a', title: 'One', artist: 'X' }, { id: 'mix::c1', title: 'Two', artUrl: '/thumbnail/mix' }], artFor);
  assert.deepStrictEqual(so.map((r) => [r.id, r.trackIndex, r.song, r.art]), [['a', 0, true, '/albumart/a'], ['mix::c1', 1, true, '/thumbnail/mix']]);
});

test('an artist\'s level groups their tracks by album (first-seen order) and leads with All Songs only for 2+ albums', () => {
  const t = [
    { id: 'm::c0', album: 'Mix', albumKey: 'N\u0000Mix' }, { id: 'm::c1', album: 'Mix', albumKey: 'N\u0000Mix' },
    { id: 'r1', album: 'Retro', albumKey: 'N\u0000Retro' },
  ];
  const rows = skins.menuArtistAlbumItems(t, { key: 'N', label: 'N' }, artFor);
  assert.deepStrictEqual(rows.map((r) => r.label), ['All Songs', 'Mix', 'Retro']);
  assert.deepStrictEqual(rows[0].node, { type: 'artistAll', artist: 'N', label: 'N' });
  assert.deepStrictEqual(rows[1].node, { type: 'artistAlbum', key: 'N\u0000Mix', artist: 'N', label: 'Mix' });
  const one = skins.menuArtistAlbumItems([t[2]], { key: 'N', label: 'N' }, artFor);
  assert.deepStrictEqual(one.map((r) => r.label), ['Retro'], 'one album: no All Songs row');
  assert.deepStrictEqual(skins.tracksOfAlbum(t, 'N\u0000Mix').map((x) => x.id), ['m::c0', 'm::c1']);
});

test('genres: distinct trimmed tags in name order, untagged gathered under Unknown Genre (last), Genre > Songs filter', () => {
  const t = [{ id: 1, genre: ' synthwave ' }, { id: 2, genre: 'Music' }, { id: 3, genre: '' }, { id: 4 }, { id: 5, genre: 'Synthwave2' }, { id: 6, genre: 'Music' }];
  const rows = skins.menuGenreItems(t);
  assert.deepStrictEqual(rows.map((r) => r.label), ['Music', 'synthwave', 'Synthwave2', 'Unknown Genre']);
  assert.deepStrictEqual(rows[3].node, { type: 'genre', key: '', label: 'Unknown Genre' });
  assert.deepStrictEqual(skins.tracksOfGenre(t, 'Music').map((x) => x.id), [2, 6]);
  assert.deepStrictEqual(skins.tracksOfGenre(t, '').map((x) => x.id), [3, 4]);
  assert.deepStrictEqual(skins.menuGenreItems([{ genre: 'Rock' }]).map((r) => r.label), ['Rock'], 'no untagged tracks: no Unknown row');
});

// ---------------------------------------------------------------- the list window
test('menuWindow: only the rows near the viewport render; with no layout, a fixed span that always holds the cursor', () => {
  const w = skins.menuWindow(5000, 0, 34, 34 * 1000, 238, 8); // scrolled to row 1000, 7 rows tall
  assert.deepStrictEqual(w, { start: 992, end: 1015 });
  const nl = skins.menuWindow(5000, 3000, 0, 0, 0);
  assert.ok(nl.start <= 3000 && nl.end > 3000, 'no layout: the cursor row is inside the window');
  assert.strictEqual(nl.end - nl.start, 40, 'a bounded span, never the whole list');
  assert.deepStrictEqual(skins.menuWindow(5000, 4999, 0, 0, 0), { start: 4960, end: 5000 }, 'clamped at the end');
  assert.deepStrictEqual(skins.menuWindow(3, 0, 34, 0, 238), { start: 0, end: 3 }, 'a short list renders whole');
  assert.deepStrictEqual(skins.menuWindow(0, 0, 0, 0, 0), { start: 0, end: 0 });
});

// ---------------------------------------------------------------- the renderers
test('renderMenuList: escaped labels, chevrons on drill rows (Click only), the playing mark, pads that hold the scroll height', () => {
  const items = [{ label: '<img src=x onerror=alert(1)>', node: { type: 'album' } }, { label: 'Song', id: 's1', song: true, sub: 'Artist' }];
  const html = skins.renderMenuList({ style: 'click', items, cursor: 1, currentId: 's1', start: 0, end: 2, rowH: 34, state: 'ready' });
  const dom = new JSDOM('<div id="h">' + html + '</div>');
  const h = dom.window.document.getElementById('h');
  assert.ok(!h.querySelector('img[onerror]'), 'a label can never inject markup');
  const rows = h.querySelectorAll('.ipm-row');
  assert.ok(rows[0].querySelector('.ipm-chev') && !rows[1].querySelector('.ipm-chev'), 'the chevron marks drill-in rows only');
  assert.ok(rows[1].classList.contains('is-cursor') && rows[1].getAttribute('aria-selected') === 'true');
  assert.ok(rows[1].classList.contains('is-current') && rows[1].querySelector('.ipm-now svg'), 'the playing row carries the speaker glyph (SVG, never an emoji)');
  assert.strictEqual(rows[1].getAttribute('data-skin-mi'), '1', 'rows carry their ABSOLUTE index');
  const win = skins.renderMenuList({ style: 'click', items: new Array(100).fill(0).map((_, i) => ({ label: 'r' + i })), cursor: 50, start: 40, end: 60, rowH: 34, state: 'ready' });
  const d2 = new JSDOM('<div id="h">' + win + '</div>').window.document;
  const pads = d2.querySelectorAll('.ipm-pad');
  assert.strictEqual(pads[0].style.height, (40 * 34) + 'px');
  assert.strictEqual(pads[1].style.height, (40 * 34) + 'px');
  assert.strictEqual(d2.querySelectorAll('.ipm-row').length, 20, 'only the window is in the DOM');
  const sea = skins.renderMenuList({ style: 'seattle', items, cursor: 0, start: 0, end: 2, rowH: 0, state: 'ready' });
  assert.ok(!/ipm-chev/.test(sea), 'Seattle draws no chevrons (Zune lists never did)');
  assert.match(sea, /class="ipm-sub">Artist</, 'Seattle shows the sub-line');
  assert.strictEqual((skins.renderMenuList({ state: 'loading', items: [] }).match(/class="ipm-row ipm-skel"/g) || []).length, 6, 'loading = six skeleton rows');
  assert.match(skins.renderMenuList({ state: 'error', items: [] }), /Couldn.t load/);
  assert.match(skins.renderMenuList({ state: 'empty', items: [], emptyText: 'No artists yet.' }), /No artists yet\./);
});

test('renderMenuView: Click = the split screen (list + art pane); Seattle = pivots leading with the active one (wrapping), a big title when drilled, nothing on the root', () => {
  const base = { items: [{ label: 'A' }], cursor: 0, start: 0, end: 1, rowH: 0, state: 'ready' };
  const click = skins.renderMenuView('click', Object.assign({ title: 'Music', art: '/albumart/x', artIn: true }, base));
  assert.match(click, /class="ip-menuview ipm-click"><div class="ipm-split"><div class="ipm-list"/);
  assert.match(click, /<div class="ipm-art" aria-hidden="true"><img class="ipm-art-img is-in" src="\/albumart\/x"/);
  const piv = skins.renderMenuView('seattle', Object.assign({ title: 'Music', pivots: ['artists', 'albums', 'songs'], pivotIdx: 2 }, base));
  const d = new JSDOM(piv).window.document;
  assert.deepStrictEqual([...d.querySelectorAll('.ipm-pv')].map((b) => [b.textContent, b.getAttribute('data-skin-pivot')]), [['songs', '2'], ['artists', '0'], ['albums', '1']]);
  assert.ok(d.querySelector('.ipm-pv.is-on').textContent === 'songs');
  assert.ok(d.querySelector('[data-skin-swipe]'), 'a pivot level owns the swipe');
  const drilled = skins.renderMenuView('seattle', Object.assign({ title: 'Tonzak', pivots: null }, base));
  assert.match(drilled, /<div class="ipm-title">Tonzak<\/div>/);
  const root = skins.renderMenuView('seattle', Object.assign({ title: 'Seattle', root: true, pivots: null }, base));
  assert.match(root, /ip-menuview ipm-seattle ipm-root/);
  assert.ok(!/ipm-title|ipm-pivots/.test(root), 'the Zune main menu has no header');
});

// ---------------------------------------------------------------- the controller (through the REAL engine)
const HTML = `<body>
  <video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" />
  <div id="panel" class="music-nowplaying-panel" hidden></div>
</body>`;

function bootEngine({ skin, hasCurrent = true, load, noMenu, currentId, dataVersion } = {}) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const spy = { dock: 0, loads: [], plays: [], shuffles: 0, next: 0 };
  const state = { skin: skin || 'ipod', current: currentId || null };
  const menuCfg = {
    load: (node) => { spy.loads.push(node); return load ? load(node) : Promise.resolve({ items: [] }); },
    onPlay: (req) => { spy.plays.push(req); },
    onShuffleAll: () => { spy.shuffles += 1; },
    hasCurrent: () => hasCurrent,
    currentId: () => state.current,
    dataVersion: dataVersion ? () => state.ver : undefined,
  };
  state.ver = 0;
  dom.window.document.getElementById('track-next-btn').addEventListener('click', () => { spy.next += 1; });
  const engine = dom.window.FileTubeSkinSurface.create(Object.assign({
    panel: dom.window.document.getElementById('panel'),
    getSkinId: () => state.skin,
    getCtx: () => ({ track: { title: 'T', artist: 'A', artUrl: '/albumart/now' }, upNext: [], fullList: [], playing: true }),
    hostCtl: (id) => dom.window.document.getElementById(id),
    onSelectIndex: () => {},
    onDock: () => { spy.dock += 1; },
    win: dom.window,
  }, noMenu ? {} : { menu: menuCfg }));
  return { dom, engine, spy, state, restore: () => Object.assign(global, saved) };
}
const P = (b) => b.dom.window.document.getElementById('panel');
const tap = (b, el) => {
  el.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true }));
  el.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true }));
  el.dispatchEvent(new b.dom.window.MouseEvent('click', { bubbles: true }));
};
const pressMenu = (b) => tap(b, P(b).querySelector('[data-skin-menu]'));
const pressSelect = (b) => tap(b, P(b).querySelector('[data-skin-select]'));
const lbls = (b) => [...P(b).querySelectorAll('.ipm-row:not(.ipm-skel) .ipm-lbl')].map((x) => x.textContent);
const tick = () => new Promise((r) => setTimeout(r, 0));

test('opens on Now Playing when something is loaded; with NOTHING loaded the first paint opens on the Main Menu (no Now Playing row)', () => {
  const a = bootEngine({ hasCurrent: true });
  try {
    a.engine.paint();
    assert.ok(!P(a).classList.contains('mms-menumode'));
    assert.strictEqual(a.engine.menuState().screen, 'np');
  } finally { a.restore(); }
  const b = bootEngine({ hasCurrent: false });
  try {
    b.engine.paint();
    assert.ok(P(b).classList.contains('mms-menumode'), 'nothing playing: the Main Menu');
    assert.deepStrictEqual(lbls(b), ['Music', 'Shuffle Songs']);
    assert.strictEqual(P(b).querySelector('.ip-np').textContent, 'Click');
  } finally { b.restore(); }
});

test('MENU: Now Playing -> Main Menu -> (declines) dock; a drilled level pops one at a time', () => {
  const b = bootEngine({});
  try {
    b.engine.paint();
    pressMenu(b); assert.ok(P(b).classList.contains('mms-menumode'));
    pressSelect(b); assert.strictEqual(b.engine.menuState().title, 'Music');
    tap(b, P(b).querySelector('[data-skin-mi="0"]')); assert.strictEqual(b.engine.menuState().title, 'Playlists');
    assert.strictEqual(b.engine.menuState().depth, 3);
    pressMenu(b); assert.strictEqual(b.engine.menuState().title, 'Music');
    pressMenu(b); assert.strictEqual(b.engine.menuState().title, 'Click');
    assert.strictEqual(b.spy.dock, 0);
    pressMenu(b); assert.strictEqual(b.spy.dock, 1, 'the Main Menu\'s MENU is the way out');
  } finally { b.restore(); }
});

test('a view with NO menu source (podcasts) keeps today\'s skin exactly: MENU from Now Playing docks, no menu view ever', () => {
  const b = bootEngine({ noMenu: true });
  try {
    b.engine.paint();
    assert.strictEqual(b.engine.menuState(), null);
    pressMenu(b);
    assert.strictEqual(b.spy.dock, 1, 'MENU docked straight from Now Playing');
    assert.ok(!P(b).querySelector('.ip-menuview') && !P(b).classList.contains('mms-menumode'));
  } finally { b.restore(); }
});

test('a skin with no `menus` (Cider) ignores the menu source entirely', () => {
  const b = bootEngine({ skin: 'apple', hasCurrent: false });
  try {
    b.engine.paint();
    assert.ok(!P(b).querySelector('.ip-menuview'), 'no menu drawn on a skin without an LCD');
    assert.strictEqual(b.engine.menuState().screen, 'menu', 'the controller exists but its style is empty...');
    assert.ok(!P(b).classList.contains('mms-menumode'), '...so nothing toggles');
  } finally { b.restore(); }
});

test('TOCTOU: a level\'s load that lands AFTER the user climbed out never draws over the level now shown', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const b = bootEngine({ load: (node) => node.type === 'artists' ? gate.then(() => ({ items: [{ label: 'LATE' }] })) : Promise.resolve({ items: [] }) });
  try {
    b.engine.paint();
    pressMenu(b); pressSelect(b); // Music
    tap(b, P(b).querySelector('[data-skin-mi="1"]')); // Artists (pending)
    assert.ok(P(b).querySelector('.ipm-skel'), 'the skeleton is up while it loads');
    pressMenu(b); // back to Music before it lands
    release(); await tick(); await tick();
    assert.strictEqual(b.engine.menuState().title, 'Music');
    assert.deepStrictEqual(lbls(b), ['Playlists', 'Artists', 'Albums', 'Songs', 'Genres'], 'the late payload did not paint over Music');
    tap(b, P(b).querySelector('[data-skin-mi="1"]')); await tick();
    assert.strictEqual(b.spy.loads.filter((n) => n.type === 'artists').length, 2, 'a re-entered level loads afresh');
  } finally { b.restore(); }
});

test('destroy() invalidates a late load (no write into a dead surface)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const b = bootEngine({ load: () => gate.then(() => ({ items: [{ label: 'LATE' }] })) });
  try {
    b.engine.paint();
    pressMenu(b); pressSelect(b);
    tap(b, P(b).querySelector('[data-skin-mi="2"]')); // Albums (pending)
    b.engine.destroy();
    const before = P(b).innerHTML;
    release(); await tick(); await tick();
    assert.strictEqual(P(b).innerHTML, before, 'nothing painted after destroy');
  } finally { b.restore(); }
});

test('a song pick hands the view the level\'s TRACKS + the index + the play context, then shows Now Playing; MENU returns to it', async () => {
  const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const play = { ctx: { src: 'music', album: 'K' }, drill: { type: 'album', key: 'K', label: 'Alb' } };
  const b = bootEngine({ load: (n) => Promise.resolve(n.type === 'albums'
    ? { items: [{ label: 'Alb', node: { type: 'album', key: 'K', label: 'Alb' } }] }
    : { items: skins.menuSongItems(tracks, artFor).map((r, i) => Object.assign(r, { label: 'S' + i })), tracks, play }) });
  try {
    b.engine.paint();
    pressMenu(b); pressSelect(b);
    tap(b, P(b).querySelector('[data-skin-mi="2"]')); await tick();
    tap(b, P(b).querySelector('[data-skin-mi="0"]')); await tick();
    tap(b, P(b).querySelector('[data-skin-mi="2"]'));
    assert.strictEqual(b.spy.plays.length, 1);
    assert.strictEqual(b.spy.plays[0].tracks, tracks, 'the level\'s own track array (the real rows)');
    assert.strictEqual(b.spy.plays[0].index, 2);
    assert.strictEqual(b.spy.plays[0].play, play);
    assert.strictEqual(b.engine.menuState().screen, 'np');
    // the view makes 'c' current and repaints: the list follows onto it
    b.state.current = 'c'; b.engine.paint();
    pressMenu(b);
    assert.strictEqual(b.engine.menuState().title, 'Alb');
    assert.strictEqual(b.engine.menuState().cursor, 2);
    // an advance (a new current id at the next paint) moves the playing list's cursor
    b.state.current = 'a'; b.engine.paint();
    assert.strictEqual(b.engine.menuState().cursor, 0, 'the per-advance follow is keyed on the id');
  } finally { b.restore(); }
});

test('a BIG list (5,000 songs) keeps the DOM small, and the wheel/cursor can reach its far end', async () => {
  const tracks = Array.from({ length: 5000 }, (_, i) => ({ id: 't' + i, title: 'Song ' + String(i).padStart(4, '0') }));
  const b = bootEngine({ load: () => Promise.resolve({ items: skins.menuSongItems(tracks, artFor), tracks, play: {} }) });
  try {
    b.engine.paint();
    pressMenu(b); pressSelect(b);
    tap(b, P(b).querySelector('[data-skin-mi="3"]')); await tick(); // Songs
    assert.strictEqual(b.engine.menuState().count, 5000);
    assert.ok(P(b).querySelectorAll('.ipm-row').length <= 40, 'only a window of rows exists: ' + P(b).querySelectorAll('.ipm-row').length);
    // drive the controller's cursor through the SAME entry the wheel's onMove calls
    for (let k = 0; k < 5; k++) {
      const wheel = P(b).querySelector('.ip-wheel');
      const at = (deg) => ({ clientX: 100 * Math.cos(deg * Math.PI / 180), clientY: 100 * Math.sin(deg * Math.PI / 180) });
      wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
      [60, 120, 180, 240, 300].forEach((d) => { const q = at(d); wheel.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: q.clientX, clientY: q.clientY })); });
      wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true }));
    }
    const c = b.engine.menuState().cursor;
    assert.ok(c > 0, 'the wheel moved the menu cursor (cursor mode, not a scrub): ' + c);
    const row = P(b).querySelector('.ipm-row.is-cursor');
    assert.ok(row && row.getAttribute('data-skin-mi') === String(c), 'the cursor row is rendered wherever the cursor goes');
    assert.ok(P(b).querySelectorAll('.ipm-row').length <= 40);
  } finally { b.restore(); }
});

test('the split screen\'s art eases in on the settled row (a decoded image turns on; a failed one is dropped)', async () => {
  const b = bootEngine({ load: () => Promise.resolve({ items: [{ label: 'X', art: '/albumart/x' }, { label: 'Y', art: '/albumart/y' }] }) });
  try {
    b.engine.paint();
    pressMenu(b);
    await new Promise((r) => setTimeout(r, 20));
    let img = P(b).querySelector('.ipm-art .ipm-art-img');
    assert.ok(img && img.getAttribute('src') === '/albumart/now', 'a static menu shows the playing art');
    assert.ok(!img.classList.contains('is-in'), 'not shown until it decodes');
    img.dispatchEvent(new b.dom.window.Event('load'));
    assert.ok(img.classList.contains('is-in'), 'the decoded image eases in');
    pressSelect(b); // Music
    tap(b, P(b).querySelector('[data-skin-mi="2"]')); await tick(); // Albums (the stub rows)
    await new Promise((r) => setTimeout(r, 20));
    img = P(b).querySelector('.ipm-art .ipm-art-img');
    assert.strictEqual(img.getAttribute('src'), '/albumart/x', 'the highlighted item\'s own art');
    img.dispatchEvent(new b.dom.window.Event('load'));
    b.engine.paint(); // a repaint re-draws the same art already ON (no re-fade)
    assert.ok(P(b).querySelector('.ipm-art .ipm-art-img.is-in'), 'the repaint kept the art on');
    // the other axis, on a POPULATED pane: the wheel moves to Y, whose image FAILS - it is
    // dropped (the pane's backdrop shows), never a broken glyph or a stuck invisible frame
    const wheel = P(b).querySelector('.ip-wheel');
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    [8, 16, 24].forEach((d) => wheel.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 100 * Math.cos(d * Math.PI / 180), clientY: 100 * Math.sin(d * Math.PI / 180) })));
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true }));
    assert.strictEqual(b.engine.menuState().cursor, 1, 'the wheel moved to Y');
    await new Promise((r) => setTimeout(r, 200));
    const box = P(b).querySelector('.ipm-art');
    const bad = box.querySelector('.ipm-art-img');
    assert.strictEqual(bad.getAttribute('src'), '/albumart/y', 'the settled row\'s art is the one loading');
    bad.dispatchEvent(new b.dom.window.Event('error'));
    assert.strictEqual(box.querySelector('.ipm-art-img'), null, 'a failed image is dropped');
  } finally { b.restore(); }
});

test('Seattle: pad left/right move the pivots only on a pivot level (elsewhere they still skip tracks); a style change rebuilds the tree', async () => {
  const b = bootEngine({ skin: 'zune-classic', load: (n) => Promise.resolve({ items: [{ label: n.type + '-row', node: { type: 'album', key: n.type } }] }) });
  try {
    b.engine.paint();
    tap(b, P(b).querySelector('[data-skin-next]'));
    assert.strictEqual(b.spy.next, 1, 'Now Playing: a skip');
    pressMenu(b); pressSelect(b); await tick();
    assert.strictEqual(b.engine.menuState().pane, 0);
    assert.deepStrictEqual(lbls(b), ['artists-row']);
    tap(b, P(b).querySelector('[data-skin-next]')); await tick();
    assert.strictEqual(b.spy.next, 1, 'a pivot level: no skip');
    assert.deepStrictEqual(lbls(b), ['albums-row']);
    tap(b, P(b).querySelector('[data-skin-pivot="4"]')); await tick();
    assert.deepStrictEqual(lbls(b), ['genres-row'], 'a pivot tap moves to it');
    tap(b, P(b).querySelector('[data-skin-next]')); await tick();
    assert.deepStrictEqual(lbls(b), ['artists-row'], 'the pivots wrap (the Zune\'s own)');
    tap(b, P(b).querySelector('[data-skin-mi="0"]')); await tick(); // drill in
    tap(b, P(b).querySelector('[data-skin-next]'));
    assert.strictEqual(b.spy.next, 2, 'a drilled (non-pivot) level: the pad skips again');
    // the sticker's skin pick: Seattle -> Click rebuilds the tree for the new style
    b.state.skin = 'ipod'; b.engine.paint();
    assert.strictEqual(b.engine.menuState().depth, 1, 'the stack restarted at the Click Main Menu');
    assert.strictEqual(P(b).querySelector('.ip-np').textContent, 'Click');
  } finally { b.restore(); }
});

test('a library change under the menus (the view bumps dataVersion) re-loads every open library level at the next paint, cursor kept', async () => {
  let n = 0;
  const b = bootEngine({ dataVersion: true, load: () => { n += 1; return Promise.resolve({ items: [{ label: 'v' + n + '-a' }, { label: 'v' + n + '-b' }, { label: 'v' + n + '-c' }] }); } });
  try {
    b.engine.paint();
    pressMenu(b); pressSelect(b);
    tap(b, P(b).querySelector('[data-skin-mi="2"]')); await tick(); // Albums (load #1)
    assert.deepStrictEqual(lbls(b), ['v1-a', 'v1-b', 'v1-c']);
    const wheel = P(b).querySelector('.ip-wheel');
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    [8, 16, 24].forEach((d) => wheel.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 100 * Math.cos(d * Math.PI / 180), clientY: 100 * Math.sin(d * Math.PI / 180) })));
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true }));
    const moved = b.engine.menuState().cursor;
    assert.ok(moved > 0, 'the wheel moved the cursor off the first row');
    b.engine.paint(); await tick();
    assert.strictEqual(n, 1, 'a plain repaint does NOT re-load (no flash-backward)');
    b.state.ver = 1; // a delete / rescan in the view
    b.engine.paint();
    assert.ok(P(b).querySelector('.ipm-skel'), 'the genuinely stale level re-seeds its skeleton');
    await tick();
    assert.strictEqual(n, 2, 're-loaded once');
    assert.deepStrictEqual(lbls(b), ['v2-a', 'v2-b', 'v2-c'], 'the fresh rows');
    assert.strictEqual(b.engine.menuState().cursor, moved, 'the cursor kept its place');
  } finally { b.restore(); }
});
