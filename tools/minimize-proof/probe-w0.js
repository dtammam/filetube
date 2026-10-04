'use strict';
/* global window, document, getComputedStyle, history, location */
// v1.362 W0: plan section 3, measured on main's product code (nothing of the feature exists yet). Real server,
// Chromium with iPhone 13 emulation + touch, raw CDP touch. Not a CI gate.
//   node tools/minimize-proof/probe-w0.js out.json [item ...]      (items: 1 2 3 5 6; default all)
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

async function page(browser, s, init) {
  const ctx = await browser.newContext(Object.assign({}, pw.devices['iPhone 13'], { hasTouch: true }));
  await ctx.addCookies([s.cookie]);
  if (init) await ctx.addInitScript(init);
  await ctx.route('**/api/settings', async (route) => { const r = await route.fetch(); let j = {}; try { j = await r.json(); } catch { /* */ } j.mobileCustomPlayer = true; await route.fulfill({ response: r, json: j }); });
  const p = await ctx.newPage();
  p.__errs = []; p.on('pageerror', (e) => p.__errs.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  p.touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  return { ctx, p };
}

async function playMuted(p) {
  await p.waitForTimeout(900);
  await p.evaluate(() => { const v = document.getElementById('media-player'); v.muted = true; return v.play(); });
  await p.waitForTimeout(400);
}

async function playerFacts(p) {
  return p.evaluate(() => {
    const v = document.getElementById('media-player'); const h = document.getElementById('player-wrapper');
    return { path: location.pathname + location.search, state: window.FileTube.player.getState(), src: (v.currentSrc || '').replace(/^https?:\/\/[^/]+/, ''), paused: v.paused, t: Math.round(v.currentTime * 10) / 10, parent: h.parentNode && (h.parentNode.id || h.parentNode.className), depth: history.state && history.state.depth, cls: h.className };
  });
}

// Item 1: hit boxes of the docked X and play/pause, by elementFromPoint over a 2 px grid.
async function item1(browser, s) {
  const { ctx, p } = await page(browser, s);
  await p.goto(s.base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
  await playMuted(p);
  await p.evaluate(() => window.FileTube.navigate('/'));
  await p.waitForTimeout(1500);
  const out = await p.evaluate(() => {
    const r2 = (r) => ({ x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 });
    const dock = document.getElementById('player-dock');
    const res = { dock: r2(dock.getBoundingClientRect()), state: window.FileTube.player.getState() };
    for (const [k, sel] of [['close', '.player-dock-close'], ['pp', '#player-dock #pp-btn']]) {
      const b = document.querySelector(sel); const r = b.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      let hits = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, onDock = 0;
      for (let dx = -30; dx <= 30; dx += 2) for (let dy = -30; dy <= 30; dy += 2) {
        const e = document.elementFromPoint(cx + dx, cy + dy);
        if (e && (e === b || b.contains(e))) { hits++; minX = Math.min(minX, dx); maxX = Math.max(maxX, dx); minY = Math.min(minY, dy); maxY = Math.max(maxY, dy); } else if (e && dock.contains(e)) onDock++;
      }
      res[k] = { rect: r2(r), gridPoints: 961, hits, hitSpanW: hits ? maxX - minX + 2 : 0, hitSpanH: hits ? maxY - minY + 2 : 0, otherDockPoints: onDock };
    }
    const c = document.getElementById('player-dock').getBoundingClientRect();
    const mid = document.elementFromPoint(c.x + c.width / 2, c.y + c.height * 0.35);
    res.centreHit = mid ? (mid.id || mid.tagName) : null;
    return res;
  });
  await ctx.close();
  return out;
}

// Item 2: is a downward drag on the picture cancelable, inline, at scrollY 0 and 40.
const CLAIMS = {
  none: '',
  pdFromFirst: `window.__claim = 'first'`,
  pdAfter12: `window.__claim = 'after12'`,
};
async function item2(browser, s, sy, claim) {
  const { ctx, p } = await page(browser, s, CLAIMS[claim] || '');
  await p.goto(s.base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
  await playMuted(p);
  await p.evaluate((sy) => window.scrollTo(0, sy), sy);
  await p.waitForTimeout(200);
  await p.evaluate(() => {
    window.__tm = []; window.__tc = 0;
    const h = document.getElementById('player-wrapper');
    if (window.__claim) {
      h.addEventListener('touchstart', (e) => { window.__sy0 = e.touches[0].clientY; window.__sx0 = e.touches[0].clientX; }, { passive: true });
      h.addEventListener('touchmove', (e) => {
        const dy = e.touches[0].clientY - window.__sy0, dx = e.touches[0].clientX - window.__sx0;
        const ok = window.scrollY <= 1 && dy > 0 && dy > Math.abs(dx) * 1.5 && (window.__claim === 'first' || dy >= 12);
        if (ok && e.cancelable) e.preventDefault();
      }, { passive: false });
    }
    window.addEventListener('touchmove', (e) => window.__tm.push([e.cancelable ? 1 : 0, e.defaultPrevented ? 1 : 0, Math.round(e.touches[0].clientY), Math.round(window.scrollY)]), { passive: true });
    window.addEventListener('touchcancel', () => { window.__tc++; }, { passive: true });
  });
  const r = await p.evaluate(() => { const r = document.getElementById('media-player').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const x = r.x + r.w / 2, y0 = r.y + r.h / 2;
  const before = await p.evaluate(() => window.scrollY);
  await p.touch('touchStart', x, y0);
  for (let i = 1; i <= 15; i++) { await p.touch('touchMove', x, y0 + i * 10); await p.waitForTimeout(16); }
  await p.touch('touchEnd');
  await p.waitForTimeout(400);
  const out = await p.evaluate(() => ({ tm: window.__tm, tc: window.__tc, after: window.scrollY, paused: document.getElementById('media-player').paused }));
  await ctx.close();
  const moves = out.tm.length; const cancelable = out.tm.filter((m) => m[0]).length; const prevented = out.tm.filter((m) => m[1]).length;
  return { scenario: 'scrollY' + sy + ' claim=' + claim, scrollBefore: before, scrollAfter: out.after, moves, cancelable, prevented, touchcancel: out.tc, pausedAfter: out.paused, perMove: out.tm.map((m) => m.join(',')).join(' ') };
}

// Item 3: ancestors of the host on the watch view (clip/contain/transform) and fixed descendants of the host.
async function item3(browser, s) {
  const { ctx, p } = await page(browser, s);
  await p.goto(s.base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
  await playMuted(p);
  const out = await p.evaluate(() => {
    const h = document.getElementById('player-wrapper');
    const anc = [];
    for (let n = h; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const flags = {};
      for (const k of ['overflowX', 'overflowY', 'contain', 'transform', 'filter', 'clipPath', 'position', 'zIndex', 'isolation', 'willChange', 'perspective', 'containerType']) {
        const v = cs[k]; if (v && !['visible', 'none', 'static', 'auto', 'normal'].includes(v)) flags[k] = v;
      }
      anc.push({ el: n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : ''), flags });
    }
    const fixed = [];
    h.querySelectorAll('*').forEach((n) => { const cs = getComputedStyle(n); if (cs.position === 'fixed') fixed.push({ el: n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + '.' + String(n.className).trim().split(/\s+/).join('.'), display: cs.display }); });
    return { ancestors: anc, fixedDescendantsInline: fixed };
  });
  await ctx.close();
  return out;
}

// Item 5: reparent (dock()) on the drag's touchend: does it keep playing, and does a synthetic click land on the dock?
async function item5(browser, s, kind) {
  const { ctx, p } = await page(browser, s);
  await p.goto(s.base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
  await playMuted(p);
  await p.evaluate(() => {
    window.__clicks = []; window.__docked = false;
    document.addEventListener('click', (e) => { window.__clicks.push((e.target.id || e.target.className || e.target.tagName) + (document.getElementById('player-dock').contains(e.target) ? '@dock' : '')); }, true);
    window.addEventListener('touchend', () => { if (window.__arm) { window.__arm = false; window.FileTube.player.dock(); window.__docked = true; } }, { passive: true });
    window.__arm = true;
  });
  const r = await p.evaluate(() => { const r = document.getElementById('media-player').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const x = r.x + r.w / 2, y0 = r.y + r.h / 2;
  await p.touch('touchStart', x, y0);
  if (kind === 'drag150') { for (let i = 1; i <= 15; i++) { await p.touch('touchMove', x, y0 + i * 10); await p.waitForTimeout(16); } }
  if (kind === 'flick') { for (let i = 1; i <= 3; i++) { await p.touch('touchMove', x, y0 + i * 14); await p.waitForTimeout(10); } }
  await p.touch('touchEnd');
  await p.waitForTimeout(500);
  const a = await playerFacts(p);
  await p.waitForTimeout(2000);
  const b = await playerFacts(p);
  const clicks = await p.evaluate(() => window.__clicks);
  await ctx.close();
  return { gesture: kind, at500ms: a, at2500ms: b, clicks, advancing: b.t > a.t };
}

// Item 6: leave the watch view while ALREADY docked (R4's order), both landings, plus watch -> watch history.
async function item6(browser, s, flow) {
  const { ctx, p } = await page(browser, s);
  const log = [];
  if (flow === 'home-watch-back' || flow === 'home-watch2-watch1-back') {
    await p.goto(s.base + '/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
    if (flow === 'home-watch2-watch1-back') {
      await p.evaluate(() => window.FileTube.navigate('/watch.html?v=clip2'));
      await playMuted(p);
      log.push(['on clip2', await playerFacts(p)]);
    }
    await p.evaluate(() => window.FileTube.navigate('/watch.html?v=clip1'));
    await playMuted(p);
    await p.waitForTimeout(1500);
    log.push(['before', await playerFacts(p)]);
    await p.evaluate(() => { window.FileTube.player.dock(); history.back(); });
  } else {
    await p.goto(s.base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
    await playMuted(p);
    await p.waitForTimeout(1500);
    log.push(['before', await playerFacts(p)]);
    await p.evaluate(() => { window.FileTube.player.dock(); window.FileTube.navigate('/'); });
  }
  await p.waitForTimeout(800);
  log.push(['after800', await playerFacts(p)]);
  await p.waitForTimeout(2000);
  log.push(['after2800', await playerFacts(p)]);
  const errs = p.__errs;
  await ctx.close();
  return { flow, log, errs };
}

(async () => {
  const want = process.argv.slice(3);
  const has = (k) => !want.length || want.includes(k);
  const out = { runAt: new Date().toISOString() };
  const s = await start({ seconds: 60 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    if (has('1')) out.item1 = await item1(browser, s);
    if (has('2')) { out.item2 = []; for (const [sy, c] of [[0, 'none'], [0, 'pdAfter12'], [0, 'pdFromFirst'], [40, 'none'], [40, 'pdFromFirst']]) out.item2.push(await item2(browser, s, sy, c)); }
    if (has('3')) out.item3 = await item3(browser, s);
    if (has('5')) { out.item5 = []; for (const k of ['drag150', 'flick', 'tap']) out.item5.push(await item5(browser, s, k)); }
    if (has('6')) { out.item6 = []; for (const f of ['home-watch-back', 'deeplink-navigate-home', 'home-watch2-watch1-back']) out.item6.push(await item6(browser, s, f)); }
  } catch (e) { out.error = String(e.stack || e); }
  await browser.close(); await s.stop();
  fs.writeFileSync(process.argv[2] || 'probe-w0.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})();
