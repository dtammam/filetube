'use strict';
/* global window, document */
// HEADLESS PROOF (v1.354 W3): turning the phone, with ?debugRotate=1 on. For angle 90 and 270 (and back to 0) it
// emulates the screen orientation (CDP Emulation.setDeviceMetricsOverride) and reads the instrument's rows: the
// first frame whose orientation query says landscape must already carry html[data-ft-rot] = the new angle.
// Headless Chromium paints no wrong frame the way iOS does, so this proves the stamp's TIMING (same step as the
// layout), not the iOS paint; the device recording is the judge. Not a CI gate.
//   node tools/listen-control-proof/turn-proof.js
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

async function main() {
  const srv = await start({ seconds: 30 });
  const b = await pw.chromium.launch();
  const ctx = await b.newContext(Object.assign({}, pw.devices['iPhone 13']));
  await ctx.addCookies([srv.cookie]);
  await ctx.addInitScript(() => { try { localStorage.setItem('ft-music-skin', 'ipod'); } catch { /* */ } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(srv.base + '/music?debugRotate=1', { waitUntil: 'networkidle' });
  const cdp = await ctx.newCDPSession(p);
  const out = { turns: [] };
  const turn = async (w, h, angle, type) => {
    await p.evaluate(() => { window.__ftRotateLog.length = 0; });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 3, mobile: true, screenOrientation: { angle, type } });
    await p.waitForTimeout(1500);
    const rows = await p.evaluate(() => window.__ftRotateLog.filter((r) => 'iw' in r).map((r) => ({ t: r.t, pre: !!r.pre, land: r.land, ang: r.ang, rot: r.rot })));
    const landWanted = w > h;
    const first = rows.find((r) => !r.pre && r.land === landWanted);
    const final = await p.evaluate(() => document.documentElement.getAttribute('data-ft-rot'));
    out.turns.push({ angle, rows: rows.length, firstLayoutRow: first, final });
    return first && first.rot === String(angle) && final === String(angle);
  };
  const ok = [
    await turn(844, 390, 90, 'landscapePrimary'),
    await turn(390, 844, 0, 'portraitPrimary'),
    await turn(844, 390, 270, 'landscapeSecondary'),
    await turn(390, 844, 0, 'portraitPrimary'),
  ];
  out.ok = ok; out.errors = errs;
  console.log(JSON.stringify(out));
  await b.close(); await srv.stop();
  process.exit(ok.every(Boolean) && !errs.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
