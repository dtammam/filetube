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
//    contract, with ERA+MODE as the live re-applies (the keys with real writers - QA W1).
//  - 401 -> dormant until the next boot (signed-out stays local-only).
//  - Storage-hostile environments (private mode throws): the patch never
//    breaks the caller - mirror work is wrapped, the original call wins.
(function () {
  if (window.__ftPrefsSync) return; // double-load guard (QA S2): a second eval must not wrap the first patch
  // The client twin of server.js's SYNCED_PREF_KEYS (a lock test binds both
  // to the exec plan's 21-key list - drift = a key that silently never syncs).
  var SYNCED = [
    'ft-era', 'ft-mode', 'ft-modern-mode', 'ft-icons',
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
  var bootSynced = false; // flushes HOLD until the boot GET settles (QA W2: a fresh
                          // device's legacy seeds must not out-stamp the server's
                          // genuinely newer rows; applyServer drops the losers)

  function readMeta() {
    try {
      var raw = rawGetItem.call(window.localStorage, META_KEY);
      var m = raw ? JSON.parse(raw) : null;
      return (m && typeof m === 'object') ? m : {};
    } catch (_) { return {}; }
  }
  function writeMeta(meta) {
    try { rawSetItem.call(window.localStorage, META_KEY, JSON.stringify(meta)); } catch (_) { /* storage off - stamps lost: server-side LWW stays safe, but client apply degrades to server-wins for unstamped keys (disclosed) */ }
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
    if (!bootSynced) { scheduleFlush(); return; } // hold until the boot GET settles (QA W2)
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
        if (res && res.status === 401) { dormant = true; return; }
        // Adversarial W-B: a resolved 5xx (a proxy mid-redeploy) dropped the
        // batch FOREVER - the local value keeps its newer stamp so no boot
        // ever re-pushes it, and equality suppression blocks a same-value
        // re-mirror. Non-ok = un-acked, same restore arm as a network failure.
        if (!res || !res.ok) restorePending();
      }).catch(restorePending);
      function restorePending() {
        // QA S1 (the v1.254 dropped-flight cousin): an un-acked batch goes BACK
        // into pending (never over a newer write to the same key) and re-arms.
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (!pending[e.key]) pending[e.key] = { value: e.value, updatedAt: e.updatedAt };
        }
        scheduleFlush();
      }
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
      // QA CRITICAL-1: EQUALITY SUPPRESSION. Boot re-appliers (applyTheme,
      // applyIconSet) re-persist the UNCHANGED value on every page load; an
      // unsuppressed mirror re-stamps it with this device's fresh Date.now(),
      // turning last-write-wins into last-BOOT-wins (a mere page load on one
      // device reverted another device's explicit change - the seat's repro).
      // Only a write that CHANGES the stored value is a user-intent signal.
      var prior = null;
      try { if (this === window.localStorage && synced[key]) prior = rawGetItem.call(this, key); } catch (_) { /* treat as changed */ }
      rawSetItem.apply(this, arguments); // the caller's write ALWAYS lands first
      try { if (this === window.localStorage && synced[key] && String(value) !== prior) mirrorSet(key, value); } catch (_) { /* mirroring must never break a write */ }
    };
    storageProto.removeItem = function (key) {
      var had = null;
      try { if (this === window.localStorage && synced[key]) had = rawGetItem.call(this, key); } catch (_) { /* treat as present */ }
      rawRemoveItem.apply(this, arguments);
      // A removed synced key mirrors as the empty string (the readers' own
      // absent-vs-empty defaults treat both as unset; a tombstone row keeps
      // LWW coherent where a true DELETE would lose the stamp). Removing an
      // ABSENT key is suppressed like an equal write (QA C1's other axis).
      try { if (this === window.localStorage && synced[key] && had !== null) mirrorSet(key, ''); } catch (_) { /* ditto */ }
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
      delete pending[key]; // the server just won this key - a buffered boot write must not re-fight it (QA W2)
      if (key === 'ft-era' || key === 'ft-mode') changedTheme = true;
    }
    writeMeta(meta);
    if (changedTheme) {
      // The live re-apply (v1 contract), retargeted by the gate (QA W1: 'theme'
      // has NO writers - its branch was dead code, and it carried the wrong
      // value space): data-theme carries the ERA, data-mode the light/dark
      // (common.js applyTheme). Values are validated loosely here (shape only)
      // - they enter only via the app's own writers, and the next boot's
      // resolveTheme re-validates against the era registry (which this file
      // deliberately does not duplicate - the hand-maintained-list class).
      try {
        var era = rawGetItem.call(window.localStorage, 'ft-era');
        var mode = rawGetItem.call(window.localStorage, 'ft-mode');
        if (era && /^\d{4}$/.test(era)) document.documentElement.setAttribute('data-theme', era);
        if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-mode', mode);
      } catch (_) { /* next render applies it */ }
    }
  }

  function refresh() {
    if (dormant) return;
    try {
      fetch('/api/prefs', { credentials: 'same-origin' }).then(function (res) {
        if (!res) { bootSynced = true; return; }
        if (res.status === 401) { dormant = true; bootSynced = true; return; }
        if (!res.ok) { bootSynced = true; return; }
        return res.json().then(function (json) {
          if (json && json.prefs) applyServer(json.prefs);
          bootSynced = true;
        });
      }).catch(function () { bootSynced = true; /* offline - cache serves; held flushes release */ });
    } catch (_) { bootSynced = true; /* fetch unavailable - local-only */ }
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
