'use strict';

// [UNIT] v1.44 T9 — public/js/music.js pure card/row builders (DOM-free, the
// books.js testing posture). Escaping + shape only; the interaction wiring is
// validated on-device.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
// v1.251 (R2): buildNowPlayingPanelHtml delegates to the shared engine builder now -
// supply it the CJS way (skin-surface's IIFE is window-gated, so this require is DOM-safe).
global.FileTubeSkinSurface = require('../../public/js/skin-surface.js');
const {
  escapeMusicHtml, formatTrackDuration, buildAlbumCardHtml, buildArtistCardHtml, buildArtistListRowHtml, buildJumpBackTileHtml, buildMusicShelfHtml, buildRecentArtistTileHtml, buildSongRowHtml,
  drillYear, drillAlbumCount, buildDrillHeaderHtml, buildStickyBarHtml, deriveNowPlayingLabel,
  buildNowPlayingPanelHtml,
  MUSIC_SORTS, MUSIC_SORT_DEFAULTS, normalizeMusicSort,
} = require('../../public/js/music.js');

// v1.102 (tranche 4): the song-row action glyphs render via window.chromeIconMarkup
// (common.js). common.js must be required with `window` still UNDEFINED (else its
// window-gated boot runs and touches `document`), so grab the export FIRST, then
// define the global - buildSongRowHtml reads window at call time, so the browser's
// real inline chrome-icon svg is what these assertions see.
const { chromeIconMarkup: chromeIconMarkupFn } = require('../../public/js/common.js');
global.window = global.window || {};
global.window.chromeIconMarkup = chromeIconMarkupFn;

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

test('v1.103 (no dead option): each client sort binds to the RIGHT server fn - songs->sortTracks, grids->sortGroups', () => {
  // The client menu must never offer a sort the server silently ignores. A grid
  // tab (albums/artists) is served by sortGroups, songs by sortTracks - and the
  // two handle DIFFERENT key sets, so binding grid keys to sortTracks (or vice
  // versa) would let a key that falls to the OTHER fn's default slip through
  // (gate ADV-SUGGESTION 3). Scrape each function's own `case` labels.
  const QUERY_JS = fs.readFileSync(path.join(__dirname, '../../lib/music/query.js'), 'utf8');
  const fnBody = (name) => {
    const start = QUERY_JS.indexOf('function ' + name);
    assert.ok(start >= 0, `query.js defines ${name}`);
    const after = QUERY_JS.indexOf('\nfunction ', start + 1);
    return QUERY_JS.slice(start, after === -1 ? undefined : after);
  };
  const casesIn = (body) => new Set([...body.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]));
  const trackKeys = casesIn(fnBody('sortTracks'));
  const gridKeys = casesIn(fnBody('sortGroups'));
  // songs + drill are served by sortTracks (a drill loads its song list via
  // loadSongs); albums/artists grids by sortGroups.
  const handlerFor = { songs: trackKeys, drill: trackKeys, albums: gridKeys, artists: gridKeys };
  for (const tab of Object.keys(MUSIC_SORTS)) {
    for (const opt of MUSIC_SORTS[tab]) {
      assert.ok(handlerFor[tab].has(opt.value), `client sort "${opt.value}" (${tab}) has no case in ${handlerFor[tab] === trackKeys ? 'sortTracks' : 'sortGroups'}`);
      assert.ok(opt.label && opt.label.length, `sort "${opt.value}" needs a label`);
    }
  }
  // Each per-tab default must be one of that tab's offered values.
  for (const tab of ['songs', 'albums', 'artists']) {
    assert.ok(MUSIC_SORTS[tab].some((o) => o.value === MUSIC_SORT_DEFAULTS[tab]), `${tab} default is an offered value`);
  }
  // The drill defaults (artist -> release date, album -> album order) are drill options.
  for (const k of ['drill-artist', 'drill-album']) {
    assert.ok(MUSIC_SORTS.drill.some((o) => o.value === MUSIC_SORT_DEFAULTS[k]), `${k} default is an offered drill value`);
  }
});

test('v1.103: normalizeMusicSort keeps a valid per-tab key, falls back to the tab default otherwise', () => {
  assert.equal(normalizeMusicSort('albums', 'year-desc'), 'year-desc', 'valid album key kept');
  assert.equal(normalizeMusicSort('artists', 'tracks-desc'), 'tracks-desc', 'valid artist key kept');
  // duration-desc is a SONGS key - invalid on the albums tab -> album default.
  assert.equal(normalizeMusicSort('albums', 'duration-desc'), MUSIC_SORT_DEFAULTS.albums);
  // year-desc is an ALBUMS key - invalid on artists -> artist default.
  assert.equal(normalizeMusicSort('artists', 'year-desc'), MUSIC_SORT_DEFAULTS.artists);
  assert.equal(normalizeMusicSort('songs', undefined), MUSIC_SORT_DEFAULTS.songs, 'undefined -> default');
  assert.equal(normalizeMusicSort('songs', 'garbage'), MUSIC_SORT_DEFAULTS.songs, 'unknown -> default');
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

// v1.103: the artist card is a mosaic of album art (up to 4 tiles).
function tileCount(html) { return (html.match(/<img /g) || []).length; }

test('v1.103: buildArtistCardHtml renders a mosaic - one art-shimmer tile per artId, capped at 4, data-tiles matches', () => {
  const four = buildArtistCardHtml({ artist: 'Q', albumCount: 4, trackCount: 40, artIds: ['a', 'b', 'c', 'd'] });
  assert.match(four, /class="music-artist-mosaic" data-tiles="4"/);
  assert.equal(tileCount(four), 4, 'four tiles');
  assert.match(four, /src="\/albumart\/a"/);
  assert.match(four, /src="\/albumart\/d"/);
  assert.ok((four.match(/art-shimmer/g) || []).length === 4, 'every tile ships art-shimmer (reveal-once both axes)');

  // A server can only ever send 4, but the client also hard-caps (defence in depth).
  const capped = buildArtistCardHtml({ artist: 'Q', artIds: ['a', 'b', 'c', 'd', 'e', 'f'] });
  assert.match(capped, /data-tiles="4"/);
  assert.equal(tileCount(capped), 4);
});

test('v1.103: mosaic reflows for sparse artists - 1/2/3 tiles set data-tiles so CSS fills the square', () => {
  assert.match(buildArtistCardHtml({ artist: 'One', artIds: ['x'] }), /data-tiles="1"/);
  assert.match(buildArtistCardHtml({ artist: 'Two', artIds: ['x', 'y'] }), /data-tiles="2"/);
  assert.match(buildArtistCardHtml({ artist: 'Three', artIds: ['x', 'y', 'z'] }), /data-tiles="3"/);
});

test('v1.103: an artist with NO art still renders one placeholder tile (never a blank card)', () => {
  const none = buildArtistCardHtml({ artist: 'Bare', albumCount: 1, trackCount: 1, artIds: [] });
  assert.match(none, /data-tiles="1"/, 'one tile reserved');
  assert.equal(tileCount(none), 1);
  assert.match(none, /src="\/albumart\/"/, 'empty id -> /albumart/ (404s, but the img error still clears the shimmer - never a blank card)');
  // Missing artIds entirely (older cached payload) behaves the same.
  assert.match(buildArtistCardHtml({ artist: 'Bare' }), /data-tiles="1"/);
});

test('redesign S1: an artist WITH a channel avatar renders a round circle (avatar over a monogram), not the mosaic', () => {
  const html = buildArtistCardHtml({ artist: 'NESTALGIA', albumCount: 1, trackCount: 352, avatarUrl: 'https://yt3.example/n.jpg', artIds: ['x'] });
  assert.match(html, /class="music-artist-avatar"/, 'the round avatar circle');
  assert.match(html, /class="maa-img" src="https:\/\/yt3\.example\/n\.jpg"/, 'the channel avatar image');
  assert.match(html, /class="maa-mono">N</, 'the uppercased first-letter monogram behind it');
  assert.doesNotMatch(html, /music-artist-mosaic/, 'the mosaic is NOT rendered when there is an avatar');
});

test('redesign S1: an artist WITHOUT an avatar still falls back to the mosaic (native-album artist)', () => {
  const html = buildArtistCardHtml({ artist: 'Pink Floyd', albumCount: 2, trackCount: 20, avatarUrl: '', artIds: ['a', 'b'] });
  assert.match(html, /class="music-artist-mosaic" data-tiles="2"/, 'no avatar -> the album-art mosaic');
  assert.doesNotMatch(html, /music-artist-avatar/, 'no round circle without an avatar');
});

test('friction: buildRecentArtistTileHtml renders a round drillable artist tile (art + name, no meta)', () => {
  const html = buildRecentArtistTileHtml({ id: 'trk7', artist: 'NESTALGIA' });
  assert.match(html, /class="music-artist-card" data-artist="NESTALGIA"/, 'drills into the artist (same delegation)');
  assert.match(html, /class="music-artist-mosaic" data-tiles="1"><img class="art-shimmer" src="\/albumart\/trk7"/, 'a full-bleed round album-art circle from the track');
  assert.match(html, />NESTALGIA</, 'the artist name');
  assert.doesNotMatch(html, /music-artist-meta/, 'no album/track meta on a recently-played tile');
});

test('friction: buildArtistListRowHtml renders a compact drillable row (avatar circle, name, count)', () => {
  const withAvatar = buildArtistListRowHtml({ artist: 'NESTALGIA', trackCount: 352, avatarUrl: 'https://yt3.example/n.jpg', artIds: ['x'] });
  assert.match(withAvatar, /class="music-artist-row" data-artist="NESTALGIA"/, 'a drillable row (same data-artist the card uses)');
  assert.match(withAvatar, /class="maa-img" src="https:\/\/yt3\.example\/n\.jpg"/, 'the channel avatar in the row circle');
  assert.match(withAvatar, />NESTALGIA</, 'the name');
  assert.match(withAvatar, />352 songs</, 'the song count');
  // A native/ripped artist (no avatar) uses its album art in the circle.
  const native = buildArtistListRowHtml({ artist: 'Pink Floyd', trackCount: 1, avatarUrl: '', artIds: ['a1'] });
  assert.match(native, /class="art-shimmer" src="\/albumart\/a1"/, 'no avatar -> album art fills the row circle');
  assert.match(native, />1 song</, 'singular count');
});

test('redesign: buildMusicShelfHtml renders a titled shelf with a See-all + a horizontal row', () => {
  const html = buildMusicShelfHtml('Your artists', 'artists', '<button class="music-artist-card">x</button>');
  assert.match(html, /class="music-shelf"/, 'a shelf section');
  assert.match(html, /class="music-shelf-title">Your artists</, 'the title');
  assert.match(html, /class="music-shelf-seeall" data-seeall="artists">See all</, 'a See-all that targets the tab');
  assert.match(html, /class="music-shelf-row"><button class="music-artist-card">x<\/button>/, 'the tiles inside a scroll row');
});

test('redesign: a shelf with no See-all target omits the See-all button', () => {
  const html = buildMusicShelfHtml('Jump back in', '', '<span>t</span>');
  assert.doesNotMatch(html, /music-shelf-seeall/, 'no See-all when there is no destination tab');
});

test('redesign S1: buildJumpBackTileHtml renders a resume tile (data-id, /albumart art, title, artist)', () => {
  const html = buildJumpBackTileHtml({ id: 'trk9', title: 'Sonic 2 Coding', artist: 'NESTALGIA' });
  assert.match(html, /class="music-jump-tile" data-id="trk9"/, 'the tile carries the track id for the resume tap');
  assert.match(html, /class="music-jump-art art-shimmer" src="\/albumart\/trk9"/, 'art via /albumart (falls back to the thumbnail for a library track), art-shimmer');
  assert.match(html, />Sonic 2 Coding</, 'the title');
  assert.match(html, />NESTALGIA</, 'the artist');
});

test('v1.103: mosaic tile art ids are URL-encoded (a slash/space id cannot break the src attribute)', () => {
  const html = buildArtistCardHtml({ artist: 'Z', artIds: ['a b/c'] });
  assert.match(html, /src="\/albumart\/a%20b%2Fc"/);
});

test('v1.103 (reveal-once): the artist skeleton reserves the mosaic square, matching the revealed card shape', () => {
  // Seed shape must equal reveal shape or the artists cold-landing shifts on load.
  assert.match(MUSIC_JS, /class="music-artist-mosaic skeleton-shimmer"/, 'skeleton reserves the mosaic box');
});

test('T9: buildSongRowHtml carries the index + id, escaped title, duration, and a like toggle', () => {
  const html = buildSongRowHtml({ id: 't1', title: 'Song "One"', artist: 'A', album: 'X', durationSec: 200, liked: true }, 4);
  assert.match(html, /data-index="4"/);
  assert.match(html, /data-id="t1"/);
  assert.match(html, /Song &quot;One&quot;/, 'title escaped');
  assert.match(html, /3:20/, 'duration formatted');
  assert.match(html, /music-like-btn liked/, 'liked state reflected');
  // v1.102 (tranche 4): the like glyph is the inline chrome-icon heart svg, not a
  // decode-lagging `.icon-heart` mask (single heart, still no -filled variant).
  assert.match(html, /class="chrome-icon"[^>]*><path d="m480-120/, 'the like glyph is the inline chrome-icon heart svg');
  assert.doesNotMatch(html, /icon-heart/, 'no .icon-heart mask <i> survives in the song row');
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

test('v1.106 SOURCE-LOCK: a fresh SELECT expands (slot); a NAV keeps position', () => {
  // v1.106: a fresh select (default) always mounts FULL into #player-slot (open
  // the now-playing view); a NAV (opts.keepPosition, next/prev) keeps position -
  // slot only if already 'full', else dock. The BEHAVIOUR (which position each
  // path loads into, + the scroll) is bound in music-nowplaying-view.test.js;
  // this lock guards the conditional's shape against silent reversion.
  assert.match(MUSIC_JS, /var useSlot = opts\.keepPosition\s*\n?\s*\? \(pl && typeof pl\.getState === 'function' && pl\.getState\(\) === 'full'\)\s*\n?\s*: true;/,
    'select -> true (expand); nav -> full-only (keep position)');
  assert.match(MUSIC_JS, /\(useSlot && slot\) \? \{ slot: slot \} : \{ dock: true \}/, 'expand mounts slot, else dock');
  assert.match(MUSIC_JS, /if \(!opts\.keepPosition && useSlot && slot\) \{ try \{ window\.scrollTo\(0, 0\)/, 'a fresh select scrolls the player into view');
  assert.match(MUSIC_JS, /readerHref: '\/music\?nowplaying=1'/, 'the dock tap opens the now-playing view in one gesture');
});

// ---- v1.104 now-playing panel ----------------------------------------------

test('v1.104: buildNowPlayingPanelHtml renders escaped title + "artist · album" + tappable up-next rows', () => {
  const html = buildNowPlayingPanelHtml(
    { title: 'Song "1"', artist: 'A & B', album: 'Alb<x>' },
    [{ id: 't2', title: 'Two', artist: 'X', index: 3 }, { id: 't3', title: 'Three', artist: 'Y', index: 4 }],
  );
  assert.match(html, /class="mnp-title"[^>]*>Song &quot;1&quot;/, 'title escaped');
  assert.match(html, /class="mnp-sub">A &amp; B · Alb&lt;x&gt;/, 'artist · album, escaped');
  assert.match(html, /class="mnp-queue-head">Up next/);
  assert.match(html, /class="mnp-queue-row" data-index="3"[\s\S]*src="\/albumart\/t2"[\s\S]*>Two</, 'first up-next row carries its real queue index + thumb');
  assert.match(html, /data-index="4"[\s\S]*>Three</);
  assert.ok((html.match(/art-shimmer/g) || []).length === 2, 'each up-next thumb ships art-shimmer (reveal-once)');
});

test('v1.104: buildNowPlayingPanelHtml omits the queue when nothing is up next, and the sub when no artist/album', () => {
  const noQueue = buildNowPlayingPanelHtml({ title: 'Solo' }, []);
  assert.doesNotMatch(noQueue, /mnp-queue/, 'no up-next section');
  assert.doesNotMatch(noQueue, /mnp-sub/, 'no artist/album sub-line when both absent');
  assert.match(noQueue, />Solo</);
  // A missing title degrades, never throws.
  assert.match(buildNowPlayingPanelHtml({}, []), /Unknown track/);
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

// ---- v1.73 (Dean ruling 2): the shared now-playing contract, second mount ---

test('v1.73 SOURCE-LOCK: music adopts the podcasts now-playing contract (dock tap -> ?nowplaying=1, slot re-adopt on every init)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '../../public/js/music.js'), 'utf8');
  assert.ok(js.includes("readerHref: '/music?nowplaying=1'"), 'dock tap opens the expanded view in ONE gesture');
  assert.ok(js.includes("pState === 'full' || (wantNowPlaying && pState === 'docked')"), 'the re-adopt condition matches podcasts.js VERBATIM (the v1.71 W2 stranded-audio class)');
  assert.ok(js.includes('player.expand(npSlot)'), 'and it mounts into THIS view\'s slot');
  const idxCond = js.indexOf("pState === 'full'");
  const idxExpand = js.indexOf('player.expand(npSlot)');
  assert.ok(idxCond >= 0 && idxExpand > idxCond, 'condition precedes the mount (ordering, not presence)');
  const html = fs.readFileSync(path.join(__dirname, '../../public/music.html'), 'utf8');
  assert.ok(html.includes('id="player-slot"'), 'music.html carries the slot');
  assert.ok(!html.includes('No #player-slot here'), 'the v1.44.2 no-slot comment did not survive as a lie');
});

test('v1.73 SOURCE-LOCK (Dean ruling 9): the audio art surface CONTAINS - a square cover never echoes as side rectangles', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  const rule = /\.audio-bg-art\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the .audio-bg-art rule exists');
  assert.match(rule[1], /background-size:\s*contain;/, 'contain, never cover');
  assert.ok(!/background-size:\s*cover/.test(rule[1]), 'the cover echo is gone');
  assert.match(rule[1], /background-color:/, 'a plain backdrop fills the letterbox bands');
});
