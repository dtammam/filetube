#!/usr/bin/env node
'use strict';

/*
 * overlay-containment-lint - the anti-BLEED census (v1.310, Dean).
 *
 * WHY: three shipped device bugs (v1.309.0/.1 + one more) all bled content over
 * a panel header. Each had a different mechanism, but two are enumerable CSS
 * invariants. This is the "net, not spot-fix" for the class - the sibling of
 * css-token-lint's ratchet.
 *
 * THE TWO INVARIANTS (per RULE, not per declaration):
 *
 *   (a) CORNER-CLIP: a rule that declares a NON-ZERO `border-radius` AND any
 *       `overflow`/`overflow-x`/`overflow-y: auto|scroll` is the iOS
 *       rounded-corner-clip-escape shape (Safari stops clipping the rounded
 *       corners during scroll, so a compositing-layer descendant bleeds past
 *       them). A rounded overlay must SPLIT roles: the rounded element clips
 *       with `overflow:hidden`; scrolling lives on a child WITHOUT a radius.
 *       A rule is EXEMPT when it carries a `corner-clip-safe: <reason>` comment
 *       (the token-exempt convention) - for surfaces proven to have no
 *       compositing-layer descendant that could reach a corner.
 *
 *   (b) STICKY-Z: a `position: sticky` rule must declare a `z-index`. A sticky
 *       header at z-index:auto is painted UNDER later positioned rows that
 *       scroll beneath it (the v1.309.0 bug).
 *
 * SCOPE: public/css/style.css. Report-only by default (exit 0); `--enforce`
 * fails on any violation (exit 1). Enforced in CI via test/unit/
 * overlay-containment.test.js, which also carries the anti-vacuity fixtures.
 */

const fs = require('node:fs');
const path = require('node:path');

const RADIUS_DECL = /border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/gi;
// Matches auto/scroll ANYWHERE in the overflow value, so the two-value form
// (`overflow: hidden auto`, which scrolls on one axis) is caught too - not just
// the single-keyword `overflow: auto`.
const OVERFLOW_SCROLL = /overflow(?:-[xy])?\s*:\s*[^;{}]*\b(?:auto|scroll)\b/i;
const STICKY = /position\s*:\s*(?:-webkit-)?sticky/i;
const ZINDEX = /(?:^|[;{\s])z-index\s*:/i;
const EXEMPT_MARKER = '--corner-clip-safe';

// A border-radius value counts as ZERO only when every component is 0 (any
// unit) or the value is `none`. A var()/percentage/px value is NON-ZERO -
// i.e. the rounded, risky form.
function radiusIsNonZero(value) {
  const v = value.trim().toLowerCase();
  if (v === 'none' || v === '' || v === 'inherit' || v === 'initial' || v === 'unset') return false;
  if (/^(?:0(?:px|em|rem|%)?\s*)+$/.test(v)) return false;
  return true;
}

// Replace CSS comments so the brace scanner can never trip over a brace inside
// a comment, AND so a `corner-clip-safe` exemption survives as a detectable
// marker declaration inside the rule body it annotated. Newlines are preserved
// so reported line numbers stay honest.
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => {
    const nl = (m.match(/\n/g) || []).join('');
    if (/corner-clip-safe/i.test(m)) return `${EXEMPT_MARKER}:1;${nl}`;
    return nl;
  });
}

// Line number of a character offset in the ORIGINAL text.
function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * Lint overlay-containment invariants over a stylesheet.
 * @param {string} css
 * @returns {Array<{kind:'corner-clip'|'sticky-zindex', selector:string, line:number, detail:string}>}
 */
function lintOverlay(css) {
  const stripped = stripComments(css);
  const violations = [];
  // Innermost rules only: `selector { body-without-braces }`. @media/@supports
  // wrappers (bodies containing braces) are skipped; their inner style rules
  // are matched directly. Flat stylesheet (no native CSS nesting) - verified.
  const RULE = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = RULE.exec(stripped)) !== null) {
    const selector = m[1].replace(/\s+/g, ' ').trim();
    const body = m[2];
    if (selector.startsWith('@')) continue; // an at-rule with an empty/simple body
    const line = lineAt(stripped, m.index);

    // (a) corner-clip
    let radiusNonZero = false;
    let rm;
    RADIUS_DECL.lastIndex = 0;
    while ((rm = RADIUS_DECL.exec(body)) !== null) {
      if (radiusIsNonZero(rm[1])) { radiusNonZero = true; break; }
    }
    if (radiusNonZero && OVERFLOW_SCROLL.test(body) && !body.includes(EXEMPT_MARKER)) {
      violations.push({
        kind: 'corner-clip',
        selector,
        line,
        detail: `${selector} combines a non-zero border-radius with overflow:auto/scroll - the iOS rounded-corner clip-escape shape. Split roles (overflow:hidden on the rounded element, scroll on a non-rounded child) or add a reviewed "corner-clip-safe: <reason>" comment.`,
      });
    }

    // (b) sticky-z
    if (STICKY.test(body) && !ZINDEX.test(body)) {
      violations.push({
        kind: 'sticky-zindex',
        selector,
        line,
        detail: `${selector} is position:sticky but declares no z-index - a sticky element at z-index:auto is painted UNDER later positioned siblings that scroll beneath it.`,
      });
    }
  }
  return violations;
}

module.exports = { lintOverlay, radiusIsNonZero, stripComments };

// ---- CLI -------------------------------------------------------------------
if (require.main === module) {
  const REPO = path.join(__dirname, '..');
  const cssPath = path.join(REPO, 'public', 'css', 'style.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  const violations = lintOverlay(css);
  const enforce = process.argv.includes('--enforce');
  if (violations.length === 0) {
    console.log('overlay-containment: clean (0 violations)');
    process.exit(0);
  }
  console.error(`overlay-containment: ${violations.length} violation(s)`);
  for (const v of violations) {
    console.error(`  [${v.kind}] style.css:${v.line}  ${v.detail}`);
  }
  process.exit(enforce ? 1 : 0);
}
