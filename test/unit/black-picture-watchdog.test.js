'use strict';

// [UNIT] v1.360 - the black picture after a pause (plan 2026-10-03-black-screen-after-pauses).
// Two changes, both bound by invocation: (1) the background-audio gesture prime never starts the
// sidecar under a PLAYING video (the tap that pauses it), and (2) the frozen-picture watchdog
// re-seeks the video in place when its frame count stands still while its clock runs. The pure
// decisions are called directly; then the REAL player.js is driven in a jsdom watch shell (the
// hold-lock harness shape) through its real listeners, so a decision that is never reached by
// the real events cannot pass (LESSONS 2, inert feature).

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

// ---- pure: frozenPictureDecision / framesClimbed ------------------------------

const R = (frames, t, at, ok) => ({ frames, t, at, ok: ok !== false });
const OPTS = { climbed: true, windowMs: 6000, minAdvanceS: 4 };

test('frozenPictureDecision: heal only when the count stood still for the whole window while the clock ran, after a seen climb', () => {
  const d = player.frozenPictureDecision;
  assert.strictEqual(typeof d, 'function', 'exported');
  const since = R(64, 2.0, 0);
  assert.strictEqual(d(Object.assign({ since, now: R(64, 8.0, 6000) }, OPTS)), 'heal', 'Dean\'s capture shape: f=64 flat, t 2.0 -> 8.0 over 6 s');
  assert.strictEqual(d(Object.assign({ since, now: R(64, 8.0, 5999) }, OPTS)), 'wait', 'one ms short of the window');
  assert.strictEqual(d(Object.assign({ since, now: R(64, 5.9, 6000) }, OPTS)), 'wait', 'the clock ran less than 4 s (a stall, not a frozen picture)');
  assert.strictEqual(d(Object.assign({ since, now: R(65, 8.0, 6000) }, OPTS)), 'reset', 'the count moved');
  assert.strictEqual(d(Object.assign({ since, now: R(64, 1.0, 6000) }, OPTS)), 'reset', 'a seek back');
  assert.strictEqual(d(Object.assign({ since, now: R(64, 8.0, 6000, false) }, OPTS)), 'reset', 'not eligible now (paused, hidden, off screen)');
  assert.strictEqual(d(Object.assign({ since: R(64, 2.0, 0, false), now: R(64, 8.0, 6000) }, OPTS)), 'reset', 'not eligible at the start');
  assert.strictEqual(d(Object.assign({}, OPTS, { since, now: R(64, 8.0, 6000), climbed: false })), 'wait', 'a count never seen climbing (a one-frame still) is never healed');
  assert.strictEqual(d(Object.assign({ since, now: R(null, 8.0, 6000) }, OPTS)), 'off', 'no frame counter on this engine');
  assert.strictEqual(d(Object.assign({ since: {}, now: R(64, 8.0, 6000) }, OPTS)), 'reset', 'no start reading yet');
  assert.strictEqual(d(), 'off');
});

test('framesClimbed: at least minFrames and minFps per second of media time', () => {
  const c = player.framesClimbed;
  assert.strictEqual(typeof c, 'function', 'exported');
  assert.strictEqual(c(R(1, 0), R(58, 1.9), 10, 5), true, 'Dean\'s first play: f 1 -> 58 over 1.9 s');
  assert.strictEqual(c(R(1, 0), R(10, 0.5), 10, 5), false, '9 frames is under the floor (even at 18 fps)');
  assert.strictEqual(c(R(1, 0), R(11, 0.5), 10, 5), true, '10 frames at 20 fps is a climb');
  assert.strictEqual(c(R(1, 0), R(20, 10), 10, 5), false, '1.9 fps is not a real frame rate');
  assert.strictEqual(c(R(1, 0), R(58, 0), 10, 5), false, 'no media time');
  assert.strictEqual(c(R(null, 0), R(58, 1.9), 10, 5), false);
  assert.strictEqual(c(), false);
});

// ---- behaviour: the real player in jsdom ---------------------------------------

let dom = null;
afterEach(() => { if (dom) { dom.window.close(); dom = null; } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(settings, item) {
  dom = new JSDOM(WATCH, { url: 'http://localhost/watch.html?v=v1', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'platform', { value: 'iPhone' });
  w.matchMedia = (q) => ({ matches: /coarse|hover: none|max-width/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.fetch = async (url) => {
    if (/prepare-audio/.test(String(url))) return { ok: true, status: 200, json: async () => ({ audioStatus: 'ready' }), text: async () => '' };
    return { ok: true, status: 200, json: async () => Object.assign({ mobileCustomPlayer: true }, settings || {}), text: async () => '' };
  };
  const plays = [];
  // Every play()/pause() in order, with whether the VIDEO read paused at that moment (the H8
  // measure: the sidecar must never play or pause under a playing video).
  const calls = [];
  const hook = { st: null };
  const isVideo = (el) => el.id === 'media-player';
  const videoPaused = () => (hook.st ? hook.st.paused : true);
  w.HTMLMediaElement.prototype.play = function () {
    plays.push(this.id || this.tagName);
    if (isVideo(this) && hook.st) hook.st.paused = false;
    calls.push({ op: 'play', id: this.id, videoPaused: videoPaused() });
    return Promise.resolve();
  };
  w.HTMLMediaElement.prototype.pause = function () {
    if (isVideo(this) && hook.st) hook.st.paused = true;
    calls.push({ op: 'pause', id: this.id, videoPaused: videoPaused() });
  };
  w.HTMLMediaElement.prototype.load = function () {};
  w.scrollTo = () => {};
  // The watchdog's interval and clock are driven by hand: its tick is captured by name, and
  // Date.now reads a clock the test advances, so a 6 s window costs no real time.
  const clock = { now: 1e12 };
  w.Date.now = () => clock.now;
  const ticks = [];
  const realSetInterval = w.setInterval.bind(w);
  const realClearInterval = w.clearInterval.bind(w);
  w.setInterval = (fn, ms) => {
    if (fn && fn.name === 'tickFrozenPictureWatch') { const id = { fn, ms, live: true }; ticks.push(id); return id; }
    return realSetInterval(fn, ms);
  };
  w.clearInterval = (id) => { if (id && typeof id === 'object' && 'live' in id) { id.live = false; return; } realClearInterval(id); };
  w.eval(COMMON_SRC.slice(COMMON_SRC.indexOf('function resolveAudioArtUrl('), COMMON_SRC.indexOf('\n}\n', COMMON_SRC.indexOf('function resolveAudioArtUrl(')) + 3));
  w.eval(LOCK_SRC);
  w.eval(PLAYER_SRC);
  const slot = w.document.createElement('div'); slot.id = 'player-slot'; w.document.body.appendChild(slot);
  const p = w.FileTube.player;
  const it = item || { id: 'v1', title: 'T', type: 'video', ext: '.mp4' };
  assert.strictEqual(p.load(it.id, it, { slot }), true, 'the real player loaded the item');
  await wait(60);
  const v = w.document.getElementById('media-player');
  // The video's media state, owned by the test.
  const st = { paused: false, frames: 0, t: 0, seeks: [], seeking: false, readyState: 4, videoWidth: 640 };
  hook.st = st;
  Object.defineProperty(v, 'paused', { get: () => st.paused, configurable: true });
  Object.defineProperty(v, 'ended', { get: () => false, configurable: true });
  Object.defineProperty(v, 'seeking', { get: () => st.seeking, configurable: true });
  Object.defineProperty(v, 'readyState', { get: () => st.readyState, configurable: true });
  Object.defineProperty(v, 'videoWidth', { get: () => st.videoWidth, configurable: true });
  Object.defineProperty(v, 'currentTime', { get: () => st.t, set: (x) => { st.seeks.push(x); st.t = x; }, configurable: true });
  v.getVideoPlaybackQuality = () => ({ totalVideoFrames: st.frames, droppedVideoFrames: 0 });
  v.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 225, right: 400, bottom: 225 });
  const live = () => ticks.filter((x) => x.live);
  // One watchdog second: the clock and the media clock advance, the count by `fps` frames.
  const second = (fps) => { clock.now += 1000; st.t += 1; st.frames += fps; live().forEach((x) => x.fn()); };
  const log = () => JSON.parse(w.localStorage.getItem('ft-lifecycle-log') || '[]').map((e) => e.type + ' ' + (e.detail || ''));
  return { w, doc: w.document, p, v, st, plays, calls, clock, live, second, log, bgAudio: w.document.getElementById('bg-audio-sidecar') };
}
const fireMedia = (h, type) => h.v.dispatchEvent(new h.w.Event(type));
function touch(h, el, type) {
  const e = new h.w.Event(type, { bubbles: true, cancelable: true });
  const list = [{ clientX: 200, clientY: 100 }];
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : list });
  Object.defineProperty(e, 'changedTouches', { value: list });
  el.dispatchEvent(e);
}
const BG_ON = { backgroundAudioForVideo: true };

// (1) the prime ----------------------------------------------------------------

test('prime: a touch on a PLAYING video never starts the sidecar (red before v1.360: the pause tap played it)', async () => {
  const h = await boot(BG_ON);
  assert.ok(h.bgAudio, 'the sidecar exists');
  h.st.paused = false;
  touch(h, h.v, 'touchstart');
  assert.deepStrictEqual(h.plays.filter((x) => x === 'bg-audio-sidecar'), [], 'no sidecar play under a playing video');
});

test('prime: the next touch on a PAUSED video still primes, once (the guard does not consume the one-shot)', async () => {
  const h = await boot(BG_ON);
  h.st.paused = false;
  touch(h, h.v, 'touchstart');
  h.st.paused = true;
  touch(h, h.v, 'touchstart');
  assert.deepStrictEqual(h.plays.filter((x) => x === 'bg-audio-sidecar'), ['bg-audio-sidecar'], 'primed on the play tap');
  assert.strictEqual(h.bgAudio.muted, true, 'muted while the prime play is in flight');
  touch(h, h.v, 'touchstart');
  assert.strictEqual(h.plays.filter((x) => x === 'bg-audio-sidecar').length, 1, 'still one-shot');
});

test('prime: the bar\'s button primes on a PAUSE press, after the pause; a PLAY press does not prime (red before the r1 fix: the play press primed and the prime\'s pause landed under the playing video)', async () => {
  const h = await boot(BG_ON);
  const pp = h.doc.getElementById('pp-btn');
  assert.ok(pp, 'the bar\'s play button');
  h.st.paused = true;
  pp.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 }));
  await wait(10);
  assert.strictEqual(h.st.paused, false, 'the play press played the video');
  assert.strictEqual(h.plays.filter((x) => x === 'bg-audio-sidecar').length, 0, 'a play press does not prime');
  pp.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 }));
  await wait(10);
  assert.strictEqual(h.st.paused, true, 'the pause press paused the video');
  assert.strictEqual(h.plays.filter((x) => x === 'bg-audio-sidecar').length, 1, 'the pause press primed');
  const side = h.calls.filter((c) => c.id === 'bg-audio-sidecar');
  assert.ok(side.length >= 2, 'the prime played and paused the sidecar: ' + JSON.stringify(h.calls));
  assert.deepStrictEqual(side.filter((c) => !c.videoPaused), [], 'no sidecar play or pause ever ran under a playing video');
});

test('prime: across a picture-tap pause and play and the bar\'s pause and play, the sidecar never plays or pauses under a playing video', async () => {
  const h = await boot(BG_ON);
  const pp = h.doc.getElementById('pp-btn');
  h.st.paused = false; // it started by itself
  touch(h, h.v, 'touchstart'); h.v.pause(); await wait(5); // the pause tap
  touch(h, h.v, 'touchstart'); await wait(5); h.v.play(); await wait(5); // the play tap (the prime first, the video 350 ms later)
  pp.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 })); await wait(5);
  pp.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 })); await wait(5);
  const side = h.calls.filter((c) => c.id === 'bg-audio-sidecar');
  assert.ok(side.length >= 2, 'it primed: ' + JSON.stringify(h.calls));
  assert.deepStrictEqual(side.filter((c) => !c.videoPaused), []);
});

// (2) the watchdog -------------------------------------------------------------

// Dean's capture: a first play whose count climbs, a pause, a resume after which the count stands still.
async function frozenAfterResume() {
  const h = await boot({});
  fireMedia(h, 'playing');
  assert.strictEqual(h.live().length, 1, 'the watchdog runs while playing');
  h.second(30);
  h.second(30);
  h.st.paused = true;
  fireMedia(h, 'pause');
  assert.strictEqual(h.live().length, 0, 'and stops on pause');
  h.st.paused = false;
  fireMedia(h, 'playing');
  return h;
}

test('watchdog: a count standing still for 6 s while the clock runs re-seeks the video in place, once', async () => {
  const h = await frozenAfterResume();
  for (let i = 0; i < 5; i++) h.second(0);
  assert.deepStrictEqual(h.st.seeks, [], 'not before the 6 s window has passed');
  h.second(0);
  assert.strictEqual(h.st.seeks.length, 1, 'one in-place seek');
  assert.strictEqual(h.st.seeks[0], h.st.t, 'to the video\'s own position');
  h.second(30);
  h.second(30);
  for (let i = 0; i < 10; i++) h.second(30);
  assert.strictEqual(h.st.seeks.length, 1, 'a healthy count after the heal never seeks again');
});

test('watchdog: a healthy video is never touched', async () => {
  const h = await boot({});
  fireMedia(h, 'playing');
  for (let i = 0; i < 60; i++) h.second(30);
  assert.deepStrictEqual(h.st.seeks, []);
});

test('watchdog: a count that only refreshes every 2 s (the iOS cached copy) is healthy', async () => {
  const h = await boot({});
  fireMedia(h, 'playing');
  for (let i = 0; i < 60; i++) { h.clock.now += 1000; h.st.t += 1; if (i % 2 === 1) h.st.frames += 60; h.live().forEach((x) => x.fn()); }
  assert.deepStrictEqual(h.st.seeks, []);
});

test('watchdog: a one-frame video (the count never climbs) is never healed', async () => {
  const h = await boot({});
  h.st.frames = 1;
  fireMedia(h, 'playing');
  for (let i = 0; i < 60; i++) h.second(0);
  assert.deepStrictEqual(h.st.seeks, [], 'no climb seen, no heal');
});

test('watchdog: at most two heals per load, then it gives up', async () => {
  const h = await frozenAfterResume();
  for (let i = 0; i < 60; i++) h.second(0);
  assert.strictEqual(h.st.seeks.length, 2);
  assert.strictEqual(h.live().length, 0, 'stopped watching');
});

test('watchdog: not while hidden, off screen, or on desktop', async () => {
  const h = await frozenAfterResume();
  Object.defineProperty(h.doc, 'visibilityState', { get: () => 'hidden', configurable: true });
  for (let i = 0; i < 20; i++) h.second(0);
  assert.deepStrictEqual(h.st.seeks, [], 'hidden: the layer legitimately stops');
  Object.defineProperty(h.doc, 'visibilityState', { get: () => 'visible', configurable: true });
  h.v.getBoundingClientRect = () => ({ left: 0, top: -500, width: 400, height: 225, right: 400, bottom: -275 });
  for (let i = 0; i < 20; i++) h.second(0);
  assert.deepStrictEqual(h.st.seeks, [], 'scrolled off screen');
  if (dom) { dom.window.close(); dom = null; }
  const d = await boot({});
  d.w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  fireMedia(d, 'playing');
  assert.strictEqual(d.live().length, 0, 'desktop: never runs');
});

test('watchdog: a new load stops it and starts its counters fresh', async () => {
  const h = await frozenAfterResume();
  assert.strictEqual(h.live().length, 1);
  h.p.load('v2', { id: 'v2', title: 'T2', type: 'video', ext: '.mp4' }, {});
  await wait(30);
  assert.strictEqual(h.live().length, 0, 'the old watch died with its load');
});

test('watchdog: with ?debugLifecycle=1 on, the heal and its outcome are log lines (video:heal, then video:heal-ok once the count really climbs)', async () => {
  const h = await frozenAfterResume();
  h.w.localStorage.setItem('ft-debug-lifecycle', '1');
  for (let i = 0; i < 6; i++) h.second(0);
  assert.strictEqual(h.st.seeks.length, 1);
  h.second(30);
  const lines = h.log();
  const heal = lines.findIndex((x) => /^video:heal f=\d+ t=[\d.]+->[\d.]+ n=1$/.test(x));
  const ok = lines.findIndex((x) => /^video:heal-ok f=\d+->\d+ t=[\d.]+ n=1$/.test(x));
  assert.ok(heal !== -1, 'video:heal logged: ' + lines.join(' | '));
  assert.ok(ok > heal, 'video:heal-ok logged after it, on the very next tick: ' + lines.join(' | '));
});

test('watchdog: ONE frame after a heal is not a heal-ok; it freezes again, heals a second time, then logs gave-up and stops', async () => {
  const h = await frozenAfterResume();
  h.w.localStorage.setItem('ft-debug-lifecycle', '1');
  for (let i = 0; i < 6; i++) h.second(0);
  assert.strictEqual(h.st.seeks.length, 1);
  h.second(1); // the seek presented one frame
  for (let i = 0; i < 6; i++) h.second(0);
  assert.strictEqual(h.st.seeks.length, 2, 'a second heal');
  for (let i = 0; i < 6; i++) h.second(0);
  assert.strictEqual(h.st.seeks.length, 2, 'never a third seek');
  assert.strictEqual(h.live().length, 0, 'stopped');
  const lines = h.log();
  assert.deepStrictEqual(lines.filter((x) => /^video:heal-ok/.test(x)), [], 'no false success: ' + lines.join(' | '));
  assert.strictEqual(lines.filter((x) => /^video:heal f=/.test(x)).length, 2);
  assert.ok(lines.some((x) => /^video:heal-gave-up f=\d+ t=[\d.]+ n=2$/.test(x)), 'gave-up logged: ' + lines.join(' | '));
  h.st.paused = true; fireMedia(h, 'pause'); h.st.paused = false; fireMedia(h, 'playing');
  assert.strictEqual(h.live().length, 0, 'once it gave up, this load is not watched again');
});

test('watchdog: a first play too short for a tick to see the climb still counts (the pause reading proves it; Dean\'s f 1 -> 58 in 1.9 s)', async () => {
  const h = await boot({});
  h.st.frames = 1;
  fireMedia(h, 'playing');
  h.clock.now += 1000; h.st.t += 1; h.live().forEach((x) => x.fn()); // the cached copy has not refreshed yet
  h.clock.now += 900; h.st.t += 0.9; h.st.frames = 58;
  h.st.paused = true;
  fireMedia(h, 'pause');
  h.st.paused = false;
  fireMedia(h, 'playing');
  for (let i = 0; i < 6; i++) h.second(0);
  assert.strictEqual(h.st.seeks.length, 1, 'healed: the climb was seen at the pause');
});

test('watchdog: a video that reads paused is never healed, even if no pause event arrived', async () => {
  const h = await frozenAfterResume();
  h.st.paused = true;
  for (let i = 0; i < 20; i++) h.second(0);
  assert.deepStrictEqual(h.st.seeks, []);
});

for (const [what, set] of [
  ['seeking', (st) => { st.seeking = true; }],
  ['readyState below 2 (no current frame data)', (st) => { st.readyState = 1; }],
  ['no picture size (videoWidth 0)', (st) => { st.videoWidth = 0; }],
]) {
  test('watchdog: no heal while ' + what, async () => {
    const h = await frozenAfterResume();
    set(h.st);
    for (let i = 0; i < 20; i++) h.second(0);
    assert.deepStrictEqual(h.st.seeks, []);
  });
}

test('watchdog: never for an audio item', async () => {
  const h = await boot({}, { id: 'a1', title: 'A', type: 'audio', ext: '.mp3' });
  fireMedia(h, 'playing');
  assert.strictEqual(h.live().length, 0);
});

test('watchdog: ended stops it, and so does closing the player', async () => {
  const h = await frozenAfterResume();
  fireMedia(h, 'ended');
  assert.strictEqual(h.live().length, 0, 'ended');
  h.st.seeks.length = 0; // the ended cascade's own rewind to 0 is not the watchdog's
  fireMedia(h, 'playing');
  assert.strictEqual(h.live().length, 1);
  fireMedia(h, 'emptied');
  assert.strictEqual(h.live().length, 0, 'emptied (the src went away)');
  fireMedia(h, 'playing');
  assert.strictEqual(h.live().length, 1);
  h.p.close();
  h.second(0);
  assert.strictEqual(h.live().length, 0, 'closed: the next tick sees the new generation and stops');
  for (let i = 0; i < 20; i++) h.second(0);
  assert.deepStrictEqual(h.st.seeks, []);
});

test('watchdog: a variable-frame-rate still LATER in a session whose picture moved is never healed (the gate r1 webm shape)', async () => {
  const h = await frozenAfterResume(); // this load's counter is proven live, a new session is playing
  for (let i = 0; i < 3; i++) h.second(30); // motion
  for (let i = 0; i < 10; i++) h.second(0); // an 8 s+ still held as one frame
  for (let i = 0; i < 3; i++) h.second(30);
  assert.deepStrictEqual(h.st.seeks, []);
});

test('watchdog: a freeze on the very first play, before any pause, is not healed (no proof yet that the counter is live)', async () => {
  const h = await boot({});
  h.st.frames = 1;
  fireMedia(h, 'playing');
  for (let i = 0; i < 20; i++) h.second(0);
  assert.deepStrictEqual(h.st.seeks, []);
});

test('watchdog: a second load starts fresh: it heals again after the first load used both heals, and a one-frame still there is never healed', async () => {
  const h = await frozenAfterResume();
  for (let i = 0; i < 20; i++) h.second(0);
  assert.strictEqual(h.st.seeks.length, 2, 'load 1 used both heals');
  h.p.load('v2', { id: 'v2', title: 'T2', type: 'video', ext: '.mp4' }, {});
  await wait(30);
  h.st.seeks.length = 0;
  h.st.frames = 500; h.st.t = 0; h.st.paused = false;
  fireMedia(h, 'playing');
  h.second(30); h.second(30);
  h.st.paused = true; fireMedia(h, 'pause'); h.st.paused = false; fireMedia(h, 'playing');
  for (let i = 0; i < 7; i++) h.second(0);
  assert.strictEqual(h.st.seeks.length, 1, 'load 2 heals (its heal count started at 0)');
  h.p.load('v3', { id: 'v3', title: 'T3', type: 'video', ext: '.mp4' }, {});
  await wait(30);
  h.st.seeks.length = 0; h.st.t = 0; h.st.paused = false;
  fireMedia(h, 'playing'); // a one-frame still: the count never climbs on this load
  for (let i = 0; i < 20; i++) h.second(0);
  assert.deepStrictEqual(h.st.seeks, [], 'load 3 never saw a climb (the previous load\'s does not carry over)');
});

for (const [what, rect] of [
  ['left of the screen', { left: -500, top: 0, width: 400, height: 225, right: -100, bottom: 225 }],
  ['right of the screen', { left: 2000, top: 0, width: 400, height: 225, right: 2400, bottom: 225 }],
  ['below the screen', { left: 0, top: 5000, width: 400, height: 225, right: 400, bottom: 5225 }],
  ['zero-size', { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }],
]) {
  test('watchdog: no heal while the video is ' + what, async () => {
    const h = await frozenAfterResume();
    h.v.getBoundingClientRect = () => rect;
    for (let i = 0; i < 20; i++) h.second(0);
    assert.deepStrictEqual(h.st.seeks, []);
  });
}

test('watchdog: no heal in a native presentation (iOS full screen or picture in picture); inline still heals', async () => {
  const h = await frozenAfterResume();
  h.v.webkitPresentationMode = 'picture-in-picture';
  for (let i = 0; i < 20; i++) h.second(0);
  assert.deepStrictEqual(h.st.seeks, []);
  h.v.webkitPresentationMode = 'inline';
  for (let i = 0; i < 7; i++) h.second(0);
  assert.strictEqual(h.st.seeks.length, 1);
});
