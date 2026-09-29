// iPod true-up: screenshot the REAL Settings skin grid (all skins as swatches) from a running, seeded instance.
// Usage (from the repo root, a seeded server already running - see plan Step 5):
//   BASE=http://127.0.0.1:<port> FIXTURES=<data dir>/fixtures.json OUT=<png> node <this file>
const path = require('path');
const pw = require(path.resolve('tools/capture/node_modules/playwright'));
const BASE = process.env.BASE, F = require(path.resolve(process.env.FIXTURES)), OUT = process.env.OUT || 'skins-settings.png';
(async () => {
  const b = await pw.chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(BASE + '/login');
  await p.fill('input[name="username"], #login-username', F.user);
  await p.fill('input[type="password"]', F.password);
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => !String(u).includes('login'));
  await p.goto(BASE + '/setup.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.md-row[data-md-target]', { state: 'attached', timeout: 15000 });
  // open whichever Settings section holds the skin picker (no hard-coded section key)
  const opened = await p.evaluate(async () => {
    const vis = () => { const el = document.getElementById('music-skin-picker'); return !!(el && el.offsetParent && el.querySelector('.skin-tile')); };
    for (const r of document.querySelectorAll('.md-row[data-md-target]')) {
      if (vis()) break;
      r.click(); await new Promise((res) => setTimeout(res, 400));
    }
    return vis();
  });
  if (!opened) { console.error('FAILED: #music-skin-picker never became visible'); process.exit(1); }
  const grid = p.locator('#music-skin-picker');
  await grid.scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  await grid.screenshot({ path: OUT });
  console.log('tiles', await p.locator('#music-skin-picker .skin-tile').count(), '->', OUT);
  await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n')[0]); process.exit(1); });
