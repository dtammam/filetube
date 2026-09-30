'use strict';
/* global document */
// MEASURE (v1.348 W2): the desktop Music toolbar box widths/rows at 1280 and 1024 in all four eras.
// Run against a tree; diff the JSON between base and branch. Usage: node measure-toolbar.js out.json
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const ERAS = ['2005', '2009', '2014', '2021'];
(async () => {
  const s = await start();
  const browser = await pw.chromium.launch();
  const out = {};
  for (const era of ERAS) {
    for (const width of [1280, 1024]) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 } });
      await ctx.addCookies([{ name: s.cookie.name, value: s.cookie.value, url: s.cookie.url }]);
      await ctx.addInitScript((e) => { try { localStorage.setItem('ft-era', e); localStorage.setItem('ft-mode', 'light'); } catch { /* */ } }, era);
      const page = await ctx.newPage();
      await page.goto(s.base + '/music', { waitUntil: 'networkidle' });
      await page.waitForSelector('.music-toolbar-actions');
      out[era + '@' + width] = await page.evaluate(() => {
        const bar = document.querySelector('.music-toolbar-actions');
        const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
        const kids = Array.from(bar.children).filter((c) => c.getBoundingClientRect().width > 0).map((c) => ({ id: c.id || c.className.split(' ')[0], ...r(c) }));
        const rows = new Set(kids.map((k) => k.y)).size;
        return { era: document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme'), bar: r(bar), rows, kids };
      });
      await ctx.close();
    }
  }
  await browser.close();
  await s.stop();
  require('node:fs').writeFileSync(process.argv[2], JSON.stringify(out, null, 1) + '\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
