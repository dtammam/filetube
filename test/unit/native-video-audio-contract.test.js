'use strict';

// [UNIT] v1.398.0 native video audio (plan docs/exec-plans/completed/2026-10-28-native-video-audio.md): the contract AT THE PLAYER.
// Step 0's red-first test asked for the BACKGROUND HANDOFF (V2a / V7: a playing video that backgrounds posts audio.load with a
// video Item and the sidecar is never played); it went red at 59245046 (1 fail, 2 pass). The iOS Root's spike then FAILED (the
// audio session cannot be activated from a backgrounded app, OSStatus 560557684 '!int'), the stop rule fired and Dean chose a
// native video SURFACE for the next plan, so the handoff is SUPERSEDED and never built here: with or without `nativeVideoAudio`
// a backgrounded video takes the v1.397.0 sidecar, byte for byte (the two controls below now bind that). What v1.398.0 ships at
// the player is V2b: a LISTEN row (a video played as audio from the watch page) loads into native as a `video` Item like a song,
// only when the host announces `nativeVideoAudio` (V3); the pure S1 helpers (Listen -> Watch on the same id is a web load that
// carries the proxy's position) are bound here too. The REAL player.js runs in jsdom on a phone-shaped realm.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { installFakeHost } = require('../helpers/fake-host');
const { isNativeHandBackLoad, nativeHandBackCarry } = require('../../public/js/player.js');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, 'public', 'js', f), 'utf8');
const SCRIPTS = ['host-adapter.js', 'native-audio.js', 'player.js'];
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

// A PHONE realm: coarse pointer, no hover, no fine pointer anywhere, a narrow viewport (player.js resolveMobileFormFactor),
// the Background audio setting ON and the sidecar's audio status 'ready' (the v1.397.0 sidecar path fully armed).
function realm({ host = null, settings = { backgroundAudioForVideo: true } } = {}) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'music.html'), 'utf8'), { url: 'http://localhost/music', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: /max-width:\s*768px|pointer:\s*coarse|hover:\s*none/.test(q) && !/any-pointer/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  const plays = [];
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.play = function () { plays.push(this.id); return Promise.resolve(); };
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
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  const fake = host ? installFakeHost(w, host) : null;
  for (const f of SCRIPTS) w.eval(read(f));
  const el = () => w.document.getElementById('media-player');
  const sidecar = () => w.document.getElementById('bg-audio-sidecar');
  const playingAt = (t) => { const m = el(); Object.defineProperty(m, 'paused', { configurable: true, get: () => false }); Object.defineProperty(m, 'currentTime', { configurable: true, get: () => t, set: () => {} }); };
  const hide = () => { Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => 'hidden' }); w.document.dispatchEvent(new w.Event('visibilitychange')); };
  const own = (name) => Object.getOwnPropertyDescriptor(el(), name) !== undefined;
  return { w, fake, plays, calls, player: w.FileTube.player, na: w.FileTube.nativeAudio, slot: w.document.getElementById('player-slot'), el, sidecar, playingAt, hide, own, close: () => w.close() };
}
const VIDEO = { id: 'v1', type: 'video', title: 'A talk', channelName: 'Ch', folderName: 'Ch', duration: 600, hasThumbnail: true };
// the Listen row's descriptor as music.js trackLoadData builds it for a video played as audio (listen: true, hasThumbnail carried)
const listenData = (nativeQueue) => Object.assign({ id: 'vid1', type: 'audio', title: 'A talk', channelName: 'Ch', folderName: 'Ch', album: '', duration: 600, artUrl: '/thumbnail/vid1', streamSrc: '/video/vid1', progressEndpoint: '/api/progress', resumeMode: 'music', listen: true, hasThumbnail: true, radioSeed: undefined, readerHref: '/music?nowplaying=1' }, nativeQueue ? { nativeQueue } : {});

test('V2b: a host announcing nativeAudio + nativeVideoAudio takes a LISTEN row into native - ONE audio.load with a video Item (the file route, /thumbnail art, /api/progress under the file id, no radioSeed), the element has no src and is the proxy', async () => {
  const r = realm({ host: { capabilities: ['nativeAudio', 'nativeVideoAudio'] } });
  try {
    assert.strictEqual(r.w.FileTube.host.has('nativeVideoAudio'), true, 'the adapter knows the capability');
    assert.strictEqual(r.na.videoAudio, true, 'native-audio.js knows it too');
    const data = listenData(() => ({ items: [listenData()], index: 0 }));
    r.player.load('vid1', data, { slot: r.slot });
    await settle(80);
    assert.strictEqual(r.el().getAttribute('src'), null, 'no src: the web element is silent under native');
    assert.deepStrictEqual(r.plays, [], 'the web element is never played');
    const loads = r.fake.of('audio.load');
    assert.strictEqual(loads.length, 1, 'exactly one audio.load');
    assert.deepStrictEqual(loads[0].queue, [{ kind: 'video', id: 'vid1', src: '/api/offline/file/video/vid1', title: 'A talk', artist: 'Ch', artworkSrc: '/thumbnail/vid1', durationSec: 600, progress: { route: '/api/progress', key: 'vid1' } }]);
    assert.strictEqual(loads[0].index, 0);
    assert.ok(r.own('currentTime') && r.own('play'), 'the proxy is installed, as for a track');
    assert.strictEqual(r.na.active(), true);
    assert.strictEqual(r.na.owns('vid1'), true);
  } finally { r.close(); }
});

test('V3: a host with nativeAudio but WITHOUT nativeVideoAudio (a v0.14.0 app build) keeps the Listen row on the web element: src /video/<id>, nothing posted, no proxy (byte-identical to v1.397.0)', async () => {
  const r = realm({ host: { capabilities: ['nativeAudio'] } });
  try {
    assert.strictEqual(r.na.videoAudio, false);
    // music.js supplies no nativeQueue for a Listen row without the capability; and even if one is supplied, the Item builder refuses it
    r.player.load('vid1', listenData(() => ({ items: [listenData()], index: 0 })), { slot: r.slot });
    await settle(80);
    assert.strictEqual(r.el().getAttribute('src'), '/video/vid1', 'the web element plays the video\'s audio, as today');
    assert.deepStrictEqual(r.fake.of('audio.load'), [], 'never claimed');
    assert.strictEqual(r.own('currentTime'), false);
    assert.strictEqual(r.na.active(), false);
  } finally { r.close(); }
});

test('V11: no host - the Listen row is the browser path, nothing changes', async () => {
  const r = realm({ host: null });
  try {
    r.player.load('vid1', listenData(() => ({ items: [listenData()], index: 0 })), { slot: r.slot });
    await settle(80);
    assert.strictEqual(r.el().getAttribute('src'), '/video/vid1');
    assert.strictEqual(r.own('currentTime'), false);
  } finally { r.close(); }
});

test('SUPERSEDED (the spike failed; next plan): with nativeAudio + nativeVideoAudio a PLAYING video that backgrounds still takes the v1.397.0 sidecar - the sidecar plays, nothing is posted (player.js\'s background-audio path is byte-identical with the capability)', async () => {
  const r = realm({ host: { capabilities: ['nativeAudio', 'nativeVideoAudio'] } });
  try {
    r.player.load('v1', Object.assign({}, VIDEO), { slot: r.slot });
    await settle(80);
    assert.ok(r.calls.includes('GET /api/settings'), 'the mobile video load read the setting (the realm is a phone)');
    assert.ok(r.calls.some((c) => /prepare-audio$/.test(c)), 'the sidecar is prepared, as in v1.397.0');
    assert.ok(r.sidecar(), 'the sidecar element exists (ensureHost)');
    r.playingAt(123.4);
    r.hide();
    await settle(40);
    assert.deepStrictEqual(r.plays.filter((id) => id === 'bg-audio-sidecar'), ['bg-audio-sidecar'], 'the sidecar is the background element');
    assert.deepStrictEqual(r.fake.of('audio.load'), [], 'no handoff to native (superseded)');
    assert.deepStrictEqual(r.fake.of('audio.stop'), [], 'nothing posted at all');
  } finally { r.close(); }
});

test('CONTROL: a host with nativeAudio only, and no host - the same sidecar path', async () => {
  for (const host of [{ capabilities: ['nativeAudio'] }, null]) {
    const r = realm({ host });
    try {
      r.player.load('v1', Object.assign({}, VIDEO), { slot: r.slot });
      await settle(80);
      r.playingAt(50);
      r.hide();
      await settle(40);
      assert.deepStrictEqual(r.plays.filter((id) => id === 'bg-audio-sidecar'), ['bg-audio-sidecar']);
      if (r.fake) assert.deepStrictEqual(r.fake.of('audio.load'), []);
    } finally { r.close(); }
  }
});

test('S1 (pure): a same-id load that takes an item BACK from native (the watch page re-opening a Listen row native plays) is a hand-back only when it is an adopt, native owns the id as a VIDEO Item, the load DESCRIBES the media (a type) and carries no nativeQueue; the carry keeps the proxy\'s position and paused state', () => {
  const web = { type: 'video', title: 'A talk' };
  const music = { type: 'audio', nativeQueue: () => ({ items: [], index: 0 }) };
  assert.strictEqual(isNativeHandBackLoad(true, true, web, 'video'), true);
  assert.strictEqual(isNativeHandBackLoad(true, true, undefined, 'video'), false, 'gate r1 A-W1: a bare adopt call (no data) stays an adopt of the proxy');
  assert.strictEqual(isNativeHandBackLoad(true, true, { browseCtx: '', readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false, progressEndpoint: null }, 'video'), false, 'the watch page\'s early-adopt call (no type) stays an adopt');
  assert.strictEqual(isNativeHandBackLoad(true, true, web, 'track'), false, 'gate r1 A-W1: a library audio file native plays as a track keeps the proxy on the watch page (v1.397.0, V3)');
  assert.strictEqual(isNativeHandBackLoad(true, true, web, null), false);
  assert.strictEqual(isNativeHandBackLoad(true, true, music, 'video'), false, 'the Music view re-loading its own row is a FOLLOW, never a hand-back');
  assert.strictEqual(isNativeHandBackLoad(true, false, web, 'video'), false, 'native does not own it: a plain adopt');
  assert.strictEqual(isNativeHandBackLoad(false, true, web, 'video'), false, 'not an adopt: the ordinary fresh-load path (its own carry)');
  assert.deepStrictEqual(nativeHandBackCarry(120.5, false), { t: 120.5, paused: false });
  assert.deepStrictEqual(nativeHandBackCarry(77, true), { t: 77, paused: true });
  assert.strictEqual(nativeHandBackCarry(0, false), null, 'at 0 there is nothing to carry: the ordinary resume reads the saved place');
  assert.strictEqual(nativeHandBackCarry(NaN, false), null);
  assert.strictEqual(nativeHandBackCarry(undefined, true), null);
});
