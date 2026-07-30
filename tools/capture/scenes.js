'use strict';
// Scene definitions keyed to the Tier 3 capture manifest (scene IDs 01-24).
// PURE DATA + a small action vocabulary - no Playwright imports, so the
// definitions survive a driver swap. Each action is interpreted by the
// driver (capture.js): goto, click, hover, wait, evalJs, setViewportWidth,
// scrollTo. Determinism: the driver freezes animations/transitions at
// END-STATE (injected CSS) before every shot - baselines photograph settled
// UI, not mid-tween frames; the manifest's "mid-fade" intent is superseded
// by frozen end-state as the MORE comparable baseline (recorded in the run
// record).
//
// notAutomatable: scenes needing live server jobs, real media playback
// frames, or judgment states - they fall back to Dean's manual list rather
// than flaky automation.

const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const ERAS_P1 = [['2021', 'light'], ['2021', 'dark']];

const scenes = [
  { id: '01-watch-modal', path: '/watch.html?v=FIXTURE_VIDEO', actions: [
    ['wait', '#media-title'], ['click', '#ytdlp-oneoff-btn'], ['wait', '.oneoff-modal']],
    note: 'modal at frozen end-state (supersedes mid-fade - deterministic)' },
  { id: '05-watch-cold', path: '/watch.html?v=FIXTURE_VIDEO', actions: [
    ['wait', '#media-title'], ['scrollTo', '.video-description']] },
  { id: '06-home-grid', path: '/', actions: [['wait', '.video-card'], ['hover', '.video-card']],
    hoverDesktopOnly: true },
  { id: '07-home-sort', path: '/', actions: [['wait', '.video-card'], ['scrollTo', '.section-title'],
    ['click', '.sort-select-btn'], ['wait', '.sort-menu']] },
  { id: '08-music-lib', path: '/music.html', actions: [['wait', '.music-album-art,.music-tab']] },
  { id: '09-music-drill', path: '/music.html', actions: [['wait', '.music-album-art'], ['click', '.music-album-art'], ['wait', '.music-drill-sticky']] },
  { id: '11-subs-top', path: '/subscriptions', actions: [['wait', '.sub-list-header-actions']] },
  { id: '12-subs-sheet', path: '/subscriptions', actions: [['wait', '.sub-row-kebab'], ['click', '.sub-row-kebab'], ['wait', '.sub-sheet-backdrop:not([hidden])']] },
  { id: '12b-notif-panel', path: '/', actions: [['wait', '#notif-bell-btn'], ['click', '#notif-bell-btn'], ['wait', '.notif-panel']] },
  { id: '14-reader', path: '/read.html?id=FIXTURE_BOOK', actions: [['wait', '.reader-topbar']] },
  { id: '15-books', path: '/books.html', actions: [['wait', '.books-shelf-chip,.book-row-cover']] },
  { id: '16-stats', path: '/stats.html', actions: [['wait', '.stat-tile-value']] },
  { id: '17-setup-a', path: '/setup.html', actions: [['wait', '.action-footer']] },
  { id: '17b-setup-footer-wide', path: '/setup.html', actions: [['wait', '.action-footer'], ['setViewportWidth', 700], ['scrollTo', '.action-footer']] },
  { id: '17c-setup-footer-narrow', path: '/setup.html', actions: [['wait', '.action-footer'], ['setViewportWidth', 480], ['scrollTo', '.action-footer']] },
  { id: '18-reloc-preview', path: '/subscriptions', actions: [
    ['wait', '#sub-reheat-preview-btn'], ['click', '#sub-reheat-preview-btn'], ['wait', '.reloc-preview-panel']],
    note: 'needs a library with >=1 relocatable item or shows the empty preview - still a stable frame' },
  { id: '21-hard-delete', path: '/', actions: [['wait', '.video-card'], ['hover', '.video-card'],
    ['click', '.card-delete-btn'], ['click', '.card-delete-confirm'], ['wait', '.hard-delete-modal-backdrop:not([hidden])']],
    note: 'CANCEL after shot - driver presses Escape; deletes nothing without confirm', p: 'P2' },
  // Added by the Step 3 ledger coverage audit (2026-07-30): these surfaces
  // carry ledgered deltas but had no scene.
  { id: '25-login', path: '/login', actions: [['wait', '.login-submit']],
    note: 'pre-auth page - ledger 3a touches the wordmark pill + era-switch chips; reachable without credentials' },
  { id: '26-playlists-sheet', path: '/', viewports: ['phone'], actions: [
    ['wait', '#nav-playlists-btn'], ['click', '#nav-playlists-btn'], ['wait', '.playlists-sheet:not([hidden])']],
    note: 'phone-only bottom-nav sheet - ledger 3c touches its backdrop scrim (0.5->0.55)' },
];

const p2EraSpotChecks = { eras: [['2005', 'light']], sceneIds: ['06-home-grid', '05-watch-cold', '11-subs-top'], viewport: 'desktop' };
const p3 = [
  { id: '22-chapters-editor', path: '/watch.html?v=FIXTURE_VIDEO', eras: [['2005', 'light'], ['2009', 'light']],
    actions: [['wait', '#media-title'], ['evalJs', "typeof showChaptersEditor==='function'&&showChaptersEditor()"], ['wait', '.chapters-editor-textarea']],
    note: 'monospace Tier 4 target' },
  { id: '23-ghost-red-books', path: '/books.html', eras: [['2014', 'light']], actions: [['wait', '.book-progress-fill,.books-shelf-chip']] },
  { id: '23b-ghost-red-reloc', path: '/subscriptions', eras: [['2014', 'light']], actions: [['wait', '#sub-reheat-preview-btn'], ['click', '#sub-reheat-preview-btn'], ['wait', '.reloc-preview-panel']] },
  { id: '23c-ghost-red-stats', path: '/stats.html', eras: [['2014', 'light']], actions: [['wait', '.stat-tile-value'], ['scrollTo', 'footer,.stats-meta-text']] },
  { id: '23d-ghost-red-reader', path: '/read.html?id=FIXTURE_BOOK', eras: [['2014', 'light']], actions: [['wait', '.reader-topbar']],
    note: 'reader progress fill is the 9th ghost-red surface (coverage-audit addition); progress state comes from the fixture book' },
  { id: '24-r7-radii', path: '/', eras: [['2005', 'light'], ['2009', 'light']], actions: [['wait', '.video-card']] },
];

// Manual-scene classes (Dean's ruling 4). VALUE CORRECTIONS 2026-07-30,
// re-verified against style.css during ledger authoring:
// LEDGER-TOUCHED (gate-blocking; Dean's BEFORE-shots required pre-Step 3):
//   13-toast (3a padding 18->16 ONLY - the toast has NO scrim, its
//   background is themed var(--bg-sidebar); the earlier ".85->.8" claim
//   was wrong), 04-resume (3c .85->.8 - the earlier ".75" was wrong; the
//   .75 sites are the speed-badge and fullscreen controls),
//   10-audio-expanded (3d elevation shadows .5/.6->.45).
// COVERAGE GAP (found by the ledger census): the chapters MENU
//   (3a paddings 14->12 + 3d shadow, style.css 5283/5417/5436) has no
//   scene and needs chapters on the fixture video - a manual before-shot
//   is RECOMMENDED if the fixture has chapters; otherwise it is a Stop B
//   on-device judgment item, Dean's call.
// JUDGMENT-ONLY (does NOT block the gate) - corrections to Dean's guesses:
//   03-cc is the PROTECTED carve-out (no ledger touches it; a before-shot
//   is still recommended as the protection witness, not required);
//   11b-reheat-running: zero 14px/0.2s/scrim/shadow targets in the chip
//   region (grep-verified); 02-playing frame: its skip-hover 0.8 is an
//   EXACT-value adoption (zero delta).
const notAutomatable = [
  { id: '02-watch-playing', cls: 'JUDGMENT-ONLY', why: 'real playback frame - video pixels are codec/device-dependent even seeked+paused; TRUE-DEVICE MANUAL' },
  { id: '03-cc-overlay', cls: 'JUDGMENT-ONLY (protection witness recommended)', why: 'needs the designated bright test asset + caption track playing; caption line pixels depend on media - MANUAL (the 0.85 legibility floor is a judgment surface anyway)' },
  { id: '04-resume-overlay', cls: 'LEDGER-TOUCHED (gate-blocking)', why: 'needs per-user progress state >threshold on the fixture video; automatable ONLY if the env seeds progress - falls to manual unless Dean seeds it' },
  { id: '10-audio-expanded', cls: 'LEDGER-TOUCHED (gate-blocking)', why: 'audio playback + expand gesture; vinyl spin frozen is fine but artwork/media pixels are env media - MANUAL' },
  { id: '11b-reheat-running', cls: 'JUDGMENT-ONLY', why: 'live server batch state (chip mid-run, Cancel swapped) - inherently transient; MANUAL' },
  { id: '13-toast', cls: 'LEDGER-TOUCHED (gate-blocking)', why: 'requires a mutating action (pin toggle) against live data; MANUAL to avoid state churn in baselines' },
  { id: '19-2005-pass', cls: 'automated', why: 'covered by p2EraSpotChecks above - automated' },
  { id: '20-768-boundary', cls: 'automated', why: 'covered by 17b/17c width steps for setup; home/watch boundary shots automated via setViewportWidth in the matrix runner' },
];

module.exports = { VIEWPORTS, ERAS_P1, scenes, p2EraSpotChecks, p3, notAutomatable };
