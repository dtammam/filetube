'use strict';
// native-video-surface-probe - the headless instrument for the v1.399.0 native video surface (plan
// docs/exec-plans/active/2026-10-28-native-video-surface.md, W5). Boots the real app (this tree, or FT_ROOT=<other worktree>)
// on a scratch DATA_DIR with one real H.264 clip, emulates an iPhone (touch, no hover, iPhone platform, 390x844) and injects a
// FAKE HOST before any page script - `window.FileTubeHost` announcing nativeAudio + nativeVideoAudio + nativeVideo, recording
// every message the page posts - exactly as the iOS app's document-start script does. Then it opens the watch page, waits for
// the claim (body.ft-native-video: the page paints its hole), dispatches native's audioState snapshot (playing, 1920x1080) the
// way the app would, OUTLINES the transparent region (a dashed red outline on #media-player: the hole native's layer shows
// through - headless Chromium paints its own white canvas there) and writes one PNG per mode (light, dark) for the in-page
// player, the CSS fullscreen (a tap on the bar's #fs-btn) and the docked mini player (FileTube.player.dock()). It prints one
// JSON line per shot (the last video.surface the page posted, the hole's clip-path, the body / wrapper backgrounds) and
//   SUMMARY shots=<n> claims=<n> surfaces=<n> ok|FAIL
// Exits 1 when the claim never happened, a shot's surface is missing, or a background behind the box still paints.
//
//   node scripts/native-video-surface-probe.js <out-dir>
//     Env: FT_ROOT=<tree>, CHROME=<binary>, FFMPEG=<binary> (default ~/.local/bin/ffmpeg-static/ffmpeg).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const ROOT = process.env.FT_ROOT ? path.resolve(process.env.FT_ROOT) : path.join(__dirname, '..');
const DEBUG_PORT = 9800 + Math.floor(Math.random() * 400);
const MODES = ['light', 'dark'];

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

// The app's document-start injection, as a fake: the host object and a recorder. The page's adapter posts through
// window.FileTubeHost.post and hears native through a 'filetube-host' CustomEvent on window.
const HOST = `(function () {
  window.__posts = [];
  window.FileTubeHost = { bridge: 1, app: { name: 'filetube-ios', version: '0.16.0', build: '1' }, platform: 'ios',
    capabilities: ['orientation', 'haptics', 'battery', 'serverSettings', 'downloads', 'mediaFetch', 'nativeAudio', 'nativeVideoAudio', 'nativeVideo'],
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
  var s = window.__posts.filter(function (m) { return m.type === 'video.surface'; });
  var hole = document.getElementById('ft-video-hole'); var v = document.getElementById('media-player'); var h = document.getElementById('player-wrapper');
  var vr = v.getBoundingClientRect();
  return {
    surface: s.length ? s[s.length - 1] : null, surfaces: s.length,
    claims: window.__posts.filter(function (m) { return m.type === 'audio.load'; }).length,
    bodyClass: document.body.classList.contains('ft-native-video'),
    hole: hole ? (hole.style.getPropertyValue('clip-path') || hole.style.getPropertyValue('-webkit-clip-path') || '(fullscreen: no clip)') : null,
    holeBg: hole ? getComputedStyle(hole).backgroundColor : null,
    bodyBg: getComputedStyle(document.body).backgroundColor, htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    wrapperBg: getComputedStyle(h).backgroundColor, videoBg: getComputedStyle(v).backgroundColor,
    box: { x: vr.left, y: vr.top, w: vr.width, h: vr.height }, scrollY: window.scrollY,
    controls: v.hasAttribute('controls'), src: v.getAttribute('src'), poster: v.getAttribute('poster'),
    faux: h.classList.contains('css-fullscreen'), state: window.FileTube.player.getState(),
    holeDisplay: hole ? getComputedStyle(hole).display : null,
    viewRootVisibility: (function () { var vr0 = document.getElementById('view-root'); return vr0 ? getComputedStyle(vr0).visibility : null; })(),
    wrapperVisibility: getComputedStyle(h).visibility,
    logoVisible: (function () { var img = document.querySelector('header .logo-img'); return !!(img && getComputedStyle(img).visibility === 'visible'); })(),
    videoWidth: v.videoWidth, currentTime: Math.round(v.currentTime * 10) / 10
  };
})()`;
const TRANSPARENT = /^(rgba\(0, 0, 0, 0\)|transparent)$/;

async function main() {
  const OUT = process.argv[2];
  if (!OUT) throw new Error('usage: node scripts/native-video-surface-probe.js <out-dir>');
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary>)');
  const ffmpeg = process.env.FFMPEG || path.join(os.homedir(), '.local', 'bin', 'ffmpeg-static', 'ffmpeg');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-nvs-probe-'));
  const { app, updateDatabase, __mintTestSession } = require(path.join(ROOT, 'server'));
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-nvs-probe-lib-'));
  const fp = path.join(lib, 'clips', 'v1.mp4');
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x808080:s=640x360:d=20', '-f', 'lavfi', '-i', 'sine=f=440:d=20',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', fp]);
  await updateDatabase((db) => {
    db.metadata = { v1: { id: 'v1', type: 'video', title: 'Native surface probe', name: 'v1.mp4', filePath: fp, rootFolder: lib, folderName: 'clips',
      channelName: 'Probe', duration: 20, width: 1920, height: 1080, hasThumbnail: false, ext: '.mp4', addedAt: 1788000000000 } };
    return true;
  });
  fs.mkdirSync(OUT, { recursive: true });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cookie } = __mintTestSession();
  const [cname, cvalue] = cookie.split(';')[0].split('=');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-nvs-probe-chrome-'));
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: HOST });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  let shots = 0, bad = 0, claims = 0, surfaces = 0;
  const shoot = async (name, label) => {
    await ev(`(function () { var o = document.getElementById('nvs-outline-style'); if (!o) { o = document.createElement('style'); o.id = 'nvs-outline-style'; document.head.appendChild(o); }
      o.textContent = 'body.ft-native-video #media-player { outline: 3px dashed #ff3b30; outline-offset: -3px; } #nvs-label { position: fixed; left: 8px; bottom: 8px; z-index: 99999; font: 12px/1.3 -apple-system, sans-serif; background: rgba(0,0,0,.72); color: #fff; padding: 4px 8px; border-radius: 6px; }';
      var l = document.getElementById('nvs-label'); if (!l) { l = document.createElement('div'); l.id = 'nvs-label'; document.body.appendChild(l); } l.textContent = ${JSON.stringify(label)}; return true; })()`);
    await sleep(250);
    const m = await ev(MEASURE);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
    shots += 1; claims = m.claims; surfaces = m.surfaces;
    // behind the box nothing may paint: body, wrapper and element transparent; in the CSS fullscreen the hole layer is off and the
    // view's content hidden while the wrapper stays visible (the picture is the whole viewport)
    let paints = m.bodyClass && m.surface && m.surface.visible && !(TRANSPARENT.test(m.bodyBg) && TRANSPARENT.test(m.wrapperBg) && TRANSPARENT.test(m.videoBg));
    if (m.faux && m.bodyClass && !(m.holeDisplay === 'none' && m.viewRootVisibility === 'hidden' && m.wrapperVisibility === 'visible')) paints = true;
    if (m.faux && m.bodyClass && m.logoVisible) paints = true; // the custom logo image over the picture (its own visibility: visible inside the hidden header)
    if (!m.surface || paints) bad += 1;
    console.log(JSON.stringify(Object.assign({ shot: name, paintsBehindTheBox: !!paints }, m)));
  };
  for (const mode of MODES) {
    await send('Page.navigate', { url: base + '/watch.html?v=v1' });
    await waitFor('document.readyState === "complete"');
    await ev(`(function(){ var d = document.documentElement; d.setAttribute('data-mode', '${mode}'); return true; })()`);
    const claimed = await waitFor('document.body.classList.contains("ft-native-video") && window.__posts.some(function (m) { return m.type === "audio.load"; })', 20000);
    if (!claimed) { console.log(JSON.stringify({ mode, error: 'the page never claimed the video for native', posts: await ev('window.__posts.map(function (m) { return m.type; })') })); process.exitCode = 1; continue; }
    await ev(SNAPSHOT(5));
    await sleep(300);
    await shoot(`watch-slot-${mode}`, `v1.399.0 native video surface - in-page player, ${mode}. Dashed red = the transparent hole (native's picture layer shows through it).`);
    // the docked mini player: no picture (visible: false), the sound plays on
    await ev('window.FileTube.player.dock(); true');
    await sleep(400);
    await shoot(`watch-dock-${mode}`, `Docked mini player, ${mode}: the picture is hidden (visible: false); the sound continues; the thumbnail would show here (this clip has none).`);
    await ev('window.FileTube.player.expand(document.getElementById("player-slot")); true');
    await sleep(400);
    // the web's CSS fullscreen through the bar's own button
    const fs1 = await ev('(function(){ var b = document.getElementById("fs-btn"); if (!b) return "no-btn"; b.click(); return document.getElementById("player-wrapper").classList.contains("css-fullscreen"); })()');
    await sleep(500);
    await shoot(`watch-fullscreen-${mode}`, `CSS fullscreen (the bar's own button: ${fs1}), ${mode}: a viewport rect; the whole viewport is the hole.`);
  }
  console.log(`SUMMARY shots=${shots} claims=${claims} surfaces=${surfaces} ${bad === 0 && shots === 6 ? 'ok' : 'FAIL'}`);
  if (bad !== 0 || shots !== 6) process.exitCode = 1;
  cleanup();
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
