// FileTube Clean up page (v1.342) -- registered VIEW MODULE (the history.js pattern).
// Renders GET /api/cleanup/suggestions as four groups of ui-rows. It is a SHORTLIST: nothing
// is pre-selected, and nothing leaves the library except through one explicit path -
// "Move to Trash" asks ui.confirm (naming the count and size), re-reads the shortlist, and
// then sends one DELETE /api/videos/<id> (the SAME route as every card's delete, which moves
// the file to Trash) per selected id. The client sends ids it is SHOWING, never criteria.

// ---- Pure, DOM-free helpers (node:test-covered without a browser) ----------

var CLEANUP_DAY_CHOICES = [7, 30, 90, 180];
var CLEANUP_DEFAULT_DAYS = 30;
var CLEANUP_GROUPS = [
  { key: 'watched', title: 'Watched to the end', blurb: 'You finished these a while ago.' },
  { key: 'stale_subscriptions', title: 'Subscription downloads nobody opened', blurb: 'Downloaded for a subscription and never played.' },
  { key: 'duplicates', title: 'Duplicates', blurb: 'Newer copies of a video you already have. The oldest copy is kept.' },
  { key: 'largest', title: 'Biggest files nobody opened', blurb: 'The largest files that were never played.' },
];

function cleanupFormatBytes(n) {
  var v = Number(n);
  if (!isFinite(v) || v <= 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return (i === 0 || v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + ' ' + units[i];
}

function cleanupNormalizeDays(raw) {
  var n = parseInt(raw, 10);
  return CLEANUP_DAY_CHOICES.indexOf(n) !== -1 ? n : CLEANUP_DEFAULT_DAYS;
}

// Every shown item, once, keyed by id (the server already lists an item in one group only).
function cleanupItemsById(body) {
  var out = Object.create(null);
  CLEANUP_GROUPS.forEach(function (g) {
    var list = body && Array.isArray(body[g.key]) ? body[g.key] : [];
    list.forEach(function (it) {
      if (it && typeof it.id === 'string' && it.id && !(it.id in out)) out[it.id] = it;
    });
  });
  return out;
}

function cleanupSelectionSummary(itemsById, selectedIds) {
  var count = 0;
  var bytes = 0;
  selectedIds.forEach(function (id) {
    var it = itemsById[id];
    if (!it) return;
    count += 1;
    bytes += Number(it.size) || 0;
  });
  return { count: count, bytes: bytes };
}

function cleanupConfirmBody(count, bytes) {
  return 'Move ' + count + (count === 1 ? ' item' : ' items') + ' (' + cleanupFormatBytes(bytes) +
    ') to Trash? They leave your library now and stay in Trash, where you can restore them from Settings, until the Trash retention window empties it.';
}

// The selected ids that are STILL on a fresh shortlist. Anything that dropped off (it was liked,
// started, or moved since the page loaded) is never sent.
// It must also be suggested for the SAME reason and keeper it was shown with: a duplicate whose
// kept copy changed is a different decision.
function cleanupStillSuggested(selectedIds, freshBody, shownById) {
  var fresh = cleanupItemsById(freshBody);
  var keep = [];
  var dropped = 0;
  selectedIds.forEach(function (id) {
    var shown = shownById && shownById[id];
    var same = id in fresh && (!shown || (shown.reason === fresh[id].reason && shown.keepId === fresh[id].keepId));
    if (same) keep.push(id); else dropped += 1;
  });
  return { keep: keep, dropped: dropped };
}

// Sequential explicit-id deletes. Resolves { done, gone, failed, stopped }: 2xx = done, 404 = gone
// (already out of the library), 401/403 = stop at once (no rights: the rest would fail the same way).
function cleanupRunDeletes(ids, fetchFn, signal) {
  var out = { done: [], gone: [], failed: [], stopped: false };
  var chain = Promise.resolve();
  ids.forEach(function (id) {
    chain = chain.then(function () {
      if (out.stopped || (signal && signal.aborted)) { out.stopped = true; return; }
      return fetchFn('/api/videos/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (r) {
        if (r.ok) out.done.push(id);
        else if (r.status === 404) out.gone.push(id);
        else { out.failed.push(id); if (r.status === 401 || r.status === 403) out.stopped = true; }
      }, function () { out.failed.push(id); });
    });
  });
  return chain.then(function () { return out; });
}

function cleanupWhenLabel(iso) {
  var t = Date.parse(iso || '');
  if (!isFinite(t)) return '';
  var d = new Date(t);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function cleanupRowMeta(group, it) {
  var bits = [cleanupFormatBytes(it.size)];
  if (group === 'watched' && it.lastPlayedAt) bits.push('watched ' + cleanupWhenLabel(it.lastPlayedAt));
  else if (it.addedAt) bits.push('added ' + cleanupWhenLabel(it.addedAt));
  if (group === 'duplicates' && it.keepTitle) bits.push('keeping "' + it.keepTitle + '"');
  return bits.filter(Boolean).join(' - ');
}

function cleanupUi() {
  if (typeof window !== 'undefined' && window.ui) return window.ui;
  if (typeof module !== 'undefined' && module.require) {
    try { return module.require('./ui.js'); } catch (_) { return null; }
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CLEANUP_DAY_CHOICES, CLEANUP_GROUPS, cleanupFormatBytes, cleanupNormalizeDays, cleanupItemsById,
    cleanupSelectionSummary, cleanupConfirmBody, cleanupStillSuggested, cleanupRunDeletes, cleanupRowMeta,
  };
}

(function () {
  if (typeof window === 'undefined') return;
  var controller = null;
  var PREF = 'ft-cleanup-days';

  function readDays() {
    try { return cleanupNormalizeDays(window.localStorage.getItem(PREF)); } catch (_) { return CLEANUP_DEFAULT_DAYS; }
  }
  function writeDays(n) {
    try { window.localStorage.setItem(PREF, String(n)); } catch (_) { /* storage off: the choice lasts this visit */ }
  }

  function init(root) {
    controller = new AbortController();
    var signal = controller.signal;
    var u = cleanupUi();
    var groupsEl = root.querySelector('#cleanup-groups');
    var daysEl = root.querySelector('#cleanup-days');
    var trashBtn = root.querySelector('#cleanup-trash-btn');
    var summaryEl = root.querySelector('#cleanup-summary');
    if (!groupsEl || !u) return;

    var days = readDays();
    var itemsById = Object.create(null);
    var selected = new Set();
    var busy = false;
    var loadToken = 0;

    function toast(msg) {
      if (typeof window.showToast === 'function') window.showToast(msg);
      else if (u && typeof u.toast === 'function') u.toast(msg);
    }

    function refreshChrome() {
      var s = cleanupSelectionSummary(itemsById, selected);
      if (trashBtn) trashBtn.disabled = busy || s.count === 0;
      if (summaryEl) summaryEl.textContent = s.count === 0 ? '' : s.count + (s.count === 1 ? ' item' : ' items') + ' - ' + cleanupFormatBytes(s.bytes);
    }

    function buildRow(group, it) {
      var sw = u.switch ? u.switch({
        label: 'Select ' + it.title,
        onChange: function (on) {
          if (busy) return;
          if (on) selected.add(it.id); else selected.delete(it.id);
          refreshChrome();
        },
      }) : null;
      var row = u.row({ size: 'default', title: it.title, meta: cleanupRowMeta(group, it), actions: [sw], doc: document });
      row.setAttribute('data-id', it.id);
      return row;
    }

    function render(body) {
      itemsById = cleanupItemsById(body);
      selected = new Set();
      var frag = document.createDocumentFragment();
      var any = false;
      CLEANUP_GROUPS.forEach(function (g) {
        var list = body && Array.isArray(body[g.key]) ? body[g.key] : [];
        if (!list.length) return;
        any = true;
        var total = list.reduce(function (n, it) { return n + (Number(it.size) || 0); }, 0);
        var section = document.createElement('section');
        section.className = 'cleanup-group';
        section.setAttribute('data-group', g.key);
        var h = document.createElement('h3');
        h.className = 'cleanup-group-title';
        h.textContent = g.title + ' (' + list.length + ', ' + cleanupFormatBytes(total) + ')';
        var p = document.createElement('p');
        p.className = 'cleanup-group-blurb';
        p.textContent = g.blurb;
        var l = u.list({ size: 'default', label: g.title, doc: document });
        list.forEach(function (it) { l.appendChild(buildRow(g.key, it)); });
        section.appendChild(h);
        section.appendChild(p);
        section.appendChild(l);
        frag.appendChild(section);
      });
      if (!any) {
        frag.appendChild(u.state({ icon: 'check', title: 'Nothing to clean up',
          body: 'No suggestions at ' + days + ' days. Try a shorter window.' }));
      }
      groupsEl.replaceChildren(frag);
      refreshChrome();
    }

    function fetchSuggestions() {
      return fetch('/api/cleanup/suggestions?days=' + encodeURIComponent(days), { signal: signal })
        .then(function (r) { if (!r.ok) throw new Error('cleanup fetch failed: ' + r.status); return r.json(); });
    }

    function load() {
      var token = ++loadToken;
      selected = new Set();
      refreshChrome();
      return fetchSuggestions().then(function (body) {
        if (signal.aborted || token !== loadToken) return;
        render(body);
      }).catch(function (err) {
        if (signal.aborted || token !== loadToken) return;
        itemsById = Object.create(null);
        groupsEl.replaceChildren(u.state({ icon: 'warning', title: 'Could not load suggestions',
          body: 'Check your connection and try again.', action: { label: 'Try again', onClick: load } }));
        refreshChrome();
        console.error('Cleanup: load failed', err);
      });
    }

    function removeRows(ids) {
      ids.forEach(function (id) {
        selected.delete(id);
        delete itemsById[id];
        var rows = groupsEl.querySelectorAll('.ui-row[data-id]');
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].getAttribute('data-id') === id) {
            var section = rows[i].closest('.cleanup-group');
            rows[i].remove();
            if (section && !section.querySelector('.ui-row')) section.remove();
          }
        }
      });
    }

    function moveToTrash() {
      if (busy) return;
      var ids = Array.from(selected).filter(function (id) { return id in itemsById; });
      if (!ids.length) return;
      var s = cleanupSelectionSummary(itemsById, ids);
      busy = true; // one confirm at a time: a double tap asks once
      refreshChrome();
      u.confirm({ title: 'Move to Trash?', body: cleanupConfirmBody(s.count, s.bytes), confirmLabel: 'Move to Trash',
        cancelLabel: 'Cancel', danger: true, signal: signal }).then(function (ok) {
        if (ok !== true || signal.aborted) { busy = false; refreshChrome(); return; }
        // Re-read the shortlist: only ids that are STILL suggested go to the delete route.
        return fetchSuggestions().then(function (fresh) {
          if (signal.aborted) return;
          var check = cleanupStillSuggested(ids, fresh, itemsById);
          if (check.dropped > 0) {
            busy = false;
            toast('The list changed, so nothing was moved. Review it and try again.');
            render(fresh);
            return;
          }
          return cleanupRunDeletes(check.keep, function (url, init) { return fetch(url, init); }, signal).then(function (res) {
            if (signal.aborted) return;
            busy = false;
            removeRows(res.done.concat(res.gone));
            refreshChrome();
            if (res.failed.length) toast('Moved ' + res.done.length + ' to Trash. ' + res.failed.length + ' could not be moved.');
            else toast('Moved ' + res.done.length + (res.done.length === 1 ? ' item' : ' items') + ' to Trash.');
          });
        });
      }).catch(function (err) {
        busy = false;
        if (signal.aborted) return;
        refreshChrome();
        toast('Could not move to Trash. Try again.');
        console.error('Cleanup: move failed', err);
      });
    }

    if (daysEl && u.segmented) {
      daysEl.appendChild(u.segmented({
        label: 'Older than',
        value: days,
        options: CLEANUP_DAY_CHOICES.map(function (n) { return { value: n, label: n + ' days' }; }),
        onChange: function (v) { if (busy) return; days = cleanupNormalizeDays(v); writeDays(days); load(); },
      }));
    }
    if (trashBtn) trashBtn.addEventListener('click', moveToTrash, { signal: signal });
    load();
  }

  function destroy() {
    if (controller) controller.abort();
    controller = null;
  }

  if (window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('cleanup', { init, destroy });
  }
})();
