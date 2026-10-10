'use strict';

// [UNIT] v1.382.0 Feed settings, the client (plan docs/exec-plans/active/2026-10-10-feed-settings.md W3): the request carries
// the settings (D8: from the next batch on), the "From the beginning" kind line and the player's place FLOOR (D4), the reel-aware
// played-time gate (D6), and Keep watching / listening / reading (D7) - through the REAL view in the jsdom harness and the REAL
// player.js for the floor.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const feed = require('../../public/js/feed.js');
const FS = require('../../public/js/feed-settings.js');
const safe = require('../../lib/feed/safe-progress');
const { feedRealm, BOOK, POD, VID } = require('../helpers/feed-view-harness');

const REPO = path.join(__dirname, '..', '..');
async function start(r) { r.init(); await r.settle(); r.$('#feed-picker-choices button[data-minutes="10"]').click(); await r.settle(); }
const FROM_START_VID = { ...VID, id: 'vs', fresh: false, fromStart: true, progress: 400, startAt: 0, endAt: 60, chapter: null };
const FROM_START_POD = { ...POD, id: 'es', fresh: false, fromStart: true, position: 600, startAt: 0, endAt: 120, sliceSec: 120 };
const REEL_VID = { ...VID, id: 'vr', fresh: false, startAt: 400, endAt: 460, chapter: null };

// ---- pure ------------------------------------------------------------------------------------------------------------

test('D4 labels: a From the beginning card says so (video, Watch later, podcast, book); a fresh card stays New', () => {
  assert.strictEqual(feed.feedKindLine(FROM_START_VID), 'Video · From the beginning');
  assert.strictEqual(feed.feedKindLine(FROM_START_POD), 'Podcast · From the beginning');
  assert.strictEqual(feed.feedKindLine({ kind: 'book', fromStart: true }), 'Book · From the beginning');
  assert.strictEqual(feed.feedKindLine({ kind: 'book', newBook: true, fromStart: true }), 'Start something new');
  assert.strictEqual(feed.feedKindLine({ kind: 'video', media: 'video', fresh: true, fromStart: true, channelName: 'C' }), 'Video · New from C');
  assert.strictEqual(feed.feedKindLine({ ...VID, fresh: false }), 'Video · Continue');
});

test('D6 the client gate mirrors the server rule exactly (duration x slice grid)', () => {
  assert.strictEqual(feed.FEED_REEL_END_SLACK_SEC, safe.REEL_END_SLACK_SEC);
  for (const d of [0, 20, 45, 75, 600, 3600]) {
    for (const sl of [undefined, 0, 30, 45, 60, 90, 120, 240, -1]) assert.strictEqual(feed.feedFreshNeedSec(d, sl), safe.freshNeedSec(d, sl), `${d} / ${sl}`);
  }
});

test('D4 floor: only a From the beginning card carries one, at its saved place; every Feed descriptor declares it', () => {
  assert.strictEqual(feed.feedPlaceFloorSec(FROM_START_VID), 400);
  assert.strictEqual(feed.feedPlaceFloorSec(FROM_START_POD), 600);
  assert.strictEqual(feed.feedPlaceFloorSec({ ...VID, fromStart: false }), undefined);
  assert.strictEqual(feed.feedPlaceFloorSec({ ...FROM_START_VID, progress: 0 }), undefined);
  assert.strictEqual(feed.feedPlayerDescriptor(FROM_START_VID).placeFloorSec, 400);
  assert.strictEqual(feed.feedPlayerDescriptor(FROM_START_POD).placeFloorSec, 600);
  const plain = feed.feedPlayerDescriptor(VID);
  assert.ok(Object.prototype.hasOwnProperty.call(plain, 'placeFloorSec') && plain.placeFloorSec === undefined, 'declared, none');
});

test('D7 pure: where Keep goes, what it says, when it shows', () => {
  assert.strictEqual(feed.feedKeepHref(VID), '/watch.html?v=v1');
  assert.strictEqual(feed.feedKeepHref({ ...VID, media: 'audio', id: 'a b' }), '/watch.html?v=a%20b');
  assert.strictEqual(feed.feedKeepHref(POD), '/podcasts?play=ep1');
  assert.strictEqual(feed.feedKeepHref({ kind: 'song', id: 't1' }), '');
  assert.strictEqual(feed.feedKeepHref(null), '');
  assert.strictEqual(feed.feedKeepLabel(VID), 'Keep watching');
  assert.strictEqual(feed.feedKeepLabel(POD), 'Keep listening');
  assert.strictEqual(feed.feedKeepLabel({ ...VID, media: 'audio' }), 'Keep listening');
  assert.strictEqual(feed.feedKeepLabel(BOOK), 'Keep reading');
  assert.strictEqual(feed.feedKeepDue(11, false, false), false);
  assert.strictEqual(feed.feedKeepDue(10, false, false), true);
  assert.strictEqual(feed.feedKeepDue(0, true, false), true);
  assert.strictEqual(feed.feedKeepDue(50, true, false), true, 'Done shows it whatever the clock says');
  assert.strictEqual(feed.feedKeepDue(5, true, true), false, 'never after the whole file ended');
  assert.strictEqual(feed.feedKeepDue(NaN, false, false), false);
});

test('D8 feedSettingsParam: nothing for the defaults; the stored value, normalized, otherwise; storage that throws reads as the defaults', () => {
  const store = (v) => ({ getItem: () => v });
  assert.strictEqual(feed.feedSettingsParam(store(null), FS), '');
  assert.strictEqual(feed.feedSettingsParam(store('{}'), FS), '');
  assert.strictEqual(feed.feedSettingsParam(store('junk'), FS), '');
  assert.strictEqual(feed.feedSettingsParam(store('{"reel":30,"bogus":1}'), FS), '&fs=' + encodeURIComponent('{"reel":30}'));
  assert.strictEqual(feed.feedSettingsParam({ getItem() { throw new Error('denied'); } }, FS), '');
  assert.strictEqual(feed.feedSettingsParam(store('{"reel":30}'), null), '', 'no shared reading on the page: the defaults');
});

// ---- the player's floor (the REAL player.js) -------------------------------------------------------------------------

function playerRealm() {
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, 'public', 'watch.html'), 'utf8'), { url: 'http://localhost/watch.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.resolveAudioArtUrl = () => '/thumbnail/v1';
  w.formatDuration = () => '';
  w.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState() {} };
  w.MediaMetadata = function (init) { Object.assign(this, init); };
  const posts = [];
  w.fetch = (u, init) => {
    if (init && init.method === 'POST') posts.push({ url: String(u), body: JSON.parse(init.body) });
    const body = String(u).indexOf('/api/queue') === 0 ? { entries: [], pointerUid: null } : {};
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  w.eval(fs.readFileSync(path.join(REPO, 'public', 'js', 'player.js'), 'utf8'));
  const slot = w.document.getElementById('player-slot');
  const at = (sec) => { const m = w.document.getElementById('media-player'); Object.defineProperty(m, 'currentTime', { value: sec, configurable: true, writable: true }); };
  // the player's pause path (stopProgressSaver) runs on the element's own 'pause' event, as in a browser
  const pauseAt = (sec) => { at(sec); w.document.getElementById('media-player').dispatchEvent(new w.Event('pause')); };
  const progressPosts = () => posts.filter((p) => /progress/.test(p.url));
  return { w, player: w.FileTube.player, slot, at, pauseAt, progressPosts, close: () => w.close() };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('the player floor (REAL player.js): a From the beginning card saves nothing at or below its place - in the Feed and after the watch page adopts it - then saves normally once past', async () => {
  const r = playerRealm();
  try {
    const card = feed.feedPlayerDescriptor(FROM_START_VID);
    r.player.load('vs', Object.assign({ id: 'vs', filePath: '/lib/vs.mp4' }, card), { slot: r.slot });
    await settle();
    r.pauseAt(50); await settle();
    assert.strictEqual(r.progressPosts().length, 0, 'behind the place in the Feed: nothing saved');
    // non-vacuity: the same pause path DOES save for a card with no floor (a sibling realm, same steps)
    const ctl = playerRealm();
    try {
      ctl.player.load('vc', Object.assign({ id: 'vc', filePath: '/lib/vc.mp4' }, feed.feedPlayerDescriptor({ ...VID, id: 'vc', fresh: false })), { slot: ctl.slot });
      await settle();
      ctl.pauseAt(50); await settle();
      assert.strictEqual(ctl.progressPosts().length, 1, 'precondition: the pause path saves (the floor is what stops it above)');
      assert.strictEqual(ctl.progressPosts()[0].url, '/api/feed/progress/media');
    } finally { ctl.close(); }
    // Keep watching: the watch page adopts the same id with ITS data (no floor declared, its own save route)
    r.player.load('vs', { id: 'vs', type: 'video', title: 'V', filePath: '/lib/vs.mp4', duration: 1200, browseCtx: '', readerHref: null, resumeMode: null, progressEndpoint: null, autoAdvanceViaTrackNav: false }, { slot: r.slot });
    await settle();
    r.pauseAt(80); await settle();
    r.pauseAt(400); await settle();
    assert.strictEqual(r.progressPosts().length, 0, 'on the watch page, behind (and AT) the place: still nothing saved');
    r.pauseAt(410); await settle();
    const after = r.progressPosts();
    assert.strictEqual(after.length, 1, 'past the place: it saves');
    assert.strictEqual(after[0].url, '/api/progress', 'through the watch page\'s own route');
    assert.strictEqual(after[0].body.timestamp, 410);
    r.pauseAt(100); await settle();
    assert.strictEqual(r.progressPosts().length, 2, 'the floor ended once passed: the watch page saves as it always does');
  } finally { r.close(); }
});

test('the player floor: a surface that declares one (a Feed card) replaces or clears it; one that does not keeps it; junk is none', () => {
  const { applyAdoptFlavor, placeFloorAllows, validPlaceFloor } = require('../../public/js/player.js');
  const cur = { placeFloorSec: 400 };
  applyAdoptFlavor(cur, { title: 'x', progressEndpoint: null });
  assert.strictEqual(cur.placeFloorSec, 400, 'the watch page keeps it');
  applyAdoptFlavor(cur, { placeFloorSec: 120 });
  assert.strictEqual(cur.placeFloorSec, 120);
  applyAdoptFlavor(cur, { placeFloorSec: undefined });
  assert.strictEqual(cur.placeFloorSec, undefined, 'a Feed card without one clears it');
  for (const junk of [-1, 0, NaN, Infinity, '400', null]) assert.strictEqual(validPlaceFloor(junk), undefined, String(junk));
  const c2 = { placeFloorSec: 60 };
  assert.strictEqual(placeFloorAllows(c2, 59), false);
  assert.strictEqual(placeFloorAllows(c2, 60), false, 'equal is not past (the forward-only boundary)');
  assert.strictEqual(placeFloorAllows(c2, NaN), false);
  assert.strictEqual(c2.placeFloorSec, 60, 'a refused save leaves the floor');
  assert.strictEqual(placeFloorAllows(c2, 61), true);
  assert.strictEqual(c2.placeFloorSec, undefined, 'passed: gone');
  assert.strictEqual(placeFloorAllows(null, 1), true);
  assert.strictEqual(placeFloorAllows({ placeFloorSec: 'x' }, 1), true, 'a junk floor is none');
  const src = fs.readFileSync(path.join(REPO, 'public', 'js', 'player.js'), 'utf8');
  const fn = /function saveProgressToServer\(time, opts\) \{([\s\S]*?)\n {2}\}\n/.exec(src)[1];
  assert.ok(fn.indexOf('placeFloorAllows(currentData, time)') > 0 && fn.indexOf('placeFloorAllows(currentData, time)') < fn.indexOf('fetch(progressEndpoint, fetchOpts)'), 'asked before the one POST');
});

// ---- the view ----------------------------------------------------------------------------------------------------

test('D8 (view): each batch carries the stored settings; a change mid-session applies from the next batch and never redraws the cards on screen', async () => {
  // six cards: the first activation is not near the end (no prefetch yet); showing the fourth is
  const six = [BOOK, VID, POD, { ...VID, id: 'v6' }, { ...VID, id: 'v7' }, { ...VID, id: 'v8' }];
  const r = feedRealm({ batches: [{ cards: six, exhausted: false }, { cards: [{ ...VID, id: 'v9' }], exhausted: false }] });
  try {
    r.w.localStorage.setItem(FS.SETTINGS_KEY, JSON.stringify({ off: ['song'], reel: 30 }));
    await start(r);
    const first = r.calls('GET', '/api/feed?');
    assert.strictEqual(first.length, 1);
    assert.ok(first[0].url.endsWith('&fs=' + encodeURIComponent('{"off":["song"],"reel":30}')), first[0].url);
    const before = r.$$('.feed-card').map((n) => n.getAttribute('data-id'));
    r.w.localStorage.setItem(FS.SETTINGS_KEY, JSON.stringify({ reel: 90 }));
    r.show(3); await r.settle(); // the prefetch near the end
    const second = r.calls('GET', '/api/feed?');
    assert.strictEqual(second.length, 2);
    assert.ok(second[1].url.endsWith('&fs=' + encodeURIComponent('{"reel":90}')), second[1].url);
    assert.deepStrictEqual(r.$$('.feed-card').slice(0, 6).map((n) => n.getAttribute('data-id')), before, 'the cards already there are untouched');
    r.w.localStorage.removeItem(FS.SETTINGS_KEY);
  } finally { r.close(); }
  const d = feedRealm({ batches: [{ cards: [BOOK, VID], exhausted: false }] });
  try {
    await start(d);
    assert.ok(!/[?&]fs=/.test(d.calls('GET', '/api/feed?')[0].url), 'the defaults send nothing');
  } finally { d.close(); }
});

test('D4 (view): the kind line says From the beginning and the player gets the floor', async () => {
  const r = feedRealm({ batches: [{ cards: [FROM_START_VID, FROM_START_POD, BOOK], exhausted: false }] });
  try {
    await start(r);
    assert.deepStrictEqual(r.$$('.feed-card__kind').slice(0, 2).map((k) => k.textContent), ['Video · From the beginning', 'Podcast · From the beginning']);
    assert.strictEqual(r.loads.filter((l) => l.id === 'vs')[0].data.placeFloorSec, 400);
  } finally { r.close(); }
});

test('D6 (view): a fresh 60 s reel opens its gate once the whole reel played, not at 10 s (and not a minute)', async () => {
  const r = feedRealm({ batches: [{ cards: [{ ...REEL_VID, fresh: true, startAt: 0, endAt: 60 }, BOOK], exhausted: false }] });
  try {
    await start(r);
    Object.defineProperty(r.media, 'paused', { value: false, configurable: true });
    const data = r.loads.filter((l) => l.id === 'vr')[0].data;
    for (let s = 0; s <= 10; s++) { r.advance(1000); r.timeAt(s); }
    assert.strictEqual(data.progressGate(), false, 'a 10 s look');
    for (let s = 11; s <= 57; s++) { r.advance(1000); r.timeAt(s); }
    assert.strictEqual(data.progressGate(), false, `at ${data.playedSec()} s`);
    for (let s = 58; s <= 59.5; s += 0.5) { r.advance(500); r.timeAt(s); }
    assert.strictEqual(data.progressGate(), true, `the whole reel: ${data.playedSec()} s`);
  } finally { r.close(); }
});

test('D7 (view): Keep watching shows in the last 10 s and on Done; its tap saves the session (no recap), keeps the player playing and opens the watch page', async () => {
  const r = feedRealm({ batches: [{ cards: [REEL_VID, BOOK, POD], exhausted: false }] });
  try {
    await start(r);
    const node = r.$$('.feed-card')[0];
    r.timeAt(440);
    assert.strictEqual(node.querySelector('[data-keep]'), null, '20 s left: not yet');
    r.timeAt(451);
    const pill = node.querySelector('[data-keep]');
    assert.ok(pill, '9 s left: the pill');
    assert.match(pill.textContent, /Keep watching/);
    assert.strictEqual(pill.closest('.feed-card__overlay').firstChild, pill, 'first in the overlay, above the words');
    assert.ok(pill.compareDocumentPosition(node.querySelector('.feed-card__touch')) & r.w.Node.DOCUMENT_POSITION_PRECEDING, 'after the gesture layer: it sits above it');
    const loadsBefore = r.loads.length;
    pill.click();
    await r.settle();
    const finish = r.calls('POST', '/api/feed/sessions/');
    assert.strictEqual(finish.filter((f) => f.url.endsWith('/finish')).length, 1, 'the session record is saved');
    const body = finish.filter((f) => f.url.endsWith('/finish'))[0].body;
    assert.strictEqual(body.summary.cards, 1, 'the card counted');
    assert.strictEqual(r.$('.ui-sheet, #feed-recap'), null, 'no recap');
    const after = r.loads.slice(loadsBefore);
    assert.deepStrictEqual(after, [{ navigate: '/watch.html?v=vr' }], 'no pause, no close: the player goes on; the watch page opens');
    assert.strictEqual(r.w.sessionStorage.getItem(feed.FEED_SESSION_KEY), null, 'the session is over');
    assert.ok(r.$$('.feed-card')[0].querySelector('.feed-card__slot'), 'the stack (and the slot holding the player) is left for the navigation: taking the element out would pause it');
  } finally { r.close(); }
});

test('D7 (view): the Done state shows the pill; a file that ENDED drops it; a podcast says Keep listening and opens the podcasts page', async () => {
  const r = feedRealm({ batches: [{ cards: [REEL_VID, POD, BOOK], exhausted: false }] });
  try {
    await start(r);
    const node = r.$$('.feed-card')[0];
    r.timeAt(460);
    assert.ok(node.hasAttribute('data-done'));
    assert.ok(node.querySelector('[data-keep]'), 'Done: the pill');
    r.media.dispatchEvent(new r.w.Event('ended'));
    assert.strictEqual(node.querySelector('[data-keep]'), null, 'the whole file ended: nothing to keep watching');
    r.show(1);
    r.timeAt(835);
    const pod = r.$$('.feed-card')[1].querySelector('[data-keep]');
    assert.match(pod.textContent, /Keep listening/);
    pod.click();
    await r.settle();
    assert.deepStrictEqual(r.loads.filter((l) => l.navigate), [{ navigate: '/podcasts?play=ep1' }]);
  } finally { r.close(); }
});

test('D7 (view): the pill is never a play / pause tap (a pointer on it reaches no gesture layer)', async () => {
  const r = feedRealm({ batches: [{ cards: [REEL_VID, BOOK], exhausted: false }] });
  try {
    let taps = 0;
    r.w.__harness.player.pictureTap = () => { taps += 1; };
    await start(r);
    r.timeAt(455);
    const pill = r.$$('.feed-card')[0].querySelector('[data-keep]');
    pill.dispatchEvent(new r.w.Event('pointerdown', { bubbles: true }));
    pill.dispatchEvent(new r.w.Event('pointerup', { bubbles: true }));
    assert.strictEqual(taps, 0, 'no picture tap');
  } finally { r.close(); }
});

test('D7 (view): a reading book card offers Keep reading on its LAST page only; the tap writes the pages read, ends the session, opens the reader', async () => {
  const words = (n, from) => Array.from({ length: n }, (_, i) => 'w' + (from + i)).join(' ');
  const LONG = { ...BOOK, blocks: [{ spineIndex: 0, blockIndex: 1, text: words(20, 0) }, { spineIndex: 0, blockIndex: 2, text: words(20, 20) }, { spineIndex: 0, blockIndex: 3, text: words(20, 40) }], dwellSec: 5 };
  const r = feedRealm({ pageWords: 22, batches: [{ cards: [LONG, VID], exhausted: false }] });
  try {
    await start(r);
    const node = r.$$('.feed-card')[0];
    assert.match(node.querySelector('[data-page-readout]').textContent, /Page 1 of 3/);
    assert.strictEqual(node.querySelector('[data-keep]'), null, 'not on page 1');
    r.advance(6000);
    r.w.document.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    r.advance(6000);
    r.w.document.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const pill = node.querySelector('[data-keep]');
    assert.ok(pill, 'the last page');
    assert.match(pill.textContent, /Keep reading/);
    r.w.document.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.strictEqual(node.querySelector('[data-keep]'), null, 'back to page 2: gone');
    r.w.document.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    node.querySelector('[data-keep]').click();
    await r.settle();
    const writes = r.calls('POST', '/api/feed/progress/book/');
    assert.strictEqual(writes.length, 1, 'the pages read move the place');
    assert.deepStrictEqual(writes[0].body, { spineIndex: 0, blockIndex: 3 }, 'to the first page not read');
    assert.strictEqual(r.calls('POST', '/api/feed/sessions/').filter((f) => f.url.endsWith('/finish')).length, 1);
    assert.deepStrictEqual(r.loads.filter((l) => l.navigate), [{ navigate: '/read.html?b=bk1' }]);
  } finally { r.close(); }
});

test('D4 (view): a book read From the beginning is refused as backward without freezing the card; read further, it writes again', async () => {
  let writes = 0;
  const route = (method, url) => {
    if (method === 'POST' && url.indexOf('/api/feed/progress/book/') === 0) { writes += 1; return writes === 1 ? { status: 409, body: { ok: false, reason: 'backward' } } : { status: 200, body: { ok: true } }; }
    return null;
  };
  const words = (n, from) => Array.from({ length: n }, (_, i) => 'w' + (from + i)).join(' ');
  const FS_BOOK = { ...BOOK, fromStart: true, blocks: [{ spineIndex: 0, blockIndex: 0, text: words(20, 0) }, { spineIndex: 0, blockIndex: 1, text: words(20, 20) }, { spineIndex: 0, blockIndex: 2, text: words(20, 40) }], start: { spineIndex: 0, blockIndex: 0 }, next: { spineIndex: 0, blockIndex: 3 } };
  const r = feedRealm({ pageWords: 22, route, batches: [{ cards: [FS_BOOK, VID, { ...VID, id: 'v2' }], exhausted: false }] });
  try {
    await start(r);
    assert.strictEqual(r.$$('.feed-card__kind')[0].textContent, 'Book · From the beginning');
    r.advance(6000);
    r.show(1); await r.settle(); // leave after page 1: a write (refused: behind the place)
    assert.strictEqual(writes, 1);
    r.show(0); await r.settle(); // back: read page 2 and leave again
    r.w.document.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    r.advance(6000);
    r.show(1); await r.settle();
    assert.strictEqual(writes, 2, 'the card still writes after a backward refusal');
    assert.strictEqual(r.toasts.length, 0, 'a backward refusal is not news');
  } finally { r.close(); }
});

test('D7 (view): a library-audio card says Keep listening and opens Music through the audio rule (audioOpenHref), never the watch page', async () => {
  const AUD = { ...REEL_VID, id: 'au1', media: 'audio' };
  const r = feedRealm({ batches: [{ cards: [AUD, BOOK], exhausted: false }] });
  try {
    await start(r);
    r.timeAt(455);
    const pill = r.$$('.feed-card')[0].querySelector('[data-keep]');
    assert.match(pill.textContent, /Keep listening/);
    pill.click();
    await r.settle();
    assert.deepStrictEqual(r.loads.filter((l) => l.navigate), [{ navigate: '/music?play=au1&ao=1' }]);
  } finally { r.close(); }
});
