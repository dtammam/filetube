'use strict';

// [INTEGRATION] v1.37.0 T4: the book scanner end-to-end against the REAL
// app module -- fixture EPUBs built in-memory by test/helpers/build-zip.js
// (no binary fixtures), an isolated DATA_DIR, and the real
// loadDatabase/updateDatabase/scanBooks wiring. Locks: discovery + item
// shape, unchanged-rescan reuse, EPUB cover extraction to BOOKCOVER_DIR,
// mount-loss preservation, config overlap rejection (both directions), the
// mid-scan cover-backfill carry-forward (the books-internal persist-gate
// carve-out), and the books-less no-op posture.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-books-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, loadDatabase, updateDatabase, getMediaId, scanBooks, currentBookScanState, BOOKCOVER_DIR,
} = require('../../server');

// v1.37.0 gate fix (W2 made the scanner cooperative-async): a scanBooks()
// call landing while another scan is in flight COALESCES and returns
// immediately -- deterministic tests must wait for the state machine to
// settle, not just await their own call.
async function scanBooksSettled() {
  await scanBooks();
  for (let i = 0; i < 400 && currentBookScanState().scanning; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const { buildEpub } = require('../helpers/build-zip');

let server;
let base;
let booksDir;

before(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-bookslib-'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
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

test('T4: books-less install is a total no-op -- no db.books writes, scan settles instantly', async () => {
  await scanBooksSettled();
  assert.ok(!loadDatabase().books || Object.keys((loadDatabase().books || {}).items || {}).length === 0);
});

test('T4: config + scan discovers EPUB (full metadata + cover) and PDF (filename title, placeholder), correct item shape', async () => {
  const shelfDir = path.join(booksDir, 'SciFi');
  fs.mkdirSync(shelfDir, { recursive: true });
  const coverBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);
  fs.writeFileSync(path.join(shelfDir, 'dune.epub'), buildEpub({
    title: 'Dune', author: 'Frank Herbert', chapters: ['<p>c1</p>', '<p>c2</p>'], coverData: coverBytes,
  }));
  fs.writeFileSync(path.join(booksDir, 'Some_Manual.v2.pdf'), '%PDF-1.4 fake');

  const cfgRes = await postJson('/api/books/config', { folders: [booksDir] });
  assert.equal(cfgRes.status, 200);
  // Config save fire-and-forgets a scan; run one explicitly for determinism.
  await scanBooksSettled();

  const items = loadDatabase().books.items;
  const epub = Object.values(items).find((i) => i.format === 'epub');
  const pdf = Object.values(items).find((i) => i.format === 'pdf');
  assert.ok(epub && pdf, 'both books discovered');
  assert.equal(epub.title, 'Dune');
  assert.equal(epub.author, 'Frank Herbert');
  assert.equal(epub.folderName, 'SciFi');
  assert.equal(epub.rootFolder, booksDir);
  assert.equal(epub.spine.length, 2, 'spine reading order captured (the wave-2 chapter address)');
  assert.equal(epub.hasCover, true);
  const coverPath = path.join(BOOKCOVER_DIR, `${epub.id}${epub.coverExt}`);
  assert.ok(fs.existsSync(coverPath), 'cover extracted to the books-owned dir');
  assert.deepEqual(fs.readFileSync(coverPath), coverBytes, 'cover bytes exact');
  assert.equal(pdf.title, 'Some Manual v2', 'filename-derived title, separators eased');
  assert.equal(pdf.hasCover, false, 'PDF covers arrive via the client backfill');
  assert.equal(getMediaId(pdf.filePath), pdf.id, 'ids share the app path-hash');
});

test('T4: an unchanged rescan REUSES items (same object content, addedAt stable)', async () => {
  const beforeItems = loadDatabase().books.items;
  const epubBefore = Object.values(beforeItems).find((i) => i.format === 'epub');
  await scanBooksSettled();
  const epubAfter = Object.values(loadDatabase().books.items).find((i) => i.format === 'epub');
  assert.deepEqual(epubAfter, epubBefore, 'unchanged path+size = full reuse, no re-extraction churn');
});

test('T4: a malformed "epub" (not a zip) indexes by filename -- the scan NEVER aborts', async () => {
  fs.writeFileSync(path.join(booksDir, 'Broken_Book.epub'), 'this is not a zip at all');
  await scanBooksSettled();
  const broken = Object.values(loadDatabase().books.items).find((i) => i.title === 'Broken Book');
  assert.ok(broken, 'still indexed');
  assert.equal(broken.hasCover, false);
  assert.deepEqual(broken.spine, []);
});

test('T4: mid-scan cover/pageCount backfill survives the merge (the 3-field carry-forward)', async () => {
  // Simulate the race: a client backfill writes hasCover/pageCount to the
  // FRESH db while a scan pass (whose Phase-1 snapshot predates it) is
  // rebuilding the same item. The scan's own pass produces hasCover:false
  // for this PDF -- the carry-forward must preserve the backfill.
  const pdf = Object.values(loadDatabase().books.items).find((i) => i.format === 'pdf');
  await updateDatabase((db) => {
    db.books.items[pdf.id] = { ...db.books.items[pdf.id], hasCover: true, coverExt: '.jpg', pageCount: 42 };
    return true;
  });
  // Force a re-extract of this item so the scanner's own pass would produce
  // hasCover:false (touch the size).
  fs.appendFileSync(pdf.filePath, ' padding');
  await scanBooksSettled();
  const after = loadDatabase().books.items[getMediaId(pdf.filePath)];
  assert.equal(after.hasCover, true, 'carry-forward preserved the backfilled cover flag');
  assert.equal(after.coverExt, '.jpg');
  assert.equal(after.pageCount, 42, 'and the page count');
});

test('T4: mount-loss guard -- a vanished root prunes NOTHING under it even with pruneMissing on; a genuine delete prunes (progress included)', async () => {
  await updateDatabase((db) => {
    db.settings.pruneMissing = true;
    return true;
  });
  const items = loadDatabase().books.items;
  // Deliberately the DUNE item -- Broken_Book is ALSO format 'epub', and its
  // progress legitimately prunes with it below.
  const epub = Object.values(items).find((i) => i.title === 'Dune');
  await updateDatabase((db) => {
    db.books.progress[epub.id] = { locator: { kind: 'epub', cfi: 'x' }, percent: 10, updatedAt: 't' };
    return true;
  });

  // Genuine delete: remove the broken epub file -> pruned.
  fs.unlinkSync(path.join(booksDir, 'Broken_Book.epub'));
  await scanBooksSettled();
  assert.ok(!Object.values(loadDatabase().books.items).some((i) => i.title === 'Broken Book'), 'genuinely deleted file pruned');

  // Mount loss: rename the whole root away -> everything PRESERVED.
  const hiddenDir = `${booksDir}.hidden`;
  fs.renameSync(booksDir, hiddenDir);
  await scanBooksSettled();
  const preserved = loadDatabase().books.items;
  assert.ok(Object.values(preserved).some((i) => i.title === 'Dune'), 'unmounted root items preserved');
  assert.ok(loadDatabase().books.progress[epub.id], 'progress preserved too');
  fs.renameSync(hiddenDir, booksDir);
  await updateDatabase((db) => {
    db.settings.pruneMissing = false;
    return true;
  });
});

test('T4: config rejects overlap with media folders in BOTH directions', async () => {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-mediadir-'));
  await updateDatabase((db) => {
    db.folders = [mediaDir];
    return true;
  });
  const inside = path.join(mediaDir, 'books');
  fs.mkdirSync(inside, { recursive: true });
  const r1 = await postJson('/api/books/config', { folders: [inside] });
  assert.equal(r1.status, 400, 'book root under a media root rejected');
  const r2 = await postJson('/api/books/config', { folders: [path.dirname(mediaDir)] });
  assert.equal(r2.status, 400, 'book root ABOVE a media root rejected');
  const r3 = await postJson('/api/books/config', { folders: ['/definitely/not/a/real/dir'] });
  assert.equal(r3.status, 400, 'nonexistent dir rejected');
  await updateDatabase((db) => {
    db.folders = [];
    return true;
  });
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

test('T4: POST /api/books/scan 202s and coalesces; scan-status reflects the state machine', async () => {
  const res = await postJson('/api/books/scan', {});
  assert.equal(res.status, 202);
  const status = await (await fetch(`${base}/api/books/scan-status`)).json();
  assert.ok('scanning' in status && 'lastScan' in status);
  // Let the fire-and-forget scan settle before the next test file assertion.
  await new Promise((resolve) => setTimeout(resolve, 200));
});

test('GATE FIX (QA CRITICAL #2, the v1.33 Option-C lesson): a root that EXISTS but scans EMPTY while the library has items under it prunes NOTHING', async () => {
  await updateDatabase((db) => { db.settings.pruneMissing = true; return true; });
  const itemsBefore = Object.values(loadDatabase().books.items).filter((i) => i.rootFolder === booksDir);
  assert.ok(itemsBefore.length >= 1, 'precondition: items exist under the root');
  const epub = itemsBefore.find((i) => i.title === 'Dune');
  await updateDatabase((db) => {
    db.books.progress[epub.id] = { locator: { kind: 'epub', cfi: 'x' }, percent: 33, updatedAt: 't' };
    return true;
  });

  // Simulate the unmounted-share-with-leftover-mountpoint signature: move
  // every file OUT of the root but keep the directory itself present.
  const stash = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-stash-'));
  const moved = [];
  for (const entry of fs.readdirSync(booksDir)) {
    fs.renameSync(path.join(booksDir, entry), path.join(stash, entry));
    moved.push(entry);
  }
  assert.ok(fs.existsSync(booksDir), 'the mountpoint dir still exists');

  await scanBooksSettled();
  const itemsAfter = Object.values(loadDatabase().books.items).filter((i) => i.rootFolder === booksDir);
  assert.equal(itemsAfter.length, itemsBefore.length, 'an empty-but-present root must prune NOTHING (treated as unmounted)');
  assert.ok(loadDatabase().books.progress[epub.id], 'reading progress preserved');

  // Restore + a normal scan sees everything again.
  for (const entry of moved) fs.renameSync(path.join(stash, entry), path.join(booksDir, entry));
  fs.rmSync(stash, { recursive: true, force: true });
  await scanBooksSettled();
  await updateDatabase((db) => { db.settings.pruneMissing = false; return true; });
});
