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
test('registry census: a skin carries `menus` exactly when its screen is an LCD (every Click colorway), never Cider/Nordic', () => {
  const CTX = { track: { title: 'T', artist: 'A' }, upNext: [], fullList: [], playing: true };
  for (const s of skins.SKINS) {
    const lcd = /class="ip-lcd"/.test(skins.renderFull(s.id, CTX));
    assert.strictEqual(!!s.menus, lcd, `${s.id}: menus present <=> it draws an LCD`);
  }
  assert.deepStrictEqual(skins.IDS.map((id) => skins.menuStyle(id)), ['', '', 'click', 'click', 'click', 'click']);
  assert.strictEqual(skins.menuStyle('bogus'), '', 'an unknown id normalizes to the default (Cider): no menus');
});

// ---------------------------------------------------------------- static levels
test('static levels: Main Menu (Now Playing only while a track exists), Music in the iPod order, Playlists with Liked', () => {
  const lbl = (rows) => rows.map((r) => r.label);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'main' }, { hasCurrent: true })), ['Music', 'Settings', 'Shuffle Songs', 'Now Playing']);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'main' }, { hasCurrent: false })), ['Music', 'Settings', 'Shuffle Songs'], 'nothing playing: no Now Playing row');
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'music' })), ['Recent Artists', 'Playlists', 'Artists', 'Albums', 'Songs', 'Genres']);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'playlists' })), ['Liked Songs', 'Recently Added', 'Recently Played']);
  assert.strictEqual(skins.menuStaticItems({ type: 'artists' }), null, 'a library level is not static');
  assert.strictEqual(skins.menuTitle({ type: 'main' }, 'click'), 'Click');
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
test('renderMenuList: escaped labels, chevrons on drill rows, the playing mark, pads that hold the scroll height', () => {
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
  assert.ok(!/ipm-sub/.test(html), 'a row\'s sub-line is never drawn (the Click list is one line)');
  assert.strictEqual((skins.renderMenuList({ state: 'loading', items: [] }).match(/class="ipm-row ipm-skel"/g) || []).length, 6, 'loading = six skeleton rows');
  assert.match(skins.renderMenuList({ state: 'error', items: [] }), /Couldn.t load/);
  assert.match(skins.renderMenuList({ state: 'empty', items: [], emptyText: 'No artists yet.' }), /No artists yet\./);
});

test('renderMenuView: Click = the split screen (list + art pane)', () => {
  const base = { items: [{ label: 'A' }], cursor: 0, start: 0, end: 1, rowH: 0, state: 'ready' };
  const click = skins.renderMenuView('click', Object.assign({ title: 'Music', art: '/albumart/x', artIn: true }, base));
  assert.match(click, /class="ip-menuview ipm-click"><div class="ipm-split"><div class="ipm-lpane"><div class="ipm-list"/);
  assert.match(click, /<div class="ipm-art" aria-hidden="true"><img class="ipm-art-img is-in" src="\/albumart\/x"/);
});

// ---------------------------------------------------------------- the controller (through the REAL engine)
const HTML = `<body>
  <video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" />
  <div id="panel" class="music-nowplaying-panel" hidden></div>
</body>`;

function bootEngine({ skin, hasCurrent = true, load, noMenu, currentId, dataVersion, likedVersion, fastScan, trackListeners, beforeCreate } = {}) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const spy = { dock: 0, loads: [], plays: [], shuffles: 0, next: 0, prev: 0 };
  const state = { skin: skin || 'ipod', current: currentId || null };
  const menuCfg = {
    load: (node) => { spy.loads.push(node); return load ? load(node) : Promise.resolve({ items: [] }); },
    onPlay: (req) => { spy.plays.push(req); },
    onShuffleAll: () => { spy.shuffles += 1; },
    hasCurrent: () => hasCurrent,
    currentId: () => state.current,
    dataVersion: dataVersion ? () => state.ver : undefined,
    likedVersion: likedVersion ? () => state.liked : undefined,
  };
  state.ver = 0; state.liked = 0;
  // listener balance (gate r1 A5): count the panel's own adds/removes from before create()
  const bal = { add: 0, remove: 0 };
  if (trackListeners) {
    const pnl = dom.window.document.getElementById('panel');
    const a0 = pnl.addEventListener.bind(pnl); const r0 = pnl.removeEventListener.bind(pnl);
    pnl.addEventListener = function (t, f, o) { bal.add += 1; return a0(t, f, o); };
    pnl.removeEventListener = function (t, f, o) { bal.remove += 1; return r0(t, f, o); };
  }
  if (beforeCreate) beforeCreate(dom);
  dom.window.document.getElementById('track-next-btn').addEventListener('click', () => { spy.next += 1; });
  dom.window.document.getElementById('track-prev-btn').addEventListener('click', () => { spy.prev += 1; });
  const engine = dom.window.FileTubeSkinSurface.create(Object.assign({
    panel: dom.window.document.getElementById('panel'),
    getSkinId: () => state.skin,
    getCtx: () => ({ track: { title: 'T', artist: 'A', artUrl: '/albumart/now' }, upNext: [], fullList: [], playing: true }),
    hostCtl: (id) => dom.window.document.getElementById(id),
    onSelectIndex: () => {},
    onDock: () => { spy.dock += 1; },
    win: dom.window,
    fastScan: !!fastScan,
  }, noMenu ? {} : { menu: menuCfg }));
  return { dom, engine, spy, state, bal, restore: () => Object.assign(global, saved) };
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
// tap a menu row by its LABEL (the Music level gained Recent Artists at the top in 2026-09-24's
// quick-scroll branch - a label never shifts when a row is added above it)
const tapLabel = (b, label) => {
  const r = [...P(b).querySelectorAll('.ipm-row:not(.ipm-skel)')].find((x) => x.querySelector('.ipm-lbl').textContent === label);
  if (!r) throw new Error('no row ' + label + ' in ' + lbls(b).join('|'));
  tap(b, r);
};
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
    assert.deepStrictEqual(lbls(b), ['Music', 'Settings', 'Shuffle Songs']);
    assert.strictEqual(P(b).querySelector('.ip-np').textContent, 'Click');
  } finally { b.restore(); }
});

test('MENU: Now Playing -> Main Menu -> (declines) dock; a drilled level pops one at a time', () => {
  const b = bootEngine({});
  try {
    b.engine.paint();
    pressMenu(b); assert.ok(P(b).classList.contains('mms-menumode'));
    pressSelect(b); assert.strictEqual(b.engine.menuState().title, 'Music');
    tapLabel(b, 'Playlists'); assert.strictEqual(b.engine.menuState().title, 'Playlists');
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
    tapLabel(b, 'Artists'); // Artists (pending)
    assert.ok(P(b).querySelector('.ipm-skel'), 'the skeleton is up while it loads');
    pressMenu(b); // back to Music before it lands
    release(); await tick(); await tick();
    assert.strictEqual(b.engine.menuState().title, 'Music');
    assert.deepStrictEqual(lbls(b), ['Recent Artists', 'Playlists', 'Artists', 'Albums', 'Songs', 'Genres'], 'the late payload did not paint over Music');
    tapLabel(b, 'Artists'); await tick();
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
    tapLabel(b, 'Albums'); // Albums (pending)
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
    tapLabel(b, 'Albums'); await tick();
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
  } finally { b.restore(); }
});

test('gate r1 K1: an advance NEVER moves the highlight of the list on screen (only its speaker mark); a list off screen follows and re-centres', async () => {
  const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const play = { ctx: { src: 'music', album: 'K' }, drill: { type: 'album', key: 'K', label: 'Alb' } };
  const b = bootEngine({ load: (n) => Promise.resolve(n.type === 'albums'
    ? { items: [{ label: 'Alb', node: { type: 'album', key: 'K', label: 'Alb' } }] }
    : { items: skins.menuSongItems(tracks, artFor).map((r, i) => Object.assign(r, { label: 'S' + i })), tracks, play }) });
  try {
    b.engine.paint();
    pressMenu(b); pressSelect(b);
    tapLabel(b, 'Albums'); await tick(); // Albums
    tap(b, P(b).querySelector('[data-skin-mi="0"]')); await tick(); // Alb
    tap(b, P(b).querySelector('[data-skin-mi="0"]'));               // play 'a'
    b.state.current = 'a'; b.engine.paint();
    pressMenu(b); // back on the list, on 'a'
    // the user parks on row 2 ('c')...
    const wheel = P(b).querySelector('.ip-wheel');
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    [8, 16, 24, 32, 40, 48, 56].forEach((d) => wheel.dispatchEvent(new b.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 100 * Math.cos(d * Math.PI / 180), clientY: 100 * Math.sin(d * Math.PI / 180) })));
    wheel.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true }));
    assert.strictEqual(b.engine.menuState().cursor, 2, 'parked on the last row');
    // ...and the track ends: the queue advances to 'b' with the list ON SCREEN
    b.state.current = 'b'; b.engine.paint();
    assert.strictEqual(b.engine.menuState().cursor, 2, 'the highlight you parked on stays put');
    const cur = P(b).querySelector('.ipm-row.is-current');
    assert.ok(cur && cur.getAttribute('data-skin-mi') === '1' && cur.querySelector('.ipm-now'), 'only the speaker mark moved to the playing row');
    pressSelect(b);
    assert.strictEqual(b.spy.plays[b.spy.plays.length - 1].index, 2, 'Select plays the row you parked on - never the one the advance reached');
    // now Now Playing is up (the list is OFF screen): an advance moves its cursor + re-centres it
    b.state.current = 'c'; b.engine.paint();
    b.state.current = 'a'; b.engine.paint();
    pressMenu(b);
    assert.strictEqual(b.engine.menuState().cursor, 0, 'the off-screen list followed the advance (keyed on the id)');
  } finally { b.restore(); }
});

test('a BIG list (5,000 songs) keeps the DOM small, and the wheel/cursor can reach its far end', async () => {
  const tracks = Array.from({ length: 5000 }, (_, i) => ({ id: 't' + i, title: 'Song ' + String(i).padStart(4, '0') }));
  const b = bootEngine({ load: () => Promise.resolve({ items: skins.menuSongItems(tracks, artFor), tracks, play: {} }) });
  try {
    b.engine.paint();
    pressMenu(b); pressSelect(b);
    tapLabel(b, 'Songs'); await tick(); // Songs
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
    tapLabel(b, 'Albums'); await tick(); // Albums (the stub rows)
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

test('v1.332: on a Click menu level the |<< >>| zones still skip tracks (the device did), and a style change rebuilds the tree', async () => {
  const b = bootEngine({ load: (n) => Promise.resolve({ items: [{ label: n.type + '-row', node: { type: 'album', key: n.type } }] }) });
  try {
    b.engine.paint();
    tap(b, P(b).querySelector('[data-skin-next]'));
    assert.strictEqual(b.spy.next, 1, 'Now Playing: a skip');
    pressMenu(b); pressSelect(b); await tick();
    assert.strictEqual(P(b).querySelector('.ip-np').textContent, 'Music', 'precondition: the Music level is on screen');
    tap(b, P(b).querySelector('[data-skin-next]')); await tick();
    assert.strictEqual(b.spy.next, 2, 'a menu level: >>| skips a track');
    tap(b, P(b).querySelector('[data-skin-prev]')); await tick();
    assert.strictEqual(b.spy.prev, 1, 'a menu level: |<< goes back a track');
    assert.strictEqual(P(b).querySelector('.ip-np').textContent, 'Music', 'and the menu level is unchanged');
    // the sticker's skin pick: a non-pocket skin drops the menus; back on Click the tree restarts
    b.state.skin = 'apple'; b.engine.paint();
    b.state.skin = 'ipod-black'; b.engine.paint();
    assert.strictEqual(b.engine.menuState().depth, 1, 'the stack restarted at the Click Main Menu');
  } finally { b.restore(); }
});

test('a library change under the menus (the view bumps dataVersion) re-loads every open library level at the next paint, cursor kept', async () => {
  let n = 0;
  const b = bootEngine({ dataVersion: true, load: () => { n += 1; return Promise.resolve({ items: [{ label: 'v' + n + '-a' }, { label: 'v' + n + '-b' }, { label: 'v' + n + '-c' }] }); } });
  try {
    b.engine.paint();
    pressMenu(b); pressSelect(b);
    tapLabel(b, 'Albums'); await tick(); // Albums (load #1)
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

// ---------------------------------------------------------------- gate r1 bindings (K5 / K6 / qa S4, S6)
async function openMusic(b) {
  b.engine.paint();
  pressMenu(b); pressSelect(b); await tick();
}
const songLoad = (n) => Promise.resolve({ items: [{ label: n.type + '-row', sub: 'by ' + n.type, id: n.type, song: true, trackIndex: 0 }], tracks: [{ id: n.type }], play: {} });

test('gate r1 A5: destroy() unbinds every panel listener the engine added; a tap after destroy does nothing', async () => {
  const b = bootEngine({ load: songLoad, trackListeners: true });
  try {
    await openMusic(b);
    tapLabel(b, 'Albums'); await tick();
    const row = P(b).querySelector('[data-skin-mi="0"]');
    assert.ok(row, 'precondition: a library level is on screen');
    b.engine.destroy();
    assert.ok(b.bal.add > 0, 'precondition: the engine bound panel listeners (the balance is not vacuous)');
    assert.strictEqual(b.bal.add - b.bal.remove, 0, 'every add was removed (net ' + (b.bal.add - b.bal.remove) + ')');
    tap(b, row);
    assert.strictEqual(b.spy.plays.length, 0, 'a tap on a destroyed surface plays nothing');
  } finally { b.restore(); }
});

test('gate r1 A14: a level load that lands AFTER a newer re-load (the library changed mid-load) never overwrites it', async () => {
  let n = 0; let releaseFirst;
  const first = new Promise((r) => { releaseFirst = r; });
  const b = bootEngine({ dataVersion: true, load: () => { n += 1; const k = n; return k === 1 ? first.then(() => ({ items: [{ label: 'OLD' }] })) : Promise.resolve({ items: [{ label: 'NEW' }] }); } });
  try {
    b.engine.paint();
    pressMenu(b); pressSelect(b);
    tapLabel(b, 'Albums'); // Albums: load #1 in flight
    b.state.ver = 1; b.engine.paint(); await tick(); // the library changed: load #2 lands first
    assert.deepStrictEqual(lbls(b), ['NEW']);
    releaseFirst(); await tick(); await tick();
    assert.deepStrictEqual(lbls(b), ['NEW'], 'the pre-invalidation payload stood down');
  } finally { b.restore(); }
});

test('gate r1 qa S8: a like/unlike (likedVersion) re-loads an open Liked Songs level ONLY', async () => {
  let n = 0;
  const b = bootEngine({ likedVersion: true, load: (node) => { n += 1; return Promise.resolve({ items: [{ label: node.type + (node.key || '') + '-' + n }] }); } });
  try {
    b.engine.paint();
    pressMenu(b); pressSelect(b);
    tapLabel(b, 'Playlists'); // Playlists (static)
    tap(b, P(b).querySelector('[data-skin-mi="0"]')); await tick(); // Liked Songs (load 1)
    assert.deepStrictEqual(lbls(b), ['playlistliked-1']);
    b.state.liked = 1; b.engine.paint(); await tick();
    assert.deepStrictEqual(lbls(b), ['playlistliked-2'], 'the open Liked level re-loaded');
    pressMenu(b); tap(b, P(b).querySelector('[data-skin-mi="1"]')); await tick(); // Recently Added (load 3)
    b.state.liked = 2; b.engine.paint(); await tick();
    assert.deepStrictEqual(lbls(b), ['playlistrecent-added-3'], 'a like does not re-load other levels');
  } finally { b.restore(); }
});

test('gate r1 A1: a list the queue advanced off screen comes back RE-CENTRED on the playing row', async () => {
  const tracks = Array.from({ length: 60 }, (_, i) => ({ id: 't' + i }));
  const b = bootEngine({
    load: () => Promise.resolve({ items: skins.menuSongItems(tracks, artFor).map((r, i) => Object.assign(r, { label: 'S' + i })), tracks, play: {} }),
    beforeCreate: (dom) => {
      // give jsdom a layout: rows 34 px, the list viewport 102 px (three rows)
      Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList && this.classList.contains('ipm-row') ? 34 : 0; } });
      Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.classList && this.classList.contains('ipm-list') ? 102 : 0; } });
    },
  });
  try {
    b.engine.paint();
    pressMenu(b); pressSelect(b);
    tapLabel(b, 'Songs'); await tick(); // Songs
    tap(b, P(b).querySelector('[data-skin-mi="0"]')); // play t0: Now Playing
    b.state.current = 't40'; b.engine.paint(); // the queue advanced 40 rows while the list is off screen
    pressMenu(b);
    const list = P(b).querySelector('.ipm-list');
    assert.strictEqual(b.engine.menuState().cursor, 40);
    assert.strictEqual(list.scrollTop, 40 * 34 - 51 + 17, 'the playing row sits in the middle of the list');
    assert.ok(P(b).querySelector('.ipm-row[data-skin-mi="40"].is-cursor'), 'and it is rendered');
  } finally { b.restore(); }
});

test('gate r1 qa S4 (v1.332, onto Click): on a Click menu level a HOLD on >>| fast-scans the playing song, as on Now Playing', async () => {
  const b = bootEngine({ load: songLoad, fastScan: true });
  try {
    await openMusic(b);
    const mpEl = b.dom.window.document.getElementById('media-player');
    let ct = 100;
    Object.defineProperty(mpEl, 'duration', { configurable: true, get: () => 300 });
    Object.defineProperty(mpEl, 'currentTime', { configurable: true, get: () => ct, set: (v) => { ct = Number(v); } });
    const hold = async () => {
      const z = P(b).querySelector('.ip-z-right');
      z.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 90, clientY: 0 }));
      await new Promise((r) => setTimeout(r, 700));
      z.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 90, clientY: 0 }));
    };
    assert.strictEqual(P(b).querySelector('.ip-np').textContent, 'Music', 'precondition: a menu level is on screen');
    await hold();
    assert.ok(ct > 100, 'the hold scanned the song');
  } finally { b.restore(); }
});

test('gate r1 qa S6: inside the pop-out\'s Nano tray the menu is never drawn (nor its title), whatever the screen', () => {
  const b = bootEngine({ hasCurrent: false });
  try {
    b.dom.window.document.body.classList.add('mms-tray');
    b.engine.paint();
    assert.strictEqual(b.engine.menuState().screen, 'menu', 'precondition: the controller holds the menu screen');
    assert.ok(!P(b).querySelector('.ip-menuview') && !P(b).classList.contains('mms-menumode'), 'no menu in the tray');
    assert.strictEqual(P(b).querySelector('.ip-np').textContent, 'Now Playing');
  } finally { b.restore(); }
});

test('gate r1 A20/A22 (v1.332, onto Click): the menu screen escapes its title, list label and About name; a sub-line is never drawn', () => {
  const X = '<img src=x onerror=alert(1)>';
  const html = skins.renderMenuView('click', { title: X, root: false, aboutName: X, items: [{ label: X, sub: X, song: true, id: 'a' }], cursor: 0, start: 0, end: 1, rowH: 0, state: 'ready' });
  const d = new JSDOM('<div id="h">' + html + '</div>').window.document;
  assert.strictEqual(d.querySelectorAll('img').length, 0, 'no injected element');
  assert.strictEqual(d.querySelector('.ipm-lbl').textContent, X, 'the row label shows as text');
  assert.strictEqual(d.querySelector('.ipm-about-name').textContent, X, 'the About name shows as text');
  assert.strictEqual(d.querySelector('.ipm-list').getAttribute('aria-label'), X, 'the listbox label is an attribute value, not markup');
  assert.ok(!d.querySelector('.ipm-sub'), 'no sub-line element');
});

test('gate r1 K2: the chapters editor raises the ONE library-changed event on a successful save (and not on a failed one)', async () => {
  const COMMON = require.resolve('../../public/js/common.js');
  const saved = { window: global.window, document: global.document, fetch: global.fetch };
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  const common = require(COMMON);
  const dom = new JSDOM('<body></body>', { url: 'http://localhost/music' });
  global.window = dom.window; global.document = dom.window.document;
  try {
    const events = [];
    dom.window.document.addEventListener(common.LIBRARY_CHANGED_EVENT, (e) => events.push(e.detail));
    let ok = true;
    global.fetch = () => Promise.resolve({ ok, json: async () => (ok ? { chapters: [] } : { error: 'nope' }) });
    const saves = [];
    const flush = () => new Promise((r) => setTimeout(r, 5));
    common.showChaptersEditor('vid9', '0:00 A', () => saves.push(1), dom.window.document);
    let btn = [...dom.window.document.querySelectorAll('button')].find((x) => x.textContent === 'Save');
    btn.click(); await flush(); await flush();
    assert.deepStrictEqual(events, [{ kind: 'chapters', mediaId: 'vid9' }], 'a saved chapter list announced itself');
    assert.strictEqual(saves.length, 1, 'onSaved ran too');
    ok = false;
    common.showChaptersEditor('vid9', '0:00 A', () => saves.push(2), dom.window.document);
    btn = [...dom.window.document.querySelectorAll('button')].filter((x) => x.textContent === 'Save').pop();
    btn.click(); await flush(); await flush();
    assert.strictEqual(events.length, 1, 'a FAILED save announces nothing');
  } finally { delete require.cache[COMMON]; Object.assign(global, saved); }
});
