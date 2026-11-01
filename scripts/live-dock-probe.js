'use strict';
// live-dock-probe - the headless instrument for the v1.401.0 live dock picture (plan docs/exec-plans/active/2026-11-01-live-dock-picture.md,
// W3 + W4). Like scripts/native-video-surface-probe.js it boots the real app on a scratch DATA_DIR with one real H.264 clip (plus a VTT
// sidecar so captions exist), emulates an iPhone (390x844, touch, reduced motion so the fly-in is instant) and injects a FAKE HOST before
// any page script; here the host announces nativeVideoDock in the ON runs and only nativeVideo in the OFF (control) runs. Then, per run:
// open the watch page, wait for the claim, dispatch native's playing snapshot, dock the player, and MEASURE the dock as the phone lays it
// out (the bar, the X, play/pause, the caption strip, the #media-player box, the last video.surface) with captions off and on; a cropped
// PNG of the dock per state (LESSONS 3: measure UI changes). W4 adds the covered census (a sheet, a menu, a dialog, a toast over the dock
// -> visible: false; cleared -> visible: true) and the idle census (box reads, hit tests and posts over an idle second, docked and covered).
//   SUMMARY shots=<n> checks=<n> failed=<n> ok|FAIL        (exit 1 on any failed check)
//
//   node scripts/live-dock-probe.js <out-dir>
//     Env: FT_ROOT=<tree>, CHROME=<binary>, FFMPEG=<binary> (default ~/.local/bin/ffmpeg-static/ffmpeg).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const ROOT = process.env.FT_ROOT ? path.resolve(process.env.FT_ROOT) : path.join(__dirname, '..');
const DEBUG_PORT = 9800 + Math.floor(Math.random() * 400);

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort();
  for (const d of dirs.reverse()) {
    const bin = path.join(base, d, 'chrome-linux64', 'chrome');
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let mid = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise((resolve, reject) => {
    const i = ++mid; const t = setTimeout(() => { pending.delete(i); reject(new Error('CDP timeout: ' + method)); }, 60000);
    pending.set(i, (m) => { clearTimeout(t); if (m.error) reject(new Error(method + ': ' + m.error.message)); else resolve(m.result); });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
  return { ws, send, ev };
}

// the app's document-start injection, as a fake: the host object and a recorder (the page's adapter posts through
// window.FileTubeHost.post; native's news arrives as a 'filetube-host' CustomEvent on window)
const HOST = (dock) => `(function () {
  window.__posts = [];
  window.FileTubeHost = { bridge: 1, app: { name: 'filetube-ios', version: '${dock ? '0.17.0' : '0.16.0'}', build: '1' }, platform: 'ios',
    capabilities: ['orientation', 'haptics', 'battery', 'serverSettings', 'downloads', 'mediaFetch', 'nativeAudio', 'nativeVideoAudio', 'nativeVideo'${dock ? ", 'nativeVideoDock'" : ''}],
    post: function (msg) { window.__posts.push(JSON.parse(JSON.stringify(msg))); } };
})()`;
const SNAPSHOT = (pos) => `(function () {
  var load = window.__posts.filter(function (m) { return m.type === 'audio.load'; }).pop();
  if (!load) return false;
  window.dispatchEvent(new CustomEvent('filetube-host', { detail: { v: 1, type: 'audioState', rev: load.rev, queue: load.queue, index: 0, state: 'playing',
    positionSec: ${pos}, durationSec: 20, bufferedSec: 20, rate: 1, modes: load.modes, sleep: { mode: 'off' }, videoSize: { w: 1920, h: 1080 } } }));
  return true;
})()`;
const MEASURE = `(function () {
  var R = function (el) { if (!el) return null; var r = el.getBoundingClientRect(); var cs = getComputedStyle(el); return { x: r.left, y: r.top, w: r.width, h: r.height, display: cs.display, hidden: el.hidden === true, z: cs.zIndex }; };
  var s = window.__posts.filter(function (m) { return m.type === 'video.surface'; });
  var dock = document.getElementById('player-dock'), v = document.getElementById('media-player'), wr = document.getElementById('player-wrapper');
  return {
    surface: s.length ? s[s.length - 1] : null, surfaces: s.length,
    htmlDock: document.documentElement.classList.contains('ft-native-dock'), bodyHole: document.body.classList.contains('ft-native-video'),
    ccOn: !!(wr && wr.classList.contains('is-cc-on')),
    dock: R(dock), media: R(v), bar: R(document.getElementById('player-controls')), x: R(document.querySelector('#player-dock .player-dock-close')),
    pp: R(document.getElementById('pp-btn')), cc: R(document.querySelector('.cc-overlay')), ccText: (function () { var t = document.querySelector('.cc-overlay-text'); return t ? t.textContent : null; })(),
    dockH: getComputedStyle(document.documentElement).getPropertyValue('--player-dock-h').trim(),
    poster: v ? v.getAttribute('poster') : null, state: window.FileTube.player.getState(),
    hit: (function () { var r = v.getBoundingClientRect(); var pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 8, r.top + 8], [r.right - 8, r.top + 8], [r.left + 8, r.bottom - 8], [r.right - 8, r.bottom - 8]];
      return pts.map(function (p) { var e = document.elementFromPoint(p[0], p[1]); return e ? (e.id || e.className || e.tagName) : null; }); })()
  };
})()`;
const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:20.000\nA caption line in the strip, long enough that the mini player has to wrap it onto a second line and clamp\n';

async function main() {
  const OUT = process.argv[2];
  if (!OUT) throw new Error('usage: node scripts/live-dock-probe.js <out-dir>');
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary>)');
  const ffmpeg = process.env.FFMPEG || path.join(os.homedir(), '.local', 'bin', 'ffmpeg-static', 'ffmpeg');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ldp-probe-'));
  const { app, updateDatabase, __mintTestSession } = require(path.join(ROOT, 'server'));
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ldp-probe-lib-'));
  const fp = path.join(lib, 'clips', 'v1.mp4');
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x808080:s=640x360:d=20', '-f', 'lavfi', '-i', 'sine=f=440:d=20',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', fp]);
  fs.writeFileSync(path.join(lib, 'clips', 'v1.vtt'), VTT);
  await updateDatabase((db) => {
    db.metadata = { v1: { id: 'v1', type: 'video', title: 'Live dock probe', name: 'v1.mp4', filePath: fp, rootFolder: lib, folderName: 'clips',
      channelName: 'Probe', duration: 20, width: 1920, height: 1080, hasThumbnail: false, hasSubtitles: true, ext: '.mp4', addedAt: 1788000000000 } }; // hasSubtitles: the scan's own flag (the sidecar beside the clip is what /api/subtitles serves)
    return true;
  });
  fs.mkdirSync(OUT, { recursive: true });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cookie } = __mintTestSession();
  const [cname, cvalue] = cookie.split(';')[0].split('=');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ldp-probe-chrome-'));
  const chrome = spawn(chromeBin, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-sandbox', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none',
    '--disable-gpu-rasterization', '--num-raster-threads=1', '--disable-partial-raster', '--disable-zero-copy', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => {
    try { chrome.kill('SIGKILL'); } catch (_) { /* gone */ }
    server.close();
    for (const d of [process.env.DATA_DIR, lib, profile]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best-effort: a scratch dir */ } }
  };
  process.on('exit', cleanup);
  let list = null;
  for (let i = 0; i < 40 && !list; i++) { await new Promise((r) => setTimeout(r, 250)); try { list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json(); } catch (_) { /* not up */ } }
  if (!list) throw new Error('Chromium never exposed its debug endpoint');
  const { send, ev } = await cdp(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expr, ms) => { const end = Date.now() + (ms || 15000); while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100); } return false; };
  await send('Network.enable'); await send('Page.enable');
  await send('Network.setCookie', { name: cname, value: cvalue, url: base });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  let shots = 0, checks = 0, failed = 0;
  const check = (name, ok, detail) => { checks += 1; if (!ok) failed += 1; console.log(JSON.stringify({ check: name, ok: !!ok, detail })); };
  const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1 : tol);
  const crop = async (name, m) => {
    const d = m.dock; const pad = 12;
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, d.x - pad), y: Math.max(0, d.y - pad), width: d.w + pad * 2, height: d.h + pad * 2, scale: 2 } });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64')); shots += 1;
  };
  const results = {};
  for (const dockCap of [true, false]) {
    const tag = dockCap ? 'on' : 'off';
    const inj = await send('Page.addScriptToEvaluateOnNewDocument', { source: HOST(dockCap) });
    await send('Page.navigate', { url: base + '/watch.html?v=v1' });
    await waitFor('document.readyState === "complete"');
    const claimed = await waitFor('document.body.classList.contains("ft-native-video") && window.__posts.some(function (m) { return m.type === "audio.load"; })', 20000);
    check(`${tag}: the page claimed the video for native`, claimed);
    if (!claimed) { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: inj.identifier }); continue; }
    await ev(SNAPSHOT(5)); await sleep(300);
    const slot = await ev(MEASURE);
    check(`${tag}: in the slot the surface is below / document and html.ft-native-dock is off`, slot.surface && slot.surface.visible && slot.surface.space === 'document' && (dockCap ? slot.surface.layer === 'below' : !('layer' in slot.surface)) && !slot.htmlDock, slot.surface);
    for (const cc of [false, true]) {
      if (cc) { await ev('document.getElementById("cc-btn").click(); true'); await sleep(200); }
      await ev('window.FileTube.player.dock(); true'); await sleep(500);
      const m = await ev(MEASURE);
      results[`${tag}-cc${cc ? 1 : 0}`] = m;
      await crop(`dock-${tag}-cc${cc ? 1 : 0}`, m);
      console.log(JSON.stringify(Object.assign({ shot: `dock-${tag}-cc${cc ? 1 : 0}` }, m)));
      check(`${tag} cc${cc ? 1 : 0}: docked`, m.state === 'docked' && m.dock && m.media && m.bar && m.x && m.pp);
      check(`${tag} cc${cc ? 1 : 0}: the captions mark follows the CC button`, m.ccOn === cc);
      check(`${tag} cc${cc ? 1 : 0}: the bar is a full thumb tall at the dock's bottom`, near(m.bar.h, 44) && near(m.bar.y + m.bar.h, m.dock.y + m.dock.h));
      check(`${tag} cc${cc ? 1 : 0}: play/pause sits at the bar's left`, m.pp.y >= m.bar.y - 1 && m.pp.x < m.dock.x + m.dock.w / 2);
      if (dockCap) {
        check(`on cc${cc ? 1 : 0}: html.ft-native-dock is on and the surface is above / viewport / visible at the #media-player box`, m.htmlDock && m.surface && m.surface.layer === 'above' && m.surface.space === 'viewport' && m.surface.visible === true && near(m.surface.rect.x, m.media.x) && near(m.surface.rect.y, m.media.y) && near(m.surface.rect.w, m.media.w) && near(m.surface.rect.h, m.media.h), m.surface);
        check(`on cc${cc ? 1 : 0}: the hole is closed (the picture is above the page)`, !m.bodyHole);
        check(`on cc${cc ? 1 : 0}: the X is in the bar at the right, a full thumb, not over the picture`, near(m.x.w, 44) && near(m.x.h, 44) && near(m.x.x + m.x.w, m.dock.x + m.dock.w) && near(m.x.y, m.bar.y) && m.x.y >= m.media.y + m.media.h - 1, m.x);
        check(`on cc${cc ? 1 : 0}: the bar leaves the X's seat free (the seek bar ends before it)`, (await ev('(function(){ var r = document.getElementById("seek-bar").getBoundingClientRect(); return r.right; })()')) <= m.x.x + 1);
        if (cc) {
          check('on cc1: the caption strip sits between the picture and the bar, 32 tall, with the cue in it', m.cc && !m.cc.hidden && near(m.cc.h, 32) && near(m.cc.y, m.media.y + m.media.h) && near(m.cc.y + m.cc.h, m.bar.y) && /caption line/.test(m.ccText || ''), m.cc);
          check('on cc1: the dock grew by the strip once (picture + 32 + 44) and the picture box is unchanged', near(m.dock.h, m.media.h + 32 + 44) && near(m.media.h, results['on-cc0'].media.h) && near(m.media.w, results['on-cc0'].media.w), { dock: m.dock, media: m.media });
          check('on cc1: the posted rect is the picture alone (the strip is outside it)', near(m.surface.rect.h, m.media.h) && near(m.surface.rect.y + m.surface.rect.h, m.cc.y), m.surface.rect);
          check('on cc1: --player-dock-h follows the taller dock', near(parseFloat(m.dockH), m.dock.h, 1.5), m.dockH);
        } else {
          check('on cc0: no strip while captions are off (dock = picture + bar)', near(m.dock.h, m.media.h + 44) && (!m.cc || m.cc.hidden || m.cc.display === 'none'), { dock: m.dock, cc: m.cc });
        }
        check(`on cc${cc ? 1 : 0}: nothing of the dock hit-tests over the picture but the picture box itself`, m.hit.every((h) => h === 'media-player' || h === 'player-wrapper' || h === 'player-container'), m.hit);
      } else {
        check(`off cc${cc ? 1 : 0}: CONTROL - no html class, visible false, no layer key, the X at the picture's top-right corner`, !m.htmlDock && m.surface && m.surface.visible === false && !('layer' in m.surface) && near(m.x.y, m.dock.y) && near(m.x.x + m.x.w, m.dock.x + m.dock.w) && m.x.y < m.media.y + m.media.h, { surface: m.surface, x: m.x });
        check(`off cc${cc ? 1 : 0}: CONTROL - the dock is picture + bar with no strip (captions paint over the picture as in v1.400.1)`, near(m.dock.h, m.media.h + 44) && (!cc || (m.cc && !m.cc.hidden && m.cc.y + m.cc.h <= m.bar.y + 1 && m.cc.y < m.media.y + m.media.h)), { dock: m.dock, cc: m.cc });
      }
      await ev('window.FileTube.player.expand(document.getElementById("player-slot")); true'); await sleep(400);
      if (cc) { await ev('document.getElementById("cc-btn").click(); true'); await sleep(100); }
    }
    const back = await ev(MEASURE);
    check(`${tag}: expanded again - the surface is back below / document and the class is off`, back.surface && back.surface.visible && back.surface.space === 'document' && !back.htmlDock, back.surface);
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: inj.identifier });
  }
  console.log(`SUMMARY shots=${shots} checks=${checks} failed=${failed} ${failed === 0 && shots === 4 ? 'ok' : 'FAIL'}`);
  if (failed !== 0 || shots !== 4) process.exitCode = 1;
  cleanup();
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
