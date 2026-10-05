'use strict';
/* global document, getComputedStyle */
// v1.363 (plan 2026-10-05-resume-prompt-choice) W3: the real server, a real iPhone 13 Chromium, a seeded progress row (80 s of a
// 120 s clip). Ask me -> the prompt opens paused at 0, the countdown fires Resume to ~80 s; a touch cancels the countdown and the
// prompt stays; Resume automatically -> the "Resumed at" note and no prompt. Also reads every ancestor of the video for a
// filter / opacity (LESSONS 7) while the prompt shows. Not a CI gate.
//   node tools/minimize-proof/probe-resume-prompt.js out.json
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

(async () => {
  const outFile = process.argv[2] || path.join(__dirname, 'probe-resume-prompt-result.json');
  const out = { runAt: new Date().toISOString(), rows: {} };
  const s = await start({ seconds: 120 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  async function openCase(name, store) {
    const ctx = await browser.newContext(Object.assign({}, pw.devices['iPhone 13'], { hasTouch: true, colorScheme: 'dark' }));
    await ctx.addCookies([s.cookie]);
    await ctx.addInitScript((kv) => { for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]); }, store);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await p.goto(s.base + '/watch.html?v=clip1', { waitUntil: 'networkidle' });
    return { ctx, p };
  }
  const snap = (p) => p.evaluate(() => {
    const v = document.getElementById('media-player');
    const o = document.getElementById('resume-overlay');
    const t = document.getElementById('resume-toast');
    const yes = document.getElementById('resume-yes-btn');
    const w = document.getElementById('player-wrapper');
    let anc = 1; let filt = 'none';
    for (let n = w; n && n !== document.documentElement; n = n.parentElement) { const cs = getComputedStyle(n); anc = Math.min(anc, Number(cs.opacity)); if (cs.filter !== 'none' || cs.backdropFilter !== 'none') filt = n.tagName + '#' + n.id; }
    return { time: Math.round(v.currentTime * 10) / 10, paused: v.paused, prompt: o ? !o.hidden : null, promptTime: (document.getElementById('resume-prompt-time') || {}).textContent, toast: t ? !t.hidden : null,
      yesLabel: yes ? yes.textContent : null, armed: yes ? yes.classList.contains('countdown-armed') : null, ancestorOpacityMin: anc, ancestorFilter: filt };
  });
  try {
    // seed the saved position through the app's own endpoint
    const seed = await browser.newContext(); await seed.addCookies([s.cookie]);
    const sp = await seed.newPage(); await sp.goto(s.base + '/', { waitUntil: 'networkidle' });
    out.seed = await sp.evaluate(async () => { const r = await fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'clip1', timestamp: 80, duration: 120 }) }); return r.status; });
    await seed.close();

    let c = await openCase('ask-countdown', { filetube_resume_mode: 'ask' });
    await c.p.waitForTimeout(1200);
    out.rows.askOpen = await snap(c.p);
    await c.p.waitForTimeout(6500);
    out.rows.askAfterCountdown = await snap(c.p);
    await c.ctx.close();

    c = await openCase('ask-touch', { filetube_resume_mode: 'ask' });
    await c.p.waitForTimeout(1200);
    const cdp = await c.ctx.newCDPSession(c.p);
    const box = await c.p.evaluate(() => { const r = document.getElementById('resume-overlay').getBoundingClientRect(); return [r.x + r.width / 2, r.y + 20]; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box[0], y: box[1], id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await c.p.waitForTimeout(300);
    out.rows.askAfterTouch = await snap(c.p);
    await c.p.waitForTimeout(6500);
    out.rows.askTouchStillWaiting = await snap(c.p);
    await c.ctx.close();

    c = await openCase('auto', {});
    await c.p.waitForTimeout(1800);
    out.rows.autoLoad = await snap(c.p);
    await c.ctx.close();
  } catch (e) { out.error = String(e && e.stack || e); } finally {
    out.pageErrors = errs;
    await browser.close(); await s.stop();
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n');
    console.log(JSON.stringify(out));
  }
})();
