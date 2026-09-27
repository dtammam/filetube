'use strict';

// v1.69.0: the /podcasts place controller. Show list -> episode list drill
// (UI pass S6: the root level is a ui-list of show rows; the "grid" in older names and
// comments below - backToGrid, "the grid" - means that root level)
// (the music-place pattern: playback in the DOCKED mini-player, browse-while-
// listening), the add-subscription sheet, per-user played/resume display.
//
// Security discipline (the subscriptions.js header contract): every server/
// feed-derived string is assigned via textContent; innerHTML is NEVER used
// for data. Pure list/format helpers are module-scope and exported behind
// `typeof module !== 'undefined'` for node:test with a fake document.

(function () {
  // ---- pure helpers (node:test-covered) -----------------------------------

  function formatEpisodeDuration(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return '';
    if (sec < 60) return Math.round(sec) + 's';
    var h = Math.floor(sec / 3600);
    var m = Math.round((sec % 3600) / 60);
    if (m === 60) { h += 1; m = 0; } // 3599s rounds up to a clean hour, never '60m'
    if (h > 0) return m > 0 ? h + 'h ' + m + 'm' : h + 'h';
    return m + 'm';
  }

  function formatEpisodeDate(pubDateMs) {
    if (!Number.isFinite(pubDateMs)) return '';
    try {
      return new Date(pubDateMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) { return ''; }
  }

  // One line under the title: "Aug 2, 2026 · 1h 12m". Pieces degrade
  // independently - a date-less feed still shows its duration.
  function formatEpisodeMeta(ep) {
    var parts = [];
    var date = formatEpisodeDate(ep && ep.pubDateMs);
    var dur = formatEpisodeDuration(ep && ep.durationSec);
    if (date) parts.push(date);
    if (dur) parts.push(dur);
    return parts.join(' · ');
  }

  // The row's state chip. Downloaded rows show no chip (playable IS the
  // default); every other state is worth a word. Returns '' or a label.
  function episodeChipLabel(ep) {
    if (!ep) return '';
    switch (ep.status) {
      case 'pending': return 'Queued';
      case 'failed': return 'Download failed';
      case 'skipped': return 'Not downloaded';
      case 'deleted-on-disk': return 'File removed';
      case 'trashed': return 'In trash';
      case 'tombstone': return 'Deleted';
      default: return '';
    }
  }

  // Resume-bar fraction for a partially-played episode: null when there is
  // nothing meaningful to show (unplayed, finished-and-latched, no duration).
  function resumeFraction(ep) {
    if (!ep || !ep.progress || ep.played) return null;
    var pos = Number(ep.progress.position);
    var dur = Number(ep.progress.duration) || Number(ep.durationSec);
    if (!Number.isFinite(pos) || pos <= 0 || !Number.isFinite(dur) || dur <= 0) return null;
    var f = pos / dur;
    if (f <= 0.005 || f >= 0.99) return null;
    return Math.min(1, Math.max(0, f));
  }

  // The show's count line: "12 of 484 downloaded" (or the plain
  // count once everything is local).
  function showCountLine(show) {
    if (!show) return '';
    var total = Number(show.episodeCount) || 0;
    var down = Number(show.downloadedCount) || 0;
    if (total === 0) return 'No episodes yet';
    if (down >= total) return total + (total === 1 ? ' episode' : ' episodes');
    return down + ' of ' + total + ' downloaded';
  }

  // The show row's one meta line: "Author · 12 of 484 downloaded", led by the re-entry
  // warning when the feed's tokened URL was lost (the row also carries data-warn).
  function showMetaLine(show) {
    if (!show) return '';
    var parts = [];
    if (show.secretMissing) parts.push('Feed URL needs re-entry');
    if (show.author) parts.push(String(show.author));
    parts.push(showCountLine(show));
    return parts.filter(Boolean).join(' · ');
  }

  // The show header's count line; the last check's status only when it says something
  // ("ok" is the normal case and reads as noise).
  function showStatusLine(show) {
    if (!show) return '';
    var st = typeof show.lastStatus === 'string' ? show.lastStatus : '';
    return showCountLine(show) + (st && st !== 'ok' ? ' · ' + st : '');
  }

  // F42: the artwork a show row/header paints. An RSS show's cover is its own route; a
  // yt-dlp show carries the server's artUrl (its channel avatar), or null - and null means
  // the monogram, never a guessed route or a video frame.
  function showArtUrl(show) {
    if (!show) return null;
    if (show.source === 'ytdlp') return (typeof show.artUrl === 'string' && show.artUrl) ? show.artUrl : null;
    return (typeof show.artUrl === 'string' && show.artUrl) ? show.artUrl : ('/podcastart/' + encodeURIComponent(show.id));
  }

  // F27: the episode row's one quiet meta line - its state word, "Played", the date, then the
  // time left for a started episode or the duration. Played is text, never a red fill.
  function episodeMetaLine(ep) {
    if (!ep) return '';
    var parts = [];
    var chip = episodeChipLabel(ep);
    if (chip) parts.push(chip);
    if (ep.played) parts.push('Played');
    var date = formatEpisodeDate(ep.pubDateMs);
    if (date) parts.push(date);
    var frac = resumeFraction(ep);
    var dur = Number(ep.progress && ep.progress.duration) || Number(ep.durationSec);
    if (frac !== null && dur > 0) {
      var left = formatEpisodeDuration(dur - Number(ep.progress.position));
      if (left) parts.push(left + ' left');
    } else {
      var d = formatEpisodeDuration(ep.durationSec);
      if (d) parts.push(d);
    }
    return parts.join(' · ');
  }

  // ---- the view ------------------------------------------------------------

  var controller = null;
  // v1.218 (in-view back-stack, media-nav arc): the LIVE onPopState handler for
  // the mounted init closure (it needs init's `currentShow`/openShow/backToGrid).
  // Module-scoped so the stable module.onPopState delegates to the current init;
  // nulled by destroy() so a pop after teardown is a no-op. Mirrors music.js.
  var activePodcastPopHandler = null;
  var activeSkinEngine = null; // v1.246: module-scoped so destroy() can tear the skin down (clears body.mms-on)
  // v1.273: the bridge to Brick's teardown, mirroring music.js. destroy() runs OUTSIDE
  // the init closure where the wiring lives, and the view dying first is a path the
  // engine gets no event for (the v1.270 slim CRITICAL-2 shape).
  var activeBrickStop = null;
  var activePodcastPopoutTeardown = null; // v1.251 (R3): destroy() closes a floating pop-out on a cross-view swap

  function init(root) {
    controller = new AbortController();
    var signal = controller.signal;

    var content = root.querySelector('#podcasts-content');
    var emptyNote = root.querySelector('#podcasts-empty');
    var crumb = root.querySelector('#podcasts-crumb');
    var statusEl = root.querySelector('#podcasts-status');
    var addBtn = root.querySelector('#podcasts-add-btn');
    var checkBtn = root.querySelector('#podcasts-check-btn');

    var shows = [];
    var currentShow = null; // null = the grid
    var episodes = [];
    var playable = []; // downloaded episodes of the current show, list order
    var playingId = null;
    var nowPlaying = null; // v1.105: the playing episode's display metadata (now-playing panel)
    var statusPollTimer = null;
    var nowPlayingPanel = root.querySelector('#podcast-nowplaying-panel');
    var podcastStage = root.querySelector('#podcast-stage');
    var theaterBtn = root.querySelector('#podcast-theater-btn');

    // v1.251 (R2): desktop THEATRE for podcasts - the same music v1.222 toggle (panel beside
    // the expanded player), its own persisted key. The button is desktop-only (CSS) and shows
    // only while an episode is expanded (updateNowPlayingPanel toggles it in lockstep).
    var THEATER_KEY = 'ft-podcast-theater';
    function theaterOn() { try { return localStorage.getItem(THEATER_KEY) === '1'; } catch (_) { return false; } }
    function applyTheater(on) {
      if (podcastStage) podcastStage.classList.toggle('is-theater', !!on);
      if (theaterBtn) theaterBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    applyTheater(theaterOn());
    if (theaterBtn) {
      theaterBtn.addEventListener('click', function () {
        var next = !theaterOn();
        try { localStorage.setItem(THEATER_KEY, next ? '1' : '0'); } catch (_) { /* ignore */ }
        applyTheater(next);
        updateNowPlayingPanel(); // recompute (or clear) the theatre panel height cap
      }, { signal: signal });
    }
    // v1.251 (R2): the shared panel's rows are innerHTML now - ONE delegated tap listener
    // (music's exact contract: .mnp-queue-row data-index -> playAt) replaces the retired
    // per-row listeners. The mobile SKIN renders no .mnp-queue-row, so no double-handling.
    if (nowPlayingPanel) {
      nowPlayingPanel.addEventListener('click', function (e) {
        var row = e.target.closest('.mnp-queue-row');
        if (!row) return;
        var idx = parseInt(row.getAttribute('data-index'), 10);
        if (!isNaN(idx)) playAt(idx);
      }, { signal: signal });
    }

    // v1.246 (Dean): podcasts on the SKIN. On mobile, the now-playing panel becomes the same
    // iPod/Apple/Spotify skin the music player uses, driven by the shared engine (skin-surface.js).
    // The gate (music-skins.js skinActiveFor) is true for a podcast episode via getCurrentMeta's
    // resumeMode==='podcast' (player.js unchanged). We feed the engine a PODCAST ctx (episode list
    // on the wheel, /podcastart show art, showName in the album slot) and its playAt as the select
    // hook. Desktop keeps the hand-built panel below (skinActive() is false off-mobile).
    var SKINS = (typeof window !== 'undefined' && window.FileTubeMusicSkins) || null;
    var skinEngine = null;
    // v1.273 BRICK on podcasts - the shared wiring from ipod-brick.js, resolved lazily
    // because the sticker config is built BEFORE skinEngine is assigned.
    var brickWired = null;
    function brickWiring() {
      if (!window.FileTubeBrick || typeof window.FileTubeBrick.wire !== 'function') return null;
      if (!brickWired) {
        brickWired = window.FileTubeBrick.wire({ getEngine: function () { return skinEngine; } });
      }
      activeBrickStop = brickWired.stop; // the view's own destroy() arm (no engine event on that path)
      return brickWired;
    }
    function skinActive() {
      if (!SKINS || typeof SKINS.skinActiveFor !== 'function') return false;
      var p = window.FileTube && window.FileTube.player;
      var meta = (p && typeof p.getCurrentMeta === 'function') ? p.getCurrentMeta() : null;
      return SKINS.skinActiveFor(meta);
    }
    function skinDur(s) { s = Math.max(0, Math.floor(Number(s) || 0)); var mm = Math.floor(s / 60), ss = s % 60; return mm + ':' + (ss < 10 ? '0' : '') + ss; }
    function podcastSkinCtx() {
      var p = window.FileTube && window.FileTube.player;
      var mp = document.getElementById('media-player');
      var curId = (p && p.currentId) || (nowPlaying && nowPlaying.id) || null;
      var ci = -1;
      for (var k = 0; k < playable.length; k++) { if (playable[k].id === curId) { ci = k; break; } }
      var showName = (nowPlaying && nowPlaying.showName) || '';
      var artSub = (nowPlaying && nowPlaying.subId) || (currentShow && currentShow.id) || '';
      function rowOf(j) {
        var ep = playable[j];
        return { index: j, title: ep.title || 'Episode', artist: showName, durLabel: skinDur(ep.durationSec),
          state: j < ci ? 'played' : (j === ci ? 'current' : 'next') };
      }
      var up = [], full = [];
      for (var a = Math.max(0, ci - 3); a < playable.length && up.length < 200; a++) up.push(rowOf(a));
      var fstart = playable.length <= 400 ? 0 : Math.max(0, ci - 200);
      for (var b = fstart; b < playable.length && full.length < 400; b++) full.push(rowOf(b));
      var dur = (mp && isFinite(mp.duration) && mp.duration > 0) ? mp.duration : ((nowPlaying && Number(nowPlaying.durationSec)) || 0);
      var pos = mp ? (Number(mp.currentTime) || 0) : 0;
      return {
        track: { title: nowPlaying && nowPlaying.title, artist: showName, album: showName,
          artUrl: artSub ? ('/podcastart/' + encodeURIComponent(artSub)) : '' },
        upNext: up, fullList: full, playing: mp ? !mp.paused : false, posSec: pos, durSec: dur,
        posLabel: skinDur(pos), remLabel: dur > 0 ? ('-' + skinDur(dur - pos)) : '', curNum: ci + 1, total: playable.length,
      };
    }
    // v1.251 (R3): the per-surface config is a BUILDER now - the in-tab panel and the desktop
    // pop-out (below) are two instances of the same engine over the same podcast ctx.
    function podcastEngineConfig(panel, winRef) {
      return {
        panel: panel,
        win: winRef,
        getSkinId: function () { return SKINS ? SKINS.activeSkinId() : 'ipod'; },
        getCtx: podcastSkinCtx,
        hostCtl: function (id) { return document.getElementById(id); }, // MAIN-document controls - a pop-out click still drives the real player
        onSelectIndex: function (i) { playAt(i); },
        onDock: function () { var pp = window.FileTube && window.FileTube.player; if (pp && typeof pp.dock === 'function') pp.dock(); updateNowPlayingPanel(); if (window.FileTube && window.FileTube.returnToPlayerOrigin) window.FileTube.returnToPlayerOrigin(); }, // v1.247 (F2): dock to the mini on the ORIGIN tab
        onHome: function () { if (window.FileTube && typeof window.FileTube.goHomeFromPlayer === 'function') window.FileTube.goHomeFromPlayer(updateNowPlayingPanel); }, // v1.332 (D7): Home from the player
        // v1.250 (F-UNIFY ride-along): hold-to-fast-scan + the sticker quick-menu (speed/loop/
        // skin). v1.287 (Dean, parity wave 2): podcasts NOW get the shared Extras menu in the
        // player - the createExtrasMenu factory was generalized to be endpoint-driven, so the
        // adapter below wires it to the SAME podcast operations the list rows use (proven).
        fastScan: true,
        sticker: {
          getPlayer: function () { return (window.FileTube && window.FileTube.player) || null; },
          onSkinChange: function () { updateNowPlayingPanel(); }, // repaint with the newly-picked skin
          // v1.287: the podcast Extras adapter. Capabilities = the applicable subset (Dean); the
          // handlers DELEGATE to the podcast endpoints (/api/podcasts/episodes/:id/...), and
          // Share is file-only (RSS episodes have no external source). Delete reuses the
          // recoverable trash (deleteNeedsModify:false - the row is shown to all like the
          // list-row delete; the SERVER enforces requireModifyLibrary + root confinement).
          extras: {
            getBaseId: function () { var pp = window.FileTube && window.FileTube.player; return (pp && pp.currentId) || null; },
            isEligible: function () {
              var pp = window.FileTube && window.FileTube.player;
              var id = pp && pp.currentId; if (!id) return false;
              for (var i = 0; i < episodes.length; i++) { if (episodes[i].id === id) return episodes[i].status === 'downloaded' && !episodes[i].watchHref; }
              return false; // only a downloaded RSS episode of the current show gets the menu
            },
            onMutated: function () { refreshCurrentView(); },
            signal: signal,
            fetchItem: function (id) {
              var ep = null;
              for (var i = 0; i < episodes.length; i++) { if (episodes[i].id === id) { ep = episodes[i]; break; } }
              if (!ep) return null;
              return { id: ep.id, title: ep.title || '', liked: ep.liked === true, watchState: ep.played ? 'watched' : 'unwatched', hasSubtitles: false, watchUrl: undefined };
            },
            downloadUrl: function (item) { return '/episode/' + encodeURIComponent(item.id) + '?download=1'; },
            shareLinkUrl: function () { return ''; },
            capabilities: ['download', 'share', 'queue', 'delete', 'like', 'watched'],
            watchedLabels: { on: 'Played', off: 'Mark played' },
            deleteNeedsModify: false,
            onQueue: function (item, pos) { if (typeof window.addToQueue === 'function') window.addToQueue(item.id, pos, 'podcast'); },
            likeRequest: function (item, nextOn) { return fetch('/api/podcasts/episodes/' + encodeURIComponent(item.id) + '/liked', { method: nextOn ? 'POST' : 'DELETE' }); },
            watchedRequest: function (item, nextOn) { return fetch('/api/podcasts/episodes/' + encodeURIComponent(item.id) + '/played', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ played: nextOn }) }); },
            onDelete: function (item, onSuccess, player) {
              if (typeof window.showConfirmModal !== 'function') return;
              // RSS titles are attacker-influenced - escape via textContent before the innerHTML body.
              var esc = function (s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; };
              window.showConfirmModal('Move to Trash?', 'Move <strong>' + esc(item.title || 'this episode') + '</strong> to Trash? You can Restore it from the episode list.', function () {
                // v1.339 R1 (T-C4): the confirm outlives an auto-advance - stop playback only when
                // the deleted episode is STILL what plays, never the episode that followed it.
                var stillPlaying = !!(player && player.currentId === item.id);
                if (stillPlaying && typeof player.close === 'function') player.close();
                fetchJson('/api/podcasts/episodes/' + encodeURIComponent(item.id), { method: 'DELETE' })
                  .then(function () { if (typeof onSuccess === 'function') onSuccess(stillPlaying); })
                  .catch(function () { setStatus('Could not delete the episode.'); });
              });
            },
          },
          // v1.273 (Dean): "podcasts just doesn't show up as an option even though it's
          // the same player". It IS the same player on the same skins - v1.270 simply
          // built Brick's view wiring inside music.js, so this surface never had a row.
          // The wiring is shared now (ipod-brick.js), so this is the whole of it: one
          // hook, and the same teardown arm music uses.
          brick: {
            visible: function () { var w = brickWiring(); return !!w && w.visible(); },
            onTap: function () { var w = brickWiring(); if (w) w.onTap(); },
          },
        },
      };
    }
    if (nowPlayingPanel && window.FileTubeSkinSurface) {
      skinEngine = window.FileTubeSkinSurface.create(podcastEngineConfig(nowPlayingPanel, window));
      activeSkinEngine = skinEngine; // module-scoped handle for destroy()'s teardown
      // reflect the live element into the skin (music.js ensureSkinReflect parity); the engine's
      // reflect() early-returns unless the skin is actually mounted, so this is a cheap no-op the
      // rest of the time. Bound with the view's signal so destroy() drops them.
      var mpEl = document.getElementById('media-player');
      if (mpEl && skinEngine) {
        ['play', 'pause', 'timeupdate', 'seeked', 'loadedmetadata', 'loadstart', 'emptied', 'durationchange'].forEach(function (ev) {
          mpEl.addEventListener(ev, function () {
            if (skinEngine) skinEngine.reflect();
            if (popoutShell) popoutShell.reflect(); // the pop-out surface too (its own clock covers throttled tabs)
          }, { signal: signal });
        });
      }
    }
    // v1.251 (R3): the DESKTOP pop-out for podcasts - the same shared shell music runs
    // (Document PiP + plain-window fallback, all the v1.234-235 guards). Same gate shape:
    // desktop viewport + a podcast episode current.
    var popoutBtn = root.querySelector('#podcast-popout-btn');
    function podcastPopoutSupported() {
      try { if (SKINS && SKINS.isMobileViewport && SKINS.isMobileViewport()) return false; } catch (_) { /* treat as desktop */ }
      return !!(typeof window !== 'undefined' && (window.documentPictureInPicture || typeof window.open === 'function'));
    }
    function hasCurrentPodcastEpisode() {
      var p = window.FileTube && window.FileTube.player;
      if (!p || !p.currentId) return false;
      try { var m = typeof p.getCurrentMeta === 'function' ? p.getCurrentMeta() : null; return !!(m && m.resumeMode === 'podcast'); } catch (_) { return false; }
    }
    var popoutShell = (window.FileTubeSkinSurface && typeof window.FileTubeSkinSurface.createPopoutShell === 'function')
      ? window.FileTubeSkinSurface.createPopoutShell({
        engineConfigFor: function (panel, winRef) { return podcastEngineConfig(panel, winRef); },
        supported: podcastPopoutSupported,
        aborted: function () { return signal.aborted; },
        onStateChange: function () { updatePopoutBtn(); },
        windowName: 'ft-podcast-pip',
        panelId: 'podcast-nowplaying-panel',
      })
      : null;
    function updatePopoutBtn() {
      if (!popoutBtn) return;
      popoutBtn.hidden = !(podcastPopoutSupported() && hasCurrentPodcastEpisode());
      popoutBtn.setAttribute('aria-pressed', (popoutShell && popoutShell.isOpen()) ? 'true' : 'false');
    }
    if (popoutBtn && popoutShell) popoutBtn.addEventListener('click', function () { popoutShell.toggle(); }, { signal });
    // the never-both-live split, enforced on resize (the music v1.235 gate finding, same shape).
    if (popoutShell && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', function () {
        var narrow = false;
        try { narrow = !!(SKINS && SKINS.isMobileViewport && SKINS.isMobileViewport()); } catch (_) { /* desktop */ }
        if (narrow && popoutShell.isOpen()) popoutShell.teardown();
        else updatePopoutBtn();
      }, { signal });
    }
    activePodcastPopoutTeardown = popoutShell ? function () { popoutShell.teardown(); } : null; // destroy() closes it on a cross-view swap
    // v1.311.3: re-run the panel update when the viewport crosses the mobile skin gate (a
    // rotate), so the skin un-renders / re-paints - music.js parity, the same shared helper.
    if (window.FileTubeSkinSurface && typeof window.FileTubeSkinSurface.watchSkinViewport === 'function') {
      window.FileTubeSkinSurface.watchSkinViewport(window, function () { updateNowPlayingPanel(); }, signal);
    }

    function setStatus(msg) {
      if (!statusEl) return;
      if (msg) { statusEl.textContent = msg; statusEl.hidden = false; }
      else { statusEl.textContent = ''; statusEl.hidden = true; }
    }

    function fetchJson(url, opts) {
      return fetch(url, opts).then(function (res) {
        if (!res.ok) return res.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(body && body.error ? body.error : ('HTTP ' + res.status));
        });
        return res.json();
      });
    }

    // ---- the show list ----
    // UI pass S6: the shows are a ui-list of media rows (the Spotify library row: rounded-square
    // art, name, "author · N episodes"), built by the primitives in public/js/ui.js.
    function renderShows() {
      if (!content) return;
      content.textContent = '';
      if (crumb) { crumb.hidden = true; crumb.textContent = ''; }
      if (emptyNote) emptyNote.hidden = shows.length > 0;
      if (shows.length === 0) return;
      var list = window.ui.list({ size: 'media', media: 'art', label: 'Podcasts' });
      list.classList.add('podcast-show-list');
      shows.forEach(function (show) {
        list.appendChild(buildShowRow(show));
      });
      content.appendChild(list);
      revealPodcastArt();
    }

    // A failed load is an error state with a Retry, never "No podcasts yet" (plan D9).
    function renderLoadError(title, retry) {
      if (!content) return;
      content.innerHTML = '';
      content.appendChild(window.ui.state({ icon: 'error', title: title, action: { label: 'Retry', onClick: retry } }));
    }

    // v1.102 (tranche 4 shimmer): the show/episode art images ship `art-shimmer`;
    // the shared decode-reveal clears each the instant it decodes (and immediately
    // for a cached one, so a warm image never shimmers forever).
    function revealPodcastArt() {
      if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.shimmerArt === 'function') {
        window.FileTube.shimmerArt(content);
      }
    }

    // Refresh whatever list is on screen from server state (delete/restore/
    // like handlers).
    function refreshCurrentView() {
      if (!currentShow) { loadShows(); return; }
      openShow(currentShow);
    }

    // The show's artwork as a ui-art rounded square (plan D4.4, audit decision 7). The source is
    // showArtUrl (the feed's cover route, or a yt-dlp show's channel avatar); with no source, or
    // a failed load, ui.avatar draws the monogram - never a broken image, never a video frame
    // (F42). The img keeps the decode-reveal shimmer (FileTube.shimmerArt clears it).
    function showArtEl(show, size) {
      var a = window.ui.avatar({ kind: 'podcast', name: show && show.name, url: showArtUrl(show), size: size });
      var img = a.querySelector('img');
      if (img) img.classList.add('art-shimmer');
      return a;
    }

    function buildShowRow(show) {
      var r = window.ui.row({
        size: 'media',
        media: showArtEl(show, 'xl'),
        title: show.name || 'Podcast',
        meta: showMetaLine(show),
        onClick: function () { pushShowLevel(show); openShow(show); },
      });
      r.setAttribute('data-show-id', show.id);
      if (show.secretMissing) r.setAttribute('data-warn', '');
      return r;
    }

    // ---- the episode list ----
    function openShow(show) {
      currentShow = show;
      // v1.157 (P3): reserve the show view before the episodes fetch so it does
      // not paint empty then pop in. renderEpisodes (success) clears content and
      // rebuilds; the catch clears the shimmer (reveal-once error axis).
      if (content) content.innerHTML = buildPodcastShowSkeleton(6);
      fetchJson('/api/podcasts/shows/' + encodeURIComponent(show.id) + '/episodes')
        .then(function (data) {
          // v1.339 R1 (T-C8): the view alone is not enough - Back (to the grid) or another show
          // opened during the fetch owns `content` now; this stale answer must not paint show A
          // over it, nor overwrite B's episodes and prev/next (the rebuildPlayable re-check shape).
          if (signal.aborted || showKey(currentShow) !== showKey(show)) return;
          currentShow = data.show || show;
          episodes = data.episodes || [];
          renderEpisodes();
        })
        .catch(function () {
          if (signal.aborted || showKey(currentShow) !== showKey(show)) return; // T-C8: never wipe the view that replaced us
          if (content) content.innerHTML = ''; // never strand the shimmer
          renderLoadError('Could not load episodes', function () { openShow(show); });
        });
    }

    function backToGrid() {
      currentShow = null;
      episodes = [];
      loadShows();
    }

    // v1.218 in-view back-stack: opening a show from the grid stamps a history
    // level so OS/browser back steps back to the grid instead of leaving
    // Podcasts. INTERACTIVE descents only (the show-row click); the ?show= init deep
    // link and refreshCurrentView re-open via openShow directly, no push.
    function showKey(s) { return (s && s.id) ? String(s.id) : ''; }
    function pushShowLevel(show) {
      var ft = window.FileTube;
      // The same-id check is a DEFENSIVE guard, not a live dedup: today the only
      // caller is the show row, which only exists while currentShow is null, so
      // the keys always differ. It future-proofs a non-grid descent (e.g. a
      // "related show" link) against a duplicate level. (gate SUGGESTION: this is
      // currently unreachable, kept as cheap insurance rather than dropped.)
      if (ft && typeof ft.pushViewState === 'function' && showKey(currentShow) !== showKey(show)) {
        ft.pushViewState({ t: 'show', id: show.id, name: show.name });
      }
    }
    // The router hands this back for a within-Podcasts pop (popStateDelegate gate):
    // reconcile the open show to the popped entry's payload, in place. A show-level
    // pop collapses to the grid; a forward re-pop re-opens the show. Return true -
    // a cross-view pop (leaving Podcasts) never reaches here.
    function onShowPop(state) {
      var vs = state && state.viewState;
      var target = (vs && vs.t === 'show' && vs.id) ? vs : null;
      if (showKey(currentShow) !== showKey(target)) {
        if (target) openShow({ id: target.id, name: target.name || 'Podcast' });
        else backToGrid();
      }
      return true;
    }
    activePodcastPopHandler = onShowPop;

    function renderEpisodes() {
      if (!content) return;
      var ui = window.ui;
      var show = currentShow; // every handler below closes over THIS show, never the live currentShow
      content.textContent = '';
      if (emptyNote) emptyNote.hidden = true;
      if (crumb) {
        // F41: the crumb is Back alone - the show's name is the header's title, once.
        crumb.textContent = '';
        crumb.hidden = false;
        var back = ui.button({ variant: 'plain', size: 'sm', icon: 'arrow_back', label: 'All podcasts' });
        // v1.218: consume the pushed show level via history.back() when one exists
        // (keeps OS-back in sync); else collapse directly (a show reached without a
        // pushed level, e.g. a ?show= deep-link restore).
        back.addEventListener('click', function () {
          var st = window.history.state;
          if (st && st.viewState && st.viewState.t === 'show' && window.FileTube && typeof window.FileTube.pushViewState === 'function') {
            window.history.back();
          } else {
            backToGrid();
          }
        }, { signal: signal });
        crumb.appendChild(back);
      }

      var head = document.createElement('div');
      head.className = 'podcast-show-head';
      head.appendChild(showArtEl(show, '2xl'));
      var meta = document.createElement('div');
      meta.className = 'podcast-show-meta';
      var h = document.createElement('h3');
      h.className = 'podcast-show-title';
      h.textContent = show.name;
      meta.appendChild(h);
      if (show.author) {
        var by = document.createElement('div');
        by.className = 'podcast-show-author';
        by.textContent = show.author;
        meta.appendChild(by);
      }
      if (show.description) {
        var desc = document.createElement('p');
        desc.className = 'podcast-show-desc';
        desc.textContent = show.description;
        meta.appendChild(desc);
      }
      var counts = document.createElement('div');
      counts.className = 'podcast-show-counts';
      counts.textContent = showStatusLine(show);
      meta.appendChild(counts);
      // The management actions (v1.69 QA gate #3): pin, pause/resume, unsubscribe and the
      // secretMissing re-entry lane. RSS shows only - a ytdlp-sourced show is managed on its
      // own /subscriptions page. F41: ONE action group on its own full-width line under the
      // header (not a lone Pin line above a second row), so it holds one line on a phone.
      head.appendChild(meta);
      content.appendChild(head);
      if (show.source !== 'ytdlp') {
        content.appendChild(buildShowActions(show));
        if (show.secretMissing) content.appendChild(buildReenter(show));
      }

      // AC5: the list reserves two trailing action columns (queue, more) on every row, so a
      // row without a queue button (trashed, not downloaded, a yt-dlp episode) never moves
      // the kebab.
      var list = ui.list({ size: 'default', actions: 2, label: 'Episodes' });
      list.classList.add('podcast-episodes');
      // Dock-playable = downloaded RSS episodes; external (watchHref) rows
      // navigate to their watch page and never join the dock prev/next set.
      playable = episodes.filter(function (e) { return e.status === 'downloaded' && !e.watchHref; });
      episodes.forEach(function (ep) {
        list.appendChild(buildEpisodeRow(ep));
      });
      content.appendChild(list);
      applyPlayingHighlight();
      revealPodcastArt();
    }

    function buildShowActions(show) {
      var ui = window.ui;
      var row = document.createElement('div');
      row.className = 'podcast-show-actions';

      // v1.72 (intake ruling 5): pin this show into the Playlists surface. Non-optimistic:
      // the state flips only after the round trip; membership in the pins route IS the state.
      // F41: while the pins load (and during a toggle's round trip) the button is BUSY - a
      // reserved pending state at full width, never a disabled flash.
      var pinBtn = ui.button({ variant: 'secondary', pill: true, icon: { off: 'keep', on: 'keep.fill' }, labels: ['Pin', 'Pinned'], pressed: false });
      pinBtn.setAttribute('aria-label', 'Pin to Playlists');
      ui.setBusy(pinBtn, true);
      var showPinned = false;
      function paintPin() {
        ui.setPressed(pinBtn, showPinned);
        ui.setBusy(pinBtn, false);
      }
      fetchJson('/api/podcasts/pins')
        .then(function (pins) {
          if (signal.aborted) return;
          showPinned = Array.isArray(pins) && pins.some(function (p) { return p && p.id === show.id; });
          paintPin();
        })
        .catch(function () {
          // State unknown: an honest disabled control, not a toggle that would guess.
          ui.setBusy(pinBtn, false);
          pinBtn.disabled = true;
        });
      pinBtn.addEventListener('click', function () {
        ui.setBusy(pinBtn, true);
        var req = showPinned
          ? fetchJson('/api/podcasts/pins/' + encodeURIComponent(show.id), { method: 'DELETE' })
          : fetchJson('/api/podcasts/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subId: show.id }) });
        req.then(function () {
          showPinned = !showPinned;
          paintPin();
          // The pinned sidebar + Playlists sheet re-read the merged pins.
          if (window.FileTube && typeof window.FileTube.refreshAllPinSurfaces === 'function') window.FileTube.refreshAllPinSurfaces();
        }).catch(function () { paintPin(); setStatus('Could not update the pin.'); });
      }, { signal: signal });
      row.appendChild(pinBtn);

      var pauseBtn = ui.button({ variant: 'secondary', pill: true, icon: { off: 'pause', on: 'play_arrow' },
        labels: ['Pause checks', 'Resume checks'], pressed: !!show.paused });
      pauseBtn.addEventListener('click', function () {
        ui.setBusy(pauseBtn, true);
        fetchJson('/api/podcasts/subscriptions/' + encodeURIComponent(show.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paused: !show.paused }),
        }).then(function () {
          show.paused = !show.paused;
          ui.setPressed(pauseBtn, show.paused);
        }).catch(function () { setStatus('Could not update the subscription.'); })
          .then(function () { ui.setBusy(pauseBtn, false); });
      }, { signal: signal });
      row.appendChild(pauseBtn);

      // The show's overflow (one icon button, so the group holds one line on a phone): Unsubscribe
      // is destructive - its menu item opens ui.confirm (danger), and the DELETE runs only after
      // the confirm resolves true (F33 / plan D4.8). The files-stay-on-disk disclosure is the
      // confirm's body.
      var moreBtn = ui.button({ variant: 'secondary', pill: true, shape: 'icon', icon: 'more_horiz', ariaLabel: 'More show actions' });
      moreBtn.setAttribute('data-show-more', '');
      moreBtn.addEventListener('click', function () {
        ui.menu({ anchor: moreBtn, title: show.name || 'Podcast', signal: signal, items: [
          { label: 'Unsubscribe', danger: true, onSelect: function () { confirmUnsubscribe(show); } },
        ] });
      }, { signal: signal });
      row.appendChild(moreBtn);
      return row;
    }

    function confirmUnsubscribe(show) {
      return window.ui.confirm({
        title: 'Unsubscribe from ' + (show.name || 'this podcast') + '?',
        body: 'New episodes stop downloading. Episodes already downloaded stay on disk.',
        confirmLabel: 'Unsubscribe',
        danger: true,
        signal: signal, // an SPA nav away closes it and answers false
      }).then(function (ok) {
        if (ok !== true || signal.aborted) return;
        return fetchJson('/api/podcasts/subscriptions/' + encodeURIComponent(show.id), { method: 'DELETE' })
          .then(function () { if (!signal.aborted) backToGrid(); })
          .catch(function () { setStatus('Could not unsubscribe.'); });
      });
    }

    // The secretMissing recovery lane (a restored backup lost the tokened URL): inline
    // re-entry, wired to the same-feed-only route.
    function buildReenter(show) {
      var ui = window.ui;
      var wrap = document.createElement('div');
      wrap.className = 'podcast-reenter';
      var f = ui.field({ label: 'Feed URL needs re-entry', type: 'url', placeholder: 'Paste this feed’s URL again (with its token)' });
      f.input.setAttribute('autocomplete', 'off');
      f.input.setAttribute('spellcheck', 'false');
      wrap.appendChild(f.el);
      var saveBtn = ui.button({ variant: 'secondary', label: 'Save feed URL' });
      saveBtn.addEventListener('click', function () {
        fetchJson('/api/podcasts/subscriptions/' + encodeURIComponent(show.id) + '/feed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedUrl: f.input.value.trim() }),
        }).then(function () {
          setStatus('Feed URL saved - checking the feed…');
          startStatusPolling();
          openShow(show);
        }).catch(function (err) {
          setStatus(err.message || 'Could not save the feed URL.');
        });
      }, { signal: signal });
      wrap.appendChild(saveBtn);
      return wrap;
    }

    // UI pass S6 (F27): an episode is a ui-row - title, one quiet meta line (state, Played,
    // date, duration or time left), and two reserved trailing slots: Add to queue and a kebab
    // holding Like, Mark played, Save to device and Move to Trash. Played is meta text, never a
    // red fill; the row itself plays the episode.
    function buildEpisodeRow(ep) {
      var ui = window.ui;
      var rss = !ep.watchHref;
      var downloaded = ep.status === 'downloaded';
      var opts = { title: ep.title || 'Untitled episode', meta: episodeMetaLine(ep) };
      if (ep.watchHref) {
        // A ytdlp-sourced episode is a media item: it plays on its watch page (watch-history
        // state, chapters, everything) - the row is a link there.
        opts.href = ep.watchHref;
      } else if (downloaded) {
        opts.onClick = function () {
          var i = playable.indexOf(ep);
          if (i !== -1) playAt(i);
        };
      }
      var actions = [null, null];
      var row;
      if (rss && downloaded) {
        // v1.71 T6: add-to-queue through the ONE shared verb (toast + Undo), kind 'podcast'
        // so the entry resolves against the episodes map.
        var queueBtn = ui.button({ variant: 'plain', shape: 'icon', icon: 'playlist_play', ariaLabel: 'Add to queue' });
        queueBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (typeof window.addToQueue === 'function') window.addToQueue(ep.id, 'end', 'podcast');
        }, { signal: signal });
        actions[0] = queueBtn;
      }
      if (rss) {
        var moreBtn = ui.button({ variant: 'plain', shape: 'icon', icon: 'more_vert', ariaLabel: 'More actions' });
        moreBtn.setAttribute('data-episode-more', '');
        moreBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openEpisodeMenu(ep, row, moreBtn);
        }, { signal: signal });
        actions[1] = moreBtn;
        opts.actions = actions;
      } else {
        opts.actions = [];
      }
      row = ui.row(opts);
      row.setAttribute('data-episode-id', ep.id);
      if (ep.played) row.setAttribute('data-played', '');
      return row;
    }

    // The episode's action menu (kebab). Item ids are the DATA (this episode), never an index.
    function episodeMenuItems(ep, row) {
      var items = [];
      if (ep.status === 'downloaded') {
        // v1.71 T4 / v1.75: the like is the WRITE surface for the central Liked playlist.
        items.push({ label: ep.liked ? 'Unlike' : 'Like', icon: ep.liked ? 'favorite.fill' : 'favorite', onSelect: function () { toggleLiked(ep); } });
      }
      // The played toggle writes the podcast latch (external episodes take theirs from watch
      // history and never reach this menu).
      items.push({ label: ep.played ? 'Mark unplayed' : 'Mark played', icon: 'check', onSelect: function () { togglePlayed(ep, row); } });
      if (ep.status === 'downloaded') {
        // v1.71: save-to-device, the confined stream route's ?download=1 arm.
        items.push({ label: 'Save to device', icon: 'download', onSelect: function () { saveToDevice(ep); } });
        // v1.70: the recoverable delete - through ui.confirm, never an in-row arm.
        items.push({ label: 'Move to Trash', icon: 'delete', danger: true, onSelect: function () { confirmTrashEpisode(ep); } });
      }
      if (ep.status === 'trashed') {
        items.push({ label: 'Restore', icon: 'refresh', onSelect: function () { restoreEpisode(ep); } });
      }
      return items;
    }
    function openEpisodeMenu(ep, row, anchor) {
      return window.ui.menu({ anchor: anchor, title: ep.title || 'Untitled episode', items: episodeMenuItems(ep, row), signal: signal });
    }

    function toggleLiked(ep) {
      var next = !ep.liked;
      return fetchJson('/api/podcasts/episodes/' + encodeURIComponent(ep.id) + '/liked', { method: next ? 'POST' : 'DELETE' })
        .then(function () {
          // v1.75: the central Liked playlist (/?liked=1) is the only READ surface, so there
          // is no local lane to re-render or re-count.
          ep.liked = next;
        })
        .catch(function () { setStatus('Could not update the like.'); });
    }

    function saveToDevice(ep) {
      var a = document.createElement('a');
      a.href = '/episode/' + encodeURIComponent(ep.id) + '?download=1';
      a.setAttribute('download', '');
      a.hidden = true;
      document.body.appendChild(a);
      try { a.click(); } finally { a.remove(); }
    }

    // Move to Trash is destructive (recoverable, but it moves the file): the DELETE runs only
    // after ui.confirm resolves true. Cancel, Esc, the scrim and Close all resolve false.
    function confirmTrashEpisode(ep) {
      return window.ui.confirm({
        title: 'Move to Trash?',
        body: '“' + (ep.title || 'This episode') + '” moves to Trash. You can restore it from this episode list.',
        confirmLabel: 'Move to Trash',
        danger: true,
        signal: signal, // an SPA nav away closes it and answers false
      }).then(function (ok) {
        if (ok !== true || signal.aborted) return;
        return fetchJson('/api/podcasts/episodes/' + encodeURIComponent(ep.id), { method: 'DELETE' })
          .then(function () { refreshCurrentView(); })
          .catch(function () { setStatus('Could not delete the episode.'); });
      });
    }

    function restoreEpisode(ep) {
      return fetchJson('/api/podcasts/episodes/' + encodeURIComponent(ep.id) + '/restore', { method: 'POST' })
        .then(function () { refreshCurrentView(); })
        .catch(function (err) { setStatus(err.message || 'Could not restore the episode.'); });
    }

    function togglePlayed(ep, row) {
      var next = !ep.played;
      return fetchJson('/api/podcasts/episodes/' + encodeURIComponent(ep.id) + '/played', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ played: next }),
      }).then(function () {
        ep.played = next;
        if (!row) return;
        if (next) row.setAttribute('data-played', ''); else row.removeAttribute('data-played');
        var metaEl = row.querySelector('.ui-row__meta');
        var line = episodeMetaLine(ep);
        if (!metaEl && line) {
          metaEl = document.createElement('span');
          metaEl.className = 'ui-row__meta';
          var body = row.querySelector('.ui-row__body');
          if (body) body.appendChild(metaEl);
        }
        if (metaEl) metaEl.textContent = line;
      }).catch(function () { setStatus('Could not update played state.'); });
    }

    // The playing episode's row: aria-current (styled as the selected tonal fill, D8.8).
    function applyPlayingHighlight() {
      if (!content) return;
      content.querySelectorAll('[data-episode-id][aria-current]').forEach(function (el) {
        el.removeAttribute('aria-current');
      });
      if (!playingId) return;
      var rows = content.querySelectorAll('[data-episode-id]');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute('data-episode-id') === playingId) rows[i].setAttribute('aria-current', 'true');
      }
    }

    // v1.105 (mirror music): the dock × (close()) doesn't notify this view, so a
    // stale `.playing` row + a stranded now-playing panel would linger after the
    // user closes the player while ON /podcasts. Bind once to the shared
    // #media-player's `emptied` (fires on unload/close); rAF-defer so a
    // reparent-driven emptied (which immediately reloads) is ignored.
    var emptiedBound = false;
    function ensureEmptiedListener() {
      if (emptiedBound) return;
      var mediaEl = document.getElementById('media-player');
      if (!mediaEl) return;
      emptiedBound = true;
      mediaEl.addEventListener('emptied', function () {
        requestAnimationFrame(function () {
          var cur = (window.FileTube && window.FileTube.player && window.FileTube.player.currentId) || null;
          if (!cur) { playingId = null; nowPlaying = null; applyPlayingHighlight(); updateNowPlayingPanel(); }
        });
      }, { signal: signal });
    }

    // v1.105: the expanded now-playing panel (episode title, "Show · date",
    // show-notes description, and an "Up next" list of the show's remaining
    // downloaded episodes). Shown ONLY when the player is EXPANDED (state 'full')
    // AND the podcast episode we last loaded is what's actually playing - hidden +
    // cleared otherwise (reveal-once BOTH axes: a docked/closed player, or a
    // music/video item on the shared host, never shows it). Built with
    // createElement + textContent - the podcast module's no-`innerHTML` law (the
    // description is feed prose; it's stripped to text at parse AND set as text
    // here, double protection).
    function updateNowPlayingPanel() {
      if (!nowPlayingPanel) return;
      // v1.251 (R3): keep the pop-out surface + its button in step (this is the choke every
      // episode change routes through - music's repaintPopout/updatePopoutBtn parity).
      if (popoutShell && hasCurrentPodcastEpisode()) popoutShell.repaint();
      updatePopoutBtn();
      var p = window.FileTube && window.FileTube.player;
      var expanded = !!(p && typeof p.getState === 'function' && p.getState() === 'full');
      var curId = (p && p.currentId) || null;
      if (!expanded || !nowPlaying || !curId || nowPlaying.id !== curId) {
        // reveal-both-axes: clear the skin (+ its full-screen body class) when nothing is
        // expanded/playing, so a podcasts<->music view swap never strands the cover (v1.227).
        if (skinEngine) { try { document.body.classList.remove('mms-on'); } catch (_) { /* ignore */ } nowPlayingPanel.className = 'music-nowplaying-panel'; }
        nowPlayingPanel.hidden = true;
        nowPlayingPanel.textContent = '';
        if (theaterBtn) theaterBtn.hidden = true; // no expanded episode -> no theatre toggle (music parity)
        return;
      }
      // v1.246: on mobile, the panel BECOMES the chosen skin (owns its own art/transport/wheel +
      // the episode list); it covers the app (position:fixed inset:0). Desktop keeps the hand
      // panel below.
      if (skinActive() && skinEngine) {
        document.body.classList.add('mms-on');
        skinEngine.paint();
        return;
      }
      var ci = -1;
      for (var k = 0; k < playable.length; k++) { if (playable[k].id === curId) { ci = k; break; } }
      // v1.251 (R2, Dean: "use the same music player from desktop"): the legacy forward-only
      // fragment is retired - the desktop panel is now the SHARED whole-queue treatment
      // (skin-surface.js buildPanelHtml, music's v1.223 semantics): a window of the episode
      // list around the current one, played rows greyed but clickable (jump back), the
      // current row marked and scrolled into view, the theatre height-cap on wide screens.
      var rows = [];
      if (ci >= 0) {
        var start = Math.max(0, ci - 20); // a little history for jump-back (music parity)
        for (var j = start; j < playable.length && rows.length < 200; j++) {
          var ep = playable[j];
          rows.push({
            id: ep.id,
            artUrl: '/podcastart/' + encodeURIComponent(ep.subId || (nowPlaying && nowPlaying.subId) || ''),
            title: ep.title || 'Untitled episode',
            artist: formatEpisodeMeta(ep),
            index: j,
            state: j < ci ? 'played' : (j === ci ? 'current' : 'next'),
          });
        }
      }
      // v1.311.3: the desktop panel never wears the skin's full-screen body class (music's
      // renderNowPlayingSkin parity) - a rotate out of the mobile skin lands here.
      try { document.body.classList.remove('mms-on'); } catch (_) { /* ignore */ }
      nowPlayingPanel.className = 'music-nowplaying-panel'; // gate r1 QA S2: nor its skin classes
      var S = window.FileTubeSkinSurface;
      var subline = [nowPlaying.showName, formatEpisodeMeta(nowPlaying)].filter(function (x) { return typeof x === 'string' && x; }).join(' · ');
      nowPlayingPanel.innerHTML = (S && typeof S.buildPanelHtml === 'function')
        ? S.buildPanelHtml({ title: nowPlaying.title || 'Untitled episode', subline: subline }, rows)
        : '';
      // The show-notes stay a PODCAST feature (music has none): inserted between the shared
      // meta and queue. textContent - never innerHTML (feed prose).
      if (nowPlaying.description) {
        var desc = document.createElement('div');
        desc.className = 'mnp-desc';
        desc.textContent = nowPlaying.description;
        nowPlayingPanel.insertBefore(desc, nowPlayingPanel.querySelector('.mnp-queue'));
      }
      nowPlayingPanel.hidden = false;
      if (window.FileTube && typeof window.FileTube.shimmerArt === 'function') window.FileTube.shimmerArt(nowPlayingPanel);
      if (theaterBtn) theaterBtn.hidden = false; // an episode is expanded -> the toggle is available (desktop-gated by CSS)
      // Music's v1.224-226 settle, ported: cap the panel to the player's measured height in
      // THEATRE (the up-next scrolls inside, the stage never grows), then scroll the current
      // row into the bounded queue - scrollTop only, never the page; rAF-deferred so the
      // offsetTop read lands after the final layout.
      var mnpQueue = nowPlayingPanel.querySelector('.mnp-queue');
      var curRow = nowPlayingPanel.querySelector('.mnp-queue-row.is-current');
      var isTheater = !!(podcastStage && podcastStage.classList.contains('is-theater'));
      var settleNowPlaying = function () {
        try {
          if (isTheater) {
            var slotEl = root.querySelector('#player-slot');
            var ph = slotEl ? slotEl.getBoundingClientRect().height : 0;
            nowPlayingPanel.style.maxHeight = ph > 120 ? (ph + 'px') : '';
          } else {
            nowPlayingPanel.style.maxHeight = '';
          }
        } catch (_) { /* no layout */ }
        if (mnpQueue && curRow) {
          try { mnpQueue.scrollTop = Math.max(0, (curRow.offsetTop - mnpQueue.offsetTop) - 8); } catch (_) { /* no layout */ }
        }
      };
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(settleNowPlaying);
      else settleNowPlaying();
    }

    // v1.105: a dock-tap expand RE-INITS this view (playAt's `nowPlaying`/
    // `playable` are gone). If a podcast episode is still playing, re-seed the
    // now-playing panel from the live player. `seedNowPlayingFromPlayer` supplies
    // title + show immediately; `rebuildPlayable` refetches the show for the full
    // episode record (description/date/duration) + up-next + Prev/Next.
    function seedNowPlayingFromPlayer() {
      var p = window.FileTube && window.FileTube.player;
      var meta = (p && typeof p.getCurrentMeta === 'function') ? p.getCurrentMeta() : null;
      if (!meta || meta.resumeMode !== 'podcast' || !meta.id) return;
      playingId = meta.id;
      nowPlaying = { id: meta.id, title: meta.title, showName: meta.artist, pubDateMs: null, durationSec: 0, description: '', subId: meta.subId || '' };
      applyPlayingHighlight();
      updateNowPlayingPanel();
    }
    async function rebuildPlayable() {
      var p = window.FileTube && window.FileTube.player;
      var expanded = !!(p && typeof p.getState === 'function' && p.getState() === 'full');
      if (!expanded) return;
      // A SHOW view OWNS `playable` (its episode rows play via
      // playable.indexOf(ep)); clobbering it would desync those rows -> a dead
      // (indexOf -1) tap (the v1.104 rebuild-race lesson). Only the GRID landing
      // (currentShow null, no episode rows) rebuilds. The check is repeated AFTER
      // the await below - `currentShow` can flip null->show DURING the fetch (the
      // ?play= deep link sets it in a .then, async), a TOCTOU the pre-await check
      // alone misses (gate WARNING).
      if (currentShow) { updateNowPlayingPanel(); return; }
      var meta = (p && typeof p.getCurrentMeta === 'function') ? p.getCurrentMeta() : null;
      if (!meta || meta.resumeMode !== 'podcast' || !meta.id || !meta.subId) return;
      var data;
      try {
        data = await fetchJson('/api/podcasts/shows/' + encodeURIComponent(meta.subId) + '/episodes');
      } catch (_) { return; }
      // Post-await re-check: a show opened DURING the fetch now owns `playable`.
      if (signal.aborted || currentShow) return;
      var eps = (data && Array.isArray(data.episodes)) ? data.episodes : [];
      playable = eps.filter(function (e) { return e.status === 'downloaded' && !e.watchHref; });
      var ci = -1;
      for (var k = 0; k < playable.length; k++) { if (playable[k].id === meta.id) { ci = k; break; } }
      if (ci >= 0) {
        var ep = playable[ci];
        nowPlaying = { id: ep.id, title: ep.title || '', showName: meta.artist || (data.show && data.show.name) || '', pubDateMs: ep.pubDateMs, durationSec: ep.durationSec || 0, description: ep.description || '', subId: meta.subId };
      }
      registerTrackNav(ci); // ci<0 clears stale nav
      updateNowPlayingPanel();
    }

    // `opts.keepPosition` = a NAV step (next/prev) - keep the player where it is.
    // Omitted (a fresh SELECT: an episode tap, up-next tap, continue) - expand.
    function playAt(i, opts) {
      opts = opts || {};
      var ep = playable[i];
      if (!ep || !currentShow) return;
      // v1.334 (Dean): the tap that starts an episode is the gesture iOS needs to ask for motion access -
      // SYNCHRONOUSLY, before the load's fetches spend it (pocket-lighting.js askForOpen decides: once per
      // session, only when the player it opens is a Click skin that would light).
      try { if (window.FileTubePocketLighting && typeof window.FileTubePocketLighting.askForOpen === 'function') window.FileTubePocketLighting.askForOpen(window); } catch (_) { /* lighting is optional */ }
      // v1.71: derive show identity per-EPISODE where the payload carries it
      // (ep.subId/showName are authoritative wherever the payload sets them).
      // A plain show view falls back to currentShow. v1.75: the cross-show
      // Liked lane that MADE this necessary is gone, so currentShow is now
      // always right - the per-episode read is kept because it is strictly
      // more specific and costs nothing, not because a cross-show surface
      // still exists.
      var showName = ep.showName || currentShow.name;
      var artSubId = ep.subId || currentShow.id;
      var data = {
        type: 'audio',
        title: ep.title,
        channelName: showName,
        folderName: showName,
        duration: ep.durationSec || 0,
        artUrl: '/podcastart/' + encodeURIComponent(artSubId),
        streamSrc: '/episode/' + ep.id,
        progressEndpoint: '/api/podcasts/progress',
        resumeMode: 'podcast',
        subId: artSubId, // v1.105: so player.getCurrentMeta can expose the show id for the re-init reseed
        autoAdvanceViaTrackNav: true,
        // v1.71 T7: tapping the docked player opens the expanded
        // now-playing view in ONE gesture (Dean's ruling) - the ?nowplaying
        // param tells this controller's init to expand into #player-slot.
        readerHref: '/podcasts?nowplaying=1',
      };
      playingId = ep.id;
      // v1.105: the metadata the now-playing panel renders (episode title, show,
      // date, description) - kept here at play time; re-seeded from the live
      // player after a dock-tap re-init (seedNowPlayingFromPlayer + rebuildPlayable).
      nowPlaying = { id: ep.id, title: ep.title || '', showName: showName, pubDateMs: ep.pubDateMs, durationSec: ep.durationSec || 0, description: ep.description || '', subId: artSubId };
      applyPlayingHighlight();
      // v1.106 (Dean, mirror music): SELECTING an episode opens the EXPANDED
      // now-playing view (mount FULL into #player-slot); a NAV (next/prev, opts.
      // keepPosition, v1.105) keeps the player's position - expanded stays
      // expanded, docked stays docked. So a fresh select -> slot; a nav -> slot
      // only if already full, else dock (the mini-player appears when you browse).
      var pl = window.FileTube.player;
      var slot = root.querySelector('#player-slot');
      var useSlot = opts.keepPosition
        ? (pl && typeof pl.getState === 'function' && pl.getState() === 'full')
        : true;
      pl.load(ep.id, data, (useSlot && slot) ? { slot: slot } : { dock: true });
      // Bring the freshly-expanded player into view (it mounts at the top). Only
      // on a SELECT - a nav keeps you where you are.
      if (!opts.keepPosition && useSlot && slot) { try { window.scrollTo(0, 0); } catch (_) { /* no window scroll */ } }
      ensureEmptiedListener(); // the host (with #media-player) now exists
      registerTrackNav(i);
      updateNowPlayingPanel();
    }

    // The lock-screen / expanded-view Prev/Next handlers for playable index `i`.
    // Factored out (was inline in playAt) so the re-init reseed (rebuildPlayable)
    // can re-register them. i<0 registers NO neighbors (clears stale closures).
    function registerTrackNav(i) {
      if (!window.FileTube.player || typeof window.FileTube.player.setTrackNav !== 'function') return;
      window.FileTube.player.setTrackNav({
        onPrev: i > 0 ? function () { playAt(i - 1, { keepPosition: true }); } : undefined,
        onNext: (i >= 0 && i < playable.length - 1) ? function () { playAt(i + 1, { keepPosition: true }); } : undefined,
      });
    }

    // ---- the add + settings sheets (UI pass S6: ui.sheet dialogs built on demand) ----
    // A sheet lives on <body>, outside #view-root, so the view closes it on teardown (an SPA
    // nav away must never strand it over the next view).
    function openFormSheet(title, content, initialFocus) {
      var ctrl = window.ui.sheet({ variant: 'dialog', title: title, content: content, initialFocus: initialFocus, signal: signal });
      ctrl.open();
      return ctrl;
    }
    function formError() {
      var p = document.createElement('p');
      p.className = 'ui-field__error';
      p.setAttribute('role', 'alert');
      p.hidden = true;
      return p;
    }
    function showFormError(p, msg) { p.textContent = msg; p.hidden = !msg; }
    function formActions(cancelLabel, okLabel) {
      var row = document.createElement('div');
      row.className = 'ui-confirm__actions';
      var cancel = window.ui.button({ variant: 'secondary', label: cancelLabel });
      var ok = window.ui.button({ variant: 'primary', label: okLabel });
      row.appendChild(cancel);
      row.appendChild(ok);
      return { row: row, cancel: cancel, ok: ok };
    }

    function openAddSheet() {
      var ui = window.ui;
      var form = document.createElement('div');
      form.className = 'podcast-form';
      var url = ui.field({ label: 'RSS feed URL', type: 'url', placeholder: 'https://example.com/feed.xml',
        help: 'Private feed URLs (Patreon etc.) contain a personal access token. FileTube keeps the URL on your server in a permissions-restricted file - it never appears in the interface, logs, or backups again.' });
      url.input.setAttribute('autocomplete', 'off');
      url.input.setAttribute('spellcheck', 'false');
      form.appendChild(url.el);
      var backfill = ui.select({ label: 'Download', value: 'all', options: [
        { value: 'all', label: 'Every episode (full offline cache)' },
        { value: '10', label: 'The latest 10 episodes' },
        { value: '25', label: 'The latest 25 episodes' },
        { value: 'new', label: 'New episodes only' },
      ] });
      form.appendChild(backfill.el);
      var err = formError();
      form.appendChild(err);
      var acts = formActions('Cancel', 'Subscribe');
      form.appendChild(acts.row);
      var ctrl = openFormSheet('Add a podcast', form, url.input);
      function submit() {
        showFormError(err, '');
        ui.setBusy(acts.ok, true);
        fetchJson('/api/podcasts/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedUrl: url.input.value.trim(), backfill: backfill.select.value }),
        }).then(function () {
          ctrl.close();
          setStatus('Subscribed - checking the feed…');
          startStatusPolling();
          loadShows();
        }).catch(function (e) {
          showFormError(err, e.message || 'Could not subscribe.');
        }).then(function () { ui.setBusy(acts.ok, false); });
      }
      acts.cancel.addEventListener('click', function () { ctrl.close(); });
      acts.ok.addEventListener('click', submit);
      url.input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); }
      });
      return ctrl;
    }

    function openSettingsSheet() {
      var ui = window.ui;
      return fetchJson('/api/podcasts/settings').then(function (s) {
        if (signal.aborted) return null;
        var options = [
          { value: '30', label: '30 minutes' }, { value: '60', label: 'Hour' }, { value: '180', label: '3 hours' },
          { value: '360', label: '6 hours' }, { value: '720', label: '12 hours' }, { value: '1440', label: 'Day' },
          { value: '0', label: 'Manual checks only' },
        ];
        var v = String(s.pollMinutes);
        // An interval outside the preset list still displays honestly.
        if (!options.some(function (o) { return o.value === v; })) options.push({ value: v, label: s.pollMinutes + ' minutes' });
        var form = document.createElement('div');
        form.className = 'podcast-form';
        var poll = ui.select({ label: 'Check feeds every', value: v, options: options });
        form.appendChild(poll.el);
        var dir = document.createElement('div');
        dir.className = 'ui-field';
        var dirLabel = document.createElement('span');
        dirLabel.className = 'ui-field__label';
        dirLabel.textContent = 'Episodes are saved to';
        var dirText = document.createElement('p');
        dirText.className = 'ui-field__help';
        dirText.textContent = s.downloadDir + ' (set FILETUBE_PODCASTS_DIR to change)';
        dir.appendChild(dirLabel);
        dir.appendChild(dirText);
        form.appendChild(dir);
        var err = formError();
        form.appendChild(err);
        var acts = formActions('Cancel', 'Save');
        form.appendChild(acts.row);
        var ctrl = openFormSheet('Podcast settings', form, null);
        acts.cancel.addEventListener('click', function () { ctrl.close(); });
        acts.ok.addEventListener('click', function () {
          showFormError(err, '');
          fetchJson('/api/podcasts/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pollMinutes: Number(poll.select.value) }),
          }).then(function () { ctrl.close(); })
            .catch(function (e) { showFormError(err, e.message || 'Could not save.'); });
        });
        return ctrl;
      }).catch(function () { setStatus('Could not load podcast settings.'); return null; });
    }

    // ---- feed checking + live status ----
    function startStatusPolling() {
      if (statusPollTimer) return;
      statusPollTimer = setInterval(function () {
        fetchJson('/api/podcasts/status').then(function (s) {
          if (signal.aborted) return;
          var keys = Object.keys(s.activity || {});
          if (s.polling && keys.length > 0) {
            var a = s.activity[keys[0]];
            setStatus(a && a.state === 'downloading' ? ('Downloading episodes… ' + (a.detail || '')) : 'Checking feeds…');
          } else if (!s.polling) {
            clearInterval(statusPollTimer);
            statusPollTimer = null;
            setStatus('');
            refreshCurrentView();
          }
        }).catch(function () { /* transient - keep polling */ });
      }, 2500);
      if (statusPollTimer.unref) statusPollTimer.unref();
    }

    function loadShows() {
      // v1.75: the GET /api/podcasts/liked count-fetch that used to ride along
      // here went with the lane card it gated - the podcasts place shows real
      // shows only now. The route itself stays (other consumers).
      // v1.98 shimmer sweep: seed the grid shimmer before the fetch, but ONLY at
      // the true blank moment - when the grid is on screen (not an open show's
      // episodes) AND not already populated. Guarding on an existing .podcast-show-list
      // stops a status-poll refresh (refreshCurrentView after a subscribe/like/
      // check-feeds) from flashing loaded content back to shimmer (gate
      // SUGGESTION: a reveal-once violation). renderShows' content.textContent=''
      // is the reveal; the catch clears it.
      if (!currentShow && content && !content.querySelector('.podcast-show-list')) {
        content.innerHTML = buildPodcastSkeletonRows(6);
      }
      fetchJson('/api/podcasts/shows').then(function (data) {
        if (signal.aborted) return;
        shows = data.shows || [];
        if (!currentShow) renderShows();
      }).catch(function () {
        if (signal.aborted) return;
        if (!currentShow && content) {
          content.innerHTML = ''; // never strand the shimmer
          // D9: a failed load is an error state, never the "No podcasts yet" empty state.
          if (emptyNote) emptyNote.hidden = true;
          renderLoadError('Could not load podcasts', loadShows);
        }
      });
    }

    var settingsBtn = root.querySelector('#podcasts-settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', function () { openSettingsSheet(); }, { signal: signal });
    if (addBtn) addBtn.addEventListener('click', function () { openAddSheet(); }, { signal: signal });
    // The zero-shows state (plan D9: one ui-state block), drawn into its host once per init.
    if (emptyNote) {
      emptyNote.textContent = '';
      emptyNote.appendChild(window.ui.state({
        icon: 'podcasts',
        title: 'No podcasts yet',
        body: 'Add a podcast with its RSS feed URL: a public feed, or a private one from Patreon\'s "listen in other podcast apps" (its URL carries your personal token; it is stored on your server only).',
        action: { label: 'Add podcast', onClick: function () { openAddSheet(); } },
      }));
    }
    if (checkBtn) {
      checkBtn.addEventListener('click', function () {
        fetchJson('/api/podcasts/check', { method: 'POST' }).then(function () {
          setStatus('Checking feeds…');
          startStatusPolling();
        }).catch(function () { setStatus('Could not start the check.'); });
      }, { signal: signal });
    }

    loadShows();

    // v1.71 T5: /podcasts?play=<episodeId> - a home Continue-listening card
    // (or a queue advance, T6) lands here and must open the owning show and
    // start THAT episode in the dock; the resumeMode:'podcast' ladder
    // applies the saved position server-side. A bad or gone id degrades to
    // the plain grid (the music playTrackFromContinue posture).
    function consumeDeepLink(epId) {
      var showAtStart = showKey(currentShow); // T-C8: the view this deep link started on (the grid, '')
      var linkShowId = null; // T-C8: the show this deep link drilled into, once it has
      fetchJson('/api/podcasts/episodes/' + encodeURIComponent(epId))
        .then(function (ep) {
          if (signal.aborted || !ep || !ep.subId) return;
          // v1.339 R1 (T-C8): a show the user opened during this fetch owns the view now.
          if (showKey(currentShow) !== showAtStart) return;
          var show = null;
          for (var k = 0; k < shows.length; k++) { if (shows[k].id === ep.subId) { show = shows[k]; break; } }
          if (!show) show = { id: ep.subId, name: ep.showName || 'Podcast' };
          currentShow = show;
          linkShowId = showKey(show);
          // v1.157 (P3): reserve the show view before the episodes fetch (same
          // as openShow) so a ?play= deep link does not flash empty.
          if (content) content.innerHTML = buildPodcastShowSkeleton(6);
          return fetchJson('/api/podcasts/shows/' + encodeURIComponent(show.id) + '/episodes')
            .then(function (data) {
              // T-C8: Back (or another show) during the episodes fetch - no paint, no playAt
              if (signal.aborted || showKey(currentShow) !== showKey(show)) return;
              currentShow = data.show || show;
              episodes = data.episodes || [];
              renderEpisodes();
              // v1.106: the earlier QA-W1 row.scrollIntoView (so a deep-linked
              // episode 80 rows deep wasn't off-screen) is superseded here - a
              // ?play= SELECT now expands the now-playing view and scrolls to the
              // top (playAt -> loadTrack window.scrollTo(0,0)), which shows the
              // playing episode + its up-next, so scrolling to the row would be
              // clobbered anyway.
              for (var i = 0; i < playable.length; i++) {
                if (playable[i].id === epId) { playAt(i); return; }
              }
            });
        })
        .catch(function () {
          if (signal.aborted) return;
          // T-C8: clear only while the view this link owns is still current (its show once it
          // drilled in, else the view it started on) - never wipe what Back / another show drew.
          if (showKey(currentShow) !== (linkShowId !== null ? linkShowId : showAtStart)) return;
          // v1.157 (P3, gate WARNING): once this path seeds the show skeleton
          // (before the /episodes fetch above), an error must CLEAR it -- else
          // it shimmers forever with the grid gone. Mirror openShow's catch.
          if (content) content.innerHTML = '';
          setStatus('Could not load episodes.');
        });
    }
    var playParam = null;
    try { playParam = new URLSearchParams(window.location.search).get('play'); } catch (_) { playParam = null; }
    if (playParam) consumeDeepLink(playParam);

    // v1.72 (intake ruling 5): /podcasts?show=<subId> - a pinned show in
    // the Playlists surface deep-links its drill. A bad/gone id lands in
    // openShow's catch, which paints a "Could not load episodes" error state
    // (with Retry) where the grid was (deliberately LOUDER than ?play='s silent degrade: a dead pin
    // deserves a visible signal - adversarial gate v1.72 S1 measured the
    // difference; this comment records it honestly). The show list may not
    // have loaded yet, so the drill opens from the id alone - openShow
    // fetches the authoritative record with the episodes.
    var showParam = null;
    try { showParam = new URLSearchParams(window.location.search).get('show'); } catch (_) { showParam = null; }
    if (showParam && !playParam) {
      openShow({ id: showParam, name: 'Podcast' });
    }

    // v1.71 T7: arriving via the docked player's tap (?nowplaying=1)
    // expands the LIVE player into this page's #player-slot - the big
    // audio-art now-playing view. Guarded: a stale/bookmarked URL with
    // nothing playing degrades to the grid.
    //
    // Gate W2: a podcasts->podcasts navigation (sidebar/bottom-bar Podcasts
    // tap, ?play=, ?nowplaying=) swaps #view-root WITHOUT docking
    // (shouldDockOnTransition same-view rule), which discards the old
    // view's #player-slot with an EXPANDED player inside it - stranding
    // live audio in a detached subtree. So a FULL player is re-adopted
    // into THIS view's slot on every init (the read.js re-mount
    // precedent), ?nowplaying or not.
    var wantNowPlaying = false;
    try { wantNowPlaying = new URLSearchParams(window.location.search).get('nowplaying') === '1'; } catch (_) { wantNowPlaying = false; }
    // v1.105 (mirror music v1.104): re-seed the now-playing metadata from the
    // live player before the first paint (a dock-tap expand re-inits with
    // nowPlaying=null, so the panel would otherwise be blank for a playing episode).
    seedNowPlayingFromPlayer();
    // v1.105 (dock-return determinism, mirror music v1.103): `?nowplaying=1` is a
    // TRANSIENT expand trigger. Strip it (BEFORE expand, so a throwing expand
    // can't skip it) so it never persists - else a later dock re-tap navigates to
    // the SAME /podcasts?nowplaying=1 the bar already shows and the router's
    // same-URL no-op swallows it, stranding the docked player. Podcasts never had
    // this strip (the latent bug music fixed in v1.103).
    stripNowPlayingParam();
    var player = window.FileTube && window.FileTube.player;
    if (player && typeof player.getState === 'function' && typeof player.expand === 'function') {
      var pState = player.getState();
      var npSlot = root.querySelector('#player-slot');
      if (npSlot && (pState === 'full' || (wantNowPlaying && pState === 'docked'))) {
        player.expand(npSlot);
      }
    }
    // v1.105 (gate CRITICAL): bind the close/emptied listener at init too, not
    // only in playAt. The dock-tap RESEED path reveals the panel via
    // seedNowPlayingFromPlayer + expand WITHOUT playAt ever running this instance,
    // so without this the panel would strand (stay shown with stale metadata) when
    // the user closes the player. The shared #media-player is in the DOM whenever
    // something is playing (docked or in the slot); ensureEmptiedListener no-ops
    // when nothing is. Mirrors music.js's init-time bind.
    ensureEmptiedListener();
    // v1.105: with the player (possibly just) expanded, show the now-playing panel
    // - metadata now, up-next once rebuildPlayable refetches the show.
    updateNowPlayingPanel();
    rebuildPlayable().catch(function () {});

    // Teardown extras the AbortController cannot cover.
    controller.__podcastsCleanup = function () {
      if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; }
    };
  }

  function destroy() {
    // v1.273: stop Brick BEFORE the engine goes - it holds a wheel takeover and a
    // keydown listener on this document, and the view dying first delivers no engine
    // event (music.js does the same at its own destroy).
    if (activeBrickStop) { try { activeBrickStop(); } catch (_) { /* best effort */ } activeBrickStop = null; }
    // v1.246: tear the skin down FIRST - unbinds its panel listeners AND clears body.mms-on so
    // a swap to another view never leaves the full-screen cover (frozen scroll) behind (v1.227).
    if (activeSkinEngine) { try { activeSkinEngine.destroy(); } catch (_) { /* ignore */ } activeSkinEngine = null; }
    if (activePodcastPopoutTeardown) { try { activePodcastPopoutTeardown(); } catch (_) { /* ignore */ } activePodcastPopoutTeardown = null; } // v1.251 (R3)
    if (controller) {
      if (controller.__podcastsCleanup) controller.__podcastsCleanup();
      controller.abort();
    }
    controller = null;
    // v1.218: drop the torn-down init's pop handler (a stray popstate after
    // destroy() is a no-op, not a call into dead closure state).
    activePodcastPopHandler = null;
  }

  // v1.105 (mirror music v1.103): strip the transient `?nowplaying` marker via
  // replaceState after init consumes it, carrying the router's state object
  // forward with a corrected `url` so popstate stays consistent. Module-scoped
  // (no init closure needed) - it only touches window.location/history.
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

  if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('podcasts', {
      init: init,
      destroy: destroy,
      // v1.218 in-view back-stack: the router calls this for a within-Podcasts pop
      // (its popStateDelegate gate). Delegate to the live init's handler; false
      // when torn down so the router falls through to its normal swap.
      onPopState: function (state) { return activePodcastPopHandler ? activePodcastPopHandler(state) : false; },
    });
  }

  // UI pass S6 (D9: skeletons of the FINAL geometry). The loading placeholders are the real
  // primitives' DOM - the same ui-list classes ui.list() emits and the same ui-row slots
  // ui.row() emits - so the reveal swaps boxes of identical size. The class strings are pinned
  // against ui.list()'s own output by test/unit/podcasts-ui-sweep.test.js. Pure (strings) ->
  // node:test-covered.
  var SHOW_LIST_CLASS = 'ui-list ui-list--media ui-list--media-art ui-list--aside-none ui-list--actions-0 ui-list--divider-inset podcast-show-list';
  var EPISODE_LIST_CLASS = 'ui-list ui-list--default ui-list--media-none ui-list--aside-none ui-list--actions-2 ui-list--divider-inset podcast-episodes';
  var SKELETON_LINES = '<div class="skeleton-line skeleton-line-title skeleton-shimmer"></div>' +
    '<div class="skeleton-line skeleton-line-meta skeleton-shimmer"></div>';

  // The show list's placeholder: n media rows, each with the xl art square.
  function buildPodcastSkeletonRows(n) {
    var count = Number.isInteger(n) && n > 0 ? n : 0;
    if (count === 0) return '';
    var rows = '';
    for (var i = 0; i < count; i++) {
      rows += '<div class="ui-row ui-row--media" role="listitem" aria-hidden="true">' +
        '<span class="ui-row__lead"></span>' +
        '<span class="ui-row__media"><span class="ui-art ui-avatar--xl skeleton-shimmer"></span></span>' +
        '<span class="ui-row__body">' + SKELETON_LINES + '</span>' +
        '<span class="ui-row__aside"></span><span class="ui-row__actions"></span>' +
        '</div>';
    }
    return '<div class="' + SHOW_LIST_CLASS + '" role="list" aria-hidden="true">' + rows + '</div>';
  }

  // v1.157 (P3, crispness): the opened / pinned SHOW view's placeholder, seeded into
  // #podcasts-content before the episodes fetch so the show does not paint empty then pop in.
  // The real header box (2xl art + a title bar) over n episode rows with both action slots
  // reserved.
  function buildPodcastShowSkeleton(n) {
    var count = Number.isInteger(n) && n > 0 ? n : 0;
    var rows = '';
    for (var i = 0; i < count; i++) {
      rows += '<div class="ui-row ui-row--default" role="listitem" aria-hidden="true">' +
        '<span class="ui-row__lead"></span><span class="ui-row__media"></span>' +
        '<span class="ui-row__body">' + SKELETON_LINES + '</span>' +
        '<span class="ui-row__aside"></span>' +
        '<span class="ui-row__actions"><span class="ui-row__slot"></span><span class="ui-row__slot"></span></span>' +
        '</div>';
    }
    return '<div class="podcast-show-head" aria-hidden="true">' +
      '<span class="ui-art ui-avatar--2xl skeleton-shimmer"></span>' +
      '<div class="podcast-show-meta"><div class="skeleton-line skeleton-line-title skeleton-shimmer"></div></div>' +
      '</div>' +
      '<div class="' + EPISODE_LIST_CLASS + '" role="list" aria-hidden="true">' + rows + '</div>';
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      formatEpisodeDuration: formatEpisodeDuration,
      formatEpisodeMeta: formatEpisodeMeta,
      episodeChipLabel: episodeChipLabel,
      resumeFraction: resumeFraction,
      showCountLine: showCountLine,
      showMetaLine: showMetaLine,
      showStatusLine: showStatusLine,
      showArtUrl: showArtUrl,
      episodeMetaLine: episodeMetaLine,
      buildPodcastSkeletonRows: buildPodcastSkeletonRows,
      buildPodcastShowSkeleton: buildPodcastShowSkeleton,
      SHOW_LIST_CLASS: SHOW_LIST_CLASS,
      EPISODE_LIST_CLASS: EPISODE_LIST_CLASS,
    };
  }
})();
