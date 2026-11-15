'use strict';

// pocket-top-edge-probe - v1.408.0 (plan docs/exec-plans/active/2026-11-15-ipod-hold-switch.md, W1): measures the Click full
// player's top edge in headless Chromium over raw CDP (the pocket-render-probe pattern), per phone size and skin.
//
//   node scripts/pocket-top-edge-probe.js [skin ...]
//
// Headless Chromium has no safe area: env(safe-area-inset-top) is 0, so each row sets the top inset through the turn
// window's property on <html> (--pk-top-inset, the second link of the chain the padding and the cut both read) - the same
// value the phone's env() gives in a steady portrait. One JSON line per row: the inset, the strip's bottom (= the body's
// top), the edge band, the LCD's top, the panel's top padding, and the Hold knob's box when one is drawn. A row passes when
// the body's top equals max(inset, the strip minimum) and the LCD sits below the edge band. A web page cannot read where the
// Dynamic Island ends (R12: the cut is the safe-area line), so the island is not a column.
// Env: VIEWPORTS=393x852:59,430x932:59,375x812:50,320x568:20,375x667:0 (w x h : inset), CHROME=<binary>, SIDEWAYS=1 (the Sideways
// setting: a landscape row then expects the cut from env() - 0 in headless - so the strip minimum, whatever the turn property says).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ROWS = (process.env.VIEWPORTS || '393x852:59,430x932:59,375x812:50,320x568:20,375x667:0').split(',').map((s) => {
  const [wh, inset] = s.split(':'); const [w, h] = wh.split('x').map(Number); return { w, h, inset: Number(inset) };
});
const PORT = 9333 + Math.floor(Math.random() * 400);

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const bin = path.join(base, d, 'chrome-linux64', 'chrome');
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}
function wav(seconds) {
  const rate = 8000; const n = rate * seconds; const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  b.fill(128, 44); return b;
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
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
  return { ws, send, ev };
}

const MEASURE = `(function () {
  var p = document.getElementById('music-nowplaying-panel'); if (!p) return null;
  var box = function (el) { if (!el) return null; var r = el.getBoundingClientRect(); return r.width || r.height ? { x: +r.left.toFixed(2), y: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) } : null; };
  var cs = getComputedStyle(p);
  return { cls: p.className, padTop: parseFloat(cs.paddingTop), strip: box(p.querySelector('.ip-top')), edge: box(p.querySelector('.ip-edge')),
    lcd: box(p.querySelector('.ip-lcd')), knob: box(p.querySelector('.ip-hold-knob')), hit: box(p.querySelector('[data-skin-hold]')) };
})()`;

async function main(skins) {
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary>)');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-top-edge-probe-'));
  const { app, updateDatabase, __mintTestSession } = require(path.join(ROOT, 'server'));
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-top-edge-lib-'));
  const fp = path.join(lib, 'a', 'nd1.wav'); fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, wav(60));
  await updateDatabase((db) => { db.metadata = { nd1: { id: 'nd1', type: 'audio', title: 'Neon Arrival', name: 'nd1.wav', filePath: fp, rootFolder: lib, folderName: 'a', channelName: 'Tonzak', duration: 60, hasThumbnail: false, ext: '.wav', addedAt: 1788000000000, tags: { artist: 'Tonzak', title: 'Neon Arrival', album: 'Night Drive', track: '1' } } }; return true; });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const [cn, cv] = __mintTestSession().cookie.split(';')[0].split('=');
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-top-edge-chrome-'));
  const chrome = spawn(chromeBin, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (_) { /* gone */ } server.close(); };
  process.on('exit', cleanup);
  let list = null;
  for (let i = 0; i < 40 && !list; i++) { await new Promise((r) => setTimeout(r, 250)); try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch (_) { /* not up */ } }
  if (!list) throw new Error('Chromium never exposed its debug endpoint');
  const { ws, send, ev } = await cdp(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await send('Page.enable'); await send('Network.enable');
  await send('Network.setCookie', { name: cn, value: cv, url: base });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  // the phone class needs a coarse pointer and a short screen side (music-skins.js detectPhone)
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (x, ms) => { const end = Date.now() + (ms || 20000); while (Date.now() < end) { if (await ev(x)) return true; await sleep(100); } return false; };
  const min = 8; // --pk-hold-strip-min (tokens.css); a row that disagrees fails loudly
  let failed = 0;
  for (const row of ROWS) {
    await send('Emulation.setDeviceMetricsOverride', { width: row.w, height: row.h, deviceScaleFactor: 2, mobile: true, screenWidth: row.w, screenHeight: row.h });
    for (const skin of skins) {
      await send('Page.navigate', { url: base + '/music' }); await sleep(600);
      await ev(`localStorage.setItem('ft-music-skin', ${JSON.stringify(skin)}); localStorage.removeItem('ft-tray-mode'); localStorage.setItem('ft-pocket-lighting', 'off'); localStorage.setItem('ft-pocket-sideways', ${process.env.SIDEWAYS === '1' ? "'1'" : "'0'"}); true`);
      await send('Page.navigate', { url: base + '/music?play=nd1' });
      const up = await waitFor(`!!document.querySelector('#music-nowplaying-panel.mms-full') && !!(window.FileTube && FileTube.player && FileTube.player.currentId)`);
      if (!up) { console.log(JSON.stringify({ row: `${row.w}x${row.h}`, skin, error: 'the full player never opened' })); failed++; continue; }
      await sleep(700);
      await ev(`document.documentElement.style.setProperty('--pk-top-inset', '${row.inset}px'); true`);
      await sleep(200);
      const m = await ev(MEASURE);
      const click = !!(m && m.strip);
      const want = process.env.SIDEWAYS === '1' && row.w > row.h ? min : Math.max(row.inset, min);
      const ok = !click ? !/mms-ipod/.test(m.cls) : (Math.abs(m.strip.h - want) < 0.01 && Math.abs(m.edge.y - want) < 0.01 && m.lcd.y > m.edge.y + m.edge.h);
      if (!ok) failed++;
      console.log(JSON.stringify({ row: `${row.w}x${row.h}`, inset: row.inset, skin, bodyTop: click ? m.strip.h : null, edge: m.edge, lcdTop: m.lcd && m.lcd.y, padTop: m.padTop, knob: m.knob, hit: m.hit, ok }));
    }
  }
  console.log(`TOTAL: ${ROWS.length * skins.length} rows, ${failed} failed`);
  ws.close(); cleanup();
  return failed === 0;
}

const skins = process.argv.slice(2);
main(skins.length ? skins : ['ipod-original', 'ipod', 'ipod-2004', 'ipod-blue', 'ipod-nano4-orange', 'ipod-custom5-transparent', 'apple'])
  .then((ok) => process.exit(ok ? 0 : 1), (e) => { console.error(e && e.stack ? e.stack : e); process.exit(2); });
