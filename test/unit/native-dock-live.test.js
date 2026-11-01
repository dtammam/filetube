'use strict';

// [UNIT] v1.401.0 live dock picture, W2 (plan docs/exec-plans/completed/2026-11-01-live-dock-picture.md, R1 + R2 + R5): under a host that
// announces `nativeVideoDock` the DOCKED picture is native's layer ABOVE the web view: the web posts the dock's picture rect in viewport
// space with `layer: 'above'`, and every layer switch keeps the picture covered by a hole or above the page, never neither. The REAL
// player.js + native-audio.js run in a phone jsdom realm; the box is moved ONLY through the real dock() / expand() / minimizeToDock
// path (the wrapper's container and its class + style.transform), and getBoundingClientRect is derived from where the wrapper IS
// (LESSONS 2, 11: never a pre-moved rect). The CONTROL realm (no nativeVideoDock) must produce v1.400.1's posts byte for byte.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const { realm, loaded, strip, settle, VIDEO, VIDEO_CAPS, DOCK_CAPS, STATE, DOCK_BOX } = require('../helpers/live-dock-realm');

test('R1: dock() under nativeVideoDock posts the dock\'s PICTURE rect in viewport space, visible, layer above, the dock\'s own radius; the poster waits under the layer; the hole closes two frames later', async () => {
  const r = realm();
  try {
    await loaded(r);
    assert.deepStrictEqual(strip(r.last()), { rect: { x: 0, y: 300, w: 393, h: 221 }, space: 'document', visible: true, fit: 'contain', radius: 12, layer: 'below' }, 'in the slot: explicit below under the capability');
    const n0 = r.surfaces().length;
    try { Object.defineProperty(r.w, 'scrollY', { configurable: true, get: () => 100 }); Object.defineProperty(r.w, 'scrollX', { configurable: true, get: () => 0 }); } catch (_) { /* jsdom may refuse */ }
    const scrolled = r.w.scrollY === 100; // the page under the fixed dock is scrolled: the hole layer scrolls with the document, the dock does not
    r.player.dock();
    assert.strictEqual(r.surfaces().length, n0 + 1, 'the dock sync posts at once');
    assert.deepStrictEqual(strip(r.last()), { rect: { x: 225, y: 640, w: 160, h: 90 }, space: 'viewport', visible: true, fit: 'contain', radius: 7, layer: 'above' });
    assert.strictEqual(r.poster(), '/thumbnail/v1', 'the thumbnail sits under the above layer, ready for a covered dock (R4)');
    assert.strictEqual(r.bodyOn(), true, 'the hole is still open on the frame of the post');
    assert.ok(new RegExp('M232,' + (scrolled ? 740 : 640) + 'H').test(r.clip()), 'the hole follows the docked box in DOCUMENT space (the viewport rect + the scroll, radius 7): ' + r.clip());
    assert.strictEqual(r.last().rect.y, 640, 'while the posted rect stays in viewport space');
    await settle(80);
    assert.strictEqual(r.bodyOn(), false, 'two frames later the hole is closed and the body paints again');
    assert.strictEqual(r.surfaces().length, n0 + 1, 'no second post');
  } finally { r.close(); }
});

test('CONTROL (R1, R5): without nativeVideoDock the same dock() is v1.400.1 byte for byte - visible false, no layer key, the thumbnail poster at once, the hole closed at once', async () => {
  const r = realm({ caps: VIDEO_CAPS });
  try {
    await loaded(r);
    assert.deepStrictEqual(strip(r.last()), { rect: { x: 0, y: 300, w: 393, h: 221 }, space: 'document', visible: true, fit: 'contain', radius: 12 });
    const n0 = r.surfaces().length;
    r.player.dock();
    assert.deepStrictEqual(strip(r.last()), { rect: { x: 225, y: 640, w: 160, h: 90 }, space: 'document', visible: false, fit: 'contain', radius: 0 });
    assert.strictEqual(r.poster(), '/thumbnail/v1');
    assert.strictEqual(r.bodyOn(), false, 'closed on the same sync');
    assert.ok(r.surfaces().every((m) => !('layer' in m)), 'no layer key on any post without the capability');
    r.player.expand(r.slot);
    assert.strictEqual(r.surfaces().length, n0 + 2, 'expand posts at once (no deferred frame without a layer switch)');
    assert.deepStrictEqual(strip(r.last()), { rect: { x: 0, y: 300, w: 393, h: 221 }, space: 'document', visible: true, fit: 'contain', radius: 12 });
    assert.strictEqual(r.poster(), null);
    // the chevron commit: main posts the dock's REST rect (visible false) on the commit tick, then the fly-in's poses (gate r1 adversary W3)
    await settle(40);
    const n1 = r.surfaces().length;
    r.wrapper().querySelector('.player-minimize').click();
    assert.strictEqual(r.player.getState(), 'docked');
    assert.strictEqual(r.surfaces().length, n1 + 1, 'one post on the commit tick, as on main');
    assert.deepStrictEqual(strip(r.last()), { rect: { x: 225, y: 640, w: 160, h: 90 }, space: 'document', visible: false, fit: 'contain', radius: 0 }, 'the rest rect, hidden, no layer: byte for byte v1.400.1');
    assert.strictEqual(r.poster(), '/thumbnail/v1', 'the thumbnail from the fly-in\'s first frame (v1.400.1 R4b)');
    await settle(40);
    assert.ok(r.surfaces().length > n1 + 1 && r.surfaces().every((m) => !('layer' in m)), 'the fly-in follows, still without a layer key');
    assert.strictEqual(r.w.document.documentElement.classList.contains('ft-native-dock'), false);
  } finally { r.close(); }
});

test('R2 (above -> below): expand from the dock opens the hole FIRST (the poster off, the body transparent, the clip at the slot box) and posts layer below on the NEXT frame', async () => {
  const r = realm();
  try {
    await loaded(r);
    r.player.dock(); await settle(80);
    assert.strictEqual(r.bodyOn(), false, 'docked at rest: no hole');
    const n0 = r.surfaces().length;
    r.player.expand(r.slot);
    assert.strictEqual(r.surfaces().length, n0, 'nothing posted on the expand frame');
    assert.strictEqual(r.bodyOn(), true, 'the hole opened on the expand frame');
    assert.ok(/M12,300H/.test(r.clip()) && r.clip().includes('V521H'), 'at the slot box (document space, radius 12): ' + r.clip());
    assert.strictEqual(r.poster(), null, 'the poster left before the hole opened (it would paint over it)');
    await settle(40);
    assert.strictEqual(r.surfaces().length, n0 + 1, 'the below post went out on the next frame');
    assert.deepStrictEqual(strip(r.last()), { rect: { x: 0, y: 300, w: 393, h: 221 }, space: 'document', visible: true, fit: 'contain', radius: 12, layer: 'below' });
    await settle(300);
    assert.strictEqual(r.surfaces().length, n0 + 1, 'and nothing more');
    // a second round: dock, expand again - the ordering holds every time (gate r1 adversary W4: belowPending is reset)
    r.player.dock(); await settle(80);
    assert.strictEqual(r.bodyOn(), false);
    const n2 = r.surfaces().length;
    r.player.expand(r.slot);
    assert.strictEqual(r.surfaces().length, n2, 'second expand: nothing posted on the tick');
    assert.strictEqual(r.bodyOn(), true, 'second expand: the hole opened first');
    await settle(40);
    assert.strictEqual(r.surfaces().length, n2 + 1); assert.strictEqual(r.last().layer, 'below');
  } finally { r.close(); }
});

test('R3 + R2 (gate r1 adversary C2): the dock\'s layout class is on BEFORE the first docked post and before the fly-in pose reads the dock\'s box (the caption strip is part of both)', async () => {
  const r = realm();
  try {
    await loaded(r);
    const classAt = []; const origPost = r.fake.host.post;
    r.fake.host.post = function (msg) { if (msg.type === 'video.surface') classAt.push(r.w.document.documentElement.classList.contains('ft-native-dock')); return origPost.call(this, msg); };
    const wrapperReads = []; const proto = r.w.HTMLDivElement.prototype; const orig = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function () { if (this.id === 'player-wrapper' && this.closest('#player-dock')) wrapperReads.push(r.w.document.documentElement.classList.contains('ft-native-dock')); return orig.call(this); };
    r.player.dock();
    assert.deepStrictEqual(classAt, [true], 'dock(): the one post saw the class on');
    r.player.expand(r.slot); await settle(60);
    classAt.length = 0; wrapperReads.length = 0;
    r.wrapper().querySelector('.player-minimize').click(); // minimizeToDock: dock() marks, playMinimizeSettle reads `to` in the dock, then the one sync
    assert.strictEqual(r.player.getState(), 'docked');
    assert.ok(wrapperReads.length >= 1 && wrapperReads.every((c) => c === true), 'every read of the wrapper box inside the dock saw the class: ' + JSON.stringify(wrapperReads));
    assert.deepStrictEqual(classAt, [true], 'the fly-in\'s first post saw the class on');
    proto.getBoundingClientRect = orig;
  } finally { r.close(); }
});

test('R2 (the fly-in): minimizeToDock posts layer above with the FLIP pose on its first frame (not the rest rect), follows the settle per frame with the hole open and no poster, and at rest the poster is set and the hole closes', async () => {
  const r = realm();
  try {
    await loaded(r);
    const n0 = r.surfaces().length;
    const chev = r.wrapper().querySelector('.player-minimize');
    assert.ok(chev, 'the chevron exists');
    chev.click(); // minimizeToDock('button'): dock() then playMinimizeSettle(from) then the one sync
    assert.strictEqual(r.player.getState(), 'docked');
    assert.strictEqual(r.surfaces().length, n0 + 1, 'exactly one post on the commit tick (dock()\'s own sync waited for the fly-in pose)');
    const first = r.last();
    assert.strictEqual(first.layer, 'above'); assert.strictEqual(first.space, 'viewport'); assert.strictEqual(first.visible, true);
    assert.deepStrictEqual(Object.assign({}, first.rect, { h: Math.round(first.rect.h) }), { x: 0, y: 300, w: 393, h: 221 }, 'the FLIP start: the picture where it was in the slot (the dock box scaled up by 393/160: 221.06), not the dock rect');
    assert.ok(r.wrapper().classList.contains('is-minimize-settle'), 'the settle runs');
    assert.strictEqual(r.poster(), null, 'the live picture flies: no poster during the settle');
    assert.strictEqual(r.bodyOn(), true, 'the hole is open under the above layer');
    // a frame of the transition: the box moved (a CSS transition changes the computed box with no DOM write)
    r.wrapper().style.transform = 'translate(-100px, 200px) scale(0.6)'; await settle(40);
    assert.deepStrictEqual(r.last().rect, { x: 125, y: 840, w: 96, h: 54 }, 'followed within a frame, still above');
    assert.strictEqual(r.last().layer, 'above');
    assert.strictEqual(r.bodyOn(), true);
    await settle(400); // transitionMs is 0 in jsdom: clearMinimizeDrag ran ~50 ms after the commit
    assert.strictEqual(r.wrapper().classList.contains('is-minimize-settle'), false, 'the settle ended');
    assert.deepStrictEqual(strip(r.last()), { rect: { x: 225, y: 640, w: 160, h: 90 }, space: 'viewport', visible: true, fit: 'contain', radius: 7, layer: 'above' }, 'the final exact measure: the dock rect');
    assert.strictEqual(r.poster(), '/thumbnail/v1', 'at rest the poster sits under the layer');
    assert.strictEqual(r.bodyOn(), false, 'the hole closed after the settle');
    assert.strictEqual(r.wrapper().style.getPropertyValue('clip-path'), '');
    const n1 = r.surfaces().length; r.reads.n = 0;
    await settle(1000);
    assert.strictEqual(r.surfaces().length, n1, 'idle docked above: no posts');
    assert.ok(r.reads.n <= 2, 'idle docked above: at most the backstop\'s reads: ' + r.reads.n);
  } finally { r.close(); }
});

test('R2 (reduced motion, no settle): dock() posts above at once and the hole stays open for two frames, then closes', async () => {
  const r = realm({ reduced: true });
  try {
    await loaded(r);
    r.wrapper().querySelector('.player-minimize').click();
    assert.strictEqual(r.player.getState(), 'docked');
    assert.strictEqual(r.last().layer, 'above');
    assert.deepStrictEqual(r.last().rect, { x: 225, y: 640, w: 160, h: 90 }, 'no FLIP: the rest rect');
    assert.strictEqual(r.bodyOn(), true, 'frame 0: open');
    const frame = () => new Promise((res) => r.w.requestAnimationFrame(() => res()));
    await frame(); assert.strictEqual(r.bodyOn(), true, 'frame 1: still open');
    await frame(); assert.strictEqual(r.bodyOn(), true, 'frame 2: still open (two FRAMES after the post; the commit tick\'s explicit syncs are not frames)');
    await frame(); assert.strictEqual(r.bodyOn(), false, 'frame 3: closed');
    await settle(80);
    assert.strictEqual(r.bodyOn(), false, 'closed after the hold');
  } finally { r.close(); }
});

test('R5: rotation while docked above re-measures the viewport rect (one post, still above); close() from the dock posts one hidden above layer, closes the hole and never posts again', async () => {
  const r = realm();
  try {
    await loaded(r);
    r.player.dock(); await settle(80);
    const n0 = r.surfaces().length;
    DOCK_BOX.left = 600; DOCK_BOX.top = 240; // the dock moved with the rotated viewport
    r.w.dispatchEvent(new r.w.Event('orientationchange')); r.w.dispatchEvent(new r.w.Event('resize'));
    await settle(60);
    DOCK_BOX.left = 225; DOCK_BOX.top = 640;
    assert.strictEqual(r.surfaces().length, n0 + 1);
    assert.deepStrictEqual(strip(r.last()), { rect: { x: 600, y: 240, w: 160, h: 90 }, space: 'viewport', visible: true, fit: 'contain', radius: 7, layer: 'above' });
    r.player.close();
    assert.deepStrictEqual(strip(r.last()), { rect: { x: 600, y: 240, w: 160, h: 90 }, space: 'viewport', visible: false, fit: 'contain', radius: 7, layer: 'above' }, 'the closing message hides the layer where it was');
    assert.strictEqual(r.bodyOn(), false);
    assert.strictEqual(r.fake.of('audio.stop').length, 1);
    const n1 = r.surfaces().length;
    await settle(300);
    assert.strictEqual(r.surfaces().length, n1);
  } finally { r.close(); }
});

test('R5: a music track taking the dock after a live docked video closes the picture (one hidden post, poster gone) and the track never carries a layer', async () => {
  const r = realm();
  try {
    await loaded(r);
    r.player.dock(); await settle(80);
    const n0 = r.surfaces().length;
    const TRACK = { id: 't1', type: 'audio', title: 'Song', channelName: 'Band', album: 'LP', duration: 200, artUrl: '/albumart/t1', resumeMode: 'music', readerHref: '/music?nowplaying=1', progressEndpoint: '/api/music/progress', nativeQueue: () => ({ items: [{ id: 't1', type: 'audio', title: 'Song', channelName: 'Band', album: 'LP', duration: 200, artUrl: '/albumart/t1', resumeMode: 'music', progressEndpoint: '/api/music/progress' }], index: 0 }) };
    r.player.load('t1', TRACK, { slot: r.slot });
    await settle(80);
    assert.strictEqual(r.fake.of('audio.load').length, 2, 'the track claimed');
    assert.strictEqual(r.surfaces().length, n0 + 1, 'exactly the closing message');
    assert.strictEqual(r.last().visible, false); assert.strictEqual(r.last().layer, 'above');
    assert.strictEqual(r.na.surfaceOwned(), false);
    assert.notStrictEqual(r.el().getAttribute('poster'), '/thumbnail/v1', 'the video\'s thumbnail left with it (the track paints its own album art)');
    r.reads.n = 0; await settle(400);
    assert.strictEqual(r.surfaces().length, n0 + 1, 'a track posts no surface');
    assert.strictEqual(r.reads.n, 0, 'a track never measures the box');
  } finally { r.close(); }
});

test('the capability is readable by the player (dockLive) and false without it', () => {
  const r1 = realm(); const r2 = realm({ caps: VIDEO_CAPS });
  try {
    assert.strictEqual(r1.na.dockLive(), true);
    assert.strictEqual(r2.na.dockLive(), false);
  } finally { r1.close(); r2.close(); }
});

// ---- W3 (R3, L2 + L3): the dock's look with a live picture ------------------------------------------------------------------------

const htmlOn = (r) => r.w.document.documentElement.classList.contains('ft-native-dock');

test('R3: html.ft-native-dock is on exactly while the dock holds a live surface video - off in the slot, on from dock() (and from the fly-in\'s first frame), off on the expand tick, off on close(); never without the capability', async () => {
  const r = realm();
  try {
    await loaded(r);
    assert.strictEqual(htmlOn(r), false, 'in the slot: off');
    r.player.dock();
    assert.strictEqual(htmlOn(r), true, 'docked: on in the same tick');
    await settle(80);
    assert.strictEqual(htmlOn(r), true, 'and it stays');
    r.player.expand(r.slot);
    assert.strictEqual(htmlOn(r), false, 'expand: off on the tick the hole opens (before the below post)');
    await settle(60);
    r.wrapper().querySelector('.player-minimize').click();
    assert.strictEqual(r.player.getState(), 'docked');
    assert.strictEqual(htmlOn(r), true, 'the fly-in\'s first frame carries the bar layout already');
    await settle(400);
    assert.strictEqual(htmlOn(r), true);
    r.player.close();
    assert.strictEqual(htmlOn(r), false, 'close: off');
  } finally { r.close(); }
});

test('R3 CONTROL: without nativeVideoDock the class never appears across dock / expand / close; a music track in the dock never carries it', async () => {
  const r = realm({ caps: VIDEO_CAPS });
  try {
    await loaded(r);
    r.player.dock(); await settle(40);
    assert.strictEqual(htmlOn(r), false);
    r.player.expand(r.slot); await settle(40);
    r.player.dock(); await settle(40);
    assert.strictEqual(htmlOn(r), false);
    r.player.close();
    assert.strictEqual(htmlOn(r), false);
  } finally { r.close(); }
  const r2 = realm();
  try {
    await loaded(r2);
    r2.player.dock(); await settle(40);
    assert.strictEqual(htmlOn(r2), true);
    const TRACK = { id: 't1', type: 'audio', title: 'Song', channelName: 'Band', album: 'LP', duration: 200, artUrl: '/albumart/t1', resumeMode: 'music', readerHref: '/music?nowplaying=1', progressEndpoint: '/api/music/progress', nativeQueue: () => ({ items: [{ id: 't1', type: 'audio', title: 'Song', channelName: 'Band', album: 'LP', duration: 200, artUrl: '/albumart/t1', resumeMode: 'music', progressEndpoint: '/api/music/progress' }], index: 0 }) };
    r2.player.load('t1', TRACK, { slot: r2.slot }); await settle(80);
    assert.strictEqual(htmlOn(r2), false, 'a track (no picture) drops the live-dock layout at its load');
    r2.player.dock(); await settle(40);
    assert.strictEqual(r2.player.getState(), 'docked', 'the track plays in the dock');
    assert.strictEqual(htmlOn(r2), false, 'and the dock with a track never carries it');
  } finally { r2.close(); }
});

function withCaptions(r) {
  // jsdom has no TextTrack: the CC button reads textTracks[0] and flips its mode
  const fakeTrack = { mode: 'disabled', activeCues: null, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(r.w.HTMLMediaElement.prototype, 'textTracks', { configurable: true, get() { return [fakeTrack]; } });
  return { ccBtn: () => r.wrapper().querySelector('#cc-btn'), ccOn: () => r.wrapper().classList.contains('is-cc-on') };
}
const VIDEO_CC = Object.assign({}, VIDEO, { hasSubtitles: true });

test('R3 (L3): the ONE captions writer marks the host is-cc-on while captions are on - the CC button toggles it, close() and a new load clear it', async () => {
  const r = realm();
  try {
    const c = withCaptions(r);
    r.player.load('v1', VIDEO_CC, { slot: r.slot }); await settle(80);
    r.fake.emit(STATE(r.fake.of('audio.load')[0].rev)); await settle(60);
    assert.strictEqual(c.ccOn(), false, 'captions start off');
    c.ccBtn().click();
    assert.strictEqual(c.ccOn(), true, 'CC on: the mark is on');
    assert.strictEqual(c.ccBtn().getAttribute('aria-pressed'), 'true');
    c.ccBtn().click();
    assert.strictEqual(c.ccOn(), false, 'CC off: gone');
    c.ccBtn().click(); assert.strictEqual(c.ccOn(), true);
    r.player.load('v2', Object.assign({}, VIDEO_CC, { id: 'v2' }), { slot: r.slot }); await settle(80);
    assert.strictEqual(c.ccOn(), false, 'a new load resets captions, mark included');
    c.ccBtn().click(); assert.strictEqual(c.ccOn(), true);
    const hostEl = r.wrapper(); // close() detaches the host: read the mark on the element itself
    r.player.close();
    assert.strictEqual(hostEl.classList.contains('is-cc-on'), false, 'close clears it');
  } finally { r.close(); }
});

// the dock's CSS, as the phone sees it (jsdom has no stylesheet: inline styles + the custom properties player.js reads)
function dockGeometry(r) {
  const d = r.w.document.getElementById('player-dock');
  d.style.right = '8px'; d.style.bottom = '80px'; d.style.width = '160px'; d.style.setProperty('--size-touch', '44px'); d.style.setProperty('--ft-dock-cc-h', '32px');
  Object.defineProperty(r.w, 'innerHeight', { value: 664, configurable: true }); Object.defineProperty(r.w, 'innerWidth', { value: 390, configurable: true });
}
function touch(w, el, type, x, y, stamp) {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  const list = [{ clientX: x, clientY: y }];
  Object.defineProperty(e, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : list });
  Object.defineProperty(e, 'changedTouches', { value: list });
  Object.defineProperty(e, 'timeStamp', { value: stamp });
  el.dispatchEvent(e); return e;
}
// a slow pull (never a flick) from the picture's top band down by dy, 10 px per 40 ms
function pull(r, dy) { let t = 1000; touch(r.w, r.el(), 'touchstart', 200, 320, t); for (let d = 10; d <= dy; d += 10) { t += 40; touch(r.w, r.el(), 'touchmove', 200, 320 + d, t); } return t; }
const scaleOf = (tr) => { const m = /scale\(([-\d.]+)\)/.exec(tr || ''); return m ? +m[1] : null; };
const playerMod = require('../../public/js/player.js');

test('R3: the pull aims at the dock WITH the caption strip while captions are on under nativeVideoDock (dockRestingRect reads --ft-dock-cc-h); without captions, or without the capability, at the bare dock', async () => {
  const from = { x: 0, y: 300, w: 393 };
  const expectS = (stripH) => playerMod.minimizeDragTransform({ from, to: { x: 390 - 8 - 160, y: 664 - 80 - (160 * 9 / 16 + 44 + stripH), w: 160 }, dy: 100 }).s;
  assert.notStrictEqual(expectS(32).toFixed(4), expectS(0).toFixed(4), 'the two targets tell apart at dy 100');
  for (const [label, caps, cc, stripH] of [['dock cap + captions on', DOCK_CAPS, true, 32], ['dock cap, captions off', DOCK_CAPS, false, 0], ['no dock cap, captions on', VIDEO_CAPS, true, 0]]) {
    const r = realm({ caps });
    try {
      const c = withCaptions(r);
      dockGeometry(r);
      r.player.load('v1', VIDEO_CC, { slot: r.slot }); await settle(80);
      r.fake.emit(STATE(r.fake.of('audio.load')[0].rev)); await settle(60);
      if (cc) { c.ccBtn().click(); assert.strictEqual(c.ccOn(), caps === DOCK_CAPS, label + ': the is-cc-on mark exists only where it has a consumer (the live dock)'); }
      pull(r, 100);
      const s = scaleOf(r.wrapper().style.transform);
      assert.ok(s !== null, label + ': the pull claimed and moved the picture: ' + r.wrapper().style.transform);
      assert.strictEqual(s.toFixed(4), expectS(stripH).toFixed(4), label + ': the scale at dy 100 follows the dock height ' + (160 * 9 / 16 + 44 + stripH));
      touch(r.w, r.el(), 'touchcancel', 200, 420, 2000);
    } finally { r.close(); }
  }
});

test('R3 source lock: style.css carries the live-dock block after the dock\'s base and mobile rules - the X in the bar at a full thumb, the strip height, the is-cc-on reserve, the strip rule, and the strip height on #player-dock unconditionally', () => {
  const css = fs.readFileSync(path.join(REPO, 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => { const re = new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}'); const m = re.exec(css); assert.ok(m, 'rule exists: ' + sel); return { body: m[1], at: m.index }; };
  const x = rule('html.ft-native-dock #player-dock .player-dock-close');
  for (const d of ['top: auto', 'bottom: 0', 'right: 0', 'width: var(--size-touch)', 'height: var(--size-touch)', 'background: transparent']) assert.ok(x.body.includes(d), 'the X: ' + d);
  assert.match(x.body, /z-index: calc\(var\(--z-sticky\) - 21\)/, 'the X paints over the bar (8)');
  const bar = rule('html.ft-native-dock #player-dock .player-controls');
  assert.ok(bar.body.includes('height: var(--size-touch)') && /padding: 0 var\(--size-touch\) 0 var\(--space-3\)/.test(bar.body), 'the bar reserves the X\'s seat');
  const cc = rule('html.ft-native-dock #player-dock #player-wrapper.is-cc-on');
  assert.match(cc.body, /padding-bottom: calc\(var\(--size-touch\) \+ var\(--ft-dock-cc-h\)\)/, 'the reserve grows by the strip while captions are on');
  const strip = rule('html.ft-native-dock #player-dock .cc-overlay');
  assert.ok(strip.body.includes('bottom: var(--size-touch)') && strip.body.includes('height: var(--ft-dock-cc-h)'), 'the strip sits between the picture and the bar at a fixed height');
  const dock = /\n#player-dock \{\n {2}--ft-dock-cc-h: var\(--size-control-sm\); *\n\}/.exec(css);
  assert.ok(dock, 'the strip height is defined on #player-dock itself (dockRestingRect reads it before the dock shows)');
  // placement: after the mobile M5 block's own .player-dock-close rule and after the dock caption clamp
  const m5 = css.indexOf('#player-dock .player-dock-close {\n    top: 0;');
  const clamp = css.indexOf('#player-dock .cc-overlay-text {\n  font-size: var(--fs-xs);');
  assert.ok(m5 > 0 && clamp > 0 && x.at > m5 && x.at > clamp, 'file order: the live-dock block follows the rules it overrides');
  // a hidden caption overlay still collapses (the strip is the wrapper's reserve, not the overlay's box)
  assert.ok(/\.cc-overlay\[hidden\] \{\n {2}display: none;\n\}/.test(css));
});
