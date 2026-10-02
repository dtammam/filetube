'use strict';

// [UNIT] v1.344 (W5, Dean), v1.345: Extras > Skins on the Pocket's LCD - Original, then a line (Classic, Mini,
// Nano, Shuffle), a generation, its colors, Cider, Nordic; the LCD re-skinning LIVE as the wheel highlights a colorway,
// Select saving it, MENU / Now Playing / destroy handing the panel back to the SAVED skin. The pure half
// (families and rows derived from the registry) and the controller through the REAL engine.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const skins = require(skinsPath);

// ---------------------------------------------------------------- the pure half
const GROUPS = ['Original', 'Classic 4G (2004)', 'Classic 5G (2005)', 'Classic 6G (2007)', 'Mini 1G (2004)', 'Mini 2G (2005)',
  'Nano 1G (2005)', 'Nano 2G (2006)', 'Nano 3G (2007)', 'Nano 4G (2008)', 'Nano 5G (2009)', 'Nano 6G (2010)', 'Nano 7G (2012)',
  'Shuffle 1G (2005)', 'Shuffle 2G (2006)', 'Shuffle 3G (2009)', 'Shuffle 4G (2010)',
  'Touch 1G-3G (2007)', 'Touch 4G (2010)', 'Touch 5G (2012)', 'Touch 6G-7G (2015)', 'Custom 5G (2005)', 'Cider', 'Nordic'];

test('groups are DERIVED from the registry: the Original, one per line generation, Cider, Nordic', () => {
  const fams = skins.skinFamilies();
  assert.deepStrictEqual(fams.map((f) => f.label), GROUPS);
  assert.deepStrictEqual(fams.find((f) => f.key === 'original').ids, ['ipod-original']);
  assert.deepStrictEqual([].concat(...fams.map((f) => f.ids)).sort(), skins.IDS.slice().sort(), 'every registry skin is in exactly one group (keep every option)');
  assert.deepStrictEqual(skins.skinLines().map((l) => [l.key, l.gens.length]), [['classic', 3], ['mini', 2], ['nano', 7], ['shuffle', 4], ['touch', 4], ['custom', 1]]);
  const want = { 'ipod-red': 'Red', ipod: 'White', 'ipod-charcoal': 'Black (2007)', 'ipod-matte': 'Black (2008)', 'ipod-nano7-spacegray': 'Space Gray (2013)', 'ipod-original': 'Original', apple: 'Cider' };
  for (const id of Object.keys(want)) assert.strictEqual(skins.colorwayLabel(id), want[id], id);
});

test('Extras > Skins rows: Skins appears only where hasSkins; Games only unless hasGames is false; the check follows the active skin', () => {
  const lbl = (rows) => rows.map((r) => r.label);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'main' }, { hasCurrent: false, hasGames: false, hasSkins: true })), ['Music', 'Extras', 'Settings', 'Shuffle Songs']);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'extras' }, { hasGames: true, hasSkins: true })), ['Games', 'Skins']);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'extras' }, { hasGames: false, hasSkins: true })), ['Skins']);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'extras' }, { hasGames: true })), ['Games']);
  const top = skins.menuStaticItems({ type: 'skins' }, { activeSkin: 'ipod-matte' });
  assert.deepStrictEqual(lbl(top), ['Original', 'Classic', 'Mini', 'Nano', 'Shuffle', 'Touch', 'Custom', 'Cider', 'Nordic', 'Search']);
  assert.deepStrictEqual(top.map((r) => !!r.check), [false, true, false, false, false, false, false, false, false, false], 'the line holding the active skin wears the check');
  assert.deepStrictEqual(top.map((r) => !!r.preview), [true, false, false, false, false, false, false, false, false, false], 'only a Click-menu skin row previews (Cider/Nordic would end the menu)');
  assert.deepStrictEqual(top[1].node, { type: 'skinLine', key: 'classic', label: 'Classic' });
  const line = skins.menuStaticItems(top[1].node, { activeSkin: 'ipod-matte' });
  assert.deepStrictEqual(lbl(line), ['4G (2004)', '5G (2005)', '6G (2007)']);
  assert.deepStrictEqual(line.map((r) => !!r.check), [false, false, true]);
  assert.deepStrictEqual(line[0].node, { type: 'skinGen', key: 'classic-4', label: 'Classic 4G' });
  const gen = skins.menuStaticItems({ type: 'skinGen', key: 'classic-6', label: 'Classic 6G' }, { activeSkin: 'ipod-matte' });
  assert.deepStrictEqual(lbl(gen), ['Silver', 'Black (2007)', 'Black (2008)']);
  assert.ok(gen.every((r) => r.action === 'skin' && r.preview === true && skins.IDS.includes(r.skinId)));
  assert.deepStrictEqual(gen.filter((r) => r.check).map((r) => r.skinId), ['ipod-matte'], 'exactly the saved skin is checked');
  assert.deepStrictEqual(['skins', 'skinLine', 'skinGen'].filter((t) => skins.menuIsItemLevel({ type: t })), [], 'menu levels, not item levels');
  assert.strictEqual(skins.menuTitle({ type: 'skins' }, 'click'), 'Skins');
  assert.strictEqual(skins.menuTitle({ type: 'skinGen', label: 'Classic 4G' }, 'click'), 'Classic 4G');
});

test('registry: every line skin is labelled "<Line> <n>G <Color> (<year>)", every generation has a year, no saved id was removed', () => {
  const lineLabel = { classic: 'Classic', mini: 'Mini', nano: 'Nano', shuffle: 'Shuffle', touch: 'Touch', custom: 'Custom' };
  const line = skins.SKINS.filter((x) => x.line);
  assert.strictEqual(line.length, 128);
  for (const x of line) {
    const gen = (x.line === 'touch' && { 1: '1G-3G', 6: '6G-7G' }[x.gen]) || x.gen + 'G';
    assert.strictEqual(x.label, `${lineLabel[x.line]} ${gen} ${x.color} (${x.year})`, x.id);
    assert.ok(skins.skinFamilies().some((f) => f.line === x.line && f.gen === x.gen && / \(\d{4}\)$/.test(f.label)), 'a generation year covers ' + x.id);
  }
  const saved = 'ipod ipod-black ipod-matte ipod-red ipod-silver ipod-encore ipod-blue ipod-green ipod-pink ipod-gold ipod-frost ipod-sky ipod-olive ipod-blush ipod-2004 ipod-charcoal ipod-violet ipod-yellow ipod-lime ipod-cobalt ipod-magenta ipod-raspberry ipod-original apple spotify'.split(' ');
  for (const id of saved) assert.ok(skins.IDS.includes(id), 'saved id kept: ' + id);
  assert.strictEqual(skins.IDS.length, 131);
  assert.strictEqual(skins.clickColorways().length, 129);
});

// ---------------------------------------------------------------- the controller (REAL engine)
function boot({ withSticker = true } = {}) {
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
  const cfg = {
    getSkinId: () => S.activeSkinId(),
    panel: dom.window.document.getElementById('panel'),
    getCtx: () => ({ track: { title: 'T', artist: 'A', artUrl: '/albumart/now' }, upNext: [], fullList: [], playing: true }),
    hostCtl: (id) => dom.window.document.getElementById(id), onSelectIndex: () => {}, onDock: () => {}, win: dom.window,
    menu: { load: () => Promise.resolve({ items: [] }), onPlay() {}, onShuffleAll() {}, hasCurrent: () => false, currentId: () => null },
  };
  if (withSticker) cfg.sticker = { onSkinChange: () => { spy.changed += 1; engine.paint(); } };
  const engine = dom.window.FileTubeSkinSurface.create(cfg);
  engine.paint();
  return { dom, engine, S, spy, restore: () => { engine.destroy(); Object.assign(global, saved); } };
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
const stored = (b) => b.dom.window.localStorage.getItem('ft-music-skin');
function openClickColorways(b) { tapLabel(b, 'Extras'); tapLabel(b, 'Skins'); tapLabel(b, 'Classic'); tapLabel(b, '5G (2005)'); }
const PREVIEW_POOL = ['ipod', 'ipod-black'];
// 'ipod' (Classic 5G White) is also the BASE class every Click skin wears, so a preview of it is bound by the saved skin's class going away.
const idOfLabel = (label) => PREVIEW_POOL.find((x) => skins.colorwayLabel(x) === label);

test('the Main Menu reaches Extras > Skins > Classic > 5G > colorways; with no sticker seam (no way to re-render) the row does not exist', () => {
  const b = boot();
  try {
    assert.deepStrictEqual(rowsOf(b).map((x) => x.querySelector('.ipm-lbl').textContent), ['Music', 'Extras', 'Settings', 'Shuffle Songs']);
    tapLabel(b, 'Extras');
    assert.deepStrictEqual(rowsOf(b).map((x) => x.querySelector('.ipm-lbl').textContent), ['Skins'], 'no game here: Skins only');
    tapLabel(b, 'Skins');
    assert.strictEqual(b.engine.menuState().title, 'Skins');
    assert.deepStrictEqual(rowsOf(b).map((x) => x.querySelector('.ipm-lbl').textContent), ['Original', 'Classic', 'Mini', 'Nano', 'Shuffle', 'Touch', 'Custom', 'Cider', 'Nordic', 'Search']);
    tapLabel(b, 'Classic');
    assert.strictEqual(b.engine.menuState().title, 'Classic');
    assert.deepStrictEqual(rowsOf(b).map((x) => x.querySelector('.ipm-lbl').textContent), ['4G (2004)', '5G (2005)', '6G (2007)']);
    tapLabel(b, '5G (2005)');
    assert.strictEqual(b.engine.menuState().title, 'Classic 5G');
    assert.ok(rowsOf(b).some((x) => x.querySelector('.ipm-lbl').textContent === 'Black' && x.classList.contains('is-checked')), 'the saved skin is checked');
  } finally { b.restore(); }
  const n = boot({ withSticker: false });
  try {
    assert.ok(!rowsOf(n).some((x) => x.querySelector('.ipm-lbl').textContent === 'Extras'), 'no Extras row that leads to nothing');
  } finally { n.restore(); }
});

test('the wheel re-skins the LCD LIVE without saving; MENU hands the panel back to the saved skin', () => {
  const b = boot();
  try {
    openClickColorways(b);
    assert.ok(P(b).classList.contains('mms-ipod-black'));
    const start = cursorLabel(b);
    wheelBy(b, -24);
    const now = cursorLabel(b);
    assert.notStrictEqual(now, start);
    const id = idOfLabel(now);
    assert.ok(P(b).classList.contains('mms-' + id), 'the highlighted colorway is on the panel: ' + id);
    assert.ok(!P(b).classList.contains('mms-ipod-black'), 'the previous colorway class is gone');
    assert.ok(P(b).classList.contains('mms-ipod'), 'the base class stays');
    assert.strictEqual(stored(b), 'ipod-black', 'a preview never touches storage');
    assert.strictEqual(b.spy.changed, 0);
    pressMenu(b);
    assert.strictEqual(b.engine.menuState().title, 'Classic', 'MENU backs out ONE level');
    assert.ok(P(b).classList.contains('mms-ipod-black'), 'cancelled: the saved skin is back');
    assert.strictEqual(stored(b), 'ipod-black');
  } finally { b.restore(); }
});

test('Select saves the highlighted colorway once, repaints with it, and the check moves; a repaint mid-preview draws the preview, not a mix', () => {
  const b = boot();
  try {
    openClickColorways(b);
    wheelBy(b, -40);
    const label = cursorLabel(b);
    const id = idOfLabel(label);
    b.engine.paint(); // a repaint (a track change) mid-preview
    assert.ok(P(b).classList.contains('mms-' + id) && !P(b).classList.contains('mms-ipod-black'), 'the repaint drew the previewed skin, not the saved one');
    assert.strictEqual(stored(b), 'ipod-black');
    tap(b, P(b).querySelector('[data-skin-select]'));
    assert.strictEqual(stored(b), id, 'saved on Select');
    assert.strictEqual(b.spy.changed, 1, 'the view repainted once');
    assert.ok(P(b).classList.contains('mms-' + id));
    assert.strictEqual(b.S.activeSkinId(), id);
    assert.strictEqual(P(b).querySelector('.ipm-row.is-checked .ipm-lbl').textContent, label, 'the check follows the saved skin');
    pressMenu(b); pressMenu(b);
    assert.ok(P(b).classList.contains('mms-' + id), 'backing out keeps what was saved');
  } finally { b.restore(); }
});

test('Select in another line and generation moves the check at every level MENU returns to (the level refresh is bound)', () => {
  const b = boot();
  try {
    tapLabel(b, 'Extras'); tapLabel(b, 'Skins'); tapLabel(b, 'Nano'); tapLabel(b, '4G (2008)');
    wheelBy(b, 24);
    tap(b, P(b).querySelector('[data-skin-select]'));
    const id = stored(b);
    const group = skins.skinFamilies().find((f) => f.label === 'Nano 4G (2008)');
    assert.ok(group.ids.includes(id), 'Select saved a Nano 4G colorway: ' + id);
    pressMenu(b);
    assert.strictEqual(b.engine.menuState().title, 'Nano');
    assert.strictEqual(P(b).querySelector('.ipm-row.is-checked .ipm-lbl').textContent, '4G (2008)', 'the generation row carries the check after Select');
    pressMenu(b);
    assert.strictEqual(b.engine.menuState().title, 'Skins');
    assert.strictEqual(P(b).querySelector('.ipm-row.is-checked .ipm-lbl').textContent, 'Nano', 'the line row carries the check, and the old Classic check is gone');
    assert.strictEqual(cursorLabel(b), 'Nano', 'the cursor sits on the saved line');
  } finally { b.restore(); }
});

test('MENU out of the flow and destroy also end a preview: nothing is left half-applied', () => {
  const b = boot();
  try {
    openClickColorways(b);
    wheelBy(b, -56);
    assert.ok(!P(b).classList.contains('mms-ipod-black'));
    pressMenu(b); pressMenu(b);
    assert.ok(P(b).classList.contains('mms-ipod-black'), 'two MENU presses out: saved skin restored');
    assert.strictEqual(stored(b), 'ipod-black');
  } finally { b.restore(); }
  const c = boot();
  let panel;
  try {
    openClickColorways(c);
    wheelBy(c, -56);
    panel = P(c);
    c.engine.destroy();
    assert.ok(panel.classList.contains('mms-ipod-black'), 'destroyed mid-preview: the saved skin is back on the panel');
  } finally { c.restore(); }
});

test('Cider and Nordic rows never preview (the menu would vanish); Select saves them and the view repaints', async () => {
  const b = boot();
  try {
    tapLabel(b, 'Extras'); tapLabel(b, 'Skins');
    assert.strictEqual(cursorLabel(b), 'Classic', 'the menu opens on the saved line');
    wheelBy(b, 48); // clockwise: the wheel accelerates, so this runs to the last row
    assert.strictEqual(cursorLabel(b), 'Search', 'v1.354: the Search row ends the list');
    // one SLOW detent (3 x 8 degrees, 25 ms apart: a speed of 0.3 deg/ms is one row per step)
    const w = P(b).querySelector('.ip-wheel');
    const at = (d) => ({ clientX: 100 * Math.cos(d * Math.PI / 180), clientY: 100 * Math.sin(d * Math.PI / 180) });
    w.dispatchEvent(new b.dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 0 }));
    for (let d = -8; d >= -24; d -= 8) { await new Promise((r) => setTimeout(r, 25)); w.dispatchEvent(new b.dom.window.MouseEvent('pointermove', Object.assign({ bubbles: true }, at(d)))); }
    w.dispatchEvent(new b.dom.window.MouseEvent('pointerup', { bubbles: true }));
    assert.strictEqual(cursorLabel(b), 'Nordic');
    assert.ok(P(b).classList.contains('mms-ipod-black'), 'highlighting Nordic leaves the LCD as it was');
    assert.ok(!P(b).classList.contains('mms-spotify'));
    tap(b, P(b).querySelector('[data-skin-select]'));
    assert.strictEqual(stored(b), 'spotify');
    assert.strictEqual(b.spy.changed, 1);
  } finally { b.restore(); }
});

// ---------------------------------------------------------------- the Settings grid
const { readStyleCss, cssRules, GRID_SCOPE } = require('../helpers/stylesheets.js');

test('the grid scope reaches ONLY the role-token blocks (palette authority): every colorway + the chassis colors + the Original look', () => {
  const rules = cssRules(readStyleCss().replace(/\/\*[\s\S]*?\*\//g, ''));
  const gridRules = rules.filter((r) => r.sel.indexOf('.skin-grid') !== -1 && r.sel.indexOf(GRID_SCOPE) === 0);
  const sels = gridRules.map((r) => r.sel.slice(GRID_SCOPE.length + 1)).sort();
  for (const id of skins.clickColorways()) assert.ok(sels.includes('.mms-' + id) || id === 'ipod-original' || id === 'ipod', 'colorway ' + id + ' paints in the grid');
  for (const s of sels) assert.ok(/^\.mms-(ipod|look-original)/.test(s), 'only palette blocks, never layout: ' + s);
  for (const r of gridRules) assert.ok(/--pk-/.test(r.body) && !/(^|;)\s*(display|position|width|height|margin|padding|grid)/.test(r.body), 'a grid-scoped block sets role tokens only: ' + r.sel);
});

test('the Settings tile is static CSS: no player, image, or canvas per tile; one swatch per registry skin', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8');
  const body = /function renderMusicSkinPicker\(\) \{([\s\S]*?)\n\}/.exec(js)[1];
  assert.ok(!/renderFull|<img|<canvas|<video|<iframe|new Image/.test(body), 'never a live player or image per tile');
  assert.match(body, /skinSwatchClasses\(/);
  assert.match(js, /function skinSwatchClasses\(s\) \{[^}]*'skin-swatch mms-'/, 'the swatch carries the skin id class');
});
