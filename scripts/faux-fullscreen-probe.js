'use strict';

// faux-fullscreen-probe - the headless instrument for the faux fullscreen overlay (plan
// docs/exec-plans/completed/2026-09-26-fullscreen-black-and-border.md). Boots the real app (this tree,
// or FT_ROOT=<other worktree>) on a scratch DATA_DIR with one real H.264 clip, turns the "custom
// player on mobile" setting on, emulates an iPhone (touch, no hover, iPhone platform, 390x844 and
// 844x390), opens the watch page, plays, and taps the REAL #fs-btn into faux fullscreen. Then, for
// every era x mode, it measures the overlay (#player-wrapper.css-fullscreen): its rect against the
// viewport, its computed border / outline / box-shadow / radius, and the video's rect; and writes a
// PNG per combination. Then the same measurement on desktop (1280x800, fine pointer) in the staged
// Fullscreen API path (#fs-btn -> #fs-stage). Headless Chromium cannot show an iPhone compositor edge, so this measures the
// CSS (what the overlay paints at its edge), never the device.
//
//   node scripts/faux-fullscreen-probe.js <out-dir>
//     Env: FT_ROOT=<tree>, CHROME=<binary>, FFMPEG=<binary> (default ~/.local/bin/ffmpeg-static/ffmpeg).
//     Prints one JSON line per combination and a final summary line:
//       SUMMARY combos=<n> edge-painted=<n>   (edge-painted = a border, outline or shadow on the overlay;
//       on desktop also a corner radius, since the stage is black and a rounded host shows its corners)
//     and, for the D1 instrument: TAP (a real touch tap on #pp-btn in faux fullscreen plays the
//     video and leaves the log intact - the debug panel must not take it), LOG lines (the
//     ?debugLifecycle=1 video:* entries after a pause / resume / pause / resume), and
//       INSTRUMENT pause=<n> playing=<n> check=<n> fs-at-pause=<n>
//       PANEL ok|FAIL <the video:check line as the on-screen panel renders it>
//       SWIPE depth=<n> fullscreen <before>-><after> url <before>-><after> ok|FAIL  (v1.337: a right
//       swipe across the picture in faux fullscreen, after an in-app navigation, changes nothing)
//       SWIPE-left|up|down fullscreen <true|false> url <url> ok|FAIL  (the other three directions too)
//     Exits 1 on any painted edge, a failed tap, too few instrument lines, a cut panel line or a swipe
//     that leaves fullscreen or the page.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = process.env.FT_ROOT ? path.resolve(process.env.FT_ROOT) : path.join(__dirname, '..');
const DEBUG_PORT = 9400 + Math.floor(Math.random() * 400);
const ERAS = ['2005', '2009', '2014', '2021'];
const MODES = ['light', 'dark'];
const VIEWPORTS = [{ w: 390, h: 844 }, { w: 844, h: 390 }];

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

// what the overlay paints at its edge, measured in the page
const MEASURE = `(function () {
  var h = document.getElementById('player-wrapper'); var v = document.getElementById('media-player');
  var cs = getComputedStyle(h); var r = h.getBoundingClientRect(); var vr = v.getBoundingClientRect();
  var vv = window.visualViewport;
  return {
    faux: h.classList.contains('css-fullscreen'), bodyFaux: document.body.classList.contains('ft-css-fullscreen'),
    vp: { w: innerWidth, h: innerHeight, vvw: vv ? vv.width : null, vvh: vv ? vv.height : null },
    host: { x: r.left, y: r.top, w: r.width, h: r.height },
    video: { x: vr.left, y: vr.top, w: vr.width, h: vr.height },
    border: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join(' ') + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
    outline: cs.outlineStyle === 'none' ? 'none' : cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + cs.outlineColor,
    shadow: cs.boxShadow, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor, htmlBg: getComputedStyle(document.documentElement).backgroundColor
  };
})()`;

async function main() {
  const OUT = process.argv[2];
  if (!OUT) throw new Error('usage: node scripts/faux-fullscreen-probe.js <out-dir>');
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary>)');
  const ffmpeg = process.env.FFMPEG || path.join(os.homedir(), '.local', 'bin', 'ffmpeg-static', 'ffmpeg');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-faux-probe-'));
  const { app, updateDatabase, __mintTestSession } = require(path.join(ROOT, 'server'));
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-faux-probe-lib-'));
  const fp = path.join(lib, 'clips', 'v1.mp4');
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  // a mid-grey picture: the black letterbox and any light edge both read against it
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x808080:s=640x360:d=20', '-f', 'lavfi', '-i', 'sine=f=440:d=20',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', fp]);
  await updateDatabase((db) => {
    db.metadata = { v1: { id: 'v1', type: 'video', title: 'Probe Clip', name: 'v1.mp4', filePath: fp, rootFolder: lib, folderName: 'clips',
      channelName: 'Probe', duration: 20, width: 640, height: 360, hasThumbnail: false, ext: '.mp4', addedAt: 1788000000000 } };
    return true;
  });
  fs.mkdirSync(OUT, { recursive: true });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cookie } = __mintTestSession();
  const [cname, cvalue] = cookie.split(';')[0].split('=');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-faux-probe-chrome-'));
  const chrome = spawn(chromeBin, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-sandbox', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none',
    '--disable-gpu-rasterization', '--num-raster-threads=1', '--disable-partial-raster', '--disable-zero-copy', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (_) { /* gone */ } server.close(); };
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
  // the custom player on mobile (faux fullscreen is its surface)
  await send('Page.navigate', { url: base + '/watch.html?v=v1' });
  await waitFor('document.readyState === "complete"');
  const set = await ev(`fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ mobileCustomPlayer: true }) }).then(function (r) { return r.status; })`);
  let edge = 0; let combos = 0;
  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: base + '/watch.html?v=v1' });
    await waitFor('document.readyState === "complete"');
    if (!(await waitFor('(function(){var h=document.getElementById("player-wrapper"); var v=document.getElementById("media-player"); return !!(h && v && v.readyState >= 2 && !h.classList.contains("native-controls"));})()', 20000))) {
      console.log(JSON.stringify({ vp: vp.w + 'x' + vp.h, error: 'player never reached custom mode with a decoded frame', settingsPost: set,
        state: await ev('(function(){var h=document.getElementById("player-wrapper"); var v=document.getElementById("media-player"); return { cls: h && h.className, rs: v && v.readyState, err: v && v.error && v.error.code };})()') }));
      process.exitCode = 1; continue;
    }
    await ev('(function(){var v=document.getElementById("media-player"); v.muted = true; return v.play().then(function(){ v.pause(); v.currentTime = 5; return true; }, function(){ return false; });})()');
    // the INLINE player before fullscreen: its border is the inline chrome and must not change
    const inl = await ev(MEASURE);
    console.log(`INLINE ${vp.w}x${vp.h} border=${inl.border} radius=${inl.radius} video=${inl.video.x},${inl.video.y},${inl.video.w}x${inl.video.h}`);
    await ev('(function(){var b=document.getElementById("fs-btn"); b.click(); return true;})()');
    if (!(await waitFor('document.getElementById("player-wrapper").classList.contains("css-fullscreen")', 5000))) {
      console.log(JSON.stringify({ vp: vp.w + 'x' + vp.h, error: '#fs-btn did not enter faux fullscreen' })); process.exitCode = 1; continue;
    }
    for (const era of ERAS) {
      for (const mode of MODES) {
        await ev(`(function(){var d=document.documentElement; d.setAttribute('data-theme','${era}'); d.setAttribute('data-mode','${mode}'); return true;})()`);
        await sleep(150);
        const m = await ev(MEASURE);
        const painted = !/^0px 0px 0px 0px/.test(m.border) || m.outline !== 'none' || (m.shadow && m.shadow !== 'none');
        if (painted) edge++; combos++;
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const name = `${vp.w}x${vp.h}-${era}-${mode}.png`;
        fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.data, 'base64'));
        console.log(JSON.stringify(Object.assign({ shot: name, edgePainted: painted }, m)));
      }
    }
  }
  // D1 instrument reachability: ?debugLifecycle=1 on, faux fullscreen, pause / resume / pause / resume
  // with the REAL element events, then the video:* lines the instrument wrote. Chromium fills
  // webkitDecodedFrameCount (dec) and lacks webkitPresentationMode (pm reads '-'); on the iPhone it is
  // the other way round (dec is compiled out of iOS WebKit and reads '-', pm is filled).
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: base + '/watch.html?v=v1&debugLifecycle=1' });
  await waitFor('document.readyState === "complete"');
  await waitFor('(function(){var h=document.getElementById("player-wrapper"); var v=document.getElementById("media-player"); return !!(h && v && v.readyState >= 2 && !h.classList.contains("native-controls"));})()', 20000);
  await ev('(function(){localStorage.removeItem("ft-lifecycle-log"); var v=document.getElementById("media-player"); v.muted = true; return v.play().then(function(){ return true; }, function(){ return false; });})()');
  await ev('document.getElementById("fs-btn").click()');
  // a REAL touch tap on #pp-btn (hit-tested, unlike .click()): the panel must not take it. Paused
  // first, so the bar is up (it never auto-hides while paused) and the tap is a play.
  await ev('document.getElementById("media-player").pause()');
  await sleep(300);
  const before = await ev('(function(){var b=document.getElementById("pp-btn").getBoundingClientRect(); var n=JSON.parse(localStorage.getItem("ft-lifecycle-log")||"[]").length; return { x: b.left + b.width / 2, y: b.top + b.height / 2, n: n, paused: document.getElementById("media-player").paused, hit: (document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) || {}).id || "" };})()');
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: before.x, y: before.y }] });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(700);
  const after = await ev('({ n: JSON.parse(localStorage.getItem("ft-lifecycle-log")||"[]").length, paused: document.getElementById("media-player").paused })');
  const tapOk = before.paused === true && after.paused === false && after.n >= before.n && before.n > 0;
  console.log(`TAP pp-btn hit=${before.hit || '(none)'} paused ${before.paused}->${after.paused} log ${before.n}->${after.n} ${tapOk ? 'ok' : 'FAIL'}`);
  if (!tapOk) process.exitCode = 1;
  for (let i = 0; i < 2; i++) {
    await sleep(600); await ev('document.getElementById("pp-btn").click()'); // pause
    await sleep(600); await ev('document.getElementById("pp-btn").click()'); // resume
  }
  await sleep(7500); // the six 1s samples after the last 'playing'
  const lines = await ev('(function(){try{return JSON.parse(localStorage.getItem("ft-lifecycle-log")||"[]").filter(function(e){return /^video:/.test(e.type);}).map(function(e){return e.type+" "+e.detail;});}catch(_){return [];}})()');
  lines.forEach((l) => console.log('LOG ' + l));
  const count = (re) => lines.filter((l) => re.test(l)).length;
  const inst = { pause: count(/^video:pause /), playing: count(/^video:playing /), check: count(/^video:check /), fsAtPause: count(/^video:pause .* fs=1 /) };
  console.log(`INSTRUMENT pause=${inst.pause} playing=${inst.playing} check=${inst.check} fs-at-pause=${inst.fsAtPause}`);
  // what Dean actually SEES: the panel's rendered text must carry the check's whole line
  const panel = await ev('(function(){var p=document.getElementById("ft-lifecycle-overlay"); return p ? p.textContent : "";})()');
  const panelCheck = (panel.split('\n').find((l) => /^video:check /.test(l)) || '');
  const panelOk = / act=\S+ bg=\S+ bgp=\S+ /.test(panelCheck) && / \+f=\S+ \+dec=\S+ \+t=\S+ fser=\S+\)/.test(panelCheck);
  console.log(`PANEL ${panelOk ? 'ok' : 'FAIL'} ${panelCheck}`);
  if (inst.pause < 2 || inst.playing < 3 || inst.check < 1 || inst.fsAtPause < 2 || !panelOk) process.exitCode = 1;

  // v1.337 SWIPE (Dean: "In full screen video view if I swipe right anywhere that isn't the scrub bar it
  // exits full screen on mobile"; his ruling: a right swipe does nothing in fullscreen video). Home, then
  // an in-app navigation into the video (so the router has a page to go back to), faux fullscreen by
  // the real #fs-btn, then a REAL touch swipe right across the middle of the picture.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: base + '/' });
  await waitFor('document.readyState === "complete" && !!(window.FileTube && window.FileTube.navigate)');
  await ev('window.FileTube.navigate("/watch.html?v=v1"), true');
  await waitFor('(function(){var h=document.getElementById("player-wrapper"); var v=document.getElementById("media-player"); return location.pathname === "/watch.html" && !!(h && v && v.readyState >= 2 && !h.classList.contains("native-controls"));})()', 20000);
  await ev('document.getElementById("fs-btn").click(), true');
  await waitFor('document.getElementById("player-wrapper").classList.contains("css-fullscreen")', 5000);
  const swipeBefore = await ev('({ url: location.pathname + location.search, depth: history.state && history.state.depth, fs: document.getElementById("player-wrapper").classList.contains("css-fullscreen") })');
  const y = 422;
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y }] });
  for (const x of [110, 150, 200, 250, 300]) {
    await sleep(16);
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 3 }] });
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(1500);
  const swipeAfter = await ev('({ url: location.pathname + location.search, fs: document.getElementById("player-wrapper") ? document.getElementById("player-wrapper").classList.contains("css-fullscreen") : false })');
  const swipeOk = swipeBefore.fs === true && swipeBefore.depth > 0 && swipeAfter.fs === true && swipeAfter.url === swipeBefore.url;
  console.log(`SWIPE depth=${swipeBefore.depth} fullscreen ${swipeBefore.fs}->${swipeAfter.fs} url ${swipeBefore.url}->${swipeAfter.url} ${swipeOk ? 'ok' : 'FAIL'}`);
  if (!swipeOk) process.exitCode = 1;
  // Dean asked whether any OTHER direction glitches: a left, an up and a down swipe across the picture
  // must leave fullscreen and the page as they were too (measured, not read off the code).
  const drags = { left: [[300, 422], [250, 425], [200, 425], [150, 425], [100, 425], [60, 425]],
    up: [[195, 600], [195, 540], [195, 480], [195, 400], [195, 320], [195, 260]],
    down: [[195, 260], [195, 320], [195, 400], [195, 480], [195, 540], [195, 600]] };
  for (const dir of Object.keys(drags)) {
    const pts = drags[dir];
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
    for (const [x, yy] of pts.slice(1)) { await sleep(16); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: yy }] }); }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(1200);
    const after = await ev('({ url: location.pathname + location.search, fs: document.getElementById("player-wrapper") ? document.getElementById("player-wrapper").classList.contains("css-fullscreen") : false, scrollY: window.scrollY })');
    const ok = after.fs === true && after.url === swipeBefore.url;
    console.log(`SWIPE-${dir} fullscreen ${after.fs} url ${after.url} ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) process.exitCode = 1;
  }

  // desktop: the staged Fullscreen API path (#fs-stage), the same host border in the other fullscreen
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', platform: 'Linux x86_64' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base + '/watch.html?v=v1' });
  await waitFor('document.readyState === "complete"');
  await waitFor('(function(){var v=document.getElementById("media-player"); return !!(v && v.readyState >= 2);})()', 20000);
  await ev('(function(){var v=document.getElementById("media-player"); v.muted = true; return v.play().then(function(){ v.pause(); v.currentTime = 5; return true; }, function(){ return false; });})()');
  await send('Runtime.evaluate', { expression: 'document.getElementById("fs-btn").click()', userGesture: true });
  if (!(await waitFor('!!document.fullscreenElement', 5000))) {
    console.log(JSON.stringify({ vp: 'desktop', error: 'the Fullscreen API never engaged' })); process.exitCode = 1;
  } else {
    for (const era of ERAS) {
      for (const mode of MODES) {
        await ev(`(function(){var d=document.documentElement; d.setAttribute('data-theme','${era}'); d.setAttribute('data-mode','${mode}'); return true;})()`);
        await sleep(150);
        const m = await ev(MEASURE);
        m.fullscreenElement = await ev('document.fullscreenElement && (document.fullscreenElement.id || document.fullscreenElement.className)');
        const painted = !/^0px 0px 0px 0px/.test(m.border) || m.outline !== 'none' || (m.shadow && m.shadow !== 'none') || m.radius !== '0px';
        if (painted) edge++; combos++;
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const name = `desktop-${era}-${mode}.png`;
        fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.data, 'base64'));
        console.log(JSON.stringify(Object.assign({ shot: name, edgePainted: painted }, m)));
      }
    }
  }
  console.log(`SUMMARY combos=${combos} edge-painted=${edge}`);
  if (edge > 0) process.exitCode = 1;
  cleanup();
  process.exit(process.exitCode || 0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(2); });
