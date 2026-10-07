'use strict';
/* global window, document, getComputedStyle */
// REAL-BROWSER PROBE (the iPod portrait lock, plan docs/exec-plans/completed/2026-10-07-ipod-portrait-lock.md, W0/W1).
// Not a CI gate.
//   node tools/pocket-proof/upright-probe.js [repoRoot] [outDir] [skin] [setting]
// A fresh seeded fixture server (test/visual/server.js), Chromium with an iPhone UA at 390x844, the iPod opened with a
// song playing (Now Playing), then the SCREEN turned through CDP Emulation.setDeviceMetricsOverride (portrait angle 0,
// landscape angle 90, landscape angle 270) - the same angle the device reports through screen.orientation. For each state
// it prints the stamped html[data-ft-rot], the full player's own box and transform, and the screen boxes of the LCD, the
// wheel, the centre button, MENU and play, plus a screenshot. `setting`: 'upright' (default, no pref) or 'sideways'
// (ft-pocket-sideways = '1').
const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const REPO = process.argv[2] || path.join(__dirname, '..', '..');
const OUT = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'upright-'));
const SKIN = process.argv[4] || 'ipod';
const SETTING = process.argv[5] || 'upright';
const { chromium } = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));
const { seed, boot } = require(path.join(REPO, 'test/visual/server.js'));
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upright-fx-'));
  const FX = seed(dir); const srv = await boot(dir); const base = srv.base;
  const browser = await chromium.launch();
  const result = { skin: SKIN, setting: SETTING, states: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IOS_UA });
    await ctx.addInitScript(([skin, sideways]) => {
      localStorage.setItem('ft-music-skin', skin); localStorage.setItem('ft-pocket-lighting', 'off');
      localStorage.setItem('ft-bottomnav', JSON.stringify({ shown: ['music'] }));
      if (sideways) localStorage.setItem('ft-pocket-sideways', '1');
    }, [SKIN, SETTING === 'sideways']);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
    await page.goto(base + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-username, input[name="username"], input[type="text"]', FX.user);
    await page.fill('#login-password, input[name="password"], input[type="password"]', FX.password);
    await page.click('button[type="submit"], .login-submit');
    await page.waitForURL((u) => !String(u).includes('login'), { timeout: 10000 });
    const pocketStyle = /^ipod/.test(SKIN);
    if (!pocketStyle) {
      // Cider / Nordic: no iPod menus; /music?play=<id> opens the full player on a song (scripts/pocket-render-probe.js's way)
      await page.goto(base + '/music', { waitUntil: 'networkidle' });
      const id = await page.evaluate(async () => { const r = await fetch('/api/music'); const j = await r.json(); const a = Array.isArray(j) ? j : (j.items || j.tracks || []); return a[0] && a[0].id; });
      await page.goto(base + '/music?play=' + encodeURIComponent(id), { waitUntil: 'networkidle' });
      await sleep(2500);
    } else {
      await page.goto(base + '/music?pocket=1', { waitUntil: 'networkidle' });
      await sleep(1500);
    }
    // pick the first song: Music > Songs > first row (Now Playing)
    const tapLbl = async (l) => { await page.locator('#music-nowplaying-panel .ipm-row', { has: page.locator('.ipm-lbl', { hasText: new RegExp('^' + l + '$') }) }).first().tap(); await sleep(900); };
    if (pocketStyle) try { await tapLbl('Music'); await tapLbl('Songs'); await page.locator('#music-nowplaying-panel .ipm-row:not(.ipm-skel)').first().tap(); await sleep(2500); } catch (e) { result.pickError = String(e.message); }
    const cdp = await ctx.newCDPSession(page);
    const states = [
      { name: 'portrait', w: 390, h: 844, type: 'portraitPrimary', angle: 0 },
      // the frame BEFORE the angle stamp lands (the media query says landscape, the angle still 0; gate r1 W1)
      { name: 'landscape-prestamp', w: 844, h: 390, type: 'landscapePrimary', angle: 0 },
      { name: 'landscape-90', w: 844, h: 390, type: 'landscapePrimary', angle: 90 },
      { name: 'landscape-270', w: 844, h: 390, type: 'landscapeSecondary', angle: 270 },
      { name: 'portrait-back', w: 390, h: 844, type: 'portraitPrimary', angle: 0 },
    ];
    for (const s of states) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: s.type, angle: s.angle } });
      await page.evaluate(() => { window.dispatchEvent(new Event('orientationchange')); window.dispatchEvent(new Event('resize')); });
      await sleep(900);
      const m = await page.evaluate(() => {
        const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
        const p = document.getElementById('music-nowplaying-panel');
        const q = (sel) => p && p.querySelector(sel);
        const cs = p ? getComputedStyle(p) : null;
        return {
          rot: document.documentElement.getAttribute('data-ft-rot'),
          classes: document.documentElement.className,
          inner: [window.innerWidth, window.innerHeight],
          full: !!(p && p.classList.contains('mms-full') && !p.hidden),
          panel: box(p), transform: cs && cs.transform, display: cs && cs.display, gridCols: cs && cs.gridTemplateColumns,
          lcd: box(q('.ip-lcd')), wheel: box(q('.ip-wheel')), center: box(q('.ip-center')),
          menu: box(q('[data-skin-menu]')), play: box(q('[data-skin-pp], [data-skin-play]')),
          ghost: box(document.querySelector('.mms-haptic-ghost')),
          np: !!q('.ip-np'),
          art: box(q('.mms-art')), ttl: box(q('.mms-ttl')), transport: box(q('.mms-transport')), scrub: box(q('.mms-scrub')),
        };
      });
      // CDP's own capture (Playwright's page.screenshot re-applies the context's portrait viewport first)
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `${SKIN}-${SETTING}-${s.name}.png`), Buffer.from(shot.data, 'base64'));
      result.states.push(Object.assign({ name: s.name }, m));
    }
    result.pageErrors = errs;
  } finally {
    await browser.close();
    await srv.stop();
  }
  console.log(JSON.stringify(result, null, 1));
  console.error('screenshots in ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
