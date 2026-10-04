'use strict';
/* global window, document, getComputedStyle, location */
// v1.362 W3: the look, for Dean, before the gate. Headless Chromium, iPhone 13, single-thread raster. Shots:
// the inline picture with the chevron in every era x light/dark, the pull held at p 0.3 and 0.7, the docked
// result, and the mini player with its hit boxes outlined (an overlay drawn only here). `--only-mini` shoots just
// the mini player (run from a main sandbox for the BEFORE). Not a CI gate.
//   node tools/minimize-proof/shots.js <outDir> [--only-mini]
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const ERAS = ['2005', '2009', '2014', '2021']; // common.js THEME_REGISTRY ids (2021 = Modern)
const outDir = process.argv[2];
const onlyMini = process.argv.includes('--only-mini');
fs.mkdirSync(outDir, { recursive: true });

async function page(browser, s, era, mode) {
  const ctx = await browser.newContext(Object.assign({}, pw.devices['iPhone 13'], { hasTouch: true }));
  await ctx.addCookies([s.cookie]);
  await ctx.addInitScript(([e, m]) => { try { localStorage.setItem('ft-era', e); localStorage.setItem('ft-mode', m); } catch { /* storage off */ } }, [era, mode]);
  // The server's synced prefs would override the seeded era (prefs-sync.js): keep them out of the shots.
  await ctx.route('**/api/prefs', (route) => route.fulfill({ status: 200, json: {} }));
  // The proof server remembers the other shots' sessions, so the device-handoff card ("Continue here") would cover
  // the mini player: no other device in the shots.
  await ctx.route('**/api/handoff*', (route) => route.fulfill({ status: 204, body: '' }));
  await ctx.route('**/api/settings', async (route) => { const r = await route.fetch(); let j = {}; try { j = await r.json(); } catch { /* */ } j.mobileCustomPlayer = true; await route.fulfill({ response: r, json: j }); });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  p.touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  p.shot = async (name, clip) => {
    const r = await cdp.send('Page.captureScreenshot', Object.assign({ format: 'png' }, clip ? { clip: Object.assign({ scale: 1 }, clip) } : {}));
    fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  return { ctx, p };
}
// A still picture: the clip is paused on a frame, so every shot of one tree is the same.
async function openWatch(p, base) {
  await p.goto(base + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => window.FileTube.navigate('/watch.html?v=clip1'));
  await p.waitForTimeout(1200);
  await p.evaluate(async () => { const v = document.getElementById('media-player'); v.muted = true; await v.play(); v.currentTime = 4; await new Promise((r) => setTimeout(r, 300)); v.pause(); });
  await p.waitForTimeout(400);
  return p.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), mode: document.documentElement.getAttribute('data-mode') }));
}
async function outlineMini(p) {
  return p.evaluate(() => {
    const add = (r, colour) => { const d = document.createElement('div'); Object.assign(d.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', outline: '2px solid ' + colour, zIndex: 99999, pointerEvents: 'none' }); document.body.appendChild(d); };
    const x = document.querySelector('.player-dock-close').getBoundingClientRect();
    const pp = document.querySelector('#player-dock #pp-btn');
    const ppr = pp.getBoundingClientRect();
    const ring = getComputedStyle(pp, '::after').content !== 'none' && getComputedStyle(pp, '::after').position === 'absolute';
    const inset = ring ? (ppr.width - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--size-touch'))) / 2 : 0;
    add(x, '#00e5ff');
    add({ left: ppr.left + inset, top: ppr.top + inset, width: ppr.width - 2 * inset, height: ppr.height - 2 * inset }, '#ff3d00');
    const d = document.getElementById('player-dock').getBoundingClientRect();
    return { dock: [d.left, d.top, d.width, d.height] };
  });
}

(async () => {
  const s = await start({ seconds: 60 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-gpu-rasterization', '--num-raster-threads=1', '--use-angle=swiftshader'] });
  const log = {};
  try {
    if (!onlyMini) {
      for (const era of ERAS) {
        for (const mode of ['light', 'dark']) {
          const { ctx, p } = await page(browser, s, era, mode);
          log['inline-' + era + '-' + mode] = await openWatch(p, s.base);
          await p.shot('inline-' + era + '-' + mode, { x: 0, y: 0, width: 390, height: 360 });
          await ctx.close();
        }
      }
      const { ctx, p } = await page(browser, s, '2021', 'light');
      await openWatch(p, s.base);
      const g = await p.evaluate(() => { const h = document.getElementById('player-wrapper').getBoundingClientRect(); const v = document.getElementById('media-player').getBoundingClientRect(); return { top: h.top, x: v.x + v.width / 2, y: v.y + v.height / 2 }; });
      const travel = (664 - 80 - 134) - g.top; // the dock's top (probe-targets: y 450) minus the host's top
      await p.touch('touchStart', g.x, g.y);
      let dy = 0;
      for (const [label, frac] of [['drag-p03', 0.3], ['drag-p07', 0.7]]) {
        const to = Math.round(travel * frac);
        while (dy < to) { dy = Math.min(to, dy + 10); await p.touch('touchMove', g.x, g.y + dy); await p.waitForTimeout(16); }
        await p.waitForTimeout(150);
        log[label] = await p.evaluate(() => document.getElementById('player-wrapper').style.transform);
        await p.shot(label);
      }
      await p.touch('touchEnd');
      await p.waitForTimeout(1500);
      log.docked = await p.evaluate(() => ({ path: location.pathname, state: window.FileTube.player.getState() }));
      await p.shot('docked');
      await ctx.close();
    }
    const { ctx, p } = await page(browser, s, '2021', 'light');
    await openWatch(p, s.base);
    await p.evaluate(() => window.FileTube.navigate('/'));
    await p.waitForTimeout(1500);
    const o = await outlineMini(p);
    log.mini = o;
    await p.shot('mini', { x: o.dock[0] - 12, y: o.dock[1] - 12, width: o.dock[2] + 24, height: o.dock[3] + 24 });
    await ctx.close();
  } catch (e) { log.error = String(e.stack || e); }
  await browser.close(); await s.stop();
  fs.writeFileSync(path.join(outDir, 'log.json'), JSON.stringify(log, null, 1));
  console.log(JSON.stringify(log));
  process.exit(0);
})();
