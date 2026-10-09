'use strict';
/* global document */
// v1.381.0 Feed, TikTok style (plan W4, D9): Start over END TO END in a real browser against the real server, on the
// shared fixture (tools/feed-proof/fixture.js). The landscape video is in progress at 50 s (a watched item is never
// served, so the latch's reset and restore are bound by test/integration/feed-start-over.test.js instead); on its card:
// "..." -> Start over -> the confirm (its text read back) -> Start over. Read back: the stored progress row is gone, the
// card says New and the video restarts from 0; then the real toast's Undo button: the row is back EXACTLY (timestamp,
// duration, updatedAt), the card says Continue. Then a book card:
// Start over, its stored place gone; Undo, back exactly.
//
//   node tools/feed-proof/start-over.js <repoRoot> [out.json] [chromium|webkit|both]
// Not a CI gate: a proof tool.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT = process.argv[3] || null;
const ENGINES = (process.argv[4] || 'chromium') === 'both' ? ['chromium', 'webkit'] : [process.argv[4] || 'chromium'];
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedsover-'));
process.env.PROGRESS_FLUSH_MS = '50';

const { seed, seedUser, BOOK_TITLE } = require('./fixture');
const pw = require(require.resolve('playwright', { paths: [path.join(REPO, 'tools/capture'), '/home/coder/projects/filetube/tools/capture'] }));

async function main() {
  const server = require(path.join(REPO, 'server.js'));
  const { app, __mintTestSession, userStore, flushPendingProgress } = server;
  const helper = await pw.chromium.launch();
  const fx = await seed(server, helper, REPO);
  await helper.close();
  const listening = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${listening.address().port}`;
  const results = [];

  for (const engine of ENGINES) {
    const { cookie, user } = __mintTestSession({ username: 'sover-' + engine, role: 'admin' });
    seedUser(server, user, fx);
    const T = '2026-10-01T10:00:00.000Z';
    userStore.setProgress(user.id, 'land1', { timestamp: 50, duration: 60, updatedAt: T }); // past the clip's started minute (80% of 60 s), so the card continues
    const bookId = fx.books[BOOK_TITLE];
    const bookBefore = userStore.getOneBookProgress(user.id, bookId);
    const before = { progress: userStore.getOneProgress(user.id, 'land1'), watched: userStore.getWatchedTimes(user.id).land1 || null };
    const browser = await pw[engine].launch({ args: engine === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: engine === 'chromium', hasTouch: true });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1].split(';')[0], url: base }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message)));
    const row = { engine, errors };
    await page.goto(`${base}/feed`, { waitUntil: 'load' });
    await page.click('#feed-picker-choices button[data-minutes="10"]');
    await page.waitForSelector('.feed-card[data-id="land1"]', { timeout: 15000 });
    await page.evaluate(() => document.querySelector('.feed-card[data-id="land1"]').scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => { const c = document.querySelector('.feed-card[data-id="land1"]'); const v = document.getElementById('media-player'); return c && c.hasAttribute('data-active') && v && c.contains(v) && v.currentTime > 50; }, null, { timeout: 15000 }).catch(() => {});
    row.kindBefore = await page.$eval('.feed-card[data-id="land1"] .feed-card__kind', (e) => e.textContent);
    await page.click('.feed-card[data-id="land1"] [data-card-menu]');
    await page.waitForTimeout(700);
    await page.locator('.ui-sheet').last().getByText('Start over', { exact: true }).first().click();
    await page.waitForTimeout(700);
    row.confirmText = await page.evaluate(() => { const s = Array.from(document.querySelectorAll('.ui-sheet')).pop(); return s ? s.textContent.replace(/\s+/g, ' ').trim() : null; });
    await page.locator('.ui-confirm__actions .ui-btn', { hasText: 'Start over' }).last().click();
    await page.waitForTimeout(2500);
    await flushPendingProgress();
    row.afterReset = { progress: userStore.getOneProgress(user.id, 'land1'), watched: userStore.getWatchedTimes(user.id).land1 || null };
    row.kindAfter = await page.$eval('.feed-card[data-id="land1"] .feed-card__kind', (e) => e.textContent);
    row.mediaAfter = await page.evaluate(() => { const v = document.getElementById('media-player'); return v ? Math.round(v.currentTime * 10) / 10 : null; });
    row.toast = await page.evaluate(() => { const t = document.querySelector('.ui-toast'); return t ? t.textContent.replace(/\s+/g, ' ').trim() : null; });
    await page.locator('.ui-toast__action', { hasText: 'Undo' }).click();
    await page.waitForTimeout(2000);
    row.afterUndo = { progress: userStore.getOneProgress(user.id, 'land1'), watched: userStore.getWatchedTimes(user.id).land1 || null };
    row.kindUndo = await page.$eval('.feed-card[data-id="land1"] .feed-card__kind', (e) => e.textContent);
    row.exact = JSON.stringify(row.afterUndo) === JSON.stringify(before);
    // the book card
    await page.evaluate(() => { const c = document.querySelector('.feed-card[data-kind="book"]:not([data-new-book])'); if (c) c.scrollIntoView({ block: 'start' }); });
    await page.waitForTimeout(1200);
    await page.click('.feed-card[data-kind="book"]:not([data-new-book]) [data-card-menu]');
    await page.waitForTimeout(700);
    await page.locator('.ui-sheet').last().getByText('Start over', { exact: true }).first().click();
    await page.waitForTimeout(700);
    row.bookConfirm = await page.evaluate(() => { const s = Array.from(document.querySelectorAll('.ui-sheet')).pop(); return s ? s.textContent.replace(/\s+/g, ' ').trim() : null; });
    await page.locator('.ui-confirm__actions .ui-btn', { hasText: 'Start over' }).last().click();
    await page.waitForTimeout(1500);
    row.bookAfterReset = userStore.getOneBookProgress(user.id, bookId);
    await page.locator('.ui-toast__action', { hasText: 'Undo' }).last().click();
    await page.waitForTimeout(1500);
    row.bookExact = JSON.stringify(userStore.getOneBookProgress(user.id, bookId)) === JSON.stringify(bookBefore);
    await browser.close();
    row.pass = !!(/Your place, 0:50 of 1:00, will be forgotten\./.test(row.confirmText || '') && row.afterReset.progress === null && row.afterReset.watched === null
      && /New/.test(row.kindAfter) && row.mediaAfter !== null && row.mediaAfter < 4 && /Started over/.test(row.toast || '') && row.exact && /Continue/.test(row.kindUndo)
      && row.bookAfterReset === null && row.bookExact && errors.length === 0);
    results.push(row);
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${engine} ${JSON.stringify(row)}`);
  }
  const fails = results.filter((r) => !r.pass).length;
  console.log(`SUMMARY start-over: ${results.length - fails}/${results.length} pass (${ENGINES.join('+')})`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  listening.closeAllConnections?.();
  await new Promise((resolve) => listening.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
