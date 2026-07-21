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
const fs = require('node:fs');
const path = require('node:path');
const {
  deriveRouteView,
  shouldInterceptLinkClick,
  buildHistoryState,
  parseHistoryState,
  toPathAndQuery,
  isStaleNavGeneration,
  isSameLocationNav,
  nextHistoryDepth,
  resolveHomeButtonAction,
  isHomeRootTarget,
} = require('../../public/js/common.js');

const COMMON_JS = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');

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

test('buildHistoryState: builds the {view, url, scrollY, depth} shape, defaulting scrollY + depth to 0', () => {
  assert.deepStrictEqual(buildHistoryState('watch', '/watch.html?v=abc', undefined), { view: 'watch', url: '/watch.html?v=abc', scrollY: 0, depth: 0 });
});

test('buildHistoryState: preserves a valid non-negative scrollY', () => {
  assert.deepStrictEqual(buildHistoryState('home', '/', 240), { view: 'home', url: '/', scrollY: 240, depth: 0 });
});

test('buildHistoryState: a negative scrollY falls back to 0', () => {
  assert.deepStrictEqual(buildHistoryState('home', '/', -5), { view: 'home', url: '/', scrollY: 0, depth: 0 });
});

test('buildHistoryState: preserves a valid depth (v1.45.0 T2) and floors/guards a bad one', () => {
  assert.deepStrictEqual(buildHistoryState('home', '/?root=Movies', 0, 3), { view: 'home', url: '/?root=Movies', scrollY: 0, depth: 3 });
  assert.strictEqual(buildHistoryState('home', '/', 0, -2).depth, 0, 'a negative depth falls back to 0');
  assert.strictEqual(buildHistoryState('home', '/', 0, 2.7).depth, 2, 'a fractional depth is floored');
});

test('parseHistoryState: a well-formed state round-trips (depth included, defaulting to 0)', () => {
  const state = { view: 'setup', url: '/setup.html', scrollY: 120 };
  assert.deepStrictEqual(parseHistoryState(state, { pathname: '/setup.html', search: '' }), { ...state, depth: 0 });
});

test('parseHistoryState: carries a non-zero depth through (v1.45.0 T2)', () => {
  const state = { view: 'watch', url: '/watch.html?v=abc', scrollY: 0, depth: 2 };
  assert.deepStrictEqual(parseHistoryState(state, { pathname: '/watch.html', search: '?v=abc' }), state);
});

test('parseHistoryState: a null state (first entry, before any pushState) derives fresh state from the current location', () => {
  const result = parseHistoryState(null, { pathname: '/watch.html', search: '?v=xyz' });
  assert.deepStrictEqual(result, { view: 'watch', url: '/watch.html?v=xyz', scrollY: 0, depth: 0 });
});

test('parseHistoryState: a state with no "view" string falls back to deriving from location', () => {
  const result = parseHistoryState({ some: 'garbage' }, { pathname: '/', search: '' });
  assert.deepStrictEqual(result, { view: 'home', url: '/', scrollY: 0, depth: 0 });
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

// ---- isSameLocationNav (tech-debt #46 same-URL nav no-op) -------------------

test('isSameLocationNav: identical path+query is a no-op', () => {
  assert.strictEqual(isSameLocationNav('/music', '/music'), true);
  assert.strictEqual(isSameLocationNav('/music?filter=liked', '/music?filter=liked'), true);
});

test('isSameLocationNav: a different query or path is NOT a no-op (real navigation)', () => {
  assert.strictEqual(isSameLocationNav('/music', '/music?play=abc'), false, 'a continue-listening deep-link still navigates');
  assert.strictEqual(isSameLocationNav('/music?play=abc', '/music'), false);
  assert.strictEqual(isSameLocationNav('/', '/music'), false);
  assert.strictEqual(isSameLocationNav('/read', '/music'), false);
});

test('isSameLocationNav: a non-string target is never a no-op (fail open to a real nav)', () => {
  assert.strictEqual(isSameLocationNav('/music', null), false);
  assert.strictEqual(isSameLocationNav('/music', undefined), false);
});

test('v1.44.2 SOURCE-LOCK (#46): navigate() no-ops a same-URL nav, but ONLY after deriveRouteView + before pushState/swap; popstate is exempt', () => {
  const navBody = COMMON_JS.slice(COMMON_JS.indexOf('function navigate('), COMMON_JS.indexOf('function handleDocumentClick'));
  assert.match(navBody, /isSameLocationNav\(/, 'navigate() consults the same-URL guard');
  // The guard must sit AFTER the unknown-route fallback (so an unknown route
  // still hard-navigates) and BEFORE the generation bump / fetch.
  assert.ok(navBody.indexOf('deriveRouteView(parsed.pathname)') < navBody.indexOf('isSameLocationNav('),
    'the guard runs after route derivation');
  assert.ok(navBody.indexOf('isSameLocationNav(') < navBody.indexOf('++navGeneration'),
    'the guard short-circuits before the navigation generation bump / fetch');
  // popstate must NOT adopt the guard (back/forward to the same URL still works).
  const popBody = COMMON_JS.slice(COMMON_JS.indexOf('function handlePopState'));
  assert.doesNotMatch(popBody.slice(0, popBody.indexOf('function ', 5)), /isSameLocationNav\(/,
    'handlePopState keeps its own path — the guard is navigate()-only');
});

// ---- nextHistoryDepth (v1.45.0 T2) -----------------------------------------

test('nextHistoryDepth: a pushState adds one in-app level (current + 1)', () => {
  assert.strictEqual(nextHistoryDepth({ depth: 0 }, false), 1);
  assert.strictEqual(nextHistoryDepth({ depth: 3 }, false), 4);
});

test('nextHistoryDepth: a replaceState keeps the current entry depth (adds no level)', () => {
  assert.strictEqual(nextHistoryDepth({ depth: 0 }, true), 0);
  assert.strictEqual(nextHistoryDepth({ depth: 3 }, true), 3);
});

test('nextHistoryDepth: a missing/garbage current state reads as depth 0', () => {
  assert.strictEqual(nextHistoryDepth(null, false), 1);
  assert.strictEqual(nextHistoryDepth(undefined, false), 1);
  assert.strictEqual(nextHistoryDepth({}, false), 1);
  assert.strictEqual(nextHistoryDepth({ depth: -5 }, false), 1, 'a negative depth floors to 0 before +1');
  assert.strictEqual(nextHistoryDepth({ depth: 2.9 }, false), 3, 'a fractional depth is floored before +1');
});

// ---- resolveHomeButtonAction (v1.45.0 T2) ----------------------------------
//
// Dean's model: Home walks UP one in-app level per tap; "home" is the top of
// that walk. depth>0 pops (history.back, restoring scroll); depth 0 either
// no-ops (already home) or navigates to '/' (a deep-link entry that isn't home).

test('resolveHomeButtonAction: an in-app depth on a NON-home entry pops one level (back)', () => {
  assert.strictEqual(resolveHomeButtonAction(1, '/watch.html?v=abc'), 'back');
  assert.strictEqual(resolveHomeButtonAction(3, '/?root=Movies'), 'back', 'a filtered/folder home is a real level, not the root');
});

test('resolveHomeButtonAction: the home ROOT is ALWAYS a no-op, even if the entry was stamped depth>0 (gate-fix C1)', () => {
  // The atHome check runs BEFORE depth: home is the top of the walk, so Home
  // there never pops. This is the belt-and-suspenders that makes a mis-stamped
  // home entry unable to ping-pong back into the page it was reached from.
  assert.strictEqual(resolveHomeButtonAction(2, '/'), 'noop');
  assert.strictEqual(resolveHomeButtonAction(5, '/index.html'), 'noop');
});

test('resolveHomeButtonAction: depth 0 while already at the home root is a no-op', () => {
  assert.strictEqual(resolveHomeButtonAction(0, '/'), 'noop');
  assert.strictEqual(resolveHomeButtonAction(0, '/index.html'), 'noop');
});

test('resolveHomeButtonAction: depth 0 on a deep-link entry that ISN\'T home navigates to /', () => {
  assert.strictEqual(resolveHomeButtonAction(0, '/watch.html?v=abc'), 'go-home');
  assert.strictEqual(resolveHomeButtonAction(0, '/?root=Movies'), 'go-home', 'a directly deep-linked folder has no history behind it');
  assert.strictEqual(resolveHomeButtonAction(0, '/music'), 'go-home');
});

test('resolveHomeButtonAction: a missing/garbage depth reads as 0 (fail toward reachable home, never an errant back)', () => {
  assert.strictEqual(resolveHomeButtonAction(undefined, '/'), 'noop');
  assert.strictEqual(resolveHomeButtonAction(undefined, '/watch.html'), 'go-home');
  assert.strictEqual(resolveHomeButtonAction(-4, '/watch.html'), 'go-home');
});

// ---- isHomeRootTarget (v1.45.0 T2) -----------------------------------------

test('isHomeRootTarget: the home root (/ or /index.html, no query) is a Home affordance', () => {
  assert.strictEqual(isHomeRootTarget('/', ''), true);
  assert.strictEqual(isHomeRootTarget('/index.html', ''), true);
});

test('isHomeRootTarget: a /?root=<folder> drill is NOT the Home root (ordinary forward nav)', () => {
  assert.strictEqual(isHomeRootTarget('/', '?root=Movies'), false);
  assert.strictEqual(isHomeRootTarget('/', '?search=foo'), false);
});

test('isHomeRootTarget: other routes are never the Home root', () => {
  assert.strictEqual(isHomeRootTarget('/watch.html', ''), false);
  assert.strictEqual(isHomeRootTarget('/music', ''), false);
  assert.strictEqual(isHomeRootTarget('/setup.html', ''), false);
});

// ---- v1.45.0 T2 SOURCE-LOCKS: incremental-pop Home runtime wiring -----------

test('SOURCE-LOCK (T2): handleDocumentClick routes the Home root through goHomeControl, not navigate()', () => {
  const clickBody = COMMON_JS.slice(COMMON_JS.indexOf('function handleDocumentClick'), COMMON_JS.indexOf('function handlePopState'));
  assert.match(clickBody, /isHomeRootTarget\(target\.pathname, target\.search\)/, 'the Home-root check gates the branch');
  assert.match(clickBody, /goHomeControl\(\)/, 'a Home-root click calls goHomeControl');
  // The Home branch must return BEFORE the generic navigate(target.href).
  assert.ok(clickBody.indexOf('goHomeControl()') < clickBody.indexOf('navigate(target.href)'),
    'goHomeControl short-circuits before the generic navigate');
});

test('SOURCE-LOCK (T2 + W1): goHomeControl coalesces re-entrant taps with an EVENT-based guard (no wall-clock)', () => {
  const fnBody = COMMON_JS.slice(COMMON_JS.indexOf('function goHomeControl'), COMMON_JS.indexOf('function handleDocumentClick'));
  assert.match(fnBody, /if \(homeBackPending\) return/, 'coalescing guard on re-entry, purely on the pending flag');
  // gate-fix W1: NO wall-clock deadline — a time-bounded guard could lift mid-jank
  // and let a second back() exit the app.
  assert.doesNotMatch(fnBody, /Date\.now\(\)/, 'the guard must not be time-bounded');
  assert.doesNotMatch(fnBody, /homeBackDeadline/, 'the deadline is gone');
  assert.match(fnBody, /resolveHomeButtonAction\(depth,/, 'delegates the decision to the pure helper');
  assert.match(fnBody, /window\.history\.back\(\)/, 'the back branch pops via history.back');
  // The back branch must arm the pending guard before calling back().
  assert.ok(fnBody.indexOf('homeBackPending = true') < fnBody.indexOf('window.history.back()'),
    'the guard is armed before back() so a synchronous second tap is coalesced');
});

test('SOURCE-LOCK (#1a): the header LOGO routes to goHomeToTop (jump to top), other Home affordances to goHomeControl (walk back)', () => {
  const clickBody = COMMON_JS.slice(COMMON_JS.indexOf('function handleDocumentClick'), COMMON_JS.indexOf('function handlePopState'));
  assert.match(clickBody, /anchor\.classList\.contains\('logo'\)\s*\)\s*goHomeToTop\(\)/, 'a .logo click jumps to the top of home');
  assert.match(clickBody, /else goHomeControl\(\)/, 'non-logo Home affordances keep the incremental walk-back');
});

test('SOURCE-LOCK (#1a): goHomeToTop scrolls to top when already home, else navigates to a fresh top-of-home', () => {
  const fnBody = COMMON_JS.slice(COMMON_JS.indexOf('function goHomeToTop'), COMMON_JS.indexOf('function handleDocumentClick'));
  assert.match(fnBody, /isHomeRootTarget\(window\.location\.pathname, window\.location\.search\)/, 'checks whether already at the home root');
  assert.match(fnBody, /window\.scrollTo\(0, 0\)/, 'already-home path just scrolls to the top');
  assert.match(fnBody, /navigate\('\/', \{ top: true \}\)/, 'elsewhere navigates to a fresh top-of-home');
});

test('SOURCE-LOCK (#1a): navigate()\'s home cache-hit honours opts.top (scrollY 0), else the cached scroll', () => {
  const navBody = COMMON_JS.slice(COMMON_JS.indexOf('function navigate('), COMMON_JS.indexOf('function handleDocumentClick'));
  assert.match(navBody, /const restoreScroll = opts\.top \? 0 : cached\.scrollY/, 'top forces scrollY 0 on a cache hit');
  // The forced scroll must flow into BOTH the pushed state and the restore call.
  assert.match(navBody, /buildHistoryState\('home', parsed\.href, restoreScroll, desiredDepth\)/, 'state uses restoreScroll');
  assert.match(navBody, /restoreHomeFromCache\(cached, targetUrl, restoreScroll\)/, 'restore uses restoreScroll');
});

test('SOURCE-LOCK (T2): handlePopState clears the Home-back guard (so the NEXT tap can pop again)', () => {
  const popBody = COMMON_JS.slice(COMMON_JS.indexOf('function handlePopState'));
  const firstFn = popBody.slice(0, popBody.indexOf('document.addEventListener'));
  assert.match(firstFn, /homeBackPending = false/, 'popstate releases the coalescing guard');
});

test('SOURCE-LOCK (T2): recordScrollForCurrentState PRESERVES depth when it rewrites the entry for scroll', () => {
  const fnBody = COMMON_JS.slice(COMMON_JS.indexOf('function recordScrollForCurrentState'), COMMON_JS.indexOf('function extractViewFragment'));
  // The 4th arg to buildHistoryState here must be the entry's own depth, not a
  // literal 0 (a replace-in-place keeps the level — dropping it would let a
  // scrolled-then-returned-to entry lose its pop level).
  assert.match(fnBody, /buildHistoryState\(\s*window\.history\.state\.view,\s*window\.history\.state\.url,\s*window\.scrollY,\s*window\.history\.state\.depth\)/,
    'scroll-record carries depth through');
});

test('SOURCE-LOCK (T2 + C1): navigate() computes one desiredDepth that resets a home-root PUSH to 0, and both state builds use it', () => {
  const navBody = COMMON_JS.slice(COMMON_JS.indexOf('function navigate('), COMMON_JS.indexOf('function handleDocumentClick'));
  // The home-root reset: a non-replace push to the home root is depth 0, else
  // the usual increment. This is what stops every go-home (button + the
  // programmatic navigate('/') in watch/setup) from stamping home at depth+1.
  assert.match(navBody, /const desiredDepth = \(!opts\.replace && isHomeRootTarget\(parsed\.pathname, parsed\.search\)\)\s*\?\s*0\s*:\s*nextHistoryDepth\(window\.history\.state, opts\.replace\)/,
    'desiredDepth resets a home-root push to 0');
  // Both the cache-hit and fetch-path state builds must consume desiredDepth
  // (not recompute a raw increment that would miss the reset).
  const builds = navBody.match(/buildHistoryState\([^)]*, desiredDepth\)/g) || [];
  assert.strictEqual(builds.length, 2, 'both state builds use the shared desiredDepth');
});
