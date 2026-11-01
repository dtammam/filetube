'use strict';
// select-bar-probe - the headless instrument for v1.400.0 multi-select's action bar (plan
// docs/exec-plans/active/2026-11-01-multi-select.md, acceptance 10). Boots the real app (this tree, or
// FT_ROOT=<other worktree>) on a scratch DATA_DIR with eight real H.264 clips, opens the home grid at a phone
// (390x844, touch) and a desktop (1280x800) viewport, enters select mode through the grid header's Select,
// ticks two cards, and prints ONE JSON line per cell: the bar's rect, the bottom nav's rect (phone), the
// mini player's rect (after a watch-page play docked it), the overlap areas (must be 0) and the page's
// scrollWidth against innerWidth (must not overflow). Then the same cell with the dock showing. A tree
// without the bar (main: the "before") prints the nav and dock rects with bar:null, so the two trees'
// chrome numbers can be compared side by side. Writes a PNG per cell.
//   SUMMARY cells=<n> ok|FAIL
// Exits 1 when a bar overlaps the nav or the dock, the page overflows, or (on this tree) the bar never showed.
//
//   node scripts/select-bar-probe.js <out-dir>
//     Env: FT_ROOT=<tree>, CHROME=<binary>, FFMPEG=<binary> (default ~/.local/bin/ffmpeg-static/ffmpeg).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const ROOT = process.env.FT_ROOT ? path.resolve(process.env.FT_ROOT) : path.join(__dirname, '..');
const DEBUG_PORT = 9800 + Math.floor(Math.random() * 400);
const CELLS = [
  { name: 'phone-390', width: 390, height: 844, mobile: true },
  { name: 'desktop-1280', width: 1280, height: 800, mobile: false },
];

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
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    // page errors are evidence: a thrown exception in the page explains a bar that never showed
    if (m.method === 'Runtime.exceptionThrown') console.log(JSON.stringify({ pageError: (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text || '').slice(0, 600), url: m.params.exceptionDetails.url, line: m.params.exceptionDetails.lineNumber }));
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const i = ++mid; const t = setTimeout(() => { pending.delete(i); reject(new Error('CDP timeout: ' + method)); }, 60000);
    pending.set(i, (m) => { clearTimeout(t); if (m.error) reject(new Error(method + ': ' + m.error.message)); else resolve(m.result); });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
  return { ws, send, ev };
}

const MEASURE = `(function () {
  function rect(el) { if (!el) return null; var r = el.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) }; }
  function overlap(a, b) { if (!a || !b) return 0; var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x); var h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return (w > 0 && h > 0) ? w * h : 0; }
  var bar = document.querySelector('.select-bar:not([hidden])');
  var nav = document.querySelector('.bottom-nav'); var navR = nav && getComputedStyle(nav).display !== 'none' ? rect(nav) : null;
  var dock = document.getElementById('player-dock'); var dockR = dock && !dock.hidden ? rect(dock) : null;
  var barR = rect(bar);
  var verbs = bar ? bar.querySelectorAll('[data-bulk-action]') : [];
  var rows = bar ? Array.from(verbs).map(function (b) { return Math.round(b.getBoundingClientRect().top); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).length : 0;
  return {
    bar: barR, nav: navR, dock: dockR,
    overlapNav: overlap(barR, navR), overlapDock: overlap(barR, dockR),
    barBelowViewport: barR ? Math.max(0, barR.bottom - window.innerHeight) : 0,
    verbs: verbs.length, verbRows: rows, verbsScrollable: bar ? (function () { var v = bar.querySelector('.select-bar__verbs'); return v ? v.scrollWidth > v.clientWidth + 1 : false; })() : false,
    count: bar ? (bar.querySelector('.select-bar__count') || {}).textContent : null,
    selected: document.querySelectorAll('.video-card.is-selected').length,
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    hasDock: document.documentElement.classList.contains('has-player-dock'), dockH: getComputedStyle(document.documentElement).getPropertyValue('--player-dock-h').trim(),
    cards: document.querySelectorAll('#video-grid .video-card').length, selectMode: !!document.querySelector('#video-grid.is-select-mode'),
    selectBtn: (function () { var b = document.getElementById('select-mode-btn'); return b ? { hidden: b.hidden, display: getComputedStyle(b).display, pressed: b.getAttribute('aria-pressed') } : null; })(),
    viewRoot: (function () { var v = document.getElementById('view-root'); return v ? (v.getAttribute('data-view') || v.className || 'present') : null; })(),
    url: location.pathname + location.search
  };
})()`;

async function main() {
  const OUT = process.argv[2];
  if (!OUT) throw new Error('usage: node scripts/select-bar-probe.js <out-dir>');
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary>)');
  const ffmpeg = process.env.FFMPEG || path.join(os.homedir(), '.local', 'bin', 'ffmpeg-static', 'ffmpeg');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sel-probe-'));
  const { app, updateDatabase, __mintTestSession } = require(path.join(ROOT, 'server'));
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sel-probe-lib-'));
  const clipsDir = path.join(lib, 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });
  const first = path.join(clipsDir, 'v1.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x808080:s=640x360:d=20', '-f', 'lavfi', '-i', 'sine=f=440:d=20',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', first]);
  const meta = {};
  for (let i = 1; i <= 8; i++) {
    const fp = path.join(clipsDir, 'v' + i + '.mp4');
    if (i > 1) fs.copyFileSync(first, fp);
    meta['v' + i] = { id: 'v' + i, type: 'video', title: 'Select bar probe ' + i, name: 'v' + i + '.mp4', filePath: fp, rootFolder: lib, folderName: 'clips',
      channelName: 'Probe', duration: 20, width: 640, height: 360, hasThumbnail: false, ext: '.mp4', addedAt: 1788000000000 - i * 1000, size: 1024 * 1024 * i };
  }
  // a configured folder (its own table: the test seed helper writes it), or the home page shows the welcome box instead of the grid
  const { seedState } = require(path.join(ROOT, 'test', 'helpers', 'seed-state'));
  seedState({ folders: [lib], folderSettings: {}, metadata: meta, liked: [], settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  void updateDatabase;
  fs.mkdirSync(OUT, { recursive: true });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cookie } = __mintTestSession();
  const [cname, cvalue] = cookie.split(';')[0].split('=');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sel-probe-chrome-'));
  const chrome = spawn(chromeBin, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-sandbox', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none',
    '--disable-gpu-rasterization', '--num-raster-threads=1', '--disable-partial-raster', '--disable-zero-copy', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => {
    try { chrome.kill('SIGKILL'); } catch (_) { /* gone */ }
    server.close();
    for (const d of [process.env.DATA_DIR, lib, profile]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* a scratch dir */ } }
  };
  process.on('exit', cleanup);
  let list = null;
  for (let i = 0; i < 40 && !list; i++) { await new Promise((r) => setTimeout(r, 250)); try { list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json(); } catch (_) { /* not up */ } }
  if (!list) throw new Error('Chromium never exposed its debug endpoint');
  const { send, ev } = await cdp(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expr, ms) => { const end = Date.now() + (ms || 15000); while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100); } return false; };
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  await send('Network.setCookie', { name: cname, value: cvalue, url: base });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  let cells = 0, bad = 0;
  const shoot = async (name) => {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  const enterSelect = async () => {
    // the header Select (static in index.html on this tree; absent on main) then two cards
    const entered = await ev(`(function () { var b = document.getElementById('select-mode-btn'); if (!b || b.hidden) return false; b.click();
      var cards = document.querySelectorAll('#video-grid .video-card .video-title'); if (cards[0]) cards[0].click(); if (cards[2]) cards[2].click(); return true; })()`);
    await sleep(400);
    if (!entered) console.log(JSON.stringify({ note: 'enterSelect: the Select tool was absent or hidden', btn: await ev(`(function () { var b = document.getElementById('select-mode-btn'); return b ? { hidden: b.hidden, inViewRoot: !!b.closest('#view-root') } : null; })()`),
      servedMainHasBar: await ev("fetch('/js/main.js', { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) { return t.indexOf('select-bar__verbs') !== -1 && t.indexOf('selectBtn.hidden = currentItems.length === 0') !== -1; })"),
      initRan: await ev('typeof window.__filetubeRefreshLibrary'), gridClass: await ev("document.getElementById('video-grid').className"), sw: await ev('!!(navigator.serviceWorker && navigator.serviceWorker.controller)'),
      realCards: await ev("document.querySelectorAll('#video-grid .video-card[data-id]').length"), skeletonCards: await ev("document.querySelectorAll('#video-grid .skeleton-card').length") }));
    return entered;
  };
  // The last row must stay reachable: scrolled to the very end, the LAST card's bottom edge must sit
  // above the bar's top edge (gate r1 qa W3: the clearance under the grid follows the dock lift).
  const END = `(function () { window.scrollTo(0, document.documentElement.scrollHeight); return new Promise(function (res) { setTimeout(function () {
    var cards = document.querySelectorAll('#video-grid .video-card[data-id]'); var last = cards[cards.length - 1]; var bar = document.querySelector('.select-bar:not([hidden])');
    var lr = last ? last.getBoundingClientRect() : null; var br = bar ? bar.getBoundingClientRect() : null;
    res({ lastCardBottom: lr ? Math.round(lr.bottom) : null, barTop: br ? Math.round(br.top) : null, scrollY: Math.round(window.scrollY), lastRowClear: !(lr && br) || lr.bottom <= br.top });
  }, 250); }); })()`;
  const measure = async (cell, withDock) => {
    const m = await ev(MEASURE);
    const name = `${cell.name}${withDock ? '-dock' : ''}`;
    await shoot(name);
    const end = await ev(END);
    await shoot(name + '-end');
    await ev('window.scrollTo(0, 0); true');
    const treeHasBar = fs.existsSync(path.join(ROOT, 'public', 'js', 'main.js')) && /select-bar__verbs/.test(fs.readFileSync(path.join(ROOT, 'public', 'js', 'main.js'), 'utf8'));
    const overflow = m.scrollWidth > m.innerWidth;
    const fail = overflow || m.overlapNav > 0 || m.overlapDock > 0 || m.barBelowViewport > 0 || (treeHasBar && !m.bar) || (withDock && !m.dock) || (treeHasBar && !end.lastRowClear);
    cells += 1; if (fail) bad += 1;
    console.log(JSON.stringify(Object.assign({ cell: name, tree: treeHasBar ? 'bar' : 'no-bar', ok: !fail, overflow }, m, { end })));
  };
  for (const cell of CELLS) {
    if (cell.mobile) {
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else {
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', platform: 'Linux x86_64' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
    await send('Emulation.setDeviceMetricsOverride', { width: cell.width, height: cell.height, deviceScaleFactor: 1, mobile: cell.mobile });
    // 1. the grid, no dock
    await send('Page.navigate', { url: base + '/?browse=1' });
    // the REAL cards (data-id), not the eight skeleton cards the grid seeds before its fetch lands
    const ready = await waitFor('document.readyState === "complete" && document.querySelectorAll("#video-grid .video-card[data-id]").length >= 8', 30000);
    if (!ready) console.log(JSON.stringify({ cell: cell.name, note: 'the real cards never rendered', skeleton: await ev('document.querySelectorAll("#video-grid .skeleton-card").length') }));
    await sleep(300);
    await enterSelect();
    await measure(cell, false);
    // 2. the dock: play on the watch page, come back to the grid (the player docks), select again
    await send('Page.navigate', { url: base + '/watch.html?v=v1' });
    await waitFor('document.readyState === "complete" && !!document.getElementById("media-player")', 20000);
    await ev('(function(){ var v = document.getElementById("media-player"); try { v.play(); } catch (_) {} return true; })()');
    await sleep(800);
    await ev('window.FileTube.navigate("/?browse=1"); true');
    await waitFor('document.querySelectorAll("#video-grid .video-card[data-id]").length >= 8 && document.documentElement.classList.contains("has-player-dock")', 30000);
    await sleep(400);
    await enterSelect();
    await measure(cell, true);
    await ev('(function(){ try { window.FileTube.player.close(); } catch (_) {} return true; })()');
    await sleep(200);
  }
  console.log(`SUMMARY cells=${cells} ${bad === 0 ? 'ok' : 'FAIL'}`);
  if (bad !== 0) process.exitCode = 1;
  cleanup();
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
