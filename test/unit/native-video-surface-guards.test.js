'use strict';

// [UNIT] v1.399.0 native video surface, W5 (plan docs/exec-plans/active/2026-10-28-native-video-surface.md): the guards the plan
// asks for beyond the per-wave tests - (1) a fake host in jsdom that plays snapshots while the REAL player walks slot -> dock ->
// expand -> rotation into the CSS fullscreen -> rotation back -> a stand-down load, asserting the WHOLE sequence of rect messages
// (one per placement, nothing between); (2) S11 byte-identity for the video path: the observable state of the page after the same
// user sequence is deepStrictEqual across no host, a host without nativeVideo and a host with no capability at all, and nothing
// native is ever posted. Each ruling's own binding test is listed in the plan's Evidence (W5 table).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { installFakeHost } = require('../helpers/fake-host');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, 'public', 'js', f), 'utf8');
const SCRIPTS = ['host-adapter.js', 'native-audio.js', 'player.js'];
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const CAPS = { capabilities: ['nativeAudio', 'nativeVideoAudio', 'nativeVideo'] };
const VIDEO = { id: 'v1', type: 'video', title: 'A talk', channelName: 'Ch', folderName: 'Ch', duration: 600, hasThumbnail: true, hasSubtitles: true, width: 1920, height: 1080, browseCtx: null, readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false, progressEndpoint: null, startAt: null };
const EARLY = { browseCtx: null, readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false, progressEndpoint: null, startAt: null };
const MODES = { autoplay: true, shuffle: false, loop: 'off' };
const ITEM = { kind: 'video', id: 'v1', src: '/api/offline/file/video/v1', title: 'A talk', artist: 'Ch', artworkSrc: '/thumbnail/v1', durationSec: 600, progress: { route: '/api/progress', key: 'v1' } };
const STATE = (rev, pos, extra) => Object.assign({ v: 1, type: 'audioState', rev, queue: [ITEM], index: 0, state: 'playing', positionSec: pos, durationSec: 600, rate: 1, modes: MODES, sleep: { mode: 'off' } }, extra || {});
const PORTRAIT = { left: 0, top: 300, width: 393, height: 221 };
const LANDSCAPE_FS = { left: 0, top: 0, width: 852, height: 393 };

function realm({ host = null } = {}) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'music.html'), 'utf8'), { url: 'http://localhost/watch.html?v=v1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  // a phone whose orientation the test can turn: the player's matchMedia('(orientation: landscape)') change listeners fire
  const orient = { landscape: false, listeners: [] };
  w.matchMedia = (q) => {
    const isOrient = /orientation:\s*landscape/.test(q);
    return {
      get matches() { return isOrient ? orient.landscape : (/max-width:\s*768px|pointer:\s*coarse|hover:\s*none/.test(q) && !/any-pointer/.test(q)); },
      media: q,
      addEventListener(t, fn) { if (isOrient && t === 'change') orient.listeners.push(fn); },
      removeEventListener() {},
      addListener(fn) { if (isOrient) orient.listeners.push(fn); },
      removeListener() {},
    };
  };
  w.scrollTo = () => {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  const fakeTrack = { mode: 'disabled', activeCues: null, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(w.HTMLMediaElement.prototype, 'textTracks', { configurable: true, get() { return [fakeTrack]; } });
  w.resolveAudioArtUrl = () => '/albumart/t1';
  w.formatDuration = () => '';
  w.clampPositionState = (s) => s;
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  const calls = [];
  w.fetch = (u, init) => {
    const url = String(u); calls.push(((init && init.method) || 'GET') + ' ' + url);
    let body = {};
    if (url === '/api/settings') body = { backgroundAudioForVideo: false, mobileCustomPlayer: false };
    else if (url.indexOf('/api/queue') === 0) body = { entries: [], pointerUid: null };
    else if (/^\/api\/progress\//.test(url)) body = { timestamp: 0 };
    return Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => 'WEBVTT\n\n00:00:00.000 --> 00:00:09.000\nHello\n' });
  };
  const fake = host ? installFakeHost(w, host) : null;
  const style = w.document.createElement('style'); style.textContent = '#player-wrapper { border-top-left-radius: 12px; }'; w.document.head.appendChild(style);
  for (const f of SCRIPTS) w.eval(read(f));
  let box = PORTRAIT;
  w.HTMLVideoElement.prototype.getBoundingClientRect = () => ({ left: box.left, top: box.top, width: box.width, height: box.height, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top });
  return {
    w, fake, calls, player: w.FileTube.player, na: w.FileTube.nativeAudio,
    slot: w.document.getElementById('player-slot'),
    el: () => w.document.getElementById('media-player'),
    host: () => w.document.getElementById('player-wrapper'),
    setBox: (b) => { box = b; },
    rotate(landscape, b) { orient.landscape = landscape; box = b; for (const fn of orient.listeners.slice()) fn({ matches: landscape }); w.dispatchEvent(new w.Event('orientationchange')); w.dispatchEvent(new w.Event('resize')); },
    surfaces: () => fake.of('video.surface').map((m) => ({ rect: m.rect, space: m.space, visible: m.visible, fit: m.fit, radius: m.radius })),
    // every observable the video path leaves on the page
    snapshot() {
      const e = this.el(); const h = this.host(); const body = w.document.body;
      return {
        src: e.getAttribute('src'), poster: e.getAttribute('poster'), controls: e.hasAttribute('controls'),
        ownProxy: Object.getOwnPropertyDescriptor(e, 'currentTime') !== undefined, ownVideoWidth: Object.getOwnPropertyDescriptor(e, 'videoWidth') !== undefined,
        hostClasses: Array.from(h.classList).sort(), bodyClasses: Array.from(body.classList).sort(),
        hole: !!w.document.getElementById('ft-video-hole'), trackSrc: w.document.getElementById('cc-track').getAttribute('src'),
        dockHidden: w.document.getElementById('player-dock').hidden, state: this.player.getState(),
        fetches: calls.filter((c) => !/\/api\/queue/.test(c)).sort(),
      };
    },
    close: () => w.close(),
  };
}

test('W5: the placement sequence - slot, dock, expand, rotate into the CSS fullscreen, rotate back, a stand-down load - is exactly one rect message per placement, nothing between', async () => {
  const r = realm({ host: CAPS });
  try {
    r.player.load('v1', EARLY, { slot: r.slot });
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(120);
    r.fake.emit(STATE(r.fake.of('audio.load')[0].rev, 3, { videoSize: { w: 1920, h: 1080 } }));
    await settle(60);
    assert.strictEqual(r.el().videoWidth, 1920, 'the proxy carries the size');
    r.player.dock(); await settle(60);
    r.player.expand(r.slot); await settle(60);
    r.rotate(true, LANDSCAPE_FS); await settle(120);
    assert.strictEqual(r.host().classList.contains('css-fullscreen'), true, 'the sideways rotation enters the CSS fullscreen (the custom bar is the surface under native)');
    r.fake.emit(STATE(r.fake.of('audio.load')[0].rev, 4, { videoSize: { w: 1920, h: 1080 } })); // a snapshot mid-fullscreen moves nothing
    await settle(60);
    r.rotate(false, PORTRAIT); await settle(120);
    assert.strictEqual(r.host().classList.contains('css-fullscreen'), false, 'back to portrait leaves it');
    r.player.load('s1', Object.assign({}, VIDEO, { id: 's1', projection: 'equirect' }), { slot: r.slot }); await settle(80);
    const doc = (b) => ({ x: b.left, y: b.top, w: b.width, h: b.height });
    assert.deepStrictEqual(r.surfaces(), [
      { rect: doc(PORTRAIT), space: 'document', visible: true, fit: 'contain', radius: 12 },     // the slot
      { rect: doc(PORTRAIT), space: 'document', visible: false, fit: 'contain', radius: 12 },    // docked: hidden, the sound plays on
      { rect: doc(PORTRAIT), space: 'document', visible: true, fit: 'contain', radius: 12 },     // expanded
      { rect: doc(LANDSCAPE_FS), space: 'viewport', visible: true, fit: 'contain', radius: 0 },  // sideways: the CSS fullscreen box
      { rect: doc(PORTRAIT), space: 'document', visible: true, fit: 'contain', radius: 12 },     // upright again
      { rect: doc(PORTRAIT), space: 'document', visible: false, fit: 'contain', radius: 12 },    // the 360 load ends the surface
    ]);
    assert.ok(r.fake.types().indexOf('audio.stop') >= 0, 'the stand-down stopped native');
  } finally { r.close(); }
});

test('W5 (S11): the video path is byte-identical without nativeVideo - the page state after the same user sequence is the same for no host, a host without the capability and a host with none, and nothing native is posted', async () => {
  const sequence = async (r) => {
    r.player.load('v1', EARLY, { slot: r.slot });
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(120);
    r.player.dock(); await settle(40);
    r.player.expand(r.slot); await settle(40);
    r.host().querySelector('#cc-btn').click(); await settle(40);
    r.host().querySelector('#fs-btn').click(); await settle(40);
    r.rotate(true, LANDSCAPE_FS); await settle(80);
    r.rotate(false, PORTRAIT); await settle(80);
    return r.snapshot();
  };
  const noHost = realm({ host: null });
  const older = realm({ host: { capabilities: ['nativeAudio', 'nativeVideoAudio'] } });
  const bare = realm({ host: { capabilities: ['orientation', 'haptics'] } });
  try {
    const a = await sequence(noHost);
    const b = await sequence(older);
    const c = await sequence(bare);
    assert.deepStrictEqual(b, a, 'a v0.15.x app build (nativeAudio + nativeVideoAudio) leaves the video path exactly as a browser does');
    assert.deepStrictEqual(c, a, 'an app build with no media capability too');
    assert.strictEqual(a.src, '/video/v1', 'the web element plays the video');
    assert.strictEqual(a.hole, false);
    assert.ok(!a.bodyClasses.includes('ft-native-video'));
    assert.strictEqual(a.trackSrc, '/api/subtitles/v1');
    assert.strictEqual(a.ownProxy, false);
    for (const r of [older, bare]) assert.deepStrictEqual(r.fake.types().filter((t) => /^(audio|video)\./.test(t) && t !== 'audio.subscribe'), [], 'nothing native posted (a nativeAudio host subscribes at page start since v1.397.0, video or not)');
  } finally { noHost.close(); older.close(); bare.close(); }
});
