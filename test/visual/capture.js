#!/usr/bin/env node
'use strict';
// UI professionalism scene capture (D10.5). Adapted from the 2026-09-27 audit's
// baseline capture; the visual job (test/visual/run.js) runs this same code against
// a changed tree and diffs it with tools/capture/compare.js at 0 changed pixels.
//
//   node test/visual/seed.js                 (builds the synthetic DATA_DIR)
//   test/visual/start-server.sh &            (serves it on :3917, FILETUBE_READONLY=1)
//   node test/visual/capture.js [--data DIR] [--out DIR] [--only substr,substr]
//        [--era 2021|2014|2009|2005|all|2021,2005] [--dpr N] [--clock MS|off]
//        [--no-rotation] [--no-matrix]
//
// Needs Playwright from tools/capture (cd tools/capture && npm install &&
// npx playwright install chromium). Fixture ids and the login come from the
// seeded dir's fixtures.json. The module also exports the scene list and helpers
// (test/visual/run.js, test/geometry/run.js).
//
// Every context comes from tools/capture/request-policy.js newGuardedContext
// (mutations never leave the browser) on top of the server's FILETUBE_READONLY=1.
// Static scenes: animations/transitions frozen at end state (FREEZE_CSS) and image
// quiescence (settle.js) before each shot. The rotation sequence is NOT frozen - it
// exists to show real reflow - and is recorded by CDP screencast.
//
// Determinism (step 4 of the plan; the visual job diffs at 0 changed pixels):
// - the browser wall clock starts at the fixture's viewNow (clockInitScript) and flows
//   from there, so every relative date ("2 hours ago") is the same on every run and
//   every calendar day; the server runs on the same pinned clock (clock-shim.js);
// - every context pins timezone UTC, locale en-US and colour scheme light (the app's
//   mode comes from ft-mode, never from the OS);
// - volatile text is masked (MASK_CSS): the tools/capture set plus the watch page's
//   file path, which carries the DATA_DIR;
// - Chromium rasterizes on one CPU thread with SwiftShader (LESSONS 7) and a fresh
//   browser process serves each viewport.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CAP = path.resolve(__dirname, '..', '..', 'tools', 'capture');
const { newGuardedContext } = require(path.join(CAP, 'request-policy.js'));
const { settlePageImages, snapScroll, VOLATILE_MASK_CSS } = require(path.join(CAP, 'settle.js'));

// Lazy: requiring this module (unit tests, run.js's baseline checks) must not need Playwright.
// Resolved like the git hooks resolve node_modules (#227): this checkout's tools/capture
// first, then the same path in every ancestor, so a git worktree under .claude/worktrees/
// uses the main checkout's install without a symlink.
function playwright() {
  const tried = [];
  for (let dir = path.resolve(__dirname, '..', '..'); ; dir = path.dirname(dir)) {
    const p = path.join(dir, 'tools', 'capture', 'node_modules', 'playwright');
    tried.push(p);
    if (fs.existsSync(path.join(p, 'package.json'))) return require(p);
    if (path.dirname(dir) === dir) break;
  }
  throw new Error(`Playwright not found (looked in ${tried.join(', ')}); cd tools/capture && npm ci && npx playwright install chromium`);
}

const ERAS = ['2021', '2014', '2009', '2005'];
const MODES = ['dark', 'light'];
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
function viewports(dpr) {
  const d = Number(dpr) > 0 ? Number(dpr) : 3;
  return {
    phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: d, isMobile: true, hasTouch: true, userAgent: IOS_UA },
    land: { viewport: { width: 844, height: 390 }, deviceScaleFactor: d, isMobile: true, hasTouch: true, userAgent: IOS_UA },
    desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  };
}
const FREEZE_CSS = '*,*::before,*::after{transition:none!important;animation-play-state:paused!important;animation-delay:-0.01s!important;caret-color:transparent!important}html{scroll-behavior:auto!important;overflow-anchor:none!important}';
// Volatile text (D10.5): VOLATILE_MASK_CSS (subs status line, notification times, the
// watch page's added date) + the watch page's file path (it prints the DATA_DIR, which
// differs per machine). Masked glyphs keep their box; the path is clamped to one line so
// a longer DATA_DIR cannot wrap it to a different height.
const MASK_CSS = VOLATILE_MASK_CSS
  + '#file-path-text{visibility:hidden!important;display:block!important;white-space:nowrap!important;overflow:hidden!important}';
// LESSONS 7 (the flag set scripts/pocket-render-probe.js measured at 0 px): one CPU raster
// thread, no partial raster (a re-raster of only the invalidated tiles anti-aliased a circle's
// edge differently between two runs of one tree), SwiftShader (--disable-gpu stalls), no
// font hinting, a fixed colour profile.
const LAUNCH_ARGS = ['--disable-dev-shm-usage', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
  '--disable-gpu-rasterization', '--num-raster-threads=1', '--disable-partial-raster', '--disable-zero-copy',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--font-render-hinting=none', '--force-color-profile=srgb'];
const CONTEXT_PINS = { timezoneId: 'UTC', locale: 'en-US', colorScheme: 'light' };

// The browser half of clock-shim.js, as an init script: Date starts at `startMs` when the
// document is created and flows at the real rate (no timer is faked, so nothing hangs).
function installPinnedClock(startMs) {
  if (window.__ftPinnedClock || !(startMs > 0)) return;
  const RealDate = Date;
  const offset = startMs - RealDate.now();
  const now = () => RealDate.now() + offset;
  function PinnedDate(...args) {
    if (!new.target) return new RealDate(now()).toString();
    return args.length ? new RealDate(...args) : new RealDate(now());
  }
  Object.setPrototypeOf(PinnedDate, RealDate);
  PinnedDate.prototype = RealDate.prototype;
  PinnedDate.now = now;
  PinnedDate.parse = RealDate.parse;
  PinnedDate.UTC = RealDate.UTC;
  window.Date = PinnedDate;
  window.__ftPinnedClock = { startMs };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isMobile = (vp) => vp !== 'desktop';

// ---- scene helpers ----
async function tap(page, sel, vp) {
  const loc = page.locator(sel).first();
  await loc.waitFor({ state: 'visible', timeout: 8000 });
  if (isMobile(vp)) await loc.tap({ timeout: 8000 }); else await loc.click({ timeout: 8000 });
}
async function scrollCenter(page, sel) {
  await page.locator(sel).first().waitFor({ state: 'attached', timeout: 8000 });
  await page.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: 'center' }); }, sel);
  await snapScroll(page);
}
async function scrollBottom(page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await snapScroll(page);
}
async function pausePlayback(page) {
  await page.evaluate(() => { document.querySelectorAll('audio,video').forEach((m) => { try { m.pause(); m.currentTime = 7; } catch (_) { /* no media */ } }); });
}

// The scene list and the fixture-bound helpers. Each scene: { id, vps (default all), path, run(page, vp) }.
function sceneKit(FX, BASE) {
  // Pocket: open the Click skin's full Now Playing on a track.
  async function openPocket(page, skin, vp) {
    await page.evaluate((s) => { localStorage.setItem('ft-music-skin', s); localStorage.removeItem('ft-tray-mode'); localStorage.setItem('ft-pocket-lighting', 'off'); }, skin);
    await page.goto(`${BASE}/music?play=${FX.track}`, { waitUntil: 'networkidle', timeout: 20000 });
    // The Click skin renders full-screen only on a phone-portrait viewport; landscape/desktop
    // photograph whatever the music page shows instead (recorded as pocketFull:false).
    await page.waitForSelector(vp === 'phone' ? '#music-nowplaying-panel.mms-full' : '#music-nowplaying-panel', { state: 'attached', timeout: 15000 });
    await sleep(900);
  }

  const SCENES = [
    { id: '01-home', path: '/', run: async (p) => { await p.waitForSelector('.video-card', { timeout: 12000 }); } },
    { id: '02-home-scrolled', path: '/', vps: ['phone', 'desktop'], run: async (p) => { await p.waitForSelector('.video-card'); await p.evaluate(() => window.scrollTo(0, 900)); await snapScroll(p); } },
    { id: '03-channel-page', path: '/?folder=Harbor%20Workshop', run: async (p) => { await p.waitForSelector('.video-card', { timeout: 12000 }); } },
    { id: '04-subs-top', path: '/subscriptions', run: async (p) => { await p.waitForSelector('.sub-row-kebab', { timeout: 12000 }); } },
    { id: '05-subs-activity', path: '/subscriptions', run: async (p, vp) => { await p.waitForSelector('.sub-row-kebab'); await tap(p, 'button.sub-pill:has-text("Activity")', vp); await sleep(700); } },
    { id: '06-subs-row-sheet', path: '/subscriptions', run: async (p, vp) => { await p.waitForSelector('.sub-row-kebab'); await tap(p, '.sub-row-kebab', vp); await p.waitForSelector('.sub-sheet-backdrop:not([hidden])', { timeout: 8000 }); await sleep(400); } },
    { id: '07-subs-bottom', path: '/subscriptions', run: async (p) => { await p.waitForSelector('.sub-row-kebab'); await scrollBottom(p); } },
    { id: '08-podcasts-list', path: '/podcasts', run: async (p) => { await p.waitForSelector('[data-show-id]', { timeout: 12000 }); } },
    { id: '09-podcast-detail', path: '/podcasts', run: async (p, vp) => { await p.waitForSelector('[data-show-id]'); await tap(p, '[data-show-id]', vp); await sleep(1200); } },
    { id: '10-music-home', path: '/music', run: async (p) => { await p.waitForSelector('.music-album-card', { timeout: 12000 }); } },
    { id: '11-music-albums', path: '/music', run: async (p, vp) => { await p.waitForSelector('.music-tab'); await tap(p, '.music-tab[data-tab="albums"]', vp); await sleep(800); } },
    { id: '12-music-artists', path: '/music', run: async (p, vp) => { await p.waitForSelector('.music-tab'); await tap(p, '.music-tab[data-tab="artists"]', vp); await sleep(800); } },
    { id: '13-music-songs', path: '/music', run: async (p, vp) => { await p.waitForSelector('.music-tab'); await tap(p, '.music-tab[data-tab="songs"]', vp); await sleep(800); } },
    { id: '14-music-album-drill', path: '/music', run: async (p, vp) => { await p.waitForSelector('.music-album-card'); await tap(p, '.music-album-card', vp); await p.waitForSelector('.music-drill-art', { timeout: 8000 }); await sleep(500); } },
    { id: '15-music-nowplaying-default', path: '/music', run: async (p) => { await p.evaluate(() => localStorage.removeItem('ft-music-skin')); await p.goto(`${BASE}/music?play=${FX.track}`, { waitUntil: 'networkidle' }); await sleep(1500); await pausePlayback(p); } },
    { id: '16-music-mini-player', path: '/music', run: async (p, vp) => { await p.evaluate(() => localStorage.removeItem('ft-music-skin')); await p.goto(`${BASE}/music?play=${FX.track}`, { waitUntil: 'networkidle' }); await sleep(1500); await pausePlayback(p);
      const c = p.locator('[data-skin-collapse]').first(); if (await c.count()) { if (isMobile(vp)) await c.tap(); else await c.click(); await sleep(800); } } },
    { id: '17-watch-top', path: `/watch.html?v=${FX.video}`, run: async (p) => { await p.waitForSelector('#media-title', { timeout: 12000 }); await pausePlayback(p); } },
    { id: '18-watch-action-row-channel', path: `/watch.html?v=${FX.video}`, run: async (p) => { await p.waitForSelector('#subscribe-btn-mock', { timeout: 12000 }); await pausePlayback(p); await scrollCenter(p, '#subscribe-btn-mock'); } },
    { id: '19-watch-unsubscribed-channel', path: `/watch.html?v=${FX.videoUnsub}`, run: async (p) => { await p.waitForSelector('#subscribe-btn-mock', { timeout: 12000 }); await pausePlayback(p); await scrollCenter(p, '#subscribe-btn-mock'); } },
    { id: '20-watch-more-actions', path: `/watch.html?v=${FX.video}`, run: async (p, vp) => { await p.waitForSelector('#more-actions-btn', { timeout: 12000 }); await pausePlayback(p); await scrollCenter(p, '#more-actions-btn'); await tap(p, '#more-actions-btn', vp); await sleep(600); } },
    { id: '21-notifications-open', path: '/', run: async (p, vp) => { await p.waitForSelector('#notif-bell-btn', { timeout: 12000 }); await tap(p, '#notif-bell-btn', vp); await p.waitForSelector('.notif-panel', { timeout: 8000 }); await sleep(800); } },
    // 22: reducedMotion 'no-preference' ON PURPOSE - under prefers-reduced-motion: reduce the queue
    // panel opens INVISIBLE (openOverlay skips .queue-open and style.css has no reduced-motion carve-out
    // for .queue-panel, unlike .notif-panel/.sub-sheet/.playlists-sheet). 22b photographs that bug.
    { id: '22-queue-panel', path: '/', rm: 'no-preference', run: async (p, vp) => { await p.waitForSelector('#queue-btn', { timeout: 12000 }); await p.waitForLoadState('networkidle'); await sleep(600);
      await tap(p, '#queue-btn', vp); await p.waitForSelector('#queue-panel.queue-open', { timeout: 8000 }); await sleep(800); } },
    { id: '22b-queue-panel-reduced-motion-BUG', path: '/', vps: ['phone', 'desktop'], run: async (p, vp) => { await p.waitForSelector('#queue-btn', { timeout: 12000 }); await p.waitForLoadState('networkidle'); await sleep(600);
      await tap(p, '#queue-btn', vp); await p.waitForSelector('#queue-panel:not([hidden])', { state: 'attached', timeout: 8000 }); await sleep(800); } },
    { id: '23-account-menu', path: '/', run: async (p, vp) => {
      if (isMobile(vp) && await p.locator('#bottom-nav button[aria-label*="account"], .bottom-nav-item:has-text("You")').first().isVisible().catch(() => false)) await tap(p, '.bottom-nav-item:has-text("You")', vp);
      else await tap(p, '#account-menu-root button, #account-menu-root [aria-haspopup]', vp);
      await sleep(800); } },
    // Phone only: the landscape phone (844px) shows the sidebar, not the bottom bar, so it has
    // no #nav-playlists-btn (the scene timed out there on every run).
    { id: '24-playlists-sheet', path: '/', vps: ['phone'], run: async (p, vp) => { await tap(p, '#nav-playlists-btn', vp); await p.waitForSelector('.playlists-sheet:not([hidden])', { timeout: 8000 }); await sleep(600); } },
    // Not on the phone: phone portrait has no #menu-toggle (the bottom bar replaces the
    // sidebar), so the scene timed out there on every run (2 capture failures per era).
    { id: '25-hamburger-sidebar', path: '/', vps: ['land', 'desktop'], run: async (p, vp) => { await tap(p, '#menu-toggle', vp); await sleep(700); } },
    { id: '26-settings-top', path: '/setup.html', run: async (p) => { await p.waitForLoadState('networkidle'); await sleep(800); } },
    { id: '27-settings-mid', path: '/setup.html', vps: ['phone', 'desktop'], run: async (p) => { await p.waitForLoadState('networkidle'); await sleep(800); await p.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight / 2))); await snapScroll(p); } },
    { id: '28-history', path: '/history', run: async (p) => { await p.waitForLoadState('networkidle'); await sleep(800); } },
    { id: '29-search-open', path: '/', vps: ['phone'], run: async (p, vp) => { await tap(p, '#search-toggle-btn', vp); await sleep(600); } },
    { id: '30-stats', path: '/stats.html', vps: ['phone', 'desktop'], run: async (p) => { await p.waitForLoadState('networkidle'); await sleep(800); } },
    // Books and the reader (sweep S10): the library, one shelf, the reader and its two sheets.
    { id: '50-books-library', path: '/books', run: async (p) => { await p.waitForSelector('#books-grid .book-card img', { timeout: 12000 }); await sleep(600); } },
    { id: '51-books-shelf', path: `/books?root=${encodeURIComponent(FX.bookShelf || '')}`, vps: ['phone', 'desktop'], run: async (p) => { await p.waitForSelector('#books-grid .book-card img', { timeout: 12000 }); await sleep(600); } },
    { id: '52-reader', path: `/read.html?b=${FX.book}`, run: async (p) => { await p.waitForSelector('#reader-pane iframe', { timeout: 15000 }); await sleep(1500); } },
    { id: '53-reader-contents', path: `/read.html?b=${FX.book}`, vps: ['phone', 'desktop'], run: async (p, vp) => { await p.waitForSelector('#reader-pane iframe', { timeout: 15000 }); await sleep(1000); await tap(p, '#reader-toc-btn', vp); await sleep(900); } },
    { id: '54-reader-settings', path: `/read.html?b=${FX.book}`, vps: ['phone', 'desktop'], run: async (p, vp) => { await p.waitForSelector('#reader-pane iframe', { timeout: 15000 }); await sleep(1000); await tap(p, '#reader-settings-btn', vp); await sleep(900); } },
  ];
  // Pocket Classic (Click skins): phone portrait+landscape+desktop for the base skin, other skins phone only.
  const POCKET_SKINS = ['ipod', 'ipod-black', 'ipod-original', 'ipod-red', 'ipod-2004'];
  for (const skin of POCKET_SKINS) {
    const vps = skin === 'ipod' ? ['phone', 'land', 'desktop'] : ['phone'];
    SCENES.push({ id: `40-pocket-${skin}-nowplaying`, path: '/music', vps, pocket: true, run: async (p, vp) => { await openPocket(p, skin, vp); await pausePlayback(p); } });
    if (skin === 'ipod' || skin === 'ipod-original') { // menus exist only where the skin is full-screen (phone portrait)
      SCENES.push({ id: `41-pocket-${skin}-menu`, path: '/music', vps: ['phone'], pocket: true, run: async (p, vp) => { await openPocket(p, skin, vp); await pausePlayback(p); await tap(p, '[data-skin-menu]', vp); await sleep(600); } });
      SCENES.push({ id: `42-pocket-${skin}-songlist`, path: '/music', vps: ['phone'], pocket: true, run: async (p, vp) => { await openPocket(p, skin, vp); await pausePlayback(p); await tap(p, '[data-skin-select]', vp); await sleep(600); } });
    }
  }
  return { SCENES, openPocket };
}

const shotName = (sceneId, vp, mode, era) => `${sceneId}--${vp}-${mode}${era === '2021' ? '' : '-' + era}.png`;

function newRecord(base) {
  return { base, date: new Date().toISOString(), captured: [], failed: [], blockedRequests: [], blockedExpected: [], imageWait: [], rotation: [] };
}

// Logs in through the real form and returns the storage state (cookie) for scene contexts.
async function login(browser, base, FX, record) {
  const ctx = await newGuardedContext(browser, { ...CONTEXT_PINS }, record, { scene: 'login' });
  const page = await ctx.newPage();
  await page.goto(base + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-username, input[name="username"], input[type="text"]', FX.user);
  await page.fill('#login-password, input[name="password"], input[type="password"]', FX.password);
  await page.click('button[type="submit"], .login-submit');
  await page.waitForURL((u) => !String(u).includes('login'), { timeout: 10000 });
  const st = await ctx.storageState();
  await ctx.close();
  return st;
}

// A guarded context with the determinism pins, the clock and the era/mode in storage.
async function newScenePage(browser, o) {
  const { vp, mode, era, storageState, tag, record, clockMs, dpr } = o;
  const vpOpts = viewports(dpr)[vp];
  const ctx = await newGuardedContext(browser, { ...vpOpts, ...CONTEXT_PINS, storageState,
    reducedMotion: tag.rotation ? 'no-preference' : (tag.rm || 'reduce') }, record, tag);
  if (clockMs) await ctx.addInitScript(installPinnedClock, clockMs);
  await ctx.addInitScript(([m, e]) => { try { localStorage.setItem('ft-era', e); localStorage.setItem('ft-mode', m); } catch (_) { /* storage off */ } }, [mode, era]);
  return { ctx, page: await ctx.newPage() };
}

async function runScene(browser, o) {
  const { scene, vp, mode, era, out, record, base } = o;
  const fname = shotName(scene.id, vp, mode, era);
  const { ctx, page } = await newScenePage(browser, { ...o, tag: { scene: scene.id, vp, mode, era, rm: scene.rm } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  try {
    await page.goto(base + scene.path, { waitUntil: 'networkidle', timeout: 20000 });
    await page.addStyleTag({ content: FREEZE_CSS });
    await scene.run(page, vp);
    await page.addStyleTag({ content: FREEZE_CSS + MASK_CSS }).catch(() => {}); // re-freeze after any in-scene navigation; mask volatile text
    const im = await settlePageImages(page);
    if (!im.stable || im.pending > 0) record.imageWait.push({ fname, pending: im.pending, total: im.total });
    await snapScroll(page);
    await page.screenshot({ path: path.join(out, fname) });
    record.captured.push({ fname, pageErrors: errs });
  } catch (e) {
    record.failed.push({ fname, error: String(e).split('\n').slice(0, 3).join(' | ').slice(0, 400), pageErrors: errs });
    try { await page.screenshot({ path: path.join(out, 'FAILED-' + fname) }); } catch (_) { /* page gone */ }
  } finally { await ctx.close(); }
}

// ---- rotation case: Pocket portrait -> landscape -> exit Pocket -> portrait, screencast frames ----
async function rotation(browser, o, skin, variant) {
  const { mode, out, record, base, openPocket } = o;
  const dir = path.join(out, `rotation-${variant}-${skin}-${mode}${o.era === '2021' ? '' : '-' + o.era}`);
  fs.mkdirSync(dir, { recursive: true });
  const { ctx, page } = await newScenePage(browser, { ...o, vp: 'phone', dpr: 3, tag: { scene: 'rotation', rotation: true, mode } });
  const cdp = await ctx.newCDPSession(page);
  const log = [];
  const setOrient = async (portrait) => {
    const [w, h] = portrait ? [390, 844] : [844, 390];
    // setViewportSize keeps Playwright's own view in sync; the CDP override adds the
    // screen orientation so orientationchange + matchMedia(orientation) fire like a real rotate.
    await page.setViewportSize({ width: w, height: h });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 3, mobile: true,
      screenWidth: w, screenHeight: h, screenOrientation: portrait ? { type: 'portraitPrimary', angle: 0 } : { type: 'landscapePrimary', angle: 90 } });
  };
  // Every ~50ms for 1s after a step: CDP screencast delivers each painted frame with a
  // timestamp (a screenshot loop at DPR 3 cannot keep a 50ms cadence).
  const burst = async (step) => {
    const frames = [];
    const tStart = Date.now();
    const onFrame = async (f) => { frames.push({ t: (Date.now() - tStart) / 1000, data: f.data }); try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (_) { /* ended */ } };
    cdp.on('Page.screencastFrame', onFrame);
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    return async () => {
      await sleep(1000);
      await cdp.send('Page.stopScreencast');
      cdp.off('Page.screencastFrame', onFrame);
      frames.forEach((f, i) => fs.writeFileSync(path.join(dir, `${step}-f${String(i).padStart(2, '0')}-${Math.round(f.t * 1000)}ms.png`), Buffer.from(f.data, 'base64')));
      log.push({ step, frames: frames.length, spanMs: frames.length ? Math.round(frames[frames.length - 1].t * 1000) : 0 });
    };
  };
  const state = () => pocketState(page);
  try {
    await page.goto(base + '/music', { waitUntil: 'networkidle' });
    await openPocket(page, skin, 'phone');
    await pausePlayback(page);
    await page.screenshot({ path: path.join(dir, '0-portrait-pocket.png') });
    log.push({ step: '0-start', state: await state() });
    const steps = rotationSteps(page, variant, setOrient);
    for (const [name, fn] of steps) {
      const done = await burst(name); const how = await fn(); await done();
      log.push({ step: name + '-after', how: typeof how === 'string' ? how : undefined, state: await state() });
      await page.screenshot({ path: path.join(dir, `${name}-settled.png`) });
    }
    await page.screenshot({ path: path.join(dir, '4-portrait-final.png') });
  } catch (e) {
    log.push({ error: String(e).split('\n')[0] });
  } finally { await ctx.close(); }
  record.rotation.push({ skin, mode, variant, dir: path.basename(dir), log });
}

function pocketState(page) {
  return page.evaluate(() => {
    const pnl = document.getElementById('music-nowplaying-panel');
    const r = pnl ? pnl.getBoundingClientRect() : null;
    return { vw: innerWidth, vh: innerHeight, orient: screen.orientation && screen.orientation.type, full: !!(pnl && pnl.classList.contains('mms-full')),
      panelVisible: !!(r && r.width > 0 && r.height > 0 && getComputedStyle(pnl).display !== 'none'), panelRect: r ? [r.x, r.y, r.width, r.height].map(Math.round) : null };
  });
}

// The rotation sequence (shared with geometry check G4). 'spec' = AC9's order: rotate to
// landscape, leave Pocket, rotate back; 'exit-first' leaves Pocket before rotating.
function rotationSteps(page, variant, setOrient) {
  // Exit Pocket Classic: its own collapse control if visible, else MENU until the full panel
  // docks (Now Playing -> Main Menu -> dock). In landscape the skin is not full-screen, so
  // there may be nothing to exit - the log's state lines record which case happened.
  const exitPocket = async () => {
    const col = page.locator('#music-nowplaying-panel [data-skin-collapse]').first();
    if (await col.count() && await col.isVisible()) { await col.tap(); return 'collapse'; }
    let taps = 0;
    for (let i = 0; i < 6; i++) { const s = await pocketState(page); if (!s.full) break; await page.locator('[data-skin-menu]').first().tap({ timeout: 2000 }).catch(() => {}); taps++; await sleep(150); }
    return 'menu x' + taps;
  };
  return variant === 'spec'
    ? [['1-to-landscape', () => setOrient(false)], ['2-exit-pocket', exitPocket], ['3-to-portrait', () => setOrient(true)]]
    : [['1-exit-pocket', exitPocket], ['2-to-landscape', () => setOrient(false)], ['3-to-portrait', () => setOrient(true)]];
}

// One era's matrix (+ optionally the rotation screencasts). A fresh browser process per
// viewport (LESSONS 7). Returns the run record; never throws for a scene failure.
async function captureEra(o) {
  const { base, FX, era, out, only, dpr, clockMs, matrix = true, rotationRun = false, log = console.log } = o;
  const record = o.record || newRecord(base);
  const { SCENES, openPocket } = sceneKit(FX, base);
  const { chromium } = playwright();
  fs.mkdirSync(out, { recursive: true });
  const common = { era, out, record, base, clockMs, dpr, openPocket };
  if (matrix) {
    for (const vp of Object.keys(viewports(dpr))) {
      const browser = await chromium.launch({ args: LAUNCH_ARGS });
      try {
        const st = await login(browser, base, FX, record);
        for (const scene of SCENES) {
          if (only && !only.some((s) => scene.id.includes(s))) continue;
          if (!(scene.vps || Object.keys(viewports(dpr))).includes(vp)) continue;
          for (const mode of MODES) await runScene(browser, { ...common, scene, vp, mode, storageState: st });
        }
      } finally { await browser.close(); }
      log(`[${era}] ${vp}: ${record.captured.length} ok, ${record.failed.length} failed so far`);
    }
  }
  if (rotationRun) {
    const browser = await chromium.launch({ args: LAUNCH_ARGS });
    try {
      const st = await login(browser, base, FX, record);
      for (const mode of MODES) for (const v of ['spec', 'exit-first']) await rotation(browser, { ...common, mode, storageState: st }, 'ipod', v);
    } finally { await browser.close(); }
  }
  return record;
}

function readFixtures(dataDir) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'fixtures.json'), 'utf8'));
}

module.exports = {
  ERAS, MODES, viewports, FREEZE_CSS, MASK_CSS, LAUNCH_ARGS, CONTEXT_PINS, installPinnedClock,
  sceneKit, shotName, newRecord, login, newScenePage, captureEra, rotationSteps, pocketState,
  pausePlayback, readFixtures, playwright, tap, sleep,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
  const BASE = process.env.BASE_URL || 'http://127.0.0.1:3917';
  const DATA = path.resolve(arg('--data', process.env.VISUAL_DATA_DIR || path.join(os.tmpdir(), 'filetube-visual-data')));
  const OUT = path.resolve(arg('--out', path.join(os.tmpdir(), 'filetube-visual-shots')));
  const ONLY = arg('--only', '') ? arg('--only', '').split(',') : null;
  const eraArg = arg('--era', '2021');
  const eras = eraArg === 'all' ? ERAS : eraArg.split(',');
  for (const e of eras) if (!ERAS.includes(e)) throw new Error(`--era must be 2021, 2014, 2009, 2005, a comma list of them, or all (got ${eraArg})`);
  // Fixture ids + login, written by seed.js: video = Harbor Workshop (subscribed,
  // notify on); videoUnsub = Northbound Field Notes (not subscribed); track = Halden Arcs;
  // book = The Lamplighter's Ledger (38% read, liked); bookShelf = its (pinned) shelf dir.
  const FX = readFixtures(DATA);
  const clockArg = arg('--clock', '');
  const clockMs = clockArg === 'off' ? 0 : (Number(clockArg) || FX.viewNow || 0);
  const dpr = arg('--dpr', '');
  (async () => {
    const record = newRecord(BASE);
    Object.assign(record, { eras, dpr: dpr || 'default', clockMs });
    for (const era of eras) {
      await captureEra({ base: BASE, FX, era, out: OUT, only: ONLY, dpr, clockMs, record,
        matrix: !args.includes('--no-matrix'),
        rotationRun: !args.includes('--no-rotation') && (!ONLY || ONLY.includes('rotation')) });
    }
    fs.writeFileSync(path.join(OUT, 'run-record.json'), JSON.stringify(record, null, 1));
    console.log(`captured ${record.captured.length}, failed ${record.failed.length}, unexpected blocked ${record.blockedRequests.length}, expected blocked ${record.blockedExpected.length}`);
    for (const f of record.failed) console.log('  FAIL', f.fname, f.error);
    for (const b of record.blockedRequests) console.log('  BLOCKED', b.scene, b.method, b.url);
    for (const r of record.rotation) console.log('  ROTATION', r.mode, JSON.stringify(r.log));
    if (record.failed.length || record.blockedRequests.length) process.exitCode = 1;
  })();
}
