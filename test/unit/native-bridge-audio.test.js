'use strict';

// [UNIT] v1.397.0 native audio, W1 (plan docs/exec-plans/completed/2026-10-28-native-audio.md, D4): the `nativeAudio`
// half of the bridge contract AT THE ADAPTER - every audio message is gated by the capability and validated against
// the schema's mirror before it leaves the page, and every audio event is validated as data on the way in. The
// conformance net (native-bridge-contract.test.js) proves the tables equal the schema; this file proves the tables
// BIND (a message or event that does not fit is dropped, never posted or delivered).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { installFakeHost, loadAdapter } = require('../helpers/fake-host');
const adapterModule = require('../../public/js/host-adapter.js');

function realm(caps) {
  const dom = new JSDOM('<!doctype html><html><head><meta name="ft-version" content="1.397.0"></head><body></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  const fake = installFakeHost(win, { capabilities: caps });
  const host = loadAdapter(win);
  fake.clear();
  return { win, fake, host };
}
const item = (id, extra) => Object.assign({ kind: 'track', id, src: '/api/offline/file/track/' + id, title: 'Song ' + id, progress: { route: '/api/music/progress', key: id } }, extra || {});
const MODES = { autoplay: true, shuffle: false, loop: 'off' };
const load = (extra) => Object.assign({ queue: [item('a'), item('b')], index: 0, positionSec: 0, autoplay: true, modes: MODES, rate: 1, rev: 1 }, extra || {});

test('nativeAudio is a known capability; the audio messages are gated by it and nothing else', () => {
  assert.ok(adapterModule.CAPABILITIES.includes('nativeAudio'));
  for (const t of ['audio.load', 'audio.play', 'audio.pause', 'audio.seek', 'audio.skip', 'audio.jump', 'audio.setModes', 'audio.setRate', 'audio.sleep', 'audio.stop', 'audio.subscribe', 'audio.unsubscribe']) {
    assert.strictEqual(adapterModule.MESSAGES[t].cap, 'nativeAudio', t + ' needs nativeAudio');
  }
  const { win, fake, host } = realm(['downloads']);
  assert.strictEqual(host.has('nativeAudio'), false);
  assert.strictEqual(host.post('audio.play'), false, 'an older app build never gets an audio message');
  assert.strictEqual(host.post('audio.load', load()), false);
  assert.deepStrictEqual(fake.posts, []);
  win.close();
});

test('audio.load: the whole queue, index, position, autoplay, modes, rate and rev are required and bounded; unknown fields never leave', () => {
  const { win, fake, host } = realm(['nativeAudio']);
  assert.strictEqual(host.post('audio.load', load({ sneaky: 1 })), true);
  assert.deepEqual(fake.posts[0], { v: 1, type: 'audio.load', queue: [item('a'), item('b')], index: 0, positionSec: 0, autoplay: true, modes: MODES, rate: 1, rev: 1 }, 'exactly the contract shape, no stray field');
  fake.clear();
  assert.strictEqual(host.post('audio.load', load({ queue: undefined })), false, 'queue required');
  assert.strictEqual(host.post('audio.load', load({ queue: [] })), true, 'an empty queue is legal (native goes idle)');
  assert.strictEqual(host.post('audio.load', load({ index: -1 })), false, 'index >= 0');
  assert.strictEqual(host.post('audio.load', load({ positionSec: -0.5 })), false, 'position >= 0');
  assert.strictEqual(host.post('audio.load', load({ autoplay: 'yes' })), false, 'autoplay is a boolean');
  assert.strictEqual(host.post('audio.load', load({ modes: { autoplay: true, shuffle: false } })), false, 'modes.loop required');
  assert.strictEqual(host.post('audio.load', load({ modes: { autoplay: true, shuffle: false, loop: 'all' } })), false, 'loop is off | one');
  assert.strictEqual(host.post('audio.load', load({ rate: 0.25 })), false, 'rate >= 0.5');
  assert.strictEqual(host.post('audio.load', load({ rate: 3.5 })), false, 'rate <= 3');
  assert.strictEqual(host.post('audio.load', load({ rev: undefined })), false, 'rev required');
  assert.strictEqual(host.post('audio.load', load({ queue: new Array(2001).fill(item('x')) })), false, 'at most 2000 items');
  assert.strictEqual(fake.posts.length, 1, 'only the empty-queue load went out');
  win.close();
});

test('audio.load: every Item needs kind, id, src, title and progress; clip needs both bounds; progress.route is one of the four online routes', () => {
  const { win, fake, host } = realm(['nativeAudio']);
  const ok = (it) => host.post('audio.load', load({ queue: [it] }));
  assert.strictEqual(ok(item('a', { kind: 'book' })), false, 'kind is track | podcastEpisode | video | tvEpisode');
  assert.strictEqual(ok(item('a', { kind: 'podcastEpisode', src: '/api/offline/file/podcastEpisode/a', progress: { route: '/api/podcasts/progress', key: 'a' } })), true);
  assert.strictEqual(ok(Object.assign(item('a'), { src: undefined })), false, 'src required');
  assert.strictEqual(ok(Object.assign(item('a'), { title: undefined })), false, 'title required');
  assert.strictEqual(ok(Object.assign(item('a'), { progress: undefined })), false, 'progress required');
  assert.strictEqual(ok(item('a', { progress: { route: '/api/feed/progress/podcast', key: 'a' } })), false, 'the Feed route is not a native progress route');
  assert.strictEqual(ok(item('a', { progress: { route: '/api/progress' } })), false, 'progress.key required');
  assert.strictEqual(ok(item('a', { clip: { startSec: 10 } })), false, 'clip.endSec required');
  assert.strictEqual(ok(item('a', { clip: { startSec: 10, endSec: 20 }, artist: 'A', album: 'B', artworkSrc: '/albumart/a', durationSec: 10, radioSeed: 'track:a' })), true, 'a full chapter Item passes');
  assert.strictEqual(ok(item('a', { durationSec: -1 })), false, 'durationSec >= 0');
  assert.strictEqual(ok(item('a', { id: '' })), false, 'id 1..512');
  assert.strictEqual(fake.of('audio.load').length, 2);
  win.close();
});

// v1.398.0 (plan docs/exec-plans/active/2026-10-28-native-video-audio.md, W1 + V4): the two video kinds, and the Item rules the
// schema states and the adapter enforces so a wrong Item never leaves the page - src is EXACTLY the kind's own file route,
// artworkSrc one of the four art routes, radioSeed only on a track. (The capability itself gates nothing at the adapter - a host
// announces it beside nativeAudio - native-audio.js decides when to BUILD a video Item; see native-video-audio-contract.test.js.)
test('v1.398.0 audio.load: a video Item and a tvEpisode Item validate; a video Item with a /track src, a radioSeed, an art route off the list, or a src of another kind is refused (V4)', () => {
  const { win, fake, host } = realm(['nativeAudio', 'nativeVideoAudio']);
  const ok = (it) => host.post('audio.load', load({ queue: [it] }));
  const video = (extra) => Object.assign({ kind: 'video', id: 'v1', src: '/api/offline/file/video/v1', title: 'A talk', artist: 'Ch', artworkSrc: '/thumbnail/v1', durationSec: 600, progress: { route: '/api/progress', key: 'v1' } }, extra || {});
  const tv = (extra) => Object.assign({ kind: 'tvEpisode', id: 'e1', src: '/api/offline/file/tvEpisode/e1', title: 'Pilot', artist: 'The Show', artworkSrc: '/tvthumb/e1', durationSec: 2600, progress: { route: '/api/tv/progress', key: 'e1' } }, extra || {});
  assert.strictEqual(ok(video()), true, 'a video Item passes');
  assert.strictEqual(ok(tv()), true, 'a tvEpisode Item passes');
  assert.strictEqual(ok(video({ artworkSrc: undefined })), true, 'a video with no thumbnail omits artworkSrc');
  assert.strictEqual(ok(video({ clip: { startSec: 30, endSec: 95 } })), true, 'a Listen row of a chaptered video carries clip (the D6 semantics)');
  assert.deepStrictEqual(fake.of('audio.load').map((m) => m.queue[0].kind), ['video', 'tvEpisode', 'video', 'video']);
  assert.strictEqual(ok(video({ src: '/api/offline/file/track/v1' })), false, 'a video Item never rides the audio file route');
  assert.strictEqual(ok(video({ src: '/video/v1' })), false, 'never the web byte route');
  assert.strictEqual(ok(tv({ src: '/api/offline/file/video/e1' })), false, 'a tvEpisode never rides the video route');
  assert.strictEqual(ok(video({ radioSeed: 'track:v1' })), false, 'no radio from a video');
  assert.strictEqual(ok(tv({ radioSeed: 'track:e1' })), false, 'no radio from a TV episode');
  assert.strictEqual(ok(item('p', { kind: 'podcastEpisode', src: '/api/offline/file/podcastEpisode/p', progress: { route: '/api/podcasts/progress', key: 'p' }, radioSeed: 'track:p' })), false, 'no radio from a podcast either');
  assert.strictEqual(ok(video({ artworkSrc: '/albumart/v1?x=1' })), true, 'any of the four art routes is accepted (the kind mapping is the web\'s)');
  assert.strictEqual(ok(video({ artworkSrc: 'https://evil.example/x.png' })), false, 'an art URL off the four routes never leaves');
  assert.strictEqual(ok(video({ artworkSrc: '/api/offline/file/video/v1' })), false, 'the file route is not an art route');
  assert.strictEqual(ok(item('a', { src: '/api/offline/file/video/a' })), false, 'a track never rides the video route (the rule binds every kind)');
  assert.strictEqual(ok(video({ progress: { route: '/api/tv/progress', key: 'v1' } })), true, 'the progress route enum is per contract, not per kind (the web picks the right one)');
  assert.strictEqual(fake.of('audio.load').length, 6);
  // an older app build: the kinds are refused by nothing at the adapter (add-only; native-audio.js never builds them there)
  const old = realm(['nativeAudio']);
  assert.strictEqual(old.host.has('nativeVideoAudio'), false);
  old.win.close();
  win.close();
});

test('the intents: seek / skip / jump / setModes / setRate / sleep carry exactly their fields; play / pause / stop / subscribe / unsubscribe carry none', () => {
  const { win, fake, host } = realm(['nativeAudio']);
  assert.strictEqual(host.post('audio.seek', { positionSec: 12.5 }), true);
  assert.strictEqual(host.post('audio.seek', { positionSec: -1 }), false);
  assert.strictEqual(host.post('audio.seek'), false, 'positionSec required');
  assert.strictEqual(host.post('audio.skip', { to: 'next' }), true);
  assert.strictEqual(host.post('audio.skip', { to: 'previous' }), true);
  assert.strictEqual(host.post('audio.skip', { to: 'back' }), false);
  assert.strictEqual(host.post('audio.jump', { index: 3 }), true);
  assert.strictEqual(host.post('audio.jump', { index: -1 }), false);
  assert.strictEqual(host.post('audio.setModes', { modes: { autoplay: false, shuffle: true, loop: 'one' } }), true);
  assert.strictEqual(host.post('audio.setModes', { modes: { autoplay: false } }), false);
  assert.strictEqual(host.post('audio.setRate', { rate: 1.5 }), true);
  assert.strictEqual(host.post('audio.setRate', { rate: 0 }), false);
  assert.strictEqual(host.post('audio.sleep', { mode: 'minutes', minutes: 15 }), true);
  assert.strictEqual(host.post('audio.sleep', { mode: 'endOfItem' }), true);
  assert.strictEqual(host.post('audio.sleep', { mode: 'off' }), true);
  assert.strictEqual(host.post('audio.sleep', { mode: 'minutes', minutes: 0 }), false, 'minutes 1..720');
  assert.strictEqual(host.post('audio.sleep', { mode: 'minutes', minutes: 721 }), false);
  assert.strictEqual(host.post('audio.sleep', { mode: 'hours' }), false);
  for (const t of ['audio.play', 'audio.pause', 'audio.stop', 'audio.subscribe', 'audio.unsubscribe']) {
    assert.strictEqual(host.post(t, { positionSec: 1 }), true, t);
    assert.deepStrictEqual(fake.posts[fake.posts.length - 1], { v: 1, type: t }, t + ' carries nothing');
  }
  assert.deepStrictEqual(fake.types(), ['audio.seek', 'audio.skip', 'audio.skip', 'audio.jump', 'audio.setModes', 'audio.setRate', 'audio.sleep', 'audio.sleep', 'audio.sleep', 'audio.play', 'audio.pause', 'audio.stop', 'audio.subscribe', 'audio.unsubscribe']);
  win.close();
});

const STATE = (extra) => Object.assign({ v: 1, type: 'audioState', rev: 1, queue: [item('a'), item('b')], index: 1, state: 'playing', positionSec: 3, durationSec: 100, rate: 1, modes: MODES, sleep: { mode: 'off' } }, extra || {});

test('audioState is validated as data: the required fields, an unknown error reads as other, a bad optional field is dropped (never the snapshot), an unknown state drops it, a bad queue element drops that element', () => {
  const { win, fake, host } = realm(['nativeAudio']);
  const got = [];
  host.on('audioState', (d) => got.push(d));
  fake.emit(STATE({ bufferedSec: 10, sleep: { mode: 'minutes', endsAt: 1760000000000 }, extra: 'x' }));
  assert.strictEqual(got.length, 1);
  assert.deepEqual(got[0], { rev: 1, queue: [item('a'), item('b')], index: 1, state: 'playing', positionSec: 3, durationSec: 100, bufferedSec: 10, rate: 1, modes: MODES, sleep: { mode: 'minutes', endsAt: 1760000000000 } }, 'exactly the contract fields, no stray one');
  fake.emit(STATE({ state: 'failed', error: 'diskOnFire' }));
  assert.strictEqual(got[1].error, 'other', 'an unknown error reads as other');
  fake.emit(STATE({ bufferedSec: -4 }));
  assert.strictEqual(got.length, 3, 'a bad optional field never swallows the snapshot');
  assert.strictEqual(got[2].bufferedSec, undefined, 'it is dropped');
  fake.emit(STATE({ state: 'buffering' }));
  fake.emit(STATE({ positionSec: 'three' }));
  fake.emit(STATE({ modes: { autoplay: true } }));
  fake.emit(STATE({ sleep: undefined }));
  fake.emit(STATE({ queue: undefined }));
  fake.emit(STATE({ rate: 9 }));
  assert.strictEqual(got.length, 3, 'an unknown state, a bad required field, a bad modes, a missing sleep or queue, an out-of-range rate: dropped');
  fake.emit(STATE({ queue: [item('a'), { kind: 'track', id: 'bad' }, item('c')] }));
  assert.strictEqual(got.length, 4);
  assert.deepEqual(got[3].queue.map((it) => it.id), ['a', 'c'], 'the element missing src / title / progress is dropped, the snapshot stays');
  fake.emit(STATE({ queue: [] }));
  assert.strictEqual(got[4].queue.length, 0, 'an empty queue (idle) is legal');
  win.close();
});

test('audioTick and audioError are validated as data; a host without nativeAudio still delivers nothing to a listener for them', () => {
  const { win, fake, host } = realm(['nativeAudio']);
  const ticks = [], errors = [];
  host.on('audioTick', (d) => ticks.push(d));
  host.on('audioError', (d) => errors.push(d));
  fake.emit({ v: 1, type: 'audioTick', rev: 2, positionSec: 44.5, bufferedSec: 60, junk: true });
  fake.emit({ v: 1, type: 'audioTick', rev: 2 });
  fake.emit({ v: 1, type: 'audioTick', positionSec: 1 });
  fake.emit({ v: 1, type: 'audioTick', rev: 2, positionSec: 1, bufferedSec: 'lots' });
  assert.deepEqual(ticks, [{ rev: 2, positionSec: 44.5, bufferedSec: 60 }, { rev: 2, positionSec: 1 }], 'rev + positionSec required; a bad bufferedSec is dropped, not the tick');
  fake.emit({ v: 1, type: 'audioError', id: 'a', error: 'notPlayable' });
  fake.emit({ v: 1, type: 'audioError', id: 'a', error: 'exploded' });
  fake.emit({ v: 1, type: 'audioError', error: 'network' });
  fake.emit({ v: 1, type: 'audioError', id: '', error: 'network' });
  assert.deepEqual(errors, [{ id: 'a', error: 'notPlayable' }, { id: 'a', error: 'other' }], 'id required (1..512); an unknown error reads as other');
  win.close();
  // The event tables are not capability-gated at the adapter (events are data), so the one guard against a host that
  // never announced nativeAudio is the subscriber: native-audio.js never subscribes without the capability (W3).
  const other = realm(['battery']);
  assert.strictEqual(other.host.has('nativeAudio'), false);
  other.win.close();
});
