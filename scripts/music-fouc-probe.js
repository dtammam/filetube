'use strict';

// music-fouc-probe - the MEASUREMENT instrument for the Music "thumbnails load
// somewhat individually + slight page shifting" audit (2026-09-26, plan
// docs/exec-plans/active/2026-09-26-fouc-toctou-audit.md).
//
// Boots the real app (this tree, or FT_ROOT=<other worktree> for a BEFORE baseline)
// on a scratch DATA_DIR seeded with a realistic music library - 40 native tracks over
// 10 albums / 5 artists whose album art is REAL-SIZED JPEG (1200x1200 and 600x600,
// generated in the probe's own Chromium via canvas, sizes printed), plus 3 yt-dlp
// library-audio items whose art falls back to a 1280x720 /thumbnail - then drives the
// Playwright-cached headless Chromium over raw CDP (the action-row-probe.js pattern,
// no npm dependency) through every Music surface, COLD and WARM, and prints ONE JSON
// line per (viewport, surface, mode) plus a compact table at the end:
//   cls        - sum of every layout-shift entry after the measurement start (raw: a
//                shift inside 500ms of a synthetic click is NOT hadRecentInput, so it
//                counts; clsNoInput excludes hadRecentInput entries)
//   shifts     - each entry's value + its sources (selector, previousRect -> currentRect)
//   reveal     - per art <img> the time its `art-shimmer` class cleared (or `.maa-img`
//                gained is-loaded), relative to the measurement start (Page.navigate or
//                the SPA/click action): first/last/spread, distinct rAF frames and
//                distinct 16ms buckets the reveals landed in - IN-VIEWPORT and ALL
//   paint      - the Element Timing renderTime of each art img (the frame the decoded
//                pixels actually painted - an `elementtiming` attribute is stamped on
//                each art img as it is inserted), same first/last/spread/frames
//   shimmered  - in-viewport art imgs that were painted at least one frame WITH the
//                shimmer (reveal rAF frame > insert rAF frame)
//   skeleton   - ms + rAF frames the seeded .skeleton-shimmer placeholder was on screen
//   img cost   - naturalWidth x naturalHeight vs the rendered CSS box (and device px at
//                the DPR), transfer bytes from CDP Network events, and the cache source
//                (network / disk / memory = no request at all)
//
// Surfaces: home, albums, artists, songs (tab lists: cold page load + warm SPA round trip
// away to / and back + warm in-view tab switch away and back), album drill + artist drill
// (click from the grid; warm = history back + re-click), now playing (tap the first song;
// warm = SPA round trip away and back with the track still playing).
//
//   node scripts/music-fouc-probe.js <out-dir> [WxH[@dpr] ...] [--throttle=N] [--net=Mbps,rttMs] [--art=px] [--surfaces=a,b]
// Defaults: 390x844@3 (mobile emulation, touch, CPU throttle 4x) and 1440x900@1 (no
// throttle). --throttle=N overrides the MOBILE throttle (1 = off). CHROME=<binary> overrides
// the auto-detected ~/.cache/ms-playwright chromium; CHROME_FLAGS='--flag ...' adds launch flags. Per-measurement detail JSON goes to
// <out-dir>/<vp>-<surface>-<mode>.json, screenshots to <out-dir>/*.png.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const argv = process.argv.slice(2);
const OUT = argv[0];
if (!OUT || OUT.startsWith('--')) {
  console.error('usage: node scripts/music-fouc-probe.js <out-dir> [WxH[@dpr] ...] [--throttle=N] [--surfaces=home,albums,artists,songs,album-drill,artist-drill,nowplaying]');
  process.exit(2);
}
const flag = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const MOBILE_THROTTLE = flag('throttle') ? Number(flag('throttle')) : 4;
// --net=<down Mbps>,<RTT ms>: Network.emulateNetworkConditions for every viewport (default:
// none - localhost, so every byte arrives at once and the network stagger is NOT represented).
// --art=<px>: the A/B control - seed EVERY album cover at <px>x<px> (and the library-audio
// thumbnails at <px> wide, 16:9) instead of the real-sized 1200/600/1280 art.
const ART_PX = flag('art') ? Number(flag('art')) : null;
const NET = flag('net') ? flag('net').split(',').map(Number) : null;
const ALL_SURFACES = ['home', 'albums', 'artists', 'songs', 'album-drill', 'artist-drill', 'nowplaying'];
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

// A 240-second 8 kHz mono 8-bit silent WAV (MUSIC_EXTENSIONS includes .wav, served as
// audio/wav with no transcode) so a tapped track really plays - long enough that no
// track ends (and autoplay advances) inside a measurement. Written ONCE and hard-linked.
function silentWav() {
  const n = 8000 * 240;
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  b.fill(128, 44);
  return b;
}

// The library: 5 artists x 2 albums x 4 tracks. Album art alternates 1200x1200 / 600x600.
const ARTISTS = ['Halden Arcs', 'Marrow Lane', 'Oriel Vance', 'The Tidewater Set', 'Quiet Engines'];
const ALBUM_NAMES = [['Night Transit', 'Sodium Lamps'], ['Paper Harbor', 'Lowlight'], ['Glass Orchard', 'Northbound'],
  ['Saltmarsh', 'Long Walk Home'], ['Signal Box', 'Terminus']];

// Runs INSIDE Chromium: a noisy gradient cover, JPEG-encoded at the highest quality that
// stays under `hi` bytes (so the file sizes land in the realistic 150-400KB band).
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
  var qs = [0.95, 0.9, 0.85, 0.8, 0.72, 0.64, 0.55, 0.45, 0.35];
  var url = '';
  for (var k = 0; k < qs.length; k++) { url = c.toDataURL('image/jpeg', qs[k]); if (url.length * 0.75 <= ${hi}) break; }
  return url.slice(url.indexOf(',') + 1);
})()`;

// Injected before any page script (Page.addScriptToEvaluateOnNewDocument): the layout-shift,
// element-timing and paint observers, the art-img insert/reveal MutationObserver, a rAF frame
// counter, and the skeleton on-screen tracker. window.__mf.reset() marks a measurement start.
const OBSERVER_JS = `(function () {
  if (window.__mf) return;
  var mf = window.__mf = { t0: 0, frame: 0, frameAtT0: 0, shifts: [], imgs: [], paints: {}, fcp: null, skel: [], skelOpen: null, seq: 0 };
  function tick() { mf.frame++; requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
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
        mf.shifts.push({ t: e.startTime, v: e.value, input: e.hadRecentInput, frame: mf.frame,
          src: (e.sources || []).map(function (s) { return { sel: sel(s.node), prev: r(s.previousRect), cur: r(s.currentRect) }; }) });
      });
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (_) {}
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { if (e.name === 'first-contentful-paint') mf.fcp = e.startTime; });
    }).observe({ type: 'paint', buffered: true });
  } catch (_) {}
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { if (e.identifier && mf.paints[e.identifier] === undefined) mf.paints[e.identifier] = e.renderTime || e.loadTime; });
    }).observe({ type: 'element', buffered: true });
  } catch (_) {}
  function isArt(img) { var s = img.getAttribute('src') || ''; return /\\/(albumart|thumbnail)\\//.test(s) || img.classList.contains('art-shimmer') || img.classList.contains('maa-img'); }
  function addImg(img) {
    if (img.__mf || !isArt(img)) return;
    var rec = { id: 'mf' + (++mf.seq), el: img, src: img.getAttribute('src'), ins: performance.now(), insFrame: mf.frame,
      shim: img.classList.contains('art-shimmer'), maa: img.classList.contains('maa-img'), rev: null, revFrame: null, load: null };
    img.__mf = rec;
    img.setAttribute('elementtiming', rec.id);
    if (rec.shim === false && !rec.maa) { rec.rev = rec.ins; rec.revFrame = rec.insFrame; }
    img.addEventListener('load', function () { rec.load = performance.now(); }, { once: true });
    mf.imgs.push(rec);
  }
  var TEXT_SEL = '.music-shelf-title, .music-album-title, .music-song-title, .music-artist-name, .music-jump-head, .music-drill-title, .mnp-title, .mnp-queue-title';
  mf.texts = [];
  function addText(el) {
    if (el.__mft) return; el.__mft = true;
    var id = 'mft' + (++mf.seq); el.setAttribute('elementtiming', id);
    mf.texts.push({ id: id, el: el, ins: performance.now() });
  }
  function skelCheck() {
    var on = !!document.querySelector('#music-content .skeleton-shimmer');
    if (on && !mf.skelOpen) mf.skelOpen = { from: performance.now(), fromFrame: mf.frame };
    if (!on && mf.skelOpen) { mf.skel.push({ from: mf.skelOpen.from, to: performance.now(), frames: mf.frame - mf.skelOpen.fromFrame }); mf.skelOpen = null; }
  }
  var mo = new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'childList') {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'IMG') addImg(n);
          if (n.querySelectorAll) n.querySelectorAll('img').forEach(addImg);
          if (n.matches && n.matches(TEXT_SEL)) addText(n);
          if (n.querySelectorAll) n.querySelectorAll(TEXT_SEL).forEach(addText);
        });
      } else if (m.type === 'attributes' && m.target.tagName === 'IMG') {
        var rec = m.target.__mf;
        if (!rec) { addImg(m.target); rec = m.target.__mf; }
        if (!rec || rec.rev !== null) continue;
        var c = m.target.classList;
        if ((rec.shim && !c.contains('art-shimmer')) || (rec.maa && c.contains('is-loaded'))) { rec.rev = performance.now(); rec.revFrame = mf.frame; }
      }
    }
    skelCheck();
  });
  function start() { mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src'] }); document.querySelectorAll('img').forEach(addImg); skelCheck(); }
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  mf.reset = function () {
    mf.t0 = performance.now(); mf.frameAtT0 = mf.frame;
    mf.imgs = mf.imgs.filter(function (x) { return x.el.isConnected; }).map(function (x) { x.stale = true; return x; });
    mf.texts = mf.texts.filter(function (x) { return x.el.isConnected; }).map(function (x) { x.stale = true; return x; });
    mf.shifts = []; mf.skel = []; mf.skelOpen = document.querySelector('#music-content .skeleton-shimmer') ? { from: mf.t0, fromFrame: mf.frame } : null;
    return mf.t0;
  };
  function inView(el) {
    if (!el.isConnected) return false;
    var b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) return false;
    if (b.bottom <= 0 || b.right <= 0 || b.top >= innerHeight || b.left >= innerWidth) return false;
    var st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none') return false;
    // clipped by a scrolling ancestor (a horizontal shelf row)?
    for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      var ps = getComputedStyle(p);
      if (ps.overflowX !== 'visible' || ps.overflowY !== 'visible') {
        var pb = p.getBoundingClientRect();
        if (b.right <= pb.left || b.left >= pb.right || b.bottom <= pb.top || b.top >= pb.bottom) return false;
      }
      if (ps.display === 'none') return false;
    }
    return true;
  }
  mf.pending = function (scopeSel) {
    var scope = scopeSel ? document.querySelector(scopeSel) : document;
    if (!scope) return { scope: false };
    var imgs = Array.prototype.filter.call(scope.querySelectorAll('img'), function (i) { return i.__mf && inView(i); });
    var all = Array.prototype.filter.call(scope.querySelectorAll('img'), function (i) { return i.__mf; });
    return { scope: true, total: all.length, pendingAll: all.filter(function (i) { return i.__mf.rev === null; }).length, skel: !!document.querySelector('#music-content .skeleton-shimmer'), inView: imgs.length,
      pending: imgs.filter(function (i) { return i.__mf.rev === null; }).length };
  };
  mf.report = function () {
    var t0 = mf.t0;
    var dpr = window.devicePixelRatio || 1;
    var recs = mf.imgs.filter(function (x) { return x.el.isConnected && !x.stale; }).map(function (x) {
      var b = x.el.getBoundingClientRect();
      var pt = mf.paints[x.id];
      return { id: x.id, src: x.src, cls: x.el.className, inView: inView(x.el),
        ins: x.ins - t0, rev: x.rev === null ? null : x.rev - t0, load: x.load === null ? null : x.load - t0,
        paint: pt === undefined ? null : pt - t0, insFrame: x.insFrame - mf.frameAtT0, revFrame: x.revFrame === null ? null : x.revFrame - mf.frameAtT0,
        shim: x.shim, nat: [x.el.naturalWidth, x.el.naturalHeight], box: [Math.round(b.width), Math.round(b.height)],
        complete: x.el.complete, lazy: x.el.loading };
    });
    var rt = performance.getEntriesByType('resource').filter(function (e) { return /\\/(albumart|thumbnail)\\//.test(e.name) && e.startTime >= t0 - 1; })
      .map(function (e) { return { url: e.name.replace(location.origin, ''), start: e.startTime - t0, end: e.responseEnd - t0, transfer: e.transferSize, body: e.encodedBodySize, decoded: e.decodedBodySize }; });
    var skel = mf.skel.slice(); if (mf.skelOpen) skel.push({ from: mf.skelOpen.from, to: performance.now(), frames: mf.frame - mf.skelOpen.fromFrame, open: true });
    var tp = mf.texts.filter(function (x) { return !x.stale && x.el.isConnected && inView(x.el) && mf.paints[x.id] !== undefined; }).map(function (x) { return mf.paints[x.id] - t0; });
    return JSON.stringify({ textPaint: tp.length ? { n: tp.length, first: Math.min.apply(null, tp), last: Math.max.apply(null, tp) } : null, fcp: mf.fcp, t0: t0, frames: mf.frame - mf.frameAtT0, dpr: dpr, vw: innerWidth, vh: innerHeight,
      shifts: mf.shifts.filter(function (s) { return s.t >= t0 - 1; }).map(function (s) { s.t -= t0; return s; }),
      imgs: recs, rt: rt, skel: skel.map(function (s) { return { from: s.from - t0, to: s.to - t0, frames: s.frames, open: !!s.open }; }) });
  };
})();`;

function stats(arr) {
  const v = arr.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return { n: v.length, first: Math.round(v[0]), last: Math.round(v[v.length - 1]), spread: Math.round(v[v.length - 1] - v[0]),
    buckets16: new Set(v.map((x) => Math.floor(x / 16))).size };
}

function summarize(rep, net, label) {
  const imgs = rep.imgs;
  const inView = imgs.filter((i) => i.inView);
  const shiftsAfter = rep.shifts;
  const cls = shiftsAfter.reduce((a, s) => a + s.v, 0);
  const clsNoInput = shiftsAfter.filter((s) => !s.input).reduce((a, s) => a + s.v, 0);
  const revIn = stats(inView.map((i) => i.rev));
  const revAll = stats(imgs.map((i) => i.rev));
  const paintIn = stats(inView.map((i) => i.paint));
  if (revIn) revIn.rafFrames = new Set(inView.filter((i) => i.revFrame !== null).map((i) => i.revFrame)).size;
  if (paintIn) paintIn.distinctFrames = new Set(inView.filter((i) => i.paint !== null).map((i) => Math.round(i.paint * 10))).size;
  const lag = inView.filter((i) => i.rev !== null && i.paint !== null).map((i) => i.paint - i.rev).sort((a, b) => a - b);
  const revealToPaint = lag.length ? { median: Math.round(lag[Math.floor(lag.length / 2)]), max: Math.round(lag[lag.length - 1]) } : null;
  const shimmered = inView.filter((i) => i.shim && i.revFrame !== null && i.revFrame > i.insFrame).length;
  const neverRevealed = inView.filter((i) => i.rev === null).length;
  // image cost: natural vs box, per distinct URL; network source per URL.
  const byUrl = new Map();
  for (const i of imgs) {
    const u = i.src;
    if (!byUrl.has(u)) byUrl.set(u, { url: u, nat: i.nat, box: i.box, count: 0, inView: 0 });
    const e = byUrl.get(u); e.count++; if (i.inView) e.inView++;
  }
  const netByUrl = new Map();
  for (const n of net) { const u = n.url; if (!netByUrl.has(u)) netByUrl.set(u, []); netByUrl.get(u).push(n); }
  let bytes = 0; let reqNet = 0; let reqDisk = 0; let reqMem = 0; let reqNotModified = 0;
  for (const n of net) {
    bytes += n.bytes || 0;
    if (n.fromMemory) reqMem++; else if (n.fromDisk) reqDisk++; else if (n.status === 304) reqNotModified++; else reqNet++;
  }
  const urlsNoRequest = [...byUrl.keys()].filter((u) => !netByUrl.has(u)).length;
  const natPx = [...byUrl.values()].filter((e) => e.nat[0] > 0 && e.box[0] > 0);
  const ratio = natPx.map((e) => (e.nat[0] * e.nat[1]) / (e.box[0] * e.box[1] * rep.dpr * rep.dpr));
  const natSizes = [...new Set(natPx.map((e) => `${e.nat[0]}x${e.nat[1]}`))];
  const boxSizes = [...new Set(natPx.map((e) => `${e.box[0]}x${e.box[1]}`))];
  const skelMs = rep.skel.reduce((a, s) => a + Math.max(0, s.to - Math.max(0, s.from)), 0);
  const skelFrames = rep.skel.reduce((a, s) => a + s.frames, 0);
  // the moving elements: selectors aggregated over every shift source
  const movers = new Map();
  for (const s of shiftsAfter.filter((x) => x.v > 0)) for (const src of s.src) {
    const k = src.sel; const m = movers.get(k) || { sel: k, n: 0, v: 0, dy: [] };
    m.n++; m.v += s.v; if (src.prev && src.cur) m.dy.push(src.cur[1] - src.prev[1]); movers.set(k, m);
  }
  return {
    label, fcp: rep.fcp === null ? null : Math.round(rep.fcp),
    textPaint: rep.textPaint ? { n: rep.textPaint.n, first: Math.round(rep.textPaint.first), last: Math.round(rep.textPaint.last) } : null,
    cls: Math.round(cls * 10000) / 10000, clsNoInput: Math.round(clsNoInput * 10000) / 10000, shiftCount: shiftsAfter.length,
    imgs: imgs.length, inView: inView.length, shimmeredInView: shimmered, neverRevealedInView: neverRevealed,
    revealInView: revIn, revealAll: revAll, paintInView: paintIn, revealToPaint,
    skeleton: { ms: Math.round(skelMs), frames: skelFrames },
    cost: { distinctUrls: byUrl.size, natSizes, boxSizes, decodePxOverDevicePx: ratio.length ? { min: Math.round(Math.min(...ratio) * 10) / 10, max: Math.round(Math.max(...ratio) * 10) / 10 } : null,
      requests: net.length, net: reqNet, disk: reqDisk, memory: reqMem, notModified: reqNotModified, urlsWithNoRequest: urlsNoRequest, bytes },
    movers: [...movers.values()].sort((a, b) => b.v - a.v).slice(0, 8).map((m) => ({ sel: m.sel, n: m.n, v: Math.round(m.v * 10000) / 10000, dy: [...new Set(m.dy)].slice(0, 6) })),
  };
}

async function main() {
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chromium found (set CHROME=<binary> or install the Playwright chromium)');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-music-fouc-'));
  const DATA_DIR = process.env.DATA_DIR;
  const server0 = require(path.join(ROOT, 'server'));
  const { app, saveDatabase, updateDatabase, musicDb, __mintTestSession, getMediaId } = server0;
  const musicStore = require(path.join(ROOT, 'lib', 'music', 'store'));
  fs.mkdirSync(OUT, { recursive: true });

  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cookie } = __mintTestSession();
  const [cname, cvalue] = cookie.split(';')[0].split('=');

  let chrome = null; let profile = null;
  const killChrome = () => { try { if (chrome) chrome.kill('SIGKILL'); } catch (_) { /* gone */ } chrome = null; };
  const cleanup = () => { killChrome(); server.close(); };
  process.on('exit', cleanup);

  async function launch() {
    killChrome();
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-music-fouc-chrome-'));
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
    const listeners = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method) for (const l of listeners) l(m);
    };
    const send = (method, params) => new Promise((resolve, reject) => {
      const i = ++id;
      const t = setTimeout(() => { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)); }, 60000);
      pending.set(i, (m) => { clearTimeout(t); if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result); });
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    return { ws, send, listeners };
  }

  // ---- 1. generate the art in Chromium, seed the library ----
  let cdp = await launch();
  const evaluate0 = async (expression) => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  const artDir = path.join(DATA_DIR, '.albumart');
  const thumbDir = path.join(DATA_DIR, '.thumbnails');
  fs.mkdirSync(artDir, { recursive: true });
  fs.mkdirSync(thumbDir, { recursive: true });
  const libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-music-fouc-lib-'));
  const wav = silentWav();
  const wavMaster = path.join(libRoot, '.master.wav');
  fs.writeFileSync(wavMaster, wav);
  const putWav = (fp) => { try { fs.linkSync(wavMaster, fp); } catch (_) { fs.copyFileSync(wavMaster, fp); } };
  const tracks = {};
  const artSizes = [];
  let albumIdx = 0;
  const now = Date.now();
  for (let a = 0; a < ARTISTS.length; a++) {
    for (let b = 0; b < 2; b++) {
      const album = ALBUM_NAMES[a][b];
      const big = albumIdx % 2 === 0;
      const dim = ART_PX || (big ? 1200 : 600);
      const hi = big ? 400000 : 170000;
      const jpg = Buffer.from(await evaluate0(JPEG_JS(dim, dim, 1000 + albumIdx * 7919, hi)), 'base64');
      let key = null;
      for (let t = 0; t < 4; t++) {
        const dir = path.join(libRoot, ARTISTS[a], album);
        fs.mkdirSync(dir, { recursive: true });
        const fp = path.join(dir, `${String(t + 1).padStart(2, '0')} Track ${t + 1}.wav`);
        putWav(fp);
        const meta = { title: `${album} ${t + 1}`, artist: ARTISTS[a], album, albumArtist: ARTISTS[a], trackNo: t + 1, discNo: 1, year: 2010 + albumIdx };
        const id = getMediaId(fp);
        key = crypto.createHash('md5').update(musicStore.albumKeyFor(meta)).digest('hex');
        tracks[id] = Object.assign({ id, filePath: fp, rootFolder: libRoot, folderName: album, size: wav.length, mtimeMs: now,
          ext: '.wav', addedAt: new Date(now - (albumIdx * 4 + t) * 3600e3).toISOString(), albumArtKey: key, durationSec: 200 + t * 17,
          codec: null, hasEmbeddedArt: true, genre: null }, meta);
      }
      fs.writeFileSync(path.join(artDir, `${key}.jpg`), jpg);
      artSizes.push(`${album} ${dim}x${dim} ${Math.round(jpg.length / 1024)}KB`);
      albumIdx++;
    }
  }
  // 3 yt-dlp library-audio items (art via the /albumart -> /thumbnail fallback), 1280x720.
  const metadata = {};
  for (let k = 0; k < 3; k++) {
    const fp = path.join(libRoot, 'yt', `single-${k}.mp3`);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    putWav(fp);
    const id = getMediaId(fp);
    const jpg = Buffer.from(await evaluate0(JPEG_JS(ART_PX || 1280, ART_PX ? Math.round(ART_PX * 9 / 16) : 720, 5000 + k * 31, 200000)), 'base64');
    fs.writeFileSync(path.join(thumbDir, `${id}.jpg`), jpg);
    artSizes.push(`library-audio ${k} ${ART_PX || 1280}w ${Math.round(jpg.length / 1024)}KB (thumbnail)`);
    metadata[id] = { id, title: `Tube Single ${k + 1}`, type: 'audio', ext: '.mp3', filePath: fp, folderName: 'TubeChannel', channelName: 'Tube Channel',
      size: wav.length, addedAt: now - k * 60e3, duration: 180, hasThumbnail: true, tags: { genre: 'Music' } };
  }
  saveDatabase({ metadata });
  // db.music is a feature store (not a top-level saveDatabase key): the music-api test's seam.
  await updateDatabase(() => musicDb.mutate((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.folders = [libRoot]; ns.tracks = tracks;
    return true;
  }));
  console.error(`seeded ${Object.keys(tracks).length} tracks / ${albumIdx} albums / ${ARTISTS.length} artists + ${Object.keys(metadata).length} library-audio items`);
  console.error(`art: ${artSizes.join('; ')}`);
  cdp.ws.close();

  // A listening history (one saved position per artist + one more), RE-POSTED at the start of
  // every viewport pass so "Jump back in" / "Recently played" have the same membership and
  // order at every viewport (the probe's own Now playing tap also writes progress).
  const historyIds = [];
  { const seen = new Set(); for (const t of Object.values(tracks)) { if (!seen.has(t.artist)) { seen.add(t.artist); historyIds.push(t.id); } } }
  historyIds.push(Object.values(tracks).find((t) => t.trackNo === 3).id);
  const seedHistory = async () => {
    for (const id of historyIds.slice().reverse()) {
      const r = await fetch(`${base}/api/music/progress`, { method: 'POST', headers: { Cookie: cookie.split(';')[0], 'Content-Type': 'application/json' }, body: JSON.stringify({ id, position: 42, duration: 200 }) });
      if (!r.ok) console.error(`history seed POST failed: ${r.status} ${await r.text()}`);
      await sleep(5);
    }
  };

  const results = [];
  for (const vp of VIEWPORTS) {
    await seedHistory();
    const vpl = `${vp.w}x${vp.h}@${vp.dpr}`;
    cdp = await launch(); // a FRESH profile per viewport
    const { send, listeners } = cdp;
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
      try { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, file), Buffer.from(s.data, 'base64')); } catch (err) { console.error(`screenshot ${file} skipped (${err.message})`); }
    };
    // network log for art requests
    let net = [];
    const reqs = new Map();
    listeners.push((m) => {
      const p = m.params || {};
      if (m.method === 'Network.requestWillBeSent') {
        const u = p.request.url.replace(base, '');
        if (/\/(albumart|thumbnail)\//.test(u)) { const e = { url: u, t: p.timestamp, fromDisk: false, fromMemory: false, status: null, bytes: 0 }; reqs.set(p.requestId, e); net.push(e); }
      } else if (m.method === 'Network.requestServedFromCache') {
        const e = reqs.get(p.requestId); if (e) e.fromMemory = true;
      } else if (m.method === 'Network.responseReceived') {
        const e = reqs.get(p.requestId); if (e) { e.status = p.response.status; if (p.response.fromDiskCache) e.fromDisk = true; }
      } else if (m.method === 'Network.loadingFinished') {
        const e = reqs.get(p.requestId); if (e) e.bytes = p.encodedDataLength;
      }
    });
    await send('Network.enable');
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.setCookie', { name: cname, value: cvalue, url: base });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVER_JS });
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
    if (vp.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const throttle = vp.mobile ? MOBILE_THROTTLE : 1;
    if (throttle > 1) await send('Emulation.setCPUThrottlingRate', { rate: throttle });
    if (NET) await send('Network.emulateNetworkConditions', { offline: false, latency: NET[1], downloadThroughput: NET[0] * 125000, uploadThroughput: NET[0] * 125000 / 4 });

    // warm-up load (establishes the origin for localStorage), then measure.
    await send('Page.navigate', { url: `${base}/music.html` });
    await waitFor("!!(window.__mf && document.querySelector('#music-content'))", 'the music view');
    await sleep(1500);

    const contentReady = "(function(){var p=window.__mf&&window.__mf.pending('#music-content'); return !!(p&&p.scope&&!p.skel&&p.inView>0&&p.pending===0);})()";
    const settleAndReport = async (readyExpr, label, file) => {
      const ok = await waitFor(readyExpr, `${label} ready`, 30000);
      await sleep(throttle > 1 ? 2500 : 1200); // late shifts (panel growth, queue scroll, sticky)
      const rep = JSON.parse(await evaluate('window.__mf.report()'));
      const s = summarize(rep, net, label);
      s.ready = ok;
      s.vp = vpl; s.throttle = throttle; s.net = NET ? `${NET[0]}Mbps/${NET[1]}ms` : 'localhost';
      fs.writeFileSync(path.join(OUT, `${file}.json`), JSON.stringify({ summary: s, report: rep, net }, null, 1));
      await shot(`${file}.png`);
      console.log(JSON.stringify(s));
      results.push(s);
      return s;
    };
    const startMeasure = async () => { net = []; reqs.clear(); await evaluate('window.__mf.reset()'); };
    const coldLoad = async (tab) => {
      await evaluate(`localStorage.setItem('filetube_music_tab', ${JSON.stringify(tab)}); true`);
      await send('Page.navigate', { url: 'about:blank' });
      await sleep(300);
      await send('Network.clearBrowserCache');
      net = []; reqs.clear();
      await send('Page.navigate', { url: `${base}/music.html` });
      await waitFor('!!window.__mf', 'observer injected');
      // t0 = navigation start for a cold load (performance.now() origin): reset without
      // dropping the buffered entries - set t0 to 0.
      await evaluate('(function(){window.__mf.t0=0;window.__mf.frameAtT0=0;return true;})()');
    };
    const spaRoundTrip = async () => {
      await evaluate("window.FileTube.navigate('/'); true");
      await waitFor("location.pathname === '/' && !document.querySelector('#music-content')", 'the SPA swap to /');
      await sleep(1500);
      await startMeasure();
      await evaluate("window.FileTube.navigate('/music.html'); true");
    };
    const clickTab = async (tab) => evaluate(`(function(){var b=document.querySelector('.music-tab[data-tab="${tab}"]'); if(!b) return false; b.click(); return true;})()`);

    for (const tab of ['home', 'albums', 'artists', 'songs']) {
      if (!SURFACES.includes(tab)) continue;
      await coldLoad(tab);
      await settleAndReport(contentReady, `${tab} cold`, `${vpl}-${tab}-cold`);
      await spaRoundTrip();
      await settleAndReport(contentReady, `${tab} warm-spa`, `${vpl}-${tab}-warm-spa`);
      const other = tab === 'albums' ? 'songs' : 'albums';
      await clickTab(other);
      await waitFor(contentReady, `${other} tab`, 20000);
      await sleep(800);
      await startMeasure();
      await clickTab(tab);
      await settleAndReport(contentReady, `${tab} warm-tab`, `${vpl}-${tab}-warm-tab`);
    }

    const drillReady = "(function(){var d=document.querySelector('.music-drill-header'); if(!d) return false; var p=window.__mf.pending('#music-content'); return !!(p.scope&&p.inView>0&&p.pending===0);})()";
    for (const [surf, tab, cardSel] of [['album-drill', 'albums', '.music-album-card[data-album-key]'], ['artist-drill', 'artists', '.music-artist-card[data-artist]']]) {
      if (!SURFACES.includes(surf)) continue;
      await coldLoad(tab);
      await waitFor(contentReady, `${tab} grid`, 30000);
      await sleep(800);
      await startMeasure();
      // the 3rd card: past the first, still on the first screen at both widths
      const clicked = await evaluate(`(function(){var c=document.querySelectorAll('#music-content ${cardSel}'); var el=c[2]||c[0]; if(!el) return false; el.click(); return true;})()`);
      if (!clicked) { console.error(`FAIL [${vpl}] ${surf}: no ${cardSel} to click`); continue; }
      await settleAndReport(drillReady, `${surf} cold`, `${vpl}-${surf}-cold`);
      await evaluate('history.back(); true');
      await waitFor(`!document.querySelector('.music-drill-header') && !!document.querySelector('#music-content ${cardSel}')`, 'back to the grid');
      await waitFor(contentReady, `${tab} grid again`, 20000);
      await sleep(800);
      await startMeasure();
      await evaluate(`(function(){var c=document.querySelectorAll('#music-content ${cardSel}'); var el=c[2]||c[0]; el.click(); return true;})()`);
      await settleAndReport(drillReady, `${surf} warm`, `${vpl}-${surf}-warm`);
    }

    if (SURFACES.includes('nowplaying')) {
      await coldLoad('songs');
      await waitFor(contentReady, 'songs list', 30000);
      await sleep(800);
      await startMeasure();
      await evaluate("(function(){var r=document.querySelector('#music-content .music-song-row[data-index=\"4\"] .music-song-title')||document.querySelector('#music-content .music-song-row .music-song-title'); r.click(); return true;})()");
      const npReady = "(function(){var p=document.getElementById('music-nowplaying-panel'); if(!p||p.hidden) return false; var q=window.__mf.pending('#music-nowplaying-panel'); return !!(q.scope&&q.total>0&&q.pendingAll===0);})()";
      const cold = await settleAndReport(npReady, 'nowplaying cold', `${vpl}-nowplaying-cold`);
      const state = await evaluate("JSON.stringify({ mmsOn: document.body.classList.contains('mms-on'), panelClass: (document.getElementById('music-nowplaying-panel')||{}).className, panelHidden: (document.getElementById('music-nowplaying-panel')||{}).hidden, player: (window.FileTube&&window.FileTube.player&&window.FileTube.player.getState&&window.FileTube.player.getState()) })");
      console.error(`[${vpl}] nowplaying state after tap: ${state} (cold ready=${cold.ready})`);
      // WARM: SPA away to / (the player DOCKS) and back, then tap the dock to re-expand -
      // the "return to Now playing" path; every queue thumb was fetched by the cold pass.
      await evaluate("window.FileTube.navigate('/'); true");
      await waitFor("location.pathname === '/' && !document.querySelector('#music-content')", 'the SPA swap to /');
      await sleep(1500);
      await evaluate("window.FileTube.navigate('/music.html'); true");
      await waitFor(contentReady, 'music view back', 30000);
      await sleep(1500);
      const dockState = await evaluate("JSON.stringify({ player: window.FileTube.player.getState(), dock: !!document.getElementById('player-dock'), dockVisible: (function(){var d=document.getElementById('player-dock'); return !!(d && d.getBoundingClientRect().height > 0);})(), panelHidden: (document.getElementById('music-nowplaying-panel')||{}).hidden })");
      console.error(`[${vpl}] after the SPA round trip: ${dockState}`);
      await startMeasure();
      await evaluate("(function(){ if (window.FileTube.player.getState() === 'full') return 'already-full'; var d=document.getElementById('player-dock'); if (d) { d.click(); return 'dock-click'; } return 'no-dock'; })()");
      await settleAndReport(npReady, 'nowplaying warm-expand', `${vpl}-nowplaying-warm-expand`);
    }
    cdp.ws.close();
  }

  // ---- compact table ----
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + ['viewport', 'surface/mode', 'CLS', 'shifts', 'imgs(inView)', 'shimmered', 'reveal first/last/spread ms', 'rafFrames', 'all-imgs reveal n/spread', 'text paint first', 'img paint first/spread/frames', 'reveal->paint med/max', 'skeleton ms/frames', 'req net/disk/mem/none', 'KB'].join(' | '));
  for (const s of results) {
    const r = s.revealInView; const p = s.paintInView;
    console.log([pad(s.vp, 12), pad(s.label, 22), s.cls, s.shiftCount, `${s.imgs}(${s.inView})`, s.shimmeredInView,
      r ? `${r.first}/${r.last}/${r.spread}` : '-', r ? r.rafFrames : '-', s.revealAll ? `${s.revealAll.n}/${s.revealAll.spread}` : '-', s.textPaint ? s.textPaint.first : '-', p ? `${p.first}/${p.spread}/${p.distinctFrames}` : '-', s.revealToPaint ? `${s.revealToPaint.median}/${s.revealToPaint.max}` : '-', `${s.skeleton.ms}/${s.skeleton.frames}`,
      `${s.cost.net}/${s.cost.disk}/${s.cost.memory}/${s.cost.urlsWithNoRequest}`, Math.round(s.cost.bytes / 1024)].join(' | '));
  }
}

main().then(() => process.exit(0), (err) => { console.error(err && err.stack ? err.stack : err); process.exit(1); });
