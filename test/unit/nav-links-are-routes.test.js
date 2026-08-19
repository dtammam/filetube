'use strict';

// [UNIT] v1.151 audit invariant: EVERY sidebar / bottom-nav destination in the
// app shell must be an SPA route that deriveRouteView recognizes. A nav link
// deriveRouteView returns null for falls through to a FULL browser page load,
// which unloads the whole document -- including the persistent #player-host
// outside #view-root -- and stops playback. That is exactly the bug Dean hit
// on Stats. This net enumerates the shell's nav anchors and fails if any is
// not a route, so a future full-reload nav link is caught here instead of
// on-device.
//
// Scope: static anchors in index.html carrying class `sidebar-item` or
// `bottom-nav-item`. JS-injected nav links (music/books/podcasts/history/
// subscriptions) point at the same route paths this net already asserts via
// their static siblings + deriveRouteView's own unit tests.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { deriveRouteView } = require('../../public/js/common.js');

const INDEX_HTML = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');

function navHrefs(html) {
  const out = [];
  const tags = html.match(/<a\b[^>]*>/g) || [];
  for (const tag of tags) {
    if (!/class="[^"]*(?:sidebar-item|bottom-nav-item)[^"]*"/.test(tag)) continue;
    const m = tag.match(/href="([^"]+)"/);
    if (!m) continue;
    const href = m[1];
    if (!href.startsWith('/')) continue; // external / asset hrefs are out of scope
    out.push(href);
  }
  return out;
}

test('every sidebar/bottom-nav link in the shell is an SPA route (no full-reload nav)', () => {
  const hrefs = navHrefs(INDEX_HTML);
  // Guard against a vacuous pass (a markup change that stops matching anchors).
  assert.ok(hrefs.length >= 5, `expected to find the shell nav links, found ${hrefs.length}`);
  for (const href of hrefs) {
    const pathOnly = href.split(/[?#]/)[0]; // deriveRouteView keys on pathname only
    assert.notStrictEqual(
      deriveRouteView(pathOnly), null,
      `nav link ${href} must resolve to an SPA route (deriveRouteView(${pathOnly}) is null -> full page reload kills the mini-player)`);
  }
});

test('Stats specifically is a route (the v1.151 fix; regression-locks it)', () => {
  const hrefs = navHrefs(INDEX_HTML);
  assert.ok(hrefs.includes('/stats.html'), 'the Stats link is present in the shell nav');
  assert.strictEqual(deriveRouteView('/stats.html'), 'stats', 'Stats resolves to its SPA view');
});
