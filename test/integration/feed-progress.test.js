'use strict';

// [INTEGRATION] v1.379.0 Feed mode W1 (plan D4 + D5) against the real app: the book
// excerpt route and the feed's forward-only, never-over-another-device progress
// writes for books, podcast episodes and media. The plan's falsifiers (section 5):
//   - a book's feed excerpt equals the chunker's text at three positions, one of them
//     a chapter boundary, and `next` is the first unread block;
//   - a feed write after another device moved the book further is REFUSED and the
//     stored position is unchanged; a backward write is refused; an equal one too;
//   - the accepted write stores a BLOCK position ({ cfi: '', spineIndex, blockIndex })
//     the reader resolves in epub.js's live DOM (the browser measurement is
//     tools/feed-proof/reader-resume.js);
//   - the same rule for a podcast position and a media position, through the kinds'
//     own effects (the played latch, the watched latch, Watch later leaves);
//   - a hidden item is a neutral 404 on every one of the four routes; a card never
//     served (or served to another user) cannot write.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedprog-'));
process.env.PROGRESS_FLUSH_MS = '50';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, updateDatabase, scanBooks, flushPendingBookProgress, flushPendingProgress, effectiveBookProgress, effectiveProgress,
  __mintTestSession, userStore, booksDb, podcastsDb, feedServed,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { buildEpub } = require('../helpers/build-zip');
const chunk = require('../../lib/books/tts-chunk');
const podcastStore = require('../../lib/podcasts/store');

let server;
let base;
let uid;
let member; // a member restricted away from every library (the neutral-404 probe)
let booksDir;
let epubId;
let pdfId;
const CHAPTERS = [
  '<h1>Chapter One</h1><p>The first paragraph of chapter one has exactly nine words.</p><p>Second paragraph here with seven words in it.</p><p>Third paragraph of the opening chapter closes it out.</p>',
  '<h1>Chapter Two</h1><blockquote><p>A quoted opening line for chapter two.</p></blockquote><p>Then an ordinary paragraph follows the quotation.</p>',
  '<h1>Chapter Three</h1><p>The last chapter has one paragraph and then it ends.</p>',
];
const subId = 'c'.repeat(32);
let epId;
const vidFile = path.join(process.env.DATA_DIR, 'v.mp4');

function chapterBlocks(i) {
  return chunk.chunkChapterDetailed(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${CHAPTERS[i]}</body></html>`);
}

before(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedprog-lib-'));
  fs.writeFileSync(path.join(booksDir, 'novel.epub'), buildEpub({ title: 'Novel', author: 'Writer', chapters: CHAPTERS }));
  fs.writeFileSync(path.join(booksDir, 'manual.pdf'), '%PDF-1.4 0123456789'.repeat(100));
  await updateDatabase(() => booksDb.mutate((db) => {
    require('../../lib/books/store').ensureBooks(db).folders = [booksDir];
    return true;
  }));
  await scanBooks();
  const items = booksDb.read().items;
  epubId = Object.values(items).find((i) => i.format === 'epub').id;
  pdfId = Object.values(items).find((i) => i.format === 'pdf').id;

  // a downloaded podcast episode and a media item
  const showDir = path.join(process.env.DATA_DIR, 'podcasts', 'Show'); fs.mkdirSync(showDir, { recursive: true });
  fs.writeFileSync(path.join(showDir, 'ep.mp3'), 'E');
  epId = podcastStore.episodeIdFor(subId, 'g1');
  fs.writeFileSync(vidFile, 'V');
  seedState({
    folders: [process.env.DATA_DIR], folderSettings: {},
    metadata: { vid: { id: 'vid', title: 'V', filePath: vidFile, folderName: 'F', rootFolder: process.env.DATA_DIR, type: 'video', ext: '.mp4', duration: 600, size: 1, addedAt: 1 } },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
  await updateDatabase(() => podcastsDb.mutate((h) => {
    const p = podcastStore.ensurePodcasts(h); p.subscriptions = []; p.episodes = {};
    podcastStore.reduceAddSubscription(p, { id: subId, name: 'Show', feedUrl: 'https://e.com/f.xml' });
    podcastStore.reduceUpsertEpisodes(p, subId, [{ guid: 'g1', title: 'Ep', pubDateMs: 1, durationSec: 1800 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(p, epId, { fileName: 'ep.mp3', filePath: path.join(showDir, 'ep.mp3'), bytes: 1, nowMs: 6000 });
    return true;
  }));

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const auth = authenticateFetch(server, base);
  uid = auth.user.id;
  member = __mintTestSession({ username: 'feedlocked', role: 'member' });
  userStore.setRestrictions(member.user.id, [
    { kind: 'library', value: 'video' }, { kind: 'library', value: 'music' },
    { kind: 'library', value: 'podcasts' }, { kind: 'library', value: 'books' },
  ]);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(booksDir, { recursive: true, force: true });
});

function postJson(urlPath, body, extra) {
  return fetch(`${base}${urlPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(extra && extra.headers) }, body: JSON.stringify(body) });
}
async function readerPing(locator, percent) {
  const r = await postJson(`/api/books/${epubId}/progress`, { locator, percent });
  assert.strictEqual(r.status, 200);
  await flushPendingBookProgress();
}
async function excerpt(query) {
  const r = await fetch(`${base}/api/books/${epubId}/excerpt${query || ''}`);
  const text = await r.text();
  assert.strictEqual(r.status, 200, text);
  return JSON.parse(text);
}

// ---- the excerpt route (D4) ---------------------------------------------------------------

test('excerpt: an unstarted book starts at (0,0); the blocks are the chunker\'s text, headings marked, next is the first unread block', async () => {
  const e = await excerpt('?words=13');
  assert.strictEqual(e.format, 'epub');
  assert.strictEqual(e.spineCount, 3);
  assert.strictEqual(e.chapterLabel, 'Chapter 1 of 3');
  assert.strictEqual(e.stored, null);
  const want = chapterBlocks(0);
  assert.deepStrictEqual(e.blocks.map((b) => b.text), [want[0].text, want[1].text, want[2].text]);
  assert.strictEqual(e.blocks[0].heading, true);
  assert.strictEqual(e.blocks[0].chapterStart, true);
  assert.strictEqual(e.words, 2 + 10 + 8);
  assert.deepStrictEqual(e.next, { spineIndex: 0, blockIndex: 3 });
  assert.strictEqual(e.atEnd, false);
  assert.strictEqual(e.dwellSec, 5, 'a short excerpt still asks for 5 s');
  for (const b of e.blocks) assert.ok(!/</.test(b.text), 'plain text, never markup');
});

test('excerpt: three positions, the chapter boundary among them, equal the chunker\'s text; ?spine=&block= overrides the saved place', async () => {
  // position A: mid chapter 1
  const a = await excerpt('?spine=0&block=2&words=1');
  assert.deepStrictEqual(a.blocks.map((b) => b.text), [chapterBlocks(0)[2].text]);
  assert.deepStrictEqual(a.next, { spineIndex: 0, blockIndex: 3 });
  // position B: the last paragraph of chapter 1 -> next is the START of chapter 2 (the boundary)
  const b = await excerpt('?spine=0&block=3&words=1');
  assert.deepStrictEqual(b.blocks.map((t) => t.text), [chapterBlocks(0)[3].text]);
  assert.deepStrictEqual(b.next, { spineIndex: 1, blockIndex: 0 });
  assert.strictEqual(b.chapterLabel, 'Chapter 1 of 3');
  // position C: chapter 2's empty blockquote slot -> starts on the quoted paragraph inside it
  const c = await excerpt('?spine=1&block=1&words=3');
  assert.deepStrictEqual(c.start, { spineIndex: 1, blockIndex: 2 });
  assert.deepStrictEqual(c.blocks.map((t) => t.text), [chapterBlocks(1)[2].text]);
  assert.strictEqual(c.chapterLabel, 'Chapter 2 of 3');
  assert.deepStrictEqual(c.next, { spineIndex: 1, blockIndex: 3 });
  // crossing: from the end of chapter 2 with a big target runs into chapter 3 and the book's end
  const d = await excerpt('?spine=1&block=3&words=400');
  assert.deepStrictEqual(d.blocks.map((t) => [t.spineIndex, t.blockIndex, t.text]), [
    [1, 3, chapterBlocks(1)[3].text], [2, 0, 'Chapter Three'], [2, 1, chapterBlocks(2)[1].text],
  ]);
  assert.strictEqual(d.blocks[1].chapterStart, true);
  assert.strictEqual(d.next, null);
  assert.strictEqual(d.atEnd, true);
});

test('excerpt: a PDF is 400 (no server text), a spine past the end is 400, a hidden book and an unknown id are neutral 404s', async () => {
  assert.strictEqual((await fetch(`${base}/api/books/${pdfId}/excerpt`)).status, 400);
  assert.strictEqual((await fetch(`${base}/api/books/${epubId}/excerpt?spine=9&block=0`)).status, 400);
  assert.strictEqual((await fetch(`${base}/api/books/nope/excerpt`)).status, 404);
  const hidden = await fetch(`${base}/api/books/${epubId}/excerpt`, { headers: { Cookie: member.cookie } });
  assert.strictEqual(hidden.status, 404);
  assert.deepStrictEqual(await hidden.json(), { error: 'Book not found' }, 'the same body as a missing book');
});

// ---- the book write (D5) ---------------------------------------------------------------

test('D5 book: the write lands only after a serve; it refuses stale, backward and equal moves and leaves the stored place untouched', async () => {
  // The reader saved a place in chapter 1, paragraph 1 (its own CFI shape).
  await readerPing({ kind: 'epub', cfi: 'epubcfi(/6/2!/4/4/1:0)', spineIndex: 0, blockIndex: 1 }, 10);
  const before = effectiveBookProgress(uid, epubId);
  assert.deepStrictEqual(before.locator, { kind: 'epub', cfi: 'epubcfi(/6/2!/4/4/1:0)', spineIndex: 0, blockIndex: 1 });

  // Nothing served yet in this process for this user+book: refused, untouched.
  feedServed.forget(uid, 'book', epubId);
  let r = await postJson(`/api/feed/progress/book/${epubId}`, { spineIndex: 0, blockIndex: 3 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await r.json()).reason, 'not-served');
  assert.deepStrictEqual(effectiveBookProgress(uid, epubId), before);

  // Serve the card (the excerpt route marks the position), then another device reads on.
  const e = await excerpt('?words=10');
  assert.deepStrictEqual(e.stored.position, { spineIndex: 0, blockIndex: 1 });
  assert.deepStrictEqual(e.next, { spineIndex: 0, blockIndex: 2 }, 'paragraph 1 alone is 10 words; next is paragraph 2');
  await readerPing({ kind: 'epub', cfi: 'epubcfi(/6/2!/4/6/1:0)', spineIndex: 0, blockIndex: 2 }, 20);
  const moved = effectiveBookProgress(uid, epubId);
  r = await postJson(`/api/feed/progress/book/${epubId}`, { spineIndex: 0, blockIndex: 3 });
  assert.strictEqual(r.status, 409);
  const stale = await r.json();
  assert.strictEqual(stale.reason, 'stale');
  assert.deepStrictEqual(stale.stored, { spineIndex: 0, blockIndex: 2 });
  assert.deepStrictEqual(effectiveBookProgress(uid, epubId), moved, 'the other device\'s place stands');

  // Re-serve from the moved place; a backward and an equal move are refused.
  await excerpt('?words=10');
  for (const target of [{ spineIndex: 0, blockIndex: 1 }, { spineIndex: 0, blockIndex: 2 }]) {
    r = await postJson(`/api/feed/progress/book/${epubId}`, target);
    assert.strictEqual(r.status, 409, JSON.stringify(target));
    assert.strictEqual((await r.json()).reason, 'backward');
    assert.deepStrictEqual(effectiveBookProgress(uid, epubId), moved);
  }
  // malformed targets are 400 and never written
  for (const bad of [{ spineIndex: 0 }, { spineIndex: 0, blockIndex: -1 }, { spineIndex: '0', blockIndex: 3 }, {}]) {
    r = await postJson(`/api/feed/progress/book/${epubId}`, bad);
    assert.strictEqual(r.status, 400, JSON.stringify(bad));
  }
  // a block that does not exist in that chapter is 400 too
  r = await postJson(`/api/feed/progress/book/${epubId}`, { spineIndex: 0, blockIndex: 99 });
  assert.strictEqual(r.status, 400);
  assert.deepStrictEqual(effectiveBookProgress(uid, epubId), moved);
});

test('D5 book: a forward move stores a block position (empty cfi, spine, block) with a percent; previous is returned', async () => {
  const before = effectiveBookProgress(uid, epubId);
  await excerpt('?words=10'); // serve from the current place (0,2)
  const r = await postJson(`/api/feed/progress/book/${epubId}`, { spineIndex: 1, blockIndex: 2 }); // the quoted paragraph in chapter 2
  assert.strictEqual(r.status, 200, r.status === 200 ? '' : await r.text());
  const body = await r.json();
  assert.strictEqual(body.ok, true);
  assert.deepStrictEqual(body.previous, before.locator, 'the place it moved FROM rides back for recovery');
  // a BLOCK position: the reader resolves spine 1 / block 2 (the quoted paragraph) in epub.js's live DOM
  assert.deepStrictEqual(body.locator, { kind: 'epub', cfi: '', spineIndex: 1, blockIndex: 2 });
  assert.ok(body.percent > 0 && body.percent < 98, `percent ${body.percent} keeps the book in the reading band`);
  await flushPendingBookProgress();
  const stored = userStore.getOneBookProgress(uid, epubId);
  assert.deepStrictEqual(stored.locator, body.locator, 'the coalescer flushed the feed\'s locator');
  assert.strictEqual(stored.updatedAt, body.updatedAt);
  // the chain continues: a second forward write from the SAME serve is accepted (the feed's own stamp is current)
  const r2 = await postJson(`/api/feed/progress/book/${epubId}`, { spineIndex: 2, blockIndex: 1 });
  assert.strictEqual(r2.status, 200);
  assert.deepStrictEqual((await r2.json()).locator, { kind: 'epub', cfi: '', spineIndex: 2, blockIndex: 1 });
  // the detail route the reader opens with now carries the block position
  const detail = await (await fetch(`${base}/api/books/${epubId}`)).json();
  assert.deepStrictEqual(detail.locator, { kind: 'epub', cfi: '', spineIndex: 2, blockIndex: 1 });
  // and the excerpt served from a feed-written place starts exactly there
  const again = await excerpt('?words=3');
  assert.deepStrictEqual(again.stored.position, { spineIndex: 2, blockIndex: 1 });
  assert.deepStrictEqual(again.start, { spineIndex: 2, blockIndex: 1 });
});

test('D5 book: an old CFI-only place (no spine/block saved) resolves through the CFI; a place with an unknown chapter is unresolved and never overwritten', async () => {
  // the reader before blockIndex existed: cfi only, pointing into chapter 1's second paragraph's text
  await readerPing({ kind: 'epub', cfi: 'epubcfi(/6/2!/4/4/1:5)' }, 15);
  const e = await excerpt('?words=3');
  assert.deepStrictEqual(e.stored.position, { spineIndex: 0, blockIndex: 1 }, 'the browser\'s body is /4 (its parser inserts a head the fixture lacks)');
  assert.deepStrictEqual(e.start, { spineIndex: 0, blockIndex: 1 });
  let r = await postJson(`/api/feed/progress/book/${epubId}`, { spineIndex: 0, blockIndex: 0 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await r.json()).reason, 'backward');
  // a CFI into a chapter that does not exist: the excerpt refuses to guess (409 unresolved), and so does the write
  await readerPing({ kind: 'epub', cfi: 'epubcfi(/6/40!/4/4)' }, 15);
  r = await fetch(`${base}/api/books/${epubId}/excerpt`);
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await r.json()).reason, 'unresolved');
  feedServed.mark(uid, 'book', epubId, effectiveBookProgress(uid, epubId).updatedAt); // even a served card cannot move it
  r = await postJson(`/api/feed/progress/book/${epubId}`, { spineIndex: 2, blockIndex: 1 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await r.json()).reason, 'unresolved');
  assert.strictEqual(effectiveBookProgress(uid, epubId).locator.cfi, 'epubcfi(/6/40!/4/4)');
});

test('D5 book: a hidden book is a neutral 404, a PDF 400, another user\'s serve does not open the door', async () => {
  const hidden = await postJson(`/api/feed/progress/book/${epubId}`, { spineIndex: 2, blockIndex: 1 }, { headers: { Cookie: member.cookie } });
  assert.strictEqual(hidden.status, 404);
  assert.deepStrictEqual(await hidden.json(), { error: 'Book not found' });
  assert.strictEqual((await postJson(`/api/feed/progress/book/${pdfId}`, { spineIndex: 0, blockIndex: 0 })).status, 400);
  assert.strictEqual((await postJson('/api/feed/progress/book/nope', { spineIndex: 0, blockIndex: 0 })).status, 404);
  // serve to the admin, write as the member (who can see nothing anyway) -> 404; serve registry is per user
  await readerPing({ kind: 'epub', cfi: 'epubcfi(/6/2!/4/2)', spineIndex: 0, blockIndex: 0 }, 1);
  await excerpt('?words=3');
  assert.strictEqual(feedServed.status(member.user.id, 'book', epubId, ''), 'unknown');
});

// ---- the podcast write (D5) ------------------------------------------------------------

test('D5 podcast: not served -> 409; served -> forward only; the played latch and Watch later leave ride the shared effects', async () => {
  feedServed.forget(uid, 'podcast', epId);
  let r = await postJson('/api/feed/progress/podcast', { id: epId, timestamp: 30, duration: 1800 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await r.json()).reason, 'not-served');
  assert.strictEqual(userStore.getOnePodcastProgress(uid, epId), null);

  feedServed.mark(uid, 'podcast', epId, ''); // the feed API serves a new episode: no stored row
  r = await postJson('/api/feed/progress/podcast', { id: epId, timestamp: 30, duration: 1800 });
  assert.strictEqual(r.status, 200, r.status === 200 ? '' : await r.text());
  let body = await r.json();
  assert.strictEqual(body.previous, null);
  assert.strictEqual(body.position, 30);
  const row1 = userStore.getOnePodcastProgress(uid, epId);
  assert.strictEqual(row1.position, 30);
  assert.strictEqual(row1.duration, 1800);
  // the chain: a later ping advances; an equal or earlier ping is refused and leaves the row alone
  r = await postJson('/api/feed/progress/podcast', { id: epId, timestamp: 34, duration: 1800 });
  assert.strictEqual(r.status, 200);
  r = await postJson('/api/feed/progress/podcast', { id: epId, timestamp: 34, duration: 1800 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await r.json()).reason, 'backward');
  r = await postJson('/api/feed/progress/podcast', { id: epId, timestamp: 10, duration: 1800 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(userStore.getOnePodcastProgress(uid, epId).position, 34);
  // another device listened on through the podcasts route: the feed's next ping is stale
  r = await postJson('/api/podcasts/progress', { episodeId: epId, position: 900, duration: 1800 });
  assert.strictEqual(r.status, 200);
  r = await postJson('/api/feed/progress/podcast', { id: epId, timestamp: 40, duration: 1800 });
  assert.strictEqual(r.status, 409);
  body = await r.json();
  assert.strictEqual(body.reason, 'stale');
  assert.strictEqual(body.stored.position, 900);
  assert.strictEqual(userStore.getOnePodcastProgress(uid, epId).position, 900);
  // re-served from the moved row: a forward ping past 95% latches played and leaves Watch later (the shared effects)
  userStore.addWatchLater(uid, userStore.watchLaterKey('podcast', epId), new Date().toISOString());
  feedServed.mark(uid, 'podcast', epId, userStore.getOnePodcastProgress(uid, epId).updatedAt);
  r = await postJson('/api/feed/progress/podcast', { id: epId, timestamp: 1720, duration: 1800 });
  assert.strictEqual(r.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(userStore.getPodcastPlayed(uid), epId), 'played latched at the same crossing');
  assert.ok(!userStore.getWatchLater(uid).includes(userStore.watchLaterKey('podcast', epId)), 'finishing left Watch later');
});

test('D5 podcast: a hidden episode is a neutral 404, an unknown episode 400, a malformed body 400; nothing is stored', async () => {
  const hidden = await postJson('/api/feed/progress/podcast', { id: epId, timestamp: 50, duration: 1800 }, { headers: { Cookie: member.cookie } });
  assert.strictEqual(hidden.status, 404);
  assert.strictEqual((await postJson('/api/feed/progress/podcast', { id: 'nope', timestamp: 50 })).status, 400);
  assert.strictEqual((await postJson('/api/feed/progress/podcast', { timestamp: 50 })).status, 400);
  assert.strictEqual((await postJson('/api/feed/progress/podcast', { id: epId, timestamp: -1 })).status, 400);
  assert.strictEqual((await postJson('/api/feed/progress/podcast', { id: epId, timestamp: 'x' })).status, 400);
  assert.strictEqual(userStore.getOnePodcastProgress(member.user.id, epId), null);
});

// ---- the media write (D5) --------------------------------------------------------------

test('D5 media: not served -> 409; served -> forward only; stale after /api/progress moved it; the watched latch rides the shared effects', async () => {
  feedServed.forget(uid, 'media', 'vid');
  let r = await postJson('/api/feed/progress/media', { id: 'vid', timestamp: 30, duration: 600 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await r.json()).reason, 'not-served');
  assert.strictEqual(effectiveProgress(uid, 'vid'), undefined, 'no row and nothing staged');

  feedServed.mark(uid, 'media', 'vid', '');
  r = await postJson('/api/feed/progress/media', { id: 'vid', timestamp: 30, duration: 600 });
  assert.strictEqual(r.status, 200, r.status === 200 ? '' : await r.text());
  assert.strictEqual((await r.json()).timestamp, 30);
  assert.strictEqual(effectiveProgress(uid, 'vid').timestamp, 30, 'staged in the media coalescer (read-your-writes)');
  r = await postJson('/api/feed/progress/media', { id: 'vid', timestamp: 34, duration: 600 });
  assert.strictEqual(r.status, 200);
  r = await postJson('/api/feed/progress/media', { id: 'vid', timestamp: 34, duration: 600 });
  assert.strictEqual(r.status, 409);
  r = await postJson('/api/feed/progress/media', { id: 'vid', timestamp: 5, duration: 600 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await r.json()).reason, 'backward');
  assert.strictEqual(effectiveProgress(uid, 'vid').timestamp, 34);
  await flushPendingProgress();
  assert.strictEqual(userStore.getOneProgress(uid, 'vid').timestamp, 34, 'flushed to user_progress');
  // the watch page pinged (another surface / device): the feed's chain is stale
  r = await postJson('/api/progress', { id: 'vid', timestamp: 300, duration: 600 });
  assert.strictEqual(r.status, 200);
  r = await postJson('/api/feed/progress/media', { id: 'vid', timestamp: 40, duration: 600 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await r.json()).reason, 'stale');
  assert.strictEqual(effectiveProgress(uid, 'vid').timestamp, 300);
  // re-served; a ping past 90% latches watched and leaves Watch later
  userStore.addWatchLater(uid, 'vid', new Date().toISOString());
  feedServed.mark(uid, 'media', 'vid', effectiveProgress(uid, 'vid').updatedAt);
  r = await postJson('/api/feed/progress/media', { id: 'vid', timestamp: 560, duration: 600 });
  assert.strictEqual(r.status, 200);
  assert.ok(userStore.getWatchedIds(uid).includes('vid'), 'watched latched');
  assert.ok(!userStore.getWatchLater(uid).includes('vid'), 'finishing left Watch later');
});

test('D5 media: a hidden item and an unknown id are neutral 404s, a malformed body 400; a restricted member never mints a row', async () => {
  const hidden = await postJson('/api/feed/progress/media', { id: 'vid', timestamp: 50, duration: 600 }, { headers: { Cookie: member.cookie } });
  assert.strictEqual(hidden.status, 404);
  assert.deepStrictEqual(await hidden.json(), { error: 'Media not found' });
  assert.strictEqual((await postJson('/api/feed/progress/media', { id: 'nope', timestamp: 50 })).status, 404);
  assert.strictEqual((await postJson('/api/feed/progress/media', { id: '__proto__', timestamp: 50 })).status, 404);
  assert.strictEqual((await postJson('/api/feed/progress/media', { timestamp: 50 })).status, 400);
  assert.strictEqual((await postJson('/api/feed/progress/media', { id: 'vid', timestamp: 'x' })).status, 400);
  assert.strictEqual(effectiveProgress(member.user.id, 'vid'), undefined);
});
