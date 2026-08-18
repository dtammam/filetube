'use strict';

// [UNIT] v1.147 (Dean): the mobile card-corner size bump. Source locks on
// style.css binding BOTH levers to exactly the six corner controls, plus a
// completeness net: every base-rule corner icon (the 14px sibling
// convention) must appear in the mobile 18px block, so a seventh sibling
// added later cannot silently skip the mobile sizing. The base rules must
// KEEP 14px - desktop is contractually byte-identical (Dean: "without
// altering anything else").

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

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

// Locate every `@media (max-width: 768px)` block by BRACE-WALKING (not a
// lazy regex to the first `\n}` - that under-strips nested rules, the
// v1.141 flatten-@media lesson). Returns [start, end] ranges of the full
// blocks; MOBILE is their concatenation, OUTSIDE is the css with the
// ranges cut out.
function mobileBlockRanges(css) {
  const ranges = [];
  const re = /@media \(max-width: 768px\)/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    let i = css.indexOf('{', m.index);
    let depth = 0;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    ranges.push([m.index, i + 1]);
  }
  return ranges;
}

const RANGES = mobileBlockRanges(CSS);
const MOBILE = RANGES.map(([s, e]) => CSS.slice(s, e)).join('\n');
const OUTSIDE = RANGES.reduceRight((css, [s, e]) => css.slice(0, s) + css.slice(e), CSS);

test('every corner icon is sized 18px inside the mobile block (the +30% bump)', () => {
  for (const [btn, icon] of CORNER_ICONS) {
    const sel = new RegExp(`\\.${btn} \\.${icon}`);
    assert.match(MOBILE, sel, `${btn} .${icon} appears in a max-width:768px block`);
  }
  // The six share one rule whose body is exactly the 18px pair.
  assert.match(
    MOBILE,
    /\.card-queue-btn \.icon-queue \{\s*width: 18px;\s*height: 18px;\s*\}/,
    'the mobile icon rule sizes 18px x 18px'
  );
});

test('every corner button gets the invisible tap-zone ::after in the mobile block', () => {
  for (const [btn] of CORNER_ICONS) {
    assert.match(MOBILE, new RegExp(`\\.${btn}::after`), `${btn}::after appears in a max-width:768px block`);
  }
  assert.match(
    MOBILE,
    /\.card-queue-btn::after \{\s*content: '';\s*position: absolute;\s*inset: -9px -7px;/,
    'the tap-zone extension is a content-carrying absolute inset pseudo'
  );
});

test('COMPLETENESS: every base-rule corner icon (14px sibling convention) has a mobile 18px twin', () => {
  // Derive the base set from the CSS itself: any `.card-X-btn .icon-Y`
  // selector whose rule body carries the 14px pair must appear in the
  // mobile block. Selector LISTS are split on commas first - three of the
  // six share one grouped rule (the first-draft extractor missed them and
  // found only 4).
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
    assert.match(MOBILE, new RegExp(`\\.${btn} \\.${icon}`),
      `${btn} .${icon} is 14px at base but missing from the mobile 18px block (a new sibling must join it)`);
  }
});

test('desktop is untouched: the base rules KEEP the 14px sibling convention', () => {
  for (const [btn, icon] of CORNER_ICONS) {
    assert.match(
      OUTSIDE,
      new RegExp(`\\.${btn} \\.${icon}[^{]*\\{[^}]*width: 14px;[^}]*height: 14px;`),
      `${btn} .${icon} keeps its 14px base rule`
    );
  }
  // And no stray 18px sizing or tap-extension leaked outside the mobile blocks.
  for (const [btn, icon] of CORNER_ICONS) {
    assert.doesNotMatch(
      OUTSIDE,
      new RegExp(`\\.${btn} \\.${icon}[^{]*\\{[^}]*width: 18px`),
      `${btn} .${icon} has no 18px rule outside the mobile block`
    );
    assert.doesNotMatch(
      OUTSIDE,
      new RegExp(`\\.${btn}::after`),
      `${btn}::after exists only inside the mobile block`
    );
  }
});
