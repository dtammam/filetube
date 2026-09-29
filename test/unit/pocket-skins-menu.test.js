'use strict';

// [UNIT] v1.344 (W5, Dean): Extras > Skins on the Pocket's LCD - families first (Click, Original, Cider,
// Nordic), then a family's colorways, the LCD re-skinning LIVE as the wheel highlights a Click colorway,
// Select saving it, MENU / Now Playing / destroy handing the panel back to the SAVED skin. The pure half
// (families and rows derived from the registry) and the controller through the REAL engine.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const skins = require(skinsPath);

// ---------------------------------------------------------------- the pure half
test('families are DERIVED from the registry: Cider and Nordic alone, every Click colorway together, the Original by its look', () => {
  const fams = skins.skinFamilies();
  assert.deepStrictEqual(fams.map((f) => f.label), ['Cider', 'Nordic', 'Click', 'Original']);
  assert.deepStrictEqual(fams.find((f) => f.key === 'click').ids, skins.clickColorways().filter((id) => id !== 'ipod-original'));
  assert.deepStrictEqual(fams.find((f) => f.key === 'original').ids, ['ipod-original']);
  assert.deepStrictEqual([].concat(...fams.map((f) => f.ids)).sort(), skins.IDS.slice().sort(), 'every registry skin is in exactly one family (keep every option)');
  assert.strictEqual(skins.colorwayLabel('ipod-red'), 'Red');
  assert.strictEqual(skins.colorwayLabel('ipod'), 'Classic');
});

test('Extras > Skins rows: Skins appears only where hasSkins; Games only unless hasGames is false; the check follows the active skin', () => {
  const lbl = (rows) => rows.map((r) => r.label);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'main' }, { hasCurrent: false, hasGames: false, hasSkins: true })), ['Music', 'Extras', 'Settings', 'Shuffle Songs']);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'extras' }, { hasGames: true, hasSkins: true })), ['Games', 'Skins']);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'extras' }, { hasGames: false, hasSkins: true })), ['Skins']);
  assert.deepStrictEqual(lbl(skins.menuStaticItems({ type: 'extras' }, { hasGames: true })), ['Games']);
  const top = skins.menuStaticItems({ type: 'skins' }, { activeSkin: 'ipod-red' });
  assert.deepStrictEqual(lbl(top), ['Cider', 'Nordic', 'Click', 'Original']);
  assert.deepStrictEqual(top.map((r) => !!r.check), [false, false, true, false], 'the family holding the active skin wears the check');
  assert.deepStrictEqual(top.map((r) => !!r.preview), [false, false, false, true], 'only a Click-menu single row previews (Cider/Nordic would end the menu)');
  assert.deepStrictEqual(top[2].node, { type: 'skinFamily', key: 'click', label: 'Click' });
  const cw = skins.menuStaticItems({ type: 'skinFamily', key: 'click', label: 'Click' }, { activeSkin: 'ipod-red' });
  assert.strictEqual(cw.length, skins.skinFamilies().find((f) => f.key === 'click').ids.length);
  assert.ok(cw.every((r) => r.action === 'skin' && r.preview === true && skins.IDS.includes(r.skinId)));
  assert.deepStrictEqual(cw.filter((r) => r.check).map((r) => r.skinId), ['ipod-red'], 'exactly the saved skin is checked');
  assert.deepStrictEqual(['skins', 'skinFamily'].filter((t) => skins.menuIsItemLevel({ type: t })), [], 'menu levels, not item levels');
  assert.strictEqual(skins.menuTitle({ type: 'skins' }, 'click'), 'Skins');
  assert.strictEqual(skins.menuTitle({ type: 'skinFamily', label: 'Click' }, 'click'), 'Click');
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
function openClickColorways(b) { tapLabel(b, 'Extras'); tapLabel(b, 'Skins'); tapLabel(b, 'Click'); }

test('the Main Menu reaches Extras > Skins > Click > colorways; with no sticker seam (no way to re-render) the row does not exist', () => {
  const b = boot();
  try {
    assert.deepStrictEqual(rowsOf(b).map((x) => x.querySelector('.ipm-lbl').textContent), ['Music', 'Extras', 'Settings', 'Shuffle Songs']);
    tapLabel(b, 'Extras');
    assert.deepStrictEqual(rowsOf(b).map((x) => x.querySelector('.ipm-lbl').textContent), ['Skins'], 'no game here: Skins only');
    tapLabel(b, 'Skins');
    assert.strictEqual(b.engine.menuState().title, 'Skins');
    assert.deepStrictEqual(rowsOf(b).map((x) => x.querySelector('.ipm-lbl').textContent), ['Cider', 'Nordic', 'Click', 'Original']);
    tapLabel(b, 'Click');
    assert.strictEqual(b.engine.menuState().title, 'Click');
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
    wheelBy(b, 24);
    const now = cursorLabel(b);
    assert.notStrictEqual(now, start);
    const id = skins.clickColorways().find((x) => skins.colorwayLabel(x) === now);
    assert.ok(P(b).classList.contains('mms-' + id), 'the highlighted colorway is on the panel: ' + id);
    assert.ok(!P(b).classList.contains('mms-ipod-black'), 'the previous colorway class is gone');
    assert.ok(P(b).classList.contains('mms-ipod'), 'the base class stays');
    assert.strictEqual(stored(b), 'ipod-black', 'a preview never touches storage');
    assert.strictEqual(b.spy.changed, 0);
    pressMenu(b);
    assert.strictEqual(b.engine.menuState().title, 'Skins');
    assert.ok(P(b).classList.contains('mms-ipod-black') && !P(b).classList.contains('mms-' + id), 'cancelled: the saved skin is back');
    assert.strictEqual(stored(b), 'ipod-black');
  } finally { b.restore(); }
});

test('Select saves the highlighted colorway once, repaints with it, and the check moves; a repaint mid-preview draws the preview, not a mix', () => {
  const b = boot();
  try {
    openClickColorways(b);
    wheelBy(b, 40);
    const label = cursorLabel(b);
    const id = skins.clickColorways().find((x) => skins.colorwayLabel(x) === label);
    b.engine.paint(); // a repaint (a track change) mid-preview
    assert.ok(P(b).classList.contains('mms-' + id), 'the repaint drew the previewed skin');
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

test('MENU out of the flow and destroy also end a preview: nothing is left half-applied', () => {
  const b = boot();
  try {
    openClickColorways(b);
    wheelBy(b, 56);
    assert.ok(!P(b).classList.contains('mms-ipod-black'));
    pressMenu(b); pressMenu(b);
    assert.ok(P(b).classList.contains('mms-ipod-black'), 'two MENU presses out: saved skin restored');
    assert.strictEqual(stored(b), 'ipod-black');
  } finally { b.restore(); }
  const c = boot();
  let panel;
  try {
    openClickColorways(c);
    wheelBy(c, 56);
    panel = P(c);
    c.engine.destroy();
    assert.ok(panel.classList.contains('mms-ipod-black'), 'destroyed mid-preview: the saved skin is back on the panel');
  } finally { c.restore(); }
});

test('Cider and Nordic rows never preview (the menu would vanish); Select saves them and the view repaints', () => {
  const b = boot();
  try {
    tapLabel(b, 'Extras'); tapLabel(b, 'Skins');
    assert.strictEqual(cursorLabel(b), 'Click', 'the menu opens on the saved family');
    wheelBy(b, -56); // counter-clockwise, clamps on the first row
    assert.strictEqual(cursorLabel(b), 'Cider');
    assert.ok(P(b).classList.contains('mms-ipod-black'), 'highlighting Cider leaves the LCD as it was');
    assert.ok(!P(b).classList.contains('mms-apple'));
    tap(b, P(b).querySelector('[data-skin-select]'));
    assert.strictEqual(stored(b), 'apple');
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
