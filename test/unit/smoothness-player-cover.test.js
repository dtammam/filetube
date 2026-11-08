'use strict';

// v1.406.0 W1 A2 (plan docs/exec-plans/active/2026-11-08-smoothness.md): the tapped thumbnail covers the player box until the
// first real frame - never a black box. Drives the REAL player.js + native-audio.js + host-adapter.js (the live-dock realm),
// with a fake host for the app and no host for a browser. Two axes per surface (LESSONS 0, 2): the REVEAL (the cover is up
// from the load, the hole shut) and every CLEAR (the first frame, a seek, an error, a new item, dock, close, PiP), each from a
// populated state. Under native: covered by the hole or the cover, never neither, in one task.

const { test } = require('node:test');
const assert = require('node:assert');
const { realm, settle, VIDEO, DOCK_CAPS, STATE } = require('../helpers/live-dock-realm');

const cover = (r) => r.w.document.querySelector('#player-wrapper .player-cover');
const NOT_READY = (rev, extra) => STATE(rev, Object.assign({ pictureReady: false }, extra || {}));
const NO_FIELD = (rev, extra) => { const s = STATE(rev, extra); delete s.pictureReady; return s; };

async function claimed(r, data) {
  r.player.load('v1', data || VIDEO, { slot: r.slot });
  await settle(80);
  const loads = r.fake.of('audio.load');
  assert.strictEqual(loads.length, 1, 'the claim');
  return loads[0].rev;
}

// ---- the web element (a browser: no host) ---------------------------------------------------------------------------------

test('A2 web: a video load shows the thumbnail cover over the box at once (an <img>, after #media-player, never a re-set poster); the first playing drops it', async () => {
  const r = realm({ noHost: true });
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    const c = cover(r);
    assert.ok(c, 'the cover is up synchronously with the load (the swap frame)');
    assert.strictEqual(c.tagName, 'IMG');
    assert.strictEqual(c.getAttribute('src'), '/thumbnail/v1');
    assert.strictEqual(c.previousElementSibling, r.el(), 'directly over the video element');
    assert.strictEqual(c.getAttribute('aria-hidden'), 'true');
    r.el().dispatchEvent(new r.w.Event('playing'));
    assert.strictEqual(cover(r), null, 'the first frame takes over');
  } finally { r.close(); }
});

test('A2 web: every clear from a populated state - seeked, error, a new item, dock, close, picture-in-picture', async () => {
  const r = realm({ noHost: true });
  try {
    const up = () => { r.player.load('v1', VIDEO, { slot: r.slot }); assert.ok(cover(r), 'populated'); };
    up(); r.el().dispatchEvent(new r.w.Event('seeked')); assert.strictEqual(cover(r), null, 'seeked');
    r.player.close(); up(); r.el().dispatchEvent(new r.w.Event('error')); assert.strictEqual(cover(r), null, 'error');
    r.player.close(); up(); r.player.load('v2', Object.assign({}, VIDEO, { id: 'v2', hasThumbnail: false }), { slot: r.slot }); assert.strictEqual(cover(r), null, 'a new item with no thumbnail never keeps the old one');
    r.player.close(); up(); r.player.load('v2', Object.assign({}, VIDEO, { id: 'v2' }), { slot: r.slot }); assert.strictEqual(cover(r).getAttribute('src'), '/thumbnail/v2', 'a new item swaps the cover to its own thumbnail');
    r.player.close(); assert.strictEqual(cover(r), null, 'close');
    up(); r.player.dock(); assert.strictEqual(cover(r), null, 'dock (the mini player shows the poster)');
    r.player.close(); up(); r.el().dispatchEvent(new r.w.Event('enterpictureinpicture')); assert.strictEqual(cover(r), null, 'picture-in-picture');
  } finally { r.close(); }
});

test('A2 web: the cover never outlives its item - a covered video followed by an audio item (teardown) or closed then reopened as audio (close) leaves none', async () => {
  const r = realm({ noHost: true });
  const AUDIO = Object.assign({}, VIDEO, { id: 'a1', type: 'audio' });
  try {
    r.player.load('v1', VIDEO, { slot: r.slot });
    assert.ok(cover(r), 'populated');
    r.player.load('a1', AUDIO, { slot: r.slot });
    assert.strictEqual(cover(r), null, 'the teardown of a new load drops it');
    r.player.load('v1', VIDEO, { slot: r.slot });
    assert.ok(cover(r), 'populated again');
    const held = cover(r);
    r.player.close();
    assert.strictEqual(held.isConnected, false);
    r.player.load('a1', AUDIO, { slot: r.slot });
    assert.strictEqual(cover(r), null, 'close dropped it (the host comes back with no cover)');
  } finally { r.close(); }
});

test('A2 web: no cover for an audio item (its box is the art layer), a video with no thumbnail, or a rendition still transcoding', async () => {
  const r = realm({ noHost: true });
  try {
    r.player.load('a1', Object.assign({}, VIDEO, { id: 'a1', type: 'audio' }), { slot: r.slot });
    assert.strictEqual(cover(r), null, 'audio');
    r.player.load('v3', Object.assign({}, VIDEO, { id: 'v3', hasThumbnail: false }), { slot: r.slot });
    assert.strictEqual(cover(r), null, 'no thumbnail');
    r.player.load('v4', Object.assign({}, VIDEO, { id: 'v4', needsTranscode: true, transcodeStatus: 'pending' }), { slot: r.slot });
    assert.strictEqual(cover(r), null, '"Preparing this video" owns the box');
  } finally { r.close(); }
});

// ---- the native surface (the app) -----------------------------------------------------------------------------------------

test('A2 native: the claim puts the cover up and keeps the hole SHUT while the layer is placed (visible: true); pictureReady false keeps it so', async () => {
  const r = realm({ caps: DOCK_CAPS });
  try {
    const rev = await claimed(r);
    assert.ok(cover(r), 'the cover is up from the claim');
    assert.strictEqual(r.poster(), null, 'never a poster under native');
    assert.strictEqual(r.bodyOn(), false, 'the hole is shut before any picture');
    r.fake.emit(NOT_READY(rev));
    await settle(60);
    assert.ok(r.surfaces().some((m) => m.visible === true), 'native is told where the picture goes (so it can draw its first frame)');
    assert.strictEqual(r.bodyOn(), false, 'playing, but no displayable frame: still shut');
    assert.ok(cover(r), 'and still covered');
    assert.strictEqual(r.na.pictureReady(), false);
  } finally { r.close(); }
});

test('A2 native: pictureReady true opens the hole AND drops the cover in the same task (never neither, never both)', async () => {
  const r = realm({ caps: DOCK_CAPS });
  try {
    const rev = await claimed(r);
    r.fake.emit(NOT_READY(rev));
    await settle(60);
    assert.ok(cover(r)); assert.strictEqual(r.bodyOn(), false);
    r.fake.emit(STATE(rev)); // pictureReady: true
    // synchronously after the event: no frame boundary between them
    assert.strictEqual(r.bodyOn(), true, 'the hole is open');
    assert.strictEqual(cover(r), null, 'the cover is gone');
    assert.strictEqual(r.na.pictureReady(), true);
  } finally { r.close(); }
});

test('A2 native fallback (today\'s app, no pictureReady field): playing alone keeps it covered; the first tick while playing opens it', async () => {
  const r = realm({ caps: DOCK_CAPS });
  try {
    const rev = await claimed(r);
    r.fake.emit(NO_FIELD(rev));
    await settle(60);
    assert.strictEqual(r.bodyOn(), false, 'state playing is not a frame');
    assert.ok(cover(r));
    r.fake.emit({ v: 1, type: 'audioTick', rev, positionSec: 13 });
    assert.strictEqual(r.bodyOn(), true, 'the first tick: open');
    assert.strictEqual(cover(r), null);
  } finally { r.close(); }
});

test('A2 native fallback: a tick while PAUSED (or loading) is not a picture; a tick of an OLDER load never opens the new one', async () => {
  const r = realm({ caps: DOCK_CAPS });
  try {
    const rev = await claimed(r);
    r.fake.emit(NO_FIELD(rev, { state: 'paused' }));
    await settle(30);
    r.fake.emit({ v: 1, type: 'audioTick', rev, positionSec: 13 });
    assert.strictEqual(r.bodyOn(), false, 'paused: no tick-based readiness');
    r.fake.emit(NO_FIELD(rev - 1));
    r.fake.emit({ v: 1, type: 'audioTick', rev: rev - 1, positionSec: 2 });
    assert.strictEqual(r.bodyOn(), false, 'an older rev never counts');
    assert.ok(cover(r));
  } finally { r.close(); }
});

test('A2 native: readiness latches per load - a later pictureReady false for the same item keeps the hole; a NEW load shuts it again and re-covers', async () => {
  const r = realm({ caps: DOCK_CAPS });
  try {
    const rev = await claimed(r);
    r.fake.emit(STATE(rev));
    assert.strictEqual(r.bodyOn(), true);
    r.fake.emit(NOT_READY(rev));
    await settle(30);
    assert.strictEqual(r.bodyOn(), true, 'latched: a background detach never flashes the page over a picture already seen');
    r.player.load('v2', Object.assign({}, VIDEO, { id: 'v2', title: 'Second' }), { slot: r.slot });
    await settle(80);
    assert.strictEqual(cover(r).getAttribute('src'), '/thumbnail/v2', 'the next video is covered');
    assert.strictEqual(r.bodyOn(), false, 'and the hole shut until ITS picture is ready');
    assert.strictEqual(r.na.pictureReady(), false);
  } finally { r.close(); }
});

test('A2 native docked above (nativeVideoDock): a picture not ready yet is NOT shown above the page (visible: false, the dock thumbnail); ready shows it', async () => {
  const r = realm({ caps: DOCK_CAPS, reduced: true });
  try {
    const rev = await claimed(r);
    r.fake.emit(NOT_READY(rev));
    await settle(30);
    r.player.dock();
    await settle(80);
    assert.strictEqual(cover(r), null, 'the dock drops the cover');
    const last = r.last();
    assert.strictEqual(last.layer, 'above');
    assert.strictEqual(last.visible, false, 'no black box above the page');
    assert.strictEqual(r.poster(), '/thumbnail/v1', 'the dock shows the thumbnail');
    r.fake.emit(STATE(rev));
    await settle(80);
    assert.strictEqual(r.last().visible, true, 'ready: the live picture');
  } finally { r.close(); }
});

test('A2 native: expanded again before the first frame, the cover comes back (never a black box in the slot); close drops it', async () => {
  const r = realm({ caps: DOCK_CAPS, reduced: true });
  try {
    const rev = await claimed(r);
    r.fake.emit(NOT_READY(rev));
    await settle(30);
    r.player.dock();
    await settle(60);
    assert.strictEqual(cover(r), null);
    let opened = 0; // every frame the hole was open, not only the end state (the switch opens it for one frame when it may)
    const mo = new r.w.MutationObserver(() => { if (r.bodyOn()) opened += 1; });
    mo.observe(r.w.document.body, { attributes: true, attributeFilter: ['class'] });
    r.player.expand(r.slot);
    assert.ok(cover(r), 'covered again in the slot');
    await settle(80);
    mo.disconnect();
    assert.strictEqual(opened, 0, 'the above -> below switch never opens the hole over a picture that is not ready');
    assert.strictEqual(r.bodyOn(), false);
    assert.ok(cover(r));
    r.player.close();
    assert.strictEqual(cover(r), null, 'close');
  } finally { r.close(); }
});

test('A2 native: a follow of a picture already on screen (the watch page re-opened) needs no cover', async () => {
  const r = realm({ caps: DOCK_CAPS });
  try {
    const rev = await claimed(r);
    r.fake.emit(STATE(rev));
    assert.strictEqual(cover(r), null);
    r.player.dock();
    await settle(30);
    r.player.load('v1', VIDEO, { slot: r.slot }); // the adopt
    await settle(30);
    assert.strictEqual(cover(r), null);
  } finally { r.close(); }
});

test('A2 CSS belt: the cover never paints while the hole is open', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /body\.ft-native-video \.player-cover \{\s*visibility: hidden;\s*\}/);
  assert.match(css, /\.player-cover \{[^}]*pointer-events: none;[^}]*\}/, 'a cover never takes a touch');
});
