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
//   checks: which of G1-G3 apply,
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
  // ---- pending: each sweep makes its surface live (D1 AC4/AC5 name these) ----
  { id: 'channel-card', owner: 'S3', pending: 'S3', note: 'watch page channel row: Subscribe / Notify / Pin (G2, G3)', checks: ['G2', 'G3'], fast: true },
  { id: 'action-bar', owner: 'S3', pending: 'S3', note: 'watch action bar, stacked buttons (G2, G3)', checks: ['G2', 'G3'], fast: true },
  { id: 'notifications', owner: 'S4', pending: 'S4', note: 'notifications panel: mixed media / podcast / engine rows (G1, G2)', checks: ['G1', 'G2'], fast: true },
  { id: 'subscriptions', owner: 'S5', pending: 'S5', note: 'Subscriptions rows: pinned and unpinned, errored and ok (G1, G2, G3)', checks: ['G1', 'G2', 'G3'], fast: true },
  { id: 'podcast-episodes', owner: 'S6', pending: 'S6', note: 'a podcast episode list (G1)', checks: ['G1'] },
  { id: 'sheet-header', owner: 'S9', pending: 'S9', note: 'a sheet header: title + close (G2)', checks: ['G2'] },
];

// The pre-push set: 4 scenes of the fast surfaces (D10.2, about 20s). While the kit is the
// only live surface, the 4 are the kit on the phone in Modern light + dark and the two
// most different retro eras.
const FAST_SCENES = [
  { surface: 'kit', era: '2021', mode: 'light', vp: 'phone' },
  { surface: 'kit', era: '2021', mode: 'dark', vp: 'desktop' },
  { surface: 'kit', era: '2005', mode: 'light', vp: 'phone' },
  { surface: 'kit', era: '2009', mode: 'dark', vp: 'phone' },
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
