'use strict';
/* global window, document, getComputedStyle, location */
// v1.362 W2: plan section 3 item 1 AFTER (the docked X and play/pause hit boxes by elementFromPoint, same grid as
// probe-w0.js), the dock's tap-to-expand at the picture's centre, the chevron (rect, hit box, a real CDP tap), and
// the commit's settle animation actually running (the host's computed transform mid-settle). Chromium, iPhone 13.
//   node tools/minimize-proof/probe-targets.js out.json
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

async function page(browser, s, vp) {
  const ctx = await browser.newContext(Object.assign({}, pw.devices['iPhone 13'], { hasTouch: true }, vp || {}));
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

// The W0 grid: 31 x 31 points 2 px apart around each target's centre.
const GRID = () => {
  const r2 = (r) => ({ x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 });
  const out = {};
  const dock = document.getElementById('player-dock');
  const dr = dock.getBoundingClientRect();
  out.dock = r2(dr);
  for (const [k, sel] of [['close', '.player-dock-close'], ['pp', '#player-dock #pp-btn']]) {
    const b = document.querySelector(sel); const r = b.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    let hits = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, outside = 0;
    for (let dx = -30; dx <= 30; dx += 2) for (let dy = -30; dy <= 30; dy += 2) {
      const e = document.elementFromPoint(cx + dx, cy + dy);
      if (e && (e === b || b.contains(e))) {
        hits++; minX = Math.min(minX, dx); maxX = Math.max(maxX, dx); minY = Math.min(minY, dy); maxY = Math.max(maxY, dy);
        const px = cx + dx, py = cy + dy; if (px < dr.left || px > dr.right || py < dr.top || py > dr.bottom) outside++;
      }
    }
    out[k] = { faceRect: r2(r), gridPoints: 961, hits, hitSpanW: hits ? maxX - minX + 2 : 0, hitSpanH: hits ? maxY - minY + 2 : 0, hitPointsOutsideDock: outside };
  }
  const mid = document.elementFromPoint(dr.x + dr.width / 2, dr.y + (dr.width * 9 / 16) / 2);
  out.centreHit = mid ? (mid.id || mid.className) : null;
  return out;
};

(async () => {
  const out = { runAt: new Date().toISOString() };
  const s = await start({ seconds: 60 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    // 1. AFTER: docked on the phone (leave the watch page the ordinary way)
    let { ctx, p } = await page(browser, s);
    await p.goto(s.base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
    await playMuted(p);
    await p.evaluate(() => window.FileTube.navigate('/'));
    await p.waitForTimeout(1500);
    out.phoneDocked = await p.evaluate(GRID);
    await ctx.close();

    // 2. the desktop dock is unchanged (1280 x 800, no touch): face sizes only
    ({ ctx, p } = await page(browser, s, { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }));
    await p.goto(s.base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
    await playMuted(p);
    await p.evaluate(() => window.FileTube.navigate('/'));
    await p.waitForTimeout(1500);
    out.desktopDocked = await p.evaluate(() => {
      const q = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
      return { dock: q('#player-dock'), close: q('.player-dock-close'), pp: q('#player-dock #pp-btn'), bar: q('#player-dock .player-controls'), chevronShown: !!document.querySelector('.player-minimize:not([hidden])') };
    });
    await ctx.close();

    // 3. the chevron inline: rect, hit box, a real tap, the settle animation, the landing
    ({ ctx, p } = await page(browser, s));
    await p.goto(s.base + '/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(400);
    await p.evaluate(() => window.FileTube.navigate('/watch.html?v=clip1'));
    await playMuted(p);
    const chev = await p.evaluate(() => {
      const b = document.querySelector('.player-minimize'); const r = b.getBoundingClientRect(); const v = document.getElementById('media-player').getBoundingClientRect();
      let hits = 0; for (let dx = -30; dx <= 30; dx += 2) for (let dy = -30; dy <= 30; dy += 2) { const e = document.elementFromPoint(r.x + r.width / 2 + dx, r.y + r.height / 2 + dy); if (e && (e === b || b.contains(e))) hits++; }
      const cs = getComputedStyle(b);
      return { hidden: b.hidden, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], videoTop: Math.round(v.y), hits, centreIsChevron: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b || b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), filter: cs.filter, opacity: cs.opacity };
    });
    out.chevron = chev;
    await p.touch('touchStart', chev.rect[0] + chev.rect[2] / 2, chev.rect[1] + chev.rect[3] / 2);
    await p.touch('touchEnd');
    const settle = [];
    for (let i = 0; i < 6; i++) {
      await p.waitForTimeout(50);
      settle.push(await p.evaluate(() => { const h = document.getElementById('player-wrapper'); const d = document.getElementById('player-dock'); return { t: getComputedStyle(h).transform, hostCls: h.className, dockOverflow: getComputedStyle(d).overflow }; }));
    }
    out.settleAfterTap = settle;
    await p.waitForTimeout(1500);
    out.afterTap = await p.evaluate(() => { const v = document.getElementById('media-player'); const h = document.getElementById('player-wrapper'); const d = document.getElementById('player-dock'); return { path: location.pathname, state: window.FileTube.player.getState(), paused: v.paused, hostTransform: getComputedStyle(h).transform, hostCls: h.className, dockOverflow: getComputedStyle(d).overflow, chevronHidden: document.querySelector('.player-minimize').hidden }; });
    out.errs = p.__errs;
    await ctx.close();
  } catch (e) { out.error = String(e.stack || e); }
  await browser.close(); await s.stop();
  fs.writeFileSync(process.argv[2] || 'probe-targets.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})();
