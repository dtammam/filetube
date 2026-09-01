// FileTube Music page (v1.44 T9) — registered VIEW MODULE, the books.js
// pattern: `init(root)` runs on a full page load AND an in-app swap into
// /music; every listener binds through ONE per-instance AbortController so
// `destroy()` removes them all. Tapping a song plays it in the shared,
// battle-won audio player (dock/mini-player, MediaSession, background audio)
// with a client-side QUEUE for prev/next/autoplay and the v1.40 ctx contract.

// ---- Pure, DOM-free helpers (node:test-covered without a browser) ----------

function escapeMusicHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Seconds -> m:ss (or h:mm:ss). Empty for a non-finite/zero duration.
function formatTrackDuration(sec) {
  var s = Number(sec);
  if (!isFinite(s) || s <= 0) return '';
  s = Math.floor(s);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var ss = s % 60;
  var mm = h > 0 && m < 10 ? '0' + m : String(m);
  var pad = ss < 10 ? '0' + ss : String(ss);
  return (h > 0 ? h + ':' : '') + mm + ':' + pad;
}

// An album card (square art + album + artist). `artId` is a representative
// track id whose album art the /albumart route resolves.
function buildAlbumCardHtml(album) {
  var art = '/albumart/' + encodeURIComponent(album.artId || '');
  var count = album.trackCount ? album.trackCount + (album.trackCount === 1 ? ' track' : ' tracks') : '';
  return '' +
    '<button type="button" class="music-album-card" data-album-key="' + escapeMusicHtml(album.albumKey) + '">' +
    '<img class="music-album-art art-shimmer" src="' + escapeMusicHtml(art) + '" alt="' + escapeMusicHtml(album.album) + '" loading="lazy" />' +
    '<span class="music-album-title" title="' + escapeMusicHtml(album.album) + '">' + escapeMusicHtml(album.album || 'Unknown album') + '</span>' +
    '<span class="music-album-artist" title="' + escapeMusicHtml(album.artist) + '">' + escapeMusicHtml(album.artist) + '</span>' +
    '<span class="music-album-count">' + escapeMusicHtml(count) + '</span>' +
    '</button>';
}

// An artist card: a 2x2 mosaic of the artist's album art (server sends up to 4
// `artIds`, art-carrying albums first) over the name + album/track counts. The
// mosaic mirrors the album card's chassis - an art-forward square, not the old
// text-only box. `data-tiles` (1-4) drives the CSS reflow so 1/2/3 albums still
// fill the square. Real server data always sends >=1 artId (every artist has >=1
// album), and /albumart/<id> serves that album's art or an SVG placeholder. The
// zero-artIds branch (`['']`) only fires on a stale/malformed cached payload:
// /albumart/ with an EMPTY segment 404s, but the tile's `error` still clears the
// shimmer (a broken-image glyph, never a perpetual shimmer or a blank card).
// Each tile ships `art-shimmer`; revealMusicArt() (via the shared shimmerArt)
// clears it on decode OR error - the reveal-once both-axes contract, per tile.
function buildArtistCardHtml(artist) {
  var meta = (artist.albumCount || 0) + (artist.albumCount === 1 ? ' album' : ' albums') +
    ' · ' + (artist.trackCount || 0) + (artist.trackCount === 1 ? ' track' : ' tracks');
  var name = artist.artist || 'Unknown artist';
  var visual;
  if (typeof artist.avatarUrl === 'string' && artist.avatarUrl) {
    // Redesign S1: a round CHANNEL-avatar circle (Spotify-style). A monogram sits
    // behind; the avatar reveals on load and is DROPPED on error (revealMusicArt),
    // so a broken URL degrades to the monogram - never a broken-image glyph.
    var initial = (String(name).trim().charAt(0) || '?').toUpperCase();
    visual = '<span class="music-artist-avatar">' +
      '<span class="maa-mono">' + escapeMusicHtml(initial) + '</span>' +
      '<img class="maa-img" src="' + escapeMusicHtml(artist.avatarUrl) + '" alt="" loading="lazy" />' +
      '</span>';
  } else {
    var ids = (Array.isArray(artist.artIds) && artist.artIds.length) ? artist.artIds.slice(0, 4) : [''];
    var tiles = ids.map(function (id) {
      return '<img class="art-shimmer" src="/albumart/' + encodeURIComponent(id || '') + '" alt="" loading="lazy" />';
    }).join('');
    visual = '<span class="music-artist-mosaic" data-tiles="' + ids.length + '">' + tiles + '</span>';
  }
  return '' +
    '<button type="button" class="music-artist-card" data-artist="' + escapeMusicHtml(artist.artist) + '">' +
    visual +
    '<span class="music-artist-name" title="' + escapeMusicHtml(artist.artist) + '">' + escapeMusicHtml(artist.artist || 'Unknown artist') + '</span>' +
    '<span class="music-artist-meta">' + escapeMusicHtml(meta) + '</span>' +
    '</button>';
}

// Redesign S1: a "Jump back in" tile - a small art square over title + artist.
// Art is /albumart/<id> (which falls back to the media thumbnail for a projected
// library track), art-shimmer'd like every other music art. Tapping resumes the
// track (playTrackFromContinue) with its saved position.
function buildJumpBackTileHtml(item) {
  return '' +
    '<button type="button" class="music-jump-tile" data-id="' + escapeMusicHtml(item.id) + '">' +
    '<img class="music-jump-art art-shimmer" src="/albumart/' + encodeURIComponent(item.id) + '" alt="" loading="lazy" />' +
    '<span class="music-jump-title" title="' + escapeMusicHtml(item.title) + '">' + escapeMusicHtml(item.title || 'Unknown track') + '</span>' +
    '<span class="music-jump-sub" title="' + escapeMusicHtml(item.artist || '') + '">' + escapeMusicHtml(item.artist || '') + '</span>' +
    '</button>';
}

// Friction pass: the COMPACT LIST row for the Artists view (a fast index vs the
// big circles). A small round avatar/mono + name + count, one per line - the
// quickest way to eyeball and tap a known artist. Drills via the same
// data-artist the content delegation reads (a .music-artist-row arm).
function buildArtistListRowHtml(artist) {
  var name = artist.artist || 'Unknown artist';
  var initial = (String(name).trim().charAt(0) || '?').toUpperCase();
  var count = (artist.trackCount || 0) + (artist.trackCount === 1 ? ' song' : ' songs');
  var circle;
  if (typeof artist.avatarUrl === 'string' && artist.avatarUrl) {
    circle = '<span class="music-artist-row-circle"><span class="maa-mono">' + escapeMusicHtml(initial) + '</span>' +
      '<img class="maa-img" src="' + escapeMusicHtml(artist.avatarUrl) + '" alt="" loading="lazy" /></span>';
  } else {
    var artId = (Array.isArray(artist.artIds) && artist.artIds[0]) || '';
    circle = '<span class="music-artist-row-circle"><img class="art-shimmer" src="/albumart/' + encodeURIComponent(artId) + '" alt="" loading="lazy" /></span>';
  }
  return '' +
    '<button type="button" class="music-artist-row" data-artist="' + escapeMusicHtml(artist.artist) + '">' +
    circle +
    '<span class="music-artist-row-name" title="' + escapeMusicHtml(name) + '">' + escapeMusicHtml(name) + '</span>' +
    '<span class="music-artist-row-count">' + escapeMusicHtml(count) + '</span>' +
    '</button>';
}

// Friction pass: a "Recently played" HOME tile - a round album-art circle over
// the artist name (no meta), drilling into that artist via the same data-artist
// the delegation reads. Built from a recent-listening track (art = the track's
// /albumart; the artist name is what matters for the tap).
function buildRecentArtistTileHtml(item) {
  var name = item.artist || 'Unknown artist';
  return '' +
    '<button type="button" class="music-artist-card" data-artist="' + escapeMusicHtml(name) + '">' +
    '<span class="music-artist-mosaic" data-tiles="1"><img class="art-shimmer" src="/albumart/' + encodeURIComponent(item.id) + '" alt="" loading="lazy" /></span>' +
    '<span class="music-artist-name" title="' + escapeMusicHtml(name) + '">' + escapeMusicHtml(name) + '</span>' +
    '</button>';
}

// Redesign: a HOME shelf - a titled section with an optional "See all" (switches
// to that tab) over a horizontal-scroll row of tiles (album/artist cards reused
// verbatim, so a tile tap drills exactly as it does in the full grid).
function buildMusicShelfHtml(title, seeallTab, tilesHtml) {
  return '' +
    '<section class="music-shelf">' +
    '<div class="music-shelf-head">' +
    '<h3 class="music-shelf-title">' + escapeMusicHtml(title) + '</h3>' +
    (seeallTab ? '<button type="button" class="music-shelf-seeall" data-seeall="' + escapeMusicHtml(seeallTab) + '">See all</button>' : '') +
    '</div>' +
    '<div class="music-shelf-row">' + tilesHtml + '</div>' +
    '</section>';
}

// v1.102 (tranche 4): the song-row action glyphs (queue/download/like) are inline
// chrome-icon SVGs, not `.icon-*` masks - a mask paints NOTHING until it decodes,
// so on an iOS cold start it popped in a beat after the row (the v1.87 class). The
// markup builder is common.js's chromeIconMarkup, a browser global reached via
// `window.` (no bare require - the client-scripts convention). node:test that
// wants the glyph attaches window.chromeIconMarkup first (see music-view.test.js);
// otherwise the row still builds, just glyph-less.
function rowGlyphMarkup(name) {
  return (typeof window !== 'undefined' && typeof window.chromeIconMarkup === 'function')
    ? window.chromeIconMarkup(name)
    : '';
}

// A song row (index button, thumb, title/artist, duration, like toggle). The
// row's data-index drives playAt(); the like button is a nested control.
// v1.44.2: every row carries a CSS equalizer glyph (3 animated bars, NEVER an
// emoji codepoint — iOS forces blue emoji) overlaid on the thumb; it is
// display:none unless the row is `.playing` (the highlight that tracks the
// currently-playing track id — see applyPlayingHighlight).
function buildSongRowHtml(item, index) {
  var dur = formatTrackDuration(item.durationSec);
  var liked = !!item.liked;
  return '' +
    '<div class="music-song-row" data-index="' + index + '" data-id="' + escapeMusicHtml(item.id) + '">' +
    '<span class="music-song-thumb-wrap">' +
    '<img class="music-song-thumb art-shimmer" src="/albumart/' + encodeURIComponent(item.id) + '" alt="" loading="lazy" />' +
    '<span class="music-eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
    '</span>' +
    '<span class="music-song-main">' +
    '<span class="music-song-title" title="' + escapeMusicHtml(item.title) + '">' + escapeMusicHtml(item.title) + '</span>' +
    '<span class="music-song-sub">' + escapeMusicHtml(item.artist || '') + (item.album ? ' · ' + escapeMusicHtml(item.album) : '') + '</span>' +
    '</span>' +
    '<span class="music-song-duration">' + escapeMusicHtml(dur) + '</span>' +
    // v1.72 (cap 3): per-track add-to-queue - the one global queue's verb
    // (common.js addToQueue with the 'track' entry kind), the podcasts
    // episode-row pattern on the like-button chassis.
    '<button type="button" class="music-like-btn music-queue-btn" data-queue-id="' + escapeMusicHtml(item.id) + '" title="Add to queue" aria-label="Add to queue">' +
    rowGlyphMarkup('queue') +
    '</button>' +
    // v1.72 (cap 7): per-track save-to-device - the like button's chassis,
    // an anchor at the stream route's ?download=1 arm (original bytes; the
    // server names the file via Content-Disposition). stopPropagation is
    // not needed: an <a> click navigates the browser's download machinery,
    // and the row-play delegation ignores clicks on .music-download-btn.
    '<a class="music-like-btn music-download-btn" href="/track/' + encodeURIComponent(item.id) + '?download=1" download title="Save to device" aria-label="Save to device">' +
    rowGlyphMarkup('download') +
    '</a>' +
    '<button type="button" class="music-like-btn' + (liked ? ' liked' : '') + '" data-like-id="' + escapeMusicHtml(item.id) + '" title="' + (liked ? 'Unlike' : 'Like') + '" aria-label="' + (liked ? 'Unlike' : 'Like') + '">' +
    rowGlyphMarkup('heart') +
    '</button>' +
    '</div>';
}

// v1.104: the expanded now-playing panel (under #player-slot). The shared player
// host shows only the big art in iOS background-audio mode - no track text - so
// this music-owned panel renders the metadata (title, artist . album) + an
// "Up next" queue. `np` = the playing track {title,artist,album}; `upNext` = the
// remaining queue items, each `{id,title,artist,index}` (`index` is the real
// queue index, so a tap can `playAt(index)`). Queue thumbs ship `art-shimmer`
// (reveal-once, cleared by the shared shimmerArt).
function buildNowPlayingPanelHtml(np, upNext) {
  np = np || {};
  var sub = [np.artist, np.album].filter(function (x) { return typeof x === 'string' && x; }).join(' · ');
  var meta = '<div class="mnp-meta">' +
    '<div class="mnp-title" title="' + escapeMusicHtml(np.title) + '">' + escapeMusicHtml(np.title || 'Unknown track') + '</div>' +
    (sub ? '<div class="mnp-sub">' + escapeMusicHtml(sub) + '</div>' : '') +
    '</div>';
  var queue = '';
  if (Array.isArray(upNext) && upNext.length) {
    // v1.223 (Dean): show the WHOLE queue, not just what's next - the list no longer
    // shrinks as you play. Each row carries a state ('played' before the current,
    // 'current', or 'next'); played rows grey out but stay clickable (jump back),
    // the current row is marked. Rows without a state (legacy callers) render plain.
    queue = '<div class="mnp-queue"><div class="mnp-queue-head">Up next</div>' +
      upNext.map(function (it) {
        var cls = 'mnp-queue-row'
          + (it.state === 'played' ? ' is-played' : '')
          + (it.state === 'current' ? ' is-current' : '');
        return '<button type="button" class="' + cls + '"' + (it.state === 'current' ? ' aria-current="true"' : '') + ' data-index="' + it.index + '">' +
          '<img class="mnp-queue-thumb art-shimmer" src="/albumart/' + encodeURIComponent(it.id) + '" alt="" loading="lazy" />' +
          '<span class="mnp-queue-main">' +
          '<span class="mnp-queue-title">' + escapeMusicHtml(it.title || 'Track') + '</span>' +
          (it.artist ? '<span class="mnp-queue-sub">' + escapeMusicHtml(it.artist) + '</span>' : '') +
          '</span></button>';
      }).join('') +
      '</div>';
  }
  return meta + queue;
}

// The display year for an album drill: the min non-null Integer year across
// its tracks — MATCHES groupAlbums (lib/music/query.js) so the header year and
// the card year agree.
function drillYear(tracks) {
  var y = null;
  for (var i = 0; i < tracks.length; i++) {
    var ty = tracks[i] && tracks[i].year;
    if (Number.isInteger(ty) && (y === null || ty < y)) y = ty;
  }
  return y;
}

// Distinct album count across an artist's tracks (a blank album is one bucket).
// Null-proto accumulator so an album literally named "__proto__" can't poison
// the count (the repo's recurring __proto__ lesson, now at the view layer).
function drillAlbumCount(tracks) {
  var seen = Object.create(null);
  var n = 0;
  for (var i = 0; i < tracks.length; i++) {
    var a = tracks[i] && typeof tracks[i].album === 'string' ? tracks[i].album : '';
    var key = a || ' ';
    if (!seen[key]) { seen[key] = true; n += 1; }
  }
  return n;
}

// v1.44.2 (Spotify feel): the LARGE, art-forward drill header (album or
// artist). Built PURELY from the already-loaded tracks + the drill descriptor
// (no new endpoint). At rest it shows big cover art + title + artist +
// year·track-count + prominent Play/Shuffle; as the list scrolls it collapses
// (CSS) into the slim sticky bar (buildStickyBarHtml). Back + Play + Shuffle
// are handled by delegation on shared classes (.music-drill-back/-play/-shuffle).
function buildDrillHeaderHtml(drill, tracks) {
  tracks = Array.isArray(tracks) ? tracks : [];
  var isAlbum = !!(drill && drill.type === 'album');
  var first = tracks[0] || {};
  var artId = first.id || '';
  var title = (drill && drill.label) || (isAlbum ? 'Album' : 'Artist');
  var artist = isAlbum ? ((typeof first.albumArtist === 'string' && first.albumArtist) || first.artist || '') : '';
  var count = tracks.length;
  var meta;
  if (isAlbum) {
    var y = drillYear(tracks);
    meta = (y ? y + ' · ' : '') + count + (count === 1 ? ' track' : ' tracks');
  } else {
    var ac = drillAlbumCount(tracks);
    meta = ac + (ac === 1 ? ' album' : ' albums') + ' · ' + count + (count === 1 ? ' track' : ' tracks');
  }
  return '' +
    '<div class="music-drill-header">' +
    '<button type="button" class="music-drill-back btn btn-sm" aria-label="Back">‹ Back</button>' +
    '<div class="music-drill-heading">' +
    '<img class="music-drill-art art-shimmer" src="/albumart/' + encodeURIComponent(artId) + '" alt="' + escapeMusicHtml(title) + '" />' +
    '<div class="music-drill-info">' +
    '<h3 class="music-drill-title" title="' + escapeMusicHtml(title) + '">' + escapeMusicHtml(title) + '</h3>' +
    (artist ? '<div class="music-drill-artist">' + escapeMusicHtml(artist) + '</div>' : '') +
    '<div class="music-drill-meta">' + escapeMusicHtml(meta) + '</div>' +
    '<div class="music-drill-actions">' +
    '<button type="button" class="music-drill-play btn btn-primary btn-sm"><i class="icon-play"></i> Play</button>' +
    '<button type="button" class="music-drill-shuffle btn btn-sm"><i class="icon-shuffle"></i> Shuffle</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>';
}

// The slim COLLAPSED sticky bar (small thumb + title + Back + Play). Revealed
// by CSS when `.music-drill.collapsed` is set (IntersectionObserver drives it).
function buildStickyBarHtml(drill, tracks) {
  tracks = Array.isArray(tracks) ? tracks : [];
  var isAlbum = !!(drill && drill.type === 'album');
  var first = tracks[0] || {};
  var artId = first.id || '';
  var title = (drill && drill.label) || (isAlbum ? 'Album' : 'Artist');
  return '' +
    '<div class="music-drill-sticky">' +
    '<button type="button" class="music-drill-back music-sticky-back btn btn-sm" aria-label="Back">‹</button>' +
    '<img class="music-sticky-thumb art-shimmer" src="/albumart/' + encodeURIComponent(artId) + '" alt="" />' +
    '<span class="music-sticky-title" title="' + escapeMusicHtml(title) + '">' + escapeMusicHtml(title) + '</span>' +
    '<button type="button" class="music-drill-play music-sticky-play btn btn-primary btn-sm" aria-label="Play"><i class="icon-play"></i></button>' +
    '</div>';
}

// v1.44.2: the "Playing from <Album>" context line. Pure so it can be tested
// without a DOM. Shows a label ONLY when a MUSIC track is the currently-loaded
// item (np.id === the player's currentId — guards against a video/book being
// what's actually playing) and it has a non-empty album; otherwise '' (hidden).
function deriveNowPlayingLabel(np, currentId) {
  if (!np || !currentId || np.id !== currentId) return '';
  var album = np.album && String(np.album).trim();
  return album ? 'Playing from ' + album : '';
}

// v1.75: the music place's top tabs, and the ONE place that decides whether a
// remembered tab is still real. The active tab persists in localStorage
// ('filetube_music_tab'), so retiring the Liked tab strands every device that
// had it selected: `render()` dispatches on the tab name and has no else-arm,
// so a stale 'liked' would render a blank page that survives every reload.
// A remembered tab that is no longer in the roster falls back to the default.
var MUSIC_TABS = ['home', 'albums', 'artists', 'songs'];
// Redesign: HOME is the default landing - a Spotify-style scroll of shelves
// (Your artists as circles, Albums, Recently added). Albums/Artists/Songs remain
// full-list tabs, reachable directly or via a shelf's "See all". Also the
// sanitiser fallback for a stale/absent stored tab.
var MUSIC_DEFAULT_TAB = 'home';

function normalizeMusicTab(value) {
  return MUSIC_TABS.indexOf(value) >= 0 ? value : MUSIC_DEFAULT_TAB;
}

// v1.103: sort is now per-tab. Each browse tab exposes only the keys that make
// sense for it (a grid of albums can't sort by track duration; artists carry no
// release year), with labels that read right for the tab's unit ("Title A-Z" for
// songs/albums, "Name A-Z" for artists). Every value here has a server handler -
// songs via sortTracks (/api/music), albums/artists via sortGroups
// (/api/music/albums|artists) - so the client menu never offers a dead option.
var MUSIC_SORTS = {
  songs: [
    { value: 'newest', label: 'Recently added' },
    { value: 'title-asc', label: 'Title A-Z' },
    { value: 'title-desc', label: 'Title Z-A' },
    { value: 'artist-asc', label: 'Artist' },
    { value: 'album-asc', label: 'Album' },
    { value: 'duration-desc', label: 'Longest' },
    { value: 'duration-asc', label: 'Shortest' },
  ],
  albums: [
    { value: 'title-asc', label: 'Title A-Z' },
    { value: 'title-desc', label: 'Title Z-A' },
    { value: 'newest', label: 'Recently added' },
    { value: 'year-desc', label: 'Release year' },
    { value: 'tracks-desc', label: 'Most tracks' },
  ],
  artists: [
    { value: 'title-asc', label: 'Name A-Z' },
    { value: 'title-desc', label: 'Name Z-A' },
    { value: 'newest', label: 'Recently added' },
    { value: 'tracks-desc', label: 'Most songs' },
  ],
  // Friction pass (Dean): a drill's song list is sortable. Release date leads -
  // the natural order for yt-dlp downloads (their arbitrary order was the pain).
  drill: [
    { value: 'release-newest', label: 'Release date (newest)' },
    { value: 'release-oldest', label: 'Release date (oldest)' },
    { value: 'album-order', label: 'Album order' },
    { value: 'title-asc', label: 'Title A-Z' },
    { value: 'title-desc', label: 'Title Z-A' },
    { value: 'duration-desc', label: 'Longest' },
    { value: 'newest', label: 'Recently added' },
  ],
};
// An ARTIST drill defaults to release date (Dean); an ALBUM drill keeps album
// order (disc/track sequence - the intended listen).
var MUSIC_SORT_DEFAULTS = { songs: 'newest', albums: 'title-asc', artists: 'title-asc', 'drill-artist': 'release-newest', 'drill-album': 'album-order' };
// The drill sort keys map to the shared `drill` option list.
function musicSortOptionsFor(key) {
  if (key === 'drill-artist' || key === 'drill-album') return MUSIC_SORTS.drill;
  return MUSIC_SORTS[key] || MUSIC_SORTS.songs;
}

// The persisted sort for `tab`, validated against that tab's option list (an
// unknown/stale key falls back to the tab default, so a renamed key never
// strands the menu on an invalid value).
function normalizeMusicSort(tab, value) {
  var opts = musicSortOptionsFor(tab);
  return opts.some(function (o) { return o.value === value; }) ? value : (MUSIC_SORT_DEFAULTS[tab] || 'newest');
}

// v1.98 shimmer sweep: seeded into #music-content before render()'s fetch, so a
// tab never shows a blank host then a snap-in. Two shapes, matching the two
// render outcomes: a `.music-card-grid` of `.music-album-card` skeletons (albums
// /artists) and a `.music-song-list` of `.music-song-row` skeletons (songs/
// drill). Both reuse the REAL container + reserved art box (`.music-album-art`
// aspect 1 / the 44px `.music-song-thumb-wrap`), so the reveal is zero-shift.
function buildMusicSkeletonCards(n) {
  var count = Number.isInteger(n) && n > 0 ? n : 0;
  if (count === 0) return '';
  var cards = '';
  for (var i = 0; i < count; i++) {
    cards += '' +
      '<div class="music-album-card" aria-hidden="true">' +
      '<span class="music-album-art skeleton-shimmer"></span>' +
      '<div class="skeleton-line skeleton-line-title skeleton-shimmer"></div>' +
      '<div class="skeleton-line skeleton-line-meta skeleton-shimmer"></div>' +
      '</div>';
  }
  return '<div class="music-card-grid">' + cards + '</div>';
}

// v1.103: artist cards are now art-forward (a square mosaic over name + meta),
// the SAME shape as an album card - so the skeleton reserves the square mosaic
// box + two lines, matching the revealed card exactly (reveal-once: seed the
// shape you reveal). The artists tab is a localStorage-persisted COLD landing,
// so any seed/reveal mismatch is user-reachable straight off a page load.
function buildMusicArtistSkeletonCards(n) {
  var count = Number.isInteger(n) && n > 0 ? n : 0;
  if (count === 0) return '';
  var cards = '';
  for (var i = 0; i < count; i++) {
    cards += '' +
      '<div class="music-artist-card" aria-hidden="true">' +
      '<span class="music-artist-mosaic skeleton-shimmer"></span>' +
      '<div class="skeleton-line skeleton-line-title skeleton-shimmer"></div>' +
      '<div class="skeleton-line skeleton-line-meta skeleton-shimmer"></div>' +
      '</div>';
  }
  return '<div class="music-card-grid">' + cards + '</div>';
}

// Redesign: the HOME cold-landing skeleton - the SAME .music-home > .music-shelf
// > .music-shelf-row shape renderHome reveals (two titled horizontal rows of
// cards), so the swap is zero-shift on the default surface (the reveal-once
// seed-the-shape-you-reveal contract; home is the cold landing off a page load).
function buildMusicHomeSkeleton() {
  function shelf(cardsHtml) {
    return '<section class="music-shelf">' +
      '<div class="music-shelf-head"><div class="skeleton-line skeleton-line-title skeleton-shimmer"></div></div>' +
      '<div class="music-shelf-row">' + cardsHtml + '</div></section>';
  }
  var artistCards = '';
  var albumCards = '';
  for (var i = 0; i < 6; i++) {
    artistCards += '<div class="music-artist-card" aria-hidden="true"><span class="music-artist-mosaic skeleton-shimmer"></span><div class="skeleton-line skeleton-line-title skeleton-shimmer"></div><div class="skeleton-line skeleton-line-meta skeleton-shimmer"></div></div>';
    albumCards += '<div class="music-album-card" aria-hidden="true"><span class="music-album-art skeleton-shimmer"></span><div class="skeleton-line skeleton-line-title skeleton-shimmer"></div><div class="skeleton-line skeleton-line-meta skeleton-shimmer"></div></div>';
  }
  return '<div class="music-home">' + shelf(artistCards) + shelf(albumCards) + '</div>';
}

function buildMusicSkeletonRows(n) {
  var count = Number.isInteger(n) && n > 0 ? n : 0;
  if (count === 0) return '';
  var rows = '';
  for (var i = 0; i < count; i++) {
    rows += '' +
      '<div class="music-song-row" aria-hidden="true">' +
      '<span class="music-song-thumb-wrap skeleton-shimmer"></span>' +
      '<span class="music-song-main">' +
      '<div class="skeleton-line skeleton-line-title skeleton-shimmer"></div>' +
      '<div class="skeleton-line skeleton-line-meta skeleton-shimmer"></div>' +
      '</span>' +
      '</div>';
  }
  return '<div class="music-song-list">' + rows + '</div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeMusicHtml, formatTrackDuration, buildAlbumCardHtml, buildArtistCardHtml, buildArtistListRowHtml, buildJumpBackTileHtml, buildMusicShelfHtml, buildRecentArtistTileHtml, buildSongRowHtml,
    buildNowPlayingPanelHtml,
    drillYear, drillAlbumCount, buildDrillHeaderHtml, buildStickyBarHtml, deriveNowPlayingLabel,
    MUSIC_TABS, MUSIC_DEFAULT_TAB, normalizeMusicTab,
    MUSIC_SORTS, MUSIC_SORT_DEFAULTS, normalizeMusicSort,
    buildMusicSkeletonCards, buildMusicSkeletonRows, buildMusicArtistSkeletonCards,
  };
}

(function () {
  if (typeof window === 'undefined') return;
  var controller = null;
  // v1.44.2: the drill-header collapse IntersectionObserver. Module-scoped (NOT
  // in init's closure) so destroy() can disconnect it on the SPA #view-root
  // swap — leaving /music mid-drill must not leak an observer pointed at a
  // detached sentinel. Also disconnected before every re-render (wireStickyObserver).
  var stickyObserver = null;
  function disconnectStickyObserver() {
    if (stickyObserver) { stickyObserver.disconnect(); stickyObserver = null; }
  }
  // v1.44.2: the currently-playing music track's {id, album, albumKey} for the
  // "Playing from <Album>" line. Module-scoped so it survives the SPA #view-root
  // swap (music.js re-init's, but this persists) — a nav BACK into /music while
  // a track plays re-derives the line. Only music.js plays music, so this stays
  // in lockstep with the player; the render/updateNowPlaying guard cross-checks
  // player.currentId so a video/book-now-playing (or a closed player) hides it.
  var nowPlaying = null;
  // v1.237 (Dean): a chaptered album is ONE file streamed by all its `::c` chapter tracks
  // (chapterStartSec offsets), so when playback ROLLS across a chapter boundary the player's
  // currentId stays the loaded `::c` id and the now-playing title never updates. chapterViewId
  // is the chapter the VIEW currently DISPLAYS (a timeupdate watcher re-derives it from
  // currentTime and repaints); it can run ahead of the loaded id WITHOUT reloading. null when
  // not playing a chaptered file. The now-playing/skin renders prefer it over player.currentId.
  var chapterViewId = null;
  // v1.217 (in-view back-stack): the LIVE onPopState handler for the mounted
  // init() closure (it needs init's `drill`/render/setActiveTab). Module-scoped
  // so the stable module.onPopState the router calls can delegate to whichever
  // init is current; nulled by destroy() so a pop after teardown is a no-op.
  var activePopStateHandler = null;
  // v1.234: the current init's pop-out teardown, so the module-level destroy() can close a
  // floating pop-out window on a cross-view swap (its listeners live on the pop-out's own
  // AbortController, not the view signal). Nulled by destroy().
  var activePopoutTeardown = null;
  var SORT_KEY = 'filetube_music_sort';
  var TAB_KEY = 'filetube_music_tab';
  // Friction pass: the Artists view mode - 'grid' (circles) or 'list' (compact
  // index). Persisted per device; a toggle button flips it.
  var ARTIST_VIEW_KEY = 'filetube_music_artist_view';

  function readPref(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; }
  }
  function writePref(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* storage disabled */ }
  }

  async function fetchJson(url) {
    var res = await fetch(url);
    if (!res.ok) throw new Error(url + ' -> ' + res.status);
    return res.json();
  }

  function init(root) {
    controller = new AbortController();
    var signal = controller.signal;

    var content = root.querySelector('#music-content');
    var emptyNote = root.querySelector('#music-empty');
    var crumb = root.querySelector('#music-crumb');
    var tabsHost = root.querySelector('#music-tabs');
    var sortSelect = root.querySelector('#music-sort-select');
    var shuffleBtn = root.querySelector('#music-shuffle-btn');
    var scanBtn = root.querySelector('#music-scan-btn');
    var viewToggleBtn = root.querySelector('#music-view-toggle');
    var nowPlayingEl = root.querySelector('#music-nowplaying');
    var nowPlayingPanel = root.querySelector('#music-nowplaying-panel');
    var musicStage = root.querySelector('#music-stage');
    var theaterBtn = root.querySelector('#music-theater-btn');
    var popoutBtn = root.querySelector('#music-popout-btn');
    var jumpbackHost = root.querySelector('#music-jumpback');
    if (!content) return;

    // v1.222 (Dean): desktop THEATRE toggle - lay the album / up-next panel BESIDE
    // the expanded player (the watch page's Related-files space) instead of below.
    // Persisted (ft-music-theater); the button is desktop-only (CSS) and shows
    // only while a track is expanded (toggled in updateNowPlayingPanel). The class
    // rides #music-stage; a wide-viewport media query does the actual two-column
    // layout, so on mobile the class is inert (panel stays below).
    var THEATER_KEY = 'ft-music-theater';
    function theaterOn() { try { return localStorage.getItem(THEATER_KEY) === '1'; } catch (_) { return false; } }
    function applyTheater(on) {
      if (musicStage) musicStage.classList.toggle('is-theater', !!on);
      if (theaterBtn) theaterBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    applyTheater(theaterOn());
    if (theaterBtn) {
      theaterBtn.addEventListener('click', function () {
        var next = !theaterOn();
        try { localStorage.setItem(THEATER_KEY, next ? '1' : '0'); } catch (_) { /* ignore */ }
        applyTheater(next);
        updateNowPlayingPanel(); // v1.226: recompute (or clear) the theatre panel height cap
      }, { signal });
    }

    // ---- mobile music SKINS: a new PRESENTATION over the shared engine --------
    // On a mobile viewport + a music item, the now-playing panel becomes the
    // user's chosen full-screen skin (music-skins.js). The skin is pure chrome: it
    // PROXIES its buttons to the player's EXISTING hidden controls (#pp-btn /
    // #track-prev-btn / #track-next-btn) and REFLECTS the shared #media-player's
    // state - it never touches audio / MediaSession / background-audio. Desktop and
    // all non-music render the default panel/chrome unchanged.
    var SKINS = (typeof window !== 'undefined' && window.FileTubeMusicSkins) || null;
    function mmssMusic(s) { s = Math.max(0, Math.floor(Number(s) || 0)); var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }
    function hostCtl(id) { return document.getElementById(id); }
    function skinIsActive() {
      if (!SKINS) return false;
      var pl = window.FileTube && window.FileTube.player;
      var meta = (pl && typeof pl.getCurrentMeta === 'function') ? pl.getCurrentMeta() : null;
      return SKINS.skinActiveFor(meta);
    }
    function buildSkinCtx(ci) {
      var mp = hostCtl('media-player');
      var dur = (mp && isFinite(mp.duration) && mp.duration > 0) ? mp.duration : ((queue[ci] && Number(queue[ci].durationSec)) || 0);
      var pos = mp ? (Number(mp.currentTime) || 0) : 0;
      function rowOf(j) {
        return { index: j, title: queue[j].title, artist: queue[j].artist,
          durLabel: mmssMusic(queue[j].durationSec), state: j < ci ? 'played' : (j === ci ? 'current' : 'next') };
      }
      // upNext = Spotify's "Next in queue" (a little history + upcoming).
      var up = [];
      var start = Math.max(0, ci - 3);
      for (var j = start; j < queue.length && up.length < 200; j++) up.push(rowOf(j));
      // fullList = the iPod's whole-album list (v1.232.5, Dean: you could only scroll up
      // when the current was song 1, because upNext started near the current). From index
      // 0 for a normal album so EVERY earlier song is reachable; for a huge queue, a wide
      // window centered on the current (still lets you scroll far up). renderIpod opens it
      // scrolled to the current song (setIpodListMode).
      var full = [];
      var fstart = queue.length <= 400 ? 0 : Math.max(0, ci - 200);
      for (var k = fstart; k < queue.length && full.length < 400; k++) full.push(rowOf(k));
      return {
        track: { title: nowPlaying && nowPlaying.title, artist: nowPlaying && nowPlaying.artist, album: nowPlaying && nowPlaying.album,
          artUrl: playingId ? ('/albumart/' + encodeURIComponent(playingId)) : '' },
        upNext: up, fullList: full, playing: mp ? !mp.paused : false, posSec: pos, durSec: dur,
        posLabel: mmssMusic(pos), remLabel: dur > 0 ? ('-' + mmssMusic(dur - pos)) : '',
        // iPod footer "N of M": the current track's 1-based place in the whole queue.
        curNum: ci + 1, total: queue.length,
      };
    }
    // v1.234: a skin can render on MORE THAN ONE surface - the in-tab mobile panel AND the
    // desktop pop-out window (Document PiP / independent window). The two are kept mutually
    // exclusive by the viewport split (pop-out only on wide/desktop, the in-tab skin only on
    // narrow/mobile), ENFORCED so it can't drift: open re-gates on popoutSupported(), and a
    // resize into the narrow range tears the pop-out down (see updatePopoutBtn's resize
    // listener). So only one surface is ever live and the shared wheel state below is
    // unambiguous. skinSurfaces holds every panel bound via bindSkinSurface; reflectAllSkins
    // fans the live-element reflect out to each connected one.
    var skinSurfaces = [];
    // Reflect the live element into ONE rendered skin panel without a full re-render
    // (cheap; keeps the up-next scroll position).
    function reflectSkin(panel) {
      if (!panel || !panel.classList.contains('mms-full')) return;
      var mp = hostCtl('media-player'); if (!mp) return;
      var playBtn = panel.querySelector('.mms-play');
      if (playBtn) {
        playBtn.setAttribute('aria-label', mp.paused ? 'Play' : 'Pause');
        playBtn.innerHTML = mp.paused
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
      }
      var dur = (isFinite(mp.duration) && mp.duration > 0) ? mp.duration : 0;
      var pos = Number(mp.currentTime) || 0;
      var frac = dur > 0 ? Math.min(100, pos / dur * 100) : 0;
      // v1.232.4 (Dean): while a track is LOADING (dur==0 on prev/next), RESET the bar to
      // 0 instead of leaving the previous track's fill up - that stale fill was the
      // "fills then abruptly refreshes" flash on skip. Now it drops to 0 and fills as
      // the new track plays (bound to loadstart/emptied/durationchange below so it's prompt).
      var fill = panel.querySelector('.mms-fill'); if (fill) fill.style.width = (dur > 0 ? frac : 0) + '%';
      // iPod status-bar play indicator (▶ playing / ❚❚ paused) - the authentic Classic
      // shows state up top; the wheel's bottom play button keeps its static ▶❚❚ label.
      var pind = panel.querySelector('.mms-playind'); if (pind) pind.textContent = mp.paused ? '❚❚' : '▶';
      var pEl = panel.querySelector('.mms-pos'); if (pEl) pEl.textContent = mmssMusic(pos);
      var rEl = panel.querySelector('.mms-rem'); if (rEl) rEl.textContent = dur > 0 ? '-' + mmssMusic(dur - pos) : '';
    }
    // Reflect into every currently-live skin surface (drops any disconnected panel, e.g. a
    // closed pop-out window, so we never query a dead document).
    function reflectAllSkins() {
      for (var i = skinSurfaces.length - 1; i >= 0; i--) {
        var p = skinSurfaces[i];
        if (!p || !p.isConnected) { skinSurfaces.splice(i, 1); continue; }
        reflectSkin(p);
      }
    }
    // v1.233 iPod wheel-scroll state: wheelCursorRow is the CURRENT list POSITION the
    // wheel cursor sits on (an index into the rendered .ip-listview rows, NOT a queue
    // index - fullList may be a window, so a position is robust to that). -1 when the
    // list is closed. wheelSuppressClick swallows the synthetic click a spin-ending
    // pointerup would otherwise fire on a wheel zone (see the pointerdown gesture below).
    var wheelCursorRow = -1;
    var wheelSuppressClick = false;
    // v1.234: shared across surfaces (in-tab XOR pop-out - the viewport split is ENFORCED
    // mutually exclusive, see the reflectAllSkins comment), so a single live-gesture handle
    // is unambiguous; paintSkin nulls it on a re-render (QA guard).
    var wheelSpin = null;
    // v1.235: wheel-VOLUME (desktop pop-out Now Playing). adjustVolume nudges the live
    // element's volume by `frac` (clamped 0..1; a full turn = the whole range), unmutes on
    // the way up, and shows the iPod volume bar (swapped in for the scrubber via .mms-voladj),
    // which fades ~1s after the last movement. Setting media.volume is a no-op on iOS, hence
    // this is gated to the pop-out (allowVolume) - never shipped where it would be inert.
    var volFadeTimer = null;
    function adjustVolume(panel, frac) {
      var mp = hostCtl('media-player'); if (!mp) return;
      var v = Math.max(0, Math.min(1, (Number(mp.volume) || 0) + frac));
      mp.volume = v;
      if (mp.muted && frac > 0 && v > 0) { try { mp.muted = false; } catch (_) { /* ignore */ } } // unmute only on an UP nudge
      showVolume(panel, v);
    }
    function showVolume(panel, v) {
      if (!panel) return;
      var fill = panel.querySelector('.ip-vol-fill'); if (fill) fill.style.width = Math.round(v * 100) + '%';
      panel.classList.add('mms-voladj');
      var win = (panel.ownerDocument && panel.ownerDocument.defaultView) || window;
      // clear on the SAME window the timer was armed on (adversarial: a bare clearTimeout is a
      // DIFFERENT realm than win.setTimeout below - the debounce would never cancel, so the bar
      // could hide mid-spin, and a pop-out timer id could collide with an unrelated main-tab one).
      if (volFadeTimer != null) { try { (win.clearTimeout || clearTimeout)(volFadeTimer); } catch (_) { /* ignore */ } }
      volFadeTimer = (win.setTimeout || setTimeout)(function () {
        panel.classList.remove('mms-voladj'); volFadeTimer = null;
      }, 1000);
    }
    // Move the selection cursor to list POSITION `pos` (clamped): paint .is-cursor (the
    // blue bar) on that row alone and keep it visible. `center` (list-open) centers it;
    // otherwise (a spin step) it edge-follows - only scrolls when the row would leave the
    // viewport, like a real iPod. Scroll ONLY the list container, never the page.
    function setWheelCursor(panel, pos, center) {
      var lv = panel && panel.querySelector('.ip-listview'); if (!lv) return;
      var rows = lv.querySelectorAll('.mms-row'); if (!rows.length) return;
      pos = Math.max(0, Math.min(rows.length - 1, pos));
      wheelCursorRow = pos;
      for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('is-cursor', i === pos);
      var el = rows[pos];
      var raf = (typeof window !== 'undefined' && window.requestAnimationFrame) || function (cb) { return setTimeout(cb, 0); };
      raf(function () {
        // subtract lv.offsetTop: .ip-listview is position:static, so el.offsetTop is
        // measured from the nearest positioned ancestor (.mms-full), not the list -
        // it includes the status bar + LCD offset (mirrors the default panel's
        // scroll-to-current: mnpQueue.scrollTop = curRow.offsetTop - mnpQueue.offsetTop).
        var top = el.offsetTop - lv.offsetTop;
        if (center) lv.scrollTop = Math.max(0, top - (lv.clientHeight / 2) + (el.offsetHeight / 2));
        else if (top < lv.scrollTop) lv.scrollTop = top;
        else if (top + el.offsetHeight > lv.scrollTop + lv.clientHeight) lv.scrollTop = top + el.offsetHeight - lv.clientHeight;
      });
    }
    // iPod Now-Playing <-> song-list toggle (a transient class on the panel; a full
    // re-render resets it, so a track change returns you to Now Playing).
    function setIpodListMode(panel, on) {
      if (!panel) return;
      panel.classList.toggle('mms-listmode', !!on);
      var npEl = panel.querySelector('.ip-np');
      if (npEl) npEl.textContent = on ? 'Songs' : 'Now Playing';
      if (on) {
        // v1.232.5 (Dean): the list is the WHOLE album; on open, seed the cursor on the
        // current song and CENTER it so earlier tracks are above (scroll up) and later
        // below. From here the wheel spin moves the cursor (v1.233).
        var lv = panel.querySelector('.ip-listview');
        var rows = lv ? lv.querySelectorAll('.mms-row') : [];
        var startPos = 0;
        for (var i = 0; i < rows.length; i++) { if (rows[i].classList.contains('is-current')) { startPos = i; break; } }
        setWheelCursor(panel, startPos, true);
      } else {
        var cr = panel.querySelector('.ip-listview .mms-row.is-cursor');
        if (cr) cr.classList.remove('is-cursor');
        wheelCursorRow = -1;
      }
    }
    // v1.232 (Dean): overflowing title/artist/album lines SCROLL like a real iPod - on
    // ALL skins (v1.232.1 broadened to Apple/Spotify: .mms-ttl/.mms-sub/.mms-ctx too,
    // alongside iPod's .ip-*). Only when motion is allowed (else the line keeps its
    // ellipsis). Wraps the text in a .mms-mq span + sets the shift distance + a
    // constant-speed duration as CSS vars; the .mms-marquee keyframe animates it.
    function applySkinMarquee(panel) {
      if (!panel) return;
      try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (_) { /* keep going */ }
      var els = panel.querySelectorAll('.ip-ttl, .ip-artist, .ip-album, .mms-ttl, .mms-sub, .mms-ctx');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var over = el.scrollWidth - el.clientWidth;
        if (over > 2 && !el.querySelector('.mms-mq')) {
          var span = (el.ownerDocument || document).createElement('span'); // pop-out uses its own document
          span.className = 'mms-mq';
          span.textContent = el.textContent; // textContent both ways -> no injection
          el.textContent = '';
          el.appendChild(span);
          el.classList.add('mms-mq-on');
          el.style.setProperty('--mms-mq-shift', (-over) + 'px');
          el.style.setProperty('--mms-mq-dur', Math.max(4, over / 24).toFixed(1) + 's');
        }
      }
    }
    var skinReflectBound = false;
    function ensureSkinReflect() {
      if (skinReflectBound) return;
      var mp = hostCtl('media-player'); if (!mp) return;
      skinReflectBound = true;
      // v1.232.4: loadstart/emptied/durationchange fire on a prev/next track swap BEFORE
      // playback, so the bar resets to 0 promptly (no lingering old-track fill).
      ['play', 'pause', 'timeupdate', 'seeked', 'loadedmetadata', 'loadstart', 'emptied', 'durationchange'].forEach(function (ev) {
        mp.addEventListener(ev, reflectAllSkins, { signal: signal });
      });
    }
    // v1.237: the id the now-playing surfaces should treat as CURRENT. Prefer the
    // watcher-advanced chapter (chapterViewId) ONLY while the loaded chaptered file is STILL the
    // live track (same base id) - otherwise the override is stale (a different / non-music track
    // became live without loadTrack resetting us) and we must fall back to player.currentId so the
    // video/book cross-check in updateNowPlayingPanel keeps working (gate W1, both seats).
    function effectiveCurrentId() {
      var p = window.FileTube && window.FileTube.player;
      var live = (p && p.currentId) || null;
      // prefer the watcher-advanced chapter ONLY when the live track is itself a chapter track
      // (`::c` id) of the SAME file. A genuinely-loaded chapter always has a `::c` currentId, so
      // requiring it rejects the same file played as a RAW (non-music) video (live='film', no
      // `::c`) - which shares the base id but must NOT show stale music over it (adversarial W2).
      if (chapterViewId && live && /::c\d+$/.test(String(live)) && String(chapterViewId).replace(/::c\d+$/, '') === String(live).replace(/::c\d+$/, '')) return chapterViewId;
      return live;
    }
    // v1.237 chapter watcher: which chapter of the loaded chaptered file `currentTime` is IN.
    // Sorts the file's `::c` tracks by chapterStartSec FIRST (the album drill can be sorted/
    // shuffled, so queue order is not necessarily ascending - gate W2), then takes the greatest
    // start <= t. A small tolerance avoids boundary flicker. null when not on a chaptered file.
    function currentChapterId() {
      if (!chapterViewId) return null;
      var mp = hostCtl('media-player'); if (!mp) return chapterViewId;
      var t = Number(mp.currentTime) || 0;
      var base = String(chapterViewId).replace(/::c\d+$/, '');
      var chaps = queue.filter(function (x) { return x && x.source === 'library-chapter' && String(x.id).replace(/::c\d+$/, '') === base; });
      if (!chaps.length) return chapterViewId;
      chaps = chaps.slice().sort(function (a, b) { return (Number(a.chapterStartSec) || 0) - (Number(b.chapterStartSec) || 0); });
      var cur = chaps[0].id;
      for (var i = 0; i < chaps.length; i++) {
        if (t >= (Number(chaps[i].chapterStartSec) || 0) - 0.25) cur = chaps[i].id; else break;
      }
      return cur;
    }
    // v1.240: [start, end) of the currently-DISPLAYED chapter (chapterViewId) within the shared
    // file - start = its chapterStartSec, end = the NEXT chapter's start (sorted ascending) or
    // the file duration for the last chapter. null when not on a chaptered file or the duration
    // is unknown. Feeds the chapter-loop (enforceChapterLoop).
    function currentChapterBounds() {
      if (!chapterViewId) return null;
      var mp = hostCtl('media-player'); if (!mp) return null;
      var base = String(chapterViewId).replace(/::c\d+$/, '');
      var chaps = queue.filter(function (x) { return x && x.source === 'library-chapter' && String(x.id).replace(/::c\d+$/, '') === base; });
      if (!chaps.length) return null;
      chaps = chaps.slice().sort(function (a, b) { return (Number(a.chapterStartSec) || 0) - (Number(b.chapterStartSec) || 0); });
      var idx = -1;
      for (var i = 0; i < chaps.length; i++) { if (chaps[i].id === chapterViewId) { idx = i; break; } }
      if (idx === -1) return null;
      var start = Number(chaps[idx].chapterStartSec) || 0;
      var dur = (isFinite(mp.duration) && mp.duration > 0) ? mp.duration : 0;
      var end = (idx + 1 < chaps.length) ? (Number(chaps[idx + 1].chapterStartSec) || dur) : dur;
      if (!(end > start)) return null; // unknown/zero duration on the last chapter -> can't bound
      return { start: start, end: end };
    }
    // On a boundary CROSS (the file rolled into the next chapter), update the DISPLAYED identity
    // (nowPlaying + playingId + highlight) and repaint the now-playing (web panel + skins +
    // pop-out) WITHOUT reloading - the same file keeps playing. Cheap: only acts when the derived
    // chapter actually changed (once per boundary), never on every timeupdate tick.
    function reflectChapter() {
      if (!chapterViewId) return;
      var id = currentChapterId();
      if (!id || id === chapterViewId) return;
      chapterViewId = id;
      playingId = id;
      var t = null;
      for (var i = 0; i < queue.length; i++) { if (queue[i] && queue[i].id === id) { t = queue[i]; break; } }
      if (t) nowPlaying = { id: id, title: t.title || '', artist: t.artist || '', album: t.album || '', albumKey: t.albumKey || '' };
      applyPlayingHighlight();
      updateNowPlayingPanel();
      updateNowPlaying(); // v1.237: keep the "Playing from <Album>" line in step (it keys off the current id too)
    }
    // v1.240 (Dean's loop bug): loop the CURRENT chapter's segment when Loop is on and a
    // chaptered `::c` track is playing. The file-level loop (player 'ended' -> replay from 0)
    // only fires at the WHOLE file's end, so it never loops a single chapter (a slice of the
    // shared file - Dean confirmed a standalone song DOES loop). This seeks back to the
    // chapter's start when the playhead reaches its end boundary, keeping playback - and so the
    // reflected identity - inside the chapter. Skipped during a wheel SCRUB so a deliberate
    // scrub past the boundary is not yanked back mid-drag (the v1.239 carried interaction).
    function enforceChapterLoop() {
      if (!chapterViewId) return;
      if (wheelSpin && wheelSpin.mode === 'scrub') return;
      var pl = window.FileTube && window.FileTube.player;
      try { if (!pl || typeof pl.isLoopEnabled !== 'function' || !pl.isLoopEnabled()) return; } catch (_) { return; }
      var mp = hostCtl('media-player'); if (!mp) return;
      var b = currentChapterBounds(); if (!b) return;
      // Fire only in a TIGHT band around the boundary: [end-0.25, end+1). The scrub-skip guard
      // above only covers a live drag; the FINAL scrub position's timeupdate can land AFTER
      // pointerup (async media events), when wheelSpin is already null but chapterViewId is
      // still the pre-scrub chapter (reflectChapter runs after this). Without the upper cap
      // that stale tick would yank a deliberate forward-scrub-to-a-far-chapter back to the old
      // chapter's start (QA gate WARNING). end+1 clears every normal-playback tick (~119.9)
      // yet rejects a far stale position (250 vs a {0,120} chapter).
      if (mp.currentTime >= b.end - 0.25 && mp.currentTime < b.end + 1 && mp.currentTime > b.start) {
        try { mp.currentTime = b.start; } catch (_) { /* ignore a bad set */ }
      }
    }
    var chapterReflectBound = false;
    function ensureChapterReflect() {
      if (chapterReflectBound) return;
      var mp = hostCtl('media-player'); if (!mp) return;
      chapterReflectBound = true;
      // bound independently of the skin reflect so it runs on the DESKTOP web now-playing too
      // (where the skin, hence ensureSkinReflect, never engages). timeupdate is enough - the
      // chapter boundary is a position threshold. enforceChapterLoop is bound FIRST so a loop
      // seek-back lands before reflectChapter can advance the displayed chapter past the boundary.
      mp.addEventListener('timeupdate', enforceChapterLoop, { signal: signal });
      mp.addEventListener('timeupdate', reflectChapter, { signal: signal });
    }
    // ---- v1.238: the "sticker" quick-menu (speed + loop + skin picker) ----------
    // A FileTube-logo sticker in the bottom-left corner of EVERY skin (and the desktop
    // pop-out) opens a compact menu. The icon is a PER-USER setting (ft-sticker): the
    // FileTube mark (default), an emoji, or a custom uploaded image (/api/me/sticker,
    // the T1 endpoint). The menu items PROXY the existing controls so player.js stays
    // BYTE-UNCHANGED:
    //   speed -> #media-player.playbackRate AND defaultPlaybackRate (the latter is what
    //            survives the next load(); player.js reads 'ft-rate' only once at init) +
    //            persist 'ft-rate' for a page-reload re-apply,
    //   loop  -> window.FileTube.player.setLoop / isLoopEnabled (FR-7, v1.22.0),
    //   skin  -> SKINS.setActiveSkin (the same call the Settings picker makes).
    // injectSticker runs inside paintSkin so the sticker lands on every skin AND the
    // pop-out uniformly, never as per-skin markup.
    var STICKER_KEY = 'ft-sticker';
    var RATE_KEY = 'ft-rate'; // MUST match player.js RATE_STORAGE_KEY (player.js re-reads it on every load)
    // MUST mirror player.js PLAYBACK_RATES - source-locked behaviorally in music-sticker-menu.test.js.
    var MMS_SPEED_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

    function readStickerPref() {
      try {
        var raw = window.localStorage.getItem(STICKER_KEY);
        if (!raw) return { kind: 'logo' };
        var o = JSON.parse(raw);
        if (o && (o.kind === 'logo' || o.kind === 'emoji' || o.kind === 'custom')) return o;
      } catch (_) { /* private mode / bad json -> default */ }
      return { kind: 'logo' };
    }
    // v1.241 (Dean): a placed-sticker feel - a SIZE (default/2x/3x/5x) and a TILT
    // (straight/left/right) are per-user settings on ft-sticker; injectSticker maps them to
    // CSS classes on the button. Both fall back to the defaults on an unknown/absent value.
    var STICKER_SIZES = ['default', '2x', '3x', '5x'];
    var STICKER_TILTS = ['straight', 'left', 'right'];
    function stickerSize() { var s = readStickerPref().size; return STICKER_SIZES.indexOf(s) >= 0 ? s : 'default'; }
    function stickerTilt() { var t = readStickerPref().tilt; return STICKER_TILTS.indexOf(t) >= 0 ? t : 'left'; }
    function stickerIconHtml() {
      var p = readStickerPref();
      if (p.kind === 'emoji' && p.value) return '<span class="mms-sticker-emoji" aria-hidden="true">' + escapeMusicHtml(p.value) + '</span>';
      if (p.kind === 'custom') return '<img class="mms-sticker-ic" src="/api/me/sticker' + (p.v ? '?v=' + encodeURIComponent(p.v) : '') + '" alt="" />';
      return '<img class="mms-sticker-ic" src="/favicon.svg" alt="" />';
    }
    function liveRate() {
      var mp = hostCtl('media-player');
      var r = mp && Number(mp.playbackRate);
      return (r && MMS_SPEED_RATES.indexOf(r) !== -1) ? r : 1;
    }
    function liveLoop() {
      var pl = window.FileTube && window.FileTube.player;
      try { return !!(pl && typeof pl.isLoopEnabled === 'function' && pl.isLoopEnabled()); } catch (_) { return false; }
    }
    function buildStickerMenuHtml() {
      var rate = liveRate();
      var speed = MMS_SPEED_RATES.map(function (r) {
        var on = r === rate;
        return '<button type="button" role="menuitemradio" class="mms-sm-opt' + (on ? ' is-on' : '') +
          '" data-skin-speed="' + r + '" aria-checked="' + (on ? 'true' : 'false') + '">' +
          (r === 1 ? 'Normal' : r + '×') + '</button>';
      }).join('');
      var loopOn = liveLoop();
      var skins = (SKINS && SKINS.SKINS) ? SKINS.SKINS : [];
      var active = (SKINS && SKINS.activeSkinId) ? SKINS.activeSkinId() : '';
      var chips = skins.map(function (s) {
        var on = s.id === active;
        return '<button type="button" role="menuitemradio" class="mms-sm-chip' + (on ? ' is-on' : '') +
          '" data-skin-pick="' + escapeMusicHtml(s.id) + '" aria-checked="' + (on ? 'true' : 'false') + '">' +
          escapeMusicHtml(s.label) + '</button>';
      }).join('');
      return '<div class="mms-sm-sec"><div class="mms-sm-h">Speed</div><div class="mms-sm-speed">' + speed + '</div></div>' +
        '<div class="mms-sm-sec"><button type="button" role="menuitemcheckbox" class="mms-sm-loop' + (loopOn ? ' is-on' : '') +
        '" data-skin-loop aria-checked="' + (loopOn ? 'true' : 'false') + '"><span class="mms-sm-h">Loop</span><span class="mms-sm-state">' + (loopOn ? 'On' : 'Off') + '</span></button></div>' +
        '<div class="mms-sm-sec"><div class="mms-sm-h">Skin</div><div class="mms-sm-skins">' + chips + '</div></div>';
    }
    // Inject the sticker + its (initially hidden) menu into a freshly-painted panel.
    function injectSticker(panel) {
      if (!panel) return;
      var doc = panel.ownerDocument || document;
      var wrap = doc.createElement('div');
      wrap.className = 'mms-sticker-wrap';
      // v1.240 (Dean): an IMAGE sticker (logo or custom upload) shows SQUARE at the spot with
      // no circular ring/clip; only an emoji keeps the round chip (legibility on any skin).
      // Key the marker off what stickerIconHtml ACTUALLY renders: an emoji chip needs a
      // truthy value, else it falls through to the logo <img> (a partial {kind:'emoji'} pref
      // with no value would otherwise wrongly circle a logo image - both gate seats).
      var pref = readStickerPref();
      var imgCls = (pref.kind === 'emoji' && pref.value) ? '' : ' mms-sticker--img';
      var szCls = ' mms-sticker-sz-' + stickerSize();     // default | 2x | 3x | 5x
      var tiltCls = ' mms-sticker-tilt-' + stickerTilt();  // straight | left | right
      wrap.innerHTML =
        '<button type="button" class="mms-sticker' + imgCls + szCls + tiltCls + '" data-skin-sticker aria-haspopup="true" aria-expanded="false" aria-label="Player options">' + stickerIconHtml() + '</button>' +
        '<div class="mms-sticker-menu" data-skin-sticker-menu role="menu" hidden>' + buildStickerMenuHtml() + '</div>';
      panel.appendChild(wrap);
    }
    function refreshStickerMenu(panel) {
      var menu = panel && panel.querySelector('[data-skin-sticker-menu]');
      if (menu) menu.innerHTML = buildStickerMenuHtml();
    }
    function closeStickerMenu(panel) {
      var menu = panel && panel.querySelector('[data-skin-sticker-menu]');
      var btn = panel && panel.querySelector('[data-skin-sticker]');
      if (menu) menu.hidden = true;
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
    function applyStickerSpeed(rate) {
      var r = Number(rate);
      if (MMS_SPEED_RATES.indexOf(r) === -1) return;
      var mp = hostCtl('media-player');
      if (mp) {
        mp.playbackRate = r;
        // v1.238 gate CRITICAL (both seats): set defaultPlaybackRate TOO. The HTML load()
        // algorithm resets playbackRate to defaultPlaybackRate on every new resource, and
        // player.js reads ft-rate only ONCE at page init (no per-load reapply) - so WITHOUT
        // this the chosen rate silently reverts to 1x on the next track's load() (the
        // v1.22.1 bug class). This mirrors player.js applyPlaybackRate (5363-5368), which
        // sets BOTH properties for exactly this reason.
        mp.defaultPlaybackRate = r;
      }
      // Persist ft-rate as well so a full page reload re-applies the rate via player.js's
      // one-shot initPlaybackRate (the mid-session carry is defaultPlaybackRate above).
      try { window.localStorage.setItem(RATE_KEY, String(r)); } catch (_) { /* best-effort */ }
    }
    function toggleStickerLoop() {
      var pl = window.FileTube && window.FileTube.player;
      if (pl && typeof pl.setLoop === 'function') pl.setLoop(!liveLoop());
    }

    // Paint the chosen skin `id` into ANY panel (the in-tab mobile surface OR the desktop
    // pop-out window) - the shared render used by both. Sets the class chain, renders the
    // ctx, shimmers the art, and starts the marquee. `doc` is the panel's document (pop-out
    // has its own) for the rAF/shimmer.
    function paintSkin(panel, id, ci) {
      // v1.232: a skin may declare a `base` (e.g. iPod Black -> base 'ipod'), so the panel
      // ALSO gets the base class + all its shared CSS; the id class overrides the palette.
      var base = (typeof SKINS.skinById === 'function' && (SKINS.skinById(id) || {}).base) || '';
      panel.className = 'music-nowplaying-panel mms mms-full mms-' + id + (base ? ' mms-' + base : '');
      // v1.233 (QA finding): a re-render (e.g. a track auto-advance) detaches the wheel
      // element, so a live gesture's pointerup would never reach its onUp -> endWheel and
      // wheelSpin would stick non-null, wedging every later spin ("one gesture at a time").
      // Drop the mid-gesture state here; the detached wheel's element-local listeners GC
      // with it, and wheelCursorRow is re-seeded when the list is next opened.
      wheelSpin = null;
      panel.innerHTML = SKINS.renderFull(id, buildSkinCtx(ci));
      injectSticker(panel); // v1.238: the speed/loop/skin quick-menu, on every skin + the pop-out
      panel.hidden = false;
      if (window.FileTube && typeof window.FileTube.shimmerArt === 'function') window.FileTube.shimmerArt(panel);
      // measure + start the marquee AFTER layout (rAF), so scrollWidth is real.
      var win = (panel.ownerDocument && panel.ownerDocument.defaultView) || window;
      var raf = (win && win.requestAnimationFrame) || function (cb) { return setTimeout(cb, 0); };
      raf(function () { applySkinMarquee(panel); });
    }
    // Render the active skin into the in-tab panel (returns true if it took over).
    function renderNowPlayingSkin(ci) {
      if (!SKINS || !skinIsActive()) { document.body.classList.remove('mms-on'); return false; }
      var id = SKINS.activeSkinId();
      document.body.classList.add('mms-on'); // CSS hides the default host chrome on mobile+music
      paintSkin(nowPlayingPanel, id, ci);
      ensureSkinReflect();
      return true;
    }

    // Redesign S1: the "Jump back in" strip above the tabs - what you were last
    // playing, one tap to resume (playTrackFromContinue applies the saved
    // position). Populated ONCE on init from the recently-played list; hidden
    // when empty so it never leaves a bare header. Its own art-reveal (the strip
    // lives outside #music-content, so revealMusicArt doesn't reach it).
    async function renderJumpBackIn() {
      if (!jumpbackHost) return;
      var items = [];
      try {
        var data = await fetchJson('/api/music?filter=recent-listening&limit=12');
        items = Array.isArray(data.items) ? data.items : [];
      } catch (_) { items = []; }
      if (!items.length) { jumpbackHost.hidden = true; jumpbackHost.innerHTML = ''; return; }
      jumpbackHost.innerHTML = '<h2 class="music-jump-head">Jump back in</h2>' +
        '<div class="music-jump-row">' + items.map(buildJumpBackTileHtml).join('') + '</div>';
      jumpbackHost.hidden = false;
      if (window.FileTube && typeof window.FileTube.shimmerArt === 'function') window.FileTube.shimmerArt(jumpbackHost);
    }
    if (jumpbackHost) {
      jumpbackHost.addEventListener('click', function (e) {
        var tile = e.target && typeof e.target.closest === 'function' ? e.target.closest('.music-jump-tile') : null;
        if (!tile) return;
        var id = tile.getAttribute('data-id');
        if (id) playTrackFromContinue(id).catch(function () {});
      }, { signal: signal });
    }

    // v1.44.2: reflect the "Playing from <Album>" line for the currently-playing
    // music track. Re-checks player.currentId each call so it hides when a
    // video/book is what's playing, or the player was closed.
    function updateNowPlaying() {
      if (!nowPlayingEl) return;
      // v1.237: the effective current id (a watcher-advanced chapter while its file is live, else
      // the live player id) so the label matches the panel after a chapter roll (gate W2) and
      // still blanks for a video/book on the shared host.
      var currentId = effectiveCurrentId();
      var label = deriveNowPlayingLabel(nowPlaying, currentId);
      if (label) {
        nowPlayingEl.textContent = label;
        nowPlayingEl.hidden = false;
        nowPlayingEl.setAttribute('data-album-key', (nowPlaying && nowPlaying.albumKey) || '');
      } else {
        nowPlayingEl.hidden = true;
        nowPlayingEl.removeAttribute('data-album-key');
      }
      updateNowPlayingPanel();
    }

    // v1.104: the expanded now-playing panel (metadata + up-next queue). Shown
    // ONLY when the player is EXPANDED (state 'full') AND the music track we last
    // loaded is what's actually playing (so a closed player, or a video/book on
    // the shared host, hides it - never stale metadata). Up-next is the queue
    // AFTER the playing track; each row's data-index is the real queue index.
    // Re-derived on every call (track change, expand, close) - the reveal-once
    // both-axes contract: reveal when expanded+playing, CLEAR otherwise.
    function updateNowPlayingPanel() {
      if (!nowPlayingPanel) return;
      // v1.234: keep the desktop pop-out in step with the track/skin (this is the seam every
      // track change routes through, via playAt) and refresh the pop-out button's visibility.
      // Independent of the in-tab expanded/docked branch below, so a docked pop-out still updates.
      repaintPopout();
      updatePopoutBtn();
      ensureChapterReflect(); // arm the chapter-boundary watcher once the player element is live (idempotent)
      var p = window.FileTube && window.FileTube.player;
      var expanded = !!(p && typeof p.getState === 'function' && p.getState() === 'full');
      // v1.237: prefer the chapter the VIEW displays (which the watcher advances as playback
      // rolls) over the loaded ::c id, so the guard + `ci` below track the CURRENT chapter, not
      // the one that was loaded. null for a non-chaptered track (chapterViewId stays null).
      var curId = effectiveCurrentId();
      if (!expanded || !nowPlaying || !curId || nowPlaying.id !== curId) {
        nowPlayingPanel.hidden = true;
        nowPlayingPanel.innerHTML = '';
        nowPlayingPanel.className = 'music-nowplaying-panel'; // drop any skin classes
        document.body.classList.remove('mms-on'); // restore the default host chrome
        if (theaterBtn) theaterBtn.hidden = true; // no expanded track -> no theatre toggle
        return;
      }
      var ci = -1;
      for (var k = 0; k < queue.length; k++) { if (queue[k].id === curId) { ci = k; break; } }
      // v1.227 mobile skins: on mobile + music, the panel becomes the chosen
      // full-screen skin (which owns its own transport, art + up-next). Takes over
      // completely; the desktop theatre toggle + default panel are skipped.
      if (renderNowPlayingSkin(ci)) { if (theaterBtn) theaterBtn.hidden = true; return; }
      if (theaterBtn) theaterBtn.hidden = false; // a track is expanded -> the toggle is available (desktop-gated by CSS)
      // v1.223 (Dean): the panel lists the WHOLE queue - played tracks (before the
      // current) greyed but clickable, the current one marked, the rest up next -
      // so the list never shrinks. The 200-row cap is a WINDOW anchored near the
      // current track (a little jump-back history + the current + up next), NOT the
      // queue start - else a deep current index (the Songs tab loads up to 1000)
      // would fill the cap with only played rows, hiding the current + up-next
      // (gate WARNING).
      var rows = [];
      if (ci >= 0) {
        var start = Math.max(0, ci - 20); // keep a little history for jump-back
        for (var j = start; j < queue.length && rows.length < 200; j++) {
          rows.push({
            id: queue[j].id, title: queue[j].title, artist: queue[j].artist, index: j,
            state: j < ci ? 'played' : (j === ci ? 'current' : 'next'),
          });
        }
      }
      nowPlayingPanel.innerHTML = buildNowPlayingPanelHtml(nowPlaying, rows);
      nowPlayingPanel.hidden = false;
      if (window.FileTube && typeof window.FileTube.shimmerArt === 'function') window.FileTube.shimmerArt(nowPlayingPanel);
      // v1.224 (Dean): the up-next now includes played history above the current
      // row, so scroll the (bounded, scrollable) list to the PLAYING song - it's
      // always visible when you pick a track, no hunting. Scroll only WITHIN the
      // queue box (scrollTop), never the page. Layout math is a no-op in jsdom.
      // v1.225 (Dean device): DEFER to the next frame - the panel can render compact
      // then grow to the full queue on a follow-up render, and a synchronous scroll
      // landed on the pre-growth layout (the song scrolled right for a frame, then
      // the taller list pushed it out). rAF reads offsetTop AFTER the final layout.
      var mnpQueue = nowPlayingPanel.querySelector('.mnp-queue');
      var curRow = nowPlayingPanel.querySelector('.mnp-queue-row.is-current');
      var isTheater = !!(musicStage && musicStage.classList.contains('is-theater'));
      var settleNowPlaying = function () {
        // v1.226 (Dean device): in THEATRE the up-next sits BESIDE the player; when
        // the queue fills it can grow TALLER than the player and grow the whole
        // stage, shoving "Jump back in" + the tabs/content down (the return flash).
        // MEASURE the player and cap THIS panel to its height so the up-next scrolls
        // INSIDE instead - the stage stays put, nothing below shifts. Cleared
        // off-theatre so the panel flows normally. (Measure the container, per the
        // norm - never guess a CSS-var height.)
        try {
          if (isTheater) {
            var slotEl = root.querySelector('#player-slot');
            var ph = slotEl ? slotEl.getBoundingClientRect().height : 0;
            nowPlayingPanel.style.maxHeight = ph > 120 ? (ph + 'px') : '';
          } else {
            nowPlayingPanel.style.maxHeight = '';
          }
        } catch (_) { /* no layout */ }
        // then scroll the current row into the (now-bounded) queue - scrollTop only,
        // never the page. offsetTop is read AFTER the cap so the position is final.
        if (mnpQueue && curRow) {
          try { mnpQueue.scrollTop = Math.max(0, (curRow.offsetTop - mnpQueue.offsetTop) - 8); } catch (_) { /* no layout */ }
        }
      };
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(settleNowPlaying);
      else settleNowPlaying();
    }
    // Tapping an up-next row jumps to that queue index (stays expanded via T1).
    // v1.227: the skin's data-skin-* hooks PROXY to the player's existing hidden
    // controls (play/prev/next), so the battle-won engine (gesture-prime, bg-audio,
    // MediaSession, setTrackNav) runs unchanged - the skin never calls audio itself.
    // v1.234: bind the skin's action hooks + wheel gesture to a panel, so BOTH the in-tab
    // mobile surface AND the desktop pop-out window (Document PiP / independent window) share
    // ONE implementation. `panel` is the surface; `sig` is the AbortSignal that unbinds it
    // (the view's `signal` for the in-tab panel; a pop-out session's own controller for the
    // pop-out). All the transport hooks proxy to the MAIN document's controls (hostCtl uses
    // the main document), so a click in the pop-out still drives the real player.
    function bindSkinSurface(panel, sig, opts) {
      if (!panel) return;
      // v1.235: allowVolume => in Now Playing, a wheel spin sets VOLUME (the desktop pop-out,
      // where media.volume is settable). Off for the in-tab skin (iPhone: volume is read-only,
      // so a Now-Playing spin stays a no-op rather than shipping inert).
      var allowVolume = !!(opts && opts.allowVolume);
      skinSurfaces.push(panel);   // reflectAllSkins fans live-element updates to every surface
      panel.addEventListener('click', function (e) {
        // v1.233: a wheel SPIN that ended over a zone button would fire a synthetic click
        // on release - swallow exactly that one (the flag is set on a moved pointerup and
        // cleared here or on the next pointerdown, so it never eats a later real tap).
        if (wheelSuppressClick) { wheelSuppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
        // v1.238: the sticker quick-menu. The sticker button toggles it; the menu items
        // proxy speed/loop/skin. Handle these FIRST and return so they never fall through
        // to the transport/seek/queue hooks below.
        if (e.target.closest('[data-skin-sticker]')) {
          var mn = panel.querySelector('[data-skin-sticker-menu]');
          var sbtn = panel.querySelector('[data-skin-sticker]');
          if (mn) {
            var willOpen = mn.hidden;
            if (willOpen) refreshStickerMenu(panel); // reflect the live rate/loop/skin on open
            mn.hidden = !willOpen;
            if (sbtn) sbtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
          }
          e.stopPropagation();
          return;
        }
        var spOpt = e.target.closest('[data-skin-speed]');
        if (spOpt) { applyStickerSpeed(spOpt.getAttribute('data-skin-speed')); refreshStickerMenu(panel); return; }
        if (e.target.closest('[data-skin-loop]')) { toggleStickerLoop(); refreshStickerMenu(panel); return; }
        var pick = e.target.closest('[data-skin-pick]');
        if (pick) {
          var sid = pick.getAttribute('data-skin-pick');
          if (SKINS && typeof SKINS.setActiveSkin === 'function') SKINS.setActiveSkin(sid);
          closeStickerMenu(panel);
          updateNowPlayingPanel(); // re-render both surfaces with the newly-picked skin
          return;
        }
        // A click anywhere that is NOT inside the sticker wrap closes an open menu (then
        // falls through to normal handling so the tapped control still acts).
        var openSm = panel.querySelector('[data-skin-sticker-menu]:not([hidden])');
        if (openSm && !e.target.closest('.mms-sticker-wrap')) closeStickerMenu(panel);
        // Skin PICKING also lives on the Settings page (v1.230); this panel carries the
        // transport/seek/queue hooks. A skin change persists to ft-music-skin and is
        // picked up when this view next renders (renderNowPlayingSkin re-reads it).
        if (e.target.closest('[data-skin-play]')) { var pb = hostCtl('pp-btn'); if (pb) pb.click(); return; }
        if (e.target.closest('[data-skin-prev]')) { var pv = hostCtl('track-prev-btn'); if (pv) pv.click(); return; }
        if (e.target.closest('[data-skin-next]')) { var nx = hostCtl('track-next-btn'); if (nx) nx.click(); return; }
        if (e.target.closest('[data-skin-collapse]')) { var pl = window.FileTube && window.FileTube.player; if (pl && typeof pl.dock === 'function') { pl.dock(); updateNowPlayingPanel(); } return; }
        // v1.231 iPod: Shuffle proxies to the music view's own #music-shuffle-btn (the
        // skin only renders inside this view, so the button is always co-present).
        if (e.target.closest('[data-skin-shuffle]')) { var sh = hostCtl('music-shuffle-btn'); if (sh) sh.click(); return; }
        // iPod MENU = back one level: from the song LIST -> Now Playing; from Now
        // Playing -> dock/exit the full-screen player (the way out, no header needed).
        if (e.target.closest('[data-skin-menu]')) {
          if (panel.classList.contains('mms-listmode')) { setIpodListMode(panel, false); }
          else { var plm = window.FileTube && window.FileTube.player; if (plm && typeof plm.dock === 'function') { plm.dock(); updateNowPlayingPanel(); } }
          return;
        }
        // iPod Select (center): from Now Playing it OPENS the song list; in the list it
        // PLAYS the cursor-highlighted song (v1.233, the authentic iPod center-select),
        // then returns to Now Playing. MENU (above) is the way back out without playing.
        if (e.target.closest('[data-skin-select]')) {
          if (panel.classList.contains('mms-listmode')) {
            var cur = panel.querySelector('.ip-listview .mms-row.is-cursor');
            var cgi = cur && parseInt(cur.getAttribute('data-skin-go'), 10);
            setIpodListMode(panel, false);
            if (cur && !isNaN(cgi)) playAt(cgi);
          } else { setIpodListMode(panel, true); }
          return;
        }
        var seek = e.target.closest('[data-skin-seek]');
        if (seek) {
          // Proxy to the host #seek-bar (a 0..1 ratio input): its 'change' handler
          // owns the WHOLE seek pipeline - seekCommitTarget, chapter-loop disarm,
          // currentTime, AND saveProgressToServer. So a skin scrub persists like a
          // real one, not just on the next periodic save.
          var sb = hostCtl('seek-bar');
          if (sb) {
            var rct = seek.getBoundingClientRect();
            var frac = Math.min(1, Math.max(0, (e.clientX - rct.left) / (rct.width || 1)));
            sb.value = String(frac);
            sb.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return;
        }
        var sgo = e.target.closest('[data-skin-go]');
        if (sgo) { var gi = parseInt(sgo.getAttribute('data-skin-go'), 10); if (!isNaN(gi)) { setIpodListMode(panel, false); playAt(gi); } return; }
        var row = e.target.closest('.mnp-queue-row');
        if (!row) return;
        var idx = parseInt(row.getAttribute('data-index'), 10);
        if (!isNaN(idx)) playAt(idx);
      }, { signal: sig });

      // v1.233: the iPod click wheel is a real ROTARY SCROLL. Spinning it with the song
      // list open moves the selection cursor song-by-song; a fast flick ACCELERATES;
      // center then plays the highlighted song. In NOW PLAYING the spin is not idle
      // (v1.239): it sets VOLUME on the desktop pop-out (allowVolume) and SCRUBS the
      // timeline on the in-tab mobile skin (iOS volume is read-only). Only the iPod skin
      // renders a wheel. (Pointer events => a desktop pop-out spins it with a MOUSE drag.)
      //
      // Why POINTER events, not touch: a document-level non-passive touchmove is a
      // scroll-perf regression (the v1.160.1 scar) - passivity is static to the
      // registration. Pointer events carry no such penalty AND setPointerCapture keeps the
      // stream on the wheel with no global listener at all. Teardown discipline (the v1.163
      // scar): move/up/cancel are added on pointerdown and REMOVED on every end arm
      // (endWheel), and capture is taken LAZILY - only once the gesture is confirmed a spin
      // - so a plain TAP on a zone/center button still fires its click untouched.
      var WHEEL_STEP_DEG = 22;   // wheel degrees per one-song cursor step
      function wheelShortAngle(a) { while (a > 180) a -= 360; while (a < -180) a += 360; return a; }
      // End the gesture `st`: unbind ITS listeners + release ITS capture. Takes the st
      // explicitly (not the live wheelSpin) so a stale end-arm - e.g. a detached wheel's
      // late pointerup after paintSkin already dropped the gesture (QA finding) - tears down
      // only its own element and never a newer gesture. wheelSpin is nulled only if it
      // still IS this st.
      function endWheel(st, suppress) {
        var w = st.wheel;
        // v1.242: tear down any fast-scan hold-timer / interval on EVERY end arm (the v1.163
        // dual-arm teardown discipline) so a pointerup OR pointercancel stops the scan clean.
        if (st.scanTimer) { try { st.win.clearTimeout(st.scanTimer); } catch (_) { /* ignore */ } st.scanTimer = null; }
        if (st.scanInterval) { try { st.win.clearInterval(st.scanInterval); } catch (_) { /* ignore */ } st.scanInterval = null; }
        try { if (st.captured) w.releasePointerCapture(st.id); } catch (_) { /* not captured */ }
        w.removeEventListener('pointermove', st.onMove);
        w.removeEventListener('pointerup', st.onUp);
        w.removeEventListener('pointercancel', st.onUp);
        // a spin that actually moved swallows the release's synthetic click (below);
        // a pure tap (no move) leaves the flag false so the zone's click proceeds.
        if (suppress) wheelSuppressClick = true;
        if (wheelSpin === st) wheelSpin = null;
      }
      panel.addEventListener('pointerdown', function (e) {
        // any fresh touch starts clean, so a stale suppress can never eat a real tap.
        wheelSuppressClick = false;
        if (wheelSpin) return;                                    // one gesture at a time
        // LIST mode -> cursor scroll. NOW PLAYING -> VOLUME on the desktop pop-out
        // (allowVolume; media.volume is settable there), else SCRUB the timeline (v1.239,
        // Dean): on the in-tab iPhone skin iOS makes media.volume read-only, so a Now-Playing
        // spin scrubs the playhead instead - the useful mobile analog of the pop-out's
        // wheel-volume. Every Now-Playing spin now does something (no early return).
        var listMode = panel.classList.contains('mms-listmode');
        var wheel = e.target.closest('.ip-wheel'); if (!wheel) return;
        var r = wheel.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        // ignore a press on the dead center (the Select button): no capture, tap passes through.
        if (Math.hypot(e.clientX - cx, e.clientY - cy) < r.width * 0.2) return;
        var now0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var st = { wheel: wheel, id: e.pointerId, captured: false, moved: false,
          mode: listMode ? 'cursor' : (allowVolume ? 'volume' : 'scrub'), scrubRatio: null,
          lastAngle: Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI,
          lastT: now0, accum: 0, x0: e.clientX, y0: e.clientY, onMove: null, onUp: null };
        // v1.242 (#2, Dean): HOLD the rewind/ffwd zone to FAST-SCAN the timeline (~2x, audio
        // keeps playing); release resumes where it landed. Independent of st.mode - keyed off
        // the pressed ZONE. A quick TAP still skips a track (the hold never fires); a ROTATE
        // becomes a scrub/cursor (cancels the hold-timer). Steps currentTime on the PANEL's own
        // window timer so a Document-PiP pop-out (which throttles the opener) still scans.
        var win = (panel.ownerDocument && panel.ownerDocument.defaultView) || window;
        st.win = win; st.scanDir = e.target.closest('[data-skin-next]') ? 1 : (e.target.closest('[data-skin-prev]') ? -1 : 0);
        st.scanTimer = null; st.scanInterval = null; st.scanning = false;
        function startScan() {
          var mp0 = hostCtl('media-player');
          var d0 = (mp0 && isFinite(mp0.duration) && mp0.duration > 0) ? mp0.duration : 0;
          if (!d0) return; // nothing to scan (still loading) - leave it a plain tap/skip
          st.scanning = true; st.moved = true; // moved => the release's skip click is suppressed
          try { st.wheel.setPointerCapture(st.id); st.captured = true; } catch (_) { /* best effort */ }
          var step = function () {
            var m = hostCtl('media-player');
            var d = (m && isFinite(m.duration) && m.duration > 0) ? m.duration : 0;
            if (!d) return;
            m.currentTime = Math.min(d, Math.max(0, (Number(m.currentTime) || 0) + st.scanDir * 0.4)); // ~2x realtime
          };
          step();                                   // react immediately on the hold, then keep going
          st.scanInterval = win.setInterval(step, 200);
        }
        if (st.scanDir) st.scanTimer = win.setTimeout(function () { st.scanTimer = null; if (!st.moved) startScan(); }, 400);
        st.onMove = function (ev) {
          if (ev.pointerId !== st.id) return;   // ignore a SECOND finger's moves (adversarial S1: else its coords difference against finger A's angle -> a jumpy jump)
          var ang = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
          var d = wheelShortAngle(ang - st.lastAngle); st.lastAngle = ang;
          var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          var dt = Math.max(1, now - st.lastT); st.lastT = now;
          st.accum += d;
          // confirm it's a spin once travel passes a small threshold: mark moved (so the
          // click is suppressed) and take pointer capture (so drift off the ring keeps
          // feeding moves). A pure tap never crosses this, so its click stays intact.
          if (!st.moved && Math.hypot(ev.clientX - st.x0, ev.clientY - st.y0) > 8) {
            st.moved = true;
            // a ROTATE is a scrub/cursor, not a scan: cancel the pending hold so it never scans.
            if (st.scanTimer) { try { st.win.clearTimeout(st.scanTimer); } catch (_) { /* ignore */ } st.scanTimer = null; }
            try { st.wheel.setPointerCapture(st.id); st.captured = true; } catch (_) { /* best effort */ }
          }
          if (st.mode === 'volume') {
            // continuous: a full 360deg turn sweeps the whole 0..1 range; clockwise (+) louder.
            // NOTE: click-suppression uses the SAME 8px travel threshold as cursor mode (the
            // shared moved/capture block above) - a jittery TAP on a wheel zone (< 8px) must
            // NOT be swallowed (both gate seats); only a real spin suppresses the release click.
            adjustVolume(panel, d / 360);
            return;
          }
          if (st.mode === 'scrub') {
            // v1.239 (Dean): continuous timeline scrub on mobile Now Playing. A full 360deg
            // turn sweeps the WHOLE track; clockwise (+) = forward. Music is non-live, so
            // currentTime IS the exact target - move it LIVE (audible; the skin fill + the
            // v1.237 chapter watcher reflect via 'seeked'/'timeupdate'), and persist through
            // the real seek pipeline on RELEASE (onUp dispatches #seek-bar 'change').
            var mps = hostCtl('media-player');
            var durS = (mps && isFinite(mps.duration) && mps.duration > 0) ? mps.duration : 0;
            if (durS > 0) {
              if (st.scrubRatio == null) st.scrubRatio = Math.min(1, Math.max(0, (Number(mps.currentTime) || 0) / durS));
              st.scrubRatio = Math.min(1, Math.max(0, st.scrubRatio + d / 360));
              try { mps.currentTime = st.scrubRatio * durS; } catch (_) { /* ignore a bad set */ }
            }
            return;
          }
          // acceleration: songs-per-step scales with angular speed (deg/ms) so a slow turn
          // is one-at-a-time and a fast flick jumps several.
          var speed = Math.abs(d) / dt;
          var mult = speed > 2.4 ? 4 : (speed > 1.5 ? 3 : (speed > 0.8 ? 2 : 1));
          while (Math.abs(st.accum) >= WHEEL_STEP_DEG) {
            var sign = st.accum > 0 ? 1 : -1;      // clockwise (+) => down the list, iPod-true
            st.moved = true;
            setWheelCursor(panel, wheelCursorRow + sign * mult, false);
            st.accum -= sign * WHEEL_STEP_DEG;
          }
        };
        st.onUp = function (ev) {
          // v1.239: a real pointerUP that actually scrubbed COMMITS through the seek pipeline
          // (#seek-bar 'change' -> seekCommitTarget + saveProgressToServer, the same path the
          // tap-seek proxy uses). A pointerCANCEL aborts with no commit - the live currentTime
          // stays where it landed and the next periodic save carries it, never a lost seek.
          if (st.mode === 'scrub' && st.moved && ev && ev.type === 'pointerup' && st.scrubRatio != null) {
            var sb = hostCtl('seek-bar');
            if (sb) { sb.value = String(st.scrubRatio); sb.dispatchEvent(new Event('change', { bubbles: true })); }
          }
          // v1.242 fast-scan: a real pointerUP after a scan COMMITS the landed position through
          // the same seek pipeline (a pointercancel aborts with no commit, like scrub).
          if (st.scanning && ev && ev.type === 'pointerup') {
            var mpu = hostCtl('media-player');
            var du = (mpu && isFinite(mpu.duration) && mpu.duration > 0) ? mpu.duration : 0;
            if (du) { var sbu = hostCtl('seek-bar'); if (sbu) { sbu.value = String(Math.min(1, Math.max(0, (Number(mpu.currentTime) || 0) / du))); sbu.dispatchEvent(new Event('change', { bubbles: true })); } }
          }
          endWheel(st, st.moved);
        };
        wheel.addEventListener('pointermove', st.onMove);
        wheel.addEventListener('pointerup', st.onUp);
        wheel.addEventListener('pointercancel', st.onUp);
        wheelSpin = st;
      }, { signal: sig });
    }
    if (nowPlayingPanel) bindSkinSurface(nowPlayingPanel, signal);

    // ---- v1.234: DESKTOP pop-out player (Document PiP + independent-window fallback) ----
    // Float the player into a small window showing the picked skin. It is a SECOND skin
    // surface: the same bindSkinSurface proxy + paintSkin render + reflectAllSkins updates,
    // so the audio engine is untouched (player.js byte-unchanged). Desktop-only: the button
    // shows only where the pop-out is supported AND the viewport is NOT the narrow one that
    // already gets the in-tab skin - a coherent split (narrow -> in-tab skin; wide desktop
    // -> pop-out). Window size ~380px so the < 768px skin media query engages and every skin
    // renders at its phone layout with no re-styling. Pointer events => the click wheel
    // spins with a MOUSE click-drag here.
    var POPOUT_W = 380, POPOUT_H = 700;
    var pipWin = null, pipPanel = null, pipAbort = null, pipClock = null, pipPending = false;
    function popoutSupported() {
      try { if (SKINS && SKINS.isMobileViewport && SKINS.isMobileViewport()) return false; } catch (_) { /* treat as desktop */ }
      return !!(typeof window !== 'undefined' && (window.documentPictureInPicture || typeof window.open === 'function'));
    }
    // the current music track's queue index (buildSkinCtx's ci), or -1.
    function currentSkinIndex() {
      // v1.237: prefer the displayed chapter (watcher-advanced) over the loaded ::c id, so the
      // pop-out repaints to the CURRENT chapter as an album rolls across boundaries.
      var curId = effectiveCurrentId();
      if (!curId) return -1;
      for (var k = 0; k < queue.length; k++) { if (queue[k].id === curId) return k; }
      return -1;
    }
    // Is a MUSIC track the current one? (gate SUGGESTION: the button gates on THIS, not queue
    // membership - the queue is [] while browsing the album/artist grids with a track docked,
    // and that browsing state is exactly when a floating player is most useful.)
    function hasCurrentMusicTrack() {
      var p = window.FileTube && window.FileTube.player;
      if (!p || !p.currentId) return false;
      try { var m = typeof p.getCurrentMeta === 'function' ? p.getCurrentMeta() : null; return !!(m && m.isMusic); } catch (_) { return true; }
    }
    function copyPopoutStyles(doc) {
      // link every same-origin stylesheet + copy inline <style> blocks so the skin is styled.
      var links = document.querySelectorAll('link[rel="stylesheet"]');
      for (var i = 0; i < links.length; i++) {
        var l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = links[i].href; doc.head.appendChild(l);
      }
      var styles = document.querySelectorAll('style');
      for (var j = 0; j < styles.length; j++) {
        var s = doc.createElement('style'); s.textContent = styles[j].textContent; doc.head.appendChild(s);
      }
    }
    function mountPopout(win) {
      pipPending = false; // the async grant resolved (or the sync fallback) - clear the open-in-flight guard
      if (!win) return;
      // Gate finding (both seats): requestWindow() is async, so between the click and the
      // grant the view can be DESTROYED (controller.abort()) OR the viewport can shrink into
      // the narrow (in-tab-skin) range. Either way mounting now is wrong - a destroyed closure
      // leaks a frozen, uncloseable always-on-top window (the "pre-await guard is not a
      // post-await guard" TOCTOU class, v1.104/v1.105), and a narrow viewport puts BOTH skin
      // surfaces live (shared wheel-state corruption). mountPopout is the single async funnel,
      // so re-check BOTH here and close the just-granted window if either holds. This is what
      // makes "never both live" (the reflect/wheel comments) an actual invariant.
      if (signal.aborted || !popoutSupported()) { try { win.close(); } catch (_) { /* ignore */ } return; }
      pipWin = win;
      var doc = win.document;
      try { copyPopoutStyles(doc); doc.title = 'FileTube'; } catch (_) { /* best effort */ }
      var panel = doc.createElement('div');
      panel.id = 'music-nowplaying-panel'; // same id the skin CSS/JS expect
      panel.className = 'music-nowplaying-panel';
      try { doc.body.classList.add('mms-on'); doc.body.appendChild(panel); } catch (_) { teardownPopout(); return; }
      pipPanel = panel;
      pipAbort = new AbortController();
      bindSkinSurface(panel, pipAbort.signal, { allowVolume: true }); // desktop -> Now-Playing wheel sets volume; registers the surface for reflectAllSkins
      ensureSkinReflect(); // arm the media-element -> reflectAllSkins listeners (the in-tab render, which normally arms them, is skipped on desktop)
      paintSkin(panel, (SKINS && SKINS.activeSkinId()) || 'apple', currentSkinIndex());
      // v1.235.x (Dean device): the pop-out clock FROZE in true Document PiP - it rode the
      // MAIN tab's `timeupdate`, but once the PiP window takes focus the opener tab is
      // backgrounded and the browser throttles/pauses those events (a Menu tap re-rendered it
      // once, then it froze again). Fix: drive the pop-out's reflect from the POP-OUT window's
      // OWN timer - it's the focused, unthrottled window - reading the live (still-advancing,
      // audio keeps playing) mp.currentTime. ~4Hz, like timeupdate. Cleared on teardown (and
      // the interval dies with the window anyway). The in-tab skin keeps the main timeupdate.
      try { pipClock = win.setInterval(function () { reflectSkin(panel); }, 250); } catch (_) { pipClock = null; }
      // the pop-out closing (user, or the tab navigating away) tears the surface down.
      var onClose = function () { teardownPopout(); };
      try { win.addEventListener('pagehide', onClose); win.addEventListener('unload', onClose); } catch (_) { /* ignore */ }
      updatePopoutBtn();
    }
    function openPopout() {
      if (!popoutSupported()) return; // gate finding: re-check at CLICK time, not just button visibility - a wide->narrow resize must not leave an openable button
      if (pipWin) { try { pipWin.focus(); } catch (_) { /* ignore */ } return; }
      // adversarial finding: pipWin is only set async inside mountPopout, so a double-click
      // DURING the requestWindow() grant would mount TWO always-on-top windows (each with its
      // own leaked clock). pipPending guards the async gap; it's cleared in mountPopout (every
      // arm) and the catch.
      if (pipPending) return;
      // Document PiP (Chrome/Edge desktop) = always-on-top; else a plain independent window.
      if (window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function') {
        try {
          pipPending = true;
          window.documentPictureInPicture.requestWindow({ width: POPOUT_W, height: POPOUT_H })
            .then(function (w) { mountPopout(w); })
            .catch(function () { pipPending = false; openPlainPopout(); });
          return;
        } catch (_) { pipPending = false; /* fall through to the plain window */ }
      }
      openPlainPopout();
    }
    function openPlainPopout() {
      var w = null;
      try {
        w = window.open('', 'ft-music-pip', 'width=' + POPOUT_W + ',height=' + POPOUT_H + ',menubar=no,toolbar=no,location=no,status=no');
      } catch (_) { w = null; }
      if (!w) return; // popup blocked - nothing we can do without a gesture
      try { w.document.body.innerHTML = ''; } catch (_) { /* cross-origin? never, same-origin blank */ }
      mountPopout(w);
    }
    function teardownPopout() {
      pipPending = false;
      if (pipAbort) { try { pipAbort.abort(); } catch (_) { /* ignore */ } pipAbort = null; }
      // clear the pop-out clock on the window that CREATED it, before closing that window
      // (a closed window's timers die anyway - this is belt-and-suspenders).
      if (pipClock != null) { try { (pipWin && pipWin.clearInterval ? pipWin : window).clearInterval(pipClock); } catch (_) { /* ignore */ } pipClock = null; }
      if (pipPanel) { var idx = skinSurfaces.indexOf(pipPanel); if (idx >= 0) skinSurfaces.splice(idx, 1); pipPanel = null; }
      if (pipWin) { try { if (pipWin.close && !pipWin.closed) pipWin.close(); } catch (_) { /* ignore */ } pipWin = null; }
      updatePopoutBtn();
    }
    function togglePopout() {
      if (pipWin) { teardownPopout(); return; } // close -> its pagehide also calls teardown (idempotent)
      openPopout();
    }
    // Re-render the OPEN pop-out to the current track/skin (called from updateNowPlayingPanel,
    // which every track change routes through via playAt). Progress/play-state stay live via
    // reflectAllSkins; this handles the parts that need a repaint (title/art/list/skin).
    function repaintPopout() {
      if (!pipPanel || !pipPanel.isConnected) return;
      var ci = currentSkinIndex();
      if (ci < 0) return; // nothing playing - leave the last frame up
      paintSkin(pipPanel, (SKINS && SKINS.activeSkinId()) || 'apple', ci);
    }
    // Button: shown only on desktop-supported viewports while a music track is current
    // (expanded OR docked - popping out is most useful while browsing). Mirrors the theatre
    // button's lockstep hide, but its own support gate (not CSS).
    function updatePopoutBtn() {
      if (!popoutBtn) return;
      popoutBtn.hidden = !(popoutSupported() && hasCurrentMusicTrack());
      popoutBtn.setAttribute('aria-pressed', pipWin ? 'true' : 'false');
    }
    if (popoutBtn) popoutBtn.addEventListener('click', togglePopout, { signal });
    // Gate finding (both seats): the ONLY thing keeping the in-tab and pop-out skins from
    // being live at once is the viewport split, and nothing re-checked it on a RESIZE - so a
    // wide->narrow shrink with the pop-out open left the button visible AND let the in-tab
    // skin activate too, both sharing the wheel state. ENFORCE the split on resize: refresh
    // the button, and if the viewport crossed into the narrow (in-tab-skin) range, close the
    // pop-out. This makes "never both live" (the reflect/wheel comments) an actual invariant.
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', function () {
        var narrow = false;
        try { narrow = !!(SKINS && SKINS.isMobileViewport && SKINS.isMobileViewport()); } catch (_) { /* desktop */ }
        if (narrow && pipWin) teardownPopout(); // -> in-tab skin owns the surface; teardown is idempotent with the pagehide arm
        else updatePopoutBtn();
      }, { signal });
    }
    activePopoutTeardown = teardownPopout; // destroy() closes the pop-out on a cross-view swap

    // Tapping the line drills into the playing track's album.
    if (nowPlayingEl) {
      nowPlayingEl.addEventListener('click', function () {
        var key = nowPlayingEl.getAttribute('data-album-key');
        if (!key || !nowPlaying) return;
        openDrill({ type: 'album', key: key, label: nowPlaying.album || 'Album' }).catch(function () {});
      }, { signal });
    }

    // Gate S1/W1: the dock × (close()) doesn't notify the view, so a stale red
    // row + equalizer + "Playing from" line would linger after the user closes
    // the player while ON /music. The shared #media-player fires `emptied` on a
    // close AND on a new load's teardown; defer one frame and clear ONLY when
    // nothing ended up loaded (a real load sets currentId synchronously, so the
    // deferred check sees a truthy id and does NOT flicker).
    //
    // CRUCIAL (gate W1): #media-player lives inside <template id="player-host-
    // template"> until the FIRST play clones the host, so it is NOT reachable
    // via getElementById at init on a cold /music. Bind LAZILY, guard-once: try
    // at init (covers a nav-BACK while already playing — the host exists) AND
    // after the first loadTrack's player.load (which clones the host). The
    // host+element persist across close/reopen, so one binding suffices;
    // signal-scoped, so destroy() removes it and a re-init rebinds fresh.
    var emptiedBound = false;
    function ensureEmptiedListener() {
      if (emptiedBound) return;
      var mediaEl = document.getElementById('media-player');
      if (!mediaEl) return;
      emptiedBound = true;
      mediaEl.addEventListener('emptied', function () {
        requestAnimationFrame(function () {
          var cur = (window.FileTube && window.FileTube.player && window.FileTube.player.currentId) || null;
          if (!cur) { playingId = null; nowPlaying = null; chapterViewId = null; applyPlayingHighlight(); updateNowPlaying(); }
        });
      }, { signal });
    }
    ensureEmptiedListener();

    // The id of the currently-playing track (drives the playing-row highlight).
    // Seeded from the persistent player so a nav BACK into /music while a track
    // is still playing re-highlights the right row (the player outlives the
    // #view-root swap; music.js is re-init'd fresh each time).
    var playingId = (window.FileTube && window.FileTube.player && window.FileTube.player.currentId) || null;

    // View state: the active top tab, an optional drill (album/artist), the
    // current search, and the live play QUEUE (the exact list on screen).
    var tab = normalizeMusicTab(readPref(TAB_KEY, MUSIC_DEFAULT_TAB));
    var drill = null; // { type:'album'|'artist', key, label }
    var search = '';
    var queue = [];
    var queueCtx = null;
    var queueCtxEncoded = '';
    var urlParams = new URLSearchParams(window.location.search);

    // v1.103: sort is persisted PER TAB (sorting Songs by duration must not
    // reorder Artists when you switch back). SORT_KEY holds a JSON map
    // {tab: value}; a pre-v1.103 plain-string value (single global sort) fails
    // JSON.parse and falls through to the per-tab defaults - a one-time reset,
    // not a crash.
    function readSortMap() {
      var raw = readPref(SORT_KEY, '');
      if (!raw) return {};
      try { var m = JSON.parse(raw); return (m && typeof m === 'object') ? m : {}; } catch (_) { return {}; }
    }
    function sortForTab(t) { return normalizeMusicSort(t, readSortMap()[t]); }
    function writeSortForTab(t, value) {
      var m = readSortMap();
      m[t] = value;
      writePref(SORT_KEY, JSON.stringify(m));
    }
    // Rebuild the select's options + selected value for whatever is active
    // (a tab, OR a drill - friction pass: drills are now sortable, defaulting to
    // release date for an artist and album order for an album).
    // The sort key currently in effect: a drill uses its type-specific key
    // (drill-artist / drill-album), else the tab's own key.
    function activeSortKey() {
      if (drill) return drill.type === 'album' ? 'drill-album' : 'drill-artist';
      return tab;
    }
    function rebuildSortMenu() {
      if (!sortSelect) return;
      var wrap = sortSelect;
      // The HOME shelves are a fixed recently-added composition - no sortable
      // list, so the sort control is hidden there (gate: no inert/mislabeled
      // dropdown on the default landing). A drill IS sortable (friction pass:
      // Dean wanted release-date order for an artist's songs).
      if (tab === 'home') { wrap.hidden = true; return; }
      wrap.hidden = false;
      var key = activeSortKey();
      var opts = musicSortOptionsFor(key);
      var current = sortForTab(key);
      sortSelect.innerHTML = opts.map(function (o) {
        return '<option value="' + escapeMusicHtml(o.value) + '"' + (o.value === current ? ' selected' : '') + '>' + escapeMusicHtml(o.label) + '</option>';
      }).join('');
      sortSelect.value = current;
    }
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        writeSortForTab(activeSortKey(), sortSelect.value);
        render().catch(function () {});
      }, { signal });
    }
    rebuildSortMenu();

    // The header search box drives the music search (this view owns it here).
    var searchInput = document.getElementById('search-input');
    var searchBtn = document.getElementById('search-btn');
    function applySearch() {
      search = (searchInput && searchInput.value || '').trim();
      render().catch(function () {});
    }
    if (searchBtn) searchBtn.addEventListener('click', function (e) { e.preventDefault(); applySearch(); }, { signal });
    if (searchInput) searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applySearch(); } }, { signal });

    if (tabsHost) {
      tabsHost.addEventListener('click', function (e) {
        var btn = e.target.closest('.music-tab');
        if (!btn) return;
        tab = normalizeMusicTab(btn.getAttribute('data-tab'));
        drill = null;
        writePref(TAB_KEY, tab);
        setActiveTab();
        render().catch(function () {});
      }, { signal });
    }
    function setActiveTab() {
      if (!tabsHost) return;
      tabsHost.querySelectorAll('.music-tab').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-tab') === tab && !drill);
      });
    }

    if (scanBtn) {
      scanBtn.addEventListener('click', function () {
        scanBtn.disabled = true;
        fetch('/api/music/scan', { method: 'POST' }).catch(function () {}).finally(function () {
          setTimeout(function () { scanBtn.disabled = false; render().catch(function () {}); }, 1500);
        });
      }, { signal });
    }

    if (shuffleBtn) {
      shuffleBtn.addEventListener('click', function () {
        // Shuffle ALL songs (or the current drill scope): a fresh seed + random
        // sort, then play from the top of the shuffled queue.
        var seed = String(Math.floor(Math.random() * 1e9));
        loadSongs({ sort: 'random', seed: seed, scope: drill }).then(function () {
          if (queue.length) playAt(0);
        }).catch(function () {});
      }, { signal });
    }

    // Friction pass: the Artists grid/list view toggle. Shown ONLY on the Artists
    // tab (the find-an-artist surface); the icon shows the mode a click switches
    // TO (list-icon while in grid, grid-icon while in list).
    function getArtistView() { return readPref(ARTIST_VIEW_KEY, 'grid') === 'list' ? 'list' : 'grid'; }
    function syncViewToggle() {
      if (!viewToggleBtn) return;
      var showable = (tab === 'artists' && !drill);
      viewToggleBtn.hidden = !showable;
      if (!showable) return;
      var isList = getArtistView() === 'list';
      var icon = viewToggleBtn.querySelector('i');
      if (icon) icon.className = isList ? 'icon-grid' : 'icon-list';
      var label = isList ? 'Switch to circle view' : 'Switch to list view';
      viewToggleBtn.title = label;
      viewToggleBtn.setAttribute('aria-label', label);
    }
    if (viewToggleBtn) {
      viewToggleBtn.addEventListener('click', function () {
        writePref(ARTIST_VIEW_KEY, getArtistView() === 'list' ? 'grid' : 'list');
        syncViewToggle();
        render().catch(function () {});
      }, { signal });
    }

    // v1.45.0 T3: the drill sticky-header offset (--music-sticky-top) + collapse
    // threshold are measured ONCE per render from the fixed header's height —
    // but that height differs between orientations (mobile ~96px vs 56px), so a
    // portrait->landscape->portrait rotate would otherwise leave the sticky bar
    // parked at a stale offset until the next render(). Re-measure on rotate/
    // resize by re-running wireStickyObserver (it disconnects + re-measures +
    // recreates the observer, and no-ops when we're not on a drill). Debounced
    // so a resize storm coalesces. Registered with the init AbortController
    // `signal`, so the SPA #view-root swap (destroy -> controller.abort()) tears
    // it down; the isConnected guard covers a trailing timer firing after that.
    var stickyRemeasureTimer = null;
    function scheduleStickyRemeasure() {
      clearTimeout(stickyRemeasureTimer);
      stickyRemeasureTimer = setTimeout(function () {
        if (content && content.isConnected) wireStickyObserver();
      }, 150);
    }
    window.addEventListener('resize', scheduleStickyRemeasure, { signal });
    window.addEventListener('orientationchange', scheduleStickyRemeasure, { signal });
    // gate-fix (S2): also cancel any pending debounce timer when the view is torn
    // down (SPA #view-root swap -> controller.abort()), so nothing lingers past
    // destroy(). (The isConnected guard already makes a stray fire harmless; this
    // is the tidier belt-and-suspenders.)
    signal.addEventListener('abort', function () { clearTimeout(stickyRemeasureTimer); });

    // ---- data + render ------------------------------------------------------

    function musicUrl(params) {
      var q = new URLSearchParams();
      Object.keys(params).forEach(function (k) { if (params[k] !== undefined && params[k] !== null && params[k] !== '') q.set(k, params[k]); });
      return '/api/music?' + q.toString();
    }

    var loadSongsGen = 0; // v1.207: serializes concurrent loads so a superseded (stale) one never clobbers the winner's queue/ctx
    async function loadSongs(opts) {
      opts = opts || {};
      var myLoad = ++loadSongsGen; // claim this load BEFORE the fetch
      var scope = opts.scope || drill;
      // Friction pass: a drill honours its OWN persisted sort (drill-artist ->
      // release date by default, drill-album -> album order); the flat Songs tab
      // honours its own. A caller can still override (Shuffle passes 'random').
      var defaultSort = scope
        ? sortForTab(scope.type === 'album' ? 'drill-album' : 'drill-artist')
        : sortForTab('songs');
      var ctx = { src: 'music', sort: opts.sort || defaultSort };
      if (opts.seed) ctx.seed = opts.seed;
      if (search) ctx.search = search;
      if (scope && scope.type === 'album') ctx.album = scope.key;
      if (scope && scope.type === 'artist') ctx.artist = scope.key;
      var params = { sort: ctx.sort, seed: ctx.seed, search: ctx.search, album: ctx.album, artist: ctx.artist, filter: ctx.filter, limit: 1000 };
      var data = await fetchJson(musicUrl(params));
      // v1.207 (gate): a NEWER loadSongs (a fast second album-select) superseded
      // this one - do NOT clobber the winner's module queue/ctx with our stale
      // result. Before this guard, the loser's late load re-scoped the queue
      // under the winner's already-registered nav -> Prev/Next played a
      // wrong-ALBUM track (the v1.104 desync/wrong-track class). The ctx write
      // moves AFTER the guard for the same reason.
      if (myLoad !== loadSongsGen) return queue;
      queueCtx = ctx;
      queueCtxEncoded = (window.encodeListContext ? window.encodeListContext(ctx) : '');
      queue = Array.isArray(data.items) ? data.items : [];
      return queue;
    }

    // v1.102 (tranche 4 shimmer): every art image in `content` (album/song/drill/
    // sticky) ships `art-shimmer`; hand them to the shared decode-reveal so each
    // clears the shimmer the instant it decodes (and immediately for a cached one).
    function revealMusicArt() {
      if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.shimmerArt === 'function') {
        window.FileTube.shimmerArt(content);
      }
      // Redesign S1: wire the artist-avatar circles - reveal on load, DROP on
      // error so a broken avatar degrades to the monogram behind it (the
      // buildAccountAvatarEl reveal-once contract, both axes).
      var avatars = content ? content.querySelectorAll('.maa-img') : [];
      for (var i = 0; i < avatars.length; i++) {
        (function (img) {
          if (img.complete && img.naturalWidth > 0) { img.classList.add('is-loaded'); return; }
          // Already-FAILED synchronously (complete + zero natural size): drop now,
          // so the listener-that-never-fires can't leave a broken img over the
          // monogram (QA parity with buildAccountAvatarEl). Not reachable for a
          // freshly-parsed img today, but structurally closes the gap.
          if (img.complete) { if (img.parentNode) img.parentNode.removeChild(img); return; }
          img.addEventListener('load', function () { img.classList.add('is-loaded'); }, { once: true });
          img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); }, { once: true });
        })(avatars[i]);
      }
    }

    function renderSongList() {
      content.innerHTML = '<div class="music-song-list">' + queue.map(buildSongRowHtml).join('') + '</div>';
      if (emptyNote) emptyNote.hidden = queue.length > 0;
      applyPlayingHighlight();
      revealMusicArt();
    }

    // Redesign: the HOME shelves - "Your artists" (circles) + "Recently added"
    // (albums), each a horizontal-scroll row with a "See all". Cards are the SAME
    // builders as the full grids, so a tile tap drills through the shared content
    // click delegation. Fetches both shelves in parallel; a shelf is omitted when
    // empty, and an entirely empty library (no artists AND no albums) shows the
    // empty note.
    async function renderHome() {
      var artists = [];
      var albums = [];
      var recent = [];
      try {
        var res = await Promise.all([
          fetchJson('/api/music/artists?limit=12&sort=newest'),
          fetchJson('/api/music/albums?limit=12&sort=newest'),
          fetchJson('/api/music?filter=recent-listening&limit=60'),
        ]);
        artists = Array.isArray(res[0].items) ? res[0].items : [];
        albums = Array.isArray(res[1].items) ? res[1].items : [];
        recent = Array.isArray(res[2].items) ? res[2].items : [];
      } catch (_) { artists = []; albums = []; recent = []; }
      // Friction pass: "Recently played" ARTISTS - distinct artists from recent
      // plays, most-recent first (one tile each), so who you reach for is one tap
      // from the top instead of a scroll-and-hunt.
      var recentArtists = [];
      var seenArtist = Object.create(null); // null-proto: a "__proto__"-named artist dedups too
      for (var i = 0; i < recent.length && recentArtists.length < 12; i++) {
        var nm = recent[i] && recent[i].artist;
        if (typeof nm !== 'string' || nm === '' || seenArtist[nm]) continue;
        seenArtist[nm] = true;
        recentArtists.push(recent[i]);
      }
      var html = '';
      if (recentArtists.length) html += buildMusicShelfHtml('Recently played', '', recentArtists.map(buildRecentArtistTileHtml).join(''));
      if (artists.length) html += buildMusicShelfHtml('Your artists', 'artists', artists.map(buildArtistCardHtml).join(''));
      if (albums.length) html += buildMusicShelfHtml('Recently added', 'albums', albums.map(buildAlbumCardHtml).join(''));
      content.innerHTML = '<div class="music-home">' + html + '</div>';
      if (emptyNote) emptyNote.hidden = (artists.length + albums.length) > 0;
      revealMusicArt();
    }

    // Toggle `.playing` (accent + equalizer glyph) on the row whose track id
    // matches the currently-playing track. A pure DOM pass, NOT a re-render, so
    // it can run cheaply on every advance and after every list build. Called
    // from playAt (every tap / on-page prev-next / lock-screen next routes
    // through it), after renderSongList, and once at init.
    function applyPlayingHighlight() {
      content.querySelectorAll('.music-song-row').forEach(function (r) {
        r.classList.toggle('playing', !!playingId && r.getAttribute('data-id') === playingId);
      });
    }

    // v1.44.2: build the drill view — the collapsing sticky header + tracklist.
    // Layout order: [sticky bar][big header][sentinel][song list]. The sticky
    // bar parks below the fixed site header and is revealed by CSS once the
    // big header scrolls out (the IntersectionObserver toggles `.collapsed`).
    function renderDrillView() {
      content.innerHTML =
        '<div class="music-drill">' +
        buildStickyBarHtml(drill, queue) +
        buildDrillHeaderHtml(drill, queue) +
        '<div class="music-drill-sentinel" aria-hidden="true"></div>' +
        '<div class="music-song-list">' + queue.map(buildSongRowHtml).join('') + '</div>' +
        '</div>';
      if (emptyNote) emptyNote.hidden = queue.length > 0;
      applyPlayingHighlight();
      wireStickyObserver();
      revealMusicArt();
    }

    function wireStickyObserver() {
      disconnectStickyObserver();
      var drillEl = content.querySelector('.music-drill');
      var sentinel = content.querySelector('.music-drill-sentinel');
      if (!drillEl || !sentinel || typeof IntersectionObserver === 'undefined') return;
      // Measure the FIXED site header ONCE and park the sticky bar just below it
      // (measure, don't guess — the v1.37.2/v1.43.1 scar). No per-frame scroll
      // math: the observer fires only at the collapse threshold crossing.
      var siteHeader = document.querySelector('header');
      var headerH = siteHeader ? siteHeader.offsetHeight : 0;
      drillEl.style.setProperty('--music-sticky-top', headerH + 'px');
      stickyObserver = new IntersectionObserver(function (entries) {
        var e = entries[entries.length - 1];
        if (!e) return;
        // Collapse once the sentinel (just below the big header) reaches or
        // passes the fixed-header line at the top of the viewport.
        drillEl.classList.toggle('collapsed', e.boundingClientRect.top <= headerH);
      }, { root: null, rootMargin: (-headerH) + 'px 0px 0px 0px', threshold: 0 });
      stickyObserver.observe(sentinel);
    }

    async function render() {
      // v1.44.2: a drill's Back + title live in the large collapsing header
      // (buildDrillHeaderHtml) now, so the thin #music-crumb strip is unused for
      // drills. (playTrackFromContinue still uses it for its transient "Recently
      // played" label — that path renders directly, never via render().)
      if (crumb) { crumb.hidden = true; crumb.innerHTML = ''; }
      // Any prior drill's collapse observer must not survive this re-render (its
      // sentinel is about to be replaced) — the SPA-swap leak guard.
      disconnectStickyObserver();
      setActiveTab();
      // Keep the sort control in sync with the active surface (tab OR drill) -
      // its options + persisted value, and hidden only on Home - centralised here
      // so every state change (tab switch, drill in/out) routes through one place.
      rebuildSortMenu();
      syncViewToggle(); // grid/list toggle: only on the Artists tab
      // v1.98 shimmer sweep: seed the EXACT shape the branch below reveals, so
      // the swap is zero-shift - the HOME shelves (home, the default landing), a
      // song list (songs), an artist mosaic grid (artists, v1.103), or an album
      // grid (albums). A DRILL is deliberately NOT seeded (gate WARNING 2):
      // renderDrillView prepends a large .music-drill-header a bare song-row
      // skeleton can't reserve, so keep the prior content on screen (the album
      // grid you clicked) until the drill paints - no header jump. Each branch
      // reveals by replacing content.innerHTML; the catch clears it.
      if (content && !drill) {
        content.innerHTML = tab === 'home'
          ? buildMusicHomeSkeleton()
          : tab === 'songs'
            ? buildMusicSkeletonRows(8)
            : tab === 'artists'
              ? buildMusicArtistSkeletonCards(12)
              : buildMusicSkeletonCards(8);
      }
      try {
        if (drill) {
          await loadSongs({});
          renderDrillView();
        } else if (tab === 'home') {
          await renderHome();
        } else if (tab === 'songs') {
          await loadSongs({});
          renderSongList();
        } else if (tab === 'albums') {
          // limit=10000 (MAX_LIMIT): the endpoints paginate with a DEFAULT of
          // 60, so without an explicit high limit only ~60 albums/artists
          // would render (the Songs tab already passes a high limit). Proper
          // infinite-scroll is tech-debt; for now request the full set.
          var a = await fetchJson('/api/music/albums?limit=10000&sort=' + encodeURIComponent(sortForTab('albums')) + (search ? '&search=' + encodeURIComponent(search) : ''));
          var albums = Array.isArray(a.items) ? a.items : [];
          content.innerHTML = '<div class="music-card-grid">' + albums.map(buildAlbumCardHtml).join('') + '</div>';
          if (emptyNote) emptyNote.hidden = albums.length > 0;
        } else if (tab === 'artists') {
          var ar = await fetchJson('/api/music/artists?limit=10000&sort=' + encodeURIComponent(sortForTab('artists')) + (search ? '&search=' + encodeURIComponent(search) : ''));
          var artists = Array.isArray(ar.items) ? ar.items : [];
          // Friction pass: circles (browse) OR a compact list (find fast).
          content.innerHTML = getArtistView() === 'list'
            ? '<div class="music-artist-list">' + artists.map(buildArtistListRowHtml).join('') + '</div>'
            : '<div class="music-card-grid">' + artists.map(buildArtistCardHtml).join('') + '</div>';
          if (emptyNote) emptyNote.hidden = artists.length > 0;
        }
      } catch (err) {
        console.error('Music: failed to load', err);
        if (content) content.innerHTML = ''; // v1.98: never strand the seeded shimmer on error
        if (emptyNote) emptyNote.hidden = false;
      }
      // v1.102: reveal the album/artist art (songs/drill self-cover via their own
      // renderers above; a second pass here is an idempotent no-op).
      revealMusicArt();
      // Re-evaluate the "Playing from" line on every render (a tab switch may
      // reveal that the player was closed, or that a non-music item is playing).
      updateNowPlaying();
    }

    // ---- v1.217 in-view back-stack: drill descents get a history level -------
    // Descending into a drill (open an album/artist from the browse view) stamps
    // a history entry carrying the drill descriptor, so the OS/browser back
    // gesture steps back to the browse list instead of leaving Music. onDrillPop
    // reconciles the in-memory `drill` to the entry the router hands back. No URL
    // change (deep links untouched); no player reparent (a drill is browse-only).
    function drillKey(d) { return d ? (d.type + ' ' + d.key) : ''; }
    // Stamp a back level for a drill DESCENT, unless it is the SAME drill already
    // showing (gate SUGGESTION: a re-tap of the "Playing from <Album>" line while
    // in that album must not push a duplicate level that eats a later back press).
    // Reused by openDrill (card/artist descents) and playRowAt (song-tap descent).
    function pushDrillLevel(next) {
      var ft = window.FileTube;
      if (ft && typeof ft.pushViewState === 'function' && drillKey(drill) !== drillKey(next)) {
        ft.pushViewState({ t: 'drill', drill: { type: next.type, key: next.key, label: next.label } });
      }
    }
    function openDrill(next) {
      pushDrillLevel(next);
      drill = next;
      return render();
    }
    function onDrillPop(state) {
      // Called ONLY for a within-Music pop (the router's popStateDelegate gate),
      // so Music owns it: reconcile `drill` to the popped entry's payload and
      // render in place. A drill-level pop collapses to browse; a forward re-pop
      // into a drill re-opens it. Return true always - a cross-view pop (leaving
      // Music) never reaches here.
      var vs = state && state.viewState;
      var target = (vs && vs.t === 'drill' && vs.drill) ? vs.drill : null;
      if (drillKey(drill) !== drillKey(target)) {
        drill = target;
        if (!drill) setActiveTab();
        render().catch(function () {});
      }
      return true;
    }
    activePopStateHandler = onDrillPop;

    // ---- interaction: drill-in + play + like --------------------------------

    content.addEventListener('click', function (e) {
      // v1.44.2: the drill header + sticky bar controls (shared classes across
      // both surfaces, handled by delegation).
      if (e.target.closest('.music-drill-back')) {
        // v1.217: if this drill has its own pushed history level, go back through
        // history so the entry is CONSUMED and the OS-back gesture stays in sync
        // (popstate -> onDrillPop collapses); else collapse directly (a drill with
        // no pushed level, e.g. a now-playing restore).
        var st = window.history.state;
        if (st && st.viewState && st.viewState.t === 'drill' && window.FileTube && typeof window.FileTube.pushViewState === 'function') {
          window.history.back();
        } else {
          drill = null; setActiveTab(); render().catch(function () {});
        }
        return;
      }
      if (e.target.closest('.music-drill-play')) {
        if (queue.length) playAt(0);
        return;
      }
      if (e.target.closest('.music-drill-shuffle')) {
        // Shuffle within the drill scope, re-render the (now reordered) list,
        // and play from the top — the seed makes next/prev walk it verbatim.
        var seed = String(Math.floor(Math.random() * 1e9));
        loadSongs({ sort: 'random', seed: seed, scope: drill }).then(function () {
          renderDrillView();
          if (queue.length) playAt(0);
        }).catch(function () {});
        return;
      }
      // Redesign: a HOME shelf's "See all" switches to that full-list tab.
      var seeAll = e.target.closest('.music-shelf-seeall');
      if (seeAll) {
        var dest = normalizeMusicTab(seeAll.getAttribute('data-seeall'));
        tab = dest;
        writePref(TAB_KEY, tab);
        setActiveTab();
        render().catch(function () {});
        return;
      }
      var albumCard = e.target.closest('.music-album-card');
      if (albumCard) {
        var key = albumCard.getAttribute('data-album-key');
        var title = albumCard.querySelector('.music-album-title');
        openDrill({ type: 'album', key: key, label: (title && title.textContent) || 'Album' }).catch(function () {});
        return;
      }
      var artistCard = e.target.closest('.music-artist-card') || e.target.closest('.music-artist-row');
      if (artistCard) {
        var name = artistCard.getAttribute('data-artist');
        openDrill({ type: 'artist', key: name, label: name || 'Artist' }).catch(function () {});
        return;
      }
      // v1.72: the save anchor rides the like button's chassis class - let
      // the browser's native download navigation run (no preventDefault),
      // and never fall through to the like toggle or the row-play path.
      var dlBtn = e.target.closest('.music-download-btn');
      if (dlBtn) return;
      // v1.72 (cap 3): queue the track under its own entry kind. Same
      // chassis class, so it must be dispatched BEFORE the like toggle.
      var queueBtn = e.target.closest('.music-queue-btn');
      if (queueBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.addToQueue === 'function') window.addToQueue(queueBtn.getAttribute('data-queue-id'), 'end', 'track');
        return;
      }
      var likeBtn = e.target.closest('.music-like-btn');
      if (likeBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleLike(likeBtn);
        return;
      }
      var row = e.target.closest('.music-song-row');
      if (row) {
        var idx = parseInt(row.getAttribute('data-index'), 10);
        if (!isNaN(idx)) playRowAt(idx); // v1.207: a fresh select drills into the album
      }
    }, { signal });

    function toggleLike(btn) {
      var id = btn.getAttribute('data-like-id');
      var liked = btn.classList.contains('liked');
      var req = liked
        ? fetch('/api/music/liked/' + encodeURIComponent(id), { method: 'DELETE' })
        : fetch('/api/music/liked/' + encodeURIComponent(id), { method: 'POST' });
      req.then(function () {
        // v1.75: the heart is the WRITE surface and stays; with the Liked tab
        // retired there is no local list an unlike can fall out of, so the row
        // just flips state in place. The central Liked (/?liked=1) is the read
        // surface and reflects it on its next load.
        btn.classList.toggle('liked', !liked);
        btn.title = !liked ? 'Unlike' : 'Like';
        // QA gate S7: buildSongRowHtml mints an aria-label alongside the title,
        // and only the title was being flipped - a screen reader kept reading
        // "Like" on a liked row. (Pre-existing; podcasts.js already did this.)
        btn.setAttribute('aria-label', !liked ? 'Unlike' : 'Like');
      }).catch(function () {});
    }

    var statusEl = root.querySelector('#music-status');
    function setStatus(msg) {
      if (!statusEl) return;
      if (msg) { statusEl.textContent = msg; statusEl.hidden = false; }
      else { statusEl.textContent = ''; statusEl.hidden = true; }
    }
    var playGen = 0; // guards against a stale prewarm poll clobbering a newer tap
    var playSelectGen = 0; // v1.207: guards the album-drill select against a newer fast tap (the wrong-track race)

    function loadTrack(item, i, opts) {
      opts = opts || {};
      // Wave G: a PROJECTED library-audio track (source 'library') streams the
      // mp3 from the media byte route, arts from its YouTube thumbnail, and saves
      // progress to the MEDIA store - so it carries its OWN routes, which we
      // prefer over the /track,/albumart,/api/music/progress music defaults.
      // resumeMode stays 'music' (the smart-resume, no "Resume at..." prompt, and
      // the music now-playing panel) - the read then hits progressEndpoint
      // (/api/progress), unifying the resume position with the feed side.
      // v1.221: a CHAPTER-track (source 'library-chapter') is a library track too
      // - it uses the same media routes (streamSrc /video/<file>), plus a
      // chapterStartSec seek offset the player honours on load.
      var isChapter = item.source === 'library-chapter';
      var isLib = item.source === 'library' || isChapter;
      var data = {
        type: 'audio',
        title: item.title,
        channelName: item.artist || '',
        folderName: item.artist || '',
        album: item.album || '',
        albumKey: item.albumKey || '', // v1.104: so the player can re-seed the now-playing panel's album drill after a re-init
        duration: item.durationSec || 0,
        artUrl: (isLib && item.artUrl) ? item.artUrl : ('/albumart/' + item.id),
        streamSrc: (isLib && item.streamSrc) ? item.streamSrc : ('/track/' + item.id),
        progressEndpoint: (isLib && item.progressEndpoint) ? item.progressEndpoint : '/api/music/progress',
        // v1.221: seek to the chapter start on load. v1.222: a chapter play now
        // RECORDS to the MEDIA store under the BASE file id (a real media id) so it
        // lands in Recently played + resumes. baseMediaId is the save id;
        // chapterResumeSec (the saved absolute file position, if any) is where a
        // resume-tap seeks instead of the chapter head.
        chapterStartSec: isChapter ? (Number(item.chapterStartSec) || 0) : undefined,
        baseMediaId: isChapter ? String(item.id).replace(/::c\d+$/, '') : undefined,
        chapterResumeSec: (isChapter && item.progress && typeof item.progress.resumeSec === 'number') ? item.progress.resumeSec : undefined,
        resumeMode: 'music',
        autoAdvanceViaTrackNav: true,
        browseCtx: queueCtxEncoded,
        // v1.44.2: the dock-return href - without it a track id hits the
        // video /watch route and 404s. v1.73 (Dean ruling 2): the return opens
        // the expanded now-playing view in ONE gesture - the podcasts
        // ?nowplaying=1 contract, same player audio-mount, second mount point.
        // v1.103: this navigate lands only because init STRIPS ?nowplaying after
        // consuming it (stripNowPlayingParam), so the bar never already shows the
        // target and the router's same-URL no-op never swallows the dock-tap.
        readerHref: '/music?nowplaying=1',
      };
      playingId = item.id;
      nowPlaying = { id: item.id, title: item.title || '', artist: item.artist || '', album: item.album || '', albumKey: item.albumKey || '' };
      // v1.237: a real load resets the chapter-view baseline - to the loaded chapter for a
      // chaptered file (the watcher advances it as playback rolls), else null (not chaptered).
      chapterViewId = isChapter ? item.id : null;
      applyPlayingHighlight();
      // v1.106 (Dean): SELECTING a track opens the EXPANDED now-playing view
      // (mount FULL into #player-slot) instead of the docked mini-player - the
      // now-playing view is worth landing on since v1.104. NAV (next/prev, opts.
      // keepPosition) instead KEEPS the player's position (v1.104): expanded stays
      // expanded, docked stays docked. So a fresh select -> slot; a nav -> slot
      // only if already full, else dock (the mini-player then appears when you
      // navigate away to browse).
      var pl = window.FileTube.player;
      var slot = root.querySelector('#player-slot');
      var useSlot = opts.keepPosition
        ? (pl && typeof pl.getState === 'function' && pl.getState() === 'full')
        : true;
      pl.load(item.id, data, (useSlot && slot) ? { slot: slot } : { dock: true });
      // Bring the freshly-expanded player into view (it mounts at the top of the
      // view, above the list). Only on a SELECT - a nav keeps you where you are.
      if (!opts.keepPosition && useSlot && slot) { try { window.scrollTo(0, 0); } catch (_) { /* no window scroll */ } }
      ensureEmptiedListener(); // gate W1: the host (with #media-player) now exists — bind if we hadn't yet
      registerTrackNav(i);
      // AFTER load (the player's currentId is now the new track) - so both the
      // "Playing from <album>" line and the now-playing panel, which gate on
      // np.id === player.currentId, reflect THIS track, not the previous one.
      updateNowPlaying();
      // Remember the resume pointer (Continue-listening / app relaunch).
      fetch('/api/music/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastTrackId: item.id, queueCtx: queueCtx, position: 0 }),
      }).catch(function () {});
    }

    // The lock-screen / expanded-view Prev/Next handlers for queue index `i`.
    // Factored out so a re-init reseed (rebuildPlayingQueue) can re-register them
    // around the recovered playing index, not just a fresh loadTrack.
    function registerTrackNav(i) {
      if (!window.FileTube.player || typeof window.FileTube.player.setTrackNav !== 'function') return;
      // i<0 (no known index) registers NO neighbors - clears any stale closures
      // rather than binding onNext to playAt(0) off a negative index.
      window.FileTube.player.setTrackNav({
        onPrev: i > 0 ? function () { playAt(i - 1, { keepPosition: true }); } : undefined,
        onNext: (i >= 0 && i < queue.length - 1) ? function () { playAt(i + 1, { keepPosition: true }); } : undefined,
      });
    }

    // v1.104: a dock-tap expand RE-INITS this view, wiping its in-memory
    // `nowPlaying` + `queue`. If a MUSIC track is still playing, re-seed the
    // now-playing panel from the LIVE player (metadata) and, when the current tab
    // didn't already repopulate the queue (a grid tab, not Songs), rebuild the
    // playing queue from the player's stored browseCtx so up-next + Prev/Next work.
    function seedNowPlayingFromPlayer() {
      var p = window.FileTube && window.FileTube.player;
      var meta = (p && typeof p.getCurrentMeta === 'function') ? p.getCurrentMeta() : null;
      if (!meta || !meta.isMusic || !meta.id) return;
      playingId = meta.id;
      nowPlaying = { id: meta.id, title: meta.title, artist: meta.artist, album: meta.album, albumKey: meta.albumKey || '' };
      // v1.237 (gate W1): re-seed the chapter-view baseline to the LOADED id on a re-init (a
      // dock-return mid-album) so a survived chapterViewId from a prior session can't blank the
      // panel (curId != nowPlaying.id); the next timeupdate re-advances it from currentTime.
      chapterViewId = /::c\d+$/.test(String(meta.id)) ? meta.id : null;
      applyPlayingHighlight();
      updateNowPlaying();
    }
    async function rebuildPlayingQueue() {
      // Gate CRITICAL (both seats): only rebuild when the expanded panel is
      // actually showing, and NEVER on the Songs tab / a drill - those run
      // loadSongs via render() and OWN `queue`. `init` fires render() unawaited,
      // so at this call `queue` is still [] regardless of tab; a `queue.length`
      // guard was DEAD and let a SECOND concurrent /api/music load race render()'s,
      // desyncing the rendered rows' data-index from the live queue -> playAt(i)
      // played the WRONG track (the divergent-sort dock-return repro). render()'s
      // own updateNowPlaying() fills the panel for those tabs; here we only handle
      // the grid tabs (albums/artists) render() leaves `queue` untouched on.
      var p = window.FileTube && window.FileTube.player;
      var expanded = !!(p && typeof p.getState === 'function' && p.getState() === 'full');
      if (!expanded || tab === 'songs' || drill) return;
      var meta = (p && typeof p.getCurrentMeta === 'function') ? p.getCurrentMeta() : null;
      if (!meta || !meta.isMusic || !meta.id) return;
      var ctx = (window.FileTube && typeof window.FileTube.decodeListContext === 'function')
        ? window.FileTube.decodeListContext(meta.browseCtx || '') : null;
      if (!ctx || ctx.src !== 'music') return;
      var scope = ctx.album ? { type: 'album', key: ctx.album } : (ctx.artist ? { type: 'artist', key: ctx.artist } : null);
      try {
        await loadSongs({ scope: scope, sort: ctx.sort, seed: ctx.seed });
      } catch (_) { return; }
      var ci = -1;
      for (var k = 0; k < queue.length; k++) { if (queue[k].id === playingId) { ci = k; break; } }
      // ci<0 (the playing id isn't in the rebuilt queue - a ctx/scope mismatch)
      // CLEARS the nav rather than leaving the destroyed prior instance's stale
      // Prev/Next closures registered (gate ADV note).
      registerTrackNav(ci);
      updateNowPlayingPanel();
    }

    // Gate QA-CRITICAL: an ALAC track streams from a rendition that transcodes
    // ON DEMAND — /track/:id answers 503 until it's ready. The shared player's
    // audio path has no 503 retry, so a music item that needsTranscode is
    // PRE-WARMED here (poll until the route stops 503-ing) before we hand it to
    // the player; otherwise the first play would silently fail. Native formats
    // (needsTranscode false) skip this entirely — zero added latency.
    function prewarmThenLoad(item, i, gen, opts) {
      var attempts = 0;
      var MAX_ATTEMPTS = 40; // ~60s at 1.5s spacing
      setStatus('Preparing “' + item.title + '”…');
      function poll() {
        if (gen !== playGen) return; // a newer tap superseded this one
        // A 1-byte ranged GET (not HEAD): when the rendition is READY the route
        // answers 206 having read a single byte; a HEAD would run the whole
        // file through sendRangeable's stream (no body sent, but the full disk
        // read still happens). While transcoding it's a small 503 JSON.
        fetch('/track/' + item.id, { headers: { Range: 'bytes=0-0' } })
          .then(function (res) {
            if (res.body && res.body.cancel) { try { res.body.cancel(); } catch (_) { /* ignore */ } }
            if (gen !== playGen) return;
            if (res.ok) { setStatus(''); loadTrack(item, i, opts); return; } // 200/206 -> ready
            attempts += 1;
            if (attempts >= MAX_ATTEMPTS) { setStatus('Could not prepare this track. Try again shortly.'); return; }
            setTimeout(poll, 1500);
          })
          .catch(function () {
            if (gen !== playGen) return;
            attempts += 1;
            if (attempts >= MAX_ATTEMPTS) { setStatus('Could not prepare this track.'); return; }
            setTimeout(poll, 1500);
          });
      }
      poll();
    }

    // `opts.keepPosition` = a NAV step (next/prev) - keep the player where it is.
    // Omitted (a fresh SELECT: a row tap, shuffle, drill Play, continue) - expand.
    function playAt(i, opts) {
      if (i < 0 || i >= queue.length || !window.FileTube || !window.FileTube.player) return;
      var item = queue[i];
      playGen += 1;
      if (item.needsTranscode) { prewarmThenLoad(item, i, playGen, opts); return; }
      setStatus('');
      loadTrack(item, i, opts);
    }

    // v1.207 (Dean): drill into a track's ALBUM, then play it there - so the
    // album is the browse view AND the up-next queue (via loadSongs' browseCtx),
    // and next/prev walk the album. This is the SAME path as clicking the album
    // card (drill = album -> render()), just triggered by playing a track;
    // reusing render() keeps the queue/browseCtx/sort/observer machinery intact.
    async function playTrackInAlbum(item) {
      var myGen = ++playSelectGen; // claim this select BEFORE the async album load
      drill = { type: 'album', key: item.albumKey, label: item.album || 'Album' };
      await render(); // loads the album into `queue` + renders the drill (render never throws)
      // Race guard (gate WARNING): a NEWER select - a fast second tap on a
      // DIFFERENT album - supersedes this one and owns the view + play. Bail
      // before playAt so a stale track never plays into the newer album's queue
      // (the v1.104 wrong-track class, now reachable because row taps auto-play).
      if (myGen !== playSelectGen) return;
      var ai = -1;
      for (var k = 0; k < queue.length; k++) { if (queue[k].id === item.id) { ai = k; break; } }
      if (ai < 0) {
        // The album fetch did not include the track (an edge - stale key,
        // filtered). Play it solo so the RIGHT song still starts. renderSongList
        // REPLACES the drill header with a flat list (it reassigns
        // content.innerHTML); `drill` stays set until the next render/tab clears
        // it.
        queue = [item];
        renderSongList();
        playAt(0);
        return;
      }
      playAt(ai);
    }

    // A fresh user SELECT of a song row. Unless the track has no album, or we
    // are already inside that album's drill, it drills into the album first
    // (Dean: every new song starts in its album). A no-album track (or an
    // in-album re-tap) plays in place, unchanged.
    function playRowAt(i) {
      if (i < 0 || i >= queue.length) return;
      var item = queue[i];
      var alreadyInAlbum = drill && drill.type === 'album' && item && drill.key === item.albumKey;
      if (item && item.albumKey && !alreadyInAlbum) {
        // v1.217 (gate): a row-tap descent into the album is the MOST common way
        // to land in an album view (v1.207) - stamp a back level so OS-back steps
        // back to the list/parent, and so the top history entry stays in sync
        // with the NEW album (avoids the artist-drill -> tap-song desync). This is
        // the INTERACTIVE path only; the ?play= init path calls playTrackInAlbum
        // directly (no push -> no per-load history spam).
        pushDrillLevel({ type: 'album', key: item.albumKey, label: item.album || 'Album' });
        playTrackInAlbum(item);
        return;
      }
      playAt(i);
    }

    // A "Continue listening" card lands here as /music?play=<trackId> and must
    // play THAT specific track (the earlier bug: it deferred to the resume
    // POINTER's last-played queue, so tapping any card but the single most-
    // recent one played the wrong song). The recently-played list is the
    // natural queue and, by construction, always contains the tapped track;
    // play it there (the player's music smart-resume applies the saved
    // position). Falls back to a solo queue if the track isn't in the recent
    // list (an edge — e.g. it aged out).
    async function playTrackFromContinue(trackId, bounceOnMiss) {
      tab = 'songs';
      drill = null;
      search = '';
      queueCtx = { src: 'music', filter: 'recent-listening' };
      queueCtxEncoded = (window.encodeListContext ? window.encodeListContext(queueCtx) : '');
      try {
        const data = await fetchJson('/api/music?filter=recent-listening&limit=200');
        queue = Array.isArray(data.items) ? data.items : [];
      } catch (_) { queue = []; }
      setActiveTab(); // keep the tab-strip highlight consistent with tab='songs'
      if (crumb) { crumb.hidden = false; crumb.textContent = 'Recently played'; }
      renderSongList();
      let idx = queue.findIndex((t) => t.id === trackId);
      if (idx >= 0) {
        // v1.207 (Dean): a song opened from search / a card lands in its ALBUM
        // view (the friction this wave fixes), unless it has no album tag.
        var t0 = queue[idx];
        if (t0 && t0.albumKey) { await playTrackInAlbum(t0); return; }
        playAt(idx);
        return;
      }
      // Edge: the tapped track isn't in the recent list — fetch it and play it
      // (in its album if it has one, else solo) so the right song still plays.
      try {
        const t = await fetchJson('/api/music/' + encodeURIComponent(trackId));
        if (t && t.id) {
          if (t.albumKey) { await playTrackInAlbum(t); return; }
          queue = [t]; renderSongList(); playAt(0); return;
        }
      } catch (_) { /* not a resolvable music track - see the bounce vs render decision below */ }
      // v1.236 (Dean, "open downloaded music in the music player" is BOUND to the library):
      // a rerouted audio tile (bounceOnMiss - the &ao=1 origin marker) whose id the music API
      // can't resolve (a NON-projected download) must not dead-end - send it where it plays:
      // /watch (its base media id, ::c chapter suffix stripped). But a LEGACY continue-listening
      // card (no ao marker) carries a NATIVE music-store id that /watch would 404, so on its
      // (rare) miss keep the old behaviour: the music browse view (gate W1 - no /watch regression).
      if (bounceOnMiss) {
        var bounceId = String(trackId).replace(/::c\d+$/, '');
        try { if (window.location && typeof window.location.replace === 'function') { window.location.replace('/watch.html?v=' + encodeURIComponent(bounceId)); return; } } catch (_) { /* no navigable location */ }
      }
      await render();
    }

    // v1.104: before the first render, re-seed the now-playing metadata from the
    // live player - a dock-tap expand re-inits this view with nowPlaying=null, so
    // render()'s updateNowPlaying would otherwise show a blank panel for a track
    // that is audibly playing.
    seedNowPlayingFromPlayer();
    renderJumpBackIn().catch(function () {}); // redesign S1: the "Jump back in" strip (independent of the tab render)

    const playParam = urlParams.get('play');
    var wantNowPlaying = urlParams.get('nowplaying') === '1';
    if (playParam) {
      // &ao=1 = the v1.236 reroute origin (an audio download tapped from a video-side tile) -
      // bounce a miss to /watch. A bare ?play= (a continue-listening card) keeps render() on a miss.
      playTrackFromContinue(playParam, urlParams.get('ao') === '1').catch((err) => {
        console.error('Music: continue-listening play failed', err);
        render().catch(() => {});
      });
    } else if (wantNowPlaying && nowPlaying && nowPlaying.albumKey) {
      // v1.207 (Dean): returning to a playing music track via the mini-player
      // restores that track's ALBUM as the browse view - it persists across the
      // dock round-trip, matching the album a fresh play now lands on. Set drill
      // BEFORE render() so the ONE render path draws it (no race with
      // rebuildPlayingQueue, which early-returns on `drill` - the v1.104
      // divergent-sort dock-return scar); register the lock-screen Prev/Next
      // around the playing track once the album queue has loaded.
      drill = { type: 'album', key: nowPlaying.albumKey, label: nowPlaying.album || 'Album' };
      render().then(function () {
        var ci = -1;
        for (var k = 0; k < queue.length; k++) { if (queue[k].id === playingId) { ci = k; break; } }
        registerTrackNav(ci);
        updateNowPlayingPanel();
      }).catch(function (err) {
        console.error('Music: now-playing album restore failed', err);
        if (emptyNote) emptyNote.hidden = false;
      });
    } else {
      render().catch(function (err) {
        console.error('Music: initial render failed', err);
        if (emptyNote) emptyNote.hidden = false;
      });
    }

    // v1.73 (Dean ruling 2): the podcasts ?nowplaying=1 contract, second
    // mount. Arriving via the docked player's tap expands the LIVE player
    // into this page's #player-slot (the big audio-art now-playing view);
    // a stale/bookmarked URL with nothing playing degrades to the list.
    // Gate W2 (v1.71, inherited): a music->music swap discards the old
    // view's slot with a FULL player inside it - re-adopt on EVERY init,
    // ?nowplaying or not. MUST match podcasts.js's copy.
    // (`wantNowPlaying` is read once, above, before the render branch.)
    // v1.103 (dock-return determinism): `?nowplaying=1` is a TRANSIENT expand
    // TRIGGER, not durable state. `wantNowPlaying` has captured it, so strip it
    // from the bar NOW - BEFORE the expand call below, so a throwing expand() can
    // never skip the strip and leave the marker durable (gate ADV-SUGGESTION 4).
    // If it lingered, a later dock re-tap would navigate to the SAME
    // `/music?nowplaying=1` already shown, and the router's same-URL no-op
    // (common.js navigate, tech-debt #46) would swallow it - stranding you in the
    // docked mini-player with an empty #player-slot (Dean's "tapping the mini
    // player doesn't always bring the player back" bug). Stripping keeps the URL
    // truthful (docked, not expanded) so every dock-tap is a real transition that
    // re-inits + re-expands. replaceState (no new history entry), carrying the
    // router's state object forward with a corrected `url` so popstate stays
    // consistent. expand() reads player state, not the URL, so ordering is safe.
    stripNowPlayingParam();
    var player = window.FileTube && window.FileTube.player;
    if (player && typeof player.getState === 'function' && typeof player.expand === 'function') {
      var pState = player.getState();
      var npSlot = root.querySelector('#player-slot');
      if (npSlot && (pState === 'full' || (wantNowPlaying && pState === 'docked'))) {
        player.expand(npSlot);
      }
    }
    // v1.104: with the player (possibly just) expanded, show the now-playing
    // panel - metadata immediately, up-next once the queue is (re)built from the
    // player's stored browseCtx (a grid tab didn't repopulate it).
    updateNowPlayingPanel();
    rebuildPlayingQueue().catch(function () {});
  }

  function stripNowPlayingParam() {
    try {
      var loc = window.location;
      var params = new URLSearchParams(loc.search);
      if (!params.has('nowplaying')) return;
      params.delete('nowplaying');
      var qs = params.toString();
      var newUrl = loc.pathname + (qs ? '?' + qs : '');
      var prev = window.history.state;
      var nextState = prev ? Object.assign({}, prev, { url: newUrl }) : null;
      window.history.replaceState(nextState, '', newUrl);
    } catch (_) { /* history unavailable -> leave the URL as-is */ }
  }

  function destroy() {
    if (controller) controller.abort();
    controller = null;
    // v1.227 (gate CRITICAL): the mobile-skin body class must NOT survive the
    // #view-root swap - the router preserves arbitrary body classes, and the
    // skin's `#player-slot { height:0 }` takeover would otherwise collapse the
    // NEXT view's player (watch/podcasts/read share #player-slot) on a phone.
    try { if (typeof document !== 'undefined' && document.body) document.body.classList.remove('mms-on'); } catch (_) { /* no document */ }
    // v1.234: close any floating pop-out player - its listeners live on the pop-out's own
    // AbortController (not the view signal that controller.abort() just cleared), and its
    // proxy targets this now-dead view closure, so it must not outlive the view.
    if (activePopoutTeardown) { try { activePopoutTeardown(); } catch (_) { /* ignore */ } activePopoutTeardown = null; }
    // v1.44.2: never leak the drill-collapse observer across the #view-root swap.
    disconnectStickyObserver();
    // v1.217: drop the torn-down init's pop handler so a stray popstate after
    // destroy() (a cross-view swap in flight) is a no-op, not a call into dead
    // closure state.
    activePopStateHandler = null;
  }

  if (window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('music', {
      init: init,
      destroy: destroy,
      // v1.217 in-view back-stack: the router calls this for a within-Music pop
      // (its popStateDelegate gate). Delegate to the live init's handler; return
      // false when there is none (torn down) so the router falls through.
      onPopState: function (state) { return activePopStateHandler ? activePopStateHandler(state) : false; },
    });
  }
})();
