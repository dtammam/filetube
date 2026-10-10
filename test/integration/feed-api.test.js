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
  app, updateDatabase, scanBooks, flushPendingBookProgress, flushPendingProgress, effectiveBookProgress, effectiveProgress, __mintTestSession, userStore, booksDb, podcastsDb, musicDb, ytdlpDb, feedServed,
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
  // v1.380.0: Delta opens with a copyright page (front matter: the first REAL chapter is spine item 1) and carries a publisher
  // description full of hostile markup (it must reach the card as plain text); Epsilon is two more unliked, unstarted books (Epsilon, Zeta)
  fs.writeFileSync(path.join(booksDir, 'Delta.epub'), buildEpub({
    title: 'Delta', author: 'W', chapters: ['<h1>Copyright</h1><p>All rights reserved.</p>', CHAPTER(1), CHAPTER(2), CHAPTER(3)],
    opfExtra: '<dc:description>&lt;img src=x onerror=alert(1)&gt;A lighthouse &amp; its keeper.&lt;script&gt;steal()&lt;/script&gt;&lt;p&gt;Second line.&lt;/p&gt;</dc:description>',
  }));
  for (const t of ['Epsilon', 'Zeta']) fs.writeFileSync(path.join(booksDir, `${t}.epub`), buildEpub({ title: t, author: 'W', chapters: [CHAPTER(1), CHAPTER(2)] }));
  await updateDatabase(() => booksDb.mutate((db) => { require('../../lib/books/store').ensureBooks(db).folders = [booksDir]; return true; }));
  await scanBooks();
  for (const b of Object.values(booksDb.read().items)) bookIds[b.title] = b.id;

  // media: N_VIDEOS under 'Allowed' (a subscription folder), 10 under 'Hidden', 3 under 'Tiny' (the allowlisted user's whole world)
  for (const d of ['Allowed', 'Hidden', 'Tiny', 'Shelf']) fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true });
  const metadata = {};
  // va0 has a place (a continuing video); the two NEWEST videos (they lead the fresh pool) open with an intro chapter (v1.380.0 D8)
  const INTRO_CHAPTERS = [{ startTime: 0, title: 'Intro' }, { startTime: 60, title: 'The build' }, { startTime: 600, title: 'End' }];
  for (let i = 0; i < N_VIDEOS; i++) metadata[`va${i}`] = mediaItem(`va${i}`, 'Allowed', i === 0 ? { chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 300, title: 'Middle' }, { startTime: 900, title: 'End' }] } : i >= N_VIDEOS - 2 ? { chapters: INTRO_CHAPTERS } : {});
  for (let i = 0; i < 10; i++) metadata[`vh${i}`] = mediaItem(`vh${i}`, 'Hidden');
  for (let i = 0; i < 3; i++) metadata[`vt${i}`] = mediaItem(`vt${i}`, 'Tiny');
  for (let i = 0; i < 150; i++) metadata[`wl${i}`] = mediaItem(`wl${i}`, 'Shelf'); // Watch later rows outside the video pool (no subscription, no progress)
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

  // per-user state: the admin reads three books, likes the fourth and all songs, has an in-progress video and episode, a Watch later list
  const now = new Date().toISOString();
  userStore.setBookProgress(uid, bookIds.Alpha, { locator: { kind: 'epub', cfi: 'epubcfi(/6/2!/4/4/1:0)', spineIndex: 0, blockIndex: 1 }, percent: 10, updatedAt: now });
  userStore.setBookProgress(uid, bookIds.Beta, { locator: { kind: 'epub', cfi: '', spineIndex: 1, blockIndex: 2 }, percent: 40, updatedAt: now });
  // v1.380.0: an unstarted book is a NEW-book card (one a session, never read forward), so the weights falsifier's third long
  // book is one the admin is reading; Delta stays liked and unstarted (the new-book tests)
  userStore.setBookProgress(uid, bookIds.Gamma, { locator: { kind: 'epub', cfi: '', spineIndex: 2, blockIndex: 3 }, percent: 5, updatedAt: now });
  userStore.addBookLiked(uid, bookIds.Gamma, now);
  userStore.addBookLiked(uid, bookIds.Delta, now);
  for (let i = 0; i < N_SONGS; i++) userStore.addMusicLiked(uid, `trk${i}`, now);
  userStore.setProgress(uid, 'va0', { timestamp: 400, duration: 1200, updatedAt: now }); // inside chapter "Middle" (300-900)
  userStore.setProgress(uid, 'va1', { timestamp: 90, duration: 1200, updatedAt: now }); // no chapters: a 3-minute segment (v1.381.0 D10: past the started minute, so it continues)
  userStore.setPodcastProgress(uid, epIds.a[0], { position: 600, duration: 1800, updatedAt: now });
  userStore.addWatchLater(uid, 'va5', now);
  userStore.addWatchLater(uid, userStore.watchLaterKey('podcast', epIds.a[3]), now);
  // 150 more from a folder that is neither subscribed nor in progress (never in the video pool), so a video card showing a
  // Watch later item cannot drain the Watch later kind (it did, 1 run in 3, at 110 rows shared with the video pool)
  for (let i = 0; i < 150; i++) userStore.addWatchLater(uid, `wl${i}`, now);
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
// v1.382.0: `fs` = the Feed settings the client sends (the synced ft-feed-settings value), omitted = the defaults
async function batch(sessionId, count, cookie, exclude, fs) {
  const q = `/api/feed?session=${sessionId}&count=${count}${exclude ? `&exclude=${exclude.join(',')}` : ''}${fs ? `&fs=${encodeURIComponent(fs)}` : ''}`;
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
  assert.ok(['Alpha', 'Beta', 'Gamma'].includes(book.title), 'a book being read comes first');
  assert.ok(Array.isArray(book.blocks) && book.blocks.length > 0 && book.blocks.every((x) => typeof x.text === 'string' && !/</.test(x.text)));
  assert.ok(book.next === null || (Number.isInteger(book.next.spineIndex) && Number.isInteger(book.next.blockIndex)));
  assert.strictEqual(book.readerHref, `/read.html?b=${book.id}`);
  assert.ok(book.dwellSec >= 5);
  const pod = seen.podcast;
  assert.strictEqual(pod.media, 'podcast');
  assert.strictEqual(pod.streamSrc, `/episode/${pod.id}`);
  assert.strictEqual(pod.sliceSec, 120, 'v1.382.0 (D5): the default slice is 2 minutes (was 4)');
  if (pod.id === epIds.a[0]) { assert.strictEqual(pod.startAt, 600); assert.strictEqual(pod.endAt, 720); } else { assert.strictEqual(pod.startAt, 0); assert.strictEqual(pod.endAt, 120); }
  const vid = seen.video;
  assert.strictEqual(vid.media, 'video');
  assert.strictEqual(vid.thumbnailUrl, `/thumbnail/${vid.id}`);
  assert.ok(typeof vid.startAt === 'number' && typeof vid.endAt === 'number' && vid.endAt > vid.startAt);
  assert.strictEqual(seen.watchlater.watchLater, true);
  assert.strictEqual(seen.song.kind, 'song');
  assert.strictEqual(seen.song.track.id, seen.song.id);
  assert.strictEqual(seen.song.track.liked, true, 'the music row shape (publicTrackListItem), liked as the admin liked it');
});

// ---- v1.380.0: the "Start something new" card (R4, D4, D5) ------------------------------------------------
// (placed before the Delta read-through below: Delta must still be unstarted here; Epsilon and Zeta are liked for the
// length of a test and left behind as books being read)

async function newBookCards(sessionId, batches = 30) {
  const out = [];
  for (let i = 0; i < batches; i++) for (const c of (await batch(sessionId, 5)).cards) if (c.kind === 'book' && c.newBook) out.push(c);
  return out;
}

test('v1.380.0 a book with no place is a NEW-book card: description as plain text, a taste from the first REAL chapter, nothing written by serving it, at most one a session', async () => {
  assert.ok(!effectiveBookProgress(uid, bookIds.Delta), 'Delta is unstarted');
  assert.strictEqual(userStore.getOneBookProgress(uid, bookIds.Delta), null);
  const s = await startSession(30);
  // the first batches serve Delta's card; then a SECOND liked unstarted book appears mid-session
  const first = [];
  for (let i = 0; i < 30 && first.length === 0; i++) for (const c of (await batch(s.id, 5)).cards) if (c.kind === 'book' && c.newBook) first.push(c);
  assert.strictEqual(first.length, 1);
  userStore.addBookLiked(uid, bookIds.Epsilon, new Date().toISOString());
  const more = await newBookCards(s.id, 30);
  assert.deepStrictEqual(more, [], 'at most ONE new-book card in a session, whatever else gets liked');
  userStore.removeBookLiked(uid, bookIds.Epsilon);
  const card = first[0];
  assert.strictEqual(card.id, bookIds.Delta, 'the liked unstarted book is the new one');
  assert.strictEqual(card.description, 'A lighthouse & its keeper. Second line.', 'hostile OPF markup arrives as plain text');
  assert.deepStrictEqual(card.start, { spineIndex: 1, blockIndex: 0 }, 'the copyright page (spine 0) is skipped: the first real chapter');
  assert.strictEqual(card.startRule, 'heuristic');
  assert.ok(card.blocks.length > 0 && card.blocks.every((b) => b.spineIndex >= 1), 'the taste is from the first real chapter on');
  assert.ok(card.words >= 150 && card.words < 400, `a taste, not an excerpt: ${card.words} words`);
  assert.strictEqual(card.next, null, 'no next: reading it moves nothing');
  assert.strictEqual(card.atEnd, false);
  assert.strictEqual(card.coverUrl, null);
  assert.strictEqual(card.chapterLabel, 'Chapter 2 of 4');
  // serving wrote nothing; the stored place, the staged place and the finished latch are all still empty
  assert.strictEqual(userStore.getOneBookProgress(uid, bookIds.Delta), null);
  assert.ok(!effectiveBookProgress(uid, bookIds.Delta), 'nothing staged either');
  assert.ok(!Object.prototype.hasOwnProperty.call(userStore.getBookFinished(uid), bookIds.Delta));
  // a book being read is still the v1.379.0 card: no description, a next
  const s2 = await startSession(30);
  const reading = [];
  for (let i = 0; i < 12; i++) for (const c of (await batch(s2.id, 5)).cards) if (c.kind === 'book' && !c.newBook) reading.push(c);
  assert.ok(reading.length > 0 && reading.every((c) => c.description === undefined && c.next), 'a book being read is the v1.379.0 card');
});

test('v1.380.0 (gate r1, W1) several liked unstarted books at once still make ONE new-book card in a session, in a single big batch too', async () => {
  const now = new Date().toISOString();
  userStore.setBookFinished(uid, bookIds.Delta, now);
  userStore.addBookLiked(uid, bookIds.Epsilon, now);
  userStore.addBookLiked(uid, bookIds.Zeta, now);
  try {
    for (let run = 0; run < 8; run++) {
      const s = await startSession(30);
      const big = await batch(s.id, 20);
      const inBatch = big.cards.filter((c) => c.kind === 'book' && c.newBook);
      assert.ok(inBatch.length <= 1, `run ${run}: ${inBatch.length} new-book cards in one batch`);
      const later = await newBookCards(s.id, 10);
      assert.ok(inBatch.length + later.length <= 1, `run ${run}: more than one new-book card in a session`);
    }
  } finally {
    userStore.removeBookLiked(uid, bookIds.Epsilon);
    userStore.removeBookLiked(uid, bookIds.Zeta);
    userStore.clearBookFinished(uid, bookIds.Delta);
  }
});

test('v1.380.0 "Start reading" goes through the SAME forward-only path: never backward, never over another device; on a clean book it lands at the first real chapter', async () => {
  const now = new Date().toISOString();
  userStore.setBookFinished(uid, bookIds.Delta, now); // park Delta (finished books are skipped): Epsilon / Zeta are the only new candidates
  try {
    userStore.addBookLiked(uid, bookIds.Epsilon, now);
    const s = await startSession(30);
    const [card] = await newBookCards(s.id);
    assert.ok(card && card.id === bookIds.Epsilon, 'Epsilon is the new-book card');
    // another device started it first: the tap is refused as stale and the other device's place stands
    userStore.setBookProgress(uid, bookIds.Epsilon, { locator: { kind: 'epub', cfi: '', spineIndex: 1, blockIndex: 2 }, percent: 70, updatedAt: new Date().toISOString() });
    let r = await postJson(`/api/feed/progress/book/${card.id}`, card.start);
    assert.strictEqual(r.status, 409);
    assert.strictEqual((await r.json()).reason, 'stale');
    assert.deepStrictEqual(effectiveBookProgress(uid, bookIds.Epsilon).locator, { kind: 'epub', cfi: '', spineIndex: 1, blockIndex: 2 });
    // re-served from that place, the start (earlier) is backward
    feedServed.mark(uid, 'book', bookIds.Epsilon, effectiveBookProgress(uid, bookIds.Epsilon).updatedAt, s.id);
    r = await postJson(`/api/feed/progress/book/${card.id}`, card.start);
    assert.strictEqual(r.status, 409);
    assert.strictEqual((await r.json()).reason, 'backward');
    assert.deepStrictEqual(effectiveBookProgress(uid, bookIds.Epsilon).locator, { kind: 'epub', cfi: '', spineIndex: 1, blockIndex: 2 }, 'the later place survived both taps');
    userStore.removeBookLiked(uid, bookIds.Epsilon);
    // a clean unstarted book (Zeta): the start lands at the card's start
    userStore.addBookLiked(uid, bookIds.Zeta, now);
    const s2 = await startSession(30);
    const [zeta] = await newBookCards(s2.id);
    assert.ok(zeta && zeta.id === bookIds.Zeta, 'Zeta is the new-book card');
    r = await postJson(`/api/feed/progress/book/${zeta.id}`, zeta.start);
    assert.strictEqual(r.status, 200, await r.text());
    await flushPendingBookProgress();
    assert.deepStrictEqual(effectiveBookProgress(uid, bookIds.Zeta).locator, { kind: 'epub', cfi: '', spineIndex: 0, blockIndex: 0 }, 'the first real chapter (spine 0 here), block 0');
    // the book is now one being read: its next card is the ordinary one, from that place, in the same session
    let next = null;
    for (let i = 0; i < 30 && !next; i++) for (const c of (await batch(s2.id, 5)).cards) if (c.kind === 'book' && c.id === bookIds.Zeta) next = c;
    assert.ok(next && !next.newBook && next.start.spineIndex === 0 && next.next, 'continues from the started place as an ordinary card');
  } finally {
    userStore.clearBookFinished(uid, bookIds.Delta);
  }
});

// "read" a book card the way the view does after its dwell: the feed's write moves the place to the card's next
async function readCard(c) {
  const r = await postJson(`/api/feed/progress/book/${c.id}`, c.next || { atEnd: true });
  assert.strictEqual(r.status, 200, `read ${c.title} ${JSON.stringify(c.next)}: ${await r.text()}`);
}

// the "Start reading" tap on a new-book card: the card's start through the same forward-only POST
async function startReading(c) {
  const r = await postJson(`/api/feed/progress/book/${c.id}`, c.start);
  assert.strictEqual(r.status, 200, `start ${c.title} ${JSON.stringify(c.start)}: ${await r.text()}`);
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
      if (c.id !== bookIds.Delta) continue;
      if (c.newBook) { await startReading(c); continue; } // v1.380.0: an unstarted book starts by the "Start reading" tap, never by being read
      last = c; if (!c.atEnd) await readCard(c);
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

// ---- v1.380.0: new vs continue (R5, D6-D8) and the one-minute rule (D7) ------------------------------------

// v1.382.0 (D5): the shipped v1.380.0 / v1.381.0 tests below run with "Whole chapter" (reel 0), the slice they were written
// for; the reel lengths have their own tests at the end of this file.
const WHOLE_CHAPTER = JSON.stringify({ reel: 0 });
async function firstCards(pred, batches = 40, fs = WHOLE_CHAPTER) {
  const s = await startSession(30);
  const found = [];
  for (let i = 0; i < batches; i++) for (const c of (await batch(s.id, 5, undefined, undefined, fs)).cards) if (pred(c)) found.push(c);
  return { session: s, found };
}
const snapshotMedia = (userId, id) => JSON.stringify({
  progress: userStore.getOneProgress(userId, id) || null, staged: effectiveProgress(userId, id) || null,
  watched: userStore.getWatchedIds(userId).includes(id), watchLater: userStore.getWatchLater(userId).includes(id),
});

test('v1.380.0 fresh flags: an item with no place is fresh (video, episode, Watch later); one with a place is not; the first video served is a continuing one', async () => {
  const { found } = await firstCards((c) => c.media === 'video' || c.media === 'podcast', 12);
  const byId = new Map(found.map((c) => [`${c.kind}:${c.id}`, c]));
  const va0 = byId.get('video:va0'); const va1 = byId.get('video:va1');
  assert.ok(va0 && va1, 'the continuing videos were served');
  assert.strictEqual(va0.fresh, false); assert.strictEqual(va1.fresh, false);
  assert.strictEqual(va0.skippedIntro, false, 'never an intro skip for a card the viewer has a place in');
  const ep0 = byId.get(`podcast:${epIds.a[0]}`);
  assert.ok(ep0 && ep0.fresh === false, 'the episode with a saved position continues');
  const freshVideo = found.find((c) => c.kind === 'video' && c.fresh);
  assert.ok(freshVideo && freshVideo.skippedIntro === true, 'a fresh video from the newest end opens after its intro chapter');
  assert.ok(found.filter((c) => c.kind === 'podcast').every((c) => c.fresh === (c.id !== epIds.a[0])), 'episodes: fresh exactly when there is no saved position');
  const firstVideo = found.find((c) => c.kind === 'video');
  assert.strictEqual(firstVideo.fresh, false, 'D9: with continuing videos to show, the first video card is one of them');
});

test('v1.380.0 D8 intro skip: a fresh video opens on chapter 2 (startAt 60, chapter record), the others do not skip', async () => {
  const { found } = await firstCards((c) => c.kind === 'video' && c.skippedIntro, 40);
  assert.ok(found.length > 0, 'an intro-skipped card was served');
  for (const c of found) {
    assert.ok(['va449', 'va448'].includes(c.id));
    assert.deepStrictEqual({ startAt: c.startAt, endAt: c.endAt, chapter: c.chapter, fresh: c.fresh }, { startAt: 60, endAt: 600, chapter: { index: 1, count: 3, title: 'The build' }, fresh: true });
  }
});

test('v1.380.0 D7 falsifier: a FRESH video swiped at 10 s leaves user_progress, user_watched and user_watch_later byte-identical; at 70 s it has a position', async () => {
  const { found } = await firstCards((c) => c.kind === 'video' && c.fresh && c.id === 'va449', 40);
  assert.ok(found.length > 0, 'a fresh card was served');
  const card = found[0];
  userStore.addWatchLater(uid, card.id, new Date().toISOString());
  await flushPendingProgress();
  const before = snapshotMedia(uid, card.id);
  // every shape of a write inside the first minute: a position ping at 10 s, a ping that would LATCH watched (95%) and leave
  // Watch later, a ping with no playedSec, junk playedSec - all refused, none touches storage
  const attempts = [
    { timestamp: card.startAt + 10, playedSec: 10 }, { timestamp: 570, playedSec: 10 }, { timestamp: 570, playedSec: 59.9 },
    { timestamp: card.startAt + 10 }, { timestamp: 570, playedSec: 'NaN' }, { timestamp: 570, playedSec: -1 }, { timestamp: 570, playedSec: 1e9 + 'x' },
  ];
  for (const a of attempts) {
    const r = await postJson('/api/feed/progress/media', { id: card.id, duration: 600, ...a });
    assert.strictEqual(r.status, 409, JSON.stringify(a));
    assert.strictEqual((await r.json()).reason, 'too-early', JSON.stringify(a));
  }
  await flushPendingProgress();
  assert.strictEqual(snapshotMedia(uid, card.id), before, 'user_progress / user_watched / user_watch_later byte-identical after the early attempts');
  // 70 s of playing: it behaves exactly as v1.379.0 (forward-only, stale-refusing) and the item has a position
  let r = await postJson('/api/feed/progress/media', { id: card.id, timestamp: card.startAt + 70, duration: 600, playedSec: 70 });
  assert.strictEqual(r.status, 200, await r.text());
  await flushPendingProgress();
  assert.strictEqual(userStore.getOneProgress(uid, card.id).timestamp, card.startAt + 70);
  // and from then on the card is no longer fresh: the next ping (a forward one) needs no playedSec, a backward one is still refused
  r = await postJson('/api/feed/progress/media', { id: card.id, timestamp: card.startAt + 75, duration: 600 });
  assert.strictEqual(r.status, 200);
  r = await postJson('/api/feed/progress/media', { id: card.id, timestamp: card.startAt + 20, duration: 600, playedSec: 500 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await r.json()).reason, 'backward');
  // the watched latch + Watch later leave still ride the write once the minute is played
  r = await postJson('/api/feed/progress/media', { id: card.id, timestamp: 570, duration: 600, playedSec: 500 });
  assert.strictEqual(r.status, 200);
  assert.ok(userStore.getWatchedIds(uid).includes(card.id));
  assert.ok(!userStore.getWatchLater(uid).includes(card.id));
});

test('v1.380.0 D7 for a fresh podcast episode: nothing before 60 s of playing; then the old rule', async () => {
  const { found } = await firstCards((c) => c.kind === 'podcast' && c.fresh, 40);
  assert.ok(found.length > 0);
  const card = found[0];
  const before = JSON.stringify({ row: userStore.getOnePodcastProgress(uid, card.id), played: Object.prototype.hasOwnProperty.call(userStore.getPodcastPlayed(uid), card.id) });
  for (const a of [{ timestamp: 10, playedSec: 10 }, { timestamp: 1790, playedSec: 20 }, { timestamp: 10 }]) {
    const r = await postJson('/api/feed/progress/podcast', { id: card.id, duration: 1800, ...a });
    assert.strictEqual(r.status, 409);
    assert.strictEqual((await r.json()).reason, 'too-early');
  }
  assert.strictEqual(JSON.stringify({ row: userStore.getOnePodcastProgress(uid, card.id), played: Object.prototype.hasOwnProperty.call(userStore.getPodcastPlayed(uid), card.id) }), before, 'no row, no played latch');
  const r = await postJson('/api/feed/progress/podcast', { id: card.id, timestamp: 75, duration: 1800, playedSec: 75 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(userStore.getOnePodcastProgress(uid, card.id).position, 75);
});

test('D7 video slices (Whole chapter): the saved place\'s chapter (to the next chapter start) or a 2-minute segment (v1.382.0 D5; was 3)', async () => {
  const s = await startSession(10);
  const cards = [];
  for (let i = 0; i < 12 && !(cards.find((c) => c.id === 'va0') && cards.find((c) => c.id === 'va1')); i++) cards.push(...(await batch(s.id, 5, undefined, undefined, WHOLE_CHAPTER)).cards);
  const va0 = cards.find((c) => c.id === 'va0' && c.kind === 'video');
  const va1 = cards.find((c) => c.id === 'va1' && c.kind === 'video');
  assert.ok(va0 && va1, 'both in-progress videos were served (they lead the pool)');
  assert.deepStrictEqual({ startAt: va0.startAt, endAt: va0.endAt, chapter: va0.chapter }, { startAt: 400, endAt: 900, chapter: { index: 1, count: 3, title: 'Middle' } });
  assert.deepStrictEqual({ startAt: va1.startAt, endAt: va1.endAt, chapter: va1.chapter }, { startAt: 90, endAt: 210, chapter: null });
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

// ---- v1.382.0 Feed settings (plan 2026-10-10-feed-settings D2-D6): the serving falsifiers ---------------------------
// Each request carries the settings as `fs` (the synced ft-feed-settings value), read by public/js/feed-settings.js.

async function cardsWith(fs, n = 150) {
  const s = await startSession(30);
  const out = [];
  while (out.length < n) {
    const b = await batch(s.id, 10, undefined, undefined, fs);
    if (!b.cards.length) break;
    out.push(...b.cards);
  }
  return { session: s, cards: out };
}

test('v1.382.0 D2: a switched-off kind is never served (200 cards each), the others still are', async () => {
  for (const off of [['song', 'book'], ['watchlater'], ['video', 'podcast']]) {
    const { cards } = await cardsWith(JSON.stringify({ off }), 200);
    assert.ok(cards.length >= 150, off + ': cards still come');
    const kinds = new Set(cards.map((c) => c.kind));
    for (const k of off) assert.ok(!kinds.has(k), `${off}: no ${k} card`);
    for (const k of ['book', 'video', 'podcast', 'watchlater', 'song'].filter((x) => !off.includes(x))) assert.ok(kinds.has(k), `${off}: ${k} still served`);
  }
  // Watch later follows its OWN switch: with Videos and Podcasts off, its videos and episodes still come as Watch later cards
  const { cards } = await cardsWith(JSON.stringify({ off: ['video', 'podcast'] }), 200);
  const wl = cards.filter((c) => c.kind === 'watchlater');
  assert.ok(wl.some((c) => c.media === 'video') && wl.some((c) => c.media === 'podcast'), 'Watch later videos and episodes');
  // every kind off is not a value the Feed honours: it reads as all on (the last kind can never be switched off)
  const all = await cardsWith(JSON.stringify({ off: ['video', 'podcast', 'book', 'watchlater', 'song'] }), 60);
  assert.ok(new Set(all.cards.map((c) => c.kind)).size >= 4, 'all off = the defaults');
});

test('v1.382.0 D3: New only serves only new items and Continue only only started ones, per kind (both directions)', async () => {
  let r = await cardsWith(JSON.stringify({ which: { video: 'new', podcast: 'new' } }), 150);
  let vids = r.cards.filter((c) => c.kind === 'video');
  let pods = r.cards.filter((c) => c.kind === 'podcast');
  assert.ok(vids.length > 5 && pods.length > 5);
  assert.ok(vids.every((c) => c.fresh === true), 'New only: no continuing video');
  assert.ok(pods.every((c) => c.fresh === true), 'New only: no continuing episode');
  assert.ok(!vids.some((c) => c.id === 'va0' || c.id === 'va1') && !pods.some((c) => c.id === epIds.a[0]));
  assert.ok(r.cards.some((c) => c.kind === 'watchlater' && c.fresh === false) || r.cards.some((c) => c.kind === 'watchlater'), 'Watch later stays Both');
  r = await cardsWith(JSON.stringify({ which: { video: 'continue', podcast: 'continue' } }), 80);
  vids = r.cards.filter((c) => c.kind === 'video');
  pods = r.cards.filter((c) => c.kind === 'podcast');
  assert.deepStrictEqual(vids.map((c) => c.id).sort(), ['va0', 'va1'], 'Continue only: exactly the two started videos, then the kind drops out');
  // exactly the episodes with a saved place past the started minute (earlier tests in this file start some): read from storage
  const started = Object.entries(userStore.getPodcastProgress(uid)).filter(([, v]) => Number(v.position) >= 60).map(([k]) => k).sort();
  assert.ok(started.includes(epIds.a[0]));
  assert.deepStrictEqual(pods.map((c) => c.id).sort(), started, 'Continue only: the started episodes, each once');
  assert.ok(vids.every((c) => c.fresh === false) && pods.every((c) => c.fresh === false));
  // books: New only = the Start something new card alone; Continue only = never one
  // earlier tests in this file start every unstarted book: make Zeta unstarted again so New only has its one card to serve
  await flushPendingBookProgress();
  userStore.resetBookPlace(uid, bookIds.Zeta);
  assert.ok(!effectiveBookProgress(uid, bookIds.Zeta) && !Object.prototype.hasOwnProperty.call(userStore.getBookFinished(uid), bookIds.Zeta), 'precondition: Zeta is unstarted');
  r = await cardsWith(JSON.stringify({ which: { book: 'new' } }), 80);
  let books = r.cards.filter((c) => c.kind === 'book');
  assert.strictEqual(books.length, 1, 'one new book a session, then the kind drops out');
  assert.strictEqual(books[0].newBook, true);
  r = await cardsWith(JSON.stringify({ which: { book: 'continue' } }), 120);
  books = r.cards.filter((c) => c.kind === 'book');
  assert.ok(books.length > 3 && books.every((c) => !c.newBook), 'Continue only: reading books, never Start something new');
});

test('v1.382.0 D3: a New-only kind stays outside the New / Continue balance (pickCards mixKinds)', () => {
  const pools = { video: ['n1', 'n2', 'n3', 'n4'], watchlater: ['wc1', 'wn1', 'wc2', 'wn2'] };
  const fresh = (k, id) => id.startsWith('n') || id.startsWith('wn');
  const mm = { fresh: 0, cont: 0 };
  mix.pickCards({ pools, count: 4, rng: mix.seededRng(3), isFresh: fresh, mediaMix: mm, weights: { book: 0, video: 50, podcast: 0, watchlater: 50, song: 0 }, mixKinds: ['podcast', 'watchlater'] });
  assert.strictEqual(mm.fresh + mm.cont, 2, 'only the two Watch later picks are counted');
  const mm2 = { fresh: 0, cont: 0 };
  mix.pickCards({ pools: { video: ['n1', 'n2', 'n3', 'n4'], watchlater: ['wc1', 'wn1', 'wc2', 'wn2'] }, count: 4, rng: mix.seededRng(3), isFresh: fresh, mediaMix: mm2, weights: { book: 0, video: 50, podcast: 0, watchlater: 50, song: 0 } });
  assert.strictEqual(mm2.fresh + mm2.cont, 4, 'the default counts every media kind');
});

test('v1.382.0 D4: From the beginning plays a started video / episode from 0 and shows a book from its first chapter; no saved place moves back', async () => {
  const fs0 = JSON.stringify({ which: { video: 'continue', podcast: 'continue', book: 'continue' }, where: { video: 'start', podcast: 'start', book: 'start' } });
  // a STARTED Watch later item (every other Watch later row in the fixture is unstarted, which would make the check vacuous)
  userStore.addWatchLater(uid, 'wl149', new Date().toISOString()); // idempotent: it is on the list
  userStore.setProgress(uid, 'wl149', { timestamp: 300, duration: 1200, updatedAt: new Date().toISOString() });
  // (a started item also joins the video pool, so with Videos on it comes as a Video card first; Videos off leaves the Watch
  // later card alone, with the video "Where" still set to From the beginning)
  const wlRun = await cardsWith(JSON.stringify({ off: ['video'], where: { video: 'start' } }), 200);
  const wl0 = wlRun.cards.find((c) => c.kind === 'watchlater' && c.id === 'wl149');
  assert.ok(wl0 && wl0.fresh === false, 'the started Watch later item was served');
  assert.deepStrictEqual({ fromStart: wl0.fromStart, startAt: wl0.startAt }, { fromStart: false, startAt: 300 }, 'Watch later keeps its saved place');
  const { cards } = await cardsWith(fs0, 60);
  const asVideo = cards.find((c) => c.kind === 'video' && c.id === 'wl149');
  if (asVideo) assert.strictEqual(asVideo.fromStart, true, 'as a Video card it follows the Videos choice');
  const va0 = cards.find((c) => c.kind === 'video' && c.id === 'va0');
  const ep = cards.find((c) => c.kind === 'podcast' && c.id === epIds.a[0]);
  const beta = cards.find((c) => c.kind === 'book' && c.id === bookIds.Beta);
  assert.ok(va0 && ep && beta, 'the three started items were served');
  assert.deepStrictEqual({ fromStart: va0.fromStart, startAt: va0.startAt, endAt: va0.endAt, progress: va0.progress }, { fromStart: true, startAt: 0, endAt: 60, progress: 400 });
  const epStored = Number(userStore.getOnePodcastProgress(uid, epIds.a[0]).position);
  assert.ok(epStored >= 600, 'the episode has its place (600 s, or further after the earlier tests)');
  assert.deepStrictEqual({ fromStart: ep.fromStart, startAt: ep.startAt, endAt: ep.endAt, position: ep.position }, { fromStart: true, startAt: 0, endAt: 120, position: epStored });
  assert.strictEqual(beta.fromStart, true);
  assert.deepStrictEqual(beta.start, { spineIndex: 0, blockIndex: 0 }, 'the first real chapter (Beta has no front matter)');
  assert.ok(cards.filter((c) => c.kind === 'watchlater').every((c) => !c.fromStart), 'Watch later has no Where choice: it keeps its place');
  // the card's own writes while behind the saved place: refused, storage untouched
  await flushPendingProgress(); await flushPendingBookProgress();
  const before = JSON.stringify({ v: userStore.getOneProgress(uid, 'va0'), p: userStore.getOnePodcastProgress(uid, epIds.a[0]), b: effectiveBookProgress(uid, bookIds.Beta) });
  let r = await postJson('/api/feed/progress/media', { id: 'va0', timestamp: 45, duration: 1200, playedSec: 45 });
  assert.strictEqual(r.status, 409); assert.strictEqual((await r.json()).reason, 'backward');
  r = await postJson('/api/feed/progress/podcast', { id: epIds.a[0], timestamp: 110, duration: 1800, playedSec: 110 });
  assert.strictEqual(r.status, 409); assert.strictEqual((await r.json()).reason, 'backward');
  r = await postJson(`/api/feed/progress/book/${bookIds.Beta}`, { spineIndex: 0, blockIndex: 20 });
  assert.strictEqual(r.status, 409); assert.strictEqual((await r.json()).reason, 'backward');
  await flushPendingProgress(); await flushPendingBookProgress();
  assert.strictEqual(JSON.stringify({ v: userStore.getOneProgress(uid, 'va0'), p: userStore.getOnePodcastProgress(uid, epIds.a[0]), b: effectiveBookProgress(uid, bookIds.Beta) }), before, 'every saved place byte-identical');
  // once playback passes the saved place, the place moves (the forward-only rule, unchanged)
  r = await postJson('/api/feed/progress/media', { id: 'va0', timestamp: 410, duration: 1200, playedSec: 70 });
  assert.strictEqual(r.status, 200, await r.text());
  await flushPendingProgress();
  assert.strictEqual(userStore.getOneProgress(uid, 'va0').timestamp, 410);
  // a fresh item never says From the beginning (it starts there anyway); the default never does
  const d = await cardsWith(null, 40);
  assert.ok(d.cards.every((c) => !c.fromStart), 'the default: from the saved place');
});

test('v1.382.0 D5: the reel / slice lengths, the defaults (60 s, 2 min), and junk values reading as the defaults', async () => {
  let r = await cardsWith(JSON.stringify({ reel: 30, slice: 60 }), 60);
  const v = r.cards.filter((c) => c.kind === 'video');
  const p = r.cards.filter((c) => c.kind === 'podcast');
  assert.ok(v.length && p.length);
  for (const c of v) { assert.ok(c.endAt - c.startAt <= 30 && c.endAt - c.startAt > 0, c.id); assert.strictEqual(c.chapter, null); }
  for (const c of p) assert.strictEqual(c.endAt - c.startAt, 60);
  const va0 = v.find((c) => c.id === 'va0');
  if (va0) assert.strictEqual(va0.startAt, va0.progress, 'a reel starts at the saved place, not the chapter start');
  for (const junk of ['{"reel":45,"slice":30}', 'not json', '{"reel":"60"}', 'x'.repeat(5000)]) {
    r = await cardsWith(junk, 30);
    for (const c of r.cards.filter((x) => x.kind === 'video')) assert.ok(c.endAt - c.startAt <= 60, junk.slice(0, 20));
    for (const c of r.cards.filter((x) => x.kind === 'podcast')) assert.strictEqual(c.endAt - c.startAt, 120, junk.slice(0, 20));
  }
  r = await cardsWith(JSON.stringify({ reel: 120 }), 40);
  assert.ok(r.cards.filter((c) => c.kind === 'video').every((c) => c.endAt - c.startAt === 120));
});

test('v1.382.0 D6: a fresh card writes nothing for a 10 s look, nothing short of its whole reel, and counts once the whole reel played', async () => {
  for (const reel of [60, 30]) {
    const { found } = await firstCards((c) => c.kind === 'video' && c.fresh && c.id === 'va448', 40, JSON.stringify({ reel }));
    assert.ok(found.length, 'the fresh card was served with the ' + reel + ' s reel');
    const card = found[found.length - 1];
    assert.strictEqual(card.endAt - card.startAt, reel);
    await flushPendingProgress();
    const before = snapshotMedia(uid, card.id);
    for (const playedSec of [10, reel - 2]) {
      const r = await postJson('/api/feed/progress/media', { id: card.id, timestamp: card.startAt + playedSec, duration: 1200, playedSec });
      assert.strictEqual(r.status, 409, reel + ' / ' + playedSec);
      assert.strictEqual((await r.json()).reason, 'too-early');
    }
    await flushPendingProgress();
    assert.strictEqual(snapshotMedia(uid, card.id), before, 'a look short of the reel left storage byte-identical');
    const r = await postJson('/api/feed/progress/media', { id: card.id, timestamp: card.endAt, duration: 1200, playedSec: reel - 0.75 });
    assert.strictEqual(r.status, 200, 'the whole reel (less the last update) counts as started: ' + reel);
    await flushPendingProgress();
    userStore.removeHistory(uid, card.id); // fresh again for the next reel length
  }
  // the 90 s reel: the minute rule is still the floor that counts (a minute is less than the reel)
  const { found } = await firstCards((c) => c.kind === 'video' && c.fresh && c.id === 'va448', 40, JSON.stringify({ reel: 90 }));
  const card = found[found.length - 1];
  let r = await postJson('/api/feed/progress/media', { id: card.id, timestamp: card.startAt + 59, duration: 1200, playedSec: 59 });
  assert.strictEqual(r.status, 409);
  r = await postJson('/api/feed/progress/media', { id: card.id, timestamp: card.startAt + 61, duration: 1200, playedSec: 61 });
  assert.strictEqual(r.status, 200);
  await flushPendingProgress();
  userStore.removeHistory(uid, card.id);
});

test('v1.382.0 D2 / D3: when everything chosen has been shown, the refill (recycle) still honours the choices', async () => {
  // the allowlisted member sees 3 subscription videos (all New) and has one in Watch later; Watch later is switched off
  userStore.addWatchLater(tiny.user.id, 'vt1', new Date().toISOString());
  const s = await startSession(30, tiny.cookie);
  const fs1 = JSON.stringify({ off: ['watchlater'], which: { video: 'new' } });
  let exhausted = false;
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const b = await batch(s.id, 5, tiny.cookie, undefined, fs1);
    exhausted = exhausted || b.exhausted;
    seen.push(...b.cards);
  }
  assert.ok(exhausted, 'the session ran through everything and refilled');
  assert.ok(seen.length > 3, 'the refill served again');
  assert.ok(seen.every((c) => c.kind === 'video' && c.fresh === true), 'never a Watch later card, never a continuing video: ' + JSON.stringify(seen.map((c) => c.kind + ':' + c.id)));
});

// ---- v1.382.0 (D10, D11): Like / Watch later state on the cards, Hide this (every kind), Fewer from -----------------------
function sendJson(method, urlPath, body, cookie) {
  return fetch(`${base}${urlPath}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
}

test('v1.382.0 D11: Hide this works for every kind, lists with titles, and a hidden item is never served (and is again after Undo)', async () => {
  const songId = 'trk7';
  const targets = [{ kind: 'media', id: 'va3' }, { kind: 'podcast', id: epIds.a[5] }, { kind: 'book', id: bookIds.Gamma }, { kind: 'song', id: songId }, { kind: 'media', id: 'wl3' }];
  for (const t of targets) {
    const r = await sendJson('POST', '/api/feed/hidden', t);
    assert.strictEqual(r.status, 200, JSON.stringify(t));
  }
  const rows = userStore.getFeedHidden(uid);
  for (const k of ['va3', `podcast:${epIds.a[5]}`, `book:${bookIds.Gamma}`, `song:${songId}`, 'wl3']) assert.ok(rows.includes(k), k);
  const list = await (await fetch(`${base}/api/feed/hidden`)).json();
  const byKey = new Map(list.items.map((i) => [i.kind + ':' + i.id, i]));
  assert.deepStrictEqual(byKey.get('media:va3'), { kind: 'media', id: 'va3', title: 'Video va3', sub: 'Allowed' });
  assert.deepStrictEqual(byKey.get(`podcast:${epIds.a[5]}`), { kind: 'podcast', id: epIds.a[5], title: 'Ep a5', sub: 'Show A' });
  assert.deepStrictEqual(byKey.get(`book:${bookIds.Gamma}`), { kind: 'book', id: bookIds.Gamma, title: 'Gamma', sub: 'W' });
  assert.deepStrictEqual(byKey.get(`song:${songId}`), { kind: 'song', id: songId, title: 'Song 7', sub: 'Art' });
  // never served, as itself or as a Watch later card (wl3 and a Watch later episode key share the hidden key)
  userStore.addWatchLater(uid, userStore.watchLaterKey('podcast', epIds.a[5]), new Date().toISOString());
  const { cards } = await cardsWith(JSON.stringify({ which: { video: 'continue' } }), 400);
  const served = (k, id) => cards.some((c) => c.id === id && (k === 'any' || c.kind === k));
  assert.ok(cards.length >= 300);
  for (const t of targets) assert.ok(!served('any', t.id), 'hidden ' + t.kind + ' ' + t.id + ' was served');
  // Undo: served again (Gamma is a long book the admin reads: its next card comes)
  for (const t of targets) assert.strictEqual((await sendJson('DELETE', '/api/feed/hidden', t)).status, 200);
  assert.ok(!userStore.getFeedHidden(uid).some((k) => /^(podcast|book|song):/.test(k) || k === 'va3' || k === 'wl3'));
  const again = await cardsWith(null, 200);
  assert.ok(again.cards.some((c) => c.kind === 'book' && c.id === bookIds.Gamma), 'the book is back');
  assert.strictEqual((await sendJson('DELETE', '/api/feed/hidden', targets[0])).status, 200, 'Undo twice: idempotent');
});

test('v1.382.0 D11 access: Hide never reaches an item the viewer cannot see (one neutral 404, nothing written); bad input is refused; the list never leaks', async () => {
  const mid = member.user.id;
  const before = JSON.stringify(userStore.getFeedHidden(mid));
  const blocked = [{ kind: 'media', id: 'vh1' }, { kind: 'podcast', id: epIds.b[0] }, { kind: 'book', id: bookIds.Alpha }, { kind: 'song', id: 'trk1' }];
  const missing = [{ kind: 'media', id: 'nope' }, { kind: 'podcast', id: 'f'.repeat(32) }, { kind: 'book', id: 'nobook' }, { kind: 'song', id: 'notrack' }];
  const bodies = new Set();
  for (const t of blocked.concat(missing)) {
    const r = await sendJson('POST', '/api/feed/hidden', t, member.cookie);
    assert.strictEqual(r.status, 404, JSON.stringify(t));
    bodies.add(await r.text());
  }
  assert.strictEqual(bodies.size, 1, 'one neutral body for hidden and missing');
  for (const bad of [{ kind: 'video', id: 'va1' }, { kind: 'media', id: '' }, { kind: 'media', id: 'a\u0000b' }, { kind: 'media', id: 'x'.repeat(300) }, { kind: 'media' }, { kind: 'media', id: 7 }, {}, { kind: '__proto__', id: 'va1' }]) {
    assert.strictEqual((await sendJson('POST', '/api/feed/hidden', bad, member.cookie)).status, 400, JSON.stringify(bad));
    assert.strictEqual((await sendJson('DELETE', '/api/feed/hidden', bad, member.cookie)).status, 400, JSON.stringify(bad));
  }
  assert.strictEqual(JSON.stringify(userStore.getFeedHidden(mid)), before, 'nothing written');
  // a row the member cannot see (written by another path, or hidden since) is never listed
  userStore.addFeedHidden(mid, 'vh3', new Date().toISOString());
  userStore.addFeedHidden(mid, `book:${bookIds.Beta}`, new Date().toISOString());
  userStore.addFeedHidden(mid, `song:trk2`, new Date().toISOString());
  userStore.addFeedHidden(mid, `podcast:${epIds.b[1]}`, new Date().toISOString());
  assert.strictEqual((await sendJson('POST', '/api/feed/hidden', { kind: 'media', id: 'va2' }, member.cookie)).status, 200);
  const list = await (await fetch(`${base}/api/feed/hidden`, { headers: { Cookie: member.cookie } })).json();
  assert.deepStrictEqual(list.items.map((i) => i.kind + ':' + i.id), ['media:va2'], 'only what the member can see');
  // the admin's list does not show the member's rows (per user)
  const admin = await (await fetch(`${base}/api/feed/hidden`)).json();
  assert.ok(!admin.items.some((i) => i.id === 'va2'));
});

test('v1.382.0 D11 Fewer from: a show in the synced list comes about a quarter as often (never dropped); the list is read from the viewer\'s stored prefs', async () => {
  const count = async () => {
    const { cards } = await cardsWith(JSON.stringify({ off: ['book', 'video', 'watchlater', 'song'], which: { podcast: 'new' } }), 80);
    const a = cards.filter((c) => c.showName === 'Show A').length;
    const b = cards.filter((c) => c.showName === 'Show B').length;
    return { a, b };
  };
  const base0 = await count();
  assert.ok(base0.a > 25 && base0.b > 25, 'precondition: both shows serve evenly ' + JSON.stringify(base0));
  userStore.setPrefsLWW(uid, [{ key: 'ft-feed-fewer', value: JSON.stringify(['show:show a']), updatedAt: Date.now() }]);
  const fewer = await count();
  assert.ok(fewer.a < fewer.b * 0.5, 'Show A is held back: ' + JSON.stringify(fewer));
  assert.ok(fewer.a > 0, 'held back, not hidden: ' + JSON.stringify(fewer));
  // held back, never dropped: with BOTH shows on the list the held-back episodes still come once the rest has run out
  userStore.setPrefsLWW(uid, [{ key: 'ft-feed-fewer', value: JSON.stringify(['show:Show A', 'show:Show B']), updatedAt: Date.now() + 1 }]);
  const all = await cardsWith(JSON.stringify({ off: ['book', 'video', 'watchlater', 'song'], which: { podcast: 'new' } }), 150);
  const distinct = new Set(all.cards.map((c) => c.id)).size;
  assert.ok(distinct >= 140, 'the held-back episodes still come in turn (distinct, not the kept quarter refilled): ' + distinct);
  userStore.setPrefsLWW(uid, [{ key: 'ft-feed-fewer', value: '', updatedAt: Date.now() + 2 }]);
  const after = await count();
  assert.ok(after.a > 25, 'removed from the list: back to even ' + JSON.stringify(after));
});

test('v1.382.0 D10: cards carry the viewer\'s Like and Watch later state (each kind\'s own rows)', async () => {
  const now = new Date().toISOString();
  userStore.addLiked(uid, 'va1', now);
  userStore.addPodcastLiked(uid, epIds.a[0], now);
  userStore.addWatchLater(uid, 'va1', now);
  const { cards } = await cardsWith(JSON.stringify({ which: { video: 'continue', podcast: 'continue' } }), 60);
  const va1 = cards.find((c) => c.kind === 'video' && c.id === 'va1');
  const va0 = cards.find((c) => c.kind === 'video' && c.id === 'va0');
  const ep = cards.find((c) => c.kind === 'podcast' && c.id === epIds.a[0]);
  assert.deepStrictEqual({ liked: va1.liked, inWatchLater: va1.inWatchLater }, { liked: true, inWatchLater: true });
  assert.deepStrictEqual({ liked: va0.liked, inWatchLater: va0.inWatchLater }, { liked: false, inWatchLater: false });
  assert.strictEqual(ep.liked, true);
  const book = cards.find((c) => c.kind === 'book' && c.id === bookIds.Gamma);
  if (book) assert.strictEqual(book.liked, true, 'Gamma is liked in the fixture');
  const song = cards.find((c) => c.kind === 'song');
  assert.strictEqual(song.track.liked, true, 'a song carries music\'s own liked flag');
  userStore.removeLiked(uid, 'va1'); userStore.removePodcastLiked(uid, epIds.a[0]); userStore.removeWatchLater(uid, 'va1');
});
