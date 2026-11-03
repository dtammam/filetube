'use strict';

// [UNIT] v1.402.0 page turn (plan 2026-11-03-book-page-turn). The pure parts of public/js/page-turn.js with the
// approved prototype's values as fixtures (docs/references/page-turn-prototype.html), the engine's wiring in
// jsdom with a fake page source, and read.js's P9 chapter guard. The real-browser half (the seven release cases
// in Chromium AND WebKit, landing, place, reduced motion, frame time) is scripts/page-turn-probe.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const pt = require('../../public/js/page-turn.js');
const read = require('../../public/js/read.js');

// ---- layout (P3: two pages when wider than tall by the prototype's Auto rule and at least 640 px wide)

test('ptLayout: a phone in portrait is strictly one full-bleed page', () => {
  const g = pt.ptLayout(390, 700, null);
  assert.deepStrictEqual([g.spread, g.W, g.H, g.bookW, g.bookX, g.bookY], [false, 390, 700, 390, 0, 0]);
});

test('ptLayout: sideways is two pages (phone landscape, desktop); just under 640 px wide or not wide enough stays one', () => {
  const phone = pt.ptLayout(844, 390, null);
  assert.strictEqual(phone.spread, true, 'a phone on its side opens two pages');
  assert.strictEqual(phone.bookW, 2 * phone.W);
  assert.strictEqual(phone.H, 390 - 20, 'a phone spread keeps a 10 px desk margin');
  assert.strictEqual(pt.ptLayout(1100, 760, null).spread, true);
  assert.strictEqual(pt.ptLayout(639, 400, null).spread, false, 'under 640 px wide: one page');
  assert.strictEqual(pt.ptLayout(640, 400, null).spread, true, 'exactly 640 px and wide: two pages');
  assert.strictEqual(pt.ptLayout(700, 650, null).spread, false, 'wider than tall but not by 1.15: one page');
  assert.strictEqual(pt.ptLayout(760, 1100, null).spread, false, 'a tablet in portrait: one page');
});

test('ptLayout: a PDF keeps its page shape (fit inside the area, centred)', () => {
  const g = pt.ptLayout(1100, 760, 612 / 792);
  assert.strictEqual(g.spread, true);
  assert.ok(Math.abs(g.W / g.H - 612 / 792) < 0.01, 'the page ratio is kept');
  assert.ok(g.H <= 760 - 60 && 2 * g.W <= 1100 - 60, 'inside the 30 px desk margin');
  assert.strictEqual(g.bookX, Math.round((1100 - g.bookW) / 2));
});

test('ptRigOffsets: which pages each rig holds and where a turn lands (prototype createRig point())', () => {
  assert.deepStrictEqual(pt.ptRigOffsets(false, 1), { other: null, front: 0, back: 0, under: 1, step: 1, need: 'under', baseRole: 'front', landRole: 'under' });
  assert.deepStrictEqual(pt.ptRigOffsets(false, -1), { other: null, front: -1, back: -1, under: 0, step: -1, need: 'front', baseRole: 'under', landRole: 'front' });
  assert.deepStrictEqual(pt.ptRigOffsets(true, 1), { other: 0, front: 1, back: 2, under: 3, step: 2, need: 'back', baseRole: 'other', landRole: 'back' });
  assert.deepStrictEqual(pt.ptRigOffsets(true, -1), { other: 1, front: 0, back: -1, under: -2, step: -2, need: 'back', baseRole: 'front', landRole: 'under' });
});

// ---- the fold

const G = { W: 390, H: 700, B: Math.ceil(3 * 700) };
const FWD = { startTurned: false, cy: 700, spineX: 0, s: 1, slotX: 0 };

test('ptFold: at rest nothing is folded and no shade shows (the resting frame)', () => {
  const f = pt.ptFold(FWD, G, 0, 0, 1);
  assert.strictEqual(f.rest, true);
  assert.strictEqual(f.mask, 'matrix(1.00000,0.00000,0.00000,1.00000,-700.00,-700.00)');
  assert.strictEqual(f.innerFront, 'matrix(1.00000,0.00000,0.00000,1.00000,700.00,700.00)', 'the front page does not move: the mask and its inverse cancel');
  // The one-page back rig starts turned over: at p = 0 its leaf lies flat on the far side.
  const back = pt.ptFold({ ...FWD, startTurned: true }, G, 1, 0, 1);
  assert.strictEqual(back.rest, true, 'a back turn that lands is at rest again');
});

test('ptFold: once the page lies flat every shade is zero, so the landed frame equals the resting frame', () => {
  for (const shade of [1, 1.05, 1.9]) {
    const flat = pt.ptFold(FWD, G, 1, 0, shade);
    assert.strictEqual(flat.rest, false, 'p = 1 is fully turned (the leaf sits past the spine)');
    assert.strictEqual(flat.underOpacity, 0);
    assert.strictEqual(flat.backOpacity, 0);
    assert.ok(flat.liftOpacity < 1e-9, `the lift shadow is gone (${flat.liftOpacity})`);
  }
  const mid = pt.ptFold(FWD, G, 0.5, 0, 1);
  assert.ok(mid.underOpacity > 0.3 && mid.backOpacity > 0.3 && mid.liftOpacity > 0.5, 'mid-turn the shades show');
});

test('ptFold: the fold is the perpendicular bisector of the corner and where it went (the part past it is mirrored)', () => {
  const p = 0.3;
  const f = pt.ptFold(FWD, G, p, 0, 1);
  // The corner C = (W, H) goes to P = (W - 2Wa, H - 0.075 H sin(pi a)) (lift 1, bottom corner lifts up).
  const a = p;
  const P = [G.W - 2 * G.W * a, G.H - 0.075 * G.H * Math.sin(Math.PI * a)];
  const C = [G.W, G.H];
  assert.ok(Math.abs(f.fold.M[0] - (C[0] + P[0]) / 2) < 1e-6 && Math.abs(f.fold.M[1] - (C[1] + P[1]) / 2) < 1e-6, 'the fold passes through the midpoint');
  const d = [C[0] - P[0], C[1] - P[1]];
  const len = Math.hypot(d[0], d[1]);
  assert.ok(Math.abs(f.fold.n[0] - d[0] / len) < 1e-9 && Math.abs(f.fold.n[1] - d[1] / len) < 1e-9, 'its normal points from P to C');
});

test('ptFold: the corner never tears the sheet (held within one page width of the spine)', () => {
  // A drag far below the page pulls the corner down; the clamp keeps P within W of the spine corner.
  const f = pt.ptFold(FWD, G, 0.5, 5000, 1);
  const P = [2 * f.fold.M[0] - G.W, 2 * f.fold.M[1] - G.H];
  assert.ok(Math.hypot(P[0], P[1] - G.H) <= G.W + 1e-6, 'within one page width of the spine at the corner height');
});

// ---- the release (the prototype's seven cases, as numbers)

// A slow drag to `travel` page widths that then rests (> 80 ms still before lifting): no speed.
function slow(travel) {
  const samples = [];
  for (let i = 0; i <= 10; i++) samples.push([i * 40, (travel / 2) * (i / 10)]);
  return { p: travel / 2, v: pt.ptReleaseVelocity(samples, 400 + 120) };
}
test('release: slow drags to 8% and 25% fall back; 32% and 45% turn (turn after 30%)', () => {
  for (const [travel, turns] of [[0.08, false], [0.25, false], [0.32, true], [0.45, true]]) {
    const r = slow(travel);
    assert.strictEqual(r.v, 0, `a finger at rest has no speed (${travel})`);
    assert.strictEqual(pt.ptShouldTurn(r.p, r.v), turns, `slow ${travel * 100}%`);
  }
});

test('release: a 12% flick turns (speed over the last 70 ms, lifted while moving)', () => {
  const samples = [[0, 0], [16, 0.015], [32, 0.03], [48, 0.045], [64, 0.06]];
  const v = pt.ptReleaseVelocity(samples, 70);
  assert.ok(v * 2 > 1.2, `a flick (${(v * 2).toFixed(2)} page widths/s)`);
  assert.strictEqual(pt.ptShouldTurn(0.06, v), true);
  assert.strictEqual(pt.ptShouldTurn(0.06, 0), false, 'the same 12% released at rest falls back');
});

test('release: pulling back from 32% and from 45% falls back (a pull back never turns)', () => {
  // dragged out to 32% / 45%, then moved back fast enough in the last 70 ms; still past 30% when lifted
  for (const from of [0.32, 0.45]) {
    const back = 0.016; // progress moved back over the last 64 ms: 0.5 page widths/s the wrong way
    const end = from / 2 - back;
    const samples = [[0, from / 2], [16, from / 2 - back / 4], [32, from / 2 - back / 2], [48, from / 2 - (3 * back) / 4], [64, end]];
    const v = pt.ptReleaseVelocity(samples, 66);
    assert.ok(v * 2 < -0.4, `moving back faster than the pull-back line (${(v * 2).toFixed(3)} page widths/s)`);
    if (from === 0.45) assert.ok(end * 2 >= 0.3, 'still past the 30% mark when lifted: only the pull back keeps it from turning');
    assert.strictEqual(pt.ptShouldTurn(end, v), false, `pull back from ${from * 100}%`);
  }
});

test('release: the speed window is 70 ms and a still finger has none (prototype constants)', () => {
  assert.strictEqual(pt.ptReleaseVelocity([[0, 0], [10, 0.1]], 10 + 80), 0, '80 ms still: no speed');
  assert.ok(pt.ptReleaseVelocity([[0, 0], [10, 0.1]], 10 + 79) > 0, '79 ms: still moving');
  // Only samples inside the last 70 ms count: an old fast start is forgotten.
  const v = pt.ptReleaseVelocity([[0, 0], [10, 0.3], [100, 0.3], [140, 0.31]], 141);
  assert.ok(Math.abs(v - 0.25) < 1e-9, `speed from the window only (${v})`);
});

// ---- the settle

test('spring: a tap starts from rest at 2.4/s and settles on the page without overshoot (critically damped)', () => {
  const w = pt.ptOmega();
  assert.strictEqual(w, 17, 'omega = 17 x speed 100% / paper Book duration 1');
  let x = 0; let v = pt.PT_AUTO_V0; let frames = 0; let max = 0;
  while (!pt.ptSettled(x, v, 1) && frames < 600) { [x, v] = pt.ptSpringStep(x, v, 1, 1 / 60, w); max = Math.max(max, x); frames++; }
  assert.ok(frames > 10 && frames < 60, `settles in well under a second at 60 fps (${frames} frames)`);
  assert.ok(max <= 1, 'never past the page');
  const [x2, v2] = pt.ptSpringStep(0.999, 50, 1, 0.05, w);
  assert.strictEqual(x2, 1, 'clamped at the end');
  assert.ok(v2 <= 0);
});

test('recognise: 6 px of mostly-horizontal movement is a drag; vertical is not; a wander is no tap', () => {
  assert.deepStrictEqual(pt.ptRecognize(5, 0), { kind: 'wait', noTap: false });
  assert.deepStrictEqual(pt.ptRecognize(-6, 0), { kind: 'turn', dir: 1 }, 'leftward = forward');
  assert.deepStrictEqual(pt.ptRecognize(6, 2), { kind: 'turn', dir: -1 }, 'rightward = back');
  assert.strictEqual(pt.ptRecognize(8, 20).kind, 'wait', 'mostly vertical never turns');
  assert.strictEqual(pt.ptRecognize(3, 15).noTap, true, 'wandered more than 14 px: no tap');
});

test('stacks: up to 7 edges, read on the left, the rest on the right', () => {
  assert.deepStrictEqual(pt.ptStackCounts(0, true), { left: 0, right: 7 });
  assert.deepStrictEqual(pt.ptStackCounts(0.5, true), { left: 4, right: 4 });
  assert.deepStrictEqual(pt.ptStackCounts(1, true), { left: 7, right: 0 });
  assert.deepStrictEqual(pt.ptStackCounts(0.5, false), { left: 0, right: 4 }, 'one page: no left stack');
});

// ---- the engine in jsdom, with a fake source

function mountEngine({ width = 390, height = 700, reduced = true, present = () => true } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="host"></div></body>', { pretendToBeVisual: true });
  const win = dom.window;
  const host = win.document.getElementById('host');
  Object.defineProperty(host, 'clientWidth', { value: width });
  Object.defineProperty(host, 'clientHeight', { value: height });
  const shows = [];
  const places = [];
  const source = {
    fixedAspect: null,
    createViewer() {
      const el = win.document.createElement('div');
      const v = { el, at: null };
      v.show = async (gen, idx, anchor) => { shows.push([gen, idx, anchor]); v.at = idx; };
      v.present = () => present(v.at);
      v.destroy = () => {};
      return v;
    },
  };
  // createPageTurn reads requestAnimationFrame / performance from the host's window
  const engine = pt.createPageTurn({ host, source, reducedMotion: () => reduced, onPlace: (v) => places.push(v.at), fraction: () => 0 });
  return { dom, win, host, engine, shows, places };
}
const frames = (n = 8) => new Promise((r) => setTimeout(r, n * 20));

test('engine: one page builds 6 viewers, two pages 8; a jump parks every viewer on its neighbour and reports the place once', async () => {
  const one = mountEngine();
  assert.strictEqual(one.engine.viewers().length, 6);
  one.engine.jump('cfi-A');
  await frames();
  assert.deepStrictEqual(one.places, [0], 'the place is reported once, from the base page');
  assert.strictEqual(one.host.dataset.ptPlace, '1:0');
  assert.deepStrictEqual([...new Set(one.shows.map((s) => s[1]))].sort(), [-1, 0, 1], 'one-page rigs hold b - 1, b, b + 1');
  assert.ok(one.shows.every((s) => s[2] === 'cfi-A' && s[0] === 1), 'all from the jump anchor, generation 1');
  one.engine.destroy(); one.dom.window.close();
  const two = mountEngine({ width: 1100, height: 760 });
  assert.strictEqual(two.engine.viewers().length, 8);
  two.engine.destroy(); two.dom.window.close();
});

test('engine: turns land on the next / previous page; a turn never starts past the end', async () => {
  const m = mountEngine({ present: (idx) => idx <= 2 });
  m.engine.jump(0);
  await frames();
  m.engine.next(); await frames();
  m.engine.next(); await frames();
  assert.deepStrictEqual(m.places, [0, 1, 2]);
  m.engine.next(); await frames();
  assert.deepStrictEqual(m.places, [0, 1, 2], 'no page 3: the turn does not start');
  m.engine.prev(); await frames();
  assert.deepStrictEqual(m.places, [0, 1, 2, 1]);
  m.engine.destroy(); m.dom.window.close();
});

test('engine: a tap while the rig repaints waits for it (quick taps chain, nothing is dropped)', async () => {
  const m = mountEngine();
  m.engine.jump(0);
  await frames();
  m.engine.next();
  m.engine.next(); // the landed rig is not ready yet: this one waits for the re-point
  await frames(16);
  assert.deepStrictEqual(m.places, [0, 1, 2]);
  m.engine.destroy(); m.dom.window.close();
});

test('engine: a sideways drag released before its rig has repainted still turns once it is ready (a quick second flick)', async () => {
  const m = mountEngine();
  m.engine.jump(0);
  await frames();
  m.engine.next(); // lands at once (reduced motion); the forward rig now repaints its neighbours
  const ev = (type, x, t) => new m.win.PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: 600, bubbles: true, timeStamp: t });
  m.host.dispatchEvent(ev('pointerdown', 300));
  m.host.dispatchEvent(ev('pointermove', 280));
  m.host.dispatchEvent(ev('pointermove', 150)); // 150 px of 390: 38% travel, past the 30% mark
  m.host.dispatchEvent(ev('pointerup', 150));
  assert.deepStrictEqual(m.places, [0, 1], 'precondition: the drag ended before its rig was ready (no turn yet)');
  await frames(16);
  assert.deepStrictEqual(m.places, [0, 1, 2], 'the released drag turned the page once the rig was ready');
  m.engine.destroy(); m.dom.window.close();
});

test('engine: a short drag released before its rig is ready falls back (nothing queued)', async () => {
  const m = mountEngine();
  m.engine.jump(0);
  await frames();
  m.engine.next();
  const ev = (type, x) => new m.win.PointerEvent(type, { pointerId: 8, pointerType: 'touch', isPrimary: true, clientX: x, clientY: 600, bubbles: true });
  m.host.dispatchEvent(ev('pointerdown', 300));
  m.host.dispatchEvent(ev('pointermove', 280));
  m.host.dispatchEvent(ev('pointermove', 270)); // 8% travel, slow: stays
  await new Promise((r) => setTimeout(r, 120)); // the finger rests before lifting
  m.host.dispatchEvent(ev('pointerup', 270));
  await frames(16);
  assert.deepStrictEqual(m.places, [0, 1]);
  m.engine.destroy(); m.dom.window.close();
});

test('engine: isCurrent names ONLY the viewer showing the base page on the top rig (P8)', async () => {
  const m = mountEngine();
  m.engine.jump(0);
  await frames();
  const all = m.engine.viewers();
  const current = all.filter((v) => m.engine.isCurrent(v));
  assert.strictEqual(current.length, 1, 'exactly one viewer is current');
  assert.strictEqual(current[0].at, 0, 'and it holds the base page');
  m.engine.next(); await frames();
  const after = all.filter((v) => m.engine.isCurrent(v));
  assert.strictEqual(after.length, 1);
  assert.strictEqual(after[0].at, 1);
  m.engine.destroy(); m.dom.window.close();
});

// ---- read.js P9: the chapter guard

const XHTML = 'http://www.w3.org/1999/xhtml';
function xml(src) { return new JSDOM(src, { contentType: 'application/xhtml+xml' }).window.document; }

test('P9 hardenChapterDocument: the policy is the FIRST element of <head>; scripts, on* handlers and refresh are gone', () => {
  const doc = xml(`<?xml version="1.0"?><html xmlns="${XHTML}" xmlns:svg="http://www.w3.org/2000/svg"><head><script>parent.x=1</script><title>t</title><meta http-equiv="Refresh" content="0;url=javascript:alert(1)"/></head>`
    + '<body onload="parent.y=1"><p onclick="parent.z=1" class="k">Hi</p><img src="a.png" onerror="parent.w=1" ONMOUSEOVER="x()"/><script>parent.v=1</script>'
    + '<svg:svg><svg:script>parent.u=1</svg:script><svg:a onclick="q()"/></svg:svg></body></html>');
  assert.strictEqual(read.hardenChapterDocument(doc), true);
  const head = doc.getElementsByTagNameNS(XHTML, 'head')[0];
  const first = head.firstElementChild;
  assert.strictEqual(first.localName, 'meta');
  assert.strictEqual(first.getAttribute('http-equiv'), 'Content-Security-Policy');
  assert.strictEqual(first.getAttribute('content'), read.READER_CHAPTER_CSP);
  assert.match(read.READER_CHAPTER_CSP, /(^|; )script-src 'none'(;|$)/);
  assert.match(read.READER_CHAPTER_CSP, /object-src 'none'/);
  assert.match(read.READER_CHAPTER_CSP, /frame-src 'none'/);
  assert.strictEqual(doc.getElementsByTagNameNS('*', 'script').length, 0, 'every script, SVG too');
  const handlers = [];
  for (const el of Array.from(doc.getElementsByTagNameNS('*', '*'))) for (const a of Array.from(el.attributes)) if (/^on/i.test(a.localName)) handlers.push(a.localName);
  assert.deepStrictEqual(handlers, [], 'no inline handler survives (any case)');
  assert.strictEqual(Array.from(doc.getElementsByTagNameNS('*', 'meta')).filter((m) => /refresh/i.test(m.getAttribute('http-equiv') || '')).length, 0);
  assert.strictEqual(doc.querySelector('p').getAttribute('class'), 'k', 'everything else is kept');
  const serialized = new doc.defaultView.XMLSerializer().serializeToString(doc);
  assert.ok(serialized.indexOf('Content-Security-Policy') < serialized.indexOf('<title'), 'the policy precedes every other head element in what epub.js serializes');
});

test('P9 hardenChapterDocument: a chapter with no <head> gets one, first, carrying the policy', () => {
  const doc = xml(`<?xml version="1.0"?><html xmlns="${XHTML}"><body><p>x</p></body></html>`);
  read.hardenChapterDocument(doc);
  const root = doc.documentElement;
  assert.strictEqual(root.firstElementChild.localName, 'head');
  assert.strictEqual(root.firstElementChild.firstElementChild.getAttribute('content'), read.READER_CHAPTER_CSP);
  assert.strictEqual(read.hardenChapterDocument(null), false);
});

test('in-book links: epub.js\'s "../ch2.xhtml#n" resolves to the spine item (fragment kept); anything else stays put', () => {
  const spine = ['ch0.xhtml', 'ch1.xhtml', 'text/ch2.xhtml'];
  assert.deepStrictEqual(read.resolveBookLink('../ch1.xhtml', spine), { target: 'ch1.xhtml', spine: 1 });
  assert.deepStrictEqual(read.resolveBookLink('../text/ch2.xhtml#note-3', spine), { target: 'text/ch2.xhtml#note-3', spine: 2 });
  assert.deepStrictEqual(read.resolveBookLink('ch2.xhtml', spine), { target: 'text/ch2.xhtml', spine: 2 }, 'a bare file name matches on a directory boundary');
  assert.strictEqual(read.resolveBookLink('xch1.xhtml', spine), null, 'never a partial file name');
  assert.strictEqual(read.resolveBookLink('../images/map.png', spine), null, 'not a chapter: the reader stays where it is');
  assert.strictEqual(read.resolveBookLink('https://example.com/ch1.xhtml', spine), null, 'an outside address is never a jump');
  assert.strictEqual(read.resolveBookLink('javascript:alert(1)', spine), null);
  assert.strictEqual(read.resolveBookLink('', spine), null);
});

test('P4 pure: the PDF layout pref and the More menu choice (its label says what a tap does)', () => {
  assert.strictEqual(read.normalizePdfLayout('scroll'), 'scroll');
  assert.strictEqual(read.normalizePdfLayout('nope'), 'pages', 'PDFs open paged by default');
  assert.deepStrictEqual(read.readerMoreMenuItems({ format: 'epub' }).map((i) => i.value), ['finished', 'save', 'share'], 'an EPUB has no layout choice');
  const paged = read.readerMoreMenuItems({ format: 'pdf', pdfLayout: 'pages' }).pop();
  assert.deepStrictEqual(paged, { value: 'pdf-layout', icon: 'view_list', label: 'Scroll pages' });
  const scroll = read.readerMoreMenuItems({ format: 'pdf', pdfLayout: 'scroll' }).pop();
  assert.deepStrictEqual(scroll, { value: 'pdf-layout', icon: 'menu_book', label: 'Turn pages' });
});
