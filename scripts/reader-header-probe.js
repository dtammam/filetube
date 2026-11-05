'use strict';

// reader-header-probe - v1.402.1 W2. Boots this tree on a scratch DATA_DIR with one seeded book,
// mints a session, opens /books, clicks the book (an in-app navigation into the reader) and records
// the shell header, logo, search and reader chassis rects against the window height.
//   node scripts/reader-header-probe.js [FT_ROOT=<tree>]
// Cases: 1440x900 desktop, 390x844 mobile emulation, 844x390 mobile emulation with html.is-phone
// (the iOS host sets that class; nothing in this repo does, so the probe adds it pre-paint).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = process.env.FT_ROOT ? path.resolve(process.env.FT_ROOT) : path.join(__dirname, '..');
const DEBUG_PORT = 9333 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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


const CASES = [
  { name: 'desktop 1440x900', w: 1440, h: 900, mobile: false, phone: false },
  { name: 'phone 390x844', w: 390, h: 844, mobile: true, phone: false },
  { name: 'phone sideways 844x390 is-phone', w: 844, h: 390, mobile: true, phone: true },
];

const MEASURE = `(function () {
  var r = function (el) { if (!el) return null; var b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  var de = document.documentElement;
  return JSON.stringify({
    path: location.pathname, immersive: de.classList.contains('reader-immersive'), isPhone: de.classList.contains('is-phone'),
    header: r(document.querySelector('header')), headerDisplay: getComputedStyle(document.querySelector('header')).display,
    logo: r(document.querySelector('header .logo, header .header-left a, header .header-left')), search: r(document.querySelector('#search-input')),
    sidebar: r(document.querySelector('.sidebar, #sidebar')), chassis: r(document.getElementById('reader-chassis')),
    chassisBottom: (function () { var c = document.getElementById('reader-chassis'); return c ? Math.round(c.getBoundingClientRect().bottom) : null; })(),
    readerH: (function () { var c = document.getElementById('reader-chassis'); return c ? c.style.getPropertyValue('--reader-h') : null; })(),
    innerHeight: innerHeight, scrollHeight: de.scrollHeight, pageScrolls: de.scrollHeight > innerHeight, bodyScrollH: document.body.scrollHeight, scrollY: scrollY
  });
})()`;

async function main() {
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary>)');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-reader-header-'));
  const s = require(path.join(ROOT, 'server'));
  const { app, __mintTestSession, getMediaId } = s;
  const server = await new Promise((resolve) => { const sv = app.listen(0, '127.0.0.1', () => resolve(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cookie } = __mintTestSession();
  const [cname, cvalue] = cookie.split(';')[0].split('=');
  const booksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-reader-header-books-'));
  const fp = path.join(booksRoot, 'Probe Book.pdf');
  fs.writeFileSync(fp, '%PDF-1.4');
  const id = getMediaId(fp);
  s.booksDb.replaceAll({ folders: [booksRoot], items: { [id]: { id, title: 'Probe Book', author: 'Probe', format: 'pdf', filePath: fp,
    folderName: path.basename(booksRoot), rootFolder: booksRoot, size: 8, addedAt: Date.now(), hasCover: false, pageCount: 10 } }, progress: {}, pins: [], settings: {}, audio: {} });

  let chrome = null; let profile = null;
  const killChrome = () => { try { if (chrome) chrome.kill('SIGKILL'); } catch (_) { /* gone */ } chrome = null; };
  process.on('exit', () => { killChrome(); server.close(); });
  async function launch() {
    killChrome();
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-home-fouc-chrome-'));
    chrome = spawn(chromeBin, [
      '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-sandbox', '--disable-dev-shm-usage',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
      ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(' ').filter(Boolean) : []), 'about:blank',
    ], { stdio: 'ignore' });
    let list = null;
    for (let i = 0; i < 60 && !list; i++) {
      await sleep(250);
      try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json(); if (l.find((t) => t.type === 'page')) list = l; } catch (_) { /* not up */ }
    }
    if (!list) throw new Error('Chromium never exposed its debug endpoint');
    const target = list.find((t) => t.type === 'page');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params) => new Promise((resolve, reject) => {
      const i = ++id;
      const t = setTimeout(() => { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)); }, 60000);
      pending.set(i, (m) => { clearTimeout(t); if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result); });
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    return { ws, send };
  }


  const results = [];
  for (const c of CASES) {
    const cdp = await launch();
    const { send } = cdp;
    const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('evaluate: ' + JSON.stringify(r.exceptionDetails)); return r.result.value; };
    const waitFor = async (expression, label) => { const end = Date.now() + 20000; while (Date.now() < end) { try { if (await ev(expression)) return true; } catch (_) { /* navigating */ } await sleep(100); } console.error('WARNING [' + c.name + ']: timed out waiting for ' + label); return false; };
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setCookie', { name: cname, value: cvalue, url: base });
    await send('Emulation.setDeviceMetricsOverride', { width: c.w, height: c.h, deviceScaleFactor: c.mobile ? 3 : 1, mobile: c.mobile });
    if (c.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    if (c.phone) await send('Page.addScriptToEvaluateOnNewDocument', { source: "document.documentElement.classList.add('is-phone')" });
    await send('Page.navigate', { url: base + '/books' });
    await waitFor("!!document.querySelector('#books-grid a.book-title')", 'book card');
    await sleep(500);
    const before = JSON.parse(await ev(MEASURE));
    await ev("(function () { document.querySelector('#books-grid a.book-title').click(); return true; })()");
    await waitFor("location.pathname === '/read.html' && !!document.getElementById('reader-chassis')", 'reader');
    await sleep(1500);
    const after = JSON.parse(await ev(MEASURE));
    // direct load too (the FOUC script path)
    await send('Page.navigate', { url: base + '/read.html?b=' + encodeURIComponent(id) });
    await waitFor("!!document.getElementById('reader-chassis')", 'reader (direct)');
    await sleep(1500);
    const direct = JSON.parse(await ev(MEASURE));
    results.push({ case: c.name, books: before, readerSpa: after, readerDirect: direct });
    cdp.ws.close();
  }
  console.log(JSON.stringify(results, null, 2));
  killChrome();
}

main().then(() => process.exit(0), (err) => { console.error(err && err.stack ? err.stack : err); process.exit(1); });
