'use strict';

// v1.195 TV Shows ("Shows") client view. Poster grid -> show detail (season
// sections + episode list) -> inline episode playback. The pure builders are
// node-testable (exported below); the DOM wiring self-registers as the 'tv' view.

function escapeTvHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pad2(n) { return (n != null && n < 10 ? '0' : '') + n; }

// v1.198.2 (Dean): the Settings toggle for the Shows-page Continue row -
// homeRowEnabled's exact semantics (absent/anything-but-'0' = on; '0' = off;
// storage-disabled = on). Pure + exported for node:test.
function tvContinueRowEnabled() {
  try {
    var v = localStorage.getItem('ft-tv-continue-watching');
    return v === null ? true : v !== '0';
  } catch (_) {
    return true;
  }
}

// "S02E22" from an episode; degrades gracefully when a number is missing (an
// Extras/unsorted episode shows no code).
function episodeCode(ep) {
  if (ep == null || ep.seasonNum == null || ep.episodeNum == null) return '';
  return 'S' + pad2(ep.seasonNum) + 'E' + pad2(ep.episodeNum);
}

function formatEpDuration(sec) {
  var s = Math.max(0, Math.floor(Number(sec) || 0));
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (h > 0) return h + ':' + pad2(m) + ':' + pad2(ss);
  return m + ':' + pad2(ss);
}

// A 2:3 poster card for the grid.
function buildShowCardHtml(show) {
  var poster = '/tvposter/' + encodeURIComponent(show.id || '');
  var seasons = show.seasonCount ? show.seasonCount + (show.seasonCount === 1 ? ' season' : ' seasons') : '';
  var eps = show.episodeCount ? show.episodeCount + (show.episodeCount === 1 ? ' episode' : ' episodes') : '';
  var meta = [seasons, eps].filter(Boolean).join(' · ');
  return '' +
    '<button type="button" class="show-card" data-show-id="' + escapeTvHtml(show.id) + '">' +
    '<img class="show-poster art-shimmer" src="' + escapeTvHtml(poster) + '" alt="' + escapeTvHtml(show.name) + '" loading="lazy" />' +
    '<span class="show-card-title" title="' + escapeTvHtml(show.name) + '">' + escapeTvHtml(show.name || 'Untitled show') + '</span>' +
    '<span class="show-card-meta">' + escapeTvHtml(meta) + '</span>' +
    '</button>';
}

// A Continue-Watching card: the show poster, a resume bar, the show name + the
// SxxEyy · title of the in-progress episode. Opens straight into that episode.
function buildContinueCardHtml(ep) {
  var poster = '/tvposter/' + encodeURIComponent(ep.showId || '');
  var dur = Number(ep.durationSec) || 0;
  var pct = dur > 0 ? Math.max(0, Math.min(100, Math.round((Number(ep.position) || 0) / dur * 100))) : 0;
  var label = [episodeCode(ep), ep.title].filter(Boolean).join(' ');
  return '' +
    '<button type="button" class="tv-continue-card" data-episode-id="' + escapeTvHtml(ep.id) + '">' +
    '<span class="tv-continue-poster-wrap">' +
    '<img class="tv-continue-poster art-shimmer" src="' + escapeTvHtml(poster) + '" alt="' + escapeTvHtml(ep.showName) + '" loading="lazy" />' +
    '<span class="tv-continue-bar"><span class="tv-continue-fill" style="width: ' + pct + '%"></span></span>' +
    '</span>' +
    '<span class="tv-continue-show" title="' + escapeTvHtml(ep.showName) + '">' + escapeTvHtml(ep.showName || '') + '</span>' +
    '<span class="tv-continue-ep" title="' + escapeTvHtml(label) + '">' + escapeTvHtml(label || 'Episode') + '</span>' +
    '</button>';
}

// One episode row: SxxExx code + title + duration.
function buildEpisodeRowHtml(ep) {
  var code = episodeCode(ep);
  var title = ep.title || (ep.episodeNum != null ? 'Episode ' + ep.episodeNum : 'Untitled');
  return '' +
    '<button type="button" class="tv-episode-row" data-episode-id="' + escapeTvHtml(ep.id) + '">' +
    (code ? '<span class="tv-episode-code">' + escapeTvHtml(code) + '</span>' : '') +
    '<span class="tv-episode-title" title="' + escapeTvHtml(title) + '">' + escapeTvHtml(title) + '</span>' +
    '<span class="tv-episode-dur">' + escapeTvHtml(ep.durationSec ? formatEpDuration(ep.durationSec) : '') + '</span>' +
    '</button>';
}

// A show-detail document: a hero (poster + name), then a section per season, each
// an episode list. (v1.198: the admin poster-control slot is gone with the
// removed upload feature; the hero itself stays.)
function buildShowDetailHtml(detail) {
  var out = '<div class="tv-detail">';
  out += '<div class="tv-detail-hero">' +
    '<img class="tv-detail-poster art-shimmer" src="/tvposter/' + encodeURIComponent(detail.id || '') + '" alt="' + escapeTvHtml(detail.name) + '" />' +
    '<div class="tv-detail-hero-main">' +
    '<h3 class="tv-detail-title">' + escapeTvHtml(detail.name || 'Show') + '</h3>' +
    '</div></div>';
  var seasons = Array.isArray(detail.seasons) ? detail.seasons : [];
  // O3: a single implicit season (label "Episodes") hides its header.
  var hideHeader = seasons.length === 1 && seasons[0] && seasons[0].seasonNum == null;
  for (var i = 0; i < seasons.length; i++) {
    var s = seasons[i];
    out += '<section class="tv-season">';
    if (!hideHeader) out += '<h4 class="tv-season-label">' + escapeTvHtml(s.label) + '</h4>';
    out += '<div class="tv-episode-list">';
    var eps = Array.isArray(s.episodes) ? s.episodes : [];
    for (var j = 0; j < eps.length; j++) out += buildEpisodeRowHtml(eps[j]);
    out += '</div></section>';
  }
  out += '</div>';
  return out;
}

// ---- DOM wiring -------------------------------------------------------------

if (typeof document !== 'undefined') {
  (function () {
    var controller = null;
    // v1.218 (in-view back-stack, media-nav arc): the open show id (null = the
    // grid). TV's view functions are IIFE-level and stable across mount, so this
    // + onShowPop can register directly (no live-handler indirection needed, unlike
    // music/podcasts whose drill state is init-closure-scoped). onEpisode already
    // NAVIGATES to /watch (a real history entry), so only the browse->show drill
    // needs a level here.
    var currentShowId = null;

    function el(id) { return document.getElementById(id); }
    function setStatus(msg) {
      var s = el('tv-status');
      if (!s) return;
      if (msg) { s.textContent = msg; s.hidden = false; } else { s.hidden = true; }
    }

    function showEmpty(on) { var e = el('tv-empty'); if (e) e.hidden = !on; }
    function setCrumb(html) { var c = el('tv-crumb'); if (!c) return; if (html) { c.innerHTML = html; c.hidden = false; } else { c.innerHTML = ''; c.hidden = true; } }

    function api(path) {
      return fetch(path, { signal: controller && controller.signal, headers: { Accept: 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
    }

    function renderGrid() {
      currentShowId = null; // v1.218: back at the grid level
      setCrumb('');
      var heading = el('tv-heading'); if (heading) heading.textContent = 'Shows';
      var content = el('tv-content');
      api('/api/tv').then(function (data) {
        var shows = (data && data.shows) || [];
        // v1.198.2 (Dean): the Settings "Show Continue watching on the Shows
        // page" toggle (ft-tv-continue-watching, the home-row semantics: absent
        // = on, '0' = off). OFF skips the /api/tv/continue fetch entirely - not
        // just the render - so a disabled row costs nothing.
        if (!tvContinueRowEnabled()) return { shows: shows, cont: [] };
        // Continue-Watching is best-effort: its failure NEVER hides the grid.
        return api('/api/tv/continue').then(
          function (c) { return { shows: shows, cont: (c && c.episodes) || [] }; },
          function () { return { shows: shows, cont: [] }; }
        );
      }).then(function (r) {
        if (!content) return;
        showEmpty(r.shows.length === 0 && r.cont.length === 0);
        var html = '';
        // REVEAL axis: a Continue row when there ARE in-progress episodes; CLEAR
        // axis: nothing rendered when the list is empty (the row is simply gone).
        if (r.cont.length) {
          html += '<section class="tv-continue-row"><h4 class="tv-continue-heading">Continue watching</h4>' +
            '<div class="tv-continue-strip">' + r.cont.map(buildContinueCardHtml).join('') + '</div></section>';
        }
        html += r.shows.length ? '<div class="show-grid">' + r.shows.map(buildShowCardHtml).join('') + '</div>' : '';
        content.innerHTML = html;
      }).catch(function (e) { if (e.name !== 'AbortError') setStatus('Could not load shows.'); });
    }

    // v1.218 in-view back-stack: a show descent stamps a history level so
    // OS/browser back steps back to the grid instead of leaving TV. INTERACTIVE
    // descents only (the card click); the ?show= init deep link opens via
    // openShow directly, no push.
    function pushTvShowLevel(showId) {
      var ft = window.FileTube;
      // Same-id check = a DEFENSIVE guard, not a live dedup: the only caller is
      // the grid card (present only while currentShowId is null), so the ids
      // always differ. Cheap future-proofing against a non-grid descent (gate
      // SUGGESTION: currently unreachable, kept as insurance).
      if (ft && typeof ft.pushViewState === 'function' && String(currentShowId || '') !== String(showId || '')) {
        ft.pushViewState({ t: 'show', id: showId });
      }
    }
    // The router hands this back for a within-TV pop (popStateDelegate gate; only
    // ever while TV is the mounted view): reconcile the open show to the popped
    // entry, in place. A show-level pop collapses to the grid; a forward re-pop
    // re-opens the show. Return true - a cross-view pop never reaches here.
    function onShowPop(state) {
      var vs = state && state.viewState;
      var targetId = (vs && vs.t === 'show' && vs.id) ? vs.id : null;
      if (String(currentShowId || '') !== String(targetId || '')) {
        if (targetId) openShow(targetId);
        else renderGrid();
      }
      return true;
    }

    function openShow(showId) {
      currentShowId = showId; // v1.218: track the open show for back reconciliation
      api('/api/tv/' + encodeURIComponent(showId)).then(function (detail) {
        var content = el('tv-content');
        if (!content) return;
        showEmpty(false);
        setCrumb('<button type="button" class="tv-back" id="tv-back">← All shows</button>');
        var heading = el('tv-heading'); if (heading) heading.textContent = detail.name || 'Shows';
        content.innerHTML = buildShowDetailHtml(detail);
      }).catch(function (e) { if (e.name !== 'AbortError') setStatus('Could not load that show.'); });
    }
    // v1.198 (Dean): the in-app "Change poster" control (and its whole upload
    // feature) is REMOVED - posters come from a folder image (poster.jpg etc.)
    // or the generated episode frame, the convention Dean actually uses.

    // v1.196: an episode opens the FULL watch page (the shared player - mini-player,
    // prev/next, autoplay, loop, resume, title) via ?tv=<id>, instead of a bespoke
    // inline <video>. The browse/selection UI here is unchanged; only the playback
    // leaf moved. Back from the watch page returns to this show via /tv?show=.
    function openEpisode(id) {
      if (window.FileTube && typeof window.FileTube.navigate === 'function') {
        window.FileTube.navigate('/watch.html?tv=' + encodeURIComponent(id));
      } else {
        window.location.href = '/watch.html?tv=' + encodeURIComponent(id);
      }
    }

    function onClick(e) {
      var cont = e.target.closest && e.target.closest('.tv-continue-card');
      if (cont && cont.getAttribute('data-episode-id')) { openEpisode(cont.getAttribute('data-episode-id')); return; }
      var card = e.target.closest && e.target.closest('.show-card');
      if (card && card.getAttribute('data-show-id')) {
        var sid = card.getAttribute('data-show-id');
        pushTvShowLevel(sid); // v1.218: a back level for the show descent
        openShow(sid);
        return;
      }
      var row = e.target.closest && e.target.closest('.tv-episode-row');
      if (row && row.getAttribute('data-episode-id')) { openEpisode(row.getAttribute('data-episode-id')); return; }
      if (e.target.closest && e.target.closest('#tv-back')) {
        // v1.218: consume the pushed show level via history.back() when one exists
        // (keeps OS-back in sync); else collapse directly (a ?show= deep-link show).
        var st = window.history.state;
        if (st && st.viewState && st.viewState.t === 'show' && window.FileTube && typeof window.FileTube.pushViewState === 'function') {
          window.history.back();
        } else {
          renderGrid();
        }
        return;
      }
    }

    function onScanClick() {
      setStatus('Scanning…');
      fetch('/api/tv/scan', { method: 'POST', signal: controller && controller.signal })
        .then(function () { setTimeout(function () { setStatus(''); renderGrid(); }, 1500); })
        .catch(function () { setStatus('Scan could not start.'); });
    }

    function init() {
      controller = new AbortController();
      var root = el('view-root');
      if (root) root.addEventListener('click', onClick);
      var scan = el('tv-scan-btn');
      if (scan) scan.addEventListener('click', onScanClick);
      // v1.196: /tv?show=<showId> deep-opens a show - the destination the watch
      // page's "← show" back link returns to, so Back from an episode lands on
      // the show detail, not the grid.
      var showId = null;
      try { showId = new URLSearchParams(window.location.search).get('show'); } catch (_) { showId = null; }
      if (showId) openShow(showId);
      else renderGrid();
    }

    function destroy() {
      if (controller) { controller.abort(); controller = null; }
      var root = el('view-root');
      if (root) root.removeEventListener('click', onClick);
      var scan = el('tv-scan-btn');
      if (scan) scan.removeEventListener('click', onScanClick);
    }

    if (window.FileTube && typeof window.FileTube.registerView === 'function') {
      window.FileTube.registerView('tv', {
        init: init,
        destroy: destroy,
        // v1.218 in-view back-stack: the router calls this only for a within-TV pop
        // (its popStateDelegate gate fires only while TV is the mounted view), so
        // onShowPop can register directly - its IIFE-level state is always valid here.
        onPopState: onShowPop,
      });
    }
  })();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeTvHtml, pad2, episodeCode, formatEpDuration,
    buildShowCardHtml, buildContinueCardHtml, buildEpisodeRowHtml, buildShowDetailHtml,
    tvContinueRowEnabled,
  };
}
