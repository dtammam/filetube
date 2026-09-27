'use strict';

// The icon-set axis, for source locks. UI professionalism pass D2.6: `data-icons` is
// outlined | rounded | filled; the fourth set (emoji) is retired, and a stored `emoji`
// resolves to `filled`. A lock that used to pin an emoji-set rule now asks the
// three-set question instead: "what paints this glyph under each set?".
//
// effectiveMask() answers it the way the cascade does for these rules: a
// `[data-icons="S"] .cls` rule (0,2,0) beats a bare `.cls` rule (0,1,0), and within
// one tier the LAST declaration in document order wins. The two spellings are read
// separately (LESSONS 6: one spelling breaks Firefox, the other iOS).

const { ICON_SETS } = require('../../public/js/common.js');
const { readAllCss } = require('./stylesheets');

// Every stylesheet the shells load, in load order, comments stripped (a comment
// quoting a rule must never satisfy or defeat a lock).
const liveCss = () => readAllCss().replace(/\/\*[\s\S]*?\*\//g, '');

// Every innermost rule as { sels: [normalized selector items], body }, in document
// order. An @media/@supports prelude never joins a selector: the match cannot cross
// the at-rule's own `{`.
function rules(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ sels: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body: m[2] });
  }
  return out;
}

function lastDecl(body, re) {
  const all = [...body.matchAll(re)];
  return all.length ? all[all.length - 1][1].trim() : null;
}

function declsFor(css, selector) {
  let std = null;
  let webkit = null;
  for (const r of rules(css)) {
    if (!r.sels.includes(selector)) continue;
    const w = lastDecl(r.body, /-webkit-mask-image\s*:\s*([^;]+)/g);
    const s = lastDecl(r.body, /(?:^|[^-\w])mask-image\s*:\s*([^;]+)/g);
    if (w !== null) webkit = w;
    if (s !== null) std = s;
  }
  return { std, webkit };
}

// { std, webkit }: the mask-image value each spelling resolves to for `.cls` under
// data-icons=`set` (null = nothing declares one).
function effectiveMask(css, set, cls) {
  const bare = declsFor(css, `.${cls}`);
  const scoped = declsFor(css, `[data-icons="${set}"] .${cls}`);
  return { std: scoped.std || bare.std, webkit: scoped.webkit || bare.webkit };
}

// Every rule that gives `.cls` a ::before glyph, in any set or none.
function beforeGlyphRules(css, cls) {
  const re = new RegExp(`\\.${cls}::before$`);
  return rules(css).filter((r) => r.sels.some((s) => re.test(s)) && /content\s*:/.test(r.body));
}

// The set names any `[data-icons="..."]` selector scopes to.
function scopedSetNames(css) {
  return [...new Set([...css.matchAll(/\[data-icons="([^"]*)"\]/g)].map((m) => m[1]))].sort();
}

module.exports = { ICON_SETS, liveCss, rules, effectiveMask, beforeGlyphRules, scopedSetNames };
