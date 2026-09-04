'use strict';
// v1.265 cross-device preference sync - the ONE-SEAM client agent.
//
// Loaded early on EVERY shell (the dynamic parity test enumerates public/*.html
// - the v1.250 SHELL PARITY class). The seam is a localStorage.setItem/
// removeItem patch: every writer of a SYNCED key - present AND future - mirrors
// to the server without knowing this file exists (the "seat that forgot to call
// the shared helper" class, closed structurally). Readers are untouched:
// localStorage stays the read path and the offline cache.
//
// Semantics (exec plan cross-device-sync.md, intake-settled with Dean):
//  - LWW per key, stamps in ms; the server's upsert guard is the authority.
//  - Boot + visibilitychange(visible) GET: server-newer values are raw-written
//    into localStorage (stamps recorded); "applied by next render" is the v1
//    contract, with THEME as the one live re-apply (most visible, cheapest).
//  - 401 -> dormant until the next boot (signed-out stays local-only).
//  - Storage-hostile environments (private mode throws): the patch never
//    breaks the caller - mirror work is wrapped, the original call wins.
(function () {
  // The client twin of server.js's SYNCED_PREF_KEYS (a lock test binds both
  // to the exec plan's 22-key list - drift = a key that silently never syncs).
  var SYNCED = [
    'theme', 'ft-era', 'ft-mode', 'ft-modern-mode', 'ft-icons',
    'filetube_sort', 'filetube_modern_sort', 'filetube_modern_chip',
    'ft-star-ratings', 'ft-ambient', 'ft-ambient-intensity',
    'ft-critters:on', 'ft-critters:density', 'ft-critters:size', 'ft-critters:kiss', 'ft-critters:randomsound',
    'ft-music-skin', 'ft-music-autoplay',
    'ft-home-feed', 'ft-home-continue-listening', 'ft-home-continue-podcasts', 'ft-tv-continue-watching',
  ];
  var META_KEY = 'ft-prefs-meta'; // {key: updatedAtMs} - written via the RAW setter only (never recurses into the mirror)
  var DEBOUNCE_MS = 1000;

  var synced = Object.create(null);
  for (var i = 0; i < SYNCED.length; i++) synced[SYNCED[i]] = true;

  // The prototype via the INSTANCE, not the named Storage global - identical in
  // every browser, and it works in any realm that has localStorage at all.
  var storageProto, rawSetItem, rawRemoveItem, rawGetItem;
  try {
    storageProto = Object.getPrototypeOf(window.localStorage);
    rawSetItem = storageProto.setItem;
    rawRemoveItem = storageProto.removeItem;
    rawGetItem = storageProto.getItem;
    if (typeof rawSetItem !== 'function' || typeof rawGetItem !== 'function' || typeof rawRemoveItem !== 'function') return;
  } catch (_) { return; } // no storage at all - nothing to sync, nothing to break

  var dormant = false;   // set on 401; signed-out sessions stay local-only
  var pending = Object.create(null); // key -> {value, updatedAt} awaiting the debounced POST
  var flushTimer = null;

  function readMeta() {
    try {
      var raw = rawGetItem.call(window.localStorage, META_KEY);
      var m = raw ? JSON.parse(raw) : null;
      return (m && typeof m === 'object') ? m : {};
    } catch (_) { return {}; }
  }
  function writeMeta(meta) {
    try { rawSetItem.call(window.localStorage, META_KEY, JSON.stringify(meta)); } catch (_) { /* storage off - stamps lost, LWW still safe (server guard) */ }
  }
  function stamp(key, updatedAt) {
    var meta = readMeta();
    meta[key] = updatedAt;
    writeMeta(meta);
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      flush();
    }, DEBOUNCE_MS);
  }

  function flush() {
    if (dormant) return;
    var entries = [];
    for (var k in pending) entries.push({ key: k, value: pending[k].value, updatedAt: pending[k].updatedAt });
    pending = Object.create(null);
    if (!entries.length) return;
    try {
      fetch('/api/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: entries }),
        credentials: 'same-origin',
      }).then(function (res) {
        if (res && res.status === 401) dormant = true;
      }).catch(function () { /* offline - localStorage already holds truth; the next write retries */ });
    } catch (_) { /* fetch unavailable - local-only */ }
  }

  function mirrorSet(key, value) {
    var at = Date.now();
    stamp(key, at);
    pending[key] = { value: String(value), updatedAt: at };
    scheduleFlush();
  }

  // ---- the seam ----
  try {
    storageProto.setItem = function (key, value) {
      rawSetItem.apply(this, arguments); // the caller's write ALWAYS lands first
      try { if (this === window.localStorage && synced[key]) mirrorSet(key, value); } catch (_) { /* mirroring must never break a write */ }
    };
    storageProto.removeItem = function (key) {
      rawRemoveItem.apply(this, arguments);
      // A removed synced key mirrors as the empty string (the readers' own
      // absent-vs-empty defaults treat both as unset; a tombstone row keeps
      // LWW coherent where a true DELETE would lose the stamp).
      try { if (this === window.localStorage && synced[key]) mirrorSet(key, ''); } catch (_) { /* ditto */ }
    };
  } catch (_) { /* Storage not patchable - readers/writers still work, no sync */ }

  // ---- boot + focus refresh ----
  function applyServer(prefs) {
    var meta = readMeta();
    var changedTheme = false;
    for (var key in prefs) {
      if (!synced[key]) continue; // the server allowlist should guarantee this; belt and braces
      var row = prefs[key];
      if (!row || typeof row.value !== 'string' || !isFinite(Number(row.updatedAt))) continue;
      var localAt = Number(meta[key] || 0);
      if (Number(row.updatedAt) <= localAt) continue; // local is newer or same - local wins here; the server keeps its copy
      try {
        if (row.value === '') rawRemoveItem.call(window.localStorage, key);
        else rawSetItem.call(window.localStorage, key, row.value);
      } catch (_) { continue; }
      meta[key] = Number(row.updatedAt);
      if (key === 'theme') changedTheme = true;
    }
    writeMeta(meta);
    if (changedTheme) {
      // The one live re-apply (v1 contract): the theme boot script keys off
      // documentElement's attribute; re-running its rule here is one line.
      try {
        var t = rawGetItem.call(window.localStorage, 'theme');
        if (t) document.documentElement.setAttribute('data-theme', t);
        else document.documentElement.removeAttribute('data-theme');
      } catch (_) { /* next render applies it */ }
    }
  }

  function refresh() {
    if (dormant) return;
    try {
      fetch('/api/prefs', { credentials: 'same-origin' }).then(function (res) {
        if (!res) return;
        if (res.status === 401) { dormant = true; return; }
        if (!res.ok) return;
        return res.json().then(function (json) {
          if (json && json.prefs) applyServer(json.prefs);
        });
      }).catch(function () { /* offline - cache serves */ });
    } catch (_) { /* fetch unavailable */ }
  }

  refresh(); // boot leg
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refresh(); // the tab-focus leg (intake Q3)
    });
  } catch (_) { /* no document events - boot leg only */ }

  // Test hooks (jsdom drives the seams directly; production ignores them).
  window.__ftPrefsSync = { refresh: refresh, flush: flush, applyServer: applyServer, SYNCED: SYNCED.slice() };
})();
