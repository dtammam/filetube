'use strict';

// action-row-probe - the MEASUREMENT instrument behind docs/CONTRIBUTING.md's
// "Action rows: a button NEVER deforms" rule (Dean's ruling 2026-08-28).
//
// Boots the real app (this tree, or FT_ROOT=<other worktree> for a BEFORE
// baseline) on a scratch DATA_DIR with one seeded, captioned, yt-dlp-shaped
// video, drives the Playwright-cached headless Chromium over raw CDP (no
// npm dependency - Node's global WebSocket + fetch), and for every viewport
// width prints ONE JSON line of geometry (x/y/w/h of every
// `.watch-action-btns .btn`, the stars, the title, the description box, the
// row count and the column width) plus a PNG clip of the action bar.
// Diff the BEFORE and AFTER lines: a pre-existing button whose w/h changed
// is a deformation; a y change is a wrap (intended or not).
//
//   node scripts/action-row-probe.js <out-dir> [width | WxH ...] [--theatre] [--menu-toggle] [--viewport-shot]
//   FT_ROOT=/path/to/main-worktree node scripts/action-row-probe.js <out-dir-main>
//
// Defaults: widths 390 375 1280 1366 1600 1920. A bare width runs at the
// historical height (844 below 500px, else 900); `WxH` (e.g. 1280x720) sets
// the viewport height too - theatre geometry is HEIGHT-driven, so the
// desktop-theatre measurements (v1.319, plan 2026-09-24-desktop-theatre)
// run at real monitor shapes. `--viewport-shot` also saves the whole
// viewport (the first screen, what sits above the fold) as
// `viewport-<W>x<H>[-theatre].png`. Every line carries the viewport height
// (`vh`) and the player / stage / glow boxes, so "is the title and the
// action row above the fold" is read straight off the numbers.
//
// Known instrument residual (MEASURED, v1.201): in a multi-width run the
// THIRD-or-later Chromium launch sometimes stalls - the shell paints (auth
// is fine) but the page never reaches its first POST (the server's audit
// log shows NO request from that load for 30s; zero JS errors), so the
// media-load lane inside that browser instance never completes. Reloading
// recovers it about half the time; the run then continues. A width run
// ALONE has never stalled (dozens of runs). So: the probe reloads up to
// twice (15s per attempt, wall clock) and says so on stderr; a line that
// still carries "WARNING - never finished mounting", or a run that dies on
// a CDP timeout, is NOT evidence - rerun that width alone (`node
// scripts/action-row-probe.js <out> 1600`). Tech-debt row 184. CHROME=<binary> overrides the
// auto-detected ~/.cache/ms-playwright chromium. Exits non-zero on any CDP
// failure EXCEPT the illustrative screenshot (a failed PNG is logged and the
// run continues - the JSON line is the evidence); always kills the Chromium
// it spawned.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const OUT = process.argv[2];
if (!OUT) {
  console.error('usage: node scripts/action-row-probe.js <out-dir> [width ...]');
  process.exit(2);
}
const ARGS = process.argv.slice(3);
// `--theatre`: turn theatre on before measuring (a click on the real
// #theater-btn, else the toggle's exact class flip on `.watch-container`) so
// both column widths at one viewport are measured.
const THEATRE = ARGS.includes('--theatre');
const VIEWPORT_SHOT = ARGS.includes('--viewport-shot');
// `--menu-toggle`: click the header's #menu-toggle (the left bar's real hand
// toggle) AFTER theatre is on. Since v1.319 theatre collapses the bar on desktop,
// so this REOPENS it by hand (the column narrows with no theatre click - the
// theatre reserve must follow through its ResizeObserver alone).
const MENU_TOGGLE = ARGS.includes('--menu-toggle');
// Each viewport is [width, height]; a bare width keeps the historical height.
const VIEWPORTS = ARGS.filter((a) => !a.startsWith('--')).map((a) => {
  const m = /^(\d+)(?:x(\d+))?$/.exec(a);
  if (!m) return null;
  const w = Number(m[1]);
  return [w, m[2] ? Number(m[2]) : (w < 500 ? 844 : 900)];
}).filter((v) => v && v[0] > 0 && v[1] > 0);
if (VIEWPORTS.length === 0) [390, 375, 1280, 1366, 1600, 1920].forEach((w) => VIEWPORTS.push([w, w < 500 ? 844 : 900]));
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

// A real yt-dlp auto-sub shape (rolling cues + per-word tags), so the
// Transcript button mounts and the transcript itself is exercised.
const SEED_VTT = [
  'WEBVTT', 'Kind: captions', 'Language: en', '',
  '00:00:00.240 --> 00:00:02.149 align:start position:0%', ' ',
  'Ladies<00:00:00.640><c> and</c><00:00:00.880><c> gentlemen,</c><00:00:01.360><c> welcome</c>', '',
  '00:00:02.149 --> 00:00:02.159 align:start position:0%', 'Ladies and gentlemen, welcome', ' ', '',
  '00:00:02.159 --> 00:00:04.710 align:start position:0%', 'Ladies and gentlemen, welcome',
  'to<00:00:02.560><c> the</c><00:00:02.800><c> show.</c>', '',
].join('\n');

const GEOMETRY_JS = `(function () {
  var out = { buttons: {}, rows: 0 };
  var tops = {};
  var col = document.querySelector('.watch-main');
  out.column = col ? Math.round(col.getBoundingClientRect().width) : null;
  var wc = document.querySelector('.watch-container');
  out.theatre = !!(wc && wc.classList.contains('theater-mode'));
  out.theatreReserve = wc ? (wc.style.getPropertyValue('--watch-theatre-reserve') || null) : null;
  var firstLabel = document.querySelector('.watch-action-btns .btn .btn-label');
  out.labelsShown = firstLabel ? getComputedStyle(firstLabel).display !== 'none' : null;
  out.docScrollWidth = document.documentElement.scrollWidth;
  out.vh = window.innerHeight;
  var sb = document.getElementById('sidebar');
  out.sidebarHidden = sb ? sb.classList.contains('hidden') : null;
  out.theatreGuide = document.body.getAttribute('data-theatre-guide');
  document.querySelectorAll('.watch-action-btns .btn').forEach(function (b) {
    var r = b.getBoundingClientRect();
    out.buttons[b.id || b.className] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    if (r.width > 0) tops[Math.round(r.top)] = true; // a display:none button (0x0 at top 0) is not a row
  });
  out.rows = Object.keys(tops).length;
  ['.star-rating', '.watch-title', '.description-container', '.watch-action-bar', '#player-wrapper', '#media-player', '.watch-player-stage', '#ambient-glow', '.watch-sidebar', '.main-content', '#sidebar'].forEach(function (sel) {
    var el = document.querySelector(sel); if (!el) return;
    var r = el.getBoundingClientRect();
    out[sel] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  return JSON.stringify(out);
})()`;

async function main() {
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary> or install the Playwright chromium)');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-row-probe-'));
  // Required BEFORE the server require (the DATA_DIR contract).
  const { app, saveDatabase, __mintTestSession } = require(path.join(ROOT, 'server'));
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-row-probe-lib-'));
  const filePath = path.join(lib, 'talk.mp4');
  fs.writeFileSync(filePath, 'x');
  fs.writeFileSync(path.join(lib, 'talk.en.vtt'), SEED_VTT);
  // v1.311.2: `metadata` is the ONLY top-level key the SQLite adapter still takes
  // (schema v33 moved every other namespace into its own store and the save-lock
  // refuses the dead keys), so the seed carries just the media index - the old
  // folders/folderSettings/progress/settings keys threw and the probe measured nothing.
  saveDatabase({
    metadata: {
      vid1: {
        id: 'vid1', title: 'The Tim Dylan Show - Summer Edition', type: 'video', ext: '.mp4', filePath,
        folderName: 'Tim Dylan', size: 1, addedAt: Date.now(), duration: 120,
        releaseDate: Date.UTC(2024, 0, 5), channelName: 'Tim Dylan', youtubeId: 'dQw4w9WgXcQ', hasSubtitles: true,
        // PROBE_MEDIA_WH=640x480 (v1.319): server-known dimensions, so player.js sets
        // the REAL --media-aspect (a 4:3 TV-shaped item) before the probe measures.
        ...(/^\d+x\d+$/.test(process.env.PROBE_MEDIA_WH || '') ? { width: Number(process.env.PROBE_MEDIA_WH.split('x')[0]), height: Number(process.env.PROBE_MEDIA_WH.split('x')[1]) } : {}),
      },
    },
  });
  fs.mkdirSync(OUT, { recursive: true });

  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cookie } = __mintTestSession();
  const [name, value] = cookie.split(';')[0].split('=');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-row-probe-chrome-'));
  const chrome = spawn(chromeBin, [
    // --disable-dev-shm-usage (v1.311.2, MEASURED): this box's container mounts a
    // 64M /dev/shm, and the renderer died mid-load of the watch page on EVERY run
    // (CDP Inspector.targetCrashed -> "CDP timeout: Runtime.evaluate") - shared
    // memory goes to /tmp instead with the flag, and every width completes.
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
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params) => new Promise((resolve, reject) => {
      const i = ++id;
      const t = setTimeout(() => { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(i, (m) => { clearTimeout(t); if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result); });
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    await send('Network.enable');
    await send('Page.enable');
    await send('Network.setCookie', { name, value, url: base });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: "window.__probeErrors = []; window.addEventListener('error', function (e) { window.__probeErrors.push(String(e.message)); }); window.addEventListener('unhandledrejection', function (e) { window.__probeErrors.push('rejection: ' + String(e.reason && (e.reason.stack || e.reason))); });",
    });

    for (const [w, h] of VIEWPORTS) {
      // Geometry is DPR-independent. Phones render at DPR 2 for a crisp PNG;
      // desktop widths at DPR 1 - under software GL a 2560x1800 surface made
      // every CDP round-trip crawl and the readiness poll time out.
      const dpr = w < 500 ? 2 : 1;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: w < 500 });
      await send('Page.navigate', { url: `${base}/watch.html?v=vid1` });
      // Readiness, not a fixed sleep: the JS-mounted buttons (Move/Like/
      // Watched/Share/...) appear only after the media fetch resolves - poll
      // for the LAST mounted control before measuring (a fixed 2.5s measured
      // a half-built row). A stalled load (intermittent under software GL)
      // gets up to TWO reloads. The poll is capped on WALL CLOCK, and a CDP
      // rejection is FATAL: a dead renderer used to be swallowed by the
      // catch and turned 30 polls x 20s x 3 attempts into a silent
      // ~30-minute hang (gate finding).
      const READY_JS = "!!document.getElementById('share-media-btn') && !document.querySelector('.watch-actions[data-loading]')";
      const ATTEMPT_MS = 15000;
      let ready = false;
      const t0 = Date.now();
      for (let attempt = 0; attempt < 3 && !ready; attempt++) {
        if (attempt > 0) {
          console.error(`${w}: row not mounted after ${Date.now() - t0}ms - reload ${attempt} of 2`);
          await send('Page.reload');
        }
        const deadline = Date.now() + ATTEMPT_MS;
        while (!ready && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 500));
          const res = await send('Runtime.evaluate', { expression: READY_JS, returnByValue: true }); // rejects -> fatal, by design
          ready = !!(res && res.result && res.result.value === true);
        }
      }
      if (!ready) {
        console.error(`${w}: WARNING - the action row never finished mounting; geometry below is of a partial row`);
        try {
          const diag = (await send('Runtime.evaluate', {
            expression: "JSON.stringify({ text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 160), errors: (window.__probeErrors || []).slice(0, 5) })",
            returnByValue: true,
          })).result.value;
          console.error(`${w}: page state ${diag}`);
        } catch (_) { /* best effort */ }
      }
      if (THEATRE) {
        // v1.319: drive the REAL toggle (a click on the player's #theater-btn, the
        // path that persists ft-theater and re-measures the theatre reserve) when it
        // is there; a later viewport in the same run then cold-loads theatre ON
        // from the persisted pref (init()'s path). The bare class flip is the
        // fallback for a tree without the button.
        const via = (await send('Runtime.evaluate', { expression: "(function(){var c=document.querySelector('.watch-container'); if (!c) return 'none'; if (c.classList.contains('theater-mode')) return 'persisted'; var b=document.getElementById('theater-btn'); if (b && b.getBoundingClientRect().width > 0) { b.click(); return 'click'; } c.classList.add('theater-mode'); return 'class'; })()", returnByValue: true })).result.value;
        console.error(`${w}: theatre via ${via}`);
        // Since v1.319 theatre also collapses the left bar: its slide and the
        // content's margin-left run on --dur-fast (0.15s); let them finish first.
        await new Promise((r) => setTimeout(r, 600));
        // Steady state: the reserve watch.js wrote equals the room the title + bar
        // really take below the stage (ResizeObserver -> next frame; software GL
        // frames are slow, so poll up to 5s instead of trusting a fixed sleep).
        if (MENU_TOGGLE) {
          await send('Runtime.evaluate', { expression: "(function(){var t=document.getElementById('menu-toggle'); if (t) t.click(); return !!t;})()", returnByValue: true });
          await new Promise((r) => setTimeout(r, 600)); // the margin-left transition (--dur-fast) runs first
        }
        // MEASURED: under software GL the bar's slide / the column's margin-left
        // transition can start a second or more late, and the reserve is (correctly)
        // consistent with the mid-transition layout meanwhile - so settled also
        // means no transition still running on the sidebar or the content column.
        const SETTLED_JS = "(function(){var c=document.querySelector('.watch-container'),s=document.querySelector('.watch-player-stage'),b=document.querySelector('.watch-action-bar'); if (document.getAnimations && document.getAnimations().some(function(a){var t=a.effect&&a.effect.target; return t && (t.id==='sidebar'||t.id==='main-content') && a.playState!=='finished';})) return false; if(!c||!s||!b) return true; var v=c.style.getPropertyValue('--watch-theatre-reserve'); if(!v) return true; return parseFloat(v) === Math.ceil(b.getBoundingClientRect().bottom - s.getBoundingClientRect().bottom); })()";
        for (let i = 0; i < 25; i++) {
          const res = await send('Runtime.evaluate', { expression: SETTLED_JS, returnByValue: true });
          if (res && res.result && res.result.value === true) break;
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      await new Promise((r) => setTimeout(r, Number(process.env.PROBE_SETTLE_MS) || 300)); // let the last paint settle
      const geo = (await send('Runtime.evaluate', { expression: GEOMETRY_JS, returnByValue: true })).result.value;
      const clipJson = (await send('Runtime.evaluate', {
        expression: `(function(){var el=document.querySelector('.watch-action-bar');if(!el)return null;var r=el.getBoundingClientRect();return JSON.stringify({x:r.x-8,y:r.y-8,width:Math.max(r.width,el.scrollWidth)+16,height:r.height+16,scale:${dpr}})})()`,
        returnByValue: true,
      })).result.value;
      const tag = h === (w < 500 ? 844 : 900) ? `${w}` : `${w}x${h}`;
      console.error(`${tag}: ready in ${Date.now() - t0}ms`);
      console.log(`${tag}: ${geo}`);
      // The PNG is illustration; the JSON line above is the evidence. A
      // software-GL capture can fail transiently - log it, keep measuring.
      try {
        const shot = await send('Page.captureScreenshot', { format: 'png', ...(clipJson ? { clip: JSON.parse(clipJson) } : {}) });
        fs.writeFileSync(path.join(OUT, `action-bar-${tag}${THEATRE ? '-theatre' : ''}${MENU_TOGGLE ? '-menutoggle' : ''}.png`), Buffer.from(shot.data, 'base64'));
        if (VIEWPORT_SHOT) {
          const full = await send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(OUT, `viewport-${w}x${h}${THEATRE ? '-theatre' : ''}${MENU_TOGGLE ? '-menutoggle' : ''}.png`), Buffer.from(full.data, 'base64'));
        }
      } catch (err) {
        console.error(`${w}: screenshot skipped (${err.message})`);
      if (process.env.PROBE_DEBUG) console.error(`${w}: clip was ${clipJson}`);
      }
    }
    ws.close();
  } finally {
    cleanup();
  }
}

main().then(() => process.exit(0), (err) => { console.error(err && err.stack ? err.stack : err); process.exit(1); });
