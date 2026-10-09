'use strict';
/* global document, window */
// v1.379.0 Feed mode, W3 measurement (plan section 5, D7): the ONE shared player moves into a
// feed card and back to the watch page with no second player element and no lost position.
// Boots the real server with a real (generated) video, opens /feed in a REAL browser
// (Chromium; WebKit when asked), starts a 10-minute session, scrolls the first video card
// into view and reads back: how many #player-wrapper (the live host) elements exist, where the host's parent is,
// that the media element plays from the card's startAt, the slice readout; then leaves for the
// watch page of that video through the SPA router (FileTube.navigate) and reads: still one
// host, mounted in the watch page's #player-slot, the position carried (>= the feed's); then seeks BACK and pauses
// there: the save must go through the watch page's own route (gate r1, adversary C1), never the feed's.
//
//   node tools/feed-proof/card-player.js <repoRoot> [out.json] [chromium|webkit|both]
// Not a CI gate: a proof tool (like tools/feed-proof/reader-resume.js).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT = process.argv[3] || null;
const ENGINES = (process.argv[4] || 'chromium') === 'both' ? ['chromium', 'webkit'] : [process.argv[4] || 'chromium'];
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedcard-'));
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
  const { app, __mintTestSession, userStore } = server;
  const { seedState } = require(path.join(REPO, 'test/helpers/seed-state'));
  const dir = path.join(process.env.DATA_DIR, 'Clips'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'clip.webm');
  await makeWebm(file);
  const metadata = { clip1: { id: 'clip1', title: 'Feed clip', filePath: file, folderName: 'Clips', rootFolder: process.env.DATA_DIR, type: 'video', ext: '.webm', duration: 30, size: fs.statSync(file).size, addedAt: Date.now(), channelName: 'Clips', width: 320, height: 180 } };
  seedState({ folders: [process.env.DATA_DIR], folderSettings: {}, metadata, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  const listening = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${listening.address().port}`;
  const { cookie, user } = __mintTestSession();
  // an in-progress video (so it leads the video pool) at 6 s: the card's slice is a 3-minute segment from 6 s (the clip is 30 s)
  userStore.setProgress(user.id, 'clip1', { timestamp: 6, duration: 30, updatedAt: new Date().toISOString() });
  const results = [];

  for (const engine of ENGINES) {
    const browser = await pw[engine].launch({ args: engine === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1].split(';')[0], url: base }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message)));
    await page.goto(`${base}/feed`, { waitUntil: 'load' });
    await page.waitForSelector('#feed-picker-choices button[data-minutes="10"]', { timeout: 15000 });
    const requests = [];
    page.on('request', (rq) => { if (rq.url().includes('/api/')) requests.push(rq.method() + ' ' + rq.url().replace(base, '')); });
    // a 404 for a thumbnail or art this fixture never generated is informational; an uncaught script error fails
    const resource404s = [];
    page.on('console', (m) => { if (m.type() === 'error') { if (/Failed to load resource/.test(m.text())) resource404s.push(m.text()); else errors.push('console: ' + m.text()); } });
    await page.click('#feed-picker-choices button[data-minutes="10"]');
    try {
      await page.waitForSelector('.feed-card[data-kind="video"]', { timeout: 15000 });
    } catch (e) {
      const state = await page.evaluate(() => ({ view: document.getElementById('view-root') && document.getElementById('view-root').getAttribute('data-view'), pickerHidden: document.getElementById('feed-picker') && document.getElementById('feed-picker').hidden, cards: Array.from(document.querySelectorAll('.feed-card')).map((c) => c.getAttribute('data-kind')), notice: (document.querySelector('.feed-notice') || {}).textContent, empty: (document.getElementById('feed-empty') || {}).textContent }));
      console.log('DIAG no video card:', JSON.stringify({ state, requests, errors }));
      throw e;
    }
    // scroll the video card into view (it may be card 0 already)
    await page.evaluate(() => { const c = document.querySelector('.feed-card[data-kind="video"]'); c.scrollIntoView({ block: 'start' }); });
    try {
      await page.waitForFunction(() => { const c = document.querySelector('.feed-card[data-kind="video"]'); return c && c.hasAttribute('data-active') && c.querySelector('#player-wrapper'); }, null, { timeout: 15000 });
    } catch (e) {
      const state = await page.evaluate(() => {
        const c = document.querySelector('.feed-card[data-kind="video"]');
        const host = document.getElementById('player-wrapper');
        const stack = document.getElementById('feed-stack');
        return {
          active: Array.from(document.querySelectorAll('.feed-card')).map((x) => x.getAttribute('data-kind') + (x.hasAttribute('data-active') ? '*' : '')),
          cardRect: c && (() => { const r = c.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) }; })(),
          stackRect: stack && (() => { const r = stack.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), scrollTop: stack.scrollTop, scrollH: stack.scrollHeight }; })(),
          slotChildren: c ? Array.from(c.querySelector('.feed-card__slot').children).map((k) => k.id || k.className) : null,
          hostParent: host ? (host.parentElement.id || host.parentElement.className) : 'no host',
          playerId: window.FileTube && window.FileTube.player && window.FileTube.player.currentId,
          playerState: window.FileTube && window.FileTube.player && window.FileTube.player.getState && window.FileTube.player.getState(),
        };
      });
      console.log('DIAG no active/mounted video card:', JSON.stringify({ state, requests, errors }));
      throw e;
    }
    // play from the slice start: wait for the seek (WebKit once read 4.9 s of a 6 s start after a fixed 2.5 s pause), then a little playback
    await page.waitForFunction(() => { const v = document.getElementById('media-player'); return v && v.currentTime >= 6; }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const inCard = await page.evaluate(() => {
      const hosts = document.querySelectorAll('#player-wrapper');
      const card = document.querySelector('.feed-card[data-kind="video"]');
      const slot = card.querySelector('.feed-card__slot');
      const v = document.getElementById('media-player');
      return {
        hosts: hosts.length,
        videos: document.querySelectorAll('video').length,
        hostInSlot: !!(hosts[0] && hosts[0].parentElement === slot),
        currentTime: v ? v.currentTime : null,
        paused: v ? v.paused : null,
        src: v ? (v.currentSrc || v.src || '').replace(/^https?:\/\/[^/]+/, '') : null,
        left: card.querySelector('[data-left]') ? card.querySelector('[data-left]').textContent : null,
        hostRect: hosts[0] ? (() => { const r = hosts[0].getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; })() : null,
        stackRect: (() => { const r = document.getElementById('feed-stack').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; })(),
      };
    });
    // leave for the watch page of that clip through the SPA router (the dock-then-adopt path)
    await page.evaluate(() => window.FileTube.navigate('/watch.html?v=clip1'));
    await page.waitForFunction(() => document.getElementById('view-root') && document.getElementById('view-root').getAttribute('data-view') === 'watch' && document.querySelector('#player-slot #player-wrapper'), null, { timeout: 15000 });
    await page.waitForTimeout(1000);
    const onWatch = await page.evaluate(() => {
      const hosts = document.querySelectorAll('#player-wrapper');
      const v = document.getElementById('media-player');
      return { hosts: hosts.length, videos: document.querySelectorAll('video').length, hostInWatchSlot: !!(hosts[0] && hosts[0].parentElement === document.getElementById('player-slot')), currentTime: v ? v.currentTime : null, paused: v ? v.paused : null, view: document.getElementById('view-root').getAttribute('data-view') };
    });
    // gate r1 (adversary C1): the ADOPTED media saves through the watch page's own route again - a seek BACK
    // and a pause must post /api/progress (200) with the lower time; the feed's forward-only route would have
    // refused it (409) and the place would have stopped following the user.
    const pings = [];
    page.on('response', (rs) => { const u = rs.url().replace(base, ''); if (rs.request().method() === 'POST' && /\/api\/(feed\/)?progress/.test(u)) pings.push({ url: u, status: rs.status(), body: rs.request().postData() }); });
    await page.evaluate(() => { const v = document.getElementById('media-player'); v.currentTime = 2.4; v.pause(); });
    await page.waitForTimeout(3000);
    const ownRoute = pings.filter((x) => x.url === '/api/progress' && x.status === 200 && (() => { try { return JSON.parse(x.body).timestamp < 5; } catch { return false; } })());
    const feedRoute = pings.filter((x) => x.url.indexOf('/api/feed/progress') === 0);
    const seekBack = { pings, ownRouteSaves: ownRoute.length, feedRoutePings: feedRoute.length };
    await browser.close();
    const pass = inCard.hosts === 1 && inCard.videos === 1 && inCard.hostInSlot && inCard.currentTime !== null && inCard.currentTime >= 6 && inCard.src.indexOf('/video/clip1') === 0
      && onWatch.hosts === 1 && onWatch.videos === 1 && onWatch.hostInWatchSlot && onWatch.currentTime >= inCard.currentTime - 0.5 && errors.length === 0
      && seekBack.ownRouteSaves >= 1 && seekBack.feedRoutePings === 0;
    const row = { engine, inCard, onWatch, seekBack, errors, resource404s: resource404s.length, pass };
    results.push(row);
    console.log(`${pass ? 'PASS' : 'FAIL'} ${engine.padEnd(8)} inCard=${JSON.stringify(inCard)} onWatch=${JSON.stringify(onWatch)} seekBack=${JSON.stringify(seekBack)}${errors.length ? ' errors=' + JSON.stringify(errors) : ''}`);
  }
  const fails = results.filter((r) => !r.pass).length;
  console.log(`SUMMARY card-player: ${results.length - fails}/${results.length} pass (${ENGINES.join('+')})`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  listening.closeAllConnections?.();
  await new Promise((resolve) => listening.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
