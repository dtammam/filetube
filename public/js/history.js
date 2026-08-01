// FileTube History page (v1.64) -- registered VIEW MODULE, the music.js/
// books.js pattern: `init(root)` runs on a full page load AND an in-app swap
// into /history; every listener binds through ONE per-instance
// AbortController so `destroy()` removes them all. Renders GET /api/history
// (newest first, server-merged progress + watched) as removable list rows;
// per-row remove and Clear-all are two-tap confirms against the DELETE
// routes. Optimistic ops follow the v1.54 rule: optimistic HIDES, only the
// confirmed answer REMOVES.

// ---- Pure, DOM-free helpers (node:test-covered without a browser) ----------

function escapeHistoryHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Seconds -> m:ss (or h:mm:ss); empty for non-finite/zero (audio rows show
// nothing, same as the home cards' 'Audio' fallback handled by the caller).
function formatHistoryDuration(sec) {
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

// ISO stamp -> a relative "watched when" label. `nowMs` is injectable for
// deterministic tests (the near-today-date-literals lesson). Unknown/absent
// stamps (a legacy null updated_at row) -> '' -- the row renders without a
// time label rather than lying.
function formatHistoryWhen(iso, nowMs) {
  var t = Date.parse(iso || '');
  if (!isFinite(t)) return '';
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  var mins = Math.floor(Math.max(0, now - t) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins === 1 ? '1 minute ago' : mins + ' minutes ago';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : hours + ' hours ago';
  var days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return days + ' days ago';
  var weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? '1 week ago' : weeks + ' weeks ago';
  var months = Math.floor(days / 30);
  if (months < 12) return months <= 1 ? '1 month ago' : months + ' months ago';
  var years = Math.floor(days / 365);
  return years <= 1 ? '1 year ago' : years + ' years ago';
}

// Progress percent -> the bar's width value, or null when no bar should
// render (mirrors the home cards' >0.5% threshold so the two surfaces can
// never disagree about what "in progress" looks like). A 'watched' item
// shows no partial bar -- the Watched chip carries that state.
function historyBarPercent(item) {
  var pct = item && typeof item.progressPercent === 'number' && isFinite(item.progressPercent)
    ? item.progressPercent : 0;
  if (pct <= 0.5) return null;
  if (item && item.watchState === 'watched') return null;
  return Math.min(100, pct);
}

// One history list row. The bar's width lands via a CSS custom property set
// AFTER insertion (wireHistoryRowBars) -- the setProperty idiom
// (player.js --seek-fill), never an inline width literal (#71/ratchet).
function buildHistoryRowHtml(item, nowMs) {
  var id = escapeHistoryHtml(item.id);
  var title = escapeHistoryHtml(item.title || item.name || 'Untitled');
  var channel = escapeHistoryHtml(item.channelName || item.folderName || '');
  var watchHref = '/watch.html?v=' + encodeURIComponent(item.id || '');
  var durationStr = item.duration > 0 ? formatHistoryDuration(item.duration) : (item.type === 'audio' ? 'Audio' : '');
  var when = formatHistoryWhen(item.lastWatchedAt, nowMs);
  var barPct = historyBarPercent(item);
  var metaBits = [];
  if (channel) metaBits.push('<a class="history-channel" href="/?folder=' + encodeURIComponent(item.folderName || '') + '">' + channel + '</a>');
  if (when) metaBits.push('<span class="history-when">' + escapeHistoryHtml(when) + '</span>');
  return '' +
    '<div class="history-row" data-id="' + id + '">' +
    '<a href="' + escapeHistoryHtml(watchHref) + '" class="history-thumb">' +
    '<img class="history-thumb-img" src="/thumbnail/' + encodeURIComponent(item.id || '') + '" alt="" loading="lazy" />' +
    (durationStr ? '<span class="duration-badge">' + escapeHistoryHtml(durationStr) + '</span>' : '') +
    (barPct !== null ? '<span class="history-bar"><span class="history-bar-fill" data-pct="' + barPct + '"></span></span>' : '') +
    '</a>' +
    '<div class="history-info">' +
    '<a href="' + escapeHistoryHtml(watchHref) + '" class="history-title" title="' + title + '">' + title + '</a>' +
    '<div class="history-meta">' + metaBits.join(' &bull; ') +
    (item.watchState === 'watched' ? ' <span class="history-watched-chip">Watched</span>' : '') +
    '</div>' +
    '</div>' +
    '<button type="button" class="history-remove-btn" data-id="' + id + '" aria-label="Remove from history" title="Remove from history">' +
    '<i class="icon-delete"></i><span class="history-remove-confirm">Remove?</span>' +
    '</button>' +
    '</div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHistoryHtml, formatHistoryDuration, formatHistoryWhen, historyBarPercent, buildHistoryRowHtml,
  };
}

(function () {
  if (typeof window === 'undefined') return;
  var controller = null;

  var PAGE_LIMIT = 50;
  // Two-tap confirm window (matches the card-delete affordance's feel).
  var CONFIRM_MS = 3000;

  function init(root) {
    controller = new AbortController();
    var signal = controller.signal;

    var listEl = root.querySelector('#history-list');
    var emptyEl = root.querySelector('#history-empty');
    var moreBtn = root.querySelector('#history-loadmore');
    var clearBtn = root.querySelector('#history-clear-btn');
    if (!listEl) return;

    var offset = 0;
    var total = 0;
    var loading = false;

    // The bar widths land here, AFTER innerHTML insertion (see
    // buildHistoryRowHtml's comment).
    function wireHistoryRowBars(scope) {
      scope.querySelectorAll('.history-bar-fill[data-pct]').forEach(function (el) {
        el.style.setProperty('--history-pct', el.getAttribute('data-pct') + '%');
        el.removeAttribute('data-pct');
      });
    }

    function refreshChrome() {
      if (emptyEl) emptyEl.hidden = total > 0;
      if (moreBtn) moreBtn.hidden = !(listEl.children.length < total);
      if (clearBtn) clearBtn.hidden = total === 0;
    }

    function fetchPage(pageOffset, replace) {
      if (loading) return Promise.resolve();
      loading = true;
      return fetch('/api/history?limit=' + PAGE_LIMIT + '&offset=' + pageOffset)
        .then(function (r) { if (!r.ok) throw new Error('history fetch failed: ' + r.status); return r.json(); })
        .then(function (body) {
          if (signal.aborted) return; // dead-view guard (v1.41.11)
          total = Number(body.total) || 0;
          offset = pageOffset + body.items.length;
          var html = body.items.map(function (item) { return buildHistoryRowHtml(item); }).join('');
          if (replace) listEl.innerHTML = html;
          else listEl.insertAdjacentHTML('beforeend', html);
          wireHistoryRowBars(listEl);
          refreshChrome();
        })
        .catch(function (err) {
          if (!signal.aborted) console.error('History: fetch failed', err);
        })
        .then(function () { loading = false; });
    }

    // After a removal empties the loaded window while more rows exist
    // server-side, re-pull from the top (offsets have shifted under us).
    function refill() {
      if (listEl.children.length === 0 && total > 0) return fetchPage(0, true);
      refreshChrome();
      return Promise.resolve();
    }

    // Two-tap arm state: at most one armed control at a time.
    var armed = null; // { el, timer }
    function disarm() {
      if (!armed) return;
      clearTimeout(armed.timer);
      armed.el.classList.remove('history-confirming');
      armed = null;
    }
    function arm(el) {
      disarm();
      el.classList.add('history-confirming');
      armed = { el: el, timer: setTimeout(disarm, CONFIRM_MS) };
    }

    function removeRow(row, btn) {
      disarm();
      var id = btn.getAttribute('data-id');
      // QA gate W1: a falsy id would build '/api/history/' -- which Express's
      // non-strict routing aliases onto CLEAR-ALL (the server now 400s that
      // form too; this is the belt to its suspenders).
      if (!id) return;
      row.hidden = true; // optimistic HIDE
      fetch('/api/history/' + encodeURIComponent(id), { method: 'DELETE' })
        .then(function (r) {
          if (signal.aborted) return;
          if (!r.ok) throw new Error('remove failed: ' + r.status);
          row.remove(); // confirmed answer REMOVES
          total = Math.max(0, total - 1);
          offset = Math.max(0, offset - 1);
          return refill();
        })
        .catch(function (err) {
          if (signal.aborted) return;
          row.hidden = false; // roll the optimistic hide back
          console.error('History: remove failed', err);
        });
    }

    function clearAll() {
      disarm();
      listEl.hidden = true; // optimistic HIDE
      fetch('/api/history', { method: 'DELETE' })
        .then(function (r) {
          if (signal.aborted) return;
          if (!r.ok) throw new Error('clear failed: ' + r.status);
          listEl.innerHTML = '';
          listEl.hidden = false;
          total = 0;
          offset = 0;
          refreshChrome();
        })
        .catch(function (err) {
          if (signal.aborted) return;
          listEl.hidden = false;
          console.error('History: clear failed', err);
        });
    }

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.history-remove-btn');
      if (!btn) return;
      e.preventDefault();
      var row = btn.closest('.history-row');
      if (!row) return;
      if (armed && armed.el === btn) removeRow(row, btn);
      else arm(btn);
    }, { signal: signal });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (armed && armed.el === clearBtn) clearAll();
        else arm(clearBtn);
      }, { signal: signal });
    }

    if (moreBtn) {
      moreBtn.addEventListener('click', function () { fetchPage(offset, false); }, { signal: signal });
    }

    fetchPage(0, true);
  }

  function destroy() {
    if (controller) controller.abort();
    controller = null;
  }

  if (window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('history', { init, destroy });
  }
})();
