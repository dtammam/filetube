'use strict';

// [UNIT] The pocket skins' LCD status bar stays ONE line (Dean 2026-09-24: "the song or album
// name might get too long and make that whole thing just a little bit too big. It'll expand
// it by a row."). The bar (.ip-status: the title .ip-np, then the play mark + battery in
// .ip-status-rt) is drawn by music-skins.js ipScreen for the Click trio AND Seattle, and the
// same panel renders in the desktop pop-out and the Nano tray. Its title is the menu's name,
// which on a drilled level is the artist / album / chaptered file's own name.
//
// jsdom has no layout, so the HEIGHT is measured in headless Chromium by
// scripts/skin-status-bar-probe.js (numbers in the plan:
// docs/exec-plans/active/2026-09-24-snap-offset-status-bar.md - 31.2 px with a 120-character
// album before AND after, where the old CSS grew it to 67.6 / 85.8 px). This file binds the
// CSS that produces it, with comments stripped ONCE at read (a commented-out copy of a rule
// must never satisfy a lock), and every rule that could override it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Every style rule as { selectors: [...], decls: {prop: value} } (innermost blocks: a rule in
// an @media block is found too). Property names are case-insensitive in CSS: lower-cased.
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
      decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim().replace(/\s*!important$/i, '');
    }
    out.push({ selectors, decls });
  }
  return out;
}
const ALL = rules(css);
// A selector whose LAST compound targets the class (".ip-np", never ".ip-npview").
const targets = (sel, cls) => new RegExp('\\.' + cls + '(?![\\w-])[^\\s>+~]*$').test(sel);
const rulesFor = (cls) => ALL.filter((r) => r.selectors.some((s) => targets(s, cls)));
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

test('the play mark + battery cluster never shrinks (and the bar never wraps)', () => {
  const rt = exactly('.mms-ipod .ip-status-rt');
  assert.strictEqual(rt.length, 1);
  assert.strictEqual(rt[0].decls.flex, 'none', 'the right cluster keeps its size and place');
  for (const r of rulesFor('ip-status')) {
    assert.notStrictEqual((r.decls['flex-wrap'] || '').toLowerCase(), 'wrap', 'the status bar must never wrap: ' + r.selectors.join(', '));
    assert.ok(!/\bwrap\b/.test(r.decls['flex-flow'] || ''), 'nor via flex-flow');
  }
});

test('NO later rule (any skin, any breakpoint, the tray) undoes the one-line title', () => {
  const overrides = rulesFor('ip-np').filter((r) => !r.selectors.includes('.mms-ipod .ip-np'));
  assert.ok(overrides.length >= 1, 'precondition: the Seattle palette rule is found (the census is not vacuous)');
  for (const r of overrides) {
    const d = r.decls;
    const where = r.selectors.join(', ');
    if ('white-space' in d) assert.strictEqual(d['white-space'], 'nowrap', where);
    if ('min-width' in d) assert.strictEqual(d['min-width'], '0', where);
    if ('overflow' in d) assert.strictEqual(d.overflow, 'hidden', where);
    for (const p of ['overflow-x', 'text-overflow', 'flex', 'flex-shrink', 'display', 'text-wrap', 'text-wrap-mode', 'word-break', 'line-clamp', '-webkit-line-clamp']) {
      if (p === 'text-overflow' && p in d) { assert.strictEqual(d[p], 'ellipsis', where); continue; }
      assert.ok(!(p in d), where + ' must not redeclare ' + p);
    }
  }
  for (const r of rulesFor('ip-status-rt').filter((x) => !x.selectors.includes('.mms-ipod .ip-status-rt'))) {
    for (const p of ['flex', 'flex-shrink', 'min-width', 'width', 'max-width']) assert.ok(!(p in r.decls), r.selectors.join(', ') + ' must not redeclare ' + p);
  }
});

test('the rules land on the element every pocket skin renders: .ip-status > .ip-np + .ip-status-rt(play mark, battery)', () => {
  const SK = require('../../public/js/music-skins.js');
  for (const id of ['ipod', 'ipod-black', 'ipod-matte', 'zune-classic']) {
    const html = SK.renderFull(id, { track: { title: 'x', artist: 'y', album: 'z' } });
    assert.match(html, /<div class="ip-status"><span class="ip-np">Now Playing<\/span><span class="ip-status-rt"><span class="mms-playind"[^>]*>[^<]*<\/span><span class="ip-batt"[^>]*><i><\/i><\/span><\/span><\/div>/, id + ' renders the status bar the lock covers');
  }
  // Every pocket skin is an .mms-ipod panel (the class the rules are scoped to).
  for (const id of ['ipod-black', 'ipod-matte', 'zune-classic']) assert.strictEqual(SK.skinById(id).base, 'ipod', id + ' carries the shared .mms-ipod CSS');
});
