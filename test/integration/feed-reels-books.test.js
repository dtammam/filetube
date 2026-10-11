'use strict';

// [INTEGRATION] v1.383.0 Feed reels and speed, W1 (plan docs/exec-plans/completed/2026-10-10-feed-reels.md K3, K7), through the real
// server on three EPUBs shaped like real books (test/helpers/real-epubs.js: a Standard Ebooks EPUB 3, a Calibre split EPUB 2, a
// publisher EPUB 2 with a short prologue):
//   K3 b  measured cause of "books are not starting in chapter 1": the first-real-chapter rule picks the right spine item in
//         all three, but every label was the SPINE position ("Chapter 6 of 10" over the Standard Ebooks book's chapter I). The
//         label is now what the book's own table of contents calls the chapter - on the new-book card, a reading card, the
//         excerpt route, the chapter-start divider, and From the beginning (which lands on the same first real chapter).
//   K3 a  Start over on a book card answers with the pages the reset left (the first real chapter, labelled), so the card shows
//         them at once; Undo still puts the stored place back exactly.
//   K7    the stored-place read the confirm names (GET /api/feed/start-over/place), a recorded book place bounded by the
//         reader's own cfi limit, and the two survivors the v1.381.0 gate left (the flag shape check, a latch-only item with a
//         NULL time is something to forget).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedreels-'));
process.env.PROGRESS_FLUSH_MS = '60000';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, scanBooks, booksDb, userStore, __mintTestSession } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const realEpubs = require('../helpers/real-epubs');

let server, base, uid, member, booksDir;
const books = {}; // name -> { id, expect }
const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-02T11:11:11.000Z';

before(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedreels-lib-'));
  const made = {};
  for (const name of ['standardEbook', 'calibreSplit', 'prologueBook']) {
    made[name] = realEpubs[name]();
    fs.writeFileSync(path.join(booksDir, name + '.epub'), made[name].buffer);
  }
  await updateDatabase(() => booksDb.mutate((db) => { require('../../lib/books/store').ensureBooks(db).folders = [booksDir]; return true; }));
  await scanBooks();
  for (const it of Object.values(booksDb.read().items)) {
    const name = Object.keys(made).find((n) => made[n].title === it.title);
    if (name) books[name] = { id: it.id, expect: made[name].expect, spine: it.spine };
  }
  assert.strictEqual(Object.keys(books).length, 3, 'all three books scanned');
  const D = process.env.DATA_DIR;
  fs.mkdirSync(path.join(D, 'Open'), { recursive: true });
  const vid = (id, extra) => Object.assign({ id, title: id, filePath: path.join(D, 'Open', id + '.mp4'), folderName: 'Open', rootFolder: D, type: 'video', ext: '.mp4', duration: 600, size: 1, addedAt: 1 }, extra || {});
  const metadata = { v1: vid('v1'), vt: vid('vt', { ext: '.avi', needsTranscode: true }) };
  for (const it of Object.values(metadata)) fs.writeFileSync(it.filePath, 'V');
  seedState({ folders: [D], folderSettings: {}, metadata, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  uid = authenticateFetch(server, base).user.id;
  member = __mintTestSession({ username: 'reels-member', role: 'member' });
  userStore.setRestrictions(member.user.id, [{ kind: 'library', value: 'books' }]);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(booksDir, { recursive: true, force: true });
});

const post = (p, body, cookie) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const get = (p, cookie) => fetch(`${base}${p}`, cookie ? { headers: { Cookie: cookie } } : undefined);
async function session(cookie) { const r = await post('/api/feed/sessions', { plannedMin: 10 }, cookie); assert.strictEqual(r.status, 200); return (await r.json()).session.id; }
const place = (spineIndex, blockIndex, extra) => ({ locator: Object.assign({ kind: 'epub', cfi: '', spineIndex, blockIndex }, extra || {}), percent: 40, updatedAt: T1 });
const resetAll = () => { for (const b of Object.values(books)) userStore.resetBookPlace(uid, b.id); userStore.removeHistory(uid, 'v1'); };
const labelOfExpect = (e) => (/^(?:\d+|[ivxlcdm]+)$/i.test(e.label) ? 'Chapter ' + e.label : e.label);

// ---- K3 b ------------------------------------------------------------------------------------------------------------------

test('K3 b: the excerpt at each book\'s first real chapter is labelled as the BOOK names it (it said "Chapter <spine position> of <n>")', async () => {
  resetAll();
  for (const [name, b] of Object.entries(books)) {
    const r = await get(`/api/books/${encodeURIComponent(b.id)}/excerpt?spine=${b.expect.spineIndex}&block=0&continuation=1`);
    assert.strictEqual(r.status, 200, name);
    const e = await r.json();
    assert.strictEqual(e.chapterLabel, labelOfExpect(b.expect), name);
    assert.ok(!/ of \d+$/.test(e.chapterLabel), name + ': no spine count');
    const startBlock = e.blocks.find((x) => x.chapterStart);
    assert.ok(startBlock, name + ': the chapter-start block is in the excerpt');
    assert.strictEqual(startBlock.chapterLabel, labelOfExpect(b.expect), name + ': the divider carries the same name');
  }
  // a chapter split over two files (the Calibre shape): the second file is still Chapter One
  const cs = books.calibreSplit;
  const cont = await (await get(`/api/books/${encodeURIComponent(cs.id)}/excerpt?spine=${cs.expect.continued.spineIndex}&block=0&continuation=1`)).json();
  assert.strictEqual(cont.chapterLabel, cs.expect.continued.label);
  // a front-matter item the table of contents names is called that (the publisher book's cover page has no text, so the excerpt
  // starts on its copyright page)
  const front = await (await get(`/api/books/${encodeURIComponent(books.prologueBook.id)}/excerpt?spine=0&block=0&continuation=1&words=5`)).json();
  assert.strictEqual(front.chapterLabel, 'Copyright');
  // an item BEFORE the table of contents starts (the Standard Ebooks cover; its toc begins at the titlepage) has no name
  const se = await (await get(`/api/books/${encodeURIComponent(books.standardEbook.id)}/excerpt?spine=1&block=0&continuation=1&words=5`)).json();
  assert.strictEqual(se.chapterLabel, 'Titlepage');
  const labelOf = require('../../lib/books/excerpt').chapterLabeler(require('../../lib/books/excerpt').openEpubBook(fs, booksDb.read().items[books.standardEbook.id]), books.standardEbook.spine);
  assert.deepStrictEqual([0, 1, 5, 6, 9].map(labelOf), ['', 'Titlepage', 'Chapter I', 'Chapter II', 'Colophon']);
});

test('K3 b: the unstarted book\'s "Start something new" card starts at its first real chapter and calls it what the book does; nothing written', async () => {
  resetAll();
  const sid = await session();
  const seen = [];
  for (let i = 0; i < 4 && !seen.length; i++) {
    const body = await (await get(`/api/feed?session=${sid}&count=10`)).json();
    for (const c of body.cards) if (c.kind === 'book' && c.newBook) seen.push(c);
  }
  assert.strictEqual(seen.length, 1, 'one new-book card a session');
  const card = seen[0];
  const b = Object.values(books).find((x) => x.id === card.id);
  assert.strictEqual(card.start.spineIndex, b.expect.spineIndex, 'the first real chapter');
  assert.strictEqual(card.chapterLabel, labelOfExpect(b.expect));
  assert.strictEqual(card.blocks[0].chapterLabel, labelOfExpect(b.expect));
  for (const x of Object.values(books)) assert.strictEqual(userStore.getOneBookProgress(uid, x.id), null, 'serving wrote nothing');
});

test('K3 b: a reading card and "From the beginning" both name the chapter as the book does, and From the beginning lands on the first real chapter', async () => {
  resetAll();
  const se = books.standardEbook;
  userStore.setBookProgress(uid, se.id, place(7, 2)); // chapter III
  for (const [fsParam, spine, label] of [['', 7, 'Chapter III'], ['&fs=' + encodeURIComponent(JSON.stringify({ where: { book: 'start' } })), 5, 'Chapter I']]) {
    const sid = await session();
    let card = null;
    for (let i = 0; i < 4 && !card; i++) {
      const body = await (await get(`/api/feed?session=${sid}&count=10${fsParam}`)).json();
      card = body.cards.find((c) => c.kind === 'book' && c.id === se.id) || null;
    }
    assert.ok(card, 'the reading book is served ' + fsParam);
    assert.strictEqual(card.start.spineIndex, spine, fsParam);
    assert.strictEqual(card.chapterLabel, label, fsParam);
  }
  resetAll();
});

// ---- K3 a ------------------------------------------------------------------------------------------------------------------

test('K3 a: Start over on a book at chapter III answers with the reset pages - the first real chapter (spine 6, "Chapter I"), never the old place; Undo restores the place exactly', async () => {
  resetAll();
  const se = books.standardEbook;
  userStore.setBookProgress(uid, se.id, place(7, 2));
  const before = userStore.getOneBookProgress(uid, se.id);
  const sid = await session();
  const r = await post('/api/feed/start-over', { session: sid, kind: 'book', id: se.id });
  assert.strictEqual(r.status, 200);
  const body = await r.json();
  assert.ok(body.reset, 'the reset pages ride the answer');
  assert.deepStrictEqual(body.reset.start, { spineIndex: 5, blockIndex: 0 });
  assert.strictEqual(body.reset.chapterLabel, 'Chapter I');
  assert.strictEqual(body.reset.blocks[0].spineIndex, 5, 'the card\'s first block is the first real chapter\'s');
  assert.strictEqual(body.reset.blocks[0].text, 'I');
  assert.ok(body.reset.blocks.every((x) => x.spineIndex >= 5 && !/</.test(x.text)), 'text only, from the first real chapter on');
  assert.strictEqual(userStore.getOneBookProgress(uid, se.id), null, 'the reset itself happened');
  assert.strictEqual((await post('/api/feed/start-over/undo', { session: sid, token: body.token })).status, 200);
  assert.deepStrictEqual(userStore.getOneBookProgress(uid, se.id), before, 'Undo: exactly the old place');
  // a media Start over carries no reset pages
  userStore.setProgress(uid, 'v1', { timestamp: 300, duration: 600, updatedAt: T1 });
  const m = await (await post('/api/feed/start-over', { session: sid, kind: 'media', id: 'v1' })).json();
  assert.ok(m.token && m.reset === undefined);
  resetAll();
});

// ---- K7 c: the stored place the confirm names ------------------------------------------------------------------------------

test('K7 c: GET /api/feed/start-over/place reads the STORED place (another device\'s newer place, not the card\'s), says when there is nothing, writes nothing', async () => {
  resetAll();
  const se = books.standardEbook;
  const q = (kind, id, cookie) => get(`/api/feed/start-over/place?kind=${kind}&id=${encodeURIComponent(id)}`, cookie);
  let r = await q('book', se.id);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { ok: true, kind: 'book', id: se.id, nothing: true, chapterLabel: '', finished: false });
  userStore.setBookProgress(uid, se.id, place(8, 0)); // chapter IV
  r = await (await q('book', se.id)).json();
  assert.strictEqual(r.nothing, false);
  assert.strictEqual(r.chapterLabel, 'Chapter IV');
  userStore.setProgress(uid, 'v1', { timestamp: 432, duration: 600, updatedAt: T2 });
  r = await (await q('media', 'v1')).json();
  assert.deepStrictEqual([r.nothing, r.sec], [false, 432]);
  assert.strictEqual(userStore.getOneProgress(uid, 'v1').timestamp, 432, 'read-only');
  // access and input: a book hidden from the member is the same neutral 404 as a missing one; bad input is 400
  const hidden = await q('book', se.id, member.cookie);
  const missing = await q('book', 'nope', member.cookie);
  assert.deepStrictEqual([hidden.status, missing.status], [404, 404]);
  assert.deepStrictEqual(await hidden.json(), await missing.json());
  for (const bad of ['kind=song&id=x', 'kind=media&id=', 'kind=media&id=' + encodeURIComponent('a\u0000b'), 'kind=media&id=' + 'x'.repeat(300)]) {
    assert.strictEqual((await get('/api/feed/start-over/place?' + bad)).status, 400, bad);
  }
  resetAll();
});

// ---- K7 a: the reader's own bound ------------------------------------------------------------------------------------------

test('K7 a: a reader place whose cfi is long multi-byte text (within the reader\'s 2000 characters, over the old 4096 bytes) can start over and comes back exactly; past the reader\'s limit it is refused and kept', async () => {
  resetAll();
  const se = books.standardEbook;
  const longCfi = 'epubcfi(/6/14!/4/2/1:0)' + '€'.repeat(1500); // 1523 characters, ~4.5 KB of UTF-8
  assert.ok(Buffer.byteLength(JSON.stringify(place(7, 2, { cfi: longCfi })), 'utf8') > 4096, 'over the old flat bound');
  userStore.setBookProgress(uid, se.id, place(7, 2, { cfi: longCfi }));
  const before = userStore.getOneBookProgress(uid, se.id);
  const sid = await session();
  const r = await post('/api/feed/start-over', { session: sid, kind: 'book', id: se.id });
  assert.strictEqual(r.status, 200, 'accepted: the reader stored it, so Start over can put it back');
  assert.strictEqual((await post('/api/feed/start-over/undo', { session: sid, token: (await r.json()).token })).status, 200);
  assert.deepStrictEqual(userStore.getOneBookProgress(uid, se.id), before, 'exactly');
  // past the reader's own limit (no reader writes that): refused and kept
  const tooLong = place(7, 2, { cfi: 'e'.repeat(2001) });
  userStore.setBookProgress(uid, se.id, tooLong);
  const r2 = await post('/api/feed/start-over', { session: sid, kind: 'book', id: se.id });
  assert.strictEqual(r2.status, 409);
  assert.strictEqual((await r2.json()).reason, 'unrestorable');
  assert.deepStrictEqual(userStore.getOneBookProgress(uid, se.id), tooLong, 'kept');
  // the rest of the place keeps the small bound: a padded locator is still refused (and kept)
  const padded = place(7, 2, { pad: 'x'.repeat(5000) });
  userStore.setBookProgress(uid, se.id, padded);
  const r3 = await post('/api/feed/start-over', { session: sid, kind: 'book', id: se.id });
  assert.strictEqual((await r3.json()).reason, 'unrestorable');
  assert.deepStrictEqual(userStore.getOneBookProgress(uid, se.id), padded);
  // exactly at the reader's limit: accepted
  userStore.setBookProgress(uid, se.id, place(7, 2, { cfi: 'e'.repeat(2000) }));
  const r4 = await post('/api/feed/start-over', { session: sid, kind: 'book', id: se.id });
  assert.strictEqual(r4.status, 200, 'the reader\'s 2000 characters exactly');
  resetAll();
});

// ---- K7 b: the two survivors the v1.381.0 gate left ------------------------------------------------------------------------

test('K7 b (R9 / U11): a recorded latch flag that is not a boolean is refused by Undo (invalid-record), nothing written - each kind', async () => {
  resetAll();
  const sid = await session();
  const se = books.standardEbook;
  for (const [kind, id, from] of [
    ['media', 'v1', { progress: null, watched: 'yes', watchedAt: T2 }],
    ['podcast', 'ep-x', { progress: null, played: 1, playedAt: T2 }],
    ['book', se.id, { progress: null, finished: 'true', finishedAt: T2 }],
  ]) {
    const token = require('node:crypto').randomBytes(12).toString('hex');
    const moves = (userStore.getFeedSession(uid, sid).summary || {}).moves || [];
    userStore.setFeedSessionMoves(uid, sid, moves.concat([{ kind, id, startOver: true, token, from, to: null, at: T1 }]));
    const u = await post('/api/feed/start-over/undo', { session: sid, token });
    if (kind === 'podcast') { assert.strictEqual(u.status, 404, 'no such episode here: visibility answers first'); continue; }
    assert.strictEqual(u.status, 409, kind);
    assert.strictEqual((await u.json()).reason, 'invalid-record', kind);
  }
  assert.ok(!Object.prototype.hasOwnProperty.call(userStore.getWatchedTimes(uid), 'v1'), 'no latch written');
  assert.ok(!Object.prototype.hasOwnProperty.call(userStore.getBookFinished(uid), se.id), 'no latch written');
});

test('K7 b (U4): an item with ONLY a latch whose time is NULL (no place) is something to forget - recorded, forgotten, put back (media, book)', async () => {
  resetAll();
  const has = (m, k) => Object.prototype.hasOwnProperty.call(m, k);
  const se = books.standardEbook;
  userStore.markWatched(uid, 'v1', null);
  userStore.setBookFinished(uid, se.id, null);
  const sid = await session();
  const v = await post('/api/feed/start-over', { session: sid, kind: 'media', id: 'v1' });
  const b = await post('/api/feed/start-over', { session: sid, kind: 'book', id: se.id });
  assert.deepStrictEqual([v.status, b.status], [200, 200], 'not "nothing": the latch is its row, whatever its time');
  assert.ok(!has(userStore.getWatchedTimes(uid), 'v1') && !has(userStore.getBookFinished(uid), se.id), 'forgotten');
  assert.strictEqual((await post('/api/feed/start-over/undo', { session: sid, token: (await v.json()).token })).status, 200);
  assert.strictEqual((await post('/api/feed/start-over/undo', { session: sid, token: (await b.json()).token })).status, 200);
  assert.ok(has(userStore.getWatchedTimes(uid), 'v1') && userStore.getWatchedTimes(uid).v1 === null, 'the watched latch back, NULL time');
  assert.ok(has(userStore.getBookFinished(uid), se.id) && userStore.getBookFinished(uid)[se.id] === null, 'the finished latch back, NULL time');
  resetAll();
});

// ---- W2 K2 a: a card for a file that needs a transcode says so (the client never warms it) ----------------------------------

test('K2 a: a video card whose file needs a transcode carries transcode: true; a playable one carries no such key', async () => {
  resetAll();
  userStore.setProgress(uid, 'v1', { timestamp: 300, duration: 600, updatedAt: T1 });
  userStore.setProgress(uid, 'vt', { timestamp: 300, duration: 600, updatedAt: T2 });
  const sid = await session();
  const seen = {};
  for (let i = 0; i < 4 && Object.keys(seen).length < 2; i++) {
    const body = await (await get(`/api/feed?session=${sid}&count=10`)).json();
    for (const c of body.cards) if (c.kind === 'video') seen[c.id] = c;
  }
  assert.ok(seen.v1 && seen.vt, 'both served: ' + Object.keys(seen));
  assert.strictEqual(seen.vt.transcode, true);
  assert.ok(!('transcode' in seen.v1));
  userStore.removeHistory(uid, 'vt');
  resetAll();
});
