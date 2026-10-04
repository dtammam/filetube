'use strict';
/* global window, document, getComputedStyle, requestAnimationFrame */
// v1.362.4 (plan 2026-10-04-minimize-crossfade): the page under the video fades like YouTube's. Real Chromium, iPhone 13,
// dark mode, raw CDP touch, the custom-controls setting forced on. Samples the computed opacity of the content under the
// video (the title) and of the arriving page's #view-root through a slow pull, a commit and an expand, and the opacity of
// EVERY ancestor of #player-wrapper at each sample (must stay 1: LESSONS 7). Not a CI gate.
//   node tools/minimize-proof/probe-fade.js out.json
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

(async () => {
  const outFile = process.argv[2] || path.join(__dirname, 'probe-fade-result.json');
  const out = { runAt: new Date().toISOString(), rows: {} };
  const s = await start({ seconds: 60 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  try {
    const ctx = await browser.newContext(Object.assign({}, pw.devices['iPhone 13'], { hasTouch: true, colorScheme: 'dark' }));
    await ctx.addCookies([s.cookie]);
    await ctx.route('**/api/settings', async (route) => { const r = await route.fetch(); let j = {}; try { j = await r.json(); } catch { /* */ } j.mobileCustomPlayer = true; await route.fulfill({ response: r, json: j }); });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: (type === 'touchEnd' || type === 'touchCancel') ? [] : [{ x, y, id: 1 }] });
    await p.goto(s.base + '/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(400);
    await p.evaluate(() => window.FileTube.navigate('/watch.html?v=clip1'));
    await p.waitForTimeout(1200);
    await p.evaluate(() => { const v = document.getElementById('media-player'); v.muted = true; return v.play(); });
    await p.waitForTimeout(600);
    // A sampler in the page: every frame, the title's opacity (under the video), the root's view and opacity, and the
    // minimum opacity over every ancestor of the player host.
    await p.evaluate(() => {
      window.__fade = [];
      const t0 = performance.now();
      const tick = () => {
        const root = document.getElementById('view-root');
        const title = document.querySelector('#view-root[data-view="watch"] .watch-title');
        const host = document.getElementById('player-wrapper');
        let anc = 1;
        for (let n = host; n && n !== document.documentElement; n = n.parentElement) anc = Math.min(anc, Number(getComputedStyle(n).opacity));
        window.__fade.push({ t: Math.round(performance.now() - t0), view: root && root.getAttribute('data-view'), cls: root ? root.className : null, inDock: !!(document.getElementById('player-dock') && root && root.contains(document.getElementById('player-dock'))), root: root ? Number(getComputedStyle(root).opacity) : null,
          title: title ? Number(getComputedStyle(title).opacity) : null, ancMin: anc, state: window.FileTube.player.getState() });
        if (window.__fade.length < 2000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const geo = await p.evaluate(() => { const r = document.getElementById('media-player').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    // 1. A slow pull to ~half the travel, held; then let go (spring-back).
    let y = geo[1];
    await touch('touchStart', geo[0], y);
    for (let i = 0; i < 12; i++) { y += 10; await touch('touchMove', geo[0], y); await p.waitForTimeout(30); }
    await p.waitForTimeout(150);
    out.rows.midPull = await p.evaluate(() => window.__fade[window.__fade.length - 1]);
    await touch('touchEnd');
    await p.waitForTimeout(600);
    out.rows.afterSpringBack = await p.evaluate(() => window.__fade[window.__fade.length - 1]);
    // 2. A full pull: commit.
    const mark = await p.evaluate(() => window.__fade.length);
    y = geo[1];
    await touch('touchStart', geo[0], y);
    for (let i = 0; i < 30; i++) { y += 15; await touch('touchMove', geo[0], y); await p.waitForTimeout(16); }
    await touch('touchEnd');
    await p.waitForTimeout(1200);
    out.rows.commitSeries = await p.evaluate((m) => window.__fade.slice(m).filter((x, i) => i % 3 === 0).map((x) => [x.t, x.view, x.root, x.title, x.ancMin, x.state]), mark);
    out.rows.afterCommit = await p.evaluate(() => window.__fade[window.__fade.length - 1]);
    // 3. Expand: tap the mini player. The watch page is held 500 ms (a slow network, Dean's VPN) so the dim of the page
    // it leaves can be seen before the swap; on a fast local network the swap lands first.
    await ctx.route('**/watch.html*', async (route) => { await new Promise((r) => setTimeout(r, 500)); await route.continue(); });
    const mark2 = await p.evaluate(() => window.__fade.length);
    const db = await p.evaluate(() => { const r = document.getElementById('player-dock').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 3]; });
    await touch('touchStart', db[0], db[1]); await p.waitForTimeout(40); await touch('touchEnd');
    await p.waitForTimeout(1200);
    out.rows.expandSeries = await p.evaluate((m) => window.__fade.slice(m).filter((x, i) => i % 3 === 0).slice(0, 24).map((x) => [x.t, x.view, x.cls, x.root, x.title, x.ancMin, x.state]), mark2);
    out.rows.afterExpand = await p.evaluate(() => window.__fade[window.__fade.length - 1]);
    out.rows.ancestorMinOverall = await p.evaluate(() => Math.min.apply(null, window.__fade.map((x) => x.ancMin)));
    out.rows.mark = await p.evaluate(() => document.documentElement.getAttribute('data-ft-view-fade'));
  } catch (e) { out.error = String(e && e.stack || e); } finally {
    out.pageErrors = errs;
    await browser.close(); await s.stop();
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n');
    console.log(JSON.stringify(out));
  }
})();
