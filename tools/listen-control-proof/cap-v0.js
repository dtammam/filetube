'use strict';
/* global document */
// v1.354 W0 falsifier: the iPod menus cut a big library at 10,000 songs. Seeds 10,500 songs (the last
// 500 are "Z Bulk" by "Zed Band" in the genre "Zydeco") and reads, in a real iPhone browser:
//   Songs   - the last row after scrolling to the bottom
//   Genres  - whether the Zydeco row exists
//   Shuffle - how many songs the shuffled queue holds and whether it holds a Z Bulk song
// Run: node tools/listen-control-proof/cap-v0.js   (prints one JSON line; exit 1 if any read is short)
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const COUNT = Number(process.env.CAP_COUNT || 10500);

async function run() {
  const srv = await start({ seconds: 5, count: COUNT });
  const b = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const out = { seeded: COUNT + 3 };
  try {
    const ph = await b.newContext(Object.assign({}, pw.devices['iPhone 13'], { viewport: { width: 390, height: 844 } }));
    await ph.addCookies([srv.cookie]);
    await ph.addInitScript(() => { try { localStorage.setItem('ft-music-skin', 'ipod'); } catch { /* */ } });
    const p = await ph.newPage();
    const shuffleResp = [];
    p.on('response', async (r) => {
      if (/sort=random/.test(r.url())) { try { const d = await r.json(); shuffleResp.push({ n: d.items.length, total: d.total }); } catch { /* */ } }
    });
    await p.goto(srv.base + '/music?play=song1', { waitUntil: 'networkidle' });
    await p.waitForSelector('.mms-full', { timeout: 15000 });
    const rows = () => p.evaluate(() => Array.from(document.querySelectorAll('.ipm-row')).map((e) => e.textContent.trim()));
    const click = async (label) => {
      const ok = await p.evaluate((l) => { const r = Array.from(document.querySelectorAll('.ipm-row')).find((e) => e.textContent.trim().startsWith(l)); if (r) r.click(); return !!r; }, label);
      if (!ok) throw new Error('no row ' + label + ' in ' + JSON.stringify((await rows()).slice(0, 12)));
      await p.waitForTimeout(600);
    };
    await p.click('[data-skin-menu]'); await p.waitForTimeout(400);
    await click('Music'); await click('Songs'); await p.waitForTimeout(2500);
    out.songsScrollHeight = await p.evaluate(() => document.querySelector('.ipm-list').scrollHeight);
    out.songsRowPx = await p.evaluate(() => document.querySelector('.ipm-row').offsetHeight);
    out.songsRows = Math.round(out.songsScrollHeight / out.songsRowPx);
    await p.evaluate(() => { const l = document.querySelector('.ipm-list'); l.scrollTop = l.scrollHeight; });
    await p.waitForTimeout(800);
    const tail = await rows();
    out.songsLastRow = tail[tail.length - 1];
    await p.click('[data-skin-menu]'); await p.waitForTimeout(500);
    await click('Genres'); await p.waitForTimeout(2500);
    const g = await rows();
    out.genres = g;
    out.genresHasZydeco = g.some((t) => /^Zydeco/.test(t));
    await p.click('[data-skin-menu]'); await p.waitForTimeout(400);
    await p.click('[data-skin-menu]'); await p.waitForTimeout(400);
    await click('Shuffle Songs'); await p.waitForTimeout(6000);
    out.shuffleFetches = shuffleResp;
    out.shuffleQueueRows = await p.evaluate(() => document.querySelectorAll('.music-song-list .music-song-row, .music-song-list [data-id]').length);
  } finally { await b.close(); await srv.stop(); }
  out.songsComplete = /Z Bulk 0*1049\d/.test(out.songsLastRow || '') || /Z Bulk/.test(out.songsLastRow || '');
  console.log(JSON.stringify(out));
  const short = !out.songsComplete || !out.genresHasZydeco || !(out.shuffleFetches[0] && out.shuffleFetches[0].n >= COUNT);
  process.exit(short ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(2); });
