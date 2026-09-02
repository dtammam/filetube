'use strict';

// v1.69.0: the /podcasts place controller. Show grid -> episode list drill
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

  // The show card's one-line summary: "12 of 484 downloaded" (or the plain
  // count once everything is local).
  function showCountLine(show) {
    if (!show) return '';
    var total = Number(show.episodeCount) || 0;
    var down = Number(show.downloadedCount) || 0;
    if (total === 0) return 'No episodes yet';
    if (down >= total) return total + (total === 1 ? ' episode' : ' episodes');
    return down + ' of ' + total + ' downloaded';
  }

  // ---- the view ------------------------------------------------------------

  var controller = null;
  // v1.218 (in-view back-stack, media-nav arc): the LIVE onPopState handler for
  // the mounted init closure (it needs init's `currentShow`/openShow/backToGrid).
  // Module-scoped so the stable module.onPopState delegates to the current init;
  // nulled by destroy() so a pop after teardown is a no-op. Mirrors music.js.
  var activePodcastPopHandler = null;
  var activeSkinEngine = null; // v1.246: module-scoped so destroy() can tear the skin down (clears body.mms-on)

  function init(root) {
    controller = new AbortController();
    var signal = controller.signal;

    var content = root.querySelector('#podcasts-content');
    var emptyNote = root.querySelector('#podcasts-empty');
    var crumb = root.querySelector('#podcasts-crumb');
    var statusEl = root.querySelector('#podcasts-status');
    var addBtn = root.querySelector('#podcasts-add-btn');
    var checkBtn = root.querySelector('#podcasts-check-btn');
    var sheet = root.querySelector('#podcasts-add-sheet');
    var sheetBackdrop = root.querySelector('#podcasts-add-backdrop');
    var sheetUrl = root.querySelector('#podcasts-add-url');
    var sheetBackfill = root.querySelector('#podcasts-add-backfill');
    var sheetSubmit = root.querySelector('#podcasts-add-submit');
    var sheetCancel = root.querySelector('#podcasts-add-cancel');
    var sheetError = root.querySelector('#podcasts-add-error');

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
    if (nowPlayingPanel && window.FileTubeSkinSurface) {
      skinEngine = window.FileTubeSkinSurface.create({
        panel: nowPlayingPanel,
        getSkinId: function () { return SKINS ? SKINS.activeSkinId() : 'ipod'; },
        getCtx: podcastSkinCtx,
        hostCtl: function (id) { return document.getElementById(id); },
        onSelectIndex: function (i) { playAt(i); },
        onDock: function () { var pp = window.FileTube && window.FileTube.player; if (pp && typeof pp.dock === 'function') pp.dock(); updateNowPlayingPanel(); if (window.FileTube && window.FileTube.returnToPlayerOrigin) window.FileTube.returnToPlayerOrigin(); }, // v1.247 (F2): dock to the mini on the ORIGIN tab
        // v1.250 (F-UNIFY ride-along): the two DEFERRED v1.246 polish items arrive with the
        // shared engine - hold-to-fast-scan on the wheel's rewind/ffwd zones, and the sticker
        // quick-menu (speed/loop/skin). NO extras key: podcasts keep their own episode
        // actions (the locked v1.249 intake), so the engine renders no Extras entry here.
        fastScan: true,
        sticker: {
          getPlayer: function () { return (window.FileTube && window.FileTube.player) || null; },
          onSkinChange: function () { updateNowPlayingPanel(); }, // repaint with the newly-picked skin
        },
      });
      activeSkinEngine = skinEngine; // module-scoped handle for destroy()'s teardown
      // reflect the live element into the skin (music.js ensureSkinReflect parity); the engine's
      // reflect() early-returns unless the skin is actually mounted, so this is a cheap no-op the
      // rest of the time. Bound with the view's signal so destroy() drops them.
      var mpEl = document.getElementById('media-player');
      if (mpEl && skinEngine) {
        ['play', 'pause', 'timeupdate', 'seeked', 'loadedmetadata', 'loadstart', 'emptied', 'durationchange'].forEach(function (ev) {
          mpEl.addEventListener(ev, function () { if (skinEngine) skinEngine.reflect(); }, { signal: signal });
        });
      }
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

    // ---- the show grid ----
    function renderShows() {
      if (!content) return;
      content.textContent = '';
      if (crumb) { crumb.hidden = true; crumb.textContent = ''; }
      if (emptyNote) emptyNote.hidden = shows.length > 0;
      if (shows.length === 0) return;
      var grid = document.createElement('div');
      grid.className = 'podcast-grid';
      shows.forEach(function (show) {
        grid.appendChild(buildShowCard(show));
      });
      content.appendChild(grid);
      revealPodcastArt();
    }

    // v1.102 (tranche 4 shimmer): the show/episode art images ship `art-shimmer`;
    // the shared decode-reveal clears each the instant it decodes (and immediately
    // for a cached one, so a warm image never shimmers forever).
    function revealPodcastArt() {
      if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.shimmerArt === 'function') {
        window.FileTube.shimmerArt(content);
      }
    }

    // v1.102 (tranche 4): the episode-row action glyphs (like/queue/save/delete)
    // are inline chrome-icon SVGs, not `.icon-*` masks - a mask paints nothing
    // until it decodes, so on an iOS cold start it popped in a beat late (the v1.87
    // class). chromeIconEl is a common.js browser global reached via `window.`;
    // returns null only if the map/document is unavailable (never in a real
    // browser), so callers null-guard the append.
    function rowGlyphEl(name) {
      return (typeof window !== 'undefined' && typeof window.chromeIconEl === 'function') ? window.chromeIconEl(name) : null;
    }

    // Refresh whatever list is on screen from server state (delete/restore/
    // like handlers).
    function refreshCurrentView() {
      if (!currentShow) { loadShows(); return; }
      openShow(currentShow);
    }

    function buildShowCard(show) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'podcast-card';
      var art = document.createElement('img');
      art.className = 'podcast-card-art art-shimmer';
      art.alt = '';
      art.loading = 'lazy';
      // A ytdlp-sourced show carries a server-built artUrl (a /thumbnail/
      // path); RSS shows use the show-cover route.
      art.src = show.artUrl || ('/podcastart/' + encodeURIComponent(show.id));
      card.appendChild(art);
      var title = document.createElement('div');
      title.className = 'podcast-card-title';
      title.textContent = show.name;
      card.appendChild(title);
      var line = document.createElement('div');
      line.className = 'podcast-card-sub';
      line.textContent = showCountLine(show);
      card.appendChild(line);
      if (show.secretMissing) {
        var warn = document.createElement('div');
        warn.className = 'podcast-card-warn';
        warn.textContent = 'Feed URL needs re-entry';
        card.appendChild(warn);
      }
      card.addEventListener('click', function () { pushShowLevel(show); openShow(show); }, { signal: signal });
      return card;
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
          if (signal.aborted) return;
          currentShow = data.show || show;
          episodes = data.episodes || [];
          renderEpisodes();
        })
        .catch(function () {
          if (signal.aborted) return;
          if (content) content.innerHTML = ''; // never strand the shimmer
          setStatus('Could not load episodes.');
        });
    }

    function backToGrid() {
      currentShow = null;
      episodes = [];
      loadShows();
    }

    // v1.218 in-view back-stack: opening a show from the grid stamps a history
    // level so OS/browser back steps back to the grid instead of leaving
    // Podcasts. INTERACTIVE descents only (the card click); the ?show= init deep
    // link and refreshCurrentView re-open via openShow directly, no push.
    function showKey(s) { return (s && s.id) ? String(s.id) : ''; }
    function pushShowLevel(show) {
      var ft = window.FileTube;
      // The same-id check is a DEFENSIVE guard, not a live dedup: today the only
      // caller is the grid card, which only exists while currentShow is null, so
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
      content.textContent = '';
      if (emptyNote) emptyNote.hidden = true;
      if (crumb) {
        crumb.textContent = '';
        crumb.hidden = false;
        var back = document.createElement('button');
        back.type = 'button';
        back.className = 'btn btn-sm';
        back.textContent = '‹ All podcasts';
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
        var name = document.createElement('span');
        name.className = 'podcast-crumb-name';
        name.textContent = currentShow ? currentShow.name : '';
        crumb.appendChild(name);
      }

      var head = document.createElement('div');
      head.className = 'podcast-show-head';
      var art = document.createElement('img');
      art.className = 'podcast-show-art art-shimmer';
      art.alt = '';
      art.src = currentShow.artUrl || ('/podcastart/' + encodeURIComponent(currentShow.id));
      head.appendChild(art);
      var meta = document.createElement('div');
      meta.className = 'podcast-show-meta';
      var h = document.createElement('h3');
      h.textContent = currentShow.name;
      meta.appendChild(h);
      if (currentShow.author) {
        var by = document.createElement('div');
        by.className = 'podcast-show-author';
        by.textContent = currentShow.author;
        meta.appendChild(by);
      }
      if (currentShow.description) {
        var desc = document.createElement('p');
        desc.className = 'podcast-show-desc';
        desc.textContent = currentShow.description;
        meta.appendChild(desc);
      }
      var counts = document.createElement('div');
      counts.className = 'podcast-card-sub';
      counts.textContent = showCountLine(currentShow) + (currentShow.lastStatus ? ' · ' + currentShow.lastStatus : '');
      meta.appendChild(counts);
      // The management row (v1.69 QA gate #3): pause/resume + unsubscribe +
      // the secretMissing re-entry lane. RSS shows only - a ytdlp-sourced
      // show is managed on its own /subscriptions page.
      if (currentShow.source !== 'ytdlp') {
        // v1.72 (intake ruling 5): pin this show into the Playlists
        // surface - the channel-folder/book-shelf parity affordance.
        // Non-optimistic: label flips only after the round trip; current
        // state is read from the pins route (membership IS the state).
        var pinBtn = document.createElement('button');
        pinBtn.type = 'button';
        pinBtn.className = 'btn btn-sm podcast-pin-btn';
        pinBtn.textContent = 'Pin to Playlists';
        pinBtn.disabled = true;
        var showPinned = false;
        function paintPinBtn() {
          pinBtn.textContent = showPinned ? 'Pinned ★' : 'Pin to Playlists';
          pinBtn.setAttribute('aria-pressed', showPinned ? 'true' : 'false');
          pinBtn.disabled = false;
        }
        fetchJson('/api/podcasts/pins')
          .then(function (pins) {
            if (signal.aborted) return;
            showPinned = Array.isArray(pins) && pins.some(function (p) { return p && p.id === currentShow.id; });
            paintPinBtn();
          })
          .catch(function () { /* leave disabled - state unknown */ });
        pinBtn.addEventListener('click', function () {
          pinBtn.disabled = true;
          var req = showPinned
            ? fetchJson('/api/podcasts/pins/' + encodeURIComponent(currentShow.id), { method: 'DELETE' })
            : fetchJson('/api/podcasts/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subId: currentShow.id }) });
          req.then(function () {
            showPinned = !showPinned;
            paintPinBtn();
            // The pinned sidebar + Playlists sheet re-read the merged pins.
            if (window.FileTube && typeof window.FileTube.refreshAllPinSurfaces === 'function') window.FileTube.refreshAllPinSurfaces();
          }).catch(function () { paintPinBtn(); });
        }, { signal: signal });
        meta.appendChild(pinBtn);
        meta.appendChild(buildManageRow());
      }
      head.appendChild(meta);
      content.appendChild(head);

      var list = document.createElement('div');
      list.className = 'podcast-episode-list';
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

    function buildManageRow() {
      var row = document.createElement('div');
      row.className = 'podcast-manage-row';

      var pauseBtn = document.createElement('button');
      pauseBtn.type = 'button';
      pauseBtn.className = 'btn btn-sm';
      pauseBtn.textContent = currentShow.paused ? 'Resume checks' : 'Pause checks';
      pauseBtn.addEventListener('click', function () {
        fetchJson('/api/podcasts/subscriptions/' + encodeURIComponent(currentShow.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paused: !currentShow.paused }),
        }).then(function () {
          currentShow.paused = !currentShow.paused;
          pauseBtn.textContent = currentShow.paused ? 'Resume checks' : 'Pause checks';
        }).catch(function () { setStatus('Could not update the subscription.'); });
      }, { signal: signal });
      row.appendChild(pauseBtn);

      // Unsubscribe: the two-tap confirm (the trash-purge pattern), with the
      // files-stay-on-disk disclosure IN the confirming label (D13).
      var unsubBtn = document.createElement('button');
      unsubBtn.type = 'button';
      unsubBtn.className = 'btn btn-sm podcast-unsub-btn';
      unsubBtn.textContent = 'Unsubscribe';
      var confirming = false;
      unsubBtn.addEventListener('click', function () {
        if (!confirming) {
          confirming = true;
          unsubBtn.classList.add('confirming');
          unsubBtn.textContent = 'Unsubscribe? Downloaded files stay on disk';
          return;
        }
        fetchJson('/api/podcasts/subscriptions/' + encodeURIComponent(currentShow.id), { method: 'DELETE' })
          .then(function () { backToGrid(); })
          .catch(function () { setStatus('Could not unsubscribe.'); });
      }, { signal: signal });
      row.appendChild(unsubBtn);

      // The secretMissing recovery lane (a restored backup lost the tokened
      // URL): inline re-entry, wired to the same-feed-only route.
      if (currentShow.secretMissing) {
        var reenter = document.createElement('div');
        reenter.className = 'podcast-reenter-row';
        var input = document.createElement('input');
        input.type = 'url';
        input.className = 'search-input';
        input.placeholder = 'Paste this feed’s URL again (with its token)';
        reenter.appendChild(input);
        var saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'btn btn-sm btn-primary';
        saveBtn.textContent = 'Save feed URL';
        saveBtn.addEventListener('click', function () {
          fetchJson('/api/podcasts/subscriptions/' + encodeURIComponent(currentShow.id) + '/feed-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feedUrl: input.value.trim() }),
          }).then(function () {
            setStatus('Feed URL saved - checking the feed…');
            startStatusPolling();
            openShow(currentShow);
          }).catch(function (err) {
            setStatus(err.message || 'Could not save the feed URL.');
          });
        }, { signal: signal });
        reenter.appendChild(saveBtn);
        row.appendChild(reenter);
      }
      return row;
    }

    function buildEpisodeRow(ep) {
      var row = document.createElement('div');
      row.className = 'podcast-episode-row';
      row.setAttribute('data-episode-id', ep.id);
      if (ep.played) row.classList.add('played');

      var main = document.createElement('button');
      main.type = 'button';
      main.className = 'podcast-episode-main';
      main.disabled = ep.status !== 'downloaded';
      var title = document.createElement('div');
      title.className = 'podcast-episode-title';
      title.textContent = ep.title || 'Untitled episode';
      main.appendChild(title);
      var meta = document.createElement('div');
      meta.className = 'podcast-episode-meta';
      meta.textContent = formatEpisodeMeta(ep);
      main.appendChild(meta);
      var chipLabel = episodeChipLabel(ep);
      if (chipLabel) {
        var chip = document.createElement('span');
        chip.className = 'podcast-episode-chip' + (ep.status === 'failed' ? ' failed' : '');
        chip.textContent = chipLabel;
        main.appendChild(chip);
      }
      var frac = resumeFraction(ep);
      if (frac !== null) {
        var bar = document.createElement('div');
        bar.className = 'podcast-episode-resume';
        var fill = document.createElement('div');
        fill.className = 'podcast-episode-resume-fill';
        fill.style.width = (frac * 100).toFixed(1) + '%'; /* token-exempt: positional geometry (progress fraction) */
        bar.appendChild(fill);
        main.appendChild(bar);
      }
      if (ep.watchHref) {
        // A ytdlp-sourced episode is a media item: it plays on its watch
        // page (watch-history state, chapters, everything) - navigate.
        main.addEventListener('click', function () {
          window.location.href = ep.watchHref;
        }, { signal: signal });
      } else if (ep.status === 'downloaded') {
        main.addEventListener('click', function () {
          var i = playable.indexOf(ep);
          if (i !== -1) playAt(i);
        }, { signal: signal });
      }
      row.appendChild(main);

      // v1.71 T4: the like heart (RSS episodes; the podcast arm of the
      // music-liked pattern). v1.75: this is the WRITE surface and the only
      // one - the Liked lane it used to also feed is gone; see the handler
      // below.
      if (!ep.watchHref && ep.status === 'downloaded') {
        var likeBtn = document.createElement('button');
        likeBtn.type = 'button';
        likeBtn.className = 'podcast-like-toggle' + (ep.liked ? ' liked' : '');
        likeBtn.title = ep.liked ? 'Unlike' : 'Like';
        likeBtn.setAttribute('aria-pressed', ep.liked ? 'true' : 'false');
        var likeIcon = rowGlyphEl('heart');
        if (likeIcon) likeBtn.appendChild(likeIcon);
        likeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var next = !ep.liked;
          fetchJson('/api/podcasts/episodes/' + encodeURIComponent(ep.id) + '/liked', { method: next ? 'POST' : 'DELETE' })
            .then(function () {
              // v1.75: the heart is the WRITE surface and stays; the central
              // Liked playlist (/?liked=1) is the only place that READS it, so
              // there is no local lane left to re-render or re-count.
              ep.liked = next;
              likeBtn.classList.toggle('liked', next);
              likeBtn.title = next ? 'Unlike' : 'Like';
              likeBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
            })
            .catch(function () { setStatus('Could not update the like.'); });
        }, { signal: signal });
        row.appendChild(likeBtn);
      }

      // v1.71 T6: add-to-queue through the ONE shared verb (toast + Undo),
      // kind 'podcast' so the entry resolves against the episodes map.
      // v1.71.1 (Dean's device find): glyph, not text - three text buttons
      // truncated the episode title. Same icon vocabulary as the card
      // corner controls (icon-queue/download/delete).
      if (!ep.watchHref && ep.status === 'downloaded') {
        var queueBtn = document.createElement('button');
        queueBtn.type = 'button';
        queueBtn.className = 'podcast-ep-action';
        queueBtn.title = 'Add to queue';
        queueBtn.setAttribute('aria-label', 'Add to queue');
        var queueIcon = rowGlyphEl('queue');
        if (queueIcon) queueBtn.appendChild(queueIcon);
        queueBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (typeof window.addToQueue === 'function') window.addToQueue(ep.id, 'end', 'podcast');
        }, { signal: signal });
        row.appendChild(queueBtn);
      }

      // v1.71: save-to-device (RSS episodes only - a ytdlp episode is a
      // media item and keeps its watch-page download affordance). An <a
      // download> pointed at the confined stream route's ?download=1 arm.
      if (!ep.watchHref && ep.status === 'downloaded') {
        var saveLink = document.createElement('a');
        saveLink.className = 'podcast-ep-action';
        saveLink.href = '/episode/' + encodeURIComponent(ep.id) + '?download=1';
        saveLink.setAttribute('download', '');
        saveLink.title = 'Save to device';
        saveLink.setAttribute('aria-label', 'Save to device');
        var saveIcon = rowGlyphEl('download');
        if (saveIcon) saveLink.appendChild(saveIcon);
        saveLink.addEventListener('click', function (e) { e.stopPropagation(); }, { signal: signal });
        row.appendChild(saveLink);
      }

      // v1.70: the recoverable delete (RSS episodes only). Downloaded rows
      // get a two-tap delete; trashed rows get Restore. Both refresh the
      // list from server state on success.
      if (!ep.watchHref && ep.status === 'downloaded') {
        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'podcast-ep-action podcast-ep-delete';
        delBtn.title = 'Move to trash';
        delBtn.setAttribute('aria-label', 'Move to trash');
        var delIcon = rowGlyphEl('delete');
        if (delIcon) delBtn.appendChild(delIcon);
        // The two-tap honesty survives the glyph swap: arming widens the
        // circle into a pill and reveals the copy (the card-delete REVEAL
        // styling only - unlike armCardDelete there is NO auto-disarm
        // timer and no single-armed invariant; an armed pill stays armed
        // until the row rebuilds, same as the v1.71.0 text version).
        var delConfirm = document.createElement('span');
        delConfirm.className = 'podcast-ep-confirm';
        delConfirm.textContent = 'Move to trash?';
        delBtn.appendChild(delConfirm);
        var delConfirming = false;
        delBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!delConfirming) {
            delConfirming = true;
            delBtn.classList.add('confirming');
            return;
          }
          fetchJson('/api/podcasts/episodes/' + encodeURIComponent(ep.id), { method: 'DELETE' })
            .then(function () { refreshCurrentView(); })
            .catch(function () { setStatus('Could not delete the episode.'); });
        }, { signal: signal });
        row.appendChild(delBtn);
      }
      if (!ep.watchHref && ep.status === 'trashed') {
        var restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'btn btn-sm';
        restoreBtn.textContent = 'Restore';
        restoreBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          fetchJson('/api/podcasts/episodes/' + encodeURIComponent(ep.id) + '/restore', { method: 'POST' })
            .then(function () { refreshCurrentView(); })
            .catch(function (err) { setStatus(err.message || 'Could not restore the episode.'); });
        }, { signal: signal });
        row.appendChild(restoreBtn);
      }

      // The played toggle writes the podcast latch - external (media-item)
      // episodes get their played state from watch history instead, shown
      // read-only (no toggle).
      if (!ep.watchHref) {
        var playedBtn = document.createElement('button');
        playedBtn.type = 'button';
        playedBtn.className = 'podcast-played-toggle';
        playedBtn.title = ep.played ? 'Mark unplayed' : 'Mark played';
        playedBtn.setAttribute('aria-pressed', ep.played ? 'true' : 'false');
        playedBtn.textContent = '✓';
        playedBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          togglePlayed(ep, row, playedBtn);
        }, { signal: signal });
        row.appendChild(playedBtn);
      }
      return row;
    }

    function togglePlayed(ep, row, btn) {
      var next = !ep.played;
      fetchJson('/api/podcasts/episodes/' + encodeURIComponent(ep.id) + '/played', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ played: next }),
      }).then(function () {
        ep.played = next;
        row.classList.toggle('played', next);
        btn.title = next ? 'Mark unplayed' : 'Mark played';
        btn.setAttribute('aria-pressed', next ? 'true' : 'false');
      }).catch(function () { setStatus('Could not update played state.'); });
    }

    function applyPlayingHighlight() {
      if (!content) return;
      content.querySelectorAll('.podcast-episode-row.playing').forEach(function (el) {
        el.classList.remove('playing');
      });
      if (!playingId) return;
      var row = content.querySelector('.podcast-episode-row[data-episode-id="' + playingId + '"]');
      if (row) row.classList.add('playing');
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

    // ---- the add sheet ----
    function openSheet() {
      if (!sheet) return;
      if (sheetError) { sheetError.hidden = true; sheetError.textContent = ''; }
      if (sheetUrl) sheetUrl.value = '';
      if (sheetBackfill) sheetBackfill.value = 'all';
      sheet.hidden = false;
      if (sheetBackdrop) sheetBackdrop.hidden = false;
      if (sheetUrl) sheetUrl.focus();
    }
    function closeSheet() {
      if (sheet) sheet.hidden = true;
      if (sheetBackdrop) sheetBackdrop.hidden = true;
    }
    function submitSheet() {
      var url = sheetUrl ? sheetUrl.value.trim() : '';
      var backfill = sheetBackfill ? sheetBackfill.value : 'all';
      if (sheetError) { sheetError.hidden = true; sheetError.textContent = ''; }
      if (sheetSubmit) sheetSubmit.disabled = true;
      fetchJson('/api/podcasts/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedUrl: url, backfill: backfill }),
      }).then(function () {
        closeSheet();
        setStatus('Subscribed - checking the feed…');
        startStatusPolling();
        loadShows();
      }).catch(function (err) {
        if (sheetError) { sheetError.textContent = err.message || 'Could not subscribe.'; sheetError.hidden = false; }
      }).finally(function () {
        if (sheetSubmit) sheetSubmit.disabled = false;
      });
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
      // episodes) AND not already populated. Guarding on an existing .podcast-grid
      // stops a status-poll refresh (refreshCurrentView after a subscribe/like/
      // check-feeds) from flashing loaded content back to shimmer (gate
      // SUGGESTION: a reveal-once violation). renderShows' content.textContent=''
      // is the reveal; the catch clears it.
      if (!currentShow && content && !content.querySelector('.podcast-grid')) {
        content.innerHTML = buildPodcastSkeletonCards(8);
      }
      fetchJson('/api/podcasts/shows').then(function (data) {
        if (signal.aborted) return;
        shows = data.shows || [];
        if (!currentShow) renderShows();
      }).catch(function () {
        if (signal.aborted) return;
        if (!currentShow && content) content.innerHTML = ''; // never strand the shimmer
        setStatus('Could not load podcasts.');
        if (emptyNote) emptyNote.hidden = false;
      });
    }

    // ---- the settings sheet (v1.69 QA gate #2) ----
    var settingsBtn = root.querySelector('#podcasts-settings-btn');
    var settingsSheet = root.querySelector('#podcasts-settings-sheet');
    var settingsBackdrop = root.querySelector('#podcasts-settings-backdrop');
    var settingsPoll = root.querySelector('#podcasts-settings-poll');
    var settingsDir = root.querySelector('#podcasts-settings-dir');
    var settingsSave = root.querySelector('#podcasts-settings-save');
    var settingsCancel = root.querySelector('#podcasts-settings-cancel');
    var settingsError = root.querySelector('#podcasts-settings-error');

    function closeSettings() {
      if (settingsSheet) settingsSheet.hidden = true;
      if (settingsBackdrop) settingsBackdrop.hidden = true;
    }
    function openSettings() {
      if (!settingsSheet) return;
      if (settingsError) { settingsError.hidden = true; settingsError.textContent = ''; }
      fetchJson('/api/podcasts/settings').then(function (s) {
        if (settingsPoll) {
          var v = String(s.pollMinutes);
          // An interval outside the preset list still displays honestly.
          if (![...settingsPoll.options].some(function (o) { return o.value === v; })) {
            var opt = document.createElement('option');
            opt.value = v;
            opt.textContent = s.pollMinutes + ' minutes';
            settingsPoll.appendChild(opt);
          }
          settingsPoll.value = v;
        }
        if (settingsDir) settingsDir.textContent = s.downloadDir + ' (set FILETUBE_PODCASTS_DIR to change)';
        settingsSheet.hidden = false;
        if (settingsBackdrop) settingsBackdrop.hidden = false;
      }).catch(function () { setStatus('Could not load podcast settings.'); });
    }
    function saveSettings() {
      fetchJson('/api/podcasts/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pollMinutes: Number(settingsPoll ? settingsPoll.value : 60) }),
      }).then(function () {
        closeSettings();
      }).catch(function (err) {
        if (settingsError) { settingsError.textContent = err.message || 'Could not save.'; settingsError.hidden = false; }
      });
    }
    if (settingsBtn) settingsBtn.addEventListener('click', openSettings, { signal: signal });
    if (settingsCancel) settingsCancel.addEventListener('click', closeSettings, { signal: signal });
    if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettings, { signal: signal });
    if (settingsSave) settingsSave.addEventListener('click', saveSettings, { signal: signal });

    if (addBtn) addBtn.addEventListener('click', openSheet, { signal: signal });
    if (sheetCancel) sheetCancel.addEventListener('click', closeSheet, { signal: signal });
    if (sheetBackdrop) sheetBackdrop.addEventListener('click', closeSheet, { signal: signal });
    if (sheetSubmit) sheetSubmit.addEventListener('click', submitSheet, { signal: signal });
    if (sheetUrl) {
      sheetUrl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitSheet();
      }, { signal: signal });
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
      fetchJson('/api/podcasts/episodes/' + encodeURIComponent(epId))
        .then(function (ep) {
          if (signal.aborted || !ep || !ep.subId) return;
          var show = null;
          for (var k = 0; k < shows.length; k++) { if (shows[k].id === ep.subId) { show = shows[k]; break; } }
          if (!show) show = { id: ep.subId, name: ep.showName || 'Podcast' };
          currentShow = show;
          // v1.157 (P3): reserve the show view before the episodes fetch (same
          // as openShow) so a ?play= deep link does not flash empty.
          if (content) content.innerHTML = buildPodcastShowSkeleton(6);
          return fetchJson('/api/podcasts/shows/' + encodeURIComponent(show.id) + '/episodes')
            .then(function (data) {
              if (signal.aborted) return;
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
    // openShow's catch, which paints "Could not load episodes." over the
    // grid (deliberately LOUDER than ?play='s silent degrade: a dead pin
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
    // v1.246: tear the skin down FIRST - unbinds its panel listeners AND clears body.mms-on so
    // a swap to another view never leaves the full-screen cover (frozen scroll) behind (v1.227).
    if (activeSkinEngine) { try { activeSkinEngine.destroy(); } catch (_) { /* ignore */ } activeSkinEngine = null; }
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

  // v1.98 shimmer sweep: a `.podcast-grid` of n `.podcast-card`-shaped shimmer
  // cards, seeded into #podcasts-content before the shows fetch. Reuses the REAL
  // `.podcast-card-art` (aspect 1) as the shimmer box, so the reveal is
  // zero-shift. Pure -> node:test-covered.
  function buildPodcastSkeletonCards(n) {
    var count = Number.isInteger(n) && n > 0 ? n : 0;
    if (count === 0) return '';
    var cards = '';
    for (var i = 0; i < count; i++) {
      cards += '' +
        '<div class="podcast-card" aria-hidden="true">' +
        '<span class="podcast-card-art skeleton-shimmer"></span>' +
        '<div class="skeleton-line skeleton-line-title skeleton-shimmer"></div>' +
        '<div class="skeleton-line skeleton-line-meta skeleton-shimmer"></div>' +
        '</div>';
    }
    return '<div class="podcast-grid">' + cards + '</div>';
  }

  // v1.157 (P3, crispness): a header-over-episode-rows shimmer for the opened /
  // pinned SHOW view, seeded into #podcasts-content before the episodes fetch so
  // the show does not paint empty then pop in (the GRID already seeds its own
  // via buildPodcastSkeletonCards). A `.podcast-show-art` box + title over N
  // episode-row lines; existing skeleton primitives + inline spacing, no new
  // CSS. Pure -> node:test-covered.
  function buildPodcastShowSkeleton(n) {
    var count = Number.isInteger(n) && n > 0 ? n : 0;
    var rows = '';
    for (var i = 0; i < count; i++) {
      rows += '<div aria-hidden="true" style="margin-top:16px;">' +
        '<div class="skeleton-line skeleton-line-title skeleton-shimmer"></div>' +
        '<div class="skeleton-line skeleton-line-meta skeleton-shimmer" style="margin-top:6px; max-width:45%;"></div>' +
        '</div>';
    }
    return '<div aria-hidden="true" style="display:flex; gap:16px; align-items:center; margin-bottom:8px;">' +
      '<span class="podcast-show-art skeleton-shimmer" style="flex:none;"></span>' +
      '<div class="skeleton-line skeleton-line-title skeleton-shimmer" style="max-width:60%;"></div>' +
      '</div>' + rows;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      formatEpisodeDuration: formatEpisodeDuration,
      formatEpisodeMeta: formatEpisodeMeta,
      episodeChipLabel: episodeChipLabel,
      resumeFraction: resumeFraction,
      showCountLine: showCountLine,
      buildPodcastSkeletonCards: buildPodcastSkeletonCards,
      buildPodcastShowSkeleton: buildPodcastShowSkeleton,
    };
  }
})();
