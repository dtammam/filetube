'use strict';

// [UNIT] v1.387.0 offline playback, plan D6 - the shared player plays the PHONE'S copy online: the pure decision
// resolveOfflineLocalSrc(id, data, offline) over the descriptor a view hands player.load (public/js/player.js), and the
// source seams it feeds: the local URL wins AFTER the streamSrc block, a local load reads a descriptor copy with
// needsTranscode cleared (no transcode fetch / poll), and the background-audio settings read is answered locally (no
// sidecar handoff). A 360 video and a book chapter never swap; a media id is tried as a video AND as a track.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveOfflineLocalSrc } = require('../../public/js/player.js');

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');

// A stub offline module: `held` maps "kind:id" -> localSrc; `asked` records every lookup.
function stub(held, enabled = true) {
  const asked = [];
  return {
    asked,
    api: {
      enabled,
      localSrcFor(kinds, id) {
        const list = Array.isArray(kinds) ? kinds : [kinds];
        asked.push([list.slice(), id]);
        for (const k of list) { if (held[k + ':' + id]) return held[k + ':' + id]; }
        return null;
      },
    },
  };
}

test('the kinds a descriptor maps to: tv (statusUrl), podcast (/episode/), track (/track/), a media item (video then track), a chapter row (the parent file behind /video/<base>)', () => {
  const s = stub({ 'tvEpisode:e1': 'L-tv', 'podcastEpisode:p1': 'L-pod', 'track:t1': 'L-track', 'video:v1': 'L-vid', 'track:m1': 'L-lib' });
  assert.strictEqual(resolveOfflineLocalSrc('e1', { type: 'video', statusUrl: '/api/tv/episode/e1', streamSrc: '/tvepisode/e1' }, s.api), 'L-tv');
  assert.strictEqual(resolveOfflineLocalSrc('p1', { type: 'audio', streamSrc: '/episode/p1' }, s.api), 'L-pod');
  assert.strictEqual(resolveOfflineLocalSrc('t1', { type: 'audio', streamSrc: '/track/t1' }, s.api), 'L-track');
  assert.strictEqual(resolveOfflineLocalSrc('v1', { type: 'video' }, s.api), 'L-vid', 'an ordinary video: no streamSrc, the id is the media id');
  assert.strictEqual(resolveOfflineLocalSrc('m1', { type: 'audio', streamSrc: '/video/m1' }, s.api), 'L-lib', 'library audio shown in Music is a TRACK to the phone');
  assert.strictEqual(resolveOfflineLocalSrc('m1::c2', { type: 'audio', streamSrc: '/video/m1', chapterStartSec: 30 }, s.api), 'L-lib', 'a chapter row plays its parent file\'s copy');
  assert.deepStrictEqual(s.asked[3], [['video', 'track'], 'v1'], 'a media id is tried as a video first, then as a track');
  assert.deepStrictEqual(s.asked[5], [['video', 'track'], 'm1'], 'the parent id, not the chapter row id');
  assert.strictEqual(resolveOfflineLocalSrc('x', { type: 'video' }, s.api), null, 'not on the phone');
});

test('never swapped: a 360 video (a cross-origin texture would taint the canvas), a book chapter, a missing or disabled module', () => {
  const s = stub({ 'video:v1': 'L', 'track:b1': 'L' });
  assert.strictEqual(resolveOfflineLocalSrc('v1', { type: 'video', projection: '360' }, s.api), null);
  assert.strictEqual(resolveOfflineLocalSrc('v1', { type: 'video', projection: 'equirect' }, s.api), null);
  assert.strictEqual(resolveOfflineLocalSrc('v1', { type: 'video', projection: 'flat' }, s.api), 'L', 'flat is an ordinary video');
  assert.strictEqual(resolveOfflineLocalSrc('v1', { type: 'video', projection: '' }, s.api), 'L');
  assert.strictEqual(resolveOfflineLocalSrc('b1', { type: 'audio', streamSrc: '/book/b1/tts/0' }, s.api), null, 'a book chapter is not an offline item');
  assert.strictEqual(s.asked.length, 2, 'the 360 and book cases never even ask the module');
  assert.strictEqual(resolveOfflineLocalSrc('v1', { type: 'video' }, stub({ 'video:v1': 'L' }, false).api), null, 'module disabled (no host)');
  assert.strictEqual(resolveOfflineLocalSrc('v1', { type: 'video' }, null), null);
  assert.strictEqual(resolveOfflineLocalSrc('v1', { type: 'video' }, {}), null);
  assert.strictEqual(resolveOfflineLocalSrc('v1', null, s.api), null);
});

test('source seams: the local URL is assigned AFTER the streamSrc block; a local load clears needsTranscode on its descriptor copy; the bg-audio settings read is answered locally', () => {
  const body = PLAYER_JS.slice(PLAYER_JS.indexOf('function setupForMedia(id, data) {'), PLAYER_JS.indexOf('setupMediaSession(id, data.channelName, data.title);'));
  assert.match(body, /var localSrc = resolveOfflineLocalSrc\(id, data, /, 'the decision is asked once per load');
  assert.match(body, /data = Object\.assign\(\{\}, data, \{ needsTranscode: false, transcodeStatus: 'ready' \}\);/, 'a local load never enters the transcode branch');
  assert.match(body, /if \(typeof data\.streamSrc === 'string' && data\.streamSrc\) \{\s*\n\s*streamUrl = data\.streamSrc;\s*\n\s*\}\s*\n\s*if \(localSrc\) streamUrl = localSrc;/, 'the phone\'s copy wins over every server URL, right after the streamSrc block');
  assert.match(body, /\(playingLocal \? Promise\.resolve\(null\) : fetch\('\/api\/settings'\)\)/, 'no settings fetch and no sidecar arm for a local play');
  assert.ok(body.indexOf('if (localSrc) streamUrl = localSrc;') < body.indexOf("if (data.needsTranscode) {"), 'the swap precedes the transcode branch');
});
