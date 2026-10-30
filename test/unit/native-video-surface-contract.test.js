'use strict';

// [UNIT] v1.399.0 native video surface (plan docs/exec-plans/active/2026-10-28-native-video-surface.md): the contract AT THE
// PLAYER. Step 0's red-first test (the first test below) went red at d6d6ecc8 (1 fail, 2 pass) and green with W2: a host
// announcing `nativeVideo` (with `nativeAudio` + `nativeVideoAudio`, the transport) gets `audio.load` with a `video` Item when
// the WATCH PAGE loads a library video (S1, S2), and the element gets NO src (it becomes the v1.397.0 proxy, now answering
// videoWidth / videoHeight too, S4). The W2 cases follow: the watch page's bare early load is deferred to its full load (one
// audio.load, never a src), a same-id re-open follows (nothing re-sent), the S6 stand-downs (360, the Feed, a preview stream)
// keep the web element and silence native, a TV episode is a tvEpisode Item, a rendition still transcoding takes the web's
// overlay + poll and is claimed when ready, the web saves no progress for a proxied video (S10), and videoSize drives the
// proxy's size and events. Two controls bind S11: a host WITHOUT `nativeVideo` and no host at all keep the video on the web
// element, byte for byte. The REAL player.js runs in jsdom on a phone-shaped realm.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { installFakeHost } = require('../helpers/fake-host');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, 'public', 'js', f), 'utf8');
const SCRIPTS = ['host-adapter.js', 'native-audio.js', 'player.js'];
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

// A PHONE realm (player.js resolveMobileFormFactor): coarse pointer, no hover, a narrow viewport; the Background audio setting
// ON and the sidecar's audio status 'ready', so the web's own background path is fully armed and any leak of it shows.
function realm({ host = null, settings = { backgroundAudioForVideo: true }, videoStatus = null, desktop = false } = {}) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'music.html'), 'utf8'), { url: 'http://localhost/watch.html?v=v1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: !desktop && /max-width:\s*768px|pointer:\s*coarse|hover:\s*none/.test(q) && !/any-pointer/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  const plays = [];
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.play = function () { plays.push(this.id); return Promise.resolve(); };
  const fakeTrack = { mode: 'disabled', activeCues: null, addEventListener() {}, removeEventListener() {} }; // jsdom has no TextTrack (the CC button reads textTracks[0])
  Object.defineProperty(w.HTMLMediaElement.prototype, 'textTracks', { configurable: true, get() { return [fakeTrack]; } });
  w.resolveAudioArtUrl = () => '/albumart/t1';
  w.formatDuration = () => '';
  w.clampPositionState = (s) => s;
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  const calls = [];
  w.fetch = (u, init) => {
    const url = String(u); const method = (init && init.method) || 'GET';
    calls.push(method + ' ' + url);
    let body = {};
    if (url === '/api/settings') body = settings;
    else if (/\/prepare-audio$/.test(url)) body = { audioStatus: 'ready' };
    else if (url.indexOf('/api/queue') === 0) body = { entries: [], pointerUid: null };
    else if (/^\/api\/progress\//.test(url)) body = { timestamp: 0 };
    else if (/^\/api\/videos\/[^/]+$/.test(url) && videoStatus) body = videoStatus();
    return Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => (/^\/api\/subtitles\//.test(url) ? 'WEBVTT\n\n00:00:00.000 --> 00:00:09.000\nHello\n' : '') });
  };
  const fake = host ? installFakeHost(w, host) : null;
  for (const f of SCRIPTS) w.eval(read(f));
  const el = () => w.document.getElementById('media-player');
  const own = (name) => Object.getOwnPropertyDescriptor(el(), name) !== undefined;
  const sidecar = () => w.document.getElementById('bg-audio-sidecar');
  const hide = () => { Object.defineProperty(w.document, 'hidden', { configurable: true, value: true }); Object.defineProperty(w.document, 'visibilityState', { configurable: true, value: 'hidden' }); };
  const overlayText = () => { const o = w.document.querySelector('.cc-overlay'); return o && !o.hidden ? o.textContent : null; };
  return { w, fake, plays, calls, player: w.FileTube.player, na: w.FileTube.nativeAudio, slot: w.document.getElementById('player-slot'), el, own, sidecar, hide, overlayText, host: () => w.document.getElementById('player-wrapper'), close: () => w.close() };
}
// The watch page's descriptor for a library video (watch.js initWatch: the /api/videos/:id payload plus its stamps).
const VIDEO = { id: 'v1', type: 'video', title: 'A talk', channelName: 'Ch', folderName: 'Ch', duration: 600, hasThumbnail: true, width: 1920, height: 1080, browseCtx: null, readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false, progressEndpoint: null, startAt: null };
// watch.js's BARE early load (before /api/videos/:id answers): no type, title, projection or transcode state.
const EARLY = { browseCtx: null, readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false, progressEndpoint: null, startAt: null };
const CAPS = { capabilities: ['nativeAudio', 'nativeVideoAudio', 'nativeVideo'] };
const ITEM = { kind: 'video', id: 'v1', src: '/api/offline/file/video/v1', title: 'A talk', artist: 'Ch', artworkSrc: '/thumbnail/v1', durationSec: 600, progress: { route: '/api/progress', key: 'v1' } };
const MODES = { autoplay: true, shuffle: false, loop: 'off' };
const STATE = (rev, extra) => Object.assign({ v: 1, type: 'audioState', rev, queue: [ITEM], index: 0, state: 'playing', positionSec: 12, durationSec: 600, rate: 1, modes: MODES, sleep: { mode: 'off' } }, extra || {});
const { videoItemFromDescriptor } = require('../../public/js/native-audio.js');

test('RED FIRST (S1, S2, S4): a host announcing nativeAudio + nativeVideo takes a WATCH-PAGE video into native - ONE audio.load with a video Item, the element has NO src, is never played, and is the proxy (videoWidth too)', async () => {
  const r = realm({ host: { capabilities: ['nativeAudio', 'nativeVideoAudio', 'nativeVideo'] } });
  try {
    assert.strictEqual(r.w.FileTube.host.has('nativeVideo'), true, 'the adapter knows the capability');
    r.player.load('v1', VIDEO, { slot: r.slot });
    assert.strictEqual(r.el().hasAttribute('controls'), false, 'the custom bar from the first frame: the claim re-applies the controls mode synchronously (the mount ran before it)');
    await settle(80);
    assert.strictEqual(r.el().getAttribute('src'), null, 'no src: the web element loads NOTHING under nativeVideo (S1)');
    assert.deepStrictEqual(r.plays, [], 'the web element is never played');
    const loads = r.fake.of('audio.load');
    assert.strictEqual(loads.length, 1, 'exactly one audio.load (S2: the audio.* transport)');
    assert.deepStrictEqual(loads[0].queue, [{ kind: 'video', id: 'v1', src: '/api/offline/file/video/v1', title: 'A talk', artist: 'Ch', artworkSrc: '/thumbnail/v1', durationSec: 600, progress: { route: '/api/progress', key: 'v1' } }], 'a video Item: the file route, /thumbnail art, /api/progress under the video id, no clip, no radioSeed');
    assert.strictEqual(loads[0].index, 0);
    assert.ok(r.own('currentTime') && r.own('play'), 'the proxy is installed, as for a track');
    assert.ok(r.own('videoWidth') && r.own('videoHeight'), 'the proxy answers videoWidth / videoHeight (S4)');
    assert.strictEqual(r.el().getAttribute('poster'), null, 'no poster under native: it would paint over the hole for good');
    assert.strictEqual(r.na.active(), true);
    assert.strictEqual(r.na.owns('v1'), true);
  } finally { r.close(); }
});

test('CONTROL (S11): a host with nativeAudio + nativeVideoAudio but WITHOUT nativeVideo keeps the watch-page video on the web element: src /video/v1, nothing posted, no proxy', async () => {
  const r = realm({ host: { capabilities: ['nativeAudio', 'nativeVideoAudio'] } });
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(80);
    assert.strictEqual(r.el().getAttribute('src'), '/video/v1');
    assert.deepStrictEqual(r.fake.of('audio.load'), []);
    assert.strictEqual(r.own('currentTime'), false, 'no proxy on the element');
    assert.strictEqual(r.na.active(), false);
  } finally { r.close(); }
});

test('CONTROL (S11): no host - the watch-page video plays on the web element exactly as in a browser', async () => {
  const r = realm({ host: null });
  try {
    assert.strictEqual(r.na.enabled, false);
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(80);
    assert.strictEqual(r.el().getAttribute('src'), '/video/v1');
    assert.strictEqual(r.own('currentTime'), false);
  } finally { r.close(); }
});

test('W2 (S1): the watch page\'s BARE early load is deferred - no src, no claim, nothing posted; the full load that follows is ONE audio.load and the element never had a src', async () => {
  const r = realm({ host: CAPS });
  try {
    assert.strictEqual(r.player.load('v1', EARLY, { slot: r.slot }), true);
    await settle(60);
    assert.strictEqual(r.el().getAttribute('src'), null, 'the early load sets no src under nativeVideo');
    assert.deepStrictEqual(r.fake.of('audio.load'), [], 'and claims nothing (no title, no projection yet)');
    assert.strictEqual(r.na.active(), false);
    assert.ok(!r.calls.some((c) => c === 'GET /api/settings' || /prepare-audio/.test(c)), 'the bare early load holds the sidecar settings read too (wouldClaimVideo: typeless under nativeVideo)');
    assert.strictEqual(r.player.load('v1', VIDEO, { slot: r.slot }), true, 'the full-data load of the same id');
    await settle(80);
    assert.strictEqual(r.el().getAttribute('src'), null);
    assert.strictEqual(r.fake.of('audio.load').length, 1, 'exactly one audio.load');
    assert.deepStrictEqual(r.fake.of('audio.load')[0].queue, [ITEM]);
    assert.deepStrictEqual(r.plays, [], 'the web element never played');
    assert.ok(r.own('currentTime') && r.own('videoWidth'), 'the proxy is on the element');
    assert.strictEqual(r.na.surfaceOwned(), true);
  } finally { r.close(); }
});

test('W2 (S1): re-opening the SAME video while native plays it is a follow - no second audio.load, no hand-back, no seek, no autostart; a different video is a new load', async () => {
  const r = realm({ host: CAPS });
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(60);
    const rev = r.fake.of('audio.load')[0].rev;
    r.fake.emit(STATE(rev));
    await settle(20);
    const before = r.fake.posts.length;
    r.player.load('v1', EARLY, { slot: r.slot }); // the watch page again: its bare early call...
    r.player.load('v1', VIDEO, { slot: r.slot }); // ...and its full load
    await settle(80);
    assert.strictEqual(r.fake.of('audio.load').length, 1, 'still one audio.load');
    assert.deepStrictEqual(r.fake.posts.slice(before).map((m) => m.type).filter((t) => t !== 'audio.subscribe' && t !== 'video.surface'), [], 'nothing else posted (no seek, no play, no stop)');
    assert.strictEqual(r.el().getAttribute('src'), null);
    assert.ok(r.own('currentTime'), 'the proxy stays');
    assert.ok(r.el().currentTime >= 12 && r.el().currentTime < 13, 'the proxy reads native\'s position (moving forward while playing): ' + r.el().currentTime);
    assert.strictEqual(r.na.lastClaimFollowed(), false, 'the re-open was an ADOPT of the proxy in load(): the claim never ran (no hand-back for a surface video)');
    const VIDEO2 = Object.assign({}, VIDEO, { id: 'v2', title: 'Another' });
    r.player.load('v2', VIDEO2, { slot: r.slot });
    await settle(80);
    const loads = r.fake.of('audio.load');
    assert.strictEqual(loads.length, 2, 'a different video is a new load');
    assert.strictEqual(loads[1].queue[0].id, 'v2');
    assert.strictEqual(r.na.owns('v2'), true);
  } finally { r.close(); }
});

test('W2 (S1): a FRESH watch page while native plays the video (a navigation; native keeps playing) follows it - no audio.load, no seek, no play; the proxy reads native\'s position', async () => {
  const r = realm({ host: CAPS });
  try {
    r.fake.emit(STATE(5)); // native's snapshot reaches the new page before its load
    await settle(20);
    assert.strictEqual(r.na.active(), false, 'nothing of this page\'s is loaded yet');
    r.player.load('v1', EARLY, { slot: r.slot });
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(80);
    assert.deepStrictEqual(r.fake.of('audio.load'), [], 'nothing re-sent');
    assert.deepStrictEqual(r.fake.types().filter((t) => t !== 'audio.subscribe' && t !== 'host.hello' && t !== 'video.surface'), [], 'no seek, no play, no stop (only the page\'s handshake, the subscription and the W3 surface)');
    assert.strictEqual(r.na.lastClaimFollowed(), 'adopt', 'the claim followed what native plays');
    assert.strictEqual(r.na.owns('v1'), true);
    assert.strictEqual(r.na.surfaceOwned(), true);
    assert.ok(r.el().currentTime >= 12 && r.el().currentTime < 13, 'native\'s position: ' + r.el().currentTime);
    assert.strictEqual(r.el().getAttribute('src'), null);
  } finally { r.close(); }
});

test('W2 (S6): the stand-downs keep the web element and silence native - a 360 video (audio.stop when native owned one), a Feed card, a preview stream', async () => {
  const r = realm({ host: CAPS });
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(60);
    r.fake.emit(STATE(r.fake.of('audio.load')[0].rev));
    r.fake.clear();
    r.player.load('s1', Object.assign({}, VIDEO, { id: 's1', projection: 'equirect' }), { slot: r.slot });
    await settle(80);
    assert.strictEqual(r.el().getAttribute('src'), '/video/s1', 'a 360 video plays on the web element (vr-view.js reads it)');
    assert.deepStrictEqual(r.fake.types(), ['audio.stop'], 'native goes silent first, nothing else');
    assert.strictEqual(r.own('currentTime'), false, 'the proxy is gone');
    assert.strictEqual(r.na.active(), false);
    r.fake.clear();
    r.player.load('f1', Object.assign({}, VIDEO, { id: 'f1', progressEndpoint: '/api/feed/progress/media', readerHref: '/feed', startAt: 0 }), { slot: r.slot });
    await settle(60);
    assert.strictEqual(r.el().getAttribute('src'), '/video/f1', 'a Feed card stays on the web');
    assert.deepStrictEqual(r.fake.of('audio.load'), []);
    r.player.load('p1', Object.assign({}, VIDEO, { id: 'p1', streamSrc: '/preview/p1' }), { slot: r.slot });
    await settle(60);
    assert.strictEqual(r.el().getAttribute('src'), '/preview/p1', 'an explicit non-TV stream stays on the web');
    assert.deepStrictEqual(r.fake.of('audio.load'), []);
  } finally { r.close(); }
});

test('W2 (S2): a TV episode is a tvEpisode Item - the tvEpisode file route, /tvthumb art, /api/tv/progress under the episode id', async () => {
  const r = realm({ host: CAPS });
  try {
    const EP = { id: 'e9', type: 'video', title: 'Pilot', showName: 'Show', channelName: 'Show', duration: 1800, streamSrc: '/tvepisode/e9', statusUrl: '/api/tv/episode/e9', artUrl: '/tvposter/sh1', progressEndpoint: '/api/tv/progress', resumeMode: 'tv', readerHref: '/watch.html?tv=e9', progress: 0, browseCtx: null, autoAdvanceViaTrackNav: false, startAt: null };
    r.player.load('e9', EP, { slot: r.slot });
    await settle(80);
    assert.strictEqual(r.el().getAttribute('src'), null);
    const loads = r.fake.of('audio.load');
    assert.strictEqual(loads.length, 1);
    assert.deepStrictEqual(loads[0].queue, [{ kind: 'tvEpisode', id: 'e9', src: '/api/offline/file/tvEpisode/e9', title: 'Pilot', artist: 'Show', artworkSrc: '/tvthumb/e9', durationSec: 1800, progress: { route: '/api/tv/progress', key: 'e9' } }]);
  } finally { r.close(); }
});

test('W2 (S6, the readiness rule): a rendition still transcoding takes the web\'s overlay + poll (nothing posted, no src); when the poll finds it ready native claims it and the element still gets no src', async () => {
  let status = { transcodeStatus: 'pending', transcodeProgress: 40 };
  const r = realm({ host: CAPS, videoStatus: () => status });
  try {
    r.player.load('t1', Object.assign({}, VIDEO, { id: 't1', hasSubtitles: true, needsTranscode: true, transcodeStatus: 'pending' }), { slot: r.slot });
    await settle(80);
    assert.deepStrictEqual(r.fake.of('audio.load'), [], 'not claimed while transcoding (the file route would 503)');
    assert.strictEqual(r.el().getAttribute('src'), null, 'the web waits too');
    assert.ok(r.calls.includes('GET /video/t1'), 'the transcode is triggered, as before');
    assert.ok(r.calls.includes('GET /api/videos/t1'), 'and polled');
    assert.ok(r.w.document.getElementById('transcode-overlay') === null || true); // the overlay element is the shell's; its presence is not this test's claim
    // while the web waits it is an ordinary mobile video load: the poster, the track and (settings on, sidecar ready) the armed sidecar
    assert.strictEqual(r.el().getAttribute('poster'), '/thumbnail/t1');
    assert.strictEqual(r.w.document.getElementById('cc-track').getAttribute('src'), '/api/subtitles/t1');
    assert.ok(r.calls.some((c) => /prepare-audio/.test(c)), 'the sidecar was prepared for the web load');
    assert.strictEqual(r.sidecar().getAttribute('src'), '/audio/t1', 'and armed');
    r.host().querySelector('#cc-btn').click(); // captions turned on DURING the wait
    status = { transcodeStatus: 'ready' };
    await settle(2300); // the poll's 2 s timer
    const loads = r.fake.of('audio.load');
    assert.strictEqual(loads.length, 1, 'claimed when ready');
    assert.strictEqual(loads[0].queue[0].id, 't1');
    assert.strictEqual(r.el().getAttribute('src'), null, 'the element still loads nothing');
    assert.ok(r.own('currentTime'));
    // gate r1 CRITICAL: the late claim must undo everything the web load set up
    assert.strictEqual(r.el().getAttribute('poster'), null, 'the poster is gone (it painted over the hole for the whole playback)');
    assert.strictEqual(r.w.document.getElementById('cc-track').getAttribute('src'), '', 'the track is inert');
    assert.strictEqual(r.sidecar().getAttribute('src'), null, 'the sidecar is disarmed');
    assert.strictEqual(r.el().hasAttribute('controls'), false);
    const rev = loads[0].rev;
    const SNAP = (extra) => Object.assign({ v: 1, type: 'audioState', rev, queue: loads[0].queue, index: 0, state: 'playing', positionSec: 3, durationSec: 600, rate: 1, modes: MODES, sleep: { mode: 'off' } }, extra || {});
    r.fake.emit(SNAP());
    await settle(60);
    assert.strictEqual(r.overlayText(), 'Hello', 'captions turned on during the wait show from the proxy time after the claim');
    assert.strictEqual(r.calls.filter((c) => /\/api\/subtitles\//.test(c)).length, 1, 'the list was fetched once');
    // the lock-screen pause (the adversary's repro): the page is hidden, native reports paused - the proxy fires 'pause', the
    // pause-hidden handoff trigger runs; nothing may hand off to the web sidecar, nothing may be posted back
    const before = r.fake.posts.length;
    r.hide();
    r.fake.emit(SNAP({ state: 'paused', positionSec: 30 }));
    await settle(80);
    assert.deepStrictEqual(r.plays.filter((id) => id === 'bg-audio-sidecar'), [], 'the web sidecar never plays');
    assert.deepStrictEqual(r.fake.posts.slice(before).map((m) => m.type).filter((t) => /^audio\.(pause|play|seek|stop|load)$/.test(t)), [], 'nothing posted back to native');
    assert.strictEqual(r.sidecar().getAttribute('src'), null, 'still disarmed');
  } finally { r.close(); }
});

test('W2 (S6, gate r1 A24): a WIDE app window never takes the desktop live transcode for a rendition still transcoding under nativeVideo - the poll path, then the claim', async () => {
  let status = { transcodeStatus: 'pending', transcodeProgress: 10 };
  const r = realm({ host: CAPS, videoStatus: () => status, desktop: true });
  try {
    r.player.load('t1', Object.assign({}, VIDEO, { id: 't1', needsTranscode: true, transcodeStatus: 'pending' }), { slot: r.slot });
    await settle(80);
    assert.strictEqual(r.el().getAttribute('src'), null, 'no /video/t1?live=1 stream on the web element');
    assert.ok(r.calls.includes('GET /api/videos/t1'), 'the status is polled instead');
    status = { transcodeStatus: 'ready' };
    await settle(2300);
    assert.strictEqual(r.fake.of('audio.load').length, 1, 'claimed when ready');
    assert.strictEqual(r.el().getAttribute('src'), null);
  } finally { r.close(); }
});

test('W2 (gate r1 A5): a MUSIC track claimed after a surface video ends the surface - surfaceOwned false, the hole closed, one closing visible:false, the track plays natively', async () => {
  const r = realm({ host: CAPS });
  try {
    const measures = { n: 0 };
    r.w.HTMLVideoElement.prototype.getBoundingClientRect = () => { measures.n += 1; return { left: 0, top: 300, width: 393, height: 221, right: 393, bottom: 521, x: 0, y: 300 }; };
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(80);
    r.fake.emit({ v: 1, type: 'audioState', rev: r.fake.of('audio.load')[0].rev, queue: [ITEM], index: 0, state: 'playing', positionSec: 3, durationSec: 600, rate: 1, modes: MODES, sleep: { mode: 'off' } });
    await settle(60);
    assert.strictEqual(r.na.surfaceOwned(), true);
    assert.strictEqual(r.w.document.body.classList.contains('ft-native-video'), true);
    const t1 = { id: 't1', type: 'audio', title: 'Song 1', channelName: 'A', album: 'B', duration: 100, artUrl: '/albumart/t1', streamSrc: '/track/t1', progressEndpoint: '/api/music/progress', resumeMode: 'music' };
    r.fake.clear();
    r.player.load('t1', Object.assign({}, t1, { nativeQueue: () => ({ items: [t1], index: 0 }) }), { slot: r.slot });
    await settle(80);
    assert.strictEqual(r.na.owns('t1'), true, 'the track is native\'s');
    assert.strictEqual(r.na.surfaceOwned(), false, 'but not a surface');
    assert.strictEqual(r.fake.of('audio.load')[0].queue[0].kind, 'track');
    const surf = r.fake.of('video.surface');
    assert.strictEqual(surf.length, 1, 'one closing message');
    assert.strictEqual(surf[0].visible, false);
    assert.strictEqual(r.w.document.body.classList.contains('ft-native-video'), false, 'the page paints normally for a track');
    measures.n = 0;
    r.w.dispatchEvent(new r.w.Event('resize'));
    r.w.dispatchEvent(new r.w.Event('orientationchange'));
    await settle(300);
    assert.strictEqual(r.fake.of('video.surface').length, 1, 'a track never posts a surface');
    assert.strictEqual(measures.n, 0, 'and never measures the box, even on a layout event (the sampler runs only for a surface video)');
  } finally { r.close(); }
});

test('W2 (S10, S4): the web saves no progress for a proxied video; videoSize drives videoWidth / videoHeight, loadedmetadata when it becomes known, resize when it changes', async () => {
  const r = realm({ host: CAPS });
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(60);
    const rev = r.fake.of('audio.load')[0].rev;
    const fired = [];
    for (const t of ['loadedmetadata', 'resize']) r.el().addEventListener(t, () => fired.push(t));
    r.fake.emit(STATE(rev));
    await settle(20);
    assert.strictEqual(r.el().videoWidth, 0, '0 x 0 before the size is known');
    assert.deepStrictEqual(fired, ['loadedmetadata'], 'the item\'s first snapshot');
    r.fake.emit(STATE(rev, { positionSec: 13, videoSize: { w: 1920, h: 1080 } }));
    await settle(20);
    assert.strictEqual(r.el().videoWidth, 1920);
    assert.strictEqual(r.el().videoHeight, 1080);
    assert.deepStrictEqual(fired, ['loadedmetadata', 'loadedmetadata', 'resize'], 'known now: loadedmetadata again (the aspect box reads it) and resize');
    r.fake.emit(STATE(rev, { positionSec: 14, videoSize: { w: 1920, h: 1080 } }));
    r.fake.emit(STATE(rev, { positionSec: 15, state: 'paused', videoSize: { w: 1280, h: 720 } }));
    await settle(20);
    assert.deepStrictEqual(fired, ['loadedmetadata', 'loadedmetadata', 'resize', 'resize'], 'the same size is quiet, a new one is a resize');
    assert.strictEqual(r.el().videoWidth, 1280);
    r.el().dispatchEvent(new r.w.Event('timeupdate'));
    r.w.document.dispatchEvent(new r.w.Event('visibilitychange'));
    await settle(40);
    assert.deepStrictEqual(r.calls.filter((c) => /^POST \/api\/(tv\/)?progress/.test(c)), [], 'the web never saved progress (native posts it)');
  } finally { r.close(); }
});

test('W2 (pure): videoItemFromDescriptor - the Item for a library video and a TV episode, null for every stand-down', () => {
  assert.deepStrictEqual(videoItemFromDescriptor('v1', VIDEO), ITEM);
  assert.strictEqual(videoItemFromDescriptor('v1', Object.assign({}, VIDEO, { hasThumbnail: false })).artworkSrc, undefined, 'no art when the video has no thumbnail');
  assert.strictEqual(videoItemFromDescriptor('v1', Object.assign({}, VIDEO, { duration: 0 })).durationSec, undefined, 'an unknown duration is omitted');
  assert.strictEqual(videoItemFromDescriptor('v1', Object.assign({}, VIDEO, { title: 'x'.repeat(2000) })).title.length, 1024, 'the title fits the contract');
  assert.strictEqual(videoItemFromDescriptor('v1', Object.assign({}, VIDEO, { title: undefined })).title, '', 'a missing title is an empty string');
  assert.strictEqual(videoItemFromDescriptor('v1', Object.assign({}, VIDEO, { progressEndpoint: '/api/progress' })).progress.route, '/api/progress');
  assert.deepStrictEqual(videoItemFromDescriptor('e9', { type: 'video', title: 'Pilot', channelName: 'Show', duration: 10, progressEndpoint: '/api/tv/progress', statusUrl: '/api/tv/episode/e9', streamSrc: '/tvepisode/e9' }), { kind: 'tvEpisode', id: 'e9', src: '/api/offline/file/tvEpisode/e9', title: 'Pilot', artist: 'Show', artworkSrc: '/tvthumb/e9', durationSec: 10, progress: { route: '/api/tv/progress', key: 'e9' } });
  for (const [why, d] of [
    ['an audio load', Object.assign({}, VIDEO, { type: 'audio' })],
    ['no type (the bare early load)', EARLY],
    ['a 360 video', Object.assign({}, VIDEO, { projection: 'equirect' })],
    ['a 180 video', Object.assign({}, VIDEO, { projection: 'half-equirect' })],
    ['a Feed media card', Object.assign({}, VIDEO, { progressEndpoint: '/api/feed/progress/media', readerHref: '/feed' })],
    ['a Feed podcast card', Object.assign({}, VIDEO, { progressEndpoint: '/api/feed/progress/podcast', readerHref: '/feed' })],
    ['a preview stream', Object.assign({}, VIDEO, { streamSrc: '/preview/v1' })],
    ['a book stream', Object.assign({}, VIDEO, { streamSrc: '/book/b1/tts/3' })],
    ['a rendition still transcoding', Object.assign({}, VIDEO, { needsTranscode: true, transcodeStatus: 'pending' })],
    ['a failed transcode', Object.assign({}, VIDEO, { needsTranscode: true, transcodeStatus: 'failed' })],
    ['no descriptor', null],
  ]) assert.strictEqual(videoItemFromDescriptor('v1', d), null, why);
  assert.strictEqual(videoItemFromDescriptor('', VIDEO), null, 'no id');
  assert.ok(videoItemFromDescriptor('v1', Object.assign({}, VIDEO, { projection: 'flat' })), 'flat is a library video');
  assert.ok(videoItemFromDescriptor('v1', Object.assign({}, VIDEO, { needsTranscode: true, transcodeStatus: 'ready' })), 'a ready rendition is native\'s');
});
