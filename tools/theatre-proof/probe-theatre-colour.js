'use strict';
/* global window, document, getComputedStyle */
// v1.363.1 W1: the music player's theatre button. Real server, desktop Chromium. For each scheme x era theme, reads the
// button's aria-pressed, its computed colour and the stage's is-split class and whether the panel sits beside the player in OFF and ON, after a cold /music load and
// after a /watch -> /music SPA hop. Not a CI gate.
//   node tools/theatre-proof/probe-theatre-colour.js out.json
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('../minimize-proof/serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

(async () => {
  const outFile = process.argv[2] || path.join(__dirname, 'probe-theatre-colour-result.json');
  const out = { runAt: new Date().toISOString(), rows: [] };
  const s = await start({ seconds: 20 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const read = (p) => p.evaluate(() => {
    const b = document.getElementById('theater-btn');
    const st = document.getElementById('music-stage');
    if (!b) return { btn: false };
    const cs = getComputedStyle(b);
    return { pressed: b.getAttribute('aria-pressed'), color: cs.color, display: cs.display, split: st ? st.classList.contains('is-split') : null, beside: (() => { const pn = document.querySelector('.music-nowplaying-panel'); const sl = document.getElementById('player-slot'); if (!pn || !sl || pn.hidden) return null; return pn.getBoundingClientRect().left >= sl.getBoundingClientRect().right - 1; })(), stored: localStorage.getItem('ft-music-theater') };
  });
  try {
    // scenario: how the persistent host reaches the music view and what each view's stored theatre flag says
    const SCEN = [
      { name: 'cold', mt: null, wt: null },
      { name: 'cold-music-on', mt: '1', wt: null },
      { name: 'hop', mt: null, wt: null },
      { name: 'hop-watch-theatre-on', mt: '0', wt: '1' },
      { name: 'hop-music-on-watch-off', mt: '1', wt: '0' },
      { name: 'spa-watch-to-music', mt: null, wt: null },
      { name: 'spa-watch-theatre-on-to-music', mt: '0', wt: '1' },
      { name: 'spa-music-on-watch-off-to-music', mt: '1', wt: '0' },
      { name: 'spa-music-watch-music', mt: '0', wt: '1', roundTrip: true },
      { name: 'spa-music-watch-music-musicon', mt: '1', wt: '0', roundTrip: true },
    ];
    for (const scheme of ['light', 'dark']) {
      for (const era of ['2021']) {
        for (const sc of SCEN) {
          const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
          await ctx.addCookies([s.cookie]);
          await ctx.addInitScript((kv) => { for (const k of Object.keys(kv)) if (kv[k] != null) localStorage.setItem(k, kv[k]); }, { 'ft-era': era, 'ft-mode': scheme, 'ft-music-theater': sc.mt, 'ft-theater': sc.wt });
          const p = await ctx.newPage();
          const errs = []; p.on('pageerror', (e) => errs.push(e.message));
          const nav = (u) => p.evaluate((x) => window.FileTube.navigate(x), u);
          if (sc.name.startsWith('spa-')) {
            if (sc.roundTrip) {
              await p.goto(s.base + '/music.html?play=song1', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
              await nav('/watch.html?v=clip1'); await p.waitForTimeout(1500);
              await nav('/music?play=song1'); await p.waitForTimeout(1500);
            } else {
              await p.goto(s.base + '/watch.html?v=clip1', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
              await nav('/music?play=song1'); await p.waitForTimeout(1500);
            }
          } else if (sc.name.startsWith('cold')) await p.goto(s.base + '/music.html?play=song1', { waitUntil: 'networkidle' });
          else {
            await p.goto(s.base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
            await p.waitForTimeout(800);
            await p.goto(s.base + '/music.html?play=song1', { waitUntil: 'networkidle' }); // full load; the SPA hop is covered below
          }
          await p.waitForTimeout(1500);
          const row = { scheme, era, scenario: sc.name, url: p.url() };
          row.state = await read(p);
          await p.evaluate(() => document.getElementById('theater-btn') && document.getElementById('theater-btn').click());
          await p.waitForTimeout(300);
          row.afterClick = await read(p);
          row.errs = errs;
          out.rows.push(row);
          await ctx.close();
        }
      }
    }
  } finally { await browser.close(); await s.stop(); }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  for (const r of out.rows) console.log(r.scheme, r.era, r.scenario, JSON.stringify(r.state), '->', JSON.stringify(r.afterClick));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
