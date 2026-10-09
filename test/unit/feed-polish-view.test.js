'use strict';

// [UNIT] v1.380.0 Feed polish, the client (public/js/feed.js, player.js): the pure helpers (labels, the played-time tracker, the
// swipe-hint count) and the REAL view in the jsdom harness (test/helpers/feed-view-harness.js): the "Start something new" card
// (text only, nothing written by looking, "Start reading" the only thing that starts a book), "Continue" / "New from" labels, the
// one-minute guard riding the player descriptor, the intro note, and the first-sessions swipe cue.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const feed = require('../../public/js/feed.js');
const { feedRealm, BOOK, POD, VID, SONG, WL } = require('../helpers/feed-view-harness');

const NEW_BOOK = {
  kind: 'book', newBook: true, id: 'nb1', title: 'Nova', author: 'A. Writer', coverUrl: '/bookcover/nb1', description: 'A <b>lighthouse</b> & a secret.<img src=x onerror=alert(1)>',
  readerHref: '/read.html?b=nb1', chapterLabel: 'Chapter 2 of 9', spineCount: 9, start: { spineIndex: 1, blockIndex: 0 }, startRule: 'landmarks',
  blocks: [{ spineIndex: 1, blockIndex: 0, text: 'Chapter <i>One</i>', heading: true, chapterStart: true }, { spineIndex: 1, blockIndex: 1, text: 'It began.', heading: false, chapterStart: false }],
  words: 180, dwellSec: 40, next: null, atEnd: false,
};
const FRESH_VID = { ...VID, id: 'vf', fresh: true, channelName: 'Lofi Girl', skippedIntro: true, startAt: 60, endAt: 600, chapter: { index: 1, count: 3, title: 'The build' } };
const FRESH_POD = { ...POD, id: 'ef', fresh: true, showName: 'The Show', position: 0, startAt: 0, endAt: 240 };

// ---- pure ----------------------------------------------------------------------------------

test('feedNewnessLabel / feedKindLine: Continue vs New from <channel> / New episode of <show>; Watch later keeps its word; books and songs say nothing', () => {
  assert.strictEqual(feed.feedNewnessLabel({ kind: 'video', media: 'video', fresh: true, channelName: 'Lofi Girl' }), 'New from Lofi Girl');
  assert.strictEqual(feed.feedNewnessLabel({ kind: 'video', media: 'video', fresh: true, channelName: '' }), 'New video');
  assert.strictEqual(feed.feedNewnessLabel({ kind: 'podcast', media: 'podcast', fresh: true, showName: 'The Show' }), 'New episode of The Show');
  assert.strictEqual(feed.feedNewnessLabel({ kind: 'podcast', media: 'podcast', fresh: true }), 'New episode');
  assert.strictEqual(feed.feedNewnessLabel({ kind: 'video', media: 'video', fresh: false }), 'Continue');
  assert.strictEqual(feed.feedNewnessLabel({ kind: 'video', media: 'video' }), 'Continue', 'no flag = a continuing card (the v1.379.0 shape)');
  assert.strictEqual(feed.feedNewnessLabel({ kind: 'book' }), '');
  assert.strictEqual(feed.feedNewnessLabel({ kind: 'song' }), '');
  assert.strictEqual(feed.feedNewnessLabel(null), '');
  assert.strictEqual(feed.feedKindLine({ kind: 'watchlater', media: 'video', fresh: true, channelName: 'C' }), 'Watch later · New from C');
  assert.strictEqual(feed.feedKindLine({ kind: 'watchlater', media: 'podcast', fresh: false }), 'Watch later · Continue');
  assert.strictEqual(feed.feedKindLine({ kind: 'video', media: 'audio', fresh: false }), 'Audio · Continue');
  assert.strictEqual(feed.feedKindLine({ kind: 'book', newBook: true }), 'Start something new');
  assert.strictEqual(feed.feedKindLine({ kind: 'book' }), 'Book');
  assert.strictEqual(feed.feedKindLine({ kind: 'song' }), 'Song');
  assert.ok(!/—/.test(feed.feedKindLine(FRESH_VID)), 'no em dashes in user copy');
});

test('the played-time tracker: playback adds, a seek adds nothing, pause adds nothing, wall time caps it', () => {
  const t = feed.feedNewPlayTracker();
  let wall = 0;
  const step = (cur, playing = true, rate = 1) => feed.feedPlayedStep(t, cur, wall, playing, rate);
  step(100); // first update: just the anchor
  for (let i = 1; i <= 10; i++) { wall += 1000; step(100 + i); } // ten seconds of playing
  assert.strictEqual(Math.round(t.sec), 10);
  wall += 100; step(400); // a seek forward 290 s
  assert.strictEqual(Math.round(t.sec), 10, 'a seek adds nothing');
  wall += 100; step(20); // a seek back
  assert.strictEqual(Math.round(t.sec), 10, 'a seek back adds nothing');
  wall += 1000; step(21);
  assert.strictEqual(Math.round(t.sec), 11);
  wall += 5000; step(21, false); // paused
  wall += 5000; step(21, false);
  assert.strictEqual(Math.round(t.sec), 11, 'paused adds nothing');
  wall += 1000; step(22); // resumed: the first update after a pause is only an anchor
  assert.strictEqual(Math.round(t.sec), 11);
  wall += 1000; step(23);
  assert.strictEqual(Math.round(t.sec), 12);
  // a small "seek" inside the step limit but with no wall time behind it is capped by the wall clock
  const t2 = feed.feedNewPlayTracker(); wall = 0;
  feed.feedPlayedStep(t2, 0, 0, true, 1); feed.feedPlayedStep(t2, 2, 10, true, 1); // 2 s of media in 10 ms of wall
  assert.ok(t2.sec < 0.5, `capped by wall time: ${t2.sec}`);
  // playback rate lets media time outrun the wall (2x: 2 s of media in 1 s)
  const t3 = feed.feedNewPlayTracker();
  feed.feedPlayedStep(t3, 0, 0, true, 2); feed.feedPlayedStep(t3, 2, 1000, true, 2);
  assert.strictEqual(Math.round(t3.sec), 2);
  assert.strictEqual(feed.feedFreshStarted({ sec: 59.9 }), false);
  assert.strictEqual(feed.feedFreshStarted({ sec: 60 }), true);
  assert.strictEqual(feed.feedFreshStarted(null), false);
});

test('feedHintShouldShow: the first three sessions only', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, '2', '3', null, undefined, 'x'].map(feed.feedHintShouldShow), [true, true, true, false, false, true, false, true, true, true]);
});

// ---- the "Start something new" card ----------------------------------------------------------

async function start(r) { r.init(); await r.settle(); r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle(); }

test('view: a new-book card shows cover, title, author and the description as TEXT; the taste is hidden until asked; Open in reader is not offered', async () => {
  const r = feedRealm({ batches: [{ cards: [NEW_BOOK, POD, VID], exhausted: false }] });
  try {
    await start(r);
    const node = r.$$('.feed-card')[0];
    assert.strictEqual(node.querySelector('.feed-card__kind').textContent, 'Start something new');
    assert.strictEqual(node.querySelector('.feed-card__title').textContent, 'Nova');
    assert.strictEqual(node.querySelector('.feed-card__meta').textContent, 'A. Writer');
    assert.strictEqual(node.querySelector('.feed-card__cover').getAttribute('src'), '/bookcover/nb1');
    const desc = node.querySelector('.feed-card__desc');
    assert.strictEqual(desc.textContent, 'A <b>lighthouse</b> & a secret.<img src=x onerror=alert(1)>', 'the description is characters, not markup');
    assert.strictEqual(node.querySelectorAll('b, img[onerror], i').length, 0, 'no element came out of the text');
    const taste = node.querySelector('.feed-card__taste');
    assert.ok(taste && taste.hidden, 'the taste starts hidden');
    assert.strictEqual(taste.querySelectorAll('i').length, 0);
    assert.strictEqual(taste.querySelector('h3').textContent, 'Chapter <i>One</i>');
    const labels = Array.from(node.querySelectorAll('.ui-btn__label')).map((l) => l.textContent);
    assert.deepStrictEqual(labels, ['Start reading', 'Read the opening']);
    // the opening expands and collapses
    const peek = node.querySelector('[data-read-opening]');
    peek.click();
    assert.strictEqual(taste.hidden, false);
    assert.strictEqual(peek.getAttribute('aria-expanded'), 'true');
    peek.click();
    assert.strictEqual(taste.hidden, true);
  } finally { r.close(); }
});

test('view: looking at a new-book card writes NOTHING - not active, not left after any dwell, not opened, not expanded', async () => {
  const r = feedRealm({ batches: [{ cards: [NEW_BOOK, POD, VID], exhausted: false }] });
  try {
    await start(r);
    r.$$('.feed-card')[0].querySelector('[data-read-opening]').click();
    r.advance(10 * 60 * 1000); // ten minutes on the card
    r.show(1);
    r.show(0); r.advance(10 * 60 * 1000); r.show(2);
    await r.settle();
    assert.strictEqual(r.calls('POST', '/api/feed/progress/').length, 0, 'no progress write of any kind');
    assert.strictEqual(r.calls('POST', '/api/books/').length, 0);
    // the recap never counts a taste as pages read
    r.$('#feed-done-btn').click(); await r.settle();
    const body = r.calls('POST', '/api/feed/sessions/')[0].body;
    assert.deepStrictEqual(body.summary.books, [], 'a new-book card read for ten minutes is not pages read');
  } finally { r.close(); }
});

test('view: a new-book card never moves a place even if the server sent it a `next` (the view does not trust the shape)', async () => {
  const r = feedRealm({ batches: [{ cards: [{ ...NEW_BOOK, next: { spineIndex: 1, blockIndex: 5 } }, POD], exhausted: false }] });
  try {
    await start(r);
    r.advance(10 * 60 * 1000);
    r.show(1);
    await r.settle(30);
    assert.strictEqual(r.calls('POST', '/api/feed/progress/book/').length, 0);
  } finally { r.close(); }
});

test('view: "Start reading" posts the card\'s start (the first real chapter, block 0) once, then opens the reader; a stale refusal says so and still opens the reader', async () => {
  const r = feedRealm({ batches: [{ cards: [NEW_BOOK, POD], exhausted: false }] });
  try {
    await start(r);
    const btn = r.$$('.feed-card')[0].querySelector('[data-start-reading]');
    btn.click(); btn.click(); // a double tap is one write
    await r.settle(30);
    const writes = r.calls('POST', '/api/feed/progress/book/nb1');
    assert.deepStrictEqual(writes.map((w) => w.body), [{ spineIndex: 1, blockIndex: 0 }]);
    assert.deepStrictEqual(r.loads.filter((l) => l.navigate), [{ navigate: '/read.html?b=nb1' }], 'then the reader opens');
  } finally { r.close(); }
  const r2 = feedRealm({ batches: [{ cards: [NEW_BOOK, POD], exhausted: false }], bookWriteStatus: 409 });
  try {
    await start(r2);
    r2.$$('.feed-card')[0].querySelector('[data-start-reading]').click();
    await r2.settle(30);
    assert.deepStrictEqual(r2.toasts, ['Your place in Nova moved on another device']);
    assert.deepStrictEqual(r2.loads.filter((l) => l.navigate), [{ navigate: '/read.html?b=nb1' }], 'the reader opens on whatever the place really is');
  } finally { r2.close(); }
});

test('view: an ordinary book card is unchanged (Open in reader, a dwell moves the bookmark)', async () => {
  const r = feedRealm({ batches: [{ cards: [BOOK, POD], exhausted: false }] });
  try {
    await start(r);
    assert.strictEqual(r.$$('.feed-card')[0].querySelector('.feed-card__kind').textContent, 'Book');
    assert.ok(!r.$$('.feed-card')[0].querySelector('[data-start-reading]'));
    r.advance(6000); r.show(1);
    assert.strictEqual(r.calls('POST', '/api/feed/progress/book/bk1').length, 1);
  } finally { r.close(); }
});

// ---- labels, the guard, the intro note ---------------------------------------------------------

test('view: labels - "New from <channel>", "New episode of <show>", "Continue", Watch later keeps its word', async () => {
  const r = feedRealm({ batches: [{ cards: [FRESH_VID, FRESH_POD, { ...VID, id: 'vc', fresh: false }, { ...WL, fresh: true, channelName: 'Z' }, { ...WL, id: 'v6', fresh: false }, SONG], exhausted: false }] });
  try {
    await start(r);
    assert.deepStrictEqual(r.$$('.feed-card__kind').map((k) => k.textContent), [
      'Video · New from Lofi Girl', 'Podcast · New episode of The Show', 'Video · Continue', 'Watch later · New from Z', 'Watch later · Continue', 'Song',
    ]);
  } finally { r.close(); }
});

test('view: a FRESH card hands the player a progress gate that opens only after a minute of PLAYED time; a continuing card carries no gate', async () => {
  const r = feedRealm({ batches: [{ cards: [BOOK, FRESH_POD, { ...VID, fresh: false }, WL], exhausted: false }] });
  try {
    await start(r);
    r.show(1); // the fresh episode
    const data = r.loads.filter((l) => l.id === 'ef')[0].data;
    // while the media is PAUSED its updates add nothing (jsdom media starts paused)
    for (let s = 0; s <= 30; s++) { r.advance(1000); r.timeAt(s); }
    assert.strictEqual(data.playedSec(), 0, 'a paused element adds no played time');
    Object.defineProperty(r.media, 'paused', { value: false, configurable: true }); // now it is playing
    assert.strictEqual(typeof data.progressGate, 'function');
    assert.strictEqual(typeof data.playedSec, 'function');
    assert.strictEqual(data.progressGate(), false);
    // 10 s of playing: the gate stays shut and the report says ~10
    for (let s = 0; s <= 10; s++) { r.advance(1000); r.timeAt(s); }
    assert.strictEqual(data.progressGate(), false);
    assert.ok(data.playedSec() >= 9 && data.playedSec() <= 10.5, `played ${data.playedSec()}`);
    // a seek to 500 s adds nothing
    r.advance(100); r.timeAt(500);
    assert.ok(data.playedSec() <= 10.5);
    assert.strictEqual(data.progressGate(), false);
    // 45 more seconds of playing from there (about 55 in all): still shut; 6 more and it is open
    for (let s = 501; s <= 545; s++) { r.advance(1000); r.timeAt(s); }
    assert.strictEqual(data.progressGate(), false, `at ${data.playedSec()} s`);
    for (let s = 546; s <= 552; s++) { r.advance(1000); r.timeAt(s); }
    assert.strictEqual(data.progressGate(), true, `at ${data.playedSec()} s`);
    // the continuing video: no gate, no report - exactly the v1.379.0 descriptor
    r.show(2);
    const cont = r.loads.filter((l) => l.id === 'v1')[0].data;
    assert.strictEqual(cont.progressGate, undefined);
    assert.strictEqual(cont.playedSec, undefined);
    // Watch later fresh / not: the descriptor follows the flag
    r.show(3);
    assert.strictEqual(r.loads.filter((l) => l.id === 'v5')[0].data.progressGate, undefined, 'WL without the flag: no gate');
  } finally { r.close(); }
  const r2 = feedRealm({ batches: [{ cards: [{ ...WL, fresh: true }, BOOK], exhausted: false }] });
  try {
    await start(r2);
    assert.strictEqual(typeof r2.loads.filter((l) => l.id === 'v5')[0].data.progressGate, 'function', 'a fresh Watch later card is gated too');
  } finally { r2.close(); }
});

test('view: a skipped intro says so for 3 s and a tap goes back to 0 (a seek: it adds no played time)', async () => {
  const r = feedRealm({ batches: [{ cards: [FRESH_VID, BOOK], exhausted: false }] });
  try {
    await start(r);
    const note = r.$('.feed-card__intro-note');
    assert.ok(note, 'the note is shown on a card that skipped its intro');
    assert.ok(note.textContent.includes('Skipped the intro'));
    Object.defineProperty(r.media, 'currentTime', { value: 60, configurable: true, writable: true });
    note.click();
    assert.strictEqual(r.media.currentTime, 0);
    assert.strictEqual(r.$('.feed-card__intro-note'), null, 'gone after the tap');
    const data = r.loads.filter((l) => l.id === 'vf')[0].data;
    r.timeAt(0);
    assert.ok(data.playedSec() < 1, 'the seek added nothing');
  } finally { r.close(); }
  const r2 = feedRealm({ batches: [{ cards: [{ ...VID, fresh: false, skippedIntro: false }], exhausted: false }] });
  try { await start(r2); assert.strictEqual(r2.$('.feed-card__intro-note'), null, 'no note when nothing was skipped'); } finally { r2.close(); }
});

// ---- the swipe cue ------------------------------------------------------------------------------

test('view: the swipe cue shows on the first card of the first three sessions a device starts, clears on the first swipe, and never comes back after that', async () => {
  const r = feedRealm({ batches: [{ cards: [BOOK, POD, VID], exhausted: false }] });
  try {
    r.w.localStorage.setItem(feed.FEED_HINT_KEY, '2');
    await start(r);
    const hint = r.$('#feed-hint');
    assert.ok(hint && /Swipe up/.test(hint.textContent), 'the third session still shows it');
    assert.strictEqual(r.$$('.feed-card')[0].querySelector('#feed-hint') !== null, true, 'on the FIRST card');
    assert.strictEqual(r.w.localStorage.getItem(feed.FEED_HINT_KEY), '3');
    r.show(1);
    assert.strictEqual(r.$('#feed-hint'), null, 'gone after the first swipe');
  } finally { r.close(); }
  const r2 = feedRealm({ batches: [{ cards: [BOOK, POD], exhausted: false }] });
  try {
    r2.w.localStorage.setItem(feed.FEED_HINT_KEY, '3');
    await start(r2);
    assert.strictEqual(r2.$('#feed-hint'), null, 'the fourth session: no cue');
    assert.strictEqual(r2.w.localStorage.getItem(feed.FEED_HINT_KEY), '3', 'and the count stops');
  } finally { r2.close(); }
  const r3 = feedRealm({ batches: [{ cards: [BOOK, POD], exhausted: false }] });
  try {
    await start(r3);
    assert.ok(r3.$('#feed-hint'), 'a fresh device shows it');
    assert.strictEqual(r3.w.localStorage.getItem(feed.FEED_HINT_KEY), '1');
    const hintTimer = r3.$('#feed-hint');
    assert.ok(hintTimer);
    await new Promise((res) => setTimeout(res, feed.FEED_HINT_MS + 200));
    assert.strictEqual(r3.$('#feed-hint'), null, 'it fades after 4 s on its own');
  } finally { r3.close(); }
});

test('view: a RESUMED session (a dock-tap return) neither shows the cue nor counts a session', async () => {
  const r = feedRealm({ batches: [{ cards: [BOOK, POD], exhausted: false }] });
  try {
    r.w.sessionStorage.setItem(feed.FEED_SESSION_KEY, JSON.stringify({ id: 'abcdef0123456789', plannedMin: 10, startedAt: new Date(r.w.Date.now()).toISOString(), extensions: 0 }));
    r.init(); await r.settle();
    assert.strictEqual(r.$('#feed-hint'), null);
    assert.strictEqual(r.w.localStorage.getItem(feed.FEED_HINT_KEY), null);
  } finally { r.close(); }
});

// ---- the contract with the shared player -----------------------------------------------------------

test('player.js: the ONE progress writer asks the gate before every POST and reports playedSec; an adopting surface does not inherit the gate', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');
  const body = /function saveProgressToServer\(time, opts\) \{([\s\S]*?)\n {2}\}\n/.exec(src);
  assert.ok(body, 'saveProgressToServer found');
  const fn = body[1];
  const gate = fn.indexOf('currentData.progressGate()');
  const post = fn.indexOf("fetch(progressEndpoint, fetchOpts)");
  assert.ok(gate > 0 && post > gate, 'the gate is asked BEFORE the POST');
  assert.match(fn.slice(gate, post), /if \(!gateOpen\) return;/, 'a shut gate returns before the POST');
  assert.match(fn, /body\.playedSec = /, 'the played seconds ride the ping body');
  assert.strictEqual((src.match(/fetch\(progressEndpoint, fetchOpts\)/g) || []).length, 1, 'still the only progress POSTer');
  const { applyAdoptFlavor } = require('../../public/js/player.js');
  const cur = { progressGate: () => false, playedSec: () => 3 };
  applyAdoptFlavor(cur, { title: 'x', progressEndpoint: null });
  assert.strictEqual(cur.progressGate, undefined, 'the watch page adopting the same media saves again');
  assert.strictEqual(cur.playedSec, undefined);
  const g = () => true;
  applyAdoptFlavor(cur, { progressGate: g, playedSec: g });
  assert.strictEqual(cur.progressGate, g, 'a feed card adopting it takes its own');
});
