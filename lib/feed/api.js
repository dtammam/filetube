'use strict';

// lib/feed/api.js - v1.379.0 Feed mode: the feed itself (plan D3, D6-D9) and the
// session record (D13).
//
//   POST /api/feed/sessions                { plannedMin }      start a session (10 / 20 / 30 min)
//   GET  /api/feed/sessions/week                               "This week: 1 h 20 min in Feed, 5 sessions"
//   POST /api/feed/sessions/:id/extend                         "Another 10 minutes" (deliberate; counted)
//   POST /api/feed/sessions/:id/finish     { actualSec, summary }  the recap, as counted by the client
//   GET  /api/feed?session=&count=&exclude=&fs=                the next batch of cards (fs: the Feed settings, v1.382.0)
//   POST   /api/feed/hidden        { kind, id }                  v1.382.0 (D11): "Hide this" - never served again
//   DELETE /api/feed/hidden        { kind, id }                  ...its Undo (and Settings > Feed's Unhide)
//   GET    /api/feed/hidden                                      the hidden items this viewer can see (Settings > Feed)
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
//
// v1.382.0 (plan 2026-10-10-feed-settings D2-D5): the viewer's Feed settings ride the request as `fs` (the synced
// ft-feed-settings value) and are read by public/js/feed-settings.js, the SAME reading Settings and the Feed use: every
// value is checked against its list and anything else is the default. A kind switched off has an empty pool (it is never
// served; the mix spreads its weight as for an empty kind). "Which items" filters a pool by the SAME fresh rule the labels
// use (New only = fresh, Continue only = not fresh; books: New = the Start something new card, Continue = a book with a
// place). "Where they start" = 'start' serves a Continue item from its beginning (`fromStart`); its saved place is never
// moved back by that (the forward-only write refuses it until the card passes the place). Reel / slice lengths replace the
// fixed 3 / 4 minutes: a video plays `reel` seconds from its start point (0 = the whole chapter, 2 min without chapters),
// an episode `slice` seconds.
//
// v1.382.0 (D11, Dean's ruling 2026-10-10: "Hide every kind"): "Hide this" adds the item to the SAME per-user list the home
// feed's "Hide from feed" uses (user_feed_hidden): a video / library audio item under its media id (so it leaves the modern
// home grid too, as there), an episode, a book or a song under its own kind's key (feedHiddenKey: `podcast:<id>`, `book:<id>`,
// `song:<id>` - the Watch later key's spelling for an episode); home and the You tab read media ids only, so those rows are the
// Feed's alone. A hidden item is never served. "Fewer from <channel / show / artist / author>" is the synced ft-feed-fewer
// list (read from the viewer's stored prefs, public/js/feed-settings.js): each matching candidate keeps its place with
// probability FEWER_WEIGHT (0.25, drawn once a session) and otherwise goes to the back of its pool, so it comes about a
// quarter as often until the rest of its kind runs out.

const crypto = require('node:crypto');
const mix = require('./mix');
const { freshNeedSec } = require('./safe-progress');
const feedSettings = require('../../public/js/feed-settings.js'); // v1.382.0: the ONE reading of the Feed settings (client and server)

const PODCAST_SLICE_SEC = feedSettings.DEFAULTS.slice; // v1.382.0 (D5): the default slice (2 min; was 4); the viewer picks 1 / 2 / 4
const VIDEO_SEGMENT_SEC = feedSettings.VIDEO_NO_CHAPTER_SEC; // v1.382.0 (D5): "Whole chapter" on a video without chapters = 2 min (was 3)
const VIDEO_REEL_SEC = feedSettings.DEFAULTS.reel; // v1.382.0 (D5): the default video reel, 60 s from the card's start point
const HIDE_KINDS = Object.freeze(['media', 'podcast', 'book', 'song']);
const FEWER_DRAWS_CAP = 5000; // the per-session Fewer from draws a session keeps (bounded memory)
const HIDE_ID_MAX = 256;

// v1.382.0 (D11): the user_feed_hidden key of an item is lib/auth/store.js feedHiddenKey (the ONE spelling: its purge and
// rekey paths carry it). And back: { kind, id } (a media id for an unprefixed key).
function parseFeedHiddenKey(key) {
  const k = String(key);
  for (const kind of ['podcast', 'book', 'song']) if (k.startsWith(kind + ':') && k.length > kind.length + 1) return { kind, id: k.slice(kind.length + 1) };
  return { kind: 'media', id: k };
}
// a plain id: a non-empty string under the cap with no control character (a NUL never reaches a write: LESSONS 9)
const plainHideId = (v) => typeof v === 'string' && v !== '' && v.length <= HIDE_ID_MAX && !Array.prototype.some.call(v, (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
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
function chapterSliceFor(chapters, positionSec, durationSec, segmentSec = VIDEO_SEGMENT_SEC) {
  const list = Array.isArray(chapters) ? chapters.filter((c) => c && Number.isFinite(Number(c.startTime))).slice().sort((a, b) => Number(a.startTime) - Number(b.startTime)) : [];
  const pos = Number.isFinite(positionSec) && positionSec > 0 ? positionSec : 0;
  if (list.length >= 2) {
    let idx = 0;
    for (let i = 0; i < list.length; i++) if (Number(list[i].startTime) <= pos) idx = i;
    const start = Math.max(pos, Number(list[idx].startTime));
    const end = idx + 1 < list.length ? Number(list[idx + 1].startTime) : (Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null);
    return { startAt: start, endAt: end, chapter: { index: idx, count: list.length, title: typeof list[idx].title === 'string' ? list[idx].title : '' } };
  }
  const end = Number.isFinite(durationSec) && durationSec > 0 ? Math.min(durationSec, pos + segmentSec) : pos + segmentSec;
  return { startAt: pos, endAt: end, chapter: null };
}

// v1.382.0 (D5): a video card's slice. `reelSec` > 0 = a reel of that many seconds from the start point (no chapter record:
// the card says "1:00 of this video"); 0 = "Whole chapter" (today's chapter slice; 2 min without chapters).
function videoSliceFor(chapters, positionSec, durationSec, reelSec) {
  if (!(Number(reelSec) > 0)) return chapterSliceFor(chapters, positionSec, durationSec);
  const pos = Number.isFinite(positionSec) && positionSec > 0 ? positionSec : 0;
  const end = Number.isFinite(durationSec) && durationSec > 0 ? Math.min(durationSec, pos + Number(reelSec)) : pos + Number(reelSec);
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
  // v1.381.0 (D10, Dean's ruling 2026-10-09): ALSO one with less than a minute played (freshNeedSec: the same minute a
  // fresh card must play before it writes; 80% of a clip under 75 s). Measured cause of "Continue" items never really
  // started: the watching floor is 0.5% (6 s of a 20-minute video) and an episode had no floor at all. It decides the
  // label, the mix's New / Continue balance AND the card's one-minute write guard (feedServed.mark ... fresh): a card under
  // a minute in writes nothing until it has played its minute. The stored place is read here, never changed.
  function mediaIsFresh(userId, item) {
    const p = effectiveProgress(userId, item.id);
    const ts = p ? Number(p.timestamp) : 0;
    const dur = (p && Number(p.duration) > 0) ? Number(p.duration) : Number(item.duration) || 0;
    const pct = dur > 0 ? (ts / dur) * 100 : 0;
    return videoQuery.deriveWatchState(pct, false) !== 'watching' || startedUnderAMinute(ts, dur);
  }

  // ---- the feed (D3) ---------------------------------------------------------------
  app.get('/api/feed', (req, res) => {
    const session = ownSession(req, res);
    if (!session) return;
    const count = clampCount(req.query.count);
    // v1.382.0 (D2-D5, D8): the settings as THIS request carries them (the next batch is the first to change)
    const fset = feedSettings.normalize(typeof req.query.fs === 'string' && req.query.fs.length <= feedSettings.SETTINGS_MAX_BYTES * 4 ? req.query.fs : null);
    const kindOn = (k) => fset.off.indexOf(k) === -1;
    const st = stateFor(session.id);
    const exclude = new Set(st.served);
    if (typeof req.query.exclude === 'string' && req.query.exclude !== '') {
      for (const id of req.query.exclude.split(',').slice(0, MAX_EXCLUDE_IDS)) if (id) exclude.add(id);
    }
    const userId = req.user.id;
    const db = getCachedDatabase();

    // v1.382.0 (D11): Hide this (never served) and Fewer from (a quarter as often), per candidate
    const hiddenKeys = new Set(userStore.getFeedHidden(userId));
    const prefs = userStore.getPrefs(userId) || {};
    const fewer = feedSettings.fewerSet(prefs[feedSettings.FEWER_KEY] ? prefs[feedSettings.FEWER_KEY].value : null);
    // the keep-or-hold-back draw is made ONCE per item a session: drawn again every batch, the held-back items pile up ahead of
    // the rest and a quarter of the pile comes out each batch, which evens the share out within a session (measured: 34 vs 46)
    const fewerKeeps = (key) => {
      if (!st.fewerKeep) st.fewerKeep = new Map();
      if (!st.fewerKeep.has(key)) {
        if (st.fewerKeep.size >= FEWER_DRAWS_CAP) st.fewerKeep.clear();
        st.fewerKeep.set(key, rng() < feedSettings.FEWER_WEIGHT);
      }
      return st.fewerKeep.get(key);
    };

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
      // v1.382.0 gate r1 (adversary W2): a hidden book leaves BEFORE the one new-book candidate is chosen (chosen after, a hidden
      // newest book took the slot and no other new book was ever offered)
      if (hiddenKeys.has(userStore.feedHiddenKey('book', book.id))) continue;
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
    // Fewer from (an author on the list) holds a candidate back here too, before the one slot is taken
    const authorHeldBack = (id) => fewer.size > 0 && fewer.has('author', (booksNs.items[id] && booksNs.items[id].author) || '') && !fewerKeeps(userStore.feedHiddenKey('book', id));
    const orderNew = (list) => list.filter((r) => !authorHeldBack(r.id)).concat(list.filter((r) => authorHeldBack(r.id)));
    const newCandidates = st.newBookServed ? [] : orderNew(likedUnstarted.length ? likedUnstarted : unstartedByAge).slice(0, 1); // ONE candidate: a batch can draw the book kind twice (gate r1, W1)
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
      if (state === 'watching') {
        inProgress.push({ id, at: (p && p.updatedAt) || '' });
        if (startedUnderAMinute(ts, dur)) freshKeys.add(`video:${id}`); // D10: a look, not a start
      }
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
      if (pp && Number(pp.position) > 0) {
        podInProgress.push({ id, at: pp.updatedAt || '' });
        if (startedUnderAMinute(Number(pp.position), Number(ep.durationSec) || Number(pp.duration) || 0)) freshKeys.add(`podcast:${id}`); // D10
      } else podNew.push({ id, at: Number(ep.pubDateMs) || 0 });
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
          if (!(wpp && Number(wpp.position) > 0) || startedUnderAMinute(Number(wpp.position), Number(ep.durationSec) || Number(wpp.duration) || 0)) freshKeys.add(`watchlater:${key}`);
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

    // v1.382.0 (D2, D3): a kind switched off serves nothing; "which items" keeps the New (fresh) or the Continue (not
    // fresh) candidates only, by the same rule the card labels use. Books: New = the one Start something new card, Continue
    // = a book with a place. Watch later is always Both (a list you chose); songs have no place.
    const which = (kind, pool, freshOf) => {
      if (!kindOn(kind)) return [];
      const w = fset.which[kind];
      if (w === 'new') return pool.filter((id) => freshOf(id));
      if (w === 'continue') return pool.filter((id) => !freshOf(id));
      return pool;
    };
    const newBookIds = new Set(newCandidates.map((r) => r.id));
    const bookPoolChosen = which('book', bookPool, (id) => newBookIds.has(id));
    const videoPoolChosen = which('video', videoPool, (id) => isFresh('video', id));
    const podcastPoolChosen = which('podcast', podcastPool, (id) => isFresh('podcast', id));
    const watchLaterChosen0 = kindOn('watchlater') ? watchLaterPool : [];
    const songChosen0 = kindOn('song') ? songPool : [];

    const mediaChannel = (id) => { const it = mediaById.get(id) || (Object.prototype.hasOwnProperty.call(db.metadata, id) ? db.metadata[id] : null); return it ? (it.channelName || it.folderName || '') : ''; };
    const showOf = (epId) => { const ep = Object.prototype.hasOwnProperty.call(podNs.episodes, epId) ? podNs.episodes[epId] : null; return ep ? (subNameById.get(ep.subId) || '') : ''; };
    const tune = (pool, keyOf, fewerOf) => {
      const kept = pool.filter((id) => !hiddenKeys.has(keyOf(id)));
      if (!fewer.size) return kept;
      const now = [];
      const later = [];
      for (const id of kept) {
        const f = fewerOf(id);
        if (f && fewer.has(f[0], f[1]) && !fewerKeeps(keyOf(id))) later.push(id); else now.push(id);
      }
      return now.concat(later);
    };
    const bookPoolTuned = tune(bookPoolChosen, (id) => userStore.feedHiddenKey('book', id), (id) => ['author', (booksNs.items[id] && booksNs.items[id].author) || '']);
    const videoPoolTuned = tune(videoPoolChosen, (id) => id, (id) => ['channel', mediaChannel(id)]);
    const podcastPoolTuned = tune(podcastPoolChosen, (id) => userStore.feedHiddenKey('podcast', id), (id) => ['show', showOf(id)]);
    // a Watch later row's key IS its hidden key (a media id, or `podcast:<episodeId>`)
    const watchLaterChosen = tune(watchLaterChosen0, (key) => key, (key) => { const pod = userStore.watchLaterPodcastId(key); return pod !== null ? ['show', showOf(pod)] : ['channel', mediaChannel(key)]; });
    const songChosen = tune(songChosen0, (id) => userStore.feedHiddenKey('song', id), (id) => ['artist', (musicNs.tracks[id] && musicNs.tracks[id].artist) || '']);

    // Watch later rows are keyed like the lists they came from; a video or episode already
    // listed as a video / podcast card is still its own Watch later card (D8 labels it).
    let pools = { book: bookPoolTuned, video: videoPoolTuned, podcast: podcastPoolTuned, watchlater: watchLaterChosen, song: songChosen };
    const totalCandidates = Object.values(pools).reduce((s, p) => s + p.length, 0);
    for (const id of bookIds) exclude.delete(id); // a book continues (its cursor), it is never "already shown"
    pools = mix.applyExclusions(pools, exclude);
    let exhausted = false;
    if (Object.values(pools).every((p) => p.length === 0) && totalCandidates > 0) {
      // Through everything new: recycle (D3), excluding only what this batch would repeat at once.
      exhausted = true;
      pools = { book: bookPoolTuned, video: videoPoolTuned, podcast: podcastPoolTuned, watchlater: watchLaterChosen, song: songChosen };
      st.served = new Set();
    }
    // D3: a New-only kind is outside the one-new-per-two-continuations balance (its cards are all new by choice)
    const mixKinds = mix.MEDIA_KINDS.filter((k) => !(fset.which[k] === 'new'));
    // v1.382.0 (D10): what the card's Like and Watch later start from (the viewer's own rows)
    const marks = {
      mediaLiked: new Set(userStore.getLiked(userId)),
      podLiked: new Set(userStore.getPodcastLiked(userId).map((l) => l.episodeId)),
      bookLiked,
      watchLater: new Set(userStore.getWatchLater(userId)),
    };
    const picked = mix.pickCards({ pools, count, rng, lastKind: st.lastKind, credit: st.credit, isFresh, mediaMix: st.mediaMix, mixKinds });
    st.lastKind = picked.lastKind;

    // ---- hydrate the picks into cards (visibility was decided above) -----------------
    const cards = [];
    for (const pick of picked.picks) {
      const card = hydrate(req, pick, { db, booksNs, podNs, musicNs, podProgress, subNameById, ytView, st, isFresh, fset, marks });
      if (!card) continue; // a book that ran out of text, a vanished file: skipped, never an error
      cards.push(card);
      if (pick.kind !== 'book') st.served.add(pick.id);
      if (st.served.size > SESSION_SERVED_CAP) st.served.delete(st.served.values().next().value);
    }
    res.json({ cards, exhausted: exhausted || picked.exhausted, session: session.id });
  });

  // ---- v1.382.0 (D11): Hide this, for every kind --------------------------------------------------------------------
  // The item must exist AND be visible to the viewer (the kind's own gate); a missing and a hidden item are one neutral 404,
  // never an oracle. The DELETE (Undo, Unhide) is idempotent with no existence gate - restoring an absent row is the desired
  // end state, the DELETE /api/feed-hidden/:id posture - but its key is built from a validated kind and id, never raw.
  function visibleForHide(req, kind, id) {
    const own = (obj) => (obj && Object.prototype.hasOwnProperty.call(obj, id) ? obj[id] : null);
    if (kind === 'media') { const it = own(getCachedDatabase().metadata); return it && typeof it === 'object' && mediaVisibleTo(req, it) ? { title: it.title || it.name || '', sub: it.channelName || it.folderName || '' } : null; }
    if (kind === 'podcast') { const ns = podcastsDb.read(); const ep = own(ns.episodes); if (!ep || !podcastEpisodeVisibleTo(req, ep)) return null; const sub = (ns.subscriptions || []).find((x) => x && x.id === ep.subId); return { title: ep.title || 'Episode', sub: sub ? sub.name || '' : '' }; }
    if (kind === 'book') { const b = own(booksDb.read().items); return b && bookVisibleTo(req, b) ? { title: b.title || '', sub: b.author || '' } : null; }
    const t = own(musicDb.read().tracks || {});
    return t && trackVisibleTo(req, t) ? { title: t.title || '', sub: t.artist || '' } : null;
  }
  function hideArgs(req, res) {
    const body = req.body || {};
    if (!HIDE_KINDS.includes(body.kind) || !plainHideId(body.id)) { res.status(400).json({ error: 'kind (media, podcast, book or song) and id required' }); return null; }
    return { kind: body.kind, id: body.id };
  }
  app.post('/api/feed/hidden', (req, res) => {
    const a = hideArgs(req, res);
    if (!a) return;
    if (!visibleForHide(req, a.kind, a.id)) return res.status(404).json({ error: 'not found' });
    userStore.addFeedHidden(req.user.id, userStore.feedHiddenKey(a.kind, a.id), new Date(now()).toISOString()); // ON CONFLICT DO NOTHING
    res.json({ ok: true, hidden: true, kind: a.kind, id: a.id });
  });
  app.delete('/api/feed/hidden', (req, res) => {
    const a = hideArgs(req, res);
    if (!a) return;
    userStore.removeFeedHidden(req.user.id, userStore.feedHiddenKey(a.kind, a.id));
    res.json({ ok: true, hidden: false, kind: a.kind, id: a.id });
  });
  // Settings > Feed "Hidden and fewer": every hidden row this viewer can STILL see, newest first, with a title to show;
  // one they cannot see any more (or that is gone) is skipped, never a leak.
  app.get('/api/feed/hidden', (req, res) => {
    const items = [];
    for (const key of userStore.getFeedHidden(req.user.id)) {
      const { kind, id } = parseFeedHiddenKey(key);
      const v = visibleForHide(req, kind, id);
      if (v) items.push({ kind, id, title: v.title, sub: v.sub });
    }
    res.json({ items });
  });

  // v1.380.0 (R4, D5): the "Start something new" card for a book with no stored place. It carries the cover, the
  // title, the author, the book's own description (plain text, capped) and a TASTE: about NEW_BOOK_TASTE_WORDS words
  // from the first real chapter (lib/books/excerpt.js firstRealChapter). Serving it writes NOTHING: no `next` and
  // no dwell, so the view's read-moves-the-bookmark path never fires for it (`newBook: true`). Its `start` is where a
  // "Start reading" tap moves the place to, through the SAME forward-only, served-and-not-stale POST as any move.
  function hydrateNewBook(req, book, opened, stamp, ctx) {
    if (ctx.st.newBookServed) return null; // belt and braces beside the one-candidate pool: never a second one in a session
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
      description: info.description || '', readerHref: `/read.html?b=${encodeURIComponent(book.id)}`, liked: ctx.marks.bookLiked.has(book.id),
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
      // From the saved place: "the next pages" come once these were read (the dwell
      // write moves the place; the next card of this book then starts there).
      // v1.382.0 (D4): "From the beginning" shows a started book from its first real chapter (the v1.380.0 rule). The place
      // is NOT moved back: the card's writes go through the same forward-only rule, which refuses any target before it.
      const fromStart = ctx.fset.where.book === 'start';
      const start = fromStart ? { spineIndex: booksExcerpt.firstRealChapter(opened, book.spine).spineIndex, blockIndex: 0 } : (pos || { spineIndex: 0, blockIndex: 0 });
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
        fromStart, liked: ctx.marks.bookLiked.has(book.id),
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
      const podFresh = position <= 0 || startedUnderAMinute(position, durationSec); // D10: under a minute in is New
      // v1.382.0 (D4, D5): the viewer's slice length; "From the beginning" starts a Continue episode at 0. A Watch later card
      // keeps its saved place: Watch later has no Where choice (D3: it is a list you chose, its own switch, D2)
      const sliceSec = ctx.fset.slice;
      const fromStart = !podFresh && !isWatchLater && ctx.fset.where.podcast === 'start';
      const startAt = fromStart ? 0 : position;
      const endAt = durationSec > 0 ? Math.min(durationSec, startAt + sliceSec) : startAt + sliceSec;
      feedServed.mark(userId, 'podcast', podId, pp ? pp.updatedAt : '', req.query.session, podFresh, endAt - startAt);
      return {
        kind: pick.kind, media: 'podcast', fresh: podFresh, fromStart, id: podId, title: ep.title || 'Episode', showName: ctx.subNameById.get(ep.subId) || '', subId: ep.subId,
        artUrl: `/podcastart/${encodeURIComponent(ep.subId)}`, streamSrc: `/episode/${encodeURIComponent(podId)}`, durationSec, position,
        startAt, endAt, sliceSec, reelSec: endAt - startAt, // a podcast slice is always a reel (D6)
        watchLater: isWatchLater, pubDateMs: ep.pubDateMs || null,
        liked: ctx.marks.podLiked.has(podId), inWatchLater: ctx.marks.watchLater.has(userStore.watchLaterKey('podcast', podId)),
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
    // v1.382.0 (D4): "From the beginning" plays a Continue item from 0 (its place stays; the forward-only write refuses a
    // move back); (D5) the viewer's reel length from the start point, or the whole chapter
    const fromStart = !fresh && !isWatchLater && ctx.fset.where.video === 'start'; // Watch later keeps its place (no Where choice)
    const slice = videoSliceFor(chapters, fromStart ? 0 : (introEnd !== null ? introEnd : ts), duration, ctx.fset.reel);
    // D6: only a REEL's length relaxes the one-minute guard (a chapter slice registers 0: gate r1, adversary W1)
    const reelSec = ctx.fset.reel > 0 ? slice.endAt - slice.startAt : 0;
    feedServed.mark(userId, 'media', item.id, p ? p.updatedAt : '', req.query.session, fresh, reelSec);
    return {
      kind: pick.kind, media: item.type === 'audio' ? 'audio' : 'video', fresh, fromStart, skippedIntro: introEnd !== null, id: item.id, title: item.title || item.name || '', channelName: item.channelName || item.folderName || '',
      duration, width: Number(item.width) || null, height: Number(item.height) || null, thumbnailUrl: `/thumbnail/${encodeURIComponent(item.id)}`,
      progress: ts, startAt: slice.startAt, endAt: slice.endAt, chapter: slice.chapter, watchLater: isWatchLater, reelSec,
      liked: ctx.marks.mediaLiked.has(item.id), inWatchLater: ctx.marks.watchLater.has(item.id),
    };
  }
}

// v1.381.0 (D10): a place with less than the started minute played (the fresh rule's own threshold) - shown as New.
function startedUnderAMinute(sec, durationSec) {
  const s = Number(sec);
  return Number.isFinite(s) && s > 0 && s < freshNeedSec(durationSec);
}

module.exports = { registerFeedRoutes, parseFeedHiddenKey, HIDE_KINDS, startedUnderAMinute, chapterSliceFor, videoSliceFor, introSkipTarget, INTRO_MAX_SEC, NEW_BOOK_TASTE_WORDS, PODCAST_SLICE_SEC, VIDEO_SEGMENT_SEC, VIDEO_REEL_SEC };
