'use strict';
/* global window, document, getComputedStyle, history, location */
// v1.362 W1: the real pull-down end to end in Chromium (iPhone 13, raw CDP touch) on the branch's product code:
// cancelability per move, the picture following the finger, the release (dock or spring back), the landing
// (M7: the last browse page) and playback across it. Not a CI gate.
//   node tools/minimize-proof/probe-pull.js out.json
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

async function page(browser, s) {
  const ctx = await browser.newContext(Object.assign({}, pw.devices['iPhone 13'], { hasTouch: true }));
  await ctx.addCookies([s.cookie]);
  await ctx.route('**/api/settings', async (route) => { const r = await route.fetch(); let j = {}; try { j = await r.json(); } catch { /* */ } j.mobileCustomPlayer = true; await route.fulfill({ response: r, json: j }); });
  const p = await ctx.newPage();
  p.__errs = []; p.on('pageerror', (e) => p.__errs.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  p.touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  return { ctx, p };
}
async function playMuted(p) {
  await p.waitForTimeout(900);
  await p.evaluate(() => { const v = document.getElementById('media-player'); v.muted = true; return v.play(); });
  await p.waitForTimeout(400);
}
const facts = (p) => p.evaluate(() => {
  const v = document.getElementById('media-player'); const h = document.getElementById('player-wrapper');
  return { path: location.pathname + location.search, state: window.FileTube.player.getState(), src: (v.currentSrc || '').replace(/^https?:\/\/[^/]+/, ''), paused: v.paused, t: Math.round(v.currentTime * 10) / 10, parent: h.parentNode && (h.parentNode.id || h.parentNode.className), depth: history.state && history.state.depth, browseDepth: history.state && history.state.browseDepth, transform: h.style.transform, scrollY: window.scrollY };
});

async function flow(browser, s, o) {
  const { ctx, p } = await page(browser, s);
  const log = [];
  if (o.deep) {
    await p.goto(s.base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
  } else {
    await p.goto(s.base + '/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(400);
    if (o.viaClip2) { await p.evaluate(() => window.FileTube.navigate('/watch.html?v=clip2')); await playMuted(p); }
    await p.evaluate(() => window.FileTube.navigate('/watch.html?v=clip1'));
  }
  await playMuted(p);
  if (o.scrollY) { await p.evaluate((y) => window.scrollTo(0, y), o.scrollY); await p.waitForTimeout(200); }
  const dockCss = await p.evaluate(() => { const cs = getComputedStyle(document.getElementById('player-dock')); return { width: cs.width, right: cs.right, bottom: cs.bottom, sizeTouch: cs.getPropertyValue('--size-touch') }; });
  log.push(['before', await facts(p)]);
  await p.evaluate(() => {
    window.__tm = [];
    window.addEventListener('touchmove', (e) => { const h = document.getElementById('player-wrapper'); window.__tm.push([e.cancelable ? 1 : 0, e.defaultPrevented ? 1 : 0, Math.round(e.touches[0].clientY), Math.round(window.scrollY), h.style.transform ? 1 : 0]); }, { passive: true });
  });
  const r = await p.evaluate(() => { const r = document.getElementById('media-player').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const x = r.x + r.w / 2, y0 = r.y + r.h / 2;
  await p.touch('touchStart', x, y0);
  const steps = Math.round(o.dy / 10);
  for (let i = 1; i <= steps; i++) { await p.touch('touchMove', x, y0 + i * 10); await p.waitForTimeout(o.stepMs || 30); }
  const mid = await facts(p);
  await p.touch('touchEnd');
  await p.waitForTimeout(150);
  log.push(['at150ms', await facts(p)]);
  await p.waitForTimeout(1500);
  log.push(['at1650ms', await facts(p)]);
  await p.waitForTimeout(2000);
  log.push(['at3650ms', await facts(p)]);
  const tm = await p.evaluate(() => window.__tm);
  const errs = p.__errs;
  await ctx.close();
  return { label: o.label, dockCss, midDrag: { transform: mid.transform }, moves: tm.length, cancelable: tm.filter((m) => m[0]).length, prevented: tm.filter((m) => m[1]).length, movedPicture: tm.filter((m) => m[4]).length, log, errs };
}

(async () => {
  const out = { runAt: new Date().toISOString(), runs: [] };
  const s = await start({ seconds: 60 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const flows = [
    { label: 'home > clip1, pull 250 (dock)', dy: 250 },
    { label: 'home > clip2 > clip1, pull 250 (dock, land on home past clip2)', dy: 250, viaClip2: true },
    { label: 'deep link clip1, pull 250 (dock, fresh Home)', dy: 250, deep: true },
    { label: 'home > clip1, pull 60 slow (spring back)', dy: 60, stepMs: 60 },
    { label: 'home > clip1, scrolled 40, pull 250 (R2b: scrolls, no minimize)', dy: 250, scrollY: 40 },
  ];
  for (const o of flows) { try { out.runs.push(await flow(browser, s, o)); } catch (e) { out.runs.push({ label: o.label, error: String(e.stack || e) }); } }
  await browser.close(); await s.stop();
  fs.writeFileSync(process.argv[2] || 'probe-pull.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})();
