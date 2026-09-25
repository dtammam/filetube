'use strict';

// skin-chips-probe - the button-measurement instrument for the SKIN PICKERS (the action-row norm:
// rows wrap, buttons never shrink - docs/CONTRIBUTING.md). v1.332 took the registry from 5 skins
// to 12; this measures every surface that lists them, BEFORE (FT_ROOT=<a worktree>) and after:
//   - Settings > Music player skin: every .theme-card (x/y/w/h), the rows, the container;
//   - the sticker menu's Skin chips on the phone skin: every .mms-sm-chip, the rows, and the menu's
//     own fit (its height against the viewport and its scroll height - a menu that must scroll);
//   - the desktop pop-out's Nano tray Color chips (the plain-window fallback, a real CDP click).
// v1.333 (plan 2026-09-25-pocket-lighting-ambient, AC7): the sticker menu per sticker size (default / 2x /
// 3x) and per inset set (none, and an iPhone's 47 top / 34 bottom via Emulation.setSafeAreaInsetsOverride):
// page 1's chips (Speed, and Lighting where offered), whether page 1 FITS (no scroll), where its TOP lands
// against the top inset (below 0 = rows out of reach, Dean's "can't scroll"), a REAL finger pan
// (Input.dispatchTouchEvent) when it does scroll, and the Skin page's chips (on a tree with one). A tree
// without the Skin page (a BEFORE run) reports its inline chips on page 1.
// Prints ONE JSON line per (surface, viewport). Diff two runs: a pre-existing button whose w/h
// changed is a deformation; a y change is a wrap.
//   node scripts/skin-chips-probe.js [WxH ...]      (default 390x844 375x667 380x700 1280x800)

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = process.env.FT_ROOT ? path.resolve(process.env.FT_ROOT) : path.join(__dirname, '..');
const VPS = (process.argv.slice(2).length ? process.argv.slice(2) : ['390x844', '375x667', '380x700', '1280x800']).map((s) => { const [w, h] = s.split('x').map(Number); return { w, h }; });
const DEBUG_PORT = 9333 + Math.floor(Math.random() * 400);

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
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(20 * Math.sin(i / 8));
  return b;
}
const GEOM = (sel, menuSel) => `(function () {
  var r = function (el) { var b = el.getBoundingClientRect(); return [Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10]; };
  var els = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(sel)}));
  var rows = {}; els.forEach(function (e) { rows[Math.round(e.getBoundingClientRect().y)] = 1; });
  var m = ${menuSel ? `document.querySelector(${JSON.stringify(menuSel)})` : 'null'};
  return { n: els.length, rows: Object.keys(rows).length, items: els.map(function (e) { return { id: e.getAttribute('data-skin-pref') || e.getAttribute('data-skin-pick') || e.getAttribute('data-skin-lighting') || e.getAttribute('data-skin-speed'), xywh: r(e) }; }),
    menu: m ? { xywh: r(m), scrollH: m.scrollHeight, clientH: m.clientHeight, scrolls: m.scrollHeight > m.clientHeight + 1 } : null,
    vw: innerWidth, vh: innerHeight, docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
})()`;

async function main() {
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-chips-probe-'));
  const { app, updateDatabase, __mintTestSession } = require(path.join(ROOT, 'server'));
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-chips-probe-lib-'));
  const fp = path.join(lib, 'tonzak', 'nd1.wav'); fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, wav(30));
  await updateDatabase((db) => { db.metadata = { nd1: { id: 'nd1', type: 'audio', title: 'Neon Arrival', name: 'nd1.wav', filePath: fp, rootFolder: lib, folderName: 'tonzak', channelName: 'Tonzak', duration: 30, hasThumbnail: false, ext: '.wav', addedAt: 1788000000000, tags: { artist: 'Tonzak', title: 'Neon Arrival', album: 'Night Drive' } } }; return true; });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cookie } = __mintTestSession();
  const [cname, cvalue] = cookie.split(';')[0].split('=');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-chips-probe-chrome-'));
  const chrome = spawn(chromeBin, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-sandbox', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (_) { /* gone */ } server.close(); };
  process.on('exit', cleanup);
  let list = null;
  for (let i = 0; i < 40 && !list; i++) { await new Promise((r) => setTimeout(r, 250)); try { list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json(); } catch (_) { /* not up */ } }
  const connect = async (url) => {
    const ws = new WebSocket(url); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let mid = 0; const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params) => new Promise((resolve, reject) => { const i = ++mid; pending.set(i, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result))); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.value; };
    return { ws, send, ev };
  };
  const { ws, send, ev } = await connect(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await send('Network.enable'); await send('Page.enable');
  await send('Network.setCookie', { name: cname, value: cvalue, url: base });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expr, ms) => { const end = Date.now() + (ms || 15000); while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100); } return false; };
  const out = (o) => console.log(JSON.stringify(o));
  for (const vp of VPS) {
    const mobile = vp.w <= 768;
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile });
    await send('Page.navigate', { url: base + '/setup.html' });
    await waitFor(`document.querySelectorAll('#music-skin-picker .theme-card').length > 0`, 15000);
    // on a phone the sections are a menu: open Appearance (the picker's section) before measuring
    await ev(`(function(){ var d = document.querySelector('details[data-collapse-key="appearance"]'); if (!d) return false;
      var row = Array.prototype.slice.call(document.querySelectorAll('button, a, [role="button"]')).find(function (x) { return (x.textContent || '').trim().indexOf('Appearance') === 0 || x.getAttribute('data-md-key') === 'appearance'; });
      if (row && !d.getBoundingClientRect().height) row.click(); d.open = true; return true; })()`);
    await sleep(900);
    out(Object.assign({ surface: 'settings-picker', vp: vp.w + 'x' + vp.h }, await ev(GEOM('#music-skin-picker .theme-card'))));
    if (!mobile) continue;
    const MENU = '#music-nowplaying-panel [data-skin-sticker-menu]';
    for (const size of ['default', '2x', '3x']) {
      for (const insets of [{ top: 0, bottom: 0 }, { top: 47, bottom: 34 }]) {
        let insetOk = true;
        try { await send('Emulation.setSafeAreaInsetsOverride', { insets: Object.assign({ left: 0, right: 0 }, insets) }); } catch (_) { insetOk = !insets.top; }
        if (!insetOk) continue; // this Chromium has no inset override: the zero-inset run stands alone
        await ev(`localStorage.setItem('ft-music-skin', 'ipod'); localStorage.removeItem('ft-tray-mode'); localStorage.setItem('ft-sticker', JSON.stringify({ kind: 'logo', size: ${JSON.stringify(size)}, tilt: 'left' })); true`);
        await send('Page.navigate', { url: base + '/music?play=nd1' });
        await waitFor(`!!document.querySelector('#music-nowplaying-panel.mms-full [data-skin-sticker]')`, 20000);
        await sleep(600);
        await ev(`document.querySelector('#music-nowplaying-panel [data-skin-sticker]').click(); true`);
        await sleep(400);
        const tag = { vp: vp.w + 'x' + vp.h, sticker: size, insets: insets.top + '/' + insets.bottom };
        const g1 = await ev(GEOM(MENU + ' .mms-sm-chip, ' + MENU + ' .mms-sm-opt', MENU));
        g1.menu.top = g1.menu.xywh[1];
        g1.menu.topInReach = g1.menu.top >= insets.top - 0.5;   // the first row is on screen, below the notch
        g1.menu.fits = !g1.menu.scrolls;
        g1.sections = await ev(`Array.prototype.map.call(document.querySelectorAll(${JSON.stringify(MENU + ' > .mms-sm-sec')}), function (x) { return [(x.textContent || '').trim().slice(0, 14), Math.round(x.getBoundingClientRect().height)]; })`);
        if (g1.menu.scrolls) {
          // a REAL finger pan up inside the menu (the lower third to the upper third): the menu must scroll
          const b = g1.menu.xywh; const x = b[0] + b[2] / 2; const y0 = b[1] + b[3] * 0.75; const y1 = b[1] + b[3] * 0.25;
          await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] });
          for (let i = 1; i <= 12; i++) { await sleep(16); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / 12, id: 1 }] }); }
          await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await sleep(500);
          g1.menu.panScrollTop = await ev(`Math.round(document.querySelector(${JSON.stringify(MENU)}).scrollTop)`);
          g1.menu.maxScrollTop = g1.menu.scrollH - g1.menu.clientH;
        }
        out(Object.assign({ surface: 'sticker-page1' }, tag, g1));
        if (await ev(`!!document.querySelector(${JSON.stringify(MENU + ' [data-skin-skins]')})`)) {
          await ev(`document.querySelector(${JSON.stringify(MENU + ' [data-skin-skins]')}).click(); true`);
          await sleep(300);
          const g2 = await ev(GEOM(MENU + ' .mms-sm-chip', MENU));
          g2.menu.top = g2.menu.xywh[1]; g2.menu.topInReach = g2.menu.top >= insets.top - 0.5; g2.menu.fits = !g2.menu.scrolls;
          out(Object.assign({ surface: 'sticker-skin-page' }, tag, g2));
        }
      }
    }
    try { await send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 0, left: 0, right: 0 } }); } catch (_) { /* none to clear */ }
  }
  // the Nano tray's Color chips (desktop pop-out, plain-window fallback)
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base + '/music' }); await sleep(700);
  await ev(`localStorage.setItem('ft-music-skin', 'ipod'); localStorage.setItem('ft-tray-mode', '1'); true`);
  await send('Page.navigate', { url: base + '/music?play=nd1' });
  await waitFor(`!!(window.FileTube && FileTube.player && FileTube.player.currentId) && !document.getElementById('music-popout-btn').hidden`, 20000);
  await ev(`Object.defineProperty(window, 'documentPictureInPicture', { value: undefined, configurable: true }); true`);
  const box = await ev(`(function(){ var r = document.getElementById('music-popout-btn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const before = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).map((t) => t.id);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(1500);
  const pop = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).find((t) => t.type === 'page' && !before.includes(t.id));
  if (pop) {
    const P = await connect(pop.webSocketDebuggerUrl);
    await P.ev(`document.querySelector('#music-nowplaying-panel [data-skin-sticker]').click(); true`);
    await sleep(500);
    out(Object.assign({ surface: 'tray-chips', vp: await P.ev('innerWidth + "x" + innerHeight') }, await P.ev(GEOM('#music-nowplaying-panel .mms-sm-chip', '#music-nowplaying-panel [data-skin-sticker-menu]'))));
    P.ws.close();
  } else out({ surface: 'tray-chips', error: 'no pop-out opened' });
  ws.close();
  cleanup();
}
main().then(() => process.exit(0), (e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
