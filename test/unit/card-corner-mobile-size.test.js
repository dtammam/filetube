'use strict';

// [UNIT] v1.147 (Dean): the mobile card-corner size bump. Source locks on
// style.css binding BOTH levers to exactly the six corner controls, plus a
// completeness net (every base-rule 14px corner icon must join the mobile
// 18px block) and a desktop-untouched lock. Gate round 1 hardening:
// comments are stripped ONCE before any walking (the v1.50/v1.77/v1.133/
// v1.140 comment-porosity class - a `@media (max-width: 768px)` inside
// comment PROSE must never open a bogus range), and every per-button
// binding pins the RULE BODIES, not mere selector presence (a same-block
// override rule re-shrinking one button must go red).

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const RAW = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
// Strip comments ONCE at read; every lock below runs on comment-free text.
const CSS = RAW.replace(/\/\*[^]*?\*\//g, '');

// The six corner controls and their icon classes (main.js's corner-control
// set; the feedhide button is deliberately NOT here - it has no scrim pill
// and its mobile growth uses min-width, the v1.102 approach).
const CORNER_ICONS = [
  ['card-download-btn', 'icon-download'],
  ['card-delete-btn', 'icon-delete'],
  ['card-like-btn', 'icon-heart'],
  ['card-share-btn', 'icon-share'],
  ['card-reheat-btn', 'icon-flame'],
  ['card-queue-btn', 'icon-queue'],
];

// Locate every `@media (max-width: 768px)` block by BRACE-WALKING the
// comment-stripped text (a lazy regex to the first `\n}` under-strips
// nested rules - the v1.141 flatten lesson). MOBILE is the concatenated
// INNER content of the blocks (flat rules only - no media prelude, so the
// per-rule parser below sees clean selectors); OUTSIDE is the stripped css
// with the full blocks cut out.
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
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    ranges.push([m.index, i + 1, open]);
  }
  return ranges;
}

const RANGES = mobileBlockRanges(CSS);
const MOBILE = RANGES.map(([, end, open]) => CSS.slice(open + 1, end - 1)).join('\n');
const OUTSIDE = RANGES.reduceRight((css, [s, e]) => css.slice(0, s) + css.slice(e), CSS);

// Every rule inside the mobile blocks whose selector LIST contains a
// selector matching `re` exactly (anchored by the caller) -> its body.
function mobileRuleBodiesFor(re) {
  const bodies = [];
  for (const m of MOBILE.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1].split(',').some((sel) => re.test(sel.trim()))) bodies.push(m[2]);
  }
  return bodies;
}

test('every corner icon is sized 18px in the mobile block - and EVERY matching mobile rule agrees (no same-block re-shrink)', () => {
  for (const [btn, icon] of CORNER_ICONS) {
    const bodies = mobileRuleBodiesFor(new RegExp(`^\\.${btn} \\.${icon}$`));
    assert.ok(bodies.length >= 1, `${btn} .${icon} appears in a mobile rule`);
    for (const b of bodies) {
      assert.match(b, /width: 18px/, `${btn} .${icon}: every mobile body says width 18px`);
      assert.match(b, /height: 18px/, `${btn} .${icon}: every mobile body says height 18px`);
    }
  }
});

test('every corner button gets the tap-zone ::after - and EVERY matching mobile rule carries the full extension', () => {
  for (const [btn] of CORNER_ICONS) {
    const bodies = mobileRuleBodiesFor(new RegExp(`^\\.${btn}::after$`));
    assert.ok(bodies.length >= 1, `${btn}::after appears in a mobile rule`);
    for (const b of bodies) {
      assert.match(b, /content: ''/, `${btn}::after carries content`);
      assert.match(b, /position: absolute/, `${btn}::after is absolutely positioned`);
      assert.match(b, /inset: -9px -7px/, `${btn}::after: every mobile body carries the full extension`);
    }
  }
});

test('gate W3: list view reduces the VERTICAL extension so corner zones cannot shadow sibling pills', () => {
  for (const [btn] of CORNER_ICONS) {
    const bodies = mobileRuleBodiesFor(new RegExp(`^\\.video-grid\\.list-view \\.${btn}::after$`));
    assert.ok(bodies.length >= 1, `list-view override exists for ${btn}::after`);
    for (const b of bodies) {
      assert.match(b, /inset: -2px -7px/, `${btn}: list-view zones pull vertical back to -2px`);
    }
  }
});

test('gate S1: the emoji icon set keeps its AC7 auto sizing for delete/download (no empty 18px box)', () => {
  for (const [btn, icon] of [['card-delete-btn', 'icon-delete'], ['card-download-btn', 'icon-download']]) {
    const bodies = mobileRuleBodiesFor(new RegExp(`^\\[data-icons="emoji"\\] \\.${btn} \\.${icon}$`));
    assert.ok(bodies.length >= 1, `emoji exception exists for ${btn} .${icon}`);
    for (const b of bodies) {
      assert.match(b, /width: auto/, `${btn} emoji glyph stays auto-width`);
      assert.match(b, /height: auto/, `${btn} emoji glyph stays auto-height`);
    }
  }
});

test('COMPLETENESS: every base-rule corner icon (14px sibling convention) has a mobile 18px twin', () => {
  // Derive the base set from the CSS itself: any `.card-X-btn .icon-Y`
  // selector whose rule body carries the 14px pair must appear in the
  // mobile block. Selector LISTS are split on commas first - three of the
  // six share one grouped rule.
  const base = [];
  for (const m of OUTSIDE.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/width: 14px/.test(m[2]) || !/height: 14px/.test(m[2])) continue;
    for (const sel of m[1].split(',')) {
      const pair = /\.(card-[a-z]+-btn) \.(icon-[a-z-]+)/.exec(sel);
      if (pair) base.push([pair[1], pair[2]]);
    }
  }
  assert.ok(base.length >= 6, `expected at least the six corner icons at base 14px, found ${base.length}`);
  for (const [btn, icon] of base) {
    assert.ok(
      mobileRuleBodiesFor(new RegExp(`^\\.${btn} \\.${icon}$`)).length >= 1,
      `${btn} .${icon} is 14px at base but missing from the mobile 18px block (a new sibling must join it)`
    );
  }
});

test('desktop is untouched: base rules KEEP 14px; no 18px sizing or ::after leaks outside the mobile blocks', () => {
  for (const [btn, icon] of CORNER_ICONS) {
    // The grouped base rules put multiple selectors before one body - find
    // the rule whose selector list includes this pair and check its body.
    const baseBodies = [];
    for (const m of OUTSIDE.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (m[1].split(',').some((sel) => new RegExp(`^\\.${btn} \\.${icon}$`).test(sel.trim()))) baseBodies.push(m[2]);
    }
    assert.ok(baseBodies.length >= 1, `${btn} .${icon} has a base rule`);
    assert.ok(baseBodies.some((b) => /width: 14px/.test(b) && /height: 14px/.test(b)),
      `${btn} .${icon} keeps its 14px base rule`);
    assert.ok(!baseBodies.some((b) => /width: 18px/.test(b)),
      `${btn} .${icon} has no 18px rule outside the mobile blocks`);
    assert.doesNotMatch(OUTSIDE, new RegExp(`\\.${btn}::after`),
      `${btn}::after exists only inside the mobile blocks`);
  }
});
