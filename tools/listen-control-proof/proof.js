'use strict';
/* global window, document */
// END-TO-END PROOF (v1.348 W4): two real browser contexts (a desktop with autoplay blocked, an iPhone-sized
// phone) against the real server, same user. Measures plan section 5 W4 items a-h. Not a CI gate.
//   node tools/listen-control-proof/proof.js out.json
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const SNAP = () => window.FileTube.player.getRemoteSnapshot();

// A pass-through proxy that HOLDS an SSE response until 16 KB have accumulated (a buffering reverse proxy).
function bufferingProxy(targetPort) {
  const srv = http.createServer((req, res) => {
    const up = http.request({ host: '127.0.0.1', port: targetPort, path: req.url, method: req.method, headers: req.headers }, (ur) => {
      const sse = /text\/event-stream/.test(ur.headers['content-type'] || '');
      res.writeHead(ur.statusCode, ur.headers);
      if (!sse) { ur.pipe(res); return; }
      let held = Buffer.alloc(0);
      ur.on('data', (c) => { held = Buffer.concat([held, c]); if (held.length >= 16384) { res.write(held); held = Buffer.alloc(0); } });
      ur.on('end', () => res.end(held));
      res.on('close', () => ur.destroy());
    });
    req.pipe(up);
    up.on('error', () => res.destroy());
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

async function timed(fn) { const t = Date.now(); const v = await fn(); return { ms: Date.now() - t, v }; }

async function scenario(base, cookie, browser, o) {
  const out = {};
  const mk = async (opts) => { const c = await browser.newContext(opts); await c.addCookies([cookie]); return c; };
  const pcCtx = await mk({ viewport: { width: 1280, height: 800 } });
  const phCtx = await mk(Object.assign({}, pw.devices['iPhone 13'], { viewport: { width: 390, height: 844 } }));
  await phCtx.addInitScript(() => { try { localStorage.setItem('ft-music-skin', 'ipod-2004'); } catch { /* */ } });
  const d = await pcCtx.newPage();
  const pcWait = (fn, arg, opts) => d.waitForFunction(([src, a]) => (0, eval)('(' + src + ')')(window.FileTube.player.getRemoteSnapshot(), a), [fn.toString(), arg], opts);
  const p = await phCtx.newPage();
  const errs = [];
  d.on('pageerror', (e) => errs.push('PC ' + e.message)); p.on('pageerror', (e) => errs.push('PHONE ' + e.message));
  const phoneReqs = []; p.on('request', (r) => phoneReqs.push(r.url()));

  await p.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#handoff-card{display:none!important}'; document.head.appendChild(st); }); });
  await d.goto(base + '/music', { waitUntil: 'networkidle' });
  await p.goto(base + '/music', { waitUntil: 'networkidle' });
  // the phone needs a local track once for the skin to exist; it is silenced when the PC is chosen
  await p.click('.music-album-card'); await p.waitForSelector('.music-song-row');
  await p.click('.music-song-row'); await p.waitForSelector('.mms-full');
  await p.waitForTimeout(600);
  const rows = () => p.evaluate(() => Array.from(document.querySelectorAll('[data-skin-mi]')).map((e) => e.textContent.trim()));
  const menuRoot = async () => { for (let i = 0; i < 6; i++) { const r = await rows(); if (r.includes('Play on...') && r.includes('Shuffle Songs')) return; await p.click('[data-skin-menu]'); await p.waitForTimeout(250); } };
  const songs = async (title) => {
    await menuRoot();
    await p.locator('[data-skin-mi]', { hasText: /^Music/ }).first().click(); await p.waitForTimeout(300);
    await p.locator('[data-skin-mi]', { hasText: /^Songs/ }).first().click(); await p.waitForFunction(() => document.querySelectorAll('[data-skin-mi]').length >= 3);
    await p.locator('[data-skin-mi]', { hasText: title }).first().click();
  };
  const phoneText = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }, sel);

  if (o.wait) await d.waitForTimeout(o.wait);
  // a. PC turns Remote control on; the phone's Play on... lists it
  const tOn = Date.now();
  await d.click('#music-remote-btn');
  await p.click('[data-skin-menu]'); await p.waitForTimeout(150);
  await menuRoot();
  await p.locator('[data-skin-mi]', { hasText: 'Play on' }).click();
  await p.locator('[data-skin-mi]', { hasText: 'Linux PC' }).waitFor();
  out.a_listed_ms = Date.now() - tOn;
  await p.locator('[data-skin-mi]', { hasText: 'Linux PC' }).click();
  out.a_phone_local_paused_after_pick = await p.evaluate(() => document.getElementById('media-player').paused);
  await p.waitForFunction(() => /on linux pc/i.test(document.body.innerText));
  const badge = await phoneText('.mms-remote'); out.a_badge = badge;

  // b. the phone plays a song; the PC reports it playing
  const b = await timed(async () => { await songs('Proof Song 2'); await pcWait(((S) => { const s = S; return s.id === 'song2' && s.playing; }), null, { polling: 25, timeout: 15000 }); });
  out.b_pc_playing_ms = b.ms;
  out.b_phone_local_loaded_song2 = phoneReqs.some((u) => /\/video\/song2/.test(u));
  out.b_phone_local_paused = await p.evaluate(() => document.getElementById('media-player').paused);
  await p.waitForFunction(() => /Proof Song 2/.test(document.body.innerText), null, { timeout: 5000 });
  out.b_mirror_title = await phoneText('.ip-ttl');

  // c. toggle / next / prev / seek
  const pcSnap = () => d.evaluate(SNAP);
  const c1 = await timed(async () => { await p.click('[data-skin-play]'); await pcWait(((S) => !S.playing), null, { polling: 25, timeout: 5000 }); });
  out.c_pause_ms = c1.ms;
  const c1m = await timed(() => p.waitForFunction(() => !!document.querySelector('.ip-playind.is-paused, .mms-playind.is-paused'), null, { polling: 25, timeout: 5000 }).catch(() => null));
  out.c_pause_mirror_ms = c1.ms + c1m.ms;
  const c2 = await timed(async () => { await p.click('[data-skin-play]'); await pcWait(((S) => S.playing), null, { polling: 25, timeout: 5000 }); });
  out.c_resume_ms = c2.ms;
  const before = (await pcSnap()).id;
  const c3 = await timed(async () => { await p.click('[data-skin-next]'); await pcWait(((S, b0) => { const s = S; return s.id && s.id !== b0; }), before, { polling: 25, timeout: 5000 }); });
  out.c_next_ms = c3.ms; const afterNext = (await pcSnap()).id; out.c_next_id = before + ' -> ' + afterNext;
  const wantTitle = 'Proof Song ' + afterNext.replace('song', '');
  const c3m = await timed(() => p.waitForFunction((t) => { const e = document.querySelector('.ip-ttl'); return !!e && e.textContent.trim() === t; }, wantTitle, { polling: 25, timeout: 5000 }));
  out.c_next_mirror_ms = c3.ms + c3m.ms; out.c_mirror_title_after_next = await phoneText('.ip-ttl');
  const c4 = await timed(async () => { await p.click('[data-skin-prev]'); await pcWait(((S, b0) => S.id === b0), before, { polling: 25, timeout: 5000 }).catch(() => null); });
  out.c_prev_ms = c4.ms; out.c_prev_id = (await pcSnap()).id;
  // seek to 50% of the bar (the song is 120 s: ~60 s)
  const bar = await p.locator('[data-skin-seek]').boundingBox(); out.c_seek_bar = bar; out.c_snap_before_seek = await pcSnap();
  const c5 = await timed(async () => { await p.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2); await pcWait(((S) => { const s = S; return s.position > 50 && s.position < 75; }), null, { polling: 25, timeout: 5000 }).catch(async (e) => { out.c_seek_fail = { snap: await pcSnap(), pos: await phoneText('.mms-pos'), msg: e.message.slice(0, 60) }; }); });
  out.c_seek_ms = c5.ms; out.c_seek_position = Math.round((await pcSnap()).position);
  const c5m = await timed(() => p.waitForFunction(() => { const t = document.querySelector('.mms-pos'); const m = t && /^(\d+):(\d\d)$/.exec(t.textContent.trim()); return !!m && Number(m[1]) * 60 + Number(m[2]) >= 55; }, null, { polling: 25, timeout: 5000 }));
  out.c_seek_mirror_ms = c5.ms + c5m.ms; out.c_phone_pos_label = await phoneText('.mms-pos');
  out.c_phone_local_loaded_anything_new = phoneReqs.filter((u) => /\/video\/song[23]/.test(u)).length;

  if (o.skipRest) { out.errors = errs; await pcCtx.close(); await phCtx.close(); return out; }

  // d. the PC navigates Home in-app: playback continues, the pill stays, the phone's next still works
  await d.evaluate(() => window.FileTube.navigate('/')); await d.waitForTimeout(800);
  out.d_pc_path = await d.evaluate(() => window.location.pathname);
  out.d_still_playing = (await pcSnap()).playing; out.d_pill_visible = await d.evaluate(() => { const e = document.getElementById('remote-pill'); return !!e && !e.hidden; });
  const dBefore = (await pcSnap()).id;
  const d1 = await timed(async () => { await p.click('[data-skin-next]'); await pcWait(((S, b0) => { const s = S; return s.id && s.id !== b0; }), dBefore, { polling: 25, timeout: 5000 }); });
  out.d_next_on_home_ms = d1.ms;

  // e. the phone sends a NEW play while the PC is on Home: the PC moves to /music and plays it (D7)
  const e1 = await timed(async () => { await songs('Proof Song 1'); await pcWait(((S) => { const s = S; return s.id === 'song1' && s.playing; }), null, { polling: 25, timeout: 15000 }); });
  out.e_play_from_home_ms = e1.ms; out.e_pc_path = await d.evaluate(() => window.location.pathname);

  // f. the PC reloads (no click): the phone plays; the PC should report blocked
  await d.reload({ waitUntil: 'networkidle' }); await d.waitForTimeout(1500);
  out.f_phone_controlling_after_reload = await p.evaluate(() => sessionStorage.getItem('ft-remote-controlling'));
  if (!out.f_phone_controlling_after_reload) {
    await menuRoot(); await p.locator('[data-skin-mi]', { hasText: 'Play on' }).click();
    await p.locator('[data-skin-mi]', { hasText: 'Linux PC' }).click();
    await p.waitForFunction(() => /on linux pc/i.test(document.body.innerText));
  }
  await songs('Proof Song 3');
  await d.waitForTimeout(3000);
  out.f_pc_snapshot = await pcSnap();
  out.f_phone_text = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').match(/click the pc's tab[^|]*/i)?.[0] || null);
  out.f_pc_reported_state = await p.evaluate(async () => (await (await fetch('/api/remote/targets?deviceId=' + encodeURIComponent(window.FileTube.getDeviceId()))).json()).map((t) => t.state && t.state.state));

  // g. the PC closes its tab: the phone drops to local mode, toasts, silent
  out.g_controlling_before_close = await p.evaluate(() => sessionStorage.getItem('ft-remote-controlling'));
  const g = await timed(async () => { await d.close(); await p.waitForFunction(() => !sessionStorage.getItem('ft-remote-controlling'), null, { polling: 25, timeout: 20000 }); });
  out.g_phone_back_to_local_ms = g.ms;
  out.g_toast_seen = await p.evaluate(() => /Lost Linux PC/.test(document.body.innerText));
  out.g_phone_local_paused = await p.evaluate(() => document.getElementById('media-player').paused);
  out.g_controlling_key = await p.evaluate(() => sessionStorage.getItem('ft-remote-controlling'));
  out.errors = errs;
  await pcCtx.close(); await phCtx.close();
  return out;
}

(async () => {
  const s = await start({ seconds: 120 });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
  const result = {};
  result.direct = await scenario(s.base, s.cookie, browser, {});
  fs.writeFileSync('/tmp/claude-1000/proof-partial.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.direct, null, 2));
  const proxy = await bufferingProxy(Number(new URL(s.base).port));
  const pbase = 'http://127.0.0.1:' + proxy.address().port;
  const pcookie = Object.assign({}, s.cookie, { url: pbase });
  result.buffering_proxy = await scenario(pbase, pcookie, browser, { wait: 0, skipRest: true });
  await browser.close();
  try { proxy.closeAllConnections(); proxy.close(); } catch { /* */ }
  await s.stop();
  const file = process.argv[2] || path.join(__dirname, 'proof-out.json');
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
