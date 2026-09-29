'use strict';

// [UNIT] UI pass D7 (Dean's ruling: "Pocket on rotation: STAY in Pocket. It is a phone mode, not a
// width mode"; F23, F58, F59). The Pocket skin gate is the DEVICE class `html.is-phone`, set ONCE
// at load (music-skins.js) from a coarse primary pointer and the screen's SHORT side (<= 500 CSS
// px); style.css keys the whole takeover on the same class; a rotate never changes it. This file
// binds, each on its own:
//   - the decision (phoneFrom): phones in both orientations, never an iPad or a desktop;
//   - the mark: set once, never re-evaluated by a resize / orientationchange, read by isPhone;
//   - the CSS: every rule of the takeover carries the scope; nothing Pocket stays on a width
//     query; the landscape block lays the screen and the wheel side by side with the safe-area
//     insets on the sides, and nothing in it transitions;
//   - the stillness hold (common.js installResizeStillness + html.no-motion);
//   - the same-art guard (a repaint of the SAME cover never re-reveals it);
//   - the mini player's reserved footprint (music.js reserveDockSpace, F58);
//   - the ?debugLifecycle=1 viewport line (player.js formatViewportDetail).
// The real rotate is measured in a browser by test/geometry (G4 pocket-rotation) and the views'
// no-teardown behaviour by music-skin-integration / podcast-nowplaying-view.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { readStyleCss, cssRules, POCKET_SCOPE, unscopePocket } = require('../helpers/stylesheets.js');

const skinsPath = require.resolve('../../public/js/music-skins.js');
const SK = require(skinsPath);

// ---- the decision ---------------------------------------------------------------------------
test('D7 phoneFrom: a coarse pointer + a short side <= 500px is a phone in BOTH orientations; an iPad, a desktop or a fine pointer is not', () => {
  const cases = [
    ['iPhone 15 portrait', true, 390, 844, true],
    ['iPhone 15 landscape (the rotate)', true, 844, 390, true],
    ['iPhone 15 Pro Max landscape', true, 932, 430, true],
    ['iPhone SE landscape', true, 667, 375, true],
    ['the boundary: 500', true, 500, 900, true],
    ['just past it: 501', true, 501, 900, false],
    ['iPad mini portrait', true, 744, 1133, false],
    ['iPad Air landscape', true, 1180, 820, false],
    ['iPad Pro portrait', true, 1024, 1366, false],
    ['a desktop', false, 1440, 900, false],
    ['a narrow desktop window on a small screen (fine pointer)', false, 390, 844, false],
    ['no screen numbers', true, NaN, 844, false],
  ];
  for (const [label, coarse, w, h, want] of cases) assert.strictEqual(SK.phoneFrom(coarse, w, h), want, label);
  assert.strictEqual(SK.PHONE_SHORT_SIDE_MAX, 500);
  assert.strictEqual(SK.PHONE_CLASS, 'is-phone');
});

// ---- the mark: once, and never by a rotate ---------------------------------------------------
function loadSkinsInto(win) {
  const saved = { window: global.window, document: global.document };
  global.window = win; global.document = win.document;
  try { delete require.cache[skinsPath]; return require(skinsPath); } finally { delete require.cache[skinsPath]; Object.assign(global, saved); }
}
function fakeDevice(win, dev) {
  win.matchMedia = (q) => ({ matches: /pointer:\s*coarse/.test(q) ? dev.coarse : false, media: q, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(win, 'screen', { configurable: true, value: { width: dev.w, height: dev.h } });
}

test('D7 mark: loading music-skins.js marks a phone once; a rotate (resize + orientationchange, the screen swapped) never changes it', () => {
  const dom = new JSDOM('<body></body>', { url: 'http://localhost/music' });
  const w = dom.window;
  const dev = { coarse: true, w: 390, h: 844 };
  fakeDevice(w, dev);
  const api = loadSkinsInto(w);
  const html = w.document.documentElement;
  assert.ok(html.classList.contains('is-phone'), 'a phone is marked at load');
  dev.w = 844; dev.h = 390; fakeDevice(w, dev); // turned sideways
  w.dispatchEvent(new w.Event('orientationchange'));
  w.dispatchEvent(new w.Event('resize'));
  assert.ok(html.classList.contains('is-phone'), 'still a phone after the rotate');
  // the JS half reads the same class, never a query
  const saved = { document: global.document };
  global.document = w.document;
  try {
    assert.strictEqual(api.isPhone(), true, 'isPhone reads the class');
    w.matchMedia = () => ({ matches: false }); // every query now says no
    assert.strictEqual(api.isPhone(), true, 'a query flip is not the gate');
    html.classList.remove('is-phone');
    assert.strictEqual(api.isPhone(), false, 'the class IS the gate (removing it turns the skin off)');
    assert.strictEqual(api.skinActiveFor({ isMusic: true }), false);
    html.classList.add('is-phone');
    assert.strictEqual(api.skinActiveFor({ isMusic: true }), true);
    assert.strictEqual(api.skinActiveFor({ isMusic: false }), false, 'a video never gets the skin');
  } finally { Object.assign(global, saved); }
});

test('D7 mark: an iPad (coarse, short side 820) and a desktop are never marked - before or after a resize to a narrow window', () => {
  for (const dev of [{ coarse: true, w: 820, h: 1180 }, { coarse: false, w: 1440, h: 900 }]) {
    const dom = new JSDOM('<body></body>', { url: 'http://localhost/music' });
    const w = dom.window;
    fakeDevice(w, dev);
    loadSkinsInto(w);
    const html = w.document.documentElement;
    assert.strictEqual(html.classList.contains('is-phone'), false, 'not a phone at load');
    fakeDevice(w, { coarse: true, w: 390, h: 700 }); // a narrow window / split view afterwards
    w.dispatchEvent(new w.Event('resize'));
    assert.strictEqual(html.classList.contains('is-phone'), false, 'a resize never promotes it (set once at load)');
  }
});

test('D7 mark: markPhoneClass only ever ADDS (a shell or a test that marked it keeps it)', () => {
  const dom = new JSDOM('<body></body>', { url: 'http://localhost/music' });
  const w = dom.window;
  fakeDevice(w, { coarse: false, w: 1440, h: 900 });
  w.document.documentElement.classList.add('is-phone');
  assert.strictEqual(SK.markPhoneClass(w), true);
  assert.ok(w.document.documentElement.classList.contains('is-phone'));
});

// ---- the CSS ---------------------------------------------------------------------------------
const CSS = readStyleCss();
const RULES = cssRules(CSS);

test('D7 CSS: the takeover block - every selector of every rule carries the device scope; the scope adds no specificity', () => {
  assert.strictEqual(POCKET_SCOPE, ':where(html.is-phone, html.mms-popout)', 'the one scope (zero specificity: :where)');
  const src = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const start = src.indexOf(POCKET_SCOPE + ' body.mms-on #view-root[data-view="music"] #player-slot');
  const end = src.indexOf('@keyframes mms-marquee');
  assert.ok(start > 0 && end > start, 'precondition: the block is found');
  const block = cssRules(src.slice(start, end)).filter((r) => r.at.indexOf('orientation: landscape') === -1);
  assert.ok(block.length > 200, 'precondition: the block holds the takeover (' + block.length + ' rules)');
  const bare = [];
  for (const r of block) {
    for (const part of r.sel.split(/,(?![^(]*\))/)) if (part.trim().indexOf(POCKET_SCOPE + ' ') !== 0) bare.push(part.trim());
  }
  assert.deepStrictEqual(bare, [], 'every selector is scoped (an unscoped one would apply on a desktop or an iPad)');
});

test('D7 CSS: nothing Pocket is decided by a width query any more (the rotate that tore the skin down)', () => {
  const offenders = RULES.filter((r) => /max-width:\s*768px/.test(r.at) && /\.mms-|\bmms-on\b|\.ip-(?:lcd|wheel|status|menuview)|\.ipm-/.test(r.sel));
  assert.deepStrictEqual(offenders.map((r) => r.sel), [], 'no .mms / .ip / .ipm rule inside a 768px query');
  // the pop-out button's pre-JS box follows the same class
  assert.ok(RULES.some((r) => r.sel === 'html.is-phone #music-popout-btn' && /display:\s*none/.test(r.body)), 'the pop-out box keys on the class');
});

test('D7 CSS landscape: side by side (screen left, wheel right), insets on the sides, and no transition anywhere in it', () => {
  const land = RULES.filter((r) => /@media \(orientation: landscape\)/.test(r.at) && r.sel.indexOf(':where(html.is-phone)') === 0);
  const sel = (s) => land.find((r) => r.sel === ':where(html.is-phone) ' + s);
  const grid = sel('.mms-full.mms-ipod');
  assert.ok(grid, 'the Click chassis grid rule');
  assert.match(grid.body, /display:grid;/);
  assert.match(grid.body, /grid-template-columns:minmax\(0, 1fr\) var\(--pkl-wheel\)/, 'two columns: the screen takes the rest, the wheel its fitted size');
  assert.match(grid.body, /--pkl-wheel:min\(var\(--pk-wheel-d\), var\(--pkl-h\), calc\(var\(--pkl-w\) \* \.4\)\)/, 'the wheel is the chassis size fitted to the SHORT side');
  assert.match(grid.body, /env\(safe-area-inset-left,0px\)/, 'the left inset (the notch side) pads the grid');
  assert.match(grid.body, /env\(safe-area-inset-right,0px\)/, 'and the right');
  assert.match(sel('.mms-full.mms-ipod .ip-lcd').body, /grid-column:1;/, 'the LCD is the left column');
  assert.match(sel('.mms-full.mms-ipod .ip-lcd').body, /height:min\(100%, calc\(/, 'height-fitted');
  assert.match(sel('.mms-full.mms-ipod .ip-wheelwrap').body, /grid-column:2;/, 'the wheel is the right column');
  assert.match(sel('.mms-full.mms-ipod .ip-wheel').body, /width:var\(--pkl-wheel\); height:var\(--pkl-wheel\);/);
  assert.ok(sel('.mms-full.mms-apple .mms-art') && sel('.mms-full.mms-spotify .mms-art'), 'Cider and Nordic have their landscape too');
  assert.match(sel('.mms-full .mms-sticker-wrap').body, /right:calc\(env\(safe-area-inset-right,0px\)/, 'the sticker moves to the right corner (the screen owns the left)');
  for (const r of land) assert.doesNotMatch(r.body, /transition|animation/, r.sel + ': nothing animates between the layouts (AC9)');
  assert.ok(!land.some((r) => r.sel.indexOf('mms-popout') !== -1), 'phone only: the pop-out window keeps its portrait layout and tray');
});

test('D7 CSS stillness: html.no-motion zeroes every transition (incl. pseudo-elements), and nothing else', () => {
  assert.strictEqual(RULES.filter((x) => x.sel.indexOf('html.no-motion') !== -1).length, 1, 'ONE rule for the class');
  const r = RULES.find((x) => x.sel === 'html.no-motion *, html.no-motion *::before, html.no-motion *::after');
  assert.ok(r, 'the one rule');
  assert.strictEqual(r.body.trim(), 'transition: none !important;');
  assert.strictEqual(r.at, '', 'at every width');
});

// ---- the stillness hold (common.js) -----------------------------------------------------------
test('D7 installResizeStillness: a rotate or a width-changing resize holds html.no-motion for STILLNESS_MS (each event restarts it), then lets go', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { installResizeStillness, STILLNESS_MS } = require('../../public/js/common.js');
  const dom = new JSDOM('<body></body>', { url: 'http://localhost/' });
  const w = dom.window;
  w.setTimeout = setTimeout; w.clearTimeout = clearTimeout; // the mocked clock
  let width = 390;
  Object.defineProperty(w, 'innerWidth', { configurable: true, get: () => width });
  assert.strictEqual(installResizeStillness(w), true);
  const html = w.document.documentElement;
  assert.strictEqual(html.classList.contains('no-motion'), false, 'idle: motion allowed');
  width = 844; // iOS may report the new width already at the orientationchange
  w.dispatchEvent(new w.Event('orientationchange'));
  assert.ok(html.classList.contains('no-motion'), 'set synchronously, before the new layout\'s styles');
  t.mock.timers.tick(STILLNESS_MS - 50);
  w.dispatchEvent(new w.Event('resize')); // iOS reports a resize after the orientationchange: the width moved since the last RESIZE
  t.mock.timers.tick(STILLNESS_MS - 50);
  assert.ok(html.classList.contains('no-motion'), 'the second event restarted the hold');
  t.mock.timers.tick(60);
  assert.strictEqual(html.classList.contains('no-motion'), false, 'released after the last event');
  w.dispatchEvent(new w.Event('resize')); // same width again: the URL bar, not a relayout
  assert.strictEqual(html.classList.contains('no-motion'), false, 'a height-only resize holds nothing');
  assert.strictEqual(STILLNESS_MS, 300);
});

// ---- the same-art guard (skin-surface.js paint) -----------------------------------------------
test('D7 same-art guard: a repaint whose cover is the SAME image is born revealed (no art-shimmer); a NEW cover shimmers in', () => {
  const dom = new JSDOM('<body><div id="panel"></div><video id="media-player"></video></body>', { url: 'http://localhost/music' });
  const w = dom.window;
  const saved = { window: global.window, document: global.document };
  global.window = w; global.document = w.document;
  w.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  const surfacePath = require.resolve('../../public/js/skin-surface.js');
  try {
    delete require.cache[skinsPath]; w.FileTubeMusicSkins = require(skinsPath);
    delete require.cache[surfacePath]; require(surfacePath);
    const ctx = { track: { title: 'A', artist: 'B', album: 'C', artUrl: '/albumart/one' }, upNext: [], fullList: [], posSec: 0, durSec: 100 };
    const eng = w.FileTubeSkinSurface.create({ panel: w.document.getElementById('panel'), getSkinId: () => 'spotify', getCtx: () => ctx, hostCtl: (id) => w.document.getElementById(id), win: w });
    eng.paint();
    const cover = () => w.document.querySelector('#panel .mms-art img');
    assert.ok(cover().classList.contains('art-shimmer'), 'the first paint reveals its cover (shimmer until it loads)');
    eng.paint(); // same track, same cover (an autoplay append, a chapter cross)
    assert.ok(cover(), 'repainted');
    assert.strictEqual(cover().classList.contains('art-shimmer'), false, 'the same cover is born revealed - no second reveal');
    ctx.track = Object.assign({}, ctx.track, { artUrl: '/albumart/two' });
    eng.paint();
    assert.ok(cover().classList.contains('art-shimmer'), 'a new cover reveals');
    eng.destroy();
  } finally { delete require.cache[surfacePath]; delete require.cache[skinsPath]; Object.assign(global, saved); }
});

// ---- F58: the mini player's footprint -----------------------------------------------------------
test('F58 reserveDockSpace: the view reserves the dock\'s footprint (over the page\'s own bottom padding), 0 when hidden, cleared on teardown', () => {
  const { reserveDockSpace } = require('../../public/js/music.js');
  const dom = new JSDOM('<body><main id="main-content"><div id="view-root" data-view="music"></div></main><div id="player-dock" hidden></div></body>', { url: 'http://localhost/music' });
  const w = dom.window;
  const obs = [];
  w.ResizeObserver = class { constructor(cb) { this.cb = cb; obs.push(this); } observe(el) { this.el = el; } disconnect() { this.off = true; } };
  Object.defineProperty(w, 'innerHeight', { configurable: true, value: 844 });
  const dock = w.document.getElementById('player-dock');
  dock.getBoundingClientRect = () => ({ top: 844 - 72 - 8 - 118, height: 118, bottom: 844 - 80 });
  const main = w.document.getElementById('main-content');
  main.style.paddingBottom = '72px'; // the mobile bottom bar's reserve
  const root = w.document.getElementById('view-root');
  const ctl = new w.AbortController();
  assert.strictEqual(reserveDockSpace(root, ctl.signal, w), true);
  assert.strictEqual(root.style.getPropertyValue('--music-dock-reserve'), '0px', 'no dock showing: nothing reserved');
  dock.hidden = false; obs[0].cb([]);
  assert.strictEqual(root.style.getPropertyValue('--music-dock-reserve'), String(844 - (844 - 72 - 8 - 118) - 72) + 'px', 'the dock top to the viewport bottom, less the bar reserve the page already keeps');
  dock.hidden = true; obs[0].cb([]);
  assert.strictEqual(root.style.getPropertyValue('--music-dock-reserve'), '0px', 'hidden again: released');
  ctl.abort();
  assert.ok(obs[0].off, 'the observer disconnects with the view');
  assert.strictEqual(root.style.getPropertyValue('--music-dock-reserve'), '', 'and the value goes (no other view inherits the padding)');
  assert.strictEqual(reserveDockSpace(root, null, Object.assign(Object.create(w), { ResizeObserver: undefined })), false, 'no ResizeObserver: nothing to watch');
  const padRule = RULES.find((r) => r.sel === '#view-root[data-view="music"]');
  assert.ok(padRule && /padding-bottom: var\(--music-dock-reserve, 0\)/.test(padRule.body), 'style.css pads the music view by the reserve');
});

// ---- the lifecycle log line --------------------------------------------------------------------
test('D7 formatViewportDetail: the ?debugLifecycle=1 viewport line - layout + visual viewport, orientation, device class', () => {
  const { formatViewportDetail } = require('../../public/js/player.js');
  const dom = new JSDOM('<body></body>', { url: 'http://localhost/' });
  const doc = dom.window.document;
  doc.documentElement.classList.add('is-phone');
  const w = { innerWidth: 844, innerHeight: 390, visualViewport: { width: 844, height: 360.4, offsetTop: 0 }, screen: { orientation: { type: 'landscape-primary' } }, document: doc };
  assert.strictEqual(formatViewportDetail(w), '844x390 · vv 844x360 · landscape-primary · phone');
  doc.documentElement.classList.remove('is-phone');
  assert.strictEqual(formatViewportDetail({ innerWidth: 1440, innerHeight: 900, document: doc }), '1440x900 · not-phone');
  assert.strictEqual(formatViewportDetail(null).length > 0, true, 'never throws');
  // v1.341.3: the document scroll rides the line (the rotation bump was a stray scroll).
  assert.strictEqual(formatViewportDetail({ innerWidth: 393, innerHeight: 852, pageYOffset: 59.4, document: doc }), '393x852 · not-phone · y 59');
  const src = require('node:fs').readFileSync(require.resolve('../../public/js/player.js'), 'utf8');
  for (const ev of ["'resize'", "'orientationchange'"]) assert.match(src, new RegExp("window\\.addEventListener\\(" + ev + ", function \\(\\) \\{ logViewport\\("), ev + ' is logged');
  assert.match(src, /visualViewport\.addEventListener\('resize', function \(\) \{ logViewport\('visualViewport:resize'\); \}\)/, 'the visual viewport too');
  assert.match(src, /function logViewport\(type\) \{\s*if \(!isDebugLifecycleEnabled\(\)/, 'a no-op unless the flag is on');
});

// the test helper stays honest: unscopePocket drops exactly the scope
test('helper: unscopePocket drops exactly the takeover scope and nothing else', () => {
  assert.strictEqual(unscopePocket(POCKET_SCOPE + ' .mms-full{a:b}\n' + POCKET_SCOPE + ' .x, ' + POCKET_SCOPE + ' .y{c:d}'), '.mms-full{a:b}\n.x, .y{c:d}');
  assert.strictEqual(unscopePocket(':where(html.is-phone) .mms-full{a:b}'), ':where(html.is-phone) .mms-full{a:b}', 'the landscape block keeps its own scope');
});

test('v1.341.3 rotation bump: for a second after a rotation, a scroll or visual-viewport resize re-runs the dead-zone snap on its next frame', () => {
  // Dean's recording: after rotating back to portrait the page sat one top-safe-area inset high for
  // ~0.35 s until the 650ms pass snapped it. Emulated (a stray 59px scroll 220ms after the rotate):
  // main corrected it 434ms later, this build 16ms later (one frame).
  const src = require('node:fs').readFileSync(require.resolve('../../public/js/player.js'), 'utf8');
  const body = src.slice(src.indexOf('function snapSoonAfterRotation()'), src.indexOf('function scheduleViewportCapNudge()'));
  assert.match(body, /if \(Date\.now\(\) > rotationSettleUntil \|\| rotationSnapQueued\) return;/);
  assert.match(body, /requestAnimationFrame\(function \(\) \{ rotationSnapQueued = false; snapRotationDeadZone\(\); \}\);/);
  assert.match(body, /window\.addEventListener\('scroll', snapSoonAfterRotation, \{ passive: true \}\);/);
  assert.match(body, /visualViewport\.addEventListener\('resize', snapSoonAfterRotation\);/);
  const sched = src.slice(src.indexOf('function scheduleViewportCapNudge()'), src.indexOf('function scheduleViewportCapNudge()') + 400);
  assert.match(sched, /rotationSettleUntil = Date\.now\(\) \+ 1000;/, 'every rotation opens the window');
  // Gate r1 W1: real user input closes the window (a user's scroll is never snapped back).
  assert.match(src, /function endRotationSettle\(\) \{ rotationSettleUntil = 0; \}/);
  assert.match(src, /\['touchstart', 'pointerdown', 'wheel', 'keydown'\]\.forEach\(function \(type\) \{\s*window\.addEventListener\(type, endRotationSettle, \{ passive: true, capture: true \}\);/);
  // (These are source locks: a no-op snapSoonAfterRotation would still pass here. The behaviour is
  // bound by the rotation probes, rotbump-inject.js and adv-userscroll.js, run for v1.341.3.)
  // The ?debugLifecycle=1 log: scroll lines near a rotation, and the faux keeper's plan.
  assert.match(src, /window\.addEventListener\('scroll', function \(\) \{ if \(Date\.now\(\) <= rotationSettleUntil\) logViewport\('scroll'\); \}/);
  assert.match(src, /recordLifecycleEvent\('fauxScroll'/);
});
