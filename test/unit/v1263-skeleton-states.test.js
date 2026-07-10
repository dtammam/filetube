'use strict';

// [UNIT] v1.26.3 Item 1 (loading skeletons): `buildSkeletonGrid`
// (public/js/main.js, a pure string builder) and `buildSkeletonRows`
// (lib/ytdlp/client/subscriptions.js, a createElement-only DOM builder --
// this file carries a hard, file-wide "never .innerHTML" bar, see its own
// SECURITY comment + test/integration/ytdlp-ui-routes.test.js's AC32
// regression guard, so its skeleton helper returns real elements instead of
// an HTML string like main.js's twin does). Mirrors the existing pure-helper
// testing pattern used throughout this suite (e.g.
// `buildCardDownloadHref`/`buildCardDownloadFilename` in main.js's own
// module.exports, and the minimal fake-DOM pattern established by
// test/unit/pinned-sidebar.test.js for subscriptions.js's own DOM builders).
// The shimmer motion itself is CSS-only and locked separately below via a
// source-presence check on style.css.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { buildSkeletonGrid } = require('../../public/js/main.js');
const { buildSkeletonRows } = require('../../lib/ytdlp/client/subscriptions.js');

const ROOT = path.join(__dirname, '..', '..');
const CSS_PATH = path.join(ROOT, 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// ---- Minimal fake DOM (mirrors test/unit/pinned-sidebar.test.js's
// FakeNode/makeFakeDoc pattern, trimmed to what buildSkeletonRows needs) ----

class FakeNode {
  constructor(tag) {
    this.tagName = tag ? String(tag).toUpperCase() : undefined;
    this.className = '';
    this.children = [];
    this._attrs = {};
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this._attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; }
  set innerHTML(_value) {
    throw new Error('buildSkeletonRows must never assign innerHTML -- use createElement/appendChild instead');
  }
}

function fakeDoc() {
  return { createElement: (tag) => new FakeNode(tag) };
}

test('buildSkeletonGrid: returns exactly n skeleton cards, each matching the real card box model', () => {
  const html = buildSkeletonGrid(3);
  const cardMatches = html.match(/class="video-card skeleton-card"/g) || [];
  assert.strictEqual(cardMatches.length, 3);
  // Same thumbnail box the real card uses (`.thumbnail-container`), so
  // swapping skeleton for real content produces zero layout shift.
  assert.match(html, /class="thumbnail-container skeleton-shimmer"/);
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

test('buildSkeletonRows: returns exactly n elements, each matching the real .sub-row box model, built via createElement only', () => {
  const rows = buildSkeletonRows(4, fakeDoc());
  assert.strictEqual(rows.length, 4);
  for (const row of rows) {
    assert.strictEqual(row.tagName, 'DIV');
    assert.strictEqual(row.className, 'skeleton-row');
    assert.strictEqual(row.getAttribute('aria-hidden'), 'true');
    const avatar = row.children.find((c) => c.className === 'skeleton-row-avatar skeleton-shimmer');
    assert.ok(avatar, 'expected a .skeleton-row-avatar child');
    const info = row.children.find((c) => c.className === 'skeleton-row-info');
    assert.ok(info, 'expected a .skeleton-row-info child');
    assert.ok(info.children.some((c) => c.className === 'skeleton-line skeleton-line-title skeleton-shimmer'));
    assert.ok(info.children.some((c) => c.className === 'skeleton-line skeleton-line-meta skeleton-shimmer'));
  }
});

test('buildSkeletonRows: n=0 (and negative/non-integer/omitted) returns an empty array, never throws', () => {
  assert.deepStrictEqual(buildSkeletonRows(0, fakeDoc()), []);
  assert.deepStrictEqual(buildSkeletonRows(-1, fakeDoc()), []);
  assert.deepStrictEqual(buildSkeletonRows(undefined, fakeDoc()), []);
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

test('style.css defines the home-grid skeleton card and subscriptions skeleton row box models', () => {
  assert.match(css, /\.skeleton-card \.thumbnail-container\s*\{/);
  assert.match(css, /\.skeleton-line\s*\{/);
  assert.match(css, /\.skeleton-row\s*\{/);
  assert.match(css, /\.skeleton-row-avatar\s*\{/);
  assert.match(css, /\.skeleton-row-info\s*\{/);
});
