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
// - Math.random is seeded per document (installSeededRandom), with the pinned clock;
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

// Math.random, seeded (mulberry32) per document: Pocket's menu preview picks a random album's
// art (skin-surface.js), which made 41-pocket-ipod-menu differ in 7 of 760 shots between two
// back-to-back runs of one tree. crypto.getRandomValues is untouched.
function installSeededRandom(seed) {
  if (window.__ftSeededRandom) return;
  let a = seed >>> 0;
  Math.random = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  window.__ftSeededRandom = { seed };
}
const RANDOM_SEED = 20260901;

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

// Sweep S4: open the notifications panel (either tree: the old .notif-panel or the sheet).
async function openNotifPanel(page, vp) {
  await page.waitForSelector('#notif-bell-btn', { timeout: 12000 });
  await tap(page, '#notif-bell-btn', vp);
  await page.waitForSelector('#notif-panel.notif-open, #notif-panel.is-open, #notif-panel:not([hidden])', { state: 'attached', timeout: 8000 });
  await page.waitForSelector('#notif-panel-list .ui-row[data-notif-id], #notif-panel-list .notif-row', { timeout: 8000 });
  await sleep(800);
}
// Swipe the first matching row left far enough to reveal its actions (not a full swipe), with
// the pointer events interaction.js reads (a touch pointer, as a finger raises them).
async function swipeRowOpen(page, sel) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 31, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }));
    const x0 = r.right - 20;
    ev('pointerdown', x0);
    for (const dx of [10, 40, 80, 120, 150]) ev('pointermove', x0 - dx);
    ev('pointerup', x0 - 150);
  }, sel);
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
    { id: '04-subs-top', path: '/subscriptions', run: async (p) => { await p.waitForSelector('.subs-more', { timeout: 12000 }); } },
    { id: '05-subs-activity', path: '/subscriptions', run: async (p, vp) => { await p.waitForSelector('.subs-more'); await tap(p, '.subs-toolbar [data-sub-panel="activity"]', vp); await p.waitForSelector('.ui-sheet.is-open', { timeout: 8000 }); await sleep(700); } },
    { id: '06-subs-row-sheet', path: '/subscriptions', run: async (p, vp) => { await p.waitForSelector('.subs-more'); await tap(p, '.ui-row[data-sub-id] .ui-row__link', vp); await p.waitForSelector('.ui-sheet.is-open', { timeout: 8000 }); await sleep(400); } },
    { id: '06b-subs-row-menu', path: '/subscriptions', run: async (p, vp) => { await p.waitForSelector('.subs-more'); await tap(p, '.subs-more', vp); await p.waitForSelector('.ui-sheet.is-open', { timeout: 8000 }); await sleep(400); } },
    { id: '07-subs-bottom', path: '/subscriptions', run: async (p) => { await p.waitForSelector('.subs-more'); await scrollBottom(p); } },
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
    // Sweep S3: the description's "About this file" expanded (before the sweep: the description
    // box). The resume toast is shot by the S3 probe instead: it fades after 4s, sooner than a
    // capture's settle (the old modal likewise auto-resumed after its 5s countdown).
    { id: '18b-watch-about', path: `/watch.html?v=${FX.video}`, run: async (p, vp) => { await p.waitForSelector('#media-title', { timeout: 12000 }); await pausePlayback(p);
      if (await p.locator('#about-file-toggle').count()) { await scrollCenter(p, '#about-file-toggle'); await tap(p, '#about-file-toggle', vp); await sleep(300); await scrollCenter(p, '#about-file-toggle'); }
      else await scrollCenter(p, '.description-container'); } },
    { id: '18-watch-action-row-channel', path: `/watch.html?v=${FX.video}`, run: async (p) => { await p.waitForSelector('#subscribe-btn-mock', { timeout: 12000 }); await pausePlayback(p); await scrollCenter(p, '#subscribe-btn-mock'); } },
    { id: '19-watch-unsubscribed-channel', path: `/watch.html?v=${FX.videoUnsub}`, run: async (p) => { await p.waitForSelector('#subscribe-btn-mock', { timeout: 12000 }); await pausePlayback(p); await scrollCenter(p, '#subscribe-btn-mock'); } },
    { id: '20-watch-more-actions', path: `/watch.html?v=${FX.video}`, run: async (p, vp) => { await p.waitForSelector('#more-actions-btn', { timeout: 12000 }); await pausePlayback(p); await scrollCenter(p, '#more-actions-btn'); await tap(p, '#more-actions-btn', vp); await sleep(600); } },
    // Sweep S4: the notifications panel is a ui.sheet (#notif-panel keeps its id). The waits
    // match both trees (a before shot of the old panel, an after shot of the sheet).
    { id: '21-notifications-open', path: '/', run: async (p, vp) => { await openNotifPanel(p, vp); } },
    // 21b-21d (sweep S4, D8.3): a row's menu (the kebab), a row swiped open (Dismiss + Delete)
    // and the delete confirm. A tree without the sweep photographs the open panel instead.
    { id: '21b-notif-row-menu', path: '/', run: async (p, vp) => { await openNotifPanel(p, vp);
      if (await p.locator('#notif-panel .notif-more').count()) { await tap(p, '#notif-panel .notif-more', vp); await p.waitForSelector('.ui-sheet.is-open:not(#notif-panel)', { timeout: 8000 }); await sleep(500); } } },
    { id: '21c-notif-row-swiped', path: '/', run: async (p, vp) => { await openNotifPanel(p, vp);
      if (await p.locator('#notif-panel .ui-swipe').count()) { await swipeRowOpen(p, '#notif-panel .ui-swipe__content'); await p.waitForSelector('#notif-panel .ui-swipe.is-open', { timeout: 4000 }); await sleep(500); } } },
    { id: '21d-notif-delete-confirm', path: '/', run: async (p, vp) => { await openNotifPanel(p, vp);
      if (await p.locator('#notif-panel .notif-more').count()) { await tap(p, '#notif-panel .notif-more', vp); await p.waitForSelector('.ui-sheet.is-open:not(#notif-panel)', { timeout: 8000 }); await sleep(400);
        await tap(p, '.ui-sheet.is-open:not(#notif-panel) .ui-row--danger', vp); await p.waitForSelector('.ui-sheet--dialog.is-open', { timeout: 8000 }); await sleep(500); } } },
    // 22: reducedMotion 'no-preference'; 22b is the SAME panel under prefers-reduced-motion: reduce.
    // F48 (fixed in sweep S4): the old panel opened INVISIBLE there (openOverlay skipped
    // .queue-open); the ui.sheet applies its open class in every motion mode, so 22b must now
    // show the panel. Both waits match either tree.
    { id: '22-queue-panel', path: '/', rm: 'no-preference', run: async (p, vp) => { await p.waitForSelector('#queue-btn', { timeout: 12000 }); await p.waitForLoadState('networkidle'); await sleep(600);
      await tap(p, '#queue-btn', vp); await p.waitForSelector('#queue-panel.queue-open, #queue-panel.is-open', { timeout: 8000 }); await sleep(800); } },
    { id: '22b-queue-panel-reduced-motion', path: '/', vps: ['phone', 'desktop'], run: async (p, vp) => { await p.waitForSelector('#queue-btn', { timeout: 12000 }); await p.waitForLoadState('networkidle'); await sleep(600);
      await tap(p, '#queue-btn', vp); await p.waitForSelector('#queue-panel:not([hidden])', { state: 'attached', timeout: 8000 }); await sleep(800); } },
    { id: '23-account-menu', path: '/', run: async (p, vp) => {
      if (isMobile(vp) && await p.locator('#bottom-nav button[aria-label*="account"], .bottom-nav-item:has-text("You")').first().isVisible().catch(() => false)) await tap(p, '.bottom-nav-item:has-text("You")', vp);
      else await tap(p, '#account-menu-root button, #account-menu-root [aria-haspopup]', vp);
      await sleep(800); } },
    // Phone only: the landscape phone (844px) shows the sidebar, not the bottom bar, so it has
    // no #nav-playlists-btn (the scene timed out there on every run).
    { id: '24-playlists-sheet', path: '/', vps: ['phone'], run: async (p, vp) => { await tap(p, '#nav-playlists-btn', vp); await p.waitForSelector('#playlists-sheet.is-open', { timeout: 8000 }); await sleep(600); } },
    // Not on the phone: phone portrait has no #menu-toggle (the bottom bar replaces the
    // sidebar), so the scene timed out there on every run (2 capture failures per era).
    { id: '25-hamburger-sidebar', path: '/', vps: ['land', 'desktop'], run: async (p, vp) => { await tap(p, '#menu-toggle', vp); await sleep(700); } },
    { id: '26-settings-top', path: '/setup.html', run: async (p) => { await p.waitForLoadState('networkidle'); await sleep(800); } },
    { id: '27-settings-mid', path: '/setup.html', vps: ['phone', 'desktop'], run: async (p) => { await p.waitForLoadState('networkidle'); await sleep(800); await p.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight / 2))); await snapScroll(p); } },
    { id: '28-history', path: '/history', run: async (p) => { await p.waitForLoadState('networkidle'); await sleep(800); } },
    { id: '29-search-open', path: '/', vps: ['phone'], run: async (p, vp) => { await tap(p, '#search-toggle-btn', vp); await sleep(600); } },
    { id: '30-stats', path: '/stats.html', vps: ['phone', 'desktop'], run: async (p) => { await p.waitForLoadState('networkidle'); await sleep(800); } },
    // Sweep S2 (cards and feeds): search results, the card action menu, the watch page's related rail.
    { id: '31-search-results', path: '/?search=Harbor', vps: ['phone', 'desktop'], run: async (p) => { await p.waitForSelector('.video-card', { timeout: 12000 }); } },
    { id: '32-card-menu', path: '/', vps: ['phone', 'desktop'], run: async (p, vp) => { await p.waitForSelector('.video-card', { timeout: 12000 });
      // The card action menu (D8.5): the kebab in the first card's meta row. A tree without it
      // (before the sweep) photographs the card corners instead.
      if (await p.locator('.video-card .card-kebab').count()) { await tap(p, '.video-card .card-kebab', vp); await p.waitForSelector('.ui-sheet.is-open', { timeout: 8000 }); await sleep(500); } } },
    { id: '33-watch-related', path: `/watch.html?v=${FX.video}`, vps: ['phone', 'desktop'], run: async (p) => { await p.waitForSelector('#related-files-container a', { timeout: 12000 }); await pausePlayback(p); await scrollCenter(p, '#related-files-container a'); } },
    // Sweep S8 (Settings and forms): each Settings section by its #<collapse-key> deep link
    // (the phone opens the section's detail pane), the sign-in page, the one-off download
    // dialog, and the admin password-reset prompt.
    ...SETTINGS_SECTIONS.map(([id, name, key, scroll]) => ({ id: `6${id}-settings-${name}`, path: `/setup.html#${key}`, vps: scroll ? ['phone'] : undefined,
      run: async (p) => { await p.waitForLoadState('networkidle'); await sleep(800); await openSettingsSection(p, key); if (scroll) { await p.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight / 2))); await snapScroll(p); } } })),
    { id: '70-login-page', path: '/login', run: async (p) => { await p.context().clearCookies(); await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' }); await sleep(400); } },
    { id: '71-oneoff-dialog', path: '/', run: async (p, vp) => { const sel = vp === 'phone' ? '[data-nav="oneoff-download"]' : '#ytdlp-oneoff-btn'; await p.waitForSelector(sel, { timeout: 12000 }); await tap(p, sel, vp); await p.waitForSelector('.oneoff-modal:not([hidden]), .ui-sheet.is-open .oneoff-form', { timeout: 8000 }); await sleep(500); } },
    { id: '72-settings-password-prompt', path: '/setup.html#users', vps: ['phone', 'desktop'], run: async (p, vp) => { await p.waitForLoadState('networkidle'); await openSettingsSection(p, 'users'); await p.waitForSelector('[data-user-action="reset-password"]', { timeout: 12000 }); await tap(p, '[data-user-action="reset-password"]', vp); await p.waitForSelector('.ui-sheet.is-open', { timeout: 8000 }); await p.fill('.ui-sheet .ui-field__input', 'correct-horse'); await sleep(400); } },
    // Sweep S9 (overlays and feedback): the shared dialogs opened through the SAME globals the
    // views call (so the before tree draws its bespoke modals and the after tree its ui.sheets),
    // three queued toasts, the download status chip (a scripted status: one downloading, one
    // failed), the handoff card (a scripted presence), the Modern header sort menu, and a
    // search that finds nothing (the ui-state).
    ...S9_SCENES(FX),
    // Step 7 retire, R3 (Settings, Stats, TV): the surfaces the retire moved onto the primitives
    // that no scene above shows (the TV view, the Stats tables and About, the Settings sections
    // not in SETTINGS_SECTIONS). Stubbed payloads stand in where the fixture holds nothing.
    ...R3_SCENES(FX),
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

// Sweep S9: the overlay / feedback scenes. `openOn` evaluates `fn` on the loaded page and
// waits for the overlay; `stubFetch` answers one URL from an init script (the page reloads so
// the stub is in place before the app's first request), the rest go to the server.
function S9_SCENES(FX) {
  const stubFetch = async (p, url, body) => {
    await p.addInitScript(({ u, b }) => {
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const s = typeof input === 'string' ? input : (input && input.url) || '';
        if (s === u || s.startsWith(u + '?')) {
          // '@now' marks a timestamp that must be fresh in the page's (pinned) clock.
          const text = JSON.stringify(b).split('"@now"').join(JSON.stringify(new Date().toISOString()));
          return Promise.resolve(new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return real(input, init);
      };
    }, { u: url, b: body });
    await p.reload({ waitUntil: 'networkidle' });
  };
  const openOn = async (p, fn, arg, sel) => {
    await p.waitForLoadState('networkidle');
    await p.evaluate(fn, arg);
    await p.waitForSelector(sel, { timeout: 8000 });
    await sleep(600);
  };
  const SHEET = '.ui-sheet.is-open, .modal-backdrop, .hard-delete-modal-backdrop';
  const status = { subscriptions: {}, breaker: null, oneShots: {
    j1: { state: 'downloading', percent: 42, title: 'Harbor Workshop - Bench build, part 2', label: 'Harbor Workshop', updatedAt: '@now' },
    j2: { state: 'error', title: 'Northbound Field Notes - River walk', error: 'HTTP Error 403: Forbidden', url: 'https://example.com/v/2', updatedAt: '@now' },
  } };
  return [
    { id: '80-toasts-queued', path: '/', run: async (p) => { await openOn(p, () => {
      window.showToast('Added to queue', { label: 'Undo', onAction() {} });
      window.showToast('Saved');
      window.showToast('Could not share the link.');
    }, null, '.ui-toast.is-visible, .toast'); } },
    { id: '81-dl-chip', path: '/', run: async (p) => { await stubFetch(p, '/api/subscriptions/status', status); await p.waitForSelector('#dl-status-chip:not([hidden])', { timeout: 12000 }); await sleep(600); } },
    { id: '82-dl-chip-expanded', path: '/', run: async (p, vp) => { await stubFetch(p, '/api/subscriptions/status', status); await p.waitForSelector('#dl-status-chip:not([hidden])', { timeout: 12000 }); await tap(p, '#dl-status-chip .dl-status-chip-summary', vp); await sleep(600); } },
    { id: '83-trash-confirm', path: '/', run: async (p) => { await openOn(p, () => window.showConfirmModal('Move to Trash?',
      'Move <strong>Bench build, part 2</strong> to Trash?<br><br><span style="color:var(--yt-red); font-weight:bold;">The file leaves your library now and is permanently removed when the Trash retention window empties it:</span><br><code style="word-break:break-all; font-size:11px;">/media/Harbor Workshop/Bench build, part 2.mp4</code>',
      () => {}, { confirm: 'Move to Trash', danger: true }), null, SHEET); } },
    // step 7: the checkbox dialog (showHardDeleteModal) is retired; a local file's delete is the one danger ui.confirm with main.js's copy.
    { id: '84-local-delete', path: '/', run: async (p) => { await openOn(p, () => window.ui.confirm(window.cardDeleteConfirmCopy({ title: 'Garden party 2019', filePath: '/media/Home Videos/Garden party 2019.mp4' })), null, SHEET); } },
    { id: '85-share-choice', path: '/', run: async (p) => { await openOn(p, () => window.showChoiceModal('Share', [{ label: 'Share video', onPick() {} }, { label: 'Share at current time (1:05)', onPick() {} }]), null, SHEET); } },
    { id: '86-move-dialog', path: '/', run: async (p) => { await openOn(p, () => window.showMoveModal({ title: 'Garden party 2019' }, ['/media/Home Videos', '/media/Harbor Workshop', '/media/Archive'], () => {}), null, SHEET); } },
    { id: '87-transcript-dialog', path: '/', vps: ['land', 'desktop'], run: async (p) => { await openOn(p, () => window.showTranscriptModal({
      text: 'Bench build, part 2\nPublished January 5, 2024\nHarbor Workshop\n\nWelcome back to the shop.\nToday we finish the bench.\nFirst, the legs.\n',
      aiPrompts: [{ id: 's', name: 'Summarize', text: 'Summarize this.' }], shareAi() {} }), null, SHEET); } },
    { id: '88-attribution-picker', path: '/', run: async (p) => { await openOn(p, () => window.showAttributionPicker([
      { channelUrl: 'https://example.com/@harbor', channelName: 'Harbor Workshop', source: 'subscription' },
      { channelUrl: 'https://example.com/@north', channelName: 'Northbound Field Notes', source: 'library' },
    ], { title: 'Attribute this folder to', showRelocate: true }, () => {}), null, SHEET); } },
    { id: '89-handoff-card', path: '/', run: async (p) => { await stubFetch(p, '/api/handoff', { presence: {
      deviceId: 'phone-2', deviceLabel: 'iPhone', kind: 'media', mediaId: FX.video, state: 'playing', position: 125, duration: 480, ageSeconds: 12,
      title: 'Bench build, part 2', thumbnailUrl: `/thumbnail/${FX.video}`, href: `/watch.html?v=${FX.video}` } });
      await p.waitForSelector('#handoff-card:not([hidden])', { timeout: 12000 }); await sleep(800); } },
    { id: '90-sort-menu', path: '/', vps: ['phone', 'desktop'], run: async (p, vp) => { await p.evaluate(() => localStorage.setItem('ft-modern-mode', 'on')); await p.reload({ waitUntil: 'networkidle' });
      await p.waitForSelector('.modern-sort-btn', { timeout: 12000 }); await tap(p, '.modern-sort-btn', vp); await sleep(600); } },
    { id: '91-search-empty', path: '/?search=zzqqxx', vps: ['phone', 'desktop'], run: async (p) => { await p.waitForLoadState('networkidle'); await sleep(900); } },
  ];
}

// Step 7 retire, R3: every selector a scene waits on or taps exists in BOTH the pre-retire tree and
// the retired one, so one capture.js shoots the before/after pair. The fixture has no TV library,
// no duplicates, no trash and nothing hidden from the feed, so those payloads are stubbed (the
// poster / thumbnail images then fail alike on both sides).
function R3_SCENES(FX) {
  const stubFetches = async (p, map) => {
    await p.addInitScript((m) => {
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const s = typeof input === 'string' ? input : (input && input.url) || '';
        const hit = Object.keys(m).find((u) => s === u || s.startsWith(u + '?'));
        if (hit && (!init || !init.method || init.method === 'GET')) {
          return Promise.resolve(new Response(JSON.stringify(m[hit]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return real(input, init);
      };
    }, map);
    await p.reload({ waitUntil: 'networkidle' });
  };
  const ep = (id, n, title, dur) => ({ id, seasonNum: 1, episodeNum: n, title, durationSec: dur });
  const TV = {
    '/api/tv': { shows: [
      { id: 'sh1', name: 'Harbor Nights', seasonCount: 2, episodeCount: 14 },
      { id: 'sh2', name: 'The Long Field', seasonCount: 1, episodeCount: 6 },
      { id: 'sh3', name: 'Signal Box', seasonCount: 1, episodeCount: 1 },
    ] },
    '/api/tv/continue': { episodes: [{ id: 'e2', showId: 'sh1', showName: 'Harbor Nights', seasonNum: 1, episodeNum: 2, title: 'Low Tide', durationSec: 2580, position: 1290 }] },
    '/api/tv/sh1': { id: 'sh1', name: 'Harbor Nights', seasons: [
      { seasonNum: 1, label: 'Season 1', episodes: [ep('e1', 1, 'Pilot', 3725), ep('e2', 2, 'Low Tide', 2580), ep('e3', 3, 'The Lighthouse Keeper Who Stayed Up All Night', 2610)] },
      { seasonNum: 2, label: 'Season 2', episodes: [ep('e4', 1, 'Return', 2700)] },
    ] },
  };
  const DUPS = { nameGroups: [{ key: 'Bench build, part 2.mp4', totalBytes: 3000000, wastedBytes: 1500000, items: [
    { id: 'd1', filePath: '/media/Harbor Workshop/Bench build, part 2.mp4', size: 1500000 },
    { id: 'd2', filePath: '/media/Archive/Bench build, part 2.mp4', size: 1500000 },
  ] }], idGroups: [] };
  const TRASH = { items: [
    { trashId: 't1', title: 'Garden party 2019', size: 734003200, trashedAt: Date.UTC(2026, 7, 30), type: 'video' },
    { trashId: 't2', title: 'Bench build, part 1', size: 52428800, trashedAt: Date.UTC(2026, 7, 25), type: 'video' },
  ], total: 2, totalSizeBytes: 786432000, retentionDays: 30 };
  const HIDDEN = { items: [
    { id: FX.video, title: 'Bench build, part 2', channelName: 'Harbor Workshop' },
    { id: FX.videoUnsub || FX.video, title: 'River walk at dawn', channelName: 'Northbound Field Notes' },
  ] };
  const section = async (p, key) => { await p.waitForLoadState('networkidle'); await sleep(800); await openSettingsSection(p, key); };
  return [
    { id: '93-tv-shows', path: '/tv', run: async (p) => { await stubFetches(p, TV); await p.waitForSelector('.show-card', { timeout: 12000 }); await sleep(800); } },
    { id: '94-tv-show-detail', path: '/tv', run: async (p, vp) => { await stubFetches(p, TV); await p.waitForSelector('.show-card', { timeout: 12000 });
      await tap(p, '.show-card', vp); await p.waitForSelector('.tv-episode-list', { timeout: 8000 }); await sleep(800); } },
    { id: '95-stats-av', path: '/stats.html', run: async (p) => { await section(p, 'videos-audio'); await p.waitForSelector('#stats-av-list [role="row"]', { timeout: 12000 }); await sleep(400); } },
    { id: '96-stats-duplicates', path: '/stats.html', run: async (p, vp) => { await stubFetches(p, { '/api/duplicates': DUPS }); await section(p, 'duplicates');
      await p.waitForSelector('.stable-expand-btn, .dup-expand', { timeout: 12000 }); await tap(p, '.stable-expand-btn, .dup-expand', vp); await sleep(500); } },
    { id: '97-stats-about', path: '/stats.html', run: async (p) => { await section(p, 'about-filetube'); await sleep(400); } },
    { id: '98-settings-trash', path: '/setup.html', run: async (p) => { await stubFetches(p, { '/api/trash': TRASH }); await section(p, 'trash'); await sleep(400); } },
    { id: '99-settings-hidden', path: '/setup.html', run: async (p) => { await stubFetches(p, { '/api/feed-hidden': HIDDEN }); await section(p, 'feedhidden'); await sleep(400); } },
    { id: '9a-settings-account', path: '/setup.html', run: async (p) => { await section(p, 'account'); await sleep(400); } },
    { id: '9b-settings-book-folders', path: '/setup.html', run: async (p) => { await section(p, 'book-folders'); await sleep(400); } },
    { id: '9c-settings-transcript-ai', path: '/setup.html', run: async (p, vp) => { await section(p, 'transcript-ai');
      await tap(p, '#transcript-ai-add-btn', vp); await sleep(300); await tap(p, '#transcript-ai-add-btn', vp); await sleep(500); } },
  ];
}

// [id digit, scene name, #collapse-key, scrolled half-way (phone only)] - the Settings sections sweep S8
// migrated; a scene per section so each one's before/after pair is reviewable on its own.
const SETTINGS_SECTIONS = [
  ['0', 'appearance', 'appearance'], ['1', 'critters', 'critters'], ['2', 'folders', 'video-folders'],
  ['3', 'automation', 'automation-storage'], ['4', 'automation-mid', 'automation-storage', true],
  ['5', 'downloads', 'downloads'], ['6', 'trash', 'trash'], ['7', 'users', 'users'],
  ['8', 'backup', 'backup-restore'], ['9', 'experimental', 'experimental'],
];

// Opens a Settings section through its menu row (the admin sections reveal after the
// capability fetch, so a #hash alone lands on the menu for them).
async function openSettingsSection(page, key) {
  await page.waitForSelector(`.md-row[data-md-target="${key}"]`, { state: 'attached', timeout: 12000 });
  await page.evaluate((k) => { const r = document.querySelector(`.md-row[data-md-target="${k}"]`); if (r) r.click(); }, key);
  await sleep(500);
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
  if (clockMs) {
    await ctx.addInitScript(installPinnedClock, clockMs);
    await ctx.addInitScript(installSeededRandom, RANDOM_SEED);
  }
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
    for (const [name, fn, prep] of steps) {
      if (prep) await prep(); // before the screencast starts (see rotationSteps)
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
  // UI pass S7: leaving a Click skin from Now Playing is TWO user actions (MENU: Now Playing ->
  // the Main Menu, then MENU: dock). A step records ONE action - a G4 step that also recorded the
  // Main Menu tap 150ms before the dock would call the dock's relayout "a box moving after the
  // first changed frame" on ANY correct UI. So the Main Menu tap is the step's PREP (run before the
  // recording starts) and the recorded action is the exit itself. (Before D7 this step never
  // reached here: the rotate had already torn Pocket down, so it recorded nothing - VACUOUS.)
  const toMainMenu = async () => {
    const s = await pocketState(page);
    if (!s.full) return;
    const col = page.locator('#music-nowplaying-panel [data-skin-collapse]').first();
    if (await col.count() && await col.isVisible()) return; // a one-action exit
    if (await page.locator('#music-nowplaying-panel .ip-menuview').count()) return; // already on a menu level
    await page.locator('[data-skin-menu]').first().tap({ timeout: 2000 }).catch(() => {});
    await sleep(400);
  };
  return variant === 'spec'
    ? [['1-to-landscape', () => setOrient(false)], ['2-exit-pocket', exitPocket, toMainMenu], ['3-to-portrait', () => setOrient(true)]]
    : [['1-exit-pocket', exitPocket, toMainMenu], ['2-to-landscape', () => setOrient(false)], ['3-to-portrait', () => setOrient(true)]];
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
  ERAS, MODES, viewports, FREEZE_CSS, MASK_CSS, LAUNCH_ARGS, CONTEXT_PINS, installPinnedClock, installSeededRandom,
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
