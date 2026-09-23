'use strict';

// sub-row-chip-probe - the MEASUREMENT instrument behind v1.316 B2 ("the
// /subscriptions row chips styled with each era's control treatment"), per the
// match-reference norm: match a reference by SAMPLING its pixels side by side,
// never by guessing.
//
// For every theme x mode (2005/2009/2014/2021 x light/dark) it serves ONE page
// from a tree (this one, or --root <dir> for a BEFORE baseline made with
// `git archive main`): the tree's real style.css + fonts, the tree's REAL
// subscriptions.js row builder (`createSubscriptionRow` is a page global) so
// the chips are built exactly as the /subscriptions page builds them, and a
// plain `<button class="btn">` reference beside them (the same `.btn` the watch
// page's Notify/Subscribed buttons are). It drives the Playwright-cached
// headless Chromium over raw CDP (no npm dependency) and prints, per combo,
// ONE JSON line with:
//   - the computed background-color / background-image / border colours /
//     border-radius / box-shadow of the reference button and of each chip
//     (pin, bell, kebab), plus a `match` map (chip property === reference);
//   - pixel samples (RGBA) at a TOP band point and a BOTTOM band point inside
//     each element (x = left+6, y = top+3 and bottom-4: inside the border,
//     outside the corner radius, off the glyph), plus `pixelMatch` (chip
//     top/bottom pixel === reference top/bottom pixel). The 2009 gloss is a
//     top-lighter / bottom-darker gradient, so on 2009 the reference's own
//     top != bottom - and a chip that MATCHES it top AND bottom carries the
//     gloss; a flat chip would match neither.
// A PNG of the row per combo lands in <out-dir> as illustration; the JSON
// lines are the evidence.
//
//   node scripts/sub-row-chip-probe.js <out-dir> [--root <tree>]
//
// Exits non-zero on any CDP failure; always kills the Chromium it spawned.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const OUT = process.argv[2];
if (!OUT) {
  console.error('usage: node scripts/sub-row-chip-probe.js <out-dir> [--root <tree>]');
  process.exit(2);
}
const ARGS = process.argv.slice(3);
const rootIdx = ARGS.indexOf('--root');
const ROOT = rootIdx !== -1 && ARGS[rootIdx + 1] ? path.resolve(ARGS[rootIdx + 1]) : path.join(__dirname, '..');
const DEBUG_PORT = 9733 + Math.floor(Math.random() * 400);
const THEMES = ['2005', '2009', '2014', '2021'];
const MODES = ['light', 'dark'];
const WIDTHS = [390, 1280];

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

const MIME = { '.css': 'text/css', '.js': 'application/javascript', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.html': 'text/html' };

// The fixture: a subscriptions-shaped row (built by the tree's REAL builder)
// and a reference `.btn`, on a `.sub-list` background, under the theme/mode
// the query string names.
const FIXTURE = (theme, mode) => `<!doctype html>
<html data-theme="${theme}" data-mode="${mode}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/style.css">
<style>body{margin:0;padding:24px;} #stage{max-width:560px;} #ref{margin:0 0 16px 0;}</style>
</head>
<body>
<div id="stage">
  <button type="button" class="btn" id="ref">Subscribed</button>
  <div class="sub-list"><div class="sub-list-body"><div class="sub-section"><div id="row-host"></div></div></div></div>
</div>
<script>
  window.__probeErrors = [];
  window.addEventListener('error', function (e) { window.__probeErrors.push(String(e.message)); });
  // NOT common.js: on load it re-applies the SAVED theme/mode to <html>, which
  // silently overrode the query's theme for every combo (the first cut of this
  // probe measured the default theme eight times and called it a match - the
  // vacuous-floor class). The row builder needs only these two page globals.
  window.deriveAvatar = function (n) { return { glyph: (n || '?')[0], color: '#888' }; };
  window.resolveAvatarSource = function (n) { var a = window.deriveAvatar(n); return { type: 'generated', glyph: a.glyph, color: a.color }; };
</script>
<script src="/subs.js"></script>
<script>
  (function () {
    var row = createSubscriptionRow({ id: 'p1', name: 'Probe Channel', channelUrl: 'https://www.youtube.com/@probe', channelDir: '/data/probe', pushBell: true }, document, {}, null, true);
    document.getElementById('row-host').appendChild(row);
    window.__probeReady = true;
  })();
</script>
</body></html>`;

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let file = null;
      if (url.pathname === '/fixture') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(FIXTURE(url.searchParams.get('theme') || '2021', url.searchParams.get('mode') || 'light'));
        return;
      }
      if (url.pathname === '/subs.js') file = path.join(ROOT, 'lib', 'ytdlp', 'client', 'subscriptions.js');
      else if (url.pathname.startsWith('/css/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/js/')) file = path.join(ROOT, 'public', url.pathname);
      if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// Decode the RGBA of a 1x1 PNG (one IDAT, one filter byte + 4 samples).
function pixelOf1x1Png(b64) {
  const buf = Buffer.from(b64, 'base64');
  let off = 8;
  const idat = [];
  let colorType = 6;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') colorType = data[9];
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const px = [];
  for (let i = 0; i < bpp; i++) px.push(raw[1 + i]); // raw[0] = the filter byte (0 for a single first pixel)
  return px;
}

const MEASURE_JS = `(function () {
  var props = ['background-color', 'background-image', 'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color', 'border-top-width', 'border-top-left-radius', 'box-shadow', 'color'];
  function one(el) {
    var cs = getComputedStyle(el); var o = { rect: null, style: {} };
    var r = el.getBoundingClientRect(); o.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    props.forEach(function (p) { o.style[p] = cs.getPropertyValue(p); });
    return o;
  }
  var out = { ref: one(document.getElementById('ref')) };
  ['sub-row-pin', 'sub-row-bell', 'sub-row-kebab'].forEach(function (c) { var el = document.querySelector('.' + c); out[c] = el ? one(el) : null; });
  var row = document.querySelector('.sub-row'); var rr = row.getBoundingClientRect();
  out.row = { x: Math.round(rr.x), y: Math.round(rr.y), w: Math.round(rr.width), h: Math.round(rr.height) };
  out.sameRowY = ['sub-row-pin', 'sub-row-bell', 'sub-row-kebab'].every(function (c) { return out[c] && Math.abs(out[c].rect.y - out['sub-row-bell'].rect.y) < 2; });
  return JSON.stringify(out);
})()`;

async function main() {
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary> or install the Playwright chromium)');
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-chip-probe-chrome-'));
  const chrome = spawn(chromeBin, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-sandbox', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (_) { /* already gone */ } server.close(); };
  process.on('exit', cleanup);
  try {
    let list = null;
    for (let i = 0; i < 40 && !list; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try { list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json(); } catch (_) { /* not up yet */ }
    }
    if (!list || !list[0]) throw new Error('Chromium never exposed its debug endpoint');
    const ws = new WebSocket(list[0].webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params) => new Promise((resolve, reject) => {
      const i = ++id;
      const t = setTimeout(() => { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(i, (m) => { clearTimeout(t); if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result); });
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    await send('Page.enable');
    const evalJson = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
    const sample = async (x, y) => pixelOf1x1Png((await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: 1, height: 1, scale: 1 } })).data);

    // Two widths: a phone (the ≤768px rules, incl. the v1.95 44px `.btn` touch
    // floor) and a desktop. Every combo is measured at both.
    for (const width of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 300, deviceScaleFactor: 1, mobile: width < 500 });
    for (const theme of THEMES) {
      for (const mode of MODES) {
        await send('Page.navigate', { url: `${base}/fixture?theme=${theme}&mode=${mode}` });
        let ready = false;
        for (let i = 0; i < 40 && !ready; i++) {
          await new Promise((r) => setTimeout(r, 150));
          ready = (await evalJson('window.__probeReady === true && document.fonts.status === "loaded"')) === true;
        }
        if (!ready) {
          const diag = await evalJson('JSON.stringify({ ready: window.__probeReady === true, fonts: document.fonts.status, errors: (window.__probeErrors || []).slice(0, 5) })');
          throw new Error(`${theme}/${mode}@${width}: fixture never became ready - ${diag}`);
        }
        // The vacuous-floor guard: the page must actually BE in the requested
        // theme/mode (the first cut measured the default theme eight times).
        const applied = JSON.parse(await evalJson('JSON.stringify([document.documentElement.getAttribute("data-theme"), document.documentElement.getAttribute("data-mode"), innerWidth])'));
        if (applied[0] !== theme || applied[1] !== mode || applied[2] !== width) throw new Error(`${theme}/${mode}@${width}: page is in ${applied.join('/')} - the measurement would be vacuous`);
        await new Promise((r) => setTimeout(r, 200));
        const m = JSON.parse(await evalJson(MEASURE_JS));
        const line = { width, theme, mode, ref: m.ref.style, refRect: m.ref.rect, chips: {}, match: {}, pixels: {}, pixelMatch: {}, sameRowY: m.sameRowY };
        const bands = async (rect) => ({ top: await sample(rect.x + 6, rect.y + 3), bottom: await sample(rect.x + 6, rect.y + rect.h - 4) });
        line.pixels.ref = await bands(m.ref.rect);
        for (const c of ['sub-row-pin', 'sub-row-bell', 'sub-row-kebab']) {
          if (!m[c]) { line.chips[c] = null; continue; }
          line.chips[c] = { rect: m[c].rect, style: m[c].style };
          line.match[c] = {};
          for (const p of ['background-color', 'background-image', 'border-top-color', 'border-bottom-color', 'border-top-width', 'border-top-left-radius', 'box-shadow']) {
            line.match[c][p] = m[c].style[p] === m.ref.style[p];
          }
          line.pixels[c] = await bands(m[c].rect);
          line.pixelMatch[c] = {
            top: line.pixels[c].top.join(',') === line.pixels.ref.top.join(','),
            bottom: line.pixels[c].bottom.join(',') === line.pixels.ref.bottom.join(','),
          };
        }
        line.refGlossy = line.pixels.ref.top.join(',') !== line.pixels.ref.bottom.join(',');
        console.log(JSON.stringify(line));
        try {
          const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height: 220, scale: 1 } });
          fs.writeFileSync(path.join(OUT, `chips-${width}-${theme}-${mode}.png`), Buffer.from(shot.data, 'base64'));
        } catch (err) { console.error(`${theme}/${mode}@${width}: screenshot failed (${err.message}) - the JSON line is the evidence`); }
      }
    }
    }
    ws.close();
  } finally {
    cleanup();
  }
}

main().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
