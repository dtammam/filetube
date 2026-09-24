'use strict';

// [UNIT] The pocket skins' LCD status bar stays ONE line (Dean 2026-09-24: "the song or album
// name might get too long and make that whole thing just a little bit too big. It'll expand
// it by a row."). The bar (div.ip-status: the title span.ip-np, then span.ip-status-rt holding
// the play mark + battery) is drawn by music-skins.js ipScreen for the Click trio AND Seattle,
// and the same panel renders in the desktop pop-out and the Nano tray. Its title is the menu's
// name, which on a drilled level is the artist / album / chaptered file's own name.
//
// jsdom has no layout, so the HEIGHT is measured in headless Chromium by
// scripts/skin-status-bar-probe.js (numbers in the plan:
// docs/exec-plans/active/2026-09-24-snap-offset-status-bar.md - 31.2 px with a 120-character
// album before AND after, where the old CSS grew it to 67.6 / 85.8 px). This file binds the
// CSS that produces it:
//   - comments are stripped ONCE at read (a commented-out copy of a rule never satisfies it);
//   - property names are lower-cased and their vendor prefix (-webkit- / -moz- / -ms- / -o-)
//     stripped before any check, so `-webkit-flex-wrap` is `flex-wrap` and `FLEX-SHRINK` is
//     `flex-shrink` (gate r1, adversary W1: the crown-jewel CSS-lock class);
//   - the base rules are locked: the bar is `display:flex`, a row, never wrapping; the title
//     nowrap / min-width 0 / overflow hidden / ellipsis / shrinkable; the right cluster flex:none;
//   - then EVERY rule that can reach one of the three elements is censused - any selector
//     whose last compound could match it (its class, its tag, `*`, a bare attribute or pseudo)
//     and which names the skin's ancestor chain (or no ancestor at all): a parent, descendant
//     (`.ip-status > span`), universal (`.ip-status *`) or tray rule counts, not just the exact
//     class selectors.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const normProp = (p) => p.trim().toLowerCase().replace(/^-(webkit|moz|ms|o)-/, '');
const normVal = (v) => v.trim().toLowerCase().replace(/\s*!important$/, '').replace(/\s+/g, ' ');

// Every style rule as { selectors, decls } (innermost blocks: a rule inside @media / @supports
// is found too). A property declared twice keeps the LAST value (the cascade inside a rule).
function rules(src) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      decls[normProp(d.slice(0, i))] = normVal(d.slice(i + 1));
    }
    out.push({ selectors, decls });
  }
  return out;
}
const ALL = rules(css);

// The three elements, as the renderer writes them.
const TITLE = { tag: 'span', cls: 'ip-np' };
const BAR = { tag: 'div', cls: 'ip-status' };
const CLUSTER = { tag: 'span', cls: 'ip-status-rt' };
// The ancestor chain those elements live in (the panel, the LCD, the bar, the body classes).
const CHAIN = /(\.ip-status(?![\w-])|\.ip-lcd|\.mms-|music-nowplaying-panel|^body|^html|^:root)/;

// Split a selector into compounds (descendant / child / sibling combinators).
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
// Could this compound match an element with this tag and this ONE class?
function compoundMatches(comp, el) {
  if (/#/.test(comp)) return false; // none of the three carries an id
  if (/::/.test(comp)) return false; // a pseudo-ELEMENT (::before, ::-webkit-scrollbar) styles a box that is not the element
  // :is() / :where() / :matches() match when ONE of their alternatives does (by its last compound).
  const fn = /:(?:is|where|matches)\(([^)]*)\)/i.exec(comp);
  if (fn) {
    const rest = comp.replace(fn[0], '');
    const alts = fn[1].split(',').map((a) => { const cs = compounds(a.trim()); return cs[cs.length - 1] || '*'; });
    return compoundMatches(rest || '*', el) && alts.some((a) => compoundMatches(a, el));
  }
  const bare = comp.replace(/:[\w-]+(\([^)]*\))?/g, '').replace(/\[[^\]]*\]/g, '');
  const tag = (/^[a-z*][\w-]*|^\*/i.exec(bare) || [''])[0].toLowerCase();
  if (tag && tag !== '*' && tag !== el.tag) return false;
  const classes = (bare.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
  return classes.every((c) => c === el.cls);
}
// Does this selector reach the element: its last compound can match, and any ancestor it names
// is on the skin's chain (a selector with no ancestor at all reaches everything).
function reaches(sel, el) {
  const cs = compounds(sel);
  if (!cs.length || !compoundMatches(cs[cs.length - 1], el)) return false;
  const anc = cs.slice(0, -1);
  return anc.length === 0 || anc.some((c) => CHAIN.test(c));
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
  'white-space': ['nowrap'], 'text-wrap': null, 'text-wrap-mode': null, 'min-width': ['0'], overflow: ['hidden'], 'overflow-x': ['hidden'],
  'text-overflow': ['ellipsis'], flex: null, 'flex-shrink': null, 'flex-grow': null, 'flex-basis': null, display: null, 'line-clamp': null,
  'box-orient': null, 'word-break': null, 'overflow-wrap': null, 'word-wrap': null, width: null, 'max-width': null, position: null, float: null,
};
const BAR_RULES = {
  display: ['flex'], 'flex-direction': ['row'], 'flex-wrap': ['nowrap'], 'flex-flow': ['row', 'nowrap', 'row nowrap'],
  'white-space': ['nowrap'], 'text-wrap': null, 'text-wrap-mode': null, 'box-orient': null, float: null,
};
const CLUSTER_RULES = {
  flex: null, 'flex-shrink': null, 'flex-grow': null, 'flex-basis': null, width: null, 'max-width': null, 'min-width': null, display: ['flex'],
  'flex-wrap': ['nowrap'], 'flex-flow': ['row', 'nowrap', 'row nowrap'], 'flex-direction': ['row'], 'white-space': ['nowrap'], 'text-wrap': null, 'text-wrap-mode': null,
  position: null, float: null,
};
function census(el, base, table) {
  // Only the ONE base rule object is exempt: a later rule repeating the base selector is
  // censused like any other (it would win the cascade).
  const baseRule = exactly(base)[0];
  const found = rulesReaching(el).filter((r) => r !== baseRule);
  const bad = [];
  for (const r of found) {
    for (const [p, v] of Object.entries(r.decls)) {
      if (!(p in table)) continue;
      if (table[p] === null || !table[p].includes(v)) bad.push(r.selectors.join(', ') + ' { ' + p + ': ' + v + ' }');
    }
  }
  return { found, bad };
}

test('NO other rule that can reach the TITLE (any skin, breakpoint, the tray, a parent or universal selector, a vendor spelling) undoes the one-line title', () => {
  const { found, bad } = census(TITLE, '.mms-ipod .ip-np', TITLE_RULES);
  assert.ok(found.some((r) => r.selectors.includes('.mms-zune-classic .ip-np')), 'precondition: the Seattle palette rule is found (the census is not vacuous)');
  assert.deepStrictEqual(bad, [], 'rules that break the title');
});

test('NO other rule that can reach the BAR stacks, wraps or re-lays it out', () => {
  const { found, bad } = census(BAR, '.mms-ipod .ip-status', BAR_RULES);
  assert.ok(found.some((r) => r.selectors.includes('.mms-zune-classic .ip-status')), 'precondition: the Seattle bar rule is found');
  assert.deepStrictEqual(bad, [], 'rules that break the bar');
});

test('NO other rule that can reach the play mark + battery CLUSTER lets it shrink, grow or wrap', () => {
  const { bad } = census(CLUSTER, '.mms-ipod .ip-status-rt', CLUSTER_RULES);
  assert.deepStrictEqual(bad, [], 'rules that break the cluster');
});

test('the census parser itself: vendor prefixes and case normalize, and parent / child / universal selectors reach', () => {
  const r = rules('@media (x){ .mms-ipod .ip-status > span{ -WebKit-Flex-Shrink:0 !important; } .foo span{ white-space:normal; } }');
  assert.strictEqual(r[0].decls['flex-shrink'], '0');
  assert.ok(reaches('.mms-ipod .ip-status > span', TITLE));
  assert.ok(reaches('.mms-ipod .ip-status *', TITLE));
  assert.ok(reaches('.ip-status .ip-np', TITLE));
  assert.ok(reaches('body.mms-tray .ip-np', TITLE));
  assert.ok(reaches('span', TITLE), 'a bare element selector reaches everything');
  assert.ok(!reaches('.foo span', TITLE), 'a span under an unrelated ancestor does not');
  assert.ok(!reaches('.mms-ipod .ip-npview', TITLE), 'nor a different class');
  assert.ok(!reaches('.mms-ipod .ip-status-rt', TITLE), 'nor the cluster');
  assert.ok(reaches('.mms-ipod .ip-status', BAR));
  assert.ok(!reaches('.mms-ipod .ip-status span', BAR), 'a descendant rule is not the bar');
  assert.ok(reaches('.mms-ipod .ip-lcd-in > div', BAR));
  assert.ok(!reaches('.mms-ipod .ip-np::after', TITLE), 'a pseudo-element is not the element');
  assert.ok(!reaches(':where(button.music-song-artist)', TITLE), ':where() of another tag and class');
  assert.ok(reaches(':where(.ip-status) span', TITLE) && reaches('.mms-ipod :is(span, div)', TITLE), ':is() / :where() alternatives are read');
});

test('the rules land on the element every pocket skin renders: .ip-status > .ip-np + .ip-status-rt(play mark, battery)', () => {
  const SK = require('../../public/js/music-skins.js');
  for (const id of ['ipod', 'ipod-black', 'ipod-matte', 'zune-classic']) {
    const html = SK.renderFull(id, { track: { title: 'x', artist: 'y', album: 'z' } });
    assert.match(html, /<div class="ip-status"><span class="ip-np">Now Playing<\/span><span class="ip-status-rt"><span class="mms-playind"[^>]*>[^<]*<\/span><span class="ip-batt"[^>]*><i><\/i><\/span><\/span><\/div>/, id + ' renders the status bar the lock covers');
  }
  for (const id of ['ipod-black', 'ipod-matte', 'zune-classic']) assert.strictEqual(SK.skinById(id).base, 'ipod', id + ' carries the shared .mms-ipod CSS');
});
