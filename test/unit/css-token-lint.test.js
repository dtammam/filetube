'use strict';

// [UNIT] Tier 2 Step 1 - the css-token-lint fixture suite (Dean's ruling 3:
// the primary drift metric "does not get to be the least-tested code in the
// repo"). Locks every exclusion and detection the linter promises, plus a
// regression fixture per parser bug it has already had: v1 single-line
// selectors disabled the at-rule/era exclusions (@font-face '100 900' false
// positive); v2 skipped one-line rules entirely (26 hidden literals,
// baseline corrected 628 -> 661 / after-Tier-1 554 -> 580).

const { test } = require('node:test');
const assert = require('node:assert');
const { lintCss } = require('../../scripts/css-token-lint.js');

function lint(css) {
  const out = [];
  lintCss(css, 'fixture.css', 0, out);
  return out;
}
const cats = (out) => out.map((v) => v.cat).sort();

test('detects one raw literal per governed category', () => {
  const out = lint(`
.x {
  color: #abc123;
  font-weight: bold;
  font-size: 13px;
  line-height: 1.3;
  letter-spacing: 0.5px;
  z-index: 950;
  box-shadow: 0 1px 2px rgba(0,0,0,0.4);
  transition: opacity 0.2s ease;
  border-radius: 6px;
  margin-top: 14px;
}
`);
  assert.deepEqual(cats(out), ['border-radius', 'color', 'font-size', 'font-weight',
    'letter-spacing', 'line-height', 'motion', 'shadow', 'spacing', 'z-index'].sort());
});

test('REGRESSION (v2 hole): one-line rules are linted', () => {
  assert.equal(lint('.x { color: #fff; }').length, 1);
  assert.equal(lint('.a { margin: 4px; } .b { padding: 6px; }').length, 2);
});

test('REGRESSION (v1 hole): same-line at-rule selectors keep their exclusions', () => {
  assert.equal(lint('@font-face { font-family: X; font-weight: 100 900; }').length, 0,
    'the @font-face weight range false positive');
  assert.equal(lint('@keyframes spin { from { margin: 3px; } to { margin: 9px; } }').length, 0,
    'keyframe choreography is never governed');
});

test('era/def layer excluded by SELECTOR scope, not just custom-prop syntax', () => {
  assert.equal(lint(':root { --x: #fff; }').length, 0, 'definitions are the token layer');
  assert.equal(lint('[data-theme="2005"] .btn { color: #000; border: 1px solid #ccc; }').length, 0,
    'era-scoped skin rules are deliberate era art');
  assert.equal(lint('[data-theme="2005"][data-mode="dark"] h2 { color: #fff; }').length, 0);
  assert.equal(lint('.btn { color: #000; }').length, 1, 'the same literal OUTSIDE era scope counts');
});

test('token-exempt directive skips the line; var()/keyword values never count', () => {
  assert.equal(lint('.x { margin-top: -5px; /* token-exempt: positional */ }').length, 0);
  assert.equal(lint('.x { margin: var(--space-4); color: var(--yt-red); }').length, 0);
  assert.equal(lint('.x { background: transparent; color: currentColor; width: auto; margin: 0; }').length, 0);
});

test('a var() fallback carrying a literal DOES count (the ghost-token pattern stays visible)', () => {
  // var(--accent, #cc0000): the fallback IS the live value at 9 real sites
  // (Tier 4 residue per Dean's ruling) - the burn-down must keep seeing it.
  const out = lint('.x { background: var(--accent, #cc0000); }');
  assert.equal(out.length, 1);
  assert.equal(out[0].cat, 'color');
});

test('v6: z-ladder-relative calc is tokenized; every impostor shape still counts', () => {
  // The :root comment prescribes backdrop/content rungs as
  // calc(var(--z-X) +/- N) - the offset is relational, not a raw rung.
  assert.equal(lint('.x { z-index: calc(var(--z-top) + 1); }').length, 0,
    'the designed derivation idiom is fully tokenized');
  assert.equal(lint('.x { z-index: calc(var(--z-modal) - 100); }').length, 0,
    'offset rungs, either sign');
  // Impostors - each one is a mutation control on the v6 regex:
  assert.equal(lint('.x { z-index: calc(2000 + var(--z-x)); }')[0].cat, 'z-index',
    'raw-number-leading calc is not the idiom');
  assert.equal(lint('.x { z-index: calc(var(--z-top) + 1 + 1); }')[0].cat, 'z-index',
    'compound arithmetic is not the idiom');
  assert.equal(lint('.x { z-index: calc(var(--dur-fast) + 1); }')[0].cat, 'z-index',
    'a non-ladder var is not the idiom');
  assert.equal(lint('.x { z-index: calc(var(--z-hack) + 1); }')[0].cat, 'z-index',
    'an off-contract --z-* name is not the idiom (the nine ladder names are pinned)');
  assert.equal(lint('.x { z-index: calc(var(--z-top) + 1) 5; }')[0].cat, 'z-index',
    'trailing content breaks the idiom (kills the $-anchor mutant)');
  assert.equal(lint('.x { z-index: 0 calc(var(--z-top) + 1); }')[0].cat, 'z-index',
    'leading content breaks the idiom (kills the ^-anchor mutant)');
  assert.equal(lint('.x { z-index: 2100; }')[0].cat, 'z-index',
    'raw rungs still count');
  // The JS surface shares the idiom check:
  assert.equal(lintj("el.style.zIndex = 'calc(var(--z-top) + 1)';").length, 0);
  assert.equal(lintj("el.style.zIndex = '2100';")[0].cat, 'z-index');
});

test('v7: radius-calc idiom is tokenized; impostors count; both surfaces share one classifier', () => {
  assert.equal(lint('.x { border-radius: calc(var(--radius) + 1px); }').length, 0,
    'the +Npx trim on a real radius token is tokenized');
  assert.equal(lint('.x { border-radius: calc(var(--radius-lg) - 2px); }').length, 0,
    'either sign, either real token');
  assert.equal(lint('.x { border-radius: calc(4px + 1px); }')[0].cat, 'border-radius',
    'raw-number calc is not the idiom');
  assert.equal(lint('.x { border-radius: calc(var(--radius-hack) + 1px); }')[0].cat, 'border-radius',
    'a fake radius token is not the idiom (names pinned per "no fake tokens")');
  assert.equal(lint('.x { border-radius: calc(var(--radius) + 3px + 1px); }')[0].cat, 'border-radius',
    'compound arithmetic is not the idiom');
  // NOTE deliberately absent: calc(var(--radius) * 2) carries no px unit, so
  // the /\d+px/ radius pattern has NEVER counted it (pre-existing metric
  // scope, unchanged by v7 - recorded here so nobody reads its absence as
  // an idiom allowance).
  assert.equal(lint('.x { border-radius: calc(var(--radius) + 1px) 3px; }')[0].cat, 'border-radius',
    'trailing content breaks the idiom (anchor control)');
  assert.equal(lint('.x { border-radius: 6px calc(var(--radius) + 1px); }')[0].cat, 'border-radius',
    'leading content breaks the idiom (kills the ^-anchor mutant the adversarial gate found surviving)');
  assert.equal(lint('.x { border-radius: 4px; }')[0].cat, 'border-radius',
    'raw radii still count');
  // JS surface goes through the SAME classifier - one rule change covers both:
  assert.equal(lintj("el.style.borderRadius = 'calc(var(--radius) + 1px)';").length, 0);
  assert.equal(lintj("el.style.borderRadius = 'calc(var(--radius-hack) + 1px)';")[0].cat, 'border-radius');
});

test('v7: ZERO env() fallbacks are API syntax, not literals; nonzero env fallbacks still count', () => {
  assert.equal(lint('.x { padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px)); }').length, 0,
    'the safe-area pattern with a zero fallback is fully tokenized');
  assert.equal(lint('.x { bottom: calc(24px + env(safe-area-inset-bottom, 0px)); }')[0].cat, 'spacing',
    'the zero env strip must not hide OTHER literals in the same value');
  assert.equal(lint('.x { padding-bottom: env(safe-area-inset-bottom, 0); }').length, 0,
    'unitless zero fallback too');
  assert.equal(lint('.x { padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 16px)); }')[0].cat, 'spacing',
    'a NONZERO env fallback paints where env() is unsupported - it counts, same class as var fallbacks');
  assert.equal(lint('.x { padding-bottom: env(safe-area-inset-bottom, 8px); }')[0].cat, 'spacing',
    'a SINGLE-DIGIT nonzero env fallback counts (kills the 0->digit matcher mutant the adversarial gate found surviving)');
  assert.equal(lintj("el.style.top = '10px';")[0].cat, 'spacing',
    'bare positional prop on the JS surface - the old jsDecl alternation, preserved through the unified classifier (QA parity fixture)');
  assert.equal(lintj("el.style.paddingBottom = 'calc(var(--space-2) + env(safe-area-inset-bottom, 0px))';").length, 0,
    'JS surface, same classifier');
});

test('v8 (#68): multi-line declarations are SEEN; exempt anywhere covers the WHOLE decl', () => {
  const out1 = lint('.x {\n  background-image: linear-gradient(\n    90deg,\n    rgba(0, 0, 0, 0.5),\n    transparent\n  );\n}');
  assert.equal(out1.length, 1, 'the continuation-line rgba is visible now (pre-v8: zero in every category - the blind spot that hid six real sites)');
  assert.equal(out1[0].cat, 'color');
  assert.equal(out1[0].line, 2, 'attributed to the declaration START line');
  assert.equal(lint('.x {\n  background-image: linear-gradient(\n    rgba(0, 0, 0, 0.5), /* token-exempt: art */\n    transparent\n  );\n}').length, 0,
    'exempt on a continuation line silences the whole decl');
  // The census-zero gate's specified ratchet fixture: exempt MID-value with
  // a BARE literal stop LATER in the same buffered decl (the dl-chip shape):
  assert.equal(lint('.x {\n  background-image: repeating-linear-gradient(\n    rgba(255, 255, 255, 0.25) 0, /* token-exempt: stripes */\n    rgba(255, 255, 255, 0.25) 4px,\n    transparent 8px\n  );\n}').length, 0,
    'whole-decl exempt coverage: a bare literal stop after the exempt comment is still covered');
  assert.equal(lint('[data-theme="2009"] .x {\n  background-image: linear-gradient(\n    rgba(0,0,0,0.5)\n  );\n}').length, 0,
    'era scope excludes multi-line decls too');
  assert.equal(lint('.x {\n  color: #abc123\n}').length, 1,
    'a no-semicolon decl terminated by a next-line brace is still detected');
  assert.equal(lint('.a { margin: 4px; } .b { padding: 6px; }').length, 2,
    'single-line behavior unchanged (v2-hole regression control)');
});

test('v8: the ratchet CLI (--enforce) runs the self-canary and passes on the zero census', () => {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const res = execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'css-token-lint.js'), '--enforce'], { encoding: 'utf8' });
  assert.match(res, /ENFORCING - the ratchet/);
  assert.match(res, /TOTAL 0/);
  // The failure paths (canary-broken exit 2, raw-literal exit 1) cannot be
  // driven from here without mutating the real tree - they are bound by
  // the wave's recorded post-commit mutation runs, per the gate.
});

test('multi-line rules and selectors spanning lines resolve their scope correctly', () => {
  const out = lint(`
[data-theme="2009"]
.btn:hover {
  background: #c4c4c4;
}
.plain,
.other {
  color: #123456;
}
`);
  assert.equal(out.length, 1, 'the era-scoped multi-line selector is excluded; the plain one counts');
  assert.equal(out[0].value, '#123456');
});

test('@media wrapping does not confuse scope; decls inside media rules count', () => {
  const out = lint('@media (max-width: 768px) { .x { margin: 5px; } [data-theme="2005"] .y { margin: 5px; } }');
  assert.equal(out.length, 1, 'plain rule counts, era-scoped rule excluded, inside the same media block');
});

test('width/height are ungoverned by design (layout geometry stays literal)', () => {
  assert.equal(lint('.x { width: 240px; height: 44px; max-width: 85vh; }').length, 0);
});

test('report-only contract: the flagless CLI always exits 0 (--enforce is the ratchet, the deliberate exception since v1.62.0)', () => {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const res = execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'css-token-lint.js')], { encoding: 'utf8' });
  assert.match(res, /TOTAL \d+/);
  // execFileSync throws on nonzero exit - reaching here IS the assertion.
});

// ---- Tier 3 Step 0: the JS-surface scanners (v5) ---------------------------
const { lintJs } = require('../../scripts/css-token-lint.js');
function lintj(js, fname) {
  const out = [];
  lintJs(js, fname || 'fixture.js', out);
  return out;
}

test('v5: cssText strings are scanned per-declaration (the class that hid five stats.js sizes and two weights)', () => {
  const out = lintj("el.style.cssText = 'color:var(--x); font-size:12px; font-weight:bold; flex-shrink:0;';");
  assert.deepEqual(out.map((v) => v.cat).sort(), ['font-size', 'font-weight']);
});

test('v5: camelCase .style assignments and setProperty are scanned', () => {
  assert.equal(lintj("el.style.fontSize = '13px';")[0].cat, 'font-size');
  assert.equal(lintj("el.style.setProperty('margin-top', '14px');")[0].cat, 'spacing');
});

test('v5: player.js positional geometry is excluded; its governed colors still count', () => {
  const js = "el.style.left = '12px'; el.style.width = '44px'; el.style.color = '#abc123';";
  assert.deepEqual(lintj(js, 'public/js/player.js').map((v) => v.cat), ['color']);
  // width stays ungoverned EVERYWHERE (layout geometry, the audit's design
  // call) - so the non-player file sees left (spacing) + color only.
  assert.equal(lintj(js, 'public/js/watch.js').length, 2, 'the same code in any other file is governed minus width');
});

test('v5: JS token-exempt comments and var()-only values are honored; fallback literals stay visible', () => {
  assert.equal(lintj("el.style.margin = '8px'; // token-exempt: positional").length, 0);
  assert.equal(lintj("el.style.color = 'var(--yt-red)';").length, 0);
  assert.equal(lintj("el.style.color = 'var(--accent, #cc0000)';")[0].cat, 'color');
});
