'use strict';
// glass-pill-probe - the headless instrument for the v1.405.0 glass tab pill (plan docs/exec-plans/active/2026-11-08-glass-tab-pill.md,
// W1: R1, R2, R4, R5). The CDP pattern of scripts/live-dock-probe.js: boot the real app on a scratch DATA_DIR (a few library rows so the
// home grid has content to scroll under the pill), emulate an iPhone (touch, mobile, reduced motion), then per look x mode x width:
// load the home page and MEASURE the bottom bar - its box, every item's box, the computed styles that make up its paint, the resolved
// --mobile-bottom-nav-h and the dock's `bottom` - and on Modern shoot a crop of the pill over scrolled content.
//
//   node scripts/glass-pill-probe.js <out-dir>            writes <out-dir>/measure.json and the crops (<look>-<mode>-<w>.png)
//   node scripts/glass-pill-probe.js --compare <a.json> <b.json>
//     R5: every non-Modern phone run and every desktop run must be identical between a (base) and b (branch); prints the diffs.
//     SUMMARY compared=<n> differ=<n> ok|FAIL (exit 1 on a difference)
//   Env: FT_ROOT=<tree> (default: this tree), CHROME=<binary>, FT_PILL_FULL=1 (R4: opt every roster item in, the maximum bar).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ROOT = process.env.FT_ROOT ? path.resolve(process.env.FT_ROOT) : path.join(__dirname, '..');
const DEBUG_PORT = 9800 + Math.floor(Math.random() * 400);

const LOOKS = ['2021', '2005', '2009', '2014'];
const MODES = ['light', 'dark'];
const PHONE_WIDTHS = [390, 375, 320];
const DESKTOP_WIDTH = 1024;
// The computed properties that make up the bar's paint and box (R5 compares them, base vs branch).
const NAV_PROPS = ['display', 'overflow-x', 'overflow-y', 'position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'background-color', 'background-image', 'border-top-width', 'border-top-color', 'border-radius', 'box-shadow', 'backdrop-filter', 'z-index', 'visibility',
  'justify-content', 'align-items'];
const ITEM_PROPS = ['display', 'width', 'height', 'padding-top', 'padding-bottom', 'color', 'background-color', 'border-radius', 'flex-grow', 'min-width'];
const LABEL_PROPS = ['display', 'position', 'width', 'height', 'clip-path', 'font-size', 'color'];

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

// In the page: the bar, its items and labels, the resolved offset var, the dock. Plain ES5 (no regex: a regex in a CDP template loses
// its backslashes - the box's own lesson).
const MEASURE = (navProps, itemProps, labelProps) => `(function () {
  function pick(el, props) { var cs = getComputedStyle(el), o = {}; props.forEach(function (p) { o[p] = cs.getPropertyValue(p); }); return o; }
  function box(el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; }
  var nav = document.getElementById('bottom-nav');
  var probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:var(--mobile-bottom-nav-h, 0px)';
  document.body.appendChild(probe);
  var offset = probe.getBoundingClientRect().height;
  probe.remove();
  var dock = document.getElementById('player-dock');
  var items = nav ? Array.prototype.slice.call(nav.querySelectorAll('.bottom-nav-item')).filter(function (el) { return !el.hidden; }) : [];
  return {
    viewport: { w: innerWidth, h: innerHeight },
    offsetPx: offset,
    dockBottom: dock ? getComputedStyle(dock).bottom : null,
    mainPaddingBottom: (function () { var m = document.querySelector('.main-content'); return m ? getComputedStyle(m).paddingBottom : null; })(),
    nav: nav ? { box: box(nav), scrollW: nav.scrollWidth, clientW: nav.clientWidth, css: pick(nav, ${JSON.stringify(navProps)}) } : null,
    items: items.map(function (el) {
      var lab = el.querySelector('.bottom-nav-label');
      return { id: el.getAttribute('data-nav'), active: el.classList.contains('active'), box: box(el), css: pick(el, ${JSON.stringify(itemProps)}),
        label: lab ? { text: lab.textContent, css: pick(lab, ${JSON.stringify(labelProps)}) } : null,
        name: el.getAttribute('aria-label') || (lab ? lab.textContent : '') };
    }),
  };
})()`;

async function measureTree(OUT) {
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary>)');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-gpp-probe-'));
  const { app, __mintTestSession } = require(path.join(ROOT, 'server'));
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-gpp-probe-lib-'));
  fs.mkdirSync(path.join(lib, 'clips'), { recursive: true });
  const meta = {};
  for (let i = 1; i <= 24; i++) {
    const id = 'v' + i;
    const fp = path.join(lib, 'clips', id + '.mp4');
    fs.writeFileSync(fp, '');
    meta[id] = { id, type: 'video', title: 'Glass pill probe row ' + i, name: id + '.mp4', filePath: fp, rootFolder: lib, folderName: 'clips',
      channelName: 'Probe', duration: 60 + i, width: 1920, height: 1080, hasThumbnail: false, ext: '.mp4', addedAt: 1788000000000 - i * 1000 };
  }
  // a configured folder (its own table: the test seed helper writes it), or the home page shows the welcome box instead of the grid
  const { seedState } = require(path.join(ROOT, 'test', 'helpers', 'seed-state'));
  seedState({ folders: [lib], folderSettings: {}, metadata: meta, liked: [], settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  fs.mkdirSync(OUT, { recursive: true });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cookie } = __mintTestSession();
  const [cname, cvalue] = cookie.split(';')[0].split('=');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-gpp-probe-chrome-'));
  const chrome = spawn(chromeBin, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-sandbox', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--font-render-hinting=none',
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
  const full = process.env.FT_PILL_FULL === '1';
  const runs = [];
  const cases = [];
  for (const look of LOOKS) for (const mode of MODES) {
    for (const w of PHONE_WIDTHS) cases.push({ look, mode, w, phone: true });
    cases.push({ look, mode, w: DESKTOP_WIDTH, phone: false });
  }
  for (const c of cases) {
    await send('Emulation.setDeviceMetricsOverride', c.phone ? { width: c.w, height: 844, deviceScaleFactor: 1, mobile: true } : { width: c.w, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: base + '/' });
    await waitFor('document.readyState === "complete"');
    // the FOUC guard reads these before first paint; the full-roster config (R4) opts every roster id in
    await ev(`(function () { localStorage.setItem('ft-era', '${c.look}'); localStorage.setItem('ft-mode', '${c.mode}');
      ${full ? "localStorage.setItem('ft-bottomnav', JSON.stringify({ hidden: [], order: [], shown: window.FileTube.BOTTOM_NAV_OPTIONAL.slice() }));" : "localStorage.removeItem('ft-bottomnav');"}
      return true; })()`);
    await send('Page.navigate', { url: base + '/' });
    await waitFor('document.readyState === "complete" && !!document.getElementById("bottom-nav") && document.documentElement.getAttribute("data-theme") === "' + c.look + '"');
    await sleep(600); // the async nav injectors (Download, Subs, You) land and re-apply the layout
    if (full) {
      // R4's maximum: a roster id this server does not inject (the optional downloader off) is added as its real markup, so the bar
      // holds the WHOLE roster (+ You) exactly as a downloader-on server with everything opted in would draw it
      await ev(`(function () { var nav = document.getElementById('bottom-nav'); var tpl = nav.querySelector('[data-nav="history"]');
        ['oneoff-download', 'subscriptions'].forEach(function (id) { if (nav.querySelector('[data-nav="' + id + '"]')) return;
          var el = tpl.cloneNode(true); el.setAttribute('data-nav', id); el.classList.remove('active'); el.querySelector('.bottom-nav-label').textContent = id; nav.appendChild(el); });
        window.FileTube.applyBottomNavCustomization(); return true; })()`);
      await sleep(100);
    }
    const m = await ev(MEASURE(NAV_PROPS, ITEM_PROPS, LABEL_PROPS));
    const key = `${c.look}-${c.mode}-${c.w}${full ? '-full' : ''}`;
    runs.push({ key, look: c.look, mode: c.mode, w: c.w, phone: c.phone, full, m });
    if (c.phone && c.look === '2021' && m.nav && m.nav.box.h > 0) {
      const scrollY = await ev('window.scrollTo(0, 400); window.scrollY');
      await sleep(250);
      const pad = 24;
      const y = Math.max(0, m.nav.box.y - 220); // viewport px; the clip below is in PAGE px, hence + scrollY
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: y + scrollY, width: c.w, height: Math.min(844 - y, m.nav.box.h + 220 + pad), scale: 2 } });
      fs.writeFileSync(path.join(OUT, key + '.png'), Buffer.from(shot.data, 'base64'));
    }
  }
  fs.writeFileSync(path.join(OUT, 'measure' + (full ? '-full' : '') + '.json'), JSON.stringify(runs, null, 1));
  // R4: per phone width on Modern, the item count, the narrowest item vs the 44px hit target, and whether the row scrolls (Dean's ruling)
  for (const r of runs.filter((x) => x.phone && x.look === '2021' && x.mode === 'light')) {
    const ws = r.m.items.map((i) => i.box.w);
    console.log(`R4 ${r.key}: items=${r.m.items.length} [${r.m.items.map((i) => i.id).join(',')}] narrowest=${Math.min.apply(null, ws)}px pill=${r.m.nav.box.w}x${r.m.nav.box.h} offset=${r.m.offsetPx}px fits44=${ws.every((x) => x >= 44)} scroll=${r.m.nav.scrollW}/${r.m.nav.clientW} scrolls=${r.m.nav.scrollW > r.m.nav.clientW}`);
  }
  console.log(`SUMMARY runs=${runs.length} shots=${fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length} ok`);
  process.exit(0);
}

function compare(aPath, bPath) {
  const a = JSON.parse(fs.readFileSync(aPath, 'utf8'));
  const b = JSON.parse(fs.readFileSync(bPath, 'utf8'));
  const byKey = new Map(b.map((r) => [r.key, r]));
  let compared = 0; let differ = 0;
  for (const ra of a) {
    if (ra.phone && ra.look === '2021') continue; // Modern on a phone is the intended change
    const rb = byKey.get(ra.key);
    if (!rb) { console.log(`MISSING ${ra.key}`); differ++; continue; }
    compared++;
    const sa = JSON.stringify(ra.m); const sb = JSON.stringify(rb.m);
    if (sa !== sb) {
      differ++;
      console.log(`DIFF ${ra.key}`);
      const fa = flat(ra.m); const fb = flat(rb.m);
      for (const k of new Set(Object.keys(fa).concat(Object.keys(fb)))) if (fa[k] !== fb[k]) console.log(`  ${k}: ${fa[k]} -> ${fb[k]}`);
    }
  }
  console.log(`SUMMARY compared=${compared} differ=${differ} ${differ ? 'FAIL' : 'ok'}`);
  process.exit(differ ? 1 : 0);
}
function flat(o, p, out) {
  out = out || {};
  if (o && typeof o === 'object') { for (const k of Object.keys(o)) flat(o[k], (p ? p + '.' : '') + k, out); } else out[p] = String(o);
  return out;
}

if (process.argv[2] === '--compare') compare(process.argv[3], process.argv[4]);
else {
  if (!process.argv[2]) { console.error('usage: node scripts/glass-pill-probe.js <out-dir> | --compare <a.json> <b.json>'); process.exit(2); }
  measureTree(process.argv[2]).catch((e) => { console.error(e && e.stack || e); process.exit(1); });
}
