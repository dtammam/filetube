'use strict';
/* global window, document */
// v1.390.0 W3/W4: the real drag end to end in Chromium (raw CDP touch, 844x390 sideways phone, 667x375 narrow, portrait
// 390x844 and a desktop) on the tree's product code: is the move cancelable, does the page follow the finger, is there a
// glide after a flick, does a tap still pause. Prints one JSON line per case. Not a CI gate.
//   node tools/landscape-scroll-proof/probe-drag.js
const path = require('node:path');
const { start } = require('../minimize-proof/serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

async function open(browser, s, vp, phone) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, screen: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone });
  await ctx.addCookies([s.cookie]);
  await ctx.route('**/api/settings', async (route) => { const r = await route.fetch(); let j = {}; try { j = await r.json(); } catch { /* */ } j.mobileCustomPlayer = true; await route.fulfill({ response: r, json: j }); });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  // CDP round trips cost ~65 ms each, which is not a finger; the event clock is set explicitly so a flick can be 10 ms per move
  p.touch = (type, x, y, at) => cdp.send('Input.dispatchTouchEvent', Object.assign({ type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] }, at ? { timestamp: at / 1000 } : {}));
  await p.goto(s.base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  if (await p.evaluate(() => document.getElementById('player-wrapper').classList.contains('css-fullscreen'))) { await p.evaluate(() => document.getElementById('fs-btn').click()); await p.waitForTimeout(600); }
  await p.evaluate(() => { const v = document.getElementById('media-player'); v.muted = true; return v.play(); });
  await p.waitForTimeout(400);
  return { ctx, p };
}
const sy = (p) => p.evaluate(() => window.scrollY);

async function run(browser, s, label, vp, phone, o) {
  const { ctx, p } = await open(browser, s, vp, phone);
  if (o.scrollY) { await p.evaluate((y) => window.scrollTo(0, y), o.scrollY); await p.waitForTimeout(200); }
  await p.evaluate(() => {
    window.__tm = [];
    window.addEventListener('touchend', (e) => { window.__te = [e.changedTouches.length, e.changedTouches[0] && Math.round(e.changedTouches[0].clientY), Math.round(e.timeStamp), e.cancelable ? 1 : 0, e.defaultPrevented ? 1 : 0]; }, { passive: true });
    window.addEventListener('touchmove', (e) => { window.__tm.push([e.cancelable ? 1 : 0, e.defaultPrevented ? 1 : 0, Math.round(e.touches[0].clientY), Math.round(window.scrollY), Math.round(e.timeStamp)]); }, { passive: true });
  });
  const r = await p.evaluate(() => { const b = document.getElementById('media-player').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const x = r.x + r.w / 2, y0 = Math.min(r.y + r.h / 2, vp.h - 20);
  const before = await sy(p);
  const dir = o.dy < 0 ? -1 : 1;
  let clock = Date.now();
  await p.touch('touchStart', x, y0, clock);
  const px = o.stepPx || 10;
  const steps = Math.round(Math.abs(o.dy) / px);
  for (let i = 1; i <= steps; i++) { clock += o.stepMs; await p.touch('touchMove', x, y0 + dir * i * px, clock); }
  clock += o.restMs || 10; // a flick lifts 10 ms after its last move; a slow drag rests first
  await p.touch('touchEnd', 0, 0, clock);
  const atLift = await sy(p);
  const samples = [];
  for (let i = 0; i < 6; i++) { await p.waitForTimeout(60); samples.push(await sy(p)); }
  await p.waitForTimeout(1500);
  const settled = await sy(p);
  const facts = await p.evaluate(() => ({ paused: document.getElementById('media-player').paused, state: window.FileTube.player.getState(), tm: window.__tm, te: window.__te }));
  const moves = facts.tm;
  console.log(JSON.stringify({
    label, vp: vp.w + 'x' + vp.h, scrollBefore: before, scrollAtLift: atLift, afterLift: samples, settled,
    glided: settled - atLift, moves: moves.length, cancelable: moves.filter((m) => m[0]).length, prevented: moves.filter((m) => m[1]).length,
    paused: facts.paused, state: facts.state, lastStamps: moves.slice(-4).map((m) => m[4]), touchend: facts.te,
  }));
  await ctx.close();
}

(async () => {
  const s = await start({ seconds: 20 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const side = { w: 844, h: 390 };
  await run(browser, s, 'sideways, up 200 slow', side, true, { dy: -200, stepMs: 40, restMs: 300 });
  await run(browser, s, 'sideways, up 200 flick', side, true, { dy: -200, stepMs: 10, stepPx: 20 });
  await run(browser, s, 'sideways, scrolled 100, down 100 slow', side, true, { dy: 100, stepMs: 40, restMs: 300, scrollY: 100 });
  await run(browser, s, 'narrow sideways 667x375, down 200 at the top (minimize)', { w: 667, h: 375 }, true, { dy: 200, stepMs: 40, restMs: 300 });
  await run(browser, s, 'portrait, up 200 slow', { w: 390, h: 844 }, true, { dy: -200, stepMs: 40, restMs: 300 });
  await run(browser, s, 'desktop, up 200 slow (mouse-less touch)', { w: 1280, h: 800 }, false, { dy: -200, stepMs: 40, restMs: 300 });
  await browser.close();
  await s.stop();
})().catch((e) => { console.error(e); process.exit(1); });
