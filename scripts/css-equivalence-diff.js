#!/usr/bin/env node
'use strict';

/*
 * css-equivalence-diff - certifies that two CSS trees render identically
 * (the zero-delta prover for token adoption passes).
 *
 * Tier 2 Step 0 rebuild (Dean's amendment): the Phase 1 scratchpad verifier
 * had two mutation-proven blind spots - custom-property DEFINITIONS were
 * excluded from comparison, and SELECTOR identity was ignored. This version
 * compares, per era x mode context:
 *   - full selector text (including @media/@supports context), in cascade
 *     order (rule reorders are real deltas);
 *   - declaration property/value pairs, order-normalized by a STABLE sort
 *     on property name (harmless reorders of distinct properties compare
 *     equal; swapping duplicate same-property declarations still differs,
 *     because last-one-wins is rendering-relevant);
 *   - custom-property definitions VIA RESOLUTION: every var() chain is
 *     resolved against that side's own definitions under each context, so
 *     a changed token value surfaces in every consumer, and `bold` vs
 *     var(--fw-bold) compare equal through canonicalization. A definition
 *     that is added but consumed nowhere produces no rendered delta and
 *     none is reported - by design.
 *
 * Verdict: EQUIVALENT only when every context's stream is identical.
 * Anything else prints unified additions/removals per context and exits 1.
 * Additive-only changes are DELIBERATELY reported (a certifier must not
 * guess which additions are intentional; the caller judges the listing).
 *
 * Both blind spots carry mutation tests in
 * test/unit/css-equivalence-diff.test.js (the fixture standard that lifted
 * the Tier 2 ban on the old script).
 */

const fs = require('node:fs');

const FW_KEYWORDS = { bold: '700', normal: '400' };

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Parse CSS into a flat rule list + custom-property definition blocks. */
function parseCss(text) {
  const src = stripComments(text);
  const rules = [];   // {selector, atContext, decls: [[prop, value], ...]}
  const defs = [];    // {selector, props: {name: value}}
  const atStack = [];
  let selPending = '';
  let current = null;
  let i = 0;
  while (i < src.length) {
    const brace = src.slice(i).search(/[{}]/);
    if (brace === -1) break;
    const chunk = src.slice(i, i + brace);
    const ch = src[i + brace];
    if (ch === '{') {
      const sel = (selPending + ' ' + chunk).trim().replace(/\s+/g, ' ');
      selPending = '';
      if (sel.startsWith('@media') || sel.startsWith('@supports')) {
        atStack.push(sel);
        current = null;
      } else if (sel.startsWith('@')) {
        // @keyframes/@font-face/@page etc: opaque blocks - compare textually
        // as a single pseudo-rule so changes inside them still surface.
        // NOT pushed onto atStack: nested inner blocks (keyframe steps) are
        // depth-tracked instead, so the context stack can never be left
        // holding a closed opaque block (the '@font-face ::' label bug the
        // real-tree validation exposed).
        current = { selector: sel, atContext: atStack.join(' '), decls: [], opaque: true, depth: 0 };
        rules.push(current);
      } else if (current && current.opaque) {
        current.depth++;
        current.decls.push(['(block)', sel]);
      } else {
        current = { selector: sel, atContext: atStack.join(' '), decls: [] };
        rules.push(current);
      }
    } else {
      // '}' closes either a rule, an opaque at-block level, or an at-block
      if (chunk.trim() && current) consumeDecls(chunk, current, defs);
      if (current && current.opaque && current.depth > 0) current.depth--;
      else if (current) current = null;
      else if (atStack.length) atStack.pop();
      // a rule close inside an at-block: detect by lookahead - handled by
      // the simple state machine: rule closes set current=null; the NEXT
      // '}' with no pending decls pops the at-block. Decls between rules
      // at at-block level do not occur in valid CSS.
    }
    if (ch === '{') {
      // consume any decls that appear before the next boundary
    } else {
      selPending = '';
    }
    if (current && ch === '{') {
      // decls run until the matching '}' - handled on close
      const end = src.indexOf('}', i + brace + 1);
      const open = src.indexOf('{', i + brace + 1);
      if (end !== -1 && (open === -1 || end < open)) {
        consumeDecls(src.slice(i + brace + 1, end), current, defs);
        i = end; // let the '}' branch close it next iteration
        selPending = '';
        continue;
      }
    }
    i = i + brace + 1;
    if (ch === '{') selPending = '';
    else selPending = '';
  }
  return { rules, defs };
}

function consumeDecls(block, rule, defs) {
  const defProps = {};
  for (const m of block.matchAll(/([\w-]+|--[\w-]+)\s*:\s*([^;]+)(?:;|$)/g)) {
    const prop = m[1].trim();
    const value = m[2].trim().replace(/\s+/g, ' ');
    if (prop.startsWith('--')) defProps[prop] = value;
    else rule.decls.push([prop.toLowerCase(), value]);
  }
  if (Object.keys(defProps).length) {
    defs.push({ selector: rule.selector, props: defProps });
  }
}

/** Enumerate era x mode contexts from the definition blocks found. */
function buildContexts(defs) {
  const eras = new Set();
  for (const d of defs) {
    const m = /\[data-theme="([^"]+)"\]/.exec(d.selector);
    if (m) eras.add(m[1]);
  }
  const contexts = [{ name: 'default', era: null, dark: false }];
  for (const era of eras) {
    contexts.push({ name: `${era}-light`, era, dark: false });
    contexts.push({ name: `${era}-dark`, era, dark: true });
  }
  return contexts;
}

/** Definition map for one context, mirroring attribute-selector specificity:
 *  :root < [data-theme] < [data-mode=dark] < [data-theme][data-mode=dark]. */
function defMapFor(defs, ctx) {
  const map = {};
  const tiers = [[], [], [], []];
  for (const d of defs) {
    const hasTheme = d.selector.includes('[data-theme="' + ctx.era + '"]');
    const hasAnyTheme = /\[data-theme=/.test(d.selector);
    const hasDark = /\[data-mode="dark"\]/.test(d.selector);
    if (/^:root/.test(d.selector) && !hasAnyTheme && !hasDark) tiers[0].push(d);
    else if (hasTheme && !hasDark) tiers[1].push(d);
    else if (hasDark && !hasAnyTheme && ctx.dark) tiers[2].push(d);
    else if (hasTheme && hasDark && ctx.dark) tiers[3].push(d);
  }
  for (const tier of tiers) for (const d of tier) Object.assign(map, d.props);
  return map;
}

function resolveValue(value, map, depth) {
  // Manual scanner, not a regex: var() fallbacks nest (var(--a, var(--b)))
  // and regexes cannot balance the parens - the exact ghost-token pattern
  // this differ must certify.
  if (depth > 8) return value;
  let out = '';
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf('var(', i);
    if (at === -1) { out += value.slice(i); break; }
    out += value.slice(i, at);
    let d = 1;
    let j = at + 4;
    while (j < value.length && d > 0) {
      if (value[j] === '(') d++;
      else if (value[j] === ')') d--;
      j++;
    }
    const inner = value.slice(at + 4, j - 1);
    let comma = -1;
    let d2 = 0;
    for (let k = 0; k < inner.length; k++) {
      if (inner[k] === '(') d2++;
      else if (inner[k] === ')') d2--;
      else if (inner[k] === ',' && d2 === 0) { comma = k; break; }
    }
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? undefined : inner.slice(comma + 1).trim();
    if (Object.prototype.hasOwnProperty.call(map, name)) {
      out += resolveValue(map[name], map, depth + 1);
    } else if (fallback !== undefined) {
      out += resolveValue(fallback, map, depth + 1);
    } else {
      out += `UNRESOLVED(${name})`;
    }
    i = j;
  }
  return out;
}

function canonicalize(prop, value) {
  let v = value;
  if (prop === 'font-weight' && FW_KEYWORDS[v]) v = FW_KEYWORDS[v];
  v = v.replace(/#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])\b(?![0-9a-fA-F])/g,
    (_, a, b, c) => '#' + a + a + b + b + c + c);
  v = v.replace(/#[0-9a-fA-F]{6,8}\b/g, (h) => h.toLowerCase());
  v = v.replace(/\brgba?\(\s*([^)]*)\)/g, (_, inner) => 'rgba(' + inner.replace(/\s*,\s*/g, ', ').trim() + ')');
  return v.trim();
}

/** One comparable line stream per context. */
function streamFor(parsed, ctx) {
  const map = defMapFor(parsed.defs, ctx);
  const out = [];
  for (const rule of parsed.rules) {
    const key = (rule.atContext ? rule.atContext + ' :: ' : '') + rule.selector;
    // stable sort by prop keeps same-prop duplicate ORDER (last-wins-relevant)
    const decls = rule.decls.map((d, i) => [d[0], d[1], i])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[2] - b[2]));
    for (const [prop, value] of decls) {
      out.push(`${key} | ${prop}: ${canonicalize(prop, resolveValue(value, map, 0))}`);
    }
    if (rule.decls.length === 0 && !rule.opaque) out.push(`${key} | (empty)`);
  }
  return out;
}

function lcsDiff(a, b) {
  // simple LCS-based unified additions/removals
  const n = a.length; const m = b.length;
  const max = 4000;
  if (n > max || m > max) {
    // set-based fallback for very large inputs: order-insensitive per line,
    // count-aware. Good enough to LIST deltas; verdict stays exact equality.
    const count = new Map();
    for (const x of a) count.set(x, (count.get(x) || 0) + 1);
    for (const y of b) count.set(y, (count.get(y) || 0) - 1);
    const out = [];
    for (const [line, c] of count) {
      if (c > 0) for (let k = 0; k < c; k++) out.push('- ' + line);
      if (c < 0) for (let k = 0; k < -c; k++) out.push('+ ' + line);
    }
    return out;
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i2 = n - 1; i2 >= 0; i2--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i2][j] = a[i2] === b[j] ? dp[i2 + 1][j + 1] + 1 : Math.max(dp[i2 + 1][j], dp[i2][j + 1]);
    }
  }
  const out = [];
  let i2 = 0; let j = 0;
  while (i2 < n && j < m) {
    if (a[i2] === b[j]) { i2++; j++; }
    else if (dp[i2 + 1][j] >= dp[i2][j + 1]) out.push('- ' + a[i2++]);
    else out.push('+ ' + b[j++]);
  }
  while (i2 < n) out.push('- ' + a[i2++]);
  while (j < m) out.push('+ ' + b[j++]);
  return out;
}

function diffCss(aText, bText) {
  const A = parseCss(aText);
  const B = parseCss(bText);
  const contexts = buildContexts(A.defs.concat(B.defs));
  const report = [];
  let equivalent = true;
  for (const ctx of contexts) {
    const sa = streamFor(A, ctx);
    const sb = streamFor(B, ctx);
    if (sa.join('\n') !== sb.join('\n')) {
      equivalent = false;
      report.push({ context: ctx.name, diff: lcsDiff(sa, sb) });
    }
  }
  return { equivalent, report, contexts: contexts.map((c) => c.name) };
}

module.exports = { parseCss, buildContexts, defMapFor, resolveValue, canonicalize, streamFor, diffCss };

if (require.main === module) {
  const [, , fileA, fileB] = process.argv;
  if (!fileA || !fileB) {
    console.error('usage: css-equivalence-diff.js <a.css> <b.css>');
    process.exit(2);
  }
  const res = diffCss(fs.readFileSync(fileA, 'utf8'), fs.readFileSync(fileB, 'utf8'));
  if (res.equivalent) {
    console.log(`EQUIVALENT across ${res.contexts.length} era/mode contexts`);
    process.exit(0);
  }
  for (const r of res.report) {
    console.log(`== context ${r.context}: ${r.diff.length} delta lines`);
    for (const d of r.diff.slice(0, 80)) console.log('  ' + d);
    if (r.diff.length > 80) console.log(`  ... ${r.diff.length - 80} more`);
  }
  process.exit(1);
}
