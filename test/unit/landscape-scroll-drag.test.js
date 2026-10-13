'use strict';

// [UNIT] v1.390.0 D2 (plan 2026-10-13-landscape-scroll): on a phone held SIDEWAYS a one-finger drag that starts on the
// picture scrolls the watch page (the loupe cancel takes the browser's own scroll from it), with a glide after the lift.
// The pure decisions are bound by invocation; then the REAL player.js is driven through its real touch listeners (the
// surface's AND the host's one non-passive touchmove) in a jsdom watch shell, so a decision that is right but never
// reached by a gesture cannot pass (LESSONS 2, inert feature). The minimize-player harness shape, with a scrolling page
// (a clamped scrollTo, a scroll range) and a hand-stepped requestAnimationFrame.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const player = require('../../public/js/player.js');

const PUB = path.join(__dirname, '..', '..', 'public');
const LOCK_SRC = fs.readFileSync(path.join(PUB, 'js', 'body-scroll-lock.js'), 'utf8');
const COMMON_SRC = fs.readFileSync(path.join(PUB, 'js', 'common.js'), 'utf8');
const PLAYER_SRC = fs.readFileSync(path.join(PUB, 'js', 'player.js'), 'utf8');
const WATCH = fs.readFileSync(path.join(PUB, 'watch.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

// ---- pure ---------------------------------------------------------------------

const ALLOWED = { stateFull: true, inSlot: true, watchView: true, cssFullscreen: false, audioExpanded: false, nativeFullscreen: false, nativeControls: false, mobile: true, landscape: true, bodyLocked: false };

test('pictureScrollAllowedDecision: true only for the phone inline watch player, sideways, page not locked; each conjunct flipped alone refuses', () => {
  const d = player.pictureScrollAllowedDecision;
  assert.strictEqual(typeof d, 'function', 'exported');
  assert.strictEqual(d(ALLOWED), true);
  for (const k of Object.keys(ALLOWED)) assert.strictEqual(d(Object.assign({}, ALLOWED, { [k]: !ALLOWED[k] })), false, 'flipping ' + k + ' alone must refuse');
  assert.strictEqual(d(), false);
  assert.strictEqual(d({}), false);
});

test('pictureScrollDragDecision: claim past the tap tolerance when mostly vertical (either way); sideways-first, a hold and a minimize claim drop it', () => {
  const d = player.pictureScrollDragDecision;
  assert.strictEqual(typeof d, 'function', 'exported');
  const at = (dx, dy, extra) => d(Object.assign({ dx, dy, moveTol: 16, holdActive: false, minimizeOwns: false }, extra || {}));
  assert.strictEqual(at(0, -17), 'claim', 'up');
  assert.strictEqual(at(0, 17), 'claim', 'down');
  assert.strictEqual(at(0, -16), 'wait', 'inside the tolerance (16 is not past it)');
  assert.strictEqual(at(5, -16), 'wait');
  assert.strictEqual(at(10, -17), 'claim', '17 > 1.5 * 10');
  assert.strictEqual(at(12, -17), 'wait', 'not dominant yet, sideways still inside the tolerance');
  assert.strictEqual(at(17, -17), 'drop', 'sideways past the tolerance and not vertical: never a scroll');
  assert.strictEqual(at(40, 5), 'drop', 'a horizontal swipe is not hijacked');
  assert.strictEqual(at(0, -40, { holdActive: true }), 'drop', 'a hold owns the drag');
  assert.strictEqual(at(0, 40, { minimizeOwns: true }), 'drop', 'the minimize pull owns a drag it claimed');
  assert.strictEqual(at(NaN, -40), 'drop');
  assert.strictEqual(d(), 'drop');
  // disjoint from a swipe back over a grid: a claim is never also a swipe-back claim
  const common = require('../../public/js/common.js');
  let claims = 0, backs = 0;
  for (let dx = -200; dx <= 200; dx += 2) {
    for (let dy = -200; dy <= 200; dy += 2) {
      const s = at(dx, dy) === 'claim', b = common.swipeBackShouldClaim(dx, dy);
      if (s) claims++;
      if (b) backs++;
      assert.ok(!(s && b), 'dx ' + dx + ' dy ' + dy + ' is both a scroll and a swipe-back claim');
    }
  }
  assert.ok(claims > 2000 && backs > 2000, 'the grid exercises both regions (' + claims + ' scroll, ' + backs + ' back)');
});

test('pictureScrollGlideDecision: a glide only from a real release velocity; none for a rested finger, NaN or reduced motion', () => {
  const d = player.pictureScrollGlideDecision;
  assert.strictEqual(typeof d, 'function', 'exported');
  assert.strictEqual(d({ velocityPxPerMs: 1.2 }), 1.2);
  assert.strictEqual(d({ velocityPxPerMs: -1.2 }), -1.2, 'either way');
  assert.strictEqual(d({ velocityPxPerMs: player.SCROLL_GLIDE_MIN_V }), player.SCROLL_GLIDE_MIN_V, 'the floor itself glides');
  assert.strictEqual(d({ velocityPxPerMs: player.SCROLL_GLIDE_MIN_V - 0.01 }), 0);
  assert.strictEqual(d({ velocityPxPerMs: NaN }), 0, 'the finger rested before it lifted');
  assert.strictEqual(d({ velocityPxPerMs: 2, reducedMotion: true }), 0, 'no glide under reduced motion');
  assert.strictEqual(d(), 0);
  assert.ok(player.SCROLL_GLIDE_STOP_V < player.SCROLL_GLIDE_MIN_V && player.SCROLL_GLIDE_FRICTION > 0 && player.SCROLL_GLIDE_FRICTION < 1);
});

// ---- behaviour: the real gesture in jsdom --------------------------------------

let dom = null;
afterEach(() => { if (dom) { dom.window.close(); dom = null; } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// o.landscape (default true), o.narrow (<= 768 wide: the minimize pull is offered), o.scrollY (start), o.max (scroll range),
// o.reduced (prefers-reduced-motion), o.desktop. The page scrolls through a clamped window.scrollTo like a browser's.
async function boot(item, o) {
  const opt = Object.assign({ landscape: true, narrow: false, scrollY: 0, max: 1000 }, o || {});
  // v1.389.0: a video LOADED while the phone is sideways opens in the faux fullscreen. The watch page Dean scrolls is the
  // one after he leaves it (or after a rotate), so the player loads upright here and the phone turns sideways after.
  const sideways = opt.landscape;
  opt.landscape = false;
  const url = 'http://localhost/watch.html?v=' + item.id;
  dom = new JSDOM(WATCH, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'platform', { value: opt.desktop ? 'Win32' : 'iPhone' });
  w.matchMedia = (q) => {
    let matches = false;
    if (!opt.desktop) {
      if (/coarse|hover: none/.test(q)) matches = true;
      else if (/max-width/.test(q)) matches = opt.narrow;
      else if (/orientation: landscape/.test(q)) matches = opt.landscape;
      else if (/prefers-reduced-motion/.test(q)) matches = !!opt.reduced;
    }
    return { media: q, matches, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
  };
  Object.defineProperty(w, 'innerHeight', { value: 390, configurable: true });
  Object.defineProperty(w, 'innerWidth', { value: opt.narrow ? 667 : 844, configurable: true });
  Object.defineProperty(w.document.documentElement, 'scrollHeight', { value: 390 + opt.max, configurable: true });
  const page = { y: opt.scrollY, calls: [] };
  const setY = (y) => { page.y = y; Object.defineProperty(w, 'pageYOffset', { value: y, configurable: true }); Object.defineProperty(w, 'scrollY', { value: y, configurable: true }); };
  setY(opt.scrollY);
  w.scrollTo = (x, y) => { const c = opt.rawScroll ? y : Math.min(opt.max, Math.max(0, y)); page.calls.push(y); setY(c); }; // clamps like a browser (rawScroll: records what it was ASKED for)
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ mobileCustomPlayer: true }), text: async () => '' });
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.document.body.setAttribute('data-view', opt.view || 'watch');
  w.eval(COMMON_SRC.slice(COMMON_SRC.indexOf('function resolveAudioArtUrl('), COMMON_SRC.indexOf('\n}\n', COMMON_SRC.indexOf('function resolveAudioArtUrl(')) + 3));
  w.eval(LOCK_SRC);
  w.eval(PLAYER_SRC);
  const leaves = [];
  w.FileTube.leaveWatchForBrowse = () => { leaves.push(1); };
  const dockEl = w.document.getElementById('player-dock');
  dockEl.style.right = '8px'; dockEl.style.bottom = '80px'; dockEl.style.width = '160px'; dockEl.style.setProperty('--size-touch', '44px');
  const slot = w.document.createElement('div'); slot.id = 'player-slot'; w.document.body.appendChild(slot);
  const p = w.FileTube.player;
  assert.strictEqual(p.load(item.id, item, { slot }), true, 'the real player loaded the item');
  await wait(60);
  opt.landscape = sideways;
  assert.ok(!w.document.getElementById('player-wrapper').classList.contains('css-fullscreen'), 'precondition: the inline player, not the faux full screen');
  const v = w.document.getElementById('media-player');
  const host = w.document.getElementById('player-wrapper');
  Object.defineProperty(v, 'paused', { value: false, configurable: true });
  const rect = { left: 0, top: 0, x: 0, y: 0, width: 413, height: 273, right: 413, bottom: 273 };
  v.getBoundingClientRect = () => rect;
  host.getBoundingClientRect = () => (host.parentNode === slot ? rect : { left: 600, top: 300, x: 600, y: 300, width: 160, height: 134, right: 760, bottom: 434 });
  let pauses = 0; v.pause = () => { pauses++; };
  // the glide's frames are stepped by hand: rAF queues, frame(ms) runs the queued callbacks at that clock
  const queue = [];
  w.requestAnimationFrame = (fn) => { queue.push(fn); return queue.length; };
  w.cancelAnimationFrame = (id) => { queue[id - 1] = null; };
  let clock = 5000;
  const frame = (ms) => { clock += ms; const fns = queue.splice(0); fns.forEach((fn) => { if (fn) fn(clock); }); return fns.filter(Boolean).length; };
  const frames = (n, ms) => { let ran = 0; for (let i = 0; i < n; i++) { const r = frame(ms || 16); ran += r; if (!r) break; } return ran; };
  return { w, doc: w.document, p, v, host, slot, dockEl, leaves, page, pauses: () => pauses, frame, frames, pending: () => queue.filter(Boolean).length, setY };
}
const VIDEO = { id: 'v1', title: 'T', type: 'video', ext: '.mp4' };

function ev(w, type, x, y, stamp) {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  const list = [{ clientX: x, clientY: y }];
  Object.defineProperty(e, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : list });
  Object.defineProperty(e, 'changedTouches', { value: list });
  if (stamp !== undefined) Object.defineProperty(e, 'timeStamp', { value: stamp });
  return e;
}
const fire = (w, el, type, x, y, stamp) => { const e = ev(w, type, x, y, stamp); el.dispatchEvent(e); return e; };

// A drag from (x0, y0) by `dy` in 10 px steps `stepMs` apart (a slow 0.25 px/ms by default: never a glide). Returns the moves.
function drag(h, dy, o) {
  const opt = Object.assign({ x: 300, y0: 200, stepMs: 40, t0: 1000 }, o || {});
  let t = opt.t0;
  if (!opt.noStart) fire(h.w, h.v, 'touchstart', opt.x, opt.y0, t);
  const moves = [];
  const sign = dy < 0 ? -1 : 1;
  for (let d = 10; d <= Math.abs(dy); d += 10) { t += opt.stepMs; moves.push(fire(h.w, h.v, 'touchmove', opt.x, opt.y0 + sign * d, t)); }
  return { x: opt.x, y: opt.y0 + dy, t, moves };
}

test('D2 an upward drag of 200 px scrolls the page by 180 px (200 less the 20 px it took to pass the tap tolerance, anchored at the claim so it never jumps); every claimed move is cancelled; the lift is not a tap', async () => {
  const h = await boot(VIDEO);
  const g = drag(h, -200);
  assert.strictEqual(h.page.y, 180, 'the page followed the finger');
  const claimed = g.moves.slice(1); // the first move (10 px) is inside the tolerance
  assert.ok(!g.moves[0].defaultPrevented, 'inside the tolerance nothing is claimed');
  assert.ok(claimed.every((m) => m.defaultPrevented), 'every move after the claim is cancelled (the real route: the host\'s one non-passive touchmove)');
  const end = fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 300); // a rested finger: no glide
  assert.strictEqual(end.defaultPrevented, true, 'the claiming lift is not a tap');
  await wait(420);
  assert.strictEqual(h.pauses(), 0, 'no phantom single-tap pause on the lift');
  await wait(300);
  assert.strictEqual(h.v.playbackRate, 1, 'no 2x');
  assert.strictEqual(h.p.getState(), 'full');
  assert.strictEqual(h.pending(), 0, 'no glide from a rested finger');
});

test('D2 the player itself clamps what it asks the page for to the scroll range (not only the browser)', async () => {
  const h = await boot(VIDEO, { rawScroll: true, scrollY: 40, max: 100 });
  const g = drag(h, 300); // down past the top: the page would go to -140
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 300);
  assert.ok(h.page.calls.length > 0 && h.page.calls.every((y) => y >= 0 && y <= 100), 'every request inside 0..100: ' + JSON.stringify(h.page.calls));
  const b = await boot(VIDEO, { rawScroll: true, scrollY: 60, max: 100 });
  const g2 = drag(b, -300);
  fire(b.w, b.v, 'touchend', g2.x, g2.y, g2.t + 300);
  assert.ok(b.page.calls.length > 0 && b.page.calls.every((y) => y >= 0 && y <= 100), 'every request inside 0..100: ' + JSON.stringify(b.page.calls));
});

test('D2 a touchcancel mid-drag ends the drag: the touchend that follows is not a lift (no glide, no tap)', async () => {
  const h = await boot(VIDEO);
  const g = drag(h, -200, { stepMs: 10 });
  fire(h.w, h.v, 'touchcancel', g.x, g.y, g.t + 5);
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 6);
  assert.strictEqual(h.pending(), 0, 'no glide from a cancelled gesture');
});

test('D2 a downward drag with the page already scrolled scrolls it back; clamped at the top and at the bottom', async () => {
  const h = await boot(VIDEO, { scrollY: 300 });
  const g = drag(h, 200);
  assert.strictEqual(h.page.y, 120, '300 - (200 - 20)');
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 300);
  const top = await boot(VIDEO, { scrollY: 40 });
  const g2 = drag(top, 200);
  assert.strictEqual(top.page.y, 0, 'clamped at the top');
  fire(top.w, top.v, 'touchend', g2.x, g2.y, g2.t + 300);
  const bottom = await boot(VIDEO, { scrollY: 990, max: 1000 });
  const g3 = drag(bottom, -200);
  assert.strictEqual(bottom.page.y, 1000, 'clamped at the bottom');
  fire(bottom.w, bottom.v, 'touchend', g3.x, g3.y, g3.t + 300);
});

test('D2 narrow landscape (the minimize pull is offered): down at the top still MINIMIZES and never scrolls; up, and down with the page scrolled, scroll', async () => {
  const h = await boot(VIDEO, { narrow: true });
  const g = drag(h, 200);
  assert.strictEqual(h.page.calls.length, 0, 'the page never moved under a minimize pull');
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
  assert.strictEqual(h.p.getState(), 'docked', 'the pull still docks');
  const up = await boot(VIDEO, { narrow: true });
  const g2 = drag(up, -200);
  assert.strictEqual(up.page.y, 180, 'an upward drag scrolls');
  fire(up.w, up.v, 'touchend', g2.x, g2.y, g2.t + 300);
  assert.strictEqual(up.p.getState(), 'full');
  const down = await boot(VIDEO, { narrow: true, scrollY: 300 });
  const g3 = drag(down, 200);
  assert.strictEqual(down.page.y, 120, 'down with the page scrolled scrolls back, no minimize');
  fire(down.w, down.v, 'touchend', g3.x, g3.y, g3.t + 300);
  assert.strictEqual(down.p.getState(), 'full');
  assert.strictEqual(down.leaves.length, 0);
});

test('D2 a short drag under the tolerance is still a tap; a double-tap still skips', async () => {
  const h = await boot(VIDEO);
  Object.defineProperty(h.v, 'duration', { value: 600, configurable: true });
  fire(h.w, h.v, 'touchstart', 200, 100, 1000);
  const m = fire(h.w, h.v, 'touchmove', 200, 90, 1020); // 10 px: inside MOVE_TOL
  fire(h.w, h.v, 'touchend', 200, 90, 1050);
  assert.ok(!m.defaultPrevented, 'not claimed');
  await wait(420);
  assert.strictEqual(h.pauses(), 1, 'the single tap paused');
  assert.strictEqual(h.page.calls.length, 0, 'nothing scrolled');
  h.v.currentTime = 100;
  fire(h.w, h.v, 'touchstart', 300, 100, 2000);
  fire(h.w, h.v, 'touchend', 300, 100, 2040);
  await wait(40);
  fire(h.w, h.v, 'touchstart', 300, 100, 2100);
  fire(h.w, h.v, 'touchend', 300, 100, 2140);
  assert.ok(h.v.currentTime > 100, 'skipped forward, got ' + h.v.currentTime);
});

test('D2 a tap, then a drag inside its double-tap window: the pending single tap never fires (no pause on a scroll lift)', async () => {
  const h = await boot(VIDEO);
  fire(h.w, h.v, 'touchstart', 300, 200, 1000);
  fire(h.w, h.v, 'touchend', 300, 200, 1040); // a lone tap: its toggle waits out the double-tap window
  fire(h.w, h.v, 'touchstart', 300, 200, 1100);
  const g = drag(h, -100, { noStart: true, t0: 1100, stepMs: 10 });
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 300);
  await wait(500);
  assert.ok(h.page.y > 0, 'precondition: it scrolled');
  assert.strictEqual(h.pauses(), 0, 'neither the first tap nor the lift paused the video');
});

test('D2 a hold still reaches 2x, and a hold then a drag LOCKS the 2x and never scrolls', async () => {
  const h = await boot(VIDEO);
  fire(h.w, h.v, 'touchstart', 300, 100, 1000);
  await wait(650);
  assert.strictEqual(h.v.playbackRate, 2, 'the hold engaged');
  fire(h.w, h.v, 'touchend', 300, 100, 1700);
  assert.strictEqual(h.v.playbackRate, 1, 'released at the lift');
  assert.strictEqual(h.page.calls.length, 0);
  const l = await boot(VIDEO);
  fire(l.w, l.v, 'touchstart', 300, 100, 1000);
  await wait(650);
  const mv = fire(l.w, l.v, 'touchmove', 300, 200, 1700); // down past the lock distance
  fire(l.w, l.v, 'touchmove', 300, 40, 1740);
  assert.strictEqual(l.v.playbackRate, 2, 'locked');
  assert.strictEqual(l.page.calls.length, 0, 'a held finger never scrolls the page');
  assert.ok(mv.defaultPrevented, 'the hold keeps owning the drag');
  fire(l.w, l.v, 'touchend', 300, 40, 1780);
});

test('D2 a horizontal swipe is not hijacked, and a drag that went sideways first stays sideways even if it turns vertical', async () => {
  const h = await boot(VIDEO);
  fire(h.w, h.v, 'touchstart', 100, 200, 1000);
  const a = fire(h.w, h.v, 'touchmove', 160, 205, 1040);
  const b = fire(h.w, h.v, 'touchmove', 200, 330, 1080); // now mostly vertical, but it already went sideways
  fire(h.w, h.v, 'touchend', 200, 330, 1120);
  assert.ok(!a.defaultPrevented && !b.defaultPrevented, 'not claimed');
  assert.strictEqual(h.page.calls.length, 0);
  assert.strictEqual(h.p.getState(), 'full');
});

test('D2 portrait, faux full screen, the audio expanded view, native controls, a desktop form factor, another view and a locked page never scroll from the picture', async () => {
  const cases = [
    ['portrait', () => boot(VIDEO, { landscape: false })],
    ['css-fullscreen', async () => { const h = await boot(VIDEO); h.host.classList.add('css-fullscreen'); return h; }],
    ['audio-expanded', async () => { const h = await boot(VIDEO); h.host.classList.add('audio-expanded'); return h; }],
    ['native-controls', () => boot(VIDEO, { native: true })],
    ['desktop', () => boot(VIDEO, { desktop: true })],
    ['music view', () => boot(VIDEO, { view: 'music' })],
    ['scroll lock held', async () => { const h = await boot(VIDEO); h.w.FileTubeBodyLock.lock(h.doc, h.w, 'test'); return h; }],
  ];
  // non-vacuity (LESSONS 2): the same harness, with none of the refusals, DOES scroll
  const control = await boot(VIDEO);
  const gc = drag(control, -200);
  assert.ok(control.page.calls.length > 0 && gc.moves.slice(1).every((m) => m.defaultPrevented), 'the control case scrolls');
  fire(control.w, control.v, 'touchend', gc.x, gc.y, gc.t + 300);
  dom.window.close(); dom = null;
  for (const [name, mk] of cases) {
    const h = await mk();
    if (name === 'native-controls') { h.host.classList.add('native-controls'); }
    const before = h.page.calls.length;
    const g = drag(h, -200);
    assert.ok(g.moves.every((m) => !m.defaultPrevented), name + ': no move claimed by the scroll drag');
    fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 10);
    assert.strictEqual(h.page.calls.length, before, name + ': the page never moved');
    assert.strictEqual(h.pending(), 0, name + ': no glide');
    dom.window.close(); dom = null;
  }
});

test('D2 a second finger mid-drag ends the scroll: nothing further moves, and no glide starts', async () => {
  const h = await boot(VIDEO);
  const g = drag(h, -100, { stepMs: 10 });
  const at = h.page.y;
  assert.ok(at > 0, 'precondition: scrolling');
  const e = new h.w.Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'touches', { value: [{ clientX: 300, clientY: 90 }, { clientX: 200, clientY: 90 }] });
  Object.defineProperty(e, 'changedTouches', { value: [{ clientX: 300, clientY: 90 }] });
  h.v.dispatchEvent(e);
  fire(h.w, h.v, 'touchmove', 300, 60, g.t + 40);
  assert.strictEqual(h.page.y, at, 'the page stayed where the second finger landed');
  fire(h.w, h.v, 'touchend', 300, 60, g.t + 50);
  assert.strictEqual(h.pending(), 0, 'no glide');
  const c = await boot(VIDEO);
  drag(c, -100, { stepMs: 10 });
  fire(c.w, c.v, 'touchcancel', 300, 100, 1200);
  assert.strictEqual(c.pending(), 0, 'a touchcancel ends it with no glide');
  assert.strictEqual(c.pauses(), 0);
});

// ---- the glide ------------------------------------------------------------------

test('D2 glide: a fast lift keeps the page moving with a decaying speed and stops by itself; a rested finger, reduced motion and a clamp leave none', async () => {
  const h = await boot(VIDEO);
  const g = drag(h, -200, { stepMs: 10 }); // 1 px/ms
  const lift = h.page.y;
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 5);
  assert.strictEqual(h.pending(), 1, 'a glide is queued');
  const deltas = [];
  let prev = lift;
  for (let i = 0; i < 400 && h.pending(); i++) { h.frame(16); deltas.push(h.page.y - prev); prev = h.page.y; }
  assert.ok(deltas.length > 10 && deltas.length < 400, 'it ran for a while and then stopped on its own (' + deltas.length + ' frames)');
  assert.ok(deltas[0] > 10 && deltas[0] < 20, 'the first frame moves at about the release speed (1 px/ms x 16 ms), got ' + deltas[0]);
  for (let i = 1; i < deltas.length; i++) assert.ok(deltas[i] <= deltas[i - 1] + 1e-9, 'never speeds up (frame ' + i + ')');
  assert.ok(h.page.y > lift + 100, 'it carried the page well past the lift point');
  assert.strictEqual(h.pending(), 0);
  assert.strictEqual(h.pauses(), 0);

  const rested = await boot(VIDEO);
  const gr = drag(rested, -200, { stepMs: 10 });
  fire(rested.w, rested.v, 'touchend', gr.x, gr.y, gr.t + 200); // the finger sat still for 200 ms
  assert.strictEqual(rested.pending(), 0, 'a rested finger leaves no glide');

  const reduced = await boot(VIDEO, { reduced: true });
  const gd = drag(reduced, -200, { stepMs: 10 });
  const y = reduced.page.y;
  fire(reduced.w, reduced.v, 'touchend', gd.x, gd.y, gd.t + 5);
  assert.strictEqual(reduced.pending(), 0, 'reduced motion: no glide');
  assert.strictEqual(reduced.page.y, y);

  const edge = await boot(VIDEO, { max: 230 });
  const ge = drag(edge, -200, { stepMs: 10 });
  fire(edge.w, edge.v, 'touchend', ge.x, ge.y, ge.t + 5);
  edge.frames(60);
  assert.strictEqual(edge.page.y, 230, 'the glide stops at the end of the page');
  assert.strictEqual(edge.pending(), 0, 'and does not keep running against it');
});

test('D2 glide: a new touch anywhere stops it at once, and a new finger on the picture starts a fresh gesture', async () => {
  const h = await boot(VIDEO);
  const g = drag(h, -200, { stepMs: 10 });
  fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 5);
  h.frame(16); h.frame(16);
  const y = h.page.y;
  assert.strictEqual(h.pending(), 1, 'still gliding');
  const other = h.doc.createElement('div'); h.doc.body.appendChild(other);
  fire(h.w, other, 'touchstart', 50, 50, g.t + 100); // a touch elsewhere on the page
  assert.strictEqual(h.pending(), 0, 'the glide is cancelled');
  h.frame(16);
  assert.strictEqual(h.page.y, y, 'the page stopped where it was');
  // and on the picture
  const h2 = await boot(VIDEO);
  const g2 = drag(h2, -200, { stepMs: 10 });
  fire(h2.w, h2.v, 'touchend', g2.x, g2.y, g2.t + 5);
  h2.frame(16);
  const y2 = h2.page.y;
  fire(h2.w, h2.v, 'touchstart', 300, 200, g2.t + 100);
  assert.strictEqual(h2.pending(), 0);
  h2.frame(16);
  assert.strictEqual(h2.page.y, y2, 'a finger on the picture caught the glide');
  fire(h2.w, h2.v, 'touchend', 300, 200, g2.t + 140); // a plain tap that catches a glide
  await wait(420);
  assert.ok(h2.pauses() <= 1);
});

test('D2 glide: a rotate, a dock, a view swap (a new slot), fullscreen and a scroll lock each end it on the next frame', async () => {
  const ends = {
    'rotate to portrait': (h) => { h.w.matchMedia = (q) => ({ media: q, matches: /coarse|hover: none/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }); },
    'left the watch view': (h) => { h.doc.body.setAttribute('data-view', 'home'); },
    'faux full screen': (h) => { h.host.classList.add('css-fullscreen'); },
    'the slot was swapped out (SPA nav)': (h) => { h.slot.remove(); },
    'the player moved to another slot': (h) => { const s2 = h.doc.createElement('div'); s2.id = 'player-slot'; h.doc.body.appendChild(s2); s2.appendChild(h.host); },
    'a scroll lock took the page': (h) => { h.w.FileTubeBodyLock.lock(h.doc, h.w, 'test'); },
  };
  for (const [name, end] of Object.entries(ends)) {
    const h = await boot(VIDEO);
    const g = drag(h, -200, { stepMs: 10 });
    fire(h.w, h.v, 'touchend', g.x, g.y, g.t + 5);
    h.frame(16);
    assert.strictEqual(h.pending(), 1, name + ': precondition, still gliding');
    end(h);
    const calls = h.page.calls.length;
    h.frame(16);
    assert.strictEqual(h.page.calls.length, calls, name + ': no further scroll');
    assert.strictEqual(h.pending(), 0, name + ': the glide ended');
    dom.window.close(); dom = null;
  }
});

test('D2 a close or a new load mid-drag ends the drag and the glide (the one remover)', async () => {
  const h = await boot(VIDEO);
  const g = drag(h, -100, { stepMs: 10 });
  h.p.close();
  const calls = h.page.calls.length;
  const m = fire(h.w, h.v, 'touchmove', 300, 40, g.t + 20);
  assert.strictEqual(h.page.calls.length, calls, 'a dead drag moves nothing');
  assert.ok(!m.defaultPrevented);
  const h2 = await boot(VIDEO);
  const g2 = drag(h2, -200, { stepMs: 10 });
  fire(h2.w, h2.v, 'touchend', g2.x, g2.y, g2.t + 5);
  h2.frame(16);
  assert.strictEqual(h2.pending(), 1);
  h2.p.close();
  assert.strictEqual(h2.pending(), 0, 'closing the player cancels the glide');
});

// ---- wiring and the loupe guard ---------------------------------------------------

test('D2 wiring: the scroll drag rides the host\'s ONE non-passive touchmove (no second one), and the loupe cancel is untouched', () => {
  const src = strip(PLAYER_SRC);
  assert.ok(!/document\.addEventListener\('touchmove'/.test(src), 'no document touchmove');
  assert.strictEqual((src.match(/host\.addEventListener\('touchmove'/g) || []).length, 1, 'one host touchmove');
  assert.strictEqual((src.match(/^\s*scrollDragTouchMove\(e\);/gm) || []).length, 1, 'called from exactly one place');
  const hostMove = src.slice(src.indexOf("host.addEventListener('touchmove'"), src.indexOf('}, { passive: false });', src.indexOf("host.addEventListener('touchmove'")));
  assert.ok(hostMove.includes('scrollDragTouchMove(e)') && hostMove.indexOf('minimizeTouchMove(e)') < hostMove.indexOf('scrollDragTouchMove(e)'), 'after the minimize pull has had its look');
  // the glide's only global listener is a PASSIVE touchstart that its remover takes off
  const adds = (src.match(/document\.addEventListener\('touchstart'[^;]*;/g) || []).filter((a) => a.includes('scrollGlideStop'));
  assert.strictEqual(adds.length, 1);
  assert.ok(/passive: true/.test(adds[0]) && /capture: true/.test(adds[0]));
  assert.ok(/document\.removeEventListener\('touchstart', scrollGlideStop, true\)/.test(src), 'and it is removed');
});

// ---- D3 / W4: what must NOT change ---------------------------------------------------

test('D3 the loupe guard cancels exactly the touches it did before: every one-finger touchstart on the picture while FULL, sideways scroll state included; never two fingers, the docked player or native controls', async () => {
  const h = await boot(VIDEO);
  assert.strictEqual(fire(h.w, h.v, 'touchstart', 300, 200, 1000).defaultPrevented, true, 'sideways, scroll-capable: still cancelled (the scroll is the app\'s own)');
  fire(h.w, h.v, 'touchend', 300, 200, 1040);
  const two = new h.w.Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(two, 'touches', { value: [{ clientX: 300, clientY: 200 }, { clientX: 200, clientY: 200 }] });
  Object.defineProperty(two, 'changedTouches', { value: [{ clientX: 300, clientY: 200 }] });
  h.v.dispatchEvent(two);
  assert.strictEqual(two.defaultPrevented, false, 'two fingers are never cancelled');
  const p = await boot(VIDEO, { landscape: false });
  assert.strictEqual(fire(p.w, p.v, 'touchstart', 300, 200, 1000).defaultPrevented, true, 'portrait: unchanged, cancelled');
  const n = await boot(VIDEO);
  n.host.classList.add('native-controls');
  assert.strictEqual(fire(n.w, n.v, 'touchstart', 300, 200, 1000).defaultPrevented, false, 'native controls: not cancelled');
  const d = await boot(VIDEO);
  d.p.dock();
  assert.strictEqual(d.p.getState(), 'docked', 'precondition: docked');
  assert.strictEqual(fire(d.w, d.v, 'touchstart', 300, 200, 1000).defaultPrevented, false, 'docked: not cancelled (the tap must synthesize the expanding click)');
});

test('D3 the loupe guard\'s decision table and its one non-passive touchstart are unchanged', () => {
  const d = player.pictureTouchCancelDecision;
  assert.strictEqual(d({ touches: 1, nativeFs: false, nativeControls: false, state: 'full' }), true);
  assert.strictEqual(d({ touches: 2, nativeFs: false, nativeControls: false, state: 'full' }), false);
  assert.strictEqual(d({ touches: 1, nativeFs: true, nativeControls: false, state: 'full' }), false);
  assert.strictEqual(d({ touches: 1, nativeFs: false, nativeControls: true, state: 'full' }), false);
  assert.strictEqual(d({ touches: 1, nativeFs: false, nativeControls: false, state: 'docked' }), false);
  assert.strictEqual(d(), false);
  const src = strip(PLAYER_SRC);
  const body = src.slice(src.indexOf('function pictureTouchCancelDecision'), src.indexOf('\n}\n', src.indexOf('function pictureTouchCancelDecision')));
  assert.ok(/opts\.touches === 1 && !opts\.nativeFs && !opts\.nativeControls && opts\.state === 'full'/.test(body), 'the decision body has no orientation, scroll or view term');
  assert.strictEqual((src.match(/el\.addEventListener\('touchstart'/g) || []).length, 2, 'the passive tracker and the one loupe cancel, no third touchstart on the surface');
  assert.strictEqual((src.match(/el\.addEventListener\('touchstart', function \(e\) \{\s*if \(!pictureTouchCancelDecision/g) || []).length, 1);
});
