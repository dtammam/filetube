'use strict';

// [UNIT] v1.236 (Dean): "Open downloaded music in the music player" - a device-local flag
// (default ON) that reroutes AUDIO-only tiles to the native music player (/music?play=)
// instead of the video /watch page, EVERYWHERE. Videos are untouched. Chaptered audio routes
// to `::c0` so it opens as an album. Bound to the Music library: a non-resolvable id bounces
// to /watch (music.js graceful miss path). This binds the pure href helper + the row builder +
// source-locks the grid card wiring, the flag mechanism, and the /watch fallback.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));

const { test } = require('node:test');
const assert = require('node:assert');
const main = require('../../public/js/main.js');
global.resolveChannelName = require('../../public/js/common.js').resolveChannelName;

function withLocalStorage(map, fn) {
  const saved = global.localStorage;
  global.localStorage = { getItem: (k) => (k in map ? map[k] : null), setItem() {}, removeItem() {} };
  try { return fn(); } finally { global.localStorage = saved; }
}

test('musicHrefForItem: an audio item -> /music?play=<id> (flag default ON, no localStorage)', () => {
  assert.strictEqual(main.musicHrefForItem({ id: 'a1', type: 'audio' }), '/music?play=a1');
});

test('musicHrefForItem: a CHAPTERED audio item -> /music?play=<id>::c0 (opens the album)', () => {
  const href = main.musicHrefForItem({ id: 'a2', type: 'audio', chapters: [{ startTime: 0 }, { startTime: 60 }] });
  assert.strictEqual(href, '/music?play=' + encodeURIComponent('a2::c0'));
});

test('musicHrefForItem: a 0/1-chapter audio item is NOT treated as chaptered (base id)', () => {
  assert.strictEqual(main.musicHrefForItem({ id: 'a3', type: 'audio', chapters: [{ startTime: 0 }] }), '/music?play=a3');
});

test('musicHrefForItem: a VIDEO item -> null (never rerouted; video stays /watch)', () => {
  assert.strictEqual(main.musicHrefForItem({ id: 'v1', type: 'video' }), null);
  assert.strictEqual(main.musicHrefForItem({ id: 'v2' }), null, 'absent type is not audio');
});

test('musicHrefForItem: flag OFF -> null everywhere (restores /watch)', () => {
  withLocalStorage({ 'ft-open-audio-in-music': '0' }, () => {
    assert.strictEqual(main.musicHrefForItem({ id: 'a1', type: 'audio' }), null);
    assert.strictEqual(main.musicHrefForItem({ id: 'a2', type: 'audio', chapters: [{ startTime: 0 }, { startTime: 9 }] }), null);
  });
});

test('musicHrefForItem: flag explicitly ON (localStorage absent/1) -> reroutes', () => {
  withLocalStorage({ 'ft-open-audio-in-music': '1' }, () => {
    assert.strictEqual(main.musicHrefForItem({ id: 'a1', type: 'audio' }), '/music?play=a1');
  });
});

test('buildVideoRowCardHtml (continue-watching / video-home rows): an AUDIO row taps into the music player', () => {
  const audio = main.buildVideoRowCardHtml({ id: 'a9', type: 'audio', title: 'Song', progressPercent: 20 });
  assert.match(audio, /href="\/music\?play=a9"/, 'audio row -> /music?play=');
  const video = main.buildVideoRowCardHtml({ id: 'v9', type: 'video', title: 'Clip', progressPercent: 20 });
  assert.match(video, /href="\/watch\.html\?v=v9"/, 'video row -> /watch (unchanged)');
});

test('buildVideoRowCardHtml: flag OFF -> even an audio row stays /watch', () => {
  withLocalStorage({ 'ft-open-audio-in-music': '0' }, () => {
    const audio = main.buildVideoRowCardHtml({ id: 'a9', type: 'audio', title: 'Song', progressPercent: 0 });
    assert.match(audio, /href="\/watch\.html\?v=a9"/, 'flag off -> /watch');
  });
});

// ---- source locks (the grid card wiring + the music-view /watch fallback) --------------
test('the grid card (buildCardHtml) routes an audio tile through musicHrefForItem', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');
  assert.match(src, /const watchHref = musicHrefForItem\(item\) \|\|/, 'buildCardHtml overrides ONLY the href via musicHrefForItem');
});

test('the music view BOUNCES a non-resolvable ?play= id to /watch (no dead end) with the ::c suffix stripped', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  const m = /async function playTrackFromContinue\(trackId\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(m, 'playTrackFromContinue exists');
  const body = m[1];
  assert.match(body, /replace\(\/::c\\d\+\$\/, ''\)/, 'strips the ::c chapter suffix to the base media id');
  assert.match(body, /location\.replace\('\/watch\.html\?v=' \+ encodeURIComponent\(bounceId\)\)/, 'bounces a resolve-miss to /watch');
});

test('the Settings toggle is present AND wired (not an inert checkbox) to the ft-open-audio-in-music key', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
  assert.match(html, /id="open-audio-in-music-check"/, 'the checkbox exists in the Settings page');
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8');
  assert.match(setup, /loadHomeRowControl\('open-audio-in-music-check', 'ft-open-audio-in-music'\)/, 'reflect-on-load (default ON)');
  assert.match(setup, /wireHomeRowToggle\('open-audio-in-music-check', 'ft-open-audio-in-music'/, 'persists the toggle to the key musicHrefForItem reads');
});
