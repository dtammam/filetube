'use strict';

// home-fouc-probe - the MEASUREMENT instrument for slice L2 (app-wide look, plan
// docs/exec-plans/completed/2026-09-26-fouc-toctou-audit.md, decision D5), modeled on
// scripts/music-fouc-probe.js (same raw-CDP driver, no npm dependency).
//
// Boots the real app (this tree, or FT_ROOT=<other worktree> for a BEFORE baseline) on a
// scratch DATA_DIR seeded with a video library - 30 items over 3 channel folders in 2
// library roots, each with a REAL-SIZED 1280x720 JPEG thumbnail (generated in the probe's
// own Chromium via canvas), titles of mixed length (1- and 2-line), one subscribed
// channel (a paused subscription, so nothing downloads), a queue item, the yt-dlp module
// ENABLED (FILETUBE_YTDLP_ENABLED, so the header Download button and the bottom-nav Subs /
// Download entries appear), one TV show (3 episodes, placeholder poster) and 12 books (3
// in progress, so the Continue shelf shows) - then measures each surface at 390x844@3
// (mobile emulation, touch, CPU 4x) and 1440x900@1:
//   cls / shifts / movers - every layout-shift entry after the measurement start, with
//                named sources (selector, previousRect -> currentRect)
//   cards      - per-card growth on reveal: the first N `#video-grid > .video-card`
//                heights on the LAST frame the skeleton showed vs the FIRST frame the real
//                cards showed (same index), and the real cards' first vs final height
//   header     - `#search-input` and `.header-right` x / width, and each header-right child's
//                name + x / width, sampled every rAF frame from the first; every change is
//                listed, and `headerRespaces` counts the GEOMETRY changes only (a placeholder
//                swapped for its real control in the same box is not a re-space)
//   bottomNav  - the visible `#bottom-nav` items (data-nav + x / width) sampled every frame;
//                every change listed, `navRespaces` = geometry changes
//   reveal / paint - per art <img> (video thumbnails, row covers, TV posters, book covers)
//                the time its `art-shimmer` class cleared (an image without the class counts
//                as revealed at insert) and its Element Timing paint time: in-view
//                first/last/spread/frames; stuckShimmer = in-view imgs still shimmering
//   subscribe  - (watch) the distinct states of the Subscribe button (hidden/text) over time
//
// Modes: `cold` = a fresh navigation with the HTTP cache AND sessionStorage cleared but
// localStorage kept (a warm PWA launch: remembered flags present, the 5-minute
// sessionStorage capability cache gone); `first` = the same with localStorage cleared too
// (a first-ever launch; home classic only); `warm-spa` = an in-app round trip away and
// back through FileTube.navigate.
//
//   node scripts/home-fouc-probe.js <out-dir> [WxH[@dpr] ...] [--throttle=N] [--surfaces=a,b]
// Surfaces: home, modern, watch, tv, books (default all). Per-measurement JSON goes to
// <out-dir>/<vp>-<surface>-<mode>.json, screenshots to <out-dir>/*.png; one JSON line per
// measurement on stdout plus a compact table at the end.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const argv = process.argv.slice(2);
const OUT = argv[0];
if (!OUT || OUT.startsWith('--')) {
  console.error('usage: node scripts/home-fouc-probe.js <out-dir> [WxH[@dpr] ...] [--throttle=N] [--surfaces=home,modern,watch,tv,books]');
  process.exit(2);
}
const flag = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const MOBILE_THROTTLE = flag('throttle') ? Number(flag('throttle')) : 4;
const ALL_SURFACES = ['home', 'modern', 'watch', 'tv', 'books'];
const SURFACES = flag('surfaces') ? flag('surfaces').split(',') : ALL_SURFACES;
const VIEWPORTS = argv.slice(1).filter((a) => !a.startsWith('--')).map((a) => {
  const m = /^(\d+)x(\d+)(?:@(\d+(?:\.\d+)?))?$/.exec(a);
  if (!m) return null;
  const w = Number(m[1]); const h = Number(m[2]);
  const mobile = Math.min(w, h) < 500;
  return { w, h, dpr: m[3] ? Number(m[3]) : (mobile ? 3 : 1), mobile };
}).filter(Boolean);
if (VIEWPORTS.length === 0) VIEWPORTS.push({ w: 390, h: 844, dpr: 3, mobile: true }, { w: 1440, h: 900, dpr: 1, mobile: false });
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

// Runs INSIDE Chromium: a noisy gradient frame, JPEG-encoded at the highest quality under `hi` bytes.
const JPEG_JS = (w, h, seed, hi) => `(function () {
  var c = document.createElement('canvas'); c.width = ${w}; c.height = ${h};
  var g = c.getContext('2d');
  var s = ${seed}; function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  var grad = g.createLinearGradient(0, 0, ${w}, ${h});
  grad.addColorStop(0, 'hsl(' + Math.floor(rnd() * 360) + ',60%,45%)'); grad.addColorStop(1, 'hsl(' + Math.floor(rnd() * 360) + ',70%,30%)');
  g.fillStyle = grad; g.fillRect(0, 0, ${w}, ${h});
  for (var i = 0; i < 60; i++) { g.fillStyle = 'hsla(' + Math.floor(rnd() * 360) + ',70%,' + Math.floor(20 + rnd() * 60) + '%,0.5)'; g.beginPath(); g.arc(rnd() * ${w}, rnd() * ${h}, rnd() * ${w} / 5, 0, 6.3); g.fill(); }
  var d = g.getImageData(0, 0, ${w}, ${h}); var p = d.data;
  for (var j = 0; j < p.length; j += 4) { var n = (rnd() - 0.5) * 34; p[j] += n; p[j + 1] += n; p[j + 2] += n; }
  g.putImageData(d, 0, 0);
  var qs = [0.92, 0.85, 0.78, 0.7, 0.6, 0.5, 0.4];
  var url = '';
  for (var k = 0; k < qs.length; k++) { url = c.toDataURL('image/jpeg', qs[k]); if (url.length * 0.75 <= ${hi}) break; }
  return url.slice(url.indexOf(',') + 1);
})()`;

// Injected before any page script: layout-shift / element-timing / paint observers, the
// art-img insert/reveal MutationObserver, and a per-rAF sampler of the grid cards, the
// header, the bottom nav and the Subscribe button. window.__hf.reset() marks a start.
const OBSERVER_JS = `(function () {
  if (window.__hf) return;
  var hf = window.__hf = { t0: 0, frame: 0, frameAtT0: 0, shifts: [], imgs: [], paints: {}, fcp: null, seq: 0,
    header: [], nav: [], sub: [], skelCards: null, skelAt: null, realFirst: null, realAt: null };
  function sel(n) {
    if (!n || n.nodeType !== 1) return n ? String(n.nodeName) : 'null';
    var parts = []; var cur = n;
    for (var i = 0; i < 4 && cur && cur.nodeType === 1 && cur !== document.body; i++) {
      var s = cur.tagName.toLowerCase();
      if (cur.id) s += '#' + cur.id;
      var cls = (typeof cur.className === 'string' ? cur.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s); cur = cur.parentElement;
    }
    return parts.join(' > ');
  }
  function r(x) { return x ? [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)] : null; }
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) {
        hf.shifts.push({ t: e.startTime, v: e.value, input: e.hadRecentInput, frame: hf.frame,
          src: (e.sources || []).map(function (s) { return { sel: sel(s.node), prev: r(s.previousRect), cur: r(s.currentRect) }; }) });
      });
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (_) {}
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { if (e.name === 'first-contentful-paint') hf.fcp = e.startTime; });
    }).observe({ type: 'paint', buffered: true });
  } catch (_) {}
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { if (e.identifier && hf.paints[e.identifier] === undefined) hf.paints[e.identifier] = e.renderTime || e.loadTime; });
    }).observe({ type: 'element', buffered: true });
  } catch (_) {}
  var ART_RE = /\\/(thumbnail|albumart|podcastart|tvposter|bookcover)\\//;
  function isArt(img) { var s = img.getAttribute('src') || ''; return ART_RE.test(s) || img.classList.contains('art-shimmer'); }
  function addImg(img) {
    if (img.__hf || !isArt(img)) return;
    var rec = { id: 'hf' + (++hf.seq), el: img, src: img.getAttribute('src'), ins: performance.now(), insFrame: hf.frame,
      shim: img.classList.contains('art-shimmer'), rev: null, revFrame: null };
    img.__hf = rec;
    img.setAttribute('elementtiming', rec.id);
    if (!rec.shim) { rec.rev = rec.ins; rec.revFrame = rec.insFrame; }
    hf.imgs.push(rec);
  }
  var mo = new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'childList') {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'IMG') addImg(n);
          if (n.querySelectorAll) n.querySelectorAll('img').forEach(addImg);
        });
      } else if (m.type === 'attributes' && m.target.tagName === 'IMG') {
        var rec = m.target.__hf;
        if (!rec) { addImg(m.target); rec = m.target.__hf; }
        if (!rec || rec.rev !== null) continue;
        if (rec.shim && !m.target.classList.contains('art-shimmer')) { rec.rev = performance.now(); rec.revFrame = hf.frame; }
      }
    }
  });
  function start() { mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src'] }); document.querySelectorAll('img').forEach(addImg); }
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  var N_CARDS = 6;
  function cardBoxes(nodes) {
    var out = [];
    for (var i = 0; i < nodes.length && out.length < N_CARDS; i++) {
      var b = nodes[i].getBoundingClientRect();
      out.push({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height * 10) / 10,
        info: (function () { var v = nodes[i].querySelector('.video-info'); return v ? Math.round(v.getBoundingClientRect().height * 10) / 10 : null; })() });
    }
    return out;
  }
  function sample() {
    hf.frame++;
    var now = performance.now();
    // grid cards: last skeleton frame vs first real frame
    var grid = document.getElementById('video-grid');
    if (grid) {
      var skel = grid.querySelectorAll(':scope > .video-card.skeleton-card');
      var real = grid.querySelectorAll(':scope > .video-card:not(.skeleton-card)');
      if (skel.length && !real.length) { hf.skelCards = cardBoxes(skel); hf.skelAt = now; }
      if (real.length && hf.realFirst === null && hf.skelCards) { hf.realFirst = cardBoxes(real); hf.realAt = now; }
    }
    // header
    var si = document.getElementById('search-input');
    var hr = document.querySelector('.header-right');
    if (hr) {
      var sb = si ? si.getBoundingClientRect() : null;
      var hb = hr.getBoundingClientRect();
      var boxes = Array.prototype.map.call(hr.children, function (c) {
        var b = c.getBoundingClientRect(); if (b.width < 1) return null;
        return { name: (c.id || (typeof c.className === 'string' ? c.className.split(' ')[0] : c.tagName)), g: Math.round(b.x) + 'w' + Math.round(b.width) };
      }).filter(Boolean);
      var geo = (sb ? Math.round(sb.x) + '/' + Math.round(sb.width) : '-') + '|' + Math.round(hb.x) + '/' + Math.round(hb.width) + '|' + boxes.map(function (x) { return x.g; }).join(',');
      var key = geo + '|' + boxes.map(function (x) { return x.name; }).join(',');
      var last = hf.header[hf.header.length - 1];
      if (!last || last.key !== key) hf.header.push({ t: now, frame: hf.frame, key: key, geo: geo });
    }
    var nav = document.getElementById('bottom-nav');
    if (nav) {
      var nb = nav.getBoundingClientRect();
      if (nb.height > 0) {
        var its = Array.prototype.map.call(nav.querySelectorAll('.bottom-nav-item'), function (it) {
          var b = it.getBoundingClientRect(); if (b.width < 1) return null;
          return { name: (it.getAttribute('data-nav') || '?'), x: Math.round(b.x) + 'w' + Math.round(b.width) };
        }).filter(Boolean);
        var items = its.map(function (x) { return x.name + ':' + x.x; }).join(' ');
        var ngeo = its.map(function (x) { return x.x; }).join(' ');
        var lastN = hf.nav[hf.nav.length - 1];
        if (!lastN || lastN.key !== items) hf.nav.push({ t: now, frame: hf.frame, key: items, geo: ngeo });
      }
    }
    var subBtn = document.getElementById('subscribe-btn-mock');
    if (subBtn) {
      // v1.340: the label is a stable-width stack holding BOTH words (common.js
      // stableToggleLabelHtml) - read the CURRENT one from data-label (gate r1 W3), never textContent.
      var subStack = subBtn.querySelector('.btn-label-stack');
      var subLabel = subStack ? subStack.getAttribute('data-label') : subBtn.textContent.trim();
      var sk = (subBtn.isConnected ? (subBtn.hidden ? 'hidden' : 'shown:' + subLabel) : 'removed');
      var bell = document.querySelector('.watch-bell-btn, #subscribe-bell-btn, .subscribe-bell-btn');
      if (bell) sk += '+bell:' + (bell.hidden ? 'h' : 's');
      var lastS = hf.sub[hf.sub.length - 1];
      if (!lastS || lastS.key !== sk) hf.sub.push({ t: now, frame: hf.frame, key: sk });
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
  hf.reset = function () {
    hf.t0 = performance.now(); hf.frameAtT0 = hf.frame;
    hf.imgs = hf.imgs.filter(function (x) { return x.el.isConnected; }).map(function (x) { x.stale = true; return x; });
    hf.shifts = []; hf.skelCards = null; hf.realFirst = null; hf.skelAt = null; hf.realAt = null;
    hf.header = hf.header.slice(-1); hf.nav = hf.nav.slice(-1); hf.sub = hf.sub.slice(-1);
    return hf.t0;
  };
  function inView(el) {
    if (!el.isConnected) return false;
    var b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) return false;
    if (b.bottom <= 0 || b.right <= 0 || b.top >= innerHeight || b.left >= innerWidth) return false;
    var st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none') return false;
    for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      var ps = getComputedStyle(p);
      if (ps.display === 'none') return false;
      if (ps.overflowX !== 'visible' || ps.overflowY !== 'visible') {
        var pb = p.getBoundingClientRect();
        if (b.right <= pb.left || b.left >= pb.right || b.bottom <= pb.top || b.top >= pb.bottom) return false;
      }
    }
    return true;
  }
  // readiness: real content present and every in-view art image complete
  hf.ready = function (scopeSel, needSel) {
    var scope = document.querySelector(scopeSel);
    if (!scope) return false;
    if (needSel && !scope.querySelector(needSel)) return false;
    if (scope.querySelector('.skeleton-card, .skeleton-shimmer.book-cover-link')) return false;
    var imgs = Array.prototype.filter.call(scope.querySelectorAll('img'), function (i) { return i.__hf && inView(i); });
    if (!imgs.length) return false;
    return imgs.every(function (i) { return i.complete; });
  };
  hf.report = function () {
    var t0 = hf.t0;
    var recs = hf.imgs.filter(function (x) { return x.el.isConnected && !x.stale; }).map(function (x) {
      var pt = hf.paints[x.id];
      return { id: x.id, src: x.src, inView: inView(x.el), ins: x.ins - t0, rev: x.rev === null ? null : x.rev - t0,
        paint: pt === undefined ? null : pt - t0, insFrame: x.insFrame - hf.frameAtT0, revFrame: x.revFrame === null ? null : x.revFrame - hf.frameAtT0,
        shim: x.shim, stuck: x.el.classList.contains('art-shimmer'), complete: x.el.complete, nat: [x.el.naturalWidth, x.el.naturalHeight] };
    });
    var rel = function (arr) { return arr.map(function (e) { return { t: Math.round(e.t - t0), frame: e.frame - hf.frameAtT0, key: e.key, geo: e.geo }; }); };
    var cards = null;
    if (hf.skelCards && hf.realFirst) {
      var final = cardBoxes(document.querySelectorAll('#video-grid > .video-card:not(.skeleton-card)'));
      cards = { skel: hf.skelCards, realFirst: hf.realFirst, realFinal: final, skelLastAt: Math.round(hf.skelAt - t0), realAt: Math.round(hf.realAt - t0) };
    }
    return JSON.stringify({ fcp: hf.fcp, t0: t0, frames: hf.frame - hf.frameAtT0, vw: innerWidth, vh: innerHeight,
      shifts: hf.shifts.filter(function (s) { return s.t >= t0 - 1; }).map(function (s) { s.t -= t0; return s; }),
      imgs: recs, cards: cards, header: rel(hf.header), nav: rel(hf.nav), sub: rel(hf.sub) });
  };
})();`;

function stats(arr) {
  const v = arr.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return { n: v.length, first: Math.round(v[0]), last: Math.round(v[v.length - 1]), spread: Math.round(v[v.length - 1] - v[0]) };
}

function summarize(rep, label) {
  const inView = rep.imgs.filter((i) => i.inView);
  const cls = rep.shifts.reduce((a, s) => a + s.v, 0);
  const revIn = stats(inView.map((i) => i.rev));
  if (revIn) revIn.rafFrames = new Set(inView.filter((i) => i.revFrame !== null).map((i) => i.revFrame)).size;
  const paintIn = stats(inView.map((i) => i.paint));
  if (paintIn) paintIn.frames = new Set(inView.filter((i) => i.paint !== null).map((i) => Math.round(i.paint / 16))).size;
  const movers = new Map();
  for (const s of rep.shifts.filter((x) => x.v > 0)) for (const src of s.src) {
    const m = movers.get(src.sel) || { sel: src.sel, n: 0, v: 0, dy: [], dx: [] };
    m.n++; m.v += s.v;
    if (src.prev && src.cur) { m.dy.push(src.cur[1] - src.prev[1]); m.dx.push(src.cur[0] - src.prev[0]); }
    movers.set(src.sel, m);
  }
  let cards = null;
  if (rep.cards) {
    const c = rep.cards;
    const n = Math.min(c.skel.length, c.realFirst.length);
    const growth = []; const infoGrowth = []; const settle = [];
    for (let i = 0; i < n; i++) {
      growth.push(Math.round((c.realFirst[i].h - c.skel[i].h) * 10) / 10);
      if (c.realFirst[i].info !== null && c.skel[i].info !== null) infoGrowth.push(Math.round((c.realFirst[i].info - c.skel[i].info) * 10) / 10);
      if (c.realFinal[i]) settle.push(Math.round((c.realFinal[i].h - c.realFirst[i].h) * 10) / 10);
    }
    cards = { growth, maxAbsGrowth: growth.length ? Math.max(...growth.map(Math.abs)) : null, infoGrowth, settleAfterReveal: settle,
      skelH: c.skel.map((x) => x.h), realH: c.realFirst.map((x) => x.h) };
  }
  const header = rep.header;
  const nav = rep.nav;
  // re-spacing = a GEOMETRY change between consecutive samples (a placeholder swapped for its
  // real control in the same box is an identity change only, never a re-space)
  const respaces = (arr) => { let n = 0; for (let i = 1; i < arr.length; i++) if (arr[i].geo !== arr[i - 1].geo) n++; return n; };
  return {
    label, fcp: rep.fcp === null ? null : Math.round(rep.fcp),
    cls: Math.round(cls * 10000) / 10000, shiftCount: rep.shifts.length,
    imgs: rep.imgs.length, inView: inView.length,
    stuckShimmerInView: inView.filter((i) => i.stuck).length,
    shimmeredInView: inView.filter((i) => i.shim && i.revFrame !== null && i.revFrame > i.insFrame).length,
    revealInView: revIn, paintInView: paintIn,
    cards,
    headerRespaces: respaces(header), navRespaces: respaces(nav),
    headerChanges: Math.max(0, header.length - 1), headerFirst: header.length ? header[0].key : null, headerFinal: header.length ? header[header.length - 1].key : null,
    headerTimeline: header.map((h) => `${h.t}ms f${h.frame}: ${h.key}`),
    navLayouts: nav.length, navFirst: nav.length ? nav[0].key : null, navFinal: nav.length ? nav[nav.length - 1].key : null,
    navTimeline: nav.map((h) => `${h.t}ms f${h.frame}: ${h.key}`),
    subscribe: rep.sub.map((h) => `${h.t}ms: ${h.key}`),
    movers: [...movers.values()].sort((a, b) => b.v - a.v).slice(0, 8).map((m) => ({ sel: m.sel, n: m.n, v: Math.round(m.v * 10000) / 10000, dy: [...new Set(m.dy)].slice(0, 5), dx: [...new Set(m.dx)].slice(0, 5) })),
  };
}

const CHANNELS = [
  { folder: 'Halden Arcs', sub: true, url: 'https://www.youtube.com/@haldenarcs' },
  { folder: 'Marrow Lane', sub: false, url: 'https://www.youtube.com/@marrowlane' },
  { folder: 'Oriel Vance', sub: false, url: 'https://www.youtube.com/@orielvance' },
];
const TITLES = [
  'Night Transit', 'A Very Long Walk Through the Sodium Lamps of the Old Harbour District at Dusk',
  'Paper Harbor (Live)', 'How the Glass Orchard Was Built - Part Two of the Northbound Series',
  'Saltmarsh', 'Signal Box Sessions: Terminus, the full rehearsal with the whole band in one take',
  'Lowlight', 'Long Walk Home - Director\'s Commentary and Behind the Scenes Footage',
  'Quiet Engines', 'The Tidewater Set Plays the Entire Second Album Front to Back Tonight',
];

async function main() {
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary> or install the Playwright chromium)');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-home-fouc-'));
  const DATA_DIR = process.env.DATA_DIR;
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-home-fouc-dl-'));
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = dlDir;
  const s = require(path.join(ROOT, 'server'));
  const { app, saveDatabase, __mintTestSession, getMediaId } = s;
  fs.mkdirSync(OUT, { recursive: true });

  const server = await new Promise((resolve) => { const sv = app.listen(0, '127.0.0.1', () => resolve(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cookie } = __mintTestSession();
  const [cname, cvalue] = cookie.split(';')[0].split('=');
  const authed = (url, opts) => fetch(`${base}${url}`, Object.assign({}, opts || {}, { headers: Object.assign({ Cookie: cookie.split(';')[0], 'Content-Type': 'application/json' }, (opts && opts.headers) || {}) }));

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

  // ---- 1. seed ----
  let cdp = await launch();
  const evaluate0 = async (expression) => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  const thumbDir = path.join(DATA_DIR, '.thumbnails');
  fs.mkdirSync(thumbDir, { recursive: true });
  const jpgs = [];
  for (let k = 0; k < 8; k++) jpgs.push(Buffer.from(await evaluate0(JPEG_JS(1280, 720, 3000 + k * 7919, 160000)), 'base64'));
  const libA = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-home-fouc-libA-'));
  const libB = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-home-fouc-libB-'));
  const metadata = {};
  const now = Date.now();
  const ids = [];
  for (let i = 0; i < 30; i++) {
    const ch = CHANNELS[i % 3];
    const rootDir = i % 3 === 2 ? libB : libA;
    const dir = path.join(rootDir, ch.folder);
    fs.mkdirSync(dir, { recursive: true });
    const title = `${TITLES[i % TITLES.length]}${i >= TITLES.length ? ` ${Math.floor(i / TITLES.length) + 1}` : ''}`;
    const fp = path.join(dir, `video-${String(i).padStart(2, '0')}.mp4`);
    fs.writeFileSync(fp, 'x');
    const id = getMediaId(fp);
    ids.push(id);
    fs.writeFileSync(path.join(thumbDir, `${id}.jpg`), jpgs[i % jpgs.length]);
    metadata[id] = { id, title, type: 'video', ext: '.mp4', filePath: fp, rootFolder: rootDir, folderName: ch.folder, channelName: ch.folder,
      channelUrl: ch.url, size: 1, addedAt: now - i * 3600e3, duration: 300 + i * 17, hasThumbnail: true, releaseDate: now - i * 86400e3 };
  }
  saveDatabase({ metadata });
  s.settingsStore.replaceAll({ scanIntervalMinutes: 0, pruneMissing: false });
  s.folderStore.replaceAll([libA, libB]);
  s.ytdlpDb.replaceAll({ allowMembersOnly: false, downloadMeta: {}, pins: [], channelAvatars: {},
    subscriptions: [{ id: 'sub-halden', channelUrl: CHANNELS[0].url, name: CHANNELS[0].folder, format: 'video', quality: 'best', maxVideos: 5,
      maxDurationSeconds: null, minDurationSeconds: null, paused: true, skipShorts: false, pushBell: false, filetype: 'mp4', cutoffDate: null,
      order: 0, addedAt: new Date(now).toISOString(), lastCheckedAt: null, lastStatus: null, libraryPlace: 'default' }] });
  // TV: one show, 3 episodes, the placeholder poster (no poster file).
  const tvRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-home-fouc-tv-'));
  const episodes = {};
  for (let e = 1; e <= 3; e++) {
    const fp = path.join(tvRoot, 'Harbor Lights', 'Season 1', `Harbor Lights S01E0${e}.mp4`);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, 'x');
    const id = getMediaId(fp);
    episodes[id] = { id, showId: 'harbor-lights', showName: 'Harbor Lights', seasonNum: 1, episodeNum: e, title: `Episode ${e}`, filePath: fp,
      rootFolder: tvRoot, ext: '.mp4', size: 1, durationSec: 1500, addedAt: now - e * 1000 };
  }
  s.tvDb.replaceAll({ folders: [tvRoot], episodes, settings: {} });
  // Books: 12 pdfs (placeholder covers), 3 in progress (the Continue shelf).
  const booksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-home-fouc-books-'));
  const bookItems = {};
  const bookIds = [];
  for (let b = 0; b < 12; b++) {
    const fp = path.join(booksRoot, `Book ${b + 1}.pdf`);
    fs.writeFileSync(fp, '%PDF-1.4');
    const id = getMediaId(fp);
    bookIds.push(id);
    bookItems[id] = { id, title: `Book ${b + 1}: ${TITLES[b % TITLES.length]}`, author: CHANNELS[b % 3].folder, format: 'pdf', filePath: fp,
      folderName: path.basename(booksRoot), rootFolder: booksRoot, size: 8, addedAt: now - b * 1000, hasCover: false, pageCount: 100 };
  }
  s.booksDb.replaceAll({ folders: [booksRoot], items: bookItems, progress: {}, pins: [], settings: {}, audio: {} });
  for (const id of bookIds.slice(0, 3)) {
    const r = await authed(`/api/books/${id}/progress`, { method: 'POST', body: JSON.stringify({ locator: { kind: 'pdf', page: 30 }, percent: 30 }) });
    if (!r.ok) console.error(`book progress seed failed: ${r.status} ${await r.text()}`);
  }
  {
    const r = await authed('/api/queue/items', { method: 'POST', body: JSON.stringify({ mediaId: ids[4], position: 'end', kind: 'media' }) });
    if (!r.ok) console.error(`queue seed failed: ${r.status} ${await r.text()}`);
  }
  const probeHealth = await authed('/api/subscriptions/health');
  console.error(`seeded ${ids.length} videos / 3 channels (1 subscribed) / 2 roots + TV 1 show x3 + 12 books (3 reading) + 1 queue item; thumbs 1280x720 ${jpgs.map((j) => Math.round(j.length / 1024) + 'KB').join(',')}; ytdlp health ${probeHealth.status}`);
  cdp.ws.close();

  const results = [];
  for (const vp of VIEWPORTS) {
    const vpl = `${vp.w}x${vp.h}@${vp.dpr}`;
    cdp = await launch();
    const { send } = cdp;
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text}`);
      return r.result.value;
    };
    const waitFor = async (expression, label, ms) => {
      const deadline = Date.now() + (ms || 20000);
      while (Date.now() < deadline) {
        try { if (await evaluate(expression)) return true; } catch (_) { /* navigating */ }
        await sleep(100);
      }
      console.error(`WARNING [${vpl}]: timed out waiting for ${label}`);
      return false;
    };
    const shot = async (file) => {
      try { const sh = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, file), Buffer.from(sh.data, 'base64')); } catch (err) { console.error(`screenshot ${file} skipped (${err.message})`); }
    };
    await send('Network.enable');
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.setCookie', { name: cname, value: cvalue, url: base });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVER_JS });
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
    if (vp.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const throttle = vp.mobile ? MOBILE_THROTTLE : 1;
    if (throttle > 1) await send('Emulation.setCPUThrottlingRate', { rate: throttle });

    // warm-up: visit every surface once (home in BOTH layouts) so the remembered flags /
    // counts are written; re-run after the `first` measurement wipes localStorage.
    const setModern = (on) => evaluate(`localStorage.setItem('ft-modern-mode', ${JSON.stringify(on ? 'on' : 'off')}); true`);
    const warmUp = async () => {
      for (const [url, modern] of [['/', false], ['/', true], ['/tv', null], ['/books', null], [`/watch.html?v=${ids[0]}`, null], ['/', false]]) {
        await send('Page.navigate', { url: `${base}${url}` });
        await waitFor('!!window.__hf && document.readyState === "complete"', `warm-up ${url}`);
        if (modern !== null) {
          await setModern(modern);
          await send('Page.reload');
          await waitFor('!!window.__hf && document.readyState === "complete"', `warm-up ${url} reload`);
        }
        await sleep(2500);
      }
    };
    await warmUp();

    const settleAndReport = async (readyExpr, label, file) => {
      const ok = await waitFor(readyExpr, `${label} ready`, 30000);
      await sleep(throttle > 1 ? 3000 : 1500);
      const rep = JSON.parse(await evaluate('window.__hf.report()'));
      const sm = summarize(rep, label);
      sm.ready = ok; sm.vp = vpl; sm.throttle = throttle;
      fs.writeFileSync(path.join(OUT, `${file}.json`), JSON.stringify({ summary: sm, report: rep }, null, 1));
      await shot(`${file}.png`);
      console.log(JSON.stringify(sm));
      results.push(sm);
      return sm;
    };
    const coldLoad = async (url, opts) => {
      const o = opts || {};
      if (typeof o.modern === 'boolean') await setModern(o.modern);
      await evaluate(`(function(){ try { sessionStorage.clear(); ${o.freshStorage ? "var keep = ['ft-modern-mode','theme','ft-theme','ft-mode']; var saved = {}; keep.forEach(function(k){ var v = localStorage.getItem(k); if (v !== null) saved[k] = v; }); localStorage.clear(); Object.keys(saved).forEach(function(k){ localStorage.setItem(k, saved[k]); });" : ''} } catch (_) {} return true; })()`);
      await send('Page.navigate', { url: 'about:blank' });
      await sleep(300);
      await send('Network.clearBrowserCache');
      await send('Page.navigate', { url: `${base}${url}` });
      await waitFor('!!window.__hf', 'observer injected');
      await evaluate('(function(){window.__hf.t0=0;window.__hf.frameAtT0=0;return true;})()');
    };
    const spaRoundTrip = async (away, back, awayReady) => {
      await evaluate(`window.FileTube.navigate(${JSON.stringify(away)}); true`);
      await waitFor(awayReady, `the SPA swap to ${away}`);
      await sleep(1500);
      await evaluate('window.__hf.reset(); true');
      await evaluate(`window.FileTube.navigate(${JSON.stringify(back)}); true`);
    };
    const homeReady = "window.__hf.ready('#video-grid', '.video-card:not(.skeleton-card) img')";

    if (SURFACES.includes('home')) {
      await coldLoad('/', { modern: false });
      await settleAndReport(homeReady, 'home cold', `${vpl}-home-cold`);
      await spaRoundTrip('/history', '/', "location.pathname === '/history'");
      await settleAndReport(homeReady, 'home warm-spa', `${vpl}-home-warm-spa`);
      await coldLoad('/', { modern: false, freshStorage: true });
      await settleAndReport(homeReady, 'home first', `${vpl}-home-first`);
      // the fresh-storage load wiped the per-surface flags / counts: warm every surface again
      await warmUp();
    }
    if (SURFACES.includes('modern')) {
      await coldLoad('/', { modern: true });
      await settleAndReport(homeReady + " && !!document.querySelector('.modern-chip-row')", 'modern cold', `${vpl}-modern-cold`);
      await spaRoundTrip('/history', '/', "location.pathname === '/history'");
      await settleAndReport(homeReady, 'modern warm-spa', `${vpl}-modern-warm-spa`);
      await setModern(false);
    }
    if (SURFACES.includes('watch')) {
      const watchReady = "(function(){ var b = document.getElementById('subscribe-btn-mock'); var a = document.querySelector('.watch-actions'); return !!(b && a && !a.hasAttribute('data-loading')); })()";
      await coldLoad(`/watch.html?v=${ids[3]}`);
      await settleAndReport(watchReady, 'watch cold', `${vpl}-watch-cold`);
      await spaRoundTrip('/history', `/watch.html?v=${ids[6]}`, "location.pathname === '/history'");
      await settleAndReport(watchReady + " && location.search.indexOf('" + ids[6] + "') >= 0", 'watch warm-spa', `${vpl}-watch-warm-spa`);
    }
    if (SURFACES.includes('tv')) {
      const tvReady = "window.__hf.ready('#tv-content', '.show-card img')";
      await coldLoad('/tv');
      await settleAndReport(tvReady, 'tv cold', `${vpl}-tv-cold`);
      await spaRoundTrip('/history', '/tv', "location.pathname === '/history'");
      await settleAndReport(tvReady, 'tv warm-spa', `${vpl}-tv-warm-spa`);
    }
    if (SURFACES.includes('books')) {
      // ready: the Continue shelf's covers (the grid can sit below the fold at 390) are all in
      const booksReady = "window.__hf.ready('#view-root', '#books-continue-grid .book-card img') && !!document.querySelector('#books-grid .book-card img')";
      await coldLoad('/books');
      await settleAndReport(booksReady, 'books cold', `${vpl}-books-cold`);
      await spaRoundTrip('/history', '/books', "location.pathname === '/history'");
      await settleAndReport(booksReady, 'books warm-spa', `${vpl}-books-warm-spa`);
    }
    cdp.ws.close();
  }

  // ---- compact table ----
  const pad = (x, n) => String(x).padEnd(n);
  console.log('\n' + ['viewport', 'surface/mode', 'CLS', 'shifts', 'card growth (max|g|; per card)', 'hdr respace/changes', 'nav respace/layouts', 'imgs(inView)', 'stuck', 'reveal spread/rafFrames', 'paint spread/frames', 'top mover'].join(' | '));
  for (const r of results) {
    const rv = r.revealInView; const p = r.paintInView;
    console.log([pad(r.vp, 12), pad(r.label, 16), r.cls, r.shiftCount,
      r.cards ? `${r.cards.maxAbsGrowth}; ${r.cards.growth.join(',')}` : '-', `${r.headerRespaces}/${r.headerChanges}`, `${r.navRespaces}/${r.navLayouts}`, `${r.imgs}(${r.inView})`, r.stuckShimmerInView,
      rv ? `${rv.spread}/${rv.rafFrames}` : '-', p ? `${p.spread}/${p.frames}` : '-', r.movers[0] ? `${r.movers[0].sel} ${r.movers[0].v}` : '-'].join(' | '));
  }
}

main().then(() => process.exit(0), (err) => { console.error(err && err.stack ? err.stack : err); process.exit(1); });
