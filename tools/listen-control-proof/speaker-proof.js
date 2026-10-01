'use strict';
/* global window, document */
// END-TO-END PROOF (v1.352 W2): the speaker bookmark against the REAL server and a real login, two
// browser contexts as the same user (a speaker machine and a phone). Measures plan section 5 W2 rows
// a-g. Not a CI gate.
//   node tools/listen-control-proof/speaker-proof.js out.json
//
// Every read on the SPEAKER page goes through raw CDP Runtime.evaluate with userGesture:false: Playwright's
// page.evaluate runs with a user gesture in Chromium, which would give the page the very activation the
// autoplay rows are about (measured: hasBeenActive true with no click at all).
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const DAY = 86400;
const PASSWORD = 'speaker-proof-password';

async function speakerPage(ctx) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const ev = async (fn, arg) => {
    const expr = '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')';
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: false });
    if (r.exceptionDetails) throw new Error('speaker eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  const until = async (fn, arg, ms) => {
    const end = Date.now() + (ms || 8000);
    for (;;) { const v = await ev(fn, arg); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 100)); }
  };
  // a real mouse click at a neutral spot of the page (Input.dispatchMouseEvent, not el.click())
  const realClick = async () => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 700, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 700, button: 'left', clickCount: 1 });
  };
  return { page, ev, until, realClick };
}

async function phonePage(ctx, base) {
  const p = await ctx.newPage();
  await p.goto(base + '/', { waitUntil: 'networkidle' });
  const targets = () => p.evaluate(async () => (await (await fetch('/api/remote/targets?deviceId=' + encodeURIComponent(window.FileTube.getDeviceId()))).json()));
  const targetState = async (id) => { const t = (await targets()).find((x) => x.deviceId === id); return t ? t.state : null; };
  const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 150)); } };
  return { p, targets, targetState, until };
}

const speakerUrl = (s) => s.page.url().replace(/^https?:\/\/[^/]+/, '');
const deviceIdOf = (s) => s.ev(() => window.FileTube.getDeviceId());

async function main() {
  const srv = await start({ seconds: 60 });
  const server = require('../../server');
  const authCrypto = require('../../lib/auth/crypto');
  // a real password, so row e can log in through the form; re-mint after (the change bumps tv)
  const u = server.userStore.getByUsername('proofadmin');
  server.userStore.updatePassword(u.id, await authCrypto.hashPassword(PASSWORD));
  const fresh = server.__mintTestSession({ username: 'proofadmin' });
  const cookie = { name: fresh.cookieName, value: encodeURIComponent(fresh.token), url: srv.base };
  const out = {};
  const errs = [];

  // ---- browser 1: autoplay needs a gesture (the default for a page nobody touched) ----
  const gesture = await pw.chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
  {
    const spCtx = await gesture.newContext({ viewport: { width: 1280, height: 800 } }); await spCtx.addCookies([cookie]);
    const phCtx = await gesture.newContext({ viewport: { width: 1280, height: 800 } }); await phCtx.addCookies([cookie]);
    const sp = await speakerPage(spCtx);
    sp.page.on('pageerror', (e) => errs.push('SPEAKER ' + e.message));
    const ph = await phonePage(phCtx, srv.base);
    ph.p.on('pageerror', (e) => errs.push('PHONE ' + e.message));

    // a. a fresh tab opens the bookmark
    const tA = Date.now();
    await sp.page.goto(srv.base + '/music?remote=on', { waitUntil: 'domcontentloaded' });
    const id = await sp.until(() => window.FileTube && window.FileTube.getDeviceId && window.FileTube.getDeviceId());
    const listed = await ph.until(async () => (await ph.targets()).some((t) => t.deviceId === id), 5000);
    out.a_listed = listed; out.a_listed_ms = Date.now() - tA;
    out.a_speaker_url = speakerUrl(sp);
    out.a_history_state_url = await sp.ev(() => window.history.state && window.history.state.url);
    out.a_on = await sp.ev(() => window.FileTube.remote.isOn());
    out.a_toast = await sp.until(() => /Remote control is on: your other devices can play music here/.test(document.body.innerText), null, 3000);
    out.a_has_been_active = await sp.ev(() => navigator.userActivation.hasBeenActive);
    await sp.page.reload({ waitUntil: 'networkidle' });
    out.a_after_reload_on = await sp.until(() => window.FileTube.remote.isOn(), null, 4000);
    out.a_after_reload_listed = await ph.until(async () => (await ph.targets()).some((t) => t.deviceId === id), 5000);
    out.a_after_reload_url = speakerUrl(sp);

    // c. no click: the phone sees needsClick before any song; play -> blocked; one real click -> clear;
    //    the phone's play/pause then plays (Chromium carried the activation across the reload above, so
    //    this row opens a FRESH tab: a restored/bookmarked tab is the device case)
    await sp.page.close();
    const sp2 = await speakerPage(spCtx);
    sp2.page.on('pageerror', (e) => errs.push('SPEAKER2 ' + e.message));
    await sp2.page.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
    out.c_has_been_active = await sp2.ev(() => navigator.userActivation.hasBeenActive);
    out.c_pill = await sp2.until(() => { const e = document.getElementById('remote-pill'); return !!e && !e.hidden && e.textContent; }, null, 4000);
    await ph.p.evaluate((tid) => window.FileTube.remoteControl.select({ deviceId: tid, label: 'Speaker' }), id);
    out.c_phone_needsClick_before_play = await ph.until(async () => { const st = await ph.targetState(id); return st && st.needsClick === true; }, 5000);
    out.c_phone_rc_state_needsClick = await ph.p.evaluate(() => { const s = window.FileTube.remoteControl.state(); return s && s.needsClick; });
    await ph.p.evaluate(() => window.FileTube.remoteControl.play(['song1'], 0));
    out.c_state_after_play = await ph.until(async () => { const st = await ph.targetState(id); return st && st.state === 'blocked' && st.state; }, 8000) || (await ph.targetState(id)).state;
    out.c_speaker_playing_after_play = await sp2.ev(() => window.FileTube.player.getRemoteSnapshot().playing);
    await sp2.realClick();
    out.c_needsClick_after_click = await ph.until(async () => { const st = await ph.targetState(id); return st && st.needsClick === false ? 'false' : null; }, 5000);
    out.c_pill_after_click = await sp2.ev(() => { const e = document.getElementById('remote-pill'); return e ? (e.hidden ? 'hidden' : e.textContent) : 'none'; });
    await ph.p.evaluate(() => window.FileTube.remoteControl.toggle());
    out.c_state_after_toggle = await ph.until(async () => { const st = await ph.targetState(id); return st && st.state === 'playing' && st.state; }, 8000) || (await ph.targetState(id)).state;
    out.c_speaker_playing_after_toggle = await sp2.ev(() => window.FileTube.player.getRemoteSnapshot().playing);

    // g. a second tab of the speaker browser opens the bookmark: it takes over, the first is told
    const sp3 = await speakerPage(spCtx);
    await sp3.page.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
    out.g_second_on = await sp3.until(() => window.FileTube.remote.isOn(), null, 4000);
    out.g_first_off = await sp2.until(() => !window.FileTube.remote.isOn(), null, 6000);
    out.g_first_toast = await sp2.until(() => /Remote control moved to another tab/.test(document.body.innerText), null, 3000);
    out.g_listed_once = (await ph.targets()).filter((t) => t.deviceId === id).length;
    await spCtx.close(); await phCtx.close();
  }

  // e. logged out: the bookmark lands on login, signing in returns to /music with Remote control On
  {
    const loCtx = await gesture.newContext({ viewport: { width: 1280, height: 800 } });
    const phCtx = await gesture.newContext({ viewport: { width: 1280, height: 800 } }); await phCtx.addCookies([cookie]);
    const lo = await loCtx.newPage();
    lo.on('pageerror', (e) => errs.push('LOGIN ' + e.message));
    await lo.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
    out.e_login_url = lo.url().replace(srv.base, '');
    await lo.fill('#login-username', 'proofadmin');
    await lo.fill('#login-password', PASSWORD);
    await Promise.all([lo.waitForURL(/\/music/, { timeout: 10000 }), lo.click('#login-submit')]);
    await lo.waitForLoadState('networkidle');
    out.e_after_login_url = lo.url().replace(srv.base, '');
    out.e_on = await lo.evaluate(() => window.FileTube.remote.isOn());
    const lid = await lo.evaluate(() => window.FileTube.getDeviceId());
    const ph = await phonePage(phCtx, srv.base);
    out.e_listed = await ph.until(async () => (await ph.targets()).some((t) => t.deviceId === lid), 5000);
    // the open-redirect shapes through the REAL login page (measured in the browser, not the parser)
    const redirectTo = async (raw) => {
      const c = await gesture.newContext(); const pg = await c.newPage();
      await pg.goto(srv.base + '/login?next=' + raw, { waitUntil: 'networkidle' });
      await pg.fill('#login-username', 'proofadmin'); await pg.fill('#login-password', PASSWORD);
      await Promise.all([pg.waitForLoadState('load'), pg.click('#login-submit')]);
      await pg.waitForTimeout(800);
      const url = pg.url(); await c.close();
      return url.startsWith(srv.base) ? 'same-origin ' + url.replace(srv.base, '') : 'LEFT ' + url;
    };
    out.e_next_backslash = await redirectTo('/%5Cevil.example');
    out.e_next_tab = await redirectTo('/%09/evil.example');
    out.e_next_dotslash = await redirectTo('/.//evil.example');
    await loCtx.close(); await phCtx.close();
  }

  // f. a session signed 16 days ago: the speaker tab's own requests renew it (the cookie jar's expiry)
  {
    const old = server.__mintTestSession({ username: 'proofadmin', issuedAt: Math.floor(Date.now() / 1000) - 16 * DAY });
    const ctx = await gesture.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addCookies([{ name: old.cookieName, value: encodeURIComponent(old.token), url: srv.base, expires: Math.floor(Date.now() / 1000) + 14 * DAY }]);
    const before = (await ctx.cookies()).find((c) => c.name === old.cookieName);
    const renewals = [];
    const pg = await ctx.newPage();
    pg.on('response', async (r) => { const h = await r.headerValue('set-cookie').catch(() => null); if (h && h.includes(old.cookieName)) renewals.push(r.url().replace(srv.base, '').split('?')[0]); });
    await pg.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
    await pg.waitForTimeout(1500);
    const after = (await ctx.cookies()).find((c) => c.name === old.cookieName);
    out.f_expiry_days_before = Math.round((before.expires - Date.now() / 1000) / DAY * 10) / 10;
    out.f_expiry_days_after = Math.round((after.expires - Date.now() / 1000) / DAY * 10) / 10;
    out.f_renewing_responses = renewals.slice(0, 6);
    out.f_renewals = renewals.length;
    out.f_token_changed = after.value !== before.value;
    await ctx.close();
  }
  await gesture.close();

  // ---- browser 2: a kiosk launched with --autoplay-policy=no-user-gesture-required ----
  const kiosk = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  {
    const spCtx = await kiosk.newContext({ viewport: { width: 1280, height: 800 } }); await spCtx.addCookies([cookie]);
    const phCtx = await kiosk.newContext({ viewport: { width: 1280, height: 800 } }); await phCtx.addCookies([cookie]);
    const ph = await phonePage(phCtx, srv.base);
    // d. /music?remote=on, no click: a phone play plays
    const sp = await speakerPage(spCtx);
    await sp.page.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
    const id = await deviceIdOf(sp);
    out.d_has_been_active = await sp.ev(() => navigator.userActivation.hasBeenActive);
    await ph.p.evaluate((tid) => window.FileTube.remoteControl.select({ deviceId: tid, label: 'Speaker' }), id);
    await ph.until(async () => !!(await ph.targetState(id)), 5000);
    await ph.p.evaluate(() => window.FileTube.remoteControl.play(['song2'], 0));
    out.d_state = await ph.until(async () => { const st = await ph.targetState(id); return st && st.state === 'playing' && st.state; }, 8000) || (await ph.targetState(id)).state;
    out.d_speaker_playing = await sp.ev(() => window.FileTube.player.getRemoteSnapshot().playing);
    // gate r1: a kiosk plays unclicked, so the click hint must go (it never clicks: hasBeenActive stays false)
    out.d_needsClick_after_play = await ph.until(async () => { const st = await ph.targetState(id); return st && st.needsClick === false ? 'false' : null; }, 5000) || String((await ph.targetState(id)).needsClick);
    out.d_pill_after_play = await sp.ev(() => { const e = document.getElementById('remote-pill'); return e ? (e.hidden ? 'hidden' : e.textContent) : 'none'; });
    out.d_has_been_active_after_play = await sp.ev(() => navigator.userActivation.hasBeenActive);
    await sp.page.close();
    // b. /?remote=on (Home): listed; a phone play navigates it to /music and plays
    const sb = await speakerPage(spCtx);
    await sb.page.goto(srv.base + '/?remote=on', { waitUntil: 'networkidle' });
    out.b_url = speakerUrl(sb);
    const bid = await deviceIdOf(sb);
    out.b_listed = await ph.until(async () => (await ph.targets()).some((t) => t.deviceId === bid), 5000);
    await ph.p.evaluate((tid) => window.FileTube.remoteControl.select({ deviceId: tid, label: 'Speaker' }), bid);
    await ph.until(async () => !!(await ph.targetState(bid)), 5000);
    await ph.p.evaluate(() => window.FileTube.remoteControl.play(['song3'], 0));
    out.b_state = await ph.until(async () => { const st = await ph.targetState(bid); return st && st.state === 'playing' && st.track && st.track.id; }, 12000);
    out.b_speaker_path = await sb.ev(() => window.location.pathname);
    // gate r1 (Dean): a phone opening the bookmark strips it and stays a controller
    const mobile = await kiosk.newContext(Object.assign({}, pw.devices['iPhone 13']));
    await mobile.addCookies([cookie]);
    const mp = await mobile.newPage();
    await mp.goto(srv.base + '/music?remote=on&playlist=liked', { waitUntil: 'load' });
    await mp.waitForTimeout(1500);
    out.phone_is_phone = await mp.evaluate(() => document.documentElement.classList.contains('is-phone'));
    out.phone_url = mp.url().replace(srv.base, '');
    out.phone_on = await mp.evaluate(() => window.FileTube.remote.isOn());
    const mid = await mp.evaluate(() => window.FileTube.getDeviceId());
    out.phone_listed_as_speaker = (await ph.targets()).some((t) => t.deviceId === mid);
    await mobile.close();
    await spCtx.close(); await phCtx.close();
  }
  await kiosk.close();
  out.errors = errs;
  await srv.stop();
  const file = process.argv[2] || path.join(__dirname, 'speaker-proof-out.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
