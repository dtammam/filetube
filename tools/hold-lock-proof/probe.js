'use strict';
/* global window, document, getComputedStyle */
// W0 measurement: does touchmove reach the video after the 2x hold latches, is it cancelable, does the page
// scroll, and which scroll-prevention candidate holds? Real Chromium (iPhone 13 emulation, touch), real server,
// raw CDP touch events. Not a CI gate.   node tools/hold-lock-proof/probe.js out.json
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

// What each candidate does at the moment the hold latches (ratechange to 2), installed before the player boots.
const CANDIDATES = {
  baseline: '',
  a_touch_action_class: `
    document.addEventListener('ratechange', (e) => { const v = e.target; if (v.id === 'media-player' && v.playbackRate === 2) { v.style.touchAction = 'none'; document.documentElement.style.touchAction = 'none'; document.body.style.touchAction = 'none'; } }, true);`,
  b_lazy_nonpassive: `
    window.__stop = (e) => { window.__calls = (window.__calls || 0) + 1; window.__pd = (window.__pd || 0) + 1; e.preventDefault(); };
    document.addEventListener('ratechange', (e) => { const v = e.target; if (v.id === 'media-player' && v.playbackRate === 2) v.addEventListener('touchmove', window.__stop, { passive: false }); }, true);`,
  c_permanent_nonpassive: `
    document.addEventListener('touchmove', (e) => { if (e.target.id !== 'media-player') return; window.__calls = (window.__calls || 0) + 1; if (e.target.playbackRate === 2) { window.__pd = (window.__pd || 0) + 1; e.preventDefault(); } }, { passive: false, capture: true });`,
};

async function run(browser, base, cookie, name, o) {
  const ctx = await browser.newContext(Object.assign({}, pw.devices['iPhone 13'], { hasTouch: true }));
  await ctx.addCookies([cookie]);
  await ctx.addInitScript(CANDIDATES[name]);
  await ctx.addInitScript(() => {
    window.__tm = []; window.__ts = [];
    document.addEventListener('touchmove', (e) => window.__tm.push({ c: e.cancelable, dp: e.defaultPrevented, tgt: e.target && (e.target.id || e.target.tagName), y: Math.round(e.touches[0].clientY), sy: Math.round(window.scrollY) }), { passive: true, capture: true });
    document.addEventListener('touchstart', (e) => window.__ts.push({ tgt: e.target && (e.target.id || e.target.tagName) }), { passive: true, capture: true });
    document.addEventListener('touchcancel', () => window.__ts.push({ cancel: true }), { passive: true, capture: true });
  });
  // the custom (non-native) mobile controls surface needs the setting on
  await ctx.route('**/api/settings', async (route) => { const r = await route.fetch(); let j = {}; try { j = await r.json(); } catch { /* */ } j.mobileCustomPlayer = true; await route.fulfill({ response: r, json: j }); });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.evaluate(() => { const v = document.getElementById('media-player'); v.muted = true; return v.play(); });
  await p.waitForTimeout(500);
  if (o.scrollY) await p.evaluate((sy) => window.scrollTo(0, sy), o.scrollY);
  if (o.faux) { await p.click('#fs-btn'); await p.waitForTimeout(800); }
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const pre = await p.evaluate(() => {
    const v = document.getElementById('media-player');
    const chain = []; for (let n = v; n && n.nodeType === 1; n = n.parentElement) { const ta = getComputedStyle(n).touchAction; if (ta !== 'auto') chain.push((n.id || n.tagName.toLowerCase()) + ':' + ta); }
    const r = v.getBoundingClientRect();
    return { touchActionChain: chain, faux: !!document.querySelector('.css-fullscreen'), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, scrollHeight: document.scrollingElement.scrollHeight, inner: window.innerHeight, scrollY: window.scrollY, native: v.classList.contains('native-controls') || v.hasAttribute('controls'), state: document.getElementById('player-dock') && document.getElementById('player-dock').className, paused: v.paused };
  });
  const x = pre.rect.x + pre.rect.w / 2, y0 = pre.rect.y + Math.min(pre.rect.h / 3, 60);
  await touch('touchStart', x, y0);
  await p.waitForTimeout(750);
  const during = await p.evaluate(() => ({ rate: document.getElementById('media-player').playbackRate, badgeHidden: document.getElementById('speed-badge') ? document.getElementById('speed-badge').hidden : null }));
  const before = await p.evaluate(() => ({ sy: window.scrollY, t: document.getElementById('media-player').currentTime }));
  for (let i = 1; i <= 12; i++) { await touch('touchMove', x, y0 + i * 12); await p.waitForTimeout(30); }
  await p.waitForTimeout(200);
  const after = await p.evaluate(() => ({ sy: window.scrollY, rate: document.getElementById('media-player').playbackRate, tm: window.__tm.length, cancelable: window.__tm.map((m) => m.c), dp: window.__pd || 0, inst: window.__inst || '', calls: window.__calls || 0, firstFew: window.__tm.slice(0, 4), ts: window.__ts, tgtSample: window.__tm.slice(0,2).map((m)=>m.tgt) }));
  await touch('touchEnd');
  await p.waitForTimeout(300);
  const end = await p.evaluate(() => ({ rate: document.getElementById('media-player').playbackRate, sy: window.scrollY }));
  await ctx.close();
  return { name, scenario: o.label, pre, during, scrollBefore: before.sy, scrollAfterDrag: after.sy, touchmoveCount: after.tm, cancelableAll: after.cancelable.every(Boolean), cancelableAny: after.cancelable.some(Boolean), cancelableSample: after.cancelable.slice(0, 6), preventDefaultCalls: after.dp, rateAfterDrag: after.rate, rateAfterEnd: end.rate, errs, inst: after.inst, calls: after.calls, ts: after.ts, tgtSample: after.tgtSample };
}

(async () => {
  const out = { runAt: new Date().toISOString(), runs: [] };
  const s = await start({ seconds: 60 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const name of Object.keys(CANDIDATES)) {
    for (const o of [{ label: 'inline_scrollY0', scrollY: 0 }, { label: 'inline_scrollY_gt0', scrollY: 40 }, { label: 'faux_fullscreen', scrollY: 40, faux: true }]) {
      try { out.runs.push(await run(browser, s.base, s.cookie, name, o)); } catch (e) { out.runs.push({ name, scenario: o.label, error: String(e.message || e) }); }
    }
  }
  await browser.close(); await s.stop();
  fs.writeFileSync(process.argv[2] || 'probe.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out.runs.map((r) => r.error ? r : { n: r.name, s: r.scenario, rate: r.during.rate, sh: r.pre.scrollHeight, inner: r.pre.inner, sy0: r.scrollBefore, sy1: r.scrollAfterDrag, tm: r.touchmoveCount, canc: r.cancelableSample.join(''), pd: r.preventDefaultCalls, faux: r.pre.faux, ta: r.pre.touchActionChain.join(' '), inst: r.inst, calls: r.calls, ts: JSON.stringify(r.ts), tg: r.tgtSample.join(',') }), null, 0));
  process.exit(0);
})();
