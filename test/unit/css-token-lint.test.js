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
  assert.equal(lint('.x { z-index: 2100; }')[0].cat, 'z-index',
    'raw rungs still count');
  // The JS surface shares the idiom check:
  assert.equal(lintj("el.style.zIndex = 'calc(var(--z-top) + 1)';").length, 0);
  assert.equal(lintj("el.style.zIndex = '2100';")[0].cat, 'z-index');
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

test('report-only contract: the CLI always exits 0 (locked by source, asserted by run)', () => {
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
