'use strict';

// [UNIT] v1.358 - drag down while holding the 2x to LOCK it (plan 2026-10-02-hold-lock).
// Pure decisions are bound by invocation, then the REAL player.js is driven through its real
// touch listeners in a jsdom watch shell (the player-immersive-lock-grace harness shape), so a
// decision that is correct but never reached by a gesture cannot pass (LESSONS 2, inert feature).

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const player = require('../../public/js/player.js');
const { swipeBackShouldClaim } = require('../../public/js/common.js');

const PUB = path.join(__dirname, '..', '..', 'public');
const LOCK_SRC = fs.readFileSync(path.join(PUB, 'js', 'body-scroll-lock.js'), 'utf8');
const COMMON_SRC = fs.readFileSync(path.join(PUB, 'js', 'common.js'), 'utf8');
const PLAYER_SRC = fs.readFileSync(path.join(PUB, 'js', 'player.js'), 'utf8');
const WATCH = fs.readFileSync(path.join(PUB, 'watch.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');

// ---- pure: holdDragDecision (R1) ---------------------------------------------

test('holdDragDecision: lock iff dy >= lockPx and |dx| < dy (47 none, 48 lock, |dx| = 48 none, up none, sideways none, junk none)', () => {
  const d = player.holdDragDecision;
  assert.strictEqual(typeof d, 'function', 'exported');
  assert.strictEqual(d({ dx: 0, dy: 47, lockPx: 48 }), 'none');
  assert.strictEqual(d({ dx: 0, dy: 48, lockPx: 48 }), 'lock');
  assert.strictEqual(d({ dx: 47, dy: 48, lockPx: 48 }), 'lock');
  assert.strictEqual(d({ dx: -47, dy: 48, lockPx: 48 }), 'lock', 'leftward lands the same');
  assert.strictEqual(d({ dx: 48, dy: 48, lockPx: 48 }), 'none', '|dx| = dy is a diagonal, not a pull down');
  assert.strictEqual(d({ dx: 0, dy: -60, lockPx: 48 }), 'none', 'up never locks');
  assert.strictEqual(d({ dx: 60, dy: 10, lockPx: 48 }), 'none', 'sideways never locks');
  assert.strictEqual(d({ dx: NaN, dy: 60, lockPx: 48 }), 'none');
  assert.strictEqual(d({ dx: 0, dy: undefined, lockPx: 48 }), 'none');
  assert.strictEqual(d({ dx: 0, dy: 60 }), 'none', 'no threshold, no lock');
  assert.strictEqual(d(), 'none');
  assert.strictEqual(d({ dx: 0, dy: 60, lockPx: 0 }), 'none', 'a zero threshold would lock every plain hold');
});

test('holdDragDecision vs swipeBackShouldClaim: pure-by-pure disjoint over a grid (no drag is both a lock and a swipe-back)', () => {
  const d = player.holdDragDecision;
  assert.strictEqual(typeof d, 'function');
  let locks = 0, claims = 0;
  for (let dx = -200; dx <= 200; dx += 4) {
    for (let dy = -200; dy <= 200; dy += 4) {
      const lock = d({ dx, dy, lockPx: 48 }) === 'lock';
      const claim = swipeBackShouldClaim(dx, dy);
      if (lock) locks++;
      if (claim) claims++;
      assert.ok(!(lock && claim), 'dx ' + dx + ' dy ' + dy + ' is both a lock and a swipe-back claim');
    }
  }
  assert.ok(locks > 500 && claims > 500, 'the grid exercises both regions (' + locks + ' lock, ' + claims + ' claim), so disjointness is not vacuous');
});

// ---- pure: holdRatePickDecision (R5b) ----------------------------------------

test('holdRatePickDecision: a locked hold drops only when defaultPlaybackRate moved from its value at engage', () => {
  const d = player.holdRatePickDecision;
  assert.strictEqual(typeof d, 'function', 'exported');
  assert.strictEqual(d({ locked: true, defaultAtEngage: 1, defaultNow: 1.5 }), 'drop');
  assert.strictEqual(d({ locked: true, defaultAtEngage: 1, defaultNow: 1 }), 'keep', 'our own 2x write never moves the default');
  assert.strictEqual(d({ locked: false, defaultAtEngage: 1, defaultNow: 1.5 }), 'keep', 'a plain hold is untouched');
  assert.strictEqual(d({ locked: true, defaultAtEngage: 1.5, defaultNow: 1 }), 'drop', 'a pick back to 1 counts');
  assert.strictEqual(d({ locked: true, defaultAtEngage: 1, defaultNow: NaN }), 'keep');
  assert.strictEqual(d(), 'keep');
});

// ---- behaviour: the real gesture in jsdom ------------------------------------

let dom = null;
afterEach(() => { if (dom) { dom.window.close(); dom = null; } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(item, settings, extra) {
  dom = new JSDOM(WATCH, { url: 'http://localhost/watch.html?v=' + item.id, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'platform', { value: 'iPhone' });
  w.matchMedia = (q) => ({ matches: /coarse|hover: none|max-width/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  const posts = [];
  w.fetch = async (url, opts) => {
    if (opts && opts.method === 'POST') posts.push(String(url));
    if (/prepare-audio/.test(String(url))) return { ok: true, status: 200, json: async () => ({ audioStatus: 'ready' }), text: async () => '' };
    return { ok: true, status: 200, json: async () => Object.assign({ mobileCustomPlayer: true }, settings || {}), text: async () => '' };
  };
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.scrollTo = () => {};
  w.eval(COMMON_SRC.slice(COMMON_SRC.indexOf('function resolveAudioArtUrl('), COMMON_SRC.indexOf('\n}\n', COMMON_SRC.indexOf('function resolveAudioArtUrl(')) + 3));
  w.eval(LOCK_SRC);
  w.eval(PLAYER_SRC);
  const slot = w.document.createElement('div'); slot.id = 'player-slot'; w.document.body.appendChild(slot);
  const p = w.FileTube.player;
  assert.strictEqual(p.load(item.id, item, { slot }), true, 'the real player loaded the item');
  await wait(60);
  const v = w.document.getElementById('media-player');
  Object.defineProperty(v, 'paused', { value: false, configurable: true });
  v.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 225, right: 400, bottom: 225 });
  return Object.assign({ w, doc: w.document, p, v, badge: w.document.getElementById('speed-badge'), posts }, extra);
}
const VIDEO = { id: 'v1', title: 'T', type: 'video', ext: '.mp4' };

function ev(w, type, x, y) {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  const list = [{ clientX: x, clientY: y }];
  Object.defineProperty(e, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : list });
  Object.defineProperty(e, 'changedTouches', { value: list });
  return e;
}
const fire = (w, el, type, x, y) => { const e = ev(w, type, x, y); el.dispatchEvent(e); return e; };

// A real hold: touchstart, past HOLD_MS (500). Returns once the 2x has engaged.
async function holdDown(h, x, y) {
  fire(h.w, h.v, 'touchstart', x, y);
  await wait(560);
  assert.strictEqual(h.v.playbackRate, 2, 'precondition: the 500ms hold engaged 2x');
}

test('a PLAIN hold (no drag) is unchanged: 2x while held, back to the prior rate at lift, pill hidden (regression guard: passes on main and after)', async () => {
  const h = await boot(VIDEO);
  h.v.playbackRate = 1.25;
  await holdDown(h, 200, 100);
  assert.strictEqual(h.badge.hidden, false, 'the pill is up while held');
  const end = fire(h.w, h.v, 'touchend', 200, 100);
  assert.strictEqual(end.defaultPrevented, true, 'a held lift is not a tap (existing behaviour)');
  assert.strictEqual(h.v.playbackRate, 1.25, 'back to the rate before the hold');
  assert.strictEqual(h.badge.hidden, true);
});

test('hold, drag DOWN past the lock, lift: the 2x STAYS and the pill stays up (red on main: the lift releases it)', async () => {
  const h = await boot(VIDEO);
  await holdDown(h, 200, 100);
  fire(h.w, h.v, 'touchmove', 200, 130);
  assert.strictEqual(h.v.playbackRate, 2);
  fire(h.w, h.v, 'touchmove', 200, 160);
  fire(h.w, h.v, 'touchend', 200, 160);
  assert.strictEqual(h.v.playbackRate, 2, 'locked: the lift did not release');
  assert.strictEqual(h.badge.hidden, false, 'the pill stays');
});

test('hold, drag only 30px (under the lock), lift: a plain hold, releases (guard against a lock that is too eager)', async () => {
  const h = await boot(VIDEO);
  h.v.playbackRate = 1;
  await holdDown(h, 200, 100);
  fire(h.w, h.v, 'touchmove', 200, 130);
  fire(h.w, h.v, 'touchend', 200, 130);
  assert.strictEqual(h.v.playbackRate, 1);
  assert.strictEqual(h.badge.hidden, true);
});

// ---- the background handoff carries the SPEAKER of a hold (R8, section 3 item 4) ---

test('a live hold at backgrounding hands the sidecar the prior rate, not 2x (red on main: the safety net runs after the handoff read)', async () => {
  const h = await boot(VIDEO, { backgroundAudioForVideo: true });
  await wait(80); // prepare-audio resolves -> status ready, the sidecar is armed
  const side = h.doc.querySelector('audio');
  assert.ok(side && side !== h.v, 'precondition: the hidden background-audio element exists');
  h.v.playbackRate = 1;
  await holdDown(h, 200, 100);
  Object.defineProperty(h.doc, 'visibilityState', { value: 'hidden', configurable: true });
  h.doc.dispatchEvent(new h.w.Event('visibilitychange'));
  assert.strictEqual(side.playbackRate, 1, 'the sidecar is at the rate before the hold');
  assert.strictEqual(h.v.playbackRate, 1, 'and the video element restored it too');
});

// ---- the lock's lifecycle (R3, R4, R4b, R5b) ---------------------------------

async function locked(h) {
  await holdDown(h, 200, 100);
  fire(h.w, h.v, 'touchmove', 200, 170);
  fire(h.w, h.v, 'touchend', 200, 170);
  assert.strictEqual(h.v.playbackRate, 2, 'precondition: locked');
  assert.ok(h.badge.classList.contains('is-locked'), 'precondition: the pill is the locked pill');
}

test('while the finger is down the drag is claimed (preventDefault) so the page cannot scroll; after the lift a plain drag is not', async () => {
  const h = await boot(VIDEO);
  await holdDown(h, 200, 100);
  assert.strictEqual(fire(h.w, h.v, 'touchmove', 200, 120).defaultPrevented, true, 'claimed before the lock');
  assert.strictEqual(fire(h.w, h.v, 'touchmove', 200, 170).defaultPrevented, true, 'and after it');
  fire(h.w, h.v, 'touchend', 200, 170);
  fire(h.w, h.v, 'touchstart', 200, 100);
  assert.strictEqual(fire(h.w, h.v, 'touchmove', 200, 150).defaultPrevented, false, 'a later drag scrolls as normal');
  fire(h.w, h.v, 'touchend', 200, 150);
});

test('R3: the pill tap unlocks, back to the rate before the hold; Enter and Space too', async () => {
  for (const how of ['click', 'Enter', ' ']) {
    const h = await boot(VIDEO);
    h.v.playbackRate = 1.5;
    await locked(h);
    assert.strictEqual(h.badge.getAttribute('role'), 'button');
    assert.strictEqual(h.badge.getAttribute('aria-label'), 'Unlock 2x');
    if (how === 'click') h.badge.dispatchEvent(new h.w.Event('click', { bubbles: true }));
    else h.badge.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: how, bubbles: true, cancelable: true }));
    assert.strictEqual(h.v.playbackRate, 1.5, how + ': unlocked to the prior rate');
    assert.strictEqual(h.badge.hidden, true);
    assert.ok(!h.badge.classList.contains('is-locked') && !h.badge.hasAttribute('role') && !h.badge.hasAttribute('tabindex'), how + ': the control affordance is gone');
    dom.window.close(); dom = null;
  }
});

test('R4: a double-tap skip on the picture while locked still skips and keeps the lock (the lift is a tap, not swallowed as a hold lift)', async () => {
  const h = await boot(VIDEO);
  Object.defineProperty(h.v, 'duration', { value: 600, configurable: true });
  await locked(h);
  h.v.currentTime = 100;
  for (let i = 0; i < 2; i++) { fire(h.w, h.v, 'touchstart', 350, 100); fire(h.w, h.v, 'touchend', 350, 100); await wait(40); }
  assert.ok(h.v.currentTime > 100, 'the double-tap skipped forward (classified as a tap), got ' + h.v.currentTime);
  assert.strictEqual(h.v.playbackRate, 2);
  assert.strictEqual(h.badge.hidden, false);
});

test('R3: a new hold while locked changes nothing, and its lift keeps the lock', async () => {
  const h = await boot(VIDEO);
  await locked(h);
  fire(h.w, h.v, 'touchstart', 200, 100);
  await wait(560);
  fire(h.w, h.v, 'touchend', 200, 100);
  assert.strictEqual(h.v.playbackRate, 2);
  assert.ok(h.badge.classList.contains('is-locked'));
});

test('R4b: a touchcancel of the gesture that made the lock releases; a later gesture\'s touchcancel does not', async () => {
  const h = await boot(VIDEO);
  h.v.playbackRate = 1;
  await holdDown(h, 200, 100);
  fire(h.w, h.v, 'touchmove', 200, 170);
  fire(h.w, h.v, 'touchcancel', 200, 170);
  assert.strictEqual(h.v.playbackRate, 1, 'the cancelled locking gesture releases');
  const g = await boot(VIDEO);
  await locked(g);
  fire(g.w, g.v, 'touchstart', 200, 100);
  fire(g.w, g.v, 'touchcancel', 200, 100);
  assert.strictEqual(g.v.playbackRate, 2, 'a later cancel leaves the lock');
});

test('R4b: a second finger during the locking gesture releases; during a later gesture it does not', async () => {
  const h = await boot(VIDEO);
  h.v.playbackRate = 1;
  await holdDown(h, 200, 100);
  const e = new h.w.Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'touches', { value: [{ clientX: 1, clientY: 1 }, { clientX: 2, clientY: 2 }] });
  h.v.dispatchEvent(e);
  assert.strictEqual(h.v.playbackRate, 1);
  const g = await boot(VIDEO);
  await locked(g);
  const e2 = new g.w.Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(e2, 'touches', { value: [{ clientX: 1, clientY: 1 }, { clientX: 2, clientY: 2 }] });
  g.v.dispatchEvent(e2);
  assert.strictEqual(g.v.playbackRate, 2);
});

test('R4b: dock, close and a new load each end the lock (the transient reset)', async () => {
  for (const end of ['dock', 'close']) {
    const h = await boot(VIDEO);
    h.v.playbackRate = 1;
    await locked(h);
    h.p[end]();
    assert.strictEqual(h.badge.classList.contains('is-locked'), false, end + ': pill unlocked');
    assert.strictEqual(h.badge.hidden, true, end);
    assert.strictEqual(h.v.playbackRate, 1, end + ': rate restored');
    dom.window.close(); dom = null;
  }
  const h = await boot(VIDEO);
  await locked(h);
  const slot = h.doc.getElementById('player-slot');
  h.p.load('v2', { id: 'v2', title: 'T2', type: 'video', ext: '.mp4' }, { slot });
  assert.strictEqual(h.badge.classList.contains('is-locked'), false, 'a new item never inherits the lock');
});

test('R4b: backgrounding (hidden / pagehide / freeze) ends the lock', async () => {
  for (const kind of ['hidden', 'pagehide', 'freeze']) {
    const h = await boot(VIDEO);
    h.v.playbackRate = 1;
    await locked(h);
    if (kind === 'hidden') { Object.defineProperty(h.doc, 'visibilityState', { value: 'hidden', configurable: true }); h.doc.dispatchEvent(new h.w.Event('visibilitychange')); }
    else if (kind === 'pagehide') h.w.dispatchEvent(new h.w.Event('pagehide'));
    else h.doc.dispatchEvent(new h.w.Event('freeze'));
    assert.strictEqual(h.v.playbackRate, 1, kind);
    assert.strictEqual(h.badge.hidden, true, kind);
    dom.window.close(); dom = null;
  }
});

test('R5b: an explicit speed pick (the default moves) ends the lock WITHOUT writing the rate back; a same-as-default pick also ends it', async () => {
  const pick = async (rate, def) => {
    const h = await boot(VIDEO);
    h.v.playbackRate = 1;
    await locked(h);
    h.v.playbackRate = rate; h.v.defaultPlaybackRate = def;
    h.v.dispatchEvent(new h.w.Event('ratechange'));
    return h;
  };
  let h = await pick(1.5, 1.5);
  assert.strictEqual(h.v.playbackRate, 1.5, 'the pick wins');
  assert.ok(!h.badge.classList.contains('is-locked') && h.badge.hidden);
  dom.window.close(); dom = null;
  h = await pick(1, 1);
  assert.strictEqual(h.v.playbackRate, 1, 'picking the default speed (1x) while locked also ends the lock');
  assert.ok(!h.badge.classList.contains('is-locked') && h.badge.hidden);
});

test('R5: the lock never touches defaultPlaybackRate or ft-rate (stop rule d)', async () => {
  const h = await boot(VIDEO);
  h.v.defaultPlaybackRate = 1.25;
  await locked(h);
  assert.strictEqual(h.v.defaultPlaybackRate, 1.25);
  assert.strictEqual(h.w.localStorage.getItem('ft-rate'), null);
});

test('R6: no lock where the hold does not work (docked)', async () => {
  const h = await boot(VIDEO);
  await holdDown(h, 200, 100);
  h.p.dock();
  assert.strictEqual(h.badge.classList.contains('is-locked'), false);
});

test('after an unlock a plain hold behaves as before: its lift releases to the prior rate, and it can lock again', async () => {
  const h = await boot(VIDEO);
  h.v.playbackRate = 1.5;
  await locked(h);
  h.badge.dispatchEvent(new h.w.Event('click', { bubbles: true }));
  assert.strictEqual(h.v.playbackRate, 1.5);
  await holdDown(h, 200, 100);
  fire(h.w, h.v, 'touchend', 200, 100);
  assert.strictEqual(h.v.playbackRate, 1.5, 'a plain hold lifted: back to the prior rate');
  await locked(h);
});
