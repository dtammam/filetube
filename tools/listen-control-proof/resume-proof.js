'use strict';
/* global window, document, MutationObserver */
// END-TO-END PROOF (v1.356): a phone that closes the app comes back still connected to its speaker. The REAL
// server, two browser contexts as one user (a speaker PC and an iPhone 13), and a third account for AC4. A
// "killed app" is a NEW phone context carrying the old one's localStorage (Playwright storageState) with an
// empty sessionStorage. Not a CI gate.
//   node tools/listen-control-proof/resume-proof.js [out.json]
// Every speaker read goes through raw CDP Runtime.evaluate {userGesture:false} (LESSONS 2: page.evaluate grants
// the activation an autoplay row measures). The speaker browser runs with --autoplay-policy=no-user-gesture-required
// (a kiosk), so its playback is not what this proof is about.
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

const RESUME_KEY = 'ft-remote-resume';
const MIN = 60000;

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
  return { page, ev, until };
}
const snap = (s) => s.ev(() => window.FileTube.player.getRemoteSnapshot());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function untilNode(fn, ms) { const end = Date.now() + (ms || 8000); for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(100); } }

// A phone context that counts every request it makes to the remote channel and records every toast it shows.
async function phoneContext(browser, cookie, storageState) {
  const opts = Object.assign({}, pw.devices['iPhone 13']);
  if (storageState) opts.storageState = storageState;
  const ctx = await browser.newContext(opts);
  if (!storageState) await ctx.addCookies([cookie]);
  const net = { command: 0, targets: 0, stream: 0, me: 0, log: [] };
  ctx.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api/remote/command')) { net.command += 1; net.log.push('POST command ' + (r.postData() || '')); }
    if (u.includes('/api/remote/targets')) { net.targets += 1; net.log.push('GET targets @' + Date.now()); }
    if (u.includes('/api/remote/stream')) { net.stream += 1; net.log.push('GET stream'); }
    if (u.includes('/api/auth/me')) net.me += 1;
  });
  await ctx.addInitScript(() => {
    // a Click iPod (the skins with menus), so the Speakers landing is visible: Cider, the default, has no menus
    try { if (!localStorage.getItem('ft-music-skin')) localStorage.setItem('ft-music-skin', 'ipod-2004'); } catch { /* ignore */ }
    window.__toasts = [];
    const seen = new WeakSet();
    const scan = () => {
      document.querySelectorAll('.ui-toast__text').forEach((el) => {
        const t = (el.textContent || '').trim();
        if (t && !seen.has(el)) { seen.add(el); window.__toasts.push(t); }
      });
    };
    const start = () => new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  });
  return { ctx, net };
}
// The remembered record, read from a storageState (or rewritten in it).
const recordOf = (state) => { const o = state.origins.find((x) => x.localStorage.some((i) => i.name === RESUME_KEY)); if (!o) return null; return JSON.parse(o.localStorage.find((i) => i.name === RESUME_KEY).value); };
function withRecord(state, patch) {
  const s = JSON.parse(JSON.stringify(state));
  for (const o of s.origins) for (const i of o.localStorage) if (i.name === RESUME_KEY) i.value = JSON.stringify(Object.assign(JSON.parse(i.value), patch));
  return s;
}
// A phone page's view of itself.
const phoneView = (p) => p.evaluate(() => {
  const RC = window.FileTube.remoteControl;
  let rec = null; try { rec = JSON.parse(localStorage.getItem('ft-remote-resume') || 'null'); } catch { rec = 'bad'; }
  let tab = null; try { tab = sessionStorage.getItem('ft-remote-controlling'); } catch { tab = 'err'; }
  const st = RC.state();
  const panel = document.querySelector('.music-nowplaying-panel');
  const cur = document.querySelector('.ipm-row.is-cursor .ipm-name');
  const menu = panel ? { menuMode: panel.classList.contains('mms-menumode'), cursor: cur ? cur.textContent : null } : null;
  return {
    isRemote: RC.isRemote(), label: RC.label(), pending: RC.resumePending ? RC.resumePending() : null,
    track: st && st.track ? st.track.title : null, state: st ? st.state : null, position: RC.position(),
    mmsOn: document.body.classList.contains('mms-on'),
    lcdText: panel && !panel.hidden ? (panel.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) : '',
    menu, record: rec, tabPick: tab, toasts: window.__toasts.slice(),
    localPlayer: (() => { const m = document.getElementById('media-player'); return m ? { src: m.currentSrc || '', paused: m.paused } : null; })(),
  };
});

async function main() {
  const srv = await start({ seconds: 600 });
  const server = require('../../server');
  const out = { notes: [] };
  const errs = [];
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  // the speaker PC (user 1): Remote control on
  const spCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await spCtx.addCookies([srv.cookie]);
  let sp = await speakerPage(spCtx);
  sp.page.on('pageerror', (e) => errs.push('SPEAKER ' + e.message));
  await sp.page.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
  const sid = await sp.ev(() => window.FileTube.getDeviceId());
  const slabel = await sp.ev(() => window.FileTube.getDeviceLabel());
  out.speaker_label = slabel;

  // ---- setup: the phone picks the speaker through its own view (remoteChoose's RC.select) and plays a song ----
  const a = await phoneContext(browser, srv.cookie);
  const p1 = await a.ctx.newPage();
  p1.on('pageerror', (e) => errs.push('PHONE1 ' + e.message));
  await p1.goto(srv.base + '/music', { waitUntil: 'networkidle' });
  out.setup_is_phone = await p1.evaluate(() => document.documentElement.classList.contains('is-phone'));
  const listed = await untilNode(async () => (await p1.evaluate(() => window.FileTube.remoteControl.fetchTargets())).find((t) => t.deviceId === sid), 5000);
  await p1.evaluate((t) => window.FileTube.remoteControl.select(t), listed);
  await p1.evaluate(() => window.FileTube.remoteControl.play(['song1', 'song2', 'song3'], 0));
  out.setup_speaker_playing = await sp.until(() => { const s = window.FileTube.player.getRemoteSnapshot(); return s.playing && s.id; }, null, 10000);
  await untilNode(async () => (await phoneView(p1)).record, 5000);
  out.setup_record_after_pick = (await phoneView(p1)).record;
  out.setup_command_posts = a.net.command; // the one play
  await sleep(3000); // let the song run
  const closeAt = Date.now();
  await p1.close({ runBeforeUnload: false }); // pagehide stamps `at`
  let saved = await a.ctx.storageState();
  await a.ctx.close();
  out.setup_record_saved = recordOf(saved);
  out.setup_record_at_vs_close_ms = out.setup_record_saved ? out.setup_record_saved.at - closeAt : null;

  // ---- AC1: relaunch (a new context, the same localStorage, an empty sessionStorage) ----
  {
    const before = await snap(sp);
    const ph = await phoneContext(browser, srv.cookie, saved);
    const p = await ph.ctx.newPage();
    p.on('pageerror', (e) => errs.push('AC1 ' + e.message));
    const t0 = Date.now();
    await p.goto(srv.base + '/music', { waitUntil: 'domcontentloaded' });
    out.ac1_tab_pick_at_load = await p.evaluate(() => sessionStorage.getItem('ft-remote-controlling'));
    const attachedAt = await untilNode(async () => (await p.evaluate(() => window.FileTube.remoteControl.isRemote())) && Date.now(), 8000);
    out.ac1_attached_ms = attachedAt ? attachedAt - t0 : null;
    await untilNode(async () => (await phoneView(p)).mmsOn, 4000);
    await sleep(800);
    const v = await phoneView(p);
    const s = await snap(sp);
    const pv = await p.evaluate(() => window.FileTube.remoteControl.position());
    out.ac1_phone = { isRemote: v.isRemote, label: v.label, track: v.track, state: v.state, mmsOn: v.mmsOn, lcdText: v.lcdText, tabPick: v.tabPick, record: v.record, localPlayer: v.localPlayer };
    out.ac1_ipod_screen = v.menu;
    out.ac1_toasts = v.toasts;
    out.ac1_speaker_track = s.id;
    out.ac1_speaker_position = Math.round(s.position * 100) / 100;
    out.ac1_phone_position = Math.round(pv * 100) / 100;
    out.ac1_position_gap_s = Math.round(Math.abs(s.position - pv) * 100) / 100;
    out.ac1_speaker_before = { id: before.id, position: Math.round(before.position * 100) / 100, playing: before.playing };
    await sleep(2000);
    const after = await snap(sp);
    out.ac1_speaker_after_2s = { id: after.id, position: Math.round(after.position * 100) / 100, playing: after.playing };
    out.ac1_speaker_advanced_not_restarted = after.id === before.id && after.position > before.position + 1;
    out.ac1_command_posts = ph.net.command;
    out.ac1_targets_requests = ph.net.targets;
    out.ac1_net_log = ph.net.log.slice(0, 8);
    saved = await ph.ctx.storageState();
    await p.close(); await ph.ctx.close();
  }

  // ---- W2 landing via another view: relaunch on Home, then the in-app nav to Music ----
  {
    const ph = await phoneContext(browser, srv.cookie, saved);
    const p = await ph.ctx.newPage();
    p.on('pageerror', (e) => errs.push('HOME ' + e.message));
    await p.goto(srv.base + '/', { waitUntil: 'networkidle' });
    out.home_attached_on_home = await untilNode(() => p.evaluate(() => window.FileTube.remoteControl.isRemote()), 6000);
    await p.evaluate(() => window.FileTube.navigate('/music'));
    out.home_then_music_mms_on = await untilNode(() => p.evaluate(() => document.body.classList.contains('mms-on')), 6000);
    await sleep(500);
    const hv = await phoneView(p);
    out.home_then_music_lcd = hv.lcdText;
    out.home_then_music_screen = hv.menu;
    out.home_command_posts = ph.net.command;
    await p.close(); await ph.ctx.close();
  }

  // ---- AC3: a tap during the PENDING window (the targets answer held) sends nothing ----
  {
    const ph = await phoneContext(browser, srv.cookie, saved);
    let release; const held = new Promise((r) => { release = r; });
    let heldCount = 0;
    await ph.ctx.route('**/api/remote/targets*', async (route) => { heldCount += 1; if (heldCount === 1) await held; await route.continue(); });
    const p = await ph.ctx.newPage();
    p.on('pageerror', (e) => errs.push('AC3 ' + e.message));
    await p.goto(srv.base + '/music', { waitUntil: 'domcontentloaded' });
    await untilNode(() => p.evaluate(() => window.FileTube.remoteControl.resumePending()), 6000);
    const during = await phoneView(p);
    out.ac3_during = { pending: during.pending, isRemote: during.isRemote, label: during.label, track: during.track, mmsOn: during.mmsOn, toasts: during.toasts };
    // where the speaker's name shows on the page, if anywhere, while the check is held
    out.ac3_during_label_on_page = await p.evaluate((l) => {
      const txt = document.body.innerText; const i = txt.indexOf(l);
      const card = document.getElementById('handoff-card');
      const badge = document.querySelector('.mms-remote');
      return { found: i >= 0, around: i >= 0 ? txt.slice(Math.max(0, i - 40), i + l.length + 20).replace(/\s+/g, ' ') : '',
        handoffCard: card && !card.hidden ? card.textContent.replace(/\s+/g, ' ').trim() : null, ipodBadge: badge ? badge.textContent : null };
    }, slabel);
    out.ac3_tap_results = await p.evaluate(async () => {
      const RC = window.FileTube.remoteControl;
      const r = [];
      r.push(await RC.play(['song2'], 0)); r.push(await RC.toggle()); r.push(await RC.next()); r.push(await RC.prev());
      RC.seek(10); RC.volume(0.3);
      return r;
    });
    await sleep(600);
    out.ac3_command_posts_during = ph.net.command;
    release();
    out.ac3_attached_after_release = await untilNode(() => p.evaluate(() => window.FileTube.remoteControl.isRemote()), 6000);
    await sleep(800);
    out.ac3_command_posts_total = ph.net.command;
    out.ac3_speaker_still = await snap(sp).then((s) => ({ id: s.id, playing: s.playing }));
    saved = await ph.ctx.storageState();
    await p.close(); await ph.ctx.close();
  }

  // ---- AC2 rows: the speaker turned Remote control off; paused + 61 min; then playing + 3 h attaches ----
  const quietRow = async (name, state) => {
    const ph = await phoneContext(browser, srv.cookie, state);
    const p = await ph.ctx.newPage();
    p.on('pageerror', (e) => errs.push(name + ' ' + e.message));
    await p.goto(srv.base + '/music', { waitUntil: 'networkidle' });
    await sleep(2500);
    const v = await phoneView(p);
    const r = { isRemote: v.isRemote, label: v.label, mmsOn: v.mmsOn, record: v.record, tabPick: v.tabPick, toasts: v.toasts, command_posts: ph.net.command, targets_requests: ph.net.targets, stream_requests: ph.net.stream };
    await p.close(); await ph.ctx.close();
    return r;
  };
  await sp.ev(() => { window.FileTube.remote.setOn(false); return true; });
  await sleep(500);
  out.ac2_off = await quietRow('OFF', saved);
  await sp.ev(() => { window.FileTube.remote.setOn(true); return true; });
  await untilNode(async () => { const c = await browser.newContext(); await c.addCookies([srv.cookie]); const pg = await c.newPage(); await pg.goto(srv.base + '/', { waitUntil: 'domcontentloaded' }); const l = await pg.evaluate((id) => fetch('/api/remote/targets?deviceId=probe').then((r) => r.json()).then((x) => x.some((t) => t.deviceId === id)), sid); await c.close(); return l; }, 6000);
  await sp.ev(() => { window.FileTube.player.pause(); return true; });
  await sleep(1200);
  out.ac2_paused_speaker = await snap(sp).then((s) => ({ id: s.id, playing: s.playing }));
  out.ac2_paused_61min = await quietRow('P61', withRecord(saved, { at: Date.now() - 61 * MIN }));
  // inside the hour, paused: attaches (R1's second arm). This phone stays attached while the speaker plays
  // again, so the speaker reports `playing` (a target reports only while a controller is attached), then it leaves.
  {
    const ph = await phoneContext(browser, srv.cookie, withRecord(saved, { at: Date.now() - 20 * MIN }));
    const p = await ph.ctx.newPage();
    await p.goto(srv.base + '/music', { waitUntil: 'networkidle' });
    out.paused_20min_attached = await untilNode(() => p.evaluate(() => window.FileTube.remoteControl.isRemote()), 6000);
    const pv = await phoneView(p);
    out.paused_20min = { state: pv.state, screen: pv.menu, toasts: pv.toasts };
    out.paused_20min_command_posts = ph.net.command;
    out.paused_20min_speaker_still_paused = !(await snap(sp)).playing;
    await sp.ev(() => { window.FileTube.player.play(); return true; });
    out.paused_20min_mirror_follows_play = await untilNode(async () => (await phoneView(p)).state === 'playing', 6000);
    saved = await ph.ctx.storageState();
    await p.close(); await ph.ctx.close();
  }
  await sleep(1200);
  {
    const ph = await phoneContext(browser, srv.cookie, withRecord(saved, { at: Date.now() - 3 * 60 * MIN }));
    const p = await ph.ctx.newPage();
    await p.goto(srv.base + '/music', { waitUntil: 'networkidle' });
    out.playing_3h_attached = await untilNode(() => p.evaluate(() => window.FileTube.remoteControl.isRemote()), 6000);
    await sleep(500);
    const v = await phoneView(p);
    out.playing_3h = { track: v.track, toasts: v.toasts, command_posts: ph.net.command };
    await p.close(); await ph.ctx.close();
  }
  // DISCLOSURE row (measured, not a pass/fail): the speaker is paused AFTER the phone left, so no controller is
  // attached and the speaker reports nothing; the listed state is the last one reported while a phone was attached.
  {
    await sp.ev(() => { window.FileTube.player.pause(); return true; });
    await sleep(1500);
    out.stale_speaker_now = await snap(sp).then((s) => ({ id: s.id, playing: s.playing }));
    const c = await browser.newContext(); await c.addCookies([srv.cookie]); const pg = await c.newPage();
    await pg.goto(srv.base + '/', { waitUntil: 'domcontentloaded' });
    out.stale_listed_state = await pg.evaluate((id) => fetch('/api/remote/targets?deviceId=probe').then((r) => r.json()).then((x) => { const t = x.find((y) => y.deviceId === id); return t ? { state: t.state.state, ageMs: t.state.ageMs } : null; }), sid);
    await c.close();
    const ph = await phoneContext(browser, srv.cookie, withRecord(saved, { at: Date.now() - 3 * 60 * MIN }));
    const p = await ph.ctx.newPage();
    await p.goto(srv.base + '/music', { waitUntil: 'networkidle' });
    out.stale_paused_3h_attached = await untilNode(() => p.evaluate(() => window.FileTube.remoteControl.isRemote()), 4000);
    await sleep(800);
    out.stale_paused_3h_mirror_after_attach = (await phoneView(p)).state;
    out.stale_command_posts = ph.net.command;
    await p.close(); await ph.ctx.close();
    await sp.ev(() => { window.FileTube.player.play(); return true; });
  }

  // ---- AC4: a second account on the same phone, whose OWN speaker even has the same device id ----
  {
    const other = server.__mintTestSession({ username: 'otheruser' });
    const otherCookie = { name: other.cookieName, value: encodeURIComponent(other.token), url: srv.base };
    const bCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await bCtx.addCookies([otherCookie]);
    await bCtx.addInitScript((id) => { try { localStorage.setItem('ft-device-id', id); } catch { /* ignore */ } }, sid);
    const bsp = await speakerPage(bCtx);
    await bsp.page.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
    out.ac4_other_speaker_same_device_id = (await bsp.ev(() => window.FileTube.getDeviceId())) === sid;
    // the second account's phone: user 1's localStorage (the record), user 2's session cookie
    const st = JSON.parse(JSON.stringify(saved));
    st.cookies = st.cookies.filter((c) => c.name !== other.cookieName).concat([{ name: other.cookieName, value: encodeURIComponent(other.token), domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }]);
    const ph = await phoneContext(browser, otherCookie, st);
    const p = await ph.ctx.newPage();
    p.on('pageerror', (e) => errs.push('AC4 ' + e.message));
    await p.goto(srv.base + '/music', { waitUntil: 'networkidle' });
    out.ac4_signed_in_as = await p.evaluate(async () => { const me = await window.fetchCurrentUser(); return me && me.user ? me.user.username : null; });
    out.ac4_other_users_targets_list_that_id = await p.evaluate((id) => window.FileTube.remoteControl.fetchTargets().then((l) => l.some((t) => t.deviceId === id)), sid);
    await sleep(1500);
    const v = await phoneView(p);
    out.ac4 = { isRemote: v.isRemote, label: v.label, record: v.record, toasts: v.toasts, command_posts: ph.net.command, resume_targets_requests: ph.net.targets - 1 };
    out.ac4_speaker1_undisturbed = await snap(sp).then((s) => ({ id: s.id, playing: s.playing }));
    await p.close(); await ph.ctx.close(); await bCtx.close();
  }

  // ---- idle speaker inside the hour: attaches and lands the Main menu (cursor on Music) ----
  {
    await sp.page.close();
    sp = await speakerPage(spCtx);
    await sp.page.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
    await sleep(800);
    out.idle_speaker_snapshot = await snap(sp).then((s) => ({ id: s.id, playing: s.playing }));
    const ph = await phoneContext(browser, srv.cookie, withRecord(saved, { at: Date.now() - 5 * MIN }));
    const p = await ph.ctx.newPage();
    await p.goto(srv.base + '/music', { waitUntil: 'networkidle' });
    out.idle_attached = await untilNode(() => p.evaluate(() => window.FileTube.remoteControl.isRemote()), 6000);
    await sleep(800);
    const v = await phoneView(p);
    out.idle = { state: v.state, track: v.track, mmsOn: v.mmsOn, lcdText: v.lcdText, command_posts: ph.net.command };
    out.idle_screen = v.menu;
    await p.close(); await ph.ctx.close();
  }

  out.errors = errs;
  await browser.close();
  await srv.stop();
  const file = process.argv[2] || path.join(__dirname, 'resume-proof-out.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
