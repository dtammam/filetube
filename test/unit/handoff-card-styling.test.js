'use strict';

// [UNIT] v1.78 device handoff - the card's STYLING SOURCE, machine-derived.
//
// Two checks that no existing instrument performs, both ruled mandatory by
// CONTRIBUTING after v1.68.3 (the card-corner <select>s that shipped
// browser-bare through the cleanest gate on record):
//
//   1. Every className the controller RENDERS must have a CSS rule behind it.
//      The token census only sees literals that are PRESENT - a class with no
//      rule at all is invisible to it, and gate seats review code, not pixels.
//
//   2. Every token the card CONSUMES must resolve in all four era skins
//      (AC4). The card deliberately carries no [data-theme]-scoped rules of
//      its own - it consumes base tokens and lets the eras redefine them -
//      which also sidesteps residual #103 (the census is selector-blind to
//      [data-theme]-scoped consumer rules).
//
// Both lists are DERIVED from the source, never hand-enumerated: a
// hand-written roster rots the moment someone adds a class (this repo's
// recurring scar). Add a class to the card and this test starts checking it
// without anyone remembering to update it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const commonSrc = fs.readFileSync(path.join(ROOT, 'public/js/common.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');

// The controller is one IIFE; slice it out so we only mine ITS class names and
// never the rest of a 10k-line file.
function handoffControllerSource() {
  const start = commonSrc.indexOf('const handoffCard = (() => {');
  assert.ok(start > -1, 'the handoff controller must be findable - did it get renamed?');
  const end = commonSrc.indexOf('\n})();', start);
  assert.ok(end > start, 'controller end not found');
  return commonSrc.slice(start, end);
}

// Strip comments ONCE, at read - never per-extraction, and for BOTH languages.
// A commented-out rule keeps its literal otherwise (the v1.50 comment-porous
// lock lesson, re-bit in v1.77). I re-bit it a third time writing this file:
// the innerHTML ban below matched the word "innerHTML" inside the
// controller's own explanatory comment, so the lock failed against correct
// code. A lock that reads comments is not reading the program.
function stripBlockComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}
function stripJsComments(src) {
  return stripBlockComments(src).replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const controller = stripJsComments(handoffControllerSource());
const css = stripBlockComments(cssSrc);

test('every className the card renders has a CSS rule behind it (derived, not enumerated)', () => {
  // className assignments: `x.className = 'a b c'` and classList.toggle('x').
  const classes = new Set();
  for (const m of controller.matchAll(/\.className\s*=\s*'([^']+)'/g)) {
    for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
  }
  for (const m of controller.matchAll(/classList\.(?:add|toggle)\('([^']+)'/g)) {
    classes.add(m[1]);
  }

  assert.ok(classes.size >= 12, `expected the card's real class roster, derived ${classes.size}`);

  const missing = [];
  for (const cls of classes) {
    // A rule exists if the class appears as a selector token anywhere - as its
    // own rule, or as part of a compound/descendant selector.
    const re = new RegExp(`\\.${cls.replace(/[-]/g, '\\-')}(?![\\w-])`);
    if (!re.test(css)) missing.push(cls);
  }
  assert.deepStrictEqual(missing, [],
    `these classNames render with NO CSS rule binding them - a DEFECT, not a stub: ${missing.join(', ')}`);
});

test('the card element id has a rule, and a hidden rule that actually hides it', () => {
  assert.ok(/#handoff-card\s*\{/.test(css), '#handoff-card must have its own rule');
  assert.ok(/#handoff-card\[hidden\]\s*\{\s*display:\s*none/.test(css),
    '[hidden] must be backed by display:none - the card sets .hidden and a flex container ignores the attribute otherwise');
});

test('the card mounts on <body>, never inside #view-root (the v1.38 SPA class)', () => {
  assert.ok(/document\.body\.appendChild\(card\)/.test(controller),
    'the card must append to body so in-app navigation cannot tear it down');
  assert.ok(!/view-root/.test(controller), 'the controller must never reach into #view-root');
});

test('the card owns exactly ONE interval, and stops it when the tab hides (the v1.45 leak class)', () => {
  const setIntervals = controller.match(/setInterval\(/g) || [];
  assert.equal(setIntervals.length, 1, 'exactly one setInterval in the controller');
  assert.ok(/if \(timer !== null\) return;/.test(controller), 'startTimer must be idempotent');
  assert.ok(/if \(booted\) return;/.test(controller), 'init must be idempotent - a second boot cannot double the timer');
  assert.ok(/visibilitychange/.test(controller) && /clearInterval/.test(controller),
    'polling must stop on a hidden tab');
});

test('the two client-supplied fields are written as textContent, never innerHTML', () => {
  // The device label is client-supplied. It is capped and sanitized
  // server-side, but it must never be treated as markup here.
  assert.ok(/\.headline\.textContent = formatHandoffHeadline/.test(controller));
  assert.ok(/\.title\.textContent = presence\.title/.test(controller));
  assert.ok(!/innerHTML/.test(controller), 'the handoff controller must never use innerHTML');
});

test('no literal emoji/pictographic characters in the card source (glyphs come from CSS)', () => {
  // The v1.38 rule: chrome glyphs live in CSS, never as codepoints in markup.
  // FE0F (the emoji variation selector) is a COMBINING mark, so it lives as
  // its own alternation rather than inside the class - eslint's
  // no-misleading-character-class rightly refuses a combining char in a range
  // set, and it refused this very commit until I split it out.
  const pictographic = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\uFE0F/u;
  assert.ok(!pictographic.test(controller),
    'the controller must not carry literal emoji - the state/play glyphs are CSS shapes');
});

test('AC4: every token the card consumes resolves in ALL FOUR era skins', () => {
  // Mine the card's own CSS block for the tokens it reads.
  // Search for the terminator AFTER the card's start - `.toast {` also occurs
  // earlier in the file, and slicing to the first hit produced a backwards
  // (empty) range that made this assertion vacuous.
  const cardStart = css.indexOf('#handoff-card {');
  assert.ok(cardStart > -1, 'the card CSS block must be findable');
  const cardCss = css.slice(cardStart, css.indexOf('.toast {', cardStart));
  assert.ok(cardCss.length > 500, `the card CSS block must be non-trivial, got ${cardCss.length} chars`);

  const consumed = new Set();
  for (const m of cardCss.matchAll(/var\((--[a-z0-9-]+)/g)) consumed.add(m[1]);
  assert.ok(consumed.size >= 10, `expected the card's real token roster, derived ${consumed.size}`);

  // A token resolves for an era if that era's block defines it, or :root does
  // (:root is the base every era inherits and selectively overrides).
  //
  // There are THREE separate :root blocks in style.css, not one - reading only
  // the first reported 12 perfectly good tokens as missing from all four eras.
  // Union them all.
  const rootDefined = new Set();
  for (const m of css.matchAll(/:root\s*\{/g)) {
    const block = css.slice(m.index, css.indexOf('}', m.index));
    for (const t of block.matchAll(/(--[a-z0-9-]+)\s*:/g)) rootDefined.add(t[1]);
  }
  assert.ok(rootDefined.size > 40, `the :root token layer must be found in full, got ${rootDefined.size}`);

  const eras = ['2005', '2009', '2014', '2021'];
  const failures = [];
  for (const era of eras) {
    const start = css.indexOf(`[data-theme="${era}"] {`);
    assert.ok(start > -1, `era ${era} block must exist`);
    const block = css.slice(start, css.indexOf('\n}', start));
    const eraDefined = new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    for (const tok of consumed) {
      if (!eraDefined.has(tok) && !rootDefined.has(tok)) failures.push(`${era}: ${tok}`);
    }
  }
  assert.deepStrictEqual(failures, [],
    `these tokens do not resolve in every era - the card would render unstyled there: ${failures.join(', ')}`);
});

test('the card carries no [data-theme]-scoped rules of its own (residual #103 posture)', () => {
  const scoped = css.match(/\[data-theme="\d{4}"\][^{]*\.handoff[^{]*\{/g) || [];
  assert.deepStrictEqual(scoped, [],
    'the card must follow the eras through base tokens, not through per-era consumer rules the census cannot see');
});
