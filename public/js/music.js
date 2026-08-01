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
    '<img class="music-album-art" src="' + escapeMusicHtml(art) + '" alt="' + escapeMusicHtml(album.album) + '" loading="lazy" />' +
    '<span class="music-album-title" title="' + escapeMusicHtml(album.album) + '">' + escapeMusicHtml(album.album || 'Unknown album') + '</span>' +
    '<span class="music-album-artist" title="' + escapeMusicHtml(album.artist) + '">' + escapeMusicHtml(album.artist) + '</span>' +
    '<span class="music-album-count">' + escapeMusicHtml(count) + '</span>' +
    '</button>';
}

// An artist card (name + album/track counts).
function buildArtistCardHtml(artist) {
  var meta = (artist.albumCount || 0) + (artist.albumCount === 1 ? ' album' : ' albums') +
    ' · ' + (artist.trackCount || 0) + (artist.trackCount === 1 ? ' track' : ' tracks');
  return '' +
    '<button type="button" class="music-artist-card" data-artist="' + escapeMusicHtml(artist.artist) + '">' +
    '<span class="music-artist-name" title="' + escapeMusicHtml(artist.artist) + '">' + escapeMusicHtml(artist.artist || 'Unknown artist') + '</span>' +
    '<span class="music-artist-meta">' + escapeMusicHtml(meta) + '</span>' +
    '</button>';
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
    '<img class="music-song-thumb" src="/albumart/' + encodeURIComponent(item.id) + '" alt="" loading="lazy" />' +
    '<span class="music-eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
    '</span>' +
    '<span class="music-song-main">' +
    '<span class="music-song-title" title="' + escapeMusicHtml(item.title) + '">' + escapeMusicHtml(item.title) + '</span>' +
    '<span class="music-song-sub">' + escapeMusicHtml(item.artist || '') + (item.album ? ' · ' + escapeMusicHtml(item.album) : '') + '</span>' +
    '</span>' +
    '<span class="music-song-duration">' + escapeMusicHtml(dur) + '</span>' +
    '<button type="button" class="music-like-btn' + (liked ? ' liked' : '') + '" data-like-id="' + escapeMusicHtml(item.id) + '" title="' + (liked ? 'Unlike' : 'Like') + '" aria-label="' + (liked ? 'Unlike' : 'Like') + '">' +
    '<i class="icon-heart"></i>' +
    '</button>' +
    '</div>';
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
    '<img class="music-drill-art" src="/albumart/' + encodeURIComponent(artId) + '" alt="' + escapeMusicHtml(title) + '" />' +
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
    '<img class="music-sticky-thumb" src="/albumart/' + encodeURIComponent(artId) + '" alt="" />' +
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeMusicHtml, formatTrackDuration, buildAlbumCardHtml, buildArtistCardHtml, buildSongRowHtml,
    drillYear, drillAlbumCount, buildDrillHeaderHtml, buildStickyBarHtml, deriveNowPlayingLabel,
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
  var SORT_KEY = 'filetube_music_sort';
  var TAB_KEY = 'filetube_music_tab';

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
    var nowPlayingEl = root.querySelector('#music-nowplaying');
    if (!content) return;

    // v1.44.2: reflect the "Playing from <Album>" line for the currently-playing
    // music track. Re-checks player.currentId each call so it hides when a
    // video/book is what's playing, or the player was closed.
    function updateNowPlaying() {
      if (!nowPlayingEl) return;
      var currentId = (window.FileTube && window.FileTube.player && window.FileTube.player.currentId) || null;
      var label = deriveNowPlayingLabel(nowPlaying, currentId);
      if (label) {
        nowPlayingEl.textContent = label;
        nowPlayingEl.hidden = false;
        nowPlayingEl.setAttribute('data-album-key', (nowPlaying && nowPlaying.albumKey) || '');
      } else {
        nowPlayingEl.hidden = true;
        nowPlayingEl.removeAttribute('data-album-key');
      }
    }
    // Tapping the line drills into the playing track's album.
    if (nowPlayingEl) {
      nowPlayingEl.addEventListener('click', function () {
        var key = nowPlayingEl.getAttribute('data-album-key');
        if (!key || !nowPlaying) return;
        drill = { type: 'album', key: key, label: nowPlaying.album || 'Album' };
        setActiveTab();
        render().catch(function () {});
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
          if (!cur) { playingId = null; nowPlaying = null; applyPlayingHighlight(); updateNowPlaying(); }
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
    var tab = readPref(TAB_KEY, 'albums');
    var drill = null; // { type:'album'|'artist', key, label }
    var search = '';
    var queue = [];
    var queueCtx = null;
    var queueCtxEncoded = '';
    var urlParams = new URLSearchParams(window.location.search);

    if (sortSelect) {
      sortSelect.value = readPref(SORT_KEY, 'newest');
      sortSelect.addEventListener('change', function () {
        writePref(SORT_KEY, sortSelect.value);
        render().catch(function () {});
      }, { signal });
    }

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
        tab = btn.getAttribute('data-tab');
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

    async function loadSongs(opts) {
      opts = opts || {};
      var scope = opts.scope || drill;
      var ctx = { src: 'music', sort: opts.sort || (sortSelect ? sortSelect.value : 'newest') };
      if (opts.seed) ctx.seed = opts.seed;
      if (search) ctx.search = search;
      if (scope && scope.type === 'album') ctx.album = scope.key;
      if (scope && scope.type === 'artist') ctx.artist = scope.key;
      if (tab === 'liked' && !scope) ctx.filter = 'liked';
      queueCtx = ctx;
      queueCtxEncoded = (window.encodeListContext ? window.encodeListContext(ctx) : '');
      var params = { sort: ctx.sort, seed: ctx.seed, search: ctx.search, album: ctx.album, artist: ctx.artist, filter: ctx.filter, limit: 1000 };
      var data = await fetchJson(musicUrl(params));
      queue = Array.isArray(data.items) ? data.items : [];
      return queue;
    }

    function renderSongList() {
      content.innerHTML = '<div class="music-song-list">' + queue.map(buildSongRowHtml).join('') + '</div>';
      if (emptyNote) emptyNote.hidden = queue.length > 0;
      applyPlayingHighlight();
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
      try {
        if (drill) {
          await loadSongs({});
          renderDrillView();
        } else if (tab === 'songs' || tab === 'liked') {
          await loadSongs({});
          renderSongList();
        } else if (tab === 'albums') {
          // limit=10000 (MAX_LIMIT): the endpoints paginate with a DEFAULT of
          // 60, so without an explicit high limit only ~60 albums/artists
          // would render (the Songs tab already passes a high limit). Proper
          // infinite-scroll is tech-debt; for now request the full set.
          var a = await fetchJson('/api/music/albums?limit=10000' + (search ? '&search=' + encodeURIComponent(search) : ''));
          var albums = Array.isArray(a.items) ? a.items : [];
          content.innerHTML = '<div class="music-card-grid">' + albums.map(buildAlbumCardHtml).join('') + '</div>';
          if (emptyNote) emptyNote.hidden = albums.length > 0;
        } else if (tab === 'artists') {
          var ar = await fetchJson('/api/music/artists?limit=10000' + (search ? '&search=' + encodeURIComponent(search) : ''));
          var artists = Array.isArray(ar.items) ? ar.items : [];
          content.innerHTML = '<div class="music-card-grid music-artist-grid">' + artists.map(buildArtistCardHtml).join('') + '</div>';
          if (emptyNote) emptyNote.hidden = artists.length > 0;
        }
      } catch (err) {
        console.error('Music: failed to load', err);
        if (emptyNote) emptyNote.hidden = false;
      }
      // Re-evaluate the "Playing from" line on every render (a tab switch may
      // reveal that the player was closed, or that a non-music item is playing).
      updateNowPlaying();
    }

    // ---- interaction: drill-in + play + like --------------------------------

    content.addEventListener('click', function (e) {
      // v1.44.2: the drill header + sticky bar controls (shared classes across
      // both surfaces, handled by delegation).
      if (e.target.closest('.music-drill-back')) {
        drill = null; setActiveTab(); render().catch(function () {});
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
      var albumCard = e.target.closest('.music-album-card');
      if (albumCard) {
        var key = albumCard.getAttribute('data-album-key');
        var title = albumCard.querySelector('.music-album-title');
        drill = { type: 'album', key: key, label: (title && title.textContent) || 'Album' };
        render().catch(function () {});
        return;
      }
      var artistCard = e.target.closest('.music-artist-card');
      if (artistCard) {
        var name = artistCard.getAttribute('data-artist');
        drill = { type: 'artist', key: name, label: name || 'Artist' };
        render().catch(function () {});
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
        if (!isNaN(idx)) playAt(idx);
      }
    }, { signal });

    function toggleLike(btn) {
      var id = btn.getAttribute('data-like-id');
      var liked = btn.classList.contains('liked');
      var req = liked
        ? fetch('/api/music/liked/' + encodeURIComponent(id), { method: 'DELETE' })
        : fetch('/api/music/liked/' + encodeURIComponent(id), { method: 'POST' });
      req.then(function () {
        btn.classList.toggle('liked', !liked);
        btn.title = !liked ? 'Unlike' : 'Like';
        // If we're on the Liked tab, an unlike removes the row.
        if (tab === 'liked' && !drill && liked) render().catch(function () {});
      }).catch(function () {});
    }

    var statusEl = root.querySelector('#music-status');
    function setStatus(msg) {
      if (!statusEl) return;
      if (msg) { statusEl.textContent = msg; statusEl.hidden = false; }
      else { statusEl.textContent = ''; statusEl.hidden = true; }
    }
    var playGen = 0; // guards against a stale prewarm poll clobbering a newer tap

    function loadTrack(item, i) {
      var data = {
        type: 'audio',
        title: item.title,
        channelName: item.artist || '',
        folderName: item.artist || '',
        album: item.album || '',
        duration: item.durationSec || 0,
        artUrl: '/albumart/' + item.id,
        streamSrc: '/track/' + item.id,
        progressEndpoint: '/api/music/progress',
        resumeMode: 'music',
        autoAdvanceViaTrackNav: true,
        browseCtx: queueCtxEncoded,
        // v1.44.2: tapping the docked mini-player returns to /music (the generic
        // dock-return href — without it a track id hits the video /watch route
        // and 404s). On /music the same-URL nav guard makes it a benign no-op.
        readerHref: '/music',
      };
      // v1.44.2 (Spotify feel): play in the DOCKED mini-player, not FULL at the
      // top — the album header + tracklist stay on screen (browse-while-playing)
      // and the tapped row highlights. dock:true mounts straight into #player-dock.
      playingId = item.id;
      nowPlaying = { id: item.id, album: item.album || '', albumKey: item.albumKey || '' };
      applyPlayingHighlight();
      updateNowPlaying();
      window.FileTube.player.load(item.id, data, { dock: true });
      ensureEmptiedListener(); // gate W1: the host (with #media-player) now exists — bind if we hadn't yet
      if (typeof window.FileTube.player.setTrackNav === 'function') {
        window.FileTube.player.setTrackNav({
          onPrev: i > 0 ? function () { playAt(i - 1); } : undefined,
          onNext: i < queue.length - 1 ? function () { playAt(i + 1); } : undefined,
        });
      }
      // Remember the resume pointer (Continue-listening / app relaunch).
      fetch('/api/music/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastTrackId: item.id, queueCtx: queueCtx, position: 0 }),
      }).catch(function () {});
    }

    // Gate QA-CRITICAL: an ALAC track streams from a rendition that transcodes
    // ON DEMAND — /track/:id answers 503 until it's ready. The shared player's
    // audio path has no 503 retry, so a music item that needsTranscode is
    // PRE-WARMED here (poll until the route stops 503-ing) before we hand it to
    // the player; otherwise the first play would silently fail. Native formats
    // (needsTranscode false) skip this entirely — zero added latency.
    function prewarmThenLoad(item, i, gen) {
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
            if (res.ok) { setStatus(''); loadTrack(item, i); return; } // 200/206 -> ready
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

    function playAt(i) {
      if (i < 0 || i >= queue.length || !window.FileTube || !window.FileTube.player) return;
      var item = queue[i];
      playGen += 1;
      if (item.needsTranscode) { prewarmThenLoad(item, i, playGen); return; }
      setStatus('');
      loadTrack(item, i);
    }

    // A "Continue listening" card lands here as /music?play=<trackId> and must
    // play THAT specific track (the earlier bug: it deferred to the resume
    // POINTER's last-played queue, so tapping any card but the single most-
    // recent one played the wrong song). The recently-played list is the
    // natural queue and, by construction, always contains the tapped track;
    // play it there (the player's music smart-resume applies the saved
    // position). Falls back to a solo queue if the track isn't in the recent
    // list (an edge — e.g. it aged out).
    async function playTrackFromContinue(trackId) {
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
      if (idx >= 0) { playAt(idx); return; }
      // Edge: the tapped track isn't in the recent list — play it solo so the
      // right song still plays.
      try {
        const t = await fetchJson('/api/music/' + encodeURIComponent(trackId));
        if (t && t.id) { queue = [t]; renderSongList(); playAt(0); return; }
      } catch (_) { /* fall through to a normal render */ }
      await render();
    }

    const playParam = urlParams.get('play');
    if (playParam) {
      playTrackFromContinue(playParam).catch((err) => {
        console.error('Music: continue-listening play failed', err);
        render().catch(() => {});
      });
    } else {
      render().catch(function (err) {
        console.error('Music: initial render failed', err);
        if (emptyNote) emptyNote.hidden = false;
      });
    }
  }

  function destroy() {
    if (controller) controller.abort();
    controller = null;
    // v1.44.2: never leak the drill-collapse observer across the #view-root swap.
    disconnectStickyObserver();
  }

  if (window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('music', { init, destroy });
  }
})();
