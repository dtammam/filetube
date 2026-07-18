'use strict';

// [UNIT] v1.44 T9 — public/js/music.js pure card/row builders (DOM-free, the
// books.js testing posture). Escaping + shape only; the interaction wiring is
// validated on-device.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  escapeMusicHtml, formatTrackDuration, buildAlbumCardHtml, buildArtistCardHtml, buildSongRowHtml,
} = require('../../public/js/music.js');

const MUSIC_JS = fs.readFileSync(path.join(__dirname, '../../public/js/music.js'), 'utf8');

test('v1.44.1 SOURCE-LOCK (Bug B): albums/artists are fetched with an explicit high limit (the endpoints default-cap at 60)', () => {
  assert.match(MUSIC_JS, /\/api\/music\/albums\?limit=10000/, 'albums fetch must pass a high limit or only ~60 show');
  assert.match(MUSIC_JS, /\/api\/music\/artists\?limit=10000/, 'artists fetch must pass a high limit');
});

test('v1.44.1 SOURCE-LOCK (Bug A): a Continue-listening tap plays the TAPPED track from the recent list, not the resume pointer\'s last track', () => {
  // The fixed handler resolves the play id from the recent-listening queue and
  // never falls back to the pointer's lastTrackId (which caused the wrong-song bug).
  assert.match(MUSIC_JS, /playTrackFromContinue/, 'the continue-listening handler exists');
  assert.match(MUSIC_JS, /filter=recent-listening&limit=200/, 'it builds the queue from the recent-listening list');
  assert.doesNotMatch(MUSIC_JS, /st\.lastTrackId/, 'it must NOT fall back to the pointer last track (the wrong-song bug)');
});

test('T9: escapeMusicHtml neutralizes markup; null/undefined -> empty', () => {
  assert.equal(escapeMusicHtml('<b>&"\''), '&lt;b&gt;&amp;&quot;&#039;');
  assert.equal(escapeMusicHtml(null), '');
  assert.equal(escapeMusicHtml(undefined), '');
});

test('T9: formatTrackDuration renders m:ss / h:mm:ss; empty for zero/NaN', () => {
  assert.equal(formatTrackDuration(0), '');
  assert.equal(formatTrackDuration(NaN), '');
  assert.equal(formatTrackDuration(65), '1:05');
  assert.equal(formatTrackDuration(200), '3:20');
  assert.equal(formatTrackDuration(3725), '1:02:05');
});

test('T9: buildAlbumCardHtml carries album key + escaped title/artist + art src', () => {
  const html = buildAlbumCardHtml({ albumKey: 'k1', album: 'The <Wall>', artist: 'Pink Floyd', artId: 'abc', trackCount: 2 });
  assert.match(html, /data-album-key="k1"/);
  assert.match(html, /src="\/albumart\/abc"/);
  assert.match(html, /The &lt;Wall&gt;/, 'album title escaped');
  assert.match(html, /2 tracks/);
});

test('T9: buildArtistCardHtml carries the artist + escaped counts', () => {
  const html = buildArtistCardHtml({ artist: 'A & B', albumCount: 1, trackCount: 3 });
  assert.match(html, /data-artist="A &amp; B"/);
  assert.match(html, /1 album/);
  assert.match(html, /3 tracks/);
});

test('T9: buildSongRowHtml carries the index + id, escaped title, duration, and a like toggle', () => {
  const html = buildSongRowHtml({ id: 't1', title: 'Song "One"', artist: 'A', album: 'X', durationSec: 200, liked: true }, 4);
  assert.match(html, /data-index="4"/);
  assert.match(html, /data-id="t1"/);
  assert.match(html, /Song &quot;One&quot;/, 'title escaped');
  assert.match(html, /3:20/, 'duration formatted');
  assert.match(html, /music-like-btn liked/, 'liked state reflected');
  assert.match(html, /icon-heart/, 'single heart mask (no -filled variant)');
});

test('T9: buildSongRowHtml unliked has no liked class', () => {
  const html = buildSongRowHtml({ id: 't2', title: 'Two', artist: '', album: '', durationSec: 0, liked: false }, 0);
  assert.doesNotMatch(html, /music-like-btn liked/);
  assert.doesNotMatch(html, /music-song-duration">[^<]+</, 'zero duration -> empty duration cell');
});
