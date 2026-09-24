'use strict';

// chapter-snap-probe - the MEASUREMENT instrument for the Chapter Snap (2026-09-24)
// editor (common.js showChapterSnapEditor). Dean: "PHONE IS A PRIMARY VIEWPORT" -
// the editor must be fully usable on a phone: every control a real tap target
// (>= 44px), nothing drag-only, nothing clipped or sideways-scrolling at 390x844.
//
// Boots the real app (this tree, or FT_ROOT=<other worktree> for a BEFORE drill
// baseline) on a scratch DATA_DIR with a chaptered VIDEO (the watch page) and a
// chaptered AUDIO file (the Music album drill), both with a seeded silence cache,
// then drives the Playwright-cached headless Chromium over raw CDP (the
// action-row-probe.js pattern) and, per viewport, REACHES the editor through the
// real UI:
//   watch: open the chapters menu -> "Fix chapter times..." -> the editor
//   music: open the album card -> the drill's "Fix times" -> the editor
// and prints ONE JSON line per (surface, width) of geometry: the viewport, the
// document and scroller scrollWidth vs clientWidth (sideways scroll), the modal
// rect, every button's w/h with the count below 44px, the row count, and any
// element whose right edge passes the viewport. PNGs go to <out-dir>.
//
//   node scripts/chapter-snap-probe.js <out-dir> [width ...]
// Defaults: widths 390 1440. CHROME=<binary> overrides the auto-detected chromium.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const OUT = process.argv[2];
if (!OUT) {
  console.error('usage: node scripts/chapter-snap-probe.js <out-dir> [width ...]');
  process.exit(2);
}
// Viewports as WxH (gate r1: 390x844 portrait phone, 844x390 LANDSCAPE phone, 1440x900
// desktop). A bare width keeps the old default height (844 phone / 900 desktop).
const VIEWPORTS = process.argv.slice(3).map((a) => {
  const m = /^(\d+)(?:x(\d+))?$/.exec(a);
  if (!m) return null;
  const w = Number(m[1]);
  return { w, h: m[2] ? Number(m[2]) : (w < 500 ? 844 : 900) };
}).filter(Boolean);
if (VIEWPORTS.length === 0) VIEWPORTS.push({ w: 390, h: 844 }, { w: 844, h: 390 }, { w: 1440, h: 900 });
const ROOT = process.env.FT_ROOT ? path.resolve(process.env.FT_ROOT) : path.join(__dirname, '..');
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

// Eight chapters, long titles (wrapping is part of what is measured), boundaries
// shaped like Dean's two cases (in a silence, in the previous song's tail).
const TITLES = ['Night Transit', 'Sodium Lamps Over The Northbound Platform (Extended)', 'Last Northbound', 'Harbor Lights',
  'Overpass', 'Signal Box', 'Tidewater And The Long Walk Home', 'Terminus'];
const CHAPTERS = TITLES.map((title, i) => ({ startTime: i === 0 ? 0 : i * 240 + (i % 2 ? 1.5 : -3), title }));
const SILENCES = TITLES.slice(1).map((_, k) => { const i = k + 1; return { start: i * 240 - 1, end: i * 240 + 2.5 }; });

const MEASURE_JS = `(function () {
  var vw = document.documentElement.clientWidth, vh = window.innerHeight;
  var modal = document.querySelector('.chapter-snap-modal');
  var scroller = document.querySelector('.chapter-snap-scroll');
  var out = { vw: vw, vh: vh, docScrollWidth: document.documentElement.scrollWidth, open: !!modal };
  if (!modal) return JSON.stringify(out);
  var mr = modal.getBoundingClientRect();
  out.modal = { x: Math.round(mr.x), y: Math.round(mr.y), w: Math.round(mr.width), h: Math.round(mr.height) };
  out.modalScrollWidth = modal.scrollWidth; out.modalClientWidth = modal.clientWidth;
  out.scroller = scroller ? { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth, clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight } : null;
  out.rows = document.querySelectorAll('.chapter-snap-row').length;
  var btns = Array.prototype.slice.call(modal.querySelectorAll('button')).filter(function (b) { return b.offsetParent !== null; });
  var minW = Infinity, minH = Infinity, below = [];
  btns.forEach(function (b) {
    var r = b.getBoundingClientRect();
    if (r.width < minW) minW = r.width;
    if (r.height < minH) minH = r.height;
    if (r.width < 44 || r.height < 44) below.push((b.className.split(' ').pop() || 'btn') + ':' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  out.buttons = btns.length; out.minBtnW = Math.round(minW); out.minBtnH = Math.round(minH);
  out.below44 = below.length; out.below44Sample = below.slice(0, 6);
  var overflow = [];
  modal.querySelectorAll('*').forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) overflow.push(el.className || el.tagName);
  });
  out.pastViewport = overflow.length; out.pastViewportSample = overflow.slice(0, 4);
  var times = document.querySelector('.chapter-snap-now');
  out.timeFontPx = times ? parseFloat(getComputedStyle(times).fontSize) : null;
  out.suggestions = document.querySelectorAll('[data-act="snap"]').length;
  out.status = (document.querySelector('.chapter-snap-status') || {}).textContent || '';
  return JSON.stringify(out);
})()`;

const AUDITION_JS = `JSON.stringify((function () {
  var a = document.querySelector('.chapter-snap-audio');
  var row = document.querySelectorAll('.chapter-snap-row')[1];
  return { audio: !!a, paused: a ? a.paused : null, currentTime: a ? Math.round(a.currentTime * 10) / 10 : null,
    rowPlaying: row.classList.contains('is-playing'), boundary: ${CHAPTERS[1].startTime},
    status: (document.querySelector('.chapter-snap-status') || {}).textContent };
})())`;

const DRILL_JS = `(function () {
  var out = { snapBtn: !!document.querySelector('.music-drill-snap'), buttons: {} };
  document.querySelectorAll('.music-drill-actions .btn').forEach(function (b) {
    var r = b.getBoundingClientRect();
    out.buttons[b.className.split(' ')[0]] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  out.docScrollWidth = document.documentElement.scrollWidth; out.vw = document.documentElement.clientWidth;
  return JSON.stringify(out);
})()`;

async function main() {
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary> or install the Playwright chromium)');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-snap-probe-'));
  const server0 = require(path.join(ROOT, 'server'));
  const { app, saveDatabase, __mintTestSession, getMediaId } = server0;
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-snap-probe-lib-'));
  const vidPath = path.join(lib, 'night-transit.mp4');
  const audPath = path.join(lib, 'night-transit-album.mp3');
  // FT_PROBE_AUDIO=<a real audio file, ideally 2000 s> makes both items playable, so "Play
  // from here" is measured for real and the watch page's seek-bar notches exist (they need
  // a known media duration) for the after-Save reading.
  if (process.env.FT_PROBE_AUDIO) {
    fs.copyFileSync(process.env.FT_PROBE_AUDIO, audPath);
    fs.copyFileSync(process.env.FT_PROBE_AUDIO, vidPath);
  } else {
    fs.writeFileSync(vidPath, 'x');
    fs.writeFileSync(audPath, 'y');
  }
  const audId = getMediaId(audPath);
  // Re-seeded at EVERY viewport, so each one starts from the source chapters (the watch
  // pass SAVES) - otherwise the second viewport measured an already-snapped list.
  const seed = () => {
    saveDatabase({
      metadata: {
        vid1: { id: 'vid1', title: 'Night Transit (Full Album)', type: 'video', ext: '.mp4', filePath: vidPath, folderName: 'Halden Arcs', size: 1, addedAt: Date.now(), duration: 2000, channelName: 'Halden Arcs', chapters: CHAPTERS },
        [audId]: { id: audId, title: 'Night Transit (Full Album)', type: 'audio', ext: '.mp3', filePath: audPath, folderName: 'Halden Arcs', size: 1, addedAt: Date.now(), duration: 2000, channelName: 'Halden Arcs', artist: 'Halden Arcs', chapters: CHAPTERS },
      },
    });
    if (server0.chapterSilenceService) {
      const SILENCE_PARAMS_KEY = require(path.join(ROOT, 'lib', 'media', 'chapterSilence')).SILENCE_PARAMS_KEY;
      for (const [id, p] of [['vid1', vidPath], [audId, audPath]]) {
        const st = fs.statSync(p);
        server0.chapterSilenceService.cache.write(id, { params: SILENCE_PARAMS_KEY, size: st.size, mtimeMs: st.mtimeMs, silences: SILENCES });
      }
    }
  };
  seed();
  fs.mkdirSync(OUT, { recursive: true });

  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cookie } = __mintTestSession();
  const [name, value] = cookie.split(';')[0].split('=');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-snap-probe-chrome-'));
  const chrome = spawn(chromeBin, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-sandbox', '--disable-dev-shm-usage',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (_) { /* gone */ } server.close(); };
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
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    const waitFor = async (expression, label, ms) => {
      const deadline = Date.now() + (ms || 15000);
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return true;
        await new Promise((r) => setTimeout(r, 300));
      }
      console.error(`WARNING: timed out waiting for ${label}`);
      return false;
    };
    const shot = async (file) => {
      try {
        const s = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, file), Buffer.from(s.data, 'base64'));
      } catch (err) { console.error(`screenshot ${file} skipped (${err.message})`); }
    };
    await send('Network.enable');
    await send('Page.enable');
    await send('Network.setCookie', { name, value, url: base });

    for (const vp of VIEWPORTS) {
      const h = vp.h;
      const phone = Math.min(vp.w, vp.h) < 500;
      const dpr = phone ? 2 : 1;
      const w = `${vp.w}x${h}`; // the label every line and PNG carries
      await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: h, deviceScaleFactor: dpr, mobile: phone });
      seed();

      // ---- watch page: chapters menu -> "Fix chapter times..." ----
      await send('Page.navigate', { url: `${base}/watch.html?v=vid1` });
      await waitFor("!!document.querySelector('.chapter-now') && typeof window.showChapterSnapEditor === 'function'", 'the watch player chapters trigger');
      await new Promise((r) => setTimeout(r, 1200));
      const reached = await evaluate(`(async function () {
        var trigger = document.querySelector('.chapter-now');
        if (!trigger) return 'no trigger';
        trigger.hidden = false; trigger.click();
        for (var i = 0; i < 20 && !document.querySelector('.chapters-menu-snap'); i++) await new Promise(function (r) { setTimeout(r, 150); });
        var entry = document.querySelector('.chapters-menu-snap');
        if (!entry) return 'no Fix chapter times entry in the menu: ' + (document.querySelector('#chapters-menu') || {}).textContent;
        entry.click();
        return 'reached';
      })()`);
      await waitFor("document.querySelectorAll('.chapter-snap-row').length === 8 && document.querySelectorAll('[data-act=\"snap\"]').length > 0", 'the editor rows + suggestions');
      // Measure only once the open scale-in has FINISHED (qa r1: a fixed 500 ms caught it
      // mid-animation at 320 wide) - a readiness condition, not a longer sleep.
      await waitFor("(function(){var m=document.querySelector('.chapter-snap-modal'); if(!m) return false; var t=getComputedStyle(m).transform; return t==='none'||t==='matrix(1, 0, 0, 1, 0, 0)';})()", 'the open scale-in to finish');
      console.log(`watch ${w}: ${JSON.stringify({ entry: reached })} ${await evaluate(MEASURE_JS)}`);
      await shot(`chapter-snap-watch-${w}.png`);
      await evaluate("(function(){var b=document.querySelector('.chapter-snap-snapall'); if (b) b.click(); return true;})()");
      await new Promise((r) => setTimeout(r, 300));
      console.log(`watch ${w} after Snap all: ${await evaluate(MEASURE_JS)}`);
      await shot(`chapter-snap-watch-${w}-snapped.png`);
      // gate r1 (adversary W4, qa W2): SAVE on the watch page and read the seek-bar notches
      // and the stored starts back - the notch must sit on the NEW boundary.
      await evaluate("(function(){var b=document.querySelector('.chapter-snap-save'); if (b) b.click(); return true;})()");
      await waitFor("!document.querySelector('.chapter-snap-modal')", 'the editor closed after Save');
      await new Promise((r) => setTimeout(r, 400));
      console.log(`watch ${w} after Save: ${await evaluate("JSON.stringify({ notches: Array.prototype.map.call(document.querySelectorAll('.seek-chapters-gap'), function (n) { return parseFloat(n.style.left); }).slice(0, 3) })")} stored ${JSON.stringify(await (await fetch(`${base}/api/videos/vid1`, { headers: { Cookie: cookie.split(';')[0] } })).json().then((d) => d.chapters.slice(1, 4).map((c) => Math.round(c.startTime / 2000 * 100000) / 1000)))}`);

      // ---- music: album card -> drill "Fix times" ----
      await send('Page.navigate', { url: `${base}/music.html` });
      await waitFor("!!document.querySelector('.music-album-card[data-album-key]')", 'an album card');
      await evaluate("(function(){var c=document.querySelector('.music-album-card[data-album-key]'); if (c) c.click(); return true;})()");
      await waitFor("!!document.querySelector('.music-drill-actions')", 'the album drill');
      await waitFor("!!document.querySelector('.music-drill-snap')", 'the drill Fix times button', 6000);
      await new Promise((r) => setTimeout(r, 400));
      console.log(`drill ${w}: ${await evaluate(DRILL_JS)}`);
      await shot(`chapter-snap-drill-${w}.png`);
      const opened = await evaluate("(function(){var b=document.querySelector('.music-drill-snap'); if (!b) return false; b.click(); return true;})()");
      if (opened) {
        await waitFor("document.querySelectorAll('.chapter-snap-row').length === 8", 'the drill editor rows');
        await waitFor("(function(){var m=document.querySelector('.chapter-snap-modal'); if(!m) return false; var t=getComputedStyle(m).transform; return t==='none'||t==='matrix(1, 0, 0, 1, 0, 0)';})()", 'the open scale-in to finish');
        console.log(`music-editor ${w}: ${await evaluate(MEASURE_JS)}`);
        await shot(`chapter-snap-music-${w}.png`);
        if (process.env.FT_PROBE_AUDIO) {
          // Audition chapter 2: the editor's own audio element must be PLAYING at (or just
          // past) chapter 2's start - the real seek + play path, not a stub.
          await evaluate("(function(){document.querySelectorAll('.chapter-snap-row')[1].querySelector('[data-act=play]').click(); return true;})()");
          await new Promise((r) => setTimeout(r, 2500));
          console.log(`music-audition ${w}: ${await evaluate(AUDITION_JS)}`);
        }
      }
    }
    ws.close();
  } finally {
    cleanup();
  }
}

main().then(() => process.exit(0), (err) => { console.error(err && err.stack ? err.stack : err); process.exit(1); });
