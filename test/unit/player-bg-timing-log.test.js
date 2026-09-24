'use strict';

// [UNIT] Lock-to-audio phase 1 (MEASURE, Dean 2026-09-24): the background-audio
// timing log + the reopen rule. The REAL player.js runs in a jsdom window with
// the real watch shell on an iPhone-shaped navigator, the settings fetch turns
// "Background audio for video" ON with the sidecar ready, and the tests dispatch
// the real lifecycle sequence (the video's own 'pause', visibilitychange to
// hidden, the sidecar's 'playing'/'timeupdate', visibilitychange to visible).
// Headless browsers never pause a backgrounded video, so the GAP itself is
// Dean's iPhone's to measure; what is bound here is REACHABILITY (a record is
// produced by the real handoff path, both iOS orderings), the OFF axis (no
// record, and the handoff's media calls are identical to the ON run), the
// no-write-before-play() rule, the return path (Dean's reopen rule: back to the
// video at the audio's position, playing only if the audio was), and the Setup
// readout rendering records the real player wrote.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PUB = path.join(__dirname, '..', '..', 'public');
const LOCK_SRC = fs.readFileSync(path.join(PUB, 'js', 'body-scroll-lock.js'), 'utf8');
const COMMON_SRC = fs.readFileSync(path.join(PUB, 'js', 'common.js'), 'utf8');
const PLAYER_SRC = fs.readFileSync(path.join(PUB, 'js', 'player.js'), 'utf8');
const WATCH = fs.readFileSync(path.join(PUB, 'watch.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const SETUP_HTML = fs.readFileSync(path.join(PUB, 'setup.html'), 'utf8');
const {
  bgTimingMetrics, appendBgTimingRecord, BG_TIMING_LOG_CAP,
  BG_TIMING_ENABLED_STORAGE_KEY, BG_TIMING_LOG_STORAGE_KEY,
} = require('../../public/js/player.js');

const ON_KEY = 'filetube_bg_timing_log_enabled';
const LOG_KEY = 'filetube_bg_timing_log';
const VIDEO = { id: 'v1', title: 'T', type: 'video', ext: '.mp4' };

let dom = null;
afterEach(() => { if (dom) { dom.window.close(); dom = null; } });
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

// A media element whose playback state the test owns. play()/pause() behave
// like a browser's: play() leaves `paused` at once and resolves (or rejects);
// pause() sets it and queues a 'pause' event as a task.
function fakeMedia(w, el, calls, init) {
  const st = Object.assign({ currentTime: 0, paused: true, readyState: 0, playResult: null }, init);
  Object.defineProperty(el, 'currentTime', { get: () => st.currentTime, set: (v) => { st.currentTime = v; calls.push(['seek', el.id, v]); }, configurable: true });
  Object.defineProperty(el, 'paused', { get: () => st.paused, configurable: true });
  Object.defineProperty(el, 'readyState', { get: () => st.readyState, configurable: true });
  el.play = () => {
    calls.push(['play', el.id]);
    st.paused = false;
    return st.playResult ? Promise.reject(st.playResult) : Promise.resolve();
  };
  el.pause = () => {
    calls.push(['pause', el.id]);
    const was = st.paused;
    st.paused = true;
    if (!was) setTimeout(() => el.dispatchEvent(new w.Event('pause')), 0);
  };
  return st;
}

async function boot({ timing = true, settings = {}, standalone = false, item = VIDEO } = {}) {
  dom = new JSDOM(WATCH, { url: 'http://localhost/watch.html?v=v1', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const doc = w.document;
  Object.defineProperty(w.navigator, 'platform', { value: 'iPhone' });
  Object.defineProperty(w.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15' });
  w.matchMedia = (q) => ({ matches: /coarse|hover: none|max-width/.test(q) || (standalone && /standalone/.test(q)), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  const fetches = [];
  const SETTINGS = Object.assign({ backgroundAudioForVideo: true, bgAudioSyncPosition: true, preExtractAudio: false }, settings);
  w.fetch = async (url, opts) => {
    fetches.push([String(url), opts && opts.method]);
    const body = /prepare-audio/.test(url) ? { audioStatus: 'ready' } : (/\/api\/settings/.test(url) ? SETTINGS : {});
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  };
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  let vis = 'visible';
  Object.defineProperty(doc, 'visibilityState', { get: () => vis, configurable: true });
  Object.defineProperty(doc, 'hidden', { get: () => vis === 'hidden', configurable: true });
  if (timing) w.localStorage.setItem(ON_KEY, '1');
  const calls = [];
  const realSet = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function (k, v) { calls.push(['setItem', k]); return realSet.call(this, k, v); };
  w.eval(COMMON_SRC.slice(COMMON_SRC.indexOf('function resolveAudioArtUrl('), COMMON_SRC.indexOf('\n}\n', COMMON_SRC.indexOf('function resolveAudioArtUrl(')) + 3));
  w.eval(LOCK_SRC);
  w.eval(PLAYER_SRC);
  const slot = doc.createElement('div'); slot.id = 'player-slot'; doc.body.appendChild(slot);
  const p = w.FileTube.player;
  assert.strictEqual(p.load(item.id, item, { slot }), true, 'the real player loaded the item');
  await tick(30); // settings -> prepare-audio (ready) -> the sidecar is pre-armed
  const video = doc.getElementById('media-player');
  const sidecar = doc.getElementById('bg-audio-sidecar');
  assert.ok(video && sidecar, 'the real host built the video and the hidden sidecar');
  const v = fakeMedia(w, video, calls, { currentTime: 120, paused: false, readyState: 4 });
  const a = fakeMedia(w, sidecar, calls, { currentTime: 0, paused: true, readyState: 1 });
  calls.length = 0; // the trace starts at the lock
  const setVis = (next) => { vis = next; doc.dispatchEvent(new w.Event('visibilitychange')); };
  const fire = (el, type) => el.dispatchEvent(new w.Event(type));
  const log = () => JSON.parse(w.localStorage.getItem(LOG_KEY) || '[]');
  return { w, doc, p, video, sidecar, v, a, calls, fetches, setVis, fire, log };
}

// iOS ordering A (the original trigger): the page hides while the video still
// plays; the handoff pauses it.
async function lockWhilePlaying(h) {
  h.setVis('hidden');
  await tick(0);
}
// iOS ordering B (Dean's v1.27.2 overlay): iOS system-pauses the video while the
// page is still VISIBLE, then hides it -> the candidate bridge hands off.
async function systemPauseThenLock(h) {
  h.video.pause(); // no in-page gesture before it: a SYSTEM pause
  await tick(5);   // its 'pause' task runs: the candidate arms (and the timing stamp)
  h.setVis('hidden');
  await tick(0);
}
// The sidecar starts: 'playing' at the handed-over position, then its clock moves.
async function sidecarStarts(h, from) {
  h.a.currentTime = from;
  h.fire(h.sidecar, 'playing');
  h.a.currentTime = from + 0.25;
  h.fire(h.sidecar, 'timeupdate');
  await tick(0);
}

// ---- pure halves ------------------------------------------------------------

test('keys + cap: the two storage keys match setup.js exactly (the cross-file convention), the ring holds 20', () => {
  const setup = require('../../public/js/setup.js');
  assert.strictEqual(BG_TIMING_ENABLED_STORAGE_KEY, ON_KEY);
  assert.strictEqual(BG_TIMING_LOG_STORAGE_KEY, LOG_KEY);
  assert.strictEqual(setup.BG_TIMING_ENABLED_KEY, BG_TIMING_ENABLED_STORAGE_KEY);
  assert.strictEqual(setup.BG_TIMING_LOG_KEY, BG_TIMING_LOG_STORAGE_KEY);
  assert.strictEqual(BG_TIMING_LOG_CAP, 20);
});

test('appendBgTimingRecord: same id replaces IN PLACE, new ids append, only the newest cap survive, garbage dropped', () => {
  let log = [];
  for (let i = 1; i <= 22; i++) log = appendBgTimingRecord(log, { id: String(i), n: 0 }, 20);
  assert.strictEqual(log.length, 20);
  assert.deepStrictEqual(log.map((r) => r.id).slice(0, 2), ['3', '4'], 'the oldest two fell off');
  log = appendBgTimingRecord(log, { id: '10', n: 1 }, 20);
  assert.strictEqual(log.length, 20, 'a re-write does not grow the ring');
  assert.strictEqual(log.findIndex((r) => r.id === '10'), 7, 'and keeps its place');
  assert.strictEqual(log[7].n, 1);
  assert.deepStrictEqual(appendBgTimingRecord([null, 'x', 3, { id: 'a' }], { id: 'b' }, 20).map((r) => r.id), ['a', 'b']);
  assert.deepStrictEqual(appendBgTimingRecord('corrupt', { id: 'b' }).map((r) => r.id), ['b']);
});

test('bgTimingMetrics: spans from the right anchors; silence starts at whichever video stop came first', () => {
  const m = bgTimingMetrics({
    pause: -180, pauseCall: 4, playCall: 3, playing: 420, advance: 650,
    resumeTime: 120, startPos: 120.1,
    decision: { eligible: true, trigger: 'candidate' },
    ret: { visible: 9000, videoPlaying: 9200, videoAdvance: 9350 },
  });
  assert.deepStrictEqual(m, {
    hideToAudioMs: 650, hideToPlayingMs: 420, pauseToPlayingMs: 600, silenceMs: 830,
    playCallToPlayingMs: 417, driftSec: 0.1, backMs: 350, outcome: 'ok',
  });
  // Our own pause() call is the stop when iOS never paused first.
  assert.strictEqual(bgTimingMetrics({ pauseCall: 2, pause: 9, playing: 300, advance: 500 }).silenceMs, 498);
  // Outcomes, in precedence order.
  assert.strictEqual(bgTimingMetrics({ decision: { eligible: false, reason: 'setting-off' } }).outcome, 'skipped:setting-off');
  assert.strictEqual(bgTimingMetrics({ playCall: 1, err: 'NotAllowedError' }).outcome, 'failed:NotAllowedError');
  assert.strictEqual(bgTimingMetrics({ playCall: 1, playing: 5 }).outcome, 'playing');
  assert.strictEqual(bgTimingMetrics({ playCall: 1 }).outcome, 'pending', 'play() never settled - the stuck-HANDING_OFF shape');
  assert.strictEqual(bgTimingMetrics({}).outcome, 'no-handoff');
  assert.strictEqual(bgTimingMetrics().hideToAudioMs, null, 'missing marks read as null, never NaN');
});

// ---- reachability: the REAL handoff path writes the record ---------------------

test('ordering A (hide while playing): the real visibility handoff produces ONE complete record', async () => {
  const h = await boot();
  await lockWhilePlaying(h);
  assert.ok(h.calls.some((c) => c[0] === 'play' && c[1] === 'bg-audio-sidecar'), 'precondition: the real handoff played the sidecar');
  let recs = h.log();
  assert.strictEqual(recs.length, 1, 'the pending record is on disk right after the handoff (an app killed now keeps it)');
  assert.strictEqual(recs[0].m.outcome, 'pending', 'written right after play() was called, before it settled');
  await sidecarStarts(h, 120);
  recs = h.log();
  assert.strictEqual(recs.length, 1, 'the same record, re-written in place');
  const r = recs[0];
  assert.strictEqual(r.first, 'visibilitychangeHidden');
  assert.strictEqual(r.media, 'v1');
  assert.strictEqual(r.playingAtHide, true);
  assert.deepStrictEqual(r.decision && { eligible: r.decision.eligible, trigger: r.decision.trigger }, { eligible: true, trigger: 'visibility' });
  assert.strictEqual(r.resumeTime, 120, 'the video position handed over');
  assert.strictEqual(r.sidecar.armed, true, 'the load-time pre-arm is visible (v1.35 T2): src was the real track BEFORE the handoff');
  assert.strictEqual(r.settings.instant, true, 'the Instant handoff setting rides along (bgAudioSyncPosition)');
  assert.strictEqual(r.settings.bgAudio, true);
  assert.strictEqual(r.os, 'iOS 26.6');
  assert.strictEqual(r.display, 'browser');
  for (const k of ['playCall', 'pauseCall', 'playResolved', 'playing', 'advance']) {
    assert.strictEqual(typeof r[k], 'number', k + ' was marked on the real path');
    assert.ok(r[k] >= 0, k + ' is after the hide');
  }
  assert.ok(r.playCall <= r.pauseCall, 'the sidecar play() is called before the video pause (the handoff order)');
  assert.strictEqual(r.startPos, 120);
  assert.strictEqual(r.advancePos, 120.25);
  assert.strictEqual(r.m.outcome, 'ok');
  assert.strictEqual(r.m.driftSec, 0);
  assert.strictEqual(typeof r.m.hideToAudioMs, 'number');
  assert.ok(!('p0' in r), 'the raw performance.now origin never reaches storage');
  assert.ok(r.ev.some((e) => /^bgAudio:handoff /.test(e[0])), 'the existing bgAudio:* lines are captured as timed events');
});

test('ordering B (iOS system-pauses FIRST, then hides): the candidate handoff record carries the NEGATIVE pause mark', async () => {
  const h = await boot({ standalone: true });
  await systemPauseThenLock(h);
  assert.ok(h.calls.some((c) => c[0] === 'play' && c[1] === 'bg-audio-sidecar'), 'precondition: the candidate bridge handed off');
  await sidecarStarts(h, 120);
  const [r] = h.log();
  assert.strictEqual(r.decision.trigger, 'candidate');
  assert.strictEqual(r.playingAtHide, false);
  assert.ok(r.pause < 0, 'the video stopped BEFORE the hide: ' + r.pause);
  assert.strictEqual(r.pausePos, 120);
  assert.strictEqual(r.display, 'pwa');
  assert.strictEqual(r.m.silenceMs, Math.round(r.advance - r.pause), 'the silence is measured from the system pause, not the hide');
});

test('a skipped handoff is recorded with its reason (the tap on the existing one-line-per-event skip)', async () => {
  const h = await boot({ settings: { backgroundAudioForVideo: false } });
  await lockWhilePlaying(h);
  await tick(0);
  const recs = h.log();
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].m.outcome, 'skipped:setting-off');
  assert.ok(!h.calls.some((c) => c[0] === 'play' && c[1] === 'bg-audio-sidecar'), 'no handoff was attempted');
});

test('a rejected sidecar play() is recorded as failed with the error name', async () => {
  const h = await boot();
  const err = new h.w.Error('blocked'); err.name = 'NotAllowedError';
  h.a.playResult = err;
  await lockWhilePlaying(h);
  await tick(0);
  const [r] = h.log();
  assert.strictEqual(r.err, 'NotAllowedError');
  assert.strictEqual(typeof r.playRejected, 'number');
  assert.strictEqual(r.m.outcome, 'failed:NotAllowedError');
});

// ---- the OFF axis + the timing rules ------------------------------------------

test('toggle OFF: nothing is recorded, and the handoff makes the IDENTICAL media calls as with it ON', async () => {
  const traces = {};
  for (const timing of [true, false]) {
    const h = await boot({ timing });
    await lockWhilePlaying(h);
    await sidecarStarts(h, 120);
    h.setVis('visible');
    await tick(0);
    traces[timing] = h.calls.filter((c) => c[0] !== 'setItem' || c[1] === LOG_KEY);
    if (!timing) {
      assert.strictEqual(h.w.localStorage.getItem(LOG_KEY), null, 'no timing log with the toggle off');
      assert.ok(!h.calls.some((c) => c[0] === 'setItem' && c[1] === LOG_KEY), 'not even one write');
    }
    dom.window.close(); dom = null;
  }
  const media = (t) => t.filter((c) => c[0] !== 'setItem');
  assert.ok(media(traces.true).length >= 4, 'precondition: a real handoff + return ran');
  assert.deepStrictEqual(media(traces.false), media(traces.true), 'the handoff and the return are byte-identical with the log on or off');
});

test('no storage write happens before the sidecar play() call (the first write is queued AFTER it)', async () => {
  const h = await boot();
  await lockWhilePlaying(h);
  const playAt = h.calls.findIndex((c) => c[0] === 'play' && c[1] === 'bg-audio-sidecar');
  const firstWrite = h.calls.findIndex((c) => c[0] === 'setItem' && c[1] === LOG_KEY);
  assert.ok(playAt >= 0 && firstWrite >= 0, 'precondition: both happened');
  assert.ok(firstWrite > playAt, 'the timing write came after play(): write@' + firstWrite + ' play@' + playAt);
  const pauseAt = h.calls.findIndex((c) => c[0] === 'pause' && c[1] === 'media-player');
  assert.ok(firstWrite > pauseAt, 'and after the handoff pause - it is a microtask, not inline');
});

test('the ring keeps the newest 20 cycles across real handoffs', async () => {
  const h = await boot();
  const seed = [];
  for (let i = 0; i < 20; i++) seed.push({ id: 'old-' + i, t: i, m: { outcome: 'ok' } });
  h.w.localStorage.setItem(LOG_KEY, JSON.stringify(seed));
  await lockWhilePlaying(h);
  const recs = h.log();
  assert.strictEqual(recs.length, 20);
  assert.strictEqual(recs[0].id, 'old-1', 'the oldest fell off');
  assert.strictEqual(recs[19].media, 'v1', 'the real record is the newest');
});

test('collection follows the toggle LIVE: a cycle that began OFF is never recorded, even if switched on before the audio starts', async () => {
  const h = await boot({ timing: false });
  await lockWhilePlaying(h);
  h.w.localStorage.setItem(ON_KEY, '1'); // switched on while backgrounded
  await sidecarStarts(h, 120);
  h.setVis('visible');
  await tick(0);
  assert.strictEqual(h.w.localStorage.getItem(LOG_KEY), null, 'no record for a cycle that opened with the log off');
});

test('switched OFF mid-cycle: the record stops where it was (no later write)', async () => {
  const h = await boot();
  await lockWhilePlaying(h);
  assert.strictEqual(h.log()[0].m.outcome, 'pending', 'precondition: the pending record was written');
  h.w.localStorage.removeItem(ON_KEY);
  await sidecarStarts(h, 120);
  const [r] = h.log();
  assert.strictEqual(r.m.outcome, 'pending', 'no write after the switch-off');
  assert.ok(!('advance' in r));
});

test("the handoff's own seek (timeupdate before play() settles) is never mistaken for the first advance", async () => {
  const h = await boot();
  h.setVis('hidden'); // the handoff runs synchronously in here; play() has not settled yet
  h.a.currentTime = 121; // a seek landing past the handed-over position fires timeupdate
  h.fire(h.sidecar, 'timeupdate');
  await tick(0);
  assert.ok(!('advance' in h.log()[0]), 'no advance before the sidecar is playing');
  await sidecarStarts(h, 121);
  assert.strictEqual(typeof h.log()[0].advance, 'number', 'the real first advance is still caught');
});

test('nothing to measure: a PAUSED video (no recent pause) and an AUDIO item never open a record', async () => {
  const h = await boot();
  h.v.paused = true; // paused long ago - no pause event near this hide
  await lockWhilePlaying(h);
  assert.strictEqual(h.w.localStorage.getItem(LOG_KEY), null, 'a paused video is not a handoff');
  dom.window.close(); dom = null;
  const a = await boot({ item: { id: 'a1', title: 'Song', type: 'audio', ext: '.mp3' } });
  await lockWhilePlaying(a);
  assert.strictEqual(a.v.paused, false, 'precondition: audio keeps playing in the background (never handed off)');
  assert.strictEqual(a.w.localStorage.getItem(LOG_KEY), null, 'an audio item is out of scope');
});

// ---- the return path (Dean's reopen rule) ---------------------------------------

test('reopen, audio PLAYING: back to the video at the audio position, playing; the record times the return', async () => {
  const h = await boot();
  await lockWhilePlaying(h);
  await sidecarStarts(h, 120);
  h.a.currentTime = 250; // two minutes of background listening
  h.calls.length = 0;
  h.setVis('visible');
  assert.strictEqual(h.v.currentTime, 250, 'the video lands at the AUDIO position');
  assert.ok(h.calls.some((c) => c[0] === 'play' && c[1] === 'media-player'), 'and plays, because the audio was playing');
  assert.strictEqual(h.a.paused, true, 'the sidecar is released');
  await tick(0);
  h.fire(h.video, 'playing');
  h.v.currentTime = 250.3;
  h.fire(h.video, 'timeupdate');
  const [r] = h.log();
  assert.strictEqual(r.ret.mode, 'resume');
  assert.strictEqual(r.ret.audioPos, 250);
  assert.strictEqual(r.ret.audioPaused, false);
  for (const k of ['visible', 'videoPlayCall', 'videoPlayResolved', 'videoPlaying', 'videoAdvance']) {
    assert.strictEqual(typeof r.ret[k], 'number', 'ret.' + k + ' marked');
  }
  assert.strictEqual(r.done, true);
  assert.strictEqual(typeof r.m.backMs, 'number');
});

for (const timing of [true, false]) {
  test('reopen, audio PAUSED (lock-screen / AirPods pause): the video takes the audio position but stays PAUSED (toggle ' + (timing ? 'on' : 'off') + ')', async () => {
    const h = await boot({ timing });
    await lockWhilePlaying(h);
    await sidecarStarts(h, 120);
    h.a.currentTime = 200;
    h.sidecar.pause(); // the user paused from the lock screen
    await tick(5);
    h.calls.length = 0;
    h.setVis('visible');
    await tick(0);
    assert.strictEqual(h.v.currentTime, 200, 'the video lands at the audio position');
    assert.ok(!h.calls.some((c) => c[0] === 'play' && c[1] === 'media-player'), 'but never plays - the audio was paused');
    assert.strictEqual(h.v.paused, true);
    if (timing) {
      const [r] = h.log();
      assert.strictEqual(r.ret.mode, 'stay-paused');
      assert.strictEqual(r.ret.audioPaused, true);
      assert.strictEqual(r.done, true);
    }
  });
}

test('reopen while the handoff play() is still IN FLIGHT counts as playing (HANDING_OFF: play() leaves paused at once)', async () => {
  const h = await boot({ timing: false });
  h.sidecar.play = () => { h.calls.push(['play', 'bg-audio-sidecar']); h.a.paused = false; return new Promise(() => {}); };
  await lockWhilePlaying(h);
  h.calls.length = 0;
  h.setVis('visible');
  assert.ok(h.calls.some((c) => c[0] === 'play' && c[1] === 'media-player'), 'the video resumes');
});

test('a video that finished in the background comes back at 0:00 PAUSED (the cascade rewound the sidecar), not restarting', async () => {
  const h = await boot({ timing: false });
  await lockWhilePlaying(h);
  await sidecarStarts(h, 120);
  h.a.currentTime = 600;
  h.a.paused = true;
  h.fire(h.sidecar, 'ended'); // runEndedCompletionCascade(bgAudioEl, backgrounded)
  assert.strictEqual(h.a.currentTime, 0, 'precondition: the real cascade rewound the sidecar');
  h.calls.length = 0;
  h.setVis('visible');
  assert.strictEqual(h.v.currentTime, 0);
  assert.ok(!h.calls.some((c) => c[0] === 'play' && c[1] === 'media-player'), 'a finished video does not restart itself on return');
});

test('a return where no handoff happened (setting off) closes the record as no-swap', async () => {
  const h = await boot({ settings: { backgroundAudioForVideo: false } });
  await lockWhilePlaying(h);
  h.setVis('visible');
  await tick(0);
  const [r] = h.log();
  assert.strictEqual(r.ret.mode, 'no-swap');
  assert.strictEqual(r.done, true);
});

// ---- the Setup readout, fed by records the REAL player wrote --------------------

function setupDom(storageItems) {
  const start = SETUP_HTML.indexOf('<div class="form-group">', SETUP_HTML.indexOf('Lock-to-audio phase 1'));
  const end = SETUP_HTML.indexOf('<!-- v1.136.1: the audio-session declare EXPERIMENT');
  assert.ok(start > 0 && end > start, 'the markup block is in setup.html');
  const sdom = new JSDOM('<!DOCTYPE html><body>' + SETUP_HTML.slice(start, end) + '</body>', { url: 'http://localhost/setup' });
  for (const [k, v] of Object.entries(storageItems || {})) sdom.window.localStorage.setItem(k, v);
  const saved = { navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
  global.window = sdom.window; global.document = sdom.window.document; global.localStorage = sdom.window.localStorage;
  Object.defineProperty(globalThis, 'navigator', { value: sdom.window.navigator, configurable: true, writable: true });
  const restore = () => {
    delete global.window; delete global.document; delete global.localStorage;
    if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator); else delete globalThis.navigator;
    sdom.window.close();
  };
  return { sdom, doc: sdom.window.document, restore };
}

async function realRecords() {
  const h = await boot({ standalone: true });
  await systemPauseThenLock(h);
  await sidecarStarts(h, 120);
  h.a.currentTime = 180;
  h.setVis('visible');
  await tick(0);
  h.fire(h.video, 'playing');
  h.v.currentTime = 180.4;
  h.fire(h.video, 'timeupdate');
  const raw = h.w.localStorage.getItem(LOG_KEY);
  dom.window.close(); dom = null;
  return raw;
}

test('Setup: the experimental toggle lives in Experimental, once; default OFF hides the panel', (t) => {
  const exp = SETUP_HTML.slice(SETUP_HTML.indexOf('data-collapse-key="experimental"'));
  assert.ok(exp.includes('id="bg-timing-log-check"'));
  assert.strictEqual(SETUP_HTML.split('id="bg-timing-log-check"').length - 1, 1);
  const s = setupDom();
  t.after(s.restore);
  const { wireBgTimingLog } = require('../../public/js/setup.js');
  wireBgTimingLog(new s.sdom.window.AbortController().signal);
  assert.strictEqual(s.doc.getElementById('bg-timing-log-check').checked, false);
  assert.strictEqual(s.doc.getElementById('bg-timing-log-panel').hidden, true);
});

test('Setup: the table renders the records the real player wrote (newest first), and switching off hides it (both axes, populated)', async (t) => {
  const raw = await realRecords();
  const s = setupDom({ [ON_KEY]: '1', [LOG_KEY]: raw });
  t.after(s.restore);
  const { wireBgTimingLog } = require('../../public/js/setup.js');
  wireBgTimingLog(new s.sdom.window.AbortController().signal);
  const check = s.doc.getElementById('bg-timing-log-check');
  const panel = s.doc.getElementById('bg-timing-log-panel');
  assert.strictEqual(check.checked, true, 'prefilled from storage');
  assert.strictEqual(panel.hidden, false, 'revealed while on');
  const rows = s.doc.querySelectorAll('.bg-timing-log-row');
  assert.strictEqual(rows.length, 1);
  const cells = [...rows[0].querySelectorAll('td')].map((td) => td.textContent);
  const rec = JSON.parse(raw)[0];
  assert.strictEqual(cells[1], String(rec.m.hideToAudioMs), 'hide to audio');
  assert.strictEqual(cells[2], String(rec.m.pauseToPlayingMs), 'pause to playing');
  assert.deepStrictEqual(cells.slice(3), ['yes', 'on', '0.00s'], 'pre-armed, Instant on, drift');
  const note = s.doc.querySelector('.bg-timing-log-note').textContent;
  assert.match(note, /^ok via candidate/);
  assert.match(note, /back: video moving after \d+ ms/);
  assert.match(note, /PWA/);
  check.checked = false;
  check.dispatchEvent(new s.sdom.window.Event('change'));
  assert.strictEqual(panel.hidden, true, 'switching off hides the populated panel');
  assert.strictEqual(s.sdom.window.localStorage.getItem(ON_KEY), null, 'and stops collection (player.js reads this key live)');
  check.checked = true;
  check.dispatchEvent(new s.sdom.window.Event('change'));
  assert.strictEqual(s.sdom.window.localStorage.getItem(ON_KEY), '1');
  assert.strictEqual(panel.hidden, false);
});

test('Setup: Copy puts every record on the clipboard; without a clipboard the text is shown to copy by hand', async (t) => {
  const raw = await realRecords();
  const s = setupDom({ [ON_KEY]: '1', [LOG_KEY]: raw });
  t.after(s.restore);
  let copied = null;
  Object.defineProperty(s.sdom.window.navigator, 'clipboard', { value: { writeText: async (txt) => { copied = txt; } }, configurable: true });
  const { wireBgTimingLog } = require('../../public/js/setup.js');
  wireBgTimingLog(new s.sdom.window.AbortController().signal);
  s.doc.getElementById('bg-timing-log-copy').click();
  await tick(0); await tick(0);
  assert.ok(copied, 'the clipboard got the text');
  assert.match(copied, /^FileTube background audio timing log/);
  assert.match(copied, /1\. .* pwa iOS 26\.6 \| ok via candidate \| hide->audio \d+ /);
  assert.ok(copied.includes('raw: ' + JSON.stringify(JSON.parse(raw).reverse())), 'the raw records ride along');
  assert.strictEqual(s.doc.getElementById('bg-timing-log-status').textContent, 'Copied.');
  Object.defineProperty(s.sdom.window.navigator, 'clipboard', { value: undefined, configurable: true });
  s.doc.getElementById('bg-timing-log-copy').click();
  await tick(0);
  const ta = s.doc.getElementById('bg-timing-log-text');
  assert.strictEqual(ta.hidden, false, 'the fallback text box is shown');
  assert.match(ta.value, /hide->audio/);
});

test('Setup: Clear takes two taps - one tap never clears a populated log; the second empties storage and the table', async (t) => {
  const raw = await realRecords();
  const s = setupDom({ [ON_KEY]: '1', [LOG_KEY]: raw });
  t.after(s.restore);
  const ac = new s.sdom.window.AbortController();
  t.after(() => ac.abort());
  const { wireBgTimingLog } = require('../../public/js/setup.js');
  wireBgTimingLog(ac.signal);
  const btn = s.doc.getElementById('bg-timing-log-clear');
  btn.click();
  assert.strictEqual(btn.textContent, 'Tap again to clear');
  assert.ok(s.sdom.window.localStorage.getItem(LOG_KEY), 'one tap kept the log');
  assert.strictEqual(s.doc.querySelectorAll('.bg-timing-log-row').length, 1);
  btn.click();
  assert.strictEqual(s.sdom.window.localStorage.getItem(LOG_KEY), null, 'cleared');
  assert.strictEqual(s.doc.querySelectorAll('.bg-timing-log-row').length, 0);
  assert.match(s.doc.getElementById('bg-timing-log-table').textContent, /No handoffs recorded yet/);
  assert.strictEqual(btn.textContent, 'Clear');
});

test('Setup: the init path wires the readout (not just a callable function)', () => {
  const SETUP_JS = fs.readFileSync(path.join(PUB, 'js', 'setup.js'), 'utf8');
  assert.match(SETUP_JS, /\n {2}wireBgTimingLog\(controller\.signal\);/);
});
