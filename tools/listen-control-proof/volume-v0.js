'use strict';
/* global window, document, location */
// V0 FALSIFIER (v1.353 remote volume), before any edit: is the speaker's media.volume settable in the
// kiosk Chromium with no click, and does the server refuse a 'volume' command today? Also measures the
// muted-then-unmuted case on an unclicked tab (Chromium's "unmute without a gesture pauses" rule).
//   node tools/listen-control-proof/volume-v0.js out.json
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));

async function speakerPage(ctx) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const ev = async (fn, arg) => {
    const expr = '(' + fn.toString() + ')(' + JSON.stringify(arg === undefined ? null : arg) + ')';
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: false });
    if (r.exceptionDetails) throw new Error('speaker eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  const until = async (fn, arg, ms) => { const end = Date.now() + (ms || 8000); for (;;) { const v = await ev(fn, arg); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 100)); } };
  return { page, ev, until };
}

async function main() {
  const srv = await start({ seconds: 60 });
  const out = {}; const errs = [];
  for (const policy of ['no-user-gesture-required', 'user-gesture-required']) {
    const b = await pw.chromium.launch({ args: ['--autoplay-policy=' + policy] });
    const spCtx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await spCtx.addCookies([srv.cookie]);
    const phCtx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await phCtx.addCookies([srv.cookie]);
    const sp = await speakerPage(spCtx);
    sp.page.on('pageerror', (e) => errs.push(policy + ' SPEAKER ' + e.message));
    await sp.page.goto(srv.base + '/music?remote=on', { waitUntil: 'networkidle' });
    const id = await sp.until(() => window.FileTube && window.FileTube.getDeviceId && window.FileTube.getDeviceId());
    const ph = await phCtx.newPage();
    await ph.goto(srv.base + '/', { waitUntil: 'networkidle' });
    const o = out[policy] = {};
    o.hasBeenActive = await sp.ev(() => navigator.userActivation.hasBeenActive);
    await ph.evaluate((tid) => window.FileTube.remoteControl.select({ deviceId: tid, label: 'Speaker' }), id);
    await ph.waitForTimeout(800);
    // today's phone: a 'volume' command
    o.volume_cmd = await ph.evaluate(async (tid) => {
      const r = await fetch('/api/remote/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ fromDeviceId: window.FileTube.getDeviceId(), targetDeviceId: tid, cmd: 'volume', args: { level: 0.5 } }) });
      return r.status + ' ' + (await r.text());
    }, id);
    o.phone_api_has_volume = await ph.evaluate(() => typeof window.FileTube.remoteControl.volume);
    if (policy === 'no-user-gesture-required') {
      await ph.evaluate(() => window.FileTube.remoteControl.play(['song1'], 0));
      o.playing = await sp.until(() => window.FileTube.player.getRemoteSnapshot().playing, null, 8000);
      o.volume_before = await sp.ev(() => document.getElementById('media-player').volume);
      o.volume_set_03 = await sp.ev(() => { const m = document.getElementById('media-player'); m.volume = 0.3; return m.volume; });
      await sp.page.waitForTimeout(300);
      o.ft_volume_after = await sp.ev(() => localStorage.getItem('ft-volume'));
      o.playing_after = await sp.ev(() => window.FileTube.player.getRemoteSnapshot().playing);
      o.hasBeenActive_after = await sp.ev(() => navigator.userActivation.hasBeenActive);
    } else {
      // an unclicked tab whose stored preference is MUTED: does a muted play start, and does an unmute pause it?
      await sp.ev(() => { localStorage.setItem('ft-muted', '1'); return true; });
      await sp.page.reload({ waitUntil: 'networkidle' });
      await sp.until(() => window.FileTube.remote.isOn(), null, 4000);
      o.hasBeenActive_reload = await sp.ev(() => navigator.userActivation.hasBeenActive);
      await ph.waitForTimeout(1500);
      await ph.evaluate((tid) => window.FileTube.remoteControl.select({ deviceId: tid, label: 'Speaker' }), id); // the reload's pagehide ended the old session
      await ph.waitForTimeout(800);
      await ph.evaluate(() => window.FileTube.remoteControl.play(['song2'], 0));
      o.element_seen = !!(await sp.until(() => !!document.getElementById('media-player') && document.getElementById('media-player').currentSrc !== '', null, 8000));
      await sp.page.waitForTimeout(2000);
      o.state_on_phone = await ph.evaluate(() => { const s = window.FileTube.remoteControl.state(); return s && s.state; });
      o.speaker_snapshot = await sp.ev(() => Object.assign({ path: location.pathname, refused: window.FileTube.player.autoStartRefused(), el: !!document.getElementById('media-player') }, window.FileTube.player.getRemoteSnapshot()));
      o.muted_play = await sp.ev(() => { const m = document.getElementById('media-player'); if (!m) return null; return { muted: m.muted, paused: m.paused, vol: m.volume }; });
      o.unmute = await sp.ev(async () => { const m = document.getElementById('media-player'); if (!m) return null; m.muted = false; m.volume = 0.5; await new Promise((r) => setTimeout(r, 800)); return { muted: m.muted, paused: m.paused, vol: m.volume }; });
      o.zero_then_up = await sp.ev(async () => { const m = document.getElementById('media-player'); if (!m) return null; m.volume = 0; await new Promise((r) => setTimeout(r, 300)); const a = { paused: m.paused }; m.volume = 0.5; await new Promise((r) => setTimeout(r, 800)); return { atZero: a, after: { paused: m.paused, vol: m.volume } }; });
    }
    await b.close();
  }
  out.errors = errs;
  await srv.stop();
  fs.writeFileSync(process.argv[2] || path.join(__dirname, 'volume-v0-out.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
