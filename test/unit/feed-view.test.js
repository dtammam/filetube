'use strict';

// [UNIT] v1.379.0 Feed mode W3: the /feed view (public/js/feed.js) - its pure helpers, and the
// REAL view wired in a jsdom realm (the watch-view-harness posture: the feed shell's markup,
// the real ui.js + common.js, a recording fetch, a stub shared player). LESSONS 2: a pure
// decision binds the rule; the wiring tests drive the real init() through the real DOM and
// count the effects (the session POST, the batch GET with the exclusions, the cards built,
// player.load with the card's slot and descriptor, the book write after the dwell, the toast
// on a refusal, destroy aborting everything).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const feed = require('../../public/js/feed.js');

// ---- pure helpers ---------------------------------------------------------------------

test('feedNormalizeMinutes: 10 / 20 / 30 only, else 20', () => {
  assert.strictEqual(feed.feedNormalizeMinutes('10'), 10);
  assert.strictEqual(feed.feedNormalizeMinutes(30), 30);
  assert.strictEqual(feed.feedNormalizeMinutes('15'), 20);
  assert.strictEqual(feed.feedNormalizeMinutes(null), 20);
});

test('feedWeekLine: hours and minutes, session plural, empty when nothing yet', () => {
  assert.strictEqual(feed.feedWeekLine({ sessions: 5, totalSec: 4800 }), 'This week: 1 h 20 min in Feed, 5 sessions');
  assert.strictEqual(feed.feedWeekLine({ sessions: 1, totalSec: 600 }), 'This week: 10 min in Feed, 1 session');
  assert.strictEqual(feed.feedWeekLine({ sessions: 2, totalSec: 7200 }), 'This week: 2 h in Feed, 2 sessions');
  assert.strictEqual(feed.feedWeekLine({ sessions: 0, totalSec: 0 }), '');
  assert.strictEqual(feed.feedWeekLine(null), '');
});

test('feedClock and feedKindLabel', () => {
  assert.strictEqual(feed.feedClock(240), '4:00');
  assert.strictEqual(feed.feedClock(65.4), '1:05');
  assert.strictEqual(feed.feedClock(-3), '0:00');
  assert.strictEqual(feed.feedKindLabel({ kind: 'watchlater' }), 'Watch later');
  assert.strictEqual(feed.feedKindLabel({ kind: 'video', media: 'video' }), 'Video');
  assert.strictEqual(feed.feedKindLabel({ kind: 'video', media: 'audio' }), 'Audio');
  assert.strictEqual(feed.feedKindLabel({ kind: 'book' }), 'Book');
  assert.strictEqual(feed.feedKindLabel(null), '');
});

test('feedActiveIndex: the most visible card at or above 60%, none mid-swipe', () => {
  assert.strictEqual(feed.feedActiveIndex([{ index: 0, ratio: 0.3 }, { index: 1, ratio: 0.7 }]), 1);
  assert.strictEqual(feed.feedActiveIndex([{ index: 0, ratio: 0.5 }, { index: 1, ratio: 0.5 }]), -1);
  assert.strictEqual(feed.feedActiveIndex([{ index: 2, ratio: 0.6 }]), 2, 'exactly the floor counts');
  assert.strictEqual(feed.feedActiveIndex([]), -1);
  assert.strictEqual(feed.feedActiveIndex([{ index: 0, ratio: 0.95 }, { index: 1, ratio: 0.61 }]), 0);
});

test('feedShouldPrefetch: within two cards of the end, or nothing loaded', () => {
  assert.strictEqual(feed.feedShouldPrefetch(-1, 0), true);
  assert.strictEqual(feed.feedShouldPrefetch(0, 5), false);
  assert.strictEqual(feed.feedShouldPrefetch(1, 5), false);
  assert.strictEqual(feed.feedShouldPrefetch(2, 5), true);
  assert.strictEqual(feed.feedShouldPrefetch(4, 5), true);
});

test('feedExcludeIds: every shown non-book id once; books never (they continue)', () => {
  assert.deepStrictEqual(feed.feedExcludeIds([{ kind: 'book', id: 'b' }, { kind: 'video', id: 'v' }, { kind: 'song', id: 's' }, { kind: 'video', id: 'v' }, { kind: 'watchlater', id: 'w' }]), ['v', 's', 'w']);
  assert.deepStrictEqual(feed.feedExcludeIds([]), []);
});

test('feedPlayerDescriptor: each kind starts at the card\'s startAt and saves through the feed\'s route; a song is music\'s own, from the top', () => {
  const pod = feed.feedPlayerDescriptor({ kind: 'podcast', media: 'podcast', id: 'e', title: 'Ep', showName: 'Show', subId: 's1', artUrl: '/podcastart/s1', streamSrc: '/episode/e', durationSec: 1800, startAt: 600, endAt: 840 });
  assert.deepStrictEqual(pod, { type: 'audio', title: 'Ep', channelName: 'Show', folderName: 'Show', duration: 1800, artUrl: '/podcastart/s1', streamSrc: '/episode/e', progressEndpoint: '/api/feed/progress/podcast', resumeMode: 'podcast', subId: 's1', startAt: 600, autoAdvanceViaTrackNav: false, browseCtx: '', readerHref: '/feed' });
  const vid = feed.feedPlayerDescriptor({ kind: 'watchlater', media: 'video', id: 'v', title: 'V', channelName: 'C', duration: 1200, width: 720, height: 1280, startAt: 400, endAt: 900 });
  assert.strictEqual(vid.type, 'video');
  assert.strictEqual(vid.progressEndpoint, '/api/feed/progress/media');
  assert.strictEqual(vid.startAt, 400);
  assert.strictEqual(vid.resumeMode, null);
  assert.strictEqual(vid.height, 1280);
  const aud = feed.feedPlayerDescriptor({ kind: 'video', media: 'audio', id: 'a', startAt: 0 });
  assert.strictEqual(aud.type, 'audio');
  const song = feed.feedPlayerDescriptor({ kind: 'song', id: 't1', track: { id: 't1', title: 'S', artist: 'A', album: 'Al', durationSec: 200, artV: 'v9' } });
  assert.strictEqual(song.progressEndpoint, '/api/music/progress');
  assert.strictEqual(song.resumeMode, 'music');
  assert.strictEqual(song.startAt, 0);
  assert.strictEqual(song.streamSrc, '/track/t1');
  assert.strictEqual(song.artUrl, '/albumart/t1?v=v9');
  const lib = feed.feedPlayerDescriptor({ kind: 'song', id: 'm1', track: { id: 'm1', source: 'library', streamSrc: '/video/m1', artUrl: '/thumbnail/m1', progressEndpoint: '/api/progress' } });
  assert.strictEqual(lib.streamSrc, '/video/m1');
  assert.strictEqual(lib.progressEndpoint, '/api/progress', 'a projected library track keeps its own routes (the music.js rule)');
  assert.strictEqual(feed.feedPlayerDescriptor(null), null);
});

test('player adopt (gate r1, adversary C1): the progress route travels with the surface - a feed card\'s route is dropped by the watch page\'s null, taken by a feed card, replaced by the podcasts page\'s own', () => {
  const { applyAdoptFlavor } = require('../../public/js/player.js');
  const fromFeed = { progressEndpoint: '/api/feed/progress/media', resumeMode: undefined };
  applyAdoptFlavor(fromFeed, { browseCtx: '', readerHref: null, resumeMode: null, autoAdvanceViaTrackNav: false, progressEndpoint: null, startAt: 8 });
  assert.strictEqual(fromFeed.progressEndpoint, undefined, 'the watch page saves through /api/progress again');
  const onWatch = { progressEndpoint: undefined };
  applyAdoptFlavor(onWatch, feed.feedPlayerDescriptor(VID));
  assert.strictEqual(onWatch.progressEndpoint, '/api/feed/progress/media', 'a card adopting the playing video saves through the feed\'s rule');
  const pod = { progressEndpoint: '/api/feed/progress/podcast' };
  applyAdoptFlavor(pod, { progressEndpoint: '/api/podcasts/progress', resumeMode: 'podcast' });
  assert.strictEqual(pod.progressEndpoint, '/api/podcasts/progress');
  const untouched = { progressEndpoint: '/api/tv/progress' };
  applyAdoptFlavor(untouched, { title: 'x' });
  assert.strictEqual(untouched.progressEndpoint, '/api/tv/progress', 'a load that says nothing about it leaves it');
  // and the watch page's loads all declare it (the contract this test binds)
  const watch = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');
  assert.strictEqual((watch.match(/progressEndpoint: null/g) || []).length, 3, 'the early load, the seed load and the data load');
});

test('feedBookRead: active for at least dwellSec (floor 5 s)', () => {
  assert.strictEqual(feed.feedBookRead(54000, 54), true);
  assert.strictEqual(feed.feedBookRead(53999, 54), false);
  assert.strictEqual(feed.feedBookRead(5000, 1), true);
  assert.strictEqual(feed.feedBookRead(0, 0), false);
});

// ---- the real view in a jsdom realm (test/helpers/feed-view-harness.js) -----------------------

const { feedRealm, BOOK, POD, VID, SONG, WL } = require('../helpers/feed-view-harness');
void POD; void VID; void SONG; void WL;

test('view: the picker shows three choices with the last pick primary, and the week line', async () => {
  const r = feedRealm();
  try {
    r.w.localStorage.setItem(feed.FEED_LENGTH_KEY, '30');
    r.init();
    await r.settle();
    const btns = r.$$('#feed-picker-choices button');
    assert.deepStrictEqual(btns.map((b) => b.getAttribute('data-minutes')), ['10', '20', '30']);
    assert.ok(btns[2].className.includes('ui-btn--primary'), 'the last choice is preselected');
    assert.strictEqual(r.$('#feed-week').textContent, 'This week: 25 min in Feed, 2 sessions');
    assert.strictEqual(r.$('#feed-session').hidden, true);
  } finally { r.close(); }
});

test('view: a pick starts a session, fetches the first batch, builds every card kind as text and slots, activates card 0', async () => {
  const r = feedRealm();
  try {
    r.init();
    await r.settle();
    r.$('#feed-picker-choices button[data-minutes="10"]').click();
    await r.settle();
    assert.deepStrictEqual(r.calls('POST', '/api/feed/sessions').map((f) => f.body), [{ plannedMin: 10 }]);
    assert.strictEqual(r.w.localStorage.getItem(feed.FEED_LENGTH_KEY), '10');
    const batch = r.calls('GET', '/api/feed?');
    assert.strictEqual(batch.length, 1);
    assert.strictEqual(batch[0].url, '/api/feed?session=abcdef0123456789&count=5', 'the first batch excludes nothing');
    assert.strictEqual(r.$('#feed-picker').hidden, true);
    assert.strictEqual(r.$('#feed-session').hidden, false);
    const cards = r.$$('.feed-card');
    assert.deepStrictEqual(cards.map((c) => c.getAttribute('data-kind')), ['book', 'podcast', 'video', 'song', 'watchlater']);
    // the book card is TEXT: the "<b>" is characters, not markup
    const bookText = cards[0].querySelector('.feed-card__text');
    assert.strictEqual(bookText.querySelectorAll('b').length, 0);
    assert.strictEqual(bookText.querySelectorAll('p')[0].textContent, 'First <b>para</b>.');
    assert.ok(cards[0].textContent.includes('Chapter 1 of 3'));
    assert.ok(cards[0].querySelector('.ui-btn__label').textContent === 'Open in reader');
    assert.strictEqual(cards[1].querySelector('.feed-card__kind').textContent, 'Podcast');
    assert.ok(cards[1].textContent.includes('4:00 of this episode'));
    assert.ok(cards[2].textContent.includes('Chapter 2 of 3: Middle'));
    assert.strictEqual(cards[4].querySelector('.feed-card__kind').textContent, 'Watch later');
    assert.ok(cards[1].querySelector('.feed-card__slot') && cards[2].querySelector('.feed-card__slot') && cards[3].querySelector('.feed-card__slot'));
    // card 0 (the book) is active; the player is untouched by a book
    assert.ok(cards[0].hasAttribute('data-active'));
    assert.strictEqual(r.loads.length, 0);
    assert.strictEqual(JSON.parse(r.w.sessionStorage.getItem(feed.FEED_SESSION_KEY)).id, 'abcdef0123456789', 'the live session survives a dock-tap return');
  } finally { r.close(); }
});

test('view: activating a media card loads the shared player INTO that card\'s slot with the card\'s descriptor; leaving it pauses; a slice end pauses and says Done', async () => {
  const r = feedRealm();
  try {
    r.init(); await r.settle();
    r.$('#feed-picker-choices button[data-minutes="20"]').click(); await r.settle();
    r.show(1); // the podcast
    assert.strictEqual(r.loads.length, 1);
    assert.strictEqual(r.loads[0].id, 'ep1');
    assert.strictEqual(r.loads[0].lo.slot, r.$$('.feed-card')[1].querySelector('.feed-card__slot'), 'the player mounts in THIS card\'s slot');
    assert.strictEqual(r.loads[0].data.progressEndpoint, '/api/feed/progress/podcast');
    assert.strictEqual(r.loads[0].data.startAt, 600);
    assert.ok(r.$$('.feed-card')[1].hasAttribute('data-active') && !r.$$('.feed-card')[0].hasAttribute('data-active'));
    // the slice: timeupdate before the end updates the readout; at the end it pauses once and marks the card
    Object.defineProperty(r.media, 'currentTime', { value: 700, configurable: true, writable: true });
    r.media.dispatchEvent(new r.w.Event('timeupdate'));
    assert.strictEqual(r.$$('.feed-card')[1].querySelector('[data-left]').textContent, '2:20 left');
    r.media.currentTime = 840;
    r.media.dispatchEvent(new r.w.Event('timeupdate'));
    r.media.dispatchEvent(new r.w.Event('timeupdate'));
    assert.strictEqual(r.loads.filter((l) => l.pause).length, 1, 'paused once at endAt');
    assert.ok(r.$$('.feed-card')[1].hasAttribute('data-done'));
    assert.strictEqual(r.$$('.feed-card')[1].querySelector('[data-left]').textContent, 'Done');
    // swiping on to the video: the podcast is paused (again, by leaving) and the video loads in its own slot
    r.show(2);
    assert.strictEqual(r.loads.filter((l) => l.pause).length, 2);
    const vidLoad = r.loads.filter((l) => l.id === 'v1')[0];
    assert.ok(vidLoad && vidLoad.lo.slot === r.$$('.feed-card')[2].querySelector('.feed-card__slot'));
    assert.strictEqual(vidLoad.data.type, 'video');
    assert.strictEqual(vidLoad.data.progressEndpoint, '/api/feed/progress/media');
    assert.strictEqual(vidLoad.data.startAt, 400);
    // the song: music's own route, from the top
    r.show(3);
    const songLoad = r.loads.filter((l) => l.id === 't1')[0];
    assert.strictEqual(songLoad.data.progressEndpoint, '/api/music/progress');
    assert.strictEqual(songLoad.data.startAt, 0);
    // near the end: the next batch is fetched with every shown non-book id excluded
    r.show(4);
    await r.settle();
    const batches = r.calls('GET', '/api/feed?');
    assert.strictEqual(batches.length, 2);
    assert.strictEqual(decodeURIComponent(batches[1].url.split('exclude=')[1]), 'ep1,v1,t1,v5');
  } finally { r.close(); }
});

test('view: a book card moves the bookmark to its next ONLY after its dwell, once; a 409 shows the moved-elsewhere toast; the end of a book latches finished', async () => {
  const r = feedRealm({ batches: [{ cards: [BOOK, POD, { ...BOOK, id: 'bk2', title: 'Short', next: null, atEnd: true }, SONG], exhausted: false }] });
  try {
    r.init(); await r.settle();
    r.$('#feed-picker-choices button[data-minutes="20"]').click(); await r.settle();
    // leave the book at once: not read, no write
    r.show(1);
    assert.strictEqual(r.calls('POST', '/api/feed/progress/book/').length, 0);
    // back to the book, pretend it was active for its dwell (the clock is read at leave): fake Date.now
    r.show(0);
    r.advance(6000);
    r.show(1);
    const writes = r.calls('POST', '/api/feed/progress/book/bk1');
    assert.strictEqual(writes.length, 1, 'one write after the dwell');
    assert.deepStrictEqual(writes[0].body, { spineIndex: 0, blockIndex: 3 }, 'the card\'s next');
    // leaving it again never writes twice
    r.show(0); r.show(1);
    assert.strictEqual(r.calls('POST', '/api/feed/progress/book/bk1').length, 1);
    // a book at its end: finished through the feed's rule (served, not stale), never the bare latch
    r.show(2);
    r.advance(20000);
    r.show(3);
    assert.deepStrictEqual(r.calls('POST', '/api/feed/progress/book/bk2').map((f) => f.body), [{ atEnd: true }]);
    assert.strictEqual(r.calls('POST', '/api/books/bk2/finished').length, 0);
  } finally { r.close(); }
});

test('view: a refused book write (409) tells the user the place moved elsewhere', async () => {
  const r = feedRealm({ bookWriteStatus: 409 });
  try {
    r.init(); await r.settle();
    r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle();
    r.advance(6000);
    r.show(1);
    await r.settle();
    assert.deepStrictEqual(r.toasts, ['Your place in Alpha moved on another device']);
  } finally { r.close(); }
});

test('view: "Open in reader" navigates to the reader and moves the bookmark ONLY when the card was read (its dwell met) - gate r1 qa W1', async () => {
  const r = feedRealm();
  try {
    r.init(); await r.settle();
    r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle();
    r.$$('.feed-card')[0].querySelector('button').click();
    assert.strictEqual(r.calls('POST', '/api/feed/progress/book/bk1').length, 0, 'a tap seconds after the card appeared: the reader opens where the place IS');
    assert.deepStrictEqual(r.loads.filter((l) => l.navigate), [{ navigate: '/read.html?b=bk1' }]);
    r.advance(6000);
    r.$$('.feed-card')[0].querySelector('button').click();
    assert.strictEqual(r.calls('POST', '/api/feed/progress/book/bk1').length, 1, 'read for its dwell: the place moves to the card\'s next');
  } finally { r.close(); }
});

test('view: Done records the finish (actual seconds, the counted recap), closes the player and opens the recap; its Done returns to the picker with a fresh week line', async () => {
  const r = feedRealm();
  try {
    r.init(); await r.settle();
    r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle();
    r.show(1);
    r.$('#feed-done-btn').click();
    await r.settle();
    const fin = r.calls('POST', '/api/feed/sessions/abcdef0123456789/finish');
    assert.strictEqual(fin.length, 1);
    assert.ok(Number.isInteger(fin[0].body.actualSec) && fin[0].body.actualSec >= 0);
    assert.strictEqual(fin[0].body.summary.cards, 2, 'the two cards left (the book unread, the podcast unplayed) are counted as cards');
    assert.deepStrictEqual(fin[0].body.summary.books, []);
    assert.ok(r.loads.some((l) => l.close), 'the player is closed');
    assert.ok(r.$('.ui-sheet'), 'the recap');
    r.$('#feed-recap-done').click();
    await r.settle();
    assert.strictEqual(r.$('#feed-picker').hidden, false);
    assert.strictEqual(r.$('#feed-session').hidden, true);
    assert.strictEqual(r.$$('.feed-card').length, 0);
    assert.strictEqual(r.w.sessionStorage.getItem(feed.FEED_SESSION_KEY), null);
    assert.strictEqual(r.$('#feed-week').textContent, 'This week: 30 min in Feed, 3 sessions');
  } finally { r.close(); }
});

test('view: an empty library shows the empty state and no session is kept; a live session in sessionStorage resumes without the picker', async () => {
  const r = feedRealm({ batches: [{ cards: [], exhausted: true }] });
  try {
    r.init(); await r.settle();
    r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle();
    assert.strictEqual(r.$('#feed-empty').hidden, false);
    assert.ok(r.$('#feed-empty').textContent.includes('Nothing to feed yet'));
    assert.strictEqual(r.$('#feed-picker').hidden, false);
    assert.strictEqual(r.w.sessionStorage.getItem(feed.FEED_SESSION_KEY), null);
  } finally { r.close(); }
  const r2 = feedRealm();
  try {
    r2.w.sessionStorage.setItem(feed.FEED_SESSION_KEY, JSON.stringify({ id: 'abcdef0123456789', plannedMin: 10, startedAt: '2026-10-09T10:00:00.000Z' }));
    r2.init(); await r2.settle();
    assert.strictEqual(r2.calls('POST', '/api/feed/sessions').length, 0, 'no new session');
    assert.strictEqual(r2.calls('GET', '/api/feed?').length, 1, 'the stack refills from the live session');
    assert.strictEqual(r2.$('#feed-picker').hidden, true);
  } finally { r2.close(); }
});

test('view: cards far behind the active one drop their heavy content and keep their height; swiping back rebuilds them', async () => {
  const many = [];
  for (let i = 0; i < 8; i++) many.push({ ...BOOK, id: 'bk' + i, title: 'B' + i });
  const r = feedRealm({ batches: [{ cards: many, exhausted: false }, { cards: [], exhausted: true }] });
  try {
    r.init(); await r.settle();
    r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle();
    r.show(6);
    const cards = r.$$('.feed-card');
    assert.strictEqual(cards.length, 8);
    assert.ok(cards[0].hasAttribute('data-pruned') && cards[2].hasAttribute('data-pruned'));
    assert.ok(!cards[3].hasAttribute('data-pruned'), 'three behind stay');
    assert.strictEqual(cards[0].querySelector('.feed-card__text'), null);
    r.show(1);
    assert.ok(!cards[0].hasAttribute('data-pruned'));
    assert.ok(cards[0].querySelector('.feed-card__text'), 'rebuilt from the kept card');
  } finally { r.close(); }
});

test('view: destroy aborts the observer and the listeners; a book that was being read still moves its bookmark', async () => {
  const r = feedRealm();
  try {
    r.init(); await r.settle();
    r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle();
    r.advance(6000);
    r.destroy();
    assert.ok(r.observers[r.observers.length - 1].disconnected);
    assert.strictEqual(r.calls('POST', '/api/feed/progress/book/bk1').length, 1, 'leaving the page counts the read card');
  } finally { r.close(); }
});
