'use strict';

// [UNIT] v1.362.2 W1 (D1) / v1.362.3 (E1, plan 2026-10-04-loupe-any-hold-and-hold-log) - the iOS text loupe.
// A hold on the playing picture brings up WebKit's magnifier, a plain hold too (the v1.362.2 tap-window cancel
// failed on the device); the fix is ONE separate non-passive touchstart on each gesture surface that cancels
// every one-finger touch while the player is FULL. The pure decision is bound conjunct by conjunct; then the REAL wireSkipHoldGestures is driven in a
// jsdom watch shell (the minimize-player harness shape), so a decision that is right but never reached by
// a touch cannot pass (LESSONS 2, inert feature).

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

// ---- pure: pictureTouchCancelDecision (v1.362.3, E1) -------------------------------

const BASE = { touches: 1, nativeFs: false, nativeControls: false, state: 'full' };
const d = (o) => player.pictureTouchCancelDecision(Object.assign({}, BASE, o || {}));

test('pictureTouchCancelDecision: every one-finger touch on the FULL player cancels (no tap window since v1.362.3)', () => {
  assert.strictEqual(typeof player.pictureTouchCancelDecision, 'function', 'exported');
  assert.strictEqual(player.tapPairCancelDecision, undefined, 'the v1.362.2 window decision is gone');
  assert.strictEqual(d(), true);
});

test('pictureTouchCancelDecision: each guard flipped ALONE refuses', () => {
  assert.strictEqual(d({ touches: 2 }), false, 'two fingers');
  assert.strictEqual(d({ touches: 0 }), false, 'no finger');
  assert.strictEqual(d({ nativeFs: true }), false, 'native full screen');
  assert.strictEqual(d({ nativeControls: true }), false, 'native-controls mode');
  assert.strictEqual(d({ state: 'docked' }), false, 'docked: the tap must still synthesize the expanding click');
  assert.strictEqual(d({ state: 'closed' }), false, 'closed');
  assert.strictEqual(player.pictureTouchCancelDecision(), false, 'no input');
});

test('inTapRunDecision is the ONE window: the reveal grace reads it, and the window is not copied (LESSONS 0, no second copy)', () => {
  const r = player.inTapRunDecision;
  assert.strictEqual(typeof r, 'function', 'exported');
  assert.strictEqual(r({ now: 100, lastTapTime: 0, skipChainUntil: 101, doubleTapMs: 350 }), true);
  assert.strictEqual(r({ now: 100, lastTapTime: 1, skipChainUntil: 0, doubleTapMs: 350 }), true);
  assert.strictEqual(r({ now: 400, lastTapTime: 50, skipChainUntil: 0, doubleTapMs: 350 }), false);
  const code = PLAYER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  assert.strictEqual((code.match(/now - lastTapTime < DOUBLE_TAP_MS/g) || []).length, 0, 'no inline copy of the window in the IIFE');
  assert.strictEqual((code.match(/opts\.now - opts\.lastTapTime < opts\.doubleTapMs/g) || []).length, 1, 'the window is written once');
  assert.match(code, /var inTapRun = inTapRunDecision\(\{ now: now, lastTapTime: lastTapTime, skipChainUntil: skipChainUntil, doubleTapMs: DOUBLE_TAP_MS \}\);/, 'the reveal grace reads the shared predicate');
});

// ---- behaviour: the real gesture in jsdom ---------------------------------------

let dom = null;
afterEach(() => { if (dom) { dom.window.close(); dom = null; } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(item, o) {
  const opt = o || {};
  dom = new JSDOM(WATCH, { url: 'http://localhost/watch.html?v=' + item.id, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'platform', { value: 'iPhone' });
  w.matchMedia = (q) => ({ media: q, matches: /coarse|hover: none|max-width/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(w, 'innerHeight', { value: 664, configurable: true });
  Object.defineProperty(w, 'innerWidth', { value: 390, configurable: true });
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ mobileCustomPlayer: opt.native ? false : true }), text: async () => '' });
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.scrollTo = () => {};
  if (opt.debug) w.localStorage.setItem('ft-debug-lifecycle', '1');
  w.document.body.setAttribute('data-view', 'watch');
  // Every touchstart registration on the two gesture surfaces, in order, with its passivity.
  const regs = [];
  const origAdd = w.EventTarget.prototype.addEventListener;
  w.EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (type === 'touchstart' && this && (this.id === 'media-player' || this.id === 'audio-bg-art')) {
      regs.push({ id: this.id, passive: !!(opts && typeof opts === 'object' && opts.passive), capture: !!(opts && typeof opts === 'object' && opts.capture) });
    }
    return origAdd.call(this, type, fn, opts);
  };
  w.eval(COMMON_SRC.slice(COMMON_SRC.indexOf('function resolveAudioArtUrl('), COMMON_SRC.indexOf('\n}\n', COMMON_SRC.indexOf('function resolveAudioArtUrl(')) + 3));
  w.eval(LOCK_SRC);
  w.eval(PLAYER_SRC);
  w.FileTube.leaveWatchForBrowse = () => {};
  const slot = w.document.createElement('div'); slot.id = 'player-slot'; w.document.body.appendChild(slot);
  const p = w.FileTube.player;
  assert.strictEqual(p.load(item.id, item, { slot }), true, 'the real player loaded the item');
  await wait(60);
  const v = w.document.getElementById('media-player');
  const host = w.document.getElementById('player-wrapper');
  Object.defineProperty(v, 'paused', { value: false, configurable: true });
  Object.defineProperty(v, 'duration', { value: 600, configurable: true });
  const rect = { left: 0, top: 0, x: 0, y: 0, width: 390, height: 260, right: 390, bottom: 260 };
  v.getBoundingClientRect = () => rect;
  const art = w.document.getElementById('audio-bg-art');
  if (art) art.getBoundingClientRect = () => rect;
  host.getBoundingClientRect = () => rect;
  // gate r1 (adversary): a pause really pauses (the old stub counted it but left paused false, which let
  // a tap-then-hold reach 2x in jsdom while the real player pauses first).
  let pauses = 0; v.pause = () => { pauses++; Object.defineProperty(v, 'paused', { value: true, configurable: true }); };
  // A controlled clock: every Date.now() in the player reads it.
  let clock = 100000;
  w.Date.now = () => clock;
  return { w, doc: w.document, p, v, art, host, regs, pauses: () => pauses, at: (ms) => { clock = ms; }, now: () => clock };
}
const VIDEO = { id: 'v1', title: 'T', type: 'video', ext: '.mp4' };
const AUDIO = { id: 'a1', title: 'A', type: 'audio', ext: '.mp3', hasThumbnail: true };

function ev(w, type, x, y, fingers) {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  const one = { clientX: x, clientY: y };
  const list = [];
  for (let i = 0; i < (fingers || 1); i++) list.push(one);
  Object.defineProperty(e, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : list });
  Object.defineProperty(e, 'changedTouches', { value: [one] });
  return e;
}
const fire = (h, el, type, x, y, fingers) => { const e = ev(h.w, type, x, y, fingers); el.dispatchEvent(e); return e; };
// A lone tap at `ms` (touchstart then touchend 40 ms later, no move), on the right half.
function tap(h, el, ms) {
  h.at(ms); const s = fire(h, el, 'touchstart', 300, 100);
  h.at(ms + 40); fire(h, el, 'touchend', 300, 100);
  return s;
}

test('the cancel is ONE separate non-passive touchstart per surface, registered AFTER the passive tracker', async () => {
  const h = await boot(VIDEO);
  for (const id of ['media-player', 'audio-bg-art']) {
    const mine = h.regs.filter((r) => r.id === id && !r.capture);
    assert.deepStrictEqual(mine.map((r) => r.passive), [true, false], id + ': the passive tracker first, then exactly one non-passive cancel');
  }
});

test('every one-finger touch on the playing picture is cancelled: a first touch, inside the tap window and long after it (E1)', async () => {
  const h = await boot(VIDEO);
  const first = tap(h, h.v, 100000);
  assert.strictEqual(first.defaultPrevented, true, 'a first touch (a plain hold starts like this)');
  h.at(100040 + 200);
  assert.strictEqual(fire(h, h.v, 'touchstart', 300, 100).defaultPrevented, true, 'inside the window');
  h.at(100040 + 240); fire(h, h.v, 'touchend', 300, 100);
  tap(h, h.v, 105000);
  h.at(105040 + 5000);
  assert.strictEqual(fire(h, h.v, 'touchstart', 300, 100).defaultPrevented, true, '5 s after a tap');
});

test('two fingers inside the window: not cancelled (a pinch stays the browser\'s)', async () => {
  const h = await boot(VIDEO);
  tap(h, h.v, 100000);
  h.at(100040 + 100);
  const two = fire(h, h.v, 'touchstart', 300, 100, 2);
  assert.strictEqual(two.defaultPrevented, false);
});

test('a hot skip chain cancels each chain tap; the double-tap still skips and a chain tap still skips', async () => {
  const h = await boot(VIDEO);
  h.v.currentTime = 100;
  tap(h, h.v, 100000);
  h.at(100140); const s2 = fire(h, h.v, 'touchstart', 300, 100);
  h.at(100180); const e2 = fire(h, h.v, 'touchend', 300, 100);
  assert.strictEqual(s2.defaultPrevented, true, 'the double-tap\'s second touch is cancelled');
  assert.strictEqual(e2.defaultPrevented, true, 'and it is still classified a skip');
  assert.ok(h.v.currentTime > 100, 'skipped forward, got ' + h.v.currentTime);
  const after2 = h.v.currentTime;
  // The chain: lastTapTime was zeroed by the skip, so only the chain window can cancel tap 3.
  h.at(100180 + 600); const s3 = fire(h, h.v, 'touchstart', 300, 100);
  h.at(100180 + 640); fire(h, h.v, 'touchend', 300, 100);
  assert.strictEqual(s3.defaultPrevented, true, 'a chain tap is cancelled');
  assert.ok(h.v.currentTime > after2, 'and still skips');
  await wait(420);
  assert.strictEqual(h.pauses(), 0, 'no stray pause from the first tap');
});

test('a DOUBLE-tap then a hold (the gesture that reaches 2x): every touch after the first is cancelled, 2x engages, nothing pauses', async () => {
  const h = await boot(VIDEO);
  h.v.currentTime = 100;
  tap(h, h.v, 100000);
  h.at(100140); const s2 = fire(h, h.v, 'touchstart', 300, 100);
  h.at(100180); fire(h, h.v, 'touchend', 300, 100); // the skip
  h.at(100180 + 300); const s3 = fire(h, h.v, 'touchstart', 300, 100); // the hold, inside the chain
  assert.deepStrictEqual([s2.defaultPrevented, s3.defaultPrevented], [true, true]);
  await wait(560); // HOLD_MS is a real timer
  assert.strictEqual(h.v.playbackRate, 2, 'the hold engaged');
  assert.strictEqual(h.pauses(), 0, 'no pending single tap paused it');
  h.at(100180 + 1200); fire(h, h.v, 'touchend', 300, 100);
  assert.strictEqual(h.v.playbackRate, 1, 'released');
});

test('a SINGLE tap then a hold inside the window: cancelled, but the first tap\'s pending pause lands first, so no 2x (unchanged from main, measured in Chromium too)', async () => {
  const h = await boot(VIDEO);
  tap(h, h.v, 100000);
  h.at(100040 + 150);
  const s = fire(h, h.v, 'touchstart', 300, 100);
  assert.strictEqual(s.defaultPrevented, true, 'no loupe');
  await wait(560);
  assert.strictEqual(h.pauses(), 1, 'the first tap paused (scheduleArtSingleTap is not cancelled by the next touch)');
  assert.strictEqual(h.v.playbackRate, 1, 'so the hold never engaged');
});

test('a PLAIN hold (no tap before it) is cancelled and still engages 2x; released, back to 1x (the device case, E1)', async () => {
  const h = await boot(VIDEO);
  h.at(100000);
  const s0 = fire(h, h.v, 'touchstart', 300, 100);
  assert.strictEqual(s0.defaultPrevented, true);
  await wait(560);
  assert.strictEqual(h.v.playbackRate, 2, 'held');
  assert.strictEqual(h.pauses(), 0);
  h.at(101000); fire(h, h.v, 'touchend', 300, 100);
  assert.strictEqual(h.v.playbackRate, 1);
});

test('a lone tap still pauses after the window (the cancel changes nothing about the tap)', async () => {
  const h = await boot(VIDEO);
  tap(h, h.v, 100000);
  await wait(420);
  assert.strictEqual(h.pauses(), 1);
});

test('docked: a touch is NOT cancelled (the tap must synthesize the expanding click)', async () => {
  const h = await boot(VIDEO);
  tap(h, h.v, 100000);
  h.p.dock();
  assert.strictEqual(h.p.getState(), 'docked');
  h.at(100040 + 100);
  const s = fire(h, h.v, 'touchstart', 300, 100);
  assert.strictEqual(s.defaultPrevented, false);
});

test('native-controls mode: never cancelled', async () => {
  const h = await boot(VIDEO);
  tap(h, h.v, 100000); // the lone tap is recorded on the custom surface first (native mode's touchend bails)
  h.host.classList.add('native-controls'); // then the native strip takes over (inNativeControlsMode reads this class)
  h.at(100040 + 100);
  const s = fire(h, h.v, 'touchstart', 300, 100);
  assert.strictEqual(s.defaultPrevented, false);
});

test('the cover art (an audio file) gets the same cancel', async () => {
  const h = await boot(AUDIO);
  assert.ok(h.art, 'the art surface exists');
  tap(h, h.art, 100000);
  h.at(100040 + 200);
  const s = fire(h, h.art, 'touchstart', 300, 100);
  assert.strictEqual(s.defaultPrevented, true);
  h.at(100040 + 240); fire(h, h.art, 'touchend', 300, 100);
});

test('gesture:tap-pair is logged when the flag is on, and nothing is written when it is off', async () => {
  let h = await boot(VIDEO, { debug: true });
  tap(h, h.v, 100000);
  h.at(100040 + 120); fire(h, h.v, 'touchstart', 300, 100);
  const log = JSON.parse(h.w.localStorage.getItem('ft-lifecycle-log') || '[]');
  const line = log.find((x) => x.type === 'gesture:tap-pair');
  assert.ok(line, 'a gesture:tap-pair line');
  assert.match(line.detail, /^video gap=120 chain=0$/);
  dom.window.close(); dom = null;
  h = await boot(VIDEO);
  tap(h, h.v, 100000);
  h.at(100040 + 120);
  assert.strictEqual(fire(h, h.v, 'touchstart', 300, 100).defaultPrevented, true, 'precondition: it cancelled');
  assert.strictEqual(h.w.localStorage.getItem('ft-lifecycle-log'), null, 'flag off: no log written');
});

test('native full screen: never cancelled', async () => {
  const h = await boot(VIDEO);
  Object.defineProperty(h.v, 'webkitDisplayingFullscreen', { value: true, configurable: true });
  tap(h, h.v, 100000);
  h.at(100040 + 100);
  const s = fire(h, h.v, 'touchstart', 300, 100);
  assert.strictEqual(s.defaultPrevented, false);
});

test('an upward drag from the picture: its START is cancelled at any time (the stated cost: no page scroll from the picture), its moves are untouched', async () => {
  const h = await boot(VIDEO);
  tap(h, h.v, 100000);
  h.at(101040);
  const s0 = fire(h, h.v, 'touchstart', 200, 200);
  const moves = [];
  for (let dy = 10; dy <= 80; dy += 10) { h.at(101040 + dy); moves.push(fire(h, h.v, 'touchmove', 200, 200 - dy)); }
  h.at(101200); fire(h, h.v, 'touchend', 200, 120);
  assert.strictEqual(s0.defaultPrevented, true);
  assert.ok(moves.every((m) => !m.defaultPrevented), 'no move is cancelled by this listener');
  await wait(420);
  assert.strictEqual(h.pauses(), 1, 'only the lone tap before it paused; the moved touch is not a tap');
});

test('E3: with "No glyph on picture taps" on, a picture tap still pauses but never flashes the glyph; off, it flashes (read at every tap)', async () => {
  const h = await boot(VIDEO);
  const glyph = h.doc.querySelector('.art-play-glyph');
  assert.ok(glyph, 'precondition: the glyph exists in the player');
  h.w.localStorage.setItem('ft-debug-no-tap-glyph', '1');
  tap(h, h.v, 100000);
  await wait(420);
  assert.strictEqual(h.pauses(), 1, 'the tap still paused');
  assert.strictEqual(glyph.classList.contains('art-play-glyph-flash'), false, 'nothing drawn over the video');
  h.w.localStorage.removeItem('ft-debug-no-tap-glyph');
  Object.defineProperty(h.v, 'paused', { value: true, configurable: true });
  tap(h, h.v, 110000);
  await wait(420);
  assert.strictEqual(glyph.classList.contains('art-play-glyph-flash'), true, 'switch off: the glyph flashes again at once');
});

test('E3 gate r1: the switch also silences the ART tap (an audio file); off, the art flashes', async () => {
  const h = await boot(AUDIO);
  const glyph = h.doc.querySelector('.art-play-glyph');
  assert.ok(glyph && h.art);
  h.w.localStorage.setItem('ft-debug-no-tap-glyph', '1');
  tap(h, h.art, 100000);
  await wait(420);
  assert.strictEqual(h.pauses(), 1, 'the art tap still paused');
  assert.strictEqual(glyph.classList.contains('art-play-glyph-flash'), false);
  h.w.localStorage.removeItem('ft-debug-no-tap-glyph');
  Object.defineProperty(h.v, 'paused', { value: true, configurable: true });
  tap(h, h.art, 110000);
  await wait(420);
  assert.strictEqual(glyph.classList.contains('art-play-glyph-flash'), true);
});
