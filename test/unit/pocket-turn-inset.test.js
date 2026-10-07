'use strict';

// [UNIT] v1.357 W0/W1: the Pocket turn back upright. Dean's 2026-10-02 capture (home-screen app, iPhone 393x852,
// test/fixtures/rotate-capture-2026-10-02.jsonl) showed ~200 ms of the skin 59 px low after the turn: the app area
// already excluded the status bar (innerHeight 793) while env(safe-area-inset-top) still read 59. These tests
// replay EVERY captured row through the pure rule, sweep the steady states, and drive the turn window with the
// REAL event shapes (orientation media query, orientationchange, screen.orientation, resize) in jsdom.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const L = require('../../public/js/pocket-lighting.js');

const ROOT = path.join(__dirname, '..', '..');
const ROWS = fs.readFileSync(path.join(ROOT, 'test/fixtures/rotate-capture-2026-10-02.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const SCREEN = { screenW: 393, screenH: 852 }; // the capture's device (iPhone, portrait screen size in either orientation)
const SPACE_8 = 16; // tokens.css --space-8: the Pocket's portrait top padding beyond the inset

const satPx = (r) => parseFloat(r.sat);
const measured = (r) => ({ sat: satPx(r), innerH: r.ih, innerW: r.iw, land: r.land, ...SCREEN });

test('W0.1 the model: every captured portrait row has LCD top = safe-area inset + --space-8 - scrollY', () => {
  for (const r of ROWS.filter((x) => !x.land)) {
    assert.strictEqual(r.lcd[1], satPx(r) + SPACE_8 - r.sy, `${r.phase} (${r.why}): the old padding reproduces the captured LCD top`);
  }
});

test('W0.1 replay: the rule puts the LCD where the settled row has it on every captured portrait row, and keeps 59 while the app still spans the status bar', () => {
  const settled = ROWS.find((r) => r.phase === 'portrait-settled');
  for (const r of ROWS.filter((x) => !x.land)) {
    const inset = L.pocketTopInset(measured(r));
    const top = inset + SPACE_8 - r.sy; // what the padding would give with the rule, at the captured scroll
    if (r.phase === 'giant') assert.strictEqual(inset, 59, 'giant: the app still spans the status bar, the whole inset stays');
    if (r.phase === 'low') { assert.strictEqual(inset, 0, 'low: the 59 was counted twice'); assert.strictEqual(top, settled.lcd[1], 'low lands where settled sits'); }
    if (r.phase === 'scrolled') assert.strictEqual(inset, 0, 'scrolled: env already corrected');
    if (r.phase === 'portrait-settled') { assert.strictEqual(inset, 0); assert.strictEqual(top, settled.lcd[1]); }
  }
  assert.ok(ROWS.some((r) => r.phase === 'giant') && ROWS.some((r) => r.phase === 'low'), 'the fixture carries the phases the rule is about');
});

test('W0.1 steady states (measured rows only): the rule is the identity on the landscape and portrait-settled rows; Safari tabs are device-only', () => {
  for (const r of ROWS.filter((x) => x.phase === 'landscape-steady' || x.phase === 'portrait-settled')) {
    assert.strictEqual(L.pocketTopInset(measured(r)), satPx(r), r.phase + ': a steady row keeps its own inset');
  }
  // never negative, never above the inset it was given
  for (const sat of [0, 20, 47, 59]) for (const innerH of [300, 393, 659, 793, 852]) for (const land of [true, false]) {
    const v = L.pocketTopInset({ sat, innerH, innerW: 393, land, ...SCREEN });
    assert.ok(v >= 0 && v <= sat, `0 <= ${v} <= ${sat}`);
  }
});

// ---- the window (installTurnInset) ----------------------------------------------------------------
function turnEnv(opts) {
  const o = Object.assign({ phone: true, standalone: true, sat: 59, ih: 852, iw: 393, land: false }, opts);
  const dom = new JSDOM('<html class="' + (o.phone ? 'is-phone' : '') + '"><body></body></html>', { url: 'http://localhost/music', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  const st = { sat: o.sat, ih: o.ih, iw: o.iw, land: o.land };
  const mqs = {};
  const mq = (q) => {
    if (!mqs[q]) {
      const m = { _l: [], addEventListener(t, f) { if (t === 'change') this._l.push(f); }, removeEventListener(t, f) { this._l = this._l.filter((x) => x !== f); } };
      Object.defineProperty(m, 'matches', { get: () => (q.includes('orientation') ? st.land : q.includes('standalone') ? o.standalone : false) });
      mqs[q] = m;
    }
    return mqs[q];
  };
  w.matchMedia = mq;
  Object.defineProperty(w, 'screen', { value: { width: 393, height: 852, orientation: new w.EventTarget() }, configurable: true });
  Object.defineProperty(w, 'innerHeight', { get: () => st.ih, configurable: true });
  Object.defineProperty(w, 'innerWidth', { get: () => st.iw, configurable: true });
  w.getComputedStyle = () => ({ paddingTop: st.sat + 'px' });
  let now = 0; let seq = 0; const rafs = new Map(); const timers = new Map();
  w.requestAnimationFrame = (cb) => { rafs.set(++seq, cb); return seq; };
  w.cancelAnimationFrame = (id) => { rafs.delete(id); };
  w.setTimeout = (cb, ms) => { timers.set(++seq, { cb, at: now + ms }); return seq; };
  w.clearTimeout = (id) => { timers.delete(id); };
  const advance = (ms) => { // run frames every 16 ms and fire due timers
    const end = now + ms;
    while (now < end) {
      now += 16;
      Array.from(timers).forEach(([id, t]) => { if (t.at <= now) { timers.delete(id); t.cb(); } });
      const due = Array.from(rafs); rafs.clear(); due.forEach(([, cb]) => cb(now));
    }
  };
  const prop = () => w.document.documentElement.style.getPropertyValue('--pk-top-inset');
  return {
    w, st, prop, advance, mq: mq('(orientation: landscape)'), counts: () => ({ rafs: rafs.size, timers: timers.size }),
    // jsdom drops the env() declaration from the probe's style attribute, so the probe is found by what it is: the one
    // aria-hidden div the window appends to <body> (a selector on the env() text matched nothing and bound nothing)
    probes: () => w.document.querySelectorAll('body > div[aria-hidden="true"]').length,
    fireMq: () => mq('(orientation: landscape)')._l.slice().forEach((f) => f()),
    fireOrientation: () => w.dispatchEvent(new w.Event('orientationchange')),
    fireScreenOrientation: () => w.screen.orientation.dispatchEvent(new w.Event('change')),
    fireResize: () => w.dispatchEvent(new w.Event('resize')),
  };
}

test('W1 window: opens on EACH first-flip event (mq, orientationchange, screen.orientation) and the property carries the rule\'s value', () => {
  for (const kind of ['fireMq', 'fireOrientation', 'fireScreenOrientation']) {
    const e = turnEnv(); const h = L.installTurnInset(e.w);
    assert.strictEqual(e.prop(), '', kind + ': absent before the turn');
    e[kind]();
    assert.ok(h.isOpen(), kind + ' opens the window');
    assert.strictEqual(e.prop(), '59px', kind + ': giant stage, the app still spans the status bar: the whole inset');
    h.destroy();
  }
});

test('W1 window: the captured turn sequence - 59px, then 0px as the app area shrinks, then absent after resize + one frame', () => {
  const e = turnEnv({ land: true, sat: 0, ih: 393 }); const h = L.installTurnInset(e.w);
  e.st.land = false; e.st.ih = 852; e.st.sat = 59; e.fireMq(); // giant
  assert.strictEqual(e.prop(), '59px');
  e.advance(100);
  e.st.ih = 793; // low: innerHeight corrects first, env() still 59
  e.advance(48);
  assert.strictEqual(e.prop(), '0px', 'low: the stale env() is no longer counted');
  e.st.sat = 0; e.fireResize(); // the window resize event: env() corrected
  assert.ok(h.isOpen(), 'still open on the resize itself: it closes one frame later');
  assert.strictEqual(e.probes(), 1, 'non-vacuous: the probe exists until the window closes');
  e.advance(16 * 2);
  assert.ok(!h.isOpen(), 'closed after resize + one frame');
  assert.strictEqual(e.prop(), '', 'the property is gone: the CSS is today\'s env() again');
  assert.strictEqual(e.w.document.documentElement.getAttribute('style'), null, 'no empty style attribute left behind');
  assert.deepStrictEqual(e.counts(), { rafs: 0, timers: 0 }, 'no frame loop or timer left running');
  assert.strictEqual(e.probes(), 0, 'the probe element is removed');
  h.destroy();
});

test('W1 window: capped at 1 s when no resize ever comes; a second flip inside the window restarts the cap; a resize alone never opens it', () => {
  const e = turnEnv(); const h = L.installTurnInset(e.w);
  e.fireResize(); e.advance(64);
  assert.ok(!h.isOpen() && e.prop() === '', 'a resize with no flip (keyboard, toolbar) opens nothing');
  e.fireMq(); e.advance(900);
  assert.ok(h.isOpen(), 'still open at 900 ms');
  e.fireOrientation(); e.advance(900);
  assert.ok(h.isOpen(), 'a second flip restarted the cap (1.8 s after the first)');
  e.advance(200);
  assert.ok(!h.isOpen(), 'closed by the 1 s cap');
  assert.strictEqual(e.prop(), '');
  assert.deepStrictEqual(e.counts(), { rafs: 0, timers: 0 });
  h.destroy();
});

test('W1 window: outside a turn the property is absent on every steady state; never opens off the home-screen phone app (R4)', () => {
  for (const r of ROWS.filter((x) => x.phase === 'landscape-steady' || x.phase === 'portrait-settled')) {
    const e = turnEnv({ land: r.land, sat: satPx(r), ih: r.ih, iw: r.iw }); const h = L.installTurnInset(e.w);
    e.advance(2000);
    assert.strictEqual(e.prop(), '', r.phase + ': steady = untouched');
    h.destroy();
  }
  for (const o of [{ standalone: false }, { phone: false }]) {
    const e = turnEnv(o); const h = L.installTurnInset(e.w);
    e.fireMq(); e.fireOrientation(); e.fireScreenOrientation(); e.advance(500);
    assert.ok(!h.isOpen() && e.prop() === '' && e.probes() === 0, JSON.stringify(o) + ': a flip changes nothing');
    h.destroy();
  }
});

test('W1 window: destroy() mid-window clears the property, the probe, the timers and every listener', () => {
  const e = turnEnv(); const h = L.installTurnInset(e.w);
  e.fireMq(); e.advance(48);
  assert.strictEqual(e.prop(), '59px');
  assert.strictEqual(e.probes(), 1, 'non-vacuous: the probe exists while the window is open');
  h.destroy();
  assert.strictEqual(e.prop(), '');
  assert.strictEqual(e.probes(), 0);
  assert.deepStrictEqual(e.counts(), { rafs: 0, timers: 0 });
  assert.strictEqual(e.mq._l.length, 0, 'the orientation query listener is removed');
  e.fireOrientation(); e.fireScreenOrientation(); e.fireMq(); e.fireResize(); e.advance(200);
  assert.strictEqual(e.prop(), '', 'no event reaches a destroyed window');
  assert.ok(!h.isOpen());
});

// ---- the CSS: the three portrait paddings read the property; nothing else does -----------------------
test('W1 CSS: the Pocket portrait top paddings read var(--pk-top-inset, env(safe-area-inset-top)); every other use of the property is none', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  const uses = css.split('\n').filter((l) => l.includes('--pk-top-inset'));
  assert.strictEqual(uses.length, 3, 'the apple, spotify and ipod portrait paddings, no more');
  // the iPod portrait lock: the turned Upright player's own top inset (--mms-up-top) reads first, else this one
  for (const l of uses) assert.ok(l.includes('calc(var(--mms-up-top, var(--pk-top-inset, env(safe-area-inset-top,0px))) + var(--space-8))'), 'fallback is today\'s env(): ' + l.trim().slice(0, 80));
  // the landscape layout keeps reading env() directly (no capture of that turn exists)
  const land = css.slice(css.indexOf('UI pass D7: POCKET IN LANDSCAPE'));
  assert.ok(!land.includes('--pk-top-inset'), 'the landscape block is untouched');
});

// ---- the rotate log's new fields --------------------------------------------------------------------
test('W1 rotate log: rows carry sh (screen), cvw/cvh (100vw / 100dvh through a probe) and pti (the inset applied); the second probe is removed on uninstall', () => {
  const { rotateSample, installRotateDebug, uninstallRotateDebug } = require('../../public/js/common.js');
  const dom = new JSDOM('<body></body>', { url: 'http://localhost/music?debugRotate=1', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w, 'screen', { value: { width: 393, height: 852 }, configurable: true });
  w.requestAnimationFrame = () => 1;
  assert.strictEqual(installRotateDebug(w), true);
  w.dispatchEvent(new w.Event('orientationchange')); // ensurePanel builds the probes
  const vp = w.document.getElementById('ft-rotate-vprobe');
  assert.ok(vp, 'the viewport-unit probe exists');
  assert.ok(/100vw/.test(vp.style.width) && /100dvh/.test(vp.style.height), 'it is sized by the two units under test');
  const real = w.getComputedStyle.bind(w);
  w.getComputedStyle = (el) => (el === vp ? { width: '852px', height: '393px' } : real(el));
  w.document.documentElement.style.setProperty('--pk-top-inset', '0px');
  const s = rotateSample(w, 5);
  assert.deepStrictEqual(s.sh, [393, 852]);
  assert.strictEqual(s.cvw, 852); assert.strictEqual(s.cvh, 393);
  assert.strictEqual(s.pti, '0px');
  w.document.documentElement.style.removeProperty('--pk-top-inset');
  assert.strictEqual(rotateSample(w, 6).pti, '', 'no window open: empty');
  assert.strictEqual(uninstallRotateDebug(w), true);
  assert.strictEqual(w.document.getElementById('ft-rotate-vprobe'), null, 'the probe is gone with the log');
});

// ---- reachability: the REAL module load wires the window to the one orientation-query listener ------------
test('W1 reachability: loaded as the page loads it, ONE media-query listener both restamps and opens the turn window; the property reaches <html>', () => {
  const e = turnEnv();
  const src = fs.readFileSync(path.join(ROOT, 'public/js/pocket-lighting.js'), 'utf8');
  e.w.eval(src);
  assert.strictEqual(e.mq._l.length, 1, 'one listener on the orientation query (stamp + turn share it)');
  e.st.land = true;
  e.fireMq();
  assert.strictEqual(e.prop(), '59px', 'the real page wiring opened the window on the media-query change');
  assert.strictEqual(e.w.document.documentElement.getAttribute('data-ft-rot'), '0', 'and the stamp ran in the same step');
  e.fireOrientation(); e.advance(1200);
  assert.strictEqual(e.prop(), '', 'and the cap closed it');
});
