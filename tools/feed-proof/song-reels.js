'use strict';
/* global document, window */
// v1.383.0 Feed reels and speed (plan docs/exec-plans/active/2026-10-10-feed-reels.md W3, K5 = v1.382.0 D13) END TO END in a real
// browser against the real server, on the shared fixture (tools/feed-proof/fixture.js: a liked 60 s song, real audio).
// Settings > Feed > Song clip = 30 s, so the song card plays 20 s .. 50 s (a third in).
//   A  heard to its end: the card starts at 20 s, plays to 50 s, stops (Done) and the Feed posts exactly ONE play for the song
//      (POST /api/music/plays) - no skip, no finish; the song's saved place in Music is not moved by the clip.
//   B  Keep listening mid-clip (its pill, in the last 10 s): Music opens on the same song, the ONE shared player carried over
//      still playing from where the card was (not from 0, not from the clip's start); the Feed posted nothing for it.
//
//   node tools/feed-proof/song-reels.js <repoRoot> [out.json] [chromium|webkit|both]
// Not a CI gate: a proof tool.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT = process.argv[3] || null;
const ENGINES = (process.argv[4] || 'both') === 'both' ? ['chromium', 'webkit'] : [process.argv[4]];
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-songreels-proof-'));
process.env.PROGRESS_FLUSH_MS = '50';

const { seed } = require('./fixture');
const pw = require(require.resolve('playwright', { paths: [path.join(REPO, 'tools/capture'), '/home/coder/projects/filetube/tools/capture'] }));

async function main() {
  const server = require(path.join(REPO, 'server.js'));
  const { app, __mintTestSession, userStore, flushPendingProgress } = server;
  const helper = await pw.chromium.launch();
  await seed(server, helper, REPO);
  await helper.close();
  const listening = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${listening.address().port}`;
  const results = [];

  for (const engine of ENGINES) {
    const row = { engine };
    for (const scenario of ['A', 'B']) {
      const { cookie, user } = __mintTestSession({ username: `songs-${engine}-${scenario}`, role: 'admin' });
      userStore.addMusicLiked(user.id, 'trk1', new Date().toISOString()); // the only Feed candidate: a song
      const browser = await pw[engine].launch({ args: engine === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] });
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1].split(';')[0], url: base }]);
      await ctx.addInitScript(() => { try { window.localStorage.setItem('ft-feed-settings', JSON.stringify({ clip: 30, advance: false, off: ['video', 'podcast', 'book', 'watchlater'] })); } catch { /* the proof then fails its start check */ } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e && e.message)));
      const plays = [];
      page.on('request', (rq) => { if (rq.method() === 'POST' && /\/api\/music\/plays$/.test(rq.url())) plays.push({ at: Date.now(), body: rq.postData() }); });
      await page.goto(`${base}/feed`, { waitUntil: 'load' });
      await page.click('#feed-picker-choices button[data-minutes="10"]');
      await page.waitForFunction(() => { const c = document.querySelector('.feed-card[data-kind="song"][data-active]'); const v = document.getElementById('media-player'); return c && v && c.contains(v) && !v.paused && v.currentTime > 0; }, null, { timeout: 20000 });
      const start = await page.evaluate(() => ({ t: document.getElementById('media-player').currentTime, label: document.querySelector('.feed-card[data-kind="song"] .feed-card__actions .feed-card__meta').textContent }));
      if (scenario === 'A') {
        await page.waitForFunction(() => document.querySelector('.feed-card[data-kind="song"]').hasAttribute('data-done'), null, { timeout: 45000 });
        await page.waitForTimeout(1500);
        const end = await page.evaluate(() => { const v = document.getElementById('media-player'); return { t: v.currentTime, paused: v.paused }; });
        await flushPendingProgress();
        const saved = userStore.getMusicProgress(user.id).trk1 || null;
        row.A = { start, end, plays: plays.map((p) => JSON.parse(p.body)), savedPlace: saved, errors: errors.slice() };
        row.A.pass = start.t >= 19.5 && start.t < 23 && /0:30 of this song/.test(start.label) && end.paused && end.t >= 49 && end.t < 51.5
          && row.A.plays.length === 1 && row.A.plays[0].kind === 'play' && row.A.plays[0].id === 'trk1' && !saved && errors.length === 0;
      } else {
        await page.waitForSelector('.feed-card[data-kind="song"] [data-keep]', { timeout: 30000 });
        await page.waitForTimeout(800);
        const atTap = await page.evaluate(() => document.getElementById('media-player').currentTime);
        await page.click('.feed-card[data-kind="song"] [data-keep]');
        await page.waitForFunction(() => /^\/music/.test(window.location.pathname), null, { timeout: 15000 });
        await page.waitForTimeout(2500);
        const onMusic = await page.evaluate(() => { const v = document.getElementById('media-player'); return { path: window.location.pathname + window.location.search, id: window.FileTube.player.currentId, t: v.currentTime, paused: v.paused, players: document.querySelectorAll('#player-wrapper').length }; });
        const feedPlaysBeforeTap = plays.filter((p) => JSON.parse(p.body).id === 'trk1').length;
        row.B = { start, atTap, onMusic, feedPlays: feedPlaysBeforeTap, errors: errors.slice() };
        row.B.pass = atTap >= 40 && onMusic.id === 'trk1' && onMusic.paused === false && onMusic.players === 1 && onMusic.t >= atTap - 0.5 && onMusic.t < atTap + 6 && errors.length === 0;
      }
      await browser.close();
    }
    row.pass = !!(row.A && row.A.pass && row.B && row.B.pass);
    results.push(row);
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${engine.padEnd(8)} ${JSON.stringify(row)}`);
  }
  const fails = results.filter((r) => !r.pass).length;
  console.log(`SUMMARY song-reels: ${results.length - fails}/${results.length} pass (${ENGINES.join('+')})`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  listening.closeAllConnections?.();
  await new Promise((resolve) => listening.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
