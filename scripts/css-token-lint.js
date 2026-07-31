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
 * Always exits 0 (report-only). The printed total is the Tier 2+ burn-down
 * metric. `--verbose` lists every violation with file:line.
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
const SPACING_PROP = /^(margin(-\w+)?|padding(-\w+)?|gap|row-gap|column-gap|top|right|bottom|left|inset(-\w+)?)$/;
const MOTION_PROP = /^(transition(-\w+)?|animation(-\w+)?)$/;
const RADIUS_PROP = /^border(-\w+)*-radius$/;
const DEF_SELECTOR = /\[data-theme|\[data-mode|(^|,\s*):root/;

function lintCss(text, fname, lineOffset, out) {
  const lines = text.split('\n');
  const selStack = []; // {selector, isAtRule, name}
  let pendingSelector = '';
  let inComment = false;
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

    // Segment-based scan: split the line at braces, tracking the selector
    // stack, and lint EVERY declaration segment - including declarations on
    // the same line as their rule's braces. (v1 dropped the same-line
    // selector part, silently disabling the at-rule/era exclusions - caught
    // by the font-weight:100 900 false positive. v2 skipped any line
    // containing a brace, silently exempting ONE-LINE RULES entirely -
    // caught by this script's own fixture suite, Tier 2 Step 1.)
    const checkDecls = (segment) => {
      for (const m of segment.matchAll(/([\w-]+|--[\w-]+)\s*:\s*([^;{}]+)(;|$)/g)) {
        if (selStack.length === 0) continue; // stray text outside any rule
        lintDecl(m[1], m[2].trim());
      }
    };
    const lintDecl = (rawProp, value) => {
      const prop = rawProp.toLowerCase();
      if (prop.startsWith('--')) return; // token definition layer
      if (exempt) return; // audit-KEEP directive
      const inOpaque = selStack.some((f) => f.at === '@keyframes' || f.at === '@font-face');
      if (inOpaque) return;
      const nearest = [...selStack].reverse().find((f) => !f.at);
      if (nearest && DEF_SELECTOR.test(nearest.selector)) return; // era/def layer
      // var() strips, but FALLBACKS survive the strip: var(--ghost, #cc0000)
      // renders its fallback literal, and Dean's Tier 4 ruling keeps those
      // 9 ghost-token sites visible in the burn-down. Iterate for nesting.
      let bare = value;
      for (let n = 0; n < 4; n++) {
        const next = bare
          .replace(/var\(\s*--[\w-]+\s*\)/g, '')
          .replace(/var\(\s*--[\w-]+\s*,\s*([^()]*)\)/g, '$1');
        if (next === bare) break;
        bare = next;
      }
      bare = bare.trim();
      if (bare === '' || /^(transparent|currentColor|inherit|none|auto|normal|unset|initial|0|100%|50%)$/i.test(bare)) return;
      const hit = (cat) => out.push({ cat, file: fname, line: lineNo, prop, value: value.slice(0, 60) });
      if (prop === 'z-index') { if (!Z_LADDER_CALC.test(value.trim()) && G['z-index'].test(bare)) hit('z-index'); return; }
      if (prop === 'font-weight') { if (G['font-weight'].test(bare)) hit('font-weight'); return; }
      if (prop === 'font-size') { if (G['font-size'].test(bare)) hit('font-size'); return; }
      if (prop === 'line-height') { if (G['line-height'].test(bare)) hit('line-height'); return; }
      if (prop === 'letter-spacing') { if (G['letter-spacing'].test(bare)) hit('letter-spacing'); return; }
      if (prop === 'box-shadow' || prop === 'text-shadow') { if (G.shadow.test(bare)) hit('shadow'); return; }
      if (MOTION_PROP.test(prop)) { if (G.motion.test(bare)) hit('motion'); return; }
      if (RADIUS_PROP.test(prop)) { if (G['border-radius'].test(bare)) hit('border-radius'); return; }
      if (SPACING_PROP.test(prop)) { if (G.spacing.test(bare)) hit('spacing'); return; }
      if (G.color.test(bare)) hit('color');
    };

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
        checkDecls(s.slice(cursor, ci));
        selStack.pop();
        pendingSelector = '';
        cursor = ci + 1;
      }
    }
    const tail = s.slice(cursor);
    if (selStack.length > 0) checkDecls(tail);
    else if (tail.trim() && !tail.includes(':')) pendingSelector += ' ' + tail.trim();
    else if (tail.trim() && tail.includes(':') && !/;/.test(tail)) pendingSelector += ' ' + tail.trim();
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
  const bareRaw = value;
  let bare = bareRaw;
  for (let n = 0; n < 4; n++) {
    const next = bare.replace(/var\(\s*--[\w-]+\s*\)/g, '').replace(/var\(\s*--[\w-]+\s*,\s*([^()]*)\)/g, '$1');
    if (next === bare) break;
    bare = next;
  }
  bare = bare.trim();
  if (bare === '' || /^(transparent|currentColor|inherit|none|auto|normal|unset|initial|0|100%|50%)$/i.test(bare)) return;
  const hit = (cat) => out.push({ cat, file: fname, line: lineNo, prop, value: value.slice(0, 60) });
  if (prop === 'z-index') { if (!Z_LADDER_CALC.test(value.trim()) && G['z-index'].test(bare)) hit('z-index'); return; }
  if (prop === 'font-weight') { if (G['font-weight'].test(bare)) hit('font-weight'); return; }
  if (prop === 'font-size') { if (G['font-size'].test(bare)) hit('font-size'); return; }
  if (prop === 'line-height') { if (G['line-height'].test(bare)) hit('line-height'); return; }
  if (prop === 'letter-spacing') { if (G['letter-spacing'].test(bare)) hit('letter-spacing'); return; }
  if (prop === 'box-shadow' || prop === 'text-shadow') { if (G.shadow.test(bare)) hit('shadow'); return; }
  if (MOTION_PROP.test(prop)) { if (G.motion.test(bare)) hit('motion'); return; }
  if (RADIUS_PROP.test(prop)) { if (G['border-radius'].test(bare)) hit('border-radius'); return; }
  if (SPACING_PROP.test(prop) || /^(top|right|bottom|left)$/.test(prop)) { if (G.spacing.test(bare)) hit('spacing'); return; }
  if (G.color.test(bare)) hit('color');
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

const byCat = {};
for (const v of out) byCat[v.cat] = (byCat[v.cat] || 0) + 1;
console.log('css-token-lint (report-only) - raw literals in governed properties');
console.log('  scope v6: style.css + subscriptions.html <style> + JS style surfaces (cssText/.style/setProperty; player.js positional excluded); exclusions: era/def layer, @keyframes/@font-face, token-exempt, keywords/var, z-ladder calc');
for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat.padEnd(16)} ${n}`);
}
console.log(`  TOTAL ${out.length}  (the Tier 2+ burn-down metric)`);
if (process.argv.includes('--verbose')) {
  for (const v of out) console.log(`    ${v.file}:${v.line}  ${v.prop}: ${v.value}  [${v.cat}]`);
}
process.exit(0);
}
