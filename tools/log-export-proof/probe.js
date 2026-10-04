'use strict';
/* global window, document */
// v1.362.2 reachability (plan 2026-10-04-loupe-black-checks, W1 + W2): the REAL server and the branch's product
// code in Chromium (iPhone 13 emulation, raw CDP touch, the custom-controls setting forced on). Not a CI gate.
//   node tools/log-export-proof/probe.js out.json
// W1 (D1): a tap on the playing picture, then a second touch at +200 ms is cancelled and at +450 ms is not;
// an upward drag that starts on the picture 1 s after a tap scrolls the page, one inside 0.35 s does not.
// v1.362.2 ONLY: since v1.362.3 (E1) every picture touch is cancelled, so these two W1 rows read
// [true,true,true,true] and 0 px there by design; the W2 export rows still hold.
// W2 (D5, D6): the lifecycle log on, play with the BAR's button, a speed change, then Settings >
// Troubleshooting > Export log pressed with a real touch while navigator.share is ABSENT: the clipboard holds
// the exported text, and it carries media:play via=bar-button and a media:rate line. No panel on screen.
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('../minimize-proof/serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

(async () => {
  const outFile = process.argv[2] || path.join(__dirname, 'probe-result.json');
  const out = { runAt: new Date().toISOString(), rows: {} };
  const s = await start({ seconds: 60 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  try {
    const ctx = await browser.newContext(Object.assign({}, pw.devices['iPhone 13'], { hasTouch: true }));
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: s.base });
    await ctx.addCookies([s.cookie]);
    await ctx.route('**/api/settings', async (route) => { const r = await route.fetch(); let j = {}; try { j = await r.json(); } catch { /* */ } j.mobileCustomPlayer = true; await route.fulfill({ response: r, json: j }); });
    // File sharing absent (the desktop / no-share case): the export must take the clipboard.
    await ctx.addInitScript(() => { try { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } catch { /* */ } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: (type === 'touchEnd' || type === 'touchCancel') ? [] : [{ x, y, id: 1 }] });
    const tapAt = async (x, y) => { await touch('touchStart', x, y); await p.waitForTimeout(40); await touch('touchEnd'); };
    await p.goto(s.base + '/?debugLifecycle=1', { waitUntil: 'networkidle' });
    out.rows.flagOn = await p.evaluate(() => localStorage.getItem('ft-debug-lifecycle'));
    await p.evaluate(() => localStorage.removeItem('ft-lifecycle-log'));
    await p.evaluate(() => window.FileTube.navigate('/watch.html?v=clip1'));
    await p.waitForTimeout(1200);
    // Every touchstart's defaultPrevented, read AFTER the player's listeners (a bubble listener on window).
    await p.evaluate(() => { window.__ts = []; window.addEventListener('touchstart', (e) => { window.__ts.push({ prevented: e.defaultPrevented, at: Date.now() }); }, { passive: true }); });
    const geo = await p.evaluate(() => { const r = document.getElementById('media-player').getBoundingClientRect(); const pp = document.getElementById('pp-btn').getBoundingClientRect(); return { mid: [r.x + r.width * 0.75, r.y + r.height / 2], pp: [pp.x + pp.width / 2, pp.y + pp.height / 2] }; });
    out.geo = geo;
    // ---- W2 first: pause, then play with the BAR's button (a real touch), then a speed change ----
    await p.evaluate(() => { const v = document.getElementById('media-player'); v.muted = true; v.pause(); });
    await p.waitForTimeout(300);
    // The bar may be auto-hidden: a first touch on it reveals, so wake it, then tap play.
    await tapAt(geo.pp[0], geo.pp[1]);
    await p.waitForTimeout(500);
    out.rows.playingAfterBar = await p.evaluate(() => !document.getElementById('media-player').paused);
    if (!out.rows.playingAfterBar) { await tapAt(geo.pp[0], geo.pp[1]); await p.waitForTimeout(500); out.rows.playingAfterBar2 = await p.evaluate(() => !document.getElementById('media-player').paused); }
    await p.evaluate(() => { document.getElementById('media-player').playbackRate = 1.5; });
    await p.waitForTimeout(200);
    await p.evaluate(() => { document.getElementById('media-player').playbackRate = 1; });
    // ---- W1: the tap pair ----
    await p.waitForTimeout(1200);
    await p.evaluate(() => { window.__ts.length = 0; });
    await tapAt(geo.mid[0], geo.mid[1]);
    await p.waitForTimeout(200);
    await touch('touchStart', geo.mid[0], geo.mid[1]); await touch('touchCancel');
    await p.waitForTimeout(1500);
    await tapAt(geo.mid[0], geo.mid[1]);
    await p.waitForTimeout(450);
    await touch('touchStart', geo.mid[0], geo.mid[1]); await touch('touchCancel');
    out.rows.tapPair = await p.evaluate(() => window.__ts.map((x) => x.prevented));
    // ---- W1: the scroll cost (an upward drag from the picture) ----
    await p.waitForTimeout(1500);
    const drag = async () => {
      const y0 = geo.mid[1] + 40; const x = geo.mid[0];
      await touch('touchStart', x, y0);
      for (let d = 15; d <= 150; d += 15) { await touch('touchMove', x, y0 - d); await p.waitForTimeout(16); }
      await touch('touchEnd'); await p.waitForTimeout(500);
    };
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(200);
    out.rows.pageScrollable = await p.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    await tapAt(geo.mid[0], geo.mid[1]); await p.waitForTimeout(1000);
    const y1a = await p.evaluate(() => window.scrollY); await drag(); const y1b = await p.evaluate(() => window.scrollY);
    out.rows.scrollOneSecondAfterTap = { before: y1a, after: y1b };
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(1500);
    await tapAt(geo.mid[0], geo.mid[1]); await p.waitForTimeout(150);
    const y2a = await p.evaluate(() => window.scrollY); await drag(); const y2b = await p.evaluate(() => window.scrollY);
    out.rows.scrollInsideWindow = { before: y2a, after: y2b };
    // ---- W2: no panel on screen; then Settings > Export log with a real touch ----
    out.rows.panelOnWatch = await p.evaluate(() => !!document.getElementById('ft-lifecycle-overlay'));
    out.rows.storedEntries = await p.evaluate(() => JSON.parse(localStorage.getItem('ft-lifecycle-log') || '[]').length);
    await p.evaluate(() => window.FileTube.navigate('/setup.html'));
    await p.waitForTimeout(1500);
    // Settings on a phone is a list of rows: tap Troubleshooting (a real touch), then reach the button.
    await p.evaluate(() => document.querySelector('[data-md-target="troubleshooting"]').scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(300);
    const row = await p.evaluate(() => { const r = document.querySelector('[data-md-target="troubleshooting"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await tapAt(row[0], row[1]);
    await p.waitForTimeout(600);
    await p.evaluate(() => document.getElementById('lifecycle-log-export-btn').scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(300);
    const eb = await p.evaluate(() => { const r = document.getElementById('lifecycle-log-export-btn').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    out.rows.shareAbsent = await p.evaluate(() => typeof navigator.share);
    out.rows.exportReach = await p.evaluate((pt) => {
      const el = document.elementFromPoint(pt[0], pt[1]);
      const btn = document.getElementById('lifecycle-log-export-btn').getBoundingClientRect();
      return { helper: typeof window.exportDiagnosticLog, hit: el ? (el.closest('button') || el).id : null, hitTag: el ? el.tagName + '.' + el.className : null, btn: [btn.x, btn.y, btn.width, btn.height], vh: window.innerHeight, clipboardApi: !!(navigator.clipboard && navigator.clipboard.writeText) };
    }, eb);
    await p.evaluate(() => { window.__exportOutcome = null; const orig = window.exportDiagnosticLog; window.exportDiagnosticLog = function (o) { const r = orig(o); Promise.resolve(r).then((v) => { window.__exportOutcome = v; }); return r; }; });
    await tapAt(eb[0], eb[1]);
    await p.waitForTimeout(800);
    out.rows.exportOutcome = await p.evaluate(() => window.__exportOutcome);
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    const lines = clip.split('\n');
    out.rows.export = {
      header: lines.slice(0, 6),
      lineCount: lines.length,
      barButtonPlay: lines.filter((l) => / media:play \(el=video via=bar-button g=\d+\)/.test(l)),
      rateLines: lines.filter((l) => / media:rate \(rate=/.test(l)),
      tapPairLines: lines.filter((l) => / gesture:tap-pair /.test(l)),
    };
    out.rows.panelOnSettings = await p.evaluate(() => !!document.getElementById('ft-lifecycle-overlay'));
    out.rows.buttons = await p.evaluate(() => ['lifecycle-log-export-btn', 'lifecycle-log-clear-btn'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, x: r.x, y: r.y, w: r.width, h: r.height }; }));
  } catch (e) { out.error = String(e && e.stack || e); } finally {
    out.pageErrors = errs;
    await browser.close(); await s.stop();
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
    console.log(JSON.stringify(out, null, 2));
  }
})();
