'use strict';

// [UNIT] v1.117 (Dean bug): the left sidebar was assembled inconsistently per
// shell/per-page-controller, so pieces went missing on pages that didn't rebuild
// them:
//   (1) the "Stats" top-nav link existed only in index.html + stats.html -> it
//       vanished on watch/music/history/books/podcasts/read/setup/subscriptions
//       (Dean: "go to a video, refresh -> no Stats on the left").
//   (2) the pinned-sidebar render was booted only by main.js (home) + watch.js
//       (watch) -> pins vanished on every other page (Dean: "go to Stats, all
//       pins go out of view").
//
// This is the recurring "each shell owns its own copy of a SHARED surface" class
// (v1.41.4 watch-sidebar folders, v1.80/v1.113 enumerate-every-surface). These
// are FORCING NETS: a new shell (or a controller refactor) that drops either
// piece reddens here, not on Dean's device.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Every shell that renders the persistent left sidebar (login/welcome are
// pre-auth shells with no sidebar and are deliberately excluded).
const SIDEBAR_SHELLS = [
  'public/index.html',
  'public/watch.html',
  'public/music.html',
  'public/stats.html',
  'public/history.html',
  'public/books.html',
  'public/podcasts.html',
  'public/read.html',
  'public/setup.html',
  'lib/ytdlp/views/subscriptions.html',
];

// The three STATIC top-nav items every sidebar shell must carry, matched by
// their icon+label markup (unique to the nav -- the inline "Settings"
// links in music/books empty-states don't carry the icon, so they don't match).
const REQUIRED_NAV = [
  { label: 'Home', needle: 'icon-home"></i> Home' },
  { label: 'Settings', needle: 'icon-cog"></i> Settings' },
  { label: 'Stats', needle: 'icon-star"></i> Stats' },
];

test('every sidebar shell carries the identical top-nav (Home + Settings + Stats)', () => {
  const missing = [];
  for (const shell of SIDEBAR_SHELLS) {
    const html = read(shell);
    // sanity: it really is a sidebar shell (guards against a bad path silently passing)
    assert.ok(html.includes('id="sidebar"'), `${shell} should have #sidebar`);
    for (const item of REQUIRED_NAV) {
      if (!html.includes(item.needle)) missing.push(`${shell} -> "${item.label}"`);
    }
  }
  assert.deepEqual(missing, [], `sidebar shells missing a top-nav item:\n  ${missing.join('\n  ')}`);
});

test('the Stats link points at /stats.html on every sidebar shell', () => {
  for (const shell of SIDEBAR_SHELLS) {
    assert.match(read(shell), /href="\/stats\.html"[^>]*class="sidebar-item[^"]*"|class="sidebar-item[^"]*"[^>]*href="\/stats\.html"/,
      `${shell} Stats link should be a sidebar-item -> /stats.html`);
  }
});

// ---- the pinned-sidebar render is now a SHELL-LEVEL boot (common.js), not per-page

const commonJs = read('public/js/common.js');
const mainJs = read('public/js/main.js');
const watchJs = read('public/js/watch.js');
const setupJs = read('public/js/setup.js');

test('common.js DOMContentLoaded boot renders the pinned sidebar on EVERY shell', () => {
  // Guarded on the sidebar being present, then fetch+render (idempotent rebuild).
  assert.match(commonJs, /getElementById\('sidebar-folders-list'\)[\s\S]{0,400}?fetchAllPins\(\)\s*\.then\(\(pins\)\s*=>\s*renderPinnedSidebar\(pins\)\)/,
    'common.js boot must fetchAllPins().then(renderPinnedSidebar) when a sidebar is present');
});

test('the per-page BOOT pin render was retired from EVERY page controller (single owner = common.js)', () => {
  // common.js owns the boot render now. NO page controller may boot it itself
  // (the slim-gate WARNING: setup.js was a THIRD un-retired owner that double-
  // fetched/double-painted on /setup.html). Enumerate EVERY controller that
  // loads a sidebar, not just the two the first cut fixed -- the exact
  // "enumerate every surface" completeness this wave exists to enforce.
  //
  // A controller's boot render is `fetchAllPins().then((pins) => renderPinnedSidebar(pins))`
  // at TOP LEVEL of its init. It is legal to call the pair inside a NAMED
  // re-render helper driven by a user action (watch.js's refreshPinnedSidebar,
  // common.js's refreshAllPinSurfaces) -- so we forbid the BOOT shape
  // specifically: the render pair NOT preceded by `function ...{`.
  const bootRender = /fetchAllPins\(\)\.then\(\(pins\)\s*=>\s*renderPinnedSidebar\(pins\)\)/; // no /g: .test() must be stateless
  for (const [name, src] of [['main.js', mainJs], ['setup.js', setupJs]]) {
    // main.js + setup.js have NO legitimate re-render helper -- any occurrence is a boot.
    assert.ok(!bootRender.test(src), `${name} must not boot the pinned sidebar (common.js is the single owner)`);
  }
  // watch.js may contain the pair ONLY inside its named refreshPinnedSidebar
  // helper; assert the BOOT-shaped occurrence (right after initWatch's own setup,
  // not inside a function) is gone -- i.e. the pair appears at most where the
  // helper defines it.
  assert.ok(!/primePinnedSidebarFromCache\(\);\s*\n\s*fetchAllPins\(\)\.then/.test(watchJs),
    'watch.js should no longer BOOT the pinned sidebar (its refreshPinnedSidebar helper stays)');
  assert.ok(!/primePinnedSidebarFromCache\(\)/.test(mainJs) && !/primePinnedSidebarFromCache\(\)/.test(setupJs),
    'the warm-prime boot call must not survive in main.js/setup.js either');
});
