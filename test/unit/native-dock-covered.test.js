'use strict';

// [UNIT] v1.401.0 live dock picture, W4 (plan docs/exec-plans/active/2026-11-01-live-dock-picture.md, R4 + L4): covered = thumbnail.
// While the docked picture is native's layer ABOVE the web view, a web surface opening over the dock (a sheet, a menu, a dialog, a
// popover, a toast) would be painted UNDER the picture, so the web posts visible: false while any rendered surface overlaps the
// picture rect and visible: true the moment the dock is clear. The census of the families above the dock's z rung is DERIVED from
// the stylesheets (every position: fixed rule whose z-index resolves above --z-dock), each classified here; a family this file does not
// know fails the census. The detection is the browser's hit test; jsdom has none, so these tests install a geometry-based
// elementsFromPoint over fixture overlays (the headless probe, scripts/live-dock-probe.js, runs the real one). The REAL player.js +
// native-audio.js run through the real dock() / expand() / minimizeToDock path (test/helpers/live-dock-realm.js).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { realm, loaded, strip, settle, VIDEO_CAPS } = require('../helpers/live-dock-realm');

const REPO = path.join(__dirname, '..', '..');
const css = (f) => fs.readFileSync(path.join(REPO, 'public', 'css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// ---- the census: every fixed rule above the dock's rung, from the stylesheets ----------------------------------------------------

function tokens() {
  const t = css('tokens.css'); const out = {};
  for (const m of t.matchAll(/(--z-[\w-]+):\s*(\d+)\s*;/g)) if (!(m[1] in out)) out[m[1]] = +m[2];
  return out;
}
function resolveZ(v, tok) {
  v = v.trim();
  let m = /^var\((--z-[\w-]+)\)$/.exec(v); if (m) return tok[m[1]];
  m = /^calc\(\s*var\((--z-[\w-]+)\)\s*([+-])\s*(\d+)\s*\)$/.exec(v); if (m) return m[2] === '+' ? tok[m[1]] + +m[3] : tok[m[1]] - +m[3];
  m = /^(\d+)$/.exec(v); if (m) return +m[1];
  return null;
}
function fixedFamiliesAbove(z) {
  const tok = tokens(); const out = [];
  for (const file of ['style.css', 'ui.css']) {
    const text = css(file);
    const re = /([^{}]+)\{([^{}]*)\}/g; let m;
    while ((m = re.exec(text))) {
      const body = m[2];
      if (!/position\s*:\s*fixed\b/.test(body)) continue;
      const zm = /z-index\s*:\s*([^;]+);/.exec(body);
      const zv = zm ? resolveZ(zm[1], tok) : null;
      const selector = m[1].trim().split('\n').pop().trim();
      if (zv !== null && zv > z) out.push({ file, selector, z: zv });
      else if (zv === null) out.push({ file, selector, z: null, raw: zm ? zm[1].trim() : '(none)' }); // gate r1 adversary: never dropped silently
    }
  }
  return out.sort((a, b) => a.selector.localeCompare(b.selector));
}
// Every family above the dock (950), classified. A new fixed family above the dock must be added here WITH its disposition:
//   covers: a web surface that can open over a docked video; its reveal must trigger a scan (bound below, one test per family)
//   self:   the player's own wrapper in a mode the dock never holds (dock() exits both)
//   static: shell chrome at the top of the viewport; it never meets the bottom-right dock (measured by the headless probe) and a
//           static body child over the dock at dock time is still seen (bound below)
const FAMILIES = {
  'header': 'static',
  '#player-wrapper.css-fullscreen': 'self',
  '#player-wrapper.audio-mode.audio-expanded': 'self',
  '.speed-sheet-backdrop': 'covers',
  '.whcal-overlay': 'covers',
  ':where(html.is-phone, html.mms-popout) .mms-full': 'covers',
  '.ui-scrim': 'covers',
  '.ui-sheet': 'covers',
  '.ui-toast-host': 'covers',
};

// fixed rules with NO resolvable z-index: z auto paints in the root context's 0 layer, under the dock's 950 whatever the DOM order
// (a new one must be classified here too)
const UNRESOLVED = {
  ':where(html.is-phone, html.mms-popout) body.mms-tray .music-nowplaying-panel': '(none)',
  ':where(html.is-phone, html.mms-popout) .ipm-kb': '(none)',
};

test('R4 census: every position: fixed rule above --z-dock in style.css and ui.css is a known family with a disposition (a new one fails here until classified); a fixed rule with no resolvable z is listed too', () => {
  const tok = tokens();
  assert.strictEqual(tok['--z-dock'], 950, 'the dock rung');
  const all = fixedFamiliesAbove(tok['--z-dock']);
  const unresolved = all.filter((f) => f.z === null);
  assert.deepStrictEqual(Object.fromEntries(unresolved.map((f) => [f.selector, f.raw])), UNRESOLVED, 'every fixed rule whose z-index cannot be resolved is classified (z auto = under the dock)');
  for (const f of unresolved) assert.strictEqual(f.raw, '(none)', f.selector + ': no z-index at all (auto), never above the dock');
  const fams = all.filter((f) => f.z !== null);
  assert.ok(fams.length >= 9, 'the census sees the families: ' + fams.length);
  assert.deepStrictEqual(fams.map((f) => f.selector).sort(), Object.keys(FAMILIES).sort(), 'every family classified, nothing extra: ' + JSON.stringify(fams));
  // the toast HOST is pointer-events: none (the hit test skips it) and the toasts themselves are auto (the hit test finds them)
  const ui = css('ui.css');
  assert.match(ui, /\.ui-toast-host \{[^}]*pointer-events: none;/);
  assert.match(ui, /\n\.ui-toast \{[^}]*pointer-events: auto;/);
  // the scrim behind a menu / popover is clear: it must read as see-through (a childless transparent element)
  assert.match(ui, /\.ui-scrim--clear \{ background: transparent; \}/);
});

// ---- the hit test (jsdom has none): a geometry stack over fixture overlays ------------------------------------------------------

function hitTest(r) {
  const overlays = []; const hits = { n: 0 };
  const rectOf = (el) => el.getBoundingClientRect();
  const inside = (b, x, y) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  const rendered = (el) => el.isConnected && !el.hidden && r.w.getComputedStyle(el).display !== 'none' && !el.closest('[hidden]');
  const w = r.w;
  w.document.elementsFromPoint = (x, y) => {
    hits.n += 1;
    const stack = overlays.filter((o) => rendered(o.el) && o.el.style.pointerEvents !== 'none' && inside(rectOf(o.el), x, y)).sort((a, b) => b.z - a.z).map((o) => o.el);
    const media = r.el(); const dock = w.document.getElementById('player-dock');
    if (media && dock && dock.contains(media) && !dock.hidden && inside(rectOf(media), x, y)) stack.push(media, media.parentNode, dock);
    stack.push(w.document.body, w.document.documentElement);
    return stack;
  };
  // an overlay as the real code mounts it: a class, a parent, a viewport rect, a z and a background
  const overlay = (o) => {
    const el = w.document.createElement(o.tag || 'div');
    if (o.cls) el.className = o.cls;
    if (o.id) el.id = o.id;
    el.style.background = o.bg === undefined ? 'rgba(0, 0, 0, 0.4)' : o.bg;
    if (o.pointerEvents) el.style.pointerEvents = o.pointerEvents;
    if (o.text) el.textContent = o.text;
    const b = o.rect; el.getBoundingClientRect = () => ({ left: b.x, top: b.y, width: b.w, height: b.h, right: b.x + b.w, bottom: b.y + b.h, x: b.x, y: b.y });
    overlays.push({ el, z: o.z });
    (o.parent || w.document.body).appendChild(el);
    return el;
  };
  return { overlay, hits };
}
const OVER_DOCK = { x: 0, y: 500, w: 393, h: 344 }; // a bottom sheet / scrim band that meets the dock's picture (225..385 x 640..730)
const ASIDE = { x: 0, y: 100, w: 200, h: 120 }; // a popover near a header button: nowhere near the dock
const FULL = { x: 0, y: 0, w: 393, h: 844 };

async function dockedLive(r) {
  await loaded(r);
  r.player.dock(); await settle(80);
  assert.strictEqual(r.last().visible, true, 'docked live before the surface');
  assert.strictEqual(r.last().layer, 'above');
}

for (const [name, mount] of [
  ['.ui-sheet (a bottom sheet / dialog / menu with its dim scrim, appended to body; removed at finish())', (h, r) => { const scrim = h.overlay({ cls: 'ui-scrim', rect: FULL, z: 1500 }); const s = h.overlay({ cls: 'ui-sheet ui-sheet--bottom', rect: OVER_DOCK, z: 1501, text: 'Move to folder' }); return () => { scrim.remove(); s.remove(); }; }],
  ['.speed-sheet-backdrop (the mobile speed picker, appended to body)', (h) => { const b = h.overlay({ cls: 'speed-sheet-backdrop', rect: FULL, z: 2000, text: '1x 1.5x 2x' }); return () => b.remove(); }],
  ['.whcal-overlay (the wheel calibration, appended to body)', (h) => { const b = h.overlay({ cls: 'whcal-overlay', rect: FULL, z: 2200, bg: 'rgb(20, 20, 20)', text: 'Calibrate' }); return () => b.remove(); }],
  ['.ui-toast-host + .ui-toast (the host is pointer-events none and stays; the toast is appended into it over the bottom of the page)', (h, r) => { const host = h.overlay({ cls: 'ui-toast-host', rect: { x: 0, y: 700, w: 393, h: 60 }, z: 2200, bg: 'transparent', pointerEvents: 'none' }); const t = h.overlay({ cls: 'ui-toast ui-toast--neutral', parent: host, rect: { x: 40, y: 700, w: 313, h: 44 }, z: 2200, bg: 'rgb(30, 30, 30)', text: 'Added to the queue.' }); return () => t.remove(); }],
  ['.mms-full (the Pocket cover: a panel deep inside #view-root, toggled by its hidden attribute)', (h, r) => { const view = r.w.document.getElementById('view-root'); const wrap = r.w.document.createElement('div'); wrap.className = 'music-view'; view.appendChild(wrap); const p = h.overlay({ cls: 'music-nowplaying-panel mms mms-full', parent: wrap, rect: FULL, z: 1100, bg: 'rgb(10, 10, 10)', text: 'Now playing' }); p.hidden = true; return { show: () => { p.hidden = false; }, hide: () => { p.hidden = true; } }; }],
]) {
  test('R4: ' + name + ' -> visible false while it overlaps the picture (the poster shows, the class stays), visible true once it is gone; exactly two posts', async () => {
    const r = realm();
    try {
      const h = hitTest(r);
      await dockedLive(r);
      const n0 = r.surfaces().length;
      const ctl = mount(h, r);
      if (ctl && ctl.show) ctl.show();
      await settle(60);
      assert.strictEqual(r.surfaces().length, n0 + 1, 'one post for the cover');
      assert.deepStrictEqual(strip(r.last()), { rect: { x: 225, y: 640, w: 160, h: 90 }, space: 'viewport', visible: false, fit: 'contain', radius: 7, layer: 'above' }, 'the layer hides where it is');
      assert.strictEqual(r.na.dockCovered(), true);
      assert.strictEqual(r.poster(), '/thumbnail/v1', 'the thumbnail is on the element under the hidden layer');
      assert.strictEqual(r.w.document.documentElement.classList.contains('ft-native-dock'), true, 'the bar layout stays (nothing jumps while covered)');
      if (ctl && ctl.hide) ctl.hide(); else ctl();
      await settle(60);
      assert.strictEqual(r.surfaces().length, n0 + 2, 'one post for the clear');
      assert.strictEqual(r.last().visible, true, 'the picture is back the moment the dock is clear');
      assert.strictEqual(r.na.dockCovered(), false);
    } finally { r.close(); }
  });
}

test('R4: a menu / popover far from the dock behind its CLEAR scrim does not cover it (see-through); the same popover over the dock does', async () => {
  const r = realm();
  try {
    const h = hitTest(r);
    await dockedLive(r);
    const n0 = r.surfaces().length;
    const scrim = h.overlay({ cls: 'ui-scrim ui-scrim--clear', rect: FULL, z: 1500, bg: 'transparent' });
    const menu = h.overlay({ cls: 'ui-sheet ui-sheet--popover', rect: ASIDE, z: 1501, text: 'Select  Add to queue' });
    await settle(60);
    assert.strictEqual(r.surfaces().length, n0, 'nothing posted: a clear scrim hides nothing and the menu is elsewhere');
    assert.strictEqual(r.na.dockCovered(), false);
    menu.getBoundingClientRect = () => ({ left: 200, top: 600, width: 180, height: 200, right: 380, bottom: 800, x: 200, y: 600 });
    menu.classList.add('is-open'); // the class change is the signal; the geometry moved with it
    await settle(60);
    assert.strictEqual(r.last().visible, false, 'the popover over the dock covers it');
    scrim.remove(); menu.remove(); await settle(60);
    assert.strictEqual(r.last().visible, true);
    assert.strictEqual(r.surfaces().length, n0 + 2);
  } finally { r.close(); }
});

test('R4: a static body child already over the dock when it docks is seen on the first docked measure; one that never meets the picture is not', async () => {
  const r = realm();
  try {
    const h = hitTest(r);
    await loaded(r);
    const hdr = h.overlay({ tag: 'header', rect: { x: 0, y: 0, w: 393, h: 56 }, z: 1000, bg: 'rgb(255, 255, 255)', text: 'FileTube' });
    const band = h.overlay({ cls: 'some-fixed-band', rect: { x: 0, y: 600, w: 393, h: 100 }, z: 1600, text: 'A panel' });
    await settle(40);
    r.player.dock();
    assert.strictEqual(r.last().visible, false, 'docked under the band: hidden at once');
    band.remove(); await settle(60);
    assert.strictEqual(r.last().visible, true, 'the header at the top never meets the dock');
    hdr.remove();
  } finally { r.close(); }
});

test('R4 idle census: docked above, and docked covered, an idle second costs nothing - 0 posts, at most the backstop\'s 2 box reads, 0 hit tests, 0 attribute records on body / html / the hole', async () => {
  const r = realm();
  try {
    const h = hitTest(r);
    await dockedLive(r);
    const records = [];
    const mo = new r.w.MutationObserver((list) => { for (const m of list) records.push((m.target.id || m.target.nodeName) + ':' + m.attributeName); });
    mo.observe(r.w.document.body, { attributes: true }); mo.observe(r.w.document.documentElement, { attributes: true }); if (r.hole()) mo.observe(r.hole(), { attributes: true });
    await settle(100);
    records.length = 0; r.reads.n = 0; h.hits.n = 0; const n0 = r.surfaces().length;
    await settle(1000);
    assert.strictEqual(r.surfaces().length, n0, 'docked above idle: no posts');
    assert.ok(r.reads.n <= 2, 'docked above idle: box reads = ' + r.reads.n);
    assert.strictEqual(h.hits.n, 0, 'docked above idle: no hit tests');
    assert.deepStrictEqual(records, [], 'docked above idle: no attribute writes');
    const scrim = h.overlay({ cls: 'ui-scrim', rect: FULL, z: 1500 }); const s = h.overlay({ cls: 'ui-sheet', rect: OVER_DOCK, z: 1501, text: 'x' });
    await settle(100);
    assert.strictEqual(r.last().visible, false);
    records.length = 0; r.reads.n = 0; h.hits.n = 0; const n1 = r.surfaces().length;
    await settle(1000);
    assert.strictEqual(r.surfaces().length, n1, 'covered idle: no posts');
    assert.ok(r.reads.n <= 2, 'covered idle: box reads = ' + r.reads.n);
    assert.strictEqual(h.hits.n, 0, 'covered idle: no hit tests');
    assert.deepStrictEqual(records, [], 'covered idle: no attribute writes');
    scrim.remove(); s.remove();
  } finally { r.close(); }
});

test('R4 (gate r1 adversary C1): the fly-in is judged where the picture LANDS - a static band over the slot (where the FLIP starts) never hides the flying picture; a band over the dock\'s rest box does', async () => {
  const r = realm();
  try {
    const h = hitTest(r);
    await loaded(r);
    const band = h.overlay({ cls: 'some-header', rect: { x: 0, y: 280, w: 393, h: 60 }, z: 1000, bg: 'rgb(255, 255, 255)', text: 'FileTube' }); // meets the slot box (300..521), not the dock (640..774)
    await settle(60);
    r.wrapper().querySelector('.player-minimize').click();
    assert.strictEqual(r.player.getState(), 'docked');
    assert.strictEqual(r.last().visible, true, 'the first fly-in post is visible: the band over the FLIP start does not count');
    assert.strictEqual(r.na.dockCovered(), false);
    r.wrapper().style.transform = 'translate(-100px, 100px) scale(0.6)'; await settle(40);
    assert.strictEqual(r.last().visible, true, 'still visible mid-flight');
    await settle(400);
    assert.strictEqual(r.last().visible, true, 'and at rest');
    band.remove();
    r.player.expand(r.slot); await settle(80);
    const over = h.overlay({ cls: 'some-panel', rect: { x: 0, y: 630, w: 393, h: 200 }, z: 1600, text: 'A panel over the dock' }); // meets the dock\'s rest box, not the slot
    await settle(60);
    r.wrapper().querySelector('.player-minimize').click();
    assert.strictEqual(r.last().visible, false, 'judged at the destination: hidden from the first fly-in frame');
    assert.strictEqual(r.poster(), '/thumbnail/v1', 'the thumbnail flies');
    over.remove();
  } finally { r.close(); }
});

test('R4: covered mid-fly-in - a toast lands while the picture flies: the layer hides and the thumbnail flies instead (never a black box)', async () => {
  const r = realm();
  try {
    const h = hitTest(r);
    await loaded(r);
    r.wrapper().querySelector('.player-minimize').click();
    assert.strictEqual(r.player.getState(), 'docked');
    assert.strictEqual(r.poster(), null, 'the live picture flies');
    const host = h.overlay({ cls: 'ui-toast-host', rect: { x: 0, y: 0, w: 393, h: 844 }, z: 2200, bg: 'transparent', pointerEvents: 'none' });
    h.overlay({ cls: 'ui-toast', parent: host, rect: { x: 0, y: 0, w: 393, h: 844 }, z: 2200, bg: 'rgb(30, 30, 30)', text: 'Saved' });
    r.wrapper().style.transform = 'translate(-100px, 100px) scale(0.6)'; await settle(40); // the box at 125,740 96x54: inside the toast
    assert.strictEqual(r.last().visible, false, 'hidden mid-flight');
    assert.strictEqual(r.poster(), '/thumbnail/v1', 'the thumbnail is on the flying box');
  } finally { r.close(); }
});

test('R4 + R5: rotation while covered re-measures the rect and re-scans (still hidden); clearing it then shows the picture at the new rect; expand while covered opens the hole first and posts below next frame', async () => {
  const r = realm();
  try {
    const h = hitTest(r);
    await dockedLive(r);
    const WIDE = { x: 0, y: 0, w: 1000, h: 1000 }; // covers the dock in both orientations
    const scrim = h.overlay({ cls: 'ui-scrim', rect: WIDE, z: 1500 }); const s = h.overlay({ cls: 'ui-sheet', rect: WIDE, z: 1501, text: 'x' });
    await settle(60);
    assert.strictEqual(r.last().visible, false);
    const { DOCK_BOX } = require('../helpers/live-dock-realm');
    DOCK_BOX.left = 600; DOCK_BOX.top = 240;
    h.hits.n = 0;
    r.w.dispatchEvent(new r.w.Event('orientationchange')); r.w.dispatchEvent(new r.w.Event('resize'));
    await settle(60);
    DOCK_BOX.left = 225; DOCK_BOX.top = 640;
    assert.deepStrictEqual(r.last().rect, { x: 600, y: 240, w: 160, h: 90 });
    assert.strictEqual(r.last().visible, false, 'the sheet still covers the moved dock');
    assert.ok(h.hits.n > 0, 'the rotation re-scanned');
    // expand while covered
    const n0 = r.surfaces().length;
    r.player.expand(r.slot);
    assert.strictEqual(r.surfaces().length, n0, 'nothing posted on the expand tick');
    assert.strictEqual(r.bodyOn(), true, 'the hole opened first');
    assert.strictEqual(r.w.document.documentElement.classList.contains('ft-native-dock'), false);
    await settle(40);
    assert.strictEqual(r.last().layer, 'below'); assert.strictEqual(r.last().visible, true);
    assert.strictEqual(r.na.dockCovered(), false, 'covered is a docked state only');
    scrim.remove(); s.remove(); await settle(60);
    assert.strictEqual(r.surfaces().length, n0 + 1, 'the sheet leaving while in the slot posts nothing');
  } finally { r.close(); }
});

test('R4 CONTROL: without nativeVideoDock a sheet over the thumbnail dock changes nothing (no post, no scan)', async () => {
  const r = realm({ caps: VIDEO_CAPS });
  try {
    const h = hitTest(r);
    await loaded(r);
    r.player.dock(); await settle(60);
    assert.strictEqual(r.last().visible, false);
    const n0 = r.surfaces().length; h.hits.n = 0;
    const scrim = h.overlay({ cls: 'ui-scrim', rect: FULL, z: 1500 }); const s = h.overlay({ cls: 'ui-sheet', rect: OVER_DOCK, z: 1501, text: 'x' });
    await settle(80);
    scrim.remove(); s.remove(); await settle(80);
    assert.strictEqual(r.surfaces().length, n0, 'no post');
    assert.strictEqual(h.hits.n, 0, 'no hit test without the capability');
  } finally { r.close(); }
});

// ---- gate prep: the two mutants the first round left standing (a survivor on correct code is a WARNING, LESSONS 2) ---------------

// NOTE (gate r1 adversary M16): the `!coverScanned` term is a belt - every signal since the close (the new load's own reparent) dirties
// the flag and nothing consumes it off the dock, so the scan is reachable through the flag alone; this test binds the OUTCOME
test('R4: a sheet left open across close() and a new load is seen on the next dock first measure (the load own signals carry over to the dock)', async () => {
  const r = realm();
  try {
    const h = hitTest(r);
    await dockedLive(r);
    const scrim = h.overlay({ cls: 'ui-scrim', rect: FULL, z: 1500 }); const s = h.overlay({ cls: 'ui-sheet', rect: OVER_DOCK, z: 1501, text: 'x' });
    await settle(60);
    assert.strictEqual(r.last().visible, false);
    r.player.close(); // surfaceOff: every cover state reset, the sheet stays up
    await settle(60);
    const { VIDEO } = require('../helpers/live-dock-realm');
    r.player.load('v2', Object.assign({}, VIDEO, { id: 'v2' }), { slot: r.slot }); await settle(80);
    const loads = r.fake.of('audio.load'); r.fake.emit(Object.assign(require('../helpers/live-dock-realm').STATE(loads[loads.length - 1].rev), { queue: [Object.assign({}, require('../helpers/live-dock-realm').ITEM, { id: 'v2', src: '/api/offline/file/video/v2', artworkSrc: '/thumbnail/v2' })] })); await settle(60);
    assert.strictEqual(r.last().visible, true, 'in the slot: shown');
    h.hits.n = 0;
    r.player.dock();
    assert.ok(h.hits.n > 0, 'the first docked measure scanned without any new DOM signal');
    assert.strictEqual(r.last().visible, false, 'docked under the sheet that never left');
    scrim.remove(); s.remove(); await settle(60);
    assert.strictEqual(r.last().visible, true);
  } finally { r.close(); }
});

test('R4: a cover revealed by a BODY CLASS alone (a takeover keyed in CSS, no node added, no hidden toggled) is seen: the surface sampler own body signal wakes the scan', async () => {
  const r = realm();
  try {
    const h = hitTest(r);
    const st = r.w.document.createElement('style'); st.textContent = '.pk-cover { display: none; } body.pk-on .pk-cover { display: block; }'; r.w.document.head.appendChild(st);
    const cover = h.overlay({ cls: 'pk-cover', rect: FULL, z: 1100, bg: 'rgb(10, 10, 10)', text: 'Pocket' });
    await dockedLive(r);
    assert.strictEqual(r.na.dockCovered(), false, 'display none: not rendered, not covering');
    const n0 = r.surfaces().length;
    r.w.document.body.classList.add('pk-on'); // the ONE mutation
    await settle(60);
    assert.strictEqual(r.surfaces().length, n0 + 1);
    assert.strictEqual(r.last().visible, false, 'revealed by the class: covered');
    r.w.document.body.classList.remove('pk-on'); await settle(60);
    assert.strictEqual(r.last().visible, true);
    cover.remove();
  } finally { r.close(); }
});
