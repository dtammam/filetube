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
 * harvested). Inline style="" attributes and JS-applied styles are OUTSIDE
 * this linter (tracked by the audit's harvest tooling, not per-commit).
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

    // brace tracking (line-based; style.css is one-decl-per-line formatted).
    // The selector for a `{` is everything pending from prior lines PLUS the
    // current line's text before the brace (v1 dropped the same-line part,
    // which silently disabled the @font-face/@keyframes and era-scope
    // exclusions - caught by the font-weight:100 900 false positive).
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
        selStack.pop();
        pendingSelector = '';
        cursor = ci + 1;
      }
    }
    const beforeBrace = s.includes('{') ? s.slice(0, s.indexOf('{')) : null;
    if (beforeBrace !== null) { /* selector consumed above */ }
    else if (!s.includes('}') && !s.includes(':')) pendingSelector += ' ' + s.trim();

    // find the declaration on this line (code part only)
    const m = /([\w-]+)\s*:\s*([^;{}]+);/.exec(s);
    if (!m) { if (!s.includes('{')) pendingSelector = s.includes('}') ? '' : pendingSelector; continue; }
    if (s.includes('{')) continue; // selector line, any colon is a pseudo
    const prop = m[1].toLowerCase();
    const value = m[2].trim();

    if (prop.startsWith('--')) continue; // token definition layer
    if (exempt) continue; // audit-KEEP directive
    const inKeyframes = selStack.some((f) => f.at === '@keyframes' || f.at === '@font-face');
    if (inKeyframes) continue;
    const nearest = [...selStack].reverse().find((f) => !f.at);
    if (nearest && DEF_SELECTOR.test(nearest.selector)) continue; // era/def layer
    const bare = value.replace(/var\([^)]*\)/g, '').trim();
    if (bare === '' || /^(transparent|currentColor|inherit|none|auto|normal|unset|initial|0|100%|50%)$/i.test(bare)) continue;

    const hit = (cat) => out.push({ cat, file: fname, line: lineNo, prop, value: value.slice(0, 60) });

    if (prop === 'z-index') { if (G['z-index'].test(bare)) hit('z-index'); continue; }
    if (prop === 'font-weight') { if (G['font-weight'].test(bare)) hit('font-weight'); continue; }
    if (prop === 'font-size') { if (G['font-size'].test(bare)) hit('font-size'); continue; }
    if (prop === 'line-height') { if (G['line-height'].test(bare)) hit('line-height'); continue; }
    if (prop === 'letter-spacing') { if (G['letter-spacing'].test(bare)) hit('letter-spacing'); continue; }
    if (prop === 'box-shadow' || prop === 'text-shadow') { if (G.shadow.test(bare)) hit('shadow'); continue; }
    if (MOTION_PROP.test(prop)) { if (G.motion.test(bare)) hit('motion'); continue; }
    if (RADIUS_PROP.test(prop)) { if (G['border-radius'].test(bare)) hit('border-radius'); continue; }
    if (SPACING_PROP.test(prop)) { if (G.spacing.test(bare)) hit('spacing'); continue; }
    if (G.color.test(bare)) hit('color');
  }
}

const out = [];
lintCss(fs.readFileSync(path.join(REPO, 'public/css/style.css'), 'utf8'), 'public/css/style.css', 0, out);
const subsHtml = fs.readFileSync(path.join(REPO, 'lib/ytdlp/views/subscriptions.html'), 'utf8');
const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(subsHtml);
if (styleMatch) {
  const offset = subsHtml.slice(0, styleMatch.index).split('\n').length - 1;
  lintCss(styleMatch[1], 'lib/ytdlp/views/subscriptions.html', offset, out);
}

const byCat = {};
for (const v of out) byCat[v.cat] = (byCat[v.cat] || 0) + 1;
console.log('css-token-lint (report-only) - raw literals in governed properties');
console.log('  scope: style.css + subscriptions.html <style>; exclusions: era/def layer, @keyframes/@font-face, token-exempt, keywords/var');
for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat.padEnd(16)} ${n}`);
}
console.log(`  TOTAL ${out.length}  (the Tier 2+ burn-down metric)`);
if (process.argv.includes('--verbose')) {
  for (const v of out) console.log(`    ${v.file}:${v.line}  ${v.prop}: ${v.value}  [${v.cat}]`);
}
process.exit(0);
