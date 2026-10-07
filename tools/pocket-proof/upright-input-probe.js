'use strict';
/* global window, document, getComputedStyle, location */
// REAL-BROWSER PROBE (the iPod portrait lock, plan docs/exec-plans/completed/2026-10-07-ipod-portrait-lock.md, W2). Not a CI gate.
//   node tools/pocket-proof/upright-input-probe.js [repoRoot] [setting]
// Chromium (iPhone UA, touch) on a fresh seeded fixture server, the iPod (Classic 5G) with a song playing, the screen turned
// through CDP (angle 0, 90, 270). Under each turn, REAL touches through CDP Input.dispatchTouchEvent at points given in the
// iPod's OWN frame (mapped to the glass by the drawn turn), so the same physical gesture is driven in every orientation:
//   1. a clockwise three-quarter circle on the wheel ring, from the Main menu: how many rows the cursor moved (and which way);
//   2. a tap on MENU's zone (the ring's top) from Music: did it go back to the Main menu;
//   3. a tap 25% along the seek bar: the position it sought (as a fraction of the song);
//   4. a drag "up" (in the iPod's frame) on the open up-next list: how far the list scrolled;
//   5. a "down" then a "right" swipe (in the iPod's frame) across the LCD: which one the app's swipe-back took as a back.
// `setting`: 'upright' (default) or 'sideways'.
const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const REPO = process.argv[2] || path.join(__dirname, '..', '..');
const SETTING = process.argv[3] || 'upright';
const { chromium } = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));
const { seed, boot } = require(path.join(REPO, 'test/visual/server.js'));
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upright-in-'));
  const FX = seed(dir); const srv = await boot(dir); const base = srv.base;
  const browser = await chromium.launch();
  const out = { setting: SETTING, states: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IOS_UA });
    await ctx.addInitScript((sideways) => {
      localStorage.setItem('ft-music-skin', 'ipod'); localStorage.setItem('ft-pocket-lighting', 'off');
      localStorage.setItem('ft-bottomnav', JSON.stringify({ shown: ['music'] }));
      if (sideways) localStorage.setItem('ft-pocket-sideways', '1');
    }, SETTING === 'sideways');
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
    await page.goto(base + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-username, input[name="username"], input[type="text"]', FX.user);
    await page.fill('#login-password, input[name="password"], input[type="password"]', FX.password);
    await page.click('button[type="submit"], .login-submit');
    await page.waitForURL((u) => !String(u).includes('login'), { timeout: 10000 });
    await page.goto(base + '/music?pocket=1', { waitUntil: 'networkidle' });
    await sleep(1500);
    const cdp = await ctx.newCDPSession(page);
    const states = [
      { name: 'portrait', w: 390, h: 844, type: 'portraitPrimary', angle: 0 },
      { name: 'landscape-90', w: 844, h: 390, type: 'landscapePrimary', angle: 90 },
      { name: 'landscape-270', w: 844, h: 390, type: 'landscapeSecondary', angle: 270 },
    ];
    // the panel's own frame -> the glass: the panel's border box (offset size) about its screen centre, by its drawn turn
    const frame = () => page.evaluate(() => {
      const p = document.getElementById('music-nowplaying-panel');
      const r = p.getBoundingClientRect();
      const m = /^matrix\(([^)]+)\)$/.exec(getComputedStyle(p).transform || '');
      const v = m ? m[1].split(',').map(Number) : [1, 0, 0, 1];
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: p.offsetWidth, h: p.offsetHeight, a: v[0], b: v[1], c: v[2], d: v[3] };
    });
    const toGlass = (f, lx, ly) => { const dx = lx - f.w / 2, dy = ly - f.h / 2; return { x: f.cx + f.a * dx + f.c * dy, y: f.cy + f.b * dx + f.d * dy }; };
    // an element's centre / a point along it, in the panel's frame (offsetLeft/Top chains up to the panel)
    const local = (sel, fx = 0.5, fy = 0.5) => page.evaluate(([s, ax, ay]) => {
      const p = document.getElementById('music-nowplaying-panel');
      const el = p.querySelector(s);
      if (!el) return null;
      let x = 0, y = 0, n = el;
      while (n && n !== p) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      if (n !== p) return null;
      return { x: x + el.offsetWidth * ax, y: y + el.offsetHeight * ay, w: el.offsetWidth, h: el.offsetHeight };
    }, [sel, fx, fy]);
    const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: 1 })) });
    const tapAt = async (g) => { await touch('touchStart', [g]); await sleep(60); await touch('touchEnd', []); await sleep(500); };
    const drag = async (gs) => { await touch('touchStart', [gs[0]]); for (const g of gs.slice(1)) { await sleep(16); await touch('touchMove', [g]); } await sleep(30); await touch('touchEnd', []); await sleep(600); };
    const cursor = () => page.evaluate(() => { const c = document.querySelector('#music-nowplaying-panel .ipm-row.is-cursor .ipm-lbl'); return c ? c.textContent : null; });
    const rows = () => page.evaluate(() => [...document.querySelectorAll('#music-nowplaying-panel .ipm-row .ipm-lbl')].map((e) => e.textContent));
    for (const s of states) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: s.type, angle: s.angle } });
      // a fresh open in this orientation (the iPod's Main menu, cursor on Music): the player opened while already sideways
      await page.goto(base + '/music?pocket=1', { waitUntil: 'networkidle' });
      await sleep(1500);
      const r = { name: s.name, rot: await page.evaluate(() => document.documentElement.getAttribute('data-ft-rot')) };
      let f = await frame();
      const wheel = await local('.ip-wheel');
      r.mainRows = await rows();
      // 1. a clockwise 3/4 circle on the ring (radius 0.38 of the wheel), from 12 o'clock, in the iPod's frame
      const c0 = await cursor();
      const ring = [];
      for (let k = 0; k <= 36; k++) { const t = -Math.PI / 2 + (k / 36) * 1.5 * Math.PI; ring.push(toGlass(f, wheel.x + Math.cos(t) * wheel.w * 0.38, wheel.y + Math.sin(t) * wheel.w * 0.38)); }
      await drag(ring);
      const c1 = await cursor();
      r.wheel = { from: c0, to: c1, moved: r.mainRows.indexOf(c1) - r.mainRows.indexOf(c0) };
      // 2. MENU by its zone: drill into Music (a tap on its row), then tap the ring's top in the iPod's frame
      await page.locator('#music-nowplaying-panel .ipm-row', { has: page.locator('.ipm-lbl', { hasText: /^Music$/ }) }).first().click({ force: true }).catch(() => {});
      await sleep(600);
      f = await frame();
      const inMusic = await rows();
      await tapAt(toGlass(f, wheel.x, wheel.y - wheel.w * 0.40));
      const afterMenu = await rows();
      r.menuZone = { before: inMusic.slice(0, 3), after: afterMenu.slice(0, 3), backToMain: afterMenu.indexOf('Music') !== -1 && afterMenu.indexOf('Settings') !== -1 };
      // pick a song to get Now Playing: Music > Songs > first
      const tapLbl = async (l) => { await page.locator('#music-nowplaying-panel .ipm-row', { has: page.locator('.ipm-lbl', { hasText: new RegExp('^' + l + '$') }) }).first().click({ force: true }); await sleep(800); };
      try { await tapLbl('Music'); await tapLbl('Songs'); await page.locator('#music-nowplaying-panel .ipm-row:not(.ipm-skel)').first().click({ force: true }); await sleep(2000); } catch (e) { r.pickError = String(e.message).slice(0, 120); }
      // 3. a tap 25% along the seek bar
      f = await frame();
      const seek = await local('[data-skin-seek]', 0.25, 0.5);
      if (seek) {
        await page.evaluate(() => { const v = document.getElementById('media-player') || document.querySelector('audio, video'); if (v) v.pause(); });
        await tapAt(toGlass(f, seek.x, seek.y));
        r.seek = await page.evaluate(() => { const v = document.querySelector('#media-player, audio, video'); return v && v.duration ? Math.round((v.currentTime / v.duration) * 100) / 100 : null; });
      }
      // 4. the up-next list (Select on Now Playing), a drag UP in the iPod's frame
      await page.locator('#music-nowplaying-panel [data-skin-select]').click({ force: true }).catch(() => {});
      await sleep(700);
      f = await frame();
      const list = await local('.ip-listview');
      if (list && list.h > 40) {
        const st0 = await page.evaluate(() => { const l = document.querySelector('#music-nowplaying-panel .ip-listview'); return l ? l.scrollTop : null; });
        const pts = []; for (let k = 0; k <= 12; k++) pts.push(toGlass(f, list.x, list.y + list.h * 0.3 - (k / 12) * list.h * 0.5));
        await drag(pts);
        const st1 = await page.evaluate(() => { const l = document.querySelector('#music-nowplaying-panel .ip-listview'); return l ? l.scrollTop : null; });
        r.listScroll = { from: st0, to: st1, overflow: await page.evaluate(() => { const l = document.querySelector('#music-nowplaying-panel .ip-listview'); return l ? l.scrollHeight - l.clientHeight : null; }) };
      } else r.listScroll = { skipped: 'no list (' + JSON.stringify(list) + ')' };
      // 5. a swipe RIGHT in the iPod's frame across the LCD, then a swipe DOWN: which one is a back
      const lcd = await local('.ip-lcd');
      const url0 = await page.evaluate(() => location.pathname + location.search);
      const sw = (dx, dy) => { const pts = []; for (let k = 0; k <= 12; k++) pts.push(toGlass(f, lcd.x - dx * 0.5 + (k / 12) * dx, lcd.y - dy * 0.5 + (k / 12) * dy)); return pts; };
      const backs = [];
      // the app's back only fires with history depth > 0 and then waits for a popstate: give it a depth, count the calls,
      // and swipe DOWN first (must be no back), then RIGHT (must be one)
      const onBack = await page.evaluate(() => {
        window.__backs = 0;
        window.history.replaceState(Object.assign({}, window.history.state || {}, { depth: 1 }), '');
        window.history.back = function () { window.__backs += 1; };
        return true;
      });
      await drag(sw(0, lcd.h * 0.8)); backs.push(await page.evaluate(() => window.__backs));
      await drag(sw(lcd.w * 0.8, 0)); backs.push(await page.evaluate(() => window.__backs));
      r.swipeBack = { stubbed: onBack, afterDown: backs[0], afterRight: backs[1] - backs[0], url: url0 };
      out.states.push(r);
    }
    out.pageErrors = errs;
  } finally {
    await browser.close();
    await srv.stop();
  }
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
