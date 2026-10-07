'use strict';

// [UNIT] The iPod portrait lock (plan docs/exec-plans/active/2026-10-07-ipod-portrait-lock.md; Dean 2026-10-07: "if you
// even turn the phone sideways, it won't change it", R7: "You can make it a setting to enable sideways" / "Don't lose the
// flexibility and existing solidly working code"). iOS lets no web page lock its orientation, so with the Upright setting
// (html.pk-upright, the default on a phone) style.css draws the full player turned back by the screen's angle; Sideways
// (ft-pocket-sideways = '1') is UI pass D7's layout, untouched. This file binds, each on its own:
//   - the mark: html.pk-upright on a phone unless Sideways; re-read at a turn and on a storage event; the setter;
//   - the turn readers: turnOf (off the DRAWN transform) and unturnDelta (exact quarter turns);
//   - the CSS: every D7 landscape rule is Sideways-only; the upright block's turn signs, box and inset mapping; the
//     Transparent board photo's own turn is Sideways-only;
//   - the input under the turn, through the REAL skin engine: the haptic switch sits under the finger in the turned
//     frame, and a tap on the seek bar seeks by the position ALONG the turned bar;
//   - the tilt lighting maps by the screen's angle plus the drawn turn;
//   - the two switches: the Pocket's Settings > Stay Upright row and Settings > Mobile player > Keep the iPod upright.
// The real turn is measured in Chromium by tools/pocket-proof/upright-probe.js (evidence in the plan) and the settle by
// test/geometry G4 pocket-rotation.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { readStyleCss, cssRules } = require('../helpers/stylesheets.js');

const ROOT = path.join(__dirname, '..', '..');
const skinsPath = require.resolve('../../public/js/music-skins.js');
const surfacePath = require.resolve('../../public/js/skin-surface.js');
const SK = require(skinsPath);

function loadSkinsInto(win) {
  const saved = { window: global.window, document: global.document };
  global.window = win; global.document = win.document;
  try { delete require.cache[skinsPath]; return require(skinsPath); } finally { delete require.cache[skinsPath]; Object.assign(global, saved); }
}
function fakeDevice(win, dev) {
  win.matchMedia = (q) => ({ matches: /pointer:\s*coarse/.test(q) ? dev.coarse : false, media: q, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(win, 'screen', { configurable: true, value: { width: dev.w, height: dev.h } });
}

// ---- the mark -----------------------------------------------------------------------------------
test('mark: a phone is upright by default; Sideways ("1") drops it; an iPad / desktop never gets it', () => {
  const phone = new JSDOM('<body></body>', { url: 'http://localhost/music' }).window;
  fakeDevice(phone, { coarse: true, w: 390, h: 844 });
  loadSkinsInto(phone);
  assert.ok(phone.document.documentElement.classList.contains('pk-upright'), 'a phone with no setting is upright');

  const side = new JSDOM('<body></body>', { url: 'http://localhost/music' }).window;
  fakeDevice(side, { coarse: true, w: 390, h: 844 });
  side.localStorage.setItem('ft-pocket-sideways', '1');
  loadSkinsInto(side);
  assert.ok(side.document.documentElement.classList.contains('is-phone'), 'precondition: a phone');
  assert.ok(!side.document.documentElement.classList.contains('pk-upright'), 'Sideways chosen: no upright mark (D7 runs)');

  for (const dev of [{ coarse: true, w: 820, h: 1180 }, { coarse: false, w: 1440, h: 900 }]) {
    const w = new JSDOM('<body></body>', { url: 'http://localhost/music' }).window;
    fakeDevice(w, dev);
    loadSkinsInto(w);
    assert.ok(!w.document.documentElement.classList.contains('pk-upright'), 'not a phone: never upright-marked');
  }
  assert.strictEqual(SK.SIDEWAYS_KEY, 'ft-pocket-sideways');
  assert.strictEqual(SK.UPRIGHT_CLASS, 'pk-upright');
});

test('mark: a value that lands without the setter (another tab) applies at the next turn or storage event', () => {
  const w = new JSDOM('<body></body>', { url: 'http://localhost/music' }).window;
  fakeDevice(w, { coarse: true, w: 390, h: 844 });
  loadSkinsInto(w);
  const html = w.document.documentElement;
  w.localStorage.setItem('ft-pocket-sideways', '1');
  assert.ok(html.classList.contains('pk-upright'), 'precondition: not re-read yet');
  w.dispatchEvent(new w.Event('orientationchange'));
  assert.ok(!html.classList.contains('pk-upright'), 'the turn re-reads it');
  w.localStorage.removeItem('ft-pocket-sideways');
  w.dispatchEvent(new w.StorageEvent('storage', { key: 'ft-pocket-sideways' }));
  assert.ok(html.classList.contains('pk-upright'), 'a storage event re-reads it');
  w.localStorage.setItem('ft-pocket-sideways', '1');
  w.dispatchEvent(new w.StorageEvent('storage', { key: 'ft-other' }));
  assert.ok(html.classList.contains('pk-upright'), 'another key\'s storage event leaves it');
  w.dispatchEvent(new w.Event('resize'));
  assert.ok(!html.classList.contains('pk-upright'), 'a resize re-reads it');
  // another tab clearing ALL storage (localStorage.clear) fires a storage event with key null
  w.localStorage.removeItem('ft-pocket-sideways');
  w.dispatchEvent(new w.StorageEvent('storage', { key: null }));
  assert.ok(html.classList.contains('pk-upright'), 'a clear (key null) re-reads it');
});

test('mark: setPocketSideways writes "1" or REMOVES the key, and re-marks at once', () => {
  const w = new JSDOM('<body></body>', { url: 'http://localhost/music' }).window;
  w.document.documentElement.classList.add('is-phone');
  assert.strictEqual(SK.setPocketSideways(true, w), false);
  assert.strictEqual(w.localStorage.getItem('ft-pocket-sideways'), '1');
  assert.ok(!w.document.documentElement.classList.contains('pk-upright'));
  assert.strictEqual(SK.setPocketSideways(false, w), true);
  assert.strictEqual(w.localStorage.getItem('ft-pocket-sideways'), null, 'removed, not "0"');
  assert.ok(w.document.documentElement.classList.contains('pk-upright'));
  assert.strictEqual(SK.pocketSideways({ getItem: () => '0' }), false, 'only "1" is sideways');
  assert.strictEqual(SK.pocketSideways({ getItem: () => { throw new Error('denied'); } }), false, 'storage denied: upright');
});

// ---- the turn readers ---------------------------------------------------------------------------
test('turnOf reads the DRAWN turn off the computed transform; unturnDelta is its exact inverse', () => {
  const fake = (t) => ({ getComputedStyle: () => ({ transform: t }) });
  const el = {};
  assert.strictEqual(SK.turnOf(el, fake('none')), 0);
  assert.strictEqual(SK.turnOf(el, fake('matrix(0, -1, 1, 0, -195, -422)')), 270, 'rotate(-90deg) (angle 90) reads 270');
  assert.strictEqual(SK.turnOf(el, fake('matrix(0, 1, -1, 0, -195, -422)')), 90, 'rotate(90deg) (angle 270) reads 90');
  assert.strictEqual(SK.turnOf(el, fake('matrix(1, 0, 0, 1, 5, 5)')), 0, 'a translate is no turn');
  assert.strictEqual(SK.turnOf(null, fake('none')), 0);
  // the CSS rotate(theta) maps a local (x, y) to the screen as (x cos - y sin, x sin + y cos); unturn undoes it
  for (const deg of [0, 90, 180, 270, 30]) {
    const th = deg * Math.PI / 180;
    for (const [x, y] of [[100, 0], [0, 100], [-37, 52]]) {
      const sx = x * Math.cos(th) - y * Math.sin(th); const sy = x * Math.sin(th) + y * Math.cos(th);
      const back = SK.unturnDelta(sx, sy, deg);
      assert.ok(Math.abs(back.x - x) < 1e-9 && Math.abs(back.y - y) < 1e-9, `${deg}deg (${x},${y}) -> (${back.x},${back.y})`);
    }
  }
  const q = SK.unturnDelta(100, 0, 270);
  assert.deepStrictEqual(q, { x: -0, y: 100 }, 'a quarter turn is exact (no 6e-17 for a CSS translate to print as an exponent)');
});

// ---- the CSS ------------------------------------------------------------------------------------
const CSS = readStyleCss();
const RULES = cssRules(CSS);
const LAND = RULES.filter((r) => /@media \(orientation: landscape\)/.test(r.at));

test('CSS: every D7 sideways rule stands aside ONLY for the turned upright player (zero specificity); it still draws the pre-stamp frame (gate r1)', () => {
  const d7 = LAND.filter((r) => /:where\(html\.is-phone/.test(r.sel));
  assert.strictEqual(d7.length, 18, 'precondition: the D7 block\'s 18 rules (25 selectors)');
  for (const r of d7) {
    for (const part of r.sel.split(/,(?![^(]*\))/)) assert.strictEqual(part.trim().indexOf(':where(html.is-phone:not(.pk-upright[data-ft-rot="90"]):not(.pk-upright[data-ft-rot="270"])) '), 0, part.trim());
  }
});

test('CSS: the upright block turns the full player back by the screen angle, as the phone\'s portrait box', () => {
  const up = LAND.filter((r) => /html\.is-phone\.pk-upright/.test(r.sel));
  const by = (re) => up.find((r) => re.test(r.sel) && !/,/.test(r.sel));
  const r90 = by(/\[data-ft-rot="90"\] \.mms-full$/); const r270 = by(/\[data-ft-rot="270"\] \.mms-full$/);
  assert.ok(r90 && r270, 'one rule per angle');
  assert.match(r90.body, /transform:translate\(-50%, -50%\) rotate\(-90deg\)/, 'angle 90 (the top to the left) turns -90deg');
  assert.match(r270.body, /transform:translate\(-50%, -50%\) rotate\(90deg\)/, 'angle 270 turns 90deg');
  const box = up.find((r) => /\[data-ft-rot="90"\] \.mms-full,/.test(r.sel) && /\[data-ft-rot="270"\] \.mms-full$/.test(r.sel));
  assert.ok(box, 'the shared box rule');
  assert.match(box.body, /inset:auto; top:50%; left:50%;/);
  assert.match(box.body, /width:100vh; width:100dvh; height:100vw;/, 'the portrait box: the landscape height wide, its width tall');
  // every viewport unit the player sizes from, re-pointed to the box (its width is the landscape vh, its height the vw)
  for (const [k, v] of [['70vw', '70vh'], ['26vw', '26vh'], ['86vh', '86vw'], ['dvh', '100vw'], ['88vw', '88vh'], ['92vw', '92vh']]) {
    assert.match(box.body, new RegExp('--mms-up-' + k + ':' + v + ';'), '--mms-up-' + k);
  }
  const src = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(src, /--pk-wheel-d:min\(var\(--mms-up-70vw, 70vw\),288px\); --pk-center-d:min\(var\(--mms-up-26vw, 26vw\),108px\);/, 'the chassis reads them');
  assert.match(src, /\.mms-sticker-menu\{ min-width:min\(320px, var\(--mms-up-88vw, 88vw\)\); max-width:var\(--mms-up-92vw, 92vw\); max-height:86vh;/, 'the sticker menu reads them');
  assert.match(src, /max-height:min\(var\(--mms-up-86vh, 86vh\), calc\(var\(--mms-up-dvh, 100dvh\)/, 'the phone sticker menu height reads them');
  // the safe areas follow the glass: the notch (portrait top) lies on the screen's left at 90, its right at 270
  assert.match(r90.body, /--mms-up-top:env\(safe-area-inset-left,0px\); --mms-up-bottom:env\(safe-area-inset-right,0px\); --mms-up-left:env\(safe-area-inset-bottom,0px\);/);
  assert.match(r270.body, /--mms-up-top:env\(safe-area-inset-right,0px\); --mms-up-bottom:env\(safe-area-inset-left,0px\); --mms-up-left:env\(safe-area-inset-top,0px\);/);
  // the turned lists pan on both axes: Chromium reads touch-action in SCREEN space (measured: pan-y alone left an up-drag
  // in the iPod's frame - sideways on the glass - unscrolled, 0 px vs 99 in portrait); the list itself scrolls in its own frame
  const pan = up.find((r) => /:is\(\.ip-listview, \.ipm-list, \.mms-qlist\)/.test(r.sel));
  assert.ok(pan && /data-ft-rot="90"/.test(pan.sel) && /data-ft-rot="270"/.test(pan.sel), 'the list rule, both angles');
  assert.match(pan.body, /^\s*touch-action:pan-x pan-y;\s*$/);
  for (const r of up) assert.doesNotMatch(r.body, /transition|animation/, 'no animation is added (R5)');
  assert.ok(!up.some((r) => /mms-popout/.test(r.sel)), 'phone only (the pop-out is portrait by design)');
  // no angle 0 / 180 rule: the pre-stamp frame (still reading portrait) draws the player unturned (v1.354's rule)
  assert.ok(!up.some((r) => /data-ft-rot="(0|180)"/.test(r.sel)));
});

test('CSS: the inset readers fall back to today\'s env() (portrait and Sideways unchanged)', () => {
  const src = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.strictEqual((src.match(/var\(--mms-up-top, var\(--pk-top-inset, env\(safe-area-inset-top,0px\)\)\)/g) || []).length, 3, 'the three chassis top paddings');
  assert.strictEqual((src.match(/var\(--mms-up-bottom, env\(safe-area-inset-bottom,0px\)\)/g) || []).length, 5, 'the chassis bottoms, the sticker, its menu');
  assert.match(src, /left:calc\(var\(--mms-up-left, env\(safe-area-inset-left,0px\)\) \+ var\(--space-6\)\)/, 'the sticker\'s corner');
  // the variables are only ever SET inside the upright block
  const sets = RULES.filter((r) => /--mms-up-[a-z0-9]+\s*:/.test(r.body));
  assert.ok(sets.length >= 3 && sets.every((r) => /html\.is-phone\.pk-upright/.test(r.sel)), sets.map((r) => r.sel).join(' | '));
});

test('CSS: the Transparent board photo turns back by the angle except on the turned upright player (there it already sits on the glass)', () => {
  const board = RULES.filter((r) => /--mms-ipod-board-turn\s*:/.test(r.body) && /data-ft-rot/.test(r.sel));
  assert.strictEqual(board.length, 3, 'the 90, 270 and 0/180 rules');
  for (const r of board) {
    for (const part of r.sel.split(/,(?![^(]*\))/)) assert.match(part.trim(), /^html\.is-phone:where\(:not\(\.pk-upright\[data-ft-rot="90"\]\):not\(\.pk-upright\[data-ft-rot="270"\]\)\)\[data-ft-rot="\d+"\] \.mms-full\.mms-ipod$/);
  }
});

// ---- the input under the turn, through the REAL engine -------------------------------------------
const HTML = `<body>
  <video id="media-player"></video>
  <button id="pp-btn"></button><button id="track-prev-btn"></button><button id="track-next-btn"></button>
  <input id="seek-bar" type="range" />
  <div id="panel" class="music-nowplaying-panel" hidden></div>
</body>`;
function boot(turn) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music' });
  const w = dom.window;
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = w; global.document = w.document; global.Event = w.Event;
  w.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  Object.defineProperty(w.HTMLInputElement.prototype, 'switch', { value: false, configurable: true });
  w.ontouchstart = null;
  delete require.cache[skinsPath]; delete require.cache[surfacePath];
  w.FileTubeMusicSkins = require(skinsPath);
  require(surfacePath);
  const panel = w.document.getElementById('panel');
  // the DRAWN turn: the panel's computed transform (what turnOf reads); everything else is jsdom's
  const gcs = w.getComputedStyle.bind(w);
  w.getComputedStyle = (el, p) => {
    const cs = gcs(el, p);
    if (el !== panel) return cs;
    return new Proxy(cs, { get: (t, k) => (k === 'transform' ? turn : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) });
  };
  const cfg = {
    panel, win: w, getSkinId: () => 'ipod',
    getCtx: () => ({ track: { title: 'T', artist: 'A', album: 'B', artUrl: '' }, upNext: [], fullList: [{ title: 'T' }],
      playing: true, posSec: 10, durSec: 100, posLabel: '0:10', remLabel: '-1:30' }),
    hostCtl: (id) => w.document.getElementById(id),
    onSelectIndex: () => {}, onDock: () => {}, onHome: () => {}, fastScan: true, sticker: {},
  };
  const engine = w.FileTubeSkinSurface.create(cfg);
  engine.paint();
  return { w, panel, engine, restore: () => Object.assign(global, saved) };
}
const pev = (w, type, x, y) => new w.PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true });

for (const [name, turn, want] of [
  ['unturned (portrait / Sideways): the screen delta as it was', 'none', 'translate(118px,0px)'],
  ['angle 90 (drawn rotate(-90deg)): a finger right of the centre on the glass is BELOW it in the player', 'matrix(0, -1, 1, 0, 0, 0)', 'translate(18px,100px)'],
  ['angle 270 (drawn rotate(90deg)): right of the centre is ABOVE it in the player', 'matrix(0, 1, -1, 0, 0, 0)', 'translate(18px,-100px)'],
]) {
  test('input: the haptic switch sits under the finger in the turned frame - ' + name, () => {
    const b = boot(turn);
    try {
      const wheel = b.panel.querySelector('.ip-wheel');
      const g = b.panel.querySelector('.mms-haptic-ghost');
      assert.ok(wheel && g, 'precondition: the wheel and its haptic switch');
      // a real wheel rect centred on (0,0), 240 px (jsdom rects are 0: LESSONS 2); the finger 100 px right of the centre
      wheel.getBoundingClientRect = () => ({ left: -120, top: -120, width: 240, height: 240, right: 120, bottom: 120 });
      b.w.document.elementsFromPoint = () => [g, wheel];
      const seen = [];
      let cur = g.style.transform;
      Object.defineProperty(g.style, 'transform', { configurable: true, get: () => cur, set: (v) => { cur = v; seen.push(v); } });
      g.dispatchEvent(pev(b.w, 'pointerdown', 100, 0));
      const placed = seen.filter((v) => /^translate/.test(v));
      assert.ok(placed.length >= 1, 'placed at the press: ' + JSON.stringify(seen));
      assert.strictEqual(placed[0], want);
      b.w.document.dispatchEvent(pev(b.w, 'pointerup', 100, 0));
    } finally { b.engine.destroy && b.engine.destroy(); b.restore(); }
  });
}

for (const [name, turn, rect, x, y, want] of [
  // the bar 200 px long; unturned it lies along the screen x
  ['unturned: 25% along the bar', 'none', { left: 0, top: 0, width: 200, height: 10 }, 50, 5, 0.25],
  // angle 90: the bar's start (its local left) is at the screen's BOTTOM; its rect is 10 wide, 200 tall
  ['angle 90: 25% along the bar is near the screen bottom', 'matrix(0, -1, 1, 0, 0, 0)', { left: 0, top: 0, width: 10, height: 200 }, 5, 150, 0.25],
  ['angle 270: 25% along the bar is near the screen top', 'matrix(0, 1, -1, 0, 0, 0)', { left: 0, top: 0, width: 10, height: 200 }, 5, 50, 0.25],
]) {
  test('input: a tap on the seek bar seeks by the position ALONG the turned bar - ' + name, () => {
    const b = boot(turn);
    try {
      const seek = b.panel.querySelector('[data-skin-seek]');
      assert.ok(seek, 'precondition: the Now Playing seek bar');
      seek.getBoundingClientRect = () => Object.assign({ right: rect.left + rect.width, bottom: rect.top + rect.height }, rect);
      Object.defineProperty(seek, 'offsetWidth', { configurable: true, get: () => 200 });
      const sb = b.w.document.getElementById('seek-bar');
      let got = null;
      sb.addEventListener('change', () => { got = Number(sb.value); });
      seek.dispatchEvent(new b.w.MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      assert.ok(got !== null, 'the seek fired');
      assert.ok(Math.abs(got - want) < 1e-9, `sought ${got}, want ${want}`);
    } finally { b.engine.destroy && b.engine.destroy(); b.restore(); }
  });
}

test('input: the volume bar and the seek bar share ONE mapping (fractionAlong), and the haptic placements read the gesture\'s turn', () => {
  const src = fs.readFileSync(surfacePath, 'utf8');
  assert.strictEqual((src.match(/fractionAlong\(/g) || []).length, 3, 'defined once, called by the volume groove and the seek bar');
  assert.ok(!/\(e\.clientX - (vr|rct)\.left\)/.test(src), 'no per-handler screen-x fraction is left');
  assert.strictEqual((src.match(/localDelta\(x, y, r\.left \+ r\.width \/ 2, r\.top \+ r\.height \/ 2, st\.turn\)/g) || []).length, 2, 'the ghost and the sweep');
  assert.match(src, /st\.turn = panelTurn\(\);/, 'read once per gesture');
});

// ---- the lighting ---------------------------------------------------------------------------------
test('lighting: the tilt maps by the screen angle PLUS the drawn turn (upright = the portrait mapping)', () => {
  const L = require('../../public/js/pocket-lighting.js');
  // angle 90 with the player drawn turned 270 (rotate(-90deg)): 90 + 270 = 360 = the portrait mapping
  assert.deepStrictEqual(L.mapTilt(10, 20, (90 + 270) % 360), L.mapTilt(10, 20, 0));
  assert.notDeepStrictEqual(L.mapTilt(10, 20, 90), L.mapTilt(10, 20, 0), 'precondition: the screen angle alone maps differently');
  const src = fs.readFileSync(path.join(ROOT, 'public/js/pocket-lighting.js'), 'utf8');
  assert.match(src, /var m = mapTilt\(e && e\.beta, e && e\.gamma, orientationAngle\(win\) \+ drawnTurn\(\)\);/);
  assert.match(src, /turnVal = S2\.turnOf\(panel, win\)/, 'the turn of THIS panel, as drawn (cached per stamp / class / shape, gate r1 S4)');
});

// ---- the switches ---------------------------------------------------------------------------------
test('Pocket Settings: a "Stay Upright" check row on a phone (checked = upright), never off a phone', () => {
  const rows = SK.menuStaticItems({ type: 'settings' }, { hasLighting: true, hasUpright: true, upright: true });
  assert.deepStrictEqual(rows.map((r) => r.label), ['Lighting', 'Stay Upright', 'About']);
  assert.deepStrictEqual(rows[1], { label: 'Stay Upright', action: 'upright', check: true });
  assert.strictEqual(SK.menuStaticItems({ type: 'settings' }, { hasUpright: true, upright: false })[0].check, false);
  assert.deepStrictEqual(SK.menuStaticItems({ type: 'settings' }, { hasUpright: false }).map((r) => r.label), ['About']);
});

test('Pocket Settings: selecting Stay Upright flips the setting and re-lists the level with the new check', async () => {
  const dom = new JSDOM(HTML, { url: 'http://localhost/music' });
  const w = dom.window;
  const saved = { window: global.window, document: global.document, Event: global.Event };
  global.window = w; global.document = w.document; global.Event = w.Event;
  w.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  w.document.documentElement.classList.add('is-phone');
  try {
    delete require.cache[skinsPath]; delete require.cache[surfacePath];
    w.FileTubeMusicSkins = require(skinsPath);
    require(surfacePath);
    const panel = w.document.getElementById('panel');
    const engine = w.FileTubeSkinSurface.create({
      panel, win: w, getSkinId: () => 'ipod',
      getCtx: () => ({ track: null, upNext: [], fullList: [], playing: false, posSec: 0, durSec: 0, posLabel: '', remLabel: '' }),
      hostCtl: (id) => w.document.getElementById(id), onSelectIndex: () => {}, onDock: () => {}, onHome: () => {}, fastScan: true, sticker: {},
      menu: { load: () => Promise.resolve({ items: [] }), onPlay: () => {}, onShuffleAll: () => {}, hasCurrent: () => false, currentId: () => null },
    });
    engine.paint();
    const tapRow = async (label) => {
      const row = [...panel.querySelectorAll('.ipm-row')].find((r) => (r.querySelector('.ipm-lbl') || {}).textContent === label);
      assert.ok(row, label + ' row in: ' + [...panel.querySelectorAll('.ipm-row .ipm-lbl')].map((e) => e.textContent).join('/'));
      row.click();
      await new Promise((r) => setTimeout(r, 5));
    };
    const checked = () => {
      const row = [...panel.querySelectorAll('.ipm-row')].find((r) => (r.querySelector('.ipm-lbl') || {}).textContent === 'Stay Upright');
      return row ? row.classList.contains('is-checked') : null;
    };
    await tapRow('Settings');
    assert.strictEqual(checked(), true, 'upright by default');
    await tapRow('Stay Upright');
    assert.strictEqual(w.localStorage.getItem('ft-pocket-sideways'), '1', 'Sideways stored');
    assert.ok(!w.document.documentElement.classList.contains('pk-upright'), 'the mark dropped at once');
    assert.strictEqual(checked(), false, 'the level re-listed with the check off');
    await tapRow('Stay Upright');
    assert.strictEqual(w.localStorage.getItem('ft-pocket-sideways'), null);
    assert.ok(w.document.documentElement.classList.contains('pk-upright'));
    assert.strictEqual(checked(), true);
    engine.destroy && engine.destroy();
  } finally { Object.assign(global, saved); }
});

test('Settings > Mobile player: "Keep the iPod upright" reflects and writes ft-pocket-sideways (checked = no key)', () => {
  const setup = require('../../public/js/setup.js');
  const html = fs.readFileSync(path.join(ROOT, 'public/setup.html'), 'utf8');
  const w = new JSDOM(html, { url: 'http://localhost/setup.html' }).window;
  w.FileTubeMusicSkins = SK;
  w.document.documentElement.classList.add('is-phone');
  try {
    const c = w.document.getElementById('pocket-upright-check');
    assert.ok(c.closest('details[data-collapse-key="mobile-player"]'), 'in Mobile player');
    assert.strictEqual(w.document.querySelector('label[for="pocket-upright-check"]').textContent, 'Keep the iPod upright');
    assert.match(c.closest('.setup-group').querySelector('.setup-note').textContent, /On by default; remembered on this device only\./);
    setup.loadPocketUprightControl(w);
    assert.strictEqual(c.checked, true, 'on by default');
    w.localStorage.setItem('ft-pocket-sideways', '1');
    setup.loadPocketUprightControl(w);
    assert.strictEqual(c.checked, false, 'reflects Sideways');
    setup.wirePocketUprightControl(w);
    c.checked = true; c.dispatchEvent(new w.Event('change'));
    assert.strictEqual(w.localStorage.getItem('ft-pocket-sideways'), null, 'upright = the key removed');
    assert.ok(w.document.documentElement.classList.contains('pk-upright'), 'and the mark is set at once');
    c.checked = false; c.dispatchEvent(new w.Event('change'));
    assert.strictEqual(w.localStorage.getItem('ft-pocket-sideways'), '1');
    assert.ok(!w.document.documentElement.classList.contains('pk-upright'));
    const src = fs.readFileSync(path.join(ROOT, 'public/js/setup.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.match(/\nfunction init\(root\) \{([\s\S]*?)\n\}/.exec(src)[1], /\n\s*loadPocketUprightControl\(window\);/, 'init prefills it');
    assert.match(/\nfunction wireStaticControls\(signal\) \{([\s\S]*?)\n\}/.exec(src)[1], /\n\s*wirePocketUprightControl\(window, signal\);/, 'wireStaticControls wires it');
  } finally { w.close(); }
});

// ---- the app's swipe-back under the turn ----------------------------------------------------------
test('swipe-back: on a TURNED full player a "rightward" swipe is rightward across the upright iPod, not across the glass', () => {
  const COMMON = require.resolve('../../public/js/common.js');
  const saved = { window: global.window, document: global.document };
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  let wireSwipeBackGesture;
  try { ({ wireSwipeBackGesture } = require(COMMON)); } finally { delete require.cache[COMMON]; Object.assign(global, saved); }
  const run = (turn, moves) => {
    const w = new JSDOM('<!DOCTYPE html><html><body><div id="p" class="mms-full"><div id="lcd">screen</div></div><p id="page">x</p></body></html>', { url: 'http://localhost/music' }).window;
    w.FileTubeMusicSkins = SK;
    const panel = w.document.getElementById('p');
    const gcs = w.getComputedStyle.bind(w);
    w.getComputedStyle = (el, ps) => { const cs = gcs(el, ps); return el === panel ? new Proxy(cs, { get: (t, k) => (k === 'transform' ? turn : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) }) : cs; };
    const backs = { n: 0 };
    wireSwipeBackGesture(w.document, w, () => { backs.n += 1; });
    const tgt = w.document.getElementById('lcd');
    const fire = (type, x, y) => {
      const e = new w.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y, target: tgt }] });
      tgt.dispatchEvent(e);
    };
    fire('touchstart', 200, 200);
    for (const [x, y] of moves) fire('touchmove', 200 + x, 200 + y);
    const last = moves[moves.length - 1];
    fire('touchend', 200 + last[0], 200 + last[1]);
    w.close();
    return backs.n;
  };
  const RIGHT = [[40, 2], [180, 5]]; const UP = [[2, -40], [5, -180]]; const DOWN = [[-2, 40], [-5, 180]];
  assert.strictEqual(run('none', RIGHT), 1, 'CONTROL: unturned, a rightward swipe on the skin goes back (v1.311.3)');
  assert.strictEqual(run('none', UP), 0);
  // angle 90, drawn rotate(-90deg): the iPod's right is the glass's UP
  assert.strictEqual(run('matrix(0, -1, 1, 0, 0, 0)', RIGHT), 0, 'across the glass = DOWN the iPod: no back');
  assert.strictEqual(run('matrix(0, -1, 1, 0, 0, 0)', UP), 1, 'up the glass = rightward across the iPod: a back');
  // angle 270, drawn rotate(90deg): the iPod's right is the glass's DOWN
  assert.strictEqual(run('matrix(0, 1, -1, 0, 0, 0)', DOWN), 1);
  assert.strictEqual(run('matrix(0, 1, -1, 0, 0, 0)', RIGHT), 0);
});

// ---- Brick under the turn ---------------------------------------------------------------------------
test('Brick: on the turned player the board sizes from its layout box, not its swapped screen footprint (unturned: the rect, as before)', () => {
  const run = (rect, offs) => {
    const dom = new JSDOM('<!doctype html><body><div id="lcd"></div></body>', { url: 'http://localhost/', runScripts: 'outside-only' });
    const w = dom.window;
    w.requestAnimationFrame = () => 1; w.cancelAnimationFrame = () => {};
    w.HTMLCanvasElement.prototype.getContext = function () {
      return new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
    };
    w.devicePixelRatio = 2;
    w.eval(fs.readFileSync(path.join(ROOT, 'public', 'js', 'music-skins.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(ROOT, 'public', 'js', 'ipod-brick.js'), 'utf8'));
    w.HTMLElement.prototype.getBoundingClientRect = function () { return { width: rect[0], height: rect[1], left: 0, top: 0, right: rect[0], bottom: rect[1] }; };
    Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => offs[0] });
    Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => offs[1] });
    const host = w.document.getElementById('lcd');
    const g = w.FileTubeBrick.mount(host, {});
    const c = host.querySelector('canvas');
    const out = [c.width, c.height];
    g.destroy(); w.close();
    return out;
  };
  assert.deepStrictEqual(run([300.4, 200.6], [300, 201]), [600, 402], 'unturned: the rect (rounded), exactly as before');
  assert.deepStrictEqual(run([200, 300], [300, 200]), [600, 400], 'turned: the 300 x 200 board, not the 200 x 300 footprint');
});

test('swipe-back CLAIM: on a turned player, a drag rightward across the iPod is claimed (its later moves preventDefault-ed); across the glass it is not (gate r1 W2)', () => {
  const COMMON = require.resolve('../../public/js/common.js');
  const saved = { window: global.window, document: global.document };
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  let wireSwipeBackGesture;
  try { ({ wireSwipeBackGesture } = require(COMMON)); } finally { delete require.cache[COMMON]; Object.assign(global, saved); }
  const run = (turn, moves) => {
    const w = new JSDOM('<!DOCTYPE html><html><body><div id="p" class="mms-full"><div id="lcd">screen</div></div></body></html>', { url: 'http://localhost/music' }).window;
    w.FileTubeMusicSkins = SK;
    const panel = w.document.getElementById('p');
    const gcs = w.getComputedStyle.bind(w);
    w.getComputedStyle = (el, ps) => { const cs = gcs(el, ps); return el === panel ? new Proxy(cs, { get: (t, k) => (k === 'transform' ? turn : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) }) : cs; };
    wireSwipeBackGesture(w.document, w, () => {});
    const tgt = w.document.getElementById('lcd');
    const fire = (type, x, y) => {
      const e = new w.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y, target: tgt }] });
      tgt.dispatchEvent(e);
      return e.defaultPrevented;
    };
    fire('touchstart', 200, 200);
    const prevented = moves.map(([x, y]) => fire('touchmove', 200 + x, 200 + y));
    fire('touchend', 200, 200);
    w.close();
    return prevented;
  };
  // three moves: the first claims (passively), the later ones are prevented through the claimed listener
  const UP = [[1, -40], [2, -80], [3, -120]]; const RIGHT = [[40, 1], [80, 2], [120, 3]];
  assert.deepStrictEqual(run('none', RIGHT).slice(1), [true, true], 'CONTROL: unturned, a rightward drag is claimed');
  assert.deepStrictEqual(run('matrix(0, -1, 1, 0, 0, 0)', UP).slice(1), [true, true], 'turned (angle 90): up the glass = right across the iPod, claimed');
  assert.deepStrictEqual(run('matrix(0, -1, 1, 0, 0, 0)', RIGHT).slice(1), [false, false], 'turned: right across the glass = down the iPod, never claimed (it may be a list scroll)');
});
