'use strict';

// [UNIT] v1.95 mobile touch targets - a SOURCE LOCK that each named small
// control carries a >=44px (--size-touch) hit treatment inside the codebase's
// mobile `@media (max-width:768px)` convention, and that the seek band did NOT
// break the JS drag contract. PRESENCE-binding only: CSS/touch cannot be
// behaviour-tested without a browser, so the FEEL is Dean's on-device pass -
// this exists so the treatment can't be silently deleted/regressed.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');

// Isolate the v1.95 touch-target @media block (balanced-brace scan from its
// header) so a rule elsewhere can't satisfy these by accident.
function v195Block() {
  const start = css.indexOf('v1.95: MOBILE TOUCH TARGETS');
  assert.ok(start >= 0, 'the v1.95 touch-target block header exists');
  const at = css.indexOf('@media (max-width: 768px)', start);
  assert.ok(at >= 0, 'the block uses the codebase @media (max-width:768px) convention (not a new pointer/hover query)');
  let depth = 0, end = -1;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end > at, 'the @media block is brace-balanced');
  return css.slice(at, end + 1);
}

test('each named mobile control carries a --size-touch hit treatment in the 768px block', () => {
  const block = v195Block();
  assert.match(block, /\.btn\s*\{[^}]*min-height:\s*var\(--size-touch\)/, 'resume/all buttons: 44px min-height floor');
  assert.match(block, /\.notif-row-dismiss\s*\{[^}]*min-width:\s*var\(--size-touch\)[^}]*min-height:\s*var\(--size-touch\)/, 'notification x: 44px box');
  assert.match(block, /\.queue-row-remove\s*\{[^}]*min-width:\s*var\(--size-touch\)/, 'queue remove x: 44px box');
  assert.match(block, /\.queue-row-order\s+\.queue-row-move\s*\{[^}]*min-height:\s*calc\(var\(--size-touch\)/, 'queue arrows: fill + split-height');
  assert.match(block, /#seek-bar\s*\{[^}]*height:\s*var\(--size-touch\)/, "seek bar: 44px touch band (Dean's top miss)");
});

test('the seek band keeps the JS drag contract intact (touch-action:none unchanged)', () => {
  // The base .pc-range must still own the gesture end-to-end (touch-action:none
  // + player.js pointer-capture). The band only enlarges the pointer-catch area;
  // it must NOT hand the drag to native/CSS scrolling.
  assert.match(css, /\.pc-range\s*\{[^}]*touch-action:\s*none/, 'the seek input keeps touch-action:none (JS owns the drag)');
});
