'use strict';

// [UNIT] v1.387.0 offline playback, plan D3 - the iOS playability rule
// (lib/offline/playable.js), table-driven: one fixture per ARGUMENT AXIS
// (container, video codec, HEVC tag, audio codec, kind, ffmpeg presence, a
// failed transcode), each chosen so the correct and a broken rule DIVERGE.

const { test } = require('node:test');
const assert = require('node:assert');
const p = require('../../lib/offline/playable');

const video = (o) => p.decidePlayability({ kind: 'video', ext: '.mp4', videoCodec: 'h264', audioCodec: 'aac', transcodeAvailable: true, ...o });
const tv = (o) => video({ kind: 'tvEpisode', ...o });
const track = (o) => p.decidePlayability({ kind: 'track', ext: '.flac', audioCodec: 'flac', ...o });
const libraryAudio = (o) => p.decidePlayability({ kind: 'video', isAudio: true, ext: '.m4a', audioCodec: 'aac', transcodeAvailable: true, ...o });
const podcast = (o) => p.decidePlayability({ kind: 'podcastEpisode', ext: '.mp3', ...o });

test('the table: the original is served for every iOS-native container + codec row', () => {
  const rows = [
    ['mp4 h264 aac', video({})],
    ['mp4 hevc hvc1 aac', video({ videoCodec: 'hevc', hevcTag: 'hvc1' })],
    ['mov h264 pcm', video({ ext: '.mov', audioCodec: 'pcm_s16le' })],
    ['m4v h264 ac3', video({ ext: '.m4v', audioCodec: 'ac3' })],
    ['mp4 h264 eac3', video({ audioCodec: 'eac3' })],
    ['mp4 avc1 mp3', video({ videoCodec: 'avc1', audioCodec: 'mp3' })],
    ['tv mp4 hevc hvc1', tv({ videoCodec: 'hevc', hevcTag: 'HVC1' })],
    ['m4a alac', track({ ext: '.m4a', audioCodec: 'alac' })],
    ['m4a aac', track({ ext: '.m4a', audioCodec: 'aac' })],
    ['mp3', track({ ext: '.mp3', audioCodec: 'mp3' })],
    ['flac', track({})],
    ['wav pcm', track({ ext: '.wav', audioCodec: 'pcm_s24le' })],
    ['aac adts', track({ ext: '.aac', audioCodec: 'aac' })],
    ['caf pcm', track({ ext: '.caf', audioCodec: 'pcm_f32le' })],
    ['library audio m4a aac', libraryAudio({})],
    ['library audio mp4 container aac', libraryAudio({ ext: '.mp4' })],
    ['podcast mp3', podcast({})],
    ['podcast m4a', podcast({ ext: '.m4a' })],
    ['podcast aac', podcast({ ext: '.aac' })],
    ['podcast mp4', podcast({ ext: '.mp4' })],
    ['unknown codecs in an mp4 are not flagged (positive identification only)', video({ videoCodec: null, audioCodec: null })],
    ['upper-case ext and codec', video({ ext: '.MP4', videoCodec: 'H264', audioCodec: 'AAC' })],
    ['mp4 h264 opus (device-confirmed, iOS Root row 16)', video({ audioCodec: 'opus' })],
    ['ogg vorbis (device-confirmed, rows 17-18 on iOS 18 and 27)', track({ ext: '.ogg', audioCodec: 'vorbis' })],
    ['opus (device-confirmed)', track({ ext: '.opus', audioCodec: 'opus' })],
    ['library audio ogg vorbis', libraryAudio({ ext: '.ogg', audioCodec: 'vorbis' })],
    ['podcast ogg', podcast({ ext: '.ogg' })],
    ['podcast opus', podcast({ ext: '.opus' })],
  ];
  for (const [name, d] of rows) assert.deepStrictEqual(d, { mode: 'original' }, name);
});

test('the transcode side: a video that fails the rule takes the existing H.264/AAC transcode when ffmpeg is there', () => {
  const rows = [
    ['mp4 hevc hev1', video({ videoCodec: 'hevc', hevcTag: 'hev1' })],
    ['mp4 hevc unknown tag (probe failed)', video({ videoCodec: 'hevc', hevcTag: null })],
    ['mp4 hevc no tag field', video({ videoCodec: 'hevc' })],
    ['mkv h264 aac', video({ ext: '.mkv' })],
    ['avi', video({ ext: '.avi', videoCodec: 'mpeg4', audioCodec: 'mp3' })],
    ['webm vp9 opus', video({ ext: '.webm', videoCodec: 'vp9', audioCodec: 'opus' })],
    ['mp4 vp9 aac (video axis alone)', video({ videoCodec: 'vp9' })],
    ['mp4 h264 dts', video({ audioCodec: 'dts' })],
    ['tv mkv hevc', tv({ ext: '.mkv', videoCodec: 'hevc' })],
  ];
  for (const [name, d] of rows) assert.deepStrictEqual(d, { mode: 'transcode' }, name);
});

test('not offerable (terminal 409): audio that fails the rule, no ffmpeg, a failed transcode, a podcast in a foreign container, an unknown kind', () => {
  assert.deepStrictEqual(track({ ext: '.wma', audioCodec: 'wmav2' }), { mode: 'none', reason: 'container' });
  assert.deepStrictEqual(track({ ext: '.ape', audioCodec: 'ape' }), { mode: 'none', reason: 'container' });
  assert.deepStrictEqual(track({ ext: '.m4a', audioCodec: 'wmav2' }), { mode: 'none', reason: 'audioCodec' }, 'a native container with a foreign codec');
  assert.deepStrictEqual(libraryAudio({ ext: '.webm', audioCodec: 'opus' }), { mode: 'none', reason: 'container' }, 'library audio never takes the video transcode');
  assert.deepStrictEqual(libraryAudio({ ext: '.wma', audioCodec: 'wmav2', transcodeAvailable: true }), { mode: 'none', reason: 'container' });
  assert.deepStrictEqual(video({ ext: '.mkv', transcodeAvailable: false }), { mode: 'none', reason: 'noTranscoder' });
  assert.deepStrictEqual(video({ ext: '.mkv', transcodeFailed: true }), { mode: 'none', reason: 'transcodeFailed' });
  assert.deepStrictEqual(video({ transcodeFailed: true }), { mode: 'original' }, 'a failed transcode is irrelevant when the original plays');
  assert.deepStrictEqual(podcast({ ext: '.wma' }), { mode: 'none', reason: 'container' });
  assert.deepStrictEqual(podcast({ ext: '.flac' }), { mode: 'none', reason: 'container' }, 'podcasts are decided by extension only: flac is not in the podcast set');
  assert.deepStrictEqual(p.decidePlayability({ kind: 'album', ext: '.mp4' }), { mode: 'none', reason: 'kind' });
  assert.deepStrictEqual(p.decidePlayability(null), { mode: 'none', reason: 'kind' });
});

test('helpers: isHevc, videoCodecOk, audioCodecOk', () => {
  assert.strictEqual(p.isHevc('hevc'), true);
  assert.strictEqual(p.isHevc('h265'), true);
  assert.strictEqual(p.isHevc('h264'), false);
  assert.strictEqual(p.isHevc(null), false);
  assert.strictEqual(p.videoCodecOk('hevc', 'hvc1'), true);
  assert.strictEqual(p.videoCodecOk('hevc', 'hev1'), false);
  assert.strictEqual(p.videoCodecOk('hevc', undefined), false);
  assert.strictEqual(p.videoCodecOk('h264', undefined), true);
  assert.strictEqual(p.videoCodecOk('', undefined), true);
  assert.strictEqual(p.audioCodecOk('pcm_s16be'), true);
  assert.strictEqual(p.audioCodecOk('wmav2'), false);
  assert.strictEqual(p.audioCodecOk(undefined), true);
});
