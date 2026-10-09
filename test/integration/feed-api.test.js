'use strict';

// [INTEGRATION] v1.379.0 Feed mode W2 (plan D3, D6-D9, D13) against the real app: the
// feed's cards and the session record. The plan's falsifiers (section 5):
//   - D3 visibility: a restricted member's feed over 500 cards carries ZERO items they
//     cannot see (books and music libraries blocked, one media folder blocked, one
//     podcast show blocked);
//   - D3 weights: over 1000 cards the kinds land within 5 points of 30/30/20/10/10,
//     never the same kind twice in a row;
//   - what a session has shown is never shown again until the library runs out
//     (`exhausted`, then recycle); the client's `exclude` is honoured;
//   - the card shapes carry what the cards need (a book's text, a podcast's slice from
//     its saved place, a video's chapter slice from its saved place, Watch later labels,
//     a song's music row);
//   - sessions: start (10/20/30 only), extend (counted, capped), finish (bounded), the
//     week line; another user's session id is a neutral 404;
//   - D5's record: a feed write inside a session lands in that session's `moves` with
//     what it moved FROM; a podcast's ping chain is one move, not one per ping.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedapi-'));
process.env.PROGRESS_FLUSH_MS = '50';
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedapi-dl-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, updateDatabase, scanBooks, flushPendingBookProgress, __mintTestSession, userStore, booksDb, podcastsDb, musicDb, ytdlpDb, feedServed,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { buildEpub } = require('../helpers/build-zip');
const podcastStore = require('../../lib/podcasts/store');
const musicStore = require('../../lib/music/store');
const mix = require('../../lib/feed/mix');

let server, base, uid, member, tiny, booksDir;
const subA = 'a'.repeat(32);
const subB = 'b'.repeat(32);
const epIds = { a: [], b: [] };
const bookIds = {}; // title -> id
// 40 paragraphs x 13 words a chapter: an excerpt (450 words) never consumes a book in one card
const CHAPTER = (n) => `<h1>Chapter ${n}</h1>` + Array.from({ length: 40 }, (_, i) => `<p>Chapter ${n} paragraph ${i} has a handful of words to read in the feed.</p>`).join('');
const N_VIDEOS = 450; // the weights falsifier needs pools no kind drains inside 1000 cards
const N_EPISODES = 110; // per show
const N_SONGS = 110;

function mediaItem(id, folder, extra) {
  const file = path.join(DATA_DIR, folder, `${id}.mp4`);
  return { id, title: `Video ${id}`, filePath: file, folderName: folder, rootFolder: DATA_DIR, type: 'video', ext: '.mp4', duration: 1200, size: 1, addedAt: 1000 + Number(id.replace(/\D/g, '')), channelName: folder, ...(extra || {}) };
}

before(async () => {
  // books: three EPUBs (two will be "reading", one liked unstarted)
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedapi-books-'));
  // three long books (150 chapters, ~78k words: ~170 cards each, so the weights falsifier never drains the kind) and one short one
  for (const t of ['Alpha', 'Beta', 'Gamma']) fs.writeFileSync(path.join(booksDir, `${t}.epub`), buildEpub({ title: t, author: 'W', chapters: Array.from({ length: 150 }, (_, i) => CHAPTER(i + 1)) }));
  fs.writeFileSync(path.join(booksDir, 'Delta.epub'), buildEpub({ title: 'Delta', author: 'W', chapters: [CHAPTER(1), CHAPTER(2), CHAPTER(3)] }));
  await updateDatabase(() => booksDb.mutate((db) => { require('../../lib/books/store').ensureBooks(db).folders = [booksDir]; return true; }));
  await scanBooks();
  for (const b of Object.values(booksDb.read().items)) bookIds[b.title] = b.id;

  // media: N_VIDEOS under 'Allowed' (a subscription folder), 10 under 'Hidden', 3 under 'Tiny' (the allowlisted user's whole world)
  for (const d of ['Allowed', 'Hidden', 'Tiny']) fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true });
  const metadata = {};
  for (let i = 0; i < N_VIDEOS; i++) metadata[`va${i}`] = mediaItem(`va${i}`, 'Allowed', i === 0 ? { chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 300, title: 'Middle' }, { startTime: 900, title: 'End' }] } : {});
  for (let i = 0; i < 10; i++) metadata[`vh${i}`] = mediaItem(`vh${i}`, 'Hidden');
  for (let i = 0; i < 3; i++) metadata[`vt${i}`] = mediaItem(`vt${i}`, 'Tiny');
  for (const it of Object.values(metadata)) fs.writeFileSync(it.filePath, 'V');
  seedState({ folders: [DATA_DIR], folderSettings: {}, metadata, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });

  // podcasts: two shows x 6 downloaded episodes; music: 8 tracks; a ytdlp subscription named like the Allowed folder
  const dirA = path.join(DATA_DIR, 'podcasts', 'ShowA'); const dirB = path.join(DATA_DIR, 'podcasts', 'ShowB');
  fs.mkdirSync(dirA, { recursive: true }); fs.mkdirSync(dirB, { recursive: true });
  const trkDir = path.join(DATA_DIR, 'music'); fs.mkdirSync(trkDir, { recursive: true });
  await updateDatabase(() => {
    podcastsDb.mutate((h) => {
      const p = podcastStore.ensurePodcasts(h); p.subscriptions = []; p.episodes = {};
      podcastStore.reduceAddSubscription(p, { id: subA, name: 'Show A', feedUrl: 'https://e.com/a.xml' });
      podcastStore.reduceAddSubscription(p, { id: subB, name: 'Show B', feedUrl: 'https://e.com/b.xml' });
      for (const [sub, key, dir] of [[subA, 'a', dirA], [subB, 'b', dirB]]) {
        for (let i = 0; i < N_EPISODES; i++) {
          const guid = `g${key}${i}`;
          podcastStore.reduceUpsertEpisodes(p, sub, [{ guid, title: `Ep ${key}${i}`, pubDateMs: 1000 + i, durationSec: 1800 }], 'pending', 5000);
          const id = podcastStore.episodeIdFor(sub, guid);
          fs.writeFileSync(path.join(dir, `${guid}.mp3`), 'E');
          podcastStore.reduceEpisodeDownloaded(p, id, { fileName: `${guid}.mp3`, filePath: path.join(dir, `${guid}.mp3`), bytes: 1, nowMs: 6000 });
          epIds[key].push(id);
        }
      }
      return true;
    });
    musicDb.mutate((h) => {
      const tracks = {};
      for (let i = 0; i < N_SONGS; i++) {
        const f = path.join(trkDir, `t${i}.mp3`); fs.writeFileSync(f, 'T');
        tracks[`trk${i}`] = { id: `trk${i}`, title: `Song ${i}`, artist: 'Art', album: 'Al', filePath: f, rootFolder: DATA_DIR, folderName: 'music', ext: '.mp3', codec: 'mp3', durationSec: 200, albumArtKey: null, addedAt: '2026-01-01T00:00:00Z' };
      }
      musicStore.ensureMusic(h).tracks = tracks;
      return true;
    });
    ytdlpDb.mutate((h) => { h.ytdlp.subscriptions = [{ id: 'subAllowed', name: 'Allowed', order: 0 }, { id: 'subTiny', name: 'Tiny', order: 1 }]; return true; });
    return true;
  });

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const auth = authenticateFetch(server, base);
  uid = auth.user.id;
  member = __mintTestSession({ username: 'feedmember', role: 'member' });
  userStore.setRestrictions(member.user.id, [
    { kind: 'library', value: 'books' }, { kind: 'library', value: 'music' },
    { kind: 'folder', value: 'Hidden' }, { kind: 'show', value: subB },
  ]);
  tiny = __mintTestSession({ username: 'feedtiny', role: 'member' });
  userStore.setRestrictions(tiny.user.id, [{ kind: 'mode', value: 'allowlist' }, { kind: 'folder', value: 'Tiny' }]);

  // per-user state: the admin reads two books, likes the third and all songs, has an in-progress video and episode, a Watch later list
  const now = new Date().toISOString();
  userStore.setBookProgress(uid, bookIds.Alpha, { locator: { kind: 'epub', cfi: 'epubcfi(/6/2!/4/4/1:0)', spineIndex: 0, blockIndex: 1 }, percent: 10, updatedAt: now });
  userStore.setBookProgress(uid, bookIds.Beta, { locator: { kind: 'epub', cfi: '', spineIndex: 1, blockIndex: 2 }, percent: 40, updatedAt: now });
  userStore.addBookLiked(uid, bookIds.Gamma, now);
  userStore.addBookLiked(uid, bookIds.Delta, now);
  for (let i = 0; i < N_SONGS; i++) userStore.addMusicLiked(uid, `trk${i}`, now);
  userStore.setProgress(uid, 'va0', { timestamp: 400, duration: 1200, updatedAt: now }); // inside chapter "Middle" (300-900)
  userStore.setProgress(uid, 'va1', { timestamp: 50, duration: 1200, updatedAt: now }); // no chapters: a 3-minute segment
  userStore.setPodcastProgress(uid, epIds.a[0], { position: 600, duration: 1800, updatedAt: now });
  userStore.addWatchLater(uid, 'va5', now);
  userStore.addWatchLater(uid, userStore.watchLaterKey('podcast', epIds.a[3]), now);
  for (let i = 300; i < 410; i++) userStore.addWatchLater(uid, `va${i}`, now); // 110 more, so the Watch later pool never drains inside 1000 cards
  // the member likes songs and lists hidden things they cannot see
  for (let i = 0; i < N_SONGS; i++) userStore.addMusicLiked(member.user.id, `trk${i}`, now);
  userStore.addWatchLater(member.user.id, 'vh1', now);
  userStore.addWatchLater(member.user.id, userStore.watchLaterKey('podcast', epIds.b[0]), now);
  userStore.addWatchLater(member.user.id, 'va2', now);
  userStore.setProgress(member.user.id, 'vh2', { timestamp: 100, duration: 1200, updatedAt: now });
  // gate r1 (adversary W4 / M07): the member READS a hidden-library book and likes another - the book pool must still be empty for them
  userStore.setBookProgress(member.user.id, bookIds.Alpha, { locator: { kind: 'epub', cfi: 'epubcfi(/6/2!/4/4/1:0)', spineIndex: 0, blockIndex: 1 }, percent: 10, updatedAt: now });
  userStore.addBookLiked(member.user.id, bookIds.Gamma, now);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(booksDir, { recursive: true, force: true });
});

function postJson(urlPath, body, cookie) {
  return fetch(`${base}${urlPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
}
async function startSession(plannedMin, cookie) {
  const r = await postJson('/api/feed/sessions', { plannedMin }, cookie);
  const text = await r.text();
  assert.strictEqual(r.status, 200, text);
  return JSON.parse(text).session;
}
async function batch(sessionId, count, cookie, exclude) {
  const q = `/api/feed?session=${sessionId}&count=${count}${exclude ? `&exclude=${exclude.join(',')}` : ''}`;
  const r = await fetch(`${base}${q}`, { headers: cookie ? { Cookie: cookie } : {} });
  const text = await r.text();
  assert.strictEqual(r.status, 200, text);
  return JSON.parse(text);
}

// ---- the cards (D4, D6-D9) --------------------------------------------------------------

test('cards: the admin\'s first batches carry every kind with the fields each card needs', async () => {
  const s = await startSession(20);
  const seen = {};
  for (let i = 0; i < 6; i++) {
    const b = await batch(s.id, 5);
    for (const c of b.cards) seen[c.kind] = seen[c.kind] || c;
  }
  assert.deepStrictEqual(Object.keys(seen).sort(), ['book', 'podcast', 'song', 'video', 'watchlater']);
  const book = seen.book;
  assert.ok(['Alpha', 'Beta'].includes(book.title), 'a book being read comes first');
  assert.ok(Array.isArray(book.blocks) && book.blocks.length > 0 && book.blocks.every((x) => typeof x.text === 'string' && !/</.test(x.text)));
  assert.ok(book.next === null || (Number.isInteger(book.next.spineIndex) && Number.isInteger(book.next.blockIndex)));
  assert.strictEqual(book.readerHref, `/read.html?b=${book.id}`);
  assert.ok(book.dwellSec >= 5);
  const pod = seen.podcast;
  assert.strictEqual(pod.media, 'podcast');
  assert.strictEqual(pod.streamSrc, `/episode/${pod.id}`);
  assert.strictEqual(pod.sliceSec, 240);
  if (pod.id === epIds.a[0]) { assert.strictEqual(pod.startAt, 600); assert.strictEqual(pod.endAt, 840); } else { assert.strictEqual(pod.startAt, 0); assert.strictEqual(pod.endAt, 240); }
  const vid = seen.video;
  assert.strictEqual(vid.media, 'video');
  assert.strictEqual(vid.thumbnailUrl, `/thumbnail/${vid.id}`);
  assert.ok(typeof vid.startAt === 'number' && typeof vid.endAt === 'number' && vid.endAt > vid.startAt);
  assert.strictEqual(seen.watchlater.watchLater, true);
  assert.strictEqual(seen.song.kind, 'song');
  assert.strictEqual(seen.song.track.id, seen.song.id);
  assert.strictEqual(seen.song.track.liked, true, 'the music row shape (publicTrackListItem), liked as the admin liked it');
});

// "read" a book card the way the view does after its dwell: the feed's write moves the place to the card's next
async function readCard(c) {
  const r = await postJson(`/api/feed/progress/book/${c.id}`, c.next || { atEnd: true });
  assert.strictEqual(r.status, 200, `read ${c.title} ${JSON.stringify(c.next)}: ${await r.text()}`);
}

test('a book is "the next pages" once these were READ: a read card\'s next starts the following card; a card swiped past parks the book until its place moves (gate r1, adversary W1); a finished book leaves the session', async () => {
  const s = await startSession(30);
  // 1. Alpha's first card is served from the saved place; without a read, Alpha never comes again in this session
  let first = null;
  for (let i = 0; i < 12 && !first; i++) for (const c of (await batch(s.id, 5)).cards) if (c.kind === 'book' && c.id === bookIds.Alpha) first = c;
  assert.ok(first, 'Alpha was served');
  assert.deepStrictEqual(first.start, { spineIndex: 0, blockIndex: 1 }, 'from the saved place');
  assert.ok(first.words >= 450 && first.words < 600);
  const unread = [];
  for (let i = 0; i < 12; i++) for (const c of (await batch(s.id, 5)).cards) if (c.kind === 'book' && c.id === bookIds.Alpha) unread.push(c);
  assert.deepStrictEqual(unread, [], 'a card swiped past parks the book: no unread text ever goes behind the bookmark');
  // 2. read it: the next Alpha card starts where the read one ended
  await readCard(first);
  let second = null;
  for (let i = 0; i < 12 && !second; i++) for (const c of (await batch(s.id, 5)).cards) if (c.kind === 'book' && c.id === bookIds.Alpha) second = c;
  assert.ok(second, 'Alpha returns once its place moved');
  assert.deepStrictEqual(second.start, first.next, 'the second card starts where the first ended');
  // 3. the reader moving the place (another device, even backward) serves the book again from there
  await flushPendingBookProgress();
  userStore.setBookProgress(uid, bookIds.Alpha, { locator: { kind: 'epub', cfi: '', spineIndex: 0, blockIndex: 1 }, percent: 10, updatedAt: new Date().toISOString() });
  let third = null;
  for (let i = 0; i < 12 && !third; i++) for (const c of (await batch(s.id, 5)).cards) if (c.kind === 'book' && c.id === bookIds.Alpha) third = c;
  assert.ok(third, 'the moved place serves the book again');
  assert.deepStrictEqual(third.start, { spineIndex: 0, blockIndex: 1 }, 'from the reader\'s place');
  // 4. the short book (Delta, liked and unstarted) read card by card reaches its end and leaves the session.
  // A session of its own: Delta was served (and swiped past, unread) during the Alpha steps, so it is parked in that one.
  const s4 = await startSession(30);
  let last = null;
  for (let i = 0; i < 60 && !(last && last.atEnd); i++) {
    for (const c of (await batch(s4.id, 5)).cards) {
      if (c.kind !== 'book') continue;
      if (c.id === bookIds.Delta) { last = c; if (!c.atEnd) await readCard(c); }
    }
  }
  assert.ok(last && last.atEnd, 'Delta reached its end');
  assert.deepStrictEqual(last.next, null);
  await readCard(last); // latches finished through the feed's rule
  assert.ok(Object.prototype.hasOwnProperty.call(userStore.getBookFinished(uid), bookIds.Delta), 'finished');
  const after = [];
  for (let i = 0; i < 12; i++) for (const c of (await batch(s4.id, 5)).cards) if (c.kind === 'book' && c.id === bookIds.Delta) after.push(c);
  assert.deepStrictEqual(after, [], 'a book read to its end is done');
});

test('D7 video slices: the saved place\'s chapter (to the next chapter start) or a 3-minute segment', async () => {
  const s = await startSession(10);
  const cards = [];
  for (let i = 0; i < 12 && !(cards.find((c) => c.id === 'va0') && cards.find((c) => c.id === 'va1')); i++) cards.push(...(await batch(s.id, 5)).cards);
  const va0 = cards.find((c) => c.id === 'va0' && c.kind === 'video');
  const va1 = cards.find((c) => c.id === 'va1' && c.kind === 'video');
  assert.ok(va0 && va1, 'both in-progress videos were served (they lead the pool)');
  assert.deepStrictEqual({ startAt: va0.startAt, endAt: va0.endAt, chapter: va0.chapter }, { startAt: 400, endAt: 900, chapter: { index: 1, count: 3, title: 'Middle' } });
  assert.deepStrictEqual({ startAt: va1.startAt, endAt: va1.endAt, chapter: va1.chapter }, { startAt: 50, endAt: 230, chapter: null });
});

// ---- D3: visibility and weights -------------------------------------------------------------

test('D3 visibility: a restricted member\'s feed over 500 cards contains zero items they cannot see', async () => {
  const s = await startSession(30, member.cookie);
  const allowedMedia = new Set(Array.from({ length: N_VIDEOS }, (_, i) => `va${i}`));
  for (let i = 0; i < 3; i++) allowedMedia.add(`vt${i}`);
  const allowedEps = new Set(epIds.a);
  let n = 0;
  const kinds = new Set();
  while (n < 500) {
    const b = await batch(s.id, 10, member.cookie);
    assert.ok(b.cards.length > 0, 'the member still gets cards (videos, podcasts, their visible Watch later)');
    for (const c of b.cards) {
      n += 1;
      kinds.add(c.kind);
      assert.notStrictEqual(c.kind, 'book', 'books are blocked for this member');
      assert.notStrictEqual(c.kind, 'song', 'music is blocked for this member');
      if (c.media === 'podcast') assert.ok(allowedEps.has(c.id), `hidden show episode served: ${c.id}`);
      else assert.ok(allowedMedia.has(c.id), `hidden folder video served: ${c.id}`);
    }
  }
  assert.ok(kinds.has('video') && kinds.has('podcast') && kinds.has('watchlater'));
  // the member's own Watch later had two hidden rows and one visible: only va2 ever shows up as watchlater
  // (checked above by the allowed sets); and their in-progress hidden video never leads the video pool
});

test('D3 weights: over 1000 cards (the book cards read) every kind is within 5 points of 30/30/20/10/10 and never repeats consecutively', async () => {
  const s = await startSession(30);
  const kinds = [];
  while (kinds.length < 1000) {
    const b = await batch(s.id, 10);
    for (const c of b.cards) { kinds.push(c.kind); if (c.kind === 'book' && c.next) await readCard(c); }
  }
  const share = {};
  for (const k of kinds.slice(0, 1000)) share[k] = (share[k] || 0) + 0.1;
  for (const k of mix.KINDS) assert.ok(Math.abs((share[k] || 0) - mix.DEFAULT_WEIGHTS[k]) <= 5, `${k}: ${(share[k] || 0).toFixed(1)}% vs ${mix.DEFAULT_WEIGHTS[k]}`);
  for (let i = 1; i < kinds.length; i++) assert.notStrictEqual(kinds[i], kinds[i - 1], `repeat at ${i}`);
});

test('never the same item twice until the library runs out: exhausted flags the recycle; the client\'s exclude is honoured', async () => {
  // the allowlisted user sees exactly three videos (folder Tiny) and nothing else
  const s = await startSession(10, tiny.cookie);
  const first = await batch(s.id, 10, tiny.cookie);
  assert.deepStrictEqual(first.cards.map((c) => c.id).sort(), ['vt0', 'vt1', 'vt2'], 'the whole visible library, once each');
  assert.strictEqual(first.exhausted, true, 'fewer than asked: the library ran out');
  const again = await batch(s.id, 2, tiny.cookie);
  assert.strictEqual(again.cards.length, 2, 'after exhaustion the cards keep coming (recycled)');
  assert.ok(again.cards.every((c) => c.id.startsWith('vt')));
  // the admin: 200 cards from the big fixture never repeat a non-book item
  const s1 = await startSession(10);
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const b = await batch(s1.id, 10);
    assert.strictEqual(b.exhausted, false);
    for (const c of b.cards) {
      if (c.kind === 'book') continue; // a book continues by design
      const key = c.kind === 'watchlater' ? `wl:${c.id}` : c.id;
      assert.ok(!seen.has(key), `repeat: ${c.kind} ${c.id}`);
      seen.add(key);
    }
  }
  // a fresh session: exclude the first batch's ids and they never come back
  const s2 = await startSession(10);
  const firstAdmin = await batch(s2.id, 5);
  const ex = firstAdmin.cards.filter((c) => c.kind !== 'book').map((c) => c.id);
  const second = await batch(s2.id, 10, null, ex);
  for (const c of second.cards) assert.ok(!ex.includes(c.id) || c.kind === 'watchlater', `excluded id came back: ${c.id}`);
});

// ---- sessions (D13) ---------------------------------------------------------------------------

test('sessions: start needs 10 / 20 / 30; extend counts and caps; finish is bounded; the week line sums finished time; other users 404', async () => {
  for (const bad of [5, 15, '10', null, undefined]) assert.strictEqual((await postJson('/api/feed/sessions', { plannedMin: bad })).status, 400, String(bad));
  const r = await postJson('/api/feed/sessions', { plannedMin: 10 });
  const { session, week } = await r.json();
  assert.match(session.id, /^[a-f0-9]{16}$/);
  assert.strictEqual(session.plannedMin, 10);
  assert.strictEqual(session.extensions, 0);
  assert.ok(Number.isInteger(week.sessions) && Number.isInteger(week.totalSec));
  // extend
  let e = await postJson(`/api/feed/sessions/${session.id}/extend`, {});
  assert.strictEqual(e.status, 200);
  assert.strictEqual((await e.json()).session.extensions, 1);
  for (let i = 1; i < userStore.FEED_SESSION_MAX_EXTENSIONS; i++) await postJson(`/api/feed/sessions/${session.id}/extend`, {});
  e = await postJson(`/api/feed/sessions/${session.id}/extend`, {});
  assert.strictEqual(e.status, 409, 'capped');
  // finish
  assert.strictEqual((await postJson(`/api/feed/sessions/${session.id}/finish`, { actualSec: -1 })).status, 400);
  assert.strictEqual((await postJson(`/api/feed/sessions/${session.id}/finish`, { actualSec: 1.5 })).status, 400);
  assert.strictEqual((await postJson(`/api/feed/sessions/${session.id}/finish`, { actualSec: 60, summary: [] })).status, 400);
  assert.strictEqual((await postJson(`/api/feed/sessions/${session.id}/finish`, { actualSec: 60, summary: { moves: [] } })).status, 400, 'moves is the server\'s');
  assert.strictEqual((await postJson(`/api/feed/sessions/${session.id}/finish`, { actualSec: 60, summary: { x: 'y'.repeat(20000) } })).status, 400);
  const weekBefore = (await (await fetch(`${base}/api/feed/sessions/week`)).json()).totalSec;
  const f = await postJson(`/api/feed/sessions/${session.id}/finish`, { actualSec: 612, summary: { pages: 14, extensions: 1 } });
  assert.strictEqual(f.status, 200);
  const fin = await f.json();
  assert.strictEqual(fin.session.actualSec, 612);
  assert.deepStrictEqual(fin.session.summary, { pages: 14, extensions: 1 });
  assert.strictEqual(fin.week.totalSec, weekBefore + 612);
  const weekAfter = await (await fetch(`${base}/api/feed/sessions/week`)).json();
  assert.strictEqual(weekAfter.totalSec, weekBefore + 612);
  assert.ok(weekAfter.sessions >= 1);
  // another user's session id: neutral 404 on every route, and the feed itself
  const other = await startSession(10, member.cookie);
  assert.strictEqual((await postJson(`/api/feed/sessions/${other.id}/extend`, {})).status, 404);
  assert.strictEqual((await postJson(`/api/feed/sessions/${other.id}/finish`, { actualSec: 1 })).status, 404);
  assert.strictEqual((await fetch(`${base}/api/feed?session=${other.id}`)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/feed?session=zzzz`)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/feed`)).status, 404, 'no session, no feed');
  assert.strictEqual(userStore.getFeedSession(member.user.id, other.id).extensions, 0, 'untouched');
});

// ---- D5's record: moves land in the session that served the card -------------------------------

test('a feed write inside a session records the move with what it moved FROM; a podcast ping chain is one move', async () => {
  const s = await startSession(20);
  // serve until the Alpha book card and the in-progress episode have been served in THIS session
  let gotBook = null; let gotEp = null;
  for (let i = 0; i < 20 && !(gotBook && gotEp); i++) {
    const b = await batch(s.id, 10);
    for (const c of b.cards) {
      if (c.kind === 'book' && c.id === bookIds.Alpha) gotBook = c;
      if (c.media === 'podcast' && c.id === epIds.a[0]) gotEp = c;
    }
  }
  assert.ok(gotBook && gotEp, 'both served');
  assert.strictEqual(feedServed.sessionOf(uid, 'book', bookIds.Alpha), s.id);
  const before = userStore.getOneBookProgress(uid, bookIds.Alpha).locator;
  let r = await postJson(`/api/feed/progress/book/${bookIds.Alpha}`, gotBook.next);
  assert.strictEqual(r.status, 200, r.status === 200 ? '' : await r.text());
  await flushPendingBookProgress();
  let rec = userStore.getFeedSession(uid, s.id);
  assert.strictEqual(rec.summary.moves.length, 1);
  assert.deepStrictEqual(rec.summary.moves[0].from, before, 'what it moved FROM is kept');
  assert.deepStrictEqual(rec.summary.moves[0].to, { kind: 'epub', cfi: '', ...gotBook.next });
  assert.strictEqual(rec.summary.moves[0].kind, 'book');
  // the podcast chain: three pings, one move, first from / latest to
  for (const t of [604, 608, 612]) {
    r = await postJson('/api/feed/progress/podcast', { id: epIds.a[0], timestamp: t, duration: 1800 });
    assert.strictEqual(r.status, 200, r.status === 200 ? '' : await r.text());
  }
  rec = userStore.getFeedSession(uid, s.id);
  assert.strictEqual(rec.summary.moves.length, 2);
  assert.deepStrictEqual({ kind: rec.summary.moves[1].kind, id: rec.summary.moves[1].id, from: rec.summary.moves[1].from, to: rec.summary.moves[1].to }, { kind: 'podcast', id: epIds.a[0], from: 600, to: 612 });
  // finishing keeps the moves beside the client's recap
  r = await postJson(`/api/feed/sessions/${s.id}/finish`, { actualSec: 300, summary: { pages: 3 } });
  assert.strictEqual(r.status, 200);
  rec = userStore.getFeedSession(uid, s.id);
  assert.strictEqual(rec.summary.pages, 3);
  assert.strictEqual(rec.summary.moves.length, 2);
});
