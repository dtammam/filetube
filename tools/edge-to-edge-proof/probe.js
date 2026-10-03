'use strict';
/* global window, document, getComputedStyle */
// v1.359 W0: measure the watch-page player against the viewport at phone, near-breakpoint and desktop widths,
// per era, per player mode (native video, custom video, audio), with optional safe-area insets.
//   node tools/edge-to-edge-proof/probe.js <repoRoot> out.json [quick] [labelRegex]
// Not a CI gate: a proof tool (like tools/hold-lock-proof). The ambient glow box is un-hidden in EVERY run so before and
// after compare like for like.
const fs = require('node:fs');
const path = require('node:path');
const REPO = process.argv[2];
const { start } = require('../hold-lock-proof/serve');
const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), path.join(REPO, 'tools/capture'), '/home/coder/projects/filetube/tools/capture'] }));

// A real portrait WebM (the player re-applies the browser's own orientation when it disagrees with stored dims, so a
// landscape file under a portrait row would not stay portrait). Frames are screenshotted like serve.js does.
async function portraitWebm(pw, file) {
  const os = require('node:os');
  const cache = path.join(os.tmpdir(), 'ft-edge-portrait-3.webm');
  if (fs.existsSync(cache)) { fs.copyFileSync(cache, file); return; }
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  const ffbin = fs.readdirSync(root).filter((d) => d.startsWith('ffmpeg-')).sort().reverse().map((d) => path.join(root, d, 'ffmpeg-linux')).find((f) => fs.existsSync(f));
  const br = await pw.chromium.launch();
  const pg = await br.newPage({ viewport: { width: 180, height: 320 } });
  const ff = require('node:child_process').spawn(ffbin, ['-y', '-f', 'image2pipe', '-framerate', '10', '-c:v', 'mjpeg', '-i', 'pipe:0', '-c:v', 'libvpx', '-b:v', '200k', '-g', '10', cache], { stdio: ['pipe', 'ignore', 'inherit'] });
  const done = new Promise((res, rej) => { ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))); });
  await pg.setContent('<body style="margin:0"><div id=d style="width:180px;height:320px"></div></body>');
  for (let f = 0; f < 30; f++) {
    await pg.evaluate((n) => { document.getElementById('d').style.background = 'hsl(' + ((n * 11) % 360) + ',70%,40%)'; }, f);
    const jpg = await pg.screenshot({ type: 'jpeg', quality: 60 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); await done; await br.close();
  fs.copyFileSync(cache, file);
}

const MEASURE = () => {
  const g0 = document.getElementById('ambient-glow'); if (g0) g0.hidden = false;
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), right: +(window.innerWidth - b.right).toFixed(1) }; };
  const cs = (el, props) => { if (!el) return null; const s = getComputedStyle(el); const o = {}; props.forEach((p) => { o[p] = s.getPropertyValue(p); }); return o; };
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px);padding-top:env(safe-area-inset-top,0px)';
  document.body.appendChild(probe);
  const ps = getComputedStyle(probe); const inset = { l: ps.paddingLeft, r: ps.paddingRight, t: ps.paddingTop }; probe.remove();
  const w = document.getElementById('player-wrapper');
  const v = document.getElementById('media-player');
  const art = document.getElementById('audio-bg-art');
  return {
    vw: window.innerWidth, vh: window.innerHeight, scrollW: document.scrollingElement.scrollWidth, inset,
    era: document.documentElement.getAttribute('data-theme'), mode: document.documentElement.getAttribute('data-mode'),
    host: w && w.parentElement && w.parentElement.id,
    wrapperClass: w && w.className,
    main: cs(document.querySelector('.main-content'), ['padding-left', 'padding-right']),
    container: r(document.querySelector('.watch-container')),
    stage: Object.assign({ rect: r(document.querySelector('.watch-player-stage')) }, cs(document.querySelector('.watch-player-stage'), ['margin-left', 'margin-right', 'padding-left', 'padding-right', 'overflow-x'])),
    slot: r(document.getElementById('player-slot')),
    wrapper: Object.assign({ rect: r(w) }, cs(w, ['border-left-width', 'border-right-width', 'border-top-left-radius', 'margin-bottom', 'padding-bottom', 'max-height'])),
    video: r(v), videoObjectFit: v && getComputedStyle(v).objectFit,
    art: art && getComputedStyle(art).display !== 'none' ? r(art) : null,
    controls: r(w && w.querySelector('.player-controls')),
    title: r(document.getElementById('media-title')),
    glow: r(document.getElementById('ambient-glow')),
    slotEmpty: !!(document.getElementById('player-slot') && document.getElementById('player-slot').matches(':empty')),
    slotRadius: document.getElementById('player-slot') && getComputedStyle(document.getElementById('player-slot')).borderTopLeftRadius,
    slotBorder: document.getElementById('player-slot') && getComputedStyle(document.getElementById('player-slot')).borderLeftWidth,
    buttons: w ? Array.from(w.querySelectorAll('button')).filter((b) => b.getClientRects().length).map((b) => { const x = b.getBoundingClientRect(); return { id: b.id || b.className, w: +x.width.toFixed(1), h: +x.height.toFixed(1) }; }) : [],
  };
};

async function one(browser, s, o) {
  const dev = o.mobile ? pw.devices['iPhone 13'] : {};
  const ctx = await browser.newContext(Object.assign({}, dev, { viewport: { width: o.w, height: o.h }, deviceScaleFactor: 1, isMobile: !!o.mobile, hasTouch: !!o.mobile }));
  await ctx.addCookies([s.cookie]);
  await ctx.addInitScript(([era, mode]) => { try { localStorage.setItem('ft-era', era); localStorage.setItem('ft-mode', mode); } catch { /* */ } }, [o.era, o.mode || 'light']);
  await ctx.route('**/api/settings', async (route) => { const res = await route.fetch(); let j = {}; try { j = await res.json(); } catch { /* */ } if (o.custom) j.mobileCustomPlayer = true; await route.fulfill({ response: res, json: j }); });
  if (process.env.CANDIDATE_CSS) { const css = fs.readFileSync(process.env.CANDIDATE_CSS, 'utf8'); await ctx.addInitScript((c) => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.id = '__cand'; st.textContent = c; document.head.appendChild(st); }); }, css); }
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  if (o.inset) { const cdp = await ctx.newCDPSession(p); try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: o.inset }); } catch (e) { errs.push('inset override failed: ' + e.message); } }
  if (o.hold) await p.route('**/api/videos/' + (o.id || 'clip1'), () => { /* never answered: the cold reserved frame stays */ });
  await p.goto(s.base + (o.url || '/watch.html?v=' + (o.id || 'clip1')), { waitUntil: o.hold ? 'domcontentloaded' : 'networkidle' });
  await p.waitForTimeout(o.hold ? 1200 : 900);
  const m = await p.evaluate(MEASURE);
  if (o.id === 'port1') { m.portraitClass = /portrait-media/.test(m.wrapperClass || ''); if (!m.portraitClass) errs.push('VACUOUS: wrapper has no .portrait-media'); }
  if (o.hold) { m.heldSlotEmpty = m.slotEmpty; if (!m.slotEmpty) errs.push('VACUOUS: #player-slot did not match :empty'); }
  let docked = null;
  if (o.dock) {
    await p.evaluate(() => { const a = document.createElement('a'); a.href = '/'; a.id = '__go'; a.textContent = 'x'; document.body.appendChild(a); });
    await p.evaluate(() => document.getElementById('__go').click()); await p.waitForTimeout(1500);
    docked = await p.evaluate(() => { const d = document.getElementById('player-dock'); const b = d && d.getBoundingClientRect(); const wr = document.getElementById('player-wrapper'); return { dockHidden: d && d.hidden, host: wr && wr.parentElement && wr.parentElement.id, rect: b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }; });
  }
  await ctx.close();
  return Object.assign({ case: o.label, w: o.w, h: o.h, errs }, m, docked ? { docked } : {});
}

(async () => {
  const quick = process.argv[4] === 'quick'; const only = process.argv[5] ? new RegExp(process.argv[5]) : null;
  const out = { runAt: new Date().toISOString(), runs: [] };
  const s = await start({ seconds: 20 });
  const pfile = path.join(s.dataDir, 'media', 'Proof', 'port1.webm');
  await portraitWebm(pw, pfile);
  await require('../../server').updateDatabase((db) => { db.metadata.port1 = Object.assign({}, db.metadata.clip1, { id: 'port1', title: 'Proof Portrait', name: 'port1.webm', filePath: pfile, width: 180, height: 320, duration: 3, addedAt: 1788000000002 }); return true; });
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const cases = [];
  const phones = [[320, 568], [360, 740], [390, 844], [430, 932], [600, 960], [768, 1024]];
  const eras = ['2005', '2009', '2014', '2021'];
  for (const [w, h] of phones) for (const era of (quick ? ['2021'] : eras)) cases.push({ label: `phone-native ${w}x${h} ${era}`, w, h, era, mobile: true });
  for (const [w, h] of [[390, 844]]) for (const era of eras) {
    cases.push({ label: `phone-custom ${w}x${h} ${era}`, w, h, era, mobile: true, custom: true });
    cases.push({ label: `phone-audio ${w}x${h} ${era}`, w, h, era, mobile: true, id: 'song1' });
  }
  cases.push({ label: 'phone-custom-dark 390x844 2021', w: 390, h: 844, era: '2021', mode: 'dark', mobile: true, custom: true });
  cases.push({ label: 'phone-dock 390x844 2021', w: 390, h: 844, era: '2021', mobile: true, custom: true, dock: true });
  // landscape phones that stay <=768 wide, with and without a side notch inset
  for (const [w, h] of [[667, 375], [740, 360]]) {
    cases.push({ label: `land ${w}x${h} 2021`, w, h, era: '2021', mobile: true, custom: true });
    cases.push({ label: `land-notch ${w}x${h} 2021 L47`, w, h, era: '2021', mobile: true, custom: true, inset: { top: 0, bottom: 21, left: 47, right: 47 } });
  }
  cases.push({ label: 'portrait-notch 390x844 2021 T47', w: 390, h: 844, era: '2021', mobile: true, custom: true, inset: { top: 47, bottom: 34, left: 0, right: 0 } });
  // portrait media (a second row on the same webm with portrait dims), 390 and 769
  for (const era of eras) cases.push({ label: `phone-portrait 390x844 ${era}`, w: 390, h: 844, era, mobile: true, id: 'port1' });
  cases.push({ label: 'desk-portrait 1280x720 2021', w: 1280, h: 720, era: '2021', id: 'port1' });
  // the cold reserved frame (the item's API never answers)
  for (const [w, h] of [[390, 844], [768, 1024]]) for (const era of eras) cases.push({ label: `cold-frame ${w}x${h} ${era}`, w, h, era, mobile: true, hold: true });
  cases.push({ label: 'cold-frame 1280x720 2021', w: 1280, h: 720, era: '2021', hold: true });
  // Music and Podcasts phone players (their #player-slot never carries the watch classes)
  for (const era of eras) { cases.push({ label: `music 390x844 ${era}`, w: 390, h: 844, era, mobile: true, url: '/music?play=song1' }); cases.push({ label: `podcasts 390x844 ${era}`, w: 390, h: 844, era, mobile: true, url: '/podcasts' }); }
  // the breakpoint edge and desktop
  for (const [w, h] of [[769, 1024], [1024, 768], [1280, 720], [1920, 1080]]) for (const era of (quick ? ['2021'] : eras)) cases.push({ label: `desk ${w}x${h} ${era}`, w, h, era });
  for (const o of cases.filter((c) => !only || only.test(c.label))) { try { out.runs.push(await one(browser, s, o)); } catch (e) { out.runs.push({ case: o.label, error: String(e.message || e) }); } }
  await browser.close(); await s.stop();
  fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
  for (const r of out.runs) {
    if (r.error) { console.log(r.case, 'ERROR', r.error); continue; }
    const pic = r.art || r.video;
    console.log([r.case.padEnd(34), 'main', r.main.padding_left || r.main['padding-left'], '| stage m', r.stage['margin-left'], 'p', r.stage['padding-left'],
      '| wrap x', r.wrapper.rect && r.wrapper.rect.x, 'w', r.wrapper.rect && r.wrapper.rect.w, 'r', r.wrapper.rect && r.wrapper.rect.right, 'b', r.wrapper['border-left-width'], 'rad', r.wrapper['border-top-left-radius'], '| glowx', r.glow && r.glow.x, 'gw', r.glow && r.glow.w,
      '| pic x', pic && pic.x, 'w', pic && pic.w, 'h', pic && pic.h, '| title x', r.title && r.title.x, '| sw', r.scrollW, '| ins', r.inset.l, r.inset.t, '| cls', (r.wrapperClass || '').replace('player-container', '').trim(), Object.hasOwn(r, 'heldSlotEmpty') ? '| slot x ' + (r.slot && r.slot.x) + ' w ' + (r.slot && r.slot.w) + ' h ' + (r.slot && r.slot.h) + ' empty ' + r.slotEmpty + ' rad ' + r.slotRadius + ' b ' + r.slotBorder : '', r.portraitClass !== undefined ? '| portrait ' + r.portraitClass : '',
      r.docked ? '| dock ' + JSON.stringify(r.docked) : '', r.errs.length ? '| ERRS ' + r.errs.join(';') : ''].join(' '));
  }
  process.exit(0);
})();
