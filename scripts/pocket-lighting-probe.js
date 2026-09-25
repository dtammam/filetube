'use strict';
// pocket-lighting-probe - the MEASUREMENT instrument for the pocket skins' gyro lighting
// (plan docs/exec-plans/completed/2026-09-24-pocket-gyro-lighting.md, AC8). Serves this tree's
// public/ plus a fixture page that boots the REAL skin engine (music-skins.js + skin-surface.js +
// pocket-lighting.js, the real style.css) on a phone viewport in the Playwright-cached headless
// Chromium over raw CDP (the action-row-probe pattern), then:
//   1. per Click skin, screenshots at the light at neutral, upper-left and lower-right - driven by
//      REAL `deviceorientation` events on the window (the exact listener path the phone takes);
//   2. Performance.getMetrics over N frames of a MOVING light vs N frames STILL: script + style +
//      layout main-thread time per frame (the CPU cost), and the driver's write count;
//   3. DOMDebugger.getEventListeners on `window`: `deviceorientation` listeners when Off, On, after
//      a dock (the panel cleared with no destroy), after destroy.
// Prints one JSON report and writes it + the PNGs to <out-dir>. Exits non-zero on a CDP failure.
//   node scripts/pocket-lighting-probe.js <out-dir> [--frames=N] [--strength=subtle|pronounced|ambient]
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node scripts/pocket-lighting-probe.js <out-dir> [--frames N]'); process.exit(2); }
const FRAMES = Number((process.argv.find((a) => a.startsWith('--frames=')) || '').split('=')[1]) || 240;
const STRENGTH = (process.argv.find((a) => a.startsWith('--strength=')) || '').split('=')[1] || 'pronounced'; // the profile to screenshot
const ROOT = path.join(__dirname, '..');
const DEBUG_PORT = 9333;
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort();
  for (const d of dirs.reverse()) { const bin = path.join(d.startsWith('/') ? d : base, d, 'chrome-linux64', 'chrome'); if (fs.existsSync(bin)) return bin; }
  return null;
}
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/css/style.css"></head>
<body data-view="music">
<video id="media-player"></video><button id="pp-btn" hidden></button><button id="track-prev-btn" hidden></button><button id="track-next-btn" hidden></button><input id="seek-bar" type="range" hidden>
<div id="music-nowplaying-panel" class="music-nowplaying-panel" hidden></div>
<script src="/js/music-skins.js"></script><script src="/js/skin-surface.js"></script><script src="/js/pocket-lighting.js"></script>
<script>
window.__errors = []; window.addEventListener('error', function (e) { window.__errors.push(String(e.message)); });
window.__boot = function (skin, strength) {
  localStorage.setItem('ft-music-skin', skin); localStorage.setItem('ft-pocket-lighting', strength);
  var panel = document.getElementById('music-nowplaying-panel');
  if (window.__engine) { window.__engine.destroy(); }
  panel.hidden = true; panel.innerHTML = '';
  window.__engine = FileTubeSkinSurface.create({ panel: panel, win: window, getSkinId: function () { return skin; },
    getCtx: function () { return { track: { title: 'Night Drive', artist: 'Tonzak', album: 'Night Drive' }, upNext: [], fullList: [], playing: true, posLabel: '1:02', remLabel: '-2:41', posSec: 62, durSec: 223, curNum: 3, total: 12 }; },
    hostCtl: function (id) { return document.getElementById(id); },
    menu: { load: function () { return Promise.resolve({ items: [] }); }, onPlay: function () {}, hasCurrent: function () { return true; }, currentId: function () { return 'x'; }, dataVersion: function () { return 0; } } });
  document.body.classList.add('mms-on'); window.__engine.paint();
  return window.__engine.lightingState();
};
window.__tilt = function (beta, gamma) { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: beta, gamma: gamma })); };
window.__props = function () { var p = document.getElementById('music-nowplaying-panel'); return { lx: p.style.getPropertyValue('--lx'), ly: p.style.getPropertyValue('--ly'), lit: p.classList.contains('mms-lit'), state: window.__engine && window.__engine.lightingState() }; };
window.__dock = function () { var p = document.getElementById('music-nowplaying-panel'); p.hidden = true; p.innerHTML = ''; };
window.__frames = function (n, amp) { return new Promise(function (res) { var i = 0; (function step() { if (i >= n) return res(i); if (amp) window.__tilt(40, 3 + amp * Math.sin(i / 25)); i++; requestAnimationFrame(step); })(); }); };
</script></body></html>`;
async function main() {
  const chromeBin = findChrome();
  if (!chromeBin) { console.error('no headless Chromium found (CHROME=<binary> or ~/.cache/ms-playwright)'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/fixture.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(FIXTURE); return; }
    const f = path.join(ROOT, 'public', path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-lit-probe-chrome-'));
  const chrome = spawn(chromeBin, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-sandbox', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (_) { /* gone */ } server.close(); };
  process.on('exit', cleanup);
  const report = { chrome: chromeBin, frames: FRAMES, strength: STRENGTH, skins: {}, cpu: {}, listeners: {}, errors: [] };
  try {
    let list = null;
    for (let i = 0; i < 40 && !list; i++) { await new Promise((r) => setTimeout(r, 250)); try { list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json(); } catch (_) { /* not up */ } }
    if (!list || !list[0]) throw new Error('Chromium never exposed its debug endpoint');
    const ws = new WebSocket(list[0].webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0; const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params) => new Promise((resolve, reject) => {
      const i = ++id; const t = setTimeout(() => { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      pending.set(i, (m) => { clearTimeout(t); if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result); });
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text)); return r.result.value; };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: `${base}/fixture.html` });
    for (let i = 0; i < 40; i++) { await sleep(250); try { if (await evalJs('typeof window.__boot === "function" && !!window.FileTubePocketLighting')) break; } catch (_) { /* loading */ } }
    const orientListeners = async () => {
      const w = await send('Runtime.evaluate', { expression: 'window', objectGroup: 'probe' });
      const l = await send('DOMDebugger.getEventListeners', { objectId: w.result.objectId });
      return (l.listeners || []).filter((x) => x.type === 'deviceorientation').length;
    };
    // 1. per-skin screenshots at three light positions (a REAL deviceorientation event path)
    const R = 20; // TILT_RANGE_DEG (pocket-lighting.js)
    const POS = { neutral: [0, 3], 'upper-left': [0 + 0.5 * R, 3 + 0.8 * R], 'lower-right': [0 - 0.5 * R, 3 - 0.8 * R] };
    const SKR = require(path.join(ROOT, 'public', 'js', 'music-skins.js'));
    for (const skin of (typeof SKR.clickColorways === 'function' ? SKR.clickColorways() : SKR.SKINS.filter((s) => s.menus === 'click').map((s) => s.id))) { // every Click colorway (the registry)
      const st = await evalJs(`window.__boot(${JSON.stringify(skin)}, ${JSON.stringify(STRENGTH)})`);
      await sleep(300);
      await evalJs('window.__tilt(0, 3)'); await sleep(120); // the opening pose = neutral
      const shots = {};
      for (const [name, [beta, gamma]] of Object.entries(POS)) {
        await evalJs(`window.__tilt(${beta}, ${gamma})`); await sleep(700);
        const props = await evalJs('window.__props()');
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const file = path.join(OUT, `${skin}-${STRENGTH}-${name}.png`); fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
        shots[name] = { lx: props.lx, ly: props.ly, lit: props.lit, file };
      }
      report.skins[skin] = { booted: st, shots };
    }
    // 2. CPU: moving vs still, the same skin, the same frame count
    // (v1.333: the CPU run uses --strength too, so Ambient's cost is measured against Pronounced's)
    await evalJs(`window.__boot('ipod', ${JSON.stringify(STRENGTH)})`); await sleep(300); await evalJs('window.__tilt(0, 3)'); await sleep(100);
    const metrics = async () => { const m = await send('Performance.getMetrics'); const o = {}; for (const x of m.metrics) o[x.name] = x.value; return o; };
    const run = async (amp) => {
      const w0 = (await evalJs('window.__props()')).state.writes;
      const m0 = await metrics(); const n = await evalJs(`window.__frames(${FRAMES}, ${amp})`); const m1 = await metrics();
      const w1 = (await evalJs('window.__props()')).state.writes;
      const per = (k) => Math.round(((m1[k] - m0[k]) * 1000 / n) * 1000) / 1000; // ms per frame
      return { frames: n, writes: w1 - w0, scriptMsPerFrame: per('ScriptDuration'), styleMsPerFrame: per('RecalcStyleDuration'), layoutMsPerFrame: per('LayoutDuration'), taskMsPerFrame: per('TaskDuration'), styleRecalcs: m1.RecalcStyleCount - m0.RecalcStyleCount, layouts: m1.LayoutCount - m0.LayoutCount };
    };
    report.cpu.moving = await run(20);
    // "still" = the sensor went quiet AND the light finished drifting home (the loop parked)
    for (let i = 0; i < 120; i++) { if ((await evalJs('window.__props()')).state.raf === false) break; await sleep(500); }
    report.cpu.still = await run(0);
    report.cpu.stillState = (await evalJs('window.__props()')).state;
    // 3. the listener census through the arms
    report.listeners.off = await (async () => { await evalJs("window.__boot('ipod', 'off')"); await sleep(200); return { deviceorientation: await orientListeners(), lit: (await evalJs('window.__props()')).lit }; })();
    report.listeners.on = await (async () => { await evalJs("window.__boot('ipod', 'pronounced')"); await sleep(200); return { deviceorientation: await orientListeners(), lit: (await evalJs('window.__props()')).lit }; })();
    report.listeners.docked = await (async () => { await evalJs('window.__dock()'); await sleep(300); return { deviceorientation: await orientListeners(), state: (await evalJs('window.__props()')).state }; })();
    report.listeners.destroyed = await (async () => { await evalJs("window.__boot('ipod', 'pronounced')"); await sleep(200); await evalJs('window.__engine.destroy()'); await sleep(100); return { deviceorientation: await orientListeners() }; })();
    report.listeners.nonPocket = await (async () => { await evalJs("window.__boot('apple', 'pronounced')"); await sleep(200); return { deviceorientation: await orientListeners(), lit: (await evalJs('window.__props()')).lit, state: (await evalJs('window.__props()')).state }; })();
    report.errors = await evalJs('window.__errors');
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { cleanup(); }
}
main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
