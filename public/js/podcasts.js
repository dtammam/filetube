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
    var statusPollTimer = null;
    var likedCount = 0; // gates the Liked lane card (the count-gated rule)
    // The Liked lane's pseudo-show: cross-show liked episodes. __likedLane
    // routes refreshes to openLiked and strips the show-only chrome.
    var LIKED_LANE = { id: '__liked__', name: 'Liked', source: 'liked', __likedLane: true };

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
      // v1.71: the Liked lane rides first, count-gated like the sidebar
      // Liked entry - zero likes, no card.
      if (likedCount > 0) grid.appendChild(buildLikedCard());
      shows.forEach(function (show) {
        grid.appendChild(buildShowCard(show));
      });
      content.appendChild(grid);
    }

    function buildLikedCard() {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'podcast-card podcast-liked-card';
      var art = document.createElement('div');
      art.className = 'podcast-card-art podcast-liked-card-art';
      var heart = document.createElement('i');
      heart.className = 'icon-heart';
      art.appendChild(heart);
      card.appendChild(art);
      var title = document.createElement('div');
      title.className = 'podcast-card-title';
      title.textContent = 'Liked';
      card.appendChild(title);
      var line = document.createElement('div');
      line.className = 'podcast-card-sub';
      line.textContent = likedCount === 1 ? '1 episode' : (likedCount + ' episodes');
      card.appendChild(line);
      card.addEventListener('click', openLiked, { signal: signal });
      return card;
    }

    function openLiked() {
      currentShow = LIKED_LANE;
      fetchJson('/api/podcasts/episodes?filter=liked&limit=100')
        .then(function (data) {
          if (signal.aborted) return;
          episodes = data.episodes || [];
          renderEpisodes();
        })
        .catch(function () { setStatus('Could not load liked episodes.'); });
    }

    // Refresh whatever list is on screen from server state (delete/restore/
    // like handlers) - the Liked lane is not a real show, so openShow can
    // never be the blanket answer.
    function refreshCurrentView() {
      if (!currentShow) { loadShows(); return; }
      if (currentShow.__likedLane) openLiked();
      else openShow(currentShow);
    }

    function buildShowCard(show) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'podcast-card';
      var art = document.createElement('img');
      art.className = 'podcast-card-art';
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
      card.addEventListener('click', function () { openShow(show); }, { signal: signal });
      return card;
    }

    // ---- the episode list ----
    function openShow(show) {
      currentShow = show;
      fetchJson('/api/podcasts/shows/' + encodeURIComponent(show.id) + '/episodes')
        .then(function (data) {
          if (signal.aborted) return;
          currentShow = data.show || show;
          episodes = data.episodes || [];
          renderEpisodes();
        })
        .catch(function () { setStatus('Could not load episodes.'); });
    }

    function backToGrid() {
      currentShow = null;
      episodes = [];
      loadShows();
    }

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
        back.addEventListener('click', backToGrid, { signal: signal });
        crumb.appendChild(back);
        var name = document.createElement('span');
        name.className = 'podcast-crumb-name';
        name.textContent = currentShow ? currentShow.name : '';
        crumb.appendChild(name);
      }

      var head = document.createElement('div');
      head.className = 'podcast-show-head';
      if (!currentShow.__likedLane) {
        var art = document.createElement('img');
        art.className = 'podcast-show-art';
        art.alt = '';
        art.src = currentShow.artUrl || ('/podcastart/' + encodeURIComponent(currentShow.id));
        head.appendChild(art);
      }
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
      if (!currentShow.__likedLane) {
        var counts = document.createElement('div');
        counts.className = 'podcast-card-sub';
        counts.textContent = showCountLine(currentShow) + (currentShow.lastStatus ? ' · ' + currentShow.lastStatus : '');
        meta.appendChild(counts);
      }
      // The management row (v1.69 QA gate #3): pause/resume + unsubscribe +
      // the secretMissing re-entry lane. RSS shows only - a ytdlp-sourced
      // show is managed on its own /subscriptions page, and the Liked lane
      // is not a subscription at all.
      if (currentShow.source !== 'ytdlp' && !currentShow.__likedLane) {
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
      // The Liked lane is cross-show: name the show in the meta line.
      meta.textContent = (currentShow && currentShow.__likedLane && ep.showName)
        ? (ep.showName + ' · ' + formatEpisodeMeta(ep))
        : formatEpisodeMeta(ep);
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
      // music-liked pattern). Toggles server state; unliking inside the
      // Liked lane drops the row on the refresh.
      if (!ep.watchHref && ep.status === 'downloaded') {
        var likeBtn = document.createElement('button');
        likeBtn.type = 'button';
        likeBtn.className = 'podcast-like-toggle' + (ep.liked ? ' liked' : '');
        likeBtn.title = ep.liked ? 'Unlike' : 'Like';
        likeBtn.setAttribute('aria-pressed', ep.liked ? 'true' : 'false');
        var likeIcon = document.createElement('i');
        likeIcon.className = 'icon-heart';
        likeBtn.appendChild(likeIcon);
        likeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var next = !ep.liked;
          fetchJson('/api/podcasts/episodes/' + encodeURIComponent(ep.id) + '/liked', { method: next ? 'POST' : 'DELETE' })
            .then(function () {
              ep.liked = next;
              likedCount += next ? 1 : -1;
              if (likedCount < 0) likedCount = 0;
              likeBtn.classList.toggle('liked', next);
              likeBtn.title = next ? 'Unlike' : 'Like';
              likeBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
              if (currentShow && currentShow.__likedLane && !next) refreshCurrentView();
            })
            .catch(function () { setStatus('Could not update the like.'); });
        }, { signal: signal });
        row.appendChild(likeBtn);
      }

      // v1.71: save-to-device (RSS episodes only - a ytdlp episode is a
      // media item and keeps its watch-page download affordance). An <a
      // download> pointed at the confined stream route's ?download=1 arm.
      if (!ep.watchHref && ep.status === 'downloaded') {
        var saveLink = document.createElement('a');
        saveLink.className = 'btn btn-sm';
        saveLink.href = '/episode/' + encodeURIComponent(ep.id) + '?download=1';
        saveLink.setAttribute('download', '');
        saveLink.textContent = 'Save';
        saveLink.title = 'Save to device';
        saveLink.setAttribute('aria-label', 'Save to device');
        saveLink.addEventListener('click', function (e) { e.stopPropagation(); }, { signal: signal });
        row.appendChild(saveLink);
      }

      // v1.70: the recoverable delete (RSS episodes only). Downloaded rows
      // get a two-tap delete; trashed rows get Restore. Both refresh the
      // list from server state on success.
      if (!ep.watchHref && ep.status === 'downloaded') {
        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-sm podcast-ep-delete';
        delBtn.textContent = 'Delete';
        var delConfirming = false;
        delBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!delConfirming) {
            delConfirming = true;
            delBtn.classList.add('confirming');
            delBtn.textContent = 'Move to trash?';
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

    function playAt(i) {
      var ep = playable[i];
      if (!ep || !currentShow) return;
      // v1.71: derive show identity per-EPISODE where the payload carries it
      // (the Liked lane is cross-show; ep.subId/showName are authoritative
      // there). A plain show view falls back to currentShow as before.
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
        autoAdvanceViaTrackNav: true,
        readerHref: '/podcasts',
      };
      playingId = ep.id;
      applyPlayingHighlight();
      window.FileTube.player.load(ep.id, data, { dock: true });
      if (typeof window.FileTube.player.setTrackNav === 'function') {
        window.FileTube.player.setTrackNav({
          onPrev: i > 0 ? function () { playAt(i - 1); } : undefined,
          onNext: i < playable.length - 1 ? function () { playAt(i + 1); } : undefined,
        });
      }
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
      // The liked count gates the lane card; fetched alongside the shows and
      // NEVER allowed to fail the grid (a likes hiccup costs the card only).
      var likesFetch = fetchJson('/api/podcasts/liked')
        .then(function (d) { return Array.isArray(d.episodeIds) ? d.episodeIds.length : 0; })
        .catch(function () { return 0; });
      Promise.all([fetchJson('/api/podcasts/shows'), likesFetch]).then(function (results) {
        if (signal.aborted) return;
        shows = results[0].shows || [];
        likedCount = results[1];
        if (!currentShow) renderShows();
      }).catch(function () {
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
          return fetchJson('/api/podcasts/shows/' + encodeURIComponent(show.id) + '/episodes')
            .then(function (data) {
              if (signal.aborted) return;
              currentShow = data.show || show;
              episodes = data.episodes || [];
              renderEpisodes();
              for (var i = 0; i < playable.length; i++) {
                if (playable[i].id === epId) { playAt(i); return; }
              }
            });
        })
        .catch(function () { /* the grid stands */ });
    }
    var playParam = null;
    try { playParam = new URLSearchParams(window.location.search).get('play'); } catch (_) { playParam = null; }
    if (playParam) consumeDeepLink(playParam);

    // Teardown extras the AbortController cannot cover.
    controller.__podcastsCleanup = function () {
      if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; }
    };
  }

  function destroy() {
    if (controller) {
      if (controller.__podcastsCleanup) controller.__podcastsCleanup();
      controller.abort();
    }
    controller = null;
  }

  if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('podcasts', { init: init, destroy: destroy });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      formatEpisodeDuration: formatEpisodeDuration,
      formatEpisodeMeta: formatEpisodeMeta,
      episodeChipLabel: episodeChipLabel,
      resumeFraction: resumeFraction,
      showCountLine: showCountLine,
    };
  }
})();
