'use strict';

// [UNIT] v1.47.4 item 5 -- the touch-eating-overlay class, audited + instrumented.
//
// Dean: "Sometimes, video input disappears on mobile and requires a force close
// of the PWA for it to return/behave normally." (Clarified at intake: touch
// input on the player stops responding.)
//
// THE PRECEDENT, in this repo, in this exact shape (v1.17.0 T5): the
// `.oneoff-modal-backdrop` rule set `display: flex` with no `[hidden]`
// override, so `backdrop.hidden = true` did NOT hide it -- an author `display`
// declaration beats the UA stylesheet's `[hidden] { display: none }`. The
// result was a full-viewport, `z-index: 2100`, invisible overlay that stayed
// painted and ATE EVERY TOUCH. The page looked fine and was dead to input.
//
// HONEST SCOPE, locked here so it cannot drift: this file audits a KNOWN bug
// class and locks an instrument. It does NOT reproduce Dean's symptom -- his
// report is intermittent and he has no capture. These are hardening + a
// self-reporting probe, not a claimed fix.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describeTouchTarget } = require('../../public/js/common.js');

const CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
const COMMON = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');

// ---- the audit -------------------------------------------------------------

// Overlays that (a) are full-viewport or near it, and (b) are shown/hidden via
// the `hidden` ATTRIBUTE rather than by being added/removed from the DOM. Each
// therefore needs an explicit `[hidden]` display override, or it stays painted
// while "hidden" and swallows every touch underneath it.
const ATTRIBUTE_HIDDEN_OVERLAYS = [
  '.oneoff-modal-backdrop',
  '.playlists-sheet-backdrop',
  '.chapters-menu',
  '#player-dock',
];

/**
 * Extract the BARE top-level rule block for `selector` (i.e. `\n<selector> {
 * ... }`), ignoring compound/descendant/media-scoped variants. Returns '' when
 * there is no such rule.
 */
function bareRuleBody(css, selector) {
  const marker = '\n' + selector + ' {';
  const start = css.indexOf(marker);
  if (start === -1) return '';
  const open = start + marker.length;
  const close = css.indexOf('}', open);
  return close === -1 ? '' : css.slice(open, close);
}

// The audit tests the DANGER CONDITION, not one particular remedy. An overlay
// is unsafe only when its bare rule declares a VISIBLE `display` (which beats
// the UA `[hidden] { display: none }` rule) AND nothing re-hides it for the
// `[hidden]` state. Three shapes are all safe, and all three are in use here:
//   1. `sel[hidden] { display: none !important }`  -- explicit override
//   2. bare `sel { display: none }` + `sel:not([hidden])` to reveal
//   3. no `display` on the bare rule at all -- the UA rule wins unopposed
test('AUDIT: no attribute-hidden overlay can stay painted (and eat touches) while hidden', () => {
  for (const selector of ATTRIBUTE_HIDDEN_OVERLAYS) {
    const bare = bareRuleBody(CSS, selector);
    const displayMatch = /(?:^|[;{\s])display:\s*([a-z-]+)/i.exec(bare);
    const declaresVisibleDisplay = Boolean(displayMatch) && displayMatch[1].toLowerCase() !== 'none';
    if (!declaresVisibleDisplay) continue; // shapes 2 and 3 -- safe by construction

    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      CSS,
      new RegExp(escaped + '\\[hidden\\]'),
      `${selector} declares a visible display on its bare rule and is toggled via the hidden `
      + 'ATTRIBUTE, but has no [hidden] override -- an author `display` beats the UA [hidden] rule, '
      + 'leaving it painted and eating every touch underneath (the v1.17.0 T5 bug, exactly)',
    );
  }
});

test('AUDIT: the audit itself can actually detect the v1.17.0 bug (negative control)', () => {
  // A green audit is only meaningful if it would go red on the real defect.
  // This reconstructs the exact pre-v1.17.0 CSS and proves the check fires.
  const buggy = '\n.oneoff-modal-backdrop {\n  position: fixed;\n  display: flex;\n  z-index: 2100;\n}\n';
  const bare = bareRuleBody(buggy, '.oneoff-modal-backdrop');
  const displayMatch = /(?:^|[;{\s])display:\s*([a-z-]+)/i.exec(bare);
  assert.ok(displayMatch && displayMatch[1] === 'flex', 'the danger condition must be detected');
  assert.doesNotMatch(buggy, /\.oneoff-modal-backdrop\[hidden\]/, 'and the missing override noticed');
});

test('AUDIT: the v1.17.0 regression itself stays fixed (the original touch-eater)', () => {
  // This is the exact rule whose absence caused the original bug. If someone
  // deletes it, the one-off modal backdrop starts eating every touch again.
  assert.match(CSS, /\.oneoff-modal-backdrop\[hidden\]/,
    'the fix for the original full-viewport touch-eater must not be removed');
});

test('AUDIT: the pull-to-refresh indicator cannot eat touches', () => {
  // A `position: fixed` element that is merely faded to opacity:0 still
  // receives touches unless it opts out -- and item 3 made this one live
  // LONGER (it now persists through the whole scan), which widens exactly that
  // window. `pointer-events: none` is what keeps it inert.
  const rule = CSS.slice(CSS.indexOf('.ptr-indicator {'), CSS.indexOf('.ptr-indicator.visible'));
  assert.match(rule, /pointer-events: none/,
    'the PTR indicator is fixed-position and now persists through a whole scan -- it must never take touches');
});

// ---- the gesture-latch safety net ------------------------------------------

test('the player releases gesture latches when the PWA is backgrounded', () => {
  const PLAYER = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');
  const block = PLAYER.slice(PLAYER.indexOf('function resetGestureLatchesOnBackground'));
  assert.match(block.slice(0, 800), /resetTransientPlaybackUi\(\)/,
    'it must reuse the SAME reset dock()/close() use, not reimplement one');
  // All three backgrounding signals, because iOS does not reliably deliver
  // touchend/touchcancel when a PWA is backgrounded mid-gesture.
  for (const evt of ['pagehide', 'freeze', 'hidden']) {
    assert.ok(block.includes(`'${evt}'`), `${evt} must trigger the latch reset`);
  }
  assert.match(block.slice(0, 800), /catch \(_\)/,
    'a safety net that runs on the unload path must never throw');
});

// ---- describeTouchTarget (pure) --------------------------------------------

test('describeTouchTarget: identifies an element compactly by tag/id/class', () => {
  assert.equal(describeTouchTarget({ tagName: 'DIV', id: 'x', className: 'a b' }), 'div#x.a.b');
  assert.equal(describeTouchTarget({ tagName: 'BUTTON', id: '', className: '' }), 'button');
  assert.equal(
    describeTouchTarget({ tagName: 'DIV', id: '', className: 'oneoff-modal-backdrop' }),
    'div.oneoff-modal-backdrop',
    'the culprit must be identifiable by class in a single log line',
  );
});

test('describeTouchTarget: never throws on a null/foreign/odd node', () => {
  assert.equal(describeTouchTarget(null), '(none)');
  assert.equal(describeTouchTarget(undefined), '(none)');
  assert.equal(describeTouchTarget('a string'), '(none)');
  // SVG elements expose className as an SVGAnimatedString, not a string --
  // reading `.trim()` off it would throw in a real browser.
  assert.doesNotThrow(() => describeTouchTarget({ tagName: 'svg', className: { baseVal: 'icon' } }));
  assert.equal(describeTouchTarget({ tagName: 'svg', className: { baseVal: 'icon' } }), 'svg');
  assert.doesNotThrow(() => describeTouchTarget({}));
});

// ---- opt-in posture --------------------------------------------------------

test('the touch instrument is OPT-IN, PASSIVE, and inert without ?debugTouch=1', () => {
  const fn = COMMON.slice(COMMON.indexOf('function wireTouchTargetDebug()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /debugTouch'\) === '1'/, 'gated on the query flag');
  assert.match(body, /if \(!enabled\) return false;/);
  assert.ok(body.indexOf('if (!enabled) return false;') < body.indexOf('addEventListener'),
    'no listener may be bound on a normal load');
  // A diagnostic that could alter touch behavior would corrupt the very
  // evidence it exists to collect.
  assert.match(body, /\{ passive: true, capture: true \}/,
    'the probe must be passive so it cannot change what it is measuring');
  assert.match(body, /elementFromPoint/,
    'the point-hit element is the whole diagnostic -- e.target alone would miss the overlay');
});
