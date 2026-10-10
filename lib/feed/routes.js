'use strict';

// lib/feed/routes.js - v1.379.0 Feed mode: the feed-owned writes of a reading place
// or a resume point (plan D5, the data-loss rule). Three routes, one rule
// (lib/feed/safe-progress.js) and one served-position registry (lib/feed/served.js):
//
//   POST /api/feed/progress/book/:id   { spineIndex, blockIndex }  the book card was read
//   POST /api/feed/progress/podcast    { id, timestamp, duration }  the player's ping shape
//   POST /api/feed/progress/media      { id, timestamp, duration }  the player's ping shape
//   POST /api/feed/start-over          { session, kind, id }            v1.381.0 (D9): forget ONE item's place (recorded first)
//   POST /api/feed/start-over/undo     { session, token }               ...and put EXACTLY that back, if nothing moved since
//   GET  /api/feed/start-over/place?kind=&id=                           v1.383.0 (K7 c): the STORED place the confirm names
//
// Each write goes through the EXISTING writer for its kind (the books coalescer,
// lib/podcasts' progress effects, lib/media/user-routes' ping effects), so the
// stored shape, the played / watched latches and the Watch later leave rule are
// the ones every other surface has. What this module adds, before any of that:
//   - forward only: a move that would not advance the position is refused (409);
//   - the one-minute rule (v1.380.0): a card served FRESH (an item the viewer had not started) writes nothing
//     until the player reports 60 s of actual playback (`playedSec`); before that, 'too-early' (409); v1.382.0 (D6): or
//     its whole reel when the served slice is shorter than that (safe-progress freshNeedSec's sliceSec);
//   - never over another device: the stored record must still be the one the
//     card was served from (the served registry; 'stale' and 'not-served' are 409);
//   - the previous position is returned to the caller on every successful move
//     (and, from W2 on, recorded in the feed session) so a wrong move is recoverable.
// A refusal never touches storage. Visibility is checked exactly as the kind's own
// routes check it: a hidden item is a neutral 404, never an oracle.

const crypto = require('node:crypto');
const safe = require('./safe-progress');
const { READER_CFI_MAX_CHARS } = require('../books/routes'); // v1.383.0 (K7 a): the reader's own bound on a stored cfi

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

  // D5's recovery record: an accepted move is appended to the feed session that served
  // the card (lib/feed/served.js remembers it), with what the position moved FROM. A
  // time-position chain (a podcast's pings every few seconds) is coalesced: the
  // session keeps ONE move per (kind, id) with the FIRST `from` and the latest `to`.
  function recordMove(userId, kind, id, move) {
    const sessionId = feedServed.sessionOf(userId, kind, id);
    if (!sessionId) return;
    const cur = userStore.getFeedSession(userId, sessionId);
    if (!cur) return;
    const moves = cur.summary && Array.isArray(cur.summary.moves) ? cur.summary.moves : [];
    const last = moves.length ? moves[moves.length - 1] : null;
    if (last && last.kind === kind && last.id === id && kind !== KIND.BOOK && !last.startOver) { // a Start over record is never merged into
      // extend the open chain in place (one row per slice, not one per ping)
      const merged = { ...last, to: move.to, at: move.at };
      userStore.setFeedSessionMoves(userId, sessionId, moves.slice(0, -1).concat(merged));
      return;
    }
    userStore.appendFeedSessionMove(userId, sessionId, { kind, id, ...move });
  }

  // ---- books -----------------------------------------------------------------
  app.post('/api/feed/progress/book/:id', (req, res) => {
    const ns = booksDb.read();
    const item = Object.prototype.hasOwnProperty.call(ns.items, req.params.id) ? ns.items[req.params.id] : undefined;
    if (!item || !bookVisibleTo(req, item)) return res.status(404).json({ error: 'Book not found' });
    if (item.format !== 'epub') return res.status(400).json({ error: 'only an EPUB position can move from the feed' });
    const body = req.body || {};
    const stored = effectiveBookProgress(req.user.id, item.id);
    const served = feedServed.status(req.user.id, KIND.BOOK, item.id, stored ? stored.updatedAt : '');
    if (body.atEnd === true) {
      // Gate r1 (adversary W1): the card at the book's end latches finished under the SAME rule as a
      // move - the card was served from the stored place and nothing moved it since. The books
      // route's bare latch stays the reader's and the shelf's.
      if (served !== 'ok') return refuse(res, served === 'stale' ? safe.REASONS.STALE : safe.REASONS.UNKNOWN_SERVED);
      const at = new Date().toISOString();
      userStore.setBookFinished(req.user.id, item.id, at);
      recordMove(req.user.id, KIND.BOOK, item.id, { from: stored ? stored.locator : null, to: { finished: true }, at });
      return res.json({ ok: true, finished: true });
    }
    const next = { spineIndex: body.spineIndex, blockIndex: body.blockIndex };
    if (!Number.isInteger(next.spineIndex) || !Number.isInteger(next.blockIndex) || next.spineIndex < 0 || next.blockIndex < 0) {
      return refuse(res, safe.REASONS.INVALID);
    }
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
    recordMove(req.user.id, KIND.BOOK, item.id, { from: stored ? stored.locator : null, to: value.locator, at: value.updatedAt });
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
    // One neutral 404 for a missing AND a hidden episode (gate r1, security-brief): episode ids are
    // computable from a public feed URL and a guid, so a 400/404 split would tell a restricted member
    // whether the admin holds an episode of a hidden show.
    if (!ep || !podcastEpisodeVisibleTo(req, ep)) return res.status(404).json({ error: 'no such episode' });
    const stored = userStore.getOnePodcastProgress(req.user.id, episodeId);
    const served = feedServed.status(req.user.id, KIND.PODCAST, episodeId, stored ? stored.updatedAt : '');
    const decision = safe.decideTimeMove({ storedSec: stored ? Number(stored.position) : 0, nextSec: position, served, fresh: feedServed.isFresh(req.user.id, KIND.PODCAST, episodeId), playedSec: numberOr(body.playedSec, 0), durationSec: Number(ep.durationSec) || numberOr(duration, 0), sliceSec: feedServed.sliceSecOf(req.user.id, KIND.PODCAST, episodeId), sinceResetSec: feedServed.resetAgeSec(req.user.id, KIND.PODCAST, episodeId) });
    if (!decision.ok) return refuse(res, decision.reason, { stored: stored || null });
    const value = podcasts.applyPodcastProgress(podcastDeps, req, episodeId, position, duration);
    recordMove(req.user.id, KIND.PODCAST, episodeId, { from: stored ? stored.position : null, to: value.position, at: value.updatedAt });
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
    const decision = safe.decideTimeMove({ storedSec: stored ? Number(stored.timestamp) : 0, nextSec: timestamp, served, fresh: feedServed.isFresh(req.user.id, KIND.MEDIA, id), playedSec: numberOr(body.playedSec, 0), durationSec: Number(item.duration) || numberOr(body.duration, 0), sliceSec: feedServed.sliceSecOf(req.user.id, KIND.MEDIA, id), sinceResetSec: feedServed.resetAgeSec(req.user.id, KIND.MEDIA, id) });
    if (!decision.ok) return refuse(res, decision.reason, { stored: stored || null });
    const value = mediaUserRoutes.applyMediaProgressPing(mediaDeps, req, id, item, timestamp, body.duration);
    recordMove(req.user.id, KIND.MEDIA, id, { from: stored ? stored.timestamp : null, to: value.timestamp, at: value.updatedAt });
    feedServed.advance(req.user.id, KIND.MEDIA, id, value.updatedAt);
    res.json({ ok: true, previous: stored || null, timestamp: value.timestamp, updatedAt: value.updatedAt });
  });

  // ---- v1.381.0 (D9): Start over - the ONE deliberate reset (a data-loss surface: the full gate) ------------------
  //   POST /api/feed/start-over        { session, kind: 'media' | 'podcast' | 'book', id }
  //   POST /api/feed/start-over/undo   { session, token }
  // One item, this user only. The previous place is read from STORAGE (a pending write overlaid), never from the
  // card, and RECORDED in the feed session (a `moves` entry: startOver, token, from) BEFORE anything is reset, so a
  // crash between the two leaves the record and nothing lost. An item with nothing to forget is refused (a second tap
  // on Start over can never record an empty place over the real one). Undo restores EXACTLY the recorded rows, and
  // only while the item is still exactly as the reset left it (compare-and-set, stillAsReset: any row, staged write or
  // latch since = 409 'moved'; the record stays in the session, though no screen offers it yet - ROADMAP Planned).
  // Visibility as the kind's own routes: a hidden item is a neutral 404, for the reset AND the undo. Every handler is
  // synchronous: no await, so no two requests interleave.
  const START_OVER_KINDS = [KIND.MEDIA, KIND.PODCAST, KIND.BOOK];
  const START_OVER_ID_MAX = 256;
  // a plain id: a non-empty string under the cap with no control character (a NUL never reaches a write: LESSONS 9)
  const plainId = (v) => typeof v === 'string' && v !== '' && v.length <= START_OVER_ID_MAX && !Array.prototype.some.call(v, (c) => c.charCodeAt(0) < 32);
  const own = (obj, key) => (obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);

  function visibleItem(req, kind, id) {
    if (kind === KIND.MEDIA) { const item = own(getCachedDatabase().metadata, id); return item && mediaVisibleTo(req, item) ? item : null; }
    if (kind === KIND.PODCAST) { const ep = own(podcastsDb.read().episodes, id); return ep && podcastEpisodeVisibleTo(req, ep) ? ep : null; }
    const book = own(booksDb.read().items, id);
    return book && bookVisibleTo(req, book) ? book : null;
  }
  // the place as it is STORED now (the coalescers' pending writes overlaid). A latch is its ROW's presence, recorded as a
  // flag beside its time (gate r2, adversary: a latch whose time is NULL - a backup entry without one - counted as none, so
  // Start over deleted it and Undo never put it back).
  const has = (map, id) => Object.prototype.hasOwnProperty.call(map, id);
  function placeOf(userId, kind, id) {
    if (kind === KIND.MEDIA) {
      const p = effectiveProgress(userId, id);
      const w = userStore.getWatchedTimes(userId);
      return { progress: p ? { timestamp: p.timestamp, duration: p.duration, updatedAt: p.updatedAt } : null, watched: has(w, id), watchedAt: has(w, id) ? w[id] : null };
    }
    if (kind === KIND.PODCAST) {
      const pl = userStore.getPodcastPlayed(userId);
      return { progress: userStore.getOnePodcastProgress(userId, id) || null, played: has(pl, id), playedAt: has(pl, id) ? pl[id] : null };
    }
    const f = userStore.getBookFinished(userId);
    return { progress: effectiveBookProgress(userId, id) || null, finished: has(f, id), finishedAt: has(f, id) ? f[id] : null };
  }
  function nothingToForget(kind, place) {
    if (kind === KIND.MEDIA) return !(place.progress && Number(place.progress.timestamp) > 0) && !place.watched;
    if (kind === KIND.PODCAST) return !(place.progress && Number(place.progress.position) > 0) && !place.played;
    return !place.progress && !place.finished;
  }
  // gate r1 (qa W3, adversary W2): Undo restores only while the item is EXACTLY as the reset left it - no stored row at all
  // (a 0 s row is a newer intent: the watch page's own "Start over", a skip back to 0), no staged write in a coalescer (it
  // would flush over the restore), no latch. "Nothing to forget" (position <= 0) was too loose for this.
  function stillAsReset(userId, kind, id) {
    if (kind === KIND.MEDIA) return !mediaDeps.pendingProgress.has(pendingProgressKey(userId, id)) && !userStore.getOneProgress(userId, id) && !has(userStore.getWatchedTimes(userId), id);
    if (kind === KIND.PODCAST) return !userStore.getOnePodcastProgress(userId, id) && !has(userStore.getPodcastPlayed(userId), id);
    return !pendingBookProgress.has(pendingProgressKey(userId, id)) && !userStore.getOneBookProgress(userId, id) && !has(userStore.getBookFinished(userId), id);
  }
  // gate r1 (security-brief N1): what Undo writes must have the shape the reset recorded - a record that came back through an
  // admin's backup restore is checked here, never trusted (numbers finite, stamps short strings, a book place a small object)
  const stamp = (v) => v === null || v === undefined || (typeof v === 'string' && v.length <= 64 && Number.isFinite(Date.parse(v)));
  const fin = (v) => v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v)); // any finite value: exact is exact
  const flag = (v) => v === undefined || typeof v === 'boolean';
  function validRecordedPlace(kind, from) {
    if (!from || typeof from !== 'object' || Array.isArray(from)) return false;
    const p = from.progress;
    if (kind === KIND.MEDIA) return (p === null || (p && typeof p === 'object' && fin(p.timestamp) && fin(p.duration) && stamp(p.updatedAt))) && stamp(from.watchedAt) && flag(from.watched);
    if (kind === KIND.PODCAST) return (p === null || (p && typeof p === 'object' && fin(p.position) && fin(p.duration) && stamp(p.updatedAt))) && stamp(from.playedAt) && flag(from.played);
    if (p !== null && !bookPlaceRestorable(p)) return false;
    return stamp(from.finishedAt) && flag(from.finished);
  }
  // v1.383.0 (K7 a, the v1.381.0 gate's suggestion): a book place is bounded by the READER's own limit, not a flat 4096 bytes - a
  // real reader place whose cfi held ~1365+ multi-byte characters passed the reader (2000 characters) and was then refused by
  // Start over (refused and kept, never lost). The cfi may be as long as the reader allows; everything else in the place keeps
  // the old small bound (measured without the cfi), so a place of an unusual shape is still refused before anything is reset.
  const BOOK_PLACE_REST_MAX_BYTES = 4096;
  function bookPlaceRestorable(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p) || !p.locator || typeof p.locator !== 'object' || Array.isArray(p.locator) || !stamp(p.updatedAt)) return false;
    const cfi = p.locator.cfi;
    if (cfi !== undefined && !(typeof cfi === 'string' && cfi.length <= READER_CFI_MAX_CHARS)) return false;
    return Buffer.byteLength(JSON.stringify({ ...p, locator: { ...p.locator, cfi: '' } }), 'utf8') <= BOOK_PLACE_REST_MAX_BYTES;
  }

  function sessionOf(req) {
    const sid = req.body && req.body.session;
    return typeof sid === 'string' && sid.length <= START_OVER_ID_MAX ? userStore.getFeedSession(req.user.id, sid) : null;
  }

  app.post('/api/feed/start-over', (req, res) => {
    const body = req.body || {};
    if (!START_OVER_KINDS.includes(body.kind) || !plainId(body.id)) return refuse(res, safe.REASONS.INVALID);
    const session = sessionOf(req);
    if (!session) return res.status(404).json({ error: 'no such session' });
    if (!visibleItem(req, body.kind, body.id)) return res.status(404).json({ error: 'not found' });
    const userId = req.user.id;
    const previous = placeOf(userId, body.kind, body.id);
    if (nothingToForget(body.kind, previous)) return refuse(res, 'nothing');
    // gate r2: never forget a place Undo could not put back exactly (a stored place of an unusual shape, e.g. one a backup
    // brought in): refused before anything is recorded or reset
    if (!validRecordedPlace(body.kind, previous)) return refuse(res, 'unrestorable');
    const token = crypto.randomBytes(12).toString('hex');
    const at = new Date().toISOString();
    try {
      // the record FIRST: what is about to be forgotten is kept before anything is reset
      if (!userStore.appendFeedSessionMove(userId, session.id, { kind: body.kind, id: body.id, startOver: true, token, from: previous, to: null, at })) {
        return res.status(404).json({ error: 'no such session' });
      }
      if (body.kind === KIND.MEDIA) {
        mediaDeps.pendingProgress.delete(pendingProgressKey(userId, body.id)); // a staged ping would resurrect the place at the next flush
        userStore.removeHistory(userId, body.id); // the existing "remove from history": progress + watched, one transaction
      } else if (body.kind === KIND.PODCAST) {
        userStore.resetPodcastPlace(userId, body.id);
      } else {
        pendingBookProgress.delete(pendingProgressKey(userId, body.id));
        userStore.resetBookPlace(userId, body.id);
      }
    } catch (err) {
      return res.status(500).json({ error: 'start over failed', detail: err && err.code ? err.code : undefined });
    }
    // the card plays again from the start as a NEW item (the one-minute rule, bounded since this reset); a book's card
    // cannot write at all (a new card is served from the beginning next time)
    if (body.kind === KIND.BOOK) feedServed.forget(userId, KIND.BOOK, body.id);
    else feedServed.markReset(userId, body.kind, body.id, session.id);
    // v1.383.0 (K3 a): a book card shows the place the reset left - its first real chapter (the v1.380.0 rule) - at once. Before,
    // the card kept the old pages ("the card stayed at chapter 6, though in the book view it's properly started over"): only its
    // labels changed. Text to read, never a place: the card that started over can write nothing (its serve was just forgotten).
    const reset = body.kind === KIND.BOOK ? bookResetPages(visibleItem(req, KIND.BOOK, body.id)) : undefined;
    res.json({ ok: true, token, previous, at, ...(reset ? { reset } : {}) });
  });

  // The pages a started-over book opens on: the first real chapter's opening, labelled as the book names it. Null when the
  // file cannot be read (the card then keeps its pages and says it starts over; the reset itself already happened).
  function bookResetPages(book) {
    if (!book) return null;
    try {
      const opened = booksExcerpt.openEpubBook(fs, book);
      if (!opened) return null;
      const first = booksExcerpt.firstRealChapter(opened, book.spine);
      const labelOf = booksExcerpt.chapterLabeler(opened, book.spine);
      const ex = booksExcerpt.collectExcerpt({ loadBlocks: (si) => opened.loadBlocks(si), spineCount: opened.spineCount, spineIndex: first.spineIndex, blockIndex: 0, targetWords: booksExcerpt.DEFAULT_EXCERPT_WORDS, labelOf });
      if (!ex.blocks.length || !ex.start) return null;
      return { start: ex.start, chapterLabel: labelOf(ex.start.spineIndex), blocks: ex.blocks, words: ex.words, next: ex.next, atEnd: ex.atEnd };
    } catch {
      return null;
    }
  }

  // v1.383.0 (K7 c, the v1.381.0 gate's suggestion): the confirm names the place that is STORED, read just before it opens -
  // the card only knows the place it was served from, and another device may have moved it since (the toast already named the
  // stored one: the two could disagree). Read-only; the same kind / id checks and the same neutral 404 for a missing and a
  // hidden item as the reset. `nothing` = the reset would be refused as having nothing to forget. A book's place is named by
  // its chapter as the book calls it (chapterLabeler), '' when that cannot be told.
  app.get('/api/feed/start-over/place', (req, res) => {
    const kind = req.query.kind;
    const id = req.query.id;
    if (!START_OVER_KINDS.includes(kind) || !plainId(id)) return refuse(res, safe.REASONS.INVALID);
    const item = visibleItem(req, kind, id);
    if (!item) return res.status(404).json({ error: 'not found' });
    const place = placeOf(req.user.id, kind, id);
    const out = { ok: true, kind, id, nothing: nothingToForget(kind, place) };
    if (kind === KIND.MEDIA) out.sec = place.progress ? Number(place.progress.timestamp) || 0 : 0;
    else if (kind === KIND.PODCAST) out.sec = place.progress ? Number(place.progress.position) || 0 : 0;
    else {
      out.chapterLabel = '';
      out.finished = place.finished;
      try {
        const opened = place.progress ? booksExcerpt.openEpubBook(fs, item) : null;
        const pos = opened ? booksExcerpt.resolveLocatorPosition(place.progress.locator, opened.loadXhtml) : null;
        if (pos) out.chapterLabel = booksExcerpt.chapterLabeler(opened, item.spine)(pos.spineIndex);
      } catch { /* unreadable: the confirm names the book without a chapter */ }
    }
    res.json(out);
  });

  app.post('/api/feed/start-over/undo', (req, res) => {
    const body = req.body || {};
    if (typeof body.token !== 'string' || !/^[0-9a-f]{24}$/.test(body.token)) return refuse(res, safe.REASONS.INVALID);
    const session = sessionOf(req);
    if (!session) return res.status(404).json({ error: 'no such session' });
    const moves = session.summary && Array.isArray(session.summary.moves) ? session.summary.moves : [];
    const rec = moves.find((m) => m && m.startOver === true && m.token === body.token);
    if (!rec || !START_OVER_KINDS.includes(rec.kind) || !plainId(rec.id)) return res.status(404).json({ error: 'no such start over' });
    if (rec.undoneAt) return refuse(res, 'undone');
    if (!visibleItem(req, rec.kind, rec.id)) return res.status(404).json({ error: 'not found' });
    const userId = req.user.id;
    // compare-and-set: only a place still as the reset left it is restored - one played since (here or on another
    // device) is the newer truth, and the record stays for a manual recovery
    if (!stillAsReset(userId, rec.kind, rec.id)) return refuse(res, 'moved');
    if (!validRecordedPlace(rec.kind, rec.from)) return refuse(res, 'invalid-record');
    const prev = rec.from;
    try {
      if (rec.kind === KIND.MEDIA) userStore.restoreMediaPlace(userId, rec.id, prev);
      else if (rec.kind === KIND.PODCAST) userStore.restorePodcastPlace(userId, rec.id, prev);
      else userStore.restoreBookPlace(userId, rec.id, prev);
      userStore.setFeedSessionMoves(userId, session.id, moves.map((m) => (m === rec ? { ...m, undoneAt: new Date().toISOString() } : m)));
    } catch (err) {
      return res.status(500).json({ error: 'undo failed', detail: err && err.code ? err.code : undefined });
    }
    // the card continues from the restored place (served from its restored stamp); a book's next card is served anew
    if (rec.kind === KIND.BOOK) feedServed.forget(userId, KIND.BOOK, rec.id);
    else feedServed.mark(userId, rec.kind, rec.id, prev.progress && typeof prev.progress.updatedAt === 'string' ? prev.progress.updatedAt : '', session.id, false);
    res.json({ ok: true, kind: rec.kind, id: rec.id, previous: prev });
  });
}

module.exports = { registerProgressRoutes, KIND };
