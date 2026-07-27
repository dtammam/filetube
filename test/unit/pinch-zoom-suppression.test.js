'use strict';

// [UNIT] v1.47.4 item 2 -- disable accidental pinch/double-tap zoom, with the
// reader as Dean's explicit and exclusive carve-out.
//
// Dean: "I want to fully disable pinch-to-zoom on iOS/Mobile viewport. It's easy
// to zoom in accidentally and is just a janky experience." Carve-out (his
// words): reading, "explicitly and exclusively".
//
// Pure decision + source-locks. There is no browser harness here and there
// deliberately isn't one: whether a real iOS PWA still zooms is Dean's
// on-device pass to answer (this repo's own v1.45.2 lesson -- a CSS/layout-blind
// gate cannot certify device behavior). What IS mechanically checkable, and what
// these lock, are the properties a refactor could silently break: the reader
// keeps zoom, everything else does not, and the policy is driven by the LIVE
// ROUTE rather than by per-shell static markup.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  pinchZoomAllowedForView,
  deriveRouteView,
  ZOOM_ALLOWED_VIEW,
  VIEWPORT_ZOOM_LOCKED,
  VIEWPORT_ZOOM_FREE,
} = require('../../public/js/common.js');

// ---- pinchZoomAllowedForView (pure) ---------------------------------------

test('pinchZoomAllowedForView: the reader -- and only the reader -- may zoom', () => {
  assert.strictEqual(pinchZoomAllowedForView('read'), true);
  for (const view of ['home', 'watch', 'setup', 'books', 'music', 'subscriptions']) {
    assert.strictEqual(pinchZoomAllowedForView(view), false, `${view} must not zoom`);
  }
});

test('pinchZoomAllowedForView: an unknown/absent route fails safe to SUPPRESSED', () => {
  // Fail-safe direction matters here: an unrecognized surface defaulting to
  // "zoom allowed" would leave exactly the stray pages Dean is complaining
  // about still zoomy, which is the failure mode this item exists to remove.
  for (const bad of [null, undefined, '', 'nonsense', 0, {}, []]) {
    assert.strictEqual(pinchZoomAllowedForView(bad), false, `${JSON.stringify(bad)} must suppress`);
  }
});

test('pinchZoomAllowedForView: agrees with the router on the real /read.html path', () => {
  // Guards against the carve-out drifting away from the actual route name if
  // deriveRouteView is ever renumbered/renamed.
  assert.strictEqual(deriveRouteView('/read.html'), ZOOM_ALLOWED_VIEW);
  assert.strictEqual(pinchZoomAllowedForView(deriveRouteView('/read.html')), true);
  assert.strictEqual(pinchZoomAllowedForView(deriveRouteView('/')), false);
  assert.strictEqual(pinchZoomAllowedForView(deriveRouteView('/books')), false,
    'the books GRID is a normal app surface -- only the reader itself zooms');
});

// ---- the two viewport strings ---------------------------------------------

test('the locked viewport disables scaling; the free one is the untouched default', () => {
  assert.match(VIEWPORT_ZOOM_LOCKED, /user-scalable=no/);
  assert.match(VIEWPORT_ZOOM_LOCKED, /maximum-scale=1/);
  assert.doesNotMatch(VIEWPORT_ZOOM_FREE, /user-scalable=no/);
  assert.doesNotMatch(VIEWPORT_ZOOM_FREE, /maximum-scale/);
  // Both must keep the notch handling the shells already rely on -- dropping
  // viewport-fit=cover would regress safe-area layout on every iPhone.
  for (const content of [VIEWPORT_ZOOM_LOCKED, VIEWPORT_ZOOM_FREE]) {
    assert.match(content, /width=device-width/);
    assert.match(content, /viewport-fit=cover/);
  }
});

// ---- source-locks: wiring ---------------------------------------------------

const COMMON = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');

test('SPA-CORRECTNESS LOCK: the policy is re-evaluated on every view change, not once at boot', () => {
  // THE load-bearing property. /read.html is an SPA route, so opening a book
  // from the Books grid swaps #view-root while the document (and its <meta
  // viewport>) still belongs to whichever shell loaded first. A boot-only or
  // per-shell carve-out would hand the reader the previous page's policy.
  const navHighlight = COMMON.slice(COMMON.indexOf('function updateActiveNavHighlight()'));
  assert.match(navHighlight.slice(0, 600), /applyZoomPolicy\(\)/,
    'applyZoomPolicy must ride updateActiveNavHighlight, which runs after every view change');
  assert.match(COMMON, /function applyZoomPolicy\(\)[\s\S]*?deriveRouteView\(window\.location\.pathname/,
    'the policy must read the LIVE url, never passed-in/cached view state');
});

test('the pinch listener re-reads the route at EVENT time (no enable/disable lifecycle to desync)', () => {
  const wiring = COMMON.slice(COMMON.indexOf('function wirePinchZoomSuppression()'), COMMON.indexOf('function wirePinchZoomSuppression()') + 900);
  assert.match(wiring, /pinchZoomAllowedForView\(deriveRouteView\(window\.location\.pathname/,
    'the handler must consult the live route, not a captured flag');
  assert.match(wiring, /addEventListener\('gesturestart', suppress, \{ passive: false \}\)/,
    'gesturestart must be non-passive -- a passive listener cannot preventDefault');
  assert.match(wiring, /addEventListener\('gesturechange', suppress, \{ passive: false \}\)/);
  assert.doesNotMatch(wiring, /removeEventListener/,
    'bound once for the document lifetime -- a teardown path could strand the wrong policy');
});

test('both zoom-suppression calls run at boot on EVERY page, outside the router', () => {
  // bootRouter() bails early on a non-route shell (login/welcome), so wiring
  // this inside the router would leave the first pages a user lands on zoomy.
  assert.match(COMMON, /wirePinchZoomSuppression\(\);\s*\n\s*applyZoomPolicy\(\);/,
    'both seeded at boot, before the route-driven re-evaluation takes over');
});

test('CSS: double-tap zoom is off app-wide and the reader opts back in', () => {
  assert.match(CSS, /body \{\s*touch-action: manipulation;\s*\}/,
    'manipulation is what kills double-tap zoom while leaving panning intact');
  assert.match(CSS, /body\[data-view="read"\] \{\s*touch-action: auto;\s*\}/,
    'the reader carve-out re-enables the browser default');
});

test('ACCESSIBILITY LOCK: only GESTURE zoom is suppressed -- text scaling is untouched', () => {
  // Suppressing gesture zoom is a polish fix; taking away a user's chosen text
  // size would be an accessibility regression. Nothing here may pin font size
  // or disable text scaling to achieve the zoom lock.
  const zoomBlock = COMMON.slice(COMMON.indexOf('const ZOOM_ALLOWED_VIEW'), COMMON.indexOf('function wirePinchZoomSuppression'));
  assert.doesNotMatch(zoomBlock, /text-size-adjust/i,
    'never pin text scaling to achieve the zoom lock');
  assert.doesNotMatch(CSS.slice(CSS.indexOf('body {\n  touch-action'), CSS.indexOf('body[data-view="read"]')), /font-size/,
    'the touch-action rule must not smuggle in a font-size lock');
});
