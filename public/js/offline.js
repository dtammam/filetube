'use strict';
// v1.387.0 offline playback (plan D6): the web half of the `downloads` capability (docs/references/native-bridge.md).
//
// Loaded on every signed-in shell right after host-adapter.js. With a host that announces `downloads` (the iOS app)
// this module owns the ONE downloads subscription per page (the v1.384 one-subscription lesson), the
// `{ kind:id -> state }` map the surfaces read, and a small API they call: state(kind, id), add(kind, id),
// remove(kind, id), show(), onChange(fn), localSrcFor(kinds, id). Native owns the files and the state; the web asks and
// displays. With no host, or a host without `downloads`, `enabled` is false, every call is a silent no-op, state() is
// always 'none' and decorate() touches nothing - a browser's DOM is byte-identical to before.
//
// Release on navigation like battery / network: this module binds its OWN pagehide (unsubscribe) and persisted-pageshow
// (re-subscribe, then REPLACE the map from the fresh snapshot) handlers; skin-surface.js's re-assert covers only the
// registries a Pocket owner claims. Words (plan correction 4): "Make available offline", "Remove offline copy", the
// "Offline" badge, "Saving for offline... 40%"; never "Download" or "Save to device" for this feature.
(function (root) {
  var KINDS = ['track', 'album', 'podcastEpisode', 'video', 'tvEpisode', 'tvSeason'];
  var COLLECTIONS = { album: true, tvSeason: true };
  var ACTIVE = { queued: true, downloading: true, paused: true, waitingForWifi: true };
  var ERROR_COPY = {
    storageFull: 'Not enough space on this phone',
    revoked: 'This device was removed in Settings',
    notOnServer: 'Not on the server yet',
    notReady: 'Preparing a playable copy, try again shortly',
    notPlayable: 'This file cannot play on this phone',
    network: 'No connection right now; it resumes when the phone is back online',
    other: 'Could not save this for offline',
  };
  var LABEL_ADD = 'Make available offline';
  var LABEL_REMOVE = 'Remove offline copy';
  var BADGE = 'Offline';

  // A chapter row (`<mediaId>::c<n>`, a chaptered audio file shown as an album in Music) is the parent file to the phone: the
  // web reads and sends the PARENT id (the manifest's item id), so native never sees a chapter id (iOS Root, 2026-10-12).
  function normalizeId(kind, id) {
    var s = String(id);
    return kind === 'track' ? s.replace(/::c\d+$/, '') : s;
  }
  function keyOf(kind, id) { return kind + ':' + normalizeId(kind, id); }

  // The state one surface reads for (kind, id): { state, progress, error, localSrc } - a collection (album, tvSeason)
  // rolls up from its members: none without members; done when every member is done; failed when one failed and none
  // is still active; otherwise downloading with the mean progress.
  function rollUp(members) {
    if (!members.length) return { state: 'none' };
    var done = 0, failed = 0, active = 0, progress = 0, error = null;
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      if (m.state === 'done') { done++; progress += 1; }
      else if (m.state === 'failed') { failed++; if (!error) error = m.error || 'other'; }
      else if (ACTIVE[m.state]) { active++; progress += typeof m.progress === 'number' ? m.progress : 0; }
    }
    if (done === members.length) return { state: 'done' };
    if (active > 0 || (done > 0 && failed === 0)) return { state: 'downloading', progress: Math.max(0, Math.min(1, progress / members.length)) };
    if (failed > 0) return { state: 'failed', error: error };
    return { state: 'none' };
  }

  function create(win) {
    var host = win && win.FileTube && win.FileTube.host;
    var enabled = !!(host && typeof host.has === 'function' && host.has('downloads'));
    var map = Object.create(null); // key -> item (the download fields native sent)
    var children = Object.create(null); // parent key -> { childKey: true }
    var listeners = [];
    var subscribed = false;
    var offDownload = null, offSnapshot = null;

    function notify(kind, id) {
      for (var i = 0; i < listeners.length; i++) { try { listeners[i](kind, id); } catch (_) { /* a listener bug never breaks the page */ } }
    }
    function put(item) {
      var k = keyOf(item.kind, item.id);
      var prev = map[k];
      if (prev && prev.parentKind && prev.parentId) {
        var oldParent = keyOf(prev.parentKind, prev.parentId);
        if (children[oldParent]) delete children[oldParent][k];
      }
      if (item.state === 'none') delete map[k];
      else map[k] = item;
      if (item.parentKind && item.parentId && item.state !== 'none') {
        var pk = keyOf(item.parentKind, item.parentId);
        children[pk] = children[pk] || Object.create(null);
        children[pk][k] = true;
      }
    }
    function replace(items) {
      map = Object.create(null);
      children = Object.create(null);
      for (var i = 0; i < items.length; i++) put(items[i]);
      notify(null, null); // everything may have changed
    }

    function state(kind, id) {
      if (!enabled || KINDS.indexOf(kind) < 0) return { state: 'none' };
      if (COLLECTIONS[kind]) {
        var kids = children[keyOf(kind, id)];
        var members = [];
        if (kids) for (var ck in kids) { if (map[ck]) members.push(map[ck]); }
        return rollUp(members);
      }
      var it = map[keyOf(kind, id)];
      if (!it) return { state: 'none' };
      var out = { state: it.state };
      if (typeof it.progress === 'number') out.progress = it.progress;
      if (it.error) out.error = it.error;
      if (it.state === 'done' && typeof it.localSrc === 'string' && it.localSrc) out.localSrc = it.localSrc;
      return out;
    }
    // The phone's copy to play ONLINE: the first of `kinds` (a media id is a `video` to the library and a `track` to
    // Music) whose item is done with a localSrc; null otherwise. Used ONLY as a media element src by the caller.
    function localSrcFor(kinds, id) {
      if (!enabled) return null;
      var list = Array.isArray(kinds) ? kinds : [kinds];
      for (var i = 0; i < list.length; i++) {
        var s = state(list[i], id);
        if (s.state === 'done' && s.localSrc) return s.localSrc;
      }
      return null;
    }
    function add(kind, id) { return enabled && KINDS.indexOf(kind) >= 0 ? host.post('downloads.add', { kind: kind, id: normalizeId(kind, id) }) : false; }
    function remove(kind, id) { return enabled && KINDS.indexOf(kind) >= 0 ? host.post('downloads.remove', { kind: kind, id: normalizeId(kind, id) }) : false; }
    function show() { return enabled ? host.post('downloads.show') : false; }
    function onChange(fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    }

    function subscribe() {
      if (!enabled || subscribed) return;
      subscribed = true;
      offDownload = host.on('download', function (d) { put(d); notify(d.kind, d.id); });
      offSnapshot = host.on('downloadsSnapshot', function (d) { replace(d.items || []); });
      host.post('downloads.subscribe');
    }
    function unsubscribe() {
      if (!subscribed) return;
      subscribed = false;
      host.post('downloads.unsubscribe');
      if (offDownload) { offDownload(); offDownload = null; }
      if (offSnapshot) { offSnapshot(); offSnapshot = null; }
    }

    // ---- the words a menu shows for a state ------------------------------------------------------------------
    // -> { id: 'offline-add' | 'offline-remove', label, progressText?, errorText? }
    function menuEntry(kind, id) {
      var s = state(kind, id);
      if (s.state === 'done') return { id: 'offline-remove', label: LABEL_REMOVE };
      if (ACTIVE[s.state]) {
        var pct = typeof s.progress === 'number' ? Math.round(s.progress * 100) : null;
        return { id: 'offline-remove', label: 'Saving for offline...' + (pct === null ? '' : ' ' + pct + '%') };
      }
      if (s.state === 'failed') return { id: 'offline-add', label: LABEL_ADD, errorText: ERROR_COPY[s.error] || ERROR_COPY.other };
      return { id: 'offline-add', label: LABEL_ADD };
    }
    // The surfaces' one dispatcher: an 'offline-add' id adds, an 'offline-remove' id removes (a download in progress is
    // cancelled by the same remove). Returns true when the id was one of ours.
    function runMenuAction(actionId, kind, id) {
      if (actionId === 'offline-add') { add(kind, id); return true; }
      if (actionId === 'offline-remove') { remove(kind, id); return true; }
      return false;
    }

    // ---- badges -----------------------------------------------------------------------------------------------
    // Draws the "Offline" chip (a ui.chip meta, the .card-type precedent) or the thin progress text on cards and rows
    // found by their EXISTING attributes, so a browser (decorate() is a no-op there) keeps its DOM byte-identical. One
    // chip per element, re-pointed on every change; removed when the state is none.
    // The badge while saving is the COMPACT form ("Saving 40%"): the full "Saving for offline... 40%" measured 138 px and
    // overflowed a two-column card's text block at 320 and 390 (tools/offline-proof/row-probe.js); the menus keep the phrase.
    function badgeText(s) {
      if (s.state === 'done') return BADGE;
      if (ACTIVE[s.state]) return 'Saving' + (typeof s.progress === 'number' ? ' ' + Math.round(s.progress * 100) + '%' : '...');
      return null;
    }
    function setBadge(doc, el, slot, text) {
      var chip = el.querySelector(':scope .offline-badge') || (slot ? slot.querySelector('.offline-badge') : null);
      if (!text) { if (chip) chip.remove(); return; }
      if (!chip) {
        var U = win.ui;
        chip = U && typeof U.chip === 'function' ? U.chip({ kind: 'meta', label: text, doc: doc }) : doc.createElement('span');
        if (!chip.classList.contains('ui-chip')) { chip.className = 'ui-chip ui-chip--meta'; chip.textContent = text; }
        chip.classList.add('offline-badge');
        if (slot) slot.insertBefore(chip, slot.firstChild);
      } else if (chip.textContent !== text) chip.textContent = text;
    }
    // Which (kind, id) an element shows, from attributes the surfaces already render.
    var CARD_KINDS = [['/watch.html?tv=', 'tvEpisode'], ['/podcasts?play=', 'podcastEpisode'], ['/music?play=', 'track'], ['/watch.html?v=', 'video'], ['/watch?v=', 'video']];
    function cardTarget(card) {
      var id = card.getAttribute('data-id');
      var media = card.querySelector('.card-media');
      var href = (media && media.getAttribute('href')) || '';
      for (var i = 0; i < CARD_KINDS.length; i++) { if (href.indexOf(CARD_KINDS[i][0]) === 0) return { kind: CARD_KINDS[i][1], id: id }; }
      return null;
    }
    function decorate(rootEl) {
      if (!enabled) return 0;
      var doc = win.document;
      var scope = rootEl || doc;
      var n = 0;
      var cards = scope.querySelectorAll ? scope.querySelectorAll('.video-card[data-id]') : [];
      for (var i = 0; i < cards.length; i++) {
        var t = cardTarget(cards[i]);
        if (!t || !t.id) continue;
        setBadge(doc, cards[i], cards[i].querySelector('.card-text'), badgeText(state(t.kind, t.id)));
        n++;
      }
      var rows = scope.querySelectorAll ? scope.querySelectorAll('.music-song-row[data-id], .tv-episode[data-episode-id], .ui-row[data-episode-id]') : [];
      for (var j = 0; j < rows.length; j++) {
        var row = rows[j];
        var kind, id;
        if (row.classList.contains('music-song-row')) { kind = 'track'; id = row.getAttribute('data-id'); }
        else if (row.classList.contains('tv-episode')) { kind = 'tvEpisode'; id = row.getAttribute('data-episode-id'); }
        else { kind = 'podcastEpisode'; id = row.getAttribute('data-episode-id'); }
        if (!id) continue;
        setBadge(doc, row, row.querySelector('.ui-row__body'), badgeText(state(kind, id)));
        n++;
      }
      return n;
    }

    if (enabled) {
      subscribe();
      try {
        win.addEventListener('pagehide', unsubscribe);
        win.addEventListener('pageshow', function (e) { if (e && e.persisted) subscribe(); });
      } catch (_) { /* a bare harness */ }
      onChange(function () { try { decorate(null); } catch (_) { /* a decorate bug never breaks the page */ } });
    }

    return {
      enabled: enabled,
      KINDS: KINDS,
      LABEL_ADD: LABEL_ADD,
      LABEL_REMOVE: LABEL_REMOVE,
      BADGE: BADGE,
      ERROR_COPY: ERROR_COPY,
      state: state,
      normalizeId: normalizeId,
      localSrcFor: localSrcFor,
      add: add,
      remove: remove,
      show: show,
      onChange: onChange,
      menuEntry: menuEntry,
      runMenuAction: runMenuAction,
      errorCopy: function (code) { return ERROR_COPY[code] || ERROR_COPY.other; },
      decorate: decorate,
      subscribed: function () { return subscribed; },
      _subscribe: subscribe,
      _unsubscribe: unsubscribe,
    };
  }

  var api = { create: create, KINDS: KINDS, LABEL_ADD: LABEL_ADD, LABEL_REMOVE: LABEL_REMOVE, BADGE: BADGE, ERROR_COPY: ERROR_COPY, rollUp: rollUp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) {
    root.FileTube = root.FileTube || {};
    if (!root.FileTube.offline) root.FileTube.offline = create(root);
  }
})(typeof window !== 'undefined' ? window : null);
