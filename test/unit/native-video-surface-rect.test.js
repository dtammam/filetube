'use strict';

// [UNIT] v1.399.0 native video surface, W3 (plan docs/exec-plans/active/2026-10-28-native-video-surface.md, S3 + S3a + S5 + S8 +
// S9): the PICTURE SURFACE at the player, with the REAL player.js + native-audio.js in a phone-shaped jsdom realm and a fake host.
// The web tells native where the player box is with ONE coalesced `video.surface` per layout change (document space in the page,
// viewport space in the web's CSS fullscreen; nothing while nothing moves), paints the HOLE (body.ft-native-video + #ft-video-hole
// clipped around the box, S5), hides the picture while docked and shows the thumbnail there (S3a), takes the CSS fullscreen and
// FileTube's own bar (S8, S1), and never pauses, hands off or arms the sidecar at hidden (S9). Without `nativeVideo`: none of it (S11).

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
const VIDEO = { id: 'v1', type: 'video', title: 'A talk', channelName: 'Ch', folderName: 'Ch', duration: 600, hasThumbnail: true, width: 1920, height: 1080, browseCtx: null, readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false, progressEndpoint: null, startAt: null };
const MODES = { autoplay: true, shuffle: false, loop: 'off' };
const ITEM = { kind: 'video', id: 'v1', src: '/api/offline/file/video/v1', title: 'A talk', artist: 'Ch', artworkSrc: '/thumbnail/v1', durationSec: 600, progress: { route: '/api/progress', key: 'v1' } };
const STATE = (rev, extra) => Object.assign({ v: 1, type: 'audioState', rev, queue: [ITEM], index: 0, state: 'playing', positionSec: 12, durationSec: 600, rate: 1, modes: MODES, sleep: { mode: 'off' } }, extra || {});

function realm({ host = null, desktop = false } = {}) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'music.html'), 'utf8'), { url: 'http://localhost/watch.html?v=v1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  // a phone (coarse pointer, no hover, narrow) by default; `desktop` = a wide app window with a fine pointer (an iPad, a Mac)
  w.matchMedia = (q) => ({ matches: !desktop && /max-width:\s*768px|pointer:\s*coarse|hover:\s*none/.test(q) && !/any-pointer/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
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
    const url = String(u); calls.push(((init && init.method) || 'GET') + ' ' + url);
    let body = {};
    if (url === '/api/settings') body = { backgroundAudioForVideo: true };
    else if (/\/prepare-audio$/.test(url)) body = { audioStatus: 'ready' };
    else if (url.indexOf('/api/queue') === 0) body = { entries: [], pointerUid: null };
    else if (/^\/api\/progress\//.test(url)) body = { timestamp: 0 };
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  const fake = host ? installFakeHost(w, host) : null;
  // the player box's rounded corner (style.css .player-container --r-md; jsdom resolves no tokens): a plain rule jsdom's cascade applies
  const style = w.document.createElement('style'); style.textContent = '#player-wrapper { border-top-left-radius: 12px; }'; w.document.head.appendChild(style);
  for (const f of SCRIPTS) w.eval(read(f));
  const el = () => w.document.getElementById('media-player');
  // the player box the browser would lay out (jsdom lays nothing out): viewport coords, as getBoundingClientRect answers
  let box = { left: 0, top: 300, width: 393, height: 221 };
  const setBox = (b) => { box = b; };
  const scroll = { y: 0 };
  return {
    w, fake, plays, calls, el, setBox, scroll,
    player: w.FileTube.player, na: w.FileTube.nativeAudio,
    slot: w.document.getElementById('player-slot'),
    host: () => w.document.getElementById('player-wrapper'),
    hole: () => w.document.getElementById('ft-video-hole'),
    bodyOn: () => w.document.body.classList.contains('ft-native-video'),
    surfaces: () => fake.of('video.surface'),
    last: () => { const s = fake.of('video.surface'); return s[s.length - 1]; },
    stubBox() {
      // the host template is instantiated by the first load, so the box is stubbed on every <video> of this realm
      w.HTMLVideoElement.prototype.getBoundingClientRect = () => ({ left: box.left, top: box.top, width: box.width, height: box.height, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top });
      try { Object.defineProperty(w, 'scrollY', { configurable: true, get: () => scroll.y }); Object.defineProperty(w, 'scrollX', { configurable: true, get: () => 0 }); } catch (_) { /* jsdom may refuse: the tests then read y as 0 */ }
    },
    close: () => w.close(),
  };
}
async function loaded(r) {
  r.stubBox();
  r.player.load('v1', VIDEO, { slot: r.slot });
  await settle(80);
  const loads = r.fake.of('audio.load');
  assert.strictEqual(loads.length, 1, 'the claim');
  r.fake.emit(STATE(loads[0].rev));
  await settle(60);
}

test('W3 (S3, S5, S1): in the slot the web posts ONE video.surface - the element box in DOCUMENT space, visible, contain, the box radius - paints the hole around it, and keeps its own bar (no native controls strip)', async () => {
  const r = realm({ host: CAPS });
  try {
    r.scroll.y = 100;
    await loaded(r);
    const msg = r.last();
    assert.ok(msg, 'a video.surface was posted');
    const docY = r.w.scrollY === 100 ? 400 : 300;
    assert.deepStrictEqual(msg, { v: 1, type: 'video.surface', rect: { x: 0, y: docY, w: 393, h: 221 }, space: 'document', visible: true, fit: 'contain', radius: 12 });
    assert.strictEqual(r.surfaces().filter((m) => m.visible).length, 1, 'the visible placement went out once');
    assert.strictEqual(r.bodyOn(), true, 'body.ft-native-video: the page paints transparent behind the hole layer');
    const hole = r.hole();
    assert.ok(hole && hole.parentNode === r.w.document.body, '#ft-video-hole is on the body');
    const clip = hole.style.getPropertyValue('clip-path') || hole.style.getPropertyValue('-webkit-clip-path');
    assert.match(clip, /^path\(evenodd, "M0,0H\d+V\d+H0ZM12,/, 'an even-odd path: the page minus the player box, top corners rounded by 12');
    assert.ok(clip.indexOf('V' + (docY + 221) + 'H0V') > 0, 'the inner box reaches the element bottom: ' + clip);
    assert.strictEqual(r.el().hasAttribute('controls'), false, 'no native controls strip on a proxied video');
    assert.strictEqual(r.host().classList.contains('native-controls'), false);
    assert.strictEqual(r.el().getAttribute('poster'), null, 'no poster in the slot');
  } finally { r.close(); }
});

test('W3 (S3): coalesced to one per frame, nothing while nothing moves; a moved box is one new rect', async () => {
  const r = realm({ host: CAPS });
  try {
    await loaded(r);
    const n0 = r.surfaces().length;
    r.w.dispatchEvent(new r.w.Event('resize'));
    r.w.dispatchEvent(new r.w.Event('orientationchange'));
    r.w.dispatchEvent(new r.w.Event('resize'));
    await settle(80);
    assert.strictEqual(r.surfaces().length, n0, 'three layout events with the same box: nothing posted');
    r.setBox({ left: 0, top: 300, width: 393, height: 500 });
    r.w.dispatchEvent(new r.w.Event('resize'));
    r.setBox({ left: 0, top: 300, width: 852, height: 393 });
    r.w.dispatchEvent(new r.w.Event('resize'));
    await settle(80);
    assert.strictEqual(r.surfaces().length, n0 + 1, 'two changes in one frame: one message, the last box');
    assert.deepStrictEqual(r.last().rect, { x: 0, y: 300, w: 852, h: 393 });
    assert.strictEqual(r.last().visible, true);
  } finally { r.close(); }
});

test('W3 (S3a): docked, the picture is hidden (visible: false), the hole closes, the dock shows the thumbnail; expanded, the picture is back and the poster gone', async () => {
  const r = realm({ host: CAPS });
  try {
    await loaded(r);
    const n0 = r.surfaces().length;
    const p0 = r.fake.posts.length;
    r.player.dock();
    await settle(60);
    const docked = r.last();
    assert.strictEqual(r.surfaces().length, n0 + 1, 'one message for the dock');
    assert.strictEqual(docked.visible, false, 'no picture under the fixed mini player');
    assert.strictEqual(r.bodyOn(), false, 'the page paints normally again');
    assert.strictEqual(r.el().getAttribute('poster'), '/thumbnail/v1', 'the dock shows the video thumbnail');
    assert.deepStrictEqual(r.fake.posts.slice(p0).map((m) => m.type).filter((t) => /^audio\.(pause|stop|seek|play)$/.test(t)), [], 'the sound plays on (no transport posted by the dock)');
    r.player.expand(r.slot);
    await settle(60);
    assert.strictEqual(r.last().visible, true, 'the picture returns in the slot');
    assert.strictEqual(r.last().space, 'document');
    assert.strictEqual(r.bodyOn(), true);
    assert.strictEqual(r.el().getAttribute('poster'), null, 'the poster is gone (it would paint over the hole)');
  } finally { r.close(); }
});

test('W3 (S8): the fullscreen button takes the CSS fullscreen - a VIEWPORT rect, radius 0, the body belt transparent; the button again returns to the document rect', async () => {
  const r = realm({ host: CAPS });
  try {
    await loaded(r);
    const fs = r.host().querySelector('#fs-btn');
    assert.ok(fs, 'the bar has its fullscreen button');
    r.setBox({ left: 0, top: 0, width: 393, height: 852 });
    fs.click();
    await settle(80);
    assert.strictEqual(r.host().classList.contains('css-fullscreen'), true, 'the web\'s own fullscreen, never webkitEnterFullscreen');
    assert.strictEqual(r.w.document.body.classList.contains('ft-css-fullscreen'), true);
    assert.deepStrictEqual(r.last(), { v: 1, type: 'video.surface', rect: { x: 0, y: 0, w: 393, h: 852 }, space: 'viewport', visible: true, fit: 'contain', radius: 0 });
    assert.strictEqual(r.bodyOn(), true, 'transparent: the whole viewport is the picture box');
    assert.strictEqual(r.hole().getAttribute('style'), null, 'no clip in fullscreen (the wrapper and body paint nothing)');
    r.setBox({ left: 0, top: 300, width: 393, height: 221 });
    fs.click();
    await settle(80);
    assert.strictEqual(r.host().classList.contains('css-fullscreen'), false);
    assert.strictEqual(r.last().space, 'document');
    assert.deepStrictEqual(r.last().rect, { x: 0, y: 300, w: 393, h: 221 });
    assert.match(r.hole().style.getPropertyValue('clip-path'), /evenodd/, 'the hole is clipped around the box again');
  } finally { r.close(); }
});

test('W3 (S9): hidden and locked are native\'s business - at visibilitychange hidden and at pagehide the web posts no pause / stop, plays no sidecar, arms nothing', async () => {
  const r = realm({ host: CAPS });
  try {
    await loaded(r);
    await settle(100); // the load's settings read resolved
    assert.ok(!r.calls.some((c) => /prepare-audio/.test(c)), 'no prepare-audio for a video native plays (the sidecar is never armed)');
    const before = r.fake.posts.length;
    Object.defineProperty(r.w.document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(r.w.document, 'visibilityState', { configurable: true, value: 'hidden' });
    r.w.document.dispatchEvent(new r.w.Event('visibilitychange'));
    await settle(60);
    r.w.dispatchEvent(new r.w.PageTransitionEvent('pagehide', { persisted: false }));
    await settle(60);
    const posted = r.fake.posts.slice(before).map((m) => m.type).filter((t) => t !== 'video.surface' && t !== 'audio.unsubscribe');
    assert.deepStrictEqual(posted, [], 'nothing posted at hidden / pagehide (the subscription ends, as for a track)');
    assert.deepStrictEqual(r.plays, [], 'no web element ever played (no sidecar)');
    assert.strictEqual(r.na.active(), true, 'native still owns the video');
  } finally { r.close(); }
});

test('W3 (S3, S5): a stand-down load ends the surface - one last visible: false, the hole closed, the page painting normally', async () => {
  const r = realm({ host: CAPS });
  try {
    await loaded(r);
    r.fake.clear();
    r.player.load('s1', Object.assign({}, VIDEO, { id: 's1', projection: 'equirect' }), { slot: r.slot });
    await settle(80);
    const types = r.fake.types();
    assert.ok(types.indexOf('audio.stop') >= 0, 'native stops');
    const surf = r.surfaces();
    assert.strictEqual(surf.length, 1, 'one closing message');
    assert.strictEqual(surf[0].visible, false);
    assert.strictEqual(r.bodyOn(), false);
    assert.strictEqual(r.el().getAttribute('src'), '/video/s1');
    await settle(1100); // past the backstop interval
    assert.strictEqual(r.surfaces().length, 1, 'nothing more while native owns nothing');
  } finally { r.close(); }
});

test('W3 (S8): a WIDE app window (not the phone form factor) still takes the CSS fullscreen for a proxied video - the bar button and the f key alike; never the element or the stage', async () => {
  const r = realm({ host: CAPS, desktop: true });
  try {
    await loaded(r);
    assert.strictEqual(r.el().hasAttribute('controls'), false);
    const fs = r.host().querySelector('#fs-btn');
    r.setBox({ left: 0, top: 0, width: 1024, height: 768 });
    fs.click();
    await settle(60);
    assert.strictEqual(r.host().classList.contains('css-fullscreen'), true, 'the button: CSS fullscreen');
    assert.strictEqual(r.last().space, 'viewport');
    assert.ok(!r.w.document.fullscreenElement, 'no element fullscreen was requested (jsdom has none to give)');
    fs.click();
    await settle(60);
    assert.strictEqual(r.host().classList.contains('css-fullscreen'), false);
    r.w.document.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    await settle(60);
    assert.strictEqual(r.host().classList.contains('css-fullscreen'), true, 'the f key: CSS fullscreen too');
    assert.strictEqual(r.last().space, 'viewport');
  } finally { r.close(); }
});

test('CONTROL (S11): without nativeVideo there is no surface, no hole, no body class, and the phone\'s native controls strip as before', async () => {
  const r = realm({ host: { capabilities: ['nativeAudio', 'nativeVideoAudio'] } });
  try {
    r.stubBox();
    r.player.load('v1', VIDEO, { slot: r.slot });
    await settle(80);
    assert.deepStrictEqual(r.surfaces(), []);
    assert.strictEqual(r.hole(), null);
    assert.strictEqual(r.bodyOn(), false);
    assert.strictEqual(r.el().hasAttribute('controls'), true, 'the native strip for a mobile video, as in v1.398.0');
    r.player.dock(); await settle(40);
    r.player.expand(r.slot); await settle(40);
    assert.deepStrictEqual(r.surfaces(), [], 'placements post nothing');
    assert.strictEqual(r.hole(), null);
  } finally { r.close(); }
});
