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
  drillYear, drillAlbumCount, buildDrillHeaderHtml, buildStickyBarHtml, deriveNowPlayingLabel,
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

// ---- v1.44.2 collapsing drill header ---------------------------------------

test('v1.44.2: drillYear returns the MIN non-null Integer year (matches groupAlbums), null when none', () => {
  assert.strictEqual(drillYear([{ year: 2003 }, { year: 1999 }, { year: null }]), 1999);
  assert.strictEqual(drillYear([{ year: null }, { title: 'x' }]), null);
  assert.strictEqual(drillYear([{ year: 2020.5 }]), null, 'non-integer year ignored');
});

test('v1.44.2: drillAlbumCount counts distinct albums, blank as one bucket, __proto__-safe', () => {
  assert.strictEqual(drillAlbumCount([{ album: 'A' }, { album: 'A' }, { album: 'B' }]), 2);
  assert.strictEqual(drillAlbumCount([{ album: '' }, {}]), 1, 'blank/missing album = one bucket');
  assert.strictEqual(drillAlbumCount([{ album: '__proto__' }, { album: 'A' }]), 2, 'a "__proto__" album cannot poison the count');
});

test('v1.44.2: buildDrillHeaderHtml (album) shows art, escaped title/artist, year·count, Play+Shuffle+Back', () => {
  const tracks = [
    { id: 't1', album: 'Kid A', albumArtist: 'Radio"head', artist: 'x', year: 2000 },
    { id: 't2', album: 'Kid A', artist: 'x', year: 2000 },
  ];
  const html = buildDrillHeaderHtml({ type: 'album', label: 'Kid A' }, tracks);
  assert.match(html, /\/albumart\/t1/, 'art from the first track');
  assert.match(html, /music-drill-title[^>]*>Kid A</);
  assert.match(html, /Radio&quot;head/, 'albumArtist escaped + preferred over artist');
  assert.match(html, /2000 · 2 tracks/);
  assert.match(html, /music-drill-play/);
  assert.match(html, /music-drill-shuffle/);
  assert.match(html, /music-drill-back/);
});

test('v1.44.2: buildDrillHeaderHtml (artist) shows album·track counts, no artist subline', () => {
  const tracks = [{ id: 'a1', album: 'One', artist: 'Boards' }, { id: 'a2', album: 'Two', artist: 'Boards' }];
  const html = buildDrillHeaderHtml({ type: 'artist', label: 'Boards' }, tracks);
  assert.match(html, /2 albums · 2 tracks/);
  assert.doesNotMatch(html, /music-drill-artist/, 'artist drill has no artist subline');
});

test('v1.44.2: buildDrillHeaderHtml tolerates an empty track list (no throw, generic labels)', () => {
  const html = buildDrillHeaderHtml({ type: 'album', label: 'Empty' }, []);
  assert.match(html, /Empty/);
  assert.match(html, /0 tracks/);
});

test('v1.44.2: buildStickyBarHtml is the slim collapsed bar (thumb + escaped title + Back + Play)', () => {
  const html = buildStickyBarHtml({ type: 'album', label: 'A<b>' }, [{ id: 's1' }]);
  assert.match(html, /music-drill-sticky/);
  assert.match(html, /\/albumart\/s1/);
  assert.match(html, /A&lt;b&gt;/, 'title escaped');
  assert.match(html, /music-drill-back/);
  assert.match(html, /music-drill-play/);
});

test('v1.44.2 SOURCE-LOCK: the collapse observer is disconnected in destroy() AND before every re-render (SPA-swap leak guard)', () => {
  // destroy() must disconnect (leaving /music mid-drill can't leak an observer
  // on a detached sentinel).
  const destroyBody = MUSIC_JS.slice(MUSIC_JS.indexOf('function destroy'));
  assert.match(destroyBody, /disconnectStickyObserver\(\)/, 'destroy() disconnects the observer');
  // render() must disconnect before rebuilding #music-content (the old sentinel
  // is about to be orphaned).
  const renderBody = MUSIC_JS.slice(MUSIC_JS.indexOf('async function render'), MUSIC_JS.indexOf('interaction: drill-in'));
  assert.match(renderBody, /disconnectStickyObserver\(\)/, 'render() disconnects any prior observer');
  // The observer measures the fixed header (no per-frame scroll math).
  assert.match(MUSIC_JS, /new IntersectionObserver/, 'uses IntersectionObserver, not a scroll listener');
  assert.doesNotMatch(MUSIC_JS, /addEventListener\('scroll'/, 'no per-frame scroll handler for the collapse');
});

test('v1.44.2 SOURCE-LOCK: the playing-row highlight tracks the player id and re-applies after render + init', () => {
  assert.match(MUSIC_JS, /player\.currentId\) \|\| null/, 'playingId is seeded from the persistent player on init (survives the view swap)');
  assert.match(MUSIC_JS, /function applyPlayingHighlight/, 'a dedicated highlight pass exists');
  assert.match(MUSIC_JS, /classList\.toggle\('playing'/, 'it toggles .playing by matching data-id');
  // renderSongList re-applies it (a fresh list must re-highlight the playing row).
  const renderBody = MUSIC_JS.slice(MUSIC_JS.indexOf('function renderSongList'), MUSIC_JS.indexOf('function applyPlayingHighlight'));
  assert.match(renderBody, /applyPlayingHighlight\(\)/, 'renderSongList re-applies the highlight');
});

// ---- v1.44.2 "Playing from <Album>" line -----------------------------------

test('v1.44.2: deriveNowPlayingLabel shows the album only when the music track IS the current player item', () => {
  const np = { id: 't1', album: 'Kid A', albumKey: 'k' };
  assert.strictEqual(deriveNowPlayingLabel(np, 't1'), 'Playing from Kid A');
  assert.strictEqual(deriveNowPlayingLabel(np, 'other'), '', 'a different current id (a video/book playing) hides it');
  assert.strictEqual(deriveNowPlayingLabel(np, null), '', 'nothing playing -> hidden');
  assert.strictEqual(deriveNowPlayingLabel({ id: 't1', album: '' }, 't1'), '', 'no album -> hidden');
  assert.strictEqual(deriveNowPlayingLabel(null, 't1'), '', 'no now-playing record -> hidden');
});

test('v1.44.2 SOURCE-LOCK: the now-playing record is module-scoped (survives the SPA swap) and re-evaluated on render', () => {
  // Module-scoped (declared in the IIFE, not init) so a nav BACK re-derives it.
  assert.match(MUSIC_JS, /\/\/ v1\.44\.2:[^]*?var nowPlaying = null;/, 'nowPlaying is module-scoped');
  assert.match(MUSIC_JS, /updateNowPlaying\(\)/, 'render/loadTrack refresh the line');
  // It must cross-check the live player id (not just trust the stale record).
  assert.match(MUSIC_JS, /deriveNowPlayingLabel\(nowPlaying, currentId\)/, 'the DOM update consults the live player currentId');
});

test('v1.44.2 SOURCE-LOCK (gate S1/W1): closing the player clears the stale row highlight + "Playing from" line, bound LAZILY', () => {
  // The dock × (close) doesn't notify the view; music.js listens on the shared
  // media element's `emptied` and clears ONLY when nothing ended up loaded
  // (deferred a frame so a new load's teardown doesn't spuriously clear).
  assert.match(MUSIC_JS, /addEventListener\('emptied'/, 'listens for the media element emptying (a close/teardown)');
  assert.match(MUSIC_JS, /requestAnimationFrame/, 'defers one frame so a load-transition teardown does not clear');
  const emptiedBody = MUSIC_JS.slice(MUSIC_JS.indexOf("addEventListener('emptied'"));
  assert.match(emptiedBody.slice(0, 400), /if \(!cur\) \{ playingId = null; nowPlaying = null;/, 'clears both indicators only when nothing is loaded');
  // Gate W1: #media-player lives in a <template> until the first play, so the
  // bind is lazy + guard-once, retried after loadTrack's player.load (which
  // clones the host). Binding only at init would miss the cold /music path.
  assert.match(MUSIC_JS, /function ensureEmptiedListener/, 'the bind is a guard-once helper (not a one-shot at init)');
  const loadTrackBody = MUSIC_JS.slice(MUSIC_JS.indexOf('function loadTrack'), MUSIC_JS.indexOf('function prewarmThenLoad'));
  assert.match(loadTrackBody, /ensureEmptiedListener\(\)/, 'loadTrack re-attempts the bind after the host is cloned (cold-first-play path)');
});
