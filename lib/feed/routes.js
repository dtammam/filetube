'use strict';

// lib/feed/routes.js - v1.379.0 Feed mode: the feed-owned writes of a reading place
// or a resume point (plan D5, the data-loss rule). Three routes, one rule
// (lib/feed/safe-progress.js) and one served-position registry (lib/feed/served.js):
//
//   POST /api/feed/progress/book/:id   { spineIndex, blockIndex }  the book card was read
//   POST /api/feed/progress/podcast    { id, timestamp, duration }  the player's ping shape
//   POST /api/feed/progress/media      { id, timestamp, duration }  the player's ping shape
//
// Each write goes through the EXISTING writer for its kind (the books coalescer,
// lib/podcasts' progress effects, lib/media/user-routes' ping effects), so the
// stored shape, the played / watched latches and the Watch later leave rule are
// the ones every other surface has. What this module adds, before any of that:
//   - forward only: a move that would not advance the position is refused (409);
//   - never over another device: the stored record must still be the one the
//     card was served from (the served registry; 'stale' and 'not-served' are 409);
//   - the previous position is returned to the caller on every successful move
//     (and, from W2 on, recorded in the feed session) so a wrong move is recoverable.
// A refusal never touches storage. Visibility is checked exactly as the kind's own
// routes check it: a hidden item is a neutral 404, never an oracle.

const safe = require('./safe-progress');

const KIND = Object.freeze({ BOOK: 'book', PODCAST: 'podcast', MEDIA: 'media' });

function refuse(res, reason, extra) {
  return res.status(safe.statusForReason(reason)).json({ ok: false, reason, ...(extra || {}) });
}

function numberOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function registerProgressRoutes(app, deps) {
  const {
    armBookProgressFlushTimerIfNeeded,
    bookVisibleTo,
    booksDb,
    booksExcerpt, // lib/books/excerpt.js
    effectiveBookProgress,
    effectiveProgress,
    feedServed, // lib/feed/served.js registry (shared with the excerpt route and the feed API)
    fs,
    getCachedDatabase,
    mediaDeps, // the deps bundle lib/media/user-routes' applyMediaProgressPing takes
    mediaUserRoutes, // lib/media/user-routes.js (applyMediaProgressPing)
    mediaVisibleTo,
    pendingBookProgress,
    pendingProgressKey,
    podcastDeps, // { userStore, now, recordPresenceFromPing } for lib/podcasts' applyPodcastProgress
    podcastEpisodeVisibleTo,
    podcasts, // lib/podcasts (applyPodcastProgress)
    podcastsDb,
    userStore,
  } = deps;

  // ---- books -----------------------------------------------------------------
  app.post('/api/feed/progress/book/:id', (req, res) => {
    const ns = booksDb.read();
    const item = Object.prototype.hasOwnProperty.call(ns.items, req.params.id) ? ns.items[req.params.id] : undefined;
    if (!item || !bookVisibleTo(req, item)) return res.status(404).json({ error: 'Book not found' });
    if (item.format !== 'epub') return res.status(400).json({ error: 'only an EPUB position can move from the feed' });
    const body = req.body || {};
    const next = { spineIndex: body.spineIndex, blockIndex: body.blockIndex };
    if (!Number.isInteger(next.spineIndex) || !Number.isInteger(next.blockIndex) || next.spineIndex < 0 || next.blockIndex < 0) {
      return refuse(res, safe.REASONS.INVALID);
    }
    const stored = effectiveBookProgress(req.user.id, item.id);
    const served = feedServed.status(req.user.id, KIND.BOOK, item.id, stored ? stored.updatedAt : '');
    let book;
    try {
      book = booksExcerpt.openEpubBook(fs, item);
    } catch (err) {
      return res.status(503).json({ error: 'the book file could not be read', detail: err && err.code ? err.code : undefined });
    }
    if (!book) return res.status(503).json({ error: 'the book file could not be read' });
    const storedPos = stored ? booksExcerpt.resolveLocatorPosition(stored.locator, book.loadXhtml) : null;
    const decision = safe.decideBookMove({ stored: storedPos, next, served, storedExists: !!stored });
    if (!decision.ok) return refuse(res, decision.reason, { stored: storedPos });
    if (next.spineIndex >= book.spineCount) return refuse(res, safe.REASONS.INVALID);
    // The target must be a real block of that chapter (the reader will take the
    // blockIndex-th READER_BLOCK_SELECTOR element of epub.js's live chapter DOM).
    const blocks = book.loadBlocks(next.spineIndex);
    if (next.blockIndex >= blocks.length) return refuse(res, safe.REASONS.INVALID, { detail: 'no block at that position' });
    // A BLOCK position: cfi '' on purpose. The server cannot write a CFI epub.js
    // honours (its chapter DOM comes from the HTML parser, measured in W1), so the
    // reader resolves spineIndex + blockIndex in the live DOM (read.js openEpub).
    const value = {
      locator: { kind: 'epub', cfi: '', spineIndex: next.spineIndex, blockIndex: next.blockIndex },
      percent: booksExcerpt.approximatePercent(next.spineIndex, next.blockIndex, blocks.length, book.spineCount),
      updatedAt: new Date().toISOString(),
    };
    // The books coalescer: the same staging map and flush the reader's own pings use.
    pendingBookProgress.set(pendingProgressKey(req.user.id, item.id), { userId: req.user.id, bookId: item.id, value });
    armBookProgressFlushTimerIfNeeded();
    feedServed.advance(req.user.id, KIND.BOOK, item.id, value.updatedAt);
    res.json({ ok: true, previous: stored ? stored.locator : null, locator: value.locator, percent: value.percent, updatedAt: value.updatedAt });
  });

  // ---- podcasts (the player's ping body: {id, timestamp, duration}) ------------
  app.post('/api/feed/progress/podcast', (req, res) => {
    const body = req.body || {};
    const episodeId = typeof body.episodeId === 'string' ? body.episodeId : typeof body.id === 'string' ? body.id : '';
    const position = numberOr(body.position !== undefined ? body.position : body.timestamp, NaN);
    const duration = numberOr(body.duration, NaN);
    if (episodeId === '' || !Number.isFinite(position) || position < 0) return refuse(res, safe.REASONS.INVALID);
    const ns = podcastsDb.read();
    const ep = Object.prototype.hasOwnProperty.call(ns.episodes, episodeId) ? ns.episodes[episodeId] : null;
    if (!ep) return res.status(400).json({ error: 'no such episode' }); // the podcasts route's phantom-id posture
    if (!podcastEpisodeVisibleTo(req, ep)) return res.status(404).json({ error: 'no such episode' });
    const stored = userStore.getOnePodcastProgress(req.user.id, episodeId);
    const served = feedServed.status(req.user.id, KIND.PODCAST, episodeId, stored ? stored.updatedAt : '');
    const decision = safe.decideTimeMove({ storedSec: stored ? Number(stored.position) : 0, nextSec: position, served });
    if (!decision.ok) return refuse(res, decision.reason, { stored: stored || null });
    const value = podcasts.applyPodcastProgress(podcastDeps, req, episodeId, position, duration);
    feedServed.advance(req.user.id, KIND.PODCAST, episodeId, value.updatedAt);
    res.json({ ok: true, previous: stored || null, position: value.position, updatedAt: value.updatedAt });
  });

  // ---- media (videos and library audio; the player's ping body) ----------------
  app.post('/api/feed/progress/media', (req, res) => {
    const body = req.body || {};
    const id = typeof body.id === 'string' ? body.id : '';
    const timestamp = numberOr(body.timestamp, NaN);
    if (id === '' || !Number.isFinite(timestamp) || timestamp < 0) return refuse(res, safe.REASONS.INVALID);
    const db = getCachedDatabase();
    const item = Object.prototype.hasOwnProperty.call(db.metadata, id) ? db.metadata[id] : undefined;
    if (!item || !mediaVisibleTo(req, item)) return res.status(404).json({ error: 'Media not found' });
    const stored = effectiveProgress(req.user.id, id);
    const served = feedServed.status(req.user.id, KIND.MEDIA, id, stored ? stored.updatedAt : '');
    const decision = safe.decideTimeMove({ storedSec: stored ? Number(stored.timestamp) : 0, nextSec: timestamp, served });
    if (!decision.ok) return refuse(res, decision.reason, { stored: stored || null });
    const value = mediaUserRoutes.applyMediaProgressPing(mediaDeps, req, item, timestamp, body.duration);
    feedServed.advance(req.user.id, KIND.MEDIA, id, value.updatedAt);
    res.json({ ok: true, previous: stored || null, timestamp: value.timestamp, updatedAt: value.updatedAt });
  });
}

module.exports = { registerProgressRoutes, KIND };
