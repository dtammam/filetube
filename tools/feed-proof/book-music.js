'use strict';
/* global document, window, HTMLMediaElement */
// v1.383.0 Feed reels and speed (plan docs/exec-plans/active/2026-10-10-feed-reels.md W4, K6 = v1.382.0 D14) END TO END in a
// real browser against the real server, on the shared fixture (tools/feed-proof/fixture.js: a reading book, an unstarted book,
// two videos, a liked 60 s song - the Favorites station). Settings > Feed: books and videos only, so book and video cards meet.
//   A  on the first book card a song from the station plays from the Feed's hidden slot (the ONE shared player, not drawn),
//      about a third in, with a chip naming it; a page turn (ArrowRight) does not reload or stop it
//   B  a video card: the video plays in its own card, the song is gone (never two playing elements, at any 'playing')
//   C  nothing was counted (no POST /api/music/plays) and the song's saved place in Music did not move
//
//   node tools/feed-proof/book-music.js <repoRoot> [out.json] [chromium|webkit|both]
// Not a CI gate: a proof tool.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT = process.argv[3] || null;
const ENGINES = (process.argv[4] || 'both') === 'both' ? ['chromium', 'webkit'] : [process.argv[4]];
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-bookmusic-proof-'));
process.env.PROGRESS_FLUSH_MS = '50';

const { seed, seedUser } = require('./fixture');
const pw = require(require.resolve('playwright', { paths: [path.join(REPO, 'tools/capture'), '/home/coder/projects/filetube/tools/capture'] }));

function recorder() {
  const log = [];
  window.__bmLog = log;
  const playingCount = () => Array.prototype.filter.call(document.querySelectorAll('video, audio'), (m) => !m.paused && !m.ended).length;
  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { log.push({ ev: 'play()', src: this.currentSrc || this.src || '' }); return realPlay.apply(this, arguments); };
  document.addEventListener('playing', (e) => { log.push({ ev: 'playing', src: e.target.currentSrc || '', playingNow: playingCount() }); }, true);
  document.addEventListener('loadstart', (e) => { log.push({ ev: 'loadstart', src: e.target.currentSrc || e.target.src || '' }); }, true);
}

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
    const { cookie, user } = __mintTestSession({ username: 'bookmusic-' + engine, role: 'admin' });
    seedUser(server, user, fx);
    const browser = await pw[engine].launch({ args: engine === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1].split(';')[0], url: base }]);
    await ctx.addInitScript(() => { try { window.localStorage.setItem('ft-feed-settings', JSON.stringify({ off: ['podcast', 'watchlater', 'song'], advance: false })); } catch { /* the proof then fails */ } });
    await ctx.addInitScript(recorder);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message)));
    const plays = [];
    page.on('request', (rq) => { if (rq.method() === 'POST' && /\/api\/music\/plays$/.test(rq.url())) plays.push(rq.postData()); });
    await page.goto(`${base}/feed`, { waitUntil: 'load' });
    await page.click('#feed-picker-choices button[data-minutes="10"]');
    await page.waitForSelector('.feed-card[data-kind="book"]', { timeout: 20000 });
    // A: the first book card active, the song playing from the hidden slot
    await page.evaluate(() => document.querySelector('.feed-card[data-kind="book"]').scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => { const v = document.getElementById('media-player'); const slot = document.querySelector('.feed-music-slot'); return v && slot && slot.contains(v) && !v.paused && v.currentTime > 0; }, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const a = await page.evaluate(() => {
      const v = document.getElementById('media-player');
      const card = document.querySelector('.feed-card[data-active]');
      const chip = card && card.querySelector('[data-music-chip]');
      return { kind: card && card.getAttribute('data-kind'), inSlot: !!document.querySelector('.feed-music-slot').contains(v), slotHidden: document.querySelector('.feed-music-slot').hidden, src: v.currentSrc.replace(/^https?:\/\/[^/]+/, ''), t: v.currentTime, paused: v.paused, muted: v.muted, chip: chip ? chip.textContent.trim() : '' };
    });
    const loadsBeforeTurn = await page.evaluate(() => window.__bmLog.filter((e) => e.ev === 'loadstart').length);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1500);
    const afterTurn = await page.evaluate(() => { const v = document.getElementById('media-player'); return { t: v.currentTime, paused: v.paused, loads: window.__bmLog.filter((e) => e.ev === 'loadstart').length, page: (document.querySelector('.feed-card[data-active] [data-page-readout]') || {}).textContent }; });
    // B: a video card
    await page.evaluate(() => document.querySelector('.feed-card[data-kind="video"]').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(3000);
    const b = await page.evaluate(() => {
      const v = document.getElementById('media-player');
      const card = document.querySelector('.feed-card[data-active]');
      return { kind: card && card.getAttribute('data-kind'), inCard: !!(card && card.contains(v)), src: v.currentSrc.replace(/^https?:\/\/[^/]+/, ''), paused: v.paused, chips: document.querySelectorAll('[data-music-chip]').length, slotEmpty: !document.querySelector('.feed-music-slot').firstElementChild };
    });
    const log = await page.evaluate(() => window.__bmLog.slice());
    await page.waitForTimeout(600);
    await flushPendingProgress();
    const saved = userStore.getMusicProgress(user.id).trk1 || null;
    await browser.close();
    const maxPlaying = log.filter((e) => e.ev === 'playing').reduce((m, e) => Math.max(m, e.playingNow), 0);
    const row = { engine, a, afterTurn: Object.assign({ loadsBeforeTurn }, afterTurn), b, plays, savedPlace: saved, maxPlaying, errors };
    row.pass = a.kind === 'book' && a.inSlot && a.slotHidden && /^\/track\/trk1/.test(a.src) && a.paused === false && a.muted === false && a.t >= 19 && /Weightless/.test(a.chip)
      && afterTurn.paused === false && afterTurn.loads === loadsBeforeTurn && afterTurn.t > a.t
      && b.kind === 'video' && b.inCard && /^\/video\//.test(b.src) && b.paused === false && b.chips === 0
      && plays.length === 0 && !saved && maxPlaying <= 1 && errors.length === 0;
    results.push(row);
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${engine.padEnd(8)} ${JSON.stringify(row)}`);
  }
  const fails = results.filter((r) => !r.pass).length;
  console.log(`SUMMARY book-music: ${results.length - fails}/${results.length} pass (${ENGINES.join('+')})`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  listening.closeAllConnections?.();
  await new Promise((resolve) => listening.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
