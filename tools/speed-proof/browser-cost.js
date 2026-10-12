'use strict';
/* global document, window, location, MutationObserver */
// v1.386.0 W1/W4: the two frictions Dean reported, timed in real engines (Playwright Chromium + WebKit) against
// a library the size of his, through a latency proxy that models the network (home LAN, and the VPN).
//   (a) opening the music library (/music on a phone), cold (empty cache) and warm (a second visit): requests
//       by status, bytes over the wire, when the Home shelves are drawn, and when the page is last blocked
//       (a 10 ms timer loop records every main-thread gap over 50 ms; "quiet" = the end of the last one);
//   (b) picking the Transparent Coil in the Pocket sticker menu's Skin page, cold and warm: how long after the
//       tap its board and ring photos arrive (resource timing), sampled with what the player shows at +50 ms.
// Prints one JSON line per (engine, network, scenario).
//   node tools/speed-proof/browser-cost.js [chromium,webkit] [home,vpn] [tracks]
const path = require('node:path');
const { startProxy } = require('./latency-proxy');
const { chromium, webkit } = require(path.join(__dirname, '..', 'capture', 'node_modules', 'playwright'));

const NETS = { home: { oneWayMs: 2, mbps: 300 }, vpn: { oneWayMs: 40, mbps: 20 } };
const ENGINES = { chromium, webkit };
const COIL = 'ipod-custom5-transparent-coil';

const GAP_PROBE = `(() => {
  const gaps = []; let last = performance.now();
  window.__ftGaps = gaps;
  (function tick() { const now = performance.now(); if (now - last > 50) gaps.push([Math.round(last), Math.round(now)]); last = now; setTimeout(tick, 10); })();
})();`;

async function musicOpen(ctx, base, proxy, label) {
  const page = await ctx.newPage();
  const byStatus = {}; let reqs = 0; const apiTimes = [];
  const list = [];
  page.on('response', (r) => { reqs++; byStatus[r.status()] = (byStatus[r.status()] || 0) + 1; });
  page.on('requestfinished', async (q) => { try { const z = await q.sizes(); const t = q.timing(); const resp = await q.response(); list.push([Math.round(t.startTime - t0), Math.round(t.responseEnd), resp ? resp.status() : 0, z.responseBodySize, q.url().replace(base, '')]); } catch { /* gone */ } });
  page.on('requestfinished', (q) => { if (q.url().includes('/api/music')) { const t = q.timing(); apiTimes.push(Math.round(t.responseEnd)); } });
  proxy.reset();
  const t0 = Date.now();
  await page.goto(base + '/music', { waitUntil: 'domcontentloaded' });
  const dcl = Date.now() - t0;
  // the Home shelves drawn from DATA (the cold-landing skeleton has the same .music-home shell but no shelf
  // titles): "Recently added" is the albums shelf, present once the library calls have answered
  await page.waitForFunction(() => { const h = document.querySelector('#music-content .music-home'); return !!(h && /Recently added/.test(h.textContent)); }, null, { timeout: 120000 });
  const shelves = Date.now() - t0;
  await page.waitForTimeout(3000); // let late work land, then read the gap record
  const r = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return { gaps: window.__ftGaps.slice(), navStart: nav ? nav.startTime : 0, res: performance.getEntriesByType('resource').length };
  });
  const blocked = r.gaps.reduce((s, g) => s + (g[1] - g[0]), 0);
  const lastGapEnd = r.gaps.length ? r.gaps[r.gaps.length - 1][1] : 0;
  const out = { scenario: 'music-open', label, dclMs: dcl, shelvesMs: shelves, quietMs: lastGapEnd, blockedMs: blocked, longestGapMs: r.gaps.reduce((m, g) => Math.max(m, g[1] - g[0]), 0),
    requests: reqs, byStatus, wireDownBytes: proxy.stats().downBytes, conns: proxy.stats().conns };
  if (process.env.SPEED_LIST) out.list = list;
  await page.close();
  return out;
}

async function skinPick(ctx, base, proxy, label, reload) {
  const page = await ctx.newPage();
  await page.goto(base + '/music', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.setItem('ft-music-skin', 'ipod'); localStorage.removeItem('ft-tray-mode'); });
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) { // the ?play= open is occasionally lost on a cold engine: one reload
    await page.goto(base + '/music?play=nd1', { waitUntil: 'domcontentloaded' });
    opened = await page.waitForSelector('#music-nowplaying-panel.mms-full [data-skin-sticker]', { state: 'attached', timeout: 30000 }).then(() => true, () => false);
  }
  try {
    if (!opened) throw new Error('not opened');
  } catch {
    if (process.env.SPEED_SHOT) await page.screenshot({ path: process.env.SPEED_SHOT });
    const st = await page.evaluate(() => ({ html: document.documentElement.className, panel: (document.getElementById('music-nowplaying-panel') || {}).className, url: location.href })).catch(() => null);
    throw new Error('the full player never opened: ' + JSON.stringify(st));
  }
  await page.waitForTimeout(1500);
  const jsClick = (sel) => page.evaluate((q) => { document.querySelector(q).click(); }, sel);
  let skinsPageOpenMs = null;
  const openSkins = async () => {
    await jsClick('#music-nowplaying-panel [data-skin-sticker]');
    await page.waitForSelector('#music-nowplaying-panel [data-skin-sticker-menu] [data-skin-skins]', { state: 'attached', timeout: 10000 });
    // the Skin page's open is timed as the click's own synchronous work (gate r1 adversary: a first draft stalled
    // the page here for ~0.5 s in WebKit and nothing measured it)
    skinsPageOpenMs = await page.evaluate((q) => { const t = performance.now(); document.querySelector(q).click(); return Math.round(performance.now() - t); }, '#music-nowplaying-panel [data-skin-sticker-menu] [data-skin-skins]');
    await page.waitForSelector('#music-nowplaying-panel [data-skin-pick="' + COIL + '"]', { state: 'attached', timeout: 10000 });
  };
  await openSkins();
  proxy.reset();
  const tSkinsOpen = await page.evaluate(() => performance.now());
  await page.waitForTimeout(reload === 'idle' ? 2000 : 0);
  // when the Coil's class lands on the panel (the moment its look is painted): before v1.386.0 at the tap, after it
  // once the photos are decoded. placeholderMs = how long the panel showed the Coil WITHOUT its photos.
  await page.evaluate((id) => {
    window.__coilAt = null;
    const p = document.getElementById('music-nowplaying-panel');
    const mo = new MutationObserver(() => { if (window.__coilAt === null && p.classList.contains('mms-' + id)) window.__coilAt = performance.now(); });
    mo.observe(p, { attributes: true, attributeFilter: ['class'] });
  }, COIL);
  const tClick = await page.evaluate((id) => { const t = performance.now(); document.querySelector('#music-nowplaying-panel [data-skin-pick="' + id + '"]').click(); return t; }, COIL);
  // what the player shows 50 ms after the tap: the computed background of the board layer, and whether its photo
  // has arrived (resource timing) by then
  await page.waitForTimeout(50);
  const at50 = await page.evaluate(() => {
    const e = performance.getEntriesByType('resource').filter((x) => /transparent-(board|ring)/.test(x.name));
    return { now: performance.now(), arrived: e.map((x) => [x.name.split('/').pop(), Math.round(x.responseEnd)]) };
  });
  await page.waitForFunction(() => performance.getEntriesByType('resource').filter((x) => /transparent-board\.webp|transparent-ring\.webp/.test(x.name)).length >= 2, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  const ent = await page.evaluate(() => performance.getEntriesByType('resource').filter((x) => /transparent-(board|ring)/.test(x.name)).map((x) => ({ f: x.name.split('/').pop(), start: Math.round(x.startTime), end: Math.round(x.responseEnd), bytes: x.transferSize, enc: x.encodedBodySize })));
  const arriveAfterTap = ent.length ? Math.max(...ent.map((x) => x.end)) - Math.round(tClick) : null;
  const coilAt = await page.evaluate(() => window.__coilAt);
  const photosEnd = ent.length ? Math.max(...ent.map((x) => x.end)) : null;
  const out = { scenario: 'skin-pick', label, skinsPageOpenMs, skinsPageOpenToTapMs: Math.round(tClick - tSkinsOpen), photos: ent, photosArriveAfterTapMs: arriveAfterTap,
    tapToCoilShownMs: coilAt === null ? null : Math.round(coilAt - tClick),
    placeholderMs: (coilAt === null || photosEnd === null) ? null : Math.max(0, Math.round(photosEnd - coilAt)),
    arrivedBy50ms: at50.arrived.filter((a) => a[1] <= at50.now).length, wireDownBytes: proxy.stats().downBytes };
  await page.close();
  return out;
}

function spawnServer(tracks, reqLog) {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [path.join(__dirname, 'serve.js')].concat(tracks ? [String(tracks)] : []), { env: Object.assign({}, process.env, { SPEED_REQLOG: reqLog }), stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n')) {
        if (!line.startsWith('{"base"')) continue; // the server's own boot log lines share stdout
        const info = JSON.parse(line); info.kill = () => child.kill('SIGKILL'); resolve(info); return;
      }
    });
    child.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
}
const median = (xs) => { const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };

async function main() {
  const fs = require('node:fs');
  const os = require('node:os');
  const engines = (process.argv[2] || 'chromium,webkit').split(',');
  const nets = (process.argv[3] || 'home,vpn').split(',');
  const reps = Number(process.env.SPEED_REPS || 3);
  const reqLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-speed-reqlog-')), 'req.jsonl');
  fs.writeFileSync(reqLog, '');
  let s = await spawnServer(process.argv[4] ? Number(process.argv[4]) : undefined, reqLog);
  const serverMs = (from, re) => fs.readFileSync(reqLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r[0] >= from && re.test(r[3]));
  console.log(JSON.stringify({ library: { tracks: s.tracks, albums: s.albums }, reps }));
  // wait until the server has finished the previous scenario's requests (1.5 s with none completing), so one
  // scenario's queued work (covers, stations) never lands in the next one's numbers
  const drain = async () => {
    let last = -1;
    for (let i = 0; i < 120; i++) {
      const n = fs.readFileSync(reqLog, 'utf8').length;
      if (n === last) return;
      last = n;
      await new Promise((r) => setTimeout(r, 1500));
    }
  };
  let first = true;
  for (const eng of engines) {
    for (const net of nets) {
      // a fresh server (and library) per cell: one cell's plays never shape the next cell's landing
      if (!first) { s.kill(); s = await spawnServer(process.argv[4] ? Number(process.argv[4]) : undefined, reqLog); }
      first = false;
      const proxy = await startProxy(Object.assign({ target: s.port }, NETS[net]));
      const base = 'http://127.0.0.1:' + proxy.port;
      const browser = await ENGINES[eng].launch({ headless: true });
      const mk = async () => {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        await ctx.addCookies([{ name: s.cookie.name, value: s.cookie.value, url: base }]);
        await ctx.addInitScript(GAP_PROBE);
        return ctx;
      };
      const tag = { engine: eng, net, rttMs: NETS[net].oneWayMs * 2, mbps: NETS[net].mbps };
      const runs = { 'music-open cold': [], 'music-open warm': [], 'skin-pick cold': [], 'skin-pick warm': [] };
      for (let i = 0; i < reps && process.env.SPEED_ONLY !== 'skin'; i++) {
        const ctx = await mk();
        for (const label of ['cold', 'warm']) {
          await drain();
          const from = Date.now();
          const r = await musicOpen(ctx, base, proxy, label);
          const api = serverMs(from, /^\/api\/music/);
          r.musicApiCalls = api.length; r.musicApiServerMsSum = Math.round(api.reduce((a, x) => a + x[1], 0));
          const all = serverMs(from, /./);
          r.server200 = all.filter((x) => x[2] === 200).length; r.server304 = all.filter((x) => x[2] === 304).length;
          r.serverMsSum = Math.round(all.reduce((a, x) => a + x[1], 0));
          runs['music-open ' + label].push(r);
        }
        await ctx.close();
      }
      // the skin scenarios play a track, which leaves server-side state (the queue, a resume point) that changes
      // what /music lands on: they run after every music-open rep
      for (let i = 0; i < reps; i++) {
        const ctx = await mk();
        await drain();
        // a rep whose player never opened is recorded as failed (counted in the output), never silently dropped
        const safe = (label) => skinPick(ctx, base, proxy, label).catch((e) => ({ scenario: 'skin-pick', label, failed: String(e.message).slice(0, 200) }));
        runs['skin-pick cold'].push(await safe('cold'));
        await drain();
        runs['skin-pick warm'].push(await safe('warm'));
        await ctx.close();
      }
      for (const [k, rs] of Object.entries(runs)) {
        if (!rs.length) continue;
        const okRuns = rs.filter((r) => !r.failed);
        if (!okRuns.length) { console.log(JSON.stringify(Object.assign({ cell: k }, tag, { failedReps: rs.length, failures: rs.map((r) => r.failed) }))); continue; }
        const keys = Object.keys(okRuns[0]).filter((x) => typeof okRuns[0][x] === 'number');
        const med = {}; keys.forEach((x) => { med[x] = median(okRuns.map((r) => r[x])); });
        console.log(JSON.stringify(Object.assign({ cell: k }, tag, { median: med, reps: okRuns.length, failedReps: rs.length - okRuns.length, byStatus: okRuns.map((r) => r.byStatus).filter(Boolean)[0], photos: okRuns[0].photos, list: process.env.SPEED_LIST ? okRuns[0].list : undefined })));
      }
      await browser.close();
      await proxy.stop();
    }
  }
  s.kill();
}
main().then(() => process.exit(0), (e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
