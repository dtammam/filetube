'use strict';

// pocket-render-probe - the ZERO-DELTA instrument for the pocket design system (plan
// docs/exec-plans/active/2026-09-25-pocket-design-system.md, AC3) and the colorway renderer for
// the side-by-sides (AC7/AC12). Two modes:
//
//   node scripts/pocket-render-probe.js shoot <out-dir> [skin ...]
//     Boots the real app (this tree, or FT_ROOT=<other worktree> for a BEFORE baseline) on a
//     scratch DATA_DIR with a small library, drives headless Chromium over raw CDP (the
//     skin-status-bar-probe pattern) through the REAL menus, and at every pocket level writes a
//     PNG plus, into <out-dir>/styles.json, a hash of EVERY element's computed style (custom
//     properties excluded - they are the refactor's own renames; what renders is the resolved
//     longhands) including ::before / ::after. Levels: Now Playing, the song list, Main Menu,
//     Music, Albums, the A-Z picker, a 120-character album, Settings, Settings > Lighting, About,
//     Brick. Each level is shot with lighting Off, Subtle and Pronounced at ONE fixed tilt (the
//     classes and --lx/--ly/--lm set exactly as pocket-lighting.js writes them, so both sides get
//     byte-identical inputs). Motion is frozen (prefers-reduced-motion) and the audio paused at a
//     fixed time, so a shot depends on the CSS alone. Then the desktop pop-out (the plain-window
//     fallback) and the Nano tray per colorway.
//     Env: VIEWPORTS=390x844,380x700 (default), POPOUT=0 skips the pop-out and tray,
//     LIGHTS=off,subtle,pronounced, CHROME=<binary>.
//
//   node scripts/pocket-render-probe.js compare <before-dir> <after-dir>
//     Decodes every PNG pair in Chromium (canvas getImageData) and counts differing pixels, and
//     diffs the computed-style hashes. Brick's LCD is a live canvas game, so its shot is compared
//     OUTSIDE the LCD only (the body and wheel); its styles are compared in full. Prints one line
//     per shot and a TOTAL; exits 1 on any differing pixel or style.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MODE = process.argv[2];
const ROOT = process.env.FT_ROOT ? path.resolve(process.env.FT_ROOT) : path.join(__dirname, '..');
const VIEWPORTS = (process.env.VIEWPORTS || '390x844,380x700').split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { w, h }; });
const LIGHTS = (process.env.LIGHTS || 'off,subtle,pronounced').split(',');
const DEBUG_PORT = 9333 + Math.floor(Math.random() * 400);
// the fixed tilt every lit shot uses (upper-left light, a little off-centre)
const TILT = { lx: '0.35', ly: '-0.3', lm: '0.46' };

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

const LONG_ALBUM = 'The Complete Northbound Night Transit Sessions Recorded Live At The Harbor Lights Ballroom In The Winters Of Ninety Nine';
const LONG_SONG = 'Sodium Lamp Over The Northbound Platform And Every Other Song We Played Until The Last Train Left The Station (Full Mix)';
const LONG_ARTIST = 'Halden Arcs Featuring The Northbound Platform Choir And Every Other Voice We Recorded That Winter At The Ballroom';
// enough albums for the Albums level to be letterable (quick scroll needs 20+ rows)
const FILLER = ['Amber Coast', 'Blue Hour', 'Cold Signal', 'Dune Radio', 'Echo Park', 'Frost Line', 'Glass Tide', 'Harbor Fog',
  'Iron Bloom', 'Jade Static', 'Kite Season', 'Lunar Drift', 'Mercury Rain', 'North Loop', 'Opal Night', 'Paper Moon',
  'Quiet Engine', 'Red Canyon', 'Slow Orbit', 'Tin Harbor', 'Upper Room', 'Velvet Road'];

// the page-side drivers (a real tap is pointerdown / pointerup / click)
const DRIVERS = `
  window.__errs = []; addEventListener('error', function (e) { __errs.push(String(e.message)); });
  window.__P = function () { return document.getElementById('music-nowplaying-panel'); };
  window.__tap = function (el) { if (typeof el === 'string') el = __P().querySelector(el); if (!el) return false;
    var r = el.getBoundingClientRect(); var o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'touch' };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', o)); el.dispatchEvent(new MouseEvent('click', o)); return true; };
  window.__row = function (label) { var rs = __P().querySelectorAll('.ip-menuview .ipm-row'); for (var i = 0; i < rs.length; i++) { var l = rs[i].querySelector('.ipm-lbl'); if (l && l.textContent === label) return __tap(rs[i]); } return false; };
  window.__title = function () { var n = __P() && __P().querySelector('.ip-np'); return n ? n.textContent : null; };
  window.__ready = function () { var v = __P() && __P().querySelector('.ip-menuview'); return !v || !v.querySelector('.ipm-skel'); };
  window.__freeze = function (t) { var m = document.getElementById('media-player'); if (m) { try { m.pause(); m.currentTime = t; } catch (_) {} } return true; };
  window.__light = function (s, lx, ly, lm) { var p = __P(); if (!p) return false;
    p.classList.toggle('mms-lit', s !== 'off'); p.classList.toggle('mms-lit-strong', s === 'pronounced');
    if (s === 'off') { p.style.removeProperty('--lx'); p.style.removeProperty('--ly'); p.style.removeProperty('--lm'); }
    else { p.style.setProperty('--lx', lx); p.style.setProperty('--ly', ly); p.style.setProperty('--lm', lm); }
    return true; };
  window.__styles = function () {
    var p = __P(); if (!p) return {};
    var h = function (s) { var x = 2166136261; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16); };
    var dump = function (cs) { var parts = []; for (var k = 0; k < cs.length; k++) { var n = cs[k]; if (n.slice(0, 2) === '--') continue; parts.push(n + ':' + cs.getPropertyValue(n)); } return parts.join(';'); };
    var pathOf = function (el) { var s = []; while (el && el !== p.parentNode) { var i = 0, q = el; while ((q = q.previousElementSibling)) i++; s.unshift(el.tagName.toLowerCase() + ':' + i); el = el.parentElement; } return s.join('>'); };
    var out = {}; var els = [p].concat(Array.prototype.slice.call(p.querySelectorAll('*')));
    els.forEach(function (el) {
      var parts = dump(getComputedStyle(el));
      ['::before', '::after'].forEach(function (ps) { var c = getComputedStyle(el, ps); if (c.content && c.content !== 'none' && c.content !== 'normal') parts += '|' + ps + dump(c); });
      out[pathOf(el) + ' ' + (typeof el.className === 'string' ? el.className : '')] = h(parts);
    });
    return out; };
  window.__lcdRect = function () { var l = __P() && __P().querySelector('.ip-lcd'); if (!l) return null; var r = l.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
`;

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

async function launch(chromeBin) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-render-probe-chrome-'));
  const chrome = spawn(chromeBin, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-sandbox', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none', 'about:blank'], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 40 && !list; i++) { await new Promise((r) => setTimeout(r, 250)); try { list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json(); } catch (_) { /* not up */ } }
  if (!list) throw new Error('Chromium never exposed its debug endpoint');
  return { chrome, page: list.find((t) => t.type === 'page') };
}

async function shoot(OUT, SKINS) {
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary> or install the Playwright chromium)');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-render-probe-'));
  const { app, updateDatabase, __mintTestSession } = require(path.join(ROOT, 'server'));
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-render-probe-lib-'));
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
  add('lg1', 'halden', LONG_ARTIST, { title: LONG_SONG, album: LONG_ALBUM, track: '1', genre: 'Ambient' });
  add('lg2', 'halden', LONG_ARTIST, { title: 'Terminus', album: LONG_ALBUM, track: '2', genre: 'Ambient' });
  FILLER.forEach((a, i) => add('f' + i, 'filler', 'Various', { title: a + ' Theme', album: a, track: '1', genre: 'Pop' }));
  await updateDatabase((db) => { db.metadata = meta; return true; });
  fs.mkdirSync(OUT, { recursive: true });

  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cookie } = __mintTestSession();
  const [cname, cvalue] = cookie.split(';')[0].split('=');
  const { chrome, page } = await launch(chromeBin);
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (_) { /* gone */ } server.close(); };
  process.on('exit', cleanup);
  const { ws, send, ev } = await cdp(page.webSocketDebuggerUrl);
  await send('Network.enable'); await send('Page.enable');
  await send('Network.setCookie', { name: cname, value: cvalue, url: base });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: DRIVERS });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expr, ms) => { const end = Date.now() + (ms || 15000); while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100); } return false; };
  const styles = {};
  const meta2 = {};
  const log = (o) => console.log(JSON.stringify(o));
  const snap = async (tag, extra) => {
    for (const s of LIGHTS) {
      await ev(`__light(${JSON.stringify(s)}, ${JSON.stringify(TILT.lx)}, ${JSON.stringify(TILT.ly)}, ${JSON.stringify(TILT.lm)})`);
      await sleep(250);
      const name = `${tag}--${s}`;
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
      styles[name] = await ev('__styles()');
      meta2[name] = Object.assign({ title: await ev('__title()'), lcd: await ev('__lcdRect()'), scale: 2 }, extra || {});
    }
    await ev(`__light('off')`);
    log({ tag, title: await ev('__title()'), errs: await ev('__errs.slice(0,3)') });
  };
  const go = async (action, want) => {
    await ev(action);
    const ok = await waitFor(`__title() === ${JSON.stringify(want)} && __ready()`, 15000);
    if (!ok) log({ warn: 'did not reach ' + want, title: await ev('__title()') });
    await sleep(400);
    return ok;
  };

  for (const vp of VIEWPORTS) {
    const vpTag = vp.w + 'x' + vp.h;
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true });
    for (const skin of SKINS) {
      await send('Page.navigate', { url: base + '/music' });
      await sleep(700);
      await ev(`localStorage.setItem('ft-music-skin', '${skin}'); localStorage.removeItem('ft-tray-mode'); localStorage.setItem('ft-pocket-lighting', 'off'); true`);
      await send('Page.navigate', { url: base + '/music?play=nd1' });
      await waitFor(`!!document.querySelector('#music-nowplaying-panel.mms-full .ip-status') && !!(window.FileTube && FileTube.player && FileTube.player.currentId)`, 20000);
      await sleep(900);
      await ev('__freeze(7)');
      await sleep(600);
      const pre = `${skin}-${vpTag}`;
      await snap(pre + '-00-now-playing');
      await ev(`__tap('[data-skin-select]')`); await sleep(500);
      await snap(pre + '-01-song-list');
      for (let i = 0; i < 3 && (await ev('__title()')) !== 'Click'; i++) { await ev(`__tap('[data-skin-menu]')`); await sleep(400); }
      await sleep(300);
      await snap(pre + '-02-main');
      await go(`__tap('[data-skin-select]')`, 'Music'); await snap(pre + '-03-music');
      await go(`__row('Albums')`, 'Albums'); await snap(pre + '-04-albums');
      // the A-Z picker: a finger scroll shows the edge badge; tapping it opens the picker
      await ev(`(function(){ var l = __P().querySelector('.ipm-list'); l.scrollTop = 120; l.dispatchEvent(new Event('scroll')); return true; })()`);
      await sleep(250);
      await ev(`__tap('.ipm-badge')`); await sleep(400);
      await snap(pre + '-05-picker');
      await ev(`__tap('[data-skin-menu]')`); await sleep(300); // MENU only closes the picker
      await go(`__tap('[data-skin-menu]')`, 'Music');
      await go(`__row('Artists')`, 'Artists');
      await go(`__row(${JSON.stringify(LONG_ARTIST)})`, LONG_ARTIST); await snap(pre + '-06-artist-long');
      await go(`__row(${JSON.stringify(LONG_ALBUM)})`, LONG_ALBUM); await snap(pre + '-07-album-long');
      for (let i = 0; i < 6 && (await ev('__title()')) !== 'Click'; i++) { await ev(`__tap('[data-skin-menu]')`); await sleep(450); }
      await go(`__row('Settings')`, 'Settings'); await snap(pre + '-08-settings');
      await go(`__row('Lighting')`, 'Lighting'); await snap(pre + '-09-lighting');
      await go(`__tap('[data-skin-menu]')`, 'Settings');
      await go(`__row('About')`, 'About'); await snap(pre + '-10-about');
      await go(`__tap('[data-skin-menu]')`, 'Settings');
      await go(`__tap('[data-skin-menu]')`, 'Click');
      if (await go(`__row('Extras')`, 'Extras')) {
        await go(`__row('Games')`, 'Games');
        await ev(`__row('Brick')`); await sleep(600);
        await snap(pre + '-11-brick', { brick: true });
      }
    }
  }

  // ---- the desktop POP-OUT (the plain-window fallback: headless cannot grant Document PiP) and
  // the Nano TRAY per colorway. A real CDP mouse click on the pop-out button is the gesture.
  if (process.env.POPOUT !== '0') {
    for (const skin of SKINS) {
      for (const tray of [false, true]) {
        await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await send('Page.navigate', { url: base + '/music' });
        await sleep(700);
        await ev(`localStorage.setItem('ft-music-skin', '${skin}'); localStorage.setItem('ft-tray-mode', '${tray ? '1' : '0'}'); localStorage.setItem('ft-pocket-lighting', 'off'); true`);
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
        const label = `${skin}${tray ? '-tray' : ''}-popout`;
        if (!pop) { log({ tag: label, error: 'no pop-out target opened' }); continue; }
        const P = await cdp(pop.webSocketDebuggerUrl);
        await P.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await P.ev(DRIVERS + ';true');
        await ev('__freeze(7)');
        await sleep(1200);
        const psnap = async (tag) => {
          const name = `${label}-${tag}--off`;
          const s2 = await P.send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s2.data, 'base64'));
          styles[name] = await P.ev('__styles()');
          meta2[name] = { title: await P.ev('__title()'), win: await P.ev('innerWidth + "x" + innerHeight'), scale: 1 };
          log({ tag: name, title: meta2[name].title, win: meta2[name].win });
        };
        await psnap('0-now-playing');
        if (!tray) {
          await P.ev(`__tap('[data-skin-menu]')`); await sleep(900); await psnap('1-main');
          await P.ev(`__tap('[data-skin-select]')`); await sleep(900);
          await P.ev(`__row('Albums')`); await sleep(1300); await psnap('2-albums');
        }
        P.ws.close();
        try { await ev(`(function(){ var b = document.getElementById('music-popout-btn'); if (b) b.click(); return true; })()`); } catch (_) { /* best-effort */ }
        await sleep(500);
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify(styles));
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta2, null, 1));
  ws.close();
  cleanup();
}

async function compare(A, B) {
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found');
  const names = fs.readdirSync(A).filter((f) => f.endsWith('.png')).sort();
  const onlyB = fs.readdirSync(B).filter((f) => f.endsWith('.png') && !names.includes(f));
  const meta = JSON.parse(fs.readFileSync(path.join(A, 'meta.json'), 'utf8'));
  const sa = JSON.parse(fs.readFileSync(path.join(A, 'styles.json'), 'utf8'));
  const sb = JSON.parse(fs.readFileSync(path.join(B, 'styles.json'), 'utf8'));
  const { chrome, page } = await launch(chromeBin);
  const { ws, ev } = await cdp(page.webSocketDebuggerUrl);
  let totalPx = 0; let totalStyle = 0; let missing = onlyB.length;
  for (const f of names) {
    const name = f.replace(/\.png$/, '');
    if (!fs.existsSync(path.join(B, f))) { console.log(`${name}: MISSING in after`); missing += 1; continue; }
    const da = fs.readFileSync(path.join(A, f)).toString('base64');
    const db = fs.readFileSync(path.join(B, f)).toString('base64');
    const m = meta[name] || {};
    const mask = m.brick && m.lcd ? m.lcd : null;
    const px = await ev(`(async function(){
      const load = (d) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + d; });
      const [a, b] = await Promise.all([load(${JSON.stringify(da)}), load(${JSON.stringify(db)})]);
      if (a.width !== b.width || a.height !== b.height) return { size: [a.width, a.height, b.width, b.height] };
      const c = (img) => { const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const x = cv.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
      const pa = c(a); const pb = c(b); const mask = ${JSON.stringify(mask)};
      let n = 0; let masked = 0; const k = ${JSON.stringify(m.scale || 1)};
      for (let i = 0; i < pa.length; i += 4) {
        if (pa[i] === pb[i] && pa[i + 1] === pb[i + 1] && pa[i + 2] === pb[i + 2] && pa[i + 3] === pb[i + 3]) continue;
        if (mask) { const p = i / 4; const x = p % a.width; const y = Math.floor(p / a.width);
          if (x >= mask.x * k && x < (mask.x + mask.w) * k && y >= mask.y * k && y < (mask.y + mask.h) * k) { masked++; continue; } }
        n++;
      }
      return { n, masked };
    })()`);
    const ka = sa[name] || {}; const kb = sb[name] || {};
    const diffs = Object.keys(Object.assign({}, ka, kb)).filter((k) => ka[k] !== kb[k]);
    totalPx += px.n || 0; totalStyle += diffs.length;
    console.log(`${name}: ${px.size ? 'SIZE ' + px.size.join('x') : px.n + ' px'}${px.masked ? ' (+' + px.masked + ' in the masked Brick LCD)' : ''}, ${diffs.length} style diffs${diffs.length ? ' e.g. ' + diffs.slice(0, 3).join(' | ') : ''}`);
    if (px.size) totalPx += 1;
  }
  for (const f of onlyB) console.log(`${f}: ONLY in after`);
  console.log(`TOTAL: ${names.length} shots, ${totalPx} differing pixels, ${totalStyle} differing element styles, ${missing} missing`);
  ws.close(); try { chrome.kill('SIGKILL'); } catch (_) { /* gone */ }
  return totalPx === 0 && totalStyle === 0 && missing === 0;
}

if (MODE === 'shoot') {
  const OUT = process.argv[3];
  if (!OUT) { console.error('usage: node scripts/pocket-render-probe.js shoot <out-dir> [skin ...]'); process.exit(2); }
  let skins = process.argv.slice(4);
  if (!skins.length) {
    const SK = require(path.join(ROOT, 'public', 'js', 'music-skins.js'));
    skins = SK.SKINS.filter((s) => s.menus === 'click').map((s) => s.id);
  }
  shoot(OUT, skins).then(() => process.exit(0), (e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
} else if (MODE === 'compare') {
  const [, , , A, B] = process.argv;
  if (!A || !B) { console.error('usage: node scripts/pocket-render-probe.js compare <before-dir> <after-dir>'); process.exit(2); }
  compare(A, B).then((ok) => process.exit(ok ? 0 : 1), (e) => { console.error(e && e.stack ? e.stack : e); process.exit(2); });
} else {
  console.error('usage: node scripts/pocket-render-probe.js shoot <out-dir> [skin ...] | compare <before-dir> <after-dir>');
  process.exit(2);
}
