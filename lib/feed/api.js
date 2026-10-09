'use strict';

// lib/feed/api.js - v1.379.0 Feed mode: the feed itself (plan D3, D6-D9) and the
// session record (D13).
//
//   POST /api/feed/sessions                { plannedMin }      start a session (10 / 20 / 30 min)
//   GET  /api/feed/sessions/week                               "This week: 1 h 20 min in Feed, 5 sessions"
//   POST /api/feed/sessions/:id/extend                         "Another 10 minutes" (deliberate; counted)
//   POST /api/feed/sessions/:id/finish     { actualSec, summary }  the recap, as counted by the client
//   GET  /api/feed?session=&count=&exclude=                    the next batch of cards
//
// Cards are built SERVER-side from the viewer's VISIBLE items only - every candidate
// passes the kind's own visibility gate (bookVisibleTo, mediaVisibleTo,
// podcastEpisodeVisibleTo, trackVisibleTo) before it can be picked, so a restricted
// member's feed can never carry a title they may not see (plan falsifier D3: zero
// over 500 cards). The mix is lib/feed/mix.js (weights 30/30/20/10/10, a kind with
// nothing left drops out, never the same kind twice in a row). What a session has
// shown is excluded two ways that agree (LESSONS 5, v1.368's lesson: the picker and
// the client must share one knowledge of the session): the client's `exclude` list
// (what it SHOWED) and the server's per-session served set (what it SENT). When
// nothing new is left, `exhausted` is true and the pools refill (the card says
// "You're through everything new").
//
// A BOOK card is "the next pages", so a book is not an item shown once: the session
// keeps a cursor per book (the position after the last excerpt it served) and the
// next book card continues from the further of the stored place and that cursor,
// until the book runs out of text. Every other kind is an item shown once per session.
//
// v1.380.0 (Dean, after his first Feed session): an UNSTARTED book is a "Start something new" card (cover,
// title, author, the book's own description, an optional taste from the FIRST REAL CHAPTER); serving it
// writes nothing and reading it never starts the book - only a "Start reading" tap does, through the same
// forward-only POST as any move. At most one per session. A video / episode the viewer has not started is
// `fresh` ("New from <channel>" / "New episode of <show>"); the mix holds fresh cards to about one per two
// continuing ones (lib/feed/mix.js) and a fresh card writes nothing until a minute of actual playback
// (lib/feed/safe-progress.js, public/js/player.js).
//
// Serving a card MARKS the stored position it was built from (lib/feed/served.js,
// with the session id), which is what later lets the feed move that place forward
// from exactly that record (lib/feed/routes.js, plan D5). Songs carry no D5 rule
// (a song card plays the whole song; its progress is music's own).

const crypto = require('node:crypto');
const mix = require('./mix');

const PODCAST_SLICE_SEC = 240; // D6: a 4-minute slice
const VIDEO_SEGMENT_SEC = 180; // D7: a 3-minute segment when a video has no chapters
const NEW_BOOK_TASTE_WORDS = 200; // v1.380.0: the optional "Read the opening" taste on a new-book card
const MAX_EXCLUDE_IDS = 600;
const SESSION_SERVED_CAP = 600;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function nowIso(now) { return new Date(now()).toISOString(); }

function clampCount(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 20) : 5;
}

// The chapter a saved position is in: the last chapter whose start is at or before it.
function chapterSliceFor(chapters, positionSec, durationSec) {
  const list = Array.isArray(chapters) ? chapters.filter((c) => c && Number.isFinite(Number(c.startTime))).slice().sort((a, b) => Number(a.startTime) - Number(b.startTime)) : [];
  const pos = Number.isFinite(positionSec) && positionSec > 0 ? positionSec : 0;
  if (list.length >= 2) {
    let idx = 0;
    for (let i = 0; i < list.length; i++) if (Number(list[i].startTime) <= pos) idx = i;
    const start = Math.max(pos, Number(list[idx].startTime));
    const end = idx + 1 < list.length ? Number(list[idx + 1].startTime) : (Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null);
    return { startAt: start, endAt: end, chapter: { index: idx, count: list.length, title: typeof list[idx].title === 'string' ? list[idx].title : '' } };
  }
  const end = Number.isFinite(durationSec) && durationSec > 0 ? Math.min(durationSec, pos + VIDEO_SEGMENT_SEC) : pos + VIDEO_SEGMENT_SEC;
  return { startAt: pos, endAt: end, chapter: null };
}

// v1.380.0 (R5, D8): a FRESH video that opens with a short intro / sponsor / ad chapter starts at the
// chapter after it. Pure over the chapter list: returns the start of chapter 2, or null (no skip) unless
// the first chapter's title says intro-ish (whole word, any case, or a bare "0:00") AND the chapter is
// shorter than INTRO_MAX_SEC. Never for a card the viewer has a place in (the caller passes fresh only
// with no stored position).
const INTRO_MAX_SEC = 180;
const INTRO_TITLE_RX = /\b(intro|introduction|opening|sponsor|sponsors|sponsored|ad|ads|advert|advertisement)\b|^\s*0?0:00\s*$/i;
function introSkipTarget(chapters) {
  const list = Array.isArray(chapters) ? chapters.filter((c) => c && Number.isFinite(Number(c.startTime))).slice().sort((a, b) => Number(a.startTime) - Number(b.startTime)) : [];
  if (list.length < 2) return null;
  const first = list[0];
  const second = list[1];
  if (typeof first.title !== 'string' || !INTRO_TITLE_RX.test(first.title)) return null;
  const len = Number(second.startTime) - Number(first.startTime);
  if (!(len > 0 && len < INTRO_MAX_SEC)) return null;
  return Number(second.startTime);
}

// The stored place as served: a book card is served from it once; the place moving (any
// writer) serves the book again from the new place.
function bookPlaceStamp(prog) {
  return prog ? String(prog.updatedAt || '') + '|' + JSON.stringify(prog.locator || null) : '';
}

function registerFeedRoutes(app, deps) {
  const {
    booksDb,
    booksExcerpt,
    bookVisibleTo,
    effectiveBookProgress,
    effectiveProgress,
    feedServed,
    fs,
    getCachedDatabase,
    mediaVisibleTo,
    musicDb,
    now, // injectable clock
    podcastEpisodeVisibleTo,
    podcastsDb,
    publicTrackListItem,
    resolveItemChapters,
    rng, // injectable randomness (tests pass a seeded one)
    trackVisibleTo,
    userStore,
    videoQuery,
    ytdlpDb,
  } = deps;

  // Per-session picker state (credit, last kind, what this process already sent),
  // in memory and bounded by COUNT (500 sessions; the least recently used is evicted,
  // finished ones first): a restart only forgets which cards were sent (the client's
  // `exclude` still holds), never a stored position.
  const sessionState = new Map(); // sessionId -> { credit, lastKind, served:Set, exhausted:boolean, at }
  function stateFor(sessionId) {
    let st = sessionState.get(sessionId);
    if (!st) {
      st = { credit: {}, lastKind: null, served: new Set(), bookServed: new Map(), bookDone: new Set(), bookTurn: new Map(), turns: 0, newBookServed: false, mediaMix: { fresh: 0, cont: 0 }, at: now() };
      sessionState.set(sessionId, st);
      if (sessionState.size > 500) {
        // evict the least recently used state (a finished session's `at` is 0: those go first)
        let oldestKey = null;
        let oldestAt = Infinity;
        for (const [k, v] of sessionState) if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; }
        if (oldestKey !== null) sessionState.delete(oldestKey);
      }
    }
    st.at = now();
    return st;
  }

  function ownSession(req, res) {
    const id = String(req.params.id || req.query.session || '');
    if (!userStore.FEED_SESSION_ID_RE.test(id)) { res.status(404).json({ error: 'No such session' }); return null; }
    const session = userStore.getFeedSession(req.user.id, id);
    if (!session) { res.status(404).json({ error: 'No such session' }); return null; }
    return session;
  }

  function weekSummary(userId) {
    const since = new Date(now() - WEEK_MS).toISOString();
    const rows = userStore.listFeedSessionsSince(userId, since);
    const totalSec = rows.reduce((s, r) => s + (Number.isInteger(r.actualSec) ? r.actualSec : 0), 0);
    return { sessions: rows.length, totalSec };
  }

  // ---- sessions (D13) ------------------------------------------------------------
  app.post('/api/feed/sessions', (req, res) => {
    const plannedMin = req.body && req.body.plannedMin;
    if (!userStore.FEED_SESSION_PLANNED_MIN.includes(plannedMin)) return res.status(400).json({ error: 'plannedMin must be 10, 20 or 30' });
    const id = crypto.randomBytes(8).toString('hex');
    const session = userStore.createFeedSession(req.user.id, { id, startedAt: nowIso(now), plannedMin });
    res.json({ session, week: weekSummary(req.user.id) });
  });

  app.get('/api/feed/sessions/week', (req, res) => {
    res.json(weekSummary(req.user.id));
  });

  app.post('/api/feed/sessions/:id/extend', (req, res) => {
    const session = ownSession(req, res);
    if (!session) return;
    if (session.extensions >= userStore.FEED_SESSION_MAX_EXTENSIONS) return res.status(409).json({ error: 'no more extensions today', extensions: session.extensions });
    const updated = userStore.updateFeedSession(req.user.id, session.id, { extensions: session.extensions + 1 });
    res.json({ session: updated });
  });

  app.post('/api/feed/sessions/:id/finish', (req, res) => {
    const session = ownSession(req, res);
    if (!session) return;
    const body = req.body || {};
    const actualSec = Number(body.actualSec);
    if (!Number.isInteger(actualSec) || actualSec < 0 || actualSec > userStore.FEED_SESSION_MAX_ACTUAL_SEC) return res.status(400).json({ error: 'actualSec must be a whole number of seconds' });
    let summary;
    if (body.summary === undefined) summary = undefined;
    else if (body.summary && typeof body.summary === 'object' && !Array.isArray(body.summary)) {
      if (Buffer.byteLength(JSON.stringify(body.summary), 'utf8') > userStore.FEED_SESSION_SUMMARY_MAX_BYTES) return res.status(400).json({ error: 'summary is too large' });
      if (Object.prototype.hasOwnProperty.call(body.summary, 'moves')) return res.status(400).json({ error: 'summary.moves is the server\'s' });
      summary = body.summary;
    } else return res.status(400).json({ error: 'summary must be an object' });
    const updated = userStore.updateFeedSession(req.user.id, session.id, { actualSec, summary });
    const st = sessionState.get(session.id);
    if (st) st.at = 0; // finished: the first to go when the picker-state map is full (stateFor's eviction)
    res.json({ session: updated, week: weekSummary(req.user.id) });
  });

  // D6: a video / audio item the viewer has not started: no stored position, or one below the "watching" floor
  // (the same floor the video pool's "in progress" uses). A watched one never reaches a pool.
  function mediaIsFresh(userId, item) {
    const p = effectiveProgress(userId, item.id);
    const ts = p ? Number(p.timestamp) : 0;
    const dur = (p && Number(p.duration) > 0) ? Number(p.duration) : Number(item.duration) || 0;
    const pct = dur > 0 ? (ts / dur) * 100 : 0;
    return videoQuery.deriveWatchState(pct, false) !== 'watching';
  }

  // ---- the feed (D3) ---------------------------------------------------------------
  app.get('/api/feed', (req, res) => {
    const session = ownSession(req, res);
    if (!session) return;
    const count = clampCount(req.query.count);
    const st = stateFor(session.id);
    const exclude = new Set(st.served);
    if (typeof req.query.exclude === 'string' && req.query.exclude !== '') {
      for (const id of req.query.exclude.split(',').slice(0, MAX_EXCLUDE_IDS)) if (id) exclude.add(id);
    }
    const userId = req.user.id;
    const db = getCachedDatabase();

    // ---- candidate pools, most-wanted first, VISIBLE only --------------------------
    // books (D4): currently reading (newest first), then liked unstarted; EPUB only
    const booksNs = booksDb.read();
    const finished = userStore.getBookFinished(userId);
    const bookLiked = new Set(userStore.getBookLiked(userId).map((l) => l.bookId));
    const reading = [];
    const likedUnstarted = [];
    const unstartedByAge = []; // v1.380.0: the newest added unstarted EPUBs (the new-book fallback)
    for (const book of Object.values(booksNs.items || {})) {
      if (!book || book.format !== 'epub' || !Array.isArray(book.spine) || book.spine.length === 0) continue;
      if (!bookVisibleTo(req, book)) continue;
      if (Object.prototype.hasOwnProperty.call(finished, book.id)) continue;
      const prog = effectiveBookProgress(userId, book.id);
      if (st.bookDone.has(book.id)) continue; // this session read it to the end
      // Gate r1 (adversary W1): the next pages come once these were READ. A book card the
      // user swiped past (no write) parks the book for the session until its place moves -
      // by the feed's write after the dwell, or by the reader - so a skipped card never puts
      // unread text behind the bookmark. The stamp is the stored place as it was served.
      if (st.bookServed.get(book.id) === bookPlaceStamp(prog)) continue;
      // a book with a place is being read until its end card latches finished (no percent bound: the
      // last pages are the ones the end card shows)
      if (prog) reading.push({ id: book.id, at: prog.updatedAt || '' });
      else if (bookLiked.has(book.id)) likedUnstarted.push({ id: book.id, at: '' });
      else unstartedByAge.push({ id: book.id, at: String(book.addedAt || '') });
    }
    reading.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    unstartedByAge.sort((a, b) => b.at.localeCompare(a.at));
    // D4: a book with no stored place is a NEW book. Liked unstarted ones first, and only when there are none the newest
    // added; ONE per session (a served one parks until its place moves, which is the "Start reading" tap).
    const newCandidates = st.newBookServed ? [] : (likedUnstarted.length ? likedUnstarted : unstartedByAge.slice(0, 1));
    // Books are not consumed (a book continues as its place moves), so the pool is rebuilt every
    // request: the session takes turns across books - least recently served first, the
    // reading-first order breaking ties - or the liked unstarted ones would never surface.
    const bookPool = reading.concat(newCandidates).map((r) => r.id)
      .map((id, i) => ({ id, i, turn: st.bookTurn.has(id) ? st.bookTurn.get(id) : -1 }))
      .sort((a, b) => (a.turn - b.turn) || (a.i - b.i))
      .map((r) => r.id);
    // One book is one card a batch (its next pages come once this card was read).
    const bookIds = new Set(bookPool);

    // D6 (v1.380.0): which media candidates are FRESH - the viewer has no stored place in them (a video below the
    // "watching" floor, an episode with no position). Keyed `${kind}:${id}`; the mix (D9) and the cards share it.
    const freshKeys = new Set();
    const isFresh = (kind, id) => freshKeys.has(`${kind}:${id}`);

    // videos (D7): in progress (0.5-90%, not watched), then new from subscriptions
    const ytView = ytdlpDb.holder(['subscriptions', 'channelAvatars']);
    const subNames = new Set((ytdlpDb.readPart('subscriptions') || []).map((s) => s && s.name).filter(Boolean));
    const watchedSet = new Set(userStore.getWatchedIds(userId));
    const inProgress = [];
    const fromSubs = [];
    const mediaById = new Map();
    for (const id of Object.keys(db.metadata || {})) {
      const item = db.metadata[id];
      if (!item || typeof item !== 'object' || item.type === 'audio') continue;
      if (!mediaVisibleTo(req, item)) continue;
      mediaById.set(id, item);
      const p = effectiveProgress(userId, id);
      const ts = p ? Number(p.timestamp) : 0;
      const dur = (p && Number(p.duration) > 0) ? Number(p.duration) : Number(item.duration) || 0;
      const pct = dur > 0 ? (ts / dur) * 100 : 0;
      const watched = watchedSet.has(id);
      const state = videoQuery.deriveWatchState(pct, watched);
      if (state === 'watched') continue;
      if (state === 'watching') inProgress.push({ id, at: (p && p.updatedAt) || '' });
      else if (item.folderName && (subNames.has(item.folderName) || subNames.has(item.channelName))) fromSubs.push({ id, at: typeof item.addedAt === 'number' ? item.addedAt : 0 });
    }
    inProgress.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    fromSubs.sort((a, b) => b.at - a.at);
    const videoPool = inProgress.concat(fromSubs).map((r) => r.id);
    for (const r of fromSubs) freshKeys.add(`video:${r.id}`);

    // podcasts (D6): in progress (newest first), then the newest unplayed downloaded episodes
    const podNs = podcastsDb.read();
    const podProgress = userStore.getPodcastProgress(userId);
    const podPlayed = userStore.getPodcastPlayed(userId);
    const subNameById = new Map((podNs.subscriptions || []).filter(Boolean).map((s) => [s.id, s.name]));
    const podInProgress = [];
    const podNew = [];
    for (const id of Object.keys(podNs.episodes || {})) {
      const ep = podNs.episodes[id];
      if (!ep || ep.status !== 'downloaded') continue;
      if (!podcastEpisodeVisibleTo(req, ep)) continue;
      if (Object.prototype.hasOwnProperty.call(podPlayed, id)) continue;
      const pp = Object.prototype.hasOwnProperty.call(podProgress, id) ? podProgress[id] : null;
      if (pp && Number(pp.position) > 0) podInProgress.push({ id, at: pp.updatedAt || '' });
      else podNew.push({ id, at: Number(ep.pubDateMs) || 0 });
    }
    podInProgress.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    podNew.sort((a, b) => b.at - a.at);
    const podcastPool = podInProgress.concat(podNew).map((r) => r.id);
    for (const r of podNew) freshKeys.add(`podcast:${r.id}`);

    // Watch later (D8): the user's list, in order; a video or a podcast episode; unfinished only
    const watchLaterPool = [];
    for (const key of userStore.getWatchLater(userId)) {
      const podId = userStore.watchLaterPodcastId(key);
      if (podId !== null) {
        const ep = Object.prototype.hasOwnProperty.call(podNs.episodes, podId) ? podNs.episodes[podId] : null;
        if (ep && ep.status === 'downloaded' && podcastEpisodeVisibleTo(req, ep) && !Object.prototype.hasOwnProperty.call(podPlayed, podId)) {
          watchLaterPool.push(key);
          const wpp = Object.prototype.hasOwnProperty.call(podProgress, podId) ? podProgress[podId] : null;
          if (!(wpp && Number(wpp.position) > 0)) freshKeys.add(`watchlater:${key}`);
        }
        continue;
      }
      const item = mediaById.get(key) || (Object.prototype.hasOwnProperty.call(db.metadata, key) ? db.metadata[key] : null);
      if (!item || !mediaVisibleTo(req, item) || watchedSet.has(key)) continue;
      watchLaterPool.push(key);
      if (mediaIsFresh(userId, item)) freshKeys.add(`watchlater:${key}`);
    }

    // songs (D9): liked, then recently played; shuffled
    const musicNs = musicDb.read();
    const songIds = new Set();
    for (const id of userStore.getMusicLiked(userId)) songIds.add(id);
    const musicProgress = userStore.getMusicProgress(userId);
    for (const id of Object.keys(musicProgress)) songIds.add(id);
    const songPool = [];
    for (const id of songIds) {
      const track = Object.prototype.hasOwnProperty.call(musicNs.tracks || {}, id) ? musicNs.tracks[id] : null;
      if (!track || !trackVisibleTo(req, track)) continue;
      songPool.push(id);
    }
    for (let i = songPool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [songPool[i], songPool[j]] = [songPool[j], songPool[i]]; }

    // Watch later rows are keyed like the lists they came from; a video or episode already
    // listed as a video / podcast card is still its own Watch later card (D8 labels it).
    let pools = { book: bookPool, video: videoPool, podcast: podcastPool, watchlater: watchLaterPool, song: songPool };
    const totalCandidates = Object.values(pools).reduce((s, p) => s + p.length, 0);
    for (const id of bookIds) exclude.delete(id); // a book continues (its cursor), it is never "already shown"
    pools = mix.applyExclusions(pools, exclude);
    let exhausted = false;
    if (Object.values(pools).every((p) => p.length === 0) && totalCandidates > 0) {
      // Through everything new: recycle (D3), excluding only what this batch would repeat at once.
      exhausted = true;
      pools = { book: bookPool, video: videoPool, podcast: podcastPool, watchlater: watchLaterPool, song: songPool };
      st.served = new Set();
    }
    const picked = mix.pickCards({ pools, count, rng, lastKind: st.lastKind, credit: st.credit, isFresh, mediaMix: st.mediaMix });
    st.lastKind = picked.lastKind;

    // ---- hydrate the picks into cards (visibility was decided above) -----------------
    const cards = [];
    for (const pick of picked.picks) {
      const card = hydrate(req, pick, { db, booksNs, podNs, musicNs, podProgress, subNameById, ytView, st, isFresh });
      if (!card) continue; // a book that ran out of text, a vanished file: skipped, never an error
      cards.push(card);
      if (pick.kind !== 'book') st.served.add(pick.id);
      if (st.served.size > SESSION_SERVED_CAP) st.served.delete(st.served.values().next().value);
    }
    res.json({ cards, exhausted: exhausted || picked.exhausted, session: session.id });
  });

  // v1.380.0 (R4, D5): the "Start something new" card for a book with no stored place. It carries the cover, the
  // title, the author, the book's own description (plain text, capped) and a TASTE: about NEW_BOOK_TASTE_WORDS words
  // from the first real chapter (lib/books/excerpt.js firstRealChapter). Serving it writes NOTHING: no `next` and
  // no dwell, so the view's read-moves-the-bookmark path never fires for it (`newBook: true`). Its `start` is where a
  // "Start reading" tap moves the place to, through the SAME forward-only, served-and-not-stale POST as any move.
  function hydrateNewBook(req, book, opened, stamp, ctx) {
    const first = booksExcerpt.firstRealChapter(opened, book.spine);
    const ex = booksExcerpt.collectExcerpt({ loadBlocks: (si) => opened.loadBlocks(si), spineCount: opened.spineCount, spineIndex: first.spineIndex, blockIndex: 0, targetWords: NEW_BOOK_TASTE_WORDS });
    if (ex.blocks.length === 0) { ctx.st.bookDone.add(book.id); return null; } // nothing readable to start: skipped, never an error
    ctx.st.bookServed.set(book.id, stamp);
    ctx.st.newBookServed = true; // at most one new book a session
    ctx.st.bookTurn.set(book.id, ctx.st.turns++);
    feedServed.mark(req.user.id, 'book', book.id, '', req.query.session);
    const info = opened.packageInfo();
    return {
      kind: 'book', newBook: true, id: book.id, title: book.title, author: book.author || '', coverUrl: book.hasCover ? `/bookcover/${encodeURIComponent(book.id)}` : null,
      description: info.description || '', readerHref: `/read.html?b=${encodeURIComponent(book.id)}`,
      chapterLabel: `Chapter ${ex.start.spineIndex + 1} of ${opened.spineCount}`, spineCount: opened.spineCount, start: ex.start,
      startRule: first.rule, blocks: ex.blocks, words: ex.words, dwellSec: booksExcerpt.bookDwellSeconds(ex.words), next: null, atEnd: false,
    };
  }

  function hydrate(req, pick, ctx) {
    const userId = req.user.id;
    if (pick.kind === 'book') {
      const book = ctx.booksNs.items[pick.id];
      let opened;
      try { opened = booksExcerpt.openEpubBook(fs, book); } catch { opened = null; }
      if (!opened) return null;
      const stored = effectiveBookProgress(userId, book.id) || null;
      const stamp = bookPlaceStamp(stored);
      if (ctx.st.bookServed.get(book.id) === stamp) return null; // served from this very place already (parked until it moves)
      const pos = stored ? booksExcerpt.resolveLocatorPosition(stored.locator, opened.loadXhtml) : null;
      if (stored && !pos) return null; // an unresolved place is never served from (and never moved)
      if (!stored) return hydrateNewBook(req, book, opened, stamp, ctx);
      // From the saved place, always: "the next pages" come once these were read (the dwell
      // write moves the place; the next card of this book then starts there).
      const start = pos || { spineIndex: 0, blockIndex: 0 };
      const ex = booksExcerpt.collectExcerpt({ loadBlocks: (si) => opened.loadBlocks(si), spineCount: opened.spineCount, spineIndex: start.spineIndex, blockIndex: start.blockIndex, targetWords: booksExcerpt.DEFAULT_EXCERPT_WORDS });
      if (ex.blocks.length === 0) { ctx.st.bookDone.add(book.id); return null; }
      ctx.st.bookServed.set(book.id, stamp);
      if (!ex.next) ctx.st.bookDone.add(book.id); // nothing readable after this card: done for the session
      ctx.st.bookTurn.set(book.id, ctx.st.turns++);
      feedServed.mark(userId, 'book', book.id, stored ? stored.updatedAt : '', req.query.session);
      return {
        kind: 'book', id: book.id, title: book.title, author: book.author || '', coverUrl: book.hasCover ? `/bookcover/${encodeURIComponent(book.id)}` : null,
        readerHref: `/read.html?b=${encodeURIComponent(book.id)}`, chapterLabel: `Chapter ${(ex.start || start).spineIndex + 1} of ${opened.spineCount}`,
        spineCount: opened.spineCount, start: ex.start || start, blocks: ex.blocks, words: ex.words, dwellSec: booksExcerpt.bookDwellSeconds(ex.words), next: ex.next, atEnd: ex.atEnd,
      };
    }
    if (pick.kind === 'song') {
      const track = ctx.musicNs.tracks[pick.id];
      if (!track) return null;
      return { kind: 'song', id: track.id, track: publicTrackListItem(track, userId) };
    }
    // video / podcast / watchlater
    const isWatchLater = pick.kind === 'watchlater';
    const podId = isWatchLater ? userStore.watchLaterPodcastId(pick.id) : (pick.kind === 'podcast' ? pick.id : null);
    if (podId !== null) {
      const ep = ctx.podNs.episodes[podId];
      if (!ep) return null;
      const pp = Object.prototype.hasOwnProperty.call(ctx.podProgress, podId) ? ctx.podProgress[podId] : null;
      const position = pp && Number(pp.position) > 0 ? Number(pp.position) : 0;
      const durationSec = Number(ep.durationSec) || (pp && Number(pp.duration)) || 0;
      const podFresh = position <= 0;
      feedServed.mark(userId, 'podcast', podId, pp ? pp.updatedAt : '', req.query.session, podFresh);
      return {
        kind: pick.kind, media: 'podcast', fresh: podFresh, id: podId, title: ep.title || 'Episode', showName: ctx.subNameById.get(ep.subId) || '', subId: ep.subId,
        artUrl: `/podcastart/${encodeURIComponent(ep.subId)}`, streamSrc: `/episode/${encodeURIComponent(podId)}`, durationSec, position,
        startAt: position, endAt: durationSec > 0 ? Math.min(durationSec, position + PODCAST_SLICE_SEC) : position + PODCAST_SLICE_SEC, sliceSec: PODCAST_SLICE_SEC,
        watchLater: isWatchLater, pubDateMs: ep.pubDateMs || null,
      };
    }
    const item = Object.prototype.hasOwnProperty.call(ctx.db.metadata, pick.id) ? ctx.db.metadata[pick.id] : null;
    if (!item) return null;
    const p = effectiveProgress(userId, item.id);
    const ts = p && Number(p.timestamp) > 0 ? Number(p.timestamp) : 0;
    const duration = Number(item.duration) || (p && Number(p.duration)) || 0;
    const chapters = resolveItemChapters(item).chapters;
    const fresh = mediaIsFresh(userId, item);
    // D8: a fresh item that has no place of its own opens after a short intro / sponsor / ad chapter
    const introEnd = fresh && ts === 0 && item.type !== 'audio' ? introSkipTarget(chapters) : null;
    const slice = chapterSliceFor(chapters, introEnd !== null ? introEnd : ts, duration);
    feedServed.mark(userId, 'media', item.id, p ? p.updatedAt : '', req.query.session, fresh);
    return {
      kind: pick.kind, media: item.type === 'audio' ? 'audio' : 'video', fresh, skippedIntro: introEnd !== null, id: item.id, title: item.title || item.name || '', channelName: item.channelName || item.folderName || '',
      duration, width: Number(item.width) || null, height: Number(item.height) || null, thumbnailUrl: `/thumbnail/${encodeURIComponent(item.id)}`,
      progress: ts, startAt: slice.startAt, endAt: slice.endAt, chapter: slice.chapter, watchLater: isWatchLater,
    };
  }
}

module.exports = { registerFeedRoutes, chapterSliceFor, introSkipTarget, INTRO_MAX_SEC, NEW_BOOK_TASTE_WORDS, PODCAST_SLICE_SEC, VIDEO_SEGMENT_SEC };
