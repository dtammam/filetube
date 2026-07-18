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
function buildSongRowHtml(item, index) {
  var dur = formatTrackDuration(item.durationSec);
  var liked = !!item.liked;
  return '' +
    '<div class="music-song-row" data-index="' + index + '" data-id="' + escapeMusicHtml(item.id) + '">' +
    '<img class="music-song-thumb" src="/albumart/' + encodeURIComponent(item.id) + '" alt="" loading="lazy" />' +
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeMusicHtml, formatTrackDuration, buildAlbumCardHtml, buildArtistCardHtml, buildSongRowHtml,
  };
}

(function () {
  if (typeof window === 'undefined') return;
  var controller = null;
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
    var playerSlot = root.querySelector('#player-slot');
    if (!content) return;

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
    }

    async function render() {
      if (crumb) {
        crumb.hidden = !drill;
        if (drill) {
          crumb.innerHTML = '';
          var back = document.createElement('button');
          back.type = 'button';
          back.className = 'music-crumb-back btn btn-sm';
          back.textContent = '‹ Back';
          back.addEventListener('click', function () { drill = null; setActiveTab(); render().catch(function () {}); }, { signal });
          var label = document.createElement('span');
          label.className = 'music-crumb-label';
          label.textContent = drill.label;
          crumb.appendChild(back);
          crumb.appendChild(label);
        }
      }
      setActiveTab();
      try {
        if (drill || tab === 'songs' || tab === 'liked') {
          await loadSongs({});
          renderSongList();
        } else if (tab === 'albums') {
          var a = await fetchJson('/api/music/albums' + (search ? '?search=' + encodeURIComponent(search) : ''));
          var albums = Array.isArray(a.items) ? a.items : [];
          content.innerHTML = '<div class="music-card-grid">' + albums.map(buildAlbumCardHtml).join('') + '</div>';
          if (emptyNote) emptyNote.hidden = albums.length > 0;
        } else if (tab === 'artists') {
          var ar = await fetchJson('/api/music/artists' + (search ? '?search=' + encodeURIComponent(search) : ''));
          var artists = Array.isArray(ar.items) ? ar.items : [];
          content.innerHTML = '<div class="music-card-grid music-artist-grid">' + artists.map(buildArtistCardHtml).join('') + '</div>';
          if (emptyNote) emptyNote.hidden = artists.length > 0;
        }
      } catch (err) {
        console.error('Music: failed to load', err);
        if (emptyNote) emptyNote.hidden = false;
      }
    }

    // ---- interaction: drill-in + play + like --------------------------------

    content.addEventListener('click', function (e) {
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
      };
      if (playerSlot) playerSlot.hidden = false;
      window.FileTube.player.load(item.id, data, { slot: playerSlot });
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
        fetch('/track/' + item.id, { method: 'HEAD' })
          .then(function (res) {
            if (gen !== playGen) return;
            if (res.status === 200) { setStatus(''); loadTrack(item, i); return; }
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

    // Gate QA-WARNING: consume the per-user resume pointer. A "Continue
    // listening" card lands here as /music?play=<trackId>; rebuild that track's
    // QUEUE from the stored queue context and play it (the player's music
    // smart-resume applies the saved position for a >10-min track).
    async function resumeFromPointer(trackId) {
      let st = null;
      try { st = await fetchJson('/api/music/resume'); } catch (_) { st = null; }
      const ctx = (st && st.queueCtx && typeof st.queueCtx === 'object') ? st.queueCtx : { src: 'music' };
      drill = null;
      if (ctx.album) drill = { type: 'album', key: ctx.album, label: 'Album' };
      else if (ctx.artist) { drill = { type: 'artist', key: ctx.artist, label: ctx.artist }; }
      else if (ctx.filter === 'liked') tab = 'liked';
      else tab = 'songs';
      if (ctx.search) search = ctx.search;
      if (sortSelect && ctx.sort) sortSelect.value = ctx.sort;
      await render(); // populates `queue` for the resolved view
      let idx = queue.findIndex((t) => t.id === trackId);
      if (idx < 0 && st && st.lastTrackId) idx = queue.findIndex((t) => t.id === st.lastTrackId);
      if (idx >= 0) playAt(idx);
    }

    const playParam = urlParams.get('play');
    if (playParam) {
      resumeFromPointer(playParam).catch((err) => {
        console.error('Music: resume failed', err);
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
  }

  if (window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('music', { init, destroy });
  }
})();
