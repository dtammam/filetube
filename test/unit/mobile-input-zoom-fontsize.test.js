'use strict';

// [UNIT] v1.25.4 polish (on-device iOS PWA): focusing an <input>/<select>/
// <textarea> whose COMPUTED font-size is under 16px makes iOS Safari
// auto-zoom the page in on focus -- well-known iOS behavior, not something
// the viewport meta tag controls (and `user-scalable=no`/`maximum-scale=1`
// is an accessibility anti-pattern that is NOT used here -- see index.html/
// watch.html/setup.html's shared viewport meta tag, unchanged). The one-off
// download modal's URL/folder text inputs and format/quality/filetype
// selects (shared by common.js's buildOneOffModal AND buildSubscribeModal,
// both reuse `.oneoff-modal-field`/`.oneoff-modal-row select`), the Settings
// (setup.html) form's text/number inputs and selects (`.setup-box
// .setup-select`/`input[type="text"|"number"]`, which also reaches the
// Subscriptions page's own format/quality/filetype selects since its
// "Add a subscription"/one-shot rows share the SAME `.setup-select` class),
// and the per-subscription settings sheet's cutoff-date/max-duration inputs
// and selects (`.sub-sheet-field`) were all 13px -- bumped to 16px, scoped
// to the existing mobile `@media (max-width: 768px)` breakpoint so desktop
// (mouse input, no zoom-on-focus behavior to guard against) keeps its
// compact 13px sizing.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

// v1.30 C1 (AC7.1/AC7.2): style.css's font-size declarations are now
// token-driven (`var(--fs-*)`) rather than bare px literals -- see the
// `:root` block. Parse the token definitions once so these tests can resolve
// `var(--fs-*)` back to a px number and keep asserting the FLOOR VALUE
// (>=16px via --fs-input-min specifically), not a specific source-text
// spelling.
function parseRootFsTokens(source) {
  const rootMatch = /:root\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(rootMatch, 'expected a :root block in style.css');
  const tokens = {};
  const re = /(--fs-[a-z0-9-]+):\s*([0-9]+)px/g;
  let m;
  while ((m = re.exec(rootMatch[1]))) {
    tokens[m[1]] = Number(m[2]);
  }
  return tokens;
}

const fsTokens = parseRootFsTokens(css);

// Resolves a font-size declaration's VALUE (e.g. "16px" or
// "var(--fs-input-min)") to a numeric px, following the token indirection
// through the parsed :root block.
function resolveFontSizePx(value) {
  const trimmed = value.trim();
  const varMatch = /^var\((--fs-[a-z0-9-]+)\)$/.exec(trimmed);
  if (varMatch) {
    const px = fsTokens[varMatch[1]];
    assert.ok(px !== undefined, `expected token ${varMatch[1]} to be defined in :root`);
    return px;
  }
  const pxMatch = /^([0-9]+)px$/.exec(trimmed);
  assert.ok(pxMatch, `expected a px literal or var(--fs-*) token, got "${value}"`);
  return Number(pxMatch[1]);
}

// This file has several independent `@media (max-width: 768px) { ... }`
// blocks (one per feature area) -- isolate the one containing `marker` by
// brace-depth counting, mirroring the pattern in
// watch-action-bar-nowrap.test.js, rather than a single `[\s\S]*?` regex
// that could span (and falsely match against) unrelated blocks.
function findMobileBlockContaining(marker) {
  const mediaRe = /@media \(max-width: 768px\)\s*\{/g;
  let m;
  while ((m = mediaRe.exec(css))) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(start, i - 1);
    if (body.includes(marker)) return body;
  }
  return null;
}

function assertMobileFontSizeAtLeast16(marker, selectorSource, ruleRe) {
  const block = findMobileBlockContaining(marker);
  assert.ok(block, `expected to find the @media (max-width: 768px) block containing "${marker}"`);
  const rule = ruleRe.exec(block);
  assert.ok(rule, `expected a mobile-scoped rule for ${selectorSource}`);
  const fontMatch = /font-size:\s*([^;]+);/.exec(rule[1]);
  assert.ok(fontMatch, `expected a font-size declaration on ${selectorSource}`);
  const px = resolveFontSizePx(fontMatch[1]);
  assert.ok(px >= 16, `expected ${selectorSource}'s mobile font-size >= 16px to avoid iOS auto-zoom-on-focus (got ${px}px)`);
}

test('one-off download modal: .oneoff-modal-field (URL/folder text inputs) is >=16px on mobile', () => {
  assertMobileFontSizeAtLeast16(
    '.oneoff-modal-field',
    '.oneoff-modal-field, .oneoff-modal-row select',
    /\.oneoff-modal-field,\s*\n\s*\.oneoff-modal-row select\s*\{([^}]*)\}/
  );
});

test('one-off download modal / Subscribe modal: .oneoff-modal-row select (format/quality/filetype) is >=16px on mobile', () => {
  // Same grouped rule as above -- .oneoff-modal-field is reused by BOTH the
  // header one-off download modal AND buildSubscribeModal's cutoff-date
  // input (common.js), and .oneoff-modal-row select is reused by both
  // modals' format/quality/filetype selects, so this single rule covers all
  // of them.
  const block = findMobileBlockContaining('.oneoff-modal-field');
  const rule = /\.oneoff-modal-field,\s*\n\s*\.oneoff-modal-row select\s*\{([^}]*)\}/.exec(block);
  assert.ok(rule, 'expected the grouped .oneoff-modal-field/.oneoff-modal-row select mobile rule');
  assert.match(rule[1], /font-size:\s*var\(--fs-input-min\);/);
  const fontMatch = /font-size:\s*([^;]+);/.exec(rule[1]);
  assert.ok(resolveFontSizePx(fontMatch[1]) >= 16);
});

test('Settings form: .setup-box .setup-select / input[type="text"|"number"] are >=16px on mobile (also reaches the Subscriptions page\'s own .setup-select fields)', () => {
  // NOTE: the same 3-selector group appears TWICE in this mobile block --
  // once for the pre-existing `min-height: 44px` tap-target rule, once for
  // the NEW font-size rule -- so match the font-size occurrence specifically
  // (a bare `ruleRe.exec(block)` would find the first, min-height, match).
  const block = findMobileBlockContaining('.setup-box .setup-select,\n  .setup-box input[type="text"],\n  .setup-box input[type="number"] {\n    font-size: var(--fs-input-min);');
  assert.ok(block, 'expected to find the @media (max-width: 768px) block containing the .setup-box font-size rule');
  const occurrences = block.match(/\.setup-box \.setup-select,\s*\n\s*\.setup-box input\[type="text"\],\s*\n\s*\.setup-box input\[type="number"\]\s*\{([^}]*)\}/g) || [];
  assert.strictEqual(occurrences.length, 2, 'expected the .setup-box .setup-select/input group to appear twice (min-height rule + font-size rule)');
  const fontSizeOccurrence = occurrences.find((o) => /font-size:\s*var\(--fs-input-min\);/.test(o));
  assert.ok(fontSizeOccurrence, 'expected one of the two occurrences to carry font-size: var(--fs-input-min)');
});

test('Settings form fix does not touch .setup-box .btn (buttons never trigger iOS zoom-on-focus)', () => {
  const block = findMobileBlockContaining('.setup-box .setup-select,\n  .setup-box input[type="text"],\n  .setup-box input[type="number"] {\n    font-size: var(--fs-input-min);');
  assert.ok(block);
  // A rule of exactly these 3 selectors (no .setup-box .btn) carrying the
  // font-size bump confirms .btn was deliberately left out.
  assert.match(block, /\.setup-box \.setup-select,\s*\n\s*\.setup-box input\[type="text"\],\s*\n\s*\.setup-box input\[type="number"\]\s*\{\s*font-size:\s*var\(--fs-input-min\);\s*\}/);
});

test('per-subscription settings sheet: .sub-sheet-field input / .setup-select are >=16px on mobile', () => {
  // The `.sub-sheet-field .setup-select, .sub-sheet-field input` selector
  // group appears TWICE: once as the base (desktop, 13px) rule, once inside
  // the NEW mobile-scoped font-size rule -- find the mobile occurrence
  // specifically, and confirm it really is inside an
  // `@media (max-width: 768px)` block (not accidentally unconditional).
  const occurrences = [...css.matchAll(/\.sub-sheet-field \.setup-select,\s*\n\s*\.sub-sheet-field input\s*\{([^}]*)\}/g)];
  assert.strictEqual(occurrences.length, 2, 'expected the .sub-sheet-field selector group to appear twice (base rule + mobile font-size rule)');
  const mobileOccurrence = occurrences.find((o) => /font-size:\s*var\(--fs-input-min\);/.test(o[1]));
  assert.ok(mobileOccurrence, 'expected one occurrence to carry font-size: var(--fs-input-min)');

  const idx = mobileOccurrence.index;
  const before = css.slice(0, idx);
  const lastMediaOpenIdx = before.lastIndexOf('@media (max-width: 768px) {');
  assert.ok(lastMediaOpenIdx > -1, 'expected an @media (max-width: 768px) block to precede the mobile .sub-sheet-field rule');
  const betweenMediaAndRule = css.slice(lastMediaOpenIdx, idx);
  const closeBraceCount = (betweenMediaAndRule.match(/\}/g) || []).length;
  const openBraceCount = (betweenMediaAndRule.match(/\{/g) || []).length;
  assert.ok(openBraceCount > closeBraceCount, 'expected the mobile .sub-sheet-field rule to still be inside the @media block (unbalanced braces = still open)');
});

test('header search: .search-input is >=16px on mobile (v1.25.10 -- tapping search no longer auto-zooms on iOS)', () => {
  assertMobileFontSizeAtLeast16(
    '.search-input',
    '.search-input',
    /\.search-input\s*\{([^}]*)\}/
  );
});

test('desktop sizing is unchanged: the base (unscoped) .oneoff-modal-field/.oneoff-modal-row select/.setup-select/.sub-sheet-field rules still resolve to 13px', () => {
  const oneOffField = /(?:^|\n)\.oneoff-modal-field\s*\{([^}]*)\}/.exec(css);
  assert.ok(oneOffField);
  assert.strictEqual(resolveFontSizePx(/font-size:\s*([^;]+);/.exec(oneOffField[1])[1]), 13);

  const oneOffSelect = /(?:^|\n)\.oneoff-modal-row select\s*\{([^}]*)\}/.exec(css);
  assert.ok(oneOffSelect);
  assert.strictEqual(resolveFontSizePx(/font-size:\s*([^;]+);/.exec(oneOffSelect[1])[1]), 13);

  const setupSelect = /(?:^|\n)\.setup-select\s*\{([^}]*)\}/.exec(css);
  assert.ok(setupSelect);
  assert.strictEqual(resolveFontSizePx(/font-size:\s*([^;]+);/.exec(setupSelect[1])[1]), 13);

  const subSheetField = /\.sub-sheet-field \.setup-select,\s*\n\.sub-sheet-field input\s*\{([^}]*)\}/.exec(css);
  assert.ok(subSheetField);
  assert.strictEqual(resolveFontSizePx(/font-size:\s*([^;]+);/.exec(subSheetField[1])[1]), 13);
});
