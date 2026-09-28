'use strict';
// The geometry scene list (plan D10.2). A SURFACE is one page state the checks measure; the
// runner expands each into scenes = surface x era x mode x viewport.
//
// Today only the primitive kit (/ui-kit.html, D12 step 3) is built from ui-* primitives, so
// G1-G3 run against it. Each sweep that migrates a surface onto ui-row / ui-btn turns its
// PENDING entry below into a live one (drop `pending`, write `open`, set `min` from a real
// measurement) in the same commit - the runner lists every pending surface on each run, so
// a sweep that forgets is visible. `fast: true` puts a surface in the pre-push set (D10.2:
// channel card, notifications, Subscriptions, action bar; the kit stands in until they land).
//
// Surface fields:
//   id, owner (the D12 step or sweep), pending (the sweep that will make it live; skipped),
//   path(FX, era, mode) -> the URL path, open(page, vp, helpers) -> drives it to the state,
//   ready: a selector that exists once the surface rendered,
//   checks: which of G1-G3 apply (plus HDR / NAV, the chrome's own rendered contracts),
//   scope: a selector the G1-G3 collectors measure inside (default: the whole page),
//   min: anti-vacuity floors - a check that measured fewer lists/rows/items/groups than this
//        FAILS as vacuous (a renamed class must not turn a check into a silent pass),
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
  // ---- pending: each sweep makes its surface live (D1 AC4/AC5 name these) ----
  { id: 'channel-card', owner: 'S3', pending: 'S3', note: 'watch page channel row: Subscribe / Notify / Pin (G2, G3)', checks: ['G2', 'G3'], fast: true },
  { id: 'action-bar', owner: 'S3', pending: 'S3', note: 'watch action bar, stacked buttons (G2, G3)', checks: ['G2', 'G3'], fast: true },
  { id: 'notifications', owner: 'S4', pending: 'S4', note: 'notifications panel: mixed media / podcast / engine rows (G1, G2)', checks: ['G1', 'G2'], fast: true },
  { id: 'subscriptions', owner: 'S5', pending: 'S5', note: 'Subscriptions rows: pinned and unpinned, errored and ok (G1, G2, G3)', checks: ['G1', 'G2', 'G3'], fast: true },
  { id: 'podcast-episodes', owner: 'S6', pending: 'S6', note: 'a podcast episode list (G1)', checks: ['G1'] },
  { id: 'sheet-header', owner: 'S9', pending: 'S9', note: 'a sheet header: title + close (G2)', checks: ['G2'] },
];

// The pre-push set: 4 scenes of the fast surfaces (D10.2, about 20s). Until the D10.2 four
// land, the kit (Modern light, 2005) and the chrome (sweep S1) stand in.
const FAST_SCENES = [
  { surface: 'kit', era: '2021', mode: 'light', vp: 'phone' },
  { surface: 'kit', era: '2005', mode: 'light', vp: 'phone' },
  // Sweep S1: the chrome rides every page and its cascade bug class (v1.85) is invisible to
  // unit tests, so the header and the bar take two of the kit's four stand-in slots (the
  // set stays 4 scenes, D10.2).
  { surface: 'header', era: '2021', mode: 'dark', vp: 'phone' },
  { surface: 'bottom-bar', era: '2005', mode: 'light', vp: 'phone' },
];

// G4 sequences (AC9). `pocket-rotation` is the capture's Pocket sequence (test/visual/capture.js
// rotationSteps, variant 'spec': rotate to landscape, leave Pocket, rotate back). `kit-rotation`
// is the control: a page with no layout transitions rotated there and back, which must pass
// (and goes red under the g4 mutation) - it proves G4 can pass and can fail.
const G4_SEQUENCES = [
  { id: 'pocket-rotation', owner: 'S7', modes: ['dark', 'light'] },
  { id: 'kit-rotation', owner: 'step 4', modes: ['light'] },
];

module.exports = { ERAS, MODES, SURFACES, FAST_SCENES, G4_SEQUENCES };
