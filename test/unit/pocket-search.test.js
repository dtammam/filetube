// [UNIT] v1.354 (W4): iPod-style search. The pure strip/query/URL math, the skins-name filter, and the controller through
// the REAL engine: the wheel moves along the strip, center adds a letter, MENU deletes one, results narrow live behind a
// debounce, and a slow first query never lands over a newer one (LESSONS 4, TOCTOU).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const skins = require(skinsPath);
const fs = require('node:fs');
const path = require('node:path');
const { cssRules } = require('../helpers/stylesheets');

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
  // only the strip's own ids edit: no lowercase, no multi-character, no empty, no punctuation
  assert.strictEqual(skins.searchEdit('A', 'b'), 'A', 'a lowercase id is not a strip cell');
  assert.strictEqual(skins.searchEdit('A', 'AB'), 'A', 'two characters are not one cell');
  assert.strictEqual(skins.searchEdit('A', ''), 'A');
  assert.strictEqual(skins.searchEdit('A', '-'), 'A');
  assert.strictEqual(skins.searchEdit('A', '9'), 'A9');
  assert.strictEqual(skins.searchEdit(null, 'A'), 'A', 'a missing query is empty');
});

test('urls: a trailing space (a typed word break) never reaches the route', () => {
  const u = skins.searchUrls('AB ');
  assert.strictEqual(u.songs, '/api/music?search=AB&sort=title-asc&limit=30');
  assert.strictEqual(u.albums, '/api/music/albums?search=AB&sort=title-asc&limit=12');
  assert.strictEqual(u.artists, '/api/music/artists?search=AB&sort=title-asc&limit=12');
  assert.strictEqual(skins.searchUrls(null).songs, '/api/music?search=&sort=title-asc&limit=30');
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
  const ver = { v: 1, liked: 1 };
  const cfg = {
    getSkinId: () => S.activeSkinId(),
    panel: dom.window.document.getElementById('panel'),
    getCtx: () => ({ track: { title: 'T', artist: 'A', artUrl: '/albumart/now' }, upNext: [], fullList: [], playing: true }),
    hostCtl: (id) => dom.window.document.getElementById(id), onSelectIndex: () => {}, onDock: () => {}, win: dom.window,
    menu: { dataVersion: () => ver.v, likedVersion: () => ver.liked, load: () => Promise.resolve({ items: [] }), onPlay(r) { plays.push(r); }, search, onShuffleAll() {}, hasCurrent: () => false, currentId: () => null },
  };
  if (withSticker) cfg.sticker = { onSkinChange: () => { spy.changed += 1; engine.paint(); } };
  const engine = dom.window.FileTubeSkinSurface.create(cfg);
  engine.paint();
  return { dom, engine, S, spy, plays, ver, restore: () => { engine.destroy(); Object.assign(global, saved); } };
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
  // the step count per gesture depends on the gesture's speed (the engine's acceleration), so the cell is
  // asserted as a RANGE and the direction, never one exact cell
  const b = boot({ search: () => Promise.resolve({ items: [] }) });
  try {
    goSearch(b);
    const N = skins.SEARCH_STRIP.length;
    assert.strictEqual(markerIndex(b), 0);
    wheelBy(b, 24);
    const fwd = markerIndex(b);
    assert.ok(fwd >= 1 && fwd <= 4, 'a clockwise turn moves the marker forward (got ' + fwd + ')');
    select(b);
    assert.strictEqual(query(b), skins.SEARCH_STRIP[fwd].id, 'center adds the letter under the marker');
    wheelBy(b, -24);
    const back = markerIndex(b);
    assert.ok(back < fwd, 'counter-clockwise comes back (got ' + back + ')');
    wheelBy(b, -24 * 4);
    const wrapped = markerIndex(b);
    assert.ok(wrapped > N - 20, 'turning back past A wraps to the end of the strip (got ' + wrapped + ')');
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
    typeCell(b, 'P');
    await wait(DEBOUNCE / 2);
    typeCell(b, 'R');
    await wait(DEBOUNCE / 2);
    typeCell(b, 'O');
    await wait(DEBOUNCE / 2);
    assert.deepStrictEqual(seen, [], 'nothing is read while the user is still typing (each letter restarts the wait)');
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

// ---------------------------------------------------------------- gate r1: the guards, each bound by a behaviour
const labelsOf = (b) => rowsOf(b).map((r) => r.querySelector('.ipm-lbl').textContent);
const threeRows = () => ({ items: [{ label: 'Songs', info: true, heading: true, value: '' }, { label: 'One', song: true, id: 'a', trackIndex: 0 }, { label: 'Two', song: true, id: 'b', trackIndex: 1 }],
  tracks: [{ id: 'a' }, { id: 'b' }], play: { ctx: { src: 'music', search: 'P', sort: 'title-asc' }, label: 'Search' } });

test('a query emptied after results landed clears them, and a stale error note, without asking the library for ""', async () => {
  const seen = [];
  let n = 0;
  const b = boot({ search: (q) => { seen.push(q); return ++n === 1 ? Promise.reject(new Error('down')) : Promise.resolve(built(['One'])); } });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    assert.match(P(b).querySelector('.ipm-note').textContent, /Couldn.t search/);
    typeCell(b, 'R');
    await wait(DEBOUNCE);
    assert.deepStrictEqual(labelsOf(b), ['One']);
    pressMenu(b); pressMenu(b);
    assert.strictEqual(query(b), '');
    assert.deepStrictEqual(rowsOf(b), [], 'the results are gone with the query');
    assert.match(P(b).querySelector('.ipm-note').textContent, /Type to search/);
    await wait(DEBOUNCE * 2);
    assert.deepStrictEqual(seen, ['P', 'PR'], 'the empty query is never read');
  } finally { b.restore(); }
});

test('an error for a query the user has since typed past does not land over the newer answer', async () => {
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
    d.P.rej(new Error('late failure'));
    await wait(20);
    assert.deepStrictEqual(labelsOf(b), ['new'], 'the old failure neither wipes the rows nor posts the error note');
    assert.doesNotMatch(P(b).textContent, /Couldn.t search/);
  } finally { b.restore(); }
});

test('destroy with a letter still waiting reads nothing; destroy with a read in flight lands nothing', async () => {
  const seen = [];
  const b1 = boot({ search: (q) => { seen.push(q); return Promise.resolve(built(['One'])); } });
  goSearch(b1);
  typeCell(b1, 'P');
  b1.engine.destroy();
  await wait(DEBOUNCE * 2);
  assert.deepStrictEqual(seen, [], 'the pending read died with the controller');
  b1.restore();

  const d = deferred();
  const b2 = boot({ search: () => d.p });
  goSearch(b2);
  typeCell(b2, 'P');
  await wait(DEBOUNCE * 2);
  assert.strictEqual(P(b2).querySelector('.ipm-row'), null, 'the read is in flight');
  b2.engine.destroy();
  d.res(built(['One']));
  await wait(20);
  assert.deepStrictEqual(rowsOf(b2), [], 'a late answer never paints a destroyed controller');
  b2.restore();
});

test('go with nothing to go to keeps the wheel on the strip', async () => {
  const b = boot({ search: () => Promise.resolve({ items: [] }) });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    const at = markerIndex(b);
    typeCell(b, 'go');
    assert.strictEqual(query(b), 'P', 'go changes no letter');
    const goAt = markerIndex(b);
    wheelBy(b, 24);
    assert.notStrictEqual(markerIndex(b), goAt, 'the wheel still turns the strip (it never moved into an empty list)');
    assert.ok(at >= 0);
  } finally { b.restore(); }
});

test('go over headings only does not take the wheel either', async () => {
  const b = boot({ search: () => Promise.resolve({ items: [{ label: 'Songs', info: true, heading: true, value: '' }], tracks: [], play: null }) });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    typeCell(b, 'go');
    const goAt = markerIndex(b);
    wheelBy(b, 24);
    assert.notStrictEqual(markerIndex(b), goAt);
  } finally { b.restore(); }
});

test('tapping a result row hands that row the wheel (the list has focus, the row is highlighted)', async () => {
  const b = boot({ search: () => Promise.resolve(threeRows()) });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    assert.strictEqual(cursorLabel(b), null);
    tapLabel(b, 'Two');
    assert.strictEqual(b.plays.length, 1);
    assert.strictEqual(b.plays[0].index, 1);
    pressMenu(b); // the pick went to Now Playing; MENU comes back to the same search
    assert.strictEqual(query(b), 'P');
    assert.strictEqual(cursorLabel(b), 'Two', 'the tapped row keeps the highlight: the list has the wheel');
  } finally { b.restore(); }
});

test('tapping a heading row does not take the wheel', async () => {
  const b = boot({ search: () => Promise.resolve(threeRows()) });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    tapLabel(b, 'Songs');
    assert.strictEqual(cursorLabel(b), null);
    assert.strictEqual(b.plays.length, 0);
  } finally { b.restore(); }
});

test('a strip tap while the results have the wheel types the letter and hands the wheel back to the strip', async () => {
  const b = boot({ search: () => Promise.resolve(threeRows()) });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    typeCell(b, 'go');
    assert.strictEqual(cursorLabel(b), 'One');
    typeCell(b, 'A');
    assert.strictEqual(query(b), 'PA');
    assert.strictEqual(cursorLabel(b), null, 'typing returns the wheel to the strip');
    const at = markerIndex(b);
    wheelBy(b, 24);
    assert.notStrictEqual(markerIndex(b), at, 'the wheel turns the strip again');
  } finally { b.restore(); }
});

test('results re-read when the library changes: same query, once; a liked-only change leaves them alone; the skins search never reads the library', async () => {
  const seen = [];
  const b = boot({ search: (q) => { seen.push(q); return Promise.resolve(threeRows()); } });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    assert.deepStrictEqual(seen, ['P']);
    b.ver.v = 2;
    tapLabel(b, 'One'); // any press checks the version first
    await wait(DEBOUNCE * 2);
    assert.deepStrictEqual(seen, ['P', 'P'], 'a changed library asks again, once, for the same word');
    pressMenu(b); // back from Now Playing
    b.ver.liked = 2;
    tapLabel(b, 'One');
    await wait(DEBOUNCE * 2);
    assert.deepStrictEqual(seen, ['P', 'P'], 'a liked-only change does not touch a search');
  } finally { b.restore(); }
  const seen2 = [];
  const c = boot({ search: (q) => { seen2.push(q); return Promise.resolve(built(['x'])); } });
  try {
    tapLabel(c, 'Extras'); tapLabel(c, 'Skins'); tapLabel(c, 'Search');
    typeCell(c, 'A');
    c.ver.v = 2;
    typeCell(c, 'B');
    await wait(DEBOUNCE * 2);
    assert.deepStrictEqual(seen2, [], 'the skins search is local: a library change never reaches the library read');
    assert.strictEqual(query(c), 'AB');
  } finally { c.restore(); }
});

test('a re-read that lands while the results have the wheel puts the highlight back on the first RESULT, not on a heading', async () => {
  const b = boot({ search: () => Promise.resolve(threeRows()) });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    typeCell(b, 'go');
    wheelBy(b, 24);
    assert.strictEqual(cursorLabel(b), 'Two');
    b.ver.v = 2;
    wheelBy(b, 24); // already on the last row: it moves nothing, but the version check runs on the wheel and queues the re-read
    await wait(DEBOUNCE * 2);
    assert.strictEqual(cursorLabel(b), 'One', 'the fresh list starts on its first result, with the wheel still in the list');
  } finally { b.restore(); }
});

test('Skins > Search previews a Click colorway only while the RESULTS have the wheel; MENU back to the strip drops the preview', () => {
  const b = boot();
  try {
    tapLabel(b, 'Extras'); tapLabel(b, 'Skins'); tapLabel(b, 'Search');
    const cls = () => P(b).className.split(/\s+/).sort().join(' ');
    const base = cls();
    assert.ok(base.includes('mms-ipod-black'));
    typeCell(b, 'go');
    assert.strictEqual(cls(), base, 'the first row (not a colorway worth previewing) changes nothing');
    let k = 0;
    while (cls() === base && k++ < 10) wheelBy(b, 24);
    assert.notStrictEqual(cls(), base, 'the highlighted colorway is previewed live on the panel');
    assert.ok(cursorLabel(b));
    pressMenu(b);
    assert.strictEqual(cursorLabel(b), null, 'MENU gave the wheel back to the strip');
    assert.strictEqual(cls(), base, 'with the strip holding the wheel the preview is gone and the saved skin is back');
  } finally { b.restore(); }
});

test('the Settings "Find a skin" filter keeps family-name matching ON PURPOSE: its grid sits under family headings, so a heading word shows the group (the pocket Search lists flat rows and matches the label only)', () => {
  const { JSDOM } = require('jsdom');
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8');
  const m = /let musicSkinFilter = '';\n(function applyMusicSkinFilter[\s\S]*?\n\})\n/.exec(js);
  assert.ok(m);
  const dom = new JSDOM('<div id="c"><div class="skin-family" aria-label="Click"><button class="skin-tile" aria-label="Silver"></button></div><div class="skin-family" aria-label="Other"><button class="skin-tile" aria-label="Mint"></button></div></div>');
  const run = new dom.window.Function('c', 'q', 'let musicSkinFilter = q;\n' + m[1] + '\napplyMusicSkinFilter(c);');
  const c = dom.window.document.getElementById('c');
  run(c, 'click');
  assert.deepStrictEqual([...c.querySelectorAll('.skin-tile')].filter((t) => !t.hidden).map((t) => t.getAttribute('aria-label')), ['Silver'], 'the family word shows its tiles');
  assert.strictEqual(skins.skinSearchItems('click', 'ipod').every((r) => r.label.toLowerCase().includes('click')), true, 'the pocket Search never matches a row whose own label lacks the word');
});

test('search bar CSS: the bar never flex-shrinks away from the results, and a strip cell stays a full row tall (a touch target)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  const rules = cssRules(css).filter((r) => r.at === '');
  const rule = (sel) => rules.find((r) => r.sel.replace(/^:where\([^)]*\)\s*/, '') === sel);
  const bar = rule('.mms-ipod .ipm-searchbar');
  assert.ok(bar, 'the search bar rule exists');
  assert.match(bar.body, /flex\s*:\s*none/, 'the bar does not grow or shrink: the results take what is left');
  const cell = rule('.mms-ipod .ipm-sc');
  assert.ok(cell, 'the strip cell rule exists');
  assert.match(cell.body, /min-height\s*:\s*var\(--pk-row-h\)/, 'a cell is at least one menu row tall');
  assert.match(cell.body, /flex\s*:\s*1 1 0/, 'the cells share the strip equally');
  assert.match(cell.body, /min-width\s*:\s*0/, 'and can narrow below their text');
});

test('an emptied query drops a stale error note', async () => {
  const b = boot({ search: () => Promise.reject(new Error('down')) });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    assert.match(P(b).querySelector('.ipm-note').textContent, /Couldn.t search/);
    pressMenu(b);
    assert.strictEqual(query(b), '');
    assert.match(P(b).querySelector('.ipm-note').textContent, /Type to search/, 'an empty query is a fresh start, not an error');
  } finally { b.restore(); }
});

test('two reads for the SAME word (a library change re-asked it): the older read failing late does not wipe the newer answer', async () => {
  const reads = [deferred(), deferred()];
  let n = 0;
  const b = boot({ search: () => reads[n++].p });
  try {
    goSearch(b);
    typeCell(b, 'P');
    await wait(DEBOUNCE);
    b.ver.v = 2;
    typeCell(b, 'go'); // the strip press checks the version first and queues the second read
    await wait(DEBOUNCE * 2);
    assert.strictEqual(n, 2, 'both reads are in flight');
    reads[1].res(built(['fresh']));
    await wait(20);
    reads[0].rej(new Error('late failure'));
    await wait(20);
    assert.deepStrictEqual(labelsOf(b), ['fresh']);
  } finally { b.restore(); }
});
