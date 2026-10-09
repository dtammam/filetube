// FileTube Feed (v1.379.0) -- the /feed view module (lib/feed/shell.js serves the shell;
// the history.js / cleanup.js registered-view pattern). Plan docs/exec-plans/active/
// 2026-10-09-feed-mode.md, D1-D13.
//
// What it does: a length picker (10 / 20 / 30 min) starts a feed SESSION
// (POST /api/feed/sessions); the cards come in batches from GET /api/feed and stack
// in a full-height, scroll-snapping column, one card active at a time (the one at
// least 60% on screen). A book card is text; when it has been active long enough to
// read (its dwellSec) and the user moves on, the bookmark moves to the card's `next`
// through the feed's forward-only write (POST /api/feed/progress/book/:id). A
// podcast, video, Watch later or song card mounts the ONE shared player into its own
// slot and plays from the card's startAt; a slice ends at endAt (the card pauses and
// says so); leaving a card pauses it. Progress for those rides the player's own pings,
// pointed at the feed's forward-only routes by `progressEndpoint`.
//
// The session has a deadline (the pick, plus 10 minutes per deliberate extension): a thin ring
// in the corner fills with the time (tap it to read the minutes left); at time up the current
// card winds down (a slice to its end, at most 2 more minutes; a book card until moved on),
// playback stops, and a recap says where the time went, counted here from what actually
// happened. "Another 10 minutes" is a HOLD, not a tap (D10-D12).
//
// Pure helpers first (node:test-covered without a browser), then the view.

// ---- Pure helpers -----------------------------------------------------------------

var FEED_LENGTH_CHOICES = [10, 20, 30];
var FEED_LENGTH_KEY = 'ft-feed-minutes';
var FEED_SESSION_KEY = 'ft-feed-session'; // sessionStorage: the live session survives a dock-tap return
var FEED_BATCH = 5;
var FEED_PREFETCH_AHEAD = 2; // fetch the next batch when the active card is this close to the end
var FEED_KEEP_BEHIND = 3; // cards further behind the active one than this drop their heavy content
var FEED_ACTIVE_RATIO = 0.6;

function feedNormalizeMinutes(raw) {
  var n = parseInt(raw, 10);
  return FEED_LENGTH_CHOICES.indexOf(n) !== -1 ? n : 20;
}

// "This week: 1 h 20 min in Feed, 5 sessions" (plan D13). Nothing yet -> ''.
function feedWeekLine(week) {
  if (!week || !(Number(week.sessions) > 0)) return '';
  var sec = Math.max(0, Number(week.totalSec) || 0);
  var mins = Math.round(sec / 60);
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  var time = h > 0 ? (h + ' h' + (m > 0 ? ' ' + m + ' min' : '')) : (mins + ' min');
  var n = Number(week.sessions);
  return 'This week: ' + time + ' in Feed, ' + n + (n === 1 ? ' session' : ' sessions');
}

// m:ss for the "left" readout.
function feedClock(sec) {
  var s = Math.max(0, Math.round(Number(sec) || 0));
  var m = Math.floor(s / 60);
  var r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

// The kind label a card shows (its plain word; Watch later keeps its own name).
function feedKindLabel(card) {
  if (!card) return '';
  if (card.kind === 'watchlater') return 'Watch later';
  if (card.kind === 'book') return 'Book';
  if (card.kind === 'podcast') return 'Podcast';
  if (card.kind === 'song') return 'Song';
  if (card.kind === 'video') return card.media === 'audio' ? 'Audio' : 'Video';
  return '';
}

// Which mounted card is active: the one with the largest visible ratio at or above the
// floor; none when nothing crosses it (mid-swipe). Pure over [{index, ratio}].
function feedActiveIndex(ratios, floor) {
  var min = typeof floor === 'number' ? floor : FEED_ACTIVE_RATIO;
  var best = -1;
  var bestRatio = 0;
  (ratios || []).forEach(function (r) {
    if (r && r.ratio >= min && r.ratio > bestRatio) { best = r.index; bestRatio = r.ratio; }
  });
  return best;
}

// Should the next batch be fetched now? Yes when the active card is within
// FEED_PREFETCH_AHEAD of the last loaded one (or nothing is loaded yet).
function feedShouldPrefetch(activeIndex, loadedCount, ahead) {
  var a = typeof ahead === 'number' ? ahead : FEED_PREFETCH_AHEAD;
  if (loadedCount <= 0) return true;
  return activeIndex >= loadedCount - 1 - a;
}

// The ids a batch request excludes: everything shown so far except books (a book
// continues by its cursor on the server; it is never "already shown").
function feedExcludeIds(cards) {
  var out = [];
  var seen = {};
  (cards || []).forEach(function (c) {
    if (!c || c.kind === 'book' || c.kind === 'notice' || typeof c.id !== 'string') return;
    if (seen[c.id]) return;
    seen[c.id] = 1;
    out.push(c.id);
  });
  return out;
}

// The descriptor the shared player loads for a media card (player.js load(id, data)).
// Every kind starts at the card's startAt (an explicit start: no progress read, no resume
// prompt) and saves through the feed's forward-only route for its kind; a song saves to
// music's own route (no D5 rule for songs) and always starts from the top.
function feedPlayerDescriptor(card) {
  if (!card) return null;
  if (card.kind === 'song') {
    var t = card.track || {};
    return {
      type: 'audio',
      title: t.title || '',
      channelName: t.artist || '',
      folderName: t.artist || '',
      album: t.album || '',
      albumKey: t.albumKey || '',
      duration: Number(t.durationSec) || 0,
      artUrl: t.artUrl || ('/albumart/' + encodeURIComponent(t.artId || card.id) + (t.artV ? '?v=' + encodeURIComponent(t.artV) : '')),
      streamSrc: t.streamSrc || ('/track/' + encodeURIComponent(card.id)),
      progressEndpoint: t.progressEndpoint || '/api/music/progress',
      resumeMode: 'music',
      startAt: 0,
      autoAdvanceViaTrackNav: false,
      browseCtx: '',
      readerHref: '/feed',
    };
  }
  if (card.media === 'podcast') {
    return {
      type: 'audio',
      title: card.title || 'Episode',
      channelName: card.showName || '',
      folderName: card.showName || '',
      duration: Number(card.durationSec) || 0,
      artUrl: card.artUrl,
      streamSrc: card.streamSrc,
      progressEndpoint: '/api/feed/progress/podcast',
      resumeMode: 'podcast',
      subId: card.subId,
      startAt: Number(card.startAt) || 0,
      autoAdvanceViaTrackNav: false,
      browseCtx: '',
      readerHref: '/feed',
    };
  }
  return {
    type: card.media === 'audio' ? 'audio' : 'video',
    title: card.title || '',
    channelName: card.channelName || '',
    folderName: card.channelName || '',
    duration: Number(card.duration) || 0,
    width: card.width || undefined,
    height: card.height || undefined,
    progressEndpoint: '/api/feed/progress/media',
    resumeMode: null,
    startAt: Number(card.startAt) || 0,
    autoAdvanceViaTrackNav: false,
    browseCtx: '',
    readerHref: '/feed',
  };
}

// A book card counts as read when it was active for at least its dwellSec in total.
function feedBookRead(activeMs, dwellSec) {
  return (Number(activeMs) || 0) >= (Math.max(5, Number(dwellSec) || 0)) * 1000;
}

// ---- the session clock, the wind-down, the recap (plan D10-D12) ----------------------

var FEED_EXTEND_MIN = 10; // "Another 10 minutes"
var FEED_WIND_DOWN_CAP_SEC = 120; // at time up a playing slice gets at most this much more
var FEED_HOLD_MS = 1200; // the extension is a hold, not a tap
var FEED_WORDS_PER_PAGE = 250; // the recap's "pages": a printed page is about 250 words
var FEED_TIME_PEEK_MS = 3000; // tapping the ring shows the minutes left for this long

// The session's end: the pick plus 10 minutes per extension, from when it started. NaN for junk.
function feedDeadlineMs(startedAt, plannedMin, extensions) {
  var start = Date.parse(startedAt);
  if (!isFinite(start)) return NaN;
  return start + ((Number(plannedMin) || 0) + FEED_EXTEND_MIN * (Number(extensions) || 0)) * 60000;
}

// How much of the session has run, 0..1 (1 once the deadline has passed or the span is empty).
function feedRingFraction(nowMs, startMs, deadlineMs) {
  var span = deadlineMs - startMs;
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, (nowMs - startMs) / span));
}

function feedRemainingSec(nowMs, deadlineMs) {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

function feedEmptySummary() {
  return { cards: 0, books: {}, videos: {}, podcasts: {}, songs: 0, songIds: [] };
}

// Count ONE card's activity into the summary (mutated and returned). `activity`:
// { read } for a book (its dwell was met), { playedSec, done, ended } for a media card
// (seconds of the slice heard or seen, the slice reached its end, the file ended).
// A song counts once it ended or ran 30 s; a podcast is "finished" when its slice reached the
// episode's end; a chaptered video counts chapters whose slice finished, an unchaptered one
// its seconds. Nothing is counted from a card merely scrolled past.
function feedCountActivity(summary, card, activity) {
  var s = summary || feedEmptySummary();
  var a = activity || {};
  if (!card) return s;
  s.cards += 1;
  if (card.kind === 'book') {
    if (!a.read) return s;
    var b = s.books[card.id] || (s.books[card.id] = { title: card.title || 'a book', pages: 0, words: 0, cards: 0 });
    b.words += Number(card.words) || 0;
    b.cards += 1;
    b.pages = Math.max(b.cards, Math.round(b.words / FEED_WORDS_PER_PAGE));
    return s;
  }
  var played = Math.max(0, Number(a.playedSec) || 0);
  if (card.kind === 'song') {
    if (a.ended || played >= 30) { s.songs += 1; s.songIds.push(card.id); }
    return s;
  }
  if (played < 1 && !a.done) return s;
  if (card.media === 'podcast') {
    var p = s.podcasts[card.id] || (s.podcasts[card.id] = { title: card.title || 'an episode', sec: 0, durationSec: Number(card.durationSec) || 0, finished: false });
    p.sec += played;
    if (a.ended || (p.durationSec > 0 && (Number(card.startAt) || 0) + played >= p.durationSec - 1)) p.finished = true;
    return s;
  }
  var v = s.videos[card.id] || (s.videos[card.id] = { title: card.title || 'a video', chapters: 0, sec: 0, chaptered: !!card.chapter });
  v.sec += played;
  if (card.chapter && a.done) v.chapters += 1;
  return s;
}

function feedMinutesWord(sec) {
  var m = Math.round((Number(sec) || 0) / 60);
  return m < 1 ? 'under a minute' : m + ' min';
}

// "14 pages of Alpha", "2 chapters of V", "4 min of Ep" / "half of Ep" / "finished Ep", "3 songs".
function feedRecapLines(summary) {
  var s = summary || feedEmptySummary();
  var lines = [];
  Object.keys(s.books).forEach(function (id) {
    var b = s.books[id];
    lines.push(b.pages + (b.pages === 1 ? ' page' : ' pages') + ' of ' + b.title);
  });
  Object.keys(s.videos).forEach(function (id) {
    var v = s.videos[id];
    lines.push(v.chaptered && v.chapters > 0 ? v.chapters + (v.chapters === 1 ? ' chapter' : ' chapters') + ' of ' + v.title : feedMinutesWord(v.sec) + ' of ' + v.title);
  });
  Object.keys(s.podcasts).forEach(function (id) {
    var p = s.podcasts[id];
    var frac = p.durationSec > 0 ? p.sec / p.durationSec : 0;
    lines.push(p.finished ? 'finished ' + p.title : (frac >= 0.45 && frac <= 0.55 ? 'half of ' + p.title : feedMinutesWord(p.sec) + ' of ' + p.title));
  });
  if (s.songs > 0) lines.push(s.songs + (s.songs === 1 ? ' song' : ' songs'));
  return lines;
}

// "20 minutes", "30 minutes, extended once", "40 minutes, extended 2 times".
function feedRecapTitle(actualSec, extensions) {
  var m = Math.max(1, Math.round((Number(actualSec) || 0) / 60));
  var t = m + (m === 1 ? ' minute' : ' minutes');
  var e = Number(extensions) || 0;
  if (e === 1) t += ', extended once';
  else if (e > 1) t += ', extended ' + e + ' times';
  return t;
}

// The hold-to-confirm machine. state: { holding, since }. event: 'down' | 'up' | 'tick'.
// Returns { state, fired, progress }: fired once the hold has lasted holdMs; a release before
// that resets; progress is 0..1 for the button's fill.
function feedHoldStep(state, event, nowMs, holdMs) {
  var need = typeof holdMs === 'number' ? holdMs : FEED_HOLD_MS;
  var s = state || { holding: false, since: 0 };
  if (event === 'down') return { state: { holding: true, since: nowMs }, fired: false, progress: 0 };
  if (!s.holding) return { state: s, fired: false, progress: 0 };
  if (event === 'up') return { state: { holding: false, since: 0 }, fired: false, progress: 0 };
  var progress = Math.min(1, (nowMs - s.since) / need);
  if (progress >= 1) return { state: { holding: false, since: 0 }, fired: true, progress: 1 };
  return { state: s, fired: false, progress: progress };
}

// The counts a stored session carries (sessionStorage), shape-checked back into an empty summary:
// anything malformed is dropped, never thrown on.
function feedRestoreSummary(stored) {
  var s = feedEmptySummary();
  if (!stored || typeof stored !== 'object') return s;
  Object.keys(s).forEach(function (k) {
    var v = stored[k];
    if (Array.isArray(s[k])) { if (Array.isArray(v)) s[k] = v.filter(function (x) { return typeof x === 'string'; }); }
    else if (typeof s[k] === 'object') { if (v && typeof v === 'object' && !Array.isArray(v)) s[k] = v; }
    else if (typeof v === typeof s[k]) s[k] = v;
  });
  return s;
}

// What the session's finish carries (plan D13): the recap counts, bounded so the maximum (30 entries a
// kind, 60-char titles, ~8 KB) stays under the finish route's 16 KB cap (gate r1: 50 x 120 could pass it).
function feedSummaryPayload(summary, actualSec, extensions) {
  var s = summary || feedEmptySummary();
  var cap = function (obj, shape) { return Object.keys(obj).slice(0, 30).map(function (id) { return shape(id, obj[id]); }); };
  return {
    minutes: Math.round((Number(actualSec) || 0) / 60),
    cards: s.cards,
    extensions: Number(extensions) || 0,
    songs: s.songs,
    books: cap(s.books, function (id, b) { return { id: id, title: String(b.title).slice(0, 60), pages: b.pages, words: b.words }; }),
    videos: cap(s.videos, function (id, v) { return { id: id, title: String(v.title).slice(0, 60), chapters: v.chapters, sec: Math.round(v.sec) }; }),
    podcasts: cap(s.podcasts, function (id, p) { return { id: id, title: String(p.title).slice(0, 60), sec: Math.round(p.sec), finished: p.finished }; }),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FEED_LENGTH_CHOICES, FEED_LENGTH_KEY, FEED_SESSION_KEY, FEED_BATCH, FEED_PREFETCH_AHEAD, FEED_KEEP_BEHIND, FEED_ACTIVE_RATIO,
    FEED_EXTEND_MIN, FEED_WIND_DOWN_CAP_SEC, FEED_HOLD_MS, FEED_WORDS_PER_PAGE, FEED_TIME_PEEK_MS, feedRestoreSummary,
    feedNormalizeMinutes, feedWeekLine, feedClock, feedKindLabel, feedActiveIndex, feedShouldPrefetch, feedExcludeIds,
    feedPlayerDescriptor, feedBookRead,
    feedDeadlineMs, feedRingFraction, feedRemainingSec, feedEmptySummary, feedCountActivity, feedRecapLines, feedRecapTitle,
    feedHoldStep, feedSummaryPayload,
  };
}

// ---- The view -------------------------------------------------------------------------

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var controller = null;

  function readPref(key, fallback) { try { return window.localStorage.getItem(key) || fallback; } catch (_) { return fallback; } }
  function writePref(key, value) { try { window.localStorage.setItem(key, String(value)); } catch (_) { /* storage disabled */ } }
  function readSession() { try { return JSON.parse(window.sessionStorage.getItem(FEED_SESSION_KEY) || 'null'); } catch (_) { return null; } }
  function writeSession(s) { try { if (s) window.sessionStorage.setItem(FEED_SESSION_KEY, JSON.stringify(s)); else window.sessionStorage.removeItem(FEED_SESSION_KEY); } catch (_) { /* storage disabled */ } }
  function player() { return window.FileTube && window.FileTube.player; }
  function U() { return window.ui || null; }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function init(root) {
    controller = new AbortController();
    var signal = controller.signal;
    var picker = root.querySelector('#feed-picker');
    var choices = root.querySelector('#feed-picker-choices');
    var weekEl = root.querySelector('#feed-week');
    var emptyEl = root.querySelector('#feed-empty');
    var sessionEl = root.querySelector('#feed-session');
    var stack = root.querySelector('#feed-stack');
    var doneBtn = root.querySelector('#feed-done-btn');
    if (!picker || !stack) return;

    var session = null; // { id, plannedMin, startedAt }
    var cards = []; // the served cards, in order
    var cardEls = [];
    var activeIndex = -1;
    var loading = false;
    var fetchSeq = 0; // the request a trailing release belongs to (gate r2, qa S-R2-1)
    var refetchWanted = false; // a book write landed while a batch was in flight: fetch again when it lands (adversary P04)
    var exhaustedShown = false;
    var observer = null;
    var mediaEl = null; // the live media element while a media card plays
    var mediaCardIndex = -1;
    var bookActiveSince = 0; // ms clock when the active book card became active
    var bookActiveMs = {}; // card index -> accumulated active ms
    var bookWritten = {}; // card index -> true once the bookmark moved (or was refused)
    // the session clock (D10-D12)
    var summary = feedEmptySummary();
    var activity = {}; // card index -> { read, playedSec, done, ended }
    var counted = {}; // card index -> true once counted into the summary
    var deadlineMs = NaN;
    var extensions = 0;
    var tickTimer = null;
    var windingDown = false; // time is up: the current card finishes, nothing new starts
    var hardStopMs = NaN; // wind-down: a playing slice stops here at the latest
    var recapCtrl = null;
    var peekTimer = null;
    var ring = null;
    var timeEl = null;

    // ---- the picker -------------------------------------------------------------
    var last = feedNormalizeMinutes(readPref(FEED_LENGTH_KEY, '20'));
    FEED_LENGTH_CHOICES.forEach(function (min) {
      var btn = U() ? U().button({ variant: min === last ? 'primary' : 'tonal', size: 'lg', pill: true, label: min + ' min', doc: document })
        : el('button', 'ui-btn ui-btn--tonal ui-btn--lg ui-btn--pill', min + ' min');
      btn.type = 'button';
      btn.setAttribute('data-minutes', String(min));
      btn.addEventListener('click', function () { startSession(min); }, { signal: signal });
      choices.appendChild(btn);
    });
    fetch('/api/feed/sessions/week', { signal: signal }).then(function (r) { return r.ok ? r.json() : null; }).then(function (week) {
      if (signal.aborted || !weekEl) return;
      weekEl.textContent = feedWeekLine(week);
    }).catch(function () { /* the line stays empty */ });

    // A live session (a dock-tap return, a reload) resumes its stack instead of asking again.
    var live = readSession();
    if (live && live.id) {
      session = live; extensions = Number(live.extensions) || 0;
      // gate r1 (adversary W3): the recap's counts ride the stored session - Open in reader, a dock tap or
      // back re-inits this view, and what was read before must still be in the recap
      summary = feedRestoreSummary(live.summary);
      showStack(); startClock(); fetchBatch();
    }

    function startSession(min) {
      writePref(FEED_LENGTH_KEY, min);
      fetch('/api/feed/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plannedMin: min }), signal: signal })
        .then(function (r) { if (!r.ok) throw new Error('session ' + r.status); return r.json(); })
        .then(function (body) {
          if (signal.aborted) return;
          session = { id: body.session.id, plannedMin: body.session.plannedMin, startedAt: body.session.startedAt, extensions: 0 };
          extensions = 0;
          writeSession(session);
          showStack();
          startClock();
          fetchBatch();
        })
        .catch(function () { if (U()) U().toast({ text: 'Could not start the feed', doc: document }); });
    }

    // D10: a thin ring in the corner fills with the time; no numbers unless tapped.
    function ensureRing() {
      var hud = root.querySelector('#feed-hud');
      if (!hud || ring) return;
      var NS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'feed-ring');
      svg.setAttribute('viewBox', '0 0 36 36');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      var track = document.createElementNS(NS, 'circle');
      track.setAttribute('class', 'feed-ring__track'); track.setAttribute('cx', '18'); track.setAttribute('cy', '18'); track.setAttribute('r', '16');
      var fill = document.createElementNS(NS, 'circle');
      fill.setAttribute('class', 'feed-ring__fill'); fill.setAttribute('cx', '18'); fill.setAttribute('cy', '18'); fill.setAttribute('r', '16'); fill.setAttribute('pathLength', '100');
      svg.appendChild(track); svg.appendChild(fill);
      // an icon button whose glyph is the ring itself (no registry icon: the svg below replaces the content)
      var btn = U() ? U().button({ variant: 'plain', shape: 'icon', ariaLabel: 'Time left', doc: document }) : el('button', 'ui-btn ui-btn--plain ui-btn--md ui-btn--icon');
      btn.type = 'button';
      btn.id = 'feed-ring-btn';
      btn.setAttribute('aria-label', 'Time left');
      btn.replaceChildren(svg);
      timeEl = el('span', 'feed-hud__time', '');
      timeEl.id = 'feed-time';
      timeEl.hidden = true;
      btn.addEventListener('click', function () {
        if (!timeEl) return;
        timeEl.textContent = feedClock(feedRemainingSec(Date.now(), deadlineMs)) + ' left';
        timeEl.hidden = false;
        if (peekTimer) window.clearTimeout(peekTimer);
        peekTimer = window.setTimeout(function () { if (timeEl) timeEl.hidden = true; }, FEED_TIME_PEEK_MS);
      }, { signal: signal });
      hud.insertBefore(timeEl, hud.firstChild);
      hud.insertBefore(btn, hud.firstChild);
      ring = fill;
    }

    function startClock() {
      if (!session) return;
      deadlineMs = feedDeadlineMs(session.startedAt, session.plannedMin, extensions);
      ensureRing();
      if (tickTimer) window.clearInterval(tickTimer);
      tick();
      tickTimer = window.setInterval(tick, 1000);
    }

    function tick() {
      if (!session) return;
      var now = Date.now();
      if (ring) ring.style.setProperty('--p', String(Math.round(feedRingFraction(now, Date.parse(session.startedAt), deadlineMs) * 1000) / 1000));
      if (!windingDown && now >= deadlineMs) beginWindDown(now);
      else if (windingDown && isFinite(hardStopMs) && now >= hardStopMs) finishNow();
    }

    // D11: time is up. A playing slice finishes (at most FEED_WIND_DOWN_CAP_SEC more), a book card
    // waits until it is moved on from, an empty stack ends at once. Nothing new is fetched: moving
    // on ends the session in setActive before its prefetch (gate r1, adversary M16: that is the one path).
    function beginWindDown(now) {
      windingDown = true;
      var card = cards[activeIndex];
      if (!card) { finishNow(); return; }
      if (card.kind === 'book') return; // until moved on (setActive -> finishNow)
      if (cardEls[activeIndex] && cardEls[activeIndex].hasAttribute('data-done')) { finishNow(); return; }
      hardStopMs = now + FEED_WIND_DOWN_CAP_SEC * 1000;
    }

    function showStack() {
      picker.hidden = true;
      sessionEl.hidden = false;
      if (!observer && typeof IntersectionObserver === 'function') {
        observer = new IntersectionObserver(onIntersect, { root: stack, threshold: [0, 0.25, FEED_ACTIVE_RATIO, 0.9] });
      }
    }

    // ---- batches ------------------------------------------------------------------
    function fetchBatch() {
      if (loading || !session) return;
      loading = true;
      var seq = ++fetchSeq;
      stack.setAttribute('aria-busy', 'true');
      var exclude = feedExcludeIds(cards);
      var url = '/api/feed?session=' + encodeURIComponent(session.id) + '&count=' + FEED_BATCH + (exclude.length ? '&exclude=' + exclude.map(encodeURIComponent).join(',') : '');
      fetch(url, { signal: signal })
        .then(function (r) {
          if (r.status === 404) { endSession(); throw new Error('session gone'); }
          if (!r.ok) throw new Error('feed ' + r.status);
          return r.json();
        })
        .then(function (body) {
          if (signal.aborted) return;
          if (!body.cards.length && !cards.length) {
            showEmpty();
            return;
          }
          body.cards.forEach(appendCard);
          if (body.exhausted && !exhaustedShown && cards.length) {
            exhaustedShown = true;
            // gate r1 (qa W3) + r2 (W-R2-2): a card of its own AFTER this batch's last new card - observed like any card, so the one
            // before it pauses when the notice fills the screen; never counted (countCard) and never excluded (feedExcludeIds)
            appendCard({ kind: 'notice', id: 'notice', title: '' });
          }
          loading = false; // gate r1 (qa S1): release the latch BEFORE the first activation, whose prefetch must be able to run
          stack.setAttribute('aria-busy', 'false');
          if (activeIndex < 0 && cardEls.length) setActive(0);
        })
        .catch(function () { /* a failed batch leaves the stack as it is; the next swipe retries */ })
        .then(function () {
          if (seq !== fetchSeq) return;
          loading = false;
          stack.setAttribute('aria-busy', 'false');
          if (refetchWanted && !signal.aborted) { refetchWanted = false; fetchBatch(); }
        });
    }

    function showEmpty() {
      sessionEl.hidden = true;
      picker.hidden = false;
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.replaceChildren(U() ? U().state({ icon: 'subject', title: 'Nothing to feed yet', body: 'Start a book, subscribe to a podcast or a channel, like a song: the feed is built from what you keep here.', doc: document })
          : el('p', 'feed-notice', 'Nothing to feed yet.'));
      }
      writeSession(null);
      session = null;
    }

    // ---- cards -------------------------------------------------------------------
    function appendCard(card) {
      var index = cards.length;
      cards.push(card);
      var node = el('article', 'feed-card');
      node.setAttribute('data-kind', card.kind);
      node.setAttribute('data-index', String(index));
      node.setAttribute('data-id', card.id);
      if (card.width && card.height && card.height > card.width) node.setAttribute('data-portrait', '');
      fillCard(node, card, index);
      stack.appendChild(node);
      cardEls.push(node);
      if (observer) observer.observe(node);
    }

    function fillCard(node, card, index) {
      node.replaceChildren();
      if (card.kind === 'notice') {
        node.classList.add('feed-card--notice');
        node.appendChild(el('p', 'feed-notice', 'You’re through everything new. From here the feed starts over.'));
        return;
      }
      node.appendChild(el('div', 'feed-card__kind', feedKindLabel(card)));
      node.appendChild(el('h3', 'feed-card__title', card.title || (card.track && card.track.title) || ''));
      var body = el('div', 'feed-card__body');
      if (card.kind === 'book') {
        node.appendChild(el('p', 'feed-card__meta', (card.author ? card.author + ' · ' : '') + (card.chapterLabel || '')));
        var text = el('div', 'feed-card__text');
        (card.blocks || []).forEach(function (b) {
          if (b.chapterStart && !b.heading) text.appendChild(el('div', 'feed-card__chapter-start', 'Chapter ' + (b.spineIndex + 1)));
          text.appendChild(el(b.heading ? 'h3' : 'p', null, b.text)); // text nodes only, never markup
        });
        if (card.atEnd) text.appendChild(el('p', 'feed-card__meta', 'The end.'));
        body.appendChild(text);
        node.appendChild(body);
        var actions = el('div', 'feed-card__actions');
        var open = U() ? U().button({ variant: 'tonal', size: 'sm', pill: true, icon: 'menu_book', label: 'Open in reader', doc: document })
          : el('button', 'ui-btn ui-btn--tonal ui-btn--sm ui-btn--pill', 'Open in reader');
        open.type = 'button';
        open.addEventListener('click', function () {
          // gate r1 (qa W1): the bookmark moves only if the card was READ (its dwell); a tap within
          // seconds of the card appearing must not move the place past text the reader is about to show
          finishBookCard(index, false);
          if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate(card.readerHref);
          else window.location.assign(card.readerHref);
        }, { signal: signal });
        actions.appendChild(open);
        actions.appendChild(el('span', 'feed-card__left', Math.ceil(Math.max(1, Number(card.words) || 0) / 250) + ' min read'));
        node.appendChild(actions);
        return;
      }
      if (card.kind === 'song') {
        var t = card.track || {};
        node.appendChild(el('p', 'feed-card__meta', [t.artist, t.album].filter(Boolean).join(' · ')));
        var art = el('img', 'feed-card__art');
        art.alt = '';
        art.src = t.artUrl || ('/albumart/' + encodeURIComponent(t.artId || card.id) + (t.artV ? '?v=' + encodeURIComponent(t.artV) : ''));
        body.appendChild(art);
        body.appendChild(el('div', 'feed-card__slot'));
        node.appendChild(body);
        node.appendChild(playActions(card, index, 'Whole song'));
        return;
      }
      // podcast / video / Watch later
      var isPod = card.media === 'podcast';
      node.appendChild(el('p', 'feed-card__meta', isPod ? (card.showName || '') : (card.channelName || '')));
      if (isPod) {
        var podArt = el('img', 'feed-card__art');
        podArt.alt = '';
        podArt.src = card.artUrl;
        body.appendChild(podArt);
      } else {
        var poster = el('img', 'feed-card__poster');
        poster.alt = '';
        poster.src = card.thumbnailUrl;
        body.appendChild(poster);
      }
      body.appendChild(el('div', 'feed-card__slot'));
      node.appendChild(body);
      var label = isPod ? feedClock((card.endAt || 0) - (card.startAt || 0)) + ' of this episode'
        : (card.chapter ? 'Chapter ' + (card.chapter.index + 1) + ' of ' + card.chapter.count + (card.chapter.title ? ': ' + card.chapter.title : '') : feedClock((card.endAt || 0) - (card.startAt || 0)) + ' of this video');
      node.appendChild(playActions(card, index, label));
    }

    function playActions(card, index, label) {
      var actions = el('div', 'feed-card__actions');
      actions.appendChild(el('span', 'feed-card__meta', label));
      var left = el('span', 'feed-card__left', '');
      left.setAttribute('data-left', '');
      actions.appendChild(left);
      return actions;
    }

    // Heavy content far behind the active card is dropped (the card keeps its height so the
    // scroll never jumps) and rebuilt when the user swipes back to it.
    function pruneBehind(active) {
      cardEls.forEach(function (node, i) {
        if (i < active - FEED_KEEP_BEHIND) {
          if (cards[i] && cards[i].kind === 'notice') return; // one line of text: nothing heavy to drop
          if (!node.hasAttribute('data-pruned')) { node.setAttribute('data-pruned', ''); node.replaceChildren(el('div', 'feed-card__kind', feedKindLabel(cards[i]))); }
        } else if (node.hasAttribute('data-pruned')) {
          node.removeAttribute('data-pruned');
          fillCard(node, cards[i], i);
        }
      });
    }

    // ---- the active card ---------------------------------------------------------
    var ratios = {};
    function onIntersect(entries) {
      entries.forEach(function (e) {
        var idx = Number(e.target.getAttribute('data-index'));
        ratios[idx] = e.isIntersecting ? e.intersectionRatio : 0;
      });
      var list = Object.keys(ratios).map(function (k) { return { index: Number(k), ratio: ratios[k] }; });
      var next = feedActiveIndex(list);
      if (next >= 0 && next !== activeIndex) setActive(next);
    }

    function setActive(index) {
      var prev = activeIndex;
      if (windingDown && prev >= 0 && index !== prev) { finishNow(); return; } // D11: moving on after time up ends the session
      if (prev >= 0 && cardEls[prev]) { cardEls[prev].removeAttribute('data-active'); leaveCard(prev); }
      activeIndex = index;
      var node = cardEls[index];
      var card = cards[index];
      if (!node || !card) return;
      node.setAttribute('data-active', '');
      if (card.kind === 'book') bookActiveSince = Date.now();
      else playCard(index);
      pruneBehind(index);
      if (feedShouldPrefetch(index, cards.length)) fetchBatch();
    }

    function leaveCard(index) {
      var card = cards[index];
      if (!card) return;
      if (card.kind === 'book') {
        if (bookActiveSince) bookActiveMs[index] = (bookActiveMs[index] || 0) + (Date.now() - bookActiveSince);
        bookActiveSince = 0;
        if (feedBookRead(bookActiveMs[index], card.dwellSec)) finishBookCard(index, false);
        countCard(index);
        return;
      }
      if (mediaCardIndex === index) pauseMedia();
      countCard(index);
    }

    // D12: the recap is built from what happened - each card counted once, when it is left.
    function countCard(index) {
      if (counted[index]) return;
      counted[index] = true;
      if (!cards[index] || cards[index].kind === 'notice') return; // the notice is not a card the user did anything with
      var a = activity[index] || {};
      if (cards[index] && cards[index].kind === 'book') a.read = !!bookWritten[index] || feedBookRead(bookActiveMs[index], cards[index].dwellSec);
      feedCountActivity(summary, cards[index], a);
      if (session) { session.summary = summary; writeSession(session); } // the recap survives a navigation (W3)
    }

    // The bookmark moves to the card's `next` - forward only, through the feed's rule. A
    // refusal (another device moved on, or a stale card) is final for this card: the next
    // book card the feed serves starts from wherever the place really is.
    // the time a book card has been active: what leaveCard accumulated plus the live span of the active card
    function bookActiveTotal(index) {
      return (bookActiveMs[index] || 0) + (index === activeIndex && bookActiveSince ? Date.now() - bookActiveSince : 0);
    }

    function finishBookCard(index, force) {
      var card = cards[index];
      if (!card || bookWritten[index]) return;
      if (!force && !feedBookRead(bookActiveTotal(index), card.dwellSec)) return;
      bookWritten[index] = true;
      activity[index] = activity[index] || {};
      activity[index].read = true;
      if (!card.next && !card.atEnd) return; // the book is parked for this session (nothing readable followed)
      // the end of the book latches finished through the same served / not-stale rule as a move
      fetch('/api/feed/progress/book/' + encodeURIComponent(card.id), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card.next || { atEnd: true }), keepalive: true,
      }).then(function (r) {
        // gate r2 (adversary W6): the place moved, so a parked book is servable again - when nothing real is queued ahead
        // (a single-book library: the batch after this card was empty), fetch now rather than on the next swipe
        if (r.ok && !cards.slice(index + 1).some(function (c) { return c && c.kind !== 'notice'; })) {
          if (loading) refetchWanted = true; // the prefetch that left beside this write saw the book still parked
          else fetchBatch();
        }
        if (r.status !== 409) return null;
        return r.json().then(function (body) {
          // gate r1 (qa S2): only a STALE refusal is news to the user; backward / not-served are the feed's own
          if (body && body.reason === 'stale' && U()) U().toast({ text: 'Your place in ' + (card.title || 'this book') + ' moved on another device', doc: document });
        });
      }).catch(function () {});
    }

    // ---- media cards: the shared player in the card's slot -------------------------
    function playCard(index) {
      var card = cards[index];
      var node = cardEls[index];
      var p = player();
      if (!p || !node) return;
      var slot = node.querySelector('.feed-card__slot');
      if (!slot) return;
      var data = feedPlayerDescriptor(card);
      if (!data) return;
      mediaCardIndex = index;
      p.load(card.id, data, { slot: slot });
      mediaEl = document.getElementById('media-player');
      if (!mediaEl) return;
      var endAt = card.kind === 'song' ? null : Number(card.endAt);
      var left = node.querySelector('[data-left]');
      var act = activity[index] = activity[index] || { playedSec: 0, done: false, ended: false };
      var startAt = Number(data.startAt) || 0;
      var onTime = function () {
        if (mediaCardIndex !== index || !mediaEl) return;
        var t = mediaEl.currentTime || 0;
        act.playedSec = Math.max(act.playedSec, t - startAt);
        if (endAt !== null && isFinite(endAt)) {
          var remain = endAt - t;
          if (left) left.textContent = remain > 0 ? feedClock(remain) + ' left' : 'Done';
          if (remain <= 0 && !node.hasAttribute('data-done')) {
            node.setAttribute('data-done', '');
            act.done = true;
            p.pause();
            if (windingDown) finishNow(); // D11: the slice finished after time up
          }
        } else if (left && isFinite(mediaEl.duration)) {
          left.textContent = feedClock(mediaEl.duration - t) + ' left';
        }
      };
      mediaEl.addEventListener('timeupdate', onTime, { signal: signal });
      mediaEl.addEventListener('ended', function () {
        if (mediaCardIndex !== index) return;
        node.setAttribute('data-done', '');
        act.ended = true;
        act.done = true;
        if (windingDown) finishNow();
      }, { signal: signal });
    }

    function pauseMedia() {
      var p = player();
      if (p && typeof p.pause === 'function') p.pause();
      mediaCardIndex = -1;
    }

    // ---- the end: playback stops, the recap (D11, D12) ----------------------------------
    function actualSec() {
      return session ? Math.max(0, Math.round((Date.now() - Date.parse(session.startedAt)) / 1000)) : 0;
    }

    function postFinish() {
      if (!session) return;
      var sec = actualSec();
      fetch('/api/feed/sessions/' + encodeURIComponent(session.id) + '/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ actualSec: sec, summary: feedSummaryPayload(summary, sec, extensions) }),
      }).catch(function () {});
    }

    // Time is up (or Done was tapped): the current card is counted, playback stops, the session's
    // finish is recorded, and the recap opens. The session stays live until the recap's Done or an
    // extension decides (an extension re-records the finish at the real end).
    function finishNow() {
      if (recapCtrl) return;
      if (tickTimer) { window.clearInterval(tickTimer); tickTimer = null; }
      windingDown = false;
      hardStopMs = NaN;
      if (activeIndex >= 0) leaveCard(activeIndex);
      pauseMedia();
      var p = player();
      if (p && typeof p.close === 'function') p.close();
      postFinish();
      openRecap();
    }

    function openRecap() {
      var ui = U();
      var content = document.createDocumentFragment();
      var lines = feedRecapLines(summary);
      if (lines.length) {
        var list = el('ul', 'feed-recap__list');
        lines.forEach(function (line) { list.appendChild(el('li', null, line)); });
        content.appendChild(list);
      } else {
        content.appendChild(el('p', 'ui-confirm__body', 'Nothing counted this time: a card counts once you read or played it.'));
      }
      var hint = el('p', 'feed-recap__hint', 'Hold the button to add ten minutes.');
      hint.id = 'feed-hold-hint';
      content.appendChild(hint);
      var row = el('div', 'feed-recap__actions');
      var more = ui ? ui.button({ variant: 'tonal', size: 'md', pill: true, label: 'Another 10 minutes', doc: document }) : el('button', 'ui-btn ui-btn--tonal ui-btn--md ui-btn--pill', 'Another 10 minutes');
      more.type = 'button';
      more.classList.add('feed-hold');
      more.id = 'feed-extend-btn';
      more.setAttribute('aria-describedby', 'feed-hold-hint');
      var done = ui ? ui.button({ variant: 'primary', size: 'md', pill: true, label: 'Done', doc: document }) : el('button', 'ui-btn ui-btn--primary ui-btn--md ui-btn--pill', 'Done');
      done.type = 'button';
      done.id = 'feed-recap-done';
      row.appendChild(more);
      row.appendChild(done);
      content.appendChild(row);
      var title = feedRecapTitle(actualSec(), extensions);
      if (!ui) {
        // no primitives (a stripped realm): the recap is an in-page block
        var block = el('section', 'feed-recap');
        block.id = 'feed-recap';
        block.appendChild(el('h2', 'feed-card__title', title));
        block.appendChild(content);
        sessionEl.appendChild(block);
        recapCtrl = { close: function () { block.remove(); }, isOpen: function () { return block.isConnected; }, guard: function () {}, accepts: function () { return true; }, open: function () {} };
      } else {
        recapCtrl = ui.sheet({ variant: 'dialog', title: title, content: content, doc: document, signal: signal, onClosing: function () { if (recapCtrl) { recapCtrl = null; resetToPicker(); } } });
        recapCtrl.guard(done);
        recapCtrl.guard(more);
        recapCtrl.open();
      }
      done.addEventListener('click', function (e) {
        if (recapCtrl && recapCtrl.accepts && !recapCtrl.accepts(e)) return;
        var ctrl = recapCtrl; recapCtrl = null;
        if (ctrl) ctrl.close();
        resetToPicker();
        goBack();
      }, { signal: signal });
      wireHold(more);
    }

    // "Another 10 minutes" is deliberate: a hold of FEED_HOLD_MS, pointer or keyboard, never a tap.
    function wireHold(btn) {
      var hold = { holding: false, since: 0 };
      var holdTimer = null;
      var paint = function (progress) { btn.style.setProperty('--hold', String(Math.round(progress * 100) / 100)); };
      var stop = function () { if (holdTimer) { window.clearInterval(holdTimer); holdTimer = null; } hold = feedHoldStep(hold, 'up', Date.now()).state; paint(0); };
      var step = function () {
        var r = feedHoldStep(hold, 'tick', Date.now());
        hold = r.state;
        paint(r.progress);
        if (r.fired) { stop(); extend(); }
      };
      var down = function (e) {
        if (e.type === 'keydown') { if (e.key !== 'Enter' && e.key !== ' ') return; if (e.repeat) return; e.preventDefault(); }
        if (e.type === 'pointerdown' && typeof e.button === 'number' && e.button !== 0) return;
        hold = feedHoldStep(hold, 'down', Date.now()).state;
        if (holdTimer) window.clearInterval(holdTimer);
        holdTimer = window.setInterval(step, 50);
      };
      btn.addEventListener('pointerdown', down, { signal: signal });
      btn.addEventListener('keydown', down, { signal: signal });
      ['pointerup', 'pointercancel', 'pointerleave', 'keyup', 'blur'].forEach(function (ev) { btn.addEventListener(ev, stop, { signal: signal }); });
      btn.addEventListener('click', function (e) { e.preventDefault(); }, { signal: signal }); // a tap does nothing
      signal.addEventListener('abort', stop); // gate r1 (qa S3): the hold timer dies with the view
    }

    function extend() {
      if (!session) return;
      fetch('/api/feed/sessions/' + encodeURIComponent(session.id) + '/extend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: signal })
        .then(function (r) { if (!r.ok) throw new Error('extend ' + r.status); return r.json(); })
        .then(function (body) {
          if (signal.aborted || !session) return;
          extensions = Number(body.session && body.session.extensions) || (extensions + 1);
          session.extensions = extensions;
          writeSession(session);
          var ctrl = recapCtrl; recapCtrl = null;
          if (ctrl) ctrl.close();
          startClock();
          // the card that was playing is done: move on to the next one, and fetch more
          if (activeIndex >= 0 && activeIndex + 1 < cardEls.length) cardEls[activeIndex + 1].scrollIntoView({ block: 'start' });
          fetchBatch();
        })
        .catch(function () { if (U()) U().toast({ text: 'Could not add ten minutes', doc: document }); });
    }

    // Back to where he came from (D12): the page before the feed when there is one, else Home.
    function goBack() {
      if (window.history && window.history.length > 1) { window.history.back(); return; }
      if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate('/');
      else window.location.assign('/');
    }

    function resetToPicker() {
      if (tickTimer) { window.clearInterval(tickTimer); tickTimer = null; }
      session = null;
      writeSession(null);
      cards = []; cardEls = []; activeIndex = -1; ratios = {}; exhaustedShown = false; activity = {}; counted = {}; bookActiveMs = {}; bookWritten = {};
      summary = feedEmptySummary(); extensions = 0; windingDown = false; hardStopMs = NaN;
      if (ring) ring.style.setProperty('--p', '0');
      stack.replaceChildren();
      sessionEl.hidden = true;
      picker.hidden = false;
      fetch('/api/feed/sessions/week', { signal: signal }).then(function (r) { return r.ok ? r.json() : null; }).then(function (week) {
        if (!signal.aborted && weekEl) weekEl.textContent = feedWeekLine(week);
      }).catch(function () {});
    }

    // the session the server no longer knows (a restart, a purge): back to the picker, nothing recorded
    function endSession() {
      pauseMedia();
      var p = player();
      if (p && typeof p.close === 'function') p.close();
      resetToPicker();
    }
    if (doneBtn) doneBtn.addEventListener('click', function () { finishNow(); }, { signal: signal });


    // Leaving the page mid-card: a read book card still moves its bookmark (keepalive).
    signal.addEventListener('abort', function () {
      if (activeIndex >= 0 && cards[activeIndex] && cards[activeIndex].kind === 'book') leaveCard(activeIndex);
      if (observer) { observer.disconnect(); observer = null; }
      if (tickTimer) { window.clearInterval(tickTimer); tickTimer = null; }
      if (peekTimer) { window.clearTimeout(peekTimer); peekTimer = null; }
      if (recapCtrl) { var c = recapCtrl; recapCtrl = null; try { c.close(); } catch (_) { /* gone */ } }
    });
  }

  function destroy() {
    if (controller) controller.abort();
    controller = null;
  }

  if (window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('feed', { init, destroy });
  }
})();
