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
var FEED_FIT_KEY = 'ft-feed-fit'; // v1.381.0 (D4): 'fill' (default) or 'fit', per device

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

// v1.381.0 (D9): h:mm:ss once an hour is passed ("1:23:10 of 2:04:00"), else m:ss.
function feedClockLong(sec) {
  var s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 3600) return feedClock(s);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var r = s % 60;
  return h + ':' + (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
}

// v1.381.0 (D9): which item a card's Start over resets on the server ('media' | 'podcast' | 'book'), or '' for a card
// that has none (a song: no place to keep; a new book: nothing to forget; the notice).
function feedStartOverKind(card) {
  if (!card || card.kind === 'song' || card.kind === 'notice') return '';
  if (card.kind === 'book') return card.newBook ? '' : 'book';
  if (card.media === 'podcast') return 'podcast';
  return card.kind === 'video' || card.kind === 'watchlater' ? 'media' : '';
}

// The confirm's sentence: what is forgotten, named (D9a).
function feedStartOverText(card) {
  if (!card) return '';
  if (card.kind === 'book') return 'Your place in ' + (card.title || 'this book') + (card.chapterLabel ? ' (' + card.chapterLabel + ')' : '') + ' will be forgotten. It opens at the beginning next time.';
  var pos = card.media === 'podcast' ? Number(card.position) || 0 : Number(card.progress) || 0;
  var dur = card.media === 'podcast' ? Number(card.durationSec) || 0 : Number(card.duration) || 0;
  var place = pos > 0 ? 'Your place, ' + feedClockLong(pos) + (dur > 0 ? ' of ' + feedClockLong(dur) : '') + ', will be forgotten' : 'It will count as not started';
  return place + (card.kind === 'watchlater' ? '. It stays in Watch later.' : '.');
}

// The Start over toast names the place the SERVER forgot (its `previous`, read from storage), not the card's: another
// device may have moved it after the card was served (gate r1, adversary W4 - the confirm can only show what the card knows).
function feedStartedOverText(card, previous) {
  var title = (card && card.title) || 'this item';
  var p = previous && previous.progress;
  var sec = p ? Number(p.timestamp !== undefined ? p.timestamp : p.position) : 0;
  return 'Started over: ' + title + (sec > 0 ? ' (it was at ' + feedClockLong(sec) + ')' : '');
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

// v1.380.0 (R5, D6): what a video / episode / Watch later card says about the viewer's place in it. "Continue" when
// they have one; "New from <channel>" (video) or "New episode of <show>" (podcast) when they have not. Watch later
// keeps its own kind word beside it (the kind line reads "Watch later · Continue"). Books and songs say nothing here.
function feedNewnessLabel(card) {
  if (!card || (card.kind !== 'video' && card.kind !== 'podcast' && card.kind !== 'watchlater')) return '';
  if (card.fresh !== true) return card.fromStart === true ? 'From the beginning' : 'Continue'; // v1.382.0 (D4): the choice is visible
  if (card.media === 'podcast') return card.showName ? 'New episode of ' + card.showName : 'New episode';
  return card.channelName ? 'New from ' + card.channelName : 'New video';
}

// The kind line: "Video · New from Lofi Girl", "Watch later · Continue", "Start something new" for an unstarted book.
function feedKindLine(card) {
  if (!card) return '';
  if (card.kind === 'book' && card.newBook) return 'Start something new';
  if (card.kind === 'book' && card.fromStart === true) return 'Book \u00b7 From the beginning'; // v1.382.0 (D4)
  var kind = feedKindLabel(card);
  var newness = feedNewnessLabel(card);
  return newness ? kind + ' \u00b7 ' + newness : kind;
}

// v1.380.0 (R5, D7): a FRESH card counts as started only after about a minute of ACTUAL playback. The tracker adds the
// media clock's forward movement between updates, capped by the wall time that passed (a seek moves the clock but not
// the wall: it adds nothing), and nothing while paused. state: { last, wall, sec }. Pure; the view feeds it timeupdates.
var FEED_FRESH_START_SEC = 60;
var FEED_PLAY_STEP_MAX_SEC = 2.5; // a bigger jump between two updates is a seek, never playback
function feedNewPlayTracker() { return { last: null, wall: 0, sec: 0 }; }
function feedPlayedStep(state, currentTime, nowMs, playing, rate) {
  var s = state || feedNewPlayTracker();
  var t = Number(currentTime);
  if (!playing || !isFinite(t)) { s.last = null; return s; }
  if (s.last !== null) {
    var delta = t - s.last;
    var wallSec = Math.max(0, (Number(nowMs) - s.wall) / 1000);
    var cap = wallSec * (Number(rate) > 0 ? Number(rate) : 1) + 0.25;
    if (delta > 0 && delta <= FEED_PLAY_STEP_MAX_SEC) s.sec += Math.min(delta, cap);
  }
  s.last = t;
  s.wall = Number(nowMs);
  return s;
}
// A clip shorter than 75 s needs 80% of itself, never more than a minute (mirrors lib/feed/safe-progress.js freshNeedSec).
// v1.382.0 (D6): and a reel shorter than that counts once played WHOLE (its length less FEED_REEL_END_SLACK_SEC, the last
// update before the reel's end pause) - the same rule as the server's, which checks it again.
var FEED_REEL_END_SLACK_SEC = 1;
function feedFreshNeedSec(durationSec, sliceSec) {
  var d = Number(durationSec);
  var need = isFinite(d) && d > 0 ? Math.min(FEED_FRESH_START_SEC, Math.max(1, d * 0.8)) : FEED_FRESH_START_SEC;
  var sl = Number(sliceSec);
  if (isFinite(sl) && sl > 0) need = Math.min(need, Math.max(1, sl - FEED_REEL_END_SLACK_SEC));
  return need;
}
function feedFreshStarted(state, needSec) { return !!state && state.sec >= (typeof needSec === 'number' && needSec > 0 ? needSec : FEED_FRESH_START_SEC); }

// v1.380.0 (R3, D3): the "Swipe up" cue shows on the first FEED_HINT_SESSIONS sessions on a device, then never again.
var FEED_HINT_KEY = 'ft-feed-hint-sessions';
var FEED_HINT_SESSIONS = 3;
var FEED_HINT_MS = 4000;
var FEED_UNDO_MS = 10000; // v1.381.0 (D9b): the Start over toast's Undo lasts 10 s (the session's record keeps it after)
var FEED_PAGE_HINT_KEY = 'ft-feed-page-hint-sessions'; // v1.381.0 (D11): "Swipe left for the next page", first 3 sessions
var FEED_INTRO_NOTE_MS = 3000;
var FEED_HEART_MS = 900; // v1.382.0 (D10): the double-tap heart's life on the card
function feedHintShouldShow(count) {
  var n = parseInt(count, 10);
  return !(n >= FEED_HINT_SESSIONS);
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
      placeFloorSec: feedPlaceFloorSec(card),
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
    placeFloorSec: feedPlaceFloorSec(card),
  };
}

// v1.382.0 (D4, D7): a card played "From the beginning" carries its saved place as the player's FLOOR (player.js
// placeFloorAllows): nothing saves at or below it, here or after Keep watching hands the player to the watch / podcasts page,
// until playback passes it. undefined for every other card (the player's "none").
function feedPlaceFloorSec(card) {
  if (!card || card.fromStart !== true) return undefined;
  var at = Number(card.media === 'podcast' ? card.position : card.progress);
  return isFinite(at) && at > 0 ? at : undefined;
}

// v1.382.0 (D7): where "Keep watching / listening" takes a media card - the item's own full place, the shared player
// carried over (the watch page or the podcasts page adopts the same id and plays on from the card's spot). '' = none.
var FEED_KEEP_SEC = 10; // the pill shows in a slice's last 10 seconds and on its Done state
function feedKeepHref(card) {
  if (!card || typeof card.id !== 'string' || !card.id) return '';
  if (card.media === 'podcast') return '/podcasts?play=' + encodeURIComponent(card.id);
  // library audio opens in Music like every audio item (common.js audioOpenHref, the audio-routing net's one rule); the
  // watch page is the video's place and the fallback when the rule is not on the page
  var rule = typeof window !== 'undefined' ? window.audioOpenHref : null; // a classic-script global of common.js
  if (card.media === 'audio' && typeof rule === 'function') { var a = rule({ id: card.id, type: 'audio', kind: 'media' }); if (a) return a; }
  if (card.media === 'video' || card.media === 'audio') return '/watch.html?v=' + encodeURIComponent(card.id);
  return '';
}
function feedKeepLabel(card) {
  if (!card) return '';
  if (card.kind === 'book') return 'Keep reading';
  return card.media === 'video' ? 'Keep watching' : 'Keep listening';
}
// Show the pill? In the slice's last FEED_KEEP_SEC seconds, or once it is done (never after the whole FILE ended: nothing is left).
function feedKeepDue(remainSec, done, ended) {
  if (ended) return false;
  return !!done || (typeof remainSec === 'number' && isFinite(remainSec) && remainSec <= FEED_KEEP_SEC);
}

// v1.382.0 (D2-D5, D8): the request's view of the Feed settings - the synced ft-feed-settings value read by the ONE reading
// (public/js/feed-settings.js, on every shell). '' = the defaults (nothing to send). Read per batch: a change applies from
// the next batch and never re-shuffles the cards on screen.
function feedSettingsParam(storage, FS) {
  if (!FS || typeof FS.serialize !== 'function') return '';
  var raw = null;
  try { raw = storage ? storage.getItem(FS.SETTINGS_KEY) : null; } catch (_) { raw = null; }
  var v = FS.serialize(FS.normalize(raw));
  return v === '{}' ? '' : '&fs=' + encodeURIComponent(v);
}

// A book card counts as read when it was active for at least its dwellSec in total.
function feedBookRead(activeMs, dwellSec) {
  return (Number(activeMs) || 0) >= (Math.max(5, Number(dwellSec) || 0)) * 1000;
}

// ---- v1.381.0 (D6): book pages - one screen of text at a time, never a scroller inside a card ----------------------

// The words of a text (whitespace-separated runs), the server's count (lib/books/excerpt.js countWords).
function feedWordCount(text) {
  var t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

// Lay a card's blocks into pages. `fits(blocks)` answers whether these blocks fit the page box (the view measures the real
// box; tests pass a word budget). A block too long for an EMPTY page is split at a word boundary (the longest head that
// fits, found by bisection); every part keeps the block's place (spineIndex, blockIndex) and the parts after the first are
// marked `cont` (no chapter label, no heading). It always progresses: a one-word head is placed even when it does not fit.
var FEED_MAX_PAGES = 400;
var FEED_SPLIT_MIN_WORDS = 8;
// The most words of block b (its text split into `words`) whose head still fits (bisection; 0 when not even one word does).
function feedLongestHead(b, words, fitsHead) {
  var lo = 1;
  var hi = words.length - 1;
  var best = 0;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    if (fitsHead(Object.assign({}, b, { text: words.slice(0, mid).join(' ') }))) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}
function feedPaginate(blocks, fits) {
  var pages = [];
  var cur = [];
  var queue = (blocks || []).slice();
  while (queue.length && pages.length < FEED_MAX_PAGES) {
    var b = queue.shift();
    if (fits(cur.concat([b]))) { cur.push(b); continue; }
    var words = String(b.text || '').trim().split(/\s+/);
    if (cur.length) {
      // the page has room left: a paragraph (never a heading, a cover or a description) continues onto the next page when at
      // least FEED_SPLIT_MIN_WORDS of it fit here, so a page is not left half empty by one long paragraph
      var head0 = !b.heading && !b.cover && !b.desc && words.length > FEED_SPLIT_MIN_WORDS * 2 ? feedLongestHead(b, words, function (h) { return fits(cur.concat([h])); }) : 0;
      if (head0 >= FEED_SPLIT_MIN_WORDS) {
        cur.push(Object.assign({}, b, { text: words.slice(0, head0).join(' ') }));
        queue.unshift(Object.assign({}, b, { text: words.slice(head0).join(' '), cont: true, chapterStart: false, heading: false }));
      } else queue.unshift(b);
      pages.push(cur); cur = [];
      continue;
    }
    if (words.length < 2) { pages.push([b]); continue; }
    var best = Math.max(1, feedLongestHead(b, words, function (h) { return fits([h]); }));
    pages.push([Object.assign({}, b, { text: words.slice(0, best).join(' ') })]);
    queue.unshift(Object.assign({}, b, { text: words.slice(best).join(' '), cont: true, chapterStart: false, heading: false }));
  }
  if (cur.length) pages.push(cur);
  return pages;
}

// Where a book card may move the place: the start of the first page NOT read, counting pages read IN ORDER from the first
// (a page read after an unread one never moves the place past it - the v1.379.0 "shown is not read" lesson). Every page read:
// the card's end (`end`: its next, or { atEnd: true }, or null when nothing readable followed). Null when no page was read,
// or when the target is still the card's own start (a block split over pages 1 and 2, only page 1 read: nothing moves).
function feedBookTarget(pages, read, end) {
  var list = pages || [];
  var k = 0;
  while (k < list.length && read && read[k]) k += 1;
  if (k === 0) return null;
  if (k >= list.length) return end || null;
  var first = list[k][0];
  if (first && first.spineIndex < 0) return end || null; // only "The end." is left unread: every real page was read
  var start = list[0][0];
  if (!first || (start && first.spineIndex === start.spineIndex && first.blockIndex === start.blockIndex)) return null;
  return { spineIndex: first.spineIndex, blockIndex: first.blockIndex };
}

// v1.381.0 (D7): a horizontal swipe on a book card turns its page: left = 'next', right = 'prev'. Never a swipe that STARTS
// within FEED_EDGE_PX of either screen edge (those belong to the system's back / forward gesture), never a short one, never a
// mostly vertical one (that moves the stack, card to card). o = { startX, dx, dy, width }.
var FEED_EDGE_PX = 24;
var FEED_SWIPE_MIN_PX = 40;
function feedPageSwipe(o) {
  var c = o || {};
  var x = Number(c.startX), dx = Number(c.dx), dy = Number(c.dy), w = Number(c.width);
  if (!isFinite(x) || !isFinite(dx) || !isFinite(w) || w <= 0) return null;
  if (x < FEED_EDGE_PX || x > w - FEED_EDGE_PX) return null;
  if (Math.abs(dx) < FEED_SWIPE_MIN_PX || Math.abs(dx) < 1.5 * Math.abs(isFinite(dy) ? dy : 0)) return null;
  return dx < 0 ? 'next' : 'prev';
}

// The further of two book targets ({spineIndex, blockIndex}, or { atEnd: true }, the furthest of all); null-safe.
function feedFurther(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  if (a.atEnd) return a;
  if (b.atEnd) return b;
  if (b.spineIndex !== a.spineIndex) return b.spineIndex > a.spineIndex ? b : a;
  return b.blockIndex > a.blockIndex ? b : a;
}

// One page's dwell: the shipped rule (300 words a minute x 0.6, at least 5 s; lib/books/excerpt.js bookDwellSeconds) on the
// words actually on that page.
function feedPageDwellSec(page) {
  var w = (page || []).reduce(function (n, b) { return n + feedWordCount(b && b.text); }, 0);
  return w > 0 ? Math.max(5, Math.ceil((w / 300) * 60 * 0.6)) : 5;
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

// ---- v1.382.0 (D10, D11): card actions ------------------------------------------------------------------------------------
// The like route of a card's own kind (each kind's existing route, visibility-checked there as today): a video / library
// audio / Watch later video is a media like, an episode a podcast like, a song music's, a book a book like.
function feedLikeUrl(card) {
  if (!card || typeof card.id !== 'string' || !card.id || card.kind === 'notice') return '';
  var id = encodeURIComponent(card.id);
  if (card.kind === 'song') return '/api/music/liked/' + id;
  if (card.kind === 'book') return '/api/books/liked/' + id;
  if (card.media === 'podcast') return '/api/podcasts/episodes/' + id + '/liked';
  if (card.media === 'video' || card.media === 'audio') return '/api/liked/' + id;
  return '';
}
function feedIsLiked(card) {
  if (!card) return false;
  return card.kind === 'song' ? !!(card.track && card.track.liked) : card.liked === true;
}
// Watch later: videos (and library audio) and episodes (the Watch later route's ?kind=podcast); '' for books and songs.
function feedWatchLaterUrl(card) {
  if (!card || typeof card.id !== 'string' || !card.id) return '';
  if (card.media === 'podcast') return '/api/watch-later/' + encodeURIComponent(card.id) + '?kind=podcast';
  if (card.media === 'video' || card.media === 'audio') return '/api/watch-later/' + encodeURIComponent(card.id);
  return '';
}
// "Hide this": the hide route's { kind, id } for a card, or null.
function feedHideTarget(card) {
  if (!card || typeof card.id !== 'string' || !card.id || card.kind === 'notice') return null;
  if (card.kind === 'song') return { kind: 'song', id: card.id };
  if (card.kind === 'book') return { kind: 'book', id: card.id };
  if (card.media === 'podcast') return { kind: 'podcast', id: card.id };
  if (card.media === 'video' || card.media === 'audio') return { kind: 'media', id: card.id };
  return null;
}
// "Fewer from <name>": the channel of a video, the show of an episode, the artist of a song, the author of a book. null when
// the card names none.
function feedFewerTarget(card) {
  if (!card) return null;
  var type = '';
  var name = '';
  if (card.kind === 'song') { type = 'artist'; name = card.track && card.track.artist; }
  else if (card.kind === 'book') { type = 'author'; name = card.author; }
  else if (card.media === 'podcast') { type = 'show'; name = card.showName; }
  else if (card.media === 'video' || card.media === 'audio') { type = 'channel'; name = card.channelName; }
  name = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  return type && name ? { type: type, name: name, key: type + ':' + name } : null;
}
// The tap / double-tap discrimination (the watch page's window, player.js DOUBLE_TAP_MS): a second tap inside the window and
// near the first is a DOUBLE (the like); otherwise the tap is a SINGLE that fires once the window has passed (play / pause).
// state: { at, x, y } of the last lone tap, or null. Pure.
var FEED_DOUBLE_TAP_PX = 40;
function feedTapKind(state, nowMs, x, y, windowMs) {
  var w = typeof windowMs === 'number' && windowMs > 0 ? windowMs : 350;
  if (state && nowMs - state.at < w && Math.abs(x - state.x) <= FEED_DOUBLE_TAP_PX && Math.abs(y - state.y) <= FEED_DOUBLE_TAP_PX) return 'double';
  return 'single';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FEED_LENGTH_CHOICES, FEED_LENGTH_KEY, FEED_SESSION_KEY, FEED_BATCH, FEED_PREFETCH_AHEAD, FEED_KEEP_BEHIND, FEED_ACTIVE_RATIO,
    FEED_EXTEND_MIN, FEED_WIND_DOWN_CAP_SEC, FEED_HOLD_MS, FEED_WORDS_PER_PAGE, FEED_TIME_PEEK_MS, feedRestoreSummary,
    feedNormalizeMinutes, feedWeekLine, feedClock, feedKindLabel, feedActiveIndex, feedShouldPrefetch, feedExcludeIds,
    feedPlayerDescriptor, feedBookRead,
    feedNewnessLabel, feedKindLine, FEED_FRESH_START_SEC, FEED_PLAY_STEP_MAX_SEC, feedNewPlayTracker, feedPlayedStep, feedFreshStarted, feedFreshNeedSec,
    FEED_HINT_KEY, FEED_HINT_SESSIONS, FEED_HINT_MS, FEED_INTRO_NOTE_MS, feedHintShouldShow, FEED_HEART_MS,
    feedDeadlineMs, feedRingFraction, feedRemainingSec, feedEmptySummary, feedCountActivity, feedRecapLines, feedRecapTitle,
    feedHoldStep, feedSummaryPayload,
    feedClockLong, feedStartOverKind, feedStartOverText, feedStartedOverText, FEED_UNDO_MS,
    FEED_REEL_END_SLACK_SEC, feedPlaceFloorSec, FEED_KEEP_SEC, feedKeepHref, feedKeepLabel, feedKeepDue, feedSettingsParam,
    feedLikeUrl, feedIsLiked, feedWatchLaterUrl, feedHideTarget, feedFewerTarget, feedTapKind, FEED_DOUBLE_TAP_PX,
    feedWordCount, feedPaginate, feedLongestHead, FEED_SPLIT_MIN_WORDS, feedBookTarget, feedPageDwellSec, FEED_MAX_PAGES, feedFurther, FEED_FIT_KEY,
    FEED_EDGE_PX, FEED_SWIPE_MIN_PX, feedPageSwipe, FEED_PAGE_HINT_KEY,
  };
}

// ---- The view -------------------------------------------------------------------------

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var controller = null;

  function readPref(key, fallback) { try { return window.localStorage.getItem(key) || fallback; } catch (_) { return fallback; } }
  function localStore() { try { return window.localStorage; } catch (_) { return null; } } // the getter itself can throw (storage off)
  function writePref(key, value) { try { window.localStorage.setItem(key, String(value)); } catch (_) { /* storage disabled */ } }
  function readSession() { try { return JSON.parse(window.sessionStorage.getItem(FEED_SESSION_KEY) || 'null'); } catch (_) { return null; } }
  function writeSession(s) { try { if (s) window.sessionStorage.setItem(FEED_SESSION_KEY, JSON.stringify(s)); else window.sessionStorage.removeItem(FEED_SESSION_KEY); } catch (_) { /* storage disabled */ } }
  function player() { return window.FileTube && window.FileTube.player; }
  function U() { return window.ui || null; }
  // v1.381.0: ui.toast's signature is toast(message, opts). Until this release every Feed toast passed ONE object
  // ({ text, doc }), so on a device it read "[object Object]" (the test harness's object-taking stub hid it). One helper.
  function toast(text, opts) { var u = U(); return u ? u.toast(String(text), Object.assign({ doc: document }, opts || {})) : null; }

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
    var bookPages = {}; // v1.381.0 (D6): card index -> { blocks, pages, page, read, pageMs, since, end, measured, carry, written }
    var fitMode = readPref(FEED_FIT_KEY, 'fill') === 'fit' ? 'fit' : 'fill'; // v1.381.0 (D4)
    var startingRead = {}; // card index -> true once "Start reading" was tapped (a double tap is one write)
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
    var hintPending = false; // v1.380.0 (R3, D3): set when a session STARTS (not on a resume): the first card shows the swipe cue
    var pageHintPending = false; // v1.381.0 (D11): the first paged book card of a started session shows the page cue
    var hintTimer = null;
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
          hintPending = true;
          pageHintPending = true;
          writeSession(session);
          showStack();
          startClock();
          fetchBatch();
        })
        .catch(function () { toast('Could not start the feed'); });
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
      var url = '/api/feed?session=' + encodeURIComponent(session.id) + '&count=' + FEED_BATCH + (exclude.length ? '&exclude=' + exclude.map(encodeURIComponent).join(',') : '')
        + feedSettingsParam(localStore(), window.FileTubeFeedSettings);
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
      // in the stack BEFORE it is filled: a book card measures its own page box (D6)
      stack.appendChild(node);
      cardEls.push(node);
      fillCard(node, card, index);
      if (observer) observer.observe(node);
    }

    // v1.381.0 (D3-D6): ONE layout for every card - full screen, the media as the card's own layer, the words in an overlay at
    // the bottom. A card is: .feed-card__media (the full-card layer: a video's poster and the player's slot, or a song's /
    // episode's blurred art backdrop and the slot the audio plays from), .feed-card__hudspace (the strip the ring and Done sit
    // in, kept free of the card's own content), .feed-card__stage (what sits between that strip and the overlay: a book's
    // fitted page, a song's or episode's art at a moderate size), .feed-card__overlay (the kind line, the title on two lines
    // at most, the channel / show / author, the readout and the buttons). Nothing inside a card scrolls (D6).
    function fillCard(node, card, index) {
      node.replaceChildren();
      node.removeAttribute('data-media');
      if (card.kind === 'notice') {
        node.classList.add('feed-card--notice');
        node.appendChild(el('p', 'feed-notice', 'You’re through everything new. From here the feed starts over.'));
        return;
      }
      var media = el('div', 'feed-card__media');
      var stage = el('div', 'feed-card__stage');
      var overlay = el('div', 'feed-card__overlay');
      node.appendChild(media);
      node.appendChild(el('div', 'feed-card__hudspace'));
      node.appendChild(stage);
      node.appendChild(overlay);
      overlay.appendChild(el('div', 'feed-card__kind', feedKindLine(card)));
      overlay.appendChild(el('h3', 'feed-card__title', card.title || (card.track && card.track.title) || ''));
      if (card.kind === 'book') {
        if (card.newBook) fillNewBookCard(node, stage, overlay, card, index);
        else fillBookCard(node, stage, overlay, card, index);
        wirePageSwipes(stage, index);
        return;
      }
      if (card.kind === 'song') {
        var t = card.track || {};
        fillAudioMedia(node, media, stage, t.artUrl || ('/albumart/' + encodeURIComponent(t.artId || card.id) + (t.artV ? '?v=' + encodeURIComponent(t.artV) : '')));
        overlay.appendChild(el('p', 'feed-card__meta', [t.artist, t.album].filter(Boolean).join(' · ')));
        overlay.appendChild(playActions(card, index, 'Whole song'));
        wireMediaGestures(node, overlay, index, false);
        return;
      }
      // podcast / video / Watch later
      var isPod = card.media === 'podcast';
      overlay.appendChild(el('p', 'feed-card__meta', isPod ? (card.showName || '') : (card.channelName || '')));
      if (isPod || card.media === 'audio') {
        fillAudioMedia(node, media, stage, isPod ? card.artUrl : card.thumbnailUrl);
      } else {
        node.setAttribute('data-media', 'video');
        node.setAttribute('data-fit', fitMode);
        var poster = el('img', 'feed-card__poster');
        poster.alt = '';
        poster.src = card.thumbnailUrl;
        media.appendChild(poster);
        media.appendChild(el('div', 'feed-card__slot'));
        // D8: a thin line along the bottom edge shows how far into this card's slice the video is (not a control in v1)
        var line = el('div', 'feed-card__progress');
        line.setAttribute('aria-hidden', 'true');
        media.appendChild(line);
      }
      var label = isPod ? feedClock((card.endAt || 0) - (card.startAt || 0)) + ' of this episode'
        : (card.chapter ? 'Chapter ' + (card.chapter.index + 1) + ' of ' + card.chapter.count + (card.chapter.title ? ': ' + card.chapter.title : '') : feedClock((card.endAt || 0) - (card.startAt || 0)) + ' of this video');
      overlay.appendChild(playActions(card, index, label));
      wireMediaGestures(node, overlay, index, !isPod && card.media !== 'audio');
    }

    // ---- gestures (D7, D8) ---------------------------------------------------------------
    // D8: a media card's gesture layer covers the picture / art (the overlay's buttons sit above it and keep their taps). It
    // never cancels a touch, so a vertical swipe that starts on the picture moves the stack like anywhere else (the shared
    // player's own picture listener cancels every touch - the watch page's loupe guard - which is why the layer is here and
    // the player's picture never sees a Feed touch). A tap = the player's picture tap (play / pause + the centred glyph); on a
    // VIDEO a press and hold = 2x while held (the player's engageHold / releaseHold, its own threshold and move tolerance).
    function wireMediaGestures(node, overlay, index, canHold) {
      var layer = el('div', 'feed-card__touch');
      layer.setAttribute('aria-hidden', 'true');
      node.insertBefore(layer, overlay);
      var g = null; // { id, x, y, at, moved, held, timer, card }
      var timings = function () { var p = player(); return (p && typeof p.gestureTimings === 'function' && p.gestureTimings()) || { holdMs: 500, moveTol: 16, doubleTapMs: 350 }; };
      var mine = function () { return index === activeIndex && mediaCardIndex === index; };
      // v1.382.0 (D10): a lone tap waits out the double-tap window before it plays / pauses; a second tap inside it is a like
      var lastTap = null; // { at, x, y, card }
      var singleTimer = 0;
      var end = function (tap, e) {
        if (!g) return;
        window.clearTimeout(g.timer);
        var p = player();
        var gg = g;
        g = null;
        if (gg.held) { if (p && typeof p.holdEnd === 'function') p.holdEnd(); return; }
        if (!tap || gg.moved) return;
        var now = Date.now();
        var x = e && typeof e.clientX === 'number' ? e.clientX : gg.x;
        var y = e && typeof e.clientY === 'number' ? e.clientY : gg.y;
        var win = Number(timings().doubleTapMs) || 350;
        if (lastTap && lastTap.card === gg.card && feedTapKind(lastTap, now, x, y, win) === 'double') {
          window.clearTimeout(singleTimer);
          lastTap = null;
          likeFromGesture(index, gg.card, x, y); // the card the gesture STARTED on, checked again inside
          return;
        }
        lastTap = { at: now, x: x, y: y, card: gg.card };
        window.clearTimeout(singleTimer);
        singleTimer = window.setTimeout(function () {
          lastTap = null;
          var pp = player();
          if (cards[index] === gg.card && mine() && pp && typeof pp.pictureTap === 'function') pp.pictureTap();
        }, win);
      };
      signal.addEventListener('abort', function () { window.clearTimeout(singleTimer); });
      layer.addEventListener('pointerdown', function (e) {
        if (e.isPrimary === false || (typeof e.button === 'number' && e.button > 0)) return;
        if (g) { window.clearTimeout(g.timer); if (g.held) { var p0 = player(); if (p0 && typeof p0.holdEnd === 'function') p0.holdEnd(); } g = null; }
        g = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, held: false, timer: 0, card: cards[index] };
        if (canHold && mine()) {
          var gg = g;
          gg.timer = window.setTimeout(function () {
            var p = player();
            if (g === gg && !gg.moved && mine() && p && typeof p.holdStart === 'function') gg.held = !!p.holdStart();
          }, timings().holdMs);
        }
      }, { signal: signal });
      layer.addEventListener('pointermove', function (e) {
        if (!g || e.pointerId !== g.id || g.held) return;
        var tol = timings().moveTol;
        if (Math.abs(e.clientX - g.x) > tol || Math.abs(e.clientY - g.y) > tol) { g.moved = true; window.clearTimeout(g.timer); }
      }, { signal: signal });
      layer.addEventListener('pointerup', function (e) { if (g && e.pointerId === g.id) end(true, e); }, { signal: signal });
      layer.addEventListener('pointercancel', function () { end(false); }, { signal: signal }); // the browser took the touch (a scroll)
      layer.addEventListener('lostpointercapture', function () { if (g && g.held) end(false); }, { signal: signal });
      // while 2x is held the finger may drift: the stack stays put (only then; any other touch scrolls as usual)
      layer.addEventListener('touchmove', function (e) { if (g && g.held && e.cancelable) e.preventDefault(); }, { passive: false, signal: signal });
    }

    // D7: on a book card a horizontal swipe turns the page (feedPageSwipe: the 24 px edge rule, never a vertical one);
    // the stack keeps every vertical swipe (touch-action: pan-y on the stage).
    function wirePageSwipes(stage, index) {
      var g = null;
      var bookTap = null; // v1.382.0 (D10): the last lone tap on this page, for the double-tap like
      stage.addEventListener('pointerdown', function (e) {
        if (e.isPrimary === false || (typeof e.button === 'number' && e.button > 0)) return;
        g = { id: e.pointerId, x: e.clientX, y: e.clientY, card: cards[index] };
      }, { signal: signal });
      stage.addEventListener('pointercancel', function () { g = null; }, { signal: signal });
      stage.addEventListener('pointerup', function (e) {
        if (!g || e.pointerId !== g.id) return;
        var dir = feedPageSwipe({ startX: g.x, dx: e.clientX - g.x, dy: e.clientY - g.y, width: window.innerWidth || document.documentElement.clientWidth });
        var still = Math.abs(e.clientX - g.x) <= FEED_DOUBLE_TAP_PX / 2 && Math.abs(e.clientY - g.y) <= FEED_DOUBLE_TAP_PX / 2;
        var card0 = g.card;
        g = null;
        if (dir && index === activeIndex) { bookTap = null; turnPage(index, dir === 'next' ? 1 : -1); return; }
        // v1.382.0 (D10): a double tap on the page likes the book (a single tap on a page does nothing, so nothing waits)
        if (!still) { bookTap = null; return; }
        var now = Date.now();
        if (bookTap && bookTap.card === card0 && feedTapKind(bookTap, now, e.clientX, e.clientY, 350) === 'double') { bookTap = null; likeFromGesture(index, card0, e.clientX, e.clientY); return; }
        bookTap = { at: now, x: e.clientX, y: e.clientY, card: card0 };
      }, { signal: signal });
    }

    // The next / previous page of the active book card. Past the last page of a reading card, the next pages come from the
    // excerpt route in CONTINUATION mode (it reads text and never touches the served registry, so the card's own serve stays
    // the judge of every write); a new book's description and taste turn within what the card holds.
    var continuing = {};
    function turnPage(index, dir) {
      var bp = bookPages[index];
      var card = cards[index];
      if (!bp || !card) return;
      noteBookPage(index);
      clearHint();
      if (dir < 0) { if (bp.page > 0) { showPage(index, bp.page - 1); bp.since = Date.now(); } return; }
      if (bp.page < bp.pages.length - 1) { showPage(index, bp.page + 1); bp.since = Date.now(); return; }
      if (card.newBook || !bookEnd(bp) || bp.end.atEnd || continuing[index]) return;
      continuing[index] = true;
      var from = bp.end;
      fetch('/api/books/' + encodeURIComponent(card.id) + '/excerpt?spine=' + from.spineIndex + '&block=' + from.blockIndex + '&continuation=1', { signal: signal })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (body) {
          continuing[index] = false;
          if (!body || !Array.isArray(body.blocks) || !body.blocks.length || bookPages[index] !== bp || bp.end !== from) return;
          var more = body.blocks.slice();
          if (body.atEnd) more.push({ spineIndex: -1, blockIndex: -1, text: 'The end.', end: true });
          var node = cardEls[index];
          var pageEl = node && node.querySelector('.feed-card__page');
          // the new text gets pages of its own: the pages already shown (and read) never change under the reader
          var newPages = pageEl && pageEl.clientHeight > 0
            ? feedPaginate(more, function (blocks) { drawPage(pageEl, blocks); return pageEl.scrollHeight <= pageEl.clientHeight; })
            : [more];
          bp.blocks = bp.blocks.concat(more);
          bp.pages = bp.pages.concat(newPages);
          bp.end = body.atEnd ? { atEnd: true } : (body.next || null);
          if (index === activeIndex) { showPage(index, bp.page + 1); bp.since = Date.now(); } else showPage(index, bp.page);
        })
        .catch(function () { continuing[index] = false; });
    }

    // the keyboard twin of the page swipe (a desktop has no swipe): the arrow keys turn the active book card's page
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
      if (activeIndex < 0 || !bookPages[activeIndex] || !cards[activeIndex] || cards[activeIndex].kind !== 'book') return;
      e.preventDefault();
      turnPage(activeIndex, e.key === 'ArrowRight' ? 1 : -1);
    }, { signal: signal });

    // D5: a song's or an episode's art is the card's background (blurred and darkened, the music player's backdrop recipe)
    // with the art itself at a moderate size above the overlay. The player's own surface (its slot) stays mounted - the audio
    // plays from it - but is not drawn: the card shows the art once.
    function fillAudioMedia(node, media, stage, artUrl) {
      node.setAttribute('data-media', 'audio');
      var back = el('img', 'feed-card__backdrop');
      back.alt = '';
      back.setAttribute('aria-hidden', 'true');
      if (artUrl) back.src = artUrl;
      media.appendChild(back);
      media.appendChild(el('div', 'feed-card__slot'));
      var art = el('img', 'feed-card__art');
      art.alt = '';
      if (artUrl) art.src = artUrl;
      stage.appendChild(art);
    }

    // D6: a book card's text is laid into pages that fit the stage (feedPaginate over the real box); the card shows one page.
    function fillBookCard(node, stage, overlay, card, index) {
      node.setAttribute('data-paged', '');
      overlay.appendChild(el('p', 'feed-card__meta', (card.author ? card.author + ' · ' : '') + (card.chapterLabel || '')));
      var page = el('div', 'feed-card__text feed-card__page');
      stage.appendChild(page);
      var actions = el('div', 'feed-card__actions');
      var open = U() ? U().button({ variant: 'tonal', size: 'sm', pill: true, icon: 'menu_book', label: 'Open in reader', doc: document })
        : el('button', 'ui-btn ui-btn--tonal ui-btn--sm ui-btn--pill', 'Open in reader');
      open.type = 'button';
      open.addEventListener('click', function () {
        // the place moves only as far as the pages READ (each its own dwell); the reader opens there
        noteBookPage(index);
        finishBookCard(index);
        if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate(card.readerHref);
        else window.location.assign(card.readerHref);
      }, { signal: signal });
      actions.appendChild(open);
      var left = el('span', 'feed-card__left', '');
      left.setAttribute('data-page-readout', '');
      actions.appendChild(left);
      appendCardMenu(actions, index); // v1.382.0: every card has its menu (a started-over book's has no Start over: nothing left to forget)
      overlay.appendChild(actions);
      if (card.startedOver) overlay.querySelector('.feed-card__kind').textContent = 'Book \u00b7 Started over';
      // gate r1 (qa W2): the blocks (the card's own and any continuation) are seeded ONCE, when the card's state is born; a card
      // rebuilt after it was pruned re-lays the SAME blocks, and what was read is kept as a place (relayoutBook) - re-seeding
      // dropped the continuation while its reads and end stayed, and the next write passed text never shown
      var born = !bookPages[index];
      var bp = bookState(index, card);
      if (born) {
        bp.blocks = (card.blocks || []).slice();
        if (card.atEnd) bp.blocks.push({ spineIndex: -1, blockIndex: -1, text: 'The end.', end: true });
        layoutPages(index);
      } else relayoutBook(index);
    }

    // v1.380.0 (R4, D5): "Start something new" - an unstarted book. Cover, author, the book's own description (TEXT
    // nodes only), an optional taste of the opening. Looking at any of it writes nothing; the only thing that starts the
    // book is "Start reading", which moves the place to the first real chapter through the feed's forward-only write and
    // then opens the reader. Swiping on leaves the book exactly as it was. v1.381.0 (D6): the cover and the description are
    // fitted to the stage like a book's pages (a long description goes on to a second page); "Read the opening" turns the
    // stage to the taste, also in pages, and "Hide the opening" turns it back.
    function fillNewBookCard(node, stage, overlay, card, index) {
      node.setAttribute('data-new-book', '');
      node.setAttribute('data-paged', '');
      overlay.appendChild(el('p', 'feed-card__meta', card.author || ''));
      var page = el('div', 'feed-card__text feed-card__page');
      stage.appendChild(page);
      var actions = el('div', 'feed-card__actions');
      var start = U() ? U().button({ variant: 'primary', size: 'sm', pill: true, icon: 'menu_book', label: 'Start reading', doc: document })
        : el('button', 'ui-btn ui-btn--primary ui-btn--sm ui-btn--pill', 'Start reading');
      start.type = 'button';
      start.setAttribute('data-start-reading', '');
      start.addEventListener('click', function () { startReading(index, start); }, { signal: signal });
      actions.appendChild(start);
      var bp = bookState(index, card);
      var intro = [];
      if (card.coverUrl) intro.push({ spineIndex: -1, blockIndex: -1, cover: card.coverUrl, text: '' });
      if (card.description) intro.push({ spineIndex: -1, blockIndex: -1, desc: true, text: card.description });
      bp.blocks = intro;
      if ((card.blocks || []).length) {
        var peek = U() ? U().button({ variant: 'tonal', size: 'sm', pill: true, labels: ['Read the opening', 'Hide the opening'], pressed: false, doc: document })
          : el('button', 'ui-btn ui-btn--tonal ui-btn--sm ui-btn--pill', 'Read the opening');
        peek.type = 'button';
        peek.setAttribute('data-read-opening', '');
        peek.setAttribute('aria-expanded', 'false');
        peek.addEventListener('click', function () {
          var open = peek.getAttribute('aria-expanded') !== 'true';
          peek.setAttribute('aria-expanded', open ? 'true' : 'false');
          if (U() && typeof U().setPressed === 'function') U().setPressed(peek, open);
          // the taste is text to look at: it is never a page READ (countCard, finishBookCard: a new book moves nothing)
          bp.blocks = open ? (card.blocks || []).map(function (b) { return Object.assign({ taste: true }, b); }) : intro;
          bp.page = 0;
          layoutPages(index);
        }, { signal: signal });
        actions.appendChild(peek);
      }
      var left = el('span', 'feed-card__left', '');
      left.setAttribute('data-page-readout', '');
      actions.appendChild(left);
      appendCardMenu(actions, index); // v1.382.0 (D10, D11): Like, Hide this, Fewer from the author (no Start over: nothing to forget)
      overlay.appendChild(actions);
      layoutPages(index);
    }

    // ---- book pages (D6) ----------------------------------------------------------------
    function bookState(index, card) {
      var bp = bookPages[index];
      if (!bp) {
        bp = bookPages[index] = { blocks: [], pages: [], page: 0, read: {}, pageMs: {}, since: 0, end: card.atEnd ? { atEnd: true } : (card.next || null), measured: false };
      }
      return bp;
    }

    // one block as it is drawn on a page (text nodes only, never markup)
    function blockNodes(b) {
      var out = [];
      if (b.cover) { var img = el('img', 'feed-card__cover'); img.alt = ''; img.src = b.cover; out.push(img); return out; }
      if (b.desc) { out.push(el('p', 'feed-card__desc', b.text)); return out; }
      if (b.end) { out.push(el('p', 'feed-card__meta', b.text)); return out; }
      if (b.chapterStart && !b.heading && !b.cont) out.push(el('div', 'feed-card__chapter-start', 'Chapter ' + (b.spineIndex + 1)));
      out.push(el(b.heading ? 'h3' : 'p', b.cont ? 'feed-card__cont' : null, b.text));
      return out;
    }
    function drawPage(pageEl, blocks) {
      pageEl.replaceChildren();
      blocks.forEach(function (b) { blockNodes(b).forEach(function (n) { pageEl.appendChild(n); }); });
    }

    // A book card laid out AGAIN in a box of another size (a rotation or resize): the pages read so far are kept as a place
    // (bp.carry: never lost, never moved past), the per-page read marks start over on the new pages, which are laid out to
    // keep the reader on the page holding the block they were on.
    function relayoutBook(index) {
      var bp = bookPages[index];
      if (!bp) return;
      var node = cardEls[index];
      var pageEl = node && node.querySelector('.feed-card__page');
      // the same box (a rebuild after pruning): the SAME pages, their read marks still true - just draw the page again
      if (bp.measured && pageEl && pageEl.clientHeight === bp.boxH) { showPage(index, bp.page); return; }
      if (index === activeIndex) noteBookPage(index);
      bp.carry = feedFurther(bp.carry, feedBookTarget(bp.pages, bp.read, bookEnd(bp)));
      bp.read = {}; bp.pageMs = {};
      layoutPages(index);
    }
    // the card's end as a write target: none once the pages hit FEED_MAX_PAGES (the blocks past the cap were never laid out,
    // so "every page read" must not reach the card's next - adversary r1, reasoned)
    function bookEnd(bp) { return bp.capped ? null : bp.end; }

    // Lay the card's blocks into pages that fit its page box, then draw the current page. A box that has no height yet (a
    // card not laid out) is not measured: everything goes on one page until the card is laid out (setActive, a resize).
    // Re-laying keeps the reader on the page that holds the block they were on.
    function layoutPages(index) {
      var bp = bookPages[index];
      var node = cardEls[index];
      var pageEl = node && node.querySelector('.feed-card__page');
      if (!bp || !pageEl) return;
      var anchor = bp.pages[bp.page] && bp.pages[bp.page][0];
      var box = pageEl.clientHeight;
      if (box > 0) {
        bp.pages = feedPaginate(bp.blocks, function (blocks) { drawPage(pageEl, blocks); return pageEl.scrollHeight <= pageEl.clientHeight; });
        bp.measured = true;
        bp.boxH = box;
        bp.capped = bp.pages.length >= FEED_MAX_PAGES;
      } else {
        bp.pages = bp.blocks.length ? [bp.blocks.slice()] : [];
        bp.measured = false;
      }
      bp.page = 0;
      if (anchor) {
        for (var i = 0; i < bp.pages.length; i++) {
          if (bp.pages[i].some(function (b) { return b.spineIndex === anchor.spineIndex && b.blockIndex === anchor.blockIndex && b.text === anchor.text; })) { bp.page = i; break; }
        }
      }
      showPage(index, bp.page);
    }

    function showPage(index, page) {
      var bp = bookPages[index];
      var node = cardEls[index];
      var pageEl = node && node.querySelector('.feed-card__page');
      if (!bp || !pageEl) return;
      bp.page = Math.max(0, Math.min(page, bp.pages.length - 1));
      drawPage(pageEl, bp.pages[bp.page] || []);
      var readout = node.querySelector('[data-page-readout]');
      if (readout) readout.textContent = cards[index] && cards[index].startedOver ? 'Opens at the beginning next time' : (bp.pages.length > 1 ? 'Page ' + (bp.page + 1) + ' of ' + bp.pages.length : '');
      // v1.382.0 (D7): the last page of a reading card's excerpt offers Keep reading (a new book has Start reading instead)
      var c = cards[index];
      if (c && c.kind === 'book' && !c.newBook && !c.startedOver && bp.measured && bp.page === bp.pages.length - 1) showKeepPill(index);
      else hideKeepPill(index);
    }

    // The current page's time: started when the card or the page became active, counted when it stops being on screen.
    // A page whose own dwell was met is READ; only pages read move the place (feedBookTarget).
    function noteBookPage(index) {
      var bp = bookPages[index];
      if (!bp || !bp.since) return;
      var p = bp.page;
      bp.pageMs[p] = (bp.pageMs[p] || 0) + (Date.now() - bp.since);
      bp.since = index === activeIndex ? Date.now() : 0;
      var page = bp.pages[p];
      if (page && !page.some(function (b) { return b.taste || b.desc || b.cover; }) && feedBookRead(bp.pageMs[p], feedPageDwellSec(page))) bp.read[p] = true;
    }

    // the words on the pages read (the recap's pages)
    function bookWordsRead(index) {
      var bp = bookPages[index];
      if (!bp) return 0;
      return bp.pages.reduce(function (n, page, i) { return bp.read[i] ? n + page.reduce(function (m, b) { return m + (b.end ? 0 : feedWordCount(b.text)); }, 0) : n; }, 0);
    }

    // "Start reading": the place moves to the card's start (the first real chapter, block 0) - forward-only, served-and-not-stale,
    // exactly as any move - and the reader opens. A refusal (another device started the book, or it moved) is final: the reader
    // opens on whatever the stored place really is, and a stale one is said out loud.
    function startReading(index, btn) {
      var card = cards[index];
      if (!card || startingRead[index]) return;
      startingRead[index] = true;
      if (btn) btn.disabled = true;
      var go = function () {
        if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate(card.readerHref);
        else window.location.assign(card.readerHref);
      };
      fetch('/api/feed/progress/book/' + encodeURIComponent(card.id), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card.start), keepalive: true,
      }).then(function (r) {
        if (r.status !== 409) return null;
        return r.json().then(function (body) {
          if (body && body.reason === 'stale') toast('Your place in ' + (card.title || 'this book') + ' moved on another device');
        });
      }).catch(function () {}).then(go);
    }

    function playActions(card, index, label) {
      var actions = el('div', 'feed-card__actions');
      actions.appendChild(el('span', 'feed-card__meta', label));
      var left = el('span', 'feed-card__left', '');
      left.setAttribute('data-left', '');
      actions.appendChild(left);
      // D4: a video fills the card; Fit shows the whole picture (letterboxed) - this card now, and every card after on this device
      if (card.media === 'video' || (card.kind !== 'song' && card.media !== 'podcast' && card.media !== 'audio')) {
        var fit = U() ? U().button({ variant: 'tonal', size: 'sm', pill: true, labels: ['Fit', 'Fill'], pressed: fitMode === 'fit', doc: document })
          : el('button', 'ui-btn ui-btn--tonal ui-btn--sm ui-btn--pill', 'Fit');
        fit.type = 'button';
        fit.setAttribute('data-fit-toggle', '');
        fit.setAttribute('aria-label', 'Show the whole picture');
        fit.addEventListener('click', function () { setFitMode(fitMode === 'fit' ? 'fill' : 'fit'); }, { signal: signal });
        actions.appendChild(fit);
      }
      appendCardMenu(actions, index);
      return actions;
    }

    // ---- D9: Start over - the ONE deliberate reset, from a card's "..." ----------------------------------------------
    // The card that opened the menu is the card that is reset: its index AND its card object are captured at the tap and
    // checked again at the confirm (the stack can change under an open sheet). A confirm names what is forgotten; the
    // server records the previous place in this session BEFORE it resets, and a 10 s Undo puts exactly that back.
    function appendCardMenu(actions, index) {
      var c0 = cards[index];
      if (!c0 || c0.kind === 'notice') return;
      var more = U() ? U().button({ variant: 'tonal', size: 'sm', shape: 'icon', icon: 'more_horiz', ariaLabel: 'More', doc: document })
        : el('button', 'ui-btn ui-btn--tonal ui-btn--sm ui-btn--icon', '');
      more.type = 'button';
      more.setAttribute('aria-label', 'More');
      more.setAttribute('data-card-menu', '');
      more.addEventListener('click', function () { openCardMenu(index, cards[index]); }, { signal: signal });
      actions.appendChild(more);
    }

    // v1.382.0 (D10, D11): Like / Unlike, Add to / Remove from Watch later, Start over, Hide this, Fewer from <name>. Every action
    // re-checks that the card is still the one the menu opened on.
    function openCardMenu(index, card) {
      if (!U() || !card || cards[index] !== card) return;
      var items = [];
      if (feedLikeUrl(card)) {
        var liked = feedIsLiked(card);
        items.push({ label: liked ? 'Unlike' : 'Like', icon: 'favorite', value: liked ? 'unlike' : 'like', onSelect: function () { setLiked(index, card, !liked, null); } });
      }
      if (feedWatchLaterUrl(card)) {
        var inWl = card.inWatchLater === true;
        items.push({ label: inWl ? 'Remove from Watch later' : 'Add to Watch later', icon: 'schedule', value: inWl ? 'unwatch-later' : 'watch-later', onSelect: function () { setWatchLater(index, card, !inWl); } });
      }
      if (feedStartOverKind(card) && !card.startedOver) items.push({ label: 'Start over', icon: 'history', value: 'start-over', onSelect: function () { confirmStartOver(index, card); } });
      if (feedHideTarget(card)) items.push({ label: 'Hide this', icon: 'visibility_off', value: 'hide', onSelect: function () { hideCard(index, card); } });
      var fewer = feedFewerTarget(card);
      if (fewer) items.push({ label: 'Fewer from ' + fewer.name, icon: 'remove', value: 'fewer', onSelect: function () { fewerFrom(index, card, fewer); } });
      if (!items.length) return;
      U().menu({ label: 'Card', items: items, signal: signal, doc: document });
    }

    // D10: a double tap likes (on only - a second double tap never unlikes, the TikTok rule) with a heart where the finger was.
    function likeFromGesture(index, card, x, y) {
      if (cards[index] !== card) return; // the card changed under the gesture
      showHeart(index, x, y);
      if (!feedIsLiked(card)) setLiked(index, card, true, null);
    }
    function showHeart(index, x, y) {
      var node = cardEls[index];
      if (!node) return;
      var old = node.querySelector('.feed-heart');
      if (old) old.remove();
      var heart = el('div', 'feed-heart');
      heart.setAttribute('aria-hidden', 'true');
      var NS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'ui-icon feed-heart__glyph'); // the icon sprite's symbol, as every shell's markup uses it
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      var use = document.createElementNS(NS, 'use');
      use.setAttribute('href', '#i-favorite');
      svg.appendChild(use);
      heart.appendChild(svg);
      var r = node.getBoundingClientRect();
      // where the finger was, as DATA (the CSS places it): the card's own coordinates
      heart.style.setProperty('--heart-x', Math.round((Number(x) || 0) - r.left) + 'px');
      heart.style.setProperty('--heart-y', Math.round((Number(y) || 0) - r.top) + 'px');
      node.appendChild(heart);
      var gone = window.setTimeout(function () { heart.remove(); }, FEED_HEART_MS);
      signal.addEventListener('abort', function () { window.clearTimeout(gone); });
    }
    var liking = {}; // card index -> true while its like / unlike is in flight (one request at a time)
    function setLiked(index, card, on, done) {
      var url = feedLikeUrl(card);
      if (!url || liking[index] || cards[index] !== card) return;
      liking[index] = true;
      fetch(url, { method: on ? 'POST' : 'DELETE', keepalive: true })
        .then(function (r) {
          liking[index] = false;
          if (!r.ok) { toast(on ? 'Could not like it' : 'Could not unlike it'); return; }
          if (card.kind === 'song') { card.track = card.track || {}; card.track.liked = on; } else card.liked = on;
          if (done) done();
        })
        .catch(function () { liking[index] = false; toast(on ? 'Could not like it' : 'Could not unlike it'); });
    }
    function setWatchLater(index, card, on) {
      var url = feedWatchLaterUrl(card);
      if (!url || cards[index] !== card) return;
      fetch(url, { method: on ? 'POST' : 'DELETE', keepalive: true })
        .then(function (r) {
          if (!r.ok) { toast('Could not change Watch later'); return; }
          card.inWatchLater = on;
          toast(on ? 'Added to Watch later' : 'Removed from Watch later');
        })
        .catch(function () { toast('Could not change Watch later'); });
    }

    // D11: Hide this - the item never comes back to the Feed (the server's list); this card steps aside for the next one. Undo
    // (10 s) takes it off the list again. The request and its Undo outlive the view (the Start over posture: no view signal).
    function hideCard(index, card) {
      var target = feedHideTarget(card);
      if (!target || cards[index] !== card) return;
      fetch('/api/feed/hidden', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target), keepalive: true })
        .then(function (r) {
          if (!r.ok) { toast('Could not hide it'); return; }
          if (!signal.aborted && cards[index] === card) {
            var node = cardEls[index];
            if (node) node.setAttribute('data-hidden', '');
            if (index === activeIndex && cardEls[index + 1]) cardEls[index + 1].scrollIntoView({ block: 'start' });
          }
          toast('Hidden: ' + (card.title || (card.track && card.track.title) || 'this item'), { duration: FEED_UNDO_MS, action: { label: 'Undo', onAction: function () {
            fetch('/api/feed/hidden', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target), keepalive: true })
              .then(function (u) {
                if (!u.ok) { toast('Could not undo'); return; }
                var n = cardEls[index];
                if (!signal.aborted && cards[index] === card && n) n.removeAttribute('data-hidden');
                toast('It is back in your Feed');
              })
              .catch(function () { toast('Could not undo'); });
          } } });
        })
        .catch(function () { toast('Could not hide it'); });
    }

    // D11: Fewer from <name> - the synced ft-feed-fewer list (public/js/feed-settings.js); the next batches weigh it (the server
    // reads the list from the account, so the change is sent at once rather than after the sync's one-second wait).
    function fewerFrom(index, card, target) {
      var FS = window.FileTubeFeedSettings;
      var store = localStore();
      if (!FS || !store || cards[index] !== card) return;
      var write = function (list) {
        try { store.setItem(FS.FEWER_KEY, FS.serializeFewer(list)); } catch (_) { return false; }
        try { if (window.__ftPrefsSync && typeof window.__ftPrefsSync.flush === 'function') window.__ftPrefsSync.flush(); } catch (_) { /* the debounced flush still goes */ }
        return true;
      };
      var read = function () { try { return FS.parseFewer(store.getItem(FS.FEWER_KEY)); } catch (_) { return []; } };
      if (!write(FS.fewerAdd(read(), target.key))) { toast('Could not save that'); return; }
      toast('Fewer from ' + target.name, { duration: FEED_UNDO_MS, action: { label: 'Undo', onAction: function () {
        if (write(FS.fewerRemove(read(), target.key))) toast('Back to the usual for ' + target.name);
      } } });
    }

    function confirmStartOver(index, card) {
      if (!U() || cards[index] !== card) return;
      U().confirm({ title: 'Start over?', body: feedStartOverText(card), confirmLabel: 'Start over', danger: true, signal: signal, doc: document })
        .then(function (yes) { if (yes && cards[index] === card) startOver(index, card); });
    }

    var startingOver = {}; // card index -> true while its Start over is in flight (one request, never two)
    // gate r1 (qa W1, adversary W1): the request and its Undo OUTLIVE the view. The toast lives on <body> and survives a
    // navigation, so neither fetch rides the view's abort signal and both use the session id captured at the tap (the
    // view may have reset or started a new session by the time Undo is tapped). Only the CARD's update is skipped once the
    // view is gone (signal.aborted): its DOM is detached.
    function startOver(index, card) {
      var kind = feedStartOverKind(card);
      if (!kind || !session || startingOver[index]) return;
      var sid = session.id;
      startingOver[index] = true;
      if (mediaCardIndex === index) { var p = player(); if (p && typeof p.pause === 'function') p.pause(); }
      fetch('/api/feed/start-over', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sid, kind: kind, id: card.id }), keepalive: true })
        .then(function (r) { return r.json().then(function (body) { return { status: r.status, body: body }; }); })
        .then(function (res) {
          startingOver[index] = false;
          if (res.status === 409 && res.body && res.body.reason === 'nothing') { toast('Nothing to start over: it was not started'); return; }
          if (res.status === 409 && res.body && res.body.reason === 'unrestorable') { toast('Could not start over: its saved place could not be undone, so it was kept'); return; }
          if (res.status !== 200 || !res.body || !res.body.token) { toast('Could not start over'); return; }
          var before = { fresh: card.fresh, progress: card.progress, position: card.position, startAt: card.startAt, endAt: card.endAt, chapter: card.chapter, skippedIntro: card.skippedIntro };
          if (!signal.aborted && cards[index] === card) applyStartedOver(index, card, kind);
          toast(feedStartedOverText(card, res.body.previous), { duration: FEED_UNDO_MS, action: { label: 'Undo', onAction: function () { undoStartOver(index, card, kind, res.body.token, before, sid); } } });
        })
        .catch(function () { startingOver[index] = false; toast('Could not start over'); });
    }
    // the card says New and plays from the start (a media card); a book card says it starts over and moves nothing more
    function applyStartedOver(index, card, kind) {
      if (kind === 'book') {
        card.startedOver = true;
        var bp = bookPages[index];
        if (bp) bp.refused = true; // the server forgot the serve too: this card can never set a place again
        var node = cardEls[index];
        var kindEl = node && node.querySelector('.feed-card__kind');
        if (kindEl) kindEl.textContent = 'Book \u00b7 Started over';
        var readout = node && node.querySelector('[data-page-readout]');
        if (readout) readout.textContent = 'Opens at the beginning next time';
        return;
      }
      var slice = (Number(card.endAt) || 0) - (Number(card.startAt) || 0);
      var dur = Number(card.media === 'podcast' ? card.durationSec : card.duration) || 0;
      card.fresh = true;
      card.progress = 0;
      card.position = 0;
      card.startAt = 0;
      card.endAt = slice > 0 ? (dur > 0 ? Math.min(dur, slice) : slice) : card.endAt;
      card.chapter = null;
      card.skippedIntro = false;
      refillMediaCard(index);
    }

    function refillMediaCard(index) {
      var node = cardEls[index];
      if (!node) return;
      node.removeAttribute('data-done');
      fillCard(node, cards[index], index);
      if (index === activeIndex) playCard(index);
    }

    function undoStartOver(index, card, kind, token, before, sid) {
      fetch('/api/feed/start-over/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sid, token: token }), keepalive: true })
        .then(function (r) { return r.json().then(function (body) { return { status: r.status, body: body }; }); })
        .then(function (res) {
          if (res.status === 409 && res.body && res.body.reason === 'moved') { toast('Could not undo: it was played since'); return; }
          if (res.status !== 200) { toast('Could not undo'); return; }
          toast('Your place is back: ' + (card.title || 'this item'));
          if (signal.aborted || cards[index] !== card) return; // the view is gone: the place is back, nothing to redraw
          if (kind === 'book') {
            card.startedOver = false;
            var node = cardEls[index];
            var kindEl = node && node.querySelector('.feed-card__kind');
            if (kindEl) kindEl.textContent = feedKindLine(card);
            var readout = node && node.querySelector('[data-page-readout]');
            if (readout) readout.textContent = 'Your place is back';
            return;
          }
          Object.keys(before).forEach(function (k) { card[k] = before[k]; });
          refillMediaCard(index);
        })
        .catch(function () { toast('Could not undo'); });
    }

    // D4: Fill (the default: object-fit cover, a landscape video cropped like a phone feed) or Fit (contain, letterboxed).
    // Remembered per device (localStorage, try/caught); every mounted video card follows at once.
    function setFitMode(mode) {
      fitMode = mode === 'fit' ? 'fit' : 'fill';
      writePref(FEED_FIT_KEY, fitMode);
      cardEls.forEach(function (n) { if (n.getAttribute('data-media') === 'video') n.setAttribute('data-fit', fitMode); });
      Array.prototype.forEach.call(stack.querySelectorAll('[data-fit-toggle]'), function (b) {
        if (U() && typeof U().setPressed === 'function') U().setPressed(b, fitMode === 'fit');
        b.setAttribute('aria-label', fitMode === 'fit' ? 'Fill the screen' : 'Show the whole picture');
      });
    }

    // Heavy content far behind the active card is dropped (the card keeps its height so the
    // scroll never jumps) and rebuilt when the user swipes back to it.
    function pruneBehind(active) {
      cardEls.forEach(function (node, i) {
        if (i < active - FEED_KEEP_BEHIND) {
          if (cards[i] && cards[i].kind === 'notice') return; // one line of text: nothing heavy to drop
          if (!node.hasAttribute('data-pruned')) { node.setAttribute('data-pruned', ''); node.replaceChildren(el('div', 'feed-card__kind', feedKindLine(cards[i]))); }
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
      // the HUD reads light over a picture or art, the page's own ink over a book page
      if (node.hasAttribute('data-media')) sessionEl.setAttribute('data-on-media', ''); else sessionEl.removeAttribute('data-on-media');
      if (index > 0) clearHint();
      else if (hintPending) { hintPending = false; showHint(node); }
      if (card.kind === 'book') {
        var bp = bookPages[index];
        if (bp && !bp.measured) layoutPages(index); // laid out now: fit the pages to the real box
        if (bp) bp.since = Date.now();
        if (pageHintPending && bp && bp.pages.length > 1 && !document.getElementById('feed-hint')) { pageHintPending = false; showHint(node, 'Swipe left for the next page', FEED_PAGE_HINT_KEY); }
      } else playCard(index);
      pruneBehind(index);
      if (feedShouldPrefetch(index, cards.length)) fetchBatch();
    }

    // R3, D3: a small "Swipe up" cue at the bottom of the FIRST card of a session, on the first FEED_HINT_SESSIONS sessions a device
    // starts. It fades after the first swipe or FEED_HINT_MS; a per-device count in localStorage (try/caught) ends it for good.
    // v1.381.0 (D11): the same cue says "Swipe left for the next page" on the first BOOK card (with more than one page) of a
    // session, on the first FEED_HINT_SESSIONS sessions, counted on its own key.
    function showHint(node, text, key) {
      var k = key || FEED_HINT_KEY;
      var count = parseInt(readPref(k, '0'), 10) || 0;
      if (!feedHintShouldShow(count)) return;
      writePref(k, count + 1);
      clearHint();
      var hint = el('div', 'feed-hint');
      hint.id = 'feed-hint';
      hint.setAttribute('aria-hidden', 'true');
      var NS = 'http://www.w3.org/2000/svg';
      var chev = document.createElementNS(NS, 'svg');
      chev.setAttribute('class', 'feed-hint__chevron'); chev.setAttribute('viewBox', '0 0 24 24'); chev.setAttribute('aria-hidden', 'true'); chev.setAttribute('focusable', 'false');
      var chevPath = document.createElementNS(NS, 'path');
      chevPath.setAttribute('d', k === FEED_PAGE_HINT_KEY ? 'M15 6l-6 6 6 6' : 'M6 15l6-6 6 6'); // left for a page, up for a card
      chev.appendChild(chevPath);
      hint.appendChild(chev);
      if (k === FEED_PAGE_HINT_KEY) hint.setAttribute('data-page-hint', '');
      hint.appendChild(el('span', 'feed-hint__text', text || 'Swipe up'));
      (node.querySelector('.feed-card__stage') || node).appendChild(hint); // above the overlay, never over its buttons
      hintTimer = window.setTimeout(clearHint, FEED_HINT_MS);
    }
    function clearHint() {
      if (hintTimer) { window.clearTimeout(hintTimer); hintTimer = null; }
      var h = document.getElementById('feed-hint');
      if (h) h.remove();
    }

    function leaveCard(index) {
      var card = cards[index];
      if (!card) return;
      if (card.kind === 'book') {
        noteBookPage(index);
        if (bookPages[index]) bookPages[index].since = 0;
        finishBookCard(index);
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
      var counts = cards[index];
      if (counts.kind === 'book') {
        // v1.381.0 (D6): the pages READ, each its own dwell (a taste, a description or a cover is never a page read)
        var words = counts.newBook ? 0 : bookWordsRead(index);
        a.read = words > 0;
        counts = Object.assign({}, counts, { words: words });
      }
      feedCountActivity(summary, counts, a);
      if (session) { session.summary = summary; writeSession(session); } // the recap survives a navigation (W3)
    }

    // v1.381.0 (D6): the bookmark moves only as far as the pages READ (each page its own dwell, in order from the first:
    // feedBookTarget), forward only, through the feed's rule. Every page read: the card's end (its `next`, or the book's end
    // through the same served / not-stale rule). A card can move the place again when more of it is read later (a page
    // read on a return), never back. A refusal (another device moved on, a stale card) is final for this card: the next
    // book card the feed serves starts from wherever the place really is.
    function finishBookCard(index) {
      var card = cards[index];
      var bp = bookPages[index];
      if (!card || !bp || bp.refused) return;
      if (card.newBook) return; // an unstarted book is only ever started by the "Start reading" tap (R4): no dwell moves its place
      var target = feedFurther(feedBookTarget(bp.pages, bp.read, bookEnd(bp)), bp.carry);
      if (!target || (bp.written && feedFurther(bp.written, target) === bp.written)) return; // nothing new read
      bp.written = target;
      fetch('/api/feed/progress/book/' + encodeURIComponent(card.id), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target), keepalive: true,
      }).then(function (r) {
        // gate r2 (adversary W6): the place moved, so a parked book is servable again - when nothing real is queued ahead
        // (a single-book library: the batch after this card was empty), fetch now rather than on the next swipe
        if (r.ok && !cards.slice(index + 1).some(function (c) { return c && c.kind !== 'notice'; })) {
          if (loading) refetchWanted = true; // the prefetch that left beside this write saw the book still parked
          else fetchBatch();
        }
        if (r.status !== 409) return null;
        return r.json().then(function (body) {
          // v1.382.0 (D4): a card read From the beginning is BEHIND its saved place: the place stays (refused as backward) and
          // the card may still move it once the pages read pass it - only that refusal leaves the card able to write
          if (card.fromStart === true && body && body.reason === 'backward') { bp.written = null; return; }
          bp.refused = true;
          // gate r1 (qa S2): only a STALE refusal is news to the user; backward / not-served are the feed's own
          if (body && body.reason === 'stale') toast('Your place in ' + (card.title || 'this book') + ' moved on another device');
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
      // v1.380.0 (R5, D7): a FRESH card writes nothing until a minute of actual playback. The guard rides the descriptor into the
      // shared player, whose ONE progress writer (saveProgressToServer: pings, the pause / background checkpoint, a seek, the end)
      // asks it before every POST and reports the played seconds the server checks again. Not-fresh cards carry no guard.
      var tracker = card.fresh === true && card.kind !== 'song' ? feedNewPlayTracker() : null;
      var needSec = feedFreshNeedSec(card.media === 'podcast' ? card.durationSec : card.duration, (Number(card.endAt) || 0) - (Number(card.startAt) || 0));
      if (tracker) {
        data.progressGate = function () { return feedFreshStarted(tracker, needSec); };
        data.playedSec = function () { return tracker.sec; };
      }
      mediaCardIndex = index;
      p.load(card.id, data, { slot: slot });
      mediaEl = document.getElementById('media-player');
      if (!mediaEl) return;
      var endAt = card.kind === 'song' ? null : Number(card.endAt);
      var left = node.querySelector('[data-left]');
      var line = node.querySelector('.feed-card__progress');
      var act = activity[index] = activity[index] || { playedSec: 0, done: false, ended: false };
      var startAt = Number(data.startAt) || 0;
      if (card.skippedIntro && startAt > 0) showIntroNote(node, startAt);
      var onTime = function () {
        if (mediaCardIndex !== index || !mediaEl) return;
        var t = mediaEl.currentTime || 0;
        act.playedSec = Math.max(act.playedSec, t - startAt);
        if (endAt !== null && isFinite(endAt)) {
          var remain = endAt - t;
          if (feedKeepDue(remain, act.done, act.ended)) showKeepPill(index); // v1.382.0 (D7): the way out, near the end
          if (left) left.textContent = remain > 0 ? feedClock(remain) + ' left' : 'Done';
          if (line && endAt > startAt) line.style.setProperty('--p', String(Math.round(Math.min(1, Math.max(0, (t - startAt) / (endAt - startAt))) * 1000) / 1000));
          if (remain <= 0 && !node.hasAttribute('data-done')) {
            node.setAttribute('data-done', '');
            act.done = true;
            showKeepPill(index);
            p.pause();
            if (windingDown) finishNow(); // D11: the slice finished after time up
          }
        } else if (left && isFinite(mediaEl.duration)) {
          left.textContent = feedClock(mediaEl.duration - t) + ' left';
        }
      };
      mediaEl.addEventListener('timeupdate', onTime, { signal: signal });
      // The played-time tracker is NOT tied to this view's signal (gate r1, adversary C1): the player keeps playing in the dock after
      // the Feed is left, and its progress gate closes over this tracker - a tracker that died with the view would keep the gate shut
      // for the rest of the listen and the item would never save. It stops when the minute is played or the player loads something else.
      if (tracker) {
        var media = mediaEl;
        var src0 = null;
        var track = function () {
          var src = media.currentSrc || media.src || '';
          if (src0 === null) src0 = src;
          else if (src !== src0) { release(); return; } // the player moved on to another item
          feedPlayedStep(tracker, media.currentTime || 0, Date.now(), !media.paused && !media.ended, media.playbackRate);
          if (feedFreshStarted(tracker, needSec)) release();
        };
        var release = function () { media.removeEventListener('timeupdate', track); };
        media.addEventListener('timeupdate', track);
      }
      mediaEl.addEventListener('ended', function () {
        if (mediaCardIndex !== index) return;
        node.setAttribute('data-done', '');
        act.ended = true;
        act.done = true;
        hideKeepPill(index); // the whole file ended: nothing is left to keep watching
        if (windingDown) finishNow();
      }, { signal: signal });
    }

    // ---- v1.382.0 (D7): Keep watching / listening / reading - leave the Feed into the full item -----------------------------
    // A pill above the overlay text in a slice's last FEED_KEEP_SEC seconds and on its Done state (a book: on the last page of
    // the card). It is a BUTTON in the overlay, above the gesture layer: its tap is never a play / pause tap. Tapping it ends the
    // session as Done would (the card counted, the record and recap saved) WITHOUT the recap, and opens the item in its own
    // place; a media card's shared player is carried over still playing, from where the card got to.
    function showKeepPill(index) {
      var node = cardEls[index];
      var card = cards[index];
      if (!node || !card || node.querySelector('[data-keep]')) return;
      var overlay = node.querySelector('.feed-card__overlay');
      if (!overlay || (card.kind !== 'book' && !feedKeepHref(card))) return;
      var label = feedKeepLabel(card);
      var pill = U() ? U().button({ variant: 'primary', size: 'sm', pill: true, icon: 'open_in_new', label: label, doc: document })
        : el('button', 'ui-btn ui-btn--primary ui-btn--sm ui-btn--pill', label);
      pill.type = 'button';
      pill.classList.add('feed-card__keep');
      pill.setAttribute('data-keep', '');
      pill.addEventListener('click', function (e) {
        if (e) e.stopPropagation();
        if (cards[index] !== card) return; // the card changed under the tap
        keepGoing(index, card);
      }, { signal: signal });
      overlay.insertBefore(pill, overlay.firstChild);
    }
    function hideKeepPill(index) {
      var pill = cardEls[index] && cardEls[index].querySelector('[data-keep]');
      if (pill) pill.remove();
    }
    var leaving = false;
    function keepGoing(index, card) {
      if (leaving || !session) return;
      leaving = true;
      var href = card.kind === 'book' ? card.readerHref : feedKeepHref(card);
      if (!href) { leaving = false; return; }
      var p = player();
      // a media card: the player plays on (a Done slice is resumed inside this tap: iOS needs the gesture)
      if (card.kind !== 'book' && mediaCardIndex === index && p && typeof p.play === 'function' && mediaEl && mediaEl.paused) { try { p.play(); } catch (_) { /* the full place starts it */ } }
      if (card.kind === 'book') { noteBookPage(index); finishBookCard(index); }
      countCard(index); // counted as left - the slice's time, a book's pages read
      if (tickTimer) { window.clearInterval(tickTimer); tickTimer = null; }
      postFinish(); // the session's record, as Done would (no recap: the user is going on)
      mediaCardIndex = -1; // the player is the full place's now: nothing here pauses or closes it
      // the session is over (a return to /feed shows the picker), but the stack is NOT torn down here: the card's slot still
      // holds the player, and taking a playing media element out of the document pauses it (measured in Chromium: the watch
      // page received it paused). The navigation docks the player first and the view's teardown follows.
      session = null;
      writeSession(null);
      if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate(href);
      else window.location.assign(href);
    }

    // D8: "Skipped the intro" for 3 s, tap to go back to the start. The tap is a seek (it adds no played time).
    function showIntroNote(node, startAt) {
      var existing = node.querySelector('.feed-card__intro-note');
      if (existing) existing.remove();
      var note = U() ? U().button({ variant: 'tonal', size: 'sm', pill: true, label: 'Skipped the intro \u00b7 tap to go back', doc: document })
        : el('button', 'ui-btn ui-btn--tonal ui-btn--sm ui-btn--pill', 'Skipped the intro \u00b7 tap to go back');
      note.classList.add('feed-card__intro-note');
      note.type = 'button';
      var gone = window.setTimeout(function () { note.remove(); }, FEED_INTRO_NOTE_MS);
      signal.addEventListener('abort', function () { window.clearTimeout(gone); });
      note.addEventListener('click', function () {
        window.clearTimeout(gone);
        note.remove();
        if (mediaEl && isFinite(startAt)) mediaEl.currentTime = 0;
      }, { signal: signal });
      (node.querySelector('.feed-card__stage') || node).appendChild(note); // under the HUD strip, clear of the overlay
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
        .catch(function () { toast('Could not add ten minutes'); });
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
      cards = []; cardEls = []; activeIndex = -1; ratios = {}; exhaustedShown = false; activity = {}; counted = {}; bookPages = {}; startingRead = {};
      summary = feedEmptySummary(); extensions = 0; windingDown = false; hardStopMs = NaN; hintPending = false; pageHintPending = false; clearHint();
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

    // D6: a rotation or a resize changes what fits on a page. The pages read so far are kept as a place (carry), then every
    // book card is laid out again on the page that holds the block the reader was on.
    var relayoutTimer = null;
    window.addEventListener('resize', function () {
      if (relayoutTimer) window.clearTimeout(relayoutTimer);
      relayoutTimer = window.setTimeout(function () {
        relayoutTimer = null;
        Object.keys(bookPages).forEach(function (k) {
          var i = Number(k);
          var bp = bookPages[i];
          if (!bp || !cardEls[i] || cardEls[i].hasAttribute('data-pruned')) return;
          relayoutBook(i);
        });
      }, 150);
    }, { signal: signal });
    signal.addEventListener('abort', function () { if (relayoutTimer) window.clearTimeout(relayoutTimer); });


    // Leaving the page mid-card: a read book card still moves its bookmark (keepalive).
    signal.addEventListener('abort', function () {
      if (activeIndex >= 0 && cards[activeIndex] && cards[activeIndex].kind === 'book') leaveCard(activeIndex);
      if (observer) { observer.disconnect(); observer = null; }
      if (tickTimer) { window.clearInterval(tickTimer); tickTimer = null; }
      if (peekTimer) { window.clearTimeout(peekTimer); peekTimer = null; }
      if (hintTimer) { window.clearTimeout(hintTimer); hintTimer = null; }
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
