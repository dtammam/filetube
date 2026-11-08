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
//   Env: FT_ROOT=<tree> (default: this tree), CHROME=<binary>, FT_PILL_FULL=1 (R4: opt every roster item in, the maximum bar),
//        FT_PILL_SWEEP=1 (W2: the R6 surface sweep + a real-touch R3 long press; SUMMARY checks=<n> failed=<n>, exit 1 on a failure),
//        FT_PILL_NATIVE=1 (W3: a fake host announcing nativeTabBar, and one not announcing it; SUMMARY native-checks=<n> failed=<n>).
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
  if (process.env.FT_PILL_SWEEP === '1') return sweep({ send, ev, waitFor, sleep, base });
  if (process.env.FT_PILL_NATIVE === '1') return nativeChecks({ send, ev, waitFor, sleep, base });
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

// W2 (R3 + R6): the sweep. Per look (Modern and Original as the control) at 390x844: does every surface that cleared or covered
// the bar still do so - the reader's reserve, the last row, a toast, the downloads chip, the dock, the Playlists sheet, faux
// fullscreen, the Feed, landscape - and does a REAL touch held on an item show the name without navigating (R3, reachability in
// the browser, not jsdom). Each check prints CHECK <look> <name> ok|FAIL <detail>.
async function sweep({ send, ev, waitFor, sleep, base }) {
  const checks = [];
  const check = (look, name, ok, detail) => { checks.push({ look, name, ok }); console.log(`CHECK ${look} ${name} ${ok ? 'ok' : 'FAIL'} ${detail}`); };
  const load = async (look, url) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: base + '/' });
    await waitFor('document.readyState === "complete"');
    await ev(`localStorage.setItem('ft-era', '${look}'); localStorage.setItem('ft-mode', 'light'); localStorage.removeItem('ft-bottomnav'); true`);
    await send('Page.navigate', { url: base + url });
    await waitFor('document.readyState === "complete" && !!document.getElementById("bottom-nav")');
    await sleep(700);
  };
  const NAVTOP = 'document.getElementById("bottom-nav").getBoundingClientRect().top';
  const touch = async (type, x, y) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  for (const look of ['2021', '2005']) {
    await load(look, '/');
    // 1. the reserve a JS-sized surface (the reader) keeps clear: at least the bar's distance from the viewport bottom
    const r1 = await ev(`(function () { var nav = document.getElementById('bottom-nav'); var used = innerHeight - nav.getBoundingClientRect().top;
      var res = window.FileTube.bottomNavReservePx ? window.FileTube.bottomNavReservePx() : nav.offsetHeight; return { used: used, res: res }; })()`);
    check(look, 'reader-reserve', r1.res >= r1.used - 0.5, `reserve=${r1.res} bar-takes=${r1.used}`);
    // 2. the last row of a long list scrolls clear of the bar
    const r2 = await ev(`(function () { window.scrollTo(0, document.documentElement.scrollHeight); var cards = document.querySelectorAll('#video-grid > *');
      var last = cards[cards.length - 1]; return last ? { b: last.getBoundingClientRect().bottom, top: ${NAVTOP}, n: cards.length } : null; })()`);
    await sleep(200);
    const r2b = await ev(`(function () { var cards = document.querySelectorAll('#video-grid > *'); var last = cards[cards.length - 1];
      return { b: last.getBoundingClientRect().bottom, top: ${NAVTOP}, n: cards.length }; })()`);
    check(look, 'last-row', !!r2 && r2b.b <= r2b.top + 0.5, `rows=${r2b.n} last-bottom=${r2b.b} bar-top=${r2b.top}`);
    // 3. a toast sits above the bar
    await ev('window.ui.toast("Probe toast"); true');
    await sleep(300);
    const r3 = await ev(`(function () { var h = document.querySelector('.ui-toast-host'); var t = h && h.lastElementChild; return t ? { b: t.getBoundingClientRect().bottom, top: ${NAVTOP} } : null; })()`);
    check(look, 'toast', !!r3 && r3.b <= r3.top + 0.5, JSON.stringify(r3));
    // 4. the downloads chip (left) and 5. the dock (right) sit above the bar
    const r4 = await ev(`(function () { var c = document.getElementById('dl-status-chip'); var made = !c; if (!c) { c = document.createElement('div'); c.id = 'dl-status-chip'; c.textContent = 'chip'; document.body.appendChild(c); }
      var b = c.getBoundingClientRect().bottom; if (made) c.remove(); var dock = document.getElementById('player-dock');
      return { chip: b, top: ${NAVTOP}, dock: dock ? parseFloat(getComputedStyle(dock).bottom) : null, used: innerHeight - ${NAVTOP} }; })()`);
    check(look, 'chip', r4.chip <= r4.top + 0.5, `chip-bottom=${r4.chip} bar-top=${r4.top}`);
    check(look, 'dock', r4.dock !== null && r4.dock >= r4.used, `dock-bottom=${r4.dock}px bar-takes=${r4.used}px`);
    // 6. the Playlists sheet covers the bar
    await ev('document.getElementById("nav-playlists-btn").click(); true');
    await sleep(700);
    const r6 = await ev(`(function () { var nav = document.getElementById('bottom-nav'); var r = nav.getBoundingClientRect(); var el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { covered: !!el && !nav.contains(el), at: el ? (el.id || el.className || el.tagName) : null }; })()`);
    check(look, 'sheet-covers', r6.covered, `top-element=${r6.at}`);
    await load(look, '/');
    // 7. faux fullscreen hides the bar
    const r7 = await ev(`(function () { document.body.classList.add('ft-css-fullscreen'); var v = getComputedStyle(document.getElementById('bottom-nav')).visibility; document.body.classList.remove('ft-css-fullscreen'); return v; })()`);
    check(look, 'faux-fullscreen', r7 === 'hidden', `visibility=${r7}`);
    // 8. R3: a real touch held on History shows its name and the release does not navigate; a tap navigates
    const pt = await ev(`(function () { var el = document.querySelector('#bottom-nav [data-nav="history"]'); var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await touch('touchStart', pt.x, pt.y);
    await sleep(750);
    const tip = await ev('(function () { var t = document.querySelector(".bottom-nav-tip"); return t && !t.hidden ? t.textContent : null; })()');
    await touch('touchEnd');
    await sleep(500);
    const after = await ev('location.pathname');
    if (look === '2021') {
      check(look, 'long-press-name', tip === 'History', `tip=${JSON.stringify(tip)}`);
      check(look, 'long-press-no-nav', after === '/', `path-after-release=${after}`);
    } else {
      check(look, 'long-press-retro-no-tip', tip === null, `tip=${JSON.stringify(tip)}`);
    }
    if (look === '2021') {
      // the tip clears a showing mini player (the dock sits at the same height on the right; player.js's signal is
      // html.has-player-dock + --player-dock-h): fake the signal, hold the right-most item, compare against the dock's row
      await load(look, '/');
      const ptR = await ev(`(function () { document.documentElement.classList.add('has-player-dock'); document.documentElement.style.setProperty('--player-dock-h', '90px');
        var items = document.querySelectorAll('#bottom-nav .bottom-nav-item:not([hidden])'); var r = items[items.length - 1].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await touch('touchStart', ptR.x, ptR.y);
      await sleep(750);
      const rd = await ev(`(function () { var t = document.querySelector('.bottom-nav-tip'); var dock = document.getElementById('player-dock');
        var dockTop = innerHeight - parseFloat(getComputedStyle(dock).bottom) - 90; return t && !t.hidden ? { tipBottom: t.getBoundingClientRect().bottom, dockTop: dockTop } : null; })()`);
      await touch('touchEnd');
      check(look, 'tip-clears-dock', !!rd && rd.tipBottom <= rd.dockTop + 0.5, JSON.stringify(rd));
    }
    await load(look, '/');
    await touch('touchStart', pt.x, pt.y);
    await sleep(60);
    await touch('touchEnd');
    const navd = await waitFor('location.pathname === "/history"', 5000);
    check(look, 'tap-navigates', navd, `path=${await ev('location.pathname')}`);
    // 9. the Feed's card stack ends above the bar
    await load(look, '/feed');
    // (the stack's height is CSS-only: 100dvh - header - the ONE var; with no feed items it is not laid out, and the check says n/a, never ok)
    const r9 = await ev(`(function () { var s = document.querySelector('.feed-stack'); if (!s) return null; var r = s.getBoundingClientRect(); return { b: r.bottom, h: r.height, top: ${NAVTOP} }; })()`);
    if (!r9 || r9.h === 0) console.log(`CHECK ${look} feed n/a the stack is not laid out (no feed items in the probe library)`);
    else check(look, 'feed', r9.b <= r9.top + 0.5, `stack-bottom=${r9.b} bar-top=${r9.top}`);
    // 10. landscape hides the bar and the reserve is 0
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await sleep(400);
    const r10 = await ev(`(function () { var nav = document.getElementById('bottom-nav'); return { d: getComputedStyle(nav).display, res: window.FileTube.bottomNavReservePx ? window.FileTube.bottomNavReservePx() : 0 }; })()`);
    check(look, 'landscape', r10.d === 'none' && r10.res === 0, JSON.stringify(r10));
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`SUMMARY checks=${checks.length} failed=${failed} ${failed ? 'FAIL' : 'ok'}`);
  process.exit(failed ? 1 : 0);
}

// W3 (the Contract) in the real browser: a FAKE host injected before any page script (the app's document-start script), announcing
// nativeTabBar (and, as the control, not announcing it). Checks the real shells send nav.bar, hide the web pill, follow navTap /
// navBarMetrics, and flip visible for a sheet, the keyboard and a retro look. CHECK native-<n> ok|FAIL <detail>.
const FAKE_HOST = (cap) => `(function () {
  window.__posts = [];
  window.FileTubeHost = { bridge: 1, app: { name: 'filetube-ios', version: '0.18.0', build: '1' }, platform: 'ios',
    capabilities: ['orientation', 'haptics', 'battery', 'serverSettings', 'statusBar', 'network'${cap ? ", 'nativeTabBar'" : ''}],
    post: function (msg) { window.__posts.push(JSON.parse(JSON.stringify(msg))); } };
})()`;
async function nativeChecks({ send, ev, waitFor, sleep, base }) {
  const checks = [];
  const check = (name, ok, detail) => { checks.push(ok); console.log(`CHECK native-${name} ${ok ? 'ok' : 'FAIL'} ${detail}`); };
  const LAST = '(function () { var b = window.__posts.filter(function (m) { return m.type === "nav.bar"; }); return b.length ? b[b.length - 1] : null; })()';
  const COUNT = 'window.__posts.filter(function (m) { return m.type === "nav.bar"; }).length';
  const IDS = 'Array.prototype.filter.call(document.querySelectorAll("#bottom-nav .bottom-nav-item[data-nav]"), function (e) { return !e.hidden; }).map(function (e) { return e.getAttribute("data-nav"); })';
  const emit = (d) => ev(`window.dispatchEvent(new CustomEvent('filetube-host', { detail: ${JSON.stringify(Object.assign({ v: 1 }, d))} })); true`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }); // a headless page has no window focus: no focusin / focusout without this
  for (const cap of [true, false]) {
    const inj = await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_HOST(cap) });
    await send('Page.navigate', { url: base + '/' });
    await waitFor('document.readyState === "complete"');
    await ev("localStorage.setItem('ft-era', '2021'); localStorage.setItem('ft-mode', 'light'); localStorage.removeItem('ft-bottomnav'); true");
    await send('Page.navigate', { url: base + '/' });
    await waitFor('document.readyState === "complete" && !!document.getElementById("bottom-nav")');
    await sleep(900);
    if (!cap) {
      const n = await ev(COUNT); const hid = await ev('document.getElementById("bottom-nav").hidden');
      check('cap-off-silent', n === 0 && hid === false, `nav.bar=${n} web-pill-hidden=${hid}`);
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: inj.identifier });
      continue;
    }
    const m = await ev(LAST); const ids = await ev(IDS);
    check('first-payload', !!m && m.visible === true && JSON.stringify(m.items.map((i) => i.id)) === JSON.stringify(ids), `items=${m && m.items.map((i) => i.id + (i.active ? '*' : '')).join(',')} dom=${ids.join(',')} visible=${m && m.visible}`);
    check('web-pill-hidden', await ev('document.getElementById("bottom-nav").hidden === true && getComputedStyle(document.getElementById("bottom-nav")).display === "none"'), 'the web pill is [hidden] + display:none');
    const youImg = m && m.items.find((i) => i.id === 'you');
    check('you-item', !!youImg, `you=${JSON.stringify(youImg)}`);
    await emit({ type: 'navBarMetrics', height: 62 });
    await sleep(100);
    const off = await ev('(function () { var p = document.createElement("div"); p.className = "bottom-nav-reserve-probe"; document.body.appendChild(p); var h = p.getBoundingClientRect().height; p.remove(); return { h: h, attr: document.documentElement.hasAttribute("data-native-tab-bar"), dock: getComputedStyle(document.getElementById("player-dock")).bottom }; })()');
    check('metrics-offset', off.h === 62 && off.attr, JSON.stringify(off));
    const before = await ev(COUNT);
    await emit({ type: 'navTap', id: 'playlists' });
    await sleep(800);
    const ms = await ev(LAST);
    check('tap-opens-sheet-and-hides', ms.visible === false && await ev('!!document.querySelector(".ui-sheet.is-open") && document.getElementById("bottom-nav").hidden === false'), `visible=${ms.visible} sent=${(await ev(COUNT)) - before}`);
    await ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true');
    await sleep(900);
    check('sheet-closed-shows', (await ev(LAST)).visible === true && await ev('document.getElementById("bottom-nav").hidden === true'), `visible=${(await ev(LAST)).visible}`);
    await emit({ type: 'navTap', id: 'history' });
    const went = await waitFor('location.pathname === "/history"', 5000);
    await sleep(500);
    const mh = await ev(LAST);
    check('tap-navigates-and-selects', went && mh.items.filter((i) => i.active).map((i) => i.id).join() === 'history', `path=${await ev('location.pathname')} active=${mh.items.filter((i) => i.active).map((i) => i.id)}`);
    await ev('(function () { var i = document.createElement("input"); i.type = "search"; i.id = "probe-field"; document.getElementById("view-root").appendChild(i); i.focus(); return true; })()');
    await sleep(300);
    check('keyboard-hides', (await ev(LAST)).visible === false, `visible=${(await ev(LAST)).visible} focused=${await ev('document.activeElement && document.activeElement.id')} coveredBy=${await ev('typeof bottomNavCoveredBy === "function" ? bottomNavCoveredBy() : "n/a"')} sent=${await ev(COUNT)}`);
    await ev('document.getElementById("probe-field").blur(); true');
    await sleep(300);
    check('keyboard-gone-shows', (await ev(LAST)).visible === true, `visible=${(await ev(LAST)).visible}`);
    await ev("document.documentElement.setAttribute('data-theme', '2005'); true");
    await sleep(300);
    check('retro-hides', (await ev(LAST)).visible === false && await ev('document.getElementById("bottom-nav").hidden === false'), `visible=${(await ev(LAST)).visible}`);
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: inj.identifier });
  }
  const failed = checks.filter((c) => !c).length;
  console.log(`SUMMARY native-checks=${checks.length} failed=${failed} ${failed ? 'FAIL' : 'ok'}`);
  process.exit(failed ? 1 : 0);
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
