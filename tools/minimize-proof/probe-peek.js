'use strict';
/* global window, document, location */
// v1.362.1 W1: the chevron peek in real Chromium (iPhone 13, raw CDP touch, the custom-controls setting forced on)
// on the branch's product code: paused shown; ~3 s after play hidden; a tap on the picture while playing shows
// it AND still pauses; a tap at the hidden chevron's spot pauses (never minimizes); the pull still docks with the
// chevron hidden.
//   node tools/minimize-proof/probe-peek.js out.json
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const read = () => {
  const v = document.getElementById('media-player');
  const b = document.querySelector('.player-minimize');
  return { path: location.pathname + location.search, state: window.FileTube.player.getState(), paused: v.paused, chevronHidden: b ? b.hidden : null };
};

(async () => {
  const out = { runAt: new Date().toISOString(), steps: [] };
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
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const play = () => p.evaluate(() => { const v = document.getElementById('media-player'); v.muted = true; return v.play(); });
    await p.goto(s.base + '/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(400);
    await p.evaluate(() => window.FileTube.navigate('/watch.html?v=clip1'));
    await p.waitForTimeout(900);
    await p.evaluate(() => document.getElementById('media-player').pause());
    await p.waitForTimeout(200);
    await log(p, 'paused');
    const geo = await p.evaluate(() => {
      const b = document.querySelector('.player-minimize').getBoundingClientRect(); const v = document.getElementById('media-player').getBoundingClientRect();
      return { chev: [b.x + b.width / 2, b.y + b.height / 2], mid: [v.x + v.width / 2, v.y + v.height / 2] };
    });
    out.geo = geo;
    await play();
    const t0 = Date.now();
    for (const at of [500, 2500, 3500]) { await p.waitForTimeout(Math.max(0, at - (Date.now() - t0))); await log(p, 'play +' + at + ' ms'); }
    // a tap on the picture's centre while playing (chevron hidden)
    await touch('touchStart', geo.mid[0], geo.mid[1]);
    await p.waitForTimeout(40);
    await log(p, 'centre touch down (playing)');
    await touch('touchEnd');
    await p.waitForTimeout(600);
    await log(p, 'centre tap +600 ms (the tap paused?)');
    await play();
    await p.waitForTimeout(3600);
    await log(p, 'played again +3600 ms');
    // a tap exactly where the hidden chevron sits
    await touch('touchStart', geo.chev[0], geo.chev[1]);
    await p.waitForTimeout(40);
    await log(p, 'chevron-spot touch down (hidden before it)');
    await touch('touchEnd');
    await p.waitForTimeout(600);
    await log(p, 'chevron-spot tap +600 ms (paused, still full, same page?)');
    await play();
    await p.waitForTimeout(3600);
    await log(p, 'played again +3600 ms (before the pull)');
    // gate r1 (adversary): a DOUBLE-tap at the hidden chevron's spot must skip back, not minimize
    await p.evaluate(() => { document.getElementById('media-player').currentTime = 20; });
    await play();
    await p.waitForTimeout(3600);
    const t0dbl = await p.evaluate(() => document.getElementById('media-player').currentTime);
    await log(p, 'before the double-tap at the chevron spot (t=' + Math.round(t0dbl * 10) / 10 + ')');
    await touch('touchStart', geo.chev[0], geo.chev[1]); await touch('touchEnd');
    await p.waitForTimeout(120);
    const inertAfterFirst = await p.evaluate(() => document.querySelector('.player-minimize').hasAttribute('inert'));
    await touch('touchStart', geo.chev[0], geo.chev[1]); await touch('touchEnd');
    await p.waitForTimeout(100);
    out.doubleTap = { inertAfterFirst, at100: await p.evaluate(read), t: await p.evaluate(() => document.getElementById('media-player').currentTime) };
    // a third tap inside the 800 ms chain, still at the spot: another skip
    await p.waitForTimeout(400);
    await touch('touchStart', geo.chev[0], geo.chev[1]); await touch('touchEnd');
    await p.waitForTimeout(900);
    out.doubleTap.afterChain = Object.assign(await p.evaluate(read), { t: await p.evaluate(() => document.getElementById('media-player').currentTime) });
    await log(p, 'after double-tap + chain tap at the chevron spot (skipped, full, playing?)');
    // control: a deliberate tap on the shown chevron once the guard is over still minimizes (checked last, below)
    // the pull with the chevron hidden
    await touch('touchStart', geo.mid[0], geo.mid[1] - 60);
    for (let i = 1; i <= 25; i++) { await touch('touchMove', geo.mid[0], geo.mid[1] - 60 + i * 10); await p.waitForTimeout(30); }
    await touch('touchEnd');
    await p.waitForTimeout(1500);
    await log(p, 'after a 250 px pull');
    // the deliberate chevron tap: expand back, pause (shown, no guard), tap it
    await p.evaluate(() => { window.FileTube.navigate('/watch.html?v=clip1'); });
    await p.waitForTimeout(1500);
    await p.evaluate(() => document.getElementById('media-player').pause());
    await p.waitForTimeout(600);
    await log(p, 'back on the watch page, paused');
    await touch('touchStart', geo.chev[0], geo.chev[1]); await touch('touchEnd');
    await p.waitForTimeout(1500);
    await log(p, 'after a deliberate tap on the shown chevron (minimized?)');
    out.errs = errs;
    await ctx.close();
  } catch (e) { out.error = String(e.stack || e); }
  await browser.close(); await s.stop();
  fs.writeFileSync(process.argv[2] || 'probe-peek.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})();
