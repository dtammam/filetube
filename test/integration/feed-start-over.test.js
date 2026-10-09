'use strict';

// [INTEGRATION] v1.381.0 Feed, TikTok style, D9: "Start over" - the ONE deliberate reset, a data-loss surface. Driven
// through the real server: the reset forgets exactly one item's place for this user (video: progress + watched;
// episode: position + played; book: place + finished; Watch later untouched), the previous place is recorded in the
// feed session FIRST and Undo puts EXACTLY those rows back (their own timestamps). The plan's section 5 attacks:
// a double tap, Undo after another device played the item, Undo twice, a late Undo, a restricted user, the input,
// a staged (unflushed) ping, and a ping still in flight from before the reset.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-startover-'));
process.env.PROGRESS_FLUSH_MS = '60000'; // the coalescer flushes only when a test asks (a staged ping stays staged)

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, updateDatabase, scanBooks, flushPendingBookProgress, flushPendingProgress, booksDb, podcastsDb, userStore, feedServed, __mintTestSession,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { buildEpub } = require('../helpers/build-zip');
const podcastStore = require('../../lib/podcasts/store');
const safe = require('../../lib/feed/safe-progress');

let server, base, uid, member, booksDir, bookId, epId;
const subId = 'e'.repeat(32);
const CHAPTER = (n) => `<h1>Chapter ${n}</h1>` + Array.from({ length: 12 }, (_, i) => `<p>Chapter ${n} paragraph ${i} has a handful of words to read in the feed.</p>`).join('');

before(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-startover-lib-'));
  fs.writeFileSync(path.join(booksDir, 'novel.epub'), buildEpub({ title: 'Novel', author: 'Writer', chapters: [CHAPTER(1), CHAPTER(2), CHAPTER(3)] }));
  await updateDatabase(() => booksDb.mutate((db) => { require('../../lib/books/store').ensureBooks(db).folders = [booksDir]; return true; }));
  await scanBooks();
  bookId = Object.values(booksDb.read().items)[0].id;
  const D = process.env.DATA_DIR;
  for (const f of ['Open', 'Hidden']) fs.mkdirSync(path.join(D, f), { recursive: true });
  const item = (id, folder) => ({ id, title: id, filePath: path.join(D, folder, `${id}.mp4`), folderName: folder, rootFolder: D, type: 'video', ext: '.mp4', duration: 600, size: 1, addedAt: 1 });
  const metadata = { v1: item('v1', 'Open'), v2: item('v2', 'Open'), vh: item('vh', 'Hidden') };
  for (const it of Object.values(metadata)) fs.writeFileSync(it.filePath, 'V');
  seedState({ folders: [D], folderSettings: {}, metadata, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  const showDir = path.join(D, 'podcasts', 'Show'); fs.mkdirSync(showDir, { recursive: true });
  fs.writeFileSync(path.join(showDir, 'ep.mp3'), 'E');
  epId = podcastStore.episodeIdFor(subId, 'g1');
  await updateDatabase(() => podcastsDb.mutate((h) => {
    const p = podcastStore.ensurePodcasts(h); p.subscriptions = []; p.episodes = {};
    podcastStore.reduceAddSubscription(p, { id: subId, name: 'Show', feedUrl: 'https://e.com/f.xml' });
    podcastStore.reduceUpsertEpisodes(p, subId, [{ guid: 'g1', title: 'Ep', pubDateMs: 1, durationSec: 1800 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(p, epId, { fileName: 'ep.mp3', filePath: path.join(showDir, 'ep.mp3'), bytes: 1, nowMs: 6000 });
    return true;
  }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  uid = authenticateFetch(server, base).user.id;
  member = __mintTestSession({ username: 'sover-member', role: 'member' });
  userStore.setRestrictions(member.user.id, [{ kind: 'folder', value: 'Hidden' }, { kind: 'library', value: 'books' }]);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(booksDir, { recursive: true, force: true });
});

const post = (p, body, cookie) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
async function session(cookie) { const r = await post('/api/feed/sessions', { plannedMin: 10 }, cookie); assert.strictEqual(r.status, 200); return (await r.json()).session.id; }
const startOver = (sid, kind, id, cookie) => post('/api/feed/start-over', { session: sid, kind, id }, cookie);
const undo = (sid, token, cookie) => post('/api/feed/start-over/undo', { session: sid, token }, cookie);
const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-02T11:11:11.000Z';
const videoPlace = (u, id) => ({ progress: userStore.getOneProgress(u, id), watched: userStore.getWatchedTimes(u)[id] || null });
const podPlace = (u) => ({ progress: userStore.getOnePodcastProgress(u, epId), played: userStore.getPodcastPlayed(u)[epId] || null });
const bookPlace = (u) => ({ progress: userStore.getOneBookProgress(u, bookId), finished: userStore.getBookFinished(u)[bookId] || null });
const recordOf = (sid, token) => (userStore.getFeedSession(uid, sid).summary.moves || []).filter((m) => m.startOver && (!token || m.token === token));

test('D9 video: Start over forgets the place AND the watched latch, keeps Watch later; the record holds the exact previous rows; Undo puts exactly them back', async () => {
  userStore.setProgress(uid, 'v1', { timestamp: 300, duration: 600, updatedAt: T1 });
  userStore.markWatched(uid, 'v1', T2);
  userStore.addWatchLater(uid, 'v1', T1);
  const before = videoPlace(uid, 'v1');
  const sid = await session();
  const r = await startOver(sid, 'media', 'v1');
  assert.strictEqual(r.status, 200);
  const body = await r.json();
  assert.match(body.token, /^[0-9a-f]{24}$/);
  assert.deepStrictEqual(body.previous, { progress: { timestamp: 300, duration: 600, updatedAt: T1 }, watchedAt: T2 });
  assert.deepStrictEqual(videoPlace(uid, 'v1'), { progress: null, watched: null }, 'the place and the latch are forgotten');
  assert.ok(userStore.getWatchLater(uid).includes('v1'), 'Watch later is untouched');
  const rec = recordOf(sid, body.token);
  assert.strictEqual(rec.length, 1);
  assert.deepStrictEqual(rec[0].from, body.previous, 'recorded in the session (D9c): recoverable after the toast');
  const u = await undo(sid, body.token);
  assert.strictEqual(u.status, 200);
  assert.deepStrictEqual(videoPlace(uid, 'v1'), before, 'EXACTLY the previous rows, their own timestamps');
  assert.ok(recordOf(sid, body.token)[0].undoneAt, 'the record says it was undone');
  const again = await undo(sid, body.token);
  assert.strictEqual(again.status, 409);
  assert.strictEqual((await again.json()).reason, 'undone', 'Undo twice: refused');
  assert.deepStrictEqual(videoPlace(uid, 'v1'), before);
});

test('D9 episode and book: the same forget / exact restore (position + played; place + finished)', async () => {
  userStore.setPodcastProgress(uid, epId, { position: 900, duration: 1800, updatedAt: T1 });
  userStore.setPodcastPlayed(uid, epId, T2);
  const podBefore = podPlace(uid);
  userStore.setBookProgress(uid, bookId, { locator: { kind: 'epub', cfi: 'epubcfi(/6/4!/4/2/1:0)', spineIndex: 1, blockIndex: 3 }, percent: 41, updatedAt: T1 });
  userStore.setBookFinished(uid, bookId, T2);
  const bookBefore = bookPlace(uid);
  const sid = await session();
  const p = await (await startOver(sid, 'podcast', epId)).json();
  const b = await (await startOver(sid, 'book', bookId)).json();
  assert.deepStrictEqual(podPlace(uid), { progress: null, played: null });
  assert.deepStrictEqual(bookPlace(uid), { progress: null, finished: null });
  assert.strictEqual((await undo(sid, p.token)).status, 200);
  assert.strictEqual((await undo(sid, b.token)).status, 200);
  assert.deepStrictEqual(podPlace(uid), podBefore);
  assert.deepStrictEqual(bookPlace(uid), bookBefore);
});

test('D9 a double tap: the second Start over finds nothing to forget (409) and records NOTHING - the first token still restores the real place', async () => {
  userStore.setProgress(uid, 'v2', { timestamp: 420, duration: 600, updatedAt: T1 });
  const before = videoPlace(uid, 'v2');
  const sid = await session();
  const [r1, r2] = await Promise.all([startOver(sid, 'media', 'v2'), startOver(sid, 'media', 'v2')]);
  const codes = [r1.status, r2.status].sort();
  assert.deepStrictEqual(codes, [200, 409]);
  const ok = r1.status === 200 ? await r1.json() : await r2.json();
  const no = r1.status === 409 ? await r1.json() : await r2.json();
  assert.strictEqual(no.reason, 'nothing');
  assert.strictEqual(recordOf(sid).length, 1, 'one record, the real place');
  assert.strictEqual((await undo(sid, ok.token)).status, 200);
  assert.deepStrictEqual(videoPlace(uid, 'v2'), before);
});

test('D9 Undo after another device played the item: refused (moved), the newer place stands, the record stays (not undone)', async () => {
  userStore.setProgress(uid, 'v1', { timestamp: 300, duration: 600, updatedAt: T1 });
  const sid = await session();
  const s = await (await startOver(sid, 'media', 'v1')).json();
  // the watch page on another device plays it: its own ping, its own route
  assert.strictEqual((await post('/api/progress', { id: 'v1', timestamp: 20, duration: 600 })).status, 200);
  const newer = (await fetch(`${base}/api/progress/v1`).then((r) => r.json()));
  const u = await undo(sid, s.token);
  assert.strictEqual(u.status, 409);
  assert.strictEqual((await u.json()).reason, 'moved');
  assert.deepStrictEqual(await fetch(`${base}/api/progress/v1`).then((r) => r.json()), newer, 'the newer place stands');
  assert.ok(!recordOf(sid, s.token)[0].undoneAt, 'the record is kept for recovery');
  await flushPendingProgress();
  // a book moved by the reader after its Start over: the same
  userStore.setBookProgress(uid, bookId, { locator: { kind: 'epub', cfi: '', spineIndex: 2, blockIndex: 1 }, percent: 70, updatedAt: T1 });
  const b = await (await startOver(sid, 'book', bookId)).json();
  assert.strictEqual((await post(`/api/books/${bookId}/progress`, { locator: { kind: 'epub', cfi: 'epubcfi(/6/2!/4/2/1:0)', spineIndex: 0, blockIndex: 1 }, percent: 1 })).status, 200);
  const ub = await undo(sid, b.token);
  assert.strictEqual(ub.status, 409);
  assert.strictEqual((await ub.json()).reason, 'moved');
  await flushPendingBookProgress();
  assert.strictEqual(bookPlace(uid).progress.locator.spineIndex, 0, 'the reader\'s place stands');
});

test('D9 a late Undo (after the toast, after more cards): still exact while nothing moved - the record is the recovery', async () => {
  userStore.setPodcastProgress(uid, epId, { position: 1200, duration: 1800, updatedAt: T1 });
  userStore.clearPodcastPlayed(uid, epId);
  const before = podPlace(uid);
  const sid = await session();
  const s = await (await startOver(sid, 'podcast', epId)).json();
  for (let i = 0; i < 3; i++) await fetch(`${base}/api/feed?session=${sid}&count=5`); // more cards served meanwhile
  assert.strictEqual((await undo(sid, s.token)).status, 200);
  assert.deepStrictEqual(podPlace(uid), before);
});

test('D9 a staged (unflushed) ping is part of the place: Start over records it, clears it (no resurrection at the flush), Undo restores it', async () => {
  userStore.setProgress(uid, 'v2', { timestamp: 100, duration: 600, updatedAt: T1 });
  assert.strictEqual((await post('/api/progress', { id: 'v2', timestamp: 250, duration: 600 })).status, 200); // staged, not flushed
  const sid = await session();
  const s = await (await startOver(sid, 'media', 'v2')).json();
  assert.strictEqual(s.previous.progress.timestamp, 250, 'the snapshot reads storage WITH the staged ping');
  await flushPendingProgress();
  assert.strictEqual(userStore.getOneProgress(uid, 'v2'), null, 'the flush did not resurrect the forgotten place');
  assert.strictEqual((await undo(sid, s.token)).status, 200);
  assert.strictEqual(userStore.getOneProgress(uid, 'v2').timestamp, 250);
});

test('D9 a ping in flight from BEFORE the reset cannot put the old place back; the book card cannot write at all; after Undo the card writes again', async () => {
  userStore.setProgress(uid, 'v1', { timestamp: 300, duration: 600, updatedAt: T1 });
  userStore.setBookProgress(uid, bookId, { locator: { kind: 'epub', cfi: '', spineIndex: 1, blockIndex: 0 }, percent: 30, updatedAt: T1 });
  const sid = await session();
  // both served in the session (their cards are on screen)
  for (let i = 0; i < 6; i++) await fetch(`${base}/api/feed?session=${sid}&count=5`);
  const s = await (await startOver(sid, 'media', 'v1')).json();
  for (const ping of [{ id: 'v1', timestamp: 310, duration: 600 }, { id: 'v1', timestamp: 310, duration: 600, playedSec: 75 }]) {
    const r = await post('/api/feed/progress/media', ping);
    assert.strictEqual(r.status, 409, JSON.stringify(ping));
    assert.strictEqual((await r.json()).reason, 'too-early');
  }
  await flushPendingProgress();
  assert.strictEqual(userStore.getOneProgress(uid, 'v1'), null, 'the old place did not come back');
  const b = await (await startOver(sid, 'book', bookId)).json();
  const bw = await post(`/api/feed/progress/book/${bookId}`, { spineIndex: 1, blockIndex: 5 });
  assert.strictEqual(bw.status, 409);
  assert.strictEqual((await bw.json()).reason, 'not-served', 'the book card that was on screen cannot set a place');
  await flushPendingBookProgress();
  assert.strictEqual(userStore.getOneBookProgress(uid, bookId), null);
  assert.strictEqual((await undo(sid, s.token)).status, 200);
  const recBefore = JSON.stringify(recordOf(sid, s.token)[0]);
  assert.strictEqual((await post('/api/feed/progress/media', { id: 'v1', timestamp: 320, duration: 600 })).status, 200, 'after Undo the card continues from its place');
  assert.strictEqual(JSON.stringify(recordOf(sid, s.token)[0]), recBefore, 'the next write is a move of its own: it never merges into the Start over record');
  const moves = userStore.getFeedSession(uid, sid).summary.moves;
  assert.deepStrictEqual(moves[moves.length - 1].to, 320, 'appended after it');
  assert.strictEqual((await undo(sid, b.token)).status, 200);
});

test('D9 the played-seconds bound after a reset (the in-flight guard): a claim the time since the reset cannot allow is too early', () => {
  const base0 = { storedSec: 0, nextSec: 90, served: 'ok', fresh: true, durationSec: 1200 };
  assert.strictEqual(safe.decideTimeMove({ ...base0, playedSec: 75, sinceResetSec: 10 }).reason, 'too-early', '75 s played in 10 s: an old card');
  assert.strictEqual(safe.decideTimeMove({ ...base0, playedSec: 75, sinceResetSec: 40 }).ok, true, '75 s in 40 s at 2x (+2): possible');
  assert.strictEqual(safe.decideTimeMove({ ...base0, playedSec: 83, sinceResetSec: 40 }).reason, 'too-early', 'just over 40 x 2 + 2');
  assert.strictEqual(safe.decideTimeMove({ ...base0, playedSec: 75, sinceResetSec: null }).ok, true, 'no reset: the v1.380.0 rule alone');
  assert.strictEqual(safe.MAX_PLAY_RATE, 2);
});

test('D9 access and input: a hidden item is a neutral 404 (nothing changes), another user\'s session or token is 404, bad input is 400, a NUL never reaches a write', async () => {
  userStore.setProgress(member.user.id, 'vh', { timestamp: 200, duration: 600, updatedAt: T1 });
  const msid = await session(member.cookie);
  const hidden = await startOver(msid, 'media', 'vh', member.cookie);
  assert.strictEqual(hidden.status, 404);
  assert.strictEqual(userStore.getOneProgress(member.user.id, 'vh').timestamp, 200, 'untouched');
  const book = await startOver(msid, 'book', bookId, member.cookie);
  assert.strictEqual(book.status, 404, 'a blocked library');
  assert.strictEqual((await startOver(msid, 'media', 'nope', member.cookie)).status, 404, 'missing and hidden answer alike');
  // the admin's session and token are not the member's
  userStore.setProgress(uid, 'v2', { timestamp: 333, duration: 600, updatedAt: T1 });
  const sid = await session();
  assert.strictEqual((await startOver(sid, 'media', 'v2', member.cookie)).status, 404, 'another user\'s session');
  const s = await (await startOver(sid, 'media', 'v2')).json();
  assert.strictEqual((await undo(sid, s.token, member.cookie)).status, 404, 'another user\'s token');
  assert.strictEqual((await undo(msid, s.token, member.cookie)).status, 404);
  for (const bad of [{ kind: 'song', id: 'v1' }, { kind: 'media', id: '' }, { kind: 'media', id: 'v1\u0000x' }, { kind: 'media', id: 'x'.repeat(300) }, { kind: 'media', id: 7 }, { kind: '__proto__', id: 'v1' }]) {
    const r = await startOver(sid, bad.kind, bad.id);
    assert.strictEqual(r.status, 400, JSON.stringify(bad));
  }
  assert.strictEqual((await startOver(sid, 'media', '__proto__')).status, 404, 'an own-property lookup');
  assert.strictEqual((await post('/api/feed/start-over', { kind: 'media', id: 'v1' })).status, 404, 'no session');
  assert.strictEqual((await undo(sid, 'zz')).status, 400);
  assert.strictEqual((await undo(sid, 'a'.repeat(24))).status, 404, 'an unknown token');
  assert.strictEqual((await undo(sid, s.token)).status, 200);
  assert.strictEqual(userStore.getOneProgress(uid, 'v2').timestamp, 333);
});

test('D9 the record survives the session\'s finish (the client\'s summary never overwrites the server\'s moves)', async () => {
  userStore.setProgress(uid, 'v1', { timestamp: 300, duration: 600, updatedAt: T1 });
  const sid = await session();
  const s = await (await startOver(sid, 'media', 'v1')).json();
  assert.strictEqual((await post(`/api/feed/sessions/${sid}/finish`, { actualSec: 60, summary: { minutes: 1, cards: 1, moves: [] } })).status, 400, 'a client can never send moves');
  assert.strictEqual((await post(`/api/feed/sessions/${sid}/finish`, { actualSec: 60, summary: { minutes: 1, cards: 1 } })).status, 200);
  assert.strictEqual(recordOf(sid, s.token).length, 1, 'still recorded after the finish');
  assert.strictEqual((await undo(sid, s.token)).status, 200);
  void feedServed;
});

test('D9 Undo re-checks visibility: an item hidden from the user after their Start over is a neutral 404 and is NOT restored', async () => {
  const m = __mintTestSession({ username: 'sover-member2', role: 'member' });
  userStore.setProgress(m.user.id, 'v2', { timestamp: 222, duration: 600, updatedAt: T1 });
  const sid = await session(m.cookie);
  const s = await (await startOver(sid, 'media', 'v2', m.cookie)).json();
  assert.ok(s.token);
  userStore.setRestrictions(m.user.id, [{ kind: 'folder', value: 'Open' }]); // the admin hides the folder
  const u = await undo(sid, s.token, m.cookie);
  assert.strictEqual(u.status, 404);
  assert.strictEqual(userStore.getOneProgress(m.user.id, 'v2'), null, 'nothing written for a hidden item');
  userStore.setRestrictions(m.user.id, []);
  assert.strictEqual((await undo(sid, s.token, m.cookie)).status, 200, 'the record still restores once it is visible again');
  assert.strictEqual(userStore.getOneProgress(m.user.id, 'v2').timestamp, 222);
});

test('D9 the Start over record is never merged into: the card\'s next write (after Undo) is a move of its own, the record intact', async () => {
  userStore.setProgress(uid, 'v2', { timestamp: 300, duration: 600, updatedAt: T1 });
  const sid = await session();
  for (let i = 0; i < 6; i++) await fetch(`${base}/api/feed?session=${sid}&count=5`);
  const s = await (await startOver(sid, 'media', 'v2')).json();
  assert.strictEqual((await undo(sid, s.token)).status, 200);
  const rec = JSON.stringify(recordOf(sid, s.token)[0]);
  assert.strictEqual((await post('/api/feed/progress/media', { id: 'v2', timestamp: 330, duration: 600 })).status, 200);
  assert.strictEqual(JSON.stringify(recordOf(sid, s.token)[0]), rec, 'the record (its from, its to: null) is untouched');
  const moves = userStore.getFeedSession(uid, sid).summary.moves;
  assert.strictEqual(moves[moves.length - 1].to, 330, 'the write is appended after it');
  assert.ok(!moves[moves.length - 1].startOver);
});

test('D9 the record comes FIRST: when writing it fails (a disk error), nothing is reset - the place is untouched and the answer is a 500', async () => {
  userStore.setProgress(uid, 'v1', { timestamp: 444, duration: 600, updatedAt: T1 });
  const before = videoPlace(uid, 'v1');
  const sid = await session();
  const real = userStore.appendFeedSessionMove;
  userStore.appendFeedSessionMove = () => { const e = new Error('disk I/O error'); e.code = 'ERR_SQLITE_ERROR'; throw e; };
  try {
    const r = await startOver(sid, 'media', 'v1');
    assert.strictEqual(r.status, 500);
  } finally { userStore.appendFeedSessionMove = real; }
  assert.deepStrictEqual(videoPlace(uid, 'v1'), before, 'nothing forgotten without its record');
});

// ---- gate r1 fix round (adversary ADV-1..3 adopted; qa W3 / W4; adversary W3 A6-A8; security-brief N1, N2) ---------------

test('r1 (adversary W2 / ADV-1, qa W3): a 0 s save STAGED after the reset is a newer intent - Undo answers moved, nothing flushes over a restore', async () => {
  userStore.setProgress(uid, 'v1', { timestamp: 300, duration: 600, updatedAt: T1 });
  const sid = await session();
  const s = await (await startOver(sid, 'media', 'v1')).json();
  assert.strictEqual((await post('/api/progress', { id: 'v1', timestamp: 0, duration: 600 })).status, 200); // the watch page's own "Start over"
  const u = await undo(sid, s.token);
  assert.strictEqual(u.status, 409);
  assert.strictEqual((await u.json()).reason, 'moved');
  assert.ok(!recordOf(sid, s.token)[0].undoneAt, 'the record stays');
  await flushPendingProgress();
  assert.strictEqual(userStore.getOneProgress(uid, 'v1').timestamp, 0, 'the newer intent stands, never a 200 that the flush then undoes');
  // a 0 s ROW already flushed: Undo of a fresh reset is refused too (any row since = moved)
  userStore.setProgress(uid, 'v1', { timestamp: 200, duration: 600, updatedAt: T1 });
  const s2 = await (await startOver(sid, 'media', 'v1')).json();
  userStore.setProgress(uid, 'v1', { timestamp: 0, duration: 600, updatedAt: T2 });
  const u2 = await undo(sid, s2.token);
  assert.strictEqual(u2.status, 409);
  assert.strictEqual((await u2.json()).reason, 'moved');
  assert.strictEqual(userStore.getOneProgress(uid, 'v1').timestamp, 0);
});

test('r1 (qa W3): a book place staged by the reader AFTER the reset makes Undo answer moved (no restore under a pending write)', async () => {
  userStore.setBookProgress(uid, bookId, { locator: { kind: 'epub', cfi: '', spineIndex: 2, blockIndex: 1 }, percent: 70, updatedAt: T1 });
  const sid = await session();
  const s = await (await startOver(sid, 'book', bookId)).json();
  assert.strictEqual((await post(`/api/books/${bookId}/progress`, { locator: { kind: 'epub', cfi: 'epubcfi(/6/2!/4/2/1:0)', spineIndex: 0, blockIndex: 0 }, percent: 0 })).status, 200);
  const u = await undo(sid, s.token);
  assert.strictEqual(u.status, 409);
  assert.strictEqual((await u.json()).reason, 'moved');
  await flushPendingBookProgress();
  assert.strictEqual(userStore.getOneBookProgress(uid, bookId).locator.spineIndex, 0);
});

test('r1 (adversary ADV-3, qa W4 M8): a reader ping STAGED before a book Start over is recorded and never resurrected by the flush', async () => {
  userStore.setBookProgress(uid, bookId, { locator: { kind: 'epub', cfi: '', spineIndex: 1, blockIndex: 0 }, percent: 30, updatedAt: T1 });
  assert.strictEqual((await post(`/api/books/${bookId}/progress`, { locator: { kind: 'epub', cfi: 'epubcfi(/6/4!/4/2/1:0)', spineIndex: 2, blockIndex: 4 }, percent: 66 })).status, 200);
  const sid = await session();
  const s = await (await startOver(sid, 'book', bookId)).json();
  assert.strictEqual(s.previous.progress.locator.spineIndex, 2, 'the snapshot includes the staged reader ping');
  await flushPendingBookProgress();
  assert.strictEqual(userStore.getOneBookProgress(uid, bookId), null, 'the flush did not resurrect the forgotten place');
  assert.strictEqual((await undo(sid, s.token)).status, 200);
  assert.strictEqual(userStore.getOneBookProgress(uid, bookId).locator.spineIndex, 2);
});

test('r1 (adversary ADV-2, security-brief N2): a hidden PODCAST is a neutral 404 on both routes - nothing reset, nothing restored', async () => {
  const m = __mintTestSession({ username: 'sover-pod-member', role: 'member' });
  userStore.setPodcastProgress(m.user.id, epId, { position: 700, duration: 1800, updatedAt: T1 });
  userStore.setRestrictions(m.user.id, [{ kind: 'library', value: 'podcasts' }]);
  const sid = await session(m.cookie);
  assert.strictEqual((await startOver(sid, 'podcast', epId, m.cookie)).status, 404);
  assert.strictEqual(userStore.getOnePodcastProgress(m.user.id, epId).position, 700);
  userStore.setRestrictions(m.user.id, []);
  const s = await (await startOver(sid, 'podcast', epId, m.cookie)).json();
  userStore.setRestrictions(m.user.id, [{ kind: 'show', value: subId }]);
  assert.strictEqual((await undo(sid, s.token, m.cookie)).status, 404);
  assert.strictEqual(userStore.getOnePodcastProgress(m.user.id, epId), null);
});

test('r1 (adversary W3 A6-A8): an item with ONLY a latch (watched / played / finished, no position) is something to forget, and comes back', async () => {
  const sid = await session();
  userStore.removeHistory(uid, 'v2');
  userStore.markWatched(uid, 'v2', T2);
  const v = await startOver(sid, 'media', 'v2');
  assert.strictEqual(v.status, 200, 'a watched latch alone');
  assert.strictEqual(userStore.getWatchedTimes(uid).v2, undefined);
  assert.strictEqual((await undo(sid, (await v.json()).token)).status, 200);
  assert.strictEqual(userStore.getWatchedTimes(uid).v2, T2);
  userStore.resetPodcastPlace(uid, epId);
  userStore.setPodcastPlayed(uid, epId, T2);
  const p = await startOver(sid, 'podcast', epId);
  assert.strictEqual(p.status, 200, 'a played latch alone');
  assert.strictEqual(userStore.getPodcastPlayed(uid)[epId], undefined);
  assert.strictEqual((await undo(sid, (await p.json()).token)).status, 200);
  assert.strictEqual(userStore.getPodcastPlayed(uid)[epId], T2);
  userStore.resetBookPlace(uid, bookId);
  userStore.setBookFinished(uid, bookId, T2);
  const b = await startOver(sid, 'book', bookId);
  assert.strictEqual(b.status, 200, 'a finished latch alone');
  assert.strictEqual(userStore.getBookFinished(uid)[bookId], undefined);
  assert.strictEqual((await undo(sid, (await b.json()).token)).status, 200);
  assert.strictEqual(userStore.getBookFinished(uid)[bookId], T2);
});

test('r1 (security-brief N1): a recorded place of the wrong shape (a crafted or corrupted backup) is refused by Undo, nothing written', async () => {
  const sid = await session();
  userStore.removeHistory(uid, 'v1');
  for (const [kind, id, from] of [
    ['media', 'v1', { progress: { timestamp: 'abc', duration: 600, updatedAt: T1 }, watchedAt: null }],
    ['media', 'v1', { progress: { timestamp: 10, duration: 600, updatedAt: '9'.repeat(80) }, watchedAt: null }],
    ['book', bookId, { progress: { locator: { pad: 'x'.repeat(5000) }, updatedAt: T1 }, finishedAt: null }],
    ['book', bookId, { progress: 'nope', finishedAt: null }],
  ]) {
    if (kind === 'book') userStore.resetBookPlace(uid, bookId);
    const token = require('node:crypto').randomBytes(12).toString('hex');
    const moves = (userStore.getFeedSession(uid, sid).summary || {}).moves || [];
    userStore.setFeedSessionMoves(uid, sid, moves.concat([{ kind, id, startOver: true, token, from, to: null, at: T1 }]));
    const u = await undo(sid, token);
    assert.strictEqual(u.status, 409, JSON.stringify(from).slice(0, 60));
    assert.strictEqual((await u.json()).reason, 'invalid-record');
  }
  assert.strictEqual(userStore.getOneProgress(uid, 'v1'), null);
  assert.strictEqual(userStore.getOneBookProgress(uid, bookId), null);
});
