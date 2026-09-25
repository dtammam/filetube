'use strict';

// [UNIT] The pocket skins' LCD status bar stays ONE line (Dean 2026-09-24: "the song or album
// name might get too long and make that whole thing just a little bit too big. It'll expand
// it by a row."). The bar (div.ip-status: the title span.ip-np, then span.ip-status-rt holding
// the play mark + battery) is drawn by music-skins.js ipScreen for every Click colorway,
// and the same panel renders in the desktop pop-out and the Nano tray. Its title is the menu's
// name, which on a drilled level is the artist / album / chaptered file's own name.
//
// jsdom has no layout, so the HEIGHT is measured in headless Chromium by
// scripts/skin-status-bar-probe.js (numbers in the plan:
// docs/exec-plans/completed/2026-09-24-snap-offset-status-bar.md - 31.2 px with a 120-character
// album before AND after, where the old CSS grew it to 67.6 / 85.8 px). This file binds the CSS
// that produces it (the crown-jewel CSS-lock class; gate r1 and r2, adversary W1):
//   - a real parser: comments stripped once, strings skipped, at-rule blocks (@media, @supports,
//     @container, @layer) read through, @keyframes / @font-face skipped, and native CSS NESTING
//     flattened (`&` replaced by the parent, or a descendant of it);
//   - property names lower-cased and their vendor prefix (-webkit- / -moz- / -ms- / -o-) stripped;
//   - the base rules locked (the bar a one-row flex line; the title nowrap / min-width 0 /
//     overflow hidden / ellipsis / shrinkable; the right cluster flex:none);
//   - a TARGET-based census (Architect ruling, gate r2): a rule counts when its FINAL compound
//     can match the element - it names the element's class, or it is only a type / `*` /
//     attribute / pseudo-class the element could carry - WHATEVER its ancestors (an id like
//     #view-root, a nesting parent, anything). A final compound naming another class, id or
//     type cannot match and does not count;
//   - `writing-mode` and `direction` may not be set by ANY rule in style.css (none does today):
//     they are inherited, so a rule on the bar OR any ancestor (the LCD, the panel, #view-root,
//     body) would turn the one-line bar into a column. A future need adds a reviewed exception here.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const cssText = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

const normProp = (p) => p.trim().toLowerCase().replace(/^-(webkit|moz|ms|o)-/, '');
const normVal = (v) => v.trim().toLowerCase().replace(/\s*!important$/, '').replace(/\s+/g, ' ');

// Split at top-level commas (not inside parentheses or brackets).
function splitTop(s, sep) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && ch === sep) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

// Every style rule as { selectors, decls } with nesting flattened. Throws on anything it cannot
// read (an unbalanced block), so a parse failure fails the test instead of hiding a rule.
function rules(input) {
  const src = input.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  const out = [];
  const SKIP_AT = /^@(keyframes|-webkit-keyframes|font-face|page|property|counter-style|font-feature-values|font-palette-values)\b/i;
  // Read up to the next top-level `{`, `;` or `}` (strings and parentheses skipped).
  function readPrelude() {
    let s = '';
    let depth = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '"' || ch === "'") {
        const j = src.indexOf(ch, i + 1);
        if (j < 0) throw new Error('unterminated string at ' + i);
        s += src.slice(i, j + 1); i = j + 1; continue;
      }
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (depth === 0 && (ch === '{' || ch === ';' || ch === '}')) return { text: s, stop: ch };
      s += ch; i += 1;
    }
    return { text: s, stop: '' };
  }
  function skipBlock() {
    let depth = 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '"' || ch === "'") { const j = src.indexOf(ch, i + 1); i = j < 0 ? src.length : j + 1; continue; }
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      i += 1;
    }
    if (depth !== 0) throw new Error('unbalanced block');
  }
  function flatten(sel, parents) {
    if (!parents) return [sel];
    return parents.map((p) => (sel.includes('&') ? sel.replace(/&/g, p) : p + ' ' + sel));
  }
  // Parse a block's body. `parents` = the enclosing style rule's selectors (null at top level or
  // directly inside an at-rule at top level); `rule` = the rule collecting declarations.
  function block(parents, rule, depth) {
    for (;;) {
      const p = readPrelude();
      const text = p.text.trim();
      if (p.stop === '') {
        if (depth > 0) throw new Error('unbalanced block (missing })');
        if (text) throw new Error('trailing text: ' + text.slice(0, 40));
        return;
      }
      if (p.stop === '}') {
        if (depth === 0) throw new Error('unbalanced block (extra })');
        if (text && rule) addDecl(rule, text);
        i += 1; return;
      }
      if (p.stop === ';') {
        i += 1;
        if (text && rule && !text.startsWith('@')) addDecl(rule, text);
        continue;
      }
      // '{'
      i += 1;
      if (text.startsWith('@')) {
        if (SKIP_AT.test(text)) { skipBlock(); continue; }
        block(parents, rule, depth + 1); // @media / @supports / @container / @layer: transparent
        continue;
      }
      const selectors = [];
      for (const s of splitTop(text, ',')) selectors.push(...flatten(s.replace(/\s+/g, ' '), parents));
      const r = { selectors, decls: {} };
      out.push(r);
      block(selectors, r, depth + 1);
    }
  }
  function addDecl(rule, d) {
    const k = d.indexOf(':');
    if (k < 0) return;
    rule.decls[normProp(d.slice(0, k))] = normVal(d.slice(k + 1));
  }
  block(null, null, 0);
  return out;
}
const ALL = rules(cssText);

// The three elements, as the renderer writes them.
const TITLE = { tag: 'span', cls: 'ip-np' };
const BAR = { tag: 'div', cls: 'ip-status' };
const CLUSTER = { tag: 'span', cls: 'ip-status-rt' };

// The compounds of a selector (descendant / child / sibling combinators; parentheses respected).
function compounds(sel) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && /[\s>+~]/.test(ch)) { if (cur) out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
// Could this compound match an element with this tag and this ONE class (and no id)?
function compoundMatches(comp, el) {
  if (/#/.test(comp)) return false; // none of the three carries an id
  if (/::/.test(comp)) return false; // a pseudo-ELEMENT styles another box
  const fn = /:(?:is|where|matches)\(([^)]*)\)/i.exec(comp);
  if (fn) {
    const rest = comp.replace(fn[0], '');
    const alts = splitTop(fn[1], ',').map((a) => { const cs = compounds(a); return cs[cs.length - 1] || '*'; });
    return compoundMatches(rest || '*', el) && alts.some((a) => compoundMatches(a, el));
  }
  const noPseudo = comp.replace(/:[\w-]+(\([^)]*\))?/g, '');
  // The renderer gives the three elements ONE attribute, `class` (bound by the structure test
  // below): an attribute selector on anything else ([hidden], [data-x]) cannot match them.
  const attrs = (noPseudo.match(/\[\s*([\w-]+)/g) || []).map((a) => a.replace(/^\[\s*/, '').toLowerCase());
  if (attrs.some((a) => a !== 'class')) return false;
  const bare = noPseudo.replace(/\[[^\]]*\]/g, '');
  const tag = (/^[a-z*][\w-]*|^\*/i.exec(bare) || [''])[0].toLowerCase();
  if (tag && tag !== '*' && tag !== el.tag) return false;
  const classes = (bare.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
  return classes.every((c) => c === el.cls);
}
// TARGET-based (Architect ruling, gate r2): the final compound decides; ancestors never excuse.
function reaches(sel, el) {
  const cs = compounds(sel);
  return cs.length > 0 && compoundMatches(cs[cs.length - 1], el);
}
const rulesReaching = (el) => ALL.filter((r) => r.selectors.some((s) => reaches(s, el)));
const exactly = (selector) => ALL.filter((r) => r.selectors.includes(selector));

test('the status title is the flex child that gives: nowrap, min-width 0, overflow hidden, ellipsis, shrinkable', () => {
  const base = exactly('.mms-ipod .ip-np');
  assert.strictEqual(base.length, 1, 'one base rule for the status title');
  const d = base[0].decls;
  assert.strictEqual(d['white-space'], 'nowrap', 'never wraps onto a second line');
  assert.strictEqual(d['min-width'], '0', 'may shrink below its text (a flex item\'s default min-width is its content)');
  assert.strictEqual(d.overflow, 'hidden');
  assert.strictEqual(d['text-overflow'], 'ellipsis', 'truncates the way a real iPod Classic status title does');
  assert.ok(d.flex, 'declares its flex');
  const parts = d.flex.split(/\s+/);
  assert.ok(parts.length === 3 && Number(parts[1]) > 0, 'flex-shrink must stay above 0: ' + d.flex);
});

test('the bar itself is a one-row flex line and the play mark + battery cluster never shrinks', () => {
  const bar = exactly('.mms-ipod .ip-status');
  assert.strictEqual(bar.length, 1, 'one base rule for the bar');
  assert.strictEqual(bar[0].decls.display, 'flex', 'the bar is a flex row (a block or grid bar stacks its children)');
  assert.ok(!('flex-direction' in bar[0].decls) || bar[0].decls['flex-direction'] === 'row');
  assert.ok(!('flex-wrap' in bar[0].decls) || bar[0].decls['flex-wrap'] === 'nowrap');
  const rt = exactly('.mms-ipod .ip-status-rt');
  assert.strictEqual(rt.length, 1);
  assert.strictEqual(rt[0].decls.flex, 'none', 'the right cluster keeps its size and place');
});

// The census: property -> allowed values (null = may not be declared by any other rule).
const TITLE_RULES = {
  all: null, 'white-space': ['nowrap'], 'white-space-collapse': null, 'text-wrap': null, 'text-wrap-mode': null, 'min-width': ['0'], overflow: ['hidden'], 'overflow-x': ['hidden'],
  'text-overflow': ['ellipsis'], flex: null, 'flex-shrink': null, 'flex-grow': null, 'flex-basis': null, display: null, 'line-clamp': null,
  'box-orient': null, 'word-break': null, 'overflow-wrap': null, 'word-wrap': null, width: null, 'max-width': null, position: null, float: null,
  'writing-mode': null, direction: null,
};
const BAR_RULES = {
  all: null, display: ['flex'], 'flex-direction': ['row'], 'flex-wrap': ['nowrap'], 'flex-flow': ['row', 'nowrap', 'row nowrap'],
  'white-space': ['nowrap'], 'text-wrap': null, 'text-wrap-mode': null, 'box-orient': null, float: null, 'writing-mode': null, direction: null,
};
const CLUSTER_RULES = {
  all: null, flex: null, 'flex-shrink': null, 'flex-grow': null, 'flex-basis': null, width: null, 'max-width': null, 'min-width': null, display: ['flex'],
  'flex-wrap': ['nowrap'], 'flex-flow': ['row', 'nowrap', 'row nowrap'], 'flex-direction': ['row'], 'white-space': ['nowrap'], 'text-wrap': null, 'text-wrap-mode': null,
  position: null, float: null, 'writing-mode': null, direction: null,
};
// Reviewed exceptions: a bare-type / universal final compound under an ancestor that can never
// contain the pocket panel. Each names that ancestor class; the test below proves the class
// never appears where the panel lives (the music / podcasts pages and every script that builds
// the panel or the pop-out). Anything else that reaches counts.
const EXCEPTIONS = [
  { selector: '.theme-swatch span', ancestor: 'theme-swatch', why: 'the Setup page theme picker swatch (setup.js)' },
  { selector: '.section-actions.search-scoped-toolbar > *', ancestor: 'search-scoped-toolbar', why: 'the Home search toolbar strip (main.js)' },
];
const PANEL_HOSTS = ['public/music.html', 'public/podcasts.html', 'public/js/music.js', 'public/js/podcasts.js', 'public/js/music-skins.js', 'public/js/skin-surface.js', 'public/js/ipod-brick.js'];
function census(el, base, table) {
  // Only the ONE base rule object is exempt: a later rule repeating the base selector is
  // censused like any other (it would win the cascade).
  const baseRule = exactly(base)[0];
  const found = rulesReaching(el).filter((r) => r !== baseRule);
  const bad = [];
  for (const r of found) {
    if (r.selectors.every((s) => !reaches(s, el) || EXCEPTIONS.some((x) => x.selector === s))) continue;
    for (const [p, v] of Object.entries(r.decls)) {
      if (!(p in table)) continue;
      if (table[p] === null || !table[p].includes(v)) bad.push(r.selectors.join(', ') + ' { ' + p + ': ' + v + ' }');
    }
  }
  return { found, bad };
}

test('NO other rule whose final selector can match the TITLE (any ancestor, any skin, the tray, a vendor spelling, nesting) undoes the one-line title', () => {
  const { found, bad } = census(TITLE, '.mms-ipod .ip-np', TITLE_RULES);
  assert.ok(found.some((r) => r.selectors.includes('.theme-swatch span')), 'precondition: a bare-type rule is found (the census is not vacuous)');
  assert.deepStrictEqual(bad, [], 'rules that break the title');
});

test('NO other rule that can match the BAR stacks, wraps or re-lays it out', () => {
  const { found, bad } = census(BAR, '.mms-ipod .ip-status', BAR_RULES);
  assert.ok(found.some((r) => r.selectors.includes('.section-actions.search-scoped-toolbar > *')), 'precondition: a universal rule is found (the census is not vacuous)');
  assert.deepStrictEqual(bad, [], 'rules that break the bar');
});

test('NO other rule that can match the play mark + battery CLUSTER lets it shrink, grow or wrap', () => {
  const { bad } = census(CLUSTER, '.mms-ipod .ip-status-rt', CLUSTER_RULES);
  assert.deepStrictEqual(bad, [], 'rules that break the cluster');
});

test('the census exceptions are real: each is in style.css, and its ancestor class never appears where the pocket panel lives', () => {
  for (const x of EXCEPTIONS) {
    assert.ok(ALL.some((r) => r.selectors.includes(x.selector)), 'still in style.css (else delete the exception): ' + x.selector);
    for (const f of PANEL_HOSTS) {
      const p = path.join(__dirname, '..', '..', f);
      assert.ok(fs.existsSync(p), 'the panel host file exists (the check is not vacuous): ' + f);
      assert.ok(!fs.readFileSync(p, 'utf8').includes(x.ancestor), x.ancestor + ' (' + x.why + ') must never appear in ' + f);
    }
  }
});

test('NO rule in style.css sets writing-mode or direction (inherited: on the bar or ANY ancestor - the LCD, the panel, #view-root, body - it turns the bar into a column)', () => {
  const EXCEPTIONS = []; // a reviewed selector that provably cannot contain the panel, with its reason
  const bad = [];
  for (const r of ALL) {
    for (const p of ['writing-mode', 'direction']) {
      if (!(p in r.decls)) continue;
      const v = r.decls[p];
      if ((p === 'writing-mode' && v === 'horizontal-tb') || (p === 'direction' && v === 'ltr')) continue;
      if (r.selectors.every((s) => EXCEPTIONS.includes(s))) continue;
      bad.push(r.selectors.join(', ') + ' { ' + p + ': ' + v + ' }');
    }
  }
  assert.deepStrictEqual(bad, []);
});

test('the parser: nesting flattens, vendor prefixes and case normalize, strings and skipped at-rules do not confuse it, and the census is target-based', () => {
  const r = rules('@media (x){ .mms-ipod .ip-status > span{ -WebKit-Flex-Shrink:0 !important; } } '
    + '.a::before{ content:"{ }"; } @keyframes k{ 0%{ opacity:0 } } '
    + '.mms-ipod{ color:red; & .ip-np{ white-space:normal; } .x &{ all:revert; } span{ display:block } }');
  assert.strictEqual(r[0].decls['flex-shrink'], '0');
  assert.deepStrictEqual(r.map((x) => x.selectors.join(',')), ['.mms-ipod .ip-status > span', '.a::before', '.mms-ipod', '.mms-ipod .ip-np', '.x .mms-ipod', '.mms-ipod span']);
  assert.strictEqual(r[2].decls.color, 'red');
  assert.strictEqual(r[3].decls['white-space'], 'normal');
  assert.throws(() => rules('.a{ color:red; '), /unbalanced|trailing/, 'an unreadable block fails the test');
  // target-based
  assert.ok(reaches('#view-root .ip-np', TITLE), 'an id ancestor does not excuse it');
  assert.ok(reaches('#view-root span', TITLE), 'a bare span under anything');
  assert.ok(reaches('.foo *', TITLE), 'a universal under anything');
  assert.ok(reaches('.mms-ipod .ip-status > span', TITLE));
  assert.ok(reaches('body.mms-tray .ip-np', TITLE));
  assert.ok(reaches('.mms-ipod :is(span, div)', TITLE));
  assert.ok(!reaches('.mms-ipod .ip-npview', TITLE), 'another class cannot match');
  assert.ok(!reaches('.mms-ipod .ip-status-rt', TITLE), 'nor the cluster');
  assert.ok(!reaches('.mms-ipod .ip-np::after', TITLE), 'a pseudo-element is not the element');
  assert.ok(!reaches('.foo div', TITLE), 'nor another type');
  assert.ok(!reaches('#x', TITLE), 'nor an id');
  assert.ok(!reaches('.ip-np[hidden]', TITLE), 'an attribute the element never carries');
  assert.ok(reaches('.ip-np[class]', TITLE) && reaches('.mms-ipod :not(.x)', TITLE), 'class attributes and :not() fail closed');
  assert.ok(reaches('.mms-ipod .ip-status', BAR));
  assert.ok(!reaches('.mms-ipod .ip-status span', BAR), 'a descendant rule is not the bar');
  assert.ok(reaches('.whatever > div', BAR));
});

test('the rules land on the element every pocket skin renders: .ip-status > .ip-np + .ip-status-rt(play mark, battery)', () => {
  const SK = require('../../public/js/music-skins.js');
  for (const id of SK.SKINS.filter((s) => s.menus === 'click').map((s) => s.id)) {
    const html = SK.renderFull(id, { track: { title: 'x', artist: 'y', album: 'z' } });
    assert.match(html, /<div class="ip-status"><span class="ip-np">Now Playing<\/span><span class="ip-status-rt"><span class="mms-playind"[^>]*>[^<]*<\/span><span class="ip-batt"[^>]*><i><\/i><\/span><\/span><\/div>/, id + ' renders the status bar the lock covers');
  }
  for (const id of SK.SKINS.filter((s) => s.menus === 'click' && s.id !== 'ipod').map((s) => s.id)) assert.strictEqual(SK.skinById(id).base, 'ipod', id + ' carries the shared .mms-ipod CSS');
});
