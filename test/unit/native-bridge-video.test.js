'use strict';

// [UNIT] v1.399.0 native video surface, W1 (plan docs/exec-plans/completed/2026-10-28-native-video-surface.md): the `nativeVideo`
// half of the bridge contract AT THE ADAPTER. The conformance net (native-bridge-contract.test.js) proves the tables equal the
// schema; this file proves they BIND: `video.surface` (S3, the ONE new intent) leaves the page only under `nativeVideo` and only
// in the contract shape, and `audioState.videoSize` (S4, additive) is validated as data on the way in - a bad size is dropped,
// never the snapshot. Frozen 2026-10-30 with `space: 'document'` (the spike gate lifted by Dean; the hole, scroll following,
// the lock and rotation are device checks (0a)-(0d), not facts).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { installFakeHost, loadAdapter } = require('../helpers/fake-host');
const adapterModule = require('../../public/js/host-adapter.js');

function realm(caps) {
  const dom = new JSDOM('<!doctype html><html><head><meta name="ft-version" content="1.399.0"></head><body></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  const fake = installFakeHost(win, { capabilities: caps });
  const host = loadAdapter(win);
  fake.clear();
  return { win, fake, host };
}
const VIDEO_CAPS = ['nativeAudio', 'nativeVideoAudio', 'nativeVideo'];
const RECT = { x: 0, y: 112.5, w: 393, h: 221 };
const surface = (extra) => Object.assign({ rect: RECT, space: 'document', visible: true, fit: 'contain', radius: 12 }, extra || {});
const item = (id) => ({ kind: 'video', id, src: '/api/offline/file/video/' + id, title: 'Clip ' + id, progress: { route: '/api/progress', key: id } });
const MODES = { autoplay: true, shuffle: false, loop: 'off' };
const STATE = (extra) => Object.assign({ v: 1, type: 'audioState', rev: 1, queue: [item('v1')], index: 0, state: 'playing', positionSec: 3, durationSec: 100, rate: 1, modes: MODES, sleep: { mode: 'off' } }, extra || {});

test('nativeVideo is a known capability; video.surface is the ONE video message and it is gated by nativeVideo alone (S1, S2, S3)', () => {
  assert.ok(adapterModule.CAPABILITIES.includes('nativeVideo'));
  const videoMessages = Object.keys(adapterModule.MESSAGES).filter((t) => t.indexOf('video.') === 0);
  assert.deepStrictEqual(videoMessages, ['video.surface'], 'no video.* transport: play, pause, seek, rate and stop stay audio.*');
  assert.strictEqual(adapterModule.MESSAGES['video.surface'].cap, 'nativeVideo');
  assert.deepStrictEqual(adapterModule.SURFACE_SPACES, ['document', 'viewport']);
  assert.deepStrictEqual(adapterModule.SURFACE_FITS, ['contain', 'cover']);
  const { win, fake, host } = realm(['nativeAudio', 'nativeVideoAudio']);
  assert.strictEqual(host.has('nativeVideo'), false, 'a v0.15.x build: audio for a Listen row, no picture');
  assert.strictEqual(host.post('video.surface', surface()), false, 'never sent to a host without the capability');
  assert.deepStrictEqual(fake.posts, []);
  win.close();
});

test('video.surface: rect {x, y, w, h}, space, visible, fit and radius are all required and bounded; unknown fields never leave', () => {
  const { win, fake, host } = realm(VIDEO_CAPS);
  assert.strictEqual(host.post('video.surface', surface({ sneaky: 1, rect: Object.assign({ z: 9 }, RECT) })), true);
  assert.deepEqual(fake.posts[0], { v: 1, type: 'video.surface', rect: RECT, space: 'document', visible: true, fit: 'contain', radius: 12 }, 'exactly the contract shape, no stray field at either level');
  fake.clear();
  assert.strictEqual(host.post('video.surface', surface({ space: 'viewport', visible: false, fit: 'cover', radius: 0 })), true, 'the fixed placement, hidden, cover, square');
  assert.strictEqual(host.post('video.surface', surface({ rect: { x: -40.25, y: -3, w: 0, h: 0 } })), true, 'negative x / y (a box scrolled above the top) and a zero-size box are legal; native clamps');
  assert.strictEqual(fake.posts.length, 2);
  fake.clear();
  for (const [why, bad] of [
    ['rect required', { rect: undefined }],
    ['rect.h required', { rect: { x: 0, y: 0, w: 10 } }],
    ['rect.w >= 0', { rect: { x: 0, y: 0, w: -1, h: 10 } }],
    ['rect.x finite', { rect: { x: Infinity, y: 0, w: 10, h: 10 } }],
    ['rect.y a number', { rect: { x: 0, y: '0', w: 10, h: 10 } }],
    ['rect is an object', { rect: 'full' }],
    ['space required', { space: undefined }],
    ['space is document | viewport', { space: 'screen' }],
    ['visible required', { visible: undefined }],
    ['visible is a boolean', { visible: 1 }],
    ['fit required', { fit: undefined }],
    ['fit is contain | cover', { fit: 'fill' }],
    ['radius required', { radius: undefined }],
    ['radius >= 0', { radius: -1 }],
    ['radius finite', { radius: NaN }],
  ]) assert.strictEqual(host.post('video.surface', surface(bad)), false, why);
  assert.deepStrictEqual(fake.posts, [], 'nothing malformed left the page');
  win.close();
});

test('audioState.videoSize {w, h} (S4) is additive and optional: delivered when it fits, dropped (never the snapshot) when it does not, absent for an audio Item', () => {
  const { win, fake, host } = realm(VIDEO_CAPS);
  const got = [];
  host.on('audioState', (d) => got.push(d));
  fake.emit(STATE({ videoSize: { w: 1920, h: 1080, depth: 8 } }));
  assert.strictEqual(got.length, 1);
  assert.deepEqual(got[0].videoSize, { w: 1920, h: 1080 }, 'exactly w and h');
  fake.emit(STATE({ videoSize: { w: 0, h: 0 } }));
  assert.deepEqual(got[1].videoSize, { w: 0, h: 0 }, 'a zero size (no frame yet) is a legal value');
  fake.emit(STATE({ videoSize: { w: 1920 } }));
  fake.emit(STATE({ videoSize: { w: -1, h: 1080 } }));
  fake.emit(STATE({ videoSize: { w: '1920', h: 1080 } }));
  fake.emit(STATE({ videoSize: 'big' }));
  assert.strictEqual(got.length, 6, 'a bad videoSize never swallows the snapshot');
  for (const d of got.slice(2)) assert.strictEqual(d.videoSize, undefined, 'it is dropped');
  fake.emit(STATE({ queue: [{ kind: 'track', id: 't', src: '/api/offline/file/track/t', title: 'Song', progress: { route: '/api/music/progress', key: 't' } }] }));
  assert.strictEqual(got.length, 7);
  assert.strictEqual(got[6].videoSize, undefined, 'absent for an audio Item');
  win.close();
});
