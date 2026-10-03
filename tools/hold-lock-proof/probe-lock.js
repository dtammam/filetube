'use strict';
/* global window, document, getComputedStyle */
// W2 measurement: the real lock end to end in Chromium (iPhone 13, raw CDP touch): drag to lock, the page does not
// scroll under the drag, the pill shows the lock glyph and is tappable, a tap unlocks. Not a CI gate.
//   node tools/hold-lock-proof/probe-lock.js out.json
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

async function run(browser, base, cookie, o) {
  const ctx = await browser.newContext(Object.assign({}, pw.devices['iPhone 13'], { hasTouch: true }));
  await ctx.addCookies([cookie]);
  await ctx.route('**/api/settings', async (route) => { const r = await route.fetch(); let j = {}; try { j = await r.json(); } catch { /* */ } j.mobileCustomPlayer = true; await route.fulfill({ response: r, json: j }); });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.evaluate(() => { const v = document.getElementById('media-player'); v.muted = true; return v.play(); });
  await p.waitForTimeout(500);
  if (o.scrollY) await p.evaluate((sy) => window.scrollTo(0, sy), o.scrollY);
  await p.evaluate(() => {
    window.__tm = [];
    document.addEventListener('touchmove', (e) => {
      if (!window.__tg) { const c = []; for (let n = e.target; n && n.nodeType === 1; n = n.parentElement) c.push((n.id || n.tagName.toLowerCase()) + '.' + String(n.className).split(' ')[0]); window.__tg = c.join(' < '); }
      window.__tm.push([e.cancelable ? 1 : 0, e.defaultPrevented ? 1 : 0, Math.round(window.scrollY)]);
    }, { passive: true });
  });
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const rect = await p.evaluate(() => { const r = document.getElementById('media-player').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const x = rect.x + rect.w / 2, y0 = rect.y + Math.min(rect.h / 3, 60);
  await touch('touchStart', x, y0);
  await p.waitForTimeout(750);
  const sy0 = await p.evaluate(() => window.scrollY);
  for (let i = 1; i <= 12; i++) { await touch('touchMove', x, y0 + i * 12); await p.waitForTimeout(30); }
  await touch('touchEnd');
  await p.waitForTimeout(300);
  const locked = await p.evaluate(() => {
    const b = document.getElementById('speed-badge'); const g = b.querySelector('.speed-badge__lock'); const r = b.getBoundingClientRect(); const gr = g.getBoundingClientRect();
    const mid = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { rate: document.getElementById('media-player').playbackRate, hidden: b.hidden, cls: b.className, role: b.getAttribute('role'), pe: getComputedStyle(b).pointerEvents, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, glyph: { w: Math.round(gr.width), h: Math.round(gr.height), display: getComputedStyle(g).display }, hitIsPill: !!(mid && (mid === b || b.contains(mid))), scrollY: window.scrollY };
  });
  const sy1 = locked.scrollY;
  await touch('touchStart', locked.rect.x + locked.rect.w / 2, locked.rect.y + locked.rect.h / 2);
  await touch('touchEnd');
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ rate: document.getElementById('media-player').playbackRate, hidden: document.getElementById('speed-badge').hidden, cls: document.getElementById('speed-badge').className }));
  const tm = await p.evaluate(() => window.__tm);
  const tg = await p.evaluate(() => window.__tg);
  await ctx.close();
  return { tg, tm: tm.join(' '), scenario: o.label, scrollDuringDrag: [sy0, sy1], locked, afterPillTap: after, errs };
}

(async () => {
  const out = { runAt: new Date().toISOString(), runs: [] };
  const s = await start({ seconds: 60 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const o of [{ label: 'scrollY0', scrollY: 0 }, { label: 'scrollY40', scrollY: 40 }]) {
    try { out.runs.push(await run(browser, s.base, s.cookie, o)); } catch (e) { out.runs.push({ scenario: o.label, error: String(e.message || e) }); }
  }
  await browser.close(); await s.stop();
  fs.writeFileSync(process.argv[2] || 'probe-lock.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out.runs));
  process.exit(0);
})();
