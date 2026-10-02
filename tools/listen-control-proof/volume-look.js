'use strict';
/* global window, document */
// v1.353 V2 LOOK: a phone (iPhone 13) controlling a speaker, Now Playing with the volume bar up, shot
// per skin through CDP Page.captureScreenshot (LESSONS 13: page.screenshot resets the emulated screen).
//   node tools/listen-control-proof/volume-look.js <outdir>
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const SKINS = (process.env.SKINS || 'ipod,ipod-silver,ipod-nano3-silver,ipod-blue,apple,spotify').split(',');

async function main() {
  const outDir = process.argv[2] || '/tmp/volume-look';
  fs.mkdirSync(outDir, { recursive: true });
  const srv = await start({ seconds: 120 });
  const b = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const spCtx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await spCtx.addCookies([srv.cookie]);
  const sp = await spCtx.newPage();
  await sp.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
  const id = await sp.evaluate(() => window.FileTube.getDeviceId());
  const out = { shots: [], errors: [] };
  sp.on('pageerror', (e) => out.errors.push('SPEAKER ' + e.message));
  for (const skin of SKINS) {
    const ph = await b.newContext(Object.assign({}, pw.devices['iPhone 13'], { viewport: { width: 390, height: 844 } }));
    await ph.addCookies([srv.cookie]);
    await ph.addInitScript((s) => { try { localStorage.setItem('ft-music-skin', s); } catch { /* */ } }, skin);
    const p = await ph.newPage();
    p.on('pageerror', (e) => out.errors.push(skin + ' PHONE ' + e.message));
    await p.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#handoff-card{display:none!important}'; document.head.appendChild(st); }); });
    await p.goto(srv.base + '/music', { waitUntil: 'networkidle' });
    await p.click('.music-album-card'); await p.waitForSelector('.music-song-row');
    await p.click('.music-song-row'); await p.waitForSelector('.mms-full');
    await p.evaluate((tid) => window.FileTube.remoteControl.select({ deviceId: tid, label: 'Linux PC' }), id);
    await p.evaluate(() => window.FileTube.remoteControl.play(['song2'], 0));
    await p.waitForFunction(() => { const s = window.FileTube.remoteControl.state(); return s && s.state === 'playing' && typeof s.volume === 'number'; }, null, { timeout: 15000 });
    await p.evaluate(() => window.FileTube.remoteControl.volume(0.6));
    await p.waitForTimeout(1200);
    const cdp = await ph.newCDPSession(p);
    const shot = async (name) => { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); const f = path.join(outDir, skin + '-' + name + '.png'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); out.shots.push(f); };
    await shot('scrubber');
    const tap = await p.$('[data-skin-voltap]');
    if (tap) { await tap.click(); await p.waitForTimeout(300); await shot('volume'); }
    out[skin] = await p.evaluate(() => ({ voladj: document.querySelector('.mms-full').classList.contains('mms-voladj'), fill: (document.querySelector('.ip-vol-fill') || { style: {} }).style.width || null, row: !!document.querySelector('.mms-volrow'), aria: (document.querySelector('[data-skin-vol]') || { getAttribute: () => null }).getAttribute('aria-valuenow') }));
    await ph.close();
  }
  out.pc_volume = await sp.evaluate(() => document.getElementById('media-player').volume);
  await b.close(); await srv.stop();
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
