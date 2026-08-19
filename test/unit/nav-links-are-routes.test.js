'use strict';

// [UNIT] v1.151 audit invariants for shell navigation. TWO nets:
//
// 1. ROUTE net: EVERY sidebar / bottom-nav destination in the app shells must
//    be an SPA route deriveRouteView recognizes. A link it returns null for
//    falls through to a FULL browser page load, which unloads the whole
//    document -- including the persistent #player-host outside #view-root --
//    and stops playback. That was exactly the Stats bug.
//
// 2. HIGHLIGHT net (added in the same release after the gate caught a real
//    regression): every STATIC sidebar link must light ITSELF. Making Stats a
//    route made bootRouter run the highlight pass on it, and because
//    activeNavItem had no stats case it STRIPPED the server-rendered active
//    class and lit nothing. This net binds: path -> activeNavItem key ->
//    SIDEBAR_HREF_BY_NAV_KEY maps back to the link's own href.
//
// Scope: static anchors carrying class `sidebar-item` / `bottom-nav-item` in
// the shell HTML. JS-injected nav links (music/books/podcasts/history/
// subscriptions) point at the same route paths these nets assert via their
// static siblings + deriveRouteView's / activeNavItem's own unit tests.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { deriveRouteView, activeNavItem, SIDEBAR_HREF_BY_NAV_KEY } = require('../../public/js/common.js');

const SHELLS = [
  'public/index.html',
  'public/stats.html',
  'public/setup.html',
  'lib/ytdlp/views/subscriptions.html',
];

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

// Extract hrefs of anchors carrying one of the given nav classes.
function navHrefs(html, classRe) {
  const out = [];
  const tags = html.match(/<a\b[^>]*>/g) || [];
  for (const tag of tags) {
    if (!classRe.test(tag)) continue;
    const m = tag.match(/href="([^"]+)"/);
    if (!m || !m[1].startsWith('/')) continue; // external / asset hrefs are out of scope
    out.push(m[1]);
  }
  return out;
}

const pathOf = (href) => href.split(/[?#]/)[0];
const queryOf = (href) => (href.includes('?') ? href.slice(href.indexOf('?')) : '');

test('ROUTE net: every sidebar/bottom-nav link across the shells is an SPA route (no full-reload nav)', () => {
  let total = 0;
  for (const shell of SHELLS) {
    const hrefs = navHrefs(read(shell), /class="[^"]*(?:sidebar-item|bottom-nav-item)[^"]*"/);
    for (const href of hrefs) {
      total += 1;
      assert.notStrictEqual(
        deriveRouteView(pathOf(href)), null,
        `[${shell}] nav link ${href} must resolve to an SPA route (deriveRouteView(${pathOf(href)}) is null -> full page reload kills the mini-player)`);
    }
  }
  // Guard against a vacuous pass (a markup change that stops matching anchors).
  assert.ok(total >= 8, `expected to find the shell nav links across ${SHELLS.length} shells, found ${total}`);
});

test('HIGHLIGHT net: every static sidebar link in the main shell lights ITSELF', () => {
  const hrefs = navHrefs(read('public/index.html'), /class="[^"]*sidebar-item[^"]*"/);
  assert.ok(hrefs.length >= 3, `expected the static sidebar links, found ${hrefs.length}`);
  for (const href of hrefs) {
    const key = activeNavItem(pathOf(href), queryOf(href));
    assert.ok(key, `sidebar link ${href} must resolve to a nav key (else bootRouter's highlight pass lights nothing)`);
    assert.strictEqual(
      SIDEBAR_HREF_BY_NAV_KEY[key], href,
      `sidebar link ${href} must light itself: activeNavItem -> '${key}' -> SIDEBAR_HREF_BY_NAV_KEY['${key}']='${SIDEBAR_HREF_BY_NAV_KEY[key]}'`);
  }
});

test('Stats specifically is a route AND lights its rail entry (the v1.151 fix; regression-locks both)', () => {
  const hrefs = navHrefs(read('public/index.html'), /class="[^"]*sidebar-item[^"]*"/);
  assert.ok(hrefs.includes('/stats.html'), 'the Stats link is present in the shell sidebar');
  assert.strictEqual(deriveRouteView('/stats.html'), 'stats', 'Stats resolves to its SPA view');
  assert.strictEqual(activeNavItem('/stats.html', ''), 'stats', 'Stats resolves to its highlight key');
  assert.strictEqual(SIDEBAR_HREF_BY_NAV_KEY.stats, '/stats.html', 'the stats key lights the Stats rail entry');
});
