#!/usr/bin/env node
'use strict';

/*
 * css-token-lint - REPORT-ONLY governed-property linter for the design-token
 * layer (docs/references/design-token-audit-v1.1.md, Phase 1 Step 3).
 *
 * WHY NOT STYLELINT (deviation from the Phase 1 spec, disclosed in the
 * commit): installing stylelint added four NEW high-severity dev-only npm
 * advisories (brace-expansion DoS, GHSA-mh99-v99m-4gvg - no non-breaking fix
 * upstream at install time) plus ~1,300 lockfile lines, for a linter that
 * Phase 1 runs in report-only mode. This script implements the same rule
 * with zero dependencies. RULE_CONFIG below is shaped like a stylelint rule
 * config so a future migration to real stylelint (one `npm i -D stylelint`
 * plus a thin plugin wrapper around checkDecl) is mechanical if preferred.
 *
 * THE RULE - a declaration violates when it carries a raw literal in a
 * governed category. It is EXCLUDED when any of:
 *   - it declares a custom property (--x: ...): that IS the token layer;
 *   - its rule's selector is part of the era/token definition layer
 *     (:root, [data-theme=...], [data-mode=...]);
 *   - it sits inside @keyframes (choreography) or @font-face;
 *   - its line carries a `token-exempt` comment directive
 *     (`/* token-exempt: <reason> * /` - the audit-KEEP convention);
 *   - the value is entirely var()/keywords (transparent, currentColor,
 *     inherit, none, auto, normal, 0, percentages).
 *
 * SCOPE - public/css/style.css and the <style> block in
 * lib/ytdlp/views/subscriptions.html (the two stylesheets the audit
 * harvested), plus - since v5 (Tier 3) - JS-applied style surfaces
 * (el.style.X / cssText / setProperty in public/js and lib/ytdlp/client;
 * player.js positional geometry excluded). Inline style="" HTML attributes
 * remain OUTSIDE this linter (audit harvest tooling only, not per-commit).
 * width/height are deliberately NOT governed: the audit keeps layout
 * geometry literal by design (only three control-size tokens exist).
 *
 * Flagless = report-only, always exits 0; `--verbose` lists every
 * violation with file:line. `--enforce` (THE RATCHET, v1.62.0) first runs
 * a ten-category known-violation self-canary (broken linter -> exit 2,
 * LOUD), then fails on any violation (exit 1) - the census reached zero
 * at v1.61.0 and is held there by pre-commit and CI.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');

// stylelint-shaped for a future mechanical migration.
const RULE_CONFIG = {
  'filetube/no-raw-token-values': [true, {
    severity: 'warning',
    governed: {
      color: /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|(?<![\w-])(white|black|gold)(?![\w-])/,
      'font-weight': /\b(bold|\d{3})\b/,
      'font-size': /\d+px/,
      'line-height': /^\s*[\d.]+(px)?\s*$/,
      'letter-spacing': /-?[\d.]+(px|em)/,
      'z-index': /\d/,
      shadow: /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/,
      motion: /\d+(\.\d+)?m?s\b/,
      'border-radius': /\d+px/,
      spacing: /\d+px/,
    },
  }],
};

const G = RULE_CONFIG['filetube/no-raw-token-values'][1].governed;
// v6 (Tier 4): the z ladder's designed derivation idiom - the :root comment
// in style.css prescribes backdrop/content rungs as calc(var(--z-X) +/- N) -
// is fully tokenized: ONE ladder var, ONE integer offset. Anything else with
// a digit (raw rungs, raw-number calc arms, non-ladder vars, compound
// arithmetic) still counts. The NINE ladder names are pinned (adversarial
// gate S1: an off-contract --z-hack var must not smuggle a rung past the
// metric); a new ladder name joins the contract, token-scale-lock, AND this
// alternation together.
const Z_LADDER_CALC = /^calc\(\s*var\(--z-(nav|chip|dock|header|player-max|sheet|panel|modal|top)\)\s*[+-]\s*\d+\s*\)$/;
// v7 (tranche F.5, Dean's ruling 3): the radius sibling of the z idiom -
// calc(var(--radius*) +/- Npx) consumes a real radius token; the pixel
// offset is relational trim, not a raw radius. Pinned to the three real
// radius token names ("no fake tokens").
const RADIUS_CALC = /^calc\(\s*var\(--radius(?:-lg|-full)?\)\s*[+-]\s*\d+px\s*\)$/;

// ONE value classifier for BOTH surfaces (CSS lintDecl + JS jsDecl) -
// tech-debt #69 closed at its own trigger (this rule change): v6 had to
// patch two copies, and a rule change that misses one silently recreates
// the exact blind-spot class v6 was written against. Every value-shape
// rule lives HERE and only here; the callers keep their surface-specific
// pre-checks (era/def scope, exempt directives, positional exclusions).
function classifyDecl(prop, value, hit) {
  let bare = value;
  // v7: a ZERO env() fallback is browser-API syntax, not a style value -
  // env(safe-area-inset-bottom, 0px) renders byte-identically wherever
  // env() is unsupported. NONZERO env fallbacks still count: they paint,
  // the same class as var() fallbacks per Dean's standing ruling.
  bare = bare.replace(/env\(\s*[\w-]+\s*,\s*0(?:px)?\s*\)/gi, '');
  // var() strips, but FALLBACKS survive the strip: var(--ghost, #cc0000)
  // renders its fallback literal and stays visible. Iterate for nesting.
  for (let n = 0; n < 4; n++) {
    const next = bare
      .replace(/var\(\s*--[\w-]+\s*\)/g, '')
      .replace(/var\(\s*--[\w-]+\s*,\s*([^()]*)\)/g, '$1');
    if (next === bare) break;
    bare = next;
  }
  bare = bare.trim();
  if (bare === '' || /^(transparent|currentColor|inherit|none|auto|normal|unset|initial|0|100%|50%)$/i.test(bare)) return;
  if (prop === 'z-index') { if (!Z_LADDER_CALC.test(value.trim()) && G['z-index'].test(bare)) hit('z-index'); return; }
  if (prop === 'font-weight') { if (G['font-weight'].test(bare)) hit('font-weight'); return; }
  if (prop === 'font-size') { if (G['font-size'].test(bare)) hit('font-size'); return; }
  if (prop === 'line-height') { if (G['line-height'].test(bare)) hit('line-height'); return; }
  if (prop === 'letter-spacing') { if (G['letter-spacing'].test(bare)) hit('letter-spacing'); return; }
  if (prop === 'box-shadow' || prop === 'text-shadow') { if (G.shadow.test(bare)) hit('shadow'); return; }
  if (MOTION_PROP.test(prop)) { if (G.motion.test(bare)) hit('motion'); return; }
  if (RADIUS_PROP.test(prop)) { if (!RADIUS_CALC.test(value.trim()) && G['border-radius'].test(bare)) hit('border-radius'); return; }
  if (SPACING_PROP.test(prop)) { if (G.spacing.test(bare)) hit('spacing'); return; }
  if (G.color.test(bare)) hit('color');
}
const SPACING_PROP = /^(margin(-\w+)?|padding(-\w+)?|gap|row-gap|column-gap|top|right|bottom|left|inset(-\w+)?)$/;
const MOTION_PROP = /^(transition(-\w+)?|animation(-\w+)?)$/;
const RADIUS_PROP = /^border(-\w+)*-radius$/;
const DEF_SELECTOR = /\[data-theme|\[data-mode|(^|,\s*):root/;

function lintCss(text, fname, lineOffset, out) {
  const lines = text.split('\n');
  const selStack = []; // {selector, isAtRule, name}
  let pendingSelector = '';
  let inComment = false;
  // v8 (#68): a declaration whose property and value sit on different
  // physical lines was INVISIBLE to every prior version (six real sites
  // hid there, two of them unexempted until the census-zero gate found
  // them). An unterminated trailing decl now buffers across lines and is
  // evaluated COMPLETE. Precision notes (gate-honed): exempt is
  // line-scoped and OR'd across the CODE lines the decl spans - a
  // token-exempt sitting on the interior line of a comment that itself
  // spans lines is not seen (fails SAFE: the decl counts and the
  // developer moves the annotation); line-scoped exempt also covers
  // same-physical-line siblings, the long-standing semantics. Attribution
  // is the decl's START line; other decls evaluated from a MERGED line
  // after a buffered `}` attribute to the buffer start (diagnostics-only
  // imprecision, disclosed - counts and categories are exact).
  let pendingDecl = null; // {text, line, exempt}
  // ONE decl evaluator at function scope (v8.1, gate fix: the per-line
  // closures made an EOF flush impossible, and v8.0 silently DROPPED an
  // unterminated decl at EOF - a fail-open regression vs v7, since
  // browsers close open constructs at EOF and RENDER the decl).
  const evalDecl = (rawProp, value, declLine, declExempt) => {
    const prop = rawProp.toLowerCase();
    if (prop.startsWith('--')) return; // token definition layer
    if (declExempt) return; // audit-KEEP directive
    const inOpaque = selStack.some((f) => f.at === '@keyframes' || f.at === '@font-face');
    if (inOpaque) return;
    const nearest = [...selStack].reverse().find((f) => !f.at);
    if (nearest && DEF_SELECTOR.test(nearest.selector)) return; // era/def layer
    const hit = (cat) => out.push({ cat, file: fname, line: declLine, prop, value: value.slice(0, 60) });
    classifyDecl(prop, value, hit); // shared classifier (v7, #69)
  };
  const checkDecls = (segment, declLine, declExempt) => {
    for (const m of segment.matchAll(/([\w-]+|--[\w-]+)\s*:\s*([^;{}]+)(;|$)/g)) {
      if (selStack.length === 0) continue; // stray text outside any rule
      evalDecl(m[1], m[2].trim(), declLine, declExempt);
    }
  };
  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1 + lineOffset;
    let raw = lines[idx];
    const exempt = raw.includes('token-exempt');
    // strip comments (multi-line state)
    let s = raw;
    if (inComment) {
      const end = s.indexOf('*/');
      if (end === -1) continue;
      s = s.slice(end + 2);
      inComment = false;
    }
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');
    const open = s.indexOf('/*');
    if (open !== -1) { s = s.slice(0, open); inComment = true; }
    let effLine = lineNo;
    let effExempt = exempt;
    if (pendingDecl) {
      s = pendingDecl.text + ' ' + s;
      effLine = pendingDecl.line;
      effExempt = pendingDecl.exempt || exempt;
      pendingDecl = null;
    }

    // Segment-based scan: split the line at braces, tracking the selector
    // stack, and lint EVERY declaration segment - including declarations on
    // the same line as their rule's braces. (v1 dropped the same-line
    // selector part, silently disabling the at-rule/era exclusions - caught
    // by the font-weight:100 900 false positive. v2 skipped any line
    // containing a brace, silently exempting ONE-LINE RULES entirely -
    // caught by this script's own fixture suite, Tier 2 Step 1.)
    let cursor = 0;
    for (let ci = 0; ci < s.length; ci++) {
      const ch = s[ci];
      if (ch === '{') {
        const sel = (pendingSelector + ' ' + s.slice(cursor, ci)).trim();
        const at = sel.startsWith('@') ? sel.split(/[\s(]/)[0] : null;
        selStack.push({ selector: sel, at });
        pendingSelector = '';
        cursor = ci + 1;
      } else if (ch === '}') {
        checkDecls(s.slice(cursor, ci), effLine, effExempt);
        selStack.pop();
        pendingSelector = '';
        cursor = ci + 1;
      }
    }
    const tail = s.slice(cursor);
    if (selStack.length > 0) {
      // v8 (#68): complete decls in the tail lint now; an unterminated
      // trailing decl (decl-shaped start, no terminating ';') buffers
      // into the next line instead of being evaluated with a PARTIAL
      // value at end-of-line (the pre-v8 behavior that made multi-line
      // values invisible - the value's literal-carrying stops lived on
      // lines the evaluator never saw).
      const lastSemi = tail.lastIndexOf(';');
      const done = lastSemi === -1 ? '' : tail.slice(0, lastSemi + 1);
      const rest = lastSemi === -1 ? tail : tail.slice(lastSemi + 1);
      if (done) checkDecls(done, effLine, effExempt);
      if (/^\s*[\w-]+\s*:/.test(rest) && rest.trim()) {
        // v8.1 (gate S7): a NEW decl starting after a ';' on this physical
        // line begins HERE, not at any earlier buffer's start line.
        pendingDecl = done
          ? { text: rest, line: lineNo, exempt: exempt }
          : { text: rest, line: effLine, exempt: effExempt };
      } else if (rest.trim()) {
        checkDecls(rest, effLine, effExempt); // parity with pre-v8 for non-decl-shaped tails
      }
    }
    else if (tail.trim() && !tail.includes(':')) pendingSelector += ' ' + tail.trim();
    else if (tail.trim() && tail.includes(':') && !/;/.test(tail)) pendingSelector += ' ' + tail.trim();
  }
  if (pendingDecl) {
    // v8.1 (gate W2/W6 - the EOF fail-open): an unterminated decl at EOF
    // still renders (CSS error recovery closes open constructs), and v7
    // counted it. Flush the buffer through the same machinery.
    checkDecls(pendingDecl.text, pendingDecl.line, pendingDecl.exempt);
  }
}

/**
 * Tier 3 Step 0 (Dean-approved ruling 1): JS-applied style surfaces join the
 * metric - el.style.X assignments, setProperty calls, and cssText strings.
 * player.js is scanned for governed COLOR/FONT/etc. but its positional
 * geometry categories (spacing/sizing/z) are excluded per the audit
 * classification ("44 assignments, mostly positional - out of token scope").
 * Same-line `// token-exempt: <reason>` comments are honored in JS.
 */
const JS_POSITIONAL_EXCLUDE = /player\.js$/;
function lintJs(text, fname, out) {
  const positionalExcluded = JS_POSITIONAL_EXCLUDE.test(fname);
  const lines = text.split('\n');
  const kebab = (s) => s.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase());
  const check = (prop, value, lineNo) => {
    const p = prop.toLowerCase();
    if (positionalExcluded && (SPACING_PROP.test(p) || /^((min-|max-)?(width|height))$/.test(p) || p === 'z-index' || /^(top|right|bottom|left|inset)/.test(p))) return;
    jsDecl(p, value, fname, lineNo, out);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\/\/.*token-exempt/.test(line)) continue;
    for (const m of line.matchAll(/\.style\.(\w+)\s*=\s*['"`]([^'"`]*)['"`]/g)) {
      if (m[1] === 'cssText') {
        for (const d of m[2].matchAll(/([\w-]+)\s*:\s*([^;]+)(;|$)/g)) check(d[1], d[2].trim(), i + 1);
      } else check(kebab(m[1]), m[2].trim(), i + 1);
    }
    for (const m of line.matchAll(/setProperty\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]/g)) check(m[1], m[2].trim(), i + 1);
  }
}
function jsDecl(prop, value, fname, lineNo, out) {
  // Surface-specific bits only: the hit shape. (The old copy carried a
  // redundant top/right/bottom/left spacing alternation - SPACING_PROP
  // already matches those four; behavior is identical through the shared
  // classifier.) All value logic: classifyDecl (v7, #69).
  const hit = (cat) => out.push({ cat, file: fname, line: lineNo, prop, value: value.slice(0, 60) });
  classifyDecl(prop, value, hit);
}

module.exports = { lintCss, lintJs, RULE_CONFIG };

if (require.main === module) {
  main();
}
function main() {
const out = [];
lintCss(fs.readFileSync(path.join(REPO, 'public/css/style.css'), 'utf8'), 'public/css/style.css', 0, out);
const subsHtml = fs.readFileSync(path.join(REPO, 'lib/ytdlp/views/subscriptions.html'), 'utf8');
const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(subsHtml);
if (styleMatch) {
  const offset = subsHtml.slice(0, styleMatch.index).split('\n').length - 1;
  lintCss(styleMatch[1], 'lib/ytdlp/views/subscriptions.html', offset, out);
}
// v5: JS-applied styles (Tier 3 Step 0)
const glob = require('node:fs').readdirSync;
for (const dir of ['public/js', 'lib/ytdlp/client']) {
  for (const f of glob(path.join(REPO, dir))) {
    if (!f.endsWith('.js')) continue;
    lintJs(fs.readFileSync(path.join(REPO, dir, f), 'utf8'), dir + '/' + f, out);
  }
}

const enforce = process.argv.includes('--enforce');

if (enforce) {
  // THE RATCHET's vacuity canary (#68, census-zero gate W3): before any
  // "zero violations" verdict may pass a commit, prove the linter still
  // detects ANYTHING. ledger-check's CLEAN went vacuous the day the
  // census hit zero (empty vs empty trivially matches); a broken linter
  // returning nothing must fail LOUD here, never pass quiet.
  // Gate-hardened (ratchet round 1, ADV W1): the canary covers EVERY
  // governed category with exact per-category counts - a single broken
  // regex (motion, shadow, ...) must fail here, not smuggle quietly.
  const canary = [];
  lintCss('.canary { color: #b00b00; z-index: 1234; margin: 13px; font-size: 13px; font-weight: 700; line-height: 1.3; letter-spacing: 0.5px; box-shadow: 0 1px 2px rgba(0,0,0,0.4); transition: opacity 0.2s ease; border-radius: 6px; }', 'canary.css', 0, canary);
  const canaryJs = [];
  lintJs("el.style.cssText = 'font-size:13px; color:#b00b00;';", 'canary.js', canaryJs);
  const expectCats = ['border-radius', 'color', 'font-size', 'font-weight', 'letter-spacing', 'line-height', 'motion', 'shadow', 'spacing', 'z-index'];
  const gotCats = canary.map((v) => v.cat).sort();
  if (gotCats.join(',') !== expectCats.join(',') || canaryJs.length !== 2) {
    console.error(`css-token-lint: SELF-CHECK FAILED - the known-violation canary produced [${gotCats.join(',')}] (expected all ten governed categories) + ${canaryJs.length}/2 JS hits. The linter is broken; a zero from it proves nothing. Fix the linter before trusting any census.`);
    process.exit(2);
  }
}

const byCat = {};
for (const v of out) byCat[v.cat] = (byCat[v.cat] || 0) + 1;
console.log(`css-token-lint (${enforce ? 'ENFORCING - the ratchet' : 'report-only'}) - raw literals in governed properties`);
console.log('  scope v8: style.css + subscriptions.html <style> + JS style surfaces (cssText/.style/setProperty; player.js positional excluded) + multi-line declarations (buffered, whole-decl exempt coverage); exclusions: era/def layer, @keyframes/@font-face, token-exempt, keywords/var, z-ladder + radius calc idioms, zero env() fallbacks');
for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat.padEnd(16)} ${n}`);
}
console.log(`  TOTAL ${out.length}  (the token census; ceiling ZERO since v1.61.0)`);
if (process.argv.includes('--verbose') || (enforce && out.length > 0)) {
  for (const v of out) console.log(`    ${v.file}:${v.line}  ${v.prop}: ${v.value}  [${v.cat}]`);
}
if (enforce && out.length > 0) {
  console.error(`css-token-lint: RATCHET FAILURE - ${out.length} raw literal(s) in governed properties. Adopt a token, use a recognized idiom, or annotate /* token-exempt: <reason> */ and defend the reason in review (docs/CONTRIBUTING.md, the MANDATORY styling section).`);
  process.exit(1);
}
process.exit(0);
}
