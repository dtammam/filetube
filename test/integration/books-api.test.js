'use strict';

// [INTEGRATION] v1.37.0 T5+T6: the books read APIs (list/detail/file/cover)
// and the books-owned progress coalescer, against the real app + real
// fixture EPUBs. Locks the /api/videos-parity list contract, 206 ranges on
// the file route, placeholder-SVG escaping, the no-clobber cover backfill,
// N-pings-one-write coalescing, read-your-writes, the deleted-book flush
// guard, and locator validation per format.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-booksapi-'));
process.env.PROGRESS_FLUSH_MS = '50'; // shrink the real debounce window for tests

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, loadDatabase, updateDatabase, getMediaId, scanBooks,
  flushPendingBookProgress, effectiveBookProgress,
  __getBookProgressFlushWriteCount, __mintTestSession, userStore,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');
const { buildEpub } = require('../helpers/build-zip');

let server;
let base;
let uid; // the authenticated test admin's user id (v1.43: progress/pins are per-user)
let booksDir;
let epubId;
let pdfId;

before(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-booksapi-lib-'));
  fs.writeFileSync(path.join(booksDir, 'alpha.epub'), buildEpub({
    title: 'Alpha & <Omega>', author: 'Zeta Writer', chapters: ['<p>a</p>', '<p>b</p>'],
    coverData: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]),
  }));
  fs.writeFileSync(path.join(booksDir, 'manual.pdf'), '%PDF-1.4 0123456789'.repeat(100));
  await updateDatabase((db) => {
    require('../../lib/books/store').ensureBooks(db).folders = [booksDir];
    return true;
  });
  await scanBooks();
  const items = loadDatabase().books.items;
  epubId = Object.values(items).find((i) => i.format === 'epub').id;
  pdfId = Object.values(items).find((i) => i.format === 'pdf').id;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  const auth = authenticateFetch(server, base); // v1.43: auth through the real gate
  uid = auth.user.id;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(booksDir, { recursive: true, force: true });
});

function postJson(urlPath, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('T5: GET /api/books -- the paginated {items,total,offset,limit} contract, search, sort, light list shape (no spine)', async () => {
  const all = await (await fetch(`${base}/api/books`)).json();
  assert.equal(all.total, 2);
  assert.ok(Array.isArray(all.items) && all.items.length === 2);
  assert.ok(!('spine' in all.items[0]), 'the list stays light -- spine is detail-only');
  assert.ok(!('filePath' in all.items[0]), 'no absolute paths in the list payload');

  const searched = await (await fetch(`${base}/api/books?search=zeta`)).json();
  assert.equal(searched.total, 1, 'author search hits');
  assert.equal(searched.items[0].id, epubId);

  const sorted = await (await fetch(`${base}/api/books?sort=title-asc`)).json();
  assert.deepEqual(sorted.items.map((i) => i.id), [epubId, pdfId].sort((a, b) => a === epubId ? -1 : 1), 'Alpha... before Manual');

  const paged = await (await fetch(`${base}/api/books?limit=1&offset=1&sort=title-asc`)).json();
  assert.equal(paged.items.length, 1);
  assert.equal(paged.total, 2);
});

test('T5: GET /api/books/:id carries spine + locator; unknown id 404s', async () => {
  const detail = await (await fetch(`${base}/api/books/${epubId}`)).json();
  assert.equal(detail.spine.length, 2);
  assert.equal(detail.locator, null, 'no progress yet');
  assert.equal((await fetch(`${base}/api/books/nope`)).status, 404);
});

test('T5: GET /book/:id/file serves with the right content-type and honors RANGE requests (206) for pdf.js', async () => {
  const whole = await fetch(`${base}/book/${pdfId}/file`);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'application/pdf');
  const ranged = await fetch(`${base}/book/${pdfId}/file`, { headers: { Range: 'bytes=0-9' } });
  assert.equal(ranged.status, 206, 'pdf.js range loading needs native 206');
  assert.equal((await ranged.arrayBuffer()).byteLength, 10);
  const epubRes = await fetch(`${base}/book/${epubId}/file`);
  assert.equal(epubRes.headers.get('content-type'), 'application/epub+zip');
});

test('T5: GET /bookcover/:id -- real cover for the epub; ESCAPED SVG placeholder for the coverless pdf', async () => {
  const real = await fetch(`${base}/bookcover/${epubId}`);
  assert.equal(real.headers.get('content-type'), 'image/jpeg');
  const placeholder = await fetch(`${base}/bookcover/${pdfId}`);
  assert.ok(placeholder.headers.get('content-type').includes('image/svg'));
  const svg = await placeholder.text();
  assert.ok(svg.includes('PDF'), 'format badge present');
  // Escaping: give the pdf a hostile title and re-fetch.
  await updateDatabase((db) => {
    db.books.items[pdfId] = { ...db.books.items[pdfId], title: '<script>alert(1)</script>' };
    return true;
  });
  const hostile = await (await fetch(`${base}/bookcover/${pdfId}`)).text();
  assert.ok(!hostile.includes('<script>'), 'a hostile title never becomes markup in the placeholder');
  assert.ok(hostile.includes('&lt;script&gt;'), 'it renders as text');
});

test('T5: POST /api/books/:id/cover -- magic-sniffed, no-clobber, pageCount rides along; junk rejected', async () => {
  const junk = await fetch(`${base}/api/books/${pdfId}/cover?pages=42`, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.from('not a jpeg'),
  });
  assert.equal(junk.status, 400, 'magic bytes must sniff');
  const realJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 5, 5, 5, 5]);
  const ok = await fetch(`${base}/api/books/${pdfId}/cover?pages=42`, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: realJpeg,
  });
  assert.deepEqual(await ok.json(), { applied: true });
  const item = loadDatabase().books.items[pdfId];
  assert.equal(item.hasCover, true);
  assert.equal(item.pageCount, 42);
  // No-clobber: a second post reports applied:false and changes nothing.
  const again = await fetch(`${base}/api/books/${pdfId}/cover?pages=99`, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: realJpeg,
  });
  assert.equal((await again.json()).applied, false);
  assert.equal(loadDatabase().books.items[pdfId].pageCount, 42, 'pageCount never re-written');
});

test('T6: progress pings coalesce (N pings -> ONE write), read-your-writes before flush, locator validation per format', async () => {
  for (let i = 1; i <= 5; i++) {
    const res = await postJson(`/api/books/${epubId}/progress`, {
      locator: { kind: 'epub', cfi: `epubcfi(/6/${i}!/4/2)`, spineIndex: 0, blockIndex: i },
      percent: i * 10,
    });
    assert.equal(res.status, 200);
  }
  // Read-your-writes BEFORE any flush: the detail route sees the last ping.
  const detail = await (await fetch(`${base}/api/books/${epubId}`)).json();
  assert.equal(detail.progress.percent, 50);
  assert.equal(detail.locator.blockIndex, 5, 'the wave-2 listen-from-here key round-trips');
  assert.equal(effectiveBookProgress(uid, epubId).percent, 50);

  const flushesBefore = __getBookProgressFlushWriteCount();
  await flushPendingBookProgress();
  assert.equal(__getBookProgressFlushWriteCount() - flushesBefore, 1, '5 pings -> ONE batch transaction');
  // v1.43: the position lives in the USER's user_book_progress row; the
  // doc-table books.progress namespace is the frozen pre-auth record and
  // must never gain a row from a flush.
  const persisted = userStore.getOneBookProgress(uid, epubId);
  assert.equal(persisted.percent, 50, 'exactly the LAST ping persisted');
  const frozen = readPersistedDatabase(process.env.DATA_DIR).books;
  assert.ok(!(frozen && frozen.progress && frozen.progress[epubId]),
    'the frozen doc-table record is never written by a per-user flush');

  // Wrong-kind and malformed locators 400.
  assert.equal((await postJson(`/api/books/${epubId}/progress`, { locator: { kind: 'pdf', page: 3 }, percent: 10 })).status, 400);
  assert.equal((await postJson(`/api/books/${pdfId}/progress`, { locator: { kind: 'pdf', page: 0 }, percent: 10 })).status, 400);
  assert.equal((await postJson(`/api/books/${pdfId}/progress`, { locator: { kind: 'pdf', page: 3 }, percent: 101 })).status, 400);
  assert.equal((await postJson(`/api/books/${pdfId}/progress`, { locator: { kind: 'pdf', page: 3 }, percent: 30 })).status, 200);
});

test('T6: filter=reading returns only in-progress books, most recent first', async () => {
  await flushPendingBookProgress();
  const reading = await (await fetch(`${base}/api/books?filter=reading`)).json();
  assert.equal(reading.total, 2, 'both books have progress now');
  assert.equal(reading.items[0].id, pdfId, 'most recently updated first');
  // A finished book (>=98%) drops out of the row.
  await postJson(`/api/books/${epubId}/progress`, { locator: { kind: 'epub', cfi: 'epubcfi(/end)' }, percent: 100 });
  await flushPendingBookProgress();
  const after = await (await fetch(`${base}/api/books?filter=reading`)).json();
  assert.equal(after.total, 1);
  assert.equal(after.items[0].id, pdfId);
});

test('T6: a ping for a book deleted between ping and flush is DROPPED at flush (never resurrects)', async () => {
  const doomed = path.join(booksDir, 'doomed.epub');
  fs.writeFileSync(doomed, buildEpub({ title: 'Doomed' }));
  await scanBooks();
  const doomedId = getMediaId(doomed);
  assert.equal((await postJson(`/api/books/${doomedId}/progress`, { locator: { kind: 'epub', cfi: 'x' }, percent: 5 })).status, 200);
  // Delete + prune before the flush lands.
  await updateDatabase((db) => { db.settings.pruneMissing = true; return true; });
  fs.unlinkSync(doomed);
  await scanBooks();
  await flushPendingBookProgress();
  assert.equal(userStore.getOneBookProgress(uid, doomedId), null, 'flush guard dropped the orphaned ping');
  await updateDatabase((db) => { db.settings.pruneMissing = false; return true; });
});

// ---- T8/T10 server half: folders aggregation + shelf pins + /books page -----

test('T8: GET /api/books/folders aggregates shelves with counts and pin state; /books serves the page shell', async () => {
  const agg = await (await fetch(`${base}/api/books/folders`)).json();
  assert.ok(Array.isArray(agg.folders) && agg.folders.length >= 1);
  const shelf = agg.folders[0];
  assert.ok(shelf.name && shelf.dir && shelf.count >= 1);
  assert.equal(shelf.pinned, false);

  const page = await fetch(`${base}/books`);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('data-view="books"'), 'the books shell serves at the clean URL');
});

test('T10: shelf pins CRUD -- confinement 400, add (pre-shaped for the sidebar renderer), reorder, delete', async () => {
  const outside = await postJson('/api/books/pins', { dir: '/etc', label: 'Nope' });
  assert.equal(outside.status, 400, 'a dir outside every book root must never pin');

  const add = await postJson('/api/books/pins', { dir: booksDir, label: 'Library' });
  assert.equal(add.status, 200);
  const record = await add.json();
  assert.equal(record.dir, booksDir);

  const listed = await (await fetch(`${base}/api/books/pins`)).json();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].channelDir, booksDir, 'pre-shaped with the renderer field name');
  assert.ok(listed[0].href.startsWith('/books?root='), 'href routes to the books page, not the video grid');

  const agg = await (await fetch(`${base}/api/books/folders`)).json();
  const pinnedShelf = agg.folders.find((f) => f.dir === booksDir);
  assert.equal(pinnedShelf && pinnedShelf.pinned, true, 'the chips aggregation reflects pin state');
  assert.equal(pinnedShelf.pinId, record.id);

  const reorder = await postJson('/api/books/pins/reorder', { orderedIds: [record.id] });
  assert.equal(reorder.status, 200);
  assert.equal((await postJson('/api/books/pins/reorder', { orderedIds: [42] })).status, 400);

  const del = await fetch(`${base}/api/books/pins/${record.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await fetch(`${base}/api/books/pins/${record.id}`, { method: 'DELETE' })).status, 404);
});

// ---- v1.43 (chunk 4b): per-user isolation ----------------------------------

test('per-user isolation: reading positions and shelf pins never bleed across accounts', async () => {
  const second = __mintTestSession({ username: 'bookuser2' });

  // The admin reads to 60%; the second user reads the SAME book to 20%.
  assert.equal((await postJson(`/api/books/${epubId}/progress`, {
    locator: { kind: 'epub', cfi: 'epubcfi(/admin)' }, percent: 60,
  })).status, 200);
  const r2 = await fetch(`${base}/api/books/${epubId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: second.cookie },
    body: JSON.stringify({ locator: { kind: 'epub', cfi: 'epubcfi(/second)' }, percent: 20 }),
  });
  assert.equal(r2.status, 200);
  await flushPendingBookProgress();

  assert.equal(userStore.getOneBookProgress(uid, epubId).percent, 60);
  assert.equal(userStore.getOneBookProgress(second.user.id, epubId).percent, 20);

  const adminDetail = await (await fetch(`${base}/api/books/${epubId}`)).json();
  assert.equal(adminDetail.locator.cfi, 'epubcfi(/admin)', 'the admin resumes at THEIR position');
  const secondDetail = await (await fetch(`${base}/api/books/${epubId}`, { headers: { Cookie: second.cookie } })).json();
  assert.equal(secondDetail.locator.cfi, 'epubcfi(/second)', 'the second user resumes at THEIRS');

  // Pins: the second user pins a shelf; the admin's pin list stays empty.
  const pin = await fetch(`${base}/api/books/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: second.cookie },
    body: JSON.stringify({ dir: booksDir, label: 'Second Shelf' }),
  });
  assert.equal(pin.status, 200);
  const adminPins = await (await fetch(`${base}/api/books/pins`)).json();
  assert.deepEqual(adminPins, [], 'another user\'s shelf pin never appears in the admin\'s sidebar');
  const secondPins = await (await fetch(`${base}/api/books/pins`, { headers: { Cookie: second.cookie } })).json();
  assert.equal(secondPins.length, 1);
  assert.equal(secondPins[0].channelDir, booksDir);
  // The folders aggregation's pin state is per-user too.
  const adminAgg = await (await fetch(`${base}/api/books/folders`)).json();
  assert.equal(adminAgg.folders.find((f) => f.dir === booksDir).pinned, false);
  const secondAgg = await (await fetch(`${base}/api/books/folders`, { headers: { Cookie: second.cookie } })).json();
  assert.equal(secondAgg.folders.find((f) => f.dir === booksDir).pinned, true);
});

test('v1.43 carrier: the books scan prune removes EVERY user\'s reading position for the pruned book', async () => {
  const second = __mintTestSession({ username: 'bookuser3' });
  const doomed = path.join(booksDir, 'doomed-carrier.epub');
  fs.writeFileSync(doomed, buildEpub({ title: 'Doomed Carrier' }));
  await scanBooks();
  const doomedId = getMediaId(doomed);
  userStore.setBookProgress(uid, doomedId, { percent: 10, updatedAt: new Date().toISOString() });
  userStore.setBookProgress(second.user.id, doomedId, { percent: 30, updatedAt: new Date().toISOString() });

  await updateDatabase((db) => { db.settings.pruneMissing = true; return true; });
  fs.unlinkSync(doomed);
  await scanBooks();
  await updateDatabase((db) => { db.settings.pruneMissing = false; return true; });

  assert.equal(userStore.getOneBookProgress(uid, doomedId), null, 'the admin\'s position pruned with the book');
  assert.equal(userStore.getOneBookProgress(second.user.id, doomedId), null, 'every OTHER user\'s position too (no stale resurrection onto a same-path re-add)');
});
