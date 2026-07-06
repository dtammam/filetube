'use strict';

// [UNIT] The pure helpers extracted from the SPA-lite router in
// public/js/common.js (FR-1, T1): route/view derivation from a URL,
// click-interception decision, and history.state (de)serialization. The
// DOM-heavy fetch/swap machinery those helpers back is intentionally NOT
// covered here (no jsdom/browser harness in this codebase — see
// CONTRIBUTING.md's testing section); Dean's on-device pass is the arbiter
// for the actual smooth-no-reload swap behavior.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  deriveRouteView,
  shouldInterceptLinkClick,
  buildHistoryState,
  parseHistoryState,
  toPathAndQuery,
  isStaleNavGeneration,
} = require('../../public/js/common.js');

// ---- deriveRouteView -------------------------------------------------------

test('deriveRouteView: "/" is the home view', () => {
  assert.strictEqual(deriveRouteView('/'), 'home');
});

test('deriveRouteView: "/index.html" is also the home view', () => {
  assert.strictEqual(deriveRouteView('/index.html'), 'home');
});

test('deriveRouteView: "/watch.html" is the watch view', () => {
  assert.strictEqual(deriveRouteView('/watch.html'), 'watch');
});

test('deriveRouteView: "/setup.html" is the setup view', () => {
  assert.strictEqual(deriveRouteView('/setup.html'), 'setup');
});

test('deriveRouteView: "/subscriptions" is the subscriptions view (unconditional mapping)', () => {
  assert.strictEqual(deriveRouteView('/subscriptions'), 'subscriptions');
});

test('deriveRouteView: an unknown path is null (falls through to a normal navigation)', () => {
  assert.strictEqual(deriveRouteView('/thumbnail/abc123'), null);
  assert.strictEqual(deriveRouteView('/api/videos'), null);
  assert.strictEqual(deriveRouteView('/anything-else'), null);
});

// ---- shouldInterceptLinkClick ----------------------------------------------

const basePlainClick = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, targetAttr: null, sameOrigin: true, view: 'home' };

test('shouldInterceptLinkClick: a plain left-click on a known same-origin route is intercepted', () => {
  assert.strictEqual(shouldInterceptLinkClick(basePlainClick), true);
});

test('shouldInterceptLinkClick: a middle/right click (button !== 0) is never intercepted', () => {
  assert.strictEqual(shouldInterceptLinkClick({ ...basePlainClick, button: 1 }), false);
  assert.strictEqual(shouldInterceptLinkClick({ ...basePlainClick, button: 2 }), false);
});

test('shouldInterceptLinkClick: any modifier key (open in new tab/window) is never intercepted', () => {
  assert.strictEqual(shouldInterceptLinkClick({ ...basePlainClick, metaKey: true }), false);
  assert.strictEqual(shouldInterceptLinkClick({ ...basePlainClick, ctrlKey: true }), false);
  assert.strictEqual(shouldInterceptLinkClick({ ...basePlainClick, shiftKey: true }), false);
  assert.strictEqual(shouldInterceptLinkClick({ ...basePlainClick, altKey: true }), false);
});

test('shouldInterceptLinkClick: target="_blank" is never intercepted', () => {
  assert.strictEqual(shouldInterceptLinkClick({ ...basePlainClick, targetAttr: '_blank' }), false);
});

test('shouldInterceptLinkClick: a cross-origin link is never intercepted', () => {
  assert.strictEqual(shouldInterceptLinkClick({ ...basePlainClick, sameOrigin: false, view: null }), false);
});

test('shouldInterceptLinkClick: a same-origin link to an unknown route (view=null) is never intercepted', () => {
  assert.strictEqual(shouldInterceptLinkClick({ ...basePlainClick, view: null }), false);
});

// ---- buildHistoryState / parseHistoryState ---------------------------------

test('buildHistoryState: builds the {view, url, scrollY} shape, defaulting scrollY to 0', () => {
  assert.deepStrictEqual(buildHistoryState('watch', '/watch.html?v=abc', undefined), { view: 'watch', url: '/watch.html?v=abc', scrollY: 0 });
});

test('buildHistoryState: preserves a valid non-negative scrollY', () => {
  assert.deepStrictEqual(buildHistoryState('home', '/', 240), { view: 'home', url: '/', scrollY: 240 });
});

test('buildHistoryState: a negative scrollY falls back to 0', () => {
  assert.deepStrictEqual(buildHistoryState('home', '/', -5), { view: 'home', url: '/', scrollY: 0 });
});

test('parseHistoryState: a well-formed state round-trips through buildHistoryState', () => {
  const state = { view: 'setup', url: '/setup.html', scrollY: 120 };
  assert.deepStrictEqual(parseHistoryState(state, { pathname: '/setup.html', search: '' }), state);
});

test('parseHistoryState: a null state (first entry, before any pushState) derives fresh state from the current location', () => {
  const result = parseHistoryState(null, { pathname: '/watch.html', search: '?v=xyz' });
  assert.deepStrictEqual(result, { view: 'watch', url: '/watch.html?v=xyz', scrollY: 0 });
});

test('parseHistoryState: a state with no "view" string falls back to deriving from location', () => {
  const result = parseHistoryState({ some: 'garbage' }, { pathname: '/', search: '' });
  assert.deepStrictEqual(result, { view: 'home', url: '/', scrollY: 0 });
});

test('parseHistoryState: an unknown-route fallback location yields a null view', () => {
  const result = parseHistoryState(null, { pathname: '/thumbnail/abc', search: '' });
  assert.strictEqual(result.view, null);
});

// ---- toPathAndQuery (FR-4, T4) ----------------------------------------------
//
// Normalizes an absolute-or-relative href down to "pathname+search" so the
// home viewCache's URL comparisons never spuriously mismatch just because one
// side happened to be stored as an absolute href (navigate()'s pushState)
// and the other as a bare relative path (bootRouter's initial replaceState /
// parseHistoryState's own fallback).

test('toPathAndQuery: a relative path+query resolves against the base and strips nothing extra', () => {
  assert.strictEqual(toPathAndQuery('/?root=Movies', 'http://localhost:3000/watch.html?v=abc'), '/?root=Movies');
});

test('toPathAndQuery: an absolute href on the same origin reduces to pathname+search', () => {
  assert.strictEqual(toPathAndQuery('http://localhost:3000/?search=foo', 'http://localhost:3000/watch.html'), '/?search=foo');
});

test('toPathAndQuery: an absolute and a relative form of the SAME url normalize identically', () => {
  const base = 'http://localhost:3000/watch.html?v=abc';
  assert.strictEqual(toPathAndQuery('http://localhost:3000/', base), toPathAndQuery('/', base));
});

test('toPathAndQuery: bare path with no query string has an empty search', () => {
  assert.strictEqual(toPathAndQuery('/setup.html', 'http://localhost:3000/'), '/setup.html');
});

test('toPathAndQuery: an unparseable href (no usable base) is returned unchanged rather than throwing', () => {
  assert.strictEqual(toPathAndQuery('not a url', undefined), 'not a url');
});

// ---- isStaleNavGeneration (W2 remediation, v1.16.0) ------------------------
//
// Backs the in-flight navigation guard in navigate()/handlePopState(): a
// navigation attempt tagged `gen` is stale once a NEWER attempt has bumped
// the module's `navGeneration` counter past it. Mirrors player.js's
// `loadGeneration` staleness check.

test('isStaleNavGeneration: matching generations are NOT stale (the only/most-recent navigation)', () => {
  assert.strictEqual(isStaleNavGeneration(1, 1), false);
});

test('isStaleNavGeneration: an older generation than the current counter IS stale', () => {
  assert.strictEqual(isStaleNavGeneration(1, 2), true);
});

test('isStaleNavGeneration: a sequence of quick navigations only leaves the LATEST fresh', () => {
  // Simulates three quick clicks: gen 1, 2, 3 each captured at navigate()-call
  // time; only the LAST one resolving against the final counter value (3) is
  // fresh -- the two earlier in-flight fetches are stale and must be discarded.
  const currentGeneration = 3;
  assert.strictEqual(isStaleNavGeneration(1, currentGeneration), true);
  assert.strictEqual(isStaleNavGeneration(2, currentGeneration), true);
  assert.strictEqual(isStaleNavGeneration(3, currentGeneration), false);
});

test('isStaleNavGeneration: generation 0 (never bumped) vs itself is not stale', () => {
  assert.strictEqual(isStaleNavGeneration(0, 0), false);
});
