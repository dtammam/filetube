'use strict';

// [UNIT] v1.389.0 D3 + D4 (plan 2026-10-13-phone-landscape): a video loaded while the phone is ALREADY sideways
// enters the faux fullscreen once; leaving it while sideways stays left until the next video or a real rotation.
// Rotating a playing one did this since v1.118; tapping a video while sideways did not.
//
// Driven through the REAL public/js/player.js load() inside the real watch.html shell (the route the watch view
// takes), with a matchMedia whose orientation the test flips and a settings fetch the test can hold open - a
// direct call of the entry would prove nothing about whether load() reaches it (LESSONS 2, inert feature).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const player = require('../../public/js/player.js');

function realm({ landscape = true, custom = true, play = 'ok', hold = false, feed = false, desktop = false } = {}) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'watch.html'), 'utf8'), { url: 'http://localhost/watch.html?v=v1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  const ctl = { landscape, plays: 0, play, enterFsCalls: 0, release: null, hold };
  const listeners = [];
  w.matchMedia = (q) => ({
    get matches() {
      if (/orientation:\s*landscape/.test(q)) return ctl.landscape;
      if (/orientation:\s*portrait/.test(q)) return !ctl.landscape;
      if (desktop) return /any-pointer:\s*fine|pointer:\s*fine|hover:\s*hover/.test(q); // a desktop: mouse, always landscape
      return /pointer:\s*coarse|hover:\s*none/.test(q) && !/any-pointer/.test(q); // a phone: touch, no hover, not narrow (844 wide)
    },
    media: q,
    addEventListener(t, fn) { if (/orientation:\s*landscape/.test(q) && t === 'change') listeners.push(fn); },
    removeEventListener() {}, addListener() {}, removeListener() {},
  });
  ctl.rotate = (toLandscape) => { ctl.landscape = toLandscape; listeners.slice().forEach((fn) => fn({ matches: toLandscape })); };
  Object.defineProperty(w.navigator, 'platform', { value: desktop ? 'Linux x86_64' : 'iPhone', configurable: true });
  w.scrollTo = () => {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () { Object.defineProperty(this, 'paused', { value: true, configurable: true }); this.dispatchEvent(new w.Event('pause')); };
  w.HTMLMediaElement.prototype.play = function () {
    ctl.plays += 1;
    if (ctl.play === 'refuse') return Promise.reject(new w.DOMException('refused', 'NotAllowedError'));
    Object.defineProperty(this, 'paused', { value: false, configurable: true });
    this.dispatchEvent(new w.Event('play'));
    return Promise.resolve();
  };
  w.HTMLVideoElement.prototype.webkitEnterFullscreen = function () { ctl.enterFsCalls += 1; };
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  w.clampPositionState = (s) => s;
  w.resolveAudioArtUrl = () => '/albumart/a1';
  w.formatDuration = () => '';
  // the settings fetch: the custom-player verdict (held open when `hold`, to model a cold page)
  w.fetch = (u) => {
    const url = String(u);
    const body = /\/api\/settings/.test(url) ? { mobileCustomPlayer: custom } : /\/api\/progress\//.test(url) ? { timestamp: 0 } : {};
    const res = { ok: true, status: 200, json: async () => body, text: async () => '' };
    if (ctl.hold && /\/api\/settings/.test(url)) return new Promise((resolve) => { ctl.release = () => resolve(res); });
    return Promise.resolve(res);
  };
  w.eval(fs.readFileSync(path.join(REPO, 'public', 'js', 'player.js'), 'utf8'));
  const slot = w.document.getElementById('player-slot');
  if (feed) { slot.className = 'feed-card__slot'; }
  const pl = w.FileTube.player;
  const VIDEO = (n) => ({ type: 'video', title: 'Clip ' + n, channelName: 'C', folderName: 'F', duration: 20, streamSrc: '/video/' + n, hasThumbnail: false });
  const fauxOn = () => !!w.document.getElementById('player-wrapper').classList.contains('css-fullscreen') && w.document.body.classList.contains('ft-css-fullscreen');
  return { w, ctl, pl, slot, VIDEO, fauxOn, close: () => w.close() };
}

test('D3 (the real load route): a video loaded sideways on a custom-player phone enters the faux fullscreen - body and host together', async () => {
  const r = realm();
  try {
    r.pl.load('v1', r.VIDEO('v1'), { slot: r.slot });
    await settle();
    assert.strictEqual(r.pl.getState(), 'full', 'precondition: mounted FULL in the watch slot');
    assert.strictEqual(r.fauxOn(), true, 'entered once the custom-player verdict landed');
    assert.strictEqual(r.ctl.enterFsCalls, 0, 'CSS only: no webkitEnterFullscreen from a non-gesture path');
  } finally { r.close(); }
});

test('D3 autoplay refused (iOS NotAllowedError): it still enters, paused, and the control bar is not hidden (the way to play)', async () => {
  const r = realm({ play: 'refuse' });
  try {
    r.pl.load('v1', r.VIDEO('v1'), { slot: r.slot });
    await settle(60);
    assert.ok(r.ctl.plays >= 1, 'precondition: the load tried to auto-start and was refused');
    assert.strictEqual(r.w.document.getElementById('media-player').paused, true, 'precondition: paused');
    assert.strictEqual(r.fauxOn(), true, 'entered anyway');
    const host = r.w.document.getElementById('player-wrapper');
    assert.ok(!host.classList.contains('controls-autohidden'), 'the paused bar stays up: the play button is reachable inside fullscreen');
    r.w.document.getElementById('pp-btn').click();
    assert.ok(r.ctl.plays >= 2, 'and its play button plays');
    assert.strictEqual(r.fauxOn(), true, 'still fullscreen after the tap');
  } finally { r.close(); }
});

test('D3 portrait load: not entered; D4 a later rotation to landscape while PLAYING is the rotate path, and a rotation to portrait leaves', async () => {
  const r = realm({ landscape: false });
  try {
    r.pl.load('v1', r.VIDEO('v1'), { slot: r.slot });
    await settle();
    assert.strictEqual(r.fauxOn(), false, 'portrait load: not entered');
    r.ctl.rotate(true);
    assert.strictEqual(r.fauxOn(), true, 'rotating while playing enters (the existing path, untouched)');
    r.ctl.rotate(false);
    assert.strictEqual(r.fauxOn(), false, 'rotating back leaves');
  } finally { r.close(); }
});

test('D4 exit while sideways: stays out (a late settings verdict, a play, a re-run cannot re-enter); the next video re-enters; a real rotation re-arms', async () => {
  const r = realm();
  try {
    r.pl.load('v1', r.VIDEO('v1'), { slot: r.slot });
    await settle();
    assert.strictEqual(r.fauxOn(), true, 'precondition: in fullscreen');
    r.w.document.getElementById('fs-btn').click(); // the exit button
    assert.strictEqual(r.fauxOn(), false, 'exited');
    await settle(80);
    assert.strictEqual(r.fauxOn(), false, 'and it stays out');
    r.w.document.getElementById('media-player').dispatchEvent(new r.w.Event('play'));
    r.w.document.getElementById('pp-btn').click();
    await settle(40);
    assert.strictEqual(r.fauxOn(), false, 'playing again does not re-enter');
    r.pl.load('v2', r.VIDEO('v2'), { slot: r.slot });
    await settle();
    assert.strictEqual(r.fauxOn(), true, 'the NEXT video re-enters');
    r.w.document.getElementById('fs-btn').click();
    assert.strictEqual(r.fauxOn(), false, 'exited again');
    r.ctl.rotate(false); r.ctl.rotate(true); // a real rotation back to sideways, playing
    assert.strictEqual(r.fauxOn(), true, 'a rotation re-arms the fullscreen');
  } finally { r.close(); }
});

test('D3 a cold page: the custom-player verdict arrives AFTER load - it waits for it, then enters (and never on a native-controls verdict)', async () => {
  const r = realm({ hold: true });
  try {
    r.pl.load('v1', r.VIDEO('v1'), { slot: r.slot });
    await settle(40);
    assert.strictEqual(r.fauxOn(), false, 'before the verdict: not entered (native controls until the setting is known)');
    assert.ok(r.ctl.release, 'precondition: the settings fetch is pending');
    r.ctl.release();
    await settle(60);
    assert.strictEqual(r.fauxOn(), true, 'the verdict lands: entered');
  } finally { r.close(); }
  const n = realm({ hold: true, custom: false });
  try {
    n.pl.load('v1', n.VIDEO('v1'), { slot: n.slot });
    await settle(40);
    n.ctl.release();
    await settle(60);
    assert.strictEqual(n.fauxOn(), false, 'native-controls mode keeps today\'s behaviour');
    assert.strictEqual(n.ctl.enterFsCalls, 0, 'and no webkitEnterFullscreen from a non-gesture path');
    assert.ok(n.w.document.getElementById('player-wrapper').classList.contains('native-controls'), 'precondition: it really is native mode');
  } finally { n.close(); }
});

test('D3 a warm page (the verdict is already known): it enters AT load, not when the next settings fetch lands - and that late fetch cannot pull an exit back in', async () => {
  const r = realm();
  try {
    r.pl.load('v1', r.VIDEO('v1'), { slot: r.slot });
    await settle();
    assert.strictEqual(r.fauxOn(), true, 'precondition: v1 entered, the verdict is cached');
    r.w.document.getElementById('fs-btn').click();
    assert.strictEqual(r.fauxOn(), false, 'precondition: exited');
    r.ctl.hold = true; // every load re-reads the setting; keep the NEXT read open
    r.ctl.release = null;
    r.pl.load('v2', r.VIDEO('v2'), { slot: r.slot });
    assert.ok(r.ctl.release, 'precondition: the second load\'s settings fetch is pending');
    assert.strictEqual(r.fauxOn(), true, 'entered in the load itself, with the settings read still in flight');
    r.w.document.getElementById('fs-btn').click(); // the user leaves inside that window
    assert.strictEqual(r.fauxOn(), false, 'exited');
    r.ctl.release();
    await settle(60);
    assert.strictEqual(r.fauxOn(), false, 'the late settings answer does not re-enter (the one shot was spent at load)');
  } finally { r.close(); }
});

test('D3 a TV-style source (statusUrl, no prepareAudioUrl) resolves the verdict on its own fetch path - it enters from there too', async () => {
  const r = realm({ hold: true });
  try {
    r.pl.load('v1', { ...r.VIDEO('v1'), statusUrl: '/api/tv/episode/e1/status' }, { slot: r.slot });
    await settle(40);
    assert.strictEqual(r.fauxOn(), false, 'before the verdict');
    assert.ok(r.ctl.release, 'precondition: the TV branch\'s settings read is pending');
    r.ctl.release();
    await settle(60);
    assert.strictEqual(r.fauxOn(), true, 'entered when that read landed');
  } finally { r.close(); }
});

test('D3 a DESKTOP window (fine pointer, landscape, custom setting on) never auto-enters fullscreen on load', async () => {
  const r = realm({ desktop: true });
  try {
    r.pl.load('v1', r.VIDEO('v1'), { slot: r.slot });
    await settle(60);
    assert.strictEqual(r.pl.getState(), 'full', 'precondition: mounted FULL');
    assert.strictEqual(r.fauxOn(), false, 'the mobile guard keeps a desktop window out');
  } finally { r.close(); }
});

test('D3 exclusions: a Feed card\'s slot, a docked mount, an audio item - none enters', async () => {
  const f = realm({ feed: true });
  try {
    f.pl.load('v1', f.VIDEO('v1'), { slot: f.slot });
    await settle();
    assert.strictEqual(f.pl.getState(), 'full', 'precondition: FULL, hosted in the card slot');
    assert.ok(f.w.document.getElementById('player-wrapper').parentElement.classList.contains('feed-card__slot'), 'precondition: the host sits in a feed-card__slot');
    assert.strictEqual(f.fauxOn(), false, 'a Feed card stays a card');
  } finally { f.close(); }
  const d = realm();
  try {
    d.pl.load('v1', d.VIDEO('v1'), { dock: true });
    await settle();
    assert.notStrictEqual(d.pl.getState(), 'full', 'precondition: docked');
    assert.strictEqual(d.fauxOn(), false, 'a docked mount never goes fullscreen');
  } finally { d.close(); }
  const a = realm();
  try {
    a.pl.load('a1', { type: 'audio', title: 'Song', channelName: 'C', folderName: 'F', duration: 20, streamSrc: '/track/a1' }, { slot: a.slot });
    await settle();
    assert.strictEqual(a.fauxOn(), false, 'audio is not a picture');
  } finally { a.close(); }
});

test('D3 the pure decision table: every conjunct has its own divergent row', () => {
  const base = { pending: true, full: true, video: true, mobile: true, landscape: true, custom: true, fauxOn: false, feedHost: false };
  assert.strictEqual(player.sidewaysFullscreenDecision(base), 'enter');
  for (const k of ['pending', 'full', 'video', 'mobile', 'landscape']) assert.strictEqual(player.sidewaysFullscreenDecision({ ...base, [k]: false }), 'skip', k + ' false: spent');
  assert.strictEqual(player.sidewaysFullscreenDecision({ ...base, fauxOn: true }), 'skip', 'already faux (a carried auto-advance): nothing to do');
  assert.strictEqual(player.sidewaysFullscreenDecision({ ...base, feedHost: true }), 'skip', 'a Feed card');
  assert.strictEqual(player.sidewaysFullscreenDecision({ ...base, custom: false }), 'wait', 'native/unknown verdict: wait for the setting');
  assert.strictEqual(player.sidewaysFullscreenDecision({ ...base, custom: false, landscape: false }), 'skip', 'portrait is spent even before the verdict');
  assert.strictEqual(player.sidewaysFullscreenDecision(), 'skip', 'garbage in: skip');
});
