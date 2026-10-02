'use strict';
/* global window, document, MouseEvent */
// END-TO-END PROOF (v1.357 W0.3 / W2.4): the speaker's song is marked in the phone's iPod lists. Real server
// (serve.js, three seeded songs of Proof Album), two real browser contexts as one user: a speaker PC
// (/music?remote=on) and an iPhone-class phone on the ipod skin. The phone picks Play on... the PC, plays the
// album there, opens Music > Albums > Proof Album, taps song 2, then MENU back to the album's list. Records, at
// each step: the rows marked .is-current, the phone's own player currentId (what effectiveCurrentId reads
// today), RC.state().track.id (the speaker's report). The PC then moves to song 3: the mark must follow.
// Leaving the speaker returns the list to the phone's own player. Speaker reads use raw CDP userGesture:false.
// Not a CI gate.
//   node tools/listen-control-proof/highlight-proof.js [out.json]
const fs = require('node:fs');
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
  const sev = async (fn) => { const r = await cdp.send('Runtime.evaluate', { expression: '(' + fn.toString() + ')()', returnByValue: true, awaitPromise: true, userGesture: false }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
  await sp.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
  const id = await sev(() => window.FileTube.getDeviceId());
  const phCtx = await b.newContext(Object.assign({}, pw.devices['iPhone 13'], { viewport: { width: 390, height: 844 } }));
  await phCtx.addCookies([srv.cookie]);
  await phCtx.addInitScript(() => { try { localStorage.setItem('ft-music-skin', 'ipod'); } catch { /* */ } });
  const p = await phCtx.newPage();
  p.on('pageerror', (e) => errs.push('PHONE ' + e.message));
  await p.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#handoff-card{display:none!important}'; document.head.appendChild(st); }); });
  await p.goto(srv.base + '/music', { waitUntil: 'networkidle' });
  const until = async (fn, ms) => { const end = Date.now() + (ms || 10000); for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 150)); } };
  const click = (sel) => p.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }, sel);
  const tapRow = (label) => p.evaluate((l) => { const r = Array.from(document.querySelectorAll('[data-skin-mi]')).find((x) => x.textContent.trim().startsWith(l)); if (!r) return false; r.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }, label);
  const snap = () => p.evaluate(() => {
    const rc = window.FileTube.remoteControl.state();
    return {
      title: (document.querySelector('.ip-np') || {}).textContent || null,
      marked: Array.from(document.querySelectorAll('.mms-full [data-skin-mi].is-current')).map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
      markedElsewhere: Array.from(document.querySelectorAll('.mms-full .is-current')).filter((r) => !r.matches('[data-skin-mi]')).map((r) => r.className + ' | ' + r.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)),
      rows: Array.from(document.querySelectorAll('.mms-full [data-skin-mi]')).map((r) => r.textContent.replace(/\s+/g, ' ').trim() + (r.classList.contains('is-current') ? ' [current]' : '') + (r.querySelector('.ipm-now') ? ' [glyph]' : '')),
      phonePlayerCurrentId: (window.FileTube.player && window.FileTube.player.currentId) || null,
      speakerTrackId: rc && rc.track ? rc.track.id : null,
      remote: window.FileTube.remoteControl.isRemote(),
    };
  });
  await p.evaluate((t) => window.FileTube.remoteControl.select({ deviceId: t, label: 'Linux PC' }), id);
  await p.evaluate(() => window.FileTube.remoteControl.play(['song1', 'song2', 'song3'], 0));
  out.speaker_playing = await until(() => p.evaluate(() => { const s = window.FileTube.remoteControl.state(); return s && s.state === 'playing' && s.track && s.track.id; }));
  await p.waitForSelector('.mms-full .ip-lcd-in', { timeout: 15000 });
  // open the album's list: MENU > Music > Albums > Proof Album
  await click('[data-skin-menu]'); await p.waitForTimeout(250);
  out.step_menu = await snap();
  out.tap_music = await tapRow('Music'); await p.waitForTimeout(300);
  out.tap_albums = await tapRow('Albums'); await p.waitForTimeout(500);
  out.tap_album = await tapRow('Proof Album'); await p.waitForTimeout(500);
  out.step_album_before = await snap();
  out.tap_song2 = await tapRow('Proof Song 2');
  out.pc_after_pick = await until(async () => { const s = await sev(() => window.FileTube.player.getRemoteSnapshot().id); return s === 'song2' && s; });
  await p.waitForTimeout(500);
  out.step_after_pick = await snap();
  // MENU back to the album's list
  await click('[data-skin-menu]'); await p.waitForTimeout(500);
  out.step_back_to_album = await snap();
  // the PC moves to the next song
  await sev(() => { window.FileTube.player.next(); return true; });
  out.pc_next = await until(async () => { const s = await sev(() => window.FileTube.player.getRemoteSnapshot().id); return s === 'song3' && s; });
  const tNext = Date.now();
  out.mark_follows_ms = await until(async () => { const s = await snap(); return s.marked.some((m) => m.includes('Proof Song 3')) ? Date.now() - tNext : null; }, 6000);
  out.step_after_next = await snap();
  // leaving the speaker: the list returns to the phone's own player (idle: nothing marked)
  await p.evaluate(() => window.FileTube.remoteControl.leave());
  await p.waitForTimeout(800);
  out.step_after_leave = await snap();
  out.errors = errs;
  await b.close(); await srv.stop();
  const file = process.argv[2];
  if (file) fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
