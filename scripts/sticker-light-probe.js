'use strict';
// sticker-light-probe - the side-by-side instrument for v1.334's "the sticker catches the light" (plan
// docs/exec-plans/completed/2026-09-25-pocket-open-ask-sticker-light.md, item 2 / AC2). Serves this tree's public/
// plus a fixture page that boots the REAL skin engine (music-skins.js + skin-surface.js + pocket-lighting.js,
// the real style.css) with a sticker, on a phone viewport in the Playwright-cached headless Chromium over raw
// CDP (the pocket-lighting-probe pattern). The light is driven by REAL `deviceorientation` events (the path
// the phone takes), so the driver writes --lx/--ly and the engine paints the sticker's gloss exactly as on a
// device. For every colorway x sticker kind (the logo image, an emoji chip) x tilt x size, it crops the
// sticker's corner: unlit (Off) and lit (the strength) at two light positions, then lays every crop out on
// one contact sheet (sheet.png) and writes report.json (per shot: lit, --lx/--ly, the canvases present).
//   node scripts/sticker-light-probe.js <out-dir> [--strength=subtle|pronounced|ambient] [--skins=ipod,ipod-red,ipod-black]
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node scripts/sticker-light-probe.js <out-dir> [--strength=S] [--skins=a,b]'); process.exit(2); }
const arg = (k, d) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] || d;
const STRENGTH = arg('strength', 'pronounced');
const SKINS = arg('skins', 'ipod,ipod-red,ipod-black').split(',');
const ROOT = process.env.FT_ROOT ? path.resolve(process.env.FT_ROOT) : path.join(__dirname, '..');
const DEBUG_PORT = 9333 + Math.floor(Math.random() * 400);
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort();
  for (const d of dirs.reverse()) { const bin = path.join(base, d, 'chrome-linux64', 'chrome'); if (fs.existsSync(bin)) return bin; }
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
window.__boot = function (skin, strength, sticker) {
  localStorage.setItem('ft-music-skin', skin); localStorage.setItem('ft-pocket-lighting', strength);
  localStorage.setItem('ft-sticker', JSON.stringify(sticker));
  var panel = document.getElementById('music-nowplaying-panel');
  if (window.__engine) { window.__engine.destroy(); }
  panel.hidden = true; panel.innerHTML = '';
  window.__engine = FileTubeSkinSurface.create({ panel: panel, win: window, getSkinId: function () { return skin; },
    getCtx: function () { return { track: { title: 'Night Drive', artist: 'Tonzak', album: 'Night Drive' }, upNext: [], fullList: [], playing: true, posLabel: '1:02', remLabel: '-2:41', posSec: 62, durSec: 223, curNum: 3, total: 12 }; },
    hostCtl: function (id) { return document.getElementById(id); },
    sticker: { getPlayer: function () { return null; }, onSkinChange: function () {} } });
  document.body.classList.add('mms-on'); window.__engine.paint();
  return true;
};
window.__tilt = function (beta, gamma) { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: beta, gamma: gamma })); };
window.__state = function () {
  var p = document.getElementById('music-nowplaying-panel'); var b = p.querySelector('[data-skin-sticker]');
  var r = b ? b.getBoundingClientRect() : null;
  var img = b && b.querySelector('img');
  return { lx: p.style.getPropertyValue('--lx'), ly: p.style.getPropertyValue('--ly'), lit: p.classList.contains('mms-lit'),
    shade: !!(b && b.querySelector('.mms-sticker-shade')), gloss: !!(b && b.querySelector('.mms-sticker-gloss')),
    imgReady: !!(img && img.complete && img.naturalWidth > 0), rect: r && { x: r.left, y: r.top, w: r.width, h: r.height } };
};
</script></body></html>`;
async function main() {
  const chromeBin = findChrome();
  if (!chromeBin) { console.error('no headless Chromium found (CHROME=<binary> or ~/.cache/ms-playwright)'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/fixture.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(FIXTURE); return; }
    if (u.pathname === '/sheet.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fs.readFileSync(path.join(OUT, 'sheet.html'))); return; }
    if (u.pathname.indexOf('/shots/') === 0) { const f = path.join(OUT, path.basename(u.pathname)); if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': 'image/png' }); fs.createReadStream(f).pipe(res); return; } }
    const f = path.join(ROOT, 'public', path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sticker-probe-chrome-'));
  const chrome = spawn(chromeBin, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-sandbox', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--font-render-hinting=none',
    '--disable-gpu-rasterization', '--num-raster-threads=1', '--disable-partial-raster', '--disable-zero-copy', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (_) { /* gone */ } server.close(); };
  process.on('exit', cleanup);
  const report = { chrome: chromeBin, strength: STRENGTH, shots: [], errors: [] };
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
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: `${base}/fixture.html` });
    for (let i = 0; i < 40; i++) { await sleep(250); try { if (await evalJs('typeof window.__boot === "function" && !!window.FileTubePocketLighting')) break; } catch (_) { /* loading */ } }
    const R = 20; // TILT_RANGE_DEG
    const LIGHTS = { 'upper-left': [0 + 0.5 * R, 3 + 0.8 * R], 'lower-right': [0 - 0.5 * R, 3 - 0.8 * R] };
    const KINDS = { logo: { kind: 'logo' }, emoji: { kind: 'emoji', value: '\u{1F3A7}' } };
    const rows = [];
    for (const skin of SKINS) {
      for (const [kname, kind] of Object.entries(KINDS)) {
        for (const tilt of ['left', 'right']) {
          for (const size of ['default', '2x', '3x']) {
            const sticker = Object.assign({}, kind, { tilt, size });
            const row = { skin, kind: kname, tilt, size, cells: [] };
            for (const light of ['off'].concat(Object.keys(LIGHTS))) {
              await evalJs(`window.__boot(${JSON.stringify(skin)}, ${JSON.stringify(light === 'off' ? 'off' : STRENGTH)}, ${JSON.stringify(sticker)})`);
              await sleep(250);
              if (light !== 'off') { await evalJs('window.__tilt(0, 3)'); await sleep(150); const [b, g] = LIGHTS[light]; await evalJs(`window.__tilt(${b}, ${g})`); await sleep(800); }
              const st = await evalJs('window.__state()');
              const pad = 16 + (size === '3x' ? 18 : size === '2x' ? 12 : 8);
              const cy = Math.max(0, st.rect.y - pad); const clip = { x: Math.max(0, st.rect.x - pad), y: cy, width: st.rect.w + 2 * pad, height: Math.min(st.rect.h + 2 * pad, 844 - cy), scale: 1 }; // (never past the viewport's bottom)
              const shot = await send('Page.captureScreenshot', { format: 'png', clip });
              const name = `${skin}-${kname}-${tilt}-${size}-${light}.png`;
              fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.data, 'base64'));
              const cell = { light, file: name, lit: st.lit, lx: st.lx, ly: st.ly, shade: st.shade, gloss: st.gloss, imgReady: st.imgReady };
              row.cells.push(cell); report.shots.push(Object.assign({ skin, kind: kname, tilt, size }, cell));
            }
            rows.push(row);
          }
        }
      }
    }
    // the contact sheet: one row per colorway x kind x tilt x size - Off | lit (light upper-left) | lit (light lower-right)
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;padding:16px;background:#e9e9ec;font:13px/1.3 -apple-system,system-ui,sans-serif;color:#222}
      h1{font-size:16px;margin:0 0 4px} p{margin:0 0 12px;color:#555}
      table{border-collapse:collapse} td,th{padding:4px 8px;vertical-align:middle;text-align:center}
      th{font-weight:600;color:#444} td.l{text-align:left;white-space:nowrap;color:#333}
      img{display:block;image-rendering:auto;max-height:190px}
      tr.sep td{border-top:1px solid #bbb}
    </style></head><body>
      <h1>The sticker catches the light (${STRENGTH})</h1>
      <p>Each row: the same sticker unlit (Off, today) and lit with the light upper-left, then lower-right. Real engine, real driver (deviceorientation), headless Chromium at 2x.</p>
      <table><tr><th></th><th>Off (today)</th><th>Lit: light upper-left</th><th>Lit: light lower-right</th></tr>
      ${rows.map((r, i) => `<tr class="${i && rows[i - 1].skin !== r.skin ? 'sep' : ''}"><td class="l">${r.skin.replace('ipod-', 'Click ').replace(/^ipod$/, 'Click (White)')}<br>${r.kind}, tilt ${r.tilt}, ${r.size === 'default' ? '1x' : r.size}</td>${r.cells.map((c) => `<td><img src="/shots/${c.file}"></td>`).join('')}</tr>`).join('')}
      </table></body></html>`;
    fs.writeFileSync(path.join(OUT, 'sheet.html'), html);
    report.errors = await evalJs('window.__errors'); // the fixture's page errors, before the sheet replaces it
    await send('Emulation.setDeviceMetricsOverride', { width: 760, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${base}/sheet.html` });
    await sleep(1500);
    const dims = await evalJs('({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })');
    const sheet = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: dims.w, height: dims.h, scale: 1 } });
    fs.writeFileSync(path.join(OUT, 'sheet.png'), Buffer.from(sheet.data, 'base64'));
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    const lit = report.shots.filter((s) => s.light !== 'off');
    console.log(JSON.stringify({ shots: report.shots.length, litLit: lit.filter((s) => s.lit).length, litWithGloss: lit.filter((s) => s.gloss).length, litImageWithShade: lit.filter((s) => s.kind === 'logo' && s.shade).length, offWithCanvas: report.shots.filter((s) => s.light === 'off' && (s.shade || s.gloss)).length, errors: report.errors.length, sheet: path.join(OUT, 'sheet.png') }));
  } finally { cleanup(); }
}
main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
