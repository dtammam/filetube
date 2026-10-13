'use strict';
/* global document, getComputedStyle, innerWidth, innerHeight */
// v1.390.0 M0/M1: the watch page's inline player geometry at a phone size (sideways, portrait) and desktop,
// from the real server. Not a CI gate.
//   FT_ROOT=<tree> node tools/landscape-scroll-proof/probe-geometry.js [WxH ...]   (default 844x390 390x844 1280x800)
const path = require('node:path');
const { start } = require('../minimize-proof/serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const VPS = (process.argv.slice(2).length ? process.argv.slice(2) : ['844x390', '390x844', '1280x800']).map((s) => { const [w, h] = s.split('x').map(Number); return { w, h }; });

(async () => {
  const s = await start({ seconds: 20 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const vp of VPS) {
    const phone = Math.min(vp.w, vp.h) <= 500;
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, screen: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone });
    await ctx.addCookies([s.cookie]);
    await ctx.route('**/api/settings', async (route) => { const r = await route.fetch(); let j = {}; try { j = await r.json(); } catch { /* */ } j.mobileCustomPlayer = true; await route.fulfill({ response: r, json: j }); });
    const p = await ctx.newPage();
    await p.goto(s.base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    // v1.389.0: a phone already sideways opens the video in the faux fullscreen. The page Dean scrolls is the one AFTER he leaves it.
    const enteredFs = await p.evaluate(() => document.getElementById('player-wrapper').classList.contains('css-fullscreen'));
    if (enteredFs) { await p.evaluate(() => document.getElementById('fs-btn').click()); await p.waitForTimeout(600); }
    const m = await p.evaluate((enteredFs0) => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
      const title = document.querySelector('.video-title, #video-title, h1');
      const host = document.getElementById('player-wrapper');
      const pc = document.querySelector('.player-container');
      const se = document.scrollingElement;
      return {
        enteredFs: enteredFs0, stillFs: !!(host && host.classList.contains('css-fullscreen')),
        isPhone: document.documentElement.classList.contains('is-phone'), vw: innerWidth, vh: innerHeight,
        host: r(host), playerContainer: r(pc), video: r(document.getElementById('media-player')), title: r(title), titleSel: title && (title.id || title.className || title.tagName),
        docH: se.scrollHeight, scrollRange: se.scrollHeight - innerHeight, scrollEl: se.tagName,
        pcMaxH: pc && getComputedStyle(pc).maxHeight, hostParent: host && host.parentNode && host.parentNode.id,
      };
    }, enteredFs);
    if (m.host) { m.hostFracVh = Math.round(m.host.h / m.vh * 1000) / 1000; m.sideMargin = Math.round((m.vw - m.host.w) / 2 * 10) / 10; m.titleTopInViewport = !!(m.title && m.title.y < m.vh); }
    if (process.env.PROBE_SHOTS) { require('node:fs').mkdirSync(process.env.PROBE_SHOTS, { recursive: true }); await p.screenshot({ path: path.join(process.env.PROBE_SHOTS, vp.w + 'x' + vp.h + '.png') }); }
    m.bar = await p.evaluate(() => { const c = document.querySelector('#player-wrapper .player-controls'); if (!c) return null; const b = c.getBoundingClientRect(); const kids = Array.prototype.slice.call(c.children).filter((k) => k.getBoundingClientRect().width > 0); return { w: Math.round(b.width), h: Math.round(b.height), scrollW: c.scrollWidth, clientW: c.clientWidth, overflowX: c.scrollWidth > c.clientWidth + 1, n: kids.length, maxRight: Math.round(Math.max.apply(null, kids.map((k) => k.getBoundingClientRect().right))) }; });
    console.log(JSON.stringify(Object.assign({ vp: vp.w + 'x' + vp.h, tree: process.env.FT_ROOT || 'cwd' }, m)));
    await ctx.close();
  }
  await browser.close();
  await s.stop();
})().catch((e) => { console.error(e); process.exit(1); });
