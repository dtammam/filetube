'use strict';
/* global window, document */
// END-TO-END PROOF (v1.353 V3): the phone sets the speaker's player volume, against the REAL server and
// two real browser contexts as one user. Rows (plan section 5 V3): a, b, c, d, plus c2 (a muted, never-
// clicked tab) and e-f (the whole phone UI chain: the time-label tap and the wheel; Speakers > Volume).
// Every SPEAKER read goes through raw CDP Runtime.evaluate {userGesture:false} (Playwright's
// page.evaluate grants a user gesture, LESSONS 2). Not a CI gate.
//   node tools/listen-control-proof/volume-proof.js out.json
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

async function speakerPage(ctx) {
  const page = await ctx.newPage();
  // measured (first full run): the handoff card ("Continue here") sits over the pill's text once this user
  // has played elsewhere, and a click there PLAYS; the proof's click is meant for the pill alone
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#handoff-card{display:none!important}'; document.head.appendChild(st); }); });
  const cdp = await ctx.newCDPSession(page);
  const ev = async (fn, arg) => {
    const expr = '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')';
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: false });
    if (r.exceptionDetails) throw new Error('speaker eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  const until = async (fn, arg, ms) => { const end = Date.now() + (ms || 8000); for (;;) { const v = await ev(fn, arg); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 100)); } };
  // a real mouse click (Input.dispatchMouseEvent, not el.click()) at a point; default: the pill's own text,
  // the spot it asks the user to click (measured: (640,700) is the player's click-to-toggle art)
  const realClick = async (pt) => {
    const p = pt || await ev(() => { const r = document.querySelector('#remote-pill .remote-pill-text').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  };
  return { page, ev, until, realClick };
}
const snap = (sp) => sp.ev(() => { const m = document.getElementById('media-player'); const s = window.FileTube.player.getRemoteSnapshot(); return { el: m ? { volume: m.volume, muted: m.muted, paused: m.paused } : null, snap: { volume: s.volume, muted: s.muted, playing: s.playing }, ftVolume: localStorage.getItem('ft-volume'), ftMuted: localStorage.getItem('ft-muted'), hasBeenActive: navigator.userActivation.hasBeenActive, pill: (function () { const e = document.getElementById('remote-pill'); return e ? (e.hidden ? 'hidden' : e.textContent) : 'none'; })() }; });

async function phone(ctx, base, skin) {
  if (skin) await ctx.addInitScript((s) => { try { localStorage.setItem('ft-music-skin', s); } catch { /* */ } }, skin);
  const p = await ctx.newPage();
  await p.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#handoff-card{display:none!important}'; document.head.appendChild(st); }); });
  await p.goto(base + (skin ? '/music' : '/'), { waitUntil: 'networkidle' });
  const rc = (fn, arg) => p.evaluate(fn, arg);
  const state = () => p.evaluate(() => window.FileTube.remoteControl.state());
  const targetState = async (id) => { const l = await p.evaluate(async () => (await (await fetch('/api/remote/targets?deviceId=' + encodeURIComponent(window.FileTube.getDeviceId()))).json())); const t = l.find((x) => x.deviceId === id); return t ? t.state : null; };
  const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 100)); } };
  return { p, rc, state, targetState, until };
}
const select = (ph, id) => ph.rc((tid) => window.FileTube.remoteControl.select({ deviceId: tid, label: 'Linux PC' }), id);
const playingWithVolume = (ph) => ph.until(async () => { const s = await ph.state(); return s && s.state === 'playing' && typeof s.volume === 'number' && s; }, 15000);

async function main() {
  const srv = await start({ seconds: 120 });
  const out = {}; const errs = [];
  const watch = (pg, tag) => pg.on('pageerror', (e) => errs.push(tag + ' ' + e.message));

  // ---- the kiosk (--autoplay-policy=no-user-gesture-required): rows a, b, c, d, e, f ----
  const kiosk = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  if (!process.env.ONLY_C2) {
    const spCtx = await kiosk.newContext({ viewport: { width: 1280, height: 800 } }); await spCtx.addCookies([srv.cookie]);
    const phCtx = await kiosk.newContext({ viewport: { width: 1280, height: 800 } }); await phCtx.addCookies([srv.cookie]);
    const sp = await speakerPage(spCtx); watch(sp.page, 'SPEAKER');
    await sp.page.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
    const id = await sp.ev(() => window.FileTube.getDeviceId());
    const ph = await phone(phCtx, srv.base); watch(ph.p, 'PHONE');
    await select(ph, id);
    await ph.rc(() => window.FileTube.remoteControl.play(['song1'], 0));
    await playingWithVolume(ph);

    // a. phone sets 30% -> the PC's element 0.3, ft-volume 0.3, and it survives a PC reload
    const tA = Date.now();
    await ph.rc(() => window.FileTube.remoteControl.volume(0.3));
    out.a_pc_volume = await sp.until(() => { const m = document.getElementById('media-player'); return m && Math.abs(m.volume - 0.3) < 1e-9 && m.volume; }, null, 4000);
    out.a_ms = Date.now() - tA;
    out.a_pc = await snap(sp);
    await sp.page.reload({ waitUntil: 'networkidle' });
    await sp.until(() => window.FileTube.remote.isOn(), null, 4000);
    out.a_after_reload_ft_volume = await sp.ev(() => localStorage.getItem('ft-volume'));
    out.a_after_reload_snapshot_volume = await sp.ev(() => window.FileTube.player.getRemoteSnapshot().volume);
    await select(ph, id); // the reload's pagehide ended the old session (/off)
    await ph.rc(() => window.FileTube.remoteControl.play(['song2'], 0));
    await playingWithVolume(ph);
    out.a_after_reload_element_volume = await sp.ev(() => document.getElementById('media-player').volume);
    out.a_after_reload_phone_volume = (await ph.state()).volume;

    // b. the PC's own slider to 80% -> the phone's state reads 0.8 within 2 s
    await sp.ev(() => { const b = document.getElementById('vol-bar'); b.value = '0.8'; b.dispatchEvent(new Event('input', { bubbles: true })); return true; });
    const tB = Date.now();
    out.b_phone = await ph.until(async () => { const s = await ph.state(); return s && s.volume === 0.8 && s.volume; }, 4000);
    out.b_ms = Date.now() - tB;
    out.b_targets_list_volume = (await ph.targetState(id)).volume;

    // c. volume 0 then 50% on an unclicked kiosk tab: no click hint at any point, sound resumes
    out.c_has_been_active = await sp.ev(() => navigator.userActivation.hasBeenActive);
    const hints = [];
    const sample = async (label) => { const s = await ph.state(); const pc = await snap(sp); hints.push({ label, state: s.state, needsClick: s.needsClick, volume: s.volume, pill: pc.pill, playing: pc.snap.playing, el: pc.el }); };
    await sample('before');
    await ph.rc(() => window.FileTube.remoteControl.volume(0));
    await sp.until(() => document.getElementById('media-player').volume === 0, null, 4000);
    for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 400)); await sample('at0-' + i); }
    await ph.rc(() => window.FileTube.remoteControl.volume(0.5));
    await sp.until(() => document.getElementById('media-player').volume === 0.5, null, 4000);
    for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 400)); await sample('at50-' + i); }
    out.c_samples = hints;
    out.c_any_hint = hints.some((h) => h.needsClick === true || /Click anywhere/.test(h.pill));
    out.c_all_playing = hints.every((h) => h.playing === true);
    out.c_has_been_active_after = await sp.ev(() => navigator.userActivation.hasBeenActive);

    // d. the Now Playing wheel still scrubs (position moves, volume unchanged): on a real phone skin
    const phCtx2 = await kiosk.newContext(Object.assign({}, pw.devices['iPhone 13'], { viewport: { width: 390, height: 844 } }));
    await phCtx2.addCookies([srv.cookie]);
    const m = await phone(phCtx2, srv.base, 'ipod'); watch(m.p, 'MOBILE');
    await m.p.click('.music-album-card'); await m.p.waitForSelector('.music-song-row');
    await m.p.click('.music-song-row'); await m.p.waitForSelector('.mms-full');
    await select(m, id);
    await m.rc(() => window.FileTube.remoteControl.play(['song3'], 0));
    await playingWithVolume(m);
    await m.p.waitForTimeout(800);
    const wheel = await m.p.locator('.ip-wheel').boundingBox();
    const cx = wheel.x + wheel.width / 2; const cy = wheel.y + wheel.height / 2; const R = wheel.width * 0.38;
    const spinDeg = async (from, to) => {
      const at = (d) => [cx + R * Math.cos(d * Math.PI / 180), cy + R * Math.sin(d * Math.PI / 180)];
      await m.p.mouse.move(...at(from)); await m.p.mouse.down();
      const step = to > from ? 10 : -10;
      for (let d = from + step; step > 0 ? d <= to : d >= to; d += step) { await m.p.mouse.move(...at(d)); await m.p.waitForTimeout(16); }
      await m.p.mouse.up();
    };
    const d0 = await snap(sp); const p0 = await sp.ev(() => window.FileTube.player.getRemoteSnapshot().position);
    await spinDeg(-60, 120);
    await m.p.waitForTimeout(1500);
    const p1 = await sp.ev(() => window.FileTube.player.getRemoteSnapshot().position);
    out.d_position_before = Math.round(p0 * 10) / 10; out.d_position_after = Math.round(p1 * 10) / 10;
    out.d_volume_before = d0.el.volume; out.d_volume_after = (await snap(sp)).el.volume;
    out.d_voladj = await m.p.evaluate(() => document.querySelector('.mms-full').classList.contains('mms-voladj'));

    // e. the whole phone chain: tap the time label, turn the wheel: the PC gets louder; MENU: back to the scrubber
    await m.p.click('.mms-rem[data-skin-voltap]');
    out.e_voladj_after_tap = await m.p.evaluate(() => document.querySelector('.mms-full').classList.contains('mms-voladj'));
    const e0 = (await snap(sp)).el.volume;
    const pe0 = await sp.ev(() => window.FileTube.player.getRemoteSnapshot().position);
    await spinDeg(-60, 120); // 180 deg clockwise = 8 detents = +40%
    await m.p.waitForTimeout(1200);
    const e1 = (await snap(sp)).el.volume;
    out.e_pc_volume_before = e0; out.e_pc_volume_after = e1;
    out.e_phone_bar_width = await m.p.evaluate(() => document.querySelector('.ip-vol-fill').style.width);
    out.e_position_drift = Math.round((await sp.ev(() => window.FileTube.player.getRemoteSnapshot().position) - pe0) * 10) / 10;
    await spinDeg(120, 30); // 90 deg back = 4 detents = -20%
    await m.p.waitForTimeout(1200);
    out.e_pc_volume_after_back = (await snap(sp)).el.volume;
    await m.p.click('[data-skin-menu]');
    out.e_voladj_after_menu = await m.p.evaluate(() => document.querySelector('.mms-full').classList.contains('mms-voladj'));
    await m.p.click('.mms-pos[data-skin-voltap]');
    const tIdle = Date.now();
    out.e_idle_closed = await m.p.waitForFunction(() => !document.querySelector('.mms-full').classList.contains('mms-voladj'), null, { timeout: 5000 }).then(() => true).catch(() => false);
    out.e_idle_ms = Date.now() - tIdle;

    // g. (gate r1, Dean) the PC muted with its OWN mute button: the phone's bar reads 0%; a step down does nothing;
    //    a step up un-mutes it at 5%
    await sp.ev(() => { document.getElementById('mute-btn').click(); return true; });
    out.g_pc_muted = await sp.until(() => { const m = document.getElementById('media-player'); return m.muted && { volume: m.volume, muted: m.muted }; }, null, 3000);
    out.g_phone_state = await m.until(async () => { const s = await m.state(); return s && s.muted === true && { volume: s.volume, muted: s.muted }; }, 4000);
    await m.p.click('.mms-pos[data-skin-voltap]');
    out.g_bar_width = await m.p.evaluate(() => document.querySelector('.ip-vol-fill').style.width);
    await spinDeg(60, 30); // one detent counter-clockwise
    await m.p.waitForTimeout(900);
    out.g_pc_after_down = (await snap(sp)).el;
    await spinDeg(0, 30); // one detent clockwise
    out.g_pc_after_up = await sp.until(() => { const m2 = document.getElementById('media-player'); return !m2.muted && { volume: m2.volume, muted: m2.muted, paused: m2.paused }; }, null, 4000);
    await m.p.waitForTimeout(800);
    out.g_bar_width_after_up = await m.p.evaluate(() => document.querySelector('.ip-vol-fill').style.width);
    await m.p.click('[data-skin-menu]');

    // f. Speakers > Volume: the badge opens Speakers, the Volume row lands on Now Playing with the bar up
    await m.p.click('[data-skin-playon]');
    await m.p.locator('[data-skin-mi]', { hasText: /^Volume$/ }).waitFor({ timeout: 5000 });
    await m.p.locator('[data-skin-mi]', { hasText: /^Volume$/ }).click();
    out.f_np = await m.p.evaluate(() => document.querySelector('.ip-np').textContent);
    out.f_voladj = await m.p.evaluate(() => document.querySelector('.mms-full').classList.contains('mms-voladj'));
    // and a phone NOT controlling a speaker has no Volume row
    await m.rc(() => window.FileTube.remoteControl.leave());
    await m.p.waitForTimeout(300);
    out.f_local_has_bar = await m.p.evaluate(() => !!document.querySelector('.ip-vol, [data-skin-voltap]'));
    await phCtx2.close();
    await spCtx.close(); await phCtx.close();
  }
  await kiosk.close();

  // ---- c2: a browser that needs a click; a never-clicked tab whose stored pref is MUTED ----
  const gesture = await pw.chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
  {
    const spCtx = await gesture.newContext({ viewport: { width: 1280, height: 800 } }); await spCtx.addCookies([srv.cookie]);
    const phCtx = await gesture.newContext({ viewport: { width: 1280, height: 800 } }); await phCtx.addCookies([srv.cookie]);
    await spCtx.addInitScript(() => { try { localStorage.setItem('ft-muted', '1'); } catch { /* */ } });
    const sp = await speakerPage(spCtx); watch(sp.page, 'SPEAKER-C2');
    await sp.page.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
    const id = await sp.ev(() => window.FileTube.getDeviceId());
    const ph = await phone(phCtx, srv.base); watch(ph.p, 'PHONE-C2');
    await select(ph, id);
    await ph.rc(() => window.FileTube.remoteControl.play(['song1'], 0));
    out.c2_muted_playing = await sp.until(() => { const m = document.getElementById('media-player'); return m && !m.paused && m.muted && 'muted+playing'; }, null, 8000);
    out.c2_phone_before = await ph.until(async () => { const s = await ph.state(); return s && s.state === 'playing' && { state: s.state, needsClick: s.needsClick, muted: s.muted }; }, 6000);
    await ph.rc(() => window.FileTube.remoteControl.volume(0.5));
    out.c2_pc_after_raise = await sp.until(() => { const m = document.getElementById('media-player'); return m && !m.muted && { paused: m.paused, muted: m.muted, volume: m.volume }; }, null, 4000);
    out.c2_phone_after_raise = await ph.until(async () => { const s = await ph.state(); return s && s.state !== 'playing' && { state: s.state, needsClick: s.needsClick }; }, 6000);
    out.c2_phone_hint_shown = await ph.p.evaluate(() => { const s = window.FileTube.remoteControl.state(); return !!(s && s.state !== 'playing' && (s.state === 'blocked' || s.needsClick === true)); });
    out.c2_click_target = await sp.ev(() => { const r = document.querySelector('#remote-pill .remote-pill-text').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e ? (e.tagName + '.' + String(e.className).slice(0, 60) + ' "' + e.textContent.slice(0, 60) + '"') : null; });
    await sp.realClick();
    await new Promise((r) => setTimeout(r, 600));
    out.c2_after_click = Object.assign({}, (await snap(sp)).el, { hasBeenActive: await sp.ev(() => navigator.userActivation.hasBeenActive) });
    await ph.rc(() => window.FileTube.remoteControl.toggle());
    out.c2_after_click_and_play = await ph.until(async () => { const s = await ph.state(); return s && s.state === 'playing' && s.state; }, 8000);
    await new Promise((r) => setTimeout(r, 1500));
    out.c2_pc_after = (await snap(sp)).el;
    out.c2_phone_after = await ph.p.evaluate(() => { const s = window.FileTube.remoteControl.state(); return { state: s.state, needsClick: s.needsClick, volume: s.volume }; });
    await spCtx.close(); await phCtx.close();
  }
  await gesture.close();

  out.errors = errs;
  await srv.stop();
  const file = process.argv[2] || path.join(__dirname, 'volume-proof-out.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
