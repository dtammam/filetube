'use strict';
// The geometry scene list (plan D10.2). A SURFACE is one page state the checks measure; the
// runner expands each into scenes = surface x era x mode x viewport.
//
// The primitive kit (/ui-kit.html, D12 step 3) and each migrated surface. Each sweep that migrates a surface onto ui-row / ui-btn turns its
// PENDING entry below into a live one (drop `pending`, write `open`, set `min` from a real
// measurement) in the same commit - the runner lists every pending surface on each run, so
// a sweep that forgets is visible. `fast: true` puts a surface in the pre-push set (D10.2:
// channel card, notifications, Subscriptions, action bar; the kit stands in until they land).
//
// Surface fields:
//   id, owner (the D12 step or sweep), pending (the sweep that will make it live; skipped),
//   scope: a selector - measure only that subtree (default: the whole page),
//   path(FX, era, mode) -> the URL path, open(page, vp, helpers) -> drives it to the state,
//   ready: a selector that exists once the surface rendered,
//   checks: which of G1-G3 apply (plus HDR / NAV, the chrome's own rendered contracts, SHD,
//           the sheet header - sweep S9, and POP, an open menu's reach - gate r1),
//   anchor: POP only - a selector for the control that opened the menu,
//   scope: a selector the G1-G3 collectors measure inside (default: the whole page),
//   min: anti-vacuity floors - a check that measured fewer lists/rows/items/groups than this
//        FAILS as vacuous (a renamed class must not turn a check into a silent pass),
//   g1: G1 options {group, actions} (checks.js collectG1): measure every row inside one `group`
//       element as one list, and each .ui-row__actions child as its own slot,
//   fast: in the pre-push set, vps: viewports (default phone + desktop).

const ERAS = ['2021', '2014', '2009', '2005'];
const MODES = ['light', 'dark'];

const SURFACES = [
  {
    id: 'kit', owner: 'step 3', fast: true,
    path: (FX, era, mode) => `/ui-kit.html?era=${era}&mode=${mode}&icons=rounded`,
    ready: '.ui-list .ui-row',
    checks: ['G1', 'G2', 'G3'],
    // Measured on the kit at step 4 (phone and desktop, all eras): 3 lists with >= 2 rows,
    // 8 rows, 30+ icon/label pairs, 8+ button groups.
    min: { G1: { lists: 3, rows: 8 }, G2: { items: 25 }, G3: { groups: 6 } },
  },
  // Sweep S1 (the chrome). The header on Home: its glyph buttons (G2 centring, G3 equal
  // heights, scoped to <header>) and HDR - 44px buttons on the phone / 36px on desktop, level
  // and evenly spaced, the magnifier shown and rightmost on the phone and hidden on desktop,
  // the avatar hidden on the phone, the 36px search field, the bell's pre-paint reserve = the
  // real bell's box, and the desktop sidebar's rows never underlined or bold (F20, F50).
  // HDR replaces mobile-header-css-source-lock's selector locks with the rendered result.
  {
    id: 'header', owner: 'S1', fast: true,
    path: () => '/',
    ready: '#account-menu-root .account-menu-trigger',
    scope: 'header',
    checks: ['G2', 'G3', 'HDR'],
    // Measured at S1 (Home, every era/mode): phone 4 glyph buttons (queue, bell, download,
    // search) + the hamburger-less left; desktop hamburger, the search button, 4 glyphs.
    min: { G2: { items: 4 }, G3: { groups: 1 }, HDR: { buttons: 3 } },
  },
  // The phone bottom bar: G2 (a stacked tab is checked on centre-x), G3 (equal tab heights)
  // and NAV - a fixed 24px icon slot on every tab and every label on one line (F49), the one
  // selected tab in ink with its filled glyph (never red), the rest --ink-2, one weight, no
  // underline in any era (F20).
  {
    id: 'bottom-bar', owner: 'S1', fast: true, vps: ['phone'],
    path: () => '/',
    ready: '#bottom-nav .bottom-nav-item.active',
    scope: '#bottom-nav',
    checks: ['G2', 'G3', 'NAV'],
    min: { G2: { items: 5 }, G3: { groups: 1 }, NAV: { tabs: 5 } },
  },
  // Sweep S4 (D8.3, F28): the notifications panel - a ui.sheet over Home - with the seed's
  // mixed rows: six unread media rows, a podcast episode (show art), a downloader-engine event
  // and a read media row. G1: every slot (dot, avatar, text, thumbnail, kebab) starts at the
  // same x on every row, whatever its kind or read state; G2: the kebab and Close glyphs
  // centre on their buttons. Scoped to the sheet, so the page under it is not measured.
  {
    id: 'notifications', owner: 'S4', fast: true,
    path: () => '/',
    open: async (page, vp, { capture }) => {
      await page.waitForSelector('#notif-bell-btn', { timeout: 12000 });
      await capture.tap(page, '#notif-bell-btn', vp);
      await page.waitForSelector('#notif-panel.is-open #notif-panel-list .ui-row[data-notif-id]', { timeout: 10000 });
    },
    ready: '#notif-panel.is-open .ui-row[data-kind="engine"]',
    scope: '#notif-panel',
    checks: ['G1', 'G2'],
    // Measured at S4 (every era/mode, phone + desktop): 1 list of 9 rows; 9 kebabs + Close.
    min: { G1: { lists: 1, rows: 9 }, G2: { items: 10 } },
  },
  // ---- the sweeps' surfaces (D1 AC4/AC5 name these; none is pending since step 7) ----
  // Sweep S3 (D4.9; Dean's "the notification glyph not aligned with the text"): the watch
  // page's channel row, SUBSCRIBED (Subscribed pill + live bell + pin) and NOT subscribed
  // (Subscribe pill + the bell's reserved, invisible slot + pin), and the action bar. `scope`
  // measures only that row. G2: each icon toggle's glyph centred in its button; G3: the
  // row's buttons one height. Measured at S3 (all eras, phone + desktop): the channel row
  // has 2 visible icon buttons subscribed / 1 unsubscribed and one 3-button group; the bar
  // has 4 stacked buttons (Like, Listen, Transcript, More; the fixture has no share link).
  {
    id: 'channel-card', owner: 'S3', fast: true, scope: '#watch-channel',
    path: (FX) => `/watch.html?v=${FX.video}`,
    ready: '#watch-channel #notify-channel-btn:not([data-reserved])',
    checks: ['G2', 'G3'],
    min: { G2: { items: 2 }, G3: { groups: 1 } },
  },
  {
    id: 'channel-card-unsub', owner: 'S3', scope: '#watch-channel',
    path: (FX) => `/watch.html?v=${FX.videoUnsub}`,
    ready: '#watch-channel #notify-channel-btn[data-reserved]',
    checks: ['G2', 'G3'],
    min: { G2: { items: 1 }, G3: { groups: 1 } },
  },
  {
    id: 'action-bar', owner: 'S3', fast: true, scope: '#watch-actions',
    path: (FX) => `/watch.html?v=${FX.video}`,
    ready: '#watch-actions:not([data-loading]) #more-actions-btn',
    checks: ['G2', 'G3'],
    min: { G2: { items: 4 }, G3: { groups: 1 } },
  },
  // Sweep S5 (D8.9, D8.10, AC5), live since step 7: the Subscriptions page with the seed's four
  // channels - pinned and unpinned, notify on and off, paused, errored and ok. The A-Z list is
  // one ui-list per letter (one row each in the seed), so G1 measures every row under
  // .subs-sections as ONE list, trailing buttons included (pin, bell, menu: the bell's slot is
  // reserved when notify is off, so the menu never moves). G2: each row glyph centred in its
  // button, the toolbar Add glyph on its label; G3: the toolbar's buttons and each row's
  // buttons one height. (test/geometry/subscriptions.check.js keeps the F62 SPA round trip.)
  {
    id: 'subscriptions', owner: 'S5', fast: true, scope: '.subs-root',
    path: () => '/subscriptions',
    ready: '.subs-sections .ui-row[data-sub-id] .subs-more',
    checks: ['G1', 'G2', 'G3'],
    g1: { group: '.subs-sections', actions: true },
    // Measured at step 7 (every era/mode, phone + desktop): 1 grouped list of 4 rows across 4
    // A-Z sections; 13 glyph/label pairs (12 row glyphs + Add); 5 button groups (toolbar + 4 rows).
    min: { G1: { lists: 1, rows: 4 }, G2: { items: 13 }, G3: { groups: 5 } },
  },
  // Sweep S6 (AC5), live since step 7: an opened show's episode list (the seed's Harbor Lights
  // Radio, five downloaded episodes; `pod-harbor` is test/visual/seed.js's show id). The list
  // reserves two trailing columns (queue, menu) on every row; G1 measures them as slots.
  {
    id: 'podcast-episodes', owner: 'S6', scope: '#podcasts-content',
    path: () => '/podcasts?show=pod-harbor',
    ready: '#podcasts-content .podcast-episodes:not([aria-hidden]) .ui-row',
    checks: ['G1'],
    g1: { actions: true },
    min: { G1: { lists: 1, rows: 5 } },
  },
  // Sweep S9 (D4.6, AC4 G2): the sheet header - a titled confirm (the F44 dialog's shape: title,
  // body, Cancel + the danger action) with a TITLELESS sheet over it, both opened through the
  // real ui.js on the kit page. G2: the Close glyph centred in its button; G3: the confirm's
  // actions equal in height (scoped to the first dialog); SHD: on every open sheet the Close
  // sits on the header's trailing edge (titled or not), level with the title.
  {
    id: 'sheet-header', owner: 'S9',
    path: (FX, era, mode) => `/ui-kit.html?era=${era}&mode=${mode}&icons=rounded`,
    open: async (page) => {
      await page.waitForSelector('.ui-list .ui-row', { timeout: 10000 });
      await page.evaluate(() => {
        const u = window.ui;
        u.confirm({ title: 'Move this local file to Trash?', body: 'It moves to Trash and can be restored from Settings.', confirmLabel: 'Move to Trash', danger: true });
        const p = document.createElement('p');
        p.className = 'ui-confirm__body';
        p.textContent = 'A sheet with no title.';
        u.sheet({ variant: 'dialog', label: 'Untitled', content: p }).open();
      });
      await page.waitForFunction(() => document.querySelectorAll('.ui-sheet.is-open').length === 2, null, { timeout: 5000 });
      await page.waitForTimeout(450); // the sheets' open transition (--dur-sheet) settles
    },
    ready: '.ui-sheet.is-open .ui-sheet__close',
    scope: '.ui-sheet--dialog',
    checks: ['G2', 'G3', 'SHD'],
    // Measured at S9 (every era/mode, phone + desktop): the confirm's Close glyph (1 pair), its
    // Cancel / Move to Trash row (1 group), 2 open sheet headers of which 1 is titleless.
    min: { G2: { items: 1 }, G3: { groups: 1 }, SHD: { headers: 2, titleless: 1 } },
  },
  // Gate r1 (adversary 4): the card menu is reachable where its kebab sits. POP: the menu and
  // every row inside the viewport (or the menu scrolls to it), and a popover that fits beside
  // its kebab opens below it or flips above it. Desktop at 1280x800 is the r1 repro (the first
  // card's kebab at y496-528: the menu ran y528-856 with the page locked, "Move to Trash"
  // off-screen); the phone is 390x844 portrait, where the menu is a bottom sheet. `anchor` is
  // the control POP measures the popover against. Measured at the fix (every era/mode): 6 rows.
  {
    id: 'card-menu', owner: 'gate r1',
    path: () => '/',
    anchor: '.video-card .card-kebab',
    open: async (page, vp, { capture }) => {
      if (vp === 'desktop') await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForSelector('.video-card .card-kebab', { state: 'visible', timeout: 12000 });
      await capture.tap(page, '.video-card .card-kebab', vp);
      await page.waitForSelector('.ui-sheet.is-open .ui-row', { timeout: 8000 });
      await page.waitForTimeout(450); // the sheet's open transition (--dur-sheet) settles
    },
    ready: '.ui-sheet.is-open .ui-row',
    checks: ['POP'],
    min: { POP: { rows: 6 } },
  },
  // The phone turned landscape (844x390, touch): wider than the 768px sheet breakpoint, so the
  // same menu is a POPOVER with 390px of height - it fits on neither side of its kebab and
  // shifts inside the viewport (or, taller still, scrolls).
  {
    id: 'card-menu-landscape', owner: 'gate r1', vps: ['phone'],
    path: () => '/',
    anchor: '.video-card .card-kebab',
    open: async (page, vp, { capture }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForSelector('.video-card .card-kebab', { state: 'visible', timeout: 12000 });
      await capture.tap(page, '.video-card .card-kebab', vp);
      await page.waitForSelector('.ui-sheet.is-open .ui-row', { timeout: 8000 });
      await page.waitForTimeout(450);
    },
    ready: '.ui-sheet.is-open .ui-row',
    checks: ['POP'],
    min: { POP: { rows: 6 } },
  },
  // v1.359 (Dean: the phone player spans the screen side to side like YouTube): BLD measures the
  // watch page's inline player against the viewport - flush with both edges, unframed and
  // square on the phone, inside the column and framed on desktop. Measured at v1.359 (every
  // era/mode): 1 player per scene.
  {
    id: 'watch-player', owner: 'v1.359', fast: false,
    path: (FX) => `/watch.html?v=${FX.video}`,
    ready: '.watch-player-stage #player-wrapper video, .watch-player-stage #player-wrapper',
    checks: ['BLD'],
    min: { BLD: { player: 1 } },
  },
];

// The pre-push set: 5 scenes of the fast surfaces (D10.2 asked for 4 at about 20s; see below).
const FAST_SCENES = [
  // Sweeps S1 + S3 + S4: the real D10.2 surfaces replace the kit stand-ins - the chrome (its
  // cascade bug class, v1.85, is invisible to unit tests), the watch page's channel card and
  // action bar (Dean's bell-alignment complaint) and the notifications panel (D8.3, the
  // destructive path; its 2005 slot keeps retro-era coverage on a real surface). Five scenes,
  // ~12s measured: one over D10.2's four, kept because each guards a distinct bug class.
  { surface: 'notifications', era: '2005', mode: 'light', vp: 'phone' },
  { surface: 'header', era: '2021', mode: 'dark', vp: 'phone' },
  { surface: 'bottom-bar', era: '2005', mode: 'light', vp: 'phone' },
  { surface: 'channel-card', era: '2021', mode: 'dark', vp: 'phone' },
  { surface: 'action-bar', era: '2009', mode: 'dark', vp: 'desktop' },
];

// G4 sequences (AC9). `pocket-rotation` is the capture's Pocket sequence (test/visual/capture.js
// rotationSteps, variant 'spec': rotate to landscape, leave Pocket, rotate back). `kit-rotation`
// is the control: a page with no layout transitions rotated there and back, which must pass
// (and goes red under the g4 mutation) - it proves G4 can pass and can fail.
// `ignore` (one selector, recorder-side): the Click Main Menu's cover DRIFT (skin-surface.js
// Addendum E, Dean's ask: the art pane's covers pan and crossfade on their own 9s clock, a
// transform/opacity transition) moves by design while the exit step's recording runs - its
// images are skipped the way a running animation is; the pane box itself is still measured.
const G4_SEQUENCES = [
  { id: 'pocket-rotation', owner: 'S7', modes: ['dark', 'light'], ignore: '.ipm-art *' },
  // the iPod portrait lock (gate r1 QA W3): the same turn with the Sideways setting, so the UI pass D7 layout keeps its
  // real-browser rotation check (pocket-rotation above now measures the default, Upright)
  { id: 'pocket-rotation-sideways', owner: 'ipod-lock', modes: ['light'], ignore: '.ipm-art *', sideways: true },
  { id: 'kit-rotation', owner: 'step 4', modes: ['light'] },
];

// VPM (v1.364.0 W1): the viewport matrix, every phone size x the surfaces a phone lands on. iOS UA, mobile, touch,
// DPR 2 (run.js runVPM). The iPod skin is full screen in phone portrait only, so it runs the portrait sizes.
const VPM_SIZES = [[320, 568], [375, 667], [360, 640], [390, 844], [430, 932], [667, 375], [568, 320]];
const VPM_SURFACES = [
  { id: 'home', path: () => '/', ready: '#video-grid .video-card' },
  { id: 'music', path: () => '/music', ready: '.music-album-card' },
  { id: 'watch', path: (FX) => '/watch.html?v=' + encodeURIComponent(FX.video), ready: '#media-player' },
  { id: 'pocket', pocket: true, portraitOnly: true, ready: '.mms-full .ip-center' },
  { id: 'setup', path: () => '/setup.html', ready: '#view-root .setup-box' },
];
const vpmCellId = (surface, w, h) => 'VPM/' + surface + '/' + w + 'x' + h;
function vpmCells() {
  const out = [];
  for (const surf of VPM_SURFACES) {
    for (const [w, h] of VPM_SIZES) {
      if (surf.portraitOnly && w > h) continue;
      out.push({ id: vpmCellId(surf.id, w, h), surface: surf, w, h, portrait: h > w });
    }
  }
  return out;
}

module.exports = { ERAS, MODES, SURFACES, FAST_SCENES, G4_SEQUENCES, VPM_SIZES, VPM_SURFACES, vpmCells, vpmCellId };
