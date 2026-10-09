'use strict';
/* global document */
// v1.379.0 Feed mode, W1 measurement (plan section 5, D4): does the READER honour a
// bookmark the FEED wrote? The feed stores a BLOCK position { kind:'epub', cfi:'',
// spineIndex, blockIndex } (lib/feed/routes.js); read.js opens the chapter, takes the
// blockIndex-th READER_BLOCK_SELECTOR element of epub.js's live DOM and displays
// epub.js's own CFI for that node (read.js openEpub). This boots the real server with
// a fixture EPUB whose chapters span several phone pages, writes a feed position for
// several targets (a mid-chapter paragraph, a chapter's first paragraph inside a
// blockquote, a deep paragraph, the last chapter's heading), opens /read.html?b=<id>
// in a REAL browser (WebKit and Chromium, Playwright) and reads back:
//   - the reader's FIRST progress ping (its own blockIndex / spineIndex math for the
//     page it displayed): the spine must match and the page must START at or before
//     the target block (epub.js shows the PAGE containing the node);
//   - which blocks are actually on the shown page: epub.js lays the chapter out in
//     columns inside an iframe as wide as ALL its pages and scrolls the container,
//     so a block is visible when its box, offset by the iframe's position, lies
//     inside the .epub-container's box. The target must be among them, and NOT every
//     block may be (a whole-chapter page would make the check vacuous).
// Also drives the fallbacks for a CFI epub.js cannot resolve: a bad path inside a
// valid chapter lands at that chapter's start (epub.js itself), and a CFI naming a
// spine item past the book lands in the locator's own chapter (read.js's catch).
//
// First run (2026-10-09, before this design): a SERVER-derived CFI landed every target
// on block 0 - epub.js parses chapters through srcdoc (the HTML parser inserts a
// <head>, so an element path computed over raw XHTML names the wrong node) - and the
// visibility check passed vacuously because the iframe held every page. Both fixed here.
// Second lesson from the same day: the reader opened in the FIRST engine pings its own
// page-start CFI back to the server, so the second engine resumed from THAT locator,
// not the feed's; the feed position is therefore re-written before EVERY engine run
// and the stored locator is read back right before the page opens (printed per row).
//
//   node tools/feed-proof/reader-resume.js <repoRoot> [out.json] [webkit|chromium|both]
// Not a CI gate: a proof tool (like tools/edge-to-edge-proof). Prints one line per
// case and a final PASS/FAIL summary; exit 1 on any failure.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT = process.argv[3] || null;
const ENGINES = (process.argv[4] || 'both') === 'both' ? ['webkit', 'chromium'] : [process.argv[4]];
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedproof-'));
process.env.PROGRESS_FLUSH_MS = '50';

const pw = require(require.resolve('playwright', { paths: [path.join(REPO, 'tools/capture'), '/home/coder/projects/filetube/tools/capture'] }));
const { buildEpub } = require(path.join(REPO, 'test/helpers/build-zip'));
const chunk = require(path.join(REPO, 'lib/books/tts-chunk'));

// Distinct paragraphs so a visible one is unambiguous; long enough that a chapter
// spans several phone pages (so "the page containing the target" is a real test).
function para(ch, i) {
  const words = [];
  for (let w = 0; w < 38; w++) words.push(`c${ch}p${i}w${w}`);
  return `<p>${words.join(' ')}</p>`;
}
const CHAPTERS = [
  `<h1>Chapter One</h1>${Array.from({ length: 14 }, (_, i) => para(1, i)).join('')}`,
  `<h1>Chapter Two</h1><blockquote>${para(2, 0)}</blockquote>${Array.from({ length: 12 }, (_, i) => para(2, i + 1)).join('')}`,
  `<h1>Chapter Three</h1>${Array.from({ length: 6 }, (_, i) => para(3, i)).join('')}`,
];
function blocksOf(i) {
  return chunk.chunkChapterDetailed(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${CHAPTERS[i]}</body></html>`);
}

async function main() {
  const server = require(path.join(REPO, 'server.js'));
  const { app, updateDatabase, scanBooks, flushPendingBookProgress, booksDb, feedServed, __mintTestSession, userStore } = server;
  const booksDir = path.join(process.env.DATA_DIR, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  fs.writeFileSync(path.join(booksDir, 'proof.epub'), buildEpub({ title: 'Proof', author: 'Feed', chapters: CHAPTERS }));
  await updateDatabase(() => booksDb.mutate((db) => { require(path.join(REPO, 'lib/books/store')).ensureBooks(db).folders = [booksDir]; return true; }));
  await scanBooks();
  const bookId = Object.values(booksDb.read().items).find((i) => i.format === 'epub').id;
  const listening = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${listening.address().port}`;
  const { cookie, user } = __mintTestSession();
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  // Target positions (spineIndex, blockIndex): mid chapter 1; chapter 2's FIRST paragraph (the
  // blockquote's inner p: block 2, block 1 being the blockquote slot); chapter 2 deep; chapter 3 start (its heading).
  const CASES = [
    { name: 'mid-chapter-1', spineIndex: 0, blockIndex: 9 },
    { name: 'chapter-2-first-paragraph-in-blockquote', spineIndex: 1, blockIndex: 2 },
    { name: 'chapter-2-deep', spineIndex: 1, blockIndex: 11 },
    { name: 'chapter-3-start-heading', spineIndex: 2, blockIndex: 0 },
  ];
  const results = [];

  async function feedWrite(target) {
    // The excerpt route marks the position served; then the feed moves the bookmark.
    const ex = await fetch(`${base}/api/books/${bookId}/excerpt?spine=0&block=0&words=10`, { headers });
    if (ex.status !== 200) throw new Error('excerpt ' + ex.status);
    const r = await fetch(`${base}/api/feed/progress/book/${bookId}`, { method: 'POST', headers, body: JSON.stringify(target) });
    const body = await r.json();
    if (r.status !== 200) throw new Error('feed write ' + r.status + ' ' + JSON.stringify(body));
    await flushPendingBookProgress();
    return body.locator;
  }

  async function openReader(engine, expectBlock, expectSpine) {
    const browser = await pw[engine].launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1].split(';')[0], url: base }]);
    const page = await ctx.newPage();
    const pings = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes(`/api/books/${bookId}/progress`)) {
        try { pings.push(JSON.parse(req.postData() || '{}')); } catch { pings.push({ raw: req.postData() }); }
      }
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message)));
    await page.goto(`${base}/read.html?b=${encodeURIComponent(bookId)}`, { waitUntil: 'load' });
    // The first ping is debounced 3 s after the first relocated event; wait for it (or 20 s).
    const t0 = Date.now();
    while (pings.length === 0 && Date.now() - t0 < 20000) await page.waitForTimeout(200);
    // Which blocks are on the SHOWN page: block boxes are relative to the iframe, the iframe is
    // offset inside the scrolled .epub-container; the container's box is the visible page.
    const visible = await page.evaluate(({ selector }) => {
      const container = document.querySelector('.epub-container');
      const iframe = container ? container.querySelector('iframe') : document.querySelector('iframe');
      if (!iframe || !iframe.contentDocument || !container) return { error: 'no iframe/container', visible: [] };
      const doc = iframe.contentDocument;
      const box = container.getBoundingClientRect();
      const frameRect = iframe.getBoundingClientRect();
      const blocks = Array.from(doc.querySelectorAll(selector));
      const vis = [];
      blocks.forEach((el, idx) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        const absLeft = frameRect.left + r.left;
        const absRight = frameRect.left + r.right;
        const absTop = frameRect.top + r.top;
        const absBottom = frameRect.top + r.bottom;
        const inView = absRight > box.left + 1 && absLeft < box.right - 1 && absBottom > box.top + 1 && absTop < box.bottom - 1;
        if (inView) vis.push({ idx, text: (el.textContent || '').trim().slice(0, 24), left: Math.round(absLeft - box.left), top: Math.round(absTop - box.top) });
      });
      return {
        container: { w: Math.round(box.width), h: Math.round(box.height) },
        frame: { w: Math.round(frameRect.width), h: Math.round(frameRect.height), left: Math.round(frameRect.left - box.left) },
        visible: vis, total: blocks.length,
      };
    }, { selector: 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, td' });
    await browser.close();
    const ping = pings[0] || null;
    const visibleIdx = (visible.visible || []).map((v) => v.idx);
    const total = visible.total || 0;
    const pass = !!ping && ping.locator && ping.locator.spineIndex === expectSpine
      && Number.isInteger(ping.locator.blockIndex) && ping.locator.blockIndex <= expectBlock
      && visibleIdx.includes(expectBlock)
      && visibleIdx.length < total; // never a whole-chapter page (the vacuous case)
    return { engine, ping: ping && ping.locator, percent: ping && ping.percent, visible: visibleIdx, total, frame: visible.frame, container: visible.container, firstVisibleText: visible.visible && visible.visible[0] && visible.visible[0].text, errors, pass };
  }

  for (const c of CASES) {
    const expected = blocksOf(c.spineIndex)[c.blockIndex].text.slice(0, 24);
    for (const engine of ENGINES) {
      // The previous engine's reader pinged its own place: put the feed's position back first.
      await flushPendingBookProgress();
      userStore.setBookProgress(user.id, bookId, { locator: { kind: 'epub', cfi: 'epubcfi(/6/2!/4/2/1:0)', spineIndex: 0, blockIndex: 0 }, percent: 1, updatedAt: new Date().toISOString() });
      const locator = await feedWrite(c);
      const storedAtOpen = (await (await fetch(`${base}/api/books/${bookId}`, { headers })).json()).locator;
      const r = await openReader(engine, c.blockIndex, c.spineIndex);
      const storedOk = JSON.stringify(storedAtOpen) === JSON.stringify(locator);
      const row = { case: c.name, target: { spineIndex: c.spineIndex, blockIndex: c.blockIndex }, storedAtOpen, expectedText: expected, ...r, pass: r.pass && storedOk };
      results.push(row);
      console.log(`${row.pass ? 'PASS' : 'FAIL'} ${engine.padEnd(8)} ${c.name.padEnd(42)} storedAtOpen=${JSON.stringify(storedAtOpen)} ping=${JSON.stringify(r.ping)} visible=[${r.visible.join(',')}]/${r.total} frame=${JSON.stringify(r.frame)} first="${r.firstVisibleText}"${r.errors.length ? ' errors=' + JSON.stringify(r.errors) : ''}`);
    }
  }

  // Fallback arms. (a) a bad path inside a valid chapter: epub.js itself shows that chapter's start.
  // (b) a CFI naming a spine item past the book, with the locator's spineIndex: read.js's catch lands
  // in that chapter. (c) the same with no spineIndex: the start of the book (nothing better is known).
  // (d) a feed block past the chapter's blocks: the chapter's LAST block (gate r1, adversary W5), never its start.
  const FALLBACKS = [
    { name: 'bad-path-valid-chapter-lands-in-it', locator: { kind: 'epub', cfi: 'epubcfi(/6/4!/4/400/2)', spineIndex: 1, blockIndex: 5 }, expectSpine: 1 },
    { name: 'spine-past-book-with-spineIndex', locator: { kind: 'epub', cfi: 'epubcfi(/6/400!/4/2)', spineIndex: 1, blockIndex: 5 }, expectSpine: 1 },
    { name: 'spine-past-book-no-spineIndex', locator: { kind: 'epub', cfi: 'epubcfi(/6/400!/4/2)' }, expectSpine: 0 },
    // on chapter 2 (15 blocks, two pages in both engines): the fixture's 7-block LAST chapter lays out as one page in
    // headless Chromium with blocks 5-6 clipped at every target (pre-existing epub.js layout, not the clamp)
    { name: 'feed-block-past-chapter-lands-on-last-block', locator: { kind: 'epub', cfi: '', spineIndex: 1, blockIndex: 99 }, expectSpine: 1, expectLast: true },
  ];
  for (const fb of FALLBACKS) {
    await flushPendingBookProgress();
    userStore.setBookProgress(user.id, bookId, { locator: fb.locator, percent: 50, updatedAt: new Date().toISOString() });
    feedServed.forget(user.id, 'book', bookId);
    for (const engine of ENGINES) {
      const r = await openReader(engine, 0, fb.expectSpine);
      const lastBlock = blocksOf(fb.expectSpine).length - 1;
      const pass = !!r.ping && r.ping.spineIndex === fb.expectSpine && (!fb.expectLast || (r.visible.includes(lastBlock) && r.ping.blockIndex > 0));
      const row = { case: fb.name, locator: fb.locator, ...r, pass };
      results.push(row);
      console.log(`${pass ? 'PASS' : 'FAIL'} ${engine.padEnd(8)} ${fb.name.padEnd(42)} ping=${JSON.stringify(r.ping)} visible=[${r.visible.join(',')}]${r.errors.length ? ' errors=' + JSON.stringify(r.errors) : ''}`);
    }
  }

  const fails = results.filter((r) => !r.pass).length;
  console.log(`SUMMARY reader-resume: ${results.length - fails}/${results.length} pass (${ENGINES.join('+')}; ${CASES.length} feed targets x engines + ${FALLBACKS.length} fallback arms x engines)`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), engines: ENGINES, results }, null, 2));
  listening.closeAllConnections?.();
  await new Promise((resolve) => listening.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
