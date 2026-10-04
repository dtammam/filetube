'use strict';
/* global window, document, history, location */
// v1.362.1 W2: the v1.362 gate r2 adversary repro of the capped-history gap, in real Chromium (iPhone 13, CDP touch):
// Home > clip1, router-shaped watch entries pushed to depth 61 (history.length caps at 50), Back 15 (depth 46),
// then the chevron. Records which branch decided (navigation.currentEntry.index vs history.length), where it
// landed, and whether the bottom-nav Home works after.
//   node tools/minimize-proof/probe-cap.js out.json [repoRoot]
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[3] ? path.resolve(process.argv[3]) : path.join(__dirname, '..', '..');
const { start } = require(path.join(root, 'tools', 'minimize-proof', 'serve'));
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const read = () => {
  const ce = window.navigation && window.navigation.currentEntry;
  return { path: location.pathname + location.search, state: window.FileTube.player.getState(), depth: history.state && history.state.depth, browseDepth: history.state && history.state.browseDepth, historyLength: history.length, navIndex: ce ? ce.index : null };
};

(async () => {
  const out = { runAt: new Date().toISOString(), root, steps: [] };
  const s = await start({ seconds: 60 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const log = async (p, label) => { const r = Object.assign({ label }, await p.evaluate(read)); out.steps.push(r); return r; };
  try {
    const ctx = await browser.newContext(Object.assign({}, pw.devices['iPhone 13'], { hasTouch: true }));
    await ctx.addCookies([s.cookie]);
    await ctx.route('**/api/settings', async (route) => { const r = await route.fetch(); let j = {}; try { j = await r.json(); } catch { /* */ } j.mobileCustomPlayer = true; await route.fulfill({ response: r, json: j }); });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const cdp = await ctx.newCDPSession(p);
    const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    await p.goto(s.base + '/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(400);
    await p.evaluate(() => window.FileTube.navigate('/watch.html?v=clip1'));
    await p.waitForTimeout(1200);
    await log(p, 'watch clip1');
    await p.evaluate(() => { const base = history.state; for (let d = 2; d <= 61; d++) history.pushState(Object.assign({}, base, { depth: d }), '', location.href); });
    await log(p, 'pushed to depth 61');
    await p.evaluate(() => history.go(-15));
    await p.waitForTimeout(1500);
    await log(p, 'after Back 15');
    await p.evaluate(() => document.getElementById('media-player').pause());
    await p.waitForTimeout(200);
    const c = await p.evaluate(() => { const b = document.querySelector('.player-minimize'); const r = b.getBoundingClientRect(); return { hidden: b.hidden, x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    out.chevronBeforeTap = c;
    await tap(c.x, c.y);
    await p.waitForTimeout(2000);
    await log(p, 'after the chevron');
    const h = await p.evaluate(() => { const a = document.querySelector('#bottom-nav [data-nav="home"]'); const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await p.evaluate(() => window.FileTube.navigate('/?search=probe'));
    await p.waitForTimeout(1500);
    await log(p, 'navigated to a search');
    await tap(h.x, h.y);
    await p.waitForTimeout(2000);
    await log(p, 'after the bottom-nav Home tap');
    out.errs = errs;
    await ctx.close();
  } catch (e) { out.error = String(e.stack || e); }
  await browser.close(); await s.stop();
  fs.writeFileSync(process.argv[2] || 'probe-cap.json', JSON.stringify(out, null, 1));
  for (const st of out.steps) console.log(JSON.stringify(st));
  if (out.error) console.log(out.error);
  process.exit(0);
})();
