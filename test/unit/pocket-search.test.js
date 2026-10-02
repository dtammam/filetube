// [UNIT] v1.354 (W4): iPod-style search. The pure strip/query/URL math, the skins-name filter, and the controller through
// the REAL engine: the wheel moves along the strip, center adds a letter, MENU deletes one, results narrow live behind a
// debounce, and a slow first query never lands over a newer one (LESSONS 4, TOCTOU).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const skins = require(skinsPath);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DEBOUNCE = 320;

// ---------------------------------------------------------------- the pure half
test('strip: letters A-Z, digits, space, delete, go; the marker wraps at both ends', () => {
  const ids = skins.SEARCH_STRIP.map((c) => c.id);
  assert.deepStrictEqual(ids.slice(0, 3), ['A', 'B', 'C']);
  assert.deepStrictEqual(ids.slice(-3), ['space', 'del', 'go']);
  assert.strictEqual(ids.length, 26 + 10 + 3);
  const n = ids.length;
  assert.strictEqual(skins.searchStripStep(0, 1), 1);
  assert.strictEqual(skins.searchStripStep(0, -1), n - 1, 'before A wraps to the last cell');
  assert.strictEqual(skins.searchStripStep(n - 1, 1), 0, 'past the last cell wraps to A');
  assert.strictEqual(skins.searchStripStep(5, -12), n - 7, 'a fast spin wraps too');
  assert.strictEqual(skins.searchStripStep('x', undefined), 0, 'junk is cell 0');
});

test('strip view: an odd window centered on the marker, wrapping', () => {
  const v = skins.searchStripView(0, 5);
  assert.deepStrictEqual(v.map((c) => c.id), ['go', 'del', 'A', 'B', 'C'].map((x, i) => (i === 0 ? 'del' : i === 1 ? 'go' : x)).length ? v.map((c) => c.id) : []);
  assert.deepStrictEqual(v.map((c) => c.id), ['del', 'go', 'A', 'B', 'C']);
  assert.deepStrictEqual(v.map((c) => c.on), [false, false, true, false, false], 'exactly the middle cell is the marker');
});

test('edit: a letter adds, space needs a word before it and never doubles, delete drops one, go changes nothing, 40 is the cap', () => {
  assert.strictEqual(skins.searchEdit('', 'P'), 'P');
  assert.strictEqual(skins.searchEdit('PR', 'O'), 'PRO');
  assert.strictEqual(skins.searchEdit('', 'space'), '', 'no leading space');
  assert.strictEqual(skins.searchEdit('AB', 'space'), 'AB ');
  assert.strictEqual(skins.searchEdit('AB ', 'space'), 'AB ', 'no double space');
  assert.strictEqual(skins.searchEdit('AB', 'del'), 'A');
  assert.strictEqual(skins.searchEdit('', 'del'), '');
  assert.strictEqual(skins.searchEdit('AB', 'go'), 'AB');
  assert.strictEqual(skins.searchEdit('AB', '<script>'), 'AB', 'only strip cells edit');
  const full = 'A'.repeat(40);
  assert.strictEqual(skins.searchEdit(full, 'B'), full);
  assert.strictEqual(skins.searchEdit(full, 'space'), full);
});

test('urls: the routes\' own search= param, encoded, three bounded reads', () => {
  const u = skins.searchUrls('R&B 50%');
  assert.strictEqual(u.songs, '/api/music?search=R%26B%2050%25&sort=title-asc&limit=30');
  assert.strictEqual(u.albums, '/api/music/albums?search=R%26B%2050%25&sort=title-asc&limit=12');
  assert.strictEqual(u.artists, '/api/music/artists?search=R%26B%2050%25&sort=title-asc&limit=12');
});

test('results: grouped Songs / Albums / Artists under read-only headings; an empty group has no heading; songs index into tracks', () => {
  const r = skins.menuSearchItems({
    songs: [{ id: 's1', title: 'Probe', artist: 'X' }, { id: 's2', title: 'Pro', artist: 'Y' }],
    albums: [{ album: 'Proto', albumKey: 'k1', artist: 'Z' }],
    artists: [],
  }, () => '');
  assert.deepStrictEqual(r.items.map((i) => i.label), ['Songs', 'Probe', 'Pro', 'Albums', 'Proto']);
  assert.deepStrictEqual(r.items.filter((i) => i.heading).map((i) => !!i.info), [true, true]);
  assert.deepStrictEqual(r.items.filter((i) => i.song).map((i) => i.trackIndex), [0, 1]);
  assert.strictEqual(r.tracks.length, 2);
  assert.deepStrictEqual(r.items[4].node, { type: 'album', key: 'k1', label: 'Proto' });
  assert.deepStrictEqual(skins.menuSearchItems(null, null).items, []);
});

test('next stop: headings are never wheel stops; the ends stay put', () => {
  const items = [{ info: true }, { label: 'a' }, { label: 'b' }, { info: true }, { label: 'c' }];
  assert.strictEqual(skins.searchNextStop(items, -1, 1), 1);
  assert.strictEqual(skins.searchNextStop(items, 2, 1), 4, 'steps over the heading');
  assert.strictEqual(skins.searchNextStop(items, 4, -1), 2);
  assert.strictEqual(skins.searchNextStop(items, 1, -1), 1, 'nothing before the first row: stays');
  assert.strictEqual(skins.searchNextStop(items, 4, 1), 4);
});

test('skins filter: every word must be in the name, case-blind; the check follows the saved skin', () => {
  const all = skins.skinSearchItems('', 'ipod-matte');
  assert.strictEqual(all.length, skins.IDS.length, 'an empty query lists every skin');
  const hit = skins.skinSearchItems('classic 6g black', 'ipod-matte');
  assert.deepStrictEqual(hit.map((r) => r.skinId).sort(), ['ipod-charcoal', 'ipod-matte']);
  assert.deepStrictEqual(hit.filter((r) => r.check).map((r) => r.skinId), ['ipod-matte']);
  assert.ok(hit.every((r) => r.action === 'skin' && r.preview === true));
  assert.deepStrictEqual(skins.skinSearchItems('NORDIC', 'ipod').map((r) => r.skinId), ['spotify']);
  assert.strictEqual(skins.skinSearchItems('no such skin xyz', 'ipod').length, 0);
});

test('levels: Music ends with Search; the skins level ends with Search; both are titled', () => {
  const music = skins.menuStaticItems({ type: 'music' }, {});
  assert.deepStrictEqual(music[music.length - 1], { label: 'Search', node: { type: 'search' } });
  const sk = skins.menuStaticItems({ type: 'skins' }, { activeSkin: 'ipod' });
  assert.deepStrictEqual(sk[sk.length - 1], { label: 'Search', node: { type: 'skinSearch' } });
  assert.strictEqual(skins.menuTitle({ type: 'search' }, 'click'), 'Search');
  assert.strictEqual(skins.menuTitle({ type: 'skinSearch' }, 'click'), 'Search');
  assert.strictEqual(skins.menuIsItemLevel({ type: 'skinSearch' }), false);
});

// ---------------------------------------------------------------- the controller (REAL engine)
// ---------------------------------------------------------------- the controller (REAL engine)
function boot({ withSticker = true, search = null } = {}) {
  const dom = new JSDOM('<body><video id="media-player"></video><button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button><input id="seek-bar" type="range" /><div id="panel" class="music-nowplaying-panel" hidden></div></body>', { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, Event: global.Event, localStorage: global.localStorage };
  Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event, localStorage: dom.window.localStorage });
  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const S = dom.window.FileTubeMusicSkins;
  S.setActiveSkin('ipod-black');
  const spy = { changed: 0 };
  const plays = [];
  const cfg = {
    getSkinId: () => S.activeSkinId(),
    panel: dom.window.document.getElementById('panel'),
    getCtx: () => ({ track: { title: 'T', artist: 'A', artUrl: '/albumart/now' }, upNext: [], fullList: [], playing: true }),
    hostCtl: (id) => dom.window.document.getElementById(id), onSelectIndex: () => {}, onDock: () => {}, win: dom.window,
    menu: { load: () => Promise.resolve({ items: [] }), onPlay(r) { plays.push(r); }, search, onShuffleAll() {}, hasCurrent: () => false, currentId: () => null },
  };
  if (withSticker) cfg.sticker = { onSkinChange: () => { spy.changed += 1; engine.paint(); } };
  const engine = dom.window.FileTubeSkinSurface.create(cfg);
  engine.paint();
  return { dom, engine, S, spy, plays, restore: () => { engine.destroy(); Object.assign(global, saved); } };
}
const P = (b) => b.dom.window.document.getElementById('panel');
const tap = (b, el) => { for (const t of ['pointerdown', 'pointerup', 'click']) el.dispatchEvent(new b.dom.window.MouseEvent(t, { bubbles: true })); };
const wheelBy = (b, degs) => {
  const w = P(b).querySelector('.ip-wheel');
  const at = (d) => ({ clientX: 100 * Math.cos(d * Math.PI / 180), clientY: 100 * Math.sin(d * Math.PI / 180) });
  w.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', Object.assign({ bubbles: true }, { clientX: 100, clientY: 0 })));
  const sgn = degs < 0 ? -1 : 1;
  for (let d = 8; d <= Math.abs(degs); d += 8) w.dispatchEvent(new b.dom.window.MouseEvent('pointermove', Object.assign({ bubbles: true }, at(sgn * d))));
  w.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true }));
};
const pressMenu = (b) => tap(b, P(b).querySelector('[data-skin-menu]'));
const rowsOf = (b) => [...P(b).querySelectorAll('.ipm-row:not(.ipm-skel)')];
const tapLabel = (b, label) => { const r = rowsOf(b).find((x) => x.querySelector('.ipm-lbl').textContent === label); if (!r) throw new Error('no row ' + label); tap(b, r); };
const cursorLabel = (b) => { const r = P(b).querySelector('.ipm-row.is-cursor .ipm-lbl'); return r && r.textContent; };

const sc = (b) => { const e = P(b).querySelector('.ipm-sc.is-on'); return e && e.getAttribute('aria-label'); };
const query = (b) => { const e = P(b).querySelector('.ipm-q'); return e && (e.classList.contains('is-empty') ? '' : e.textContent); };
const select = (b) => tap(b, P(b).querySelector('[data-skin-select]'));
const goSearch = (b) => { tapLabel(b, 'Music'); tapLabel(b, 'Search'); };
const markerIndex = (b) => Number(P(b).querySelector('.ipm-sc.is-on').getAttribute('data-skin-strip'));
// Touch a cell: when it is not in the 5-cell window yet, turn the wheel toward it first (one 24-degree gesture is one detent).
const typeCell = (b, id) => {
  const N = skins.SEARCH_STRIP.length;
  const idx = skins.SEARCH_STRIP.findIndex((c) => c.id === id);
  for (let k = 0; k < 20; k++) {
    const el = [...P(b).querySelectorAll('.ipm-sc')].find((e) => e.getAttribute('data-skin-strip') === String(idx));
    if (el) { tap(b, el); return; }
    const d = ((idx - markerIndex(b)) % N + N) % N;
    wheelBy(b, d <= N / 2 ? 24 : -24);
  }
  throw new Error('could not reach cell ' + id);
};
const deferred = () => { let res; let rej; const p = new Promise((a, c) => { res = a; rej = c; }); return { p, res, rej }; };
const built = (labels) => ({ items: labels.map((l, i) => ({ label: l, song: true, id: 's' + l, trackIndex: i })), tracks: labels.map((l) => ({ id: 's' + l, title: l })), play: { ctx: { src: 'music', search: 'x', sort: 'title-asc' }, label: 'Search' } });

test('Music > Search opens the strip on A with an empty query and no results; touching a cell types it', () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }) });
  try {
    goSearch(b);
    assert.strictEqual(b.engine.menuState().title, 'Search');
    assert.strictEqual(sc(b), 'A');
    assert.strictEqual(query(b), '');
    assert.match(P(b).querySelector('.ipm-note').textContent, /Type to search/);
    typeCell(b, 'A');
    assert.strictEqual(query(b), 'A');
  } finally { b.restore(); }
});

test('the wheel moves the marker along the strip (both ways, wrapping); center adds the letter under it', () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }) });
  try {
    goSearch(b);
    wheelBy(b, 24);
    const fwd = sc(b);
    assert.strictEqual(fwd, 'E', 'a clockwise detent (24 degrees) moves the marker four cells');
    select(b);
    assert.strictEqual(query(b), fwd, 'center adds the letter under the marker');
    wheelBy(b, -24);
    assert.strictEqual(sc(b), 'A', 'counter-clockwise comes back');
    wheelBy(b, -24);
    assert.strictEqual(sc(b), '9', 'four cells before A wraps to the end of the strip (digits, space, delete, results)');
  } finally { b.restore(); }
});

test('MENU deletes one letter at a time and, on an empty query, climbs back to Music', () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }) });
  try {
    goSearch(b);
    typeCell(b, 'A'); typeCell(b, 'B');
    assert.strictEqual(query(b), 'AB');
    pressMenu(b);
    assert.strictEqual(query(b), 'A');
    assert.strictEqual(b.engine.menuState().title, 'Search');
    pressMenu(b);
    assert.strictEqual(query(b), '');
    assert.strictEqual(b.engine.menuState().title, 'Search', 'deleting the last letter does not leave');
    pressMenu(b);
    assert.strictEqual(b.engine.menuState().title, 'Music', 'an empty query climbs back');
  } finally { b.restore(); }
});

test('results narrow behind the debounce: one read for a burst of letters, with the final query', async () => {
  const seen = [];
  const b = boot({ search: (q) => { seen.push(q); return Promise.resolve(built(['Pro ' + q])); } });
  try {
    goSearch(b);
    typeCell(b, 'P'); typeCell(b, 'R'); typeCell(b, 'O');
    assert.deepStrictEqual(seen, [], 'nothing is read while the user is still typing');
    await wait(DEBOUNCE);
    assert.deepStrictEqual(seen, ['PRO'], 'one read, for the whole word');
    assert.deepStrictEqual(rowsOf(b).map((r) => r.querySelector('.ipm-lbl').textContent), ['Pro PRO']);
  } finally { b.restore(); }
});

test('a slow first query never lands over a newer one (stale-response guard)', async () => {
  const d = { P: deferred(), PR: deferred() };
  const b = boot({ search: (q) => d[q].p });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    typeCell(b, 'R');
    await wait(DEBOUNCE);
    d.PR.res(built(['new']));
    await wait(20);
    d.P.res(built(['old']));
    await wait(20);
    assert.deepStrictEqual(rowsOf(b).map((r) => r.querySelector('.ipm-lbl').textContent), ['new'], 'the late answer to P is dropped');
  } finally { b.restore(); }
});

test('an answer for a query the user has since deleted does not land', async () => {
  const d = deferred();
  const b = boot({ search: () => d.p });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    pressMenu(b);
    assert.strictEqual(query(b), '');
    d.res(built(['ghost']));
    await wait(20);
    assert.deepStrictEqual(rowsOf(b), [], 'the emptied query shows no results');
  } finally { b.restore(); }
});

test('a failed read says so and the next letter retries', async () => {
  let n = 0;
  const b = boot({ search: () => (++n === 1 ? Promise.reject(new Error('down')) : Promise.resolve(built(['ok']))) });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    assert.match(P(b).querySelector('.ipm-note').textContent, /Couldn.t search/);
    typeCell(b, 'R');
    await wait(DEBOUNCE);
    assert.deepStrictEqual(rowsOf(b).map((r) => r.querySelector('.ipm-lbl').textContent), ['ok']);
  } finally { b.restore(); }
});

test('the go cell hands the wheel to the results; a row plays IN the result list; up past the first row returns to the strip; MENU too', async () => {
  const b = boot({ search: () => Promise.resolve({ items: [{ label: 'Songs', info: true, heading: true, value: '' }, { label: 'One', song: true, id: 'a', trackIndex: 0 }, { label: 'Two', song: true, id: 'b', trackIndex: 1 }],
    tracks: [{ id: 'a' }, { id: 'b' }], play: { ctx: { src: 'music', search: 'P', sort: 'title-asc' }, label: 'Search' } }) });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    assert.strictEqual(cursorLabel(b), null, 'while the strip has the wheel no result row is highlighted');
    typeCell(b, 'go');
    assert.strictEqual(cursorLabel(b), 'One', 'go lands on the first RESULT, never the heading');
    wheelBy(b, 24);
    assert.strictEqual(cursorLabel(b), 'Two');
    wheelBy(b, -24);
    wheelBy(b, -24);
    assert.strictEqual(cursorLabel(b), null, 'up past the first row gives the wheel back to the strip');
    typeCell(b, 'go');
    wheelBy(b, 24);
    select(b);
    assert.strictEqual(b.plays.length, 1);
    assert.strictEqual(b.plays[0].index, 1);
    assert.deepStrictEqual(b.plays[0].tracks.map((t) => t.id), ['a', 'b']);
    assert.strictEqual(b.plays[0].play.ctx.search, 'P');
  } finally { b.restore(); }
});

test('MENU from the results goes back to the strip before it deletes anything', async () => {
  const b = boot({ search: () => Promise.resolve(built(['One'])) });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    typeCell(b, 'go');
    assert.strictEqual(cursorLabel(b), 'One');
    pressMenu(b);
    assert.strictEqual(cursorLabel(b), null);
    assert.strictEqual(query(b), 'P', 'the query is intact');
  } finally { b.restore(); }
});

test('Extras > Skins > Search filters the registry by name; the wheel picks, Select saves', () => {
  const b = boot();
  try {
    tapLabel(b, 'Extras'); tapLabel(b, 'Skins'); tapLabel(b, 'Search');
    assert.strictEqual(b.engine.menuState().title, 'Search');
    assert.strictEqual(b.engine.menuState().count, skins.IDS.length, 'an empty query lists every skin');
    for (const ch of ['N', 'O', 'R', 'D', 'I', 'C']) typeCell(b, ch);
    assert.strictEqual(query(b), 'NORDIC');
    assert.deepStrictEqual(rowsOf(b).map((r) => r.querySelector('.ipm-lbl').textContent), ['Nordic']);
    typeCell(b, 'go');
    select(b);
    assert.strictEqual(b.S.activeSkinId(), 'spotify', 'Select on the filtered row saves that skin');
  } finally { b.restore(); }
});
