'use strict';

// [UNIT] v1.204: the bottom-right card-corner slot's geometry. Source-locks
// the two CSS pieces the JS behavior depends on:
//   1. .card-corner-br anchors a control in the bottom-right (bottom+right).
//   2. .duration-badge--beside-corner shifts the badge LEFT so it sits beside
//      that button - a base offset (desktop) AND a wider mobile offset (the
//      18px glyph makes the pill wider), inside the @media (max-width: 768px)
//      block.
// A CSS edit that drops the slot anchor or the badge offset goes red here
// rather than silently colliding the badge and the button on device (jsdom
// computes no layout, so the full-chain test cannot catch a geometry drop).

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const RAW = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
// Strip comments ONCE at read (the v1.50/v1.77/v1.133 comment-porosity class -
// a positional value quoted in prose must never satisfy a lock).
const CSS = RAW.replace(/\/\*[^]*?\*\//g, '');

// Brace-walk every @media (max-width: 768px) block (a lazy regex under-strips
// nested rules - the v1.141 flatten lesson). MOBILE = concatenated inner
// bodies; OUTSIDE = the stripped css with those blocks cut out.
function mobileBlockRanges(css) {
  const ranges = [];
  const re = /@media \(max-width: 768px\)/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    let i = css.indexOf('{', m.index);
    const open = i;
    let depth = 0;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') { depth--; if (depth === 0) break; }
    }
    ranges.push([m.index, i + 1, open]);
  }
  return ranges;
}
const RANGES = mobileBlockRanges(CSS);
const MOBILE = RANGES.map(([, end, open]) => CSS.slice(open + 1, end - 1)).join('\n');
const OUTSIDE = RANGES.reduceRight((css, [s, e]) => css.slice(0, s) + css.slice(e), CSS);

// The body of the rule whose selector list contains EXACTLY `selector`.
function ruleBody(css, selector) {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1].split(',').some((sel) => sel.trim() === selector)) return m[2];
  }
  return null;
}

test('.card-corner-br anchors a control in the bottom-right (bottom + right)', () => {
  const body = ruleBody(OUTSIDE, '.card-corner-br');
  assert.ok(body, '.card-corner-br rule exists at base');
  assert.match(body, /bottom:\s*6px/, 'bottom anchor');
  assert.match(body, /right:\s*6px/, 'right anchor');
});

test('.duration-badge--beside-corner shifts the badge left on desktop (base), clearing the resting corner button', () => {
  const body = ruleBody(OUTSIDE, '.duration-badge--beside-corner');
  assert.ok(body, 'the base beside-corner rule exists');
  // 6px anchor + 26px button (14px icon + 2x6px pad) + 4px gap = 36px.
  assert.match(body, /right:\s*36px/, 'desktop offset clears the 26px button');
});

test('.duration-badge--beside-corner has a WIDER mobile offset inside the 768px block (30px pill)', () => {
  const body = ruleBody(MOBILE, '.duration-badge--beside-corner');
  assert.ok(body, 'the mobile beside-corner override exists in a max-width:768px block');
  // 6px anchor + 30px button (18px icon + 2x6px pad) + 4px gap = 40px.
  assert.match(body, /right:\s*40px/, 'mobile offset clears the wider 30px button');
});

test('an ARMED bottom-right delete hides the badge (v1.204 gate fix: the one expanding control never paints over the duration)', () => {
  const body = ruleBody(OUTSIDE, '.card-media:has(.card-corner-br.armed) .duration-badge');
  assert.ok(body, 'the armed-suppression rule exists');
  assert.match(body, /visibility:\s*hidden/, 'the badge is hidden while a BR control is armed');
});

test('v1.205.1: the duration badge sits ABOVE the hover preview (z-index) so the time stays visible while the clip plays', () => {
  const badge = ruleBody(OUTSIDE, '.duration-badge');
  assert.ok(badge, '.duration-badge base rule exists');
  assert.match(badge, /z-index:\s*2/, 'badge z-index 2 - above .card-preview');
  const prev = ruleBody(OUTSIDE, '.card-preview');
  assert.ok(prev, '.card-preview rule exists');
  assert.match(prev, /z-index:\s*1/, '.card-preview stays z:1 (below the z:2 badge)');
});

test('v1.205.1: the duration pill matches the corner glyph size (14px base, 18px mobile) so it equals the corner-control height', () => {
  const base = ruleBody(OUTSIDE, '.duration-badge');
  assert.match(base, /font-size:\s*var\(--fs-md\)/, 'base font --fs-md (14px, the corner glyph size)');
  assert.match(base, /line-height:\s*1/, 'line-height 1 -> height = font + padding, like the buttons');
  const mob = ruleBody(MOBILE, '.duration-badge');
  assert.ok(mob, '.duration-badge has a mobile rule');
  assert.match(mob, /font-size:\s*var\(--fs-2xl\)/, 'mobile font --fs-2xl (18px, the mobile corner glyph size)');
});

test('the base duration badge keeps its 4px home (the shift is opt-in, not the default)', () => {
  const body = ruleBody(OUTSIDE, '.duration-badge');
  assert.ok(body, '.duration-badge base rule exists');
  assert.match(body, /right:\s*4px/, 'the badge still homes at right:4px until a BR button shifts it');
});
