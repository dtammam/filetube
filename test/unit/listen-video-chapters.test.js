'use strict';

// [UNIT] v1.280 (Dean): a VIDEO (mp4) with chapters, played via the Listen button, now
// expands into one `::c` track per chapter in the music skins - the SAME shape a chaptered
// library-audio album uses - so Pocket Classic / Seattle show ALL the chapters (a tap jumps
// to one, Loop chapter works), instead of collapsing to a single track. buildListenChapterTracks
// is the pure expansion (parity with lib/music/libraryAudio expandAudioToTracks); the wiring
// (playListenItem uses it; watchBackTap strips ::c for the watch page) is source-locked.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const music = require('../../public/js/music.js');
const { buildListenChapterTracks } = music;
const MUSIC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');

const VID = {
  id: 'vid1', title: 'Big Talk', duration: 300, channelName: 'The Channel',
  chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 120, title: 'Middle' }, { startTime: 240, title: 'End' }],
};

// ---- the pure expansion --------------------------------------------------------------

test('a chaptered listen-video expands into one library-chapter ::c track per chapter (all shown, streaming the ONE file)', () => {
  const out = buildListenChapterTracks(VID);
  assert.strictEqual(out.length, 3, 'all three chapters become tracks');
  assert.deepStrictEqual(out.map((t) => t.id), ['vid1::c0', 'vid1::c1', 'vid1::c2'], '::c<idx> ids off the base video id');
  assert.deepStrictEqual(out.map((t) => t.title), ['Intro', 'Middle', 'End'], 'chapter titles');
  for (const t of out) {
    assert.strictEqual(t.source, 'library-chapter', 'the existing chapter machinery keys on this source');
    assert.strictEqual(t.listen, true, 'each chapter is a listen track (Watch way-back, listen semantics)');
    assert.strictEqual(t.streamSrc, '/video/vid1', 'every chapter streams the ONE video file');
    assert.strictEqual(t.albumKey, 'vid1', 'one album key folds the chapters together');
    assert.strictEqual(t.album, 'Big Talk', 'the file title is the album');
  }
  assert.deepStrictEqual(out.map((t) => t.chapterStartSec), [0, 120, 240], 'chapterStartSec = each chapter start (the seek offset)');
  assert.deepStrictEqual(out.map((t) => t.durationSec), [120, 120, 60], 'durationSec = span to the next start (last -> file end)');
});

test('a 0-1 chapter video returns null (the caller keeps the single listen track - never a bogus album)', () => {
  assert.strictEqual(buildListenChapterTracks({ id: 'v', chapters: [{ startTime: 0, title: 'x' }] }), null, 'one chapter is not an album');
  assert.strictEqual(buildListenChapterTracks({ id: 'v', chapters: [] }), null);
  assert.strictEqual(buildListenChapterTracks({ id: 'v' }), null, 'no chapters field');
  assert.strictEqual(buildListenChapterTracks(null), null, 'null-safe');
});

test('a chapter with a garbage/negative startTime is skipped; falls to a single track if fewer than 2 survive', () => {
  const out = buildListenChapterTracks({ id: 'v', duration: 100, chapters: [{ startTime: 0, title: 'A' }, { startTime: -5, title: 'bad' }, { startTime: 'x', title: 'bad2' }, { startTime: 50, title: 'B' }] });
  assert.deepStrictEqual(out.map((t) => t.title), ['A', 'B'], 'only the two valid chapters survive');
  assert.strictEqual(buildListenChapterTracks({ id: 'v', duration: 100, chapters: [{ startTime: 0, title: 'A' }, { startTime: -5 }] }), null, 'one valid -> null');
});

// ---- the wiring (source-locked) ------------------------------------------------------

test('playListenItem uses the shared expansion (chaptered video -> chapter queue) and watchBackTap strips ::c for the watch page', () => {
  assert.match(MUSIC, /const chapterTracks = buildListenChapterTracks\(v\);/, 'playListenItem builds the chapter tracks from the fetched video');
  assert.match(MUSIC, /queue = chapterTracks \|\| \[t\];/, 'the chapter queue replaces the single track when the video is chaptered');
  // watchBackTap: a chapter id can never reach the watch page as `::c` - strip to the base video id.
  const wb = /function watchBackTap\(\) \{([\s\S]*?)\n {4}\}/.exec(MUSIC);
  assert.ok(wb, 'watchBackTap exists');
  assert.match(wb[1], /replace\(\/::c\\d\+\$\/, ''\)/, 'strips the ::c chapter suffix to the base video id');
  assert.match(wb[1], /\/watch\.html\?v=' \+ encodeURIComponent\(base\)/, 'navigates to the BASE video id');
});
