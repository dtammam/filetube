'use strict';

// lib/user/routes.js - the per-user state routes: preference sync
// (/api/prefs), the manual watched latch (/api/watched), the modern-feed hide
// list (/api/feed-hidden), watch history (/api/history) and search history
// (/api/search-history). Moved VERBATIM out of server.js in Wave 7b, slice
// S1a, of the relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md): the bodies are byte-identical to
// the server.js originals and keep their source order, group by group, with
// their free identifiers resolving from the `deps` bundle server.js hands in
// at the call site - the lib/ytdlp + lib/podcasts registerRoutes pattern. A
// missing dep is a hard failure (a destructured undefined that is later
// called throws), never a silent fallback.
//
// Two blocks moved with the routes because the routes were their only readers
// (verified by grep across server.js and lib/): the prefs allowlist binding
// below and the search-history cap + normalizeSearchTerm. Only the
// prefs-allowlist require's PATH changed ('./lib/...' -> '../...'), which
// moving a require always costs. normalizeSearchTerm is exported because
// server.js still re-exports it (test/unit/search-term-normalize.test.js
// imports it from there) - the SAME function object through both doors.

// ---- v1.265: cross-device preference sync -----------------------------------
// The SYNCED allowlist (exec plan docs/exec-plans/active/cross-device-sync.md,
// MACHINE-DERIVED, 21 keys). The server is the enforcement point: unknown keys
// are rejected PER-ITEM (a junk key cannot poison a batch), values are capped,
// and last-write-wins lives in the store's upsert WHERE guard. The client's
// twin list is in public/js/prefs-sync.js; a lock test binds both to the plan.
// v1.265 adversarial round: the list + caps moved to lib/prefs-allowlist.js so
// the backup RESTORE loop (lib/auth/store.js) enforces the SAME defenses - the
// seat measured the restore path bypassing all three (allowlist/cap/clamp).
const { SYNCED_PREF_KEYS: SYNCED_PREF_KEY_LIST, PREF_VALUE_MAX_BYTES, PREF_CLOCK_SLACK_MS } = require('../prefs-allowlist');
const SYNCED_PREF_KEYS = new Set(SYNCED_PREF_KEY_LIST);

// ---- v1.85 #1: per-user search history (the mobile magnifier) ---------------
// term-keyed, exact-dedup, recency-ordered, capped. Individually deletable + a
// clear-all guarded against the trailing-slash alias (the v1.64 lesson).
const SEARCH_HISTORY_CAP = 20;
const SEARCH_TERM_MAX = 200;
// Pure + exported: collapse whitespace, trim, cap length. Empty -> '' (rejected).
function normalizeSearchTerm(raw) {
  if (typeof raw !== 'string') return '';
  const t = raw.replace(/\s+/g, ' ').trim();
  return t.length > SEARCH_TERM_MAX ? t.slice(0, SEARCH_TERM_MAX) : t;
}

function registerRoutes(app, deps) {
  const {
    getCachedDatabase,
    mediaVisibleTo,
    pendingProgress, // the progress coalescer's staging Map - read-your-writes overlays + the history deletes
    pendingProgressKey,
    resolveModernGridItem,
    restrictedVideoMutation, // v1.80 RBAC: the no-oracle guard the mutating routes run first
    userStore,
    videoQuery,
    ytdlp,
    ytdlpDb,
  } = deps;

  app.get('/api/prefs', (req, res) => {
    res.json({ prefs: userStore.getPrefs(req.user.id) });
  });

  app.post('/api/prefs', (req, res) => {
    const body = req.body || {};
    const raw = Array.isArray(body.entries) ? body.entries : [];
    const entries = []; const rejected = [];
    for (const e of raw.slice(0, 64)) { // batch cap: the allowlist is 21 keys
      const key = e && typeof e.key === 'string' ? e.key : '';
      const value = e && typeof e.value === 'string' ? e.value : null;
      const updatedAt = e ? Number(e.updatedAt) : NaN;
      if (!SYNCED_PREF_KEYS.has(key) || value === null || !Number.isFinite(updatedAt)
        || Buffer.byteLength(value, 'utf8') > PREF_VALUE_MAX_BYTES) {
        if (key) rejected.push(key);
        continue;
      }
      // QA W3: a wrong-clock device must not WEDGE a key (a far-future stamp would
      // win LWW forever and revert every other device on every refresh, with no
      // in-app recovery). Stamps are clamped to now + 5min of ordinary skew.
      entries.push({ key, value, updatedAt: Math.min(updatedAt, Date.now() + PREF_CLOCK_SLACK_MS) });
    }
    const { applied, skipped } = userStore.setPrefsLWW(req.user.id, entries);
    res.json({ applied, skipped, rejected });
  });

  // ---- v1.72 (cap 6): the manual watched latch --------------------------------
  // Videos' latch was write-only-by-threshold (POST /api/progress crossing
  // WATCHED_PCT); podcasts have had the manual toggle since v1.69. The parity
  // port: POST marks watched NOW (idempotent - markWatched no-ops on an
  // existing row, preserving the original completed_at). DELETE is the
  // un-watch verb with IDENTICAL semantics to the v1.64 history-row delete
  // (staged ping + progress + latch): clearing only the latch would leave a
  // >=90% live position still DERIVING 'watched' and the toggle would appear
  // stuck for exactly the fully-watched items it exists for.
  app.post('/api/watched/:id', (req, res) => {
    if (restrictedVideoMutation(req, res, req.params.id)) return; // v1.80 RBAC (S-b): no restricted-id oracle/persist
    const db = getCachedDatabase(); // hot GET reader (existence check only)
    // OWN-property check (v1.42 __proto__ lesson): this id persists into
    // user_watched -- see POST /api/liked/:id's identical guard.
    const item = Object.prototype.hasOwnProperty.call(db.metadata, req.params.id) ? db.metadata[req.params.id] : undefined;
    if (!item) return res.status(404).json({ error: 'Media file not found' });
    userStore.markWatched(req.user.id, item.id, new Date().toISOString());
    res.json({ success: true, watched: true });
  });

  app.delete('/api/watched/:id', (req, res) => {
    pendingProgress.delete(pendingProgressKey(req.user.id, req.params.id));
    userStore.removeHistory(req.user.id, req.params.id);
    res.json({ success: true, watched: false });
  });

  // ---- v1.97 "Hide from feed" -----------------------------------------------
  //
  // A per-user, MANUAL prune of the MODERN home feed (GET /api/home?view=grid).
  // It is the member's OWN state (personal), NOT a visibility/RBAC control: a
  // feed-hidden item is NOT deleted and stays fully findable via search, channel,
  // playlist, folder, the classic/feed home views, and Liked - only the modern
  // feed omits it (server.js's grid arm). Media (video/audio) only, per-VIDEO
  // (channel-level hide is a separate future feature). Routes mirror /api/liked.

  // Hide a media item from THIS user's modern feed (idempotent add).
  app.post('/api/feed-hidden/:id', (req, res) => {
    if (restrictedVideoMutation(req, res, req.params.id)) return; // v1.80 RBAC (S-b): no restricted-id oracle/persist
    const db = getCachedDatabase(); // hot GET reader (existence check only)
    // OWN-property check (v1.42 __proto__ lesson): this id persists into
    // user_feed_hidden - the identical guard POST /api/liked/:id uses.
    const item = Object.prototype.hasOwnProperty.call(db.metadata, req.params.id) ? db.metadata[req.params.id] : undefined;
    if (!item) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    userStore.addFeedHidden(req.user.id, item.id, new Date().toISOString()); // ON CONFLICT DO NOTHING -> idempotent
    res.json({ success: true, hidden: true });
  });

  // Un-hide (the Undo/Restore verb). Idempotent, no existence gate - restoring
  // membership for an id that's already absent (or since deleted from the
  // library) is itself the desired end state, exactly like DELETE /api/liked/:id.
  app.delete('/api/feed-hidden/:id', (req, res) => {
    userStore.removeFeedHidden(req.user.id, req.params.id);
    res.json({ success: true, hidden: false });
  });

  // The You-tab "Hidden from feed" restore list. Read-only; never mutates. RBAC:
  // filtered through mediaVisibleTo so a SINCE-restricted item's id/title can
  // never leak here (the inverse of the v1.80 list-surface-leak class). Shaped as
  // modern-grid items (resolveModernGridItem) so the client renders the SAME
  // cards, newest-hidden first (getFeedHidden's order).
  app.get('/api/feed-hidden', (req, res) => {
    const db = getCachedDatabase();
    const ytView = ytdlpDb.holder(['subscriptions', 'channelAvatars']); // Wave 5: the avatar registry + subscriptions, ONE read per request (resolveItemChannelAvatarUrl is read-only)
    const userId = req.user.id;
    const likedSet = new Set(userStore.getLiked(userId));
    const progressMap = userStore.getProgress(userId);
    for (const entry of pendingProgress.values()) {
      if (entry.userId === userId) progressMap[entry.mediaId] = entry.value; // read-your-writes
    }
    const items = [];
    for (const id of userStore.getFeedHidden(userId)) { // newest-hidden first
      const item = Object.prototype.hasOwnProperty.call(db.metadata, id) ? db.metadata[id] : null;
      if (!item || typeof item !== 'object') continue;
      if (!mediaVisibleTo(req, item)) continue; // v1.80 RBAC: never leak a since-restricted item
      const p = Object.prototype.hasOwnProperty.call(progressMap, id) ? progressMap[id] : null;
      const ts = p ? Number(p.timestamp) : 0;
      const dur = p ? Number(p.duration) : 0;
      const rec = {
        id, kind: 'media', type: item.type === 'audio' ? 'audio' : 'video',
        addedAt: typeof item.addedAt === 'number' ? item.addedAt : 0,
        progressPercent: dur > 0 ? (ts / dur) * 100 : 0, liked: likedSet.has(id),
      };
      const shaped = resolveModernGridItem(db, rec, ytView);
      if (shaped) items.push(shaped);
    }
    res.json({ items, total: items.length });
  });

  // ---- v1.64 watch history ---------------------------------------------------
  // Everything the signed-in user watched or started, newest first. The merged
  // set is user_progress (started) + user_watched (the completion latch); the
  // per-media order key is the freshest signal: a staged coalescer ping
  // (read-your-writes -- the overlay value carries its own updatedAt) beats
  // the committed row, and progress.updatedAt pairs with the latch's
  // completed_at via max(). ISO strings compare lexicographically, so string
  // max IS time max. Dead media ids are filtered at read time (the
  // shapedQueue posture): a row that outlives its file must never break the
  // page, and the media-delete prune remains the durable cleaner.
  app.get('/api/history', (req, res) => {
    const db = getCachedDatabase(); // hot GET reader, same as /api/liked
    const ytView = ytdlpDb.holder(['subscriptions', 'channelAvatars']); // Wave 5: the avatar registry + subscriptions, ONE read per request (resolveItemChannelAvatarUrl is read-only)
    const limit = videoQuery.normalizeLimit(req.query.limit);
    const offset = videoQuery.normalizeOffset(req.query.offset);
    const progressMap = userStore.getProgress(req.user.id);
    for (const entry of pendingProgress.values()) {
      if (entry.userId === req.user.id) progressMap[entry.mediaId] = entry.value;
    }
    const watchedTimes = userStore.getWatchedTimes(req.user.id);
    const likedSet = new Set(userStore.getLiked(req.user.id));

    // Per-media newest signal. A null updated_at (a legacy batch row) sorts
    // as '' -- present in history, oldest possible position.
    const lastById = Object.create(null);
    for (const id of Object.keys(progressMap)) {
      lastById[id] = typeof progressMap[id].updatedAt === 'string' ? progressMap[id].updatedAt : '';
    }
    for (const id of Object.keys(watchedTimes)) {
      const at = typeof watchedTimes[id] === 'string' ? watchedTimes[id] : '';
      if (!(id in lastById) || at > lastById[id]) lastById[id] = at;
    }

    const merged = Object.keys(lastById)
      .filter((id) => Object.prototype.hasOwnProperty.call(db.metadata, id))
      .filter((id) => mediaVisibleTo(req, db.metadata[id])) // v1.80 RBAC: no restricted items in history
      .sort((a, b) => {
        if (lastById[a] !== lastById[b]) return lastById[a] > lastById[b] ? -1 : 1;
        return a < b ? -1 : 1; // deterministic tiebreak
      });

    const total = merged.length;
    const page = merged.slice(offset, offset + limit);
    const items = page.map((id) => {
      const item = db.metadata[id];
      const progress = progressMap[id] || { timestamp: 0, duration: 0 };
      const dur = typeof progress.duration === 'number' && Number.isFinite(progress.duration) && progress.duration > 0 ? progress.duration : 0;
      const progressPercent = dur > 0 ? (progress.timestamp / dur) * 100 : 0;
      return {
        ...item,
        // v1.113 (Fix A sweep): History feeds the SAME buildCardHtml ->
        // modernCardAvatar path, so resolve the avatar identically (read-only).
        channelAvatarUrl: ytdlp.resolveItemChannelAvatarUrl(ytView, item) || '',
        liked: likedSet.has(id),
        progress: progress.timestamp || 0,
        progressPercent,
        watchState: videoQuery.deriveWatchState(progressPercent, id in watchedTimes),
        lastWatchedAt: lastById[id] || null
      };
    });

    res.json({ items, total, offset, limit });
  });

  // Per-item remove-from-history. Idempotent 200 (an already-gone or even
  // dead-media id is a no-op, not a 404 -- a row that outlived its file must
  // still be removable). The staged coalescer entry is purged IN THE SAME
  // synchronous handler as the row delete: a staged ping left behind would be
  // flushed <=PROGRESS_FLUSH_MS later and silently resurrect the row. A ping
  // arriving AFTER this response re-adds the item -- that is the user still
  // watching, not a bug (the latch re-marks on the next threshold cross too).
  app.delete('/api/history/:id', (req, res) => {
    const id = req.params.id;
    pendingProgress.delete(pendingProgressKey(req.user.id, id));
    userStore.removeHistory(req.user.id, id);
    res.json({ success: true });
  });

  // Clear-all, strictly this user: the staged-entry sweep filters on
  // entry.userId (deleting from a Map while iterating it is safe in JS) and
  // clearHistory's DELETEs are user-scoped by statement.
  app.delete('/api/history', (req, res) => {
    // QA gate W1 (v1.64): Express non-strict routing aliases
    // 'DELETE /api/history/' -- the per-item form with a MISSING id -- onto
    // this handler. A caller that meant to remove ONE item must never wipe
    // the whole history: refuse the ambiguous trailing-slash form outright.
    if (req.path !== '/api/history') {
      return res.status(400).json({ error: 'item id required' });
    }
    for (const [key, entry] of pendingProgress) {
      if (entry.userId === req.user.id) pendingProgress.delete(key);
    }
    userStore.clearHistory(req.user.id);
    res.json({ success: true });
  });

  app.get('/api/search-history', (req, res) => {
    res.json({ terms: userStore.getSearchHistory(req.user.id, SEARCH_HISTORY_CAP) });
  });
  app.post('/api/search-history', (req, res) => {
    const term = normalizeSearchTerm(req.body && req.body.term);
    if (!term) return res.status(400).json({ error: 'term required' });
    userStore.addSearchTerm(req.user.id, term, new Date().toISOString());
    res.json({ success: true, term });
  });
  app.delete('/api/search-history/:term', (req, res) => {
    userStore.removeSearchTerm(req.user.id, req.params.term);
    res.json({ success: true });
  });
  app.delete('/api/search-history', (req, res) => {
    // The same trailing-slash guard as DELETE /api/history: a missing :term must
    // NOT be aliased onto this clear-all (Express non-strict routing).
    if (req.path !== '/api/search-history') return res.status(400).json({ error: 'term required' });
    userStore.clearSearchHistory(req.user.id);
    res.json({ success: true });
  });
}

module.exports = { registerRoutes, normalizeSearchTerm };
