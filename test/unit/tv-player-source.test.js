'use strict';

// [UNIT] v1.196 TV player integration - Phase A2 source-locks. The shared player
// (public/js/player.js) drives a TV episode through the SAME load/poll path a
// video uses, keyed on the descriptor's `statusUrl` (present only for a tv
// source). These lock the load-bearing seams so a silent revert - which would
// leak a tv id onto the /api/videos or /video routes (that id is not in
// db.metadata) - fails here; the behavioural end-to-end bind lives in the watch
// ?tv= integration test (Phase A3). Comment-stripped (the comment-porous class).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLAYER = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');
const strip = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const SRC = strip(PLAYER);

test('A2: a video source may carry its own streamSrc (the audio-only gate is widened)', () => {
  // The override is no longer `data.type === 'audio' &&` gated - a tv video
  // carries streamSrc='/tvepisode/:id' and must use it, not '/video/:id'.
  assert.match(SRC, /if \(typeof data\.streamSrc === 'string' && data\.streamSrc\) \{\s*\n\s*streamUrl = data\.streamSrc;/);
  assert.doesNotMatch(SRC, /data\.type === 'audio' && typeof data\.streamSrc === 'string'/,
    'the old audio-only streamSrc gate is gone (a video source can opt in now)');
});

test('A2: desktop live-transcode is skipped for a tv source (no /video/:id?live=1 route for it)', () => {
  assert.match(SRC, /if \(!isMobileViewport\(\) && !data\.statusUrl\) \{\s*\n\s*liveMode = true;/,
    'a tv source (statusUrl present) never enters desktop liveMode');
});

test('A2: the transcode poll reads the descriptor URLs, so a tv poll never hits /api/videos or /video', () => {
  assert.match(SRC, /var statusUrl = \(currentData && currentData\.statusUrl\) \|\| \('\/api\/videos\/' \+ id\);/);
  assert.match(SRC, /var readySrc = \(currentData && currentData\.streamSrc\) \|\| \('\/video\/' \+ id\);/);
  assert.match(SRC, /fetch\(statusUrl\)/);
  assert.match(SRC, /mediaPlayer\.src = readySrc;/);
});

test('B: a tv source resumes from its descriptor progress (no extra fetch, no /api/progress) and saves via progressEndpoint', () => {
  // resumeMode 'tv' reads the descriptor's own progress (carried from
  // /api/tv/episode/:id) rather than fetching /api/progress/:id.
  assert.match(SRC, /if \(currentData && currentData\.resumeMode === 'tv'\) \{[\s\S]*?savedProgress = Number\(currentData\.progress\) \|\| 0;/);
  // the save routes through the descriptor's progressEndpoint (the tv descriptor
  // sets it to /api/tv/progress) - the one write site, like music/podcasts.
  assert.match(SRC, /var progressEndpoint = \(currentData && typeof currentData\.progressEndpoint === 'string' && currentData\.progressEndpoint\) \|\| '\/api\/progress';/);
});

test('v1.196.1: a mobile tv source resolves the mobileCustomPlayer setting + re-applies controls (era-themed bar, not the native strip)', () => {
  // The v1.196 regression: gating the mobile bg-audio block off for a tv source
  // (!data.statusUrl) also skipped the mobileCustomPlayer settings read + the
  // applyControlsMode re-run that live in it - so a mobile-fullscreen episode fell
  // to the native iOS strip. A tv-source standalone read restores the custom bar.
  assert.match(SRC, /if \(data\.type !== 'audio' && data\.statusUrl && isMobileFormFactor\(\)\) \{[\s\S]*?mobileCustomPlayerCached = !!\(settings && settings\.mobileCustomPlayer\);\s*\n\s*applyControlsMode\(\);/,
    'a tv source reads mobileCustomPlayer and re-derives the controls surface');
});

test('A2: a source with artUrl but no hasThumbnail (a tv episode) uses the show poster as the frame-one video poster', () => {
  assert.match(SRC, /else if \(typeof data\.artUrl === 'string' && data\.artUrl\) \{\s*\n\s*mediaPlayer\.poster = data\.artUrl;/);
});

test('A2: the /api/videos-only side effects (dimensions POST, subtitles, bg-audio) are all skipped for a tv source', () => {
  // dimensions POST guarded
  assert.match(SRC, /if \(!data\.statusUrl\) \{\s*\n\s*fetch\('\/api\/videos\/' \+ encodeURIComponent\(id\) \+ '\/dimensions'/);
  // subtitle track left inert (no /api/subtitles/:id for a tv id)
  assert.match(SRC, /ccTrack\.src = data\.statusUrl \? '' : '\/api\/subtitles\/' \+ id;/);
  // background-audio pre-warm excludes a tv source
  assert.match(SRC, /if \(data\.type !== 'audio' && !data\.statusUrl && isMobileFormFactor\(\) && bgAudioEl\)/);
});
