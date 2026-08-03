'use strict';

// [UNIT] v1.69.0 T8 - the Podcasts place's nav wiring (common.js router
// helpers + source locks, the music-nav test's pattern) and the podcasts.js
// controller's pure helpers.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const common = require('../../public/js/common.js');
const pod = require('../../public/js/podcasts.js');

test('deriveRouteView + activeNavItem map /podcasts; existing mappings untouched', () => {
  assert.equal(common.deriveRouteView('/podcasts'), 'podcasts');
  assert.equal(common.deriveRouteView('/podcasts.html'), 'podcasts');
  assert.equal(common.deriveRouteView('/podcastart/abc'), null, 'asset routes never become views');
  assert.equal(common.activeNavItem('/podcasts', ''), 'podcasts');
  assert.equal(common.activeNavItem('/music', ''), 'music');
  assert.equal(common.activeNavItem('/history', ''), 'history');
});

test('shouldInjectPodcastsNav gates on CONTENT (>=1 show) - zero shows = byte-identical chrome', () => {
  assert.equal(common.shouldInjectPodcastsNav({ shows: 1, episodes: 0 }), true);
  assert.equal(common.shouldInjectPodcastsNav({ shows: 3, episodes: 500 }), true);
  assert.equal(common.shouldInjectPodcastsNav({ shows: 0, episodes: 0 }), false);
  assert.equal(common.shouldInjectPodcastsNav({}), false);
  assert.equal(common.shouldInjectPodcastsNav(null), false);
  assert.equal(common.shouldInjectPodcastsNav({ shows: 'junk' }), false);
});

test('SOURCE-LOCK: the sidebar Podcasts entry rides the Library section, ordered between Books and History (the bottom-bar item is v1.71 static shell HTML, not an injection)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  // v1.71 (gate S1): the pre-v1.71 half of this lock asserted "never
  // bottom-nav" - that policy was REVERSED by Dean's ruling (an optional,
  // default-hidden bottom-bar item). The injector still never mints one
  // (the item is static HTML in every shell + BOTTOM_NAV_OPTIONAL).
  assert.ok(!src.includes("setAttribute('data-nav', 'podcasts')"), 'no INJECTED bottom-nav Podcasts item - the shell HTML owns it');
  // Gate S7: the earlier "'podcasts']" spelling matched DEFAULT_HIDDEN too,
  // so removing podcasts from the OPTIONAL roster (killing the ONLY opt-in
  // path) survived the suite. Bind the roster membership itself.
  // v1.72: music + books joined the roster (cap 2) - the lock binds the
  // FULL list so a silent roster change can never pass as noise.
  assert.ok(src.includes("'oneoff-download', 'theme', 'podcasts', 'music', 'books']"), 'podcasts/music/books ride BOTTOM_NAV_OPTIONAL (the Settings toggle is the only opt-in path)');
  assert.ok(src.includes("BOTTOM_NAV_DEFAULT_HIDDEN = ['podcasts', 'music', 'books']"), 'all three kind items are default-hidden - nobody\'s bar changes on upgrade');
  assert.ok(src.includes("injectLibraryNavEntry('podcasts', '/podcasts', 'Podcasts'"), 'Library-section entry via the shared helper');
  // Books anchors above Podcasts; Podcasts anchors above History.
  assert.ok(src.includes("(key === 'books')\n      ? (document.querySelector('[data-nav-sidebar=\"podcasts\"]') || document.querySelector('[data-nav-sidebar=\"history\"]') || foldersList)"), 'Books sits above Podcasts');
  assert.ok(src.includes("(key === 'podcasts')\n        ? (document.querySelector('[data-nav-sidebar=\"history\"]') || foldersList)"), 'Podcasts sits above History');
  assert.ok(src.includes("podcasts: '/podcasts'"), 'hrefByNavKey lights the sidebar link after SPA nav');
  assert.ok(src.includes("podcasts: '/js/podcasts.js'"), 'the podcasts view script is lazy-loadable');
  assert.ok(src.includes('href="/podcasts" class="sidebar-item"'), 'the Playlists sheet lists Podcasts when enabled');
  // The gate probes /api/podcasts/health, injecting only on shows > 0.
  assert.ok(src.includes("fetch('/api/podcasts/health')"), 'capability probe hits the health route');
});

test('SOURCE-LOCK (gate W2): podcasts init re-adopts a FULL player into the fresh #player-slot - a podcasts->podcasts swap must never strand live audio in a discarded #view-root', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../public/js/podcasts.js'), 'utf8');
  // The exact re-adopt condition: a FULL player ALWAYS re-mounts (same-view
  // swaps do not dock); a docked one expands only on ?nowplaying=1.
  assert.ok(js.includes("pState === 'full' || (wantNowPlaying && pState === 'docked')"), 'the re-adopt condition stands verbatim');
  assert.ok(js.includes('player.expand(npSlot)'), 'and it mounts into THIS view\'s slot');
  const idxState = js.indexOf("pState === 'full'");
  const idxExpand = js.indexOf('player.expand(npSlot)');
  assert.ok(idxState >= 0 && idxExpand > idxState, 'condition precedes the mount (ordering, not mere presence)');
  const html = fs.readFileSync(path.join(__dirname, '../../public/podcasts.html'), 'utf8');
  assert.ok(html.includes('id="player-slot"'), 'the slot exists in the shell');
});

test('SOURCE-LOCK: podcasts.html carries the dock + host template and the FOUC guard; styles live in style.css not the shell', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/podcasts.html'), 'utf8');
  assert.ok(html.includes('id="player-dock"'), 'dock present (episodes play docked)');
  assert.ok(html.includes('id="player-host-template"'), 'host template present for a direct /podcasts load');
  assert.ok(html.includes('data-view="podcasts"'), '#view-root stamped for the SPA router');
  assert.ok(html.includes("localStorage.getItem('ft-era')"), 'the FOUC guard block is present');
  assert.ok(!/<style[\s>]/i.test(html), 'NO shell <style> block - the v1.41.8 SPA lesson (books.html:19)');
  assert.ok(html.includes('/js/podcasts.js'), 'the view controller loads in the shell');
});

test('SOURCE-LOCK: every new podcast className in the controller is bound by a style.css rule (the v1.68.3 styling-source law)', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../public/js/podcasts.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  const classNames = new Set();
  // Every string literal assigned to className / classList in the controller.
  for (const m of js.matchAll(/className = '([a-z0-9- ]+)'/g)) {
    for (const cls of m[1].split(/\s+/)) classNames.add(cls);
  }
  for (const m of js.matchAll(/classList\.(?:add|toggle)\('([a-z0-9-]+)'/g)) classNames.add(m[1]);
  assert.ok(classNames.size >= 10, `sanity: the scan found the controller's classes (${classNames.size})`);
  for (const cls of classNames) {
    if (cls.startsWith('btn') || cls === 'icon-refresh') continue; // pre-existing shared affordances
    assert.ok(new RegExp(`\\.${cls}[\\s,{.:\\[]`).test(css), `className '${cls}' has NO CSS rule binding it - a bare control (CONTRIBUTING.md styling-source rule)`);
  }
});

test('v1.69.1 SOURCE-LOCK: setup.html carries the Podcasts zero-state door (Dean\'s device-pass find)', () => {
  // The nav entry is content-gated (zero subscriptions = no sidebar link),
  // so the Library-settings page MUST link /podcasts or a fresh install has
  // no path to the place at all - the chicken-and-egg v1.69.0 shipped with.
  const html = fs.readFileSync(path.join(__dirname, '../../public/setup.html'), 'utf8');
  assert.ok(html.includes('href="/podcasts"'), 'the door exists at zero subscriptions');
  assert.ok(html.includes('data-collapse-key="podcasts-place"'), 'a real setup box, the music/books pattern');
  assert.ok(html.includes('FILETUBE_PODCASTS_DIR'), 'the set-the-var-BEFORE-first-subscription guidance is on the page');
});

test('formatEpisodeDuration/Meta: hours, minutes, degrade-independently pieces', () => {
  assert.equal(pod.formatEpisodeDuration(4357), '1h 13m');
  assert.equal(pod.formatEpisodeDuration(3600), '1h');
  assert.equal(pod.formatEpisodeDuration(3599), '1h', 'rounds up to a clean hour, never 60m');
  assert.equal(pod.formatEpisodeDuration(300), '5m');
  assert.equal(pod.formatEpisodeDuration(45), '45s');
  assert.equal(pod.formatEpisodeDuration(0), '');
  assert.equal(pod.formatEpisodeDuration(null), '');
  assert.ok(pod.formatEpisodeMeta({ pubDateMs: Date.UTC(2026, 7, 2), durationSec: 4357 }).includes('1h 13m'));
  assert.equal(pod.formatEpisodeMeta({ durationSec: 300 }), '5m', 'date-less feeds still show duration');
  assert.equal(pod.formatEpisodeMeta({}), '');
});

test('episodeChipLabel: downloaded = no chip; every other state named honestly', () => {
  assert.equal(pod.episodeChipLabel({ status: 'downloaded' }), '');
  assert.equal(pod.episodeChipLabel({ status: 'pending' }), 'Queued');
  assert.equal(pod.episodeChipLabel({ status: 'failed' }), 'Download failed');
  assert.equal(pod.episodeChipLabel({ status: 'skipped' }), 'Not downloaded');
  assert.equal(pod.episodeChipLabel({ status: 'deleted-on-disk' }), 'File removed');
  assert.equal(pod.episodeChipLabel(null), '');
});

test('resumeFraction: mid-episode only - unplayed, finished, played-latched, and duration-less all yield null', () => {
  assert.equal(pod.resumeFraction({ progress: { position: 600, duration: 1200 }, played: false }), 0.5);
  assert.equal(pod.resumeFraction({ progress: { position: 600 }, durationSec: 1200, played: false }), 0.5, 'falls back to the feed duration');
  assert.equal(pod.resumeFraction({ progress: { position: 1195, duration: 1200 }, played: false }), null, '>=99% shows no bar');
  assert.equal(pod.resumeFraction({ progress: { position: 2, duration: 1200 }, played: false }), null, 'first seconds show no bar');
  assert.equal(pod.resumeFraction({ progress: { position: 600, duration: 1200 }, played: true }), null, 'played-latched shows no bar');
  assert.equal(pod.resumeFraction({ progress: null, played: false }), null);
  assert.equal(pod.resumeFraction(null), null);
});

test('showCountLine: partial vs complete vs empty', () => {
  assert.equal(pod.showCountLine({ episodeCount: 484, downloadedCount: 12 }), '12 of 484 downloaded');
  assert.equal(pod.showCountLine({ episodeCount: 484, downloadedCount: 484 }), '484 episodes');
  assert.equal(pod.showCountLine({ episodeCount: 1, downloadedCount: 1 }), '1 episode');
  assert.equal(pod.showCountLine({ episodeCount: 0, downloadedCount: 0 }), 'No episodes yet');
  assert.equal(pod.showCountLine(null), '');
});

// ---- v1.72 (cap 2): music + books bottom-bar items in EVERY shell ----------

test('v1.72: every bottom-nav shell carries the music + books items, hidden until Settings opts in (the every-writer rule)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const pub = path.join(__dirname, '../../public');
  const shells = fs.readdirSync(pub).filter((f) => f.endsWith('.html'))
    .filter((f) => fs.readFileSync(path.join(pub, f), 'utf8').includes('class="bottom-nav'));
  assert.ok(shells.length >= 9, `expected the full shell roster, found ${shells.length}`);
  for (const f of shells) {
    const html = fs.readFileSync(path.join(pub, f), 'utf8');
    for (const [nav, href] of [['music', '/music'], ['books', '/books']]) {
      const re = new RegExp(`<a href="${href}" class="bottom-nav-item" data-nav="${nav}" hidden>`);
      assert.match(html, re, `${f}: missing (or un-hidden) ${nav} bottom-nav item`);
    }
  }
});
