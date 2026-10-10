'use strict';

// [UNIT] v1.367.0: the Settings reorganization moved controls between pages and renamed pages; it must never lose, add,
// re-route or re-role a control by accident. scripts/settings-census.js lists every control in public/setup.html with its
// save path and the roles that see it. The baseline file is that census taken on main at v1.366.1, BEFORE any edit
// (docs/exec-plans/completed/2026-10-06-settings-reorg.md, falsifier F1). Only the listed role changes are allowed.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { census } = require('../../scripts/settings-census.js');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
const BASELINE = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'settings-controls-v1.366.1.txt'), 'utf8').trim().split('\n');

// The one deliberate visibility change (Dean, 2026-10-06): a server-wide row (admin-only POST /api/settings, or the admin-only
// scan / cache-clear routes) is shown to admins only.
const NOW_ADMIN_ONLY = ['autoplay-next-check', 'cache-age-select', 'cache-cap-input', 'chapter-snap-leadin-select', 'clear-cache-btn',
  'default-sort-select', 'default-view-select', 'notifications-enabled-check', 'prune-missing-check', 'scan-interval-select', 'scan-now-btn'];

test('the census classifies every control (no unclassified id, no stale entry)', () => {
  assert.deepStrictEqual(census(HTML).problems, []);
});

// Controls added deliberately since the baseline (each named with its release): the iPod portrait lock's device-local switch.
// (v1.372.0's Home > Show music in the home feed came and went: v1.373.0 removed it.) v1.382.0: the Settings > Feed page's
// thirteen controls, one synced key.
const ADDED_SINCE = ['pocket-upright-check|localStorage'].concat(['feed-kind-video', 'feed-kind-podcast', 'feed-kind-book', 'feed-kind-watchlater', 'feed-kind-song', 'feed-which-video', 'feed-where-video', 'feed-which-podcast', 'feed-where-podcast', 'feed-which-book', 'feed-where-book', 'feed-reel', 'feed-slice'].map((id) => id + '|/api/prefs (synced) + localStorage'));

test('no control is lost, added or re-routed: (id, save path) equals the v1.366.1 baseline plus the named additions', () => {
  const now = census(HTML).pages.flatMap((p) => p.controls).map((c) => c.id + '|' + c.save).sort();
  const base = BASELINE.map((l) => l.split('|').slice(0, 2).join('|')).concat(ADDED_SINCE).sort();
  assert.deepStrictEqual(now, base);
});

test('the only role change is the named server-wide rows going admin-only', () => {
  const now = Object.fromEntries(census(HTML).pages.flatMap((p) => p.controls).map((c) => [c.id, c.roles]));
  const base = Object.fromEntries(BASELINE.map((l) => { const [id, , roles] = l.split('|'); return [id, roles]; }));
  const changed = Object.keys(base).filter((id) => base[id] !== now[id]).sort();
  assert.deepStrictEqual(changed, NOW_ADMIN_ONLY);
  changed.forEach((id) => { assert.strictEqual(base[id], 'all', id + ' was seen by everyone'); assert.strictEqual(now[id], 'admin'); });
});

test('every server-wide (/api/settings) control on Home page, Playback, Scan & cache and Notifications is admin-only', () => {
  const pages = census(HTML).pages.filter((p) => ['home-page', 'playback', 'scan-cache', 'notifications'].includes(p.key));
  assert.strictEqual(pages.length, 4);
  for (const p of pages) {
    for (const c of p.controls.filter((x) => x.save === '/api/settings')) assert.strictEqual(c.roles, 'admin', c.id + ' on ' + p.key);
  }
});

test('the census can fail: an unclassified control and a lost control are both reported', () => {
  const extra = census(HTML.replace('</details>', '<input id="zz-new-control"></details>'));
  assert.ok(extra.problems.some((m) => m.includes('zz-new-control')), 'an unclassified control is reported');
  const lost = census(HTML.replace(/<select id="cache-age-select"/, '<select id="cache-age-renamed"'));
  assert.ok(lost.problems.some((m) => m.includes('cache-age-select')), 'a control that vanished from the page is reported');
});
