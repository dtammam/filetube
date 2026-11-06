#!/usr/bin/env node
'use strict';
/* global document, window, HTMLVideoElement, getComputedStyle */
// v1.404.0 picture-in-picture (plan 2026-11-05-ios-pip, W3): the real-browser half of R3. It boots the real server on a
// scratch library with one generated VP8 clip (both engines decode it) and the custom player on (without it a phone gets Apple's controls and no row), opens the watch page in a touch context and taps the REAL settings
// cog and the REAL picture-in-picture row (page.touchscreen.tap: trusted touch input, not a dispatched click), then asserts:
//
//   - the tap on the row arrives as a trusted click whose target is the row (no touch handler cancelled it: R3's "does a tap really click?");
//   - the PiP call runs synchronously inside that click, so the user gesture is still live;
//   - under a fake native host (nativeVideoPip) the same tap posts video.pip { start } inside the click, and no standard call runs;
//   - without the capability the row is hidden on the owned video.
//
//   node scripts/pip-tap-probe.js [webkit|chromium|both]
//
// What this CANNOT show: Playwright's Linux WebKit is not iOS, it has no AVKit and opens no window. WebKit's PiP methods are recorders here and the
// phone platform is emulated (navigator.platform, coarse pointer); the first line of each run prints what the engine itself answers. The window
// itself is the device check. Not a CI gate: one line per case, a PASS/FAIL summary, exit 1 on any failure.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const ENGINE_ARG = process.argv[2] || 'both';
const ENGINES = ENGINE_ARG === 'both' ? ['webkit', 'chromium'] : [ENGINE_ARG];
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pip-'));

const pw = require(require.resolve('playwright', { paths: [path.join(REPO, 'tools/capture'), '/home/coder/projects/filetube/tools/capture'] }));

let fail = 0, passes = 0;
function report(ok, line) { if (ok) passes += 1; else fail += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${line}`); }

async function boot() {
  const server = require(path.join(REPO, 'server.js'));
  const lib = path.join(process.env.DATA_DIR, 'library');
  fs.mkdirSync(lib, { recursive: true });
  const fp = path.join(lib, 'clip.webm');
  // test_media/Welcome_to_FileTube.mp4 is 65 bytes of text, not a video
  execFileSync(process.env.FFMPEG || path.join(os.homedir(), '.local', 'bin', 'ffmpeg-static', 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=20', '-c:v', 'libvpx', '-b:v', '300k', fp]);
  const id = server.getMediaId(fp);
  const metadata = { [id]: { id, type: 'video', title: 'PiP probe', name: 'clip.webm', filePath: fp, rootFolder: lib, folderName: 'library', channelName: 'Probe', duration: 20, width: 640, height: 360, hasThumbnail: false, ext: '.webm', addedAt: 1788000000000, size: fs.statSync(fp).size } };
  const { seedState } = require(path.join(REPO, 'test', 'helpers', 'seed-state'));
  seedState({ folders: [lib], folderSettings: {}, metadata, liked: [], settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, mobileCustomPlayer: true } });
  const listening = await new Promise((resolve) => { const s = server.app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, listening, id, base: `http://127.0.0.1:${listening.address().port}`, cookie: server.__mintTestSession().cookie };
}

// Runs before any page script. Records the touch and click facts, the PiP calls and whether each ran inside a click.
function instrument(opts) {
  const log = window.__pip = { events: [], calls: [], posts: [], engine: null };
  // the event being dispatched right now: true only inside the click's own call stack (a stamp cleared by a bubble listener would never clear: the bar stops propagation)
  const inClick = () => !!(window.event && window.event.type === 'click');
  const P = HTMLVideoElement.prototype;
  log.engine = { pictureInPictureEnabled: document.pictureInPictureEnabled === undefined ? 'undefined' : document.pictureInPictureEnabled, requestPictureInPicture: typeof P.requestPictureInPicture, webkitSupportsPresentationMode: typeof P.webkitSupportsPresentationMode, webkitSetPresentationMode: typeof P.webkitSetPresentationMode };
  Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'iPhone' });
  const mm = window.matchMedia.bind(window);
  const fixed = (q, matches) => ({ matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.matchMedia = (q) => {
    if (/any-pointer:\s*fine/.test(q)) return fixed(q, false);
    if (/pointer:\s*coarse|hover:\s*none/.test(q)) return fixed(q, true);
    return mm(q);
  };
  P.webkitSupportsPresentationMode = function () { return true; };
  P.webkitSetPresentationMode = function (m) { log.calls.push({ call: 'webkitSetPresentationMode', arg: m, inClick: inClick() }); };
  P.requestPictureInPicture = function () { log.calls.push({ call: 'requestPictureInPicture', inClick: inClick() }); return Promise.reject(new Error('recorder')); };
  for (const t of ['touchstart', 'touchend']) window.addEventListener(t, (e) => { log.events.push({ t, id: e.target && e.target.id, trusted: e.isTrusted, prevented: e.defaultPrevented }); });
  window.addEventListener('click', (e) => { log.events.push({ t: 'click', id: e.target && e.target.id, trusted: e.isTrusted }); }, true);
  if (opts.caps) {
    window.FileTubeHost = { bridge: 1, app: { name: 'filetube-ios', version: '0.18.0', build: '1' }, platform: 'ios', capabilities: opts.caps, post(m) { log.posts.push({ type: m.type, action: m.action, inClick: inClick() }); } };
  }
}

async function open(browser, env, caps) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const [k, v] = env.cookie.split(';')[0].split('=');
  await ctx.addCookies([{ name: k, value: v, url: env.base }]);
  const page = await ctx.newPage();
  await page.addInitScript(instrument, { caps: caps || null });
  await page.goto(`${env.base}/watch.html?v=${env.id}`);
  try {
    await page.waitForFunction(() => { const w = document.getElementById('player-wrapper'); return w && w.querySelector('#settings-btn') && w.classList.contains('ff-mobile') && !w.classList.contains('native-controls'); }, null, { timeout: 15000 });
  } catch (e) {
    const st = await page.evaluate(async () => { const w = document.getElementById('player-wrapper'); const s = await (await window.fetch('/api/settings')).json(); return { url: window.location.href, cls: w && w.className, cog: !!(w && w.querySelector('#settings-btn')), custom: s.mobileCustomPlayer, platform: navigator.platform, coarse: window.matchMedia('(pointer: coarse)').matches }; });
    throw new Error('the custom bar never settled: ' + JSON.stringify(st));
  }
  return { ctx, page };
}
// the bar auto-hides on a phone: a first tap on the picture reveals it, then the real tap on the control
async function tapCentre(page, sel) {
  const box = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, hit: (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) || {}).id }; }, sel);
  if (!box || !box.w || !box.h) return box;
  await page.touchscreen.tap(box.x, box.y);
  return box;
}
async function openRow(page) {
  await page.evaluate(() => { const w = document.getElementById('player-wrapper'); w.classList.add('controls-visible'); });
  await tapCentre(page, '#settings-btn');
  await page.waitForTimeout(120);
  return page.evaluate(() => { const m = document.getElementById('settings-menu'); const b = document.getElementById('pip-btn'); return { menuOpen: m && !m.hidden, rowHidden: b.hidden || getComputedStyle(b).display === 'none' }; });
}

(async () => {
  const env = await boot();
  for (const engine of ENGINES) {
    const browser = await pw[engine].launch();
    // ---- the browser path (Safari's shape: the row must use webkitSetPresentationMode inside a real tap's click)
    {
      const { ctx, page } = await open(browser, env);
      const eng = await page.evaluate(() => window.__pip.engine);
      console.log(`INFO ${engine} answers, before the recorders: ${JSON.stringify(eng)}`);
      await page.waitForFunction(() => { const v = document.getElementById('media-player'); return v && v.readyState >= 1; }, null, { timeout: 30000 });
      const open1 = await openRow(page);
      report(open1.menuOpen === true, `${engine} browser: a real tap on the cog opens the menu ${JSON.stringify(open1)}`);
      report(open1.rowHidden === false, `${engine} browser: the row shows`);
      await page.evaluate(() => { window.__pip.events.length = 0; });
      const box = await tapCentre(page, '#pip-btn');
      await page.waitForTimeout(150);
      const log = await page.evaluate(() => window.__pip);
      const click = log.events.find((e) => e.t === 'click');
      report(box && box.hit === 'pip-btn', `${engine} browser: the row is what the finger hits (${box && box.hit})`);
      report(!!click && click.id === 'pip-btn' && click.trusted === true, `${engine} browser: the tap arrives as a trusted click on the row: ${JSON.stringify(log.events)}`);
      report(log.events.filter((e) => e.t !== 'click').every((e) => e.prevented === false), `${engine} browser: no touch handler cancelled it`);
      const c = log.calls[log.calls.length - 1];
      report(!!c && c.call === 'webkitSetPresentationMode' && c.arg === 'picture-in-picture' && c.inClick === true, `${engine} browser: the call runs synchronously inside the click: ${JSON.stringify(log.calls)}`);
      report(log.calls.every((x) => x.call !== 'requestPictureInPicture'), `${engine} browser: never the standard call on the phone route`);
      await ctx.close();
    }
    // ---- the app path: the same tap reaches video.pip through the real claim, the real proxy and the real adapter
    const NATIVE = ['nativeAudio', 'nativeVideoAudio', 'nativeVideo', 'nativeVideoDock'];
    {
      const { ctx, page } = await open(browser, env, NATIVE.concat(['nativeVideoPip']));
      await page.waitForFunction(() => window.__pip.posts.some((p) => p.type === 'audio.load'), null, { timeout: 30000 });
      await openRow(page);
      await page.evaluate(() => { window.__pip.posts.length = 0; window.__pip.calls.length = 0; });
      await tapCentre(page, '#pip-btn');
      await page.waitForTimeout(150);
      const log = await page.evaluate(() => window.__pip);
      const p = log.posts.filter((x) => x.type === 'video.pip');
      report(p.length === 1 && p[0].action === 'start' && p[0].inClick === true, `${engine} app: a real tap posts video.pip start inside the click: ${JSON.stringify(p)}`);
      report(log.calls.length === 0, `${engine} app: no WebKit or standard PiP call on the src-less element: ${JSON.stringify(log.calls)}`);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('filetube-host', { detail: { v: 1, type: 'videoPip', active: true } })));
      const st = await page.evaluate(() => { const b = document.getElementById('pip-btn'); const l = document.querySelector('.player-pip-label'); return { pressed: b.getAttribute('aria-pressed'), label: getComputedStyle(b, '::before').content, shown: !!l && getComputedStyle(l).display !== 'none', onTop: !!l && getComputedStyle(l).position }; });
      report(st.pressed === 'true' && /Exit picture-in-picture/.test(st.label) && st.shown === true, `${engine} app: videoPip true presses the row, its label changes, the box shows the label: ${JSON.stringify(st)}`);
      await ctx.close();
    }
    {
      const { ctx, page } = await open(browser, env, NATIVE);
      await page.waitForFunction(() => window.__pip.posts.some((p) => p.type === 'audio.load'), null, { timeout: 30000 });
      const r = await openRow(page);
      report(r.rowHidden === true, `${engine} app without the capability: the row is hidden ${JSON.stringify(r)}`);
      await ctx.close();
    }
    await browser.close();
  }
  console.log(`SUMMARY pass=${passes} fail=${fail}`);
  env.listening.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
