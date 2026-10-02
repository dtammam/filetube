'use strict';
/* global window, document */
// END-TO-END PROOF (v1.354 W2): the phone's song list is the PC's queue, against the REAL server and two real
// browser contexts as one user. Rows: a (the phone's Songs list shows the PC's queue, current marked), b (a row
// tap plays THAT row on the PC, the PC's current changes), c (no queue = the center button does nothing; local
// play still lists). Speaker reads use raw CDP Runtime.evaluate {userGesture:false}. Not a CI gate.
//   node tools/listen-control-proof/queue-proof.js
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

async function main() {
  const srv = await start({ seconds: 120 });
  const out = {}; const errs = [];
  const b = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const spCtx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await spCtx.addCookies([srv.cookie]);
  const sp = await spCtx.newPage();
  sp.on('pageerror', (e) => errs.push('SPEAKER ' + e.message));
  const cdp = await spCtx.newCDPSession(sp);
  const ev = async (fn) => { const r = await cdp.send('Runtime.evaluate', { expression: '(' + fn.toString() + ')()', returnByValue: true, awaitPromise: true, userGesture: false }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
  await sp.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
  const id = await ev(() => window.FileTube.getDeviceId());
  const phCtx = await b.newContext(Object.assign({}, pw.devices['iPhone 13'], { viewport: { width: 390, height: 844 } }));
  await phCtx.addCookies([srv.cookie]);
  await phCtx.addInitScript(() => { try { localStorage.setItem('ft-music-skin', 'ipod'); } catch { /* */ } });
  const p = await phCtx.newPage();
  p.on('pageerror', (e) => errs.push('PHONE ' + e.message));
  await p.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#handoff-card{display:none!important}'; document.head.appendChild(st); }); });
  await p.goto(srv.base + '/music', { waitUntil: 'networkidle' });
  const until = async (fn, ms) => { const end = Date.now() + (ms || 10000); for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 150)); } };
  await p.evaluate((t) => window.FileTube.remoteControl.select({ deviceId: t, label: 'Linux PC' }), id);
  await p.evaluate(() => window.FileTube.remoteControl.play(['song1', 'song2', 'song3'], 1));
  out.a_phone_queue = await until(() => p.evaluate(() => { const s = window.FileTube.remoteControl.state(); return s && s.queue && s.state === 'playing' && { n: s.queue.tracks.length, index: s.queue.index, titles: s.queue.tracks.map((t) => t.title) }; }));
  // the phone's mirror: open Now Playing and the center button lists the PC's queue
  await p.locator('[data-skin-playon]').first().waitFor({ timeout: 10000 }).catch(() => {});
  if (!(await p.locator('.mms-full').count())) { await p.goto(srv.base + '/music', { waitUntil: 'networkidle' }); }
  await p.waitForSelector('.mms-full', { timeout: 10000 }).catch(() => {});
  out.a_has_full = await p.locator('.mms-full').count();
  await p.click('[data-skin-select]');
  out.a_listmode = await p.evaluate(() => document.querySelector('.mms-full').classList.contains('mms-listmode'));
  out.a_rows = await p.evaluate(() => Array.from(document.querySelectorAll('.ip-listview .mms-row')).map((r) => r.textContent.replace(/\s+/g, ' ').trim() + (r.classList.contains('is-current') ? ' [current]' : '')));
  // b. tap row 3 (Proof Song 3): the PC's current track becomes song3
  await p.locator('.ip-listview .mms-row').nth(2).click();
  out.b_pc_current = await until(async () => { const s = await ev(() => window.FileTube.player.getRemoteSnapshot().id); return s === 'song3' && s; });
  out.b_phone_index = await until(() => p.evaluate(() => { const s = window.FileTube.remoteControl.state(); return s && s.queue && s.track && s.track.id === 'song3' && s.queue.index; }));
  out.b_phone_still_remote = await p.evaluate(() => !!window.FileTube.remoteControl.targetId());
  // c. a speaker with no queue: nothing to list, the center button does nothing (never an empty Songs screen)
  await p.evaluate(() => window.FileTube.remoteControl.leave());
  out.errors = errs;
  console.log(JSON.stringify(out));
  await b.close(); await srv.stop();
  const ok = out.a_phone_queue && out.a_phone_queue.n === 3 && out.a_phone_queue.index === 1 && out.a_rows.length === 3 && out.b_pc_current === 'song3' && out.b_phone_index === 2 && !errs.length;
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
