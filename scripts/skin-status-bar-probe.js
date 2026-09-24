'use strict';

// skin-status-bar-probe - the MEASUREMENT instrument for the pocket skins' LCD status bar
// (Dean 2026-09-24: "the song or album name might get too long and make that whole thing
// just a little bit too big. It'll expand it by a row."). The status bar (.ip-status) is
// shared by the Click trio and Seattle (music-skins.js ipScreen), by the desktop pop-out
// (the same panel in its own window) and by the Nano tray (the pop-out's tray body). Its
// title (.ip-np) reads "Now Playing", "Songs", the menu's name, or on a drilled level the
// artist / album / chaptered file's own NAME - the one that can be long.
//
// Boots the real app (this tree, or FT_ROOT=<other worktree> for a BEFORE baseline) on a
// scratch DATA_DIR with a small library: a short-named album, an album whose name is 120
// characters, and a chaptered file whose TITLE (the "song" name a chaptered album shows)
// is 120 characters, all by artists with short and long names. It drives headless
// Chromium over raw CDP (the action-row-probe.js pattern), REACHES each level through
// the real menus (MENU / Select / row taps), and prints ONE JSON line per (skin, viewport,
// level): the status bar's height, the title's rect and whether it is truncated, the
// play indicator and battery rects (they must never move or shrink), Seattle's drilled
// title line, and the document's scrollWidth. PNGs go to <out-dir>.
//
//   node scripts/skin-status-bar-probe.js <out-dir> [skin ...]
// Env: VIEWPORTS=390x844,380x700 (default), POPOUT=0 skips the desktop pop-out and the
// Nano tray, CHROME=<binary> overrides the auto-detected Playwright chromium.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node scripts/skin-status-bar-probe.js <out-dir> [skin ...]'); process.exit(2); }
const SKINS = process.argv.slice(3).length ? process.argv.slice(3) : ['ipod', 'ipod-black', 'ipod-matte', 'zune-classic'];
const ROOT = process.env.FT_ROOT ? path.resolve(process.env.FT_ROOT) : path.join(__dirname, '..');
const VIEWPORTS = (process.env.VIEWPORTS || '390x844,380x700').split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { w, h }; });
const DEBUG_PORT = 9333 + Math.floor(Math.random() * 400);

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

function wav(seconds) {
  const rate = 8000; const n = rate * seconds;
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(20 * Math.sin(i / 8));
  return b;
}

// 120 characters each (asserted below): the long album, and the chaptered file's own title.
const LONG_ALBUM = 'The Complete Northbound Night Transit Sessions Recorded Live At The Harbor Lights Ballroom In The Winters Of Ninety Nine';
const LONG_SONG = 'Sodium Lamp Over The Northbound Platform And Every Other Song We Played Until The Last Train Left The Station (Full Mix)';
const LONG_ARTIST = 'Halden Arcs';
if (LONG_ALBUM.length !== 120 || LONG_SONG.length !== 120) throw new Error(`fixture names must be 120 characters (album ${LONG_ALBUM.length}, song ${LONG_SONG.length})`);

const STATE_JS = `(function () {
  var p = document.getElementById('music-nowplaying-panel');
  var r = function (el) { if (!el) return null; var b = el.getBoundingClientRect(); return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
  var st = p && p.querySelector('.ip-status');
  var np = p && p.querySelector('.ip-np');
  var cs = np ? getComputedStyle(np) : null;
  var batt = p && p.querySelector('.ip-batt');
  var t = p && p.querySelector('.ipm-title');
  return {
    title: np ? np.textContent : null, titleLen: np ? np.textContent.length : 0,
    statusH: st ? Math.round(st.getBoundingClientRect().height * 10) / 10 : null,
    np: r(np), truncated: np ? np.scrollWidth > np.clientWidth : null,
    // The title's text must never paint over the play mark: either it is clipped (overflow not
    // visible) or its text ends before the play mark starts.
    spillsOverPlayMark: (function () {
      var pm = p && p.querySelector('.mms-playind');
      if (!np || !pm || getComputedStyle(np).overflowX !== 'visible') return false;
      var rg = document.createRange(); rg.selectNodeContents(np);
      return rg.getBoundingClientRect().right > pm.getBoundingClientRect().left;
    })(),
    npWhiteSpace: cs ? cs.whiteSpace : null, npTextOverflow: cs ? cs.textOverflow : null,
    playind: r(p && p.querySelector('.mms-playind')), batt: batt ? Object.assign(r(batt), { display: getComputedStyle(batt).display }) : null,
    seattleTitle: t ? Object.assign(r(t), { text: t.textContent.length + ' chars', truncated: t.scrollWidth > t.clientWidth }) : null,
    menu: !!(p && p.classList.contains('mms-menumode')), docW: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth,
    errs: (window.__errs || []).slice(0, 3),
  };
})()`;

async function main() {
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary> or install the Playwright chromium)');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-status-probe-'));
  const { app, updateDatabase, __mintTestSession } = require(path.join(ROOT, 'server'));
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-status-probe-lib-'));
  const meta = {};
  const add = (id, folder, artist, tags, extra, seconds) => {
    const fp = path.join(lib, folder, id + '.wav');
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, wav(seconds || 30));
    meta[id] = Object.assign({ id, type: 'audio', title: tags.title, name: id + '.wav', filePath: fp, rootFolder: lib, folderName: folder, channelName: artist,
      duration: seconds || 30, hasThumbnail: false, ext: '.wav', addedAt: 1788000000000 + Object.keys(meta).length, tags: Object.assign({ artist }, tags) }, extra || {});
  };
  add('nd1', 'tonzak', 'Tonzak', { title: 'Neon Arrival', album: 'Night Drive', track: '1', genre: 'Synthwave' });
  add('nd2', 'tonzak', 'Tonzak', { title: 'Overpass', album: 'Night Drive', track: '2', genre: 'Synthwave' });
  add('lg1', 'halden', LONG_ARTIST, { title: 'Harbor Lights', album: LONG_ALBUM, track: '1', genre: 'Ambient' });
  add('lg2', 'halden', LONG_ARTIST, { title: 'Terminus', album: LONG_ALBUM, track: '2', genre: 'Ambient' });
  add('lgmix', 'halden', LONG_ARTIST, { title: LONG_SONG, genre: 'Ambient' },
    { chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 10, title: 'Track A' }, { startTime: 20, title: 'Track B' }] }, 30);
  await updateDatabase((db) => { db.metadata = meta; return true; });
  fs.mkdirSync(OUT, { recursive: true });

  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cookie } = __mintTestSession();
  const [cname, cvalue] = cookie.split(';')[0].split('=');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-status-probe-chrome-'));
  const chrome = spawn(chromeBin, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-sandbox', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (_) { /* gone */ } server.close(); };
  process.on('exit', cleanup);

  let list = null;
  for (let i = 0; i < 40 && !list; i++) { await new Promise((r) => setTimeout(r, 250)); try { list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json(); } catch (_) { /* not up */ } }
  if (!list) throw new Error('Chromium never exposed its debug endpoint');
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let mid = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise((resolve, reject) => {
    const i = ++mid; const t = setTimeout(() => { pending.delete(i); reject(new Error('CDP timeout: ' + method)); }, 30000);
    pending.set(i, (m) => { clearTimeout(t); if (m.error) reject(new Error(method + ': ' + m.error.message)); else resolve(m.result); });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
  await send('Network.enable'); await send('Page.enable');
  await send('Network.setCookie', { name: cname, value: cvalue, url: base });
  // The page-side drivers (the click-skin-menus probe's): a real tap is pointerdown/up/click.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__errs = []; addEventListener('error', function (e) { __errs.push(String(e.message)); });
    window.__P = function () { return document.getElementById('music-nowplaying-panel'); };
    window.__tap = function (el) { if (typeof el === 'string') el = __P().querySelector(el); if (!el) return false;
      var r = el.getBoundingClientRect(); var o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'touch' };
      el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', o)); el.dispatchEvent(new MouseEvent('click', o)); return true; };
    window.__row = function (label) { var rs = __P().querySelectorAll('.ip-menuview .ipm-row'); for (var i = 0; i < rs.length; i++) { var l = rs[i].querySelector('.ipm-lbl'); if (l && l.textContent === label) return __tap(rs[i]); } return false; };
    window.__ready = function () { var v = __P() && __P().querySelector('.ip-menuview'); return !!v && !v.querySelector('.ipm-skel'); };
  ` });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expr, ms) => { const end = Date.now() + (ms || 15000); while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100); } return false; };
  const shot = async (file) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, file), Buffer.from(s.data, 'base64')); };
  const out = (o) => console.log(JSON.stringify(o));
  const measure = async (tag, file, action, wantTitle) => {
    if (action) await ev(action);
    const ok = await waitFor(wantTitle ? `(function(){ var n = __P() && __P().querySelector('.ip-np'); return !!n && n.textContent === ${JSON.stringify(wantTitle)} && (!__P().classList.contains('mms-menumode') || __ready()); })()` : 'true', 15000);
    await sleep(350);
    const st = await ev(STATE_JS);
    out(Object.assign({ tag, reached: ok }, st));
    await shot(file);
    return st;
  };

  for (const vp of VIEWPORTS) {
    const vpTag = vp.w + 'x' + vp.h;
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true });
    for (const skin of SKINS) {
      await send('Page.navigate', { url: base + '/music' });
      await sleep(700);
      await ev(`localStorage.setItem('ft-music-skin', '${skin}'); localStorage.removeItem('ft-tray-mode'); true`);
      await send('Page.navigate', { url: base + '/music?play=nd1' });
      await waitFor(`!!document.querySelector('#music-nowplaying-panel.mms-full .ip-status') && !!(window.FileTube && FileTube.player && FileTube.player.currentId)`, 20000);
      await sleep(800);
      const pre = `${skin}-${vpTag}`;
      const seattle = skin === 'zune-classic';
      const rows = [];
      rows.push(await measure(pre + ' now-playing', `${pre}-0-now-playing.png`, null, null));
      await measure(pre + ' main', `${pre}-1-main.png`, `__tap('[data-skin-menu]')`, seattle ? 'Seattle' : 'Click');
      if (!seattle) {
        await measure(pre + ' music', `${pre}-2-music.png`, `__tap('[data-skin-select]')`, 'Music');
        await measure(pre + ' albums', `${pre}-3-albums.png`, `__row('Albums')`, 'Albums');
        rows.push(await measure(pre + ' album short', `${pre}-4-album-short.png`, `__row('Night Drive')`, 'Night Drive'));
        await ev(`__tap('[data-skin-menu]'); true`);
        rows.push(await measure(pre + ' album LONG (120)', `${pre}-5-album-long.png`, `__row(${JSON.stringify(LONG_ALBUM)})`, LONG_ALBUM));
        await ev(`__tap('[data-skin-menu]'); __tap('[data-skin-menu]'); true`);
        await measure(pre + ' artists', `${pre}-6-artists.png`, `__row('Artists')`, 'Artists');
        await measure(pre + ' artist', `${pre}-7-artist.png`, `__row(${JSON.stringify(LONG_ARTIST)})`, LONG_ARTIST);
        rows.push(await measure(pre + ' song-titled file LONG (120)', `${pre}-8-file-long.png`, `__row(${JSON.stringify(LONG_SONG)})`, LONG_SONG));
      } else {
        await measure(pre + ' pivot artists', `${pre}-2-pivot-artists.png`, `__tap('[data-skin-select]')`, null);
        await measure(pre + ' pivot albums', `${pre}-3-pivot-albums.png`, `__tap('[data-skin-next]')`, null);
        rows.push(await measure(pre + ' album short', `${pre}-4-album-short.png`, `__row('Night Drive')`, 'Night Drive'));
        await ev(`__tap('[data-skin-menu]'); true`);
        rows.push(await measure(pre + ' album LONG (120)', `${pre}-5-album-long.png`, `__row(${JSON.stringify(LONG_ALBUM)})`, LONG_ALBUM));
        await ev(`__tap('[data-skin-menu]'); __tap('[data-skin-menu]'); true`);
        await measure(pre + ' pivot artists again', `${pre}-6-pivot-artists.png`, `__tap('[data-skin-select]')`, null);
        await measure(pre + ' artist', `${pre}-7-artist.png`, `__row(${JSON.stringify(LONG_ARTIST)})`, LONG_ARTIST);
        rows.push(await measure(pre + ' song-titled file LONG (120)', `${pre}-8-file-long.png`, `__row(${JSON.stringify(LONG_SONG)})`, LONG_SONG));
      }
      const hs = rows.map((r) => r.statusH);
      // The right cluster must never move or shrink: the battery's and the play mark's x,y,w,h.
      const batts = rows.map((r) => r.batt && r.batt.display !== 'none' ? [r.batt.x, r.batt.y, r.batt.w, r.batt.h].join(',') : 'hidden');
      const plays = rows.map((r) => r.playind ? [r.playind.x, r.playind.y, r.playind.w, r.playind.h].join(',') : 'none');
      out({ tag: pre + ' SUMMARY', statusHeights: hs, equal: hs.every((h) => h === hs[0]), battXYWH: batts, battStill: batts.every((b) => b === batts[0]),
        playXYWH: plays, playStill: plays.every((b) => b === plays[0]), longTruncated: rows.slice(2).every((r) => r.truncated === true),
        noSpill: rows.every((r) => r.spillsOverPlayMark === false) });
    }
  }

  // ---- the desktop POP-OUT (its own window, the plain-window fallback: headless cannot grant
  // Document PiP) and the Nano TRAY (the same pop-out with the tray body). A real CDP mouse
  // click on the pop-out button is the user gesture.
  if (process.env.POPOUT !== '0') {
    const runs = [['ipod', false], ['zune-classic', false], ['ipod', true]];
    for (const [skin, tray] of runs) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: base + '/music' });
      await sleep(700);
      await ev(`localStorage.setItem('ft-music-skin', '${skin}'); localStorage.setItem('ft-tray-mode', '${tray ? '1' : '0'}'); true`);
      await send('Page.navigate', { url: base + '/music?play=nd1' });
      await waitFor(`!!(window.FileTube && FileTube.player && FileTube.player.currentId) && !document.getElementById('music-popout-btn').hidden`, 20000);
      await ev(`Object.defineProperty(window, 'documentPictureInPicture', { value: undefined, configurable: true }); true`);
      const box = await ev(`(function(){ var r = document.getElementById('music-popout-btn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      const before = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).map((t) => t.id);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(1500);
      const after = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      const pop = after.find((t) => t.type === 'page' && !before.includes(t.id));
      const label = `${skin}${tray ? ' tray' : ''} popout`;
      if (!pop) { out({ tag: label, error: 'no pop-out target opened' }); continue; }
      const pws = new WebSocket(pop.webSocketDebuggerUrl);
      await new Promise((res, rej) => { pws.onopen = res; pws.onerror = rej; });
      let pid = 0; const pp = new Map();
      pws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pp.has(m.id)) { pp.get(m.id)(m); pp.delete(m.id); } };
      const psend = (method, params) => new Promise((resolve, reject) => { const i = ++pid; pp.set(i, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result))); pws.send(JSON.stringify({ id: i, method, params: params || {} })); });
      const pev = async (expr) => (await psend('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
      const pshot = async (file) => { const s2 = await psend('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, file), Buffer.from(s2.data, 'base64')); };
      const H = `window.__P = function () { return document.getElementById('music-nowplaying-panel'); }; function T(el){ if (typeof el === 'string') el = __P().querySelector(el); if (!el) return false; var r = el.getBoundingClientRect(); var o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 }; el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', o)); el.dispatchEvent(new MouseEvent('click', o)); return true; } function R(l){ var rs = __P().querySelectorAll('.ipm-row'); for (var i = 0; i < rs.length; i++) { var x = rs[i].querySelector('.ipm-lbl'); if (x && x.textContent === l) return T(rs[i]); } return false; }`;
      const step = async (tag, file, action) => {
        if (action) await pev(H + ';' + action);
        await sleep(1300);
        out(Object.assign({ tag: label + ' ' + tag, win: await pev('innerWidth + "x" + innerHeight') }, await pev(H + ';' + STATE_JS)));
        await pshot(file);
      };
      const f = `${skin}${tray ? '-tray' : ''}-popout`;
      await step('now-playing', `${f}-0-now-playing.png`, null);
      if (!tray) {
        await step('main', `${f}-1-main.png`, `T('[data-skin-menu]')`);
        await step('music', `${f}-2-music.png`, `T('[data-skin-select]')`);
        if (skin === 'zune-classic') await step('albums pivot', `${f}-3-albums.png`, `T('[data-skin-next]')`);
        else await step('albums', `${f}-3-albums.png`, `R('Albums')`);
        await step('album short', `${f}-4-album-short.png`, `R('Night Drive')`);
        await step('album LONG (120)', `${f}-5-album-long.png`, `T('[data-skin-menu]'); setTimeout(function(){ R(${JSON.stringify(LONG_ALBUM)}); }, 400)`);
      } else {
        // The tray never draws a menu (skin-surface.js render(): Now Playing only), so its title
        // is always "Now Playing"; MENU must not change that.
        await step('after MENU', `${f}-1-after-menu.png`, `T('[data-skin-menu]')`);
      }
      pws.close();
      try { await ev(`(function(){ var b = document.getElementById('music-popout-btn'); if (b) b.click(); return true; })()`); } catch (_) { /* best-effort */ }
      await sleep(500);
    }
  }
  ws.close();
  cleanup();
}
main().then(() => process.exit(0), (e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
