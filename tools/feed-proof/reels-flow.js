'use strict';
/* global document, window, HTMLMediaElement, MutationObserver */
// v1.383.0 Feed reels and speed (plan docs/exec-plans/active/2026-10-10-feed-reels.md W2: K1, K2, K4) END TO END in a real browser
// against the real server, on the shared fixture (tools/feed-proof/fixture.js: two videos, an episode, a reading book, a new book
// and a liked song, real media files).
//
// What it measures, per engine:
//   K2 c  AUTOPLAY after the session's first gesture: the only activation is ONE real click on "10 min"; every later card is
//         reached by the mouse WHEEL (not an activation-triggering input) and must start on its own, with sound (muted false).
//         An init script records every play() call's outcome (resolved / the rejection's name), every 'playing' event and how
//         many media elements were playing at that moment. NOTHING reads the page until the flow is over: Playwright's
//         page.evaluate can itself grant the activation under test (LESSONS 2, v1.352).
//   K2 a  WARMING: every request carrying the warm range (bytes=0-262143) is the media of the card right after the card that
//         was active when it was asked for (one ahead, never two), and no warmed card is loaded into the player early.
//   K1    AUTO-ADVANCE: the active media card is sent to its slice's end; within 3 s the next card is active without input.
//   K4    the active card's TITLE tapped mid-slice opens the full item, the shared player carried over still playing.
// Chromium runs with --autoplay-policy=user-gesture-required (the phone's rule); WebKit with its default policy.
//
//   node tools/feed-proof/reels-flow.js <repoRoot> [out.json] [chromium|webkit|both]
// Not a CI gate: a proof tool.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT = process.argv[3] || null;
const ENGINES = (process.argv[4] || 'both') === 'both' ? ['chromium', 'webkit'] : [process.argv[4]];
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedreels-proof-'));
process.env.PROGRESS_FLUSH_MS = '50';

const { seed, seedUser } = require('./fixture');
const pw = require(require.resolve('playwright', { paths: [path.join(REPO, 'tools/capture'), '/home/coder/projects/filetube/tools/capture'] }));
const WARM_RANGE = 'bytes=0-262143';

// installed before any page script: the play() / playing / pointer record the proof reads ONCE, at the end
function recorder() {
  const log = [];
  window.__reelsLog = log;
  const now = () => Math.round(performance.now());
  const playingCount = () => Array.prototype.filter.call(document.querySelectorAll('video, audio'), (m) => !m.paused && !m.ended).length;
  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const el = this;
    const entry = { ev: 'play()', at: now(), id: el.id, src: el.currentSrc || el.src || '', muted: el.muted };
    log.push(entry);
    let p;
    try { p = realPlay.apply(this, arguments); } catch (e) { entry.result = 'threw ' + (e && e.name); throw e; }
    if (p && typeof p.then === 'function') p.then(() => { entry.result = 'resolved'; }, (e) => { entry.result = 'rejected ' + (e && e.name); });
    return p;
  };
  document.addEventListener('playing', (e) => { log.push({ ev: 'playing', at: now(), id: e.target.id, src: e.target.currentSrc || '', muted: e.target.muted, volume: e.target.volume, playingNow: playingCount() }); }, true);
  document.addEventListener('pointerdown', () => { log.push({ ev: 'pointerdown', at: now() }); }, true);
  const mark = () => {
    const a = document.querySelector('.feed-card[data-active]');
    const id = a ? a.getAttribute('data-id') + '|' + a.getAttribute('data-kind') : '';
    if (id && (!log.lastActive || log.lastActive !== id)) { log.lastActive = id; log.push({ ev: 'active', at: now(), card: id }); }
  };
  new MutationObserver(mark).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-active'] });
}

async function main() {
  const server = require(path.join(REPO, 'server.js'));
  const { app, __mintTestSession } = server;
  const helper = await pw.chromium.launch();
  const fx = await seed(server, helper, REPO);
  await helper.close();
  const listening = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${listening.address().port}`;
  const results = [];

  for (const engine of ENGINES) {
    const { cookie, user } = __mintTestSession({ username: 'reels-' + engine, role: 'admin' });
    seedUser(server, user, fx);
    const browser = await pw[engine].launch({ args: engine === 'chromium' ? ['--autoplay-policy=user-gesture-required'] : [] });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1].split(';')[0], url: base }]);
    await ctx.addInitScript(recorder);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message)));
    const net = [];
    const t0 = Date.now();
    page.on('request', (rq) => {
      const u = rq.url().replace(base, '');
      if (/^\/(video|episode|track)\//.test(u)) net.push({ at: Date.now() - t0, url: u.split('?')[0], range: rq.headers().range || '' });
    });
    await page.goto(`${base}/feed`, { waitUntil: 'load' });
    await page.waitForSelector('#feed-picker-choices button[data-minutes="10"]', { timeout: 15000 });
    await page.waitForTimeout(500);
    // the session's FIRST gesture: one real click
    await page.click('#feed-picker-choices button[data-minutes="10"]');
    await page.waitForTimeout(4000);
    await page.mouse.move(195, 420);
    // every later card by the wheel only (no activation): six cards
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 844); await page.waitForTimeout(3200); }
    // ---- from here the page may be read (the autoplay measurement is over) ----
    const flow = await page.evaluate(() => ({
      log: window.__reelsLog.slice(),
      order: Array.prototype.map.call(document.querySelectorAll('.feed-card'), (n) => ({ id: n.getAttribute('data-id'), kind: n.getAttribute('data-kind') })),
      refused: !!(window.FileTube.player && window.FileTube.player.autoStartRefused && window.FileTube.player.autoStartRefused()),
    }));
    // K1: back to the first video card, send it to its slice's end, and wait (no input)
    const advance = await (async () => {
      const ok = await page.evaluate(() => { const c = document.querySelector('.feed-card[data-kind="video"]'); if (!c) return false; c.scrollIntoView({ block: 'start' }); return true; });
      if (!ok) return { skipped: 'no video card' };
      await page.waitForTimeout(2500);
      const before = await page.evaluate(() => { const a = document.querySelector('.feed-card[data-active]'); return a ? Number(a.getAttribute('data-index')) : -1; });
      // the slice's end: the fixture's videos are 60 s and the first one's 60 s reel from its 6 s place is cut at the file's end
      // (60 s); the generated WebM may not report a duration, so the known end is used. Seek just short of it.
      const dbg = await page.evaluate(() => { const v = document.getElementById('media-player'); const d = { duration: v.duration, t: v.currentTime, left: (document.querySelector('.feed-card[data-active] [data-left]') || {}).textContent }; v.currentTime = 59.2; if (v.paused) v.play().catch(() => {}); return d; });
      await page.waitForFunction(() => !!document.querySelector('.feed-card[data-active] [data-advance]'), null, { timeout: 8000 }).catch(() => {});
      const countdown = await page.evaluate(() => { const b = document.querySelector('.feed-card[data-active] [data-advance]'); return b ? b.textContent.trim() : ''; });
      const dbg2 = await page.evaluate(() => { const v = document.getElementById('media-player'); const a = document.querySelector('.feed-card[data-active]'); return { id: a && a.getAttribute('data-id'), idx: a && a.getAttribute('data-index'), done: a && a.hasAttribute('data-done'), stay: a && a.hasAttribute('data-advance-stay'), inCard: !!(a && a.contains(v)), t: v.currentTime, paused: v.paused, ended: v.ended, left: (a && a.querySelector('[data-left]') || {}).textContent }; });
      await page.waitForTimeout(3000);
      const after = await page.evaluate(() => { const a = document.querySelector('.feed-card[data-active]'); return a ? Number(a.getAttribute('data-index')) : -1; });
      return { before, countdown, after, dbg, dbg2 };
    })();
    // K4: the active media card's title, tapped mid-slice
    const openFull = await (async () => {
      const target = await page.evaluate(() => {
        const c = Array.prototype.find.call(document.querySelectorAll('.feed-card'), (n) => n.getAttribute('data-kind') === 'podcast' || n.getAttribute('data-kind') === 'video');
        if (!c) return null; c.scrollIntoView({ block: 'start' }); return c.getAttribute('data-id');
      });
      if (!target) return { skipped: 'no media card' };
      await page.waitForTimeout(2500);
      await page.click(`.feed-card[data-id="${target}"] .feed-card__title`);
      await page.waitForTimeout(2500);
      return page.evaluate(() => { const v = document.getElementById('media-player'); return { path: window.location.pathname + window.location.search, playing: !!v && !v.paused, players: document.querySelectorAll('#player-wrapper').length }; });
    })();
    await browser.close();

    // ---- judge ----
    const log = flow.log;
    const click = log.find((e) => e.ev === 'pointerdown');
    const plays = log.filter((e) => e.ev === 'play()');
    const beforeClick = plays.filter((e) => !click || e.at < click.at);
    const actives = log.filter((e) => e.ev === 'active');
    const mediaActives = actives.filter((a) => !/\|(book|notice)$/.test(a.card));
    const playings = log.filter((e) => e.ev === 'playing');
    // each media card that was active: did a 'playing' with sound follow before the next card became active?
    const perCard = mediaActives.map((a) => {
      const next = actives.find((b) => b.at > a.at);
      const p = playings.find((e) => e.at >= a.at && (!next || e.at < next.at));
      const refused = plays.filter((e) => e.at >= a.at && (!next || e.at < next.at) && /rejected|threw/.test(e.result || '')).map((e) => e.result);
      return { card: a.card, played: !!p, muted: p ? p.muted : null, refused };
    });
    const maxPlaying = playings.reduce((m, e) => Math.max(m, e.playingNow), 0);
    // warming: each warm request names the card right after the one active when it was asked for
    const streamOf = (c) => (c.kind === 'song' ? '/track/' + c.id : c.kind === 'podcast' ? '/episode/' + c.id : (c.kind === 'video' || c.kind === 'watchlater') ? '/video/' + c.id : '');
    const warms = net.filter((n) => n.range === WARM_RANGE);
    const warmOk = warms.every((w) => flow.order.some((c, i) => streamOf(c) === w.url && i > 0)) && warms.length <= actives.length;
    // each card once: a URL is never warmed more times than the stack holds cards with that stream (a recycled stack holds the
    // same item twice, each its own card)
    const onceEach = warms.every((w) => warms.filter((x) => x.url === w.url).length <= flow.order.filter((c) => streamOf(c) === w.url).length);
    const pass = errors.length === 0 && beforeClick.length === 0 && perCard.length >= 2 && perCard.every((c) => c.played && c.muted === false && !c.refused.length)
      && maxPlaying <= 1 && warms.length >= 1 && warmOk && onceEach
      && advance.after === advance.before + 1 && /Next in/.test(advance.countdown || '')
      && openFull.playing === true && openFull.players === 1 && /^\/(watch\.html|podcasts)/.test(openFull.path || '');
    const row = { engine, perCard, playsBeforeFirstGesture: beforeClick.length, maxPlayingAtOnce: maxPlaying, refusedFlag: flow.refused, warms, advance, openFull, order: flow.order.map((c) => c.kind + ':' + c.id), errors, pass };
    results.push(row);
    console.log(`${pass ? 'PASS' : 'FAIL'} ${engine.padEnd(8)} ${JSON.stringify(row)}`);
  }
  const fails = results.filter((r) => !r.pass).length;
  console.log(`SUMMARY reels-flow: ${results.length - fails}/${results.length} pass (${ENGINES.join('+')})`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  listening.closeAllConnections?.();
  await new Promise((resolve) => listening.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
