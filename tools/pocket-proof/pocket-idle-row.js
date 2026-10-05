'use strict';
/* global window, document, location, getComputedStyle */
// REAL-BROWSER PROOF (v1.364.0 W2b): the iPod with no song, in two taps. Not a CI gate.
//   node tools/pocket-proof/pocket-idle-row.js [repoRoot] [screenshotDir]
// A fresh seeded fixture server (test/visual/server.js), Chromium with an iPhone UA, at 390x844 and
// 320x568: cold /, tap Music, tap Music -> the iPod on the Main menu (cursor on Music), no song loaded,
// ?pocket=1 stripped; MENU closes it back to browse; the toolbar iPod button reopens it; a song picked
// from Music > Songs plays in the iPod; then MENU climbs Now Playing > Songs > Music > Main and the
// 4th press docks the mini (a stale idle state costs a dead 5th press: that is what the count binds).
const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const REPO = process.argv[2] || path.join(__dirname, '..', '..');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));
const { seed, boot } = require(path.join(REPO, 'test/visual/server.js'));
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-idle-'));
  const FX = seed(dir); const srv = await boot(dir); const base = srv.base;
  const browser = await chromium.launch();
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails += 1; };
  try {
    for (const [w, h] of [[390, 844], [320, 568]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IOS_UA });
      await ctx.addInitScript(() => { localStorage.setItem('ft-music-skin', 'ipod'); localStorage.setItem('ft-pocket-lighting', 'off');
        localStorage.setItem('ft-bottomnav', JSON.stringify({ shown: ['music'] })); });
      const page = await ctx.newPage();
      const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
      await page.goto(base + '/login', { waitUntil: 'networkidle' });
      await page.fill('#login-username, input[name="username"], input[type="text"]', FX.user);
      await page.fill('#login-password, input[name="password"], input[type="password"]', FX.password);
      await page.click('button[type="submit"], .login-submit');
      await page.waitForURL((u) => !String(u).includes('login'), { timeout: 10000 });
      await page.goto(base + '/', { waitUntil: 'networkidle' });
      await sleep(800);
      const tab = page.locator('#bottom-nav [data-nav="music"]');
      ok(await tab.isVisible(), `${w}x${h} the Music tab shows (shown once in the bar)`);
      await tab.tap(); await page.waitForURL(/\/music$/, { timeout: 10000 }); await sleep(1200);
      ok(!(await page.locator('#music-nowplaying-panel.mms-full').isVisible()), `${w}x${h} tap 1: the music browse view (no iPod yet)`);
      await tab.tap(); await sleep(1800);
      const s = await page.evaluate(() => {
        const p = document.getElementById('music-nowplaying-panel');
        const cur = p && p.querySelector('.ipm-row.is-cursor .ipm-lbl');
        const pl = window.FileTube && window.FileTube.player;
        return { full: !!(p && p.classList.contains('mms-full') && !p.hidden), menu: !!(p && p.querySelector('.ip-lcd .ipm-row')), cursor: cur && cur.textContent,
          currentId: pl ? (pl.currentId || null) : 'no-player', url: location.pathname + location.search,
          labels: p ? [...p.querySelectorAll('.ipm-row .ipm-lbl')].map((e) => e.textContent) : [] };
      });
      ok(s.full, `${w}x${h} tap 2: .mms-full visible`);
      ok(s.menu && s.cursor === 'Music', `${w}x${h} the Main menu, cursor on Music (${s.cursor}; rows ${s.labels.join('/')})`);
      ok(!s.currentId, `${w}x${h} no song loaded (player currentId ${s.currentId})`);
      ok(s.url === '/music', `${w}x${h} the param was stripped (${s.url})`);
      await page.locator('#music-nowplaying-panel [data-skin-menu]').tap(); await sleep(800);
      const closed = await page.evaluate(() => { const p = document.getElementById('music-nowplaying-panel'); return !!p && p.hidden && !document.body.classList.contains('mms-on'); });
      ok(closed, `${w}x${h} MENU on the idle Main menu closes it back to browse`);
      const btn = page.locator('#music-pocket-btn');
      ok(await btn.isVisible(), `${w}x${h} the toolbar iPod button shows`);
      if (await btn.isVisible()) {
        await btn.tap(); await sleep(1000);
        const again = await page.evaluate(() => { const p = document.getElementById('music-nowplaying-panel'); const c = p.querySelector('.ipm-row.is-cursor .ipm-lbl'); return p.classList.contains('mms-full') && !p.hidden && c && c.textContent; });
        ok(again === 'Music', `${w}x${h} the toolbar button opens it on Main/Music (${again})`);
        // pick a song from the idle iPod: Music > Songs > first song plays and Now Playing shows
        const tapLbl = async (l) => { await page.locator('#music-nowplaying-panel .ipm-row', { has: page.locator('.ipm-lbl', { hasText: new RegExp('^' + l + '$') }) }).first().tap(); await sleep(900); };
        await tapLbl('Music'); await tapLbl('Songs');
        await page.locator('#music-nowplaying-panel .ipm-row:not(.ipm-skel)').first().tap(); await sleep(2500);
        const np = await page.evaluate(() => { const p = document.getElementById('music-nowplaying-panel'); const pl = window.FileTube.player; return { full: p.classList.contains('mms-full') && !p.hidden, cur: pl.currentId || null, menu: !!p.querySelector('.ip-lcd .ipm-row') && getComputedStyle(p.querySelector('.ip-npview')).display === 'none', ttl: (p.querySelector('.ip-ttl') || {}).textContent }; });
        ok(np.full && !!np.cur, `${w}x${h} a song picked from the idle iPod plays in the iPod (current ${np.cur}, title ${np.ttl}, menu-up ${np.menu})`);
        await page.screenshot({ path: path.join(process.argv[3] || os.tmpdir(), `pocket-idle-${w}x${h}-after-pick.png`) });
        // the song hands over: MENU (Now Playing -> the menu it came from), MENU up to Main, MENU docks the mini (pl.dock)
        const titles = [];
        for (let k = 0; k < 6; k++) {
          const t = await page.evaluate(() => { const p = document.getElementById('music-nowplaying-panel'); if (p.hidden || !p.classList.contains('mms-full')) return null; const np = p.querySelector('.ip-np'); return np ? np.textContent : '?'; });
          if (t === null) break;
          titles.push(t);
          await page.locator('#music-nowplaying-panel [data-skin-menu]').tap(); await sleep(700);
        }
        console.log('  MENU path: ' + titles.join(' > '));
        ok(titles.length === 4, `${w}x${h} 4 MENU presses from Now Playing to the mini (Now Playing > Songs > Music > Main), each one does something (${titles.length})`);
        const dk = await page.evaluate(() => { const pl = window.FileTube.player; const p = document.getElementById('music-nowplaying-panel'); return { state: pl.getState(), cur: pl.currentId || null, hidden: p.hidden }; });
        ok(dk.hidden && dk.state === 'docked' && !!dk.cur, `${w}x${h} with the song playing, MENU at the top docks it in the mini (state ${dk.state}, current ${dk.cur ? 'set' : 'none'})`);
      }
      ok(errs.length === 0, `${w}x${h} no page errors (${errs.join(' | ').slice(0, 200)})`);
      await ctx.close();
    }
  } finally { await browser.close(); await srv.stop(); }
  console.log('FAILS', fails);
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
