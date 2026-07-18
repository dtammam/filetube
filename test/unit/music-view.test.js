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

// ---- v1.44.2 (Spotify feel) -------------------------------------------------

test('v1.44.2: buildSongRowHtml carries the CSS equalizer glyph (3 bars, NEVER an emoji)', () => {
  const html = buildSongRowHtml({ id: 't3', title: 'Three', artist: 'A', album: 'X', durationSec: 60, liked: false }, 1);
  assert.match(html, /class="music-eq" aria-hidden="true"><i><\/i><i><\/i><i><\/i>/, 'three eq bars drawn in markup+CSS');
  // The eq must be pure markup — no emoji codepoint anywhere in a row (iOS
  // forces blue emoji; the type-scale/glyph lock forbids emoji glyphs).
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'no emoji codepoint in a song row');
});

test('v1.44.2 SOURCE-LOCK: loadTrack plays in the DOCK (not a FULL slot) and sets a /music dock-return', () => {
  assert.match(MUSIC_JS, /window\.FileTube\.player\.load\(item\.id, data, \{ dock: true \}\)/,
    'a tap must load into the docked mini-player, not a FULL #player-slot');
  assert.match(MUSIC_JS, /readerHref: '\/music'/, 'a music track carries a /music dock-return href (else the dock tap 404s on the video route)');
  assert.doesNotMatch(MUSIC_JS, /player-slot/, 'no FULL in-view player-slot mount remains for /music');
});

test('v1.44.2 SOURCE-LOCK: the playing-row highlight tracks the player id and re-applies after render + init', () => {
  assert.match(MUSIC_JS, /player\.currentId\) \|\| null/, 'playingId is seeded from the persistent player on init (survives the view swap)');
  assert.match(MUSIC_JS, /function applyPlayingHighlight/, 'a dedicated highlight pass exists');
  assert.match(MUSIC_JS, /classList\.toggle\('playing'/, 'it toggles .playing by matching data-id');
  // renderSongList re-applies it (a fresh list must re-highlight the playing row).
  const renderBody = MUSIC_JS.slice(MUSIC_JS.indexOf('function renderSongList'), MUSIC_JS.indexOf('function applyPlayingHighlight'));
  assert.match(renderBody, /applyPlayingHighlight\(\)/, 'renderSongList re-applies the highlight');
});
