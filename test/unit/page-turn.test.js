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

test('engine: quick taps chain - five taps in one go land five pages, in order, none dropped (reduced and animated)', async () => {
  for (const reduced of [true, false]) {
    const m = mountEngine({ reduced });
    m.engine.jump(0);
    await frames();
    for (let i = 0; i < 5; i++) m.engine.next(); // every rig after the first is still repainting
    await frames(reduced ? 30 : 80);
    assert.deepStrictEqual(m.places, [0, 1, 2, 3, 4, 5], `reduced motion ${reduced}`);
    m.engine.prev(); m.engine.prev(); m.engine.next();
    await frames(reduced ? 30 : 80);
    assert.deepStrictEqual(m.places.slice(6), [4, 3, 4], `mixed directions keep their order (reduced ${reduced})`);
    m.engine.destroy(); m.dom.window.close();
  }
});

test('engine: a queued tap past the end ends the queue; the next tap still works (reduced and animated)', async () => {
  for (const reduced of [true, false]) {
    const m = mountEngine({ reduced, present: (idx) => idx <= 2 });
    m.engine.jump(0);
    await frames();
    for (let i = 0; i < 4; i++) m.engine.next(); // pages 1, 2, then nothing past the end
    await frames(reduced ? 30 : 80);
    assert.deepStrictEqual(m.places, [0, 1, 2], `reduced ${reduced}`);
    m.engine.prev();
    await frames(reduced ? 20 : 60);
    assert.deepStrictEqual(m.places, [0, 1, 2, 1], `the queue did not stick (reduced ${reduced})`);
    m.engine.destroy(); m.dom.window.close();
  }
});

test('engine: a drag that falls back saves nothing (P8) and its click is swallowed (never also a tap-zone turn)', async () => {
  const m = mountEngine();
  m.engine.jump(0);
  await frames();
  const ev = (type, x, extra) => new m.win.PointerEvent(type, Object.assign({ pointerId: 3, pointerType: 'mouse', button: 0, isPrimary: true, clientX: x, clientY: 600, bubbles: true }, extra));
  m.host.dispatchEvent(ev('pointerdown', 300));
  m.host.dispatchEvent(ev('pointermove', 290));
  m.host.dispatchEvent(ev('pointermove', 280)); // 5% travel
  await new Promise((r) => setTimeout(r, 120)); // rests before lifting: no speed
  let clicked = 0;
  m.host.addEventListener('click', () => { clicked++; });
  m.host.dispatchEvent(ev('pointerup', 280));
  m.host.dispatchEvent(new m.win.MouseEvent('click', { bubbles: true, cancelable: true })); // the release's own click
  assert.strictEqual(clicked, 0, 'the click that ends a drag is the drag\'s own');
  await frames(20);
  assert.deepStrictEqual(m.places, [0], 'a fall back reports no place');
  m.host.dispatchEvent(new m.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.strictEqual(clicked, 1, 'a later click is a click');
  m.engine.destroy(); m.dom.window.close();
});

test('engine: right after a landing nothing is current until the twin rig has swapped up (P8 swap window)', async () => {
  const m = mountEngine();
  m.engine.jump(0);
  await frames();
  m.engine.next(); // reduced motion: lands at once, then the twin re-points
  assert.strictEqual(m.engine.viewers().filter((v) => m.engine.isCurrent(v)).length, 0, 'the swap window: no viewer may save a place');
  await frames();
  assert.strictEqual(m.engine.viewers().filter((v) => m.engine.isCurrent(v)).length, 1);
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
// The frame's own path: epub.js parses the chapter as XML and serializes its root element (XMLSerializer); the
// serialize hook rewrites that markup; the frame builds its document with the HTML parser.
function frameOf(chapterXml) {
  const xmlWin = new JSDOM('', { contentType: 'text/html' }).window;
  const xdoc = new xmlWin.DOMParser().parseFromString(chapterXml, 'application/xhtml+xml');
  const serialized = new xmlWin.XMLSerializer().serializeToString(xdoc.documentElement);
  const out = read.hardenChapterMarkup(serialized, xmlWin.DOMParser);
  const frame = new JSDOM(out).window.document; // HTML parse, as srcdoc
  return { out, frame };
}
function policyFirst(frame) {
  const first = frame.head.firstElementChild;
  return Boolean(first && first.localName === 'meta' && first.getAttribute('http-equiv') === 'Content-Security-Policy'
    && first.getAttribute('content') === read.READER_CHAPTER_CSP);
}
function handlers(frame) {
  const out = [];
  for (const el of frame.querySelectorAll('*')) for (const a of el.attributes) if (/^on/i.test(a.name)) out.push(a.name);
  return out;
}
// The gate r1 shapes (qa C1 / adversary C1, W1): content before <head>, a body before <head>, a CDATA before
// <head>, an SVG-rooted spine item, uppercase names; plus nested frames and javascript: URLs.
const HOSTILE = {
  'element before head': `<html xmlns="${XHTML}"><div>before head</div><head><title>t</title></head><body><p>x</p><script>parent.p=1</script></body></html>`,
  'body before head': `<html xmlns="${XHTML}"><body><p>x</p><SCRIPT>top.p=1</SCRIPT></body><head/></html>`,
  'text before head': `<html xmlns="${XHTML}">stray<head><title>t</title></head><body><p>x</p></body></html>`,
  'CDATA before head': `<html xmlns="${XHTML}"><![CDATA[><iframe srcdoc="<script>top.p=1</script>">]]><head><title>t</title></head><body><p>x</p></body></html>`,
  'uppercase script and refresh': `<html xmlns="${XHTML}"><head><META HTTP-EQUIV="Refresh" content="0;url=/robots.txt"/><title>t</title></head><body><SCRIPT>top.p=1</SCRIPT><P ONCLICK="top.p=1">x</P></body></html>`,
  'nested frames and urls': `<html xmlns="${XHTML}"><head><base href="https://evil.example/"/></head><body><iframe srcdoc="&lt;script&gt;top.p=1&lt;/script&gt;"></iframe><object data="x.svg"></object><embed src="x.svg"/><a href=" JaVaScript:top.p=1">j</a><a href="data:text/html,&lt;script&gt;1&lt;/script&gt;">d</a><img src="a.png" onerror="top.p=1"/><noscript><p>n</p></noscript></body></html>`,
  'svg root': `<svg xmlns="http://www.w3.org/2000/svg"><script>top.p=1</script><a href="javascript:top.p=1"><text>x</text></a></svg>`,
};

test('P9 hardenChapterMarkup: after the frame\'s HTML parse the policy is the FIRST element of <head> for every hostile shape, and no code is left', () => {
  for (const [name, xml] of Object.entries(HOSTILE)) {
    const { out, frame } = frameOf(xml);
    assert.ok(out.startsWith('<meta http-equiv="Content-Security-Policy"'), `${name}: the policy is the first bytes`);
    assert.ok(policyFirst(frame), `${name}: the policy is the first element of the frame's <head>`);
    assert.strictEqual(frame.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length, 1, `${name}: exactly one policy`);
    assert.strictEqual(frame.querySelectorAll('script, iframe, frame, base, noscript').length, 0, `${name}: no script, frame, base, noscript`);
    for (const el of frame.querySelectorAll('object, embed')) {
      assert.deepStrictEqual(['data', 'src', 'type', 'classid', 'codebase'].filter((a) => el.hasAttribute(a)), [], `${name}: an object / embed loads nothing`);
    }
    for (const el of frame.querySelectorAll('a, area')) {
      for (const attrName of ['href', 'xlink:href']) {
        const v = (el.getAttribute(attrName) || '').toLowerCase();
        assert.ok(!/^[a-z][a-z0-9+.-]*:/.test(v) || /^(https?|mailto):/.test(v), `${name}: a link keeps only http(s) / mailto / relative (${v})`);
      }
    }
    assert.strictEqual(frame.querySelectorAll('meta[http-equiv]:not([http-equiv="Content-Security-Policy"])').length, 0, `${name}: no refresh`);
    assert.deepStrictEqual(handlers(frame), [], `${name}: no inline handler`);
    for (const el of frame.querySelectorAll('[href], [src]')) {
      const v = (el.getAttribute('href') || el.getAttribute('src') || '').replace(/\s/g, '').toLowerCase();
      assert.ok(!/^(javascript|vbscript|data:text\/html)/.test(v), `${name}: no code URL (${v})`);
    }
  }
  assert.match(read.READER_CHAPTER_CSP, /(^|; )script-src 'none'(;|$)/);
  assert.match(read.READER_CHAPTER_CSP, /frame-src 'none'/);
});

test('P9 hardenChapterMarkup: neutralized elements keep every sibling count, so places saved before v1.402 still land (gate r2)', () => {
  const xml = `<html xmlns="${XHTML}"><head><title>t</title><script>x</script><base href="/"/></head><body><h1>H</h1><p>a</p><p>b</p>`
    + '<noscript><p>n</p></noscript><script>x</script><object data="x"></object><div><p>c</p><iframe src="x"></iframe><p>d</p></div>'
    + Array.from({ length: 5 }, (_, i) => `<p>q${i}</p>`).join('') + '</body></html>';
  // the frame v1.401 built: the same XML serialization, parsed as HTML, nothing removed
  const xmlWin = new JSDOM('', { contentType: 'text/html' }).window;
  const serialized = new xmlWin.XMLSerializer().serializeToString(new xmlWin.DOMParser().parseFromString(xml, 'application/xhtml+xml').documentElement);
  const before = new JSDOM(serialized).window.document;
  const { frame } = frameOf(xml);
  // a neutralized element's own children are gone (a place saved INSIDE a <noscript> cannot land; disclosed);
  // every kept element keeps its position and its own child count
  // emptied: script, frames, base (their HTML content is text); kept as a <span> WITH its children: noscript,
  // object, embed (v1.401's scripts-off frame parsed them as ordinary elements)
  const EMPTIED = /^(script|iframe|frame|base|template)$/;
  const shape = (el) => Array.from(el.children).map((c) => (EMPTIED.test(c.localName) ? 'x' : `${c.localName === 'noscript' ? 'span' : c.localName}:${c.children.length}`));
  assert.strictEqual(frame.body.children.length, before.body.children.length, 'the body keeps its element count');
  assert.deepStrictEqual(shape(frame.body), shape(before.body), 'every kept element keeps its index and child count');
  const div = (d) => d.body.querySelector('div');
  assert.deepStrictEqual(shape(div(frame)), shape(div(before)), 'a nested level keeps its counts too (an iframe between two paragraphs)');
  assert.strictEqual(frame.head.children.length, before.head.children.length + 1, 'the head gains only the policy meta');
  const qBefore = Array.from(before.body.children).findIndex((c) => c.textContent === 'q2');
  const qAfter = Array.from(frame.body.children).findIndex((c) => c.textContent === 'q2');
  assert.strictEqual(qAfter, qBefore, 'a paragraph after the neutralized elements keeps its index (its CFI step)');
});

test('P9 hardenChapterMarkup: a chapter\'s blocks in the frame are the server chunker\'s blocks (noscript / object content kept: Listen and the Feed line up, gate r3)', () => {
  const chunk = require('../../lib/books/tts-chunk.js');
  const body = '<h1>H</h1><p>q0</p><noscript><p>n1</p><p>n2</p></noscript><object data="clip.mp4" type="video/mp4"><p>fallback</p></object>'
    + '<p>q1</p><script>x</script><p>q2</p><svg xmlns="http://www.w3.org/2000/svg"><set attributeName="href" to="x"/></svg><p>q3</p>';
  const xml = `<?xml version="1.0"?><html xmlns="${XHTML}"><head><title>t</title></head><body>${body}</body></html>`;
  const { frame } = frameOf(xml);
  const frameBlocks = Array.from(frame.querySelectorAll(read.READER_BLOCK_SELECTOR)).map((b) => b.textContent);
  const serverBlocks = chunk.chunkChapterDetailed(xml);
  assert.deepStrictEqual(frameBlocks, ['H', 'q0', 'n1', 'n2', 'fallback', 'q1', 'q2', 'q3']);
  assert.strictEqual(frameBlocks.length, serverBlocks.length, `the frame counts ${frameBlocks.length} blocks, the server ${serverBlocks.length}`);
  assert.strictEqual(frame.querySelectorAll('noscript, set').length, 0, 'no noscript, no animation');
  assert.strictEqual(frame.querySelector('object').hasAttribute('data'), false, 'the object stays (its fallback shows) but loads nothing');
});

test('P9 hardenChapterMarkup: the frame re-nests the chapter exactly as v1.401 did (a noscript in <head>, an object inside a <p>) - gate r4', () => {
  const xmlWin = new JSDOM('', { contentType: 'text/html' }).window;
  const v1401 = (xml) => new JSDOM(new xmlWin.XMLSerializer().serializeToString(new xmlWin.DOMParser().parseFromString(xml, 'application/xhtml+xml').documentElement)).window.document;
  const tags = (d) => Array.from(d.body.children).map((c) => c.localName);
  const blocks = (d) => Array.from(d.querySelectorAll(read.READER_BLOCK_SELECTOR)).map((b) => b.textContent);
  const shapes = [
    `<html xmlns="${XHTML}"><head><title>t</title><noscript><link rel="stylesheet" href="a.css"/></noscript><meta name="a" content="1"/><meta name="b" content="2"/></head><body><h1>B</h1><p>q0</p><p>q1</p></body></html>`,
    `<html xmlns="${XHTML}"><head><title>t</title></head><body><h1>B</h1><p>t<object data="a.mp3" type="audio/mpeg"><p>fb</p></object>after</p><p>q1</p></body></html>`,
    `<html xmlns="${XHTML}"><head><title>t</title></head><body><ul><li>a<object data="x"><li>in</li></object></li></ul><p>t<noscript><p>n</p></noscript>u</p></body></html>`,
  ];
  for (const xml of shapes) {
    const before = v1401(xml);
    const { frame } = frameOf(xml);
    assert.deepStrictEqual(tags(frame), tags(before), 'the body keeps v1.401\'s elements in order');
    assert.deepStrictEqual(blocks(frame), blocks(before), 'and its blocks (Listen, the Feed and saved places line up)');
    assert.strictEqual(frame.head.children.length, before.head.children.length + 1, 'the head keeps its children (plus the policy)');
  }
});

test('P9 hardenChapterMarkup: an href that navigates on ANY element (MathML too) keeps only web / mail / relative; resource hrefs keep blob: (gate r4)', () => {
  const { frame } = frameOf(`<html xmlns="${XHTML}" xmlns:xlink="http://www.w3.org/1999/xlink"><head><link rel="stylesheet" href="blob:http://x/css"/></head><body>`
    + '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow id="m" href="blob:http://x/p"><mi>x</mi></mrow><mi id="k" href="c2.xhtml">k</mi></math>'
    + '<svg xmlns="http://www.w3.org/2000/svg"><image id="im" href="blob:http://x/i"/><use id="u" xlink:href="blob:http://x/s#a"/></svg><span id="sp" href="data:text/plain,x">s</span></body></html>');
  assert.strictEqual(frame.getElementById('m').getAttribute('href'), null, 'a MathML link to a blob: page goes');
  assert.strictEqual(frame.getElementById('k').getAttribute('href'), 'c2.xhtml', 'a relative one stays');
  assert.strictEqual(frame.getElementById('sp').getAttribute('href'), null, 'any other element with a non-web href goes');
  assert.strictEqual(frame.querySelector('link').getAttribute('href'), 'blob:http://x/css', "a stylesheet keeps epub.js's blob: URL");
  assert.strictEqual(frame.getElementById('im').getAttribute('href'), 'blob:http://x/i', 'an SVG image keeps it');
  assert.strictEqual(frame.getElementById('u').getAttribute('xlink:href'), 'blob:http://x/s#a', 'an SVG use keeps it');
});

test('P9 hardenChapterMarkup: a book\'s own <template> (shadowrootmode) and SVG animations are emptied; ping goes (gate r3)', () => {
  const { out, frame } = frameOf(`<html xmlns="${XHTML}"><head/><body><div><template shadowrootmode="open"><a href="blob:http://x/1">s</a></template></div>`
    + '<svg xmlns="http://www.w3.org/2000/svg"><a><set attributeName="href" to="blob:http://x/2"/><animate attributeName="href" values="blob:http://x/3"/><animateMotion dur="1s"/><animateTransform attributeName="transform"/><rect/></a></svg>'
    + '<a id="p" href="https://example.com/" ping="https://tracker.example/">w</a></body></html>');
  assert.doesNotMatch(out, /blob:http:\/\/x|shadowrootmode|<set|<animate/i, 'no hidden link target survives anywhere in the markup');
  assert.strictEqual(frame.getElementById('p').hasAttribute('ping'), false);
  assert.strictEqual(frame.getElementById('p').getAttribute('href'), 'https://example.com/');
});

test('P9 hardenChapterMarkup: links keep http(s), mailto and relative chapter paths; blob:, data: and other schemes go (HTML <a>, <area>, SVG <a>)', () => {
  const { frame } = frameOf(`<html xmlns="${XHTML}" xmlns:xlink="http://www.w3.org/1999/xlink"><head/><body>`
    + '<a id="rel" href="c2.xhtml#n">r</a><a id="web" href="https://example.com/">w</a><a id="mail" href="mailto:a@b.c">m</a>'
    + '<a id="blob" href="blob:http://127.0.0.1/abc">b</a><a id="data" href="data:image/svg+xml,&lt;svg/&gt;">d</a>'
    + '<map name="m"><area id="area" href="blob:http://127.0.0.1/def" shape="rect" coords="0,0,9,9"/></map>'
    + '<svg xmlns="http://www.w3.org/2000/svg"><a id="svga" xlink:href="blob:http://127.0.0.1/ghi"><text>s</text></a></svg>'
    + '<img id="img" src="blob:http://127.0.0.1/img"/></body></html>');
  const href = (id) => { const el = frame.getElementById(id); return el.getAttribute('href') || el.getAttribute('xlink:href'); };
  assert.strictEqual(href('rel'), 'c2.xhtml#n');
  assert.strictEqual(href('web'), 'https://example.com/');
  assert.strictEqual(href('mail'), 'mailto:a@b.c');
  for (const id of ['blob', 'data', 'area', 'svga']) assert.strictEqual(href(id), null, `${id}: no navigation to a non-web scheme`);
  assert.strictEqual(frame.getElementById('img').getAttribute('src'), 'blob:http://127.0.0.1/img', "an image keeps epub.js's blob: URL");
});

test('P9 hardenChapterMarkup: an ordinary chapter keeps its text, structure and attributes', () => {
  const { frame } = frameOf(`<html xmlns="${XHTML}"><head><title>Ch</title><link rel="stylesheet" href="s.css"/></head><body><h1 class="k">One</h1><p>Hello <em>there</em>.</p><img src="a.png" alt="a"/></body></html>`);
  assert.ok(policyFirst(frame));
  assert.strictEqual(frame.querySelector('h1').className, 'k');
  assert.strictEqual(frame.body.textContent, 'OneHello there.');
  assert.strictEqual(frame.querySelector('img').getAttribute('src'), 'a.png');
  assert.strictEqual(frame.querySelector('link').getAttribute('href'), 's.css');
  assert.strictEqual(frame.body.firstElementChild.localName, 'h1', 'the body starts where the book starts (block indices unchanged)');
});

test('in-book links: epub.js\'s "../ch2.xhtml#n" resolves to the spine item (fragment kept); anything else stays put', () => {
  const spine = ['ch0.xhtml', 'ch1.xhtml', 'text/ch2.xhtml'];
  assert.deepStrictEqual(read.resolveBookLink('../ch1.xhtml', spine), { target: 'ch1.xhtml', spine: 1 });
  assert.deepStrictEqual(read.resolveBookLink('../text/ch2.xhtml#note-3', spine), { target: 'text/ch2.xhtml#note-3', spine: 2 });
  assert.deepStrictEqual(read.resolveBookLink('ch2.xhtml', spine), { target: 'text/ch2.xhtml', spine: 2 }, 'a bare file name matches on a directory boundary');
  assert.deepStrictEqual(read.resolveBookLink('../a/n.xhtml', ['b/n.xhtml', 'a/n.xhtml']), { target: 'a/n.xhtml', spine: 1 }, 'an exact path beats a same-name file in another folder');
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
