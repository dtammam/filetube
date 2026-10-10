'use strict';
/* global document, window */
// v1.382.0 Feed settings, W3 measurement (plan 2026-10-10-feed-settings D4 + D7): Keep watching from a card played
// "From the beginning" (Settings > Feed, Where they start) leaves the Feed into the watch page with ONE player, still
// playing, from where the card got to - and the saved place (25 s) is never moved back by it: a pause on the watch page
// BEHIND the place saves nothing (the player's place floor survives the adopt), a pause PAST it saves through the watch
// page's own route. Also: the session's record is posted (finish) and no recap opens.
// Boots the real server with a real 30 s WebM (card-player.js's recipe), the session's settings in localStorage.
//
//   node tools/feed-proof/keep-watching.js <repoRoot> [out.json] [chromium|webkit|both]
// Not a CI gate: a proof tool (like tools/feed-proof/reader-resume.js).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT = process.argv[3] || null;
const ENGINES = (process.argv[4] || 'chromium') === 'both' ? ['chromium', 'webkit'] : [process.argv[4] || 'chromium'];
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedkeep-'));
process.env.PROGRESS_FLUSH_MS = '50';

const pw = require(require.resolve('playwright', { paths: [path.join(REPO, 'tools/capture'), '/home/coder/projects/filetube/tools/capture'] }));

// A real 30 s landscape WebM (colour frames), encoded with Playwright's ffmpeg (the edge-to-edge proof's recipe).
async function makeWebm(file) {
  const cache = path.join(os.tmpdir(), 'ft-feed-landscape-30s.webm');
  if (fs.existsSync(cache)) { fs.copyFileSync(cache, file); return; }
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  const ffbin = fs.readdirSync(root).filter((d) => d.startsWith('ffmpeg-')).sort().reverse().map((d) => path.join(root, d, 'ffmpeg-linux')).find((f) => fs.existsSync(f));
  const br = await pw.chromium.launch();
  const pg = await br.newPage({ viewport: { width: 320, height: 180 } });
  const ff = require('node:child_process').spawn(ffbin, ['-y', '-f', 'image2pipe', '-framerate', '2', '-c:v', 'mjpeg', '-i', 'pipe:0', '-c:v', 'libvpx', '-b:v', '150k', '-g', '10', '-r', '2', cache], { stdio: ['pipe', 'ignore', 'inherit'] });
  const done = new Promise((res, rej) => { ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))); });
  await pg.setContent('<body style="margin:0"><div id=d style="width:320px;height:180px;font:40px sans-serif;color:#fff;display:flex;align-items:center;justify-content:center"></div></body>');
  for (let f = 0; f < 60; f++) {
    await pg.evaluate((n) => { const d = document.getElementById('d'); d.style.background = 'hsl(' + ((n * 23) % 360) + ',70%,35%)'; d.textContent = String(n / 2); }, f);
    const jpg = await pg.screenshot({ type: 'jpeg', quality: 60 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); await done; await br.close();
  fs.copyFileSync(cache, file);
}

async function main() {
  const server = require(path.join(REPO, 'server.js'));
  const { app, __mintTestSession, userStore, flushPendingProgress } = server;
  const { seedState } = require(path.join(REPO, 'test/helpers/seed-state'));
  const dir = path.join(process.env.DATA_DIR, 'Clips'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'clip.webm');
  await makeWebm(file);
  const metadata = { clip1: { id: 'clip1', title: 'Feed clip', filePath: file, folderName: 'Clips', rootFolder: process.env.DATA_DIR, type: 'video', ext: '.webm', duration: 30, size: fs.statSync(file).size, addedAt: Date.now(), channelName: 'Clips', width: 320, height: 180 } };
  seedState({ folders: [process.env.DATA_DIR], folderSettings: {}, metadata, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  const listening = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${listening.address().port}`;
  const { cookie, user } = __mintTestSession();
  const PLACE = 25;
  const results = [];

  for (const engine of ENGINES) {
    userStore.setProgress(user.id, 'clip1', { timestamp: PLACE, duration: 30, updatedAt: new Date().toISOString() }); // started: Continue
    const browser = await pw[engine].launch({ args: engine === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1].split(';')[0], url: base }]);
    // Settings > Feed: Videos start From the beginning, 30 s reels (the synced key, as the Settings page writes it)
    await ctx.addInitScript(() => { try { window.localStorage.setItem('ft-feed-settings', JSON.stringify({ where: { video: 'start' }, reel: 30 })); } catch { /* storage off: the proof then measures the defaults (and fails its kind-line check) */ } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    const posts = [];
    page.on('response', (rs) => { const u = rs.url().replace(base, ''); if (rs.request().method() === 'POST' && /\/api\/(feed\/|progress)/.test(u)) posts.push({ url: u, status: rs.status(), body: rs.request().postData() }); });
    await page.goto(`${base}/feed`, { waitUntil: 'load' });
    await page.waitForSelector('#feed-picker-choices button[data-minutes="10"]', { timeout: 15000 });
    await page.click('#feed-picker-choices button[data-minutes="10"]');
    await page.waitForSelector('.feed-card[data-kind="video"]', { timeout: 15000 });
    await page.evaluate(() => document.querySelector('.feed-card[data-kind="video"]').scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => { const c = document.querySelector('.feed-card[data-kind="video"]'); return c && c.hasAttribute('data-active') && c.querySelector('#player-wrapper'); }, null, { timeout: 15000 });
    const kindLine = await page.evaluate(() => document.querySelector('.feed-card[data-kind="video"] .feed-card__kind').textContent);
    // the pill comes in the reel's last 10 s (20 s of 30): wait for it while the card plays from 0
    await page.waitForSelector('.feed-card[data-kind="video"] [data-keep]', { timeout: 40000 });
    const atTap = await page.evaluate(() => { const v = document.getElementById('media-player'); return { t: v.currentTime, paused: v.paused, pill: document.querySelector('[data-keep]').textContent.trim() }; });
    await page.click('.feed-card[data-kind="video"] [data-keep]');
    await page.waitForFunction(() => document.getElementById('view-root') && document.getElementById('view-root').getAttribute('data-view') === 'watch' && document.querySelector('#player-slot #player-wrapper'), null, { timeout: 15000 });
    await page.waitForTimeout(800);
    const onWatch = await page.evaluate(() => {
      const v = document.getElementById('media-player');
      return { hosts: document.querySelectorAll('#player-wrapper').length, videos: document.querySelectorAll('video').length, inWatchSlot: !!document.querySelector('#player-slot #player-wrapper'), t: v.currentTime, paused: v.paused, recap: !!document.querySelector('.ui-sheet, #feed-recap') };
    });
    // behind the place: pause at 22 s on the watch page - nothing may save
    await page.evaluate(() => { const v = document.getElementById('media-player'); v.pause(); v.currentTime = 22; });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const v = document.getElementById('media-player'); v.play().catch(() => {}); }); // the PROOF's own play: WebKit rejects one a pause interrupts
    await page.waitForTimeout(300);
    await page.evaluate(() => { const v = document.getElementById('media-player'); v.pause(); });
    await page.waitForTimeout(1500);
    await flushPendingProgress();
    const behind = { stored: (userStore.getOneProgress(user.id, 'clip1') || {}).timestamp, saves: posts.filter((p) => p.url === '/api/progress').length };
    // past the place: 27 s and pause - the watch page's own route saves it
    await page.evaluate(() => { const v = document.getElementById('media-player'); v.currentTime = 27; v.play().catch(() => {}); });
    await page.waitForTimeout(500);
    await page.evaluate(() => { const v = document.getElementById('media-player'); v.pause(); });
    await page.waitForTimeout(1500);
    await flushPendingProgress();
    const past = { stored: (userStore.getOneProgress(user.id, 'clip1') || {}).timestamp, saves: posts.filter((p) => p.url === '/api/progress' && p.status === 200).length };
    const finish = posts.filter((p) => /\/api\/feed\/sessions\/[^/]+\/finish$/.test(p.url)).length;
    await browser.close();
    const pass = kindLine === 'Video \u00b7 From the beginning' && atTap.t < PLACE && atTap.pill === 'Keep watching'
      && onWatch.hosts === 1 && onWatch.videos === 1 && onWatch.inWatchSlot && onWatch.paused === false && onWatch.t >= atTap.t - 0.5 && onWatch.recap === false
      && behind.stored === PLACE && behind.saves === 0 && past.saves >= 1 && past.stored >= PLACE && finish === 1 && errors.length === 0;
    const row = { engine, kindLine, atTap, onWatch, behind, past, finish, errors, pass };
    results.push(row);
    console.log(`${pass ? 'PASS' : 'FAIL'} ${engine.padEnd(8)} ${JSON.stringify(row)}`);
  }
  const fails = results.filter((r) => !r.pass).length;
  console.log(`SUMMARY keep-watching: ${results.length - fails}/${results.length} pass (${ENGINES.join('+')})`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  listening.closeAllConnections?.();
  await new Promise((resolve) => listening.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
