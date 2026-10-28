'use strict';

// [UNIT] v1.397.0 native audio: the pure half of public/js/native-audio.js - a player.load descriptor -> a contract Item, an
// Up-next queue entry -> an Item, the file duration of a clip Item, queue equality.

const { test } = require('node:test');
const assert = require('node:assert');
const NA = require('../../public/js/native-audio.js');

test('itemFromDescriptor: a native music track, a library audio file (its /thumbnail art becomes /albumart), a chapter row (the parent file + clip, saving under the parent), a podcast episode', () => {
  const music = NA.itemFromDescriptor({ id: 't1', type: 'audio', title: 'Mother', channelName: 'Pink Floyd', album: 'The Wall', duration: 200, artUrl: '/albumart/art1?v=3', streamSrc: '/track/t1', progressEndpoint: '/api/music/progress', resumeMode: 'music', radioSeed: 'track:t1' });
  assert.deepStrictEqual(music, { kind: 'track', id: 't1', src: '/api/offline/file/track/t1', title: 'Mother', artist: 'Pink Floyd', album: 'The Wall', artworkSrc: '/albumart/art1?v=3', durationSec: 200, progress: { route: '/api/music/progress', key: 't1' }, radioSeed: 'track:t1' });
  const lib = NA.itemFromDescriptor({ id: 'aud', type: 'audio', title: 'Talk', channelName: 'Speaker', album: '', duration: 90, artUrl: '/thumbnail/aud', streamSrc: '/video/aud', progressEndpoint: '/api/progress', resumeMode: 'music' });
  assert.deepStrictEqual(lib, { kind: 'track', id: 'aud', src: '/api/offline/file/track/aud', title: 'Talk', artist: 'Speaker', artworkSrc: '/albumart/aud', durationSec: 90, progress: { route: '/api/progress', key: 'aud' } });
  const chapter = NA.itemFromDescriptor({ id: 'aud::c1', type: 'audio', title: 'Two', channelName: 'Speaker', album: 'Talk', duration: 30, artUrl: '/thumbnail/aud', streamSrc: '/video/aud', progressEndpoint: '/api/progress', resumeMode: 'music', chapterStartSec: 30, baseMediaId: 'aud', radioSeed: 'track:aud::c1' });
  assert.deepStrictEqual(chapter, { kind: 'track', id: 'aud::c1', src: '/api/offline/file/track/aud', title: 'Two', artist: 'Speaker', album: 'Talk', artworkSrc: '/albumart/aud', durationSec: 30, clip: { startSec: 30, endSec: 60 }, progress: { route: '/api/progress', key: 'aud' }, radioSeed: 'track:aud::c1' });
  const pod = NA.itemFromDescriptor({ id: 'e1', type: 'audio', title: 'Episode One', channelName: 'The Show', duration: 1800, artUrl: '/podcastart/sub1', streamSrc: '/episode/e1', progressEndpoint: '/api/podcasts/progress', resumeMode: 'podcast', subId: 'sub1', radioSeed: 'track:e1' });
  assert.deepStrictEqual(pod, { kind: 'podcastEpisode', id: 'e1', src: '/api/offline/file/podcastEpisode/e1', title: 'Episode One', artist: 'The Show', artworkSrc: '/podcastart/sub1', durationSec: 1800, progress: { route: '/api/podcasts/progress', key: 'e1' } }, 'a podcast never carries a radio seed');
  // a chapter id with no baseMediaId still resolves its parent; an unknown progress route falls back to the kind's own
  assert.strictEqual(NA.itemFromDescriptor({ id: 'f::c2', type: 'audio', title: '', resumeMode: 'music', progressEndpoint: '/api/feed/progress/x', duration: 10, chapterStartSec: 20 }).src, '/api/offline/file/track/f');
  assert.strictEqual(NA.itemFromDescriptor({ id: 'f::c2', type: 'audio', title: '', resumeMode: 'music', progressEndpoint: '/api/feed/progress/x', duration: 10, chapterStartSec: 20 }).progress.route, '/api/music/progress');
  // a chapter with no known span gets no clip (native would play the whole file) rather than an invalid one
  assert.strictEqual(NA.itemFromDescriptor({ id: 'f::c2', type: 'audio', title: 'x', resumeMode: 'music', chapterStartSec: 20 }).clip, undefined);
});

test('itemFromDescriptor refuses what native does not play: a video, a book\'s audio (no resumeMode), the Feed\'s audio (resumeMode is music but it never calls this: still, a missing id or type is null)', () => {
  assert.strictEqual(NA.itemFromDescriptor({ id: 'v', type: 'video', resumeMode: 'music' }), null);
  assert.strictEqual(NA.itemFromDescriptor({ id: 'b', type: 'audio', streamSrc: '/book/b/tts/1', suppressProgress: true }), null, 'reader audio has no resumeMode');
  assert.strictEqual(NA.itemFromDescriptor({ type: 'audio', resumeMode: 'music' }), null, 'no id');
  assert.strictEqual(NA.itemFromDescriptor(null), null);
  assert.strictEqual(NA.itemFromDescriptor({ id: 'x', type: 'audio', resumeMode: 'tv' }), null);
});

test('itemFromQueueEntry: a track, a podcast and an audio media entry map; a video media entry and a malformed entry do not', () => {
  assert.deepStrictEqual(NA.itemFromQueueEntry({ uid: 'u1', mediaId: 't1', kind: 'track', item: { title: 'S', artist: 'A', album: 'B', artId: 'art', durationSec: 100 } }), { kind: 'track', id: 't1', src: '/api/offline/file/track/t1', title: 'S', artist: 'A', album: 'B', artworkSrc: '/albumart/art', durationSec: 100, progress: { route: '/api/music/progress', key: 't1' }, radioSeed: 'track:t1' });
  assert.deepStrictEqual(NA.itemFromQueueEntry({ uid: 'u2', mediaId: 'e1', kind: 'podcast', item: { title: 'E', showName: 'Show', subId: 's1', durationSec: 50 } }), { kind: 'podcastEpisode', id: 'e1', src: '/api/offline/file/podcastEpisode/e1', title: 'E', artist: 'Show', artworkSrc: '/podcastart/s1', durationSec: 50, progress: { route: '/api/podcasts/progress', key: 'e1' } });
  assert.deepStrictEqual(NA.itemFromQueueEntry({ uid: 'u3', mediaId: 'aud', kind: 'media', item: { type: 'audio', title: 'Talk', channelName: 'Sp', duration: 90 } }), { kind: 'track', id: 'aud', src: '/api/offline/file/track/aud', title: 'Talk', artist: 'Sp', album: '', artworkSrc: '/albumart/aud', durationSec: 90, progress: { route: '/api/progress', key: 'aud' } });
  assert.strictEqual(NA.itemFromQueueEntry({ uid: 'u4', mediaId: 'v1', kind: 'media', item: { type: 'video' } }), null, 'a video stays on the web');
  assert.strictEqual(NA.itemFromQueueEntry({ uid: 'u5', kind: 'track' }), null);
  assert.strictEqual(NA.itemFromQueueEntry(null), null);
});

test('fileDurationOf: a clip Item\'s file is as long as the last chapter of the same src; a plain Item is its own duration (the snapshot\'s when known); unknown is NaN', () => {
  const q = [{ kind: 'track', id: 'a::c0', src: '/f/a', clip: { startSec: 0, endSec: 30 } }, { kind: 'track', id: 'a::c1', src: '/f/a', clip: { startSec: 30, endSec: 95 } }, { kind: 'track', id: 'b', src: '/f/b', durationSec: 200 }];
  assert.strictEqual(NA.fileDurationOf(q[0], q, 30), 95);
  assert.strictEqual(NA.fileDurationOf(q[1], q, 65), 95);
  assert.strictEqual(NA.fileDurationOf(q[2], q, 0), 200);
  assert.strictEqual(NA.fileDurationOf(q[2], q, 201.5), 201.5, 'the snapshot\'s real duration wins for a plain item');
  assert.ok(Number.isNaN(NA.fileDurationOf({ kind: 'track', id: 'x', src: '/x' }, [], 0)));
  assert.ok(Number.isNaN(NA.fileDurationOf(null, q, 0)));
});

test('sameItem / sameQueue compare kind, id and clip bounds, never title or art', () => {
  assert.strictEqual(NA.sameItem({ kind: 'track', id: 'a', title: 'x' }, { kind: 'track', id: 'a', title: 'y' }), true);
  assert.strictEqual(NA.sameItem({ kind: 'track', id: 'a' }, { kind: 'podcastEpisode', id: 'a' }), false);
  assert.strictEqual(NA.sameItem({ kind: 'track', id: 'a', clip: { startSec: 0, endSec: 10 } }, { kind: 'track', id: 'a' }), false);
  assert.strictEqual(NA.sameItem({ kind: 'track', id: 'a', clip: { startSec: 0, endSec: 10 } }, { kind: 'track', id: 'a', clip: { startSec: 0, endSec: 11 } }), false);
  assert.strictEqual(NA.sameQueue([{ kind: 'track', id: 'a' }], [{ kind: 'track', id: 'a' }]), true);
  assert.strictEqual(NA.sameQueue([{ kind: 'track', id: 'a' }], [{ kind: 'track', id: 'a' }, { kind: 'track', id: 'b' }]), false);
  assert.strictEqual(NA.sameQueue(null, []), false);
});
