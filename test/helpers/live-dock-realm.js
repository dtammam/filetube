'use strict';

// v1.401.0 live dock picture (plan docs/exec-plans/active/2026-11-01-live-dock-picture.md): the jsdom realm the live-dock tests share -
// the REAL player.js + native-audio.js + host-adapter.js in a phone-shaped window with a fake host, the box derived from where the
// wrapper IS (the slot, or the dock once reparented) and from its own inline transform (the pull, the FLIP fly-in; a settle keeps the
// transition's start pose), never a pre-moved rect (LESSONS 2, 11).

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { installFakeHost } = require('./fake-host');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, 'public', 'js', f), 'utf8');
const SCRIPTS = ['host-adapter.js', 'native-audio.js', 'player.js'];
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const VIDEO_CAPS = { capabilities: ['nativeAudio', 'nativeVideoAudio', 'nativeVideo'] };
const DOCK_CAPS = { capabilities: ['nativeAudio', 'nativeVideoAudio', 'nativeVideo', 'nativeVideoDock'] };
const VIDEO = { id: 'v1', type: 'video', title: 'A talk', channelName: 'Ch', folderName: 'Ch', duration: 600, hasThumbnail: true, width: 1920, height: 1080, browseCtx: null, readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false, progressEndpoint: null, startAt: null };
const MODES = { autoplay: true, shuffle: false, loop: 'off' };
const ITEM = { kind: 'video', id: 'v1', src: '/api/offline/file/video/v1', title: 'A talk', artist: 'Ch', artworkSrc: '/thumbnail/v1', durationSec: 600, progress: { route: '/api/progress', key: 'v1' } };
const STATE = (rev, extra) => Object.assign({ v: 1, type: 'audioState', rev, queue: [ITEM], index: 0, state: 'playing', positionSec: 12, durationSec: 600, rate: 1, modes: MODES, sleep: { mode: 'off' } }, extra || {});
const SLOT_BOX = { left: 0, top: 300, width: 393, height: 221 };
const DOCK_BOX = { left: 225, top: 640, width: 160, height: 90 }; // the mini player's picture (160 x 9/16) over its 44px bar

function realm(opts) {
  opts = opts || {};
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'music.html'), 'utf8'), { url: 'http://localhost/watch.html?v=v1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: (/max-width:\s*768px|pointer:\s*coarse|hover:\s*none/.test(q) && !/any-pointer/.test(q)) || (!!opts.reduced && /prefers-reduced-motion/.test(q)), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.resolveAudioArtUrl = () => '/albumart/t1';
  w.formatDuration = () => '';
  w.clampPositionState = (s) => s;
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  w.fetch = (u) => {
    const url = String(u); let body = {};
    if (url === '/api/settings') body = { backgroundAudioForVideo: true };
    else if (/\/prepare-audio$/.test(url)) body = { audioStatus: 'ready' };
    else if (url.indexOf('/api/queue') === 0) body = { entries: [], pointerUid: null };
    else if (/^\/api\/progress\//.test(url)) body = { timestamp: 0 };
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  const fake = installFakeHost(w, opts.caps || DOCK_CAPS);
  // the player box's rounded corner in the slot (12) and the DOCK's own corner (7; the wrapper has none inside the dock): plain rules
  // jsdom's cascade applies (it resolves no tokens)
  const style = w.document.createElement('style'); style.textContent = '#player-wrapper { border-top-left-radius: 12px; } #player-dock #player-wrapper { border-top-left-radius: 0; } #player-dock { border-top-left-radius: 7px; }'; w.document.head.appendChild(style);
  for (const f of SCRIPTS) w.eval(read(f));
  w.document.body.setAttribute('data-view', 'watch');
  const reads = { n: 0 };
  // the box the browser would lay out: the slot box, or the dock's picture box once the wrapper is inside #player-dock, moved by the
  // wrapper's own inline transform (transform-origin 0 0: the pull, the FLIP fly-in)
  const boxNow = () => {
    const wr = w.document.getElementById('player-wrapper');
    const base = wr && wr.closest('#player-dock') ? DOCK_BOX : SLOT_BOX;
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec((wr && wr.style.transform) || '');
    const tx = m ? +m[1] : 0, ty = m ? +m[2] : 0, s = m ? +m[3] : 1;
    const l = base.left + tx, t = base.top + ty, ww = base.width * s, hh = base.height * s;
    return { left: l, top: t, width: ww, height: hh, right: l + ww, bottom: t + hh, x: l, y: t };
  };
  // a CSS transition's first frame: playMinimizeSettle sets the inverse (FLIP) transform, flushes layout and clears it so the
  // transition runs to identity - a browser's getBoundingClientRect then answers the START pose until the transition moves; jsdom
  // runs no transitions, so the fixture remembers the last pose written while the settle class holds the wrapper
  let pose = '';
  const styleProto = Object.getPrototypeOf(w.document.createElement('div').style);
  const tdesc = Object.getOwnPropertyDescriptor(styleProto, 'transform');
  Object.defineProperty(styleProto, 'transform', { configurable: true, get: tdesc.get, set(v) { if (v) pose = v; tdesc.set.call(this, v); } });
  const boxNowT = boxNow;
  const boxNow2 = () => { const wr = w.document.getElementById('player-wrapper'); if (wr && !wr.style.transform && wr.classList.contains('is-minimize-settle') && pose) { tdesc.set.call(wr.style, pose); const b = boxNowT(); tdesc.set.call(wr.style, ''); return b; } return boxNowT(); };
  w.HTMLVideoElement.prototype.getBoundingClientRect = () => { reads.n += 1; return boxNow2(); };
  // the wrapper's own box (playMinimizeSettle reads `from` and `to` from it): the same geometry
  // the dock's own box (never transformed: the picture box over its 44px bar); the wrapper's; nothing else has a box here
  const DOCK_REST = () => ({ left: DOCK_BOX.left, top: DOCK_BOX.top, width: DOCK_BOX.width, height: DOCK_BOX.height + 44, right: DOCK_BOX.left + DOCK_BOX.width, bottom: DOCK_BOX.top + DOCK_BOX.height + 44, x: DOCK_BOX.left, y: DOCK_BOX.top });
  w.HTMLDivElement.prototype.getBoundingClientRect = function () { return this.id === 'player-wrapper' ? boxNowT() : (this.id === 'player-dock' ? DOCK_REST() : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }); };
  return {
    w, fake, reads, player: w.FileTube.player, na: w.FileTube.nativeAudio, slot: w.document.getElementById('player-slot'),
    el: () => w.document.getElementById('media-player'),
    wrapper: () => w.document.getElementById('player-wrapper'),
    hole: () => w.document.getElementById('ft-video-hole'),
    clip: () => { const h = w.document.getElementById('ft-video-hole'); return h ? (h.style.getPropertyValue('clip-path') || '') : ''; },
    bodyOn: () => w.document.body.classList.contains('ft-native-video'),
    surfaces: () => fake.of('video.surface'),
    last: () => { const s = fake.of('video.surface'); return s[s.length - 1]; },
    poster: () => w.document.getElementById('media-player').getAttribute('poster'),
    close: () => w.close(),
  };
}
async function loaded(r) {
  r.player.load('v1', VIDEO, { slot: r.slot });
  await settle(80);
  const loads = r.fake.of('audio.load');
  assert.strictEqual(loads.length, 1, 'the claim');
  r.fake.emit(STATE(loads[0].rev));
  await settle(60);
}
const strip = (m) => { const o = Object.assign({}, m); delete o.v; delete o.type; return o; };

module.exports = { realm, loaded, strip, settle, VIDEO, VIDEO_CAPS, DOCK_CAPS, STATE, ITEM, SLOT_BOX, DOCK_BOX, MODES };
