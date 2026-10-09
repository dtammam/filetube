// FileTube Feed (v1.379.0) -- the /feed view module (lib/feed/shell.js serves the shell;
// the history.js / cleanup.js registered-view pattern). Plan docs/exec-plans/active/
// 2026-10-09-feed-mode.md, D1-D9 in this wave; the time limit and the recap are W4.
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
    if (!c || c.kind === 'book' || typeof c.id !== 'string') return;
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FEED_LENGTH_CHOICES, FEED_LENGTH_KEY, FEED_SESSION_KEY, FEED_BATCH, FEED_PREFETCH_AHEAD, FEED_KEEP_BEHIND, FEED_ACTIVE_RATIO,
    feedNormalizeMinutes, feedWeekLine, feedClock, feedKindLabel, feedActiveIndex, feedShouldPrefetch, feedExcludeIds,
    feedPlayerDescriptor, feedBookRead,
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
    var exhaustedShown = false;
    var observer = null;
    var mediaEl = null; // the live media element while a media card plays
    var mediaCardIndex = -1;
    var bookActiveSince = 0; // ms clock when the active book card became active
    var bookActiveMs = {}; // card index -> accumulated active ms
    var bookWritten = {}; // card index -> true once the bookmark moved (or was refused)

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
    if (live && live.id) { session = live; showStack(); fetchBatch(); }

    function startSession(min) {
      writePref(FEED_LENGTH_KEY, min);
      fetch('/api/feed/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plannedMin: min }), signal: signal })
        .then(function (r) { if (!r.ok) throw new Error('session ' + r.status); return r.json(); })
        .then(function (body) {
          if (signal.aborted) return;
          session = { id: body.session.id, plannedMin: body.session.plannedMin, startedAt: body.session.startedAt };
          writeSession(session);
          showStack();
          fetchBatch();
        })
        .catch(function () { if (U()) U().toast({ text: 'Could not start the feed', doc: document }); });
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
      stack.setAttribute('aria-busy', 'true');
      var exclude = feedExcludeIds(cards);
      var url = '/api/feed?session=' + encodeURIComponent(session.id) + '&count=' + FEED_BATCH + (exclude.length ? '&exclude=' + exclude.map(encodeURIComponent).join(',') : '');
      fetch(url, { signal: signal })
        .then(function (r) {
          if (r.status === 404) { endSession(true); throw new Error('session gone'); }
          if (!r.ok) throw new Error('feed ' + r.status);
          return r.json();
        })
        .then(function (body) {
          if (signal.aborted) return;
          if (body.exhausted && !exhaustedShown) {
            exhaustedShown = true;
            stack.appendChild(el('div', 'feed-notice', 'You’re through everything new. From here the feed starts over.'));
          }
          if (!body.cards.length && !cards.length) {
            showEmpty();
            return;
          }
          body.cards.forEach(appendCard);
          if (activeIndex < 0 && cardEls.length) setActive(0);
        })
        .catch(function () { /* a failed batch leaves the stack as it is; the next swipe retries */ })
        .then(function () { loading = false; stack.setAttribute('aria-busy', 'false'); });
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
          finishBookCard(index, true);
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
        return;
      }
      if (mediaCardIndex === index) pauseMedia();
    }

    // The bookmark moves to the card's `next` - forward only, through the feed's rule. A
    // refusal (another device moved on, or a stale card) is final for this card: the next
    // book card the feed serves starts from wherever the place really is.
    function finishBookCard(index, force) {
      var card = cards[index];
      if (!card || bookWritten[index]) return;
      if (!force && !feedBookRead(bookActiveMs[index], card.dwellSec)) return;
      bookWritten[index] = true;
      if (!card.next) {
        if (card.atEnd) fetch('/api/books/' + encodeURIComponent(card.id) + '/finished', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ finished: true }), keepalive: true }).catch(function () {});
        return;
      }
      fetch('/api/feed/progress/book/' + encodeURIComponent(card.id), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card.next), keepalive: true,
      }).then(function (r) {
        if (r.status === 409 && U()) U().toast({ text: 'Your place in ' + (card.title || 'this book') + ' moved on another device', doc: document });
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
      var onTime = function () {
        if (mediaCardIndex !== index || !mediaEl) return;
        var t = mediaEl.currentTime || 0;
        if (endAt !== null && isFinite(endAt)) {
          var remain = endAt - t;
          if (left) left.textContent = remain > 0 ? feedClock(remain) + ' left' : 'Done';
          if (remain <= 0 && !node.hasAttribute('data-done')) {
            node.setAttribute('data-done', '');
            p.pause();
          }
        } else if (left && isFinite(mediaEl.duration)) {
          left.textContent = feedClock(mediaEl.duration - t) + ' left';
        }
      };
      mediaEl.addEventListener('timeupdate', onTime, { signal: signal });
      mediaEl.addEventListener('ended', function () { if (mediaCardIndex === index) node.setAttribute('data-done', ''); }, { signal: signal });
    }

    function pauseMedia() {
      var p = player();
      if (p && typeof p.pause === 'function') p.pause();
      mediaCardIndex = -1;
    }

    // ---- leaving --------------------------------------------------------------------
    function endSession(gone) {
      if (activeIndex >= 0) leaveCard(activeIndex);
      pauseMedia();
      var p = player();
      if (p && typeof p.close === 'function') p.close();
      var s = session;
      session = null;
      writeSession(null);
      if (s && !gone) {
        fetch('/api/feed/sessions/' + encodeURIComponent(s.id) + '/finish', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
          body: JSON.stringify({ actualSec: Math.max(0, Math.round((Date.now() - Date.parse(s.startedAt)) / 1000)), summary: { cards: cards.length } }),
        }).catch(function () {});
      }
      cards = []; cardEls = []; activeIndex = -1; ratios = {}; exhaustedShown = false;
      stack.replaceChildren();
      sessionEl.hidden = true;
      picker.hidden = false;
      fetch('/api/feed/sessions/week', { signal: signal }).then(function (r) { return r.ok ? r.json() : null; }).then(function (week) {
        if (!signal.aborted && weekEl) weekEl.textContent = feedWeekLine(week);
      }).catch(function () {});
    }
    if (doneBtn) doneBtn.addEventListener('click', function () { endSession(false); }, { signal: signal });

    // Leaving the page mid-card: a read book card still moves its bookmark (keepalive).
    signal.addEventListener('abort', function () {
      if (activeIndex >= 0 && cards[activeIndex] && cards[activeIndex].kind === 'book') leaveCard(activeIndex);
      if (observer) { observer.disconnect(); observer = null; }
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
