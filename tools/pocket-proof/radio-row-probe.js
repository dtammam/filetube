'use strict';
/* global document, getComputedStyle */
// REAL-BROWSER PROOF (v1.378.0 W4, plan docs/exec-plans/active/2026-10-09-music-stations.md, D11): the Pocket Radio row
// in the SMALLEST skin and on the smallest phone. Not a CI gate.
//   node tools/pocket-proof/radio-row-probe.js [repoRoot]
// A fresh seeded fixture server (test/visual/server.js), Chromium with an iPhone UA at 320x568 (and 390x844), the Nano 2G
// Click skin (the smallest LCD) with a song playing: open the Main menu and MEASURE (LESSONS: rows wrap, buttons never
// shrink): every main-menu row has the same height as before the Radio row existed (no row shrinks), the Radio row's label
// is one line (never wrapped), the last row (Now Playing) is reachable by scrolling the list; then Radio > the first station
// and the Now Playing LCD's album slot reads "Radio: <name>" on one line inside the LCD.
const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const REPO = process.argv[2] || path.join(__dirname, '..', '..');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));
const { seed, boot } = require(path.join(REPO, 'test/visual/server.js'));
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-radio-'));
  const FX = seed(dir); const srv = await boot(dir); const base = srv.base;
  const browser = await chromium.launch();
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails += 1; };
  try {
    for (const [w, h] of [[320, 568], [390, 844]]) {
      for (const skin of ['ipod-lime', 'ipod']) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IOS_UA });
        await ctx.addInitScript((id) => { localStorage.setItem('ft-music-skin', id); localStorage.setItem('ft-pocket-lighting', 'off'); localStorage.setItem('ft-music-autoplay', '1'); }, skin);
        const page = await ctx.newPage();
        const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
        await page.goto(base + '/login', { waitUntil: 'networkidle' });
        await page.fill('#login-username, input[name="username"], input[type="text"]', FX.user);
        await page.fill('#login-password, input[name="password"], input[type="password"]', FX.password);
        await page.click('button[type="submit"], .login-submit');
        await page.waitForURL((u) => !String(u).includes('login'), { timeout: 10000 });
        // a song playing: the first song of the library through ?play=
        const first = await page.evaluate(async () => { const d = await (await fetch('/api/music?limit=1')).json(); return d.items[0] && d.items[0].id; });
        ok(!!first, `${w}x${h} ${skin}: the fixture has a song`);
        await page.goto(base + '/music?play=' + encodeURIComponent(first), { waitUntil: 'networkidle' });
        await sleep(1500);
        ok(await page.locator('#music-nowplaying-panel.mms-full').isVisible(), `${w}x${h} ${skin}: the iPod is up`);
        // MENU -> the Main menu
        await page.locator('[data-skin-menu]').first().tap(); await sleep(500);
        const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#music-nowplaying-panel .ipm-row')).map((r) => {
          const b = r.getBoundingClientRect(); const lbl = r.querySelector('.ipm-name') || r.querySelector('.ipm-lbl');
          const lb = lbl ? lbl.getBoundingClientRect() : b;
          const lh = lbl ? parseFloat(getComputedStyle(lbl).lineHeight) : 0;
          return { label: (lbl ? lbl.textContent : r.textContent).trim(), h: Math.round(b.height * 100) / 100, lines: lh > 0 ? Math.round(lb.height / lh) : 1, wrapped: lbl ? lbl.scrollWidth > lbl.clientWidth + 1 : false };
        }));
        const labels = rows.map((r) => r.label);
        ok(labels[0] === 'Music' && labels[1] === 'Radio', `${w}x${h} ${skin}: Radio right after Music: ${labels.join(' | ')}`);
        const heights = new Set(rows.map((r) => r.h));
        ok(heights.size === 1, `${w}x${h} ${skin}: every row the same height (no row shrinks): ${[...heights].join(', ')}px`);
        const radio = rows.find((r) => r.label === 'Radio');
        ok(radio && radio.lines === 1 && !radio.wrapped, `${w}x${h} ${skin}: the Radio row is one line (lines=${radio && radio.lines}, wrapped=${radio && radio.wrapped})`);
        const lcd = await page.evaluate(() => { const l = document.querySelector('#music-nowplaying-panel .ip-lcd'); const b = l.getBoundingClientRect(); return { h: b.height, w: b.width }; });
        console.log(`  ${w}x${h} ${skin}: LCD ${Math.round(lcd.w)}x${Math.round(lcd.h)}px, ${rows.length} main rows of ${rows[0] && rows[0].h}px`);
        // the last row stays reachable: scroll the list to the end and read the last row
        const lastVisible = await page.evaluate(() => {
          const list = document.querySelector('#music-nowplaying-panel .ipm-list, #music-nowplaying-panel .ip-menu, #music-nowplaying-panel [class*="ipm-body"]') || document.querySelector('#music-nowplaying-panel .ipm-row').parentElement;
          list.scrollTop = list.scrollHeight;
          const rs = Array.from(document.querySelectorAll('#music-nowplaying-panel .ipm-row'));
          const lb = list.getBoundingClientRect();
          const last = rs[rs.length - 1]; const b = last.getBoundingClientRect();
          return { label: last.textContent.trim(), inside: b.bottom <= lb.bottom + 1 && b.top >= lb.top - 1 };
        });
        ok(lastVisible.inside, `${w}x${h} ${skin}: the last row (${lastVisible.label}) is reachable by scrolling`);
        // Radio > the first station: the LCD's album slot reads "Radio: <name>" on one line inside the LCD
        const radioRow = page.locator('#music-nowplaying-panel .ipm-row', { hasText: 'Radio' }).first();
        await radioRow.tap(); await sleep(900);
        const stationRows = await page.evaluate(() => Array.from(document.querySelectorAll('#music-nowplaying-panel .ipm-row')).map((r) => r.textContent.trim()));
        ok(stationRows.length > 0, `${w}x${h} ${skin}: the Radio level lists stations: ${stationRows.slice(0, 4).join(' | ')}`);
        await page.locator('#music-nowplaying-panel .ipm-row').first().tap(); await sleep(2000);
        const line = await page.evaluate(() => {
          const el = document.querySelector('#music-nowplaying-panel .ip-album');
          if (!el) return null;
          const b = el.getBoundingClientRect(); const lcd = document.querySelector('#music-nowplaying-panel .ip-lcd').getBoundingClientRect();
          const lh = parseFloat(getComputedStyle(el).lineHeight);
          return { text: el.textContent, lines: lh > 0 ? Math.round(b.height / lh) : 1, inside: b.left >= lcd.left - 1 && b.right <= lcd.right + 1 && b.bottom <= lcd.bottom + 1, overflow: el.scrollWidth > el.clientWidth + 1 };
        });
        ok(line && /^Radio: /.test(line.text), `${w}x${h} ${skin}: the LCD reads "${line && line.text}"`);
        ok(line && line.lines === 1 && line.inside, `${w}x${h} ${skin}: the station line is one line inside the LCD (lines=${line && line.lines}, inside=${line && line.inside}, clipped=${line && line.overflow})`);
        ok(errs.length === 0, `${w}x${h} ${skin}: no page errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(fails ? `FAILS ${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
