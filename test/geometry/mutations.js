'use strict';
// Mutation proofs for the geometry checks (LESSONS 2: presence is not binding - each check
// must go red when the geometry it guards breaks). Each mutation is a temporary stylesheet
// the runner injects into the page after it renders; nothing in the tree changes.
//
//   node test/geometry/run.js --mutants            (every mutation below; exits 1 if any survives)
//   node test/geometry/run.js --mutate g1-drop-slot (one, on the full scene set)
//
// `target` is the check that must go red and the scene it is proven on.
const MUTATIONS = {
  // G1: a row drops its reserved lead slot (the ui-row grid then packs media/body/aside one
  // column left) - the "optional child moved a column" bug AC5 exists for.
  'g1-drop-slot': {
    check: 'G1', target: { surface: 'kit', era: '2021', mode: 'light', vp: 'phone' },
    css: '.ui-list > .ui-row:nth-child(2) > .ui-row__lead{display:none!important}',
  },
  // G1 at the tolerance: one row is inset by 1px, so every one of its slots starts 1px right
  // of the other rows' (the check's 0.5px tolerance must not swallow a 1px column drift).
  // (A wider media child alone does NOT move a column - the grid track holds - which is the
  // contract; a first draft of this mutant proved exactly that and survived.)
  'g1-row-inset-1px': {
    check: 'G1', target: { surface: 'kit', era: '2014', mode: 'dark', vp: 'desktop' },
    css: '.ui-list > .ui-row:nth-child(3){transform:translateX(1px)!important}',
  },
  // G2: the icon inside ui-btn sits 1px low (a vertical-align / baseline nudge).
  'g2-nudge-btn-icon': {
    check: 'G2', target: { surface: 'kit', era: '2021', mode: 'dark', vp: 'phone' },
    css: '.ui-btn--md .ui-btn__icon{position:relative!important;top:1px!important}',
  },
  // G2 on a stacked button (icon over label, the action bar shape): the icon sits 1px right
  // of the label's centre line (the stack is checked on centre-x).
  'g2-nudge-stack-icon': {
    check: 'G2', target: { surface: 'kit', era: '2014', mode: 'light', vp: 'phone' },
    css: '.ui-btn--stack .ui-btn__icon{position:relative!important;left:1px!important}',
  },
  // G2: an icon in a ui-row (the settings chevron) sits 1px low.
  'g2-nudge-row-icon': {
    check: 'G2', target: { surface: 'kit', era: '2005', mode: 'light', vp: 'desktop' },
    css: '.ui-row .ui-row__actions > .ui-icon{transform:translateY(1px)!important}',
  },
  // G3: one button in a group is 2px taller than its siblings.
  'g3-tall-button': {
    check: 'G3', target: { surface: 'kit', era: '2009', mode: 'light', vp: 'phone' },
    css: '.ui-kit__row > .ui-btn--lg:nth-child(2){min-height:46px!important;height:46px!important}',
  },
  // ---- sweep S1: the chrome's rendered contracts (HDR, NAV) ----
  // HDR: the v1.85 device-pass bug - a later same-specificity base rule hides the phone's
  // search magnifier (the selector lock this check replaced could only pin the scoping).
  'hdr-cascade-hides-magnifier': {
    check: 'HDR', target: { surface: 'header', era: '2021', mode: 'dark', vp: 'phone' },
    css: 'header .header-right > .search-toggle-btn{display:none!important}',
  },
  // HDR: the bell's pre-paint reserve disc is 2px smaller than the real glyph (the reveal
  // would shift) - header-right-reserve's old 22px value lock, measured instead.
  'hdr-bell-reserve-shift': {
    check: 'HDR', target: { surface: 'header', era: '2014', mode: 'light', vp: 'desktop' },
    css: '.notif-bell-skel{width:20px!important;height:20px!important}',
  },
  // HDR: F50 - the selected sidebar row turns bold again.
  'hdr-sidebar-bold': {
    check: 'HDR', target: { surface: 'header', era: '2009', mode: 'dark', vp: 'desktop' },
    css: '.sidebar-item.active{font-weight:700!important}',
  },
  // NAV: F49 - the You tab's slot grows, so its label sits lower than the others.
  'nav-you-label-lower': {
    check: 'NAV', target: { surface: 'bottom-bar', era: '2021', mode: 'light', vp: 'phone' },
    css: '#bottom-nav [data-nav="you"] .ui-btn__icon{height:28px!important}',
  },
  // NAV: D8.8 - the selected tab goes red again.
  'nav-active-red': {
    check: 'NAV', target: { surface: 'bottom-bar', era: '2021', mode: 'dark', vp: 'phone' },
    css: '.bottom-nav > .bottom-nav-item.active{color:var(--accent)!important}',
  },
  // NAV: F20 - the 2005 era's `a` underline reaches the tabs again.
  'nav-2005-underline': {
    check: 'NAV', target: { surface: 'bottom-bar', era: '2005', mode: 'light', vp: 'phone' },
    css: '[data-theme="2005"] #bottom-nav a{text-decoration:underline!important}',
  },
  // G4: a layout property transitions on rotate (the F37 class): the kit's padding slides
  // for 400ms after the viewport changes.
  'g4-sliding-padding': {
    check: 'G4', target: { sequence: 'kit-rotation', mode: 'light' },
    css: '.ui-kit{transition:padding-left .4s linear!important}@media (orientation:landscape){.ui-kit{padding-left:64px!important}}',
  },
};

module.exports = { MUTATIONS };
