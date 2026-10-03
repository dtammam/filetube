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
  w.eval(PLAYER_SRC);
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
  return { w, doc: w.document, p, v, host, slot, dockEl, leaves, pauses: () => pauses };
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
