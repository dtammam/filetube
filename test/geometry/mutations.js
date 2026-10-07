'use strict';
// Mutation proofs for the geometry checks (LESSONS 2: presence is not binding - each check
// must go red when the geometry it guards breaks). Each mutation is a temporary stylesheet
// the runner injects into the page after it renders; nothing in the tree changes.
//
//   node test/geometry/run.js --mutants            (every mutation below; exits 1 if any survives)
//   node test/geometry/run.js --mutate g1-drop-slot (one, on the full scene set)
//
// `target` is the check that must go red and the scene it is proven on.
const { vpmCells } = require('./scenes.js');

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
  // Sweep S3 (Dean's complaint, closed by measurement): the channel row's bell glyph sits
  // 1px low in its button - the v1.340 "glyph below the text's centre line" shape.
  'g2-channel-bell-low': {
    check: 'G2', target: { surface: 'channel-card', era: '2021', mode: 'dark', vp: 'phone' },
    css: '#notify-channel-btn .ui-btn__icon{position:relative!important;top:1px!important}',
  },
  // Sweep S3: the action bar's Like glyph drifts 1px right of its caption.
  'g2-action-bar-icon': {
    check: 'G2', target: { surface: 'action-bar', era: '2005', mode: 'light', vp: 'phone' },
    css: '#like-media-btn .ui-btn__icon{position:relative!important;left:1px!important}',
  },
  // Sweep S3: the channel row's pin is taller than the Subscribe pill beside it (the v1.340
  // "Pin 3px taller than its neighbours" shape).
  'g3-channel-pin-tall': {
    check: 'G3', target: { surface: 'channel-card-unsub', era: '2014', mode: 'light', vp: 'desktop' },
    css: '#pin-channel-btn{height:35px!important}',
  },
  // G3: one button in a group is 2px taller than its siblings.
  'g3-tall-button': {
    check: 'G3', target: { surface: 'kit', era: '2009', mode: 'light', vp: 'phone' },
    css: '.ui-kit__row > .ui-btn--lg:nth-child(2){min-height:46px!important;height:46px!important}',
  },
  // ---- sweep S4: the notifications panel (F28) ----
  // G1: the old bug shape - a row without a thumbnail collapses its aside column (the kebab
  // then sits where the thumbnails are), here on the engine row.
  'g1-notif-aside-collapse': {
    check: 'G1', target: { surface: 'notifications', era: '2021', mode: 'dark', vp: 'phone' },
    css: '#notif-panel .ui-row[data-kind="engine"]{grid-template-columns:var(--lead-w) calc(var(--media-w) + var(--media-gap)) minmax(0,1fr) 0px var(--row-actions-w)!important}',
  },
  // G1: the unread dot takes space only when present (the F28 dot column), on read rows.
  'g1-notif-dot-column': {
    check: 'G1', target: { surface: 'notifications', era: '2005', mode: 'light', vp: 'desktop' },
    css: '#notif-panel .ui-row[data-kind="podcast"] > .ui-row__lead{display:none!important}',
  },
  // ---- sweeps S5 / S6, live since step 7 (G1 with the `g1` options) ----
  // G1 on Subscriptions: the AC5 bug shape - a row whose bell slot is NOT reserved (notify off)
  // lets its menu slide left into the gap. Only the actions#N slots see it: the actions box
  // itself keeps its column. The Tidewater row sits in its own A-Z section, so this also proves
  // the cross-section grouping (per ui-list it would be a one-row list, never compared).
  'g1-subs-bell-collapse': {
    check: 'G1', target: { surface: 'subscriptions', era: '2021', mode: 'dark', vp: 'phone' },
    css: '.ui-row[data-sub-id="sub-tidewater"] .ui-row__actions > :nth-child(2){display:none!important}',
  },
  // G1 on the podcast episode list: one row loses its queue button (a trashed or undownloaded
  // episode's shape) and its menu moves into the queue column.
  'g1-podcast-queue-collapse': {
    check: 'G1', target: { surface: 'podcast-episodes', era: '2009', mode: 'light', vp: 'desktop' },
    css: '.podcast-episodes .ui-row:nth-child(3) .ui-row__actions > :first-child{display:none!important}',
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
  // ---- sweep S9: the sheet header (SHD) ----
  // SHD: S1's primitive gap - a titleless sheet's Close falls back to the header's LEADING edge.
  'shd-close-leading': {
    check: 'SHD', target: { surface: 'sheet-header', era: '2021', mode: 'dark', vp: 'phone' },
    css: '.ui-sheet__close{margin-inline-start:0!important}',
  },
  // SHD: the close glyph sits 1px off centre in its button (a baseline nudge).
  'shd-close-glyph-nudge': {
    check: 'SHD', target: { surface: 'sheet-header', era: '2005', mode: 'light', vp: 'desktop' },
    css: '.ui-sheet__close .ui-btn__icon{position:relative!important;left:1px!important}',
  },
  // ---- gate r1 (adversary 4): an open menu's reach (POP) ----
  // POP: the r1 placement - the popover's top is always the kebab's bottom and its cap 90dvh
  // (ui.js placePopover's answer thrown away), so at 1280x800 the menu runs off the bottom.
  'pop-below-only': {
    check: 'POP', target: { surface: 'card-menu', era: '2021', mode: 'dark', vp: 'desktop' },
    css: '.ui-sheet--popover{top:var(--ui-anchor-y)!important;max-height:90dvh!important}',
  },
  // POP: the same on the landscape phone, where the menu fits on neither side.
  'pop-below-only-landscape': {
    check: 'POP', target: { surface: 'card-menu-landscape', era: '2014', mode: 'light', vp: 'phone' },
    css: '.ui-sheet--popover{top:var(--ui-anchor-y)!important;max-height:90dvh!important}',
  },
  // POP: the bottom sheet's rows past the viewport (a sheet pushed down 200px, not scrolling).
  'pop-bottom-sheet-low': {
    check: 'POP', target: { surface: 'card-menu', era: '2005', mode: 'light', vp: 'phone' },
    css: '.ui-sheet--bottom.is-open{transform:translateY(200px)!important}',
  },
  // ---- v1.359: the phone player edge to edge (BLD) ----
  // BLD: the v1.314 gutter padding comes back, so the player is inset 16px each side again.
  'bld-gutter-back': {
    check: 'BLD', target: { surface: 'watch-player', era: '2021', mode: 'dark', vp: 'phone' },
    css: '@media (max-width:768px){.watch-player-stage{padding-left:var(--space-8)!important;padding-right:var(--space-8)!important}}',
  },
  // BLD: the wrapper is rounded again on the phone (the old 12px radius in the 2021 era).
  'bld-rounded': {
    check: 'BLD', target: { surface: 'watch-player', era: '2021', mode: 'light', vp: 'phone' },
    css: '.watch-player-stage #player-wrapper{border-radius:12px!important}',
  },
  // BLD: the outline comes back on the phone in a retro era.
  'bld-outlined': {
    check: 'BLD', target: { surface: 'watch-player', era: '2005', mode: 'light', vp: 'phone' },
    css: '.watch-player-stage #player-wrapper{border:1px solid #888!important}',
  },
  // BLD: the title bleeds to the screen edge with the player (the page gutter dropped on the text).
  'bld-title-bleeds': {
    check: 'BLD', target: { surface: 'watch-player', era: '2014', mode: 'dark', vp: 'phone' },
    css: '#media-title{position:relative!important;left:-16px!important}',
  },
  // BLD: the bleed leaks to desktop (the stage pulled out to the page edge there too).
  'bld-desktop-bleeds': {
    check: 'BLD', target: { surface: 'watch-player', era: '2021', mode: 'dark', vp: 'desktop' },
    css: '@media (min-width:769px){.watch-player-stage #player-wrapper{margin-left:-2000px!important;margin-right:-2000px!important}}',
  },
  // G4: a layout property moves over time after a rotate (the F37 class): the kit's padding
  // slides for 400ms once the viewport turns landscape. (UI pass S7: an ANIMATION, not a
  // transition - since D7 every rotate holds html.no-motion, which zeroes transitions, so a
  // transition mutant would be masked by the fix itself; the recorder only skips elements that
  // were animating when FIRST seen, and the kit is still in portrait then.)
  'g4-sliding-padding': {
    check: 'G4', target: { sequence: 'kit-rotation', mode: 'light' },
    css: '@keyframes g4-slide{from{padding-left:0}to{padding-left:64px}}@media (orientation:landscape){.ui-kit{animation:g4-slide .4s linear both}}',
  },
  // G4 on Pocket (S7, D7): the rotation stillness itself - the sidebar drawer's transform
  // transition re-enabled through html.no-motion slides the chrome behind the skin for 300ms
  // on the rotate to landscape, which the pocket-rotation sequence must catch.
  'g4-pocket-no-stillness': {
    check: 'G4', target: { sequence: 'pocket-rotation', mode: 'dark' },
    css: 'html.no-motion.no-motion #sidebar{transition:transform .3s linear!important}',
  },
  // the iPod portrait lock (gate r1 QA W3): the Sideways (D7) turn keeps its own check - the wheel resizing with a
  // transition on the rotate (through the stillness hold) must turn pocket-rotation-sideways red.
  'g4-pocket-sideways-wheel-transition': {
    check: 'G4', target: { sequence: 'pocket-rotation-sideways', mode: 'light' },
    css: 'html.no-motion.no-motion .mms-full.mms-ipod .ip-wheel{transition:width .4s linear,height .4s linear!important}',
  },
  // VPM (v1.364.0 W1): each must turn red EXACTLY its target cells (the runner compares the red set).
  // M1: the view collapses at the smallest width only (a 320-only breakpoint gone wrong).
  'vpm-m1-viewroot-zero-320': {
    check: 'VPM', target: { cells: vpmCells().filter((c) => c.w <= 340).map((c) => c.id) },
    css: '@media (max-width: 340px){#view-root{height:0!important;overflow:hidden!important}}',
  },
  // M2: an invisible full-viewport layer that takes taps, on short viewports only (a pseudo-element:
  // querySelectorAll cannot see it, the hit tests must).
  'vpm-m2-invisible-cover-short': {
    check: 'VPM', target: { cells: vpmCells().filter((c) => c.h <= 640).map((c) => c.id) },
    css: '@media (max-height: 640px){html::after{content:"";position:fixed;inset:0;z-index:2147483647;pointer-events:auto;background:transparent}}',
  },
  // M3: a fixed minimum width (every viewport under 400px scrolls sideways).
  'vpm-m3-min-width-400': {
    check: 'VPM', target: { cells: vpmCells().filter((c) => c.w < 400).map((c) => c.id) },
    css: 'body{min-width:400px!important}',
  },
  // M4: the iPod centre button stops taking taps.
  'vpm-m4-ipod-centre-dead': {
    check: 'VPM', target: { cells: vpmCells().filter((c) => c.surface.pocket).map((c) => c.id) },
    css: '.ip-center{pointer-events:none!important}',
  },
};

module.exports = { MUTATIONS };
