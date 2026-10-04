'use strict';

// [UNIT] v1.362 - minimize the phone player into the mini player (plan 2026-10-03-minimize-to-mini-player).
// The pure decisions are bound by invocation; then the REAL player.js is driven through its real touch
// listeners (the surface's AND the host's) in a jsdom watch shell, so a decision that is right but never
// reached by a gesture cannot pass (LESSONS 2, inert feature). The hold-lock harness shape.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const player = require('../../public/js/player.js');
const common = require('../../public/js/common.js');

const PUB = path.join(__dirname, '..', '..', 'public');
const LOCK_SRC = fs.readFileSync(path.join(PUB, 'js', 'body-scroll-lock.js'), 'utf8');
const COMMON_SRC = fs.readFileSync(path.join(PUB, 'js', 'common.js'), 'utf8');
const PLAYER_SRC = fs.readFileSync(path.join(PUB, 'js', 'player.js'), 'utf8');
const WATCH = fs.readFileSync(path.join(PUB, 'watch.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');

// ---- pure: minimizeAllowedDecision (R1 + M8) ---------------------------------

const ALLOWED = { stateFull: true, inSlot: true, watchView: true, cssFullscreen: false, audioExpanded: false, nativeFullscreen: false, nativeControls: false, mobile: true, narrow: true };

test('minimizeAllowedDecision: true only when EVERY condition holds; each one flipped alone refuses', () => {
  const d = player.minimizeAllowedDecision;
  assert.strictEqual(typeof d, 'function', 'exported');
  assert.strictEqual(d(ALLOWED), true, 'the phone inline watch player');
  for (const k of Object.keys(ALLOWED)) {
    const f = Object.assign({}, ALLOWED, { [k]: !ALLOWED[k] });
    assert.strictEqual(d(f), false, 'flipping ' + k + ' alone must refuse');
  }
  assert.strictEqual(d(), false);
  assert.strictEqual(d({}), false);
});

// ---- pure: minimizeDragDecision (R2, R2b) -------------------------------------

test('minimizeDragDecision: claim iff down >= 12, dy > 1.5 |dx|, scrollY <= 1 and no hold; a smaller downward-dominant move at the top is a guard', () => {
  const d = player.minimizeDragDecision;
  assert.strictEqual(typeof d, 'function', 'exported');
  const at = (dx, dy, extra) => d(Object.assign({ dx, dy, scrollY: 0, holdActive: false }, extra || {}));
  assert.strictEqual(at(0, 12), 'claim');
  assert.strictEqual(at(0, 11), 'guard', 'under the claim distance it only guards the page');
  assert.strictEqual(at(0, 1), 'guard');
  assert.strictEqual(at(0, 0), 'none');
  assert.strictEqual(at(7, 12), 'claim', '12 > 1.5 * 7');
  assert.strictEqual(at(8, 12), 'none', '12 = 1.5 * 8 is not dominant');
  assert.strictEqual(at(-7, 12), 'claim', 'leftward lands the same');
  assert.strictEqual(at(0, -40), 'none', 'up never claims');
  assert.strictEqual(at(40, 5), 'none', 'sideways never claims');
  assert.strictEqual(at(0, 40, { scrollY: 1 }), 'claim', 'scrollY 1 still counts as the top');
  assert.strictEqual(at(0, 40, { scrollY: 2 }), 'none', 'scrolled down: the page scrolls (R2b)');
  assert.strictEqual(at(0, 5, { scrollY: 2 }), 'none', 'scrolled down: not even a guard');
  assert.strictEqual(at(0, 40, { holdActive: true }), 'none', 'a hold owns the drag');
  assert.strictEqual(at(0, 5, { holdActive: true }), 'none');
  assert.strictEqual(at(NaN, 40), 'none');
  assert.strictEqual(at(0, 40, { scrollY: NaN }), 'none');
  assert.strictEqual(d(), 'none');
});

test('minimizeDragDecision vs swipeBackShouldClaim: disjoint over a grid, and a hold never minimizes', () => {
  const d = player.minimizeDragDecision;
  assert.strictEqual(typeof d, 'function');
  let claims = 0, guards = 0, backs = 0;
  for (let dx = -200; dx <= 200; dx += 2) {
    for (let dy = -200; dy <= 200; dy += 2) {
      const m = d({ dx, dy, scrollY: 0, holdActive: false });
      const back = common.swipeBackShouldClaim(dx, dy);
      if (m === 'claim') claims++;
      if (m === 'guard') guards++;
      if (back) backs++;
      assert.ok(!(m !== 'none' && back), 'dx ' + dx + ' dy ' + dy + ' is both a minimize ' + m + ' and a swipe-back claim');
      assert.strictEqual(d({ dx, dy, scrollY: 0, holdActive: true }), 'none', 'held: dx ' + dx + ' dy ' + dy);
    }
  }
  assert.ok(claims > 2000 && guards > 3 && backs > 2000, 'the grid exercises every region (' + claims + ' claim, ' + guards + ' guard, ' + backs + ' back)');
});

// ---- pure: minimizeReleaseDecision (R3) ---------------------------------------

test('minimizeReleaseDecision: dock past 35% of the travel, or on a flick (>= 0.5 px/ms and >= 24 px); else snap', () => {
  const d = player.minimizeReleaseDecision;
  assert.strictEqual(typeof d, 'function', 'exported');
  assert.strictEqual(d({ dy: 35, travel: 100, velocityPxPerMs: 0 }), 'dock');
  assert.strictEqual(d({ dy: 34, travel: 100, velocityPxPerMs: 0 }), 'snap');
  assert.strictEqual(d({ dy: 24, travel: 400, velocityPxPerMs: 0.5 }), 'dock', 'a flick');
  assert.strictEqual(d({ dy: 23, travel: 400, velocityPxPerMs: 2 }), 'snap', 'too short for a flick');
  assert.strictEqual(d({ dy: 100, travel: 400, velocityPxPerMs: 0.49 }), 'snap', 'too slow and too short');
  assert.strictEqual(d({ dy: 100, travel: 400, velocityPxPerMs: -3 }), 'snap', 'moving back up is not a flick');
  assert.strictEqual(d({ dy: 40, travel: 0, velocityPxPerMs: 0 }), 'snap', 'no travel: only a flick docks');
  assert.strictEqual(d({ dy: 40, travel: NaN, velocityPxPerMs: 1 }), 'dock', 'no travel, a flick still docks');
  assert.strictEqual(d({ dy: NaN, travel: 100, velocityPxPerMs: 1 }), 'snap');
  assert.strictEqual(d(), 'snap');
  assert.strictEqual(player.MINIMIZE_COMMIT_FRAC, 0.35);
  assert.strictEqual(player.MINIMIZE_FLICK_V, 0.5);
});

// ---- pure: minimizeDragTransform (R5) -----------------------------------------

test('minimizeDragTransform: identity at 0, the dock rect at the full travel, the top edge under the finger in between', () => {
  const t = player.minimizeDragTransform;
  assert.strictEqual(typeof t, 'function', 'exported');
  const from = { x: 0, y: 50, w: 390, h: 260 };
  const to = { x: 222, y: 450, w: 160 };
  const a = t({ from, to, dy: 0 });
  assert.deepStrictEqual([a.tx, a.ty, a.s], [0, 0, 1]);
  const b = t({ from, to, dy: 400 });
  assert.deepStrictEqual([b.tx, b.ty, Math.round(b.s * 1000) / 1000], [222, 400, Math.round(160 / 390 * 1000) / 1000]);
  const c = t({ from, to, dy: 100 });
  assert.strictEqual(c.ty, 100, 'the top edge follows the finger');
  assert.strictEqual(c.tx, 222 * 0.25);
  const over = t({ from, to, dy: 900 });
  assert.strictEqual(over.ty, 400, 'clamped at the dock');
  const neg = t({ from, to, dy: -50 });
  assert.deepStrictEqual([neg.tx, neg.ty, neg.s], [0, 0, 1], 'never above the slot');
});

// ---- pure: the browse-level landing (M7) --------------------------------------

test('resolveMinimizeLanding: back to the nearest browse entry when one is behind, else a fresh Home', () => {
  const r = common.resolveMinimizeLanding;
  assert.strictEqual(typeof r, 'function', 'exported');
  assert.deepStrictEqual(r(1, 0), { action: 'back', steps: 1 }, 'feed -> video');
  assert.deepStrictEqual(r(3, 1), { action: 'back', steps: 2 }, 'channel -> video -> video');
  assert.deepStrictEqual(r(0, null), { action: 'home' }, 'a deep link');
  assert.deepStrictEqual(r(2, null), { action: 'home' }, 'deep link then a related video');
  assert.deepStrictEqual(r(2, 2), { action: 'home' }, 'a browse depth that is not BEHIND is ignored');
  assert.deepStrictEqual(r(2, -1), { action: 'home' });
  assert.deepStrictEqual(r(undefined, 0), { action: 'home' });
});

test('buildHistoryState: a browse entry is its own browse level; a watch entry carries the one behind it (or null)', () => {
  const b = common.buildHistoryState;
  assert.strictEqual(b('home', '/', 0, 0).browseDepth, 0);
  assert.strictEqual(b('channel', '/channel?x', 0, 3).browseDepth, 3);
  assert.strictEqual(b('watch', '/watch.html?v=a', 0, 4, null, 2).browseDepth, 2);
  assert.strictEqual(b('watch', '/watch.html?v=a', 0, 4, null, 4).browseDepth, null, 'not behind');
  assert.strictEqual(b('watch', '/watch.html?v=a', 0, 0).browseDepth, null, 'a deep link has none');
  assert.strictEqual(b('watch', '/watch.html?v=a', 0, 4, null, 'x').browseDepth, null);
  const parsed = common.parseHistoryState(b('watch', '/watch.html?v=a', 10, 4, null, 2), {});
  assert.strictEqual(parsed.browseDepth, 2, 'a popstate parse carries it');
});

test('browseDepthBehind: what a NEW entry pushed from this one inherits (a stateless or pre-v1.362 browse entry counts by its depth)', () => {
  const f = common.browseDepthBehind;
  assert.strictEqual(typeof f, 'function', 'exported');
  assert.strictEqual(f({ view: 'home', depth: 2 }), 2, 'an entry written before v1.362 has no field');
  assert.strictEqual(f({ view: 'watch', depth: 3, browseDepth: 1 }), 1);
  assert.strictEqual(f({ view: 'watch', depth: 3 }), null);
  assert.strictEqual(f({ view: 'watch', depth: 3, browseDepth: null }), null);
  assert.strictEqual(f(null), null);
});

// ---- behaviour: the real gesture in jsdom -------------------------------------

let dom = null;
afterEach(() => { if (dom) { dom.window.close(); dom = null; } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The jsdom geometry: innerHeight 664 (the iPhone 13 viewport), the slot's host at the top (0..390 x 0..260),
// the dock's CSS read from its inline style (jsdom has no stylesheet): right 8, bottom 80, width 160, so the
// dock's top = 664 - 80 - (90 + bar). The travel the release decision divides by is that top.
async function boot(item, o) {
  const opt = o || {};
  const url = 'http://localhost/watch.html?v=' + item.id + (opt.query || '');
  dom = new JSDOM(WATCH, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'platform', { value: opt.desktop ? 'Win32' : 'iPhone' });
  w.matchMedia = (q) => ({ media: q, matches: opt.desktop ? false : /coarse|hover: none|max-width/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(w, 'innerHeight', { value: 664, configurable: true });
  Object.defineProperty(w, 'innerWidth', { value: 390, configurable: true });
  if (opt.scrollY) { Object.defineProperty(w, 'pageYOffset', { value: opt.scrollY, configurable: true }); Object.defineProperty(w, 'scrollY', { value: opt.scrollY, configurable: true }); }
  w.fetch = async () => ({ ok: true, status: 200, json: async () => Object.assign({ mobileCustomPlayer: opt.native ? false : true }, opt.settings || {}), text: async () => '' });
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.scrollTo = () => {};
  w.document.body.setAttribute('data-view', opt.view || 'watch');
  w.eval(COMMON_SRC.slice(COMMON_SRC.indexOf('function resolveAudioArtUrl('), COMMON_SRC.indexOf('\n}\n', COMMON_SRC.indexOf('function resolveAudioArtUrl(')) + 3));
  w.eval(LOCK_SRC);
  if (opt.peekMs) {
    // v1.362.1: a short peek window for the drives (the real 3000 is asserted on the export). Exact once.
    assert.strictEqual(PLAYER_SRC.split('var MINIMIZE_PEEK_MS = 3000;').length, 2, 'the peek constant is defined once');
    w.eval(PLAYER_SRC.replace('var MINIMIZE_PEEK_MS = 3000;', 'var MINIMIZE_PEEK_MS = ' + opt.peekMs + ';'));
  } else {
    w.eval(PLAYER_SRC);
  }
  const leaves = [];
  w.FileTube.leaveWatchForBrowse = () => { leaves.push({ state: w.FileTube.player.getState() }); };
  const dockEl = w.document.getElementById('player-dock');
  dockEl.style.right = '8px'; dockEl.style.bottom = '80px'; dockEl.style.width = '160px'; dockEl.style.setProperty('--size-touch', '44px');
  const slot = w.document.createElement('div'); slot.id = 'player-slot'; w.document.body.appendChild(slot);
  const p = w.FileTube.player;
  assert.strictEqual(p.load(item.id, item, { slot }), true, 'the real player loaded the item');
  await wait(60);
  const v = w.document.getElementById('media-player');
  const host = w.document.getElementById('player-wrapper');
  Object.defineProperty(v, 'paused', { value: false, configurable: true });
  const rect = { left: 0, top: 0, x: 0, y: 0, width: 390, height: 260, right: 390, bottom: 260 };
  v.getBoundingClientRect = () => rect;
  host.getBoundingClientRect = () => (host.parentNode === slot ? rect : { left: 222, top: 450, x: 222, y: 450, width: 160, height: 134, right: 382, bottom: 584 });
  let pauses = 0; v.pause = () => { pauses++; };
  // v1.362.1: drive the media's paused state AND its event (the chevron reads paused on play / pause).
  const media = (paused) => { Object.defineProperty(v, 'paused', { value: paused, configurable: true }); v.dispatchEvent(new w.Event(paused ? 'pause' : 'play')); };
  return { w, doc: w.document, p, v, host, slot, dockEl, leaves, pauses: () => pauses, media };
}
const VIDEO = { id: 'v1', title: 'T', type: 'video', ext: '.mp4' };
const VIDEO2 = { id: 'v2', title: 'T2', type: 'video', ext: '.mp4' };

function ev(w, type, x, y, stamp) {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  const list = [{ clientX: x, clientY: y }];
  Object.defineProperty(e, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : list });
  Object.defineProperty(e, 'changedTouches', { value: list });
  if (stamp !== undefined) Object.defineProperty(e, 'timeStamp', { value: stamp });
  return e;
}
const fire = (w, el, type, x, y, stamp) => { const e = ev(w, type, x, y, stamp); el.dispatchEvent(e); return e; };

// A slow pull (40 ms between 10 px moves, 0.25 px/ms: never a flick) from y0 down by `dy`. Returns the moves.
function pull(h, dy, o) {
  const opt = o || {};
  const x = 200, y0 = 100; let t = 1000;
  fire(h.w, h.v, 'touchstart', x, y0, t);
  const moves = [];
  for (let d = 10; d <= dy; d += 10) { t += opt.stepMs || 40; moves.push(fire(h.w, h.v, 'touchmove', x, y0 + d, t)); }
  return { x, y: y0 + dy, t, moves };
}
const travelOf = () => 664 - 80 - (160 * 9 / 16 + 44) - 0; // the dock's top (its bar is --size-touch on a phone) minus the host's top

test('a pull at the top past the threshold docks, THEN leaves for the browse level, once; playback is never paused', async () => {
  const h = await boot(VIDEO);
  const g = pull(h, 200);
  assert.ok(g.moves.every((m) => m.defaultPrevented), 'every downward move at the top is claimed (the page cannot move under it)');
  assert.notStrictEqual(h.host.style.transform, '', 'the picture follows the finger');
  const end = fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(end.defaultPrevented, true, 'the claiming lift is not a tap');
  assert.strictEqual(h.p.getState(), 'docked');
  assert.deepStrictEqual(h.leaves, [{ state: 'docked' }], 'leave ran exactly once, AFTER the dock');
  await wait(420);
  assert.strictEqual(h.pauses(), 0, 'no phantom single-tap pause');
});

test('a short slow pull springs back: no dock, no leave, no pause, and the transform is gone after the snap', async () => {
  const h = await boot(VIDEO);
  const g = pull(h, 60);
  assert.notStrictEqual(h.host.style.transform, '', 'precondition: the drag moved the picture');
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(h.p.getState(), 'full');
  assert.strictEqual(h.leaves.length, 0);
  await wait(420);
  assert.strictEqual(h.host.style.transform, '', 'cleared after the snap');
  assert.strictEqual(h.pauses(), 0, 'the lift of a pull is not a tap');
});

test('a short FAST pull (a flick) docks', async () => {
  const h = await boot(VIDEO);
  const g = pull(h, 40, { stepMs: 10 });
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 5);
  assert.strictEqual(h.p.getState(), 'docked');
  assert.strictEqual(h.leaves.length, 1);
});

test('the threshold is 35% of the travel through the real wiring (just under snaps, just over docks)', async () => {
  const travel = travelOf();
  const under = Math.floor((travel * 0.35) / 10) * 10; // the last 10 px step at or under 35%
  const h = await boot(VIDEO);
  let g = pull(h, under - 10);
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(h.p.getState(), 'full', (under - 10) + ' of ' + travel + ' snaps');
  await wait(300);
  g = pull(h, under + 10);
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(h.p.getState(), 'docked', (under + 10) + ' of ' + travel + ' docks');
});

test('a touchcancel mid-pull always snaps', async () => {
  const h = await boot(VIDEO);
  pull(h, 300);
  fire(h.w, h.v, 'touchcancel', 200, 400);
  assert.strictEqual(h.p.getState(), 'full');
  assert.strictEqual(h.leaves.length, 0);
  await wait(420);
  assert.strictEqual(h.host.style.transform, '');
});

test('hold, then drag down: the 2x LOCKS and nothing minimizes (v1.358 unchanged)', async () => {
  const h = await boot(VIDEO);
  fire(h.w, h.v, 'touchstart', 200, 100, 1000);
  await wait(560);
  assert.strictEqual(h.v.playbackRate, 2, 'precondition: held');
  for (let d = 10; d <= 200; d += 10) fire(h.w, h.v, 'touchmove', 200, 100 + d, 1600 + d * 4);
  fire(h.w, h.v, 'touchend', 200, 300, 2500);
  assert.strictEqual(h.v.playbackRate, 2, 'locked');
  assert.strictEqual(h.p.getState(), 'full');
  assert.strictEqual(h.leaves.length, 0);
  assert.strictEqual(h.host.style.transform, '');
});

test('a tap still toggles and a double-tap still skips (no move, no claim)', async () => {
  const h = await boot(VIDEO);
  Object.defineProperty(h.v, 'duration', { value: 600, configurable: true });
  fire(h.w, h.v, 'touchstart', 200, 100, 1000);
  fire(h.w, h.v, 'touchend', 200, 100, 1050);
  await wait(420);
  assert.strictEqual(h.pauses(), 1, 'the single tap paused');
  h.v.currentTime = 100;
  fire(h.w, h.v, 'touchstart', 300, 100, 2000);
  fire(h.w, h.v, 'touchend', 300, 100, 2040);
  await wait(40); // the classifier needs a real gap (Date.now) between the two taps
  fire(h.w, h.v, 'touchstart', 300, 100, 2100);
  fire(h.w, h.v, 'touchend', 300, 100, 2140);
  assert.ok(h.v.currentTime > 100, 'skipped forward, got ' + h.v.currentTime);
  assert.strictEqual(h.p.getState(), 'full');
});

test('an UPWARD drag and a sideways drag are never claimed (the page scrolls; swipe-back keeps its gesture)', async () => {
  const h = await boot(VIDEO);
  fire(h.w, h.v, 'touchstart', 200, 200, 1000);
  const up = fire(h.w, h.v, 'touchmove', 200, 180, 1040);
  const up2 = fire(h.w, h.v, 'touchmove', 200, 150, 1080);
  const back = fire(h.w, h.v, 'touchmove', 200, 300, 1120); // turning down after an upward start: still not ours
  fire(h.w, h.v, 'touchend', 200, 300, 1160);
  assert.ok(!up.defaultPrevented && !up2.defaultPrevented && !back.defaultPrevented, 'not claimed');
  fire(h.w, h.v, 'touchstart', 100, 100, 2000);
  const side = fire(h.w, h.v, 'touchmove', 160, 110, 2040);
  const side2 = fire(h.w, h.v, 'touchmove', 160, 300, 2080);
  fire(h.w, h.v, 'touchend', 160, 300, 2120);
  assert.ok(!side.defaultPrevented && !side2.defaultPrevented, 'a gesture that went sideways first never becomes a minimize');
  assert.strictEqual(h.p.getState(), 'full');
  assert.strictEqual(h.leaves.length, 0);
});

test('scrolled down at touchstart (scrollY 40): the pull is never claimed, even past the threshold (R2b)', async () => {
  const h = await boot(VIDEO, { scrollY: 40 });
  const g = pull(h, 300);
  assert.ok(g.moves.every((m) => !m.defaultPrevented), 'the page scrolls exactly as today');
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(h.p.getState(), 'full');
  assert.strictEqual(h.leaves.length, 0);
});

test('never claims in faux full screen, the audio expanded view, native-controls mode, on a desktop form factor or off the watch view', async () => {
  const cases = [
    ['css-fullscreen', async () => { const h = await boot(VIDEO); h.host.classList.add('css-fullscreen'); return h; }],
    ['audio-expanded', async () => { const h = await boot(VIDEO); h.host.classList.add('audio-expanded'); return h; }],
    ['native-controls', async () => boot(VIDEO, { native: true })],
    ['desktop', async () => boot(VIDEO, { desktop: true })],
    ['music view', async () => boot(VIDEO, { view: 'music' })],
  ];
  for (const [name, mk] of cases) {
    const h = await mk();
    if (name === 'native-controls') assert.ok(h.host.classList.contains('native-controls'), 'precondition: native controls on');
    const g = pull(h, 300);
    assert.ok(g.moves.every((m) => !m.defaultPrevented), name + ': not claimed');
    fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
    assert.strictEqual(h.p.getState(), 'full', name + ': not docked');
    assert.strictEqual(h.leaves.length, 0, name + ': no leave');
    assert.strictEqual(h.host.style.transform, '', name + ': nothing moved');
    dom.window.close(); dom = null;
  }
});

test('the inline transform is gone after a commit, a close mid-drag and a new load mid-drag (one remover)', async () => {
  let h = await boot(VIDEO);
  let g = pull(h, 300);
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  await wait(450);
  assert.strictEqual(h.host.style.transform, '', 'after the commit settles');
  dom.window.close(); dom = null;

  h = await boot(VIDEO);
  pull(h, 120);
  assert.notStrictEqual(h.host.style.transform, '', 'precondition: mid-drag');
  h.p.close();
  assert.strictEqual(h.host.style.transform, '', 'close() clears it at once');
  dom.window.close(); dom = null;

  h = await boot(VIDEO);
  g = pull(h, 120);
  assert.notStrictEqual(h.host.style.transform, '', 'precondition: mid-drag');
  h.p.load(VIDEO2.id, VIDEO2, { slot: h.slot });
  assert.strictEqual(h.host.style.transform, '', 'a new load clears it at once');
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(h.leaves.length, 0, 'the stale gesture cannot commit after the load');
});

test('?minimizeAnim=0: the pull still claims and docks, but the picture never moves (R7), remembered for the tab; =1 clears it', async () => {
  let h = await boot(VIDEO, { query: '&minimizeAnim=0' });
  const g = pull(h, 300);
  assert.ok(g.moves.every((m) => m.defaultPrevented), 'still claimed');
  assert.strictEqual(h.host.style.transform, '', 'no live transform');
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(h.p.getState(), 'docked');
  assert.strictEqual(h.host.style.transform, '', 'no FLIP either');
  assert.strictEqual(h.w.sessionStorage.getItem('ft-minimize-anim'), '0', 'remembered for the tab');
  dom.window.close(); dom = null;
  h = await boot(VIDEO, { query: '&minimizeAnim=1' });
  assert.strictEqual(h.w.sessionStorage.getItem('ft-minimize-anim'), null);
});

// ---- W2: the chevron (R6) -----------------------------------------------------

test('the chevron is shown only where minimize is offered (paused, so the peek rule shows it): inline on the phone watch view; gone in faux full screen, docked, closed, off the watch view and past 768 px', async () => {
  let h = await boot(VIDEO);
  h.media(true); // v1.362.1 (D1): paused, so shown wherever minimize is offered
  const btn = () => h.host.querySelector('.player-minimize');
  assert.ok(btn(), 'built into the host');
  assert.strictEqual(btn().tagName, 'BUTTON');
  assert.strictEqual(btn().getAttribute('aria-label'), 'Minimize player');
  assert.ok(btn().querySelector('use').getAttribute('href') === '#i-expand_more', 'the sprite glyph');
  assert.strictEqual(btn().hidden, false, 'shown inline');
  h.doc.getElementById('fs-btn').click();
  assert.ok(h.host.classList.contains('css-fullscreen'), 'precondition: faux full screen through the real fs button');
  assert.strictEqual(btn().hidden, true, 'hidden in faux full screen');
  h.doc.getElementById('fs-btn').click();
  assert.ok(!h.host.classList.contains('css-fullscreen'), 'precondition: back inline');
  assert.strictEqual(btn().hidden, false, 'back when it exits');
  h.p.dock();
  assert.strictEqual(btn().hidden, true, 'hidden docked');
  h.p.expand(h.slot);
  assert.strictEqual(btn().hidden, false, 'back when expanded into the slot');
  h.w.matchMedia = () => ({ media: '', matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  h.w.dispatchEvent(new h.w.Event('resize'));
  assert.strictEqual(btn().hidden, true, 'a resize past 768 px (desktop form factor) hides it');
  h.p.close();
  assert.strictEqual(h.doc.querySelector('.player-minimize'), null, 'close detaches the host and the chevron with it');
  dom.window.close(); dom = null;
  h = await boot(VIDEO, { view: 'music' });
  h.media(true);
  assert.strictEqual(h.host.querySelector('.player-minimize').hidden, true, 'not on another view (M8)');
  dom.window.close(); dom = null;
  h = await boot(VIDEO, { native: true });
  h.media(true);
  assert.strictEqual(h.host.querySelector('.player-minimize').hidden, true, 'not in native-controls mode');
});

test('a chevron click runs the one commit path: docked, then leave once; a second click while docked does nothing', async () => {
  const h = await boot(VIDEO);
  const btn = h.host.querySelector('.player-minimize');
  let bubbled = 0;
  h.host.addEventListener('click', () => { bubbled++; });
  btn.click();
  assert.strictEqual(h.p.getState(), 'docked');
  assert.deepStrictEqual(h.leaves, [{ state: 'docked' }], 'docked first, then left once');
  assert.strictEqual(bubbled, 0, 'the click stops at the chevron (nothing under it hears it)');
  btn.click();
  assert.strictEqual(h.leaves.length, 1, 'no second commit while docked');
  const handler = PLAYER_SRC.slice(PLAYER_SRC.indexOf("minimizeBtn.addEventListener('click'"), PLAYER_SRC.indexOf('host.appendChild(minimizeBtn)'));
  assert.match(handler, /minimizeToDock\('button'\)/, 'the chevron calls the same minimizeToDock as the pull');
  assert.strictEqual((PLAYER_SRC.match(/leaveWatchForBrowse\(\)/g) || []).length, 1, 'one caller of the landing: minimizeToDock');
});

test('a touch that starts on the chevron never reaches the picture: no hold, no claim, no transform', async () => {
  const h = await boot(VIDEO);
  const btn = h.host.querySelector('.player-minimize');
  fire(h.w, btn, 'touchstart', 20, 20, 1000);
  const m = [];
  for (let d = 10; d <= 200; d += 10) m.push(fire(h.w, btn, 'touchmove', 20, 20 + d, 1000 + d * 4));
  await wait(600);
  fire(h.w, btn, 'touchend', 20, 220, 1900);
  assert.ok(m.every((e) => !e.defaultPrevented), 'not claimed');
  assert.strictEqual(h.host.style.transform, '');
  assert.strictEqual(h.v.playbackRate, 1, 'no hold engaged');
  assert.strictEqual(h.p.getState(), 'full');
  assert.strictEqual(h.leaves.length, 0);
});

// ---- W2: the mini player targets (M5 / R8), locked by value and order ---------

const CSS = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
// Every rule as {selector, body, media, at}: a brace walk with @media flattened (fails closed on a bad brace).
function cssRules(css) {
  const out = [];
  let i = 0;
  const walk = (end, media) => {
    while (i < end) {
      const open = css.indexOf('{', i);
      if (open === -1 || open >= end) { i = end; return; }
      const head = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (depth && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
      assert.strictEqual(depth, 0, 'balanced braces at ' + open);
      if (/^@media/.test(head)) { const save = i; i = open + 1; walk(j - 1, head.replace(/\s+/g, ' ')); i = j; void save; continue; }
      out.push({ selector: head.replace(/\s+/g, ' '), body: css.slice(open + 1, j - 1), media, at: open });
      i = j;
    }
  };
  walk(css.length, null);
  return out;
}
const RULES = cssRules(CSS);
const decl = (r, prop) => { const m = new RegExp('(?:^|;)\\s*' + prop.replace(/[-]/g, '\\-') + '\\s*:\\s*([^;]+)').exec(r.body); return m ? m[1].trim() : null; };
const one = (selector, media) => {
  const hits = RULES.filter((r) => r.selector === selector && r.media === media);
  assert.strictEqual(hits.length, 1, 'exactly one rule ' + selector + ' @ ' + media + ' (got ' + hits.length + ')');
  return hits[0];
};
const PHONE = '@media (max-width: 768px)';

test('M5 phone: the docked bar, the reserve and the art bottom are ONE value (--size-touch), after the 26 px base rules they override', () => {
  for (const [sel, prop] of [['#player-dock .player-controls', 'height'], ['#player-dock #player-wrapper', 'padding-bottom'], ['#player-dock #player-wrapper.audio-mode #audio-bg-art', 'bottom']]) {
    const base = one(sel, null);
    assert.strictEqual(decl(base, prop), '26px', 'desktop/base keeps 26px: ' + sel);
    const phone = one(sel, PHONE);
    assert.strictEqual(decl(phone, prop), 'var(--size-touch)', 'phone: ' + sel);
    assert.ok(phone.at > base.at, 'the phone override comes AFTER its base (equal specificity: order wins): ' + sel);
  }
});

test('M5 phone: play/pause keeps a 32 px face with a 44 px hit ring; the X is a 44 px box in the corner around a 32 px disc; desktop values untouched', () => {
  const ppBase = one('#player-dock .pc-btn', null);
  assert.strictEqual(decl(ppBase, 'width'), '22px');
  assert.strictEqual(decl(ppBase, 'height'), '22px');
  const pp = one('#player-dock #pp-btn', PHONE);
  assert.strictEqual(decl(pp, 'width'), 'var(--size-control-sm)');
  assert.strictEqual(decl(pp, 'height'), 'var(--size-control-sm)');
  assert.strictEqual(decl(pp, 'position'), 'relative');
  assert.ok(pp.at > ppBase.at, 'after the 22px base');
  const ring = one('#player-dock #pp-btn::after', PHONE);
  assert.strictEqual(decl(ring, 'inset'), 'calc((var(--size-control-sm) - var(--size-touch)) / 2)', 'the ring reaches 44px');
  assert.strictEqual(decl(ring, 'position'), 'absolute');
  const xBase = one('.player-dock-close', null);
  assert.strictEqual(decl(xBase, 'width'), '24px');
  assert.strictEqual(decl(xBase, 'top'), 'var(--space-2)', 'the desktop X stays 4px from the corner (a token since v1.362, same value)');
  const x = one('#player-dock .player-dock-close', PHONE);
  assert.strictEqual(decl(x, 'width'), 'var(--size-touch)');
  assert.strictEqual(decl(x, 'height'), 'var(--size-touch)');
  assert.strictEqual(decl(x, 'top'), '0');
  assert.strictEqual(decl(x, 'right'), '0');
  assert.match(decl(x, 'background'), /radial-gradient\(circle, var\(--scrim\) 0 calc\(var\(--size-control-sm\) \/ 2\)/, 'a plain painted disc');
  assert.ok(x.at > xBase.at);
});

test('R6: the chevron is a 44 px box with a painted 36 px disc and no filter, mask or blend on it', () => {
  const r = one('.ui-btn.player-minimize', null);
  assert.strictEqual(decl(r, 'width'), 'var(--size-touch)');
  assert.strictEqual(decl(r, 'height'), 'var(--size-touch)');
  assert.strictEqual(decl(r, 'position'), 'absolute');
  assert.match(decl(r, 'background'), /^radial-gradient\(circle, var\(--scrim\) 0 calc\(var\(--size-control\) \/ 2\)/);
  // ui.css gives every .ui-btn an ::after press layer whose opacity fades in; over the picture that is stop rule (d):
  // the chevron removes it (W2-M8 survived until this line existed).
  const press = one('.ui-btn.player-minimize::after', null);
  assert.strictEqual(decl(press, 'content'), 'none', 'no press layer fading over the picture');
  for (const rr of RULES.filter((q) => /player-minimize/.test(q.selector))) {
    assert.doesNotMatch(rr.body, /(filter|mask|mix-blend-mode|opacity)\s*:/i, rr.selector);
  }
});

test('one non-passive touchmove on the host and none on the document (LESSONS 4); the fetch-path history push carries the browse level (M7)', () => {
  assert.ok(!/document\.addEventListener\('touchmove'/.test(PLAYER_SRC), 'no document touchmove in player.js');
  assert.strictEqual((PLAYER_SRC.match(/host\.addEventListener\('touchmove'/g) || []).length, 1, 'one host touchmove');
  const nav = COMMON_SRC.slice(COMMON_SRC.indexOf('function navigate('), COMMON_SRC.indexOf('function handleDocumentClick'));
  assert.match(nav, /const state = buildHistoryState\(view, parsed\.href, 0, desiredDepth, null, browseDepthBehind\(window\.history\.state\)\);/,
    'a watch entry pushed by navigate() remembers the browse level it was opened from');
});

test('W3 (Dean 2026-10-04): while the finger pulls, the stage rises over the page below; the class is gone after the snap and after a commit', async () => {
  const r = one('.watch-player-stage:has(#player-wrapper.is-minimize-drag)', null);
  assert.strictEqual(decl(r, 'z-index'), '1');
  let h = await boot(VIDEO);
  let g = pull(h, 60);
  assert.ok(h.host.classList.contains('is-minimize-drag'), 'on while pulling');
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  await wait(420);
  assert.ok(!h.host.classList.contains('is-minimize-drag'), 'off after the snap');
  dom.window.close(); dom = null;
  h = await boot(VIDEO);
  g = pull(h, 300);
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.ok(!h.host.classList.contains('is-minimize-drag'), 'off once docked');
});

// ---- gate r1 fixes -------------------------------------------------------------

test('r1 (QA W2): resolveMinimizeLanding goes Home when the jump reaches past the session history the browser kept', () => {
  const r = common.resolveMinimizeLanding;
  assert.deepStrictEqual(r(55, 0, 50), { action: 'home' }, '55 steps, 50 entries kept (Chromium cap): go() would no-op');
  assert.deepStrictEqual(r(50, 0, 50), { action: 'home' }, 'steps = length: the oldest kept entry is the current one minus 49');
  assert.deepStrictEqual(r(49, 0, 50), { action: 'back', steps: 49 });
  assert.deepStrictEqual(r(3, 1, 6), { action: 'back', steps: 2 });
  assert.deepStrictEqual(r(3, 1), { action: 'back', steps: 2 }, 'no length known: unchanged');
});

// The REAL router (common.js booted in jsdom, the pocket-lighting-open-ask harness): leaveWatchForBrowse itself.
function routerWorld(state, length) {
  const rdom = new JSDOM('<!doctype html><html><body><div id="view-root" data-view="watch"></div></body></html>', { url: 'http://localhost/watch.html?v=b', runScripts: 'outside-only', pretendToBeVisual: true });
  const W = rdom.window;
  const fetches = [];
  const moves = [];
  W.fetch = (u) => { fetches.push(String(u)); return new Promise(() => {}); };
  W.eval(COMMON_SRC);
  W.document.dispatchEvent(new W.Event('DOMContentLoaded'));
  W.history.replaceState(Object.assign({ view: 'watch', url: '/watch.html?v=b', scrollY: 0, viewState: null }, state), '');
  W.history.go = (n) => { moves.push('go ' + n); };
  W.history.back = () => { moves.push('back'); };
  Object.defineProperty(W.history, 'length', { value: length, configurable: true });
  const pop = () => W.dispatchEvent(new W.PopStateEvent('popstate', { state: W.history.state }));
  return { W, fetches, moves, pop, close: () => W.close() };
}
// navigate('/') fetches the home view a microtask later (the fetch never lands here).
const homeFetches = (r) => r.fetches.filter((u) => /^http:\/\/localhost\/(\?|$)/.test(u)).length;

test('r1 (QA W3, adversary A1): the real leaveWatchForBrowse goes back past the watch entries ONCE, coalesces a second call until the popstate, and goes Home from a deep link or past the history cap', async () => {
  const worlds = [];
  try {
    const a = routerWorld({ depth: 3, browseDepth: 1 }, 6); worlds.push(a);
    assert.strictEqual(typeof a.W.FileTube.leaveWatchForBrowse, 'function', 'exposed on window.FileTube');
    a.W.FileTube.leaveWatchForBrowse();
    assert.deepStrictEqual(a.moves, ['go -2'], 'back two levels in one jump (never back() one level: M7 over M6)');
    a.W.FileTube.leaveWatchForBrowse();
    assert.deepStrictEqual(a.moves, ['go -2'], 'a second call before the popstate never pops again (two fast commits, or a minimize plus a swipe-back on one lift)');
    await wait(20);
    assert.strictEqual(homeFetches(a), 0, 'no Home push either');
    a.pop();
    a.W.history.replaceState(Object.assign({}, a.W.history.state, { depth: 3, browseDepth: 1, view: 'watch' }), '');
    a.W.FileTube.leaveWatchForBrowse();
    assert.deepStrictEqual(a.moves, ['go -2', 'go -2'], 'the popstate released the coalescing guard');

    const b = routerWorld({ depth: 0, browseDepth: null }, 1); worlds.push(b);
    b.W.FileTube.leaveWatchForBrowse();
    await wait(20);
    assert.deepStrictEqual(b.moves, [], 'a deep link never walks history (it could leave the app)');
    assert.strictEqual(homeFetches(b), 1, 'it navigates to a fresh Home');

    const c = routerWorld({ depth: 55, browseDepth: 0 }, 50); worlds.push(c);
    c.W.FileTube.leaveWatchForBrowse();
    await wait(20);
    assert.deepStrictEqual(c.moves, [], 'past the cap: no silent no-op go()');
    assert.strictEqual(homeFetches(c), 1, 'Home instead');
    c.W.history.replaceState(Object.assign({}, c.W.history.state, { depth: 3, browseDepth: 1, view: 'watch' }), '');
    c.W.FileTube.leaveWatchForBrowse();
    assert.deepStrictEqual(c.moves, ['go -2'], 'and the guard was never left set (Home and minimize still work after)');
  } finally { for (const w of worlds) w.close(); }
});

test('r1 (adversary A2): no history writer in public/js replaces the router state with null (a search chip erased depth and browseDepth)', () => {
  for (const f of fs.readdirSync(path.join(PUB, 'js')).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(PUB, 'js', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/history\.replaceState\(\s*null\b/.test(src), f + ' replaces history state with null');
  }
  const main = fs.readFileSync(path.join(PUB, 'js', 'main.js'), 'utf8');
  assert.match(main, /const prev = history\.state;\s*history\.replaceState\(prev && typeof prev === 'object' \? Object\.assign\(\{\}, prev, \{ url: u\.pathname \+ u\.search \}\) : prev, '', u\);/, 'the chip carries the entry forward with its new url');
});

function evN(w, type, pts) {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'touches', { value: pts.map(([x, y]) => ({ clientX: x, clientY: y })) });
  Object.defineProperty(e, 'changedTouches', { value: [{ clientX: pts[0][0], clientY: pts[0][1] }] });
  return e;
}

test('r1 (adversary A3): a claim cancels the armed hold, so 2x never starts under a pull', async () => {
  const h = await boot(VIDEO);
  fire(h.w, h.v, 'touchstart', 200, 100, 1000);
  fire(h.w, h.v, 'touchmove', 200, 114, 1040); // past the 12 px claim, under MOVE_TOL (16): only the claim cancels the hold
  assert.notStrictEqual(h.host.style.transform, '', 'precondition: claimed');
  await wait(650);
  assert.strictEqual(h.v.playbackRate, 1, 'no 2x under the pull');
  fire(h.w, h.v, 'touchend', 200, 114, 1700);
});

test('r1 (adversary A3): a finished gesture leaves nothing live: a later drag that starts on the control bar is not a pull', async () => {
  const h = await boot(VIDEO);
  fire(h.w, h.v, 'touchstart', 200, 100, 1000);
  fire(h.w, h.v, 'touchend', 200, 100, 1040);
  const bar = h.doc.getElementById('player-controls') || h.host.querySelector('.player-controls');
  assert.ok(bar && h.host.contains(bar), 'the bar is inside the host');
  const m = [];
  for (let d = 10; d <= 200; d += 10) { const e = ev(h.w, 'touchmove', 200, 100 + d, 1100 + d); bar.dispatchEvent(e); m.push(e); }
  assert.ok(m.every((e) => !e.defaultPrevented), 'not claimed');
  assert.strictEqual(h.host.style.transform, '');
  await wait(420);
});

test('r1 (adversary A3): a second finger (on touchstart or touchmove) springs the pull back; a resize, a rotate and a new finger during the spring-back clear at once', async () => {
  let h = await boot(VIDEO);
  pull(h, 120);
  h.v.dispatchEvent(evN(h.w, 'touchstart', [[200, 220], [100, 100]]));
  await wait(420);
  assert.strictEqual(h.host.style.transform, '', 'second finger at touchstart: sprung back');
  fire(h.w, h.v, 'touchend', 200, 220, 5000);
  assert.strictEqual(h.p.getState(), 'full');
  dom.window.close(); dom = null;

  h = await boot(VIDEO);
  pull(h, 120);
  h.v.dispatchEvent(evN(h.w, 'touchmove', [[200, 230], [100, 100]]));
  await wait(420);
  assert.strictEqual(h.host.style.transform, '', 'second finger on a move: sprung back');
  fire(h.w, h.v, 'touchend', 200, 400, 5000);
  assert.strictEqual(h.p.getState(), 'full', 'and the lift cannot commit it');
  dom.window.close(); dom = null;

  for (const t of ['resize', 'orientationchange']) {
    h = await boot(VIDEO);
    pull(h, 120);
    h.w.dispatchEvent(new h.w.Event(t));
    assert.strictEqual(h.host.style.transform, '', t + ' clears at once');
    fire(h.w, h.v, 'touchend', 200, 400, 5000);
    assert.strictEqual(h.p.getState(), 'full', t + ': no commit after');
    dom.window.close(); dom = null;
  }

  h = await boot(VIDEO);
  const g = pull(h, 60);
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.ok(h.host.classList.contains('is-minimize-snap'), 'precondition: springing back');
  fire(h.w, h.v, 'touchstart', 200, 100, g.t + 30);
  assert.ok(!h.host.classList.contains('is-minimize-snap'), 'a new finger ends the spring at once');
  assert.strictEqual(h.host.style.transform, '');
});

test('r1 (adversary A3): the commit settle opens the dock clip only while it runs, then clears host and dock', async () => {
  const h = await boot(VIDEO);
  const g = pull(h, 300);
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.ok(h.dockEl.classList.contains('is-minimize-settle'), 'precondition: the settle runs (dock unclipped)');
  assert.ok(h.host.classList.contains('is-minimize-settle'));
  await wait(450);
  assert.ok(!h.dockEl.classList.contains('is-minimize-settle'), 'the dock clips again');
  assert.ok(!h.host.classList.contains('is-minimize-settle'));
  assert.strictEqual(h.host.style.transformOrigin, '');
});

test('r1 (adversary suggestion, deviation 1): a 2x LOCK left by an earlier gesture does not block a later pull', async () => {
  const h = await boot(VIDEO);
  fire(h.w, h.v, 'touchstart', 200, 100, 1000);
  await wait(560);
  fire(h.w, h.v, 'touchmove', 200, 130, 1600);
  fire(h.w, h.v, 'touchmove', 200, 160, 1640);
  fire(h.w, h.v, 'touchend', 200, 160, 1680);
  assert.strictEqual(h.v.playbackRate, 2, 'precondition: locked');
  await wait(40);
  const g = pull(h, 300);
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(h.p.getState(), 'docked', 'the later pull minimizes');
});

test('r1 (QA W4): a coarse-pointer device wider than 768 px gets no chevron and no pull (the width conjunct alone)', async () => {
  const h = await boot(VIDEO);
  h.media(true); // v1.362.1: paused, so the chevron shows wherever minimize is offered (the width conjunct alone hides it)
  const btn = h.host.querySelector('.player-minimize');
  assert.strictEqual(btn.hidden, false, 'precondition');
  h.w.matchMedia = (q) => ({ media: q, matches: /coarse|hover: none/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  h.w.dispatchEvent(new h.w.Event('resize'));
  assert.strictEqual(btn.hidden, true, 'hidden past 768 px with touch still on');
  const g = pull(h, 300);
  assert.ok(g.moves.every((m) => !m.defaultPrevented), 'not claimed');
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(h.p.getState(), 'full');
});

test('r1 (QA W4): the audio expanded view hides the chevron and collapsing brings it back (an audio file on the watch page)', async () => {
  const h = await boot({ id: 'a1', title: 'A', type: 'audio', ext: '.mp3', hasThumbnail: true });
  assert.ok(h.host.classList.contains('audio-mode'), 'precondition: audio mode (cover art)');
  h.media(true); // v1.362.1: paused, so shown
  const btn = h.host.querySelector('.player-minimize');
  assert.strictEqual(btn.hidden, false, 'precondition: shown inline for an audio file');
  h.doc.getElementById('fs-btn').click();
  assert.ok(h.host.classList.contains('audio-expanded'), 'precondition: expanded through the real fs button');
  assert.strictEqual(btn.hidden, true, 'hidden while expanded');
  h.doc.getElementById('fs-btn').click();
  assert.ok(!h.host.classList.contains('audio-expanded'));
  assert.strictEqual(btn.hidden, false, 'back after collapsing');
});

test('r1 (QA W1, adversary A3): the phone captions sit on the 44 px bar (after their base), and the play/pause ring is a real box', () => {
  const base = one('#player-dock .cc-overlay', null);
  assert.strictEqual(decl(base, 'bottom'), '26px');
  const phone = one('#player-dock .cc-overlay', PHONE);
  assert.strictEqual(decl(phone, 'bottom'), 'var(--size-touch)');
  assert.ok(phone.at > base.at, 'after its base');
  const ring = one('#player-dock #pp-btn::after', PHONE);
  assert.strictEqual(decl(ring, 'content'), "''", 'without content the ring does not exist (probe: 214 points, 32 x 32)');
});

// ---- v1.362.1: the chevron peeks (plan 2026-10-04-chevron-peek-and-vpn-runbook, D1-D4) -----------

const SHOW = { allowed: true, paused: false, now: 1000, peekUntil: 0, focused: false };
test('minimizeChevronShownDecision: allowed AND (paused OR inside the peek window OR focused); each conjunct flipped alone', () => {
  const d = player.minimizeChevronShownDecision;
  assert.strictEqual(typeof d, 'function', 'exported');
  assert.strictEqual(player.MINIMIZE_PEEK_MS, 3000, 'the peek window is 3 s (one named constant)');
  assert.strictEqual(d(SHOW), false, 'playing, no window, not focused: hidden');
  assert.strictEqual(d(Object.assign({}, SHOW, { paused: true })), true, 'paused (or not started): shown');
  assert.strictEqual(d(Object.assign({}, SHOW, { peekUntil: 1001 })), true, 'inside the window: shown');
  assert.strictEqual(d(Object.assign({}, SHOW, { peekUntil: 1000 })), false, 'the window has ended at its edge');
  assert.strictEqual(d(Object.assign({}, SHOW, { focused: true })), true, 'a focused chevron stays');
  for (const k of ['paused', 'focused']) assert.strictEqual(d(Object.assign({}, SHOW, { allowed: false, [k]: true })), false, 'never where minimize is not offered (' + k + ')');
  assert.strictEqual(d(Object.assign({}, SHOW, { allowed: false, peekUntil: 9999 })), false, 'never where minimize is not offered (window)');
  assert.strictEqual(d({}), false);
  assert.strictEqual(d(Object.assign({}, SHOW, { now: NaN, peekUntil: 5000 })), false, 'no clock: no window');
});

// The peek window is shortened for the drives (the real one is the 3000 asserted above).
const PEEK = 150;
const bootPeek = (item, o) => boot(item, Object.assign({ peekMs: PEEK }, o || {}));
const chev = (h) => h.host.querySelector('.player-minimize');

test('D1: paused shows it; play shows it for the window, then it hides at once; a pause brings it back', async () => {
  const h = await bootPeek(VIDEO);
  h.media(true);
  assert.strictEqual(chev(h).hidden, false, 'paused: shown');
  h.media(false);
  assert.strictEqual(chev(h).hidden, false, 'just after play: shown (the window)');
  await wait(PEEK / 2);
  assert.strictEqual(chev(h).hidden, false, 'still inside the window');
  await wait(PEEK);
  assert.strictEqual(chev(h).hidden, true, 'the window closed while playing: hidden');
  h.media(true);
  assert.strictEqual(chev(h).hidden, false, 'paused again: shown at once');
});

test('D1: a touch on the picture while playing shows it for the window, and the tap still pauses', async () => {
  const h = await bootPeek(VIDEO);
  h.media(false);
  await wait(PEEK * 1.6);
  assert.strictEqual(chev(h).hidden, true, 'precondition: hidden while playing');
  fire(h.w, h.v, 'touchstart', 200, 100, 1000);
  assert.strictEqual(chev(h).hidden, false, 'the touch shows it at once');
  fire(h.w, h.v, 'touchend', 200, 100, 1050);
  await wait(420); // past the double-tap window (the single tap is debounced)
  assert.strictEqual(h.pauses(), 1, 'the single tap still paused (the peek changes nothing about the tap)');
  assert.strictEqual(h.p.getState(), 'full');
  assert.strictEqual(h.leaves.length, 0, 'a tap is never a minimize');
});

test('D1: every touch re-arms the window (the touch on the picture and on the chevron itself)', async () => {
  const h = await bootPeek(VIDEO);
  h.media(false);
  await wait(PEEK * 0.6);
  fire(h.w, h.v, 'touchstart', 200, 100, 1000);
  fire(h.w, h.v, 'touchmove', 230, 100, 1020); // a moved touch: no tap
  fire(h.w, h.v, 'touchend', 230, 100, 1040);
  await wait(PEEK * 0.6);
  assert.strictEqual(chev(h).hidden, false, 'the picture touch re-armed it (the first window would have ended)');
  fire(h.w, chev(h), 'touchstart', 20, 20, 2000);
  fire(h.w, chev(h), 'touchend', 20, 20, 2010);
  await wait(PEEK * 0.6);
  assert.strictEqual(chev(h).hidden, false, 'the touch on the chevron re-armed it');
  await wait(PEEK);
  assert.strictEqual(chev(h).hidden, true, 'then it goes');
});

test('D1: the touch on the cover art (an audio file on the watch page) peeks too', async () => {
  const h = await bootPeek({ id: 'a1', title: 'A', type: 'audio', ext: '.mp3', hasThumbnail: true });
  h.media(false);
  await wait(PEEK * 1.6);
  assert.strictEqual(chev(h).hidden, true, 'precondition: hidden while playing');
  const art = h.doc.getElementById('audio-bg-art');
  fire(h.w, art, 'touchstart', 200, 100, 1000);
  assert.strictEqual(chev(h).hidden, false);
  fire(h.w, art, 'touchcancel', 200, 100, 1010);
});

test('D1: a focused chevron stays up while playing, and goes on blur', async () => {
  const h = await bootPeek(VIDEO);
  h.media(false);
  chev(h).focus();
  assert.strictEqual(h.doc.activeElement, chev(h), 'precondition: focused (a keyboard user)');
  await wait(PEEK * 1.6);
  assert.strictEqual(chev(h).hidden, false, 'focused: still shown after the window');
  chev(h).blur();
  assert.strictEqual(chev(h).hidden, true, 'blurred while playing: hidden at once');
});

test('D1/D3: no peek where minimize is not offered, and the timer never re-shows it after a dock, a close or a new item', async () => {
  let h = await bootPeek(VIDEO);
  h.media(false);
  h.doc.getElementById('fs-btn').click();
  assert.ok(h.host.classList.contains('css-fullscreen'), 'precondition: faux full screen');
  fire(h.w, h.v, 'touchstart', 200, 100, 1000);
  fire(h.w, h.v, 'touchcancel', 200, 100, 1010);
  assert.strictEqual(chev(h).hidden, true, 'faux full screen: a touch never shows it');
  h.media(true);
  assert.strictEqual(chev(h).hidden, true, 'faux full screen: paused never shows it');
  h.doc.getElementById('fs-btn').click();
  h.media(false);
  assert.strictEqual(chev(h).hidden, false, 'precondition: a window is open inline');
  h.p.dock();
  assert.strictEqual(chev(h).hidden, true, 'docked: hidden');
  h.p.expand(h.slot);
  assert.strictEqual(chev(h).hidden, true, 'expanded again inside the old window, still playing: the dock ended the window');
  await wait(PEEK * 1.6);
  assert.strictEqual(chev(h).hidden, true, 'and no stale timer re-shows it');
  h.p.dock();
  h.media(false); // playback (re)starts while docked
  h.p.expand(h.slot);
  assert.strictEqual(chev(h).hidden, true, 'a play while docked opens no window for a later expand (W1-M8)');
  h.media(false);
  assert.strictEqual(chev(h).hidden, false, 'precondition: a new window');
  assert.strictEqual(h.p.load(VIDEO2.id, VIDEO2, { slot: h.slot }), true, 'a new item loads');
  Object.defineProperty(h.v, 'paused', { value: false, configurable: true });
  h.w.dispatchEvent(new h.w.Event('resize')); // any refresh
  assert.strictEqual(chev(h).hidden, true, 'the new item does not inherit the old window');
  dom.window.close(); dom = null;
  h = await bootPeek(VIDEO, { native: true });
  h.media(true);
  assert.strictEqual(chev(h).hidden, true, 'native-controls mode: never, even paused');
  dom.window.close(); dom = null;
  h = await bootPeek(VIDEO, { desktop: true });
  h.media(true);
  assert.strictEqual(chev(h).hidden, true, 'desktop: never, even paused');
});

test('D2: refreshMinimizeButton stays the ONE writer of the chevron\'s hidden, and nothing fades it (LESSONS 7)', () => {
  const src = PLAYER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.strictEqual((src.match(/minimizeBtn\.hidden\s*=/g) || []).length, 1, 'one write of hidden');
  assert.ok(!/minimizeBtn\.(style|classList)/.test(src), 'no style or class write on the chevron (no fade, no paint)');
  const fn = src.slice(src.indexOf('function refreshMinimizeButton'), src.indexOf('function playMinimizeSettle'));
  assert.match(fn, /minimizeBtn\.hidden = !minimizeChevronShownDecision\(/, 'the writer asks the pure decision');
  // D4 (W1-M11, a source lock: jsdom cannot reach the background-audio state): paused is read from the
  // element that is playing, never the video alone (after a handoff the video is paused while the sidecar plays).
  assert.match(fn, /var el = activeMediaElement\(\);[\s\S]*paused: !el \|\| !!el\.paused,/, 'paused from activeMediaElement()');
});
// ---- v1.362.1 D5: the landing's reachable depth (the Navigation API) --------------------------------

test('D5: resolveMinimizeLanding goes Home iff the jump reaches past the entries history.go can reach (navigation.currentEntry.index)', () => {
  const r = common.resolveMinimizeLanding;
  assert.deepStrictEqual(r(46, 0, 50, 34), { action: 'home' }, 'the adversary\'s case: depth 46 after 15 backs from 61, 34 reachable');
  assert.deepStrictEqual(r(46, 0, 50, 46), { action: 'back', steps: 46 }, 'exactly reachable');
  assert.deepStrictEqual(r(46, 0, 50, 45), { action: 'home' }, 'one short');
  assert.deepStrictEqual(r(49, 0, 50, 49), { action: 'back', steps: 49 });
  assert.deepStrictEqual(r(3, 1, 50, 2), { action: 'back', steps: 2 }, 'a reachable index decides even when the length would too');
  assert.deepStrictEqual(r(3, 1, 3, 5), { action: 'back', steps: 2 }, 'the index decides over the length when it is known');
  assert.deepStrictEqual(r(55, 0, 50, undefined), { action: 'home' }, 'no Navigation API (Safari): the length rule stands');
  assert.deepStrictEqual(r(49, 0, 50, undefined), { action: 'back', steps: 49 });
  assert.deepStrictEqual(r(49, 0, 50, 2.5), { action: 'back', steps: 49 }, 'a non-integer index is ignored');
  assert.deepStrictEqual(r(49, 0, 50, -1), { action: 'home' }, 'index -1 (no entry): nothing is reachable');
  assert.deepStrictEqual(r(0, null, 50, 10), { action: 'home' }, 'a deep link');
});

test('D5: the real leaveWatchForBrowse passes navigation.currentEntry.index (Home when the jump is out of reach), and falls back to the length without it', async () => {
  const worlds = [];
  try {
    const a = routerWorld({ depth: 46, browseDepth: 0 }, 50); worlds.push(a);
    Object.defineProperty(a.W, 'navigation', { value: { currentEntry: { index: 34 } }, configurable: true });
    a.W.FileTube.leaveWatchForBrowse();
    await wait(20);
    assert.deepStrictEqual(a.moves, [], 'no silent no-op go(-46)');
    assert.strictEqual(homeFetches(a), 1, 'Home instead');
    a.W.history.replaceState(Object.assign({}, a.W.history.state, { depth: 3, browseDepth: 1, view: 'watch' }), '');
    a.W.FileTube.leaveWatchForBrowse();
    assert.deepStrictEqual(a.moves, ['go -2'], 'the guard was never left set (the Home button still works after)');

    const b = routerWorld({ depth: 46, browseDepth: 0 }, 50); worlds.push(b);
    Object.defineProperty(b.W, 'navigation', { value: { currentEntry: { index: 46 } }, configurable: true });
    b.W.FileTube.leaveWatchForBrowse();
    assert.deepStrictEqual(b.moves, ['go -46'], 'reachable: back to the browse entry');

    const c = routerWorld({ depth: 49, browseDepth: 0 }, 50); worlds.push(c);
    Object.defineProperty(c.W, 'navigation', { value: undefined, configurable: true });
    c.W.FileTube.leaveWatchForBrowse();
    assert.deepStrictEqual(c.moves, ['go -49'], 'no Navigation API: the v1.362.0 length rule');

    const d = routerWorld({ depth: 49, browseDepth: 0 }, 50); worlds.push(d);
    Object.defineProperty(d.W, 'navigation', { value: { currentEntry: null }, configurable: true });
    d.W.FileTube.leaveWatchForBrowse();
    assert.deepStrictEqual(d.moves, ['go -49'], 'no current entry: the length rule');
  } finally { for (const w of worlds) w.close(); }
});

// ---- v1.362.1 D6: the two untested wires (v1.362 gate r2 (b), (c)) ---------------------------------

test('D6 (b): the real picture-in-picture listeners hide the chevron on enter and bring it back on leave', async () => {
  const h = await boot(VIDEO);
  h.media(true);
  assert.strictEqual(chev(h).hidden, false, 'precondition: shown (paused, inline)');
  let pip = h.v;
  Object.defineProperty(h.doc, 'pictureInPictureElement', { get: () => pip, configurable: true });
  h.v.dispatchEvent(new h.w.Event('enterpictureinpicture'));
  assert.strictEqual(chev(h).hidden, true, 'in picture-in-picture: hidden');
  pip = null;
  h.v.dispatchEvent(new h.w.Event('leavepictureinpicture'));
  assert.strictEqual(chev(h).hidden, false, 'back inline: shown');
});

test('D6 (c): the settle opens the dock clip by value (overflow visible, no shadow)', () => {
  const r = one('#player-dock.is-minimize-settle', null);
  assert.strictEqual(decl(r, 'overflow'), 'visible');
  assert.strictEqual(decl(r, 'box-shadow'), 'none');
});
