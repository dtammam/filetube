'use strict';

// [UNIT] v1.335 (Dean: "one special Original skin which includes the entire vibe of the first"; plan
// docs/exec-plans/active/2026-09-25-click-colorways-seven.md, D9-D12 / AC6). The Original is a Click
// colorway (ONE role block, like every colorway) PLUS a LOOK: a registry field the engine turns into ONE
// panel class, on which every structural rule keys - the button ring, the monochrome screen, the bitmap
// face and the wheel that turns (--ip-turn on the panel, written from the real spin handler).
//  - AC6 (a): the registry entry and the class, through the REAL paint, for the Original and no other skin;
//  - AC6 (e): a rotation writes --ip-turn for the Original only, a switch away removes it, the disc reads
//    it, reduced motion drops it;
//  - AC6 (d): the face is bundled, declared once and named only by the look;
//  - AC6 (g): the look's rules live in its one section, the screen-role re-points stop at the glass.
// Paint is jsdom-invisible, so the CSS arms are source locks over comment-stripped rules.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const skins = require('../../public/js/music-skins.js');

const HTML = `<body>
  <video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" />
  <div id="panel" class="music-nowplaying-panel" hidden></div>
</body>`;

// the skin-surface.test.js harness, with a skin the test can switch mid-session
function bootEngine(state) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = dom.window; global.document = dom.window.document; global.Event = dom.window.Event;
  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  global.module = undefined;
  dom.window.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const ctx = { track: { title: 'Song', artist: 'Band', album: 'Record' }, upNext: [], fullList: [], playing: false,
    posSec: 0, durSec: 300, posLabel: '0:00', remLabel: '-5:00', curNum: 1, total: 1 };
  const engine = dom.window.FileTubeSkinSurface.create({
    panel: dom.window.document.getElementById('panel'), getSkinId: () => state.skin, getCtx: () => ctx,
    hostCtl: (id) => dom.window.document.getElementById(id), win: dom.window,
  });
  return { dom, engine, restore: () => Object.assign(global, saved) };
}
const panelOf = (dom) => dom.window.document.getElementById('panel');
function spin(dom, angles) {
  const wheel = panelOf(dom).querySelector('.ip-wheel');
  const at = (deg) => { const rad = deg * Math.PI / 180; return { clientX: 100 * Math.cos(rad), clientY: 100 * Math.sin(rad) }; };
  const s = at(0);
  wheel.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: s.clientX, clientY: s.clientY }));
  angles.forEach((deg) => { const q = at(deg); wheel.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: q.clientX, clientY: q.clientY })); });
  wheel.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
}

// ---- the stylesheet, comments stripped ONCE (LESSONS 3), parsed into (selector, body) ----
const CSS_RAW = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
const CSS = CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '');
// flat (selector, body) pairs: a rule inside an @media is matched on its own (its selector cannot hold a brace)
// each rule carries its enclosing @media prelude ('' at the top level), brace-walked
function mediaRanges(css) {
  const out = []; let i = 0;
  while ((i = css.indexOf('@media', i)) >= 0) {
    const open = css.indexOf('{', i); let depth = 1; let j = open + 1;
    for (; j < css.length && depth; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; }
    out.push({ from: open, to: j, prelude: css.slice(i, open).trim() }); i = j;
  }
  return out;
}
function rules(css) {
  const media = mediaRanges(css);
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) {
    const at = m.index + m[0].indexOf('{');
    const mq = media.find((r) => at > r.from && at < r.to);
    out.push({ sel: m[1].trim(), body: m[2], at, media: mq ? mq.prelude : '' });
  }
  return out;
}
const ALL = rules(CSS);

test('AC6 (a): exactly ONE registry entry has a look - the Original, a Click colorway on the shared chassis', () => {
  const looks = skins.SKINS.filter((s) => s.look);
  assert.deepStrictEqual(looks.map((s) => [s.id, s.look]), [['ipod-original', 'original']]);
  const o = skins.skinById('ipod-original');
  assert.strictEqual(o.base, 'ipod', 'the shared .mms-ipod chassis');
  assert.strictEqual(o.menus, 'click', 'a Click colorway: menus, Brick, lighting, the tray chips derive from this');
  assert.strictEqual(o.renderFull, skins.skinById('ipod').renderFull, 'the same markup - the look is CSS');
  assert.strictEqual(o.label, 'Click (Original)');
  assert.ok(skins.isClickColorway('ipod-original'), 'the tray / pop-out chips and Brick reach it');
});

test('AC6 (a): the real paint puts mms-look-original on the panel for the Original and for NO other skin', () => {
  const state = { skin: 'ipod-original' };
  const { dom, engine, restore } = bootEngine(state);
  try {
    engine.paint();
    const p = panelOf(dom);
    assert.ok(p.classList.contains('mms-look-original'), 'the look class');
    assert.ok(p.classList.contains('mms-ipod-original') && p.classList.contains('mms-ipod'), 'its colorway + chassis classes too');
    for (const id of skins.IDS.filter((i) => i !== 'ipod-original')) {
      state.skin = id; engine.paint();
      assert.ok(!/\bmms-look-/.test(p.className), id + ': no look class');
    }
    state.skin = 'ipod-original'; engine.paint();
    assert.ok(p.classList.contains('mms-look-original'), 'back on the Original: the class returns');
  } finally { engine.destroy(); restore(); }
});

test('AC6 (e): a rotation writes --ip-turn on the panel for the Original - it follows the thumb, both ways', () => {
  const state = { skin: 'ipod-original' };
  const { dom, engine, restore } = bootEngine(state);
  try {
    engine.paint();
    const p = panelOf(dom);
    assert.strictEqual(p.style.getPropertyValue('--ip-turn'), '', 'no turn before the thumb moves');
    spin(dom, [10, 20, 30, 40]);
    assert.strictEqual(p.style.getPropertyValue('--ip-turn'), '40.0deg', 'clockwise 40 degrees');
    engine.paint(); // a repaint (a track change) keeps the wheel where the thumb left it
    assert.strictEqual(p.style.getPropertyValue('--ip-turn'), '40.0deg', 'the turn survives a repaint');
    spin(dom, [-15, -30]);
    assert.strictEqual(p.style.getPropertyValue('--ip-turn'), '10.0deg', 'counter-clockwise 30 back');
  } finally { engine.destroy(); restore(); }
});

test('AC6 (e): no other skin ever gets --ip-turn, and switching away from the Original removes it', () => {
  const state = { skin: 'ipod-red' };
  const { dom, engine, restore } = bootEngine(state);
  try {
    engine.paint();
    const p = panelOf(dom);
    spin(dom, [10, 20, 30]);
    assert.strictEqual(p.style.getPropertyValue('--ip-turn'), '', 'a colorway without a look: no turn written');
    assert.strictEqual(p.getAttribute('style') || '', '', 'its style attribute untouched by the spin');
    state.skin = 'ipod-original'; engine.paint();
    spin(dom, [10, 20]);
    assert.strictEqual(p.style.getPropertyValue('--ip-turn'), '20.0deg');
    state.skin = 'ipod'; engine.paint();
    assert.strictEqual(p.style.getPropertyValue('--ip-turn'), '', 'the switch away drops the turn');
    state.skin = 'ipod-original'; engine.paint();
    assert.strictEqual(p.style.getPropertyValue('--ip-turn'), '', 'and a return starts the wheel at rest');
  } finally { engine.destroy(); restore(); }
});

test('AC6 (e): only the scroll-wheel layer reads the turn (a transform), and reduced motion drops it', () => {
  const readers = ALL.filter((r) => /--ip-turn/.test(r.body));  // (the reduced-motion override names no var)
  assert.deepStrictEqual(readers.map((r) => r.sel), ['.mms-look-original .ip-wheel::after'], 'one reader: the disc');
  assert.match(readers[0].body, /transform:rotate\(var\(--ip-turn, 0deg\)\)/);
  assert.ok(!/filter|mask|blur|backdrop/i.test(readers[0].body), 'no filter, mask or blur on the turning layer (the ambient-mode lesson)');
  const rm = /@media \(prefers-reduced-motion: reduce\)\{[^\n]*\.mms-look-original \.ip-wheel::after\{ transform:none; \}/.exec(CSS);
  assert.ok(rm, 'reduced motion: the disc does not turn');
  assert.ok(rm.index > CSS.indexOf('.mms-look-original .ip-wheel::after{'), 'the reduced-motion override follows the rule it overrides');
});

test('AC6 (g): every rule naming the look sits in the look section (or the reduced-motion line)', () => {
  const start = CSS.indexOf('.mms-look-original{');
  const end = CSS.indexOf('.mms-look-original .ip-z-menu{');
  assert.ok(start > 0 && end > start, 'the look section exists');
  assert.strictEqual(CSS.split('.mms-look-original{').length - 1, 1, 'ONE look token block');
  const named = ALL.filter((r) => /mms-look-original/.test(r.sel));
  assert.ok(named.length >= 10, 'the look has its rules');
  for (const r of named) {
    const inSection = r.at > start && r.at < CSS.indexOf('}', end) + 1;
    const inReduced = /prefers-reduced-motion: reduce/.test(r.media) && /^\s*transform:none;\s*$/.test(r.body);
    assert.ok(inSection || inReduced, 'outside the look section: ' + r.sel);
  }
  // it follows the chassis (equal specificity - file order decides), and no colorway class appears in it
  assert.ok(start > CSS.indexOf('.mms-ipod .ip-wheel{') && start > CSS.indexOf('.mms-ipod .ipm-row.is-cursor{'), 'after the chassis rules it overrides');
  const section = CSS.slice(start, CSS.indexOf('}', end) + 1);
  const colorClasses = skins.IDS.filter((i) => i !== 'ipod').map((i) => 'mms-' + i);
  for (const c of colorClasses) assert.ok(!new RegExp('\\.' + c + '(?![\\w-])').test(section) && !section.includes('"' + c + '"'), 'the look never names a colorway class: ' + c);
});

test('AC6 (b)/(c): the screen re-points stop at the glass; the ring, gaps and disc are layered under the controls', () => {
  const find = (sel) => { const r = ALL.filter((x) => x.sel === sel && !/prefers-reduced-motion/.test(x.media)); assert.strictEqual(r.length, 1, sel + ' exactly once (outside the reduced-motion override)'); return r[0].body; };
  const glass = find('.mms-look-original .ip-lcd-in');
  for (const t of ['--pk-s-paper:var(--pk-o-lcd)', '--pk-s-ink:var(--pk-o-ink)', '--pk-s-sel1:var(--pk-o-sel)', '--pk-s-sel2:var(--pk-o-sel)', '--pk-s-sub:var(--pk-o-sub)']) {
    assert.ok(glass.includes(t), 'the glass re-points ' + t);
  }
  assert.match(glass, /font-family:'Jersey 10', var\(--font-family\)/, 'the bitmap face on the glass');
  // the look never redefines a palette token (token-scale-lock: one value each) and never re-points the
  // screen roles on the PANEL (the sticker and the body would repaint)
  const panelBlock = find('.mms-look-original');
  assert.ok(!/--pk-s-/.test(panelBlock), 'no screen role re-pointed outside the glass');
  for (const r of ALL.filter((x) => /mms-look-original/.test(x.sel))) assert.ok(!/(^|[;\s{])--mms-[a-z0-9-]+\s*:/.test(r.body), 'no palette token redefined: ' + r.sel);
  assert.match(find('.mms-look-original .ip-wheel'), /isolation:isolate/, 'the wheel isolates (a small container)');
  assert.match(find('.mms-look-original .ip-wheel::before'), /z-index:-1/);
  assert.match(find('.mms-look-original .ip-wheel::after'), /z-index:-1/);
  assert.match(find('.mms-look-original .ip-z-menu'), /text-transform:lowercase/, '"menu", lowercase');
  const hide = ALL.filter((r) => /display:none/.test(r.body) && /mms-look-original/.test(r.sel)).map((r) => r.sel).join(' ');
  for (const c of ['.ip-cover', '.ipm-art', '.ip-stars']) assert.ok(hide.includes('.mms-look-original ' + c), 'no art / stars: ' + c);
});

test('AC6 (d): the bitmap face is bundled, declared once, named only by the look, and licensed', () => {
  const woff = path.join(ROOT, 'public', 'fonts', 'jersey10.woff2');
  assert.ok(fs.existsSync(woff), 'the face ships in public/fonts');
  assert.strictEqual(fs.readFileSync(woff).slice(0, 4).toString('latin1'), 'wOF2', 'a woff2 file');
  const faces = CSS.match(/@font-face\s*\{[^}]*'Jersey 10'[^}]*\}/g) || [];
  assert.strictEqual(faces.length, 1, 'one @font-face');
  assert.match(faces[0], /src: url\('\/fonts\/jersey10\.woff2'\) format\('woff2'\)/);
  const users = ALL.filter((r) => /'Jersey 10'/.test(r.body) && r.sel !== '@font-face').map((r) => r.sel);
  assert.deepStrictEqual(users, ['.mms-look-original .ip-lcd-in'], 'only the Original\'s glass names it (no other skin downloads it)');
  const readme = fs.readFileSync(path.join(ROOT, 'public', 'fonts', 'README.md'), 'utf8');
  assert.match(readme, /## Jersey 10 \(`jersey10\.woff2`\)[\s\S]*SIL Open Font License 1\.1/, 'the README cites its license');
});
