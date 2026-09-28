'use strict';

// [UNIT] v1.26.4 Item 1 (loading skeletons): `buildSkeletonGrid`
// (public/js/main.js, a pure string builder) and `buildSkeletonRows`
// (lib/ytdlp/client/subscriptions.js, a createElement-only DOM builder --
// this file carries a hard, file-wide "never .innerHTML" bar, see its own
// SECURITY comment + test/integration/ytdlp-ui-routes.test.js's AC32
// regression guard, so its skeleton helper returns real elements instead of
// an HTML string like main.js's twin does). Mirrors the existing pure-helper
// testing pattern used throughout this suite (e.g.
// `buildCardDownloadHref`/`buildCardDownloadFilename` in main.js's own
// module.exports, and the minimal fake-DOM pattern established by
// test/unit/pinned-sidebar.test.js for subscriptions.js's own DOM builders;
// UI pass S5: the Subscriptions skeleton is built with jsdom's document).
// The shimmer motion itself is CSS-only and locked separately below via a
// source-presence check on style.css.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { buildSkeletonGrid } = require('../../public/js/main.js');
const { buildSkeletonRows, buildSkeletonList, createSubscriptionRow, createSubscriptionsListElement } = require('../../lib/ytdlp/client/subscriptions.js');
const { JSDOM } = require('jsdom');
const jsdomDoc = () => new JSDOM('<!doctype html><body></body>').window.document;

const ROOT = path.join(__dirname, '..', '..');
const CSS_PATH = path.join(ROOT, 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// UI pass sweep S2 (D9; AC12): the skeleton card is built from the SAME ui-thumb
// box and info block as the real card (main.js buildSkeletonCardEl), so the
// reveal is zero-shift; test/geometry/library-toolbar.check.js measures it.
const DOC = new JSDOM('<!doctype html><body></body>').window.document;

test('buildSkeletonGrid: returns exactly n skeleton cards, each matching the real card box model', () => {
  const html = buildSkeletonGrid(3, { doc: DOC });
  const cardMatches = html.match(/class="video-card skeleton-card"/g) || [];
  assert.strictEqual(cardMatches.length, 3);
  // Same thumbnail box the real card uses (the ui-thumb 16:9 primitive).
  assert.match(html, /<div class="card-media"><div class="ui-thumb ui-thumb--16x9 ui-thumb--card skeleton-shimmer"><\/div><\/div>/);
  assert.match(html, /class="video-info"/);
  assert.match(html, /aria-hidden="true"/);
});

test('buildSkeletonGrid: n=0 (and negative/non-integer input) returns an empty string, never throws', () => {
  assert.strictEqual(buildSkeletonGrid(0), '');
  assert.strictEqual(buildSkeletonGrid(-3), '');
  assert.strictEqual(buildSkeletonGrid(undefined), '');
  assert.strictEqual(buildSkeletonGrid(NaN), '');
  assert.strictEqual(buildSkeletonGrid(2.5), ''); // not a Number.isInteger -- fails safe to empty rather than a fractional card count
});

// UI pass S5 (AC12 conversion, D9 "the row skeleton equals the row grid"): the
// Subscriptions skeleton IS the ui-row grid - the same slot sequence as a loaded row
// (lead, media holding an md avatar box, body, aside, THREE reserved action slots) in
// a list built with the same modifiers - so the swap from skeleton to rows moves
// nothing. (Measured in a real engine by test/geometry/subscriptions.check.js.)
const slotShape = (row) => [...row.children].map((c) => c.className.split(' ')[0] + ':' + c.children.length);
test('buildSkeletonRows: n ui-row skeletons whose slot sequence equals a loaded row\'s (lead, md avatar, body, aside, 3 actions)', () => {
  const d = jsdomDoc();
  const rows = buildSkeletonRows(4, d);
  assert.strictEqual(rows.length, 4);
  const real = createSubscriptionRow({ id: 's', name: 'Real', channelDir: '/d' }, d, {});
  for (const row of rows) {
    assert.strictEqual(row.tagName, 'DIV');
    assert.match(row.className, /^ui-row ui-row--default\b/);
    assert.strictEqual(row.getAttribute('aria-hidden'), 'true');
    assert.deepStrictEqual(slotShape(row), slotShape(real), 'the skeleton reserves exactly the loaded row\'s slots');
    assert.ok(row.querySelector('.ui-row__media > .ui-avatar.ui-avatar--md.skeleton-shimmer'), 'the avatar box is the real md avatar size');
    assert.ok(row.querySelector('.ui-row__body > .skeleton-line.skeleton-line-title.skeleton-shimmer'));
    assert.ok(row.querySelector('.ui-row__body > .skeleton-line.skeleton-line-meta.skeleton-shimmer'));
  }
  // and the list that holds them carries the same modifiers as a loaded section's list
  const skelList = buildSkeletonList(2, d);
  const loadedList = createSubscriptionsListElement([{ id: 'a', name: 'A' }], d, {}).querySelector('.ui-list');
  assert.strictEqual(skelList.className, loadedList.className);
});

test('buildSkeletonRows: n=0 (and negative/non-integer/omitted) returns an empty array, never throws', () => {
  assert.deepStrictEqual(buildSkeletonRows(0, jsdomDoc()), []);
  assert.deepStrictEqual(buildSkeletonRows(-1, jsdomDoc()), []);
  assert.deepStrictEqual(buildSkeletonRows(undefined, jsdomDoc()), []);
});

test('buildSkeletonRows source never assigns .innerHTML (static regression guard, matches the file-wide bar)', () => {
  const stripComments = (src) => src.replace(/\/\/.*$/gm, '');
  const src = stripComments(buildSkeletonRows.toString());
  assert.doesNotMatch(src, /\.innerHTML\s*=/, 'buildSkeletonRows must never assign innerHTML');
});

// ---- CSS lock: the shimmer + skeleton box-model rules actually exist ------

test('style.css defines the shared .skeleton-shimmer sweep animation, honoring prefers-reduced-motion', () => {
  assert.match(css, /\.skeleton-shimmer\s*\{/);
  assert.match(css, /@keyframes skeleton-sweep/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.skeleton-shimmer::after\s*\{\s*animation:\s*none;/);
});

test('style.css defines the home-grid skeleton card and the skeleton line; the subscriptions row skeleton rides ui.css\'s row grid (no bespoke box model left)', () => {
  assert.match(css, /\.skeleton-card \.card-rating\s*\{/, 'the skeleton rating row keeps its box but never paints (sweep S2)');
  assert.match(css, /\.skeleton-line\s*\{/);
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /\.skeleton-row(-avatar|-info)?\s*\{/, 'the retired .skeleton-row box model is gone');
});
