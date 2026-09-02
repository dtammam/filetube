'use strict';

// [UNIT] v1.246 (Dean): audio-only items ALWAYS open in the mobile music player/skin
// (/music?play=), never the video /watch page - EVERYWHERE (grid / channel / search /
// continue-watching; the server mirrors it for notifications). The v1.236 opt-out toggle is
// RETIRED (Dean's directive: "all non-video audio + podcasts open in the skin"; v1.242 already
// projected every audio-only item into Music, so the destination now matches unconditionally).
// Videos are untouched; a non-media kind (podcast/track/book/tv) keeps its own destination.
// Chaptered audio routes to `::c0` so it opens as an album; a non-resolvable id bounces to
// /watch (music.js graceful miss path). Binds the pure href helper + the row/feed/grid wiring,
// the /watch fallback, AND that the retired setting leaves no lying control behind.
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

test('musicHrefForItem: an audio item -> /music?play=<id> (unconditional)', () => {
  assert.strictEqual(main.musicHrefForItem({ id: 'a1', type: 'audio' }), '/music?play=a1&ao=1');
});

test('musicHrefForItem: a CHAPTERED audio item -> /music?play=<id>::c0 (opens the album)', () => {
  const href = main.musicHrefForItem({ id: 'a2', type: 'audio', chapters: [{ startTime: 0 }, { startTime: 60 }] });
  assert.strictEqual(href, '/music?play=' + encodeURIComponent('a2::c0') + '&ao=1');
});

test('musicHrefForItem: a 0/1-chapter audio item is NOT treated as chaptered (base id)', () => {
  assert.strictEqual(main.musicHrefForItem({ id: 'a3', type: 'audio', chapters: [{ startTime: 0 }] }), '/music?play=a3&ao=1');
});

test('musicHrefForItem: a VIDEO item -> null (never rerouted; video stays /watch)', () => {
  assert.strictEqual(main.musicHrefForItem({ id: 'v1', type: 'video' }), null);
  assert.strictEqual(main.musicHrefForItem({ id: 'v2' }), null, 'absent type is not audio');
});

test('v1.246: the RETIRED opt-out no longer gates it - a stored ft-open-audio-in-music=0 is IGNORED (audio still routes)', () => {
  // The old flag-off behaviour (return null) is gone: a device that had disabled the toggle
  // (Dean hit exactly this - search opened the legacy player) now still opens the skin.
  withLocalStorage({ 'ft-open-audio-in-music': '0' }, () => {
    assert.strictEqual(main.musicHrefForItem({ id: 'a1', type: 'audio' }), '/music?play=a1&ao=1', 'the stale opt-out is ignored');
    assert.strictEqual(main.musicHrefForItem({ id: 'a2', type: 'audio', chapters: [{ startTime: 0 }, { startTime: 9 }] }), '/music?play=' + encodeURIComponent('a2::c0') + '&ao=1');
  });
});

test('buildVideoRowCardHtml (continue-watching / video-home rows): an AUDIO row taps into the music player, a video stays /watch', () => {
  const audio = main.buildVideoRowCardHtml({ id: 'a9', type: 'audio', title: 'Song', progressPercent: 20 });
  assert.match(audio, /href="\/music\?play=a9&ao=1"/, 'audio row -> /music?play=');
  const video = main.buildVideoRowCardHtml({ id: 'v9', type: 'video', title: 'Clip', progressPercent: 20 });
  assert.match(video, /href="\/watch\.html\?v=v9"/, 'video row -> /watch (unchanged)');
  // even with the stale opt-out stored, the audio row still routes to the skin now.
  withLocalStorage({ 'ft-open-audio-in-music': '0' }, () => {
    assert.match(main.buildVideoRowCardHtml({ id: 'a9', type: 'audio', title: 'Song', progressPercent: 0 }), /href="\/music\?play=a9&ao=1"/);
  });
});

// ---- source locks (the grid card wiring + the music-view /watch fallback) --------------
test('the grid card (buildCardHtml) routes an audio tile through musicHrefForItem', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');
  assert.match(src, /const watchHref = musicHrefForItem\(item\) \|\|/, 'buildCardHtml overrides ONLY the href via musicHrefForItem');
});

test('the music view BOUNCES a non-resolvable ?play= id to /watch (no dead end) with the ::c suffix stripped', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  const m = /async function playTrackFromContinue\(trackId, bounceOnMiss\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(m, 'playTrackFromContinue exists');
  const body = m[1];
  assert.match(body, /replace\(\/::c\\d\+\$\/, ''\)/, 'strips the ::c chapter suffix to the base media id');
  assert.match(body, /location\.replace\('\/watch\.html\?v=' \+ encodeURIComponent\(bounceId\)\)/, 'bounces a resolve-miss to /watch');
  assert.match(body, /if \(bounceOnMiss\)/, 'the bounce is gated on the reroute-origin flag (W1: a legacy continue card keeps render() on a miss)');
});

test('v1.246: the opt-out toggle is RETIRED - no lying control (gone from setup.html AND setup.js, and musicHrefForItem no longer reads the key)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
  assert.doesNotMatch(html, /id="open-audio-in-music-check"/, 'the checkbox is removed from the Settings page');
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8');
  assert.doesNotMatch(setup, /open-audio-in-music-check|ft-open-audio-in-music/, 'setup.js no longer wires the retired toggle');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');
  assert.doesNotMatch(src, /ft-open-audio-in-music|OPEN_AUDIO_IN_MUSIC_KEY/, 'musicHrefForItem no longer gates on the retired key');
});

test('gate C1: a non-media kind that carries type:audio is NOT hijacked (podcast/book/tv keep their own destination)', () => {
  assert.strictEqual(main.musicHrefForItem({ id: 'ep1', kind: 'podcast', type: 'audio' }), null, 'a downloaded podcast episode is never rerouted to /music');
  assert.strictEqual(main.musicHrefForItem({ id: 'b1', kind: 'book', type: 'audio' }), null);
  assert.strictEqual(main.musicHrefForItem({ id: 'tv1', kind: 'tv', type: 'audio' }), null);
  // media-kind (and kind-absent, the /api/videos shape) audio DO reroute:
  assert.strictEqual(main.musicHrefForItem({ id: 'm1', kind: 'media', type: 'audio' }), '/music?play=m1&ao=1');
  assert.strictEqual(main.musicHrefForItem({ id: 'm2', type: 'audio' }), '/music?play=m2&ao=1', 'kind absent (older payloads) still routes');
});

test('gate C1/fold: the home-feed chapterCount signal routes a chaptered download to ::c0 (no chapters array needed)', () => {
  assert.strictEqual(main.musicHrefForItem({ id: 'f1', kind: 'media', type: 'audio', chapterCount: 5 }), '/music?play=' + encodeURIComponent('f1::c0') + '&ao=1');
  assert.strictEqual(main.musicHrefForItem({ id: 'f2', kind: 'media', type: 'audio', chapterCount: 1 }), '/music?play=f2&ao=1', '1 chapter is not an album');
});

test('the HOME-FEED card (buildFeedCardHtml) reroutes an audio download too (server-fold consumer, not inert)', () => {
  // audio (media) -> music; escapeBookRowHtml turns &ao=1 into &amp;ao=1 (browser decodes it back).
  const audio = main.buildFeedCardHtml({ id: 'x1', kind: 'media', type: 'audio', href: '/watch.html?v=x1', thumbnailUrl: '/thumbnail/x1', title: 'Song', subtitle: 'Chan' });
  assert.match(audio, /href="\/music\?play=x1&amp;ao=1"/, 'a home-feed audio card taps into the music player');
  // chaptered via the server-fold chapterCount signal -> the album's ::c0 track
  const chap = main.buildFeedCardHtml({ id: 'x1', kind: 'media', type: 'audio', chapterCount: 3, href: '/watch.html?v=x1', thumbnailUrl: '/thumbnail/x1', title: 'Album', subtitle: 'Chan' });
  assert.match(chap, /href="\/music\?play=x1%3A%3Ac0&amp;ao=1"/, 'a chaptered home-feed card opens the album (::c0)');
  // a video keeps the server /watch href; a podcast keeps its own destination (C1 at the feed surface)
  assert.match(main.buildFeedCardHtml({ id: 'v1', kind: 'media', type: 'video', href: '/watch.html?v=v1', thumbnailUrl: '/thumbnail/v1', title: 'Clip' }), /href="\/watch\.html\?v=v1"/);
  assert.match(main.buildFeedCardHtml({ id: 'p1', kind: 'podcast', type: 'audio', href: '/podcasts?play=p1', thumbnailUrl: '/podcastart/s1', title: 'Ep' }), /href="\/podcasts\?play=p1"/, 'a podcast in the feed is not hijacked');
});
