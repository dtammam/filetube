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

// A show-detail document: the hero name + a section per season, each an episode list.
function buildShowDetailHtml(detail) {
  var out = '<div class="tv-detail">';
  out += '<h3 class="tv-detail-title">' + escapeTvHtml(detail.name || 'Show') + '</h3>';
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
      setCrumb('');
      var heading = el('tv-heading'); if (heading) heading.textContent = 'Shows';
      api('/api/tv').then(function (data) {
        var shows = (data && data.shows) || [];
        var content = el('tv-content');
        if (!content) return;
        showEmpty(shows.length === 0);
        content.innerHTML = shows.length
          ? '<div class="show-grid">' + shows.map(buildShowCardHtml).join('') + '</div>'
          : '';
      }).catch(function (e) { if (e.name !== 'AbortError') setStatus('Could not load shows.'); });
    }

    function openShow(showId) {
      api('/api/tv/' + encodeURIComponent(showId)).then(function (detail) {
        var content = el('tv-content');
        if (!content) return;
        showEmpty(false);
        setCrumb('<button type="button" class="tv-back" id="tv-back">← All shows</button>');
        var heading = el('tv-heading'); if (heading) heading.textContent = detail.name || 'Shows';
        content.innerHTML = buildShowDetailHtml(detail);
      }).catch(function (e) { if (e.name !== 'AbortError') setStatus('Could not load that show.'); });
    }

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
      var card = e.target.closest && e.target.closest('.show-card');
      if (card && card.getAttribute('data-show-id')) { openShow(card.getAttribute('data-show-id')); return; }
      var row = e.target.closest && e.target.closest('.tv-episode-row');
      if (row && row.getAttribute('data-episode-id')) { openEpisode(row.getAttribute('data-episode-id')); return; }
      if (e.target.closest && e.target.closest('#tv-back')) { renderGrid(); return; }
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
      window.FileTube.registerView('tv', { init: init, destroy: destroy });
    }
  })();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeTvHtml, pad2, episodeCode, formatEpDuration,
    buildShowCardHtml, buildEpisodeRowHtml, buildShowDetailHtml,
  };
}
