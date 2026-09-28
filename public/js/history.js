// FileTube History page (v1.64) -- registered VIEW MODULE, the music.js/
// books.js pattern: `init(root)` runs on a full page load AND an in-app swap
// into /history; every listener binds through ONE per-instance
// AbortController so `destroy()` removes them all. Renders GET /api/history
// (newest first, server-merged progress + watched) as ui-row list rows; per-row
// Remove and Clear all go through ui.confirm before their DELETE routes (UI pass
// sweep S2). Optimistic ops follow the v1.54 rule: optimistic HIDES, only the
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

// The ui builders: the page's window.ui, else (node:test) the sibling module.
function historyUi() {
  if (typeof window !== 'undefined' && window.ui) return window.ui;
  if (typeof module !== 'undefined' && module.require) {
    try { return module.require('./ui.js'); } catch (_) { return null; }
  }
  return null;
}

// The byline's channel label (v1.114 A2: strip a leading "@" so a handle-stored-
// as-the-name shows the name; v1.126: a nameless item takes the folder display
// map before the raw folderName - resolveChannelName's fallback order).
function historyChannelLabel(item) {
  var chName = typeof item.channelName === 'string' && item.channelName.charAt(0) === '@' ? item.channelName.slice(1) : item.channelName;
  if (!chName && typeof folderDisplayName === 'function') { var mapped = folderDisplayName(item.folderName); if (mapped) chName = mapped; }
  return chName || item.folderName || '';
}

// Pure: the row's meta line - "Channel · 2 days ago · Watched" (plain text: the
// whole row is the link, D4.3, so no second link can sit inside it).
function historyMetaText(item, nowMs) {
  var bits = [];
  var channel = historyChannelLabel(item);
  if (channel) bits.push(channel);
  var when = formatHistoryWhen(item.lastWatchedAt, nowMs);
  if (when) bits.push(when);
  if (item.watchState === 'watched') bits.push('Watched');
  return bits.join(' · ');
}

// One history row (UI pass sweep S2): a ui-row in the History ui-list - the
// ui-thumb (duration badge + resume bar) in the media slot, the title linking
// to the item, the meta line, and ONE reserved action slot holding the Remove
// button (a ui-btn plain icon). Built with textContent only. The resume bar's
// fraction is the ui-thumb's own --p data property.
function buildHistoryRowEl(item, nowMs, doc) {
  var u = historyUi();
  var d = doc || document;
  var watchHref = (typeof audioOpenHref === 'function' && audioOpenHref(item))
    || '/watch.html?v=' + encodeURIComponent(item.id || '');
  var pct = historyBarPercent(item);
  var thumb = u.thumb({ src: '/thumbnail/' + encodeURIComponent(item.id || ''), duration: item.duration,
    progress: pct === null ? 0 : pct / 100, context: 'row', doc: d });
  var img = thumb.querySelector('.ui-thumb__img');
  if (img) img.classList.add('art-shimmer');
  var remove = u.button({ variant: 'plain', shape: 'icon', size: 'sm', icon: 'close', ariaLabel: 'Remove from history', doc: d });
  remove.classList.add('history-remove');
  remove.setAttribute('data-id', String(item.id || ''));
  var row = u.row({ size: 'media', media: thumb, title: item.title || item.name || 'Untitled', meta: historyMetaText(item, nowMs),
    href: watchHref, actions: [remove], doc: d });
  row.setAttribute('data-id', String(item.id || ''));
  return row;
}

// v1.98 shimmer sweep, UI pass sweep S2 (D9): n skeleton rows of the FINAL row
// geometry - the same ui-row grid (thumb media slot, two lines, the reserved
// action slot), so the reveal is zero-shift. Every node aria-hidden.
function buildHistorySkeletonRows(n, doc) {
  var count = Number.isInteger(n) && n > 0 ? n : 0;
  var d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || count === 0) return '';
  var u = historyUi();
  var html = '';
  for (var i = 0; i < count; i++) {
    var thumb = u.thumb({ context: 'row', doc: d });
    thumb.classList.add('skeleton-shimmer');
    var title = d.createElement('span');
    title.className = 'skeleton-text skeleton-text-long skeleton-shimmer';
    title.textContent = ' ';
    var meta = d.createElement('span');
    meta.className = 'skeleton-text skeleton-text-mid skeleton-shimmer';
    meta.textContent = ' ';
    var row = u.row({ size: 'media', media: thumb, title: title, meta: meta, actions: [null], doc: d });
    row.setAttribute('aria-hidden', 'true');
    html += row.outerHTML;
  }
  return html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHistoryHtml, formatHistoryDuration, formatHistoryWhen, historyBarPercent,
    historyChannelLabel, historyMetaText, buildHistoryRowEl, buildHistorySkeletonRows,
  };
}

(function () {
  if (typeof window === 'undefined') return;
  var controller = null;

  var PAGE_LIMIT = 50;

  function init(root) {
    controller = new AbortController();
    var signal = controller.signal;

    // v1.126 (gate WARNING): seed the shell folder-display map so the row byline
    // resolves renamed folders on a COLD load too (in-app nav from home leaves
    // the shell cache already warm; a direct /history.html load does not). One
    // cheap read, non-blocking - a failure just leaves the raw folderName.
    fetch('/api/config', { signal }).then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
      if (cfg && typeof setFolderDisplayNames === 'function') setFolderDisplayNames(cfg.folderDisplayNames);
    }).catch(function () { /* signed-out / aborted -> raw folderName */ });

    var listEl = root.querySelector('#history-list');
    var emptyEl = root.querySelector('#history-empty');
    var moreBtn = root.querySelector('#history-loadmore');
    var clearBtn = root.querySelector('#history-clear-btn');
    if (!listEl) return;

    var offset = 0;
    var total = 0;
    var loading = false;

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
          var frag = document.createDocumentFragment();
          body.items.forEach(function (item) { frag.appendChild(buildHistoryRowEl(item)); });
          if (replace) listEl.replaceChildren(frag);
          else listEl.appendChild(frag);
          // v1.102 (tranche 4 shimmer): the thumbnails ship `art-shimmer`; the
          // shared decode-reveal clears each on decode (immediately for cached).
          if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.shimmerArt === 'function') {
            window.FileTube.shimmerArt(listEl);
          }
          refreshChrome();
        })
        .catch(function (err) {
          if (!signal.aborted) {
            console.error('History: fetch failed', err);
            // v1.98: never strand the seeded shimmer on a failed FIRST load -
            // D9: an error state with Retry, never "No watch history yet".
            if (replace) {
              listEl.replaceChildren(historyUi().state({ icon: 'warning', title: 'Could not load your history',
                body: 'Check your connection and try again.', action: { label: 'Retry', onClick: function () { fetchPage(0, true); } } }));
              if (emptyEl) emptyEl.hidden = true;
              if (moreBtn) moreBtn.hidden = true;
              if (clearBtn) clearBtn.hidden = true;
            }
          }
        })
        .then(function () { loading = false; });
    }

    // D9: the empty state is the ui-state block (icon, title, body).
    function renderEmpty() {
      if (!emptyEl) return;
      emptyEl.replaceChildren(historyUi().state({ icon: 'history', title: 'No watch history yet',
        body: 'Anything you watch or start shows up here.' }));
    }
    renderEmpty();

    // After a removal empties the loaded window while more rows exist
    // server-side, re-pull from the top (offsets have shifted under us).
    function refill() {
      if (listEl.children.length === 0 && total > 0) return fetchPage(0, true);
      refreshChrome();
      return Promise.resolve();
    }

    // UI pass sweep S2 (D4.8, F33): removing history clears the item's resume
    // position and watched mark (DELETE /api/history/:id), so it goes through
    // ui.confirm - the in-row "Remove?" two-tap arming is retired (confirms
    // never grow in place). The request is sent only when the confirm resolves true.
    function removeRow(row, id) {
      // QA gate W1: a falsy id would build '/api/history/' -- which Express's
      // non-strict routing aliases onto CLEAR-ALL (the server now 400s that
      // form too; this is the belt to its suspenders).
      if (!id) return;
      // `signal`: leaving the view dismisses the dialog (resolves false), so its OK cannot act later.
      historyUi().confirm({ title: 'Remove from history?', body: 'Its resume position and watched mark are cleared.',
        confirmLabel: 'Remove', danger: true, signal: signal }).then(function (ok) {
        if (ok !== true || signal.aborted) return;
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
      });
    }

    function clearAll() {
      historyUi().confirm({ title: 'Clear all watch history?', body: 'Every resume position and watched mark is cleared.',
        confirmLabel: 'Clear all', danger: true, signal: signal }).then(function (ok) {
        if (ok !== true || signal.aborted) return;
        listEl.hidden = true; // optimistic HIDE
        fetch('/api/history', { method: 'DELETE' })
          .then(function (r) {
            if (signal.aborted) return;
            if (!r.ok) throw new Error('clear failed: ' + r.status);
            listEl.replaceChildren();
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
      });
    }

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.history-remove');
      if (!btn) return;
      e.preventDefault();
      var row = btn.closest('.ui-row');
      if (!row) return;
      removeRow(row, btn.getAttribute('data-id'));
    }, { signal: signal });

    if (clearBtn) clearBtn.addEventListener('click', clearAll, { signal: signal });

    if (moreBtn) {
      moreBtn.addEventListener('click', function () { fetchPage(offset, false); }, { signal: signal });
    }

    // v1.98 shimmer sweep: seed the shimmer BEFORE the first fetch so the list
    // never shows a blank host then a snap-in (the reveal is fetchPage's own
    // replace of the list's children).
    listEl.innerHTML = buildHistorySkeletonRows(6);
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
