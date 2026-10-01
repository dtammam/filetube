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

function realm() {
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
  w.eval(fs.readFileSync(path.join(REPO, 'public', 'js', 'player.js'), 'utf8'));
  const player = w.FileTube.player;
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
