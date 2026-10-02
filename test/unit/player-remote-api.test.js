'use strict';

// [UNIT] v1.348 Listen Control: window.FileTube.player's remote transport (play, pause,
// togglePlay, next, prev, seek). Each wrapper is bound to the internal the lock screen / control
// bar already uses, driven through the REAL public/js/player.js in a jsdom realm built from the
// real music.html shell. Mutate a wrapper (point next at prev, drop the pause suppression) and a
// test here goes red.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const MUSIC_DATA = {
  type: 'audio', title: 'Alpha One', channelName: 'Band', folderName: 'Band', album: 'Record', albumKey: 'Band|Record',
  channelFolder: 'Band', duration: 200, artUrl: '/thumbnail/a1', streamSrc: '/video/a1', progressEndpoint: '/api/progress',
  resumeMode: 'music', autoAdvanceViaTrackNav: true, browseCtx: '{"src":"music"}', readerHref: '/music?nowplaying=1',
};
const settle = () => new Promise((r) => setTimeout(r, 20));

function realm(opts) {
  const o = opts || {};
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'music.html'), 'utf8'), {
    url: 'http://localhost/music', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const calls = { play: 0, pause: 0 };
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.play = function () { calls.play += 1; Object.defineProperty(this, 'paused', { value: false, configurable: true }); return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () { calls.pause += 1; Object.defineProperty(this, 'paused', { value: true, configurable: true }); };
  w.resolveAudioArtUrl = () => '/thumbnail/a1';
  w.formatDuration = () => '';
  const handlers = {};
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler(n, h) { handlers[n] = h; }, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  const fetches = [];
  w.fetch = (u, init) => {
    fetches.push(((init && init.method) || 'GET') + ' ' + String(u));
    return Promise.resolve({ ok: true, json: async () => (String(u).indexOf('/api/queue') === 0 ? { entries: [], pointerUid: null } : {}) });
  };
  if (o.beforeLoad) o.beforeLoad(w);
  w.eval(fs.readFileSync(path.join(REPO, 'public', 'js', 'player.js'), 'utf8'));
  const player = w.FileTube.player;
  if (o.noLoad) return { w, player, calls, close: () => w.close() };
  assert.strictEqual(player.load('a1', { ...MUSIC_DATA }, { slot: w.document.getElementById('player-slot') }), true);
  calls.play = 0; calls.pause = 0;
  return { w, player, calls, handlers, fetches, el: w.document.getElementById('media-player'), close: () => w.close() };
}

test('play() and pause() drive the active element, and are the SAME behavior as the lock-screen handlers', async () => {
  const r = realm();
  try {
    assert.strictEqual(typeof r.player.play, 'function');
    await r.player.play();
    assert.strictEqual(r.calls.play, 1, 'play() plays the element');
    assert.strictEqual(r.w.navigator.mediaSession.playbackState, 'playing', 'and claims playing through the shared path');
    r.player.pause();
    assert.strictEqual(r.calls.pause, 1, 'pause() pauses the element');
    assert.strictEqual(r.w.navigator.mediaSession.playbackState, 'paused');
    r.handlers.play();
    r.handlers.pause();
    assert.deepStrictEqual([r.calls.play, r.calls.pause], [2, 2], 'the lock-screen handlers land on the same two internals');
  } finally { r.close(); }
});

test('togglePlay() flips: paused -> plays, playing -> pauses (the control bar\'s togglePlayPause)', () => {
  const r = realm();
  try {
    Object.defineProperty(r.el, 'paused', { value: true, configurable: true });
    r.player.togglePlay();
    assert.deepStrictEqual([r.calls.play, r.calls.pause], [1, 0]);
    r.player.togglePlay();
    assert.deepStrictEqual([r.calls.play, r.calls.pause], [1, 1]);
  } finally { r.close(); }
});

test('v1.352 W0: a play/pause the browser refuses (NotAllowedError) raises the refused flag and its event; any other error does not', async () => {
  const r = realm();
  try {
    const events = [];
    r.w.document.addEventListener('filetube:autostart', (e) => events.push(e.detail.refused));
    let reject = 'NotAllowedError';
    r.w.HTMLMediaElement.prototype.play = function () { const e = new Error('no gesture'); e.name = reject; return Promise.reject(e); };
    Object.defineProperty(r.el, 'paused', { value: true, configurable: true });
    reject = 'AbortError';
    r.player.togglePlay();
    await settle();
    assert.strictEqual(r.player.autoStartRefused(), false, 'an AbortError is a newer load, not a refusal');
    reject = 'NotAllowedError';
    r.player.togglePlay();
    await settle();
    assert.strictEqual(r.player.autoStartRefused(), true);
    assert.deepStrictEqual(events, [true], 'the event the PC reports from');
  } finally { r.close(); }
});

test('next() and prev() are the track-nav step: each reaches ITS OWN registered handler (never the other)', async () => {
  const r = realm();
  try {
    const hits = [];
    r.player.setTrackNav({ onNext: () => hits.push('next'), onPrev: () => hits.push('prev') });
    r.player.next();
    await settle(); await settle();
    assert.deepStrictEqual(hits, ['next']);
    r.player.prev();
    await settle(); await settle();
    assert.deepStrictEqual(hits, ['next', 'prev']);
    assert.ok(r.fetches.includes('GET /api/queue'), 'through manualTrackStep, which consults the queue first');
  } finally { r.close(); }
});

test('seek(sec) sets the element time; a non-finite, negative or non-number position is ignored', () => {
  const r = realm();
  try {
    r.player.seek(42.5);
    assert.strictEqual(r.el.currentTime, 42.5);
    for (const bad of [-1, NaN, Infinity, '30', null, undefined]) {
      r.player.seek(bad);
      assert.strictEqual(r.el.currentTime, 42.5, `seek(${String(bad)}) ignored`);
    }
    r.handlers.seekto({ seekTime: 7 });
    assert.strictEqual(r.el.currentTime, 7, 'the lock-screen seekto shares the path');
  } finally { r.close(); }
});

test('nothing loaded: every wrapper is a silent no-op', () => {
  const r = realm();
  try {
    r.player.close();
    assert.doesNotThrow(() => { r.player.play(); r.player.pause(); r.player.togglePlay(); r.player.next(); r.player.prev(); r.player.seek(3); });
  } finally { r.close(); }
});

test('getRemoteSnapshot reports the loaded id, position, duration, playing and the prev/next reach', async () => {
  const r = realm();
  try {
    let snap = r.player.getRemoteSnapshot();
    assert.strictEqual(snap.id, 'a1');
    assert.strictEqual(snap.playing, false);
    assert.strictEqual(snap.hasPrev, false, 'no trackNav registered: no prev');
    assert.strictEqual(snap.hasNext, false);
    r.player.setTrackNav({ onPrev() {}, onNext() {} });
    await r.player.play();
    snap = r.player.getRemoteSnapshot();
    assert.strictEqual(snap.playing, true);
    assert.strictEqual(snap.hasPrev, true);
    assert.strictEqual(snap.hasNext, true);
    r.player.setTrackNav({ onNext() {} });
    snap = r.player.getRemoteSnapshot();
    assert.strictEqual(snap.hasPrev, false, 'prev follows the registration, not next');
    assert.strictEqual(snap.hasNext, true);
  } finally { r.close(); }
});

// ---- v1.353: the phone sets this PC's player volume ----------------------------------------------

test('v1.353 setVolume sets the element, persists ft-volume through the volumechange listener, and moves the PC\'s own slider', async () => {
  const r = realm();
  try {
    assert.strictEqual(r.player.setVolume(0.3), true);
    assert.strictEqual(r.el.volume, 0.3);
    await settle();
    assert.strictEqual(r.w.localStorage.getItem('ft-volume'), '0.3', 'stored by the existing volumechange listener');
    assert.strictEqual(r.w.localStorage.getItem('ft-muted'), '0');
    const bar = r.w.document.getElementById('vol-bar');
    assert.strictEqual(bar.value, '0.3', 'the PC\'s slider follows');
    assert.strictEqual(bar.style.getPropertyValue('--vol-fill'), '30%');
    assert.strictEqual(r.player.setVolume(0.333), true);
    assert.strictEqual(r.el.volume, 0.33, 'rounded to the 5% grid\'s 2 places');
    assert.strictEqual(r.player.setVolume(1.7), true);
    assert.strictEqual(r.el.volume, 1, 'clamped');
  } finally { r.close(); }
});

test('v1.353 setVolume: raising off 0 un-mutes (the slider\'s rule); 0 leaves a mute as it is', async () => {
  const r = realm();
  try {
    r.el.muted = true;
    r.player.setVolume(0);
    assert.strictEqual(r.el.volume, 0);
    assert.strictEqual(r.el.muted, true, '0 does not un-mute');
    r.player.setVolume(0.5);
    assert.strictEqual(r.el.muted, false, 'raising off 0 un-mutes');
    await settle();
    assert.strictEqual(r.w.localStorage.getItem('ft-muted'), '0');
  } finally { r.close(); }
});

test('v1.353 setVolume ignores a non-number or non-finite level', () => {
  const r = realm();
  try {
    r.player.setVolume(0.6);
    for (const bad of ['0.5', NaN, Infinity, -Infinity, null, undefined, true, {}]) {
      assert.strictEqual(r.player.setVolume(bad), false, `setVolume(${String(bad)})`);
      assert.strictEqual(r.el.volume, 0.6);
    }
  } finally { r.close(); }
});

test('v1.353 the PC\'s own slider and keys are untouched: the slider input still sets the element', () => {
  const r = realm();
  try {
    const bar = r.w.document.getElementById('vol-bar');
    bar.value = '0.6';
    bar.dispatchEvent(new r.w.Event('input', { bubbles: true }));
    assert.strictEqual(r.el.volume, 0.6);
  } finally { r.close(); }
});

test('v1.353 getRemoteSnapshot carries the volume and the mute', () => {
  const r = realm();
  try {
    r.player.setVolume(0.45);
    r.el.muted = true;
    const snap = r.player.getRemoteSnapshot();
    assert.strictEqual(snap.volume, 0.45);
    assert.strictEqual(snap.muted, true);
  } finally { r.close(); }
});

test('v1.353 before the first load (no element yet) setVolume stores the level and the snapshot reads it back', () => {
  const r = realm({ noLoad: true });
  try {
    assert.strictEqual(r.w.document.getElementById('media-player'), null, 'no element yet');
    assert.strictEqual(r.player.setVolume(0.25), true);
    assert.strictEqual(r.w.localStorage.getItem('ft-volume'), '0.25');
    assert.strictEqual(r.w.localStorage.getItem('ft-muted'), '0');
    const snap = r.player.getRemoteSnapshot();
    assert.strictEqual(snap.volume, 0.25);
    assert.strictEqual(snap.muted, false);
  } finally { r.close(); }
});

test('v1.353 gate r1 (adversary W2, qa W3): where a page cannot set the volume (iOS), the snapshot reports null and setVolume does nothing', () => {
  const r = realm({ beforeLoad: (w) => {
    Object.defineProperty(w.HTMLMediaElement.prototype, 'volume', { configurable: true, get() { return 1; }, set() { /* read-only, as on iOS */ } });
  } });
  try {
    assert.strictEqual(r.w.document.getElementById('vol-bar').style.display, 'none', 'the probe found it unsettable (the PC hides its own slider)');
    assert.strictEqual(r.player.getRemoteSnapshot().volume, null, 'no made-up volume');
    assert.strictEqual(r.player.setVolume(0.3), false);
    assert.strictEqual(r.w.localStorage.getItem('ft-volume'), null, 'nothing stored');
  } finally { r.close(); }
});
