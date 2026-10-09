'use strict';

// [UNIT] v1.379.0 Feed mode W4 (plan D10-D13): the session clock, the wind-down, the recap and
// the deliberate extension - the pure rules (lib: public/js/feed.js helpers) and the REAL view
// in the jsdom realm (test/helpers/feed-view-harness.js): the ring fills with the time, a tap
// peeks the minutes left, time up with a book active waits for the swipe, with a slice active
// waits for its end (at most 2 more minutes), then playback stops, the finish carries the
// counted recap and the recap sheet opens; a tap on "Another 10 minutes" does nothing, a hold
// extends (POST .../extend) and the session goes on with a moved deadline; Done goes back.

const { test } = require('node:test');
const assert = require('node:assert');
const feed = require('../../public/js/feed.js');
const { feedRealm, BOOK, POD, VID, SONG } = require('../helpers/feed-view-harness');

// ---- pure rules -----------------------------------------------------------------------------

test('feedDeadlineMs / feedRingFraction / feedRemainingSec', () => {
  const start = '2026-10-09T10:00:00.000Z';
  const t0 = Date.parse(start);
  assert.strictEqual(feed.feedDeadlineMs(start, 20, 0), t0 + 20 * 60000);
  assert.strictEqual(feed.feedDeadlineMs(start, 10, 2), t0 + 30 * 60000, 'two extensions add 20 minutes');
  assert.ok(Number.isNaN(feed.feedDeadlineMs('nope', 10, 0)));
  const dl = t0 + 600000;
  assert.strictEqual(feed.feedRingFraction(t0, t0, dl), 0);
  assert.strictEqual(feed.feedRingFraction(t0 + 300000, t0, dl), 0.5);
  assert.strictEqual(feed.feedRingFraction(t0 + 900000, t0, dl), 1, 'past the deadline stays full');
  assert.strictEqual(feed.feedRingFraction(t0, t0, t0), 1, 'an empty span is full');
  assert.strictEqual(feed.feedRemainingSec(t0 + 1000, dl), 599);
  assert.strictEqual(feed.feedRemainingSec(dl + 5, dl), 0);
});

test('feedCountActivity: a read book counts pages, a finished chapter counts, seconds otherwise, a song once played, nothing from a card merely passed', () => {
  const s = feed.feedEmptySummary();
  feed.feedCountActivity(s, { ...BOOK, words: 500 }, { read: true });
  feed.feedCountActivity(s, { ...BOOK, words: 450 }, { read: true });
  feed.feedCountActivity(s, { ...BOOK, words: 450 }, { read: false });
  assert.deepStrictEqual(s.books.bk1, { title: 'Alpha', pages: 4, words: 950, cards: 2 }, '950 words = 4 pages of 250');
  feed.feedCountActivity(s, VID, { playedSec: 500, done: true });
  feed.feedCountActivity(s, VID, { playedSec: 20, done: false });
  assert.deepStrictEqual(s.videos.v1, { title: 'V', chapters: 1, sec: 520, chaptered: true });
  feed.feedCountActivity(s, POD, { playedSec: 240, done: true });
  assert.deepStrictEqual(s.podcasts.ep1, { title: 'Ep', sec: 240, durationSec: 1800, finished: false });
  feed.feedCountActivity(s, { ...POD, startAt: 1700 }, { playedSec: 100, done: true });
  assert.strictEqual(s.podcasts.ep1.finished, true, 'a slice reaching the episode\'s end finishes it');
  feed.feedCountActivity(s, SONG, { playedSec: 12 });
  feed.feedCountActivity(s, SONG, { playedSec: 45 });
  feed.feedCountActivity(s, { ...SONG, id: 't2' }, { ended: true });
  assert.strictEqual(s.songs, 2);
  assert.deepStrictEqual(s.songIds, ['t1', 't2']);
  feed.feedCountActivity(s, { ...VID, id: 'v9', chapter: null }, { playedSec: 0, done: false });
  assert.strictEqual(s.videos.v9, undefined, 'passed by: nothing');
  assert.strictEqual(s.cards, 11, 'every card counted once as a card, read or not (3 book + 2 video + 2 podcast + 3 song + 1 passed)');
});

test('feedRecapLines / feedRecapTitle / feedSummaryPayload', () => {
  const s = feed.feedEmptySummary();
  feed.feedCountActivity(s, { ...BOOK, words: 3500 }, { read: true });
  feed.feedCountActivity(s, VID, { playedSec: 500, done: true });
  feed.feedCountActivity(s, VID, { playedSec: 300, done: true });
  feed.feedCountActivity(s, { ...VID, id: 'v2', title: 'Flat', chapter: null }, { playedSec: 170, done: true });
  feed.feedCountActivity(s, POD, { playedSec: 900 });
  feed.feedCountActivity(s, { ...POD, id: 'ep2', title: 'Short', durationSec: 300, startAt: 60 }, { playedSec: 240, done: true });
  for (let i = 0; i < 3; i++) feed.feedCountActivity(s, { ...SONG, id: 't' + i }, { ended: true });
  assert.deepStrictEqual(feed.feedRecapLines(s), ['14 pages of Alpha', '2 chapters of V', '3 min of Flat', 'half of Ep', 'finished Short', '3 songs']);
  assert.deepStrictEqual(feed.feedRecapLines(feed.feedEmptySummary()), []);
  assert.strictEqual(feed.feedRecapTitle(1200, 0), '20 minutes');
  assert.strictEqual(feed.feedRecapTitle(1800, 1), '30 minutes, extended once');
  assert.strictEqual(feed.feedRecapTitle(2400, 2), '40 minutes, extended 2 times');
  assert.strictEqual(feed.feedRecapTitle(20, 0), '1 minute');
  const p = feed.feedSummaryPayload(s, 1230, 1);
  assert.strictEqual(p.minutes, 21);
  assert.strictEqual(p.extensions, 1);
  assert.strictEqual(p.songs, 3);
  assert.deepStrictEqual(p.books, [{ id: 'bk1', title: 'Alpha', pages: 14, words: 3500 }]);
  assert.deepStrictEqual(p.videos[0], { id: 'v1', title: 'V', chapters: 2, sec: 800 });
  assert.deepStrictEqual(p.podcasts[1], { id: 'ep2', title: 'Short', sec: 240, finished: true });
  assert.ok(!('moves' in p), 'moves are the server\'s');
  // gate r1: the maximal payload stays under the finish route's 16 KB cap
  const big = feed.feedEmptySummary();
  for (let i = 0; i < 80; i++) {
    feed.feedCountActivity(big, { kind: 'book', id: 'b' + String(i).padStart(32, '0'), title: 'T'.repeat(200), words: 500 }, { read: true });
    feed.feedCountActivity(big, { kind: 'video', media: 'video', id: 'v' + String(i).padStart(32, '0'), title: 'T'.repeat(200), chapter: { index: 0, count: 1 } }, { playedSec: 100, done: true });
    feed.feedCountActivity(big, { kind: 'podcast', media: 'podcast', id: 'p' + String(i).padStart(32, '0'), title: 'T'.repeat(200), durationSec: 1000 }, { playedSec: 100 });
  }
  const bytes = Buffer.byteLength(JSON.stringify(feed.feedSummaryPayload(big, 3600, 2)), 'utf8');
  assert.ok(bytes < 16 * 1024, 'maximal payload ' + bytes + ' bytes stays under the 16 KB cap');
});

test('feedHoldStep: a hold fires after FEED_HOLD_MS, a release before resets, progress reports the fill', () => {
  let r = feed.feedHoldStep(null, 'down', 1000);
  assert.deepStrictEqual(r, { state: { holding: true, since: 1000 }, fired: false, progress: 0 });
  r = feed.feedHoldStep(r.state, 'tick', 1600);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.progress, 0.5);
  r = feed.feedHoldStep(r.state, 'up', 1700);
  assert.deepStrictEqual(r, { state: { holding: false, since: 0 }, fired: false, progress: 0 }, 'a release resets');
  r = feed.feedHoldStep(r.state, 'tick', 5000);
  assert.strictEqual(r.fired, false, 'ticks without a hold fire nothing');
  r = feed.feedHoldStep(feed.feedHoldStep(null, 'down', 0).state, 'tick', feed.FEED_HOLD_MS);
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.state.holding, false, 'fires once, then rests');
});

// ---- the view -------------------------------------------------------------------------------

async function started(r, minutes) {
  r.init(); await r.settle();
  r.$('#feed-picker-choices button[data-minutes="' + (minutes || 10) + '"]').click();
  await r.settle();
}

test('view: the ring fills with the time and a tap peeks the minutes left; the clock ticks once a second', async () => {
  const r = feedRealm();
  try {
    await started(r, 10);
    const clock = r.intervals.filter((i) => i.live && i.ms === 1000);
    assert.strictEqual(clock.length, 1, 'one session clock');
    const ring = r.$('.feed-ring__fill');
    assert.ok(ring, 'the ring is in the HUD');
    assert.strictEqual(ring.style.getPropertyValue('--p'), '0');
    r.advance(5 * 60000); r.tickIntervals();
    assert.ok(Math.abs(Number(ring.style.getPropertyValue('--p')) - 0.5) < 0.01, 'half way: ' + ring.style.getPropertyValue('--p'));
    assert.strictEqual(r.$('#feed-time').hidden, true, 'no numbers unless tapped');
    r.$('#feed-ring-btn').click();
    assert.strictEqual(r.$('#feed-time').hidden, false);
    assert.strictEqual(r.$('#feed-time').textContent, '5:00 left');
  } finally { r.close(); }
});

test('view: time up with a BOOK active waits for the swipe, then stops playback, records the finish with the recap and opens it', async () => {
  const r = feedRealm();
  try {
    await started(r, 10);
    r.advance(10 * 60000 + 500); r.tickIntervals();
    assert.strictEqual(r.calls('POST', '/api/feed/sessions/abcdef0123456789/finish').length, 0, 'a book card is read until moved on');
    assert.strictEqual(r.$('.ui-sheet'), null);
    r.advance(130000); r.tickIntervals(); // gate r1 (adversary M17): well past the 2-minute cap, a BOOK is never hard-stopped
    assert.strictEqual(r.$('.ui-sheet'), null, 'the cap is for a playing slice, not a page being read');
    r.show(1); // the swipe on
    await r.settle();
    const fin = r.calls('POST', '/api/feed/sessions/abcdef0123456789/finish');
    assert.strictEqual(fin.length, 1);
    assert.ok(fin[0].body.actualSec >= 600);
    assert.deepStrictEqual(fin[0].body.summary.books, [{ id: 'bk1', title: 'Alpha', pages: 1, words: 3 }], 'the book was read (its page active past its dwell); v1.381.0 (D6): the recap counts the words ON the pages read (the fixture page holds 3), not the card\'s word total');
    assert.strictEqual(fin[0].body.summary.cards, 1);
    assert.ok(r.loads.some((l) => l.close), 'playback stopped');
    assert.strictEqual(r.loads.filter((l) => l.id).length, 0, 'the swiped-to card never started');
    const sheet = r.$('.ui-sheet');
    assert.ok(sheet, 'the recap opened');
    assert.strictEqual(sheet.querySelector('.ui-sheet__title').textContent, '12 minutes'); // the real time: 10 planned + the 2 minutes the page was still read
    assert.deepStrictEqual(Array.from(sheet.querySelectorAll('.feed-recap__list li')).map((li) => li.textContent), ['1 page of Alpha']);
    assert.ok(r.$('#feed-extend-btn') && r.$('#feed-recap-done'));
    assert.strictEqual(r.calls('POST', '/api/feed/progress/book/bk1').length, 1, 'the bookmark moved too');
  } finally { r.close(); }
});

test('view (gate r1, adversary M19): a card swiped back to and left again counts once', async () => {
  const r = feedRealm();
  try {
    await started(r, 10);
    r.advance(6000);
    r.show(1); r.show(0); r.show(1); r.show(0); r.show(1); // back and forth over the read book
    r.$('#feed-done-btn').click(); await r.settle();
    const fin = r.calls('POST', '/api/feed/sessions/abcdef0123456789/finish');
    assert.deepStrictEqual(fin[0].body.summary.books, [{ id: 'bk1', title: 'Alpha', pages: 1, words: 3 }], 'counted once');
    assert.strictEqual(r.calls('POST', '/api/feed/progress/book/bk1').length, 1, 'written once');
  } finally { r.close(); }
});

test('view: time up with a SLICE playing lets it finish, then recaps; the 2-minute cap stops a slice that does not finish', async () => {
  const r = feedRealm();
  try {
    await started(r, 10);
    r.show(1); // the podcast plays
    r.timeAt(700);
    r.advance(10 * 60000 + 500); r.tickIntervals();
    assert.strictEqual(r.$('.ui-sheet'), null, 'the slice goes on');
    assert.strictEqual(r.calls('GET', '/api/feed?').length, 1, 'no new batch after time up (setActive ends the session before its prefetch)');
    r.timeAt(840); // the slice end
    await r.settle();
    assert.ok(r.$('.ui-sheet'), 'the recap opened when the slice ended');
    const fin = r.calls('POST', '/api/feed/sessions/abcdef0123456789/finish');
    assert.deepStrictEqual(fin[0].body.summary.podcasts, [{ id: 'ep1', title: 'Ep', sec: 240, finished: false }]);
  } finally { r.close(); }
  const r2 = feedRealm();
  try {
    await started(r2, 10);
    r2.show(2); // the video (chapter 400-900)
    r2.timeAt(450);
    r2.advance(10 * 60000 + 500); r2.tickIntervals();
    r2.advance(119000); r2.tickIntervals();
    assert.strictEqual(r2.$('.ui-sheet'), null, 'inside the two minutes');
    r2.advance(2000); r2.tickIntervals();
    await r2.settle();
    assert.ok(r2.$('.ui-sheet'), 'the cap ended it');
    assert.ok(r2.loads.some((l) => l.pause) && r2.loads.some((l) => l.close));
  } finally { r2.close(); }
});

test('view: "Another 10 minutes" ignores a tap, fires on a hold, extends the session and moves the deadline; Done goes back', async () => {
  const r = feedRealm();
  try {
    await started(r, 10);
    r.show(1);
    r.$('#feed-done-btn').click(); // end early: the recap
    await r.settle();
    const more = r.$('#feed-extend-btn');
    assert.ok(more);
    more.click();
    await r.settle();
    assert.strictEqual(r.calls('POST', '/api/feed/sessions/abcdef0123456789/extend').length, 0, 'a tap does nothing');
    // a short hold: down, 600 ms of ticks, up
    more.dispatchEvent(new r.w.Event('pointerdown', { bubbles: true }));
    const holdTimers = () => r.intervals.filter((i) => i.live && i.ms === 50);
    assert.strictEqual(holdTimers().length, 1, 'the hold timer runs');
    r.advance(600); r.tickIntervals();
    assert.strictEqual(more.style.getPropertyValue('--hold'), '0.5');
    more.dispatchEvent(new r.w.Event('pointerup', { bubbles: true }));
    assert.strictEqual(r.calls('POST', '/api/feed/sessions/abcdef0123456789/extend').length, 0, 'released early: nothing');
    assert.strictEqual(more.style.getPropertyValue('--hold'), '0');
    // the real hold
    more.dispatchEvent(new r.w.Event('pointerdown', { bubbles: true }));
    r.advance(1300); r.tickIntervals();
    await r.settle();
    assert.strictEqual(r.calls('POST', '/api/feed/sessions/abcdef0123456789/extend').length, 1);
    assert.strictEqual(r.$('.ui-sheet:not(.is-closing)'), null, 'the recap is closing (the sheet leaves after its exit transition)');
    assert.strictEqual(r.$('#feed-session').hidden, false, 'the session goes on');
    assert.strictEqual(JSON.parse(r.w.sessionStorage.getItem(feed.FEED_SESSION_KEY)).extensions, 1);
    // the deadline moved by ten minutes: 10 minutes in, the ring reads half of 20
    r.advance(10 * 60000); r.tickIntervals();
    assert.ok(Math.abs(Number(r.$('.feed-ring__fill').style.getPropertyValue('--p')) - 0.5) < 0.01, 'half of 20: ' + r.$('.feed-ring__fill').style.getPropertyValue('--p'));
    assert.ok(r.w.__scrolledInto, 'moved on to the next card');
    // time up again, swipe: the recap names the extension and the finish carries it
    r.advance(10 * 60000 + 1000); r.tickIntervals();
    r.show(3);
    await r.settle();
    const fins = r.calls('POST', '/api/feed/sessions/abcdef0123456789/finish');
    assert.strictEqual(fins.length, 2, 'the finish is re-recorded at the real end');
    assert.strictEqual(fins[1].body.summary.extensions, 1);
    assert.strictEqual(r.$('.ui-sheet:not(.is-closing) .ui-sheet__title').textContent, '20 minutes, extended once', 'the LIVE recap (the first one is still leaving)');
    // Done: back (jsdom has one history entry: Home)
    r.$('#feed-recap-done').click();
    await r.settle();
    assert.deepStrictEqual(r.loads.filter((l) => l.navigate), [{ navigate: '/' }]);
    assert.strictEqual(r.$('#feed-picker').hidden, false);
    assert.strictEqual(r.w.sessionStorage.getItem(feed.FEED_SESSION_KEY), null);
  } finally { r.close(); }
});

test('view (gate r1, adversary W3): what was read before a navigation is still in the recap after the view re-inits', async () => {
  const r = feedRealm();
  try {
    await started(r, 10);
    r.advance(6000);
    r.show(1); // the book was read: counted, and the count rides the stored session
    const stored = JSON.parse(r.w.sessionStorage.getItem('ft-feed-session'));
    assert.deepStrictEqual(Object.keys(stored.summary.books), ['bk1']);
    r.destroy(); // Open in reader / a dock tap / back
    r.init(); await r.settle();
    r.$('#feed-done-btn').click(); await r.settle();
    const fin = r.calls('POST', '/api/feed/sessions/abcdef0123456789/finish');
    assert.strictEqual(fin.length, 1);
    assert.deepStrictEqual(fin[0].body.summary.books, [{ id: 'bk1', title: 'Alpha', pages: 1, words: 3 }], 'the pages read before the navigation');
    assert.deepStrictEqual(Array.from(r.$('.ui-sheet').querySelectorAll('.feed-recap__list li')).map((li) => li.textContent), ['1 page of Alpha']);
  } finally { r.close(); }
  // the restore is shape-checked
  assert.deepStrictEqual(feed.feedRestoreSummary(null), feed.feedEmptySummary());
  assert.deepStrictEqual(feed.feedRestoreSummary({ cards: 'x', books: [], songs: 2, songIds: ['a', 3] }), { cards: 0, books: {}, videos: {}, podcasts: {}, songs: 2, songIds: ['a'] });
});

test('view: a resumed live session keeps its extensions and its deadline', async () => {
  const r = feedRealm();
  try {
    r.w.sessionStorage.setItem(feed.FEED_SESSION_KEY, JSON.stringify({ id: 'abcdef0123456789', plannedMin: 10, startedAt: new Date(r.w.Date.now() - 15 * 60000).toISOString(), extensions: 1 }));
    r.init(); await r.settle();
    assert.ok(Math.abs(Number(r.$('.feed-ring__fill').style.getPropertyValue('--p')) - 0.75) < 0.01, '15 of 20 minutes');
  } finally { r.close(); }
});
