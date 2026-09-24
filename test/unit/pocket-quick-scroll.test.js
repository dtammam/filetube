'use strict';

// [UNIT] POCKET QUICK SCROLL + the Main Menu's Extras / Settings / About + the Click cover drift
// (Dean 2026-09-24: "there's a lot of scrolling ... I don't want to go crazy. I like the feel.").
// The pure half (music-skins.js: the letter of a row, the runs, the jumps, the picker targets, the
// new levels and builders) and the controller inside the REAL engine (skin-surface.js create() ->
// paint() -> real pointer events on the wheel / real clicks), with a stub data source and a FAKE
// clock on the surface's window (the engine's only timer source), so every hold / fade / drift is
// driven deterministically. The real-data drive (a real server + the real music.js view) is
// test/integration/pocket-quick-scroll.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const wheelConfigPath = require.resolve('../../public/js/wheel-config.js');
const BRICK_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', 'ipod-brick.js'), 'utf8');
const skins = require(skinsPath);
const { cmpStr } = require('../../lib/music/query');

const artFor = (id, explicit) => explicit || ('/albumart/' + encodeURIComponent(id));

// ---------------------------------------------------------------- the letter of a row
test('menuLetterOf follows the SERVER\'s own sort: sorted by cmpStr, the letters never go backwards (bar a trailing # run)', () => {
  const labels = ['  spaced', '_x', '!x', '"Heroes"', '(What)', '~y', '\u{1F600}a', '1a', '99 Luftballons', 'Æther', 'Az', 'Ba', 'éclair', 'Ea',
    'Ez', 'Łódź', 'Lz', 'Ma', 'Øresund', 'Ob', 'Oz', 'Pa', 'ßa', 'Sz', 'Ta', 'The Beatles', 'Zz', 'Ω', 'あ', 'Œuvre', 'Đakovo', 'Dz', 'Ca'];
  const sorted = labels.slice().sort(cmpStr);
  const seq = sorted.map((l) => skins.menuLetterOf(l));
  const ORDER = skins.MENU_LETTERS;
  // the trailing non-Latin rows ('#' after Z) are the one allowed step back - strip them
  let end = seq.length;
  while (end > 0 && seq[end - 1] === '#' && seq.slice(0, end - 1).some((l) => l !== '#')) end -= 1;
  for (let i = 1; i < end; i++) {
    assert.ok(ORDER.indexOf(seq[i]) >= ORDER.indexOf(seq[i - 1]), `letters go backwards at ${sorted[i - 1]} (${seq[i - 1]}) -> ${sorted[i]} (${seq[i]})`);
  }
  assert.deepStrictEqual(['"Heroes"', '1a', 'Æther', 'éclair', 'Łódź', 'Øresund', 'ßa', 'The Beatles', 'Œuvre', 'Đakovo', 'Ω', '', '   '].map(skins.menuLetterOf),
    ['#', '#', 'A', 'E', 'L', 'O', 'S', 'T', 'O', 'D', '#', '#', '#'],
    'symbols/digits are #, accents fold, the non-decomposing Latin letters fold where the collation files them, no "The " rule (the server has none)');
});

test('runs, jumps and picker targets: next/previous letter PRESENT (absent ones skipped), clamped at the ends', () => {
  const items = ['1st', '2nd', 'Alpha', 'Apple', 'Bravo', 'Delta', 'Dune', 'Dusk', 'Zulu'].map((label) => ({ label }));
  const runs = skins.menuLetterRuns(items);
  assert.deepStrictEqual(runs, [{ letter: '#', index: 0 }, { letter: 'A', index: 2 }, { letter: 'B', index: 4 }, { letter: 'D', index: 5 }, { letter: 'Z', index: 8 }]);
  assert.strictEqual(skins.menuLetterJump(runs, 0, 1), 2, '# -> A');
  assert.strictEqual(skins.menuLetterJump(runs, 3, 1), 4, 'mid-A -> B');
  assert.strictEqual(skins.menuLetterJump(runs, 4, 1), 5, 'B -> D (C is absent: skipped)');
  assert.strictEqual(skins.menuLetterJump(runs, 8, 1), 8, 'Z stays on Z');
  assert.strictEqual(skins.menuLetterJump(runs, 7, -1), 4, 'mid-D back -> the previous letter (B)');
  assert.strictEqual(skins.menuLetterJump(runs, 1, -1), 0, 'inside the first run back -> row 0');
  assert.strictEqual(skins.menuLetterAt(runs, 6), 'D');
  const t = skins.menuLetterTargets(runs);
  assert.strictEqual(t.length, 27, '# and A-Z');
  assert.deepStrictEqual(t.filter((x) => x.index >= 0).map((x) => x.letter + x.index), ['#0', 'A2', 'B4', 'D5', 'Z8']);
  assert.strictEqual(t.find((x) => x.letter === 'C').index, -1, 'an absent letter has no target');
  assert.ok(!skins.menuLetterable({ letters: true, items: new Array(19).fill({ label: 'x' }) }), 'under 20 rows: no letter mode');
  assert.ok(skins.menuLetterable({ letters: true, items: new Array(20).fill({ label: 'x' }) }));
  assert.ok(!skins.menuLetterable({ letters: false, items: new Array(500).fill({ label: 'x' }) }), 'a list the view did not mark alphabetical never qualifies');
  assert.ok(skins.menuSortIsAlpha('title-asc') && !skins.menuSortIsAlpha('release-newest') && !skins.menuSortIsAlpha('newest'));
});

// ---------------------------------------------------------------- the new levels + builders
test('Main Menu: the device order with Extras (Click) / Games (Seattle) ONLY when the game can run; Extras > Games > Brick; Settings > About', () => {
  const lbl = (rows) => rows.map((r) => r.label);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'main' }, { hasCurrent: true, hasGames: true, style: 'click' })), ['Music', 'Extras', 'Settings', 'Shuffle Songs', 'Now Playing']);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'main' }, { hasCurrent: true, hasGames: true, style: 'seattle' })), ['Music', 'Games', 'Settings', 'Shuffle Songs', 'Now Playing']);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'main' }, { hasCurrent: false, hasGames: false, style: 'click' })), ['Music', 'Settings', 'Shuffle Songs']);
  assert.deepStrictEqual(skins.menuStaticItems({ type: 'extras' }), [{ label: 'Games', node: { type: 'games' } }]);
  assert.deepStrictEqual(skins.menuStaticItems({ type: 'games' }), [{ label: 'Brick', action: 'brick' }]);
  assert.deepStrictEqual(skins.menuStaticItems({ type: 'settings' }), [{ label: 'About', node: { type: 'about' } }]);
  assert.strictEqual(skins.menuStaticItems({ type: 'about' }), null, 'About reads the library (the counts)');
  assert.deepStrictEqual(['extras', 'games', 'settings', 'about', 'recentArtists'].map((t) => skins.menuTitle({ type: t }, 'click')), ['Extras', 'Games', 'Settings', 'About', 'Recent Artists']);
  // addendum E: the drift plays on the MENU levels, the item art on the item levels
  assert.deepStrictEqual(['main', 'music', 'playlists', 'genres', 'extras', 'games', 'settings', 'about'].filter((t) => skins.menuIsItemLevel({ type: t })), []);
  assert.deepStrictEqual(['artists', 'albums', 'songs', 'album', 'artist', 'artistAll', 'artistAlbum', 'genre', 'playlist', 'recentArtists'].filter((t) => !skins.menuIsItemLevel({ type: t })), []);
});

test('menuRecentArtistItems: recency order, duplicates collapsed on the Artists grouping key, at most 25, rows identical in shape to an Artists row', () => {
  const t = [
    { id: 'a1', artist: 'Tonzak' }, { id: 'b1', artist: 'NESTALGIA' }, { id: 'a2', artist: 'Tonzak' },
    { id: 'c1', artist: 'Guest', albumArtist: 'Various Artists' }, { id: 'u1', artist: '' }, { id: 'c2', artist: 'Other', albumArtist: 'Various Artists' },
    { id: 'z', artist: 'Zed', avatarUrl: 'https://yt/zed.jpg' },
  ];
  const rows = skins.menuRecentArtistItems(t, artFor);
  assert.deepStrictEqual(rows.map((r) => r.label), ['Tonzak', 'NESTALGIA', 'Various Artists', 'Unknown Artist', 'Zed']);
  assert.deepStrictEqual(rows[0].node, { type: 'artist', key: 'Tonzak', label: 'Tonzak' }, 'drills exactly like Artists > artist');
  assert.deepStrictEqual(rows[3].node, { type: 'artist', key: '', label: 'Unknown Artist' }, 'the untagged bucket keys on "" like the Artists level');
  assert.deepStrictEqual(rows.map((r) => r.art), ['/albumart/a1', '/albumart/b1', '/albumart/c1', '/albumart/u1', 'https://yt/zed.jpg']);
  const many = Array.from({ length: 40 }, (_, i) => ({ id: 'x' + i, artist: 'Artist ' + i }));
  assert.strictEqual(skins.menuRecentArtistItems(many, artFor).length, skins.RECENT_ARTISTS_MAX);
  assert.strictEqual(skins.RECENT_ARTISTS_MAX, 25);
  assert.deepStrictEqual(skins.menuRecentArtistItems([], artFor), []);
});

test('menuAboutItems: read-only rows with grouped counts, the version and the software line; menuCoverPool: one art-bearing same-origin cover per album', () => {
  const rows = skins.menuAboutItems({ songs: 3008, albums: 600, artists: 150, version: '1.323.0' });
  assert.deepStrictEqual(rows.map((r) => [r.label, r.value, r.info]), [['Songs', '3,008', true], ['Albums', '600', true], ['Artists', '150', true], ['Version', '1.323.0', true], ['Software', 'FileTube', true]]);
  assert.deepStrictEqual(skins.menuAboutItems({}).map((r) => r.label), ['Songs', 'Albums', 'Artists', 'Software'], 'no version known: no Version row, never "undefined"');
  const pool = skins.menuCoverPool([
    { id: 'a1', albumKey: 'A', hasArt: true }, { id: 'a2', albumKey: 'A', hasArt: true },
    { id: 'b1', albumKey: 'B', hasArt: false }, { id: 'c1', albumKey: 'C', hasArt: true, artUrl: '/thumbnail/c1' },
    { id: 'd1', albumKey: 'D', hasArt: true, artUrl: 'https://evil.example/x.jpg' }, { id: 'e1', albumKey: 'E', hasArt: true, artUrl: '//evil.example/y.jpg' },
  ], artFor);
  assert.deepStrictEqual(pool.slice().sort(), ['/albumart/a1', '/thumbnail/c1'], 'one per album, art only, same-origin only (a random order)');
  assert.deepStrictEqual(skins.menuCoverPool([{ id: 'x', hasArt: false }], artFor), [], 'no art in the library = an empty pool');
});

test('renderMenuJump + info rows: the layers are 44 px+ buttons toggled by class, absent letters are disabled, everything escaped; an info row is not an option', () => {
  const html = skins.renderMenuJump({ letter: '<b>', overlay: true, badge: false, grid: skins.menuLetterTargets([{ letter: 'A', index: 0 }, { letter: 'M', index: 7 }]) });
  const d = new JSDOM('<div id="h">' + html + '</div>').window.document;
  const ov = d.querySelector('.ipm-letter');
  assert.ok(ov.classList.contains('is-on') && ov.hasAttribute('data-skin-letters') && ov.textContent === '<b>' && !d.querySelector('b'), 'the overlay: on, a picker opener, escaped');
  assert.ok(!d.querySelector('.ipm-badge').classList.contains('is-on') && d.querySelector('.ipm-badge').getAttribute('tabindex') === '-1', 'the badge off (and out of the tab order)');
  const cells = [...d.querySelectorAll('.ipm-grid .ipm-gl')];
  assert.strictEqual(cells.length, 27);
  assert.deepStrictEqual(cells.filter((c) => !c.disabled).map((c) => c.textContent + c.getAttribute('data-skin-letter')), ['A0', 'M7']);
  assert.ok(cells.find((c) => c.textContent === 'B').disabled, 'an absent letter is disabled');
  assert.strictEqual(skins.renderMenuJump(null), '', 'a list that does not qualify draws no layers');
  const info = skins.renderMenuList({ style: 'click', items: skins.menuAboutItems({ songs: 1 }), cursor: 0, start: 0, end: 4, rowH: 0, state: 'ready' });
  const di = new JSDOM('<div id="h">' + info + '</div>').window.document;
  assert.ok(!di.querySelector('[data-skin-mi]') && !di.querySelector('.is-cursor'), 'About rows are read-only: no selection bar, not tappable');
  assert.strictEqual(di.querySelector('.ipm-info .ipm-val').textContent, '1');
});

// ---------------------------------------------------------------- the controller through the REAL engine
const HTML = `<body>
  <video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" />
  <div id="panel" class="music-nowplaying-panel" hidden></div>
</body>`;

// A fake clock on the surface's window: the engine's only timer source (setTimeout / rAF).
function fakeClock(win) {
  let now = 0; let seq = 0;
  const q = new Map();
  win.setTimeout = (fn, ms) => { seq += 1; q.set(seq, { at: now + (Number(ms) || 0), fn }); return seq; };
  win.clearTimeout = (id) => { q.delete(id); };
  win.requestAnimationFrame = (fn) => win.setTimeout(() => fn(now), 16);
  win.cancelAnimationFrame = (id) => win.clearTimeout(id);
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of q) if (t.at <= end && (!next || t.at < next.t.at)) next = { id, t };
      if (!next) break;
      q.delete(next.id); now = next.t.at; next.t.fn();
    }
    now = end;
  }
  return { advance, live: () => q.size, now: () => now };
}

// A 3,008-song library over 25 letters (no Q, no X) plus a '#' run, in the SERVER's order.
function bigLibrary(n) {
  const letters = ['#'].concat('ABCDEFGHIJKLMNOPRSTUVWYZ'.split(''));
  const out = [];
  for (let i = 0; i < (n || 3008); i++) {
    const l = letters[i % letters.length];
    out.push({ id: 't' + i, title: (l === '#' ? String(i % 10) : l) + ' song ' + String(i).padStart(4, '0'), artist: 'X', hasArt: true, albumKey: 'k' + (i % 40) });
  }
  return out.sort((a, b) => cmpStr(a.title, b.title));
}

function bootEngine({ skin, hasCurrent = true, load, currentId, games, coverPool, reduced, otherDoc, trackListeners, haptic, sticker } = {}) {
  // pretendToBeVisual: jsdom otherwise reports document.hidden = true (the drift runs only while visible)
  const dom = new JSDOM(HTML, { url: 'http://localhost/music', pretendToBeVisual: true, runScripts: 'outside-only' });
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  dom.window.localStorage.setItem('ft-music-skin', skin || 'ipod'); // the Brick wiring reads the global pick
  // the surface may live in ANOTHER document (the desktop pop-out): the engine reads that as "not main"
  const sdom = otherDoc ? new JSDOM(HTML, { url: 'http://localhost/popout', pretendToBeVisual: true }) : dom;
  const win = sdom.window;
  const clock = fakeClock(win);
  win.matchMedia = (q) => ({ matches: !!reduced && /reduced-motion/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  if (haptic) {
    Object.defineProperty(win.HTMLInputElement.prototype, 'switch', { value: false, configurable: true });
    win.ontouchstart = null;
    if (haptic !== true) {
      delete require.cache[wheelConfigPath];
      dom.window.FileTubeWheelConfig = require(wheelConfigPath);
      dom.window.FileTubeWheelConfig.write(haptic, dom.window.localStorage);
    }
  }
  const spy = { loads: [], plays: [], shuffles: 0, dock: 0, pools: 0 };
  const state = { skin: skin || 'ipod', current: currentId || null, ver: 0 };
  const panelEl = sdom.window.document.getElementById('panel');
  const bal = { doc: 0, win: 0, panel: 0, types: {} };
  if (trackListeners) {
    const wrapT = (target, key) => {
      const a0 = target.addEventListener.bind(target); const r0 = target.removeEventListener.bind(target);
      const k = (t) => key + ':' + t;
      target.addEventListener = function (t, f, o) { bal[key] += 1; bal.types[k(t)] = (bal.types[k(t)] || 0) + 1; return a0(t, f, o); };
      target.removeEventListener = function (t, f, o) { bal[key] -= 1; bal.types[k(t)] = (bal.types[k(t)] || 0) - 1; return r0(t, f, o); };
    };
    wrapT(sdom.window.document, 'doc'); wrapT(win, 'win'); wrapT(panelEl, 'panel');
  }
  const engine = dom.window.FileTubeSkinSurface.create({
    panel: panelEl,
    win,
    getSkinId: () => state.skin,
    getCtx: () => ({ track: { title: 'T', artist: 'A', artUrl: '/albumart/now' }, upNext: [], fullList: [], playing: true }),
    hostCtl: (id) => sdom.window.document.getElementById(id),
    onSelectIndex: () => {},
    onDock: () => { spy.dock += 1; },
    sticker: sticker || (games ? { getPlayer: () => null, brick: games } : undefined),
    menu: {
      load: (node) => { spy.loads.push(node); return load ? load(node) : Promise.resolve({ items: [] }); },
      onPlay: (req) => { spy.plays.push(req); },
      onShuffleAll: () => { spy.shuffles += 1; },
      hasCurrent: () => hasCurrent,
      currentId: () => state.current,
      dataVersion: () => state.ver,
      coverPool: coverPool ? () => { spy.pools += 1; return coverPool(); } : undefined,
    },
  });
  return { dom, sdom, win, engine, spy, state, clock, bal, restore: () => Object.assign(global, saved) };
}
const P = (b) => b.sdom.window.document.getElementById('panel');
const tap = (b, el) => {
  el.dispatchEvent(new b.win.MouseEvent('pointerdown', { bubbles: true }));
  el.dispatchEvent(new b.win.MouseEvent('pointerup', { bubbles: true }));
  el.dispatchEvent(new b.win.MouseEvent('click', { bubbles: true }));
};
const pressMenu = (b) => tap(b, P(b).querySelector('[data-skin-menu]'));
const pressSelect = (b) => tap(b, P(b).querySelector('[data-skin-select]'));
const lbls = (b) => [...P(b).querySelectorAll('.ipm-row:not(.ipm-skel) .ipm-lbl')].map((x) => x.textContent);
const tapLabel = (b, label) => {
  const r = [...P(b).querySelectorAll('.ipm-row:not(.ipm-skel)')].find((x) => x.querySelector('.ipm-lbl').textContent === label);
  if (!r) throw new Error('no row ' + label + ' in ' + lbls(b).join('|'));
  tap(b, r);
};
const cursorLbl = (b) => { const r = P(b).querySelector('.ipm-row.is-cursor .ipm-lbl'); return r ? r.textContent : null; };
const flush = () => new Promise((r) => setImmediate(r));
const overlay = (b) => P(b).querySelector('.ip-menuview > .ipm-letter');
const badgeEl = (b) => P(b).querySelector('.ip-menuview > .ipm-badge');
const gridEl = (b) => P(b).querySelector('.ip-menuview > .ipm-grid');

// The REAL wheel gesture: pointerdown on the ring, `moves` pointermoves of `step` degrees each,
// `ms` apart on a fake performance clock (the engine reads speed = degrees / ms), then release.
function spin(b, { from = 0, moves, step, ms, lift = true }) {
  const wheel = P(b).querySelector('.ip-wheel');
  const at = (deg) => { const r = deg * Math.PI / 180; return { clientX: 100 * Math.cos(r), clientY: 100 * Math.sin(r) }; };
  const realNow = performance.now;
  let t = realNow.call(performance);
  Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => t });
  try {
    const s = at(from);
    wheel.dispatchEvent(new b.win.MouseEvent('pointerdown', { bubbles: true, clientX: s.clientX, clientY: s.clientY }));
    let deg = from;
    for (let i = 0; i < moves; i++) { t += ms; deg += step; const q = at(deg); wheel.dispatchEvent(new b.win.MouseEvent('pointermove', { bubbles: true, clientX: q.clientX, clientY: q.clientY })); }
    if (lift) wheel.dispatchEvent(new b.win.MouseEvent('pointerup', { bubbles: true }));
  } finally { Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: realNow }); }
}
// a FAST flick: 11.5 degrees every 8 ms = 1.44 deg/ms (the engine's x2 band) - one detent per two
// moves (11.5, not 11: two float 11s sum to 21.999... and miss the 22-degree step)
const fastSpin = (b, detents, dir = 1) => spin(b, { moves: detents * 2, step: 11.5 * dir, ms: 8 });
// a SLOW turn: 5.6 degrees every 60 ms = 0.09 deg/ms (the x1 band)
const slowSpin = (b, detents, dir = 1) => spin(b, { moves: detents * 4, step: 5.6 * dir, ms: 60 });

const LIB = bigLibrary(3008);
function songsLoad(tracks, letters = true) {
  return (n) => Promise.resolve(n.type === 'songs'
    ? { items: skins.menuSongItems(tracks, artFor), tracks, play: { ctx: { sort: 'title-asc' } }, letters }
    : { items: [] });
}
async function openSongs(b) {
  b.engine.paint();
  pressMenu(b); pressSelect(b); // Main -> Music
  tapLabel(b, 'Songs'); await flush();
  assert.strictEqual(b.engine.menuState().title, 'Songs');
}
const firstRowOf = (tracks, letter) => tracks.findIndex((t) => skins.menuLetterOf(t.title) === letter);

test('REACHABILITY: a FAST spin on the real wheel engages letter mode (overlay up, one letter per detent); a SLOW spin never does, it moves one row per detent', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    slowSpin(b, 6);
    assert.strictEqual(b.engine.menuState().cursor, 6, 'slow: one row per detent');
    assert.strictEqual(b.engine.menuState().letterMode, false, 'a slow spin never enters letter mode');
    assert.ok(!overlay(b).classList.contains('is-on'));
    // back to row 0, then a fast flick
    slowSpin(b, 6, -1);
    assert.strictEqual(b.engine.menuState().cursor, 0);
    fastSpin(b, 4);
    const st = b.engine.menuState();
    assert.strictEqual(st.letterMode, true, 'the fast flick engaged letter mode (the engine\'s own speed band)');
    assert.ok(overlay(b).classList.contains('is-on'), 'the big letter overlay is up');
    // detent 1 = the x2 accel step (rows 0 -> 2, still #); detents 2..4 = three letters: A, B, C
    assert.strictEqual(st.letter, 'C');
    assert.strictEqual(overlay(b).textContent, 'C');
    assert.strictEqual(st.cursor, firstRowOf(LIB, 'C'), 'landed on the FIRST row of the letter');
    assert.strictEqual(cursorLbl(b), LIB[firstRowOf(LIB, 'C')].title, 'and that row is rendered, highlighted (the window followed)');
    assert.ok(P(b).querySelectorAll('.ipm-row').length <= 40, 'windowing intact');
  } finally { b.restore(); }
});

test('letter mode skips ABSENT letters, and one noisy fast detent alone never engages it', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    // a single fast detent between slow ones: the multiplier moves 2 rows, no letter mode
    slowSpin(b, 1); fastSpin(b, 1); slowSpin(b, 1);
    assert.strictEqual(b.engine.menuState().letterMode, false, 'one fast detent is not a flick');
    // jump to P (a fast run from row 0 lands on letters in order), then one more: Q is absent -> R
    b.engine.menuState();
    const pRow = firstRowOf(LIB, 'P');
    fastSpin(b, 2); // engages on the second detent: -> the next letter from where it was
    for (let guard = 0; b.engine.menuState().letter !== 'P'; guard++) { assert.ok(guard < 30, 'never reached P'); fastSpin(b, 1); }
    assert.strictEqual(b.engine.menuState().cursor, pRow);
    fastSpin(b, 1);
    assert.strictEqual(b.engine.menuState().letter, 'R', 'Q is absent from the list: skipped');
    assert.strictEqual(b.engine.menuState().cursor, firstRowOf(LIB, 'R'));
    fastSpin(b, 1, -1);
    assert.strictEqual(b.engine.menuState().letter, 'P', 'back one letter');
  } finally { b.restore(); }
});

test('CLEAR axes of letter mode (on a POPULATED overlay): the 1 s hold after the wheel stops (highlight stays), MENU, Select, a level change', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    fastSpin(b, 5);
    const parked = b.engine.menuState().cursor;
    assert.ok(overlay(b).classList.contains('is-on'), 'precondition: the overlay is up');
    b.clock.advance(900);
    assert.ok(overlay(b).classList.contains('is-on'), 'still up inside the hold');
    b.clock.advance(200);
    assert.ok(!overlay(b).classList.contains('is-on'), 'faded ~1 s after the wheel stopped');
    assert.strictEqual(b.engine.menuState().letterMode, false);
    assert.strictEqual(b.engine.menuState().cursor, parked, 'the highlight stays on the row it landed on');
    // a slow turn after letter mode ended moves ONE row again
    slowSpin(b, 1);
    assert.strictEqual(b.engine.menuState().cursor, parked + 1);
    // MENU: clears it and climbs
    fastSpin(b, 3);
    assert.ok(b.engine.menuState().letterMode);
    pressMenu(b);
    assert.strictEqual(b.engine.menuState().title, 'Music');
    assert.strictEqual(b.engine.menuState().letterMode, false, 'MENU cleared letter mode');
    // Select: clears it (and plays the landed row)
    tapLabel(b, 'Songs'); await flush();
    fastSpin(b, 3);
    const landed = b.engine.menuState().cursor;
    pressSelect(b);
    assert.strictEqual(b.engine.menuState().letterMode, false, 'Select cleared letter mode');
    assert.strictEqual(b.spy.plays[b.spy.plays.length - 1].index, landed, 'Select plays the row letter mode landed on');
    assert.strictEqual(b.engine.menuState().timers, 0, 'no letter / badge / art timer left behind');
  } finally { b.restore(); }
});

test('the K1 rule holds in letter mode: a queue advance (a repaint) never moves the parked highlight, and the overlay survives the repaint', async () => {
  const b = bootEngine({ load: songsLoad(LIB), currentId: 't0' });
  try {
    await openSongs(b);
    tapLabel(b, LIB[0].title); // play row 0: this list is now the playing context
    pressMenu(b);              // back on it
    fastSpin(b, 6);
    const parked = b.engine.menuState().cursor;
    assert.ok(b.engine.menuState().letterMode, 'precondition: letter mode');
    b.state.current = LIB[1].id; b.engine.paint(); // the queue advances with the list on screen
    assert.strictEqual(b.engine.menuState().cursor, parked, 'the highlight did not move');
    assert.ok(overlay(b) && overlay(b).classList.contains('is-on'), 'the repaint redrew the overlay from state');
    const cur = P(b).querySelector('.ipm-row.is-current');
    assert.ok(!cur || cur.getAttribute('data-skin-mi') === '1', 'only the speaker mark follows the queue');
  } finally { b.restore(); }
});

test('only a LONG list the view marked ALPHABETICAL qualifies: a newest-first list (Recently Added) and a short list keep the plain accelerating cursor', async () => {
  for (const [tracks, letters, why] of [[LIB.slice(0, 400), false, 'not alphabetical'], [LIB.slice(0, 19), true, 'only 19 rows']]) {
    const b = bootEngine({ load: songsLoad(tracks, letters) });
    try {
      await openSongs(b);
      fastSpin(b, 5);
      assert.strictEqual(b.engine.menuState().letterMode, false, why + ': no letter mode');
      assert.strictEqual(overlay(b), null, why + ': no layers drawn');
      assert.ok(b.engine.menuState().cursor > 5, why + ': the flick still accelerates (the v1.233 multiplier)');
    } finally { b.restore(); }
  }
});

test('HAPTICS in letter mode: ONE tick (ghost bias flip) per letter crossed, none for the rotation between letters; outside letter mode the per-detent ticks are unchanged', async () => {
  const b = bootEngine({ load: songsLoad(LIB), haptic: true });
  try {
    await openSongs(b);
    const g = P(b).querySelector('.mms-haptic-ghost');
    assert.ok(g, 'precondition: the haptic ghost is mounted');
    const wheel = P(b).querySelector('.ip-wheel');
    const at = (deg) => { const r = deg * Math.PI / 180; return { clientX: 100 * Math.cos(r), clientY: 100 * Math.sin(r) }; };
    const sign = () => { const m = /translate\((-?[\d.e-]+)px/.exec(g.style.transform); const q = lastQ; return Math.sign(Number(m[1]) - q.clientX); };
    let lastQ = at(0);
    const realNow = performance.now; let t = realNow.call(performance);
    Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => t });
    try {
      wheel.dispatchEvent(new b.win.MouseEvent('pointerdown', { bubbles: true, clientX: lastQ.clientX, clientY: lastQ.clientY }));
      let deg = 0; const flips = []; let prev = sign();
      const mv = (step, ms) => { t += ms; deg += step; lastQ = at(deg); wheel.dispatchEvent(new b.win.MouseEvent('pointermove', { bubbles: true, clientX: lastQ.clientX, clientY: lastQ.clientY })); const s = sign(); flips.push(s !== prev); prev = s; };
      // engage (three fast moves) ...
      for (let i = 0; i < 4; i++) mv(11.5, 8);
      assert.ok(b.engine.menuState().letterMode, 'precondition: letter mode');
      // ... then in letter mode: half-detent moves (11.5 deg) - a letter every SECOND move
      flips.length = 0;
      const lettersBefore = b.engine.menuState().letter;
      for (let i = 0; i < 6; i++) mv(11.5, 8);
      assert.deepStrictEqual(flips, [false, true, false, true, false, true], 'a tick exactly on the moves that crossed a letter (3 letters, 3 ticks) - none between');
      assert.notStrictEqual(b.engine.menuState().letter, lettersBefore);
      wheel.dispatchEvent(new b.win.MouseEvent('pointerup', { bubbles: true }));
    } finally { Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: realNow }); }
  } finally { b.restore(); }
});

test('HAPTICS, the SWEEP engine: in letter mode the switch crosses its midline once per letter (the shared sweepOffset sine), never per 3.75 degrees', async () => {
  const b = bootEngine({ load: songsLoad(LIB), haptic: { engine: 'sweep', detent: 3.75, dither: 18, capture: '8px', buzz: true } });
  try {
    await openSongs(b);
    const g = P(b).querySelector('.mms-haptic-ghost');
    const wheel = P(b).querySelector('.ip-wheel');
    const at = (deg) => { const r = deg * Math.PI / 180; return { clientX: 100 * Math.cos(r), clientY: 100 * Math.sin(r) }; };
    let q = at(0);
    const off = () => Number(/translate\((-?[\d.e-]+)px/.exec(g.style.transform)[1]) - q.clientX;
    const realNow = performance.now; let t = realNow.call(performance);
    Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => t });
    try {
      wheel.dispatchEvent(new b.win.MouseEvent('pointerdown', { bubbles: true, clientX: q.clientX, clientY: q.clientY }));
      let deg = 0;
      const mv = (step, ms) => { t += ms; deg += step; q = at(deg); wheel.dispatchEvent(new b.win.MouseEvent('pointermove', { bubbles: true, clientX: q.clientX, clientY: q.clientY })); return off(); };
      for (let i = 0; i < 4; i++) mv(11.5, 8);
      assert.ok(b.engine.menuState().letterMode, 'precondition');
      let prev = Math.sign(off());
      const signs = []; const crossed = [];
      for (let i = 0; i < 6; i++) { const sg = Math.sign(mv(11.5, 8)); signs.push(sg); crossed.push(sg !== prev); prev = sg; }
      assert.deepStrictEqual(crossed, [false, true, false, true, false, true], 'one midline crossing exactly on each move that crossed a letter (' + signs.join(',') + ')');
      assert.ok(signs.every((sg) => sg !== 0), 'the switch sits off its midline between letters (a real tick per crossing)');
      wheel.dispatchEvent(new b.win.MouseEvent('pointerup', { bubbles: true }));
    } finally { Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: realNow }); }
  } finally { b.restore(); }
});

test('TOUCH: a finger scroll shows the edge badge (with the top row\'s letter) and it fades after 1 s; a scroll the controller itself wrote shows nothing', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    const list = P(b).querySelector('.ipm-list');
    // the controller's own write (render / a wheel step) is not a finger
    list.dispatchEvent(new b.win.Event('scroll'));
    assert.ok(!badgeEl(b).classList.contains('is-on'), 'no badge for the controller\'s own scroll offset');
    list.scrollTop = 500; // jsdom has no layout: the badge letter falls back to the cursor row
    list.dispatchEvent(new b.win.Event('scroll'));
    assert.ok(badgeEl(b).classList.contains('is-on'), 'a finger scroll shows the badge');
    assert.strictEqual(badgeEl(b).textContent, '#');
    b.clock.advance(1100);
    assert.ok(!badgeEl(b).classList.contains('is-on'), 'the badge fades after the scroll stops');
  } finally { b.restore(); }
});

test('the A-Z PICKER: opened from the badge or the overlay; a letter jumps (re-windowed, re-centred) and closes it; MENU / Select / an outside tap / the wheel close it - on every arm', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    const list = P(b).querySelector('.ipm-list');
    const openFromBadge = () => { list.scrollTop += 40; list.dispatchEvent(new b.win.Event('scroll')); tap(b, badgeEl(b)); assert.ok(gridEl(b), 'the picker is open'); };
    openFromBadge();
    assert.strictEqual(gridEl(b).querySelectorAll('.ipm-gl').length, 27);
    assert.ok(gridEl(b).querySelector('.ipm-gl.is-off'), 'absent letters (Q, X) are drawn disabled');
    const t0 = performance.now();
    tap(b, [...gridEl(b).querySelectorAll('.ipm-gl')].find((c) => c.textContent === 'M'));
    const ms = performance.now() - t0;
    assert.strictEqual(gridEl(b), null, 'a pick closes the picker');
    assert.strictEqual(b.engine.menuState().cursor, firstRowOf(LIB, 'M'), 'on the first M row');
    assert.strictEqual(cursorLbl(b), LIB[firstRowOf(LIB, 'M')].title, 'the far row is rendered (the window re-centred on it)');
    assert.ok(ms >= 0); // (timed in the Chromium probe, not here: a jsdom wall-clock bound flakes under load)
    // MENU closes it and does NOT climb
    openFromBadge(); pressMenu(b);
    assert.strictEqual(gridEl(b), null); assert.strictEqual(b.engine.menuState().title, 'Songs', 'MENU only closed the picker');
    // Select closes it and plays nothing
    openFromBadge(); pressSelect(b);
    assert.strictEqual(gridEl(b), null); assert.strictEqual(b.spy.plays.length, 0, 'Select only closed the picker');
    // an outside tap (the status bar) closes it
    openFromBadge(); tap(b, P(b).querySelector('.ip-status'));
    assert.strictEqual(gridEl(b), null, 'an outside tap closed it');
    // a tap on the picker's own dead space keeps it open
    openFromBadge(); tap(b, gridEl(b));
    assert.ok(gridEl(b), 'its own dead space does not close it');
    // the wheel closes it
    slowSpin(b, 1);
    assert.strictEqual(gridEl(b), null, 'a wheel turn closed it');
    // from the OVERLAY (wheel letter mode)
    fastSpin(b, 3); tap(b, overlay(b));
    assert.ok(gridEl(b) && !b.engine.menuState().letterMode, 'the overlay opened the picker (letter mode handed over)');
    tapLabel(b, lbls(b)[0]) ; // a row tap outside... the picker covers the list: a tap inside the menu screen only closes it
    assert.strictEqual(gridEl(b), null);
    assert.strictEqual(b.spy.plays.length, 0, 'the closing tap did not play the row under it');
  } finally { b.restore(); }
});

test('LISTENER BALANCE: 20 cycles of letter mode + picker open/close + badge add NO document / window / panel listener, and destroy() leaves every count at 0', async () => {
  const b = bootEngine({ load: songsLoad(LIB), trackListeners: true, coverPool: () => Promise.resolve(['/albumart/a', '/albumart/b']) });
  try {
    await openSongs(b);
    const after0 = JSON.parse(JSON.stringify(b.bal));
    for (let i = 0; i < 20; i++) {
      fastSpin(b, 4);
      tap(b, overlay(b));
      tap(b, [...gridEl(b).querySelectorAll('.ipm-gl:not(.is-off)')][i % 20]);
      const list = P(b).querySelector('.ipm-list');
      list.scrollTop += 34; list.dispatchEvent(new b.win.Event('scroll'));
      tap(b, badgeEl(b)); pressMenu(b);
      b.clock.advance(1200);
    }
    // the only DOCUMENT listeners during a gesture are the wheel's own two end arms, removed at its end
    assert.deepStrictEqual(b.bal, after0, 'no listener leaked across 20 cycles: ' + JSON.stringify(b.bal) + ' vs ' + JSON.stringify(after0));
    b.engine.destroy();
    assert.strictEqual(b.bal.doc, 0, 'destroy() removed every document listener it added (incl. visibilitychange)');
    assert.strictEqual(b.bal.panel, 0, 'and every panel listener');
    // the window: the engine's own two (resize / orientationchange) are gone; what remains is
    // jsdom's own per-event-type bookkeeping (the same on a tree without this change)
    assert.strictEqual(b.bal.types['win:resize'] || 0, 0, 'resize unbound');
    assert.strictEqual(b.bal.types['win:orientationchange'] || 0, 0, 'orientationchange unbound');
    assert.strictEqual(b.bal.types['doc:visibilitychange'] || 0, 0, 'the drift\'s visibilitychange unbound');
    assert.ok(Object.keys(b.bal.types).filter((k) => /^win:/.test(k) && b.bal.types[k] !== 0).every((k) => !/resize|orientation|visibility|scroll|pointer|touch/.test(k)),
      'no engine-type window listener remains: ' + JSON.stringify(b.bal.types));
    const src = fs.readFileSync(surfacePath, 'utf8');
    assert.ok(!/addEventListener\(\s*['"]touch(start|move)['"][^)]*passive\s*:\s*false/.test(src), 'no non-passive touch listener anywhere in the engine');
  } finally { b.restore(); }
});

// Timing is NOT asserted here: a wall-clock bound in jsdom flakes under the full suite's load (the
// hook run measured a 118 ms first jump once). The task-length measure is the headless Chromium
// probe's (long tasks [] on every A / M / Z jump, every skin, both sizes - see the plan).
test('3,008 songs: letter jumps A -> M -> Z land on each letter\'s first row with a bounded DOM', async (t) => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    const list = P(b).querySelector('.ipm-list');
    const pick = (L) => {
      list.scrollTop += 34; list.dispatchEvent(new b.win.Event('scroll')); tap(b, badgeEl(b));
      const t0 = performance.now();
      tap(b, [...gridEl(b).querySelectorAll('.ipm-gl')].find((c) => c.textContent === L));
      return performance.now() - t0;
    };
    const times = ['A', 'M', 'Z'].map((L) => {
      const ms = pick(L);
      assert.strictEqual(b.engine.menuState().cursor, firstRowOf(LIB, L), L + ': first row');
      assert.strictEqual(cursorLbl(b), LIB[firstRowOf(LIB, L)].title, L + ': rendered');
      assert.ok(P(b).querySelectorAll('.ipm-row').length <= 40, L + ': windowing intact');
      return ms;
    });
    // and the wheel's own letter steps back from Z
    const t0 = performance.now(); fastSpin(b, 6, -1); const wheelMs = performance.now() - t0;
    assert.ok(b.engine.menuState().letterMode);
    t.diagnostic('picker jumps ' + times.map((x) => x.toFixed(1)).join('/') + ' ms; 6 wheel detents ' + wheelMs.toFixed(1) + ' ms');
  } finally { b.restore(); }
});

// ---------------------------------------------------------------- addendum C: Extras > Games > Brick
function brickFor(b) {
  // the REAL ipod-brick.js wiring, exactly as music.js hands it to the sticker (getEngine = this engine)
  b.dom.window.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({}, { get(_t, k) { if (k === 'measureText') return () => ({ width: 10 }); return () => {}; }, set() { return true; } });
  };
  b.dom.window.eval(BRICK_SRC);
  return b.dom.window.FileTubeBrick.wire({ getEngine: () => b.engine });
}
function bootWithBrick(opts) {
  let wiring = null;
  const games = { visible: () => !!wiring && wiring.visible(), onTap: () => { if (wiring) wiring.onTap(); } };
  const b = bootEngine(Object.assign({ games }, opts || {}));
  b.dom.window.eval('void 0'); // (the JSDOM runs scripts outside-only by default: eval is available)
  wiring = brickFor(b);
  b.wiring = wiring;
  return b;
}

test('C: Extras > Games > Brick launches the EXISTING game through the view\'s hook (the sticker\'s own launch), and MENU from the game lands back on Games', async () => {
  const b = bootWithBrick({});
  try {
    b.engine.paint();
    pressMenu(b);
    assert.deepStrictEqual(lbls(b), ['Music', 'Extras', 'Settings', 'Shuffle Songs', 'Now Playing'], 'the iPod classic Main Menu, with Extras');
    tapLabel(b, 'Extras');
    assert.strictEqual(b.engine.menuState().title, 'Extras');
    tapLabel(b, 'Games');
    assert.deepStrictEqual(lbls(b), ['Brick']);
    pressSelect(b);
    assert.ok(b.wiring.isRunning(), 'the game is running');
    assert.ok(P(b).querySelector('.ip-lcd-in .ipod-brick canvas'), 'mounted on THIS engine\'s LCD');
    pressMenu(b);
    assert.ok(!b.wiring.isRunning(), 'MENU ended the game (the engine\'s v1.270 release)');
    assert.ok(!P(b).querySelector('.ipod-brick'), 'its canvas is gone');
    assert.strictEqual(b.engine.menuState().title, 'Games', 'MENU out of the game lands back on the Games list');
    pressMenu(b); assert.strictEqual(b.engine.menuState().title, 'Extras');
    pressMenu(b); assert.strictEqual(b.engine.menuState().title, 'Click');
  } finally { b.restore(); }
});

test('C teardown on EVERY arm: a repaint (track change / skin switch), a dock, the view dying - each ends a menu-launched game', async () => {
  const arms = {
    repaint: (b) => { b.engine.paint(); },
    'skin switch': (b) => { b.state.skin = 'ipod-black'; b.dom.window.localStorage.setItem('ft-music-skin', 'ipod-black'); b.engine.paint(); },
    // the view's dock un-renders the panel with no engine event (the v1.256 path); the game's loop
    // sees itself detached, and the return's repaint releases the takeover (v1.270 structural)
    'dock + return': (b) => { P(b).innerHTML = ''; P(b).className = 'music-nowplaying-panel'; b.clock.advance(100); b.engine.paint(); },
    'view destroy': (b) => { b.wiring.stop(); b.engine.destroy(); },
    'engine destroy': (b) => { b.engine.destroy(); },
  };
  for (const [name, arm] of Object.entries(arms)) {
    const b = bootWithBrick({});
    try {
      b.engine.paint();
      pressMenu(b); tapLabel(b, 'Extras'); tapLabel(b, 'Games'); tapLabel(b, 'Brick');
      assert.ok(b.wiring.isRunning(), name + ': precondition - running');
      arm(b);
      assert.ok(!b.wiring.isRunning(), name + ': the game ended');
      assert.ok(!P(b).querySelector('.ipod-brick'), name + ': no orphaned canvas');
    } finally { b.restore(); }
  }
});

test('C availability, BOTH axes: shown in the main document with the hook on a Click skin; hidden (not inert) in the pop-out, without the hook, and where Brick\'s own rule says no (Seattle, #207)', async () => {
  const main = bootWithBrick({});
  try { main.engine.paint(); pressMenu(main); assert.ok(lbls(main).includes('Extras'), 'main document + hook + Click: shown'); } finally { main.restore(); }
  const noHook = bootEngine({});
  try { noHook.engine.paint(); pressMenu(noHook); assert.ok(!lbls(noHook).includes('Extras'), 'no hook: hidden'); } finally { noHook.restore(); }
  // the pop-out: the panel lives in ANOTHER document; the view still hands a hook that says yes
  const pop = bootEngine({ otherDoc: true, games: { visible: () => true, onTap: () => { throw new Error('never launched from a pop-out'); } } });
  try { pop.engine.paint(); pressMenu(pop); assert.deepStrictEqual(lbls(pop), ['Music', 'Settings', 'Shuffle Songs', 'Now Playing'], 'the pop-out: no Extras entry at all'); } finally { pop.restore(); }
  // Seattle: Brick's own rule (the Click wheel trio only) says no -> no Games entry
  const sea = bootWithBrick({ skin: 'zune-classic' });
  try { sea.engine.paint(); pressMenu(sea); assert.deepStrictEqual(lbls(sea), ['Music', 'Settings', 'Shuffle Songs', 'Now Playing'], 'Seattle: hidden by Brick\'s own availability rule'); } finally { sea.restore(); }
  // ...and were the rule to say yes on Seattle, the entry is the Zune's word
  const seaYes = bootEngine({ skin: 'zune-classic', games: { visible: () => true, onTap: () => {} } });
  try { seaYes.engine.paint(); pressMenu(seaYes); assert.ok(lbls(seaYes).includes('Games') && !lbls(seaYes).includes('Extras')); } finally { seaYes.restore(); }
});

// ---------------------------------------------------------------- addendum D: Settings > About
test('D: Settings > About shows the skin\'s cheeky name and the read-only facts; the wheel and Select never act on them', async () => {
  for (const [skin, name] of [['ipod', 'Click'], ['zune-classic', 'Seattle']]) {
    const b = bootEngine({ skin, load: (n) => Promise.resolve(n.type === 'about' ? { items: skins.menuAboutItems({ songs: 3008, albums: 600, artists: 150, version: '1.323.0' }) } : { items: [] }) });
    try {
      b.engine.paint();
      pressMenu(b); tapLabel(b, 'Settings');
      assert.deepStrictEqual(lbls(b), ['About']);
      tapLabel(b, 'About'); await flush();
      assert.strictEqual(P(b).querySelector('.ip-np').textContent, 'About');
      assert.strictEqual(P(b).querySelector('.ipm-about-name').textContent, name, 'the heading is the skin\'s cheeky name, never the product\'s');
      assert.deepStrictEqual([...P(b).querySelectorAll('.ipm-info')].map((r) => r.textContent), ['Songs3,008', 'Albums600', 'Artists150', 'Version1.323.0', 'SoftwareFileTube']);
      pressSelect(b); slowSpin(b, 2); pressSelect(b);
      assert.strictEqual(b.spy.plays.length, 0); assert.strictEqual(b.engine.menuState().title, 'About', 'nothing to select');
      pressMenu(b); assert.strictEqual(b.engine.menuState().title, 'Settings');
    } finally { b.restore(); }
  }
});

// ---------------------------------------------------------------- addendum E: the cover drift
const POOL = ['/albumart/c1', '/albumart/c2', '/albumart/c3'];
const slides = (b) => [...P(b).querySelectorAll('.ipm-art .ipm-slide')];
const fire = (b, img, type) => img.dispatchEvent(new b.win.Event(type || 'load'));
async function driftUp(b) {
  b.engine.paint(); pressMenu(b); await flush(); await flush();
  const s = slides(b);
  assert.strictEqual(s.length, 1, 'the first cover preloads INSIDE the pane, invisible');
  assert.ok(!s[0].classList.contains('is-on'));
  fire(b, s[0]); b.clock.advance(20);
  return s[0];
}

test('E: the Main Menu (a POPULATED pane) drifts - each cover preloads before its fade, turns on with the drift, and crossfades to the next; at most two layers', async () => {
  const b = bootEngine({ coverPool: () => Promise.resolve(POOL.slice()) });
  try {
    const first = await driftUp(b);
    assert.ok(first.classList.contains('is-on') && first.classList.contains('is-drift'), 'the loaded cover fades in AND drifts');
    assert.strictEqual(b.engine.menuState().slides, true);
    b.clock.advance(1400); // the fade is done: the next cover is preloading
    let s = slides(b);
    assert.strictEqual(s.length, 2, 'the next cover is already in the pane, invisible, while this one drifts');
    assert.ok(!s[1].classList.contains('is-on'));
    const nextSrc = s[1].getAttribute('src');
    assert.ok(POOL.includes(nextSrc) && nextSrc !== first.getAttribute('src'), 'a different cover from the pool');
    fire(b, s[1]);
    b.clock.advance(9000 - 1400 + 20);
    s = slides(b);
    assert.ok(s[1].classList.contains('is-on') && !s[0].classList.contains('is-on'), 'the crossfade: the next on, the old fading');
    assert.ok(s.length <= 2, 'never more than two layers');
    b.clock.advance(1400);
    assert.strictEqual(slides(b).filter((x) => x === first).length, 0, 'the old layer is dropped after its fade');
    // a slow network: the next cover has NOT loaded when its time comes -> the current one stays
    const cur = slides(b).find((x) => x.classList.contains('is-on'));
    b.clock.advance(9000);
    assert.ok(cur.isConnected && cur.classList.contains('is-on'), 'no blank pane while the next cover loads');
    const pending = slides(b).find((x) => !x.classList.contains('is-on'));
    fire(b, pending); b.clock.advance(20);
    assert.ok(pending.classList.contains('is-on'), 'it swaps the moment the preload lands');
  } finally { b.restore(); }
});

test('E, both axes: NOT on an item level (the highlighted item\'s art, static) - entering one stops the drift, climbing back restarts it', async () => {
  const b = bootEngine({ coverPool: () => Promise.resolve(POOL.slice()),
    load: (n) => Promise.resolve(n.type === 'artists' ? { items: [{ label: 'Tonzak', art: '/albumart/tz', node: { type: 'artist', key: 'Tonzak' } }] } : { items: [] }) });
  try {
    await driftUp(b);
    pressSelect(b); // Music: still a menu level
    assert.strictEqual(b.engine.menuState().slides, true, 'Music drifts too');
    tapLabel(b, 'Artists'); await flush(); b.clock.advance(200);
    assert.strictEqual(b.engine.menuState().slides, false, 'an item level stops it');
    assert.strictEqual(slides(b).length, 0, 'its layers are gone');
    assert.strictEqual(b.engine.menuState().slideTimers, 0, 'its timers are cleared');
    const art = P(b).querySelector('.ipm-art .ipm-art-img');
    assert.ok(art && art.getAttribute('src') === '/albumart/tz', 'the item level shows the highlighted item\'s art');
    pressMenu(b); await flush();
    assert.strictEqual(b.engine.menuState().slides, true, 'back on Music: it restarts');
  } finally { b.restore(); }
});

test('E pause/resume: document hidden stops every timer and layer, visible restarts it; a dock (panel cleared) stops it at the next tick; the Now Playing screen stops it', async () => {
  const b = bootEngine({ coverPool: () => Promise.resolve(POOL.slice()) });
  try {
    await driftUp(b);
    Object.defineProperty(b.sdom.window.document, 'hidden', { configurable: true, get: () => true });
    b.sdom.window.document.dispatchEvent(new b.win.Event('visibilitychange'));
    assert.strictEqual(b.engine.menuState().slides, false); assert.strictEqual(b.engine.menuState().slideTimers, 0); assert.strictEqual(slides(b).length, 0);
    Object.defineProperty(b.sdom.window.document, 'hidden', { configurable: true, get: () => false });
    b.sdom.window.document.dispatchEvent(new b.win.Event('visibilitychange'));
    assert.strictEqual(b.engine.menuState().slides, true, 'visible again: resumed');
    // Now Playing
    pressSelect(b); // Music
    pressMenu(b); tapLabel(b, 'Now Playing');
    assert.strictEqual(b.engine.menuState().slides, false, 'Now Playing stops it');
    pressMenu(b); await flush();
    assert.strictEqual(b.engine.menuState().slides, true);
    fire(b, slides(b)[0]); b.clock.advance(20);
    // a dock: the view clears the panel without destroy() (the v1.256 path)
    P(b).innerHTML = ''; P(b).className = 'music-nowplaying-panel';
    b.clock.advance(20000);
    assert.strictEqual(b.engine.menuState().slides, false, 'the next tick saw the pane gone and stopped');
    assert.strictEqual(b.engine.menuState().slideTimers, 0);
  } finally { b.restore(); }
});

test('E reduced motion: one still cover, no drift class, no swap timer', async () => {
  const b = bootEngine({ reduced: true, coverPool: () => Promise.resolve(POOL.slice()) });
  try {
    const first = await driftUp(b);
    assert.ok(first.classList.contains('is-on') && !first.classList.contains('is-drift'), 'on, but no drift');
    b.clock.advance(60000);
    assert.deepStrictEqual(slides(b), [first], 'the same single cover a minute later');
    assert.strictEqual(b.engine.menuState().slideTimers, 0);
  } finally { b.restore(); }
});

test('E: no covers in the library = today\'s pane (the playing track\'s art); Seattle has no pane and never asks', async () => {
  const b = bootEngine({ coverPool: () => Promise.resolve([]) });
  try {
    b.engine.paint(); pressMenu(b); await flush(); b.clock.advance(200);
    assert.strictEqual(slides(b).length, 0);
    assert.strictEqual(P(b).querySelector('.ipm-art .ipm-art-img').getAttribute('src'), '/albumart/now', 'today\'s fallback art');
  } finally { b.restore(); }
  const s = bootEngine({ skin: 'zune-classic', coverPool: () => Promise.resolve(POOL.slice()) });
  try { s.engine.paint(); pressMenu(s); await flush(); assert.strictEqual(s.spy.pools, 0, 'Seattle never fetches covers'); } finally { s.restore(); }
});

test('E timers over N mounts: every teardown arm (destroy, skin switch, the tray) leaves ZERO live timers on the surface clock', async () => {
  for (let n = 0; n < 8; n++) {
    const b = bootEngine({ coverPool: () => Promise.resolve(POOL.slice()), load: songsLoad(LIB) });
    try {
      await driftUp(b);
      b.clock.advance(1400);
      const arm = n % 3;
      if (arm === 0) b.engine.destroy();
      else if (arm === 1) { b.state.skin = 'zune-classic'; b.engine.paint(); }
      else { b.sdom.window.document.body.classList.add('mms-tray'); b.engine.paint(); }
      b.clock.advance(5); // let the marquee/ghost frames the repaint scheduled run out
      assert.strictEqual(b.engine.menuState() ? b.engine.menuState().slideTimers : 0, 0, 'arm ' + arm + ': no drift timer');
      assert.strictEqual(slides(b).length, 0, 'arm ' + arm + ': no layers');
      if (arm === 0) assert.strictEqual(b.clock.live(), 0, 'destroy: nothing at all left on the clock');
    } finally { b.restore(); }
  }
});

test('E CSS lock: the drift\'s rules animate ONLY transform + opacity - no filter / blur / mask / backdrop / keyframes, any spelling or case', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) { if (/\.ipm-slide|\.ipm-art\b/.test(m[1])) rules.push({ sel: m[1].trim(), body: m[2] }); }
  assert.ok(rules.filter((r) => /\.ipm-slide/.test(r.sel)).length >= 4, 'the drift rules exist (base, on, drift, reduced motion)');
  for (const r of rules) {
    const b = r.body.toLowerCase();
    assert.ok(!/(^|[;\s])(-webkit-|-moz-)?(filter|backdrop-filter|mask|mask-image|clip-path|animation)(-[a-z-]+)?\s*:/.test(b), 'no filter/mask/backdrop/animation on ' + r.sel);
    const tr = /(?:^|[;\s])(?:-webkit-)?transition\s*:([^;]*)/.exec(b);
    if (tr) {
      tr[1].split(',').forEach((part) => {
        const prop = part.trim().split(/\s+/)[0];
        assert.ok(['opacity', 'transform', 'none'].includes(prop), r.sel + ' transitions ' + prop + ' (only transform/opacity allowed)');
      });
    }
  }
  const js = fs.readFileSync(surfacePath, 'utf8');
  const drift = /---- Addendum E: the cover DRIFT[\s\S]*?\/\/ ---- navigation ----/.exec(js);
  assert.ok(drift, 'the drift block exists');
  const code = drift[0].replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\.style\b|setProperty|cssText/.test(code), 'the drift code writes no inline style - classes only');
  assert.ok(!/['"][^'"\n]*\b(filter|backdrop-filter|mask|blur)\b|webkitFilter|backdropFilter|\.mask\b/i.test(code), 'and names no filter / blur / mask / backdrop anywhere');
});

// ---------------------------------------------------------------- mutant-pass bindings (after the first commit)
test('the sweep letter tick leaves the switch well OFF its midline even when letter mode carries into a NEW gesture (the sweep phase restarts at 0)', async () => {
  const b = bootEngine({ load: songsLoad(LIB), haptic: { engine: 'sweep', detent: 3.75, dither: 18, capture: '8px', buzz: true } });
  try {
    await openSongs(b);
    fastSpin(b, 3); // letter mode on, the finger lifts (the hold keeps it for 1 s)
    assert.ok(b.engine.menuState().letterMode, 'precondition: letter mode survives the lift');
    const g = P(b).querySelector('.mms-haptic-ghost');
    const wheel = P(b).querySelector('.ip-wheel');
    const at = (deg) => { const r = deg * Math.PI / 180; return { clientX: 100 * Math.cos(r), clientY: 100 * Math.sin(r) }; };
    let q = at(0);
    const off = () => Number(/translate\((-?[\d.e-]+)px/.exec(g.style.transform)[1]) - q.clientX;
    const realNow = performance.now; let t = realNow.call(performance);
    Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => t });
    try {
      wheel.dispatchEvent(new b.win.MouseEvent('pointerdown', { bubbles: true, clientX: q.clientX, clientY: q.clientY }));
      let deg = 0;
      const mv = (step, ms) => { t += ms; deg += step; q = at(deg); wheel.dispatchEvent(new b.win.MouseEvent('pointermove', { bubbles: true, clientX: q.clientX, clientY: q.clientY })); return off(); };
      mv(11.5, 8);
      const before = b.engine.menuState().letter;
      const o = mv(11.5, 8); // this move crosses a letter: the first tick of the new gesture
      assert.notStrictEqual(b.engine.menuState().letter, before, 'precondition: a letter was crossed');
      assert.ok(Math.abs(o) >= 9, 'the switch sits at least half its 18 px dither off the midline after the tick (was ' + o + ')');
      wheel.dispatchEvent(new b.win.MouseEvent('pointerup', { bubbles: true }));
    } finally { Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: realNow }); }
  } finally { b.restore(); }
});

test('a library change under the menus (dataVersion) ends letter mode with the stale rows it pointed into', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    fastSpin(b, 3);
    assert.ok(b.engine.menuState().letterMode, 'precondition');
    b.state.ver += 1;           // the view: the library changed
    slowSpin(b, 1);             // the next wheel step sees it and re-loads the level
    assert.strictEqual(b.engine.menuState().letterMode, false, 'letter mode ended with the stale level');
    await flush();
    assert.ok(!overlay(b).classList.contains('is-on'), 'the reloaded list shows no stale letter');
  } finally { b.restore(); }
});

test('E: moving between menu levels (Main -> Music -> Settings) keeps the SAME cover layer mid-pan (the Click screen is patched in place, not re-created)', async () => {
  const b = bootEngine({ coverPool: () => Promise.resolve(POOL.slice()) });
  try {
    const first = await driftUp(b);
    pressSelect(b); // Music
    assert.strictEqual(b.engine.menuState().title, 'Music');
    pressMenu(b); tapLabel(b, 'Settings');
    assert.strictEqual(b.engine.menuState().title, 'Settings');
    assert.ok(first.isConnected && first.classList.contains('is-on') && first.classList.contains('is-drift'), 'the drifting layer survived both level changes (not restarted)');
    assert.strictEqual(slides(b)[0], first);
    // (a paint() - a track change - rebuilds the whole panel, so the drift restarts there: disclosed G4)
  } finally { b.restore(); }
});

test('a drill-in from letter mode (Select on a genre) starts the NEW level out of letter mode - it never carries into a list you did not flick', async () => {
  const genres = Array.from({ length: 30 }, (_, i) => ({ label: String.fromCharCode(65 + (i % 26)) + ' genre ' + i, node: { type: 'genre', key: 'g' + i, label: 'G' + i } }))
    .sort((x, y) => cmpStr(x.label, y.label));
  const b = bootEngine({ load: (n) => Promise.resolve(n.type === 'genres' ? { items: genres, letters: true }
    : n.type === 'genre' ? { items: skins.menuSongItems(LIB.slice(0, 200), artFor), tracks: LIB.slice(0, 200), play: { ctx: { sort: 'title-asc' } }, letters: true } : { items: [] }) });
  try {
    b.engine.paint(); pressMenu(b); pressSelect(b);
    tapLabel(b, 'Genres'); await flush();
    fastSpin(b, 4);
    assert.ok(b.engine.menuState().letterMode, 'precondition: letter mode on Genres');
    pressSelect(b); await flush(); // drill into the landed genre (itself a long alphabetical list)
    assert.strictEqual(b.engine.menuState().node.type, 'genre');
    assert.strictEqual(b.engine.menuState().letterMode, false, 'the new level is not in letter mode');
    assert.ok(!overlay(b).classList.contains('is-on'), 'no overlay on the new level');
    slowSpin(b, 1);
    assert.strictEqual(b.engine.menuState().cursor, 1, 'a slow turn there moves one row');
  } finally { b.restore(); }
});

test('E: a repaint while the document is HIDDEN (a background track change) never restarts the drift', async () => {
  const b = bootEngine({ coverPool: () => Promise.resolve(POOL.slice()) });
  try {
    await driftUp(b);
    Object.defineProperty(b.sdom.window.document, 'hidden', { configurable: true, get: () => true });
    b.sdom.window.document.dispatchEvent(new b.win.Event('visibilitychange'));
    assert.strictEqual(b.engine.menuState().slides, false, 'precondition: stopped');
    b.state.current = 'next'; b.engine.paint(); await flush();
    assert.strictEqual(b.engine.menuState().slides, false, 'the repaint did not restart it while hidden');
    assert.strictEqual(slides(b).length, 0);
    assert.strictEqual(b.engine.menuState().slideTimers, 0);
  } finally { b.restore(); }
});

// ================================================================ gate r1 fixes (@bd90e80e findings)
// spinT: the REAL wheel gesture with the two clocks the engine reads driven separately - the
// handler clock (performance.now, `handlerMs` apart) and each event's own timeStamp (`eventMs`
// apart). A loaded phone runs handlers late: the handler gaps shrink while the event gaps stay true.
function spinT(b, { from = 0, moves, step, handlerMs, eventMs, lift = true, steps }) {
  const wheel = P(b).querySelector('.ip-wheel');
  const at = (deg) => { const r = deg * Math.PI / 180; return { clientX: 100 * Math.cos(r), clientY: 100 * Math.sin(r) }; };
  const realNow = performance.now;
  let t = realNow.call(performance); let te = t; // the event clock on the SAME origin as performance.now()
  const mk = (type, q) => { const ev = new b.win.MouseEvent(type, { bubbles: true, clientX: q.clientX, clientY: q.clientY }); Object.defineProperty(ev, 'timeStamp', { value: te }); return ev; };
  Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => t });
  try {
    wheel.dispatchEvent(mk('pointerdown', at(from)));
    let deg = from;
    const list = steps || Array.from({ length: moves }, () => step);
    for (const st of list) { t += handlerMs; te += (eventMs == null ? handlerMs : eventMs); deg += st; wheel.dispatchEvent(mk('pointermove', at(deg))); }
    if (lift) wheel.dispatchEvent(mk('pointerup', at(deg)));
  } finally { Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: realNow }); }
}

test('r1 Q1: ONE big pointermove (50 deg in 16 ms) never arms letter mode - it is one move, however many detents it spans', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    spinT(b, { steps: [50], handlerMs: 16 });
    assert.strictEqual(b.engine.menuState().letterMode, false, 'one move is not a spin');
    assert.ok(b.engine.menuState().cursor < firstRowOf(LIB, 'A'), 'it moved rows (the v1.233 accel), not a letter: ' + b.engine.menuState().cursor);
  } finally { b.restore(); }
});

test('r1 Q1: in letter mode ONE 90-degree move (four detents) jumps ONE letter, never two', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    fastSpin(b, 3);
    assert.ok(b.engine.menuState().letterMode, 'precondition: letter mode');
    const before = b.engine.menuState().letter;
    spinT(b, { steps: [90], handlerMs: 16 }); // a finger swept across the hub in one move
    const L = skins.MENU_LETTERS;
    const present = skins.menuLetterRuns(LIB.map((t) => ({ label: t.title }))).map((r) => r.letter);
    assert.strictEqual(present.indexOf(b.engine.menuState().letter), present.indexOf(before) + 1, 'exactly one letter on (' + before + ' -> ' + b.engine.menuState().letter + ')');
    assert.ok(L.length === 27);
  } finally { b.restore(); }
});

test('r1 Q1 (adversary W1): a MEDIUM 0.6 deg/ms turn on a loaded phone (handler gaps halved, the events\' own timestamps true) never engages', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    // 6 degrees per move; the handlers ran 5 ms apart (reads as 1.2 deg/ms), the events were 10 ms apart (0.6)
    spinT(b, { moves: 40, step: 6, handlerMs: 5, eventMs: 10 });
    assert.strictEqual(b.engine.menuState().letterMode, false, 'the event clock says medium: no letter mode');
    assert.strictEqual(b.engine.menuState().cursor, 10, 'one row per detent (240 deg = 10 detents at x1)');
    // the control: the same turn on a phone that keeps up (both clocks 5 ms) IS fast and engages
    spinT(b, { moves: 40, step: 6, handlerMs: 5, eventMs: 5 });
    assert.strictEqual(b.engine.menuState().letterMode, true, 'control: a true 1.2 deg/ms spin engages');
  } finally { b.restore(); }
});

test('r1 Q1 (adversary W2): the fast-move count never latches ACROSS gestures - two fast moves, a lift, 60 s, two more: no letter mode', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    spinT(b, { moves: 2, step: 11.5, handlerMs: 8 });
    b.clock.advance(60000);
    spinT(b, { moves: 2, step: 11.5, handlerMs: 8 });
    assert.strictEqual(b.engine.menuState().letterMode, false, 'each gesture starts its count again');
    spinT(b, { moves: 3, step: 11.5, handlerMs: 8 });
    assert.strictEqual(b.engine.menuState().letterMode, true, 'control: three fast moves in ONE gesture engage');
  } finally { b.restore(); }
});

test('r1 Q5 (X1): a SLOW move inside a gesture resets the fast count (fast, fast, slow, fast, fast: no letter mode)', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    spinT(b, { steps: [11.5, 11.5], handlerMs: 8, lift: false });
    spinT(b, { steps: [3], handlerMs: 60, lift: false, from: 23 });
    spinT(b, { steps: [11.5, 11.5], handlerMs: 8, from: 26 });
    assert.strictEqual(b.engine.menuState().letterMode, false);
  } finally { b.restore(); }
});

test('r1 Q5 (X36): the threshold is the 0.8 deg/ms band - a sustained 0.65 deg/ms turn moves one row per detent and never engages', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    spinT(b, { moves: 44, step: 6.5, handlerMs: 10, eventMs: 10 }); // 286 deg = 13 detents
    assert.strictEqual(b.engine.menuState().letterMode, false);
    assert.strictEqual(b.engine.menuState().cursor, 13, 'x1: one row per detent');
  } finally { b.restore(); }
});

test('r1 Q5 (X27): a Seattle PIVOT switch ends letter mode (the overlay never rides onto a list you did not flick)', async () => {
  const b = bootEngine({ skin: 'zune-classic', load: (n) => Promise.resolve(['artists', 'albums', 'songs'].includes(n.type)
    ? { items: skins.menuSongItems(LIB, artFor), tracks: LIB, play: { ctx: { sort: 'title-asc' } }, letters: true } : { items: [] }) });
  try {
    b.engine.paint(); pressMenu(b); pressSelect(b); await flush();
    fastSpin(b, 3);
    assert.ok(b.engine.menuState().letterMode, 'precondition: letter mode on the artists pivot');
    tap(b, P(b).querySelector('[data-skin-next]')); await flush();
    assert.strictEqual(b.engine.menuState().pane, 1, 'moved to the albums pivot');
    assert.strictEqual(b.engine.menuState().letterMode, false, 'the pivot switch ended letter mode');
    assert.ok(!overlay(b).classList.contains('is-on'));
  } finally { b.restore(); }
});

test('r1 Q2 (qa W3): the overlay and the badge are PERSISTENT nodes - letter steps and the hold\'s end toggle the SAME element (so the CSS fade runs)', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    const ov0 = overlay(b); const bd0 = badgeEl(b);
    assert.ok(ov0 && bd0 && !ov0.classList.contains('is-on'), 'the layers exist, OFF, before any spin (born off)');
    fastSpin(b, 5);
    assert.strictEqual(overlay(b), ov0, 'letter steps reuse the overlay node');
    assert.ok(ov0.classList.contains('is-on'));
    b.clock.advance(1100);
    assert.strictEqual(overlay(b), ov0, 'the hold\'s end toggles the SAME node (its fade can run)');
    assert.ok(!ov0.classList.contains('is-on'));
    assert.ok(ov0.textContent.length === 1, 'the fading letter keeps its glyph');
    const list = P(b).querySelector('.ipm-list');
    list.scrollTop = 900; list.dispatchEvent(new b.win.Event('scroll'));
    assert.strictEqual(badgeEl(b), bd0, 'the badge reveal reuses its node');
    b.clock.advance(1100);
    assert.strictEqual(badgeEl(b), bd0); assert.ok(!bd0.classList.contains('is-on'));
  } finally { b.restore(); }
});

test('r1 Q2 (adversary W4): the first cover reads its own style BEFORE its classes turn on (a cached cover otherwise snaps to the end state) - source lock on the ONE swap', () => {
  const js = fs.readFileSync(surfacePath, 'utf8').replace(/\/\/[^\n]*/g, '');
  const m = /function swapSlide\(\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(m, 'swapSlide exists');
  const body = m[1];
  const read = body.search(/void incoming\.offsetWidth|getComputedStyle\(incoming\)/);
  const on = body.indexOf("incoming.classList.add('is-on')");
  assert.ok(read >= 0 && on > read, 'the style read precedes the class flip');
  assert.ok(/raf\(function \(\) \{[\s\S]*void incoming\.offsetWidth[\s\S]*classList\.add\('is-on'\)/.test(body), '...inside the frame that turns it on');
});

test('r1 Q4 (adversary W3): the cover drift PAUSES while Brick (from Extras) holds the wheel, and resumes when the game ends', async () => {
  const b = bootWithBrick({ coverPool: () => Promise.resolve(POOL.slice()) });
  try {
    await driftUp(b);
    assert.strictEqual(b.engine.menuState().slides, true, 'precondition: drifting on the Main Menu');
    tapLabel(b, 'Extras'); tapLabel(b, 'Games');
    assert.strictEqual(b.engine.menuState().slides, true, 'Games is a menu level: still drifting');
    pressSelect(b); // Brick
    assert.ok(b.wiring.isRunning(), 'precondition: the game runs');
    assert.strictEqual(b.engine.menuState().slides, false, 'paused under the game');
    assert.strictEqual(b.engine.menuState().slideTimers, 0, 'no drift timer while the game runs');
    assert.strictEqual(slides(b).length, 0);
    b.clock.advance(20000);
    assert.strictEqual(slides(b).length, 0, 'still nothing 20 s into the game');
    pressMenu(b); await flush();
    assert.ok(!b.wiring.isRunning());
    assert.strictEqual(b.engine.menuState().slides, true, 'the game ended: the drift resumes');
  } finally { b.restore(); }
});

test('r1 (adversary S2): with the picker open, a tap on Play or Next ONLY closes it - no play/pause, no skip', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    let pp = 0, nx = 0;
    b.sdom.window.document.getElementById('pp-btn').addEventListener('click', () => { pp += 1; });
    b.sdom.window.document.getElementById('track-next-btn').addEventListener('click', () => { nx += 1; });
    const open = () => { fastSpin(b, 3); tap(b, overlay(b)); assert.ok(gridEl(b)); };
    open(); tap(b, P(b).querySelector('[data-skin-play]'));
    assert.strictEqual(gridEl(b), null); assert.strictEqual(pp, 0, 'Play did not act');
    open(); tap(b, P(b).querySelector('[data-skin-next]'));
    assert.strictEqual(gridEl(b), null); assert.strictEqual(nx, 0, 'Next did not skip');
    tap(b, P(b).querySelector('[data-skin-play]'));
    assert.strictEqual(pp, 1, 'control: with the picker closed Play acts');
  } finally { b.restore(); }
});

test('r1 cover pool: a RANDOM sample across the whole album list (not the first 60 by title), same-origin paths only (rejects // and /\\)', () => {
  const tracks = Array.from({ length: 200 }, (_, i) => ({ id: 'a' + i, albumKey: 'k' + i, hasArt: true }));
  let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pool = skins.menuCoverPool(tracks, artFor, rand);
  assert.strictEqual(pool.length, 60);
  assert.strictEqual(new Set(pool).size, 60, 'no duplicates');
  assert.ok(pool.some((u) => Number(u.replace('/albumart/a', '')) >= 60), 'covers from beyond the first 60 albums');
  assert.deepStrictEqual(skins.menuCoverPool([{ id: 'x', hasArt: true, artUrl: '/\\evil.example/a.jpg' }, { id: 'y', hasArt: true, artUrl: '//evil.example/b.jpg' }, { id: 'z', hasArt: true, artUrl: '/' }], artFor), [], 'off-site spellings and a bare "/" rejected');
  assert.deepStrictEqual(skins.menuCoverPool([{ id: 'ok', hasArt: true, artUrl: '/thumbnail/ok' }], artFor), ['/thumbnail/ok']);
});

test('r1 (adversary S4): when EVERY cover fails, the pane falls back to today\'s art - never a blank pane', async () => {
  const b = bootEngine({ coverPool: () => Promise.resolve(['/albumart/dead1', '/albumart/dead2']) });
  try {
    b.engine.paint(); pressMenu(b); await flush(); await flush();
    for (let k = 0; k < 2; k++) { const s = slides(b)[0]; assert.ok(s, 'a cover is preloading'); fire(b, s, 'error'); }
    b.clock.advance(200);
    assert.strictEqual(b.engine.menuState().slides, false, 'the drift gave up');
    assert.strictEqual(P(b).querySelector('.ipm-art .ipm-art-img').getAttribute('src'), '/albumart/now', 'today\'s pane');
  } finally { b.restore(); }
});

test('r1 (qa S6): a library change while the drift runs re-fetches the covers at the next swap and the drift keeps going (never freezes)', async () => {
  let n = 0;
  const b = bootEngine({ coverPool: () => { n += 1; return Promise.resolve(n === 1 ? POOL.slice() : ['/albumart/new1', '/albumart/new2']); } });
  try {
    await driftUp(b);
    b.state.ver += 1; // the view: the library changed
    b.clock.advance(1400);
    const next = slides(b).find((x) => !x.classList.contains('is-on'));
    fire(b, next);
    b.clock.advance(7700); await flush(); // the swap (9 s after the first cover) - its fade timer not yet due
    assert.strictEqual(n, 2, 'the swap re-fetched the covers for the new library');
    assert.ok(next.classList.contains('is-on'), 'and the drift moved on');
    b.clock.advance(1400);
    const after = slides(b).find((x) => !x.classList.contains('is-on'));
    assert.ok(after && ['/albumart/new1', '/albumart/new2'].includes(after.getAttribute('src')), 'the next cover comes from the NEW pool');
  } finally { b.restore(); }
});

test('r1 (qa S8): a "recent" list that is NOT on screen re-loads after the playing track changes; the one on screen keeps its rows', async () => {
  const b = bootEngine({ skin: 'zune-classic', load: (n) => Promise.resolve({ items: [{ label: n.type + ' row', node: { type: 'artist', key: 'x' } }] }) });
  try {
    b.engine.paint(); pressMenu(b); pressSelect(b); await flush(); // the pivots (artists)
    tap(b, P(b).querySelector('[data-skin-prev]')); await flush(); // the "recent" pivot (last, wraps)
    const loads = () => b.spy.loads.filter((x) => x.type === 'recentArtists').length;
    assert.strictEqual(loads(), 1);
    b.state.current = 'b'; b.engine.paint(); await flush();
    assert.strictEqual(loads(), 1, 'on screen: not re-loaded under the finger');
    tap(b, P(b).querySelector('[data-skin-next]')); await flush(); // off it
    b.state.current = 'c'; b.engine.paint(); await flush();
    tap(b, P(b).querySelector('[data-skin-prev]')); await flush(); // back
    assert.strictEqual(loads(), 2, 'off screen during a new listen: re-loaded when shown again');
  } finally { b.restore(); }
});

test('r1 (adversary S1): the letter of EVERY Latin, fullwidth, circled and Roman letter matches the bucket the SERVER\'s cmpStr sorts it into', () => {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const expected = (ch) => {
    const lab = ch + 'x';
    if (cmpStr(lab, 'A') < 0) return '#';
    for (let i = 0; i < 26; i++) {
      const hi = i < 25 ? L[i + 1] : null;
      if (cmpStr(lab, L[i]) >= 0 && (hi ? cmpStr(lab, hi) < 0 : cmpStr(lab, 'Zzzzzz') <= 0)) return L[i];
    }
    return '#';
  };
  const bad = [];
  for (const [a, z] of [[0xA1, 0x24F], [0x1E00, 0x1EFF], [0xFF21, 0xFF3A], [0xFF41, 0xFF5A], [0x24B6, 0x24E9], [0x2160, 0x217F]]) {
    for (let c = a; c <= z; c++) {
      const ch = String.fromCodePoint(c);
      if (!/\p{L}|\p{N}|\p{So}/u.test(ch)) continue;
      if (expected(ch) !== skins.menuLetterOf(ch)) bad.push(ch + ' U+' + c.toString(16));
    }
  }
  assert.deepStrictEqual(bad, [], 'filed under a different letter than the server sorts them');
  assert.deepStrictEqual(['ＡＫＩＲＡ', 'ａｂｃ', 'Ⓐlpha', 'Ⅻ Suite', 'Ǽther', 'ǅivo', 'æther', 'ølstykke', 'łódź'].map(skins.menuLetterOf), ['A', 'A', 'A', 'X', 'A', 'D', 'A', 'O', 'L']);
});

test('r1 Q3 (qa W4 + S5) CSS lock: the A-Z picker centres SAFELY (a short LCD keeps its first rows reachable) and Click drops to six columns under 340 px', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const base = /\.mms-ipod \.ipm-grid\{([^}]*)\}/.exec(css);
  assert.ok(base, 'the picker rule');
  assert.match(base[1], /align-content:\s*safe center/i, 'safe centring (plain `center` puts overflowing first rows above the scroll origin)');
  assert.ok(!/\.mms-zune-classic \.ipm-grid\{[^}]*align-content/i.test(css), 'Seattle inherits it (no plain-centre override)');
  assert.match(css, /@media \(max-width: 340px\)\{ \.mms-ipod:not\(\.mms-zune-classic\) \.ipm-grid\{ grid-template-columns:repeat\(6, minmax\(0, 1fr\)\); \} \}/, 'six Click columns under 340 px');
});

test('r1 Q4: the engine\'s own release resumes the drift - a GENERIC takeover whose onExit clears nothing (the engine never learns what it is talking to)', async () => {
  const b = bootEngine({ coverPool: () => Promise.resolve(POOL.slice()) });
  try {
    await driftUp(b);
    let exited = 0;
    b.engine.setWheelTakeover({ onRotate() {}, onExit() { exited += 1; } });
    assert.strictEqual(b.engine.menuState().slides, false, 'paused under the takeover');
    pressMenu(b); await flush(); // MENU releases the takeover through the engine (onExit does NOT call setWheelTakeover(null))
    assert.strictEqual(exited, 1);
    assert.strictEqual(b.engine.menuState().slides, true, 'the release itself resumed the drift');
    assert.strictEqual(b.engine.menuState().title, 'Click', 'and MENU only ended the takeover');
  } finally { b.restore(); }
});

// ================================================================ gate r2 (@dfd0165e)
test('r2 (qa NEW-1 = adversary W, repro 1): playing FROM Recently Played, a queue advance, then MENU from Now Playing lands on the song that PLAYS (the list played from is never re-loaded under it)', async () => {
  const T = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => ({ id: 'T-' + k, title: 'T-' + k }));
  let rec = T.slice();
  const b = bootEngine({ load: (n) => Promise.resolve(n.type === 'playlist'
    ? { items: skins.menuSongItems(rec, artFor), tracks: rec.slice(), play: { ctx: { filter: 'recent-listening' } } } : { items: [] }) });
  try {
    b.engine.paint(); pressMenu(b); pressSelect(b);
    tapLabel(b, 'Playlists'); tapLabel(b, 'Recently Played'); await flush();
    tapLabel(b, 'T-d'); // play row 3
    b.state.current = 'T-d'; rec = [T[3], T[0], T[1], T[2], T[4], T[5]]; b.engine.paint(); await flush();
    b.state.current = 'T-e'; rec = [T[4], T[3], T[0], T[1], T[2], T[5]]; b.engine.paint(); await flush();
    pressMenu(b); await flush();
    assert.strictEqual(b.engine.menuState().title, 'Recently Played');
    assert.strictEqual(cursorLbl(b), 'T-e', 'the highlight is on the song that plays');
  } finally { b.restore(); }
});

test('r2 (adversary W, repro 2 = qa NEW-3): Recent Artists > A2 > play, MENU x2 lands back on A2 after the list re-ordered itself (restored by IDENTITY, not index)', async () => {
  const A = ['A0', 'A1', 'A2', 'A3'];
  let rec = A.slice();
  const songsOf = (a) => [{ id: a + '-s', title: a + ' song', artist: a }];
  const b = bootEngine({ load: (n) => Promise.resolve(n.type === 'recentArtists'
    ? { items: rec.map((a) => ({ label: a, node: { type: 'artist', key: a, label: a } })) }
    : n.type === 'artist' ? { items: skins.menuSongItems(songsOf(n.key), artFor), tracks: songsOf(n.key), play: { ctx: {} } } : { items: [] }) });
  try {
    b.engine.paint(); pressMenu(b); pressSelect(b);
    tapLabel(b, 'Recent Artists'); await flush();
    tapLabel(b, 'A2'); await flush();
    tapLabel(b, 'A2 song');
    b.state.current = 'A2-s'; rec = ['A2', 'A0', 'A1', 'A3']; b.engine.paint(); await flush();
    pressMenu(b); await flush(); // Now Playing -> the artist's list
    pressMenu(b); await flush(); // -> Recent Artists (re-loaded: A2 now first)
    assert.strictEqual(b.engine.menuState().title, 'Recent Artists');
    assert.deepStrictEqual(lbls(b).slice(0, 4), ['A2', 'A0', 'A1', 'A3'], 'precondition: the list re-loaded in its new recency order');
    assert.strictEqual(cursorLbl(b), 'A2', 'the highlight is back on the artist you came from');
  } finally { b.restore(); }
});

test('r2 (adversary S-d, N2): the speed rule\'s HANDLER half binds too - events stamped fast but handlers 60 ms apart read as slow (no letter mode)', async () => {
  const b = bootEngine({ load: songsLoad(LIB) });
  try {
    await openSongs(b);
    spinT(b, { moves: 12, step: 11.5, handlerMs: 60, eventMs: 8 });
    assert.strictEqual(b.engine.menuState().letterMode, false, 'the longer (handler) gap wins');
    assert.strictEqual(b.engine.menuState().cursor, 6, 'one row per detent');
  } finally { b.restore(); }
});

test('r2 (security-brief INFO 1, adversary S-a): a cover path must RESOLVE on its own origin - tab / LF / CR smuggling is rejected', () => {
  const bad = ['/\t/evil.example/a.jpg', '/\n/evil.example/a.jpg', '/\r\\evil.example/a.jpg', '/\\evil.example/a', '//evil.example/a', '/'];
  assert.deepStrictEqual(skins.menuCoverPool(bad.map((u, i) => ({ id: 'x' + i, albumKey: 'k' + i, hasArt: true, artUrl: u })), artFor), []);
  assert.deepStrictEqual(skins.menuCoverPool([{ id: 'ok', hasArt: true, artUrl: '/thumbnail/ok%2F%2Fx' }], artFor), ['/thumbnail/ok%2F%2Fx'], 'an encoded slash stays a same-origin path');
});
