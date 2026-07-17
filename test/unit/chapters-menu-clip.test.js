'use strict';

// [UNIT] v1.43.1 B2 — the mobile chapters-menu top-clip fix. The popup opens
// upward from the control bar inside #player-wrapper (overflow:hidden,
// 45vh-capped on portrait phones) while its own stylesheet cap is 50vh
// there: any list taller than the space above the bar rendered its FIRST
// rows into the clipped band, unreachable by the menu's inner scroll (Dean's
// on-device symptom: top chapters visible only mid-rubber-band, or in
// fullscreen, which releases the wrapper cap).
//
// The fix is a measured clamp: resolveChaptersMenuMaxHeight (pure, tested
// directly here) + a DOM half locked against source text (the established
// player.js pattern — no jsdom harness in this codebase; Dean's on-device
// pass arbitrates real runtime behavior).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveChaptersMenuMaxHeight } = require('../../public/js/player.js');

// Geometry mirror of the constants in player.js: gap 6 (the CSS
// `bottom: calc(100% + 6px)` anchor), inset 8, floor 96.

test('menu that already fits: no clamp (null) — the stylesheet vh cap stays in charge', () => {
  // bar at 400px from viewport top, wrapper top at 100px: 286px available;
  // a 250px menu fits.
  assert.strictEqual(
    resolveChaptersMenuMaxHeight({ barTop: 400, clipTop: 100, menuHeight: 250 }),
    null
  );
});

test('menu taller than the space above the bar is clamped to exactly that space', () => {
  // avail = 400 - 6 - 100 - 8 = 286
  assert.strictEqual(
    resolveChaptersMenuMaxHeight({ barTop: 400, clipTop: 100, menuHeight: 300 }),
    286
  );
});

test('the REPORTED bug geometry: 45vh wrapper, 50vh menu — clamp lands inside the wrapper', () => {
  // iPhone-ish 844px viewport: wrapper top under the header at 60px, bar top
  // at 60 + 45vh(380) - 40(bar) = 400; menu rendered at 50vh = 422 -> taller
  // than the 326px of room, so rows were clipped above the wrapper top.
  const clamp = resolveChaptersMenuMaxHeight({ barTop: 400, clipTop: 60, menuHeight: 422 });
  assert.strictEqual(clamp, 326);
  assert.ok(clamp < 422, 'clamped below the stylesheet cap');
  assert.ok(60 + 8 + clamp <= 400 - 6, 'the whole menu now sits inside the visible band above the bar');
});

test('a wrapper scrolled above the viewport clips at the VIEWPORT (clipTop floors at 0)', () => {
  // avail = 300 - 6 - 0 - 8 = 286
  assert.strictEqual(
    resolveChaptersMenuMaxHeight({ barTop: 300, clipTop: -50, menuHeight: 400 }),
    286
  );
});

test('pathological tiny geometry floors at 96px instead of a sliver', () => {
  // avail = 80 - 6 - 0 - 8 = 66 -> floored
  assert.strictEqual(
    resolveChaptersMenuMaxHeight({ barTop: 80, clipTop: 0, menuHeight: 500 }),
    96
  );
});

test('hidden/unmeasurable menu (0-height rects) and malformed input resolve to null', () => {
  assert.strictEqual(resolveChaptersMenuMaxHeight({ barTop: 0, clipTop: 0, menuHeight: 0 }), null);
  assert.strictEqual(resolveChaptersMenuMaxHeight(null), null);
  assert.strictEqual(resolveChaptersMenuMaxHeight({ barTop: NaN, clipTop: 0, menuHeight: 10 }), null);
  assert.strictEqual(resolveChaptersMenuMaxHeight({ barTop: 100, clipTop: Infinity, menuHeight: 10 }), null);
  assert.strictEqual(resolveChaptersMenuMaxHeight({ barTop: 100, clipTop: 0, menuHeight: '300' }), null);
});

// ---- DOM wiring (source-text lock, the player.js precedent) ----------------

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

function stripLineComments(src) {
  return src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

test('clampChaptersMenuHeight measures real rects and applies the resolver result as an inline max-height', () => {
  const m = /function clampChaptersMenuHeight\(\) \{([\s\S]*?)\n {4}\}/.exec(PLAYER_JS);
  assert.ok(m, 'clampChaptersMenuHeight exists');
  const body = stripLineComments(m[1]);
  assert.match(body, /chaptersMenu\.hidden/, 'no-ops while hidden (rects are 0)');
  assert.match(body, /playerControls\.getBoundingClientRect\(\)\.top/, 'measures the bar, never guesses');
  assert.match(body, /host\.getBoundingClientRect\(\)\.top/, 'measures the clipping wrapper');
  assert.match(body, /style\.maxHeight = ''/, 'clears the previous clamp so the CSS cap can win again');
  assert.match(body, /resolveChaptersMenuMaxHeight\(/, 'delegates the math to the pure resolver');
});

test('the clamp runs on open (after unhide), on rebuild-while-open, and on resize', () => {
  const code = stripLineComments(PLAYER_JS);
  // Open path: unhide, then clamp.
  assert.match(code, /chaptersMenu\.hidden = !opening;[\s\S]{0,400}if \(opening\) clampChaptersMenuHeight\(\);/,
    'open path clamps after the menu is rendered');
  // buildChaptersMenu tail call covers Loop-arm rebuilds while open.
  const build = /function buildChaptersMenu\(\) \{([\s\S]*?)\n {4}\}/.exec(PLAYER_JS);
  assert.ok(build);
  assert.match(stripLineComments(build[1]), /clampChaptersMenuHeight\(\);/, 'rebuild re-measures');
  // Viewport changes (rotate, keyboard) re-measure.
  assert.match(code, /window\.addEventListener\('resize', clampChaptersMenuHeight\)/);
});
