'use strict';

// [UNIT] v1.362.2 W2 (plan 2026-10-04-loupe-black-checks, D2/D5/D6) - the black-picture instrument. The pure
// frozen decision is bound against the iPhone's ~2 s cached frame count; then the REAL player.js runs in a
// jsdom watch shell (the minimize-player harness shape) with the lifecycle flag on: the sampler's start and
// every stop boundary, ZERO timers with the flag off, each play/pause source's `via`, the rate and hold
// lines, the 1000-entry cap, and the opt-in panel that a tap no longer clears.

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

// ---- pure: frozenPictureDecision ------------------------------------------------

const series = (rows) => rows.map(([s, t, f]) => ({ wall: s * 1000, t, f }));

test('frozenPictureDecision: the iPhone cached count (flat 2 s, then a jump) is NOT frozen', () => {
  const d = player.frozenPictureDecision;
  assert.strictEqual(typeof d, 'function', 'exported');
  // A healthy 30 fps stream read through a ~2 s cache: three equal reads (2 s), then it jumps.
  const healthy = series([[0, 10, 300], [1, 11, 300], [2, 12, 300], [3, 13, 390], [4, 14, 390], [5, 15, 390], [6, 16, 480]]);
  for (let n = 2; n <= healthy.length; n++) assert.strictEqual(d(healthy.slice(0, n)), false, 'prefix of ' + n);
});

test('frozenPictureDecision: a true freeze (count flat 4 s while the clock runs 4 s) IS frozen; its onset is at 3 s', () => {
  const d = player.frozenPictureDecision;
  const frozen = series([[0, 10, 300], [1, 11, 300], [2, 12, 300], [3, 13, 300], [4, 14, 300]]);
  assert.strictEqual(d(frozen.slice(0, 3)), false, '2 s flat: could be the cache');
  assert.strictEqual(d(frozen.slice(0, 4)), true, '3 s flat with the clock +3 s');
  assert.strictEqual(d(frozen), true);
  // After a healthy run, only the TRAILING equal run counts.
  const late = series([[0, 10, 100], [1, 11, 200], [2, 12, 300], [3, 13, 300], [4, 14, 300], [5, 15, 300]]);
  assert.strictEqual(d(late), true, 'flat from 2 s to 5 s');
  assert.strictEqual(d(late.slice(0, 5)), false, 'flat from 2 s to 4 s only');
});

test('frozenPictureDecision: paused (clock flat) or a clock under 2 s is NOT frozen; missing counts never are', () => {
  const d = player.frozenPictureDecision;
  assert.strictEqual(d(series([[0, 10, 300], [1, 10, 300], [2, 10, 300], [3, 10, 300], [4, 10, 300]])), false, 'clock flat');
  assert.strictEqual(d(series([[0, 10, 300], [1, 10.5, 300], [2, 11, 300], [3, 11.9, 300]])), false, 'clock +1.9 s');
  assert.strictEqual(d(series([[0, 10, 300], [1, 10.5, 300], [2, 11, 300], [3, 12, 300]])), true, 'clock +2.0 s at 3 s');
  assert.strictEqual(d(series([[0, 10, null], [1, 11, null], [2, 12, null], [3, 13, null], [4, 14, null]])), false, 'no frame count');
  assert.strictEqual(d([]), false);
  assert.strictEqual(d(), false);
  assert.strictEqual(d(series([[0, 10, 300]])), false, 'one reading is never a verdict');
  // A gap in the readings breaks the run.
  assert.strictEqual(d(series([[0, 10, 300], [1, 11, null], [2, 12, 300], [3, 13, 300], [4, 14, 300]])), false, 'the run starts after the gap: 2 s');
});

// ---- behaviour: the real player in jsdom ----------------------------------------

let dom = null;
afterEach(() => { if (dom) { dom.window.close(); dom = null; } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SAMPLE_MS = 20; // the drive's sample period; the real 1000 is asserted on the source below
const SCALE = 1000 / SAMPLE_MS; // the player's clock runs SCALE x real time, so one drive sample = one wall second

async function boot(item, o) {
  const opt = o || {};
  dom = new JSDOM(WATCH, { url: 'http://localhost/watch.html?v=' + item.id, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'platform', { value: 'iPhone' });
  w.matchMedia = (q) => ({ media: q, matches: /coarse|hover: none|max-width/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(w, 'innerHeight', { value: 664, configurable: true });
  Object.defineProperty(w, 'innerWidth', { value: 390, configurable: true });
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ mobileCustomPlayer: true }), text: async () => '' });
  const setPaused = (el, v) => Object.defineProperty(el, 'paused', { value: v, configurable: true });
  w.HTMLMediaElement.prototype.play = function () { setPaused(this, false); this.dispatchEvent(new w.Event('play')); return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () { setPaused(this, true); this.dispatchEvent(new w.Event('pause')); };
  w.HTMLMediaElement.prototype.load = function () {};
  w.scrollTo = () => {};
  if (opt.flag !== false) w.localStorage.setItem('ft-debug-lifecycle', '1');
  if (opt.overlay) w.localStorage.setItem('ft-debug-lifecycle-overlay', '1');
  w.document.body.setAttribute('data-view', 'watch');
  // MediaSession: keep the registered handlers so a lock-screen action can be driven.
  const ms = {};
  Object.defineProperty(w.navigator, 'mediaSession', { value: { setActionHandler: (a, h) => { ms[a] = h; }, metadata: null, playbackState: 'none' }, configurable: true });
  // The frozen sampler's timers, counted live by the callback's name.
  const live = new Map();
  const origSet = w.setTimeout.bind(w); const origClear = w.clearTimeout.bind(w);
  w.setTimeout = (fn, ms2) => {
    const id = origSet(function () { live.delete(id); fn(); }, ms2);
    if (fn && fn.name === 'frozenSampleTick') live.set(id, true);
    return id;
  };
  w.clearTimeout = (id) => { live.delete(id); origClear(id); };
  w.eval(COMMON_SRC.slice(COMMON_SRC.indexOf('function resolveAudioArtUrl('), COMMON_SRC.indexOf('\n}\n', COMMON_SRC.indexOf('function resolveAudioArtUrl(')) + 3));
  w.eval(COMMON_SRC.slice(COMMON_SRC.indexOf('function formatDuration('), COMMON_SRC.indexOf('\n}\n', COMMON_SRC.indexOf('function formatDuration(')) + 3));
  w.eval(LOCK_SRC);
  const NEEDLE = 'var FROZEN_SAMPLE_EVERY_MS = 1000;';
  assert.strictEqual(PLAYER_SRC.split(NEEDLE).length, 2, 'the sample period is defined once');
  w.eval(PLAYER_SRC.replace(NEEDLE, 'var FROZEN_SAMPLE_EVERY_MS = ' + SAMPLE_MS + ';'));
  // The player's clock runs SCALE x real time from here on.
  const realNow = Date.now; const t0 = realNow();
  w.Date.now = () => t0 + (realNow() - t0) * SCALE;
  w.FileTube.leaveWatchForBrowse = () => {};
  const slot = w.document.createElement('div'); slot.id = 'player-slot'; w.document.body.appendChild(slot);
  const p = w.FileTube.player;
  assert.strictEqual(p.load(item.id, item, { slot }), true, 'the real player loaded the item');
  await wait(60);
  const v = w.document.getElementById('media-player');
  const host = w.document.getElementById('player-wrapper');
  const rect = { left: 0, top: 0, x: 0, y: 0, width: 390, height: 260, right: 390, bottom: 260 };
  v.getBoundingClientRect = () => rect;
  host.getBoundingClientRect = () => rect;
  const art = w.document.getElementById('audio-bg-art');
  if (art) art.getBoundingClientRect = () => rect;
  Object.defineProperty(v, 'duration', { value: 600, configurable: true });
  // The layer's frame count and the media clock, driven by the test.
  const layer = { frames: 100, t: 10 };
  v.getVideoPlaybackQuality = () => ({ totalVideoFrames: layer.frames, droppedVideoFrames: 0 });
  Object.defineProperty(v, 'currentTime', { get: () => layer.t, set: (x) => { layer.t = x; }, configurable: true });
  const log = () => { try { return JSON.parse(w.localStorage.getItem('ft-lifecycle-log') || '[]'); } catch (_) { return []; } };
  const clearLog = () => w.localStorage.removeItem('ft-lifecycle-log');
  return { w, doc: w.document, p, v, host, art, layer, live, log, clearLog, ms, setPaused };
}
const VIDEO = { id: 'v1', title: 'T', type: 'video', ext: '.mp4' };
const AUDIO = { id: 'a1', title: 'A', type: 'audio', ext: '.mp3', hasThumbnail: true };
const types = (h) => h.log().map((e) => e.type);

// Playing: paused false and a 'playing' event (what the browser fires once frames flow).
function playing(h) { h.setPaused(h.v, false); h.v.dispatchEvent(new h.w.Event('playing')); }
// Run n drive samples with the media clock advancing 1 s per sample and the count from `frames(i)`.
async function run(h, n, frames) {
  for (let i = 0; i < n; i++) { h.layer.t += 1; h.layer.frames = frames(i, h.layer.frames); await wait(SAMPLE_MS); }
}

test('the real sample period is one second, and the sampler is bounded to one timer', () => {
  assert.match(PLAYER_SRC, /var FROZEN_SAMPLE_EVERY_MS = 1000;/);
  assert.match(PLAYER_SRC, /function startFrozenSampler\(\) \{\n {4}if \(frozenSampleTimer \|\| !frozenSamplerEligible\(\)\) return;/);
});

test('flag OFF: playing, visibility and expand start NOTHING (zero sampler timers) and no line is written', async () => {
  const h = await boot(VIDEO, { flag: false });
  playing(h);
  h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
  await run(h, 6, (i, f) => f); // frozen count: still nothing
  assert.strictEqual(h.live.size, 0, 'no sampler timer');
  assert.strictEqual(h.w.localStorage.getItem('ft-lifecycle-log'), null, 'nothing recorded');
});

test('a frozen layer while the clock runs logs video:frozen ONCE with the last 6 counts, then video:thawed when frames move', async () => {
  const h = await boot(VIDEO);
  playing(h);
  assert.strictEqual(h.live.size, 1, 'one sampler timer after playing');
  playing(h);
  assert.strictEqual(h.live.size, 1, 'a second playing never adds a second timer');
  h.clearLog();
  await run(h, 8, (i, f) => f); // flat for 8 s
  assert.deepStrictEqual(types(h).filter((x) => /^video:(frozen|thawed)$/.test(x)), ['video:frozen'], 'one onset line');
  const line = h.log().find((e) => e.type === 'video:frozen');
  assert.match(line.detail, / fser=100,100,100,100(,100)*$/, 'the last counts');
  assert.match(line.detail, /f=100\//);
  await run(h, 2, (i, f) => f + 30);
  assert.deepStrictEqual(types(h).filter((x) => /^video:(frozen|thawed)$/.test(x)), ['video:frozen', 'video:thawed']);
  assert.strictEqual(h.live.size, 1, 'still sampling');
});

test('a healthy stream read through the ~2 s cache never logs video:frozen', async () => {
  const h = await boot(VIDEO);
  playing(h);
  h.clearLog();
  await run(h, 12, (i, f) => (i % 2 === 1 ? f + 60 : f)); // jumps every 2 s
  assert.ok(!types(h).includes('video:frozen'));
});

for (const [name, act] of [
  ['pause', (h) => h.v.pause()],
  ['ended', (h) => { Object.defineProperty(h.v, 'ended', { value: true, configurable: true }); h.v.dispatchEvent(new h.w.Event('ended')); }],
  ['emptied', (h) => h.v.dispatchEvent(new h.w.Event('emptied'))],
  ['loadstart', (h) => h.v.dispatchEvent(new h.w.Event('loadstart'))],
  // r0 mutant W2-M7: the hide's background rule pauses the video, which would stop the sampler by itself; keep the
  // video playing through the hide (pause a no-op) so only the hide's own stop can pass this.
  ['a hide', (h) => { h.v.pause = () => {}; Object.defineProperty(h.w.document, 'visibilityState', { value: 'hidden', configurable: true }); h.w.document.dispatchEvent(new h.w.Event('visibilitychange')); assert.strictEqual(h.v.paused, false, 'still playing through the hide'); }],
  ['a dock', (h) => h.p.dock()],
  ['a close', (h) => h.p.close()],
  ['a new load', (h) => h.p.load('v2', { id: 'v2', title: 'T2', type: 'video', ext: '.mp4' }, { slot: h.doc.getElementById('player-slot') })],
]) {
  test('the sampler stops on ' + name + ' (zero timers after it)', async () => {
    const h = await boot(VIDEO);
    playing(h);
    assert.strictEqual(h.live.size, 1, 'precondition: sampling');
    act(h);
    assert.strictEqual(h.live.size, 0, 'no timer after ' + name);
    await wait(SAMPLE_MS * 3);
    assert.strictEqual(h.live.size, 0, 'and none re-armed');
  });
}

test('the sampler stops when the flag goes off (at its next tick), and a visible return or an expand resumes it', async () => {
  const h = await boot(VIDEO);
  playing(h);
  h.w.localStorage.removeItem('ft-debug-lifecycle');
  await wait(SAMPLE_MS * 3);
  assert.strictEqual(h.live.size, 0, 'flag off: stopped');
  h.w.localStorage.setItem('ft-debug-lifecycle', '1');
  Object.defineProperty(h.w.document, 'visibilityState', { value: 'hidden', configurable: true });
  h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
  assert.strictEqual(h.live.size, 0);
  h.setPaused(h.v, false); // the hide's background rule paused it; a video still playing on return is the case under test
  Object.defineProperty(h.w.document, 'visibilityState', { value: 'visible', configurable: true });
  h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
  assert.strictEqual(h.live.size, 1, 'visible again while playing: resumed');
  h.p.dock();
  assert.strictEqual(h.live.size, 0);
  h.p.expand(h.doc.getElementById('player-slot'));
  assert.strictEqual(h.live.size, 1, 'expanded while playing: resumed');
});

test('an audio item never samples (the art is shown, not a picture)', async () => {
  const h = await boot(AUDIO);
  playing(h);
  assert.strictEqual(h.live.size, 0);
});

test('the sampler only READS the media: no play, pause, load, src, currentTime or rate write in its code', () => {
  const start = PLAYER_SRC.indexOf('var FROZEN_SAMPLE_EVERY_MS');
  const end = PLAYER_SRC.indexOf('\n  }\n', PLAYER_SRC.indexOf('function frozenSampleTick()')) + 4;
  assert.ok(start > 0 && end > start);
  const code = PLAYER_SRC.slice(start, end).replace(/\/\/.*$/gm, '');
  assert.ok(!/\.(play|pause|load)\(|\.src\s*=|currentTime\s*=|playbackRate\s*=|defaultPlaybackRate\s*=/.test(code), 'reads only');
  // The via and hold/rate helpers too.
  for (const fn of ['notePlayVia', 'notePlayerLift', 'playViaDetail', 'mediaPlayDetail', 'logHold']) {
    const i = PLAYER_SRC.indexOf('function ' + fn + '(');
    assert.ok(i > 0, fn);
    const body = PLAYER_SRC.slice(i, PLAYER_SRC.indexOf('\n  }\n', i));
    assert.ok(!/\.(play|pause|load)\(|\.src\s*=|currentTime\s*=|playbackRate\s*=/.test(body), fn + ' reads only');
  }
});

// ---- via: where each play / pause came from --------------------------------------

const lastOf = (h, type) => { const l = h.log().filter((e) => e.type === type); return l[l.length - 1]; };

test('via=picture-tap for a tap on the picture, with g = ms since its lift (the double-tap window)', async () => {
  const h = await boot(VIDEO);
  h.v.pause(); h.clearLog();
  const fire = (type) => { const e = new h.w.Event(type, { bubbles: true, cancelable: true }); const l = [{ clientX: 300, clientY: 100 }]; Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : l }); Object.defineProperty(e, 'changedTouches', { value: l }); h.v.dispatchEvent(e); };
  fire('touchstart'); fire('touchend');
  await wait(420);
  const line = lastOf(h, 'media:play');
  assert.ok(line, 'a media:play line');
  assert.match(line.detail, /^el=video via=picture-tap g=\d+$/);
  const g = Number(/g=(\d+)/.exec(line.detail)[1]);
  assert.ok(g >= 350, 'played at least the double-tap window after the lift, got ' + g);
});

test('via=art-tap for a tap on an audio file\'s art', async () => {
  const h = await boot(AUDIO);
  h.v.pause(); h.clearLog();
  const fire = (type) => { const e = new h.w.Event(type, { bubbles: true, cancelable: true }); const l = [{ clientX: 300, clientY: 100 }]; Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : l }); Object.defineProperty(e, 'changedTouches', { value: l }); h.art.dispatchEvent(e); };
  fire('touchstart'); fire('touchend');
  await wait(420);
  assert.match(lastOf(h, 'media:play').detail, /^el=video via=art-tap g=\d+$/);
});

test('via=bar-button for the bar\'s play button, inside its click (g near 0), and the pause names it too', async () => {
  const h = await boot(VIDEO);
  h.v.pause(); h.clearLog();
  const btn = h.doc.getElementById('pp-btn');
  btn.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 }));
  const line = lastOf(h, 'media:play');
  assert.match(line.detail, /^el=video via=bar-button g=\d+$/);
  assert.ok(Number(/g=(\d+)/.exec(line.detail)[1]) < 200, 'inside the click');
  btn.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.match(lastOf(h, 'media:pause').detail, / via=bar-button g=\d+$/);
});

test('via=keyboard for k / Space', async () => {
  const h = await boot(VIDEO);
  h.v.pause(); h.clearLog();
  h.doc.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
  assert.match(lastOf(h, 'media:play').detail, /^el=video via=keyboard /);
});

test('via=media-session for a lock-screen play', async () => {
  const h = await boot(VIDEO);
  h.v.pause(); h.clearLog();
  assert.strictEqual(typeof h.ms.play, 'function', 'precondition: the play action is registered');
  h.ms.play({ action: 'play' });
  assert.match(lastOf(h, 'media:play').detail, /^el=video via=media-session /);
});

test('via=other for the remote toggle, and for a play with no fresh source (a stamp older than 1.5 s is ignored)', async () => {
  const h = await boot(VIDEO);
  h.v.pause(); h.clearLog();
  h.p.togglePlay();
  assert.match(lastOf(h, 'media:play').detail, /^el=video via=other /);
  h.v.pause();
  h.v.play();
  assert.match(lastOf(h, 'media:play').detail, /^el=video via=other /, 'an unstamped play');
  assert.match(PLAYER_SRC, /var PLAY_VIA_FRESH_MS = 1500;/);
});

test('r0 mutants W2-M15/M16: a stamp is consumed by the line that reads it, and one older than 1.5 s is ignored', async () => {
  const h = await boot(VIDEO);
  h.v.pause(); h.clearLog();
  // M16: a lock-screen play reads media-session; a second, unstamped play right after must read other.
  h.ms.play({ action: 'play' });
  assert.match(lastOf(h, 'media:play').detail, /via=media-session /);
  h.setPaused(h.v, true);
  h.v.play();
  assert.match(lastOf(h, 'media:play').detail, /^el=video via=other /, 'the stamp was consumed');
  // M15: a stamp with no play after it (the play never fires), then a play 2 s of player clock later reads other.
  h.v.pause(); h.clearLog();
  const realPlay = h.v.play; h.v.play = () => Promise.resolve();
  h.doc.getElementById('pp-btn').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.strictEqual(lastOf(h, 'media:play'), undefined, 'precondition: no play fired');
  await wait(40); // x50: 2000 ms on the player's clock
  h.v.play = realPlay;
  h.v.play();
  assert.match(lastOf(h, 'media:play').detail, /^el=video via=other /, 'a stale stamp is ignored');
});

test('via=autostart and via=swapback are stamped right before their play() (source, one each)', () => {
  const code = PLAYER_SRC.replace(/\/\/.*$/gm, '');
  assert.match(code, /notePlayVia\('autostart'\);\s*\n\s*try \{ p = mediaPlayer\.play\(\); \}/);
  assert.match(code, /if \(audioWasPlaying\) notePlayVia\('swapback'\);\s*\n\s*if \(audioWasPlaying\) bgTimingNoteReturnPlay\(mediaPlayer\.play\(\)\)/);
  for (const v of ['picture-tap', 'art-tap', 'bar-button', 'keyboard', 'media-session', 'autostart', 'swapback']) {
    assert.ok(code.includes("'" + v + "'"), v + ' is a source');
  }
});

test('media:rate on every rate change, and hold:engage / hold:lock / hold:release / hold:drop', async () => {
  const h = await boot(VIDEO);
  h.clearLog();
  h.v.playbackRate = 1.5;
  h.v.dispatchEvent(new h.w.Event('ratechange'));
  assert.match(lastOf(h, 'media:rate').detail, /^rate=1\.5 def=\d/);
  const fire = (type, y) => { const e = new h.w.Event(type, { bubbles: true, cancelable: true }); const l = [{ clientX: 300, clientY: y }]; Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : l }); Object.defineProperty(e, 'changedTouches', { value: l }); h.v.dispatchEvent(e); };
  h.v.playbackRate = 1;
  fire('touchstart', 100);
  await wait(560);
  fire('touchend', 100);
  assert.deepStrictEqual(types(h).filter((x) => /^hold:/.test(x)), ['hold:engage', 'hold:release']);
  h.clearLog();
  fire('touchstart', 100);
  await wait(560);
  for (let y = 110; y <= 200; y += 10) fire('touchmove', y);
  fire('touchend', 200);
  // An explicit speed pick while locked drops the lock (holdRatePickDecision).
  h.v.defaultPlaybackRate = 1.25; h.v.playbackRate = 1.25;
  h.v.dispatchEvent(new h.w.Event('ratechange'));
  assert.deepStrictEqual(types(h).filter((x) => /^hold:/.test(x)), ['hold:engage', 'hold:lock', 'hold:drop']);
});

// ---- the log and its panel -------------------------------------------------------

test('the log keeps the newest 1000 entries, each with its wall time', async () => {
  const h = await boot(VIDEO);
  h.clearLog();
  for (let i = 0; i < 1005; i++) { h.v.playbackRate = 1 + (i % 2) * 0.5; h.v.dispatchEvent(new h.w.Event('ratechange')); }
  const log = h.log();
  assert.strictEqual(log.length, 1000);
  assert.ok(log.every((e) => typeof e.t === 'number' && e.t > 0));
});

test('the panel is OFF by default with the log on; on with both switches; a plain tap on it no longer clears', async () => {
  let h = await boot(VIDEO);
  h.v.dispatchEvent(new h.w.Event('ratechange'));
  assert.ok(h.log().length > 0, 'precondition: recording');
  assert.strictEqual(h.doc.getElementById('ft-lifecycle-overlay'), null, 'nothing on screen');
  dom.window.close(); dom = null;
  h = await boot(VIDEO, { overlay: true });
  h.v.dispatchEvent(new h.w.Event('ratechange'));
  const panel = h.doc.getElementById('ft-lifecycle-overlay');
  assert.ok(panel, 'shown with both switches');
  assert.match(panel.textContent, /^\[export from Settings\]\n/);
  const before = h.log().length;
  panel.dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.strictEqual(h.log().length, before, 'the tap kept the log');
  // The switch goes off: the next event removes the panel.
  h.w.localStorage.removeItem('ft-debug-lifecycle-overlay');
  h.v.dispatchEvent(new h.w.Event('ratechange'));
  assert.strictEqual(h.doc.getElementById('ft-lifecycle-overlay'), null);
});

test('the panel shows media:, hold: and gesture: lines up to 400 characters (other lines keep the 60 cut)', async () => {
  const h = await boot(VIDEO, { overlay: true });
  const long = 'x'.repeat(300);
  h.w.localStorage.setItem('ft-lifecycle-log', JSON.stringify([
    { type: 'media:play', detail: long, t: 1 }, { type: 'hold:engage', detail: long, t: 2 },
    { type: 'gesture:tap-pair', detail: long, t: 3 }, { type: 'pagehide', detail: long, t: 4 },
  ]));
  h.v.dispatchEvent(new h.w.Event('ratechange'));
  const text = h.doc.getElementById('ft-lifecycle-overlay').textContent;
  for (const t of ['media:play', 'hold:engage', 'gesture:tap-pair']) assert.ok(text.includes(t + ' (' + long + ')'), t + ' in full');
  assert.ok(text.includes('pagehide (' + 'x'.repeat(60) + ')'), 'pagehide cut at 60');
});
