'use strict';
/* global document, PointerEvent */
// v1.381.0 Feed, TikTok style (plan W3, D7 + D8): the gestures in a REAL browser. On the shared fixture
// (tools/feed-proof/fixture.js), at 390 x 844 with touch:
//   - a vertical swipe that STARTS on the playing video moves the stack to the next card (Dean's "hard to get between":
//     the shared player's picture listener cancels every touch it receives);
//   - a tap on the playing video pauses it and a second tap plays it (the player's picture tap, its glyph flashes);
//   - a press and hold plays at 2x while held and back at 1x after the lift;
//   - on a book card a swipe left turns to page 2, a swipe that starts within 24 px of the left edge does not.
// Chromium drives REAL touches through CDP (Input.dispatchTouchEvent). Playwright's WebKit has no touch-move API: there it
// taps through page.touchscreen (a real touch) and the swipes are synthetic pointer events (they measure the Feed's own
// classification, not WebKit's gesture handling - the device check covers that).
//
//   node tools/feed-proof/gestures.js <repoRoot> [out.json] [chromium|webkit|both]
// Not a CI gate: a proof tool.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT = process.argv[3] || null;
const ENGINES = (process.argv[4] || 'chromium') === 'both' ? ['chromium', 'webkit'] : [process.argv[4] || 'chromium'];
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedgest-'));
process.env.PROGRESS_FLUSH_MS = '50';

const { seed, seedUser } = require('./fixture');
const pw = require(require.resolve('playwright', { paths: [path.join(REPO, 'tools/capture'), '/home/coder/projects/filetube/tools/capture'] }));

async function main() {
  const server = require(path.join(REPO, 'server.js'));
  const { app, __mintTestSession } = server;
  const helper = await pw.chromium.launch();
  const fx = await seed(server, helper, REPO);
  await helper.close();
  const listening = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${listening.address().port}`;
  const { cookie, user } = __mintTestSession();
  seedUser(server, user, fx);
  const results = [];

  for (const engine of ENGINES) {
    const browser = await pw[engine].launch({ args: engine === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: engine === 'chromium', hasTouch: true });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1].split(';')[0], url: base }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message)));
    const cdp = engine === 'chromium' ? await ctx.newCDPSession(page) : null;
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const drag = async (x0, y0, x1, y1, steps) => {
      if (cdp) {
        await touch('touchStart', x0, y0);
        for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await page.waitForTimeout(16); }
        await touch('touchEnd');
        return 'cdp-touch';
      }
      await page.evaluate(([a, b, c, d]) => {
        const t = document.elementFromPoint(a, b);
        const fire = (type, x, y) => { const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, isPrimary: true, pointerType: 'touch' }); t.dispatchEvent(e); };
        fire('pointerdown', a, b); fire('pointermove', c, d); fire('pointerup', c, d);
      }, [x0, y0, x1, y1]);
      return 'synthetic-pointer';
    };
    const tap = async (x, y) => { if (cdp) { await touch('touchStart', x, y); await page.waitForTimeout(60); await touch('touchEnd'); } else await page.touchscreen.tap(x, y); };
    const activeKind = () => page.evaluate(() => { const c = document.querySelector('.feed-card[data-active]'); return c ? c.getAttribute('data-kind') + ':' + c.getAttribute('data-id') + '#' + c.getAttribute('data-index') : null; });
    const media = () => page.evaluate(() => { const v = document.getElementById('media-player'); return v ? { paused: v.paused, rate: v.playbackRate, t: Math.round(v.currentTime * 10) / 10, badge: !document.getElementById('speed-badge').hidden } : null; });

    await page.goto(`${base}/feed`, { waitUntil: 'load' });
    await page.waitForSelector('#feed-picker-choices button[data-minutes="10"]', { timeout: 15000 });
    await page.click('#feed-picker-choices button[data-minutes="10"]');
    await page.waitForSelector('.feed-card[data-active]', { timeout: 15000 });
    // the landscape video card, active and playing
    await page.waitForSelector('.feed-card[data-id="land1"]', { timeout: 15000 });
    await page.evaluate(() => document.querySelector('.feed-card[data-id="land1"]').scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => { const c = document.querySelector('.feed-card[data-id="land1"]'); const v = document.getElementById('media-player'); return c && c.hasAttribute('data-active') && v && c.contains(v) && !v.paused && v.currentTime > 6.3; }, null, { timeout: 15000 }).catch(() => {});
    const row = { engine, errors };
    row.start = { active: await activeKind(), media: await media() };
    // tap: pause, tap: play
    await tap(195, 400); await page.waitForTimeout(500);
    row.tap1 = await media();
    row.glyph = await page.evaluate(() => { const g = document.getElementById('art-play-glyph'); return g ? g.className : null; });
    await tap(195, 400); await page.waitForTimeout(500);
    row.tap2 = await media();
    // hold (Chromium: a real held touch)
    if (cdp) {
      await touch('touchStart', 195, 400); await page.waitForTimeout(900);
      row.holding = await media();
      await touch('touchEnd'); await page.waitForTimeout(200);
      row.afterHold = await media();
    }
    // a vertical swipe that starts ON the playing video
    const before = await activeKind();
    row.swipeMode = await drag(195, 600, 195, 150, 12);
    await page.waitForTimeout(1500);
    row.swipe = { before, after: await activeKind() };
    // a book card: page 2 on a swipe left, nothing from the edge
    await page.evaluate(() => { const c = document.querySelector('.feed-card[data-kind="book"]:not([data-new-book])'); if (c) c.scrollIntoView({ block: 'start' }); });
    await page.waitForFunction(() => { const c = document.querySelector('.feed-card[data-kind="book"]:not([data-new-book])'); return c && c.hasAttribute('data-active'); }, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    const readout = () => page.evaluate(() => { const c = document.querySelector('.feed-card[data-kind="book"][data-active] [data-page-readout]'); return c ? c.textContent : null; });
    row.book0 = await readout();
    await drag(10, 400, 250, 410, 10); await page.waitForTimeout(400);
    row.bookEdge = await readout();
    await drag(300, 400, 120, 410, 10); await page.waitForTimeout(400);
    row.bookLeft = await readout();
    row.bookActive = await activeKind();
    await browser.close();
    row.pass = !!(row.start.media && !row.start.media.paused && row.tap1 && row.tap1.paused && row.tap2 && !row.tap2.paused
      && (!cdp || (row.holding && row.holding.rate === 2 && row.holding.badge && row.afterHold.rate === 1 && !row.afterHold.paused))
      && (!cdp || (row.swipe.after && row.swipe.after !== row.swipe.before))
      && row.book0 === 'Page 1 of ' + (row.book0 || '').split(' of ')[1] && row.bookEdge === row.book0 && /^Page 2 of /.test(row.bookLeft || '') && errors.length === 0);
    results.push(row);
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${engine} ${JSON.stringify(row)}`);
  }
  const fails = results.filter((r) => !r.pass).length;
  // gate r1 (qa S3): what each engine's PASS covers - Chromium: real touches (tap, hold, the stack swipe from the video, the page
  // swipes); WebKit: real taps only, the page swipes as synthetic pointer events, no hold and no stack move (no touch-move API)
  console.log(`SUMMARY gestures: ${results.length - fails}/${results.length} pass (${ENGINES.join('+')}; webkit = taps + synthetic page swipes only)`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  listening.closeAllConnections?.();
  await new Promise((resolve) => listening.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
